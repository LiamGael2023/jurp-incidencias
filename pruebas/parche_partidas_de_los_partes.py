# -*- coding: utf-8 -*-
"""Las partidas de una actividad salen de sus partes, no de una declaracion.

    python3 parche_partidas_de_los_partes.py              # solo muestra
    python3 parche_partidas_de_los_partes.py --aplicar    # aplica, con respaldo
    docker compose up -d --no-deps --force-recreate web

NO HAY MIGRACION: cambia dos metodos del serializer.

POR QUE. Se habia hecho que la actividad DECLARARA sus partidas al crearla,
con un selector en escalera. Esta mal: el flujo de verdad es crear la
actividad, colgarle partes diarios, y en cada linea del parte elegir su
partida -selector que ya existia y funciona-. Declarar antes obliga a saber
de antemano lo que se va a tocar, que es justo lo que no se sabe.

Asi que la actividad no declara: ACUMULA. Sus partidas son aquellas a las
que sus partes han imputado metrado.

QUE CAMBIA.

  partidas_detalle   ya no sale del M2M sino de lo imputado por los partes
                     de ESTA actividad. Cada fila trae:
                       imputado   metrado de esta actividad (misma unidad)
                       valorizado imputado x precio
                       metrado    lo presupuestado de la partida en la obra
                       ejecutado  lo que lleva la partida en TODA la obra
                       saldo      metrado - ejecutado, de toda la obra

  presupuestado      desaparece como denominador y vale 0. Sin declaracion
                     no hay contra que medir el avance de UNA actividad: la
                     partida se reparte entre varias y ninguna sabe cuanto
                     le toca. Inventar un denominador daria porcentajes que
                     parecen buenos y no significan nada. Se deja el campo
                     para no romper a quien lo lea.

EL CAMPO 'partidas' (M2M) SE QUEDA donde esta y deja de usarse. Borrarlo es
una migracion destructiva y un segundo paso: si manana se quiere volver a
declarar -para comparar lo previsto con lo tocado- la tabla ya esta.

EL SALDO SIGUE SIENDO DE LA OBRA, no de la actividad. Si otra ya excavo 100
de los 173, aqui quedan 73 aunque esta no haya tocado ni uno. Un saldo
"propio" invitaria a pasarse del presupuesto entre varias sin que ninguna lo
notara.
"""

from __future__ import print_function

import datetime
import io
import os
import re
import shutil
import sys

BASE = "/root/proyectos/api_vigilantes"
F_VISTA = os.path.join(BASE, "operations", "views_actividades_obra.py")

APLICAR = "--aplicar" in sys.argv

NUEVO = '''    def get_partidas_detalle(self, obj):
        """Las partidas a las que ESTA actividad ha imputado metrado.

        No sale de una declaracion sino de los partes: una actividad no sabe
        de antemano todo lo que va a tocar, y obligarla a decirlo al crearla
        acaba en declaraciones que no se parecen a lo que se hizo.

        Cada fila mezcla dos cosas a proposito y por eso van con nombres
        distintos: 'imputado' y 'valorizado' son de esta actividad, mientras
        que 'metrado', 'ejecutado' y 'saldo' son de la partida en TODA la
        obra. El saldo de una partida no depende de quien se lo haya ido
        gastando, y ensenar uno "propio" invitaria a pasarse del presupuesto
        entre varias actividades sin que ninguna lo notara.

        Solo cuenta el metrado imputado en la MISMA unidad que la partida. Lo
        imputado en otra no se suma -daria un avance falso- pero tampoco se
        esconde: va en la cuenta de avance, que ya lo avisa.
        """
        from .models import DailyPartActivity

        partes = list(obj.partes.values_list("id", flat=True))
        if not partes:
            return []

        # Lo que imputo ESTA actividad, por partida y unidad.
        mio = {}
        for f in (DailyPartActivity.objects
                  .filter(parte_id__in=partes, partida__isnull=False)
                  .values("partida_id", "metrado_unidad")
                  .annotate(suma=Sum("metrado"))):
            mio.setdefault(f["partida_id"], {})[
                _normaliza(f["metrado_unidad"])] = float(f["suma"] or 0)

        if not mio:
            return []

        # Lo que lleva cada una de esas partidas en toda la obra.
        de_la_obra = {}
        for f in (DailyPartActivity.objects
                  .filter(partida_id__in=list(mio.keys()))
                  .values("partida_id", "metrado_unidad")
                  .annotate(suma=Sum("metrado"))):
            de_la_obra.setdefault(f["partida_id"], {})[
                _normaliza(f["metrado_unidad"])] = float(f["suma"] or 0)

        salida = []
        for p in Partida.objects.filter(id__in=list(mio.keys())).order_by("codigo"):
            u = _normaliza(p.unidad)
            total = float(p.metrado or 0)
            precio = float(p.precio or 0)
            imputado = mio.get(p.id, {}).get(u, 0.0)
            eje = de_la_obra.get(p.id, {}).get(u, 0.0)
            salida.append({
                "id": p.id,
                "codigo": p.codigo,
                "descripcion": p.descripcion,
                "unidad": p.unidad,
                "precio": precio,
                # de esta actividad
                "imputado": round(imputado, 4),
                "valorizado": round(imputado * precio, 2),
                # de la partida en toda la obra
                "metrado": total,
                "importe": round(total * precio, 2),
                "ejecutado": round(eje, 4),
                "saldo": round(total - eje, 4),
                "avance": round(eje / total * 100, 2) if total else None,
            })
        return salida

    def get_presupuestado(self, obj):
        """Siempre 0: una actividad no tiene presupuesto propio.

        La actividad ya no declara sus partidas, asi que no hay denominador
        contra el que medir SU avance: una partida se reparte entre varias
        actividades y ninguna sabe cuanto le toca. Inventar uno daria
        porcentajes que parecen buenos y no significan nada.

        Se deja el campo, devolviendo 0, para no romper a quien lo lea.
        """
        return 0
'''


def bloque(texto, nombre):
    """(inicio, fin) de un metodo del serializer, por sangria."""
    m = re.search(r"^    def " + re.escape(nombre) + r"\(self, obj\):", texto, re.M)
    if not m:
        return None
    sig = re.search(r"^    def \w+\(", texto[m.end():], re.M)
    fin = m.end() + sig.start() if sig else len(texto)
    return m.start(), fin


def principal():
    if not os.path.isfile(F_VISTA):
        print("No encuentro {0}.".format(F_VISTA))
        sys.exit(1)

    txt = io.open(F_VISTA, encoding="utf-8").read()

    print("")
    print("=" * 78)
    print("Las partidas salen de los partes, no de una declaracion")
    print("=" * 78)
    print("")
    print("Carpeta: {0}".format(BASE))
    print("")

    fallos = []
    if '"imputado"' in txt:
        fallos.append("ya esta aplicado: partidas_detalle ya trae 'imputado'")
    for nombre in ("get_partidas_detalle", "get_presupuestado"):
        if bloque(txt, nombre) is None:
            fallos.append("no encuentro {0}; ¿falta "
                          "parche_partidas_de_actividad.py?".format(nombre))
    for nombre in ("Partida", "Sum", "_normaliza"):
        if not re.search(r"\b" + re.escape(nombre) + r"\b", txt):
            fallos.append("views_actividades_obra.py no tiene {0}".format(nombre))

    if fallos:
        print("NO se puede aplicar:")
        for f in fallos:
            print("    - {0}".format(f))
        print("")
        sys.exit(1)

    a1, f1 = bloque(txt, "get_partidas_detalle")
    a2, f2 = bloque(txt, "get_presupuestado")
    if not (f1 <= a2):
        print("NO se puede aplicar: los dos metodos no estan seguidos.")
        print("Miralos a mano antes de tocar nada.")
        sys.exit(1)

    nuevo = txt[:a1] + NUEVO + txt[f2:]

    print("views_actividades_obra.py")
    print("    partidas_detalle sale de los partes de la actividad, no del M2M")
    print("        + imputado / valorizado : de ESTA actividad")
    print("        + metrado / ejecutado / saldo : de la partida en TODA la obra")
    print("    presupuestado devuelve 0: sin declaracion no hay denominador")
    print("")
    print("El campo 'partidas' (M2M) se queda y deja de usarse. Borrarlo es")
    print("una migracion destructiva y un segundo paso.")
    print("")

    if not APLICAR:
        print("Esto es solo la vista previa. Para aplicarlo:")
        print("    python3 {0} --aplicar".format(os.path.basename(__file__)))
        print("")
        return

    sello = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    resp = "{0}.bak_{1}".format(F_VISTA, sello)
    shutil.copy2(F_VISTA, resp)
    io.open(F_VISTA, "w", encoding="utf-8").write(nuevo)

    print("APLICADO")
    print("    {0}".format(os.path.basename(F_VISTA)))
    print("        respaldo: {0}".format(os.path.basename(resp)))
    print("")
    print("Recarga el servicio:")
    print("    cd {0}".format(BASE))
    print("    docker compose up -d --no-deps --force-recreate web")
    print("")


if __name__ == "__main__":
    principal()
