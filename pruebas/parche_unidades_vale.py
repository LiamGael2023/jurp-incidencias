# -*- coding: utf-8 -*-
"""
Cada unidad dice si su linea PIDE UN NUMERO DE VALE.

POR QUE HACE FALTA
------------------
El combustible se carga contra un vale: un comprobante con numero que firma
el grifo y que es lo que despues cuadra con la factura. Hasta ahora ese
numero vivia en la cabecera del parte, uno solo para todo el dia, al lado de
un campo «Combustible (Gls)» que ya se quito. Con el combustible registrado
como una linea mas -contra su partida en galones- el vale tiene que ir en la
linea: es de esa carga, no del parte.

POR QUE UN CAMPO PROPIO Y NO REUSAR usa_horometro
-------------------------------------------------
Era tentador: la unica unidad sin horometro es Gln, y es justo la que pide
vale. Pero son dos cosas distintas. «No es trabajo de la maquina» no implica
«viene con comprobante»: una bolsa de cemento podria ser lo primero sin ser
lo segundo, y el dia que JURP destilde el horometro de Bls se encontraria
con un campo de vale que nadie pidio.

NACE EN False
-------------
Lo normal es no llevar vale. De las veinte, solo Gln se siembra en True.
Lt tambien lo seria si midieran el combustible en litros, pero eso lo sabe
JURP: se marca desde Proyectos -> Unidades.

QUE TOCA
--------
    1. operations/models.py       un booleano mas en Unidad
    2. operations/serializers.py  exponerlo
    3. el comando de siembra      ponerlo en True para Gln

El numero de vale en si NO necesita columna: viaja en el JSON `medidas` de
la actividad, igual que el resto de la grilla.

USO
---
    python3 parche_unidades_vale.py [--raiz /var/www/envs/vigilantes] [--dry-run]

Despues hay que migrar y volver a sembrar. Es idempotente y deja .bak.
"""

import argparse
import os
import shutil
import sys


MODELO_ANCLA = '''    usa_horometro = models.BooleanField("Lleva horometro", default=True)
    activo = models.BooleanField("Activo", default=True)'''

MODELO_NUEVO = '''    usa_horometro = models.BooleanField("Lleva horometro", default=True)
    # ¿La linea pide un numero de vale? El combustible se carga contra un
    # comprobante del grifo, y ese numero es lo que luego cuadra con la
    # factura. Nace en False: lo normal es no llevarlo.
    usa_vale = models.BooleanField("Pide N° de vale", default=False)
    activo = models.BooleanField("Activo", default=True)'''


SER_ANCLA = '''                  "usa_coeficiente", "usa_horometro", "activo"]'''
SER_NUEVO = '''                  "usa_coeficiente", "usa_horometro", "usa_vale", "activo"]'''


SIEMBRA_ANCLA = '''# codigo, nombre, largo, ancho, altura, area, horometro'''
SIEMBRA_NUEVA = '''# codigo, nombre, largo, ancho, altura, area, horometro, vale'''

TABLA_VIEJA = '''UNIDADES = [
    ("m3",   "Metro Cubico",   True,  True,  True,  True,  True),
    ("m2",   "Metro Cuadrado", True,  True,  False, True,  True),
    ("m",    "Metro Lineal",   True,  False, False, False, True),
    # El combustible no es trabajo de la maquina: es lo que se le echo. Sin
    # horometro, sin horas efectivas y sin horas muertas que justificar.
    ("Gln",  "Galon",          False, False, False, False, False),
    ("Und",  "Unidad",         False, False, False, False, True),
    ("Kg",   "Kilogramo",      False, False, False, False, True),
    ("Bls",  "Bolsa",          False, False, False, False, True),
    ("H-H",  "Hora-Hombre",    False, False, False, False, True),
    ("H-M",  "Hora-Maquina",   False, False, False, False, True),
    ("Glb",  "Global",         False, False, False, False, True),
    ("Tn",   "Tonelada",       False, False, False, False, True),
    ("Lt",   "Litro",          False, False, False, False, True),
    ("Km",   "Kilometro",      False, False, False, False, True),
    ("Pza",  "Pieza",          False, False, False, False, True),
    ("Rll",  "Rollo",          False, False, False, False, True),
    ("Pulg", "Pulgada",        False, False, False, False, True),
    ("Est",  "Estacion",       False, False, False, False, True),
    ("Via",  "Viaje",          False, False, False, False, True),
    ("Mes",  "Mes",            False, False, False, False, True),
    ("Dia",  "Dia",            False, False, False, False, True),
]'''

TABLA_NUEVA = '''UNIDADES = [
    ("m3",   "Metro Cubico",   True,  True,  True,  True,  True,  False),
    ("m2",   "Metro Cuadrado", True,  True,  False, True,  True,  False),
    ("m",    "Metro Lineal",   True,  False, False, False, True,  False),
    # El combustible no es trabajo de la maquina: es lo que se le echo. Sin
    # horometro, sin horas efectivas y sin horas muertas que justificar. Y
    # SI con numero de vale: se carga contra un comprobante del grifo.
    ("Gln",  "Galon",          False, False, False, False, False, True),
    ("Und",  "Unidad",         False, False, False, False, True,  False),
    ("Kg",   "Kilogramo",      False, False, False, False, True,  False),
    ("Bls",  "Bolsa",          False, False, False, False, True,  False),
    ("H-H",  "Hora-Hombre",    False, False, False, False, True,  False),
    ("H-M",  "Hora-Maquina",   False, False, False, False, True,  False),
    ("Glb",  "Global",         False, False, False, False, True,  False),
    ("Tn",   "Tonelada",       False, False, False, False, True,  False),
    ("Lt",   "Litro",          False, False, False, False, True,  False),
    ("Km",   "Kilometro",      False, False, False, False, True,  False),
    ("Pza",  "Pieza",          False, False, False, False, True,  False),
    ("Rll",  "Rollo",          False, False, False, False, True,  False),
    ("Pulg", "Pulgada",        False, False, False, False, True,  False),
    ("Est",  "Estacion",       False, False, False, False, True,  False),
    ("Via",  "Viaje",          False, False, False, False, True,  False),
    ("Mes",  "Mes",            False, False, False, False, True,  False),
    ("Dia",  "Dia",            False, False, False, False, True,  False),
]'''

BUCLE_VIEJO = '''        for codigo, nombre, largo, ancho, altura, area, horom in UNIDADES:'''
BUCLE_NUEVO = '''        for codigo, nombre, largo, ancho, altura, area, horom, vale in UNIDADES:'''

CREAR_VIEJO = '''                    usa_horometro=horom)'''
CREAR_NUEVO = '''                    usa_horometro=horom, usa_vale=vale)'''

AJUSTE_VIEJO = '''                                 ("usa_horometro", horom)):'''
AJUSTE_NUEVO = '''                                 ("usa_horometro", horom),
                                 ("usa_vale", vale)):'''


def leer(ruta):
    with open(ruta, 'r') as f:
        return f.read()


def escribir(ruta, texto, simulacro):
    if simulacro:
        return
    shutil.copy2(ruta, ruta + '.bak')
    with open(ruta, 'w') as f:
        f.write(texto)


def paso(raiz, relativo, marca, cambios, simulacro):
    ruta = os.path.join(raiz, relativo)
    if not os.path.exists(ruta):
        return False, 'no existe {0}'.format(ruta)
    t = leer(ruta)
    if marca in t:
        return True, 'ya estaba'
    for viejo, nuevo in cambios:
        if t.count(viejo) != 1:
            return False, ('esperaba una vez «{0}...» y sale {1}'
                           .format(viejo.strip()[:40], t.count(viejo)))
        t = t.replace(viejo, nuevo, 1)
    escribir(ruta, t, simulacro)
    return True, 'anadido'


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--raiz', default='/var/www/envs/vigilantes')
    p.add_argument('--dry-run', action='store_true')
    args = p.parse_args()

    pasos = [
        ('modelo', lambda: paso(
            args.raiz, 'operations/models.py', 'usa_vale',
            [(MODELO_ANCLA, MODELO_NUEVO)], args.dry_run)),
        ('serializer', lambda: paso(
            args.raiz, 'operations/serializers.py', 'usa_vale',
            [(SER_ANCLA, SER_NUEVO)], args.dry_run)),
        ('siembra', lambda: paso(
            args.raiz, 'operations/management/commands/sembrar_unidades.py',
            'usa_vale',
            [(SIEMBRA_ANCLA, SIEMBRA_NUEVA),
             (TABLA_VIEJA, TABLA_NUEVA),
             (BUCLE_VIEJO, BUCLE_NUEVO),
             (CREAR_VIEJO, CREAR_NUEVO),
             (AJUSTE_VIEJO, AJUSTE_NUEVO)], args.dry_run)),
    ]

    fallo = False
    for nombre, fn in pasos:
        ok, detalle = fn()
        print('[{0}] {1}: {2}'.format('OK ' if ok else 'MAL', nombre, detalle))
        if not ok:
            fallo = True

    if fallo:
        print('\nNO se aplico todo. Revisa lo marcado como MAL antes de seguir.')
        print('Si falla, es que no se aplico antes parche_unidades_horometro.py.')
        sys.exit(1)
    if args.dry_run:
        print('\nSimulacro: no se escribio nada.')
        return

    print('\nFalta la migracion y volver a sembrar:')
    print('  docker compose exec -T web python manage.py makemigrations operations')
    print('  docker compose exec -T web python manage.py migrate')
    print('  docker compose exec -T web python manage.py sembrar_unidades')


if __name__ == '__main__':
    main()
