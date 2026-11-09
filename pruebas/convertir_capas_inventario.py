#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Convierte las cuatro capas nuevas del inventario a un solo .sql cargable
contra jurp_postgis.

POR QUE NO ogr2ogr. Seria una linea por capa, pero obliga a que el GDAL del
servidor traiga el driver de KML y a acertar con el dialecto de salida. Aqui
el KML se lee a mano -son cuatro expresiones regulares- y lo que sale es SQL
plano, que se carga con psql y se revisa leyendolo.

Las coordenadas del KML van en WGS84; la reproyeccion a UTM 17S la hace
PostGIS en el propio INSERT (ST_Transform), que es quien tiene la definicion
buena del sistema. El shapefile ya viene en 32717 y no se toca.
"""

import html
import math
import os
import re
import sys

import shapefile

AQUI = os.path.dirname(os.path.abspath(__file__))
KMZ = os.path.join(AQUI, 'capas', 'kmz')
SHP = os.path.join(AQUI, 'capas', 'shp', 'CM_200mt+ESTRUCTURAS')
SALIDA = os.path.join(AQUI, 'capas_nuevas.sql')

# Tolerancia de simplificacion para los cauces, en grados. 0.00005 son unos
# 5 m en esta latitud: por debajo del grosor con que se dibuja la linea en
# pantalla, asi que no se ve, y recorta el archivo a la mitad larga.
TOL_CAUCES = 0.00005

# Lo mismo para los poligonos de cuenca, que vienen trazados pixel a pixel
# del modelo de elevacion: 384 poligonos ocupaban 6 MB de SQL y se ven
# identicos con una decima parte de vertices. Los 18 tramos se dejan
# enteros, que no pesan.
TOL_CUENCAS = 0.00005

RE_PM = re.compile(r'<Placemark.*?</Placemark>', re.S)
RE_TD = re.compile(r'<td>(.*?)</td>', re.S)
RE_DESC = re.compile(r'<description><!\[CDATA\[(.*?)\]\]></description>', re.S)
RE_NAME = re.compile(r'<name>(.*?)</name>', re.S)
RE_POLY = re.compile(r'<Polygon>.*?</Polygon>', re.S)
RE_LINE = re.compile(r'<LineString>.*?</LineString>', re.S)
RE_OUTER = re.compile(r'<outerBoundaryIs>.*?</outerBoundaryIs>', re.S)
RE_INNER = re.compile(r'<innerBoundaryIs>.*?</innerBoundaryIs>', re.S)
RE_COORD = re.compile(r'<coordinates>(.*?)</coordinates>', re.S)


# ── lectura del KML ──────────────────────────────────────────────────

def atributos(pm):
    """Los pares clave/valor de la tabla HTML que ArcGIS mete en description."""
    d = RE_DESC.search(pm)
    if not d:
        return {}
    tds = [html.unescape(re.sub('<.*?>', '', x)).strip() for x in RE_TD.findall(d.group(1))]
    pares = {}
    for i in range(1, len(tds) - 1, 2):
        v = tds[i + 1]
        # ArcGIS escribe <Null> en vez de dejar la celda vacia.
        pares[tds[i]] = '' if v in ('<Null>', 'Null') else v
    return pares


def coords(txt):
    """'lon,lat,alt lon,lat,alt' -> [(lon, lat), ...]"""
    pts = []
    for trozo in txt.replace('\n', ' ').replace('\t', ' ').split():
        partes = trozo.split(',')
        if len(partes) >= 2:
            pts.append((float(partes[0]), float(partes[1])))
    return pts


def simplificar(pts, tol):
    """Douglas-Peucker iterativo. Recursivo revienta la pila con 10.000 puntos."""
    if tol <= 0 or len(pts) < 3:
        return pts
    guardar = [False] * len(pts)
    guardar[0] = guardar[-1] = True
    pila = [(0, len(pts) - 1)]
    while pila:
        ini, fin = pila.pop()
        if fin <= ini + 1:
            continue
        ax, ay = pts[ini]
        bx, by = pts[fin]
        dx, dy = bx - ax, by - ay
        norma = math.hypot(dx, dy)
        peor, idx = 0.0, -1
        for i in range(ini + 1, fin):
            px, py = pts[i]
            if norma == 0:
                d = math.hypot(px - ax, py - ay)
            else:
                d = abs(dy * px - dx * py + bx * ay - by * ax) / norma
            if d > peor:
                peor, idx = d, i
        if peor > tol and idx > 0:
            guardar[idx] = True
            pila.append((ini, idx))
            pila.append((idx, fin))
    return [p for p, g in zip(pts, guardar) if g]


def simplificar_anillo(pts, tol):
    """Simplifica un anillo sin dejarlo invalido.

    Douglas-Peucker sobre un anillo cerrado puede reducirlo a dos puntos
    distintos. Cerrado son tres coordenadas, y PostGIS lo rechaza con
    «geometry requires more points»: un anillo necesita cuatro, porque la
    primera y la ultima son la misma. Cuando pasa, se deja el anillo
    original -son los pocos trozos diminutos, no pesan-.
    """
    if tol <= 0 or len(pts) < 5:
        return pts
    s = simplificar(pts, tol)
    cerrado = s if s[0] == s[-1] else s + [s[0]]
    return pts if len(cerrado) < 4 else s


def anillo(pts, dec=6):
    """Un anillo WKT, cerrado. Sin cerrar, PostGIS rechaza el poligono."""
    if pts[0] != pts[-1]:
        pts = pts + [pts[0]]
    return '(' + ','.join(f'{x:.{dec}f} {y:.{dec}f}' for x, y in pts) + ')'


def wkt_multipoligono(pm, tol=0.0):
    partes = []
    for poly in RE_POLY.findall(pm):
        ext = RE_OUTER.search(poly)
        if not ext:
            continue
        crudo = coords(RE_COORD.search(ext.group(0)).group(1))
        # Cuatro: el cierre cuenta como coordenada y repite la primera.
        if len(crudo) < 4:
            continue
        anillos = [anillo(simplificar_anillo(crudo, tol))]
        for inn in RE_INNER.findall(poly):
            crudo_i = coords(RE_COORD.search(inn).group(1))
            if len(crudo_i) >= 4:
                anillos.append(anillo(simplificar_anillo(crudo_i, tol)))
        partes.append('(' + ','.join(anillos) + ')')
    return f"MULTIPOLYGON({','.join(partes)})" if partes else None


def wkt_multilinea(pm, tol=0.0):
    partes = []
    for ln in RE_LINE.findall(pm):
        pts = coords(RE_COORD.search(ln).group(1))
        pts = simplificar(pts, tol)
        if len(pts) >= 2:
            partes.append('(' + ','.join(f'{x:.6f} {y:.6f}' for x, y in pts) + ')')
    return f"MULTILINESTRING({','.join(partes)})" if partes else None


# ── escritura del SQL ────────────────────────────────────────────────

def lit(v):
    if v is None or v == '':
        return 'NULL'
    return "'" + str(v).replace("'", "''") + "'"


def num(v):
    if v in (None, ''):
        return 'NULL'
    try:
        # '0.1045 sq km' -> 0.1045
        return repr(float(str(v).split()[0].replace(',', '')))
    except (ValueError, IndexError):
        return 'NULL'


def entero(v):
    if v in (None, ''):
        return 'NULL'
    try:
        return str(int(float(str(v).split()[0])))
    except (ValueError, IndexError):
        return 'NULL'


# Las seis columnas que todas las capas KMZ comparten con ActivoKmz, para que
# el serializer generico las sirva sin escribir uno nuevo.
BASE = ['nombre', 'etiqueta', 'numero', 'progresiva', 'estado',
        'estructura', 'cod_est', 'tramo', 'ambito', 'fuente']


def cabecera(tabla, extra, geom):
    cols = ['  ogc_fid  serial PRIMARY KEY',
            '  nombre      text',
            '  etiqueta    text',
            '  numero      integer',
            '  progresiva  text',
            '  estado      text',
            '  estructura  text',
            '  cod_est     text',
            '  tramo       text',
            '  ambito      text',
            '  fuente      text']
    cols += [f'  {n:<11} {t}' for n, t in extra]
    # Las tres de campana que llevan las demas capas del inventario. Aqui
    # van siempre vacias -estas capas son de contexto y no se evaluan- pero
    # si la vista llega a filtrar por ellas, una tabla que no las tenga
    # revienta la consulta entera en vez de devolver cero filas.
    cols += ['  campania_alta  integer',
             '  campania_baja  integer',
             '  motivo_baja    text']
    cols.append(f'  geom        geometry({geom},32717)')
    return (f'DROP TABLE IF EXISTS {tabla} CASCADE;\n'
            f'CREATE TABLE {tabla} (\n' + ',\n'.join(cols) + '\n);\n')


def pie(tabla):
    return (f'CREATE INDEX {tabla}_geom_idx ON {tabla} USING gist (geom);\n'
            f'GRANT SELECT ON {tabla} TO gis_app;\n'
            f'GRANT USAGE, SELECT ON SEQUENCE {tabla}_ogc_fid_seq TO gis_app;\n\n')


def insertar(f, tabla, columnas, valores, wkt, srid, tipo):
    """Un INSERT por fila. Verboso, pero si uno falla se ve cuál."""
    geom = (f"ST_Multi(ST_Transform(ST_GeomFromText({lit(wkt)},4326),32717))"
            if srid == 4326 else
            f"ST_Multi(ST_GeomFromText({lit(wkt)},32717))")
    f.write(f"INSERT INTO {tabla} ({','.join(columnas)},geom) VALUES "
            f"({','.join(valores)},{geom});\n")


# ── las cuatro capas ─────────────────────────────────────────────────

def canal_madre_200m(f):
    r = shapefile.Reader(SHP)
    campos = [c[0] for c in r.fields[1:]]
    extra = [('tipo_estru', 'text'), ('empresa', 'text'),
             ('orden', 'double precision'),
             ('long_p', 'double precision'), ('long_g', 'double precision'),
             ('diametro', 'double precision'), ('seccion', 'text'),
             ('cota', 'double precision'), ('caudal_m3s', 'double precision'),
             ('pendiente', 'double precision'), ('talud_z', 'double precision'),
             ('base_m', 'double precision'), ('tirante_m', 'double precision'),
             ('velocidad', 'double precision')]
    f.write(cabecera('canal_madre_200m', extra, 'MultiPolygon'))
    cols = BASE + [n for n, _ in extra]
    n = 0
    for sr in r.iterShapeRecords():
        d = dict(zip(campos, sr.record))
        pts = sr.shape.points
        partes = list(sr.shape.parts) + [len(pts)]
        anillos = []
        for i in range(len(partes) - 1):
            trozo = pts[partes[i]:partes[i + 1]]
            if len(trozo) >= 4:
                anillos.append('(' + anillo(trozo, dec=2) + ')')
        if not anillos:
            continue
        wkt = f"MULTIPOLYGON({','.join(anillos)})"
        vals = [
            lit(d.get('NOMBRE')),                                   # nombre
            lit(f"{d.get('ESTRUCTURA') or ''} {d.get('PROGRESIVA') or ''}".strip()),
            entero(d.get('ORDEN')),                                 # numero
            lit(d.get('PROGRESIVA')),
            'NULL',                                                 # estado
            lit(d.get('ESTRUCTURA')),
            lit(d.get('COD_EST')),
            lit(d.get('TRAMO')),
            # ambito, no la empresa. EMPRESA aqui es quien OPERA el tramo
            # -Danper, Camposol, Green Peru-, no de quien es la obra; el
            # visor filtra por ambito entre lo de la Junta y lo de
            # Chavimochic, y los catorce tramos son jurisdiccion JURP.
            lit('JURP'),
            lit('CM_200mt+ESTRUCTURAS.shp'),
            lit(d.get('TIPO_ESTRU')), lit(d.get('EMPRESA')),
            num(d.get('ORDEN')), num(d.get('LONG_P')), num(d.get('LONG_G')),
            num(d.get('DIAMETRO')), lit(d.get('SECCION')), num(d.get('COTA')),
            num(d.get('CAUDAL_M3S')), num(d.get('PENDIENTE')),
            num(d.get('TALUD_Z')), num(d.get('BASE_m')),
            num(d.get('TIRANTE_M')), num(d.get('VELOCIDAD')),
        ]
        insertar(f, 'canal_madre_200m', cols, vals, wkt, 32717, 'MultiPolygon')
        n += 1
    f.write(pie('canal_madre_200m'))
    return n


def tramos_jurp(f):
    t = open(os.path.join(KMZ, '8c4078d3-Tramos_JURP_1', 'doc.kml'),
             encoding='utf-8', errors='replace').read()
    extra = [('km_inicio', 'text'), ('km_final', 'text'),
             ('long_km', 'double precision'), ('empresa', 'text'),
             ('responsable', 'text'), ('descripcion', 'text'),
             ('n_alcantarillas', 'integer'), ('n_canoas', 'integer'),
             ('n_bocatomas', 'integer'), ('n_entregas', 'integer'),
             ('n_acueductos', 'integer'), ('n_sifones', 'integer'),
             ('n_tuneles', 'integer'), ('n_desarenadores', 'integer'),
             ('n_puentes', 'integer'), ('n_caidas', 'integer'),
             ('n_aliviaderos', 'integer'), ('n_tomas', 'integer')]
    f.write(cabecera('tramos_jurp', extra, 'MultiPolygon'))
    cols = BASE + [n for n, _ in extra]
    n = 0
    for pm in RE_PM.findall(t):
        wkt = wkt_multipoligono(pm)
        if not wkt:
            continue            # los 14 puntos del KMZ no son tramos
        a = atributos(pm)
        nom = RE_NAME.search(pm)
        etiqueta = html.unescape(nom.group(1)).strip() if nom else ''
        vals = [
            lit(a.get('Nombre') or etiqueta),
            lit(etiqueta),
            entero(a.get('Id')),
            lit(a.get('Km_inicio')),
            'NULL',
            'NULL',
            'NULL',
            lit(a.get('Nombre') or etiqueta),
            # ambito, no la empresa: es la columna por la que el visor filtra
            # entre lo de la Junta y lo de Chavimochic. La empresa que opera
            # el tramo va en su propia columna, abajo.
            lit('JURP'),
            lit('Tramos_JURP.kmz'),
            lit(a.get('Km_inicio')), lit(a.get('Km_Final')), num(a.get('Lon_Km')),
            lit(a.get('Empresas')), lit(a.get('RESPONSABL')), lit(a.get('Descripcio')),
            entero(a.get('Alcan_')), entero(a.get('Canoas')),
            entero(a.get('Bocatoma')), entero(a.get('Entregas')),
            entero(a.get('Acueducto')), entero(a.get('Sifon')),
            entero(a.get('Tunel')), entero(a.get('Desaren')),
            entero(a.get('Puentes')), entero(a.get('Caidas')),
            entero(a.get('Aliviad')), entero(a.get('Tomas')),
        ]
        insertar(f, 'tramos_jurp', cols, vals, wkt, 4326, 'MultiPolygon')
        n += 1
    f.write(pie('tramos_jurp'))
    return n


def cuencas_pech(f):
    t = open(os.path.join(KMZ, '9aa035cc-Cuencas_PECH', 'doc.kml'),
             encoding='utf-8', errors='replace').read()
    extra = [('stream_id', 'bigint'), ('next_stream', 'bigint'),
             ('area_ha', 'double precision'), ('nombre_qda', 'text'),
             ('nro_pc', 'text'), ('pc', 'text')]
    f.write(cabecera('cuencas_pech', extra, 'MultiPolygon'))
    cols = BASE + [n for n, _ in extra]
    n = 0
    for pm in RE_PM.findall(t):
        wkt = wkt_multipoligono(pm, TOL_CUENCAS)
        if not wkt:
            continue
        a = atributos(pm)
        nombre = a.get('NOMBRE') or a.get('Nombre_Qda') or 'Cuenca sin nombre'
        area = a.get('A_ha')
        vals = [
            lit(nombre),
            lit(f"{nombre} · {float(area):,.0f} ha" if area else nombre),
            entero(a.get('STREAM_ID')),
            'NULL', 'NULL',
            lit('Cuenca'),
            lit(a.get('STREAM_ID')),
            'NULL',
            lit('PECH'),
            lit('Cuencas_PECH.kmz'),
            entero(a.get('STREAM_ID')), entero(a.get('NEXT_STREA')),
            num(area), lit(a.get('Nombre_Qda')), lit(a.get('NRO_PC')), lit(a.get('PC')),
        ]
        insertar(f, 'cuencas_pech', cols, vals, wkt, 4326, 'MultiPolygon')
        n += 1
    f.write(pie('cuencas_pech'))
    return n


def cauces_quebradas(f):
    t = open(os.path.join(KMZ, '6cfe2847-Cauces_Quenradas', 'doc.kml'),
             encoding='utf-8', errors='replace').read()
    extra = [('stream_id', 'bigint'), ('elevacion', 'double precision'),
             ('in_flow', 'bigint'), ('out_flow', 'bigint'),
             ('area_drenaje_km2', 'double precision'),
             ('longitud_m', 'double precision')]
    f.write(cabecera('cauces_quebradas', extra, 'MultiLineString'))
    cols = BASE + [n for n, _ in extra]
    n = 0
    for pm in RE_PM.findall(t):
        wkt = wkt_multilinea(pm, TOL_CAUCES)
        if not wkt:
            continue
        a = atributos(pm)
        vals = [
            lit('Cauce'),
            lit(f"Cauce {a.get('STREAM_ID') or ''}".strip()),
            entero(a.get('STREAM_ID')),
            'NULL', 'NULL',
            lit('Cauce'),
            lit(a.get('STREAM_ID')),
            'NULL',
            lit('PECH'),
            lit('Cauces_Quebradas.kmz'),
            entero(a.get('STREAM_ID')), num(a.get('ELEVATION')),
            entero(a.get('IN_FLOW')), entero(a.get('OUT_FLOW')),
            num(a.get('DRAIN_AREA')), num(a.get('L')),
        ]
        insertar(f, 'cauces_quebradas', cols, vals, wkt, 4326, 'MultiLineString')
        n += 1
    f.write(pie('cauces_quebradas'))
    return n


def main():
    with open(SALIDA, 'w', encoding='utf-8') as f:
        f.write('-- Capas nuevas del inventario JURP.\n'
                '-- Generado por convertir_capas.py. No editar a mano.\n'
                '--\n'
                '-- Se carga con el dueño de la base, que es quien puede crear\n'
                '-- tablas; gis_app solo lee:\n'
                '--   docker exec -i jurp_postgis psql -U gis_admin -d jurp_gis \\\n'
                '--     -v ON_ERROR_STOP=1 < capas_nuevas.sql\n'
                'BEGIN;\n'
                'SET search_path TO inventario, public;\n\n')
        r = {}
        r['canal_madre_200m'] = canal_madre_200m(f)
        r['tramos_jurp'] = tramos_jurp(f)
        r['cuencas_pech'] = cuencas_pech(f)
        r['cauces_quebradas'] = cauces_quebradas(f)
        f.write('COMMIT;\n')
    for k, v in r.items():
        print(f'{k:>20}: {v} filas')
    print(f'{"archivo":>20}: {os.path.getsize(SALIDA)/1e6:.1f} MB')


if __name__ == '__main__':
    sys.exit(main())
