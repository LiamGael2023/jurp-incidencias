# -*- coding: utf-8 -*-
"""
El almacén de evidencia del inventario: fotos y vídeos.

POR QUÉ HACE FALTA
------------------
/vigapi/inventario/fotos/ no existía. Sin él, un inventario de obra no tiene
evidencia, y para saber cómo está una estructura hay que ir hasta ella, que
es justo lo que el inventario debería ahorrar.

CÓMO SE APLICA
--------------
    python3 parche_fotos_inventario.py [--raiz /var/www/envs/vigilantes] [--dry-run]

Es idempotente y deja .bak de cada archivo. Cada bloque se escribe al final
de su archivo detrás de una marca; al volver a pasar el guion, el bloque
viejo se sustituye entero por el nuevo. Así una corrección se aplica sola,
sin que nadie tenga que editar nada a mano ni saber qué versión tenía.

LA TABLA NO LA CREA ESTE GUION
------------------------------
El router dice allow_migrate -> False para la app `inventario`, en todas las
bases: el esquema de PostGIS lo gobiernan los .sql de carga, no Django. Y
cuidado, porque `migrate` responde «Applying ... OK» igual, sin crear nada.
La tabla se crea con crear_tabla_fotos.sql, como superusuario, y se
comprueba con comprobar_tabla_fotos.py.

LAS TRES DECISIONES QUE NO SON OBVIAS
-------------------------------------
1. `tipo_activo` es TEXTO y no una clave foránea a TipoActivo, aunque
   Evaluacion sí la use. La evaluación solo existe para lo que entra en
   campaña; una foto se le puede tomar a cualquier cosa que salga en el
   mapa, incluidas las capas de contexto del PECH —la primera que se
   intentó fotografiar fue una bocatoma— y ésas no están en TipoActivo.

2. EL ARCHIVO LO ENTREGA LA PROPIA API, en fotos/<id>/imagen/, y no
   /media/. Aquí nginx no publica /media/ -está puesto a propósito- y /api/
   lo tiene tomado el contenedor de PLUVIRA: una URL absoluta a /media/ no
   llegaría a Django y el cliente recibiría el index.html del front con cara
   de archivo roto.

3. EL CAMPO SIGUE LLAMÁNDOSE `imagen` aunque ahora también guarde vídeos.
   Renombrarlo obligaría a un ALTER TABLE en un esquema donde la API no
   tiene DDL, y a coordinar el cambio con la app y la web a la vez. El
   nombre miente un poco; el precio de arreglarlo es mayor que el de
   explicarlo aquí.
"""

import argparse
import os
import re
import shutil
import sys


# ── modelos.py ────────────────────────────────────────────────────────────

MARCA_MODELO = '# ── Evidencia de los activos del inventario'

MODELO = MARCA_MODELO + ''' ──────────────────────────
#
# Un inventario de obra sin evidencia obliga a ir hasta la estructura para
# saber cómo está, que es justo lo que el inventario debería ahorrar.
#
# `tipo_activo` es TEXTO y no una FK a TipoActivo, al revés que en
# Evaluacion: la evaluación solo existe para lo que entra en campaña, pero
# una foto se le puede tomar a cualquier cosa que salga en el mapa —incluidas
# las capas de contexto del PECH, que no están en TipoActivo—. Con una FK,
# fotografiar una bocatoma daría un 400 incomprensible en campo.
from django.core.validators import (
    FileExtensionValidator as _ValidaExtension)
from django.db import models as _models_fotos


# Lo que se acepta. Los vídeos entran porque hay averías que una foto no
# cuenta: una compuerta que no cierra, una fuga, el ruido de una bomba. Y
# nada más que esto: el campo es un FileField y sin lista blanca aceptaría
# cualquier cosa que alguien suba desde la galería.
EXTENSIONES_FOTO = ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif']
EXTENSIONES_VIDEO = ['mp4', 'mov', 'm4v', '3gp', 'avi', 'mkv', 'webm']


def ruta_foto_activo(instancia, nombre):
    """inventario/<tipo>/<fid>/<archivo>.

    Repartidas por tipo y por estructura y no todas en una carpeta: con mil
    estructuras y tres archivos cada una, un solo directorio de tres mil es
    lento de listar e imposible de mirar a mano el día que haya que buscar
    uno.
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

    # FileField y no ImageField: un ImageField valida con Pillow que el
    # archivo sea una imagen, y rechazaría los vídeos. El campo conserva el
    # nombre `imagen` porque es el de la columna, y renombrarlo pediría un
    # ALTER TABLE en un esquema donde la API no tiene DDL.
    imagen = _models_fotos.FileField(
        'Archivo', upload_to=ruta_foto_activo,
        validators=[_ValidaExtension(
            allowed_extensions=EXTENSIONES_FOTO + EXTENSIONES_VIDEO)])

    descripcion = _models_fotos.CharField('Descripción', max_length=200,
                                          blank=True, default='')
    tomada_por = _models_fotos.CharField('Tomada por', max_length=120,
                                         blank=True, default='')
    creada = _models_fotos.DateTimeField('Subida', auto_now_add=True)

    class Meta:
        db_table = 'inventario_foto_activo'
        ordering = ['creada']
        verbose_name = 'Evidencia de activo'
        verbose_name_plural = 'Evidencias de activos'

    def __str__(self):
        return '{0}#{1}'.format(self.tipo_activo, self.activo_fid)

    @property
    def extension(self):
        nombre = self.imagen.name or ''
        return nombre.rsplit('.', 1)[-1].lower() if '.' in nombre else ''

    @property
    def es_video(self):
        return self.extension in EXTENSIONES_VIDEO
'''


# ── serializers.py ────────────────────────────────────────────────────────

MARCA_SERIALIZADOR = '# ── Evidencia de los activos ──'

SERIALIZADOR = MARCA_SERIALIZADOR + '''───────────────────────────────
from rest_framework import serializers as _serializers_fotos

from .models import FotoActivo as _FotoActivo


class FotoActivoSerializer(_serializers_fotos.ModelSerializer):
    """Las rutas de lectura van RELATIVAS, no absolutas.

    El cliente sabe cuál es su base -la web y la app de campo entran por
    hosts distintos- y el servidor no tiene por qué adivinarla. Una URL
    absoluta construida aquí sale con el host de la petición, que detrás de
    un proxy no siempre es el que el cliente puede abrir.

    `archivo_api` es la que hay que usar: la entrega Django y no necesita
    que nginx publique /media/.

    OJO CON `imagen`: se deja como el campo del modelo, tal cual, y no como
    campo calculado. Un SerializerMethodField es de SOLO LECTURA, así que
    convertirlo en uno dejaba al POST sin archivo y la subida fallaba con un
    error que no mencionaba la causa.

    Y `es_video` viaja explícito: la ruta de entrega no tiene extensión, así
    que el cliente no puede adivinar si lo que va a recibir es una imagen o
    un vídeo. Que lo diga el servidor, que es quien lo sabe.
    """

    archivo_api = _serializers_fotos.SerializerMethodField()
    imagen_api = _serializers_fotos.SerializerMethodField()
    imagen_media = _serializers_fotos.SerializerMethodField()
    es_video = _serializers_fotos.SerializerMethodField()

    class Meta:
        model = _FotoActivo
        fields = ['id', 'tipo_activo', 'activo_fid', 'imagen', 'archivo_api',
                  'imagen_api', 'imagen_media', 'es_video', 'descripcion',
                  'tomada_por', 'creada']
        read_only_fields = ['creada']

    def get_archivo_api(self, obj):
        return 'fotos/{0}/imagen/'.format(obj.pk)

    # El nombre viejo, para no romper a quien ya lo leía.
    def get_imagen_api(self, obj):
        return self.get_archivo_api(obj)

    def get_imagen_media(self, obj):
        from django.conf import settings as _conf
        if not obj.imagen:
            return ''
        return '{0}{1}'.format(getattr(_conf, 'MEDIA_URL', '/media/'),
                               obj.imagen.name)

    def get_es_video(self, obj):
        return bool(obj.es_video)
'''


# ── views.py ──────────────────────────────────────────────────────────────

MARCA_VISTA = '# ── Evidencia de los activos ──'

VISTA = MARCA_VISTA + '''───────────────────────────────
import os as _os_fotos
import re as _re_fotos

from django.http import (FileResponse as _FileResponse, Http404 as _Http404,
                         HttpResponse as _HttpResponse)
from rest_framework import viewsets as _viewsets_fotos
from rest_framework.decorators import action as _action_fotos
from rest_framework.parsers import (FormParser as _FormParser,
                                    MultiPartParser as _MultiPartParser)

from .models import FotoActivo as _FotoActivoModelo
from .serializers import FotoActivoSerializer as _FotoActivoSerializer


_TIPOS_MIME = {
    'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'png': 'image/png',
    'webp': 'image/webp', 'heic': 'image/heic', 'heif': 'image/heif',
    'mp4': 'video/mp4', 'm4v': 'video/mp4', 'mov': 'video/quicktime',
    '3gp': 'video/3gpp', 'avi': 'video/x-msvideo',
    'mkv': 'video/x-matroska', 'webm': 'video/webm',
}


class FotoActivoViewSet(_viewsets_fotos.ModelViewSet):
    """La evidencia de una estructura: fotos y vídeos.

    GET    fotos/?tipo_activo=T&activo_fid=N
    POST   fotos/            multipart: tipo_activo, activo_fid, imagen
    GET    fotos/<id>/imagen/
    DELETE fotos/<id>/

    EL ARCHIVO LO ENTREGA ESTA VISTA y no /media/: aquí nginx no publica
    /media/ —está así a propósito— y /api/ lo tiene tomado el contenedor de
    PLUVIRA, así que una URL a /media/ devolvería el index.html del front
    con cara de archivo roto. Entregarlo por la API no obliga a tocar nginx,
    que es donde se rompen estas cosas.
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

    def perform_destroy(self, instance):
        # El archivo se va con el registro. Si no, MEDIA_ROOT se llena de
        # huérfanos que nadie sabe de quién eran.
        archivo = instance.imagen
        instance.delete()
        try:
            archivo.delete(save=False)
        except Exception:                                      # noqa: BLE001
            pass

    @_action_fotos(detail=True, methods=['get'], url_path='imagen')
    def archivo(self, request, pk=None):
        """Entrega el archivo, con soporte de rangos.

        LOS RANGOS SON PARA EL VÍDEO. Un reproductor pide trozos -para
        empezar antes de tener todo y para poder adelantar-, y si el
        servidor ignora la cabecera Range y manda el archivo entero con un
        200, el reproductor de Android se queda esperando o no deja mover la
        barra. Django no los implementa, así que se hace aquí: son veinte
        líneas y es la diferencia entre que un vídeo se vea o no.
        """
        foto = self.get_object()
        if not foto.imagen:
            raise _Http404('Esta evidencia no tiene archivo')

        try:
            ruta = foto.imagen.path
            total = _os_fotos.path.getsize(ruta)
        except (IOError, OSError, ValueError, NotImplementedError):
            # El registro está pero el archivo no. Pasa si alguien limpió
            # MEDIA_ROOT a mano; decirlo es mejor que un 500 sin pista.
            raise _Http404('El archivo ya no está en el servidor')

        mime = _TIPOS_MIME.get(foto.extension, 'application/octet-stream')
        rango = request.META.get('HTTP_RANGE', '')
        pedido = _re_fotos.match(r'bytes=(\\d*)-(\\d*)', rango or '')

        if not pedido:
            respuesta = _FileResponse(open(ruta, 'rb'), content_type=mime)
            respuesta['Content-Length'] = str(total)
            respuesta['Accept-Ranges'] = 'bytes'
            # El nombre lleva un uuid, así que el contenido nunca cambia.
            respuesta['Cache-Control'] = 'public, max-age=31536000, immutable'
            return respuesta

        desde = int(pedido.group(1)) if pedido.group(1) else 0
        hasta = int(pedido.group(2)) if pedido.group(2) else total - 1
        hasta = min(hasta, total - 1)
        if desde > hasta:
            vacia = _HttpResponse(status=416)
            vacia['Content-Range'] = 'bytes */{0}'.format(total)
            return vacia

        with open(ruta, 'rb') as f:
            f.seek(desde)
            trozo = f.read(hasta - desde + 1)

        parcial = _HttpResponse(trozo, status=206, content_type=mime)
        parcial['Content-Range'] = 'bytes {0}-{1}/{2}'.format(
            desde, hasta, total)
        parcial['Content-Length'] = str(len(trozo))
        parcial['Accept-Ranges'] = 'bytes'
        return parcial
'''


# ── urls.py ───────────────────────────────────────────────────────────────

RUTA = ("router.register(r'fotos', views.FotoActivoViewSet, "
        "basename='fotos')\n")


# Marcas que dejaron las versiones anteriores del guion. Se buscan para
# poder cortar por ahí y sustituir el bloque entero, en vez de pedirle a
# nadie que edite a mano.
MARCAS_VIEJAS = [
    '# ── Fotos de los activos del inventario',
    '# ── Fotos de los activos ──',
]


def leer(ruta):
    with open(ruta, 'r') as f:
        return f.read()


def escribir(ruta, texto, simulacro):
    if simulacro:
        return
    shutil.copy2(ruta, ruta + '.bak')
    with open(ruta, 'w') as f:
        f.write(texto)


def poner_bloque(ruta, marcas, bloque, simulacro):
    """Deja `bloque` al final del archivo, sustituyendo el que hubiera.

    Los bloques de este guion siempre se escriben al final y detrás de una
    marca, así que desde la marca hasta el final del archivo es todo suyo y
    se puede tirar entero. Es lo que permite corregir una version anterior
    sin saber cuál era.

    Si una marca sale dos veces, no se toca nada: eso ya no es un archivo
    que este guion escribió solo, y adivinar ahí es como se rompen las
    cosas de verdad.
    """
    t = leer(ruta)
    for marca in marcas:
        apariciones = t.count(marca)
        if apariciones > 1:
            return False, ('la marca "{0}" sale {1} veces; revisalo a mano'
                           .format(marca[:34], apariciones))
        if apariciones == 1:
            if t[t.index(marca):] == bloque:
                return True, 'ya estaba'
            escribir(ruta, t[:t.index(marca)] + bloque, simulacro)
            return True, 'bloque actualizado'
    escribir(ruta, t.rstrip() + '\n\n' + bloque, simulacro)
    return True, 'bloque anadido'


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
    salto = t.find('\n', corte)
    corte = len(t) if salto < 0 else salto + 1
    escribir(ruta, t[:corte] + RUTA + t[corte:], simulacro)
    return True, 'ruta fotos/ registrada'


def mirar_media(raiz):
    """Avisa si los archivos no fuesen a sobrevivir a un despliegue."""
    ajustes = os.path.join(raiz, 'config/settings.py')
    if not os.path.exists(ajustes):
        return 'no pude leer config/settings.py'
    if 'MEDIA_ROOT' not in leer(ajustes):
        return 'MEDIA_ROOT no esta definido: no habria donde guardar'
    compose = os.path.join(raiz, 'docker-compose.yml')
    if os.path.exists(compose) and re.search(r'^\s*-\s*\.{1,2}/?:?/app',
                                             leer(compose), re.M):
        return 'el codigo esta montado desde el host: los archivos persisten'
    return ('comprueba que MEDIA_ROOT caiga en un volumen; si no, la '
            'evidencia se borra en cada despliegue')


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
        ('modelo', lambda: poner_bloque(
            os.path.join(app, 'models.py'),
            [MARCA_MODELO] + MARCAS_VIEJAS, MODELO, args.dry_run)),
        ('serializador', lambda: poner_bloque(
            os.path.join(app, 'serializers.py'),
            [MARCA_SERIALIZADOR] + MARCAS_VIEJAS, SERIALIZADOR, args.dry_run)),
        ('vista', lambda: poner_bloque(
            os.path.join(app, 'views.py'),
            [MARCA_VISTA] + MARCAS_VIEJAS, VISTA, args.dry_run)),
        ('ruta', lambda: paso_ruta(app, args.dry_run)),
    ]

    fallo = False
    for nombre, fn in pasos:
        try:
            ok, detalle = fn()
        except IOError as e:
            ok, detalle = False, str(e)
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

    print('\nFalta reiniciar:')
    print('  cd {0}'.format(args.raiz))
    print('  docker compose restart web')
    print('\nLa tabla no la toca este guion: la crea crear_tabla_fotos.sql.')


if __name__ == '__main__':
    main()
