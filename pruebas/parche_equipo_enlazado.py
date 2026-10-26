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
from rest_framework.response import Response

from .models import DispositivoAutorizado, IngresoSinEquipo
from .permission import IsMobileRoleUser


GRUPO_GERENCIA = 'mobile_gerencia'


class EsGerencia(IsMobileRoleUser):
    """Quien administra usuarios tambien administra sus equipos.

    Estas dos vistas pedian IsAdminUser, o sea is_staff, mientras que crear
    usuarios, resetear claves y cambiar roles lo autoriza el grupo
    mobile_gerencia. La puerta menos peligrosa tenia la cerradura mas dura.

    Repartir is_staff para abrirla tenia dos efectos que nadie queria: da
    entrada al admin de Django, y ademas ESCONDE a esa persona de la propia
    gestion de usuarios, porque MobileUserListView filtra is_staff=False.
    Quien se daba el permiso para ver los equipos se quedaba sin poder ser
    gestionado.

    Se alinean las dos puertas con el mismo grupo.
    """
    message = 'Solo Gerencia puede ver y liberar los equipos enlazados.'

    def has_permission(self, request, view):
        if not super(EsGerencia, self).has_permission(request, view):
            return False
        return request.user.groups.filter(name=GRUPO_GERENCIA).exists()


CORTADO = 'cortado'
ENLAZA = 'enlaza'
SIGUE = 'sigue'
SIN_ID = 'sin_id'
EXENTO = 'exento'

WEB = 'web'


def decidir(enlace_activo, device_id, exigir, es_web=False):
    """Que hacer con este ingreso. Funcion pura: se prueba sin base de datos.

    → (que_hacer, codigo_de_error)

      EXENTO   es el navegador: ni se enlaza ni se cuenta
      ENLAZA   no tenia equipo: este queda enlazado
      SIGUE    es el mismo equipo: pasa
      CORTADO  es otro equipo, o falta el identificador y se exige
      SIN_ID   no mando identificador (app vieja) y todavia no se exige

    POR QUE EL NAVEGADOR VA APARTE, Y ES LO MAS IMPORTANTE DE AQUI. La web
    no tiene ni tendra un identificador de equipo que valga la pena enlazar.
    Si contara como "sin identificar", ese numero -el que decide cuando se
    puede encender el bloqueo- no llegaria a cero nunca, porque la web
    siempre va a entrar sin el. Y el dia que se encendiera el bloqueo, la web
    dejaria de funcionar para TODOS de golpe.

    Lo que paga: una app modificada que mande plataforma='web' se salta el
    enlace. Es el mismo nivel que falsear el identificador -esto disuade, no
    blinda- y es el precio de que la web siga entrando. Se puede vigilar: en
    el panel, un usuario de campo entrando como 'web' se ve.

    EL ORDEN IMPORTA Y ES PARTE DE LA REGLA. Mirar si falta el identificador
    va antes de comparar. Comparando antes, una app vieja sin enlace previo
    quedaria ENLAZADA con un identificador vacio, y a partir de ahi cualquier
    otra app vieja coincidiria con el: un agujero que se abre solo.

    El .strip() tampoco es adorno: una cadena de espacios es verdadera en
    Python, asi que sin el, un "   " pasaria por identificador valido.
    """
    if es_web:
        return (EXENTO, None)
    device_id = (device_id or '').strip()
    if not device_id:
        return (CORTADO, 'falta_device_id') if exigir else (SIN_ID, None)
    if enlace_activo is None:
        return (ENLAZA, None)
    if enlace_activo.device_id == device_id:
        return (SIGUE, None)
    return (CORTADO, 'equipo_distinto')


def es_navegador(plataforma):
    """Solo un 'web' explicito. Que no mande nada NO es la web.

    Si la ausencia contara como navegador, la app vieja -que tampoco manda
    plataforma- quedaria exenta tambien, y el bloqueo no morderia a nadie.
    """
    return (plataforma or '').strip().lower() == WEB


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
    if es_navegador(plataforma):
        # Ni se enlaza ni se cuenta: la web no tiene equipo que enlazar, y
        # contarla dejaria el numero que abre el bloqueo clavado por encima
        # de cero para siempre.
        return True, None

    enlace = enlace_de(usuario)
    que, codigo = decidir(enlace, device_id, exigir_equipo())

    if que == EXENTO:
        return True, None

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
    return False, motivo_del_corte(codigo, enlace)


def motivo_del_corte(codigo, enlace):
    """El cuerpo del 403. Lo comparten las dos puertas de entrada.

    Se mandan `detail` Y `error` con el mismo texto a proposito: la vista del
    login normal responde {'ok': False, 'detail': ...} y la de operadores
    {'ok': False, 'error': ...}. Cada app lee el campo de su puerta, y asi
    ninguna de las dos necesita cambiar para enseñar el motivo.
    """
    if codigo == 'falta_device_id':
        texto = 'Actualiza la aplicacion para poder entrar.'
        cuerpo = {'codigo': codigo}
    else:
        texto = ('Esta cuenta esta enlazada a otro equipo. '
                 'Pide a administracion que la libere.')
        cuerpo = {
            'codigo': codigo,
            'equipo_enlazado': (enlace.equipo if enlace else '') or 'otro equipo',
            'desde': enlace.creado if enlace else None,
        }
    cuerpo['detail'] = texto
    cuerpo['error'] = texto
    return cuerpo


def registrar_ingreso_otra_puerta(usuario, device_id, equipo='', plataforma=''):
    """La segunda puerta: /api/v1/mobile/operators/auth/login/.

    POR QUE NO ES LA MISMA FUNCION. Esa vista entrega EL MISMO token -los
    tokens de DRF son uno por usuario-, asi que quien entre por ahi puede
    usarlo contra toda la API. Si no se mirara, seria una puerta lateral al
    enlace de equipos.

    PERO NO PUEDE ENLAZAR NADA. Esa puerta la cruza hoy una sola cuenta, de
    una app que no manda identificador de equipo. Atarla al primer celular
    que entre dejaria fuera a los demas, y contarla como "sin identificar"
    dejaria clavado por encima de cero el numero que abre el bloqueo. Es el
    mismo razonamiento que con el navegador.

    ASI QUE LA REGLA ES AL REVES: esta puerta no enlaza, no cuenta y no toca
    nada. Solo mira. Y solo tiene algo que mirar cuando la cuenta YA esta
    enlazada por la puerta principal -es decir, cuando es un usuario de campo
    con su celular-, que es justo el caso que esto viene a impedir.

    Lo bueno de atarlo al enlace y no a una lista de usuarios: el dia que
    alguien meta a un usuario de campo en admin_operators, la puerta se le
    cierra sola. Una lista habria que acordarse de actualizarla, y nadie se
    acuerda.
    """
    enlace = enlace_de(usuario)
    if enlace is None:
        return True, None

    que, codigo = decidir(enlace, (device_id or '').strip(), exigir_equipo(),
                          es_navegador(plataforma))
    if que == CORTADO:
        return False, motivo_del_corte(codigo, enlace)
    return True, None


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
@permission_classes([EsGerencia])
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
@permission_classes([EsGerencia])
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

# ── 4b. la segunda puerta ────────────────────────────────────────────────
# /api/v1/mobile/operators/auth/login/ entrega EL MISMO token, asi que sin
# esto seria una puerta lateral al enlace. Va en el mismo sitio: despues de
# la clave y del perfil, antes del token. Esta vista responde con 'error' y
# no con 'detail', y por eso motivo_del_corte manda los dos campos.

ANCLA_OPER = "        token, _ = Token.objects.get_or_create(user=user)"

COMPROBACION_OPER = '''        # ── UNA CUENTA, UN CELULAR (la segunda puerta) ──
        # No enlaza ni cuenta: solo mira, y solo si la cuenta YA esta
        # enlazada por la puerta principal. Asi la unica cuenta que usa hoy
        # esta entrada -que no manda identificador- sigue entrando igual, y
        # el dia que alguien meta aqui a un usuario de campo, se le cierra
        # sola.
        ok_equipo, error_equipo = registrar_ingreso_otra_puerta(
            user,
            request.data.get('device_id', ''),
            request.data.get('equipo', ''),
            request.data.get('plataforma', ''),
        )
        if not ok_equipo:
            error_equipo['ok'] = False
            return Response(error_equipo, status=status.HTTP_403_FORBIDDEN)

'''

IMPORT_OPER = ("from src.apps.core.equipo_enlazado import "
               "registrar_ingreso_otra_puerta\n")


def paso_login_operadores(texto):
    """Como paso_login, pero tolerante: este fichero puede no existir."""
    if "registrar_ingreso_otra_puerta" in texto:
        return texto, "ya estaba: la comprobacion en el login de operadores"
    if texto.count(ANCLA_OPER) != 1:
        return None, ("en mobile_operators_auth.py esperaba UNA linea %r y "
                      "hay %d; dime como quedo"
                      % (ANCLA_OPER.strip(), texto.count(ANCLA_OPER)))
    i = texto.index(ANCLA_OPER)
    texto = texto[:i] + COMPROBACION_OPER + texto[i:]

    m = re.search(r"^from rest_framework\.views import APIView$\n", texto, re.M)
    if m is None:
        return None, "no se donde poner el import en mobile_operators_auth.py"
    return (texto[:m.end()] + IMPORT_OPER + texto[m.end():],
            "anadida la comprobacion al login de operadores")


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
# 6. la migracion, escrita a mano
# ══════════════════════════════════════════════════════════════════════════
#
# POR QUE NO `makemigrations`. El codigo esta montado en solo lectura dentro
# del contenedor, y makemigrations escribe el fichero de la migracion EN esa
# carpeta: falla igual que falla el parche. Y en el host no hay Django.
#
# Asi que se escribe aqui. No es adivinar: los dos modelos los escribe este
# mismo parche, campo por campo. Lo que no se adivina es si quedo bien, y
# para eso esta la comprobacion de despues:
#
#     manage.py makemigrations core --dry-run
#
# Si dice "No changes detected", la migracion y los modelos dicen lo mismo.
# Si dice que faltan cambios, entonces si hay que mirarla.

MIGRACION = '''# -*- coding: utf-8 -*-
# Lo escribe parche_equipo_enlazado.py, campo por campo, porque en este
# proyecto makemigrations no puede: el codigo esta montado en solo lectura.
# Para comprobar que dice lo mismo que los modelos:
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
            name='DispositivoAutorizado',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True,
                                        serialize=False, verbose_name='ID')),
                ('device_id', models.CharField(
                    db_index=True, max_length=128,
                    verbose_name='Identificador del equipo')),
                ('equipo', models.CharField(blank=True, default='',
                                            max_length=120,
                                            verbose_name='Equipo')),
                ('plataforma', models.CharField(blank=True, default='',
                                                max_length=20,
                                                verbose_name='Plataforma')),
                ('creado', models.DateTimeField(auto_now_add=True,
                                                verbose_name='Enlazado el')),
                ('ultimo_uso', models.DateTimeField(
                    blank=True, null=True, verbose_name='Ultimo uso')),
                ('activo', models.BooleanField(db_index=True, default=True,
                                               verbose_name='Vigente')),
                ('liberado_en', models.DateTimeField(
                    blank=True, null=True, verbose_name='Liberado el')),
                ('liberado_por', models.ForeignKey(
                    blank=True, null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name='liberaciones', to=settings.AUTH_USER_MODEL,
                    verbose_name='Liberado por')),
                ('usuario', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='dispositivos', to=settings.AUTH_USER_MODEL,
                    verbose_name='Usuario')),
            ],
            options={
                'ordering': ['-activo', '-ultimo_uso', '-creado'],
                'verbose_name': 'Equipo enlazado',
                'verbose_name_plural': 'Equipos enlazados',
            },
        ),
        migrations.CreateModel(
            name='IngresoSinEquipo',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True,
                                        serialize=False, verbose_name='ID')),
                ('ultima_vez', models.DateTimeField(auto_now=True)),
                ('veces', models.PositiveIntegerField(default=0)),
                ('usuario', models.OneToOneField(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='ingreso_sin_equipo',
                    to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'verbose_name': 'Ingreso sin equipo',
                'verbose_name_plural': 'Ingresos sin equipo',
            },
        ),
    ]
'''


def migraciones_de_core(d):
    if not os.path.isdir(d):
        return []
    return sorted(x[:-3] for x in os.listdir(d)
                  if re.match(r"^[0-9]{4}_.*\.py$", x))


def paso_migracion(d):
    """Devuelve (nombre_del_fichero, texto) o (None, aviso)."""
    hechas = migraciones_de_core(d)
    if not hechas:
        return None, ("core/migrations esta vacio o no existe; no se de que "
                      "migracion colgar esta")
    for m in hechas:
        ruta = os.path.join(d, m + ".py")
        try:
            if "DispositivoAutorizado" in io.open(ruta, encoding="utf-8").read():
                return "", "ya estaba: la migracion (%s)" % m
        except (IOError, OSError):
            pass
    ultima = hechas[-1]
    n = int(ultima[:4]) + 1
    nombre = "%04d_equipo_enlazado.py" % n
    return nombre, MIGRACION % {"anterior": ultima}


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
    d_mig = os.path.join(base, "src", "apps", "core", "migrations")
    f_oper = os.path.join(base, "src", "apps", "api", "views",
                          "mobile_operators_auth.py")

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
    n_mig, av_mig = paso_migracion(d_mig)
    f_mig = os.path.join(d_mig, n_mig) if n_mig else None

    # La segunda puerta puede no existir en todos los despliegues, y no
    # haberla no es un fallo: es que ese proyecto no la tiene.
    hay_oper = os.path.isfile(f_oper)
    txt_o = io.open(f_oper, encoding="utf-8").read() if hay_oper else ""
    nuevo_o, av_o = (paso_login_operadores(txt_o) if hay_oper
                     else ("", "no existe en este proyecto; nada que hacer"))

    print("1. core/models.py          %s" % av_m)
    print("2. core/equipo_enlazado.py %s" % (
        "se reescribe" if os.path.isfile(f_mod) else "se crea"))
    print("3. api/urls.py             %s" % av_u)
    print("4. api/.../mobile_auth.py  %s" % av_l)
    print("5. botar_a_todos.py        %s" % (
        "se reescribe" if os.path.isfile(f_cmd) else "se crea"))
    print("6. la migracion            %s" % (
        av_mig if not n_mig else "se crea %s" % n_mig))
    print("7. .../operators_auth.py   %s" % av_o)
    print("")

    fallos = []
    for quien, nuevo, av in (("core/models.py", nuevo_m, av_m),
                             ("api/urls.py", nuevo_u, av_u),
                             ("mobile_auth.py", nuevo_l, av_l),
                             ("core/migrations", n_mig, av_mig),
                             ("mobile_operators_auth.py", nuevo_o, av_o)):
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
    ) + ((("la migracion", MIGRACION, "DispositivoAutorizado"),
          ("la migracion", MIGRACION, "IngresoSinEquipo")) if n_mig else ())
    for quien, txt, falta in comprobaciones:
        if falta not in txt:
            print("NO SE ESCRIBE NADA: en %s no salio %r." % (quien, falta))
            return 1
    # Y que siga siendo Python. Se inserta en ficheros cuya forma exacta no
    # se ve desde aqui -un import de varias lineas, por ejemplo-, y un
    # fichero partido por la mitad no se nota hasta que el proyecto no
    # arranca. Solo se culpa al parche de lo que el parche rompio: si el
    # original ya no parseaba, no es cosa nuestra.
    comprobaciones_oper = (
        ("mobile_operators_auth.py", nuevo_o, "registrar_ingreso_otra_puerta("),
        ("mobile_operators_auth.py", nuevo_o, "HTTP_403_FORBIDDEN"),
    ) if hay_oper else ()
    for quien, txt, falta in comprobaciones_oper:
        if falta not in txt:
            print("NO SE ESCRIBE NADA: en %s no salio %r." % (quien, falta))
            return 1
    # Y tambien ahi: antes del token, no despues.
    if hay_oper and (nuevo_o.index("registrar_ingreso_otra_puerta(")
                     > nuevo_o.index(ANCLA_OPER.strip())):
        print("NO SE ESCRIBE NADA: en operadores la comprobacion quedo")
        print("DESPUES de crear el token.")
        return 1

    for quien, viejo, nuevo in (("core/models.py", txt_m, nuevo_m),
                                ("api/urls.py", txt_u, nuevo_u),
                                ("mobile_auth.py", txt_l, nuevo_l)) + (
            (("mobile_operators_auth.py", txt_o, nuevo_o),) if hay_oper else ()):
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

    # ¿SE PUEDE ESCRIBIR? Se pregunta por los CINCO antes de tocar el
    # primero. En jurp_web, /app esta montado en solo lectura: el primer
    # respaldo se estrello y no se escribio nada, pero fue suerte -si el que
    # no se pudiera escribir hubiera sido el tercero, los dos primeros ya
    # estarian cambiados y eso es exactamente lo que este parche promete no
    # hacer-. Hace falta permiso en el fichero Y en su carpeta: el respaldo
    # se crea al lado.
    def primer_padre(d):
        while d and not os.path.isdir(d):
            d = os.path.dirname(d)
        return d or "/"

    sin_permiso = []
    for f in (f_models, f_urls, f_login) + ((f_oper,) if hay_oper else ()):
        if not os.access(f, os.W_OK):
            sin_permiso.append(f)
        elif not os.access(os.path.dirname(f), os.W_OK):
            sin_permiso.append("%s (la carpeta, para el respaldo)"
                               % os.path.dirname(f))
    for f in [f_mod, f_cmd] + ([f_mig] if f_mig else []):
        d = primer_padre(os.path.dirname(f))
        if not os.access(d, os.W_OK):
            sin_permiso.append("%s (donde va %s)" % (d, os.path.basename(f)))
    if sin_permiso:
        print("NO SE ESCRIBE NADA: no puedo escribir en")
        for f in sorted(set(sin_permiso)):
            print("   - %s" % f)
        print("")
        print("Si esto corre dentro del contenedor, el codigo seguramente")
        print("esta montado en solo lectura. Entonces se parchea EN EL HOST,")
        print("sobre la carpeta que el contenedor monta:")
        print("    docker inspect jurp_web --format '{{json .Mounts}}'")
        print("    sudo python3 %s --base /la/carpeta/del/host --aplicar"
              % os.path.basename(__file__))
        return 1

    if not APLICAR:
        print("Nada tocado. Para aplicarlo:")
        print("    python3 %s --aplicar" % os.path.basename(__file__))
        return 0

    escritos = []
    for ruta, viejo, nuevo, nombre in (
            (f_models, txt_m, nuevo_m, "core/models.py"),
            (f_urls, txt_u, nuevo_u, "api/urls.py"),
            (f_login, txt_l, nuevo_l, "mobile_auth.py")) + (
            ((f_oper, txt_o, nuevo_o, "mobile_operators_auth.py"),)
            if hay_oper else ()):
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

    if f_mig:
        io.open(f_mig, "w", encoding="utf-8").write(av_mig)
        escritos.append(os.path.basename(f_mig))

    print("")
    print("escrito: %s" % ", ".join(escritos))
    print("")
    print("Ahora, dentro del contenedor -la BD si se puede escribir-:")
    print("    docker exec -w /app -i jurp_web python manage.py migrate core")
    print("    docker restart jurp_web")
    print("")
    print("Y la comprobacion de que la migracion dice lo mismo que los")
    print("modelos. Esta escrita a mano, porque makemigrations no puede")
    print("escribir en una carpeta montada en solo lectura:")
    print("    docker exec -w /app -i jurp_web python manage.py \\")
    print("        makemigrations core --dry-run")
    print("    -> tiene que decir 'No changes detected'.")
    print("")
    print("TODAVIA NO RECHAZA A NADIE: EXIGIR_DISPOSITIVO nace apagado, y")
    print("quien no mande device_id entra igual y queda apuntado. Eso es lo")
    print("que permite publicar la app sin dejar a nadie fuera.")
    return 0


if __name__ == "__main__":
    sys.exit(principal())
