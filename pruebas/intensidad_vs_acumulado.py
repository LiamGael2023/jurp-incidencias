# -*- coding: utf-8 -*-
"""
¿Por que una estacion sale roja en la web y apagada en la app?

    docker compose exec -T jurp_web python - < intensidad_vs_acumulado.py

DOS EXPLICACIONES POSIBLES, Y HAY QUE SABER CUAL ES.

  (a) El arreglo funciona. La web colorea por el ACUMULADO DEL DIA contra
      unos cortes pensados para 30 MINUTOS, asi que 1.2 mm caidos de
      madrugada la dejan roja hasta medianoche. La app colorea por lo que
      cae AHORA. Si ya escampo, lo correcto es que este apagada.

  (b) Un fallo mio. La app suma la serie que devuelve el endpoint
      filtered-data. Si esa serie viene RECORTADA, la intensidad sale corta
      y la estacion no se enciende aunque este lloviendo. El propio
      RainDataService avisa: "max_points NO evita el downsampling". Y hay
      estaciones que reportan cada 6 segundos, 12.800 lecturas al dia.

Lo que se mide aqui, para cada estacion con lluvia hoy:

  - cuanto lleva el dia                 (lo que pinta la web)
  - el maximo en 30 min del dia         (el pico real)
  - los ultimos 30 min                  (lo que deberia pintar la app AHORA)
  - cuantas lecturas tiene hoy          (riesgo de recorte)

Todo sale de la base, sin pasar por el endpoint: asi tenemos la verdad
contra la que comparar lo que la app recibe. Y al final se imprime el
codigo que decide el recorte en el view, para ver desde cuantos puntos
empieza a descartar.

No modifica nada: solo lee.
"""

from __future__ import print_function, unicode_literals

import datetime
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
VENTANA = 30          # minutos, los mismos del backend y de la app
CORTES = [("1er", 0.21), ("2do", 0.63), ("3er", 1.06)]

RawDavis = apps.get_model("davis", "RawDavis")
Equipo = RawDavis._meta.get_field("station").related_model

hoy = AHORA.astimezone(PERU).date()
ini = timezone.make_aware(datetime.datetime.combine(hoy, datetime.time.min))
fin = timezone.make_aware(datetime.datetime.combine(hoy, datetime.time.max))


def nombre_de(pk):
    try:
        o = Equipo.objects.get(pk=pk)
        return str(getattr(o, "nombre", None) or getattr(o, "name", None) or pk)
    except Exception:
        return str(pk)


def nivel(mm):
    n = "sin lluvia"
    for etiqueta, corte in CORTES:
        if mm >= corte:
            n = etiqueta
    return n


print(RAYA)
print("ESTACIONES CON LLUVIA HOY ({})".format(hoy))
print(RAYA)
print("  'dia'      = acumulado, que es lo que colorea la WEB")
print("  'pico 30'  = el mayor en 30 min del dia")
print("  'ahora'    = los ultimos 30 min, que es lo que colorea la APP")
print("")

# Que estaciones tienen algo hoy. Se mira rainfall_mm y, si viene vacio,
# rainfall_mm_per_day: la misma regla que usa el motor de alertas.
campos = [f.name for f in RawDavis._meta.concrete_fields if "rain" in f.name.lower()]
tiene_intervalo = "rainfall_mm" in campos
tiene_acumulado = "rainfall_mm_per_day" in campos

estaciones = sorted(set(RawDavis.objects
                        .filter(collect_time__range=(ini, fin))
                        .values_list("station", flat=True).distinct()))

print("{:>5}  {:<22} {:>8} {:>9} {:>9} {:>9}  {}".format(
    "ID", "ESTACION", "LECT.", "DIA", "PICO 30", "AHORA", "NIVEL AHORA"))
print("-" * 86)

sospechosas = []
for pk in estaciones:
    qs = (RawDavis.objects
          .filter(station=pk, collect_time__range=(ini, fin))
          .order_by("collect_time")
          .values_list("collect_time", "rainfall_mm", "rainfall_mm_per_day"))
    filas = list(qs)
    if not filas:
        continue

    # Lo caido en cada lectura, con la misma regla del motor: si no hay
    # acumulado del dia, el valor del intervalo ya es el incremento.
    serie = []
    for t, interv, acum in filas:
        if acum is not None:
            serie.append((t, None, float(acum)))
        else:
            serie.append((t, float(interv or 0), None))

    caidos = []
    previo_acum = None
    for t, interv, acum in serie:
        if acum is not None:
            if previo_acum is None:
                mm = 0.0
            elif acum >= previo_acum:
                mm = acum - previo_acum
            else:
                mm = acum
            previo_acum = acum
        else:
            mm = interv or 0.0
        caidos.append((t, mm))

    total = sum(m for _, m in caidos)
    if total <= 0:
        continue

    # Ventana movil de 30 min, extremos inclusive como el backend.
    ancho = datetime.timedelta(minutes=VENTANA)
    pico, ini_i = 0.0, 0
    suma = 0.0
    for j in range(len(caidos)):
        suma += caidos[j][1]
        while caidos[j][0] - caidos[ini_i][0] > ancho:
            suma -= caidos[ini_i][1]
            ini_i += 1
        if suma > pico:
            pico = suma

    ultima = caidos[-1][0]
    ahora = sum(m for t, m in caidos if ultima - ancho <= t <= ultima)
    edad = (AHORA - ultima).total_seconds() / 60.0

    marca = ""
    if len(filas) > 2000:
        marca = "  <- {:,} lecturas: la API puede recortarlas".format(len(filas))
        sospechosas.append((pk, len(filas)))
    if edad > 60:
        marca += "  <- ultima hace {:.0f} min".format(edad)

    print("{:>5}  {:<22} {:>8,} {:>9.2f} {:>9.2f} {:>9.2f}  {:<11}{}".format(
        pk, nombre_de(pk)[:22], len(filas), total, pico, ahora,
        nivel(ahora), marca))

print("")
print(RAYA)
print("COMO SE LEE")
print(RAYA)
print("  Si 'dia' pasa un corte pero 'ahora' no, la web la pinta de color y la")
print("  app no: la app tiene razon, ya escampo.")
print("  Si 'ahora' pasa un corte y en la app no se ve, entonces el problema")
print("  es lo que recibe la app, no el calculo. Mirar el recorte de abajo.")

print("")
print(RAYA)
print("EL RECORTE DEL ENDPOINT")
print(RAYA)
if sospechosas:
    print("  Estaciones con muchisimas lecturas hoy:")
    for pk, n in sospechosas:
        print("    {:>5}  {:<22} {:>8,}".format(pk, nombre_de(pk)[:22], n))
else:
    print("  Ninguna estacion pasa de 2.000 lecturas hoy.")
print("")
try:
    import inspect
    from src.apps.davis import views as V
    fuente = inspect.getsource(V)
    claves = ("downsample", "max_points", "mode", "step", "nth")
    lineas = fuente.split("\n")
    marcadas = [i for i, l in enumerate(lineas)
                if any(c in l.lower() for c in claves)]
    if marcadas:
        print("  Lineas de views.py que deciden el recorte:")
        vistas = set()
        for i in marcadas:
            for j in range(max(0, i - 2), min(len(lineas), i + 3)):
                if j not in vistas:
                    vistas.add(j)
                    print("    {:>5}: {}".format(j + 1, lineas[j][:100]))
            print("    ...")
    else:
        print("  No encontre logica de recorte en views.py.")
except Exception as exc:
    print("  No se pudo leer views.py: {}".format(exc))

print("")
print("Listo. Nada se modifico.")
