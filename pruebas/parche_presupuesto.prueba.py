# -*- coding: utf-8 -*-
"""Escribir el presupuesto de un proyecto a mano: que el parche lo monte bien.

    python3 -I pruebas/parche_presupuesto.prueba.py

Lo que mas importa, por orden:

1. QUE CONVIVA CON EL PARCHE DE INCIDENCIAS. Los dos anaden Partida.es_titulo.
   Correr los dos, en cualquier orden, no puede duplicar el campo: un campo
   repetido no falla al escribirlo, falla al arrancar Django, con el
   contenedor ya caido.
2. QUE LAS CUENTAS SE CORRAN, no se lean. El correlativo jerarquico es la
   pieza que choca contra UniqueConstraint(obra, codigo) si se equivoca.
3. QUE SE NIEGUE SIN DEJAR NADA A MEDIAS cuando falta un parche anterior.
"""
from __future__ import print_function

import ast
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

AQUI = os.path.dirname(os.path.abspath(__file__))
PRE = os.path.join(AQUI, "parche_presupuesto_proyecto.py")
UNO = os.path.join(AQUI, "parche_partidas_de_incidencia.py")
DOS = os.path.join(AQUI, "parche_partidas_propias_incidencia.py")

MODELS = '''from django.db import models


class Proyecto(models.Model):
    codigo = models.CharField(max_length=60)
    nombre = models.CharField(max_length=300)


class Partida(models.Model):
    proyecto_ref = models.ForeignKey('Proyecto', on_delete=models.CASCADE,
                                     related_name='partidas', null=True)
    obra = models.CharField(max_length=120)
    codigo = models.CharField(max_length=40)
    descripcion = models.CharField(max_length=300)
    unidad = models.CharField(max_length=12, blank=True, default="")
    ruta = models.TextField("Ruta en el presupuesto (JSON)", blank=True, default="")
    activo = models.BooleanField(default=True)


class IncidentReport(models.Model):
    code = models.CharField(max_length=40)
    description = models.TextField(blank=True)


class DailyPartActivity(models.Model):
    partida = models.ForeignKey(Partida, on_delete=models.CASCADE,
                                related_name="actividades")
'''

PROY = '''from rest_framework import serializers
from .models import Proyecto


class ProyectoSerializer(serializers.ModelSerializer):
    partidas = serializers.SerializerMethodField()

    class Meta:
        model = Proyecto
        fields = ["id", "codigo", "nombre", "partidas"]

    def get_partidas(self, obj):
        return obj.partidas.filter(activo=True).count()
'''

PART = '''from rest_framework import serializers
from .models import Partida


class PartidaSerializer(serializers.ModelSerializer):
    total = serializers.SerializerMethodField()

    class Meta:
        model = Partida
        fields = ["id", "obra", "proyecto", "codigo", "descripcion", "unidad",
                  "metrado", "precio", "estructura", "grupo", "ruta",
                  "activo", "total"]
'''

URLS = '''from django.urls import path, include

from .views import reabrir_incidente
from .views_proyectos import proyectos

urlpatterns = [
    path('proyectos/', proyectos),
    path('incidentes/<int:incident_id>/reabrir/', reabrir_incidente),
]
'''

mal = [0]; bien = [0]


def t(etiqueta, ok, extra=""):
    if ok:
        bien[0] += 1
        return
    mal[0] += 1
    print("MAL  %s%s" % (etiqueta, ("   [%s]" % extra) if extra else ""))


def monta(base, models=MODELS):
    app = os.path.join(base, "operations")
    os.makedirs(app)
    io.open(os.path.join(app, "models.py"), "w", encoding="utf-8").write(models)
    io.open(os.path.join(app, "views_proyectos.py"), "w", encoding="utf-8").write(PROY)
    io.open(os.path.join(app, "views_partidas.py"), "w", encoding="utf-8").write(PART)
    io.open(os.path.join(app, "urls.py"), "w", encoding="utf-8").write(URLS)
    return app


def corre(parche, base, aplicar=True):
    cmd = [sys.executable, "-I", parche, "--base", base]
    if aplicar:
        cmd.append("--aplicar")
    r = subprocess.run(cmd, capture_output=True, text=True)
    return r.returncode, r.stdout + r.stderr


def lee(app, n):
    r = os.path.join(app, n)
    return io.open(r, encoding="utf-8").read() if os.path.isfile(r) else ""


# ── 1. Aplica ─────────────────────────────────────────────────────────────
tmp = tempfile.mkdtemp()
app = monta(tmp)
c, s = corre(PRE, tmp)
t("aplica", c == 0, s.strip()[-250:])

m, pr, v, u = (lee(app, "models.py"), lee(app, "views_proyectos.py"),
               lee(app, "views_presupuesto.py"), lee(app, "urls.py"))
for n, txt in (("models.py", m), ("views_proyectos.py", pr),
               ("views_presupuesto.py", v), ("urls.py", u)):
    if not txt:
        t("%s existe" % n, False); continue
    try:
        ast.parse(txt); t("%s es Python valido" % n, True)
    except SyntaxError as e:
        t("%s es Python valido" % n, False, str(e))

t("Partida gana es_titulo", "es_titulo = models.BooleanField" in m)
t("el conteo de partidas deja fuera los titulos",
  "activo=True, es_titulo=False" in pr)
pa = lee(app, "views_partidas.py")
t("PartidaSerializer devuelve es_titulo", '"es_titulo"' in pa)
t("y entra dentro de Meta.fields, no suelto",
  '"es_titulo"' in pa.split("fields = [")[1].split("]")[0])
t("sin perder ningun campo que ya estaba",
  all(c in pa for c in ('"ruta"', '"activo"', '"total"', '"metrado"')))
try:
    ast.parse(pa); t("views_partidas.py sigue siendo valido", True)
except SyntaxError as e:
    t("views_partidas.py sigue siendo valido", False, str(e))

t("existe el alta", "def presupuesto_alta" in v)
t("y el detalle", "def presupuesto_detalle" in v)
t("cuelga del proyecto por proyecto_ref", "proyecto_ref=pro" in v)
t("y escribe obra = codigo del proyecto", "obra=pro.codigo" in v)
t("no se borra un titulo con hijos", "fila(s) colgando" in v)
t("ni lo que tiene metrado imputado",
  "DailyPartActivity.objects.filter(partida_id=p.pk).count()" in v)
t("ni se cuelga de una partida", "Solo se puede colgar de un titulo" in v)
t("al renombrar un titulo se repasa la ruta", "def _repasar_rutas" in v)
t("urls.py registra las dos rutas",
  "path('proyectos/<int:pk>/partidas/', presupuesto_alta" in u
  and "partidas/<int:partida_id>/" in u)
t("y la de detalle va DESPUES de la de alta",
  u.index("partidas/', presupuesto_alta") < u.index("partidas/<int:partida_id>/"))


# ── 1b. El correlativo, CORRIENDOLO ───────────────────────────────────────
def saca(fuente, nombre):
    ini = fuente.index("def %s(" % nombre)
    resto = fuente[ini:]
    corte = len(resto)
    for marca in ("\ndef ", "\n@", "\nclass "):
        q = resto.find(marca, 1)
        if q != -1:
            corte = min(corte, q)
    return resto[:corte]


class _Obj(object):
    def __init__(self, **kw):
        self.__dict__.update(kw)


def cod(codigos, padre):
    ns = {"re": re, "json": json}
    for f in ("_tramos", "_nivel", "_siguiente_codigo", "_ruta_bajo"):
        exec(saca(v, f), ns)
    pro = _Obj(partidas=_Obj(values_list=lambda c, flat=False: list(codigos)))
    return ns["_siguiente_codigo"](pro, padre)


t("sin nada, el primero es 01", cod([], None) == "01", cod([], None))
t("con 01 y 02, sigue el 03", cod(["01", "02"], None) == "03", cod(["01", "02"], None))
t("bajo el 01, el primer hijo es 01.01", cod(["01"], "01") == "01.01", cod(["01"], "01"))
t("borrado el 01.02 de tres, NO repite uno que existe",
  cod(["01", "01.01", "01.03"], "01") == "01.04", cod(["01", "01.01", "01.03"], "01"))
t("los hermanos de otra rama no cuentan",
  cod(["01", "02", "02.07", "01.01"], "01") == "01.02",
  cod(["01", "02", "02.07", "01.01"], "01"))
t("ni los nietos", cod(["01", "01.01", "01.01.09"], "01") == "01.02",
  cod(["01", "01.01", "01.01.09"], "01"))

# ── _ruta_hasta: colgar de un capitulo QUE NO ES FILA ────────────────────
#
# Es el caso real de Obras10_6: 39 capitulos y ni uno es una fila. Si para
# colgar algo hiciera falta un id, no se podria anadir nada a un presupuesto
# importado, que es justo cuando hace falta.
class _QS(list):
    def values_list(self, campo, flat=False):
        return [getattr(x, campo) for x in self]

    def filter(self, **kw):
        out = [x for x in self
               if all(getattr(x, k, None) == w for k, w in kw.items())]
        return _QS(out)

    def first(self):
        return self[0] if self else None


def entorno_ruta(filas):
    ns = {"re": re, "json": json}
    for f in ("_tramos", "_nivel", "_ruta_bajo", "_ruta_hasta"):
        exec(saca(v, f), ns)
    return ns, _Obj(partidas=_QS(filas))


CAMINO = json.dumps([["01", "ESTRUCTURAS"], ["01.02", "OBRAS PROVISIONALES"]])
IMPORTADAS = [
    _Obj(codigo="01.02.01", descripcion="Almacen", ruta=CAMINO, es_titulo=False),
    _Obj(codigo="01.02.02", descripcion="Seguridad", ruta=CAMINO, es_titulo=False),
]
ns_r, pro_r = entorno_ruta(IMPORTADAS)
r = ns_r["_ruta_hasta"](pro_r, "01.02")
t("se puede colgar de un capitulo que NO es fila",
  r == [["01", "ESTRUCTURAS"], ["01.02", "OBRAS PROVISIONALES"]], str(r))
r2 = ns_r["_ruta_hasta"](pro_r, "01")
t("y de uno de mas arriba, cortando la ruta ahi",
  r2 == [["01", "ESTRUCTURAS"]], str(r2))
t("un capitulo inventado no cuela",
  ns_r["_ruta_hasta"](pro_r, "07") is None)

# Si el capitulo SI es fila -escrito a mano-, manda la fila.
PROPIO = [_Obj(codigo="05", descripcion="A MANO", ruta="[]", es_titulo=True)]
ns_p, pro_p = entorno_ruta(PROPIO)
t("si el capitulo es fila, la ruta sale de el",
  ns_p["_ruta_hasta"](pro_p, "05") == [["05", "A MANO"]],
  str(ns_p["_ruta_hasta"](pro_p, "05")))

# Una ruta rota en una fila no puede tumbar el alta de otra.
ROTAS = [_Obj(codigo="01.01", descripcion="X", ruta="{roto", es_titulo=False)] + IMPORTADAS
ns_x, pro_x = entorno_ruta(ROTAS)
t("una ruta rota se salta, no tumba la busqueda",
  ns_x["_ruta_hasta"](pro_x, "01.02") is not None)

ns = {"re": re, "json": json}
exec(saca(v, "_ruta_bajo"), ns)
t("la ruta de la raiz esta vacia", ns["_ruta_bajo"](None) == [])
t("la de un hijo lleva a su padre",
  ns["_ruta_bajo"](_Obj(codigo="01", descripcion="CAP", ruta="")) == [["01", "CAP"]])
t("una ruta rota no tumba el alta",
  ns["_ruta_bajo"](_Obj(codigo="01", descripcion="X", ruta="{roto")) == [["01", "X"]])


# ── 2. Dos pasadas no duplican ────────────────────────────────────────────
c2, s2 = corre(PRE, tmp)
t("la segunda pasada termina bien", c2 == 0, s2.strip()[-200:])
t("y dice que ya estaba", "ya estaba" in s2)
t("es_titulo no se duplica en el serializer",
  lee(app, "views_partidas.py").count('"es_titulo"') == 1,
  str(lee(app, "views_partidas.py").count('"es_titulo"')))
t("es_titulo no se duplica",
  lee(app, "models.py").count("es_titulo = models.BooleanField") == 1)
t("ni las rutas", lee(app, "urls.py").count("presupuesto_alta") == 2,
  "import + path = 2")


# ── 3. CONVIVE CON EL PARCHE DE INCIDENCIAS, en los dos ordenes ──────────
for orden, cuales in (("presupuesto primero", [PRE, UNO, DOS]),
                      ("incidencias primero", [UNO, DOS, PRE])):
    d = tempfile.mkdtemp()
    a = monta(d)
    codigos = [corre(x, d)[0] for x in cuales]
    t("%s: los tres aplican" % orden, all(x == 0 for x in codigos), str(codigos))
    mm = lee(a, "models.py")
    t("%s: es_titulo UNA sola vez" % orden,
      mm.count("es_titulo = models.BooleanField") == 1,
      str(mm.count("es_titulo = models.BooleanField")))
    t("%s: Partida.partidas no se duplica" % orden,
      mm.count("partidas = models.ManyToManyField") == 1)
    try:
        ast.parse(mm); t("%s: models.py valido" % orden, True)
    except SyntaxError as e:
        t("%s: models.py valido" % orden, False, str(e))
    t("%s: urls.py tiene las rutas de los dos" % orden,
      "presupuesto_alta" in lee(a, "urls.py")
      and "incidencia_partida_alta" in lee(a, "urls.py"))
    shutil.rmtree(d, ignore_errors=True)


# ── 4. Sin parche_proyectos, se niega ─────────────────────────────────────
tmpS = tempfile.mkdtemp()
appS = os.path.join(tmpS, "operations")
os.makedirs(appS)
io.open(os.path.join(appS, "models.py"), "w", encoding="utf-8").write(
    MODELS.replace("    proyecto_ref = models.ForeignKey('Proyecto', on_delete=models.CASCADE,\n"
                   "                                     related_name='partidas', null=True)\n", ""))
io.open(os.path.join(appS, "views_proyectos.py"), "w", encoding="utf-8").write(PROY)
io.open(os.path.join(appS, "views_partidas.py"), "w", encoding="utf-8").write(PART)
io.open(os.path.join(appS, "urls.py"), "w", encoding="utf-8").write(URLS)
cS, sS = corre(PRE, tmpS)
t("sin proyecto_ref, falla", cS != 0, sS.strip()[-200:])
t("sin estrellarse", "Traceback" not in sS, sS.strip()[-300:])
t("y nombra parche_proyectos", "parche_proyectos" in sS)
t("sin crear la vista",
  not os.path.isfile(os.path.join(appS, "views_presupuesto.py")))

# ── 5. Sin --aplicar no escribe ───────────────────────────────────────────
tmpD = tempfile.mkdtemp()
appD = monta(tmpD)
cD, sD = corre(PRE, tmpD, aplicar=False)
t("en seco termina bien", cD == 0, sD.strip()[-200:])
t("y no crea la vista",
  not os.path.isfile(os.path.join(appD, "views_presupuesto.py")))
t("ni toca models.py", "es_titulo" not in lee(appD, "models.py"))

for d in (tmp, tmpS, tmpD):
    shutil.rmtree(d, ignore_errors=True)

print("\n%d comprobacion(es) en orden%s." % (bien[0], ", %d MAL" % mal[0] if mal[0] else ""))
sys.exit(1 if mal[0] else 0)
