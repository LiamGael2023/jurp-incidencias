# -*- coding: utf-8 -*-
"""
Los tres arreglos que hacen que las estaciones v2 avisen y que un hueco de un
dia no congele una estacion para siempre.

    python3 parche_alertas_v2.py                 # solo muestra que cambiaria
    python3 parche_alertas_v2.py --aplicar       # lo aplica, con copia .bak
    python3 parche_alertas_v2.py /ruta/al/codigo # si no estas en la carpeta

Se ejecuta EN EL SERVIDOR, sobre el codigo fuente (no dentro del contenedor).

QUE ARREGLA, Y COMO SE COMPROBO CADA COSA ANTES DE ESCRIBIRLA:

  1. La rama v2 no llamaba al motor de alertas. NUNCA.

     sync_davis_station_v1 importa alerta_lluvia_davis y la llama fila por
     fila. sync_davis_station_v2 hace bulk_create y se va, y bulk_create no
     dispara señales. Resultado medido: EL ARENAL (892) reporta 96 lecturas
     al dia desde meses, midio 3.8 mm de lluvia la madrugada del 01/10 con
     picos de 1.00 mm en media hora, y tiene CERO alertas en toda su vida.

     Las alertas solo se generan para lecturas RECIENTES
     (DAVIS_ALERT_MAX_AGE_MINUTES, 120 por defecto). Un backfill de dias
     pasados no debe mandar notificaciones de lluvia que ya paso: nadie
     quiere un push a las 4 de la mañana por el aguacero del martes.

  2. El motor leia un campo que v2 no recibe, y con la cuenta equivocada.

     v1 entrega el acumulado del dia (rainfall_mm_per_day) y lo caido es la
     resta de dos lecturas. v2 no publica ese campo: entrega 'rainfall_mm',
     que es lo caido EN ESE INTERVALO. Restar daria diferencias negativas y
     ceros donde si llovio.

     Comprobado sobre datos reales, con un control: VALLUNARAJU (v1) sube
     0.20 -> 20.20 en el dia sin bajar nunca; EL ARENAL (v2) hace 0.20,
     0.60, 0.20, 0.00, 0.40. La prueba acerto el caso conocido antes de que
     se le creyera el otro.

     La eleccion se hace por el campo que trae la FILA, no por la version
     configurada en el equipo: es la misma cosa, pero asi no se rompe si
     mañana cambian la credencial.

  3. Una ventana vacia congelaba la estacion para siempre.

     El bucle de v2 solo mueve ControlSync.ult_sync cuando hay datos. Si una
     ventana sale vacia hacia 'break' sin avanzar nada, asi que al ciclo
     siguiente pedia la MISMA ventana. Medido: la estacion 891 llevaba seis
     dias pidiendo (26/09 00:00, 27/09 00:00] cada 15 minutos.

     Lo grave no es el dia perdido: es que si mañana un tecnico deja esa
     estacion perfecta, seguiria en blanco, porque el worker nunca va a
     pedir un dia nuevo.

     Ahora el hueco se salta, pero solo si ya es VIEJO
     (DAVIS_GAP_RETRY_SECONDS, 6 h por defecto): un hueco reciente se
     reintenta, porque WeatherLink todavia puede estar rellenandolo. Y el
     bucle sigue siendo finito: cada vuelta avanza davis_limit o choca con
     'end_ts <= start_ts' y sale. El guardia contra el bucle infinito se
     mantiene; lo que se quita es el bloqueo.

     Si hiciera falta recuperar un hueco ya saltado, --since lo vuelve a
     pedir y existing_epochs_for_range evita duplicados.

NO TOCA la insercion de filas vacias cuando normalize_v1_to_internal no logra
leer la hora de observacion (cae en ts=query_ts y mete una fila con todo en
blanco). Es basura en la tabla, no un fallo de alertas, y merece su propia
decision.

COMO SE PROTEGE DE SI MISMO:
  - Si un archivo aparece en dos carpetas, no elige: se detiene y las lista.
  - Cada arreglo entra entero o no entra: el 2 cambia una constante y la
    funcion que la usa, y a medias dejaria el modulo roto.
  - Si el texto esperado no aparece exactamente una vez, ese arreglo se
    salta. Prefiere no hacer nada a dejar un archivo a medias.
"""

from __future__ import print_function, unicode_literals

import io
import os
import shutil
import sys

APLICAR = "--aplicar" in sys.argv
RUTA_ARG = [a for a in sys.argv[1:] if not a.startswith("-")]
BASE = os.path.abspath(RUTA_ARG[0]) if RUTA_ARG else os.getcwd()

# ── Arreglo 2: rain_alerts.py ─────────────────────────────────────────────

A2_CAMPO_ANTES = """# Campo de raw_davis con el acumulado del día que entrega WeatherLink v1.
CAMPO_ACUMULADO = 'rainfall_mm_per_day'"""

A2_CAMPO_DESPUES = """# Los dos campos de lluvia, segun lo que entrega cada version de la API.
#
#   v1 (NoaaExt.json) -> rain_day_in, que se guarda en rainfall_mm_per_day:
#      es el ACUMULADO DEL DIA, y lo caido es la resta de dos lecturas.
#
#   v2 (historic)     -> rainfall_mm: es lo caido EN ESE INTERVALO de
#      archivo. Ya es el incremento. v2 no publica el acumulado del dia.
#
# Comprobado sobre datos reales: VALLUNARAJU (v1) sube 0.20 -> 20.20 en el
# dia sin bajar nunca; EL ARENAL (v2) hace 0.20, 0.60, 0.20, 0.00, 0.40.
CAMPO_ACUMULADO = 'rainfall_mm_per_day'
CAMPO_INTERVALO = 'rainfall_mm'"""

A2_LLOVIO_ANTES = '''def _llovio(registro, previo):
    """Milímetros caídos entre dos lecturas consecutivas, o None."""
    actual = _num(getattr(registro, CAMPO_ACUMULADO, None))
    if actual is None:
        return None

    if previo is None:
        # Primera lectura del día: el acumulado ya trae lo caído en la
        # madrugada, pero no hay forma de repartirlo en el tiempo ni de
        # saber si ya se notificó. Se toma como referencia y no se alerta.
        return None

    anterior = _num(getattr(previo, CAMPO_ACUMULADO, None))
    if anterior is None:
        return None

    if actual >= anterior:
        return actual - anterior

    # El contador bajó: se reinició. Lo caído es el valor nuevo.
    return actual'''

A2_LLOVIO_DESPUES = '''def _llovio(registro, previo):
    """
    Milímetros caídos en esta lectura, o None.

    Qué cuenta hacer lo decide el campo que trae la FILA, no la versión
    configurada en el equipo. Es la misma cosa, pero así no se rompe si
    mañana cambian la credencial de una estación.
    """
    acumulado = _num(getattr(registro, CAMPO_ACUMULADO, None))

    if acumulado is None:
        # Camino v2: el valor del intervalo ya ES lo caído, y no necesita
        # lectura anterior. Restar daría diferencias negativas y ceros
        # donde sí llovió.
        return _num(getattr(registro, CAMPO_INTERVALO, None))

    if previo is None:
        # Primera lectura del día en el camino del acumulado: ya trae lo
        # caído en la madrugada, pero no hay forma de repartirlo en el
        # tiempo ni de saber si ya se notificó. Se toma como referencia.
        return None

    anterior = _num(getattr(previo, CAMPO_ACUMULADO, None))
    if anterior is None:
        return None

    if acumulado >= anterior:
        return acumulado - anterior

    # El contador bajó: se reinició. Lo caído es el valor nuevo.
    return acumulado'''

# ── Arreglo 3: el hueco que congelaba la estacion ─────────────────────────

A3_ANTES = """            if not payload:
                self.stdout.write('[DAVIS][%s][v2] Sin datos en la ventana; se corta para evitar loop.' % med.id)
                break"""

A3_DESPUES = """            if not payload:
                # Una ventana vacia no puede parar la sincronizacion para
                # siempre. Antes se cortaba aqui sin mover el cursor, y la
                # estacion 891 estuvo seis dias pidiendo el mismo dia cada
                # 15 minutos: un hueco de un dia tapaba todos los dias
                # siguientes, y una reparacion en campo nunca se habria
                # notado.
                #
                # Ahora se salta el hueco, pero solo si ya es VIEJO. Un
                # hueco reciente se reintenta: WeatherLink todavia puede
                # estar rellenandolo.
                gap_retry = int(getattr(settings, 'DAVIS_GAP_RETRY_SECONDS', 21600))
                if (now_utc_ts - end_ts) < gap_retry:
                    self.stdout.write(
                        '[DAVIS][%s][v2] Sin datos en la ventana; es reciente, se reintenta en el proximo ciclo.' % med.id)
                    break

                self.stdout.write(
                    '[DAVIS][%s][v2] Sin datos en la ventana; hueco viejo, se salta hasta %s.' % (
                        med.id,
                        ts_to_lima_str(end_ts),
                    )
                )

                if not dry_run:
                    with transaction.atomic():
                        cs_ref = ControlSync.objects.select_for_update().get(pk=cs.pk)
                        cs_ref.ult_sync = lima_aware_from_ts(end_ts, -18000, use_tz)
                        cs_ref.save(update_fields=['ult_sync'])

                # El bucle sigue siendo finito: cada vuelta avanza
                # davis_limit, o choca con clamp_end y sale por
                # 'end_ts <= start_ts'.
                start_ts = int(end_ts)

                if once:
                    break

                continue"""

# ── Arreglo 1: la llamada a las alertas que faltaba en v2 ─────────────────

A1_ANTES = """            created = 0
            if rows and not dry_run:
                for i in range(0, len(rows), batch_size):
                    RawDavis.objects.bulk_create(rows[i:i + batch_size], batch_size=batch_size)
                created = len(rows)"""

A1_DESPUES = """            created = 0
            if rows and not dry_run:
                for i in range(0, len(rows), batch_size):
                    RawDavis.objects.bulk_create(rows[i:i + batch_size], batch_size=batch_size)
                created = len(rows)

                # Alerta de lluvia. La rama v1 ya la generaba fila por fila;
                # esta no la generaba NUNCA, asi que las estaciones v2 jamas
                # levantaron una alerta aunque lloviera: bulk_create no
                # dispara señales y aqui no habia llamada. EL ARENAL midio
                # 3.8 mm el 01/10 y no aviso a nadie.
                #
                # Solo avisan las lecturas RECIENTES. Un backfill de dias
                # pasados mandaria notificaciones de lluvia que ya paso.
                try:
                    from src.apps.davis.services.rain_alerts import alerta_lluvia_davis
                except Exception as exc_import:
                    alerta_lluvia_davis = None
                    self.stdout.write('[DAVIS][%s][v2] Alertas no disponibles: %s' % (
                        med.id, exc_import))

                if alerta_lluvia_davis is not None:
                    max_edad = int(getattr(settings, 'DAVIS_ALERT_MAX_AGE_MINUTES', 120))
                    corte_ts = int(time.time()) - (max_edad * 60)
                    for fila in rows:
                        if unix_from_dt(fila.collect_time) < corte_ts:
                            continue
                        try:
                            mm_alerta = alerta_lluvia_davis(med, fila)
                            if mm_alerta:
                                self.stdout.write('[DAVIS][%s][v2] Lluvia %.2f mm: alerta registrada.' % (
                                    med.id, mm_alerta))
                        except Exception as exc_alerta:
                            self.stdout.write('[DAVIS][%s][v2] Alerta omitida: %s' % (
                                med.id, exc_alerta))"""

CAMBIOS = [
    {
        "archivo": "rain_alerts.py",
        "titulo": "1. El motor lee el campo que cada version SI trae, con la cuenta correcta",
        "porque": ("v2 no publica rainfall_mm_per_day: entrega rainfall_mm, que ya es lo\n"
                   "            caido en el intervalo. Restar dos lecturas v2 daria basura.\n"
                   "            Validado con un control v1 que la prueba acerto primero."),
        "pares": [
            (A2_CAMPO_ANTES, A2_CAMPO_DESPUES),
            (A2_LLOVIO_ANTES, A2_LLOVIO_DESPUES),
        ],
    },
    {
        "archivo": "davis_historic.py",
        "titulo": "2. Un hueco viejo ya no congela la estacion para siempre",
        "porque": ("El cursor solo avanzaba cuando habia datos. La 891 llevaba seis dias\n"
                   "            pidiendo el mismo dia, y una reparacion en campo nunca se habria\n"
                   "            notado. Los huecos recientes se siguen reintentando."),
        "pares": [(A3_ANTES, A3_DESPUES)],
    },
    {
        "archivo": "davis_historic.py",
        "titulo": "3. La rama v2 por fin llama al motor de alertas",
        "porque": ("v1 lo llamaba fila por fila; v2 no lo llamaba nunca. EL ARENAL midio\n"
                   "            3.8 mm el 01/10 con picos de 1.00 mm en media hora y tiene cero\n"
                   "            alertas en toda su vida. Solo avisan las lecturas recientes."),
        "pares": [(A1_ANTES, A1_DESPUES)],
    },
]

SALTAR_CARPETAS = (".git", "node_modules", "__pycache__", ".venv", "site-packages")


def localizar(nombre):
    hallados = []
    for raiz, carpetas, archivos in os.walk(BASE):
        carpetas[:] = [c for c in carpetas if c not in SALTAR_CARPETAS]
        if nombre in archivos and "davis" in raiz:
            hallados.append(os.path.join(raiz, nombre))
    return hallados


print("Buscando el codigo fuente bajo: {}".format(BASE))
print("")

rutas = {}
for c in CAMBIOS:
    if c["archivo"] in rutas:
        continue
    hallados = localizar(c["archivo"])
    rutas[c["archivo"]] = hallados
    if len(hallados) == 1:
        print("  {} -> {}".format(c["archivo"], hallados[0]))
    elif not hallados:
        print("  {} -> NO ENCONTRADO".format(c["archivo"]))
    else:
        print("  {} -> {} COPIAS:".format(c["archivo"], len(hallados)))
        for h in hallados:
            print("        {}".format(h))
print("")

faltan = [a for a, h in rutas.items() if not h]
if faltan:
    print("No encuentro {}.".format(", ".join(sorted(faltan))))
    print("Ejecuta esto desde la carpeta del codigo fuente, o pasasela como argumento:")
    print("    python3 parche_alertas_v2.py /ruta/al/codigo")
    sys.exit(1)

dobles = [a for a, h in rutas.items() if len(h) > 1]
if dobles:
    print("Hay mas de una copia de {}. No elijo por ti: si parcheo la que no es,".format(
        ", ".join(sorted(dobles))))
    print("el cambio no hara nada y pensaras que si lo hizo.")
    print("Pasa la carpeta exacta como argumento.")
    sys.exit(1)

rutas = dict((a, h[0]) for a, h in rutas.items())

contenidos = {}
for a, r in rutas.items():
    with io.open(r, encoding="utf-8") as f:
        contenidos[a] = f.read()

aplicables = []
for c in CAMBIOS:
    txt = contenidos[c["archivo"]]
    print("=" * 76)
    print(c["titulo"])
    print("   Por que: {}".format(c["porque"]))
    print("   Archivo: {}".format(rutas[c["archivo"]]))

    malos = [(a, txt.count(a)) for a, _ in c["pares"] if txt.count(a) != 1]
    if malos:
        print("   >> NO SE APLICA.")
        for a, veces in malos:
            print("      El texto esperado aparece {} veces (deberia ser 1):".format(veces))
            print("        {}".format(a.split("\n")[0][:70]))
        print("      El archivo no es el que esperaba; mejor no tocarlo.")
        print("")
        continue

    for antes, despues in c["pares"]:
        for linea in antes.split("\n"):
            print("   - {}".format(linea))
        for linea in despues.split("\n"):
            print("   + {}".format(linea))
        print("")
    aplicables.append(c)
print("=" * 76)
print("")

if not aplicables:
    print("Nada que aplicar.")
    sys.exit(0)

if not APLICAR:
    print("{} de {} arreglos listos. NADA se ha escrito.".format(len(aplicables), len(CAMBIOS)))
    print("Para aplicarlos:  python3 parche_alertas_v2.py --aplicar")
    sys.exit(0)

tocados = sorted(set(c["archivo"] for c in aplicables))


def puede_escribir(ruta):
    """
    ¿Se puede reescribir este archivo?

    Esta comprobacion existe porque la primera version no la hacia y dejo un
    servidor de produccion a medio parchear: escribio el primer archivo y se
    estrello con PermissionError en el segundo. El .bak si se habia creado,
    porque la carpeta era escribible y el archivo no.

    No vale abrirlo en modo escritura para probar: eso ya lo truncaria.
    """
    if os.access(ruta, os.W_OK):
        return True, ""
    if os.access(os.path.dirname(ruta), os.W_OK):
        return False, "el archivo es de solo lectura (la carpeta si es escribible)"
    return False, "sin permiso de escritura"


problemas = []
for a in tocados:
    ok, motivo = puede_escribir(rutas[a])
    if not ok:
        problemas.append((rutas[a], motivo))

if problemas:
    print("NO SE ESCRIBE NADA. Falta permiso de escritura en:")
    for ruta, motivo in problemas:
        print("  {}".format(ruta))
        print("      {}".format(motivo))
    print("")
    print("Se comprueban TODOS los archivos antes de tocar el primero, para no")
    print("dejar el codigo a medias. Vuelve a lanzarlo con permisos:")
    print("    sudo python3 {} --aplicar".format(os.path.basename(sys.argv[0])))
    sys.exit(1)

for a in tocados:
    shutil.copy2(rutas[a], rutas[a] + ".bak")
    print("Copia de seguridad: {}.bak".format(rutas[a]))

for c in aplicables:
    for antes, despues in c["pares"]:
        contenidos[c["archivo"]] = contenidos[c["archivo"]].replace(antes, despues, 1)

for a in tocados:
    with io.open(rutas[a], "w", encoding="utf-8") as f:
        f.write(contenidos[a])
    print("Escrito: {}".format(rutas[a]))

print("")
print("Hecho. Ahora hay que recrear los servicios para que lean el codigo nuevo:")
print("  docker compose up -d --no-deps --force-recreate jurp_web davis_worker beat")
print("")
print("NO uses docker restart en este servidor.")
print("")
print("Como comprobar que funciono, sin esperar a que llueva:")
print("  docker compose logs -f --since 1m davis_worker | grep -E '\\[89[12]\\]'")
print("  -> 892 debe seguir trayendo filas; 891 debe EMPEZAR a pedir dias nuevos")
print("     en vez de repetir el 26/09.")
print("")
print("Para deshacer:")
for a in tocados:
    print("  mv {}.bak {}".format(rutas[a], rutas[a]))
