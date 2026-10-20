# -*- coding: utf-8 -*-
"""Que el parche de partidas por incidencia parchee bien, y una sola vez.

    python3 -I pruebas/parche_incidencia.prueba.py

Monta un proyecto Django de mentira -models.py y urls.py-, le pasa el parche
y mira lo que queda. No toca ningun servidor.

QUE VIGILA, Y POR QUE ESO
=========================

1. QUE DOS PASADAS NO DUPLIQUEN NADA. Estos parches se corren a mano, en un
   servidor, y la duda de "¿lo habre aplicado ya?" acaba siempre en correrlo
   otra vez. Un M2M duplicado no da error al escribirlo: lo da Django al
   arrancar, con el contenedor ya caido.

2. QUE UN FALLO NO DEJE EL PROYECTO A MEDIAS. Ahora el parche escribe TRES
   ficheros. Si el tercero no se puede, los dos primeros no deben haberse
   tocado: un modelo con campo nuevo y sin ruta deja la pantalla igual de
   muerta, pero con una migracion pendiente que confunde al siguiente.
   Por eso se comprueba que, cuando falla, no exista views_incidentes.py.

3. QUE EL CHOQUE DE related_name SE DETECTE ANTES. El parche espejo -el de
   actividades- se llevo un fields.E304 en el servidor por reusar un
   related_name que ya apuntaba a Partida. Aqui se monta ese caso a proposito
   y se exige que el parche se niegue en seco.

4. QUE EL MODELO SIN class Meta TAMBIEN FUNCIONE. IncidentReport en el
   servidor no tiene Meta -se vio en el volcado-, asi que el camino de
   "insertar al final del cuerpo" es el REAL, no el raro.
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
PARCHE = os.path.join(AQUI, "parche_partidas_de_incidencia.py")

# Como esta de verdad en el servidor: sin Meta.
MODELS = '''from django.db import models


class Partida(models.Model):
    codigo = models.CharField(max_length=40)


class IncidentReport(models.Model):
    """Una incidencia en el canal."""
    code = models.CharField(max_length=40)
    location_text = models.CharField(max_length=120, blank=True)


class DailyPartActivity(models.Model):
    partida = models.ForeignKey(Partida, on_delete=models.CASCADE,
                                related_name="actividades")
    metrado = models.DecimalField(max_digits=12, decimal_places=4)
'''

#   El unico cuerpo que delata el bug de la sangria.
#
# sangria_de captura la sangria con [ \t]+. Con \s+ -como estaba escrito la
# primera vez- se come el salto de linea y el campo sale entrelineado. Pero
# eso SOLO ocurre si hay una linea en blanco justo tras la declaracion de la
# clase: entonces ^ engancha en la linea vacia y \s+ se lleva el \n. Medido:
#
#   class X:\n    code=...        [ \t]+ -> '    '    \s+ -> '    '   igual
#   class X:\n\n    code=...      [ \t]+ -> '    '    \s+ -> '\n    '  ROTO
#   class X:\n    """x"""\n\n     [ \t]+ -> '    '    \s+ -> '    '   igual
#
# Sin este mock la comprobacion del comentario entrelineado era decorativa:
# se saboteo el regex a proposito y la prueba seguia pasando en verde.
MODELS_HUECO = MODELS.replace(
    'class IncidentReport(models.Model):\n    """Una incidencia en el canal."""\n',
    'class IncidentReport(models.Model):\n\n')

# Y uno con Meta, para el otro camino.
MODELS_META = MODELS.replace(
    '    location_text = models.CharField(max_length=120, blank=True)\n',
    '    location_text = models.CharField(max_length=120, blank=True)\n'
    '\n    class Meta:\n        ordering = ["-id"]\n')

URLS = '''from django.urls import path, include
from rest_framework.routers import DefaultRouter

from .views import cerrar_incidente, reabrir_incidente

router = DefaultRouter()

urlpatterns = [
    path('incidentes/<int:incident_id>/cerrar-partes/', cerrar_incidente),
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


def monta(base, models=MODELS, urls=URLS):
    app = os.path.join(base, "operations")
    os.makedirs(app)
    with io.open(os.path.join(app, "models.py"), "w", encoding="utf-8") as f:
        f.write(models)
    if urls is not None:
        with io.open(os.path.join(app, "urls.py"), "w", encoding="utf-8") as f:
            f.write(urls)
    return app


def corre(base, aplicar=True):
    cmd = [sys.executable, "-I", PARCHE, "--base", base]
    if aplicar:
        cmd.append("--aplicar")
    r = subprocess.run(cmd, capture_output=True, text=True)
    return r.returncode, r.stdout + r.stderr


def lee(app, n):
    """El contenido, o "" si no existe.

    DEVUELVE "" Y NO REVIENTA a proposito. Al sabotear el parche para ver si
    la prueba lo pilla, la prueba moria con un FileNotFoundError en la
    comprobacion siguiente y se quedaban sin correr las otras cuarenta. Un
    fichero que falta es un MAL, no un accidente de la prueba.
    """
    r = os.path.join(app, n)
    if not os.path.isfile(r):
        return ""
    with io.open(r, encoding="utf-8") as f:
        return f.read()


def valido(app, nombre):
    txt = lee(app, nombre)
    if not txt:
        return "no existe o esta vacio"
    try:
        ast.parse(txt)
    except SyntaxError as e:
        return str(e)
    return None


def sin_traza(salida):
    """Que haya fallado DICIENDOLO, no estrellandose.

    El guardarrail de 'no se escribe nada' se puede quitar y el parche sigue
    saliendo con codigo != 0, porque mas abajo revienta con un TypeError al
    mirar un texto que es None. El codigo de salida solo, entonces, no prueba
    nada: la prueba pasaba con el guardarrail quitado. Lo que distingue un
    rechazo de un accidente es que no haya traceback y que lo explique.
    """
    return "Traceback" not in salida


# ── 1. Una pasada ─────────────────────────────────────────────────────────
tmp = tempfile.mkdtemp()
app = monta(tmp)
cod, salida = corre(tmp)
t("la primera pasada termina bien", cod == 0, salida.strip()[-200:])

t("se crea views_incidentes.py",
  os.path.isfile(os.path.join(app, "views_incidentes.py")))

for n in ("models.py", "urls.py", "views_incidentes.py"):
    e = valido(app, n)
    t("%s es Python valido" % n, e is None, e or "")

m = lee(app, "models.py")
v = lee(app, "views_incidentes.py")
u = lee(app, "urls.py")

# ── el modelo ──
t("el modelo lleva el M2M", "partidas = models.ManyToManyField" in m)
t("con el related_name que no choca", 'related_name="incidencias"' in m)
t("y blank=True, para no obligar a elegir una", "blank=True" in m)
t("el campo entra DENTRO de IncidentReport",
  "partidas = models.ManyToManyField" in m
  and m.index("class IncidentReport")
  < m.index("partidas = models.ManyToManyField")
  < m.index("class DailyPartActivity"))
# El comentario no debe salir con una linea en blanco entre cada linea: una
# version capturaba la sangria con \s+, que se come los saltos.
t("el comentario no sale entrelineado", "#\n\n    #" not in m,
  "sale con una linea en blanco entre cada linea")

# ── la vista ──
t("el serializer declara partidas_detalle", "partidas_detalle = serializers" in v)
t("y presupuestado", "presupuestado = serializers" in v)
t("los tres nombres entran en Meta.fields",
  "fields =" in v
  and all(x in v.split("fields =")[1].split("]")[0]
          for x in ('"partidas"', '"partidas_detalle"', '"presupuestado"')))
t("y los metodos existen",
  "def get_partidas_detalle" in v and "def get_presupuestado" in v)
t("el ejecutado compara unidades", "_normaliza(p.unidad)" in v)
t("la vista admite GET y PATCH", '@api_view(["GET", "PATCH"])' in v)
t("y NO admite DELETE -las borra el sync-",
  "@api_view" in v and "DELETE" not in
  v.split("def incidencia_detalle")[0].split("@api_view")[-1])
t("devuelve 404 si la incidencia no existe", "HTTP_404_NOT_FOUND" in v)
t("el PATCH es parcial", "partial=True" in v)
t("importa lo que usa",
  "from .models import DailyPartActivity, IncidentReport" in v
  and "from django.db.models import Sum" in v)

# ── la ruta ──
t("urls.py importa la vista", "from .views_incidentes import incidencia_detalle" in u)
t("y registra la ruta", "path('incidentes/<int:pk>/', incidencia_detalle" in u)
# Contra la RUTA de reabrir, no contra la palabra: 'reabrir' sale antes en la
# linea de import, y comparar con eso daba un MAL que no existia.
t("la ruta va PRIMERA, antes de la de reabrir/",
  "path('incidentes/<int:pk>/'" in u
  and u.index("path('incidentes/<int:pk>/'")
  < u.index("path('incidentes/<int:incident_id>/reabrir/'"))
t("el import de path sigue estando", "from django.urls import path" in u)
t("las rutas que ya estaban siguen",
  "cerrar-partes" in u and "reabrir" in u and "router.urls" in u)

# ── 2. Dos pasadas no duplican ────────────────────────────────────────────
cod2, salida2 = corre(tmp)
t("la segunda pasada tambien termina bien", cod2 == 0, salida2.strip()[-200:])
t("y dice que ya estaba", "ya estaba" in salida2, salida2.strip()[-200:])

m2, u2 = lee(app, "models.py"), lee(app, "urls.py")
t("el M2M no se duplica", m2.count("partidas = models.ManyToManyField") == 1,
  str(m2.count("partidas = models.ManyToManyField")))
t("ni el import de la vista", u2.count("from .views_incidentes import") == 1)
t("ni la ruta", u2.count("path('incidentes/<int:pk>/'") == 1)

# ── 3. Con class Meta, el campo entra antes ───────────────────────────────
tmpM = tempfile.mkdtemp()
appM = monta(tmpM, models=MODELS_META)
codM, salidaM = corre(tmpM)
t("con class Meta tambien aplica", codM == 0, salidaM.strip()[-200:])
mM = lee(appM, "models.py")
t("y el campo entra ANTES de class Meta",
  "ManyToManyField" in mM
  and mM.index("partidas = models.ManyToManyField") < mM.index("class Meta"))
t("models.py con Meta sigue siendo valido", valido(appM, "models.py") is None)

# ── 3b. Con una linea en blanco tras la clase: la sangria aguanta ─────────
tmpH = tempfile.mkdtemp()
appH = monta(tmpH, models=MODELS_HUECO)
codH, salidaH = corre(tmpH)
t("con hueco tras la clase tambien aplica", codH == 0, salidaH.strip()[-200:])
mH = lee(appH, "models.py")
t("y el comentario NO sale entrelineado", "#\n\n    #" not in mH,
  "una linea en blanco entre cada linea del comentario")
t("ni la sangria se lleva el salto", "\n\n    partidas =" not in mH.replace(
    "\n\n    # PARTIDAS", "\n\n@@"))
t("models.py con hueco sigue siendo valido", valido(appH, "models.py") is None)

# ── 4. Choque de related_name: se niega ───────────────────────────────────
CHOCA = MODELS.replace('related_name="actividades"', 'related_name="incidencias"')
tmpC = tempfile.mkdtemp()
appC = monta(tmpC, models=CHOCA)
codC, salidaC = corre(tmpC)
t("si 'incidencias' ya esta usado, se niega", codC != 0, salidaC.strip()[-200:])
t("y lo dice por su nombre -E304-", "E304" in salidaC)
t("se niega DICIENDOLO, no estrellandose", sin_traza(salidaC),
  salidaC.strip()[-300:])
t("y lo anuncia en seco", "NO SE ESCRIBE NADA" in salidaC)
t("sin tocar models.py", "ManyToManyField" not in lee(appC, "models.py"))
t("y sin crear la vista",
  not os.path.isfile(os.path.join(appC, "views_incidentes.py")))

# ── 5. Sin el modelo: falla y no escribe NADA ─────────────────────────────
tmp2 = tempfile.mkdtemp()
app2 = monta(tmp2, models="from django.db import models\n")
cod3, salida3 = corre(tmp2)
t("sin el modelo, falla diciendolo",
  cod3 != 0 and "IncidentReport" in salida3, salida3.strip()[-200:])
t("sin estrellarse", sin_traza(salida3), salida3.strip()[-300:])
t("y lo anuncia en seco", "NO SE ESCRIBE NADA" in salida3)
t("y NO crea views_incidentes.py -nada a medias-",
  not os.path.isfile(os.path.join(app2, "views_incidentes.py")))

# ── 6. Sin urlpatterns: falla y no escribe NADA ───────────────────────────
tmp3 = tempfile.mkdtemp()
app3 = monta(tmp3, urls="from django.urls import path\n")
cod4, salida4 = corre(tmp3)
t("sin urlpatterns, falla", cod4 != 0, salida4.strip()[-200:])
t("sin estrellarse", sin_traza(salida4), salida4.strip()[-300:])
t("y lo anuncia en seco", "NO SE ESCRIBE NADA" in salida4)
t("y deja models.py intacto", "ManyToManyField" not in lee(app3, "models.py"))
t("y tampoco crea la vista",
  not os.path.isfile(os.path.join(app3, "views_incidentes.py")))

# ── 7. Sin --aplicar no escribe ───────────────────────────────────────────
tmp4 = tempfile.mkdtemp()
app4 = monta(tmp4)
cod5, salida5 = corre(tmp4, aplicar=False)
t("en seco termina bien", cod5 == 0, salida5.strip()[-200:])
t("y avisa de que no toco nada", "Nada tocado" in salida5)
t("models.py sin tocar", "ManyToManyField" not in lee(app4, "models.py"))
t("urls.py sin tocar", "views_incidentes" not in lee(app4, "urls.py"))
t("y la vista sin crear",
  not os.path.isfile(os.path.join(app4, "views_incidentes.py")))

for d in (tmp, tmpH, tmpM, tmpC, tmp2, tmp3, tmp4):
    shutil.rmtree(d, ignore_errors=True)

print("\n%d comprobacion(es) en orden%s." % (bien[0], ", %d MAL" % mal[0] if mal[0] else ""))
sys.exit(1 if mal[0] else 0)
