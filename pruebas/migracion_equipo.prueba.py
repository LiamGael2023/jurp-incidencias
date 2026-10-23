# -*- coding: utf-8 -*-
"""La migracion escrita a mano dice lo mismo que los modelos.

    python3 pruebas/migracion_equipo.prueba.py

POR QUE EXISTE ESTA PRUEBA. parche_equipo_enlazado.py escribe la migracion a
mano porque en ese servidor `makemigrations` no puede: el codigo esta montado
en solo lectura dentro del contenedor, y el fichero de la migracion se
escribe precisamente ahi. Escribirla a mano abre un agujero nuevo: que diga
una cosa distinta de los modelos. Y eso no se nota al migrar -la tabla se
crea igual-, se nota meses despues, cuando una consulta falla porque la
columna quedo NOT NULL o sin indice.

LO QUE SE COMPRUEBA. Campo por campo, los dos modelos contra las dos
CreateModel: mismos nombres, mismo tipo, y los argumentos que cambian el
esquema -max_length, null, default, db_index, on_delete, to- iguales. No es
leer que las palabras aparezcan: se comparan los dos arboles.

LO QUE NO PUEDE COMPROBAR. Que Django opine igual. Para eso esta la
comprobacion de despues, en el servidor:

    manage.py makemigrations core --dry-run   ->  "No changes detected"

Esta prueba es la que falla aqui, antes de subir nada; aquella es la que
confirma alla. Hacen falta las dos.
"""

from __future__ import print_function

import ast
import importlib.util
import os
import sys

AQUI = os.path.dirname(os.path.abspath(__file__))
PARCHE = os.path.join(AQUI, "parche_equipo_enlazado.py")

spec = importlib.util.spec_from_file_location("parche_eq", PARCHE)
P = importlib.util.module_from_spec(spec)
spec.loader.exec_module(P)

mal = [0]; bien = [0]


def t(etiqueta, ok, extra=""):
    if ok:
        bien[0] += 1
        return
    mal[0] += 1
    print("MAL  %s%s" % (etiqueta, ("   [%s]" % extra) if extra else ""))


# ── como se compara un campo ──────────────────────────────────────────────
# Las dos caras escriben lo mismo de forma distinta: en el modelo el primer
# argumento sin nombre es el verbose_name -o el destino, si es una clave
# ajena-, y on_delete se escribe models.CASCADE; en la migracion va con
# nombre y como django.db.models.deletion.CASCADE. Comparar el texto crudo
# daria MAL siempre. Se normalizan los dos a lo mismo.

RELACIONES = ("ForeignKey", "OneToOneField", "ManyToManyField")

# Lo que de verdad cambia la tabla. verbose_name tambien se compara: si los
# dos lados no coinciden, Django ve un cambio pendiente y el --dry-run del
# servidor lo canta.
MIRADOS = ("max_length", "null", "blank", "default", "db_index", "unique",
           "on_delete", "to", "related_name", "auto_now", "auto_now_add",
           "verbose_name", "primary_key", "serialize", "auto_created")


def limpia(texto):
    for prefijo in ("django.db.models.deletion.", "django.db.models.",
                    "models."):
        texto = texto.replace(prefijo, "")
    return texto.strip()


def tipo_de(call):
    f = call.func
    partes = []
    while isinstance(f, ast.Attribute):
        partes.append(f.attr)
        f = f.value
    return partes[0] if partes else getattr(f, "id", "?")


def canon(call):
    """El campo reducido a lo que importa, venga de donde venga."""
    tipo = tipo_de(call)
    d = {}
    for kw in call.keywords:
        if kw.arg in MIRADOS:
            d[kw.arg] = limpia(ast.unparse(kw.value))
    # El primer argumento sin nombre: destino si es relacion, etiqueta si no.
    if call.args:
        clave = "to" if tipo in RELACIONES else "verbose_name"
        d.setdefault(clave, limpia(ast.unparse(call.args[0])))
    return tipo, d


def campos_del_modelo(fuente, clase):
    arbol = ast.parse(fuente)
    for n in ast.walk(arbol):
        if isinstance(n, ast.ClassDef) and n.name == clase:
            out = {}
            for s in n.body:
                if (isinstance(s, ast.Assign) and len(s.targets) == 1
                        and isinstance(s.targets[0], ast.Name)
                        and isinstance(s.value, ast.Call)
                        and tipo_de(s.value).endswith("Field")
                        or (isinstance(s, ast.Assign)
                            and isinstance(s.value, ast.Call)
                            and tipo_de(s.value) in RELACIONES)):
                    out[s.targets[0].id] = canon(s.value)
            return out
    return None


def campos_de_la_migracion(fuente, modelo):
    arbol = ast.parse(fuente)
    for n in ast.walk(arbol):
        if not (isinstance(n, ast.Call) and tipo_de(n) == "CreateModel"):
            continue
        kw = dict((k.arg, k.value) for k in n.keywords)
        nombre = kw.get("name")
        if nombre is None or getattr(nombre, "value", None) != modelo:
            continue
        out = {}
        for par in kw["fields"].elts:
            nom = par.elts[0].value
            if nom == "id":
                continue           # lo pone Django solo
            out[nom] = canon(par.elts[1])
        return out
    return None


# ── la comparacion ────────────────────────────────────────────────────────
MODELOS = P.MODELOS
MIGRACION = P.MIGRACION % {"anterior": "0001_initial"}

t("la migracion es Python valido",
  (lambda: [ast.parse(MIGRACION), True][1])())
t("y cuelga de la migracion anterior, no del aire",
  "('core', '0001_initial')" in MIGRACION)
t("y arrastra el usuario, que es de otra app",
  "swappable_dependency(settings.AUTH_USER_MODEL)" in MIGRACION)

for modelo in ("DispositivoAutorizado", "IngresoSinEquipo"):
    del_modelo = campos_del_modelo(MODELOS, modelo)
    de_la_mig = campos_de_la_migracion(MIGRACION, modelo)

    if del_modelo is None or de_la_mig is None:
        t("%s: esta en los dos lados" % modelo, False,
          "modelo=%s migracion=%s" % (del_modelo is not None,
                                      de_la_mig is not None))
        continue
    t("%s: esta en los dos lados" % modelo, True)

    faltan = sorted(set(del_modelo) - set(de_la_mig))
    sobran = sorted(set(de_la_mig) - set(del_modelo))
    t("%s: no falta ningun campo en la migracion" % modelo, not faltan,
      ", ".join(faltan))
    t("%s: ni sobra ninguno" % modelo, not sobran, ", ".join(sobran))

    for campo in sorted(set(del_modelo) & set(de_la_mig)):
        tm, dm = del_modelo[campo]
        tg, dg = de_la_mig[campo]
        t("%s.%s: mismo tipo" % (modelo, campo), tm == tg,
          "modelo %s / migracion %s" % (tm, tg))
        difs = []
        for k in sorted(set(dm) | set(dg)):
            if dm.get(k) != dg.get(k):
                difs.append("%s: modelo %r / migracion %r"
                            % (k, dm.get(k), dg.get(k)))
        t("%s.%s: mismos argumentos" % (modelo, campo), not difs,
          " | ".join(difs))

# ── El Meta tambien viaja ─────────────────────────────────────────────────
# Si ordering no coincide, Django ve un cambio pendiente. La primera version
# de esto solo miraba que la frase apareciera en la migracion, asi que al
# cambiar el ordering DEL MODELO seguia en verde: comprobaba la migracion
# contra si misma. Ahora se extraen los dos Meta y se comparan.

def meta_del_modelo(fuente, clase):
    arbol = ast.parse(fuente)
    for n in ast.walk(arbol):
        if not (isinstance(n, ast.ClassDef) and n.name == clase):
            continue
        for s in n.body:
            if isinstance(s, ast.ClassDef) and s.name == "Meta":
                return dict((a.targets[0].id, limpia(ast.unparse(a.value)))
                            for a in s.body if isinstance(a, ast.Assign))
        return {}
    return None


def opciones_de_la_migracion(fuente, modelo):
    arbol = ast.parse(fuente)
    for n in ast.walk(arbol):
        if not (isinstance(n, ast.Call) and tipo_de(n) == "CreateModel"):
            continue
        kw = dict((k.arg, k.value) for k in n.keywords)
        if getattr(kw.get("name"), "value", None) != modelo:
            continue
        op = kw.get("options")
        if op is None:
            return {}
        return dict((k.value, limpia(ast.unparse(v)))
                    for k, v in zip(op.keys, op.values))
    return None


for modelo in ("DispositivoAutorizado", "IngresoSinEquipo"):
    mm = meta_del_modelo(MODELOS, modelo)
    mg = opciones_de_la_migracion(MIGRACION, modelo)
    t("%s: el Meta esta en los dos lados" % modelo,
      mm is not None and mg is not None)
    if mm is None or mg is None:
        continue
    difs = []
    for k in sorted(set(mm) | set(mg)):
        if mm.get(k) != mg.get(k):
            difs.append("%s: modelo %r / migracion %r" % (k, mm.get(k), mg.get(k)))
    t("%s: el Meta dice lo mismo" % modelo, not difs, " | ".join(difs))

# Y que la numeracion siga a la ultima, no la pise.
import tempfile, io, shutil
d = tempfile.mkdtemp()
for x in ("__init__.py", "0001_initial.py", "0007_algo.py", "0010_otra.py"):
    io.open(os.path.join(d, x), "w", encoding="utf-8").write("# vacio\n")
n, txt = P.paso_migracion(d)
t("la migracion nueva va detras de la ultima", n == "0011_equipo_enlazado.py", str(n))
t("y cuelga de la ultima, no de la primera",
  "('core', '0010_otra')" in (txt or ""), (txt or "")[:0])

# Si ya estaba, no se escribe otra.
io.open(os.path.join(d, "0011_equipo_enlazado.py"), "w",
        encoding="utf-8").write("# DispositivoAutorizado\n")
n2, av2 = P.paso_migracion(d)
t("si ya estaba, no escribe otra", n2 == "", str(n2))
t("y lo dice", "ya estaba" in av2, av2)

# Sin migraciones previas no se inventa de donde cuelga.
d2 = tempfile.mkdtemp()
n3, av3 = P.paso_migracion(d2)
t("sin migraciones previas, se niega", n3 is None, str(n3))

for x in (d, d2):
    shutil.rmtree(x, ignore_errors=True)

print("\n%d comprobacion(es) en orden%s."
      % (bien[0], ", %d MAL" % mal[0] if mal[0] else ""))
sys.exit(1 if mal[0] else 0)
