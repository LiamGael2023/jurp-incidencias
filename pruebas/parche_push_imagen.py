# -*- coding: utf-8 -*-
"""push_service aprende a mandar imagen en la notificación.

EN EL LINODE, dentro de /var/www/envs/prod:

    python3 parche_push_imagen.py              # solo muestra
    python3 parche_push_imagen.py --aplicar    # aplica, con respaldo

QUE HACE. Añade un parámetro `image` opcional a FCMClient.send_to_topic y
send_with_condition, y lo expone en /push/notify.

CON image=None EL MENSAJE SALE IDENTICO AL DE HOY, y eso es lo que de verdad
hay que cuidar: por aquí salen las alertas de lluvia a los tres grupos, y
llevan meses funcionando. El campo solo se añade al JSON cuando trae valor;
si va vacío, ni aparece.

POR QUE EN DOS SITIOS. FCM muestra la imagen en dos capas distintas:
`notification.image`, que es la genérica, y `android.notification.image`, que
es la que Android usa de verdad para la notificación expandible. Poniendo
solo la primera, en muchos teléfonos llega sin foto.

ESTE ARCHIVO ES PARA EL CONTENEDOR push_service, que corre Python moderno
(usa list[str] en main.py). El Django de src/ es Python 3.5 y Django 1.x:
eso va en otro parche y no se mezclan.

AL APLICAR hay que recrear SOLO ese contenedor:

    docker compose up -d --no-deps --force-recreate push_service

Nunca `docker restart`, y nada más se toca: en ese servidor están corriendo
davis_worker, beat y los workers de Hortifrut.
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

F_FCM = os.path.join(BASE, "push_service", "app", "fcm.py")
F_MAIN = os.path.join(BASE, "push_service", "app", "main.py")

# ───────────────────────────────────────────────────────────── fcm.py
A_TOPIC = """    def send_to_topic(self, topic, title, body, data=None):
        access_token = self._get_access_token()
        url = FCM_API_BASE.format(project_id=self.project_id)
        payload = {
            'message': {
                'topic': topic,
                'notification': {
                    'title': title,
                    'body': body,
                },
                'data': data or {},
                'android': {'priority': 'high'},
            }
        }
"""
N_TOPIC = """    def send_to_topic(self, topic, title, body, data=None, image=None):
        access_token = self._get_access_token()
        url = FCM_API_BASE.format(project_id=self.project_id)
        payload = {
            'message': {
                'topic': topic,
                'notification': {
                    'title': title,
                    'body': body,
                },
                'data': data or {},
                'android': {'priority': 'high'},
            }
        }
        _con_imagen(payload, image)
"""

A_COND = """    def send_with_condition(self, condition, title, body, data=None):
        access_token = self._get_access_token()
        url = FCM_API_BASE.format(project_id=self.project_id)
        payload = {
            'message': {
                'condition': condition,
                'notification': {
                    'title': title,
                    'body': body,
                },
                'data': data or {},
                'android': {'priority': 'high'},
            }
        }
"""
N_COND = """    def send_with_condition(self, condition, title, body, data=None, image=None):
        access_token = self._get_access_token()
        url = FCM_API_BASE.format(project_id=self.project_id)
        payload = {
            'message': {
                'condition': condition,
                'notification': {
                    'title': title,
                    'body': body,
                },
                'data': data or {},
                'android': {'priority': 'high'},
            }
        }
        _con_imagen(payload, image)
"""

A_CLASE = """class FCMClient(object):
"""
N_CLASE = '''def _con_imagen(payload, image):
    """Mete la imagen en el mensaje, o no toca nada.

    Si `image` viene vacia el payload se queda EXACTAMENTE como estaba: ni una
    clave de mas. Por aqui salen las alertas de lluvia desde hace meses y no
    tienen por que cambiar de forma porque alguien haya anadido una funcion
    nueva al lado.

    Se pone en dos sitios a proposito. `notification.image` es la generica, y
    `android.notification.image` es la que Android usa para la notificacion
    expandible: con solo la primera, en muchos telefonos llega sin foto.

    La URL tiene que ser PUBLICA y https: el telefono la descarga el solo, y
    no pasa por este servidor ni lleva ninguna credencial.
    """
    url = (image or '').strip()
    if not url:
        return payload
    mensaje = payload['message']
    mensaje['notification']['image'] = url
    android = mensaje.setdefault('android', {})
    android.setdefault('notification', {})['image'] = url
    return payload


class FCMClient(object):
'''

# ───────────────────────────────────────────────────────────── main.py
A_MODELO = """class PushNotificationPayload(BaseModel):
    title: str
    body: str
    data: Dict[str, str] = {}
    topic: Optional[str] = None
    condition: Optional[str] = None
"""
N_MODELO = """class PushNotificationPayload(BaseModel):
    title: str
    body: str
    data: Dict[str, str] = {}
    topic: Optional[str] = None
    condition: Optional[str] = None
    # URL publica y absoluta de una imagen para la notificacion expandible.
    # El telefono la descarga el solo, asi que tiene que verse desde fuera.
    # Vacia o ausente, el mensaje sale igual que siempre.
    image: Optional[str] = None
"""

A_ENVIO_COND = """        result = client.send_with_condition(
            condition=payload.condition,
            title=payload.title,
            body=payload.body,
            data=payload.data or {},
        )
"""
N_ENVIO_COND = """        result = client.send_with_condition(
            condition=payload.condition,
            title=payload.title,
            body=payload.body,
            data=payload.data or {},
            image=payload.image,
        )
"""

A_ENVIO_TOPIC = """    result = client.send_to_topic(
        topic=payload.topic,
        title=payload.title,
        body=payload.body,
        data=payload.data or {},
    )
"""
N_ENVIO_TOPIC = """    result = client.send_to_topic(
        topic=payload.topic,
        title=payload.title,
        body=payload.body,
        data=payload.data or {},
        image=payload.image,
    )
"""


def principal():
    for f in (F_FCM, F_MAIN):
        if not os.path.isfile(f):
            print("No encuentro {0}.".format(f))
            print("¿Estas en /var/www/envs/prod?")
            sys.exit(1)

    txt_f = io.open(F_FCM, encoding="utf-8").read()
    txt_m = io.open(F_MAIN, encoding="utf-8").read()

    print("Carpeta: {0}".format(BASE))
    print("")
    print("=" * 78)
    print("push_service aprende a mandar imagen")
    print("=" * 78)
    print("")

    fallos = []
    if "_con_imagen" in txt_f:
        fallos.append("fcm.py ya tiene _con_imagen: parece aplicado")
    if "image: Optional[str]" in txt_m:
        fallos.append("main.py ya tiene el campo image: parece aplicado")
    for nombre, ancla, texto in (
            ("fcm.py: send_to_topic", A_TOPIC, txt_f),
            ("fcm.py: send_with_condition", A_COND, txt_f),
            ("fcm.py: la clase", A_CLASE, txt_f),
            ("main.py: el modelo", A_MODELO, txt_m),
            ("main.py: envio por condicion", A_ENVIO_COND, txt_m),
            ("main.py: envio por topic", A_ENVIO_TOPIC, txt_m)):
        n = texto.count(ancla)
        if n != 1:
            fallos.append("{0}: el ancla aparece {1} veces (deberia ser 1)".format(nombre, n))

    if fallos:
        print("NO SE APLICA NADA:")
        for f in fallos:
            print("  - {0}".format(f))
        sys.exit(1)

    print("  push_service/app/fcm.py")
    print("    + _con_imagen(payload, image)   anade la URL en dos sitios")
    print("    + image=None en send_to_topic y send_with_condition")
    print("")
    print("  push_service/app/main.py")
    print("    + image en PushNotificationPayload, y se pasa en los dos envios")
    print("")
    print("  Con image vacia, el JSON que sale es EL MISMO de hoy.")
    print("  Las alertas de lluvia no cambian.")
    print("")

    nuevo_f = (txt_f.replace(A_CLASE, N_CLASE, 1)
                    .replace(A_TOPIC, N_TOPIC, 1)
                    .replace(A_COND, N_COND, 1))
    nuevo_m = (txt_m.replace(A_MODELO, N_MODELO, 1)
                    .replace(A_ENVIO_COND, N_ENVIO_COND, 1)
                    .replace(A_ENVIO_TOPIC, N_ENVIO_TOPIC, 1))

    for nombre, texto in (("fcm.py", nuevo_f), ("main.py", nuevo_m)):
        try:
            compile(texto.encode("utf-8"), nombre, "exec")
        except SyntaxError as e:
            print("NO SE ESCRIBE NADA: {0} no compilaria ({1}, linea {2}).".format(
                nombre, e.msg, e.lineno))
            sys.exit(1)
    print("Los dos archivos compilan.")

    # Comprobacion de sentido: _con_imagen tiene que estar definida ANTES de
    # que los metodos la usen, y fuera de la clase.
    i_def = nuevo_f.index("def _con_imagen")
    i_clase = nuevo_f.index("class FCMClient")
    if i_def > i_clase:
        print("NO SE ESCRIBE NADA: _con_imagen quedaria dentro de la clase.")
        sys.exit(1)
    print("_con_imagen queda definida antes de la clase.")
    print("")

    if not APLICAR:
        print("Listo para aplicar. NADA se ha escrito.")
        print("Para aplicarlo:  python3 {0} --aplicar".format(
            os.path.basename(sys.argv[0])))
        sys.exit(0)

    sin = [r for r in (F_FCM, F_MAIN) if not os.access(r, os.W_OK)]
    if sin:
        print("NO SE ESCRIBE NADA. Sin permiso en: {0}".format(", ".join(sin)))
        sys.exit(1)

    for r, t in ((F_FCM, nuevo_f), (F_MAIN, nuevo_m)):
        destino = r + ".bak"
        if os.path.exists(destino):
            destino = r + ".bak." + time.strftime("%Y%m%d-%H%M%S")
        shutil.copy2(r, destino)
        print("Respaldo: {0}".format(destino))
        io.open(r, "w", encoding="utf-8").write(t)
        print("Escrito : {0}".format(r))

    print("")
    print("=" * 78)
    print("SOLO ese contenedor, y se reconstruye porque el codigo va en la imagen:")
    print("")
    print("  docker compose up -d --no-deps --build --force-recreate push_service")
    print("")
    print("NUNCA 'docker restart': en este servidor estan corriendo davis_worker,")
    print("beat y los workers de Hortifrut, y no se tocan.")
    print("")
    print("Comprobar que sigue vivo:")
    print("  docker exec push_service python -c \"import urllib.request;"
          "print(urllib.request.urlopen('http://localhost:8080/health').read())\"")
    print("=" * 78)


principal()
