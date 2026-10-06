# -*- coding: utf-8 -*-
"""
Desbloquea las migraciones SIN cambiar la clave del JSON.

    python3 parche_campo_roto_v2.py                 # solo muestra
    python3 parche_campo_roto_v2.py --aplicar        # aplica, con respaldo
    python3 parche_campo_roto_v2.py /ruta/al/codigo

Se ejecuta EN EL SERVIDOR (api_vigilantes), sobre el codigo fuente.

POR QUE UNA SEGUNDA VERSION. La primera se nego, y con razon: encontro
'n__usuario' dentro de la lista de fields de inventario/serializers.py.
Renombrar a secas habria cambiado la CLAVE DEL JSON y la app de inventario
dejaria de ver ese dato, sin error ninguno, solo con el campo vacio.

EL ARREGLO, EN DOS PIEZAS:

  1. models.py: el atributo pasa a num_usuarios con db_column='n__usuario'.
     Es la convencion que YA usa ese mismo archivo en las lineas 232 y 257
     para esta misma columna en otras tablas; la del Canal Madre es la que
     se escribio sin ella.

  2. serializers.py: se declara un campo que conserva el nombre de fuera.

         n__usuario = serializers.IntegerField(source='num_usuarios', ...)

     La clave del JSON sigue siendo n__usuario, de entrada y de salida.
     Comprobado con DRF: lee 42 y al escribir 7 lo deja en num_usuarios.

     Un campo de serializer puede llamarse con doble guion bajo; la
     prohibicion es de los campos de MODELO, porque ahi "__" es el separador
     para recorrer relaciones.

QUE NO TOCA. Las carpetas inventario.bak_*, models_generados.py y los
scripts de parches anteriores tambien mencionan ese nombre, pero son copias
e historia: renombrar ahi no arregla nada y enturbia el cambio.
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

F_MODELS = os.path.join(BASE, "inventario", "models.py")
F_SER = os.path.join(BASE, "inventario", "serializers.py")

ANCLA_MODELO = "    n__usuario = models.IntegerField('N° de usuarios', blank=True, null=True)\n"

NUEVO_MODELO = """    # Se llama num_usuarios en Python y n__usuario en la base.
    #
    # El doble guion bajo viene del shapefile que cargo ogr2ogr. Django lo
    # prohibe en un nombre de campo (fields.E002) porque ahi "__" es el
    # separador para recorrer relaciones: con n__usuario no sabria si pides
    # este campo o el campo 'usuario' de una relacion llamada 'n'. Ese check
    # bloqueaba makemigrations y migrate de TODO el proyecto.
    #
    # num_usuarios + db_column es lo que ya hacen las lineas 232 y 257 de
    # este mismo archivo para esta misma columna en otras tablas.
    #
    # La CLAVE DEL JSON no cambia: el serializer declara n__usuario con
    # source='num_usuarios', para que la app de inventario siga viendo lo
    # mismo que veia.
    num_usuarios = models.IntegerField('N° de usuarios', blank=True, null=True,
                                       db_column='n__usuario')
"""

CAMPO_SER = """    # La clave del JSON sigue siendo n__usuario aunque el modelo llame al
    # campo num_usuarios: la app de inventario ya consume ese nombre y
    # cambiarlo la dejaria con el dato vacio, sin dar ningun error.
    n__usuario = serializers.IntegerField(source='num_usuarios',
                                          required=False, allow_null=True)
"""

for f in (F_MODELS, F_SER):
    if not os.path.isfile(f):
        print("No encuentro {0}.".format(f))
        print("Pasa la carpeta del codigo como argumento:")
        print("  python3 {0} /root/proyectos/api_vigilantes".format(os.path.basename(sys.argv[0])))
        sys.exit(1)

print("Carpeta: {0}".format(BASE))
print("")
print("=" * 78)
print("Desbloquear migraciones conservando la clave del JSON")
print("=" * 78)
print("")

txt_models = io.open(F_MODELS, encoding="utf-8").read()
txt_ser = io.open(F_SER, encoding="utf-8").read()

fallos = []
if txt_models.count(ANCLA_MODELO) != 1:
    fallos.append("models.py: el campo roto aparece {0} veces tal como lo espero (deberia ser 1)".format(
        txt_models.count(ANCLA_MODELO)))
if "source='num_usuarios'" in txt_ser or 'source="num_usuarios"' in txt_ser:
    fallos.append("serializers.py ya declara el campo: parece aplicado")

# ── localizar la clase del serializer que menciona el campo ──────────────
lineas_ser = txt_ser.split("\n")
idx = [i for i, l in enumerate(lineas_ser) if "'n__usuario'" in l or '"n__usuario"' in l]
if len(idx) != 1:
    fallos.append("serializers.py: 'n__usuario' aparece en {0} lineas (esperaba 1)".format(len(idx)))

clase_i = None
if len(idx) == 1:
    for i in range(idx[0], -1, -1):
        if re.match(r"^class\s+\w+\s*\(", lineas_ser[i]):
            clase_i = i
            break
    if clase_i is None:
        fallos.append("serializers.py: no encuentro la clase que contiene ese campo")

if fallos:
    print("NO SE APLICA NADA:")
    for f in fallos:
        print("  - {0}".format(f))
    sys.exit(1)

nombre_clase = re.match(r"^class\s+(\w+)", lineas_ser[clase_i]).group(1)

# El punto de insercion va DESPUES del docstring, si lo hay: colarse entre
# el 'class' y su docstring convertiria el docstring en una cadena suelta.
ins = clase_i + 1
resto = "\n".join(lineas_ser[ins:ins + 3]).lstrip()
if resto.startswith(('"""', "'''")):
    comilla = resto[:3]
    j = ins
    # docstring de una sola linea
    if lineas_ser[j].strip().count(comilla) >= 2 and len(lineas_ser[j].strip()) > 6:
        ins = j + 1
    else:
        j += 1
        while j < len(lineas_ser) and comilla not in lineas_ser[j]:
            j += 1
        ins = j + 1

print("Serializer afectado: {0}  (linea {1})".format(nombre_clase, clase_i + 1))
print("")
print("  Asi esta ahora:")
for i in range(clase_i, min(clase_i + 12, len(lineas_ser))):
    marca = ">>" if "n__usuario" in lineas_ser[i] else "  "
    print("  {0} {1:4d}  {2}".format(marca, i + 1, lineas_ser[i].rstrip()[:104]))
print("")
print("  Se insertara en la linea {0}:".format(ins + 1))
for l in CAMPO_SER.rstrip("\n").split("\n"):
    print("    + {0}".format(l))
print("")
print("  La lista de fields NO se toca: sigue diciendo 'n__usuario', que ahora")
print("  es el campo declarado arriba.")
print("")
print("-" * 78)
print("  models.py")
print("  - {0}".format(ANCLA_MODELO.strip()))
for l in NUEVO_MODELO.rstrip("\n").split("\n"):
    print("  + {0}".format(l[4:] if l.startswith("    ") else l))
print("-" * 78)
print("")

nuevo_models = txt_models.replace(ANCLA_MODELO, NUEVO_MODELO, 1)
nuevo_ser = "\n".join(lineas_ser[:ins] + CAMPO_SER.rstrip("\n").split("\n") + lineas_ser[ins:])

for nombre, texto in (("inventario/models.py", nuevo_models),
                      ("inventario/serializers.py", nuevo_ser)):
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

sin_permiso = [r for r in (F_MODELS, F_SER) if not os.access(r, os.W_OK)]
if sin_permiso:
    print("NO SE ESCRIBE NADA. Sin permiso de escritura en:")
    for r in sin_permiso:
        print("  {0}".format(r))
    sys.exit(1)

respaldos = []
for r in (F_MODELS, F_SER):
    destino = r + ".bak"
    if os.path.exists(destino):
        import time
        destino = r + ".bak." + time.strftime("%Y%m%d-%H%M%S")
    shutil.copy2(r, destino)
    respaldos.append((destino, r))
    print("Respaldo: {0}".format(destino))

io.open(F_MODELS, "w", encoding="utf-8").write(nuevo_models)
print("Escrito: {0}".format(F_MODELS))
io.open(F_SER, "w", encoding="utf-8").write(nuevo_ser)
print("Escrito: {0}".format(F_SER))

print("")
print("=" * 78)
print("Ahora si:")
print("")
print("  docker compose exec web python manage.py makemigrations")
print("  docker compose exec web python manage.py migrate")
print("  docker compose up -d --no-deps --force-recreate web")
print("")
print("La migracion de inventario no ejecuta SQL sobre tomas_canal_madre: el")
print("modelo es managed=False y la columna conserva su nombre. 95 filas intactas.")
print("=" * 78)
print("")
print("Para deshacer:")
for destino, original in respaldos:
    print("  mv {0} {1}".format(destino, original))
