# -*- coding: utf-8 -*-
"""Por qué /api/v1/inventario/ devuelve 500 en el servidor nuevo.

    cd /root/proyectos/api_vigilantes
    curl -sO https://raw.githubusercontent.com/LiamGael2023/jurp-incidencias/main/pruebas/ver_inventario_500.py
    docker compose exec web python manage.py shell < ver_inventario_500.py

NO TOCA NADA. Solo mira y cuenta.

LO QUE SE SABE YA, y acota mucho:

  - El front llama bien. Un 500 es que la peticion LLEGO y Django reviento;
    si el host estuviera mal seria un fallo de red o un 404.
  - Las pantallas de operations -incidencias, maquinaria, costeo- cargan sin
    problema en el mismo servidor. O sea que Django arranca, sirve y habla
    con su base principal.
  - Solo falla inventario, que es lo unico que usa la segunda base,
    jurp_gis (PostGIS), migrada aparte.

El sospechoso, entonces, no es Django: es la conexion a esa segunda base, o
algo que llego a medias con ella -PostGIS sin instalar en la base nueva, el
usuario sin permisos, las tablas vacias o con otro nombre-.

ANTES QUE ESTO, MIRA EL TRACEBACK, que lo dice sin rodeos:

    docker compose logs --tail=200 web | grep -B5 -A30 Traceback

Este script es para cuando el traceback no deje claro el porque, o para
comprobar de un vistazo que todo lo de la segunda base esta en su sitio.
"""
from __future__ import print_function

from django.conf import settings
from django.db import connections

print("")
print("=" * 72)
print("1. LAS BASES QUE DJANGO TIENE CONFIGURADAS")
print("=" * 72)

for alias in settings.DATABASES:
    cfg = settings.DATABASES[alias]
    print("")
    print("  [%s]" % alias)
    print("      motor  : %s" % cfg.get("ENGINE", "?"))
    print("      nombre : %s" % cfg.get("NAME", "?"))
    print("      host   : %s:%s" % (cfg.get("HOST") or "(local)", cfg.get("PORT") or ""))
    try:
        with connections[alias].cursor() as c:
            c.execute("SELECT 1")
            c.fetchone()
        print("      conecta: SI")
    except Exception as e:
        print("      conecta: NO  <-- AQUI ESTA EL 500")
        print("               %s" % str(e).strip().splitlines()[0])
        continue

    # PostGIS solo importa en la base de cartografia.
    try:
        with connections[alias].cursor() as c:
            c.execute("SELECT extname FROM pg_extension WHERE extname LIKE 'postgis%'")
            ext = [r[0] for r in c.fetchall()]
        print("      postgis: %s" % (", ".join(ext) if ext else "NO INSTALADO"))
    except Exception as e:
        print("      postgis: no se pudo comprobar (%s)" % str(e).strip()[:60])

print("")
print("=" * 72)
print("2. LOS MODELOS DEL INVENTARIO, Y SI SUS TABLAS RESPONDEN")
print("=" * 72)
print("  (vacio no es un error, pero explica una pantalla en blanco;")
print("   un fallo al contar SI es el 500)")

from django.apps import apps

CLAVES = ("campania", "capa", "evaluacion", "activo")
vistos = 0
for M in apps.get_models():
    nombre = M.__name__.lower()
    if not any(k in nombre for k in CLAVES):
        continue
    vistos += 1
    etiqueta = "%s.%s" % (M._meta.app_label, M.__name__)
    try:
        print("    %-42s %s fila(s)" % (etiqueta, M.objects.count()))
    except Exception as e:
        print("    %-42s FALLA <-- %s" % (etiqueta, str(e).strip().splitlines()[0][:70]))

if not vistos:
    print("")
    print("    No encuentro ningun modelo de inventario. ¿Falta la app en")
    print("    INSTALLED_APPS en el servidor nuevo? Compruebalo:")
    print("        grep -n inventario config/settings.py")

print("")
print("=" * 72)
print("3. EL ENRUTADO DE BASES")
print("=" * 72)
rutas = getattr(settings, "DATABASE_ROUTERS", [])
print("    DATABASE_ROUTERS: %s" % (rutas or "(ninguno)"))
if not rutas and len(settings.DATABASES) > 1:
    print("")
    print("    Hay mas de una base y NINGUN router: entonces el inventario")
    print("    tiene que elegirla a mano con .using('...'). Si en el servidor")
    print("    viejo habia un router y aqui no, todo iria a la base por")
    print("    defecto, donde esas tablas no existen -y eso es un 500-.")
print("")
