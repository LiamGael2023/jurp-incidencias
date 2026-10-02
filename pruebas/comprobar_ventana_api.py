# -*- coding: utf-8 -*-
"""
¿El rain_window_* que calcula la vista sobrevive al recorte de la serie?

    docker compose exec -T jurp_web python - < comprobar_ventana_api.py

QUE COMPRUEBA. El endpoint manda al cliente una de cada N lecturas cuando la
estacion reporta muy seguido. La pregunta es si los campos nuevos siguen
siendo correctos pese a eso, porque se calculan antes del recorte.

No se compara a ojo: para cada estacion se calcula la misma ventana
DIRECTAMENTE SOBRE LA BASE, con todas las filas, y se contrasta con lo que
devuelve la vista. Si no coinciden, lo dice y sale con error.

POR QUE SE LLAMA A LA VISTA Y NO AL ENDPOINT POR HTTP.

Porque lo que se esta verificando es el CALCULO, y la capa HTTP solo mete
ruido: el cliente de pruebas manda un Host que ALLOWED_HOSTS rechaza, la
vista va detras de staff_or_redirect —que mira request.user antes de que DRF
procese el token, asi que una cabecera Authorization no basta— y force_login
no existe en esta version de Django.

Nada de eso tiene que ver con si la ventana esta bien calculada. Se construye
la peticion y se llama al metodo get() de la vista, que es donde vive el
codigo que acabamos de tocar.

Lo que esto NO comprueba, y conviene mirar aparte, es si la app puede leer
este endpoint con su token.

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
RUTA = "/api/v1/mobile/davis/rain-gauges/filtered-data/"
VENTANA_POR_DEFECTO = 30

RawDavis = apps.get_model("davis", "RawDavis")
Equipo = RawDavis._meta.get_field("station").related_model

hoy = AHORA.astimezone(PERU).date()
f = hoy.strftime("%Y-%m-%d")

# Limites del dia por rango: el lookup collect_time__date no existe en la
# version de Django de este servidor.
INI = timezone.make_aware(datetime.datetime.combine(hoy, datetime.time.min))
FIN = timezone.make_aware(datetime.datetime.combine(hoy, datetime.time.max))

# ── La vista, sacada de la propia tabla de rutas ──────────────────────────
try:
    from django.core.urlresolvers import resolve      # Django viejo
except ImportError:
    from django.urls import resolve                   # Django nuevo

try:
    coincidencia = resolve(RUTA)
    funcion = coincidencia.func
    VistaCls = getattr(funcion, "cls", None) or getattr(funcion, "view_class", None)
    if VistaCls is None:
        raise RuntimeError("la ruta no apunta a una vista de clase")
    print("Vista encontrada: {}.{}".format(VistaCls.__module__, VistaCls.__name__))
except Exception as exc:
    print("No se pudo resolver {}: {}".format(RUTA, exc))
    sys.exit(1)

from rest_framework.test import APIRequestFactory    # noqa: E402
from rest_framework.request import Request           # noqa: E402

fabrica = APIRequestFactory()
vista = VistaCls()


def pedir(pk):
    """Llama al get() de la vista y devuelve su diccionario de respuesta."""
    peticion = Request(fabrica.get(RUTA, {
        "start_date": f, "end_date": f,
        "station_id": str(pk), "metric": "rainfall_mm",
    }))
    respuesta = vista.get(peticion)
    return getattr(respuesta, "data", None), getattr(respuesta, "status_code", None)


def ventana_desde_base(pk, minutos):
    """La verdad: la misma cuenta, pero sobre TODAS las filas de la base."""
    filas = list(RawDavis.objects
                 .filter(station=pk, collect_time__range=(INI, FIN))
                 .order_by("collect_time")
                 .values_list("collect_time", "rainfall_mm", "rainfall_mm_per_day"))
    if not filas:
        return None, None, 0

    caidos = []
    previo = None
    for t, interv, acum in filas:
        if acum is not None:
            a = float(acum)
            if previo is None:
                mm = 0.0
            elif a >= previo:
                mm = a - previo
            else:
                mm = a
            previo = a
        else:
            mm = float(interv or 0)
        caidos.append((t, mm))

    ancho = datetime.timedelta(minutes=minutos)
    pico, suma, i = 0.0, 0.0, 0
    for j in range(len(caidos)):
        suma += caidos[j][1]
        while caidos[j][0] - caidos[i][0] > ancho:
            suma -= caidos[i][1]
            i += 1
        if suma > pico:
            pico = suma
    ultimo = caidos[-1][0]
    ult = sum(m for t, m in caidos if ultimo - ancho <= t <= ultimo)
    return round(ult, 2), round(pico, 2), len(filas)


def nombre_de(pk):
    try:
        return str(getattr(Equipo.objects.get(pk=pk), "nombre", pk))[:20]
    except Exception:
        return str(pk)


estaciones = sorted(set(RawDavis.objects
                        .filter(collect_time__range=(INI, FIN))
                        .values_list("station", flat=True).distinct()))
if not estaciones:
    print("Ninguna estacion tiene lecturas hoy; nada que comprobar.")
    sys.exit(0)

print("")
print(RAYA)
print("LA VISTA CONTRA LA BASE DE DATOS, HOY ({})".format(hoy))
print(RAYA)
print("{:>5}  {:<20} {:>7} {:>7} {:<12} {:>8} {:>8}  {}".format(
    "ID", "ESTACION", "FILAS", "PUNTOS", "MODO", "VISTA", "BASE", "VEREDICTO"))
print("-" * 96)

fallos, recortadas, comprobadas = 0, 0, 0
for pk in estaciones:
    try:
        d, codigo = pedir(pk)
    except Exception as exc:
        print("{:>5}  {:<20} la vista revienta: {}".format(pk, nombre_de(pk), exc))
        fallos += 1
        if fallos >= 3:
            print("")
            print("Tres fallos seguidos: no sigo.")
            break
        continue

    if not d or codigo != 200:
        print("{:>5}  {:<20} la vista responde {}: {}".format(
            pk, nombre_de(pk), codigo, str(d)[:120]))
        fallos += 1
        if fallos >= 3:
            print("")
            print("Tres fallos seguidos: no sigo.")
            break
        continue

    minutos = d.get("rain_window_minutes") or VENTANA_POR_DEFECTO
    api_ult = d.get("rain_window_mm")
    api_pico = d.get("rain_window_peak_mm")
    puntos = len(d.get("data") or [])
    modo = d.get("mode")

    bd_ult, bd_pico, filas = ventana_desde_base(pk, minutos)

    if api_pico is None:
        veredicto = "SIN CAMPO: el servidor no tiene el parche"
        fallos += 1
    elif bd_pico is None:
        veredicto = "sin filas en la base"
    elif (abs(float(api_pico) - bd_pico) > 0.011
          or abs(float(api_ult) - bd_ult) > 0.011):
        veredicto = "NO COINCIDE (base: ult {:.2f})".format(bd_ult)
        fallos += 1
    else:
        veredicto = "coincide"
        comprobadas += 1

    if modo == "downsampled":
        recortadas += 1
        veredicto += "  <- recortada 1 de cada {}".format(
            max(1, int(round(float(filas) / max(1, puntos)))))

    print("{:>5}  {:<20} {:>7,} {:>7,} {:<12} {:>8} {:>8}  {}".format(
        pk, nombre_de(pk), filas, puntos, str(modo),
        "--" if api_pico is None else "{:.2f}".format(float(api_pico)),
        "--" if bd_pico is None else "{:.2f}".format(bd_pico),
        veredicto))

print("")
print(RAYA)
if fallos:
    print("HAY {} ESTACION(ES) QUE NO CUADRAN. No sigas con la app hasta verlo.".format(fallos))
else:
    print("Las {} estaciones coinciden con la base.".format(comprobadas))
    if recortadas:
        print("")
        print("Y {} venian RECORTADAS. Ahi esta la prueba: el cliente recibe una".format(recortadas))
        print("fraccion de los puntos y el numero sigue siendo el correcto, porque")
        print("se calcula antes del recorte. Un cliente que sumara el array 'data'")
        print("de esas estaciones veria mucha menos lluvia de la que cayo.")
    else:
        print("")
        print("Hoy ninguna supera el limite de puntos, asi que el recorte no se ha")
        print("ejercitado: esto confirma la cuenta, pero no la parte que motivo el")
        print("cambio. Vuelve a correrlo un dia con mas lecturas.")
print("")
print("Listo. Nada se modifico.")
sys.exit(1 if fallos else 0)
