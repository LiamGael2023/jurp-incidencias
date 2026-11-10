# -*- coding: utf-8 -*-
"""
¿Coloca la app los puntos donde debe?

    python3 herramientas/comparar_utm.py

Compara `lib/src/utils/utm.dart` con PROJ —la biblioteca que usa PostGIS—
sobre el ámbito de la Junta, y de paso con el visor web si hay node.
Devuelve 0 si todo cae por debajo de la tolerancia.

POR QUÉ MERECE UNA PRUEBA
-------------------------
Esta conversión decide dónde queda clavada en la base una estructura dada
de alta en campo. Si se equivoca, el punto aparece a kilómetros y nadie
recibe un error: PostGIS acepta las coordenadas sin protestar porque el
SRID se lo damos nosotros. El fallo se descubre al abrir el mapa días
después, con el inspector ya de vuelta.

Y no se puede comprobar «a ojo» mirando el código: son fórmulas largas
donde un exponente cambiado mueve el punto unos metros, lo justo para
parecer plausible.

CÓMO ESTÁ HECHA
---------------
La implementación de Dart se transcribe aquí literalmente —misma
estructura, mismos nombres— y se contrasta con `pyproj`, que no comparte
una sola línea con ella. Si las dos coinciden al centímetro sobre veinte
puntos repartidos por el ámbito, la fórmula es la correcta.

    pip install pyproj
"""
import argparse
import json
import math
import os
import subprocess
import sys

AQUI = os.path.dirname(os.path.abspath(__file__))
DART = os.path.join(AQUI, '..', 'lib', 'src', 'utils', 'utm.dart')
JS = os.path.join(AQUI, '..', '..', 'src', 'cartografia.js')

A = 6378137.0
E2 = 0.00669437999014
EP2 = E2 / (1 - E2)
K0 = 0.9996

# El ámbito de la Junta y sus alrededores: Chao, Virú, Moche, el canal
# madre arriba y la costa abajo. Más dos puntos sobre el límite 17/18 para
# que la elección de zona también quede cubierta.
PUNTOS = [
    (-8.470, -78.740),   # Chao
    (-8.415, -78.755),
    (-8.350, -78.800),
    (-8.280, -78.820),
    (-8.200, -78.880),
    (-8.130, -78.930),   # Virú
    (-8.060, -78.960),
    (-8.000, -79.010),
    (-7.950, -79.060),
    (-7.900, -79.100),   # Moche
    (-8.500, -78.650),
    (-8.600, -78.600),
    (-8.700, -78.550),
    (-7.800, -79.200),
    (-7.700, -79.300),
    (-8.900, -78.400),
    (-9.000, -78.300),
    (-8.250, -78.000),   # cerca del límite 17/18
    (-8.250, -77.990),
    (-8.250, -78.010),
]

TOLERANCIA_M = 0.01   # un centímetro


def zona_de(lng):
    return math.floor((lng + 180) / 6) + 1


def dart_latlng_a_utm(lat, lng, zona_forzada=None):
    """Transcripción literal de latLngAUTM en utm.dart."""
    zona = zona_forzada or zona_de(lng)
    lat_r = lat * math.pi / 180
    lng_r = lng * math.pi / 180
    lng_o = ((zona - 1) * 6 - 180 + 3) * math.pi / 180

    sin_lat = math.sin(lat_r)
    cos_lat = math.cos(lat_r)
    tan_lat = math.tan(lat_r)

    n = A / math.sqrt(1 - E2 * sin_lat * sin_lat)
    t = tan_lat * tan_lat
    c = EP2 * cos_lat * cos_lat
    x = cos_lat * (lng_r - lng_o)

    e3 = E2 * E2 * E2
    m = A * ((1 - E2 / 4 - 3 * E2 * E2 / 64 - 5 * e3 / 256) * lat_r
             - (3 * E2 / 8 + 3 * E2 * E2 / 32 + 45 * e3 / 1024)
             * math.sin(2 * lat_r)
             + (15 * E2 * E2 / 256 + 45 * e3 / 1024) * math.sin(4 * lat_r)
             - (35 * e3 / 3072) * math.sin(6 * lat_r))

    este = K0 * n * (x
                     + (1 - t + c) * x ** 3 / 6
                     + (5 - 18 * t + t * t + 72 * c - 58 * EP2)
                     * x ** 5 / 120) + 500000

    norte = K0 * (m + n * tan_lat * (x * x / 2
                                     + (5 - t + 9 * c + 4 * c * c)
                                     * x ** 4 / 24
                                     + (61 - 58 * t + t * t + 600 * c
                                        - 330 * EP2) * x ** 6 / 720))
    if lat < 0:
        norte += 10000000

    return este, norte, zona, 'S' if lat < 0 else 'N'


def por_el_visor_web(puntos):
    """Lo que devuelve `src/cartografia.js`, si hay node para ejecutarlo."""
    if not os.path.exists(JS):
        return None
    guion = (
        "import { latLngToUTM } from %s;\n"
        "const p = %s;\n"
        "console.log(JSON.stringify(p.map(([a, b]) => {\n"
        "  const u = latLngToUTM(a, b);\n"
        "  return [u.este, u.norte, u.zona, u.hemisferio];\n"
        "})));\n" % (json.dumps(os.path.abspath(JS)), json.dumps(puntos))
    )
    try:
        r = subprocess.run(
            ['node', '--input-type=module', '-e', guion],
            capture_output=True, text=True, timeout=60)
        if r.returncode != 0:
            return None
        return json.loads(r.stdout.strip().splitlines()[-1])
    except Exception:
        return None


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--tolerancia', type=float, default=TOLERANCIA_M,
                   help='metros de diferencia admitidos (por defecto 0.01)')
    args = p.parse_args()

    # Las dos comparaciones son independientes y cada una vale por sí sola:
    # PROJ dice si la fórmula es correcta, y el visor web si la app y la
    # oficina colocan el punto en el mismo sitio. Exigir las dos convertía
    # la herramienta en inservible allí donde no hay pyproj —el servidor,
    # por ejemplo— cuando todavía podía contestar media pregunta.
    try:
        from pyproj import Transformer
    except ImportError:
        Transformer = None

    if not os.path.exists(DART):
        print(f'no encuentro {DART}', file=sys.stderr)
        return 2

    web = por_el_visor_web(PUNTOS)

    if Transformer is None and web is None:
        print('no hay con qué comparar: falta pyproj (pip install pyproj) '
              'y tampoco hay node para ejecutar el visor web', file=sys.stderr)
        return 2

    contra = []
    if Transformer is not None:
        contra.append('PROJ')
    else:
        print('sin pyproj: no se compara con PROJ (pip install pyproj)')
    if web is not None:
        contra.append('el visor web')
    else:
        print('sin node: no se compara con el visor web')

    print(f'{len(PUNTOS)} puntos · tolerancia {args.tolerancia} m')
    print('contra ' + ' y contra '.join(contra))

    peor_proj = 0.0
    peor_web = 0.0
    malos = []

    for i, (lat, lng) in enumerate(PUNTOS):
        este, norte, zona, hemi = dart_latlng_a_utm(lat, lng)
        srid = (32700 if hemi == 'S' else 32600) + zona

        if Transformer is not None:
            t = Transformer.from_crs('EPSG:4326', f'EPSG:{srid}',
                                     always_xy=True)
            ex, nx = t.transform(lng, lat)
            d = math.hypot(este - ex, norte - nx)
            peor_proj = max(peor_proj, d)
            if d > args.tolerancia:
                malos.append(f'{lat},{lng}: {d:.3f} m contra PROJ (EPSG:{srid})')

        if web:
            ew, nw, zw, hw = web[i]
            dw = math.hypot(este - ew, norte - nw)
            peor_web = max(peor_web, dw)
            if dw > args.tolerancia or zw != zona or hw != hemi:
                malos.append(f'{lat},{lng}: {dw:.3f} m contra el visor web')

    if Transformer is not None:
        print(f'peor diferencia contra PROJ: {peor_proj*100:.3f} cm')
    if web:
        print(f'peor diferencia contra el visor web: {peor_web*100:.3f} cm')

    if malos:
        print(f'\n{len(malos)} fuera de tolerancia:')
        for x in malos:
            print(f'  {x}')
        return 1
    print('coinciden')
    return 0


if __name__ == '__main__':
    sys.exit(main())
