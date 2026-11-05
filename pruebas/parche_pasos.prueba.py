# -*- coding: utf-8 -*-
"""Mide los PASOS del parche contra un proyecto de mentira.

    python3 parche_pasos.prueba.py

Por que hace falta
------------------
`monitoreo_lote.prueba.py` mide el MODULO: los endpoints, la numeracion,
los permisos. Nada de eso toca el disco. Los pasos -los que editan
models.py, escriben migraciones y meten rutas en urls.py- no los medi­a
nadie, y ahi es donde se rompio:

    paso_suelto comprobaba si el campo ya estaba con
    `"tramo = models.CharField('Tramo'" not in t`, mirando el archivo
    ENTERO. Ese texto ya estaba en ResponsableTramo, en RepartoDeTramo y
    en TramoDeRutina, asi que el paso se daba por hecho sin haber tocado
    VisitaMonitoreo. La migracion si se escribia. Resultado: una columna
    en la base que el modelo no conocia, y 500 en cada lectura.

Un bug que solo aparece en el SEGUNDO estado del archivo -cuando ya hay
otros modelos escritos- y que ninguna prueba del modulo podia ver.

Que se mide
-----------
1. Un proyecto virgen: los doce pasos lo dejan completo.
2. Correrlos otra vez no cambia nada (idempotencia de verdad, en disco).
3. VisitaMonitoreo acaba con su campo `tramo` y con `tramo_rutina`
   opcional, que es justo lo que fallaba.
4. El modelo y las migraciones dicen lo mismo: ningun AddField sin campo.
"""
from __future__ import print_function

import os
import re
import shutil
import sys
import tempfile

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, AQUI)

import parche_monitoreo_rutinario as P          # noqa: E402

FALLOS = []


def igual(que, obtenido, esperado):
    marca = 'ok ' if obtenido == esperado else 'MAL'
    if obtenido != esperado:
        FALLOS.append(que)
    print('  [%s] %-52s %r%s' % (
        marca, que, obtenido,
        '' if obtenido == esperado else '   esperaba %r' % (esperado,)))


def cierto(que, cond):
    igual(que, bool(cond), True)


# ══════════════════════════════════════════════════════════════════════════
# el proyecto de mentira
# ══════════════════════════════════════════════════════════════════════════

MODELS_VIRGEN = '''# -*- coding: utf-8 -*-
from django.db import models


class Algo(models.Model):
    nombre = models.CharField('Nombre', max_length=50)
'''

URLS_VIRGEN = '''# -*- coding: utf-8 -*-
from django.conf.urls import url

from src.apps.api.views import algo

urlpatterns = [
    url(r'^v1/mobile/algo/$', algo, name='algo'),
]
'''

MIGRACION_VIRGEN = '''# -*- coding: utf-8 -*-
from __future__ import unicode_literals
from django.db import migrations


class Migration(migrations.Migration):
    dependencies = []
    operations = []
'''


def plantar():
    """Un arbol con la forma justa que miran los pasos."""
    raiz = tempfile.mkdtemp(prefix='pluvira_falso_')
    for rel in ('src/apps/core/migrations', 'src/apps/api'):
        os.makedirs(os.path.join(raiz, rel))
    escribir(raiz, 'src/apps/core/models.py', MODELS_VIRGEN)
    escribir(raiz, 'src/apps/api/urls.py', URLS_VIRGEN)
    escribir(raiz, 'src/apps/core/migrations/__init__.py', '')
    escribir(raiz, 'src/apps/core/migrations/0001_initial.py', MIGRACION_VIRGEN)
    escribir(raiz, 'src/apps/core/permission.py',
             'class IsMobileRoleUser(object):\n    pass\n')
    # De aqui saca el paso del modulo su EsGerencia.
    escribir(raiz, 'src/apps/core/equipo_enlazado.py',
             'class EsGerencia(object):\n    pass\n')
    # Y aqui vive el aviso que se retoca: con el texto EXACTO que busca el
    # paso, que es a proposito el unico anclaje que acepta -ese archivo es
    # del nucleo y no lo escribio este parche-.
    # VIEJO_AVISO es un TROZO -una llamada a medias, sin su parentesis de
    # cierre-, asi que hay que cerrarla aqui: el parche compila antes de
    # escribir y un archivo que no es Python valido lo para en seco.
    escribir(raiz, 'src/apps/api/views/hi_incidents.py',
             '# -*- coding: utf-8 -*-\n\n\n'
             'def _notificar(incident):\n'
             '    if True:\n'
             + P.VIEJO_AVISO + '\n        )\n')
    escribir(raiz, 'src/apps/api/views/__init__.py', '')
    return raiz


def escribir(raiz, rel, texto):
    ruta = os.path.join(raiz, rel)
    carpeta = os.path.dirname(ruta)
    if not os.path.isdir(carpeta):
        os.makedirs(carpeta)
    with open(ruta, 'w') as f:
        f.write(texto)


def leer(raiz, rel):
    with open(os.path.join(raiz, rel)) as f:
        return f.read()


def correr(raiz):
    """Los pasos, en el mismo orden que main(). Devuelve {nombre: (ok, que)}."""
    fuera = {}
    for nombre, fn in PASOS:
        try:
            ok, que = fn(raiz, False)
        except Exception as e:
            ok, que = False, 'reviento: %s' % (e,)
        fuera[nombre] = (ok, que)
    return fuera


PASOS = [
    ('modelos', P.paso_modelos),
    ('vigente', P.paso_vigente),
    ('migracion', P.paso_migracion),
    ('varios', P.paso_varios),
    ('telefono', P.paso_telefono),
    ('elemento', P.paso_elemento),
    ('numero', P.paso_numero),
    ('reparto', P.paso_reparto),
    ('suelto', P.paso_suelto),
    ('aviso', P.paso_aviso_incidente),
    ('modulo', P.paso_modulo),
    ('urls', P.paso_urls),
]


# ══════════════════════════════════════════════════════════════════════════
# las pruebas
# ══════════════════════════════════════════════════════════════════════════

def clase_llamada(texto, nombre):
    """El nombre real de una clase, dado el de la migracion (minusculas)."""
    for c in re.findall(r'^class (\w+)\(', texto, re.M):
        if c.lower() == nombre.lower():
            return c
    return None


def bloque_de(texto, clase):
    """El cuerpo de una clase, hasta la siguiente."""
    i = texto.index('class %s' % clase)
    j = texto.find('\nclass ', i + 1)
    return texto[i:j if j != -1 else len(texto)]


def prueba_virgen():
    print('\n1. un proyecto virgen queda completo')
    raiz = plantar()
    try:
        r = correr(raiz)
        for nombre, _ in PASOS:
            igual('paso %s' % nombre, r[nombre][0], True)

        m = leer(raiz, 'src/apps/core/models.py')
        for clase in ('ResponsableTramo', 'RutinaMonitoreo', 'TramoDeRutina',
                      'VisitaMonitoreo', 'RepartoDeTramo', 'TelefonoUsuario'):
            cierto('esta %s' % clase, 'class %s' % clase in m)

        cierto('se escribio monitoreo.py',
               os.path.isfile(os.path.join(raiz, 'src/apps/core/monitoreo.py')))

        u = leer(raiz, 'src/apps/api/urls.py')
        cierto('la ruta de rutinas', 'monitoreo/rutinas/' in u)
        cierto('la de borrar un hallazgo',
               "monitoreo/hallazgos/(?P<pk>[0-9]+)/" in u)
        cierto('y su import', 'hallazgo as mon_hallazgo' in u)
    finally:
        shutil.rmtree(raiz)


# El tramo_rutina tal como lo escribia el parche ANTES del hallazgo
# extraordinario. Deshacer SUELTO_BLOQUE con esto reconstruye el models.py
# que hay de verdad en el servidor, que es el unico estado donde el paso 9
# tiene algo que hacer.
VIEJO_TRAMO_RUTINA = (
    "    tramo_rutina = models.ForeignKey(\n"
    "        TramoDeRutina, on_delete=models.CASCADE, related_name='visitas',\n"
    "        verbose_name='Tramo de rutina')\n")


def envejecer(raiz):
    """Deja el models.py como lo dejo la version anterior del parche."""
    ruta = os.path.join(raiz, 'src/apps/core/models.py')
    with open(ruta) as f:
        t = f.read()
    assert P.SUELTO_BLOQUE in t, 'el paso 1 ya no escribe SUELTO_BLOQUE'
    with open(ruta, 'w') as f:
        f.write(t.replace(P.SUELTO_BLOQUE, VIEJO_TRAMO_RUTINA))
    # Y fuera la migracion, que es la otra mitad del paso.
    carpeta = os.path.join(raiz, 'src/apps/core/migrations')
    for n in os.listdir(carpeta):
        if 'hallazgo_suelto' in n:
            os.remove(os.path.join(carpeta, n))


def prueba_el_campo_tramo():
    print('\n2. VisitaMonitoreo acaba con su campo tramo')
    # ─────────────────────────────────────────────────────────────────
    # ESTO ES LO QUE SE ROMPIO EN PRODUCCION
    # ─────────────────────────────────────────────────────────────────
    #
    # El paso comprobaba si el campo ya estaba mirando el archivo ENTERO,
    # y «tramo = models.CharField('Tramo'» ya estaba en ResponsableTramo,
    # en RepartoDeTramo y en TramoDeRutina. Asi que se daba por hecho sin
    # tocar VisitaMonitoreo —pero escribia la migracion igual—, y quedaba
    # una columna en la base que el modelo no conocia: 500 en cada lectura.
    #
    # EN UN ARBOL VIRGEN NO SE VE, porque el paso 1 ya escribe el modelo
    # nuevo y el 9 no tiene nada que hacer. Hay que envejecerlo primero,
    # que es el estado en el que esta el servidor de verdad.
    raiz = plantar()
    try:
        correr(raiz)
        envejecer(raiz)

        viejo = leer(raiz, 'src/apps/core/models.py')
        cierto('el modelo envejecido NO tiene el campo',
               "tramo = models.CharField('Tramo'"
               not in bloque_de(viejo, 'VisitaMonitoreo'))
        cierto('pero otros modelos SI (que es lo que confundia al paso)',
               "tramo = models.CharField('Tramo'" in viejo)

        ok, que = P.paso_suelto(raiz, False)
        igual('el paso 9 se aplica', ok, True)
        cierto('y dice que toco el modelo', '(y el modelo)' in que)

        m = leer(raiz, 'src/apps/core/models.py')
        visita = bloque_de(m, 'VisitaMonitoreo')

        cierto('VisitaMonitoreo tiene tramo',
               "tramo = models.CharField('Tramo'" in visita)
        cierto('y tramo_rutina es opcional',
               re.search(r'tramo_rutina = models\.ForeignKey\([^)]*null=True',
                         visita, re.S) is not None)

        # Los otros siguen como estaban: el paso no se los llevo por delante.
        cierto('TramoDeRutina intacto',
               "tramo = models.CharField('Tramo'" in bloque_de(m, 'TramoDeRutina'))
        cierto('ResponsableTramo intacto',
               "tramo = models.CharField('Tramo'"
               in bloque_de(m, 'ResponsableTramo'))

        # Y la migracion que lo acompana.
        migs = os.listdir(os.path.join(raiz, 'src/apps/core/migrations'))
        cierto('con su migracion',
               any('hallazgo_suelto' in n for n in migs))

        # Repetirlo sobre el modelo ya corregido no vuelve a tocarlo.
        ok, que = P.paso_suelto(raiz, False)
        igual('la segunda vez, nada', (ok, que), (True, 'ya estaba'))
    finally:
        shutil.rmtree(raiz)


def prueba_idempotente():
    print('\n3. correrlos dos veces no cambia nada')
    raiz = plantar()
    try:
        correr(raiz)
        antes = {}
        for base, _, archivos in os.walk(raiz):
            for n in archivos:
                ruta = os.path.join(base, n)
                with open(ruta) as f:
                    antes[os.path.relpath(ruta, raiz)] = f.read()

        r = correr(raiz)
        for nombre, _ in PASOS:
            igual('segunda vuelta %s' % nombre, r[nombre][0], True)

        despues = {}
        for base, _, archivos in os.walk(raiz):
            for n in archivos:
                ruta = os.path.join(base, n)
                if ruta.endswith('.bak'):
                    continue
                with open(ruta) as f:
                    despues[os.path.relpath(ruta, raiz)] = f.read()

        nuevos = sorted(set(despues) - set(antes))
        igual('ningun archivo nuevo', nuevos, [])
        cambiados = sorted(k for k in despues
                           if k in antes and antes[k] != despues[k])
        igual('ningun archivo cambiado', cambiados, [])
    finally:
        shutil.rmtree(raiz)


def prueba_migraciones_y_modelo():
    print('\n4. las migraciones y el modelo dicen lo mismo')
    raiz = plantar()
    try:
        correr(raiz)
        m = leer(raiz, 'src/apps/core/models.py')
        carpeta = os.path.join(raiz, 'src/apps/core/migrations')

        # Cada AddField de las migraciones del parche tiene que existir en
        # el modelo al que apunta. Es la comprobacion que habria cazado el
        # fallo sin levantar Django.
        huerfanos = []
        for n in sorted(os.listdir(carpeta)):
            if not n.endswith('.py') or n == '__init__.py':
                continue
            texto = open(os.path.join(carpeta, n)).read()
            for mod, campo in re.findall(
                    r"AddField\(\s*model_name=['\"](\w+)['\"],\s*"
                    r"name=['\"](\w+)['\"]", texto):
                real = clase_llamada(m, mod)
                if real is None:
                    huerfanos.append('%s.%s (no existe el modelo)'
                                     % (mod, campo))
                    continue
                cuerpo = bloque_de(m, real)
                if not re.search(r'^\s+%s = models\.' % campo, cuerpo, re.M):
                    huerfanos.append('%s.%s' % (mod, campo))
        igual('ningun AddField sin campo', huerfanos, [])

        # Y cada migracion encadena con la anterior.
        nombres = sorted(n[:-3] for n in os.listdir(carpeta)
                         if n.endswith('.py') and n != '__init__.py')
        rotas = []
        for i, n in enumerate(nombres[1:], 1):
            texto = open(os.path.join(carpeta, n + '.py')).read()
            if nombres[i - 1] not in texto:
                rotas.append(n)
        igual('la cadena de migraciones', rotas, [])
    finally:
        shutil.rmtree(raiz)


def main():
    print('Los pasos del parche, sobre un proyecto de mentira')
    print('=' * 74)
    for fn in [prueba_virgen, prueba_el_campo_tramo, prueba_idempotente,
               prueba_migraciones_y_modelo]:
        fn()
    print('\n' + '=' * 74)
    if FALLOS:
        print('FALLAN %d:' % len(FALLOS))
        for f in FALLOS:
            print('  - %s' % f)
        sys.exit(1)
    print('Todo pasa.')


if __name__ == '__main__':
    main()
