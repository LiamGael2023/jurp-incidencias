# -*- coding: utf-8 -*-
"""Monitoreos rutinarios: las tablas y los endpoints. Solo PLUVIRA.

    python3 parche_monitoreo_rutinario.py              # simulacro
    python3 parche_monitoreo_rutinario.py --aplicar
    python3 parche_monitoreo_rutinario.py --revertir   # deshace los injertos

SE CORRE DONDE VIVE PLUVIRA (/var/www/envs/prod), igual que el del canal de
acceso. Django 1.8, Python 3.5, DRF 3.6, rutas con url(r'^...$').

QUE ES ESTO
-----------
El administrador crea una RUTINA con fecha de inicio y fin. La rutina tiene
los 14 tramos del Canal Madre (0 y I a XIII) y a cada uno se le asigna un
usuario de mobile_gerencia, que es quien va a recorrerlo. En la app, ese
usuario ve solo sus tramos y registra la visita: o "sin novedad", o un
hallazgo, con el mismo formulario con el que hoy se reporta un incidente.

EL HALLAZGO NO SE COPIA, SE ENLAZA
----------------------------------
HIIncident ya existe y arrastra detras el timeline, las acciones, los partes
y el cierre. Duplicar sus doce campos en una tabla nueva seria mantener dos
vocabularios para lo mismo, y dentro de seis meses nadie sabria cual manda.
Asi que la visita guarda quien fue, cuando y si hubo novedad, y cuando la
hubo apunta al HIIncident que creo el endpoint de siempre.

Y al reves: las visitas "sin novedad" -que van a ser la mayoria- NO crean
incidente. Si lo hicieran, la lista de incidencias, el conteo por severidad
y los reportes quedarian inservibles en una semana.

EL CUADRO DE EMPRESAS ES OTRA COSA
----------------------------------
Las empresas y coordinadores del cuadro de JURP no son quien inspecciona:
son a quien avisar cuando aparece algo en ese tramo. Por eso van en su
propia tabla, independiente de las rutinas -el cuadro dura, las rutinas van
y vienen- y se siembran con la migracion.

QUE TOCA
--------
    1. src/apps/core/models.py              cuatro tablas, al final
    2. src/apps/core/migrations/XXXX_...py  la migracion y la siembra (NUEVO)
    3. src/apps/core/monitoreo.py           los endpoints            (NUEVO)
    4. src/apps/api/urls.py                 el import y las rutas

De codigo que ya funciona se toca UN sitio: las rutas. Nada de hi_incidents
se modifica.
"""

from __future__ import print_function

import argparse
import os
import re
import shutil
import sys


TRAMOS = ['0', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X',
          'XI', 'XII', 'XIII']

# El cuadro de JURP del 2026-11-04: (tramo, empresa, coordinador, celular).
CUADRO = [
    ('0', 'JURP - PECH', 'ILICH LOPEZ', '962727211'),
    ('I', 'DESHIDRATADORA LIBERTAD', 'ANGEL AREVALO', '954462914'),
    ('II', 'HASS PERU', 'LUIS RODRIGUEZ', '943778120'),
    ('II', 'HASS PERU', 'LUISA GUTIERREZ GUZMAN', '913358323'),
    ('III', 'HORTIFRUT', 'MIGUEL BARRAZA ARBULU', '949161291'),
    ('III', 'HORTIFRUT', 'ALEX VASQUEZ CALVANAPON', '987989098'),
    ('III', 'AVO PERU', 'EMILIO ALVAREZ', '987935576'),
    ('III', 'AVO PERU', 'VICTOR ROMERO LUDENA', '948310551'),
    ('IV', 'CAMPOSOL CHAO', 'JENNY MACEDO RODRIGUEZ', '943525215'),
    ('IV', 'CAMPOSOL CHAO', 'JAVIER SILVA ROSALES', '938207916'),
    ('IV', 'CAMPOSOL CHAO', 'FRANK RODRIGUEZ', '969219489'),
    ('V', 'ARATO PERU', 'IRINA VALDIVIEZO', '919298255'),
    ('V', 'ARATO PERU', 'ALEXANDER CONTRERAS', '970518874'),
    ('V', 'TALSA', 'EMILIO ALVAREZ', '987935576'),
    ('V', 'TALSA', 'VICTOR ROMERO LUDENA', '948310551'),
    ('VI', 'CAMPOSOL VIRU', 'JENNY MACEDO RODRIGUEZ', '943525215'),
    ('VI', 'CAMPOSOL VIRU', 'JAVIER SILVA ROSALES', '938207916'),
    ('VII', 'NORTE VERDE', 'GUILLERMO ALEGRIA', '970100112'),
    ('VIII', 'SOCIEDAD AGRICOLA EL ARENAL', 'GENNER RODRIGUEZ', '953614051'),
    ('IX', 'VIRU S.A.', 'VANIA DE LA CRUZ', '914421168'),
    ('IX', 'VIRU S.A.', 'YORDY AQUINO', '953724781'),
    ('X', 'BEGGIE', 'EDWIN PAREDES', '987129049'),
    ('X', 'BEGGIE', 'YERSON ALAYO', '981545340'),
    ('X', 'AGROBERRIES', 'JUANA MARINOS', '913355950'),
    ('XI', 'LAREDO', 'CARLOS GUZMAN RODRIGUEZ', '981072008'),
    ('XI', 'LAREDO', 'HENRY CUBA RODRIGUEZ', '989174008'),
    ('XII', 'GREEN PERU', 'ROBERTO INFANTE', '946526804'),
    ('XII', 'GREEN PERU', 'MARTIN GARCIA', '903231745'),
    ('XIII', 'DANPER', 'JHON JHONY LUJAN', '953254195'),
    ('XIII', 'DANPER', 'TONY ARAUJO', '949144669'),
]


# ══════════════════════════════════════════════════════════════════════════
# 1. las tablas
# ══════════════════════════════════════════════════════════════════════════

MODELOS = '''

# ══════════════════════════════════════════════════════════════════════════
# MONITOREOS RUTINARIOS   (lo escribe parche_monitoreo_rutinario.py)
# ══════════════════════════════════════════════════════════════════════════

TRAMOS_CANAL = ['0', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX',
                'X', 'XI', 'XII', 'XIII']

OPCIONES_TRAMO = tuple((t, 'Tramo %s' % t) for t in TRAMOS_CANAL)


class ResponsableTramo(models.Model):
    """A quien avisar cuando aparece algo en un tramo.

    NO ES QUIEN INSPECCIONA. Es la empresa usuaria del tramo y su
    coordinador, del cuadro que mantiene JURP. Quien recorre el tramo es el
    usuario de gerencia que se asigne en cada rutina, y son dos listas
    distintas que conviene no mezclar: el cuadro dura anos, las asignaciones
    cambian en cada rutina.

    Una fila por coordinador, no por empresa: un tramo puede tener dos
    empresas (III, V y X) y una empresa varios coordinadores con celulares
    distintos, y lo que hace falta a la hora de llamar es el telefono de
    una persona, no el de una razon social.
    """

    tramo = models.CharField('Tramo', max_length=6, choices=OPCIONES_TRAMO,
                             db_index=True)
    empresa = models.CharField('Empresa', max_length=120)
    coordinador = models.CharField('Coordinador', max_length=120)
    celular = models.CharField('Celular', max_length=20, blank=True, default='')
    activo = models.BooleanField('Vigente', default=True)

    class Meta:
        verbose_name = 'Responsable de tramo'
        verbose_name_plural = 'Responsables de tramo'
        ordering = ['tramo', 'empresa', 'coordinador']

    def __str__(self):
        return '%s - %s (%s)' % (self.tramo, self.empresa, self.coordinador)


class RutinaMonitoreo(models.Model):
    """Una ronda de monitoreo, con fecha de inicio y de fin.

    UNA RONDA Y NO UN CALENDARIO. Para repetirla se crea otra. Es mas
    trabajo de oficina que una rutina que se repita sola, pero cada ronda
    queda cerrada con sus fechas, sus asignaciones y sus partes, y "que paso
    en la de marzo" tiene una respuesta exacta. Una recurrente obliga a
    decidir que pasa cuando alguien no cumple, si la siguiente arrastra lo
    pendiente, y que significa cambiar el responsable a mitad de ano.
    """

    nombre = models.CharField('Nombre', max_length=140)
    fecha_inicio = models.DateField('Desde')
    fecha_fin = models.DateField('Hasta')
    notas = models.TextField('Notas', blank=True, default='')
    cerrada = models.BooleanField('Cerrada', default=False)

    creada_por = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True,
        blank=True, related_name='rutinas_creadas', verbose_name='Creada por')
    creada_en = models.DateTimeField('Creada el', auto_now_add=True)

    class Meta:
        verbose_name = 'Rutina de monitoreo'
        verbose_name_plural = 'Rutinas de monitoreo'
        ordering = ['-fecha_inicio', '-id']

    def __str__(self):
        return self.nombre

    def vigente(self, dia=None):
        """Si el dia de hoy cae dentro de la ronda.

        LAS FECHAS SE NORMALIZAN ANTES DE COMPARAR. Un objeto recien creado
        con create(fecha_inicio='2026-11-01') conserva la CADENA en memoria
        -Django convierte al leer de la base, no al escribir-, y en Python 3
        comparar una cadena con una fecha es un TypeError, no un False.

        Paso de verdad: el endpoint de crear guardaba bien la rutina y sus
        catorce tramos, y reventaba despues, al armar la respuesta. Desde
        fuera parecia que no se habia creado nada.
        """
        from django.utils import timezone
        from django.utils.dateparse import parse_date

        def como_fecha(v):
            return parse_date(v) if isinstance(v, str) else v

        ini, fin = como_fecha(self.fecha_inicio), como_fecha(self.fecha_fin)
        if ini is None or fin is None:
            return False
        d = dia or timezone.localtime(timezone.now()).date()
        return (not self.cerrada) and ini <= d <= fin


class TramoDeRutina(models.Model):
    """Un tramo dentro de una rutina, con quien tiene que ir a recorrerlo.

    DE UNA A VARIAS PERSONAS. Un tramo largo se reparte, y hay tramos con
    dos empresas usuarias -el III, el V y el X- donde cada una manda a su
    coordinador. Con un solo responsable por tramo habria que elegir cual de
    los dos consta, y el otro recorreria sin que nadie lo supiera.

    Puede quedar vacio: una rutina se crea con sus tramos y las asignaciones
    se ponen despues, a veces al dia siguiente. Un tramo sin asignar tiene
    que poder existir y verse, porque es justo lo que hay que mirar antes de
    arrancar la ronda.
    """

    rutina = models.ForeignKey(
        RutinaMonitoreo, on_delete=models.CASCADE, related_name='tramos',
        verbose_name='Rutina')
    tramo = models.CharField('Tramo', max_length=6, choices=OPCIONES_TRAMO,
                             db_index=True)
    usuarios = models.ManyToManyField(
        settings.AUTH_USER_MODEL, blank=True,
        related_name='tramos_a_recorrer', verbose_name='Asignado a')
    asignado_en = models.DateTimeField('Asignado el', null=True, blank=True)

    class Meta:
        verbose_name = 'Tramo de rutina'
        verbose_name_plural = 'Tramos de rutina'
        unique_together = ('rutina', 'tramo')
        ordering = ['rutina', 'id']

    def __str__(self):
        return '%s - Tramo %s' % (self.rutina, self.tramo)


class VisitaMonitoreo(models.Model):
    """Lo que se registra al recorrer un tramo.

    DOS RESULTADOS: sin novedad, o con hallazgo. El hallazgo NO copia los
    campos del incidente -se enlaza al HIIncident que creo el endpoint de
    siempre-, asi hereda su timeline, sus acciones y su cierre sin que nadie
    mantenga dos copias del mismo vocabulario.

    Y las de "sin novedad" no crean incidente: van a ser la mayoria, y
    metidas en la lista de incidencias dejarian el conteo por severidad y
    los reportes inservibles en una semana.

    Se admite mas de una visita por tramo: un recorrido puede encontrar dos
    cosas, y partirlas en dos incidentes es lo correcto porque se atienden y
    se cierran por separado. El tramo cuenta como recorrido con la primera.
    """

    tramo_rutina = models.ForeignKey(
        TramoDeRutina, on_delete=models.CASCADE, related_name='visitas',
        verbose_name='Tramo de rutina')
    usuario = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True,
        blank=True, related_name='visitas_monitoreo', verbose_name='Registro')

    sin_novedad = models.BooleanField('Sin novedad', default=True)
    observacion = models.TextField('Observacion', blank=True, default='')

    latitude = models.DecimalField('Latitud', max_digits=12, decimal_places=8,
                                   null=True, blank=True)
    longitude = models.DecimalField('Longitud', max_digits=12,
                                    decimal_places=8, null=True, blank=True)

    # El hallazgo. Se deja en SET_NULL: si alguien borra el incidente, la
    # visita no desaparece -consta que esa persona si fue-.
    incidente = models.ForeignKey(
        'hi_incidents.HIIncident', on_delete=models.SET_NULL, null=True,
        blank=True, related_name='visitas_monitoreo',
        verbose_name='Incidente levantado')

    creada_en = models.DateTimeField('Registrada el', auto_now_add=True)

    class Meta:
        verbose_name = 'Visita de monitoreo'
        verbose_name_plural = 'Visitas de monitoreo'
        ordering = ['-creada_en']

    def __str__(self):
        return '%s - %s' % (self.tramo_rutina,
                            'sin novedad' if self.sin_novedad else 'con hallazgo')
'''


# ══════════════════════════════════════════════════════════════════════════
# 2. la migracion, con la siembra del cuadro
# ══════════════════════════════════════════════════════════════════════════

MIGRACION = '''# -*- coding: utf-8 -*-
# Lo escribe parche_monitoreo_rutinario.py. Comprobable con:
#     manage.py makemigrations core --dry-run    ->  "No changes detected"
from __future__ import unicode_literals

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


# El cuadro de JURP del 2026-11-04. Se siembra aqui y no a mano para que
# quien instale esto en limpio no tenga que acordarse de un paso suelto.
CUADRO = %(cuadro)s


def sembrar(apps, schema_editor):
    """Mete el cuadro, pero solo si la tabla esta vacia.

    Si alguien ya corrigio un celular o dio de baja a un coordinador, esto
    no puede pisarselo: una migracion que reescribe datos editados es una
    sorpresa muy cara. Vacia = instalacion nueva, y entonces si.
    """
    Responsable = apps.get_model('core', 'ResponsableTramo')
    if Responsable.objects.exists():
        return
    Responsable.objects.bulk_create([
        Responsable(tramo=t, empresa=e, coordinador=c, celular=cel,
                    activo=True)
        for (t, e, c, cel) in CUADRO
    ])


def desembrar(apps, schema_editor):
    # A proposito no borra nada: al revertir la migracion la tabla se cae
    # entera de todos modos, y si alguien revierte solo los datos es que
    # queria conservarlos.
    pass


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        # __first__ y no un nombre concreto: si la primera migracion de
        # hi_incidents se llama de otro modo, fijarla aqui hace que migrate
        # falle con un error que no apunta a este archivo.
        ('hi_incidents', '__first__'),
        ('core', '%(anterior)s'),
    ]

    operations = [
        migrations.CreateModel(
            name='ResponsableTramo',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True,
                                        serialize=False, verbose_name='ID')),
                ('tramo', models.CharField(
                    choices=%(opciones)s, db_index=True, max_length=6,
                    verbose_name='Tramo')),
                ('empresa', models.CharField(max_length=120,
                                             verbose_name='Empresa')),
                ('coordinador', models.CharField(max_length=120,
                                                 verbose_name='Coordinador')),
                ('celular', models.CharField(blank=True, default='',
                                             max_length=20,
                                             verbose_name='Celular')),
                ('activo', models.BooleanField(default=True,
                                               verbose_name='Vigente')),
            ],
            options={
                'ordering': ['tramo', 'empresa', 'coordinador'],
                'verbose_name': 'Responsable de tramo',
                'verbose_name_plural': 'Responsables de tramo',
            },
        ),
        migrations.CreateModel(
            name='RutinaMonitoreo',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True,
                                        serialize=False, verbose_name='ID')),
                ('nombre', models.CharField(max_length=140,
                                            verbose_name='Nombre')),
                ('fecha_inicio', models.DateField(verbose_name='Desde')),
                ('fecha_fin', models.DateField(verbose_name='Hasta')),
                ('notas', models.TextField(blank=True, default='',
                                           verbose_name='Notas')),
                ('cerrada', models.BooleanField(default=False,
                                                verbose_name='Cerrada')),
                ('creada_en', models.DateTimeField(
                    auto_now_add=True, verbose_name='Creada el')),
                ('creada_por', models.ForeignKey(
                    blank=True, null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name='rutinas_creadas',
                    to=settings.AUTH_USER_MODEL, verbose_name='Creada por')),
            ],
            options={
                'ordering': ['-fecha_inicio', '-id'],
                'verbose_name': 'Rutina de monitoreo',
                'verbose_name_plural': 'Rutinas de monitoreo',
            },
        ),
        migrations.CreateModel(
            name='TramoDeRutina',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True,
                                        serialize=False, verbose_name='ID')),
                ('tramo', models.CharField(
                    choices=%(opciones)s, db_index=True, max_length=6,
                    verbose_name='Tramo')),
                ('asignado_en', models.DateTimeField(
                    blank=True, null=True, verbose_name='Asignado el')),
                ('rutina', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='tramos', to='core.RutinaMonitoreo',
                    verbose_name='Rutina')),
                ('usuario', models.ForeignKey(
                    blank=True, null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name='tramos_asignados',
                    to=settings.AUTH_USER_MODEL, verbose_name='Asignado a')),
            ],
            options={
                'ordering': ['rutina', 'id'],
                'verbose_name': 'Tramo de rutina',
                'verbose_name_plural': 'Tramos de rutina',
            },
        ),
        migrations.CreateModel(
            name='VisitaMonitoreo',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True,
                                        serialize=False, verbose_name='ID')),
                ('sin_novedad', models.BooleanField(
                    default=True, verbose_name='Sin novedad')),
                ('observacion', models.TextField(
                    blank=True, default='', verbose_name='Observacion')),
                ('latitude', models.DecimalField(
                    blank=True, decimal_places=8, max_digits=12, null=True,
                    verbose_name='Latitud')),
                ('longitude', models.DecimalField(
                    blank=True, decimal_places=8, max_digits=12, null=True,
                    verbose_name='Longitud')),
                ('creada_en', models.DateTimeField(
                    auto_now_add=True, verbose_name='Registrada el')),
                ('incidente', models.ForeignKey(
                    blank=True, null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name='visitas_monitoreo',
                    to='hi_incidents.HIIncident',
                    verbose_name='Incidente levantado')),
                ('tramo_rutina', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='visitas', to='core.TramoDeRutina',
                    verbose_name='Tramo de rutina')),
                ('usuario', models.ForeignKey(
                    blank=True, null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name='visitas_monitoreo',
                    to=settings.AUTH_USER_MODEL, verbose_name='Registro')),
            ],
            options={
                'ordering': ['-creada_en'],
                'verbose_name': 'Visita de monitoreo',
                'verbose_name_plural': 'Visitas de monitoreo',
            },
        ),
        migrations.AlterUniqueTogether(
            name='tramoderutina',
            unique_together=set([('rutina', 'tramo')]),
        ),
        migrations.RunPython(sembrar, desembrar),
    ]
'''


# ══════════════════════════════════════════════════════════════════════════
# 3. los endpoints
# ══════════════════════════════════════════════════════════════════════════

MODULO = '''# -*- coding: utf-8 -*-
"""Monitoreos rutinarios: rutinas, asignaciones y visitas.

Lo escribe parche_monitoreo_rutinario.py. No se edita a mano.

QUIEN PUEDE QUE
---------------
Crear rutinas, asignar tramos y ver el avance: mobile_gerencia, que es el
mismo grupo que administra cuentas y equipos. Registrar una visita: el
usuario asignado a ese tramo, y tambien gerencia -quien asigna a veces va, y
negarselo obligaria a asignarse a si mismo para poder registrar-.

EL HALLAZGO VIENE YA CREADO
---------------------------
La app crea el incidente con el endpoint de siempre (hi-incidents/) y luego
registra la visita con su id. Dos llamadas en vez de una, a cambio de no
tocar ni una linea del camino por el que hoy entran todos los incidentes de
campo, que ademas ya tiene su cola offline resuelta.
"""

from django.utils import timezone

from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from .models import (ResponsableTramo, RutinaMonitoreo, TramoDeRutina,
                     VisitaMonitoreo, TRAMOS_CANAL)
from .equipo_enlazado import EsGerencia
from .permission import IsMobileRoleUser


GRUPO_MONITOREO = 'mobile_gerencia'

# Para ordenar I, II, III... que alfabeticamente salen al reves de como se
# recorre el canal.
ORDEN_TRAMO = dict((t, i) for i, t in enumerate(TRAMOS_CANAL))


def _nombre(u):
    if u is None:
        return None
    entero = ''
    try:
        entero = (u.get_full_name() or '').strip()
    except Exception:
        pass
    return entero or u.get_username()


def _normaliza(t):
    """Sin tildes y en minusculas, para cruzar nombres escritos a mano."""
    import unicodedata
    t = unicodedata.normalize('NFKD', str(t or ''))
    t = ''.join(c for c in t if not unicodedata.combining(c))
    return ' '.join(t.lower().split())


def _celulares():
    """Nombre del coordinador -> su celular, sacado del cuadro.

    POR QUE SE CRUZA POR NOMBRE Y NO HAY UN CAMPO EN LA CUENTA. El celular
    ya esta en el cuadro de JURP, que es quien lo mantiene; copiarlo tambien
    al usuario serian dos sitios donde corregirlo y uno de los dos
    quedandose viejo. El cruce falla cuando el nombre de la cuenta no se
    parece al del cuadro, y entonces no sale telefono -que es mejor que
    sacar el de otro-.
    """
    salida = {}
    for r in ResponsableTramo.objects.filter(activo=True):
        if r.celular:
            salida.setdefault(_normaliza(r.coordinador), r.celular)
    return salida


def _persona(u, tels=None):
    if u is None:
        return None
    d = {'id': u.pk, 'username': u.get_username(), 'nombre': _nombre(u)}
    if tels is not None:
        d['celular'] = tels.get(_normaliza(d['nombre']), '')
    return d


def _es_gerencia(u):
    try:
        return u.groups.filter(name=GRUPO_MONITOREO).exists()
    except Exception:
        return False


def _contactos(tramo):
    return [{'empresa': r.empresa, 'coordinador': r.coordinador,
             'celular': r.celular}
            for r in ResponsableTramo.objects.filter(tramo=tramo, activo=True)]


def _visita(v):
    return {
        'id': v.id,
        'sin_novedad': v.sin_novedad,
        'observacion': v.observacion,
        'latitude': str(v.latitude) if v.latitude is not None else None,
        'longitude': str(v.longitude) if v.longitude is not None else None,
        'incidente': v.incidente_id,
        'registrada_en': v.creada_en,
        'por': _persona(v.usuario),
    }


def _tramo(tr, con_visitas=False, tels=None):
    visitas = list(tr.visitas.all())
    d = {
        'id': tr.id,
        'tramo': tr.tramo,
        'asignados': [_persona(u, tels) for u in tr.usuarios.all()],
        'asignado_en': tr.asignado_en,
        'visitas': len(visitas),
        'hallazgos': len([v for v in visitas if not v.sin_novedad]),
        'recorrido': bool(visitas),
        'contactos': _contactos(tr.tramo),
    }
    if con_visitas:
        d['detalle'] = [_visita(v) for v in visitas]
    return d


def _rutina(r, con_tramos=False, tels=None):
    d = {
        'id': r.id,
        'nombre': r.nombre,
        'fecha_inicio': r.fecha_inicio,
        'fecha_fin': r.fecha_fin,
        'notas': r.notas,
        'cerrada': r.cerrada,
        'vigente': r.vigente(),
        'creada_por': _persona(r.creada_por),
        'creada_en': r.creada_en,
    }
    tramos = sorted(r.tramos.all(),
                    key=lambda t: ORDEN_TRAMO.get(t.tramo, 99))
    d['total_tramos'] = len(tramos)
    d['recorridos'] = len([t for t in tramos if t.visitas.exists()])
    d['sin_asignar'] = len([t for t in tramos if not t.usuarios.exists()])
    if con_tramos:
        if tels is None:
            tels = _celulares()
        d['tramos'] = [_tramo(t, con_visitas=True, tels=tels) for t in tramos]
    return d


# ══════════════════════════════════════════════════════════════════════════
# RUTINAS
# ══════════════════════════════════════════════════════════════════════════

@api_view(['GET', 'POST'])
@permission_classes([EsGerencia])
def rutinas(request):
    if request.method == 'GET':
        qs = RutinaMonitoreo.objects.all().select_related('creada_por')
        return Response({'ok': True,
                         'results': [_rutina(r) for r in qs]})

    datos = request.data or {}
    nombre = (datos.get('nombre') or '').strip()
    inicio = datos.get('fecha_inicio')
    fin = datos.get('fecha_fin')
    if not nombre or not inicio or not fin:
        return Response(
            {'ok': False, 'detail': 'Hacen falta nombre, fecha_inicio y fecha_fin.'},
            status=status.HTTP_400_BAD_REQUEST)
    if str(fin) < str(inicio):
        return Response(
            {'ok': False, 'detail': 'La fecha de fin es anterior a la de inicio.'},
            status=status.HTTP_400_BAD_REQUEST)

    # Que tramos entran. Por omision los catorce: una rutina que nace vacia
    # obliga a un segundo paso para llegar a lo que casi siempre se quiere.
    pedidos = datos.get('tramos') or TRAMOS_CANAL
    pedidos = [str(t).strip().upper() for t in pedidos]
    malos = [t for t in pedidos if t not in TRAMOS_CANAL]
    if malos:
        return Response(
            {'ok': False, 'detail': 'Tramos que no existen: %s' % ', '.join(malos)},
            status=status.HTTP_400_BAD_REQUEST)

    r = RutinaMonitoreo.objects.create(
        nombre=nombre[:140], fecha_inicio=inicio, fecha_fin=fin,
        notas=(datos.get('notas') or '').strip(),
        creada_por=request.user if getattr(request.user, 'pk', None) else None)
    # EL REPARTO SE HEREDA DE LA RONDA ANTERIOR. Los tramos los recorre casi
    # siempre la misma gente -es el coordinador de la empresa que esta en ese
    # tramo-, asi que empezar cada mes con catorce desplegables vacios es
    # repetir a mano una decision que ya estaba tomada. Lo heredado se puede
    # cambiar; lo que no se puede es recordar catorce nombres cada vez.
    previa = (RutinaMonitoreo.objects.exclude(pk=r.pk)
              .order_by('-fecha_inicio', '-id').first())
    antes = {}
    if previa is not None:
        for x in previa.tramos.all():
            ids = [u.pk for u in x.usuarios.all()]
            if ids:
                antes[x.tramo] = ids

    vistos = []
    for t in pedidos:
        if t in vistos:
            continue
        vistos.append(t)
        nuevo = TramoDeRutina.objects.create(
            rutina=r, tramo=t,
            asignado_en=timezone.now() if antes.get(t) else None)
        if antes.get(t):
            nuevo.usuarios.add(*antes[t])
    # Releer antes de responder. Lo que llego en la peticion son cadenas, y
    # el objeto en memoria las conserva: la base es la unica que sabe que
    # '2026-11-01' es una fecha.
    r.refresh_from_db()
    return Response({'ok': True, 'rutina': _rutina(r, con_tramos=True)},
                    status=status.HTTP_201_CREATED)


@api_view(['GET', 'POST'])
@permission_classes([EsGerencia])
def rutina(request, pk):
    try:
        r = RutinaMonitoreo.objects.get(pk=pk)
    except RutinaMonitoreo.DoesNotExist:
        return Response({'ok': False, 'detail': 'No existe esa rutina.'},
                        status=status.HTTP_404_NOT_FOUND)

    if request.method == 'GET':
        return Response({'ok': True, 'rutina': _rutina(r, con_tramos=True)})

    datos = request.data or {}
    for campo in ('nombre', 'notas'):
        if campo in datos:
            setattr(r, campo, (datos.get(campo) or '').strip())
    for campo in ('fecha_inicio', 'fecha_fin'):
        if datos.get(campo):
            setattr(r, campo, datos[campo])
    if 'cerrada' in datos:
        r.cerrada = bool(datos['cerrada'])
    r.save()
    r.refresh_from_db()          # igual que al crear: fechas, no cadenas
    return Response({'ok': True, 'rutina': _rutina(r, con_tramos=True)})


@api_view(['POST'])
@permission_classes([EsGerencia])
def asignar(request, pk):
    """Pone (o quita) el responsable de un tramo de la rutina.

    Acepta una asignacion o una lista, porque asignar los catorce de uno en
    uno son catorce viajes y catorce sitios donde quedarse a medias.
    """
    from django.contrib.auth import get_user_model

    try:
        r = RutinaMonitoreo.objects.get(pk=pk)
    except RutinaMonitoreo.DoesNotExist:
        return Response({'ok': False, 'detail': 'No existe esa rutina.'},
                        status=status.HTTP_404_NOT_FOUND)

    datos = request.data or {}
    lote = datos.get('asignaciones')
    if lote is None:
        lote = [{'tramo': datos.get('tramo'), 'usuario': datos.get('usuario')}]
    if not isinstance(lote, list):
        return Response({'ok': False, 'detail': 'asignaciones tiene que ser una lista.'},
                        status=status.HTTP_400_BAD_REQUEST)

    Usuario = get_user_model()
    cambios, fallos = [], []
    for item in lote:
        item = item or {}
        tramo = str(item.get('tramo') or '').strip().upper()
        # Se admite `usuarios` (lista) y tambien `usuario` suelto, que es lo
        # que mandaba la version de un solo responsable.
        pedidas = item.get('usuarios')
        if pedidas is None:
            uno = item.get('usuario')
            pedidas = [] if uno in (None, '', 0) else [uno]
        if not isinstance(pedidas, list):
            fallos.append('usuarios del tramo %s tiene que ser una lista' % tramo)
            continue

        try:
            tr = TramoDeRutina.objects.get(rutina=r, tramo=tramo)
        except TramoDeRutina.DoesNotExist:
            fallos.append('el tramo %s no esta en esta rutina' % (tramo or '?'))
            continue

        gente, malos = [], []
        for uid in pedidas:
            if uid in (None, '', 0):
                continue
            try:
                gente.append(Usuario.objects.get(pk=uid))
            except (Usuario.DoesNotExist, ValueError, TypeError):
                malos.append(str(uid))
        if malos:
            fallos.append('en el tramo %s no existe(n) %s'
                          % (tramo, ', '.join(malos)))
            continue

        # Django 1.8 no tiene .set(): se vacia y se vuelve a llenar.
        tr.usuarios.clear()
        if gente:
            tr.usuarios.add(*gente)
        tr.asignado_en = timezone.now() if gente else None
        tr.save(update_fields=['asignado_en'])
        cambios.append(tramo)

    return Response({'ok': not fallos, 'cambiados': cambios, 'fallos': fallos,
                     'rutina': _rutina(r, con_tramos=True)},
                    status=status.HTTP_200_OK if not fallos
                    else status.HTTP_207_MULTI_STATUS)


@api_view(['GET'])
@permission_classes([EsGerencia])
def candidatos(request):
    """Quien puede recorrer un tramo, y a quien se avisa de lo que aparezca.

    RECORRE LA GENTE DEL CUADRO -los coordinadores de las empresas usuarias-,
    que son quienes estan en el tramo todos los dias. Por eso la lista son
    todas las cuentas moviles activas y no solo las de Gerencia.

    SE AVISA A GERENCIA. Eso no se elige por tramo: es el grupo entero, y
    va aparte para que la pantalla pueda decirlo sin inventarselo.

    Se devuelve el grupo de cada cuenta porque el padron tiene homonimos y
    cuentas repetidas -14 de los 31 coordinadores del cuadro tienen dos-, y
    el grupo es lo unico que ayuda a distinguirlas desde fuera.
    """
    from django.contrib.auth import get_user_model
    Usuario = get_user_model()

    qs = (Usuario.objects
          .filter(groups__name__startswith='mobile_', is_active=True)
          .prefetch_related('groups')
          .distinct()
          .order_by('username'))

    tels = _celulares()

    def con_grupo(u):
        d = _persona(u, tels)
        grupos = sorted(g.name for g in u.groups.all())
        d['grupo'] = grupos[0] if grupos else ''
        return d

    avisados = (Usuario.objects
                .filter(groups__name=GRUPO_MONITOREO, is_active=True)
                .distinct().order_by('username'))

    return Response({'ok': True,
                     'results': [con_grupo(u) for u in qs],
                     'avisados': [_persona(u) for u in avisados]})


@api_view(['GET'])
@permission_classes([EsGerencia])
def responsables(request):
    """El cuadro de empresas y coordinadores, por tramo."""
    salida = []
    for t in TRAMOS_CANAL:
        salida.append({'tramo': t, 'contactos': _contactos(t)})
    return Response({'ok': True, 'results': salida})


# ══════════════════════════════════════════════════════════════════════════
# LA APP
# ══════════════════════════════════════════════════════════════════════════

@api_view(['GET'])
@permission_classes([IsMobileRoleUser])
def mis_tramos(request):
    """Lo que le toca recorrer a quien pregunta, en las rutinas vigentes.

    Solo las vigentes: una rutina cerrada o de otro mes no es trabajo
    pendiente, y mezclarlas obliga a leer fechas en una pantalla de campo
    para saber que hay que hacer hoy.
    """
    hoy = timezone.localtime(timezone.now()).date()
    qs = (TramoDeRutina.objects
          .filter(usuarios=request.user,
                  rutina__cerrada=False,
                  rutina__fecha_inicio__lte=hoy,
                  rutina__fecha_fin__gte=hoy)
          .select_related('rutina'))
    tels = _celulares()
    por_rutina = {}
    for tr in qs:
        por_rutina.setdefault(tr.rutina_id, {'rutina': _rutina(tr.rutina),
                                             'tramos': []})
        por_rutina[tr.rutina_id]['tramos'].append(
            _tramo(tr, con_visitas=True, tels=tels))
    for bloque in por_rutina.values():
        bloque['tramos'].sort(key=lambda t: ORDEN_TRAMO.get(t['tramo'], 99))
    return Response({'ok': True, 'results': list(por_rutina.values())})


@api_view(['POST'])
@permission_classes([IsMobileRoleUser])
def visitas(request):
    """Registra el recorrido de un tramo.

    `incidente` llega ya creado por hi-incidents/. Aqui no se crea ninguno:
    duplicar ese camino seria mantener dos formas de registrar lo mismo y
    que una de las dos se quede atras.
    """
    datos = request.data or {}
    try:
        tr = TramoDeRutina.objects.select_related('rutina').get(
            pk=datos.get('tramo_rutina'))
    except (TramoDeRutina.DoesNotExist, ValueError, TypeError):
        return Response({'ok': False, 'detail': 'No existe ese tramo de rutina.'},
                        status=status.HTTP_404_NOT_FOUND)

    mio = tr.usuarios.filter(pk=getattr(request.user, 'pk', None)).exists()
    if not mio and not _es_gerencia(request.user):
        return Response(
            {'ok': False, 'detail': 'Ese tramo esta asignado a otra persona.'},
            status=status.HTTP_403_FORBIDDEN)

    if tr.rutina.cerrada:
        return Response({'ok': False, 'detail': 'Esa rutina ya esta cerrada.'},
                        status=status.HTTP_400_BAD_REQUEST)

    sin_novedad = datos.get('sin_novedad')
    sin_novedad = True if sin_novedad is None else bool(sin_novedad)
    incidente_id = datos.get('incidente')
    observacion = (datos.get('observacion') or '').strip()

    # Un hallazgo sin nada que lo cuente no es un hallazgo: o se enlaza el
    # incidente o se escribe que se vio. Si no, el parte dice "hubo algo" y
    # no hay forma de saber que.
    if not sin_novedad and not incidente_id and not observacion:
        return Response(
            {'ok': False,
             'detail': 'Un hallazgo necesita el incidente o, al menos, una observacion.'},
            status=status.HTTP_400_BAD_REQUEST)

    incidente = None
    if incidente_id:
        from src.apps.hi_incidents.models import HIIncident
        try:
            incidente = HIIncident.objects.get(pk=incidente_id)
        except HIIncident.DoesNotExist:
            return Response({'ok': False, 'detail': 'No existe ese incidente.'},
                            status=status.HTTP_400_BAD_REQUEST)
        sin_novedad = False

    v = VisitaMonitoreo.objects.create(
        tramo_rutina=tr,
        usuario=request.user if getattr(request.user, 'pk', None) else None,
        sin_novedad=sin_novedad,
        observacion=observacion,
        latitude=datos.get('latitude') or None,
        longitude=datos.get('longitude') or None,
        incidente=incidente)
    return Response({'ok': True, 'visita': _visita(v),
                     'tramo': _tramo(tr, con_visitas=True)},
                    status=status.HTTP_201_CREATED)
'''


# ══════════════════════════════════════════════════════════════════════════
# 4. las rutas
# ══════════════════════════════════════════════════════════════════════════

IMPORT_URLS = ("from src.apps.core.monitoreo import (\\n"
               "    rutinas as mon_rutinas,\\n"
               "    rutina as mon_rutina,\\n"
               "    asignar as mon_asignar,\\n"
               "    candidatos as mon_candidatos,\\n"
               "    responsables as mon_responsables,\\n"
               "    mis_tramos as mon_mis_tramos,\\n"
               "    visitas as mon_visitas,\\n"
               ")\\n")

RUTAS = (
    "    # Monitoreos rutinarios.\n"
    "    url(r'^v1/mobile/monitoreo/rutinas/$',\n"
    "        mon_rutinas, name='monitoreo_rutinas'),\n"
    "    url(r'^v1/mobile/monitoreo/rutinas/(?P<pk>[0-9]+)/$',\n"
    "        mon_rutina, name='monitoreo_rutina'),\n"
    "    url(r'^v1/mobile/monitoreo/rutinas/(?P<pk>[0-9]+)/asignar/$',\n"
    "        mon_asignar, name='monitoreo_asignar'),\n"
    "    url(r'^v1/mobile/monitoreo/candidatos/$',\n"
    "        mon_candidatos, name='monitoreo_candidatos'),\n"
    "    url(r'^v1/mobile/monitoreo/responsables/$',\n"
    "        mon_responsables, name='monitoreo_responsables'),\n"
    "    url(r'^v1/mobile/monitoreo/mis-tramos/$',\n"
    "        mon_mis_tramos, name='monitoreo_mis_tramos'),\n"
    "    url(r'^v1/mobile/monitoreo/visitas/$',\n"
    "        mon_visitas, name='monitoreo_visitas'),\n")


# ══════════════════════════════════════════════════════════════════════════
# herramientas (las mismas que el parche del canal de acceso, ya probadas)
# ══════════════════════════════════════════════════════════════════════════

def leer(ruta):
    with open(ruta, 'r') as f:
        return f.read()


def escribir(ruta, texto, simulacro):
    """Escribe, pero solo si el resultado es Python valido.

    Se comprueba ANTES de tocar el disco, y tambien en simulacro, que es
    donde interesa enterarse. Un parche que se niega es un inconveniente;
    uno que deja el servidor sin arrancar es una tarde.
    """
    if ruta.endswith('.py'):
        try:
            compile(texto, ruta, 'exec')
        except SyntaxError as e:
            raise RuntimeError(
                'lo que iba a escribir en {0} no es Python valido '
                '(linea {1}: {2}). No se toco el archivo.'.format(
                    os.path.basename(ruta), e.lineno, e.msg))
    if simulacro:
        return
    if os.path.exists(ruta):
        shutil.copy2(ruta, ruta + '.bak')
    with open(ruta, 'w') as f:
        f.write(texto)


INJERTADOS = ('src/apps/api/urls.py',)


def revertir(raiz):
    for rel in INJERTADOS:
        ruta = os.path.join(raiz, rel)
        copia = ruta + '.bak'
        if os.path.exists(copia):
            shutil.copy2(copia, ruta)
            print('  devuelto  {0}'.format(rel))
        else:
            print('  sin copia {0}'.format(rel))
    print('')
    print('Las tablas y monitoreo.py se quedan: sin rutas no los llama nadie.')


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


def insertar_linea(texto, indice, linea):
    lineas = texto.splitlines(True)
    lineas.insert(indice, linea)
    return ''.join(lineas)


# ══════════════════════════════════════════════════════════════════════════
# pasos
# ══════════════════════════════════════════════════════════════════════════

def paso_modelos(raiz, simulacro):
    ruta = os.path.join(raiz, 'src/apps/core/models.py')
    if not os.path.exists(ruta):
        return False, 'no existe {0}'.format(ruta)
    t = leer(ruta)
    if 'class RutinaMonitoreo' in t:
        return True, 'ya estaba'
    escribir(ruta, t.rstrip('\n') + '\n' + MODELOS, simulacro)
    return True, 'cuatro tablas anadidas al final'


VIGENTE_VIEJO = """    def vigente(self, dia=None):
        from django.utils import timezone
        d = dia or timezone.localtime(timezone.now()).date()
        return (not self.cerrada) and self.fecha_inicio <= d <= self.fecha_fin"""


def paso_vigente(raiz, simulacro):
    """Corrige vigente() donde las tablas YA estaban puestas.

    paso_modelos no toca models.py si encuentra RutinaMonitoreo, que es lo
    correcto -no se reescribe un modelo ya migrado-, pero deja fuera a quien
    aplico la primera version. Este paso cambia solo ese metodo.
    """
    ruta = os.path.join(raiz, 'src/apps/core/models.py')
    if not os.path.exists(ruta):
        return False, 'no existe {0}'.format(ruta)
    t = leer(ruta)
    if 'def como_fecha(v):' in t:
        return True, 'ya estaba corregido'
    if VIGENTE_VIEJO not in t:
        if 'class RutinaMonitoreo' not in t:
            return True, 'no aplica (las tablas las pone el paso 1)'
        return False, ('vigente() no tiene la forma que esperaba; pegame '
                       'el metodo y lo hago a mano')
    # El cuerpo nuevo sale del propio MODELOS, para que no haya dos
    # versiones del mismo metodo esperando a divergir.
    m = re.search(r'    def vigente\(self, dia=None\):.*?return \(not self\.cerrada\) and ini <= d <= fin',
                  MODELOS, re.S)
    if not m:
        return False, 'no encuentro el vigente() nuevo dentro del parche'
    escribir(ruta, t.replace(VIGENTE_VIEJO, m.group(0)), simulacro)
    return True, 'vigente() ya no compara cadena con fecha'



# ══════════════════════════════════════════════════════════════════════════
# 2b. de un responsable por tramo a varios
# ══════════════════════════════════════════════════════════════════════════
#
# El related_name de la tabla nueva NO puede ser el del campo viejo: entre
# AddField y RemoveField los dos existen a la vez, y dos relaciones con el
# mismo nombre inverso no arrancan el proyecto.

MIGRACION_VARIOS = '''# -*- coding: utf-8 -*-
# Lo escribe parche_monitoreo_rutinario.py.
from __future__ import unicode_literals

from django.conf import settings
from django.db import migrations, models


def pasar(apps, schema_editor):
    """Lo ya asignado no se pierde: el unico responsable pasa a ser el
    primero de la lista."""
    Tramo = apps.get_model('core', 'TramoDeRutina')
    for t in Tramo.objects.exclude(usuario__isnull=True):
        t.usuarios.add(t.usuario_id)


def deshacer(apps, schema_editor):
    """Al revertir, se conserva el primero. Mas de uno no cabe en un campo
    que solo admite uno, y perder a los demas en silencio seria peor que
    decirlo: queda en el historial de la rutina."""
    Tramo = apps.get_model('core', 'TramoDeRutina')
    for t in Tramo.objects.all():
        primero = t.usuarios.first()
        if primero is not None:
            t.usuario_id = primero.pk
            t.save(update_fields=['usuario'])


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('core', '%(anterior)s'),
    ]

    operations = [
        migrations.AddField(
            model_name='tramoderutina',
            name='usuarios',
            field=models.ManyToManyField(
                blank=True, related_name='tramos_a_recorrer',
                to=settings.AUTH_USER_MODEL, verbose_name='Asignado a'),
        ),
        migrations.RunPython(pasar, deshacer),
        migrations.RemoveField(model_name='tramoderutina', name='usuario'),
    ]
'''


ASIGNACION_VIEJA = """    usuario = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True,
        blank=True, related_name='tramos_asignados', verbose_name='Asignado a')"""

ASIGNACION_NUEVA = """    usuarios = models.ManyToManyField(
        settings.AUTH_USER_MODEL, blank=True,
        related_name='tramos_a_recorrer', verbose_name='Asignado a')"""


def paso_varios(raiz, simulacro):
    """Pasa de un responsable por tramo a varios, donde ya estaba puesto."""
    ruta = os.path.join(raiz, 'src/apps/core/models.py')
    if not os.path.exists(ruta):
        return False, 'no existe {0}'.format(ruta)
    t = leer(ruta)
    if 'class TramoDeRutina' not in t:
        return True, 'no aplica (las tablas las pone el paso 1)'
    if ASIGNACION_NUEVA in t:
        hecho_modelo = True
    elif ASIGNACION_VIEJA in t:
        escribir(ruta, t.replace(ASIGNACION_VIEJA, ASIGNACION_NUEVA), simulacro)
        hecho_modelo = False
    else:
        return False, ('la asignacion de TramoDeRutina no tiene la forma que '
                       'esperaba; pegame el modelo y lo hago a mano')

    carpeta = os.path.join(raiz, 'src/apps/core/migrations')
    previas = sorted(n[:-3] for n in os.listdir(carpeta)
                     if n.endswith('.py') and n != '__init__.py')
    if any('varios_responsables' in n for n in previas):
        return True, 'ya estaba'
    anterior = previas[-1]
    numero = int(anterior[:4]) + 1
    nombre = '{0:04d}_varios_responsables.py'.format(numero)
    escribir(os.path.join(carpeta, nombre),
             MIGRACION_VARIOS % {'anterior': anterior}, simulacro)
    return True, '{0}{1}'.format(
        nombre, '' if hecho_modelo else ' (y el modelo)')


def paso_migracion(raiz, simulacro):
    carpeta = os.path.join(raiz, 'src/apps/core/migrations')
    if not os.path.isdir(carpeta):
        return False, 'no existe {0}'.format(carpeta)
    previas = sorted(n[:-3] for n in os.listdir(carpeta)
                     if n.endswith('.py') and n != '__init__.py')
    if any('monitoreo' in n for n in previas):
        return True, 'ya estaba'
    if not previas:
        return False, 'core no tiene migraciones; no se de cual colgar'
    anterior = previas[-1]
    try:
        numero = int(anterior[:4]) + 1
    except ValueError:
        return False, 'la ultima migracion no empieza por cuatro cifras'

    opciones = repr(tuple((t, 'Tramo %s' % t) for t in TRAMOS))
    cuadro = '[\n' + ''.join(
        "    (%r, %r, %r, %r),\n" % fila for fila in CUADRO) + ']'
    nombre = '{0:04d}_monitoreo_rutinario.py'.format(numero)
    escribir(os.path.join(carpeta, nombre),
             MIGRACION % {'anterior': anterior, 'opciones': opciones,
                          'cuadro': cuadro},
             simulacro)
    return True, '{0}  (depende de {1}, siembra {2} contactos)'.format(
        nombre, anterior, len(CUADRO))


def paso_modulo(raiz, simulacro):
    for rel, que in (('src/apps/core/equipo_enlazado.py', 'EsGerencia'),
                     ('src/apps/core/permission.py', 'IsMobileRoleUser')):
        ruta = os.path.join(raiz, rel)
        if not os.path.exists(ruta):
            return False, 'falta {0}, de donde sale {1}'.format(rel, que)
    escribir(os.path.join(raiz, 'src/apps/core/monitoreo.py'), MODULO,
             simulacro)
    return True, 'modulo de endpoints'


def paso_urls(raiz, simulacro):
    ruta = os.path.join(raiz, 'src/apps/api/urls.py')
    if not os.path.exists(ruta):
        return False, 'no existe {0}'.format(ruta)
    t = leer(ruta)
    if 'mon_rutinas' in t:
        return True, 'ya estaba'

    lineas = t.splitlines(True)
    destino = None
    for i, l in enumerate(lineas):
        if re.search(r"url\(\s*r'\^v1/mobile/", l):
            destino = i
            break
    if destino is None:
        return False, 'no encuentro ninguna ruta v1/mobile/ en urls.py'

    # Por ENCIMA de los comentarios de esa ruta, no entre el comentario y su
    # url(). Colarse en medio no rompe nada -son comentarios- pero deja el
    # rotulo de la ruta de antes encabezando las nuestras, y al siguiente
    # que lea el archivo le miente.
    while destino > 0 and lineas[destino - 1].strip().startswith('#'):
        destino -= 1
    t = ''.join(lineas[:destino]) + RUTAS + ''.join(lineas[destino:])
    t = insertar_linea(t, fin_de_imports(t), IMPORT_URLS.replace('\\n', '\n'))
    escribir(ruta, t, simulacro)
    return True, 'import y 7 rutas anadidos'


# ══════════════════════════════════════════════════════════════════════════

def main():
    p = argparse.ArgumentParser()
    p.add_argument('--raiz', default='/var/www/envs/prod')
    p.add_argument('--aplicar', action='store_true')
    p.add_argument('--revertir', action='store_true')
    args = p.parse_args()
    simulacro = not args.aplicar

    if not os.path.isfile(os.path.join(args.raiz, 'src/apps/api/urls.py')):
        print('No parece el proyecto de PLUVIRA: no hay '
              '{0}/src/apps/api/urls.py'.format(args.raiz))
        sys.exit(1)

    if args.revertir:
        print('Raiz: {0}\nModo: DESHACIENDO\n'.format(args.raiz))
        revertir(args.raiz)
        print('\nReinicia jurp_web y vuelve a correr el parche.')
        return

    print('Raiz: {0}'.format(args.raiz))
    print('Modo: {0}\n'.format('SIMULACRO (no escribe nada)' if simulacro
                               else 'APLICANDO'))

    pasos = [
        ('1 models.py   ', paso_modelos),
        ('2 vigente()   ', paso_vigente),
        ('3 migracion   ', paso_migracion),
        ('4 varios      ', paso_varios),
        ('5 monitoreo.py', paso_modulo),
        ('6 urls.py     ', paso_urls),
    ]
    fallo = False
    for nombre, fn in pasos:
        try:
            ok, detalle = fn(args.raiz, simulacro)
        except Exception as e:                       # noqa: BLE001
            ok, detalle = False, 'reviento: {0}'.format(e)
        print('[{0}] {1}  {2}'.format('OK ' if ok else 'MAL', nombre, detalle))
        if not ok:
            fallo = True

    print('')
    if fallo:
        print('NO se aplico todo. Parado asi, el proyecto esta como estaba.')
        sys.exit(1)
    if simulacro:
        print('Simulacro: no se escribio nada. Si todo sale OK, repite con')
        print('--aplicar.')
        return
    print('Aplicado. Ahora:')
    print('')
    print('    manage.py makemigrations core --dry-run   # "No changes detected"')
    print('    manage.py migrate core')
    print('    reiniciar jurp_web')
    print('')
    print('La migracion siembra el cuadro de contactos SOLO si la tabla esta')
    print('vacia: si manana corriges un celular, no te lo pisa.')


if __name__ == '__main__':
    main()
