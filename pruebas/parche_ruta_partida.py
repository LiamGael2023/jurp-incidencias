# -*- coding: utf-8 -*-
"""
La partida guarda su ruta completa en el presupuesto.

    python3 parche_ruta_partida.py                 # solo muestra
    python3 parche_ruta_partida.py --aplicar        # aplica, con respaldo

Se ejecuta EN EL SERVIDOR (api_vigilantes), sobre el codigo fuente.

PARA QUE. El selector del parte va a elegir en escalera, nivel por nivel,
desde el presupuesto hasta la partida:

    01              CONSTRUCCION Y MEJORAMIENTO DE OBRAS ... TOMA 10
    01.02           ESTRUCTURAS DE TRATAMIENTO
    01.02.01        TRABAJOS PRELIMINARES
    01.02.01.01     Movilizacion y desmovilizacion de maquinaria pesada

Hasta ahora solo se guardaban los dos ultimos titulos (estructura y grupo),
que bastan para agrupar pero no para recorrer el arbol entero. Esto anade la
ruta completa en JSON:

    [["01","CONSTRUCCION ..."],["01.02","ESTRUCTURAS DE TRATAMIENTO"],
     ["01.02.01","TRABAJOS PRELIMINARES"]]

POR QUE EN JSON Y NO EN TABLAS. La profundidad no es fija: en este
presupuesto 78 partidas tienen cuatro ancestros y 5 tienen tres. Un modelo
de niveles fijos se rompe con la primera rama corta; una tabla de nodos
padre-hijo seria lo correcto si el presupuesto se fuera a editar aqui, pero
no se edita: se carga entero desde el Excel y se consulta. Para eso, la
ruta copiada en cada fila se lee de una sola consulta y no hay que recorrer
nada.

UN DETALLE DEL EXCEL que obliga a normalizar: arriba los codigos van sin
rellenar ("1", "1.02") y abajo rellenos ("01.02.01"). Al enlazar padres con
hijos hay que quitar los ceros o el arbol sale partido en dos. El extractor
ya lo hace y guarda los codigos con dos digitos por tramo, que es como esta
escrito el resto del presupuesto.

NO TOCA NADA DE LO QUE YA FUNCIONA: estructura y grupo se quedan donde
estan, y la ruta es un campo mas.
"""

from __future__ import print_function, unicode_literals

import io
import os
import shutil
import sys

APLICAR = "--aplicar" in sys.argv
RUTA_ARG = [a for a in sys.argv[1:] if not a.startswith("-")]
BASE = os.path.abspath(RUTA_ARG[0]) if RUTA_ARG else os.getcwd()

F_MODELS = os.path.join(BASE, "operations", "models.py")
F_VISTA = os.path.join(BASE, "operations", "views_partidas.py")

ANCLA_MODELO = '    activo = models.BooleanField("Activa", default=True)\n'
NUEVO_MODELO = '''    # Ruta completa hasta esta partida, en JSON:
    #   [["01","CONSTRUCCION ..."],["01.02","ESTRUCTURAS DE TRATAMIENTO"],
    #    ["01.02.01","TRABAJOS PRELIMINARES"]]
    #
    # Sirve para elegir en escalera, nivel por nivel. Va copiada en cada
    # fila y no en una tabla de nodos porque el presupuesto no se edita
    # aqui: se carga entero desde el Excel y solo se consulta. Asi el
    # selector se arma con UNA consulta y sin recorrer arboles.
    #
    # La profundidad no es fija: en Obras10_6 hay partidas con cuatro
    # ancestros y otras con tres.
    ruta = models.TextField("Ruta en el presupuesto (JSON)", blank=True, default="")
    activo = models.BooleanField("Activa", default=True)
'''

ANCLA_SER = '''        fields = ["id", "obra", "proyecto", "codigo", "descripcion", "unidad",
                  "metrado", "precio", "estructura", "grupo", "activo", "total"]
'''
NUEVO_SER = '''        fields = ["id", "obra", "proyecto", "codigo", "descripcion", "unidad",
                  "metrado", "precio", "estructura", "grupo", "ruta", "activo",
                  "total"]
'''

for f in (F_MODELS, F_VISTA):
    if not os.path.isfile(f):
        print("No encuentro {0}.".format(f))
        print("¿Aplicaste antes parche_partidas_backend.py?")
        sys.exit(1)

txt_m = io.open(F_MODELS, encoding="utf-8").read()
txt_v = io.open(F_VISTA, encoding="utf-8").read()

print("Carpeta: {0}".format(BASE))
print("")
print("=" * 78)
print("La partida guarda su ruta completa")
print("=" * 78)
print("")

fallos = []
if '"Ruta en el presupuesto' in txt_m:
    fallos.append("models.py ya tiene el campo ruta: parece aplicado")
if txt_m.count(ANCLA_MODELO) != 1:
    fallos.append("models.py: el ancla aparece {0} veces (deberia ser 1)".format(
        txt_m.count(ANCLA_MODELO)))
if txt_v.count(ANCLA_SER) != 1:
    fallos.append("views_partidas.py: el ancla de fields aparece {0} veces (deberia ser 1)".format(
        txt_v.count(ANCLA_SER)))

if fallos:
    print("NO SE APLICA NADA:")
    for f in fallos:
        print("  - {0}".format(f))
    sys.exit(1)

print("  models.py")
print("    + ruta = models.TextField(...)   antes de 'activo'")
print("")
print("  views_partidas.py")
print("    - {0}".format(ANCLA_SER.strip().replace("\n", " ")[:88]))
print("    + ...con 'ruta' anadido a la lista de fields")
print("")

nuevo_m = txt_m.replace(ANCLA_MODELO, NUEVO_MODELO, 1)
nuevo_v = txt_v.replace(ANCLA_SER, NUEVO_SER, 1)

for nombre, texto in (("models.py", nuevo_m), ("views_partidas.py", nuevo_v)):
    try:
        compile(texto.encode("utf-8"), nombre, "exec")
    except SyntaxError as e:
        print("NO SE ESCRIBE NADA: {0} no compilaria ({1}, linea {2}).".format(
            nombre, e.msg, e.lineno))
        sys.exit(1)
print("Los dos archivos compilan.")
print("")

if not APLICAR:
    print("Listo para aplicar. NADA se ha escrito.")
    print("Para aplicarlo:  python3 {0} --aplicar".format(os.path.basename(sys.argv[0])))
    sys.exit(0)

sin = [r for r in (F_MODELS, F_VISTA) if not os.access(r, os.W_OK)]
if sin:
    print("NO SE ESCRIBE NADA. Sin permiso en: {0}".format(", ".join(sin)))
    sys.exit(1)

for r, t in ((F_MODELS, nuevo_m), (F_VISTA, nuevo_v)):
    destino = r + ".bak"
    if os.path.exists(destino):
        import time
        destino = r + ".bak." + time.strftime("%Y%m%d-%H%M%S")
    shutil.copy2(r, destino)
    print("Respaldo: {0}".format(destino))
    io.open(r, "w", encoding="utf-8").write(t)
    print("Escrito: {0}".format(r))

print("")
print("=" * 78)
print("  docker compose exec web python manage.py makemigrations operations")
print("  docker compose exec web python manage.py migrate")
print("  docker compose up -d --no-deps --force-recreate web")
print("")
print("Y recargar el catalogo, que ahora trae la ruta:")
print("  docker compose exec -T web python manage.py shell < cargar_partidas.py")
print("")
print("La recarga NO duplica ni cambia los ids: lo imputado sigue enganchado.")
print("=" * 78)
