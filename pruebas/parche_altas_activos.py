# -*- coding: utf-8 -*-
"""
Validar un alta de campo y promoverla a su capa.

QUÉ FALTABA
-----------
La mesa estaba puesta: `activos_nuevos` tiene `validacion` y `promovido_fid`,
el ViewSet es un ModelViewSet —así que ya aceptaba POST— y las fotos ya
saben colgar de un alta. Lo que no existía era el paso de aprobar: nadie
escribía `promovido_fid` y un alta aprobada no aparecía en ninguna capa.

Esto añade `POST /activos-nuevos/<id>/validar/` con:

    {"validacion": "aprobado", "validado_por": "cherrera", "nota": "..."}

Aprobar inserta la fila en la capa que corresponda al tipo y guarda el id
nuevo en `promovido_fid`. Rechazar o marcar duplicado solo anota.

POR QUÉ LA ACCIÓN SE ENGANCHA DESPUÉS DE LA CLASE
--------------------------------------------------
Lo natural sería escribirla dentro de `ActivoNuevoViewSet`, pero este parche
no edita cuerpos de clase: pega bloques al final del archivo, que es lo que
permite volver a pasarlo y corregir la versión anterior sin adivinar qué
había. Así que la función se define suelta y se cuelga de la clase.

Funciona porque el router de DRF lee las acciones cuando `urls.py` evalúa
`router.urls`, y para entonces `views.py` ya se importó entero —el import va
antes que el register—. Si algún día se registrara el router dentro de
views.py, esto dejaría de verse y la ruta no existiría: por eso el guion
comprueba al final que la acción quedó colgada.

LO QUE NO HACE, Y CONVIENE SABER
---------------------------------
`permission_classes = [AllowAny]` sigue igual, como en el resto de la API:
cualquiera que conozca la URL puede crear, validar y BORRAR altas. No lo
cambio aquí porque la app de campo no manda credenciales hoy y cerrarlo la
dejaría sin poder registrar. Es una decisión pendiente, no un olvido.
"""

import argparse
import os
import re
import shutil
import sys


MARCA = '# ── Validar un alta y promoverla a su capa'

BLOQUE = MARCA + ''' ───────────────────────

def _capa_de(alta):
    """La capa donde vive ese tipo de activo, o None si no hay."""
    entrada = CAPAS.get(alta.tipo_activo_id)
    return entrada[0] if entrada else None


def _columnas(modelo):
    return {f.name for f in modelo._meta.get_fields() if hasattr(f, 'attname')}


def _es_de_puntos(modelo):
    """Si la capa guarda puntos.

    Un alta es SIEMPRE un punto —alguien parado delante de la estructura con
    el GPS— así que a una capa de líneas o de polígonos no se la puede
    promover: habría que digitalizar el trazado, que es otro trabajo. Mejor
    decirlo que meter un punto donde se espera un canal.
    """
    campo = modelo._meta.get_field('geom')
    return campo.geom_type.upper() in ('POINT', 'MULTIPOINT')


def _promover(alta, quien):
    """Inserta el alta en su capa. Devuelve (fid, None) o (None, motivo)."""
    from django.contrib.gis.geos import MultiPoint

    modelo = _capa_de(alta)
    if modelo is None:
        return None, 'el tipo "{0}" no tiene capa en el registro'.format(alta.tipo_activo_id)
    if not _es_de_puntos(modelo):
        return None, ('la capa de "{0}" guarda trazados, no puntos; '
                      'un alta no se puede promover ahi'.format(alta.tipo_activo_id))

    cols = _columnas(modelo)
    campo = modelo._meta.get_field('geom')
    datos = {}

    # La geometria: el alta es un punto; la capa suele ser MultiPoint.
    datos['geom'] = (MultiPoint(alta.geom, srid=alta.geom.srid)
                     if campo.geom_type.upper() == 'MULTIPOINT' else alta.geom)

    if 'nombre' in cols:
        datos['nombre'] = alta.nombre
    if 'etiqueta' in cols:
        datos['etiqueta'] = alta.nombre
    if 'ambito' in cols:
        # Lo que da de alta la Junta es de la Junta. Sin esto quedaria fuera
        # del filtro con el que el visor y la app miran su propio ambito, y
        # el activo existiria sin que nadie lo viera.
        datos['ambito'] = AMBITO_EVALUABLE
    if 'fuente' in cols:
        datos['fuente'] = 'alta de campo {0}'.format(alta.campania.anio)
    if 'campania_alta' in cols:
        # Lo que separa lo que ya estaba de lo que se encontro este ano.
        datos['campania_alta'] = alta.campania.anio

    # Lo que el formulario haya recogido, solo si la capa tiene esa columna.
    # Un atributo que no encaje se ignora en silencio a proposito: los
    # formularios de campo cambian mas a menudo que las tablas, y no vale la
    # pena tumbar una aprobacion por un campo de mas.
    for clave, valor in (alta.atributos or {}).items():
        if clave in cols and clave not in datos and clave != 'geom':
            datos[clave] = valor

    objeto = modelo.objects.create(**datos)
    return objeto.pk, None


def _validar_alta(self, request, pk=None):
    from django.utils import timezone
    from rest_framework.response import Response as _Resp

    alta = self.get_object()
    destino = (request.data.get('validacion') or '').strip()
    if destino not in ('aprobado', 'rechazado', 'duplicado'):
        return _Resp({'detail': 'validacion debe ser aprobado, rechazado o duplicado'},
                     status=status.HTTP_400_BAD_REQUEST)

    # Aprobar dos veces insertaria el activo dos veces. Pasa: dos personas
    # mirando la misma lista de pendientes.
    if alta.validacion == 'aprobado' and alta.promovido_fid:
        return _Resp({'detail': 'ya estaba aprobada',
                      'promovido_fid': alta.promovido_fid},
                     status=status.HTTP_409_CONFLICT)

    fid = None
    if destino == 'aprobado':
        fid, motivo = _promover(alta, request.data.get('validado_por'))
        if motivo:
            return _Resp({'detail': motivo}, status=status.HTTP_400_BAD_REQUEST)
        alta.promovido_fid = fid

    alta.validacion = destino
    alta.validado_por = request.data.get('validado_por') or None
    alta.validado_en = timezone.now()
    alta.nota_validacion = request.data.get('nota') or None
    alta.save()

    return _Resp({'id': alta.id, 'validacion': alta.validacion,
                  'promovido_fid': alta.promovido_fid})


# El decorador se aplica a mano y la funcion se cuelga de la clase: ver la
# cabecera del parche para por que no va dentro del cuerpo.
ActivoNuevoViewSet.validar = action(
    detail=True, methods=['post'], url_path='validar')(_validar_alta)
'''


def leer(ruta):
    with open(ruta) as f:
        return f.read()


def escribir(ruta, texto, simulacro):
    try:
        compile(texto, ruta, 'exec')
    except SyntaxError as e:
        raise IOError('el resultado no compila: {0} (linea {1})'.format(e.msg, e.lineno))
    if simulacro:
        return
    shutil.copy2(ruta, ruta + '.bak')
    with open(ruta, 'w') as f:
        f.write(texto)


def poner_bloque(ruta, marca, bloque, simulacro):
    t = leer(ruta)
    veces = t.count(marca)
    if veces > 1:
        return False, 'la marca sale {0} veces; revisalo a mano'.format(veces)
    if veces == 1:
        if t[t.index(marca):] == bloque:
            return True, 'ya estaba'
        escribir(ruta, t[:t.index(marca)] + bloque, simulacro)
        return True, 'bloque actualizado'
    escribir(ruta, t.rstrip() + '\n\n\n' + bloque, simulacro)
    return True, 'bloque anadido'


def buscar_app(raiz):
    if not os.path.isdir(raiz):
        return None, 'no existe {0}'.format(raiz)
    for nombre in sorted(os.listdir(raiz)):
        carpeta = os.path.join(raiz, nombre)
        if not os.path.isdir(carpeta) or '.bak' in nombre:
            continue
        urls = os.path.join(carpeta, 'urls.py')
        if os.path.exists(urls) and 'campos-evaluables' in leer(urls):
            return carpeta, None
    return None, 'no encuentro la app del inventario bajo {0}'.format(raiz)


def comprobar_base(app):
    """Lo que el bloque da por hecho que existe en views.py."""
    v = leer(os.path.join(app, 'views.py'))
    faltan = []
    for nombre, patron in (
            ('la clase ActivoNuevoViewSet', r'^class ActivoNuevoViewSet'),
            ('el diccionario CAPAS', r'^CAPAS\s*=\s*\{'),
            ('AMBITO_EVALUABLE', r'^AMBITO_EVALUABLE\s*='),
            ('el import de action', r'^from rest_framework\.decorators import .*\baction\b'),
            ('el import de status', r'^from rest_framework import .*\bstatus\b')):
        if not re.search(patron, v, re.M):
            faltan.append(nombre)
    # El router tiene que leerse DESPUES de importar views; si algun dia se
    # registrara dentro de views.py, la accion colgada no se veria.
    u = leer(os.path.join(app, 'urls.py'))
    if 'activos-nuevos' not in u:
        faltan.append('el registro de activos-nuevos en urls.py')
    return faltan


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

    faltan = comprobar_base(app)
    if faltan:
        print('[MAL] falta lo que este parche necesita: {0}'.format(', '.join(faltan)))
        sys.exit(1)

    try:
        ok, detalle = poner_bloque(os.path.join(app, 'views.py'), MARCA, BLOQUE,
                                   args.dry_run)
    except (IOError, OSError) as e:
        ok, detalle = False, str(e)
    print('[{0}] accion validar: {1}'.format('OK ' if ok else 'MAL', detalle))
    if not ok:
        print('\nNO se aplico. views.py.bak esta al lado.')
        sys.exit(1)

    if args.dry_run:
        print('\nSimulacro: no se escribio nada.')
        return

    print('\nFalta:')
    print('  cd {0} && docker compose restart web'.format(args.raiz))
    print('\nY comprobar que la ruta existe de verdad —no basta con que el')
    print('archivo compile, la accion se cuelga a mano—:')
    print('  curl -s http://127.0.0.1:8005/api/v1/inventario/activos-nuevos/ \\')
    print('    | head -c 200')
    print('  # y sobre un alta pendiente:')
    print("  curl -s -X POST -H 'Content-Type: application/json' \\")
    print('    -d \'{"validacion":"rechazado","nota":"prueba"}\' \\')
    print('    http://127.0.0.1:8005/api/v1/inventario/activos-nuevos/<id>/validar/')


if __name__ == '__main__':
    main()
