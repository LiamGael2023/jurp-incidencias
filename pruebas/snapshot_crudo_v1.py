# -*- coding: utf-8 -*-
"""
Que dice WeatherLink AHORA MISMO sobre Armonia 3 y Remanso 02.

    docker compose exec -T jurp_web python - < snapshot_crudo_v1.py

POR QUE. Las dos tienen la foto congelada: cada 15 minutos el worker pide el
snapshot y recibe la MISMA hora de observacion, asi que salta IntegrityError y
no guarda nada. Eso ya dice que las estaciones no estan subiendo a
WeatherLink, y que el arreglo es en campo.

Lo que no sabemos todavia es QUE llevarse. El snapshot de v1 trae mas campos
de los que el sistema guarda —de FIELD_MAP solo se rescatan temperatura,
humedad, rocio y viento, mas lluvia y radiacion— y Davis suele incluir ahi el
voltaje de la bateria de la consola y del transmisor. Si viene bajo, el viaje
es con bateria o panel solar. Si viene bien, el problema es el enlace o la
consola, y se lleva otra cosa. Una llamada por estacion lo aclara.

Se incluye una estacion SANA como control, para poder comparar: un campo que
falte en las dos calladas pero este en la sana es informacion; un campo que no
venga en ninguna es simplemente algo que esta API no publica.

OJO: esto SI sale a internet. Hace 3 peticiones GET a la API de Davis con las
credenciales que ya tiene cada equipo en la base. No escribe nada, ni en la
base ni en Davis. Tres peticiones no son nada al lado de las 20 que hace el
worker cada 15 minutos.

Las credenciales nunca se imprimen: cualquier clave que suene a secreto sale
enmascarada, porque esta salida se pega en un chat.
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

from django.apps import apps                      # noqa: E402
from django.db import models as djm               # noqa: E402
from django.utils import timezone                 # noqa: E402

PERU = datetime.timezone(datetime.timedelta(hours=-5))
AHORA = timezone.now()
RAYA = "=" * 78

RawDavis = apps.get_model("davis", "RawDavis")
Equipo = RawDavis._meta.get_field("station").related_model

# Las dos calladas, y una sana de control.
CALLADAS = [914, 916]
CONTROL = 896          # VALLUNARAJU, v1, 96 lecturas al dia

SECRETOS = ("pass", "token", "secret", "key", "pwd", "auth", "apitoken")

# Campos del snapshot que interesan para decidir que llevarse al campo.
PINTA_ESTADO = ("batt", "bateria", "volt", "rssi", "signal", "senal", "link",
                "uptime", "reception", "error", "status", "console", "trans")


def enmascarar(obj):
    """Copia del JSON sin nada que suene a credencial."""
    if isinstance(obj, dict):
        salida = {}
        for k, v in obj.items():
            if any(s in str(k).lower() for s in SECRETOS):
                salida[k] = "<oculto>"
            else:
                salida[k] = enmascarar(v)
        return salida
    if isinstance(obj, list):
        return [enmascarar(x) for x in obj]
    return obj


def aplanar(obj, prefijo=""):
    """Todas las hojas del JSON como (ruta, valor), para poder buscar."""
    if isinstance(obj, dict):
        for k, v in obj.items():
            for par in aplanar(v, "{}.{}".format(prefijo, k) if prefijo else str(k)):
                yield par
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            for par in aplanar(v, "{}[{}]".format(prefijo, i)):
                yield par
    else:
        yield (prefijo, obj)


try:
    from src.apps.davis.management.commands.davis_historic import (
        fetch_v1_snapshot, clean_str,
    )
except Exception as exc:
    print("No se pudo importar el cliente de Davis: {}".format(exc))
    sys.exit(1)


def nombre_de(obj):
    return str(getattr(obj, "nombre", None) or getattr(obj, "name", None) or obj)


for pk in CALLADAS + [CONTROL]:
    etiqueta = "CONTROL (sana)" if pk == CONTROL else "CALLADA"
    try:
        med = Equipo.objects.get(pk=pk)
    except Exception as exc:
        print("")
        print("{}: no se pudo leer el equipo ({})".format(pk, exc))
        continue

    print("")
    print(RAYA)
    print("[{}] {}   -   {}".format(pk, nombre_de(med), etiqueta))
    print(RAYA)

    # Lo que tenemos guardado, para comparar con lo que llega ahora.
    ultima = (RawDavis.objects.filter(station=pk).order_by("-collect_time")
              .values_list("collect_time", flat=True).first())
    if ultima:
        horas = (AHORA - ultima).total_seconds() / 3600.0
        print("  Ultima lectura GUARDADA: {} ({:.1f} h)".format(
            ultima.astimezone(PERU).strftime("%Y-%m-%d %H:%M"), horas))
    else:
        print("  Ultima lectura GUARDADA: ninguna")

    try:
        payload = fetch_v1_snapshot(
            clean_str(getattr(med, "davis_user", None)),
            clean_str(getattr(med, "davis_pass", None)),
            clean_str(getattr(med, "davis_api_token", None)),
        )
    except Exception as exc:
        print("  La API responde con ERROR: {}".format(exc))
        print("  (si la sana tambien falla, el problema es la cuenta, no el equipo)")
        continue

    if payload is None:
        print("  La API responde vacio.")
        continue

    hojas = dict(aplanar(payload))

    # Hora de observacion: si coincide con la guardada, la foto esta congelada.
    print("  Lo que dice WeatherLink ahora:")
    for clave in sorted(hojas):
        if "observation_time" in clave or clave.endswith(".ts") or clave == "ts":
            print("    {:<46} {}".format(clave, hojas[clave]))

    print("")
    print("  Campos de estado del equipo (bateria, enlace, errores):")
    encontrados = [(k, v) for k, v in sorted(hojas.items())
                   if any(p in k.lower() for p in PINTA_ESTADO)]
    if encontrados:
        for k, v in encontrados:
            oculto = any(s in k.lower() for s in SECRETOS)
            print("    {:<46} {}".format(k, "<oculto>" if oculto else v))
    else:
        print("    Ninguno: esta API no publica estado del equipo para esta estacion.")

    print("")
    print("  JSON completo (credenciales enmascaradas):")
    texto = json.dumps(enmascarar(payload), indent=2, sort_keys=True,
                       ensure_ascii=False)
    for linea in texto.split("\n"):
        print("    {}".format(linea))

print("")
print(RAYA)
print("COMO SE LEE")
print(RAYA)
print("  - Si la hora de observacion que llega es la MISMA que la guardada, la")
print("    foto esta congelada: la estacion no sube a WeatherLink. Campo.")
print("  - Si hay voltaje y viene bajo comparado con el de la sana: bateria o")
print("    panel. Si viene normal: enlace, consola o antena.")
print("  - Si la estacion SANA tambien falla o responde raro, entonces no es")
print("    el equipo: es la cuenta o la API, y no hay que viajar.")
print("")
print("Listo. No se escribio nada.")
