# -*- coding: utf-8 -*-
"""Notificar el mapa: guarda la imagen, la enlaza y manda el push.

    python3 parche_notificar_mapa.py              # solo muestra
    python3 parche_notificar_mapa.py --aplicar    # aplica, con respaldo

Se ejecuta EN EL SERVIDOR (api_vigilantes), sobre el código fuente.

QUE RESUELVE. El botón «Notificar a la app» del Monitoreo GIS manda la foto
del mapa con una nota. Hoy el backend no tiene dónde recibirla. Y de paso
resuelve lo de WhatsApp: la respuesta devuelve la URL pública de la imagen,
así que el mensaje puede llevar el enlace y ya no hay que pegar nada a mano.

QUE NO HACE, Y ES A PROPOSITO:

  No escribe un segundo emisor de push. Ya existe auth_api/fcm_sender.py, lo
  usan los avisos nocturnos, y funciona. Lo único que le falta es saber
  mandar imagen, así que se le AÑADE un parámetro opcional `imagen_url` que
  por defecto va en None: con None el comportamiento es byte por byte el de
  hoy, y los dos comandos que ya lo llaman no se enteran. Un segundo emisor
  en paralelo es la forma segura de que dentro de un mes uno de los dos deje
  de funcionar y nadie sepa cuál.

  No manda el push sin que alguien lo pida dos veces. Son 14 teléfonos de
  vigilantes reales: la pantalla pregunta antes, con el número delante.

SOBRE QUIEN PUEDE LLAMARLO. El endpoint hace sonar 14 teléfonos, así que
abierto a cualquiera es un buzón de spam. Exige una de dos cosas: sesión
iniciada, o la cabecera X-Notif-Clave con el valor de NOTIF_MAPA_CLAVE. Si no
hay ninguna, responde 403 diciendo exactamente qué falta, en vez de fallar de
una forma que haya que adivinar.

LAS IMAGENES VAN A /media/monitoreo/AAAA/MM/. Se guardan con nombre aleatorio
-no con el que venga del navegador- porque un nombre de archivo que llega de
fuera es una entrada de usuario, y con '../' dentro escribe donde no debe.
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

F_FCM = os.path.join(BASE, "auth_api", "fcm_sender.py")
F_VISTA = os.path.join(BASE, "operations", "views_notificaciones.py")
F_URLS = os.path.join(BASE, "operations", "urls.py")

# ───────────────────────────────────────────── 1. el emisor aprende la imagen
#
# Se tocan tres sitios, los tres de forma compatible hacia atrás.

ANCLA_FIRMA_1 = "def enviar_push(token, titulo, cuerpo, data=None, silenciosa=False):\n"
NUEVA_FIRMA_1 = ("def enviar_push(token, titulo, cuerpo, data=None, silenciosa=False,\n"
                 "                imagen_url=None):\n")

ANCLA_DOC = """    - silenciosa: si True, la notificación SE MUESTRA (visible) pero por un
      canal SIN sonido ni vibración ('aviso_nocturno_silencioso'). Así el
      vigilante ve el aviso pero no suena — no delata al agente.
"""
NUEVO_DOC = """    - silenciosa: si True, la notificación SE MUESTRA (visible) pero por un
      canal SIN sonido ni vibración ('aviso_nocturno_silencioso'). Así el
      vigilante ve el aviso pero no suena — no delata al agente.
    - imagen_url: URL PUBLICA y absoluta de una imagen a mostrar en la
      notificación. FCM descarga esa URL desde el teléfono, así que tiene que
      verse desde fuera del servidor; una ruta relativa o un host interno
      hacen que la push llegue bien pero sin foto, sin avisar de nada.
      Si va None (lo normal) el mensaje sale exactamente igual que siempre.
"""

ANCLA_SILENCIOSA = """            mensaje = messaging.Message(
                token=token,
                notification=messaging.Notification(title=titulo, body=cuerpo),
                data=data_str,
                android=messaging.AndroidConfig(
                    priority='high',  # llega rápido aunque el teléfono esté en Doze
                    notification=messaging.AndroidNotification(
                        channel_id='aviso_nocturno_silencioso',
                        default_sound=False,  # sin sonido (el canal ya es silencioso)
                    ),
                ),
            )
"""
NUEVA_SILENCIOSA = """            mensaje = messaging.Message(
                token=token,
                notification=messaging.Notification(title=titulo, body=cuerpo,
                                                    image=imagen_url),
                data=data_str,
                android=messaging.AndroidConfig(
                    priority='high',  # llega rápido aunque el teléfono esté en Doze
                    notification=messaging.AndroidNotification(
                        channel_id='aviso_nocturno_silencioso',
                        default_sound=False,  # sin sonido (el canal ya es silencioso)
                        image=imagen_url,
                    ),
                ),
            )
"""

ANCLA_NORMAL = """            mensaje = messaging.Message(
                token=token,
                notification=messaging.Notification(title=titulo, body=cuerpo),
                data=data_str,
                android=messaging.AndroidConfig(
                    priority='high',
                    notification=messaging.AndroidNotification(
                        channel_id='alerta_supervisor_v2',
                        priority='max',
                        default_sound=True,
                    ),
                ),
            )
"""
NUEVA_NORMAL = """            mensaje = messaging.Message(
                token=token,
                notification=messaging.Notification(title=titulo, body=cuerpo,
                                                    image=imagen_url),
                data=data_str,
                android=messaging.AndroidConfig(
                    priority='high',
                    notification=messaging.AndroidNotification(
                        channel_id='alerta_supervisor_v2',
                        priority='max',
                        default_sound=True,
                        image=imagen_url,
                    ),
                ),
            )
"""

ANCLA_MULTI = """def enviar_push_multiple(tokens, titulo, cuerpo, data=None, silenciosa=False):
    \"\"\"Envía la misma push a VARIOS tokens de una vez.\"\"\"
    resultados = {'exitos': 0, 'fallos': 0, 'invalidos': []}
    for token in tokens:
        ok, detalle = enviar_push(token, titulo, cuerpo, data, silenciosa=silenciosa)
"""
NUEVA_MULTI = """def enviar_push_multiple(tokens, titulo, cuerpo, data=None, silenciosa=False,
                         imagen_url=None):
    \"\"\"Envía la misma push a VARIOS tokens de una vez.\"\"\"
    resultados = {'exitos': 0, 'fallos': 0, 'invalidos': []}
    for token in tokens:
        ok, detalle = enviar_push(token, titulo, cuerpo, data, silenciosa=silenciosa,
                                  imagen_url=imagen_url)
"""

# ───────────────────────────────────────────────────────── 2. la vista nueva
VISTA = '''# -*- coding: utf-8 -*-
"""Recibe la foto del mapa con una nota, la publica y avisa a los teléfonos.

La usa el botón «Notificar a la app» del Monitoreo GIS. Devuelve además la
URL pública de la imagen, que es lo que permite mandar el enlace por WhatsApp
sin tener que pegar la foto a mano.
"""

import os
import uuid
from datetime import datetime

from django.conf import settings
from rest_framework.decorators import api_view, permission_classes, parser_classes
from rest_framework.permissions import AllowAny
from rest_framework.parsers import MultiPartParser, FormParser
from rest_framework.response import Response
from rest_framework import status

from auth_api.models import DispositivoFCM
from auth_api.fcm_sender import enviar_push_multiple

# Tipos aceptados. Se mira lo que dice el navegador Y la extensión: no es una
# validación fuerte, pero evita que esto se convierta en un alojamiento de
# archivos cualquiera.
TIPOS = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}
MAX_BYTES = 8 * 1024 * 1024


def _autorizado(request):
    """Sesión iniciada, o la clave compartida.

    Esto hace sonar los teléfonos de los vigilantes. Abierto a cualquiera
    sería un buzón de spam con altavoz.
    """
    if getattr(request, "user", None) is not None and request.user.is_authenticated:
        return True
    clave = getattr(settings, "NOTIF_MAPA_CLAVE", "") or os.environ.get(
        "NOTIF_MAPA_CLAVE", "")
    if clave and request.META.get("HTTP_X_NOTIF_CLAVE", "") == clave:
        return True
    return False


def _url_publica(request, relativa):
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


@api_view(["GET", "POST"])
@permission_classes([AllowAny])
@parser_classes([MultiPartParser, FormParser])
def notificar_mapa(request):
    """GET dice a cuántos llegaría. POST guarda la imagen y la manda.

    Campos del POST:
      imagen         el archivo (JPEG, PNG o WebP, hasta 8 MB)
      titulo, cuerpo texto de la notificación
      origen         de dónde sale, para poder distinguirlo luego
      solo_publicar  si viene '1', guarda la imagen y devuelve su URL SIN
                     mandar ninguna notificación. Es lo que usa el enlace de
                     WhatsApp.
    """

    # El GET sirve para que la pantalla pueda avisar ANTES: «se enviará a 14
    # dispositivos». Son teléfonos de gente real; que nadie los haga sonar sin
    # saber cuántos son.
    if request.method == "GET":
        return Response({
            "dispositivos": DispositivoFCM.objects.exclude(token="").count(),
            "usuarios": DispositivoFCM.objects.exclude(token="")
                        .values("usuario").distinct().count(),
            "autorizado": _autorizado(request),
        })

    if not _autorizado(request):
        return Response({
            "detail": "No autorizado. Inicia sesión, o define NOTIF_MAPA_CLAVE "
                      "en el servidor y mándala en la cabecera X-Notif-Clave.",
        }, status=status.HTTP_403_FORBIDDEN)

    archivo = request.FILES.get("imagen")
    if archivo is None:
        return Response({"detail": "Falta el archivo 'imagen'."},
                        status=status.HTTP_400_BAD_REQUEST)
    if archivo.size > MAX_BYTES:
        return Response({
            "detail": "La imagen pesa {0:.1f} MB y el máximo son {1} MB.".format(
                archivo.size / 1048576.0, MAX_BYTES // 1048576),
        }, status=status.HTTP_400_BAD_REQUEST)

    ext = TIPOS.get((archivo.content_type or "").split(";")[0].strip())
    if ext is None:
        return Response({
            "detail": "Tipo no admitido: {0}. Solo JPEG, PNG o WebP.".format(
                archivo.content_type),
        }, status=status.HTTP_400_BAD_REQUEST)

    # Publicar SIN avisar. Lo usa el enlace de WhatsApp: ahí la imagen solo
    # necesita una URL pública, y hacer sonar catorce teléfonos de vigilantes
    # porque alguien quiso mandar una foto por WhatsApp sería un efecto
    # secundario que nadie pidió.
    solo = str(request.data.get("solo_publicar") or "").lower() in ("1", "true", "si", "s")

    titulo = (request.data.get("titulo") or "Aviso del monitoreo")[:120]
    cuerpo = (request.data.get("cuerpo") or "")[:600]
    origen = (request.data.get("origen") or "monitoreo_gis")[:40]

    # El nombre se inventa aquí. El que viene del navegador es entrada de
    # usuario y con '../' dentro escribe fuera de la carpeta.
    hoy = datetime.now()
    carpeta_rel = "monitoreo/{0:04d}/{1:02d}".format(hoy.year, hoy.month)
    carpeta_abs = os.path.join(settings.MEDIA_ROOT, carpeta_rel)
    try:
        os.makedirs(carpeta_abs)
    except OSError:
        if not os.path.isdir(carpeta_abs):
            raise
    nombre = "{0}{1}".format(uuid.uuid4().hex, ext)
    destino = os.path.join(carpeta_abs, nombre)
    with open(destino, "wb") as f:
        for trozo in archivo.chunks():
            f.write(trozo)

    relativa = "{0}{1}/{2}".format(settings.MEDIA_URL, carpeta_rel, nombre)
    url = _url_publica(request, relativa)

    if solo:
        return Response({"ok": True, "url": url, "enviados": 0, "fallos": 0,
                         "solo_publicada": True})

    # ── el push ───────────────────────────────────────────────────────────
    tokens = list(DispositivoFCM.objects.exclude(token="")
                  .values_list("token", flat=True))
    if not tokens:
        # La imagen YA está guardada y la URL sirve: se devuelve igual, porque
        # el enlace de WhatsApp funciona aunque no haya a quién notificar.
        return Response({
            "ok": True, "url": url, "enviados": 0, "fallos": 0,
            "aviso": "La imagen se publicó, pero no hay ningún teléfono con "
                     "token registrado: no se envió ninguna notificación.",
        })

    r = enviar_push_multiple(
        tokens, titulo, cuerpo or "Nueva captura del monitoreo",
        data={"tipo": "mapa_monitoreo", "origen": origen, "imagen": url},
        imagen_url=url,
    )

    # Un token que FCM rechaza por no registrado es un teléfono que desinstaló
    # la app. Se borra: si no, se reintenta en cada aviso para siempre.
    if r.get("invalidos"):
        DispositivoFCM.objects.filter(token__in=r["invalidos"]).delete()

    return Response({
        "ok": True,
        "url": url,
        "enviados": r.get("exitos", 0),
        "fallos": r.get("fallos", 0),
        "tokens_retirados": len(r.get("invalidos") or []),
    })
'''

# ───────────────────────────────────────────────────────────── 3. las rutas
ANCLA_RUTA = "    path('partidas/obras/', partidas_obras, name='partidas-obras'),\n"
NUEVA_RUTA = ("    path('partidas/obras/', partidas_obras, name='partidas-obras'),\n"
              "    # Foto del mapa con una nota: se publica y se avisa a los teléfonos\n"
              "    path('notificaciones/mapa/', notificar_mapa, name='notificar-mapa'),\n")
ANCLA_IMP = "from .views_partidas import partidas_lista, partidas_obras, avance_obra\n"
NUEVO_IMP = ("from .views_partidas import partidas_lista, partidas_obras, avance_obra\n"
             "from .views_notificaciones import notificar_mapa\n")


# ═══════════════════════════════════════════════════════════════════════════
def principal():
    for f in (F_FCM, F_URLS):
        if not os.path.isfile(f):
            print("No encuentro {0}.".format(f))
            sys.exit(1)

    txt_f = io.open(F_FCM, encoding="utf-8").read()
    txt_u = io.open(F_URLS, encoding="utf-8").read()

    print("Carpeta: {0}".format(BASE))
    print("")
    print("=" * 78)
    print("Notificar el mapa")
    print("=" * 78)
    print("")

    fallos = []
    if "imagen_url" in txt_f:
        fallos.append("fcm_sender.py ya habla de imagen_url: parece aplicado")
    if os.path.exists(F_VISTA):
        fallos.append("views_notificaciones.py ya existe")
    if "notificar_mapa" in txt_u:
        fallos.append("urls.py ya tiene notificar_mapa")
    for nombre, ancla, texto in (
            ("fcm_sender.py: firma de enviar_push", ANCLA_FIRMA_1, txt_f),
            ("fcm_sender.py: docstring", ANCLA_DOC, txt_f),
            ("fcm_sender.py: mensaje silencioso", ANCLA_SILENCIOSA, txt_f),
            ("fcm_sender.py: mensaje normal", ANCLA_NORMAL, txt_f),
            ("fcm_sender.py: enviar_push_multiple", ANCLA_MULTI, txt_f),
            ("urls.py: import de partidas", ANCLA_IMP, txt_u),
            ("urls.py: ruta de partidas/obras", ANCLA_RUTA, txt_u)):
        n = texto.count(ancla)
        if n != 1:
            fallos.append("{0}: el ancla aparece {1} veces (deberia ser 1)".format(nombre, n))

    if fallos:
        print("NO SE APLICA NADA:")
        for f in fallos:
            print("  - {0}".format(f))
        sys.exit(1)

    print("  auth_api/fcm_sender.py")
    print("    + imagen_url=None en enviar_push y enviar_push_multiple")
    print("    + image=imagen_url en Notification y AndroidNotification")
    print("      (con None, el mensaje sale EXACTAMENTE igual que hoy: los")
    print("       avisos nocturnos no se enteran)")
    print("")
    print("  operations/views_notificaciones.py   [archivo nuevo]")
    print("    + GET  notificaciones/mapa/   dice a cuantos llegaria")
    print("    + POST notificaciones/mapa/   guarda la imagen, publica y manda")
    print("           con solo_publicar=1, publica SIN avisar a nadie")
    print("")
    print("  operations/urls.py")
    print("    + path('notificaciones/mapa/', notificar_mapa)")
    print("")

    nuevo_f = txt_f
    for ancla, rep in ((ANCLA_FIRMA_1, NUEVA_FIRMA_1), (ANCLA_DOC, NUEVO_DOC),
                       (ANCLA_SILENCIOSA, NUEVA_SILENCIOSA),
                       (ANCLA_NORMAL, NUEVA_NORMAL), (ANCLA_MULTI, NUEVA_MULTI)):
        nuevo_f = nuevo_f.replace(ancla, rep, 1)
    nuevo_u = txt_u.replace(ANCLA_IMP, NUEVO_IMP, 1).replace(ANCLA_RUTA, NUEVA_RUTA, 1)

    for nombre, texto in (("fcm_sender.py", nuevo_f), ("urls.py", nuevo_u),
                          ("views_notificaciones.py", VISTA)):
        try:
            compile(texto.encode("utf-8"), nombre, "exec")
        except SyntaxError as e:
            print("NO SE ESCRIBE NADA: {0} no compilaria ({1}, linea {2}).".format(
                nombre, e.msg, e.lineno))
            sys.exit(1)
    print("Los tres archivos compilan.")
    print("")

    if not APLICAR:
        print("Listo para aplicar. NADA se ha escrito.")
        print("Para aplicarlo:  python3 {0} --aplicar".format(
            os.path.basename(sys.argv[0])))
        sys.exit(0)

    sin = [r for r in (F_FCM, F_URLS) if not os.access(r, os.W_OK)]
    if sin:
        print("NO SE ESCRIBE NADA. Sin permiso en: {0}".format(", ".join(sin)))
        sys.exit(1)

    for r, t in ((F_FCM, nuevo_f), (F_URLS, nuevo_u)):
        destino = r + ".bak"
        if os.path.exists(destino):
            destino = r + ".bak." + time.strftime("%Y%m%d-%H%M%S")
        shutil.copy2(r, destino)
        print("Respaldo: {0}".format(destino))
        io.open(r, "w", encoding="utf-8").write(t)
        print("Escrito : {0}".format(r))
    io.open(F_VISTA, "w", encoding="utf-8").write(VISTA)
    print("Creado  : {0}".format(F_VISTA))

    print("")
    print("=" * 78)
    print("No hay migracion: no cambia ningun modelo. Solo recrear:")
    print("")
    print("  docker compose up -d --no-deps --force-recreate web")
    print("")
    print("Y comprobar a cuantos llegaria, SIN mandar nada:")
    print("")
    print("  docker compose exec web python -c \"import urllib.request;"
          "print(urllib.request.urlopen('http://localhost:8000/api/v1/mobile/"
          "operations/notificaciones/mapa/').read().decode())\"")
    print("")
    print("Si 'autorizado' sale false, la web no podra mandar. Entonces define")
    print("una clave en el entorno del contenedor web y reinicia:")
    print("")
    print("  NOTIF_MAPA_CLAVE=<algo largo y aleatorio>")
    print("=" * 78)


principal()
