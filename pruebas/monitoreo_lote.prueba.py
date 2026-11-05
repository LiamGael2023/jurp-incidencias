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

import datetime
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
    HTTP_207_MULTI_STATUS = 207
    HTTP_409_CONFLICT = 409


def sin_decorar(*a, **k):
    def envoltura(fn):
        return fn
    return envoltura


class Reparto(object):
    """El reparto vigente de un tramo, al margen de la ronda."""
    _reg = {}

    def __init__(self, tramo):
        self.tramo = tramo
        self._usuarios = []
        self.usuarios = Coleccion(self._usuarios)
        Reparto._reg[tramo] = self


class GestorReparto(object):
    def all(self):
        return list(Reparto._reg.values())

    def get_or_create(self, tramo=None, **kw):
        t = tramo if tramo is not None else kw.get('tramo')
        if t in Reparto._reg:
            return Reparto._reg[t], False
        return Reparto(t), True


class Responsable(object):
    """Una fila del cuadro de JURP: tramo, empresa y coordinador."""
    _todos = []

    def __init__(self, tramo, empresa, coordinador):
        self.tramo = tramo
        self.empresa = empresa
        self.coordinador = coordinador
        self.celular = ''
        self.activo = True
        Responsable._todos.append(self)


class Usuario(object):
    _n = 0
    _reg = {}

    def __init__(self, nombre, gerencia=False):
        Usuario._n += 1
        self.pk = self.id = Usuario._n
        Usuario._reg[self.pk] = self
        self.username = nombre
        self.first_name = nombre
        self.last_name = ''
        self.email = nombre + '@jurp.pe'
        self.es_gerencia = gerencia

    def __str__(self):
        return self.username


class Visita(object):
    _n = 0
    _todas = []

    def __init__(self, **kw):
        Visita._n += 1
        self.id = self.pk = Visita._n
        self.numero = kw.get('numero')
        self.tramo_rutina = kw.get('tramo_rutina')
        self.tramo_rutina_id = getattr(self.tramo_rutina, 'pk', None)
        self.tramo = kw.get('tramo', '')
        self.usuario = kw.get('usuario')
        self.tipo_elemento = kw.get('tipo_elemento', 'tramo')
        self.elemento = kw.get('elemento', '')
        self.sin_novedad = kw.get('sin_novedad', True)
        self.observacion = kw.get('observacion', '')
        self.latitude = kw.get('latitude')
        self.longitude = kw.get('longitude')
        self.incidente = kw.get('incidente')
        self.incidente_id = getattr(self.incidente, 'id', None)
        # Fecha de verdad: la numeracion agrupa por ano y el codigo lleva
        # el dia dentro, asi que una cadena no sirve para medir esto.
        self.creada_en = datetime.datetime(2026, 11, 4, 10, 0, 0)
        Visita._todas.append(self)

    def save(self, update_fields=None):
        pass


class Coleccion(object):
    """Lo poquito del ORM que usa el codigo: all, filter, exists, values_list."""

    def __init__(self, filas):
        self._filas = filas

    def all(self):
        return list(self._filas)

    def exists(self):
        return bool(self._filas)

    def filter(self, **kw):
        fuera = list(self._filas)
        for clave, valor in kw.items():
            fuera = [f for f in fuera if getattr(f, clave, None) == valor]
        return Coleccion(fuera)

    def exclude(self, **kw):
        if 'elemento' in kw:
            return Coleccion([f for f in self._filas
                              if f.elemento != kw['elemento']])
        return Coleccion(list(self._filas))

    def values_list(self, campo, flat=False):
        return [getattr(f, campo) for f in self._filas]

    def select_related(self, *a):
        return self

    def count(self):
        return len(self._filas)

    def add(self, *cosas):
        # El ORM admite objetos o pks; el codigo de verdad pasa pks al
        # heredar el reparto, asi que aqui hay que resolverlos.
        for c in cosas:
            self._filas.append(Usuario._reg[c] if isinstance(c, int) else c)

    def clear(self):
        del self._filas[:]

    def __iter__(self):
        return iter(self._filas)

    def __len__(self):
        return len(self._filas)


class Rutina(object):
    _n = 0
    _reg = {}

    def __init__(self, cerrada=False, empezada=True):
        Rutina._n += 1
        self.id = self.pk = Rutina._n
        Rutina._reg[self.pk] = self
        self.nombre = 'Noviembre 2026'
        self.fecha_inicio = '2026-11-01'
        self.fecha_fin = '2026-11-30'
        self.notas = ''
        self.cerrada = cerrada
        self.empezada = empezada
        self.creada_por = None
        self.creada_en = '2026-11-01T08:00:00Z'
        self._tramos = []
        self.tramos = Coleccion(self._tramos)
        self.borrada = False

    def refresh_from_db(self):
        # En la base releer convierte las cadenas en fechas; aqui no hay
        # nada que convertir.
        pass

    def delete(self):
        # En la base se van en cascada; aqui basta con dejar constancia.
        self.borrada = True
        Rutina._reg.pop(self.pk, None)
        for t in list(self._tramos):
            Tramo._reg.pop(t.pk, None)

    def vigente(self):
        return not self.cerrada and self.empezada


def _crear_tramo(**kw):
    return Tramo(kw['tramo'], kw['rutina'], [])


def _crear_rutina(**kw):
    r = Rutina()
    r.nombre = kw.get('nombre') or r.nombre
    r.fecha_inicio = kw.get('fecha_inicio') or r.fecha_inicio
    r.fecha_fin = kw.get('fecha_fin') or r.fecha_fin
    r.notas = kw.get('notas') or ''
    r.creada_por = kw.get('creada_por')
    return r


class Tramo(object):
    """Un tramo de una rutina."""
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
        rutina._tramos.append(self)

    def save(self, update_fields=None):
        pass


class GestorVisitas(object):
    """Lo poco del ORM que usa _numerar: select_for_update, filter por ano,
    order_by y first. Sin esto no se puede medir la numeracion, que es
    justo lo que no puede salir mal en un codigo."""

    def __init__(self, filas=None):
        self._filas = filas

    @property
    def filas(self):
        return Visita._todas if self._filas is None else self._filas

    def select_for_update(self):
        return self

    def filter(self, **kw):
        fuera = list(self.filas)
        if kw.get('numero__isnull') is False:
            fuera = [f for f in fuera if f.numero is not None]
        if 'creada_en__year' in kw:
            fuera = [f for f in fuera
                     if f.creada_en and f.creada_en.year == kw['creada_en__year']]
        if 'sin_novedad' in kw:
            fuera = [f for f in fuera if f.sin_novedad == kw['sin_novedad']]
        return GestorVisitas(fuera)

    def order_by(self, campo):
        rev = campo.startswith('-')
        clave = campo.lstrip('-')
        return GestorVisitas(sorted(self.filas,
                                    key=lambda f: getattr(f, clave) or 0,
                                    reverse=rev))

    def first(self):
        return self.filas[0] if self.filas else None

    def create(self, **kw):
        v = Visita(**kw)
        # Una visita extraordinaria no cuelga de ninguna ronda.
        tr = kw.get('tramo_rutina')
        if tr is not None:
            tr._visitas.append(v)
        return v


class SinTransaccion(object):
    def atomic(self):
        return self

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class Gestor(object):
    def __init__(self, registro, crear=None, filas=None):
        self._reg = registro
        self._crear = crear
        self._filas = filas

    @property
    def filas(self):
        return list(self._reg.values()) if self._filas is None else self._filas

    def select_related(self, *a):
        return self

    def exclude(self, **kw):
        pk = kw.get('pk')
        return Gestor(self._reg, self._crear,
                      [f for f in self.filas if f.pk != pk])

    def order_by(self, *campos):
        fuera = list(self.filas)
        for campo in reversed(campos):
            rev = campo.startswith('-')
            clave = campo.lstrip('-')
            fuera.sort(key=lambda f: getattr(f, clave) or 0, reverse=rev)
        return Gestor(self._reg, self._crear, fuera)

    def all(self):
        return self

    def __iter__(self):
        return iter(self.filas)

    def __getitem__(self, corte):
        return self.filas[corte]

    def filter(self, **kw):
        fuera = list(self.filas)
        for clave, valor in kw.items():
            if clave == 'usuarios':
                fuera = [f for f in fuera
                         if valor in list(getattr(f, 'usuarios', []))]
            elif '__' in clave:
                # rutina__cerrada, rutina__fecha_inicio__lte: para la
                # prueba basta con no descartar nada por estas.
                continue
            else:
                fuera = [f for f in fuera if getattr(f, clave, None) == valor]
        return Gestor(self._reg, self._crear, fuera)

    def first(self):
        f = self.filas
        return f[0] if f else None

    def get(self, pk=None, **kw):
        if pk is not None or 'pk' in kw:
            clave = pk if pk is not None else kw['pk']
            if clave not in self._reg:
                raise NoExiste()
            return self._reg[clave]
        # Por otros campos: asignar() busca el tramo por (rutina, tramo).
        fuera = list(self.filas)
        for clave, valor in kw.items():
            fuera = [f for f in fuera if getattr(f, clave, None) == valor]
        if not fuera:
            raise NoExiste()
        return fuera[0]

    def create(self, **kw):
        if self._crear is not None:
            return self._crear(**kw)
        v = Visita(**kw)
        kw['tramo_rutina']._visitas.append(v)
        return v


class NoExiste(Exception):
    pass


def _plantar_django_falso():
    """Un django minimo en sys.modules, para los imports de dentro.

    Algunas funciones importan django DENTRO del cuerpo
    -`from django.contrib.auth import get_user_model`-, y eso no lo quita
    el recorte de imports de arriba, que solo mira la columna cero. Sin
    esto no se puede medir ni `asignar` ni nada que resuelva usuarios.
    """
    import types
    if 'django.contrib.auth' in sys.modules:
        return

    class GestorUsuarios(object):
        def get(self, pk=None, **kw):
            if pk is None:
                pk = kw.get('pk')
            if pk not in Usuario._reg:
                raise NoExiste()
            return Usuario._reg[pk]

        def filter(self, **kw):
            return Coleccion(list(Usuario._reg.values()))

    UsuarioFalso = type('U', (), {'objects': GestorUsuarios(),
                                  'DoesNotExist': NoExiste})

    django = types.ModuleType('django')
    contrib = types.ModuleType('django.contrib')
    auth = types.ModuleType('django.contrib.auth')
    auth.get_user_model = lambda: UsuarioFalso
    contrib.auth = auth
    django.contrib = contrib
    sys.modules['django'] = django
    sys.modules['django.contrib'] = contrib
    sys.modules['django.contrib.auth'] = auth


def cargar_modulo():
    """Ejecuta el monitoreo.py que escribe el parche, con el andamio puesto."""
    aqui = os.path.dirname(os.path.abspath(__file__))
    spec = importlib.util.spec_from_file_location(
        'parche', os.path.join(aqui, 'parche_monitoreo_rutinario.py'))
    parche = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(parche)

    _plantar_django_falso()
    fuente = parche.MODULO
    # Fuera los imports de Django y del proyecto: el resto es el codigo que
    # se quiere medir, intacto.
    fuente = re.sub(r'(?m)^(from|import) (django|rest_framework|\.).*\n(\s+.*\n)*',
                    '', fuente)

    ns = {
        're': re,
        # timezone.now() se usa al crear tramos y al numerar; localtime
        # solo tiene que devolver algo con .date() y .year.
        'timezone': type('TZ', (), {
            'now': staticmethod(lambda: datetime.datetime(2026, 11, 4, 10, 0)),
            'localtime': staticmethod(lambda f=None: f or datetime.datetime(
                2026, 11, 4, 10, 0)),
        }),
        'status': Estados,
        'api_view': sin_decorar,
        'permission_classes': sin_decorar,
        'Response': Respuesta,
        'ResponsableTramo': type('RT', (), {
            'objects': Coleccion(Responsable._todos)}),
        'RepartoDeTramo': type('RDT', (), {'objects': GestorReparto()}),
        'RutinaMonitoreo': type('R', (), {
            'objects': Gestor(Rutina._reg, crear=_crear_rutina),
            'DoesNotExist': NoExiste}),
        # DoesNotExist tiene que estar: el codigo lo captura por nombre, y
        # sin el la excepcion sube tal cual en vez de volverse un 404.
        'TramoDeRutina': type('M', (), {
            'objects': Gestor(Tramo._reg, crear=_crear_tramo),
            'DoesNotExist': NoExiste}),
        'Usuario': type('U', (), {'objects': Gestor(Usuario._reg),
                                  'DoesNotExist': NoExiste}),
        'transaction': SinTransaccion(),
        'VisitaMonitoreo': type('V', (), {
            'objects': GestorVisitas(),
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
    ns['_cuentas_moviles'] = lambda: [
        (u, set(ns['_normaliza'](u.first_name or u.username).split()))
        for u in Usuario._reg.values()]
    ns['_es_gerencia'] = lambda u: getattr(u, 'es_gerencia', False)
    ns['_celulares'] = lambda: {}
    ns['_contactos'] = lambda t: []
    ns['_persona'] = lambda u, tels=None: (
        {'id': u.id, 'nombre': u.username} if u else None)
    return ns


class Peticion(object):
    def __init__(self, usuario, datos, consulta=None, metodo='POST'):
        self.user = usuario
        self.data = datos
        self.GET = consulta or {}
        self.method = metodo


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


def escenario(cerrada=False, empezada=True):
    Tramo._reg.clear()
    Rutina._reg.clear()
    Usuario._reg.clear()
    Responsable._todos[:] = []
    Reparto._reg.clear()
    Visita._n = 0
    Visita._todas = []
    mon = cargar_modulo()
    ilich = Usuario('ilich')
    otro = Usuario('otro')
    jefe = Usuario('gerencia', gerencia=True)
    tr = Tramo('II', Rutina(cerrada=cerrada, empezada=empezada), [ilich])
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


def prueba_numeracion():
    print('\n11. la numeracion propia del hallazgo')
    mon, tr, ilich, _, _ = escenario()
    codigos = []
    for i in (3, 7, 11):
        r = mon['visitas'](Peticion(ilich, {
            'tramo_rutina': tr.pk, 'elemento': SUBTRAMOS[i],
            'sin_novedad': False, 'observacion': 'algo'}))
        codigos.append((r.data['visita']['numero'], r.data['visita']['codigo']))
    igual('correlativos seguidos', [n for n, c in codigos], [1, 2, 3])
    igual('formato del codigo', codigos[0][1], 'HALLAZGO-001-04112026')
    igual('y el tercero', codigos[2][1], 'HALLAZGO-003-04112026')

    # Lo que se cierra sin novedad NO entra en la serie: si entrara, el
    # primer hallazgo del tramo 0 seria el numero 180.
    r = mon['visitas_lote'](Peticion(ilich, {
        'tramo_rutina': tr.pk, 'elementos': SUBTRAMOS}))
    igual('el masivo no numera',
          [v['numero'] for v in r.data['visitas']],
          [None] * len(r.data['visitas']))
    igual('ni les pone codigo',
          sorted(set(v['codigo'] for v in r.data['visitas'])), [''])

    # Y el que viene despues sigue por donde iba la serie, no por el id.
    r = mon['visitas'](Peticion(ilich, {
        'tramo_rutina': tr.pk, 'elemento': 'Entrega  E99',
        'sin_novedad': False, 'observacion': 'posterior al masivo'}))
    igual('sigue la serie', r.data['visita']['numero'], 4)


def prueba_hallazgo_por_lote_numerado():
    print('\n12. un hallazgo que entra por el lote tambien se numera')
    mon, tr, ilich, _, _ = escenario()
    r = mon['visitas_lote'](Peticion(ilich, {
        'tramo_rutina': tr.pk,
        'elementos': [
            {'elemento': 'Entrega  E12', 'sin_novedad': False,
             'observacion': 'tapada'},
            'Entrega  E13',
        ]}))
    igual('status', r.status_code, 201)
    porClave = {v['elemento']: v for v in r.data['visitas']}
    igual('el hallazgo lleva numero', porClave['Entrega  E12']['numero'], 1)
    igual('y codigo', porClave['Entrega  E12']['codigo'],
          'HALLAZGO-001-04112026')
    igual('el otro no', porClave['Entrega  E13']['numero'], None)


def prueba_topic():
    print('\n13. el topic personal de cada usuario')
    mon, tr, ilich, _, _ = escenario()
    igual('normal', mon['topic_de'](ilich), 'user_%d_ilich' % ilich.pk)

    correo = Usuario('Luis.Rodriguez@hassperu.com')
    t = mon['topic_de'](correo)
    # FCM solo admite [a-zA-Z0-9-_.~%]: la arroba tiene que desaparecer o el
    # envio se rechaza y el aviso no llega sin que nadie se entere.
    igual('sin arroba', '@' in t, False)
    igual('en minusculas', t, 'user_%d_luis.rodriguez_hassperu.com' % correo.pk)
    igual('lleva el id delante', t.startswith('user_%d_' % correo.pk), True)
    igual('sin usuario', mon['topic_de'](None), '')


def prueba_aviso():
    print('\n14. el aviso de una rutina nueva')
    mon, tr, ilich, otro, _ = escenario()
    enviados = []
    mon['_mandar_push'] = lambda payload: (enviados.append(payload), True)[1]

    rutina = tr.rutina
    n = mon['avisar_de_rutina'](rutina, {ilich: ['II'], otro: ['V', 'IX']})
    igual('uno por persona, no por tramo', n, 2)
    igual('mandados', len(enviados), 2)

    porTopic = {p['topic']: p for p in enviados}
    uno = porTopic['user_%d_ilich' % ilich.pk]
    igual('titulo', uno['title'], 'Tienes un nuevo Monitoreo Rutinario')
    igual('un tramo, en singular', uno['body'], 'Tramo II - Noviembre 2026')
    igual('entity_type', uno['data']['entity_type'], 'monitoreo_rutina')

    dos = porTopic['user_%d_otro' % otro.pk]
    igual('dos tramos, en plural', dos['body'], 'Tramos V, IX - Noviembre 2026')

    # Nadie sin tramos, y nadie sin topic: mandar a '' seria un envio que el
    # servicio acepta y nadie recibe.
    enviados[:] = []
    igual('sin tramos no se avisa',
          mon['avisar_de_rutina'](rutina, {ilich: []}), 0)
    igual('no se mando nada', len(enviados), 0)


def prueba_sin_empezar():
    print('\n15. una rutina que todavia no empieza')
    # La app ya las ENSEÑA -si no, el aviso llevaria a una pantalla donde la
    # rutina no esta-, asi que el "no" tiene que estar aqui: un recorrido
    # hecho el dia antes dejaria la ronda siguiente naciendo ya recorrida.
    mon, tr, ilich, _, _ = escenario(empezada=False)
    r = mon['visitas'](Peticion(ilich, {
        'tramo_rutina': tr.pk, 'sin_novedad': True}))
    igual('la visita suelta se rechaza', r.status_code, 400)
    igual('y lo dice', 'no empieza' in r.data['detail'], True)

    r = mon['visitas_lote'](Peticion(ilich, {
        'tramo_rutina': tr.pk, 'elementos': OBRAS}))
    igual('el lote tambien', r.status_code, 400)
    igual('no escribio nada', len(tr._visitas), 0)

    # Y cuando empieza, lo de siempre.
    mon, tr, ilich, _, _ = escenario()
    r = mon['visitas_lote'](Peticion(ilich, {
        'tramo_rutina': tr.pk, 'elementos': OBRAS}))
    igual('empezada, entra', r.status_code, 201)


def prueba_borrar():
    print('\n16. borrar una rutina')
    # Vacia: no se pierde nada, no hace falta confirmar.
    mon, tr, ilich, _, jefe = escenario()
    r = mon['rutina'](Peticion(jefe, {}, metodo='DELETE'), tr.rutina.pk)
    igual('vacia, se borra', r.status_code, 200)
    igual('dice cual', r.data['borrada'], 'Noviembre 2026')
    igual('y queda borrada', tr.rutina.borrada, True)

    # Con registros: se niega y DICE cuantos, para poder decidir antes.
    mon, tr, ilich, _, jefe = escenario()
    mon['visitas_lote'](Peticion(ilich, {
        'tramo_rutina': tr.pk, 'elementos': SUBTRAMOS}))
    mon['visitas'](Peticion(ilich, {
        'tramo_rutina': tr.pk, 'elemento': 'Entrega  E12',
        'sin_novedad': False, 'observacion': 'rota'}))

    r = mon['rutina'](Peticion(jefe, {}, metodo='DELETE'), tr.rutina.pk)
    igual('con registros, se niega', r.status_code, 409)
    igual('cuenta los registros', r.data['registros'], 26)
    igual('y los hallazgos', r.data['hallazgos'], 1)
    igual('no la borro', tr.rutina.borrada, False)

    # Confirmando, sí.
    r = mon['rutina'](Peticion(jefe, {'confirmar': 1}, metodo='DELETE'),
                      tr.rutina.pk)
    igual('confirmada, se borra', r.status_code, 200)
    igual('ahora si', tr.rutina.borrada, True)

    # Y por la query, que es como lo manda un DELETE sin cuerpo.
    mon, tr, ilich, _, jefe = escenario()
    mon['visitas_lote'](Peticion(ilich, {
        'tramo_rutina': tr.pk, 'elementos': OBRAS}))
    r = mon['rutina'](Peticion(jefe, {}, consulta={'confirmar': '1'},
                               metodo='DELETE'), tr.rutina.pk)
    igual('confirmar por la URL', r.status_code, 200)

    # Una que no existe.
    mon, tr, ilich, _, jefe = escenario()
    r = mon['rutina'](Peticion(jefe, {}, metodo='DELETE'), 9999)
    igual('la que no existe', r.status_code, 404)


def prueba_herencia():
    print('\n17. el reparto que se hereda al crear una rutina')
    Tramo._reg.clear(); Rutina._reg.clear(); Usuario._reg.clear()
    mon = cargar_modulo()
    jefe = Usuario('gerencia', gerencia=True)
    ana, beto, caro = Usuario('ana'), Usuario('beto'), Usuario('caro')

    # Ronda de hace dos meses: el reparto completo de siempre.
    vieja = Rutina()
    vieja.nombre, vieja.fecha_inicio = 'Septiembre', '2026-09-01'
    Tramo('0', vieja, [ana])
    Tramo('I', vieja, [beto])
    Tramo('II', vieja, [caro])

    # Y una ronda corta de prueba, mas reciente, con UN tramo puesto.
    corta = Rutina()
    corta.nombre, corta.fecha_inicio = 'prueba', '2026-10-01'
    Tramo('I', corta, [caro])          # el I cambio de manos
    for t in ('0', 'II'):
        Tramo(t, corta, [])            # estos nacieron vacios

    r = mon['rutinas'](Peticion(jefe, {
        'nombre': 'Noviembre', 'fecha_inicio': '2026-11-01',
        'fecha_fin': '2026-11-30', 'tramos': ['0', 'I', 'II']}))
    igual('se crea', r.status_code, 201)

    nueva = [x for x in Rutina._reg.values() if x.nombre == 'Noviembre'][0]
    quien = {}
    for t in nueva._tramos:
        quien[t.tramo] = sorted(u.username for u in t.usuarios.all())

    # LO QUE SE ROMPIA: la ronda corta solo tenia el I, y antes eso dejaba
    # el 0 y el II vacios aunque llevaran meses asignados.
    igual('el 0 viene de la ronda vieja', quien['0'], ['ana'])
    igual('el II tambien', quien['II'], ['caro'])
    # Y el I se queda con el cambio mas reciente, no con el de hace meses.
    igual('el I, con el cambio reciente', quien['I'], ['caro'])


def prueba_cuadro():
    print('\n18. sin ninguna ronda anterior, tira del cuadro')
    Tramo._reg.clear(); Rutina._reg.clear(); Usuario._reg.clear()
    Responsable._todos[:] = []
    mon = cargar_modulo()
    jefe = Usuario('gerencia', gerencia=True)

    # Dos cuentas con nombre completo, como en el padron.
    emilio = Usuario('ealvarez'); emilio.first_name = 'Emilio Alvarez'
    frank = Usuario('frodriguez'); frank.first_name = 'Frank Rodriguez'
    # Y un homonimo: dos cuentas para la misma persona del cuadro.
    jav1 = Usuario('jsilva'); jav1.first_name = 'Javier Silva Rosales'
    jav2 = Usuario('javier.silva'); jav2.first_name = 'Javier Silva Rosales'

    Responsable('0', 'AVO PERU', 'EMILIO ALVAREZ')
    Responsable('I', 'CAMPOSOL', 'FRANK RODRIGUEZ')
    Responsable('II', 'CAMPOSOL', 'JAVIER SILVA ROSALES')   # dos cuentas
    Responsable('III', 'VIRU S.A.', 'ALGUIEN SIN CUENTA')

    r = mon['rutinas'](Peticion(jefe, {
        'nombre': 'La primera', 'fecha_inicio': '2026-11-01',
        'fecha_fin': '2026-11-30', 'tramos': ['0', 'I', 'II', 'III']}))
    igual('se crea', r.status_code, 201)
    igual('nada heredado', r.data['heredados'], 0)
    igual('dos del cuadro', r.data['del_cuadro'], 2)

    nueva = [x for x in Rutina._reg.values() if x.nombre == 'La primera'][0]
    quien = {t.tramo: sorted(u.username for u in t.usuarios.all())
             for t in nueva._tramos}
    igual('el 0, de su coordinador', quien['0'], ['ealvarez'])
    igual('el I tambien', quien['I'], ['frodriguez'])
    # LO QUE NO SE HACE: con dos cuentas para el mismo nombre no se elige
    # una, porque elegir mal pone a alguien a responder por un tramo ajeno
    # y ademas le manda el aviso.
    igual('con dos cuentas, vacio', quien['II'], [])
    igual('sin cuenta, vacio', quien['III'], [])


def prueba_reparto_sobrevive():
    print('\n19. el reparto sobrevive al borrado de su rutina')
    Tramo._reg.clear(); Rutina._reg.clear(); Usuario._reg.clear()
    Responsable._todos[:] = []; Reparto._reg.clear()
    mon = cargar_modulo()
    jefe = Usuario('gerencia', gerencia=True)
    cesar = Usuario('cherrera'); cesar.first_name = 'Cesar Herrera'

    r1 = mon['rutinas'](Peticion(jefe, {
        'nombre': 'Primera', 'fecha_inicio': '2026-11-01',
        'fecha_fin': '2026-11-30', 'tramos': ['IV']}))
    igual('se crea', r1.status_code, 201)
    rut = [x for x in Rutina._reg.values() if x.nombre == 'Primera'][0]

    r2 = mon['asignar'](Peticion(jefe, {
        'asignaciones': [{'tramo': 'IV', 'usuarios': [cesar.pk]}]}), rut.pk)
    igual('se asigna', r2.status_code, 200)
    igual('queda en el reparto vigente',
          [u.username for u in Reparto._reg['IV'].usuarios.all()], ['cherrera'])

    r3 = mon['rutina'](Peticion(jefe, {'confirmar': 1}, metodo='DELETE'),
                       rut.pk)
    igual('se borra la rutina', r3.status_code, 200)
    igual('y no queda ninguna', len(Rutina._reg), 0)

    # LO QUE SE ROMPIA: la siguiente nacia vacia, porque la decision se
    # habia ido con la ronda.
    r4 = mon['rutinas'](Peticion(jefe, {
        'nombre': 'Segunda', 'fecha_inicio': '2026-12-01',
        'fecha_fin': '2026-12-31', 'tramos': ['IV']}))
    igual('se crea la siguiente', r4.status_code, 201)
    nueva = [x for x in Rutina._reg.values() if x.nombre == 'Segunda'][0]
    quien = {t.tramo: sorted(u.username for u in t.usuarios.all())
             for t in nueva._tramos}
    igual('Cesar sigue en el IV', quien['IV'], ['cherrera'])
    igual('contado como heredado', r4.data['heredados'], 1)


def prueba_extraordinaria():
    print('\n20. un hallazgo sin rutina abierta')
    mon, tr, ilich, otro, _ = escenario()

    # El tramo IX no es de nadie en ninguna ronda: se puede registrar.
    r = mon['visitas'](Peticion(ilich, {
        'tramo': 'IX', 'elemento': 'Entrega  E40', 'sin_novedad': False,
        'observacion': 'talud caido', 'incidente': None}))
    igual('se registra', r.status_code, 201)
    igual('queda en su tramo', r.data['visita']['tramo'], 'IX')
    igual('marcada como extraordinaria',
          r.data['visita']['extraordinaria'], True)
    igual('y se numera', r.data['visita']['numero'], 1)
    igual('sin ronda que devolver', r.data['tramo'], None)

    # Un tramo que no existe no cuela.
    r = mon['visitas'](Peticion(ilich, {
        'tramo': 'XXV', 'elemento': 'algo', 'sin_novedad': False}))
    igual('tramo inventado', r.status_code, 400)

    # Y SI ESE TRAMO SI LE TOCA EN UNA RONDA ABIERTA, se le manda al
    # recorrido: con los dos caminos abiertos, lo del Tramo II apareceria
    # unas veces dentro de la ronda y otras fuera.
    r = mon['visitas'](Peticion(ilich, {
        'tramo': 'II', 'elemento': 'Canoa C2D', 'sin_novedad': False,
        'observacion': 'algo'}))
    igual('el tramo que le toca se rechaza', r.status_code, 409)
    igual('y le dice cual es su recorrido',
          r.data['tramo_rutina'], tr.pk)

    # A otra persona, ese mismo tramo no le toca: puede.
    r = mon['visitas'](Peticion(otro, {
        'tramo': 'II', 'elemento': 'Canoa C2D', 'sin_novedad': False,
        'observacion': 'algo'}))
    igual('a quien no le toca, si', r.status_code, 201)


def main():
    print('Registro por elemento dentro del tramo')
    print('=' * 74)
    for fn in [prueba_masivo_limpio, prueba_doble_pulsacion,
               prueba_no_pisa_hallazgo, prueba_repetidos_del_kmz,
               prueba_segunda_pasada, prueba_hallazgo_mudo_en_lote,
               prueba_permisos, prueba_cuerpos_raros,
               prueba_compatibilidad, prueba_nombre_largo,
               prueba_numeracion, prueba_hallazgo_por_lote_numerado,
               prueba_topic, prueba_aviso, prueba_sin_empezar,
               prueba_borrar, prueba_herencia, prueba_cuadro,
               prueba_reparto_sobrevive, prueba_extraordinaria]:
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
