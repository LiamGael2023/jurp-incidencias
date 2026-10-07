# -*- coding: utf-8 -*-
"""Donde guarda PLUVIRA los tokens de sus telefonos, y si ya manda push.

EN EL LINODE (45.33.106.197), dentro de /var/www/envs/prod:

    python manage.py shell < ver_push_pluvira.py

SOLO LEE. No escribe, no migra, no manda ninguna notificacion, no reinicia
nada. Importa decirlo porque en ese servidor hay procesos en marcha -el
davis_worker, entre otros- y nada de esto los toca.

ESCRITO PARA PYTHON 3.5. Sin f-strings, sin nada posterior: ese entorno es
viejo y un print bonito que no compila no informa de nada.

PARA QUE. El aviso del mapa llego a los telefonos de los VIGILANTES, porque
los unicos tokens que hay en Contabo son los de esa app (SENTRIA). Los de
PLUVIRA estan aqui. Antes de escribir el puente hacen falta tres datos:

  1. QUE MODELO guarda los tokens y cuantos hay vivos. Sin tokens, cualquier
     puente que se escriba entregaria a nadie.

  2. SI ESTE SERVIDOR YA MANDA PUSH y con que. Si ya hay un emisor, el aviso
     del mapa debe salir por ahi y no por un segundo camino en paralelo.

  3. DE QUE PROYECTO DE FIREBASE son esos tokens. Esta es la que decide la
     arquitectura: un token pertenece a un proyecto, y las credenciales de
     Contabo solo sirven si es el MISMO proyecto. Si son distintos, el push a
     PLUVIRA tiene que salir desde aqui, no desde alla.
"""

from __future__ import print_function

import os
import re

try:
    from django.conf import settings
except Exception as e:
    print("No pude importar settings: {0}".format(e))
    raise SystemExit(1)

BASE = str(getattr(settings, "BASE_DIR", os.getcwd()))

print("")
print("=" * 72)
print("0. DONDE ESTAMOS")
print("=" * 72)
print("  BASE_DIR : {0}".format(BASE))
import sys  # noqa: E402
print("  python   : {0}".format(sys.version.split()[0]))
try:
    import django
    print("  django   : {0}".format(django.get_version()))
except Exception:
    pass

print("")
print("=" * 72)
print("1. MODELOS QUE GUARDAN TOKENS")
print("=" * 72)
try:
    from django.apps import apps
    encontrados = []
    for m in apps.get_models():
        campos = []
        for f in m._meta.get_fields():
            if hasattr(f, "name"):
                campos.append(f.name.lower())
        nombre = m.__name__.lower()
        pinta = any(k in c for c in campos
                    for k in ("fcm", "push_token", "device_token",
                              "registration_id", "token_dispositivo"))
        pinta = pinta or any(k in nombre for k in
                             ("fcmdevice", "devicetoken", "pushtoken",
                              "dispositivo", "device"))
        if pinta:
            encontrados.append(m)

    if not encontrados:
        print("  Ninguno con pinta de guardar tokens FCM.")
        print("  Puede que PLUVIRA no registre token todavia: entonces no hay")
        print("  a quien avisar y el trabajo empieza en la app Flutter.")
    for m in encontrados:
        campos = [f.name for f in m._meta.get_fields() if hasattr(f, "name")]
        try:
            n = m.objects.count()
        except Exception as e:
            n = "error: {0}".format(e)
        print("")
        print("  {0}.{1}".format(m._meta.app_label, m.__name__))
        print("      tabla  : {0}".format(m._meta.db_table))
        print("      filas  : {0}".format(n))
        print("      campos : {0}".format(", ".join(campos[:14])))
        for c in campos:
            if any(k in c.lower() for k in ("fcm", "token", "registration")):
                try:
                    vivos = m.objects.exclude(**{c: None}).exclude(**{c: ""}).count()
                    print("      con '{0}' no vacio: {1}".format(c, vivos))
                except Exception:
                    pass
        try:
            uno = m.objects.order_by("-id").first()
        except Exception:
            uno = None
        if uno is not None:
            print("      el mas reciente:")
            for c in campos[:10]:
                try:
                    v = getattr(uno, c, None)
                except Exception:
                    continue
                s = str(v)
                # El token se recorta: es una credencial de envio.
                if any(k in c.lower() for k in ("token", "registration")) and len(s) > 18:
                    s = s[:10] + "..." + s[-6:] + "  ({0} caracteres)".format(len(s))
                print("          {0:<20s} {1}".format(c, s[:60]))
except Exception as e:
    print("  no pude recorrer los modelos: {0}".format(e))

print("")
print("=" * 72)
print("2. ESTE SERVIDOR, ¿YA MANDA PUSH?")
print("=" * 72)
patrones = ["firebase_admin", "messaging.send", "fcm", "FCM",
            "googleapis.com/fcm", "send_push", "push_notification",
            "pyfcm", "legacy"]
hallados = {}
for raiz, dirs, archivos in os.walk(BASE):
    dirs[:] = [d for d in dirs
               if d not in (".git", "__pycache__", "node_modules", "media",
                            "static", "venv", ".venv", "site-packages")]
    for a in archivos:
        if not a.endswith(".py"):
            continue
        ruta = os.path.join(raiz, a)
        try:
            f = open(ruta)
            txt = f.read()
            f.close()
        except Exception:
            continue
        for p in patrones:
            if p in txt:
                hallados.setdefault(os.path.relpath(ruta, BASE), set()).add(p)

if not hallados:
    print("  En ningun .py del proyecto. Habria que escribirlo de cero aqui,")
    print("  o mandar desde Contabo si el proyecto de Firebase es el mismo.")
else:
    for ruta in sorted(hallados):
        print("  {0}".format(ruta))
        print("      {0}".format(", ".join(sorted(hallados[ruta]))))

print("")
print("  Librerias instaladas:")
for mod in ("firebase_admin", "pyfcm", "requests"):
    try:
        __import__(mod)
        m = sys.modules[mod]
        print("      {0:<16s} si   {1}".format(mod, getattr(m, "__version__", "")))
    except ImportError:
        print("      {0:<16s} no".format(mod))

print("")
print("=" * 72)
print("3. DE QUE PROYECTO DE FIREBASE")
print("=" * 72)
print("  Esta es la que decide la arquitectura: un token pertenece a UN")
print("  proyecto, y la credencial de Contabo solo sirve si es el mismo.")
print("")
vistos = []
for raiz, dirs, archivos in os.walk(BASE):
    dirs[:] = [d for d in dirs
               if d not in (".git", "__pycache__", "node_modules", "media",
                            "static", "venv", ".venv", "site-packages")]
    for a in archivos:
        if a.endswith(".json") and any(k in a.lower() for k in
                                       ("firebase", "credential", "service",
                                        "adminsdk", "google")):
            vistos.append(os.path.join(raiz, a))

if not vistos:
    print("  No hay ningun .json con pinta de credencial de servicio aqui.")
else:
    import json
    for v in vistos[:5]:
        try:
            f = open(v)
            d = json.load(f)
            f.close()
        except Exception as e:
            print("  {0}: no pude leerlo ({1})".format(os.path.relpath(v, BASE), e))
            continue
        # Nunca se imprime la clave privada; solo que identifica el proyecto.
        print("  {0}".format(os.path.relpath(v, BASE)))
        print("      project_id   : {0}".format(d.get("project_id", "—")))
        print("      client_email : {0}".format(d.get("client_email", "—")))
        print("      tiene clave privada: {0}".format("private_key" in d))

print("")
print("  En el entorno:")
for k in ("FIREBASE_CREDENTIALS", "GOOGLE_APPLICATION_CREDENTIALS",
          "FIREBASE_PROJECT_ID", "FCM_SERVER_KEY"):
    val = os.environ.get(k)
    if val:
        print("      {0:<30s} definida ({1} caracteres)".format(k, len(val)))
    else:
        print("      {0:<30s} —".format(k))

# El google-services.json de la app Flutter tambien lleva el proyecto, y a
# veces esta copiado en el repo del backend.
print("")
print("  Y por si hay un google-services.json cerca:")
hay = False
for raiz, dirs, archivos in os.walk(BASE):
    dirs[:] = [d for d in dirs if d not in (".git", "__pycache__", "node_modules")]
    for a in archivos:
        if a in ("google-services.json", "GoogleService-Info.plist"):
            print("      {0}".format(os.path.relpath(os.path.join(raiz, a), BASE)))
            hay = True
if not hay:
    print("      no hay")

print("")
print("Nada se ha escrito. Ningun proceso tocado.")
