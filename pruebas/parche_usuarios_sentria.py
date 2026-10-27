# -*- coding: utf-8 -*-
"""Administrar los usuarios de SENTRIA desde la web. Django 4.2 / DRF 3.17.

    python3 parche_usuarios_sentria.py                 # solo mira
    python3 parche_usuarios_sentria.py --aplicar       # aplica
    python3 parche_usuarios_sentria.py --base /ruta    # si no autodetecta

SE CORRE EN EL LINODE DE VIGILANCIA -api_vigilantes, /var/www/envs/vigilantes-.
No en el de PLUVIRA: ese tiene su propio padron y ya tiene esto.

ESTA ESCRITO CONTRA ESE PROYECTO, no contra uno generico. Se miro antes:

    Django 4.2.30, Python 3.10.22, DRF 3.17.2
    el padron es auth.User -el de Django-, 59 cuentas, con set_password
    los roles son GRUPOS: vigilante_group 40, operador_group 10,
        supervisor_group 3, ssoma_group 1, mobile_gerencia 1
    quien administra cuentas aqui es SUPERVISOR, no Gerencia: en vigilancia
        quien da de alta a un vigilante es su supervisor
    las vistas viven en /app/auth_api/views.py
    hay /api/v1/operadores/ y /api/v1/vigilantes/, cada uno con su
        vocabulario, y ninguno expone ni asigna roles

EL CONTRATO ES EL MISMO QUE EL DE PLUVIRA, A PROPOSITO. La web ya tiene una
pantalla de usuarios que habla con /api/v1/mobile/users/ y con sus respuestas.
Inventar aqui otro vocabulario -operadores por un lado, vigilantes por otro-
obligaria a mantener dos pantallas que hacen lo mismo, y a que quien
administra aprenda dos maneras de crear una cuenta.

    GET  mobile/users/list/              {"results": [...]}
    GET  mobile/users/roles/             {"results": [{code, label}]}
    POST mobile/users/                   -> {"credentials": {...}}
    POST mobile/users/<id>/update/       nombre, apellido, correo, usuario
    POST mobile/users/<id>/role/         {"role": "<nombre del grupo>"}
    POST mobile/users/<id>/reset-password/  -> {"credentials": {...}}
    POST mobile/users/<id>/toggle-active/

QUE TOCA

    1. auth_api/usuarios_web.py   las vistas               (NUEVO)
    2. auth_api/urls.py           las siete rutas, al final

No hay migracion: no se crean tablas. Los roles son los grupos que ya
existen, y las cuentas las de auth_user.

LO QUE NO HACE, Y HAY QUE SABERLO: no toca /api/v1/operadores/, que hoy
responde a cualquiera sin autenticar -permission_classes = [AllowAny]- y
permite crear, editar y borrar operadores desde internet. Cerrarlo puede
dejar sin servicio a la app que lo use, asi que es una decision aparte.
"""

from __future__ import print_function

import ast
import datetime
import io
import os
import re
import shutil
import sys

APLICAR = "--aplicar" in sys.argv

CANDIDATOS = ["/app", "/var/www/envs/vigilantes", os.getcwd()]


def base_del_proyecto():
    if "--base" in sys.argv:
        return sys.argv[sys.argv.index("--base") + 1]
    for c in CANDIDATOS:
        if os.path.isfile(os.path.join(c, "auth_api", "views.py")):
            return c
    return os.getcwd()


# ══════════════════════════════════════════════════════════════════════════
# 1. las vistas
# ══════════════════════════════════════════════════════════════════════════

MODULO = r'''# -*- coding: utf-8 -*-
"""Administrar las cuentas de SENTRIA desde la web.

Lo escribe parche_usuarios_sentria.py. No se edita a mano: el parche lo
reemplaza entero.

EL ROL ES UN GRUPO DE DJANGO, no un campo. Este proyecto ya los usa asi
-vigilante_group, operador_group, supervisor_group, ssoma_group,
mobile_gerencia- y el codigo de la app mira a que grupo pertenece cada
usuario. Añadir un campo "rol" al lado daria dos fuentes para el mismo dato,
y el dia que discreparan -y discrepan- nadie sabria cual manda.

UNA CUENTA, UN ROL. En Django un usuario puede estar en varios grupos, pero
aqui no: asignar un rol reemplaza los anteriores. Dejar que se acumulen daria
vigilantes que ademas son supervisores sin que nadie lo decidiera, y la
pantalla tendria que enseñar listas donde hoy enseña una etiqueta.

LA CLAVE NO SE ELIGE, SE GENERA. Se devuelve UNA SOLA VEZ y no se guarda en
claro en ningun sitio -Django guarda el hash-. Que la escriba quien
administra tiene dos problemas: acaban siendo todas la misma, y queda escrita
en el chat por donde se la pasen.
"""

import re

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.db import transaction
from django.utils.crypto import get_random_string

from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response


User = get_user_model()

# QUIEN PUEDE ADMINISTRAR CUENTAS. En PLUVIRA es mobile_gerencia; aqui no,
# aqui son los supervisores. No es un descuido de copiar: son dos
# organizaciones distintas sobre dos padrones distintos, y en vigilancia
# quien da de alta a un vigilante es su supervisor. Forzar el mismo grupo en
# los dos habria obligado a meter a los tres supervisores en un grupo que en
# este sistema no significa nada.
GRUPO_ADMIN = 'supervisor_group'

# Los nombres de grupo son tecnicos; esto es lo que lee una persona. Lo que no
# este aqui se deduce, para que un grupo nuevo salga con una etiqueta
# razonable sin tener que volver a tocar este fichero.
ETIQUETAS = {
    'mobile_gerencia': 'Gerencia',
    'vigilante_group': 'Vigilante',
    'operador_group': 'Operador',
    'supervisor_group': 'Supervisor',
    'ssoma_group': 'SSOMA',
}

# Sin 0/O ni 1/l/I: estas claves se dictan por telefono y se copian a mano de
# un papel. Una O confundida con un cero es una llamada a soporte.
ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
LARGO_CLAVE = 10


def etiqueta_de(nombre):
    """El nombre legible de un grupo. Funcion pura."""
    if nombre in ETIQUETAS:
        return ETIQUETAS[nombre]
    limpio = (nombre or '').replace('_group', '').replace('_', ' ').strip()
    return limpio.capitalize() if limpio else (nombre or '')


def clave_nueva():
    return get_random_string(LARGO_CLAVE, ALFABETO)


def puede_administrar(es_staff, nombres_de_grupos):
    """Si esta persona puede tocar cuentas. Funcion pura: se prueba sola.

    is_staff entra porque es quien administra el servidor, y si no entrara,
    un despliegue nuevo -donde todavia no hay nadie con el rol que
    administra- se quedaria sin nadie capaz de crear al primero.
    """
    if es_staff:
        return True
    return GRUPO_ADMIN in set(nombres_de_grupos or [])


def decidir_cambio(actor_id, objetivo_id, rol_actual, rol_nuevo, admins):
    """Si se permite este cambio de rol. Funcion pura.

    EL ENCIERRO ES EL FALLO QUE IMPORTA. Si los supervisores se quitan el
    rol unos a otros -o el ultimo se lo quita a si mismo-, nadie puede volver
    a administrar cuentas desde la web y el unico remedio es entrar al
    servidor. No es hipotetico: pasa la primera vez que alguien prueba la
    pantalla consigo mismo.

    → (se_permite, motivo)
    """
    admins = set(admins or [])
    sale_de_admin = (rol_actual == GRUPO_ADMIN
                     and rol_nuevo != GRUPO_ADMIN)
    if sale_de_admin and admins <= {objetivo_id}:
        return False, ('Es la unica cuenta que puede administrar usuarios. '
                       'Dale ese rol a otra persona antes de quitarselo a '
                       'esta, o nadie podra crear ni editar cuentas.')
    if sale_de_admin and actor_id == objetivo_id:
        return False, ('No puedes quitarte a ti mismo el rol que te deja '
                       'administrar usuarios. Pideselo a otra persona que '
                       'tambien lo tenga.')
    return True, None


def decidir_desactivar(actor_id, objetivo_id, activo_ahora, rol, admins):
    """Si se permite activar/desactivar. Funcion pura. Mismo encierro."""
    if activo_ahora:  # se va a DESACTIVAR
        if actor_id == objetivo_id:
            return False, 'No puedes desactivar tu propia cuenta.'
        if rol == GRUPO_ADMIN and set(admins or []) <= {objetivo_id}:
            return False, ('Es la unica cuenta activa que puede administrar '
                           'usuarios. Desactivarla deja el sistema sin '
                           'administracion.')
    return True, None


# ── lo que no es puro ────────────────────────────────────────────────────

def _rol_de(usuario):
    g = usuario.groups.first()
    return g.name if g else ''


def _admins_activos():
    return set(User.objects
               .filter(groups__name=GRUPO_ADMIN, is_active=True)
               .values_list('id', flat=True))


def _uno(u):
    rol = _rol_de(u)
    return {
        'id': u.id,
        'username': u.username,
        'first_name': u.first_name or '',
        'last_name': u.last_name or '',
        'email': u.email or '',
        'is_active': u.is_active,
        'role': rol,
        'role_label': etiqueta_de(rol) if rol else '',
        'last_login': u.last_login,
    }


def _negado():
    return Response(
        {'detail': 'Tu usuario no es Supervisor, asi que no puede '
                   'administrar cuentas. Pideselo a un supervisor.',
         'codigo': 'sin_permiso'},
        status=status.HTTP_403_FORBIDDEN)


def _manda(request):
    u = request.user
    return puede_administrar(
        bool(u.is_staff), list(u.groups.values_list('name', flat=True)))


def _cerrar_sesion(usuario):
    """Le quita el token. Se llama al cambiar rol, clave o actividad.

    Sin esto, alguien a quien acaban de bajar de supervisor a vigilante sigue
    con los permisos viejos hasta que cierre sesion por su cuenta, que puede
    ser nunca: los tokens de DRF no caducan.
    """
    try:
        from rest_framework.authtoken.models import Token
        Token.objects.filter(user=usuario).delete()
    except Exception:
        pass


def _limpio(dato, largo):
    return (dato or '').strip()[:largo]


USUARIO_VALIDO = re.compile(r'^[\w.@+-]{3,30}$')


# ── las vistas ───────────────────────────────────────────────────────────

@api_view(['GET'])
@permission_classes([IsAuthenticated])
def usuarios_lista(request):
    if not _manda(request):
        return _negado()
    cuentas = (User.objects.all()
               .prefetch_related('groups')
               .order_by('is_active', 'first_name', 'username'))
    return Response({'results': [_uno(u) for u in cuentas]})


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def usuarios_roles(request):
    if not _manda(request):
        return _negado()
    # Los grupos que existen, no una lista escrita a mano: si mañana se crea
    # otro rol en el admin, aparece solo.
    #
    # EL ROL QUE ADMINISTRA VA ULTIMO, y no es cosmetica. El desplegable de
    # la pantalla arranca sin nada elegido, pero si algun dia alguien quita
    # esa opcion vacia, el primero de la lista queda preseleccionado, y un
    # descuido crearia una cuenta capaz de administrar a todas las demas. Que
    # el rol mas poderoso no sea el primero es la segunda capa de esa misma
    # defensa.
    grupos = sorted(Group.objects.all(),
                    key=lambda g: (g.name == GRUPO_ADMIN, g.name))
    return Response({'results': [
        {'code': g.name, 'label': etiqueta_de(g.name)} for g in grupos]})


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def usuarios_crear(request):
    if not _manda(request):
        return _negado()

    username = _limpio(request.data.get('username'), 30)
    if not USUARIO_VALIDO.match(username):
        return Response(
            {'detail': 'Usuario invalido: de 3 a 30 caracteres, sin espacios '
                       '(letras, numeros, . @ + - _).'},
            status=status.HTTP_400_BAD_REQUEST)
    if User.objects.filter(username__iexact=username).exists():
        return Response({'detail': 'Ya existe una cuenta con ese usuario.'},
                        status=status.HTTP_400_BAD_REQUEST)

    rol = _limpio(request.data.get('role'), 150)
    grupo = Group.objects.filter(name=rol).first() if rol else None
    if rol and grupo is None:
        return Response({'detail': 'Ese rol no existe en el servidor.'},
                        status=status.HTTP_400_BAD_REQUEST)

    clave = clave_nueva()
    with transaction.atomic():
        u = User(
            username=username,
            first_name=_limpio(request.data.get('first_name'), 30),
            last_name=_limpio(request.data.get('last_name'), 30),
            email=_limpio(request.data.get('email'), 254),
            is_active=True,
        )
        u.set_password(clave)
        u.save()
        if grupo is not None:
            u.groups.set([grupo])

    return Response(
        {'ok': True,
         'usuario': _uno(u),
         'credentials': {'username': u.username, 'password': clave,
                         'role_label': etiqueta_de(rol) if rol else ''}},
        status=status.HTTP_201_CREATED)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def usuarios_editar(request, pk):
    if not _manda(request):
        return _negado()
    u = User.objects.filter(pk=pk).first()
    if u is None:
        return Response({'detail': 'No existe esa cuenta.'},
                        status=status.HTTP_404_NOT_FOUND)

    nuevo = _limpio(request.data.get('username'), 30)
    if nuevo and nuevo != u.username:
        if not USUARIO_VALIDO.match(nuevo):
            return Response({'detail': 'Usuario invalido.'},
                            status=status.HTTP_400_BAD_REQUEST)
        if User.objects.filter(username__iexact=nuevo).exclude(pk=u.pk).exists():
            return Response({'detail': 'Ya existe una cuenta con ese usuario.'},
                            status=status.HTTP_400_BAD_REQUEST)
        u.username = nuevo

    for campo, largo in (('first_name', 30), ('last_name', 30),
                         ('email', 254)):
        if campo in request.data:
            setattr(u, campo, _limpio(request.data.get(campo), largo))
    u.save()
    return Response({'ok': True, 'usuario': _uno(u)})


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def usuarios_rol(request, pk):
    if not _manda(request):
        return _negado()
    u = User.objects.filter(pk=pk).first()
    if u is None:
        return Response({'detail': 'No existe esa cuenta.'},
                        status=status.HTTP_404_NOT_FOUND)

    rol = _limpio(request.data.get('role'), 150)
    grupo = Group.objects.filter(name=rol).first() if rol else None
    if rol and grupo is None:
        return Response({'detail': 'Ese rol no existe en el servidor.'},
                        status=status.HTTP_400_BAD_REQUEST)

    ok, motivo = decidir_cambio(request.user.id, u.id, _rol_de(u), rol,
                                _admins_activos())
    if not ok:
        return Response({'detail': motivo, 'codigo': 'encierro'},
                        status=status.HTTP_409_CONFLICT)

    u.groups.set([grupo] if grupo is not None else [])
    _cerrar_sesion(u)
    return Response({'ok': True, 'usuario': _uno(u)})


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def usuarios_clave(request, pk):
    if not _manda(request):
        return _negado()
    u = User.objects.filter(pk=pk).first()
    if u is None:
        return Response({'detail': 'No existe esa cuenta.'},
                        status=status.HTTP_404_NOT_FOUND)

    clave = clave_nueva()
    u.set_password(clave)
    u.save(update_fields=['password'])
    _cerrar_sesion(u)
    rol = _rol_de(u)
    return Response({'ok': True, 'credentials': {
        'username': u.username, 'password': clave,
        'role_label': etiqueta_de(rol) if rol else ''}})


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def usuarios_actividad(request, pk):
    if not _manda(request):
        return _negado()
    u = User.objects.filter(pk=pk).first()
    if u is None:
        return Response({'detail': 'No existe esa cuenta.'},
                        status=status.HTTP_404_NOT_FOUND)

    ok, motivo = decidir_desactivar(request.user.id, u.id, u.is_active,
                                    _rol_de(u), _admins_activos())
    if not ok:
        return Response({'detail': motivo, 'codigo': 'encierro'},
                        status=status.HTTP_409_CONFLICT)

    u.is_active = not u.is_active
    u.save(update_fields=['is_active'])
    if not u.is_active:
        _cerrar_sesion(u)
    return Response({'ok': True, 'usuario': _uno(u)})
'''


# ══════════════════════════════════════════════════════════════════════════
# 2. las rutas
# ══════════════════════════════════════════════════════════════════════════
#
# POR QUE SE AÑADE AL FINAL Y NO DENTRO DE urlpatterns. Ese fichero arma sus
# rutas con un router de DRF -por eso salen como ^operadores/$-, y puede ser
# `urlpatterns = router.urls`, una lista, o un `+=`. Meterse dentro obliga a
# adivinar cual de las tres. Reasignar al final funciona con las tres, y
# `list(urlpatterns) + [...]` tambien si era el objeto del router y no una
# lista.

MARCA = "# >>> USUARIOS DESDE LA WEB (parche_usuarios_sentria) >>>"

RUTAS = MARCA + r'''
#
# El mismo contrato que PLUVIRA, para que la pantalla de la web sea una sola
# y "crear un usuario" signifique lo mismo en los dos sistemas.
from django.urls import path as _path_uw
from auth_api import usuarios_web as _uw

urlpatterns = list(urlpatterns) + [
    _path_uw('mobile/users/list/', _uw.usuarios_lista,
             name='sentria_usuarios_lista'),
    _path_uw('mobile/users/roles/', _uw.usuarios_roles,
             name='sentria_usuarios_roles'),
    _path_uw('mobile/users/', _uw.usuarios_crear,
             name='sentria_usuarios_crear'),
    _path_uw('mobile/users/<int:pk>/update/', _uw.usuarios_editar,
             name='sentria_usuarios_editar'),
    _path_uw('mobile/users/<int:pk>/role/', _uw.usuarios_rol,
             name='sentria_usuarios_rol'),
    _path_uw('mobile/users/<int:pk>/reset-password/', _uw.usuarios_clave,
             name='sentria_usuarios_clave'),
    _path_uw('mobile/users/<int:pk>/toggle-active/', _uw.usuarios_actividad,
             name='sentria_usuarios_actividad'),
]
# <<< USUARIOS DESDE LA WEB <<<
'''


def urls_de_la_api(base):
    """El urls.py donde viven las rutas de /api/v1/.

    Se busca por contenido y no por ruta: lo identifica el fichero que
    registra 'operadores', que es una de las rutas que ya se vieron colgando
    de /api/v1/. Suponer 'auth_api/urls.py' seria apostar.
    """
    hallados = []
    for raiz, dirs, ficheros in os.walk(base):
        dirs[:] = [d for d in dirs
                   if d not in ('.git', 'node_modules', 'static', 'media',
                                '__pycache__', 'venv', '.venv')]
        if 'urls.py' not in ficheros:
            continue
        ruta = os.path.join(raiz, 'urls.py')
        try:
            texto = io.open(ruta, encoding='utf-8').read()
        except (IOError, OSError):
            continue
        if 'operadores' in texto and 'urlpatterns' in texto:
            hallados.append(ruta)
    return hallados


def paso_rutas(texto):
    if MARCA in texto:
        # Se reemplaza entero: asi añadir una ruta mas en una version futura
        # no deja la anterior pegada debajo.
        i = texto.index(MARCA)
        fin = texto.find("# <<< USUARIOS DESDE LA WEB <<<", i)
        if fin == -1:
            return None, ("el bloque del parche esta a medias en urls.py; "
                          "dime como quedo")
        fin = texto.index("\n", fin) + 1
        return texto[:i] + RUTAS.lstrip("\n") + texto[fin:], \
            "actualizadas las siete rutas"
    if not re.search(r"^urlpatterns", texto, re.M):
        return None, "no encuentro urlpatterns en ese urls.py"
    return texto.rstrip("\n") + "\n\n\n" + RUTAS.lstrip("\n"), \
        "anadidas las siete rutas"


# ══════════════════════════════════════════════════════════════════════════

def respaldo(ruta):
    sello = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    copia = "%s.bak-%s" % (ruta, sello)
    shutil.copy2(ruta, copia)
    return copia


def principal():
    base = base_del_proyecto()
    f_mod = os.path.join(base, "auth_api", "usuarios_web.py")

    print("proyecto: %s" % base)
    print("modo    : %s" % ("APLICAR" if APLICAR else "solo mostrar"))
    print("")

    if not os.path.isdir(os.path.join(base, "auth_api")):
        print("MAL  no encuentro %s/auth_api" % base)
        print("     Pasa la raiz del proyecto con --base /ruta.")
        return 1

    candidatos = urls_de_la_api(base)
    if len(candidatos) != 1:
        print("MAL  esperaba UN urls.py que registre 'operadores' y encontre %d"
              % len(candidatos))
        for c in candidatos:
            print("       %s" % c)
        print("     Dime cual es el bueno y lo paso con --urls /ruta.")
        return 1
    f_urls = candidatos[0]

    txt_u = io.open(f_urls, encoding="utf-8").read()
    nuevo_u, av_u = paso_rutas(txt_u)

    print("1. auth_api/usuarios_web.py  %s"
          % ("se reescribe" if os.path.isfile(f_mod) else "se crea"))
    print("2. %s" % f_urls)
    print("   %s" % av_u)
    print("")

    if nuevo_u is None:
        print("NO SE ESCRIBE NADA. A medias es peor que sin empezar:")
        print("   - %s" % av_u)
        print("")
        print("Mandame esta salida y lo ajusto.")
        return 1

    # Se comprueba el RESULTADO, no la intencion.
    for falta in ("mobile/users/list/", "mobile/users/roles/",
                  "mobile/users/<int:pk>/role/", "usuarios_web"):
        if falta not in nuevo_u:
            print("NO SE ESCRIBE NADA: en urls.py no salio %r." % falta)
            return 1

    # Que los dos sigan siendo Python. Se escribe dentro de un fichero cuya
    # forma exacta no se ve desde aqui, y uno partido por la mitad no se nota
    # hasta que el proyecto no arranca.
    try:
        ast.parse(txt_u)
        original_sano = True
    except SyntaxError:
        original_sano = False
    if original_sano:
        try:
            ast.parse(nuevo_u)
        except SyntaxError as e:
            print("NO SE ESCRIBE NADA: urls.py quedaria roto (%s)." % e)
            return 1
    try:
        ast.parse(MODULO)
    except SyntaxError as e:
        print("NO SE ESCRIBE NADA: usuarios_web.py no es Python (%s)." % e)
        return 1

    # ¿Se puede escribir? Se pregunta por los dos antes de tocar el primero.
    sin_permiso = []
    if not os.access(os.path.dirname(f_mod), os.W_OK):
        sin_permiso.append("%s (donde va usuarios_web.py)"
                           % os.path.dirname(f_mod))
    if not os.access(f_urls, os.W_OK):
        sin_permiso.append(f_urls)
    elif not os.access(os.path.dirname(f_urls), os.W_OK):
        sin_permiso.append("%s (la carpeta, para el respaldo)"
                           % os.path.dirname(f_urls))
    if sin_permiso:
        print("NO SE ESCRIBE NADA: no puedo escribir en")
        for f in sorted(set(sin_permiso)):
            print("   - %s" % f)
        print("")
        print("Si esto corre dentro del contenedor, el codigo puede estar")
        print("montado en solo lectura. Entonces se parchea EN EL HOST:")
        print("    docker compose config --format json | grep -i source")
        print("    sudo python3 %s --base /la/carpeta/del/host --aplicar"
              % os.path.basename(__file__))
        return 1

    if not APLICAR:
        print("Nada tocado. Para aplicarlo:")
        print("    python3 %s --aplicar" % os.path.basename(__file__))
        return 0

    if nuevo_u != txt_u:
        print("respaldo %s" % respaldo(f_urls))
        io.open(f_urls, "w", encoding="utf-8").write(nuevo_u)
    io.open(f_mod, "w", encoding="utf-8").write(MODULO)

    print("")
    print("escrito: auth_api/usuarios_web.py, %s" % os.path.basename(f_urls))
    print("")
    print("No hay migracion: no se crean tablas. Los roles son los grupos que")
    print("ya existen y las cuentas las de auth_user. Solo hace falta")
    print("recargar el servicio:")
    print("    docker compose up -d --no-deps --force-recreate web")
    print("")
    print("OJO con /api/v1/operadores/: hoy responde a cualquiera sin")
    print("autenticar (AllowAny) y deja crear, editar y borrar. Este parche")
    print("NO lo toca, porque cerrarlo puede dejar sin servicio a la app que")
    print("lo use. Es una decision aparte.")
    return 0


if __name__ == "__main__":
    sys.exit(principal())
