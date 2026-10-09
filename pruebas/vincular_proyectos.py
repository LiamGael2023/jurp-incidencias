# -*- coding: utf-8 -*-
"""Lo que ya existe pasa a colgar de su proyecto.

    docker compose exec -T web python manage.py shell < vincular_proyectos.py

Se ejecuta DESPUES de migrar parche_proyectos.py.

QUE HACE. Hasta ahora el proyecto era un texto repetido en cada partida
(Partida.obra = 'Obras10_6'). Esto crea un Proyecto por cada texto distinto y
apunta hacia el las partidas y las actividades que lo llevaban.

ES IDEMPOTENTE: correrlo dos veces no duplica proyectos ni cambia ids. Y NO
BORRA NADA: el texto 'obra' se queda donde esta, como espejo, hasta que todo
el codigo lea la clave.

El nombre largo del proyecto se toma de Partida.proyecto, que es donde lo
dejo el cargador del Excel. Si no hubiera ninguno, se usa el propio codigo y
se avisa para que alguien lo corrija a mano.
"""

from __future__ import print_function

from decimal import Decimal

from operations.models import Proyecto, Partida, ActividadObra

print("")
print("=" * 72)
print("VINCULAR LO EXISTENTE A SU PROYECTO")
print("=" * 72)

obras = sorted(set(
    list(Partida.objects.values_list("obra", flat=True).distinct()) +
    list(ActividadObra.objects.values_list("obra", flat=True).distinct())
))
obras = [o for o in obras if (o or "").strip()]

if not obras:
    print("  No hay ninguna obra que vincular. Nada que hacer.")
else:
    print("  Obras encontradas: {0}".format(", ".join(obras)))
print("")

for obra in obras:
    # El nombre largo vive en Partida.proyecto; si no, se usa el codigo.
    nombre = ""
    p = Partida.objects.filter(obra=obra).exclude(proyecto="").first()
    if p:
        nombre = p.proyecto
    sin_nombre = not nombre
    if sin_nombre:
        nombre = obra

    pro, creado = Proyecto.objects.get_or_create(
        codigo=obra, defaults={"nombre": nombre[:300]})

    # Las partidas que aun no apuntan a nadie.
    n_part = Partida.objects.filter(obra=obra, proyecto_ref__isnull=True).update(
        proyecto_ref=pro)
    n_act = ActividadObra.objects.filter(obra=obra,
                                         proyecto_ref__isnull=True).update(
        proyecto_ref=pro)

    # El costo directo, solo si todavia no lo tiene: no se pisa un numero que
    # alguien haya podido corregir a mano.
    if not pro.costo_directo:
        suma = Decimal("0")
        for m, pr in pro.partidas.filter(activo=True).values_list("metrado", "precio"):
            suma += (m or Decimal("0")) * (pr or Decimal("0"))
        if suma:
            pro.costo_directo = round(suma, 2)
            pro.save(update_fields=["costo_directo"])

    print("  {0}".format(obra))
    print("      proyecto      : {0}  (id {1})".format(
        "CREADO" if creado else "ya existia", pro.id))
    print("      nombre        : {0}".format(pro.nombre[:60]))
    if sin_nombre:
        print("      OJO: no habia nombre largo en ninguna partida; se uso el")
        print("           codigo. Corrigelo desde la pantalla de Proyectos.")
    print("      partidas vinculadas   : {0}".format(n_part))
    print("      actividades vinculadas: {0}".format(n_act))
    print("      costo directo : S/ {0:,.2f}".format(float(pro.costo_directo or 0)))
    print("")

print("=" * 72)
print("COMPROBACION")
print("=" * 72)
sueltas_p = Partida.objects.filter(proyecto_ref__isnull=True).count()
sueltas_a = ActividadObra.objects.filter(proyecto_ref__isnull=True).count()
print("  partidas sin proyecto    : {0}".format(sueltas_p))
print("  actividades sin proyecto : {0}".format(sueltas_a))
print("  proyectos               : {0}".format(Proyecto.objects.count()))
if sueltas_p or sueltas_a:
    print("")
    print("  Quedan registros sueltos. Suele ser que su 'obra' esta vacia.")
    print("  Miralos antes de usar el selector, porque no apareceran en")
    print("  ningun proyecto:")
    for x in Partida.objects.filter(proyecto_ref__isnull=True)[:5]:
        print("      partida {0}  obra='{1}'  codigo={2}".format(x.id, x.obra, x.codigo))
    for x in ActividadObra.objects.filter(proyecto_ref__isnull=True)[:5]:
        print("      actividad {0}  obra='{1}'  {2}".format(x.id, x.obra, x.nombre[:40]))
else:
    print("")
    print("  Todo colgando de su proyecto.")
print("")
print("El texto 'obra' se queda donde esta: todavia hay consultas que lo usan.")
