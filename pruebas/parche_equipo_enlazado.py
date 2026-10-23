# -*- coding: utf-8 -*-
"""Una cuenta, un celular: tabla, panel y el comando del dia del corte.

    python3 parche_equipo_enlazado.py                  # solo mira
    python3 parche_equipo_enlazado.py --aplicar         # aplica
    python3 parche_equipo_enlazado.py --app usuarios    # si no autodetecta

SE CORRE EN EL BACKEND DE PLUVIRA -el de sistema.jriegopresurizado.org.pe-,
que es quien emite el token. No en el Linode de vigilantes.

QUE INSTALA, Y QUE NO
=====================

Instala las piezas NUEVAS, que no tocan nada de lo que ya funciona:

    1. equipo_enlazado.py   el modelo, la decision y los endpoints del panel
    2. urls.py              las dos rutas del panel
    3. management/commands/botar_a_todos.py   el corte

NO instala el enganche en el login. Eso modifica la vista que crea el token,
y escribirla sin verla es como se rompe un login en produccion. Falta la
salida de ver_login_pluvira.py para eso. Hasta entonces nada de esto rechaza
a nadie: la tabla y el panel existen y estan vacios.

EL ORDEN DEL ENCENDIDO, que hecho al reves deja fuera a la gente de campo:

    1. Publicar la app que manda device_id. Nada cambia todavia.
    2. Mirar en el panel cuantos siguen entrando SIN identificar. Ese numero
       baja solo, conforme la gente actualiza.
    3. Con ese numero en cero: EXIGIR_DISPOSITIVO = True en settings, y
       `manage.py botar_a_todos --de-verdad` para que todos vuelvan a entrar
       y queden enlazados de una vez.

El interruptor existe para que el paso 3 sea una decision de un dia
concreto. Si el bloqueo se activara al desplegar, el paso 1 y el 3 serian el
mismo y no habria ventana para que la gente actualice.
"""

from __future__ import print_function

import datetime
import io
import os
import re
import shutil
import sys

APLICAR = "--aplicar" in sys.argv

CANDIDATOS = [
    "/var/www/envs/vigilantes",
    "/root/proyectos/api_vigilantes",
    os.getcwd(),
]


def buscar_app(base):
    """La app donde vive el login, que es donde va esto.

    Se busca la que tenga un urls.py que mencione la ruta del login. Puesta
    en otra app, el modelo caeria en unas migraciones que no son las suyas, y
    mover eso despues cuesta mas que acertar ahora.
    """
    if "--app" in sys.argv:
        return sys.argv[sys.argv.index("--app") + 1]
    mejor = None
    try:
        nombres = sorted(os.listdir(base))
    except OSError:
        return None
    for nombre in nombres:
        carpeta = os.path.join(base, nombre)
        if not os.path.isdir(carpeta):
            continue
        f_urls = os.path.join(carpeta, "urls.py")
        f_models = os.path.join(carpeta, "models.py")
        if not (os.path.isfile(f_urls) and os.path.isfile(f_models)):
            continue
        txt = io.open(f_urls, encoding="utf-8", errors="replace").read()
        if "auth/login" in txt:
            return nombre
        if mejor is None and "login" in txt:
            mejor = nombre
    return mejor


def base_del_proyecto():
    if "--base" in sys.argv:
        return sys.argv[sys.argv.index("--base") + 1]
    for c in CANDIDATOS:
        if os.path.isdir(c) and buscar_app(c):
            return c
    return os.getcwd()


MODULO = r'''# -*- coding: utf-8 -*-
"""Una cuenta, un celular: la tabla, el panel y la decision.

Lo escribe parche_equipo_enlazado.py. No se edita a mano: el parche lo
reemplaza entero.

QUE RESUELVE. Prestar la clave. La cuenta queda atada al telefono desde el
que se entro la primera vez; desde otro se rechaza aunque la clave sea
correcta.

DISUADE, NO BLINDA. Una app modificada puede falsear su identificador. Frena
el prestamo entre companeros, que es el problema real.

POR QUE UNA TABLA Y NO UN CAMPO EN EL USUARIO. Un campo sabria donde esta
ahora; la tabla sabe por donde paso. Eso es lo que hace falta cuando alguien
dice "me liberaron y sigo sin entrar", y lo que permite ver si alguien
libera de mas. Liberar DESACTIVA y firma; no borra.
"""

from django.conf import settings
from django.db import models
from django.utils import timezone

from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAdminUser
from rest_framework.response import Response


class DispositivoAutorizado(models.Model):
    """El celular al que esta atada una cuenta.

    UN SOLO ACTIVO POR USUARIO. Los anteriores quedan como historial, que es
    justamente para lo que sirve tenerlos en una tabla.
    """

    usuario = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
        related_name="dispositivos", verbose_name="Usuario")

    # El identificador que manda la app. En Android sale de androidInfo.id y
    # en iOS de identifierForVendor. NINGUNO ES ETERNO: el de Android se
    # reinicia al restaurar de fabrica y el de iOS se borra si se desinstalan
    # todas las apps del fabricante. Por eso liberar no es un extra.
    device_id = models.CharField("Identificador del equipo", max_length=128,
                                 db_index=True)
    equipo = models.CharField("Equipo", max_length=120, blank=True, default="")
    plataforma = models.CharField("Plataforma", max_length=20, blank=True,
                                  default="")

    creado = models.DateTimeField("Enlazado el", auto_now_add=True)
    ultimo_uso = models.DateTimeField("Ultimo uso", null=True, blank=True)
    activo = models.BooleanField("Vigente", default=True, db_index=True)

    # LA FIRMA. Sin ella, "quien libero esta cuenta tres veces este mes" no
    # tiene respuesta, y esa pregunta aparece en cuanto esto lleva un tiempo.
    liberado_por = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True,
        blank=True, related_name="liberaciones", verbose_name="Liberado por")
    liberado_en = models.DateTimeField("Liberado el", null=True, blank=True)

    class Meta:
        verbose_name = "Equipo enlazado"
        verbose_name_plural = "Equipos enlazados"
        ordering = ["-activo", "-ultimo_uso", "-creado"]

    def __str__(self):
        return "%s - %s" % (self.usuario, self.equipo or self.device_id[:12])

    def liberar(self, por=None):
        self.activo = False
        self.liberado_por = por
        self.liberado_en = timezone.now()
        self.save(update_fields=["activo", "liberado_por", "liberado_en"])


class IngresoSinEquipo(models.Model):
    """Quien entro sin mandar identificador, o sea con la app vieja.

    ES EL NUMERO QUE DECIDE CUANDO SE PUEDE ENCENDER EL BLOQUEO. Mientras
    haya gente aqui, encenderlo los deja fuera, y son los de campo. Se guarda
    uno por usuario -no un historial- porque lo unico que hace falta saber es
    si a dia de hoy alguien sigue sin actualizar.
    """

    usuario = models.OneToOneField(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
        related_name="ingreso_sin_equipo")
    ultima_vez = models.DateTimeField(auto_now=True)
    veces = models.PositiveIntegerField(default=0)

    class Meta:
        verbose_name = "Ingreso sin equipo"
        verbose_name_plural = "Ingresos sin equipo"


# ══════════════════════════════════════════════════════════════════════════
# LA DECISION
# ══════════════════════════════════════════════════════════════════════════

CORTADO = "cortado"
ENLAZA = "enlaza"
SIGUE = "sigue"
SIN_ID = "sin_id"


def decidir(enlace_activo, device_id, exigir):
    """Que hacer con este ingreso. Funcion pura: se puede probar sin base.

    → (que_hacer, codigo_de_error)

      ENLAZA   no tenia equipo: este queda enlazado
      SIGUE    es el mismo equipo: pasa
      CORTADO  es otro equipo: se rechaza
      SIN_ID   no mando identificador (app vieja)

    EL ORDEN IMPORTA. Primero se mira si falta el identificador, porque una
    app vieja no puede "coincidir" con nada; si se mirara despues, un usuario
    ya enlazado que actualice hacia atras pasaria como si fuera su equipo.
    """
    # .strip(): una cadena de espacios es verdadera en Python, asi que sin
    # esto un "   " quedaria ENLAZADO como identificador. A partir de ahi,
    # cualquier otra app que mandara espacios coincidiria con el. Lo
    # encontro la prueba, no la lectura.
    device_id = (device_id or "").strip()
    if not device_id:
        return (CORTADO, "falta_device_id") if exigir else (SIN_ID, None)
    if enlace_activo is None:
        return (ENLAZA, None)
    if enlace_activo.device_id == device_id:
        return (SIGUE, None)
    return (CORTADO, "equipo_distinto")


def enlace_de(usuario):
    return DispositivoAutorizado.objects.filter(
        usuario=usuario, activo=True).first()


def exigir_equipo():
    """El interruptor. Apagado por defecto, y eso no es pereza.

    Encenderlo el dia del despliegue deja fuera a todo el que no haya
    actualizado la app -los de campo-. Se enciende un dia concreto, cuando
    el panel enseñe cero ingresos sin identificar.
    """
    return bool(getattr(settings, "EXIGIR_DISPOSITIVO", False))


def registrar_ingreso(usuario, device_id, equipo="", plataforma=""):
    """Aplica la regla y deja constancia.

    → (ok, respuesta_de_error_o_None)
    """
    device_id = (device_id or "").strip()
    enlace = enlace_de(usuario)
    que, codigo = decidir(enlace, device_id, exigir_equipo())

    if que == SIN_ID:
        fila, _ = IngresoSinEquipo.objects.get_or_create(usuario=usuario)
        fila.veces = (fila.veces or 0) + 1
        fila.save()
        return True, None

    if que == SIGUE:
        enlace.ultimo_uso = timezone.now()
        enlace.equipo = equipo or enlace.equipo
        enlace.plataforma = plataforma or enlace.plataforma
        enlace.save(update_fields=["ultimo_uso", "equipo", "plataforma"])
        # Ya identifica su equipo: deja de estar en la lista de pendientes.
        IngresoSinEquipo.objects.filter(usuario=usuario).delete()
        return True, None

    if que == ENLAZA:
        DispositivoAutorizado.objects.create(
            usuario=usuario, device_id=device_id, equipo=equipo[:120],
            plataforma=plataforma[:20], ultimo_uso=timezone.now())
        IngresoSinEquipo.objects.filter(usuario=usuario).delete()
        return True, None

    # CORTADO
    if codigo == "falta_device_id":
        return False, {
            "detail": "Actualiza la aplicacion para poder entrar.",
            "codigo": codigo,
        }
    return False, {
        "detail": "Esta cuenta esta enlazada a otro equipo.",
        "codigo": codigo,
        "equipo_enlazado": enlace.equipo or "otro equipo",
        "desde": enlace.creado,
    }


# ══════════════════════════════════════════════════════════════════════════
# EL PANEL
# ══════════════════════════════════════════════════════════════════════════

def _corto(device_id):
    """El identificador, recortado.

    En el panel sirve para distinguir dos equipos; completo es un dato que
    no hace falta ensenar y que, si alguien lo copia, es justo lo que habria
    que falsear para saltarse esto.
    """
    d = device_id or ""
    return "%s…%s" % (d[:4], d[-4:]) if len(d) > 10 else d


def _fila(d):
    u = d.usuario
    nombre = (u.get_full_name() or "").strip() if hasattr(u, "get_full_name") else ""
    return {
        "id": d.id,
        "usuario": u.get_username(),
        "nombre_usuario": nombre,
        "equipo": d.equipo,
        "plataforma": d.plataforma,
        "device_id": _corto(d.device_id),
        "desde": d.creado,
        "ultimo_uso": d.ultimo_uso,
        "activo": d.activo,
        "liberado_por": d.liberado_por.get_username() if d.liberado_por else None,
        "liberado_en": d.liberado_en,
    }


@api_view(["GET"])
@permission_classes([IsAdminUser])
def dispositivos(request):
    """Los equipos enlazados, para el panel.

    Solo administradores: esta lista dice desde que equipo entra cada
    persona, y quien pueda leerla puede tambien liberarlos.
    """
    estado = (request.query_params.get("estado") or "activos").lower()
    qs = DispositivoAutorizado.objects.select_related("usuario", "liberado_por")
    if estado == "activos":
        qs = qs.filter(activo=True)
    elif estado == "liberados":
        qs = qs.filter(activo=False)

    q = (request.query_params.get("q") or "").strip()
    if q:
        from django.db.models import Q
        qs = qs.filter(Q(usuario__username__icontains=q)
                       | Q(equipo__icontains=q))

    return Response({
        # Cuantos siguen con la app vieja. Es el numero que decide si se
        # puede encender el bloqueo sin dejar a nadie fuera.
        "sin_identificar": IngresoSinEquipo.objects.count(),
        "exigiendo": exigir_equipo(),
        "resultados": [_fila(d) for d in qs[:500]],
    })


@api_view(["POST"])
@permission_classes([IsAdminUser])
def liberar(request, pk):
    """Suelta la cuenta de su equipo. Queda firmado quien y cuando."""
    d = DispositivoAutorizado.objects.filter(pk=pk).first()
    if d is None:
        return Response({"detail": "No existe ese enlace."},
                        status=status.HTTP_404_NOT_FOUND)
    if not d.activo:
        # Liberar dos veces no es un error, pero decir "hecho" borraria la
        # primera firma y con ella quien lo solto de verdad.
        return Response({"detail": "Ese enlace ya estaba liberado.",
                         "codigo": "ya_liberado"},
                        status=status.HTTP_409_CONFLICT)
    d.liberar(por=request.user if request.user.is_authenticated else None)
    return Response(_fila(d))
'''


IMPORT = "from .equipo_enlazado import dispositivos, liberar\n"

RUTAS = ("    # Equipos enlazados: el panel de administracion. El enganche en\n"
         "    # el login va aparte.\n"
         "    path('auth/dispositivos/', dispositivos, name='dispositivos'),\n"
         "    path('auth/dispositivos/<int:pk>/liberar/', liberar,\n"
         "         name='dispositivo-liberar'),\n")


def paso_urls(texto):
    if "equipo_enlazado" in texto:
        return texto, "ya estaban: las rutas del panel"
    m = re.search(r"^urlpatterns\s*=\s*\[", texto, re.M)
    if not m:
        return None, "no encuentro urlpatterns = [ en urls.py"
    if not re.search(r"^from django\.urls import .*\bpath\b", texto, re.M):
        return None, "urls.py no importa path; no se por donde meter las rutas"
    nuevo = (texto[:m.start()] + IMPORT + "\n"
             + texto[m.start():m.end()] + "\n" + RUTAS
             + texto[m.end():])
    return nuevo, "anadidas las dos rutas del panel"


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
        from @@APP@@.equipo_enlazado import IngresoSinEquipo, exigir_equipo

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


def respaldo(ruta):
    sello = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    copia = "%s.bak-%s" % (ruta, sello)
    shutil.copy2(ruta, copia)
    return copia


def principal():
    base = base_del_proyecto()
    app = buscar_app(base)
    if not app:
        print("No encuentro la app donde vive el login.")
        print("Pasamela con --app <nombre>: la carpeta que tiene su urls.py.")
        return 1

    carpeta = os.path.join(base, app)
    f_mod = os.path.join(carpeta, "equipo_enlazado.py")
    f_urls = os.path.join(carpeta, "urls.py")
    d_cmd = os.path.join(carpeta, "management", "commands")
    f_cmd = os.path.join(d_cmd, "botar_a_todos.py")

    print("proyecto: %s" % base)
    print("app     : %s" % app)
    print("modo    : %s" % ("APLICAR" if APLICAR else "solo mostrar"))
    print("")

    if not os.path.isfile(f_urls):
        print("MAL  no encuentro %s" % f_urls)
        return 1

    txt_u = io.open(f_urls, encoding="utf-8").read()
    nuevo_u, av_u = paso_urls(txt_u)

    print("1. equipo_enlazado.py    %s" % (
        "se reescribe" if os.path.isfile(f_mod) else "se crea"))
    print("2. urls.py               %s" % av_u)
    print("3. botar_a_todos.py      %s" % (
        "se reescribe" if os.path.isfile(f_cmd) else "se crea"))
    print("")

    if nuevo_u is None:
        print("NO SE ESCRIBE NADA: urls.py: %s" % av_u)
        print("Mandame esta salida y lo ajusto.")
        return 1

    # Se comprueba el RESULTADO, no la intencion.
    for falta in ("dispositivos", "liberar"):
        if falta not in nuevo_u:
            print("NO SE ESCRIBE NADA: %r no salio en urls.py." % falta)
            return 1

    if not APLICAR:
        print("Nada tocado. Para aplicarlo:")
        print("    python3 %s --aplicar" % os.path.basename(__file__))
        return 0

    escritos = []
    # El modulo se reescribe SIEMPRE: lo escribe este parche entero y no se
    # edita a mano, asi que una version vieja solo puede estorbar.
    io.open(f_mod, "w", encoding="utf-8").write(MODULO)
    escritos.append("equipo_enlazado.py")

    if nuevo_u != txt_u:
        print("respaldo %s" % respaldo(f_urls))
        io.open(f_urls, "w", encoding="utf-8").write(nuevo_u)
        escritos.append("urls.py")

    for d in (os.path.join(carpeta, "management"), d_cmd):
        if not os.path.isdir(d):
            os.makedirs(d)
        ini = os.path.join(d, "__init__.py")
        if not os.path.isfile(ini):
            io.open(ini, "w", encoding="utf-8").write("")
    # El comando vive dos carpetas por debajo de la app, asi que el import
    # relativo no vale: se escribe con el nombre real de la app.
    io.open(f_cmd, "w", encoding="utf-8").write(
        COMANDO.replace("@@APP@@", app))
    escritos.append("botar_a_todos.py")

    print("")
    print("escrito: %s" % ", ".join(escritos))
    print("")
    print("Hay migracion -dos tablas nuevas-:")
    print("    python manage.py makemigrations %s" % app)
    print("    python manage.py migrate")
    print("")
    print("TODAVIA NO RECHAZA A NADIE: falta el enganche en el login, que")
    print("necesita la salida de ver_login_pluvira.py.")
    return 0


if __name__ == "__main__":
    sys.exit(principal())
