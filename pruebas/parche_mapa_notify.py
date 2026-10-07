# -*- coding: utf-8 -*-
"""La web avisa a PLUVIRA: vista nueva que reenvia a push_service.

EN EL LINODE, dentro de /var/www/envs/prod:

    python3 parche_mapa_notify.py              # solo muestra
    python3 parche_mapa_notify.py --aplicar    # aplica, con respaldo

QUE RESUELVE. El aviso del mapa llegaba a los telefonos de los VIGILANTES,
porque se mandaba desde Contabo y alli los unicos tokens son los de esa app.
PLUVIRA vive aqui y manda por topics de grupo. Esta vista es el puente: la
web la llama con su token de PLUVIRA -que en ESTE servidor si sirve para
escribir- y ella reenvia a push_service.

Con eso desaparece la clave compartida que hubo que poner en Contabo. Era un
parche por estar llamando al servidor equivocado, no una solucion.

ESCRITO PARA PYTHON 3.5 Y DJANGO 1.x, que es lo que corre aqui: sin
f-strings, urls con url() y patterns. Un archivo que no compila no avisa de
nada.

NO SE INVENTA EL ENVIO. Se copia _notify_push_microservice_for_hi de
hi_incidents.py tal cual: mismo urllib, misma cabecera X-Internal-Token,
mismo respeto a PUSH_SERVICE_ENABLED. Si manana cambia la forma de hablar con
push_service, se cambia en dos sitios iguales y no en dos distintos.

LA URL DE LA IMAGEN SE COMPRUEBA. Llega del cliente y acaba en los telefonos,
que la descargan solos: sin filtro, cualquiera con sesion podria apuntar a
catorce telefonos hacia donde quisiera. Solo se aceptan https y hosts de la
lista (MAPA_NOTIFY_HOSTS).

AL APLICAR hay que recrear SOLO jurp_web:

    docker compose up -d --no-deps --force-recreate jurp_web

Nunca 'docker restart': aqui corren davis_worker, beat y los workers de
Hortifrut, y no se tocan.
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

F_VISTA = os.path.join(BASE, "src", "apps", "api", "views", "mobile_mapa_notify.py")
F_URLS = os.path.join(BASE, "src", "apps", "api", "urls.py")

VISTA = '''# -*- coding: utf-8 -*-
"""Aviso del Monitoreo GIS a los telefonos de PLUVIRA.

Lo llama el boton «Notificar a la app» de la web. Recibe el titulo, la nota y
la URL de la imagen -que la web ya subio y publico- y reenvia a push_service,
un topic por cada grupo destino.

No guarda nada: la imagen ya esta publicada en otro sitio y aqui solo se
reparte el aviso.
"""

import json
import logging
import os

try:
    import urllib.request as _urlreq
except ImportError:  # por si alguna vez corre en python 2
    import urllib2 as _urlreq

try:
    from urllib.parse import urlparse
except ImportError:
    from urlparse import urlparse

from rest_framework import authentication, permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView


logger = logging.getLogger(__name__)

# A quien llega por defecto. Son los mismos tres grupos de las alertas de
# lluvia; se puede cambiar sin tocar codigo con MAPA_NOTIFY_GROUPS.
GRUPOS_POR_DEFECTO = 'mobile_usuarios,mobile_supervisor,mobile_gerencia'

# De donde se acepta la imagen. Esa URL acaba en los telefonos, que la
# descargan solos: sin lista, cualquiera con sesion podria apuntar catorce
# telefonos a donde quisiera.
HOSTS_POR_DEFECTO = 'gideonstudio.duckdns.org,sistema.jriegopresurizado.org.pe'


def _lista(texto):
    out = []
    for trozo in (texto or '').split(','):
        trozo = trozo.strip()
        if trozo:
            out.append(trozo)
    return out


def _grupos():
    return _lista(os.environ.get('MAPA_NOTIFY_GROUPS', GRUPOS_POR_DEFECTO))


def _imagen_admitida(url):
    """(ok, motivo). La URL vacia es valida: el aviso va sin foto."""
    url = (url or '').strip()
    if not url:
        return True, ''
    try:
        partes = urlparse(url)
    except Exception:
        return False, 'La direccion de la imagen no se entiende.'
    if partes.scheme != 'https':
        # El telefono puede rechazar http, y de paso no tiene sentido mandar
        # en claro algo que se va a descargar desde cualquier red.
        return False, 'La imagen tiene que ser https.'
    permitidos = _lista(os.environ.get('MAPA_NOTIFY_HOSTS', HOSTS_POR_DEFECTO))
    if partes.hostname not in permitidos:
        return False, 'Ese host no esta permitido para imagenes: {0}'.format(
            partes.hostname)
    return True, ''


def _enviar_a_push_service(payload):
    """Copiado de _notify_push_microservice_for_hi, a proposito.

    Hablar con push_service de dos formas distintas es asegurarse de que un
    dia una de las dos deje de funcionar y nadie sepa cual.
    """
    enabled = os.environ.get('PUSH_SERVICE_ENABLED', 'false').lower() == 'true'
    if not enabled:
        logger.debug('Push service deshabilitado para mapa_notify')
        return False, 'deshabilitado'

    base_url = os.environ.get('PUSH_SERVICE_BASE_URL',
                              'http://push_service:8080').rstrip('/')
    internal_token = os.environ.get('PUSH_SERVICE_INTERNAL_TOKEN', '')
    timeout = float(os.environ.get('PUSH_SERVICE_TIMEOUT_SECONDS', '2.0'))

    req = _urlreq.Request(
        base_url + '/push/notify',
        data=json.dumps(payload).encode('utf-8'),
        headers={
            'Content-Type': 'application/json',
            'X-Internal-Token': internal_token,
        },
        method='POST'
    )

    try:
        resp = _urlreq.urlopen(req, timeout=timeout)
        try:
            codigo = resp.getcode()
        finally:
            resp.close()
        if codigo >= 400:
            logger.warning('Push mapa status=%s topic=%s', codigo,
                           payload.get('topic'))
            return False, 'status {0}'.format(codigo)
        logger.info('Push mapa enviado topic=%s', payload.get('topic'))
        return True, ''
    except Exception as exc:
        logger.exception('Error enviando push mapa: %s', exc)
        return False, str(exc)


class MobileMapaNotifyView(APIView):
    """POST v1/mobile/mapa-notify/

    Campos:
        titulo       texto de la notificacion
        cuerpo       la nota que escribio el operador
        imagen_url   https y de un host permitido; opcional
        grupos       lista opcional; por defecto los tres de siempre
    """

    authentication_classes = [authentication.TokenAuthentication]
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, *args, **kwargs):
        """A quien llegaria, sin mandar nada."""
        habilitado = os.environ.get('PUSH_SERVICE_ENABLED', 'false').lower() == 'true'
        return Response({
            'grupos': _grupos(),
            'habilitado': habilitado,
            'usuario': request.user.username,
        })

    def post(self, request, *args, **kwargs):
        datos = request.data if hasattr(request, 'data') else request.DATA

        titulo = (datos.get('titulo') or 'Aviso del monitoreo')
        cuerpo = (datos.get('cuerpo') or 'Nueva captura del monitoreo GIS')
        imagen_url = (datos.get('imagen_url') or '').strip()

        titulo = titulo[:120]
        cuerpo = cuerpo[:600]

        ok, motivo = _imagen_admitida(imagen_url)
        if not ok:
            return Response({'detail': motivo},
                            status=status.HTTP_400_BAD_REQUEST)

        grupos = datos.get('grupos') or _grupos()
        if not isinstance(grupos, (list, tuple)):
            grupos = _lista(str(grupos))
        permitidos = _grupos()
        grupos = [g for g in grupos if g in permitidos]
        if not grupos:
            return Response(
                {'detail': 'Ningun grupo destino valido. Permitidos: {0}'.format(
                    ', '.join(permitidos))},
                status=status.HTTP_400_BAD_REQUEST)

        # Queda escrito QUIEN aviso. Son los telefonos de otra gente.
        logger.info('mapa_notify por %s a %s imagen=%s',
                    request.user.username, ','.join(grupos),
                    'si' if imagen_url else 'no')

        data = {
            'type': 'mapa_monitoreo',
            'origen': 'monitoreo_gis',
            'enviado_por': request.user.username,
        }
        if imagen_url:
            data['imagen'] = imagen_url

        enviados = []
        fallidos = []
        for grupo in grupos:
            topic = 'group_{0}'.format(grupo)
            payload = {
                'title': titulo,
                'body': cuerpo,
                'data': data,
                'topic': topic,
            }
            if imagen_url:
                payload['image'] = imagen_url
            ok_envio, detalle = _enviar_a_push_service(payload)
            if ok_envio:
                enviados.append(grupo)
            else:
                fallidos.append({'grupo': grupo, 'detalle': detalle})

        if not enviados:
            # Que no llegue a NADIE no es un exito con una lista vacia dentro.
            # Se devuelve error para que la pantalla lo diga.
            return Response(
                {'ok': False, 'enviados': [], 'fallidos': fallidos,
                 'detail': 'No se pudo avisar a ningun grupo.'},
                status=status.HTTP_502_BAD_GATEWAY)

        return Response({
            'ok': True,
            'enviados': enviados,
            'fallidos': fallidos,
            'con_imagen': bool(imagen_url),
        })
'''

ANCLA_IMP = ("from src.apps.api.views.mobile_auth import MobileAuthLoginView, "
             "MobileAuthLogoutView, MobileAuthCapabilitiesView\n")
NUEVO_IMP = ANCLA_IMP + ("from src.apps.api.views.mobile_mapa_notify import "
                         "MobileMapaNotifyView\n")

ANCLA_URL = """    url(
        r'^v1/mobile/hi-incidents/$',
        MobileHIIncidentCreateView.as_view(),
        name='mobile_hi_incidents_create',
    ),
"""
NUEVA_URL = ANCLA_URL + """    url(
        r'^v1/mobile/mapa-notify/$',
        MobileMapaNotifyView.as_view(),
        name='mobile_mapa_notify',
    ),
"""


def principal():
    if not os.path.isfile(F_URLS):
        print("No encuentro {0}.".format(F_URLS))
        print("¿Estas en /var/www/envs/prod?")
        sys.exit(1)

    txt_u = io.open(F_URLS, encoding="utf-8").read()

    print("Carpeta: {0}".format(BASE))
    print("")
    print("=" * 78)
    print("La web avisa a PLUVIRA")
    print("=" * 78)
    print("")

    fallos = []
    if os.path.exists(F_VISTA):
        fallos.append("mobile_mapa_notify.py ya existe")
    if "MobileMapaNotifyView" in txt_u:
        fallos.append("urls.py ya menciona MobileMapaNotifyView")
    for nombre, ancla in (("urls.py: el import de mobile_auth", ANCLA_IMP),
                          ("urls.py: la ruta de hi-incidents", ANCLA_URL)):
        n = txt_u.count(ancla)
        if n != 1:
            fallos.append("{0}: el ancla aparece {1} veces (deberia ser 1)".format(nombre, n))

    if fallos:
        print("NO SE APLICA NADA:")
        for f in fallos:
            print("  - {0}".format(f))
        sys.exit(1)

    print("  src/apps/api/views/mobile_mapa_notify.py   [archivo nuevo]")
    print("    + MobileMapaNotifyView, TokenAuthentication + IsAuthenticated")
    print("    + GET  dice a que grupos llegaria, sin mandar nada")
    print("    + POST reenvia a push_service, un topic por grupo")
    print("")
    print("  src/apps/api/urls.py")
    print("    + url v1/mobile/mapa-notify/")
    print("")
    print("  Grupos por defecto: mobile_usuarios, mobile_supervisor, mobile_gerencia")
    print("  Hosts de imagen    : gideonstudio.duckdns.org, sistema.jriegopresurizado.org.pe")
    print("  (los dos se cambian con MAPA_NOTIFY_GROUPS y MAPA_NOTIFY_HOSTS)")
    print("")

    nuevo_u = txt_u.replace(ANCLA_IMP, NUEVO_IMP, 1).replace(ANCLA_URL, NUEVA_URL, 1)

    for nombre, texto in (("urls.py", nuevo_u), ("mobile_mapa_notify.py", VISTA)):
        try:
            compile(texto.encode("utf-8"), nombre, "exec")
        except SyntaxError as e:
            print("NO SE ESCRIBE NADA: {0} no compilaria ({1}, linea {2}).".format(
                nombre, e.msg, e.lineno))
            sys.exit(1)
    print("Los dos archivos compilan.")

    # Python 3.5 no tiene f-strings. Si se colase una, el contenedor no
    # arranca y el fallo aparece lejos de aqui.
    import re
    sospechosas = []
    for i, linea in enumerate(VISTA.splitlines(), 1):
        if re.search(r"""(^|[^\w])f["']""", linea) and "{" in linea:
            sospechosas.append((i, linea.strip()))
    if sospechosas:
        print("NO SE ESCRIBE NADA: hay f-strings, y aqui corre Python 3.5:")
        for i, l in sospechosas[:5]:
            print("    linea {0}: {1}".format(i, l[:70]))
        sys.exit(1)
    print("Sin f-strings: compatible con Python 3.5.")
    print("")

    if not APLICAR:
        print("Listo para aplicar. NADA se ha escrito.")
        print("Para aplicarlo:  python3 {0} --aplicar".format(
            os.path.basename(sys.argv[0])))
        sys.exit(0)

    if not os.access(F_URLS, os.W_OK):
        print("NO SE ESCRIBE NADA. Sin permiso en {0}".format(F_URLS))
        sys.exit(1)
    carpeta = os.path.dirname(F_VISTA)
    if not os.access(carpeta, os.W_OK):
        print("NO SE ESCRIBE NADA. Sin permiso en {0}".format(carpeta))
        sys.exit(1)

    destino = F_URLS + ".bak"
    if os.path.exists(destino):
        destino = F_URLS + ".bak." + time.strftime("%Y%m%d-%H%M%S")
    shutil.copy2(F_URLS, destino)
    print("Respaldo: {0}".format(destino))
    io.open(F_URLS, "w", encoding="utf-8").write(nuevo_u)
    print("Escrito : {0}".format(F_URLS))
    io.open(F_VISTA, "w", encoding="utf-8").write(VISTA)
    print("Creado  : {0}".format(F_VISTA))

    print("")
    print("=" * 78)
    print("No hay migracion: no cambia ningun modelo.")
    print("")
    print("  docker compose up -d --no-deps --force-recreate jurp_web")
    print("")
    print("NUNCA 'docker restart': aqui corren davis_worker, beat y los workers")
    print("de Hortifrut, y no se tocan.")
    print("")
    print("Comprobar, SIN mandar nada (hace falta un token de PLUVIRA):")
    print("")
    print("  docker exec jurp_web python -c \"import urllib.request as u;"
          "r=u.Request('http://localhost:8000/api/v1/mobile/mapa-notify/',"
          "headers={'Authorization':'Token TU_TOKEN'});"
          "print(u.urlopen(r).read().decode())\"")
    print("")
    print("Si 'habilitado' sale False, PUSH_SERVICE_ENABLED no esta en 'true'")
    print("en el .env y no se mandaria nada.")
    print("=" * 78)


principal()
