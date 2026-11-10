# -*- coding: utf-8 -*-
"""
La ficha de levantamiento en campo, descargable desde el panel.

    python3 parche_fichas_inspeccion.py [--raiz /var/www/envs/vigilantes] [--dry-run]
    cd /var/www/envs/vigilantes && docker compose restart web

Tres pasos:

  1. Copia `fichas_inspeccion.py` junto al generador, en /opt/jurp-gis/.
  2. Copia ahí los croquis acotados del repo del front. Tienen que estar en
     /opt/jurp-gis porque es lo único de la máquina que ve el contenedor:
     el repo del front no está montado dentro, y sin los croquis la ficha
     sale correcta pero muda —las cotas piden «b₁» y «Z» y esas letras solo
     significan algo sobre el dibujo—.
  3. Añade `GET /reportes/fichas/?tipo=&ambito=&campania=&fid=`.

QUÉ SALE HOY
------------
No hay evaluaciones de `tomas_canal_madre` ni fotos cargadas, así que las
fichas salen con la identificación y la ubicación de la capa y el resto en
blanco: el formato listo para imprimir y llevar al canal. El mismo archivo,
cuando existan las evaluaciones, sale relleno sin tocar nada.
"""

import argparse
import os
import re
import shutil
import sys


AQUI = os.path.dirname(os.path.abspath(__file__))
GENERADOR = '/opt/jurp-gis'
FUENTE = os.path.join(AQUI, 'fichas_inspeccion.py')
ESQUEMAS = os.path.join(os.path.dirname(AQUI), 'src', 'assets', 'esquemas')

MARCA = '# ── Las fichas de levantamiento en campo'

BLOQUE = MARCA + ''' ─────────────────────

def _fichas_de_campo(self, request):
    """Las fichas del tipo pedido, en un PDF.

    GET /reportes/fichas/?tipo=tomas_canal_madre&ambito=PECH[&campania=][&fid=]

    Dos paginas por estructura. Con ?fid= sale una sola, que es lo que
    hace falta cuando se va a visitar una.
    """
    import subprocess
    from django.http import FileResponse, JsonResponse

    tipos = ('tomas_canal_madre', 'tomas_l10')
    tipo = request.query_params.get('tipo', 'tomas_canal_madre')
    if tipo not in tipos:
        return JsonResponse({'detail': f'tipo no admitido; usa {tipos}'},
                            status=400)

    ambito, campania = self._parametros(request)
    fid = request.query_params.get('fid')
    try:
        fid = int(fid) if fid else None
    except (TypeError, ValueError):
        fid = None

    os.makedirs(self.SALIDA, exist_ok=True)
    sufijo = f'_{campania}' if campania else ''
    if fid:
        sufijo += f'_{fid}'
    ruta = os.path.join(self.SALIDA,
                        f'Fichas_Inspeccion_{tipo}_{ambito}{sufijo}.pdf')

    # Una ficha suelta se rehace siempre: se pide justo despues de corregir
    # el dato, y servir la de hace un rato seria peor que tardar un segundo.
    if fid or not self._vigente(ruta, campania):
        entorno = os.environ.copy()
        clave_bd = (os.environ.get('GIS_ADMIN_PASSWORD')
                    or os.environ.get('PGPASSWORD'))
        if clave_bd:
            entorno['PGPASSWORD'] = clave_bd

        base = os.path.dirname(self.GENERADOR)
        cmd = ['python3', os.path.join(base, 'fichas_inspeccion.py'),
               '--tipo', tipo, '--ambito', ambito,
               '--salida', self.SALIDA,
               '--esquemas', os.path.join(base, 'esquemas')]
        if campania:
            cmd += ['--campania', str(campania)]
        if fid:
            cmd += ['--fid', str(fid)]

        try:
            r = subprocess.run(cmd, capture_output=True, text=True,
                               timeout=300, env=entorno)
        except subprocess.TimeoutExpired:
            return JsonResponse({'detail': 'Las fichas tardaron demasiado.'},
                                status=504)
        except FileNotFoundError:
            return JsonResponse(
                {'detail': 'No se encontro fichas_inspeccion.py junto al generador.'},
                status=500)

        if r.returncode != 0 or not os.path.exists(ruta):
            detalle = (r.stderr or r.stdout or '').strip()[:300]
            return JsonResponse(
                {'detail': detalle or 'El generador no produjo las fichas.'},
                status=500)

    return FileResponse(open(ruta, 'rb'), as_attachment=True,
                        filename=os.path.basename(ruta),
                        content_type='application/pdf')


# El nombre de la funcion TIENE que coincidir con el del atributo o DRF
# tumba el URLconf entero al construir las rutas.
_fichas_de_campo.__name__ = 'fichas'
ReporteViewSet.fichas = action(
    detail=False, methods=['get'], url_path='fichas')(_fichas_de_campo)
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


INICIO = '# ── '


def poner_bloque(ruta, marca, bloque, simulacro):
    """Pega o actualiza un bloque marcado, sin tocar los que vengan detras.

    Un bloque termina donde empieza el siguiente —la siguiente linea que
    abre con `# ── `— y no al final del archivo. La version anterior
    reemplazaba hasta el final: con un solo bloque daba igual, pero ya son
    tres —formatos, fichas y B-9— y volver a pasar este parche borraba los
    otros dos, dejando la API sin esas rutas sin que nada lo dijera.
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


def copiar(origen, destino, simulacro):
    if not os.path.exists(origen):
        return False, 'no encuentro {0}'.format(origen)
    if os.path.exists(destino) and leer(destino) == leer(origen):
        return True, 'ya estaba, igual'
    if simulacro:
        return True, 'se copiaria'
    if os.path.exists(destino):
        shutil.copy2(destino, destino + '.bak')
    shutil.copy2(origen, destino)
    return True, 'copiado'


def copiar_esquemas(destino, simulacro):
    if not os.path.isdir(ESQUEMAS):
        return False, 'no encuentro los croquis en {0}'.format(ESQUEMAS)
    if not simulacro:
        os.makedirs(destino, exist_ok=True)
    copiados = 0
    for nombre in sorted(os.listdir(ESQUEMAS)):
        if not nombre.lower().endswith(('.webp', '.png', '.jpg', '.jpeg')):
            continue
        fin = os.path.join(destino, nombre)
        if os.path.exists(fin) and os.path.getsize(fin) == os.path.getsize(
                os.path.join(ESQUEMAS, nombre)):
            continue
        if not simulacro:
            shutil.copy2(os.path.join(ESQUEMAS, nombre), fin)
        copiados += 1
    return True, ('{0} croquis'.format(copiados) if copiados else 'ya estaban')


def comprobar_base(app):
    v = leer(os.path.join(app, 'views.py'))
    faltan = []
    for nombre, patron in (
            ('la clase ReporteViewSet', r'^class ReporteViewSet'),
            ('el import de action', r'^from rest_framework\.decorators import .*\baction\b'),
            ('el import de os', r'^import os')):
        if not re.search(patron, v, re.M):
            faltan.append(nombre)
    if '_parametros' not in v:
        faltan.append('el metodo _parametros del ViewSet')
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
        ('el generador de fichas', lambda: copiar(
            FUENTE, os.path.join(args.generador, 'fichas_inspeccion.py'),
            args.dry_run)),
        ('los croquis', lambda: copiar_esquemas(
            os.path.join(args.generador, 'esquemas'), args.dry_run)),
        ('la ruta /fichas/', lambda: poner_bloque(
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
    print('  curl -s -o /tmp/fichas.pdf -w "%{http_code} %{size_download}\\n" \\')
    print('    "http://127.0.0.1:8005/api/v1/inventario/reportes/fichas/'
          '?tipo=tomas_canal_madre&ambito=PECH"')
    print('  pdfinfo /tmp/fichas.pdf 2>/dev/null | head -3 || file /tmp/fichas.pdf')


if __name__ == '__main__':
    main()
