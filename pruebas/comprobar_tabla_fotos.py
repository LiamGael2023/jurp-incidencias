# -*- coding: utf-8 -*-
"""
Comprueba que la tabla de fotos está como Django la espera.

    docker compose exec -T web python manage.py shell < comprobar_tabla_fotos.py

NO CREA NADA: la crea crear_tabla_fotos.sql, que se pasa como superusuario
porque `gis_app` no tiene DDL sobre el esquema. Este guion solo mira, y mira
lo que importa.

QUÉ COMPRUEBA Y POR QUÉ ESO
---------------------------
Que la tabla exista no demuestra gran cosa. Lo que hay que demostrar es que
el modelo, el router, el esquema y el search_path están de acuerdo, y eso
solo lo dice el ORM haciendo de verdad lo que hará la API:

  1. Columna por columna contra el modelo. Una que falte no da error al
     crear la tabla: lo da al guardar la primera foto, en campo y con el
     inspector delante.
  2. Un SELECT por el ORM, que es lo que hace el listado.
  3. Un INSERT y un DELETE de prueba, que es lo que hace la subida. Sin
     esto no se sabe si a `gis_app` le dieron permiso de escritura, y ese
     fallo aparecería con la primera foto de campo, no aquí.
"""

from django.db import connections

from inventario.models import FotoActivo

TABLA = 'inventario_foto_activo'
problemas = []

# ── 1. columnas ───────────────────────────────────────────────────────────
esperadas = {}
for campo in FotoActivo._meta.get_fields():
    col = getattr(campo, 'column', None)
    if col:
        esperadas[col] = campo.get_internal_type()

with connections['gis'].cursor() as cur:
    cur.execute("""
        SELECT column_name, data_type, character_maximum_length
          FROM information_schema.columns
         WHERE table_schema = 'inventario' AND table_name = %s
         ORDER BY ordinal_position
    """, [TABLA])
    reales = cur.fetchall()

if not reales:
    print('[MAL] la tabla no existe en el esquema inventario de jurp_gis.')
    print('      Pasa antes crear_tabla_fotos.sql como superusuario.')
else:
    print('Columnas en la base:')
    for nombre, tipo, largo in reales:
        print('  {0:<12} {1}{2}'.format(
            nombre, tipo, '({0})'.format(largo) if largo else ''))

    nombres = {r[0] for r in reales}
    faltan = set(esperadas) - nombres
    sobran = nombres - set(esperadas)
    if faltan:
        problemas.append('al modelo le faltan columnas: {0}'.format(
            sorted(faltan)))
    if sobran:
        print('\n[AVISO] columnas que el modelo no conoce: {0}'.format(
            sorted(sobran)))

# ── 2. leer ───────────────────────────────────────────────────────────────
try:
    n = FotoActivo.objects.count()
    print('\n[OK] el ORM la lee: {0} foto(s) guardadas'.format(n))
except Exception as e:                                        # noqa: BLE001
    problemas.append('el ORM no la lee: {0}'.format(e))

# ── 3. escribir ───────────────────────────────────────────────────────────
# Con un fid imposible, para que si algo saliera mal y la fila se quedara,
# no apareciera colgando de ninguna estructura de verdad.
if not problemas:
    try:
        prueba = FotoActivo.objects.create(
            tipo_activo='_prueba_', activo_fid=-1,
            imagen='inventario/_prueba_/-1/comprobacion.jpg',
            descripcion='fila de comprobacion, se borra sola')
        FotoActivo.objects.filter(pk=prueba.pk).delete()
        print('[OK] el ORM escribe y borra: gis_app tiene permisos')
    except Exception as e:                                    # noqa: BLE001
        problemas.append('gis_app no puede escribir: {0}'.format(e))

print('')
if problemas:
    for p in problemas:
        print('[MAL] {0}'.format(p))
else:
    print('Todo en orden. Reinicia web y el endpoint deberia dar 200.')
