# -*- coding: utf-8 -*-
"""Donde revienta monitoreo.py, con el traceback entero.

    docker exec -i jurp_web python manage.py shell < ver_monitoreo_500.py

SOLO LEE Y DESHACE. La unica escritura que hace va dentro de una
transaccion que se revierte siempre, asi que no deja ni una rutina.

POR QUE ASI Y NO MIRANDO EL LOG. El log tambien sirve, pero da UNA pila: la
de lo ultimo que fallo. Esto prueba cada pieza por separado y dice cuales
estan bien, que es lo que acota el problema en vez de describirlo.
"""

from __future__ import print_function

import traceback

from django.contrib.auth import get_user_model
from django.db import transaction


def probar(titulo, fn):
    print('')
    print('-' * 70)
    print(titulo)
    print('-' * 70)
    try:
        r = fn()
        print('  OK   %s' % (repr(r)[:400],))
        return True
    except Exception:
        print('  REVIENTA:')
        for l in traceback.format_exc().splitlines():
            print('    %s' % l)
        return False


print('=' * 70)
print('DONDE REVIENTA monitoreo.py')
print('=' * 70)

probar('0. importar el modulo',
       lambda: __import__('src.apps.core.monitoreo',
                          fromlist=['monitoreo']).__name__)

from src.apps.core import monitoreo as M
from src.apps.core.models import (ResponsableTramo, RutinaMonitoreo,
                                  TramoDeRutina, VisitaMonitoreo)

Usuario = get_user_model()

probar('1. las cuatro tablas responden',
       lambda: {'contactos': ResponsableTramo.objects.count(),
                'rutinas': RutinaMonitoreo.objects.count(),
                'tramos': TramoDeRutina.objects.count(),
                'visitas': VisitaMonitoreo.objects.count()})

probar('2. el cuadro sembrado (debe dar 30 en 14 tramos)',
       lambda: sorted(set(ResponsableTramo.objects
                          .values_list('tramo', flat=True))))

probar('3. _contactos("0")', lambda: M._contactos('0'))

alguien = [None]


def tomar_usuario():
    u = Usuario.objects.filter(groups__name='mobile_gerencia',
                               is_active=True).first()
    if u is None:
        u = Usuario.objects.first()
    alguien[0] = u
    return {'id': u.pk, 'username': u.get_username()}


probar('4. hay alguien en mobile_gerencia', tomar_usuario)

# Lo que comparten candidatos/ y crear, y que la lista vacia nunca toca.
probar('5. _nombre(usuario)', lambda: M._nombre(alguien[0]))
probar('6. _persona(usuario)', lambda: M._persona(alguien[0]))
probar('7. _persona(None)', lambda: M._persona(None))

probar('8. la consulta de candidatos/',
       lambda: [M._persona(u) for u in
                Usuario.objects.filter(groups__name='mobile_gerencia',
                                       is_active=True).order_by('username')])


def crear_y_deshacer():
    """Crea una rutina de mentira, la serializa, y lo deshace todo."""
    salida = {}
    try:
        with transaction.atomic():
            r = RutinaMonitoreo.objects.create(
                nombre='PRUEBA - borrar', fecha_inicio='2026-11-01',
                fecha_fin='2026-11-30', notas='', creada_por=alguien[0])
            salida['rutina_creada'] = r.pk
            for t in M.TRAMOS_CANAL:
                TramoDeRutina.objects.create(rutina=r, tramo=t)
            salida['tramos_creados'] = r.tramos.count()
            # Esto es lo que devuelve el endpoint, y donde puede morir.
            salida['serializa'] = bool(M._rutina(r, con_tramos=True))
            raise RuntimeError('__deshacer__')
    except RuntimeError as e:
        if str(e) != '__deshacer__':
            raise
    return salida


probar('9. crear una rutina entera y serializarla (se deshace)',
       crear_y_deshacer)

probar('10. _rutina() sobre lo que ya existe',
       lambda: [M._rutina(r) for r in RutinaMonitoreo.objects.all()[:3]])

print('')
print('=' * 70)
print('No quedo nada escrito: rutinas en la base = %d'
      % RutinaMonitoreo.objects.count())
print('Pegame la salida entera.')
print('=' * 70)
