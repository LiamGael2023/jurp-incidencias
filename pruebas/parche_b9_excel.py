# -*- coding: utf-8 -*-
"""
El B-9 en Excel, completo, por el mismo botón de siempre.

    python3 parche_b9_excel.py [--raiz /var/www/envs/vigilantes] [--dry-run]
    cd /var/www/envs/vigilantes && docker compose restart web

Copia `reportes_b9_excel.py` junto al generador y envuelve `_generar` del
ViewSet: para el B-9 llama al módulo nuevo y para los otros trece delega en
el de siempre.

POR QUÉ SE ENVUELVE `_generar` Y NO LA VISTA DE DESCARGA
--------------------------------------------------------
Porque el B-9 se pide desde dos sitios —el botón de su fila y el ZIP de los
catorce formatos— y los dos pasan por `_generar`. Envolviendo la vista
habría que tocar los dos y el del ZIP se olvidaría, que es como se entregan
los formatos de verdad.

EL NOMBRE DEL ARCHIVO
---------------------
El ViewSet decide dónde espera el archivo con `self._nombre_archivo(...)` y
el generador escribe con el suyo. Si no coinciden, el ViewSet busca algo
que no está y contesta que el generador no produjo nada, con el archivo ahí
al lado. Por eso el módulo escribe y aquí se renombra a lo que el ViewSet
espera, en vez de confiar en que las dos reglas digan lo mismo.
"""

import argparse
import os
import re
import shutil
import sys


AQUI = os.path.dirname(os.path.abspath(__file__))
GENERADOR = '/opt/jurp-gis'
FUENTE = 'reportes_b9_excel.py'

INICIO = '# ── '
MARCA = '# ── El B-9 en Excel, con sus tres tablas'

BLOQUE = MARCA + ''' ────────────────────────

_generar_previo = ReporteViewSet._generar


def _generar_con_b9(self, clave, ambito, campania):
    """El B-9 por su generador nuevo; el resto, como siempre.

    El de siempre arma solo la primera de las tres tablas del formato.
    """
    if clave != 'B-9':
        return _generar_previo(self, clave, ambito, campania)

    import subprocess

    os.makedirs(self.SALIDA, exist_ok=True)
    ruta = os.path.join(self.SALIDA,
                        self._nombre_archivo(clave, ambito, campania))
    if self._vigente(ruta, campania):
        return ruta, None

    entorno = os.environ.copy()
    clave_bd = (os.environ.get('GIS_ADMIN_PASSWORD')
                or os.environ.get('PGPASSWORD'))
    if clave_bd:
        entorno['PGPASSWORD'] = clave_bd

    carpeta = os.path.dirname(self.GENERADOR)
    amb = ambito or 'todos'
    cmd = ['python3', os.path.join(carpeta, 'reportes_b9_excel.py'),
           '--ambito', amb, '--salida', self.SALIDA]
    if campania:
        cmd += ['--campania', str(campania)]

    try:
        r = subprocess.run(cmd, capture_output=True, text=True,
                           timeout=300, env=entorno)
    except subprocess.TimeoutExpired:
        return None, 'El resumen B-9 tardo demasiado.'
    except FileNotFoundError:
        return None, 'No se encontro reportes_b9_excel.py junto al generador.'

    if r.returncode != 0:
        return None, (r.stderr or r.stdout or '').strip()[:300] or \\
            'El generador no produjo el B-9.'

    # El modulo escribe con su propia regla de nombre; el ViewSet espera la
    # suya. Se renombra en vez de confiar en que coincidan.
    sufijo = f'_{campania}' if campania else ''
    mio = os.path.join(self.SALIDA, f'F_B-9_Resumen_{amb}{sufijo}.xlsx')
    if mio != ruta and os.path.exists(mio):
        os.replace(mio, ruta)
    if not os.path.exists(ruta):
        return None, 'El generador no dejo el B-9 donde se esperaba.'
    return ruta, None


ReporteViewSet._generar = _generar_con_b9
'''


def leer(ruta):
    with open(ruta) as f:
        return f.read()


def escribir(ruta, texto, simulacro):
    try:
        compile(texto, ruta, 'exec')
    except SyntaxError as e:
        raise IOError('el resultado no compila: {0} (linea {1})'.format(
            e.msg, e.lineno))
    if simulacro:
        return
    shutil.copy2(ruta, ruta + '.bak')
    with open(ruta, 'w') as f:
        f.write(texto)


def poner_bloque(ruta, marca, bloque, simulacro):
    """Pega o actualiza un bloque marcado, sin tocar los que vengan detras."""
    t = leer(ruta)
    veces = t.count(marca)
    if veces > 1:
        return False, 'la marca sale {0} veces; revisalo a mano'.format(veces)
    if veces == 1:
        i = t.index(marca)
        j = t.find('\n' + INICIO, i + len(marca))
        if j < 0:
            nuevo = t[:i] + bloque
        else:
            nuevo = t[:i] + bloque.rstrip() + '\n\n\n' + t[j + 1:]
        if nuevo == t:
            return True, 'ya estaba'
        escribir(ruta, nuevo, simulacro)
        return True, 'bloque actualizado'
    escribir(ruta, t.rstrip() + '\n\n\n' + bloque, simulacro)
    return True, 'bloque anadido'


def buscar_app(raiz):
    if not os.path.isdir(raiz):
        return None, 'no existe {0}'.format(raiz)
    for nombre in sorted(os.listdir(raiz)):
        carpeta = os.path.join(raiz, nombre)
        if not os.path.isdir(carpeta) or '.bak' in nombre:
            continue
        urls = os.path.join(carpeta, 'urls.py')
        if os.path.exists(urls) and 'reportes' in leer(urls):
            return carpeta, None
    return None, 'no encuentro la app del inventario bajo {0}'.format(raiz)


def copiar_generador(destino, simulacro):
    if not os.path.isdir(destino):
        return False, 'no existe {0}'.format(destino)
    for companero in ('reportes_b9_pdf.py', 'reportes_b9_datos.py'):
        if not os.path.exists(os.path.join(destino, companero)):
            return False, ('falta {0}; pasa antes parche_b9_pdf.py'
                           .format(companero))
    origen = os.path.join(AQUI, FUENTE)
    if not os.path.exists(origen):
        return False, 'no encuentro {0}'.format(origen)
    fin = os.path.join(destino, FUENTE)
    if os.path.exists(fin) and leer(fin) == leer(origen):
        return True, 'ya estaba, igual'
    if simulacro:
        return True, 'se copiaria'
    if os.path.exists(fin):
        shutil.copy2(fin, fin + '.bak')
    shutil.copy2(origen, fin)
    return True, 'copiado'


def comprobar_base(app):
    v = leer(os.path.join(app, 'views.py'))
    faltan = []
    for nombre, patron in (
            ('la clase ReporteViewSet', r'^class ReporteViewSet'),
            ('el import de os', r'^import os'),
            ('el metodo _generar(self, clave, ambito, campania)',
             r'def _generar\(self, clave, ambito, campania\)'),
            ('el metodo _nombre_archivo', r'def _nombre_archivo\('),
            ('el metodo _vigente', r'def _vigente\(')):
        if not re.search(patron, v, re.M):
            faltan.append(nombre)
    return faltan


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--raiz', default='/var/www/envs/vigilantes')
    p.add_argument('--generador', default=GENERADOR)
    p.add_argument('--dry-run', action='store_true')
    args = p.parse_args()

    app, mal = buscar_app(args.raiz)
    if mal:
        print('[MAL] {0}'.format(mal))
        sys.exit(1)
    print('App del inventario: {0}'.format(app))

    faltan = comprobar_base(app)
    if faltan:
        print('[MAL] falta lo que este parche necesita: {0}'.format(
            ', '.join(faltan)))
        sys.exit(1)

    pasos = [
        ('el generador del B-9 en Excel',
         lambda: copiar_generador(args.generador, args.dry_run)),
        ('el enganche de _generar', lambda: poner_bloque(
            os.path.join(app, 'views.py'), MARCA, BLOQUE, args.dry_run)),
    ]
    for nombre, fn in pasos:
        try:
            ok, detalle = fn()
        except (IOError, OSError) as e:
            ok, detalle = False, str(e)
        print('[{0}] {1}: {2}'.format('OK ' if ok else 'MAL', nombre, detalle))
        if not ok:
            print('\nNO se aplico todo.')
            sys.exit(1)

    if args.dry_run:
        print('\nSimulacro: no se escribio nada.')
        return

    print('\nFalta:')
    print('  cd {0} && docker compose restart web'.format(args.raiz))
    print('\nY comprobar (borrando antes el que haya en cache):')
    print('  docker exec django_api sh -c "rm -f {0}/reportes/F_B-9*.xlsx"'
          .format(args.generador))
    print('  curl -s -o /tmp/b9.xlsx -w "%{http_code} %{size_download}\\n" \\')
    print('    "http://127.0.0.1:8005/api/v1/inventario/reportes/B-9/'
          '?ambito=todos"')


if __name__ == '__main__':
    main()
