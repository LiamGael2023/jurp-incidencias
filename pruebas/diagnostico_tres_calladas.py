# -*- coding: utf-8 -*-
"""
Por que LATERAL, Armonia 3 y Remanso 02 no mandan, y las otras 25 si.

    docker compose exec -T jurp_web python - < diagnostico_tres_calladas.py

POR QUE EXISTE. Que una estacion aparezca "sin datos" en PLUVIRA puede venir
de dos sitios que en la base de datos se ven IGUAL —no hay filas nuevas— pero
que se arreglan en lugares distintos:

  a) El equipo dejo de mandar. Se arregla en campo.
  b) El equipo manda y el servidor lo descarta (payload que no pasa la
     validacion, fecha fuera de rango, credencial de WeatherLink caida). Se
     arregla aqui y nadie necesita viajar.

Lo que distingue (a) de (b) es POR DONDE entran los datos de cada estacion:

  - Los pluviometros ESP32 EMPUJAN cada tip al endpoint de telemetria. Si no
    hay filas, es que no llego ninguna peticion: eso es campo. Salvo que si
    lleguen y se rechacen, y eso se ve en el log de jurp_web.
  - Las estaciones Davis NO empujan: el worker las CONSULTA cada 15 min via
    WeatherLink. Si no hay filas, puede que el equipo este perfecto y lo que
    falle sea la consulta: credencial, suscripcion, estacion no compartida.
    Eso se ve en el log de davis_worker.

Asi que lo primero es saber de que tipo es cada una de las tres. Este script
lo responde, y ademas mira la forma del corte: una bateria que se muere deja
una pendiente de dias; un corte de comunicaciones deja un tajo limpio.

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
from django.db import connection                  # noqa: E402
from django.db import models as djm               # noqa: E402
from django.utils import timezone                 # noqa: E402

PERU = datetime.timezone(datetime.timedelta(hours=-5))
AHORA = timezone.now()
RAYA = "=" * 78

# Las tres que PLUVIRA muestra sin datos. Se buscan por trozo de nombre, en
# minusculas, para no depender de como esten escritas en la tabla.
PATRONES = ("lateral", "armon", "remanso 02")

# Nunca se imprime el valor de un campo cuyo nombre suene a credencial: esta
# salida se pega en un chat.
SECRETOS = ("key", "token", "pass", "secret", "cred", "api", "pwd", "auth")

RawDavis = apps.get_model("davis", "RawDavis")
RainAlerts = apps.get_model("davis", "RainAlerts")
Equipo = RawDavis._meta.get_field("station").related_model


def nombre_de(obj):
    for a in ("nombre", "name", "station_name", "descripcion"):
        v = getattr(obj, a, None)
        if v:
            return str(v)
    return str(obj)


def es_secreto(campo):
    c = campo.lower()
    return any(s in c for s in SECRETOS)


def campos_de(obj):
    """Campos concretos del equipo, con las credenciales enmascaradas."""
    salida = []
    for f in obj._meta.concrete_fields:
        try:
            v = getattr(obj, f.attname, None)
        except Exception:
            continue
        if v is None or v == "":
            continue
        if es_secreto(f.name):
            salida.append((f.name, "<puesto, {} caracteres>".format(len(str(v)))))
        else:
            salida.append((f.name, str(v)[:60]))
    return salida


def ultima(modelo, campo_fecha, pk):
    return (modelo.objects.filter(station=pk)
            .order_by("-" + campo_fecha)
            .values_list(campo_fecha, flat=True).first())


def hace(dt):
    if dt is None:
        return "nunca"
    d = AHORA - dt
    horas = d.days * 24 + d.seconds // 3600
    return "{} ({} h)".format(dt.astimezone(PERU).strftime("%Y-%m-%d %H:%M"), horas)


def por_dia(modelo, campo_fecha, pk, dias=12):
    tabla = modelo._meta.db_table
    col_f = modelo._meta.get_field(campo_fecha).column
    col_e = modelo._meta.get_field("station").column
    desde = AHORA - datetime.timedelta(days=dias)
    with connection.cursor() as cur:
        cur.execute(
            "SELECT date_trunc('day', {f} AT TIME ZONE 'UTC'"
            " AT TIME ZONE 'America/Lima')::date AS d, COUNT(*)"
            " FROM {t} WHERE {e} = %s AND {f} >= %s GROUP BY 1 ORDER BY 1".format(
                t=tabla, f=col_f, e=col_e),
            [pk, desde])
        return cur.fetchall()


# ══════════════════════════════════════════════════════════════════════════
print(RAYA)
print("1. QUE SON ESTAS TRES")
print(RAYA)

elegidas = []
for obj in Equipo.objects.all():
    n = nombre_de(obj).lower()
    if any(p in n for p in PATRONES):
        elegidas.append(obj)

if not elegidas:
    print("  Ningun equipo con esos nombres. Mira como estan escritos en la tabla.")
    sys.exit(1)

for obj in elegidas:
    print("")
    print("  [{}] {}".format(obj.pk, nombre_de(obj)))
    for k, v in campos_de(obj):
        print("        {:<28} {}".format(k, v))

print("")
print("  (si salen mas de tres, dime cual es cual y afino el filtro)")

# ══════════════════════════════════════════════════════════════════════════
print("")
print(RAYA)
print("2. POR DONDE ENTRAN SUS DATOS, Y CUANDO FUE LA ULTIMA VEZ")
print(RAYA)
print("  RawDavis  = el worker la consulta via WeatherLink  (camino de PULL)")
print("  RainAlerts= llego un tip al endpoint de telemetria (camino de PUSH)")
print("")
print("{:>5}  {:<24} {:<26} {:<26}".format("ID", "ESTACION", "ULTIMO RawDavis", "ULTIMO RainAlerts"))
print("-" * 86)

caminos = {}
for obj in elegidas:
    u_raw = ultima(RawDavis, "collect_time", obj.pk)
    u_ale = ultima(RainAlerts, "occurred_at", obj.pk)
    caminos[obj.pk] = (u_raw, u_ale)
    print("{:>5}  {:<24} {:<26} {:<26}".format(
        obj.pk, nombre_de(obj)[:24], hace(u_raw), hace(u_ale)))

# Un control: la estacion que mando mas recientemente de todas.
control = (RawDavis.objects.values("station")
           .annotate(u=djm.Max("collect_time")).order_by("-u").first())
if control:
    pk_c = control["station"]
    try:
        nom_c = nombre_de(Equipo.objects.get(pk=pk_c))
    except Exception:
        nom_c = str(pk_c)
    print("{:>5}  {:<24} {:<26} {:<26}  <- control (la mas al dia)".format(
        pk_c, nom_c[:24], hace(control["u"]), hace(ultima(RainAlerts, "occurred_at", pk_c))))

# ══════════════════════════════════════════════════════════════════════════
print("")
print(RAYA)
print("3. LA FORMA DEL CORTE: LECTURAS POR DIA, ULTIMOS 12 DIAS")
print(RAYA)
print("  Un tajo limpio (de N a 0 de un dia para otro) es comunicaciones o")
print("  un reset. Una pendiente de varios dias es bateria o sensor.")

for obj in elegidas:
    u_raw, u_ale = caminos[obj.pk]
    modelo, campo = (RawDavis, "collect_time") if u_raw else (RainAlerts, "occurred_at")
    filas = por_dia(modelo, campo, obj.pk)
    print("")
    print("  [{}] {}   ({}.{})".format(obj.pk, nombre_de(obj),
                                       modelo.__name__, campo))
    if not filas:
        print("        sin ninguna fila en 12 dias")
        continue
    tope = max(n for _, n in filas) or 1
    for d, n in filas:
        print("        {}  {:>6,}  {}".format(d, n, "#" * max(1, int(40.0 * n / tope))))

# ══════════════════════════════════════════════════════════════════════════
print("")
print(RAYA)
print("4. LAS ULTIMAS LECTURAS ANTES DE CALLARSE")
print(RAYA)
print("  Si los ultimos valores ya venian en blanco o en cero, el equipo")
print("  seguia hablando con el sensor roto: eso es sensor, no comunicaciones.")

# Campos que vale la pena mirar: lluvia, y cualquier cosa que delate el
# estado del equipo (bateria, voltaje, señal).
PINTA = ("rain", "lluvia", "precip", "batt", "bateria", "volt", "rssi",
         "signal", "senal", "temp_out", "hum_out")
mirar = []
for f in RawDavis._meta.concrete_fields:
    if any(p in f.name.lower() for p in PINTA):
        mirar.append(f.name)
mirar = mirar[:7]

for obj in elegidas:
    u_raw, _ = caminos[obj.pk]
    if not u_raw:
        print("")
        print("  [{}] {}: no entra por RawDavis, nada que mirar aqui".format(
            obj.pk, nombre_de(obj)))
        continue
    print("")
    print("  [{}] {}".format(obj.pk, nombre_de(obj)))
    print("        {:<18} {}".format("collect_time",
                                     "  ".join("{:>14}".format(m[:14]) for m in mirar)))
    filas = (RawDavis.objects.filter(station=obj.pk)
             .order_by("-collect_time")
             .values_list(*(["collect_time"] + mirar))[:12])
    for fila in filas:
        t = fila[0].astimezone(PERU).strftime("%m-%d %H:%M")
        vals = "  ".join("{:>14}".format("-" if v is None else str(v)[:14])
                         for v in fila[1:])
        print("        {:<18} {}".format(t, vals))

# ══════════════════════════════════════════════════════════════════════════
print("")
print(RAYA)
print("5. DONDE SEGUIR BUSCANDO, SEGUN LO DE ARRIBA")
print(RAYA)
for obj in elegidas:
    u_raw, u_ale = caminos[obj.pk]
    print("")
    print("  [{}] {}".format(obj.pk, nombre_de(obj)))
    if u_raw and not u_ale:
        print("        Entra por WeatherLink (el worker la consulta). Que el equipo")
        print("        este bien no basta: puede fallar la consulta. Mirar:")
        print("          docker compose logs --since 72h davis_worker 2>&1 \\")
        print("            | grep -iE 'error|traceback|weatherlink|{}' | tail -40".format(obj.pk))
    elif u_ale and not u_raw:
        print("        Entra por el endpoint de telemetria (el equipo empuja).")
        print("        Si no llego nada, es campo; pero antes descartar que")
        print("        llegue y se rechace:")
        print("          docker compose logs --since 72h jurp_web 2>&1 \\")
        print("            | grep -i telemetr | grep -v ' 20[0-9] ' | tail -40")
    elif u_raw and u_ale:
        print("        Tiene filas por los DOS caminos. Mirar cual de los dos se")
        print("        corto primero en el punto 3.")
    else:
        print("        No tiene una sola fila por ningun camino: nunca transmitio,")
        print("        o se dio de alta y no se configuro.")

print("")
print("Listo. Nada se modifico.")
