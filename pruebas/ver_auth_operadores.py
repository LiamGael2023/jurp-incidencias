# -*- coding: utf-8 -*-
"""Donde se pierde el token de /api/operadores/. SOLO LEE.

    docker exec -w /app -i jurp_web python manage.py shell < ver_auth_operadores.py

SE CORRE EN jurp_web -PLUVIRA, Django 1.8-.

EL SINTOMA. Las ocho pantallas de HYDROMETRIX mandan
`Authorization: Token <...>` a /api/operadores/... y el servidor contesta:

    {"codigo": "not_authenticated",
     "como_autenticar": "Authorization: Token <TU_TOKEN>",
     "detalle": "Falta autenticacion. Incluye tu token en el encabezado
                 Authorization."}

O sea: la ruta SI quiere token -lo pide por su nombre- y dice que no le
llego ninguno. Pero se esta mandando. Asi que o el token no vale, o se
pierde entre el navegador y la vista.

LO QUE DESCARTA ESTE GUION. Llama a las rutas con el cliente de pruebas de
Django, DENTRO del contenedor y con la cabecera puesta a mano. Ahi no hay
Vercel, ni proxy, ni nada en medio:

  · Si aqui responden 200, el servidor esta bien y el token se pierde en el
    camino -el reenvio de Vercel, o un proxy que se come la cabecera-.
  · Si aqui responden 403 igual, el problema es de la vista o del token, y
    la salida dice cual de los dos.

Tambien se llama a cada ruta SIN cabecera, para tener con que comparar.

EL TOKEN NO SE IMPRIME. Solo su longitud y sus cuatro primeros caracteres:
un token en un chat o en un historial de terminal es una llave suelta.

NOTA SOBRE EL SHELL DE DJANGO 1.8. Entra por InteractiveConsole: una linea
en blanco DENTRO de un bloque lo cierra antes de tiempo, y un bloque de
primer nivel necesita una linea en blanco DETRAS. Por eso no hay huecos
dentro de los bloques; conviene no reformatearlo.
"""
from __future__ import print_function
from django.contrib.auth.models import User
from django.test import Client

USUARIO = "abastecimiento"
HOST = "sistema.jriegopresurizado.org.pe"
RUTAS = ["/api/operadores/tomas/",
         "/api/operadores/tomas/status-summary/",
         "/api/operadores/series/",
         "/api/operadores/volumes/by-toma/",
         "/api/operadores/volumes/by-month/"]


def corto(b, n=700):
    try:
        s = b.decode("utf-8", "replace")
    except AttributeError:
        s = str(b)
    s = " ".join(s.split())
    if len(s) <= n:
        return s
    return s[:n] + "   ...(%d caracteres en total)" % len(s)


print("")
print("=" * 74)
print("1. LA CUENTA")
print("=" * 74)

u = User.objects.filter(username=USUARIO).first()
if u is None:
    print("  NO existe el usuario %s" % USUARIO)
else:
    print("  usuario : %s" % u.username)
    print("  activo  : %s   staff: %s   superusuario: %s"
          % (u.is_active, u.is_staff, u.is_superuser))
    print("  grupos  : %s" % [g.name for g in u.groups.all()])

print("")
print("=" * 74)
print("2. SU TOKEN")
print("=" * 74)

clave = None
try:
    from rest_framework.authtoken.models import Token
    t = Token.objects.filter(user=u).first() if u is not None else None
    if t is None:
        print("  NO hay token guardado para esta cuenta.")
        print("  -> Si el login movil devolvio uno, es que lo crea al vuelo")
        print("     y lo guarda en otra tabla: habria que mirar esa vista.")
    else:
        clave = t.key
        print("  hay token: %d caracteres, empieza por %s..." % (len(clave), clave[:4]))
        print("  creado   : %s" % getattr(t, "created", "?"))
except Exception as e:
    print("  no pude leer la tabla de tokens: %s" % e)

print("")
print("=" * 74)
print("3. LAS RUTAS, LLAMADAS DESDE DENTRO DEL CONTENEDOR")
print("=" * 74)
print("  Aqui no hay Vercel ni proxy: es la vista contestando directamente.")
print("  200 con token  -> el servidor esta bien, el token se pierde fuera.")
print("  403 con token  -> el problema esta en la vista o en el token.")

c = Client()
for ruta in RUTAS:
    print("")
    print("  %s" % ruta)
    try:
        sin = c.get(ruta, HTTP_HOST=HOST)
        print("    sin cabecera : %s" % sin.status_code)
    except Exception as e:
        print("    sin cabecera : fallo -> %s" % e)
    if clave is None:
        print("    con cabecera : (no hay token que probar)")
        continue
    try:
        con = c.get(ruta, HTTP_HOST=HOST,
                    HTTP_AUTHORIZATION="Token %s" % clave)
        print("    con cabecera : %s" % con.status_code)
        print("    respuesta    : %s" % corto(con.content))
    except Exception as e:
        print("    con cabecera : fallo -> %s" % e)

print("")
print("=" * 74)
print("4. QUE EXIGE CADA VISTA")
print("=" * 74)

try:
    from django.core.urlresolvers import get_resolver
    def patron(p):
        rx = getattr(p, "regex", None)
        return rx.pattern if rx is not None else "?"
    def recorrer(ps, pre=""):
        salida = []
        for p in ps:
            trozo = patron(p)
            hijos = getattr(p, "url_patterns", None)
            if hijos is not None:
                salida.extend(recorrer(hijos, pre + trozo))
            else:
                salida.append((pre + trozo, getattr(p, "callback", None)))
        return salida
    def nombres(xs):
        if not xs:
            return "(los de por defecto)"
        return [getattr(x, "__name__", str(x)) for x in xs]
    for ruta, cb in recorrer(get_resolver(None).url_patterns):
        if "operador" not in ruta.lower():
            continue
        cls = getattr(cb, "cls", None) or getattr(cb, "view_class", None)
        print("")
        print("  /%s" % ruta)
        print("     vista : %s" % getattr(cls or cb, "__name__", cb))
        print("     auth  : %s" % nombres(getattr(cls, "authentication_classes", None) if cls else None))
        print("     perm  : %s" % nombres(getattr(cls, "permission_classes", None) if cls else None))
except Exception as e:
    print("  no pude recorrer las urls: %s" % e)

print("")
print("=" * 74)
print("5. LOS DE POR DEFECTO")
print("=" * 74)

try:
    from django.conf import settings
    drf = getattr(settings, "REST_FRAMEWORK", {}) or {}
    print("  auth: %s" % drf.get("DEFAULT_AUTHENTICATION_CLASSES"))
    print("  perm: %s" % drf.get("DEFAULT_PERMISSION_CLASSES"))
    print("  exc : %s" % drf.get("EXCEPTION_HANDLER"))
except Exception as e:
    print("  no pude leer settings: %s" % e)

print("")
print("=" * 74)
print("FIN. Nada se ha modificado.")
print("=" * 74)
