# -*- coding: utf-8 -*-
"""Por que la pantalla de Campanas sale vacia.

    cd /var/www/envs/vigilantes
    curl -sO https://raw.githubusercontent.com/LiamGael2023/jurp-incidencias/main/pruebas/ver_evaluaciones.py
    docker exec -i django_api python manage.py shell < ver_evaluaciones.py

NO TOCA NADA. Solo mira, cuenta y llama a la propia API desde dentro.

HAY DOS EXPLICACIONES POSIBLES Y SE PARECEN DEMASIADO EN PANTALLA:

  1. La campana 2026 esta de verdad vacia -las evaluaciones no se migraron al
     servidor nuevo, o todavia no se ha evaluado nada-.
  2. El endpoint revienta. El inventario lleva devolviendo 500 en este
     servidor, y una lista vacia y un error se ven igual si nadie los
     distingue.

La parte 3 resuelve la duda sin discutir: usa el cliente de pruebas de Django
para pedir la MISMA ruta que pide el navegador, por dentro, sin token ni
proxy de por medio. Si revienta, imprime el traceback entero aqui mismo: es el
que llevamos buscando desde anoche.
"""
from __future__ import print_function

import traceback

from django.apps import apps
from django.db.models import Count

print("")
print("=" * 72)
print("1. QUE HAY EN LA BASE")
print("=" * 72)


def modelo(*pistas):
    for M in apps.get_models():
        n = M.__name__.lower()
        if any(p in n for p in pistas):
            return M
    return None


Campania = modelo("campania")
Evaluacion = modelo("evaluacion")

if Campania is None or Evaluacion is None:
    print("")
    print("    No encuentro los modelos del inventario en ESTE servidor.")
    print("    Comprueba:  grep -n inventario config/settings.py")
else:
    print("")
    print("    campanas:")
    for c in Campania.objects.all().order_by("-anio"):
        print("        id=%s  anio=%s  estado=%s  %s -> %s"
              % (c.id, c.anio, c.estado,
                 getattr(c, "fecha_ini", "?"), getattr(c, "fecha_fin", "?")))

    total = Evaluacion.objects.count()
    print("")
    print("    evaluaciones en total: %s" % total)
    if total:
        print("")
        print("    por campana:")
        for f in Evaluacion.objects.values("campania__anio").annotate(n=Count("id")).order_by():
            print("        %s -> %s" % (f["campania__anio"], f["n"]))
        print("")
        print("    por tipo de activo (las 10 primeras):")
        for f in (Evaluacion.objects.values("tipo_activo")
                  .annotate(n=Count("id")).order_by("-n")[:10]):
            print("        %-28s %s" % (f["tipo_activo"], f["n"]))
        print("")
        u = Evaluacion.objects.order_by("-id").first()
        print("    la ultima registrada: id=%s  campania=%s  tipo=%s  fid=%s  fecha=%s"
              % (u.id, getattr(u, "campania_id", "?"), u.tipo_activo,
                 u.activo_fid, getattr(u, "fecha", "?")))
    else:
        print("")
        print("    CERO. Entonces la pantalla dice la verdad: esta campana no")
        print("    tiene nada evaluado todavia. Si esperabas que hubiera,")
        print("    falta migrar la tabla de evaluaciones desde Contabo.")

print("")
print("=" * 72)
print("2. QUE RUTAS DEL INVENTARIO EXISTEN")
print("=" * 72)
print("  (si una no aparece, el front la pide y recibe un 404)")

try:
    from django.urls import get_resolver

    vistas = []
    def recorrer(patrones, prefijo=""):
        for p in patrones:
            if hasattr(p, "url_patterns"):
                recorrer(p.url_patterns, prefijo + str(p.pattern))
            else:
                ruta = prefijo + str(p.pattern)
                if "inventario" in ruta:
                    vistas.append(ruta)
    recorrer(get_resolver().url_patterns)

    # SOLO las de la API. El admin genera seis rutas por modelo y, como
    # "admin" ordena antes que "api", se comia la lista entera: la primera
    # version de esto imprimio cuarenta rutas del admin y ni una de la API,
    # dando a entender que no existian.
    api = sorted(set(v for v in vistas if not v.startswith("admin/")))
    print("")
    if api:
        for v in api:
            print("    /%s" % v)
    else:
        print("    NINGUNA ruta de API. La app esta en el admin pero no")
        print("    enrutada bajo /api/: el front pediria y recibiria 404.")
    print("")
    print("    (%s rutas del admin, omitidas)" % (len(vistas) - len(api)))
except Exception as e:
    print("    no se pudo listar: %s" % e)

print("")
print("=" * 72)
print("3. LA MISMA LLAMADA QUE HACE LA PANTALLA")
print("=" * 72)
print("  (por dentro, sin token ni proxy: si revienta, sale el traceback)")

try:
    from django.test import Client
    from django.contrib.auth import get_user_model

    U = get_user_model()
    usuario = (U.objects.filter(is_superuser=True, is_active=True).first()
               or U.objects.filter(is_active=True).first())
    if usuario is None:
        print("")
        print("    No hay usuarios activos con los que probar.")
    else:
        print("")
        print("    probando como: %s" % usuario.username)

        # EL CLIENTE DE PRUEBAS MANDA Host: testserver, Y ESO NO ESTA EN
        # ALLOWED_HOSTS. Django lo rechaza antes de llegar a la vista y
        # devuelve un 400 en HTML -no un error de DRF-, identico para
        # TODAS las rutas. La primera version de este script daba cuatro
        # "400 Bad Request" seguidos que no significaban nada: el fallo
        # estaba aqui, no en el inventario. Se anade el host a la lista,
        # solo para este proceso.
        from django.conf import settings
        if "testserver" not in settings.ALLOWED_HOSTS and "*" not in settings.ALLOWED_HOSTS:
            settings.ALLOWED_HOSTS = list(settings.ALLOWED_HOSTS) + ["testserver"]
        print("    ALLOWED_HOSTS: %s" % (list(settings.ALLOWED_HOSTS)[:6],))

        # raise_request_exception=False: queremos VER el 500, no que el
        # script muera en el primer fallo y oculte las rutas siguientes.
        c = Client(raise_request_exception=False)
        c.force_login(usuario)

        RUTAS = [
            "/api/v1/inventario/campanias/",
            "/api/v1/inventario/evaluaciones/?campania=2026",
            "/api/v1/inventario/capas/",
            "/api/v1/inventario/capas/indice/",
        ]
        for ruta in RUTAS:
            try:
                r = c.get(ruta)
                cuerpo = r.content[:180].decode("utf-8", "replace").replace("\n", " ")
                marca = "  <-- AQUI ESTA EL PROBLEMA" if r.status_code >= 400 else ""
                if r.status_code == 400 and b"Bad Request (400)" in r.content:
                    marca = "  <-- 400 de ALLOWED_HOSTS, no del inventario"
                print("")
                print("    %s  %s%s" % (r.status_code, ruta, marca))
                print("        %s" % cuerpo)
                # Cuantos elementos devuelve, que es lo que la pantalla cuenta.
                if r.status_code == 200:
                    try:
                        d = r.json()
                        n = len(d.get("results", d)) if isinstance(d, dict) else len(d)
                        print("        -> %s elemento(s)" % n)
                    except Exception:
                        pass
            except Exception:
                print("")
                print("    EXCEPCION en %s:" % ruta)
                traceback.print_exc()
except Exception:
    print("")
    print("    no se pudo usar el cliente de pruebas:")
    traceback.print_exc()

print("")
print("=" * 72)
print("COMO LEER ESTO")
print("=" * 72)
print("""
  - Si (1) dice CERO y (3) devuelve 200 con 0 elementos: la pantalla acierta,
    no hay nada evaluado en este servidor. Toca migrar las evaluaciones.

  - Si (1) dice que hay evaluaciones pero (3) devuelve 500: ese traceback es
    el fallo del inventario que arrastramos. Pegamelo entero.

  - Si (3) devuelve 404 en alguna ruta: esa no existe en este servidor y el
    front la esta pidiendo igual.

  - Si (3) devuelve 200 con elementos pero la pantalla sigue vacia: entonces
    el problema esta entre Vercel y el servidor, no aqui.
""")
