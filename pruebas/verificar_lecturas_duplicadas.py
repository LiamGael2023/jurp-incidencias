# -*- coding: utf-8 -*-
"""
Lecturas repetidas y relojes adelantados en las estaciones Davis.

    docker compose exec -T jurp_web python - < verificar_lecturas_duplicadas.py

POR QUE. Tres estaciones tienen muchisimas mas lecturas que las demas
—YUGOSLAVIA 322.000 frente a las ~17.000 de la mayoria— y una de ellas marca
una hora por delante de la del servidor. Importa porque el acumulado del dia
sale de SUMAR lecturas: si estan repetidas, el mapa muestra mas lluvia de la
que cayo, y con los umbrales de alerta eso dispara avisos falsos.

Lo que se responde aqui:
  1. ¿Hay filas con la misma estacion y el mismo instante?
  2. ¿Cada cuanto reporta cada estacion? (una que reporte cada minuto no es
     un error, es otra configuracion)
  3. ¿Cuanto cambia el acumulado de hoy si se quitan las repetidas?
  4. ¿Hay relojes por delante del servidor?
  5. ¿Desde cuando pasa?

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
        print("No se pudo arrancar Django.")
        sys.exit(1)
else:
    import django
    django.setup()

from django.apps import apps                      # noqa: E402
from django.db import models as djm               # noqa: E402
from django.db.models.functions import TruncDate  # noqa: E402
from django.utils import timezone                 # noqa: E402

PERU = datetime.timezone(datetime.timedelta(hours=-5))
AHORA = timezone.now()
RAYA = "=" * 78

RawDavis = apps.get_model("davis", "RawDavis")
CF, CE = "collect_time", "station"

rel = RawDavis._meta.get_field(CE).related_model
nombres = {}
for o in rel.objects.all():
    nombres[o.pk] = (getattr(o, "nombre", None) or getattr(o, "name", None) or str(o))


def nombre(pk):
    return str(nombres.get(pk, pk))[:26]


# ══════════════════════════════════════════════════════════════════════════
print(RAYA)
print("1. FILAS CON LA MISMA ESTACION Y EL MISMO INSTANTE")
print(RAYA)
desde7 = AHORA - datetime.timedelta(days=7)
rep = (RawDavis.objects.filter(**{CF + "__gte": desde7})
       .values(CE, CF).annotate(n=djm.Count("id")).filter(n__gt=1))
porestacion = {}
total_rep = 0
for r in rep:
    porestacion[r[CE]] = porestacion.get(r[CE], 0) + (r["n"] - 1)
    total_rep += r["n"] - 1
if porestacion:
    print("  Sobrantes en los ultimos 7 dias (filas de mas por repetir instante):")
    for pk in sorted(porestacion, key=lambda k: -porestacion[k]):
        print("    {:>4}  {:<26} {:>8,} de mas".format(pk, nombre(pk), porestacion[pk]))
    print("    {:>31}  {:>8,} en total".format("", total_rep))
else:
    print("  Ninguna: no hay dos filas con la misma estacion y el mismo instante.")
    print("  Entonces las que tienen mas lecturas simplemente reportan mas seguido.")

# ══════════════════════════════════════════════════════════════════════════
print("")
print(RAYA)
print("2. CADA CUANTO REPORTA CADA ESTACION")
print(RAYA)
print("  Se miran las ultimas 24 h. Lo normal en estas Davis son 15 min.")
print("")
desde1 = AHORA - datetime.timedelta(days=1)
print("{:>6}  {:<26} {:>9} {:>12} {:>14}".format(
    "ID", "ESTACION", "LECTURAS", "INSTANTES", "CADA (min)"))
print("-" * 74)
for pk in sorted(nombres):
    qs = RawDavis.objects.filter(**{CE: pk, CF + "__gte": desde1})
    n = qs.count()
    if not n:
        continue
    distintos = qs.values(CF).distinct().count()
    tiempos = list(qs.values_list(CF, flat=True).order_by(CF))
    if len(tiempos) > 1:
        huecos = [(tiempos[i + 1] - tiempos[i]).total_seconds() / 60.0
                  for i in range(len(tiempos) - 1)]
        huecos.sort()
        cada = huecos[len(huecos) // 2]
    else:
        cada = 0
    aviso = ""
    if distintos < n:
        aviso = "  <- {} repetidas".format(n - distintos)
    elif cada and cada < 5:
        aviso = "  <- reporta muy seguido"
    print("{:>6}  {:<26} {:>9,} {:>12,} {:>14.1f}{}".format(
        pk, nombre(pk), n, distintos, cada, aviso))

# ══════════════════════════════════════════════════════════════════════════
print("")
print(RAYA)
print("3. CUANTO CAMBIA EL ACUMULADO DE HOY SI SE QUITAN LAS REPETIDAS")
print(RAYA)
hoy = AHORA.astimezone(PERU).date()
ini = datetime.datetime.combine(hoy, datetime.time.min)
fin = datetime.datetime.combine(hoy, datetime.time.max)
ini, fin = timezone.make_aware(ini), timezone.make_aware(fin)

campos_valor = [f.name for f in RawDavis._meta.get_fields()
                if isinstance(f, (djm.FloatField, djm.DecimalField, djm.IntegerField))
                and any(p in f.name.lower() for p in ("rain", "lluvia", "precip"))]
print("  Campos de lluvia en el modelo: {}".format(campos_valor or "ninguno encontrado"))
if campos_valor:
    cv = campos_valor[0]
    print("  Se usa '{}'".format(cv))
    print("")
    print("{:>6}  {:<26} {:>12} {:>12} {:>10}".format(
        "ID", "ESTACION", "SUMA TAL CUAL", "SIN REPETIR", "DIFERENCIA"))
    print("-" * 72)
    hubo = False
    for pk in sorted(nombres):
        qs = RawDavis.objects.filter(**{CE: pk, CF + "__range": (ini, fin)})
        if not qs.exists():
            continue
        bruto = qs.aggregate(s=djm.Sum(cv))["s"] or 0
        # Una sola lectura por instante: la primera de cada uno.
        vistos, limpio = set(), 0.0
        for t, v in qs.values_list(CF, cv).order_by(CF, "id"):
            if t in vistos:
                continue
            vistos.add(t)
            limpio += float(v or 0)
        dif = float(bruto) - limpio
        if abs(dif) > 0.001:
            hubo = True
            print("{:>6}  {:<26} {:>12.2f} {:>12.2f} {:>10.2f}".format(
                pk, nombre(pk), float(bruto), limpio, dif))
    if not hubo:
        print("  Ninguna estacion cambia: hoy no hay repetidas que inflen el acumulado.")

# ══════════════════════════════════════════════════════════════════════════
print("")
print(RAYA)
print("4. RELOJES POR DELANTE DEL SERVIDOR")
print(RAYA)
futuro = (RawDavis.objects.filter(**{CF + "__gt": AHORA})
          .values(CE).annotate(n=djm.Count("id"), ultima=djm.Max(CF)))
hay = False
for r in futuro:
    hay = True
    adelanto = (r["ultima"] - AHORA).total_seconds() / 60.0
    print("  {:>4}  {:<26} {:>7,} filas con fecha futura, hasta {:.0f} min por delante".format(
        r[CE], nombre(r[CE]), r["n"], adelanto))
if not hay:
    print("  Ninguna estacion tiene lecturas con fecha posterior a la del servidor.")
    print("  (el '-1 d' de YUGOSLAVIA era redondeo: su ultima lectura es de hace minutos)")

# ══════════════════════════════════════════════════════════════════════════
print("")
print(RAYA)
print("5. DESDE CUANDO: LECTURAS POR DIA, ULTIMOS 14 DIAS")
print(RAYA)
sospechosas = sorted(nombres,
                     key=lambda pk: -RawDavis.objects.filter(**{CE: pk}).count())[:1]
# A las tres con mas filas se les suma una normal, para comparar.
cuentas = [(pk, RawDavis.objects.filter(**{CE: pk}).count()) for pk in nombres]
cuentas = [c for c in cuentas if c[1] > 0]
cuentas.sort(key=lambda x: -x[1])
mirar = [c[0] for c in cuentas[:3]] + [c[0] for c in cuentas[len(cuentas) // 2:len(cuentas) // 2 + 1]]

desde14 = AHORA - datetime.timedelta(days=14)
for pk in mirar:
    por_dia = (RawDavis.objects.filter(**{CE: pk, CF + "__gte": desde14})
               .annotate(d=TruncDate(CF)).values("d")
               .annotate(n=djm.Count("id")).order_by("d"))
    linea = ["{} ({:,} filas en total)".format(nombre(pk), dict(cuentas)[pk])]
    print("")
    print("  " + linea[0])
    for r in por_dia:
        barra = "#" * min(60, int(r["n"] / 50) + 1)
        print("    {}  {:>7,}  {}".format(r["d"], r["n"], barra))

print("")
print("Listo. Nada se modifico.")
