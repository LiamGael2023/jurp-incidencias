# -*- coding: utf-8 -*-
"""
¿El arreglo de alertas v2 esta de verdad corriendo, y cuantos avisos habria
mandado con la lluvia que ya cayo?

    docker compose exec -T jurp_web python - < verificar_alertas_v2_desplegado.py

POR QUE ESTE SCRIPT Y NO ESPERAR A QUE LLUEVA. En la costa de Viru puede no
llover en semanas. Pero la lluvia del 01/10 esta guardada en raw_davis, asi
que se puede volver a pasar por el motor y ver que habria hecho. Sin crear
nada: se llama a _llovio(), que solo calcula, y NO a alerta_lluvia_davis(),
que escribiria filas y mandaria notificaciones.

Lo que responde, en este orden:

  1. ¿El codigo nuevo esta cargado? Si falta CAMPO_INTERVALO, el modulo que
     tiene el worker en memoria es el viejo y hay que recrear los
     contenedores. Esto se comprueba PRIMERO porque todo lo demas depende.

  2. Con el codigo viejo, ¿cuantos milimetros veia? Para las estaciones v2,
     cero: leia rainfall_mm_per_day, que a ellas les viene vacio.

  3. Con el codigo nuevo, ¿cuanto ve, y cuantas ventanas cruzan cada umbral?
     Ese es el numero que se puede llevar a la Junta: avisos que no salieron.

SOBRE LOS NOMBRES DE LOS COLORES. No se dicen aqui a proposito. Los nombres
de los niveles en hi_incidents/constants.py estan corridos un nivel respecto
de los cortes que usa el motor, y eso es una decision pendiente. Asi que se
informan los NUMEROS y que umbral cruza cada ventana, sin ponerle color.

No modifica nada: solo lee y calcula.
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
from django.utils import timezone                 # noqa: E402

PERU = datetime.timezone(datetime.timedelta(hours=-5))
AHORA = timezone.now()
RAYA = "=" * 78

RawDavis = apps.get_model("davis", "RawDavis")
Equipo = RawDavis._meta.get_field("station").related_model

# ══════════════════════════════════════════════════════════════════════════
print(RAYA)
print("1. ¿ESTA CARGADO EL CODIGO NUEVO?")
print(RAYA)

from src.apps.davis.services import rain_alerts as RA      # noqa: E402

tiene_intervalo = hasattr(RA, "CAMPO_INTERVALO")
print("  rain_alerts.CAMPO_ACUMULADO = {!r}".format(getattr(RA, "CAMPO_ACUMULADO", None)))
print("  rain_alerts.CAMPO_INTERVALO = {!r}".format(getattr(RA, "CAMPO_INTERVALO", "NO EXISTE")))
print("  rain_alerts.MINIMO_MM       = {}".format(getattr(RA, "MINIMO_MM", "?")))
print("")
if not tiene_intervalo:
    print("  >> El modulo cargado es el VIEJO. El archivo puede estar parcheado en")
    print("     disco, pero este proceso tiene en memoria la version anterior.")
    print("     Hace falta recrear los servicios:")
    print("       docker compose up -d --no-deps --force-recreate jurp_web davis_worker beat")
    print("")
    print("     (se sigue de todos modos, para medir con que se cuenta hoy)")
else:
    print("  >> Codigo nuevo cargado. El camino de v2 ya sabe leer su campo.")

try:
    from src.apps.davis.services import tip_processing as TP
    UMBRALES = [
        ("1er corte", TP.NORMAL_THRESHOLD_MM),
        ("2do corte", TP.YELLOW_THRESHOLD_MM),
        ("3er corte", TP.ORANGE_THRESHOLD_MM),
    ]
    VENTANA_MIN = TP.RAIN_EVALUATION_INTERVAL_MINUTES
except Exception as exc:
    print("")
    print("  No se pudieron leer los umbrales de tip_processing: {}".format(exc))
    UMBRALES = [("1er corte", 0.21), ("2do corte", 0.63), ("3er corte", 1.06)]
    VENTANA_MIN = 30

print("")
print("  Cortes del motor: {}".format(
    ", ".join("{} = {} mm".format(n, v) for n, v in UMBRALES)))
print("  Ventana de evaluacion: {} minutos".format(VENTANA_MIN))

# ══════════════════════════════════════════════════════════════════════════
print("")
print(RAYA)
print("2. LA LLUVIA QUE YA CAYO, PASADA POR EL MOTOR")
print(RAYA)


def dia_local(col):
    with connection.cursor() as cur:
        cur.execute(
            "SELECT data_type FROM information_schema.columns"
            " WHERE table_name = %s AND column_name = %s",
            [RawDavis._meta.db_table, col])
        fila = cur.fetchone()
    tipo = (fila[0] if fila else "") or ""
    if "with time zone" in tipo:
        return "({} AT TIME ZONE 'America/Lima')::date".format(col)
    return "({} AT TIME ZONE 'UTC' AT TIME ZONE 'America/Lima')::date".format(col)


TABLA = RawDavis._meta.db_table
COL_F = RawDavis._meta.get_field("collect_time").column
COL_E = RawDavis._meta.get_field("station").column
DIA = dia_local(COL_F)


def es_v2(obj):
    return bool(getattr(obj, "davis_api_secret", None)) and not getattr(obj, "davis_user", None)


estaciones = [o for o in Equipo.objects.all()
              if str(getattr(o, "tipo_equipo", "")).lower() == "estacion_davis" and es_v2(o)]

if not estaciones:
    print("  No hay estaciones v2.")
    sys.exit(0)


def nombre_de(obj):
    return str(getattr(obj, "nombre", None) or getattr(obj, "name", None) or obj)


def dia_mas_lluvioso(pk):
    desde = AHORA - datetime.timedelta(days=30)
    with connection.cursor() as cur:
        cur.execute(
            "SELECT {d} AS dia, SUM(rainfall_mm) FROM {t}"
            " WHERE {e} = %s AND {f} >= %s AND rainfall_mm > 0"
            " GROUP BY 1 ORDER BY 2 DESC LIMIT 1".format(
                d=DIA, t=TABLA, e=COL_E, f=COL_F),
            [pk, desde])
        return cur.fetchone()


total_avisos = 0
for obj in estaciones:
    print("")
    print("  [{}] {}".format(obj.pk, nombre_de(obj)))

    fila = dia_mas_lluvioso(obj.pk)
    if not fila:
        print("        No ha llovido en 30 dias. Nada que replicar aqui.")
        continue
    dia, suma_bruta = fila
    print("        Dia mas lluvioso de los ultimos 30: {} ({:.2f} mm medidos)".format(
        dia, float(suma_bruta or 0)))

    lecturas = list(RawDavis.objects
                    .filter(**{COL_E: obj.pk})
                    .extra(where=["{} = %s".format(DIA)], params=[dia])
                    .order_by("collect_time"))
    if not lecturas:
        print("        (no se pudieron releer sus lecturas de ese dia)")
        continue

    # Lo que el motor calcula para cada lectura, con el codigo que este
    # proceso tenga cargado AHORA.
    caidos = []
    for i, reg in enumerate(lecturas):
        mm = RA._llovio(reg, lecturas[i - 1] if i else None)
        caidos.append((reg.collect_time, mm))

    con_valor = [(t, mm) for t, mm in caidos if mm is not None]
    sobre_minimo = [(t, mm) for t, mm in con_valor if mm >= RA.MINIMO_MM]

    print("        Lecturas del dia: {}".format(len(lecturas)))
    print("        Con milimetros calculables: {}".format(len(con_valor)))
    print("        Que pasan el minimo de {} mm (crean fila de alerta): {}".format(
        RA.MINIMO_MM, len(sobre_minimo)))

    if not sobre_minimo:
        print("        -> Con el codigo cargado, esta estacion no levanta ni una")
        print("           alerta con la lluvia de ese dia.")
        continue

    # Ventana movil, igual que el motor: suma de lo caido en los ultimos
    # VENTANA_MIN minutos hasta cada alerta.
    ventana = datetime.timedelta(minutes=VENTANA_MIN)
    cruces = dict((n, 0) for n, _ in UMBRALES)
    peor = 0.0
    peor_hora = None
    for t, _mm in sobre_minimo:
        total = sum(m for tt, m in sobre_minimo if t - ventana < tt <= t)
        if total > peor:
            peor, peor_hora = total, t
        for n, v in UMBRALES:
            if total >= v:
                cruces[n] += 1

    print("        Maximo en {} min: {:.2f} mm, a las {}".format(
        VENTANA_MIN, peor, peor_hora.astimezone(PERU).strftime("%H:%M")))
    for n, v in UMBRALES:
        print("          ventanas que cruzan {} ({} mm): {}".format(n, v, cruces[n]))
    total_avisos += len(sobre_minimo)

# ══════════════════════════════════════════════════════════════════════════
print("")
print(RAYA)
print("3. EN RESUMEN")
print(RAYA)
if not tiene_intervalo:
    print("  El codigo cargado es el VIEJO: las estaciones v2 habrian generado 0")
    print("  alertas con esa lluvia, que es exactamente lo que paso en la vida")
    print("  real. Recrea los servicios y vuelve a correr esto.")
else:
    print("  Con el codigo nuevo, esa misma lluvia habria generado {} filas de".format(total_avisos))
    print("  alerta en las estaciones v2. Con el viejo fueron 0: leia un campo")
    print("  que a ellas les llega vacio.")
print("")
print("Listo. Nada se creo ni se notifico.")
