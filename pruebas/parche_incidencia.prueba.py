# -*- coding: utf-8 -*-
"""Que el parche de partidas por incidencia parchee bien, y una sola vez.

    python3 -I pruebas/parche_incidencia.prueba.py

Monta un proyecto Django de mentira -models.py y un serializer-, le pasa el
parche y mira lo que queda. No toca ningun servidor.

Lo que de verdad vigila: que aplicarlo DOS VECES no duplique el campo. Estos
parches se corren a mano, en un servidor, de noche, y la duda de "¿lo habre
aplicado ya?" acaba siempre en correrlo otra vez. Un M2M duplicado no da
error al escribirlo: lo da Django al arrancar, con el contenedor ya caido.
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

MODELS = '''from django.db import models


class IncidentReport(models.Model):
    """Una incidencia en el canal."""
    codigo = models.CharField(max_length=40)
    lugar = models.CharField(max_length=120, blank=True)

    class Meta:
        ordering = ["-id"]
'''

SER = '''from rest_framework import serializers
from .models import IncidentReport


class IncidentReportSerializer(serializers.ModelSerializer):
    partes = serializers.SerializerMethodField()

    class Meta:
        model = IncidentReport
        fields = ["id", "codigo", "lugar", "partes"]

    def get_partes(self, obj):
        return 0
'''

mal = [0]
bien = [0]


def t(etiqueta, ok, extra=""):
    if ok:
        bien[0] += 1
        return
    mal[0] += 1
    print("MAL  %s%s" % (etiqueta, ("   [%s]" % extra) if extra else ""))


def monta(base, models=MODELS, ser=SER):
    app = os.path.join(base, "operations")
    os.makedirs(app)
    with io.open(os.path.join(app, "models.py"), "w", encoding="utf-8") as f:
        f.write(models)
    with io.open(os.path.join(app, "views_incidentes.py"), "w", encoding="utf-8") as f:
        f.write(ser)
    return app


def corre(base, aplicar=True):
    cmd = [sys.executable, "-I", PARCHE, "--base", base]
    if aplicar:
        cmd.append("--aplicar")
    r = subprocess.run(cmd, capture_output=True, text=True)
    return r.returncode, r.stdout + r.stderr


def lee(app, n):
    with io.open(os.path.join(app, n), encoding="utf-8") as f:
        return f.read()


# ── 1. Una pasada ─────────────────────────────────────────────────────────
tmp = tempfile.mkdtemp()
app = monta(tmp)
cod, salida = corre(tmp)
t("la primera pasada termina bien", cod == 0, salida.strip()[-120:])

m, s = lee(app, "models.py"), lee(app, "views_incidentes.py")
for nombre, txt in (("models.py", m), ("views_incidentes.py", s)):
    try:
        ast.parse(txt)
    except SyntaxError as e:
        t("%s sigue siendo Python valido" % nombre, False, str(e))
    else:
        t("%s sigue siendo Python valido" % nombre, True)

t("el modelo lleva el M2M", "partidas = models.ManyToManyField" in m)
t("con el related_name que no choca", 'related_name="incidencias"' in m)
t("y blank=True, para no obligar a elegir una", "blank=True" in m)
t("el campo entra ANTES de class Meta",
  m.index("partidas = models.ManyToManyField") < m.index("class Meta"))
# El comentario no debe salir con una linea en blanco entre cada linea: la
# primera version capturaba la sangria con \\s+, que se come los saltos.
# Entre DOS lineas de comentario no puede haber un hueco. El salto en blanco
# que separa el campo de lo anterior si es correcto, asi que se busca el
# patron "comentario, hueco, comentario".
t("el comentario no sale entrelineado", "#\n\n    #" not in m,
  "sale con una linea en blanco entre cada linea")

t("el serializer declara partidas_detalle", "partidas_detalle = serializers" in s)
t("y presupuestado", "presupuestado = serializers" in s)
t("los tres nombres entran en Meta.fields",
  all(x in s.split("fields =")[1].split("]")[0]
      for x in ('"partidas"', '"partidas_detalle"', '"presupuestado"')))
t("y los metodos existen",
  "def get_partidas_detalle" in s and "def get_presupuestado" in s)
t("el metodo que ya estaba sigue ahi", "def get_partes" in s)
# El ejecutado se mide en la unidad de la partida, no en cualquiera.
t("el ejecutado compara unidades", "norm(p.unidad)" in s)

# ── 2. Dos pasadas no duplican ────────────────────────────────────────────
cod2, salida2 = corre(tmp)
t("la segunda pasada tambien termina bien", cod2 == 0, salida2.strip()[-120:])
t("y dice que ya estaba", "ya estaba" in salida2, salida2.strip()[-160:])

m2, s2 = lee(app, "models.py"), lee(app, "views_incidentes.py")
t("el M2M no se duplica", m2.count("partidas = models.ManyToManyField") == 1,
  str(m2.count("partidas = models.ManyToManyField")))
t("ni partidas_detalle", s2.count("partidas_detalle = serializers") == 1)
t("ni el metodo", s2.count("def get_partidas_detalle") == 1)
t("Meta.fields no repite los nombres", s2.count('"partidas_detalle"') == 1)

# ── 3. Sin lo que busca, no rompe nada ────────────────────────────────────
tmp2 = tempfile.mkdtemp()
monta(tmp2, models="from django.db import models\n", ser=SER)
cod3, salida3 = corre(tmp2)
t("sin el modelo, falla diciendolo y no escribe",
  cod3 != 0 and "IncidentReport" in salida3, salida3.strip()[-120:])

tmp3 = tempfile.mkdtemp()
app3 = monta(tmp3, models=MODELS, ser="from rest_framework import serializers\n")
cod4, salida4 = corre(tmp3)
t("sin el serializer, tampoco", cod4 != 0, salida4.strip()[-120:])
t("y deja models.py intacto",
  "ManyToManyField" not in lee(app3, "models.py"))

for d in (tmp, tmp2, tmp3):
    shutil.rmtree(d, ignore_errors=True)

print("\n%d comprobacion(es) en orden%s." % (bien[0], ", %d MAL" % mal[0] if mal[0] else ""))
sys.exit(1 if mal[0] else 0)
