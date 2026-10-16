"""
Trae las incidencias de PLUVIRA y mantiene el espejo local al día.

POR QUE EXISTE ESTO
-------------------
Los partes, materiales y personal (operations) cuelgan de IncidentReport por
su CLAVE PRIMARIA, y el front manda como valor el id de la incidencia de
PLUVIRA (ver Incidentes_reportes.jsx: formData.append('incident_report',
incidenteActivo.id)).

Es decir: IncidentReport.id TIENE que ser igual al id de PLUVIRA. Hasta ahora
eso se mantenía tecleando el número a mano, porque esta máquina no podía leer
el otro servidor. Si alguien creaba el registro desde el admin, Django le daba
el siguiente id de la secuencia —no el correcto— y el parte quedaba colgado de
otra incidencia sin que nada avisara.

Este comando elimina ese paso: crea cada espejo FORZANDO el pk.

USO
---
    python manage.py sync_incidencias_pluvira --token <TOKEN>

Opciones:
    --base    URL de PLUVIRA. Por defecto el servidor viejo, que hoy es el
              que manda. El día del corte se cambia a la IP del nuevo.
    --dry-run No escribe nada; dice qué haría.

Las credenciales también se leen de PLUVIRA_TOKEN y PLUVIRA_API_BASE si se
prefiere no ponerlas en la línea del cron.
"""

import os

import requests
from django.core.management.base import BaseCommand
from django.db import connection, transaction

from operations.models import IncidentReport

BASE_POR_DEFECTO = "http://sistema.jriegopresurizado.org.pe"
RUTA = "/api/v1/mobile/hi-incidents/list/"

# Los mismos nombres que muestra el front (Mapa.jsx). Se guardan ya resueltos
# para que el admin sea legible sin tener que cruzar nada.
TIPOS = {
    "1": "Rebose y/o Colapso de canoa o alcantarilla",
    "2": "Ingreso de sedimentos al Canal Madre",
    "3": "Desborde Canal Madre",
    "4": "Desborde Lateral 10",
    "5": "Rotura de Canal",
    "6": "Interrupción del flujo en el canal",
    "7": "Presencia de palizada en canal Madre",
    "8": "Corte de camino de acceso y/o servicio",
    "9": "Rotura de embalse de usuario",
    "10": "Incremento de caudal",
    "11": "Erosión de obras de defensa ribereña",
    "12": "Desborde e inundación",
    "13": "Lluvia",
    "14": "Otros",
}

# IncidentReport.type es CharField(max_length=50): lo que no entra se corta
# aquí y no en la base, que ahí sería un error y no un recorte.
LARGO_TIPO = 50
LARGO_LUGAR = 255


def nombre_tipo(incidencia):
    """
    Etiqueta legible del tipo, con el detalle cuando es 'Otros'.

    Si el detalle no entra en los 50 caracteres del campo se devuelve el tipo
    a secas, no la frase cortada: "Otro (Protección de Canoa 8 | Canal La"
    no informa más que "Otros" y encima parece un error. El texto completo
    está en description, que es un TextField.
    """
    base = TIPOS.get(str(incidencia.get("type")), "Incidente")
    otro = (incidencia.get("another_type") or "").strip()
    if otro and base == "Otros":
        completo = "Otro ({0})".format(otro)
        if len(completo) <= LARGO_TIPO:
            return completo
    return base[:LARGO_TIPO]


class Command(BaseCommand):
    help = "Sincroniza IncidentReport con las incidencias de PLUVIRA."

    def add_arguments(self, parser):
        parser.add_argument(
            "--token",
            default=os.environ.get("PLUVIRA_TOKEN", ""),
            help="Token de PLUVIRA (o variable PLUVIRA_TOKEN).",
        )
        parser.add_argument(
            "--base",
            default=os.environ.get("PLUVIRA_API_BASE", BASE_POR_DEFECTO),
            help="URL de PLUVIRA (o variable PLUVIRA_API_BASE).",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="No escribe; solo informa.",
        )

    def handle(self, *args, **opts):
        token = opts["token"]
        base = opts["base"].rstrip("/")
        simulacro = opts["dry_run"]

        if not token:
            self.stderr.write("Falta el token. Usa --token o PLUVIRA_TOKEN.")
            return

        try:
            r = requests.get(
                base + RUTA,
                headers={"Authorization": "Token " + token},
                timeout=30,
            )
        except requests.RequestException as e:
            self.stderr.write("No pude consultar PLUVIRA: {0}".format(e))
            return

        if r.status_code != 200:
            self.stderr.write(
                "PLUVIRA respondió {0}: {1}".format(r.status_code, r.text[:200])
            )
            return

        incidencias = r.json().get("results") or []
        if not incidencias:
            self.stdout.write("PLUVIRA no devolvió incidencias. No toco nada.")
            return

        creadas = actualizadas = 0

        with transaction.atomic():
            for inc in incidencias:
                pk = inc.get("id")
                if pk is None:
                    continue

                valores = {
                    "code": (inc.get("code") or "")[:50] or None,
                    "type": nombre_tipo(inc),
                    "location_text": (inc.get("location_text") or "")[:LARGO_LUGAR],
                    "description": inc.get("description") or "",
                }

                if simulacro:
                    existe = IncidentReport.objects.filter(pk=pk).exists()
                    self.stdout.write(
                        "{0} #{1} {2}".format(
                            "actualizaría" if existe else "crearía", pk, valores["type"]
                        )
                    )
                    continue

                # El pk va FORZADO: es lo único que hace que los partes
                # apunten a la incidencia correcta.
                _, creado = IncidentReport.objects.update_or_create(
                    pk=pk, defaults=valores
                )
                if creado:
                    creadas += 1
                else:
                    actualizadas += 1

            if not simulacro:
                # Al insertar con pk explícito la secuencia se queda atrás, y
                # el próximo INSERT sin id reventaría con "duplicate key".
                # Esto la pone por encima del máximo.
                with connection.cursor() as c:
                    c.execute(
                        "SELECT setval("
                        "  pg_get_serial_sequence('operations_incidentreport','id'),"
                        "  COALESCE((SELECT MAX(id) FROM operations_incidentreport), 1)"
                        ")"
                    )

        if simulacro:
            self.stdout.write("Simulacro: no se escribió nada.")
            return

        self.stdout.write(
            self.style.SUCCESS(
                "PLUVIRA: {0} incidencias | creadas={1} actualizadas={2}".format(
                    len(incidencias), creadas, actualizadas
                )
            )
        )

        # Espejos que ya no existen en PLUVIRA. No se borran —pueden tener
        # partes colgados— pero conviene saber cuáles son.
        vivos = {i["id"] for i in incidencias if i.get("id") is not None}
        huerfanos = (
            IncidentReport.objects.exclude(pk__in=vivos)
            .order_by("pk")
            .values_list("pk", "type")
        )
        if huerfanos:
            self.stdout.write(
                "Sin equivalente en PLUVIRA ({0}): {1}".format(
                    len(huerfanos),
                    ", ".join("#{0} {1}".format(p, t) for p, t in huerfanos[:20]),
                )
            )
