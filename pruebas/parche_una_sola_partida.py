# -*- coding: utf-8 -*-
"""Crear una actividad con UNA sola partida fallaba.

    python3 parche_una_sola_partida.py              # solo muestra
    python3 parche_una_sola_partida.py --aplicar    # aplica, con respaldo
    docker compose up -d --no-deps --force-recreate web

NO HAY MIGRACION: cambia tres lineas de una vista.

EL FALLO. El alta hace esto nada mas entrar:

    datos = dict(request.data)
    for k, v in list(datos.items()):
        if isinstance(v, list) and len(v) == 1:
            datos[k] = v[0]

Eso esta ahi por los formularios: un QueryDict devuelve CADA campo como una
lista de un elemento, y sin aplanar, 'nombre' llegaria como ['Excavacion'].

Pero 'partidas' SI es una lista de verdad. Cuando la actividad trae una sola,
[7] se convierte en 7, y la comprobacion de mas abajo intenta recorrerlo:

    [int(x) for x in 7]   ->   TypeError

que se traga el except y sale por pantalla como "Las partidas tienen que
venir como ids.". El mensaje es correcto y no sirve de nada: el que lo lee
mandó ids.

CON DOS O MAS PARTIDAS NO PASA, que es lo que lo hacia dificil de ver. La
prueba las creaba siempre con dos.

EL ARREGLO. 'partidas' se queda fuera del aplanado. No se toca el resto: los
formularios siguen necesitandolo.

El PATCH no hace falta tocarlo: lee request.data directamente y nunca aplano
nada.
"""

from __future__ import print_function

import datetime
import io
import os
import shutil
import sys

BASE = "/root/proyectos/api_vigilantes"
F_VISTA = os.path.join(BASE, "operations", "views_actividades_obra.py")

APLICAR = "--aplicar" in sys.argv

ANCLA = """    datos = dict(request.data)
    for k, v in list(datos.items()):
        if isinstance(v, list) and len(v) == 1:
            datos[k] = v[0]
"""

NUEVO = '''    datos = dict(request.data)
    for k, v in list(datos.items()):
        # 'partidas' es una lista de verdad, no un campo de formulario que
        # llega envuelto. Aplanarla cuando trae UNA sola la convertia en un
        # numero suelto, y la comprobacion de abajo petaba con un TypeError
        # que salia por pantalla como "tienen que venir como ids" - correcto
        # y completamente inutil, porque el que lo leia habia mandado ids.
        # Con dos o mas no pasaba, que es lo que lo hacia dificil de ver.
        if k == "partidas":
            continue
        if isinstance(v, list) and len(v) == 1:
            datos[k] = v[0]
'''


def principal():
    if not os.path.isfile(F_VISTA):
        print("No encuentro {0}.".format(F_VISTA))
        sys.exit(1)

    txt = io.open(F_VISTA, encoding="utf-8").read()

    print("")
    print("=" * 78)
    print("Una actividad con UNA sola partida")
    print("=" * 78)
    print("")
    print("Carpeta: {0}".format(BASE))
    print("")

    if 'if k == "partidas":' in txt:
        print("Ya esta aplicado: 'partidas' ya queda fuera del aplanado.")
        print("")
        sys.exit(1)

    n = txt.count(ANCLA)
    if n != 1:
        print("NO se puede aplicar:")
        print("    el bloque que aplana request.data aparece {0} veces, "
              "esperaba 1".format(n))
        print("")
        sys.exit(1)

    print("views_actividades_obra.py")
    print("    el alta deja 'partidas' fuera del aplanado de request.data")
    print("")
    print("Sin esto, crear una actividad con UNA partida responde")
    print("'Las partidas tienen que venir como ids.' aunque se manden ids.")
    print("Con dos o mas ya funcionaba.")
    print("")

    if not APLICAR:
        print("Esto es solo la vista previa. Para aplicarlo:")
        print("    python3 {0} --aplicar".format(os.path.basename(__file__)))
        print("")
        return

    sello = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    resp = "{0}.bak_{1}".format(F_VISTA, sello)
    shutil.copy2(F_VISTA, resp)
    io.open(F_VISTA, "w", encoding="utf-8").write(txt.replace(ANCLA, NUEVO, 1))

    print("APLICADO")
    print("    {0}".format(os.path.basename(F_VISTA)))
    print("        respaldo: {0}".format(os.path.basename(resp)))
    print("")
    print("Recarga el servicio:")
    print("    cd {0}".format(BASE))
    print("    docker compose up -d --no-deps --force-recreate web")
    print("")


if __name__ == "__main__":
    principal()
