# -*- coding: utf-8 -*-
"""
Partidas de presupuesto enganchadas a las actividades del parte diario.

    python3 parche_partidas_backend.py                 # solo muestra
    python3 parche_partidas_backend.py --aplicar        # aplica, con respaldo
    python3 parche_partidas_backend.py /ruta/al/codigo

Se ejecuta EN EL SERVIDOR (api_vigilantes), sobre el codigo fuente.

QUE HACE
  1. Modelo Partida: el presupuesto de una obra, una fila por partida.
  2. La actividad del parte apunta a su partida, y guarda ademas el codigo y
     la descripcion COPIADOS en el momento.
  3. Endpoint /partidas/ con el avance ejecutado de cada una.
  4. Arregla el guardado: la FK llega como id y hay que convertirla.

POR QUE SE COPIAN CODIGO Y DESCRIPCION, teniendo ya la FK. Un presupuesto se
modifica: adicionales, deductivos, partidas que se reemplazan. Un parte ya
cerrado tiene que seguir diciendo a que se cargo el metrado AUNQUE la partida
cambie o desaparezca despues. La FK sirve para sumar el avance; la copia, para
que el papel firmado siga siendo cierto dentro de un ano.

POR QUE SET_NULL Y NO CASCADE. Si manana se recarga el presupuesto y una
partida se borra, con CASCADE se llevaria por delante las ACTIVIDADES de los
partes. Con SET_NULL la actividad sobrevive y conserva su copia del codigo.

EL ARREGLO DEL GUARDADO. _guardar_actividades filtra las claves por los campos
editables del modelo y hace create(**limpio). Con una FK eso no vale: el
formulario manda  "partida": 42  y Django exige una instancia, no un 42. Se
traduce a partida_id, que es lo que el ORM si acepta.

LAS UNIDADES NO CASAN SOLAS. El presupuesto trae m³ y m²; la app guarda m3 y
m2. Al sumar el avance se normalizan (³->3, ²->2, minusculas) o la mitad de
las lineas quedarian fuera sin que nadie lo note.

NO TOCA views.py: la vista nueva va en su propio archivo, para no pelear con
anclajes en un archivo de 700 lineas.

DESPUES DE APLICAR hay que crear la migracion. El script lo recuerda.
"""

from __future__ import print_function, unicode_literals

import io
import os
import shutil
import sys

APLICAR = "--aplicar" in sys.argv
RUTA_ARG = [a for a in sys.argv[1:] if not a.startswith("-")]
BASE = os.path.abspath(RUTA_ARG[0]) if RUTA_ARG else os.getcwd()

APP = os.path.join(BASE, "operations")
if not os.path.isdir(APP):
    print("No encuentro {0}. Pasa la carpeta del codigo como argumento:".format(APP))
    print("  python3 {0} /root/proyectos/api_vigilantes".format(os.path.basename(sys.argv[0])))
    sys.exit(1)

F_MODELS = os.path.join(APP, "models.py")
F_SER = os.path.join(APP, "serializers.py")
F_URLS = os.path.join(APP, "urls.py")
F_VISTA = os.path.join(APP, "views_partidas.py")

# ───────────────────────────────────────────────────────────── 1. el modelo
MODELO = '''

class Partida(models.Model):
    """
    Una partida del presupuesto de una obra.

    El codigo no es decorativo: la MISMA descripcion se repite en varias
    estructuras. "Excavación de material suelto c/maquinaria pesada" esta en
    01.02.04.01.01 (CAJA DE DERIVACION), 01.02.05.01.01 (LINEA DE DERIVACION)
    y 01.02.06.01.01 (LINEA DE PURGA). Lo que distingue a una de otra es el
    codigo, no el texto, asi que quien imputa metrado tiene que ver DONDE.
    """
    obra = models.CharField("Obra", max_length=120, db_index=True)
    proyecto = models.CharField("Proyecto", max_length=300, blank=True, default="")
    codigo = models.CharField("Código", max_length=40, db_index=True)
    descripcion = models.CharField("Descripción", max_length=300)
    unidad = models.CharField("Unidad", max_length=12)
    metrado = models.DecimalField("Metrado presupuestado", max_digits=14,
                                  decimal_places=4, default=0)
    precio = models.DecimalField("Precio unitario", max_digits=14,
                                 decimal_places=2, default=0)
    # Donde cae dentro del presupuesto. 'estructura' es la obra fisica
    # (CAJA DE DERIVACION) y 'grupo' el capitulo (MOVIMIENTO DE TIERRAS).
    estructura = models.CharField("Estructura", max_length=200, blank=True, default="")
    grupo = models.CharField("Grupo", max_length=200, blank=True, default="")
    activo = models.BooleanField("Activa", default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "Partida"
        verbose_name_plural = "Partidas"
        ordering = ["obra", "codigo"]
        # Permite recargar el presupuesto sin duplicar y, sobre todo, sin
        # cambiar los ids: las actividades ya imputadas siguen apuntando bien.
        constraints = [
            models.UniqueConstraint(fields=["obra", "codigo"],
                                    name="partida_unica_por_obra"),
        ]

    @property
    def total(self):
        return (self.metrado or 0) * (self.precio or 0)

    def __str__(self):
        return "%s %s" % (self.codigo, self.descripcion)
'''

# ────────────────────────────────────── 2. los campos nuevos en la actividad
ANCLA_ACT = '''    observacion = models.CharField("Observacion", max_length=255, blank=True, null=True)
'''

CAMPOS_ACT = '''    observacion = models.CharField("Observacion", max_length=255, blank=True, null=True)
    # ── Partida del presupuesto a la que se imputa este metrado ───────────
    #
    # SET_NULL y no CASCADE: si manana se recarga el presupuesto y esta
    # partida desaparece, con CASCADE se borraria la ACTIVIDAD entera y con
    # ella el parte de un dia de trabajo.
    #
    # El codigo y la descripcion se COPIAN al guardar. Un presupuesto se
    # modifica -adicionales, deductivos- y un parte ya firmado tiene que
    # seguir diciendo a que se cargo, aunque la partida cambie despues. La FK
    # sirve para sumar el avance; la copia, para que el papel siga siendo
    # cierto dentro de un ano.
    partida = models.ForeignKey(
        'Partida', on_delete=models.SET_NULL, blank=True, null=True,
        related_name='actividades', verbose_name="Partida")
    partida_codigo = models.CharField("Código de partida", max_length=40,
                                      blank=True, null=True)
    partida_descripcion = models.CharField("Descripción de partida", max_length=300,
                                           blank=True, null=True)
'''

# ─────────────────────────────────── 3. el guardado: la FK llega como id
ANCLA_SER = """            limpio = {k: v for k, v in item.items() if k in campos and k != 'parte'}
"""

NUEVO_SER = """            limpio = {k: v for k, v in item.items() if k in campos and k != 'parte'}
            # La FK llega como id ("partida": 42), no como instancia, y
            # create(partida=42) revienta. partida_id si lo acepta el ORM.
            # Cadena vacia o 0 significan "sin partida".
            if 'partida' in limpio:
                valor = limpio.pop('partida')
                limpio['partida_id'] = valor or None
"""

# ──────────────────────────────────────────────── 4. la vista, en su archivo
VISTA = '''# -*- coding: utf-8 -*-
"""
Partidas del presupuesto y su avance ejecutado.

Va en su propio archivo a proposito: views.py pasa de las 700 lineas y meter
aqui dos vistas mas solo servia para tener que buscarlas.
"""

from decimal import Decimal

from django.db.models import Sum
from rest_framework import serializers
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from .models import Partida, DailyPartActivity


def _normaliza_unidad(u):
    """m³ y m3 son la misma unidad; el presupuesto usa una y la app la otra.

    Sin esto la mitad de las lineas quedarian fuera del avance sin que nadie
    lo note, que es la peor forma de equivocarse: el numero sale, solo que
    mas bajo de lo que toca.
    """
    if not u:
        return ""
    return (str(u).strip().lower()
            .replace("\\u00b3", "3").replace("\\u00b2", "2")
            .replace("³", "3").replace("²", "2"))


class PartidaSerializer(serializers.ModelSerializer):
    total = serializers.SerializerMethodField()

    class Meta:
        model = Partida
        fields = ["id", "obra", "proyecto", "codigo", "descripcion", "unidad",
                  "metrado", "precio", "estructura", "grupo", "activo", "total"]

    def get_total(self, obj):
        return round(float(obj.metrado or 0) * float(obj.precio or 0), 2)


@api_view(["GET"])
@permission_classes([AllowAny])
def partidas_lista(request):
    """Partidas de una obra con lo ejecutado hasta hoy.

    ?obra=Obras10_6   filtra por obra (si no, van todas)
    ?activo=0         incluye tambien las desactivadas
    """
    qs = Partida.objects.all()
    obra = request.query_params.get("obra")
    if obra:
        qs = qs.filter(obra=obra)
    if request.query_params.get("activo") != "0":
        qs = qs.filter(activo=True)

    # Ejecutado: se suma por partida en UNA consulta, no una por fila.
    ejecutado = {}
    por_unidad = {}
    filas = (DailyPartActivity.objects
             .filter(partida__isnull=False)
             .values("partida_id", "metrado_unidad")
             .annotate(suma=Sum("metrado")))
    for f in filas:
        pid = f["partida_id"]
        por_unidad.setdefault(pid, {})[_normaliza_unidad(f["metrado_unidad"])] = f["suma"] or 0

    datos = []
    for p in qs:
        u = _normaliza_unidad(p.unidad)
        sumas = por_unidad.get(p.id, {})
        propio = float(sumas.get(u, 0) or 0)
        # Lo imputado con OTRA unidad no se suma, pero tampoco se esconde:
        # sumarlo daria un avance falso y callarlo dejaria metrado perdido.
        otras = {k: float(v) for k, v in sumas.items() if k != u and v}
        presupuestado = float(p.metrado or 0)
        d = PartidaSerializer(p).data
        d["ejecutado"] = round(propio, 4)
        d["saldo"] = round(presupuestado - propio, 4)
        d["avance"] = round(propio / presupuestado * 100, 2) if presupuestado else None
        d["otras_unidades"] = otras
        datos.append(d)

    return Response({
        "obra": obra or "",
        "total": len(datos),
        "partidas": datos,
    })


@api_view(["GET"])
@permission_classes([AllowAny])
def partidas_obras(request):
    """Las obras que tienen presupuesto cargado, para el selector."""
    obras = (Partida.objects.values("obra", "proyecto")
             .annotate(partidas=Sum(1))
             .order_by("obra"))
    vistas = {}
    for o in obras:
        vistas.setdefault(o["obra"], {"obra": o["obra"], "proyecto": o["proyecto"],
                                      "partidas": 0})
        vistas[o["obra"]]["partidas"] += o["partidas"] or 0
    return Response(list(vistas.values()))
'''

# ────────────────────────────────────────────────────────────── 5. las rutas
ANCLA_IMP = """    ActividadViewSet,
"""
NUEVO_IMP = """    ActividadViewSet,
"""
ANCLA_RUTA = """    path('partes-diarios/', partes_diarios_lista, name='partes-diarios'),
"""
NUEVA_RUTA = """    path('partes-diarios/', partes_diarios_lista, name='partes-diarios'),
    # Presupuesto: partidas de una obra y su avance ejecutado
    path('partidas/', partidas_lista, name='partidas'),
    path('partidas/obras/', partidas_obras, name='partidas-obras'),
"""
ANCLA_IMPORT_VISTA = """from .views import (
"""
NUEVO_IMPORT_VISTA = """from .views_partidas import partidas_lista, partidas_obras
from .views import (
"""


def leer(ruta):
    with io.open(ruta, encoding="utf-8") as f:
        return f.read()


print("Carpeta: {0}".format(BASE))
print("")

for f in (F_MODELS, F_SER, F_URLS):
    if not os.path.isfile(f):
        print("Falta {0}. No se aplica nada.".format(f))
        sys.exit(1)

models_txt = leer(F_MODELS)
ser_txt = leer(F_SER)
urls_txt = leer(F_URLS)

fallos = []

if "class Partida(models.Model)" in models_txt:
    fallos.append("models.py ya tiene class Partida: parece aplicado")
if models_txt.count(ANCLA_ACT) != 1:
    fallos.append("models.py: el ancla de la actividad aparece {0} veces (deberia ser 1)".format(
        models_txt.count(ANCLA_ACT)))
if ser_txt.count(ANCLA_SER) != 1:
    fallos.append("serializers.py: el ancla del guardado aparece {0} veces (deberia ser 1)".format(
        ser_txt.count(ANCLA_SER)))
if urls_txt.count(ANCLA_RUTA) != 1:
    fallos.append("urls.py: el ancla de la ruta aparece {0} veces (deberia ser 1)".format(
        urls_txt.count(ANCLA_RUTA)))
if urls_txt.count(ANCLA_IMPORT_VISTA) != 1:
    fallos.append("urls.py: el ancla del import aparece {0} veces (deberia ser 1)".format(
        urls_txt.count(ANCLA_IMPORT_VISTA)))
if os.path.exists(F_VISTA):
    fallos.append("ya existe {0}: parece aplicado".format(F_VISTA))

print("=" * 78)
print("Partidas de presupuesto en las actividades del parte")
print("=" * 78)
print("")

if fallos:
    print("NO SE APLICA NADA:")
    for f in fallos:
        print("  - {0}".format(f))
    sys.exit(1)

print("  models.py")
print("    + class Partida  (obra, codigo, descripcion, unidad, metrado, precio,")
print("                      estructura, grupo; unica por obra+codigo)")
print("    + en DailyPartActivity: partida (FK, SET_NULL), partida_codigo,")
print("      partida_descripcion")
print("")
print("  serializers.py  (_guardar_actividades)")
for l in NUEVO_SER.split("\n")[1:-1]:
    print("    + {0}".format(l.strip()))
print("")
print("  views_partidas.py   ARCHIVO NUEVO")
print("    + partidas_lista   GET /partidas/?obra=...   con ejecutado, saldo y avance")
print("    + partidas_obras   GET /partidas/obras/")
print("")
print("  urls.py")
print("    + from .views_partidas import partidas_lista, partidas_obras")
print("    + path('partidas/', ...) y path('partidas/obras/', ...)")
print("")
print("-" * 78)

nuevo_models = models_txt.replace(ANCLA_ACT, CAMPOS_ACT, 1).rstrip("\n") + "\n" + MODELO
nuevo_ser = ser_txt.replace(ANCLA_SER, NUEVO_SER, 1)
nuevo_urls = (urls_txt.replace(ANCLA_IMPORT_VISTA, NUEVO_IMPORT_VISTA, 1)
                      .replace(ANCLA_RUTA, NUEVA_RUTA, 1))

# La sintaxis se comprueba ANTES de escribir: un models.py roto deja la API
# entera sin arrancar, y eso no se arregla recargando.
for nombre, texto in (("models.py", nuevo_models), ("serializers.py", nuevo_ser),
                      ("urls.py", nuevo_urls), ("views_partidas.py", VISTA)):
    try:
        compile(texto.encode("utf-8"), nombre, "exec")
    except SyntaxError as e:
        print("NO SE ESCRIBE NADA: {0} no compilaria ({1}, linea {2}).".format(
            nombre, e.msg, e.lineno))
        sys.exit(1)
print("Los cuatro archivos compilan.")
print("-" * 78)
print("")

if not APLICAR:
    print("Listo para aplicar. NADA se ha escrito.")
    print("Para aplicarlo:  python3 {0} --aplicar".format(os.path.basename(sys.argv[0])))
    sys.exit(0)


def puede_escribir(ruta):
    if os.access(ruta, os.W_OK):
        return True, ""
    if os.access(os.path.dirname(ruta), os.W_OK):
        return False, "el archivo es de solo lectura (la carpeta si es escribible)"
    return False, "sin permiso de escritura"


problemas = []
for f in (F_MODELS, F_SER, F_URLS):
    ok, motivo = puede_escribir(f)
    if not ok:
        problemas.append((f, motivo))
if not os.access(APP, os.W_OK):
    problemas.append((APP, "no puedo crear views_partidas.py en esa carpeta"))

if problemas:
    print("NO SE ESCRIBE NADA. Falta permiso en:")
    for ruta, motivo in problemas:
        print("  {0}\n      {1}".format(ruta, motivo))
    print("")
    print("Vuelve a lanzarlo con:  sudo python3 {0} --aplicar".format(
        os.path.basename(sys.argv[0])))
    sys.exit(1)

respaldos = []
for f in (F_MODELS, F_SER, F_URLS):
    destino = f + ".bak"
    if os.path.exists(destino):
        import time
        destino = f + ".bak." + time.strftime("%Y%m%d-%H%M%S")
    shutil.copy2(f, destino)
    respaldos.append((destino, f))
    print("Respaldo: {0}".format(destino))

for ruta, texto in ((F_MODELS, nuevo_models), (F_SER, nuevo_ser),
                    (F_URLS, nuevo_urls), (F_VISTA, VISTA)):
    with io.open(ruta, "w", encoding="utf-8") as f:
        f.write(texto)
    print("Escrito: {0}".format(ruta))

print("")
print("=" * 78)
print("FALTA LA MIGRACION. Dentro del contenedor:")
print("")
print("  docker compose exec web python manage.py makemigrations operations")
print("  docker compose exec web python manage.py migrate")
print("")
print("Y luego recrear, que esto es codigo Python:")
print("  docker compose up -d --no-deps --force-recreate web")
print("=" * 78)
print("")
print("Para deshacer:")
for destino, original in respaldos:
    print("  mv {0} {1}".format(destino, original))
print("  rm {0}".format(F_VISTA))
