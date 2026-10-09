# -*- coding: utf-8 -*-
"""Terminar una actividad cierra sus partes y libera sus maquinas.

    python3 parche_terminar_actividad.py              # solo muestra
    python3 parche_terminar_actividad.py --aplicar    # aplica, con respaldo
    docker compose up -d --no-deps --force-recreate web

NO HAY MIGRACION: solo se anaden dos vistas y sus rutas.

POR QUE. Hoy "Terminar actividad" en la web hace un PATCH al estado y nada
mas: bloquea el costeo, pero los partes siguen abiertos y las maquinas
siguen marcadas como ocupadas. Una excavadora que se queda activa en una
actividad terminada no se puede asignar a otra, y el que la busca no tiene
forma de saber por que. Cerrar una incidencia SI hace las tres cosas, y no
hay ninguna razon para que una actividad se comporte distinto.

Esto es cerrar_incidente() de views.py, con dos diferencias deliberadas:

  - No hay tabla de "terminadas". La actividad ya tiene estado, y dos marcas
    de lo mismo acaban discrepando: el dia que una diga terminada y la otra
    no, nadie sabra cual mirar. El estado ES la marca.

  - Reabrir NO reabre los partes, igual que en incidencias. Un parte cerrado
    ya libero su maquina y puede haberla cogido otro; reabrirlo en bloque
    reclamaria maquinas que ya no son suyas.

ES IDEMPOTENTE. Terminar dos veces no cierra nada que ya este cerrado ni
libera dos veces: se filtra por cerrado=False.
"""

from __future__ import print_function

import datetime
import io
import os
import re
import shutil
import sys

BASE = "/root/proyectos/api_vigilantes"
APP = os.path.join(BASE, "operations")
F_VISTA = os.path.join(APP, "views_actividades_obra.py")
F_URLS = os.path.join(APP, "urls.py")

APLICAR = "--aplicar" in sys.argv


# ═══════════════════════════════════════════════════════════════════════════
#  Las dos vistas
# ═══════════════════════════════════════════════════════════════════════════

VISTAS = '''

@api_view(["POST"])
@permission_classes([AllowAny])
def terminar_actividad(request, pk):
    """Cierra los partes de una actividad, libera sus maquinas y la marca.

    Es lo mismo que cerrar_incidente() para una incidencia. La diferencia es
    donde queda la marca: una incidencia la guarda en IncidenteCerrado y una
    actividad en su propio estado, que ya existe. Dos marcas de lo mismo
    acaban discrepando.
    """
    from django.utils import timezone
    # Dentro de la funcion y no arriba: views.py importa de aqui, y al reves
    # arriba del fichero se montaria un import circular.
    from .views import _liberar_maquina_de_parte

    try:
        act = ActividadObra.objects.get(pk=pk)
    except ActividadObra.DoesNotExist:
        return Response({"detail": "No existe la actividad."},
                        status=status.HTTP_404_NOT_FOUND)

    # cerrado=False: terminar dos veces no vuelve a cerrar ni a liberar.
    partes = DailyPartHeavyEquipment.objects.filter(actividad_obra_id=act.id,
                                                    cerrado=False)
    total = 0
    liberadas = []
    for parte in partes:
        parte.cerrado = True
        parte.fecha_cierre = timezone.now()
        parte.save(update_fields=["cerrado", "fecha_cierre"])
        maq = _liberar_maquina_de_parte(parte)
        if maq:
            liberadas.append(maq.codigo)
        total += 1

    act.estado = ActividadObra.TERMINADA
    act.save(update_fields=["estado"])

    return Response({
        "detail": "Se cerraron {0} parte(s) y se liberaron {1} maquina(s).".format(
            total, len(liberadas)),
        "cerrados": total,
        "maquinas_liberadas": liberadas,
        "estado": act.estado,
    })


@api_view(["POST"])
@permission_classes([AllowAny])
def reanudar_actividad(request, pk):
    """Devuelve la actividad a ejecucion para poder seguir editando.

    NO reabre los partes, igual que reabrir_incidente(). Un parte cerrado ya
    libero su maquina y puede haberla cogido otra actividad; reabrirlos en
    bloque reclamaria maquinas que ya no son suyas.
    """
    try:
        act = ActividadObra.objects.get(pk=pk)
    except ActividadObra.DoesNotExist:
        return Response({"detail": "No existe la actividad."},
                        status=status.HTTP_404_NOT_FOUND)

    act.estado = ActividadObra.EN_EJECUCION
    act.save(update_fields=["estado"])
    return Response({
        "detail": "Actividad reanudada. Los partes ya cerrados siguen cerrados.",
        "estado": act.estado,
    })
'''

ANCLA_URLS_IMP = ("from .views_actividades_obra import (\n"
                  "    actividades_obra, actividad_obra_detalle, actividades_obra_resumen,\n"
                  ")\n")
NUEVO_URLS_IMP = ("from .views_actividades_obra import (\n"
                  "    actividades_obra, actividad_obra_detalle, actividades_obra_resumen,\n"
                  "    terminar_actividad, reanudar_actividad,\n"
                  ")\n")

ANCLA_RUTA = ("    path('actividades-obra/<int:pk>/', actividad_obra_detalle,\n"
              "         name='actividad-obra-detalle'),\n")
NUEVA_RUTA = (ANCLA_RUTA +
              "    # Terminar cierra los partes y libera las maquinas, como el\n"
              "    # cerrar-partes de una incidencia.\n"
              "    path('actividades-obra/<int:pk>/cerrar-partes/', terminar_actividad,\n"
              "         name='terminar-actividad'),\n"
              "    path('actividades-obra/<int:pk>/reabrir/', reanudar_actividad,\n"
              "         name='reanudar-actividad'),\n")


def principal():
    for f in (F_VISTA, F_URLS):
        if not os.path.isfile(f):
            print("No encuentro {0}.".format(f))
            sys.exit(1)

    txt_v = io.open(F_VISTA, encoding="utf-8").read()
    txt_u = io.open(F_URLS, encoding="utf-8").read()

    print("")
    print("=" * 78)
    print("Terminar una actividad cierra sus partes")
    print("=" * 78)
    print("")
    print("Carpeta: {0}".format(BASE))
    print("")

    fallos = []
    if "def terminar_actividad" in txt_v:
        fallos.append("views_actividades_obra.py ya tiene terminar_actividad")
    if "terminar_actividad" in txt_u:
        fallos.append("urls.py ya menciona terminar_actividad")
    for nombre, texto, ancla in (
            ("urls.py: el import de las vistas", txt_u, ANCLA_URLS_IMP),
            ("urls.py: la ruta de detalle", txt_u, ANCLA_RUTA)):
        n = texto.count(ancla)
        if n != 1:
            fallos.append("{0} aparece {1} veces, esperaba 1".format(nombre, n))

    # Lo que la vista nueva necesita que ya este importado arriba.
    for nombre in ("ActividadObra", "DailyPartHeavyEquipment", "status",
                   "api_view", "permission_classes", "AllowAny", "Response"):
        if not re.search(r"\b" + re.escape(nombre) + r"\b", txt_v):
            fallos.append("views_actividades_obra.py no importa {0}".format(nombre))

    if "_liberar_maquina_de_parte" not in io.open(
            os.path.join(APP, "views.py"), encoding="utf-8").read():
        fallos.append("views.py no tiene _liberar_maquina_de_parte; sin ella no "
                      "se pueden liberar las maquinas")

    if fallos:
        print("NO se puede aplicar:")
        for f in fallos:
            print("    - {0}".format(f))
        print("")
        sys.exit(1)

    print("views_actividades_obra.py")
    print("    + terminar_actividad   cierra los partes abiertos, libera sus")
    print("                           maquinas y pone estado='terminada'")
    print("    + reanudar_actividad   vuelve a 'ejecucion'. NO reabre partes.")
    print("")
    print("urls.py")
    print("    + POST actividades-obra/<id>/cerrar-partes/")
    print("    + POST actividades-obra/<id>/reabrir/")
    print("")
    print("No hay migracion: solo son vistas.")
    print("")

    if not APLICAR:
        print("Esto es solo la vista previa. Para aplicarlo:")
        print("    python3 {0} --aplicar".format(os.path.basename(__file__)))
        print("")
        return

    sello = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    for ruta, nuevo in ((F_VISTA, txt_v.rstrip("\n") + "\n" + VISTAS),
                        (F_URLS, txt_u.replace(ANCLA_URLS_IMP, NUEVO_URLS_IMP, 1)
                                      .replace(ANCLA_RUTA, NUEVA_RUTA, 1))):
        resp = "{0}.bak_{1}".format(ruta, sello)
        shutil.copy2(ruta, resp)
        io.open(ruta, "w", encoding="utf-8").write(nuevo)
        print("    {0}".format(os.path.basename(ruta)))
        print("        respaldo: {0}".format(os.path.basename(resp)))

    print("")
    print("APLICADO. Recarga el servicio:")
    print("")
    print("    cd {0}".format(BASE))
    print("    docker compose up -d --no-deps --force-recreate web")
    print("")


if __name__ == "__main__":
    principal()
