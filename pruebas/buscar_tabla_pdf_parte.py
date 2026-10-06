# -*- coding: utf-8 -*-
"""
Localiza la tabla del PDF del parte diario para poder separar HM INI . FIN
en dos columnas.

    python3 buscar_tabla_pdf_parte.py                 # busca desde la carpeta actual
    python3 buscar_tabla_pdf_parte.py /ruta/al/codigo

Se ejecuta EN EL SERVIDOR de gideonstudio.duckdns.org, sobre el codigo fuente
(no dentro del contenedor). SOLO LEE: no escribe ni modifica nada.

QUE BUSCA. El visor de la web pide el PDF a:

    /api/v1/mobile/operations/daily-part-heavy-equipments/<id>/pdf/

La tabla de actividades de ese PDF lleva hoy una sola columna con el horometro
inicial y el final juntos, y se ven apilados en dos renglones. Para separarlos
en dos columnas hace falta ver tres cosas, que es lo que imprime este script:

  1. La vista que atiende ese endpoint.
  2. Donde se arma la tabla: las cabeceras y los anchos de columna.
  3. Que motor dibuja el PDF (ReportLab, WeasyPrint, xhtml2pdf...), porque el
     cambio se escribe distinto en cada uno.

Pega la salida entera y con eso preparo el parche exacto, con sus anclajes,
como los anteriores.

Compatible con Python 2.7 y 3.x: no uso f-strings ni nada posterior.
"""

from __future__ import print_function, unicode_literals

import io
import os
import re
import sys

RUTA_ARG = [a for a in sys.argv[1:] if not a.startswith("-")]
BASE = os.path.abspath(RUTA_ARG[0]) if RUTA_ARG else os.getcwd()

SALTAR = (".git", "node_modules", "__pycache__", ".venv", "venv",
          "site-packages", "static", "media", ".cache", "migrations")

EXTENSIONES = (".py", ".html", ".txt")

# Pistas, de la mas concreta a la mas general.
PISTAS = [
    ("endpoint del PDF",      re.compile(r"daily-part-heavy-equipments|daily_part_heavy_equipment", re.I)),
    ("horometro inicial",     re.compile(r"start_horometer|hm_inicio|horometro_inicial", re.I)),
    ("horometro final",       re.compile(r"end_horometer|hm_fin|horometro_final", re.I)),
    ("cabecera HM",           re.compile(r"HM\s*(INI|INICIO)|HM\s*[.·-]\s*FIN|HOR[OÓ]METRO", re.I)),
    ("motor del PDF",         re.compile(r"reportlab|weasyprint|xhtml2pdf|pisa|SimpleDocTemplate|HTML\(", re.I)),
    ("anchos de columna",     re.compile(r"colWidths|col_widths|TableStyle|cellWidths", re.I)),
]


def archivos():
    for raiz, carpetas, nombres in os.walk(BASE):
        carpetas[:] = [c for c in carpetas if c not in SALTAR]
        for n in nombres:
            if n.endswith(EXTENSIONES):
                yield os.path.join(raiz, n)


def leer(ruta):
    try:
        with io.open(ruta, encoding="utf-8", errors="replace") as f:
            return f.read().split("\n")
    except (IOError, OSError):
        return []


print("Buscando bajo: {0}".format(BASE))
print("")

# ---------------------------------------------------------------- resumen
hallazgos = {}          # etiqueta -> [(ruta, nlinea, texto)]
por_archivo = {}        # ruta -> set(etiquetas)

for ruta in archivos():
    lineas = leer(ruta)
    if not lineas:
        continue
    for i, l in enumerate(lineas):
        for etiqueta, patron in PISTAS:
            if patron.search(l):
                hallazgos.setdefault(etiqueta, []).append((ruta, i + 1, l.rstrip()))
                por_archivo.setdefault(ruta, set()).add(etiqueta)

if not hallazgos:
    print("No encontre ninguna pista. Pasa la carpeta del codigo como argumento,")
    print("por ejemplo:  python3 {0} /var/www/...".format(os.path.basename(sys.argv[0])))
    sys.exit(1)

print("=" * 76)
print("1. QUE ARCHIVOS TIENEN MAS PISTAS JUNTAS")
print("=" * 76)
print("")
print("El que las reuna casi todas es, con mucha probabilidad, el que arma la")
print("tabla del PDF.")
print("")

ordenados = sorted(por_archivo.items(), key=lambda kv: (-len(kv[1]), kv[0]))
for ruta, etiquetas in ordenados[:12]:
    print("  [{0}/{1}] {2}".format(len(etiquetas), len(PISTAS), ruta))
    print("           {0}".format(", ".join(sorted(etiquetas))))
print("")

# ------------------------------------------------- detalle de cada pista
print("=" * 76)
print("2. DONDE APARECE CADA PISTA")
print("=" * 76)
for etiqueta, _ in PISTAS:
    filas = hallazgos.get(etiqueta, [])
    print("")
    print("-- {0} ({1} coincidencia(s))".format(etiqueta, len(filas)))
    if not filas:
        print("   ninguna")
        continue
    for ruta, n, texto in filas[:12]:
        print("   {0}:{1}".format(ruta, n))
        print("       {0}".format(texto.strip()[:110]))
    if len(filas) > 12:
        print("   ... y {0} mas".format(len(filas) - 12))

# ------------------------------------------- el trozo que de verdad importa
print("")
print("=" * 76)
print("3. EL TROZO QUE ARMA LA TABLA")
print("=" * 76)
print("")
print("De cada archivo con mas pistas, 30 lineas alrededor de donde aparecen")
print("los horometros. Esto es lo que necesito para escribir los anclajes.")

CERCA = re.compile(r"start_horometer|end_horometer|hm_inicio|hm_fin|"
                   r"HM\s*(INI|INICIO)|HOR[OÓ]METRO", re.I)

mostrados = 0
for ruta, etiquetas in ordenados:
    if len(etiquetas) < 2 or mostrados >= 3:
        continue
    lineas = leer(ruta)
    puntos = [i for i, l in enumerate(lineas) if CERCA.search(l)]
    if not puntos:
        continue

    # Une los puntos cercanos para no imprimir el mismo trozo tres veces.
    bloques = []
    for p in puntos:
        if bloques and p - bloques[-1][1] <= 30:
            bloques[-1][1] = p
        else:
            bloques.append([p, p])

    print("")
    print("#" * 76)
    print("# {0}".format(ruta))
    print("#" * 76)
    for ini, fin in bloques[:3]:
        a = max(0, ini - 15)
        b = min(len(lineas), fin + 16)
        print("")
        print("    ----- lineas {0} a {1} -----".format(a + 1, b))
        for i in range(a, b):
            marca = ">>" if CERCA.search(lineas[i]) else "  "
            print("    {0} {1:5d}  {2}".format(marca, i + 1, lineas[i].rstrip()[:118]))
    mostrados += 1

print("")
print("=" * 76)
print("")
print("Pega TODO esto y te devuelvo el parche con sus anclajes, como los otros.")
print("Este script no ha escrito nada.")
