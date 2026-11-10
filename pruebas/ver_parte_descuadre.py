# -*- coding: utf-8 -*-
"""¿Por qué el mismo parte sale con dos cifras distintas?

    cd /root/proyectos/api_vigilantes
    curl -sO https://raw.githubusercontent.com/LiamGael2023/jurp-incidencias/main/pruebas/ver_parte_descuadre.py
    PARTE=PD-0193-20260921 docker compose exec -e PARTE web \
        python manage.py shell < ver_parte_descuadre.py

Sin `PARTE` revisa TODOS los partes y lista los que no cuadran.

NO TOCA NADA. Solo mira y compara.

QUÉ ESTÁ PASANDO
----------------
Las dos pantallas que enseñan un parte no leen lo mismo:

  ficha de maquinaria     el historial del endpoint `/modelos/<id>/partes/`,
                          que manda `horas` del parte -la CABECERA-.
  costeo y PDF            las ACTIVIDADES del parte, una línea por tarea,
                          cada una con su tramo de horómetro, sus horas
                          muertas y sus horas efectivas.

Mientras un parte tiene una sola actividad y ninguna hora muerta las dos
cifras coinciden y nadie nota que son dos caminos. En cuanto alguien
descuenta horas muertas -o añade una segunda actividad- la cabecera se
queda con lo viejo y la ficha de maquinaria cobra de más.

Eso no es un fallo de pintado: es el mismo parte valiendo dos cifras según
desde dónde se mire, y una de ellas acaba en una valorización.

QUÉ IMPRIME
-----------
Para cada parte que no cuadre: lo que dice la cabecera, lo que suman sus
actividades, y la diferencia en horas y en soles. Con eso se decide si hace
falta recalcular las cabeceras guardadas, cambiar el endpoint para que
sume las actividades, o las dos cosas.
"""
from __future__ import print_function

import os

from django.apps import apps

M = apps.get_model("operations", "DailyPartHeavyEquipment")
A = apps.get_model("operations", "DailyPartActivity")

BUSCADO = (os.environ.get("PARTE") or "").strip()


def num(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return 0.0


def campos_de(modelo):
    return {f.name for f in modelo._meta.get_fields() if hasattr(f, "attname")}


CM = campos_de(M)
CA = campos_de(A)


def horas_cabecera(p):
    """Lo que la cabecera dice que se cobra, con el nombre que tenga."""
    for c in ("horas_efectivas", "horas", "effective_hours"):
        if c in CM:
            v = getattr(p, c, None)
            if v not in (None, ""):
                return num(v), c
    return 0.0, "(ninguno)"


def horas_actividades(p):
    """Lo que suman sus actividades: tramo, muertas y efectivas."""
    act = list(A.objects.filter(**{rel: p}))
    tramo = muertas = efect = 0.0
    for a in act:
        ini, fin = num(getattr(a, "start_horometer", 0)), num(getattr(a, "end_horometer", 0))
        t = max(0.0, fin - ini) if (ini or fin) else 0.0
        he = num(getattr(a, "horas_efectivas", None))
        tramo += t
        efect += he
        muertas += max(0.0, t - he)
    return len(act), tramo, muertas, efect


# Cómo se llama la relación de la actividad con su parte: cambia según cómo
# se declarara el ForeignKey, y adivinarlo mal daría cero actividades y un
# descuadre inventado en todos los partes.
rel = None
for f in A._meta.get_fields():
    if getattr(f, "related_model", None) is M:
        rel = f.name
        break
if rel is None:
    print("\n    NO encuentro el ForeignKey de la actividad al parte.")
    print("    Mira los campos de DailyPartActivity y dime cuál es:")
    print("    %s" % sorted(CA))
    raise SystemExit(1)

print("")
print("=" * 74)
print("DESCUADRE ENTRE LA CABECERA DEL PARTE Y SUS ACTIVIDADES")
print("=" * 74)
print("    relacion actividad -> parte: '%s'" % rel)
def lista_horas(campos):
    # `or` dentro del % se aplicaria a la cadena ya formateada, que siempre
    # es cierta: el "ninguno" no saldria nunca.
    nombres = sorted(c for c in campos if "hora" in c or "hour" in c)
    return ", ".join(nombres) if nombres else "ninguno"


print("    campos de horas en la cabecera:  %s" % lista_horas(CM))
print("    campos de horas en la actividad: %s" % lista_horas(CA))

qs = M.objects.all()
if BUSCADO:
    qs = qs.filter(part_number=BUSCADO)
    if not qs.exists():
        print("\n    No existe ningun parte con numero '%s'." % BUSCADO)
        raise SystemExit(1)

descuadrados = []
revisados = 0
sin_actividades = 0

for p in qs.order_by("-id")[:5000]:
    revisados += 1
    cab, campo = horas_cabecera(p)
    n, tramo, muertas, efect = horas_actividades(p)
    if n == 0:
        sin_actividades += 1
        continue
    if abs(cab - efect) > 0.005:
        descuadrados.append((p, campo, cab, n, tramo, muertas, efect))

if BUSCADO:
    p = qs.first()
    cab, campo = horas_cabecera(p)
    n, tramo, muertas, efect = horas_actividades(p)
    print("")
    print("    PARTE %s" % p.part_number)
    print("    " + "-" * 56)
    print("    cabecera · %-16s %8.2f h   <- lo que ve la ficha de maquinaria"
          % (campo, cab))
    print("    actividades (%d):" % n)
    print("        tramo de horometro        %8.2f h" % tramo)
    print("        horas muertas             %8.2f h" % muertas)
    print("        horas efectivas           %8.2f h   <- lo que ve el PDF y el costeo"
          % efect)
    print("")
    for a in A.objects.filter(**{rel: p}):
        ini, fin = num(getattr(a, "start_horometer", 0)), num(getattr(a, "end_horometer", 0))
        print("        #%s  HM %s-%s  tramo %.2f  HE %.2f  motivo: %s"
              % (a.id, ini, fin, max(0.0, fin - ini),
                 num(getattr(a, "horas_efectivas", 0)),
                 (getattr(a, "obs_reduccion", "") or "-")[:40]))
    print("")
    if abs(cab - efect) > 0.005:
        print("    DESCUADRA en %.2f h." % (cab - efect))
        print("    La cabecera cobra de mas: la ficha de maquinaria multiplica")
        print("    %.2f h por el precio en vez de %.2f h." % (cab, efect))
    else:
        print("    Cuadra: las dos pantallas dirian lo mismo.")
    raise SystemExit(0)

print("")
print("    partes revisados ........... %s" % revisados)
print("    sin actividades ............ %s  (nada que comparar)" % sin_actividades)
print("    DESCUADRADOS ............... %s" % len(descuadrados))

if not descuadrados:
    print("")
    print("    Ninguno. Cabecera y actividades dicen lo mismo en todos.")
    raise SystemExit(0)

# LOS DOS DESCUADRES NO SON EL MISMO PROBLEMA, y contarlos juntos da un
# titular falso. Si las actividades suman CERO, lo que pasa es que son
# anteriores a que existiera `horas_efectivas` por linea: la cabecera tiene
# la cifra buena y no sobra nada. El descuadre de verdad es cuando las
# actividades SI tienen horas y aun asi no coinciden con la cabecera.
sin_horas = [x for x in descuadrados if x[6] <= 0.005]
de_verdad = [x for x in descuadrados if x[6] > 0.005]

print("")
print("    de esos:")
print("      actividades sin horas (la cabecera manda) ... %s" % len(sin_horas))
print("      las dos tienen horas y NO coinciden ......... %s" % len(de_verdad))
if sin_horas and not de_verdad:
    print("")
    print("    Ninguno descuadra de verdad. Los %s son partes cuyas"
          % len(sin_horas))
    print("    actividades no llevan horas efectivas; ahi la cabecera es la")
    print("    unica fuente y nadie cobra de mas por esto.")

print("")
print("    %-24s %6s %6s %6s %8s  %s"
      % ("PARTE", "CABEC", "EFECT", "DIFER", "ACTIVID", "FECHA"))
horas_de_mas = 0.0
for p, campo, cab, n, tramo, muertas, efect in (de_verdad or descuadrados)[:40]:
    if efect > 0.005:
        horas_de_mas += (cab - efect)
    fecha = getattr(p, "part_date", None) or getattr(p, "fecha", "") or ""
    print("    %-24s %6.2f %6.2f %6.2f %8d  %s"
          % (p.part_number, cab, efect, cab - efect, n, fecha))

if len(descuadrados) > 40:
    print("    ... y %d mas" % (len(descuadrados) - 40))

print("")
if horas_de_mas > 0.005:
    print("    diferencia acumulada en los de arriba: %.2f h" % horas_de_mas)
    print("")
    print("    Esos si habria que mirarlos uno a uno: cabecera y actividades")
    print("    dicen cosas distintas y las dos tienen datos.")
else:
    print("    Sin diferencia que valga: en todos los de arriba las")
    print("    actividades no llevan horas, asi que no hay dos cifras que")
    print("    comparar. La cabecera es la buena.")
