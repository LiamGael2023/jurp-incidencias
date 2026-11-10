# -*- coding: utf-8 -*-
"""
Prueba de la lógica que añade parche_altas_activos.py.

No levanta Django: saca el bloque del parche y lo ejecuta contra dobles de
los modelos. Lo que se comprueba es lo que de verdad puede salir mal —a qué
columnas se copia, qué pasa con una capa de líneas, qué pasa al aprobar dos
veces— y no que Django sepa guardar una fila.

    python3 pruebas/altas_activos.prueba.py
"""

import os
import sys
import types

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, AQUI)

import parche_altas_activos as parche          # noqa: E402

bien = mal = 0


def t(titulo, cond):
    global bien, mal
    if cond:
        bien += 1
    else:
        mal += 1
        print('MAL  {0}'.format(titulo))


# ── dobles ───────────────────────────────────────────────────────────────

class CampoGeom(object):
    def __init__(self, tipo):
        self.geom_type = tipo


class Meta(object):
    def __init__(self, campos, geom):
        self._campos = campos
        self._geom = CampoGeom(geom)

    def get_fields(self):
        salida = []
        for n in self._campos:
            f = types.SimpleNamespace(name=n, attname=n)
            salida.append(f)
        return salida

    def get_field(self, nombre):
        if nombre == 'geom':
            return self._geom
        raise KeyError(nombre)


class Gestor(object):
    def __init__(self, dueno):
        self.dueno = dueno

    def create(self, **datos):
        self.dueno.creados.append(datos)
        return types.SimpleNamespace(pk=1000 + len(self.dueno.creados))


class CapaFalsa(object):
    def __init__(self, campos, geom='MULTIPOINT'):
        self._meta = Meta(campos, geom)
        self.creados = []
        self.objects = Gestor(self)


class Punto(object):
    def __init__(self, srid=32717):
        self.srid = srid


# Módulos que el bloque importa dentro de las funciones.
geos = types.ModuleType('django.contrib.gis.geos')
geos.MultiPoint = lambda p, srid=None: ('multipoint', p, srid)
sys.modules['django.contrib.gis.geos'] = geos

utils = types.ModuleType('django.utils')
utils.timezone = types.SimpleNamespace(now=lambda: 'AHORA')
sys.modules['django.utils'] = utils

resp = types.ModuleType('rest_framework.response')


class Response(object):
    def __init__(self, data, status=200):
        self.data = data
        self.status_code = status


resp.Response = Response
sys.modules['rest_framework.response'] = resp


# ── el bloque, ejecutado contra los dobles ───────────────────────────────

CAPA_PUNTOS = CapaFalsa(
    ['ogc_fid', 'nombre', 'etiqueta', 'ambito', 'fuente', 'campania_alta',
     'margen', 'material', 'geom'])
CAPA_TRAZADO = CapaFalsa(['fid', 'nombre', 'geom'], geom='MULTILINESTRING')
CAPA_PUNTO_SIMPLE = CapaFalsa(['ogc_fid', 'nombre', 'geom'], geom='POINT')


class ViewSetFalso(object):
    pass


espacio = {
    'CAPAS': {
        'tomas_l10': (CAPA_PUNTOS, None),
        'canal_madre': (CAPA_TRAZADO, None),
        'hito': (CAPA_PUNTO_SIMPLE, None),
    },
    'AMBITO_EVALUABLE': 'JURP',
    'ActivoNuevoViewSet': ViewSetFalso,
    # El decorador real registra la acción; aquí solo deja pasar la función.
    'action': lambda **kw: (lambda fn: setattr(fn, '_kw', kw) or fn),
    'status': types.SimpleNamespace(HTTP_400_BAD_REQUEST=400,
                                    HTTP_409_CONFLICT=409),
}
exec(compile(parche.BLOQUE, 'bloque', 'exec'), espacio)

promover = espacio['_promover']
validar = espacio['_validar_alta']


def alta(tipo='tomas_l10', atributos=None, validacion='pendiente', fid=None):
    return types.SimpleNamespace(
        id=7, tipo_activo_id=tipo, geom=Punto(), nombre='Toma nueva',
        atributos=atributos or {}, campania=types.SimpleNamespace(anio=2026),
        validacion=validacion, promovido_fid=fid,
        validado_por=None, validado_en=None, nota_validacion=None,
        save=lambda: None)


# ── lo que importa ───────────────────────────────────────────────────────

print('1. Promover a una capa de puntos')
CAPA_PUNTOS.creados = []
fid, motivo = promover(alta(atributos={'margen': 'D', 'material': 'concreto',
                                       'inventado': 'x'}), 'cherrera')
fila = CAPA_PUNTOS.creados[0] if CAPA_PUNTOS.creados else {}
t('devuelve un fid y ningun motivo', fid is not None and motivo is None)
t('marca el ambito de la Junta, o el activo existe y nadie lo ve',
  fila.get('ambito') == 'JURP')
t('deja la campania del alta, que es lo que separa lo nuevo de lo que ya estaba',
  fila.get('campania_alta') == 2026)
t('anota de donde salio', fila.get('fuente') == 'alta de campo 2026')
t('copia los atributos que la capa tiene', fila.get('margen') == 'D'
  and fila.get('material') == 'concreto')
t('ignora el atributo que la capa no tiene, en vez de reventar',
  'inventado' not in fila)
t('envuelve el punto en MultiPoint cuando la capa es de multipuntos',
  isinstance(fila.get('geom'), tuple) and fila['geom'][0] == 'multipoint')

print('2. Capa de punto simple: no se envuelve')
CAPA_PUNTO_SIMPLE.creados = []
promover(alta(tipo='hito'), 'cherrera')
t('el punto va tal cual', isinstance(CAPA_PUNTO_SIMPLE.creados[0]['geom'], Punto))

print('3. Capa de trazados: se niega, no inventa')
CAPA_TRAZADO.creados = []
fid, motivo = promover(alta(tipo='canal_madre'), 'cherrera')
t('no promueve', fid is None)
t('explica por que', motivo and 'trazados' in motivo)
t('y no escribe nada', CAPA_TRAZADO.creados == [])

print('4. Tipo sin capa')
fid, motivo = promover(alta(tipo='lo_que_sea'), 'cherrera')
t('no promueve', fid is None and motivo is not None)

print('5. La accion de validar')


class Peticion(object):
    def __init__(self, data):
        self.data = data


class Vista(object):
    def __init__(self, a):
        self._a = a

    def get_object(self):
        return self._a


r = validar(Vista(alta()), Peticion({'validacion': 'lo que sea'}))
t('rechaza un estado que no existe', r.status_code == 400)

CAPA_PUNTOS.creados = []
a = alta()
r = validar(Vista(a), Peticion({'validacion': 'aprobado', 'validado_por': 'cherrera'}))
t('aprobar promueve', len(CAPA_PUNTOS.creados) == 1)
t('y guarda el fid en el alta', a.promovido_fid is not None)
t('deja quien valido', a.validado_por == 'cherrera')

CAPA_PUNTOS.creados = []
r = validar(Vista(alta(validacion='aprobado', fid=1001)),
            Peticion({'validacion': 'aprobado'}))
t('aprobar dos veces no duplica el activo', len(CAPA_PUNTOS.creados) == 0)
t('y lo dice con un 409', r.status_code == 409)

CAPA_PUNTOS.creados = []
a = alta()
r = validar(Vista(a), Peticion({'validacion': 'rechazado', 'nota': 'duplicada'}))
t('rechazar no toca ninguna capa', len(CAPA_PUNTOS.creados) == 0)
t('pero anota el motivo', a.nota_validacion == 'duplicada')

print('6. El bloque compila y se cuelga de la clase')
t('la accion queda en el ViewSet', hasattr(ViewSetFalso, 'validar'))

# Lo que de verdad se nos escapó la primera vez. Al construir las rutas, DRF
# recorre la clase y comprueba con un assert que cada acción se llame igual
# que el atributo donde está colgada:
#
#     def _check_attr_name(func, name):
#         assert func.__name__ == name, ...
#
# Con la función llamándose _validar_alta y el atributo validar, ese assert
# salta al importar urls.py y se cae el URLconf ENTERO: toda la API devuelve
# 500, no solo esta acción, y el error no menciona ni el nombre ni la acción.
for nombre, metodo in list(vars(ViewSetFalso).items()):
    if callable(metodo) and getattr(metodo, '_kw', None):
        t('la accion "{0}" se llama igual que su atributo, o DRF tumba el '
          'URLconf entero'.format(nombre), metodo.__name__ == nombre)

print('\n{0} comprobacion(es) en orden{1}.'.format(
    bien, ', {0} MAL'.format(mal) if mal else ''))
sys.exit(1 if mal else 0)
