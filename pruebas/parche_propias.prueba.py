# -*- coding: utf-8 -*-
"""Que el parche de partidas propias se encadene bien con el anterior.

    python3 -I pruebas/parche_propias.prueba.py

ENCADENA LOS DOS PARCHES DE VERDAD. Monta un proyecto de mentira, le corre
primero parche_partidas_de_incidencia.py y encima
parche_partidas_propias_incidencia.py, y mira lo que queda.

Se hace asi, y no con un views_incidentes.py escrito a mano en la prueba,
porque lo que puede romperse es justo la costura: el segundo parche busca en
el fichero del primero el import de .models y el de Sum para colocar los
suyos. Un mock escrito a mano los tendria siempre perfectos y la prueba
pasaria aunque el primer parche cambiara de forma.

LO QUE MAS IMPORTA AQUI, por orden:

1. Que el resultado sea Python valido. Se anade codigo a un fichero ya
   escrito por otro guion; un import mal colocado no se nota hasta que el
   contenedor no arranca.
2. Que dos pasadas no dupliquen las vistas ni las rutas.
3. Que SIN el primer parche se niegue en vez de dejar un fichero a medias.
"""
from __future__ import print_function

import ast
import io
import os
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


class IncidentReport(models.Model):
    code = models.CharField(max_length=40)
    description = models.TextField(blank=True)


class DailyPartActivity(models.Model):
    partida = models.ForeignKey(Partida, on_delete=models.CASCADE,
                                related_name="actividades")
'''

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


def monta(base):
    app = os.path.join(base, "operations")
    os.makedirs(app)
    io.open(os.path.join(app, "models.py"), "w", encoding="utf-8").write(MODELS)
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
    if not os.path.isfile(r):
        return ""
    return io.open(r, encoding="utf-8").read()


def sin_traza(s):
    return "Traceback" not in s


# ── 1. Los dos encadenados ────────────────────────────────────────────────
tmp = tempfile.mkdtemp()
app = monta(tmp)
c1, s1 = corre(UNO, tmp)
t("el primer parche aplica", c1 == 0, s1.strip()[-200:])
c2, s2 = corre(DOS, tmp)
t("el segundo tambien", c2 == 0, s2.strip()[-250:])

v = lee(app, "views_incidentes.py")
u = lee(app, "urls.py")

for n, txt in (("views_incidentes.py", v), ("urls.py", u)):
    try:
        ast.parse(txt) if txt else None
        t("%s es Python valido" % n, bool(txt))
    except SyntaxError as e:
        t("%s es Python valido" % n, False, str(e))

# ── la vista ──
t("existe el alta", "def incidencia_partida_alta" in v)
t("y el detalle -editar y quitar-", "def incidencia_partida_detalle" in v)
t("el alta es POST", '@api_view(["POST"])' in v)
t("el detalle es PATCH y DELETE", '@api_view(["PATCH", "DELETE"])' in v)
t("Partida entra en el import de .models",
  "from .models import DailyPartActivity, IncidentReport, Partida" in v)
t("y re se importa, que lo usa el correlativo",
  "import re" in v and "_siguiente_codigo" in v)
t("el import de re va antes de usarse",
  "import re" in v and v.index("import re") < v.index("_siguiente_codigo"))

# ── las reglas que no se pueden perder ──
t("la obra sale del codigo del incidente", "def _obra_de" in v
  and "INCIDENTE-%s" in v)
t("el correlativo mira el MAYOR, no cuantas hay",
  "mayor = max(mayor" in v and "count()" not in v.split("def _siguiente_codigo")[1].split("def ")[0])
t("no se borra lo que tiene metrado imputado",
  "DailyPartActivity.objects.filter(partida_id=p.pk).count()" in v
  and "HTTP_409_CONFLICT" in v)
t("una partida de otra obra no se edita desde aqui",
  "propia" in v and "no se edita" in v)
t("y al quitarla solo se borra si es propia",
  "if propia:" in v and "p.delete()" in v)
t("el alta devuelve la incidencia entera, no solo la partida",
  "IncidentReportSerializer(inc).data" in v.split("def incidencia_partida_alta")[1])

# ── las rutas ──
t("urls.py importa las dos vistas",
  "incidencia_partida_alta" in u and "incidencia_partida_detalle" in u)
t("la ruta de alta", "path('incidentes/<int:pk>/partidas/', incidencia_partida_alta" in u)
t("la ruta de detalle",
  "path('incidentes/<int:pk>/partidas/<int:partida_id>/'," in u)
t("y la de detalle va DESPUES de la de alta -no la tapa-",
  u.index("partidas/', incidencia_partida_alta")
  < u.index("partidas/<int:partida_id>/'"))
t("lo que ya estaba sigue", "reabrir" in u and "router.urls" in u)
t("y la ruta del detalle de incidencia del primer parche tambien",
  "path('incidentes/<int:pk>/', incidencia_detalle" in u)

# ── 1b. El correlativo, CORRIENDOLO ───────────────────────────────────────
#
# Hasta aqui solo se ha mirado que el texto este. Esto lo ejecuta: se saca la
# funcion del fichero generado y se le pasa un Partida de mentira. Importa
# porque el codigo choca contra UniqueConstraint(obra, codigo) si se repite,
# y el caso que lo rompe -borrar una de en medio- no se ve leyendo.
def saca(fuente, nombre):
    """El codigo de una funcion de nivel superior, desde su def hasta la
    siguiente cosa de nivel superior."""
    ini = fuente.index("def %s(" % nombre)
    resto = fuente[ini:]
    corte = len(resto)
    for marca in ("\ndef ", "\n@", "\nclass ", "\n# ═"):
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


def correlativo_con(codigos):
    ns = {"re": __import__("re")}
    filas = [_Obj(codigo=c) for c in codigos]
    ns["Partida"] = _Obj(objects=_Obj(filter=lambda **kw: _QS(filas)))
    exec(saca(v, "_siguiente_codigo"), ns)
    return ns["_siguiente_codigo"]("X")


t("sin partidas, la primera es 01", correlativo_con([]) == "01",
  correlativo_con([]))
t("con 01 y 02, la siguiente es 03", correlativo_con(["01", "02"]) == "03",
  correlativo_con(["01", "02"]))
# El caso que rompe contar en vez de mirar el mayor.
t("borrada la 02 de tres, NO devuelve una que ya existe",
  correlativo_con(["01", "03"]) == "04", correlativo_con(["01", "03"]))
t("un codigo no numerico no la tumba",
  correlativo_con(["01", "ABC", "02"]) == "03",
  correlativo_con(["01", "ABC", "02"]))
t("ni uno vacio", correlativo_con(["", "01"]) == "02",
  correlativo_con(["", "01"]))
t("pasa de 09 a 10 sin perder el cero",
  correlativo_con(["09"]) == "10", correlativo_con(["09"]))

# Y la obra, que es lo que las separa de un presupuesto real.
def obra_de(code, pk):
    ns = {}
    exec(saca(v, "_obra_de"), ns)
    return ns["_obra_de"](_Obj(code=code, pk=pk))


t("la obra es el codigo del incidente",
  obra_de("INCIDENTE-002", 7) == "INCIDENTE-002", obra_de("INCIDENTE-002", 7))
t("y si no lo tiene, su id", obra_de("", 7) == "INCIDENTE-7", obra_de("", 7))
t("un codigo con espacios no deja la obra en blanco",
  obra_de("   ", 7) == "INCIDENTE-7", obra_de("   ", 7))

# ── 2. Dos pasadas no duplican ────────────────────────────────────────────
c3, s3 = corre(DOS, tmp)
t("la segunda pasada termina bien", c3 == 0, s3.strip()[-200:])
t("y dice que ya estaba", "ya estaba" in s3, s3.strip()[-200:])
v2, u2 = lee(app, "views_incidentes.py"), lee(app, "urls.py")
t("el alta no se duplica", v2.count("def incidencia_partida_alta") == 1,
  str(v2.count("def incidencia_partida_alta")))
t("ni la ruta", u2.count("incidencia_partida_alta") == 2,
  "import + path = 2, salieron %d" % u2.count("incidencia_partida_alta"))
t("ni el import de Partida",
  v2.count("from .models import DailyPartActivity, IncidentReport, Partida") == 1)
t("ni import re", v2.count("\\nimport re\\n") <= 1)

# ── 3. Sin el primer parche, se niega ─────────────────────────────────────
tmpS = tempfile.mkdtemp()
appS = monta(tmpS)
cS, sS = corre(DOS, tmpS)
t("sin el primer parche, falla", cS != 0, sS.strip()[-200:])
t("sin estrellarse", sin_traza(sS), sS.strip()[-300:])
t("y manda aplicar el anterior por su nombre",
  "parche_partidas_de_incidencia" in sS)
t("y no toca urls.py", "incidencia_partida_alta" not in lee(appS, "urls.py"))

# ── 4. Sin --aplicar no escribe ───────────────────────────────────────────
tmpD = tempfile.mkdtemp()
appD = monta(tmpD)
corre(UNO, tmpD)
cD, sD = corre(DOS, tmpD, aplicar=False)
t("en seco termina bien", cD == 0, sD.strip()[-200:])
t("y avisa de que no toco nada", "Nada tocado" in sD)
t("views_incidentes.py sin el alta",
  "incidencia_partida_alta" not in lee(appD, "views_incidentes.py"))
t("urls.py sin las rutas",
  "incidencia_partida_alta" not in lee(appD, "urls.py"))

for d in (tmp, tmpS, tmpD):
    shutil.rmtree(d, ignore_errors=True)

print("\n%d comprobacion(es) en orden%s." % (bien[0], ", %d MAL" % mal[0] if mal[0] else ""))
sys.exit(1 if mal[0] else 0)
