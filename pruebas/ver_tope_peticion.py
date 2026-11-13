# -*- coding: utf-8 -*-
"""¿A partir de cuántos KB rechaza Django la petición, y por qué?

    cd /var/www/envs/vigilantes
    curl -sO https://raw.githubusercontent.com/LiamGael2023/jurp-incidencias/main/pruebas/ver_tope_peticion.py
    docker exec -i jurp_web python manage.py shell < ver_tope_peticion.py

NO ESCRIBE NADA: todas las peticiones de prueba son deliberadamente
inválidas en el campo `incident`, así que el serializer las rechaza y no
se crea ninguna acción. Lo que se mide es si la petición LLEGA a la
vista, no si se guarda.

QUÉ PASA
--------
El avance de la app viaja como JSON con las fotos en base64 dentro. Tres
fotos comprimidas a 800x800 son medio mega largo, y base64 añade un
tercio más. Django tiene un tope para el cuerpo de una petición
—`DATA_UPLOAD_MAX_MEMORY_SIZE`— y cuando se pasa contesta un 400 con su
página genérica, sin pisar la vista ni decir qué campo falló. Desde la
app eso se ve como «Error en el servidor: 400», igual que un error de
validación, y por eso despista tanto.

Esto imprime el tope configurado y prueba tamaños crecientes hasta dar
con el corte real.
"""
from __future__ import print_function

import base64
import json
import os

from django.apps import apps as django_apps
from django.conf import settings
from django.test import Client

Token = django_apps.get_model("authtoken", "Token")
RUTA = "/api/v1/mobile/hi-incident-actions/"

print("")
print("=" * 72)
print("1. LOS TOPES CONFIGURADOS")
print("=" * 72)
for nombre in ("DATA_UPLOAD_MAX_MEMORY_SIZE", "FILE_UPLOAD_MAX_MEMORY_SIZE",
               "DATA_UPLOAD_MAX_NUMBER_FIELDS"):
    v = getattr(settings, nombre, None)
    if v is None:
        print("    %-30s sin definir (vale el de Django)" % nombre)
    else:
        extra = "  = %.2f MB" % (v / 1048576.0) if "SIZE" in nombre else ""
        print("    %-30s %s%s" % (nombre, v, extra))

print("")
print("    Para referencia, los de Django por defecto:")
print("    DATA_UPLOAD_MAX_MEMORY_SIZE    2621440  = 2.50 MB")
print("    FILE_UPLOAD_MAX_MEMORY_SIZE    2621440  = 2.50 MB")

print("")
print("=" * 72)
print("2. DONDE ESTA EL CORTE DE VERDAD")
print("=" * 72)

tok = Token.objects.order_by("-created").first()
if tok is None:
    print("    No hay tokens en la base; no se puede probar autenticado.")
    raise SystemExit(1)

c = Client()


def probar(kb):
    """Una peticion de ~kb kilobytes. `incident` invalido a proposito:
    si llega a la vista, el serializer la rechaza con un 400 en JSON y
    no se crea nada. Lo que distingue un caso del otro es el CUERPO de
    la respuesta, no el codigo."""
    relleno = base64.b64encode(os.urandom(int(kb * 1024 * 0.74))).decode("ascii")
    cuerpo = json.dumps({
        "incident": 999999999,
        "description": "medicion de tope",
        "status": "eat",
        "images": [{"content": relleno}],
    })
    r = c.post(RUTA, data=cuerpo, content_type="application/json",
               HTTP_AUTHORIZATION="Token %s" % tok.key)
    texto = r.content.decode("utf-8", "replace")
    # La pagina generica de Django no es JSON; la del serializer si.
    llego = texto.lstrip().startswith("{")
    return len(cuerpo), r.status_code, llego, texto[:90]


print("    %10s %7s %-8s %s" % ("CUERPO", "HTTP", "LLEGO?", "RESPUESTA"))
corte_ok = None
corte_mal = None
for kb in (50, 100, 200, 400, 600, 900, 1400, 2000, 2600, 3200):
    n, codigo, llego, texto = probar(kb)
    print("    %7.0f KB %7s %-8s %s"
          % (n / 1024.0, codigo, "si" if llego else "NO", texto.replace("\n", " ")))
    if llego:
        corte_ok = n
    elif corte_mal is None:
        corte_mal = n

print("")
if corte_mal is None:
    print("    Ningun tamano probado fue rechazado antes de la vista.")
    print("    El tope no es el problema: mira nginx (client_max_body_size).")
else:
    print("    Ultimo tamano que SI llego a la vista:  %.0f KB"
          % ((corte_ok or 0) / 1024.0))
    print("    Primero que NO llego:                   %.0f KB"
          % (corte_mal / 1024.0))
    print("")
    print("    El avance de la app ronda los 560 KB con tres fotos.")
    print("    Si el corte esta por debajo de eso, ahi tienes la causa.")

print("")
print("=" * 72)
print("3. Y NGINX")
print("=" * 72)
print("    Django no es el unico con tope. Comprueba tambien, fuera del")
print("    contenedor:")
print("")
print("        grep -rn client_max_body_size /etc/nginx/")
print("")
print("    Sin esa directiva, nginx corta en 1 MB y contesta 413.")
