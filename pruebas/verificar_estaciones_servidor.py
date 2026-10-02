# -*- coding: utf-8 -*-
"""
Qué estación transmite de verdad, preguntándoselo a la base.

    docker compose exec -T <servicio> python - < verificar_estaciones_servidor.py

OJO con la forma de ejecutarlo. NO va con `manage.py shell < archivo`: eso lo
mete en una consola interactiva, donde una línea en blanco dentro de un bloque
lo da por terminado y salta IndentationError. `python -` lo ejecuta como lo
que es, un script, y por eso arranca Django él mismo.

Tampoco lleva f-strings: el backend de JURP corre sobre Python 3.5, que es
anterior a ellas.

POR QUÉ AQUÍ Y NO EN LA APP. El navegador solo sabe una cosa: que
filtered-data no devolvió lecturas de hoy. Eso no distingue tres casos muy
distintos — que el equipo no esté mandando, que esté mandando y el backend no
lo guarde, o que lo guarde y el endpoint no lo entregue. La última fila de
cada estación en la base sí los distingue, porque es el dato crudo: si hay
fila, el equipo transmitió.

No modifica nada: solo lee.
"""

from __future__ import print_function, unicode_literals

import os
import sys
import datetime

# ── Arranque de Django ─────────────────────────────────────────────────────
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
        print("No se pudo arrancar Django. Dime cuál es el módulo de settings.")
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


def hora_peru(d):
    if timezone.is_naive(d):
        d = timezone.make_aware(d)
    return d.astimezone(PERU).strftime("%Y-%m-%d %H:%M")


print(RAYA)
print("HUSO HORARIO DEL SERVIDOR")
print(RAYA)
print("  TIME_ZONE = {}    USE_TZ = {}".format(settings.TIME_ZONE, settings.USE_TZ))
print("  ahora (UTC)  {}".format(AHORA.astimezone(datetime.timezone.utc).strftime("%Y-%m-%d %H:%M")))
print("  ahora (Peru) {}".format(AHORA.astimezone(PERU).strftime("%Y-%m-%d %H:%M")))
print("  Si las dos fechas CAEN EN DIAS DISTINTOS, una lectura de la noche puede")
print("  quedar en el dia de al lado y el mapa la daria por 'sin datos'.")
print("")


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


# ── Inventario completo, por si la corazonada falla ────────────────────────
SALTAR = {"admin", "auth", "contenttypes", "sessions", "authtoken", "sites"}
inventario = []
for modelo in apps.get_models():
    if modelo._meta.app_label in SALTAR:
        continue
    try:
        n = modelo.objects.count()
    except Exception:
        n = -1
    inventario.append((n, modelo))
inventario.sort(key=lambda x: x[0], reverse=True)

print(RAYA)
print("LOS 15 MODELOS CON MAS FILAS")
print(RAYA)
for n, modelo in inventario[:15]:
    print("  {:>12,}  {}.{}   fecha={} equipo={}".format(
        n, modelo._meta.app_label, modelo.__name__,
        campo_fecha(modelo), campo_estacion(modelo)))
print("")

# ── El modelo de lecturas ──────────────────────────────────────────────────
PINTA_MODELO = ("rain", "lluvia", "reading", "lectura", "measure", "medicion",
                "data", "dato", "archive", "precip", "weather", "clima", "obs")
PINTA_APP = ("davis", "lluvia", "rain", "pluvi", "weather", "clima", "estacion")

candidatos = []
for n, modelo in inventario:
    if n <= 0:
        continue
    nombre, etiqueta = modelo.__name__.lower(), modelo._meta.app_label.lower()
    if not (any(p in nombre for p in PINTA_MODELO) or any(p in etiqueta for p in PINTA_APP)):
        continue
    f, e = campo_fecha(modelo), campo_estacion(modelo)
    if f and e:
        candidatos.append((modelo, f, e, n))

print(RAYA)
print("MODELOS QUE PARECEN DE LECTURAS")
print(RAYA)
for modelo, f, e, n in candidatos:
    print("  {}.{}: {:,} filas - fecha='{}' equipo='{}'".format(
        modelo._meta.app_label, modelo.__name__, n, f, e))
if not candidatos:
    print("  Ninguno. Mira la lista de arriba y dime cual es el de lecturas.")
    sys.exit(0)

modelo, cf, ce, _ = candidatos[0]          # el de mas filas
print("")
print("  -> Se usa {}.{} (fecha '{}', equipo '{}')".format(
    modelo._meta.app_label, modelo.__name__, cf, ce))

# ── Última lectura por estación ────────────────────────────────────────────
print("")
print(RAYA)
print("ULTIMA LECTURA POR ESTACION")
print(RAYA)

resumen = (modelo.objects.values(ce)
           .annotate(ultima=djm.Max(cf), n=djm.Count("id"))
           .order_by("ultima"))
filas = list(resumen)

rel = modelo._meta.get_field(ce).related_model
nombres, ubic = {}, {}
try:
    for obj in rel.objects.all():
        nombres[obj.pk] = (getattr(obj, "nombre", None) or getattr(obj, "name", None)
                           or getattr(obj, "station_name", None) or str(obj))
        lat = getattr(obj, "latitude", None) or getattr(obj, "latitud", None)
        lng = getattr(obj, "longitude", None) or getattr(obj, "longitud", None)
        ubic[obj.pk] = (lat, lng)
except Exception as ex:
    print("  (no se pudieron leer los nombres: {})".format(ex))

print("{:>6}  {:<28} {:<18} {:>9}  {}".format("ID", "ESTACION", "ULTIMA (Peru)", "CALLADA", "LECTURAS"))
print("-" * 78)
callados = []
for r in filas:
    pk, ult = r[ce], r["ultima"]
    if ult is None:
        continue
    if isinstance(ult, datetime.datetime):
        texto = hora_peru(ult)
        dias = (AHORA - (ult if timezone.is_aware(ult) else timezone.make_aware(ult))).days
    else:
        texto, dias = str(ult), (AHORA.date() - ult).days
    marca = "  " if dias < 1 else ("- " if dias < 2 else "! ")
    print("{}{:>4}  {:<28} {:<18} {:>6} d  {:>8,}".format(
        marca, pk, str(nombres.get(pk, "?"))[:28], texto, dias, r["n"]))
    if dias >= 2:
        callados.append((pk, nombres.get(pk, "?"), texto, dias))
print("")
print("  (hora de Peru; '!' = dos dias o mas sin mandar)")

# ── Dados de alta que nunca han transmitido ────────────────────────────────
print("")
print(RAYA)
print("DADOS DE ALTA QUE NUNCA HAN TRANSMITIDO")
print(RAYA)
con_datos = set(r[ce] for r in filas)
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
        print("  Ninguno: todos los equipos registrados tienen al menos una lectura.")
except Exception as ex:
    print("  No se pudo comprobar ({})".format(ex))

# ── Lo que el mapa pediría hoy ─────────────────────────────────────────────
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
