# -*- coding: utf-8 -*-
"""Manda el POST del avance igual que la app y enseña la respuesta entera.

    cd /var/www/envs/vigilantes
    curl -sO https://raw.githubusercontent.com/LiamGael2023/jurp-incidencias/main/pruebas/probar_avance_real.py
    docker exec -i jurp_web python manage.py shell < probar_avance_real.py

POR QUÉ ESTO Y NO OTRA VALIDACIÓN MÁS
-------------------------------------
El cuerpo de la app PASA el serializer: probado campo por campo. Y aun
así nginx registra `400 92`. Así que algo lo rechaza por el camino, y eso
no se ve validando en memoria: hay que hacer la petición de verdad.

EL HOST IMPORTA, y de aquí salió una pista falsa. El cliente de pruebas
de Django manda `testserver` como cabecera Host; si no está en
ALLOWED_HOSTS, Django contesta 400 con su página genérica ANTES de mirar
nada más. Da el mismo 400 con 49 KB que con 3 MB, lo que hace creer en un
tope de tamaño que no existe. Por eso aquí se manda el dominio real,
sacado de la propia configuración.

LA HACE DESDE DENTRO DEL CONTENEDOR, contra 127.0.0.1:8000, saltándose
nginx. Si aquí sale 201 y desde el teléfono sale 400, el que rechaza es
nginx y no Django, que es justo lo que hay que saber para no perder otra
hora.

EL TOKEN NO SE IMPRIME. Se lee de la base y se usa; no aparece en la
terminal ni en ningún log. Un token en una captura de pantalla es una
sesión regalada.

SÍ ESCRIBE, y por eso lo dice antes y lo deshace después: si la petición
funciona se crea una acción de verdad, y el guion la marca como borrada
acto seguido y te dice cuál fue. Es la única forma de saber qué contesta
el servidor a lo mismo que manda el teléfono.
"""
from __future__ import print_function

import base64
import json
import os

from django.apps import apps as django_apps
from django.test import Client

M = django_apps.get_model("hi_incidents", "HIIncidentAction")
Token = django_apps.get_model("authtoken", "Token")

RUTA = "/api/v1/mobile/hi-incident-actions/"

# El dominio real, sacado de la propia configuracion. Ver nota de arriba.
from django.conf import settings as _s
_permitidos = [h for h in getattr(_s, "ALLOWED_HOSTS", []) if h not in ("*",)]
HOST_PRUEBA = _permitidos[0] if _permitidos else "sistema.jriegopresurizado.org.pe"

print("")
print("=" * 72)
print("PETICION REAL, LA MISMA QUE MANDA LA APP")
print("=" * 72)

# Un usuario con token. Se prefiere el del último que haya entrado desde
# la app, para usar exactamente los mismos permisos que el inspector.
tok = Token.objects.select_related("user").order_by("-created").first()
if tok is None:
    print("    No hay ningun token en la base: sin eso no se puede")
    print("    reproducir la peticion autenticada.")
    raise SystemExit(1)
print("    usuario de la prueba: %s   (el token no se imprime)" % tok.user)

inc = M._meta.get_field("incident").related_model
ultimo = inc.objects.order_by("-id").first()
IID = ultimo.id
print("    incidente: #%s" % IID)
print("    host: %s" % HOST_PRUEBA)

# Tres fotos del tamaño real: 800x800 a calidad 70 ronda los 100-150 KB,
# y en base64 crece un tercio. El tamaño es justo lo que no se puede
# imitar con una cadena corta.
foto = base64.b64encode(os.urandom(140 * 1024)).decode("ascii")
payload = {
    "incident": IID,
    "description": ("PRUEBA TECNICA probar_avance_real.py - "
                    "si ves esto en la bitacora, avisa: deberia estar "
                    "marcada como borrada."),
    "status": "eat",
    "latitude": "-8.413000",
    "longitude": "-78.755000",
    "images": [{"content": foto}, {"content": foto}, {"content": foto}],
}
cuerpo = json.dumps(payload)
print("    tamano del cuerpo: %.1f KB  (3 fotos)" % (len(cuerpo) / 1024.0))

antes = set(M.objects.values_list("id", flat=True))

c = Client()
r = c.post(RUTA, data=cuerpo, content_type="application/json",
           HTTP_AUTHORIZATION="Token %s" % tok.key,
               HTTP_HOST=HOST_PRUEBA)

print("")
print("    -> HTTP %s" % r.status_code)
contenido = r.content.decode("utf-8", "replace")
print("    -> %s bytes de respuesta" % len(r.content))
print("")
print("    %s" % contenido[:1500])

print("")
print("=" * 72)
print("LIMPIEZA")
print("=" * 72)
nuevas = set(M.objects.values_list("id", flat=True)) - antes
if not nuevas:
    print("    No se creo ninguna accion: no hay nada que deshacer.")
else:
    for i in nuevas:
        a = M.objects.get(id=i)
        if hasattr(a, "is_deleted"):
            a.is_deleted = True
            a.save(update_fields=["is_deleted"])
            print("    accion #%s creada por la prueba -> marcada como borrada" % i)
        else:
            print("    accion #%s creada por la prueba; el modelo no tiene" % i)
            print("    `is_deleted`, asi que BORRALA A MANO desde el admin.")

print("")
print("    Si arriba salio 201, Django y el serializer estan bien y el")
print("    400 lo pone nginx o el propio telefono. Si salio 400, el")
print("    cuerpo de la respuesta de arriba dice por que.")
