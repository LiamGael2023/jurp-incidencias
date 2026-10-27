# -*- coding: utf-8 -*-
"""
Comando para cuadrar las unidades de las partidas con el catalogo.

POR QUE HACE FALTA
------------------
Los presupuestos entran por Excel y cada Excel escribe la unidad a su
manera. En los de JURP conviven, para la misma cosa:

    glb   gbl   Glb        mes   Mes        gls   Gln
    m2    m²    M2         m3    m³

Hasta ahora la unidad era texto libre, asi que nada lo impedia. Ahora el
catalogo decide que casillas se habilitan al medir -largo, ancho, altura,
area-, y una partida en "gbl" no cuadra con ninguna entrada del catalogo:
no es que se vea feo, es que el sistema no sabe como se mide.

TRES CASOS, Y SOLO DOS SE ARREGLAN SOLOS
----------------------------------------
1. IGUAL AL CATALOGO            "Glb"  -> no se toca.

2. IGUAL SALVO MAYUSCULAS       "glb"  -> "Glb".
   Se corrige sin preguntar. Es el mismo codigo; el catalogo dice cual es
   la forma buena y no hay nada que decidir.

3. NO SE PARECE A NINGUNA       "gbl", "gls", "m²"
   NO se toca. Que "gbl" sea "Glb" con las letras cambiadas de sitio es
   una conjetura, y una conjetura aplicada a 300 filas es un estropicio
   silencioso. Se listan y se pasan a mano con --mapa.

EN SECO POR DEFECTO
-------------------
Sin --aplicar no escribe nada: solo enseña el inventario y que haria. Un
comando que corrige la base de datos no puede ser el que se ejecuta por
accidente al pulsar la flecha arriba.

USO
---
    python3 parche_normalizar_unidades.py [--raiz /var/www/envs/vigilantes]

y despues, dentro del contenedor:

    manage.py normalizar_unidades                      # inventario, en seco
    manage.py normalizar_unidades --aplicar            # arregla las mayusculas
    manage.py normalizar_unidades --mapa "gbl=Glb,gls=Gln,m²=m2" --aplicar
    manage.py normalizar_unidades --obra JURP-JUV-2026 # acotado a una obra

Es idempotente: pasarlo dos veces no cambia nada la segunda.
"""

import argparse
import os
import sys


COMANDO = """# -*- coding: utf-8 -*-
\"\"\"Cuadra la unidad de las partidas con el catalogo de unidades.

En seco por defecto. Ver parche_normalizar_unidades.py para el porque.
\"\"\"

from django.core.management.base import BaseCommand

from operations.models import Partida, Unidad


class Command(BaseCommand):
    help = "Cuadra la unidad de las partidas con el catalogo (en seco por defecto)."

    def add_arguments(self, parser):
        parser.add_argument(
            '--aplicar', action='store_true',
            help='Escribe los cambios. Sin esto solo se enseña que haria.')
        parser.add_argument(
            '--obra', default=None,
            help='Acotar a una obra concreta (su codigo).')
        parser.add_argument(
            '--mapa', default='',
            help='Equivalencias a mano, separadas por coma: "gbl=Glb,gls=Gln".')

    def handle(self, *args, **op):
        aplicar = op['aplicar']
        obra = op['obra']

        # El catalogo entero, activas y desactivadas: una partida vieja puede
        # estar usando una unidad que ya no se ofrece, y eso no es un error
        # que haya que corregir.
        catalogo = {}
        for u in Unidad.objects.all():
            catalogo[u.codigo.lower()] = u.codigo

        mapa = {}
        for trozo in (op['mapa'] or '').split(','):
            if '=' not in trozo:
                continue
            de, a = trozo.split('=', 1)
            de, a = de.strip(), a.strip()
            if not de or not a:
                continue
            if a.lower() not in catalogo:
                self.stderr.write(
                    '  AVISO: "%s" no esta en el catalogo; se ignora "%s=%s"'
                    % (a, de, a))
                continue
            # Se guarda la forma del catalogo, no la que escribio quien llama:
            # si pide "=gln" lo que entra es "Gln".
            mapa[de.lower()] = catalogo[a.lower()]

        base = Partida.objects.all()
        if obra:
            base = base.filter(obra=obra)

        # Las unidades que hay de verdad, con cuantas partidas usa cada una.
        cuentas = {}
        for valor in base.values_list('unidad', flat=True):
            v = (valor or '').strip()
            if not v:
                continue
            cuentas[v] = cuentas.get(v, 0) + 1

        iguales, por_caso, a_mano, huerfanas = [], [], [], []
        for v in sorted(cuentas, key=lambda x: (-cuentas[x], x.lower())):
            n = cuentas[v]
            bueno = catalogo.get(v.lower())
            if bueno is not None and bueno == v:
                iguales.append((v, n))
            elif bueno is not None:
                por_caso.append((v, bueno, n))
            elif v.lower() in mapa:
                a_mano.append((v, mapa[v.lower()], n))
            else:
                huerfanas.append((v, n))

        self.stdout.write('')
        self.stdout.write('=== YA CUADRAN (%d) ===' % len(iguales))
        for v, n in iguales:
            self.stdout.write('    %-10s %5d partida(s)' % (v, n))

        self.stdout.write('')
        self.stdout.write('=== SOLO CAMBIAN MAYUSCULAS (%d) ===' % len(por_caso))
        for v, bueno, n in por_caso:
            self.stdout.write('    %-10s -> %-10s %5d partida(s)' % (v, bueno, n))

        if a_mano:
            self.stdout.write('')
            self.stdout.write('=== EQUIVALENCIAS QUE DISTE EN --mapa (%d) ===' % len(a_mano))
            for v, bueno, n in a_mano:
                self.stdout.write('    %-10s -> %-10s %5d partida(s)' % (v, bueno, n))

        self.stdout.write('')
        self.stdout.write('=== SIN EQUIVALENCIA, NO SE TOCAN (%d) ===' % len(huerfanas))
        for v, n in huerfanas:
            self.stdout.write('    %-10s %5d partida(s)' % (v, n))
        if huerfanas:
            self.stdout.write('')
            self.stdout.write('    Para cada una: o la das de alta en el catalogo')
            self.stdout.write('    (Proyectos -> Unidades), o la pasas con')
            self.stdout.write('    --mapa "%s=CODIGO".' % huerfanas[0][0])

        cambios = por_caso + a_mano
        self.stdout.write('')
        if not cambios:
            self.stdout.write(self.style.SUCCESS('No hay nada que cambiar.'))
            return

        if not aplicar:
            total = sum(n for _, _, n in cambios)
            self.stdout.write(self.style.WARNING(
                'EN SECO: no se escribio nada. Se cambiarian %d partida(s) '
                'en %d unidad(es).' % (total, len(cambios))))
            self.stdout.write('Vuelve a lanzarlo con --aplicar.')
            return

        hechos = 0
        for v, bueno, _n in cambios:
            # El filtro va por el valor exacto que se encontro, no por iexact:
            # si conviven "glb" y "GLB" se tratan por separado y el recuento
            # de arriba sigue siendo cierto.
            hechos += base.filter(unidad=v).update(unidad=bueno)
        self.stdout.write(self.style.SUCCESS(
            '%d partida(s) actualizadas.' % hechos))
"""


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--raiz', default='/var/www/envs/vigilantes')
    p.add_argument('--dry-run', action='store_true')
    args = p.parse_args()

    carpeta = os.path.join(args.raiz, 'operations/management/commands')
    ruta = os.path.join(carpeta, 'normalizar_unidades.py')

    if not os.path.isdir(carpeta):
        print('[MAL] no existe {0}'.format(carpeta))
        sys.exit(1)

    if os.path.exists(ruta) and open(ruta).read() == COMANDO:
        print('[OK ] comando: ya estaba, identico')
    elif args.dry_run:
        print('[OK ] comando: se escribiria en {0}'.format(ruta))
    else:
        with open(ruta, 'w') as f:
            f.write(COMANDO)
        print('[OK ] comando: escrito en {0}'.format(ruta))

    if args.dry_run:
        print('\nSimulacro: no se escribio nada.')
        return

    print('\nPrimero el inventario, que no toca nada:')
    print('  docker compose exec -T web python manage.py normalizar_unidades')


if __name__ == '__main__':
    main()
