# -*- coding: utf-8 -*-
"""Qué hace falta saber para separar «entra por la web» de «entra por la app».

    python3 ver_canales_acceso.py                      # /var/www/envs/prod
    python3 ver_canales_acceso.py --raiz /otra/ruta

SOLO LEE. No escribe, no migra, no reinicia nada. Se corre en el servidor de
PLUVIRA, en la máquina donde vive el proyecto (el mismo sitio donde se
aplicó parche_editar_usuario.py).

POR QUÉ ANTES DEL PARCHE. El login ya recibe `plataforma` y ya hay una
comprobación metida justo antes de crear el token —la del celular enlazado—.
El bloqueo por canal va al lado de esa, y el valor hay que devolverlo en la
lista de usuarios. Las dos cosas son injertos en código que ya funciona y que
sostiene a toda la gente de campo: pegar a ciegas en el sitio equivocado deja
a PLUVIRA sin arrancar.

Lo que se imprime es exactamente lo que el parche necesita anclar, y nada
más: ni claves, ni datos de nadie.
"""

from __future__ import print_function

import argparse
import os
import re
import sys


def leer(ruta):
    try:
        with open(ruta, 'r') as f:
            return f.read()
    except Exception as e:                      # noqa: BLE001
        return None


def titulo(n, texto):
    print('')
    print('=' * 74)
    print('%d. %s' % (n, texto))
    print('=' * 74)


def trozo(texto, desde, hasta=None, limite=120):
    """Las líneas entre dos marcas, para no volcar el archivo entero."""
    if texto is None:
        return '  (no se pudo leer)'
    lineas = texto.splitlines()
    ini = None
    for i, l in enumerate(lineas):
        if desde in l:
            ini = i
            break
    if ini is None:
        return '  (no encontré %r)' % desde
    fin = len(lineas)
    if hasta:
        for j in range(ini + 1, len(lineas)):
            if hasta in lineas[j]:
                fin = j
                break
    fin = min(fin, ini + limite)
    return '\n'.join('  %4d | %s' % (k + 1, lineas[k]) for k in range(ini, fin))


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--raiz', default='/var/www/envs/prod')
    args = p.parse_args()
    raiz = args.raiz

    f_users = os.path.join(raiz, 'src/apps/api/views/mobile_users.py')
    f_auth = os.path.join(raiz, 'src/apps/api/views/mobile_auth.py')
    f_urls = os.path.join(raiz, 'src/apps/api/urls.py')
    f_modelos = os.path.join(raiz, 'src/apps/core/models.py')
    f_enlace = os.path.join(raiz, 'src/apps/core/equipo_enlazado.py')

    print('Raíz: %s' % raiz)
    for f in (f_users, f_auth, f_urls, f_modelos, f_enlace):
        print('  %s  %s' % ('SI ' if os.path.isfile(f) else 'NO ', f))

    # ── 1 ────────────────────────────────────────────────────────────────
    titulo(1, 'mobile_users.py: QUE CLASES HAY Y COMO SE SERIALIZA')
    t = leer(f_users)
    if t is None:
        print('  (no se pudo leer)')
    else:
        print('  Clases y funciones de módulo:')
        for m in re.finditer(r'^(class |def )(\w+)', t, re.M):
            print('    %s%s' % (m.group(1), m.group(2)))
        print('')
        print('  --- _serialize (el parche le añade un campo) ---')
        print(trozo(t, 'def _serialize', 'class ', limite=45))
        print('')
        print('  --- la clase base: de ahí salen el permiso y _get_target ---')
        print(trozo(t, 'class _Base', 'class Mobile', limite=60))

    # ── 2 ────────────────────────────────────────────────────────────────
    titulo(2, 'mobile_users.py: LA VISTA DE ROL (el molde del parche)')
    # La vista nueva hace lo mismo que esta: comprueba, guarda y borra el
    # token. Copiar su forma evita inventar un contrato distinto.
    print(trozo(t, 'class MobileUserChangeRoleView', 'class MobileUserToggleActiveView',
                limite=60))
    print('')
    print('  --- y la de crear, que es donde entraría el canal inicial ---')
    print(trozo(t, 'class MobileUserCreateView', 'class MobileUser', limite=80))

    # ── 3 ────────────────────────────────────────────────────────────────
    titulo(3, 'urls.py: EL IMPORT Y LAS RUTAS DE USUARIOS')
    t_urls = leer(f_urls)
    if t_urls is None:
        print('  (no se pudo leer)')
    else:
        print(trozo(t_urls, 'from src.apps.api.views.mobile_users import', ')', limite=20))
        print('')
        print('  --- las rutas v1/mobile/users ---')
        for i, l in enumerate(t_urls.splitlines()):
            if 'mobile/users' in l or 'mobile_users' in l:
                print('  %4d | %s' % (i + 1, l))

    # ── 4 ────────────────────────────────────────────────────────────────
    titulo(4, 'mobile_auth.py: DONDE SE DECIDE SI ENTRA')
    t_auth = leer(f_auth)
    if t_auth is None:
        print('  (no se pudo leer)')
    else:
        print('  ¿Está aplicado el parche del celular enlazado?  %s'
              % ('SI' if 'registrar_ingreso' in t_auth else 'NO'))
        print('  Veces que aparece «Token.objects.get_or_create»: %d'
              % t_auth.count('Token.objects.get_or_create(user=user)'))
        print('')
        print('  --- cada puerta, desde su clase hasta el token ---')
        for m in re.finditer(r'^class (\w+)', t_auth, re.M):
            print('')
            print('  ### %s' % m.group(1))
            print(trozo(t_auth, 'class %s' % m.group(1), 'Token.objects.get_or_create',
                        limite=70))
        print('')
        print('  --- y las líneas del token con su contexto ---')
        lineas = t_auth.splitlines()
        for i, l in enumerate(lineas):
            if 'Token.objects.get_or_create' in l:
                a, b = max(0, i - 14), min(len(lineas), i + 4)
                for k in range(a, b):
                    print('  %4d | %s' % (k + 1, lineas[k]))
                print('  ' + '-' * 60)

    # ── 5 ────────────────────────────────────────────────────────────────
    titulo(5, 'core: DONDE GUARDAR EL CANAL')
    t_mod = leer(f_modelos)
    if t_mod is None:
        print('  (no se pudo leer)')
    else:
        print('  Modelos declarados:')
        for m in re.finditer(r'^class (\w+)\(([^)]*)\)', t_mod, re.M):
            print('    %s(%s)' % (m.group(1), m.group(2)))
        print('')
        print('  ¿Hay ya algún perfil enlazado al usuario? (OneToOne a User)')
        for i, l in enumerate(t_mod.splitlines()):
            if 'OneToOne' in l:
                print('  %4d | %s' % (i + 1, l))
        print('')
        print('  --- cabecera del archivo: imports y app_label ---')
        print('\n'.join('  %4d | %s' % (i + 1, l)
                        for i, l in enumerate(t_mod.splitlines()[:25])))

    print('')
    print('  --- migraciones de core (para saber de cuál depende la nueva) ---')
    dir_mig = os.path.join(raiz, 'src/apps/core/migrations')
    if os.path.isdir(dir_mig):
        for n in sorted(os.listdir(dir_mig)):
            if n.endswith('.py') and n != '__init__.py':
                print('    %s' % n)
    else:
        print('    (no existe %s)' % dir_mig)

    # ── 6 ────────────────────────────────────────────────────────────────
    titulo(6, 'equipo_enlazado.py: LA FUNCION QUE YA SABE QUE ES LA WEB')
    t_enl = leer(f_enlace)
    if t_enl is None:
        print('  (no existe: entonces el parche del celular no está aplicado)')
    else:
        print(trozo(t_enl, 'def es_navegador', 'def ', limite=18))
        print('')
        print('  Constante WEB:')
        for i, l in enumerate(t_enl.splitlines()):
            if re.match(r'^WEB\s*=', l):
                print('  %4d | %s' % (i + 1, l))

    # ── 7 ────────────────────────────────────────────────────────────────
    titulo(7, 'VERSIONES')
    try:
        import django
        print('  Django : %s' % django.get_version())
    except Exception:
        print('  Django : no importable desde aquí (da igual: basta el de abajo)')
    print('  Python : %s' % sys.version.split()[0])
    req = leer(os.path.join(raiz, 'requirements.txt'))
    if req:
        for l in req.splitlines():
            if re.match(r'(?i)^(django|djangorestframework)', l.strip()):
                print('  req    : %s' % l.strip())

    print('')
    print('=' * 74)
    print('Pégame la salida entera y escribo el parche.')
    print('=' * 74)


if __name__ == '__main__':
    main()
