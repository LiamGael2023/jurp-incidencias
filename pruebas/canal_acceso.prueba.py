# -*- coding: utf-8 -*-
"""Quien entra y quien no, segun el canal de su cuenta.

    python3 canal_acceso.prueba.py

PRUEBA EL CODIGO QUE SE VA A DESPLEGAR, no una copia: saca el modulo del
propio parche_canal_acceso.py y lo ejecuta con dobles de Django y de DRF. Si
alguien edita el parche y cambia la decision sin querer, esto lo dice aqui y
no en el servidor.

POR QUE ESTA PARTE Y NO OTRA. `puede_entrar` es lo unico de todo el cambio
que puede dejar a alguien fuera. Lo demas -la tabla, el endpoint, el boton-
falla de formas que se ven; esto falla dejando a un vigilante en el campo
sin poder abrir la app, que es la unica consecuencia que no se nota desde la
oficina.
"""

from __future__ import print_function

import os
import sys
import types


def dobles():
    """Django y DRF, lo minimo que importa el modulo."""
    rf = types.ModuleType('rest_framework')

    class Estado(object):
        HTTP_400_BAD_REQUEST = 400
        HTTP_403_FORBIDDEN = 403
        HTTP_404_NOT_FOUND = 404

    rf.status = Estado()

    dec = types.ModuleType('rest_framework.decorators')

    def _nada(*a, **k):
        def envoltura(f):
            return f
        return envoltura

    dec.api_view = _nada
    dec.permission_classes = _nada

    resp = types.ModuleType('rest_framework.response')

    class Response(object):
        def __init__(self, datos, status=200):
            self.data = datos
            self.status_code = status

    resp.Response = Response

    sys.modules['rest_framework'] = rf
    sys.modules['rest_framework.decorators'] = dec
    sys.modules['rest_framework.response'] = resp


class CanalDeAcceso(object):
    AMBOS, WEB, APP = 'ambos', 'web', 'app'

    class DoesNotExist(Exception):
        pass


def es_navegador(plataforma):
    """Copia fiel de la de equipo_enlazado.py: solo 'web' cuenta como web."""
    return (plataforma or '').strip().lower() == 'web'


def cargar_modulo():
    """El modulo tal y como lo escribe el parche, ya ejecutado."""
    aqui = os.path.dirname(os.path.abspath(__file__))
    sys.path.insert(0, aqui)
    import parche_canal_acceso

    dobles()
    espacio = {
        '__name__': 'canal_acceso',
        'CanalDeAcceso': CanalDeAcceso,
        'EsGerencia': object,
        'es_navegador': es_navegador,
    }
    fuente = parche_canal_acceso.MODULO
    # Los imports del proyecto no existen aqui; sus nombres ya estan puestos
    # arriba a mano. Se quitan las dos lineas y se deja el resto intacto.
    fuente = '\n'.join(
        l for l in fuente.splitlines()
        if not l.startswith('from .models')
        and not l.startswith('from .equipo_enlazado'))
    exec(compile(fuente, 'canal_acceso.py', 'exec'), espacio)
    return espacio


class Usuario(object):
    """Uno con fila, o uno sin ella (que es lo normal al desplegar)."""

    def __init__(self, canal):
        if canal is not None:
            fila = type('Fila', (object,), {'canal': canal})()
            self.canal_acceso = fila

    def __getattr__(self, nombre):
        if nombre == 'canal_acceso':
            raise CanalDeAcceso.DoesNotExist()
        raise AttributeError(nombre)


class UsuarioRoto(object):
    """Codigo aplicado y migracion no: consultar la tabla revienta."""

    @property
    def canal_acceso(self):
        raise Exception('relation "core_canaldeacceso" does not exist')


def main():
    espacio = cargar_modulo()
    puede_entrar = espacio['puede_entrar']
    AMBOS, WEB, APP = espacio['AMBOS'], espacio['WEB'], espacio['APP']

    casos = [
        # (canal guardado, plataforma de quien entra, debe entrar, titulo)
        (None, 'web', True, 'sin fila, desde la web'),
        (None, 'android', True, 'sin fila, desde la app'),
        (None, '', True, 'sin fila, app vieja (no manda plataforma)'),

        (AMBOS, 'web', True, 'ambos, desde la web'),
        (AMBOS, 'android', True, 'ambos, desde la app'),
        (AMBOS, '', True, 'ambos, app vieja'),

        (WEB, 'web', True, 'solo web, desde la web'),
        (WEB, 'WEB', True, 'solo web, en mayusculas'),
        (WEB, ' web ', True, 'solo web, con espacios'),
        (WEB, 'android', False, 'solo web, desde Android -> fuera'),
        (WEB, 'ios', False, 'solo web, desde iOS -> fuera'),
        # LA QUE IMPORTA: saltarse el limite no puede ser mandar un campo
        # DE MENOS, que es lo que sabe hacer cualquiera.
        (WEB, '', False, 'solo web, app vieja sin plataforma -> fuera'),
        (WEB, None, False, 'solo web, plataforma nula -> fuera'),

        (APP, 'android', True, 'solo app, desde Android'),
        (APP, 'ios', True, 'solo app, desde iOS'),
        (APP, '', True, 'solo app, app vieja'),
        (APP, 'web', False, 'solo app, desde la web -> fuera'),
    ]

    malos = 0
    for guardado, plataforma, esperado, titulo in casos:
        ok, motivo = puede_entrar(Usuario(guardado), plataforma)
        bien = (ok is esperado)
        if not bien:
            malos += 1
        print('  %s  %-44s entra=%-5s %s'
              % ('.' if bien else 'MAL', titulo, ok,
                 (motivo or {}).get('codigo', '')))

    # Sin tabla se abre, nunca se cierra: el fallo seguro de esto es dejar
    # entrar, porque el otro deja a la gente de campo tirada.
    ok, _ = puede_entrar(UsuarioRoto(), 'android')
    bien = ok is True
    if not bien:
        malos += 1
    print('  %s  %-44s entra=%s'
          % ('.' if bien else 'MAL', 'sin tabla (migracion sin correr)', ok))

    ok, _ = puede_entrar(None, 'web')
    bien = ok is True
    if not bien:
        malos += 1
    print('  %s  %-44s entra=%s'
          % ('.' if bien else 'MAL', 'sin usuario', ok))

    print('')
    print('fallos: %d de %d' % (malos, len(casos) + 2))
    return 1 if malos else 0


if __name__ == '__main__':
    sys.exit(main())
