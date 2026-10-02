# -*- coding: utf-8 -*-
"""
Filtrado 29 (907): la vista calcula 6.00 mm y la base 0.00. ¿Quien acierta?

    docker compose exec -T jurp_web python - < mirar_filtrado29.py

DE DONDE SALE LA DISCREPANCIA. Es una estacion Davis v1: su rainfall_mm viene
vacio y la lluvia hay que reconstruirla restando acumulados del dia
consecutivos (rain_day_in -> rainfall_mm_per_day). Eso lo hace
_derivar_intervalos en el servidor, y lo hace tambien, por su cuenta, el
script con el que compare contra la base.

Las dos reconstrucciones no coinciden, asi que una de las dos esta mal. Y no
es una diferencia menor: 6 mm en una ventana de 30 minutos cruza el umbral
mas alto. Si el numero es falso, es una alerta roja inventada; si es
verdadero, es lluvia real que no estamos viendo.

LA SOSPECHA, que hay que confirmar o descartar mirando los datos: que
difieran en como tratan la PRIMERA lectura del rango. El acumulado del dia ya
trae lo caido antes de esa lectura, y hay dos posturas razonables:

  - contarlo como lluvia: correcto si de verdad llovio en la madrugada
  - no contarlo: correcto si el contador no se reinicio a medianoche, o si
    la primera lectura simplemente arrastra el valor del dia anterior

Mirando la serie se ve cual de las dos aplica aqui.

No modifica nada: solo lee.
"""

from __future__ import print_function, unicode_literals

import datetime
import inspect
import os
import sys

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
from django.utils import timezone                 # noqa: E402

PERU = datetime.timezone(datetime.timedelta(hours=-5))
AHORA = timezone.now()
RAYA = "=" * 78
ESTACION = 907

RawDavis = apps.get_model("davis", "RawDavis")

hoy = AHORA.astimezone(PERU).date()
ayer = hoy - datetime.timedelta(days=1)
INI = timezone.make_aware(datetime.datetime.combine(hoy, datetime.time.min))
FIN = timezone.make_aware(datetime.datetime.combine(hoy, datetime.time.max))
INI_AYER = timezone.make_aware(datetime.datetime.combine(ayer, datetime.time.min))

# ══════════════════════════════════════════════════════════════════════════
print(RAYA)
print("1. LA SERIE CRUDA DE FILTRADO 29 (907) HOY")
print(RAYA)
filas = list(RawDavis.objects
             .filter(station=ESTACION, collect_time__range=(INI, FIN))
             .order_by("collect_time")
             .values_list("collect_time", "rainfall_mm",
                          "rainfall_mm_per_day", "rainfall_mm_per_hour"))
print("  {} lecturas hoy".format(len(filas)))
print("")
print("  {:<8} {:>14} {:>22} {:>22}".format(
    "HORA", "rainfall_mm", "rainfall_mm_per_day", "rainfall_mm_per_hour"))
print("  " + "-" * 70)
for t, interv, acum, porhora in filas[:14]:
    print("  {:<8} {:>14} {:>22} {:>22}".format(
        t.astimezone(PERU).strftime("%H:%M"),
        "-" if interv is None else "{:.3f}".format(float(interv)),
        "-" if acum is None else "{:.3f}".format(float(acum)),
        "-" if porhora is None else "{:.3f}".format(float(porhora))))
if len(filas) > 20:
    print("  ...")
    for t, interv, acum, porhora in filas[-4:]:
        print("  {:<8} {:>14} {:>22} {:>22}".format(
            t.astimezone(PERU).strftime("%H:%M"),
            "-" if interv is None else "{:.3f}".format(float(interv)),
            "-" if acum is None else "{:.3f}".format(float(acum)),
            "-" if porhora is None else "{:.3f}".format(float(porhora))))

acums = [float(a) for _, _, a, _ in filas if a is not None]
if acums:
    print("")
    print("  El acumulado del dia va de {:.3f} a {:.3f}".format(min(acums), max(acums)))
    print("  Primera lectura: {:.3f}   Ultima: {:.3f}".format(acums[0], acums[-1]))
    if abs(max(acums) - min(acums)) < 1e-9:
        print("  >> NO CAMBIA EN TODO EL DIA. Si el primer valor se cuenta como")
        print("     lluvia, aparecen {:.2f} mm que nunca cayeron hoy.".format(acums[0]))

# ── Y la ultima de ayer, para ver si el contador se reinicio ─────────────
print("")
print(RAYA)
print("2. ¿SE REINICIO EL CONTADOR A MEDIANOCHE?")
print(RAYA)
ultima_ayer = (RawDavis.objects
               .filter(station=ESTACION, collect_time__range=(INI_AYER, INI))
               .order_by("-collect_time")
               .values_list("collect_time", "rainfall_mm_per_day").first())
if ultima_ayer and ultima_ayer[1] is not None:
    print("  Ultima lectura de ayer: {}  acumulado {:.3f}".format(
        ultima_ayer[0].astimezone(PERU).strftime("%Y-%m-%d %H:%M"),
        float(ultima_ayer[1])))
    if acums:
        if abs(float(ultima_ayer[1]) - acums[0]) < 1e-9:
            print("  Primera de hoy:         {:.3f}".format(acums[0]))
            print("  >> IGUAL que la de ayer: el contador NO se reinicio. Ese valor")
            print("     es lluvia de ayer arrastrada, no lluvia de hoy.")
        else:
            print("  Primera de hoy:         {:.3f}  (distinta)".format(acums[0]))
else:
    print("  Ayer no hay lecturas con acumulado.")

# ── Las dos reconstrucciones, lado a lado ────────────────────────────────
print("")
print(RAYA)
print("3. LAS DOS RECONSTRUCCIONES")
print(RAYA)
try:
    from src.apps.davis.views import *             # noqa: F401,F403
    import src.apps.davis.views as DV
    cls = None
    for nombre in dir(DV):
        obj = getattr(DV, nombre)
        if inspect.isclass(obj) and hasattr(obj, "_derivar_intervalos"):
            cls = obj
            break
    if cls is None:
        print("  No encontre _derivar_intervalos en davis/views.py")
    else:
        print("  Encontrada en {}.{}".format(cls.__module__, cls.__name__))
        print("")
        print("  CODIGO:")
        for linea in inspect.getsource(cls._derivar_intervalos).split("\n"):
            print("    {}".format(linea))

        acumulados = [(t, float(a)) for t, _, a, _ in filas if a is not None]
        derivada = cls._derivar_intervalos(cls, acumulados) \
            if not isinstance(inspect.getattr_static(cls, "_derivar_intervalos"),
                              staticmethod) else cls._derivar_intervalos(acumulados)
        total_vista = sum(v for _, v in derivada)
        print("")
        print("  Total segun _derivar_intervalos: {:.2f} mm".format(total_vista))
        print("  Primeros valores: {}".format(
            ", ".join("{:.2f}".format(v) for _, v in derivada[:6])))
except Exception as exc:
    print("  No se pudo ejecutar _derivar_intervalos: {}".format(exc))

# Mi regla: la primera lectura del rango es referencia, no lluvia.
acumulados = [(t, float(a)) for t, _, a, _ in filas if a is not None]
mios, previo = [], None
for t, a in acumulados:
    if previo is None:
        mm = 0.0
    elif a >= previo:
        mm = a - previo
    else:
        mm = a
    previo = a
    mios.append((t, mm))
print("")
print("  Total contando la primera como referencia: {:.2f} mm".format(
    sum(v for _, v in mios)))

print("")
print(RAYA)
print("COMO SE DECIDE")
print(RAYA)
print("  Si el acumulado no cambia en todo el dia y coincide con el de ayer,")
print("  entonces ese valor es arrastre y contarlo como lluvia de hoy inventa")
print("  milimetros. Con los umbrales actuales, 6 mm en una ventana disparan")
print("  el nivel mas alto: seria una alerta roja por lluvia que no existio.")
print("")
print("Listo. Nada se modifico.")
