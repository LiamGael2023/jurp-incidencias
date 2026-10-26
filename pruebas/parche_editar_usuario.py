# -*- coding: utf-8 -*-
"""
Anade a PLUVIRA el endpoint que faltaba: EDITAR un usuario movil.

POR QUE HACE FALTA
------------------
La API de gestion de usuarios (src/apps/api/views/mobile_users.py) sabe
crear, resetear la clave, activar/desactivar y cambiar el rol. No sabe
corregir un nombre mal escrito ni cambiar el nombre de usuario. Hasta ahora
eso solo se podia hacer entrando al admin de Django o por el shell, es decir
con is_staff, que es justo la marca que conviene no repartir.

QUE TOCA
--------
    1. src/apps/api/views/mobile_users.py   la vista nueva
    2. src/apps/api/urls.py                 el import y la ruta

USO
---
    python3 parche_editar_usuario.py [--raiz /var/www/envs/prod] [--dry-run]

Es idempotente: si ya esta aplicado lo dice y no toca nada. Deja .bak de
cada archivo que modifica.

SOBRE CAMBIAR EL NOMBRE DE USUARIO
----------------------------------
Se permite, con la misma validacion que al crear (formato y unicidad), pero
NO se borra su token. Cambiar como se llama alguien no tiene por que echarlo
de la sesion que tiene abierta; lo que si cambia es con que nombre entrara la
proxima vez, y de eso avisa la pantalla. Las relaciones de la base van por
id, asi que renombrar no rompe sus partes, incidencias ni su equipo enlazado.
"""

import argparse
import os
import shutil
import sys


VISTA = '''

class MobileUserUpdateView(_Base):
    """Corrige nombre, apellido, correo y nombre de usuario.

    Los campos que no vengan en la peticion se dejan como estan: asi la
    pantalla puede mandar solo lo que cambio sin borrar el resto por omision.
    """

    def post(self, request, user_id, *args, **kwargs):
        target, err = self._get_target(request, user_id)
        if err:
            return err

        datos = request.data or {}

        if 'first_name' in datos:
            target.first_name = (datos.get('first_name') or '').strip()[:30]
        if 'last_name' in datos:
            target.last_name = (datos.get('last_name') or '').strip()[:30]
        if 'email' in datos:
            target.email = (datos.get('email') or '').strip()

        nuevo = (datos.get('username') or '').strip()
        if nuevo and nuevo != target.username:
            if not USERNAME_RE.match(nuevo):
                return Response(
                    {'ok': False,
                     'detail': 'Usuario invalido: 3 a 30 caracteres, sin espacios '
                               '(letras, numeros, . @ + - _).'},
                    status=400)
            # iexact y no exact: dos cuentas que solo se distinguen por
            # mayusculas son una trampa para quien luego tenga que entrar.
            if User.objects.filter(username__iexact=nuevo).exclude(pk=target.pk).exists():
                return Response({'ok': False, 'detail': 'Ya existe un usuario con ese nombre.'},
                                status=400)
            target.username = nuevo

        target.save()
        return Response({'ok': True, 'user': _serialize(target)})
'''

IMPORT_VIEJO = """from src.apps.api.views.mobile_users import (
    MobileUserRolesView,
    MobileUserListView,
    MobileUserCreateView,
    MobileUserResetPasswordView,
    MobileUserToggleActiveView,
    MobileUserChangeRoleView,
)"""

IMPORT_NUEVO = """from src.apps.api.views.mobile_users import (
    MobileUserRolesView,
    MobileUserListView,
    MobileUserCreateView,
    MobileUserUpdateView,
    MobileUserResetPasswordView,
    MobileUserToggleActiveView,
    MobileUserChangeRoleView,
)"""

RUTA_ANCLA = ("    url(r'^v1/mobile/users/(?P<user_id>\\d+)/reset-password/$', "
              "MobileUserResetPasswordView.as_view(), name='mobile_users_reset_password'),")

RUTA_NUEVA = ("    url(r'^v1/mobile/users/(?P<user_id>\\d+)/update/$', "
              "MobileUserUpdateView.as_view(), name='mobile_users_update'),\n") + RUTA_ANCLA


def leer(ruta):
    with open(ruta, 'r') as f:
        return f.read()


def escribir(ruta, texto, simulacro):
    if simulacro:
        return
    shutil.copy2(ruta, ruta + '.bak')
    with open(ruta, 'w') as f:
        f.write(texto)


def paso_vista(raiz, simulacro):
    ruta = os.path.join(raiz, 'src/apps/api/views/mobile_users.py')
    if not os.path.exists(ruta):
        return False, 'no existe {0}'.format(ruta)
    t = leer(ruta)
    if 'class MobileUserUpdateView' in t:
        return True, 'ya estaba'
    # Va detras de la vista de crear, que es la que comparte validaciones.
    ancla = 'class MobileUserResetPasswordView(_Base):'
    if ancla not in t:
        return False, 'no encuentro MobileUserResetPasswordView'
    t = t.replace(ancla, VISTA.strip('\n') + '\n\n\n' + ancla, 1)
    escribir(ruta, t, simulacro)
    return True, 'vista anadida'


def paso_urls(raiz, simulacro):
    ruta = os.path.join(raiz, 'src/apps/api/urls.py')
    if not os.path.exists(ruta):
        return False, 'no existe {0}'.format(ruta)
    t = leer(ruta)
    if 'MobileUserUpdateView' in t:
        return True, 'ya estaba'
    if IMPORT_VIEJO not in t:
        return False, 'el import de mobile_users no tiene la forma esperada'
    if RUTA_ANCLA not in t:
        return False, 'no encuentro la ruta de reset-password'
    t = t.replace(IMPORT_VIEJO, IMPORT_NUEVO, 1)
    t = t.replace(RUTA_ANCLA, RUTA_NUEVA, 1)
    escribir(ruta, t, simulacro)
    return True, 'import y ruta anadidos'


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--raiz', default='/var/www/envs/prod')
    p.add_argument('--dry-run', action='store_true')
    args = p.parse_args()

    pasos = [('vista', paso_vista), ('urls', paso_urls)]
    fallo = False
    for nombre, fn in pasos:
        ok, detalle = fn(args.raiz, args.dry_run)
        print('[{0}] {1}: {2}'.format('OK ' if ok else 'MAL', nombre, detalle))
        if not ok:
            fallo = True

    if fallo:
        print('\nNO se aplico todo. Revisa lo marcado como MAL antes de reiniciar.')
        sys.exit(1)
    if args.dry_run:
        print('\nSimulacro: no se escribio nada.')
    else:
        print('\\nListo. Reinicia jurp_web para que gunicorn lea el codigo nuevo.')


if __name__ == '__main__':
    main()
