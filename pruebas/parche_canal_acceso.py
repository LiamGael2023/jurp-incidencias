# -*- coding: utf-8 -*-
"""Por donde entra cada cuenta: web, app, o las dos. Solo PLUVIRA.

    python3 parche_canal_acceso.py                 # solo mira y cuenta
    python3 parche_canal_acceso.py --aplicar       # escribe
    python3 parche_canal_acceso.py --raiz /ruta    # si no esta donde cree

SE CORRE DONDE VIVE EL PROYECTO DE PLUVIRA, el mismo sitio donde se aplico
parche_editar_usuario.py (por defecto /var/www/envs/prod). No en el Linode
de vigilantes: SENTRIA tiene su propio padron y queda para otro dia.

ESTA ESCRITO CONTRA ESE PROYECTO: Django 1.8, Python 3.5, DRF 3.6, rutas con
url(r'^...$'), y el parche del celular enlazado YA APLICADO -de el salen
EsGerencia y es_navegador, que este reutiliza en vez de reinventar-.

QUE PROBLEMA RESUELVE
---------------------
Hay cuentas que solo tienen sentido en el navegador -las de oficina, las de
consulta, las de servicio- y otras que solo tienen sentido en el celular.
Hasta hoy las dos entran por los dos sitios con la misma clave.

QUE TOCA
--------
    1. src/apps/core/models.py              la tabla, al final
    2. src/apps/core/migrations/XXXX_...py  la migracion       (NUEVO)
    3. src/apps/core/canal_acceso.py        la decision y el endpoint (NUEVO)
    4. src/apps/api/urls.py                 el import y la ruta
    5. src/apps/api/views/mobile_users.py   un campo en _serialize
    6. src/apps/api/views/mobile_auth.py    la comprobacion en las dos puertas

De codigo que ya funciona se tocan tres sitios y son tres injertos cortos.
Todo lo demas es nuevo y no puede romper lo que habia.

NADIE SE QUEDA FUERA AL DESPLEGAR
---------------------------------
No haber fila vale "ambos", que es como se comporta el sistema hoy. La tabla
nace vacia y se llena solo cuando alguien decide limitar a alguien: no hay
migracion de datos que recorra el padron, y por tanto no hay forma de que se
equivoque con el padron entero.

Y si el codigo estuviera aplicado pero la migracion no, canal_de() devuelve
"ambos" en vez de reventar: abrir es el fallo seguro cuando lo que esta en
juego es dejar a la gente de campo sin entrar.

EL ORDEN
--------
    1. python3 parche_canal_acceso.py            mira que todo cuadre
    2. python3 parche_canal_acceso.py --aplicar
    3. manage.py migrate core
    4. reiniciar jurp_web
    5. desplegar la web (el boton «Acceso» aparece solo cuando el servidor
       empieza a mandar el campo)
"""

from __future__ import print_function

import argparse
import os
import re
import shutil
import sys


# ══════════════════════════════════════════════════════════════════════════
# 1. la tabla
# ══════════════════════════════════════════════════════════════════════════

MODELO = '''

# ══════════════════════════════════════════════════════════════════════════
# POR DONDE ENTRA CADA CUENTA   (lo escribe parche_canal_acceso.py)
# ══════════════════════════════════════════════════════════════════════════

class CanalDeAcceso(models.Model):
    """Si esta cuenta entra por la web, por la app, o por las dos.

    UN VALOR DE TRES Y NO DOS BANDERAS. Con un booleano para la web y otro
    para la app existe el estado "ninguno de los dos": una cuenta que no
    entra por ningun lado. Nadie la quiere, pero se crea sola con un clic de
    mas, y el dia que pasa el sintoma es "no puedo entrar" sin mas pista.
    Con un valor unico de tres ese estado no se puede ni escribir.

    NO HABER FILA VALE "AMBOS". Es como se comporta el sistema hoy, asi que
    el dia del despliegue nadie se queda fuera y no hace falta una migracion
    de datos que recorra el padron entero. La fila aparece cuando alguien
    decide limitar a alguien, y solo para ese.
    """

    AMBOS = 'ambos'
    WEB = 'web'
    APP = 'app'
    OPCIONES = (
        (AMBOS, 'Web y app'),
        (WEB, 'Solo web'),
        (APP, 'Solo app'),
    )

    usuario = models.OneToOneField(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
        related_name='canal_acceso', verbose_name='Usuario')
    canal = models.CharField('Por donde entra', max_length=10,
                             choices=OPCIONES, default=AMBOS)

    # LA FIRMA, por el mismo motivo que en los equipos enlazados: "¿quien le
    # quito la web a este?" es una pregunta que aparece sola al mes de tener
    # esto funcionando, y sin firma no tiene respuesta.
    cambiado_en = models.DateTimeField('Cambiado el', auto_now=True)
    cambiado_por = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True,
        blank=True, related_name='+', verbose_name='Cambiado por')

    class Meta:
        verbose_name = 'Canal de acceso'
        verbose_name_plural = 'Canales de acceso'

    def __str__(self):
        return '{0} - {1}'.format(self.usuario, self.get_canal_display())
'''


# ══════════════════════════════════════════════════════════════════════════
# 2. la migracion
# ══════════════════════════════════════════════════════════════════════════
#
# Escrita campo por campo, como la del celular enlazado y por lo mismo: en
# este proyecto el codigo esta montado en solo lectura y makemigrations no
# puede escribir. Para comprobar que dice lo mismo que el modelo:
#     manage.py makemigrations core --dry-run   ->  "No changes detected"

MIGRACION = '''# -*- coding: utf-8 -*-
# Lo escribe parche_canal_acceso.py. Comprobable con:
#     manage.py makemigrations core --dry-run    ->  "No changes detected"
from __future__ import unicode_literals

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('core', '%(anterior)s'),
    ]

    operations = [
        migrations.CreateModel(
            name='CanalDeAcceso',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True,
                                        serialize=False, verbose_name='ID')),
                ('canal', models.CharField(
                    choices=[('ambos', 'Web y app'), ('web', 'Solo web'),
                             ('app', 'Solo app')],
                    default='ambos', max_length=10,
                    verbose_name='Por donde entra')),
                ('cambiado_en', models.DateTimeField(
                    auto_now=True, verbose_name='Cambiado el')),
                ('cambiado_por', models.ForeignKey(
                    blank=True, null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name='+', to=settings.AUTH_USER_MODEL,
                    verbose_name='Cambiado por')),
                ('usuario', models.OneToOneField(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='canal_acceso', to=settings.AUTH_USER_MODEL,
                    verbose_name='Usuario')),
            ],
            options={
                'verbose_name': 'Canal de acceso',
                'verbose_name_plural': 'Canales de acceso',
            },
        ),
    ]
'''


# ══════════════════════════════════════════════════════════════════════════
# 3. la decision y el endpoint
# ══════════════════════════════════════════════════════════════════════════

MODULO = '''# -*- coding: utf-8 -*-
"""Por donde entra cada cuenta: la decision y el endpoint.

Lo escribe parche_canal_acceso.py. No se edita a mano: el parche lo
reemplaza entero.

DONDE MUERDE. En el login, justo ANTES de enlazar el celular. Antes y no
despues: si fuera despues, a quien tiene la cuenta limitada a la web se le
habria enlazado el telefono por el camino, y ese enlace quedaria ahi para
siempre sin que nadie lo hubiera pedido -y el siguiente sintoma seria "no
puedo entrar desde mi celular nuevo", que no tiene nada que ver-.

Y despues de comprobar la clave, como todo lo demas: decirle "esta cuenta
solo entra por la web" a quien escribio mal la contrasena le confirma que la
cuenta existe.
"""

from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from .models import CanalDeAcceso
# De aqui salen las dos cosas que este modulo no tiene por que repetir: quien
# puede administrar cuentas, y que cuenta como navegador.
from .equipo_enlazado import EsGerencia, es_navegador


AMBOS = CanalDeAcceso.AMBOS
WEB = CanalDeAcceso.WEB
APP = CanalDeAcceso.APP

VALIDOS = (AMBOS, WEB, APP)


def canal_de(usuario):
    """Por donde puede entrar. Sin fila, por los dos."""
    if usuario is None:
        return AMBOS
    try:
        return usuario.canal_acceso.canal
    except CanalDeAcceso.DoesNotExist:
        return AMBOS
    except Exception:
        # Codigo aplicado y migracion no: la tabla no existe todavia. Eso no
        # puede dejar a nadie fuera, asi que abre. Cuando lo que esta en
        # juego es que la gente de campo entre, el fallo seguro es abrir.
        return AMBOS


def puede_entrar(usuario, plataforma):
    """(ok, motivo_o_None).

    LA APP VIEJA NO MANDA `plataforma`. Esa ausencia cuenta como app y no
    como web, igual que en el enlace del celular. Si contara como web,
    saltarse el limite seria mandar un campo DE MENOS, que es justo lo que
    sabe hacer cualquiera.
    """
    canal = canal_de(usuario)
    if canal == AMBOS:
        return True, None

    web = es_navegador(plataforma)

    # Los dos campos a proposito: de las dos puertas del login, una responde
    # con 'detail' y la otra con 'error'. Mandar los dos deja que el mensaje
    # salga entero por las dos, sin que este modulo sepa cual lo llamo.
    if canal == WEB and not web:
        texto = 'Esta cuenta solo entra desde la web.'
        return False, {'codigo': 'solo_web', 'detail': texto, 'error': texto}
    if canal == APP and web:
        texto = 'Esta cuenta solo entra desde la app del celular.'
        return False, {'codigo': 'solo_app', 'detail': texto, 'error': texto}
    return True, None


@api_view(['POST'])
@permission_classes([EsGerencia])
def poner_canal(request, pk):
    """Cambia por donde entra una cuenta.

    QUITAR UN CANAL CIERRA SU SESION; ANADIRLO, NO. Quien limita a alguien
    lo hace porque no quiere que siga ahi, y una sesion abierta dura dias:
    sin cerrarla el cambio no valdria hasta que esa persona decidiera salir.
    Al reves no hace falta -ampliar no deja a nadie donde no debia- y echar a
    alguien para darle MAS permiso seria gratuito.
    """
    from django.contrib.auth import get_user_model
    from rest_framework.authtoken.models import Token

    canal = (request.data.get('acceso') or '').strip().lower()
    if canal not in VALIDOS:
        return Response(
            {'ok': False,
             'detail': 'Valor no valido. Se admite: {0}.'.format(
                 ', '.join(VALIDOS))},
            status=status.HTTP_400_BAD_REQUEST)

    Usuario = get_user_model()
    try:
        destino = Usuario.objects.get(pk=pk)
    except Usuario.DoesNotExist:
        return Response({'ok': False, 'detail': 'No existe ese usuario.'},
                        status=status.HTTP_404_NOT_FOUND)

    quien = getattr(request, 'user', None)
    yo = getattr(quien, 'pk', None)

    # El pie en la trampa: esta pantalla ES la web. Dejarse a uno mismo en
    # "solo app" cierra la puerta por la que se acaba de entrar, y el remedio
    # pasa por otra persona de Gerencia o por el shell.
    if yo is not None and destino.pk == yo and canal == APP:
        return Response(
            {'ok': False,
             'detail': 'No puedes dejar tu propia cuenta solo con la app: '
                       'te quedarias fuera de esta pantalla ahora mismo.'},
            status=status.HTTP_400_BAD_REQUEST)

    fila, _ = CanalDeAcceso.objects.get_or_create(usuario=destino)
    antes = fila.canal
    fila.canal = canal
    fila.cambiado_por = quien if yo is not None else None
    fila.save()

    cerrada = (canal != AMBOS and canal != antes)
    if cerrada:
        Token.objects.filter(user=destino).delete()

    return Response({'ok': True, 'acceso': fila.canal, 'antes': antes,
                     'sesion_cerrada': cerrada})
'''


# ══════════════════════════════════════════════════════════════════════════
# 4-6. los injertos
# ══════════════════════════════════════════════════════════════════════════

IMPORT_URLS = ("from src.apps.core.canal_acceso import "
               "poner_canal as canal_poner\n")

RUTA = ("    # Por donde entra cada cuenta: web, app o las dos.\n"
        "    url(r'^v1/mobile/users/(?P<pk>[0-9]+)/acceso/$',\n"
        "        canal_poner, name='mobile_user_acceso'),\n")

IMPORT_USERS = "from src.apps.core.canal_acceso import canal_de\n"

IMPORT_AUTH = "from src.apps.core.canal_acceso import puede_entrar\n"

COMPROBACION = '''{sangria}# ── POR DONDE ENTRA ESTA CUENTA ──
{sangria}# Antes del enlace del celular a proposito: si fuera despues, a quien
{sangria}# tiene la cuenta limitada a la web se le habria enlazado el telefono
{sangria}# por el camino, y ese enlace quedaria ahi sin que nadie lo pidiera.
{sangria}ok_canal, error_canal = puede_entrar(
{sangria}    user, request.data.get('plataforma', ''))
{sangria}if not ok_canal:
{sangria}    error_canal['ok'] = False
{sangria}    return Response(error_canal, status=status.HTTP_403_FORBIDDEN)

'''


# ══════════════════════════════════════════════════════════════════════════
# herramientas
# ══════════════════════════════════════════════════════════════════════════

def leer(ruta):
    with open(ruta, 'r') as f:
        return f.read()


def escribir(ruta, texto, simulacro):
    if simulacro:
        return
    if os.path.exists(ruta):
        shutil.copy2(ruta, ruta + '.bak')
    with open(ruta, 'w') as f:
        f.write(texto)


def fin_de_imports(texto):
    """El indice de linea justo despues del ultimo import de cabecera.

    Cuenta parentesis: `from x import (\\n a,\\n)` ocupa varias lineas y
    meter algo en medio parte el import y el proyecto no arranca.

    No se ancla en `urlpatterns`: en Django 1.8 puede venir como lista, como
    `patterns('', ...)`, con `+=` o envuelto en format_suffix_patterns, y
    anclar ahi seria adivinar una de las formas. El ultimo import de arriba
    esta en cualquier fichero, venga como venga.
    """
    lineas = texto.splitlines(True)
    fin = 0
    abiertos = 0
    dentro = False
    for i, l in enumerate(lineas):
        pelada = l.strip()
        if not dentro and (pelada.startswith('import ')
                           or pelada.startswith('from ')):
            dentro = True
            abiertos = 0
        if dentro:
            abiertos += l.count('(') - l.count(')')
            if abiertos <= 0:
                dentro = False
                fin = i + 1
    return fin


def insertar_linea(texto, indice, linea):
    lineas = texto.splitlines(True)
    lineas.insert(indice, linea)
    return ''.join(lineas)


# ══════════════════════════════════════════════════════════════════════════
# pasos
# ══════════════════════════════════════════════════════════════════════════

def paso_modelo(raiz, simulacro):
    ruta = os.path.join(raiz, 'src/apps/core/models.py')
    if not os.path.exists(ruta):
        return False, 'no existe {0}'.format(ruta)
    t = leer(ruta)
    if 'class CanalDeAcceso' in t:
        return True, 'ya estaba'
    if 'settings' not in t.split('class ')[0]:
        # El parche del celular enlazado ya deberia haberlo puesto; si no
        # esta, se pone, porque el modelo usa settings.AUTH_USER_MODEL.
        m = re.search(r'^from django\.db import models.*$', t, re.M)
        if not m:
            return False, 'core/models.py no importa models; no lo reconozco'
        t = (t[:m.start()] + 'from django.conf import settings\n'
             + t[m.start():])
    escribir(ruta, t.rstrip('\n') + '\n' + MODELO, simulacro)
    return True, 'tabla anadida al final'


def paso_migracion(raiz, simulacro):
    carpeta = os.path.join(raiz, 'src/apps/core/migrations')
    if not os.path.isdir(carpeta):
        return False, 'no existe {0}'.format(carpeta)
    previas = sorted(n[:-3] for n in os.listdir(carpeta)
                     if n.endswith('.py') and n != '__init__.py')
    if any('canal_acceso' in n for n in previas):
        return True, 'ya estaba'
    if not previas:
        return False, 'core no tiene ninguna migracion; no se de cual colgar'
    anterior = previas[-1]
    try:
        numero = int(anterior[:4]) + 1
    except ValueError:
        return False, ('la ultima migracion se llama {0!r} y no empieza por '
                       'un numero de cuatro cifras'.format(anterior))
    nombre = '{0:04d}_canal_acceso.py'.format(numero)
    escribir(os.path.join(carpeta, nombre),
             MIGRACION % {'anterior': anterior}, simulacro)
    return True, '{0}  (depende de {1})'.format(nombre, anterior)


def paso_modulo(raiz, simulacro):
    enlace = os.path.join(raiz, 'src/apps/core/equipo_enlazado.py')
    if not os.path.exists(enlace):
        return False, ('falta equipo_enlazado.py: este parche reutiliza su '
                       'EsGerencia y su es_navegador, asi que primero va el '
                       'del celular enlazado')
    t = leer(enlace)
    faltan = [n for n in ('EsGerencia', 'es_navegador') if 'def %s' % n not in t
              and 'class %s' % n not in t]
    if faltan:
        return False, ('equipo_enlazado.py no define {0}; dime como quedo'
                       .format(', '.join(faltan)))
    ruta = os.path.join(raiz, 'src/apps/core/canal_acceso.py')
    if os.path.exists(ruta) and 'def puede_entrar' in leer(ruta):
        escribir(ruta, MODULO, simulacro)
        return True, 'ya estaba (reescrito)'
    escribir(ruta, MODULO, simulacro)
    return True, 'modulo nuevo'


def paso_urls(raiz, simulacro):
    ruta = os.path.join(raiz, 'src/apps/api/urls.py')
    if not os.path.exists(ruta):
        return False, 'no existe {0}'.format(ruta)
    t = leer(ruta)
    if 'canal_poner' in t:
        return True, 'ya estaba'

    # La ruta va delante de la primera de v1/mobile: asi queda dentro de
    # urlpatterns sin tener que saber como esta escrito urlpatterns.
    lineas = t.splitlines(True)
    destino = None
    for i, l in enumerate(lineas):
        if re.search(r"url\(\s*r'\^v1/mobile/", l):
            destino = i
            break
    if destino is None:
        return False, ("no encuentro ninguna ruta v1/mobile/ en urls.py; "
                       "dime como estan escritas")
    t = ''.join(lineas[:destino]) + RUTA + ''.join(lineas[destino:])
    t = insertar_linea(t, fin_de_imports(t), IMPORT_URLS)
    escribir(ruta, t, simulacro)
    return True, 'import y ruta anadidos'


def paso_serialize(raiz, simulacro):
    ruta = os.path.join(raiz, 'src/apps/api/views/mobile_users.py')
    if not os.path.exists(ruta):
        return False, 'no existe {0}'.format(ruta)
    t = leer(ruta)
    if "'acceso'" in t and 'canal_de' in t:
        return True, 'ya estaba'

    m = re.search(r'^def _serialize\(\s*(\w+)', t, re.M)
    if not m:
        return False, 'no encuentro `def _serialize(` en mobile_users.py'
    parametro = m.group(1)

    # El primer `return {` que haya despues de la firma. Se inyecta la clave
    # justo detras de la llave: asi da igual como este escrito el resto del
    # diccionario, que es lo que no se desde aqui.
    r = re.compile(r'return\s*\{')
    mr = r.search(t, m.end())
    if not mr:
        return False, ('_serialize no devuelve un diccionario literal; '
                       'pegame su cuerpo y lo hago a mano')
    corte = mr.end()
    t = (t[:corte]
         + "\n        # Por donde entra: lo usa la pantalla de usuarios."
           "\n        'acceso': canal_de({0}),".format(parametro)
         + t[corte:])
    t = insertar_linea(t, fin_de_imports(t), IMPORT_USERS)
    escribir(ruta, t, simulacro)
    return True, "_serialize devuelve 'acceso' (parametro {0!r})".format(parametro)


def paso_login(raiz, simulacro):
    ruta = os.path.join(raiz, 'src/apps/api/views/mobile_auth.py')
    if not os.path.exists(ruta):
        return False, 'no existe {0}'.format(ruta)
    t = leer(ruta)
    if 'puede_entrar' in t:
        return True, 'ya estaba'
    if 'registrar_ingreso' not in t:
        return False, ('mobile_auth.py no llama a registrar_ingreso: falta el '
                       'parche del celular enlazado, y este se apoya en el')

    lineas = t.splitlines(True)
    # Cada puerta: delante del bloque del celular, comentario incluido.
    puntos = []
    for i, l in enumerate(lineas):
        if re.search(r'ok_equipo,\s*error_equipo\s*=\s*registrar_ingreso', l):
            sangria = re.match(r'[ \t]*', l).group(0)
            j = i
            while j > 0 and lineas[j - 1].strip().startswith('#'):
                j -= 1
            puntos.append((j, sangria))
    if not puntos:
        return False, ('no encuentro la llamada a registrar_ingreso; dime '
                       'como quedo mobile_auth.py')

    # De abajo arriba, para que insertar no mueva los indices de los de
    # arriba. Un fallo de esos desplaza el segundo injerto media funcion.
    for j, sangria in sorted(puntos, reverse=True):
        lineas.insert(j, COMPROBACION.format(sangria=sangria))
    t = ''.join(lineas)
    t = insertar_linea(t, fin_de_imports(t), IMPORT_AUTH)
    escribir(ruta, t, simulacro)
    return True, 'comprobacion en {0} puerta(s)'.format(len(puntos))


# ══════════════════════════════════════════════════════════════════════════

def main():
    p = argparse.ArgumentParser()
    p.add_argument('--raiz', default='/var/www/envs/prod')
    p.add_argument('--aplicar', action='store_true')
    args = p.parse_args()
    simulacro = not args.aplicar

    if not os.path.isfile(os.path.join(args.raiz, 'src/apps/api/urls.py')):
        print('No parece el proyecto de PLUVIRA: no hay '
              '{0}/src/apps/api/urls.py'.format(args.raiz))
        print('Pasa la ruta buena con --raiz.')
        sys.exit(1)

    print('Raiz: {0}'.format(args.raiz))
    print('Modo: {0}'.format('SIMULACRO (no escribe nada)' if simulacro
                             else 'APLICANDO'))
    print('')

    pasos = [
        ('1 models.py      ', paso_modelo),
        ('2 migracion      ', paso_migracion),
        ('3 canal_acceso.py', paso_modulo),
        ('4 urls.py        ', paso_urls),
        ('5 _serialize     ', paso_serialize),
        ('6 login          ', paso_login),
    ]
    fallo = False
    for nombre, fn in pasos:
        try:
            ok, detalle = fn(args.raiz, simulacro)
        except Exception as e:                        # noqa: BLE001
            ok, detalle = False, 'reviento: {0}'.format(e)
        print('[{0}] {1}  {2}'.format('OK ' if ok else 'MAL', nombre, detalle))
        if not ok:
            fallo = True

    print('')
    if fallo:
        print('NO se aplico todo. Lo marcado MAL hay que mirarlo antes de')
        print('seguir: parado asi, el proyecto esta como estaba.')
        sys.exit(1)
    if simulacro:
        print('Simulacro: no se escribio nada. Si todo sale OK arriba,')
        print('vuelve a correrlo con --aplicar.')
        return
    print('Aplicado. Quedan .bak de cada archivo tocado. Ahora:')
    print('')
    print('    manage.py makemigrations core --dry-run   # "No changes detected"')
    print('    manage.py migrate core')
    print('    reiniciar jurp_web')
    print('')
    print('TODAVIA NO LIMITA A NADIE: la tabla nace vacia y sin fila se')
    print('entra por los dos sitios. El boton «Acceso» de la web aparece')
    print('solo en cuanto el servidor empieza a mandar el campo.')


if __name__ == '__main__':
    main()
