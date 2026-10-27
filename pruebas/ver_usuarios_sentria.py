# -*- coding: utf-8 -*-
"""El padron de usuarios de SENTRIA y como se crean, antes de tocar nada.

    docker compose exec -T web python manage.py shell < ver_usuarios_sentria.py

SOLO LEE. No crea usuarios, no cambia roles, no borra nada.

SE CORRE EN EL LINODE de vigilancia -api_vigilantes, /var/www/envs/vigilantes,
contenedor django_api, servicio web-. No en el de PLUVIRA: ese tiene su propio
padron y no es este.

PARA QUE. Hay que poder registrar usuarios con su rol desde la web, y la app
ya lo hace. Lo que no se puede suponer es COMO lo hace, y cada suposicion
cambia la pantalla entera:

  1. QUE TABLA ES EL PADRON. SENTRIA no usa las cuentas del sistema de riego:
     tiene tabla aparte. Si esa tabla hereda de AbstractUser, la clave se
     guarda con set_password() y hay que mandarla en claro una sola vez; si es
     un modelo suelto con un CharField, el formulario es otro y seguramente
     haya que arreglar como se guarda.

  2. QUE ES UN "ROL" AQUI. Puede ser un grupo de Django, un campo con choices,
     o una tabla propia. Un desplegable que invente los roles dejaria crear
     usuarios con roles que el backend no reconoce, y eso no da error: da un
     usuario que no puede hacer nada y nadie sabe por que.

  3. QUE CAMPOS EXIGE AL CREAR. Los obligatorios del serializer son los que
     tiene que pedir el formulario. Si falta uno, el 400 llega al usuario como
     "no se pudo guardar" y a reinventar.

  4. QUIEN PUEDE LLAMARLO. Si el endpoint es IsAuthenticated a secas,
     cualquier vigilante podria crear usuarios desde la API. Conviene saberlo
     ahora y no cuando pase.

Imprime tambien las rutas con sus metodos, que es lo que la web va a llamar.
"""

from __future__ import print_function

import inspect
import sys


def titulo(t):
    print("")
    print("=" * 76)
    print(t)
    print("=" * 76)


def seguro(fn, por_defecto="?"):
    try:
        return fn()
    except Exception as e:
        return "error: {0}".format(e)


# ──────────────────────────────────────────────────────────────────────────
# 0. CONTEXTO
# ──────────────────────────────────────────────────────────────────────────

titulo("0. DONDE ESTAMOS")

import django
from django.conf import settings

print("  python  : %s" % sys.version.split()[0])
print("  django  : %s" % django.get_version())
print("  drf     : %s" % seguro(lambda: __import__("rest_framework").VERSION))
print("  settings: %s" % settings.SETTINGS_MODULE)
print("  AUTH_USER_MODEL: %s" % getattr(settings, "AUTH_USER_MODEL", "?"))


# ──────────────────────────────────────────────────────────────────────────
# 1. EL PADRON: QUE MODELOS GUARDAN PERSONAS
# ──────────────────────────────────────────────────────────────────────────

titulo("1. LOS MODELOS QUE PARECEN PADRON")

from django.apps import apps as djapps
from django.contrib.auth import get_user_model

U = get_user_model()
print("  el modelo de usuario de Django es: %s.%s"
      % (U._meta.app_label, U.__name__))
print("  filas: %s" % seguro(lambda: U.objects.count()))
print("  hereda de: %s"
      % " <- ".join(b.__name__ for b in U.__mro__[1:5]))
print("")

PISTAS = ("user", "usuario", "vigilante", "perfil", "profile", "persona",
          "empleado", "trabajador", "supervisor", "operador", "rol", "role")


def campos_de(m):
    out = []
    for f in m._meta.get_fields():
        if not hasattr(f, "get_internal_type"):
            continue
        if f.auto_created and not f.concrete:
            continue
        extra = []
        if getattr(f, "null", False):
            extra.append("null")
        if getattr(f, "blank", False):
            extra.append("blank")
        if getattr(f, "choices", None):
            extra.append("choices=%s" % (
                [c[0] for c in f.choices][:12],))
        rel = getattr(f, "related_model", None)
        if rel is not None:
            extra.append("-> %s.%s" % (rel._meta.app_label, rel.__name__))
        out.append((f.name, f.get_internal_type(),
                    (" ".join(extra)) if extra else ""))
    return out


candidatos = []
for m in djapps.get_models():
    nom = m.__name__.lower()
    if any(p in nom for p in PISTAS):
        candidatos.append(m)

if not candidatos:
    print("  Ninguno con esos nombres. Lista completa de modelos:")
    for m in djapps.get_models():
        print("    %s.%s" % (m._meta.app_label, m.__name__))

for m in candidatos:
    print("  %s.%s   filas: %s"
          % (m._meta.app_label, m.__name__, seguro(lambda: m.objects.count())))
    # Si hereda de AbstractBaseUser, la clave va con set_password().
    bases = [b.__name__ for b in m.__mro__[1:6]]
    print("      hereda : %s" % " <- ".join(bases))
    print("      set_password: %s" % hasattr(m, "set_password"))
    for n, t, extra in campos_de(m):
        print("      %-26s %-18s %s" % (n, t, extra))
    print("")


# ──────────────────────────────────────────────────────────────────────────
# 2. QUE ES UN ROL EN ESTE SISTEMA
# ──────────────────────────────────────────────────────────────────────────

titulo("2. LOS ROLES, Y DE DONDE SALEN")

from django.contrib.auth.models import Group, Permission

print("  GRUPOS de Django (%s):" % seguro(lambda: Group.objects.count()))
for g in seguro(lambda: list(Group.objects.all()), []):
    try:
        print("    %-28s usuarios: %-5s permisos: %s"
              % (g.name, g.user_set.count(), g.permissions.count()))
    except Exception as e:
        print("    %-28s (no pude contar: %s)" % (g.name, e))

# Un campo de rol con choices, en cualquier modelo del padron.
print("")
print("  CAMPOS que parecen rol, con sus valores permitidos:")
hubo = False
for m in djapps.get_models():
    for f in m._meta.get_fields():
        if not hasattr(f, "get_internal_type"):
            continue
        if not any(p in f.name.lower() for p in ("rol", "role", "cargo",
                                                 "tipo_usuario", "perfil",
                                                 "nivel")):
            continue
        hubo = True
        print("    %s.%s.%s  (%s)"
              % (m._meta.app_label, m.__name__, f.name,
                 f.get_internal_type()))
        if getattr(f, "choices", None):
            for valor, etiqueta in f.choices:
                print("        %-22r %s" % (valor, etiqueta))
        rel = getattr(f, "related_model", None)
        if rel is not None:
            print("        -> %s.%s" % (rel._meta.app_label, rel.__name__))
            for o in seguro(lambda: list(rel.objects.all()[:20]), []):
                print("           %s" % o)
        # Lo que hay de verdad en la base, que a veces no son los choices.
        try:
            from django.db.models import Count
            usados = (m.objects.values(f.name)
                       .annotate(n=Count('id')).order_by('-n')[:15])
            print("        en uso: %s"
                  % [(u[f.name], u['n']) for u in usados])
        except Exception as e:
            print("        en uso: no pude contar (%s)" % e)
if not hubo:
    print("    Ninguno. Entonces el rol son los GRUPOS de arriba.")


# ──────────────────────────────────────────────────────────────────────────
# 3. LAS RUTAS QUE TOCAN USUARIOS
# ──────────────────────────────────────────────────────────────────────────

titulo("3. LAS RUTAS, CON SUS METODOS Y PERMISOS")


def patron_de(p):
    pat = getattr(p, "pattern", None)
    if pat is not None:
        return str(getattr(pat, "_route", None) or pat)
    rx = getattr(p, "regex", None)
    return rx.pattern if rx is not None else "?"


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


try:
    from django.urls import get_resolver
    todas = recorrer(get_resolver().url_patterns)
except Exception as e:
    todas = []
    print("  no pude leer las urls: %s" % e)

print("  rutas en el proyecto: %s" % len(todas))
print("")

tocan = [(r, cb) for (r, cb) in todas
         if any(p in r.lower() for p in PISTAS + ("group", "grupo", "registro",
                                                  "signup", "alta"))]

if not tocan:
    print("  NINGUNA ruta menciona usuarios. Entonces la app los crea por")
    print("  otra via -o no los crea-, y hay que mirar las %s rutas:" % len(todas))
    for r, _ in todas[:60]:
        print("    /%s" % r)

for ruta, cb in tocan[:40]:
    cls = clase_de(cb)
    quien = cls if cls is not None else cb
    print("  /%s" % ruta)
    print("      vista   : %s" % getattr(quien, "__name__", quien))
    print("      modulo  : %s" % getattr(quien, "__module__", "?"))
    print("      fichero : %s" % seguro(lambda: inspect.getsourcefile(quien)))

    # Metodos: en una vista de clase, los que tiene definidos; en una funcion
    # decorada con @api_view, los que acepta.
    metodos = []
    if cls is not None:
        for m in ("get", "post", "put", "patch", "delete"):
            if hasattr(cls, m):
                metodos.append(m.upper())
        acciones = getattr(cls, "http_method_names", None)
        if not metodos and acciones:
            metodos = [x.upper() for x in acciones]
    else:
        metodos = list(getattr(cb, "cls", None) and [] or
                       getattr(cb, "http_method_names", []) or [])
        hm = getattr(getattr(cb, "cls", None), "http_method_names", None)
        if hm:
            metodos = [x.upper() for x in hm]
    print("      metodos : %s" % (", ".join(metodos) or "?"))

    for attr in ("permission_classes", "authentication_classes",
                 "serializer_class", "queryset", "lookup_field"):
        v = getattr(cls, attr, None) if cls is not None else None
        if v is None and cls is None:
            v = getattr(getattr(cb, "cls", None), attr, None)
        if v is not None:
            if attr == "queryset":
                v = "%s (%s filas)" % (
                    v.model.__name__, seguro(lambda: v.count()))
            elif isinstance(v, (list, tuple)):
                v = [getattr(x, "__name__", str(x)) for x in v]
            else:
                v = getattr(v, "__name__", str(v))
            print("      %-8s: %s" % (attr[:8], v))
    print("")


# ──────────────────────────────────────────────────────────────────────────
# 4. LOS SERIALIZERS: QUE CAMPOS PIDE AL CREAR
# ──────────────────────────────────────────────────────────────────────────

titulo("4. QUE CAMPOS HAY QUE MANDAR")

vistos = set()
for ruta, cb in tocan:
    cls = clase_de(cb) or getattr(cb, "cls", None)
    ser = getattr(cls, "serializer_class", None) if cls else None
    if ser is None or ser in vistos:
        continue
    vistos.add(ser)
    print("  %s   (lo usa /%s)" % (ser.__name__, ruta))
    try:
        inst = ser()
        for nombre, campo in inst.get_fields().items():
            marcas = []
            if campo.required:
                marcas.append("OBLIGATORIO")
            if campo.read_only:
                marcas.append("solo lectura")
            if campo.write_only:
                marcas.append("solo escritura")
            if getattr(campo, "allow_null", False):
                marcas.append("acepta null")
            if getattr(campo, "choices", None):
                marcas.append("choices=%s" % list(campo.choices)[:12])
            print("      %-24s %-26s %s"
                  % (nombre, type(campo).__name__, " ".join(marcas)))
    except Exception as e:
        print("      no pude instanciarlo: %s" % e)

    # create() a mano suele ser donde se cifra la clave o se asigna el grupo.
    if hasattr(ser, "create"):
        fuente = seguro(lambda: inspect.getsource(ser.create), None)
        if fuente and not str(fuente).startswith("error"):
            print("")
            print("      su create():")
            for l in str(fuente).split("\n")[:40]:
                print("        %s" % l)
    print("")

if not vistos:
    print("  Ninguna de esas vistas declara serializer_class. Si la app crea")
    print("  usuarios, lo hace en el cuerpo de la vista: hay que leerla.")


print("")
print("=" * 76)
print("FIN. Nada se ha modificado.")
print("=" * 76)
