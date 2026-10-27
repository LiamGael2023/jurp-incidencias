# -*- coding: utf-8 -*-
"""Las vulnerabilidades de SENTRIA: donde viven y que campos traen.

    docker compose exec -T web python manage.py shell < ver_vulnerabilidades_sentria.py

SOLO LEE.

SE CORRE EN EL LINODE DE VIGILANCIA -api_vigilantes,
/var/www/envs/vigilantes-.

PARA QUE. Hay que enseñarlas en la web, al lado de Incidentes, Turnos y
Transitos. La pantalla ya existe; lo que falta es saber a que llamar y que
viene, y eso no se puede suponer:

  1. LA RUTA. La pantalla pide /vigapi/incidentes/lista/, /transito/ y
     /alertas/ -sin /mobile/-, asi que esta seguramente siga ese patron,
     pero "seguramente" no sirve: una ruta inventada da un 404 que parece
     un fallo del servidor.

  2. COMO VIENE LA LISTA. Las otras devuelven {"results": [...]} o una lista
     pelada. Si se supone mal, la tabla sale vacia sin decir por que.

  3. QUE CAMPOS TIENE CADA FILA. Son las columnas de la tabla. Inventar un
     nombre de campo da una columna de guiones, que es peor que no ponerla:
     parece que no hay dato cuando lo que pasa es que se pidio mal.

  4. SI SE RESUELVEN O SOLO SE REGISTRAN. Si hay un estado -abierta,
     subsanada- la pantalla necesita filtro y conteo, como el de alertas
     activas. Si no lo hay, es una lista y ya.

Tambien imprime una fila de ejemplo, tal como la devuelve el serializer:
es la unica manera de ver los nombres de verdad y no los del modelo.
"""

from __future__ import print_function

import inspect
import json


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


PISTAS = ("vulner", "vulnerabilidad", "debilidad", "hallazgo", "riesgo",
          "observacion", "observación")


# ──────────────────────────────────────────────────────────────────────────
# 1. LOS MODELOS
# ──────────────────────────────────────────────────────────────────────────

titulo("1. MODELOS QUE PARECEN VULNERABILIDADES")

from django.apps import apps as djapps

hallados = []
for m in djapps.get_models():
    if any(p in m.__name__.lower() for p in PISTAS):
        hallados.append(m)

if not hallados:
    print("  Ninguno con esos nombres. TODOS los modelos del proyecto:")
    for m in sorted(djapps.get_models(), key=lambda x: (x._meta.app_label,
                                                        x.__name__)):
        if m._meta.app_label in ('admin', 'auth', 'contenttypes', 'sessions',
                                 'authtoken'):
            continue
        print("    %-18s %-32s %s"
              % (m._meta.app_label, m.__name__,
                 seguro(lambda: m.objects.count())))

for m in hallados:
    print("  %s.%s   filas: %s"
          % (m._meta.app_label, m.__name__, seguro(lambda: m.objects.count())))
    for f in m._meta.get_fields():
        if not hasattr(f, "get_internal_type"):
            continue
        if f.auto_created and not f.concrete:
            continue
        extra = []
        if getattr(f, "choices", None):
            extra.append("choices=%s" % [c[0] for c in f.choices][:12])
        rel = getattr(f, "related_model", None)
        if rel is not None:
            extra.append("-> %s.%s" % (rel._meta.app_label, rel.__name__))
        if getattr(f, "null", False):
            extra.append("null")
        print("      %-24s %-18s %s"
              % (f.name, f.get_internal_type(), " ".join(extra)))
    print("")


# ──────────────────────────────────────────────────────────────────────────
# 2. LAS RUTAS
# ──────────────────────────────────────────────────────────────────────────

titulo("2. LAS RUTAS QUE LAS SIRVEN")


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


from django.urls import get_resolver

todas = recorrer(get_resolver().url_patterns)
print("  rutas en el proyecto: %s" % len(todas))
print("")

tocan = [(r, cb) for (r, cb) in todas
         if any(p in r.lower() for p in PISTAS) and '/admin/' not in r]

if not tocan:
    print("  Ninguna ruta las menciona. Las rutas de /api/v1/ que NO son del")
    print("  admin, por si estan con otro nombre:")
    for r, _ in todas:
        if r.startswith('api/v1/') and '/admin/' not in r and '\\.' not in r:
            print("    /%s" % r)

for ruta, cb in tocan[:20]:
    cls = clase_de(cb)
    quien = cls if cls is not None else cb
    print("  /%s" % ruta)
    print("      vista   : %s" % getattr(quien, "__name__", quien))
    print("      modulo  : %s" % getattr(quien, "__module__", "?"))
    for attr in ("permission_classes", "serializer_class", "queryset"):
        v = getattr(cls, attr, None) if cls is not None else None
        if v is None:
            continue
        if attr == "queryset":
            v = "%s (%s filas)" % (v.model.__name__, seguro(lambda: v.count()))
        elif isinstance(v, (list, tuple)):
            v = [getattr(x, "__name__", str(x)) for x in v]
        else:
            v = getattr(v, "__name__", str(v))
        print("      %-8s: %s" % (attr[:8], v))
    print("")


# ──────────────────────────────────────────────────────────────────────────
# 3. UNA FILA DE VERDAD
# ──────────────────────────────────────────────────────────────────────────

titulo("3. COMO SALE UNA FILA POR LA API")

print("  Los nombres que importan son los del serializer, no los del modelo:")
print("  es lo que va a leer la tabla de la web.")
print("")

vistos = set()
for ruta, cb in tocan:
    cls = clase_de(cb)
    ser = getattr(cls, "serializer_class", None) if cls else None
    if ser is None or ser in vistos:
        continue
    vistos.add(ser)
    print("  %s" % ser.__name__)
    try:
        campos = ser().get_fields()
        for nombre, campo in campos.items():
            marcas = []
            if campo.read_only:
                marcas.append("solo lectura")
            if getattr(campo, "choices", None):
                marcas.append("choices=%s" % list(campo.choices)[:10])
            print("      %-24s %-24s %s"
                  % (nombre, type(campo).__name__, " ".join(marcas)))
    except Exception as e:
        print("      no pude instanciarlo: %s" % e)

    qs = getattr(cls, "queryset", None)
    if qs is not None:
        fila = seguro(lambda: qs.first(), None)
        if fila is not None and not isinstance(fila, str):
            print("")
            print("      una fila de ejemplo:")
            try:
                datos = ser(fila).data
                print("      " + json.dumps(datos, indent=2, default=str,
                                            ensure_ascii=False
                                            ).replace("\n", "\n      ")[:2000])
            except Exception as e:
                print("      no pude serializarla: %s" % e)
    print("")

if not vistos:
    print("  Ninguna de esas vistas declara serializer_class. Si existe, la")
    print("  respuesta se arma en el cuerpo de la vista y hay que leerla.")

print("")
print("=" * 76)
print("FIN. Nada se ha modificado.")
print("=" * 76)
