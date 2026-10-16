"""
Avisa cuando una estación deja de reportar.

POR QUE EXISTE ESTO
-------------------
LUZMILA dejó de enviar el 7 de octubre a las 02:30 y nadie se enteró en nueve
días, hasta que alguien miró el mapa y vio un globito gris. Una estación caída
no se nota: el mapa sigue dibujándose, los reportes siguen saliendo, y lo único
que falta es justo el dato que importaría el día que llueva.

QUE HACE
--------
Pregunta a PLUVIRA por todas las estaciones (Davis y pluviómetros), mira cuándo
reportó cada una por última vez, y manda una push cuando alguna lleva más de N
horas callada. Cuando vuelve, avisa también.

Avisa UNA vez por caída, no en cada pasada: el estado se guarda en un archivo
y solo se notifica el cambio. Un vigilante que recibe la misma alerta cada diez
minutos deja de leerlas, y entonces el aviso no sirve para nada.

COMO CONSULTA
-------------
En dos tiempos, para no castigar la base. Primero una ventana corta para todas
—barata, y la mayoría pasa por ahí—. Solo a las que vienen vacías se les hace
la consulta larga, que es la que cuesta, para averiguar desde cuándo callan.

USO
---
    python manage.py vigilar_estaciones --token <TOKEN> [--horas 6]

    --usuarios  A quién avisar, separados por coma. Por defecto, los del
                grupo supervisor_group que tengan dispositivo registrado.
    --dry-run   No manda push ni guarda estado; solo informa.
"""

import json
import os
from datetime import datetime, timedelta

import requests
from django.contrib.auth.models import User
from django.core.management.base import BaseCommand
from django.utils import timezone

from auth_api.fcm_sender import enviar_push_multiple
from auth_api.models import DispositivoFCM

BASE_POR_DEFECTO = "http://sistema.jriegopresurizado.org.pe"
RUTA_EQUIPOS = "/api/v1/mobile/devices/"
RUTA_LECTURAS = "/api/v1/mobile/davis/rain-gauges/filtered-data/"

TIPOS_EQUIPO = ("estacion_davis", "pluviometro")

# Días que se miran en la consulta barata. Tiene que ser mayor que cualquier
# umbral razonable de --horas, o una estación caída 10 horas saldría "sin
# lecturas en la ventana" por un motivo distinto al que se quiere detectar.
DIAS_VENTANA_CORTA = 3
DIAS_VENTANA_LARGA = 60

ESTADO_POR_DEFECTO = "/app/estado_estaciones.json"


def fecha(d):
    return d.strftime("%Y-%m-%d")


class Command(BaseCommand):
    help = "Avisa por push cuando una estación deja de reportar."

    def add_arguments(self, parser):
        parser.add_argument("--token", default=os.environ.get("PLUVIRA_TOKEN", ""))
        parser.add_argument(
            "--base", default=os.environ.get("PLUVIRA_API_BASE", BASE_POR_DEFECTO)
        )
        parser.add_argument(
            "--horas",
            type=float,
            default=6.0,
            help="Horas de silencio a partir de las cuales se considera caída.",
        )
        parser.add_argument(
            "--usuarios",
            default="",
            help="Usuarios a avisar, separados por coma. Por defecto, "
            "supervisor_group.",
        )
        parser.add_argument("--estado", default=ESTADO_POR_DEFECTO)
        parser.add_argument("--dry-run", action="store_true")

    # ── Consultas a PLUVIRA ────────────────────────────────────────────────

    def _pedir(self, url, params=None):
        r = requests.get(
            url, headers={"Authorization": "Token " + self.token},
            params=params, timeout=30,
        )
        r.raise_for_status()
        return r.json()

    def _equipos(self):
        """Todas las estaciones, de los dos tipos, como {id: nombre}."""
        salida = {}
        for tipo in TIPOS_EQUIPO:
            datos = self._pedir(self.base + RUTA_EQUIPOS, {"device_type": tipo})
            for e in datos.get("results") or datos or []:
                if e.get("id") is not None:
                    salida[e["id"]] = e.get("nombre") or e.get("name") or f"#{e['id']}"
        return salida

    def _ultima_lectura(self, station_id, dias):
        """
        Marca de tiempo de la última lectura dentro de la ventana, o None.

        max_points=1 adelgaza la serie al mínimo: las estadísticas se calculan
        antes del recorte, así que el dato que interesa llega igual y la
        respuesta pesa nada.
        """
        hoy = timezone.localtime(timezone.now())
        datos = self._pedir(
            self.base + RUTA_LECTURAS,
            {
                "start_date": fecha(hoy - timedelta(days=dias)),
                "end_date": fecha(hoy + timedelta(days=1)),
                "station_id": station_id,
                "metric": "rainfall_mm",
                "max_points": 1,
            },
        )
        stats = datos.get("stats") or {}
        if not stats.get("count"):
            return None
        return stats.get("last_timestamp")

    # ── Estado entre ejecuciones ───────────────────────────────────────────

    def _leer_estado(self, ruta):
        try:
            with open(ruta, "r") as f:
                return json.load(f)
        except (IOError, ValueError):
            # Primera vez, o archivo corrupto. Arrancar de cero es correcto:
            # como mucho se repite un aviso.
            return {}

    def _guardar_estado(self, ruta, estado):
        try:
            with open(ruta, "w") as f:
                json.dump(estado, f, indent=1)
        except IOError as e:
            self.stderr.write(f"No pude guardar el estado en {ruta}: {e}")

    # ── Aviso ──────────────────────────────────────────────────────────────

    def _tokens_destino(self, usuarios):
        if usuarios:
            qs = User.objects.filter(username__in=usuarios, is_active=True)
        else:
            qs = User.objects.filter(
                groups__name="supervisor_group", is_active=True
            ).distinct()
        return list(
            DispositivoFCM.objects.filter(usuario__in=qs)
            .values_list("token", flat=True)
            .distinct()
        )

    def _avisar(self, titulo, cuerpo, usuarios, simulacro):
        if simulacro:
            self.stdout.write(f"  [simulacro] push: {titulo} — {cuerpo}")
            return
        tokens = self._tokens_destino(usuarios)
        if not tokens:
            self.stderr.write("  No hay destinatarios con dispositivo registrado.")
            return
        r = enviar_push_multiple(
            tokens, titulo=titulo, cuerpo=cuerpo,
            data={"tipo": "estacion_caida"}, silenciosa=False,
        )
        if r.get("invalidos"):
            DispositivoFCM.objects.filter(token__in=r["invalidos"]).delete()
        self.stdout.write(f"  push: {r['exitos']} ok, {r['fallos']} fallos")

    # ── Principal ──────────────────────────────────────────────────────────

    def handle(self, *args, **opts):
        self.token = opts["token"]
        self.base = opts["base"].rstrip("/")
        horas = opts["horas"]
        simulacro = opts["dry_run"]
        ruta_estado = opts["estado"]
        usuarios = [u.strip() for u in opts["usuarios"].split(",") if u.strip()]

        if not self.token:
            self.stderr.write("Falta el token. Usa --token o PLUVIRA_TOKEN.")
            return

        try:
            equipos = self._equipos()
        except requests.RequestException as e:
            self.stderr.write(f"No pude consultar PLUVIRA: {e}")
            return

        if not equipos:
            self.stderr.write("PLUVIRA no devolvió estaciones. No toco el estado.")
            return

        ahora = timezone.localtime(timezone.now())
        limite = ahora - timedelta(hours=horas)
        estado = self._leer_estado(ruta_estado)

        caidas, recuperadas, ok = [], [], 0

        for sid, nombre in sorted(equipos.items(), key=lambda x: x[1].lower()):
            try:
                ultima = self._ultima_lectura(sid, DIAS_VENTANA_CORTA)
                if ultima is None:
                    # Callada en la ventana corta: ahora sí vale la pena pagar
                    # la consulta larga, solo para esta.
                    ultima = self._ultima_lectura(sid, DIAS_VENTANA_LARGA)
            except requests.RequestException as e:
                self.stderr.write(f"{nombre}: no pude consultar ({e})")
                continue

            if ultima:
                marca = datetime.fromisoformat(ultima)
                viva = marca > limite
            else:
                marca, viva = None, False

            antes_caida = estado.get(str(sid), {}).get("caida", False)

            if not viva and not antes_caida:
                caidas.append((nombre, marca))
            elif viva and antes_caida:
                recuperadas.append(nombre)

            if viva:
                ok += 1

            estado[str(sid)] = {
                "nombre": nombre,
                "caida": not viva,
                "ultima": ultima,
                "revisado": ahora.isoformat(),
            }

        # ── Informe y avisos ───────────────────────────────────────────────

        self.stdout.write(
            f"[{ahora.strftime('%Y-%m-%d %H:%M')}] "
            f"{len(equipos)} estaciones | reportando={ok} "
            f"| nuevas caidas={len(caidas)} | recuperadas={len(recuperadas)}"
        )

        if caidas:
            detalle = []
            for nombre, marca in caidas:
                if marca is None:
                    detalle.append(f"{nombre} (sin lecturas recientes)")
                else:
                    dias = (ahora - marca).days
                    cuando = (
                        f"{dias} d" if dias >= 1
                        else f"{int((ahora - marca).total_seconds() // 3600)} h"
                    )
                    detalle.append(f"{nombre} ({cuando})")
            texto = ", ".join(detalle)
            self.stdout.write(self.style.WARNING(f"  CAIDAS: {texto}"))
            titulo = (
                "Estación sin reportar" if len(caidas) == 1
                else f"{len(caidas)} estaciones sin reportar"
            )
            self._avisar(titulo, texto[:200], usuarios, simulacro)

        if recuperadas:
            texto = ", ".join(recuperadas)
            self.stdout.write(self.style.SUCCESS(f"  RECUPERADAS: {texto}"))
            self._avisar("Estación recuperada", texto[:200], usuarios, simulacro)

        if simulacro:
            self.stdout.write("Simulacro: no se guardó el estado.")
            return

        self._guardar_estado(ruta_estado, estado)
