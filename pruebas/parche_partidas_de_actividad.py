# -*- coding: utf-8 -*-
"""Una actividad dice QUE partidas del presupuesto ejecuta.

    python3 parche_partidas_de_actividad.py              # solo muestra
    python3 parche_partidas_de_actividad.py --aplicar    # aplica, con respaldo
    docker compose exec web python manage.py makemigrations operations
    docker compose exec web python manage.py migrate operations

POR QUE. Hoy una actividad se crea con nombre, zona y fechas, y nada mas. Las
partidas aparecen mucho despues, una a una, cuando alguien las apunta en un
parte diario. Eso tiene dos consecuencias feas:

  1. Una actividad recien creada no sabe cuanto tiene que hacer, asi que no
     se puede decir si va al 10% o al 90%. Solo se sabe lo que lleva, que no
     es lo mismo.
  2. El que llena el parte elige entre las 83 partidas del presupuesto
     enteras. Si la actividad es "Excavacion de la caja de derivacion", las
     unicas partidas razonables son tres, y las otras ochenta son ocasiones
     de equivocarse.

Con esto la actividad lleva sus partidas desde que se crea, y las dos cosas
se arreglan solas: hay un presupuestado contra el que medir, y el parte tiene
de donde elegir sin salirse.

QUE SE GUARDA. Solo el VINCULO: que partidas toca esta actividad. NO se
guarda un metrado programado por actividad, porque no existe -el Excel
programa por partida, no por actividad- e inventarlo seria comparar contra un
numero que nadie puso.

QUE CAMBIA.

  models.py
    + ActividadObra.partidas   M2M a Partida
                               related_name='actividades_obra' (el otro,
                               'actividades', ya lo usa
                               DailyPartActivity.partida)
                               blank=True: una actividad sin partidas se
                               sigue pudiendo guardar

  views_actividades_obra.py
    + el serializer devuelve 'partidas' (ids), 'presupuestado' (suma de
      metrado x precio) y 'partidas_detalle': cada partida con su metrado
      presupuestado, lo ejecutado hasta hoy, el saldo y el % de avance
    + POST y PATCH aceptan {"partidas": [id, id, ...]}
    + se comprueba que todas sean del MISMO proyecto de la actividad: colgar
      una partida de otra obra daria un avance que suma dos presupuestos

LA MIGRACION ES UNA TABLA NUEVA. Un M2M no toca ninguna columna existente:
crea operations_actividadobra_partidas con dos claves. Nada que ya este
guardado cambia ni se mueve.
"""

from __future__ import print_function

import datetime
import io
import os
import re
import shutil
import sys

BASE = "/root/proyectos/api_vigilantes"
APP = os.path.join(BASE, "operations")
F_MODELS = os.path.join(APP, "models.py")
F_VISTA = os.path.join(APP, "views_actividades_obra.py")

APLICAR = "--aplicar" in sys.argv


# ═══════════════════════════════════════════════════════════════════════════
#  models.py
# ═══════════════════════════════════════════════════════════════════════════

CAMPO = '''
{0}# Las partidas del presupuesto que esta actividad ejecuta.
{0}#
{0}# Es M2M porque las dos direcciones son de varios: una actividad suele
{0}# tocar varias partidas (excavar, refinar, eliminar material), y una
{0}# partida se reparte entre varias actividades (la misma excavacion se
{0}# hace en la caja y en el aliviadero).
{0}#
{0}# blank=True a proposito: una actividad sin partidas se guarda igual.
{0}# Obligarlas acabaria en que se elige cualquiera con tal de poder
{0}# guardar, que es peor que no tener ninguna.
{0}#
{0}# Se guarda solo el vinculo, no un metrado programado por actividad: el
{0}# Excel programa por partida y repartirlo entre actividades seria un
{0}# numero inventado contra el que luego se compararia el avance.
{0}#
{0}# related_name='actividades_obra' y no 'actividades': ese ya lo usa
{0}# DailyPartActivity.partida, y Django lo rechaza con fields.E304.
{0}# Se descubrio aplicandolo en el servidor porque el mock de la prueba
{0}# no llevaba ese related_name. El mock ya lo lleva.
{0}partidas = models.ManyToManyField(
{0}    "Partida", blank=True, related_name="actividades_obra",
{0}    verbose_name="Partidas del presupuesto")
'''


def bloque_clase(texto, clase):
    """Devuelve (inicio, fin) del cuerpo de una clase.

    Se busca asi y no por un trozo de texto literal porque models.py ya ha
    sido parcheado otras veces y los campos no estan donde estaban.
    """
    m = re.search(r"^class\s+" + re.escape(clase) + r"\s*\(", texto, re.M)
    if not m:
        return None
    ini = m.start()
    sig = re.search(r"^class\s+\w+\s*\(", texto[m.end():], re.M)
    fin = m.end() + sig.start() if sig else len(texto)
    return ini, fin


def parche_modelo(texto):
    pos = bloque_clase(texto, "ActividadObra")
    if not pos:
        return None, "no encuentro class ActividadObra en models.py"
    ini, fin = pos
    cuerpo = texto[ini:fin]

    if re.search(r"^\s*partidas\s*=\s*models\.ManyToManyField", cuerpo, re.M):
        return None, "ActividadObra ya tiene el campo partidas"

    # Un related_name repetido no se nota al escribir el fichero: se nota al
    # migrar, con un fields.E304 y la app entera sin arrancar. Mejor aqui.
    if re.search(r'related_name\s*=\s*["\']actividades_obra["\']', texto):
        return None, ("ya hay un related_name='actividades_obra' en models.py; "
                      "elige otro antes de aplicar o Django rechazara la app")

    # Se cuelga detras de fecha_fin, que es el ultimo campo de datos antes de
    # created_at y de Meta.
    f = re.search(r"^([ \t]*)fecha_fin\s*=\s*models\.DateField\([^\n]*\)\s*$",
                  cuerpo, re.M)
    if not f:
        return None, "no encuentro el campo fecha_fin dentro de ActividadObra"

    corte = f.end()
    nuevo = cuerpo[:corte] + CAMPO.format(f.group(1)) + cuerpo[corte:]
    return texto[:ini] + nuevo + texto[fin:], None


# ═══════════════════════════════════════════════════════════════════════════
#  views_actividades_obra.py
# ═══════════════════════════════════════════════════════════════════════════

SER_ANCLA = """class ActividadObraSerializer(serializers.ModelSerializer):
    partes = serializers.SerializerMethodField()
    avance = serializers.SerializerMethodField()
"""
SER_NUEVO = """class ActividadObraSerializer(serializers.ModelSerializer):
    partes = serializers.SerializerMethodField()
    avance = serializers.SerializerMethodField()
    # Las partidas viajan dos veces y no es redundancia: 'partidas' son los
    # ids, que es lo que el formulario manda de vuelta, y 'partidas_detalle'
    # es lo que hace falta para pintar la ficha sin pedir el presupuesto
    # entero por cada actividad de la lista.
    partidas_detalle = serializers.SerializerMethodField()
    presupuestado = serializers.SerializerMethodField()
"""

CAMPOS_ANCLA = """                  "fecha_fin", "created_at", "partes", "avance"]
"""
CAMPOS_NUEVO = """                  "fecha_fin", "created_at", "partes", "avance",
                  "partidas", "partidas_detalle", "presupuestado"]
"""

METODOS_ANCLA = """    def get_partes(self, obj):
        return obj.partes.count()
"""
METODOS_NUEVO = '''    def get_partes(self, obj):
        return obj.partes.count()

    def get_partidas_detalle(self, obj):
        """Cada partida con lo presupuestado, lo hecho y lo que queda.

        EL EJECUTADO ES DE TODA LA OBRA, no solo de esta actividad. El saldo
        de una partida no depende de quien se lo haya ido gastando: si otra
        actividad ya excavo 100 de los 173, aqui quedan 73 aunque esta no
        haya tocado ni uno. Ensenar un saldo "propio" invitaria a pasarse del
        presupuesto entre varias actividades sin que ninguna lo notara.

        Solo suma el metrado imputado en la MISMA unidad que la partida. Lo
        imputado en otra no se suma -daria un avance falso- pero tampoco se
        esconde: va en la cuenta de avance, que ya lo avisa.
        """
        from .models import DailyPartActivity

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
        """Lo que esta actividad tiene que hacer, al precio del presupuesto.

        Es el denominador del avance. Sin esto solo se sabe lo que lleva
        hecho, que no dice si va al 10% o al 90%.
        """
        total = 0.0
        for m, pr in obj.partidas.all().values_list("metrado", "precio"):
            total += float(m or 0) * float(pr or 0)
        return round(total, 2)
'''

# ── Sum, para el ejecutado ─────────────────────────────────────────────────
IMP_ANCLA = "from django.db.models import Count, Q\n"
IMP_NUEVO = "from django.db.models import Count, Q, Sum\n"

# ── el alta ────────────────────────────────────────────────────────────────
POST_ANCLA = """    ser = ActividadObraSerializer(data=datos)
    if not ser.is_valid():
        return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)
    ser.save(proyecto_ref=pro)
"""
POST_NUEVO = """    mal = _partidas_de_otro(datos.get("partidas"), obra)
    if mal:
        return Response({"detail": mal}, status=status.HTTP_400_BAD_REQUEST)

    ser = ActividadObraSerializer(data=datos)
    if not ser.is_valid():
        return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)
    ser.save(proyecto_ref=pro)
"""

# ── la comprobacion, que se usa en el alta y en la edicion ─────────────────
AYUDA_ANCLA = """def _normaliza(u):
    u = (u or "").strip().lower()
    return u.replace("\\u00b3", "3").replace("\\u00b2", "2")
"""
AYUDA_NUEVO = '''def _normaliza(u):
    u = (u or "").strip().lower()
    return u.replace("\\u00b3", "3").replace("\\u00b2", "2")


def _partidas_de_otro(ids, obra):
    """Devuelve el aviso si alguna partida no es de esta obra; si no, None.

    Colgar una partida de otro proyecto no da un error visible: da un avance
    que suma dos presupuestos y parece correcto. Por eso se corta aqui.
    """
    if not ids:
        return None
    try:
        ids = [int(x) for x in ids]
    except (TypeError, ValueError):
        return "Las partidas tienen que venir como ids."

    encontradas = dict(Partida.objects.filter(id__in=ids)
                       .values_list("id", "obra"))
    faltan = [str(i) for i in ids if i not in encontradas]
    if faltan:
        return "No existen estas partidas: {0}.".format(", ".join(faltan))

    ajenas = sorted(set(o for i, o in encontradas.items() if o != obra))
    if ajenas:
        return ("Hay partidas de otro proyecto ({0}). Sumarlas daria un "
                "avance que mezcla dos presupuestos.".format(", ".join(ajenas)))
    return None
'''


def parche_vista(texto):
    faltan = []
    for nombre, ancla in (("el import de django.db.models", IMP_ANCLA),
                          ("la cabecera del serializer", SER_ANCLA),
                          ("la lista de campos", CAMPOS_ANCLA),
                          ("get_partes", METODOS_ANCLA),
                          ("_normaliza", AYUDA_ANCLA),
                          ("el alta", POST_ANCLA)):
        n = texto.count(ancla)
        if n != 1:
            faltan.append("{0} aparece {1} veces, esperaba 1".format(nombre, n))
    if faltan:
        return None, faltan

    t = texto.replace(IMP_ANCLA, IMP_NUEVO, 1)
    t = t.replace(SER_ANCLA, SER_NUEVO, 1)
    t = t.replace(CAMPOS_ANCLA, CAMPOS_NUEVO, 1)
    t = t.replace(METODOS_ANCLA, METODOS_NUEVO, 1)
    t = t.replace(AYUDA_ANCLA, AYUDA_NUEVO, 1)
    t = t.replace(POST_ANCLA, POST_NUEVO, 1)

    # ── la edicion ────────────────────────────────────────────────────────
    # El PATCH se busca en vez de escribirlo literal: la vista de detalle ha
    # cambiado de forma mas de una vez.
    m = re.search(
        r"^([ \t]*)ser\s*=\s*ActividadObraSerializer\(\s*act\s*,[^\n]*\n"
        r"(?:[ \t]*[^\n]*\n)*?[ \t]*ser\.save\(\)\s*$", t, re.M)
    if not m:
        return None, ["no encuentro el PATCH (ActividadObraSerializer(act, ...))"]
    sangria = m.group(1)
    guardia = (
        "{0}mal = _partidas_de_otro(request.data.get(\"partidas\"), act.obra)\n"
        "{0}if mal:\n"
        "{0}    return Response({{\"detail\": mal}},\n"
        "{0}                    status=status.HTTP_400_BAD_REQUEST)\n"
    ).format(sangria)
    t = t[:m.start()] + guardia + t[m.start():]
    return t, None


# ═══════════════════════════════════════════════════════════════════════════

def principal():
    for f in (F_MODELS, F_VISTA):
        if not os.path.isfile(f):
            print("No encuentro {0}.".format(f))
            sys.exit(1)

    txt_m = io.open(F_MODELS, encoding="utf-8").read()
    txt_v = io.open(F_VISTA, encoding="utf-8").read()

    print("")
    print("=" * 78)
    print("Una actividad dice que partidas ejecuta")
    print("=" * 78)
    print("")
    print("Carpeta: {0}".format(BASE))
    print("")

    nuevo_m, motivo_m = parche_modelo(txt_m)
    nuevo_v, motivo_v = parche_vista(txt_v)

    fallos = []
    if nuevo_m is None:
        fallos.append("models.py: {0}".format(motivo_m))
    if nuevo_v is None:
        for x in (motivo_v or []):
            fallos.append("views_actividades_obra.py: {0}".format(x))

    if fallos:
        print("NO se puede aplicar:")
        for f in fallos:
            print("    - {0}".format(f))
        print("")
        print("Si ya estaba aplicado, no hay nada que hacer.")
        print("")
        sys.exit(1)

    print("models.py")
    print("    + ActividadObra.partidas  -> M2M a Partida")
    print("      related_name='actividades_obra', blank=True")
    print("")
    print("views_actividades_obra.py")
    print("    + el serializer devuelve partidas, presupuestado y")
    print("      partidas_detalle, con metrado, ejecutado, saldo y avance")
    print("      de cada una")
    print("    + POST y PATCH aceptan {\"partidas\": [id, ...]}")
    print("    + se rechazan las partidas de otro proyecto")
    print("")
    print("La migracion crea UNA TABLA NUEVA (operations_actividadobra_partidas).")
    print("No toca ninguna columna de lo que ya existe.")
    print("")

    if not APLICAR:
        print("Esto es solo la vista previa. Para aplicarlo:")
        print("    python3 {0} --aplicar".format(os.path.basename(__file__)))
        print("")
        return

    sello = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    for ruta, nuevo in ((F_MODELS, nuevo_m), (F_VISTA, nuevo_v)):
        resp = "{0}.bak_{1}".format(ruta, sello)
        shutil.copy2(ruta, resp)
        io.open(ruta, "w", encoding="utf-8").write(nuevo)
        print("    {0}".format(os.path.basename(ruta)))
        print("        respaldo: {0}".format(os.path.basename(resp)))

    print("")
    print("APLICADO. Ahora la migracion:")
    print("")
    print("    cd {0}".format(BASE))
    print("    docker compose exec web python manage.py makemigrations operations")
    print("    docker compose exec web python manage.py migrate operations")
    print("    docker compose up -d --no-deps --force-recreate web")
    print("")
    print("Mira la migracion antes de aplicarla: tiene que ser un solo")
    print("CreateModel/AddField de un M2M. Si sale un AlterField o un")
    print("RemoveField, para y dilo: eso no es de este parche.")
    print("")


if __name__ == "__main__":
    principal()
