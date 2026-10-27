# -*- coding: utf-8 -*-
"""
Cada unidad dice tambien si su linea LLEVA HOROMETRO.

POR QUE HACE FALTA
------------------
En el parte diario de maquinaria, cada linea es un trabajo de la maquina y
lleva su tramo de horometro: de ahi salen las horas y el costo. Pero no todas
las lineas son trabajo de la maquina. «Petroleo - DV Compositan I», medida en
galones, es el combustible que se le echo: no tiene horometro de inicio ni de
fin, ni horas efectivas, ni horas muertas que justificar.

Hasta ahora el formulario los pedia igual, y ademas eran obligatorios: no se
podia guardar una carga de combustible sin inventarse un tramo. Y un tramo
inventado entra en el costo como horas trabajadas.

POR QUE EN EL CATALOGO Y NO EN EL CODIGO
----------------------------------------
Lo facil era preguntar `if unidad == "Gln"` dentro de la pantalla. Eso
funciona hoy y se rompe el dia que JURP mida el combustible en litros, o
quiera lo mismo para las bolsas de cemento. Es la misma razon por la que las
casillas de medida viven aqui: la unidad declara como se comporta, y quien
mantiene el catalogo lo cambia sin que nadie toque codigo.

NACE EN True
------------
Una unidad nueva lleva horometro mientras no se diga lo contrario. La
mayoria de las partidas de un parte de maquinaria SON trabajo de maquina, y
el valor por defecto tiene que ser el caso normal.

De las veinte del catalogo, solo Gln se marca sin horometro. Lt, Kg o Bls
tambien podrian serlo, pero eso lo sabe JURP y no yo: se destildan desde
Proyectos -> Unidades cuando haga falta.

QUE TOCA
--------
    1. operations/models.py       un booleano mas en Unidad
    2. operations/serializers.py  exponerlo
    3. el comando de siembra      ponerlo en False para Gln

USO
---
    python3 parche_unidades_horometro.py [--raiz /var/www/envs/vigilantes] [--dry-run]

Despues hay que migrar y volver a sembrar. Es idempotente y deja .bak.
"""

import argparse
import os
import shutil
import sys


MODELO_ANCLA = '''    usa_coeficiente = models.BooleanField("Usa coeficiente", default=True)
    activo = models.BooleanField("Activo", default=True)'''

MODELO_NUEVO = '''    usa_coeficiente = models.BooleanField("Usa coeficiente", default=True)
    # ¿La linea de un parte medida en esta unidad lleva tramo de horometro?
    # El combustible no: no es trabajo de la maquina, es lo que se le echo.
    # Nace en True porque la mayoria de las partidas de un parte SI son
    # trabajo de maquina.
    usa_horometro = models.BooleanField("Lleva horometro", default=True)
    activo = models.BooleanField("Activo", default=True)'''


SER_ANCLA = '''        fields = ["id", "codigo", "nombre",
                  "usa_largo", "usa_ancho", "usa_altura", "usa_area",
                  "usa_coeficiente", "activo"]'''

SER_NUEVO = '''        fields = ["id", "codigo", "nombre",
                  "usa_largo", "usa_ancho", "usa_altura", "usa_area",
                  "usa_coeficiente", "usa_horometro", "activo"]'''


SIEMBRA_ANCLA = """# codigo, nombre, largo, ancho, altura, area"""

SIEMBRA_NUEVA = """# codigo, nombre, largo, ancho, altura, area, horometro"""

# La tabla entera, con la columna de horometro al final.
TABLA_VIEJA = '''UNIDADES = [
    ("m3",   "Metro Cubico",   True,  True,  True,  True),
    ("m2",   "Metro Cuadrado", True,  True,  False, True),
    ("m",    "Metro Lineal",   True,  False, False, False),
    ("Gln",  "Galon",          False, False, False, False),
    ("Und",  "Unidad",         False, False, False, False),
    ("Kg",   "Kilogramo",      False, False, False, False),
    ("Bls",  "Bolsa",          False, False, False, False),
    ("H-H",  "Hora-Hombre",    False, False, False, False),
    ("H-M",  "Hora-Maquina",   False, False, False, False),
    ("Glb",  "Global",         False, False, False, False),
    ("Tn",   "Tonelada",       False, False, False, False),
    ("Lt",   "Litro",          False, False, False, False),
    ("Km",   "Kilometro",      False, False, False, False),
    ("Pza",  "Pieza",          False, False, False, False),
    ("Rll",  "Rollo",          False, False, False, False),
    ("Pulg", "Pulgada",        False, False, False, False),
    ("Est",  "Estacion",       False, False, False, False),
    ("Via",  "Viaje",          False, False, False, False),
    ("Mes",  "Mes",            False, False, False, False),
    ("Dia",  "Dia",            False, False, False, False),
]'''

TABLA_NUEVA = '''UNIDADES = [
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

BUCLE_VIEJO = '''        for codigo, nombre, largo, ancho, altura, area in UNIDADES:'''
BUCLE_NUEVO = '''        for codigo, nombre, largo, ancho, altura, area, horom in UNIDADES:'''

CREAR_VIEJO = '''                    usa_area=area, usa_coeficiente=True)'''
CREAR_NUEVO = '''                    usa_area=area, usa_coeficiente=True,
                    usa_horometro=horom)'''

AJUSTE_VIEJO = '''                                 ("usa_coeficiente", True)):'''
AJUSTE_NUEVO = '''                                 ("usa_coeficiente", True),
                                 ("usa_horometro", horom)):'''


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
    """Aplica una lista de (viejo, nuevo); cada viejo debe salir una vez."""
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
            args.raiz, 'operations/models.py', 'usa_horometro',
            [(MODELO_ANCLA, MODELO_NUEVO)], args.dry_run)),
        ('serializer', lambda: paso(
            args.raiz, 'operations/serializers.py', 'usa_horometro',
            [(SER_ANCLA, SER_NUEVO)], args.dry_run)),
        ('siembra', lambda: paso(
            args.raiz, 'operations/management/commands/sembrar_unidades.py',
            'usa_horometro',
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
        print('Si «siembra» falla, es que no se aplico antes')
        print('parche_unidades_dimensiones.py.')
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
