"""
Qué estación transmite de verdad, preguntándoselo a la base.

    docker compose exec web python manage.py shell < verificar_estaciones_servidor.py

(o `python manage.py shell < ...` si corre fuera de contenedor)

POR QUÉ AQUÍ Y NO EN LA APP. El navegador solo sabe una cosa: que
filtered-data no devolvió lecturas de hoy. Eso no distingue tres casos muy
distintos — que el equipo no esté mandando, que esté mandando y el backend no
lo guarde, o que lo guarde y el endpoint no lo entregue. La última fila de
cada estación en la base sí los distingue, porque es el dato crudo: si hay
fila, el equipo transmitió.

No modifica nada: solo lee.
"""

import datetime
from django.apps import apps
from django.db import models as djm
from django.utils import timezone
from django.conf import settings

AHORA = timezone.now()

print("=" * 78)
print("HUSO HORARIO DEL SERVIDOR")
print("=" * 78)
print(f"  TIME_ZONE = {settings.TIME_ZONE}    USE_TZ = {settings.USE_TZ}")
print(f"  ahora (UTC)  {AHORA.astimezone(datetime.timezone.utc):%Y-%m-%d %H:%M}")
print(f"  ahora (Perú) {AHORA.astimezone(datetime.timezone(datetime.timedelta(hours=-5))):%Y-%m-%d %H:%M}")
print("  Si las dos fechas CAEN EN DÍAS DISTINTOS, una lectura de la noche puede")
print("  quedar en el día de al lado y el mapa la daría por 'sin datos'.\n")


def campo_fecha(modelo):
    """El campo de fecha más probable de un modelo de lecturas."""
    preferidos = ("timestamp", "fecha", "date_time", "datetime", "created_at", "fecha_hora")
    fechas = [f.name for f in modelo._meta.get_fields()
              if isinstance(f, (djm.DateTimeField, djm.DateField))]
    for p in preferidos:
        if p in fechas:
            return p
    return fechas[0] if fechas else None


def campo_estacion(modelo):
    """La relación que apunta al equipo."""
    claves = ("station", "device", "estacion", "equipo", "gauge", "sensor")
    for f in modelo._meta.get_fields():
        if isinstance(f, djm.ForeignKey) and any(c in f.name.lower() for c in claves):
            return f.name
    for f in modelo._meta.get_fields():
        if isinstance(f, djm.ForeignKey):
            return f.name
    return None


print("=" * 78)
print("MODELOS QUE PARECEN DE LECTURAS")
print("=" * 78)
candidatos = []
for modelo in apps.get_models():
    nombre = modelo.__name__.lower()
    etiqueta = modelo._meta.app_label.lower()
    pinta = any(p in nombre for p in ("rain", "lluvia", "reading", "lectura", "measure",
                                      "medicion", "data", "dato", "archive", "precip"))
    pinta = pinta or any(p in etiqueta for p in ("davis", "lluvia", "rain", "pluvi"))
    if not pinta:
        continue
    f = campo_fecha(modelo)
    e = campo_estacion(modelo)
    if not f:
        continue
    try:
        n = modelo.objects.count()
    except Exception as ex:
        print(f"  {etiqueta}.{modelo.__name__}: no se pudo contar ({ex})")
        continue
    print(f"  {etiqueta}.{modelo.__name__}: {n:,} filas · fecha='{f}' · equipo='{e}'")
    if n and e:
        candidatos.append((modelo, f, e, n))

if not candidatos:
    print("\n  Ninguno. Pásame los modelos de la app de Davis y lo ajusto.")
    raise SystemExit

# El de más filas es el de las lecturas; los demás suelen ser alertas o resúmenes.
modelo, cf, ce, _ = max(candidatos, key=lambda x: x[3])
print(f"\n  → Se usa {modelo._meta.app_label}.{modelo.__name__} "
      f"(fecha '{cf}', equipo '{ce}')")

print("\n" + "=" * 78)
print("ÚLTIMA LECTURA POR ESTACIÓN")
print("=" * 78)

ultimos = (modelo.objects
           .values(ce)
           .annotate(ultima=djm.Max(cf), n=djm.Count("id"))
           .order_by("ultima"))

# Nombre del equipo, si se puede resolver.
rel = modelo._meta.get_field(ce).related_model
nombres = {}
try:
    for obj in rel.objects.all():
        etq = (getattr(obj, "nombre", None) or getattr(obj, "name", None)
               or getattr(obj, "station_name", None) or str(obj))
        nombres[obj.pk] = etq
except Exception:
    pass

filas = list(ultimos)
print(f"{'ID':>6}  {'ESTACIÓN':<28} {'ÚLTIMA LECTURA':<20} {'CALLADA':>9}  LECTURAS")
print("-" * 78)
callados = []
for r in filas:
    pk = r[ce]
    ult = r["ultima"]
    if ult is None:
        continue
    if isinstance(ult, datetime.datetime):
        if timezone.is_naive(ult):
            ult = timezone.make_aware(ult)
        dias = (AHORA - ult).days
        texto = f"{ult.astimezone(datetime.timezone(datetime.timedelta(hours=-5))):%Y-%m-%d %H:%M}"
    else:
        dias = (AHORA.date() - ult).days
        texto = str(ult)
    marca = "  " if dias < 1 else ("· " if dias < 2 else "! ")
    print(f"{marca}{pk:>4}  {str(nombres.get(pk, '?'))[:28]:<28} {texto:<20} {dias:>6} d  {r['n']:>8,}")
    if dias >= 2:
        callados.append((pk, nombres.get(pk, "?"), texto, dias))

print("\n  (hora de Perú; '!' = lleva dos días o más sin mandar)")

# ── Equipos dados de alta que NUNCA han mandado nada ──────────────────────
print("\n" + "=" * 78)
print("DADOS DE ALTA QUE NUNCA HAN TRANSMITIDO")
print("=" * 78)
con_datos = {r[ce] for r in filas}
try:
    nunca = [o for o in rel.objects.all() if o.pk not in con_datos]
    if nunca:
        for o in nunca:
            lat = getattr(o, "latitude", None)
            lng = getattr(o, "longitude", None)
            ubic = ""
            if lat in (None, 0) or lng in (None, 0):
                ubic = "   ← además sin ubicar (0,0): el mapa no lo dibuja"
            print(f"  {o.pk:>4}  {nombres.get(o.pk, '?')}{ubic}")
    else:
        print("  Ninguno: todos los equipos registrados tienen al menos una lectura.")
except Exception as ex:
    print(f"  No se pudo comprobar ({ex})")

# ── Lo que el mapa pediría HOY ────────────────────────────────────────────
print("\n" + "=" * 78)
print("LO QUE EL MAPA VERÍA HOY")
print("=" * 78)
hoy_peru = AHORA.astimezone(datetime.timezone(datetime.timedelta(hours=-5))).date()
ini = datetime.datetime.combine(hoy_peru, datetime.time.min)
fin = datetime.datetime.combine(hoy_peru, datetime.time.max)
if settings.USE_TZ:
    ini, fin = timezone.make_aware(ini), timezone.make_aware(fin)
hoy = (modelo.objects.filter(**{f"{cf}__range": (ini, fin)})
       .values(ce).annotate(n=djm.Count("id")))
mapa = {r[ce]: r["n"] for r in hoy}
print(f"  Día consultado (hora de Perú): {hoy_peru}")
print(f"  Estaciones con lecturas hoy: {len(mapa)} de {len(con_datos)} que alguna vez mandaron")
for pk, nom, texto, dias in callados[:20]:
    if pk in mapa:
        print(f"  ¡OJO! {nom} tiene {mapa[pk]} lecturas hoy pero su última figura "
              f"hace {dias} días: hay un problema de fechas, no del equipo.")
print("\nListo. Nada se modificó.")
