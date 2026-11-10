# -*- coding: utf-8 -*-
"""El historial de una máquina cobra el horómetro, no las horas efectivas.

    cd /var/www/envs/vigilantes
    curl -sO https://raw.githubusercontent.com/LiamGael2023/jurp-incidencias/main/pruebas/parche_horas_efectivas_historial.py
    python3 parche_horas_efectivas_historial.py --dry-run
    python3 parche_horas_efectivas_historial.py
    docker compose restart web

QUÉ ARREGLA
-----------
`partes_de_maquina` -el endpoint /modelos/<id>/partes/ que alimenta la ficha
de maquinaria- calculaba las horas restando el horómetro:

    horas = max(0, hm_fin - hm_ini)
    "horas": round(horas, 1),
    "costo": round(horas * precio, 2),

Eso es el TRAMO: lo que la máquina estuvo encendida. Lo que se cobra son las
horas EFECTIVAS, que es el tramo menos las muertas -esperas, averías,
lluvia- y que el parte ya guarda en `horas_efectivas`.

En PD-0193-20260921 el tramo son 9,00 h y las efectivas 5,00. El PDF y el
costeo decían 5,00 h y S/ 2.714,00; la ficha de maquinaria decía 9,00 h y
S/ 4.885,20 por el mismo parte y el mismo día. Y como la web deduce las
muertas restando -tramo menos efectivas-, al mandar las dos iguales salían
0,00 horas muertas en TODAS las filas, incluidas las que sí las tenían.

El dato estaba bien guardado; lo que fallaba era quién lo leía.

QUÉ MANDA AHORA
---------------
Además de corregir `horas` y `costo`, el endpoint manda la descomposición
entera para que la ficha no tenga que deducir nada:

    horas_programadas   el tramo del horómetro
    horas_muertas       lo descontado
    horas_efectivas     lo que se cobra
    obs_reduccion       por qué se descontó

Deducir restando funcionaba solo mientras las tres cifras fueran
coherentes, que es precisamente lo que aquí no pasaba.

SOBRE LOS PARTES ANTIGUOS. Los que no tienen `horas_efectivas` siguen
cobrando el tramo, como hasta hoy: ahí no hay nada mejor que saber, y
ponerles cero los dejaría a S/ 0,00.
"""
from __future__ import print_function

import argparse
import os
import re
import shutil
import sys

VISTAS = "/var/www/envs/vigilantes/operations/views.py"

FUNCION = "def partes_de_maquina("

VIEJO_CALCULO = "        horas = max(0, hm_fin - hm_ini)\n"

NUEVO_CALCULO = '''        # El tramo del horómetro es lo que la máquina estuvo encendida; lo
        # que se cobra son las horas efectivas, que descuentan las muertas.
        # Sin esto el endpoint cobraba el tramo y, de paso, la ficha de
        # maquinaria deducía 0,00 horas muertas en todas las filas.
        tramo = max(0, hm_fin - hm_ini)
        _he = getattr(p, "horas_efectivas", None)
        # Los partes antiguos no tienen el campo: ahí el tramo es lo mejor
        # que se sabe, y ponerles cero los dejaría a S/ 0,00.
        efectivas = float(_he) if _he not in (None, "") else tramo
        horas = efectivas
'''

VIEJO_HORAS = '            "horas": round(horas, 1),\n'

NUEVO_HORAS = '''            "horas": round(efectivas, 2),
            # La descomposición entera, para que la ficha no tenga que
            # deducirla restando: eso solo funcionaba mientras las tres
            # cifras fueran coherentes, que es lo que aquí fallaba.
            "horas_programadas": round(tramo, 2),
            "horas_efectivas": round(efectivas, 2),
            "horas_muertas": round(max(0, tramo - efectivas), 2),
            "obs_reduccion": getattr(p, "obs_reduccion", "") or "",
'''

VIEJO_COSTO = '            "costo": round(horas * precio, 2),\n'

NUEVO_COSTO = '            "costo": round(efectivas * precio, 2),\n'

CAMBIOS = [
    (VIEJO_CALCULO, NUEVO_CALCULO, "el cálculo de las horas"),
    (VIEJO_HORAS, NUEVO_HORAS, "los campos de horas que se mandan"),
    (VIEJO_COSTO, NUEVO_COSTO, "el costo, que cobraba el tramo"),
]


def cuerpo_de(texto, cabecera):
    """El cuerpo de una función: desde su `def` hasta el siguiente de nivel
    cero. Acotar el reemplazo a la función evita tocar otra vista que use
    por casualidad las mismas líneas."""
    i = texto.find(cabecera)
    if i < 0:
        return None, None
    # Hacia atrás hasta el principio de su línea (puede llevar decoradores
    # encima, que no estorban).
    i = texto.rfind("\n", 0, i) + 1
    m = re.search(r"\n(?=@|def )", texto[i + 1:])
    j = (i + 1 + m.start() + 1) if m else len(texto)
    return i, j


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--archivo", default=VISTAS)
    p.add_argument("--dry-run", action="store_true",
                   help="dice lo que haría y no escribe nada")
    args = p.parse_args()

    if not os.path.exists(args.archivo):
        print("no encuentro %s" % args.archivo, file=sys.stderr)
        print("pasa la ruta con --archivo", file=sys.stderr)
        return 2

    with open(args.archivo, encoding="utf-8") as f:
        original = f.read()

    ini, fin = cuerpo_de(original, FUNCION)
    if ini is None:
        print("no encuentro '%s' en %s" % (FUNCION, args.archivo), file=sys.stderr)
        return 2

    cuerpo = original[ini:fin]
    print("funcion encontrada: %d lineas" % cuerpo.count("\n"))

    if '"horas_efectivas"' in cuerpo:
        print("\nYa esta parcheado: la vista ya manda horas_efectivas.")
        return 0

    nuevo = cuerpo
    for viejo, reemplazo, que in CAMBIOS:
        n = nuevo.count(viejo)
        if n != 1:
            print("\nNo puedo tocar %s: esperaba 1 aparicion y hay %d." % (que, n),
                  file=sys.stderr)
            print("La vista ha cambiado desde que se escribio este parche.",
                  file=sys.stderr)
            print("Lo que buscaba, tal cual:\n%r" % viejo, file=sys.stderr)
            return 1
        nuevo = nuevo.replace(viejo, reemplazo)
        print("  OK  %s" % que)

    completo = original[:ini] + nuevo + original[fin:]

    # Compilar ANTES de escribir: un views.py roto tumba el proyecto entero
    # al importar, no solo esta vista.
    try:
        compile(completo, args.archivo, "exec")
    except SyntaxError as e:
        print("\nEl resultado no compila (linea %s): %s" % (e.lineno, e.msg),
              file=sys.stderr)
        print("No se ha escrito nada.", file=sys.stderr)
        return 1
    print("  OK  el resultado compila")

    # La otra vista que lista partes: si calcula igual, tiene el mismo fallo.
    ini2, fin2 = cuerpo_de(original, "def partes_diarios_lista(")
    if ini2 is not None:
        otro = original[ini2:fin2]
        if "hm_fin - hm_ini" in otro and "horas_efectivas" not in otro:
            print("")
            print("  AVISO  `partes_diarios_lista` calcula las horas igual y")
            print("         tampoco mira horas_efectivas. Este parche NO la")
            print("         toca. Pasame su codigo y la arreglo tambien.")

    if args.dry_run:
        print("\n--dry-run: no se ha escrito nada.")
        return 0

    copia = args.archivo + ".bak_horas"
    shutil.copy2(args.archivo, copia)
    with open(args.archivo, "w", encoding="utf-8") as f:
        f.write(completo)

    print("")
    print("escrito.  copia de seguridad en %s" % copia)
    print("")
    print("Ahora:")
    print("    docker compose restart web")
    print("")
    print("Y para comprobarlo, en la ficha de la excavadora JURP006 el parte")
    print("PD-0193-20260921 debe pasar a 9.00 programadas / 4.00 muertas /")
    print("5.00 efectivas, y su importe de S/ 4,885.20 a S/ 2,714.00.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
