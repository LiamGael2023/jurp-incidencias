"""
Avisa por push cuando el pronóstico prevé lluvia de alerta en una estación.

POR QUE EXISTE ESTO
-------------------
El gemelo 3D muestra el pronóstico, pero solo lo ve quien lo abre. Lo que de
verdad sirve es enterarse con horas de anticipación sin tener que mirar: que
llegue al teléfono "alerta naranja prevista mañana 15:00 en Chao Alto" y dé
tiempo a mover gente, revisar alcantarillas o bajar compuertas.

QUE HACE
--------
1. Pide a PLUVIRA la lista de estaciones (Davis y pluviómetros) con sus
   coordenadas.
2. Pide a Open-Meteo la lluvia prevista hora a hora para todas, en una sola
   consulta.
3. Para cada estación busca, dentro de las próximas --horas, la hora con más
   lluvia prevista cuya probabilidad llegue a --prob.
4. Agrupa por nivel y manda UNA push por nivel con las estaciones afectadas.

UMBRALES
--------
Los mismos del mapa y del 3D (UMBRALES_LLUVIA en Mapa.jsx), que están en mm
por cuarto de hora, pasados a su equivalente horario (x4):

    amarilla  >= 0.84 mm/h   (0.21 mm/15 min)
    naranja   >= 2.52 mm/h   (0.63 mm/15 min)
    roja      >= 4.24 mm/h   (1.06 mm/15 min)

Es una aproximación: la lluvia real cae a ráfagas y el modelo da totales
horarios. Por eso el aviso dice "prevista" y nunca sustituye a SENAMHI.

UNA VEZ POR EVENTO
------------------
Se guarda en un archivo qué se avisó (estación, nivel y día del evento). Solo
se vuelve a avisar si el nivel SUBE o si es otro día. Un pronóstico que se
repite cada hora no debe repetir la push cada hora: la gente deja de leerlas.

USO
---
    python manage.py pronostico_lluvia --token <TOKEN> [--horas 48] [--prob 40]

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
TIPOS_EQUIPO = ("estacion_davis", "pluviometro")

OPEN_METEO = "https://api.open-meteo.com/v1/forecast"

NIVELES = [  # de menor a mayor
    ("amarilla", 0.84),
    ("naranja", 2.52),
    ("roja", 4.24),
]
ORDEN = {n: i for i, (n, _) in enumerate(NIVELES)}

ESTADO_POR_DEFECTO = "/app/estado_pronostico.json"
DIAS_SEM = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"]


def nivel_de(mm_h):
    actual = None
    for nombre, desde in NIVELES:
        if mm_h >= desde:
            actual = nombre
    return actual


def num(v):
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if f == f else None  # descarta NaN


class Command(BaseCommand):
    help = "Avisa por push cuando el pronóstico prevé lluvia de alerta."

    def add_arguments(self, parser):
        parser.add_argument("--token", default=os.environ.get("PLUVIRA_TOKEN", ""))
        parser.add_argument(
            "--base", default=os.environ.get("PLUVIRA_API_BASE", BASE_POR_DEFECTO)
        )
        parser.add_argument(
            "--horas", type=int, default=48,
            help="Horas hacia adelante que se miran. Más de 72 ya es tendencia.",
        )
        parser.add_argument(
            "--prob", type=int, default=40,
            help="Probabilidad mínima (%%) para que una hora cuente.",
        )
        parser.add_argument("--usuarios", default="")
        parser.add_argument("--estado", default=ESTADO_POR_DEFECTO)
        parser.add_argument("--dry-run", action="store_true")

    # ── Datos ──────────────────────────────────────────────────────────────

    def _estaciones(self):
        """[(id, nombre, lat, lng)] de las estaciones con coordenadas válidas."""
        salida = []
        for tipo in TIPOS_EQUIPO:
            r = requests.get(
                self.base + RUTA_EQUIPOS,
                headers={"Authorization": "Token " + self.token},
                params={"device_type": tipo}, timeout=30,
            )
            r.raise_for_status()
            datos = r.json()
            for e in datos.get("results") or datos or []:
                lat, lng = num(e.get("latitude")), num(e.get("longitude"))
                # 0,0 = estación sin ubicar en el backend.
                if e.get("id") is None or lat is None or lng is None or (lat == 0 and lng == 0):
                    continue
                nombre = e.get("nombre") or e.get("name") or f"#{e['id']}"
                salida.append((e["id"], nombre, lat, lng))
        return salida

    def _pronostico(self, estaciones, horas):
        dias = min(16, horas // 24 + 2)
        r = requests.get(
            OPEN_METEO,
            params={
                "latitude": ",".join(f"{e[2]:.4f}" for e in estaciones),
                "longitude": ",".join(f"{e[3]:.4f}" for e in estaciones),
                "hourly": "precipitation,precipitation_probability",
                "forecast_days": dias,
                "timezone": "America/Lima",
            },
            timeout=60,
        )
        r.raise_for_status()
        datos = r.json()
        # Con una sola coordenada Open-Meteo devuelve un objeto, no una lista.
        return datos if isinstance(datos, list) else [datos]

    # ── Estado entre ejecuciones ───────────────────────────────────────────

    def _leer_estado(self, ruta):
        try:
            with open(ruta, "r") as f:
                return json.load(f)
        except (IOError, ValueError):
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
            data={"tipo": "pronostico_lluvia"}, silenciosa=False,
        )
        if r.get("invalidos"):
            DispositivoFCM.objects.filter(token__in=r["invalidos"]).delete()
        self.stdout.write(f"  push: {r['exitos']} ok, {r['fallos']} fallos")

    # ── Principal ──────────────────────────────────────────────────────────

    def handle(self, *args, **opts):
        self.token = opts["token"]
        self.base = opts["base"].rstrip("/")
        horas, prob_min = opts["horas"], opts["prob"]
        simulacro = opts["dry_run"]
        ruta_estado = opts["estado"]
        usuarios = [u.strip() for u in opts["usuarios"].split(",") if u.strip()]

        if not self.token:
            self.stderr.write("Falta el token. Usa --token o PLUVIRA_TOKEN.")
            return

        try:
            estaciones = self._estaciones()
        except requests.RequestException as e:
            self.stderr.write(f"No pude consultar PLUVIRA: {e}")
            return
        if not estaciones:
            self.stderr.write("PLUVIRA no devolvió estaciones con ubicación.")
            return

        try:
            pron = self._pronostico(estaciones, horas)
        except (requests.RequestException, ValueError) as e:
            self.stderr.write(f"No pude consultar el pronóstico: {e}")
            return

        ahora = timezone.localtime(timezone.now()).replace(tzinfo=None)
        hasta = ahora + timedelta(hours=horas)
        estado = self._leer_estado(ruta_estado)

        # Limpieza: lo avisado para días ya pasados no hace falta guardarlo.
        hoy = ahora.strftime("%Y-%m-%d")
        estado = {k: v for k, v in estado.items() if v.get("dia", "") >= hoy}

        por_nivel = {n: [] for n, _ in NIVELES}

        for (sid, nombre, _, _), p in zip(estaciones, pron):
            h = p.get("hourly") or {}
            tiempos = h.get("time") or []
            lluvia = h.get("precipitation") or []
            probs = h.get("precipitation_probability") or []

            pico = None  # (mm, prob, datetime)
            for i, t in enumerate(tiempos):
                momento = datetime.fromisoformat(t)
                if momento < ahora.replace(minute=0, second=0, microsecond=0) or momento > hasta:
                    continue
                mm = num(lluvia[i] if i < len(lluvia) else None) or 0.0
                pr = num(probs[i] if i < len(probs) else None)
                pr = 100 if pr is None else pr   # sin dato de probabilidad: cuenta
                if pr < prob_min:
                    continue
                if pico is None or mm > pico[0]:
                    pico = (mm, int(pr), momento)

            if not pico:
                continue
            nivel = nivel_de(pico[0])
            if not nivel:
                continue

            dia = pico[2].strftime("%Y-%m-%d")
            clave = f"{sid}:{dia}"
            antes = estado.get(clave, {}).get("nivel")
            if antes and ORDEN[antes] >= ORDEN[nivel]:
                continue  # ya avisado a este nivel o más alto para ese día

            por_nivel[nivel].append((nombre, pico))
            estado[clave] = {
                "nombre": nombre, "nivel": nivel, "dia": dia,
                "mm_h": round(pico[0], 2), "prob": pico[1],
                "hora": pico[2].isoformat(), "avisado": ahora.isoformat(),
            }

        nuevos = sum(len(v) for v in por_nivel.values())
        self.stdout.write(
            f"[{ahora.strftime('%Y-%m-%d %H:%M')}] {len(estaciones)} estaciones "
            f"| próximas {horas} h, prob >= {prob_min}% | avisos nuevos={nuevos}"
        )

        # De mayor a menor: si llegan varias, la roja va primero.
        for nivel, _ in reversed(NIVELES):
            lista = por_nivel[nivel]
            if not lista:
                continue
            lista.sort(key=lambda x: (x[1][2], -x[1][0]))
            primera = lista[0][1][2]
            cuando = f"{DIAS_SEM[primera.weekday()]} {primera.day} {primera.strftime('%H:%M')}"
            detalle = ", ".join(
                f"{n} ({mm:.1f} mm/h, {pr}%)" for n, (mm, pr, _) in lista
            )
            titulo = f"Alerta {nivel} de lluvia prevista · {cuando}"
            self.stdout.write(self.style.WARNING(f"  {titulo}: {detalle}"))
            self._avisar(titulo, detalle[:200], usuarios, simulacro)

        if simulacro:
            self.stdout.write("Simulacro: no se guardó el estado.")
            return
        self._guardar_estado(ruta_estado, estado)
