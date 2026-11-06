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
    """Una peticion de mentira. Por defecto, DE UN NAVEGADOR.

    El `navegador=True` por defecto no es pereza: casi todas las pruebas
    miden la rejilla, y la rejilla solo se aplica a la web. Quien quiera
    medir la app pone `navegador=False`, que es lo que de verdad manda el
    telefono: ni Sec-Fetch, ni Origin, y un User-Agent de Dart.
    """

    def __init__(self, usuario=None, datos=None, metodo='GET', ruta='/',
                 token=None, consulta=None, navegador=True):
        self.user = usuario
        self.data = datos or {}
        self.method = metodo
        self.path = ruta
        self.GET = consulta or {}
        self.META = {}
        if navegador:
            self.META['HTTP_SEC_FETCH_SITE'] = 'same-origin'
            self.META['HTTP_USER_AGENT'] = (
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0')
        else:
            self.META['HTTP_USER_AGENT'] = 'Dart/3.5 (dart:io)'
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

# EL urls.py DEL SERVIDOR DE VERDAD, que es otra cosa: el parche de
# monitoreos ya le metio un import de VARIAS LINEAS en columna cero. Ahi
# es donde esto fallo en produccion.
URLS_CON_MONITOREOS = '''# -*- coding: utf-8 -*-
"""Las rutas de la API."""
from django.conf.urls import url

from src.apps.api.views import algo
from src.apps.core.monitoreo import (
    rutinas as mon_rutinas,
    rutina as mon_rutina,
    mis_tramos as mon_mis_tramos,
)

urlpatterns = [
    url(r'^v1/mobile/algo/$', algo, name='algo'),
    url(r'^v1/mobile/monitoreo/rutinas/$', mon_rutinas, name='mr'),
]
'''

MANAGE_PY = '''#!/usr/bin/env python
import os
import sys

if __name__ == '__main__':
    os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.ajustes')
    from django.core.management import execute_from_command_line
    execute_from_command_line(sys.argv)
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
    poner(raiz, 'manage.py', MANAGE_PY.replace('config.ajustes',
                                               'config.settings'))
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


def prueba_urls_con_import_largo():
    print('\n16. urls.py con un import de varias lineas (el del servidor)')
    # ────────────────────────────────────────────────────────────────
    # ESTO ES LO QUE FALLO EN PRODUCCION
    # ────────────────────────────────────────────────────────────────
    #
    # `fin_de_imports` no contaba los parentesis, asi que con
    #
    #     from src.apps.core.monitoreo import (
    #         rutinas as mon_rutinas,     <- decia que acababan AQUI
    #
    # el import nuevo se colaba entre el parentesis y su contenido. El
    # archivo dejaba de compilar, `escribir` se negaba -para eso esta- y
    # el paso moria con un «reviento» que no hablaba de la causa. El
    # resultado: modulo escrito, migracion puesta y CERO rutas.
    raiz = plantar()
    try:
        poner(raiz, 'src/apps/api/urls.py', URLS_CON_MONITOREOS)
        ok, que = P.paso_urls(raiz, False)
        igual('el paso se aplica', ok, True)

        u = sacar(raiz, 'src/apps/api/urls.py')
        cierto('la ruta esta', 'permisos/mios/' in u)
        cierto('el import esta', 'perm_mios' in u)
        cierto('y el de monitoreos sigue entero',
               'rutinas as mon_rutinas' in u)
        # Lo unico que de verdad importa: que siga siendo Python.
        compile(u, 'urls.py', 'exec')

        # Y dos veces no duplica.
        ok, que = P.paso_urls(raiz, False)
        igual('la segunda vez, nada', (ok, que), (True, 'ya estaba'))
        igual('una sola vez', sacar(raiz, 'src/apps/api/urls.py')
              .count('permisos/mios/'), 1)
    finally:
        shutil.rmtree(raiz)


def prueba_settings_en_otro_sitio():
    print('\n17. el settings no siempre esta en config/settings.py')
    # En el servidor no estaba ahi, y el paso moria diciendo «no existe
    # config/settings.py», que suena a proyecto roto cuando lo unico que
    # pasa es que vive en otra carpeta. Ahora se le pregunta a manage.py,
    # que es quien lo sabe.
    for donde, modulo in (('config/ajustes.py', 'config.ajustes'),
                          ('config/settings/base.py', 'config.settings'),
                          ('miproyecto/settings.py', 'miproyecto.settings')):
        raiz = plantar()
        try:
            os.remove(os.path.join(raiz, 'config/settings.py'))
            carpeta = os.path.join(raiz, os.path.dirname(donde))
            if not os.path.isdir(carpeta):
                os.makedirs(carpeta)
            poner(raiz, donde, SETTINGS_VIRGEN)
            poner(raiz, 'manage.py',
                  MANAGE_PY.replace('config.ajustes', modulo))

            ok, que = P.paso_settings(raiz, False)
            igual('con %s' % donde, ok, True)
            s = sacar(raiz, donde)
            cierto('%s: quedo dentro' % donde, 'PermisosDePantalla' in s)
            compile(s, 'settings.py', 'exec')
        finally:
            shutil.rmtree(raiz)

    # Y un settings partido en varios archivos: manda el que tiene la
    # lista, no el que lleva el nombre.
    raiz = plantar()
    try:
        os.remove(os.path.join(raiz, 'config/settings.py'))
        os.makedirs(os.path.join(raiz, 'config/settings'))
        poner(raiz, 'config/settings/__init__.py',
              'from .base import *  # noqa\n')
        poner(raiz, 'config/settings/base.py', SETTINGS_VIRGEN)
        poner(raiz, 'manage.py',
              MANAGE_PY.replace('config.ajustes', 'config.settings'))

        ok, que = P.paso_settings(raiz, False)
        igual('partido en varios', ok, True)
        cierto('fue al que tiene la lista',
               'PermisosDePantalla' in sacar(raiz, 'config/settings/base.py'))
        igual('y no al __init__',
              'PermisosDePantalla' in sacar(raiz, 'config/settings/__init__.py'),
              False)
    finally:
        shutil.rmtree(raiz)


def prueba_la_app_no_entra_en_la_rejilla():
    print('\n18. la app de campo no entra en la rejilla')
    # ─────────────────────────────────────────────────────────────────
    # ESTO ROMPIO EL CAMPO
    # ─────────────────────────────────────────────────────────────────
    #
    # PLUVIRA entra por LAS MISMAS URL que la web. Con la rejilla
    # vigilando a los dos, configurar el rol `mobile_usuario` -que es
    # justo lo que se va a hacer- deja a todos los telefonos sin poder
    # reportar. Y falla callando: la cola sin conexion reintenta igual
    # ante un 403 que ante un corte de red, y enseña «Intenta en una
    # zona con mejor señal». El parte se queda en el telefono y nadie
    # sospecha del servidor.
    m = cargar_modulo()

    # Un rol configurado SIN permiso de incidentes: el caso que rompia.
    FilaRol(rol='mobile_usuario', pantalla='monitoreos', ver=True)
    juan = Usuario('juan', roles=['mobile_usuario'])
    guardia = m['PermisosDePantalla']()

    def pide(ruta, metodo, navegador):
        return guardia.process_request(
            Peticion(juan, metodo=metodo, ruta=ruta, navegador=navegador))

    # Desde el TELEFONO: pasa todo.
    igual('el telefono reporta un incidente',
          pide('/api/v1/mobile/hi-incidents/', 'POST', False), None)
    igual('el telefono lee la lista',
          pide('/api/v1/mobile/hi-incidents/list/', 'GET', False), None)
    igual('y registra una visita',
          pide('/api/v1/mobile/monitoreo/visitas/', 'POST', False), None)

    # Desde el NAVEGADOR: manda la rejilla.
    r = pide('/api/v1/mobile/hi-incidents/list/', 'GET', True)
    igual('la web sin permiso, 403', getattr(r, 'status_code', None), 403)
    igual('la web con permiso, pasa',
          pide('/api/v1/mobile/monitoreo/rutinas/', 'GET', True), None)

    # LO DEL CAMPO NO SE VIGILA NUNCA, ni aunque la deteccion fallara.
    # Si un dia un proxy limpia las cabeceras, lo que NO puede pasar es
    # que un parte de campo se quede sin subir.
    igual('crear incidente, libre tambien desde el navegador',
          pide('/api/v1/mobile/hi-incidents/', 'POST', True), None)
    igual('el login, libre',
          pide('/api/v1/mobile/auth/login/', 'POST', True), None)
    igual('registrar una visita, libre',
          pide('/api/v1/mobile/monitoreo/visitas/', 'POST', True), None)

    # Y la web SI se vigila en lo que es suyo: gestionar el costeo de ese
    # mismo incidente no es reportarlo desde el canal.
    r = pide('/api/v1/mobile/operations/incidentes/gestion/', 'POST', True)
    igual('gestionar costeo desde la web, 403',
          getattr(r, 'status_code', None), 403)


def prueba_quien_es_navegador():
    print('\n19. como se reconoce un navegador')
    m = cargar_modulo()
    es = m['del_navegador']

    class P(object):
        def __init__(self, **kw):
            self.META = kw

    igual('Sec-Fetch-Site', es(P(HTTP_SEC_FETCH_SITE='same-origin')), True)
    igual('Origin', es(P(HTTP_ORIGIN='https://sistema.jriegopresurizado.org.pe')),
          True)
    igual('User-Agent de Chrome',
          es(P(HTTP_USER_AGENT='Mozilla/5.0 (X11; Linux) Chrome/131')), True)
    igual('User-Agent de Safari',
          es(P(HTTP_USER_AGENT='Mozilla/5.0 (iPhone) Safari/605')), True)

    igual('el cliente de Dart NO',
          es(P(HTTP_USER_AGENT='Dart/3.5 (dart:io)')), False)
    igual('sin cabeceras, NO', es(P()), False)
    # Un curl tampoco es un navegador, asi que se comporta como la app.
    # Es el precio de poder distinguirlos sin cambiar la app; esta dicho
    # en el modulo y en la guia.
    igual('curl tampoco', es(P(HTTP_USER_AGENT='curl/8.4.0')), False)


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
               prueba_settings_lista, prueba_urls_con_import_largo,
               prueba_settings_en_otro_sitio,
               prueba_la_app_no_entra_en_la_rejilla,
               prueba_quien_es_navegador]:
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
