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

    Y UNA VISITA PUEDE SER DE UN ELEMENTO SUELTO. Recorrer el Tramo II es
    recorrer sus 25 sub-tramos de 200 m y las obras de arte que hay en
    ellos. Si todo esta bien se marca el tramo entero de una vez; si algo no
    lo esta, se registra ESE elemento con su hallazgo y el resto se marca
    sin novedad en masivo. Una fila por elemento, para que dentro de un ano
    se pueda responder "cuando se reviso la entrega E12" sin deducirlo.

    `elemento` vacio y tipo 'tramo' es el caso de antes -el tramo entero-, y
    las visitas ya registradas lo siguen siendo sin tocarlas.
    """

    tramo_rutina = models.ForeignKey(
        TramoDeRutina, on_delete=models.CASCADE, related_name='visitas',
        verbose_name='Tramo de rutina')
    usuario = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True,
        blank=True, related_name='visitas_monitoreo', verbose_name='Registro')

    TRAMO = 'tramo'
    SUBTRAMO = 'subtramo'
    OBRA = 'obra'
    TIPOS_ELEMENTO = (
        (TRAMO, 'El tramo entero'),
        (SUBTRAMO, 'Sub-tramo de 200 m'),
        (OBRA, 'Obra de arte'),
    )

    # QUE se reviso. El nombre viene del KMZ tal cual -"TRAMO II 10+200 -
    # 10+400 CANAL", "Entrega  E12"-, porque es el unico identificador que
    # comparten el mapa de la app y el del visor web. Inventar un codigo
    # propio obligaria a mantener la traduccion en dos sitios.
    tipo_elemento = models.CharField(
        'Que se reviso', max_length=10, choices=TIPOS_ELEMENTO, default=TRAMO)
    elemento = models.CharField('Elemento', max_length=160, blank=True,
                                default='', db_index=True)

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


class TelefonoUsuario(models.Model):
    """El celular de una cuenta, escrito a mano.

    POR QUE EXISTE SI EL CUADRO YA TRAE TELEFONOS. Porque el cruce por
    nombre no siempre acierta -el cuadro dice "ILICH LOPEZ" y la cuenta se
    llama "Ilich Lopez Camones"- y porque hay gente que recorre tramos y no
    esta en el cuadro: los de Gerencia, por ejemplo.

    MANDA SOBRE EL CUADRO. Si alguien se molesto en escribirlo aqui es
    porque el del cuadro no servia o no estaba; volver a preferir el del
    cuadro convertiria ese trabajo en algo que se deshace solo.
    """

    usuario = models.OneToOneField(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
        related_name='telefono_monitoreo', verbose_name='Usuario')
    celular = models.CharField('Celular', max_length=20, blank=True, default='')
    cambiado_en = models.DateTimeField('Cambiado el', auto_now=True)
    cambiado_por = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True,
        blank=True, related_name='+', verbose_name='Cambiado por')

    class Meta:
        verbose_name = 'Celular de usuario'
        verbose_name_plural = 'Celulares de usuario'

    def __str__(self):
        return '%s - %s' % (self.usuario, self.celular)
'''



# El bloque de arriba, tal cual, para meterlo en un models.py que ya
# tiene VisitaMonitoreo sin los campos del elemento.
ELEMENTO_BLOQUE = '''    TRAMO = 'tramo'
    SUBTRAMO = 'subtramo'
    OBRA = 'obra'
    TIPOS_ELEMENTO = (
        (TRAMO, 'El tramo entero'),
        (SUBTRAMO, 'Sub-tramo de 200 m'),
        (OBRA, 'Obra de arte'),
    )

    # QUE se reviso. El nombre viene del KMZ tal cual -"TRAMO II 10+200 -
    # 10+400 CANAL", "Entrega  E12"-, porque es el unico identificador que
    # comparten el mapa de la app y el del visor web. Inventar un codigo
    # propio obligaria a mantener la traduccion en dos sitios.
    tipo_elemento = models.CharField(
        'Que se reviso', max_length=10, choices=TIPOS_ELEMENTO, default=TRAMO)
    elemento = models.CharField('Elemento', max_length=160, blank=True,
                                default='', db_index=True)

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

import re

from django.utils import timezone

from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from .models import (ResponsableTramo, RutinaMonitoreo, TramoDeRutina,
                     VisitaMonitoreo, TelefonoUsuario, TRAMOS_CANAL)
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


class Telefonos(object):
    """De donde sale el celular de cada persona.

    DOS FUENTES Y UN ORDEN. Primero el escrito a mano en la cuenta, y si no
    hay, el del cuadro de JURP cruzado por nombre. El escrito a mano manda:
    si alguien se molesto en ponerlo es porque el del cuadro no servia o no
    estaba, y preferir el del cuadro convertiria ese trabajo en algo que se
    deshace solo.

    EL CRUCE ADMITE QUE UN NOMBRE SEA MAS LARGO QUE EL OTRO. El cuadro dice
    "ILICH LOPEZ" y la cuenta se llama "Ilich Lopez Camones": exigiendo
    igualdad exacta no salia telefono. Basta con que TODAS las palabras del
    nombre corto esten en el largo, y que sean al menos dos -con una sola,
    "Rodriguez" valdria para cinco personas distintas-.
    """

    def __init__(self):
        self.a_mano = {}
        for t in TelefonoUsuario.objects.all():
            if t.celular:
                self.a_mano[t.usuario_id] = t.celular

        self.cuadro = []
        vistos = set()
        for r in ResponsableTramo.objects.filter(activo=True):
            clave = _normaliza(r.coordinador)
            if r.celular and clave and clave not in vistos:
                vistos.add(clave)
                self.cuadro.append((set(clave.split()), r.celular))

    def de(self, usuario, nombre):
        propio = self.a_mano.get(getattr(usuario, 'pk', None))
        if propio:
            return propio, 'propio'
        palabras = set(_normaliza(nombre).split())
        if len(palabras) < 2:
            return '', ''
        for suyas, celular in self.cuadro:
            if len(suyas) < 2:
                continue
            if suyas <= palabras or palabras <= suyas:
                return celular, 'cuadro'
        return '', ''


def _celulares():
    return Telefonos()


def _persona(u, tels=None):
    if u is None:
        return None
    d = {'id': u.pk, 'username': u.get_username(), 'nombre': _nombre(u)}
    if tels is not None:
        # `origen` dice si el numero se escribio a mano o salio del cuadro.
        # La pantalla lo usa para ofrecer corregirlo sin que parezca que
        # esta pisando un dato de JURP.
        d['celular'], d['celular_origen'] = tels.de(u, d['nombre'])
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
        'tipo_elemento': v.tipo_elemento,
        'elemento': v.elemento,
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

    # LO REVISADO POR DENTRO. Recorrer el Tramo II es recorrer sus 25
    # sub-tramos de 200 m y las obras de arte que caen en ellos, y el parte
    # tiene que poder responder "cuando se reviso la entrega E12".
    #
    # Se cuenta por elemento DISTINTO y no por filas: si uno tiene dos
    # -se marco sin novedad y al volver se encontro algo- sigue siendo un
    # elemento revisado, y cuenta como con hallazgo. Contar filas diria
    # "26 de 25 revisados", que es la clase de numero que hace desconfiar
    # de todo el tablero.
    por_elemento = {}
    for v in visitas:
        if not v.elemento:
            continue
        if not v.sin_novedad or v.elemento not in por_elemento:
            por_elemento[v.elemento] = not v.sin_novedad

    d = {
        'id': tr.id,
        'tramo': tr.tramo,
        'asignados': [_persona(u, tels) for u in tr.usuarios.all()],
        'asignado_en': tr.asignado_en,
        'visitas': len(visitas),
        'hallazgos': len([v for v in visitas if not v.sin_novedad]),
        'elementos_revisados': len(por_elemento),
        'elementos_con_hallazgo': len([1 for x in por_elemento.values() if x]),
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


@api_view(['POST'])
@permission_classes([EsGerencia])
def telefono(request):
    """Escribe (o borra) el celular de una cuenta.

    Se guarda en la cuenta y no en el cuadro: el cuadro es de JURP y dice a
    quien avisar POR TRAMO; esto es el numero de una persona, que la sigue
    aunque cambie de tramo o no este en el cuadro.
    """
    from django.contrib.auth import get_user_model

    datos = request.data or {}
    Usuario = get_user_model()
    try:
        destino = Usuario.objects.get(pk=datos.get('usuario'))
    except (Usuario.DoesNotExist, ValueError, TypeError):
        return Response({'ok': False, 'detail': 'No existe ese usuario.'},
                        status=status.HTTP_404_NOT_FOUND)

    crudo = (datos.get('celular') or '').strip()
    # Solo digitos y de nueve: es lo que es un celular en Peru. Guardar
    # "996 123 456" y "996123456" como cosas distintas hace que marcar desde
    # la ficha falle en unos y en otros sin motivo aparente.
    limpio = ''.join(c for c in crudo if c.isdigit())
    if limpio and (len(limpio) != 9 or not limpio.startswith('9')):
        return Response(
            {'ok': False,
             'detail': 'Un celular son 9 digitos y empieza en 9.'},
            status=status.HTTP_400_BAD_REQUEST)

    quien = getattr(request, 'user', None)
    fila, _ = TelefonoUsuario.objects.get_or_create(usuario=destino)
    fila.celular = limpio
    fila.cambiado_por = quien if getattr(quien, 'pk', None) else None
    fila.save()

    return Response({'ok': True, 'usuario': destino.pk,
                     'celular': limpio,
                     'persona': _persona(destino, Telefonos())})


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


def _para_registrar(request, valor):
    """El tramo sobre el que se va a registrar, o el porque no se puede.

    Devuelve (tramo, None) o (None, respuesta). Lo usan la visita suelta y
    el lote, que tienen que comprobar exactamente lo mismo: que el tramo
    existe, que es mio, y que la rutina sigue abierta. Repetirlo era
    garantizar que un dia uno de los dos dejara registrar sobre una rutina
    cerrada.
    """
    try:
        tr = TramoDeRutina.objects.select_related('rutina').get(pk=valor)
    except (TramoDeRutina.DoesNotExist, ValueError, TypeError):
        return None, Response(
            {'ok': False, 'detail': 'No existe ese tramo de rutina.'},
            status=status.HTTP_404_NOT_FOUND)

    mio = tr.usuarios.filter(pk=getattr(request.user, 'pk', None)).exists()
    if not mio and not _es_gerencia(request.user):
        return None, Response(
            {'ok': False, 'detail': 'Ese tramo esta asignado a otra persona.'},
            status=status.HTTP_403_FORBIDDEN)

    if tr.rutina.cerrada:
        return None, Response(
            {'ok': False, 'detail': 'Esa rutina ya esta cerrada.'},
            status=status.HTTP_400_BAD_REQUEST)
    return tr, None


# El sub-tramo trae su progresiva en el nombre -"TRAMO II 5+200 - 5+400
# CANAL"- y la obra de arte no -"Entrega  E12"-. Sirve para deducir el tipo
# cuando el telefono no lo manda.
PROGRESIVA = re.compile('[0-9][ ]*[+][ ]*[0-9]')


def _lee_elemento(d):
    """Que se reviso, segun el cuerpo de la peticion.

    Sin `elemento` es el tramo entero, que es como lo mandaba la app antes
    de que esto existiera: las visitas ya registradas y las versiones
    viejas instaladas en los telefonos siguen valiendo sin tocar nada.

    EL NOMBRE ES EL DEL KMZ, TAL CUAL. Es el unico identificador que
    comparten el mapa del telefono y el del visor web; inventar un codigo
    propio obligaria a mantener la traduccion en dos sitios y a que
    coincidieran para siempre. Y no se valida contra un catalogo: el
    servidor no tiene el KMZ, asi que rechazar un nombre que no reconoce
    seria convertir cualquier diferencia de escritura en un recorrido que
    no se puede registrar estando en el canal.
    """
    clave = (d.get('elemento') or '').strip()[:160]
    if not clave:
        return VisitaMonitoreo.TRAMO, ''
    tipo = (d.get('tipo_elemento') or d.get('tipo') or '').strip().lower()
    if tipo not in (VisitaMonitoreo.SUBTRAMO, VisitaMonitoreo.OBRA):
        tipo = (VisitaMonitoreo.SUBTRAMO if PROGRESIVA.search(clave)
                else VisitaMonitoreo.OBRA)
    return tipo, clave


@api_view(['POST'])
@permission_classes([IsMobileRoleUser])
def visitas(request):
    """Registra el recorrido de un tramo, o de un elemento suyo.

    `incidente` llega ya creado por hi-incidents/. Aqui no se crea ninguno:
    duplicar ese camino seria mantener dos formas de registrar lo mismo y
    que una de las dos se quede atras.
    """
    datos = request.data or {}
    tr, mal = _para_registrar(request, datos.get('tramo_rutina'))
    if mal is not None:
        return mal

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

    tipo_elemento, elemento = _lee_elemento(datos)
    v = VisitaMonitoreo.objects.create(
        tramo_rutina=tr,
        usuario=request.user if getattr(request.user, 'pk', None) else None,
        tipo_elemento=tipo_elemento,
        elemento=elemento,
        sin_novedad=sin_novedad,
        observacion=observacion,
        latitude=datos.get('latitude') or None,
        longitude=datos.get('longitude') or None,
        incidente=incidente)
    return Response({'ok': True, 'visita': _visita(v),
                     'tramo': _tramo(tr, con_visitas=True)},
                    status=status.HTTP_201_CREATED)


TOPE_LOTE = 400


@api_view(['POST'])
@permission_classes([IsMobileRoleUser])
def visitas_lote(request):
    """"Y todo lo demas, sin novedad": una fila por elemento, de una vez.

    Como es el recorrido de verdad
    ------------------------------
    Se camina el tramo entero. Lo que esta mal se registra elemento por
    elemento con el formulario de incidente de siempre -eso va por
    visitas/-, y al terminar se marca el resto. Asi que este endpoint
    recibe la lista completa de elementos del tramo y escribe los que
    todavia no tienen fila.

    POR QUE NO PISA LO YA REGISTRADO
    --------------------------------
    Los elementos que ya tienen fila se OMITEN, no se vuelven a escribir.
    Dos razones, y las dos pasan:

    - El boton se pulsa dos veces, o se pierde la respuesta y el telefono
      reintenta. Sin esto, 25 sub-tramos se vuelven 50 filas y el avance
      dice 50 de 25.
    - El hallazgo se registro antes -es el orden natural: se va anotando lo
      que se encuentra y al final se cierra el resto-. Si el lote lo pisara
      con un "sin novedad", el masivo borraria justo lo que se fue a buscar.

    Un elemento con fila no vuelve a entrar por aqui nunca. Si hay que
    corregirlo, se registra otra visita suya por visitas/, que queda como
    lo que es: una segunda pasada, con su hora y su firma.
    """
    datos = request.data or {}
    tr, mal = _para_registrar(request, datos.get('tramo_rutina'))
    if mal is not None:
        return mal

    crudos = datos.get('elementos')
    if not isinstance(crudos, (list, tuple)) or not crudos:
        return Response(
            {'ok': False, 'detail': 'Manda la lista de elementos a marcar.'},
            status=status.HTTP_400_BAD_REQUEST)
    if len(crudos) > TOPE_LOTE:
        return Response(
            {'ok': False,
             'detail': ('Son demasiados elementos de golpe (%d). El tramo mas '
                        'grande del canal no llega a %d.'
                        % (len(crudos), TOPE_LOTE))},
            status=status.HTTP_400_BAD_REQUEST)

    # Un elemento puede venir como texto -solo su nombre, que es el caso
    # normal del masivo- o como objeto, si trae observacion.
    pedidos = []
    for crudo in crudos:
        d = {'elemento': crudo} if isinstance(crudo, str) else crudo
        if not isinstance(d, dict):
            continue
        tipo, clave = _lee_elemento(d)
        if not clave:
            continue
        sn = d.get('sin_novedad')
        sn = True if sn is None else bool(sn)
        obs = (d.get('observacion') or '').strip()
        # El lote es para cerrar lo que esta bien. Un hallazgo sin nada que
        # lo cuente se rechaza entero en vez de colarse como una fila que
        # dice "hubo algo" sin decir que: con 40 elementos encima, un aviso
        # suelto no se lee, y la fila quedaria para siempre.
        if not sn and not obs:
            return Response(
                {'ok': False,
                 'detail': ('"%s" viene como hallazgo sin observacion. Los '
                            'hallazgos se registran uno a uno con su '
                            'incidente.' % clave)},
                status=status.HTTP_400_BAD_REQUEST)
        pedidos.append((clave, tipo, sn, obs))

    if not pedidos:
        return Response(
            {'ok': False, 'detail': 'Ningun elemento de la lista tiene nombre.'},
            status=status.HTTP_400_BAD_REQUEST)

    ya = set(tr.visitas.exclude(elemento='')
             .values_list('elemento', flat=True))
    usuario = request.user if getattr(request.user, 'pk', None) else None
    lat = datos.get('latitude') or None
    lng = datos.get('longitude') or None

    creadas, omitidas, vistos = [], [], set()
    for clave, tipo, sn, obs in pedidos:
        # `vistos` ademas quita los repetidos DENTRO de la misma lista: el
        # KMZ tiene nombres duplicados -dos placemarks con el mismo rotulo-
        # y el telefono los manda tal como los lee.
        if clave in ya or clave in vistos:
            omitidas.append(clave)
            continue
        vistos.add(clave)
        creadas.append(VisitaMonitoreo.objects.create(
            tramo_rutina=tr,
            usuario=usuario,
            tipo_elemento=tipo,
            elemento=clave,
            sin_novedad=sn,
            observacion=obs,
            latitude=lat,
            longitude=lng))

    tr = TramoDeRutina.objects.select_related('rutina').get(pk=tr.pk)
    return Response({'ok': True,
                     'creadas': len(creadas),
                     'omitidas': omitidas,
                     'visitas': [_visita(v) for v in creadas],
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
               "    telefono as mon_telefono,\\n"
               "    mis_tramos as mon_mis_tramos,\\n"
               "    visitas as mon_visitas,\\n"
               "    visitas_lote as mon_visitas_lote,\\n"
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
    "    url(r'^v1/mobile/monitoreo/telefono/$',\n"
    "        mon_telefono, name='monitoreo_telefono'),\n"
    "    url(r'^v1/mobile/monitoreo/mis-tramos/$',\n"
    "        mon_mis_tramos, name='monitoreo_mis_tramos'),\n"
    "    url(r'^v1/mobile/monitoreo/visitas/$',\n"
    "        mon_visitas, name='monitoreo_visitas'),\n"
    # Antes de visitas/ no, pero DESPUES si: Django prueba en orden y
    # visitas/$ lleva el $, asi que no se traga visitas/lote/.
    "    url(r'^v1/mobile/monitoreo/visitas/lote/$',\n"
    "        mon_visitas_lote, name='monitoreo_visitas_lote'),\n")


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



# ══════════════════════════════════════════════════════════════════════════
# 4b. el celular propio de cada cuenta
# ══════════════════════════════════════════════════════════════════════════

MIGRACION_TELEFONO = '''# -*- coding: utf-8 -*-
# Lo escribe parche_monitoreo_rutinario.py.
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
            name='TelefonoUsuario',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True,
                                        serialize=False, verbose_name='ID')),
                ('celular', models.CharField(blank=True, default='',
                                             max_length=20,
                                             verbose_name='Celular')),
                ('cambiado_en', models.DateTimeField(
                    auto_now=True, verbose_name='Cambiado el')),
                ('cambiado_por', models.ForeignKey(
                    blank=True, null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name='+', to=settings.AUTH_USER_MODEL,
                    verbose_name='Cambiado por')),
                ('usuario', models.OneToOneField(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='telefono_monitoreo',
                    to=settings.AUTH_USER_MODEL, verbose_name='Usuario')),
            ],
            options={
                'verbose_name': 'Celular de usuario',
                'verbose_name_plural': 'Celulares de usuario',
            },
        ),
    ]
'''


def paso_telefono(raiz, simulacro):
    """La tabla del celular escrito a mano, donde ya estaba lo demas."""
    ruta = os.path.join(raiz, 'src/apps/core/models.py')
    t = leer(ruta)
    if 'class TramoDeRutina' not in t:
        return True, 'no aplica (las tablas las pone el paso 1)'
    if 'class TelefonoUsuario' not in t:
        m = re.search(r'\n\nclass TelefonoUsuario\(models\.Model\):.*?return .%s - %s. % \(self\.usuario, self\.celular\)\n',
                      MODELOS, re.S)
        if not m:
            return False, 'no encuentro TelefonoUsuario dentro del parche'
        escribir(ruta, t.rstrip('\n') + '\n' + m.group(0), simulacro)

    carpeta = os.path.join(raiz, 'src/apps/core/migrations')
    previas = sorted(n[:-3] for n in os.listdir(carpeta)
                     if n.endswith('.py') and n != '__init__.py')
    if any('telefono_usuario' in n for n in previas):
        return True, 'ya estaba'
    anterior = previas[-1]
    nombre = '{0:04d}_telefono_usuario.py'.format(int(anterior[:4]) + 1)
    escribir(os.path.join(carpeta, nombre),
             MIGRACION_TELEFONO % {'anterior': anterior}, simulacro)
    return True, nombre


MIGRACION_ELEMENTO = """# -*- coding: utf-8 -*-
# Lo escribe parche_monitoreo_rutinario.py.
from __future__ import unicode_literals

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('core', '%(anterior)s'),
    ]

    # Las dos columnas traen default, asi que las filas que ya hay quedan
    # como lo que son: visitas del tramo entero. No hace falta tocarlas.
    operations = [
        migrations.AddField(
            model_name='visitamonitoreo',
            name='tipo_elemento',
            field=models.CharField(
                choices=[('tramo', 'El tramo entero'),
                         ('subtramo', 'Sub-tramo de 200 m'),
                         ('obra', 'Obra de arte')],
                default='tramo', max_length=10,
                verbose_name='Que se reviso'),
        ),
        migrations.AddField(
            model_name='visitamonitoreo',
            name='elemento',
            field=models.CharField(blank=True, db_index=True, default='',
                                   max_length=160, verbose_name='Elemento'),
        ),
    ]
"""


def paso_elemento(raiz, simulacro):
    """Que la visita pueda ser de un sub-tramo o de una obra, no solo del tramo."""
    ruta = os.path.join(raiz, 'src/apps/core/models.py')
    if not os.path.exists(ruta):
        return False, 'no existe {0}'.format(ruta)
    t = leer(ruta)
    if 'class VisitaMonitoreo' not in t:
        return True, 'no aplica (las tablas las pone el paso 1)'

    hecho_modelo = True
    if 'tipo_elemento' not in t:
        # Justo encima de sin_novedad, que es donde esta en el parche. El
        # orden importa poco a Django, pero mucho a quien lea el archivo.
        ancla = "    sin_novedad = models.BooleanField('Sin novedad', default=True)"
        if t.count(ancla) != 1:
            return False, ('no encuentro sin_novedad una sola vez en '
                           'VisitaMonitoreo; pegame el modelo y lo hago a mano')
        escribir(ruta, t.replace(ancla, ELEMENTO_BLOQUE + ancla), simulacro)
        hecho_modelo = False

    carpeta = os.path.join(raiz, 'src/apps/core/migrations')
    previas = sorted(n[:-3] for n in os.listdir(carpeta)
                     if n.endswith('.py') and n != '__init__.py')
    if any('elemento_visita' in n for n in previas):
        return True, 'ya estaba'
    anterior = previas[-1]
    nombre = '{0:04d}_elemento_visita.py'.format(int(anterior[:4]) + 1)
    escribir(os.path.join(carpeta, nombre),
             MIGRACION_ELEMENTO % {'anterior': anterior}, simulacro)
    return True, '{0}{1}'.format(nombre, '' if hecho_modelo else ' (y el modelo)')


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

    # YA ESTABA NO ES TODO O NADA. Las rutas se han ido anadiendo en
    # tandas, y rendirse al encontrar la primera dejaba fuera a las nuevas
    # en todo servidor ya parcheado -que son justamente los que hay-. Si el
    # bloque esta pero le falta alguna, se mete solo la que falta.
    if 'mon_rutinas' in t:
        sueltas = [
            ('mon_telefono', 'telefono as mon_telefono,',
             "    url(r'^v1/mobile/monitoreo/telefono/$',\n"
             "        mon_telefono, name='monitoreo_telefono'),\n"),
            ('mon_visitas_lote', 'visitas_lote as mon_visitas_lote,',
             "    url(r'^v1/mobile/monitoreo/visitas/lote/$',\n"
             "        mon_visitas_lote, name='monitoreo_visitas_lote'),\n"),
        ]
        faltan = [x for x in sueltas if x[0] not in t]
        if not faltan:
            return True, 'ya estaba'
        for nombre, importe, ruta_nueva in faltan:
            m = re.search(r"^.*mis_tramos as mon_mis_tramos.*$", t, re.M)
            if not m:
                return False, ('el import de monitoreo no tiene la forma '
                               'esperada; dime como quedo')
            t = t[:m.start()] + '    ' + importe + '\n' + t[m.start():]
            m2 = re.search(r"^\s*url\(r'\^v1/mobile/monitoreo/mis-tramos/\$',.*$",
                           t, re.M)
            if not m2:
                return False, 'no encuentro la ruta de mis-tramos'
            t = t[:m2.start()] + ruta_nueva + t[m2.start():]
        escribir(ruta, t, simulacro)
        return True, 'anadida(s) %s' % ', '.join(x[0] for x in faltan)

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
    return True, 'import y 9 rutas anadidos'


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
        ('5 telefono    ', paso_telefono),
        ('6 elemento    ', paso_elemento),
        ('7 monitoreo.py', paso_modulo),
        ('8 urls.py     ', paso_urls),
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
