# -*- coding: utf-8 -*-
"""Quien sirve /incidentes/ y con que serializer.

    docker compose exec -T web python manage.py shell < ver_api_incidentes.py

SOLO LEE. No escribe, no migra, no toca nada.

POR QUE HACE FALTA
==================

El parche de partidas se nego a correr con esto:

    MAL  no encuentro ningun serializer de IncidentReport

Y la lista de menciones lo confirmo: IncidentReport solo sale en
operations/models.py, operations/admin.py y el comando sync_incidencias_pluvira.
En ningun views.py, en ningun serializers.py. No tiene endpoint propio.

Pero la pantalla de costeo SI lee y escribe por

    GET  /api/v1/mobile/operations/incidentes/<id>/

...asi que esa ruta la sirve OTRO modelo. El comentario del propio comando de
sync ya avisaba de la trampa: "operations.IncidentReport, no de
incidentes.Incidente -que es el incidente de vigilancia-". Dos modelos que
comparten la palabra incidente, y el parche iba a meter el campo en el que no
tiene por donde salir a la API.

Lo que hay que decidir con esto delante es UNA cosa: en que modelo va el M2M
de partidas. La respuesta correcta es el modelo que ya sirve la ruta que el
front usa, porque entonces el GET y el PATCH que la pantalla ya hace funcionan
sin inventar endpoint nuevo. Meterlo en IncidentReport obligaria a crear
serializer, viewset y ruta para algo que nadie expone hoy.

Pero puede que los dos hagan falta: los partes diarios cuelgan de
IncidentReport por FK, y si el presupuesto programado vive en el otro modelo
hay que saber como se salta de uno a otro. El comando de sync dice que
IncidentReport.id TIENE que ser igual al id de PLUVIRA, lo cual sugiere que
comparten clave. Eso se comprueba aqui, no se supone.

QUE IMPRIME
===========

  1. Todas las rutas con 'incidente' en el patron, con su vista y su modelo.
  2. Todos los serializers de DRF cargados, con el modelo de cada uno.
     Asi se ve el convenio de nombres de verdad del proyecto, en vez de
     buscar a ciegas 'IncidentReportSerializer'.
  3. La ficha del modelo que sirve /incidentes/.
  4. Si ese modelo y operations.IncidentReport son el mismo, y si no, por
     donde se relacionan y si los ids coinciden de verdad.
  5. Donde vive Partida, para escribir bien el destino del M2M.
"""

from __future__ import print_function


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


# ──────────────────────────────────────────────────────────────────────
# 1. LAS RUTAS
# ──────────────────────────────────────────────────────────────────────

def recorrer(patrones, prefijo=""):
    """Aplana el arbol de urls en (patron_completo, callback)."""
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


def clase_de_vista(cb):
    """La clase detras de un callback de DRF/Django."""
    for attr in ("cls", "view_class", "__self__"):
        c = getattr(cb, attr, None)
        if c is not None:
            return c if isinstance(c, type) else type(c)
    return None


def modelo_de_vista(cls):
    if cls is None:
        return None, None
    ser = getattr(cls, "serializer_class", None)
    mod = None
    qs = getattr(cls, "queryset", None)
    if qs is not None:
        mod = seguro(lambda: qs.model, None)
    if mod is None and ser is not None:
        mod = seguro(lambda: ser.Meta.model, None)
    return ser, mod


def nombre(x):
    if x is None:
        return "—"
    if isinstance(x, type):
        m = getattr(x, "_meta", None)
        if m is not None and hasattr(m, "app_label"):
            return "{0}.{1}".format(m.app_label, x.__name__)
        return "{0}.{1}".format(getattr(x, "__module__", "?"), x.__name__)
    return str(x)


titulo("1. RUTAS QUE HABLAN DE INCIDENTES")

try:
    from django.urls import get_resolver
    todas = recorrer(get_resolver().url_patterns)
except Exception as e:
    todas = []
    print("  no pude leer las urls: {0}".format(e))

print("  rutas totales en el proyecto: {0}".format(len(todas)))
print("")

candidatas = [(r, cb) for (r, cb) in todas if "incident" in r.lower()]
if not candidatas:
    print("  NINGUNA ruta menciona incidente. Mal asunto: el front llama a")
    print("  /api/v1/mobile/operations/incidentes/<id>/ y eso tendria que")
    print("  existir. Mira la lista completa de abajo.")
else:
    for ruta, cb in candidatas:
        cls = clase_de_vista(cb)
        ser, mod = modelo_de_vista(cls)
        print("  /{0}".format(ruta))
        print("      vista      : {0}".format(nombre(cls)))
        print("      serializer : {0}".format(nombre(ser)))
        print("      modelo     : {0}".format(nombre(mod)))
        print("")

# Las rutas de operations enteras, por si el nombre no lleva 'incident'.
titulo("1b. TODAS LAS RUTAS DE operations")
ops = [r for (r, _) in todas if "operations" in r.lower()]
print("  {0} rutas".format(len(ops)))
for r in sorted(set(ops)):
    print("    /{0}".format(r))


# ──────────────────────────────────────────────────────────────────────
# 2. LOS SERIALIZERS QUE EXISTEN DE VERDAD
# ──────────────────────────────────────────────────────────────────────

titulo("2. SERIALIZERS CARGADOS (clase -> modelo)")

def descendientes(cls, vistos=None):
    if vistos is None:
        vistos = set()
    for h in cls.__subclasses__():
        if h in vistos:
            continue
        vistos.add(h)
        descendientes(h, vistos)
    return vistos

try:
    from rest_framework.serializers import ModelSerializer
    sers = sorted(descendientes(ModelSerializer),
                  key=lambda c: (getattr(c, "__module__", ""), c.__name__))
    print("  {0} serializers".format(len(sers)))
    print("")
    for c in sers:
        mod = seguro(lambda: c.Meta.model, None)
        if not isinstance(mod, type):
            mod = None
        print("    {0:<42} {1}".format(c.__name__, nombre(mod)))
        print("      {0}".format(getattr(c, "__module__", "?")))
except Exception as e:
    print("  no pude listar serializers: {0}".format(e))


# ──────────────────────────────────────────────────────────────────────
# 3 y 4. LOS DOS MODELOS, Y SI SON EL MISMO
# ──────────────────────────────────────────────────────────────────────

from django.apps import apps


def ficha(modelo, cab):
    titulo(cab)
    if modelo is None:
        print("  no existe")
        return
    meta = modelo._meta
    print("  {0}.{1}   tabla {2}".format(meta.app_label, modelo.__name__, meta.db_table))
    print("  filas : {0}".format(seguro(lambda: modelo.objects.count())))
    print("")
    print("  Campos propios:")
    for f in meta.get_fields():
        if not hasattr(f, "get_internal_type"):
            continue
        if f.auto_created and not f.concrete:
            continue
        tipo = f.get_internal_type()
        extra = ""
        if tipo in ("ForeignKey", "OneToOneField", "ManyToManyField"):
            rel = getattr(f, "related_model", None)
            extra = " -> {0}".format(nombre(rel))
        print("    {0:<28} {1}{2}".format(f.name, tipo, extra))
    print("")
    print("  Le cuelgan (relaciones inversas):")
    hay = False
    for f in meta.get_fields():
        if f.auto_created and not f.concrete:
            hay = True
            rel = getattr(f, "related_model", None)
            print("    {0:<28} <- {1}".format(
                getattr(f, "get_accessor_name", lambda: f.name)(), nombre(rel)))
    if not hay:
        print("    nada")


ir = apps.get_model("operations", "IncidentReport") if apps.is_installed("operations") else None
ficha(ir, "3. operations.IncidentReport  (de aqui cuelgan los partes)")

# El modelo que sirve la ruta, si lo encontramos.
servido = None
for ruta, cb in candidatas:
    if ruta.rstrip("/").endswith("incidentes") or "incidentes/<" in ruta:
        _, servido = modelo_de_vista(clase_de_vista(cb))
        if isinstance(servido, type):
            break
        servido = None

ficha(servido, "4. EL MODELO QUE SIRVE /incidentes/")

titulo("4b. SON EL MISMO?")
if servido is None:
    print("  no pude resolver el modelo de la ruta; mira el apartado 1.")
elif ir is None:
    print("  IncidentReport no existe en esta instalacion.")
elif servido is ir:
    print("  SI: /incidentes/ sirve operations.IncidentReport.")
    print("  Entonces si hay serializer -lo dira el apartado 2- y el parche")
    print("  solo estaba buscandolo con el nombre equivocado.")
else:
    print("  NO. Son dos modelos distintos:")
    print("    sirve la ruta : {0}".format(nombre(servido)))
    print("    partes        : {0}".format(nombre(ir)))
    print("")
    print("  Comparten id? El comando de sync dice que deberian.")
    try:
        a = set(servido.objects.values_list("pk", flat=True)[:500])
        b = set(ir.objects.values_list("pk", flat=True)[:500])
        print("    ids en la ruta   : {0}".format(len(a)))
        print("    ids en los partes: {0}".format(len(b)))
        print("    comunes          : {0}".format(len(a & b)))
        print("    solo en la ruta  : {0}".format(sorted(a - b)[:12]))
        print("    solo en partes   : {0}".format(sorted(b - a)[:12]))
    except Exception as e:
        print("    no pude comparar: {0}".format(e))
    print("")
    print("  Hay FK entre ellos?")
    enc = False
    for mod, otro in ((servido, ir), (ir, servido)):
        for f in mod._meta.get_fields():
            if getattr(f, "related_model", None) is otro and f.concrete:
                enc = True
                print("    {0}.{1} -> {2}".format(mod.__name__, f.name, otro.__name__))
    if not enc:
        print("    ninguna. Se relacionan solo por id compartido.")


# ──────────────────────────────────────────────────────────────────────
# 5. PARTIDA
# ──────────────────────────────────────────────────────────────────────

titulo("5. DONDE VIVE Partida")
hallados = []
for m in apps.get_models():
    if m.__name__.lower() in ("partida", "partidapresupuesto", "presupuestopartida"):
        hallados.append(m)
if not hallados:
    print("  no hay ningun modelo llamado Partida. Modelos con 'partid':")
    for m in apps.get_models():
        if "partid" in m.__name__.lower():
            print("    {0}".format(nombre(m)))
else:
    for m in hallados:
        print("  {0}   tabla {1}   filas {2}".format(
            nombre(m), m._meta.db_table, seguro(lambda: m.objects.count())))
        print("  Quien ya la referencia:")
        for otro in apps.get_models():
            for f in otro._meta.get_fields():
                if getattr(f, "related_model", None) is m and f.concrete:
                    print("    {0}.{1}  ({2})".format(
                        nombre(otro), f.name, f.get_internal_type()))

print("")
print("=" * 76)
print("FIN. Nada se ha modificado.")
print("=" * 76)
