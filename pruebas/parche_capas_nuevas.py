# -*- coding: utf-8 -*-
"""
Cuatro capas nuevas en el inventario: Canal Madre por tramos de 200 m,
tramos JURP, cuencas del PECH y cauces de quebradas.

CÓMO SE APLICA
--------------
Primero los datos, que este guion NO carga:

    gunzip -c capas_nuevas.sql.gz | docker exec -i jurp_postgis \\
        psql -U gis_admin -d jurp_gis -v ON_ERROR_STOP=1

Y después el código:

    python3 parche_capas_nuevas.py [--raiz /var/www/envs/vigilantes] [--dry-run]
    cd /var/www/envs/vigilantes && docker compose restart web

Es idempotente y deja .bak de cada archivo. Cada bloque se escribe al final
de su archivo detrás de una marca; al volver a pasarlo, el bloque viejo se
sustituye entero.

POR QUÉ EL ESQUEMA NO LO TOCA DJANGO
------------------------------------
El router manda `allow_migrate -> False` para la app `inventario`: las
tablas de PostGIS las gobiernan los .sql de carga. Los modelos van con
`managed = False` y describen una tabla que ya existe. Cuidado, porque
`migrate` contesta «Applying... OK» igual, sin crear nada.

POR QUÉ LOS MODELOS NO HEREDAN DE ActivoKmz
-------------------------------------------
Sería lo natural —comparten los once campos— pero ActivoKmz vive más arriba
en models.py y puede ganar columnas con el tiempo. Un campo nuevo allí se
traduce en una columna que estas cuatro tablas no tienen, y Django no avisa
al arrancar: falla al consultar, en producción, con un error de SQL que no
menciona la herencia. Declarados aquí, el modelo y la tabla se leen juntos.

Los serializers SÍ heredan de ActivoKmzSerializer, que solo enumera campos:
si allí se añade uno que falte, salta al serializar y se ve enseguida.

LA ETIQUETA ES LO QUE SE LEE EN EL MAPA
---------------------------------------
`nombre` es el dato crudo y `etiqueta` lo que se muestra al pinchar. Para el
Canal Madre son 871 trozos de 200 m que se llaman todos «TRAMO 0»: sin la
etiqueta con estructura y progresiva, el popup no distingue uno de otro.
"""

import argparse
import os
import re
import shutil
import sys


# ── models.py ─────────────────────────────────────────────────────────────

MARCA_MODELO = '# ── Capas nuevas de contexto (CM 200 m, tramos, cuencas, cauces)'

MODELO = MARCA_MODELO + ''' ──
#
# Las cuatro comparten los once campos de las capas KMZ -por eso las sirve
# el mismo serializer- y cada una añade los suyos. Se declaran enteros en
# vez de heredar de ActivoKmz: ver la cabecera del parche.

class _CapaNueva(_mod_capas.Model):
    """Los campos comunes. Abstracto: no es ninguna tabla."""
    ogc_fid = _mod_capas.AutoField(primary_key=True)
    nombre = _mod_capas.TextField(blank=True, null=True)
    etiqueta = _mod_capas.TextField(blank=True, null=True)
    numero = _mod_capas.IntegerField(blank=True, null=True)
    progresiva = _mod_capas.TextField(blank=True, null=True)
    estado = _mod_capas.TextField(blank=True, null=True)
    estructura = _mod_capas.TextField(blank=True, null=True)
    cod_est = _mod_capas.TextField(blank=True, null=True)
    tramo = _mod_capas.TextField(blank=True, null=True)
    ambito = _mod_capas.TextField(blank=True, null=True)
    fuente = _mod_capas.TextField(blank=True, null=True)
    # Siempre vacías aquí: son capas de contexto y no entran en campaña. Van
    # porque las demás capas las tienen y alguna consulta común las mira.
    campania_alta = _mod_capas.IntegerField(blank=True, null=True)
    campania_baja = _mod_capas.IntegerField(blank=True, null=True)
    motivo_baja = _mod_capas.TextField(blank=True, null=True)

    class Meta:
        abstract = True


class CanalMadre200m(_CapaNueva):
    """El Canal Madre troceado cada 200 m, con la estructura de cada trozo.

    No sustituye a CanalMadre -que es el eje en línea- ni a CanalMadreKmz
    -el trazado con su ancho-: es el mismo canal partido por progresiva, que
    es como se recorre y como se reporta al ANA.
    """
    tipo_estru = _mod_capas.TextField(blank=True, null=True)
    # Quién OPERA el tramo (Danper, Camposol, Green Perú...), no de quién es
    # la obra. El ámbito de los catorce tramos es JURP.
    empresa = _mod_capas.TextField(blank=True, null=True)
    orden = _mod_capas.FloatField(blank=True, null=True)
    long_p = _mod_capas.FloatField(blank=True, null=True)
    long_g = _mod_capas.FloatField(blank=True, null=True)
    diametro = _mod_capas.FloatField(blank=True, null=True)
    seccion = _mod_capas.TextField(blank=True, null=True)
    cota = _mod_capas.FloatField(blank=True, null=True)
    caudal_m3s = _mod_capas.FloatField(blank=True, null=True)
    pendiente = _mod_capas.FloatField(blank=True, null=True)
    talud_z = _mod_capas.FloatField(blank=True, null=True)
    base_m = _mod_capas.FloatField(blank=True, null=True)
    tirante_m = _mod_capas.FloatField(blank=True, null=True)
    velocidad = _mod_capas.FloatField(blank=True, null=True)
    geom = _mod_capas.MultiPolygonField(srid=32717, blank=True, null=True)

    class Meta:
        managed = False
        db_table = 'canal_madre_200m'
        verbose_name = 'tramo de 200 m del Canal Madre'
        verbose_name_plural = 'Canal Madre por tramos de 200 m'


class TramoJurp(_CapaNueva):
    """Los catorce tramos en que se reparte la operación del canal."""
    km_inicio = _mod_capas.TextField(blank=True, null=True)
    km_final = _mod_capas.TextField(blank=True, null=True)
    long_km = _mod_capas.FloatField(blank=True, null=True)
    empresa = _mod_capas.TextField(blank=True, null=True)
    responsable = _mod_capas.TextField(blank=True, null=True)
    descripcion = _mod_capas.TextField(blank=True, null=True)
    n_alcantarillas = _mod_capas.IntegerField(blank=True, null=True)
    n_canoas = _mod_capas.IntegerField(blank=True, null=True)
    n_bocatomas = _mod_capas.IntegerField(blank=True, null=True)
    n_entregas = _mod_capas.IntegerField(blank=True, null=True)
    n_acueductos = _mod_capas.IntegerField(blank=True, null=True)
    n_sifones = _mod_capas.IntegerField(blank=True, null=True)
    n_tuneles = _mod_capas.IntegerField(blank=True, null=True)
    n_desarenadores = _mod_capas.IntegerField(blank=True, null=True)
    n_puentes = _mod_capas.IntegerField(blank=True, null=True)
    n_caidas = _mod_capas.IntegerField(blank=True, null=True)
    n_aliviaderos = _mod_capas.IntegerField(blank=True, null=True)
    n_tomas = _mod_capas.IntegerField(blank=True, null=True)
    geom = _mod_capas.MultiPolygonField(srid=32717, blank=True, null=True)

    class Meta:
        managed = False
        db_table = 'tramos_jurp'
        verbose_name = 'tramo JURP'
        verbose_name_plural = 'tramos JURP'


class CuencaPech(_CapaNueva):
    """Cuencas de quebrada que drenan sobre el canal.

    Importan porque por ahí baja el agua cuando llueve en la sierra: son las
    que explican dónde se colmata y dónde revienta.
    """
    stream_id = _mod_capas.BigIntegerField(blank=True, null=True)
    next_stream = _mod_capas.BigIntegerField(blank=True, null=True)
    area_ha = _mod_capas.FloatField(blank=True, null=True)
    nombre_qda = _mod_capas.TextField(blank=True, null=True)
    nro_pc = _mod_capas.TextField(blank=True, null=True)
    pc = _mod_capas.TextField(blank=True, null=True)
    geom = _mod_capas.MultiPolygonField(srid=32717, blank=True, null=True)

    class Meta:
        managed = False
        db_table = 'cuencas_pech'
        verbose_name = 'cuenca'
        verbose_name_plural = 'cuencas del PECH'


class CauceQuebrada(_CapaNueva):
    """Los cauces de esas cuencas. Once mil, por eso van simplificados."""
    stream_id = _mod_capas.BigIntegerField(blank=True, null=True)
    elevacion = _mod_capas.FloatField(blank=True, null=True)
    in_flow = _mod_capas.BigIntegerField(blank=True, null=True)
    out_flow = _mod_capas.BigIntegerField(blank=True, null=True)
    area_drenaje_km2 = _mod_capas.FloatField(blank=True, null=True)
    longitud_m = _mod_capas.FloatField(blank=True, null=True)
    geom = _mod_capas.MultiLineStringField(srid=32717, blank=True, null=True)

    class Meta:
        managed = False
        db_table = 'cauces_quebradas'
        verbose_name = 'cauce'
        verbose_name_plural = 'cauces de quebradas'
'''

# El import va delante del bloque, no dentro, para no depender de cómo se
# llame `models` donde se pegue.
IMPORT_MODELO = 'from django.contrib.gis.db import models as _mod_capas\n\n\n'


# ── serializers.py ────────────────────────────────────────────────────────

MARCA_SERIALIZADOR = '# ── Serializers de las capas nuevas de contexto'

SERIALIZADOR = MARCA_SERIALIZADOR + ''' ──────────────
#
# Heredan de ActivoKmzSerializer, así que ya traen los once campos comunes;
# cada uno añade los suyos. Sin declararlos, el dato está en la base y no
# sale en el mapa, que es un fallo silencioso y de los caros de encontrar.

class CanalMadre200mSerializer(ActivoKmzSerializer):
    class Meta(ActivoKmzSerializer.Meta):
        model = models.CanalMadre200m
        fields = ActivoKmzSerializer.Meta.fields + (
            'tipo_estru', 'empresa', 'orden', 'long_p', 'long_g', 'diametro',
            'seccion', 'cota', 'caudal_m3s', 'pendiente', 'talud_z',
            'base_m', 'tirante_m', 'velocidad',
        )


class TramoJurpSerializer(ActivoKmzSerializer):
    class Meta(ActivoKmzSerializer.Meta):
        model = models.TramoJurp
        fields = ActivoKmzSerializer.Meta.fields + (
            'km_inicio', 'km_final', 'long_km', 'empresa', 'responsable',
            'descripcion', 'n_alcantarillas', 'n_canoas', 'n_bocatomas',
            'n_entregas', 'n_acueductos', 'n_sifones', 'n_tuneles',
            'n_desarenadores', 'n_puentes', 'n_caidas', 'n_aliviaderos',
            'n_tomas',
        )


class CuencaPechSerializer(ActivoKmzSerializer):
    class Meta(ActivoKmzSerializer.Meta):
        model = models.CuencaPech
        fields = ActivoKmzSerializer.Meta.fields + (
            'stream_id', 'next_stream', 'area_ha', 'nombre_qda', 'nro_pc', 'pc',
        )


class CauceQuebradaSerializer(ActivoKmzSerializer):
    class Meta(ActivoKmzSerializer.Meta):
        model = models.CauceQuebrada
        fields = ActivoKmzSerializer.Meta.fields + (
            'stream_id', 'elevacion', 'in_flow', 'out_flow',
            'area_drenaje_km2', 'longitud_m',
        )
'''


# ── views.py ──────────────────────────────────────────────────────────────

MARCA_VISTA = '# ── Alta de las capas nuevas en el registro'

VISTA = MARCA_VISTA + ''' ───────────────────────
#
# Se añaden con update() al final del módulo en vez de escribirlas dentro
# del literal CAPAS. El diccionario se consulta dentro de los métodos, no al
# importar, así que da igual cuándo se complete; y de este modo el parche no
# tiene que meterse a editar un literal de treinta y cuatro líneas, que es
# donde un reemplazo automático acaba rompiendo algo.

CAPAS.update({
    'canal_madre_200m': (models.CanalMadre200m, serializers.CanalMadre200mSerializer),
    'tramos_jurp':      (models.TramoJurp, serializers.TramoJurpSerializer),
    'cuencas_pech':     (models.CuencaPech, serializers.CuencaPechSerializer),
    'cauces_quebradas': (models.CauceQuebrada, serializers.CauceQuebradaSerializer),
})
'''


# ── mecánica ──────────────────────────────────────────────────────────────

def leer(ruta):
    with open(ruta) as f:
        return f.read()


def escribir(ruta, texto, simulacro):
    """Compila antes de escribir. Un .py roto deja la API entera caída."""
    try:
        compile(texto, ruta, 'exec')
    except SyntaxError as e:
        raise IOError('el resultado no compila: {0} (linea {1})'
                      .format(e.msg, e.lineno))
    if simulacro:
        return
    shutil.copy2(ruta, ruta + '.bak')
    with open(ruta, 'w') as f:
        f.write(texto)


def poner_bloque(ruta, marca, bloque, simulacro, delante=''):
    """Deja `bloque` al final del archivo, sustituyendo el que hubiera.

    Desde la marca hasta el final es todo del bloque, así que se tira entero
    y se escribe el nuevo. Es lo que permite corregir una versión anterior
    sin saber cuál era.
    """
    t = leer(ruta)
    veces = t.count(marca)
    if veces > 1:
        return False, ('la marca sale {0} veces; revisalo a mano'.format(veces))
    nuevo = delante + bloque
    if veces == 1:
        if t[t.index(marca) - len(delante):] == nuevo:
            return True, 'ya estaba'
        escribir(ruta, t[:t.index(marca) - len(delante)] + nuevo, simulacro)
        return True, 'bloque actualizado'
    escribir(ruta, t.rstrip() + '\n\n\n' + nuevo, simulacro)
    return True, 'bloque anadido'


def buscar_app(raiz):
    """La carpeta de la app del inventario.

    Por la ruta que ya funciona y no por el nombre: al lado hay copias de
    seguridad (inventario.bak_1602) y parchear una de ésas dejaría todo
    igual sin que nada fallara.
    """
    if not os.path.isdir(raiz):
        return None, 'no existe {0}'.format(raiz)
    for nombre in sorted(os.listdir(raiz)):
        carpeta = os.path.join(raiz, nombre)
        urls = os.path.join(carpeta, 'urls.py')
        if not os.path.isdir(carpeta) or '.bak' in nombre:
            continue
        if os.path.exists(urls) and 'campos-evaluables' in leer(urls):
            return carpeta, None
    return None, 'no encuentro la app del inventario bajo {0}'.format(raiz)


def comprobar_base(app):
    """Que exista lo que los bloques dan por hecho.

    Si ActivoKmzSerializer cambiara de nombre, el parche escribiría un
    archivo que compila y revienta al importar; esto lo detiene antes.
    """
    faltan = []
    if 'class ActivoKmzSerializer' not in leer(os.path.join(app, 'serializers.py')):
        faltan.append('ActivoKmzSerializer en serializers.py')
    if not re.search(r'^CAPAS\s*=\s*\{', leer(os.path.join(app, 'views.py')), re.M):
        faltan.append('el diccionario CAPAS en views.py')
    return faltan


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--raiz', default='/var/www/envs/vigilantes')
    p.add_argument('--dry-run', action='store_true')
    args = p.parse_args()

    app, mal = buscar_app(args.raiz)
    if mal:
        print('[MAL] {0}'.format(mal))
        sys.exit(1)
    print('App del inventario: {0}'.format(app))

    faltan = comprobar_base(app)
    if faltan:
        print('[MAL] falta lo que este parche necesita: {0}'.format(', '.join(faltan)))
        sys.exit(1)

    pasos = [
        ('modelos', lambda: poner_bloque(
            os.path.join(app, 'models.py'), MARCA_MODELO, MODELO,
            args.dry_run, delante=IMPORT_MODELO)),
        ('serializers', lambda: poner_bloque(
            os.path.join(app, 'serializers.py'), MARCA_SERIALIZADOR,
            SERIALIZADOR, args.dry_run)),
        ('registro de capas', lambda: poner_bloque(
            os.path.join(app, 'views.py'), MARCA_VISTA, VISTA, args.dry_run)),
    ]

    for nombre, fn in pasos:
        try:
            ok, detalle = fn()
        except (IOError, OSError) as e:
            ok, detalle = False, str(e)
        print('[{0}] {1}: {2}'.format('OK ' if ok else 'MAL', nombre, detalle))
        if not ok:
            print('\nNO se aplico todo. Los .bak estan al lado de cada archivo.')
            sys.exit(1)

    if args.dry_run:
        print('\nSimulacro: no se escribio nada.')
        return

    print('\nFalta:')
    print('  1. cargar los datos, si no lo hiciste ya:')
    print('     gunzip -c capas_nuevas.sql.gz | docker exec -i jurp_postgis \\')
    print('         psql -U gis_admin -d jurp_gis -v ON_ERROR_STOP=1')
    print('  2. cd {0} && docker compose restart web'.format(args.raiz))
    print('  3. comprobar:')
    print('     curl -s -o /dev/null -w "%{http_code}\\n" \\')
    print('       http://127.0.0.1:8001/api/v1/inventario/capas/tramos_jurp/?srid=4326')


if __name__ == '__main__':
    main()
