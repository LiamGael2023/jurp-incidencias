# -*- coding: utf-8 -*-
"""
Endpoint del estado de ejecucion de obra: curva de ejecutado por semana.

    python3 parche_avance_obra.py                 # solo muestra
    python3 parche_avance_obra.py --aplicar        # aplica, con respaldo

Se ejecuta EN EL SERVIDOR (api_vigilantes). Requiere parche_partidas_backend
y parche_ruta_partida aplicados antes.

QUE DEVUELVE   GET /partidas/avance-obra/?obra=Obras10_6[&inicio=AAAA-MM-DD]

  costo_directo   suma de metrado x precio de las partidas activas
  ejecutado       suma de metrado ejecutado x precio
  avance          el porcentaje entre los dos
  semanas         acumulado semana a semana, para la curva
  estructuras     cada titulo de nivel 3 con su presupuesto, ejecutado y %

LO QUE NO DEVUELVE, Y POR QUE. No hay curva programada ni variacion. El
Excel que se cargo es el programado TOTAL de metrados -cuanto hay que hacer
de cada partida- pero no dice CUANDO. Sin un cronograma valorizado o, al
menos, una fecha de inicio y un plazo, cualquier curva gris seria un reparto
inventado aqui. Un tablero que dice "vas retrasado" apoyandose en un reparto
inventado es peor que uno que no lo dice.

Cuando exista el cronograma, se anade como una serie mas y la curva gris
aparece encima sin tocar nada de esto.

LAS SEMANAS SE CUENTAN DESDE EL PRIMER PARTE con partida imputada, salvo que
se pase ?inicio=. No es lo mismo que la semana 1 de obra: si la obra empezo
antes de que se registrara el primer parte, las semanas van corridas. Por
eso la respuesta dice de donde salio el arranque, para que la pantalla pueda
avisarlo en vez de dar por supuesto que coincide.

EL METRADO EN OTRA UNIDAD NO SUMA. Si una actividad midio en m3 y la partida
esta en m2, ese metrado no entra: valorizarlo al precio de la partida daria
un importe que no significa nada. Se devuelve aparte para que se vea.

NO TOCA NADA DE LO EXISTENTE: una vista nueva y una ruta mas.
"""

from __future__ import print_function, unicode_literals

import io
import os
import shutil
import sys

APLICAR = "--aplicar" in sys.argv
RUTA_ARG = [a for a in sys.argv[1:] if not a.startswith("-")]
BASE = os.path.abspath(RUTA_ARG[0]) if RUTA_ARG else os.getcwd()

F_VISTA = os.path.join(BASE, "operations", "views_partidas.py")
F_URLS = os.path.join(BASE, "operations", "urls.py")

VISTA = '''

# ─────────────────────────────────────────────────────────────────────────
#  Estado de ejecucion de obra
# ─────────────────────────────────────────────────────────────────────────

@api_view(["GET"])
@permission_classes([AllowAny])
def avance_obra(request):
    """Curva de ejecutado por semana, y avance por estructura.

    ?obra=Obras10_6        obligatorio en la practica; sin el van todas
    ?inicio=AAAA-MM-DD     arranque de la semana 1; por defecto, el primer
                           parte con partida imputada

    NO devuelve programado: el presupuesto dice cuanto hay que hacer, no
    cuando. Esa serie llegara cuando exista el cronograma.
    """
    import datetime
    import json as _json

    obra = request.query_params.get("obra") or ""
    qs = Partida.objects.filter(activo=True)
    if obra:
        qs = qs.filter(obra=obra)
    partidas = list(qs)
    if not partidas:
        return Response({"obra": obra, "hay_datos": False, "partidas": 0})

    precio = {}
    unidad = {}
    ruta = {}
    for p in partidas:
        precio[p.id] = float(p.precio or 0)
        unidad[p.id] = _normaliza_unidad(p.unidad)
        try:
            ruta[p.id] = _json.loads(p.ruta or "[]")
        except ValueError:
            ruta[p.id] = []

    costo_directo = sum(float(p.metrado or 0) * precio[p.id] for p in partidas)

    # Una consulta: fecha del parte, metrado, unidad y partida.
    filas = (DailyPartActivity.objects
             .filter(partida_id__in=list(precio.keys()))
             .values("partida_id", "metrado", "metrado_unidad", "parte__date"))

    movs = []          # (fecha, importe) de lo que SI cuenta
    descartado = 0.0   # metrado imputado con otra unidad
    sin_fecha = 0
    for f in filas:
        pid = f["partida_id"]
        if _normaliza_unidad(f["metrado_unidad"]) != unidad[pid]:
            descartado += float(f["metrado"] or 0)
            continue
        importe = float(f["metrado"] or 0) * precio[pid]
        fecha = f["parte__date"]
        if fecha is None:
            sin_fecha += 1
            continue
        movs.append((fecha, importe, pid))

    ejecutado = sum(m[1] for m in movs)

    # ── semanas ───────────────────────────────────────────────────────────
    semanas = []
    arranque_de = "sin datos"
    if movs:
        crudo = request.query_params.get("inicio") or ""
        inicio = None
        if crudo:
            try:
                inicio = datetime.datetime.strptime(crudo, "%Y-%m-%d").date()
                arranque_de = "fecha indicada"
            except ValueError:
                inicio = None
        if inicio is None:
            inicio = min(m[0] for m in movs)
            arranque_de = "primer parte registrado"
        # La semana empieza el lunes de la semana del arranque.
        inicio = inicio - datetime.timedelta(days=inicio.weekday())

        ultima = max(m[0] for m in movs)
        total_semanas = (ultima - inicio).days // 7 + 1
        por_semana = [0.0] * total_semanas
        for fecha, importe, _pid in movs:
            i = (fecha - inicio).days // 7
            if 0 <= i < total_semanas:
                por_semana[i] += importe
            elif i < 0:
                # Anterior al arranque indicado: se acumula en la primera, en
                # vez de perderse. Si se perdiera, la curva no llegaria nunca
                # al total y nadie sabria por que.
                por_semana[0] += importe

        acum = 0.0
        for i, v in enumerate(por_semana):
            acum += v
            d = inicio + datetime.timedelta(days=7 * i)
            semanas.append({
                "n": i + 1,
                "desde": d.isoformat(),
                "hasta": (d + datetime.timedelta(days=6)).isoformat(),
                "ejecutado": round(v, 2),
                "acumulado": round(acum, 2),
                "pct": round(acum / costo_directo * 100, 2) if costo_directo else 0,
            })

    # ── por estructura (nivel 3 del arbol) ────────────────────────────────
    ejec_por_partida = {}
    for _f, importe, pid in movs:
        ejec_por_partida[pid] = ejec_por_partida.get(pid, 0.0) + importe

    estructuras = []
    for p in partidas:
        r = ruta[p.id]
        nodo = r[2] if len(r) > 2 else (r[-1] if r else ["", "SIN ESTRUCTURA"])
        cod, desc = nodo[0], nodo[1]
        e = next((x for x in estructuras if x["codigo"] == cod), None)
        if e is None:
            e = {"codigo": cod, "descripcion": desc, "presupuesto": 0.0, "ejecutado": 0.0}
            estructuras.append(e)
        e["presupuesto"] += float(p.metrado or 0) * precio[p.id]
        e["ejecutado"] += ejec_por_partida.get(p.id, 0.0)
    for e in estructuras:
        e["presupuesto"] = round(e["presupuesto"], 2)
        e["ejecutado"] = round(e["ejecutado"], 2)
        e["pct"] = round(e["ejecutado"] / e["presupuesto"] * 100, 2) if e["presupuesto"] else 0
    estructuras.sort(key=lambda x: x["codigo"])

    return Response({
        "obra": obra,
        "proyecto": partidas[0].proyecto or "",
        "hay_datos": bool(movs),
        "partidas": len(partidas),
        "costo_directo": round(costo_directo, 2),
        "ejecutado": round(ejecutado, 2),
        "avance": round(ejecutado / costo_directo * 100, 2) if costo_directo else 0,
        "semanas": semanas,
        "semana_actual": len(semanas),
        "arranque": arranque_de,
        "estructuras": estructuras,
        # Lo que no se pudo contar, dicho en voz alta en vez de escondido.
        "metrado_otra_unidad": round(descartado, 4),
        "actividades_sin_fecha": sin_fecha,
        # No hay programado todavia. La pantalla lo usa para no dibujar una
        # curva gris vacia ni hablar de variacion.
        "programado": None,
    })
'''

ANCLA_IMP = "from .views_partidas import partidas_lista, partidas_obras\n"
NUEVO_IMP = "from .views_partidas import partidas_lista, partidas_obras, avance_obra\n"
ANCLA_RUTA = "    path('partidas/obras/', partidas_obras, name='partidas-obras'),\n"
NUEVA_RUTA = ("    path('partidas/obras/', partidas_obras, name='partidas-obras'),\n"
              "    # Estado de ejecucion de obra: curva de ejecutado por semana\n"
              "    path('partidas/avance-obra/', avance_obra, name='avance-obra'),\n")

for f in (F_VISTA, F_URLS):
    if not os.path.isfile(f):
        print("No encuentro {0}.".format(f))
        print("¿Aplicaste antes parche_partidas_backend.py?")
        sys.exit(1)

txt_v = io.open(F_VISTA, encoding="utf-8").read()
txt_u = io.open(F_URLS, encoding="utf-8").read()

print("Carpeta: {0}".format(BASE))
print("")
print("=" * 78)
print("Estado de ejecucion de obra")
print("=" * 78)
print("")

fallos = []
if "def avance_obra" in txt_v:
    fallos.append("views_partidas.py ya tiene avance_obra: parece aplicado")
if txt_u.count(ANCLA_IMP) != 1:
    fallos.append("urls.py: el ancla del import aparece {0} veces (deberia ser 1)".format(
        txt_u.count(ANCLA_IMP)))
if txt_u.count(ANCLA_RUTA) != 1:
    fallos.append("urls.py: el ancla de la ruta aparece {0} veces (deberia ser 1)".format(
        txt_u.count(ANCLA_RUTA)))
if 'ruta = models.TextField' not in io.open(
        os.path.join(BASE, "operations", "models.py"), encoding="utf-8").read():
    fallos.append("el modelo no tiene el campo 'ruta': aplica antes parche_ruta_partida.py")

if fallos:
    print("NO SE APLICA NADA:")
    for f in fallos:
        print("  - {0}".format(f))
    sys.exit(1)

print("  views_partidas.py")
print("    + avance_obra   GET /partidas/avance-obra/?obra=...&inicio=...")
print("        costo_directo, ejecutado, avance, semanas[], estructuras[]")
print("        programado: null  (no hay cronograma todavia)")
print("")
print("  urls.py")
print("    + path('partidas/avance-obra/', avance_obra)")
print("")

nuevo_v = txt_v.rstrip("\n") + "\n" + VISTA
nuevo_u = txt_u.replace(ANCLA_IMP, NUEVO_IMP, 1).replace(ANCLA_RUTA, NUEVA_RUTA, 1)

for nombre, texto in (("views_partidas.py", nuevo_v), ("urls.py", nuevo_u)):
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

sin = [r for r in (F_VISTA, F_URLS) if not os.access(r, os.W_OK)]
if sin:
    print("NO SE ESCRIBE NADA. Sin permiso en: {0}".format(", ".join(sin)))
    sys.exit(1)

for r, t in ((F_VISTA, nuevo_v), (F_URLS, nuevo_u)):
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
print("No hay migracion: no cambia ningun modelo. Solo recrear:")
print("")
print("  docker compose up -d --no-deps --force-recreate web")
print("=" * 78)
