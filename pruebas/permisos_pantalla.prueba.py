# -*- coding: utf-8 -*-
"""Mide los permisos por pantalla: la resolucion, el mapa y el middleware.

    python3 permisos_pantalla.prueba.py

Como funciona
-------------
Igual que monitoreo_lote.prueba.py: ejecuta el MODULO que escribe el
parche -el codigo de verdad, letra por letra- contra unos modelos de
mentira. Lo que se mide es el codigo que se va a desplegar, no una copia
que se le parece.

Y al final, los PASOS sobre un proyecto de mentira en disco, que es donde
se escondio el ultimo fallo gordo: un paso que se creia dado sin haberlo
dado.

Lo que no se puede medir aqui
-----------------------------
Que las rutas del mapa existan de verdad en el servidor. Eso solo lo dice
el servidor, y para eso esta `GET permisos/rutas/` con su `sin_mapear`.
"""
from __future__ import print_function

import importlib.util
import os
import re
import shutil
import sys
import tempfile

AQUI = os.path.dirname(os.path.abspath(__file__))

FALLOS = []


def igual(que, obtenido, esperado):
    marca = 'ok ' if obtenido == esperado else 'MAL'
    if obtenido != esperado:
        FALLOS.append(que)
    print('  [%s] %-52s %r%s' % (
        marca, que, obtenido,
        '' if obtenido == esperado else '   esperaba %r' % (esperado,)))


def cierto(que, cond):
    igual(que, bool(cond), True)


def cargar_parche():
    spec = importlib.util.spec_from_file_location(
        'parche_permisos', os.path.join(AQUI, 'parche_permisos_pantalla.py'))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


P = cargar_parche()


# ══════════════════════════════════════════════════════════════════════════
# los modelos de mentira
# ══════════════════════════════════════════════════════════════════════════

class NoExiste(Exception):
    pass


class Grupos(object):
    def __init__(self, nombres):
        self._n = list(nombres)

    def values_list(self, campo, flat=False):
        return list(self._n)


class Usuario(object):
    _n = 0
    _reg = {}

    def __init__(self, username, roles=(), staff=False, super_=False,
                 anonimo=False):
        Usuario._n += 1
        self.id = self.pk = Usuario._n
        Usuario._reg[self.pk] = self
        self.username = username
        self.groups = Grupos(roles)
        self.is_staff = staff
        self.is_superuser = super_
        self._anon = anonimo

    def is_authenticated(self):
        return not self._anon

    def get_username(self):
        return self.username


class _Fila(object):
    def __init__(self, **kw):
        for k, v in kw.items():
            setattr(self, k, v)

    def save(self):
        pass


class FilaRol(_Fila):
    _todas = []

    def __init__(self, **kw):
        _Fila.__init__(self, **kw)
        for a in ('ver', 'crear', 'editar', 'borrar'):
            if not hasattr(self, a):
                setattr(self, a, False)
        FilaRol._todas.append(self)

    def delete(self):
        if self in FilaRol._todas:
            FilaRol._todas.remove(self)


class FilaUsuario(_Fila):
    _todas = []

    def __init__(self, **kw):
        _Fila.__init__(self, **kw)
        for a in ('ver', 'crear', 'editar', 'borrar'):
            if not hasattr(self, a):
                setattr(self, a, None)
        FilaUsuario._todas.append(self)

    def delete(self):
        if self in FilaUsuario._todas:
            FilaUsuario._todas.remove(self)


class Gestor(object):
    """Lo poco del ORM que usa el modulo: all, filter, create, get_or_create."""

    def __init__(self, clase, filas=None):
        self._clase = clase
        self._filas = filas

    @property
    def filas(self):
        return self._clase._todas if self._filas is None else self._filas

    def all(self):
        return list(self.filas)

    def filter(self, **kw):
        fuera = list(self.filas)
        for clave, valor in kw.items():
            if clave.endswith('__in'):
                campo = clave[:-4]
                fuera = [f for f in fuera if getattr(f, campo, None) in valor]
            else:
                fuera = [f for f in fuera if getattr(f, clave, None) == valor]
        return Gestor(self._clase, fuera)

    def delete(self):
        for f in list(self.filas):
            f.delete()

    def create(self, **kw):
        return self._clase(**kw)

    def get_or_create(self, **kw):
        hay = self.filter(**kw).all()
        if hay:
            return hay[0], False
        return self._clase(**kw), True

    def __iter__(self):
        return iter(self.filas)

    def __len__(self):
        return len(self.filas)

    def __bool__(self):
        return bool(self.filas)


class Respuesta(object):
    def __init__(self, data, status=200):
        self.data = data
        self.status_code = getattr(status, 'value', status)


class Json(object):
    """El JsonResponse de Django, que es lo que devuelve el middleware."""

    def __init__(self, datos, status=200):
        self.data = datos
        self.status_code = status


def sin_decorar(*a, **k):
    return lambda fn: fn


class Peticion(object):
    def __init__(self, usuario=None, datos=None, metodo='GET', ruta='/',
                 token=None):
        self.user = usuario
        self.data = datos or {}
        self.method = metodo
        self.path = ruta
        self.META = {}
        if token:
            self.META['HTTP_AUTHORIZATION'] = 'Token %s' % token


def cargar_modulo():
    """Ejecuta el permisos_pantalla.py que escribe el parche."""
    FilaRol._todas[:] = []
    FilaUsuario._todas[:] = []
    Usuario._reg.clear()
    Usuario._n = 0

    fuente = P.MODULO
    fuente = re.sub(r'(?m)^(from|import) (django|rest_framework|\.).*\n(\s+.*\n)*',
                    '', fuente)

    class ConEstado(object):
        HTTP_400_BAD_REQUEST = 400
        HTTP_404_NOT_FOUND = 404

    class Registro(object):
        def warning(self, *a, **k):
            pass

    ns = {
        'logging': type('L', (), {'getLogger': staticmethod(
            lambda n: Registro())}),
        're': re,
        'JsonResponse': Json,
        'status': ConEstado,
        'api_view': sin_decorar,
        'permission_classes': sin_decorar,
        'IsAuthenticated': None,
        'Response': Respuesta,
        'PermisoDeRol': type('R', (), {'objects': Gestor(FilaRol)}),
        'PermisoDeUsuario': type('U', (), {'objects': Gestor(FilaUsuario)}),
        'EsGerencia': None,
    }
    exec(compile(fuente, 'permisos_pantalla.py', 'exec'), ns)
    ns['registro'] = Registro()
    return ns


# ══════════════════════════════════════════════════════════════════════════
# las pruebas
# ══════════════════════════════════════════════════════════════════════════

def prueba_sin_configurar():
    print('\n1. un rol sin configurar se comporta como hoy')
    m = cargar_modulo()
    juan = Usuario('juan', roles=['mobile_usuario'])

    r = m['permisos_de'](juan)
    igual('ve el mapa', r['mapa']['ver'], True)
    igual('y puede borrar', r['costeo']['borrar'], True)

    # EL DIA QUE SE APLICA EL PARCHE NADIE SE QUEDA FUERA. Es la unica
    # razon por la que esto no empieza en «nadie puede nada».
    igual('estan todas las pantallas', len(r), len(m['CLAVES']))


def prueba_rejilla_de_rol():
    print('\n2. la rejilla del rol manda en cuanto existe')
    m = cargar_modulo()
    juan = Usuario('juan', roles=['mobile_usuario'])
    FilaRol(rol='mobile_usuario', pantalla='mapa', ver=True)
    FilaRol(rol='mobile_usuario', pantalla='lista', ver=True, crear=True)

    r = m['permisos_de'](juan)
    igual('ve el mapa', r['mapa']['ver'], True)
    igual('pero no crea en el mapa', r['mapa']['crear'], False)
    igual('crea incidentes', r['lista']['crear'], True)
    igual('no los borra', r['lista']['borrar'], False)
    # LO QUE NO ESTA EN LA REJILLA, NO SE PUEDE. Con una fila guardada, el
    # rol deja de estar «sin configurar» y vale exactamente lo marcado.
    igual('y costeo ni lo ve', r['costeo']['ver'], False)


def prueba_dos_roles_suman():
    print('\n3. dos roles suman, no restan')
    m = cargar_modulo()
    FilaRol(rol='mobile_usuario', pantalla='mapa', ver=True)
    FilaRol(rol='mobile_gerencia', pantalla='costeo', ver=True, editar=True)
    doble = Usuario('doble', roles=['mobile_usuario', 'mobile_gerencia'])

    r = m['permisos_de'](doble)
    igual('lo del primero', r['mapa']['ver'], True)
    igual('y lo del segundo', r['costeo']['editar'], True)


def prueba_excepciones():
    print('\n4. las excepciones de una persona mandan sobre su rol')
    m = cargar_modulo()
    FilaRol(rol='mobile_usuario', pantalla='lista',
            ver=True, crear=True, editar=True, borrar=True)
    ana = Usuario('ana', roles=['mobile_usuario'])

    # Quitar.
    FilaUsuario(usuario=ana, pantalla='lista', borrar=False)
    r = m['permisos_de'](ana)
    igual('se le quita borrar', r['lista']['borrar'], False)
    igual('y lo demas sigue', r['lista']['editar'], True)

    # Y DAR: a veces hace falta que una persona vea algo sin cambiarle el
    # rol a toda su cuadrilla.
    FilaUsuario(usuario=ana, pantalla='costeo', ver=True)
    r = m['permisos_de'](ana)
    igual('se le da ver costeo', r['costeo']['ver'], True)
    igual('pero no editarlo', r['costeo']['editar'], False)

    # Sin decir nada = lo que diga el rol. Es el tercer estado, y es el
    # que hace que una excepcion no arrase con lo demas.
    FilaUsuario(usuario=ana, pantalla='mapa')
    r = m['permisos_de'](ana)
    igual('callarse no quita nada', r['mapa']['ver'], False)


def prueba_admin_intocable():
    print('\n5. al superusuario y al staff no se les cierra la puerta')
    m = cargar_modulo()
    # Una rejilla que lo niega todo para su rol.
    FilaRol(rol='mobile_usuario', pantalla='mapa')
    jefe = Usuario('root', roles=['mobile_usuario'], super_=True)
    staff = Usuario('admin', roles=['mobile_usuario'], staff=True)

    igual('el superusuario puede', m['permisos_de'](jefe)['costeo']['borrar'],
          True)
    igual('el staff tambien', m['permisos_de'](staff)['costeo']['borrar'],
          True)

    # Y una excepcion tampoco se los lleva por delante.
    FilaUsuario(usuario=jefe, pantalla='costeo', borrar=False)
    igual('ni con una excepcion',
          m['permisos_de'](jefe)['costeo']['borrar'], True)


def prueba_anonimo():
    print('\n6. un anonimo no puede nada')
    m = cargar_modulo()
    nadie = Usuario('anon', anonimo=True)
    r = m['permisos_de'](nadie)
    igual('ni ver', r['mapa']['ver'], False)
    igual('ni nada', any(a for p in r.values() for a in p.values()), False)


def prueba_mapa_de_rutas():
    print('\n7. el mapa de rutas dice que pantalla y que accion')
    m = cargar_modulo()
    q = m['que_toca']

    igual('GET rutinas -> ver monitoreos',
          q('/api/v1/mobile/monitoreo/rutinas/', 'GET'), ('monitoreos', 'ver'))
    igual('POST rutinas -> crear',
          q('/api/v1/mobile/monitoreo/rutinas/', 'POST'),
          ('monitoreos', 'crear'))
    igual('DELETE rutina -> borrar',
          q('/api/v1/mobile/monitoreo/rutinas/3/', 'DELETE'),
          ('monitoreos', 'borrar'))

    # EL METODO MIENTE A VECES: un POST a asignar/ no crea una rutina,
    # retoca una que ya existe.
    igual('POST asignar -> editar',
          q('/api/v1/mobile/monitoreo/rutinas/3/asignar/', 'POST'),
          ('monitoreos', 'editar'))

    # Los hallazgos son otra pantalla, con su propia rejilla.
    igual('los hallazgos van aparte',
          q('/api/v1/mobile/monitoreo/hallazgos/', 'GET'),
          ('hallazgos', 'ver'))
    igual('y borrar uno es borrar ahi',
          q('/api/v1/mobile/monitoreo/hallazgos/7/', 'DELETE'),
          ('hallazgos', 'borrar'))

    # LA APP DE CAMPO NO ENTRA EN LA REJILLA. Un coordinador recorriendo
    # su tramo no tiene por que figurar en los permisos de una pantalla
    # de escritorio, y esas rutas van DELANTE en el mapa por eso.
    igual('mis-tramos no se vigila',
          q('/api/v1/mobile/monitoreo/mis-tramos/', 'GET'), (None, None))
    igual('registrar una visita tampoco',
          q('/api/v1/mobile/monitoreo/visitas/', 'POST'), (None, None))
    igual('ni el login',
          q('/api/v1/mobile/auth/login/', 'POST'), (None, None))

    # Lo que no este en el mapa pasa.
    igual('lo desconocido pasa',
          q('/api/v1/mobile/loquesea/', 'POST'), (None, None))


def prueba_middleware():
    print('\n8. el middleware contesta 403 y deja pasar lo demas')
    m = cargar_modulo()
    FilaRol(rol='mobile_usuario', pantalla='monitoreos', ver=True)
    juan = Usuario('juan', roles=['mobile_usuario'])
    guardia = m['PermisosDePantalla']()

    r = guardia.process_request(
        Peticion(juan, metodo='GET', ruta='/api/v1/mobile/monitoreo/rutinas/'))
    igual('ver, pasa', r, None)

    r = guardia.process_request(
        Peticion(juan, metodo='POST', ruta='/api/v1/mobile/monitoreo/rutinas/'))
    igual('crear, 403', getattr(r, 'status_code', None), 403)
    igual('y dice por que', r.data['accion'], 'crear')
    igual('y donde', r.data['pantalla'], 'monitoreos')

    # Fuera de la API no se mete.
    igual('la web estatica no se toca',
          guardia.process_request(Peticion(juan, ruta='/index.html')), None)

    # SIN SABER QUIEN ES, NO DECIDE. Confundir «no se quien eres» con «no
    # puedes» convierte cada sesion caducada en un permiso denegado, y ese
    # sintoma no lleva a ninguna parte.
    igual('sin usuario, no decide',
          guardia.process_request(
              Peticion(None, metodo='POST',
                       ruta='/api/v1/mobile/monitoreo/rutinas/')), None)


def prueba_middleware_apunta():
    print('\n9. lo que llega sin mapear queda apuntado')
    m = cargar_modulo()
    guardia = m['PermisosDePantalla']()
    juan = Usuario('juan', roles=['mobile_usuario'])

    guardia.process_request(
        Peticion(juan, metodo='POST', ruta='/api/v1/mobile/pepito/grillo/'))
    cierto('se apunto la escritura',
           'POST /api/v1/mobile/pepito/grillo/' in m['SIN_MAPEAR'])

    # Las lecturas no se apuntan: son casi todas, y llenarian la lista de
    # ruido hasta esconder la escritura que de verdad falta por vigilar.
    guardia.process_request(
        Peticion(juan, metodo='GET', ruta='/api/v1/mobile/otra/cosa/'))
    igual('las lecturas no',
          'GET /api/v1/mobile/otra/cosa/' in m['SIN_MAPEAR'], False)

    r = m['rutas'](Peticion(juan))
    cierto('y salen por el endpoint',
           'POST /api/v1/mobile/pepito/grillo/' in r.data['sin_mapear'])


def prueba_tabla_que_no_esta():
    print('\n10. si la tabla no esta, el sistema NO se cae')
    m = cargar_modulo()

    class Revienta(object):
        def filter(self, **kw):
            raise Exception('no such table: core_permisoderol')

    m['PermisoDeRol'] = type('R', (), {'objects': Revienta()})
    juan = Usuario('juan', roles=['mobile_usuario'])
    guardia = m['PermisosDePantalla']()

    # EL CODIGO PUESTO Y LA MIGRACION NO ES UN ESTADO REAL: pasa entre el
    # parche y el migrate. Si eso tumbara cada peticion, el servidor
    # entero dejaria de responder por un permiso.
    r = guardia.process_request(
        Peticion(juan, metodo='POST', ruta='/api/v1/mobile/monitoreo/rutinas/'))
    igual('deja pasar en vez de caerse', r, None)


def prueba_guardar_rol():
    print('\n11. guardar la rejilla de un rol')
    m = cargar_modulo()
    jefe = Usuario('root', super_=True)

    r = m['por_rol'](Peticion(jefe, {
        'rol': 'mobile_usuario',
        'permisos': {'mapa': {'ver': True},
                     'lista': {'ver': True, 'crear': True}}}, metodo='POST'))
    igual('se guarda', r.status_code, 200)
    igual('dos pantallas con permiso', r.data['pantallas_con_permiso'], 2)
    igual('y dos filas', len(FilaRol._todas), 2)

    juan = Usuario('juan', roles=['mobile_usuario'])
    igual('ya manda', m['permisos_de'](juan)['lista']['crear'], True)

    # Volver a guardar NO acumula: se reemplaza la rejilla entera.
    r = m['por_rol'](Peticion(jefe, {
        'rol': 'mobile_usuario', 'permisos': {'mapa': {'ver': True}}},
        metodo='POST'))
    igual('se reemplaza', len(FilaRol._todas), 1)
    igual('y lo quitado se fue',
          m['permisos_de'](juan)['lista']['crear'], False)

    # UNA REJILLA ENTERA EN BLANCO BLOQUEA, no deja «sin configurar».
    r = m['por_rol'](Peticion(jefe, {'rol': 'mobile_usuario', 'permisos': {}},
                              metodo='POST'))
    igual('en blanco se guarda igual', r.status_code, 200)
    cierto('con una fila muda', len(FilaRol._todas) == 1)
    igual('y el rol queda bloqueado',
          m['permisos_de'](juan)['mapa']['ver'], False)

    # Y para devolverlo a como estaba: permisos = null.
    m['por_rol'](Peticion(jefe, {'rol': 'mobile_usuario', 'permisos': None},
                          metodo='POST'))
    igual('null lo deja sin configurar',
          m['permisos_de'](juan)['mapa']['ver'], True)

    # Una pantalla inventada se rechaza en vez de guardarse y no servir.
    r = m['por_rol'](Peticion(jefe, {
        'rol': 'x', 'permisos': {'pantalla_que_no_existe': {'ver': True}}},
        metodo='POST'))
    igual('pantalla inventada, 400', r.status_code, 400)

    r = m['por_rol'](Peticion(jefe, {'permisos': {}}, metodo='POST'))
    igual('sin rol, 400', r.status_code, 400)


def prueba_mios():
    print('\n12. «mis permisos», que es con lo que se pinta la web')
    m = cargar_modulo()
    FilaRol(rol='mobile_usuario', pantalla='mapa', ver=True)
    juan = Usuario('juan', roles=['mobile_usuario'])

    r = m['mios'](Peticion(juan))
    igual('responde', r.status_code, 200)
    igual('con la rejilla', r.data['permisos']['mapa']['ver'], True)
    igual('y con el catalogo', len(r.data['pantallas']), len(m['CLAVES']))
    igual('y las acciones', r.data['acciones'],
          ['ver', 'crear', 'editar', 'borrar'])


# ══════════════════════════════════════════════════════════════════════════
# los pasos, en disco
# ══════════════════════════════════════════════════════════════════════════

MODELS_VIRGEN = '''# -*- coding: utf-8 -*-
from django.db import models


class Algo(models.Model):
    nombre = models.CharField('Nombre', max_length=50)
'''

URLS_VIRGEN = '''# -*- coding: utf-8 -*-
from django.conf.urls import url

from src.apps.api.views import algo

urlpatterns = [
    url(r'^v1/mobile/algo/$', algo, name='algo'),
]
'''

SETTINGS_VIRGEN = '''# -*- coding: utf-8 -*-
DEBUG = False

MIDDLEWARE_CLASSES = (
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
)

INSTALLED_APPS = ['src.apps.core']
'''

MIGRACION_VIRGEN = '''# -*- coding: utf-8 -*-
from __future__ import unicode_literals
from django.db import migrations


class Migration(migrations.Migration):
    dependencies = []
    operations = []
'''


def plantar():
    raiz = tempfile.mkdtemp(prefix='pluvira_perm_')
    for rel in ('src/apps/core/migrations', 'src/apps/api', 'config'):
        os.makedirs(os.path.join(raiz, rel))
    poner(raiz, 'src/apps/core/models.py', MODELS_VIRGEN)
    poner(raiz, 'src/apps/api/urls.py', URLS_VIRGEN)
    poner(raiz, 'config/settings.py', SETTINGS_VIRGEN)
    poner(raiz, 'src/apps/core/migrations/__init__.py', '')
    poner(raiz, 'src/apps/core/migrations/0001_initial.py', MIGRACION_VIRGEN)
    poner(raiz, 'src/apps/core/equipo_enlazado.py',
          'class EsGerencia(object):\n    pass\n')
    return raiz


def poner(raiz, rel, texto):
    with open(os.path.join(raiz, rel), 'w') as f:
        f.write(texto)


def sacar(raiz, rel):
    with open(os.path.join(raiz, rel)) as f:
        return f.read()


PASOS = [
    ('modelos', P.paso_modelos),
    ('migracion', P.paso_migracion),
    ('modulo', P.paso_modulo),
    ('urls', P.paso_urls),
    ('settings', P.paso_settings),
]


def correr(raiz):
    fuera = {}
    for nombre, fn in PASOS:
        try:
            fuera[nombre] = fn(raiz, False)
        except Exception as e:
            fuera[nombre] = (False, 'reviento: %s' % (e,))
    return fuera


def prueba_pasos():
    print('\n13. los pasos dejan el proyecto completo')
    raiz = plantar()
    try:
        r = correr(raiz)
        for nombre, _ in PASOS:
            igual('paso %s' % nombre, r[nombre][0], True)

        m = sacar(raiz, 'src/apps/core/models.py')
        cierto('PermisoDeRol', 'class PermisoDeRol' in m)
        cierto('PermisoDeUsuario', 'class PermisoDeUsuario' in m)
        cierto('y el settings que hacia falta',
               'from django.conf import settings' in m)

        cierto('el modulo',
               os.path.isfile(os.path.join(
                   raiz, 'src/apps/core/permisos_pantalla.py')))

        u = sacar(raiz, 'src/apps/api/urls.py')
        cierto('la ruta de mis permisos', 'permisos/mios/' in u)
        cierto('la de los roles', 'permisos/roles/' in u)

        s = sacar(raiz, 'config/settings.py')
        cierto('el middleware', 'PermisosDePantalla' in s)
        # DETRAS DE AuthenticationMiddleware, o resolveria siempre contra
        # un anonimo.
        cierto('y detras del de autenticacion',
               s.index('PermisosDePantalla')
               > s.index('AuthenticationMiddleware'))
    finally:
        shutil.rmtree(raiz)


def prueba_pasos_idempotentes():
    print('\n14. correrlos dos veces no cambia nada')
    raiz = plantar()
    try:
        correr(raiz)
        antes = instantanea(raiz)
        r = correr(raiz)
        for nombre, _ in PASOS:
            igual('segunda vuelta %s' % nombre, r[nombre][0], True)
        igual('nada cambio', diferencias(antes, instantanea(raiz)), [])
    finally:
        shutil.rmtree(raiz)


def prueba_settings_lista():
    print('\n15. el middleware entra tanto en MIDDLEWARE como en la vieja')
    for nombre, texto in (
            ('MIDDLEWARE_CLASSES', SETTINGS_VIRGEN),
            ('MIDDLEWARE', SETTINGS_VIRGEN.replace(
                'MIDDLEWARE_CLASSES = (', 'MIDDLEWARE = [').replace(
                    "AuthenticationMiddleware',\n)",
                    "AuthenticationMiddleware',\n]"))):
        raiz = plantar()
        try:
            poner(raiz, 'config/settings.py', texto)
            ok, que = P.paso_settings(raiz, False)
            igual('con %s' % nombre, ok, True)
            s = sacar(raiz, 'config/settings.py')
            cierto('%s: quedo dentro' % nombre, 'PermisosDePantalla' in s)
            # Y el archivo sigue siendo Python valido, que es lo unico que
            # impide dejar el servidor sin arrancar.
            compile(s, 'settings.py', 'exec')
        finally:
            shutil.rmtree(raiz)


def instantanea(raiz):
    fuera = {}
    for base, _, archivos in os.walk(raiz):
        for n in archivos:
            if n.endswith('.bak'):
                continue
            ruta = os.path.join(base, n)
            with open(ruta) as f:
                fuera[os.path.relpath(ruta, raiz)] = f.read()
    return fuera


def diferencias(a, b):
    return sorted(set(b) - set(a)) + sorted(
        k for k in b if k in a and a[k] != b[k])


def main():
    print('Permisos por pantalla')
    print('=' * 74)
    for fn in [prueba_sin_configurar, prueba_rejilla_de_rol,
               prueba_dos_roles_suman, prueba_excepciones,
               prueba_admin_intocable, prueba_anonimo,
               prueba_mapa_de_rutas, prueba_middleware,
               prueba_middleware_apunta, prueba_tabla_que_no_esta,
               prueba_guardar_rol, prueba_mios,
               prueba_pasos, prueba_pasos_idempotentes,
               prueba_settings_lista]:
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
