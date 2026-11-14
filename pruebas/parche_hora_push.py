# -*- coding: utf-8 -*-
"""La hora de los avisos de lluvia salia cinco horas atrasada.

    cd /var/www/envs/prod/push_service/app
    curl -sO https://raw.githubusercontent.com/LiamGael2023/jurp-incidencias/<SHA>/pruebas/parche_hora_push.py
    python3 parche_hora_push.py main.py --dry-run
    sudo python3 parche_hora_push.py main.py
    cd /var/www/envs/prod
    docker compose build push_service && docker compose up -d push_service

QUE PASABA
----------
Un aviso recibido a las 09:15 decia «Hora: 14/11/2026 04:15:22». Otro
recibido a las 09:00 decia «04:00:22». Cinco horas exactas, al segundo,
las dos veces: eso no es un sensor lento, es el huso horario.

    dt = datetime.fromisoformat(raw.replace('Z', '+00:00'))
    dt = dt + timedelta(hours=-5)      # <- restaba siempre

Un desplazamiento fijo escrito a mano, aplicado sin mirar si la fecha ya
traia zona horaria.

DE DONDE VIENE LA FECHA. Django corre con USE_TZ=True y
TIME_ZONE='America/Lima'. La alerta de lluvia se manda desde
telemetry_jurp.py con `alert.occurred_at.isoformat()`, y ese objeto
acaba de crearse en memoria: conserva la zona local con la que se
construyo, asi que llega como 2026-11-14T09:15:22-05:00. Ya correcto. El
-5 lo volvia a atrasar.

POR QUE LOS AVISOS DE INCIDENTES SI SE VEIAN BIEN. Por accidente. Van
por otro camino -hi_incidents.py- que los manda YA FORMATEADOS, como
«14/11/2026 09:21:49». Eso no es ISO, fromisoformat no lo sabe leer,
salta al except y devuelve la cadena intacta. Funcionaban porque el
parseo fallaba.

Esa es la leccion de fondo: habia dos convenciones distintas conviviendo
y un numero fijo que acertaba con una y mentia con la otra. Un -5 escrito
a mano sobrevive a los cambios que lo invalidan, y nadie lo revisa porque
no falla: solo miente.

QUE HACE ESTE PARCHE
--------------------
Convertir por zona horaria en vez de restar. Mira si la fecha trae zona:

  - Con zona (venga en -05:00 o en UTC) -> se convierte a hora de Peru.
    Acierta con las dos, asi que deja de importar cual mande Django hoy
    y cual mande el dia que alguien lo cambie.
  - Sin zona -> se imprime tal cual, porque ya es hora local.
  - Que no sea ISO -> se devuelve intacta, como hasta ahora. Es lo que
    mantiene funcionando los avisos de incidentes.

NO SE USA ZoneInfo. Haria falta el paquete tzdata dentro de la imagen, y
una imagen slim no lo trae: ZoneInfo('America/Lima') reventaria en
produccion y el aviso se quedaria sin hora. Peru no tiene horario de
verano desde 1994 y no esta previsto que vuelva, asi que un desfase fijo
de -05:00 declarado como zona es exacto y no depende de nada instalado.
La diferencia con el codigo viejo no es el numero: es que ahora se
declara como zona del destino y se CONVIERTE, en vez de restarse a ciegas
a lo que llegue.

DEJA COPIA en main.py.bak_hora.
"""
from __future__ import print_function

import argparse
import os
import shutil
import sys

VIEJO = """def _fmt_human_datetime(value):
    raw = (value or '').strip()
    if not raw:
        return ''
    try:
        dt = datetime.fromisoformat(raw.replace('Z', '+00:00'))
        dt = dt + timedelta(hours=-5)
        return dt.strftime('%d/%m/%Y %H:%M:%S')
    except Exception:
        return raw"""

NUEVO = '''# Peru no usa horario de verano desde 1994, asi que su desfase es fijo.
# Se declara como zona para poder CONVERTIR a ella, que es distinto de
# restar: una conversion acierta venga la fecha en -05:00 o en UTC.
# No se usa ZoneInfo a proposito: necesitaria el paquete tzdata dentro de
# la imagen, y una imagen slim no lo trae.
HORA_PERU = timezone(timedelta(hours=-5))


def _fmt_human_datetime(value):
    """La fecha de un aviso, en hora de Peru.

    ANTES ESTO RESTABA CINCO HORAS SIEMPRE, mirara o no si la fecha ya
    traia zona horaria. Resultado: un aviso recibido a las 09:15 se
    anunciaba como de las 04:15, porque Django ya mandaba la hora local
    correcta y aqui se le quitaban cinco mas.

    Los avisos de incidentes se salvaban por accidente: llegan ya
    formateados como «14/11/2026 09:21:49», fromisoformat no sabe leer
    eso, saltaba al except y devolvia la cadena intacta. El ultimo
    `return raw` conserva ese comportamiento a proposito.
    """
    raw = (value or '').strip()
    if not raw:
        return ''
    try:
        dt = datetime.fromisoformat(raw.replace('Z', '+00:00'))
    except Exception:
        # No es ISO: ya viene formateada desde Django. Se deja como esta.
        return raw
    if dt.tzinfo is not None:
        dt = dt.astimezone(HORA_PERU)
    # Sin zona se asume que ya es hora local, que es lo que manda un
    # sistema configurado en America/Lima.
    return dt.strftime('%d/%m/%Y %H:%M:%S')'''

IMPORT_VIEJO = "from datetime import datetime, timedelta"
IMPORT_NUEVO = "from datetime import datetime, timedelta, timezone"


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("archivo", help="main.py del push_service")
    p.add_argument("--dry-run", action="store_true")
    args = p.parse_args()

    if not os.path.exists(args.archivo):
        print("no encuentro %s" % args.archivo, file=sys.stderr)
        return 2

    with open(args.archivo, encoding="utf-8") as f:
        s = f.read()

    if "HORA_PERU" in s:
        print("Ya esta aplicado.")
        return 0

    if s.count(VIEJO) != 1:
        print("No encuentro la funcion tal como esperaba.", file=sys.stderr)
        print("Puede que ya se haya tocado. Comparala a mano con:",
              file=sys.stderr)
        print("", file=sys.stderr)
        print(VIEJO, file=sys.stderr)
        return 1

    nuevo = s.replace(VIEJO, NUEVO)

    if IMPORT_NUEVO not in nuevo:
        if nuevo.count(IMPORT_VIEJO) != 1:
            print("No encuentro el import de datetime para ampliarlo.",
                  file=sys.stderr)
            return 1
        nuevo = nuevo.replace(IMPORT_VIEJO, IMPORT_NUEVO, 1)

    try:
        compile(nuevo, args.archivo, "exec")
    except SyntaxError as e:
        print("El resultado no compila (linea %s): %s" % (e.lineno, e.msg),
              file=sys.stderr)
        return 1
    print("OK  el resultado compila")

    if args.dry_run:
        print("")
        print("--- quedaria asi ---")
        print(NUEVO)
        print("")
        print("--dry-run: no se ha escrito nada.")
        return 0

    shutil.copy2(args.archivo, args.archivo + ".bak_hora")
    with open(args.archivo, "w", encoding="utf-8") as f:
        f.write(nuevo)
    print("escrito.  copia en %s.bak_hora" % args.archivo)
    print("")
    print("AHORA hay que reconstruir la imagen: el codigo de este servicio")
    print("va DENTRO de ella, no montado desde el disco.")
    print("")
    print("    cd /var/www/envs/prod")
    print("    docker compose build push_service")
    print("    docker compose up -d push_service")
    return 0


if __name__ == "__main__":
    sys.exit(main())
