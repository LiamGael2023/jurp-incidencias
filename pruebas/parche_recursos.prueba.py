# -*- coding: utf-8 -*-
"""Que la mano de obra y los materiales ganen su partida, sin romper nada.

    python3 -I pruebas/parche_recursos.prueba.py

Lo que vigila, por orden:

1. QUE LOS DOS RELATED_NAME NO CHOQUEN. Partida ya tiene cuatro relaciones
   apuntandole; un related_name repetido no falla al escribirlo, falla al
   arrancar Django con fields.E304 y el contenedor ya caido. El espejo de
   este parche se llevo ese golpe en el servidor.
2. QUE LOS DOS SERIALIZERS QUEDEN BIEN. Viven en el mismo fichero, asi que
   un reemplazo a ciegas mete el campo dos veces en el primero y ninguna en
   el segundo, y el sintoma -"materiales no guarda la partida"- no apunta a
   la causa.
3. QUE DOS PASADAS NO DUPLIQUEN. Se corren a mano, de noche, y la duda de
   "¿lo habre aplicado ya?" acaba siempre en correrlo otra vez.
"""
from __future__ import print_function

import ast
import io
import os
import re
import shutil
import subprocess
import sys
import tempfile

AQUI = os.path.dirname(os.path.abspath(__file__))
PARCHE = os.path.join(AQUI, "parche_partida_en_recursos.py")

MODELS = '''from django.db import models


class Partida(models.Model):
    codigo = models.CharField(max_length=40)


class IncidentReport(models.Model):
    code = models.CharField(max_length=40)
    partidas = models.ManyToManyField("Partida", blank=True,
                                      related_name="incidencias")


class DailyPartActivity(models.Model):
    partida = models.ForeignKey(Partida, on_delete=models.CASCADE,
                                related_name="actividades")


class IncidentPersonnel(models.Model):
    incident_report = models.ForeignKey(IncidentReport, on_delete=models.CASCADE,
                                        related_name="personnels")
    description = models.CharField(max_length=200)

    class Meta:
        ordering = ["-id"]


class IncidentMaterial(models.Model):
    incident_report = models.ForeignKey(IncidentReport, on_delete=models.CASCADE,
                                        related_name="materials")
    description = models.CharField(max_length=200)
'''

SER = '''from rest_framework import serializers
from .models import IncidentPersonnel, IncidentMaterial


class IncidentPersonnelSerializer(serializers.ModelSerializer):
    class Meta:
        model = IncidentPersonnel
        fields = ["id", "incident_report", "description", "quantity_hours"]


class IncidentMaterialSerializer(serializers.ModelSerializer):
    class Meta:
        model = IncidentMaterial
        fields = ["id", "incident_report", "description", "quantity", "unit"]
'''

mal = [0]; bien = [0]


def t(etiqueta, ok, extra=""):
    if ok:
        bien[0] += 1
        return
    mal[0] += 1
    print("MAL  %s%s" % (etiqueta, ("   [%s]" % extra) if extra else ""))


def monta(base, models=MODELS, ser=SER):
    app = os.path.join(base, "operations")
    os.makedirs(app)
    io.open(os.path.join(app, "models.py"), "w", encoding="utf-8").write(models)
    io.open(os.path.join(app, "serializers.py"), "w", encoding="utf-8").write(ser)
    return app


def corre(base, aplicar=True):
    cmd = [sys.executable, "-I", PARCHE, "--base", base]
    if aplicar:
        cmd.append("--aplicar")
    r = subprocess.run(cmd, capture_output=True, text=True)
    return r.returncode, r.stdout + r.stderr


def lee(app, n):
    r = os.path.join(app, n)
    return io.open(r, encoding="utf-8").read() if os.path.isfile(r) else ""


def cuerpo(texto, clase):
    m = re.search(r"^class\s+" + clase + r"\s*\(", texto, re.M)
    if not m:
        return ""
    sig = re.search(r"^class\s+\w+\s*\(", texto[m.end():], re.M)
    return texto[m.start():m.end() + sig.start()] if sig else texto[m.start():]


# ── 1. Una pasada ─────────────────────────────────────────────────────────
tmp = tempfile.mkdtemp()
app = monta(tmp)
c, s = corre(tmp)
t("aplica", c == 0, s.strip()[-250:])

m, sr = lee(app, "models.py"), lee(app, "serializers.py")
for n, txt in (("models.py", m), ("serializers.py", sr)):
    try:
        ast.parse(txt); t("%s es Python valido" % n, True)
    except SyntaxError as e:
        t("%s es Python valido" % n, False, str(e))

for clase in ("IncidentPersonnel", "IncidentMaterial"):
    cu = cuerpo(m, clase)
    t("%s gana su partida" % clase, "partida = models.ForeignKey" in cu)
    t("%s: una sola vez" % clase,
      cu.count("partida = models.ForeignKey") == 1,
      str(cu.count("partida = models.ForeignKey")))
    t("%s: opcional" % clase, "null=True" in cu and "blank=True" in cu)
    # El comentario que escribe el parche DICE "SET_NULL", asi que buscar la
    # palabra suelta la encontraba ahi y la comprobacion pasaba con el codigo
    # saboteado a CASCADE. Se busca el argumento.
    t("%s: SET_NULL, no CASCADE" % clase,
      "on_delete=models.SET_NULL" in cu and "on_delete=models.CASCADE" not in
      cu.split("partida = models.ForeignKey")[1],
      "borrar una partida no puede borrar el registro de ocho horas de trabajo")

# El campo entra DENTRO de la clase, no en la siguiente.
t("el de Personnel no se cuela en Material",
  cuerpo(m, "IncidentPersonnel").count("related_name=\"personal_imputado\"") == 1
  and "personal_imputado" not in cuerpo(m, "IncidentMaterial"))
t("y con Meta presente entra ANTES de Meta",
  cuerpo(m, "IncidentPersonnel").index("partida = models.ForeignKey")
  < cuerpo(m, "IncidentPersonnel").index("class Meta"))

# ── los dos related_name, distintos entre si y de los que ya habia ───────
nombres = re.findall(r'related_name="([^"]+)"', m)
t("ningun related_name repetido en todo el fichero",
  len(nombres) == len(set(nombres)), " | ".join(nombres))
t("y los nuevos no pisan a los que ya apuntaban a Partida",
  "actividades" in nombres and "incidencias" in nombres
  and "personal_imputado" in nombres and "materiales_imputados" in nombres)

# ── los serializers: LOS DOS ────────────────────────────────────────────
for clase in ("IncidentPersonnelSerializer", "IncidentMaterialSerializer"):
    cu = cuerpo(sr, clase)
    t("%s expone partida" % clase, '"partida"' in cu)
    t("%s: una sola vez" % clase, cu.count('"partida"') == 1,
      str(cu.count('"partida"')))
    t("%s: dentro de fields" % clase,
      "fields = [" in cu and '"partida"' in cu.split("fields = [")[1].split("]")[0])
t("sin perder los campos que ya estaban",
  all(x in sr for x in ('"quantity_hours"', '"quantity"', '"unit"',
                        '"incident_report"')))

# ── 2. Dos pasadas no duplican ────────────────────────────────────────────
c2, s2 = corre(tmp)
t("la segunda pasada termina bien", c2 == 0, s2.strip()[-200:])
t("y dice que ya estaba", "ya estaba" in s2)
m2, sr2 = lee(app, "models.py"), lee(app, "serializers.py")
# Se cuenta DENTRO de cada clase. En todo el fichero no vale: el mock ya
# trae DailyPartActivity.partida, asi que ahi siempre hay una de mas y la
# comprobacion daba un MAL que no existia.
for clase in ("IncidentPersonnel", "IncidentMaterial"):
    t("el campo de %s no se duplica" % clase,
      cuerpo(m2, clase).count("partida = models.ForeignKey") == 1,
      str(cuerpo(m2, clase).count("partida = models.ForeignKey")))
t("ni en los serializers", sr2.count('"partida"') == 2,
  str(sr2.count('"partida"')))

# ── 3. Choque de related_name: se niega ──────────────────────────────────
CHOCA = MODELS.replace('related_name="actividades"',
                       'related_name="personal_imputado"')
tmpC = tempfile.mkdtemp()
appC = monta(tmpC, models=CHOCA)
cC, sC = corre(tmpC)
t("si el related_name ya esta usado, se niega", cC != 0, sC.strip()[-200:])
t("y lo dice por su nombre -E304-", "E304" in sC)
t("sin estrellarse", "Traceback" not in sC, sC.strip()[-300:])
t("sin tocar models.py",
  "materiales_imputados" not in lee(appC, "models.py"),
  "se busca el related_name nuevo: 'partida = ForeignKey' ya existe en el mock")
t("ni los serializers", '"partida"' not in lee(appC, "serializers.py"))

# ── 4. fields = "__all__" ya lo expone ───────────────────────────────────
TODO = SER.replace('fields = ["id", "incident_report", "description", "quantity", "unit"]',
                   'fields = "__all__"')
tmpT = tempfile.mkdtemp()
appT = monta(tmpT, ser=TODO)
cT, sT = corre(tmpT)
t("un serializer con __all__ no se toca", cT == 0, sT.strip()[-200:])
t("y se dice por que", "__all__" in sT)

# ── 5. Sin el modelo, se niega sin dejar nada ────────────────────────────
tmpS = tempfile.mkdtemp()
appS = monta(tmpS, models=MODELS.replace("class IncidentMaterial(models.Model):",
                                         "class OtraCosa(models.Model):"))
cS, sS = corre(tmpS)
t("sin uno de los modelos, falla", cS != 0, sS.strip()[-200:])
t("nombrandolo", "IncidentMaterial" in sS)
t("y sin dejar el otro a medias",
  "personal_imputado" not in lee(appS, "models.py"))

# ── 6. Sin --aplicar no escribe ──────────────────────────────────────────
tmpD = tempfile.mkdtemp()
appD = monta(tmpD)
cD, sD = corre(tmpD, aplicar=False)
t("en seco termina bien", cD == 0, sD.strip()[-200:])
t("y avisa", "Nada tocado" in sD)
t("models.py sin tocar", "personal_imputado" not in lee(appD, "models.py"))
t("serializers.py sin tocar", '"partida"' not in lee(appD, "serializers.py"))

for d in (tmp, tmpC, tmpT, tmpS, tmpD):
    shutil.rmtree(d, ignore_errors=True)

print("\n%d comprobacion(es) en orden%s." % (bien[0], ", %d MAL" % mal[0] if mal[0] else ""))
sys.exit(1 if mal[0] else 0)
