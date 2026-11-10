# -*- coding: utf-8 -*-
"""
Los datos del Formato B-9, leidos de la base.

Va junto a reportes_ana.py en /opt/jurp-gis/ y le pide prestado `consultar()`
y `CABECERA`. Lo usa reportes_b9_pdf.py.

    python3 reportes_b9_datos.py --comprobar        # imprime y contrasta

QUE SE CORRIGE RESPECTO DEL EXCEL DE HOY
----------------------------------------
`generar_b9()` en reportes_ana.py arma la misma hoja en Excel, pero con
cuatro diferencias que aqui no se repiten:

  1. Pone las TOMAS LATERALES en la fila del Sector Hidraulico Mayor. Son
     del Lateral 10, que es del Menor; en la hoja oficial van en el bloque
     de abajo.
  2. Deja vacios CANAL DE DERIVACION y CANAL PRINCIPAL, que en la hoja
     oficial llevan los 155 km del Canal Madre y los 20.05 del Lateral 10.
  3. Del LATERAL DE 2do ORDEN solo escribe la denominacion: el bloque mide
     una columna en vez de cinco, asi que se pierde su kilometraje aunque
     la consulta ya lo trae.
  4. El `Rustica` lo calcula como total menos permanentes, que es correcto
     mientras `tipo` solo valga 'Pe' o 'Ru'; aqui se cuenta cada uno y se
     avisa si la resta no cuadra.

DE DONDE SALE CADA NUMERO
-------------------------
  BOCATOMAS ................ inventario.bocatomas
  TOMAS DIRECTAS CM PECH ... inventario.tomas_otros_sectores
  TOMAS LATERALES .......... inventario.tomas_l10
  CANAL DE DERIVACION ...... inventario.canal_madre_pech (geometria)
  CANAL PRINCIPAL .......... inventario.canal_lateral_10_2025, capa
                             «Alineamiento» (geometria)
  LATERAL 1er / 2do ORDEN .. inventario.redes_presurizado (orden, longitud__)
  OBRAS DE ARTE ............ una tabla por tipo, contando por ambito
  RESERVORIOS .............. inventario.reservorios (volumen)

`Disipador de Impacto` no tiene tabla en el esquema: sale en cero y se
avisa. `Otros` suma las camaras rompepresion, que es lo unico que queda
fuera de las columnas con nombre propio.

POR QUE LOS CANALES SE MIDEN SOBRE EL MAPA
------------------------------------------
`canal_madre_pech.longitud` no es lo que su nombre promete: sus 114 tramos
suman 353.15 km por esa columna y 157.36 km midiendo la geometria, contra
los 155 de la hoja oficial. Sea lo que sea ese campo —progresiva
acumulada, longitud de otra cosa— no es el largo del tramo, asi que el
kilometraje sale de `ST_Length`.

`canal_lateral_10_2025` es un volcado de CAD con cuatro capas. Solo
«Alineamiento» es el eje del canal, y mide 20.05 km, exactamente lo que
dice la hoja. Sin filtrar por capa se le suman el camino de servicio y el
Canal Evacuador y salen 31.75. Esa tabla no trae `material`, asi que el
kilometraje entero va a la columna «Revestido»: es lo que declara la hoja
oficial del Lateral 10 y no hay en la base nada que lo contradiga.
"""

import argparse
import os
import sys
import textwrap


# Un activo es «permanente» cuando `tipo` vale 'Pe'; el resto es rustica.
PERMANENTE = 'Pe'

# Las obras de arte de la segunda tabla: clave del formato → tabla.
OBRAS = [
    ('alcantarilla',      'alcantarilla'),
    ('canoas',            'canoas'),
    ('puente_vehicular',  'puente_vehicular'),
    ('puente_peatonal',   'puente_peatonal'),
    ('desarenador',       'desarenadores'),
    ('aliviadero',        'aliviadero'),
    ('partidor',          'partidor'),
    ('entregas',          'entregas'),
    ('sifon',             'sifon'),
    ('disipador',         None),            # no hay tabla: sale en cero
    ('pases_tuberias',    'pases_de_tuberias'),
    ('cajas_hidraulicas', 'cajas_hidraulicas'),
    ('otros',             'camara_rompepresion'),
]

# El ambito de cada sector de la primera tabla.
AMBITO_MAYOR = 'PECH'
AMBITO_MENOR = 'JURP'

NOMBRE_MAYOR = 'Sector Hidráulico Mayor CHAVIMOCHIC'
NOMBRE_MENOR = 'Sector Hidráulico Menor Riego Presurizado Moche Viru Chao'

# UTM 17 Sur: las longitudes se miden ahi y no en grados. Transformar una
# geometria que ya esta en 32717 no cuesta nada, asi que vale para las dos.
UTM = 32717

# La capa del volcado CAD que es el eje del Lateral 10. Las otras tres son
# el camino de servicio y el Canal Evacuador.
CAPA_EJE = 'Alineamiento'
CAPA_EVACUADOR = 'C-ROAD'


def _f(v, por_defecto=0.0):
    try:
        return float(v)
    except (TypeError, ValueError):
        return por_defecto


def _i(v, por_defecto=0):
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return por_defecto


def _una(filas, columnas=1):
    """La primera fila de un resultado, o una tupla de ceros."""
    if filas and filas[0]:
        return filas[0]
    return ('0',) * columnas


def _filtro(ambito, alias=''):
    pre = f'{alias}.' if alias else ''
    return f"WHERE {pre}ambito = '{ambito}'" if ambito else ''


# ── bloques de la primera tabla ───────────────────────────────────────────

def _captacion(R, tabla, ambito=None, avisos=None):
    """(total, permanentes, rusticas) de una tabla de obras de captacion."""
    r = _una(R.consultar(
        f"SELECT count(*), "
        f"count(*) FILTER (WHERE tipo = '{PERMANENTE}'), "
        f"count(*) FILTER (WHERE tipo IS DISTINCT FROM '{PERMANENTE}') "
        f"FROM inventario.{tabla} {_filtro(ambito)};"), 3)
    total, perm, rust = _i(r[0]), _i(r[1]), _i(r[2])
    if avisos is not None and perm + rust != total:
        avisos.append(f'{tabla}: {perm} permanentes + {rust} rusticas '
                      f'no suman {total}')
    return (total, perm, rust)


def _canal(R, tabla, ambito=None, donde='', con_material=True):
    """(revestido, sin revestir, total) en km, medidos sobre la geometria.

    El criterio de «revestido» es el mismo que usa el Excel: un tramo con
    material declarado esta revestido; sin material, no. Es lo que hay en la
    base, no una interpretacion nueva. `con_material=False` es para las
    capas que no declaran material: todo el kilometraje va a «revestido»,
    que es lo que dice la hoja oficial de esos canales.
    """
    cond = [c for c in (_filtro(ambito).replace('WHERE ', ''), donde) if c]
    where = ('WHERE ' + ' AND '.join(cond)) if cond else ''
    largo = f'ST_Length(ST_Transform(geom, {UTM}))'
    if not con_material:
        r = _una(R.consultar(f"""
            SELECT round(sum({largo})::numeric / 1000, 2)
            FROM inventario.{tabla} {where};"""))
        return (_f(r[0]), 0.0, _f(r[0]))
    r = _una(R.consultar(f"""
        SELECT round((sum({largo}) FILTER (WHERE material IS NOT NULL))
                     ::numeric / 1000, 2),
               round((sum({largo}) FILTER (WHERE material IS NULL))
                     ::numeric / 1000, 2),
               round(sum({largo})::numeric / 1000, 2)
        FROM inventario.{tabla} {where};"""), 3)
    return (_f(r[0]), _f(r[1]), _f(r[2]))


def _avisar_evacuador(R, menor, avisos):
    """Avisa si el Canal Evacuador esta dibujado pero no inventariado.

    En la hoja de 2025 el Canal Evacuador figura como un lateral de 1er
    orden con 7.33 km. En `redes_presurizado` no esta: existe solo como una
    capa del volcado CAD. No se inventa aqui la fila —seria mezclar dos
    fuentes y dar por inventariado lo que no lo esta— pero callarlo haria
    que el formato saliera con 7 km de menos sin que nadie se entere.
    """
    if any('evacuador' in (l[3] or '').lower() for l in menor['orden1']):
        return
    r = _una(R.consultar(f"""
        SELECT round(sum(ST_Length(ST_Transform(geom, {UTM})))::numeric
                     / 1000, 2)
        FROM inventario.canal_lateral_10_2025
        WHERE layer = '{CAPA_EVACUADOR}';"""))
    km = _f(r[0])
    if km > 0:
        avisos.append(
            f'el Canal Evacuador ({km} km) esta dibujado en el CAD pero no '
            f'inventariado en redes_presurizado: no sale como lateral')


def _laterales(R, orden, ambito=None):
    """Un renglon por lateral: (revestido, sin revestir, total, nombre).

    Misma consulta que el Excel —mismo GROUP BY y mismo orden— para que las
    dos salidas listen los laterales igual.
    """
    cond = ["orden = '%s'" % orden, 'nombre_de1 IS NOT NULL']
    if ambito:
        cond.append(f"ambito = '{ambito}'")
    filas = R.consultar(f"""
        SELECT nombre_de1,
               round((sum(longitud__) FILTER (WHERE material IS NOT NULL))
                     ::numeric / 1000, 2),
               round((sum(longitud__) FILTER (WHERE material IS NULL))
                     ::numeric / 1000, 2),
               round(sum(longitud__)::numeric / 1000, 2)
        FROM inventario.redes_presurizado
        WHERE {' AND '.join(cond)}
        GROUP BY nombre_de1 ORDER BY min(un);""") or []
    return [(_f(f[1]), _f(f[2]), _f(f[3]), f[0]) for f in filas if len(f) >= 4]


# ── segunda y tercera tabla ───────────────────────────────────────────────

def _obras_de_arte(R, ambito=None, avisos=None):
    cuenta = {}
    for clave, tabla in OBRAS:
        if not tabla:
            cuenta[clave] = 0
            if avisos is not None:
                avisos.append(f'{clave}: no hay tabla en el esquema, va en 0')
            continue
        r = R.consultar(
            f"SELECT count(*) FROM inventario.{tabla} {_filtro(ambito)};")
        if r is None:
            cuenta[clave] = 0
            if avisos is not None:
                avisos.append(f'{clave}: fallo la consulta sobre {tabla}')
        else:
            cuenta[clave] = _i(_una(r)[0])
    return cuenta


def _reservorios(R, ambito=None, avisos=None):
    """[(capacidad en hm3, denominacion)], en el orden de la base.

    `volumen_m` viene en metros cubicos. Se divide entre un millon para
    dejarlo en hm3, que es la unidad de la columna del formato. Si algun
    valor ya viniera en hm3 —menor que 1000— la division lo dejaria en
    cero, asi que ese caso se avisa en vez de callarlo.
    """
    filas = R.consultar(f"""
        SELECT coalesce(nombre, ''), volumen_m
        FROM inventario.reservorios {_filtro(ambito)}
        ORDER BY fid;""") or []
    salida = []
    for f in filas:
        if len(f) < 2:
            continue
        m3 = _f(f[1])
        if avisos is not None and 0 < m3 < 1000:
            avisos.append(f'reservorio {f[0]}: volumen {m3} parece venir ya '
                          f'en hm3 y no en m3')
        salida.append((round(m3 / 1e6, 3), f[0]))
    return salida


# ── la lectura completa ───────────────────────────────────────────────────

def leer_datos(R, ambito='todos', campania=None, avisos=None):
    """Todo lo que necesita la hoja, en la forma que espera el dibujante.

    `campania` se acepta por simetria con el resto de los formatos pero no
    se usa todavia: el B-9 es un conteo de infraestructura, no un estado, y
    las evaluaciones no cambian cuantas tomas hay.
    """
    avisos = avisos if avisos is not None else []
    amb = None if ambito in (None, '', 'todos') else ambito
    quiere_mayor = amb in (None, AMBITO_MAYOR)
    quiere_menor = amb in (None, AMBITO_MENOR)

    datos = {
        'sector': getattr(R, 'CABECERA', {}).get(
            'sector', 'Sector Hidráulico Menor Riego Presurizado Moche '
                      'Virú Chao'),
        'operador': getattr(R, 'CABECERA', {}).get(
            'operador', 'Junta de Usuarios de agua del Sector Hidráulico '
                        'Menor Riego Presurizado Moche Viru Chao'),
    }

    if quiere_mayor:
        boca = _una(R.consultar(
            'SELECT count(*) FROM inventario.bocatomas;'))
        derivacion = _canal(R, 'canal_madre_pech')
        datos['mayor'] = {
            'nombre': NOMBRE_MAYOR,
            # La hoja oficial deja Permanente/Rustica de bocatomas en blanco:
            # la tabla no declara el tipo, y rellenarlo con la cuenta total
            # diria que todas son permanentes sin que nadie lo haya medido.
            'bocatomas': (_i(boca[0]), None, None) if _i(boca[0]) else None,
            'tomas_cm': _captacion(R, 'tomas_otros_sectores', None, avisos),
            'derivacion': (1, derivacion[0], derivacion[1], derivacion[2]),
        }

    if quiere_menor:
        principal = _canal(R, 'canal_lateral_10_2025',
                           donde=f"layer = '{CAPA_EJE}'", con_material=False)
        datos['menor'] = {
            'nombre': NOMBRE_MENOR,
            'tomas_lat': _captacion(R, 'tomas_l10', amb, avisos),
            'principal': (1, principal[0], principal[1], principal[2],
                          'Lateral 10'),
            'orden1': _laterales(R, '1er Orden', amb),
            'orden2': _laterales(R, '2do Orden', amb),
        }
        _avisar_evacuador(R, datos['menor'], avisos)

    datos['obras'] = _obras_de_arte(R, amb or AMBITO_MENOR, avisos)
    datos['reservorios'] = _reservorios(R, amb or AMBITO_MENOR, avisos)
    return datos


# ── comprobacion contra la hoja de referencia ─────────────────────────────
# Los numeros de FB9_Resumen.pdf (junio 2025). No son la verdad —la base
# cambia— pero si uno se aleja mucho, conviene mirar por que antes de
# entregar el formato.

REFERENCIA = {
    'tomas_cm': 57, 'tomas_lat': 22, 'derivacion_km': 155.0,
    'principal_km': 20.05, 'orden1': 12, 'orden2': 12,
    'obras': {'alcantarilla': 4, 'canoas': 8, 'puente_vehicular': 7,
              'puente_peatonal': 2, 'desarenador': 18, 'aliviadero': 2,
              'partidor': 1, 'entregas': 6, 'sifon': 2, 'disipador': 1,
              'pases_tuberias': 10, 'cajas_hidraulicas': 210, 'otros': 8},
    'reservorios': 10, 'reservorios_hm3': 0.214,
}

# Las diferencias que ya se estudiaron y no son un fallo del lector. Se
# imprimen debajo de su cifra cuando no coincide, para que nadie tenga que
# volver a averiguar lo mismo dentro de seis meses.
NOTAS = {
    'tomas_lat': 'hay una toma mas que en 2025',
    'rusticas': 'la base las tiene todas con material C y tipo Pe: de '
                'concreto, no rusticas. La hoja de 2025 las contaba '
                'rusticas y el inventario la contradice',
    'orden': '10.5-CH14 y 10.5-CH20 figuran como 1er orden en la base; la '
             'hoja de 2025 los listaba en 2do',
    'km1': 'faltan los 7.33 km del Canal Evacuador, que esta en el CAD '
           'pero no en redes_presurizado',
    'partidor': 'hay uno mas que en 2025',
    'disipador': 'no hay tabla de disipadores en el esquema',
    'otros': 'aqui solo entra camara_rompepresion; el 8 de la hoja de 2025 '
             'sale de estructuras que no estan en la base',
}


def comprobar(R, ambito='todos'):
    avisos = []
    d = leer_datos(R, ambito, avisos=avisos)
    mayor = d.get('mayor') or {}
    menor = d.get('menor') or {}

    def linea(etiqueta, valor, esperado, dec=0, nota=None):
        """Una cifra junto a la de la hoja, con su marca y su porque.

        Tres marcas y no dos: la base lleva año y medio moviendose, asi que
        una diferencia del uno por ciento es el inventario creciendo y una
        del doscientos es un error. Igualarlas en un solo `!!` obliga a
        mirar las treinta lineas cada vez.

        Las diferencias ya estudiadas llevan su nota aqui y no en la cabeza
        de nadie: la proxima vez que alguien corra esto no tiene que volver
        a averiguar por que el 1er orden suma siete kilometros menos.
        """
        fmt = f'{{:,.{dec}f}}'
        try:
            v, e = float(valor), float(esperado)
            if abs(v - e) < 0.01:
                marca = '  '
            elif e and abs(v - e) / abs(e) <= 0.05:
                marca = ' ~'
            else:
                marca = '!!'
        except (TypeError, ValueError):
            marca = '??'
        print(f'{marca} {etiqueta:<34}{fmt.format(valor):>12}'
              f'{fmt.format(esperado):>12}')
        if nota and marca != '  ':
            for renglon in textwrap.wrap(nota, 55):
                print(f'{"":5}{renglon}')

    print(f'{"":2} {"":34}{"base":>12}{"hoja 2025":>12}')
    print(f'{"":2} {"(~ = hasta 5% de diferencia)":<34}')
    print('-' * 60)
    if mayor:
        linea('Tomas directas Canal Madre', mayor['tomas_cm'][0],
              REFERENCIA['tomas_cm'])
        linea('  de ellas, permanentes', mayor['tomas_cm'][1], 57)
        linea('Canal de derivacion (km)', mayor['derivacion'][3],
              REFERENCIA['derivacion_km'], 2)
    if menor:
        linea('Tomas laterales', menor['tomas_lat'][0],
              REFERENCIA['tomas_lat'], nota=NOTAS['tomas_lat'])
        linea('  de ellas, rusticas', menor['tomas_lat'][2], 22,
              nota=NOTAS['rusticas'])
        linea('Canal principal (km)', menor['principal'][1],
              REFERENCIA['principal_km'], 2)
        linea('Laterales de 1er orden', len(menor['orden1']),
              REFERENCIA['orden1'], nota=NOTAS['orden'])
        linea('  kilometraje total', sum(l[2] for l in menor['orden1']),
              31.04, 2, nota=NOTAS['km1'])
        linea('Laterales de 2do orden', len(menor['orden2']),
              REFERENCIA['orden2'], nota=NOTAS['orden'])
        linea('  kilometraje total', sum(l[2] for l in menor['orden2']),
              15.81, 2)
    print('-' * 60)
    for clave, _ in OBRAS:
        linea(clave, d['obras'].get(clave, 0),
              REFERENCIA['obras'].get(clave, 0), nota=NOTAS.get(clave))
    print('-' * 60)
    linea('Reservorios', len(d['reservorios']), REFERENCIA['reservorios'])
    linea('  capacidad total (hm3)',
          sum(r[0] for r in d['reservorios']),
          REFERENCIA['reservorios_hm3'], 3)

    if avisos:
        print('\nAvisos:')
        for a in avisos:
            renglones = textwrap.wrap(a, 55) or ['']
            print(f'  · {renglones[0]}')
            for renglon in renglones[1:]:
                print(f'    {renglon}')
    return d


def _asegurar_clave():
    """Deja PGPASSWORD puesta, como hace la vista antes de lanzar esto.

    `consultar()` llama a psql, que pide la clave por env. Cuando el
    generador corre desde Django la vista se la inyecta; cuando uno entra a
    mano con `docker exec` no hay nadie que lo haga y psql pregunta por
    teclado, no encuentra a nadie y falla *cada* consulta. El sintoma es un
    --comprobar con todo en cero, que parece una base vacia y no lo es.
    """
    if os.environ.get('PGPASSWORD'):
        return True
    clave = os.environ.get('GIS_ADMIN_PASSWORD')
    if clave:
        os.environ['PGPASSWORD'] = clave
        return True
    print('aviso: no hay PGPASSWORD ni GIS_ADMIN_PASSWORD en el entorno; '
          'las consultas van a fallar', file=sys.stderr)
    return False


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--ambito', default='todos')
    p.add_argument('--comprobar', action='store_true')
    args = p.parse_args()

    _asegurar_clave()
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import reportes_ana as R

    if args.comprobar:
        comprobar(R, args.ambito)
        return 0

    import json
    print(json.dumps(leer_datos(R, args.ambito), indent=2,
                     ensure_ascii=False))
    return 0


if __name__ == '__main__':
    sys.exit(main())
