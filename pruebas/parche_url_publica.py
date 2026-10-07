# -*- coding: utf-8 -*-
"""La URL de la imagen sale de la configuración, no de la petición.

    python3 parche_url_publica.py              # solo muestra
    python3 parche_url_publica.py --aplicar    # aplica, con respaldo

Se ejecuta EN EL SERVIDOR (api_vigilantes). Requiere parche_notificar_mapa.py.

EL FALLO. El enlace llegaba a WhatsApp apuntando a

    https://jurp-incidencias.vercel.app/media/monitoreo/...

y daba 404, porque la imagen está en gideonstudio.duckdns.org y Vercel no
tiene ni idea de ella.

POR QUE. Yo armaba la URL con request.get_host(). Pero la web no habla
directamente con este servidor: manda la petición a Vercel, y Vercel la
reenvía. Por el camino viaja la cabecera del host original, Django la da por
buena —jurp-incidencias.vercel.app está en ALLOWED_HOSTS— y get_host()
devuelve el host del proxy, no el de este servidor.

Es un error mío de los que no se ven en pruebas: en local, sin proxy delante,
get_host() devuelve lo correcto y todo parece funcionar.

LA REGLA NUEVA, por orden:

  1. settings.URL_PUBLICA o la variable de entorno URL_PUBLICA, si existen.
  2. Si no, el primer host de ALLOWED_HOSTS que no sea '*', localhost ni una
     dirección de bucle. Aquí eso es gideonstudio.duckdns.org, que es
     justamente la respuesta buena.
  3. Y solo si no hay nada de eso, la petición.

Lo importante del cambio no es el orden sino de dónde NO sale: de algo que
controla quien llama. Una URL que se arma con lo que manda el cliente es una
URL que el cliente decide, y eso nunca es lo que se quiere para un enlace que
se va a publicar.
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

ANCLA = '''def _url_publica(request, relativa):
    """URL absoluta, que es la única que sirve.

    FCM descarga la imagen DESDE EL TELEFONO, y WhatsApp desde sus servidores:
    una ruta relativa no la resuelve ninguno de los dos. Se respeta el
    X-Forwarded-Proto porque detrás de nginx la petición llega en http y, si
    se construye con eso, sale un enlace http que el móvil puede rechazar.
    """
    base = getattr(settings, "URL_PUBLICA", "") or ""
    if base:
        return base.rstrip("/") + relativa
    esquema = request.META.get("HTTP_X_FORWARDED_PROTO") or (
        "https" if request.is_secure() else "http")
    host = request.get_host()
    return "{0}://{1}{2}".format(esquema, host, relativa)
'''

NUEVO = '''def _base_publica(request):
    """De dónde cuelgan las imágenes, visto desde fuera.

    NO se usa request.get_host(), y esa es toda la corrección.

    La web no habla con este servidor directamente: manda la petición a
    Vercel y Vercel la reenvía. El host original viaja en la cabecera, Django
    lo da por bueno porque jurp-incidencias.vercel.app está en ALLOWED_HOSTS,
    y get_host() devuelve el host del proxy. El enlace salía apuntando a
    Vercel, donde la imagen no existe, y daba 404.

    El fondo del asunto es más general: una URL armada con lo que manda el
    cliente es una URL que decide el cliente. Para un enlace que se va a
    publicar en WhatsApp y que un teléfono va a descargar, eso no sirve.

    Por orden:
      1. URL_PUBLICA, de settings o del entorno.
      2. El primer ALLOWED_HOSTS que sea un nombre de verdad.
      3. La petición, solo si no hay nada mejor.
    """
    base = (getattr(settings, "URL_PUBLICA", "") or
            os.environ.get("URL_PUBLICA", "") or "").strip()
    if base:
        if not base.startswith("http"):
            base = "https://" + base
        return base.rstrip("/")

    for h in (getattr(settings, "ALLOWED_HOSTS", None) or []):
        h = str(h).strip().lstrip(".")
        if h and h not in ("*", "localhost", "127.0.0.1", "0.0.0.0", "[::1]"):
            return "https://" + h

    esquema = request.META.get("HTTP_X_FORWARDED_PROTO") or (
        "https" if request.is_secure() else "http")
    return "{0}://{1}".format(esquema, request.get_host())


def _url_publica(request, relativa):
    """URL absoluta, que es la única que sirve.

    FCM descarga la imagen DESDE EL TELEFONO y WhatsApp desde sus servidores:
    una ruta relativa no la resuelve ninguno de los dos.
    """
    return _base_publica(request) + relativa
'''


def principal():
    if not os.path.isfile(F):
        print("No encuentro {0}.".format(F))
        print("¿Aplicaste antes parche_notificar_mapa.py?")
        sys.exit(1)

    txt = io.open(F, encoding="utf-8").read()

    print("Carpeta: {0}".format(BASE))
    print("")
    print("=" * 78)
    print("La URL sale de la configuración, no de la petición")
    print("=" * 78)
    print("")

    if "_base_publica" in txt:
        print("NO SE APLICA NADA: ya tiene _base_publica, parece aplicado.")
        sys.exit(1)
    if txt.count(ANCLA) != 1:
        print("NO SE APLICA NADA: el ancla aparece {0} veces (debería ser 1).".format(
            txt.count(ANCLA)))
        print("¿Se tocó _url_publica a mano después de aplicar el parche?")
        sys.exit(1)

    nuevo = txt.replace(ANCLA, NUEVO, 1)
    try:
        compile(nuevo.encode("utf-8"), "views_notificaciones.py", "exec")
    except SyntaxError as e:
        print("NO SE ESCRIBE NADA: no compilaría ({0}, línea {1}).".format(e.msg, e.lineno))
        sys.exit(1)
    print("El archivo compila.")

    # Se enseña qué base va a salir AQUI Y AHORA, con la configuración real,
    # en vez de prometer que saldrá bien.
    try:
        import django  # noqa: F401
        os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
        from django.conf import settings as s
        permitidos = list(getattr(s, "ALLOWED_HOSTS", None) or [])
        cfg = (getattr(s, "URL_PUBLICA", "") or os.environ.get("URL_PUBLICA", "")).strip()
    except Exception:
        permitidos, cfg = [], os.environ.get("URL_PUBLICA", "").strip()

    print("")
    print("  URL_PUBLICA    : {0}".format(cfg or "— sin definir"))
    print("  ALLOWED_HOSTS  : {0}".format(permitidos or "— no pude leerlos desde aquí"))
    elegida = None
    if cfg:
        elegida = cfg if cfg.startswith("http") else "https://" + cfg
    else:
        for h in permitidos:
            h = str(h).strip().lstrip(".")
            if h and h not in ("*", "localhost", "127.0.0.1", "0.0.0.0", "[::1]"):
                elegida = "https://" + h
                break
    print("")
    if elegida:
        print("  Los enlaces saldrán así:")
        print("      {0}/media/monitoreo/2026/10/<nombre>.jpg".format(elegida.rstrip("/")))
        if "vercel" in elegida:
            print("")
            print("  OJO: eso es el dominio de la web, no el de este servidor.")
            print("  Reordena ALLOWED_HOSTS o define URL_PUBLICA.")
    else:
        print("  No pude saber qué base saldrá. Define URL_PUBLICA para no")
        print("  depender de adivinarlo:  URL_PUBLICA=https://gideonstudio.duckdns.org")
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
    print("Y ANTES de volver a probar desde la web, comprueba que /media/ se")
    print("sirve hacia fuera. Abre esto en el navegador de tu PC:")
    print("")
    print("  https://gideonstudio.duckdns.org/media/turnos/salidas/foto_1786924017622.jpg")
    print("")
    print("Si eso da 404, el enlace seguirá sin abrir aunque el host ya sea el")
    print("correcto: faltaría que nginx sirva /media/.")
    print("=" * 78)


principal()
