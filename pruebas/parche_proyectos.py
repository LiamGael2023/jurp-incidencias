# -*- coding: utf-8 -*-
"""El proyecto manda: primero se crea, luego se le importa su presupuesto.

    python3 parche_proyectos.py              # solo muestra
    python3 parche_proyectos.py --aplicar    # aplica, con respaldo

Se ejecuta EN EL SERVIDOR (api_vigilantes), sobre el codigo fuente.

POR QUE ESTE CAMBIO. Lo monte al reves. Hice que el proyecto saliera de las
partidas -Partida.obra era un texto suelto- porque el presupuesto lo cargue
yo con un script y no habia nada mas. El orden real es el contrario: se crea
el proyecto, se le importa SU presupuesto, y las actividades eligen partidas
DE ESE proyecto. Con un texto suelto no hay forma de limitar el selector al
presupuesto correcto, que es justo lo que hace falta cuando haya dos obras.

QUE SE ANADE:

  Proyecto     entidad de verdad, con los totales del pie del presupuesto
               (costo directo, gastos generales, utilidad, IGV, total). Hoy
               esos numeros se pierden al cargar, y son los que cuadran
               contra el Excel.

  Partida.proyecto_ref        clave hacia el proyecto
  ActividadObra.proyecto_ref  idem

QUE NO SE QUITA, Y ES A PROPOSITO. Los campos de texto 'obra' y 'proyecto'
siguen donde estan. Si los borrara ahora, cualquier consulta que aun los use
-el tablero de avance, el selector del parte, la app- dejaria de funcionar en
el mismo despliegue. Se quedan como espejo del proyecto hasta que todo lea la
clave, y entonces se retiran en un segundo paso que se podra probar solo.

LA IMPORTACION ENTRA COMO JSON YA PARSEADO. El Excel se lee en el navegador
y aqui llega la lista de partidas con sus totales. Asi el que importa VE que
va a entrar antes de que entre, y el servidor no necesita leer .xlsx. Lo que
si hace el servidor es comprobar la cuenta: si la suma de metrado x precio no
cuadra con el costo directo que dice el Excel, NO carga y lo dice.
"""

from __future__ import print_function, unicode_literals

import io
import os
import shutil
import sys
import time

APLICAR = "--aplicar" in sys.argv
RUTA_ARG = [a for a in sys.argv[1:] if not a.startswith("-")]
BASE = os.path.abspath(RUTA_ARG[0]) if RUTA_ARG else os.getcwd()
APP = os.path.join(BASE, "operations")

F_MODELS = os.path.join(APP, "models.py")
F_URLS = os.path.join(APP, "urls.py")
F_VISTA = os.path.join(APP, "views_proyectos.py")

MODELO = '''

class Proyecto(models.Model):
    """
    Una obra con su presupuesto. Es lo primero que se crea.

    Antes el proyecto era un texto repetido en cada partida (Partida.obra).
    Eso basta para agrupar, pero no para limitar: cuando hay dos obras, el
    selector del parte tiene que ofrecer SOLO las partidas de la suya, y un
    texto suelto no sostiene esa regla.

    Los totales del pie se guardan tal como los dice el presupuesto, no
    recalculados. Sirven para cotejar: si la suma de las partidas no cuadra
    con el costo directo declarado, es que falta alguna o se leyo mal una
    columna, y eso hay que verlo al importar y no tres meses despues.
    """

    ACTIVO = "activo"
    TERMINADO = "terminado"
    SUSPENDIDO = "suspendido"
    ESTADOS = (
        (ACTIVO, "Activo"),
        (TERMINADO, "Terminado"),
        (SUSPENDIDO, "Suspendido"),
    )

    codigo = models.CharField("Código", max_length=60, unique=True, db_index=True)
    nombre = models.CharField("Proyecto", max_length=300)
    entidad = models.CharField("Entidad contratante", max_length=200,
                               blank=True, default="")
    ubicacion = models.CharField("Ubicación", max_length=255, blank=True, default="")

    fecha_inicio = models.DateField("Inicio", blank=True, null=True)
    plazo_dias = models.PositiveIntegerField("Plazo (días)", blank=True, null=True)
    estado = models.CharField("Estado", max_length=20, choices=ESTADOS,
                              default=ACTIVO, db_index=True)

    # El pie del presupuesto, tal como lo declara el Excel.
    costo_directo = models.DecimalField("Costo directo", max_digits=16,
                                        decimal_places=2, default=0)
    gastos_generales = models.DecimalField("Gastos generales", max_digits=16,
                                           decimal_places=2, default=0)
    utilidad = models.DecimalField("Utilidad", max_digits=16,
                                   decimal_places=2, default=0)
    igv = models.DecimalField("IGV", max_digits=16, decimal_places=2, default=0)
    total = models.DecimalField("Total presupuesto", max_digits=16,
                                decimal_places=2, default=0)

    presupuesto_cargado = models.DateTimeField("Presupuesto cargado el",
                                               blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "Proyecto"
        verbose_name_plural = "Proyectos"
        ordering = ["codigo"]

    def __str__(self):
        return "{0} - {1}".format(self.codigo, self.nombre[:60])
'''

# ───────────────────────────────── las claves hacia el proyecto
import re


def bloque_obra(texto, clase):
    """Encuentra 'obra = models.CharField(...)' DENTRO de una clase.

    No se da por supuesto el texto exacto del campo: en Partida lo escribi yo
    con nombre descriptivo y en otro sitio puede estar sin el. Buscar por
    posicion dentro de la clase aguanta las dos formas; buscar por texto
    literal falla en silencio y deja media migracion hecha.
    """
    m = re.search(r"^class\s+" + re.escape(clase) + r"\s*\(", texto, re.M)
    if not m:
        return None
    ini = m.start()
    sig = re.search(r"^class\s+\w+\s*\(", texto[ini + 1:], re.M)
    fin = ini + 1 + sig.start() if sig else len(texto)
    cuerpo = texto[ini:fin]
    mo = re.search(r"^([ \t]*)obra\s*=\s*models\.CharField\([^\n]*\)\s*$",
                   cuerpo, re.M)
    if not mo:
        return None
    return (ini + mo.start(), ini + mo.end(), mo.group(0), mo.group(1))


def clave_proyecto(sangria, related_name, con_nota):
    nota = ""
    if con_nota:
        nota = (
            "{0}#\n"
            "{0}# 'obra' se queda al lado como espejo, no por duplicar: hay\n"
            "{0}# consultas vivas -el tablero de avance, el selector del parte,\n"
            "{0}# la app- que todavia la usan, y quitarla ahora las romperia en\n"
            "{0}# el mismo despliegue. Se retira cuando todo lea la clave.\n"
        ).format(sangria)
    return (
        "{0}# El proyecto al que pertenece. Es lo que manda.\n"
        "{1}"
        "{0}proyecto_ref = models.ForeignKey(\n"
        "{0}    'Proyecto', on_delete=models.CASCADE, related_name='{2}',\n"
        "{0}    null=True, blank=True, verbose_name=\"Proyecto\")\n"
    ).format(sangria, nota, related_name)


ANCLA_PARTIDA = '    obra = models.CharField("Obra", max_length=120, db_index=True)\n'
NUEVA_PARTIDA = '''    # El proyecto al que pertenece. Es lo que manda.
    #
    # 'obra' se queda al lado como espejo, no por duplicar: hay consultas
    # vivas -el tablero de avance, el selector del parte, la app- que todavia
    # la usan, y quitarla ahora las romperia en el mismo despliegue. Se retira
    # cuando todo lea la clave, en un paso que se pueda probar solo.
    proyecto_ref = models.ForeignKey(
        'Proyecto', on_delete=models.CASCADE, related_name='partidas',
        null=True, blank=True, verbose_name="Proyecto")
    obra = models.CharField("Obra", max_length=120, db_index=True)
'''

ANCLA_ACT = '    obra = models.CharField("Obra", max_length=120, db_index=True)\n'
NUEVA_ACT = '''    proyecto_ref = models.ForeignKey(
        'Proyecto', on_delete=models.CASCADE, related_name='actividades',
        null=True, blank=True, verbose_name="Proyecto")
    obra = models.CharField("Obra", max_length=120, db_index=True)
'''

VISTA = '''# -*- coding: utf-8 -*-
"""Proyectos y la importacion de su presupuesto.

El Excel se lee en el navegador; aqui llega la lista ya parseada. El servidor
no interpreta hojas de calculo: comprueba la cuenta y guarda.
"""

from decimal import Decimal, InvalidOperation

from django.db import transaction
from django.utils import timezone
from rest_framework import serializers, status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from .models import Proyecto, Partida, ActividadObra

# Cuanto se tolera entre la suma de las partidas y el costo directo que
# declara el Excel. Un sol de diferencia es redondeo; mas, es que falta una
# partida o se leyo otra columna.
TOLERANCIA = Decimal("1.00")


def _dec(v, por_defecto="0"):
    try:
        return Decimal(str(v if v not in (None, "") else por_defecto))
    except (InvalidOperation, ValueError):
        return Decimal(por_defecto)


class ProyectoSerializer(serializers.ModelSerializer):
    partidas = serializers.SerializerMethodField()
    actividades = serializers.SerializerMethodField()
    suma_partidas = serializers.SerializerMethodField()

    class Meta:
        model = Proyecto
        fields = ["id", "codigo", "nombre", "entidad", "ubicacion",
                  "fecha_inicio", "plazo_dias", "estado",
                  "costo_directo", "gastos_generales", "utilidad", "igv", "total",
                  "presupuesto_cargado", "created_at",
                  "partidas", "actividades", "suma_partidas"]

    def get_partidas(self, obj):
        return obj.partidas.filter(activo=True).count()

    def get_actividades(self, obj):
        return obj.actividades.count()

    def get_suma_partidas(self, obj):
        """Lo que suman las partidas de verdad.

        Se devuelve aparte del costo_directo declarado para que la pantalla
        pueda ensenar los dos y que se vea si dejan de cuadrar.
        """
        total = Decimal("0")
        for m, p in obj.partidas.filter(activo=True).values_list("metrado", "precio"):
            total += _dec(m) * _dec(p)
        return round(float(total), 2)


@api_view(["GET", "POST"])
@permission_classes([AllowAny])
def proyectos(request):
    if request.method == "GET":
        qs = Proyecto.objects.all()
        estado = request.query_params.get("estado")
        if estado:
            qs = qs.filter(estado=estado)
        return Response(ProyectoSerializer(qs, many=True).data)

    datos = dict(request.data)
    for k, v in list(datos.items()):
        if isinstance(v, list) and len(v) == 1:
            datos[k] = v[0]

    codigo = (datos.get("codigo") or "").strip()
    if not codigo:
        return Response({"detail": "Falta el código del proyecto."},
                        status=status.HTTP_400_BAD_REQUEST)
    if not (datos.get("nombre") or "").strip():
        return Response({"detail": "Falta el nombre del proyecto."},
                        status=status.HTTP_400_BAD_REQUEST)
    if Proyecto.objects.filter(codigo__iexact=codigo).exists():
        return Response({"detail": "Ya existe un proyecto con el código "
                                   "'{0}'.".format(codigo)},
                        status=status.HTTP_409_CONFLICT)

    ser = ProyectoSerializer(data=datos)
    if not ser.is_valid():
        return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)
    ser.save()
    return Response(ser.data, status=status.HTTP_201_CREATED)


@api_view(["GET", "PATCH", "DELETE"])
@permission_classes([AllowAny])
def proyecto_detalle(request, pk):
    try:
        pro = Proyecto.objects.get(pk=pk)
    except Proyecto.DoesNotExist:
        return Response({"detail": "No existe."}, status=status.HTTP_404_NOT_FOUND)

    if request.method == "GET":
        return Response(ProyectoSerializer(pro).data)

    if request.method == "DELETE":
        # Borrar un proyecto se lleva su presupuesto y sus actividades, y con
        # ellas los partes. Se dice cuanto ANTES, y solo se hace a proposito.
        n_p = pro.partidas.count()
        n_a = pro.actividades.count()
        if (n_p or n_a) and request.query_params.get("confirmar") != "si":
            return Response({
                "detail": "Este proyecto tiene {0} partida(s) y {1} actividad(es). "
                          "Borrarlo se lleva tambien los partes que cuelgan de "
                          "esas actividades. Si de verdad quieres borrarlo, "
                          "repite con ?confirmar=si".format(n_p, n_a),
                "partidas": n_p, "actividades": n_a,
            }, status=status.HTTP_409_CONFLICT)
        pro.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    ser = ProyectoSerializer(pro, data=request.data, partial=True)
    if not ser.is_valid():
        return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)
    ser.save()
    return Response(ser.data)


@api_view(["POST"])
@permission_classes([AllowAny])
def importar_presupuesto(request, pk):
    """Carga el presupuesto de un proyecto desde una lista ya parseada.

    Espera:
        {"partidas": [{"codigo","descripcion","unidad","metrado","precio",
                       "estructura","grupo","ruta"}, ...],
         "totales": {"costo_directo","gastos_generales","utilidad","igv","total"}}

    ES IDEMPOTENTE Y NO CAMBIA LOS IDS. Usa update_or_create sobre
    (proyecto, codigo). Si los ids cambiaran, las actividades ya imputadas
    quedarian apuntando a partidas equivocadas: el avance seguiria saliendo,
    solo que mal, que es la peor forma de fallar.

    Las partidas que ya no vienen NO se borran: se marcan activo=False. Al
    borrarlas, las lineas de parte que las usaran se quedarian sin partida y
    se perderia el enganche del avance.
    """
    try:
        pro = Proyecto.objects.get(pk=pk)
    except Proyecto.DoesNotExist:
        return Response({"detail": "No existe el proyecto."},
                        status=status.HTTP_404_NOT_FOUND)

    filas = request.data.get("partidas") or []
    totales = request.data.get("totales") or {}
    if not filas:
        return Response({"detail": "No llego ninguna partida."},
                        status=status.HTTP_400_BAD_REQUEST)

    # ── lo que haria imposible confiar en la carga ────────────────────────
    vistos = {}
    repetidos = []
    sin_unidad = []
    for f in filas:
        c = (f.get("codigo") or "").strip()
        if not c:
            return Response({"detail": "Hay una partida sin codigo."},
                            status=status.HTTP_400_BAD_REQUEST)
        if c in vistos:
            repetidos.append(c)
        vistos[c] = True
        if not (f.get("unidad") or "").strip():
            sin_unidad.append(c)

    if repetidos:
        return Response({
            "detail": "El archivo trae codigos repetidos: {0}. La segunda fila "
                      "pisaria a la primera y nadie se enteraria.".format(
                          ", ".join(sorted(set(repetidos))[:8])),
            "codigos": sorted(set(repetidos)),
        }, status=status.HTTP_400_BAD_REQUEST)

    if sin_unidad:
        return Response({
            "detail": "Hay {0} partida(s) sin unidad: {1}. Sin unidad no se "
                      "puede medir el avance.".format(
                          len(sin_unidad), ", ".join(sin_unidad[:8])),
            "codigos": sin_unidad,
        }, status=status.HTTP_400_BAD_REQUEST)

    # ── la cuenta tiene que cuadrar con lo que dice el Excel ──────────────
    suma = Decimal("0")
    for f in filas:
        suma += _dec(f.get("metrado")) * _dec(f.get("precio"))
    declarado = _dec(totales.get("costo_directo"))
    if declarado > 0 and abs(suma - declarado) > TOLERANCIA:
        return Response({
            "detail": "La suma de las partidas ({0}) no cuadra con el costo "
                      "directo del presupuesto ({1}). Diferencia: {2}. Falta "
                      "alguna partida o se leyo una columna que no era. NO se "
                      "cargo nada.".format(round(suma, 2), round(declarado, 2),
                                           round(abs(suma - declarado), 2)),
            "suma_partidas": float(round(suma, 2)),
            "costo_directo_declarado": float(round(declarado, 2)),
        }, status=status.HTTP_409_CONFLICT)

    # ── cargar ────────────────────────────────────────────────────────────
    import json as _json
    nuevas = 0
    actualizadas = 0
    codigos = set()
    with transaction.atomic():
        for f in filas:
            cod = (f.get("codigo") or "").strip()
            codigos.add(cod)
            _, creada = Partida.objects.update_or_create(
                proyecto_ref=pro, codigo=cod,
                defaults=dict(
                    obra=pro.codigo,
                    proyecto=pro.nombre[:300],
                    descripcion=(f.get("descripcion") or "").strip()[:300],
                    unidad=(f.get("unidad") or "").strip()[:12],
                    metrado=_dec(f.get("metrado")),
                    precio=_dec(f.get("precio")),
                    estructura=(f.get("estructura") or "").strip()[:200],
                    grupo=(f.get("grupo") or "").strip()[:200],
                    ruta=_json.dumps(f.get("ruta") or [], ensure_ascii=False),
                    activo=True,
                ))
            if creada:
                nuevas += 1
            else:
                actualizadas += 1

        sobrantes = pro.partidas.exclude(codigo__in=codigos)
        desactivadas = sobrantes.filter(activo=True).count()
        sobrantes.update(activo=False)

        pro.costo_directo = _dec(totales.get("costo_directo"))
        pro.gastos_generales = _dec(totales.get("gastos_generales"))
        pro.utilidad = _dec(totales.get("utilidad"))
        pro.igv = _dec(totales.get("igv"))
        pro.total = _dec(totales.get("total"))
        pro.presupuesto_cargado = timezone.now()
        pro.save()

    return Response({
        "ok": True,
        "nuevas": nuevas,
        "actualizadas": actualizadas,
        "desactivadas": desactivadas,
        "activas": pro.partidas.filter(activo=True).count(),
        "suma_partidas": float(round(suma, 2)),
        "proyecto": ProyectoSerializer(pro).data,
    })
'''

ANCLA_IMP = ("from .views_actividades_obra import (\n"
             "    actividades_obra, actividad_obra_detalle, actividades_obra_resumen,\n"
             ")\n")
NUEVO_IMP = (ANCLA_IMP +
             "from .views_proyectos import proyectos, proyecto_detalle, importar_presupuesto\n")

ANCLA_RUTA = ("    path('actividades-obra/<int:pk>/', actividad_obra_detalle,\n"
              "         name='actividad-obra-detalle'),\n")
NUEVA_RUTA = (ANCLA_RUTA +
              "    # Proyectos: se crean primero y se les importa su presupuesto\n"
              "    path('proyectos/', proyectos, name='proyectos'),\n"
              "    path('proyectos/<int:pk>/', proyecto_detalle, name='proyecto-detalle'),\n"
              "    path('proyectos/<int:pk>/presupuesto/', importar_presupuesto,\n"
              "         name='importar-presupuesto'),\n")


def principal():
    for f in (F_MODELS, F_URLS):
        if not os.path.isfile(f):
            print("No encuentro {0}.".format(f))
            sys.exit(1)

    txt_m = io.open(F_MODELS, encoding="utf-8").read()
    txt_u = io.open(F_URLS, encoding="utf-8").read()

    print("Carpeta: {0}".format(BASE))
    print("")
    print("=" * 78)
    print("El proyecto manda")
    print("=" * 78)
    print("")

    fallos = []
    if "class Proyecto(" in txt_m:
        fallos.append("models.py ya tiene class Proyecto: parece aplicado")
    if os.path.exists(F_VISTA):
        fallos.append("views_proyectos.py ya existe")
    if "views_proyectos" in txt_u:
        fallos.append("urls.py ya menciona views_proyectos")
    if "class ActividadObra" not in txt_m:
        fallos.append("falta ActividadObra: aplica antes parche_actividades_obra.py")

    # Se BUSCAN las dos 'obra', una por clase. No se supone su texto.
    b_par = bloque_obra(txt_m, "Partida")
    b_act = bloque_obra(txt_m, "ActividadObra")
    if b_par is None:
        fallos.append("no encuentro el campo 'obra' dentro de class Partida")
    if b_act is None:
        fallos.append("no encuentro el campo 'obra' dentro de class ActividadObra")
    for nombre, ancla in (("urls.py: import de actividades", ANCLA_IMP),
                          ("urls.py: ruta del detalle", ANCLA_RUTA)):
        if txt_u.count(ancla) != 1:
            fallos.append("{0}: el ancla aparece {1} veces (deberia ser 1)".format(
                nombre, txt_u.count(ancla)))

    if fallos:
        print("NO SE APLICA NADA:")
        for f in fallos:
            print("  - {0}".format(f))
        sys.exit(1)

    print("  operations/models.py")
    print("    + class Proyecto  (codigo unico, nombre, entidad, ubicacion,")
    print("                       fechas, estado, y los totales del pie:")
    print("                       costo directo, GG, utilidad, IGV, total)")
    print("    + Partida.proyecto_ref        -> Proyecto")
    print("    + ActividadObra.proyecto_ref  -> Proyecto")
    print("")
    print("    'obra' NO se quita. Hay consultas vivas que la usan y quitarla")
    print("    ahora las romperia en el mismo despliegue. Se retira cuando")
    print("    todo lea la clave, en un paso que se pueda probar solo.")
    print("")
    print("  operations/views_proyectos.py   [archivo nuevo]")
    print("    + GET/POST          proyectos/")
    print("    + GET/PATCH/DELETE  proyectos/<id>/")
    print("    + POST              proyectos/<id>/presupuesto/")
    print("")
    print("    La importacion recibe el Excel YA PARSEADO por el navegador, y")
    print("    se niega a cargar si: hay codigos repetidos, falta alguna")
    print("    unidad, o la suma de las partidas no cuadra con el costo")
    print("    directo que declara el Excel.")
    print("")
    print("  operations/urls.py")
    print("    + las tres rutas")
    print("")

    # De atras hacia delante, para que la primera sustitucion no mueva la
    # posicion de la segunda.
    nuevo_m = txt_m
    for (ini, fin, linea, sangria), rel, nota in (
            (b_act, "actividades", False), (b_par, "partidas", True)):
        nuevo_m = (nuevo_m[:ini] + clave_proyecto(sangria, rel, nota) +
                   linea + nuevo_m[fin:])
    nuevo_m = nuevo_m.rstrip("\n") + "\n" + MODELO
    nuevo_u = txt_u.replace(ANCLA_IMP, NUEVO_IMP, 1).replace(ANCLA_RUTA, NUEVA_RUTA, 1)

    for nombre, texto in (("models.py", nuevo_m), ("urls.py", nuevo_u),
                          ("views_proyectos.py", VISTA)):
        try:
            compile(texto.encode("utf-8"), nombre, "exec")
        except SyntaxError as e:
            print("NO SE ESCRIBE NADA: {0} no compilaria ({1}, linea {2}).".format(
                nombre, e.msg, e.lineno))
            sys.exit(1)
    print("Los tres archivos compilan.")

    if nuevo_m.count("proyecto_ref = models.ForeignKey") != 2:
        print("NO SE ESCRIBE NADA: deberian quedar 2 claves y hay {0}.".format(
            nuevo_m.count("proyecto_ref = models.ForeignKey")))
        sys.exit(1)
    if "related_name='partidas'" not in nuevo_m or \
       "related_name='actividades'" not in nuevo_m:
        print("NO SE ESCRIBE NADA: los related_name no quedaron bien.")
        sys.exit(1)
    print("Las dos claves quedan, una en Partida y otra en ActividadObra.")
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
    print("HAY MIGRACION. Mirala antes:")
    print("")
    print("  docker compose exec web python manage.py makemigrations operations")
    print("  docker compose exec web python manage.py sqlmigrate operations <numero>")
    print("")
    print("Tiene que ser un CREATE TABLE del proyecto y dos ADD COLUMN. Cero")
    print("DROP COLUMN, DROP TABLE o DELETE.")
    print("")
    print("  docker compose exec web python manage.py migrate")
    print("")
    print("Y DESPUES, para que lo que ya existe quede colgando de su proyecto:")
    print("")
    print("  docker compose exec -T web python manage.py shell < vincular_proyectos.py")
    print("")
    print("  docker compose up -d --no-deps --force-recreate web")
    print("=" * 78)


principal()
