# -*- coding: utf-8 -*-
"""
Carga el presupuesto de una obra en la tabla de partidas.

    docker compose exec -T web python manage.py shell < cargar_partidas.py

o, si prefieres pasarle otro archivo:

    PARTIDAS_JSON=/ruta/otro.json docker compose exec -T web python manage.py shell < cargar_partidas.py

EL ARCHIVO. Un JSON con esta forma, que es la que produce el extractor del
Excel de presupuesto:

    {"obra": "Obras10_6",
     "proyecto": "CONSTRUCCION Y MEJORAMIENTO ...",
     "partidas": [{"codigo": "01.02.04.01.01",
                   "descripcion": "Excavación de material suelto ...",
                   "unidad": "m³", "metrado": 173.54, "precio": 6.72,
                   "estructura": "CAJA DE DERIVACION",
                   "grupo": "MOVIMIENTO DE TIERRAS"}, ...]}

Si no se le pasa ruta, lo descarga del repo.

ES IDEMPOTENTE, Y ESO IMPORTA MAS DE LO QUE PARECE. Usa update_or_create
sobre (obra, codigo), asi que correrlo dos veces no duplica NI CAMBIA LOS
IDS. Si los ids cambiaran, las actividades ya imputadas quedarian apuntando
a partidas equivocadas: el avance seguiria saliendo, solo que mal, que es la
peor forma de fallar.

QUE HACE CON LAS QUE YA NO ESTAN. No las borra. Las marca activo=False, para
que dejen de ofrecerse en el selector pero los partes que ya las usaron
sigan teniendo a donde apuntar. Borrarlas pondria a NULL la partida de esas
actividades y se perderia el enganche del avance.

Al final imprime un resumen y, si algo no cuadra, lo dice en vez de callarse.
"""

from __future__ import print_function, unicode_literals

import json
import os
import sys

URL_POR_DEFECTO = ("https://raw.githubusercontent.com/LiamGael2023/jurp-incidencias/"
                   "main/pruebas/datos/partidas_obras10_6.json")

from operations.models import Partida  # noqa: E402

ruta = os.environ.get("PARTIDAS_JSON", "").strip()

if ruta:
    print("Leyendo {0}".format(ruta))
    with open(ruta, "rb") as f:
        datos = json.loads(f.read().decode("utf-8"))
else:
    print("Descargando el catalogo del repo…")
    try:
        from urllib.request import urlopen
    except ImportError:
        from urllib2 import urlopen
    try:
        datos = json.loads(urlopen(URL_POR_DEFECTO, timeout=30).read().decode("utf-8"))
    except Exception as e:
        print("")
        print("No pude descargarlo: {0}".format(e))
        print("Bajalo a mano y vuelve a lanzarlo con PARTIDAS_JSON=/ruta/al.json")
        sys.exit(1)

obra = (datos.get("obra") or "").strip()
proyecto = (datos.get("proyecto") or "").strip()
filas = datos.get("partidas") or []

if not obra or not filas:
    print("El archivo no trae obra o no trae partidas. No se toca nada.")
    sys.exit(1)

print("")
print("Obra     : {0}".format(obra))
print("Proyecto : {0}".format(proyecto[:70]))
print("Partidas : {0}".format(len(filas)))
print("")

# Un codigo repetido dentro del mismo archivo es un error de origen: la
# segunda fila pisaria a la primera y nadie se enteraria.
vistos = {}
duplicados = []
for f in filas:
    c = (f.get("codigo") or "").strip()
    if c in vistos:
        duplicados.append(c)
    vistos[c] = True
if duplicados:
    print("El archivo trae codigos repetidos: {0}".format(", ".join(sorted(set(duplicados)))))
    print("No se carga nada: arregla el origen primero.")
    sys.exit(1)

sin_unidad = [f.get("codigo") for f in filas if not (f.get("unidad") or "").strip()]
if sin_unidad:
    print("Hay partidas sin unidad: {0}".format(", ".join(str(c) for c in sin_unidad[:8])))
    print("Sin unidad no se puede medir el avance. No se carga nada.")
    sys.exit(1)

nuevas = 0
actualizadas = 0
codigos = set()

for f in filas:
    cod = (f.get("codigo") or "").strip()
    codigos.add(cod)
    _, creada = Partida.objects.update_or_create(
        obra=obra, codigo=cod,
        defaults=dict(
            proyecto=proyecto,
            descripcion=(f.get("descripcion") or "").strip()[:300],
            unidad=(f.get("unidad") or "").strip()[:12],
            metrado=f.get("metrado") or 0,
            precio=f.get("precio") or 0,
            estructura=(f.get("estructura") or "").strip()[:200],
            grupo=(f.get("grupo") or "").strip()[:200],
            activo=True,
        ))
    if creada:
        nuevas += 1
    else:
        actualizadas += 1

# Las que ya no vienen en el archivo se desactivan, no se borran.
sobrantes = Partida.objects.filter(obra=obra).exclude(codigo__in=codigos)
desactivadas = sobrantes.filter(activo=True).count()
sobrantes.update(activo=False)

print("  nuevas       : {0}".format(nuevas))
print("  actualizadas : {0}".format(actualizadas))
print("  desactivadas : {0}  (ya no estan en el archivo; NO se borran)".format(desactivadas))
print("")

total = Partida.objects.filter(obra=obra, activo=True).count()
suma = sum(float(p.metrado or 0) * float(p.precio or 0)
           for p in Partida.objects.filter(obra=obra, activo=True))
print("  en la BD, activas : {0}".format(total))
print("  costo directo     : S/ {0:,.2f}".format(suma))
print("")
print("Comprueba que ese costo directo cuadre con el del Excel. Si no cuadra,")
print("falta alguna partida o se leyo una columna que no era.")
print("")
print("Y verifica el endpoint:")
print("  curl -s 'http://localhost:8000/api/v1/mobile/operations/partidas/?obra={0}' | head -c 400".format(obra))
