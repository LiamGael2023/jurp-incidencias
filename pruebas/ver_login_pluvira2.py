# -*- coding: utf-8 -*-
"""La vista del login, en el Django viejo de PLUVIRA.

    docker exec -i jurp_web python manage.py shell < ver_login_pluvira2.py

SOLO LEE.

POR QUE HAY UNA SEGUNDA VERSION. La primera se cayo con:

    no pude leer las urls: No module named 'django.urls'

`django.urls` aparecio en Django 1.10, asi que este proyecto es anterior. En
esa epoca el modulo era `django.core.urlresolvers`, y las rutas no eran
objetos con `.pattern` sino `RegexURLPattern` con `.regex.pattern`. Esto
prueba las dos formas y se queda con la que funcione.

NO ES UN DETALLE DE ESTE GUION: cambia lo que se puede escribir despues. Un
parche con `path('auth/dispositivos/', ...)` no arranca en Django 1.9, donde
se escribe `url(r'^auth/dispositivos/$', ...)`. Antes de generar nada hay
que saber la version exacta.

Lo que ya se sabe de la primera pasada, y no hace falta repetir:

    tokens        rest_framework.authtoken, user OneToOneField -> uno por
                  usuario, y entrar dos veces devuelve el mismo
    usuarios      164, todos activos; 45 con token vivo
    dispositivos  ninguna tabla de celulares; DeviceVisit es de visitas a
                  equipos de campo, otra cosa
"""

from __future__ import print_function

import inspect
import sys


def titulo(t):
    print("")
    print("=" * 74)
    print(t)
    print("=" * 74)


def seguro(fn, por_defecto="?"):
    try:
        return fn()
    except Exception as e:
        return "error: {0}".format(e)


# ──────────────────────────────────────────────────────────────────────
# 0. LAS VERSIONES, que mandan sobre todo lo demas
# ──────────────────────────────────────────────────────────────────────

titulo("0. VERSIONES")

import django

print("  python      : {0}".format(sys.version.split()[0]))
print("  django      : {0}".format(django.get_version()))
print("  rest_framew.: {0}".format(
    seguro(lambda: __import__("rest_framework").VERSION)))

viejo = django.VERSION < (1, 10)
print("")
print("  rutas con   : {0}".format(
    "url(r'^...$') -- Django viejo" if django.VERSION < (2, 0)
    else "path('...')"))
if viejo:
    print("  OJO: sin django.urls. Cualquier parche tiene que escribir")
    print("       url(r'^...$') y no path('...'), o el proyecto no arranca.")


# ──────────────────────────────────────────────────────────────────────
# 1. LAS RUTAS, probando las dos formas
# ──────────────────────────────────────────────────────────────────────

def resolver():
    try:
        from django.urls import get_resolver
        return get_resolver()
    except ImportError:
        from django.core.urlresolvers import get_resolver
        return get_resolver(None)


def patron_de(p):
    """El texto de la ruta, venga del Django que venga."""
    pat = getattr(p, "pattern", None)
    if pat is not None:
        return str(getattr(pat, "_route", None) or pat)
    # Django < 2.0: RegexURLPattern / RegexURLResolver
    rx = getattr(p, "regex", None)
    if rx is not None:
        return rx.pattern
    return "?"


def recorrer(patrones, prefijo=""):
    salida = []
    for p in patrones:
        trozo = patron_de(p)
        hijos = getattr(p, "url_patterns", None)
        if hijos is not None:
            salida.extend(recorrer(hijos, prefijo + trozo))
        else:
            salida.append((prefijo + trozo, getattr(p, "callback", None)))
    return salida


def clase_de(cb):
    for attr in ("cls", "view_class"):
        c = getattr(cb, attr, None)
        if c is not None:
            return c
    return None


titulo("1. LA VISTA DEL LOGIN")

try:
    todas = recorrer(resolver().url_patterns)
except Exception as e:
    todas = []
    print("  no pude leer las urls: {0}".format(e))

print("  rutas en el proyecto: {0}".format(len(todas)))
print("")

logins = [(r, cb) for (r, cb) in todas
          if any(x in r.lower() for x in ("login", "auth", "token"))]

if not logins:
    print("  Ninguna menciona login/auth/token. Las 30 primeras rutas:")
    for r, _ in todas[:30]:
        print("    {0}".format(r))

for ruta, cb in logins[:25]:
    cls = clase_de(cb)
    quien = cls if cls is not None else cb
    print("  {0}".format(ruta))
    print("      vista  : {0}".format(getattr(quien, "__name__", quien)))
    print("      modulo : {0}".format(getattr(quien, "__module__", "?")))
    print("      fichero: {0}".format(seguro(lambda: inspect.getsourcefile(quien))))
    if cls is not None:
        bases = [b.__name__ for b in getattr(cls, "__mro__", [])[1:5]]
        print("      hereda : {0}".format(" <- ".join(bases)))
    print("")


# ──────────────────────────────────────────────────────────────────────
# 2. EL CODIGO DE LA QUE ATIENDE EL LOGIN DEL MOVIL
# ──────────────────────────────────────────────────────────────────────

titulo("2. EL CODIGO DE LA VISTA DE /auth/login/")

elegida = None
for ruta, cb in logins:
    if "auth" in ruta and "login" in ruta:
        elegida = clase_de(cb) or cb
        break
if elegida is None:
    for ruta, cb in logins:
        if "login" in ruta:
            elegida = clase_de(cb) or cb
            break

if elegida is None:
    print("  no la encontre; mira la lista de arriba.")
else:
    print("  {0}  ({1})".format(getattr(elegida, "__name__", elegida),
                                getattr(elegida, "__module__", "?")))
    print("")
    fuente = seguro(lambda: inspect.getsource(elegida), None)
    if isinstance(fuente, str) and fuente.startswith("error"):
        print("  no pude leer el codigo: {0}".format(fuente))
    elif fuente:
        lineas = fuente.split("\n")
        print("  {0} lineas:".format(len(lineas)))
        print("")
        for l in lineas[:90]:
            print("    {0}".format(l))
        if len(lineas) > 90:
            print("    ... y {0} mas".format(len(lineas) - 90))


# ──────────────────────────────────────────────────────────────────────
# 3. DONDE VIVE, para saber que fichero se parchea
# ──────────────────────────────────────────────────────────────────────

titulo("3. LA APP Y SU urls.py")

if elegida is not None:
    mod = getattr(elegida, "__module__", "")
    app = mod.split(".")[0] if mod else ""
    print("  app: {0}".format(app))
    try:
        import importlib
        u = importlib.import_module(app + ".urls")
        f = inspect.getsourcefile(u)
        print("  urls.py: {0}".format(f))
        txt = open(f).read()
        print("")
        print("  Como escribe sus rutas (las 25 primeras lineas de urlpatterns):")
        dentro = False
        n = 0
        for l in txt.split("\n"):
            if "urlpatterns" in l:
                dentro = True
            if dentro:
                print("    {0}".format(l))
                n += 1
                if n >= 25:
                    break
    except Exception as e:
        print("  no pude leer su urls.py: {0}".format(e))

print("")
print("=" * 74)
print("FIN. Nada se ha modificado.")
print("=" * 74)
