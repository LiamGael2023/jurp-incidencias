# -*- coding: utf-8 -*-
"""Faltaba la forma de borrar un incidente. El sitio ya estaba hecho.

    cd /var/www/envs/prod/src/apps/api/views
    curl -sO https://raw.githubusercontent.com/LiamGael2023/jurp-incidencias/<SHA>/pruebas/parche_borrar_incidente.py
    python3 parche_borrar_incidente.py hi_incidents.py --dry-run
    sudo python3 parche_borrar_incidente.py hi_incidents.py
    cd /var/www/envs/prod
    docker compose restart jurp_web

QUE PASABA
----------
El modelo HIIncident trae `is_deleted` y `deleted_at` desde el primer
dia. Hay un indice ('is_deleted', 'created_at') pensado para ellos.
TODAS las consultas filtran por `is_deleted=False`, y el 404 del detalle
dice literalmente «Incidente no encontrado o eliminado».

Todo preparado, y ninguna forma de activarlo. Nunca se escribio el
metodo que pusiera esa marca, asi que el campo llevaba anos en la tabla
valiendo siempre lo mismo.

Esto no añade un borrado: termina el que ya estaba previsto.

POR QUE NO SE BORRA LA FILA
---------------------------
Dos razones, y la segunda hace imposible la alternativa.

PRIMERA: los costeos y los partes diarios de un incidente viven en OTRA
base de datos -la de operations, en el 8005- y le apuntan por id. Un
borrado real los dejaria señalando al vacio. No fallaria nada ese dia;
fallaria el dia que alguien sacara un reporte y le salieran importes sin
dueño, que es el peor momento para enterarse.

SEGUNDA: HIIncidentAction y HIIncidentTimeLine apuntan al incidente con
on_delete=PROTECT. Un DELETE de verdad lo rechazaria la propia base
mientras exista una sola accion o una sola linea de cronologia. El
borrado logico no es aqui la opcion prudente: es la unica que hay.

NO SE ESCRIBE EN LA BITACORA
----------------------------
HIIncidentTimeLine solo tiene user, incident, severity y status. No hay
donde poner «borrado». Una linea ahi repetiria la gravedad y el estado
que ya tenia, y se leeria como un cambio que no ocurrio. El rastro es
`deleted_at`.

Lo que NO queda registrado es QUIEN lo borro: no existe `deleted_by` y
añadirlo pide una migracion. Si hace falta, es el siguiente paso.

EL PERMISO SE COMPRUEBA DOS VECES, A PROPOSITO
----------------------------------------------
El middleware PermisosDePantalla ya mapea este DELETE a la accion
`borrar` de la pantalla `lista`:

    POR_METODO = { ... 'DELETE': 'borrar' }
    RUTAS = ( ... (r'^/api/v1/mobile/hi-incidents/', 'lista', None), ... )

Pero solo vigila lo que llega de un NAVEGADOR: mira las cabeceras
Sec-Fetch-*, y lo que no las trae pasa de largo. Es deliberado, para que
la app de campo -que entra por las mismas URL- no dependa de la rejilla
de pantallas de escritorio.

Para leer y para crear, razonable. Para borrar, no: dejaria que
cualquiera con un token valido borrase incidentes desde fuera del
navegador, con un curl. Asi que la vista lo comprueba ella misma. Es
redundante en el caso normal y es la unica defensa en el otro.

DEJA COPIA en hi_incidents.py.bak_borrar.
"""
from __future__ import print_function

import argparse
import os
import shutil
import sys

# El final del metodo get() del detalle, pegado al inicio de la clase
# siguiente. Es el hueco donde entra el delete.
ANCLA = """        return Response(
            {
                'data': HIIncidentDetailSerializer(incident).data,
            },
            status=status.HTTP_200_OK
        )

class HIIncidentCreateView(APIView):"""

NUEVO = '''        return Response(
            {
                'data': HIIncidentDetailSerializer(incident).data,
            },
            status=status.HTTP_200_OK
        )

    # ──────────────────────────────────────────────────────────────────
    # BORRAR UN INCIDENTE ES MARCARLO, NO QUITARLO
    # ──────────────────────────────────────────────────────────────────
    #
    # `is_deleted` y `deleted_at` ya estaban en el modelo, con su indice
    # ('is_deleted', 'created_at') y con todas las consultas filtrando
    # por ellos. Lo unico que faltaba era la forma de activarlos.
    #
    # NO SE BORRA LA FILA. Los costeos y los partes diarios de este
    # incidente viven en otra base de datos y le apuntan por id; un
    # borrado real los dejaria señalando al vacio y nadie se enteraria
    # hasta sacar un reporte. Ademas HIIncidentAction y
    # HIIncidentTimeLine apuntan aqui con on_delete=PROTECT, asi que la
    # base lo rechazaria de todos modos.
    #
    # NO SE ESCRIBE EN LA BITACORA: HIIncidentTimeLine solo guarda
    # gravedad y estado, y una linea ahi repetiria el estado actual sin
    # decir que esto fue un borrado. El rastro es `deleted_at`.
    #
    # EL PERMISO SE COMPRUEBA AQUI aunque el middleware ya lo haga:
    # PermisosDePantalla solo vigila lo que viene de un navegador -mira
    # las cabeceras Sec-Fetch-*- para no atar a la app de campo a la
    # rejilla de escritorio. Para leer y crear es razonable; para borrar
    # dejaria la puerta abierta a cualquiera con un token valido.
    def delete(self, request, incident_id, *args, **kwargs):
        from src.apps.core.permisos_pantalla import puede

        if not puede(request.user, 'lista', 'borrar'):
            return Response(
                {'detail': 'No tiene permiso para borrar incidentes.'},
                status=status.HTTP_403_FORBIDDEN
            )

        try:
            incident = HIIncident.objects.get(
                id=incident_id,
                is_deleted=False
            )
        except HIIncident.DoesNotExist:
            return Response(
                {'error': 'Incidente no encontrado o eliminado.'},
                status=status.HTTP_404_NOT_FOUND
            )

        incident.is_deleted = True
        incident.deleted_at = timezone.now()
        incident.save(update_fields=['is_deleted', 'deleted_at'])

        return Response(
            {'data': {'id': incident.id, 'is_deleted': True}},
            status=status.HTTP_200_OK
        )


class HIIncidentCreateView(APIView):'''

IMPORT_TZ = "from django.utils import timezone"


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("archivo", help="hi_incidents.py del backend")
    p.add_argument("--dry-run", action="store_true")
    args = p.parse_args()

    if not os.path.exists(args.archivo):
        print("no encuentro %s" % args.archivo, file=sys.stderr)
        return 2

    with open(args.archivo, encoding="utf-8") as f:
        s = f.read()

    if "def delete(self, request, incident_id" in s:
        print("Ya esta aplicado.")
        return 0

    if s.count(ANCLA) != 1:
        print("No encuentro el final del detalle tal como esperaba.",
              file=sys.stderr)
        print("Puede que ya se haya tocado. Comparalo a mano con:",
              file=sys.stderr)
        print("", file=sys.stderr)
        print(ANCLA, file=sys.stderr)
        return 1

    nuevo = s.replace(ANCLA, NUEVO)

    # `timezone` hace falta para deleted_at y puede no estar importado.
    if IMPORT_TZ not in nuevo:
        lineas = nuevo.split("\n")
        corte = None
        for i, linea in enumerate(lineas):
            if linea.startswith("from django") or linea.startswith("import django"):
                corte = i
        if corte is None:
            print("No se donde meter el import de timezone. Añade a mano:",
                  file=sys.stderr)
            print("    " + IMPORT_TZ, file=sys.stderr)
            return 1
        lineas.insert(corte + 1, IMPORT_TZ)
        nuevo = "\n".join(lineas)
        print("OK  añadido el import de timezone")
    else:
        print("OK  timezone ya estaba importado")

    # COMPROBACION DE SINTAXIS, CON CUIDADO.
    #
    # Este backend es de la epoca de django.conf.urls.patterns, o sea
    # Python 2, y compilarlo con un python3 puede fallar por cosas que no
    # tienen nada que ver con este parche. Asi que solo se exige que el
    # resultado compile SI EL ORIGINAL YA COMPILABA. Si no, se comprueba
    # al menos el trozo que se añade.
    try:
        compile(s, args.archivo, "exec")
        original_compila = True
    except SyntaxError:
        original_compila = False

    if original_compila:
        try:
            compile(nuevo, args.archivo, "exec")
        except SyntaxError as e:
            print("El resultado no compila (linea %s): %s" % (e.lineno, e.msg),
                  file=sys.stderr)
            return 1
        print("OK  el resultado compila")
    else:
        trozo = NUEVO.split("    # ─", 1)[1]
        trozo = "class _X(object):\n    # ─" + trozo
        trozo = trozo.rsplit("\n\nclass HIIncidentCreateView", 1)[0]
        try:
            compile(trozo, "<parche>", "exec")
        except SyntaxError as e:
            print("El trozo nuevo no compila (linea %s): %s" % (e.lineno, e.msg),
                  file=sys.stderr)
            return 1
        print("OK  el trozo nuevo compila")
        print("    (el fichero original no compila con python3: es codigo")
        print("     de Python 2, asi que no se puede comprobar entero)")

    if args.dry_run:
        print("")
        print("--- se añadiria esto ---")
        print(NUEVO.split("        )\n\n", 1)[1].rsplit("\n\nclass", 1)[0])
        print("")
        print("--dry-run: no se ha escrito nada.")
        return 0

    shutil.copy2(args.archivo, args.archivo + ".bak_borrar")
    with open(args.archivo, "w", encoding="utf-8") as f:
        f.write(nuevo)
    print("escrito.  copia en %s.bak_borrar" % args.archivo)
    print("")
    print("El codigo esta montado desde el disco, asi que NO hay que")
    print("reconstruir la imagen. Basta reiniciar:")
    print("")
    print("    cd /var/www/envs/prod")
    print("    docker compose restart jurp_web")
    return 0


if __name__ == "__main__":
    sys.exit(main())
