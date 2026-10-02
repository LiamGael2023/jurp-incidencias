# -*- coding: utf-8 -*-
"""
¿El 'rainfall_mm' de las estaciones v2 es un acumulado o lo caido en el
intervalo? De la respuesta depende como se arregla el motor de alertas.

    docker compose exec -T jurp_web python - < v2_lluvia_acumula_o_no.py

POR QUE IMPORTA. rain_alerts.py calcula la lluvia RESTANDO dos lecturas
consecutivas, y lo hace porque v1 entrega el acumulado del dia:

    si la anterior marcaba 2.4 y la nueva marca 3.0, llovieron 0.6

Las dos estaciones v2 no reciben 'rainfall_mm_per_day' —v2 no publica esa
clave en el historico— asi que el motor nunca ve nada y no alerta jamas. El
arreglo pasa por leer 'rainfall_mm', que es el unico campo de lluvia que les
llega. Pero ANTES hay que saber que significa ese numero:

  - Si es un ACUMULADO del dia, se le aplica la misma resta que a v1.
  - Si es lo caido EN ESE INTERVALO de archivo, se toma tal cual. Restar
    daria basura: diferencias negativas, ceros donde si llovio, y un
    acumulado de 30 min que no se parece al real.

COMO SE DISTINGUE, sin preguntarle a nadie. Se buscan los dias en que de
verdad llovio y se mira la secuencia dentro del dia:

    acumulado    0.0  0.2  0.2  0.6  0.6  1.0  1.0   <- nunca baja, escalona
    intervalo    0.0  0.2  0.0  0.4  0.0  0.4  0.0   <- sube y baja, picos

Un acumulado es monotono dentro del dia (salvo el reinicio de medianoche).
Si hay una sola bajada a mitad del dia, no es acumulado.

Se compara contra una v1, donde ya sabemos la respuesta: eso valida que la
prueba sabe distinguir, en vez de creerle a ciegas.

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
from django.utils import timezone                 # noqa: E402

PERU = datetime.timezone(datetime.timedelta(hours=-5))
AHORA = timezone.now()
RAYA = "=" * 78
DIAS_ATRAS = 180

RawDavis = apps.get_model("davis", "RawDavis")
Equipo = RawDavis._meta.get_field("station").related_model

TABLA = RawDavis._meta.db_table
COL_FECHA = RawDavis._meta.get_field("collect_time").column
COL_EST = RawDavis._meta.get_field("station").column


def dia_local(col):
    """Dia en hora de Lima. El tipo de la columna se lo pregunto a Postgres:
    suponerlo corre los dias unas horas sin que nada falle."""
    with connection.cursor() as cur:
        cur.execute(
            "SELECT data_type FROM information_schema.columns"
            " WHERE table_name = %s AND column_name = %s", [TABLA, col])
        fila = cur.fetchone()
    tipo = (fila[0] if fila else "") or ""
    if "with time zone" in tipo:
        return "({} AT TIME ZONE 'America/Lima')::date".format(col)
    return "({} AT TIME ZONE 'UTC' AT TIME ZONE 'America/Lima')::date".format(col)


DIA = dia_local(COL_FECHA)


def nombre_de(obj):
    for a in ("nombre", "name", "descripcion"):
        v = getattr(obj, a, None)
        if v:
            return str(v)
    return str(obj)


def version_de(obj):
    if getattr(obj, "davis_api_secret", None) and not getattr(obj, "davis_user", None):
        return "v2"
    if getattr(obj, "davis_user", None):
        return "v1"
    return "?"


def dias_con_lluvia(pk, campo, limite=3):
    """Los dias en que ese campo sumo mas, de mayor a menor."""
    desde = AHORA - datetime.timedelta(days=DIAS_ATRAS)
    with connection.cursor() as cur:
        cur.execute(
            "SELECT {d} AS dia, SUM({c}), MAX({c}), COUNT({c})"
            " FROM {t} WHERE {e} = %s AND {f} >= %s AND {c} > 0"
            " GROUP BY 1 ORDER BY 2 DESC LIMIT %s".format(
                d=DIA, c=campo, t=TABLA, e=COL_EST, f=COL_FECHA),
            [pk, desde, limite])
        return cur.fetchall()


def lecturas_del_dia(pk, campo, dia):
    with connection.cursor() as cur:
        cur.execute(
            "SELECT {f}, {c} FROM {t}"
            " WHERE {e} = %s AND {d} = %s AND {c} IS NOT NULL"
            " ORDER BY {f}".format(
                f=COL_FECHA, c=campo, t=TABLA, e=COL_EST, d=DIA),
            [pk, dia])
        return cur.fetchall()


def veredicto(valores):
    """
    ¿Monotono (acumulado) o con picos (intervalo)?

    Una sola bajada dentro del dia descarta el acumulado. Se cuentan, en vez
    de cortar en la primera, para que un dato suelto raro no decida solo.
    """
    bajadas = sum(1 for i in range(1, len(valores))
                  if valores[i] < valores[i - 1] - 1e-9)
    vuelve_a_cero = sum(1 for i in range(1, len(valores))
                        if valores[i] == 0 and valores[i - 1] > 0)
    if not valores:
        return "sin datos", bajadas, vuelve_a_cero
    if bajadas == 0:
        return "ACUMULADO (nunca baja)", bajadas, vuelve_a_cero
    if vuelve_a_cero >= max(1, len(valores) // 10):
        return "POR INTERVALO (vuelve a cero)", bajadas, vuelve_a_cero
    return "POR INTERVALO (baja {} veces)".format(bajadas), bajadas, vuelve_a_cero


# ── A quien mirar: las v2, y una v1 de control ────────────────────────────
estaciones = [o for o in Equipo.objects.all()
              if str(getattr(o, "tipo_equipo", "")).lower() == "estacion_davis"]
v2 = [o for o in estaciones if version_de(o) == "v2"]
v1 = [o for o in estaciones if version_de(o) == "v1"]

if not v2:
    print("No hay estaciones v2. Nada que decidir.")
    sys.exit(0)

print(RAYA)
print("LO QUE SE COMPARA")
print(RAYA)
print("  v2 ({} estaciones): se mira 'rainfall_mm', el unico campo de lluvia".format(len(v2)))
print("     que les llega. Es lo que habria que leer en el arreglo.")
print("  v1 (control):       se mira 'rainfall_mm_per_day', donde YA sabemos")
print("     que es un acumulado. Si la prueba no lo detecta como acumulado,")
print("     la prueba esta mal y no hay que creerle nada de lo de arriba.")

casos = []
for o in v2:
    casos.append((o, "rainfall_mm", "v2"))
if v1:
    casos.append((v1[0], "rainfall_mm_per_day", "v1 (control)"))

for obj, campo, etiqueta in casos:
    print("")
    print(RAYA)
    print("[{}] {}   -   {}   -   campo '{}'".format(
        obj.pk, nombre_de(obj), etiqueta, campo))
    print(RAYA)

    dias = dias_con_lluvia(obj.pk, campo)
    if not dias:
        print("  En {} dias no hay una sola lectura con {} > 0.".format(DIAS_ATRAS, campo))
        print("  Es la costa: puede que simplemente no haya llovido. Sin lluvia")
        print("  no se puede distinguir un acumulado de un incremento, y")
        print("  tampoco se puede probar el arreglo. Habria que esperar lluvia")
        print("  o forzar un balde de agua en el pluviometro.")
        continue

    print("  Dias con mas lluvia en los ultimos {} dias:".format(DIAS_ATRAS))
    print("    {:<12} {:>10} {:>10} {:>8}".format("DIA", "SUMA", "MAXIMO", "LECT."))
    for dia, suma, maximo, n in dias:
        print("    {:<12} {:>10.2f} {:>10.2f} {:>8}".format(
            str(dia), float(suma or 0), float(maximo or 0), n))

    dia = dias[0][0]
    filas = lecturas_del_dia(obj.pk, campo, dia)
    print("")
    print("  El dia mas lluvioso ({}), lectura por lectura:".format(dia))
    valores = []
    for t, v in filas:
        valores.append(float(v or 0))
    # Se imprimen en filas de 8 para que la secuencia se lea de un golpe.
    for i in range(0, len(valores), 8):
        trozo = filas[i:i + 8]
        horas = "  ".join("{:>7}".format(t.astimezone(PERU).strftime("%H:%M"))
                          for t, _ in trozo)
        vals = "  ".join("{:>7.2f}".format(float(v or 0)) for _, v in trozo)
        print("      {}".format(horas))
        print("      {}".format(vals))
        print("")

    v, bajadas, ceros = veredicto(valores)
    print("  -> {}".format(v))
    print("     ({} lecturas, baja {} veces, vuelve a cero {} veces)".format(
        len(valores), bajadas, ceros))

print("")
print(RAYA)
print("COMO SE LEE ESTO")
print(RAYA)
print("  Si el control v1 sale ACUMULADO y las v2 salen POR INTERVALO:")
print("    el arreglo para v2 es tomar rainfall_mm tal cual, sin restar.")
print("  Si las v2 tambien salen ACUMULADO:")
print("    se les aplica la misma resta de v1 y basta cambiar el campo.")
print("  Si el control v1 NO sale acumulado:")
print("    la prueba esta mal; no decidir nada con esto.")
print("")
print("Listo. Nada se modifico.")
