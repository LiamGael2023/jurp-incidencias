# -*- coding: utf-8 -*-
"""La vista parcheada, contra PostgreSQL y DRF de verdad."""
import django, os, sys, types
from django.conf import settings

settings.configure(
    DEBUG=True, SECRET_KEY='x', USE_TZ=False, ALLOWED_HOSTS=['*'],
    INSTALLED_APPS=['django.contrib.contenttypes','django.contrib.auth',
                    'rest_framework','app'],
    DATABASES={'default': {'ENGINE':'django.db.backends.postgresql',
        'NAME':'pruebas_act','USER':'postgres','HOST':'127.0.0.1','PORT':'55432'}},
    REST_FRAMEWORK={'UNAUTHENTICATED_USER': None},
    ROOT_URLCONF='rutas',
)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import psycopg2
cn = psycopg2.connect(dbname='postgres', user='postgres', host='127.0.0.1', port=55432)
cn.autocommit = True
cu = cn.cursor()
cu.execute("DROP DATABASE IF EXISTS pruebas_act")
cu.execute("CREATE DATABASE pruebas_act")
cn.close()

django.setup()
from app.models import (Proyecto, Partida, ActividadObra,
    DailyPartHeavyEquipment, IncidentPersonnel, IncidentMaterial,
    DailyPartActivity, ModeloEquipo)

from django.core.management import call_command
call_command('migrate', run_syncdb=True, verbosity=0)

# Los checks de MODELOS de Django. Esto es lo que faltaba: un related_name
# repetido no se nota al escribir el modelo ni al consultarlo, se nota aqui,
# y si no se comprueba aqui se nota en el servidor, con la app entera sin
# arrancar y un SystemCheckError en cada manage.py.
from django.core import checks as _checks
_malos = [m for m in _checks.run_checks(tags=[_checks.Tags.models]) if m.is_serious()]
if _malos:
    print('  FALLA  los checks de modelos de Django:')
    for m in _malos[:6]:
        print('           %s %s' % (m.id, m.msg[:110]))
    raise SystemExit(1)
print('  OK     los checks de modelos pasan (related_name sin choques)')

# ── cargar la vista parcheada bajo el nombre que espera ──────────────────
import importlib.util
import os as _os
MOCK = _os.environ.get('VISTA') or _os.path.join(
    _os.path.dirname(_os.path.abspath(__file__)), 'views_actividades_obra.py')
fuente = (open(MOCK, encoding='utf-8').read()
          .replace('from .models import', 'from app.models import')
          .replace('from .views import', 'from app.views import'))
# La vista nueva hace `from .views import _liberar_maquina_de_parte`, asi
# que hay que ofrecerle un app.views con esa funcion.
_v = types.ModuleType('app.views')
def _liberar_maquina_de_parte(parte):
    m = ModeloEquipo.objects.filter(pk=parte.maquina_id).first()
    if m and m.estado != 0:
        m.estado = 0
        m.save(update_fields=['estado'])
        return m
    return None
_v._liberar_maquina_de_parte = _liberar_maquina_de_parte
sys.modules['app.views'] = _v

mod = types.ModuleType('app.vistas'); mod.__package__ = 'app'
exec(compile(fuente, MOCK, 'exec'), mod.__dict__)

from django.urls import path
rutas = types.ModuleType('rutas')
rutas.urlpatterns = [
    path('act/', mod.actividades_obra),
    path('act/resumen/', mod.actividades_obra_resumen),
    path('act/<int:pk>/cerrar-partes/', mod.terminar_actividad),
    path('act/<int:pk>/reabrir/', mod.reanudar_actividad),
]
sys.modules['rutas'] = rutas

# ── datos ────────────────────────────────────────────────────────────────
a = Proyecto.objects.create(codigo='Obras10_6', nombre='TRATAMIENTO TOMA 10.6')
b = Proyecto.objects.create(codigo='TOMA-11', nombre='SEGUNDO PROYECTO')
Partida.objects.create(obra='Obras10_6', proyecto=a.nombre, proyecto_ref=a,
                       codigo='01.01', descripcion='X', unidad='m3')

from rest_framework.test import APIClient
c = APIClient()
fallos = 0
def ok(cond, msg, extra=''):
    global fallos
    print(('  OK   ' if cond else '  FALLA') + '  ' + msg + ('   ' + str(extra) if extra else ''))
    if not cond: fallos += 1

print('\n== ALTA POR CLAVE (lo que manda la web) ==')
r = c.post('/act/', {'proyecto_id': a.id, 'nombre': 'Excavacion caja'}, format='json')
ok(r.status_code == 201, 'creada', r.status_code)
act = ActividadObra.objects.get(pk=r.data['id'])
ok(act.proyecto_ref_id == a.id, 'proyecto_ref relleno', act.proyecto_ref_id)
ok(act.obra == 'Obras10_6', 'obra copiada del proyecto', act.obra)
ok(act.proyecto == a.nombre, 'nombre largo copiado', act.proyecto)
ok(act.codigo == 'ACT-0001', 'correlativo', act.codigo)

print('\n== ALTA SOLO CON EL TEXTO (lo viejo) ==')
r = c.post('/act/', {'obra': 'Obras10_6', 'nombre': 'Relleno'}, format='json')
ok(r.status_code == 201, 'creada', r.status_code)
act2 = ActividadObra.objects.get(pk=r.data['id'])
ok(act2.proyecto_ref_id == a.id, 'tambien engancha proyecto_ref', act2.proyecto_ref_id)
ok(ActividadObra.objects.filter(proyecto_ref__isnull=True).count() == 0,
   'ninguna actividad nace suelta')

print('\n== PROYECTO QUE NO EXISTE ==')
r = c.post('/act/', {'proyecto_id': 9999, 'nombre': 'Z'}, format='json')
ok(r.status_code == 400, 'rechaza con 400', r.status_code)
ok('9999' in str(r.data), 'y dice cual', r.data)
r = c.post('/act/', {'proyecto_id': 'hola', 'nombre': 'Z'}, format='json')
ok(r.status_code == 400, 'un id que no es numero tampoco revienta', r.status_code)
ok(ActividadObra.objects.count() == 2, 'no se creo nada de eso',
   ActividadObra.objects.count())

print('\n== SIN PROYECTO ==')
r = c.post('/act/', {'nombre': 'Z'}, format='json')
ok(r.status_code == 400, 'rechaza', r.status_code)
ok('proyecto' in str(r.data).lower(), 'y lo nombra', r.data)

print('\n== FILTRAR POR CLAVE ==')
ActividadObra.objects.create(obra='TOMA-11', proyecto_ref=b, nombre='Otra',
                             codigo='ACT-0001')
ok(len(c.get('/act/?proyecto=%d' % a.id).data) == 2, 'proyecto A: 2')
ok(len(c.get('/act/?proyecto=%d' % b.id).data) == 1, 'proyecto B: 1')
ok(len(c.get('/act/').data) == 3, 'sin filtro: 3')
ok(len(c.get('/act/?obra=Obras10_6').data) == 2, 'el filtro viejo sigue valiendo')
ok(len(c.get('/act/?proyecto=%d&estado=terminada' % a.id).data) == 0,
   'se combina con el estado')

print('\n== RESUMEN ==')
d = c.get('/act/resumen/?proyecto=%d' % a.id).data
ok(d.get('total') == 2, 'total del proyecto A', d.get('total'))
d = c.get('/act/resumen/?proyecto=%d' % b.id).data
ok(d.get('total') == 1, 'total del proyecto B', d.get('total'))
d = c.get('/act/resumen/').data
ok(d.get('total') == 3, 'sin filtro', d.get('total'))

print('\n== UN PROYECTO SIN NADA ==')
r = c.get('/act/?proyecto=%d' % (b.id + 50))
ok(r.status_code == 200 and r.data == [], 'devuelve vacio, no un error',
   r.status_code)


print('\n== PARTIDAS DE LA ACTIVIDAD ==')
p1 = Partida.objects.create(obra='Obras10_6', proyecto_ref=a, codigo='01.02.04.01.01',
    descripcion='Excavacion manual', unidad='m3', metrado=173.54, precio=6.72)
p2 = Partida.objects.create(obra='Obras10_6', proyecto_ref=a, codigo='01.02.04.01.02',
    descripcion='Refine y nivelacion', unidad='m2', metrado=50, precio=4)
ajena = Partida.objects.create(obra='TOMA-11', proyecto_ref=b, codigo='01.01',
    descripcion='De otro proyecto', unidad='m3', metrado=10, precio=100)

r = c.post('/act/', {'proyecto_id': a.id, 'nombre': 'Excavar la caja',
                     'partidas': [p1.id, p2.id]}, format='json')
ok(r.status_code == 201, 'creada con partidas', r.status_code)
act3 = ActividadObra.objects.get(pk=r.data['id'])
ok(set(act3.partidas.values_list('id', flat=True)) == {p1.id, p2.id},
   'las dos quedaron enganchadas',
   list(act3.partidas.values_list('codigo', flat=True)))
esperado = round(173.54 * 6.72 + 50 * 4, 2)
ok(abs(r.data['presupuestado'] - esperado) < 0.01, 'presupuestado = suma metrado x precio',
   '%s vs %s' % (r.data['presupuestado'], esperado))
det = r.data['partidas_detalle']
ok(len(det) == 2 and det[0]['codigo'] == '01.02.04.01.01', 'detalle ordenado por codigo',
   [d['codigo'] for d in det])
ok(det[0]['unidad'] == 'm3' and abs(det[0]['importe'] - 1166.19) < 0.01,
   'el detalle trae unidad e importe', det[0])

print('\n== PARTIDA DE OTRO PROYECTO ==')
r = c.post('/act/', {'proyecto_id': a.id, 'nombre': 'Mezcla',
                     'partidas': [p1.id, ajena.id]}, format='json')
ok(r.status_code == 400, 'rechaza', r.status_code)
ok('TOMA-11' in str(r.data), 'y dice de cual es', r.data)
ok(not ActividadObra.objects.filter(nombre='Mezcla').exists(), 'no se creo nada')

print('\n== PARTIDA QUE NO EXISTE ==')
r = c.post('/act/', {'proyecto_id': a.id, 'nombre': 'Z', 'partidas': [p1.id, 99999]},
           format='json')
ok(r.status_code == 400, 'rechaza', r.status_code)
ok('99999' in str(r.data), 'y dice cual', r.data)
r = c.post('/act/', {'proyecto_id': a.id, 'nombre': 'Z', 'partidas': ['hola']},
           format='json')
ok(r.status_code == 400, 'un id que no es numero tampoco revienta', r.status_code)

print('\n== SIN PARTIDAS SE GUARDA IGUAL ==')
r = c.post('/act/', {'proyecto_id': a.id, 'nombre': 'Todavia sin definir'}, format='json')
ok(r.status_code == 201, 'creada', r.status_code)
ok(r.data['presupuestado'] == 0, 'presupuestado 0', r.data['presupuestado'])
ok(r.data['partidas_detalle'] == [], 'detalle vacio')

print('\n== EDITAR LAS PARTIDAS ==')
from django.urls import path as _p
rutas.urlpatterns.append(_p('act/<int:pk>/', mod.actividad_obra_detalle))
r = c.patch('/act/%d/' % act3.id, {'partidas': [p2.id]}, format='json')
ok(r.status_code == 200, 'PATCH ok', r.status_code)
act3.refresh_from_db()
ok(list(act3.partidas.values_list('id', flat=True)) == [p2.id],
   'se queda solo con la que se mando',
   list(act3.partidas.values_list('codigo', flat=True)))
r = c.patch('/act/%d/' % act3.id, {'partidas': [ajena.id]}, format='json')
ok(r.status_code == 400, 'y tampoco deja meter una de otro proyecto por PATCH',
   r.status_code)
act3.refresh_from_db()
ok(list(act3.partidas.values_list('id', flat=True)) == [p2.id],
   'la edicion rechazada no cambio nada')

print('\n== EL AVANCE SIGUE SALIENDO ==')
parte = DailyPartHeavyEquipment.objects.create(actividad_obra=act3)
DailyPartActivity.objects.create(parte=parte, partida=p2, metrado=20, metrado_unidad='m2')
d = c.get('/act/?proyecto=%d' % a.id).data
fila = [x for x in d if x['id'] == act3.id][0]
ok(abs(fila['avance']['valorizado'] - 80.0) < 0.01, '20 m2 x 4 = 80',
   fila['avance'])
ok(abs(fila['presupuestado'] - 200.0) < 0.01, 'contra 200 presupuestados',
   fila['presupuestado'])


print('\n== EJECUTADO Y SALDO POR PARTIDA ==')
# p1: 173.54 m3 a 6.72. Dos partes imputan 40 y 60 m3 -> 100 hechos, 73.54 de saldo
act4 = ActividadObra.objects.create(obra='Obras10_6', proyecto_ref=a, nombre='Excavar',
                                    codigo='ACT-9001')
act4.partidas.set([p1.id, p2.id])
pa = DailyPartHeavyEquipment.objects.create(actividad_obra=act4)
DailyPartActivity.objects.create(parte=pa, partida=p1, metrado=40, metrado_unidad='m3')
DailyPartActivity.objects.create(parte=pa, partida=p1, metrado=60, metrado_unidad='m3')
# una linea en OTRA unidad: no debe sumar
DailyPartActivity.objects.create(parte=pa, partida=p1, metrado=999, metrado_unidad='m2')

d = c.get('/act/?proyecto=%d' % a.id).data
fila = [x for x in d if x['id'] == act4.id][0]
det = {x['codigo']: x for x in fila['partidas_detalle']}
e1 = det['01.02.04.01.01']
ok(abs(e1['ejecutado'] - 100) < 0.001, 'ejecutado suma las dos lineas', e1['ejecutado'])
ok(abs(e1['saldo'] - 73.54) < 0.001, 'saldo = 173.54 - 100', e1['saldo'])
ok(abs(e1['avance'] - 100 / 173.54 * 100) < 0.02, 'avance %', e1['avance'])
ok(abs(e1['valorizado'] - 672.0) < 0.01, 'valorizado 100 x 6.72', e1['valorizado'])
ok(abs(e1['importe'] - 1166.19) < 0.01, 'importe presupuestado intacto', e1['importe'])
# p2 ya llevaba 20 m2 imputados por el parte de la prueba anterior: el
# ejecutado es de la OBRA, asi que esta actividad tambien los ve.
e2 = det['01.02.04.01.02']
ok(abs(e2['ejecutado'] - 20) < 0.001 and abs(e2['saldo'] - 30) < 0.001,
   'arrastra lo que ya habia imputado otra actividad', (e2['ejecutado'], e2['saldo']))

print('\n== EL SALDO ES DE LA OBRA, NO DE LA ACTIVIDAD ==')
otra = ActividadObra.objects.create(obra='Obras10_6', proyecto_ref=a,
                                    nombre='Otra que no toco nada', codigo='ACT-9002')
otra.partidas.set([p1.id])
d = c.get('/act/?proyecto=%d' % a.id).data
f2 = [x for x in d if x['id'] == otra.id][0]
o1 = f2['partidas_detalle'][0]
ok(abs(o1['ejecutado'] - 100) < 0.001,
   'otra actividad ve lo mismo ejecutado', o1['ejecutado'])
ok(abs(o1['saldo'] - 73.54) < 0.001, 'y el mismo saldo', o1['saldo'])

print('\n== PARTIDA CON METRADO 0 ==')
cero = Partida.objects.create(obra='Obras10_6', proyecto_ref=a, codigo='99.99',
    descripcion='Sin metrado', unidad='glb', metrado=0, precio=10)
act5 = ActividadObra.objects.create(obra='Obras10_6', proyecto_ref=a, nombre='X',
                                    codigo='ACT-9003')
act5.partidas.set([cero.id])
d = c.get('/act/?proyecto=%d' % a.id).data
f3 = [x for x in d if x['id'] == act5.id][0]
ok(f3['partidas_detalle'][0]['avance'] is None, 'avance None, no division por cero',
   f3['partidas_detalle'][0]['avance'])


print('\n== TERMINAR CIERRA LOS PARTES Y LIBERA LAS MAQUINAS ==')
maq = ModeloEquipo.objects.create(codigo='EX02', estado=1)
maq2 = ModeloEquipo.objects.create(codigo='EX03', estado=1)
act6 = ActividadObra.objects.create(obra='Obras10_6', proyecto_ref=a,
                                    nombre='Para terminar', codigo='ACT-9100')
p_abierto = DailyPartHeavyEquipment.objects.create(actividad_obra=act6, maquina=maq,
                                                   cerrado=False)
p_cerrado = DailyPartHeavyEquipment.objects.create(actividad_obra=act6, maquina=maq2,
                                                   cerrado=True)
r = c.post('/act/%d/cerrar-partes/' % act6.id)
ok(r.status_code == 200, 'termina', r.status_code)
ok(r.data['cerrados'] == 1, 'cierra solo el parte que estaba abierto', r.data['cerrados'])
ok(r.data['maquinas_liberadas'] == ['EX02'], 'y libera su maquina',
   r.data['maquinas_liberadas'])
p_abierto.refresh_from_db(); maq.refresh_from_db(); maq2.refresh_from_db()
ok(p_abierto.cerrado is True, 'el parte queda cerrado')
ok(p_abierto.fecha_cierre is not None, 'con fecha de cierre')
ok(maq.estado == 0, 'la maquina del parte abierto queda disponible', maq.estado)
ok(maq2.estado == 1, 'la del parte que YA estaba cerrado no se toca', maq2.estado)
act6.refresh_from_db()
ok(act6.estado == 'terminada', 'y la actividad queda terminada', act6.estado)

print('\n== TERMINAR DOS VECES NO HACE NADA ==')
maq.estado = 1; maq.save()
r = c.post('/act/%d/cerrar-partes/' % act6.id)
ok(r.data['cerrados'] == 0, 'no cierra nada que ya este cerrado', r.data['cerrados'])
ok(r.data['maquinas_liberadas'] == [], 'ni libera dos veces',
   r.data['maquinas_liberadas'])
maq.refresh_from_db()
ok(maq.estado == 1, 'la maquina que alguien reclamo despues sigue ocupada', maq.estado)

print('\n== REANUDAR NO REABRE LOS PARTES ==')
r = c.post('/act/%d/reabrir/' % act6.id)
ok(r.status_code == 200, 'reanuda', r.status_code)
act6.refresh_from_db(); p_abierto.refresh_from_db()
ok(act6.estado == 'ejecucion', 'vuelve a ejecucion', act6.estado)
ok(p_abierto.cerrado is True, 'pero el parte sigue cerrado: su maquina ya es de otro')

print('\n== UNA ACTIVIDAD QUE NO EXISTE ==')
ok(c.post('/act/99999/cerrar-partes/').status_code == 404, 'terminar da 404')
ok(c.post('/act/99999/reabrir/').status_code == 404, 'reabrir da 404')


print('\n== UNA SOLA PARTIDA ==')
# El caso que fallaba: la lista de un elemento se aplanaba a un numero suelto
# y el alta respondia "tienen que venir como ids" habiendo mandado ids. Con
# dos o mas nunca paso, y por eso no se veia.
r = c.post('/act/', {'proyecto_id': a.id, 'nombre': 'Con una sola',
                     'partidas': [p1.id]}, format='json')
ok(r.status_code == 201, 'se crea con UNA partida', 
   r.status_code if r.status_code == 201 else r.data)
if r.status_code == 201:
    una = ActividadObra.objects.get(pk=r.data['id'])
    ok(list(una.partidas.values_list('id', flat=True)) == [p1.id],
       'y queda enganchada', list(una.partidas.values_list('codigo', flat=True)))
    ok(abs(r.data['presupuestado'] - round(173.54 * 6.72, 2)) < 0.01,
       'con su presupuestado', r.data['presupuestado'])

print('\n== SIN NINGUNA PARTIDA ==')
r = c.post('/act/', {'proyecto_id': a.id, 'nombre': 'Sin ninguna',
                     'partidas': []}, format='json')
ok(r.status_code == 201, 'tambien se crea', r.status_code)
ok(r.data.get('presupuestado') == 0, 'con presupuestado 0', r.data.get('presupuestado'))

print('\n== Y LOS CAMPOS NORMALES SIGUEN APLANANDOSE ==')
# Un formulario manda cada campo como lista de uno. Si se dejara de aplanar,
# el nombre llegaria como ['x'] y se guardaria con corchetes.
r = c.post('/act/', {'proyecto_id': str(a.id), 'nombre': 'Desde formulario',
                     'ubicacion_text': 'Prog 1+000'})
ok(r.status_code == 201, 'alta por formulario', r.status_code)
if r.status_code == 201:
    f = ActividadObra.objects.get(pk=r.data['id'])
    ok(f.nombre == 'Desde formulario', 'el nombre llega limpio, sin corchetes',
       repr(f.nombre))
    ok(f.ubicacion_text == 'Prog 1+000', 'y la zona tambien', repr(f.ubicacion_text))

print('\n' + ('>>> %d FALLAN' % fallos if fallos else '>>> TODO BIEN') + '\n')
sys.exit(1 if fallos else 0)
