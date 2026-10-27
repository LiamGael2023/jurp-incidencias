# -*- coding: utf-8 -*-
"""Por que /api/operadores/ responde 403. SOLO LEE.

    docker exec -w /app -i jurp_web python manage.py shell < ver_permisos_operadores.py

SE CORRE EN jurp_web -PLUVIRA, Django 1.8-.

QUE PREGUNTA RESPONDE. Las ocho pantallas de HYDROMETRIX reciben 403 en
todas las rutas, con el token que da el login movil. Un 403 de DRF son dos
cosas distintas y se arreglan en sitios opuestos:

  a) La vista NO mira el token. Pasa cuando solo lleva SessionAuthentication
     -lo normal en una vista escrita para las paginas del propio sistema-:
     la cabecera Authorization se ignora y DRF contesta 403 porque no hay
     esquema que pedir. Se arregla anadiendo TokenAuthentication.

  b) La vista SI acepto el token, entro el usuario, y la clase de permiso lo
     rechaza. Se arregla dandole el permiso a esa cuenta.

Tocar grupos cuando el caso es (a) no cambia nada, y anadir
TokenAuthentication cuando el caso es (b) tampoco. De ahi este guion: dice
cual de los dos es, sin adivinar.

NOTA SOBRE EL SHELL DE DJANGO 1.8. Entra por InteractiveConsole: una linea
en blanco DENTRO de un bloque lo cierra antes de tiempo, y un bloque de
primer nivel necesita una linea en blanco DETRAS para cerrarse. Por eso el
fichero esta escrito asi y conviene no reformatearlo.
"""
from __future__ import print_function
from django.conf import settings
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
        return None
    return [getattr(x, "__name__", str(x)) for x in xs]


print("=" * 74)
print("1. LAS RUTAS DE OPERADORES Y QUE EXIGEN")
print("=" * 74)

todas = recorrer(get_resolver(None).url_patterns)

for ruta, cb in todas:
    if "operador" not in ruta.lower():
        continue
    cls = getattr(cb, "cls", None) or getattr(cb, "view_class", None)
    aut = nombres(getattr(cls, "authentication_classes", None)) if cls else None
    per = nombres(getattr(cls, "permission_classes", None)) if cls else None
    print("")
    print("/%s" % ruta)
    print("   vista : %s" % getattr(cls or cb, "__name__", cb))
    print("   auth  : %s" % (aut if aut else "(los de por defecto)"))
    print("   perm  : %s" % (per if per else "(los de por defecto)"))

print("")
print("=" * 74)
print("2. LOS DE POR DEFECTO")
print("=" * 74)

drf = getattr(settings, "REST_FRAMEWORK", {}) or {}
print("  auth: %s" % drf.get("DEFAULT_AUTHENTICATION_CLASSES"))
print("  perm: %s" % drf.get("DEFAULT_PERMISSION_CLASSES"))

print("")
print("=" * 74)
print("3. COMO LEER ESTO")
print("=" * 74)
print("  Si en 'auth' NO aparece TokenAuthentication -ni en la ruta ni en")
print("  los de por defecto-, el caso es (a): la ruta no mira el token y no")
print("  hay grupo que arregle eso.")
print("")
print("  Si TokenAuthentication SI esta, el caso es (b) y el que decide es")
print("  lo que salga en 'perm'.")
print("")
print("=" * 74)
print("FIN. Nada se ha modificado.")
print("=" * 74)
