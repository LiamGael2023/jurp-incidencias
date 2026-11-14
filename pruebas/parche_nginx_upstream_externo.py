# -*- coding: utf-8 -*-
"""Que un DNS ajeno no vuelva a tumbar la plataforma entera.

    cd /etc/nginx/sites-available
    curl -sO https://raw.githubusercontent.com/LiamGael2023/jurp-incidencias/<SHA>/pruebas/parche_nginx_upstream_externo.py
    sudo python3 parche_nginx_upstream_externo.py jurp-front --dry-run
    sudo python3 parche_nginx_upstream_externo.py jurp-front

QUE PASO EL 14/11/2026
----------------------
A las 06:32 UTC algo paro nginx para recargarlo -renovacion de
certificados o actualizacion desatendida-. Al arrancar, su comprobacion
de configuracion fallo:

    [emerg] host not found in upstream "innovat.com.pe"
            in /etc/nginx/sites-enabled/jurp-front:63

Nginx resuelve los nombres de los upstream AL ARRANCAR, y si uno falla no
arranca NINGUNO. Como es la puerta de entrada unica, cayo todo: la web,
el sistema y las APIs de los aplicativos moviles. Cinco horas y media,
hasta que alguien lo noto.

La causa fue un parpadeo del DNS de un tercero a la 1:32 de la madrugada.
Cuando se diagnostico, `nginx -t` ya daba correcto: el DNS habia vuelto.
Es decir, el fallo no deja rastro en la configuracion y es invisible
despues; solo queda el servicio caido.

QUE HACE ESTE PARCHE
--------------------
Pasar el nombre del upstream a una variable. Con una variable, nginx NO
lo resuelve al arrancar sino en cada peticion, para lo cual necesita una
directiva `resolver`.

El efecto practico: si manana Innova-T no resuelve, falla ESA peticion
con un 502 y el resto de la plataforma sigue en pie. Una estacion
meteorologica de un tercero no puede tumbar el sistema de riego.

EL `rewrite` NO ES OPCIONAL. Cuando `proxy_pass` lleva una variable,
nginx deja de sustituir el prefijo del `location` por la ruta de destino
-eso solo lo hace con un destino literal-. Sin el rewrite, /innovapi/x
llegaria a innovat.com.pe como /innovapi/x en vez de
/InnovaWeather/api/x, y todas las consultas devolverian 404. El rewrite
reconstruye a mano lo que antes hacia nginx solo.

ipv6=off: el resolver pregunta por A y AAAA. Si el destino publica una
direccion IPv6 a la que este servidor no llega, la peticion se queda
esperando. Para un servicio que se consume por IPv4, preguntar solo por
A es mas predecible.

SE COMPRUEBA ANTES DE DEJARLO. El guion ejecuta `nginx -t` sobre el
resultado y, si falla, restaura la copia y no recarga nada. Deja
siempre .bak_upstream.
"""
from __future__ import print_function

import argparse
import os
import re
import shutil
import subprocess
import sys

VIEJO = """    location /innovapi/ {
        proxy_pass https://innovat.com.pe/InnovaWeather/api/;
        proxy_ssl_server_name on;
        proxy_set_header Host innovat.com.pe;
        proxy_read_timeout 60s;
    }"""

NUEVO = """    location /innovapi/ {
        # EL NOMBRE VA EN UNA VARIABLE A PROPOSITO.
        #
        # Con un nombre literal, nginx lo resuelve AL ARRANCAR y, si falla,
        # no arranca ninguno de los sitios. El 14/11/2026 un parpadeo del
        # DNS de Innova-T a la 1:32 de la madrugada dejo a JURP sin web,
        # sin sistema y sin APIs moviles durante cinco horas y media.
        #
        # Con una variable, la resolucion se difiere a cada peticion: si
        # Innova-T no responde, falla ESTA peticion con un 502 y el resto
        # de la plataforma sigue en pie.
        #
        # El rewrite es obligatorio aqui: con una variable en proxy_pass,
        # nginx deja de sustituir el prefijo del location por la ruta de
        # destino, asi que hay que reconstruirla a mano. Sin el, todas las
        # consultas llegarian a /innovapi/... y devolverian 404.
        resolver 127.0.0.53 valid=300s ipv6=off;
        resolver_timeout 5s;
        set $innova "innovat.com.pe";
        rewrite ^/innovapi/(.*)$ /InnovaWeather/api/$1 break;
        proxy_pass https://$innova;
        proxy_ssl_server_name on;
        proxy_set_header Host innovat.com.pe;
        proxy_read_timeout 60s;
    }"""


def otros_upstreams_externos(carpeta):
    """Otros proxy_pass a nombres de fuera, que son la misma mina."""
    hallados = []
    if not os.path.isdir(carpeta):
        return hallados
    for nombre in sorted(os.listdir(carpeta)):
        ruta = os.path.join(carpeta, nombre)
        if not os.path.isfile(ruta):
            continue
        try:
            with open(ruta, encoding="utf-8", errors="replace") as f:
                for i, linea in enumerate(f, 1):
                    m = re.search(r"proxy_pass\s+https?://([^$;/\s]+)", linea)
                    if not m:
                        continue
                    destino = m.group(1)
                    # Lo local no da problemas: no se resuelve por DNS.
                    if re.match(r"^(127\.|0\.0\.0\.0|localhost|\[::1\]|unix:)", destino):
                        continue
                    if re.match(r"^\d+\.\d+\.\d+\.\d+(:\d+)?$", destino):
                        continue
                    hallados.append((nombre, i, destino))
        except OSError:
            pass
    return hallados


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("archivo", help="fichero de sites-available (p.ej. jurp-front)")
    p.add_argument("--dry-run", action="store_true")
    args = p.parse_args()

    if not os.path.exists(args.archivo):
        print("no encuentro %s" % args.archivo, file=sys.stderr)
        return 2

    with open(args.archivo, encoding="utf-8") as f:
        s = f.read()

    if "set $innova" in s:
        print("Ya esta aplicado.")
    else:
        n = s.count(VIEJO)
        if n != 1:
            print("Esperaba 1 aparicion del bloque y hay %d." % n, file=sys.stderr)
            print("La configuracion ha cambiado; no toco nada. Compara a mano:",
                  file=sys.stderr)
            print("", file=sys.stderr)
            print(VIEJO, file=sys.stderr)
            return 1

        nuevo = s.replace(VIEJO, NUEVO)

        if args.dry_run:
            print("--- quedaria asi ---")
            print(NUEVO)
            print("")
            print("--dry-run: no se ha escrito nada.")
        else:
            shutil.copy2(args.archivo, args.archivo + ".bak_upstream")
            with open(args.archivo, "w", encoding="utf-8") as f:
                f.write(nuevo)
            print("escrito.  copia en %s.bak_upstream" % args.archivo)

            r = subprocess.run(["nginx", "-t"], capture_output=True, text=True)
            if r.returncode != 0:
                shutil.copy2(args.archivo + ".bak_upstream", args.archivo)
                print("")
                print("nginx -t FALLO; se ha restaurado la copia y no se recarga.",
                      file=sys.stderr)
                print(r.stderr, file=sys.stderr)
                return 1
            print("OK  nginx -t correcto")
            print("")
            print("Para activarlo sin cortar servicio:")
            print("")
            print("    sudo systemctl reload nginx")

    # Avisar de los demas, aplique o no el parche.
    otros = otros_upstreams_externos("/etc/nginx/sites-enabled")
    externos = [x for x in otros if "innovat.com.pe" not in x[2]]
    print("")
    print("=" * 66)
    print("OTROS DESTINOS EXTERNOS EN proxy_pass")
    print("=" * 66)
    if not externos:
        print("    Ninguno mas. Este era el unico.")
    else:
        print("    Cada uno de estos puede impedir que nginx arranque si su")
        print("    DNS falla en ese instante. Conviene darles el mismo trato:")
        print("")
        for nombre, linea, destino in externos:
            print("      %-22s linea %-5s %s" % (nombre, linea, destino))
    return 0


if __name__ == "__main__":
    sys.exit(main())
