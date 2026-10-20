# -*- coding: utf-8 -*-
"""Carga las metas 2026 por dren como presupuesto del proyecto JURP-JUV 2026.

    docker compose exec -T web python manage.py shell < cargar_drenes_juviru.py
    docker compose exec -e APLICAR=1 -T web python manage.py shell < cargar_drenes_juviru.py

SIN APLICAR=1 SOLO MIRA. Imprime lo que haria y no escribe nada.

EL -e NO ES ADORNO. Poner "APLICAR=1 docker compose exec ..." delante define
la variable para el docker de TU maquina, no dentro del contenedor, donde
corre esto. El script no la ve, se queda en modo mirar, y parece que no hizo
nada sin decir por que. Hay que pasarsela con -e.

DE DONDE SALE. Del cuadro de metas por dren del valle Viru: 19 drenes, cada
uno con dos medidas -longitud limpiada en metros y petroleo en galones-.

LO QUE SE CARGA ES EL PROGRAMADO, NO LO EJECUTADO. El cuadro trae las dos
columnas, pero lo ejecutado no es presupuesto: entra por los partes diarios,
que es lo que lo ata a una fecha, a una maquina y a quien lo hizo. Cargarlo
aqui daria un avance que nadie puede rastrear hasta un parte.

LAS COLUMNAS DE MESES SON EJECUCION, NO PROGRAMACION. Se comprueba sumando:
los totales mensuales dan 39,079 m, que es exactamente el total EJECUTADO, y
no los 42,080 m programados. Asi que tampoco son un cronograma que cargar.

LA TRANSCRIPCION ESTA COMPROBADA contra los totales del propio cuadro, que
es la unica verificacion posible cuando el dato viene de una imagen:

    longitud programada    42080.00 m
    petroleo programado    6240.67 gls

Si esas sumas no cuadran al correr esto, NO se escribe nada: significa que
algo se copio mal y cargarlo dejaria un presupuesto que no es el del cuadro.

LA ESTRUCTURA. Un titulo por dren y dos partidas debajo:

    01        DV Compositan I
    01.01     Limpieza y descolmatacion     m      3,000.00
    01.02     Petroleo                      gls      435.00

SIN PRECIO, a proposito. El cuadro es de metas fisicas y no trae costos. Las
partidas quedan a precio cero -el proyecto seguira diciendo S/ 0.00- y el
avance se medira en metros y galones, que es lo que el cuadro mide. Los
precios se pueden poner despues, partida por partida, desde la ventana del
presupuesto.

ES IDEMPOTENTE: update_or_create sobre (proyecto, codigo). Correrlo dos veces
no duplica nada y no cambia los ids, asi que lo que ya se haya imputado sigue
apuntando a su partida.
"""

from __future__ import print_function

import json
import os
from decimal import Decimal

from django.db import transaction

from operations.models import Partida, Proyecto

APLICAR = os.environ.get("APLICAR") == "1"

CODIGO_PROYECTO = "JURP-JUV 2026"

# (dren, longitud en m, petroleo en gls)
DRENES = [
    ("DV Compositan I", 3000.00, 435.00),
    ("DV Compositan II", 1450.00, 228.33),
    ("DV 3.1", 2500.00, 368.33),
    ("DV 3.0", 3740.00, 533.67),
    ("DV Huancaquito Alto", 3180.00, 459.00),
    ("DV 2.0", 5000.00, 701.67),
    ("DV 1.2", 3500.00, 501.67),
    ("DV 1.6", 1000.00, 168.33),
    ("DV Pino", 2000.00, 301.67),
    ("DV 1.5", 1340.00, 213.67),
    ("DV Chanquin", 5400.00, 755.00),
    ("DV Fronton Bajo", 4500.00, 635.00),
    ("DV 8.0", 570.00, 111.00),
    ("DV 4.1", 1200.00, 195.00),
    ("DV 4.2", 1000.00, 168.33),
    ("DV 4.3", 800.00, 141.67),
    ("DV Flautero", 1000.00, 168.33),
    ("DV Carbonera", 900.00, 155.00),
    ("DV 4.0", 0.00, 0.00),
]

ESPERADO_LONGITUD = Decimal("42080.00")
ESPERADO_PETROLEO = Decimal("6240.67")

MEDIDAS = [
    ("Limpieza y descolmatacion", "m"),
    ("Petroleo", "gls"),
]


def dec(x):
    return Decimal(str(x))


# ── 1. La transcripcion tiene que cuadrar ─────────────────────────────────
suma_l = sum((dec(l) for _, l, _ in DRENES), Decimal("0"))
suma_p = sum((dec(p) for _, _, p in DRENES), Decimal("0"))

print("")
print("=" * 72)
print("Metas 2026 por dren  ->  %s" % CODIGO_PROYECTO)
print("=" * 72)
print("  drenes             : %d" % len(DRENES))
print("  longitud programada: %s m    (el cuadro dice %s)" % (suma_l, ESPERADO_LONGITUD))
print("  petroleo programado: %s gls  (el cuadro dice %s)" % (suma_p, ESPERADO_PETROLEO))

if suma_l != ESPERADO_LONGITUD or suma_p != ESPERADO_PETROLEO:
    print("")
    print("NO SE ESCRIBE NADA: las sumas no cuadran con el cuadro.")
    print("Algo se copio mal; cargarlo dejaria un presupuesto que no es el suyo.")
    raise SystemExit(1)
print("  las dos sumas cuadran con el cuadro.")


# ── 2. El proyecto ────────────────────────────────────────────────────────
pro = Proyecto.objects.filter(codigo=CODIGO_PROYECTO).first()
if pro is None:
    # El codigo puede llevar otro espaciado; se busca por lo que no cambia.
    pro = Proyecto.objects.filter(codigo__icontains="JURP-JUV").first()
if pro is None:
    print("")
    print("NO SE ESCRIBE NADA: no encuentro el proyecto %r." % CODIGO_PROYECTO)
    print("Los que hay:")
    for p in Proyecto.objects.all()[:20]:
        print("    %r  %s" % (p.codigo, p.nombre[:60]))
    raise SystemExit(1)

print("")
print("  proyecto: [%s] %s" % (pro.codigo, pro.nombre[:60]))
print("  partidas que ya tiene: %d" % pro.partidas.count())


# ── 3. Lo que se va a escribir ────────────────────────────────────────────
plan = []
for i, (dren, longitud, petroleo) in enumerate(DRENES, start=1):
    cod_t = "%02d" % i
    plan.append(dict(codigo=cod_t, descripcion=dren, es_titulo=True,
                     unidad="", metrado=Decimal("0"), ruta=[]))
    for j, (desc, unidad) in enumerate(MEDIDAS, start=1):
        plan.append(dict(
            codigo="%s.%02d" % (cod_t, j),
            descripcion="%s - %s" % (desc, dren),
            es_titulo=False,
            unidad=unidad,
            metrado=dec(longitud if j == 1 else petroleo),
            ruta=[[cod_t, dren]]))

print("  se van a crear/actualizar: %d filas (%d titulos, %d partidas)" % (
    len(plan), len(DRENES), len(plan) - len(DRENES)))
print("")
for f in plan[:6]:
    print("    %-8s %-46s %-4s %10s" % (
        f["codigo"], f["descripcion"][:46], f["unidad"], f["metrado"]))
print("    ... y %d mas" % (len(plan) - 6))

if not APLICAR:
    print("")
    print("Nada tocado. Para aplicarlo:")
    print("    docker compose exec -e APLICAR=1 -T web \\")
    print("      python manage.py shell < cargar_drenes_juviru.py")
    print("")
    print("    El -e hace falta: 'APLICAR=1 docker compose ...' define la")
    print("    variable fuera del contenedor y aqui dentro no se ve.")
    raise SystemExit(0)


# ── 4. Escribir ───────────────────────────────────────────────────────────
nuevas = 0
actualizadas = 0
with transaction.atomic():
    for f in plan:
        _, creada = Partida.objects.update_or_create(
            proyecto_ref=pro, codigo=f["codigo"],
            defaults=dict(
                obra=pro.codigo,
                proyecto=pro.nombre[:300],
                descripcion=f["descripcion"][:300],
                unidad=f["unidad"][:12],
                metrado=f["metrado"],
                precio=Decimal("0"),
                es_titulo=f["es_titulo"],
                ruta=json.dumps(f["ruta"], ensure_ascii=False),
                activo=True,
            ))
        if creada:
            nuevas += 1
        else:
            actualizadas += 1

print("")
print("  creadas: %d   actualizadas: %d" % (nuevas, actualizadas))
print("  el proyecto queda con %d partidas imputables." %
      pro.partidas.filter(activo=True, es_titulo=False).count())
print("")
print("Listo. Abre Proyectos -> icono de lista en %s." % pro.codigo)
