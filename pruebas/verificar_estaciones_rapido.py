# -*- coding: utf-8 -*-
"""
Lo mismo que verificar_estaciones_servidor.py, pero sin contar filas.

    docker compose exec -T jurp_web python - < verificar_estaciones_rapido.py

POR QUE EXISTE. La version larga cuenta las filas de cada modelo para decidir
cual es el de lecturas. Sobre TimescaleDB eso es carisimo: la tabla de
lecturas es una hypertable de millones de filas y un COUNT(*) la recorre
entera. Aqui no se cuenta nada: el modelo se elige por su nombre, y todo lo
demas sale de consultas agrupadas que el indice resuelve solo.

No modifica nada: solo lee.
"""

from __future__ import print_function, unicode_literals

import os
import sys
import datetime

if not os.environ.get("DJANGO_SETTINGS_MODULE"):
    for intento in ("config.settings", "core.settings", "jurp.settings",
                    "settings", "src.config.settings"):
        os.environ["DJANGO_SETTINGS_MODULE"] = intento
        try:
            import django
            django.setup()
            break
        except Exception:
            continue
    else:
        print("No se pudo arrancar Django. Dime cual es el modulo de settings.")
        sys.exit(1)
else:
    import django
    django.setup()

from django.apps import apps                     # noqa: E402
from django.db import models as djm              # noqa: E402
from django.utils import timezone                # noqa: E402
from django.conf import settings                 # noqa: E402

PERU = datetime.timezone(datetime.timedelta(hours=-5))
AHORA = timezone.now()
RAYA = "=" * 78


def campo_fecha(modelo):
    preferidos = ("timestamp", "fecha", "date_time", "datetime", "created_at",
                  "fecha_hora", "time", "recorded_at", "dateutc")
    fechas = [f.name for f in modelo._meta.get_fields()
              if isinstance(f, (djm.DateTimeField, djm.DateField))]
    for p in preferidos:
        if p in fechas:
            return p
    return fechas[0] if fechas else None


def campo_estacion(modelo):
    claves = ("station", "device", "estacion", "equipo", "gauge", "sensor", "pluvi")
    fks = [f for f in modelo._meta.get_fields() if isinstance(f, djm.ForeignKey)]
    for f in fks:
        if any(c in f.name.lower() for c in claves):
            return f.name
    return fks[0].name if fks else None


print(RAYA)
print("HUSO HORARIO")
print(RAYA)
print("  TIME_ZONE = {}    USE_TZ = {}".format(settings.TIME_ZONE, settings.USE_TZ))
print("  ahora (UTC)  {}".format(AHORA.astimezone(datetime.timezone.utc).strftime("%Y-%m-%d %H:%M")))
print("  ahora (Peru) {}".format(AHORA.astimezone(PERU).strftime("%Y-%m-%d %H:%M")))
print("")

# ── Candidatos, sin contar una sola fila ──────────────────────────────────
SALTAR = {"admin", "auth", "contenttypes", "sessions", "authtoken", "sites"}
PINTA_MODELO = ("rain", "lluvia", "reading", "lectura", "measure", "medicion",
                "data", "dato", "archive", "precip", "weather", "clima", "obs")
PINTA_APP = ("davis", "lluvia", "rain", "pluvi", "weather", "clima", "estacion")

print(RAYA)
print("MODELOS CON FECHA Y RELACION A UN EQUIPO")
print(RAYA)
candidatos = []
for modelo in apps.get_models():
    if modelo._meta.app_label in SALTAR:
        continue
    f, e = campo_fecha(modelo), campo_estacion(modelo)
    if not (f and e):
        continue
    nombre, etiqueta = modelo.__name__.lower(), modelo._meta.app_label.lower()
    pinta = (any(p in nombre for p in PINTA_MODELO)
             or any(p in etiqueta for p in PINTA_APP))
    print("  {} {}.{}   fecha='{}' equipo='{}'".format(
        "*" if pinta else " ", modelo._meta.app_label, modelo.__name__, f, e))
    if pinta:
        candidatos.append((modelo, f, e))
print("")
print("  ('*' = parece de lecturas de lluvia)")

if not candidatos:
    print("")
    print("  Ninguno marcado. Mira la lista y dime cual es, que lo fijo a mano.")
    sys.exit(0)

# De los marcados, el que tenga la fila mas reciente es el de lecturas:
# un modelo de alertas o de resumenes se actualiza mucho menos.
elegido = None
for modelo, f, e in candidatos:
    try:
        ultima = modelo.objects.order_by("-" + f).values_list(f, flat=True).first()
    except Exception:
        ultima = None
    print("  {}.{}: ultima fila {}".format(
        modelo._meta.app_label, modelo.__name__, ultima or "ninguna"))
    if ultima and (elegido is None or ultima > elegido[3]):
        elegido = (modelo, f, e, ultima)

if not elegido:
    print("")
    print("  Ninguno tiene filas. Dime cual deberia tenerlas.")
    sys.exit(0)

modelo, cf, ce, _ = elegido
print("")
print("  -> Se usa {}.{} (fecha '{}', equipo '{}')".format(
    modelo._meta.app_label, modelo.__name__, cf, ce))

# ── Ultima lectura por estacion ───────────────────────────────────────────
print("")
print(RAYA)
print("ULTIMA LECTURA POR ESTACION")
print(RAYA)
filas = list(modelo.objects.values(ce).annotate(ultima=djm.Max(cf)).order_by("ultima"))

rel = modelo._meta.get_field(ce).related_model
nombres, ubic = {}, {}
try:
    for obj in rel.objects.all():
        nombres[obj.pk] = (getattr(obj, "nombre", None) or getattr(obj, "name", None)
                           or getattr(obj, "station_name", None) or str(obj))
        ubic[obj.pk] = (getattr(obj, "latitude", None) or getattr(obj, "latitud", None),
                        getattr(obj, "longitude", None) or getattr(obj, "longitud", None))
except Exception as ex:
    print("  (no se pudieron leer los nombres: {})".format(ex))

print("{:>6}  {:<30} {:<18} {:>9}".format("ID", "ESTACION", "ULTIMA (Peru)", "CALLADA"))
print("-" * 70)
callados, por_dia = [], {}
for r in filas:
    pk, ult = r[ce], r["ultima"]
    if ult is None:
        continue
    if isinstance(ult, datetime.datetime):
        if timezone.is_naive(ult):
            ult = timezone.make_aware(ult)
        texto = ult.astimezone(PERU).strftime("%Y-%m-%d %H:%M")
        dias = (AHORA - ult).days
        por_dia.setdefault(ult.astimezone(PERU).strftime("%Y-%m-%d"), []).append(
            nombres.get(pk, pk))
    else:
        texto, dias = str(ult), (AHORA.date() - ult).days
    marca = "  " if dias < 1 else ("- " if dias < 2 else "! ")
    print("{}{:>4}  {:<30} {:<18} {:>6} d".format(
        marca, pk, str(nombres.get(pk, "?"))[:30], texto, dias))
    if dias >= 2:
        callados.append((pk, nombres.get(pk, "?"), texto, dias))
print("")
print("  (hora de Peru; '!' = dos dias o mas sin mandar)")

# ── Varias calladas el mismo dia: eso es el servidor, no el campo ─────────
sospechosos = dict((d, n) for d, n in por_dia.items() if len(n) >= 3)
if sospechosos:
    print("")
    print(RAYA)
    print("VARIAS ESTACIONES CALLADAS EL MISMO DIA")
    print(RAYA)
    print("  Tres o mas equipos que dejan de mandar el mismo dia no es casualidad")
    print("  de campo: apunta al servidor (worker caido, cola parada, migracion).")
    for d in sorted(sospechosos):
        if (AHORA.astimezone(PERU).strftime("%Y-%m-%d")) == d:
            continue          # las de hoy estan vivas, no calladas
        print("  {}: {}".format(d, ", ".join(str(x) for x in sospechosos[d])))

# ── Nunca han transmitido ─────────────────────────────────────────────────
print("")
print(RAYA)
print("DADOS DE ALTA QUE NUNCA HAN TRANSMITIDO")
print(RAYA)
con_datos = set(r[ce] for r in filas if r["ultima"] is not None)
try:
    nunca = [o for o in rel.objects.all() if o.pk not in con_datos]
    if nunca:
        for o in nunca:
            lat, lng = ubic.get(o.pk, (None, None))
            extra = ""
            if lat in (None, 0) or lng in (None, 0):
                extra = "   <- ademas sin ubicar (0,0): el mapa no lo dibuja"
            print("  {:>4}  {}{}".format(o.pk, nombres.get(o.pk, "?"), extra))
    else:
        print("  Ninguno.")
except Exception as ex:
    print("  No se pudo comprobar ({})".format(ex))

# ── Lo que el mapa veria hoy ──────────────────────────────────────────────
print("")
print(RAYA)
print("LO QUE EL MAPA VERIA HOY")
print(RAYA)
hoy_peru = AHORA.astimezone(PERU).date()
ini = datetime.datetime.combine(hoy_peru, datetime.time.min)
fin = datetime.datetime.combine(hoy_peru, datetime.time.max)
if settings.USE_TZ:
    ini, fin = timezone.make_aware(ini), timezone.make_aware(fin)
hoy = modelo.objects.filter(**{cf + "__range": (ini, fin)}).values(ce).annotate(n=djm.Count("id"))
mapa = dict((r[ce], r["n"]) for r in hoy)
print("  Dia consultado (hora de Peru): {}".format(hoy_peru))
print("  Estaciones con lecturas hoy: {} de {} que alguna vez mandaron".format(
    len(mapa), len(con_datos)))
for pk, nom, texto, dias in callados[:20]:
    if pk in mapa:
        print("  OJO: {} tiene {} lecturas hoy pero su ultima figura hace {} dias:".format(
            nom, mapa[pk], dias))
        print("       es un problema de fechas, no del equipo.")
print("")
print("Listo. Nada se modifico.")
