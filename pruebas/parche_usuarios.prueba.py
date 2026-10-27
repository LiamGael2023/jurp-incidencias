# -*- coding: utf-8 -*-
"""parche_usuarios_sentria.py, probado contra un proyecto de mentira.

    python3 pruebas/parche_usuarios.prueba.py

El molde imita lo que de verdad hay en api_vigilantes: un urls.py que arma
sus rutas con un router de DRF -por eso las rutas salen como ^operadores/$-,
que es justo la forma que hace fragil meterse dentro de urlpatterns.

LO QUE VIGILA, por orden de lo que duele:

 1. QUE LAS FUNCIONES PURAS DECIDAN BIEN. Se ejecutan, no se leen. La que mas
    importa es la del encierro: hoy hay UNA sola cuenta en Gerencia, y si esa
    persona se quita el rol a si misma, nadie puede volver a administrar
    cuentas desde la web.

 2. QUE EL MODULO NO USE NOMBRES QUE NO IMPORTA. Un `re.compile` sin
    `import re` parsea perfectamente y revienta al arrancar el servidor, con
    el proyecto entero caido. ast.parse no lo ve; esto si.

 3. QUE urls.py SIGA SIENDO PYTHON y conserve lo que tenia.

 4. QUE DOS PASADAS NO DUPLIQUEN NADA.
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
PARCHE = os.path.join(AQUI, "parche_usuarios_sentria.py")

mal = [0]; bien = [0]


def t(etiqueta, ok, extra=""):
    if ok:
        bien[0] += 1
        return
    mal[0] += 1
    print("MAL  %s%s" % (etiqueta, ("   [%s]" % extra) if extra else ""))


# ── el molde ─────────────────────────────────────────────────────────────
URLS = '''from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import OperadorViewSet, RegistroTomaViewSet, VigilanteViewSet

router = DefaultRouter()
router.register(r'operadores', OperadorViewSet, basename='operador')
router.register(r'registros', RegistroTomaViewSet, basename='registro')
router.register(r'vigilantes', VigilanteViewSet, basename='vigilante')

urlpatterns = router.urls
'''

VIEWS = '''from rest_framework import viewsets


class OperadorViewSet(viewsets.ModelViewSet):
    pass


class RegistroTomaViewSet(viewsets.ModelViewSet):
    pass


class VigilanteViewSet(viewsets.ModelViewSet):
    pass
'''


def monta(base, urls=URLS):
    os.makedirs(os.path.join(base, "auth_api"))
    esc = lambda p, x: io.open(os.path.join(base, p), "w",
                               encoding="utf-8").write(x)
    esc("auth_api/__init__.py", "")
    esc("auth_api/urls.py", urls)
    esc("auth_api/views.py", VIEWS)
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


# ── 1. aplica ────────────────────────────────────────────────────────────
tmp = monta(tempfile.mkdtemp())
c, s = corre(tmp)
t("aplica", c == 0, s.strip()[-250:])

mod = lee(tmp, "auth_api/usuarios_web.py")
urls = lee(tmp, "auth_api/urls.py")

for nombre, txt in (("usuarios_web.py", mod), ("urls.py", urls)):
    if not txt:
        t("%s existe" % nombre, False); continue
    try:
        ast.parse(txt); t("%s es Python valido" % nombre, True)
    except SyntaxError as e:
        t("%s es Python valido" % nombre, False, str(e))


# ── 2. NOMBRES SIN IMPORTAR ──────────────────────────────────────────────
# El fallo que ast.parse no ve y tumba el servidor entero al arrancar: usar
# `re.compile` sin `import re`. Se recorre el arbol y se comprueba que todo
# nombre que se lee este definido, importado, o sea de Python.
def nombres_sueltos(fuente):
    arbol = ast.parse(fuente)
    definidos = set(dir(__builtins__)) | set(vars(__builtins__)) if not isinstance(
        __builtins__, dict) else set(__builtins__)
    definidos |= {"__name__", "__file__", "__doc__", "self", "cls"}

    class Recoge(ast.NodeVisitor):
        def __init__(self):
            self.usados = []
        def visit_Import(self, n):
            for a in n.names:
                definidos.add((a.asname or a.name).split('.')[0])
        def visit_ImportFrom(self, n):
            for a in n.names:
                definidos.add(a.asname or a.name)
        def visit_FunctionDef(self, n):
            definidos.add(n.name)
            for a in n.args.args + n.args.kwonlyargs:
                definidos.add(a.arg)
            if n.args.vararg: definidos.add(n.args.vararg.arg)
            if n.args.kwarg: definidos.add(n.args.kwarg.arg)
            self.generic_visit(n)
        def visit_ClassDef(self, n):
            definidos.add(n.name)
            self.generic_visit(n)
        def visit_Assign(self, n):
            for d in n.targets:
                for x in ast.walk(d):
                    if isinstance(x, ast.Name):
                        definidos.add(x.id)
            self.generic_visit(n)
        def visit_For(self, n):
            for x in ast.walk(n.target):
                if isinstance(x, ast.Name):
                    definidos.add(x.id)
            self.generic_visit(n)
        def visit_comprehension(self, n):
            for x in ast.walk(n.target):
                if isinstance(x, ast.Name):
                    definidos.add(x.id)
            self.generic_visit(n)
        def visit_ExceptHandler(self, n):
            if n.name: definidos.add(n.name)
            self.generic_visit(n)
        def visit_With(self, n):
            for it in n.items:
                if it.optional_vars is not None:
                    for x in ast.walk(it.optional_vars):
                        if isinstance(x, ast.Name):
                            definidos.add(x.id)
            self.generic_visit(n)
        def visit_Name(self, n):
            if isinstance(n.ctx, ast.Load):
                self.usados.append(n.id)
            self.generic_visit(n)

    # Dos pasadas: la primera recoge TODO lo definido -incluidas funciones
    # que se usan antes de declararse-, la segunda juzga.
    r = Recoge(); r.visit(arbol)
    for n in ast.walk(arbol):
        if isinstance(n, ast.comprehension):
            for x in ast.walk(n.target):
                if isinstance(x, ast.Name):
                    definidos.add(x.id)
    return sorted({u for u in r.usados if u not in definidos})


if mod:
    sueltos = nombres_sueltos(mod)
    t("usuarios_web.py no usa nada sin importar", not sueltos,
      ", ".join(sueltos))
    # Y que la prueba sirva de algo: con `import re` quitado, tiene que verlo.
    sin_re = mod.replace("import re\n", "", 1)
    t("y la comprobacion muerde si falta un import",
      "re" in nombres_sueltos(sin_re),
      "sin 'import re' deberia salir 're' como suelto")


# ── 3. LAS REGLAS, CORRIENDOLAS ──────────────────────────────────────────
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
for cte in ("GRUPO_ADMIN", "LARGO_CLAVE"):
    import re as _re
    m = _re.search(r"^%s = (.+)$" % cte, mod, _re.M)
    if m:
        ns[cte] = ast.literal_eval(m.group(1).split('#')[0].strip())
m = __import__("re").search(r"^ETIQUETAS = \{(.+?)\n\}", mod,
                            __import__("re").S | __import__("re").M)
ns["ETIQUETAS"] = ast.literal_eval("{%s\n}" % m.group(1)) if m else {}

for fn in ("etiqueta_de", "puede_administrar", "decidir_cambio",
           "decidir_desactivar"):
    if "def %s(" % fn in mod:
        exec(saca(mod, fn), ns)
    else:
        t("existe %s" % fn, False)

# Quien administra en SENTRIA son los supervisores, no Gerencia: en
# vigilancia quien da de alta a un vigilante es su supervisor.
ADMIN = ns.get("GRUPO_ADMIN", "supervisor_group")
t("quien administra es el supervisor, no Gerencia",
  ADMIN == "supervisor_group", ADMIN)

# ── las etiquetas ──
if "etiqueta_de" in ns:
    eti = ns["etiqueta_de"]
    t("los grupos conocidos tienen su nombre",
      eti("vigilante_group") == "Vigilante"
      and eti("mobile_gerencia") == "Gerencia"
      and eti(ADMIN) == "Supervisor",
      "%s / %s / %s" % (eti("vigilante_group"), eti("mobile_gerencia"),
                        eti(ADMIN)))
    # Lo que importa de verdad: un grupo que todavia no existe sale legible y
    # no en blanco. Si saliera vacio, el desplegable tendria una opcion muda.
    t("y uno nuevo se deduce solo",
      eti("brigadista_group") == "Brigadista", eti("brigadista_group"))
    t("sin dejarlo en blanco", eti("otro_rol_raro") not in ("", None),
      repr(eti("otro_rol_raro")))
    t("ni reventar con vacio", eti("") == "" and eti(None) in ("", None))

# ── quien manda ──
if "puede_administrar" in ns:
    pa = ns["puede_administrar"]
    t("el supervisor administra", pa(False, [ADMIN]) is True)
    t("is_staff tambien", pa(True, []) is True,
      "sin esto, un despliegue nuevo se queda sin nadie que cree al primero")
    t("un vigilante NO administra", pa(False, ["vigilante_group"]) is False)
    t("pero Gerencia NO, que aqui no es ese grupo",
  pa(False, ["mobile_gerencia"]) is False,
  "en SENTRIA mobile_gerencia es una cuenta de prueba, no un rol real")
    t("ni sin grupos", pa(False, []) is False)
    t("ni con grupos a None", pa(False, None) is False)

# ── EL ENCIERRO, que es lo que de verdad duele ──
if "decidir_cambio" in ns:
    dc = ns["decidir_cambio"]
    # Hoy hay UNA cuenta en Gerencia. Que se quite el rol a si misma deja el
    # sistema sin quien administre, y el unico remedio es entrar al servidor.
    t("el unico que administra no puede dejar de hacerlo",
      dc(7, 7, ADMIN, "vigilante_group", {7})[0] is False)
    t("y se dice por que",
      "unica cuenta" in (dc(7, 7, ADMIN, "vigilante_group", {7})[1] or ""),
      dc(7, 7, ADMIN, "vigilante_group", {7})[1])
    t("tampoco si lo intenta otro admin... que no existe",
      dc(9, 7, ADMIN, "vigilante_group", {7})[0] is False)
    t("con DOS, uno puede dejar de serlo",
      dc(9, 7, ADMIN, "vigilante_group", {7, 9})[0] is True)
    t("pero no a si mismo, aunque haya otro",
      dc(7, 7, ADMIN, "vigilante_group", {7, 9})[0] is False,
      "quitarse el propio permiso es el error que nadie quiere deshacer a mano")
    t("subir a alguien a Gerencia siempre se puede",
      dc(7, 3, "vigilante_group", ADMIN, {7})[0] is True)
    t("y cambiar entre roles que no son Gerencia, tambien",
      dc(7, 3, "vigilante_group", "operador_group", {7})[0] is True)
    t("un gerente que sigue de gerente no se bloquea",
      dc(7, 7, ADMIN, ADMIN, {7})[0] is True)

if "decidir_desactivar" in ns:
    dd = ns["decidir_desactivar"]
    t("nadie se desactiva a si mismo",
      dd(7, 7, True, "vigilante_group", {9})[0] is False)
    t("no se desactiva al ultimo que administra",
      dd(9, 7, True, ADMIN, {7})[0] is False)
    t("con dos si",
      dd(9, 7, True, ADMIN, {7, 9})[0] is True)
    t("desactivar a un vigilante cualquiera se puede",
      dd(9, 3, True, "vigilante_group", {7})[0] is True)
    t("y REACTIVAR nunca se bloquea",
      dd(7, 7, False, ADMIN, set())[0] is True,
      "bloquear la reactivacion dejaria cuentas apagadas para siempre")


# ── 4. LA CLAVE ──────────────────────────────────────────────────────────
import re as rex
m = rex.search(r"^ALFABETO = '([^']+)'", mod, rex.M)
alfabeto = m.group(1) if m else ""
t("hay alfabeto de claves", bool(alfabeto))
# Se dictan por telefono y se copian de un papel: una O confundida con un
# cero es una llamada a soporte.
for c in "0O1lI":
    t("la clave no puede traer %r" % c, c not in alfabeto)
t("pero si letras y numeros suficientes", len(alfabeto) >= 40, str(len(alfabeto)))
t("y la clave es larga", ns.get("LARGO_CLAVE", 0) >= 10,
  str(ns.get("LARGO_CLAVE")))


# ── 4b. EL ORDEN DE LOS ROLES ────────────────────────────────────────────
# El rol que administra va ultimo. El desplegable de la web arranca sin nada elegido, pero
# si alguien quita esa opcion vacia, el primero queda preseleccionado: por
# un descuido crearia una cuenta capaz de administrar a todas las demas.
rx2 = __import__("re")
m = rx2.search(r"key=lambda g: \((.+?)\)", mod)
t("los roles no van en orden alfabetico a secas", m is not None)
if m:
    clave = eval("lambda g: (%s)" % m.group(1),
                 {"GRUPO_ADMIN": ADMIN},
                 {})
    class G(object):
        def __init__(self, n): self.name = n
    nombres = ['mobile_gerencia', 'operador_group', 'ssoma_group',
               ADMIN, 'vigilante_group']
    ordenados = [g.name for g in sorted([G(n) for n in nombres], key=clave)]
    t("el rol que administra queda al final",
  ordenados[-1] == ADMIN, " ".join(ordenados))
    t("y el primero es un rol sin poder", ordenados[0] != ADMIN, ordenados[0])
    t("los demas siguen en orden alfabetico",
      ordenados[:-1] == sorted(ordenados[:-1]), " ".join(ordenados))


# ── 5. urls.py ───────────────────────────────────────────────────────────
t("entran las siete rutas",
  urls.count("_path_uw('mobile/users") == 7,
  str(urls.count("_path_uw('mobile/users")))
for ruta in ("mobile/users/list/", "mobile/users/roles/",
             "mobile/users/<int:pk>/role/",
             "mobile/users/<int:pk>/reset-password/",
             "mobile/users/<int:pk>/toggle-active/",
             "mobile/users/<int:pk>/update/"):
    t("esta %s" % ruta, "'%s'" % ruta in urls)
t("y la de crear, sin sufijo", "_path_uw('mobile/users/', " in urls)

# Lo que ya estaba sigue estando: el router y sus tres registros.
for antes in ("router.register(r'operadores'", "router.register(r'registros'",
              "router.register(r'vigilantes'", "DefaultRouter()"):
    t("sigue estando: %s" % antes.split('(')[0], antes in urls)
t("no se pisa urlpatterns, se extiende",
  "list(urlpatterns) +" in urls,
  "ese fichero usa router.urls, que no es una lista")


# ── 6. dos pasadas ───────────────────────────────────────────────────────
c2, s2 = corre(tmp)
t("la segunda pasada termina bien", c2 == 0, s2.strip()[-200:])
u2 = lee(tmp, "auth_api/urls.py")
t("y no duplica las rutas", u2.count("_path_uw('mobile/users") == 7,
  str(u2.count("_path_uw('mobile/users")))
try:
    ast.parse(u2); t("ni rompe el fichero", True)
except SyntaxError as e:
    t("ni rompe el fichero", False, str(e))


# ── 7. cuando no reconoce el proyecto, se niega ──────────────────────────
tmpX = monta(tempfile.mkdtemp(),
             urls="from django.urls import path\n\nmisrutas = []\n")
cX, sX = corre(tmpX)
t("sin 'operadores' en ningun urls.py, falla", cX != 0, sX.strip()[-200:])
t("sin estrellarse", "Traceback" not in sX, sX.strip()[-250:])
t("y no deja el modulo suelto",
  not os.path.isfile(os.path.join(tmpX, "auth_api/usuarios_web.py")),
  "escribir las vistas sin rutas deja codigo muerto que nadie llama")

# Dos candidatos: tampoco adivina.
tmpD = monta(tempfile.mkdtemp())
os.makedirs(os.path.join(tmpD, "otra_app"))
io.open(os.path.join(tmpD, "otra_app/urls.py"), "w",
        encoding="utf-8").write(URLS)
cD, sD = corre(tmpD)
t("con dos urls.py candidatos, se niega", cD != 0, sD.strip()[-200:])
t("y los nombra", "otra_app" in sD and "auth_api" in sD)


# ── 8. en seco no escribe ────────────────────────────────────────────────
tmpS = monta(tempfile.mkdtemp())
cS, sS = corre(tmpS, aplicar=False)
t("en seco termina bien", cS == 0, sS.strip()[-200:])
t("y no escribe nada",
  not os.path.isfile(os.path.join(tmpS, "auth_api/usuarios_web.py"))
  and "mobile/users" not in lee(tmpS, "auth_api/urls.py"))

for d in (tmp, tmpX, tmpD, tmpS):
    shutil.rmtree(d, ignore_errors=True)

print("\n%d comprobacion(es) en orden%s."
      % (bien[0], ", %d MAL" % mal[0] if mal[0] else ""))
sys.exit(1 if mal[0] else 0)
