# -*- coding: utf-8 -*-
"""
Mira el campo con doble guion bajo que bloquea las migraciones.

    docker compose exec -T web python manage.py shell --skip-checks < ver_campo_roto.py

El --skip-checks es imprescindible: ese mismo error impide arrancar el shell.

QUE PASA. Django prohibe "__" en un nombre de campo (fields.E002) porque es
su separador para recorrer relaciones: con un campo n__usuario no sabria si
pides el campo o el campo 'usuario' de una relacion 'n'. El check se dispara
en CUALQUIER comando de manage.py, asi que bloquea makemigrations y migrate
de todo el proyecto, no solo de la app que lo tiene.

La API sigue funcionando porque los system checks no corren en el WSGI; por
eso el fallo puede llevar meses ahi sin que nadie lo note.

QUE DECIDE ESTE SCRIPT. El arreglo limpio es renombrar el atributo a
n_usuario y fijarle db_column con el nombre que YA tiene la columna, para
que la base no se toque. Pero eso solo vale si la columna se llama de
verdad n__usuario. Si la tabla se creo fuera de Django puede llamarse de
otra forma, y entonces el arreglo seria otro.

SOLO LEE.
"""

from __future__ import print_function

from django.apps import apps
from django.db import connection

print("")
print("=" * 70)
print("CAMPOS CON '__' EN TODO EL PROYECTO")
print("=" * 70)
rotos = []
for modelo in apps.get_models():
    for f in modelo._meta.get_fields():
        nombre = getattr(f, "name", "") or ""
        if "__" in nombre:
            rotos.append((modelo._meta.app_label, modelo.__name__, f))
            print("  {0}.{1}.{2}".format(modelo._meta.app_label, modelo.__name__, nombre))
            print("      tipo       : {0}".format(f.__class__.__name__))
            print("      db_column  : {0}".format(getattr(f, "db_column", None)))
            print("      columna    : {0}".format(getattr(f, "column", "?")))
if not rotos:
    print("  ninguno (?). Si migrate sigue fallando, pega el error entero.")

print("")
print("=" * 70)
print("COLUMNAS REALES DE LAS TABLAS AFECTADAS")
print("=" * 70)
tablas = sorted(set(m._meta.db_table for _, _, f in rotos for m in [f.model]))
for t in tablas:
    print("")
    print("  {0}".format(t))
    try:
        with connection.cursor() as c:
            desc = connection.introspection.get_table_description(c, t)
        for col in desc:
            marca = "  <<<" if "__" in col.name else ""
            print("      {0}{1}".format(col.name, marca))
    except Exception as e:
        print("      no pude leerla: {0}".format(e))

print("")
print("=" * 70)
print("FILAS, para saber si hay datos que proteger")
print("=" * 70)
for app_label, modelo_nombre, f in rotos:
    m = f.model
    try:
        print("  {0}: {1} fila(s)".format(m._meta.db_table, m.objects.count()))
    except Exception as e:
        print("  {0}: no pude contarlas ({1})".format(m._meta.db_table, e))

print("")
print("Pega esto y te mando el arreglo. No se ha escrito nada.")
