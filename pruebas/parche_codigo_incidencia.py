# -*- coding: utf-8 -*-
"""
Anade la fecha de creacion de la incidencia al historial de partes.

    python3 parche_codigo_incidencia.py                 # solo muestra
    python3 parche_codigo_incidencia.py --aplicar        # aplica, con respaldo
    python3 parche_codigo_incidencia.py /ruta/al/codigo

Se ejecuta EN EL SERVIDOR (api_vigilantes), sobre el codigo fuente.

EL PROBLEMA. En el historial de partes de una maquina, la columna
"N° INCIDENCIA" sale con un 1, un 5, un 2. Eso no es el codigo de la
incidencia: es inc.code, que en el sistema se llama "Codigo de
Infraestructura" y es otro campo.

El codigo con el que se identifica una incidencia en todo el sistema es

    INCIDENTE-{id}-DDMMAAAA

donde la fecha es la de CREACION de la incidencia. La web ya lo arma asi en
la pantalla de Incidentes, a partir de created_at. Pero este endpoint solo
devuelve incidente_id, sin fecha, asi que la pantalla de Maquinaria no tiene
con que componerlo.

EL ARREGLO. Una clave mas, "incidente_creado", con created_at en crudo.

POR QUE EN CRUDO Y NO YA FORMATEADO. Para que las dos pantallas no puedan
dar codigos distintos del mismo incidente. La de Incidentes convierte
created_at en el navegador, con la hora local; si aqui lo formateara el
servidor con la suya, un incidente creado de madrugada saldria con una fecha
en una pantalla y otra en la otra. Mandando el dato crudo, las dos hacen la
misma cuenta.

NO cambia nada de lo que ya se devolvia: solo agrega una clave.

Compatible con Python 2.7 y 3.x.
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

SALTAR = (".git", "node_modules", "__pycache__", ".venv", "venv",
          "site-packages", "static", "media", "migrations")
NOMBRE = "views.py"


def localizar():
    hallados = []
    for raiz, carpetas, archivos in os.walk(BASE):
        carpetas[:] = [c for c in carpetas if c not in SALTAR]
        if NOMBRE in archivos and "operations" in raiz:
            hallados.append(os.path.join(raiz, NOMBRE))
    return hallados


print("Buscando operations/{0} bajo: {1}".format(NOMBRE, BASE))
rutas = localizar()
if not rutas:
    print("")
    print("No lo encuentro. Pasa la carpeta del codigo como argumento:")
    print("  python3 {0} /root/proyectos/api_vigilantes".format(os.path.basename(sys.argv[0])))
    sys.exit(1)
if len(rutas) > 1:
    print("")
    print("Hay {0} copias y no elijo por ti:".format(len(rutas)))
    for r in rutas:
        print("  {0}".format(r))
    sys.exit(1)

RUTA = rutas[0]
print("  -> {0}".format(RUTA))
print("")

with io.open(RUTA, encoding="utf-8") as f:
    texto = f.read()

# La clave se agrega DETRAS de incidente_codigo, que es la que ya existe en
# cada diccionario que describe un parte. Pueden ser varios endpoints: el
# historial de la maquina y el listado de partes comparten esa forma.
PATRON = re.compile(
    r'([ \t]*)"incidente_codigo":\s*inc\.code if inc else "",[ \t]*\n')

casos = PATRON.findall(texto)
print("=" * 78)
print("Anadir incidente_creado al historial de partes")
print("=" * 78)
print("")

if not casos:
    print('NO SE APLICA: no encuentro ninguna linea "incidente_codigo": inc.code ...')
    print("No se ha escrito nada. Pega este mensaje y lo ajusto.")
    sys.exit(1)

YA = texto.count('"incidente_creado"')
if YA:
    print("Ya hay {0} linea(s) con incidente_creado. Parece aplicado.".format(YA))
    print("No se ha escrito nada.")
    sys.exit(0)

print("Lo encuentro en {0} sitio(s):".format(len(casos)))
print("")


def cambia(m):
    sangria = m.group(1)
    return (m.group(0) +
            sangria + '"incidente_creado": inc.created_at.isoformat() '
                      'if inc and getattr(inc, "created_at", None) else "",\n')


nuevo = PATRON.sub(cambia, texto)

for i, m in enumerate(PATRON.finditer(texto), 1):
    linea = texto[:m.start()].count("\n") + 1
    print("  sitio {0}, linea {1}:".format(i, linea))
    print("      {0}".format(m.group(0).strip()))
    print("    + {0}".format(
        '"incidente_creado": inc.created_at.isoformat() '
        'if inc and getattr(inc, "created_at", None) else "",'))
    print("")

print("-" * 78)
print("getattr evita reventar si algun modelo de incidencia no tuviera")
print("created_at: en ese caso la clave va vacia y la web cae al numero solo.")
print("-" * 78)
print("")

# La sintaxis se comprueba ANTES de escribir: un views.py roto deja la API
# entera fuera de servicio, y eso no se arregla recargando.
try:
    compile(nuevo.encode("utf-8"), RUTA, "exec")
except SyntaxError as e:
    print("NO SE ESCRIBE NADA: el resultado no compila ({0}, linea {1}).".format(
        e.msg, e.lineno))
    sys.exit(1)
print("El archivo resultante compila.")
print("")

if not APLICAR:
    print("Listo para aplicar. NADA se ha escrito.")
    print("Para aplicarlo:  python3 {0} --aplicar".format(os.path.basename(sys.argv[0])))
    sys.exit(0)


def puede_escribir(ruta):
    if os.access(ruta, os.W_OK):
        return True, ""
    if os.access(os.path.dirname(ruta), os.W_OK):
        return False, "el archivo es de solo lectura (la carpeta si es escribible)"
    return False, "sin permiso de escritura"


ok, motivo = puede_escribir(RUTA)
if not ok:
    print("NO SE ESCRIBE NADA. Falta permiso en:")
    print("  {0}\n      {1}".format(RUTA, motivo))
    print("")
    print("Vuelve a lanzarlo con:  sudo python3 {0} --aplicar".format(
        os.path.basename(sys.argv[0])))
    sys.exit(1)

destino = RUTA + ".bak"
if os.path.exists(destino):
    import time
    destino = RUTA + ".bak." + time.strftime("%Y%m%d-%H%M%S")
    print("Ya habia un .bak de antes; no lo toco.")
shutil.copy2(RUTA, destino)
print("Copia de seguridad: {0}".format(destino))

with io.open(RUTA, "w", encoding="utf-8") as f:
    f.write(nuevo)
print("Escrito: {0}".format(RUTA))
print("")
print("Esto es codigo Python, no una plantilla: hay que recrear el contenedor.")
print("")
print("  docker compose up -d --no-deps --force-recreate web")
print("")
print("Para deshacer:")
print("  mv {0} {1}".format(destino, RUTA))
