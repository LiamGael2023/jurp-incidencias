# -*- coding: utf-8 -*-
"""Que devuelven los tres endpoints del costeo, y si sirven para una actividad.

    docker compose exec -T web python manage.py shell < ver_costeo_actividad.py

NO TOCA NADA. Solo mira y cuenta.

PARA QUE. La pantalla de Gestion de una incidencia (mano de obra, materiales,
equipo, partes diarios) va a servir tambien para una actividad de obra. Los
tres modelos ya tienen la clave 'actividad_obra' desde la migracion 0029,
pero eso no basta: si el SERIALIZER no la expone, el navegador no puede ni
filtrar por ella ni mandarla al crear, y lo haria en silencio -las lineas se
guardarian colgando de nada y la pantalla saldria siempre vacia-.

Esto contesta a cuatro cosas:
  1. Que campos devuelve cada serializer (y si 'actividad_obra' esta).
  2. Si 'incident_report' admite nulos de verdad en la base.
  3. Si las vistas de lista aceptan filtrar, o si hay que traerlo todo.
  4. Cuantas filas hay ya colgando de una actividad.
"""

from __future__ import print_function

import json

print("")
print("=" * 78)
print("EL COSTEO, VISTO DESDE UNA ACTIVIDAD DE OBRA")
print("=" * 78)

from django.apps import apps  # noqa: E402

MODELOS = ["IncidentPersonnel", "IncidentMaterial", "DailyPartHeavyEquipment"]

print("")
print("1. LA BASE")
print("-" * 78)
for nombre in MODELOS:
    try:
        M = apps.get_model("operations", nombre)
    except LookupError:
        print("  {0}: NO EXISTE".format(nombre))
        continue
    campos = {f.name: f for f in M._meta.get_fields() if hasattr(f, "null")}
    tiene_act = "actividad_obra" in campos
    inc = campos.get("incident_report")
    print("  {0}".format(nombre))
    print("      actividad_obra : {0}".format("si" if tiene_act else "NO"))
    if inc is not None:
        print("      incident_report: null={0}  blank={1}".format(
            inc.null, getattr(inc, "blank", "?")))
    print("      filas totales  : {0}".format(M.objects.count()))
    if tiene_act:
        print("      con actividad  : {0}".format(
            M.objects.filter(actividad_obra__isnull=False).count()))
        print("      sin nada       : {0}".format(
            M.objects.filter(actividad_obra__isnull=True,
                             incident_report__isnull=True).count()))

print("")
print("2. LOS SERIALIZERS")
print("-" * 78)
print("  Lo que de verdad llega al navegador. Si 'actividad_obra' no sale")
print("  aqui, la pantalla no puede funcionar aunque el campo exista.")
print("")

import importlib  # noqa: E402

posibles = ["operations.views", "operations.serializers",
            "operations.views_partes", "operations.api"]
vistos = set()
for ruta in posibles:
    try:
        mod = importlib.import_module(ruta)
    except ImportError:
        continue
    for nombre in dir(mod):
        obj = getattr(mod, nombre)
        meta = getattr(obj, "Meta", None)
        modelo = getattr(meta, "model", None) if meta else None
        if modelo is None or modelo.__name__ not in MODELOS:
            continue
        if nombre in vistos:
            continue
        vistos.add(nombre)
        campos = getattr(meta, "fields", None)
        excluir = getattr(meta, "exclude", None)
        print("  {0}  ({1})  en {2}".format(nombre, modelo.__name__, ruta))
        if campos == "__all__":
            print("      fields = '__all__'  -> actividad_obra SALE sola")
        elif campos:
            print("      fields = {0}".format(
                json.dumps(list(campos), ensure_ascii=False)[:600]))
            print("      actividad_obra en la lista: {0}".format(
                "SI" if "actividad_obra" in campos else "NO -- hay que anadirlo"))
        elif excluir:
            print("      exclude = {0}".format(list(excluir)))
            print("      actividad_obra: {0}".format(
                "excluido" if "actividad_obra" in excluir else "sale"))
        else:
            print("      ni fields ni exclude")

if not vistos:
    print("  No encontre ningun serializer de esos modelos en los modulos")
    print("  mirados. Busca a mano:")
    print("      grep -rn 'IncidentPersonnel' operations/*.py | grep -i serial")

print("")
print("3. LAS VISTAS DE LISTA")
print("-" * 78)
print("  Si aceptan filtrar, el navegador pide solo lo suyo. Si no, se trae")
print("  TODO y filtra en el cliente, que es lo que hace hoy la pantalla de")
print("  incidencias y por lo que tarda.")
print("")

from django.urls import get_resolver  # noqa: E402

def recorrer(patrones, prefijo=""):
    for p in patrones:
        if hasattr(p, "url_patterns"):
            recorrer(p.url_patterns, prefijo + str(p.pattern))
        else:
            ruta = prefijo + str(p.pattern)
            for clave in ("incident-personnel", "incident-material",
                          "daily-part-heavy-equipment", "actividades-obra"):
                if clave in ruta:
                    cb = p.callback
                    cls = getattr(cb, "cls", None) or getattr(cb, "view_class", None)
                    print("  /{0}".format(ruta))
                    print("      -> {0}".format(
                        cls.__name__ if cls else getattr(cb, "__name__", cb)))
                    if cls is not None:
                        ff = getattr(cls, "filterset_fields", None)
                        fb = getattr(cls, "filter_backends", None)
                        print("         filterset_fields: {0}".format(ff))
                        print("         filter_backends : {0}".format(
                            [b.__name__ for b in fb] if fb else None))
                        print("         get_queryset propio: {0}".format(
                            "si" if "get_queryset" in cls.__dict__ else "no"))
                    break

recorrer(get_resolver().url_patterns)

print("")
print("4. UNA ACTIVIDAD DE EJEMPLO")
print("-" * 78)
try:
    A = apps.get_model("operations", "ActividadObra")
    act = A.objects.first()
    if act is None:
        print("  Todavia no hay ninguna actividad de obra creada.")
    else:
        print("  {0} - {1}".format(act.codigo or act.id, act.nombre[:50]))
        for nombre, rel in (("IncidentPersonnel", "personal"),
                            ("IncidentMaterial", "materiales"),
                            ("DailyPartHeavyEquipment", "partes")):
            try:
                print("      {0:24s}: {1}".format(
                    rel, getattr(act, rel).count()))
            except Exception as e:
                print("      {0:24s}: no se puede ({1})".format(rel, e))
except LookupError:
    print("  No existe ActividadObra: falta aplicar parche_actividades_obra.py")

print("")
print("=" * 78)
print("Con esto decido si la pantalla puede filtrar en el servidor o tiene")
print("que traerselo todo como hace hoy la de incidencias.")
print("=" * 78)
print("")
