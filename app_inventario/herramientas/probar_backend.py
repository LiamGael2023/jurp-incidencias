# -*- coding: utf-8 -*-
"""
¿Contesta el backend lo que la app espera?

    # en el servidor, contra el contenedor
    python3 herramientas/probar_backend.py --base http://127.0.0.1:8005/api/v1/inventario

    # desde fuera, contra el dominio
    python3 herramientas/probar_backend.py

    # además, un alta de verdad que se crea y se borra
    python3 herramientas/probar_backend.py --escribir

Devuelve 0 si todo pasa, 1 si algo falla.

QUÉ COMPRUEBA Y QUÉ NO
----------------------
Recorre TODAS las rutas que llama `services/inventario_service.dart`, con
las mismas URL y los mismos cuerpos, y mira dos cosas en cada una: que
conteste, y que lo que conteste traiga los campos que los modelos de la app
leen. Lo segundo es lo que importa: un endpoint que devuelve 200 y le
cambia el nombre a un campo no rompe nada en el servidor y deja la app
enseñando huecos en el cerro, donde nadie puede mirar un log.

NO sustituye a probar la app. No comprueba la pantalla, ni el GPS, ni la
cámara, ni la bandeja de pendientes. Comprueba el contrato entre las dos
mitades, que es la que se rompe en silencio cuando una avanza sin la otra.

POR DEFECTO NO ESCRIBE NADA. Las rutas de escritura se prueban mandando un
cuerpo incompleto a propósito y esperando un 400 con errores por campo: eso
demuestra que la ruta existe, acepta JSON y valida, sin dejar basura en una
base de producción. Con `--escribir` hace además un alta de verdad, la
busca en la lista de pendientes y la borra.

Solo biblioteca estándar: tiene que poder correr en el servidor, donde no
hay pip.
"""
import argparse
import json
import sys
import time
import urllib.error
import urllib.request

BASE_POR_DEFECTO = ('https://nexhydro.jriegopresurizado.org.pe'
                    '/vigapi/inventario')

# Los campos que lee cada modelo de la app (`models/modelos.dart`). No están
# todos: solo los que, si faltan, dejan la pantalla con un hueco o un cero.
CAMPOS = {
    'campania': ['id', 'anio', 'estado'],
    'total_capa': ['codigo', 'total'],
    'avance': ['total', 'evaluados'],
    'indice': ['tipo', 'fid', 'nombre', 'lat', 'lng'],
    'evaluacion': ['id', 'tipo_activo', 'activo_fid', 'valores'],
    'campo': ['codigo', 'etiqueta', 'tipo_dato'],
    'formato': ['clave', 'titulo', 'archivo'],
    'foto': ['id', 'imagen_api'],
    'activo_nuevo': ['id', 'tipo_activo', 'validacion'],
}


class Resultado:
    def __init__(self):
        self.ok = 0
        self.fallos = []
        self.avisos = []

    def bien(self, que, detalle=''):
        self.ok += 1
        print(f'  OK   {que}{(" — " + detalle) if detalle else ""}')

    def mal(self, que, porque):
        self.fallos.append(f'{que}: {porque}')
        print(f'  MAL  {que} — {porque}')

    def aviso(self, que, porque):
        self.avisos.append(f'{que}: {porque}')
        print(f'  ~    {que} — {porque}')


def pedir(url, metodo='GET', cuerpo=None, plazo=60):
    """→ (codigo, cabeceras, bytes). Un error HTTP no es una excepción aquí:
    el código es parte de lo que se está comprobando."""
    datos = None
    cabeceras = {'Accept': 'application/json'}
    if cuerpo is not None:
        datos = json.dumps(cuerpo).encode('utf-8')
        cabeceras['Content-Type'] = 'application/json'
    pet = urllib.request.Request(url, data=datos, headers=cabeceras,
                                 method=metodo)
    try:
        with urllib.request.urlopen(pet, timeout=plazo) as r:
            return r.status, dict(r.headers), r.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read()
    except Exception as e:
        return 0, {}, str(e).encode('utf-8')


def como_lista(crudo):
    """La app normaliza {results: []} y la lista pelada; aquí igual."""
    try:
        d = json.loads(crudo.decode('utf-8'))
    except Exception:
        return None
    if isinstance(d, list):
        return d
    if isinstance(d, dict):
        r = d.get('results')
        if isinstance(r, list):
            return r
    return None


def faltan(fila, claves):
    return [k for k in claves if k not in fila]


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--base', default=BASE_POR_DEFECTO)
    p.add_argument('--escribir', action='store_true',
                   help='crea un alta de prueba y la borra')
    args = p.parse_args()
    base = args.base.rstrip('/')

    R = Resultado()
    print(f'backend: {base}\n')

    # ── 1. campañas ───────────────────────────────────────────────────────
    print('campañas')
    cod, _, crudo = pedir(f'{base}/campanias/')
    campanias = como_lista(crudo) if cod == 200 else None
    if campanias is None:
        R.mal('GET /campanias/', f'HTTP {cod}; {crudo[:120]!r}')
        print('\nSin campañas no se puede seguir: todo lo demás cuelga de una.')
        return 1
    if not campanias:
        R.mal('GET /campanias/', 'no hay ninguna campaña')
        return 1
    f = faltan(campanias[0], CAMPOS['campania'])
    if f:
        R.mal('campaña', f'le faltan campos: {", ".join(f)}')
    else:
        R.bien('GET /campanias/', f'{len(campanias)} campaña(s)')

    activa = next((c for c in campanias if c.get('estado') == 'en_proceso'),
                  campanias[0])
    anio, cid = activa.get('anio'), activa.get('id')
    print(f'       campaña de trabajo: {anio} (id {cid})')

    # ── 2. capas y totales ────────────────────────────────────────────────
    print('\ncapas')
    cod, _, crudo = pedir(f'{base}/capas/')
    capas = como_lista(crudo) if cod == 200 else None
    if capas is None:
        R.mal('GET /capas/', f'HTTP {cod}')
        capas = []
    else:
        f = faltan(capas[0], CAMPOS['total_capa'])
        if f:
            R.mal('capa', f'le faltan campos: {", ".join(f)}')
        else:
            R.bien('GET /capas/', f'{len(capas)} capas')

    # LA COMPROBACIÓN QUE MÁS VALE DE TODAS: el catálogo de la app está
    # escrito a mano, así que una capa que pide y el servidor no tiene es
    # una pestaña que no dibuja nada y no dice por qué.
    del_servidor = {c.get('codigo') for c in capas}
    de_la_app = codigos_de_la_app()
    if de_la_app:
        sobran = sorted(de_la_app - del_servidor)
        if sobran:
            R.mal('catálogo de la app',
                  f'pide capas que el servidor no tiene: {", ".join(sobran)}')
        else:
            R.bien('catálogo de la app',
                   f'las {len(de_la_app)} capas existen en el servidor')
        nuevas = sorted(del_servidor - de_la_app)
        if nuevas:
            R.aviso('catálogo de la app',
                    f'el servidor tiene capas que la app no dibuja: '
                    f'{", ".join(nuevas)}')

    # ── 3. el índice ──────────────────────────────────────────────────────
    print('\níndice de búsqueda')
    cod, _, crudo = pedir(f'{base}/capas/indice/')
    indice = como_lista(crudo) if cod == 200 else None
    if indice is None:
        R.mal('GET /capas/indice/', f'HTTP {cod}')
    elif not indice:
        R.aviso('GET /capas/indice/', 'vacío')
    else:
        f = faltan(indice[0], CAMPOS['indice'])
        if f:
            # No es fatal —la app busca por nombre igual— pero sin lat/lng
            # no puede volar a lo que encuentre, que es la mitad del punto.
            R.mal('índice', f'le faltan campos: {", ".join(f)}')
        else:
            R.bien('GET /capas/indice/', f'{len(indice)} estructuras')
        sin_coord = sum(1 for x in indice
                        if x.get('lat') in (None, '') or
                        x.get('lng') in (None, ''))
        if sin_coord:
            R.aviso('índice', f'{sin_coord} de {len(indice)} sin coordenadas: '
                    'la app no podrá volar a esas')

    # ── 4. una capa de verdad ─────────────────────────────────────────────
    print('\ngeometrías')
    muestra = next((c.get('codigo') for c in capas
                    if (c.get('total') or 0) > 0), None)
    if muestra is None:
        R.aviso('GET /capas/<codigo>/', 'ninguna capa tiene activos')
    else:
        cod, _, crudo = pedir(f'{base}/capas/{muestra}/?srid=4326')
        if cod != 200:
            R.mal(f'GET /capas/{muestra}/', f'HTTP {cod}')
        else:
            try:
                geo = json.loads(crudo.decode('utf-8'))
                rasgos = geo.get('features') or []
                if not rasgos:
                    R.aviso(f'capa {muestra}', 'GeoJSON sin features')
                elif 'fid' not in (rasgos[0].get('properties') or {}):
                    # Esto exacto tumbó el visor web: el fid llega en
                    # feature.id, fuera de properties, y sin él no hay a qué
                    # colgar la evaluación.
                    R.mal(f'capa {muestra}',
                          'las features no traen properties.fid')
                else:
                    R.bien(f'GET /capas/{muestra}/',
                           f'{len(rasgos)} features con fid')
            except Exception as e:
                R.mal(f'capa {muestra}', f'no es GeoJSON: {e}')

    # ── 5. avance y evaluaciones ──────────────────────────────────────────
    print('\ncampaña en curso')
    cod, _, crudo = pedir(f'{base}/campanias/{cid}/avance/')
    av = como_lista(crudo) if cod == 200 else None
    if av is None:
        R.mal(f'GET /campanias/{cid}/avance/', f'HTTP {cod}')
    elif av:
        f = faltan(av[0], CAMPOS['avance'])
        R.mal('avance', f'le faltan campos: {", ".join(f)}') if f \
            else R.bien('GET /campanias/<id>/avance/', f'{len(av)} capas')
    else:
        R.aviso('avance', 'vacío')

    cod, _, crudo = pedir(f'{base}/evaluaciones/?campania={anio}')
    evs = como_lista(crudo) if cod == 200 else None
    if evs is None:
        R.mal(f'GET /evaluaciones/?campania={anio}', f'HTTP {cod}')
    elif evs:
        f = faltan(evs[0], CAMPOS['evaluacion'])
        R.mal('evaluación', f'le faltan campos: {", ".join(f)}') if f \
            else R.bien('GET /evaluaciones/', f'{len(evs)} evaluadas')
    else:
        R.aviso('GET /evaluaciones/', f'ninguna evaluación en {anio}')

    # ── 6. el formulario ──────────────────────────────────────────────────
    print('\nformulario de evaluación')
    tipo = (evs[0].get('tipo_activo') if evs else muestra) or 'canoas'
    cod, _, crudo = pedir(f'{base}/campos-evaluables/?tipo_activo={tipo}')
    campos = como_lista(crudo) if cod == 200 else None
    if campos is None:
        R.mal(f'GET /campos-evaluables/?tipo_activo={tipo}', f'HTTP {cod}')
    elif not campos:
        # Sin campos la pantalla de evaluar sale en blanco: el formulario no
        # está en la app, lo sirve el backend.
        R.mal(f'campos-evaluables de {tipo}',
              'ninguno: la pantalla de evaluar saldría vacía')
    else:
        f = faltan(campos[0], CAMPOS['campo'])
        R.mal('campo evaluable', f'le faltan: {", ".join(f)}') if f \
            else R.bien(f'GET /campos-evaluables/ ({tipo})',
                        f'{len(campos)} campos')

    # ── 7. fotos ──────────────────────────────────────────────────────────
    print('\nfotos')
    fid_muestra = evs[0].get('activo_fid') if evs else 1
    cod, _, crudo = pedir(
        f'{base}/fotos/?tipo_activo={tipo}&activo_fid={fid_muestra}')
    if cod == 404:
        R.aviso('GET /fotos/', 'este servidor no tiene almacén de fotos')
    elif cod != 200:
        R.mal('GET /fotos/', f'HTTP {cod}')
    else:
        fotos = como_lista(crudo)
        if fotos is None:
            R.mal('GET /fotos/', 'no devolvió una lista')
        elif not fotos:
            R.aviso('GET /fotos/', f'{tipo} #{fid_muestra} no tiene fotos')
        else:
            f = faltan(fotos[0], CAMPOS['foto'])
            if f:
                # `imagen_api` es la que usa la app para enseñarla: sin ella
                # cae a `imagen`, que apunta a 127.0.0.1 y no carga.
                R.mal('foto', f'le faltan: {", ".join(f)}')
            else:
                R.bien('GET /fotos/', f'{len(fotos)} foto(s) con imagen_api')

    # ── 8. reportes y fichas ──────────────────────────────────────────────
    print('\nreportes')
    cod, _, crudo = pedir(f'{base}/reportes/?ambito=JURP&campania={anio}')
    formatos = None
    if cod != 200:
        R.mal('GET /reportes/', f'HTTP {cod}')
    else:
        try:
            formatos = (json.loads(crudo.decode('utf-8')) or {}).get('formatos')
        except Exception:
            formatos = None
        if not formatos:
            R.mal('GET /reportes/', 'sin lista de formatos')
        else:
            f = faltan(formatos[0], CAMPOS['formato'])
            R.mal('formato', f'le faltan: {", ".join(f)}') if f \
                else R.bien('GET /reportes/', f'{len(formatos)} formatos')

    if formatos:
        clave = formatos[0]['clave']
        cod, cab, crudo = pedir(
            f'{base}/reportes/{clave}/pdf/?ambito=JURP&campania={anio}',
            plazo=180)
        es_pdf = crudo[:4] == b'%PDF'
        if cod == 200 and es_pdf:
            R.bien(f'GET /reportes/{clave}/pdf/', f'{len(crudo)} bytes')
        else:
            R.mal(f'GET /reportes/{clave}/pdf/',
                  f'HTTP {cod}, {"no es PDF" if cod == 200 else ""} '
                  f'{crudo[:120]!r}')

    cod, _, crudo = pedir(
        f'{base}/reportes/fichas/?tipo={tipo}&ambito=JURP&campania={anio}',
        plazo=300)
    if cod == 200 and crudo[:4] == b'%PDF':
        R.bien(f'GET /reportes/fichas/ ({tipo})', f'{len(crudo)} bytes')
    else:
        R.mal(f'GET /reportes/fichas/ ({tipo})',
              f'HTTP {cod}; {crudo[:160]!r}')

    if evs:
        cod, _, crudo = pedir(
            f'{base}/reportes/fichas/?tipo={tipo}&fid={fid_muestra}'
            f'&ambito=JURP&campania={anio}', plazo=300)
        if cod == 200 and crudo[:4] == b'%PDF':
            R.bien('GET /reportes/fichas/ (una estructura)',
                   f'{len(crudo)} bytes')
        else:
            R.mal('GET /reportes/fichas/ (una estructura)',
                  f'HTTP {cod}; {crudo[:160]!r}')

    # ── 9. escrituras ─────────────────────────────────────────────────────
    print('\nescrituras (sin escribir)')

    # Un cuerpo incompleto a propósito: un 400 con errores por campo
    # demuestra que la ruta existe, acepta JSON y valida. Un 404 o un 405
    # demuestran lo contrario, y es justo lo que rompería el alta en campo.
    cod, _, crudo = pedir(f'{base}/activos-nuevos/', 'POST', {})
    if cod == 400:
        R.bien('POST /activos-nuevos/', 'existe y valida (400 esperado)')
    elif cod in (404, 405):
        R.mal('POST /activos-nuevos/',
              f'HTTP {cod}: el alta de la app no funcionaría')
    else:
        R.aviso('POST /activos-nuevos/', f'contestó {cod}, esperaba 400')

    cod, _, crudo = pedir(f'{base}/evaluaciones/', 'POST', {})
    if cod == 400:
        R.bien('POST /evaluaciones/', 'existe y valida (400 esperado)')
    elif cod in (404, 405):
        R.mal('POST /evaluaciones/', f'HTTP {cod}: no se podría evaluar')
    else:
        R.aviso('POST /evaluaciones/', f'contestó {cod}, esperaba 400')

    cod, _, crudo = pedir(f'{base}/activos-nuevos/?validacion=pendiente')
    pend = como_lista(crudo) if cod == 200 else None
    if pend is None:
        R.mal('GET /activos-nuevos/?validacion=pendiente', f'HTTP {cod}')
    else:
        R.bien('GET /activos-nuevos/', f'{len(pend)} pendiente(s)')

    if args.escribir:
        print('\nalta de verdad (se crea y se borra)')
        probar_alta_real(base, cid, tipo, R)

    # ── resumen ───────────────────────────────────────────────────────────
    print(f'\n{R.ok} comprobaciones pasadas, {len(R.fallos)} fallo(s), '
          f'{len(R.avisos)} aviso(s)')
    if R.fallos:
        print('\nLo que rompería la app:')
        for x in R.fallos:
            print(f'  - {x}')
        return 1
    if R.avisos:
        print('\nAvisos (no rompen, pero conviene mirarlos):')
        for x in R.avisos:
            print(f'  - {x}')
    return 0


def probar_alta_real(base, campania_id, tipo, R):
    """El viaje completo: crear, encontrarla y borrarla.

    El nombre lleva la hora para que, si algo se queda a medias, se sepa de
    un vistazo que es basura de una prueba y de cuándo.
    """
    marca = f'PRUEBA-APP-{time.strftime("%Y%m%d-%H%M%S")}'
    cuerpo = {
        'campania': campania_id,
        'tipo_activo': tipo,
        # El mismo EWKT que manda la app, en el ámbito de la Junta.
        'geom': 'SRID=32717;POINT(747202.77 9069335.05)',
        'nombre': marca,
        'descripcion': 'Alta de prueba de probar_backend.py. '
                       'Si la ves, es que el borrado falló: bórrala.',
        'registrado_por': 'probar_backend.py',
        'atributos': {},
    }
    cod, _, crudo = pedir(f'{base}/activos-nuevos/', 'POST', cuerpo)
    if cod not in (200, 201):
        R.mal('alta real', f'HTTP {cod}; {crudo[:200]!r}')
        return
    try:
        creada = json.loads(crudo.decode('utf-8'))
    except Exception:
        R.mal('alta real', 'la respuesta no era JSON')
        return
    f = faltan(creada, CAMPOS['activo_nuevo'])
    if f:
        R.mal('alta real', f'la respuesta no trae: {", ".join(f)}')
    aid = creada.get('id')
    if not aid:
        R.mal('alta real', 'el servidor no devolvió identificador')
        return
    R.bien('POST /activos-nuevos/', f'creada #{aid} como «{marca}»')

    cod, _, crudo = pedir(f'{base}/activos-nuevos/?validacion=pendiente')
    lista = como_lista(crudo) or []
    if any(str(x.get('id')) == str(aid) for x in lista):
        R.bien('alta real', 'aparece en la lista de pendientes')
    else:
        R.mal('alta real', 'no aparece entre las pendientes')

    cod, _, crudo = pedir(f'{base}/activos-nuevos/{aid}/', 'DELETE')
    if cod in (200, 204):
        R.bien('DELETE /activos-nuevos/<id>/', 'la prueba quedó borrada')
    else:
        R.mal('DELETE /activos-nuevos/<id>/',
              f'HTTP {cod}: BORRA A MANO el alta #{aid} («{marca}»)')


def codigos_de_la_app():
    """Los códigos del catálogo de la app, leídos del propio Dart."""
    import os
    import re
    aqui = os.path.dirname(os.path.abspath(__file__))
    ruta = os.path.join(aqui, '..', 'lib', 'src', 'utils',
                        'catalogo_capas.dart')
    if not os.path.exists(ruta):
        return set()
    s = open(ruta, encoding='utf-8').read()
    return set(re.findall(r"Capa\('([^']+)'", s))


if __name__ == '__main__':
    sys.exit(main())
