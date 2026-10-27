# -*- coding: utf-8 -*-
"""
Cada unidad declara QUE CASILLAS SE HABILITAN para calcular el metrado.

POR QUE HACE FALTA
------------------
En la hoja de metrados de JURP las columnas son:

    UNIDAD | CANTIDAD | LARGO | ANCHO | ALTURA | AREA | Coefi. | PARCIAL
          | N° ESTRUC. | TOTAL

y no todas se llenan siempre. En el Excel original estan pintadas de
amarillo, por fila, las que corresponden a cada unidad: m3 habilita largo,
ancho, altura y area; m2 habilita largo, ancho y area pero no altura; m solo
largo; y las demas -Gln, Und, Kg, H-H...- no habilitan ninguna dimension.

Eso NO es una decision de quien llena la hoja: es una propiedad de la unidad.
Un galon no tiene largo. Si la pantalla deja escribir un largo para galones,
alguien lo escribira y el parcial saldra multiplicado por un numero que no
significa nada. Por eso vive en el catalogo y no en el codigo del formulario:
el dia que JURP anada una unidad nueva, tambien tiene que poder decir como se
mide, sin tocar el front.

POR QUE m3 HABILITA ALTURA *Y* AREA
-----------------------------------
No es un descuido del Excel. Un volumen se saca de dos maneras segun lo que
se haya medido en campo: largo x ancho x altura, o bien area x altura cuando
el area venia medida de antes. Lo mismo m2: largo x ancho, o el area directa.
La hoja habilita las dos vias y quien mide usa la que tiene.

EL COEFICIENTE SIEMPRE VA
-------------------------
Esta en amarillo en las veinte filas. Es el factor de esponjamiento, de
desperdicio o de lo que toque, y aplica se mida como se mida. Por eso nace en
True para toda unidad, incluidas las que se creen mas adelante.

QUE TOCA
--------
    1. operations/models.py       cinco booleanos en Unidad
    2. operations/serializers.py  exponerlos
    3. el comando de siembra      ponerlos segun el Excel

USO
---
    python3 parche_unidades_dimensiones.py [--raiz /var/www/envs/vigilantes] [--dry-run]

Despues hay que migrar y volver a sembrar. La siembra NO pisa codigos ni
nombres que ya existan; solo corrige las casillas de las veinte unidades del
catalogo original, que es justo lo que falta.

Es idempotente. Deja .bak de cada archivo que modifica.
"""

import argparse
import os
import shutil
import sys


# ── 1. Los campos en el modelo ──────────────────────────────────────────────
# Se insertan ANTES de `activo`, para que queden juntos los que describen como
# se mide la unidad y separados del que dice si se ofrece o no.
MODELO_ANCLA = '''    activo = models.BooleanField("Activo", default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "Unidad de medida"'''

MODELO_NUEVO = '''    # Que casillas habilita esta unidad en la hoja de metrados. Un galon no
    # tiene largo: si el formulario lo deja escribir, alguien lo escribe y el
    # parcial sale multiplicado por un numero que no significa nada.
    usa_largo = models.BooleanField("Usa largo", default=False)
    usa_ancho = models.BooleanField("Usa ancho", default=False)
    usa_altura = models.BooleanField("Usa altura", default=False)
    # El area es una via alternativa, no un extra: m2 y m3 se pueden sacar de
    # largo x ancho o del area ya medida en campo.
    usa_area = models.BooleanField("Usa area", default=False)
    # El coeficiente aplica se mida como se mida: esponjamiento, desperdicio,
    # lo que toque. Nace activo para toda unidad.
    usa_coeficiente = models.BooleanField("Usa coeficiente", default=True)
    activo = models.BooleanField("Activo", default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "Unidad de medida"'''


# ── 2. El serializer ────────────────────────────────────────────────────────
SER_ANCLA = '''        fields = ["id", "codigo", "nombre", "activo"]'''

SER_NUEVO = '''        fields = ["id", "codigo", "nombre",
                  "usa_largo", "usa_ancho", "usa_altura", "usa_area",
                  "usa_coeficiente", "activo"]'''


# ── 3. La siembra, con las casillas del Excel ───────────────────────────────
SIEMBRA = """# -*- coding: utf-8 -*-
\"\"\"Siembra el catalogo de unidades con las del Excel de JURP.

Crea las que falten y, para las veinte del catalogo original, deja las
casillas de medida como estan pintadas de amarillo en el Excel. NO toca
codigos ni nombres de las que ya existen: si alguien corrigio un nombre a
mano, volver a sembrar no se lo pisa.
\"\"\"

from django.core.management.base import BaseCommand

from operations.models import Unidad

# codigo, nombre, largo, ancho, altura, area
#
# El coeficiente no esta en la tabla porque va en TODAS: esta en amarillo en
# las veinte filas del Excel y es el default del modelo.
#
# m3 habilita altura Y area a proposito: un volumen sale de largo x ancho x
# altura, o de area x altura cuando el area venia medida de antes. Igual m2.
UNIDADES = [
    ("m3",   "Metro Cubico",   True,  True,  True,  True),
    ("m2",   "Metro Cuadrado", True,  True,  False, True),
    ("m",    "Metro Lineal",   True,  False, False, False),
    ("Gln",  "Galon",          False, False, False, False),
    ("Und",  "Unidad",         False, False, False, False),
    ("Kg",   "Kilogramo",      False, False, False, False),
    ("Bls",  "Bolsa",          False, False, False, False),
    ("H-H",  "Hora-Hombre",    False, False, False, False),
    ("H-M",  "Hora-Maquina",   False, False, False, False),
    ("Glb",  "Global",         False, False, False, False),
    ("Tn",   "Tonelada",       False, False, False, False),
    ("Lt",   "Litro",          False, False, False, False),
    ("Km",   "Kilometro",      False, False, False, False),
    ("Pza",  "Pieza",          False, False, False, False),
    ("Rll",  "Rollo",          False, False, False, False),
    ("Pulg", "Pulgada",        False, False, False, False),
    ("Est",  "Estacion",       False, False, False, False),
    ("Via",  "Viaje",          False, False, False, False),
    ("Mes",  "Mes",            False, False, False, False),
    ("Dia",  "Dia",            False, False, False, False),
]


class Command(BaseCommand):
    help = "Crea las unidades que falten y fija sus casillas de medida."

    def handle(self, *args, **opciones):
        creadas = 0
        ajustadas = 0
        for codigo, nombre, largo, ancho, altura, area in UNIDADES:
            # iexact: si ya existe "M3" no se crea otra "m3" al lado.
            u = Unidad.objects.filter(codigo__iexact=codigo).first()
            if u is None:
                Unidad.objects.create(
                    codigo=codigo, nombre=nombre, activo=True,
                    usa_largo=largo, usa_ancho=ancho, usa_altura=altura,
                    usa_area=area, usa_coeficiente=True)
                creadas += 1
                continue
            # Ya existia: se le corrigen SOLO las casillas de medida. El
            # codigo y el nombre se respetan por si alguien los ajusto.
            cambios = []
            for campo, valor in (("usa_largo", largo), ("usa_ancho", ancho),
                                 ("usa_altura", altura), ("usa_area", area),
                                 ("usa_coeficiente", True)):
                if getattr(u, campo) != valor:
                    setattr(u, campo, valor)
                    cambios.append(campo)
            if cambios:
                u.save()
                ajustadas += 1
        self.stdout.write(self.style.SUCCESS(
            "Unidades: %d creadas, %d ajustadas, %d en total."
            % (creadas, ajustadas, Unidad.objects.count())))
"""


def leer(ruta):
    with open(ruta, 'r') as f:
        return f.read()


def escribir(ruta, texto, simulacro):
    if simulacro:
        return
    shutil.copy2(ruta, ruta + '.bak')
    with open(ruta, 'w') as f:
        f.write(texto)


def paso_reemplazo(raiz, relativo, marca, ancla, nuevo, simulacro):
    ruta = os.path.join(raiz, relativo)
    if not os.path.exists(ruta):
        return False, 'no existe {0}'.format(ruta)
    t = leer(ruta)
    if marca in t:
        return True, 'ya estaba'
    if t.count(ancla) != 1:
        return False, ('esperaba el ancla una vez y aparece {0}'
                       .format(t.count(ancla)))
    escribir(ruta, t.replace(ancla, nuevo, 1), simulacro)
    return True, 'anadido'


def paso_siembra(raiz, simulacro):
    """Reescribe el comando de siembra con las casillas del Excel."""
    ruta = os.path.join(raiz, 'operations/management/commands/sembrar_unidades.py')
    if not os.path.exists(ruta):
        return False, 'no existe {0}; aplica antes parche_unidades.py'.format(ruta)
    if 'usa_largo' in leer(ruta):
        return True, 'ya estaba'
    escribir(ruta, SIEMBRA, simulacro)
    return True, 'siembra actualizada'


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--raiz', default='/var/www/envs/vigilantes')
    p.add_argument('--dry-run', action='store_true')
    args = p.parse_args()

    pasos = [
        ('modelo', lambda: paso_reemplazo(
            args.raiz, 'operations/models.py', 'usa_coeficiente',
            MODELO_ANCLA, MODELO_NUEVO, args.dry_run)),
        ('serializer', lambda: paso_reemplazo(
            args.raiz, 'operations/serializers.py', 'usa_coeficiente',
            SER_ANCLA, SER_NUEVO, args.dry_run)),
        ('siembra', lambda: paso_siembra(args.raiz, args.dry_run)),
    ]

    fallo = False
    for nombre, fn in pasos:
        ok, detalle = fn()
        print('[{0}] {1}: {2}'.format('OK ' if ok else 'MAL', nombre, detalle))
        if not ok:
            fallo = True

    if fallo:
        print('\nNO se aplico todo. Revisa lo marcado como MAL antes de seguir.')
        sys.exit(1)
    if args.dry_run:
        print('\nSimulacro: no se escribio nada.')
        return

    print('\nFalta la migracion y volver a sembrar:')
    print('  docker compose exec -T web python manage.py makemigrations operations')
    print('  docker compose exec -T web python manage.py migrate')
    print('  docker compose exec -T web python manage.py sembrar_unidades')


if __name__ == '__main__':
    main()
