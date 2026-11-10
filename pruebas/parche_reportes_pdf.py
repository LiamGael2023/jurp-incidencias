# -*- coding: utf-8 -*-
"""
Los formatos de la ANA, también en PDF.

    python3 parche_reportes_pdf.py [--raiz /var/www/envs/vigilantes] [--dry-run]
    cd /var/www/envs/vigilantes && docker compose restart web

Hace dos cosas:

  1. Copia `reportes_pdf.py` junto al generador, en /opt/jurp-gis/. Ese
     módulo dibuja el PDF leyendo la MISMA configuración de columnas que
     arma el Excel, así que una columna nueva allí sale en los dos.

  2. Añade `GET /reportes/<clave>/pdf/` a la API. El panel pasa a ofrecer
     los dos botones por formato.

POR QUÉ UNA ACCIÓN NUEVA Y NO UN `?formato=pdf`
------------------------------------------------
Lo segundo sería más elegante, pero obliga a entrar a editar `retrieve`,
`list` y el ZIP —tres métodos, en medio de la clase— y este parche pega
bloques al final del archivo, que es lo que permite volver a pasarlo y
corregir la versión anterior sin adivinar qué había. Una acción aparte no
toca nada de lo que ya funciona.

EL __name__ DE LA ACCIÓN
------------------------
Al construir las rutas, DRF comprueba con un assert que cada acción se
llame igual que el atributo donde está colgada. Si no coinciden, el assert
salta al importar urls.py y se cae el URLconf ENTERO: la API devuelve 500
en todas sus rutas y el error no menciona ni el nombre ni la acción. Ya
pasó una vez; de ahí la línea que fija `__name__`.
"""

import argparse
import os
import re
import shutil
import sys


GENERADOR = '/opt/jurp-gis'
FUENTE = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                      'reportes_pdf.py')

MARCA = '# ── Los formatos, también en PDF'

BLOQUE = MARCA + ''' ──────────────────────────────

def _pdf_de_formato(self, request, pk=None):
    """Dibuja el formato en PDF y lo entrega.

    Mismos parametros que el Excel: ?ambito= y ?campania=. El archivo se
    guarda al lado del .xlsx y se reutiliza con la misma regla de frescura,
    para no redibujar en cada clic lo que no ha cambiado.
    """
    import subprocess
    from django.http import FileResponse, JsonResponse

    clave = pk
    if clave not in self.FORMATOS:
        return JsonResponse({'detail': 'formato desconocido'}, status=404)

    # El B-9 lo arma su propia funcion, por bloques, y no tiene columnas
    # que dibujar en una tabla. Decirlo es mejor que devolver un PDF vacio.
    if clave == 'B-9':
        return JsonResponse(
            {'detail': 'El resumen B-9 todavia solo se entrega en Excel.'},
            status=409)

    ambito, campania = self._parametros(request)
    os.makedirs(self.SALIDA, exist_ok=True)
    base = self.FORMATOS[clave][0]
    sufijo = f'_{campania}' if campania else ''
    ruta = os.path.join(self.SALIDA, f'{base}_{ambito}{sufijo}.pdf')

    if not self._vigente(ruta, campania):
        entorno = os.environ.copy()
        clave_bd = (os.environ.get('GIS_ADMIN_PASSWORD')
                    or os.environ.get('PGPASSWORD'))
        if clave_bd:
            entorno['PGPASSWORD'] = clave_bd

        cmd = ['python3', os.path.join(os.path.dirname(self.GENERADOR),
                                       'reportes_pdf.py'),
               '--formato', clave, '--ambito', ambito, '--salida', self.SALIDA]
        if campania:
            cmd += ['--campania', str(campania)]

        try:
            r = subprocess.run(cmd, capture_output=True, text=True,
                               timeout=180, env=entorno)
        except subprocess.TimeoutExpired:
            return JsonResponse({'detail': 'El reporte tardo demasiado.'},
                                status=504)
        except FileNotFoundError:
            return JsonResponse(
                {'detail': 'No se encontro reportes_pdf.py junto al generador.'},
                status=500)

        if r.returncode != 0 or not os.path.exists(ruta):
            detalle = (r.stderr or r.stdout or '').strip()[:300]
            return JsonResponse(
                {'detail': detalle or 'El generador no produjo el PDF.'},
                status=500)

    return FileResponse(open(ruta, 'rb'), as_attachment=True,
                        filename=os.path.basename(ruta),
                        content_type='application/pdf')


# Ver la cabecera del parche: el nombre de la funcion TIENE que coincidir
# con el del atributo, o DRF tumba el URLconf entero al arrancar.
_pdf_de_formato.__name__ = 'pdf'
ReporteViewSet.pdf = action(
    detail=True, methods=['get'], url_path='pdf')(_pdf_de_formato)
'''


def leer(ruta):
    with open(ruta) as f:
        return f.read()


def escribir(ruta, texto, simulacro):
    try:
        compile(texto, ruta, 'exec')
    except SyntaxError as e:
        raise IOError('el resultado no compila: {0} (linea {1})'.format(e.msg, e.lineno))
    if simulacro:
        return
    shutil.copy2(ruta, ruta + '.bak')
    with open(ruta, 'w') as f:
        f.write(texto)


def poner_bloque(ruta, marca, bloque, simulacro):
    t = leer(ruta)
    veces = t.count(marca)
    if veces > 1:
        return False, 'la marca sale {0} veces; revisalo a mano'.format(veces)
    if veces == 1:
        if t[t.index(marca):] == bloque:
            return True, 'ya estaba'
        escribir(ruta, t[:t.index(marca)] + bloque, simulacro)
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
    """Deja reportes_pdf.py junto a reportes_ana.py.

    Tienen que estar en la misma carpeta: el modulo importa al otro para
    leerle la configuracion de los formatos y la funcion de progresivas.
    """
    if not os.path.isdir(destino):
        return False, 'no existe {0}'.format(destino)
    if not os.path.exists(os.path.join(destino, 'reportes_ana.py')):
        return False, 'no esta reportes_ana.py en {0}'.format(destino)
    if not os.path.exists(FUENTE):
        return False, 'no encuentro {0}'.format(FUENTE)
    fin = os.path.join(destino, 'reportes_pdf.py')
    if os.path.exists(fin) and leer(fin) == leer(FUENTE):
        return True, 'ya estaba, igual'
    if simulacro:
        return True, 'se copiaria'
    if os.path.exists(fin):
        shutil.copy2(fin, fin + '.bak')
    shutil.copy2(FUENTE, fin)
    return True, 'copiado'


def comprobar_base(app):
    v = leer(os.path.join(app, 'views.py'))
    faltan = []
    for nombre, patron in (
            ('la clase ReporteViewSet', r'^class ReporteViewSet'),
            ('el import de action', r'^from rest_framework\.decorators import .*\baction\b'),
            ('el import de os', r'^import os')):
        if not re.search(patron, v, re.M):
            faltan.append(nombre)
    if 'FORMATOS' not in v:
        faltan.append('el diccionario FORMATOS del ViewSet')
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
        print('[MAL] falta lo que este parche necesita: {0}'.format(', '.join(faltan)))
        sys.exit(1)

    pasos = [
        ('el dibujante', lambda: copiar_generador(args.generador, args.dry_run)),
        ('la ruta /pdf/', lambda: poner_bloque(
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
    print('\nY comprobar, que la accion se cuelga a mano y el archivo que')
    print('compila no garantiza que la ruta exista:')
    print('  curl -s -o /tmp/b1a.pdf -w "%{http_code} %{size_download}\\n" \\')
    print('    "http://127.0.0.1:8005/api/v1/inventario/reportes/B-1.A/pdf/?ambito=JURP"')
    print('  file /tmp/b1a.pdf')


if __name__ == '__main__':
    main()
