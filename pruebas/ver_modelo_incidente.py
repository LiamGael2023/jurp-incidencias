# -*- coding: utf-8 -*-
"""Como esta armado Incidentes, para poder hacer Actividades a su imagen.

    docker compose exec -T web python manage.py shell < ver_modelo_incidente.py

SOLO LEE. No escribe, no migra, no toca ninguna tabla.

PARA QUE. Actividades va a ser lo mismo que Incidentes pero colgando de un
PROYECTO en vez de un incidente: proyecto -> actividad -> partes diarios ->
lineas con partida. Para clonarlo bien hay que ver como esta hecho el
original, no imaginarselo:

  1. QUE CAMPOS tiene el incidente, y cuales son suyos de verdad y cuales son
     de «algo salio mal» (gravedad, tipo de falla). Esos ultimos no se copian:
     una zanja presupuestada no tiene gravedad.

  2. DE QUE CUELGAN LOS PARTES. Si el parte apunta al incidente con una clave
     obligatoria, Actividades no puede reusar la misma tabla sin tocarla. Y
     tocarla mal deja los partes existentes sin padre, que es la forma cara
     de equivocarse aqui.

  3. QUE MAS CUELGA del incidente: bitacora, fotos, recursos, costos. Cada
     una de esas es una decision: se copia, se comparte o se deja fuera.

  4. CUANTO HAY YA, para saber si una migracion seria barata o delicada.
"""

from __future__ import print_function

from django.apps import apps


def ficha(modelo, titulo):
    print("")
    print("=" * 76)
    print(titulo)
    print("=" * 76)
    meta = modelo._meta
    print("  {0}.{1}   tabla {2}".format(meta.app_label, modelo.__name__, meta.db_table))
    try:
        print("  filas : {0}".format(modelo.objects.count()))
    except Exception as e:
        print("  filas : error {0}".format(e))
    print("")
    print("  Campos propios:")
    for f in meta.get_fields():
        if not hasattr(f, "get_internal_type"):
            continue
        if f.auto_created and not f.concrete:
            continue
        tipo = f.get_internal_type()
        extra = ""
        if tipo in ("ForeignKey", "OneToOneField"):
            rel = f.related_model
            extra = " -> {0}.{1}".format(rel._meta.app_label, rel.__name__)
            extra += "  null={0}".format(getattr(f, "null", "?"))
            try:
                extra += " on_delete={0}".format(
                    getattr(f.remote_field, "on_delete", None).__name__)
            except Exception:
                pass
        elif tipo == "CharField":
            extra = " max={0}".format(getattr(f, "max_length", "?"))
            if getattr(f, "choices", None):
                vals = [str(c[0]) for c in f.choices][:8]
                extra += " choices={0}".format(", ".join(vals))
        if getattr(f, "null", False) and tipo not in ("ForeignKey", "OneToOneField"):
            extra += " null"
        print("      {0:<26s} {1}{2}".format(f.name, tipo, extra))

    print("")
    print("  Lo que le apunta (lo que colgaria tambien de una actividad):")
    hay = False
    for f in meta.get_fields():
        if f.auto_created and not f.concrete and hasattr(f, "related_model"):
            rel = f.related_model
            if rel is None:
                continue
            hay = True
            try:
                n = rel.objects.count()
            except Exception:
                n = "?"
            # ¿La clave hacia el incidente admite nulo? Eso decide si la
            # tabla se puede reusar sin tocarla.
            campo = getattr(f, "field", None)
            nulo = getattr(campo, "null", "?") if campo is not None else "?"
            print("      {0:<28s} via {1:<22s} null={2}  filas={3}".format(
                rel.__name__, getattr(campo, "name", "?"), nulo, n))
    if not hay:
        print("      (nada)")


print("")
print("MODELOS DE operations")
print("-" * 76)
try:
    modelos = sorted(apps.get_app_config("operations").get_models(),
                     key=lambda m: m.__name__)
    for m in modelos:
        try:
            n = m.objects.count()
        except Exception:
            n = "?"
        print("  {0:<34s} {1:<40s} {2} filas".format(
            m.__name__, m._meta.db_table, n))
except Exception as e:
    print("  no pude listar: {0}".format(e))

buscados = []
for m in apps.get_models():
    n = m.__name__.lower()
    if n in ("incidente", "incident") or ("incident" in n and "action" not in n
                                          and "foto" not in n):
        buscados.append((m, "EL INCIDENTE"))
for m, t in buscados[:2]:
    ficha(m, t)

# El parte diario, que es lo que de verdad hay que poder reusar.
for m in apps.get_models():
    n = m.__name__.lower()
    if "dailypart" in n and "activity" not in n and "detail" not in n:
        ficha(m, "EL PARTE DIARIO ({0})".format(m.__name__))
        break

for m in apps.get_models():
    if m.__name__.lower() == "dailypartactivity":
        ficha(m, "LA LINEA DEL PARTE (donde vive la partida)")
        break

print("")
print("=" * 76)
print("LO QUE HAY QUE DECIDIR CON ESTO DELANTE")
print("=" * 76)
print("  - Si la clave del parte hacia el incidente admite nulo, Actividades")
print("    puede reusar la MISMA tabla de partes anadiendo una clave hacia la")
print("    actividad. Si no lo admite, hay que hacerla opcional primero, y")
print("    eso es una migracion sobre datos que ya existen.")
print("  - Los campos de «algo salio mal» (gravedad, tipo) no se copian.")
print("  - El proyecto ya existe como dato: Partida.obra y Partida.proyecto.")
print("")
print("Nada se ha escrito.")
