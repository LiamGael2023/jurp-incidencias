# -*- coding: utf-8 -*-
"""Permisos por pantalla y por accion, con candado de verdad.

    python3 parche_permisos_pantalla.py              # simulacro
    python3 parche_permisos_pantalla.py --aplicar
    python3 parche_permisos_pantalla.py --revertir   # deshace los injertos

QUE RESUELVE
============
Hoy el menu solo sabe distinguir «administrador» de «no administrador», y
cada endpoint se protege por grupo (mobile_gerencia). Eso da dos
tamanos de permiso y nada en medio: o ve el sistema entero o ve lo
mismo que el ultimo peon.

Esto anade una rejilla PANTALLA x ACCION -ver, crear, editar, borrar- que
se configura por ROL, con excepciones por persona.

POR QUE EL CANDADO VA EN UN MIDDLEWARE Y NO EN CADA VISTA
=========================================================
Esconder un boton no impide nada: quien sepa la URL de la API sigue
pudiendo. El candado de verdad exige comprobar el permiso en el servidor,
y hacerlo vista por vista son ochenta sitios donde tocar y ochenta sitios
donde olvidarse de uno.

Un middleware lo hace en UN punto: mira la ruta, deduce que pantalla y
que accion son, y responde 403 antes de que la vista se entere. Lo que no
este en el mapa pasa -no se bloquea a ciegas lo que no se entiende-, y
cada escritura que llega sin mapear queda apuntada para poder anadirla.

EL ESTADO DE PARTIDA NO ENCIERRA A NADIE
========================================
Un rol SIN NINGUNA fila configurada es un rol sin restringir: se comporta
como hoy. La rejilla empieza a mandar en cuanto se guarda por primera vez,
y entonces vale lo que diga: lo que no este marcado, no se puede. Asi el
parche se aplica un martes cualquiera sin dejar a nadie fuera.

Los superusuarios y el staff de Django no se tocan NUNCA. Un sistema de
permisos que puede cerrarle la puerta a quien los administra es un sistema
que se rompe una sola vez y para siempre.

QUE TOCA
========
    1. src/apps/core/models.py                PermisoDeRol, PermisoDeUsuario
    2. src/apps/core/migrations/XXXX_...py    sus tablas
    3. src/apps/core/permisos_pantalla.py     el catalogo, la resolucion,
                                              los endpoints y el middleware
    4. src/apps/api/urls.py                   las rutas
    5. config/settings.py                     el middleware en su lista
"""
from __future__ import print_function

import argparse
import os
import re
import shutil
import sys


# ══════════════════════════════════════════════════════════════════════════
# 1. los modelos
# ══════════════════════════════════════════════════════════════════════════

MODELOS = '''

# ══════════════════════════════════════════════════════════════════════════
# PERMISOS POR PANTALLA   (lo escribe parche_permisos_pantalla.py)
# ══════════════════════════════════════════════════════════════════════════

class PermisoDeRol(models.Model):
    """Que puede hacer un rol en una pantalla.

    UNA FILA POR PANTALLA Y ROL. Guardar la rejilla entera en un JSON
    seria mas corto de escribir y peor de consultar: con filas, saber
    quien puede borrar en Costeo es una consulta, y con un JSON es leerse
    los catorce roles en memoria y mirarlos uno a uno.

    `rol` es el NOMBRE del grupo de Django, no su id. Los grupos se
    borran y se vuelven a crear al trastear con los permisos, y un id
    reciclado haria que un rol heredara en silencio la rejilla de otro.
    """

    rol = models.CharField('Rol', max_length=80, db_index=True)
    pantalla = models.CharField('Pantalla', max_length=40, db_index=True)
    ver = models.BooleanField('Ver', default=False)
    crear = models.BooleanField('Crear', default=False)
    editar = models.BooleanField('Editar', default=False)
    borrar = models.BooleanField('Borrar', default=False)

    class Meta:
        verbose_name = 'Permiso de rol'
        verbose_name_plural = 'Permisos por rol'
        unique_together = ('rol', 'pantalla')
        ordering = ['rol', 'pantalla']

    def __str__(self):
        return '{0} - {1}'.format(self.rol, self.pantalla)


class PermisoDeUsuario(models.Model):
    """La excepcion de una persona, por encima de lo que diga su rol.

    LOS TRES ESTADOS IMPORTAN. Cada accion puede estar en si, en no o
    SIN DECIR -null-, y sin decir no es lo mismo que no: significa «lo
    que diga el rol». Con un booleano a secas, dar de alta la excepcion
    de una persona para quitarle una cosa le quitaria de paso todo lo
    demas, y nadie entenderia por que.
    """

    usuario = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
        related_name='permisos_pantalla', verbose_name='Usuario')
    pantalla = models.CharField('Pantalla', max_length=40, db_index=True)
    ver = models.NullBooleanField('Ver')
    crear = models.NullBooleanField('Crear')
    editar = models.NullBooleanField('Editar')
    borrar = models.NullBooleanField('Borrar')

    class Meta:
        verbose_name = 'Excepcion de usuario'
        verbose_name_plural = 'Excepciones por usuario'
        unique_together = ('usuario', 'pantalla')
        ordering = ['usuario', 'pantalla']

    def __str__(self):
        return '{0} - {1}'.format(self.usuario, self.pantalla)
'''


MIGRACION = """# -*- coding: utf-8 -*-
# Lo escribe parche_permisos_pantalla.py.
from __future__ import unicode_literals

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('core', '%(anterior)s'),
    ]

    operations = [
        migrations.CreateModel(
            name='PermisoDeRol',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True,
                                        serialize=False, verbose_name='ID')),
                ('rol', models.CharField(db_index=True, max_length=80,
                                         verbose_name='Rol')),
                ('pantalla', models.CharField(db_index=True, max_length=40,
                                              verbose_name='Pantalla')),
                ('ver', models.BooleanField(default=False,
                                            verbose_name='Ver')),
                ('crear', models.BooleanField(default=False,
                                              verbose_name='Crear')),
                ('editar', models.BooleanField(default=False,
                                               verbose_name='Editar')),
                ('borrar', models.BooleanField(default=False,
                                               verbose_name='Borrar')),
            ],
            options={
                'ordering': ['rol', 'pantalla'],
                'verbose_name': 'Permiso de rol',
                'verbose_name_plural': 'Permisos por rol',
            },
        ),
        migrations.CreateModel(
            name='PermisoDeUsuario',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True,
                                        serialize=False, verbose_name='ID')),
                ('pantalla', models.CharField(db_index=True, max_length=40,
                                              verbose_name='Pantalla')),
                ('ver', models.NullBooleanField(verbose_name='Ver')),
                ('crear', models.NullBooleanField(verbose_name='Crear')),
                ('editar', models.NullBooleanField(verbose_name='Editar')),
                ('borrar', models.NullBooleanField(verbose_name='Borrar')),
                ('usuario', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='permisos_pantalla',
                    to=settings.AUTH_USER_MODEL, verbose_name='Usuario')),
            ],
            options={
                'ordering': ['usuario', 'pantalla'],
                'verbose_name': 'Excepcion de usuario',
                'verbose_name_plural': 'Excepciones por usuario',
            },
        ),
        migrations.AlterUniqueTogether(
            name='permisoderol',
            unique_together=set([('rol', 'pantalla')]),
        ),
        migrations.AlterUniqueTogether(
            name='permisodeusuario',
            unique_together=set([('usuario', 'pantalla')]),
        ),
    ]
"""


# ══════════════════════════════════════════════════════════════════════════
# 2. el modulo: catalogo, resolucion, endpoints y middleware
# ══════════════════════════════════════════════════════════════════════════

MODULO = '''# -*- coding: utf-8 -*-
"""Permisos por pantalla: quien ve que, y que puede hacer dentro.

Lo escribe parche_permisos_pantalla.py. No se edita a mano: el parche lo
vuelve a escribir entero cada vez que se aplica.
"""
from __future__ import unicode_literals

import logging
import re

from django.http import JsonResponse

from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .models import PermisoDeRol, PermisoDeUsuario
from .equipo_enlazado import EsGerencia

registro = logging.getLogger(__name__)


# ══════════════════════════════════════════════════════════════════════════
# el catalogo
# ══════════════════════════════════════════════════════════════════════════

ACCIONES = ('ver', 'crear', 'editar', 'borrar')

# LAS PANTALLAS, CON LA MISMA CLAVE QUE EL MENU DE LA WEB.
#
# Esta lista manda. La web la PIDE en vez de llevar la suya: con dos
# copias, el dia que alguien anada una pantalla en el menu y se olvide de
# aqui, esa pantalla nace sin candado y nadie se entera -que es la unica
# forma de fallo que un sistema de permisos no se puede permitir-.
PANTALLAS = (
    # (clave, titulo, modulo)
    ('mapa', 'Monitoreo GIS', 'pluvira'),
    ('lista', 'Incidentes', 'pluvira'),
    ('hallazgos', 'Hallazgos de recorrido', 'pluvira'),
    ('monitoreos', 'Monitoreo de Sistema Hidraulico', 'pluvira'),
    ('estadisticas', 'Estadisticas', 'pluvira'),
    ('reportes', 'Pronosticos Meteorologicos', 'pluvira'),
    ('maquinaria', 'Maquinaria', 'pluvira'),
    ('partes', 'Partes Diarios', 'pluvira'),
    ('costeo', 'Gestion de Costeo', 'pluvira'),
    ('proyectos', 'Proyectos', 'pluvira'),
    ('actividades', 'Actividades', 'pluvira'),
    ('obra', 'Avance de Obra', 'pluvira'),
    ('reporte-obra', 'Reporte de Avance', 'pluvira'),
    ('rendicion', 'Rendicion de Petroleo', 'pluvira'),
    ('equipos', 'Usuarios y equipos', 'pluvira'),
    ('inv-mapa', 'Inventario - Monitoreo GIS', 'inventario'),
    ('inv-campanias', 'Inventario - Campanas', 'inventario'),
    ('inv-laminas', 'Inventario - Mapas tematicos', 'inventario'),
    ('inv-reportes', 'Inventario - Reportes', 'inventario'),
    ('vigilancia', 'Vigilancia', 'sentria'),
    ('usuarios-sentria', 'Usuarios SENTRIA', 'sentria'),
    ('distribucion', 'Distribucion', 'hydrometrix'),
    ('calidad-agua', 'Calidad de Agua', 'hydrometrix'),
)

CLAVES = tuple(p[0] for p in PANTALLAS)


def catalogo():
    return [{'clave': c, 'titulo': t, 'modulo': m} for c, t, m in PANTALLAS]


# ══════════════════════════════════════════════════════════════════════════
# la resolucion
# ══════════════════════════════════════════════════════════════════════════

def _todo(valor=True):
    return dict((c, dict((a, valor) for a in ACCIONES)) for c in CLAVES)


def _autenticado(usuario):
    """is_authenticated es metodo en Django 1.8 y propiedad despues."""
    if usuario is None:
        return False
    marca = getattr(usuario, 'is_authenticated', False)
    return marca() if callable(marca) else bool(marca)


def permisos_de(usuario):
    """La rejilla efectiva de una persona: {pantalla: {accion: bool}}.

    EL ORDEN IMPORTA, Y ES ESTE:

      1. Superusuario o staff -> todo. No se les toca nunca: un sistema de
         permisos capaz de encerrar a quien lo administra se rompe una
         sola vez y ya no se puede arreglar desde dentro.
      2. La UNION de los roles de esa cuenta. Dos roles suman, no restan:
         quien esta en Gerencia y en Operaciones puede lo de los dos.
      3. Ningun rol suyo configurado -> todo. Es el estado del dia que se
         aplica el parche, y encerrar a la plantilla entera por haber
         instalado algo no es una opcion.
      4. Sus excepciones, que mandan sobre lo anterior. Pueden quitar y
         tambien DAR: a veces lo que hace falta es que una persona vea una
         pantalla sin cambiarle el rol a toda su cuadrilla.
    """
    if not _autenticado(usuario):
        return _todo(False)
    if getattr(usuario, 'is_superuser', False) or getattr(usuario, 'is_staff', False):
        return _todo()

    roles = list(usuario.groups.values_list('name', flat=True))
    filas = list(PermisoDeRol.objects.filter(rol__in=roles)) if roles else []

    if filas:
        rejilla = _todo(False)
        for f in filas:
            if f.pantalla not in rejilla:
                continue
            for a in ACCIONES:
                if getattr(f, a):
                    rejilla[f.pantalla][a] = True
    else:
        rejilla = _todo()

    for e in PermisoDeUsuario.objects.filter(usuario=usuario):
        if e.pantalla not in rejilla:
            continue
        for a in ACCIONES:
            v = getattr(e, a)
            if v is not None:
                rejilla[e.pantalla][a] = bool(v)

    return rejilla


def puede(usuario, pantalla, accion):
    return bool(permisos_de(usuario).get(pantalla, {}).get(accion))


def rejilla_de_rol(rol):
    """Lo configurado para un rol, o None si no se ha configurado nunca."""
    filas = list(PermisoDeRol.objects.filter(rol=rol))
    if not filas:
        return None
    fuera = _todo(False)
    for f in filas:
        if f.pantalla in fuera:
            fuera[f.pantalla] = dict((a, bool(getattr(f, a))) for a in ACCIONES)
    return fuera


# ══════════════════════════════════════════════════════════════════════════
# el mapa de rutas
# ══════════════════════════════════════════════════════════════════════════

# QUE METODO ES QUE ACCION, cuando la ruta no diga otra cosa.
POR_METODO = {
    'GET': 'ver', 'HEAD': 'ver', 'OPTIONS': 'ver',
    'POST': 'crear', 'PUT': 'editar', 'PATCH': 'editar', 'DELETE': 'borrar',
}

# EL MAPA. Se recorre en orden y manda la PRIMERA que encaje.
#
#   (expresion, pantalla, accion_fija)
#
# `pantalla=None` es «esta no se vigila»: la app de campo entra por las
# mismas URL que la web, y un coordinador que recorre su tramo no tiene
# por que aparecer en la rejilla de una pantalla de escritorio. Esas van
# DELANTE, porque la primera que encaja gana.
#
# `accion_fija` es para cuando el metodo miente: un POST a `asignar/` no
# crea nada, modifica una rutina que ya existe, y pedir «crear» ahi
# obligaria a dar de alta rutinas a quien solo reparte tramos.
#
# LO QUE NO ESTE AQUI PASA. Bloquear a ciegas lo que no se entiende es
# como se rompe un sistema en produccion un viernes. Cada escritura que
# llega sin mapear queda apuntada en `SIN_MAPEAR` y se puede consultar.
RUTAS = (
    # ── Lo que usa la app de campo, por su cuenta ────────────────────────
    (r'^/api/v1/mobile/auth/', None, None),
    (r'^/api/v1/mobile/monitoreo/(mis-tramos|visitas|mi-aviso|telefono)/',
     None, None),
    (r'^/api/v1/mobile/monitoreo/tramos/[0-9]+/elementos/', None, None),
    (r'^/api/v1/mobile/devices/', None, None),

    # ── Monitoreo de Sistema Hidraulico ──────────────────────────────────
    (r'^/api/v1/mobile/monitoreo/rutinas/[0-9]+/asignar/', 'monitoreos',
     'editar'),
    (r'^/api/v1/mobile/monitoreo/hallazgos/[0-9]+/', 'hallazgos', 'borrar'),
    (r'^/api/v1/mobile/monitoreo/hallazgos/', 'hallazgos', None),
    (r'^/api/v1/mobile/monitoreo/', 'monitoreos', None),

    # ── Incidentes ───────────────────────────────────────────────────────
    (r'^/api/v1/mobile/hi-incidents/', 'lista', None),
    (r'^/api/v1/mobile/operations/incidentes-cerrados/', 'lista', None),
    (r'^/api/v1/mobile/operations/incidentes/gestion/', 'costeo', None),
    (r'^/api/v1/mobile/operations/incidentes/', 'lista', None),
    (r'^/api/v1/mobile/operations/incident-(materials|personnels)/',
     'costeo', None),

    # ── Costeo, partes y maquinaria ──────────────────────────────────────
    (r'^/api/v1/mobile/operations/daily-part-heavy', 'partes', None),
    (r'^/api/v1/mobile/operations/partes-diarios/', 'partes', None),
    (r'^/api/v1/mobile/operations/(maquinaria-estado|marcas|modelos|equipos)/',
     'maquinaria', None),
    (r'^/api/v1/mobile/operations/(partidas|cargos)/', 'costeo', None),

    # ── Obra ─────────────────────────────────────────────────────────────
    (r'^/api/v1/mobile/operations/partidas/avance-obra/', 'obra', None),
    (r'^/api/v1/mobile/operations/actividades-obra/', 'actividades', None),
    (r'^/api/v1/mobile/operations/actividades/', 'actividades', None),
    (r'^/api/v1/mobile/operations/proyectos/', 'proyectos', None),
    (r'^/api/v1/mobile/operations/rendicion/', 'rendicion', None),

    # ── Inventario ───────────────────────────────────────────────────────
    (r'^/api/v1/mobile/inventario/campanias/', 'inv-campanias', None),
    (r'^/api/v1/mobile/inventario/evaluaciones/', 'inv-campanias', None),
    (r'^/api/v1/mobile/inventario/', 'inv-mapa', None),

    # ── Usuarios y equipos ───────────────────────────────────────────────
    (r'^/api/v1/mobile/users/', 'equipos', None),

    # ── SENTRIA ──────────────────────────────────────────────────────────
    (r'^/api/v1/mobile/vulnerabilidades/', 'vigilancia', None),
)

_COMPILADAS = tuple((re.compile(p), pant, acc) for p, pant, acc in RUTAS)

PREFIJO = '/api/v1/mobile/'

# ══════════════════════════════════════════════════════════════════════════
# LA APP DE CAMPO NO ENTRA EN LA REJILLA
# ══════════════════════════════════════════════════════════════════════════
#
# PLUVIRA entra por LAS MISMAS URL que la web: el telefono reporta un
# incidente con POST /hi-incidents/, igual que la web lo lee con
# GET /hi-incidents/list/. Si la rejilla manda sobre las dos, el dia que
# alguien configure el rol `mobile_usuario` -que es exactamente lo que se
# va a hacer- todos los telefonos del canal dejan de poder reportar.
#
# Y FALLA CALLANDO. La cola sin conexion de la app guarda lo que no pudo
# subir y reintenta; ante un 403 reintenta igual que ante un corte de red
# y enseña «Hubo un error al sincronizar. Intenta en una zona con mejor
# señal.». O sea: el parte se queda en el telefono, la pantalla culpa a la
# cobertura, y nadie mira el servidor porque nadie sospecha del servidor.
#
# UNA PANTALLA ES UNA COSA DE LA WEB. Lo que gobierna a la app es su rol
# movil, como siempre. Asi que la rejilla solo se aplica a lo que llega
# DE UN NAVEGADOR.
#
# Como se reconoce: las cabeceras `Sec-Fetch-*` y `Origin` las pone el
# navegador solo, y el User-Agent de todos ellos lleva «Mozilla». El
# cliente http de Dart no manda ninguna de las tres: se presenta como
# «Dart/3.5 (dart:io)».
#
# HASTA DONDE LLEGA ESTO, dicho claro: quien sepa quitar esa cabecera se
# salta la rejilla. Pero no gana nada que su ROL MOVIL no le diera ya
# -los permisos de siempre siguen en cada vista-, y lo que se juega al
# apretar mas es que el canal se quede sin poder reportar. La rejilla es
# un control de lo que cada quien ve y toca en la web, no una muralla
# contra un usuario hostil que ya tiene credenciales.
NAVEGADOR = ('HTTP_SEC_FETCH_SITE', 'HTTP_SEC_FETCH_MODE', 'HTTP_SEC_FETCH_DEST',
             'HTTP_ORIGIN')


def del_navegador(request):
    m = request.META
    for c in NAVEGADOR:
        if m.get(c):
            return True
    return 'Mozilla' in (m.get('HTTP_USER_AGENT') or '')


# LO QUE NO SE VIGILA NUNCA, venga de donde venga.
#
# Son las rutas por las que el campo mete su trabajo. Si la deteccion de
# arriba fallara alguna vez -un navegador raro, un proxy que limpia
# cabeceras-, lo que NO puede pasar es que un reporte de campo se quede
# sin subir. Lo demas puede esperar a que alguien lo note; esto no.
#
# `POST /hi-incidents/` esta aqui y no cuesta nada: la web no crea
# incidentes por ahi, solo los lee y los gestiona. Crear es cosa del
# telefono.
SIEMPRE_LIBRES = (
    r'^/api/v1/mobile/auth/',
    r'^/api/v1/mobile/hi-incidents/$',
    r'^/api/v1/mobile/hi-report-files',
    r'^/api/v1/mobile/devices/',
    r'^/api/v1/mobile/monitoreo/(mis-tramos|visitas|mi-aviso|telefono)/',
)

_LIBRES = tuple(re.compile(p) for p in SIEMPRE_LIBRES)


def siempre_libre(ruta):
    for p in _LIBRES:
        if p.search(ruta):
            return True
    return False

# Lo que llega y no esta en el mapa, para poder anadirlo sabiendo que
# existe en vez de adivinando. Se queda en memoria y se consulta por
# `permisos/rutas/`; no se guarda en la base porque es una ayuda de
# diagnostico, no un registro.
SIN_MAPEAR = set()
TOPE_SIN_MAPEAR = 200


def que_toca(ruta, metodo):
    """(pantalla, accion) de una peticion, o (None, None) si no se vigila."""
    for patron, pantalla, fija in _COMPILADAS:
        if patron.search(ruta):
            if pantalla is None:
                return None, None
            return pantalla, (fija or POR_METODO.get(metodo, 'ver'))
    return None, None


# ══════════════════════════════════════════════════════════════════════════
# el middleware
# ══════════════════════════════════════════════════════════════════════════

class PermisosDePantalla(object):
    """El 403 de verdad, en un solo sitio.

    POR QUE AQUI Y NO EN CADA VISTA. Son ochenta endpoints: comprobarlo
    uno a uno es tocar ochenta archivos y olvidarse de alguno, y el que se
    olvide es justo el agujero. Aqui se mira la ruta que entra, se deduce
    que pantalla y que accion son, y se contesta antes de que la vista
    exista.

    QUIEN ES QUIEN. En una peticion con token, `request.user` todavia es
    anonimo en el middleware: DRF resuelve el token DENTRO de la vista.
    Asi que el token se mira aqui a mano. Si no se puede saber quien es,
    esto no decide nada y deja que lo rechace la autenticacion de siempre:
    confundir «no se quien eres» con «no puedes» convertiria cada fallo de
    sesion en un permiso denegado, que es un sintoma que no lleva a nada.
    """

    # Django >= 1.10 instancia el middleware con get_response; 1.8 no le
    # pasa nada. Admitir las dos formas cuesta una linea y evita que esto
    # se rompa el dia que el servidor se actualice.
    def __init__(self, get_response=None):
        self.get_response = get_response

    def __call__(self, request):
        respuesta = self.process_request(request)
        if respuesta is not None:
            return respuesta
        return self.get_response(request)

    def process_request(self, request):
        ruta = request.path or ''
        if not ruta.startswith(PREFIJO):
            return None

        # La app de campo va por su rol movil, no por la rejilla. Ver el
        # bloque largo de arriba: vigilarla deja al canal sin poder
        # reportar, y falla callando.
        if not del_navegador(request):
            return None
        if siempre_libre(ruta):
            return None

        pantalla, accion = que_toca(ruta, request.method)
        if pantalla is None:
            if (request.method not in ('GET', 'HEAD', 'OPTIONS')
                    and len(SIN_MAPEAR) < TOPE_SIN_MAPEAR):
                SIN_MAPEAR.add('%s %s' % (request.method, ruta))
            return None

        usuario = self._quien(request)
        if usuario is None:
            return None

        try:
            if permisos_de(usuario).get(pantalla, {}).get(accion):
                return None
        except Exception as e:
            # UNA TABLA QUE NO ESTA NO CIERRA EL SISTEMA. Si el codigo esta
            # puesto y la migracion no, esto reventaria en CADA peticion y
            # el servidor entero dejaria de responder. Se deja pasar y se
            # apunta: un permiso sin aplicar es un problema; un sistema
            # caido es otro mucho mayor.
            registro.warning('permisos de pantalla sin aplicar (%s): %s',
                             ruta, e)
            return None

        return JsonResponse(
            {'ok': False,
             'detail': 'No tienes permiso para %s en %s.' % (accion, pantalla),
             'pantalla': pantalla, 'accion': accion},
            status=403)

    @staticmethod
    def _quien(request):
        usuario = getattr(request, 'user', None)
        if _autenticado(usuario):
            return usuario
        cabecera = request.META.get('HTTP_AUTHORIZATION', '') or ''
        partes = cabecera.split()
        if len(partes) == 2 and partes[0].lower() in ('token', 'bearer'):
            try:
                from rest_framework.authtoken.models import Token
                return Token.objects.select_related('user').get(
                    key=partes[1]).user
            except Exception:
                return None
        return None


# ══════════════════════════════════════════════════════════════════════════
# los endpoints
# ══════════════════════════════════════════════════════════════════════════

@api_view(['GET'])
@permission_classes([IsAuthenticated])
def mios(request):
    """Lo que puede hacer QUIEN PREGUNTA. Lo usa la web para pintarse.

    Sin permiso de gerencia a proposito: todo el mundo tiene derecho a
    saber que puede hacer, y negarselo obligaria a la web a descubrirlo a
    base de 403, que es como se llena una pantalla de errores rojos.
    """
    return Response({'ok': True,
                     'permisos': permisos_de(request.user),
                     'pantallas': catalogo(),
                     'acciones': list(ACCIONES)})


@api_view(['GET'])
@permission_classes([EsGerencia])
def pantallas(request):
    """El catalogo, para que la web no lleve su propia copia."""
    return Response({'ok': True, 'pantallas': catalogo(),
                     'acciones': list(ACCIONES)})


@api_view(['GET', 'POST'])
@permission_classes([EsGerencia])
def por_rol(request):
    """La rejilla de los roles. GET la lee entera, POST guarda una.

    POST: {"rol": "mobile_usuario",
           "permisos": {"mapa": {"ver": true, ...}, ...}}

    SE GUARDA LA REJILLA ENTERA de ese rol, no la diferencia. Mandar
    cambios sueltos obliga a las dos partes a estar de acuerdo sobre lo
    que habia antes, y con dos personas configurando a la vez eso acaba
    en una pantalla que ensena lo que no es.

    Guardar una rejilla con todo en `false` NO es lo mismo que no haberla
    configurado: lo primero deja al rol sin nada, lo segundo lo deja como
    hoy. Para volver al estado de antes se manda `permisos: null`.
    """
    if request.method == 'GET':
        fuera = {}
        for f in PermisoDeRol.objects.all():
            fuera.setdefault(f.rol, {})[f.pantalla] = dict(
                (a, bool(getattr(f, a))) for a in ACCIONES)
        return Response({'ok': True, 'roles': fuera,
                         'pantallas': catalogo(),
                         'acciones': list(ACCIONES)})

    datos = request.data or {}
    rol = (datos.get('rol') or '').strip()
    if not rol:
        return Response({'ok': False, 'detail': 'Falta el rol.'},
                        status=status.HTTP_400_BAD_REQUEST)

    if 'permisos' in datos and datos.get('permisos') is None:
        PermisoDeRol.objects.filter(rol=rol).delete()
        return Response({'ok': True, 'rol': rol, 'sin_configurar': True})

    permisos = datos.get('permisos') or {}
    if not isinstance(permisos, dict):
        return Response({'ok': False, 'detail': 'permisos tiene que ser un '
                                                'objeto.'},
                        status=status.HTTP_400_BAD_REQUEST)

    desconocidas = [p for p in permisos if p not in CLAVES]
    if desconocidas:
        return Response({'ok': False,
                         'detail': 'Pantallas que no existen: %s'
                                   % ', '.join(sorted(desconocidas))},
                        status=status.HTTP_400_BAD_REQUEST)

    PermisoDeRol.objects.filter(rol=rol).delete()
    guardadas = 0
    for clave in CLAVES:
        fila = permisos.get(clave) or {}
        valores = dict((a, bool(fila.get(a))) for a in ACCIONES)
        if not any(valores.values()):
            # Una pantalla sin nada marcado no necesita fila: la ausencia
            # ya significa «nada». Guardarla solo engorda la tabla.
            continue
        PermisoDeRol.objects.create(rol=rol, pantalla=clave, **valores)
        guardadas += 1

    # SI TODO QUEDO EN BLANCO, SE GUARDA UNA FILA MUDA. Un rol con la
    # rejilla entera vacia tiene que quedar BLOQUEADO, y sin ninguna fila
    # se leeria como «sin configurar», que es justo lo contrario.
    if guardadas == 0:
        PermisoDeRol.objects.create(rol=rol, pantalla=CLAVES[0])

    return Response({'ok': True, 'rol': rol, 'pantallas_con_permiso': guardadas})


@api_view(['GET', 'POST'])
@permission_classes([EsGerencia])
def de_usuario(request, pk):
    """Las excepciones de una persona.

    POST: {"permisos": {"costeo": {"borrar": false}, "mapa": {"ver": true}}}

    Lo que no venga se queda como esta; mandar `null` en una accion la
    devuelve a lo que diga el rol. Aqui SI se manda la diferencia y no la
    rejilla entera, porque una excepcion es por definicion un retoque: si
    se mandara entera, cada guardado congelaria lo que el rol dice hoy y
    la persona dejaria de heredar los cambios de manana.
    """
    from django.contrib.auth import get_user_model
    Usuario = get_user_model()
    try:
        destino = Usuario.objects.get(pk=pk)
    except Usuario.DoesNotExist:
        return Response({'ok': False, 'detail': 'No existe ese usuario.'},
                        status=status.HTTP_404_NOT_FOUND)

    if request.method == 'GET':
        propias = {}
        for e in PermisoDeUsuario.objects.filter(usuario=destino):
            propias[e.pantalla] = dict((a, getattr(e, a)) for a in ACCIONES)
        return Response({'ok': True,
                         'usuario': {'id': destino.pk,
                                     'username': destino.get_username()},
                         'roles': list(destino.groups.values_list(
                             'name', flat=True)),
                         'excepciones': propias,
                         'efectivos': permisos_de(destino),
                         'pantallas': catalogo(),
                         'acciones': list(ACCIONES)})

    datos = request.data or {}
    permisos = datos.get('permisos')
    if permisos is None:
        PermisoDeUsuario.objects.filter(usuario=destino).delete()
        return Response({'ok': True, 'sin_excepciones': True,
                         'efectivos': permisos_de(destino)})
    if not isinstance(permisos, dict):
        return Response({'ok': False,
                         'detail': 'permisos tiene que ser un objeto.'},
                        status=status.HTTP_400_BAD_REQUEST)

    desconocidas = [p for p in permisos if p not in CLAVES]
    if desconocidas:
        return Response({'ok': False,
                         'detail': 'Pantallas que no existen: %s'
                                   % ', '.join(sorted(desconocidas))},
                        status=status.HTTP_400_BAD_REQUEST)

    for clave, fila in permisos.items():
        if not isinstance(fila, dict):
            continue
        obj, _ = PermisoDeUsuario.objects.get_or_create(
            usuario=destino, pantalla=clave)
        for a in ACCIONES:
            if a in fila:
                v = fila[a]
                setattr(obj, a, None if v is None else bool(v))
        if all(getattr(obj, a) is None for a in ACCIONES):
            # Una excepcion que ya no excepciona nada se borra: dejarla
            # haria creer, al mirar la ficha, que esa persona tiene un
            # retoque cuando hereda del rol como todos.
            obj.delete()
        else:
            obj.save()

    return Response({'ok': True, 'efectivos': permisos_de(destino)})


@api_view(['GET'])
@permission_classes([EsGerencia])
def rutas(request):
    """El mapa de rutas y lo que ha llegado sin mapear.

    Para saber que falta por vigilar sin tener que adivinarlo: lo que
    aparezca en `sin_mapear` es una escritura real que entro por una URL
    que el mapa no conoce.
    """
    return Response({'ok': True,
                     'rutas': [{'patron': p, 'pantalla': pant,
                                'accion': acc} for p, pant, acc in RUTAS],
                     'siempre_libres': list(SIEMPRE_LIBRES),
                     'solo_navegador': True,
                     'por_metodo': POR_METODO,
                     'sin_mapear': sorted(SIN_MAPEAR)})
'''


# ══════════════════════════════════════════════════════════════════════════
# 3. las rutas
# ══════════════════════════════════════════════════════════════════════════

IMPORT_URLS = ("from src.apps.core.permisos_pantalla import (\\n"
               "    mios as perm_mios,\\n"
               "    pantallas as perm_pantallas,\\n"
               "    por_rol as perm_por_rol,\\n"
               "    de_usuario as perm_de_usuario,\\n"
               "    rutas as perm_rutas,\\n"
               ")\\n")

RUTAS_NUEVAS = (
    "    # Permisos por pantalla.\n"
    "    url(r'^v1/mobile/permisos/mios/$',\n"
    "        perm_mios, name='permisos_mios'),\n"
    "    url(r'^v1/mobile/permisos/pantallas/$',\n"
    "        perm_pantallas, name='permisos_pantallas'),\n"
    "    url(r'^v1/mobile/permisos/roles/$',\n"
    "        perm_por_rol, name='permisos_roles'),\n"
    "    url(r'^v1/mobile/permisos/usuarios/(?P<pk>[0-9]+)/$',\n"
    "        perm_de_usuario, name='permisos_usuario'),\n"
    "    url(r'^v1/mobile/permisos/rutas/$',\n"
    "        perm_rutas, name='permisos_rutas'),\n")


# ══════════════════════════════════════════════════════════════════════════
# herramientas (las mismas del parche de monitoreos, ya probadas)
# ══════════════════════════════════════════════════════════════════════════

# `config/settings.py` NO esta aqui: se busca, porque no siempre esta en
# esa ruta. Lo restaura `revertir` por su cuenta.
TOCADOS = (
    'src/apps/core/models.py',
    'src/apps/api/urls.py',
)


def leer(ruta):
    with open(ruta, 'rb') as f:
        return f.read().decode('utf-8')


def escribir(ruta, texto, simulacro):
    """Guarda, con copia de seguridad y comprobando que sigue siendo Python.

    COMPILA ANTES DE ESCRIBIR. Un parche que deja un archivo a medias tira
    el servidor entero, y el error que sale entonces -un ImportError en el
    arranque- no se parece en nada a la causa. Si lo que iba a escribir no
    compila, no se escribe nada.
    """
    if ruta.endswith('.py'):
        try:
            compile(texto, ruta, 'exec')
        except SyntaxError as e:
            raise RuntimeError(
                'lo que iba a escribir en {0} no es Python valido (linea '
                '{1}: {2}). No se toco el archivo.'.format(
                    os.path.basename(ruta), e.lineno, e.msg))
    if simulacro:
        return
    if os.path.exists(ruta) and not os.path.exists(ruta + '.bak'):
        shutil.copy2(ruta, ruta + '.bak')
    with open(ruta, 'wb') as f:
        f.write(texto.encode('utf-8'))


# LA MISMA QUE parche_monitoreo_rutinario.py, letra por letra.
#
# Tenia aqui una version corta que no contaba los parentesis, y con un
# import de varias lineas en columna cero -los que escribe el otro
# parche- decia que los imports acababan DENTRO del parentesis. Lo que
# se escribia no compilaba, `escribir` se negaba -para eso esta- y el
# paso moria con un «reviento» que no decia nada de la causa.
#
# Aquella version salio de romper PLUVIRA de esta misma manera. Copiarla
# es mejor que volver a escribirla: el error ya se cometio una vez.
def fin_de_imports(texto):
    """El indice de linea justo despues del ultimo import DE LA CABECERA.

    Solo cuentan los imports a columna cero -estos proyectos importan dentro
    de las funciones- y se para en la primera sentencia de verdad. Las dos
    reglas salieron de romper PLUVIRA metiendo un import en mitad de un
    metodo.
    """
    lineas = texto.splitlines(True)
    fin, i, total = 0, 0, len(texto.splitlines(True))
    comilla, abiertos, dentro = None, 0, False

    while i < total:
        l = lineas[i]
        pelada = l.strip()

        if comilla is not None:
            i += 1
            fin = i
            if comilla in pelada:
                comilla = None
            continue

        if dentro:
            abiertos += l.count('(') - l.count(')')
            i += 1
            if abiertos <= 0:
                dentro = False
                fin = i
            continue

        if not pelada or pelada.startswith('#'):
            i += 1
            continue

        if pelada[:3] in ('"""', "'''"):
            marca = pelada[:3]
            i += 1
            fin = i
            if marca not in pelada[3:]:
                comilla = marca
            continue

        if l[:1] in (' ', '\t'):
            break

        if pelada.startswith('import ') or pelada.startswith('from '):
            dentro = True
            abiertos = l.count('(') - l.count(')')
            i += 1
            if abiertos <= 0:
                dentro = False
                fin = i
            continue

        break

    return fin


def insertar_linea(texto, donde, linea):
    lineas = texto.splitlines(True)
    return ''.join(lineas[:donde]) + linea + ''.join(lineas[donde:])


def revertir(raiz):
    settings = buscar_settings(raiz)
    if settings and os.path.exists(settings + '.bak'):
        shutil.copy2(settings + '.bak', settings)
        print('[OK ] restaurado {0}'.format(os.path.relpath(settings, raiz)))
    for rel in TOCADOS:
        ruta = os.path.join(raiz, rel)
        if os.path.exists(ruta + '.bak'):
            shutil.copy2(ruta + '.bak', ruta)
            print('[OK ] restaurado {0}'.format(rel))
        else:
            print('[   ] sin copia   {0}'.format(rel))
    modulo = os.path.join(raiz, 'src/apps/core/permisos_pantalla.py')
    if os.path.exists(modulo):
        os.remove(modulo)
        print('[OK ] borrado     src/apps/core/permisos_pantalla.py')
    print('\nLa migracion y sus tablas NO se tocan: borrarlas se lleva por '
          'delante la configuracion. Si quieres deshacerla: '
          'manage.py migrate core <la anterior>')


# ══════════════════════════════════════════════════════════════════════════
# los pasos
# ══════════════════════════════════════════════════════════════════════════

def paso_modelos(raiz, simulacro):
    ruta = os.path.join(raiz, 'src/apps/core/models.py')
    if not os.path.exists(ruta):
        return False, 'no existe {0}'.format(ruta)
    t = leer(ruta)
    if 'class PermisoDeRol' in t:
        return True, 'ya estaba'
    if 'from django.conf import settings' not in t:
        t = insertar_linea(t, fin_de_imports(t),
                           'from django.conf import settings\n')
    escribir(ruta, t.rstrip('\n') + '\n' + MODELOS, simulacro)
    return True, 'PermisoDeRol y PermisoDeUsuario'


def paso_migracion(raiz, simulacro):
    carpeta = os.path.join(raiz, 'src/apps/core/migrations')
    if not os.path.isdir(carpeta):
        return False, 'no existe {0}'.format(carpeta)
    previas = sorted(n[:-3] for n in os.listdir(carpeta)
                     if n.endswith('.py') and n != '__init__.py')
    if not previas:
        return False, 'core no tiene migraciones; algo no cuadra'
    if any('permisos_pantalla' in n for n in previas):
        return True, 'ya estaba'
    anterior = previas[-1]
    nombre = '{0:04d}_permisos_pantalla.py'.format(int(anterior[:4]) + 1)
    escribir(os.path.join(carpeta, nombre),
             MIGRACION % {'anterior': anterior}, simulacro)
    return True, nombre


def paso_modulo(raiz, simulacro):
    destino = os.path.join(raiz, 'src/apps/core/permisos_pantalla.py')
    if not os.path.exists(os.path.join(raiz, 'src/apps/core/equipo_enlazado.py')):
        return False, 'falta src/apps/core/equipo_enlazado.py, de donde sale EsGerencia'
    escribir(destino, MODULO, simulacro)
    return True, 'modulo de permisos'


def paso_urls(raiz, simulacro):
    ruta = os.path.join(raiz, 'src/apps/api/urls.py')
    if not os.path.exists(ruta):
        return False, 'no existe {0}'.format(ruta)
    t = leer(ruta)
    if 'perm_mios' in t:
        return True, 'ya estaba'

    lineas = t.splitlines(True)
    destino = None
    for i, l in enumerate(lineas):
        if re.search(r"url\(\s*r'\^v1/mobile/", l):
            destino = i
            break
    if destino is None:
        return False, 'no encuentro ninguna ruta v1/mobile/ en urls.py'
    while destino > 0 and lineas[destino - 1].strip().startswith('#'):
        destino -= 1

    t = ''.join(lineas[:destino]) + RUTAS_NUEVAS + ''.join(lineas[destino:])
    t = insertar_linea(t, fin_de_imports(t), IMPORT_URLS.replace('\\n', '\n'))
    escribir(ruta, t, simulacro)
    return True, 'import y 5 rutas anadidos'


CAMINO_MIDDLEWARE = "'src.apps.core.permisos_pantalla.PermisosDePantalla',"


def buscar_settings(raiz):
    """Donde vive de verdad el settings.py de este proyecto.

    NO SE ADIVINA LA RUTA. `config/settings.py` es lo normal, pero tambien
    existen `config/settings/base.py`, `src/config/settings.py` y el
    nombre del proyecto por carpeta. Dar una por buena y fallar deja un
    mensaje -«no existe config/settings.py»- que suena a proyecto roto
    cuando lo unico que pasa es que esta en otro sitio.

    Se pregunta a manage.py, que es quien lo sabe: ahi esta escrito el
    DJANGO_SETTINGS_MODULE de verdad. Si no se puede leer, se prueban las
    rutas corrientes, y de todas ellas solo vale la que tenga una lista de
    middleware: en un settings partido en varios archivos, el que importa
    es ese y no el que lleva el nombre.
    """
    candidatas = []

    for arranque in ('manage.py', 'config/wsgi.py', 'src/config/wsgi.py'):
        ruta = os.path.join(raiz, arranque)
        if not os.path.exists(ruta):
            continue
        try:
            texto = leer(ruta)
        except Exception:
            continue
        for m in re.finditer(r"DJANGO_SETTINGS_MODULE[^\n]*?['\"]([\w.]+)['\"]",
                             texto):
            punteado = m.group(1).replace('.', os.sep)
            candidatas.append(punteado + '.py')
            candidatas.append(os.path.join(punteado, '__init__.py'))
            for hoja in ('base.py', 'produccion.py', 'production.py',
                         'prod.py', 'common.py'):
                candidatas.append(os.path.join(punteado, hoja))

    candidatas += [
        'config/settings.py',
        os.path.join('config', 'settings', 'base.py'),
        os.path.join('config', 'settings', '__init__.py'),
        'src/config/settings.py',
        'settings.py',
    ]

    # Y si nada de eso, cualquier settings.py del arbol que tenga la lista.
    for base, carpetas, archivos in os.walk(raiz):
        carpetas[:] = [c for c in carpetas
                       if c not in ('.git', 'node_modules', 'staticfiles',
                                    'media', '__pycache__', 'venv', '.venv')]
        for n in archivos:
            if n in ('settings.py', 'base.py'):
                candidatas.append(os.path.relpath(
                    os.path.join(base, n), raiz))

    vistas = set()
    for rel in candidatas:
        if rel in vistas:
            continue
        vistas.add(rel)
        ruta = os.path.join(raiz, rel)
        if not os.path.isfile(ruta):
            continue
        try:
            if re.search(r'^(MIDDLEWARE_CLASSES|MIDDLEWARE)\s*=\s*[\[(]',
                         leer(ruta), re.M):
                return ruta
        except Exception:
            continue
    return None


def paso_settings(raiz, simulacro):
    """Mete el middleware en su lista, el ULTIMO.

    EL ORDEN NO ES CAPRICHO. Tiene que ir detras de
    AuthenticationMiddleware: antes de el, `request.user` todavia no
    existe y el permiso se resolveria siempre contra un anonimo. Como
    ponerlo al final cumple eso siempre, se pone al final.
    """
    ruta = buscar_settings(raiz)
    if ruta is None:
        return False, ('no encuentro ningun settings con MIDDLEWARE; '
                       'dime donde esta y lo meto ahi')
    t = leer(ruta)
    if 'PermisosDePantalla' in t:
        return True, 'ya estaba'

    m = re.search(r'^(MIDDLEWARE_CLASSES|MIDDLEWARE)\s*=\s*[\[(]', t, re.M)
    if not m:
        return False, 'no encuentro MIDDLEWARE ni MIDDLEWARE_CLASSES'

    cierre = ']' if t[m.end() - 1] == '[' else ')'
    fin = t.find('\n%s' % cierre, m.end())
    if fin == -1:
        return False, 'no encuentro el final de la lista de middleware'

    # Con la sangria de la ultima linea de la lista, para que no cante.
    anterior = t.rfind('\n', 0, fin)
    sangria = re.match(r'[ \t]*', t[anterior + 1:fin]).group(0) or '    '
    t = t[:fin] + '\n' + sangria + CAMINO_MIDDLEWARE + t[fin:]
    escribir(ruta, t, simulacro)
    return True, '{0} de {1}'.format(
        m.group(1), os.path.relpath(ruta, raiz))


# ══════════════════════════════════════════════════════════════════════════

CANDIDATAS = ('/var/www/envs/prod', '/app')


def buscar_raiz():
    for c in CANDIDATAS:
        if os.path.isfile(os.path.join(c, 'src/apps/api/urls.py')):
            return c
    return None


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--raiz', default=None)
    p.add_argument('--aplicar', action='store_true')
    p.add_argument('--revertir', action='store_true')
    args = p.parse_args()
    simulacro = not args.aplicar

    if args.raiz is None:
        args.raiz = buscar_raiz()
        if args.raiz is None:
            print('No encuentro el proyecto de PLUVIRA. Mire en:')
            for c in CANDIDATAS:
                print('  - {0}/src/apps/api/urls.py'.format(c))
            print('\nSi esta en otro sitio, pasalo con --raiz.')
            sys.exit(1)
    elif not os.path.isfile(os.path.join(args.raiz, 'src/apps/api/urls.py')):
        print('No parece el proyecto de PLUVIRA: no hay '
              '{0}/src/apps/api/urls.py'.format(args.raiz))
        otra = buscar_raiz()
        if otra:
            print('Pero si lo hay en {0}: prueba --raiz {0}'.format(otra))
        sys.exit(1)

    if args.revertir:
        print('Raiz: {0}\nModo: DESHACIENDO\n'.format(args.raiz))
        revertir(args.raiz)
        print('\nReinicia jurp_web.')
        return

    print('Raiz: {0}'.format(args.raiz))
    print('Modo: {0}\n'.format('SIMULACRO (no escribe nada)' if simulacro
                               else 'APLICANDO'))

    pasos = [
        ('modelos', paso_modelos),
        ('migracion', paso_migracion),
        ('modulo', paso_modulo),
        ('urls.py', paso_urls),
        ('settings', paso_settings),
    ]

    todo_bien = True
    for i, (nombre, fn) in enumerate(pasos, 1):
        try:
            ok, que = fn(args.raiz, simulacro)
        except Exception as e:
            ok, que = False, 'reviento: {0}'.format(e)
        print('[{0}] {1} {2:<12} {3}'.format(
            'OK ' if ok else 'MAL', i, nombre, que))
        if not ok:
            todo_bien = False
            break

    if not todo_bien:
        print('\nNO se aplico todo. Parado asi, el proyecto esta como estaba.')
        sys.exit(1)

    if simulacro:
        print('\nTodo cuadra. Para escribirlo: --aplicar')
        return

    print("""
Aplicado. Ahora:

    manage.py makemigrations core --dry-run   # "No changes detected"
    manage.py migrate core
    reiniciar jurp_web

NADIE PIERDE NADA AL APLICARLO. Un rol sin configurar se comporta como
hoy; la rejilla empieza a mandar en cuanto se guarda por primera vez.
Los superusuarios y el staff no se tocan nunca.

Para ver que rutas quedan sin vigilar segun se vayan usando:

    GET /api/v1/mobile/permisos/rutas/   ->  "sin_mapear"
""")


if __name__ == '__main__':
    main()
