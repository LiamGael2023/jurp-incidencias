# -*- coding: utf-8 -*-
"""Que las rutas de /api/operadores/ acepten tambien el token.

    # primero en seco, que no toca nada:
    sudo python3 parche_token_operadores.py --base /var/www/envs/prod
    # y si pinta bien:
    sudo python3 parche_token_operadores.py --base /var/www/envs/prod --aplicar

SE APLICA EN EL HOST, no dentro del contenedor: /app/src esta montado de
solo lectura y la escritura falla a mitad.

────────────────────────────────────────────────────────────────────────────
EL FALLO, MEDIDO

Las cinco vistas declaran:

    authentication_classes = [SessionAuthentication]

y eso PISA el valor por defecto de DRF, que en este proyecto si es
TokenAuthentication. Una lista declarada en la clase no se suma a la de por
defecto: la sustituye. Resultado: la cabecera `Authorization: Token ...` no
se mira siquiera, y DRF contesta 403 con "Falta autenticacion".

Se comprobo llamando a las cinco rutas desde dentro del contenedor, con el
cliente de pruebas de Django y la cabecera puesta a mano: respondieron 403
IGUAL con token que sin el. Para esas vistas el token no existe.

La prueba de que esto es lo que falta esta en el propio fichero: la sexta
ruta, /api/operadores/registros/, tiene TokenAuthentication y por eso la
app movil si entra. Las otras cinco nacieron para las paginas del sistema
viejo, que van por sesion.

────────────────────────────────────────────────────────────────────────────
LO QUE HACE

    authentication_classes = [TokenAuthentication, SessionAuthentication]

SE CONSERVA SessionAuthentication, y no es un detalle: si se quita, las
paginas de /backend/monitoreo/operadores/ del sistema viejo dejan de cargar
sus graficos en el acto. Se añade, no se cambia.

TokenAuthentication va DELANTE porque DRF prueba en orden y se queda con la
primera que devuelva usuario: asi, cuando viene cabecera, manda la cabecera.

────────────────────────────────────────────────────────────────────────────
A QUIEN LE ABRE LA PUERTA

Hoy pueden leer estas rutas los usuarios con sesion de navegador. Despues,
ademas, cualquiera con un token valido —que incluye a las cuentas de la app
movil—. El permiso sigue siendo IsAuthenticated: no se vuelven publicas.

Si se quiere mas estrecho, el sitio es `permission_classes`, no la
autenticacion. Dilo y lo preparo.

────────────────────────────────────────────────────────────────────────────
COMO SE PORTA ESTE GUION

  · En seco por defecto. Hay que escribir --aplicar.
  · Idempotente: si ya esta puesto, lo dice y no toca.
  · Se niega antes que adivinar: si no encuentra el fichero, o encuentra
    varios, o una clase no tiene la linea esperada, para sin escribir.
  · Comprueba que puede escribir TODO antes de escribir NADA -el fichero y
    su carpeta, que es donde va la copia-.
  · Copia de seguridad con fecha al lado del original.
  · Valida el resultado con ast antes de guardarlo, y comprueba que lo que
    usa esta importado: ast no ve esa clase de fallo, y es justo la que
    deja el servidor sin arrancar.
"""
from __future__ import print_function

import argparse
import ast
import datetime
import io
import os
import re
import shutil
import sys

CLASES = [
    "OperadoresTomasListView",
    "OperadoresTomasStatusSummaryView",
    "OperadoresSeriesView",
    "OperadoresVolumeByTomaView",
    "OperadoresVolumeByMonthView",
]

IMPORT_NUEVO = "from rest_framework.authentication import TokenAuthentication"

SALTAR = {".git", "node_modules", "__pycache__", "static", "media",
          "venv", "env", ".venv", "migrations", "locale"}


# ── Trozos puros, para poder probarlos sin servidor ─────────────────────

def offset_de_linea(texto, n):
    """El offset del principio de la linea n (contando desde 1)."""
    pos = 0
    for _ in range(n - 1):
        pos = texto.index("\n", pos) + 1
    return pos


def fin_de_sentencia(texto, inicio):
    """Donde acaba la sentencia que empieza en `inicio`.

    Cuenta corchetes para no partir por la mitad una lista escrita en
    varias lineas: `authentication_classes = [\\n    Session...,\\n]` es
    perfectamente legal y cortarla por el primer salto de linea dejaria el
    fichero roto.
    """
    i = inicio
    prof = 0
    while i < len(texto):
        c = texto[i]
        if c in "([{":
            prof += 1
        elif c in ")]}":
            prof -= 1
        elif c == "\n" and prof <= 0:
            return i
        i += 1
    return len(texto)


def localiza_asignacion(texto, clase):
    """(inicio, fin) de `authentication_classes = ...` dentro de `clase`.

    Se busca con ast y no con una expresion regular porque en el mismo
    fichero hay otras vistas -ReporteCreateView y companie- con esa misma
    linea, y tocarlas seria cambiar el acceso de pantallas que nadie ha
    pedido tocar.
    """
    arbol = ast.parse(texto)
    for nodo in ast.walk(arbol):
        if not isinstance(nodo, ast.ClassDef) or nodo.name != clase:
            continue
        for hijo in nodo.body:
            if not isinstance(hijo, ast.Assign):
                continue
            for destino in hijo.targets:
                if isinstance(destino, ast.Name) \
                        and destino.id == "authentication_classes":
                    ini = offset_de_linea(texto, hijo.lineno)
                    return (ini, fin_de_sentencia(texto, ini))
    return None


def reescribe_lista(fragmento):
    """Mete TokenAuthentication delante. None si ya esta o no se reconoce."""
    if "TokenAuthentication" in fragmento:
        return None
    m = re.search(r"authentication_classes\s*=\s*[\[\(]", fragmento)
    if not m:
        return None
    resto = fragmento[m.end():].lstrip()
    # Una lista vacia no lleva coma detras: `[TokenAuthentication]`.
    coma = "" if resto[:1] in ("]", ")") else ", "
    return fragmento[:m.end()] + "TokenAuthentication" + coma + fragmento[m.end():]


def fin_de_imports(texto):
    """El offset tras el ultimo import de primer nivel."""
    arbol = ast.parse(texto)
    ultimo = 0
    for nodo in arbol.body:
        if isinstance(nodo, (ast.Import, ast.ImportFrom)):
            ini = offset_de_linea(texto, nodo.lineno)
            ultimo = fin_de_sentencia(texto, ini) + 1
    return ultimo


def arregla_import(texto):
    """(texto, que_se_hizo). Deja TokenAuthentication importado."""
    linea = re.compile(
        r"^([ \t]*from[ \t]+rest_framework\.authentication[ \t]+import[ \t]+)"
        r"([^\n(]+)$", re.M)
    m = linea.search(texto)
    if m and "TokenAuthentication" in m.group(2):
        return texto, "ya estaba importado"
    if m:
        nuevo = m.group(1) + m.group(2).rstrip() + ", TokenAuthentication"
        return texto[:m.start()] + nuevo + texto[m.end():], \
            "anadido a la linea de import que ya existia"
    corte = fin_de_imports(texto)
    return texto[:corte] + IMPORT_NUEVO + "\n" + texto[corte:], \
        "linea de import nueva"


def nombres_sin_importar(texto, nombres):
    """Los que se usan y no estan ni importados ni definidos.

    ast.parse NO ve esto: un fichero que usa TokenAuthentication sin
    importarlo compila igual y revienta al arrancar el servidor. Es el
    mismo agujero que en el lado web deja la pantalla en blanco.
    """
    arbol = ast.parse(texto)
    conocidos = set()
    for nodo in ast.walk(arbol):
        if isinstance(nodo, ast.ImportFrom):
            for a in nodo.names:
                conocidos.add(a.asname or a.name)
        elif isinstance(nodo, ast.Import):
            for a in nodo.names:
                conocidos.add((a.asname or a.name).split(".")[0])
        elif isinstance(nodo, (ast.ClassDef, ast.FunctionDef)):
            conocidos.add(nodo.name)
        elif isinstance(nodo, ast.Assign):
            for d in nodo.targets:
                if isinstance(d, ast.Name):
                    conocidos.add(d.id)
    usados = set()
    for nodo in ast.walk(arbol):
        if isinstance(nodo, ast.Name) and isinstance(nodo.ctx, ast.Load):
            usados.add(nodo.id)
    return sorted((set(nombres) & usados) - conocidos)


# ── Lo que toca el disco ────────────────────────────────────────────────

def busca_fichero(base):
    """Los .py que definen LAS CINCO clases. Deberia ser uno."""
    encontrados = []
    for raiz, dirs, ficheros in os.walk(base):
        dirs[:] = [d for d in dirs if d not in SALTAR]
        for f in ficheros:
            if not f.endswith(".py"):
                continue
            ruta = os.path.join(raiz, f)
            try:
                with io.open(ruta, encoding="utf-8") as fh:
                    t = fh.read()
            except Exception:
                continue
            if all(("class " + c) in t for c in CLASES):
                encontrados.append(ruta)
    return encontrados


def puedo_escribir(ruta):
    """El fichero Y su carpeta: la copia de seguridad va al lado.

    Se comprueba ANTES de tocar nada. La version anterior de este guion
    escribia y se encontraba el 'Read-only file system' a mitad; que no
    quedara nada a medias fue suerte del orden del bucle, no diseño.

    SE PRUEBA DE VERDAD, no se pregunta. `os.access(ruta, os.W_OK)` le
    contesta que si a root aunque el fichero no tenga permiso de escritura,
    y esto se corre con sudo: la pregunta sale bien justo en el caso en que
    menos sirve. Abrir el fichero para añadir -sin escribir nada- y crear y
    borrar una sonda en la carpeta pasan por el kernel igual que lo haria
    la escritura de verdad.
    """
    faltan = []
    try:
        with io.open(ruta, "a"):
            pass
    except Exception as e:
        faltan.append("%s  (%s)" % (ruta, e))
    carpeta = os.path.dirname(ruta) or "."
    sonda = os.path.join(carpeta, ".sonda-parche-token")
    try:
        with io.open(sonda, "w", encoding="utf-8") as fh:
            fh.write(u"")
        os.remove(sonda)
    except Exception as e:
        faltan.append("%s%s  (%s)" % (carpeta, os.sep, e))
    return faltan


def main():
    p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    p.add_argument("--base", required=True,
                   help="raiz del proyecto en el HOST, p.ej. /var/www/envs/prod")
    p.add_argument("--aplicar", action="store_true",
                   help="sin esto no escribe nada")
    args = p.parse_args()

    if not os.path.isdir(args.base):
        print("MAL  no existe la carpeta %s" % args.base)
        return 1

    print("Buscando las cinco vistas bajo %s ..." % args.base)
    candidatos = busca_fichero(args.base)
    if len(candidatos) == 0:
        print("MAL  no encuentro ningun .py que defina las cinco clases:")
        for c in CLASES:
            print("       %s" % c)
        print("     No toco nada. Comprueba --base.")
        return 1
    if len(candidatos) > 1:
        print("MAL  las cinco clases aparecen en mas de un fichero:")
        for c in candidatos:
            print("       %s" % c)
        print("     No adivino cual es el bueno. No toco nada.")
        return 1

    ruta = candidatos[0]
    print("     %s" % ruta)
    with io.open(ruta, encoding="utf-8") as fh:
        original = fh.read()

    # ── 1. que esta como esperamos ──────────────────────────────────────
    print("")
    print("Mirando clase por clase:")
    trabajo = []
    for clase in CLASES:
        sitio = localiza_asignacion(original, clase)
        if sitio is None:
            print("  MAL  %s no tiene authentication_classes" % clase)
            print("       No toco nada: el fichero no es el que creia.")
            return 1
        frag = original[sitio[0]:sitio[1]]
        nuevo = reescribe_lista(frag)
        if nuevo is None:
            print("  ok   %s ya acepta token" % clase)
        else:
            print("  ->   %s" % clase)
            print("         antes : %s" % " ".join(frag.split()))
            print("         ahora : %s" % " ".join(nuevo.split()))
            trabajo.append((sitio, nuevo))

    if not trabajo:
        print("")
        print("No hay nada que hacer: las cinco ya aceptan token.")
        return 0

    # ── 2. el texto nuevo ───────────────────────────────────────────────
    # De atras hacia delante, para que los offsets de los trozos que aun no
    # se han tocado sigan valiendo.
    texto = original
    for sitio, nuevo in sorted(trabajo, key=lambda x: x[0][0], reverse=True):
        texto = texto[:sitio[0]] + nuevo + texto[sitio[1]:]

    texto, que_import = arregla_import(texto)
    print("")
    print("Import: %s" % que_import)

    # ── 3. que el resultado sea codigo valido ───────────────────────────
    try:
        ast.parse(texto)
    except SyntaxError as e:
        print("")
        print("MAL  el resultado no compila: %s" % e)
        print("     Es fallo del parche. No se escribe nada.")
        return 1
    sueltos = nombres_sin_importar(texto, ["TokenAuthentication",
                                           "SessionAuthentication"])
    if sueltos:
        print("")
        print("MAL  el resultado usa sin importar: %s" % ", ".join(sueltos))
        print("     No se escribe nada.")
        return 1
    print("Comprobado: compila y lo que usa esta importado.")

    # ── 4. en seco se acaba aqui ────────────────────────────────────────
    if not args.aplicar:
        print("")
        print("EN SECO. No se ha tocado nada.")
        print("Para aplicarlo de verdad, repite con --aplicar.")
        return 0

    # ── 5. poder escribirlo TODO antes de escribir NADA ─────────────────
    faltan = puedo_escribir(ruta)
    if faltan:
        print("")
        print("MAL  no puedo escribir en:")
        for f in faltan:
            print("       %s" % f)
        print("     Si estas dentro del contenedor, sal: /app/src esta")
        print("     montado de solo lectura. Hazlo en el host, sobre")
        print("     /var/www/envs/prod, y con sudo.")
        return 1

    # ── 6. copia y escritura ────────────────────────────────────────────
    sello = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    copia = "%s.bak-%s" % (ruta, sello)
    shutil.copy2(ruta, copia)
    with io.open(ruta, "w", encoding="utf-8") as fh:
        fh.write(texto)

    print("")
    print("APLICADO.")
    print("  copia de seguridad: %s" % copia)
    print("")
    print("Falta reiniciar para que se cargue:")
    print("  docker restart jurp_web")
    print("")
    print("Y para comprobarlo sin salir del servidor:")
    print("  docker exec -w /app -i jurp_web python manage.py shell"
          " < ver_auth_operadores.py")
    print("  -> las cinco rutas tienen que pasar de 403 a 200 'con cabecera'.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
