# -*- coding: utf-8 -*-
"""
El B-9 también en PDF, con sus tres tablas.

    python3 parche_b9_pdf.py [--raiz /var/www/envs/vigilantes] [--dry-run]
    cd /var/www/envs/vigilantes && docker compose restart web

Hace dos cosas:

  1. Copia `reportes_b9_pdf.py` (el dibujante) y `reportes_b9_datos.py` (las
     consultas) junto al generador, en /opt/jurp-gis/.

  2. Vuelve a colgar la acción `pdf` del ViewSet con una versión que
     reconoce el B-9. Para cualquier otro formato llama a la anterior
     —`_pdf_de_formato`, del parche de los formatos tabulares—, así que ese
     bloque no se toca y sigue siendo el que manda en los otros trece.

POR QUÉ SE RE-CUELGA LA ACCIÓN Y NO SE EDITA LA ANTERIOR
--------------------------------------------------------
Los bloques de estos parches se pegan al final del archivo y se ejecutan en
orden al importarlo: la última asignación a `ReporteViewSet.pdf` es la que
queda. Reescribir el bloque anterior obligaría a este parche a entender su
contenido; envolverlo, no. La URL que usa el panel no cambia.

EL BORRADO QUE HACÍA `poner_bloque`
-----------------------------------
La versión anterior de ese ayudante reemplazaba desde la marca hasta el
FINAL del archivo. Con un solo bloque daba igual, pero con tres —formatos,
fichas y este— volver a pasar el primero borraba los otros dos y la API se
quedaba sin rutas sin que nada lo dijera. Aquí el bloque termina donde
empieza el siguiente. Los otros dos parches llevan la misma corrección.
"""

import argparse
import os
import re
import shutil
import sys


AQUI = os.path.dirname(os.path.abspath(__file__))
GENERADOR = '/opt/jurp-gis'
FUENTES = ('reportes_b9_pdf.py', 'reportes_b9_datos.py')

INICIO = '# ── '
MARCA = '# ── El B-9, también en PDF'

BLOQUE = MARCA + ''' ────────────────────────────────

def _pdf_con_b9(self, request, pk=None):
    """El PDF de cualquier formato; el B-9 por su propio camino.

    El B-9 no es una tabla de activos sino un resumen de tres tablas, asi
    que no lo dibuja el motor generico. Todo lo demas sigue pasando por
    `_pdf_de_formato`, que es quien sabe de columnas.
    """
    import subprocess
    from django.http import FileResponse, JsonResponse

    if pk != 'B-9':
        return _pdf_de_formato(self, request, pk)

    ambito, campania = self._parametros(request)
    os.makedirs(self.SALIDA, exist_ok=True)
    sufijo = f'_{campania}' if campania else ''
    ruta = os.path.join(self.SALIDA, f'FB9_Resumen_{ambito}{sufijo}.pdf')

    if not self._vigente(ruta, campania):
        entorno = os.environ.copy()
        clave_bd = (os.environ.get('GIS_ADMIN_PASSWORD')
                    or os.environ.get('PGPASSWORD'))
        if clave_bd:
            entorno['PGPASSWORD'] = clave_bd

        base = os.path.dirname(self.GENERADOR)
        cmd = ['python3', os.path.join(base, 'reportes_b9_pdf.py'),
               '--ambito', ambito, '--salida', self.SALIDA]
        if campania:
            cmd += ['--campania', str(campania)]

        try:
            r = subprocess.run(cmd, capture_output=True, text=True,
                               timeout=180, env=entorno)
        except subprocess.TimeoutExpired:
            return JsonResponse({'detail': 'El resumen tardo demasiado.'},
                                status=504)
        except FileNotFoundError:
            return JsonResponse(
                {'detail': 'No se encontro reportes_b9_pdf.py junto al '
                           'generador.'}, status=500)

        if r.returncode != 0 or not os.path.exists(ruta):
            detalle = (r.stderr or r.stdout or '').strip()[:300]
            return JsonResponse(
                {'detail': detalle or 'El generador no produjo el resumen.'},
                status=500)

    return FileResponse(open(ruta, 'rb'), as_attachment=True,
                        filename=os.path.basename(ruta),
                        content_type='application/pdf')


# El nombre de la funcion TIENE que coincidir con el del atributo o DRF
# tumba el URLconf entero al construir las rutas.
_pdf_con_b9.__name__ = 'pdf'
ReporteViewSet.pdf = action(
    detail=True, methods=['get'], url_path='pdf')(_pdf_con_b9)
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
    """Pega o actualiza un bloque marcado, sin tocar los que vengan detras.

    Un bloque termina donde empieza el siguiente —la siguiente linea que
    abre con `# ── `— y no al final del archivo: si se tragara el resto,
    volver a pasar un parche borraria los bloques de los demas.
    """
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


def copiar_generadores(destino, simulacro):
    if not os.path.isdir(destino):
        return False, 'no existe {0}'.format(destino)
    if not os.path.exists(os.path.join(destino, 'reportes_ana.py')):
        return False, 'no esta reportes_ana.py en {0}'.format(destino)
    copiados = []
    for nombre in FUENTES:
        origen = os.path.join(AQUI, nombre)
        if not os.path.exists(origen):
            return False, 'no encuentro {0}'.format(origen)
        fin = os.path.join(destino, nombre)
        if os.path.exists(fin) and leer(fin) == leer(origen):
            continue
        if not simulacro:
            if os.path.exists(fin):
                shutil.copy2(fin, fin + '.bak')
            shutil.copy2(origen, fin)
        copiados.append(nombre)
    if not copiados:
        return True, 'ya estaban, iguales'
    return True, ('se copiarian: ' if simulacro else 'copiados: ') \
        + ', '.join(copiados)


def comprobar_base(app):
    v = leer(os.path.join(app, 'views.py'))
    faltan = []
    for nombre, patron in (
            ('la clase ReporteViewSet', r'^class ReporteViewSet'),
            ('el import de action',
             r'^from rest_framework\.decorators import .*\baction\b'),
            ('el import de os', r'^import os')):
        if not re.search(patron, v, re.M):
            faltan.append(nombre)
    # Este parche envuelve al de los formatos tabulares: sin el, la llamada
    # a `_pdf_de_formato` se caeria con NameError en el primer clic.
    if '_pdf_de_formato' not in v:
        faltan.append('el bloque de parche_reportes_pdf.py (pasalo antes)')
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
        ('los generadores del B-9',
         lambda: copiar_generadores(args.generador, args.dry_run)),
        ('la ruta /B-9/pdf/', lambda: poner_bloque(
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
    print('\nY comprobar:')
    print('  docker exec django_api python3 /opt/jurp-gis/reportes_b9_datos.py'
          ' --comprobar')
    print('  curl -s -o /tmp/b9.pdf -w "%{http_code} %{size_download}\\n" \\')
    print('    "http://127.0.0.1:8005/api/v1/inventario/reportes/B-9/pdf/'
          '?ambito=todos"')
    print('  pdfinfo /tmp/b9.pdf 2>/dev/null | head -3 || file /tmp/b9.pdf')


if __name__ == '__main__':
    main()
