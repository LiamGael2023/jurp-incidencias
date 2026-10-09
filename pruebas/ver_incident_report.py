# -*- coding: utf-8 -*-
"""IncidentReport por dentro: es lo que Actividades va a clonar.

    docker compose exec -T web python manage.py shell < ver_incident_report.py

SOLO LEE.

POR QUE HACE FALTA. El volcado anterior enseño que el parte diario cuelga de
operations.IncidentReport, no de incidentes.Incidente -que es el incidente de
vigilancia, con turno y garita, otra cosa que comparte palabra-. Pero se
quedo sin imprimir la ficha del bueno, porque el filtro cogio los dos
primeros que encontro.

Hace falta ver: que campos tiene, que le cuelga -personal, materiales,
fotos- y como se numera. Actividades sera eso mismo pero con un proyecto
arriba en vez de un incidente, asi que cuanto mejor se vea el original, menos
cosas se inventan.

Tambien se mira Actividad, el catalogo que YA existe con ese nombre: hay que
saber que es para no chocar con el al crear ActividadObra.
"""

from __future__ import print_function

from django.apps import apps


def ficha(modelo, titulo, muestra=True):
    print("")
    print("=" * 76)
    print(titulo)
    print("=" * 76)
    meta = modelo._meta
    print("  {0}.{1}   tabla {2}".format(meta.app_label, modelo.__name__, meta.db_table))
    try:
        total = modelo.objects.count()
    except Exception as e:
        total = "error {0}".format(e)
    print("  filas : {0}".format(total))
    print("")
    print("  Campos:")
    for f in meta.get_fields():
        if not hasattr(f, "get_internal_type"):
            continue
        if f.auto_created and not f.concrete:
            continue
        tipo = f.get_internal_type()
        extra = ""
        if tipo in ("ForeignKey", "OneToOneField"):
            rel = f.related_model
            extra = " -> {0}.{1}  null={2}".format(
                rel._meta.app_label, rel.__name__, getattr(f, "null", "?"))
            try:
                extra += " on_delete={0}".format(
                    getattr(f.remote_field, "on_delete", None).__name__)
            except Exception:
                pass
        elif tipo == "CharField":
            extra = " max={0}".format(getattr(f, "max_length", "?"))
            if getattr(f, "choices", None):
                extra += " choices=[{0}]".format(
                    ", ".join(str(c[0]) for c in f.choices)[:90])
        if getattr(f, "null", False) and tipo not in ("ForeignKey", "OneToOneField"):
            extra += " null"
        if getattr(f, "unique", False):
            extra += " UNICO"
        if f.has_default():
            try:
                d = f.get_default()
                if not callable(d):
                    extra += " def={0!r}".format(d)
            except Exception:
                pass
        print("      {0:<24s} {1}{2}".format(f.name, tipo, extra))

    print("")
    print("  Lo que le cuelga:")
    hay = False
    for f in meta.get_fields():
        if f.auto_created and not f.concrete and getattr(f, "related_model", None):
            rel = f.related_model
            campo = getattr(f, "field", None)
            try:
                n = rel.objects.count()
            except Exception:
                n = "?"
            hay = True
            print("      {0:<26s} via {1:<20s} null={2}  filas={3}".format(
                rel.__name__, getattr(campo, "name", "?"),
                getattr(campo, "null", "?"), n))
    if not hay:
        print("      (nada)")

    if muestra and isinstance(total, int) and total:
        print("")
        print("  Dos de ejemplo:")
        campos = [f.name for f in meta.get_fields()
                  if hasattr(f, "get_internal_type") and f.concrete][:12]
        for obj in modelo.objects.order_by("-id")[:2]:
            trozos = []
            for c in campos:
                try:
                    v = getattr(obj, c, None)
                except Exception:
                    continue
                s = str(v)
                if len(s) > 26:
                    s = s[:24] + "…"
                trozos.append("{0}={1}".format(c, s))
            print("      {0}".format("  ".join(trozos)[:160]))


por_nombre = {}
for m in apps.get_models():
    por_nombre.setdefault(m.__name__, m)

for nombre, titulo in (
        ("IncidentReport", "IncidentReport — EL PADRE DE LOS PARTES"),
        ("IncidentPersonnel", "IncidentPersonnel"),
        ("IncidentMaterial", "IncidentMaterial"),
        ("IncidenteCerrado", "IncidenteCerrado"),
        ("Actividad", "Actividad — EL CATALOGO QUE YA OCUPA ESE NOMBRE")):
    m = por_nombre.get(nombre)
    if m is None:
        print("")
        print("  (no existe {0})".format(nombre))
        continue
    ficha(m, titulo)

print("")
print("=" * 76)
print("LO QUE IMPORTA PARA ACTIVIDADES")
print("=" * 76)
try:
    from operations.models import DailyPartHeavyEquipment as P
    f = P._meta.get_field("incident_report")
    print("  El parte apunta a {0} con null={1}.".format(
        f.related_model.__name__, f.null))
    if not f.null:
        print("  -> Para que un parte pueda colgar de una actividad hay que")
        print("     permitir nulo ahi. Es una migracion sobre {0} filas, pero")
        print("     de las seguras: relajar no borra ni mueve nada.".format(
            P.objects.count()))
except Exception as e:
    print("  no pude mirarlo: {0}".format(e))

print("")
print("Nada se ha escrito.")
