# -*- coding: utf-8 -*-
"""Escribir a mano el presupuesto de un proyecto, cuando no hay Excel.

    python3 parche_presupuesto_proyecto.py                 # solo mira
    python3 parche_presupuesto_proyecto.py --aplicar        # aplica
    python3 parche_presupuesto_proyecto.py --base /ruta     # si no autodetecta

POR QUE NO SIRVE EL IMPORTADOR QUE YA HAY
=========================================

/proyectos/<pk>/presupuesto/ existe, pero es para cargar un Excel entero, y
hace dos cosas que lo descartan para escribir a mano:

  1. RECHAZA TODA FILA SIN UNIDAD -"sin unidad no se puede medir el
     avance"-, y un titulo no tiene unidad. Sin titulos no hay arbol: el
     presupuesto sale como una lista plana.
  2. RECIBE LA LISTA ENTERA Y DESACTIVA LO QUE NO VENGA. Mandarle una
     partida suelta desactivaria el resto del presupuesto.

Las dos cosas estan bien para lo suyo -cargar un Excel completo, de una
vez, y que cuadre con su pie- y por eso no se tocan. El alta a mano va por
su propia ruta.

QUE SE ANADE
============

    1. models.py              Partida.es_titulo, si no esta ya
    2. views_proyectos.py     el conteo de partidas deja fuera los titulos
    3. views_presupuesto.py   alta, correccion y baja        (NUEVO)
    4. urls.py                las dos rutas

ES COMPATIBLE con parche_partidas_propias_incidencia.py: los dos anaden
es_titulo y los dos comprueban antes si ya esta. Da igual cual se aplique
primero, y correr los dos no duplica el campo ni la migracion.

EL CODIGO SE GENERA, jerarquico: 01, 02 en la raiz; 01.01 debajo del 01. Se
mira el MAYOR hermano que ya hay y se suma uno. Contando, borrar el 02 de
tres devolveria un 03 que ya existe, y Partida tiene
UniqueConstraint(obra, codigo).

EL CONTEO DE PARTIDAS DEJA FUERA LOS TITULOS. La lista de proyectos dice
"83 partidas"; si contara tambien los titulos escritos a mano, ese numero
dejaria de ser el de partidas imputables y nadie sabria cual de los dos
significa. La SUMA no hace falta tocarla: un titulo lleva metrado y precio
en cero, asi que ya aporta cero.

LO QUE NO SE DEJA HACER, Y POR QUE
==================================

  - Borrar una partida con metrado ya imputado en un parte. Dejaria el parte
    apuntando a una fila que no esta y su avance contando contra nada.
  - Borrar un titulo con algo colgando. Se llevaria por delante filas que no
    se estan mirando.
  - Colgar de una partida. Quedaria con metrado propio y ademas hijos que
    suman, y su total dejaria de significar una cosa sola.
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
# PIEZA 1 · es_titulo  (compartido con el parche de incidencias)
# ══════════════════════════════════════════════════════════════════════════

CAMPO = '''
{0}# UNA FILA QUE AGRUPA, NO UNA QUE SE EJECUTA.
{0}#
{0}# Se podria deducir -"es titulo el que tiene hijos"-, pero entonces un
{0}# titulo recien creado y todavia vacio no lo seria, y desapareceria al
{0}# recargar. Armar la estructura primero y rellenarla despues es
{0}# exactamente como se escribe un presupuesto.
{0}#
{0}# Un titulo no lleva unidad, metrado ni precio: su total es la suma de lo
{0}# que cuelga. Y ningun parte diario puede imputar contra el.
{0}es_titulo = models.BooleanField("Es titulo", default=False)
'''


def bloque_clase(texto, clase):
    m = re.search(r"^class\s+" + re.escape(clase) + r"\s*\(", texto, re.M)
    if not m:
        return None
    sig = re.search(r"^class\s+\w+\s*\(", texto[m.end():], re.M)
    fin = m.end() + sig.start() if sig else len(texto)
    return (m.start(), fin)


def sangria_de(cuerpo):
    # [ \t]+ y no \s+: \s se come el salto de linea y el campo sale
    # entrelineado. Ya paso una vez.
    m = re.search(r"^([ \t]+)\S", cuerpo, re.M)
    return m.group(1) if m else "    "


def paso_modelo(texto):
    pos = bloque_clase(texto, "Partida")
    if not pos:
        return None, "no encuentro class Partida en models.py"
    ini, fin = pos
    cuerpo = texto[ini:fin]

    if not re.search(r"^[ \t]+ruta\s*=", cuerpo, re.M):
        return None, ("Partida no tiene el campo 'ruta'; aplica antes "
                      "parche_ruta_partida.py")
    if not re.search(r"^[ \t]+proyecto_ref\s*=", cuerpo, re.M):
        return None, ("Partida no tiene 'proyecto_ref'; aplica antes "
                      "parche_proyectos.py")

    if re.search(r"^[ \t]+es_titulo\s*=", cuerpo, re.M):
        return texto, "ya estaba: Partida.es_titulo"

    campo = CAMPO.format(sangria_de(cuerpo))
    m = re.search(r"^[ \t]+class\s+Meta\b", cuerpo, re.M)
    if m:
        nuevo = cuerpo[:m.start()] + campo.rstrip("\n") + "\n\n" + cuerpo[m.start():]
    else:
        nuevo = cuerpo.rstrip("\n") + "\n" + campo
    return texto[:ini] + nuevo + texto[fin:], "anadido Partida.es_titulo"


# ══════════════════════════════════════════════════════════════════════════
# PIEZA 2 · el conteo de partidas deja fuera los titulos
# ══════════════════════════════════════════════════════════════════════════

CONTEO_VIEJO = """    def get_partidas(self, obj):
        return obj.partidas.filter(activo=True).count()"""

CONTEO_NUEVO = '''    def get_partidas(self, obj):
        """Cuantas partidas IMPUTABLES tiene. Los titulos no cuentan.

        La lista de proyectos ensena este numero como "83 partidas". Si
        contara tambien los titulos escritos a mano, dejaria de ser el numero
        de partidas contra las que se puede imputar y nadie sabria cual de
        las dos cosas significa.

        La suma de abajo no hace falta tocarla: un titulo lleva metrado y
        precio en cero, asi que ya aporta cero.
        """
        return obj.partidas.filter(activo=True, es_titulo=False).count()'''


def paso_conteo(texto):
    if "es_titulo=False" in texto:
        return texto, "ya estaba: el conteo sin titulos"
    if CONTEO_VIEJO not in texto:
        return None, ("no encuentro get_partidas tal como lo escribe "
                      "parche_proyectos.py; dime como quedo")
    return texto.replace(CONTEO_VIEJO, CONTEO_NUEVO, 1), "el conteo deja fuera los titulos"


# ══════════════════════════════════════════════════════════════════════════
# PIEZA 2b · el serializer de Partida dice si es un titulo
# ══════════════════════════════════════════════════════════════════════════
#
# Sin esto, quien lee /partidas/ no puede distinguir un capitulo de una
# partida. El presupuesto de drenaje son 57 filas de las que 19 son titulos,
# y el selector del parte diario las ofrecia todas: imputar metrado contra un
# titulo lo cuenta dos veces, porque el titulo ya suma el de sus hijos.
#
# El navegador puede deducirlo -un titulo no tiene unidad, y las dos vias de
# alta exigen unidad a toda partida- y de hecho lo hace, para funcionar
# mientras este parche no este aplicado. Pero deducir no es saber: el dia que
# alguien cargue una partida sin unidad por otra via, la deduccion la
# escondera. Mejor que el servidor lo diga.

SER_RE = re.compile(
    r'(class PartidaSerializer\b(?:.|\n)*?fields = \[(?:.|\n)*?)"activo"')


def paso_serializer(texto):
    if '"es_titulo"' in texto:
        return texto, "ya estaba: es_titulo en PartidaSerializer"
    if "class PartidaSerializer" not in texto:
        return None, "no encuentro PartidaSerializer"
    nuevo, n = SER_RE.subn(r'\1"es_titulo", "activo"', texto, count=1)
    if not n:
        return None, ("no encuentro Meta.fields de PartidaSerializer con "
                      '"activo" dentro; dime como quedo')
    return nuevo, "PartidaSerializer devuelve es_titulo"


# ══════════════════════════════════════════════════════════════════════════
# PIEZA 3 · las vistas  (fichero nuevo)
# ══════════════════════════════════════════════════════════════════════════

VISTA = '''# -*- coding: utf-8 -*-
"""Escribir a mano el presupuesto de un proyecto.

El importador de Excel -/proyectos/<pk>/presupuesto/- no sirve para esto:
rechaza toda fila sin unidad, y un titulo no la tiene; y recibe la lista
entera desactivando lo que no venga, asi que mandarle una partida suelta
desactivaria el resto. Las dos cosas estan bien para cargar un Excel
completo, y por eso esto va por su propia ruta en vez de aflojar aquello.

Es el espejo de views_incidentes.py, que hace lo mismo para una incidencia.
Lo que cambia es de quien cuelgan las partidas: alli de la incidencia por un
M2M, aqui del proyecto por proyecto_ref, que es la clave que ya existia.
"""

import json
import re

from django.db.models import Sum
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from .models import DailyPartActivity, Partida, Proyecto


def _tramos(codigo):
    return [t for t in (codigo or "").split(".") if t]


def _nivel(codigo):
    return len(_tramos(codigo))


def _siguiente_codigo(pro, padre_cod):
    """El correlativo siguiente entre los HERMANOS de ese nivel.

    Se mira el mayor que ya hay y se suma uno, en vez de contar cuantos son.
    Contando, borrar el 02 de tres devolveria un 03 que ya existe y el alta
    reventaria contra UniqueConstraint(obra, codigo).
    """
    prefijo = (padre_cod + ".") if padre_cod else ""
    hondo = _nivel(padre_cod) + 1 if padre_cod else 1
    mayor = 0
    for c in pro.partidas.values_list("codigo", flat=True):
        c = c or ""
        if _nivel(c) != hondo or not c.startswith(prefijo):
            continue
        m = re.match(r"^\\s*(\\d+)", _tramos(c)[-1])
        if m:
            mayor = max(mayor, int(m.group(1)))
    return "%s%02d" % (prefijo, mayor + 1)


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


def _lee_campos(datos, errores, titulo=False, obligatorios=True):
    out = {}
    desc = (datos.get("descripcion") or "").strip()
    if obligatorios or "descripcion" in datos:
        if not desc:
            errores["descripcion"] = ["Hace falta la descripcion."]
        elif len(desc) > 300:
            errores["descripcion"] = ["Maximo 300 caracteres."]
        else:
            out["descripcion"] = desc

    if titulo:
        # Un titulo no lleva nada mas. Guardarle unidad o precio en silencio
        # dejaria una fila que suma a sus hijos y ademas tiene precio propio.
        return out

    unidad = (datos.get("unidad") or "").strip()
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


def _ruta_bajo(padre):
    """La ruta de un hijo: la del padre mas el padre.

    Es el mismo campo que usa la escalera del parte diario, asi que lo que se
    escriba aqui se recorre con el codigo de siempre.
    """
    if padre is None:
        return []
    base = padre.ruta
    if isinstance(base, str):
        try:
            base = json.loads(base or "[]")
        except ValueError:
            base = []
    if not isinstance(base, list):
        base = []
    return base + [[padre.codigo, padre.descripcion]]


def _ruta_hasta(pro, codigo):
    """La ruta que le toca a un hijo de ese codigo, EXISTA O NO como fila.

    En un presupuesto importado los titulos no son filas: existen solo dentro
    de la `ruta` de sus partidas, que es como los guardo el importador.
    Obras10_6 tiene 39 capitulos y ni uno es una fila. Si para colgar algo
    hiciera falta un id, no se podria anadir nada a un presupuesto importado,
    que es justo cuando hace falta.

    Pero la informacion esta: se busca cualquier partida que lleve ese codigo
    en su ruta y se corta la ruta ahi mismo, incluyendolo. Eso es exactamente
    la ruta que debe llevar un hermano de esa partida.

    Devuelve None si ese codigo no aparece en ninguna ruta ni como fila: no
    existe, y colgar algo de un capitulo inventado dejaria una rama suelta
    que la escalera del parte no sabria recorrer.
    """
    fila = pro.partidas.filter(codigo=codigo).first()
    if fila is not None:
        return _ruta_bajo(fila)

    for r in pro.partidas.values_list("ruta", flat=True):
        if not r:
            continue
        try:
            camino = json.loads(r)
        except (ValueError, TypeError):
            continue
        if not isinstance(camino, list):
            continue
        for i, tramo in enumerate(camino):
            if isinstance(tramo, list) and tramo and tramo[0] == codigo:
                return camino[:i + 1]
    return None


def _fila(p):
    return {
        "id": p.id, "codigo": p.codigo, "descripcion": p.descripcion,
        "unidad": p.unidad, "metrado": float(p.metrado or 0),
        "precio": float(p.precio or 0),
        "es_titulo": bool(getattr(p, "es_titulo", False)),
        "ruta": p.ruta,
    }


@api_view(["POST"])
@permission_classes([AllowAny])
def presupuesto_alta(request, pk):
    """Crea un titulo o una partida en el presupuesto de este proyecto."""
    try:
        pro = Proyecto.objects.get(pk=pk)
    except Proyecto.DoesNotExist:
        return Response({"detail": "No existe el proyecto."},
                        status=status.HTTP_404_NOT_FOUND)

    tipo = (request.data.get("tipo") or "partida").strip().lower()
    if tipo not in ("titulo", "partida"):
        return Response({"tipo": ["Tiene que ser 'titulo' o 'partida'."]},
                        status=status.HTTP_400_BAD_REQUEST)
    es_titulo = tipo == "titulo"

    # ── de quien cuelga ──
    # Por id cuando lo hay -un titulo escrito a mano es una fila- y por
    # codigo cuando no -los del Excel no lo son-. El codigo basta: de el sale
    # el correlativo del hijo y de el sale su ruta.
    padre = None
    padre_cod = None
    padre_id = request.data.get("padre")
    if padre_id not in (None, "", "null"):
        padre = pro.partidas.filter(pk=padre_id).first()
        if padre is None:
            return Response({"padre": ["Ese titulo no es de este proyecto."]},
                            status=status.HTTP_400_BAD_REQUEST)
        if not getattr(padre, "es_titulo", False):
            return Response(
                {"padre": ["Solo se puede colgar de un titulo. '%s' es una "
                           "partida." % padre.codigo]},
                status=status.HTTP_400_BAD_REQUEST)
        padre_cod = padre.codigo
        ruta_hijo = _ruta_bajo(padre)
    else:
        cod = (request.data.get("padre_codigo") or "").strip()
        if cod:
            ruta_hijo = _ruta_hasta(pro, cod)
            if ruta_hijo is None:
                return Response(
                    {"padre": ["No encuentro el capitulo '%s' en este "
                               "presupuesto." % cod]},
                    status=status.HTTP_400_BAD_REQUEST)
            # Una PARTIDA con ese codigo no es un capitulo: colgarle algo la
            # dejaria con metrado propio y ademas hijos que suman.
            suya = pro.partidas.filter(codigo=cod).first()
            if suya is not None and not getattr(suya, "es_titulo", False):
                return Response(
                    {"padre": ["Solo se puede colgar de un titulo. '%s' es "
                               "una partida." % cod]},
                    status=status.HTTP_400_BAD_REQUEST)
            padre_cod = cod
        else:
            ruta_hijo = []

    errores = {}
    campos = _lee_campos(request.data, errores, titulo=es_titulo)
    if errores:
        return Response(errores, status=status.HTTP_400_BAD_REQUEST)

    p = Partida.objects.create(
        proyecto_ref=pro,
        obra=pro.codigo,
        proyecto=(pro.nombre or "")[:300],
        codigo=_siguiente_codigo(pro, padre_cod),
        es_titulo=es_titulo,
        unidad=campos.get("unidad", ""),
        metrado=campos.get("metrado", 0),
        precio=campos.get("precio", 0),
        descripcion=campos["descripcion"],
        ruta=json.dumps(ruta_hijo),
        activo=True)
    return Response(_fila(p), status=status.HTTP_201_CREATED)


@api_view(["PATCH", "DELETE"])
@permission_classes([AllowAny])
def presupuesto_detalle(request, pk, partida_id):
    """Corrige o quita una fila del presupuesto de este proyecto."""
    try:
        pro = Proyecto.objects.get(pk=pk)
    except Proyecto.DoesNotExist:
        return Response({"detail": "No existe el proyecto."},
                        status=status.HTTP_404_NOT_FOUND)

    p = pro.partidas.filter(pk=partida_id).first()
    if p is None:
        return Response({"detail": "Esa partida no es de este proyecto."},
                        status=status.HTTP_404_NOT_FOUND)

    es_titulo = bool(getattr(p, "es_titulo", False))

    if request.method == "PATCH":
        errores = {}
        campos = _lee_campos(request.data, errores, titulo=es_titulo,
                             obligatorios=False)
        if errores:
            return Response(errores, status=status.HTTP_400_BAD_REQUEST)
        for k, v in campos.items():
            setattr(p, k, v)
        p.save()
        # Si se renombro un titulo, la ruta copiada en sus hijos se quedo con
        # el texto viejo: el nombre nuevo saldria arriba y el viejo en la
        # escalera del parte, sin forma de saber cual es el bueno.
        if es_titulo and "descripcion" in campos:
            _repasar_rutas(pro, p)
        return Response(_fila(p))

    # DELETE
    hijos = pro.partidas.filter(codigo__startswith=p.codigo + ".").count()
    if hijos:
        return Response({
            "detail": "No se puede quitar: '%s' tiene %d fila(s) colgando. "
                      "Quitalas primero." % (p.codigo, hijos),
            "hijos": hijos,
        }, status=status.HTTP_409_CONFLICT)

    usos = DailyPartActivity.objects.filter(partida_id=p.pk).count()
    if usos:
        return Response({
            "detail": "No se puede quitar: %d parte(s) ya le imputaron "
                      "metrado. Si el metrado estaba mal, corrigelo en la "
                      "partida en vez de borrarla." % usos,
            "partes": usos,
        }, status=status.HTTP_409_CONFLICT)

    p.delete()
    return Response(status=status.HTTP_204_NO_CONTENT)


def _repasar_rutas(pro, titulo):
    """Refresca el texto del titulo dentro de la ruta de sus descendientes."""
    for h in pro.partidas.filter(codigo__startswith=titulo.codigo + "."):
        r = h.ruta
        if isinstance(r, str):
            try:
                r = json.loads(r or "[]")
            except ValueError:
                continue
        if not isinstance(r, list):
            continue
        cambio = False
        for tramo in r:
            if isinstance(tramo, list) and len(tramo) == 2 \\
                    and tramo[0] == titulo.codigo:
                tramo[1] = titulo.descripcion
                cambio = True
        if cambio:
            h.ruta = json.dumps(r)
            h.save(update_fields=["ruta"])
'''


# ══════════════════════════════════════════════════════════════════════════
# PIEZA 4 · las rutas
# ══════════════════════════════════════════════════════════════════════════

IMPORT = ("from .views_presupuesto import (\n"
          "    presupuesto_alta, presupuesto_detalle,\n"
          ")\n")

RUTA = ("    # Escribir el presupuesto a mano, cuando no hay Excel que\n"
        "    # importar. El importador no sirve: rechaza las filas sin\n"
        "    # unidad, y un titulo no la tiene.\n"
        "    path('proyectos/<int:pk>/partidas/', presupuesto_alta,\n"
        "         name='presupuesto-alta'),\n"
        "    path('proyectos/<int:pk>/partidas/<int:partida_id>/',\n"
        "         presupuesto_detalle, name='presupuesto-detalle'),\n")


def paso_urls(texto):
    if "views_presupuesto" in texto:
        return texto, "ya estaban: las rutas del presupuesto"
    m = re.search(r"^urlpatterns\s*=\s*\[", texto, re.M)
    if not m:
        return None, "no encuentro urlpatterns = [ en urls.py"
    if "proyectos/" not in texto:
        return None, ("urls.py no tiene las rutas de proyectos; aplica antes "
                      "parche_proyectos.py")
    nuevo = (texto[:m.start()] + IMPORT + "\n"
             + texto[m.start():m.end()] + "\n" + RUTA
             + texto[m.end():])
    return nuevo, "anadidas las dos rutas"


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
    f_models = os.path.join(app, "models.py")
    f_proy = os.path.join(app, "views_proyectos.py")
    f_part = os.path.join(app, "views_partidas.py")
    f_vista = os.path.join(app, "views_presupuesto.py")
    f_urls = os.path.join(app, "urls.py")

    print("proyecto: %s" % base)
    print("modo    : %s" % ("APLICAR" if APLICAR else "solo mostrar"))
    print("")

    for f in (f_models, f_urls):
        if not os.path.isfile(f):
            print("MAL  no encuentro %s" % f)
            return 1
    if not os.path.isfile(f_proy):
        print("MAL  no existe %s" % f_proy)
        print("     Aplica antes parche_proyectos.py.")
        return 1

    txt_m = io.open(f_models, encoding="utf-8").read()
    txt_p = io.open(f_proy, encoding="utf-8").read()
    txt_u = io.open(f_urls, encoding="utf-8").read()
    txt_s = io.open(f_part, encoding="utf-8").read() if os.path.isfile(f_part) else None

    nuevo_m, av_m = paso_modelo(txt_m)
    nuevo_p, av_p = paso_conteo(txt_p)
    nuevo_u, av_u = paso_urls(txt_u)
    if txt_s is None:
        nuevo_s, av_s = None, "no encuentro views_partidas.py"
    else:
        nuevo_s, av_s = paso_serializer(txt_s)
    vista_existe = os.path.isfile(f_vista)
    av_v = ("ya estaba: views_presupuesto.py" if vista_existe
            else "se crea views_presupuesto.py")

    print("1. models.py             %s" % av_m)
    print("2. views_proyectos.py    %s" % av_p)
    print("2b. views_partidas.py   %s" % av_s)
    print("3. views_presupuesto.py  %s" % av_v)
    print("4. urls.py               %s" % av_u)
    print("")

    fallos = []
    for quien, nuevo, av in (("models.py", nuevo_m, av_m),
                             ("views_proyectos.py", nuevo_p, av_p),
                             ("views_partidas.py", nuevo_s, av_s),
                             ("urls.py", nuevo_u, av_u)):
        if nuevo is None:
            fallos.append("%s: %s" % (quien, av))

    if fallos:
        print("NO SE ESCRIBE NADA. A medias es peor que sin empezar:")
        for f in fallos:
            print("   - %s" % f)
        print("")
        print("Mandame esta salida y lo ajusto.")
        return 1

    # Se comprueba el RESULTADO, no la intencion.
    for quien, txt, falta in (
            ("models.py", nuevo_m, "es_titulo"),
            ("views_proyectos.py", nuevo_p, "es_titulo=False"),
            ("views_partidas.py", nuevo_s, '"es_titulo"'),
            ("urls.py", nuevo_u, "presupuesto_alta")):
        if falta not in txt:
            print("NO SE ESCRIBE NADA: en %s no salio %r." % (quien, falta))
            return 1

    if not APLICAR:
        print("Nada tocado. Para aplicarlo:")
        print("    python3 %s --aplicar" % os.path.basename(__file__))
        return 0

    escritos = []
    for ruta, viejo, nuevo, nombre in (
            (f_models, txt_m, nuevo_m, "models.py"),
            (f_proy, txt_p, nuevo_p, "views_proyectos.py"),
            (f_part, txt_s, nuevo_s, "views_partidas.py"),
            (f_urls, txt_u, nuevo_u, "urls.py")):
        if nuevo != viejo:
            print("respaldo %s" % respaldo(ruta))
            io.open(ruta, "w", encoding="utf-8").write(nuevo)
            escritos.append(nombre)
    if not vista_existe:
        io.open(f_vista, "w", encoding="utf-8").write(VISTA)
        escritos.append("views_presupuesto.py")

    print("")
    print("escrito: %s" % (", ".join(escritos) if escritos else "nada, ya estaba"))
    print("")
    if "models.py" in escritos:
        print("Hay migracion -un campo nuevo, aditivo, default False-:")
        print("    docker compose exec web python manage.py makemigrations operations")
        print("    docker compose exec web python manage.py migrate")
    else:
        print("No hay migracion: es_titulo ya estaba.")
    print("    docker compose up -d --no-deps --force-recreate web")
    return 0


if __name__ == "__main__":
    sys.exit(principal())
