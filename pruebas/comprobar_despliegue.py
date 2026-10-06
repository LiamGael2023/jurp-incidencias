# -*- coding: utf-8 -*-
"""
Comprueba que el despliegue hizo lo que debia, y nada mas.

    docker compose exec -T web python manage.py shell < comprobar_despliegue.py

POR QUE. makemigrations sin nombre de app genero inventario/0001_initial con
45 modelos, en una app que nunca habia tenido migraciones. Para los modelos
managed=False Django registra el CreateModel pero NO crea la tabla; para uno
managed=True si la crearia, y en la base 'gis'. Eso hay que mirarlo, no
suponerlo: la migracion dijo OK en los dos casos.

Comprueba cuatro cosas:
  1. Cuantos modelos de inventario son managed=True (deberian ser los que
     ya tuvieran su tabla; si alguno es nuevo, aparecio una tabla vacia).
  2. Que tomas_canal_madre sigue con sus 95 filas y su columna n__usuario.
  3. Que el serializer sigue sacando la clave n__usuario.
  4. Que las partidas estan y el endpoint responde con el avance.

SOLO LEE.
"""

from __future__ import print_function

from django.apps import apps
from django.db import connections, router

print("")
print("=" * 72)
print("1. MODELOS DE INVENTARIO: CUALES GESTIONA DJANGO")
print("=" * 72)
mod = apps.get_app_config("inventario").get_models()
gestionados = [m for m in mod if m._meta.managed]
no = [m for m in mod if not m._meta.managed]
print("  total modelos : {0}".format(len(list(apps.get_app_config('inventario').get_models()))))
print("  managed=False : {0}  (Django NO crea ni toca sus tablas)".format(len(no)))
print("  managed=True  : {0}".format(len(gestionados)))
for m in gestionados:
    alias = router.db_for_read(m) or "default"
    existe = "?"
    try:
        with connections[alias].cursor() as c:
            tablas = connections[alias].introspection.table_names(c)
        existe = "si" if m._meta.db_table in tablas else "NO"
        n = m.objects.count()
    except Exception as e:
        n = "error: {0}".format(e)
    print("      {0:34s} base={1:8s} tabla={2:3s} filas={3}".format(
        m._meta.db_table, alias, existe, n))
if not gestionados:
    print("      ninguno: la migracion no creo ni una tabla. Es lo esperado.")

print("")
print("=" * 72)
print("2. LA TABLA QUE TOCAMOS SIGUE IGUAL")
print("=" * 72)
from inventario.models import TomaCanalMadre  # noqa: E402
meta = TomaCanalMadre._meta
alias = router.db_for_read(TomaCanalMadre) or "default"
f = meta.get_field("num_usuarios")
print("  tabla     : {0}  (base {1})".format(meta.db_table, alias))
print("  atributo  : {0}".format(f.name))
print("  columna   : {0}   {1}".format(
    f.column, "<- conserva el nombre" if f.column == "n__usuario" else "<- OJO, cambio"))
print("  managed   : {0}".format(meta.managed))
print("  filas     : {0}   (eran 95)".format(TomaCanalMadre.objects.count()))
con_dato = TomaCanalMadre.objects.exclude(num_usuarios=None).count()
print("  con num_usuarios no nulo: {0}".format(con_dato))

print("")
print("=" * 72)
print("3. LA CLAVE DEL JSON NO CAMBIO")
print("=" * 72)
try:
    from inventario.serializers import TomaCanalMadreSerializer
    uno = TomaCanalMadre.objects.first()
    if uno is None:
        print("  no hay filas para probar")
    else:
        d = dict(TomaCanalMadreSerializer(uno).data)
        print("  'n__usuario' en la salida  : {0}   valor={1}".format(
            "n__usuario" in d, d.get("n__usuario")))
        print("  'num_usuarios' en la salida: {0}   (deberia ser False)".format(
            "num_usuarios" in d))
except Exception as e:
    print("  no pude probarlo: {0}".format(e))

print("")
print("=" * 72)
print("4. LAS PARTIDAS Y SU AVANCE")
print("=" * 72)
from operations.models import Partida, DailyPartActivity  # noqa: E402
from operations.views_partidas import partidas_lista  # noqa: E402
from rest_framework.test import APIRequestFactory  # noqa: E402

print("  partidas activas : {0}".format(Partida.objects.filter(activo=True).count()))
suma = sum(float(p.metrado or 0) * float(p.precio or 0)
           for p in Partida.objects.filter(activo=True))
print("  costo directo    : S/ {0:,.2f}   (el Excel dice 1,007,949.21)".format(suma))
print("  actividades con partida: {0}".format(
    DailyPartActivity.objects.filter(partida__isnull=False).count()))

r = partidas_lista(APIRequestFactory().get("/partidas/?obra=Obras10_6"))
datos = r.data.get("partidas", [])
print("  el endpoint devuelve: {0} partidas".format(len(datos)))
if datos:
    p = datos[0]
    print("  ejemplo: {0} {1} | presup={2} ejec={3} saldo={4} avance={5}".format(
        p["codigo"], p["unidad"], p["metrado"], p["ejecutado"], p["saldo"], p["avance"]))
    claves = ["ejecutado", "saldo", "avance", "otras_unidades"]
    faltan = [k for k in claves if k not in p]
    print("  campos de avance presentes: {0}".format("todos" if not faltan else "FALTAN " + str(faltan)))

print("")
print("Listo. No se ha escrito nada.")
