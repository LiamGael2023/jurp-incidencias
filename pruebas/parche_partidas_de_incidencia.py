# -*- coding: utf-8 -*-
"""Una incidencia dice QUE partidas del presupuesto ejecuta.

    python3 parche_partidas_de_incidencia.py                 # solo muestra
    python3 parche_partidas_de_incidencia.py --aplicar       # aplica, con respaldo
    python3 parche_partidas_de_incidencia.py --base /ruta    # si no autodetecta

    docker exec django_api python manage.py makemigrations operations
    docker exec django_api python manage.py migrate operations
    docker compose up -d --no-deps --force-recreate web

POR QUE. Al costear una incidencia, el selector de partidas ofrece el
presupuesto ENTERO de la empresa. Se ve en pantalla: una incidencia de la
Canoa 8 del Canal Lateral 10 ofreciendo partidas de la TOMA 10.5, que es
otra obra. El front intenta acotarlo por proyecto -`?obra=` si el sujeto lo
trae-, pero una incidencia no tiene proyecto: nace de un canal, no de una
obra presupuestada. Asi que el filtro no se aplica nunca y baja todo.

Elegir entre ochenta y tres partidas de cinco obras distintas para imputar un
metrado no es una molestia: es una ocasion de equivocarse en cada parte
diario, y el error se descubre al valorizar, cuando ya hay cien partes.

QUE SE ARREGLA. La incidencia lleva sus partidas desde arriba: se eligen una
vez al abrir el costeo, y a partir de ahi el parte diario elige SOLO entre
ellas. De paso hay un presupuestado contra el que medir, que hoy no existe:
hoy solo se sabe lo que se lleva gastado, que no dice si va al 10 % o al 90 %.

QUE SE GUARDA. Solo el VINCULO: que partidas toca esta incidencia. NO un
metrado programado propio, por la misma razon que en las actividades: el
Excel programa por partida, y repartir ese numero entre incidencias seria
inventar un denominador contra el que luego se compara el avance. El
presupuestado de cada partida ya viene del presupuesto.

QUE CAMBIA.

  models.py
    + IncidentReport.partidas   M2M a Partida, related_name='incidencias',
                                blank=True

  el serializer de IncidentReport
    + 'partidas' (ids), 'partidas_detalle' (cada una con su metrado
      presupuestado, lo ejecutado en TODA la obra, el saldo y el avance) y
      'presupuestado'
    + POST y PATCH aceptan {"partidas": [id, id, ...]}

LA MIGRACION ES UNA TABLA NUEVA. Un M2M no toca ninguna columna existente:
crea operations_incidentreport_partidas con dos claves. Nada de lo que ya
esta guardado cambia ni se mueve, y una incidencia sin partidas se sigue
guardando igual.

ESTE PARCHE ES EL ESPEJO de parche_partidas_de_actividad.py, que hace lo
mismo para ActividadObra. Se escribio aparte y no se generalizo a proposito:
son dos modelos en dos ficheros distintos y un parche que intenta servir para
los dos acaba sin aplicarse en ninguno.
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
    for b in CANDIDATOS:
        if os.path.isdir(os.path.join(b, "operations")):
            return b
    return None


def leer(ruta):
    with io.open(ruta, "r", encoding="utf-8") as f:
        return f.read()


def escribir(ruta, texto):
    copia = "%s.bak-%s" % (ruta, datetime.datetime.now().strftime("%Y%m%d-%H%M%S"))
    shutil.copy2(ruta, copia)
    with io.open(ruta, "w", encoding="utf-8") as f:
        f.write(texto)
    return copia


def buscar_fichero(app, patron):
    """El .py de la app donde aparece `patron`. None si en ninguno."""
    for nombre in sorted(os.listdir(app)):
        if not nombre.endswith(".py"):
            continue
        ruta = os.path.join(app, nombre)
        try:
            if re.search(patron, leer(ruta), re.M):
                return ruta
        except (IOError, UnicodeDecodeError):
            continue
    return None


def bloque_clase(texto, clase):
    """(inicio, fin) del cuerpo de una clase.

    Se localiza asi y no por un trozo literal porque estos ficheros ya han
    sido parcheados otras veces y nada esta donde estaba.
    """
    m = re.search(r"^class\s+" + re.escape(clase) + r"\s*\(", texto, re.M)
    if not m:
        return None
    sig = re.search(r"^class\s+\w+\s*\(", texto[m.end():], re.M)
    return m.start(), (m.end() + sig.start() if sig else len(texto))


# ═══════════════════════════════════════════════════════════════════════════
#  1. El campo en el modelo
# ═══════════════════════════════════════════════════════════════════════════

CAMPO = '''
{0}# Las partidas del presupuesto que esta incidencia ejecuta.
{0}#
{0}# Es M2M porque las dos direcciones son de varios: una incidencia suele
{0}# tocar varias partidas (limpiar, encofrar, vaciar), y una partida se
{0}# reparte entre varias incidencias (la misma excavacion en dos canoas).
{0}#
{0}# blank=True a proposito: una incidencia sin partidas se guarda igual.
{0}# Obligarlas acabaria en que se elige cualquiera con tal de poder
{0}# guardar, que es peor que no tener ninguna.
{0}#
{0}# Se guarda solo el vinculo, no un metrado programado por incidencia: el
{0}# Excel programa por partida, y repartirlo seria inventar el
{0}# denominador contra el que luego se mide el avance.
{0}#
{0}# related_name='incidencias': 'actividades' lo usa
{0}# DailyPartActivity.partida y 'actividades_obra' lo usa ActividadObra,
{0}# y repetir uno lo rechaza Django con fields.E304.
{0}partidas = models.ManyToManyField(
{0}    "Partida", blank=True, related_name="incidencias",
{0}    verbose_name="Partidas del presupuesto")
'''


def parche_modelo(texto):
    pos = bloque_clase(texto, "IncidentReport")
    if not pos:
        return None, "no encuentro class IncidentReport en models.py"
    ini, fin = pos
    cuerpo = texto[ini:fin]
    if re.search(r"^\s*partidas\s*=\s*models\.ManyToManyField", cuerpo, re.M):
        return texto, "ya estaba: IncidentReport.partidas"

    # La sangria, de la primera linea con contenido del cuerpo.
    #
    # [ \t]+ y no \s+: con MULTILINE, \s+ se come tambien los saltos de
    # linea, asi que la "sangria" capturada era "\n    " y el campo salia con
    # una linea en blanco entre cada linea del comentario.
    m = re.search(r"^([ \t]+)\S", cuerpo[cuerpo.index("\n"):], re.M)
    sangria = m.group(1) if m else "    "

    # Antes de class Meta si la hay; si no, al final del cuerpo.
    mm = re.search(r"^\s+class\s+Meta\b", cuerpo, re.M)
    corte = mm.start() if mm else len(cuerpo.rstrip())
    nuevo = cuerpo[:corte] + CAMPO.format(sangria) + "\n" + cuerpo[corte:]
    return texto[:ini] + nuevo + texto[fin:], "anadido IncidentReport.partidas"


# ═══════════════════════════════════════════════════════════════════════════
#  2. El serializer
# ═══════════════════════════════════════════════════════════════════════════

METODOS = '''
    def get_partidas_detalle(self, obj):
        """Cada partida con lo presupuestado, lo hecho y lo que queda.

        EL EJECUTADO ES DE TODA LA OBRA, no solo de esta incidencia. El saldo
        de una partida no depende de quien se lo haya ido gastando: si otra
        incidencia ya excavo 100 de los 173, aqui quedan 73 aunque esta no
        haya tocado ni uno. Ensenar un saldo "propio" invitaria a pasarse del
        presupuesto entre varias incidencias sin que ninguna lo notara.

        Solo suma el metrado imputado en la MISMA unidad que la partida. Lo
        imputado en otra no se suma -daria un avance falso- pero tampoco se
        esconde: el front ya avisa de esos descuadres.
        """
        from django.db.models import Sum
        from .models import DailyPartActivity

        partidas = list(obj.partidas.all().order_by("codigo"))
        if not partidas:
            return []

        def norm(u):
            return (u or "").strip().lower().replace(".", "")

        hecho = {}
        filas = (DailyPartActivity.objects
                 .filter(partida_id__in=[p.id for p in partidas])
                 .values("partida_id", "metrado_unidad")
                 .annotate(suma=Sum("metrado")))
        for f in filas:
            hecho.setdefault(f["partida_id"], {})[
                norm(f["metrado_unidad"])] = float(f["suma"] or 0)

        salida = []
        for p in partidas:
            total = float(p.metrado or 0)
            eje = hecho.get(p.id, {}).get(norm(p.unidad), 0.0)
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
        gastado, que no dice si va al 10 % o al 90 %.
        """
        total = 0.0
        for m, pr in obj.partidas.all().values_list("metrado", "precio"):
            total += float(m or 0) * float(pr or 0)
        return round(total, 2)
'''


def parche_serializer(texto, clase):
    pos = bloque_clase(texto, clase)
    if not pos:
        return None, "no encuentro class %s" % clase
    ini, fin = pos
    cuerpo = texto[ini:fin]
    if "partidas_detalle" in cuerpo:
        return texto, "ya estaba: %s" % clase

    # a) los dos SerializerMethodField, justo tras la linea del class
    corte = cuerpo.index("\n") + 1
    # Saltar el docstring de la clase si lo hay, para no meterse dentro.
    resto = cuerpo[corte:]
    doc = re.match(r"(\s*(?:\"\"\"|''').*?(?:\"\"\"|''')\s*\n)", resto, re.S)
    if doc:
        corte += doc.end()
    campos = ('    partidas_detalle = serializers.SerializerMethodField()\n'
              '    presupuestado = serializers.SerializerMethodField()\n')
    cuerpo = cuerpo[:corte] + campos + cuerpo[corte:]

    # b) los nombres en Meta.fields
    m = re.search(r"fields\s*=\s*(\[|\()", cuerpo)
    if not m:
        return None, "%s no declara Meta.fields como lista" % clase
    cierre = ']' if m.group(1) == '[' else ')'
    fin_lista = cuerpo.index(cierre, m.end())
    cuerpo = (cuerpo[:fin_lista]
              + ', "partidas", "partidas_detalle", "presupuestado"'
              + cuerpo[fin_lista:])

    # c) los metodos, al final de la clase
    cuerpo = cuerpo.rstrip() + "\n" + METODOS
    return texto[:ini] + cuerpo + texto[fin:], "parcheado %s" % clase


# ═══════════════════════════════════════════════════════════════════════════
#  Principal
# ═══════════════════════════════════════════════════════════════════════════

def main():
    base = base_del_proyecto()
    if not base:
        print("No encuentro la carpeta del proyecto. Pasala con --base /ruta")
        print("Probe en: %s" % ", ".join(CANDIDATOS))
        return 1
    app = os.path.join(base, "operations")
    print("proyecto: %s" % base)
    print("modo    : %s" % ("APLICAR" if APLICAR else "solo mostrar"))
    print("")

    pasos = []

    f_models = os.path.join(app, "models.py")
    if not os.path.isfile(f_models):
        print("No existe %s" % f_models)
        return 1
    nuevo, nota = parche_modelo(leer(f_models))
    if nuevo is None:
        print("MAL  models.py: %s" % nota)
        return 1
    pasos.append((f_models, nuevo, nota))

    # El serializer puede estar en cualquier fichero de la app.
    f_ser = buscar_fichero(app, r"^class\s+IncidentReportSerializer\s*\(")
    clase = "IncidentReportSerializer"
    if not f_ser:
        # Algunos proyectos lo llaman de otra forma; se busca por el modelo.
        f_ser = buscar_fichero(app, r"model\s*=\s*IncidentReport\b")
        if f_ser:
            m = re.search(r"^class\s+(\w+)\s*\([^)]*Serializer[^)]*\)",
                          leer(f_ser), re.M)
            clase = m.group(1) if m else clase
    if not f_ser:
        print("MAL  no encuentro el serializer de IncidentReport en %s" % app)
        print("     Dime como se llama su fichero y lo ajusto.")
        return 1

    nuevo, nota = parche_serializer(leer(f_ser), clase)
    if nuevo is None:
        print("MAL  %s: %s" % (os.path.basename(f_ser), nota))
        return 1
    pasos.append((f_ser, nuevo, nota))

    for ruta, _, nota in pasos:
        print("  %-28s %s" % (os.path.basename(ruta), nota))

    if not APLICAR:
        print("")
        print("Nada tocado. Para aplicarlo:")
        print("    python3 %s --aplicar" % os.path.basename(__file__))
        return 0

    print("")
    for ruta, texto, nota in pasos:
        if nota.startswith("ya estaba"):
            continue
        copia = escribir(ruta, texto)
        print("  escrito %s  (respaldo: %s)" % (ruta, os.path.basename(copia)))

    print("")
    print("AHORA LA MIGRACION, que es una tabla nueva y no toca nada existente:")
    print("    docker exec django_api python manage.py makemigrations operations")
    print("    docker exec django_api python manage.py migrate operations")
    print("    docker compose up -d --no-deps --force-recreate web")
    print("")
    print("Y para comprobar que el endpoint lo devuelve:")
    print("    curl -s .../api/v1/mobile/operations/incidents/<id>/ | head -c 400")
    return 0


if __name__ == "__main__":
    sys.exit(main())
