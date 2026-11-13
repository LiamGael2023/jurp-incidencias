# -*- coding: utf-8 -*-
"""¿Qué campo rechaza el registro de avance de la app?

    cd /var/www/envs/vigilantes
    curl -sO https://raw.githubusercontent.com/LiamGael2023/jurp-incidencias/main/pruebas/ver_accion_incidente.py
    docker compose exec -T jurp_web python manage.py shell < ver_accion_incidente.py

    # si ese proyecto no se levanta con compose:
    docker exec -i jurp_web python manage.py shell < ver_accion_incidente.py

NO TOCA NADA. Valida en memoria y hace rollback de lo poco que prueba.

DE DÓNDE SALE ESTO
------------------
La app contesta «Error en el servidor: 400» al guardar un avance con fotos.
En nginx consta así:

    POST /api/v1/mobile/hi-incident-actions/ ... 400 92

Esos 92 bytes son `serializer.errors` de HIIncidentActionCreateSerializer:
el nombre del campo y su motivo. Django registra «Bad Request» sin el
cuerpo, así que en el log no aparece cuál es.

Esto lo saca por el otro lado: prueba contra el MISMO serializer los
cuerpos que la app puede estar mandando, imprime el error de cada uno y
mide cuántos bytes ocupa. El que mida 92 es el que está pasando.
"""
from __future__ import print_function

import json

from django.apps import apps as django_apps

from apps.hi_incidents.serializers import HIIncidentActionCreateSerializer

M = django_apps.get_model("hi_incidents", "HIIncidentAction")

print("")
print("=" * 72)
print("1. QUE EXIGE EL MODELO")
print("=" * 72)
EN_EL_SERIALIZER = ("incident", "name", "description", "latitude",
                    "longitude", "status", "images")
for f in M._meta.get_fields():
    if not hasattr(f, "attname") or f.name not in EN_EL_SERIALIZER:
        continue
    obligatorio = (not getattr(f, "null", True)
                   and not getattr(f, "blank", True)
                   and not getattr(f, "has_default", lambda: False)())
    print("    %-14s null=%-5s blank=%-5s default=%-5s  -> %s"
          % (f.name,
             getattr(f, "null", "?"),
             getattr(f, "blank", "?"),
             f.has_default() if hasattr(f, "has_default") else "?",
             "OBLIGATORIO" if obligatorio else "opcional"))

print("")
print("    Y lo que el serializer declara como requerido:")
s = HIIncidentActionCreateSerializer()
for nombre, campo in s.get_fields().items():
    print("    %-14s required=%s" % (nombre, campo.required))

print("")
print("    Valores que admite 'status':")
try:
    for valor, etiqueta in M._meta.get_field("status").choices:
        print("        %-12r %s" % (valor, etiqueta))
except Exception as e:
    print("        no he podido leerlos: %s" % e)

print("")
print("=" * 72)
print("2. QUE INCIDENTE SE ESTA USANDO")
print("=" * 72)
inc = M._meta.get_field("incident").related_model
ultimo = inc.objects.order_by("-id").first()
print("    incidentes: %s   el ultimo es #%s"
      % (inc.objects.count(), getattr(ultimo, "id", "-")))
IID = getattr(ultimo, "id", 1)

print("")
print("=" * 72)
print("3. LOS CUERPOS QUE LA APP PUEDE ESTAR MANDANDO")
print("=" * 72)
print("    (el que mida 92 bytes es el que esta fallando ahora mismo)")
print("")

TEXTO = ("DIA 11/11/26 Se concluyo con el Tramo N02 con la Conformacion "
         "de dique con material de prestamo en una longitud de")

# EL CUERPO LITERAL DE LA APP, copiado de incident_detail_page.dart:
#
#     {"incident": <int>, "description": "...", "status": "eat"}
#     + latitude/longitude como CADENA, con seis decimales
#     + images: [{"content": "<base64 sin prefijo>"}]
#
# Una foto comprimida a 800x800 con calidad 70 ronda los 60-120 KB, asi
# que su base64 pasa de 100.000 caracteres. Eso importa: si `content`
# tuviera un limite de longitud, mi prueba con una cadena de 31
# caracteres no lo habria encontrado nunca.
FOTO = "/9j/4AAQSkZJRgABAQAAAQABAAD" * 4000   # ~108 KB de base64
CORTA = "/9j/4AAQSkZJRgABAQAAAQABAAD"

CASOS = [
    ("EL DE LA APP, tal cual (3 fotos grandes)",
     {"incident": IID, "description": TEXTO, "status": "eat",
      "latitude": "-8.413000", "longitude": "-78.755000",
      "images": [{"content": FOTO}, {"content": FOTO}, {"content": FOTO}]}),
    ("el de la app, sin coordenadas (GPS no disponible)",
     {"incident": IID, "description": TEXTO, "status": "eat",
      "images": [{"content": FOTO}]}),
    ("el de la app, con fotos pequenas",
     {"incident": IID, "description": TEXTO, "status": "eat",
      "latitude": "-8.413000", "longitude": "-78.755000",
      "images": [{"content": CORTA}]}),
    ("solo cambiando status 'eat' por el primero valido",
     {"incident": IID, "description": TEXTO,
      "latitude": "-8.413000", "longitude": "-78.755000",
      "images": [{"content": CORTA}]}),
    ("sin fotos (por si el fallo esta en las imagenes)",
     {"incident": IID, "description": TEXTO, "status": "eat",
      "latitude": "-8.413000", "longitude": "-78.755000"}),
    ("coordenadas como numero en vez de cadena",
     {"incident": IID, "description": TEXTO, "status": "eat",
      "latitude": -8.413, "longitude": -78.755,
      "images": [{"content": CORTA}]}),
]

for titulo, datos in CASOS:
    ser = HIIncidentActionCreateSerializer(data=datos)
    ok = ser.is_valid()
    if ok:
        print("    %-52s VALIDA" % titulo)
        continue
    # Como lo serializa DRF al contestar, para que los bytes cuadren.
    cuerpo = json.dumps(ser.errors, ensure_ascii=False,
                        separators=(",", ":"))
    n = len(cuerpo.encode("utf-8"))
    marca = "  <<<< 92 BYTES: ES ESTE" if n == 92 else ""
    print("    %-52s %3d bytes%s" % (titulo, n, marca))
    print("        %s" % cuerpo)

print("")
print("=" * 72)
print("4. QUE SE HA GUARDADO HOY")
print("=" * 72)
print("    (si hoy no entro ninguna, lleva roto todo el dia)")
# OJO: Django viejo. `timezone.localtime()` sin argumento solo existe
# desde 1.11, y este proyecto corre sobre Python 3.5. Pasarle el valor
# funciona en las dos.
from django.utils import timezone
ahora = timezone.localtime(timezone.now())
hoy = ahora.date()
print("    acciones de incidente en total ..... %s" % M.objects.count())
print("    creadas hoy ........................ %s"
      % M.objects.filter(created_at__gte=hoy).count())
ultima = M.objects.order_by("-id").first()
if ultima and ultima.created_at:
    print("    la ultima .......................... #%s  %s"
          % (ultima.id, timezone.localtime(ultima.created_at)))
