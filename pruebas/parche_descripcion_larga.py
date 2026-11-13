# -*- coding: utf-8 -*-
"""Quita el tope de 500 caracteres de las descripciones de hallazgos.

    cd /var/www/envs/prod/src/apps/hi_incidents
    curl -sO https://raw.githubusercontent.com/LiamGael2023/jurp-incidencias/<SHA>/pruebas/parche_descripcion_larga.py
    python3 parche_descripcion_larga.py . --dry-run
    sudo python3 parche_descripcion_larga.py .
    cd /var/www/envs/prod && docker compose exec -T web python manage.py migrate hi_incidents
    docker restart jurp_web

QUE PASABA
----------
Los inspectores no podian subir avances de bitacora. La app decia «Error
en el servidor: 400» y nada mas. El motivo real, que aparecio cuando la
app empezo a mostrar la respuesta del servidor, era:

    description: Asegurese de que este campo no tenga mas de 500 caracteres.

Y se explica solo en cuanto se mira una bitacora de verdad: un avance
lista la partida ejecutada, la maquinaria operativa y las observaciones.
Eso pasa de 500 caracteres sin esfuerzo.

POR QUE NO SALIO ANTES. El tope lleva meses ahi, en una linea del modelo.
No se vio porque el motivo del rechazo se perdia entre el telefono y el
servidor: la app descartaba el cuerpo de la respuesta y Django registraba
«Bad Request» sin el detalle. Las pruebas que se hicieron contra el
servidor mandaban descripciones cortas —de unos 110 caracteres— y por eso
devolvian 201: median el payload del que probaba, no el del inspector.

POR QUE TextField Y NO UN NUMERO MAS GRANDE
-------------------------------------------
Poner 2000 solo mueve el problema de sitio y garantiza que alguien vuelva
a chocar contra el, esta vez con un texto mas largo y mas trabajo perdido.
Una descripcion de bitacora no tiene un limite natural: se escribe lo que
haga falta para que el parte se entienda.

En PostgreSQL no cuesta nada: convertir varchar(500) a text NO reescribe
la tabla —es un cambio de metadatos— y las dos se almacenan y se indexan
igual. No hay penalizacion de rendimiento ni riesgo para los datos
existentes.

SE TOCAN LOS DOS CAMPOS. El de HIIncidentAction es el que falla ahora,
pero HIIncident.description tiene el mismo tope y el mismo problema: la
descripcion de un hallazgo tambien se queda corta. Ampliar es compatible
hacia atras —nada se rompe por admitir mas texto— asi que arreglar uno y
dejar el otro para el dia que falle seria dejar la mitad del trabajo.

LA MIGRACION SE ESCRIBE A MANO, a proposito. El codigo esta montado en el
contenedor en modo de solo lectura, asi que `makemigrations` no puede
crear el fichero. Escribirlo aqui es equivalente y ademas queda a la vista
para revisarlo antes de aplicarlo.

DEJA COPIA en models.py.bak_desc para poder volver atras.
"""
from __future__ import print_function

import argparse
import os
import re
import shutil
import sys

VIEJO = "    description = models.CharField(max_length=500, blank=True)"
NUEVO = "    description = models.TextField(blank=True)"

MIGRACION = '''# -*- coding: utf-8 -*-
# Generada a mano: el codigo esta montado de solo lectura en el contenedor
# y makemigrations no puede escribir aqui. Ver parche_descripcion_larga.py.
#
# Quita el tope de 500 caracteres de las descripciones de hallazgos y de
# sus avances de bitacora. En PostgreSQL, varchar(500) -> text no reescribe
# la tabla: es un cambio de metadatos.
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('%(app)s', '%(dep)s'),
    ]

    operations = [
        migrations.AlterField(
            model_name='hiincident',
            name='description',
            field=models.TextField(blank=True),
        ),
        migrations.AlterField(
            model_name='hiincidentaction',
            name='description',
            field=models.TextField(blank=True),
        ),
    ]
'''


def ultima_migracion(carpeta):
    """El nombre de la ultima migracion, para encadenar la nueva."""
    nombres = []
    for f in os.listdir(carpeta):
        if f.endswith('.py') and not f.startswith('__'):
            nombres.append(f[:-3])
    if not nombres:
        return None, 1
    nombres.sort()
    ultima = nombres[-1]
    m = re.match(r'^(\d+)_', ultima)
    siguiente = (int(m.group(1)) + 1) if m else len(nombres) + 1
    return ultima, siguiente


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("app", help="carpeta de la app hi_incidents")
    p.add_argument("--dry-run", action="store_true")
    args = p.parse_args()

    modelos = os.path.join(args.app, "models.py")
    migraciones = os.path.join(args.app, "migrations")

    if not os.path.exists(modelos):
        print("no encuentro %s" % modelos, file=sys.stderr)
        return 2
    if not os.path.isdir(migraciones):
        print("no encuentro %s" % migraciones, file=sys.stderr)
        return 2

    with open(modelos, encoding="utf-8") as f:
        s = f.read()

    n = s.count(VIEJO)
    if n == 0 and "description = models.TextField(blank=True)" in s:
        print("Ya esta aplicado: las descripciones ya son TextField.")
        return 0
    if n != 2:
        print("Esperaba 2 apariciones del campo y hay %d." % n, file=sys.stderr)
        print("El modelo ha cambiado; no toco nada.", file=sys.stderr)
        return 1

    nuevo = s.replace(VIEJO, NUEVO)
    try:
        compile(nuevo, modelos, "exec")
    except SyntaxError as e:
        print("El resultado no compila (linea %s): %s" % (e.lineno, e.msg),
              file=sys.stderr)
        return 1
    print("OK  models.py queda compilable")

    dep, siguiente = ultima_migracion(migraciones)
    if dep is None:
        print("La app no tiene migraciones previas; revisalo a mano.",
              file=sys.stderr)
        return 1
    app_label = os.path.basename(os.path.abspath(args.app))
    archivo = os.path.join(
        migraciones, "%04d_descripcion_sin_tope.py" % siguiente)
    contenido = MIGRACION % {"app": app_label, "dep": dep}

    print("")
    print("    app        : %s" % app_label)
    print("    depende de : %s" % dep)
    print("    creara     : %s" % archivo)
    print("")

    if os.path.exists(archivo):
        print("Ya existe esa migracion; no la sobrescribo.", file=sys.stderr)
        return 1

    if args.dry_run:
        print("--dry-run: no se ha escrito nada.")
        print("")
        print("--- models.py cambiaria asi ---")
        print("  -%s" % VIEJO.strip())
        print("  +%s" % NUEVO.strip())
        print("")
        print("--- la migracion seria ---")
        print(contenido)
        return 0

    shutil.copy2(modelos, modelos + ".bak_desc")
    with open(modelos, "w", encoding="utf-8") as f:
        f.write(nuevo)
    with open(archivo, "w", encoding="utf-8") as f:
        f.write(contenido)

    print("escrito.  copia del modelo en models.py.bak_desc")
    print("")
    print("AHORA, para aplicarlo:")
    print("")
    print("    cd /var/www/envs/prod")
    print("    docker compose exec -T web python manage.py migrate hi_incidents")
    print("    docker restart jurp_web")
    print("")
    print("Y para comprobar que la columna quedo como text:")
    print("")
    print("    docker compose exec -T web python manage.py dbshell -- \\")
    print("      -c \"\\d hi_incident_action\" | grep description")
    return 0


if __name__ == "__main__":
    sys.exit(main())
