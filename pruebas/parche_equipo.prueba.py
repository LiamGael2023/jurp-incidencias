# -*- coding: utf-8 -*-
"""El parche del enlace, contra una copia del proyecto real.

    python3 -I pruebas/parche_equipo.prueba.py

El mock no es generico: es el codigo de verdad de PLUVIRA -MobileAuthLoginView
tal como esta escrita, api/urls.py con url(r'^...$')-, porque lo que puede
fallar es justo la costura con ESE codigo.

Lo que mas importa, por orden:

1. QUE LA COMPROBACION QUEDE ANTES DE CREAR EL TOKEN. Despues, el token ya
   estaria entregado cuando se rechaza, y el rechazo no serviria de nada.
   Y DESPUES de comprobar la clave: antes, le diria "equipo distinto" a
   quien escribio mal la contrasena, contandole a un desconocido que esa
   cuenta existe.
2. QUE LA REGLA SEA LA REGLA. `decidir` separa "entra" de "no entra" y un
   fallo ahi no se ve en ninguna pantalla. Se extrae y se ejecuta.
3. QUE NO SE ESCRIBA path(). Django 1.8 no lo tiene: el proyecto no
   arrancaria.
4. QUE DOS PASADAS NO DUPLIQUEN NADA.
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

LOGIN = '''from django.contrib.auth import authenticate

from rest_framework import authentication, permissions, status
from rest_framework.authtoken.models import Token
from rest_framework.response import Response
from rest_framework.views import APIView

from src.apps.core.mobile_role_panels import get_mobile_role_panels

MOBILE_ROLE_PANELS = get_mobile_role_panels()


class MobileAuthLoginView(APIView):
    permission_classes = [permissions.AllowAny]

    def post(self, request, *args, **kwargs):
        username = request.data.get('username', '')
        password = request.data.get('password', '')

        user = authenticate(username=username, password=password)
        if user is None:
            return Response(
                {'ok': False, 'detail': 'Credenciales invalidas.'},
                status=status.HTTP_401_UNAUTHORIZED
            )

        profile = _build_mobile_profile(user)
        if profile is None:
            return Response(
                {'ok': False, 'detail': 'Acceso movil denegado.'},
                status=status.HTTP_403_FORBIDDEN
            )

        token, _ = Token.objects.get_or_create(user=user)
        return Response(
            {
                'ok': True,
                'token': token.key,
                'user': profile['user'],
            },
            status=status.HTTP_200_OK
        )


class MobileAuthLogoutView(APIView):
    authentication_classes = [authentication.TokenAuthentication]

    def post(self, request, *args, **kwargs):
        Token.objects.filter(user=request.user).delete()
        return Response({'ok': True}, status=status.HTTP_200_OK)
'''

URLS = '''from django.conf.urls import url

from src.apps.api.views.mobile_auth import (
    MobileAuthLoginView, MobileAuthLogoutView,
)

urlpatterns = [
    url(r'^v1/mobile/auth/login/$', MobileAuthLoginView.as_view(), name='mobile_auth_login'),
    url(r'^v1/mobile/auth/logout/$', MobileAuthLogoutView.as_view(), name='mobile_auth_logout'),
]
'''

MODELS = '''from django.db import models


class DeviceVisit(models.Model):
    reason = models.CharField(max_length=50)
'''

mal = [0]; bien = [0]


def t(etiqueta, ok, extra=""):
    if ok:
        bien[0] += 1
        return
    mal[0] += 1
    print("MAL  %s%s" % (etiqueta, ("   [%s]" % extra) if extra else ""))


def monta(base, login=LOGIN, urls=URLS, models=MODELS):
    for d in ("src/apps/core", "src/apps/api/views"):
        os.makedirs(os.path.join(base, d))
    esc = lambda p, x: io.open(os.path.join(base, p), "w",
                               encoding="utf-8").write(x)
    esc("src/apps/core/models.py", models)
    esc("src/apps/api/urls.py", urls)
    esc("src/apps/api/views/mobile_auth.py", login)
    return base


def corre(base, aplicar=True):
    cmd = [sys.executable, "-I", PARCHE, "--base", base]
    if aplicar:
        cmd.append("--aplicar")
    r = subprocess.run(cmd, capture_output=True, text=True)
    return r.returncode, r.stdout + r.stderr


def lee(base, p):
    r = os.path.join(base, p)
    return io.open(r, encoding="utf-8").read() if os.path.isfile(r) else ""


# ── 1. Aplica ─────────────────────────────────────────────────────────────
tmp = monta(tempfile.mkdtemp())
c, s = corre(tmp)
t("aplica", c == 0, s.strip()[-250:])

m = lee(tmp, "src/apps/core/models.py")
mod = lee(tmp, "src/apps/core/equipo_enlazado.py")
u = lee(tmp, "src/apps/api/urls.py")
lg = lee(tmp, "src/apps/api/views/mobile_auth.py")
cmd = lee(tmp, "src/apps/core/management/commands/botar_a_todos.py")

for n, txt in (("models.py", m), ("equipo_enlazado.py", mod),
               ("urls.py", u), ("mobile_auth.py", lg),
               ("botar_a_todos.py", cmd)):
    if not txt:
        t("%s existe" % n, False); continue
    try:
        ast.parse(txt); t("%s es Python valido" % n, True)
    except SyntaxError as e:
        t("%s es Python valido" % n, False, str(e))

# ── EL ORDEN DENTRO DEL LOGIN: lo que mas duele si falla ─────────────────
t("la comprobacion entra en el login", "registrar_ingreso(" in lg)
t("ANTES de crear el token",
  lg.index("registrar_ingreso(") < lg.index("Token.objects.get_or_create"),
  "despues, el token ya estaria entregado cuando se rechaza")
t("y DESPUES de comprobar la clave",
  lg.index("authenticate(username") < lg.index("registrar_ingreso("),
  "antes, le diria 'equipo distinto' a quien escribio mal la clave")
t("y despues del perfil, que ya decide quien puede entrar",
  lg.index("_build_mobile_profile(user)") < lg.index("registrar_ingreso("))
t("responde 403, no 401: la clave era correcta",
  "HTTP_403_FORBIDDEN" in lg.split("registrar_ingreso(")[1][:400])
t("y mantiene la forma de la respuesta -{ok: False}-",
  "error_equipo['ok'] = False" in lg)
t("el logout no se toca",
  "Token.objects.filter(user=request.user).delete()" in lg)
t("el import entra una sola vez",
  lg.count("from src.apps.core.equipo_enlazado import") == 1,
  str(lg.count("from src.apps.core.equipo_enlazado import")))

# ── DJANGO 1.8: nada de path() ───────────────────────────────────────────
t("las rutas se escriben con url(), no con path()",
  "path(" not in u and "url(r'^v1/mobile/auth/dispositivos/$'" in u,
  "Django 1.8 no tiene path(): el proyecto no arrancaria")
t("la de liberar lleva su grupo nombrado",
  "(?P<pk>[0-9]+)/liberar/$" in u)
t("la de liberar va DESPUES de la del listado",
  u.index("dispositivos/$") < u.index("liberar/$"))
t("sin perder las rutas que ya estaban",
  "mobile_auth_login" in u and "mobile_auth_logout" in u)
t("y el modulo tampoco usa path()", "path(" not in mod)

# ── los modelos ──
t("las dos tablas entran en core/models.py",
  "class DispositivoAutorizado" in m and "class IngresoSinEquipo" in m)
t("con el import de settings, que hace falta para AUTH_USER_MODEL",
  "from django.conf import settings" in m)
t("sin tocar lo que ya habia", "class DeviceVisit" in m)
t("liberar DESACTIVA y firma, no borra",
  "self.activo = False" in m and "liberado_por" in m and "liberado_en" in m)
t("el enlace se borra si se borra el usuario, pero la firma no",
  "related_name='liberaciones'" in m and "SET_NULL" in m)

# ── el panel ──
t("el panel es solo para administradores",
  mod.count("@permission_classes([IsAdminUser])") == 2,
  str(mod.count("@permission_classes([IsAdminUser])")))
t("el identificador va recortado", "def _corto" in mod)
t("liberar dos veces no borra la primera firma",
  "ya_liberado" in mod and "HTTP_409_CONFLICT" in mod)
t("el interruptor nace apagado",
  "getattr(settings, 'EXIGIR_DISPOSITIVO', False)" in mod)
t("is_authenticated se llama como metodo, que en 1.8 no es propiedad",
  "is_authenticated()" in mod)


# ── 1b. LA REGLA, CORRIENDOLA ────────────────────────────────────────────
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
    mm = re.search(r"^%s = '([^']+)'" % nombre, mod, re.M)
    ns[nombre] = mm.group(1) if mm else nombre.lower()
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
t("diciendo que es otro equipo", decidir(E, "zzz999", False)[1] == "equipo_distinto")
t("la app vieja pasa mientras no se exija",
  decidir(E, "", False)[0] == ns["SIN_ID"])
t("y se corta cuando se exige", decidir(E, "", True)[0] == ns["CORTADO"])
t("mandando a ACTUALIZAR, no a soporte",
  decidir(E, "", True)[1] == "falta_device_id")

# El agujero que se abre solo: enlazar un identificador vacio. A partir de
# ahi, cualquier otra app vieja coincidiria con el.
for vacio in (None, "", "   ", "\t"):
    t("nunca se enlaza un identificador vacio (%r)" % vacio,
      decidir(None, vacio, False)[0] != ns["ENLAZA"])
    t("ni exigiendo (%r)" % vacio,
      decidir(None, vacio, True) == (ns["CORTADO"], "falta_device_id"))


# ── 2. Dos pasadas ───────────────────────────────────────────────────────
c2, s2 = corre(tmp)
t("la segunda pasada termina bien", c2 == 0, s2.strip()[-200:])
t("y dice que ya estaba", "ya estaba" in s2)
t("la comprobacion no se duplica",
  lee(tmp, "src/apps/api/views/mobile_auth.py").count("registrar_ingreso(") == 1)
t("ni las rutas",
  lee(tmp, "src/apps/api/urls.py").count("dispositivos/$") == 1)
t("ni las tablas",
  lee(tmp, "src/apps/core/models.py").count("class DispositivoAutorizado") == 1)


# ── 3. Si el login no es el esperado, se niega ───────────────────────────
OTRO = LOGIN.replace("        token, _ = Token.objects.get_or_create(user=user)",
                     "        token = mi_token(user)")
tmpO = monta(tempfile.mkdtemp(), login=OTRO)
cO, sO = corre(tmpO)
t("si el login no es el que espera, falla", cO != 0, sO.strip()[-200:])
t("sin estrellarse", "Traceback" not in sO, sO.strip()[-250:])
t("y sin dejar las tablas a medias",
  "DispositivoAutorizado" not in lee(tmpO, "src/apps/core/models.py"))
t("ni las rutas", "dispositivos" not in lee(tmpO, "src/apps/api/urls.py"))

# ── 4. Si la ruta del login no esta, tampoco ─────────────────────────────
tmpU = monta(tempfile.mkdtemp(), urls="from django.conf.urls import url\n\nurlpatterns = []\n")
cU, sU = corre(tmpU)
t("sin la ruta del login en urls.py, falla", cU != 0, sU.strip()[-200:])
t("y no toca el login", "registrar_ingreso" not in
  lee(tmpU, "src/apps/api/views/mobile_auth.py"))

# ── 5. Sin --aplicar no escribe ──────────────────────────────────────────
tmpD = monta(tempfile.mkdtemp())
cD, sD = corre(tmpD, aplicar=False)
t("en seco termina bien", cD == 0, sD.strip()[-200:])
t("y no escribe nada",
  "registrar_ingreso" not in lee(tmpD, "src/apps/api/views/mobile_auth.py")
  and not os.path.isfile(os.path.join(tmpD, "src/apps/core/equipo_enlazado.py")))

for d in (tmp, tmpO, tmpU, tmpD):
    shutil.rmtree(d, ignore_errors=True)

print("\n%d comprobacion(es) en orden%s." % (bien[0], ", %d MAL" % mal[0] if mal[0] else ""))
sys.exit(1 if mal[0] else 0)
