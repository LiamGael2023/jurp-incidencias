# -*- coding: utf-8 -*-
"""Que el cargador de drenes lleve los numeros del cuadro, y no otros.

    python3 -I pruebas/drenes.prueba.py

EL DATO VIENE DE UNA IMAGEN. No hay forma de comprobarlo contra su origen,
asi que la unica verificacion posible es la que el propio cuadro trae: sus
totales. Si la transcripcion suma lo que dice el pie, esta bien copiada; si
no, hay un numero mal y cargarlo dejaria un presupuesto que no es el suyo.

Se comprueban los DOS sitios -el JSON y el script generado- por separado, y
que digan lo mismo. Si solo se mirara uno, una edicion a mano en el otro
pasaria inadvertida.
"""
from __future__ import print_function

import ast
import io
import json
import os
import re
import sys

AQUI = os.path.dirname(os.path.abspath(__file__))
JSON = os.path.join(AQUI, "datos", "drenes_juviru_2026.json")
SCRIPT = os.path.join(AQUI, "cargar_drenes_juviru.py")

mal = [0]; bien = [0]


def t(etiqueta, ok, extra=""):
    if ok:
        bien[0] += 1
        return
    mal[0] += 1
    print("MAL  %s%s" % (etiqueta, ("   [%s]" % extra) if extra else ""))


d = json.load(io.open(JSON, encoding="utf-8"))
dr = d["drenes"]
c = d["comprobacion"]

suma = lambda k: round(sum(x[k] for x in dr), 2)

# ── 1. El JSON cuadra con el pie del cuadro ──────────────────────────────
for campo, clave in (("longitud", "longitud_programado"),
                     ("petroleo", "petroleo_programado"),
                     ("ej_longitud", "longitud_ejecutado"),
                     ("ej_petroleo", "petroleo_ejecutado")):
    t("el JSON cuadra en %s" % campo,
      abs(suma(campo) - c[clave]) < 0.005,
      "%.2f contra %.2f" % (suma(campo), c[clave]))

t("son 19 drenes", len(dr) == 19, str(len(dr)))
t("ninguno repetido", len({x["dren"] for x in dr}) == len(dr))
t("ningun nombre vacio", all(x["dren"].strip() for x in dr))
t("ningun metrado negativo",
  all(x[k] >= 0 for x in dr for k in ("longitud", "petroleo",
                                      "ej_longitud", "ej_petroleo")))

# ── 2. El script lleva los MISMOS numeros ────────────────────────────────
txt = io.open(SCRIPT, encoding="utf-8").read()
m = re.search(r"^DRENES = (\[.*?^\])", txt, re.S | re.M)
t("el script trae su tabla DRENES", m is not None)
if m:
    tabla = ast.literal_eval(m.group(1))
    t("con los 19", len(tabla) == len(dr), str(len(tabla)))
    iguales = all(
        a["dren"] == b[0] and abs(a["longitud"] - b[1]) < 0.005
        and abs(a["petroleo"] - b[2]) < 0.005
        for a, b in zip(dr, tabla))
    t("y los mismos numeros que el JSON", iguales)
    t("la suma de longitudes del script cuadra",
      abs(sum(b[1] for b in tabla) - c["longitud_programado"]) < 0.005)
    t("y la de petroleo",
      abs(sum(b[2] for b in tabla) - c["petroleo_programado"]) < 0.005)

# ── 3. Las reglas que no se pueden perder ────────────────────────────────
t("no escribe nada sin APLICAR=1",
  'APLICAR = os.environ.get("APLICAR") == "1"' in txt and "if not APLICAR:" in txt)
t("se niega si las sumas no cuadran",
  "NO SE ESCRIBE NADA: las sumas no cuadran" in txt)
t("y esa negativa corta de verdad",
  re.search(r"if suma_l != ESPERADO_LONGITUD or suma_p != ESPERADO_PETROLEO:"
            r"(?:.|\n)*?raise SystemExit\(1\)", txt) is not None)
t("es idempotente: update_or_create por (proyecto, codigo)",
  "update_or_create(\n            proyecto_ref=pro, codigo=" in txt)
t("NO carga lo ejecutado, que entra por los partes",
  "ej_longitud" not in txt and "ej_petroleo" not in txt)
t("los titulos van marcados", 'es_titulo=True' in txt)
t("y las partidas llevan su ruta al titulo", '"ruta": [[cod_t, dren]]' in txt
  or 'ruta=[[cod_t, dren]]' in txt or 'ruta=[["' in txt or '[[cod_t, dren]]' in txt)
t("el precio va a cero, que el cuadro no trae costos",
  'precio=Decimal("0")' in txt)

print("\n%d comprobacion(es) en orden%s." % (bien[0], ", %d MAL" % mal[0] if mal[0] else ""))
sys.exit(1 if mal[0] else 0)
