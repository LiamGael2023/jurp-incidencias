# -*- coding: utf-8 -*-
"""Los hosts que el backend lleva escritos y que la migración no cambia sola.

    cd /root/proyectos/api_vigilantes
    curl -sO https://raw.githubusercontent.com/LiamGael2023/jurp-incidencias/main/pruebas/ver_hosts_servidor.py
    docker compose exec web python manage.py shell < ver_hosts_servidor.py

NO TOCA NADA. Solo mira y avisa.

POR QUÉ ESTO NO SE VE PROBANDO LA WEB. El front ya apunta al servidor nuevo
y todo responde, pero hay dos sitios donde el host del servidor ANTIGUO
sigue escrito y de los que la web no sabe nada:

  URL_PUBLICA / ALLOWED_HOSTS
      De ahí sale la dirección de la imagen que viaja en la notificación al
      teléfono. Si apunta al servidor viejo, la notificación llega igual y
      la imagen da 404 EN EL TELÉFONO del vigilante; en la web no se nota.

  MAPA_NOTIFY_HOSTS
      Es la lista de sitios de los que se acepta una imagen para notificar.
      Si el host nuevo no está, publicar un aviso del mapa se RECHAZA: la
      función deja de funcionar del todo.

Las dos salieron del .env, que se copió tal cual del servidor viejo.
"""
from __future__ import print_function

import os
from django.conf import settings

VIEJOS = ('gideonstudio.duckdns.org',)

print("")
print("=" * 72)
print("HOSTS QUE EL BACKEND LLEVA ESCRITOS")
print("=" * 72)

problemas = []


def mirar(nombre, valor, pista):
    txt = ', '.join(valor) if isinstance(valor, (list, tuple)) else str(valor)
    malo = any(v in txt for v in VIEJOS)
    print("")
    print("  %s" % nombre)
    print("      %s" % (txt or '(sin definir)'))
    if malo:
        print("      ^^^ APUNTA AL SERVIDOR VIEJO")
        problemas.append((nombre, pista))
    return malo


mirar("ALLOWED_HOSTS", getattr(settings, "ALLOWED_HOSTS", []),
      "anade el host nuevo AL PRINCIPIO: de ahi sale la URL de la imagen\n"
      "      cuando URL_PUBLICA no esta definida")

pub = getattr(settings, "URL_PUBLICA", None) or os.environ.get("URL_PUBLICA")
mirar("URL_PUBLICA", pub,
      "ponla al host nuevo en el .env. Es lo que manda sobre ALLOWED_HOSTS,\n"
      "      asi que definirla zanja el asunto:\n"
      "      URL_PUBLICA=https://api.192.81.132.87.nip.io")

hosts = getattr(settings, "MAPA_NOTIFY_HOSTS", None) or os.environ.get("MAPA_NOTIFY_HOSTS")
if hosts is None:
    print("")
    print("  MAPA_NOTIFY_HOSTS")
    print("      (sin definir) -> se usa el valor por defecto del codigo,")
    print("      'gideonstudio.duckdns.org,sistema.jriegopresurizado.org.pe'")
    print("      ^^^ SIN EL HOST NUEVO: publicar un aviso del mapa se rechaza")
    problemas.append(("MAPA_NOTIFY_HOSTS",
                      "definela en el .env incluyendo el host nuevo:\n"
                      "      MAPA_NOTIFY_HOSTS=api.192.81.132.87.nip.io,"
                      "sistema.jriegopresurizado.org.pe"))
else:
    if not mirar("MAPA_NOTIFY_HOSTS", hosts,
                 "incluye el host nuevo o los avisos del mapa se rechazan"):
        if 'nip.io' not in str(hosts) and 'jriegopresurizado' not in str(hosts):
            print("      ^^^ no veo el host nuevo en la lista")
            problemas.append(("MAPA_NOTIFY_HOSTS", "anade el host nuevo"))

print("")
print("=" * 72)
if problemas:
    print("HAY QUE TOCAR %d COSA(S)" % len(problemas))
    print("=" * 72)
    for n, pista in problemas:
        print("")
        print("  %s" % n)
        print("      %s" % pista)
    print("")
    print("  Despues: docker compose up -d --no-deps --force-recreate web")
else:
    print("TODO APUNTA AL SERVIDOR NUEVO")
    print("=" * 72)
print("")
