# -*- coding: utf-8 -*-
"""Las actividades y las partidas se piden por proyecto, no por un texto.

    python3 parche_actividades_por_proyecto.py              # solo muestra
    python3 parche_actividades_por_proyecto.py --aplicar    # aplica, con respaldo

POR QUE. Hasta ahora el proyecto era un texto repetido en cada fila
(Partida.obra = 'Obras10_6'). Ya existe la tabla Proyecto y todo cuelga de
ella, pero las vistas siguen filtrando por el texto, y -esto es lo que
importa- al CREAR una actividad desde la web nadie rellena proyecto_ref.

Es decir: cada actividad nueva nace con la clave en NULL. No se nota al
principio, porque el texto sigue ahi y las pantallas siguen funcionando. Se
nota el dia que alguien corrija el nombre de una obra, o cree dos proyectos
que se llamen parecido: entonces unas actividades cuelgan del proyecto y
otras no, y el avance sale distinto segun por donde se mire. Es mejor
cerrarlo ahora, con 0 filas malas, que dentro de dos meses con doscientas.

QUE CAMBIA.

  views_actividades_obra.py
    GET  actividades-obra/          + acepta ?proyecto=<id>
    GET  actividades-obra/resumen/  + acepta ?proyecto=<id>
    POST actividades-obra/          + acepta {"proyecto_id": <id>} y, con el,
                                      rellena proyecto_ref, obra y el nombre
                                      largo leyendolos del propio Proyecto
                                    + si solo viene 'obra', busca su Proyecto
                                      y lo engancha igual: las dos puertas
                                      dejan la fila completa

LAS PARTIDAS NO SE TOCAN. Se seguiran pidiendo por ?obra=<codigo>, que ya
funciona y da exactamente el mismo conjunto: el codigo del proyecto y el
texto 'obra' son uno a uno. Meter mano en views_partidas.py para no cambiar
el resultado seria arriesgar un fichero a cambio de nada.

QUE NO CAMBIA. El filtro por 'obra' se queda donde esta, y el campo tambien.
Quitarlos es un segundo paso, cuando ninguna pantalla los pida; hacerlo a la
vez que esto significaria no saber cual de los dos cambios rompio que.

El correlativo del codigo se sigue calculando por obra. Con el proyecto
enganchado da lo mismo -obra y proyecto son uno a uno-, y cambiarlo ahora
renumeraria las actividades que ya existen.
"""

from __future__ import print_function

import datetime
import io
import os
import shutil
import sys

BASE = "/root/proyectos/api_vigilantes"
APP = os.path.join(BASE, "operations")
F_ACT = os.path.join(APP, "views_actividades_obra.py")

APLICAR = "--aplicar" in sys.argv


# ═══════════════════════════════════════════════════════════════════════════
#  views_actividades_obra.py
# ═══════════════════════════════════════════════════════════════════════════

# ── 1. el import ───────────────────────────────────────────────────────────
IMP_ANCLA = "    Partida,\n)\n"
IMP_NUEVO = "    Partida,\n    Proyecto,\n)\n"

# ── 2. filtro en la lista ──────────────────────────────────────────────────
LISTA_ANCLA = """        qs = ActividadObra.objects.all()
        obra = request.query_params.get("obra")
        if obra:
            qs = qs.filter(obra=obra)
"""
LISTA_NUEVO = """        qs = ActividadObra.objects.all()
        # Por clave si viene, que es lo que manda ahora la web. El filtro por
        # texto se queda para lo que todavia no se ha migrado.
        pro_id = request.query_params.get("proyecto")
        if pro_id:
            qs = qs.filter(proyecto_ref_id=pro_id)
        obra = request.query_params.get("obra")
        if obra:
            qs = qs.filter(obra=obra)
"""

# ── 3. filtro en el resumen ────────────────────────────────────────────────
RES_ANCLA = """    obra = request.query_params.get("obra")
    if obra:
        qs = qs.filter(obra=obra)
"""
RES_NUEVO = """    pro_id = request.query_params.get("proyecto")
    if pro_id:
        qs = qs.filter(proyecto_ref_id=pro_id)
    obra = request.query_params.get("obra")
    if obra:
        qs = qs.filter(obra=obra)
"""

# ── 4. el alta ─────────────────────────────────────────────────────────────
POST_ANCLA = """    obra = (datos.get("obra") or "").strip()
    if not obra:
        return Response({"detail": "Falta la obra."},
                        status=status.HTTP_400_BAD_REQUEST)
"""
POST_NUEVO = '''    # El proyecto puede llegar de dos formas y las dos dejan la fila
    # completa: por clave (lo que manda la web desde que existe Proyectos) o
    # por el texto de siempre. Lo que NO puede pasar es que se cree una
    # actividad con proyecto_ref en NULL: a partir de ahi el avance sale
    # distinto segun por donde se mire.
    pro = None
    pro_id = datos.get("proyecto_id") or datos.get("proyecto_ref")
    if pro_id:
        try:
            pro = Proyecto.objects.get(pk=pro_id)
        except (Proyecto.DoesNotExist, ValueError, TypeError):
            return Response({"detail": "No existe el proyecto {0}.".format(pro_id)},
                            status=status.HTTP_400_BAD_REQUEST)
        datos["obra"] = pro.codigo
        datos["proyecto"] = pro.nombre[:300]

    obra = (datos.get("obra") or "").strip()
    if not obra:
        return Response({"detail": "Falta el proyecto."},
                        status=status.HTTP_400_BAD_REQUEST)

    if pro is None:
        # Vino solo el texto. Se busca su proyecto igual: enganchar aqui es
        # gratis, y no hacerlo deja una fila que habra que repescar a mano.
        pro = Proyecto.objects.filter(codigo=obra).first()
'''

# ── 5. guardar la clave ────────────────────────────────────────────────────
# El objeto se crea con el serializer; se le pasa proyecto_ref por save().
SAVE_ANCLA = """    ser = ActividadObraSerializer(data=datos)
    if not ser.is_valid():
        return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)
    ser.save()
"""
SAVE_NUEVO = """    ser = ActividadObraSerializer(data=datos)
    if not ser.is_valid():
        return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)
    ser.save(proyecto_ref=pro)
"""


# ═══════════════════════════════════════════════════════════════════════════

def principal():
    if not os.path.isfile(F_ACT):
        print("No encuentro {0}.".format(F_ACT))
        sys.exit(1)

    txt_a = io.open(F_ACT, encoding="utf-8").read()

    print("")
    print("=" * 78)
    print("Las actividades cuelgan del proyecto, no de un texto")
    print("=" * 78)
    print("")
    print("Carpeta: {0}".format(BASE))
    print("")

    # ── comprobar antes de tocar ──────────────────────────────────────────
    fallos = []
    if "proyecto_ref_id" in txt_a:
        fallos.append("views_actividades_obra.py ya menciona proyecto_ref_id: "
                      "parece aplicado")
    for nombre, ancla in (("el import de models", IMP_ANCLA),
                          ("el filtro de la lista", LISTA_ANCLA),
                          ("el filtro del resumen", RES_ANCLA),
                          ("el alta", POST_ANCLA),
                          ("el guardado", SAVE_ANCLA)):
        n = txt_a.count(ancla)
        if n != 1:
            fallos.append("views_actividades_obra.py: {0} aparece {1} veces, "
                          "esperaba 1".format(nombre, n))

    if fallos:
        print("NO se puede aplicar:")
        for f in fallos:
            print("    - {0}".format(f))
        print("")
        sys.exit(1)

    print("views_actividades_obra.py")
    print("    + GET  ?proyecto=<id>   en la lista y en el resumen")
    print("    + POST {\"proyecto_id\": <id>}  rellena proyecto_ref, obra y")
    print("           el nombre largo leyendolos del Proyecto")
    print("    + POST con solo 'obra'  tambien engancha proyecto_ref")
    print("")
    print("Las partidas no se tocan: se piden por ?obra=<codigo>, que da el")
    print("mismo conjunto.")
    print("")

    if not APLICAR:
        print("Esto es solo la vista previa. Para aplicarlo:")
        print("    python3 {0} --aplicar".format(os.path.basename(__file__)))
        print("")
        return

    sello = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")

    txt_a2 = txt_a.replace(IMP_ANCLA, IMP_NUEVO, 1)
    txt_a2 = txt_a2.replace(LISTA_ANCLA, LISTA_NUEVO, 1)
    txt_a2 = txt_a2.replace(RES_ANCLA, RES_NUEVO, 1)
    txt_a2 = txt_a2.replace(POST_ANCLA, POST_NUEVO, 1)
    txt_a2 = txt_a2.replace(SAVE_ANCLA, SAVE_NUEVO, 1)

    resp = "{0}.bak_{1}".format(F_ACT, sello)
    shutil.copy2(F_ACT, resp)
    io.open(F_ACT, "w", encoding="utf-8").write(txt_a2)

    print("APLICADO")
    print("    {0}".format(os.path.basename(F_ACT)))
    print("        respaldo: {0}".format(os.path.basename(resp)))
    print("")
    print("No hay migracion: solo cambian las vistas. Recarga el servicio:")
    print("    cd {0}".format(BASE))
    print("    docker compose up -d --no-deps --force-recreate web")
    print("")
    print("Y comprueba que responde:")
    print("    curl -s 'http://127.0.0.1:8000/api/v1/mobile/operations/"
          "actividades-obra/?proyecto=1' | head -c 300")
    print("")


if __name__ == "__main__":
    principal()
