# -*- coding: utf-8 -*-
"""Reconocimiento de la base GIS antes de cargar la red vial para ruteo.

    docker compose exec -T web python manage.py shell < ver_gis_para_ruteo.py

SOLO LEE. No escribe, no migra, no toca ninguna tabla.

PARA QUE. Antes de meter 54 000 tramos de via hay cuatro cosas que no se
pueden suponer, porque si se suponen mal se nota tarde y caro:

  1. EN QUE SRID estan las capas que ya hay. Si el inventario vive en 4326
     y la red vial entra en 32717, cada consulta espacial que las mezcle
     hara una reproyeccion al vuelo, sin indice, y el ruteo se arrastrara.
     Las dos opciones son validas; lo que no vale es tener las dos.

  2. SI ESTA pgRouting. Sin la extension no hay pgr_dijkstra ni
     pgr_nodeNetwork, y nodar la red a mano en Python es posible pero mucho
     mas lento y hay que rehacerlo con cada carga.

  3. COMO SE LLAMAN las tablas que cargo ogr2ogr, para seguir la misma
     convencion y no acabar con dos estilos en la misma base.

  4. SI HAY CAMPOS CON DOBLE GUION BAJO ya cargados. Son los que rompen
     makemigrations en todo el proyecto (fields.E002). Conviene saber
     cuantos hay antes de anadir mas, porque la red vial trae varios.

Al final dice que hacer con lo que encontro, en vez de dejar el dato suelto.
"""

from __future__ import print_function

from django.apps import apps
from django.db import connections

GIS = "gis"

print("")
print("=" * 74)
print("1. SRID DE LAS CAPAS QUE YA ESTAN")
print("=" * 74)

srids = {}
try:
    with connections[GIS].cursor() as c:
        c.execute("""
            SELECT f_table_name, f_geometry_column, srid, type
            FROM geometry_columns
            ORDER BY f_table_name
        """)
        filas = c.fetchall()
    if not filas:
        print("  geometry_columns no devolvio nada.")
    for t, col, srid, tipo in filas:
        srids.setdefault(srid, []).append(t)
    for srid in sorted(srids):
        tablas = srids[srid]
        print("  SRID {0}: {1} tabla(s)".format(srid, len(tablas)))
        print("      {0}".format(", ".join(sorted(tablas)[:10])))
        if len(tablas) > 10:
            print("      ... y {0} mas".format(len(tablas) - 10))
except Exception as e:
    print("  no pude leer geometry_columns: {0}".format(e))

print("")
print("=" * 74)
print("2. ¿ESTA pgRouting?")
print("=" * 74)
tiene_pgr = False
try:
    with connections[GIS].cursor() as c:
        c.execute("SELECT extname, extversion FROM pg_extension ORDER BY extname")
        ext = c.fetchall()
    for n, v in ext:
        print("  {0:<16s} {1}".format(n, v))
    tiene_pgr = any(n == "pgrouting" for n, _ in ext)
    if not tiene_pgr:
        print("")
        print("  pgRouting NO esta instalada.")
        print("  Para instalarla, en el contenedor de la base:")
        print("      apt-get update && apt-get install -y postgresql-16-pgrouting")
        print("  y luego, como superusuario de la base jurp_gis:")
        print("      CREATE EXTENSION pgrouting;")
        print("  (ajusta el 16 a la version de PostgreSQL que salga arriba)")
except Exception as e:
    print("  no pude listar extensiones: {0}".format(e))

print("")
print("=" * 74)
print("3. CONVENCION DE NOMBRES Y TAMANOS")
print("=" * 74)
try:
    with connections[GIS].cursor() as c:
        c.execute("""
            SELECT c.relname,
                   pg_size_pretty(pg_total_relation_size(c.oid)),
                   c.reltuples::bigint
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE c.relkind = 'r' AND n.nspname = 'public'
            ORDER BY pg_total_relation_size(c.oid) DESC
            LIMIT 15
        """)
        for nom, tam, filas in c.fetchall():
            print("  {0:<34s} {1:>10s} {2:>10} filas aprox".format(nom, tam, filas))
except Exception as e:
    print("  no pude listar tablas: {0}".format(e))

print("")
print("=" * 74)
print("4. CAMPOS CON DOBLE GUION BAJO YA CARGADOS")
print("=" * 74)
print("  (son los que rompen makemigrations en TODO el proyecto)")
try:
    with connections[GIS].cursor() as c:
        c.execute("""
            SELECT table_name, column_name
            FROM information_schema.columns
            WHERE table_schema = 'public' AND column_name LIKE '%\\_\\_%'
            ORDER BY table_name, column_name
        """)
        malos = c.fetchall()
    if not malos:
        print("  Ninguno. Bien: hay que mantenerlo asi al cargar la red vial.")
    else:
        print("  {0} columna(s):".format(len(malos)))
        for t, col in malos:
            print("      {0}.{1}".format(t, col))
        print("")
        print("  Cada una que llegue a ser campo de un modelo de Django bloquea")
        print("  makemigrations y migrate del proyecto entero. La red vial trae")
        print("  seis mas en 'Redes Presurizado': hay que renombrarlas EN el")
        print("  ogr2ogr, no despues, y dejar el original en db_column.")
except Exception as e:
    print("  no pude revisar columnas: {0}".format(e))

print("")
print("=" * 74)
print("5. MODELOS DE inventario")
print("=" * 74)
try:
    modelos = list(apps.get_app_config("inventario").get_models())
    gestionados = [m for m in modelos if m._meta.managed]
    print("  modelos        : {0}".format(len(modelos)))
    print("  managed=True   : {0}   (Django crearia/alteraria su tabla)".format(len(gestionados)))
    print("  managed=False  : {0}   (solo lectura del esquema que hizo ogr2ogr)".format(
        len(modelos) - len(gestionados)))
except Exception as e:
    print("  no pude listar modelos: {0}".format(e))

print("")
print("=" * 74)
print("RESUMEN")
print("=" * 74)
if len(srids) > 1:
    print("  - Hay mas de un SRID en la base. Conviene unificar ANTES de cargar")
    print("    la red vial, o toda consulta que mezcle capas reproyectara al")
    print("    vuelo y sin indice.")
elif srids:
    print("  - Un solo SRID ({0}): la red vial entra en ese mismo.".format(
        list(srids.keys())[0]))
print("  - pgRouting: {0}".format("instalada" if tiene_pgr else "FALTA, hay que instalarla"))
print("")
print("Nada se ha escrito.")
