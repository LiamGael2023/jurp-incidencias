# -*- coding: utf-8 -*-
"""
Separa HM INI . FIN en dos columnas en el PDF del parte diario.

    python3 parche_hm_dos_columnas.py                 # solo muestra
    python3 parche_hm_dos_columnas.py --aplicar        # aplica, con .bak
    python3 parche_hm_dos_columnas.py /ruta/al/codigo

Se ejecuta EN EL SERVIDOR (api_vigilantes), sobre el codigo fuente.

EL PROBLEMA. La tabla de actividades mete el horometro inicial y el final en
una sola celda separados por <br>, con la columna al 16%. En la hoja salen
apilados en dos renglones, y leer un tramo obliga a emparejar mentalmente la
cifra de arriba con la de abajo de cada fila.

EL ARREGLO. Dos columnas, HM INICIO y HM FIN, de 10% cada una. Los 4 puntos
porcentuales que faltan salen de ZONA (22->20), ACTIVIDAD (24->22) y METRADO
(12->11); H. MUERTAS sube de 9 a 10 para que la suma siga dando 100.

MEDIDO, no supuesto: renderizado con el mismo motor (xhtml2pdf) en A4
vertical, comparando cuatro repartos.

  ahora, 16% en una columna ... cabecera en una linea, VALORES APILADOS
  8% + 8%, "HM INICIO" ........ cabecera partida en dos renglones
  8% + 8%, "HM INI" ........... todo en una linea
  10% + 10%, "HM INICIO" ...... todo en una linea, y "H. MUERTAS" deja
                                 tambien de partirse

Se eligio el ultimo. Comprobado ademas con textos largos reales ("CANAL
LATERAL 10 - PROGRESIVA 04+250" / "CARGUIO Y ELIMINACION DE MATERIAL
EXCEDENTE"): se parten en las mismas dos lineas que antes, asi que estrechar
ZONA y ACTIVIDAD no cuesta nada.

SON CUATRO SITIOS, NO UNO:
  1. Las cabeceras (una <th> pasa a dos, y cambian los anchos).
  2. La fila de cada actividad.
  3. La fila de los partes antiguos, los que no tienen actividades.
  4. El colspan del pie: con 8 columnas, el "TOTAL HORAS EFECTIVAS" tiene que
     abarcar 5 y no 4, o las tres cifras del pie se corren una columna.

COMO SE PROTEGE DE SI MISMO:
  - Comprueba permiso de escritura ANTES de tocar nada.
  - Si algun anclaje no casa exactamente una vez, no escribe NADA.
  - Comprueba que los anchos sumen 100 despues del cambio.
  - Deja .bak.

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

PUNTO = "·"          # el · de "HM INI · FIN"
RAYA = "&mdash;"
SALTAR = (".git", "node_modules", "__pycache__", ".venv", "venv",
          "site-packages", "static", "media", "migrations")

# --------------------------------------------------------------- localizar
NOMBRE = "pdf_parte_diario.html"


def localizar():
    hallados = []
    for raiz, carpetas, archivos in os.walk(BASE):
        carpetas[:] = [c for c in carpetas if c not in SALTAR]
        if NOMBRE in archivos:
            hallados.append(os.path.join(raiz, NOMBRE))
    return hallados


print("Buscando {0} bajo: {1}".format(NOMBRE, BASE))
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
    original = f.read()

texto = original
lineas_antes = []
lineas_despues = []
fallos = []


def apunta(viejas, nuevas):
    lineas_antes.append(viejas)
    lineas_despues.append(nuevas)


# ------------------------------------------------------------------ 1. anchos
# Cada <th> se busca por su rotulo, no por su posicion ni su sangria: si
# alguien reordena las columnas o cambia el indentado, esto sigue casando.
ANCHOS = [
    ("ZONA DE TRABAJO",     22, 20),
    ("ACTIVIDAD REALIZADA", 24, 22),
    ("METRADO",             12, 11),
    ("H. MUERTAS",           9, 10),
]

for rotulo, viejo, nuevo in ANCHOS:
    patron = re.compile(
        r'(<th\s+style="width:\s*)' + str(viejo) + r'(%;">\s*' + re.escape(rotulo) + r'\s*</th>)')
    casos = patron.findall(texto)
    if len(casos) != 1:
        fallos.append('la cabecera "{0}" al {1}% aparece {2} veces (deberia ser 1)'.format(
            rotulo, viejo, len(casos)))
        continue
    viejo_txt = patron.search(texto).group(0)
    nuevo_txt = patron.sub(lambda m: m.group(1) + str(nuevo) + m.group(2), texto, count=1)
    nuevo_txt_linea = patron.search(texto).expand(r'\g<1>' + str(nuevo) + r'\g<2>')
    texto = nuevo_txt
    apunta([viejo_txt], [nuevo_txt_linea])

# ------------------------------------------- 2. la cabecera HM pasa a dos
patron_hm = re.compile(
    r'([ \t]*)<th\s+style="width:\s*16%;">\s*HM\s*' + re.escape(PUNTO) + r'?\s*INI\s*' +
    re.escape(PUNTO) + r'\s*FIN\s*</th>[ \t]*\n')
casos = patron_hm.findall(texto)
if len(casos) != 1:
    # Segundo intento, mas suelto: cualquier <th> que hable de HM y FIN.
    patron_hm = re.compile(r'([ \t]*)<th[^>]*>\s*HM[^<]*FIN\s*</th>[ \t]*\n')
    casos = patron_hm.findall(texto)

if len(casos) != 1:
    fallos.append("la cabecera de HM aparece {0} veces (deberia ser 1)".format(len(casos)))
else:
    m = patron_hm.search(texto)
    sangria = m.group(1)
    viejo_txt = m.group(0).rstrip("\n")
    nuevo_txt = (sangria + '<th style="width: 10%;">HM INICIO</th>\n' +
                 sangria + '<th style="width: 10%;">HM FIN</th>\n')
    texto = texto[:m.start()] + nuevo_txt + texto[m.end():]
    apunta([viejo_txt], nuevo_txt.rstrip("\n").split("\n"))

# ------------------------------------- 3. la celda de cada actividad
# Esa linea lleva plantilla Django con condicionales, asi que no la casamos
# por su texto exacto: la buscamos por ser la UNICA celda que menciona los
# dos horometros de la actividad, y la reescribimos entera.
patron_act = re.compile(
    r'([ \t]*)<td>(?=[^\n]*a\.start_horometer)(?=[^\n]*a\.end_horometer)[^\n]*</td>[ \t]*\n')
casos = patron_act.findall(texto)
if len(casos) != 1:
    fallos.append("la celda de horometro de la actividad aparece {0} veces (deberia ser 1)".format(
        len(casos)))
else:
    m = patron_act.search(texto)
    sangria = m.group(1)
    viejo_txt = m.group(0).rstrip("\n")
    nuevo_txt = (
        sangria + '<td>{% if a.start_horometer != None %}{{ a.start_horometer|floatformat:2 }}'
                  '{% else %}' + RAYA + '{% endif %}</td>\n' +
        sangria + '<td>{% if a.end_horometer != None %}{{ a.end_horometer|floatformat:2 }}'
                  '{% else %}' + RAYA + '{% endif %}</td>\n')
    texto = texto[:m.start()] + nuevo_txt + texto[m.end():]
    apunta([viejo_txt], nuevo_txt.rstrip("\n").split("\n"))

# ------------------------- 4. la celda de los partes antiguos (sin actividades)
patron_viejo = re.compile(
    r'([ \t]*)<td>\{\{\s*parte\.start_horometer\|floatformat:2\s*\}\}<br\s*/?>'
    r'\{\{\s*parte\.end_horometer\|floatformat:2\s*\}\}</td>[ \t]*\n')
casos = patron_viejo.findall(texto)
if len(casos) != 1:
    fallos.append("la celda de horometro del parte antiguo aparece {0} veces (deberia ser 1)".format(
        len(casos)))
else:
    m = patron_viejo.search(texto)
    sangria = m.group(1)
    viejo_txt = m.group(0).rstrip("\n")
    nuevo_txt = (sangria + '<td>{{ parte.start_horometer|floatformat:2 }}</td>\n' +
                 sangria + '<td>{{ parte.end_horometer|floatformat:2 }}</td>\n')
    texto = texto[:m.start()] + nuevo_txt + texto[m.end():]
    apunta([viejo_txt], nuevo_txt.rstrip("\n").split("\n"))

# ---------------------------------------------------- 5. el colspan del pie
patron_colspan = re.compile(r'(<td\s+colspan=")4("[^>]*>\s*TOTAL\s+HORAS)', re.I)
casos = patron_colspan.findall(texto)
if len(casos) != 1:
    fallos.append('el <td colspan="4"> del total aparece {0} veces (deberia ser 1)'.format(
        len(casos)))
else:
    m = patron_colspan.search(texto)
    viejo_txt = m.group(0)
    nuevo_txt = m.group(1) + "5" + m.group(2)
    texto = texto[:m.start()] + nuevo_txt + texto[m.end():]
    apunta([viejo_txt], [nuevo_txt])

# ------------------------------------------------------------------ informe
print("=" * 78)
print("Separar HM INI {0} FIN en dos columnas".format(PUNTO))
print("=" * 78)
print("")

if fallos:
    print("NO SE APLICA. Estos anclajes no casan:")
    for f in fallos:
        print("  - {0}".format(f))
    print("")
    print("No se ha escrito nada. Pega este mensaje y lo ajusto.")
    sys.exit(1)

for viejas, nuevas in zip(lineas_antes, lineas_despues):
    for l in viejas:
        print("  - {0}".format(l.strip()))
    for l in nuevas:
        print("  + {0}".format(l.strip()))
    print("")

# ------------------------------- comprobacion: los anchos tienen que dar 100
bloque = re.search(r'<table class="act-table">(.*?)</table>', texto, re.S)
if not bloque:
    print("No encuentro la tabla act-table para comprobar los anchos. NO se escribe.")
    sys.exit(1)

anchos = [int(x) for x in re.findall(r'<th\s+style="width:\s*(\d+)%;?"', bloque.group(1))]
print("-" * 78)
print("Anchos despues del cambio: {0} = {1}%  ({2} columnas)".format(
    " + ".join(str(a) for a in anchos), sum(anchos), len(anchos)))
if sum(anchos) != 100 or len(anchos) != 8:
    print("")
    print("ESO NO CUADRA: deberian ser 8 columnas sumando 100. NO se escribe nada.")
    sys.exit(1)
print("Correcto: 8 columnas al 100%.")
print("-" * 78)
print("")

if not APLICAR:
    print("Los 8 cambios estan listos. NADA se ha escrito.")
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

shutil.copy2(RUTA, RUTA + ".bak")
print("Copia de seguridad: {0}.bak".format(RUTA))

with io.open(RUTA, "w", encoding="utf-8") as f:
    f.write(texto)
print("Escrito: {0}".format(RUTA))
print("")
print("Es una plantilla: basta con recargar el servicio, no hace falta migrar.")
print("Abre cualquier parte con 'Ver PDF' y mira la tabla de actividades.")
print("")
print("Para deshacer:")
print("  mv {0}.bak {0}".format(RUTA))
