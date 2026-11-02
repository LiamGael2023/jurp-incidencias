# -*- coding: utf-8 -*-
"""
Rendicion de petroleo: que vales estan sustentados y con que documento.

QUE RESUELVE
------------
Cada carga de combustible se apunta contra un vale del grifo, y despues hay
que rendirla: presentar un documento -un informe, un oficio- que la sustente
ante la Junta de Riego Presurizado, ante la Junta de Usuarios Viru, o ante
quien toque. Eso se lleva hoy en un Excel titulado «CONTROL DE RENDICION DE
INSUMO : PETROLEO», y el sistema ya tiene la mitad izquierda de esa tabla:
fecha del parte, numero de vale, galones y dren de la partida.

Lo que falta es la derecha: el documento, su fecha y el archivo escaneado.

DOS COSAS QUE MANDAN SOBRE EL MODELO
------------------------------------
UN DOCUMENTO CUBRE VARIOS VALES. Un oficio rinde diez cargas de una vez, asi
que el documento no puede ser un campo del vale: es una entidad propia con
muchos vales colgando.

UN VALE PUEDE RENDIRSE ANTE VARIAS ENTIDADES. El mismo vale va en un informe
a JURP y en un oficio a la JUV, cada uno con su fecha y su archivo. Asi que
tampoco es uno-a-muchos: es muchos-a-muchos, y la tabla enseña el estado de
cada vale frente a cada entidad.

EL NUMERO DE VALE SUBE A COLUMNA
--------------------------------
Hasta ahora vivia dentro del JSON `medidas` de la actividad, que esta bien
para guardarlo y es inservible para buscarlo: no se puede filtrar «los vales
sin rendir de este proyecto» dentro de un texto. Se promueve a columna y se
rellena desde el JSON con el comando `migrar_vales`, que no inventa nada: lee
lo que ya estaba escrito.

QUE TOCA
--------
    1. el modelo de la actividad      columna `vale`
    2. operations/models.py           modelo RendicionDocumento + M2M
    3. operations/views_rendicion.py  modulo nuevo, con sus vistas
    4. operations/urls.py             las rutas
    5. un comando `migrar_vales`      rellena la columna desde `medidas`

USO
---
    python3 parche_rendicion.py [--raiz /var/www/envs/vigilantes] [--dry-run]

Despues:
    manage.py makemigrations operations && manage.py migrate
    manage.py migrar_vales

Es idempotente y deja .bak de cada archivo que modifica.
"""

import argparse
import os
import re
import shutil
import sys


# ── 1. la columna en la actividad ──────────────────────────────────────────
COLUMNA = '''    # El numero del vale del grifo. Vivia dentro del JSON `medidas`, que
    # sirve para guardarlo y no para buscarlo: no se puede filtrar «los
    # vales sin rendir» dentro de un texto. El comando migrar_vales rellena
    # esta columna con lo que ya estaba escrito ahi.
    vale = models.CharField("N de vale", max_length=40, blank=True, default="")

'''


# ── 2. el documento de rendicion ───────────────────────────────────────────
MODELO = '''

class RendicionDocumento(models.Model):
    """Un documento que sustenta la rendicion de uno o varios vales.

    MUCHOS A MUCHOS, y no un campo en el vale, por dos razones que vienen del
    papel: un oficio rinde diez cargas de una vez, y una misma carga se rinde
    ante JURP con un informe y ante la JUV con un oficio. Ni uno-a-muchos ni
    muchos-a-uno sirven.
    """

    JURP = "jurp"
    JUV = "juv"
    OTRO = "otro"
    ENTIDADES = [
        (JURP, "Junta de Riego Presurizado"),
        (JUV, "Junta de Usuarios Viru"),
        (OTRO, "Otro"),
    ]

    proyecto = models.ForeignKey("operations.Proyecto", on_delete=models.CASCADE,
                                 related_name="rendiciones")
    entidad = models.CharField("Entidad", max_length=10, choices=ENTIDADES)
    # Solo cuando la entidad es «otro»: el papel dice «Otro: especificar».
    entidad_otro = models.CharField("Cual", max_length=120, blank=True, default="")
    numero = models.CharField("Documento", max_length=160)
    fecha = models.DateField("Fecha del documento")
    archivo = models.FileField("Escaneado", upload_to="rendiciones/%Y/%m/",
                               blank=True, null=True)
    vales = models.ManyToManyField("operations.DailyPartActivity",
                                   related_name="rendiciones", blank=True)
    creado = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "Documento de rendicion"
        verbose_name_plural = "Documentos de rendicion"
        ordering = ["-fecha", "-id"]

    def __str__(self):
        return "%s %s" % (self.get_entidad_display(), self.numero)

    @property
    def entidad_nombre(self):
        if self.entidad == self.OTRO and self.entidad_otro:
            return self.entidad_otro
        return self.get_entidad_display()
'''


# ── 3. las vistas ──────────────────────────────────────────────────────────
VISTAS = '''# -*- coding: utf-8 -*-
"""Rendicion de petroleo: los vales de un proyecto y sus documentos.

Un vale es una linea de parte medida en una unidad que pide comprobante
-galones-, con su numero, su fecha, sus galones y el dren al que se cargo.
Rendirlo es ligarlo a un documento.
"""

import json

from django.db import transaction
from rest_framework import status
from rest_framework.decorators import api_view, parser_classes, permission_classes
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from .models import DailyPartActivity, Partida, Proyecto, RendicionDocumento


def _unidades_con_vale():
    """Los codigos de unidad que piden comprobante, en minuscula.

    Sale del catalogo y no de una lista escrita aqui: el dia que JURP marque
    tambien los litros, esta pantalla los incluye sin que nadie la toque. Si
    el catalogo no existiera todavia, se cae a «gln», que es lo unico que hay
    hoy, en vez de devolver una lista vacia y una pantalla en blanco.
    """
    try:
        from .models import Unidad
        codigos = [u.codigo.lower() for u in Unidad.objects.filter(usa_vale=True)]
        if codigos:
            return codigos
    except Exception:
        pass
    return ["gln"]


def _norma(u):
    return (u or "").strip().lower().replace("\\u00b3", "3").replace("\\u00b2", "2")


def _fecha_del_parte(a):
    """La fecha del parte al que pertenece esta actividad.

    NO se escribe el nombre del FK: este backend ha ido creciendo a parches y
    darlo por sabido es lo que falla en produccion y no al aplicar, que es el
    peor sitio donde fallar. Se recorren las claves foraneas de la actividad
    y se usa la primera cuyo destino tenga una fecha.
    """
    for campo in a._meta.fields:
        if not campo.is_relation:
            continue
        try:
            destino = getattr(a, campo.name, None)
        except Exception:
            continue
        f = getattr(destino, "date", None) if destino is not None else None
        if f is not None and not callable(f):
            return f
    return None


def _doc(d):
    return {
        "id": d.id,
        "entidad": d.entidad,
        "entidad_nombre": d.entidad_nombre,
        "numero": d.numero,
        "fecha": d.fecha.isoformat() if d.fecha else None,
        "archivo": d.archivo.url if d.archivo else None,
        "vales": d.vales.count(),
    }


@api_view(["GET"])
@permission_classes([AllowAny])
def rendicion_vales(request):
    """Los vales de un proyecto, con lo que los rinde.

    Se listan TODAS las lineas medidas en una unidad que pide comprobante,
    tengan numero de vale o no: una carga sin numero apuntado es justo lo que
    hay que ver para ir a buscarlo, y esconderla la volveria invisible.
    """
    pid = request.GET.get("proyecto")
    if not pid:
        return Response({"detail": "Falta el proyecto."},
                        status=status.HTTP_400_BAD_REQUEST)
    try:
        pro = Proyecto.objects.get(pk=pid)
    except (Proyecto.DoesNotExist, ValueError):
        return Response({"detail": "No existe el proyecto."},
                        status=status.HTTP_404_NOT_FOUND)

    unidades = _unidades_con_vale()
    # `pro.partidas` es el accesor que ya usa el resto del modulo de
    # presupuesto; el nombre del FK hacia el proyecto no se da por sabido.
    partidas = {p.id: p for p in pro.partidas.all()}

    actos = (DailyPartActivity.objects
             .filter(partida_id__in=partidas.keys())
             .prefetch_related("rendiciones"))

    filas = []
    for a in actos:
        p = partidas.get(a.partida_id)
        if p is None or _norma(p.unidad) not in unidades:
            continue
        # El vale esta en su columna; si el relleno no se ha corrido todavia,
        # se mira dentro del JSON para no enseñar la tabla vacia.
        vale = (getattr(a, "vale", "") or "").strip()
        if not vale:
            try:
                vale = (json.loads(a.medidas or "{}").get("vale") or "").strip()
            except (ValueError, TypeError):
                vale = ""
        fecha = _fecha_del_parte(a)
        ruta = []
        try:
            ruta = json.loads(p.ruta or "[]")
        except (ValueError, TypeError):
            ruta = []
        filas.append({
            "id": a.id,
            "vale": vale,
            "fecha": fecha.isoformat() if fecha else None,
            "galones": float(a.metrado or 0),
            "unidad": p.unidad,
            "partida": p.codigo,
            "dren": ruta[0][1] if ruta else p.descripcion,
            "rendiciones": [_doc(d) for d in a.rendiciones.all()],
        })

    filas.sort(key=lambda f: (f["fecha"] or "", f["vale"]))
    return Response({
        "proyecto": pro.codigo,
        "total": len(filas),
        "vales": filas,
        "documentos": [_doc(d) for d in pro.rendiciones.all()],
    })


@api_view(["POST"])
@parser_classes([MultiPartParser, FormParser])
@permission_classes([AllowAny])
def rendicion_crear(request):
    """Crea un documento y le liga los vales marcados, todo o nada.

    En una transaccion: si falla ligando el septimo vale, no puede quedar un
    documento a medias que diga que siete estan rendidos y tres no.
    """
    d = request.data
    pid = d.get("proyecto")
    try:
        pro = Proyecto.objects.get(pk=pid)
    except (Proyecto.DoesNotExist, ValueError, TypeError):
        return Response({"detail": "No existe el proyecto."},
                        status=status.HTTP_404_NOT_FOUND)

    errores = {}
    entidad = (d.get("entidad") or "").strip()
    if entidad not in dict(RendicionDocumento.ENTIDADES):
        errores["entidad"] = ["Elige la entidad ante la que se rinde."]
    numero = (d.get("numero") or "").strip()
    if not numero:
        errores["numero"] = ["Hace falta el numero del documento."]
    fecha = (d.get("fecha") or "").strip()
    if not fecha:
        errores["fecha"] = ["Hace falta la fecha del documento."]

    ids = d.getlist("vales") if hasattr(d, "getlist") else (d.get("vales") or [])
    ids = [int(x) for x in ids if str(x).strip().isdigit()]
    if not ids:
        errores["vales"] = ["Marca al menos un vale."]

    if errores:
        return Response(errores, status=status.HTTP_400_BAD_REQUEST)

    # Un vale no puede estar rendido dos veces ante la MISMA entidad: serian
    # dos documentos diciendo lo mismo y ninguno sabria cual vale.
    ya = (DailyPartActivity.objects
          .filter(id__in=ids, rendiciones__proyecto=pro, rendiciones__entidad=entidad)
          .distinct())
    if ya.exists():
        return Response({
            "detail": ("%d vale(s) ya estan rendidos ante esa entidad. "
                       "Quitalos de la seleccion o borra su documento primero."
                       % ya.count()),
            "vales": [a.id for a in ya],
        }, status=status.HTTP_409_CONFLICT)

    with transaction.atomic():
        doc = RendicionDocumento.objects.create(
            proyecto=pro, entidad=entidad,
            entidad_otro=(d.get("entidad_otro") or "").strip(),
            numero=numero, fecha=fecha,
            archivo=request.FILES.get("archivo"))
        doc.vales.set(DailyPartActivity.objects.filter(id__in=ids))

    return Response(_doc(doc), status=status.HTTP_201_CREATED)


@api_view(["DELETE"])
@permission_classes([AllowAny])
def rendicion_borrar(request, pk):
    """Deshace una rendicion. Los vales vuelven a quedar pendientes."""
    try:
        doc = RendicionDocumento.objects.get(pk=pk)
    except RendicionDocumento.DoesNotExist:
        return Response(status=status.HTTP_404_NOT_FOUND)
    doc.delete()
    return Response(status=status.HTTP_204_NO_CONTENT)
'''


# ── 4. el comando de relleno ───────────────────────────────────────────────
COMANDO = '''# -*- coding: utf-8 -*-
"""Rellena la columna `vale` con lo que ya estaba en el JSON `medidas`.

No inventa nada: copia. Idempotente, y no pisa un vale ya escrito en la
columna, por si alguien lo corrigio a mano.
"""

import json

from django.core.management.base import BaseCommand

from operations.models import DailyPartActivity


class Command(BaseCommand):
    help = "Sube el numero de vale del JSON `medidas` a su columna."

    def handle(self, *args, **opciones):
        copiados = 0
        mirados = 0
        for a in DailyPartActivity.objects.exclude(medidas=""):
            mirados += 1
            if (a.vale or "").strip():
                continue
            try:
                v = (json.loads(a.medidas or "{}").get("vale") or "").strip()
            except (ValueError, TypeError):
                continue
            if not v:
                continue
            a.vale = v[:40]
            a.save(update_fields=["vale"])
            copiados += 1
        self.stdout.write(self.style.SUCCESS(
            "Vales: %d copiados de %d actividades con medidas." % (copiados, mirados)))
'''


RUTAS = '''
# Rendicion de petroleo. Import aparte, para no tocar el bloque de imports de
# arriba y arriesgar un conflicto con otro parche.
from .views_rendicion import (  # noqa: E402
    rendicion_vales, rendicion_crear, rendicion_borrar,
)
urlpatterns += [
    path('rendicion/vales/', rendicion_vales, name='rendicion-vales'),
    path('rendicion/documentos/', rendicion_crear, name='rendicion-crear'),
    path('rendicion/documentos/<int:pk>/', rendicion_borrar, name='rendicion-borrar'),
]
'''


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


def _busca(raiz, patron):
    """El archivo de la app que contiene `patron`. Ver parche_beneficiarios."""
    app = os.path.join(raiz, 'operations')
    if not os.path.isdir(app):
        return None, 'no existe {0}'.format(app)
    salen = []
    for nombre in sorted(os.listdir(app)):
        if not nombre.endswith('.py'):
            continue
        ruta = os.path.join(app, nombre)
        try:
            if re.search(patron, leer(ruta), re.M):
                salen.append(ruta)
        except (IOError, OSError, UnicodeDecodeError):
            continue
    if not salen:
        return None, 'no encuentro {0} en operations/*.py'.format(patron)
    if len(salen) > 1:
        return None, ('{0} sale en {1} archivos: {2}'
                      .format(patron, len(salen),
                              ', '.join(os.path.basename(x) for x in salen)))
    return salen[0], None


def paso_columna(raiz, simulacro):
    """La columna `vale`, dentro de DailyPartActivity, antes de su Meta."""
    ruta, mal = _busca(raiz, r'^class DailyPartActivity\(')
    if mal:
        return False, mal
    t = leer(ruta)
    m = re.search(r'^class DailyPartActivity\(', t, re.M)
    sig = re.search(r'^(?:class )', t[m.end():], re.M)
    fin = m.end() + (sig.start() if sig else len(t) - m.end())
    if re.search(r'^    vale = ', t[m.end():fin], re.M):
        return True, 'ya estaba ({0})'.format(os.path.basename(ruta))

    meta = re.search(r'^    class Meta:', t[m.end():fin], re.M)
    if not meta:
        return False, 'DailyPartActivity no tiene un bloque Meta donde anclar'
    corte = m.end() + meta.start()
    escribir(ruta, t[:corte] + COLUMNA + t[corte:], simulacro)
    return True, 'columna vale en {0}'.format(os.path.basename(ruta))


def paso_modelo(raiz, simulacro):
    """El modelo RendicionDocumento, al final de models.py."""
    ruta = os.path.join(raiz, 'operations/models.py')
    if not os.path.exists(ruta):
        return False, 'no existe {0}'.format(ruta)
    t = leer(ruta)
    if 'class RendicionDocumento(' in t:
        return True, 'ya estaba'
    escribir(ruta, t.rstrip('\n') + '\n' + MODELO, simulacro)
    return True, 'modelo anadido'


def paso_vistas(raiz, simulacro):
    """El modulo de vistas, nuevo."""
    ruta = os.path.join(raiz, 'operations/views_rendicion.py')
    if os.path.exists(ruta) and 'def rendicion_vales' in leer(ruta):
        return True, 'ya estaba'
    escribir(ruta, VISTAS, simulacro)
    return True, 'views_rendicion.py creado'


def paso_urls(raiz, simulacro):
    ruta = os.path.join(raiz, 'operations/urls.py')
    if not os.path.exists(ruta):
        return False, 'no existe {0}'.format(ruta)
    t = leer(ruta)
    if 'views_rendicion' in t:
        return True, 'ya estaba'
    if 'urlpatterns' not in t:
        return False, 'urls.py no tiene urlpatterns'
    if not re.search(r'^from django\.urls import|^\s*path\(', t, re.M):
        return False, 'urls.py no parece usar path()'
    escribir(ruta, t.rstrip('\n') + '\n' + RUTAS, simulacro)
    return True, 'rutas anadidas'


def paso_comando(raiz, simulacro):
    carpeta = os.path.join(raiz, 'operations/management/commands')
    ruta = os.path.join(carpeta, 'migrar_vales.py')
    if not os.path.isdir(carpeta):
        return False, 'no existe {0}'.format(carpeta)
    if os.path.exists(ruta):
        return True, 'ya estaba'
    escribir(ruta, COMANDO, simulacro)
    return True, 'comando migrar_vales creado'


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--raiz', default='/var/www/envs/vigilantes')
    p.add_argument('--dry-run', action='store_true')
    args = p.parse_args()

    pasos = [
        ('columna', lambda: paso_columna(args.raiz, args.dry_run)),
        ('modelo', lambda: paso_modelo(args.raiz, args.dry_run)),
        ('vistas', lambda: paso_vistas(args.raiz, args.dry_run)),
        ('urls', lambda: paso_urls(args.raiz, args.dry_run)),
        ('comando', lambda: paso_comando(args.raiz, args.dry_run)),
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

    print('\nFalta migrar y rellenar la columna:')
    print('  docker compose exec -T web python manage.py makemigrations operations')
    print('  docker compose exec -T web python manage.py migrate')
    print('  docker compose exec -T web python manage.py migrar_vales')


if __name__ == '__main__':
    main()
