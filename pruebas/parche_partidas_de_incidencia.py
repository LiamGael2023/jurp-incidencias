# -*- coding: utf-8 -*-
"""Partidas del presupuesto para una incidencia: modelo, API y ruta.

    python3 parche_partidas_de_incidencia.py                 # solo mira
    python3 parche_partidas_de_incidencia.py --aplicar        # aplica, con respaldo
    python3 parche_partidas_de_incidencia.py --base /ruta     # si no autodetecta

QUE PASO CON LA VERSION ANTERIOR
================================

La primera version daba por hecho que IncidentReport tenia un serializer y se
limitaba a anadirle el campo. Se nego en el servidor:

    MAL  no encuentro ningun serializer de IncidentReport

No era un fallo de busqueda. El diagnostico -ver_api_incidentes.py- enseno
que IncidentReport no tiene serializer, ni viewset, ni ruta de detalle. Solo
sale en models.py, en admin.py y en el comando de sync. De 'incidentes/' en
operations existen tres rutas y ninguna es el detalle:

    /incidentes/<int:incident_id>/cerrar-partes/
    /incidentes/<int:incident_id>/reabrir/
    /incidentes-cerrados/

Asi que el GET que hace la pantalla de costeo contra /incidentes/<id>/
devuelve 404. El aviso ambar que salia no decia "falta el campo", decia la
verdad: no hay endpoint. La incidencia se administra solo desde el admin.

Eso cambia el trabajo. No es anadir un campo: es darle a la incidencia la
parte de API que nunca tuvo. Tres piezas, en este orden:

    1. models.py             IncidentReport.partidas, M2M a Partida
    2. views_incidentes.py   el serializer y la vista de detalle  (NUEVO)
    3. urls.py               la ruta /incidentes/<int:pk>/

POR QUE ASI Y NO DE OTRA MANERA
===============================

ESTO YA EXISTE PARA ACTIVIDADES. ActividadObra.partidas es un
ManyToManyField a operations.Partida desde parche_partidas_de_actividad.py, y
su serializer y su vista viven en operations/views_actividades_obra.py -no en
serializers.py-. Ese es el convenio real del proyecto para lo anadido
despues, y aqui se repite tal cual en views_incidentes.py. Lo unico que no se
copia es el aviso de "partida de otra obra": la actividad tiene obra contra
la que comparar y la incidencia no.

EL related_name ES 'incidencias' Y NO 'actividades'. Ese ya lo usa
DailyPartActivity.partida y Django lo rechaza con fields.E304. El espejo de
este parche se llevo ese golpe en el servidor; aqui se comprueba antes de
escribir, leyendo los related_name que ya apuntan a Partida.

EL EJECUTADO ES DE TODA LA OBRA, igual que en actividades. El saldo de una
partida no depende de quien se lo gasto: si un parte de otra actividad ya
excavo 100 de los 173, aqui quedan 73 aunque esta incidencia no haya tocado
ninguno. Un saldo "propio" invitaria a pasarse del presupuesto entre varios
sujetos sin que ninguno lo notara.

LA MIGRACION ES UNA TABLA NUEVA. Un M2M no toca ninguna columna existente:
crea operations_incidentreport_partidas con dos claves. Nada de lo guardado
cambia, y una incidencia sin partidas se sigue guardando igual. Las 7 filas
de IncidentReport quedan como estan, sin partidas, que es lo correcto: nadie
las ha programado todavia.

NO SE ESCRIBE NADA si cualquiera de los tres pasos falla. A medias es peor
que sin empezar: un modelo con campo y sin ruta deja la pantalla igual de
muerta, pero con una migracion pendiente que confunde al siguiente.
"""

from __future__ import print_function

import datetime
import io
import os
import re
import shutil
import sys

# ── Donde esta el proyecto ─────────────────────────────────────────────────
# Cambio de servidor a mitad de camino: en Contabo colgaba de /root y en el
# Linode de /var/www. Se prueban los dos y se admite --base para el proximo.
CANDIDATOS = [
    "/var/www/envs/vigilantes",
    "/root/proyectos/api_vigilantes",
    os.getcwd(),
]

APLICAR = "--aplicar" in sys.argv


def base_del_proyecto():
    if "--base" in sys.argv:
        return sys.argv[sys.argv.index("--base") + 1]
    for c in CANDIDATOS:
        if os.path.isfile(os.path.join(c, "operations", "models.py")):
            return c
    return None


# ══════════════════════════════════════════════════════════════════════════
# PIEZA 1 · el campo en el modelo
# ══════════════════════════════════════════════════════════════════════════

CAMPO = '''
{0}# PARTIDAS PROGRAMADAS DE ESTA INCIDENCIA.
{0}#
{0}# Sin esto el parte diario ofrecia las 83 partidas de las cinco obras
{0}# cargadas, porque la incidencia no tiene proyecto contra el que filtrar.
{0}# Elegir ahi la partida de otra obra no da error: da un avance que suma
{0}# dos presupuestos y parece correcto.
{0}#
{0}# related_name='incidencias' y no 'actividades': ese ya lo usa
{0}# DailyPartActivity.partida y Django lo rechaza con fields.E304.
{0}partidas = models.ManyToManyField(
{0}    "Partida", blank=True, related_name="incidencias",
{0}    verbose_name="Partidas del presupuesto")
'''


def bloque_clase(texto, clase):
    """(inicio, fin) del cuerpo de una clase.

    Se busca asi y no por un trozo literal porque models.py ya ha sido
    parcheado varias veces y los campos no estan donde estaban.
    """
    m = re.search(r"^class\s+" + re.escape(clase) + r"\s*\(", texto, re.M)
    if not m:
        return None
    sig = re.search(r"^class\s+\w+\s*\(", texto[m.end():], re.M)
    fin = m.end() + sig.start() if sig else len(texto)
    return (m.start(), fin)


def sangria_de(cuerpo):
    """La sangria de los campos de la clase.

    [ \\t]+ y no \\s+ a proposito: \\s incluye el salto de linea, se lo come y
    el campo sale con una linea en blanco de mas en medio. Ya paso una vez.
    """
    m = re.search(r"^([ \t]+)\S", cuerpo, re.M)
    return m.group(1) if m else "    "


def related_names_de_partida(texto):
    """Los related_name que ya apuntan a Partida, para no chocar."""
    nombres = set()
    for m in re.finditer(
            r"(?:ForeignKey|ManyToManyField|OneToOneField)\s*\(\s*"
            r"[\"']?Partida[\"']?(.*?)\)", texto, re.S):
        r = re.search(r"related_name\s*=\s*[\"']([^\"']+)[\"']", m.group(1))
        if r:
            nombres.add(r.group(1))
    return nombres


def paso_modelo(texto):
    """→ (texto_nuevo, aviso).  texto_nuevo None = no se puede."""
    pos = bloque_clase(texto, "IncidentReport")
    if not pos:
        return None, "no encuentro class IncidentReport en models.py"
    ini, fin = pos
    cuerpo = texto[ini:fin]

    if re.search(r"^[ \t]+partidas\s*=\s*models\.ManyToManyField", cuerpo, re.M):
        return texto, "ya estaba: IncidentReport.partidas"

    if "incidencias" in related_names_de_partida(texto):
        return None, ("related_name='incidencias' ya lo usa otro campo hacia "
                      "Partida; Django lo rechazaria (fields.E304)")

    campo = CAMPO.format(sangria_de(cuerpo))

    # Dentro de la clase, antes de Meta si la hay; si no, al final del cuerpo.
    m = re.search(r"^[ \t]+class\s+Meta\b", cuerpo, re.M)
    if m:
        nuevo = cuerpo[:m.start()] + campo.rstrip("\n") + "\n\n" + cuerpo[m.start():]
    else:
        nuevo = cuerpo.rstrip("\n") + "\n" + campo

    return texto[:ini] + nuevo + texto[fin:], "anadido IncidentReport.partidas"


# ══════════════════════════════════════════════════════════════════════════
# PIEZA 2 · el serializer y la vista  (fichero nuevo)
# ══════════════════════════════════════════════════════════════════════════

VISTA = '''# -*- coding: utf-8 -*-
"""La incidencia por la API: leerla y programarle partidas.

IncidentReport no tenia nada de esto. Existia el modelo, su admin y el
comando que lo sincroniza con PLUVIRA, pero ninguna ruta de detalle: de
'incidentes/' solo habia cerrar-partes, reabrir e incidentes-cerrados. La
pantalla de costeo pedia /incidentes/<id>/ y recibia un 404.

Es el espejo de views_actividades_obra.py. Misma forma, mismos nombres,
mismas cuentas. Lo que cambia es que una actividad tiene obra y una
incidencia no, asi que aqui no se puede comprobar que la partida elegida sea
del proyecto correcto. La proteccion contra eso es justamente la lista
programada: el parte diario solo ofrece lo que este aqui.
"""

from django.db.models import Sum
from rest_framework import serializers, status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from .models import DailyPartActivity, IncidentReport


def _normaliza(u):
    u = (u or "").strip().lower()
    return u.replace("\\u00b3", "3").replace("\\u00b2", "2")


class IncidentReportSerializer(serializers.ModelSerializer):
    """La incidencia con su presupuesto programado.

    'partidas' son los ids, que es lo que el formulario manda de vuelta, y
    'partidas_detalle' lo que la pantalla ensena. Van los dos: con solo el
    detalle el PATCH no tendria con que escribir, y con solo los ids habria
    que pedir cada partida aparte para pintar una fila.
    """

    partidas_detalle = serializers.SerializerMethodField()
    presupuestado = serializers.SerializerMethodField()
    partes = serializers.SerializerMethodField()

    class Meta:
        model = IncidentReport
        fields = ["id", "code", "type", "location_text", "description",
                  "created_at", "partes",
                  "partidas", "partidas_detalle", "presupuestado"]

    def get_partes(self, obj):
        return obj.heavy_equipments.count()

    def get_partidas_detalle(self, obj):
        """Cada partida con lo presupuestado, lo hecho y lo que queda.

        EL EJECUTADO ES DE TODA LA OBRA, no solo de esta incidencia. El saldo
        de una partida no depende de quien se lo haya ido gastando: si otro
        sujeto ya excavo 100 de los 173, aqui quedan 73 aunque esta
        incidencia no haya tocado ninguno. Un saldo "propio" invitaria a
        pasarse del presupuesto entre varios sin que ninguno lo notara.

        Solo suma el metrado imputado en la MISMA unidad que la partida. Lo
        imputado en otra no se suma -daria un avance falso- pero tampoco se
        esconde: queda a la vista en el saldo.
        """
        partidas = list(obj.partidas.all().order_by("codigo"))
        if not partidas:
            return []

        hecho = {}
        filas = (DailyPartActivity.objects
                 .filter(partida_id__in=[p.id for p in partidas])
                 .values("partida_id", "metrado_unidad")
                 .annotate(suma=Sum("metrado")))
        for f in filas:
            hecho.setdefault(f["partida_id"], {})[
                _normaliza(f["metrado_unidad"])] = float(f["suma"] or 0)

        salida = []
        for p in partidas:
            total = float(p.metrado or 0)
            eje = hecho.get(p.id, {}).get(_normaliza(p.unidad), 0.0)
            precio = float(p.precio or 0)
            salida.append({
                "id": p.id,
                "codigo": p.codigo,
                "descripcion": p.descripcion,
                "unidad": p.unidad,
                "metrado": total,
                "precio": precio,
                "importe": round(total * precio, 2),
                "ejecutado": round(eje, 4),
                "saldo": round(total - eje, 4),
                "avance": round(eje / total * 100, 2) if total else None,
                "valorizado": round(eje * precio, 2),
            })
        return salida

    def get_presupuestado(self, obj):
        """Lo que esta incidencia tiene que hacer, al precio del presupuesto.

        Es el denominador del avance. Sin esto solo se sabe lo que lleva
        hecho, que no dice si va al 10% o al 90%.
        """
        total = 0.0
        for m, pr in obj.partidas.all().values_list("metrado", "precio"):
            total += float(m or 0) * float(pr or 0)
        return round(total, 2)


@api_view(["GET", "PATCH"])
@permission_classes([AllowAny])
def incidencia_detalle(request, pk):
    """La incidencia, y el PATCH que le programa partidas.

    No se admite DELETE. Las incidencias vienen de PLUVIRA y las borra -o no-
    el comando de sync; dejar aqui un borrado abriria la puerta a que la
    pantalla de costeo tire una incidencia que el sync va a volver a crear
    en la siguiente pasada.
    """
    try:
        inc = IncidentReport.objects.get(pk=pk)
    except IncidentReport.DoesNotExist:
        return Response({"detail": "No existe."},
                        status=status.HTTP_404_NOT_FOUND)

    if request.method == "GET":
        return Response(IncidentReportSerializer(inc).data)

    ser = IncidentReportSerializer(inc, data=request.data, partial=True)
    if not ser.is_valid():
        return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)
    ser.save()
    return Response(ser.data)
'''


# ══════════════════════════════════════════════════════════════════════════
# PIEZA 3 · la ruta
# ══════════════════════════════════════════════════════════════════════════

IMPORT = "from .views_incidentes import incidencia_detalle\n"

RUTA = ("    # Detalle de la incidencia: lo lee y le programa partidas la\n"
        "    # pantalla de costeo. Antes de esto /incidentes/<id>/ era 404.\n"
        "    path('incidentes/<int:pk>/', incidencia_detalle,\n"
        "         name='incidencia-detalle'),\n")


def paso_urls(texto):
    """→ (texto_nuevo, aviso).

    El import va justo ANTES de urlpatterns y la ruta justo DESPUES de abrir
    la lista. Se hace por posicion y no por un trozo de texto literal a
    proposito: la version anterior de este parche se anclaba a un import
    concreto de views_partidas, y un anclaje asi se rompe el dia que alguien
    reordena los imports, sin decir por que.

    La ruta va PRIMERA de la lista. No choca con incidentes/<id>/reabrir/ ni
    con cerrar-partes -<int:pk> no cruza la barra-, pero ponerla delante
    evita depender de eso.
    """
    if "views_incidentes" in texto:
        return texto, "ya estaba: la ruta de incidencia_detalle"

    m = re.search(r"^urlpatterns\s*=\s*\[", texto, re.M)
    if not m:
        return None, "no encuentro urlpatterns = [ en urls.py"

    if not re.search(r"^from django\.urls import .*\bpath\b", texto, re.M):
        return None, "urls.py no importa path; no se por donde meter la ruta"

    nuevo = (texto[:m.start()] + IMPORT + "\n"
             + texto[m.start():m.end()] + "\n" + RUTA
             + texto[m.end():])
    return nuevo, "anadida la ruta incidentes/<int:pk>/"


# ══════════════════════════════════════════════════════════════════════════
# el guion
# ══════════════════════════════════════════════════════════════════════════

def respaldo(ruta):
    sello = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    copia = "%s.bak-%s" % (ruta, sello)
    shutil.copy2(ruta, copia)
    return copia


def principal():
    base = base_del_proyecto()
    if not base:
        print("No encuentro la carpeta del proyecto. Pasala con --base /ruta")
        return 1

    app = os.path.join(base, "operations")
    f_models = os.path.join(app, "models.py")
    f_urls = os.path.join(app, "urls.py")
    f_vista = os.path.join(app, "views_incidentes.py")

    print("proyecto: %s" % base)
    print("modo    : %s" % ("APLICAR" if APLICAR else "solo mostrar"))
    print("")

    for f in (f_models, f_urls):
        if not os.path.isfile(f):
            print("MAL  no encuentro %s" % f)
            return 1

    txt_m = io.open(f_models, encoding="utf-8").read()
    txt_u = io.open(f_urls, encoding="utf-8").read()

    # ── los tres pasos, en seco ──
    nuevo_m, av_m = paso_modelo(txt_m)
    nuevo_u, av_u = paso_urls(txt_u)
    vista_existe = os.path.isfile(f_vista)
    av_v = ("ya estaba: views_incidentes.py" if vista_existe
            else "se crea views_incidentes.py")

    print("1. models.py            %s" % av_m)
    print("2. views_incidentes.py  %s" % av_v)
    print("3. urls.py              %s" % av_u)
    print("")

    fallos = []
    if nuevo_m is None:
        fallos.append("models.py: %s" % av_m)
    if nuevo_u is None:
        fallos.append("urls.py: %s" % av_u)

    if fallos:
        print("NO SE ESCRIBE NADA. A medias es peor que sin empezar:")
        for f in fallos:
            print("   - %s" % f)
        print("")
        print("Mandame esta salida y lo ajusto.")
        return 1

    # Se comprueba el RESULTADO, no la intencion. El "nuevo_m and" no es
    # paranoia decorativa: sin el, quitar el guardarrail de arriba hace que
    # esto reviente con un TypeError en vez de rechazar, y el parche sale con
    # error "por accidente". La prueba pasaba igual, que es lo peligroso.
    if (nuevo_m is not None and "ya estaba" not in av_m
            and 'related_name="incidencias"' not in nuevo_m):
        print("NO SE ESCRIBE NADA: el campo no salio con su related_name.")
        return 1
    if "incidencia_detalle" not in nuevo_u:
        print("NO SE ESCRIBE NADA: la ruta no salio en urls.py.")
        return 1

    if not APLICAR:
        print("Nada tocado. Para aplicarlo:")
        print("    python3 %s --aplicar" % os.path.basename(__file__))
        return 0

    # ── escribir ──
    escritos = []
    if nuevo_m != txt_m:
        print("respaldo %s" % respaldo(f_models))
        io.open(f_models, "w", encoding="utf-8").write(nuevo_m)
        escritos.append("models.py")
    if not vista_existe:
        io.open(f_vista, "w", encoding="utf-8").write(VISTA)
        escritos.append("views_incidentes.py")
    if nuevo_u != txt_u:
        print("respaldo %s" % respaldo(f_urls))
        io.open(f_urls, "w", encoding="utf-8").write(nuevo_u)
        escritos.append("urls.py")

    print("")
    print("escrito: %s" % (", ".join(escritos) if escritos else "nada, ya estaba"))
    print("")
    print("Ahora la migracion -es una tabla nueva, no toca ninguna columna-:")
    print("    docker compose exec web python manage.py makemigrations operations")
    print("    docker compose exec web python manage.py migrate")
    print("    docker compose up -d --no-deps --force-recreate web")
    print("")
    print("Y para comprobarlo sin abrir el navegador:")
    print("    docker compose exec web python manage.py shell -c \\")
    print("      \"from operations.models import IncidentReport as I;\\")
    print("       print(I._meta.get_field('partidas'))\"")
    return 0


if __name__ == "__main__":
    sys.exit(principal())
