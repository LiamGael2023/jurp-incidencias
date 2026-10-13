# -*- coding: utf-8 -*-
"""¿Qué horas trae ya el historial de una máquina, y cuáles habría que añadir?

    cd /root/proyectos/api_vigilantes
    curl -sO https://raw.githubusercontent.com/LiamGael2023/jurp-incidencias/main/pruebas/ver_horas_historial.py
    docker compose exec web python manage.py shell < ver_horas_historial.py

NO TOCA NADA. Solo mira y cuenta.

PARA QUÉ. La columna HORAS de la ficha de maquinaria enseña un solo número y
hay que poder ver cómo se llegó a él. En el parte diario esa descomposición
ya existe -el PDF del parte imprime HM INICIO, HM FIN, H. MUERTAS y TOTAL
HORAS EFECTIVAS-, pero el endpoint del historial puede estar mandando solo
el total. Esto dice cuál de las dos cosas pasa, que es lo que decide si hace
falta parche de backend o basta con la web.

Y de paso dice si los datos GUARDADOS tienen esa descomposición de verdad:
si en todos los partes las horas efectivas coinciden con el tramo del
horómetro, no hay nada que descomponer y tres columnas serían tres veces el
mismo número.
"""
from __future__ import print_function

from django.apps import apps

M = apps.get_model("operations", "DailyPartHeavyEquipment")
A = apps.get_model("operations", "DailyPartActivity")

print("")
print("=" * 72)
print("1. QUE CAMPOS DE HORAS TIENE EL PARTE")
print("=" * 72)
campos = {f.name for f in M._meta.get_fields() if hasattr(f, "attname")}
for c in ("start_horometer", "end_horometer", "horas_efectivas", "obs_reduccion"):
    print("    %-18s %s" % (c, "si" if c in campos else "NO EXISTE"))

print("")
print("=" * 72)
print("2. QUE MANDA EL ENDPOINT DEL HISTORIAL")
print("=" * 72)
print("    (lo que la ficha de maquinaria recibe hoy por parte)")
import importlib
vista = None
for ruta in ("operations.views", "operations.views_maquinaria", "operations.views_partes"):
    try:
        mod = importlib.import_module(ruta)
    except ImportError:
        continue
    for nombre in dir(mod):
        if "partes" in nombre.lower() and "modelo" in nombre.lower():
            vista = "%s.%s" % (ruta, nombre)
print("    vista: %s" % (vista or "no la encuentro; busca a mano:"))
if not vista:
    print("        grep -rn 'def .*partes' operations/*.py")

print("")
print("    Busca en esa funcion la lista de campos que arma cada parte y")
print("    mira si incluye start_horometer / end_horometer / horas_efectivas.")

print("")
print("=" * 72)
print("3. ¿HAY ALGO QUE DESCOMPONER? (los datos reales)")
print("=" * 72)
total = M.objects.count()
con_hm = M.objects.exclude(start_horometer=None).exclude(end_horometer=None).count()
con_he = M.objects.exclude(horas_efectivas=None).count()
print("    partes en total ............ %s" % total)
print("    con horometro ini y fin .... %s" % con_hm)
print("    con horas_efectivas ........ %s" % con_he)

distintos = 0
iguales = 0
muertas_total = 0.0
ejemplos = []
for p in M.objects.exclude(horas_efectivas=None)[:5000]:
    try:
        tramo = max(0.0, float(p.end_horometer or 0) - float(p.start_horometer or 0))
        he = float(p.horas_efectivas or 0)
    except (TypeError, ValueError):
        continue
    if abs(tramo - he) < 0.001:
        iguales += 1
    else:
        distintos += 1
        muertas_total += (tramo - he)
        if len(ejemplos) < 6:
            ejemplos.append((p.part_number, tramo, he, tramo - he,
                             (getattr(p, "obs_reduccion", "") or "")[:40]))

print("")
print("    efectivas = tramo del horometro .... %s partes" % iguales)
print("    efectivas < tramo (hay muertas) .... %s partes" % distintos)
print("    horas muertas acumuladas ........... %.2f" % muertas_total)
if ejemplos:
    print("")
    print("    %-22s %8s %8s %8s  %s" % ("PARTE", "TRAMO", "EFECT.", "MUERTAS", "MOTIVO"))
    for n, t, h, m, o in ejemplos:
        print("    %-22s %8.2f %8.2f %8.2f  %s" % (n, t, h, m, o))
else:
    print("")
    print("    NINGUN parte tiene horas muertas: efectivas y tramo coinciden")
    print("    siempre. Con estos datos, separar la columna en tres daria tres")
    print("    veces el mismo numero.")

print("")
print("=" * 72)
print("4. LO MISMO, POR ACTIVIDAD")
print("=" * 72)
print("    (la descomposicion de verdad vive aqui: un parte puede tener")
print("     varias actividades y solo una con horas muertas)")
act = A.objects.count()
act_he = A.objects.exclude(horas_efectivas=None).count()
print("    actividades en total ....... %s" % act)
print("    con horas_efectivas ........ %s" % act_he)
con_obs = A.objects.exclude(obs_reduccion=None).exclude(obs_reduccion="").count()
print("    con motivo de reduccion .... %s" % con_obs)
print("")
