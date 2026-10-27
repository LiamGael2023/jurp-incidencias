# -*- coding: utf-8 -*-
"""Los datos de HYDROMETRIX: tomas, registros y como se agregan.

    docker compose exec -T web python manage.py shell < ver_hydrometrix.py

SOLO LEE.

SE CORRE EN EL LINODE DE VIGILANCIA -api_vigilantes-, que es donde viven
auth_api.Toma y auth_api.RegistroToma.

PARA QUE. Hay que rehacer en NEXHYDRO las pantallas de "Operadores L10"
-Distribucion y Calidad de Agua-. Los campos ya se vieron y encajan uno a
uno con lo que enseñan. Lo que no se puede deducir mirando un modelo es
COMO SE AGREGAN, y ahi es donde un numero equivocado no da error: da un
caudal plausible pero falso, y nadie lo nota hasta que alguien lo compara
con el papel.

Lo que hace falta saber:

  1. QUE TOMAS HAY Y QUE ENSEÑA CADA UNA. Los ver_* deciden que metrica sale
     en cada tarjeta. Una toma sin caudal de captacion no debe mostrar una
     fila vacia: no es que falte el dato, es que esa toma no lo mide.

  2. LOS UMBRALES. "Muy bajo", "Bajo" y "En su nivel" salen de
     umbral_desnivel_bajo y umbral_desnivel_muy_bajo. Inventar los cortes
     pintaria de rojo tomas que estan bien.

  3. COMO VIENE UNA LECTURA. fecha + hora (entero), y una fila por hora y
     toma. De ahi salen las series del grafico, y hay que saber si las horas
     van 0-23 o 1-24, y si falta alguna.

  4. SI EL SERVIDOR YA AGREGA. Si hay un endpoint que devuelve volumenes o
     caudales por periodo, se usa ese: recalcularlo en el navegador abre la
     puerta a que la web y el sistema viejo digan numeros distintos.

  5. LAS UNIDADES. Las pantallas ofrecen m3/h y l/s. Si lo que se guarda es
     l/s, el factor es 3.6; si ya viene en m3/h, multiplicar otra vez da un
     numero 3.6 veces mayor que el real, igual de creible.
"""

from __future__ import print_function

import datetime
import json


def titulo(t):
    print("")
    print("=" * 76)
    print(t)
    print("=" * 76)


def seguro(fn, por_defecto="?"):
    try:
        return fn()
    except Exception as e:
        return "error: {0}".format(e)


# ──────────────────────────────────────────────────────────────────────────
# 1. LAS TOMAS
# ──────────────────────────────────────────────────────────────────────────

titulo("1. LAS TOMAS Y QUE MIDE CADA UNA")

from django.apps import apps as djapps

Toma = djapps.get_model('auth_api', 'Toma')
Registro = djapps.get_model('auth_api', 'RegistroToma')

campos_ver = [f.name for f in Toma._meta.get_fields()
              if f.name.startswith('ver_')]

print("  %s tomas" % seguro(lambda: Toma.objects.count()))
print("")
for t in seguro(lambda: list(Toma.objects.all()), []):
    activa = getattr(t, 'is_active', None)
    print("  %-10s %-26s activa=%s  red=%s  cada %sh"
          % (t.pk, getattr(t, 'label', '?'), activa,
             getattr(t, 'is_red', None), getattr(t, 'frecuencia_horas', '?')))
    print("      umbrales desnivel: bajo=%s  muy bajo=%s"
          % (getattr(t, 'umbral_desnivel_bajo', None),
             getattr(t, 'umbral_desnivel_muy_bajo', None)))
    enseña = [c.replace('ver_', '') for c in campos_ver
              if getattr(t, c, False)]
    print("      mide: %s" % (", ".join(enseña) or "(nada marcado)"))
    print("      quien la ve: %s"
          % seguro(lambda: list(t.usuarios_permitidos.values_list(
              'username', flat=True))[:10]))
    print("")


# ──────────────────────────────────────────────────────────────────────────
# 2. LAS LECTURAS
# ──────────────────────────────────────────────────────────────────────────

titulo("2. COMO VIENEN LAS LECTURAS")

print("  registros: %s" % seguro(lambda: Registro.objects.count()))
print("")

# Las horas: 0-23 o 1-24. Cambia el eje del grafico y el reparto del volumen.
horas = seguro(lambda: sorted(set(
    Registro.objects.values_list('hora', flat=True).distinct())), [])
print("  horas distintas que aparecen: %s" % (horas,))
print("")

ultimo = seguro(lambda: Registro.objects.order_by('-fecha', '-hora').first(),
                None)
if ultimo is not None and not isinstance(ultimo, str):
    print("  LA ULTIMA LECTURA, entera:")
    datos = {}
    for f in Registro._meta.get_fields():
        if not hasattr(f, 'get_internal_type'):
            continue
        if f.auto_created and not f.concrete:
            continue
        datos[f.name] = seguro(lambda: getattr(ultimo, f.name), None)
    print("  " + json.dumps(datos, indent=2, default=str, ensure_ascii=False
                            ).replace("\n", "\n  "))
    print("")

# Un dia completo de una toma: es lo que alimenta el grafico de un dia, y
# enseña si hay huecos -horas sin lectura- que la web tendra que respetar en
# vez de unir con una linea recta que no paso.
if ultimo is not None and not isinstance(ultimo, str):
    dia = ultimo.fecha
    print("  UN DIA COMPLETO (%s), por toma y hora:" % dia)
    for t in seguro(lambda: list(Toma.objects.all()), []):
        filas = seguro(lambda: list(
            Registro.objects.filter(toma=t, fecha=dia)
            .order_by('hora')
            .values_list('hora', 'caudalCaptacion', 'caudalExcedencia',
                         'desnivelPoza', 'turbidezSalida')), [])
        if not filas:
            continue
        print("    %-10s %s lecturas" % (getattr(t, 'label', t.pk), len(filas)))
        for h, cap, exc, des, tur in filas[:26]:
            print("        h=%-3s captacion=%-10s excedencia=%-10s "
                  "desnivel=%-8s turbidez=%s" % (h, cap, exc, des, tur))
    print("")


# ──────────────────────────────────────────────────────────────────────────
# 3. LAS UNIDADES
# ──────────────────────────────────────────────────────────────────────────

titulo("3. EN QUE UNIDAD SE GUARDA")

print("  Las pantallas ofrecen m3/h y l/s. Lo que decide cual es cual son los")
print("  ORDENES DE MAGNITUD: un caudal de 130 en l/s son 468 m3/h.")
print("")
for campo in ('caudalCaptacion', 'caudalExcedencia', 'caudalAductor',
              'caudalAductor106', 'caudalAductor107', 'consumoLaredo',
              'consumoBeggie', 'desnivelPoza', 'turbidezSalida',
              'turbidezCanal', 'floculante', 'coagulante', 'sulfato'):
    try:
        from django.db.models import Min, Max, Avg, Count
        r = Registro.objects.exclude(**{campo: None}).aggregate(
            n=Count('id'), mn=Min(campo), mx=Max(campo), pr=Avg(campo))
        if r['n']:
            print("  %-20s n=%-6s min=%-10s max=%-12s media=%s"
                  % (campo, r['n'], r['mn'], r['mx'],
                     round(float(r['pr']), 2) if r['pr'] is not None else None))
        else:
            print("  %-20s sin datos" % campo)
    except Exception as e:
        print("  %-20s error: %s" % (campo, e))


# ──────────────────────────────────────────────────────────────────────────
# 4. ¿YA HAY QUIEN AGREGUE?
# ──────────────────────────────────────────────────────────────────────────

titulo("4. RUTAS QUE YA DEN ESTO MASTICADO")

import inspect


def patron_de(p):
    pat = getattr(p, "pattern", None)
    if pat is not None:
        return str(getattr(pat, "_route", None) or pat)
    rx = getattr(p, "regex", None)
    return rx.pattern if rx is not None else "?"


def recorrer(patrones, prefijo=""):
    salida = []
    for p in patrones:
        trozo = patron_de(p)
        hijos = getattr(p, "url_patterns", None)
        if hijos is not None:
            salida.extend(recorrer(hijos, prefijo + trozo))
        else:
            salida.append((prefijo + trozo, getattr(p, "callback", None)))
    return salida


from django.urls import get_resolver

todas = recorrer(get_resolver().url_patterns)
PISTAS = ("toma", "registro", "caudal", "volumen", "resumen", "dosaj",
          "turbidez", "calidad", "distribucion", "operador", "lateral",
          "reporte", "grafic", "serie", "historico")

print("  Si el servidor ya calcula volumenes o series, se usa eso: que la web")
print("  rehaga la cuenta por su lado es como acaban saliendo dos numeros")
print("  distintos para lo mismo.")
print("")
vistas = []
for ruta, cb in todas:
    if '/admin/' in ruta or '\\.' in ruta:
        continue
    if not any(p in ruta.lower() for p in PISTAS):
        continue
    cls = getattr(cb, 'cls', None) or getattr(cb, 'view_class', None)
    quien = cls if cls is not None else cb
    vistas.append((ruta, quien, cls))
    print("  /%s" % ruta)
    print("      vista  : %s  (%s)" % (getattr(quien, '__name__', quien),
                                       getattr(quien, '__module__', '?')))
    if cls is not None:
        perm = getattr(cls, 'permission_classes', None)
        if perm:
            print("      permiso: %s" % [getattr(x, '__name__', x) for x in perm])
        extra = [m for m in dir(cls)
                 if not m.startswith('_')
                 and m not in dir(type('x', (), {}))
                 and callable(getattr(cls, m, None))
                 and m not in ('as_view', 'get', 'post', 'put', 'patch',
                               'delete', 'head', 'options', 'trace',
                               'dispatch', 'initial', 'finalize_response',
                               'handle_exception', 'perform_create',
                               'perform_update', 'perform_destroy',
                               'get_queryset', 'get_serializer',
                               'get_serializer_class', 'get_object',
                               'get_serializer_context', 'list', 'create',
                               'retrieve', 'update', 'partial_update',
                               'destroy', 'paginate_queryset',
                               'get_paginated_response', 'filter_queryset',
                               'get_permissions', 'check_permissions',
                               'check_object_permissions', 'permission_denied',
                               'get_authenticators', 'get_parsers',
                               'get_renderers', 'get_throttles',
                               'get_content_negotiator', 'get_exception_handler',
                               'perform_authentication', 'initialize_request',
                               'raise_uncaught_exception', 'http_method_not_allowed',
                               'setup', 'get_view_name', 'get_view_description',
                               'get_format_suffix', 'get_exception_handler_context',
                               'determine_version', 'check_throttles',
                               'get_extra_actions', 'get_success_headers',
                               'reverse_action', 'get_parser_context',
                               'get_renderer_context')]
        if extra:
            print("      acciones propias: %s" % extra[:12])
    print("")

if not vistas:
    print("  Ninguna. Entonces los calculos los hace hoy el sistema viejo y")
    print("  habra que decidir donde van: en el servidor -una vez y para los")
    print("  dos- o en el navegador.")

print("")
print("=" * 76)
print("FIN. Nada se ha modificado.")
print("=" * 76)
