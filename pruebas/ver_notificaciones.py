# -*- coding: utf-8 -*-
"""¿Con qué cuenta el backend para mandar una notificación push?

    docker compose exec -T web python manage.py shell < ver_notificaciones.py

SOLO LEE. No escribe, no migra, no manda ninguna notificación.

PARA QUE. El botón «Notificar a la app» del mapa ya está en la web y manda
un POST multipart a /notificaciones/mapa/ con la imagen, el título y el
cuerpo. Falta el lado del servidor, y para escribirlo sin adivinar hacen
falta cuatro cosas:

  1. SI ESTA firebase-admin (o pyfcm) instalado y con credenciales. Sin eso
     no hay push, y la credencial es lo que más suele faltar.

  2. DONDE ESTAN LOS TOKENS de los dispositivos. Una notificación se manda a
     un token FCM, no a un usuario: hay que saber qué tabla los guarda, cuántos
     hay y si están vivos. Si no hay tokens, el endpoint funcionaría y aun así
     no llegaría nada a ningún teléfono, que es la peor forma de fallar.

  3. SI YA HAY un envío de push en el código, para reusarlo en vez de escribir
     un segundo camino que se desincronice del primero.

  4. DONDE SE GUARDAN los archivos subidos (MEDIA_ROOT/MEDIA_URL) y si se
     sirven, porque FCM necesita una URL alcanzable para la imagen: el push
     lleva un enlace, no el PNG.

Al final dice qué falta y qué se puede dar por hecho.
"""

from __future__ import print_function

import os

from django.apps import apps
from django.conf import settings

print("")
print("=" * 74)
print("1. LIBRERIAS DE PUSH")
print("=" * 74)

tiene_fb = False
try:
    import firebase_admin  # noqa: F401
    from firebase_admin import messaging  # noqa: F401
    tiene_fb = True
    print("  firebase-admin : instalado   version {0}".format(
        getattr(firebase_admin, "__version__", "?")))
    try:
        apps_fb = firebase_admin._apps
        print("  inicializado   : {0}  ({1} app(s))".format(bool(apps_fb), len(apps_fb)))
        for nombre, a in (apps_fb or {}).items():
            print("      app '{0}' proyecto={1}".format(
                nombre, getattr(a, "project_id", "?")))
    except Exception as e:
        print("  no pude mirar las apps de firebase: {0}".format(e))
except ImportError:
    print("  firebase-admin : NO instalado")
    print("      pip install firebase-admin   (y anadirlo a requirements)")

try:
    import pyfcm  # noqa: F401
    print("  pyfcm          : instalado")
except ImportError:
    print("  pyfcm          : no instalado  (no hace falta si esta firebase-admin)")

print("")
print("  Credenciales en el entorno:")
for v in ("GOOGLE_APPLICATION_CREDENTIALS", "FIREBASE_CREDENTIALS",
          "FIREBASE_PROJECT_ID", "FCM_SERVER_KEY", "FIREBASE_SERVICE_ACCOUNT"):
    val = os.environ.get(v)
    if val:
        # Nunca se imprime el valor: una clave en un log es una clave filtrada.
        existe = os.path.exists(val) if "/" in val or "\\" in val else None
        extra = "" if existe is None else ("  (el archivo existe)" if existe
                                           else "  (OJO: el archivo NO existe)")
        print("      {0:<32s} definida, {1} caracteres{2}".format(v, len(val), extra))
    else:
        print("      {0:<32s} —".format(v))

print("")
print("=" * 74)
print("2. TOKENS DE DISPOSITIVO")
print("=" * 74)

candidatos = []
for m in apps.get_models():
    campos = [f.name.lower() for f in m._meta.get_fields() if hasattr(f, "name")]
    nombre = m.__name__.lower()
    if any(k in c for c in campos for k in ("fcm", "push_token", "device_token",
                                            "registration_id")) \
       or any(k in nombre for k in ("fcmdevice", "devicetoken", "pushtoken")):
        candidatos.append(m)

if not candidatos:
    print("  No encontre ningun modelo con pinta de guardar tokens FCM.")
    print("  Busca a mano como registra el token la app Flutter: sin tabla de")
    print("  tokens, el endpoint se puede escribir pero no llegara a nadie.")
else:
    for m in candidatos:
        campos = [f.name for f in m._meta.get_fields() if hasattr(f, "name")]
        try:
            n = m.objects.count()
        except Exception as e:
            n = "error: {0}".format(e)
        print("  {0}.{1}".format(m._meta.app_label, m.__name__))
        print("      tabla  : {0}".format(m._meta.db_table))
        print("      filas  : {0}".format(n))
        print("      campos : {0}".format(", ".join(campos[:14])))
        # ¿Cuantos tokens hay de verdad?
        for c in campos:
            if any(k in c.lower() for k in ("fcm", "token", "registration_id")):
                try:
                    vivos = m.objects.exclude(**{c: None}).exclude(**{c: ""}).count()
                    print("      con '{0}' no vacio: {1}".format(c, vivos))
                except Exception:
                    pass
        print("")

print("=" * 74)
print("3. ¿YA SE MANDA PUSH EN ALGUN SITIO?")
print("=" * 74)
import subprocess  # noqa: E402
try:
    r = subprocess.run(
        ["grep", "-rln", "--include=*.py", "-e", "firebase_admin", "-e", "messaging.send",
         "-e", "FCMDevice", "-e", "send_push", "."],
        cwd=str(settings.BASE_DIR), stdout=subprocess.PIPE, timeout=30)
    sal = r.stdout.decode("utf-8", "replace").strip()
    if sal:
        print("  Aparece en:")
        for l in sal.splitlines()[:20]:
            print("      {0}".format(l))
    else:
        print("  En ningun .py del proyecto. Habria que escribirlo de cero.")
except Exception as e:
    print("  no pude buscar: {0}".format(e))

print("")
print("=" * 74)
print("4. ARCHIVOS SUBIDOS")
print("=" * 74)
mr = str(getattr(settings, "MEDIA_ROOT", "") or "")
mu = str(getattr(settings, "MEDIA_URL", "") or "")
print("  MEDIA_ROOT : {0}".format(mr or "— sin definir"))
print("  MEDIA_URL  : {0}".format(mu or "— sin definir"))
if mr:
    print("  existe     : {0}   escribible: {1}".format(
        os.path.isdir(mr), os.access(mr, os.W_OK) if os.path.isdir(mr) else False))
print("  ALLOWED_HOSTS : {0}".format(getattr(settings, "ALLOWED_HOSTS", [])))
print("")
print("  FCM manda un ENLACE a la imagen, no la imagen. Asi que el PNG tiene")
print("  que quedar guardado en MEDIA_ROOT y servirse por una URL publica, o")
print("  la notificacion llegara sin foto.")

print("")
print("=" * 74)
print("QUE FALTA")
print("=" * 74)
falta = []
if not tiene_fb:
    falta.append("instalar firebase-admin")
if not any(os.environ.get(v) for v in
           ("GOOGLE_APPLICATION_CREDENTIALS", "FIREBASE_CREDENTIALS",
            "FIREBASE_SERVICE_ACCOUNT")):
    falta.append("una credencial de servicio de Firebase en el entorno")
if not candidatos:
    falta.append("una tabla de tokens FCM (y que la app los registre)")
if not mr:
    falta.append("MEDIA_ROOT, para guardar la imagen y poder enlazarla")
if falta:
    for f in falta:
        print("  - {0}".format(f))
else:
    print("  Nada: estan las piezas para escribir el endpoint.")
print("")
print("Nada se ha escrito.")
