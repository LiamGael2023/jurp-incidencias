# -*- coding: utf-8 -*-
"""
¿Siguen diciendo lo mismo el catálogo de la app y el del visor web?

    python3 herramientas/comparar_capas.py          # desde app_inventario/
    python3 herramientas/comparar_capas.py --web ../src/InventarioGIS.jsx

Devuelve 0 si coinciden y 1 si no, para poder encadenarlo.

POR QUÉ HACE FALTA ESTO
-----------------------
El catálogo está escrito dos veces a propósito —los colores y la agrupación
son una decisión de cartografía, no un dato que sirva el servidor— y dos
copias de algo es, siempre, dos sitios donde corregir. La diferencia es que
aquí separarse no rompe nada: la app sigue compilando y el mapa sigue
dibujando. Simplemente, una capa nueva no aparece en el teléfono, o aparece
de otro color, y nadie se entera hasta que alguien en campo dice que su
mapa no se parece al de la oficina.

Esto lo dice en un segundo.

LO QUE NO COMPARA
-----------------
Los iconos: en la web son PNG del inventario oficial y en la app son los de
Material, y eso es a propósito (está explicado en `catalogo_capas.dart`).
Tampoco el orden dentro de cada grupo.

LA RED VIAL NACIONAL NO CUENTA COMO DIFERENCIA. Está en la web y no en la
app, con su motivo escrito en el código: es la capa más pesada y la menos
útil en campo, porque la Panamericana ya se ve en la ortofoto. Si algún día
entra, basta con quitarla de AUSENTES_A_PROPOSITO.
"""
import argparse
import os
import re
import sys

AQUI = os.path.dirname(os.path.abspath(__file__))
APP = os.path.join(AQUI, '..', 'lib', 'src', 'utils', 'catalogo_capas.dart')
WEB = os.path.join(AQUI, '..', '..', 'src', 'InventarioGIS.jsx')

AUSENTES_A_PROPOSITO = {
    'red_nacional_kmz': 'la Panamericana ya se ve en la ortofoto',
}

# Los alias de color que usa el Dart para no repetir el mismo azul.
ALIAS = {'_azulToma': '#4dabf7'}

GEOM = {'TipoGeom.linea': 'linea', 'TipoGeom.poligono': 'poligono'}


def capas_web(texto):
    fuera = {}
    for m in re.finditer(
            r"\{\s*codigo:\s*'([^']+)'\s*,\s*label:\s*'([^']*)'\s*,"
            r"\s*color:\s*'(#[0-9a-fA-F]{6})'(.*?)\}", texto):
        cod, lab, col, resto = m.groups()
        tipo = (re.search(r"tipo:\s*'(\w+)'", resto) or [None, 'point'])[1]
        fuera[cod] = {
            'label': lab,
            'color': col.lower(),
            'geom': {'line': 'linea', 'poly': 'poligono'}.get(tipo, 'punto'),
        }
    return fuera


def capas_app(texto):
    fuera = {}
    # Cada Capa(...) abarca hasta donde empieza la siguiente: así da igual
    # en cuántas líneas esté partida ni cuántos comentarios lleve dentro.
    for trozo in re.split(r"(?=Capa\(')", texto):
        m = re.match(
            r"Capa\('([^']+)',\s*'([^']*)',\s*"
            r"(_\w+|Color\(0x(?:FF)?([0-9A-Fa-f]{6})\))", trozo)
        if not m:
            continue
        cod, lab, crudo, hexa = m.groups()
        color = ALIAS.get(crudo) if crudo.startswith('_') else '#' + hexa.lower()
        geom = GEOM.get(
            (re.search(r"tipo:\s*(TipoGeom\.\w+)", trozo) or [None, ''])[1],
            'punto')
        fuera[cod] = {'label': lab, 'color': color, 'geom': geom}
    return fuera


def comparar(web, app):
    problemas = []

    for cod in web:
        if cod in app:
            continue
        if cod in AUSENTES_A_PROPOSITO:
            continue
        problemas.append(f'{cod}: está en el visor web y no en la app')

    for cod in app:
        if cod not in web:
            problemas.append(f'{cod}: está en la app y no en el visor web')
        elif cod in AUSENTES_A_PROPOSITO:
            problemas.append(
                f'{cod}: figura como ausente a propósito pero está en la app; '
                f'quítala de AUSENTES_A_PROPOSITO')

    for cod in sorted(set(web) & set(app)):
        for campo in ('label', 'color', 'geom'):
            if web[cod][campo] != app[cod][campo]:
                problemas.append(
                    f'{cod}: {campo} web={web[cod][campo]!r} '
                    f'app={app[cod][campo]!r}')
    return problemas


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--web', default=WEB)
    p.add_argument('--app', default=APP)
    args = p.parse_args()

    for ruta in (args.web, args.app):
        if not os.path.exists(ruta):
            print(f'no encuentro {ruta}', file=sys.stderr)
            return 2

    web = capas_web(open(args.web, encoding='utf-8').read())
    app = capas_app(open(args.app, encoding='utf-8').read())

    if not web or not app:
        # Si un catálogo sale vacío, lo que ha cambiado es la FORMA de
        # escribirlo y la expresión regular ya no lo reconoce. Decirlo en
        # vez de cantar «todo bien» sobre cero capas.
        print('no he sabido leer uno de los dos catálogos '
              f'(web={len(web)}, app={len(app)}); revisa las expresiones '
              'regulares de esta herramienta', file=sys.stderr)
        return 2

    print(f'visor web: {len(web)} capas · app: {len(app)} capas')
    for cod, motivo in AUSENTES_A_PROPOSITO.items():
        if cod in web and cod not in app:
            print(f'  (fuera a propósito: {cod} — {motivo})')

    problemas = comparar(web, app)
    if not problemas:
        print('coinciden')
        return 0
    print(f'\n{len(problemas)} diferencia(s):')
    for x in problemas:
        print(f'  {x}')
    return 1


if __name__ == '__main__':
    sys.exit(main())
