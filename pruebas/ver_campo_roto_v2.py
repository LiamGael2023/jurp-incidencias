# -*- coding: utf-8 -*-
"""
El campo roto, pero mirando en la base QUE TOCA.

    docker compose exec -T web python manage.py shell < ver_campo_roto_v2.py

POR QUE UNA SEGUNDA VERSION. La primera dijo que la tabla
'tomas_canal_madre' no existe y a la vez conto 95 filas. Las dos cosas son
ciertas: el conteo pasa por el router de bases de datos y la introspeccion
iba a 'default' a pelo. O sea que ese modelo vive en OTRA base -el proyecto
tiene dos contenedores de postgres- y hay que mirar donde de verdad esta.

Esto cambia el arreglo. Si la tabla la gestiona Django (managed=True), el
cambio de nombre genera migracion. Si es managed=False -tabla creada fuera,
tipico de inspectdb- la migracion no toca nada y el arreglo es solo del
modelo. Y si esta en otra base, migrate ni siquiera se ocupa de ella.

Imprime ademas el texto del modelo, que es lo que necesito para escribir el
parche con anclajes exactos en vez de adivinar la linea.

SOLO LEE.
"""

from __future__ import print_function

import io
import os

from django.apps import apps
from django.conf import settings
from django.db import connections, router

print("")
print("=" * 72)
print("1. BASES DE DATOS CONFIGURADAS")
print("=" * 72)
for alias, cfg in settings.DATABASES.items():
    print("  {0:10s} {1}  ->  {2}".format(
        alias, cfg.get("ENGINE", "?").split(".")[-1], cfg.get("NAME", "?")))
rutas = getattr(settings, "DATABASE_ROUTERS", [])
print("  routers: {0}".format(rutas or "ninguno"))

rotos = []
for modelo in apps.get_models():
    for f in modelo._meta.get_fields():
        if "__" in (getattr(f, "name", "") or ""):
            rotos.append((modelo, f))

print("")
print("=" * 72)
print("2. EL CAMPO, Y DONDE VIVE DE VERDAD")
print("=" * 72)
for modelo, f in rotos:
    meta = modelo._meta
    alias = router.db_for_read(modelo) or "default"
    print("")
    print("  {0}.{1}.{2}".format(meta.app_label, modelo.__name__, f.name))
    print("      tipo        : {0}".format(f.__class__.__name__))
    print("      null/blank  : {0} / {1}".format(getattr(f, "null", "?"), getattr(f, "blank", "?")))
    print("      db_column   : {0}".format(getattr(f, "db_column", None)))
    print("      columna     : {0}".format(getattr(f, "column", "?")))
    print("      db_table    : {0}".format(meta.db_table))
    print("      managed     : {0}".format(meta.managed))
    print("      base (router): {0}".format(alias))
    try:
        with connections[alias].cursor() as c:
            desc = connections[alias].introspection.get_table_description(c, meta.db_table)
        print("      columnas reales en esa base:")
        for col in desc:
            print("          {0}{1}".format(col.name, "   <<<" if "__" in col.name else ""))
    except Exception as e:
        print("      no pude leer la tabla en '{0}': {1}".format(alias, e))
    try:
        print("      filas       : {0}".format(modelo.objects.count()))
    except Exception as e:
        print("      filas       : no pude contarlas ({0})".format(e))

print("")
print("=" * 72)
print("3. EL MODELO TAL COMO ESTA ESCRITO")
print("=" * 72)
for modelo, f in rotos:
    try:
        ruta = io.open(apps.get_app_config(modelo._meta.app_label).path + os.sep + "models.py",
                       encoding="utf-8")
    except Exception as e:
        print("  no pude abrir models.py: {0}".format(e))
        continue
    lineas = ruta.read().split("\n")
    ruta.close()
    ini = None
    for i, l in enumerate(lineas):
        if l.startswith("class {0}(".format(modelo.__name__)):
            ini = i
            break
    if ini is None:
        print("  no encuentro 'class {0}(' en models.py".format(modelo.__name__))
        continue
    fin = ini + 1
    while fin < len(lineas):
        l = lineas[fin]
        if l.strip() and not l.startswith((" ", "\t")):
            break
        fin += 1
    print("")
    print("  # {0}".format(apps.get_app_config(modelo._meta.app_label).path + "/models.py"))
    for i in range(ini, min(fin, ini + 70)):
        marca = ">>" if "__" in lineas[i] and "=" in lineas[i] else "  "
        print("  {0} {1:4d}  {2}".format(marca, i + 1, lineas[i].rstrip()[:112]))

print("")
print("=" * 72)
print("")
print("Pega esto entero. No se ha escrito nada.")
