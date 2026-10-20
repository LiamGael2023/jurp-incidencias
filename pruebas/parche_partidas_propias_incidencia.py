# -*- coding: utf-8 -*-
"""Que una incidencia pueda CREAR sus propias partidas, no solo elegirlas.

    python3 parche_partidas_propias_incidencia.py                 # solo mira
    python3 parche_partidas_propias_incidencia.py --aplicar        # aplica
    python3 parche_partidas_propias_incidencia.py --base /ruta     # si no autodetecta

HACE FALTA parche_partidas_de_incidencia.py APLICADO ANTES. Este amplia el
views_incidentes.py que aquel crea; si no esta, se niega y lo dice.

QUE PROBLEMA RESUELVE
=====================

El bloque PROGRAMADO dejaba elegir partidas, y las que ofrecia eran las de
otro proyecto: "01 · CONSTRUCCION Y MEJORAMIENTO DE OBRAS DE TRATAMIENTO DE
AGUA EN LA TOMA 10.5" para una incidencia en el Canal Lateral 10. No es un
filtro mal puesto: es que la incidencia NO TIENE presupuesto del que elegir.
Aparece cuando algo se rompe, y lo que hay que hacer para arreglarlo se
decide entonces, no estaba presupuestado el ano pasado.

Asi que no se elige: se escribe. Descripcion, unidad, metrado y precio.

POR QUE SON Partida Y NO UNA TABLA NUEVA
========================================

Porque el parte diario imputa metrado contra DailyPartActivity.partida, que
es una ForeignKey a operations.Partida. Una tabla aparte para "partidas de
incidencia" obligaria a duplicar esa clave, el calculo del ejecutado, el
avance y el PDF del parte; y el dia que alguien sume las dos, saldrian dos
verdades sobre lo mismo.

Lo que las separa del presupuesto de una obra es el campo 'obra', que aqui
lleva el codigo del incidente. Partida ya tiene UniqueConstraint(obra,
codigo), asi que el codigo correlativo 01, 02, 03 es unico dentro del
incidente y no choca con el 01 de ninguna obra real. Y como el selector de
presupuestos filtra por obra, estas no se cuelan en ningun otro proyecto.

EL CODIGO SE GENERA, NO SE PIDE. Es el numero siguiente dentro de esta
incidencia, mirando los que ya hay. Pedirlo a mano solo servia para que el
formulario rebotara con "ya existe" cuando alguien repitiera uno.

NO SE BORRA LO QUE YA TIENE TRABAJO IMPUTADO
============================================

Quitar una partida con metrado ya cargado en un parte no deja un hueco: deja
un DailyPartActivity apuntando a una fila que ya no esta, y el avance de ese
parte pasa a contar contra nada. Se responde 409 diciendo cuantos partes la
usan. Para eso esta la edicion: si el metrado estaba mal, se corrige.

Una partida SIN imputar se borra de verdad, no solo se desengancha: es del
incidente y no le sirve a nadie mas.
"""

from __future__ import print_function

import datetime
import io
import os
import re
import shutil
import sys

CANDIDATOS = [
    "/var/www/envs/vigilantes",
    "/root/proyectos/api_vigilantes",
    os.getcwd(),
]

APLICAR = "--aplicar" in sys.argv


def base_del_proyecto():
    if "--base" in sys.argv:
        return sys.argv[sys.argv.index("--base") + 1]
    for c in CANDIDATOS:
        if os.path.isfile(os.path.join(c, "operations", "models.py")):
            return c
    return None


# ══════════════════════════════════════════════════════════════════════════
# lo que se anade a views_incidentes.py
# ══════════════════════════════════════════════════════════════════════════

VISTAS = '''

# ══════════════════════════════════════════════════════════════════════════
# LAS PARTIDAS PROPIAS DE LA INCIDENCIA
# ══════════════════════════════════════════════════════════════════════════

def _obra_de(inc):
    """El nombre de obra con el que se guardan las partidas de esta incidencia.

    Es el codigo de la incidencia, y si no lo tiene, su id. Esto es lo que
    las mantiene separadas del presupuesto de cualquier obra real: el
    selector de presupuestos filtra por obra, asi que no se cuelan, y el
    UniqueConstraint(obra, codigo) de Partida hace que el correlativo 01 de
    esta incidencia no choque con el 01 de ninguna otra parte.
    """
    return (inc.code or "").strip() or "INCIDENTE-%s" % inc.pk


def _siguiente_codigo(obra):
    """El correlativo siguiente dentro de esta incidencia: 01, 02, 03...

    Se mira el mayor que YA HAY y se suma uno, en vez de contar cuantas son.
    Contando, borrar la 02 de tres partidas devolveria un 03 que ya existe y
    el alta reventaria contra el UniqueConstraint.
    """
    mayor = 0
    for c in Partida.objects.filter(obra=obra).values_list("codigo", flat=True):
        m = re.match(r"^\\s*(\\d+)", c or "")
        if m:
            mayor = max(mayor, int(m.group(1)))
    return "%02d" % (mayor + 1)


def _numero(v, campo, errores, minimo=None):
    try:
        n = float(v)
    except (TypeError, ValueError):
        errores[campo] = ["Tiene que ser un numero."]
        return None
    if minimo is not None and n < minimo:
        errores[campo] = ["No puede ser menor que %s." % minimo]
        return None
    return n


def _lee_campos(datos, errores, obligatorios=True):
    """Los cuatro campos del formulario, limpios.

    Se validan aqui y no en un ModelSerializer porque 'obra' y 'codigo' no
    los manda el formulario -los pone el servidor- y un serializer completo
    obligaria a inventarlos en el navegador o a marcarlos read_only y
    rellenarlos igual a mano.
    """
    out = {}
    desc = (datos.get("descripcion") or "").strip()
    unidad = (datos.get("unidad") or "").strip()

    if obligatorios or "descripcion" in datos:
        if not desc:
            errores["descripcion"] = ["Hace falta la descripcion."]
        elif len(desc) > 300:
            errores["descripcion"] = ["Maximo 300 caracteres."]
        else:
            out["descripcion"] = desc
    if obligatorios or "unidad" in datos:
        if not unidad:
            errores["unidad"] = ["Hace falta la unidad."]
        elif len(unidad) > 12:
            errores["unidad"] = ["Maximo 12 caracteres."]
        else:
            out["unidad"] = unidad
    if obligatorios or "metrado" in datos:
        n = _numero(datos.get("metrado", 0), "metrado", errores, minimo=0)
        if n is not None:
            out["metrado"] = n
    if obligatorios or "precio" in datos:
        n = _numero(datos.get("precio", 0), "precio", errores, minimo=0)
        if n is not None:
            out["precio"] = n
    return out


@api_view(["POST"])
@permission_classes([AllowAny])
def incidencia_partida_alta(request, pk):
    """Crea una partida de esta incidencia y se la engancha.

    Devuelve la incidencia entera, no solo la partida: la pantalla necesita
    el detalle recalculado -presupuestado, saldos- y pedirlo aparte dejaria
    medio segundo con los numeros viejos en pantalla.
    """
    try:
        inc = IncidentReport.objects.get(pk=pk)
    except IncidentReport.DoesNotExist:
        return Response({"detail": "No existe."},
                        status=status.HTTP_404_NOT_FOUND)

    errores = {}
    campos = _lee_campos(request.data, errores)
    if errores:
        return Response(errores, status=status.HTTP_400_BAD_REQUEST)

    obra = _obra_de(inc)
    p = Partida.objects.create(
        obra=obra,
        proyecto=(inc.description or "")[:300],
        codigo=_siguiente_codigo(obra),
        activo=True,
        **campos)
    inc.partidas.add(p)
    return Response(IncidentReportSerializer(inc).data,
                    status=status.HTTP_201_CREATED)


@api_view(["PATCH", "DELETE"])
@permission_classes([AllowAny])
def incidencia_partida_detalle(request, pk, partida_id):
    """Corrige o quita una partida propia de esta incidencia.

    Solo las PROPIAS. Si la partida vino de un presupuesto de verdad, se
    desengancha de la incidencia pero no se toca: no es suya para editarla
    ni para borrarla, y cambiarle el metrado aqui moveria el presupuesto de
    una obra entera desde la ficha de un incidente.
    """
    try:
        inc = IncidentReport.objects.get(pk=pk)
    except IncidentReport.DoesNotExist:
        return Response({"detail": "No existe la incidencia."},
                        status=status.HTTP_404_NOT_FOUND)

    p = inc.partidas.filter(pk=partida_id).first()
    if p is None:
        return Response({"detail": "Esa partida no esta en esta incidencia."},
                        status=status.HTTP_404_NOT_FOUND)

    propia = p.obra == _obra_de(inc)

    if request.method == "PATCH":
        if not propia:
            return Response(
                {"detail": "Esa partida es del presupuesto de %s. Desde aqui "
                           "no se edita." % p.obra},
                status=status.HTTP_409_CONFLICT)
        errores = {}
        campos = _lee_campos(request.data, errores, obligatorios=False)
        if errores:
            return Response(errores, status=status.HTTP_400_BAD_REQUEST)
        for k, v in campos.items():
            setattr(p, k, v)
        p.save()
        return Response(IncidentReportSerializer(inc).data)

    # DELETE
    usos = DailyPartActivity.objects.filter(partida_id=p.pk).count()
    if usos:
        return Response({
            "detail": "No se puede quitar: %d parte(s) ya le imputaron "
                      "metrado. Si el metrado estaba mal, corrigelo en la "
                      "partida en vez de borrarla." % usos,
            "partes": usos,
        }, status=status.HTTP_409_CONFLICT)

    inc.partidas.remove(p)
    # Si es suya y nadie la usa, se borra de verdad. Dejarla colgando llenaria
    # el catalogo de partidas huerfanas de incidencias que ya nadie mira.
    if propia:
        p.delete()
    return Response(IncidentReportSerializer(inc).data)
'''


IMPORT_VIEJO = "from .models import DailyPartActivity, IncidentReport"
IMPORT_NUEVO = "from .models import DailyPartActivity, IncidentReport, Partida"

IMPORT_RE_VIEJO = "from django.db.models import Sum"
IMPORT_RE_NUEVO = "import re\n\nfrom django.db.models import Sum"


def paso_vista(texto):
    """→ (texto_nuevo, aviso)."""
    if "incidencia_partida_alta" in texto:
        return texto, "ya estaba: el alta de partidas"

    if "class IncidentReportSerializer" not in texto:
        return None, ("views_incidentes.py no tiene IncidentReportSerializer; "
                      "aplica antes parche_partidas_de_incidencia.py")

    if IMPORT_VIEJO not in texto:
        if "Partida" not in texto.split("class ")[0]:
            return None, ("no encuentro el import de .models tal como lo "
                          "escribe el parche anterior; dime como quedo")
    else:
        texto = texto.replace(IMPORT_VIEJO, IMPORT_NUEVO, 1)

    if not re.search(r"^import re$", texto, re.M):
        if IMPORT_RE_VIEJO not in texto:
            return None, "no encuentro el import de Sum para colocar 're'"
        texto = texto.replace(IMPORT_RE_VIEJO, IMPORT_RE_NUEVO, 1)

    return texto.rstrip("\n") + "\n" + VISTAS, "anadidas las vistas de alta/edicion/baja"


# ══════════════════════════════════════════════════════════════════════════
# las rutas
# ══════════════════════════════════════════════════════════════════════════

IMPORT = ("from .views_incidentes import (\n"
          "    incidencia_partida_alta, incidencia_partida_detalle,\n"
          ")\n")

RUTA = ("    # Partidas propias de la incidencia: se escriben aqui, no se\n"
        "    # eligen de ningun presupuesto -una incidencia no tiene-.\n"
        "    path('incidentes/<int:pk>/partidas/', incidencia_partida_alta,\n"
        "         name='incidencia-partida-alta'),\n"
        "    path('incidentes/<int:pk>/partidas/<int:partida_id>/',\n"
        "         incidencia_partida_detalle, name='incidencia-partida-detalle'),\n")


def paso_urls(texto):
    if "incidencia_partida_alta" in texto:
        return texto, "ya estaban: las rutas de partidas"

    m = re.search(r"^urlpatterns\s*=\s*\[", texto, re.M)
    if not m:
        return None, "no encuentro urlpatterns = [ en urls.py"
    if "views_incidentes" not in texto:
        return None, ("urls.py no conoce views_incidentes; aplica antes "
                      "parche_partidas_de_incidencia.py")

    nuevo = (texto[:m.start()] + IMPORT + "\n"
             + texto[m.start():m.end()] + "\n" + RUTA
             + texto[m.end():])
    return nuevo, "anadidas las dos rutas de partidas"


# ══════════════════════════════════════════════════════════════════════════

def respaldo(ruta):
    sello = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    copia = "%s.bak-%s" % (ruta, sello)
    shutil.copy2(ruta, copia)
    return copia


def principal():
    base = base_del_proyecto()
    if not base:
        print("No encuentro la carpeta del proyecto. Pasala con --base /ruta")
        return 1

    app = os.path.join(base, "operations")
    f_vista = os.path.join(app, "views_incidentes.py")
    f_urls = os.path.join(app, "urls.py")

    print("proyecto: %s" % base)
    print("modo    : %s" % ("APLICAR" if APLICAR else "solo mostrar"))
    print("")

    if not os.path.isfile(f_vista):
        print("MAL  no existe %s" % f_vista)
        print("     Aplica antes parche_partidas_de_incidencia.py.")
        return 1
    if not os.path.isfile(f_urls):
        print("MAL  no encuentro %s" % f_urls)
        return 1

    txt_v = io.open(f_vista, encoding="utf-8").read()
    txt_u = io.open(f_urls, encoding="utf-8").read()

    nuevo_v, av_v = paso_vista(txt_v)
    nuevo_u, av_u = paso_urls(txt_u)

    print("1. views_incidentes.py  %s" % av_v)
    print("2. urls.py              %s" % av_u)
    print("")

    fallos = []
    if nuevo_v is None:
        fallos.append("views_incidentes.py: %s" % av_v)
    if nuevo_u is None:
        fallos.append("urls.py: %s" % av_u)

    if fallos:
        print("NO SE ESCRIBE NADA. A medias es peor que sin empezar:")
        for f in fallos:
            print("   - %s" % f)
        print("")
        print("Mandame esta salida y lo ajusto.")
        return 1

    # Se comprueba el RESULTADO, no la intencion.
    for quien, txt, falta in (
            ("views_incidentes.py", nuevo_v, "def incidencia_partida_alta"),
            ("views_incidentes.py", nuevo_v, "Partida"),
            ("urls.py", nuevo_u, "incidencia_partida_alta")):
        if falta not in txt:
            print("NO SE ESCRIBE NADA: en %s no salio %r." % (quien, falta))
            return 1

    if not APLICAR:
        print("Nada tocado. Para aplicarlo:")
        print("    python3 %s --aplicar" % os.path.basename(__file__))
        return 0

    escritos = []
    if nuevo_v != txt_v:
        print("respaldo %s" % respaldo(f_vista))
        io.open(f_vista, "w", encoding="utf-8").write(nuevo_v)
        escritos.append("views_incidentes.py")
    if nuevo_u != txt_u:
        print("respaldo %s" % respaldo(f_urls))
        io.open(f_urls, "w", encoding="utf-8").write(nuevo_u)
        escritos.append("urls.py")

    print("")
    print("escrito: %s" % (", ".join(escritos) if escritos else "nada, ya estaba"))
    print("")
    print("NO hay migracion: no se toca ningun modelo. Solo recargar:")
    print("    docker compose up -d --no-deps --force-recreate web")
    return 0


if __name__ == "__main__":
    sys.exit(principal())
