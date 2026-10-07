# -*- coding: utf-8 -*-
"""Lo que falta ver: el emisor FCM que YA existe y el modelo de dispositivos.

    docker compose exec -T web python manage.py shell < ver_fcm_detalle.py

SOLO LEE. No escribe, no migra, no manda ninguna notificación.

POR QUE ESTE SEGUNDO VISTAZO. El primero encontró auth_api/fcm_sender.py y un
'dispositivos_fcm' colgando de User, o sea que el envío de push ya está
escrito y los teléfonos ya registran su token. Eso cambia el trabajo: no hay
que inventar un camino nuevo, hay que llamar al que hay.

Pero para llamarlo bien hace falta saber tres cosas que no se pueden suponer:

  1. QUE FUNCIONES expone fcm_sender y con qué firma. Escribir un segundo
     emisor en paralelo es la forma segura de que dentro de un mes uno de los
     dos deje de funcionar y nadie sepa cuál.

  2. COMO SE INICIALIZA firebase-admin ahí dentro. El primer vistazo dijo
     'inicializado: False', pero eso puede ser simplemente que nadie lo ha
     llamado todavía en este proceso. Si la credencial está en un archivo del
     repo o del contenedor, se ve aquí.

  3. EL MODELO de dispositivos: cómo se llama, cuántos tokens hay vivos y a
     qué usuarios pertenecen. Un endpoint que funciona pero no tiene a quién
     escribirle es un endpoint que miente.
"""

from __future__ import print_function

import io
import os
import re

from django.apps import apps
from django.conf import settings

BASE = str(settings.BASE_DIR)

print("")
print("=" * 74)
print("1. auth_api/fcm_sender.py")
print("=" * 74)

ruta = os.path.join(BASE, "auth_api", "fcm_sender.py")
if not os.path.isfile(ruta):
    print("  No está en {0}".format(ruta))
else:
    txt = io.open(ruta, encoding="utf-8", errors="replace").read()
    print("  {0} líneas, {1} bytes".format(txt.count("\n") + 1, len(txt)))
    print("")
    print("  Funciones y clases:")
    for m in re.finditer(r"^(?:async\s+)?(def|class)\s+(\w+)\s*\(([^)]*)\)",
                         txt, re.M):
        firma = " ".join(m.group(3).split())
        print("      {0} {1}({2})".format(m.group(1), m.group(2), firma[:90]))

    print("")
    print("  Cómo inicializa firebase:")
    for linea in txt.splitlines():
        s = linea.strip()
        if any(k in s for k in ("initialize_app", "certificate", "Certificate",
                                "credentials", "ApplicationDefault",
                                "GOOGLE_APPLICATION", "service_account",
                                ".json", "get_app")):
            # Se recorta por si alguien dejó una clave en una línea: no se
            # imprime una credencial en un log.
            if len(s) > 120:
                s = s[:117] + "..."
            print("      {0}".format(s))

    print("")
    print("  ¿Sabe mandar imagen?")
    for k in ("image", "imageUrl", "image_url", "Notification(", "AndroidConfig",
              "APNS", "data=", "topic"):
        n = txt.count(k)
        if n:
            print("      '{0}' aparece {1} vez/veces".format(k, n))

    print("")
    print("  ── EL ARCHIVO ENTERO ─────────────────────────────────────────")
    for i, linea in enumerate(txt.splitlines(), 1):
        # Nunca se imprime algo con pinta de clave privada.
        if any(k in linea for k in ("PRIVATE KEY", "private_key", "BEGIN RSA")):
            print("  {0:4d}| <línea con pinta de clave privada, omitida>".format(i))
            continue
        print("  {0:4d}| {1}".format(i, linea[:150]))

print("")
print("=" * 74)
print("2. EL MODELO DE DISPOSITIVOS")
print("=" * 74)

try:
    from django.contrib.auth.models import User
    campo = User._meta.get_field("dispositivos_fcm")
    Modelo = campo.related_model
    print("  {0}.{1}   tabla {2}".format(
        Modelo._meta.app_label, Modelo.__name__, Modelo._meta.db_table))
    print("")
    print("  Campos:")
    for f in Modelo._meta.get_fields():
        if not hasattr(f, "get_internal_type"):
            continue
        print("      {0:<22s} {1}".format(f.name, f.get_internal_type()))

    total = Modelo.objects.count()
    print("")
    print("  filas : {0}".format(total))

    # ¿Cuántos tokens sirven de verdad?
    nombres = [f.name for f in Modelo._meta.get_fields()
               if hasattr(f, "get_internal_type")]
    for c in nombres:
        if any(k in c.lower() for k in ("token", "registration")):
            vivos = Modelo.objects.exclude(**{c: None}).exclude(**{c: ""}).count()
            print("  con '{0}' no vacío : {1}".format(c, vivos))
    if "activo" in nombres:
        print("  activos           : {0}".format(Modelo.objects.filter(activo=True).count()))
    if "plataforma" in nombres:
        from django.db.models import Count
        for fila in (Modelo.objects.values("plataforma")
                     .annotate(n=Count("id")).order_by("-n")):
            print("      {0:<12s} {1}".format(str(fila["plataforma"]), fila["n"]))
    if "usuario" in nombres or "user" in nombres:
        c = "usuario" if "usuario" in nombres else "user"
        print("  usuarios distintos: {0}".format(
            Modelo.objects.values(c).distinct().count()))

    if total:
        uno = Modelo.objects.order_by("-id").first()
        print("")
        print("  El más reciente:")
        for f in nombres[:12]:
            try:
                v = getattr(uno, f, None)
            except Exception:
                continue
            s = str(v)
            # El token se recorta: es una credencial de envío.
            if any(k in f.lower() for k in ("token", "registration")) and len(s) > 18:
                s = s[:10] + "…" + s[-6:] + "  ({0} caracteres)".format(len(s))
            print("      {0:<22s} {1}".format(f, s[:70]))
except Exception as e:
    print("  no pude llegar al modelo: {0}: {1}".format(type(e).__name__, e))

print("")
print("=" * 74)
print("3. DONDE SE LLAMA AL EMISOR")
print("=" * 74)
import subprocess  # noqa: E402
try:
    r = subprocess.run(["grep", "-rn", "--include=*.py", "fcm_sender", "."],
                       cwd=BASE, stdout=subprocess.PIPE, timeout=30)
    sal = r.stdout.decode("utf-8", "replace").strip()
    for l in (sal.splitlines() or ["  (en ningún sitio más)"])[:25]:
        print("  {0}".format(l[:150]))
except Exception as e:
    print("  no pude buscar: {0}".format(e))

print("")
print("=" * 74)
print("4. ¿SE SIRVEN LOS ARCHIVOS DE /media/?")
print("=" * 74)
print("  Un push lleva el ENLACE a la imagen, no la imagen. Si /media/ no se")
print("  sirve hacia fuera, la notificación llega sin foto y el enlace de")
print("  WhatsApp no abre nada.")
print("")
try:
    archivos = []
    for raiz, _d, f in os.walk(str(settings.MEDIA_ROOT)):
        for x in f:
            archivos.append(os.path.join(raiz, x))
        if len(archivos) > 400:
            break
    print("  archivos ya guardados en MEDIA_ROOT: {0}".format(len(archivos)))
    if archivos:
        rel = os.path.relpath(archivos[0], str(settings.MEDIA_ROOT))
        print("")
        print("  Comprueba desde FUERA del servidor que este se ve:")
        print("      https://gideonstudio.duckdns.org{0}{1}".format(
            settings.MEDIA_URL, rel.replace(os.sep, "/")))
except Exception as e:
    print("  no pude mirar MEDIA_ROOT: {0}".format(e))

print("")
print("Nada se ha escrito.")
