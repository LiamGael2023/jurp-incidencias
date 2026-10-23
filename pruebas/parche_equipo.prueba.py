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


def monta(base, login=LOGIN, urls=URLS, models=MODELS, migraciones=True):
    for d in ("src/apps/core", "src/apps/api/views"):
        os.makedirs(os.path.join(base, d))
    esc = lambda p, x: io.open(os.path.join(base, p), "w",
                               encoding="utf-8").write(x)
    esc("src/apps/core/models.py", models)
    esc("src/apps/api/urls.py", urls)
    esc("src/apps/api/views/mobile_auth.py", login)
    # La migracion la escribe el parche, porque en ese servidor
    # makemigrations no puede: /app esta montado en solo lectura. Necesita
    # saber de cual cuelga, asi que la carpeta tiene que existir.
    if migraciones:
        os.makedirs(os.path.join(base, "src/apps/core/migrations"))
        esc("src/apps/core/migrations/__init__.py", "")
        # Dos, no una: con una sola, colgar de la primera y de la ultima es
        # lo mismo y el fallo no se ve.
        esc("src/apps/core/migrations/0001_initial.py", "# vacio\n")
        esc("src/apps/core/migrations/0003_algo.py", "# vacio\n")
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
# `antes` en vez de .index(): si el parche se niega, lg viene vacio y un
# .index crudo revienta la prueba entera y se pierden las otras 80. Una
# prueba que se estrella tapa las demas; una que dice MAL, no.
def antes(txt, a, b):
    return a in txt and b in txt and txt.index(a) < txt.index(b)


t("la comprobacion entra en el login", "registrar_ingreso(" in lg)
t("ANTES de crear el token",
  antes(lg, "registrar_ingreso(", "Token.objects.get_or_create"),
  "despues, el token ya estaria entregado cuando se rechaza")
t("y DESPUES de comprobar la clave",
  antes(lg, "authenticate(username", "registrar_ingreso("),
  "antes, le diria 'equipo distinto' a quien escribio mal la clave")
t("y despues del perfil, que ya decide quien puede entrar",
  antes(lg, "_build_mobile_profile(user)", "registrar_ingreso("))
t("responde 403, no 401: la clave era correcta",
  "HTTP_403_FORBIDDEN" in (lg.split("registrar_ingreso(") + [""])[1][:400])
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
  antes(u, "dispositivos/$", "liberar/$"))
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


ns = {"WEB": "web"}
for nombre in ("CORTADO", "ENLAZA", "SIGUE", "SIN_ID", "EXENTO"):
    mm = re.search(r"^%s = '([^']+)'" % nombre, mod, re.M)
    ns[nombre] = mm.group(1) if mm else nombre.lower()

# Si el parche se nego, mod viene vacio y no hay regla que correr. Se apunta
# como MAL y se sigue: unas comprobaciones menos, pero las demas se ven.
if "def decidir(" in mod:
    exec(saca(mod, "decidir"), ns)
    exec(saca(mod, "es_navegador"), ns)
    decidir = ns["decidir"]
    es_navegador = ns["es_navegador"]
else:
    t("hay una regla que correr", False, "equipo_enlazado.py no se escribio")
    decidir = lambda *a, **k: (None, None)
    es_navegador = lambda *a, **k: None


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

# ── EL NAVEGADOR VA EXENTO ───────────────────────────────────────────────
# Lo que esto evita, y es lo que mas duele si se olvida: la web no manda ni
# va a mandar identificador de equipo. Contandola, el numero de "sin
# identificar" -el que decide cuando se puede encender el bloqueo- no llega
# a cero nunca. Y el dia del encendido, la web deja de entrar para TODOS.
t("el navegador no se enlaza aunque no tenga equipo",
  decidir(None, "", False, True)[0] == ns["EXENTO"])
t("ni aun exigiendo equipo", decidir(None, "", True, True)[0] == ns["EXENTO"],
  "es el dia del encendido: aqui es donde la web se caeria")
t("ni se corta por venir de otro equipo",
  decidir(E, "zzz999", True, True)[0] == ns["EXENTO"])
t("y no devuelve codigo de error", decidir(None, "", True, True)[1] is None)

# Pero SOLO un 'web' explicito. Si la ausencia contara como navegador, la app
# vieja -que tampoco manda plataforma- quedaria exenta y el bloqueo no
# morderia a nadie: la medida entera se queda en nada sin que salte un error.
for dice, deberia in (("web", True), ("WEB", True), (" web ", True),
                      ("Web", True), ("android", False), ("ios", False),
                      ("", False), (None, False), ("webapp", False),
                      ("mobile-web", False)):
    t("es_navegador(%r) -> %s" % (dice, deberia),
      es_navegador(dice) == deberia)

# LAS DOS MITADES. El servidor exime a quien dice 'web'; la web tiene que
# decirlo. Si una de las dos cambia sin la otra, esto se rompe en silencio
# hasta el dia del encendido, asi que la prueba mira las dos.
LOGIN_WEB = io.open(os.path.join(os.path.dirname(AQUI), "src", "Login.jsx"),
                    encoding="utf-8").read() if os.path.isfile(
    os.path.join(os.path.dirname(AQUI), "src", "Login.jsx")) else ""
t("la web existe y se puede leer", bool(LOGIN_WEB))
t("y se identifica como 'web' al entrar", "plataforma: 'web'" in LOGIN_WEB,
  "sin esto, el dia del encendido la web no entra")

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

# ── 2b. La migracion ─────────────────────────────────────────────────────
# Se escribe a mano porque makemigrations no puede: escribe el fichero en la
# misma carpeta montada en solo lectura. Que diga lo mismo que los modelos lo
# comprueba migracion_equipo.prueba.py campo por campo; aqui solo que salga,
# con el numero siguiente y colgando de la ultima.
mg = lee(tmp, "src/apps/core/migrations/0004_equipo_enlazado.py")
t("la migracion se escribe con el numero siguiente", bool(mg))
t("y cuelga de la ultima que habia", "('core', '0003_algo')" in mg)
t("y crea las dos tablas",
  "name='DispositivoAutorizado'" in mg and "name='IngresoSinEquipo'" in mg)
try:
    ast.parse(mg); t("la migracion es Python valido", True)
except SyntaxError as e:
    t("la migracion es Python valido", False, str(e))
t("en la segunda pasada no escribe otra",
  not os.path.isfile(os.path.join(tmp,
      "src/apps/core/migrations/0005_equipo_enlazado.py")))

# Sin carpeta de migraciones no se inventa de donde cuelga: una migracion
# colgada de la nada no se aplica, y eso se descubre migrando.
tmpM = monta(tempfile.mkdtemp(), migraciones=False)
cM, sM = corre(tmpM)
t("sin core/migrations, se niega", cM != 0, sM.strip()[-200:])
t("y no toca nada", "registrar_ingreso" not in
  lee(tmpM, "src/apps/api/views/mobile_auth.py")
  and "DispositivoAutorizado" not in lee(tmpM, "src/apps/core/models.py"))


# ── 4b. urls.py, como venga ──────────────────────────────────────────────
# POR QUE ESTA SECCION. La primera version buscaba `urlpatterns = [` para
# meter el import encima, y en el servidor se nego: ese fichero no lo tiene.
# Django 1.8 admite varias formas, y el parche no puede exigir una. Lo que
# se comprueba aqui no es que el texto aparezca, sino que el fichero
# resultante PARSEA y que la ruta del login sigue en su sitio.
FORMAS = {
    "patterns('', ...) -- la forma vieja de Django 1.8": '''from django.conf.urls import patterns, url

from src.apps.api.views.mobile_auth import MobileAuthLoginView

urlpatterns = patterns('',
    url(r'^v1/mobile/auth/login/$', MobileAuthLoginView.as_view(), name='mobile_auth_login'),
)
''',
    "urlpatterns += [": '''from django.conf.urls import url

from src.apps.api.views.mobile_auth import MobileAuthLoginView

urlpatterns = []
urlpatterns += [
    url(r'^v1/mobile/auth/login/$', MobileAuthLoginView.as_view(), name='mobile_auth_login'),
]
''',
    # El caso que de verdad puede partir un fichero: si el import nuevo cae
    # dentro del parentesis de otro, el fichero deja de ser Python.
    "import de varias lineas justo antes": '''from django.conf.urls import url
from src.apps.api.views.mobile_auth import (
    MobileAuthLoginView,
    MobileAuthLogoutView,
)
from src.apps.api.views import otros

urlpatterns = [
    url(r'^v1/mobile/auth/login/$', MobileAuthLoginView.as_view(), name='mobile_auth_login'),
]
''',
    "la ruta en dos lineas": '''from django.conf.urls import url
from src.apps.api.views.mobile_auth import MobileAuthLoginView

urlpatterns = [
    url(r'^v1/mobile/auth/login/$',
        MobileAuthLoginView.as_view(), name='mobile_auth_login'),
]
''',
    "sin salto final": "from django.conf.urls import url\n"
                       "from src.apps.api.views.mobile_auth import MobileAuthLoginView\n"
                       "\n"
                       "urlpatterns = [\n"
                       "    url(r'^v1/mobile/auth/login/$', MobileAuthLoginView.as_view(),"
                       " name='mobile_auth_login'),\n"
                       "]",
}

sucios = []
for nombre, forma in sorted(FORMAS.items()):
    d = monta(tempfile.mkdtemp(), urls=forma)
    sucios.append(d)
    cf, sf = corre(d)
    t("urls.py %s: aplica" % nombre, cf == 0, sf.strip()[-220:])
    r = lee(d, "src/apps/api/urls.py")
    try:
        ast.parse(r); ok_py = True
    except SyntaxError as e:
        ok_py = False; detalle = str(e)
    t("urls.py %s: sigue siendo Python" % nombre, ok_py,
      "" if ok_py else detalle)
    t("urls.py %s: entra la ruta del panel" % nombre,
      r.count("dispositivos/$") == 1)
    t("urls.py %s: y la del login sigue" % nombre,
      r.count("mobile_auth_login") == 1)
    t("urls.py %s: el import no queda suelto dentro de otro" % nombre,
      "equipo_enlazado import (" in r)

# ── 4c. El sabotaje: que el guardia de sintaxis muerda de verdad ─────────
# Se rompe el parche para que meta el import encima del PRIMER import en vez
# de debajo del ultimo. Con un import de varias lineas eso lo parte, y es
# justo el fallo que no se nota hasta que el proyecto no arranca.
fuente = io.open(PARCHE, encoding="utf-8").read()
t("el guardia de sintaxis esta en el parche", "ast.parse(nuevo)" in fuente)

roto = fuente.replace("    i = fin_de_imports(texto, m.start())",
                      "    i = texto.index('from src.apps.api.views') + 30")
t("el sabotaje cambia algo", roto != fuente)
pr = os.path.join(tempfile.mkdtemp(), "roto.py")
io.open(pr, "w", encoding="utf-8").write(roto)
dS = monta(tempfile.mkdtemp(), urls=FORMAS["import de varias lineas justo antes"])
sucios += [dS, os.path.dirname(pr)]
rS = subprocess.run([sys.executable, "-I", pr, "--base", dS, "--aplicar"],
                    capture_output=True, text=True)
sS = rS.stdout + rS.stderr
t("partiendo un import, el parche se niega", rS.returncode != 0, sS.strip()[-220:])
t("y lo dice por su nombre", "urls.py quedaria roto" in sS, sS.strip()[-220:])
t("y no escribe nada",
  "dispositivos" not in lee(dS, "src/apps/api/urls.py")
  and "registrar_ingreso" not in lee(dS, "src/apps/api/views/mobile_auth.py"))

# ── 4d. Montado en solo lectura ──────────────────────────────────────────
# LO QUE PASO DE VERDAD. En jurp_web, /app esta montado read-only. El parche
# se estrello en el primer respaldo con OSError: Read-only file system. No
# escribio nada, pero por el orden del bucle: si el fichero sin permiso
# hubiera sido el tercero, los dos primeros ya estarian cambiados, y eso es
# justo lo que este parche promete no hacer.
#
# chmod no sirve para probarlo: estas pruebas corren como root y W_OK
# devuelve True sobre un 0444. Se finge con os.access, que es la pregunta
# que hace el parche.
ENVOLTORIO = '''
import io, os, sys
victima = sys.argv[1]
real = os.access
os.access = lambda p, m=os.F_OK: False if p.endswith(victima) else real(p, m)
sys.argv = [sys.argv[2]] + sys.argv[3:]
try:
    exec(compile(io.open(sys.argv[0], encoding="utf-8").read(),
                 sys.argv[0], "exec"),
         {"__name__": "__main__", "__file__": sys.argv[0]})
    codigo = 0
except SystemExit as e:
    codigo = e.code or 0
sys.exit(codigo)
'''
dE = tempfile.mkdtemp()
env = os.path.join(dE, "env.py")
io.open(env, "w", encoding="utf-8").write(ENVOLTORIO)
sucios.append(dE)

for victima, etiqueta in (("models.py", "el primero de la lista"),
                          ("mobile_auth.py", "el ULTIMO de la lista"),
                          ("views", "la carpeta, no el fichero")):
    dRO = monta(tempfile.mkdtemp())
    sucios.append(dRO)
    rR = subprocess.run([sys.executable, "-I", env, victima, PARCHE,
                         "--base", dRO, "--aplicar"],
                        capture_output=True, text=True)
    sR = rR.stdout + rR.stderr
    t("solo lectura (%s): se niega" % etiqueta, rR.returncode != 0,
      sR.strip()[-200:])
    t("solo lectura (%s): sin estrellarse" % etiqueta,
      "Traceback" not in sR, sR.strip()[-300:])
    t("solo lectura (%s): dice que se parchea en el host" % etiqueta,
      "EN EL HOST" in sR, sR.strip()[-200:])
    # Lo que de verdad importa: que NINGUNO quedo a medias.
    t("solo lectura (%s): models.py intacto" % etiqueta,
      "DispositivoAutorizado" not in lee(dRO, "src/apps/core/models.py"))
    t("solo lectura (%s): urls.py intacto" % etiqueta,
      "dispositivos" not in lee(dRO, "src/apps/api/urls.py"))
    t("solo lectura (%s): el login intacto" % etiqueta,
      "registrar_ingreso" not in lee(dRO, "src/apps/api/views/mobile_auth.py"))
    t("solo lectura (%s): ni el modulo nuevo" % etiqueta,
      not os.path.isfile(os.path.join(dRO, "src/apps/core/equipo_enlazado.py")))
    t("solo lectura (%s): ni respaldos a medias" % etiqueta,
      not [x for x in os.listdir(os.path.join(dRO, "src/apps/core"))
           if ".bak-" in x])

# Y en seco tambien avisa: un ensayo que dice "verde" donde el real no puede
# escribir no sirve de nada -fue lo que paso-.
dSec = monta(tempfile.mkdtemp())
sucios.append(dSec)
rSec = subprocess.run([sys.executable, "-I", env, "models.py", PARCHE,
                       "--base", dSec],
                      capture_output=True, text=True)
t("en seco tambien avisa de que no podra escribir",
  rSec.returncode != 0 and "EN EL HOST" in (rSec.stdout + rSec.stderr),
  (rSec.stdout + rSec.stderr).strip()[-200:])

# ── 5. Sin --aplicar no escribe ──────────────────────────────────────────
tmpD = monta(tempfile.mkdtemp())
cD, sD = corre(tmpD, aplicar=False)
t("en seco termina bien", cD == 0, sD.strip()[-200:])
t("y no escribe nada",
  "registrar_ingreso" not in lee(tmpD, "src/apps/api/views/mobile_auth.py")
  and not os.path.isfile(os.path.join(tmpD, "src/apps/core/equipo_enlazado.py")))

for d in [tmp, tmpO, tmpU, tmpD, tmpM] + sucios:
    shutil.rmtree(d, ignore_errors=True)

print("\n%d comprobacion(es) en orden%s." % (bien[0], ", %d MAL" % mal[0] if mal[0] else ""))
sys.exit(1 if mal[0] else 0)
