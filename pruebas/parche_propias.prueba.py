# -*- coding: utf-8 -*-
"""El presupuesto en arbol de una incidencia: que el parche lo monte bien.

    python3 -I pruebas/parche_propias.prueba.py

ENCADENA LOS DOS PARCHES DE VERDAD. Monta un proyecto de mentira, le corre
parche_partidas_de_incidencia.py y encima
parche_partidas_propias_incidencia.py, y mira lo que queda.

Se hace asi, y no con un views_incidentes.py escrito a mano, porque lo que
puede romperse es justo la costura: el segundo parche REEMPLAZA el
get_partidas_detalle que escribio el primero y le mete imports al lado de los
suyos. Un mock escrito a mano los tendria siempre perfectos y la prueba
pasaria aunque el primer parche cambiara de forma.

LO QUE MAS IMPORTA, por orden:

1. Que el resultado sea Python valido. Se reescribe un metodo dentro de una
   clase ya escrita por otro guion; un corte mal puesto deja media funcion.
2. Que las cuentas del arbol se CORRAN, no se lean. El codigo jerarquico y
   el orden por numero son las dos piezas que fallan en silencio: un codigo
   repetido revienta contra UniqueConstraint y un orden alfabetico pone el
   01.10 antes del 01.9 sin que nada falle.
3. Que correrlo dos veces no duplique el bloque, y que correrlo SOBRE LA
   VERSION VIEJA lo reemplace en vez de dejar las dos.
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
UNO = os.path.join(AQUI, "parche_partidas_de_incidencia.py")
DOS = os.path.join(AQUI, "parche_partidas_propias_incidencia.py")

MODELS = '''from django.db import models


class Partida(models.Model):
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

# Sin 'ruta': el arbol no tiene donde colgar los niveles.
MODELS_SIN_RUTA = MODELS.replace(
    '    ruta = models.TextField("Ruta en el presupuesto (JSON)", blank=True, default="")\n', '')

URLS = '''from django.urls import path, include
from rest_framework.routers import DefaultRouter

from .views import reabrir_incidente

router = DefaultRouter()

urlpatterns = [
    path('incidentes/<int:incident_id>/reabrir/', reabrir_incidente),
    path('', include(router.urls)),
]
'''

mal = [0]
bien = [0]


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


def sin_traza(s):
    return "Traceback" not in s


# ── 1. Los dos encadenados ────────────────────────────────────────────────
tmp = tempfile.mkdtemp()
app = monta(tmp)
c1, s1 = corre(UNO, tmp)
t("el primer parche aplica", c1 == 0, s1.strip()[-200:])
c2, s2 = corre(DOS, tmp)
t("el segundo tambien", c2 == 0, s2.strip()[-300:])

m = lee(app, "models.py")
v = lee(app, "views_incidentes.py")
u = lee(app, "urls.py")

for n, txt in (("models.py", m), ("views_incidentes.py", v), ("urls.py", u)):
    if not txt:
        t("%s existe" % n, False)
        continue
    try:
        ast.parse(txt)
        t("%s es Python valido" % n, True)
    except SyntaxError as e:
        t("%s es Python valido" % n, False, str(e))

t("Partida gana es_titulo", "es_titulo = models.BooleanField" in m)
t("y por defecto NO lo es", "default=False" in m.split("es_titulo")[1][:80])

t("existe el alta", "def incidencia_partida_alta" in v)
t("y una sola vez", v.count("def incidencia_partida_alta") == 1,
  str(v.count("def incidencia_partida_alta")))
t("existe el detalle", "def incidencia_partida_detalle" in v)
t("el detalle del serializer se reescribio en arbol",
  '"es_titulo": titulo' in v and "_nivel(p.codigo)" in v)
t("y get_partidas_detalle no se duplico",
  v.count("def get_partidas_detalle") == 1,
  str(v.count("def get_partidas_detalle")))
t("get_presupuestado sigue entero", "def get_presupuestado" in v
  and v.count("def get_presupuestado") == 1)
t("json y re se importan", "import json" in v and "import re" in v)
t("Partida entra en el import de .models",
  "from .models import DailyPartActivity, IncidentReport, Partida" in v)

# ── las reglas que no se pueden perder ──
t("un titulo no puede colgar de una partida",
  "Solo se puede colgar de un titulo" in v
  and 'if not getattr(padre, "es_titulo", False):' in v)

t("el arbol se ordena por NUMERO, no por texto",
  "key=lambda p: _orden(p.codigo)" in v,
  "sin _orden, el 01.10 sale antes que el 01.9 y nada falla")


def guarda_que_corta(fuente, funcion, variable):
    """¿Esa funcion tiene un `if <variable>:` que corta con un return?

    Se mira el arbol sintactico y no el texto a proposito. Al sabotear el
    parche cambiando `if hijos:` por `if False:`, la prueba seguia en verde:
    el mensaje de error estaba en el fichero igual, solo que inalcanzable.
    Buscar la cadena comprueba que alguien la escribio, no que se ejecute.
    """
    arbol = ast.parse(fuente)
    for n in ast.walk(arbol):
        if isinstance(n, ast.FunctionDef) and n.name == funcion:
            for x in ast.walk(n):
                if not isinstance(x, ast.If):
                    continue
                nombres = {y.id for y in ast.walk(x.test)
                           if isinstance(y, ast.Name)}
                if variable in nombres and any(
                        isinstance(z, ast.Return) for z in ast.walk(x)):
                    return True
    return False


t("no se borra un titulo con hijos -el guardarrail se EJECUTA-",
  guarda_que_corta(v, "incidencia_partida_detalle", "hijos")
  and "fila(s) colgando" in v)
t("ni una partida con partes imputados",
  guarda_que_corta(v, "incidencia_partida_detalle", "usos"))
t("ni se guarda un alta con errores",
  guarda_que_corta(v, "incidencia_partida_alta", "errores"))
t("no se borra lo que tiene metrado imputado",
  "DailyPartActivity.objects.filter(partida_id=p.pk).count()" in v)
t("el total de un titulo se SUMA de sus hijos",
  'cod.startswith(p.codigo + ".")' in v)
t("y un titulo no trae metrado ni precio propios",
  '"metrado": None' in v and '"precio": None' in v)
t("al renombrar un titulo se repasa la ruta de sus hijos",
  "def _repasar_rutas" in v)

# ── las rutas ──
t("urls.py importa las dos vistas",
  "incidencia_partida_alta" in u and "incidencia_partida_detalle" in u)
t("la ruta de alta",
  "path('incidentes/<int:pk>/partidas/', incidencia_partida_alta" in u)
t("la de detalle va DESPUES, no la tapa",
  u.index("partidas/', incidencia_partida_alta")
  < u.index("partidas/<int:partida_id>/'"))


# ── 1b. LAS CUENTAS, CORRIENDOLAS ─────────────────────────────────────────
#
# Hasta aqui solo se ha mirado que el texto este. Esto lo ejecuta.
def saca(fuente, nombre):
    ini = fuente.index("def %s(" % nombre)
    resto = fuente[ini:]
    corte = len(resto)
    for marca in ("\ndef ", "\n@", "\nclass ", "\n# "):
        p = resto.find(marca, 1)
        if p != -1:
            corte = min(corte, p)
    return resto[:corte]


class _QS(list):
    def values_list(self, campo, flat=False):
        return [getattr(x, campo) for x in self]


class _Obj(object):
    def __init__(self, **kw):
        self.__dict__.update(kw)


def entorno(codigos=()):
    ns = {"re": re, "json": json}
    for f in ("_tramos", "_nivel", "_padre", "_orden", "_siguiente_codigo",
              "_obra_de", "_ruta_bajo"):
        exec(saca(v, f), ns)
    filas = [_Obj(codigo=c) for c in codigos]
    ns["Partida"] = _Obj(objects=_Obj(filter=lambda **kw: _QS(filas)))
    return ns


E = entorno()
t("el nivel sale de los tramos",
  E["_nivel"]("01") == 1 and E["_nivel"]("01.02.03") == 3)
t("el padre tambien",
  E["_padre"]("01.02.03") == "01.02" and E["_padre"]("01") is None)

# El orden: lo que falla en silencio.
t("01.9 va ANTES que 01.10, no al reves",
  E["_orden"]("01.09") < E["_orden"]("01.10"))
t("y aunque el codigo venga sin rellenar -el Excel los trae asi-",
  E["_orden"]("1.9") < E["_orden"]("1.10"))
t("un tramo no numerico no tumba el orden",
  isinstance(E["_orden"]("01.AA"), list))

cod = lambda codigos, padre: entorno(codigos)["_siguiente_codigo"]("X", padre)
t("sin nada, el primero de la raiz es 01", cod([], None) == "01", cod([], None))
t("con 01 y 02 en la raiz, el siguiente es 03",
  cod(["01", "02"], None) == "03", cod(["01", "02"], None))
t("bajo el 01 vacio, el primer hijo es 01.01",
  cod(["01"], "01") == "01.01", cod(["01"], "01"))
t("bajo el 01 con un hijo, el siguiente es 01.02",
  cod(["01", "01.01"], "01") == "01.02", cod(["01", "01.01"], "01"))
# El caso que rompe contar en vez de mirar el mayor.
t("borrado el 01.02 de tres, NO devuelve uno que ya existe",
  cod(["01", "01.01", "01.03"], "01") == "01.04",
  cod(["01", "01.01", "01.03"], "01"))
# El caso que rompe mirar solo el ultimo tramo sin comprobar el prefijo.
t("los hermanos de OTRA rama no cuentan",
  cod(["01", "02", "02.07", "01.01"], "01") == "01.02",
  cod(["01", "02", "02.07", "01.01"], "01"))
t("ni los nietos",
  cod(["01", "01.01", "01.01.09"], "01") == "01.02",
  cod(["01", "01.01", "01.01.09"], "01"))

t("la obra es el codigo del incidente",
  E["_obra_de"](_Obj(code="INCIDENTE-002", pk=7)) == "INCIDENTE-002")
t("y si no lo tiene, su id",
  E["_obra_de"](_Obj(code="  ", pk=7)) == "INCIDENTE-7")

t("la ruta de un hijo de la raiz esta vacia", E["_ruta_bajo"](None) == [])
r1 = E["_ruta_bajo"](_Obj(codigo="01", descripcion="TRABAJOS", ruta=""))
t("la de un hijo del 01 lleva al 01", r1 == [["01", "TRABAJOS"]], str(r1))
r2 = E["_ruta_bajo"](_Obj(codigo="01.01", descripcion="MOV",
                          ruta=json.dumps([["01", "TRABAJOS"]])))
t("y la de un nieto arrastra el abuelo",
  r2 == [["01", "TRABAJOS"], ["01.01", "MOV"]], str(r2))
t("una ruta rota no tumba el alta",
  E["_ruta_bajo"](_Obj(codigo="01", descripcion="X", ruta="{roto")) ==
  [["01", "X"]])


# ── 2. Dos pasadas no duplican ────────────────────────────────────────────
c3, s3 = corre(DOS, tmp)
t("la segunda pasada termina bien", c3 == 0, s3.strip()[-250:])
v2, u2 = lee(app, "views_incidentes.py"), lee(app, "urls.py")
t("el alta no se duplica", v2.count("def incidencia_partida_alta") == 1,
  str(v2.count("def incidencia_partida_alta")))
t("ni el detalle del serializer",
  v2.count("def get_partidas_detalle") == 1,
  str(v2.count("def get_partidas_detalle")))
t("ni la marca del bloque", v2.count("parche v2") <= 2,
  str(v2.count("parche v2")))
t("ni es_titulo en el modelo",
  lee(app, "models.py").count("es_titulo = models.BooleanField") == 1)
t("ni la ruta", u2.count("incidencia_partida_alta") == 2,
  "import + path = 2, salieron %d" % u2.count("incidencia_partida_alta"))
t("sigue siendo Python valido", (lambda: (ast.parse(v2), True)[1])())

# ── 2b. Sobre la version VIEJA, se reemplaza ──────────────────────────────
# El usuario pudo aplicar la version plana antes que esta.
tmpV = tempfile.mkdtemp()
appV = monta(tmpV)
corre(UNO, tmpV)
viejo = lee(appV, "views_incidentes.py").rstrip("\n") + '''


# ══════════════════════════════════════════════════════════════════════════
# LAS PARTIDAS PROPIAS DE LA INCIDENCIA
# ══════════════════════════════════════════════════════════════════════════

def _obra_de(inc):
    return (inc.code or "").strip() or "INCIDENTE-%s" % inc.pk


@api_view(["POST"])
@permission_classes([AllowAny])
def incidencia_partida_alta(request, pk):
    return Response({})
'''
io.open(os.path.join(appV, "views_incidentes.py"), "w",
        encoding="utf-8").write(viejo)
cV, sV = corre(DOS, tmpV)
t("sobre la version vieja aplica", cV == 0, sV.strip()[-250:])
t("y dice que la reemplaza", "reemplazadas" in sV, sV.strip()[-200:])
vV = lee(appV, "views_incidentes.py")
t("queda UN solo incidencia_partida_alta",
  vV.count("def incidencia_partida_alta") == 1,
  str(vV.count("def incidencia_partida_alta")))
t("y UN solo _obra_de", vV.count("def _obra_de") == 1,
  str(vV.count("def _obra_de")))
t("sin el 'return Response({})' de la version vieja",
  "return Response({})" not in vV)
try:
    ast.parse(vV)
    t("y sigue siendo Python valido", True)
except SyntaxError as e:
    t("y sigue siendo Python valido", False, str(e))

# ── 3. Sin 'ruta' en Partida, se niega ────────────────────────────────────
tmpR = tempfile.mkdtemp()
appR = monta(tmpR, models=MODELS_SIN_RUTA)
corre(UNO, tmpR)
cR, sR = corre(DOS, tmpR)
t("sin el campo ruta, falla", cR != 0, sR.strip()[-200:])
t("sin estrellarse", sin_traza(sR), sR.strip()[-300:])
t("y manda aplicar parche_ruta_partida por su nombre",
  "parche_ruta_partida" in sR)
t("sin tocar models.py", "es_titulo" not in lee(appR, "models.py"))
t("ni urls.py", "incidencia_partida_alta" not in lee(appR, "urls.py"))

# ── 4. Sin el primer parche, se niega ─────────────────────────────────────
tmpS = tempfile.mkdtemp()
appS = monta(tmpS)
cS, sS = corre(DOS, tmpS)
t("sin el primer parche, falla", cS != 0, sS.strip()[-200:])
t("sin estrellarse", sin_traza(sS), sS.strip()[-300:])
t("y lo nombra", "parche_partidas_de_incidencia" in sS)
t("y no toca urls.py", "incidencia_partida_alta" not in lee(appS, "urls.py"))

# ── 5. Sin --aplicar no escribe ───────────────────────────────────────────
tmpD = tempfile.mkdtemp()
appD = monta(tmpD)
corre(UNO, tmpD)
cD, sD = corre(DOS, tmpD, aplicar=False)
t("en seco termina bien", cD == 0, sD.strip()[-200:])
t("y avisa de que no toco nada", "Nada tocado" in sD)
t("models.py sin es_titulo", "es_titulo" not in lee(appD, "models.py"))
t("views sin el alta",
  "incidencia_partida_alta" not in lee(appD, "views_incidentes.py"))
t("urls.py sin las rutas",
  "incidencia_partida_alta" not in lee(appD, "urls.py"))

for d in (tmp, tmpV, tmpR, tmpS, tmpD):
    shutil.rmtree(d, ignore_errors=True)

print("\n%d comprobacion(es) en orden%s." % (bien[0], ", %d MAL" % mal[0] if mal[0] else ""))
sys.exit(1 if mal[0] else 0)
