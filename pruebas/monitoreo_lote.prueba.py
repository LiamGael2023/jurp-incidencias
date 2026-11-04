# -*- coding: utf-8 -*-
"""Prueba del registro por elemento, sin Django.

POR QUE ASI
-----------
Las dos veces que supuse donde estaba un fallo me equivoque, y las dos veces
lo encontro una medicion. Aqui se ejecuta el codigo DE VERDAD -el texto que
el parche va a escribir en monitoreo.py- contra modelos de mentira, asi que
lo que pasa la prueba es lo que va a correr en el servidor, no una copia
parecida que se desincroniza al primer cambio.

Lo que comprueba, que es lo que puede salir mal de verdad:

  1. El masivo NO duplica. Doble pulsacion, reintento por timeout: la
     segunda vez no escribe nada.
  2. El masivo NO PISA UN HALLAZGO. Es el orden natural del recorrido
     -se anota lo que se encuentra y al final se cierra el resto-, y si lo
     pisara borraria justo lo que se fue a buscar.
  3. Los nombres repetidos dentro de la misma lista cuentan una vez. El KMZ
     los tiene.
  4. El avance se cuenta por elemento distinto, no por filas: 25 de 25, no
     26 de 25.
  5. El tipo se deduce del nombre del KMZ cuando el telefono no lo manda.
  6. Una rutina cerrada, o un tramo de otro, no dejan registrar.

    python3 monitoreo_lote.prueba.py
"""
from __future__ import print_function

import importlib.util
import os
import re
import sys


# ══════════════════════════════════════════════════════════════════════════
# el andamio: lo justo para que el modulo de verdad se pueda ejecutar
# ══════════════════════════════════════════════════════════════════════════

class Respuesta(object):
    def __init__(self, datos, status=200):
        self.data = datos
        self.status_code = status

    def __repr__(self):
        return '<%s %s>' % (self.status_code, self.data.get('detail', 'ok'))


class Estados(object):
    HTTP_200_OK = 200
    HTTP_201_CREATED = 201
    HTTP_400_BAD_REQUEST = 400
    HTTP_403_FORBIDDEN = 403
    HTTP_404_NOT_FOUND = 404


def sin_decorar(*a, **k):
    def envoltura(fn):
        return fn
    return envoltura


class Usuario(object):
    _n = 0

    def __init__(self, nombre, gerencia=False):
        Usuario._n += 1
        self.pk = self.id = Usuario._n
        self.username = nombre
        self.first_name = nombre
        self.last_name = ''
        self.email = nombre + '@jurp.pe'
        self.es_gerencia = gerencia

    def __str__(self):
        return self.username


class Visita(object):
    _n = 0

    def __init__(self, **kw):
        Visita._n += 1
        self.id = self.pk = Visita._n
        self.tramo_rutina = kw.get('tramo_rutina')
        self.usuario = kw.get('usuario')
        self.tipo_elemento = kw.get('tipo_elemento', 'tramo')
        self.elemento = kw.get('elemento', '')
        self.sin_novedad = kw.get('sin_novedad', True)
        self.observacion = kw.get('observacion', '')
        self.latitude = kw.get('latitude')
        self.longitude = kw.get('longitude')
        self.incidente = kw.get('incidente')
        self.incidente_id = getattr(self.incidente, 'id', None)
        self.creada_en = '2026-11-04T10:00:00Z'


class Coleccion(object):
    """Lo poquito del ORM que usa el codigo: all, filter, exists, values_list."""

    def __init__(self, filas):
        self._filas = filas

    def all(self):
        return list(self._filas)

    def exists(self):
        return bool(self._filas)

    def filter(self, **kw):
        pk = kw.get('pk')
        return Coleccion([f for f in self._filas if getattr(f, 'pk', None) == pk])

    def exclude(self, **kw):
        if 'elemento' in kw:
            return Coleccion([f for f in self._filas
                              if f.elemento != kw['elemento']])
        return Coleccion(list(self._filas))

    def values_list(self, campo, flat=False):
        return [getattr(f, campo) for f in self._filas]

    def __iter__(self):
        return iter(self._filas)

    def __len__(self):
        return len(self._filas)


class Rutina(object):
    def __init__(self, cerrada=False):
        self.id = self.pk = 1
        self.nombre = 'Noviembre 2026'
        self.fecha_inicio = '2026-11-01'
        self.fecha_fin = '2026-11-30'
        self.notas = ''
        self.cerrada = cerrada
        self.creada_por = None
        self.creada_en = '2026-11-01T08:00:00Z'
        self.tramos = Coleccion([])

    def vigente(self):
        return not self.cerrada


class Tramo(object):
    _reg = {}

    def __init__(self, rotulo, rutina, usuarios):
        self.id = self.pk = len(Tramo._reg) + 1
        self.tramo = rotulo
        self.rutina = rutina
        self.rutina_id = rutina.id
        self.usuarios = Coleccion(usuarios)
        self.asignado_en = '2026-11-01T08:00:00Z'
        self._visitas = []
        self.visitas = Coleccion(self._visitas)
        Tramo._reg[self.pk] = self


class Gestor(object):
    def __init__(self, registro, clase=None):
        self._reg = registro
        self._clase = clase

    def select_related(self, *a):
        return self

    def get(self, pk=None, **kw):
        if pk is None:
            pk = kw.get('pk')
        if pk not in self._reg:
            raise NoExiste()
        return self._reg[pk]

    def create(self, **kw):
        v = Visita(**kw)
        tr = kw['tramo_rutina']
        tr._visitas.append(v)
        return v


class NoExiste(Exception):
    pass


def cargar_modulo():
    """Ejecuta el monitoreo.py que escribe el parche, con el andamio puesto."""
    aqui = os.path.dirname(os.path.abspath(__file__))
    spec = importlib.util.spec_from_file_location(
        'parche', os.path.join(aqui, 'parche_monitoreo_rutinario.py'))
    parche = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(parche)

    fuente = parche.MODULO
    # Fuera los imports de Django y del proyecto: el resto es el codigo que
    # se quiere medir, intacto.
    fuente = re.sub(r'(?m)^(from|import) (django|rest_framework|\.).*\n(\s+.*\n)*',
                    '', fuente)

    ns = {
        're': re,
        'timezone': None,
        'status': Estados,
        'api_view': sin_decorar,
        'permission_classes': sin_decorar,
        'Response': Respuesta,
        'ResponsableTramo': None,
        'RutinaMonitoreo': None,
        # DoesNotExist tiene que estar: el codigo lo captura por nombre, y
        # sin el la excepcion sube tal cual en vez de volverse un 404.
        'TramoDeRutina': type('M', (), {'objects': Gestor(Tramo._reg),
                                        'DoesNotExist': NoExiste}),
        'VisitaMonitoreo': type('V', (), {
            'objects': Gestor(Tramo._reg),
            'TRAMO': 'tramo', 'SUBTRAMO': 'subtramo', 'OBRA': 'obra'}),
        'TelefonoUsuario': None,
        'TRAMOS_CANAL': ('0', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII',
                         'VIII', 'IX', 'X', 'XI', 'XII', 'XIII'),
        'EsGerencia': None,
        'IsMobileRoleUser': None,
    }
    exec(compile(fuente, 'monitoreo.py', 'exec'), ns)

    # El andamio va DESPUES de ejecutar: asi se reemplazan solo las piezas
    # que hablan con la base de datos, y el codigo medido es el de verdad.
    ns['_es_gerencia'] = lambda u: getattr(u, 'es_gerencia', False)
    ns['_celulares'] = lambda: {}
    ns['_contactos'] = lambda t: []
    ns['_persona'] = lambda u, tels=None: (
        {'id': u.id, 'nombre': u.username} if u else None)
    return ns


class Peticion(object):
    def __init__(self, usuario, datos):
        self.user = usuario
        self.data = datos


# ══════════════════════════════════════════════════════════════════════════
# las pruebas
# ══════════════════════════════════════════════════════════════════════════

FALLOS = []


def igual(que, obtenido, esperado):
    marca = 'ok ' if obtenido == esperado else 'MAL'
    if obtenido != esperado:
        FALLOS.append(que)
    print('  [%s] %-52s %r%s' % (
        marca, que, obtenido,
        '' if obtenido == esperado else '   esperaba %r' % (esperado,)))


# Los 25 sub-tramos del Tramo II, con los nombres del KMZ.
SUBTRAMOS = ['TRAMO II %d+%03d - %d+%03d CANAL'
             % (5 + (i * 200) // 1000, (i * 200) % 1000,
                5 + ((i + 1) * 200) // 1000, ((i + 1) * 200) % 1000)
             for i in range(25)]
OBRAS = ['Entrega  E%d' % n for n in range(11, 16)]


def escenario(cerrada=False):
    Tramo._reg.clear()
    Visita._n = 0
    mon = cargar_modulo()
    ilich = Usuario('ilich')
    otro = Usuario('otro')
    jefe = Usuario('gerencia', gerencia=True)
    tr = Tramo('II', Rutina(cerrada=cerrada), [ilich])
    return mon, tr, ilich, otro, jefe


def prueba_masivo_limpio():
    print('\n1. el masivo escribe una fila por elemento')
    mon, tr, ilich, _, _ = escenario()
    r = mon['visitas_lote'](Peticion(ilich, {
        'tramo_rutina': tr.pk, 'elementos': SUBTRAMOS + OBRAS}))
    igual('status', r.status_code, 201)
    igual('filas creadas', r.data['creadas'], 30)
    igual('elementos revisados', r.data['tramo']['elementos_revisados'], 30)
    igual('con hallazgo', r.data['tramo']['elementos_con_hallazgo'], 0)
    tipos = {}
    for v in tr._visitas:
        tipos[v.tipo_elemento] = tipos.get(v.tipo_elemento, 0) + 1
    igual('tipo deducido del nombre', tipos, {'subtramo': 25, 'obra': 5})


def prueba_doble_pulsacion():
    print('\n2. la segunda pulsacion no duplica nada')
    mon, tr, ilich, _, _ = escenario()
    mon['visitas_lote'](Peticion(ilich, {
        'tramo_rutina': tr.pk, 'elementos': SUBTRAMOS}))
    r = mon['visitas_lote'](Peticion(ilich, {
        'tramo_rutina': tr.pk, 'elementos': SUBTRAMOS}))
    igual('creadas la segunda vez', r.data['creadas'], 0)
    igual('omitidas', len(r.data['omitidas']), 25)
    igual('filas en total', len(tr._visitas), 25)
    igual('avance', r.data['tramo']['elementos_revisados'], 25)


def prueba_no_pisa_hallazgo():
    print('\n3. el masivo no pisa el hallazgo que ya estaba')
    mon, tr, ilich, _, _ = escenario()
    sospechoso = SUBTRAMOS[7]
    # Primero el hallazgo, elemento por elemento, como en el canal.
    r1 = mon['visitas'](Peticion(ilich, {
        'tramo_rutina': tr.pk, 'elemento': sospechoso,
        'sin_novedad': False, 'observacion': 'talud socavado'}))
    igual('el hallazgo entra', r1.status_code, 201)
    igual('queda con novedad', r1.data['visita']['sin_novedad'], False)
    # Y al terminar, el resto.
    r2 = mon['visitas_lote'](Peticion(ilich, {
        'tramo_rutina': tr.pk, 'elementos': SUBTRAMOS}))
    igual('creadas', r2.data['creadas'], 24)
    igual('omitido el del hallazgo', r2.data['omitidas'], [sospechoso])
    igual('revisados', r2.data['tramo']['elementos_revisados'], 25)
    igual('con hallazgo', r2.data['tramo']['elementos_con_hallazgo'], 1)
    filas = [v for v in tr._visitas if v.elemento == sospechoso]
    igual('una sola fila del sospechoso', len(filas), 1)
    igual('y sigue siendo el hallazgo', filas[0].observacion, 'talud socavado')


def prueba_repetidos_del_kmz():
    print('\n4. nombres repetidos dentro de la misma lista')
    mon, tr, ilich, _, _ = escenario()
    r = mon['visitas_lote'](Peticion(ilich, {
        'tramo_rutina': tr.pk,
        'elementos': ['Entrega  E12', 'Entrega  E12', 'Entrega  E13']}))
    igual('creadas', r.data['creadas'], 2)
    igual('omitidas', r.data['omitidas'], ['Entrega  E12'])


def prueba_segunda_pasada():
    print('\n5. volver y encontrar algo donde se dijo que no habia')
    mon, tr, ilich, _, _ = escenario()
    mon['visitas_lote'](Peticion(ilich, {
        'tramo_rutina': tr.pk, 'elementos': SUBTRAMOS}))
    r = mon['visitas'](Peticion(ilich, {
        'tramo_rutina': tr.pk, 'elemento': SUBTRAMOS[3],
        'sin_novedad': False, 'observacion': 'colmatado'}))
    igual('la segunda visita entra', r.status_code, 201)
    igual('dos filas de ese elemento',
          len([v for v in tr._visitas if v.elemento == SUBTRAMOS[3]]), 2)
    # El avance NO dice 26 de 25: se cuenta por elemento distinto.
    igual('revisados sigue en 25',
          r.data['tramo']['elementos_revisados'], 25)
    igual('y ahora uno con hallazgo',
          r.data['tramo']['elementos_con_hallazgo'], 1)


def prueba_hallazgo_mudo_en_lote():
    print('\n6. un hallazgo sin nada que lo cuente, en el lote, se rechaza')
    mon, tr, ilich, _, _ = escenario()
    r = mon['visitas_lote'](Peticion(ilich, {
        'tramo_rutina': tr.pk,
        'elementos': [{'elemento': 'Entrega  E12', 'sin_novedad': False}]}))
    igual('status', r.status_code, 400)
    igual('nombra el elemento', 'E12' in r.data['detail'], True)
    igual('no escribio nada', len(tr._visitas), 0)


def prueba_permisos():
    print('\n7. rutina cerrada, tramo de otro, tramo que no existe')
    mon, tr, ilich, otro, jefe = escenario()
    r = mon['visitas_lote'](Peticion(otro, {
        'tramo_rutina': tr.pk, 'elementos': OBRAS}))
    igual('tramo de otro', r.status_code, 403)
    r = mon['visitas_lote'](Peticion(jefe, {
        'tramo_rutina': tr.pk, 'elementos': OBRAS}))
    igual('gerencia si puede', r.status_code, 201)
    r = mon['visitas_lote'](Peticion(ilich, {
        'tramo_rutina': 999, 'elementos': OBRAS}))
    igual('tramo inexistente', r.status_code, 404)

    mon, tr, ilich, _, _ = escenario(cerrada=True)
    r = mon['visitas_lote'](Peticion(ilich, {
        'tramo_rutina': tr.pk, 'elementos': OBRAS}))
    igual('rutina cerrada', r.status_code, 400)
    igual('no escribio nada', len(tr._visitas), 0)


def prueba_cuerpos_raros():
    print('\n8. cuerpos mal formados')
    mon, tr, ilich, _, _ = escenario()
    for que, cuerpo, esperado in [
            ('sin lista', {'tramo_rutina': tr.pk}, 400),
            ('lista vacia', {'tramo_rutina': tr.pk, 'elementos': []}, 400),
            ('no es lista', {'tramo_rutina': tr.pk, 'elementos': 'E12'}, 400),
            ('nombres vacios',
             {'tramo_rutina': tr.pk, 'elementos': ['', '   ']}, 400),
            ('demasiados',
             {'tramo_rutina': tr.pk,
              'elementos': ['x%d' % i for i in range(401)]}, 400),
    ]:
        r = mon['visitas_lote'](Peticion(ilich, cuerpo))
        igual(que, r.status_code, esperado)
    igual('no escribio nada', len(tr._visitas), 0)


def prueba_compatibilidad():
    print('\n9. la app vieja, que no manda elemento, sigue funcionando')
    mon, tr, ilich, _, _ = escenario()
    r = mon['visitas'](Peticion(ilich, {
        'tramo_rutina': tr.pk, 'sin_novedad': True}))
    igual('status', r.status_code, 201)
    igual('elemento vacio', r.data['visita']['elemento'], '')
    igual('tipo tramo', r.data['visita']['tipo_elemento'], 'tramo')
    igual('recorrido', r.data['tramo']['recorrido'], True)
    # Y no cuenta como elemento revisado, porque no lo es.
    igual('revisados', r.data['tramo']['elementos_revisados'], 0)


def prueba_nombre_largo():
    print('\n10. un nombre mas largo que la columna')
    mon, tr, ilich, _, _ = escenario()
    largo = 'TRAMO II ' + 'x' * 400
    r = mon['visitas_lote'](Peticion(ilich, {
        'tramo_rutina': tr.pk, 'elementos': [largo]}))
    igual('status', r.status_code, 201)
    igual('recortado a 160', len(tr._visitas[0].elemento), 160)


def main():
    print('Registro por elemento dentro del tramo')
    print('=' * 74)
    for fn in [prueba_masivo_limpio, prueba_doble_pulsacion,
               prueba_no_pisa_hallazgo, prueba_repetidos_del_kmz,
               prueba_segunda_pasada, prueba_hallazgo_mudo_en_lote,
               prueba_permisos, prueba_cuerpos_raros,
               prueba_compatibilidad, prueba_nombre_largo]:
        fn()
    print('\n' + '=' * 74)
    if FALLOS:
        print('FALLAN %d:' % len(FALLOS))
        for f in FALLOS:
            print('  - %s' % f)
        sys.exit(1)
    print('Todo pasa.')


if __name__ == '__main__':
    main()
