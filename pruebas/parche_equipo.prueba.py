# -*- coding: utf-8 -*-
"""Que el parche del enlace monte bien sus piezas, y que la REGLA sea la regla.

    python3 -I pruebas/parche_equipo.prueba.py

Lo que mas importa, por orden:

1. LA DECISION, CORRIENDOLA. `decidir` es lo que separa "entra" de "no
   entra". Un fallo ahi no se ve en ninguna pantalla: deja pasar a quien no
   debia, o bloquea a quien si. Se extrae del modulo generado y se ejecuta.
2. QUE EL MODULO GENERADO SEA PYTHON VALIDO. Va dentro de una cadena del
   parche; una comilla mal puesta no falla al escribirlo, falla al arrancar
   Django con el contenedor ya caido.
3. QUE EL COMANDO NO BORRE SIN QUE SE LO PIDAN, y que se niegue si queda
   gente con la app vieja.
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
PARCHE = os.path.join(AQUI, "parche_equipo_enlazado.py")

URLS = '''from django.urls import path, include

from .views import LoginView

urlpatterns = [
    path('auth/login/', LoginView.as_view(), name='login'),
]
'''

mal = [0]; bien = [0]


def t(etiqueta, ok, extra=""):
    if ok:
        bien[0] += 1
        return
    mal[0] += 1
    print("MAL  %s%s" % (etiqueta, ("   [%s]" % extra) if extra else ""))


def monta(base, app="usuarios", urls=URLS):
    carpeta = os.path.join(base, app)
    os.makedirs(carpeta)
    io.open(os.path.join(carpeta, "models.py"), "w", encoding="utf-8").write(
        "from django.db import models\n")
    io.open(os.path.join(carpeta, "urls.py"), "w", encoding="utf-8").write(urls)
    # Una app que NO es: tiene urls.py pero no habla de login.
    otra = os.path.join(base, "reportes")
    os.makedirs(otra)
    io.open(os.path.join(otra, "models.py"), "w", encoding="utf-8").write("\n")
    io.open(os.path.join(otra, "urls.py"), "w", encoding="utf-8").write(
        "urlpatterns = []\n")
    return carpeta


def corre(base, aplicar=True, extra=()):
    cmd = [sys.executable, "-I", PARCHE, "--base", base] + list(extra)
    if aplicar:
        cmd.append("--aplicar")
    r = subprocess.run(cmd, capture_output=True, text=True)
    return r.returncode, r.stdout + r.stderr


def lee(ruta):
    return io.open(ruta, encoding="utf-8").read() if os.path.isfile(ruta) else ""


# ── 1. Aplica, y en la app correcta ──────────────────────────────────────
tmp = tempfile.mkdtemp()
app = monta(tmp)
c, s = corre(tmp)
t("aplica", c == 0, s.strip()[-250:])
t("y elige la app que tiene el login, no la primera que encuentre",
  "app     : usuarios" in s, [l for l in s.split("\n") if "app " in l][:1])

f_mod = os.path.join(app, "equipo_enlazado.py")
f_cmd = os.path.join(app, "management", "commands", "botar_a_todos.py")
mod, urls, cmd = lee(f_mod), lee(os.path.join(app, "urls.py")), lee(f_cmd)

for n, txt in (("equipo_enlazado.py", mod), ("urls.py", urls),
               ("botar_a_todos.py", cmd)):
    if not txt:
        t("%s existe" % n, False); continue
    try:
        ast.parse(txt); t("%s es Python valido" % n, True)
    except SyntaxError as e:
        t("%s es Python valido" % n, False, str(e))

t("hay __init__.py en management y en commands",
  os.path.isfile(os.path.join(app, "management", "__init__.py"))
  and os.path.isfile(os.path.join(app, "management", "commands", "__init__.py")))
t("el comando importa de la app de verdad, no con un relativo roto",
  "from usuarios.equipo_enlazado import" in cmd,
  [l for l in cmd.split("\n") if "equipo_enlazado" in l][:1])
t("y no queda ningun marcador sin sustituir",
  "@@" not in mod and "@@" not in cmd)

# ── el modelo ──
t("el modelo guarda la firma de quien libero",
  "liberado_por" in mod and "liberado_en" in mod)
t("liberar DESACTIVA, no borra",
  "self.activo = False" in mod and "delete()" not in mod.split("def liberar")[1].split("def ")[0])
t("el identificador va recortado en el panel", "def _corto" in mod)
t("el panel es solo para administradores",
  mod.count("@permission_classes([IsAdminUser])") == 2,
  str(mod.count("@permission_classes([IsAdminUser])")))
t("liberar dos veces no borra la primera firma",
  "ya_liberado" in mod and "HTTP_409_CONFLICT" in mod)
t("el interruptor esta APAGADO por defecto",
  'getattr(settings, "EXIGIR_DISPOSITIVO", False)' in mod)

# ── las rutas ──
t("urls.py registra el listado",
  "path('auth/dispositivos/', dispositivos" in urls)
t("y la liberacion", "dispositivos/<int:pk>/liberar/" in urls)
t("sin perder la ruta del login que ya estaba", "auth/login/" in urls)
t("la de liberar va DESPUES de la del listado",
  urls.index("auth/dispositivos/', dispositivos")
  < urls.index("dispositivos/<int:pk>/liberar/"))


# ── 1b. LA REGLA, CORRIENDOLA ────────────────────────────────────────────
#
# Es lo que separa "entra" de "no entra". Un fallo aqui no se ve en ninguna
# pantalla: deja pasar a quien no debia o bloquea a quien si.
def saca(fuente, nombre):
    ini = fuente.index("def %s(" % nombre)
    resto = fuente[ini:]
    corte = len(resto)
    for marca in ("\ndef ", "\n@", "\nclass ", "\n# "):
        q = resto.find(marca, 1)
        if q != -1:
            corte = min(corte, q)
    return resto[:corte]


ns = {}
for nombre in ("CORTADO", "ENLAZA", "SIGUE", "SIN_ID"):
    m = re.search(r'^%s = "([^"]+)"' % nombre, mod, re.M)
    ns[nombre] = m.group(1) if m else nombre.lower()
exec(saca(mod, "decidir"), ns)
decidir = ns["decidir"]


class Enlace(object):
    def __init__(self, device_id):
        self.device_id = device_id


E = Enlace("abc123")

t("sin enlace previo, el equipo queda enlazado",
  decidir(None, "abc123", False)[0] == ns["ENLAZA"])
t("el mismo equipo pasa", decidir(E, "abc123", False)[0] == ns["SIGUE"])
t("OTRO equipo se corta", decidir(E, "zzz999", False)[0] == ns["CORTADO"])
t("y se dice por que", decidir(E, "zzz999", False)[1] == "equipo_distinto")

# La app vieja: con el interruptor apagado pasa y queda apuntada; encendido,
# se corta mandando a actualizar, no a soporte.
t("sin identificador y sin exigir, pasa pero queda apuntado",
  decidir(E, "", False)[0] == ns["SIN_ID"])
t("sin identificador y exigiendo, se corta",
  decidir(E, "", True)[0] == ns["CORTADO"])
t("con un codigo que manda a ACTUALIZAR, no a soporte",
  decidir(E, "", True)[1] == "falta_device_id")
t("y lo mismo sin enlace previo: falta el identificador, no el enlace",
  decidir(None, "", True)[1] == "falta_device_id")

# EL ORDEN DE LAS COMPROBACIONES. Si se mirara el identificador despues de
# comparar, un usuario ya enlazado que vuelva a la app vieja pasaria como si
# fuera su equipo.
t("un enlazado que vuelve a la app vieja NO pasa por su equipo",
  decidir(E, None, True)[0] == ns["CORTADO"]
  and decidir(E, None, True)[1] == "falta_device_id")
t("ni con cadena vacia", decidir(E, "", True)[1] == "falta_device_id")

# EL PELIGRO DE VERDAD DEL ORDEN: si se comparara antes de mirar si falta el
# identificador, una app vieja sin enlace previo quedaria ENLAZADA con un
# identificador VACIO. A partir de ahi, cualquier otra app vieja coincidiria
# con el y pasaria como si fuera su equipo. Es un agujero que se abre solo.
for vacio in (None, "", "   "):
    t("nunca se enlaza un identificador vacio (%r)" % vacio,
      decidir(None, vacio, False)[0] != ns["ENLAZA"],
      "quedaria enlazado con vacio y todas las apps viejas encajarian")
    t("ni exigiendo (%r)" % vacio,
      decidir(None, vacio, True)[0] == ns["CORTADO"])


# ── 2. Dos pasadas ───────────────────────────────────────────────────────
c2, s2 = corre(tmp)
t("la segunda pasada termina bien", c2 == 0, s2.strip()[-200:])
t("y dice que las rutas ya estaban", "ya estaban" in s2)
u2 = lee(os.path.join(app, "urls.py"))
t("las rutas no se duplican", u2.count("auth/dispositivos/', dispositivos") == 1,
  str(u2.count("auth/dispositivos/', dispositivos")))
t("y el modulo sigue siendo valido",
  (lambda: (ast.parse(lee(f_mod)), True)[1])())


# ── 3. El comando no borra sin que se lo pidan ───────────────────────────
t("el comando pide --de-verdad",
  'dest="de_verdad"' in cmd and 'if not opciones["de_verdad"]' in cmd)
t("y se niega si queda gente con la app vieja",
  "NO SE BORRA NADA" in cmd)
t("esa negativa se EJECUTA y corta", (lambda: any(
    isinstance(n, ast.If)
    and any(getattr(y, "id", "") == "sin_id" for y in ast.walk(n.test))
    and any(isinstance(z, ast.Return) for z in ast.walk(n))
    for n in ast.walk(ast.parse(cmd))))(),
  "con el bloqueo encendido, esos no pueden volver a entrar")
t("pero se puede insistir", "aunque_falten" in cmd)


# ── 4. Sin urlpatterns, se niega sin dejar nada ──────────────────────────
tmpS = tempfile.mkdtemp()
appS = monta(tmpS, urls="from django.urls import path\n")
cS, sS = corre(tmpS)
t("sin urlpatterns, falla", cS != 0, sS.strip()[-200:])
t("sin estrellarse", "Traceback" not in sS, sS.strip()[-250:])
t("y sin crear el modulo",
  not os.path.isfile(os.path.join(appS, "equipo_enlazado.py")))

# ── 5. Sin --aplicar no escribe ──────────────────────────────────────────
tmpD = tempfile.mkdtemp()
appD = monta(tmpD)
cD, sD = corre(tmpD, aplicar=False)
t("en seco termina bien", cD == 0, sD.strip()[-200:])
t("y no crea nada",
  not os.path.isfile(os.path.join(appD, "equipo_enlazado.py"))
  and "dispositivos" not in lee(os.path.join(appD, "urls.py")))

for d in (tmp, tmpS, tmpD):
    shutil.rmtree(d, ignore_errors=True)

print("\n%d comprobacion(es) en orden%s." % (bien[0], ", %d MAL" % mal[0] if mal[0] else ""))
sys.exit(1 if mal[0] else 0)
