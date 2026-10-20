# -*- coding: utf-8 -*-
"""Que hace falta para guardar fotos de los activos del inventario.

    cd /var/www/envs/vigilantes
    curl -sO https://raw.githubusercontent.com/LiamGael2023/jurp-incidencias/main/pruebas/ver_inventario_fotos.py
    docker exec -i django_api python manage.py shell < ver_inventario_fotos.py

NO TOCA NADA. Solo mira y cuenta.

PARA QUE. La ficha del activo ya pide las fotos a

    GET  /api/v1/inventario/fotos/?tipo_activo=<T>&activo_fid=<N>
    POST /api/v1/inventario/fotos/        (multipart: tipo_activo, activo_fid, imagen)
    DELETE /api/v1/inventario/fotos/<id>/

Si ese endpoint no existe, la galeria lo detecta y lo dice en pantalla en vez
de fallar en silencio. Este script responde lo que hay que saber ANTES de
crearlo, porque la forma correcta depende de lo que ya exista:

  1. Si la app de inventario ya tiene un modelo de fotos -puede que la app de
     campo ya las suba y el problema sea solo que la web no las enseña-. Eso
     cambiaria el trabajo entero: no habria que crear nada, solo enganchar.
  2. Como se identifican los activos en las evaluaciones, para que las fotos
     usen EXACTAMENTE la misma pareja (tipo_activo, activo_fid) y no una
     convencion nueva.
  3. Si MEDIA_ROOT y MEDIA_URL estan configurados y servidos. Sin eso las
     fotos se suben y luego no se ven, que es peor que no subirlas.
"""
from __future__ import print_function

import os

from django.apps import apps
from django.conf import settings

print("")
print("=" * 72)
print("1. ¿YA HAY UN MODELO DE FOTOS EN ALGUN SITIO?")
print("=" * 72)

PISTAS = ("foto", "photo", "imagen", "image", "evidencia", "adjunto")
encontrados = []
for M in apps.get_models():
    nombre = M.__name__.lower()
    campos_archivo = [
        f.name for f in M._meta.get_fields()
        if f.__class__.__name__ in ("ImageField", "FileField")
    ]
    if not (any(p in nombre for p in PISTAS) or campos_archivo):
        continue
    encontrados.append(M)
    try:
        n = M.objects.count()
    except Exception as e:
        n = "no se pudo contar (%s)" % str(e).strip().splitlines()[0][:40]
    print("")
    print("  %s.%s  -> %s fila(s)" % (M._meta.app_label, M.__name__, n))
    if campos_archivo:
        print("      campos de archivo: %s" % ", ".join(campos_archivo))
    otros = [f.name for f in M._meta.get_fields() if f.name not in campos_archivo]
    print("      otros campos      : %s" % ", ".join(otros[:14]))

if not encontrados:
    print("")
    print("    Ninguno. Hay que crear el modelo: aplica el parche")
    print("    parche_fotos_activo.py de este mismo repo.")
else:
    print("")
    print("    OJO: si alguno de estos ya guarda fotos de ACTIVOS DEL")
    print("    INVENTARIO -mira si tiene tipo_activo/activo_fid arriba-, NO")
    print("    hace falta crear nada: solo apuntar la ficha a ese endpoint.")
    print("    Dimelo y cambio la URL en vez de crear un modelo nuevo.")

print("")
print("=" * 72)
print("2. COMO IDENTIFICAN LAS EVALUACIONES A UN ACTIVO")
print("=" * 72)
print("  (las fotos tienen que usar la MISMA pareja, no una parecida)")

ev = None
for M in apps.get_models():
    if "evaluacion" in M.__name__.lower():
        ev = M
        break

if ev is None:
    print("")
    print("    No encuentro el modelo de evaluaciones. ¿Esta instalada la app")
    print("    de inventario en este servidor?  grep -n inventario config/settings.py")
else:
    print("")
    print("    modelo: %s.%s" % (ev._meta.app_label, ev.__name__))
    for f in ev._meta.get_fields():
        if f.name in ("tipo_activo", "activo_fid", "campania"):
            tipo = f.__class__.__name__
            extra = ""
            if hasattr(f, "max_length") and f.max_length:
                extra = " (max_length=%s)" % f.max_length
            print("      %-14s %s%s" % (f.name, tipo, extra))
    try:
        print("")
        print("    valores reales de tipo_activo (los que usa la capa):")
        vals = ev.objects.values_list("tipo_activo", flat=True).distinct()[:12]
        for v in vals:
            print("        %s" % v)
        if not vals:
            print("        (todavia no hay evaluaciones)")
    except Exception as e:
        print("    no se pudo listar: %s" % str(e).strip().splitlines()[0][:60])

print("")
print("=" * 72)
print("3. ¿DONDE IRIAN LOS ARCHIVOS, Y SE PODRAN VER DESPUES?")
print("=" * 72)

raiz = getattr(settings, "MEDIA_ROOT", "")
url = getattr(settings, "MEDIA_URL", "")
print("")
print("    MEDIA_ROOT: %s" % (raiz or "(SIN CONFIGURAR)"))
print("    MEDIA_URL : %s" % (url or "(SIN CONFIGURAR)"))

if raiz:
    existe = os.path.isdir(raiz)
    print("    existe    : %s" % ("si" if existe else "NO"))
    if existe:
        print("    escribible: %s" % ("si" if os.access(raiz, os.W_OK) else "NO <-- las subidas fallaran"))
        try:
            total = sum(
                os.path.getsize(os.path.join(d, f))
                for d, _, fs in os.walk(raiz) for f in fs
            )
            print("    ocupado   : %.1f MB" % (total / 1048576.0))
        except OSError:
            pass
else:
    print("")
    print("    SIN MEDIA_ROOT no se pueden guardar archivos subidos.")

print("")
print("    Y que Django lo guarde no basta: Nginx tiene que servir esa ruta.")
print("    Compruebalo desde fuera del contenedor con una imagen que ya")
print("    exista -las de incidencias, por ejemplo-:")
print("")
print("        grep -n -A3 'location /media' /etc/nginx/sites-enabled/*")
print("")
print("    Si no aparece ningun 'location /media', las fotos se subiran y")
print("    luego daran 404 al mirarlas. Eso es lo que hay que arreglar antes")
print("    de ponerse a subir nada.")
print("")
