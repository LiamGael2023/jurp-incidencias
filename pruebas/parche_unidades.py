# -*- coding: utf-8 -*-
"""
Catalogo de unidades de medida, guardado en el servidor.

POR QUE HACE FALTA
------------------
El boton «gestionar» que ya existia en la ventana de costeo no guardaba
nada: `catUnidades` era una lista de siete unidades escrita en el codigo de
React y viva solo en la memoria del navegador. Lo que alguien anadia o
borraba desaparecia al recargar y jamas llegaba al servidor. Era un
mantenedor aparente, y de los peores: el que parece funcionar.

QUE TOCA
--------
    1. operations/models.py       el modelo Unidad
    2. operations/serializers.py  UnidadSerializer
    3. operations/views.py        UnidadViewSet
    4. operations/urls.py         la ruta en el router

Sigue el patron de Cargo, que ya estaba resuelto ahi mismo. Copiar lo que
funciona cuesta menos de mantener que inventar una forma distinta para lo
mismo.

DOS DECISIONES DE DISENO
------------------------
NO SE BORRAN, SE DESACTIVAN. Una partida vieja puede estar usando "m3"; si
la unidad desaparece del catalogo, esa partida queda apuntando a algo que ya
no existe y nadie sabe que significaba. Un DELETE pone activo=False: deja de
ofrecerse para lo nuevo y lo viejo se sigue entendiendo.

EL CODIGO SE RESPETA TAL CUAL SE ESCRIBE. El front pasaba todo a minusculas
al anadir, y eso convierte "H-H" en "h-h" y "Glb" en "glb". El codigo viaja
a los informes y al Excel, asi que se guarda como lo escribio quien lo creo.
Lo que si se comprueba es que no haya dos que solo se distingan por las
mayusculas: "M3" y "m3" conviviendo son una trampa para el que luego elija.

USO
---
    python3 parche_unidades.py [--raiz /var/www/envs/vigilantes] [--dry-run]

Despues hay que crear y aplicar la migracion, y sembrar el catalogo. El
propio script lo recuerda al terminar.

Es idempotente: si ya esta aplicado lo dice y no toca nada. Deja .bak de
cada archivo que modifica.
"""

import argparse
import os
import shutil
import sys


MODELO = '''

class Unidad(models.Model):
    """Catalogo de unidades de medida.

    El CODIGO es la clave real: es lo que se guarda hoy en el campo `unidad`
    de las partidas y lo que sale impreso. El nombre existe para poder leerlo
    sin saberselo de memoria -"H-H" no le dice nada a quien no lo usa a
    diario-.
    """

    codigo = models.CharField("Codigo", max_length=20, unique=True)
    nombre = models.CharField("Nombre", max_length=120, blank=True, default="")
    activo = models.BooleanField("Activo", default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "Unidad de medida"
        verbose_name_plural = "Unidades de medida"
        ordering = ["codigo"]

    def __str__(self):
        return self.codigo

    def save(self, *args, **kwargs):
        # Solo se recortan los espacios. NO se pasa a minusculas: el codigo
        # viaja a los informes tal cual, y "H-H" no es "h-h".
        if self.codigo:
            self.codigo = self.codigo.strip()
        if self.nombre:
            self.nombre = self.nombre.strip()
        super().save(*args, **kwargs)
'''

SERIALIZER = '''

from .models import Unidad  # noqa: E402  (catalogo de unidades)


class UnidadSerializer(serializers.ModelSerializer):
    class Meta:
        model = Unidad
        fields = ["id", "codigo", "nombre", "activo"]

    def validate_codigo(self, valor):
        v = (valor or "").strip()
        if not v:
            raise serializers.ValidationError("El codigo es obligatorio.")
        # iexact y no exact: dos unidades que solo se distinguen por las
        # mayusculas son una trampa para quien luego tenga que elegir una.
        qs = Unidad.objects.filter(codigo__iexact=v)
        if self.instance is not None:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError("Ya existe una unidad con ese codigo.")
        return v
'''

VISTA = '''

from .models import Unidad  # noqa: E402  (catalogo de unidades)
from .serializers import UnidadSerializer  # noqa: E402


class UnidadViewSet(viewsets.ModelViewSet):
    """Catalogo de unidades de medida (m3, H-H, Glb...)."""

    queryset = Unidad.objects.all().order_by("codigo")
    serializer_class = UnidadSerializer

    def get_queryset(self):
        qs = super(UnidadViewSet, self).get_queryset()
        activo = (self.request.query_params.get("activo") or "").lower()
        if activo in ("true", "1"):
            qs = qs.filter(activo=True)
        elif activo in ("false", "0"):
            qs = qs.filter(activo=False)
        return qs

    def destroy(self, request, *args, **kwargs):
        """Borrar DESACTIVA, no elimina.

        Las partidas guardan el codigo de la unidad como texto, no una
        relacion. Si la fila desaparece, esas partidas quedan mostrando un
        codigo que ya no esta en ningun catalogo y nadie puede comprobar que
        significaba. Desactivar la quita de los desplegables sin romper nada
        de lo ya escrito.
        """
        from rest_framework.response import Response
        from rest_framework import status as http

        obj = self.get_object()
        obj.activo = False
        obj.save()
        return Response(self.get_serializer(obj).data, status=http.HTTP_200_OK)
'''

RUTA_ANCLA = "router.register(r'cargos', CargoViewSet, basename='cargos')"

RUTA_NUEVA = RUTA_ANCLA + """

# Catalogo de unidades de medida. Import aparte, para no tocar el bloque de
# imports de arriba y arriesgar un conflicto con otro parche.
from .views import UnidadViewSet  # noqa: E402
router.register(r'unidades', UnidadViewSet, basename='unidades')"""


SIEMBRA = """# -*- coding: utf-8 -*-
\"\"\"Siembra el catalogo de unidades con las del Excel de JURP.

Idempotente: la unidad que ya existe NO se toca. Si alguien corrigio un
nombre a mano, volver a sembrar no se lo pisa.
\"\"\"

from django.core.management.base import BaseCommand

from operations.models import Unidad

# Codigo tal y como lo escribio JURP. No se normaliza: "H-H" y "Glb" salen
# impresos asi en los informes.
UNIDADES = [
    ("m3", "Metro Cubico"),
    ("m2", "Metro Cuadrado"),
    ("m", "Metro Lineal"),
    ("Gln", "Galon"),
    ("Und", "Unidad"),
    ("Kg", "Kilogramo"),
    ("Bls", "Bolsa"),
    ("H-H", "Hora-Hombre"),
    ("H-M", "Hora-Maquina"),
    ("Glb", "Global"),
    ("Tn", "Tonelada"),
    ("Lt", "Litro"),
    ("Km", "Kilometro"),
    ("Pza", "Pieza"),
    ("Rll", "Rollo"),
    ("Pulg", "Pulgada"),
    ("Est", "Estacion"),
    ("Via", "Viaje"),
    ("Mes", "Mes"),
    ("Dia", "Dia"),
]


class Command(BaseCommand):
    help = "Crea las unidades de medida que falten en el catalogo."

    def handle(self, *args, **opciones):
        creadas = 0
        for codigo, nombre in UNIDADES:
            # iexact: si ya existe "M3" no se crea otra "m3" al lado.
            if Unidad.objects.filter(codigo__iexact=codigo).exists():
                continue
            Unidad.objects.create(codigo=codigo, nombre=nombre, activo=True)
            creadas += 1
        self.stdout.write(self.style.SUCCESS(
            "Unidades: %d creadas, %d en total." % (creadas, Unidad.objects.count())))
"""


def paso_siembra(raiz, simulacro):
    """Deja el comando de siembra dentro de la app."""
    carpeta = os.path.join(raiz, 'operations/management/commands')
    ruta = os.path.join(carpeta, 'sembrar_unidades.py')
    if not os.path.isdir(carpeta):
        return False, 'no existe {0}'.format(carpeta)
    if os.path.exists(ruta):
        return True, 'ya estaba'
    if not simulacro:
        with open(ruta, 'w') as f:
            f.write(SIEMBRA)
    return True, 'comando creado'


def leer(ruta):
    with open(ruta, 'r') as f:
        return f.read()


def escribir(ruta, texto, simulacro):
    if simulacro:
        return
    shutil.copy2(ruta, ruta + '.bak')
    with open(ruta, 'w') as f:
        f.write(texto)


def paso_simple(raiz, relativo, marca, anadido, simulacro):
    """Anade un bloque al final del archivo, si no estaba ya."""
    ruta = os.path.join(raiz, relativo)
    if not os.path.exists(ruta):
        return False, 'no existe {0}'.format(ruta)
    t = leer(ruta)
    if marca in t:
        return True, 'ya estaba'
    escribir(ruta, t.rstrip('\n') + '\n' + anadido, simulacro)
    return True, 'anadido'


def paso_urls(raiz, simulacro):
    ruta = os.path.join(raiz, 'operations/urls.py')
    if not os.path.exists(ruta):
        return False, 'no existe {0}'.format(ruta)
    t = leer(ruta)
    if 'UnidadViewSet' in t:
        return True, 'ya estaba'
    if RUTA_ANCLA not in t:
        return False, 'no encuentro el registro de cargos en el router'
    escribir(ruta, t.replace(RUTA_ANCLA, RUTA_NUEVA, 1), simulacro)
    return True, 'ruta anadida'


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--raiz', default='/var/www/envs/vigilantes')
    p.add_argument('--dry-run', action='store_true')
    args = p.parse_args()

    pasos = [
        ('modelo', lambda: paso_simple(args.raiz, 'operations/models.py',
                                       'class Unidad(', MODELO, args.dry_run)),
        ('serializer', lambda: paso_simple(args.raiz, 'operations/serializers.py',
                                           'class UnidadSerializer(', SERIALIZER, args.dry_run)),
        ('vista', lambda: paso_simple(args.raiz, 'operations/views.py',
                                      'class UnidadViewSet(', VISTA, args.dry_run)),
        ('urls', lambda: paso_urls(args.raiz, args.dry_run)),
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

    print('\nFalta la migracion y la siembra:')
    print('  docker compose exec -T web python manage.py makemigrations operations')
    print('  docker compose exec -T web python manage.py migrate')
    print('  docker compose exec -T web python manage.py sembrar_unidades')


if __name__ == '__main__':
    main()
