# -*- coding: utf-8 -*-
"""
El almacén de fotos del inventario: modelo, endpoint y entrega.

POR QUÉ HACE FALTA
------------------
/vigapi/inventario/fotos/ responde 404: ese endpoint no existe. Sin él, un
inventario de obra no tiene fotografía, y entonces para saber cómo está una
estructura hay que ir hasta ella —que es justo lo que el inventario debería
ahorrar—. La app de campo ya sabe tomarlas y comprimirlas; solo falta dónde
dejarlas.

LAS TRES DECISIONES QUE NO SON OBVIAS
-------------------------------------
1. `tipo_activo` es TEXTO y no una clave foránea a TipoActivo, aunque
   Evaluacion sí la use. La evaluación solo existe para lo que entra en
   campaña; una foto se le puede tomar a cualquier cosa que salga en el
   mapa, incluidas las capas de contexto del PECH —la primera que se
   intentó fotografiar fue una bocatoma— y ésas no están en TipoActivo.
   Con una FK, fotografiar una bocatoma habría dado un 400 incomprensible.

2. LA IMAGEN SE ENTREGA POR LA PROPIA API, en
   fotos/<id>/imagen/, y no por /media/. En este servidor nginx no publica
   /media/ -está puesto a propósito, para que las fotos las entregue Django
   con control de permisos- y además /api/ está tomado por el contenedor de
   PLUVIRA: una URL absoluta a /media/ no llegaría a Django y el navegador
   recibiría el index.html del front con cara de imagen rota. Entregarla por
   la API no necesita tocar nginx, que es donde se rompen estas cosas.

3. EL SERIALIZADOR DEVUELVE RUTAS RELATIVAS, no absolutas. El cliente sabe
   cuál es su base -la web y la app entran por hosts distintos- y el
   servidor no tiene por qué adivinarla. `imagen_api` cuelga de la raíz del
   inventario; `imagen` se deja como ruta de media para no romper a quien ya
   la leía.

DÓNDE ACABAN LOS ARCHIVOS
-------------------------
En MEDIA_ROOT, que aquí es BASE_DIR/'media', y BASE_DIR está montado desde
el host —por eso se pueden parchear los .py y reiniciar—, así que las fotos
sobreviven a los despliegues. El guion lo comprueba y avisa si no.

USO
---
    python3 parche_fotos_inventario.py [--raiz /var/www/envs/vigilantes] [--dry-run]

Después hay que migrar y reiniciar. Es idempotente y deja .bak de cada
archivo que toca.
"""

import argparse
import os
import re
import shutil
import sys


MODELO = '''

# ── Fotos de los activos del inventario ───────────────────────────────────
#
# Un inventario de obra sin fotografía obliga a ir hasta la estructura para
# saber cómo está, que es justo lo que el inventario debería ahorrar.
#
# `tipo_activo` es TEXTO y no una FK a TipoActivo, al revés que en
# Evaluacion: la evaluación solo existe para lo que entra en campaña, pero
# una foto se le puede tomar a cualquier cosa que salga en el mapa —incluidas
# las capas de contexto del PECH, que no están en TipoActivo—. Con una FK,
# fotografiar una bocatoma daría un 400 incomprensible en campo.
from django.db import models as _models_fotos


def ruta_foto_activo(instancia, nombre):
    """inventario/<tipo>/<fid>/<archivo>.

    Repartidas por tipo y por estructura y no todas en una carpeta: con mil
    estructuras y tres fotos cada una, un solo directorio de tres mil
    archivos es lento de listar y imposible de mirar a mano el día que haya
    que buscar una.
    """
    import os as _os
    import uuid as _uuid
    ext = (_os.path.splitext(nombre)[1] or '.jpg').lower()[:8]
    return 'inventario/{0}/{1}/{2}{3}'.format(
        instancia.tipo_activo or 'sin_tipo', instancia.activo_fid,
        _uuid.uuid4().hex[:12], ext)


class FotoActivo(_models_fotos.Model):
    tipo_activo = _models_fotos.CharField('Capa del activo', max_length=64,
                                          db_index=True)
    activo_fid = _models_fotos.IntegerField('fid del activo', db_index=True)
    imagen = _models_fotos.ImageField('Imagen', upload_to=ruta_foto_activo)
    descripcion = _models_fotos.CharField('Descripción', max_length=200,
                                          blank=True, default='')
    tomada_por = _models_fotos.CharField('Tomada por', max_length=120,
                                         blank=True, default='')
    creada = _models_fotos.DateTimeField('Subida', auto_now_add=True)

    class Meta:
        db_table = 'inventario_foto_activo'
        ordering = ['creada']
        verbose_name = 'Foto de activo'
        verbose_name_plural = 'Fotos de activos'
        indexes = [
            _models_fotos.Index(fields=['tipo_activo', 'activo_fid']),
        ]

    def __str__(self):
        return '{0}#{1}'.format(self.tipo_activo, self.activo_fid)
'''


SERIALIZADOR = '''

# ── Fotos de los activos ──────────────────────────────────────────────────
from rest_framework import serializers as _serializers_fotos

from .models import FotoActivo as _FotoActivo


class FotoActivoSerializer(_serializers_fotos.ModelSerializer):
    """Las rutas van RELATIVAS, no absolutas.

    El cliente sabe cuál es su base -la web y la app de campo entran por
    hosts distintos- y el servidor no tiene por qué adivinarla. Una URL
    absoluta construida aquí sale con el host de la petición, que detrás de
    un proxy no siempre es el que el cliente puede abrir.

    `imagen_api` cuelga de la raíz del inventario y es la que hay que usar:
    la entrega Django y no necesita que nginx publique /media/.
    """

    imagen = _serializers_fotos.SerializerMethodField()
    imagen_api = _serializers_fotos.SerializerMethodField()

    class Meta:
        model = _FotoActivo
        fields = ['id', 'tipo_activo', 'activo_fid', 'imagen', 'imagen_api',
                  'descripcion', 'tomada_por', 'creada']
        read_only_fields = ['creada']

    def get_imagen(self, obj):
        from django.conf import settings as _conf
        if not obj.imagen:
            return ''
        return '{0}{1}'.format(getattr(_conf, 'MEDIA_URL', '/media/'),
                               obj.imagen.name)

    def get_imagen_api(self, obj):
        return 'fotos/{0}/imagen/'.format(obj.pk)
'''


VISTA = '''

# ── Fotos de los activos ──────────────────────────────────────────────────
from django.http import FileResponse as _FileResponse, Http404 as _Http404
from rest_framework import viewsets as _viewsets_fotos
from rest_framework.decorators import action as _action_fotos
from rest_framework.parsers import (FormParser as _FormParser,
                                    MultiPartParser as _MultiPartParser)

from .models import FotoActivo as _FotoActivoModelo
from .serializers import FotoActivoSerializer as _FotoActivoSerializer


class FotoActivoViewSet(_viewsets_fotos.ModelViewSet):
    """Las fotos de una estructura.

    GET    fotos/?tipo_activo=T&activo_fid=N
    POST   fotos/            multipart: tipo_activo, activo_fid, imagen
    GET    fotos/<id>/imagen/
    DELETE fotos/<id>/

    LA IMAGEN SE ENTREGA POR AQUÍ y no por /media/: en este servidor nginx
    no publica /media/ —está así a propósito— y /api/ lo tiene tomado el
    contenedor de PLUVIRA, así que una URL a /media/ devolvería el index.html
    del front con cara de imagen rota. Entregarla por la API no obliga a
    tocar nginx, que es donde se rompen estas cosas.
    """

    serializer_class = _FotoActivoSerializer
    parser_classes = [_MultiPartParser, _FormParser]

    def get_queryset(self):
        qs = _FotoActivoModelo.objects.all()
        tipo = self.request.query_params.get('tipo_activo')
        fid = self.request.query_params.get('activo_fid')
        if tipo:
            qs = qs.filter(tipo_activo=tipo)
        if fid:
            # Un fid que no es un número no es un error del servidor: es una
            # llamada mal armada. Devolver vacío dice lo mismo sin un 500.
            try:
                qs = qs.filter(activo_fid=int(fid))
            except (TypeError, ValueError):
                return qs.none()
        return qs.order_by('creada')

    @_action_fotos(detail=True, methods=['get'], url_path='imagen')
    def imagen_archivo(self, request, pk=None):
        foto = self.get_object()
        if not foto.imagen:
            raise _Http404('Esta foto no tiene archivo')
        try:
            archivo = foto.imagen.open('rb')
        except (IOError, OSError, ValueError):
            # El registro está pero el archivo no. Pasa si alguien limpió
            # MEDIA_ROOT a mano; decirlo es mejor que un 500 sin pista.
            raise _Http404('El archivo de esta foto ya no está en el servidor')
        ext = (foto.imagen.name or '').lower()
        tipo = 'image/png' if ext.endswith('.png') else (
            'image/webp' if ext.endswith('.webp') else 'image/jpeg')
        respuesta = _FileResponse(archivo, content_type=tipo)
        # Las fotos no cambian nunca: el nombre del archivo lleva un uuid.
        respuesta['Cache-Control'] = 'public, max-age=31536000, immutable'
        return respuesta
'''


RUTA = ("router.register(r'fotos', views.FotoActivoViewSet, "
        "basename='fotos')\n")


def leer(ruta):
    with open(ruta, 'r') as f:
        return f.read()


def escribir(ruta, texto, simulacro):
    if simulacro:
        return
    shutil.copy2(ruta, ruta + '.bak')
    with open(ruta, 'w') as f:
        f.write(texto)


def buscar_app(raiz):
    """La carpeta de la app del inventario.

    Se busca por la ruta que ya funciona -campos-evaluables- y no por el
    nombre de la carpeta, porque al lado hay varias copias de seguridad
    (inventario.bak_1540, inventario.bak_1602) y parchear una de ésas
    dejaría todo igual sin que nada fallara.
    """
    for nombre in sorted(os.listdir(raiz)):
        carpeta = os.path.join(raiz, nombre)
        urls = os.path.join(carpeta, 'urls.py')
        if not os.path.isdir(carpeta) or '.bak' in nombre:
            continue
        if os.path.exists(urls) and 'campos-evaluables' in leer(urls):
            return carpeta, None
    return None, 'no encuentro la app del inventario bajo {0}'.format(raiz)


def paso_modelo(app, simulacro):
    ruta = os.path.join(app, 'models.py')
    if not os.path.exists(ruta):
        return False, 'no existe models.py'
    t = leer(ruta)
    if 'class FotoActivo' in t:
        return True, 'ya estaba'
    escribir(ruta, t.rstrip() + '\n' + MODELO, simulacro)
    return True, 'FotoActivo anadido'


def paso_serializador(app, simulacro):
    ruta = os.path.join(app, 'serializers.py')
    if not os.path.exists(ruta):
        return False, ('no existe serializers.py; dime como se llama y '
                       'ajusto el parche')
    t = leer(ruta)
    if 'FotoActivoSerializer' in t:
        return True, 'ya estaba'
    escribir(ruta, t.rstrip() + '\n' + SERIALIZADOR, simulacro)
    return True, 'FotoActivoSerializer anadido'


def paso_vista(app, simulacro):
    ruta = os.path.join(app, 'views.py')
    if not os.path.exists(ruta):
        return False, 'no existe views.py'
    t = leer(ruta)
    if 'class FotoActivoViewSet' in t:
        return True, 'ya estaba'
    escribir(ruta, t.rstrip() + '\n' + VISTA, simulacro)
    return True, 'FotoActivoViewSet anadido'


def paso_ruta(app, simulacro):
    """La ruta, justo detras del ultimo register del router."""
    ruta = os.path.join(app, 'urls.py')
    t = leer(ruta)
    if "r'fotos'" in t or 'r"fotos"' in t:
        return True, 'ya estaba'

    registros = list(re.finditer(r'^router\.register\(.*?\)\s*$', t,
                                 re.M | re.S))
    if not registros:
        return False, 'urls.py no tiene ningun router.register donde anclar'
    corte = registros[-1].end()
    # El final del ultimo register puede quedar a mitad de una llamada
    # repartida en varias lineas; se avanza hasta el salto de linea.
    salto = t.find('\n', corte)
    corte = len(t) if salto < 0 else salto + 1
    escribir(ruta, t[:corte] + RUTA + t[corte:], simulacro)
    return True, 'ruta fotos/ registrada'


def mirar_media(raiz):
    """Avisa si las fotos no fuesen a sobrevivir a un despliegue."""
    ajustes = os.path.join(raiz, 'config/settings.py')
    if not os.path.exists(ajustes):
        return 'no pude leer config/settings.py'
    t = leer(ajustes)
    if 'MEDIA_ROOT' not in t:
        return 'MEDIA_ROOT no esta definido: las fotos no tendrian donde ir'
    compose = os.path.join(raiz, 'docker-compose.yml')
    if os.path.exists(compose) and re.search(r'^\s*-\s*\.{1,2}/?:?/app',
                                             leer(compose), re.M):
        return 'el codigo esta montado desde el host: las fotos persisten'
    return ('comprueba que MEDIA_ROOT caiga en un volumen; si no, las fotos '
            'se borran en cada despliegue')


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--raiz', default='/var/www/envs/vigilantes')
    p.add_argument('--dry-run', action='store_true')
    args = p.parse_args()

    app, mal = buscar_app(args.raiz)
    if mal:
        print('[MAL] {0}'.format(mal))
        sys.exit(1)
    print('App del inventario: {0}'.format(app))

    pasos = [
        ('modelo', lambda: paso_modelo(app, args.dry_run)),
        ('serializador', lambda: paso_serializador(app, args.dry_run)),
        ('vista', lambda: paso_vista(app, args.dry_run)),
        ('ruta', lambda: paso_ruta(app, args.dry_run)),
    ]

    fallo = False
    for nombre, fn in pasos:
        ok, detalle = fn()
        print('[{0}] {1}: {2}'.format('OK ' if ok else 'MAL', nombre, detalle))
        if not ok:
            fallo = True

    print('\nMedia: {0}'.format(mirar_media(args.raiz)))

    if fallo:
        print('\nNO se aplico todo. Revisa lo marcado como MAL antes de seguir.')
        sys.exit(1)
    if args.dry_run:
        print('\nSimulacro: no se escribio nada.')
        return

    print('\nFalta migrar y reiniciar:')
    print('  cd {0}'.format(args.raiz))
    print('  docker compose exec -T web python manage.py makemigrations inventario')
    print('  docker compose exec -T web python manage.py migrate')
    print('  docker compose restart web')
    print('\nY comprobar:')
    print('  curl -s -o /dev/null -w "%{http_code}\\n" \\')
    print('    "https://nexhydro.jriegopresurizado.org.pe/vigapi/inventario/fotos/"')


if __name__ == '__main__':
    main()
