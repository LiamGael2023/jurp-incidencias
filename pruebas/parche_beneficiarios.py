# -*- coding: utf-8 -*-
"""
Beneficiarios por estructura: N de usuarios y area en hectareas.

POR QUE HACE FALTA
------------------
El reporte de avance del convenio JURP-JUCH lleva un bloque de BENEFICIARIOS
DIRECTOS con dos cifras: cuantos usuarios y cuantas hectareas. El sistema no
las tiene en ninguna tabla, asi que hoy ese bloque se escribe a mano en un
Excel aparte y nadie sabe de donde salio cada numero.

DONDE VAN, Y POR QUE AHI
------------------------
En la PARTIDA, y se llenan en las de titulo de primer nivel: «DV Compositan
I», «DV 3.1»... Esas filas YA son las estructuras del presupuesto -el
equivalente de los «Dren CH 10.1» del reporte-, asi que no hace falta una
tabla nueva ni decidir a mano que es una estructura y que no.

Puestas por estructura y no por proyecto, el total se suma solo y el reporte
sigue cuadrando cuando se filtra por un dren concreto. Una sola cifra en el
proyecto se habria quedado sin poder desglosar.

UN TITULO SI PUEDE LLEVARLAS
----------------------------
_lee_campos() corta en seco para los titulos: un titulo no lleva unidad ni
precio, porque su total es la suma de sus hijos y tener precio propio lo
contaria dos veces. Los beneficiarios no son eso: no entran en ninguna suma
de dinero ni de metrado, son un dato del dren. Por eso se leen ANTES de ese
corte.

QUE TOCA
--------
    1. operations/models.py       usuarios y area_ha en Partida
    2. operations/serializers.py  exponerlos en PartidaSerializer
    3. operations/views.py        que se puedan guardar y que vuelvan

USO
---
    python3 parche_beneficiarios.py [--raiz /var/www/envs/vigilantes] [--dry-run]

Despues hay que migrar. Es idempotente y deja .bak de cada archivo.
"""

import argparse
import os
import re
import shutil
import sys


CAMPOS = '''    # ── Beneficiarios de esta estructura ──
    # Se llenan en las filas de titulo de primer nivel, que son los drenes.
    # NO entran en ninguna suma de dinero ni de metrado: son un dato del dren
    # para el reporte del convenio.
    usuarios = models.PositiveIntegerField("N de usuarios", default=0)
    area_ha = models.DecimalField("Area beneficiada (ha)", max_digits=12,
                                  decimal_places=2, default=0)

'''

LEE = '''    # Los beneficiarios se leen ANTES del corte de los titulos: es justo en
    # los titulos de primer nivel -los drenes- donde se llenan.
    if "usuarios" in datos:
        n = _numero(datos.get("usuarios", 0), "usuarios", errores, minimo=0)
        if n is not None:
            out["usuarios"] = int(n)
    if "area_ha" in datos:
        n = _numero(datos.get("area_ha", 0), "area_ha", errores, minimo=0)
        if n is not None:
            out["area_ha"] = n

'''

FILA = '''        "usuarios": int(getattr(p, "usuarios", 0) or 0),
        "area_ha": float(getattr(p, "area_ha", 0) or 0),
'''


def leer(ruta):
    with open(ruta, 'r') as f:
        return f.read()


def escribir(ruta, texto, simulacro):
    if simulacro:
        return
    shutil.copy2(ruta, ruta + '.bak')
    with open(ruta, 'w') as f:
        f.write(texto)


def paso_modelo(raiz, simulacro):
    """Los dos campos dentro de class Partida, justo antes de su Meta.

    Se ancla en el Meta y no en un campo concreto porque el modelo ha ido
    creciendo con los parches y no se puede dar por sabido que campos tiene.
    """
    ruta = os.path.join(raiz, 'operations/models.py')
    if not os.path.exists(ruta):
        return False, 'no existe {0}'.format(ruta)
    t = leer(ruta)
    if 'area_ha' in t:
        return True, 'ya estaba'

    m = re.search(r'^class Partida\(models\.Model\):', t, re.M)
    if not m:
        return False, 'no encuentro class Partida en models.py'
    meta = re.search(r'^    class Meta:', t[m.end():], re.M)
    if not meta:
        return False, 'class Partida no tiene un bloque Meta donde anclar'
    corte = m.end() + meta.start()
    escribir(ruta, t[:corte] + CAMPOS + t[corte:], simulacro)
    return True, 'dos campos anadidos'


def _busca(raiz, patron):
    """El archivo de la app que contiene `patron`, buscando en todos.

    No se da por sabido en que archivo vive cada cosa. Este backend reparte
    las vistas en modulos -views_partidas.py, views_presupuesto.py- y no en
    un views.py unico; dar por hecho lo segundo es lo que hizo fallar la
    primera version de este parche. Buscar cuesta un listdir y no vuelve a
    fallar cuando alguien reorganice.

    Devuelve (ruta, None) si sale en uno solo, y (None, motivo) si no sale o
    si sale en varios: parchear uno de dos a ciegas deja el otro atras.
    """
    app = os.path.join(raiz, 'operations')
    if not os.path.isdir(app):
        return None, 'no existe {0}'.format(app)
    salen = []
    for nombre in sorted(os.listdir(app)):
        if not nombre.endswith('.py'):
            continue
        ruta = os.path.join(app, nombre)
        try:
            if re.search(patron, leer(ruta), re.M):
                salen.append(ruta)
        except (IOError, OSError, UnicodeDecodeError):
            continue
    if not salen:
        return None, 'no encuentro {0} en operations/*.py'.format(patron)
    if len(salen) > 1:
        return None, ('{0} sale en {1} archivos: {2}'
                      .format(patron, len(salen),
                              ', '.join(os.path.basename(x) for x in salen)))
    return salen[0], None


def _bloque(t, inicio):
    """El trozo de `t` que ocupa una funcion: de su `def` al siguiente.

    Hace falta para mirar DENTRO de una funcion y no en todo el archivo.
    _lee_campos y _fila viven en el mismo modulo, asi que preguntar «esta
    area_ha en este archivo» daba que si en cuanto se parcheaba la primera,
    y la segunda se saltaba creyendose hecha. Lo descubrio la prueba en
    seco: _fila se quedaba sin los campos y nadie se enteraba hasta que el
    front los pidiera.
    """
    m = re.search(inicio, t, re.M)
    if not m:
        return None, None
    sig = re.search(r'^(?:def |class )', t[m.end():], re.M)
    return m.end(), (m.end() + sig.start() if sig else len(t))


def paso_serializer(raiz, simulacro):
    """Los dos nombres en la lista `fields` de PartidaSerializer."""
    ruta, mal = _busca(raiz, r'^class PartidaSerializer\(')
    if mal:
        return False, mal
    t = leer(ruta)
    if 'area_ha' in t:
        return True, 'ya estaba ({0})'.format(os.path.basename(ruta))

    m = re.search(r'^class PartidaSerializer\(', t, re.M)
    f = re.search(r'fields = \[(.*?)\]', t[m.end():], re.S)
    if not f:
        return False, 'PartidaSerializer no tiene una lista fields'
    i, j = m.end() + f.start(1), m.end() + f.end(1)
    dentro = t[i:j].rstrip()
    if not dentro.endswith(','):
        dentro += ','
    escribir(ruta, t[:i] + dentro + '\n                  "usuarios", "area_ha"'
             + t[j:], simulacro)
    return True, 'expuestos en {0}'.format(os.path.basename(ruta))


def paso_lee(raiz, simulacro):
    """Que se puedan guardar: _lee_campos los acepta."""
    ruta, mal = _busca(raiz, r'^def _lee_campos\(')
    if mal:
        return False, mal
    t = leer(ruta)
    ini, fin = _bloque(t, r'^def _lee_campos\(')
    if ini is None:
        return False, 'no encuentro _lee_campos en {0}'.format(os.path.basename(ruta))
    if 'area_ha' in t[ini:fin]:
        return True, 'ya estaba ({0})'.format(os.path.basename(ruta))

    m = re.search(r'^def _lee_campos\(', t, re.M)
    corte = re.search(r'^    if titulo:', t[m.end():], re.M)
    if not corte:
        return False, '_lee_campos no tiene el corte «if titulo:»'
    i = m.end() + corte.start()
    escribir(ruta, t[:i] + LEE + t[i:], simulacro)
    return True, 'lectura anadida en {0}'.format(os.path.basename(ruta))


def paso_fila(raiz, simulacro):
    """Que vuelvan al front: _fila los devuelve.

    Se ancla en el cierre del `return {` de esa funcion y no en un campo
    concreto, porque la fila ha ido creciendo con los parches.
    """
    ruta, mal = _busca(raiz, r'^def _fila\(')
    if mal:
        return False, mal
    t = leer(ruta)
    ini, fin = _bloque(t, r'^def _fila\(')
    if ini is None:
        return False, 'no encuentro _fila en {0}'.format(os.path.basename(ruta))
    if 'area_ha' in t[ini:fin]:
        return True, 'ya estaba ({0})'.format(os.path.basename(ruta))

    m = re.search(r'^def _fila\(', t, re.M)
    ret = re.search(r'    return \{', t[m.end():], re.M)
    if not ret:
        return False, '_fila no tiene un «return {» donde anclar'
    cierre = re.search(r'^    \}', t[m.end() + ret.end():], re.M)
    if not cierre:
        return False, 'no encuentro el cierre del return de _fila'
    i = m.end() + ret.end() + cierre.start()
    escribir(ruta, t[:i] + FILA + t[i:], simulacro)
    return True, 'respuesta anadida en {0}'.format(os.path.basename(ruta))


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--raiz', default='/var/www/envs/vigilantes')
    p.add_argument('--dry-run', action='store_true')
    args = p.parse_args()

    pasos = [
        ('modelo', lambda: paso_modelo(args.raiz, args.dry_run)),
        ('serializer', lambda: paso_serializer(args.raiz, args.dry_run)),
        ('guardar', lambda: paso_lee(args.raiz, args.dry_run)),
        ('devolver', lambda: paso_fila(args.raiz, args.dry_run)),
    ]

    fallo = False
    for nombre, fn in pasos:
        ok, detalle = fn()
        print('[{0}] {1}: {2}'.format('OK ' if ok else 'MAL', nombre, detalle))
        if not ok:
            fallo = True

    if fallo:
        print('\nNO se aplico todo. Revisa lo marcado como MAL antes de seguir.')
        sys.exit(1)
    if args.dry_run:
        print('\nSimulacro: no se escribio nada.')
        return

    print('\nFalta la migracion:')
    print('  docker compose exec -T web python manage.py makemigrations operations')
    print('  docker compose exec -T web python manage.py migrate')


if __name__ == '__main__':
    main()
