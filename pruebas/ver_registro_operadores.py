# -*- coding: utf-8 -*-
"""Las lecturas de verdad: registro_operadores y caudales_pech, en PLUVIRA.
    docker exec -w /app -i jurp_web python manage.py shell < ver_registro_operadores.py
SOLO LEE.
SE CORRE EN EL CONTENEDOR jurp_web -PLUVIRA, Django 1.8-. No en el Linode de
vigilancia: alli `auth_api.RegistroToma` tiene 4 filas de prueba, y las 3998
de verdad estan aqui.
POR QUE OTRO GUION. El anterior volco una fila entera y esa fila traia la
foto del desnivel en base64: medio megabyte de texto se comio las secciones
del final. Aqui ningun valor pasa de 90 caracteres.
LO QUE HAY QUE SABER ANTES DE PINTAR NADA:
  1. QUE CAMPOS TIENE UNA LECTURA y como se llaman. De ahi salen las
     tarjetas del resumen y las series.
  2. EN QUE UNIDAD. Las pantallas ofrecen m3/h y l/s. Si lo guardado ya es
     m3/h y se multiplica por 3.6, el numero sale 3.6 veces mayor y sigue
     pareciendo razonable: nadie lo nota hasta que lo comparan con el papel.
  3. SI LAS HORAS VAN 0-23 O 1-24, y si faltan horas. Unir con una recta dos
     lecturas separadas por cuatro horas dibuja un caudal que no paso.
  4. QUE ES TomaRegistroCampoConfig. 286 filas para 65 tomas huele a "que
     campo ve cada toma", que es lo que decide que fila sale en cada
     tarjeta. Si se ignora, se pintan filas vacias donde esa toma
     sencillamente no mide eso.
  5. QUE GUARDA CaudalMetricDailyStats. Si ya agrega por dia, se usa: que la
     web rehaga la cuenta por su lado es como acaban saliendo dos numeros
     distintos para lo mismo.
  6. QUE RUTAS SIRVEN TODO ESTO.
"""
from __future__ import print_function
import json
from django.apps import apps as djapps
from django.db.models import Count, Min, Max, Avg


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


def corto(v, n=90):
    # Nunca se imprime un valor largo: una foto en base64 tapa el resto.
    s = "" if v is None else str(v)
    return s if len(s) <= n else s[:n] + "...(%s car.)" % len(s)


def ficha(m):
    print("  %s.%s   filas: %s" % (m._meta.app_label, m.__name__,
                                   seguro(lambda: m.objects.count())))
    for f in m._meta.get_fields():
        if not hasattr(f, "get_internal_type"):
            continue
        if f.auto_created and not f.concrete:
            continue
        extra = []
        if getattr(f, "choices", None):
            extra.append("choices=%s" % [c[0] for c in f.choices][:10])
        rel = getattr(f, "related_model", None)
        if rel is not None:
            extra.append("-> %s.%s" % (rel._meta.app_label, rel.__name__))
        if getattr(f, "null", False):
            extra.append("null")
        print("      %-28s %-18s %s" % (f.name, f.get_internal_type(),
                                        " ".join(extra)))


def una_fila(m, orden=None):
    qs = m.objects.all()
    if orden:
        qs = qs.order_by(orden)
    o = seguro(lambda: qs.first(), None)
    if o is None or isinstance(o, str):
        print("      (sin filas)")
        return None
    print("      una fila:")
    for f in m._meta.get_fields():
        if not hasattr(f, "get_internal_type"):
            continue
        if f.auto_created and not f.concrete:
            continue
        print("        %-28s %s" % (f.name, corto(seguro(
            lambda: getattr(o, f.name), None))))
    return o


# ── 1. los modelos ───────────────────────────────────────────────────────
titulo("1. LOS MODELOS")
NOMBRES = [("registro_operadores", "RegistroOperadores"),
           ("registro_operadores", "TomaRegistroCampoConfig"),
           ("registro_operadores", "OperadorCampoToma"),
           ("caudales_pech", "CaudalMetricDailyStats"),
           ("caudales_pech", "CaudalesPECH"),
           ("core", "Toma")]
modelos = {}
for app, nom in NOMBRES:
    m = seguro(lambda: djapps.get_model(app, nom), None)
    if m is None or isinstance(m, str):
        print("  %s.%s NO existe (%s)" % (app, nom, m))
        continue
    modelos[nom] = m
    ficha(m)
    print("")

# ── 2. una lectura de verdad ─────────────────────────────────────────────
titulo("2. LA ULTIMA LECTURA")
R = modelos.get("RegistroOperadores")
if R is not None:
    campos = [f.name for f in R._meta.get_fields()
              if hasattr(f, "get_internal_type")]
    orden = "-fecha" if "fecha" in campos else "-id"
    una_fila(R, orden)

# ── 3. las horas y los huecos ────────────────────────────────────────────
titulo("3. LAS HORAS")
if R is not None:
    campos = [f.name for f in R._meta.get_fields()
              if hasattr(f, "get_internal_type")]
    ch = "hora" if "hora" in campos else None
    if ch:
        hs = seguro(lambda: sorted(set(
            R.objects.values_list(ch, flat=True).distinct())), [])
        print("  horas distintas: %s" % (hs,))
        print("  -> %s" % ("van 0-23" if 0 in hs else "van 1-24 o empiezan en 1"))
    else:
        print("  no hay campo 'hora'; los campos de fecha son: %s"
              % [c for c in campos if "fecha" in c or "hora" in c
                 or "date" in c or "time" in c])
    # Cuantas lecturas por dia en los ultimos dias con datos: si una toma
    # declara "cada 1h" deberian ser 24 por toma, y si no, hay huecos.
    cf = "fecha" if "fecha" in campos else None
    if cf:
        print("")
        print("  lecturas por dia (los 10 dias mas recientes):")
        dias = seguro(lambda: list(R.objects.values(cf).annotate(
            n=Count('id')).order_by('-' + cf)[:10]), [])
        for d in dias:
            print("    %s  %s" % (d[cf], d['n']))

# ── 4. las unidades ──────────────────────────────────────────────────────
titulo("4. EN QUE UNIDAD SE GUARDA")
print("  Lo decide el orden de magnitud: 130 l/s son 468 m3/h.")
print("")
if R is not None:
    numericos = [f.name for f in R._meta.get_fields()
                 if hasattr(f, "get_internal_type")
                 and f.get_internal_type() in ("DecimalField", "FloatField",
                                               "IntegerField",
                                               "PositiveIntegerField")]
    for c in numericos:
        r = seguro(lambda: R.objects.exclude(**{c: None}).aggregate(
            n=Count('id'), mn=Min(c), mx=Max(c), pr=Avg(c)), None)
        if isinstance(r, dict) and r.get('n'):
            print("  %-26s n=%-6s min=%-10s max=%-12s media=%s"
                  % (c, r['n'], corto(r['mn'], 10), corto(r['mx'], 12),
                     corto(r['pr'], 10)))

# ── 5. la configuracion por toma ─────────────────────────────────────────
titulo("5. QUE CAMPO VE CADA TOMA")
C = modelos.get("TomaRegistroCampoConfig")
if C is not None:
    print("  286 filas para 65 tomas: parece el equivalente de los ver_*.")
    print("")
    for o in seguro(lambda: list(C.objects.all()[:25]), []):
        datos = {}
        for f in C._meta.get_fields():
            if not hasattr(f, "get_internal_type"):
                continue
            if f.auto_created and not f.concrete:
                continue
            datos[f.name] = corto(seguro(lambda: getattr(o, f.name), None), 40)
        print("    %s" % json.dumps(datos, ensure_ascii=False, default=str))

# ── 6. lo que ya viene agregado ──────────────────────────────────────────
titulo("6. LO QUE YA VIENE AGREGADO")
D = modelos.get("CaudalMetricDailyStats")
if D is not None:
    for o in seguro(lambda: list(D.objects.all()[:8]), []):
        datos = {}
        for f in D._meta.get_fields():
            if not hasattr(f, "get_internal_type"):
                continue
            if f.auto_created and not f.concrete:
                continue
            datos[f.name] = corto(seguro(lambda: getattr(o, f.name), None), 40)
        print("    %s" % json.dumps(datos, ensure_ascii=False, default=str))

# ── 7. las rutas ─────────────────────────────────────────────────────────
titulo("7. LAS RUTAS QUE LO SIRVEN")


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


try:
    from django.core.urlresolvers import get_resolver
    todas = recorrer(get_resolver(None).url_patterns)
except Exception as e:
    todas = []
    print("  no pude leer las urls: %s" % e)
PISTAS = ("toma", "registro", "caudal", "volumen", "resumen", "dosaj",
          "turbidez", "calidad", "operador", "lateral", "distribu")
for ruta, cb in todas:
    if '/admin/' in ruta:
        continue
    if not any(p in ruta.lower() for p in PISTAS):
        continue
    cls = getattr(cb, 'cls', None) or getattr(cb, 'view_class', None)
    quien = cls if cls is not None else cb
    perm = getattr(cls, 'permission_classes', None) if cls else None
    print("  /%-58s %s%s" % (
        ruta, getattr(quien, '__name__', quien),
        ("  [%s]" % [getattr(x, '__name__', x) for x in perm]) if perm else ""))
print("")
print("=" * 76)
print("FIN. Nada se ha modificado.")
print("=" * 76)
