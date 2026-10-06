# -*- coding: utf-8 -*-
"""
La partida del presupuesto sale en el PDF del parte diario.

    python3 parche_partida_en_pdf.py                 # solo muestra
    python3 parche_partida_en_pdf.py --aplicar        # aplica, con respaldo
    python3 parche_partida_en_pdf.py /ruta/al/codigo

Se ejecuta EN EL SERVIDOR (api_vigilantes), sobre la plantilla.

DONDE SE PONE Y POR QUE AHI. Debajo del nombre de la actividad, no en una
columna propia. La tabla ya tiene ocho columnas y el codigo mas la
descripcion de una partida pasan de los cien caracteres: una columna mas
obligaria a estrechar ZONA y ACTIVIDAD hasta partirlas en cuatro lineas.
Debajo cabe entera y se lee como lo que es, una aclaracion de a que se
imputo ese metrado.

SE IMPRIME LA COPIA, NO LA PARTIDA VIVA. La actividad guarda partida_codigo
y partida_descripcion copiados al guardar el parte. Si manana se recarga el
presupuesto y esa partida cambia de texto o desaparece, el PDF de un parte
ya firmado tiene que seguir diciendo lo mismo que decia el dia que se firmo.
Por eso NO se usa a.partida.descripcion.

Requiere el parche del modelo (parche_partidas_backend.py) aplicado antes.
"""

from __future__ import print_function, unicode_literals

import io
import os
import re
import shutil
import sys

APLICAR = "--aplicar" in sys.argv
RUTA_ARG = [a for a in sys.argv[1:] if not a.startswith("-")]
BASE = os.path.abspath(RUTA_ARG[0]) if RUTA_ARG else os.getcwd()

SALTAR = (".git", "node_modules", "__pycache__", ".venv", "venv",
          "site-packages", "static", "media", "migrations")
NOMBRE = "pdf_parte_diario.html"


def localizar():
    out = []
    for raiz, carpetas, archivos in os.walk(BASE):
        carpetas[:] = [c for c in carpetas if c not in SALTAR]
        if NOMBRE in archivos:
            out.append(os.path.join(raiz, NOMBRE))
    return out


print("Buscando {0} bajo: {1}".format(NOMBRE, BASE))
rutas = localizar()
if not rutas:
    print("")
    print("No lo encuentro. Pasa la carpeta del codigo como argumento.")
    sys.exit(1)
if len(rutas) > 1:
    print("Hay {0} copias y no elijo por ti:".format(len(rutas)))
    for r in rutas:
        print("  {0}".format(r))
    sys.exit(1)

RUTA = rutas[0]
print("  -> {0}".format(RUTA))
print("")

with io.open(RUTA, encoding="utf-8") as f:
    texto = f.read()

if "partida_codigo" in texto:
    print("La plantilla ya menciona partida_codigo. Parece aplicado.")
    print("No se ha escrito nada.")
    sys.exit(0)

# La celda de ACTIVIDAD es la unica que imprime a.actividad. Se casa por eso
# y no por su texto exacto, que lleva condicionales de plantilla.
PATRON = re.compile(
    r'([ \t]*)<td>(?=[^\n]*\{\{\s*a\.actividad\s*\}\})[^\n]*</td>[ \t]*\n')

casos = PATRON.findall(texto)
print("=" * 78)
print("La partida, debajo del nombre de la actividad")
print("=" * 78)
print("")

if len(casos) != 1:
    print("NO SE APLICA: la celda de la actividad aparece {0} veces (deberia ser 1).".format(
        len(casos)))
    print("No se ha escrito nada. Pega este mensaje y lo ajusto.")
    sys.exit(1)

m = PATRON.search(texto)
sangria = m.group(1)
vieja = m.group(0).rstrip("\n")

# Se inserta justo despues de {{ a.actividad }}, antes de lo que venga
# detras (la observacion), para que el orden sea: que se hizo, a que partida
# se cargo, y la nota.
NUEVO = ('{% if a.partida_codigo %}<br><span style="font-size: 7pt; color: #0369a1;">'
         '{{ a.partida_codigo }}{% if a.partida_descripcion %} · '
         '{{ a.partida_descripcion }}{% endif %}</span>{% endif %}')

marca = "{{ a.actividad }}"
if vieja.count(marca) != 1:
    print("NO SE APLICA: no encuentro {{ a.actividad }} exactamente una vez en la celda.")
    sys.exit(1)

nueva = vieja.replace(marca, marca + NUEVO, 1)

print("  - {0}".format(vieja.strip()[:150]))
print("")
print("  + {0}".format(nueva.strip()[:150]))
print("")
print("-" * 78)
print("Se imprime la COPIA (partida_codigo / partida_descripcion), no")
print("a.partida.descripcion: un parte ya firmado no puede cambiar de texto")
print("porque manana se recargue el presupuesto.")
print("-" * 78)
print("")

texto_nuevo = texto[:m.start()] + sangria + nueva.strip() + "\n" + texto[m.end():]

# Comprobacion barata de que no se desbalancearon las etiquetas de plantilla.
for etq in ("{% if", "{% endif %}"):
    if texto_nuevo.count("{% if") != texto_nuevo.count("{% endif %}"):
        print("NO SE ESCRIBE NADA: los {% if %} y {% endif %} no cuadran.")
        sys.exit(1)
print("Los if/endif de la plantilla siguen cuadrando: {0} de cada uno.".format(
    texto_nuevo.count("{% endif %}")))
print("")

if not APLICAR:
    print("Listo para aplicar. NADA se ha escrito.")
    print("Para aplicarlo:  python3 {0} --aplicar".format(os.path.basename(sys.argv[0])))
    sys.exit(0)

if not os.access(RUTA, os.W_OK):
    print("NO SE ESCRIBE NADA: sin permiso de escritura en {0}".format(RUTA))
    print("Vuelve a lanzarlo con sudo.")
    sys.exit(1)

destino = RUTA + ".bak"
if os.path.exists(destino):
    import time
    destino = RUTA + ".bak." + time.strftime("%Y%m%d-%H%M%S")
    print("Ya habia un .bak de antes; no lo toco.")
shutil.copy2(RUTA, destino)
print("Respaldo: {0}".format(destino))

with io.open(RUTA, "w", encoding="utf-8") as f:
    f.write(texto_nuevo)
print("Escrito: {0}".format(RUTA))
print("")
print("Es una plantilla, pero el proceso la tiene compilada en memoria:")
print("  docker compose up -d --no-deps --force-recreate web")
print("")
print("Para deshacer:")
print("  mv {0} {1}".format(destino, RUTA))
