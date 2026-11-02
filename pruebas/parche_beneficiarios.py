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


def paso_serializer(raiz, simulacro):
    """Los dos nombres en la lista `fields` de PartidaSerializer."""
    ruta = os.path.join(raiz, 'operations/serializers.py')
    if not os.path.exists(ruta):
        return False, 'no existe {0}'.format(ruta)
    t = leer(ruta)
    if 'area_ha' in t:
        return True, 'ya estaba'

    m = re.search(r'^class PartidaSerializer\(', t, re.M)
    if not m:
        return False, 'no encuentro class PartidaSerializer'
    # El primer `fields = [...]` despues de esa clase es el suyo.
    f = re.search(r'fields = \[(.*?)\]', t[m.end():], re.S)
    if not f:
        return False, 'PartidaSerializer no tiene una lista fields'
    ini = m.end() + f.start(1)
    fin = m.end() + f.end(1)
    dentro = t[ini:fin].rstrip()
    if not dentro.endswith(','):
        dentro += ','
    nuevo = dentro + '\n                  "usuarios", "area_ha"'
    escribir(ruta, t[:ini] + nuevo + t[fin:], simulacro)
    return True, 'expuestos en el serializer'


def paso_vistas(raiz, simulacro):
    """Que se puedan guardar (_lee_campos) y que vuelvan (_fila)."""
    ruta = os.path.join(raiz, 'operations/views.py')
    if not os.path.exists(ruta):
        return False, 'no existe {0}'.format(ruta)
    t = leer(ruta)
    if 'area_ha' in t:
        return True, 'ya estaba'

    ancla_lee = '    if titulo:\n'
    if t.count(ancla_lee) != 1:
        return False, ('esperaba un «if titulo:» en _lee_campos y hay {0}'
                       .format(t.count(ancla_lee)))
    t = t.replace(ancla_lee, LEE + ancla_lee, 1)

    ancla_fila = '        "ruta": p.ruta,\n'
    if t.count(ancla_fila) != 1:
        return False, ('esperaba un «"ruta": p.ruta,» en _fila y hay {0}'
                       .format(t.count(ancla_fila)))
    t = t.replace(ancla_fila, ancla_fila + FILA, 1)

    escribir(ruta, t, simulacro)
    return True, 'lectura y respuesta anadidas'


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--raiz', default='/var/www/envs/vigilantes')
    p.add_argument('--dry-run', action='store_true')
    args = p.parse_args()

    pasos = [
        ('modelo', lambda: paso_modelo(args.raiz, args.dry_run)),
        ('serializer', lambda: paso_serializer(args.raiz, args.dry_run)),
        ('vistas', lambda: paso_vistas(args.raiz, args.dry_run)),
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
