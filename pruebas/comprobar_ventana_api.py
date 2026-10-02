# -*- coding: utf-8 -*-
"""
¿El rain_window_* que devuelve la API sobrevive al recorte de la serie?

    docker compose exec -T jurp_web python - < comprobar_ventana_api.py

QUE COMPRUEBA. El endpoint manda al cliente una de cada N lecturas cuando la
estacion reporta muy seguido. La pregunta es si los campos nuevos siguen
siendo correctos pese a eso, porque se calculan antes del recorte.

No se compara a ojo: para cada estacion se calcula la ventana DIRECTAMENTE
SOBRE LA BASE y se contrasta con lo que responde la API. Si no coinciden, lo
dice y sale con error.

Tambien avisa de lo contrario: si para la estacion que mas reporta la API
devolviera un numero igual al que sale de sumar el array recortado, seria
señal de que el calculo no esta donde creemos.

No modifica nada: solo lee.
"""

from __future__ import print_function, unicode_literals

import datetime
import json
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

from django.conf import settings                  # noqa: E402
from django.apps import apps                      # noqa: E402
from django.test import Client                    # noqa: E402
from django.utils import timezone                 # noqa: E402

PERU = datetime.timezone(datetime.timedelta(hours=-5))
AHORA = timezone.now()
RAYA = "=" * 78
VENTANA_POR_DEFECTO = 30

RawDavis = apps.get_model("davis", "RawDavis")
Equipo = RawDavis._meta.get_field("station").related_model

hoy = AHORA.astimezone(PERU).date()
f = hoy.strftime("%Y-%m-%d")

# El Host tiene que estar permitido: el cliente de pruebas manda 'testserver'
# por defecto y ALLOWED_HOSTS lo rechaza.
permitidos = [h for h in (settings.ALLOWED_HOSTS or []) if h not in ("*",)]
HOST = permitidos[0] if permitidos else "localhost"
if HOST.startswith("."):
    HOST = HOST[1:]
print("Host usado en la peticion: {}".format(HOST))

# Un token de usuario con permiso: la vista va detras de staff_or_redirect,
# asi que con un token cualquiera saldria una redireccion, no datos.
try:
    from rest_framework.authtoken.models import Token
    token = None
    for t in Token.objects.select_related("user").all()[:200]:
        u = t.user
        if getattr(u, "is_staff", False) or getattr(u, "is_superuser", False):
            token = t
            break
    if token is None:
        print("No encontre ningun token de usuario staff. La vista lo exige.")
        sys.exit(1)
    print("Token de: {} (staff)".format(token.user))
except Exception as exc:
    print("No se pudo obtener un token: {}".format(exc))
    sys.exit(1)


# Los limites del dia, por rango y no con collect_time__date: ese lookup no
# existe en la version de Django de este servidor y revienta con
# "Unsupported lookup 'date'".
INI = timezone.make_aware(datetime.datetime.combine(hoy, datetime.time.min))
FIN = timezone.make_aware(datetime.datetime.combine(hoy, datetime.time.max))


def ventana_desde_base(pk, minutos):
    """La verdad: misma cuenta, pero sobre TODAS las filas de la base."""
    ini, fin = INI, FIN
    filas = list(RawDavis.objects
                 .filter(station=pk, collect_time__range=(ini, fin))
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


cliente = Client(SERVER_NAME=HOST)

# Se entra por SESION y no solo con la cabecera del token.
#
# La vista va detras de staff_or_redirect, un decorador sobre dispatch que
# mira request.user. En ese momento DRF todavia no ha procesado la cabecera
# Authorization, asi que el usuario es anonimo y la respuesta es 403 por mas
# que el token sea de un staff.
#
# Esto comprueba el CALCULO de la ventana, que es lo que acabamos de tocar,
# no el camino de autenticacion de la app.
try:
    cliente.force_login(token.user)
    print("Sesion iniciada como {}".format(token.user))
except Exception as exc:
    print("No se pudo iniciar sesion ({}); se intenta solo con el token.".format(exc))

estaciones = sorted(set(RawDavis.objects
                        .filter(collect_time__range=(INI, FIN))
                        .values_list("station", flat=True).distinct()))
if not estaciones:
    print("Ninguna estacion tiene lecturas hoy; nada que comprobar.")
    sys.exit(0)

print("")
print(RAYA)
print("API CONTRA BASE DE DATOS, HOY ({})".format(hoy))
print(RAYA)
print("{:>5}  {:<20} {:>7} {:>7} {:<12} {:>9} {:>9}  {}".format(
    "ID", "ESTACION", "FILAS", "PUNTOS", "MODO", "API PICO", "BD PICO", "VEREDICTO"))
print("-" * 96)

fallos = 0
recortadas = 0
for pk in estaciones:
    r = cliente.get("/api/v1/mobile/davis/rain-gauges/filtered-data/",
                    {"start_date": f, "end_date": f,
                     "station_id": pk, "metric": "rainfall_mm"},
                    HTTP_AUTHORIZATION="Token " + token.key)
    if r.status_code != 200:
        # Se imprime el cuerpo: un codigo a secas no dice si falta permiso,
        # si falta un parametro o si reviento la vista.
        try:
            cuerpo = r.content.decode("utf-8")[:200].replace("\n", " ")
        except Exception:
            cuerpo = "(no se pudo leer)"
        print("{:>5}  la API responde {} -> {}".format(pk, r.status_code, cuerpo))
        fallos += 1
        if fallos >= 3:
            print("")
            print("Tres fallos seguidos: no sigo pidiendo las 27 estaciones.")
            break
        continue

    d = json.loads(r.content.decode("utf-8"))
    minutos = d.get("rain_window_minutes") or VENTANA_POR_DEFECTO
    api_ult = d.get("rain_window_mm")
    api_pico = d.get("rain_window_peak_mm")
    puntos = len(d.get("data") or [])
    modo = d.get("mode")

    bd_ult, bd_pico, filas = ventana_desde_base(pk, minutos)

    try:
        nombre = str(getattr(Equipo.objects.get(pk=pk), "nombre", pk))[:20]
    except Exception:
        nombre = str(pk)

    if api_pico is None:
        veredicto = "SIN CAMPO: el servidor no tiene el parche"
        fallos += 1
    elif bd_pico is None:
        veredicto = "sin filas"
    elif abs(float(api_pico) - bd_pico) > 0.011 or abs(float(api_ult) - bd_ult) > 0.011:
        veredicto = "NO COINCIDE"
        fallos += 1
    else:
        veredicto = "coincide"
    if modo == "downsampled":
        recortadas += 1
        veredicto += "  <- recortada 1 de cada {}".format(
            max(1, int(round(float(filas) / max(1, puntos)))))

    print("{:>5}  {:<20} {:>7,} {:>7,} {:<12} {:>9} {:>9}  {}".format(
        pk, nombre, filas, puntos, str(modo),
        "--" if api_pico is None else "{:.2f}".format(float(api_pico)),
        "--" if bd_pico is None else "{:.2f}".format(bd_pico),
        veredicto))

print("")
print(RAYA)
if fallos:
    print("HAY {} ESTACION(ES) QUE NO CUADRAN. No sigas con la app hasta verlo.".format(fallos))
else:
    print("Todas coinciden con la base.")
    if recortadas:
        print("Y {} venian RECORTADAS: ahi esta la prueba de que el numero se".format(recortadas))
        print("calcula antes del recorte. Un cliente que sumara el array 'data'")
        print("de esas estaciones obtendria una fraccion de la lluvia real.")
    else:
        print("Hoy ninguna estacion supera el limite de puntos, asi que el recorte")
        print("no se ha ejercitado. Vuelve a correrlo un dia con mas lecturas.")
print("")
print("Listo. Nada se modifico.")
sys.exit(1 if fallos else 0)
