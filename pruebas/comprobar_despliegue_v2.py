# -*- coding: utf-8 -*-
"""
Comprobacion del despliegue, con dos errores mios corregidos.

    docker compose exec -T web python manage.py shell < comprobar_despliegue_v2.py

QUE FALLABA EN LA v1:

  1. get_models() devuelve un GENERADOR y lo recorri dos veces. La segunda
     vuelta salia vacia, de ahi "0 managed=False y 0 managed=True" contra un
     total de 45. O sea que la v1 no midio si la migracion creo tablas; se
     limito a imprimir ceros.

  2. Estos serializers son de capas GIS y lo normal es que hereden de
     GeoFeatureModelSerializer, que devuelve GeoJSON: los campos van dentro
     de 'properties', no en la raiz. Yo miraba la raiz, asi que no encontraba
     ninguna de las dos claves y parecia que el campo habia desaparecido.

SOLO LEE.
"""

from __future__ import print_function

from django.apps import apps
from django.db import connections, router

print("")
print("=" * 72)
print("1. LA MIGRACION DE INVENTARIO, ¿CREO ALGUNA TABLA?")
print("=" * 72)

modelos = list(apps.get_app_config("inventario").get_models())   # <- list(), no generador
gest = [m for m in modelos if m._meta.managed]
nog = [m for m in modelos if not m._meta.managed]
print("  modelos totales : {0}".format(len(modelos)))
print("  managed=False   : {0}   (Django registra el CreateModel pero NO crea la tabla)".format(len(nog)))
print("  managed=True    : {0}".format(len(gest)))

if not gest:
    print("")
    print("  Ninguno gestionado: la migracion no pudo crear ni una tabla.")
else:
    print("")
    print("  Estos SI los gestiona Django, hay que mirar su tabla:")
    for m in gest:
        alias = router.db_for_read(m) or "default"
        try:
            with connections[alias].cursor() as c:
                hay = m._meta.db_table in connections[alias].introspection.table_names(c)
            n = m.objects.count() if hay else "-"
        except Exception as e:
            hay, n = "?", "error: {0}".format(e)
        print("      {0:32s} base={1:8s} existe={2}  filas={3}".format(
            m._meta.db_table, alias, hay, n))

# Por si acaso: ¿cuantas tablas hay ahora en la base gis?
try:
    with connections["gis"].cursor() as c:
        tablas = connections["gis"].introspection.table_names(c)
    vacias = []
    for t in tablas:
        try:
            with connections["gis"].cursor() as c:
                c.execute('SELECT COUNT(*) FROM "{0}"'.format(t))
                if c.fetchone()[0] == 0:
                    vacias.append(t)
        except Exception:
            pass
    print("")
    print("  tablas en la base 'gis' : {0}".format(len(tablas)))
    print("  de ellas, vacias        : {0}".format(len(vacias)))
    if vacias:
        print("      {0}".format(", ".join(sorted(vacias)[:12])))
        print("      (una tabla vacia RECIEN creada seria la senal de alarma;")
        print("       si ya estaban vacias antes, no es cosa de esta migracion)")
except Exception as e:
    print("  no pude listar la base gis: {0}".format(e))

print("")
print("=" * 72)
print("2. LA TABLA QUE TOCAMOS")
print("=" * 72)
from inventario.models import TomaCanalMadre  # noqa: E402
meta = TomaCanalMadre._meta
f = meta.get_field("num_usuarios")
print("  tabla    : {0}  (base {1})".format(meta.db_table, router.db_for_read(TomaCanalMadre)))
print("  atributo : {0}".format(f.name))
print("  columna  : {0}   {1}".format(
    f.column, "<- conserva el nombre" if f.column == "n__usuario" else "<- OJO"))
print("  filas    : {0}   (eran 95)".format(TomaCanalMadre.objects.count()))
print("  con dato : {0}".format(TomaCanalMadre.objects.exclude(num_usuarios=None).count()))

print("")
print("=" * 72)
print("3. LA CLAVE DEL JSON, MIRANDO DONDE TOCA")
print("=" * 72)
from inventario.serializers import TomaCanalMadreSerializer  # noqa: E402

print("  el serializer hereda de: {0}".format(
    ", ".join(c.__name__ for c in TomaCanalMadreSerializer.__mro__[1:4])))

uno = TomaCanalMadre.objects.exclude(num_usuarios=None).first() \
    or TomaCanalMadre.objects.first()
if uno is None:
    print("  no hay filas para probar")
else:
    d = dict(TomaCanalMadreSerializer(uno).data)
    print("  claves de primer nivel: {0}".format(sorted(d.keys())[:8]))
    # GeoJSON: los campos viven dentro de 'properties'
    props = d.get("properties", d)
    try:
        props = dict(props)
    except Exception:
        props = {}
    print("  ¿la salida es GeoJSON?: {0}".format("properties" in d))
    print("")
    print("  'n__usuario'   presente: {0}    valor = {1}".format(
        "n__usuario" in props, props.get("n__usuario")))
    print("  'num_usuarios' presente: {0}    (deberia ser False)".format(
        "num_usuarios" in props))
    print("  en la fila, num_usuarios = {0}".format(uno.num_usuarios))

print("")
print("=" * 72)
print("4. PARTIDAS")
print("=" * 72)
from operations.models import Partida, DailyPartActivity  # noqa: E402
print("  activas : {0}".format(Partida.objects.filter(activo=True).count()))
print("  con actividad imputada: {0}".format(
    DailyPartActivity.objects.filter(partida__isnull=False).count()))

print("")
print("Listo. No se ha escrito nada.")
