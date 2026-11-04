# -*- coding: utf-8 -*-
"""Lo que falta saber para los monitoreos rutinarios.

    docker exec -i jurp_web python manage.py shell < ver_monitoreo_rutinario.py

SOLO LEE. No escribe, no migra, no manda nada.

DOS PREGUNTAS
-------------
1. De las 17 empresas del cuadro de tramos, ¿cuales tienen ya cuenta en
   PLUVIRA? Enlazar las que existan es un rato; crear las que falten es
   otra conversacion -con que rol, con que clave, quien se la entrega-.

2. ¿Que forma tiene exactamente un incidente? El registro del monitoreo va
   a ser el mismo formulario, asi que el modelo nuevo tiene que hablar el
   mismo idioma: los mismos codigos de tipo, de severidad y de estado, y
   los mismos nombres de campo. Inventar un vocabulario paralelo seria
   garantizar que dentro de seis meses nadie sepa cual de los dos manda.
"""

from __future__ import print_function

import os
import re
import unicodedata

from django.apps import apps
from django.conf import settings
from django.contrib.auth import get_user_model


# Las 17 del cuadro, en el orden del cuadro.
EMPRESAS = [
    ('0', 'JURP - PECH'),
    ('I', 'DESHIDRATADORA LIBERTAD'),
    ('II', 'HASS PERU'),
    ('III', 'HORTIFRUT'),
    ('III', 'AVO PERU'),
    ('IV', 'CAMPOSOL CHAO'),
    ('V', 'ARATO PERU'),
    ('V', 'TALSA'),
    ('VI', 'CAMPOSOL VIRU'),
    ('VII', 'NORTE VERDE'),
    ('VIII', 'SOCIEDAD AGRICOLA EL ARENAL'),
    ('IX', 'VIRU S.A.'),
    ('X', 'BEGGIE'),
    ('X', 'AGROBERRIES'),
    ('XI', 'LAREDO'),
    ('XII', 'GREEN PERU'),
    ('XIII', 'DANPER'),
]

# Palabras que no distinguen a nadie: estan en media docena de nombres.
VACIAS = set(['SA', 'SAC', 'S', 'A', 'C', 'DE', 'DEL', 'LA', 'EL', 'Y',
              'PERU', 'SOCIEDAD', 'AGRICOLA', 'JURP'])


def pelar(texto):
    """Sin tildes, sin puntos, en mayusculas."""
    t = unicodedata.normalize('NFKD', str(texto or ''))
    t = ''.join(c for c in t if not unicodedata.combining(c))
    return re.sub(r'[^A-Za-z0-9 ]+', ' ', t).upper()


def fichas(texto):
    return [p for p in pelar(texto).split() if p and p not in VACIAS]


def titulo(n, t):
    print('')
    print('=' * 74)
    print('%s. %s' % (n, t))
    print('=' * 74)


# ══════════════════════════════════════════════════════════════════════════
titulo(1, 'EL PADRON FRENTE AL CUADRO DE TRAMOS')
# ══════════════════════════════════════════════════════════════════════════

Usuario = get_user_model()
cuentas = []
for u in Usuario.objects.all().order_by('username'):
    grupos = sorted(g.name for g in u.groups.all())
    cuentas.append({
        'u': u,
        'texto': ' '.join([u.username or '', u.first_name or '',
                           u.last_name or '']),
        'grupos': grupos,
    })

print('Cuentas en el padron: %d' % len(cuentas))
print('')

enlazadas = 0
for tramo, empresa in EMPRESAS:
    pistas = set(fichas(empresa))
    mejor, puntos = None, 0
    for c in cuentas:
        tiene = set(fichas(c['texto']))
        comunes = pistas & tiene
        if not comunes:
            continue
        # Cuantas de las palabras distintivas de la empresa aparecen.
        p = len(comunes) * 10 + (5 if pistas <= tiene else 0)
        if p > puntos:
            mejor, puntos = c, p
    if mejor:
        enlazadas += 1
        u = mejor['u']
        print('  %-5s %-28s -> %-18s %-26s %s'
              % (tramo, empresa, u.username,
                 ((u.first_name or '') + ' ' + (u.last_name or '')).strip()[:26],
                 ','.join(mejor['grupos']) or 'sin grupo'))
    else:
        print('  %-5s %-28s -> SIN CUENTA' % (tramo, empresa))

print('')
print('Con cuenta probable: %d de %d' % (enlazadas, len(EMPRESAS)))
print('')
print('OJO: esto empareja por palabras, no es la verdad. Lo de abajo es el')
print('padron entero para que lo mires tu, que es quien sabe quien es quien.')
print('')
for c in cuentas:
    u = c['u']
    print('  %-20s %-30s %-28s %s'
          % (u.username,
             ((u.first_name or '') + ' ' + (u.last_name or '')).strip()[:30],
             ','.join(c['grupos'])[:28],
             'activo' if u.is_active else 'INACTIVO'))


# ══════════════════════════════════════════════════════════════════════════
titulo(2, 'EL MODELO DE INCIDENTE: EL MOLDE A COPIAR')
# ══════════════════════════════════════════════════════════════════════════

candidatos = [m for m in apps.get_models()
              if 'incident' in m.__name__.lower()
              or 'incidenc' in m.__name__.lower()]

if not candidatos:
    print('  No encontre ningun modelo con "incident" en el nombre.')
else:
    for m in candidatos:
        print('')
        print('  %s.%s   (tabla %s)'
              % (m._meta.app_label, m.__name__, m._meta.db_table))
        for f in m._meta.get_fields():
            if not hasattr(f, 'get_internal_type'):
                continue
            extra = ''
            opciones = getattr(f, 'choices', None)
            if opciones:
                extra = '  opciones: ' + ', '.join(
                    '%s=%s' % (str(a), str(b)) for a, b in list(opciones)[:12])
            rel = getattr(f, 'related_model', None)
            if rel is not None:
                extra = '  -> %s' % rel.__name__
            print('      %-26s %-18s%s'
                  % (f.name, f.get_internal_type(), extra))


# ══════════════════════════════════════════════════════════════════════════
titulo(3, 'DONDE VIVE SU CODIGO')
# ══════════════════════════════════════════════════════════════════════════

BASE = str(getattr(settings, 'BASE_DIR', '/app'))
encontrados = []
for raiz, dirs, archivos in os.walk(BASE):
    dirs[:] = [d for d in dirs
               if d not in ('.git', '__pycache__', 'node_modules', 'media',
                            'static', 'venv', '.venv', 'migrations')]
    for a in archivos:
        if not a.endswith('.py'):
            continue
        ruta = os.path.join(raiz, a)
        try:
            with open(ruta, 'r') as f:
                t = f.read()
        except Exception:
            continue
        if 'hi-incidents' in t or 'hi_incidents' in t:
            encontrados.append((ruta, t))

for ruta, t in encontrados[:8]:
    print('  %s' % ruta.replace(BASE, ''))
    for i, l in enumerate(t.splitlines()):
        if re.search(r"url\(|class .*View|def (get|post|put|patch)\b", l):
            if 'incident' in l.lower() or 'url(' in l:
                print('      %4d | %s' % (i + 1, l.strip()[:96]))

print('')
print('  --- el catalogo que ya baja la app (tipos/severidades/estados) ---')
for ruta, t in encontrados:
    if 'get-configuration' in t or 'get_configuration' in t:
        print('  en %s' % ruta.replace(BASE, ''))
        break


# ══════════════════════════════════════════════════════════════════════════
titulo(4, '¿HAY YA ALGO PARECIDO A UNA CAMPANA?')
# ══════════════════════════════════════════════════════════════════════════
# Si ya existe un modelo con fechas de inicio y fin al que colgarse, mejor
# colgarse de el que inventar otro al lado.

for m in apps.get_models():
    nombres = set(f.name for f in m._meta.get_fields()
                  if hasattr(f, 'get_internal_type'))
    if {'fecha_inicio', 'fecha_fin'} & nombres or \
       {'start_date', 'end_date'} & nombres:
        print('  %s.%s  -> %s'
              % (m._meta.app_label, m.__name__,
                 ', '.join(sorted(nombres & {'fecha_inicio', 'fecha_fin',
                                             'start_date', 'end_date'}))))

print('')
print('=' * 74)
print('Pegame la salida y escribo el modelo contra lo que hay, no contra')
print('lo que supongo.')
print('=' * 74)
