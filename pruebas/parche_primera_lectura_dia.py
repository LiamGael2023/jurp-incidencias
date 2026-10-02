# -*- coding: utf-8 -*-
"""
La primera lectura de cada dia es REFERENCIA, no lluvia.

    python3 parche_primera_lectura_dia.py                 # solo muestra
    python3 parche_primera_lectura_dia.py --aplicar        # aplica, con .bak
    python3 parche_primera_lectura_dia.py /ruta/al/codigo

Se ejecuta EN EL SERVIDOR, sobre el codigo fuente (no dentro del contenedor).

EL FALLO, con datos reales de Filtrado 29 (907) del 02/10/2026:

    00:00   rainfall_mm_per_day = 5.999
    00:15   0.000
    00:30   0.000      ... y asi todo el dia

La lectura de las 00:00:00 en punto es todavia el acumulado del dia ANTERIOR:
a las 00:15 el contador ya viene reiniciado. Pero su marca de tiempo es del
dia nuevo.

_derivar_intervalos arranca cada dia con previo = 0.0, asi que calcula
5.999 - 0 = 6.00 y atribuye toda la lluvia del 01/10 a un unico instante del
02/10. Resultado medido: la estacion aparece con 6.00 mm "de hoy" sin que
haya caido una gota.

POR QUE IMPORTA MAS QUE UN NUMERO FEO. Cuando se usa la serie derivada, el
total_precipitation de la respuesta sale de ella, asi que el mapa web ya pinta
esa estacion con 6.0 mm. Y con la ventana de 30 minutos que ahora publica la
API, 6 mm cruzan el umbral mas alto: una alerta roja por lluvia que no
existio ese dia. Un rojo falso cuesta mas que un rojo que falta, porque el
operario aprende a ignorarlos.

EL ARREGLO. Al cambiar de dia, la primera lectura se toma como referencia y
aporta 0. Se pierde, como mucho, lo caido entre medianoche y esa primera
lectura; normalmente nada, porque el contador ya viene reiniciado. A cambio
deja de poder inventarse un dia entero de lluvia.

NO toca el resto del comportamiento: las restas dentro del dia y el reinicio
a mitad de dia (valor que baja) siguen igual.

COMO SE PROTEGE DE SI MISMO:
  - Comprueba permisos de escritura ANTES de tocar el primer archivo.
  - Si el archivo aparece en dos carpetas, se detiene y las lista.
  - Si el texto esperado no aparece exactamente una vez, no escribe.
"""

from __future__ import print_function, unicode_literals

import io
import os
import shutil
import sys

APLICAR = "--aplicar" in sys.argv
RUTA_ARG = [a for a in sys.argv[1:] if not a.startswith("-")]
BASE = os.path.abspath(RUTA_ARG[0]) if RUTA_ARG else os.getcwd()

ANTES = '''            dia = timezone.localtime(ts).date() if timezone.is_aware(ts) else ts.date()
            if dia != dia_previo:
                previo = 0.0
                dia_previo = dia

            caido = valor - previo if valor >= previo else valor
            previo = valor
            salida.append((ts, round(caido, 2)))'''

DESPUES = '''            dia = timezone.localtime(ts).date() if timezone.is_aware(ts) else ts.date()
            if dia != dia_previo:
                # PRIMERA LECTURA DEL DIA: es REFERENCIA, no lluvia.
                #
                # Antes el dia arrancaba con previo = 0.0, asi que el
                # acumulado que trajera esa lectura se contaba entero como
                # caido en ese instante.
                #
                # Filtrado 29 (907) reporta a las 00:00:00 en punto, y esa
                # lectura es todavia el total del dia ANTERIOR: 5.999 mm
                # del 01/10 salian como 6.00 mm caidos de golpe el 02/10 a
                # medianoche. A las 00:15 el contador ya marcaba 0.
                #
                # Con los umbrales de alerta, 6 mm en una ventana de 30
                # minutos cruzan el nivel mas alto: era una alerta roja por
                # lluvia que no cayo ese dia.
                #
                # Se pierde, como mucho, lo caido entre medianoche y esta
                # primera lectura; normalmente nada, porque el contador ya
                # viene reiniciado. A cambio no se puede inventar un dia
                # entero de lluvia.
                dia_previo = dia
                previo = valor
                salida.append((ts, 0.0))
                continue

            caido = valor - previo if valor >= previo else valor
            previo = valor
            salida.append((ts, round(caido, 2)))'''

CAMBIOS = [
    {
        "archivo": "views.py",
        "titulo": "La primera lectura de cada dia no cuenta como lluvia",
        "porque": ("La lectura de las 00:00:00 trae el acumulado del dia anterior, y se\n"
                   "            contaba entera como caida ese instante: 6.00 mm inventados en\n"
                   "            Filtrado 29. Medido sobre datos reales del 02/10/2026."),
        "pares": [(ANTES, DESPUES)],
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
            print("      El texto esperado aparece {} veces (deberia ser 1).".format(veces))
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
    print("Para aplicarlo:  python3 parche_primera_lectura_dia.py --aplicar")
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
        print("  {}\n      {}".format(ruta, motivo))
    print("")
    print("Vuelve a lanzarlo con:  sudo python3 {} --aplicar".format(
        os.path.basename(sys.argv[0])))
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
print("Y vuelve a correr comprobar_ventana_api.py: Filtrado 29 debe pasar de")
print("6.00 a 0.00 y cuadrar con la base, como las otras 26.")
print("")
print("Para deshacer:")
for a in tocados:
    print("  mv {}.bak {}".format(rutas[a], rutas[a]))
