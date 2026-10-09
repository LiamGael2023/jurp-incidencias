# -*- coding: utf-8 -*-
"""Lo unico que bloquea: si los serializers exponen actividad_obra."""
from __future__ import print_function
import importlib
from django.apps import apps

MODELOS = ["IncidentPersonnel", "IncidentMaterial", "DailyPartHeavyEquipment"]

print("")
print("=" * 70)
print("1. LA BASE")
print("=" * 70)
for nombre in MODELOS:
    try:
        M = apps.get_model("operations", nombre)
    except LookupError:
        print("  %s: NO EXISTE" % nombre); continue
    campos = {f.name: f for f in M._meta.get_fields() if hasattr(f, "null")}
    inc = campos.get("incident_report")
    print("  %s" % nombre)
    print("      actividad_obra : %s" % ("si" if "actividad_obra" in campos else "NO"))
    if inc is not None:
        print("      incident_report: null=%s" % inc.null)
    print("      filas          : %s" % M.objects.count())
    if "actividad_obra" in campos:
        print("      con actividad  : %s"
              % M.objects.filter(actividad_obra__isnull=False).count())

print("")
print("=" * 70)
print("2. LOS SERIALIZERS  <-- esto es lo que necesito")
print("=" * 70)
vistos = set()
for ruta in ("operations.views", "operations.serializers", "operations.api",
             "operations.views_partes", "operations.views_incidentes"):
    try:
        mod = importlib.import_module(ruta)
    except ImportError:
        continue
    for nombre in dir(mod):
        obj = getattr(mod, nombre)
        meta = getattr(obj, "Meta", None)
        modelo = getattr(meta, "model", None) if meta else None
        if modelo is None or modelo.__name__ not in MODELOS or nombre in vistos:
            continue
        vistos.add(nombre)
        campos = getattr(meta, "fields", None)
        excluir = getattr(meta, "exclude", None)
        print("  %s  (%s)  en %s" % (nombre, modelo.__name__, ruta))
        if campos == "__all__":
            print("      fields = __all__  ->  actividad_obra SALE sola  OK")
        elif campos:
            print("      actividad_obra en fields: %s"
                  % ("SI" if "actividad_obra" in campos else "NO -- hay que anadirlo"))
            print("      fields = %s" % (list(campos),))
        elif excluir:
            print("      exclude = %s" % (list(excluir),))
        else:
            print("      ni fields ni exclude")
if not vistos:
    print("  No encontre los serializers. Busca a mano:")
    print("      grep -rn IncidentPersonnel operations/*.py | grep -i serial")

print("")
print("=" * 70)
print("3. UNA ACTIVIDAD DE EJEMPLO")
print("=" * 70)
try:
    A = apps.get_model("operations", "ActividadObra")
    act = A.objects.first()
    if act is None:
        print("  Todavia no hay ninguna actividad creada.")
    else:
        print("  %s - %s" % (act.codigo or act.id, act.nombre[:50]))
        for rel in ("personal", "materiales", "partes"):
            try:
                print("      %-12s: %s" % (rel, getattr(act, rel).count()))
            except Exception as e:
                print("      %-12s: no se puede (%s)" % (rel, e))
except LookupError:
    print("  No existe ActividadObra.")
print("")
