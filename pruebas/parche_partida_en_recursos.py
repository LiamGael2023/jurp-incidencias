# -*- coding: utf-8 -*-
"""La mano de obra y los materiales tambien se imputan a una partida.

    python3 parche_partida_en_recursos.py                 # solo mira
    python3 parche_partida_en_recursos.py --aplicar        # aplica
    python3 parche_partida_en_recursos.py --base /ruta     # si no autodetecta

QUE FALTABA. El parte de maquinaria elige partida; la mano de obra y los
insumos no tenian donde. Sus dos formularios -"Anadir Mano de Obra" y
"Anadir Insumo / Material"- guardaban fecha, cantidad y precio, y nada que
dijera a que parte del presupuesto pertenece ese gasto. Al valorizar, la
maquinaria se repartia por partidas y el resto quedaba en un monton suelto.

OJO CON LO QUE SIGNIFICA, QUE NO ES LO MISMO
============================================

A un equipo se le imputa METRADO: 120 m3 excavados contra la partida de
excavacion. Eso mide avance fisico, y de ahi sale el porcentaje.

A una persona y a un saco de cemento no se les puede imputar metrado: no lo
tienen. Lo que se les imputa es COSTO. Son dos cosas distintas y conviene no
mezclarlas nunca en la misma columna:

  - El avance de una partida sigue saliendo del metrado, como hasta ahora.
    Ocho horas de peon no adelantan la partida por si solas.
  - Lo que esto habilita es saber CUANTO COSTO cada partida, sumando su
    maquinaria, su gente y sus materiales.

Si se sumaran los dos en 'valorizado', una partida con mucha mano de obra y
poco avance pareceria ejecutada. Por eso el campo se anade, pero el calculo
del avance NO se toca.

EL CAMPO ES OPCIONAL, a proposito. Hay gasto que no cuelga de ninguna
partida -una guardiania, un flete general- y obligarlo llevaria a que
alguien eligiera cualquiera con tal de guardar, que es peor que no tener el
dato: un numero inventado no se distingue de uno real.

on_delete=SET_NULL y no CASCADE: borrar una partida no puede llevarse por
delante el registro de que alguien trabajo ocho horas. Se queda sin imputar,
que es la verdad.
"""

from __future__ import print_function

import datetime
import io
import os
import re
import shutil
import sys

CANDIDATOS = [
    "/var/www/envs/vigilantes",
    "/root/proyectos/api_vigilantes",
    os.getcwd(),
]

APLICAR = "--aplicar" in sys.argv

# (modelo, related_name que se le pone a Partida)
DESTINOS = [
    ("IncidentPersonnel", "personal_imputado"),
    ("IncidentMaterial", "materiales_imputados"),
]


def base_del_proyecto():
    if "--base" in sys.argv:
        return sys.argv[sys.argv.index("--base") + 1]
    for c in CANDIDATOS:
        if os.path.isfile(os.path.join(c, "operations", "models.py")):
            return c
    return None


CAMPO = '''
{0}# A QUE PARTIDA DEL PRESUPUESTO SE CARGA ESTE GASTO.
{0}#
{0}# OJO: aqui se imputa COSTO, no metrado. Un equipo mueve 120 m3 y eso
{0}# adelanta su partida; ocho horas de peon no adelantan nada por si
{0}# solas. El avance se sigue calculando con el metrado y este campo NO
{0}# entra en esa cuenta: si entrara, una partida con mucha mano de obra y
{0}# poco avance pareceria ejecutada.
{0}#
{0}# Opcional porque hay gasto que no cuelga de ninguna partida. Obligarlo
{0}# llevaria a elegir cualquiera con tal de guardar, y un numero inventado
{0}# no se distingue de uno real.
{0}#
{0}# SET_NULL y no CASCADE: borrar una partida no puede borrar el registro
{0}# de que alguien trabajo ocho horas. Se queda sin imputar, que es la
{0}# verdad.
{0}partida = models.ForeignKey(
{0}    "Partida", on_delete=models.SET_NULL, null=True, blank=True,
{0}    related_name="{1}", verbose_name="Partida del presupuesto")
'''


def bloque_clase(texto, clase):
    m = re.search(r"^class\s+" + re.escape(clase) + r"\s*\(", texto, re.M)
    if not m:
        return None
    sig = re.search(r"^class\s+\w+\s*\(", texto[m.end():], re.M)
    fin = m.end() + sig.start() if sig else len(texto)
    return (m.start(), fin)


def sangria_de(cuerpo):
    # [ \t]+ y no \s+: \s se come el salto y el campo sale entrelineado.
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
    """→ (texto_nuevo, [avisos]).  None = no se puede."""
    avisos = []
    ya = related_names_de_partida(texto)

    for clase, rel in DESTINOS:
        pos = bloque_clase(texto, clase)
        if not pos:
            return None, ["no encuentro class %s en models.py" % clase]
        ini, fin = pos
        cuerpo = texto[ini:fin]

        if re.search(r"^[ \t]+partida\s*=\s*models\.ForeignKey", cuerpo, re.M):
            avisos.append("ya estaba: %s.partida" % clase)
            continue

        if rel in ya:
            # El espejo de esto se llevo un fields.E304 en el servidor por
            # reusar un related_name. Se comprueba antes de escribir.
            return None, ["related_name=%r ya lo usa otro campo hacia Partida; "
                          "Django lo rechazaria (fields.E304)" % rel]
        ya.add(rel)

        campo = CAMPO.format(sangria_de(cuerpo), rel)
        m = re.search(r"^[ \t]+class\s+Meta\b", cuerpo, re.M)
        if m:
            nuevo = cuerpo[:m.start()] + campo.rstrip("\n") + "\n\n" + cuerpo[m.start():]
        else:
            nuevo = cuerpo.rstrip("\n") + "\n" + campo
        texto = texto[:ini] + nuevo + texto[fin:]
        avisos.append("anadido %s.partida" % clase)

    return texto, avisos


# ══════════════════════════════════════════════════════════════════════════
# los serializers
# ══════════════════════════════════════════════════════════════════════════

SERIALIZERS = [
    ("IncidentPersonnelSerializer", "IncidentPersonnel"),
    ("IncidentMaterialSerializer", "IncidentMaterial"),
]


def paso_serializer(texto):
    """Mete "partida" en Meta.fields de los dos serializers.

    Se busca el bloque de cada clase y dentro su lista de fields, en vez de
    un reemplazo global: los dos serializers viven en el mismo fichero y un
    reemplazo a ciegas pondria el campo en el primero dos veces.
    """
    avisos = []
    for clase, modelo in SERIALIZERS:
        m = re.search(r"^class\s+" + re.escape(clase) + r"\s*\(", texto, re.M)
        if not m:
            return None, ["no encuentro class %s" % clase]
        sig = re.search(r"^class\s+\w+\s*\(", texto[m.end():], re.M)
        fin = m.end() + sig.start() if sig else len(texto)
        cuerpo = texto[m.start():fin]

        if re.search(r"[\"']partida[\"']", cuerpo):
            avisos.append("ya estaba: partida en %s" % clase)
            continue

        f = re.search(r"fields\s*=\s*\[", cuerpo)
        if not f:
            # Un serializer con fields = "__all__" ya lo expone solo.
            if re.search(r"fields\s*=\s*[\"']__all__[\"']", cuerpo):
                avisos.append("%s usa __all__: ya lo expone" % clase)
                continue
            return None, ["no encuentro Meta.fields de %s" % clase]

        corte = m.start() + f.end()
        texto = texto[:corte] + '"partida", ' + texto[corte:]
        avisos.append("partida entra en %s" % clase)

    return texto, avisos


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
    f_ser = os.path.join(app, "serializers.py")

    print("proyecto: %s" % base)
    print("modo    : %s" % ("APLICAR" if APLICAR else "solo mostrar"))
    print("")

    for f in (f_models, f_ser):
        if not os.path.isfile(f):
            print("MAL  no encuentro %s" % f)
            return 1

    txt_m = io.open(f_models, encoding="utf-8").read()
    txt_s = io.open(f_ser, encoding="utf-8").read()

    nuevo_m, av_m = paso_modelo(txt_m)
    nuevo_s, av_s = paso_serializer(txt_s)

    print("1. models.py")
    for a in av_m:
        print("     %s" % a)
    print("2. serializers.py")
    for a in av_s:
        print("     %s" % a)
    print("")

    fallos = []
    if nuevo_m is None:
        fallos.append("models.py: %s" % "; ".join(av_m))
    if nuevo_s is None:
        fallos.append("serializers.py: %s" % "; ".join(av_s))

    if fallos:
        print("NO SE ESCRIBE NADA. A medias es peor que sin empezar:")
        for f in fallos:
            print("   - %s" % f)
        print("")
        print("Mandame esta salida y lo ajusto.")
        return 1

    # Se comprueba el RESULTADO, no la intencion.
    for clase, rel in DESTINOS:
        pos = bloque_clase(nuevo_m, clase)
        cuerpo = nuevo_m[pos[0]:pos[1]] if pos else ""
        if "partida = models.ForeignKey" not in cuerpo:
            print("NO SE ESCRIBE NADA: %s no salio con su campo." % clase)
            return 1
        if cuerpo.count("partida = models.ForeignKey") != 1:
            print("NO SE ESCRIBE NADA: %s salio con el campo repetido." % clase)
            return 1
    # Se cuenta POR SERIALIZER, no en todo el fichero. Exigir dos
    # ocurrencias daba un falso fallo cuando uno de los dos usa
    # fields = "__all__", que ya expone el campo sin tocarlo.
    for clase, _ in SERIALIZERS:
        m = re.search(r"^class\s+" + re.escape(clase) + r"\s*\(", nuevo_s, re.M)
        if not m:
            print("NO SE ESCRIBE NADA: desaparecio %s." % clase)
            return 1
        sig = re.search(r"^class\s+\w+\s*\(", nuevo_s[m.end():], re.M)
        cu = nuevo_s[m.start():m.end() + sig.start()] if sig else nuevo_s[m.start():]
        expone = re.search(r"[\"']partida[\"']", cu) or re.search(
            r"fields\s*=\s*[\"']__all__[\"']", cu)
        if not expone:
            print("NO SE ESCRIBE NADA: %s no expone partida." % clase)
            return 1
        if cu.count('"partida"') > 1:
            print("NO SE ESCRIBE NADA: %s lo expone repetido." % clase)
            return 1

    if not APLICAR:
        print("Nada tocado. Para aplicarlo:")
        print("    python3 %s --aplicar" % os.path.basename(__file__))
        return 0

    escritos = []
    for ruta, viejo, nuevo, nombre in ((f_models, txt_m, nuevo_m, "models.py"),
                                       (f_ser, txt_s, nuevo_s, "serializers.py")):
        if nuevo != viejo:
            print("respaldo %s" % respaldo(ruta))
            io.open(ruta, "w", encoding="utf-8").write(nuevo)
            escritos.append(nombre)

    print("")
    print("escrito: %s" % (", ".join(escritos) if escritos else "nada, ya estaba"))
    print("")
    print("Hay migracion -dos columnas nuevas, las dos NULL-:")
    print("    docker compose exec web python manage.py makemigrations operations")
    print("    docker compose exec web python manage.py migrate")
    print("    docker compose up -d --no-deps --force-recreate web")
    return 0


if __name__ == "__main__":
    sys.exit(principal())
