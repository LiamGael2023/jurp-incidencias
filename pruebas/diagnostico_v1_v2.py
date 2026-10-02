# -*- coding: utf-8 -*-
"""
Cuantas estaciones Davis estan ciegas al motor de alertas, y si las v1 se
cayeron todas juntas.

    docker compose exec -T jurp_web python - < diagnostico_v1_v2.py

DOS PREGUNTAS, UNA CONSULTA.

(1) ¿CUANTAS ESTACIONES NO PUEDEN GENERAR UNA ALERTA, PASE LO QUE PASE?

    rain_alerts.py calcula la lluvia de un solo campo:

        CAMPO_ACUMULADO = 'rainfall_mm_per_day'

    y su propio comentario explica por que: "WeatherLink v1 solo entrega el
    ACUMULADO DEL DIA". Si ese campo viene nulo, _llovio() devuelve None en
    la primera linea y no pasa nada mas: ni fila en RainAlerts, ni push.

    Pero no todas las estaciones hablan v1. Las que tienen davis_api_secret
    son v2, y a esas la lluvia les llega en 'rainfall_mm', que ese codigo no
    mira. Resultado: una estacion v2 puede estar reportando perfecto y no
    levantar una sola alerta aunque le caiga un diluvio.

    Aqui se cuenta, estacion por estacion y sobre datos reales de los
    ultimos 7 dias, cuantas lecturas traen CADA campo de lluvia con valor.
    Una estacion con lecturas pero con cero valores en 'rainfall_mm_per_day'
    esta ciega. No es una sospecha: es aritmetica sobre sus propias filas.

(2) ¿LAS QUE SE DEGRADARON, SE DEGRADARON JUNTAS?

    Armonia 3 venia clavada en 96 lecturas/dia y se cayo a 16 el 29/09.
    Remanso 02 lleva semanas irregular. Las dos son v1 y las dos son de la
    misma cuenta (Hortifrut, dadas de alta el mismo segundo).

    Dos equipos distintos no se averian el mismo dia en el campo. Pero una
    API si deja de responder para todos sus clientes a la vez. Asi que se
    dibujan las lecturas por dia de TODAS las Davis, agrupadas por version
    de API: si el grupo v1 se cae en bloque, el problema esta en Davis o en
    la credencial de la cuenta, y nadie tiene que viajar a Viru.

No modifica nada: solo lee. Dos consultas agrupadas, nada de recorrer filas.
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

RawDavis = apps.get_model("davis", "RawDavis")
RainAlerts = apps.get_model("davis", "RainAlerts")
Equipo = RawDavis._meta.get_field("station").related_model

# El campo que mira rain_alerts.py. Si esto cambia alla, cambia aqui.
CAMPO_QUE_USA_EL_MOTOR = "rainfall_mm_per_day"

TABLA = RawDavis._meta.db_table
COL_FECHA = RawDavis._meta.get_field("collect_time").column
COL_EST = RawDavis._meta.get_field("station").column

CAMPOS_LLUVIA = [f for f in RawDavis._meta.concrete_fields
                 if "rain" in f.name.lower()]


def dia_local(col):
    """
    Expresion SQL que da el DIA en hora de Lima de una columna de fecha.

    No se escribe a ciegas porque depende del tipo de la columna, y
    equivocarse corre los dias unas horas sin que nada falle:

      - timestamptz: una sola conversion, 'col AT TIME ZONE Lima' ya entrega
        la hora de pared local.
      - timestamp (sin zona, USE_TZ=False): hay que decir primero que lo
        guardado es UTC y despues llevarlo a Lima.

    El tipo se le pregunta a Postgres en vez de suponerlo.
    """
    with connection.cursor() as cur:
        cur.execute(
            "SELECT data_type FROM information_schema.columns"
            " WHERE table_name = %s AND column_name = %s", [TABLA, col])
        fila = cur.fetchone()
    tipo = (fila[0] if fila else "") or ""
    if "with time zone" in tipo:
        return "({} AT TIME ZONE 'America/Lima')::date".format(col)
    return "({} AT TIME ZONE 'UTC' AT TIME ZONE 'America/Lima')::date".format(col)


DIA_LOCAL = dia_local(COL_FECHA)


def nombre_de(obj):
    for a in ("nombre", "name", "descripcion"):
        v = getattr(obj, a, None)
        if v:
            return str(v)
    return str(obj)


def version_de(obj):
    """
    Que version de WeatherLink habla cada equipo.

    No se cree el campo davis_api_version a ciegas: lo que de verdad decide
    es la FORMA de la credencial. v2 firma con token+secret; v1 manda el
    DID y la contraseña de la consola. Si los dos dicen lo mismo, mejor; si
    no, se marca para mirarlo a mano.
    """
    declarada = str(getattr(obj, "davis_api_version", "") or "").strip().lower()
    tiene_secret = bool(getattr(obj, "davis_api_secret", None))
    tiene_user = bool(getattr(obj, "davis_user", None))

    if tiene_secret and not tiene_user:
        real = "v2"
    elif tiene_user and not tiene_secret:
        real = "v1"
    elif tiene_secret and tiene_user:
        real = "ambas?"
    else:
        real = "sin credencial"

    choca = declarada and declarada.replace("v", "") not in real.replace("v", "")
    return real, declarada, choca


# ── Las estaciones Davis ──────────────────────────────────────────────────
estaciones = [o for o in Equipo.objects.all()
              if str(getattr(o, "tipo_equipo", "")).lower() == "estacion_davis"]

if not estaciones:
    print("No hay equipos con tipo_equipo='estacion_davis'.")
    sys.exit(1)

pks = [o.pk for o in estaciones]
info = {}
for o in estaciones:
    real, declarada, choca = version_de(o)
    info[o.pk] = {"nombre": nombre_de(o), "ver": real,
                  "declarada": declarada, "choca": choca,
                  "desc": str(getattr(o, "descripcion", "") or "")[:18]}

# ── Consulta 1: lecturas y campos con valor, ultimos 7 dias ──────────────
desde7 = AHORA - datetime.timedelta(days=7)
cols = ", ".join("COUNT({})".format(f.column) for f in CAMPOS_LLUVIA)
with connection.cursor() as cur:
    cur.execute(
        "SELECT {e}, COUNT(*), {c} FROM {t}"
        " WHERE {f} >= %s AND {e} = ANY(%s) GROUP BY 1".format(
            e=COL_EST, c=cols, t=TABLA, f=COL_FECHA),
        [desde7, pks])
    crudo7 = dict((fila[0], fila[1:]) for fila in cur.fetchall())

# ── Consulta 2: lecturas por dia y estacion, ultimos 14 dias ─────────────
desde14 = AHORA - datetime.timedelta(days=14)
with connection.cursor() as cur:
    cur.execute(
        "SELECT {e}, {d} AS dia, COUNT(*)"
        " FROM {t} WHERE {f} >= %s AND {e} = ANY(%s)"
        " GROUP BY 1, 2 ORDER BY 2".format(
            e=COL_EST, d=DIA_LOCAL, f=COL_FECHA, t=TABLA),
        [desde14, pks])
    pordia = cur.fetchall()

# ── Ultima lectura y alertas de siempre ───────────────────────────────────
# El .order_by() vacio NO es decorativo: si el modelo trae Meta.ordering,
# Django mete el campo de orden en el GROUP BY y la agregacion se parte en
# una fila por (estacion, instante) en vez de una por estacion. El Max sale
# entonces de un grupo cualquiera y da fechas absurdas, sin avisar.
ultimas = dict((r["station"], r["u"]) for r in RawDavis.objects.filter(
    station__in=pks).values("station").order_by()
    .annotate(u=djm.Max("collect_time")))
alertas = dict((r["station"], r["n"]) for r in RainAlerts.objects.filter(
    station__in=pks).values("station").order_by()
    .annotate(n=djm.Count("id")))


# ══════════════════════════════════════════════════════════════════════════
print(RAYA)
print("0. LOS CAMPOS DE LLUVIA QUE EXISTEN EN raw_davis")
print(RAYA)
for f in CAMPOS_LLUVIA:
    marca = "  <- EL UNICO QUE MIRA rain_alerts.py" if f.name == CAMPO_QUE_USA_EL_MOTOR else ""
    print("  {}{}".format(f.name, marca))
if CAMPO_QUE_USA_EL_MOTOR not in [f.name for f in CAMPOS_LLUVIA]:
    print("")
    print("  OJO: '{}' no existe en el modelo. Entonces el motor".format(CAMPO_QUE_USA_EL_MOTOR))
    print("  de alertas no lee nada y NINGUNA estacion Davis puede alertar.")

# ══════════════════════════════════════════════════════════════════════════
print("")
print(RAYA)
print("1. CADA ESTACION: QUE VERSION HABLA Y QUE CAMPOS LE LLEGAN CON VALOR")
print(RAYA)
print("  Lecturas de los ultimos 7 dias. Las columnas de lluvia dicen en")
print("  CUANTAS de esas lecturas el campo venia con un valor (no nulo).")
print("")
cab = "{:>5}  {:<22} {:<6} {:<19} {:>7}".format("ID", "ESTACION", "API", "ULTIMA (Peru)", "LECT.7d")
for f in CAMPOS_LLUVIA:
    cab += " {:>16}".format(f.name[-16:])
print(cab)
print("-" * len(cab))

ciegas, sanas = [], []
for pk in sorted(pks, key=lambda p: (info[p]["ver"], info[p]["nombre"])):
    d = info[pk]
    n7 = crudo7.get(pk, (0,) + (0,) * len(CAMPOS_LLUVIA))
    total7 = n7[0]
    u = ultimas.get(pk)
    texto_u = u.astimezone(PERU).strftime("%Y-%m-%d %H:%M") if u else "nunca"

    fila = "{:>5}  {:<22} {:<6} {:<19} {:>7,}".format(
        pk, d["nombre"][:22], d["ver"], texto_u, total7)
    for i, f in enumerate(CAMPOS_LLUVIA):
        fila += " {:>16,}".format(n7[1 + i])
    print(fila)

    if d["choca"]:
        print("        (dice davis_api_version='{}' pero la credencial es de {})".format(
            d["declarada"], d["ver"]))

    # El veredicto: tiene lecturas pero el campo del motor viene vacio.
    if total7 > 0:
        idx = next((i for i, f in enumerate(CAMPOS_LLUVIA)
                    if f.name == CAMPO_QUE_USA_EL_MOTOR), None)
        if idx is not None and n7[1 + idx] == 0:
            ciegas.append(pk)
        else:
            sanas.append(pk)

# ══════════════════════════════════════════════════════════════════════════
print("")
print(RAYA)
print("2. ESTACIONES CIEGAS AL MOTOR DE ALERTAS")
print(RAYA)
print("  Reportan sin problema, pero '{}' les viene".format(CAMPO_QUE_USA_EL_MOTOR))
print("  vacio en TODAS sus lecturas. _llovio() sale con None antes de hacer")
print("  nada: no hay fila en RainAlerts y no hay push. Llueva lo que llueva.")
print("")
if ciegas:
    for pk in ciegas:
        print("  [{:>4}] {:<24} api={:<4}  alertas en toda su vida: {}".format(
            pk, info[pk]["nombre"][:24], info[pk]["ver"], alertas.get(pk, 0)))
    print("")
    print("  {} de {} estaciones con datos no pueden alertar.".format(
        len(ciegas), len(ciegas) + len(sanas)))
else:
    print("  Ninguna: a todas las que reportan les llega el campo que el motor lee.")

# ══════════════════════════════════════════════════════════════════════════
print("")
print(RAYA)
print("3. ¿SE CAYERON JUNTAS? LECTURAS POR DIA, AGRUPADAS POR VERSION DE API")
print(RAYA)
print("  Dos equipos no se averian el mismo dia en el campo. Una API si deja")
print("  de responder para todos a la vez. Si un grupo entero se cae de")
print("  golpe, el problema no esta en Viru.")

dias = sorted(set(d for _, d, _ in pordia))
grupos = {}
for pk, d, n in pordia:
    g = info[pk]["ver"]
    grupos.setdefault(g, {}).setdefault(d, 0)
    grupos[g][d] += n

cuantas = {}
for pk in pks:
    cuantas.setdefault(info[pk]["ver"], []).append(pk)

for g in sorted(grupos):
    activas = [pk for pk in cuantas.get(g, []) if crudo7.get(pk, (0,))[0]]
    print("")
    print("  API {}  ({} estaciones, {} con datos esta semana)".format(
        g, len(cuantas.get(g, [])), len(activas)))
    tope = max(grupos[g].values()) or 1
    for d in dias:
        n = grupos[g].get(d, 0)
        print("        {}  {:>7,}  {}".format(
            d, n, "#" * max(0, int(44.0 * n / tope))))

print("")
print(RAYA)
print("4. Y CADA ESTACION POR SEPARADO, PARA VER QUIEN ARRASTRA A QUIEN")
print(RAYA)
porest = {}
for pk, d, n in pordia:
    porest.setdefault(pk, {})[d] = n

cab = "{:>5}  {:<22} {:<6}".format("ID", "ESTACION", "API")
for d in dias:
    cab += " {:>5}".format(d.strftime("%m-%d"))
print(cab)
print("-" * len(cab))
for pk in sorted(pks, key=lambda p: (info[p]["ver"], info[p]["nombre"])):
    if pk not in porest:
        continue
    fila = "{:>5}  {:<22} {:<6}".format(pk, info[pk]["nombre"][:22], info[pk]["ver"])
    for d in dias:
        n = porest[pk].get(d, 0)
        fila += " {:>5}".format(n if n else ".")
    print(fila)
print("")
print("  ('.' = ni una lectura ese dia; lo normal cada 15 min son 96)")

print("")
print("Listo. Nada se modifico.")
