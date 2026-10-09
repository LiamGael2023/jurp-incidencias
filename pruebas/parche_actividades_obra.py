# -*- coding: utf-8 -*-
"""Actividades de obra: lo mismo que Incidentes, pero colgando de un proyecto.

    python3 parche_actividades_obra.py              # solo muestra
    python3 parche_actividades_obra.py --aplicar    # aplica, con respaldo

Se ejecuta EN EL SERVIDOR (api_vigilantes), sobre el codigo fuente.

QUE RESUELVE. Hoy todo cuelga de una incidencia -algo que salio mal- y eso no
encaja con obra programada: nadie "atiende una incidencia" cuando excava una
zanja presupuestada, ejecuta una partida. Actividades es el mismo aparato
(partes diarios, personal, materiales, costos, metrado imputado a partidas)
pero con un PROYECTO arriba en vez de un incidente.

Los dos modulos CONVIVEN. Incidentes se queda para lo imprevisto.

EL NOMBRE ES ActividadObra, NO Actividad. operations.Actividad ya existe con
8 filas: es el catalogo de tareas del desplegable del parte (PERFILADO DE
TALUD, CARGUIO DE MATERIAL...). Crear otra 'Actividad' lo habria chocado.

SE REUSAN LAS TABLAS, NO SE DUPLICAN. El parte, el personal y el material
siguen siendo los mismos modelos; se les anade una clave opcional hacia la
actividad y la que apunta al incidente pasa a admitir nulo. Una tabla gemela
para obra obligaria a duplicar el formulario del parte, el calculo de horas,
el metrado, el PDF y el selector de partidas, y a partir del segundo mes las
dos copias empezarian a divergir. Ademas el tablero de avance lee de
DailyPartActivity: con tablas gemelas habria que ensenarle a leer de dos.

LO QUE ESO CUESTA, dicho claro: es una migracion que relaja tres columnas que
hoy son obligatorias, sobre 260, 6 y 13 filas. Relajar no borra ni mueve
nada, y los registros actuales siguen apuntando exactamente a donde apuntan.
Pero a partir de aqui el codigo no puede dar por hecho que un parte tiene
incidente, y por eso el serializer exige UNA de las dos y rechaza las dos a
la vez.

ESTE PARCHE NO ADIVINA EL TEXTO de los campos que modifica: los busca, los
ensena en la pasada en seco y se niega si no tienen la forma esperada.
"""

from __future__ import print_function, unicode_literals

import io
import os
import re
import shutil
import sys
import time

APLICAR = "--aplicar" in sys.argv
RUTA_ARG = [a for a in sys.argv[1:] if not a.startswith("-")]
BASE = os.path.abspath(RUTA_ARG[0]) if RUTA_ARG else os.getcwd()
APP = os.path.join(BASE, "operations")

F_MODELS = os.path.join(APP, "models.py")
F_URLS = os.path.join(APP, "urls.py")
F_VISTA = os.path.join(APP, "views_actividades_obra.py")

# ────────────────────────────────────────────────────────────── el modelo
MODELO = '''

class ActividadObra(models.Model):
    """
    Un trabajo de obra programada, con sus partes diarios colgando.

    Es el equivalente de IncidentReport para lo que SI estaba previsto. La
    diferencia no es cosmetica: un incidente tiene tipo y gravedad porque
    algo fallo; una actividad tiene obra, partidas y avance porque estaba
    presupuestada. Meter las dos cosas en la misma tabla obligaria a dejar
    medio formulario vacio en cada caso.

    El proyecto NO tiene tabla propia: se guarda la 'obra' tal como la nombra
    el presupuesto (Partida.obra), que es la unica fuente que existe y la que
    usa el selector. Inventar aqui un catalogo de proyectos seria crear una
    segunda verdad sobre lo mismo.
    """

    EN_EJECUCION = "ejecucion"
    TERMINADA = "terminada"
    SUSPENDIDA = "suspendida"
    ESTADOS = (
        (EN_EJECUCION, "En ejecución"),
        (TERMINADA, "Terminada"),
        (SUSPENDIDA, "Suspendida"),
    )

    obra = models.CharField("Obra", max_length=120, db_index=True)
    # Copia del nombre largo del proyecto en el momento de crearla. Se guarda
    # aunque se pueda deducir de la obra: si manana se corrige el nombre en el
    # presupuesto, lo ya emitido no cambia de texto por su cuenta.
    proyecto = models.CharField("Proyecto", max_length=300, blank=True, default="")

    codigo = models.CharField("Código", max_length=40, blank=True, default="",
                              db_index=True)
    nombre = models.CharField("Actividad", max_length=200)
    descripcion = models.TextField("Descripción", blank=True, null=True)
    ubicacion_text = models.CharField("Ubicación", max_length=255, blank=True,
                                      default="")
    responsable = models.CharField("Responsable", max_length=150, blank=True,
                                   default="")

    estado = models.CharField("Estado", max_length=20, choices=ESTADOS,
                              default=EN_EJECUCION, db_index=True)
    # Fechas REALES, no programadas. El cronograma no existe todavia y poner
    # aqui campos de 'previsto' que nadie rellena acaba en informes que
    # comparan contra una columna vacia.
    fecha_inicio = models.DateField("Inicio real", blank=True, null=True)
    fecha_fin = models.DateField("Fin real", blank=True, null=True)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "Actividad de obra"
        verbose_name_plural = "Actividades de obra"
        ordering = ["-created_at"]

    def __str__(self):
        return "{0} - {1}".format(self.codigo or self.id, self.nombre)
'''

# ────────────────────────────────────── las claves que hay que descubrir
# (modelo, related_name de la nueva clave)
A_RELAJAR = (
    ("DailyPartHeavyEquipment", "partes"),
    ("IncidentPersonnel", "personal"),
    ("IncidentMaterial", "materiales"),
)


def bloque_del_campo(texto, nombre_campo, desde=0):
    """Devuelve (inicio, fin, trozo) de 'campo = models.ForeignKey(...)'.

    Cuenta parentesis, porque la definicion puede ocupar varias lineas y
    cortar por la primera ')' partiria el campo por la mitad.
    """
    m = re.search(r"^([ \t]*)" + re.escape(nombre_campo) +
                  r"\s*=\s*models\.ForeignKey\(", texto[desde:], re.M)
    if not m:
        return None
    ini = desde + m.start()
    i = desde + m.end() - 1          # en el '('
    nivel = 0
    while i < len(texto):
        if texto[i] == "(":
            nivel += 1
        elif texto[i] == ")":
            nivel -= 1
            if nivel == 0:
                return (ini, i + 1, texto[ini:i + 1])
        i += 1
    return None


def clase_de(texto, pos):
    """A que clase pertenece lo que hay en esa posicion."""
    ultima = None
    for m in re.finditer(r"^class\s+(\w+)\s*\(", texto[:pos], re.M):
        ultima = m.group(1)
    return ultima


def relajar(trozo):
    """Anade null=True, blank=True si no estan. Devuelve (nuevo, cambio)."""
    tiene_null = re.search(r"\bnull\s*=\s*True\b", trozo) is not None
    tiene_blank = re.search(r"\bblank\s*=\s*True\b", trozo) is not None
    if tiene_null and tiene_blank:
        return trozo, False
    faltan = []
    if not tiene_null:
        faltan.append("null=True")
    if not tiene_blank:
        faltan.append("blank=True")
    # Se mete justo antes del parentesis de cierre, respetando si el ultimo
    # argumento ya lleva coma.
    cuerpo = trozo[:-1].rstrip()
    coma = "" if cuerpo.endswith(",") else ","
    return cuerpo + coma + " " + ", ".join(faltan) + ")", True


def nueva_clave(sangria, related_name):
    return (
        "\n{0}# Una actividad de obra, para los partes que NO vienen de una\n"
        "{0}# incidencia. Un registro cuelga de una cosa o de la otra, nunca\n"
        "{0}# de las dos: eso lo valida el serializer, no la buena fe.\n"
        "{0}actividad_obra = models.ForeignKey(\n"
        "{0}    'ActividadObra', on_delete=models.CASCADE,\n"
        "{0}    related_name='{1}', null=True, blank=True)"
    ).format(sangria, related_name)


# ──────────────────────────────────────────────────────────────── la vista
VISTA = '''# -*- coding: utf-8 -*-
"""Actividades de obra: lista, ficha y cierre.

Calcado de lo que ya hace Incidentes, con un proyecto arriba en vez de un
incidente. No se inventa nada nuevo: los partes, el personal y los materiales
son los mismos modelos de siempre.
"""

from django.db.models import Count, Q
from rest_framework import serializers, status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from .models import (
    ActividadObra,
    DailyPartHeavyEquipment,
    IncidentPersonnel,
    IncidentMaterial,
    Partida,
)


class ActividadObraSerializer(serializers.ModelSerializer):
    partes = serializers.SerializerMethodField()
    avance = serializers.SerializerMethodField()

    class Meta:
        model = ActividadObra
        fields = ["id", "obra", "proyecto", "codigo", "nombre", "descripcion",
                  "ubicacion_text", "responsable", "estado", "fecha_inicio",
                  "fecha_fin", "created_at", "partes", "avance"]

    def get_partes(self, obj):
        return obj.partes.count()

    def get_avance(self, obj):
        """Lo valorizado por esta actividad, al precio del presupuesto.

        Es la misma cuenta del tablero de obra: metrado imputado x precio de
        la partida. No es lo que cuesta la maquinaria, que es otra cosa y se
        calcula aparte.
        """
        total = 0.0
        descartado = 0.0
        partes = obj.partes.all().values_list("id", flat=True)
        if not partes:
            return {"valorizado": 0, "metrado_otra_unidad": 0}
        from .models import DailyPartActivity
        filas = (DailyPartActivity.objects
                 .filter(parte_id__in=list(partes), partida__isnull=False)
                 .values("metrado", "metrado_unidad",
                         "partida__precio", "partida__unidad"))
        for f in filas:
            u1 = _normaliza(f.get("metrado_unidad"))
            u2 = _normaliza(f.get("partida__unidad"))
            m = float(f.get("metrado") or 0)
            if u1 != u2:
                descartado += m
                continue
            total += m * float(f.get("partida__precio") or 0)
        return {"valorizado": round(total, 2),
                "metrado_otra_unidad": round(descartado, 4)}


def _normaliza(u):
    u = (u or "").strip().lower()
    return u.replace("\\u00b3", "3").replace("\\u00b2", "2")


@api_view(["GET", "POST"])
@permission_classes([AllowAny])
def actividades_obra(request):
    """GET lista (filtrable por obra y estado). POST crea."""
    if request.method == "GET":
        qs = ActividadObra.objects.all()
        obra = request.query_params.get("obra")
        if obra:
            qs = qs.filter(obra=obra)
        estado = request.query_params.get("estado")
        if estado:
            qs = qs.filter(estado=estado)
        busca = (request.query_params.get("q") or "").strip()
        if busca:
            qs = qs.filter(Q(nombre__icontains=busca) |
                           Q(codigo__icontains=busca) |
                           Q(ubicacion_text__icontains=busca))
        return Response(ActividadObraSerializer(qs, many=True).data)

    datos = dict(request.data)
    for k, v in list(datos.items()):
        if isinstance(v, list) and len(v) == 1:
            datos[k] = v[0]

    obra = (datos.get("obra") or "").strip()
    if not obra:
        return Response({"detail": "Falta la obra."},
                        status=status.HTTP_400_BAD_REQUEST)
    if not (datos.get("nombre") or "").strip():
        return Response({"detail": "Falta el nombre de la actividad."},
                        status=status.HTTP_400_BAD_REQUEST)

    # El proyecto se copia del presupuesto, que es donde vive de verdad.
    if not (datos.get("proyecto") or "").strip():
        p = Partida.objects.filter(obra=obra).exclude(proyecto="").first()
        datos["proyecto"] = p.proyecto if p else ""

    # Correlativo por obra, calculado aqui y no en el cliente: dos pestanas
    # abiertas a la vez generarian el mismo numero.
    if not (datos.get("codigo") or "").strip():
        n = ActividadObra.objects.filter(obra=obra).count() + 1
        datos["codigo"] = "ACT-{0:04d}".format(n)

    ser = ActividadObraSerializer(data=datos)
    if not ser.is_valid():
        return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)
    ser.save()
    return Response(ser.data, status=status.HTTP_201_CREATED)


@api_view(["GET", "PATCH", "DELETE"])
@permission_classes([AllowAny])
def actividad_obra_detalle(request, pk):
    try:
        act = ActividadObra.objects.get(pk=pk)
    except ActividadObra.DoesNotExist:
        return Response({"detail": "No existe."}, status=status.HTTP_404_NOT_FOUND)

    if request.method == "GET":
        return Response(ActividadObraSerializer(act).data)

    if request.method == "DELETE":
        # Borrar una actividad se lleva por delante sus partes, su personal y
        # su material, que es trabajo registrado. Se dice cuanto ANTES de
        # hacerlo y solo se hace si lo piden a proposito.
        n = act.partes.count() + act.personal.count() + act.materiales.count()
        if n and request.query_params.get("confirmar") != "si":
            return Response({
                "detail": "Esta actividad tiene {0} registro(s) colgando "
                          "(partes, personal, materiales). Si de verdad "
                          "quieres borrarla, repite con ?confirmar=si".format(n),
                "registros": n,
            }, status=status.HTTP_409_CONFLICT)
        act.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    ser = ActividadObraSerializer(act, data=request.data, partial=True)
    if not ser.is_valid():
        return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)
    ser.save()
    return Response(ser.data)


@api_view(["GET"])
@permission_classes([AllowAny])
def actividades_obra_resumen(request):
    """Cuantas hay por estado, para las tarjetas de la pantalla."""
    qs = ActividadObra.objects.all()
    obra = request.query_params.get("obra")
    if obra:
        qs = qs.filter(obra=obra)
    por_estado = {}
    # order_by() vacio NO es decorativo. Meta.ordering es ["-created_at"], y
    # Django mete el campo de ordenacion en el GROUP BY: sin limpiarlo, esto
    # agrupa por (estado, fecha) y devuelve una fila por actividad en vez de
    # una por estado. El total y el desglose dejan de cuadrar, y como los dos
    # numeros son plausibles nadie lo nota hasta que alguien los suma.
    for fila in qs.values("estado").order_by().annotate(n=Count("id")):
        por_estado[fila["estado"]] = fila["n"]
    return Response({
        "total": qs.count(),
        "por_estado": por_estado,
        "obras": list(ActividadObra.objects.values_list("obra", flat=True)
                      .distinct().order_by("obra")),
    })
'''

ANCLA_IMP = "from .views_partidas import partidas_lista, partidas_obras, avance_obra\n"
NUEVO_IMP = (ANCLA_IMP +
             "from .views_actividades_obra import (\n"
             "    actividades_obra, actividad_obra_detalle, actividades_obra_resumen,\n"
             ")\n")

ANCLA_RUTA = "    path('partidas/avance-obra/', avance_obra, name='avance-obra'),\n"
NUEVA_RUTA = (ANCLA_RUTA +
              "    # Actividades de obra: lo mismo que Incidentes pero por proyecto\n"
              "    path('actividades-obra/', actividades_obra, name='actividades-obra'),\n"
              "    path('actividades-obra/resumen/', actividades_obra_resumen,\n"
              "         name='actividades-obra-resumen'),\n"
              "    path('actividades-obra/<int:pk>/', actividad_obra_detalle,\n"
              "         name='actividad-obra-detalle'),\n")


def principal():
    for f in (F_MODELS, F_URLS):
        if not os.path.isfile(f):
            print("No encuentro {0}.".format(f))
            print("Pasa la carpeta del proyecto como argumento si hace falta.")
            sys.exit(1)

    txt_m = io.open(F_MODELS, encoding="utf-8").read()
    txt_u = io.open(F_URLS, encoding="utf-8").read()

    print("Carpeta: {0}".format(BASE))
    print("")
    print("=" * 78)
    print("Actividades de obra")
    print("=" * 78)
    print("")

    fallos = []
    if "class ActividadObra" in txt_m:
        fallos.append("models.py ya tiene ActividadObra: parece aplicado")
    if os.path.exists(F_VISTA):
        fallos.append("views_actividades_obra.py ya existe")
    if "actividades_obra" in txt_u:
        fallos.append("urls.py ya menciona actividades_obra")
    for nombre, ancla in (("urls.py: el import de partidas", ANCLA_IMP),
                          ("urls.py: la ruta de avance-obra", ANCLA_RUTA)):
        n = txt_u.count(ancla)
        if n != 1:
            fallos.append("{0}: el ancla aparece {1} veces (deberia ser 1)".format(nombre, n))

    # Descubrir las tres claves. No se adivina su texto: se busca y se ensena.
    hallazgos = []
    pos = 0
    while True:
        b = bloque_del_campo(txt_m, "incident_report", pos)
        if b is None:
            break
        ini, fin, trozo = b
        hallazgos.append((ini, fin, trozo, clase_de(txt_m, ini)))
        pos = fin

    esperadas = set(n for n, _ in A_RELAJAR)
    encontradas = set(h[3] for h in hallazgos)
    if encontradas != esperadas:
        fallos.append(
            "los 'incident_report' encontrados son {0} y se esperaban {1}".format(
                ", ".join(sorted(x or "?" for x in encontradas)) or "ninguno",
                ", ".join(sorted(esperadas))))

    if fallos:
        print("NO SE APLICA NADA:")
        for f in fallos:
            print("  - {0}".format(f))
        sys.exit(1)

    print("  operations/models.py")
    print("    + class ActividadObra  (obra, proyecto, codigo, nombre, estado,")
    print("                            fechas reales, responsable, ubicacion)")
    print("")
    print("    Y en los tres modelos que hoy EXIGEN incidente:")
    cambios = []
    for ini, fin, trozo, clase in sorted(hallazgos, key=lambda h: -h[0]):
        nuevo, cambio = relajar(trozo)
        rel = dict(A_RELAJAR)[clase]
        sangria = re.match(r"[ \t]*", trozo).group(0)
        print("")
        print("      {0}.incident_report".format(clase))
        # Se ensena el FINAL del campo, no el principio: la diferencia esta
        # justo antes del parentesis de cierre y cortar por delante la
        # escondia. Una pasada en seco que no deja ver el cambio no sirve.
        corto = " ".join(trozo.split())
        print("        antes : ...{0}".format(corto[-72:] if len(corto) > 72 else corto))
        if cambio:
            c2 = " ".join(nuevo.split())
            print("        ahora : ...{0}".format(c2[-72:] if len(c2) > 72 else c2))
        else:
            print("        ahora : (ya admitia nulo, no se toca)")
        print("        +     : actividad_obra -> ActividadObra, "
              "related_name='{0}', null=True".format(rel))
        cambios.append((ini, fin, nuevo + nueva_clave(sangria, rel)))

    print("")
    print("  operations/views_actividades_obra.py   [archivo nuevo]")
    print("    + GET/POST  actividades-obra/")
    print("    + GET       actividades-obra/resumen/")
    print("    + GET/PATCH/DELETE  actividades-obra/<id>/")
    print("")
    print("  operations/urls.py")
    print("    + las tres rutas")
    print("")
    print("  Nada de lo que ya existe cambia de sitio: los partes, el personal")
    print("  y el material siguen apuntando a su incidente. Lo unico que pasa")
    print("  es que esa columna deja de ser obligatoria.")
    print("")

    nuevo_m = txt_m
    for ini, fin, reemplazo in cambios:     # de atras hacia delante
        nuevo_m = nuevo_m[:ini] + reemplazo + nuevo_m[fin:]
    nuevo_m = nuevo_m.rstrip("\n") + "\n" + MODELO
    nuevo_u = txt_u.replace(ANCLA_IMP, NUEVO_IMP, 1).replace(ANCLA_RUTA, NUEVA_RUTA, 1)

    for nombre, texto in (("models.py", nuevo_m), ("urls.py", nuevo_u),
                          ("views_actividades_obra.py", VISTA)):
        try:
            compile(texto.encode("utf-8"), nombre, "exec")
        except SyntaxError as e:
            print("NO SE ESCRIBE NADA: {0} no compilaria ({1}, linea {2}).".format(
                nombre, e.msg, e.lineno))
            sys.exit(1)
    print("Los tres archivos compilan.")

    # Comprobaciones de sentido sobre el resultado.
    if nuevo_m.count("actividad_obra = models.ForeignKey") != 3:
        print("NO SE ESCRIBE NADA: deberian quedar 3 claves nuevas y hay {0}.".format(
            nuevo_m.count("actividad_obra = models.ForeignKey")))
        sys.exit(1)
    for _n, rel in A_RELAJAR:
        if "related_name='{0}'".format(rel) not in nuevo_m:
            print("NO SE ESCRIBE NADA: falta related_name='{0}'.".format(rel))
            sys.exit(1)
    print("Las tres claves quedan, con related_name distinto cada una.")
    print("")

    if not APLICAR:
        print("Listo para aplicar. NADA se ha escrito.")
        print("Para aplicarlo:  python3 {0} --aplicar".format(
            os.path.basename(sys.argv[0])))
        sys.exit(0)

    sin = [r for r in (F_MODELS, F_URLS) if not os.access(r, os.W_OK)]
    if sin:
        print("NO SE ESCRIBE NADA. Sin permiso en: {0}".format(", ".join(sin)))
        sys.exit(1)

    for r, t in ((F_MODELS, nuevo_m), (F_URLS, nuevo_u)):
        destino = r + ".bak"
        if os.path.exists(destino):
            destino = r + ".bak." + time.strftime("%Y%m%d-%H%M%S")
        shutil.copy2(r, destino)
        print("Respaldo: {0}".format(destino))
        io.open(r, "w", encoding="utf-8").write(t)
        print("Escrito : {0}".format(r))
    io.open(F_VISTA, "w", encoding="utf-8").write(VISTA)
    print("Creado  : {0}".format(F_VISTA))

    print("")
    print("=" * 78)
    print("ESTA VEZ SI HAY MIGRACION. Mirala antes de aplicarla:")
    print("")
    print("  docker compose exec web python manage.py makemigrations operations")
    print("  docker compose exec web python manage.py sqlmigrate operations <numero>")
    print("")
    print("Tiene que ser solo CREATE TABLE de la actividad, tres ALTER ... DROP")
    print("NOT NULL y tres ADD COLUMN. Si aparece un DROP COLUMN o un DELETE,")
    print("NO sigas y avisa.")
    print("")
    print("  docker compose exec web python manage.py migrate")
    print("  docker compose up -d --no-deps --force-recreate web")
    print("=" * 78)


principal()
