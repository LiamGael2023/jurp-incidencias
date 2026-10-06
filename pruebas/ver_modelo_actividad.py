# -*- coding: utf-8 -*-
"""
Vuelca lo que hace falta para enganchar PARTIDAS a las actividades del parte.

    python3 ver_modelo_actividad.py                 # desde la carpeta del codigo
    python3 ver_modelo_actividad.py /ruta/al/codigo

Se ejecuta EN EL SERVIDOR (api_vigilantes). SOLO LEE.

PARA QUE. Hay que anadir un modelo Partida, colgarlo de la actividad y
publicar el avance ejecutado. Para escribir ese parche con anclajes exactos
-y no a ciegas, que es como se corrompen archivos- necesito ver:

  1. El modelo de la ACTIVIDAD del parte, entero.
  2. El modelo del PARTE, para saber como se relacionan.
  3. El serializer que los expone, con sus fields.
  4. Las rutas, para colocar el endpoint nuevo sin chocar.
  5. La version de Django y Python, que decide el estilo de la migracion
     y si puedo usar f-strings.
  6. Cuantas migraciones hay, para saber como se numera la siguiente.

Compatible con Python 2.7 y 3.x.
"""

from __future__ import print_function, unicode_literals

import io
import os
import re
import sys

RUTA_ARG = [a for a in sys.argv[1:] if not a.startswith("-")]
BASE = os.path.abspath(RUTA_ARG[0]) if RUTA_ARG else os.getcwd()
SALTAR = (".git", "node_modules", "__pycache__", ".venv", "venv", "site-packages",
          "static", "media")


def leer(ruta):
    try:
        with io.open(ruta, encoding="utf-8", errors="replace") as f:
            return f.read()
    except (IOError, OSError):
        return ""


def buscar(nombre, dentro=None):
    hallados = []
    for raiz, carpetas, archivos in os.walk(BASE):
        carpetas[:] = [c for c in carpetas if c not in SALTAR]
        if nombre in archivos and (dentro is None or dentro in raiz):
            hallados.append(os.path.join(raiz, nombre))
    return hallados


print("Buscando bajo: {0}".format(BASE))
print("")

# ───────────────────────────────────────────── 5 y 6: versiones y migraciones
print("=" * 78)
print("0. ENTORNO")
print("=" * 78)
print("  Python: {0}".format(sys.version.split()[0]))
try:
    import django
    print("  Django: {0}".format(django.get_version()))
except ImportError:
    req = buscar("requirements.txt")
    if req:
        for l in leer(req[0]).split("\n"):
            if re.match(r"(?i)^\s*django\b", l):
                print("  Django (requirements): {0}".format(l.strip()))
    else:
        print("  Django: no importable desde aqui (normal fuera del contenedor)")

for carp in ("operations",):
    mig = os.path.join(BASE, carp, "migrations")
    if os.path.isdir(mig):
        nums = sorted(f for f in os.listdir(mig)
                      if re.match(r"^\d{4}_", f) and f.endswith(".py"))
        print("  migraciones en {0}: {1}".format(carp, len(nums)))
        if nums:
            print("     ultima: {0}".format(nums[-1]))
print("")


# ────────────────────────────────────────────── 1 y 2: modelos
def clases_de(texto):
    """Devuelve [(nombre, cuerpo)] de cada 'class X(...):' de nivel 0."""
    out = []
    lineas = texto.split("\n")
    i = 0
    while i < len(lineas):
        m = re.match(r"^class\s+(\w+)\s*\(", lineas[i])
        if not m:
            i += 1
            continue
        nombre = m.group(1)
        j = i + 1
        while j < len(lineas):
            l = lineas[j]
            if l.strip() and not l.startswith((" ", "\t")) and not l.startswith(")"):
                break
            j += 1
        out.append((nombre, "\n".join(lineas[i:j])))
        i = j
    return out


INTERES = re.compile(r"(?i)activit|activid|dailypart|parte", re.I)

print("=" * 78)
print("1. MODELOS")
print("=" * 78)
for ruta in buscar("models.py", dentro="operations"):
    txt = leer(ruta)
    clases = clases_de(txt)
    print("")
    print("# {0}   ({1} clases)".format(ruta, len(clases)))
    print("#   todas: {0}".format(", ".join(n for n, _ in clases)))
    for nombre, cuerpo in clases:
        if not INTERES.search(nombre):
            continue
        print("")
        print("-" * 78)
        for l in cuerpo.split("\n"):
            print("   {0}".format(l.rstrip()[:118]))
print("")

# ────────────────────────────────────────────────── 3: serializers
print("=" * 78)
print("2. SERIALIZERS")
print("=" * 78)
for ruta in buscar("serializers.py", dentro="operations"):
    txt = leer(ruta)
    clases = clases_de(txt)
    print("")
    print("# {0}   ({1} clases)".format(ruta, len(clases)))
    print("#   todas: {0}".format(", ".join(n for n, _ in clases)))
    for nombre, cuerpo in clases:
        if not INTERES.search(nombre):
            continue
        print("")
        print("-" * 78)
        for l in cuerpo.split("\n"):
            print("   {0}".format(l.rstrip()[:118]))
print("")

# ───────────────────────────────────────────────────────── 4: rutas
print("=" * 78)
print("3. RUTAS (operations/urls.py)")
print("=" * 78)
for ruta in buscar("urls.py", dentro="operations"):
    print("")
    print("# {0}".format(ruta))
    for i, l in enumerate(leer(ruta).split("\n"), 1):
        if l.strip():
            print("   {0:4d}  {1}".format(i, l.rstrip()[:118]))
print("")

# ─────────────────────────────────────────── por si el admin ya los registra
print("=" * 78)
print("4. ADMIN (solo las lineas de registro)")
print("=" * 78)
for ruta in buscar("admin.py", dentro="operations"):
    print("# {0}".format(ruta))
    for i, l in enumerate(leer(ruta).split("\n"), 1):
        if "register" in l or re.match(r"^class\s", l):
            print("   {0:4d}  {1}".format(i, l.rstrip()[:118]))
print("")
print("=" * 78)
print("")
print("Pega TODO esto. Este script no ha escrito nada.")
