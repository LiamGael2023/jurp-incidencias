# -*- coding: utf-8 -*-
"""Publicar la imagen no exige clave; hacer sonar los teléfonos sí.

    python3 parche_publicar_sin_clave.py              # solo muestra
    python3 parche_publicar_sin_clave.py --aplicar    # aplica, con respaldo

Se ejecuta EN EL SERVIDOR (api_vigilantes). Requiere haber aplicado antes
parche_notificar_mapa.py.

POR QUE SE SEPARAN. La clave está para proteger el push: son catorce
teléfonos de vigilantes reales y abrirlo a cualquiera sería un buzón de spam
con altavoz. Pero el enlace de WhatsApp no manda ninguna notificación: sube
con solo_publicar=1, guarda la imagen y devuelve su URL. Eso no despierta a
nadie, así que pedirle la misma credencial que al push es cobrar un peaje por
un puente que no se cruza.

LO QUE SE ACEPTA A CAMBIO, DICHO SIN ADORNOS. Queda un punto público donde
cualquiera puede dejar una imagen en el dominio de la Junta. No es gratis:

  - Se limita a 30 subidas por hora y por IP (abajo se explica por qué ese
    número no es exacto).
  - Siguen los límites que ya había: 8 MB y solo JPEG, PNG o WebP.
  - El nombre lo inventa el servidor, así que nadie escribe fuera de sitio.

Con eso el peor caso es que alguien llene disco despacio, y eso se ve. Si
aparece basura en /media/monitoreo/, el remedio es poner NOTIF_MAPA_CLAVE y
revertir esto: el respaldo queda al lado.

EL LIMITE NO ES EXACTO, y conviene saberlo antes de confiar en él. Se cuenta
en la caché de Django. Si no hay Redis ni memcached configurados, la caché es
de memoria y CADA proceso de gunicorn lleva su propia cuenta: con cuatro
trabajadores el límite real son 120 por hora, no 30. Sirve para frenar un
escaneo automático; no es una barrera dura.
"""

from __future__ import print_function, unicode_literals

import io
import os
import shutil
import sys
import time

APLICAR = "--aplicar" in sys.argv
RUTA_ARG = [a for a in sys.argv[1:] if not a.startswith("-")]
BASE = os.path.abspath(RUTA_ARG[0]) if RUTA_ARG else os.getcwd()
F = os.path.join(BASE, "operations", "views_notificaciones.py")

ANCLA_IMPORT = """import os
import uuid
from datetime import datetime

from django.conf import settings
"""
NUEVO_IMPORT = """import os
import uuid
from datetime import datetime

from django.conf import settings
from django.core.cache import cache
"""

ANCLA_LIMITE = '''TIPOS = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}
MAX_BYTES = 8 * 1024 * 1024
'''
NUEVO_LIMITE = '''TIPOS = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}
MAX_BYTES = 8 * 1024 * 1024

# Publicar una imagen no exige credencial, así que hay que ponerle un techo.
# El límite NO es exacto: se cuenta en la caché de Django y, si es la de
# memoria, cada proceso de gunicorn lleva la suya. Con cuatro trabajadores el
# límite real se multiplica por cuatro. Frena un escaneo automático; no es una
# barrera dura, y por eso el push sí pide clave.
SUBIDAS_POR_HORA = 30


def _ip(request):
    reenviada = request.META.get("HTTP_X_FORWARDED_FOR", "")
    if reenviada:
        return reenviada.split(",")[0].strip()
    return request.META.get("REMOTE_ADDR", "?")


def _paso_el_limite(request):
    """True si esta IP ya gastó su cuota de la hora."""
    clave = "subida_mapa:{0}".format(_ip(request))
    try:
        n = cache.get_or_set(clave, 0, 3600)
        cache.set(clave, n + 1, 3600)
        return n >= SUBIDAS_POR_HORA
    except Exception:
        # Si la caché falla, no se bloquea el servicio por el contador.
        return False
'''

ANCLA_AUTH = '''    if not _autorizado(request):
        return Response({
            "detail": "No autorizado. Inicia sesión, o define NOTIF_MAPA_CLAVE "
                      "en el servidor y mándala en la cabecera X-Notif-Clave.",
        }, status=status.HTTP_403_FORBIDDEN)

    archivo = request.FILES.get("imagen")'''
NUEVO_AUTH = '''    # Publicar SIN avisar. Lo usa el enlace de WhatsApp: ahí la imagen solo
    # necesita una URL pública, y hacer sonar catorce teléfonos de vigilantes
    # porque alguien quiso mandar una foto por WhatsApp sería un efecto
    # secundario que nadie pidió.
    solo = str(request.data.get("solo_publicar") or "").lower() in ("1", "true", "si", "s")

    # La credencial protege el PUSH, no el archivo. Publicar no despierta a
    # nadie, así que solo_publicar pasa sin ella —con su propio techo— y el
    # push sigue exigiéndola.
    if not solo and not _autorizado(request):
        return Response({
            "detail": "No autorizado para notificar. Define NOTIF_MAPA_CLAVE en "
                      "el servidor y mándala en la cabecera X-Notif-Clave. "
                      "(Publicar la imagen sin notificar sí está permitido: "
                      "manda solo_publicar=1.)",
        }, status=status.HTTP_403_FORBIDDEN)

    if solo and _paso_el_limite(request):
        return Response({
            "detail": "Demasiadas imágenes desde esta dirección en la última "
                      "hora. Espera un rato.",
        }, status=status.HTTP_429_TOO_MANY_REQUESTS)

    archivo = request.FILES.get("imagen")'''

# La lectura de solo_publicar que había más abajo ya no hace falta: ahora se
# lee arriba, antes de decidir si se exige credencial.
ANCLA_SOLO_VIEJO = '''    # Publicar SIN avisar. Lo usa el enlace de WhatsApp: ahí la imagen solo
    # necesita una URL pública, y hacer sonar catorce teléfonos de vigilantes
    # porque alguien quiso mandar una foto por WhatsApp sería un efecto
    # secundario que nadie pidió.
    solo = str(request.data.get("solo_publicar") or "").lower() in ("1", "true", "si", "s")

    titulo ='''
NUEVO_SOLO_VIEJO = '''    titulo ='''


def principal():
    if not os.path.isfile(F):
        print("No encuentro {0}.".format(F))
        print("¿Aplicaste antes parche_notificar_mapa.py?")
        sys.exit(1)

    txt = io.open(F, encoding="utf-8").read()

    print("Carpeta: {0}".format(BASE))
    print("")
    print("=" * 78)
    print("Publicar no exige clave; notificar sí")
    print("=" * 78)
    print("")

    fallos = []
    if "SUBIDAS_POR_HORA" in txt:
        fallos.append("ya tiene SUBIDAS_POR_HORA: parece aplicado")
    for nombre, ancla in (("los imports", ANCLA_IMPORT),
                          ("los límites", ANCLA_LIMITE),
                          ("el control de acceso", ANCLA_AUTH),
                          ("la lectura de solo_publicar", ANCLA_SOLO_VIEJO)):
        n = txt.count(ancla)
        if n != 1:
            fallos.append("{0}: el ancla aparece {1} veces (debería ser 1)".format(nombre, n))

    if fallos:
        print("NO SE APLICA NADA:")
        for f in fallos:
            print("  - {0}".format(f))
        sys.exit(1)

    print("  operations/views_notificaciones.py")
    print("    + solo_publicar=1 pasa SIN credencial (el enlace de WhatsApp)")
    print("    + el push sigue exigiendo sesión o X-Notif-Clave")
    print("    + techo de {0} subidas por hora y por IP".format(30))
    print("    + 429 con un mensaje que dice qué pasó")
    print("")

    nuevo = (txt.replace(ANCLA_IMPORT, NUEVO_IMPORT, 1)
                .replace(ANCLA_LIMITE, NUEVO_LIMITE, 1)
                .replace(ANCLA_SOLO_VIEJO, NUEVO_SOLO_VIEJO, 1)
                .replace(ANCLA_AUTH, NUEVO_AUTH, 1))

    try:
        compile(nuevo.encode("utf-8"), "views_notificaciones.py", "exec")
    except SyntaxError as e:
        print("NO SE ESCRIBE NADA: no compilaría ({0}, línea {1}).".format(e.msg, e.lineno))
        sys.exit(1)
    print("El archivo compila.")

    # Comprobación de sentido: 'solo' tiene que quedar definida ANTES de usarse.
    i_def = nuevo.index("solo = str(request.data.get")
    i_uso = nuevo.index("if not solo and not _autorizado")
    if i_def > i_uso:
        print("NO SE ESCRIBE NADA: 'solo' quedaría usada antes de definirse.")
        sys.exit(1)
    print("'solo' se define antes de usarse.")
    print("")

    if not APLICAR:
        print("Listo para aplicar. NADA se ha escrito.")
        print("Para aplicarlo:  python3 {0} --aplicar".format(
            os.path.basename(sys.argv[0])))
        sys.exit(0)

    if not os.access(F, os.W_OK):
        print("NO SE ESCRIBE NADA. Sin permiso en {0}".format(F))
        sys.exit(1)

    destino = F + ".bak"
    if os.path.exists(destino):
        destino = F + ".bak." + time.strftime("%Y%m%d-%H%M%S")
    shutil.copy2(F, destino)
    print("Respaldo: {0}".format(destino))
    io.open(F, "w", encoding="utf-8").write(nuevo)
    print("Escrito : {0}".format(F))

    print("")
    print("=" * 78)
    print("  docker compose up -d --no-deps --force-recreate web")
    print("")
    print("Y a probar desde la web: la casilla «mandar la imagen como enlace»")
    print("ya no debería dar 401.")
    print("")
    print("El push sigue sin poder mandarse hasta que definas NOTIF_MAPA_CLAVE")
    print("en el entorno del contenedor. Eso lo vemos cuando quieras.")
    print("=" * 78)


principal()
