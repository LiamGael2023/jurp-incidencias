# -*- coding: utf-8 -*-
"""Como esta hecho el login, antes de tocarlo.

    docker compose exec -T web python manage.py shell < ver_login_pluvira.py

SOLO LEE. No escribe, no migra, no borra ningun token.

SE CORRE EN EL BACKEND DE PLUVIRA -el de sistema.jriegopresurizado.org.pe-,
que es quien emite el token. No en el Linode de vigilantes: alli vive
SENTRIA, que tiene su propio login en /vigapi/mobile/auth/login/.

PARA QUE. Hay que enlazar cada cuenta a un celular y dejar una sola sesion
de web, y eso se hace en la vista que crea el token. Antes de escribirla hay
que saber tres cosas que no se pueden suponer:

  1. QUE VISTA ATIENDE /api/v1/mobile/auth/login/ y donde esta su fichero.
     Puede ser la ObtainAuthToken de DRF, una subclase, o una funcion
     escrita a mano. Lo que se parchea cambia en cada caso.

  2. SI LOS TOKENS SON LOS DE rest_framework.authtoken. Esos son uno por
     usuario -OneToOneField-, y por eso entrar dos veces devuelve EL MISMO
     token y los dos equipos siguen andando. Si fueran knox o JWT, el plan
     es otro: knox ya guarda varias sesiones por usuario y JWT no se puede
     invalidar sin una lista negra.

  3. CUANTAS CUENTAS HAY Y CUANTAS TIENEN TOKEN VIVO. Es la medida de lo
     que va a doler: al activar esto, cada token que se invalide es alguien
     que tiene que volver a entrar.

Tambien mira si ya existe alguna tabla de dispositivos. Si la app de
notificaciones ya guarda el token de FCM por equipo, puede que medio camino
este hecho y no haga falta una tabla nueva.
"""

from __future__ import print_function

import inspect


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
# 1. QUIEN ATIENDE EL LOGIN
# ──────────────────────────────────────────────────────────────────────

def recorrer(patrones, prefijo=""):
    salida = []
    for p in patrones:
        try:
            trozo = str(getattr(p.pattern, "_route", None) or p.pattern)
        except Exception:
            trozo = "?"
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
    from django.urls import get_resolver
    todas = recorrer(get_resolver().url_patterns)
except Exception as e:
    todas = []
    print("  no pude leer las urls: {0}".format(e))

print("  rutas en el proyecto: {0}".format(len(todas)))
print("")

logins = [(r, cb) for (r, cb) in todas
          if "login" in r.lower() or "auth" in r.lower() or "token" in r.lower()]
if not logins:
    print("  NINGUNA ruta menciona login/auth/token. Mal asunto: el front")
    print("  llama a /api/v1/mobile/auth/login/ y eso tendria que existir.")

for ruta, cb in logins:
    cls = clase_de(cb)
    quien = cls if cls is not None else cb
    print("  /{0}".format(ruta))
    print("      vista  : {0}".format(getattr(quien, "__name__", quien)))
    print("      modulo : {0}".format(getattr(quien, "__module__", "?")))
    print("      fichero: {0}".format(seguro(lambda: inspect.getsourcefile(quien))))
    # De quien hereda: si es ObtainAuthToken de DRF, el parche es de dos
    # lineas; si esta escrita a mano, hay que leerla entera.
    if cls is not None:
        bases = [b.__name__ for b in getattr(cls, "__mro__", [])[1:5]]
        print("      hereda : {0}".format(" <- ".join(bases)))
    print("")

# El codigo de la que de verdad atiende el login del movil.
titulo("1b. EL CODIGO DE LA VISTA DE /auth/login/")
elegida = None
for ruta, cb in logins:
    if "auth/login" in ruta:
        elegida = clase_de(cb) or cb
        break
if elegida is None and logins:
    elegida = clase_de(logins[0][1]) or logins[0][1]

if elegida is None:
    print("  no la encontre; mira la lista de arriba.")
else:
    fuente = seguro(lambda: inspect.getsource(elegida), None)
    if isinstance(fuente, str) and fuente.startswith("error"):
        print("  no pude leer el codigo: {0}".format(fuente))
    elif fuente:
        lineas = fuente.split("\n")
        print("  {0} lineas. Las primeras 60:".format(len(lineas)))
        print("")
        for l in lineas[:60]:
            print("    {0}".format(l))
        if len(lineas) > 60:
            print("    ... y {0} mas".format(len(lineas) - 60))


# ──────────────────────────────────────────────────────────────────────
# 2. QUE CLASE DE TOKEN ES
# ──────────────────────────────────────────────────────────────────────

titulo("2. LOS TOKENS")

from django.conf import settings

apps_auth = [a for a in settings.INSTALLED_APPS
             if any(x in a.lower() for x in ("authtoken", "knox", "jwt", "simplejwt",
                                             "oauth", "allauth"))]
print("  apps de autenticacion instaladas:")
for a in apps_auth or ["  (ninguna de las conocidas)"]:
    print("    {0}".format(a))

clases = seguro(lambda: settings.REST_FRAMEWORK.get(
    "DEFAULT_AUTHENTICATION_CLASSES", []), [])
print("")
print("  DEFAULT_AUTHENTICATION_CLASSES:")
for c in (clases if isinstance(clases, (list, tuple)) else [clases]):
    print("    {0}".format(c))

try:
    from rest_framework.authtoken.models import Token
    campo = Token._meta.get_field("user")
    print("")
    print("  rest_framework.authtoken SI esta.")
    print("    Token.user es {0}".format(campo.get_internal_type()))
    if campo.get_internal_type() == "OneToOneField":
        print("    -> UNO POR USUARIO. Entrar dos veces devuelve el MISMO")
        print("       token, por eso los dos equipos siguen andando. Para")
        print("       cerrar la sesion anterior hay que BORRARLO al entrar.")
    print("    tokens vivos: {0}".format(seguro(lambda: Token.objects.count())))
except Exception as e:
    print("")
    print("  rest_framework.authtoken no esta o no se pudo leer: {0}".format(e))


# ──────────────────────────────────────────────────────────────────────
# 3. CUANTO VA A DOLER
# ──────────────────────────────────────────────────────────────────────

titulo("3. CUANTAS CUENTAS HAY")

from django.contrib.auth import get_user_model

U = get_user_model()
print("  modelo de usuario: {0}.{1}".format(U._meta.app_label, U.__name__))
print("  usuarios totales : {0}".format(seguro(lambda: U.objects.count())))
print("  activos          : {0}".format(
    seguro(lambda: U.objects.filter(is_active=True).count())))
try:
    from rest_framework.authtoken.models import Token
    con = Token.objects.count()
    print("  con token vivo   : {0}".format(con))
    print("")
    print("  Al activar lo del enlace, cada token que se invalide es alguien")
    print("  que tiene que volver a entrar. Conviene avisar antes.")
except Exception:
    pass

# Campos propios del usuario: a veces el padron ya trae algo por donde
# colgar el equipo -un perfil, un codigo de vigilante-.
print("")
print("  Campos del usuario:")
for f in U._meta.get_fields():
    if not hasattr(f, "get_internal_type"):
        continue
    if f.auto_created and not f.concrete:
        continue
    print("    {0:<26} {1}".format(f.name, f.get_internal_type()))


# ──────────────────────────────────────────────────────────────────────
# 4. ¿YA HAY ALGO DE DISPOSITIVOS?
# ──────────────────────────────────────────────────────────────────────

titulo("4. TABLAS QUE YA HABLAN DE DISPOSITIVOS")

from django.apps import apps as djapps

PISTAS = ("device", "dispositiv", "equipo", "fcm", "push", "sesion", "session",
          "token", "celular", "movil")

hallados = []
for m in djapps.get_models():
    nom = m.__name__.lower()
    campos = [f.name.lower() for f in m._meta.get_fields()
              if hasattr(f, "get_internal_type")]
    if any(p in nom for p in PISTAS) or any(
            any(p in c for p in ("device", "dispositiv", "fcm", "imei", "uuid"))
            for c in campos):
        hallados.append(m)

if not hallados:
    print("  Ninguna. Hace falta una tabla nueva para el enlace.")
else:
    print("  Puede que medio camino este hecho: si la app de notificaciones")
    print("  ya guarda el equipo, el enlace puede colgar de ahi en vez de")
    print("  crear otra tabla que diga lo mismo.")
    print("")
    for m in hallados:
        print("  {0}.{1}   filas {2}".format(
            m._meta.app_label, m.__name__, seguro(lambda: m.objects.count())))
        for f in m._meta.get_fields():
            if not hasattr(f, "get_internal_type"):
                continue
            if f.auto_created and not f.concrete:
                continue
            print("      {0:<24} {1}".format(f.name, f.get_internal_type()))
        print("")

print("")
print("=" * 74)
print("FIN. Nada se ha modificado.")
print("=" * 74)
