# -*- coding: utf-8 -*-
"""
Desbloquea las migraciones: n__usuario pasa a llamarse n_usuarios.

    python3 parche_campo_roto.py                 # solo muestra
    python3 parche_campo_roto.py --aplicar        # aplica, con respaldo
    python3 parche_campo_roto.py /ruta/al/codigo

Se ejecuta EN EL SERVIDOR (api_vigilantes), sobre el codigo fuente.

EL PROBLEMA. inventario.TomaCanalMadre.n__usuario dispara fields.E002 y con
eso bloquea makemigrations y migrate de TODO el proyecto, no solo de su app.
Django prohibe "__" en un nombre de campo porque es su separador para
recorrer relaciones: con n__usuario no sabria si pides ese campo o el campo
'usuario' de una relacion llamada 'n'.

DE DONDE SALE. La tabla se llama tomas_canal_madre y tiene ogc_fid y geom:
entro por ogr2ogr desde un shapefile o un KMZ, no por Django. El doble guion
bajo es como quedo el nombre de la columna "N° USUARIO" al sanearlo.

EL ARREGLO. El atributo pasa a n_usuarios y se le fija db_column='n__usuario'.
La COLUMNA NO SE TOCA: sigue llamandose igual en postgis. Y el modelo es
managed=False, asi que Django tampoco gestiona esa tabla.

LA MIGRACION QUE SALGA NO EJECUTA SQL sobre esa tabla. Para un modelo
managed=False, Django registra el cambio en el estado pero el schema editor
no emite DDL. Las 95 filas no se tocan.

QUE COMPRUEBA ANTES. Busca otras menciones de n__usuario en todo el codigo.
Si alguna esta en un serializer, renombrar cambiaria la CLAVE DEL JSON que
ve la app movil, y eso ya no es un cambio interno. En ese caso lo dice y no
escribe nada, para decidirlo a conciencia.
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

VIEJO = "n__usuario"
NUEVO = "n_usuarios"
SALTAR = (".git", "node_modules", "__pycache__", ".venv", "venv", "site-packages",
          "static", "media", "migrations")

ANCLA = "    n__usuario = models.IntegerField('N° de usuarios', blank=True, null=True)\n"

REEMPLAZO = """    # Se llama n_usuarios en Python y n__usuario en la base.
    #
    # El doble guion bajo viene del shapefile que cargo ogr2ogr. Django lo
    # prohibe en un nombre de campo (fields.E002) porque es su separador para
    # recorrer relaciones: con n__usuario no sabria si pides este campo o el
    # campo 'usuario' de una relacion llamada 'n'. Ese check bloqueaba
    # makemigrations y migrate de TODO el proyecto, no solo de esta app.
    #
    # db_column conserva el nombre real de la columna, asi que la tabla no se
    # toca; y el modelo es managed=False, asi que Django ni la gestiona.
    n_usuarios = models.IntegerField('N° de usuarios', blank=True, null=True,
                                     db_column='n__usuario')
"""


def archivos_py():
    for raiz, carpetas, nombres in os.walk(BASE):
        carpetas[:] = [c for c in carpetas if c not in SALTAR]
        for n in nombres:
            if n.endswith((".py", ".html")):
                yield os.path.join(raiz, n)


F_MODELS = os.path.join(BASE, "inventario", "models.py")
if not os.path.isfile(F_MODELS):
    print("No encuentro {0}.".format(F_MODELS))
    print("Pasa la carpeta del codigo como argumento:")
    print("  python3 {0} /root/proyectos/api_vigilantes".format(os.path.basename(sys.argv[0])))
    sys.exit(1)

print("Carpeta: {0}".format(BASE))
print("")
print("=" * 78)
print("Desbloquear las migraciones: {0} -> {1}".format(VIEJO, NUEVO))
print("=" * 78)
print("")

# ── 1. todas las menciones, para no renombrar a ciegas ───────────────────
menciones = []
for ruta in archivos_py():
    try:
        txt = io.open(ruta, encoding="utf-8", errors="replace").read()
    except (IOError, OSError):
        continue
    if VIEJO not in txt:
        continue
    for i, l in enumerate(txt.split("\n"), 1):
        if VIEJO in l:
            menciones.append((ruta, i, l.rstrip()))

print("Menciones de '{0}' en el codigo: {1}".format(VIEJO, len(menciones)))
for ruta, i, l in menciones:
    rel = ruta[len(BASE):].lstrip(os.sep)
    print("  {0}:{1}".format(rel, i))
    print("      {0}".format(l.strip()[:100]))
print("")

# Una mencion dentro de un serializer cambia la clave del JSON, no solo el
# codigo. Eso afecta a la app movil y no se decide de pasada.
sospechosas = [m for m in menciones
               if "serializer" in m[0].lower() and "models.py" not in m[0]]
if sospechosas:
    print("CUIDADO: hay menciones en serializers.")
    print("Renombrar cambiaria la CLAVE DEL JSON que consume la app movil, no")
    print("solo el codigo del servidor. NO se escribe nada: dime si prefieres")
    print("conservar la clave con un alias en el serializer.")
    sys.exit(1)

fuera_de_models = [m for m in menciones if os.path.abspath(m[0]) != os.path.abspath(F_MODELS)]

with io.open(F_MODELS, encoding="utf-8") as f:
    txt_models = f.read()

if NUEVO in txt_models and ANCLA not in txt_models:
    print("models.py ya parece arreglado. No se escribe nada.")
    sys.exit(0)

if txt_models.count(ANCLA) != 1:
    print("NO SE APLICA: el campo aparece {0} veces tal como lo espero (deberia ser 1).".format(
        txt_models.count(ANCLA)))
    print("")
    print("Esperaba exactamente esta linea:")
    print("  {0}".format(ANCLA.strip()))
    print("")
    print("Pega este mensaje y ajusto el anclaje.")
    sys.exit(1)

print("-" * 78)
print("  - {0}".format(ANCLA.strip()))
for l in REEMPLAZO.rstrip("\n").split("\n"):
    print("  + {0}".format(l.strip() if l.strip().startswith("#") else l[4:]))
print("-" * 78)
print("")

nuevo_models = txt_models.replace(ANCLA, REEMPLAZO, 1)

# Las demas menciones (accesos al atributo) se renombran tambien, o el codigo
# quedaria roto de otra forma distinta.
otros = {}
for ruta, _, _ in fuera_de_models:
    if ruta in otros:
        continue
    t = io.open(ruta, encoding="utf-8").read()
    otros[ruta] = t.replace(VIEJO, NUEVO)

if otros:
    print("Ademas se renombra la mencion en:")
    for ruta in otros:
        print("  {0}".format(ruta[len(BASE):].lstrip(os.sep)))
    print("")

for nombre, texto in [("inventario/models.py", nuevo_models)] + \
        [(r[len(BASE):].lstrip(os.sep), t) for r, t in otros.items()]:
    if not nombre.endswith(".py"):
        continue
    try:
        compile(texto.encode("utf-8"), nombre, "exec")
    except SyntaxError as e:
        print("NO SE ESCRIBE NADA: {0} no compilaria ({1}, linea {2}).".format(
            nombre, e.msg, e.lineno))
        sys.exit(1)
print("Todo compila.")
print("")

if not APLICAR:
    print("Listo para aplicar. NADA se ha escrito.")
    print("Para aplicarlo:  python3 {0} --aplicar".format(os.path.basename(sys.argv[0])))
    sys.exit(0)

objetivo = [F_MODELS] + list(otros.keys())
sin_permiso = [r for r in objetivo if not os.access(r, os.W_OK)]
if sin_permiso:
    print("NO SE ESCRIBE NADA. Sin permiso de escritura en:")
    for r in sin_permiso:
        print("  {0}".format(r))
    print("")
    print("Vuelve a lanzarlo con sudo.")
    sys.exit(1)

respaldos = []
for r in objetivo:
    destino = r + ".bak"
    if os.path.exists(destino):
        import time
        destino = r + ".bak." + time.strftime("%Y%m%d-%H%M%S")
    shutil.copy2(r, destino)
    respaldos.append((destino, r))
    print("Respaldo: {0}".format(destino))

io.open(F_MODELS, "w", encoding="utf-8").write(nuevo_models)
print("Escrito: {0}".format(F_MODELS))
for r, t in otros.items():
    io.open(r, "w", encoding="utf-8").write(t)
    print("Escrito: {0}".format(r))

print("")
print("=" * 78)
print("Ahora SI deberian correr las migraciones:")
print("")
print("  docker compose exec web python manage.py makemigrations")
print("  docker compose exec web python manage.py migrate")
print("")
print("La migracion de inventario no ejecutara SQL sobre tomas_canal_madre:")
print("el modelo es managed=False y la columna conserva su nombre. Las 95")
print("filas no se tocan.")
print("=" * 78)
print("")
print("Para deshacer:")
for destino, original in respaldos:
    print("  mv {0} {1}".format(destino, original))
