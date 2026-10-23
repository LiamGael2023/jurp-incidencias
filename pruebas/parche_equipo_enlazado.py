# -*- coding: utf-8 -*-
"""Una cuenta, un celular. Para Django 1.8 / Python 3.5 / DRF 3.6.

    python3 parche_equipo_enlazado.py                 # solo mira
    python3 parche_equipo_enlazado.py --aplicar        # aplica
    python3 parche_equipo_enlazado.py --base /ruta     # si no autodetecta

SE CORRE EN EL BACKEND DE PLUVIRA, en la maquina donde esta /app (el
contenedor jurp_web). No en el Linode de vigilantes.

ESTA ESCRITO CONTRA ESE PROYECTO, no contra uno generico. Se miro antes:

    Django 1.8.4, Python 3.5.10, DRF 3.6.4
    la vista es MobileAuthLoginView (APIView, escrita a mano) en
        src/apps/api/views/mobile_auth.py
    su ruta en src/apps/api/urls.py, con url(r'^...$')
    los tokens son rest_framework.authtoken, user OneToOneField

Eso ultimo es lo que hace falta arreglar: con OneToOneField, entrar desde un
segundo celular devuelve EL MISMO token, y por eso hoy se pueden pasar la
cuenta sin que nada lo note.

DJANGO 1.8 NO TIENE path(). Las rutas se escriben url(r'^...$'), y un parche
con path() no arranca el proyecto. Por eso este no es el mismo parche que
sirve para el Linode.

QUE TOCA

    1. src/apps/core/models.py            las dos tablas, al final
    2. src/apps/core/equipo_enlazado.py   la decision y el panel  (NUEVO)
    3. src/apps/api/urls.py               las dos rutas del panel
    4. src/apps/api/views/mobile_auth.py  la comprobacion en el login
    5. src/apps/core/management/commands/botar_a_todos.py   el corte (NUEVO)

El unico cambio dentro de codigo que ya funciona es el 4, y son cinco lineas
justo antes de crear el token. La forma de la respuesta no se toca: las apps
y la web ya esperan {ok, token, user, mobile_panels, push}.

EL ORDEN DEL ENCENDIDO, que hecho al reves deja fuera a la gente de campo:

    1. Aplicar esto y migrar. NADIE nota nada: el interruptor nace apagado.
    2. Publicar la app que manda device_id.
    3. Mirar en el panel cuantos entran SIN identificar. Baja solo.
    4. En cero: EXIGIR_DISPOSITIVO = True en settings, y
       `manage.py botar_a_todos --de-verdad` para que todos vuelvan a entrar
       y queden enlazados de una vez.

Si el bloqueo se activara al desplegar, los pasos 1 y 4 serian el mismo y no
habria ventana para que la gente actualice.
"""

from __future__ import print_function

import ast
import datetime
import io
import os
import re
import shutil
import sys

APLICAR = "--aplicar" in sys.argv

CANDIDATOS = ["/app", "/var/www/envs/prod", os.getcwd()]


def base_del_proyecto():
    if "--base" in sys.argv:
        return sys.argv[sys.argv.index("--base") + 1]
    for c in CANDIDATOS:
        if os.path.isfile(os.path.join(c, "src", "apps", "api", "urls.py")):
            return c
    return os.getcwd()


MODELOS = r'''

# ══════════════════════════════════════════════════════════════════════════
# UNA CUENTA, UN CELULAR   (lo escribe parche_equipo_enlazado.py)
# ══════════════════════════════════════════════════════════════════════════
#
# Para que prestar la clave no sirva: la cuenta queda atada al telefono desde
# el que se entro la primera vez. DISUADE, NO BLINDA -una app modificada
# puede falsear su identificador-, pero frena el prestamo entre companeros,
# que es el problema real.

class DispositivoAutorizado(models.Model):
    """El celular al que esta atada una cuenta.

    UNO SOLO ACTIVO POR USUARIO; los anteriores quedan como historial, que es
    justo para lo que sirve tenerlo en una tabla y no en un campo del
    usuario. Un campo sabria donde esta ahora; la tabla sabe por donde paso,
    y eso es lo que hace falta cuando alguien dice "me liberaron y sigo sin
    entrar".
    """

    usuario = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
        related_name='dispositivos', verbose_name='Usuario')

    # El identificador que manda la app: androidInfo.id en Android,
    # identifierForVendor en iOS. NINGUNO ES ETERNO -el de Android se
    # reinicia al restaurar de fabrica y el de iOS se borra al desinstalar
    # todas las apps del fabricante-, y por eso liberar no es un extra.
    device_id = models.CharField('Identificador del equipo', max_length=128,
                                 db_index=True)
    equipo = models.CharField('Equipo', max_length=120, blank=True, default='')
    plataforma = models.CharField('Plataforma', max_length=20, blank=True,
                                  default='')

    creado = models.DateTimeField('Enlazado el', auto_now_add=True)
    ultimo_uso = models.DateTimeField('Ultimo uso', null=True, blank=True)
    activo = models.BooleanField('Vigente', default=True, db_index=True)

    # LA FIRMA. Sin ella, "quien libero esta cuenta tres veces este mes" no
    # tiene respuesta, y esa pregunta aparece en cuanto esto lleva un tiempo.
    liberado_por = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True,
        blank=True, related_name='liberaciones', verbose_name='Liberado por')
    liberado_en = models.DateTimeField('Liberado el', null=True, blank=True)

    class Meta:
        verbose_name = 'Equipo enlazado'
        verbose_name_plural = 'Equipos enlazados'
        ordering = ['-activo', '-ultimo_uso', '-creado']

    def __str__(self):
        return '{0} - {1}'.format(self.usuario,
                                  self.equipo or self.device_id[:12])

    def liberar(self, por=None):
        from django.utils import timezone
        self.activo = False
        self.liberado_por = por
        self.liberado_en = timezone.now()
        self.save(update_fields=['activo', 'liberado_por', 'liberado_en'])


class IngresoSinEquipo(models.Model):
    """Quien entro sin mandar identificador, o sea con la app vieja.

    ES EL NUMERO QUE DECIDE CUANDO SE PUEDE ENCENDER EL BLOQUEO. Mientras
    haya gente aqui, encenderlo los deja fuera, y son los de campo. Se guarda
    uno por usuario y no un historial: lo unico que hace falta saber es si a
    dia de hoy alguien sigue sin actualizar.
    """

    usuario = models.OneToOneField(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
        related_name='ingreso_sin_equipo')
    ultima_vez = models.DateTimeField(auto_now=True)
    veces = models.PositiveIntegerField(default=0)

    class Meta:
        verbose_name = 'Ingreso sin equipo'
        verbose_name_plural = 'Ingresos sin equipo'

    def __str__(self):
        return '{0} ({1})'.format(self.usuario, self.veces)
'''

MODULO = r'''# -*- coding: utf-8 -*-
"""Una cuenta, un celular: la decision y el panel.

Lo escribe parche_equipo_enlazado.py. No se edita a mano: el parche lo
reemplaza entero.

Los modelos viven en models.py, al lado de los demas, porque en Django 1.8
un modelo fuera de models.py necesita app_label y que alguien lo importe al
arrancar: dos maneras mas de que falle sin decirlo.
"""

from django.conf import settings
from django.utils import timezone

from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAdminUser
from rest_framework.response import Response

from .models import DispositivoAutorizado, IngresoSinEquipo


CORTADO = 'cortado'
ENLAZA = 'enlaza'
SIGUE = 'sigue'
SIN_ID = 'sin_id'


def decidir(enlace_activo, device_id, exigir):
    """Que hacer con este ingreso. Funcion pura: se prueba sin base de datos.

    → (que_hacer, codigo_de_error)

      ENLAZA   no tenia equipo: este queda enlazado
      SIGUE    es el mismo equipo: pasa
      CORTADO  es otro equipo, o falta el identificador y se exige
      SIN_ID   no mando identificador (app vieja) y todavia no se exige

    EL ORDEN IMPORTA Y ES PARTE DE LA REGLA. Mirar si falta el identificador
    va PRIMERO. Comparando antes, una app vieja sin enlace previo quedaria
    ENLAZADA con un identificador vacio, y a partir de ahi cualquier otra app
    vieja coincidiria con el: un agujero que se abre solo.

    El .strip() tampoco es adorno: una cadena de espacios es verdadera en
    Python, asi que sin el, un "   " pasaria por identificador valido.
    """
    device_id = (device_id or '').strip()
    if not device_id:
        return (CORTADO, 'falta_device_id') if exigir else (SIN_ID, None)
    if enlace_activo is None:
        return (ENLAZA, None)
    if enlace_activo.device_id == device_id:
        return (SIGUE, None)
    return (CORTADO, 'equipo_distinto')


def enlace_de(usuario):
    return DispositivoAutorizado.objects.filter(
        usuario=usuario, activo=True).first()


def exigir_equipo():
    """El interruptor. Apagado por defecto, y eso no es pereza.

    Encenderlo el dia del despliegue deja fuera a todo el que no haya
    actualizado la app, que son los de campo. Se enciende un dia concreto,
    cuando el panel enseñe cero ingresos sin identificar.
    """
    return bool(getattr(settings, 'EXIGIR_DISPOSITIVO', False))


def registrar_ingreso(usuario, device_id, equipo='', plataforma=''):
    """Aplica la regla y deja constancia.

    → (ok, dict_de_error_o_None)
    """
    device_id = (device_id or '').strip()
    enlace = enlace_de(usuario)
    que, codigo = decidir(enlace, device_id, exigir_equipo())

    if que == SIN_ID:
        fila, _ = IngresoSinEquipo.objects.get_or_create(usuario=usuario)
        fila.veces = (fila.veces or 0) + 1
        fila.save()
        return True, None

    if que == SIGUE:
        enlace.ultimo_uso = timezone.now()
        enlace.equipo = (equipo or enlace.equipo)[:120]
        enlace.plataforma = (plataforma or enlace.plataforma)[:20]
        enlace.save(update_fields=['ultimo_uso', 'equipo', 'plataforma'])
        # Ya identifica su equipo: sale de la lista de pendientes.
        IngresoSinEquipo.objects.filter(usuario=usuario).delete()
        return True, None

    if que == ENLAZA:
        DispositivoAutorizado.objects.create(
            usuario=usuario, device_id=device_id, equipo=(equipo or '')[:120],
            plataforma=(plataforma or '')[:20], ultimo_uso=timezone.now())
        IngresoSinEquipo.objects.filter(usuario=usuario).delete()
        return True, None

    # CORTADO. El mensaje de cada caso manda a un sitio distinto: actualizar
    # la app no es lo mismo que pedir que te liberen, y un texto unico
    # mandaria a la mitad de la gente al sitio equivocado.
    if codigo == 'falta_device_id':
        return False, {
            'detail': 'Actualiza la aplicacion para poder entrar.',
            'codigo': codigo,
        }
    return False, {
        'detail': 'Esta cuenta esta enlazada a otro equipo. '
                  'Pide a administracion que la libere.',
        'codigo': codigo,
        'equipo_enlazado': enlace.equipo or 'otro equipo',
        'desde': enlace.creado,
    }


# ══════════════════════════════════════════════════════════════════════════
# EL PANEL
# ══════════════════════════════════════════════════════════════════════════

def _corto(device_id):
    """El identificador, recortado.

    En el panel sirve para distinguir dos equipos. Completo es justo el dato
    que habria que falsear para saltarse esto, asi que no se ensena entero.
    """
    d = device_id or ''
    return '{0}…{1}'.format(d[:4], d[-4:]) if len(d) > 10 else d


def _fila(d):
    u = d.usuario
    nombre = ''
    try:
        nombre = (u.get_full_name() or '').strip()
    except Exception:
        pass
    return {
        'id': d.id,
        'usuario': u.get_username(),
        'nombre_usuario': nombre,
        'equipo': d.equipo,
        'plataforma': d.plataforma,
        'device_id': _corto(d.device_id),
        'desde': d.creado,
        'ultimo_uso': d.ultimo_uso,
        'activo': d.activo,
        'liberado_por': d.liberado_por.get_username() if d.liberado_por else None,
        'liberado_en': d.liberado_en,
    }


@api_view(['GET'])
@permission_classes([IsAdminUser])
def dispositivos(request):
    """Los equipos enlazados, para el panel.

    Solo administradores: esta lista dice desde que equipo entra cada
    persona, y quien pueda leerla puede tambien liberarlos.
    """
    from django.db.models import Q

    estado = (request.query_params.get('estado') or 'activos').lower()
    qs = DispositivoAutorizado.objects.select_related('usuario', 'liberado_por')
    if estado == 'activos':
        qs = qs.filter(activo=True)
    elif estado == 'liberados':
        qs = qs.filter(activo=False)

    q = (request.query_params.get('q') or '').strip()
    if q:
        qs = qs.filter(Q(usuario__username__icontains=q)
                       | Q(equipo__icontains=q))

    return Response({
        # Cuantos siguen con la app vieja. Es el numero que decide si se
        # puede encender el bloqueo sin dejar a nadie fuera.
        'sin_identificar': IngresoSinEquipo.objects.count(),
        'exigiendo': exigir_equipo(),
        'resultados': [_fila(d) for d in qs[:500]],
    })


@api_view(['POST'])
@permission_classes([IsAdminUser])
def liberar(request, pk):
    """Suelta la cuenta de su equipo. Queda firmado quien y cuando."""
    d = DispositivoAutorizado.objects.filter(pk=pk).first()
    if d is None:
        return Response({'detail': 'No existe ese enlace.'},
                        status=status.HTTP_404_NOT_FOUND)
    if not d.activo:
        # Liberar dos veces no es un error, pero decir "hecho" borraria la
        # primera firma, que es la que dice quien lo solto de verdad.
        return Response({'detail': 'Ese enlace ya estaba liberado.',
                         'codigo': 'ya_liberado'},
                        status=status.HTTP_409_CONFLICT)
    usuario = request.user if request.user.is_authenticated() else None
    d.liberar(por=usuario)
    return Response(_fila(d))
'''

COMANDO = r'''# -*- coding: utf-8 -*-
"""Invalida TODOS los tokens: todo el mundo vuelve a entrar.

    python manage.py botar_a_todos --de-verdad

SIN --de-verdad SOLO CUENTA. Esto cierra la sesion de todo el mundo a la
vez, incluida la tuya y la de quien este en campo en ese momento. Pedir una
bandera extra es a proposito.

PARA QUE. El dia del corte: con EXIGIR_DISPOSITIVO encendido, cada quien
vuelve a entrar y su celular queda enlazado de una vez, en vez de ir
enlazandose a cuentagotas durante semanas.

SE NIEGA SI QUEDA GENTE CON LA APP VIEJA. Con el bloqueo encendido, esos no
pueden volver a entrar, y son los de campo. Se avisa y no se borra nada,
salvo que se insista con --aunque-falten.
"""

from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = "Invalida todos los tokens para que todos vuelvan a entrar."

    def add_arguments(self, parser):
        parser.add_argument("--de-verdad", action="store_true",
                            dest="de_verdad",
                            help="Sin esto solo cuenta, no borra.")
        parser.add_argument("--aunque-falten", action="store_true",
                            dest="aunque_falten",
                            help="Corta aunque quede gente con la app vieja.")

    def handle(self, *args, **opciones):
        from rest_framework.authtoken.models import Token
        from src.apps.core.equipo_enlazado import exigir_equipo
        from src.apps.core.models import IngresoSinEquipo

        total = Token.objects.count()
        sin_id = IngresoSinEquipo.objects.count()

        self.stdout.write("")
        self.stdout.write("tokens vivos     : %s" % total)
        self.stdout.write("sin identificar  : %s" % sin_id)
        self.stdout.write("exigiendo equipo : %s" % exigir_equipo())
        self.stdout.write("")

        if sin_id and exigir_equipo() and not opciones["aunque_falten"]:
            self.stdout.write(self.style.ERROR(
                "NO SE BORRA NADA: %s usuario(s) entran sin identificar su "
                "equipo." % sin_id))
            self.stdout.write(
                "Siguen con la app vieja. Con el bloqueo encendido no van a "
                "poder volver a entrar, y son los de campo.")
            self.stdout.write(
                "Espera a que ese numero sea cero, o repite con "
                "--aunque-falten.")
            return

        if not opciones["de_verdad"]:
            self.stdout.write("Nada borrado. Para hacerlo:")
            self.stdout.write("    manage.py botar_a_todos --de-verdad")
            return

        borrados = Token.objects.all().delete()[0]
        self.stdout.write(self.style.SUCCESS(
            "Listo: %s token(s) invalidados. Todos vuelven a entrar."
            % borrados))
'''


# ══════════════════════════════════════════════════════════════════════════
# 1. los modelos, al final de core/models.py
# ══════════════════════════════════════════════════════════════════════════

def paso_modelos(texto):
    if "class DispositivoAutorizado" in texto:
        return texto, "ya estaban: las dos tablas"
    # settings hace falta para AUTH_USER_MODEL, y puede no estar importado.
    cabeza = texto.split("class ")[0]
    extra = ""
    if not re.search(r"^from django\.conf import settings", cabeza, re.M):
        m = re.search(r"^from django\.db import models.*$", texto, re.M)
        if not m:
            return None, "core/models.py no importa models; no lo reconozco"
        texto = (texto[:m.start()] + "from django.conf import settings\n"
                 + texto[m.start():])
        extra = " (y el import de settings)"
    return texto.rstrip("\n") + "\n" + MODELOS, "anadidas las dos tablas" + extra


# ══════════════════════════════════════════════════════════════════════════
# 3. las rutas del panel, en api/urls.py
# ══════════════════════════════════════════════════════════════════════════

ANCLA_RUTA = "mobile_auth_login"

RUTAS = (
    "    # Equipos enlazados: el panel de administracion.\n"
    "    url(r'^v1/mobile/auth/dispositivos/$',\n"
    "        equipo_dispositivos, name='mobile_dispositivos'),\n"
    "    url(r'^v1/mobile/auth/dispositivos/(?P<pk>[0-9]+)/liberar/$',\n"
    "        equipo_liberar, name='mobile_dispositivo_liberar'),\n")

IMPORT_URLS = ("from src.apps.core.equipo_enlazado import (\n"
               "    dispositivos as equipo_dispositivos,\n"
               "    liberar as equipo_liberar,\n"
               ")\n")


def fin_de_imports(texto, limite):
    """Donde acaba el ultimo import de arriba, antes de `limite`.

    POR QUE NO SE ANCLA EN urlpatterns. La primera version buscaba
    `urlpatterns = [` para meter el import justo encima, y en este proyecto
    no existe: Django 1.8 todavia admite `urlpatterns = patterns('', ...)`,
    y hay mas formas -`+= [`, `format_suffix_patterns(...)`-. Anclar ahi era
    adivinar una de ellas. El ultimo import de arriba esta en cualquier
    fichero de urls, venga como venga.

    Cuenta parentesis porque `from x import (\\n a,\\n b,\\n)` ocupa varias
    lineas: meter algo detras de la primera parte el import en dos y el
    proyecto no arranca.
    """
    fin = 0
    pos = 0
    abierto = 0
    dentro = False
    for linea in texto.splitlines(True):
        ini = pos
        pos += len(linea)
        if ini >= limite:
            break
        if not dentro:
            if not re.match(r"^(from|import)\s", linea):
                continue
            dentro = True
            abierto = 0
        abierto += linea.count("(") - linea.count(")")
        if abierto <= 0:
            dentro = False
            fin = pos
    return fin


def paso_urls(texto):
    if "equipo_enlazado" in texto:
        return texto, "ya estaban: las rutas del panel"

    # La ruta del login es el ancla: lo que se anade va justo detras, para
    # que las tres queden juntas y se lean como lo que son.
    m = None
    for linea in re.finditer(r"^.*%s.*$\n?" % re.escape(ANCLA_RUTA), texto, re.M):
        m = linea
        break
    if m is None:
        return None, ("no encuentro la ruta %r en api/urls.py; dime como "
                      "quedo" % ANCLA_RUTA)
    if "url(" not in texto:
        return None, "api/urls.py no usa url(); no lo reconozco"

    i = fin_de_imports(texto, m.start())
    if i <= 0:
        return None, "api/urls.py no tiene imports arriba; no lo reconozco"

    # Primero el import, luego las rutas: al reves, meter el import mueve
    # las rutas de sitio y m.end() ya no vale.
    texto = texto[:i] + "\n" + IMPORT_URLS + texto[i:]
    texto = (texto[:m.end() + len(IMPORT_URLS) + 1] + RUTAS
             + texto[m.end() + len(IMPORT_URLS) + 1:])
    return texto, "anadidas las dos rutas del panel"


# ══════════════════════════════════════════════════════════════════════════
# 4. la comprobacion en el login
# ══════════════════════════════════════════════════════════════════════════

ANCLA_LOGIN = "        token, _ = Token.objects.get_or_create(user=user)"

COMPROBACION = '''        # ── UNA CUENTA, UN CELULAR ──
        # Va DESPUES de comprobar la clave y el perfil, y ANTES de crear el
        # token: si fuera antes, diria "equipo distinto" a quien escribio mal
        # la contrasena, y eso le cuenta a un desconocido que esa cuenta
        # existe. Si fuera despues, el token ya estaria entregado.
        ok_equipo, error_equipo = registrar_ingreso(
            user,
            request.data.get('device_id', ''),
            request.data.get('equipo', ''),
            request.data.get('plataforma', ''),
        )
        if not ok_equipo:
            error_equipo['ok'] = False
            return Response(error_equipo, status=status.HTTP_403_FORBIDDEN)

'''

IMPORT_LOGIN = "from src.apps.core.equipo_enlazado import registrar_ingreso\n"


def paso_login(texto):
    if "registrar_ingreso" in texto:
        return texto, "ya estaba: la comprobacion en el login"
    if texto.count(ANCLA_LOGIN) != 1:
        return None, ("en mobile_auth.py esperaba UNA linea %r y hay %d; "
                      "dime como quedo" % (ANCLA_LOGIN.strip(),
                                           texto.count(ANCLA_LOGIN)))
    i = texto.index(ANCLA_LOGIN)
    texto = texto[:i] + COMPROBACION + texto[i:]

    m = re.search(r"^from src\.apps\.core\.mobile_role_panels import.*$\n",
                  texto, re.M)
    if m is None:
        m = re.search(r"^from rest_framework\.views import APIView$\n", texto, re.M)
    if m is None:
        return None, "no se donde poner el import en mobile_auth.py"
    texto = texto[:m.end()] + IMPORT_LOGIN + texto[m.end():]
    return texto, "anadida la comprobacion al login"


# ══════════════════════════════════════════════════════════════════════════

def respaldo(ruta):
    sello = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    copia = "%s.bak-%s" % (ruta, sello)
    shutil.copy2(ruta, copia)
    return copia


def principal():
    base = base_del_proyecto()
    f_models = os.path.join(base, "src", "apps", "core", "models.py")
    f_mod = os.path.join(base, "src", "apps", "core", "equipo_enlazado.py")
    f_urls = os.path.join(base, "src", "apps", "api", "urls.py")
    f_login = os.path.join(base, "src", "apps", "api", "views", "mobile_auth.py")
    d_cmd = os.path.join(base, "src", "apps", "core", "management", "commands")
    f_cmd = os.path.join(d_cmd, "botar_a_todos.py")

    print("proyecto: %s" % base)
    print("modo    : %s" % ("APLICAR" if APLICAR else "solo mostrar"))
    print("")

    for f in (f_models, f_urls, f_login):
        if not os.path.isfile(f):
            print("MAL  no encuentro %s" % f)
            print("     Pasa la raiz del proyecto con --base /ruta.")
            return 1

    txt_m = io.open(f_models, encoding="utf-8").read()
    txt_u = io.open(f_urls, encoding="utf-8").read()
    txt_l = io.open(f_login, encoding="utf-8").read()

    nuevo_m, av_m = paso_modelos(txt_m)
    nuevo_u, av_u = paso_urls(txt_u)
    nuevo_l, av_l = paso_login(txt_l)

    print("1. core/models.py          %s" % av_m)
    print("2. core/equipo_enlazado.py %s" % (
        "se reescribe" if os.path.isfile(f_mod) else "se crea"))
    print("3. api/urls.py             %s" % av_u)
    print("4. api/.../mobile_auth.py  %s" % av_l)
    print("5. botar_a_todos.py        %s" % (
        "se reescribe" if os.path.isfile(f_cmd) else "se crea"))
    print("")

    fallos = []
    for quien, nuevo, av in (("core/models.py", nuevo_m, av_m),
                             ("api/urls.py", nuevo_u, av_u),
                             ("mobile_auth.py", nuevo_l, av_l)):
        if nuevo is None:
            fallos.append("%s: %s" % (quien, av))
    if fallos:
        print("NO SE ESCRIBE NADA. A medias es peor que sin empezar:")
        for f in fallos:
            print("   - %s" % f)
        print("")
        print("Mandame esta salida y lo ajusto.")
        return 1

    # Se comprueba el RESULTADO, no la intencion.
    comprobaciones = (
        ("core/models.py", nuevo_m, "class DispositivoAutorizado"),
        ("core/models.py", nuevo_m, "class IngresoSinEquipo"),
        ("api/urls.py", nuevo_u, "equipo_dispositivos"),
        ("api/urls.py", nuevo_u, "liberar/$"),
        ("mobile_auth.py", nuevo_l, "registrar_ingreso("),
        ("mobile_auth.py", nuevo_l, "HTTP_403_FORBIDDEN"),
    )
    for quien, txt, falta in comprobaciones:
        if falta not in txt:
            print("NO SE ESCRIBE NADA: en %s no salio %r." % (quien, falta))
            return 1
    # Y que siga siendo Python. Se inserta en ficheros cuya forma exacta no
    # se ve desde aqui -un import de varias lineas, por ejemplo-, y un
    # fichero partido por la mitad no se nota hasta que el proyecto no
    # arranca. Solo se culpa al parche de lo que el parche rompio: si el
    # original ya no parseaba, no es cosa nuestra.
    for quien, viejo, nuevo in (("core/models.py", txt_m, nuevo_m),
                                ("api/urls.py", txt_u, nuevo_u),
                                ("mobile_auth.py", txt_l, nuevo_l)):
        try:
            ast.parse(viejo)
        except SyntaxError:
            continue
        try:
            ast.parse(nuevo)
        except SyntaxError as e:
            print("NO SE ESCRIBE NADA: %s quedaria roto (%s)." % (quien, e))
            print("Mandame esta salida y lo ajusto.")
            return 1

    # La comprobacion tiene que quedar ANTES de crear el token, no despues.
    if nuevo_l.index("registrar_ingreso(") > nuevo_l.index(ANCLA_LOGIN.strip()):
        print("NO SE ESCRIBE NADA: la comprobacion quedo DESPUES de crear el")
        print("token. Asi el token ya estaria entregado cuando se rechaza.")
        return 1

    if not APLICAR:
        print("Nada tocado. Para aplicarlo:")
        print("    python3 %s --aplicar" % os.path.basename(__file__))
        return 0

    escritos = []
    for ruta, viejo, nuevo, nombre in (
            (f_models, txt_m, nuevo_m, "core/models.py"),
            (f_urls, txt_u, nuevo_u, "api/urls.py"),
            (f_login, txt_l, nuevo_l, "mobile_auth.py")):
        if nuevo != viejo:
            print("respaldo %s" % respaldo(ruta))
            io.open(ruta, "w", encoding="utf-8").write(nuevo)
            escritos.append(nombre)

    # El modulo se reescribe siempre: lo escribe este parche entero.
    io.open(f_mod, "w", encoding="utf-8").write(MODULO)
    escritos.append("equipo_enlazado.py")

    for d in (os.path.dirname(d_cmd), d_cmd):
        if not os.path.isdir(d):
            os.makedirs(d)
        ini = os.path.join(d, "__init__.py")
        if not os.path.isfile(ini):
            io.open(ini, "w", encoding="utf-8").write("")
    io.open(f_cmd, "w", encoding="utf-8").write(COMANDO)
    escritos.append("botar_a_todos.py")

    print("")
    print("escrito: %s" % ", ".join(escritos))
    print("")
    print("Hay migracion -dos tablas nuevas-:")
    print("    docker exec -it jurp_web python manage.py makemigrations core")
    print("    docker exec -it jurp_web python manage.py migrate")
    print("    docker restart jurp_web")
    print("")
    print("TODAVIA NO RECHAZA A NADIE: EXIGIR_DISPOSITIVO nace apagado, y")
    print("quien no mande device_id entra igual y queda apuntado. Eso es lo")
    print("que permite publicar la app sin dejar a nadie fuera.")
    return 0


if __name__ == "__main__":
    sys.exit(principal())
