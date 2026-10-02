# -*- coding: utf-8 -*-
"""
Que el servidor calcule la lluvia de los ultimos 30 minutos, en vez de que
cada cliente la sume por su cuenta sobre una serie recortada.

    python3 parche_ventana_lluvia_api.py                 # solo muestra
    python3 parche_ventana_lluvia_api.py --aplicar        # aplica, con .bak
    python3 parche_ventana_lluvia_api.py /ruta/al/codigo

Se ejecuta EN EL SERVIDOR, sobre el codigo fuente (no dentro del contenedor).

POR QUE.

El endpoint filtered-data recorta la serie antes de mandarla:

    DEFAULT_MAX_POINTS = 1500
    if len(raw_points) > max_points:
        mode = "downsampled"
        step = int((len(raw_points) + max_points - 1) / max_points)
        points = raw_points[::step]

YUGOSLAVIA (899) reporta cada 6 segundos: 6.371 lecturas en lo que va del dia,
asi que step=5 y al cliente le llega UNA DE CADA CINCO. Un cliente que sume ese
array para saber cuanto llovio en la ultima media hora obtiene
aproximadamente la quinta parte de lo que de verdad cayo.

Hoy no cambia ninguna decision porque no esta lloviendo y cero recortado sigue
siendo cero. Pero en un aguacero esa estacion necesitaria cinco veces mas agua
que las demas para encender su alerta, y es justo la de resolucion mas fina.
Es un fallo que solo se nota el dia que importa.

QUE HACE.

Anade tres campos a la respuesta, calculados sobre raw_points ANTES del
recorte, que es el unico sitio donde la serie esta completa:

    rain_window_mm        lo caido en la ultima ventana
    rain_window_peak_mm   la mayor ventana de todo el rango
    rain_window_minutes   cuanto dura la ventana

La ventana se importa de tip_processing (RAIN_EVALUATION_INTERVAL_MINUTES),
la MISMA con la que el motor decide el color de la alerta. Si alguien la
ajusta, el mapa y el aviso se mueven juntos.

Es un cambio ADITIVO: no toca ningun campo existente, asi que nada de lo que
ya consume el endpoint se entera. Los clientes viejos siguen funcionando.

POR QUE EN EL SERVIDOR Y NO EN LA APP.

Subir max_points desde el cliente tapa el agujero hoy y lo reabre en silencio
el dia que una estacion pase del nuevo limite. Ademas son dos clientes, la web
y la app movil, y la regla tiene que vivir en un solo sitio: es la misma razon
por la que _derivar_intervalos esta en el servidor y no repetida en cada uno.

COMO SE PROTEGE DE SI MISMO:
  - Comprueba permisos de escritura ANTES de tocar el primer archivo.
  - Si el archivo aparece en dos carpetas, se detiene y las lista.
  - Cada arreglo entra entero o no entra.
"""

from __future__ import print_function, unicode_literals

import io
import os
import shutil
import sys

APLICAR = "--aplicar" in sys.argv
RUTA_ARG = [a for a in sys.argv[1:] if not a.startswith("-")]
BASE = os.path.abspath(RUTA_ARG[0]) if RUTA_ARG else os.getcwd()

CALCULO_ANTES = '''        mode = "raw"
        points = raw_points
        if len(raw_points) > max_points:
            mode = "downsampled"
            step = int((len(raw_points) + max_points - 1) / max_points)
            points = raw_points[::step]'''

CALCULO_DESPUES = '''        # ── Lluvia de la ULTIMA VENTANA, y pico del rango ──────────────
        #
        # Se calcula AQUI, sobre raw_points y ANTES del recorte de abajo,
        # porque este es el unico punto donde la serie esta completa.
        #
        # Importa: una estacion que reporta cada 6 segundos pasa de 6.000
        # lecturas al dia, muy por encima de DEFAULT_MAX_POINTS, asi que al
        # cliente le llega una de cada cinco. Un cliente que sume ese array
        # para saber cuanto cayo en la ultima media hora obtiene la quinta
        # parte de la lluvia real. No se nota mientras no llueve, y se nota
        # justo el dia que importa.
        #
        # La ventana es la MISMA con la que el motor decide el color de la
        # alerta; se importa de alli para que no puedan separarse.
        rain_window_mm = None
        rain_window_peak_mm = None
        rain_window_minutes = None

        if metric == "rainfall_mm" and raw_points:
            from datetime import timedelta
            try:
                from src.apps.davis.services.tip_processing import (
                    RAIN_EVALUATION_INTERVAL_MINUTES,
                )
                rain_window_minutes = int(RAIN_EVALUATION_INTERVAL_MINUTES)
            except Exception:
                rain_window_minutes = 30

            ancho = timedelta(minutes=rain_window_minutes)
            # Ordenado a proposito: el calculo de abajo depende de que la
            # serie venga en orden, y el queryset no lo garantiza.
            serie = sorted(raw_points, key=lambda p: p[0])

            # Ventana movil con los DOS extremos inclusive, igual que el
            # occurred_at__gte / occurred_at__lte del motor de alertas. No es
            # un detalle: con lecturas cada 15 minutos, dejar fuera el
            # extremo inferior descarta una de las tres de la ventana.
            pico = 0.0
            suma = 0.0
            desde_i = 0
            for j in range(len(serie)):
                suma += serie[j][1] or 0.0
                while serie[j][0] - serie[desde_i][0] > ancho:
                    suma -= serie[desde_i][1] or 0.0
                    desde_i += 1
                if suma > pico:
                    pico = suma

            ultimo_ts = serie[-1][0]
            rain_window_mm = round(
                sum(val or 0.0 for ts, val in serie
                    if ultimo_ts - ancho <= ts <= ultimo_ts), 2)
            rain_window_peak_mm = round(pico, 2)

        mode = "raw"
        points = raw_points
        if len(raw_points) > max_points:
            mode = "downsampled"
            step = int((len(raw_points) + max_points - 1) / max_points)
            points = raw_points[::step]'''

RESPUESTA_ANTES = '''                "mode": mode,
                "total_precipitation": total_precipitation,
                "rain_alerts": rain_alerts_count,'''

RESPUESTA_DESPUES = '''                "mode": mode,
                "total_precipitation": total_precipitation,
                # Lo caido en la ultima ventana y el pico del rango, en mm.
                # Van calculados sobre la serie COMPLETA: el cliente no puede
                # sacarlos del array 'data', que llega recortado cuando la
                # estacion reporta muy seguido.
                "rain_window_mm": rain_window_mm,
                "rain_window_peak_mm": rain_window_peak_mm,
                "rain_window_minutes": rain_window_minutes,
                "rain_alerts": rain_alerts_count,'''

CAMBIOS = [
    {
        "archivo": "views.py",
        "titulo": "La lluvia de la ultima ventana se calcula en el servidor",
        "porque": ("El array 'data' llega recortado (1 de cada 5 en la estacion que\n"
                   "            reporta cada 6 s). Sumarlo en el cliente da la quinta parte de\n"
                   "            la lluvia real. raw_points, antes del recorte, si esta completo."),
        "pares": [
            (CALCULO_ANTES, CALCULO_DESPUES),
            (RESPUESTA_ANTES, RESPUESTA_DESPUES),
        ],
    },
]

SALTAR = (".git", "node_modules", "__pycache__", ".venv", "site-packages")


def localizar(nombre):
    hallados = []
    for raiz, carpetas, archivos in os.walk(BASE):
        carpetas[:] = [c for c in carpetas if c not in SALTAR]
        if nombre in archivos and "davis" in raiz:
            hallados.append(os.path.join(raiz, nombre))
    return hallados


print("Buscando el codigo fuente bajo: {}".format(BASE))
print("")

rutas = {}
for c in CAMBIOS:
    if c["archivo"] in rutas:
        continue
    h = localizar(c["archivo"])
    rutas[c["archivo"]] = h
    if len(h) == 1:
        print("  {} -> {}".format(c["archivo"], h[0]))
    elif not h:
        print("  {} -> NO ENCONTRADO".format(c["archivo"]))
    else:
        print("  {} -> {} COPIAS:".format(c["archivo"], len(h)))
        for x in h:
            print("        {}".format(x))
print("")

faltan = [a for a, h in rutas.items() if not h]
if faltan:
    print("No encuentro {}. Pasa la carpeta del codigo como argumento.".format(
        ", ".join(sorted(faltan))))
    sys.exit(1)

dobles = [a for a, h in rutas.items() if len(h) > 1]
if dobles:
    print("Hay mas de una copia de {}. No elijo por ti.".format(", ".join(sorted(dobles))))
    print("Pasa la carpeta exacta como argumento.")
    sys.exit(1)

rutas = dict((a, h[0]) for a, h in rutas.items())

contenidos = {}
for a, r in rutas.items():
    with io.open(r, encoding="utf-8") as f:
        contenidos[a] = f.read()

aplicables = []
for c in CAMBIOS:
    txt = contenidos[c["archivo"]]
    print("=" * 76)
    print(c["titulo"])
    print("   Por que: {}".format(c["porque"]))
    print("   Archivo: {}".format(rutas[c["archivo"]]))

    malos = [(a, txt.count(a)) for a, _ in c["pares"] if txt.count(a) != 1]
    if malos:
        print("   >> NO SE APLICA.")
        for a, veces in malos:
            print("      El texto esperado aparece {} veces (deberia ser 1):".format(veces))
            print("        {}".format(a.split("\n")[0][:70]))
        print("")
        continue

    for antes, despues in c["pares"]:
        for l in antes.split("\n"):
            print("   - {}".format(l))
        for l in despues.split("\n"):
            print("   + {}".format(l))
        print("")
    aplicables.append(c)
print("=" * 76)
print("")

if not aplicables:
    print("Nada que aplicar.")
    sys.exit(0)

if not APLICAR:
    print("{} de {} arreglos listos. NADA se ha escrito.".format(len(aplicables), len(CAMBIOS)))
    print("Para aplicarlo:  python3 parche_ventana_lluvia_api.py --aplicar")
    sys.exit(0)

tocados = sorted(set(c["archivo"] for c in aplicables))


def puede_escribir(ruta):
    if os.access(ruta, os.W_OK):
        return True, ""
    if os.access(os.path.dirname(ruta), os.W_OK):
        return False, "el archivo es de solo lectura (la carpeta si es escribible)"
    return False, "sin permiso de escritura"


problemas = []
for a in tocados:
    ok, motivo = puede_escribir(rutas[a])
    if not ok:
        problemas.append((rutas[a], motivo))

if problemas:
    print("NO SE ESCRIBE NADA. Falta permiso de escritura en:")
    for ruta, motivo in problemas:
        print("  {}".format(ruta))
        print("      {}".format(motivo))
    print("")
    print("Vuelve a lanzarlo con permisos:")
    print("    sudo python3 {} --aplicar".format(os.path.basename(sys.argv[0])))
    sys.exit(1)

for a in tocados:
    shutil.copy2(rutas[a], rutas[a] + ".bak")
    print("Copia de seguridad: {}.bak".format(rutas[a]))

for c in aplicables:
    for antes, despues in c["pares"]:
        contenidos[c["archivo"]] = contenidos[c["archivo"]].replace(antes, despues, 1)

for a in tocados:
    with io.open(rutas[a], "w", encoding="utf-8") as f:
        f.write(contenidos[a])
    print("Escrito: {}".format(rutas[a]))

print("")
print("Hecho. Recrea los servicios:")
print("  docker compose up -d --no-deps --force-recreate jurp_web davis_worker beat")
print("")
print("NO uses docker restart en este servidor.")
print("")
print("Para comprobarlo, pidiendo el dia de hoy de la estacion que reporta")
print("cada 6 segundos (la que mas sufre el recorte):")
print("  curl -s -H 'Authorization: Token <TU_TOKEN>' \\")
print("    'http://localhost/api/v1/mobile/davis/rain-gauges/filtered-data/?start_date=AAAA-MM-DD&end_date=AAAA-MM-DD&station_id=899&metric=rainfall_mm' \\")
print("    | python3 -c \"import json,sys; d=json.load(sys.stdin); print({k:d[k] for k in ('mode','total_precipitation','rain_window_mm','rain_window_peak_mm','rain_window_minutes')})\"")
print("")
print("  'mode' dira downsampled y aun asi los rain_window_* seran correctos:")
print("  salen de la serie completa, no del array recortado.")
print("")
print("Para deshacer:")
for a in tocados:
    print("  mv {}.bak {}".format(rutas[a], rutas[a]))
