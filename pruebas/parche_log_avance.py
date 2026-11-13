# -*- coding: utf-8 -*-
"""Que el servidor diga en el log por qué rechaza un avance.

    cd /var/www/envs/vigilantes
    docker cp jurp_web:/app/src/apps/api/views/hi_incidents.py .
    curl -sO https://raw.githubusercontent.com/LiamGael2023/jurp-incidencias/main/pruebas/parche_log_avance.py
    python3 parche_log_avance.py hi_incidents.py --dry-run
    python3 parche_log_avance.py hi_incidents.py
    docker cp hi_incidents.py jurp_web:/app/src/apps/api/views/hi_incidents.py
    docker restart jurp_web

PARA QUÉ
--------
La app contesta «Error en el servidor: 400» y nada más: el cuerpo de la
respuesta —que dice QUÉ campo falló— se pierde, porque la app solo
enseña el código. Desde el servidor tampoco se ve: Django registra «Bad
Request» sin el detalle.

Resultado: el mismo cuerpo que manda la app pasa el serializer en una
prueba, entra por nginx con 201 en otra, y en el teléfono da 400. La
diferencia está en algo que solo el teléfono manda, y para verlo hay que
registrarlo cuando ocurre.

Esto añade una línea de log con los errores del serializer y desde qué
IP vino. Nada más: ni cambia la respuesta, ni toca la validación.

QUITARLO DESPUÉS. Es un diagnóstico, no una mejora. Deja una copia en
.bak_log para poder volver atrás, y el mensaje lleva la marca
[avance-400] para encontrarlo y borrarlo.
"""
from __future__ import print_function

import argparse
import os
import shutil
import sys

VIEJO = """        serializer = HIIncidentActionCreateSerializer(data=request.data, context={'request': request})
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
"""

NUEVO = """        serializer = HIIncidentActionCreateSerializer(data=request.data, context={'request': request})
        if not serializer.is_valid():
            # [avance-400] DIAGNOSTICO TEMPORAL - quitar cuando se resuelva.
            # El 400 llega al telefono como un numero y la razon se pierde
            # por el camino: la app solo enseña el codigo y Django registra
            # "Bad Request" sin el detalle. Esta linea deja en el log que
            # campo fallo y desde donde vino.
            try:
                import logging
                logging.getLogger('django.request').warning(
                    '[avance-400] %s claves=%s errores=%s',
                    request.META.get('REMOTE_ADDR', '?'),
                    sorted(request.data.keys()) if hasattr(request.data, 'keys') else type(request.data),
                    dict(serializer.errors))
            except Exception:
                pass
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
"""


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("archivo")
    p.add_argument("--dry-run", action="store_true")
    args = p.parse_args()

    if not os.path.exists(args.archivo):
        print("no encuentro %s" % args.archivo, file=sys.stderr)
        return 2

    with open(args.archivo, encoding="utf-8") as f:
        s = f.read()

    if "[avance-400]" in s:
        print("Ya esta puesto.")
        return 0

    n = s.count(VIEJO)
    if n != 1:
        print("Esperaba 1 aparicion del bloque y hay %d." % n, file=sys.stderr)
        print("La vista ha cambiado; no toco nada.", file=sys.stderr)
        return 1

    nuevo = s.replace(VIEJO, NUEVO)
    try:
        compile(nuevo, args.archivo, "exec")
    except SyntaxError as e:
        print("El resultado no compila (linea %s): %s" % (e.lineno, e.msg),
              file=sys.stderr)
        return 1
    print("OK  el resultado compila")

    if args.dry_run:
        print("--dry-run: no se ha escrito nada.")
        return 0

    shutil.copy2(args.archivo, args.archivo + ".bak_log")
    with open(args.archivo, "w", encoding="utf-8") as f:
        f.write(nuevo)
    print("escrito.  copia en %s.bak_log" % args.archivo)
    print("")
    print("Ahora: docker cp al contenedor y reiniciarlo. Despues, que el")
    print("inspector reintente y mira:")
    print("")
    print("    docker logs --since 10m jurp_web 2>&1 | grep avance-400")
    return 0


if __name__ == "__main__":
    sys.exit(main())
