# -*- coding: utf-8 -*-
"""
Tres arreglos en las alertas de lluvia del backend de JURP.

    python3 parche_umbrales_lluvia.py                 # solo muestra qué cambiaría
    python3 parche_umbrales_lluvia.py --aplicar       # lo aplica, con copia .bak
    python3 parche_umbrales_lluvia.py /ruta/al/codigo # si no estás en la carpeta

Se ejecuta EN EL SERVIDOR, sobre el código fuente (no dentro del contenedor).
Busca los archivos él mismo bajo el directorio actual.

QUÉ ARREGLA, y por qué estos tres y no más:

  1. El valor por defecto de los umbrales trae DOS números y se reparte en
     TRES variables. Hoy no se nota porque la variable de entorno trae tres,
     pero sin ella es un ValueError EN EL IMPORT: el worker no arranca y las
     alertas se paran sin ruido.

  2. El color de la alerta se calcula sobre una ventana de tiempo y los
     milímetros del mensaje sobre OTRA, con dos variables de entorno
     distintas. Hoy las dos valen 30 y coinciden; el día que alguien ajuste
     una sola, el aviso llegará diciendo una cantidad que no corresponde a su
     color. Se unifican en la misma variable.

  3. Un comentario dice «2 horas» donde el código usa 180 minutos. Eso no
     rompe nada hoy, pero engaña a quien venga a tocarlo mañana.

LO QUE NO TOCA, a propósito: los nombres de los niveles en
hi_incidents/constants.py están corridos un nivel respecto del motor, pero
corregirlos cambia lo que la API publica en 'rain_alert_threshold_mm' y no sé
quién lo consume. Eso se decide mirando, no parcheando a ciegas.

CÓMO SE PROTEGE DE SÍ MISMO:
  - Si un archivo aparece en dos carpetas distintas (una copia, otro
    checkout), no elige: se detiene y las lista. Parchear la copia
    equivocada es peor que no parchear.
  - Cada arreglo puede tocar VARIAS líneas. O entran todas o no entra
    ninguna: el arreglo 2 añade un import y usa lo importado, y a medias
    dejaría el módulo roto.
  - Si el texto esperado no aparece exactamente una vez, ese arreglo se
    salta. Prefiere no hacer nada a dejar un archivo a medias.
"""

from __future__ import print_function, unicode_literals

import io
import os
import shutil
import sys

APLICAR = "--aplicar" in sys.argv
RUTA_ARG = [a for a in sys.argv[1:] if not a.startswith("-")]
BASE = os.path.abspath(RUTA_ARG[0]) if RUTA_ARG else os.getcwd()

CAMBIOS = [
    {
        "archivo": "tip_processing.py",
        "titulo": "1. El valor por defecto de los umbrales tiene que traer TRES números",
        "porque": ("Sin la variable de entorno, dos valores en tres variables es un\n"
                   "            ValueError en el import: el davis_worker no arranca y las\n"
                   "            alertas se paran sin ruido."),
        "pares": [(
            "ALERT_THRESHOLDS_MM = os.environ.get('RAIN_ALERT_THRESHOLD_MM', '0.63,1.06')",
            "ALERT_THRESHOLDS_MM = os.environ.get('RAIN_ALERT_THRESHOLD_MM', '0.21,0.63,1.06')",
        )],
    },
    {
        "archivo": "rain_alerts.py",
        "titulo": "2. Los milímetros del aviso y su color, sobre la MISMA ventana",
        "porque": ("El color sale de RAIN_EVALUATION_INTERVAL_MINUTES y los milímetros\n"
                   "            salían de RAIN_ALERT_INTERVAL_MINUTES. Si alguien ajusta una\n"
                   "            sola, el aviso dice una cantidad que no corresponde a su color."),
        "pares": [
            (
                "from src.apps.davis.services.tip_processing import process_rain_alert",
                "from src.apps.davis.services.tip_processing import (\n"
                "    RAIN_EVALUATION_INTERVAL_MINUTES,\n"
                "    process_rain_alert,\n"
                ")",
            ),
            (
                "RAIN_ALERT_INTERVAL_MINUTES = int(\n"
                "    os.environ.get('RAIN_ALERT_INTERVAL_MINUTES', '30'))",
                "# La MISMA ventana con la que tip_processing decide el color. Si fueran dos\n"
                "# variables distintas, el aviso podria decir una cantidad que no\n"
                "# corresponde al color que lleva.\n"
                "RAIN_ALERT_INTERVAL_MINUTES = RAIN_EVALUATION_INTERVAL_MINUTES",
            ),
        ],
    },
    {
        "archivo": "tip_processing.py",
        "titulo": "3. El comentario dice 2 horas y el código usa 3",
        "porque": "RAIN_START_INTERVAL_MINUTES son 180 minutos, no 120.",
        "pares": [(
            "    # Inicio de lluvia: no hubo tips en las 2 horas previas a este tip.",
            "    # Inicio de lluvia: no hubo tips en las 3 horas previas a este tip\n"
            "    # (RAIN_START_INTERVAL_MINUTES, 180 minutos por defecto).",
        )],
    },
]

SALTAR_CARPETAS = (".git", "node_modules", "__pycache__", ".venv", "site-packages")


def localizar(nombre):
    """Todas las rutas de ese archivo bajo BASE que estén dentro de 'davis'."""
    hallados = []
    for raiz, carpetas, archivos in os.walk(BASE):
        carpetas[:] = [c for c in carpetas if c not in SALTAR_CARPETAS]
        if nombre in archivos and "davis" in raiz:
            hallados.append(os.path.join(raiz, nombre))
    return hallados


print("Buscando el codigo fuente bajo: {}".format(BASE))
print("")

rutas = {}
for c in CAMBIOS:
    if c["archivo"] in rutas:
        continue
    hallados = localizar(c["archivo"])
    rutas[c["archivo"]] = hallados
    if len(hallados) == 1:
        print("  {} -> {}".format(c["archivo"], hallados[0]))
    elif not hallados:
        print("  {} -> NO ENCONTRADO".format(c["archivo"]))
    else:
        print("  {} -> {} COPIAS:".format(c["archivo"], len(hallados)))
        for h in hallados:
            print("        {}".format(h))
print("")

faltan = [a for a, h in rutas.items() if not h]
if faltan:
    print("No encuentro {}.".format(", ".join(sorted(faltan))))
    print("Ejecuta esto desde la carpeta del codigo fuente, o pasasela como argumento:")
    print("    python3 parche_umbrales_lluvia.py /ruta/al/codigo")
    sys.exit(1)

dobles = [a for a, h in rutas.items() if len(h) > 1]
if dobles:
    print("Hay mas de una copia de {}. No elijo por ti: si parcheo la que no es,".format(
        ", ".join(sorted(dobles))))
    print("el cambio no hara nada y pensaras que si lo hizo.")
    print("Pasa la carpeta exacta como argumento:")
    print("    python3 parche_umbrales_lluvia.py /ruta/exacta/al/codigo")
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

    # O entran todos los pares del arreglo, o no entra ninguno: el arreglo 2
    # anade un import y usa lo importado, y a medias dejaria el modulo roto.
    malos = [(a, txt.count(a)) for a, _ in c["pares"] if txt.count(a) != 1]
    if malos:
        print("   >> NO SE APLICA.")
        for a, veces in malos:
            print("      El texto esperado aparece {} veces (deberia ser 1):".format(veces))
            print("        {}".format(a.split("\n")[0]))
        print("      El archivo no es el que esperaba; mejor no tocarlo.")
        print("")
        continue

    for antes, despues in c["pares"]:
        for linea in antes.split("\n"):
            print("   - {}".format(linea))
        for linea in despues.split("\n"):
            print("   + {}".format(linea))
        print("")
    aplicables.append(c)
print("=" * 76)
print("")

if not aplicables:
    print("Nada que aplicar.")
    sys.exit(0)

if not APLICAR:
    print("{} de {} arreglos listos. NADA se ha escrito.".format(len(aplicables), len(CAMBIOS)))
    print("Para aplicarlos:  python3 parche_umbrales_lluvia.py --aplicar")
    sys.exit(0)

tocados = sorted(set(c["archivo"] for c in aplicables))

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
print("Hecho. Ahora hay que recrear los servicios para que lean el codigo nuevo:")
print("  docker compose up -d --no-deps --force-recreate jurp_web davis_worker beat")
print("")
print("NO uses docker restart en este servidor.")
print("Para deshacer:")
for a in tocados:
    print("  mv {}.bak {}".format(rutas[a], rutas[a]))
