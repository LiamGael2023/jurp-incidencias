# -*- coding: utf-8 -*-
"""Comprueba el archivado de corridas de pronostico_lluvia.py.

    python3 pruebas/archivo_pronostico.prueba.py

NO TOCA EL SERVIDOR. Carga el comando con Django y requests sustituidos por
maniquies, le da una respuesta de Open-Meteo inventada y mira lo que escribe.

POR QUE ASI. El comando vive dentro de un proyecto Django que no esta en este
repo, asi que no se puede importar tal cual. Pero lo unico que hace falta
probar -que se archive la fila correcta, con el alcance correcto, y que un
hueco no se convierta en un cero- no depende de Django para nada. Sustituir
los imports es mas honesto que copiar la funcion a la prueba: aqui se ejecuta
EL codigo que va a correr en el servidor, no una copia que puede separarse.
"""
import importlib.util
import json
import os
import sys
import tempfile
import types
from datetime import datetime, timedelta

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RUTA = os.path.join(RAIZ, "deploy", "backend-vigilantes", "pronostico_lluvia.py")

mal = [0]
bien = [0]


def t(etiqueta, obtenido, esperado):
    if obtenido == esperado:
        bien[0] += 1
        return
    mal[0] += 1
    print("MAL  %s\n       esperaba %r\n       obtuvo   %r" % (etiqueta, esperado, obtenido))


# ── Maniquies: lo justo para que el modulo cargue ──────────────────────
def _mod(nombre, **attrs):
    m = types.ModuleType(nombre)
    for k, v in attrs.items():
        setattr(m, k, v)
    sys.modules[nombre] = m
    return m


class _BaseCommand(object):
    class style(object):
        WARNING = staticmethod(lambda s: s)

    def __init__(self):
        self.stdout = types.SimpleNamespace(write=lambda s: None)
        self.stderr = types.SimpleNamespace(write=lambda s: errores.append(s))


errores = []

_mod("requests", get=None, RequestException=Exception)
_mod("django")
_mod("django.conf", settings=types.SimpleNamespace())
_mod("django.contrib")
_mod("django.contrib.auth")
_mod("django.contrib.auth.models", User=object)
_mod("django.core")
_mod("django.core.management")
_mod("django.core.management.base", BaseCommand=_BaseCommand)
_mod("django.utils", timezone=types.SimpleNamespace())
_mod("auth_api")
_mod("auth_api.fcm_sender", enviar_push_multiple=lambda *a, **k: {})
_mod("auth_api.models", DispositivoFCM=object)

spec = importlib.util.spec_from_file_location("pronostico_lluvia", RUTA)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

# ── Los umbrales, que tienen que seguir siendo los del front ×4 ────────
t("umbrales en mm/h", [v for _, v in mod.NIVELES], [0.84, 2.52, 4.24])
t("nombres", [n for n, _ in mod.NIVELES], ["amarilla", "naranja", "roja"])
t("justo en el amarillo", mod.nivel_de(0.84), "amarilla")
t("justo por debajo", mod.nivel_de(0.83), None)
t("justo en el rojo", mod.nivel_de(4.24), "roja")
t("muy por encima sigue siendo roja", mod.nivel_de(80), "roja")

# ── Una corrida inventada ──────────────────────────────────────────────
CORRIDA = datetime(2026, 10, 19, 20, 0)
AHORA = CORRIDA + timedelta(minutes=15)   # el cron pasa a y cuarto

ESTACIONES = [
    (7, "VALLUNARAJU", -8.4186, -78.7533),
    (9, "CHAO ALTO", -8.5500, -78.6800),
]


def respuesta(alt, lluvia_en, sin_prob=False, desde=CORRIDA, n=60):
    """Una respuesta horaria con lluvia solo en las horas indicadas.

    'lluvia_en' es {alcance_en_horas: mm}.
    """
    tiempos, mm, prob = [], [], []
    for k in range(n):
        tiempos.append((desde + timedelta(hours=k)).isoformat(timespec="minutes"))
        mm.append(lluvia_en.get(k, 0.0))
        prob.append(None if sin_prob else min(100, 10 + k))
    return {
        "elevation": alt,
        "hourly": {"time": tiempos, "precipitation": mm, "precipitation_probability": prob},
    }


PRON = [
    respuesta(3820.0, {1: 0.1, 24: 3.4, 48: 0.0}),
    respuesta(120.0, {6: 1.1, 24: 0.0}, sin_prob=True),
]

with tempfile.TemporaryDirectory() as carpeta:
    cmd = mod.Command()
    escritas = cmd._archivar(carpeta, ESTACIONES, PRON, AHORA)

    ficheros = sorted(os.listdir(carpeta))
    t("un fichero, por mes", ficheros, ["2026-10.ndjson"])

    with open(os.path.join(carpeta, ficheros[0])) as f:
        filas = [json.loads(l) for l in f if l.strip()]

    t("filas escritas = las que dice haber escrito", len(filas), escritas)
    t("dos estaciones por cinco alcances", len(filas), 10)

    # La corrida se redondea a la hora en punto aunque el cron pase a y
    # cuarto: si no, las filas de una misma corrida no se podrian agrupar.
    t("la corrida es la hora en punto",
      sorted({f["corrida"] for f in filas}), ["2026-10-19T20:00"])

    t("los alcances son los previstos",
      sorted({f["alcance_h"] for f in filas}), [1, 6, 12, 24, 48])

    # La hora objetivo tiene que ser corrida + alcance, no otra cosa.
    descuadres = [
        (f["nombre"], f["alcance_h"], f["objetivo"])
        for f in filas
        if f["objetivo"] != (CORRIDA + timedelta(hours=f["alcance_h"])).isoformat(timespec="minutes")
    ]
    t("ninguna hora objetivo descuadrada", descuadres, [])

    por = {(f["est"], f["alcance_h"]): f for f in filas}

    # EL VALOR. Si el indice se descuadrara una hora, esto lo caza.
    t("VALLUNARAJU a 24 h: los 3.4 mm que dijo el modelo", por[(7, 24)]["mm"], 3.4)
    t("VALLUNARAJU a 1 h", por[(7, 1)]["mm"], 0.1)
    t("VALLUNARAJU a 48 h: llovio 0, y 0 se guarda", por[(7, 48)]["mm"], 0.0)
    t("CHAO ALTO a 6 h", por[(9, 6)]["mm"], 1.1)
    t("CHAO ALTO a 24 h", por[(9, 24)]["mm"], 0.0)

    # La altura de la celda, que es lo que explica el error por estacion.
    t("se guarda la altura del modelo, no la del aparato",
      por[(7, 24)]["alt_modelo"], 3820.0)
    t("y la de la otra estacion", por[(9, 6)]["alt_modelo"], 120.0)

    # AUSENTE NO ES CERO. Es el mismo fallo que en el front: un modelo que no
    # publica probabilidad no esta diciendo 0 %.
    t("con probabilidad, se guarda", por[(7, 24)]["prob"], 34)
    t("sin probabilidad, queda nula y NO cero", por[(9, 6)]["prob"], None)

    # Se anade, no se reescribe: una corrida a medias no borra las anteriores.
    cmd._archivar(carpeta, ESTACIONES, PRON, AHORA + timedelta(hours=1))
    with open(os.path.join(carpeta, ficheros[0])) as f:
        filas2 = [json.loads(l) for l in f if l.strip()]
    t("la segunda corrida se anade a la primera", len(filas2), 20)
    t("y son corridas distintas",
      sorted({f["corrida"] for f in filas2}),
      ["2026-10-19T20:00", "2026-10-19T21:00"])

    # Carpeta vacia = no archivar, sin reventar.
    t("sin carpeta no archiva", cmd._archivar("", ESTACIONES, PRON, AHORA), 0)

    # Una estacion cuya serie no llega hasta las 48 h no debe inventar fila.
    corta = [respuesta(100.0, {1: 0.5}, n=10), respuesta(100.0, {1: 0.5}, n=10)]
    with tempfile.TemporaryDirectory() as c2:
        n = cmd._archivar(c2, ESTACIONES, corta, AHORA)
        t("serie corta: solo los alcances que existen", n, 4)   # 1 y 6 h, x2

t("ningun error por el camino", errores, [])

print("\n%d comprobacion(es) en orden%s." % (bien[0], ", %d MAL" % mal[0] if mal[0] else ""))
sys.exit(1 if mal[0] else 0)
