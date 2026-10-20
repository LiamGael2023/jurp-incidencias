# -*- coding: utf-8 -*-
"""El presupuesto propio de una incidencia: titulos que suman y partidas.

    python3 parche_partidas_propias_incidencia.py                 # solo mira
    python3 parche_partidas_propias_incidencia.py --aplicar        # aplica
    python3 parche_partidas_propias_incidencia.py --base /ruta     # si no autodetecta

HACE FALTA parche_partidas_de_incidencia.py APLICADO ANTES. Este amplia el
views_incidentes.py que aquel crea; si no esta, se niega y lo dice.

SE PUEDE CORRER SOBRE LA VERSION ANTERIOR de este mismo parche. El bloque
que escribe va marcado y, si ya hay uno, se reemplaza entero en vez de
anadirse otro al lado.

QUE SE CONSTRUYE
================

El presupuesto de una incidencia, con la misma forma que el de una obra:

    1            <la incidencia>                              1,007,949.20
    01           TRABAJOS PRELIMINARES                           23,621.00
    01.01        Movilizacion de maquinaria      glb  1.00  5,000.00
    01.02        Trazo y replanteo               mes  3.00  6,207.00
    02           OBRAS PROVISIONALES                              8,764.08
    02.01        Almacen provisional             m2  24.00    102.67

Dos clases de fila, y la diferencia no es cosmetica:

  - TITULO. Solo descripcion. Su total es la suma de lo que cuelga de el, no
    un numero que alguien teclea. Un total tecleado deja de cuadrar con sus
    hijos en cuanto se corrige uno, y como los dos numeros son plausibles
    nadie lo nota.
  - PARTIDA. Lleva unidad, metrado y precio, y es la unica contra la que un
    parte diario puede imputar.

LA FILA 1 ES LA INCIDENCIA y no se guarda: se dibuja. Es el equivalente al
nombre del proyecto en el Excel del presupuesto. Guardarla seria crear una
fila que no se puede borrar ni editar y que nadie eligio.

EL CODIGO SE GENERA, jerarquico: 01, 02 en la raiz; 01.01, 01.02 debajo del
01. Se mira el MAYOR hermano que ya hay y se suma uno -contarlos devolveria
un codigo repetido en cuanto se borre uno de en medio, y Partida tiene
UniqueConstraint(obra, codigo)-. Dos digitos por tramo, que es como esta
escrito el resto del presupuesto; con mas de 99 hermanos en un nivel el
orden alfabetico dejaria de coincidir con el numerico, y eso se avisa en vez
de romperse por dentro.

POR QUE es_titulo ES UN CAMPO Y NO SE DEDUCE
============================================

Se podria decir "es titulo el que tiene hijos". Pero entonces un titulo
recien creado, todavia vacio, no seria un titulo: desapareceria al recargar.
Y armar la estructura primero y rellenarla despues es exactamente como se
escribe un presupuesto. El campo es aditivo, default False, y no cambia nada
de los presupuestos ya cargados.

LA RUTA se rellena con la del padre mas el propio padre. Es el campo que ya
usa la escalera del parte diario -parche_ruta_partida.py-, asi que el arbol
que se arme aqui se recorre con el mismo codigo que el de una obra, sin
inventar un segundo modo de bajar.

LO QUE NO SE DEJA HACER, Y POR QUE
==================================

  - Borrar una partida con metrado ya imputado en un parte. Dejaria el parte
    apuntando a una fila que no esta y su avance contando contra nada. Se
    responde 409 con cuantos partes la usan; para eso esta la edicion.
  - Borrar un titulo con algo colgando. Se llevaria por delante filas que no
    se estan mirando. Primero se vacia.
  - Editar desde aqui una partida que vino de un presupuesto real. Moveria el
    presupuesto de una obra entera desde la ficha de un incidente.
"""

from __future__ import print_function

import datetime
import io
import os
import re
import shutil
import sys

CANDIDATOS = [
    "/var/www/envs/vigilantes",
    "/root/proyectos/api_vigilantes",
    os.getcwd(),
]

APLICAR = "--aplicar" in sys.argv

# Sube cuando cambia lo que se escribe, para poder reemplazar lo viejo.
MARCA = "# >>> PARTIDAS PROPIAS DE LA INCIDENCIA (parche v2) >>>"


def base_del_proyecto():
    if "--base" in sys.argv:
        return sys.argv[sys.argv.index("--base") + 1]
    for c in CANDIDATOS:
        if os.path.isfile(os.path.join(c, "operations", "models.py")):
            return c
    return None


# ══════════════════════════════════════════════════════════════════════════
# PIEZA 1 · el campo es_titulo en Partida
# ══════════════════════════════════════════════════════════════════════════

CAMPO = '''
{0}# UNA FILA QUE AGRUPA, NO UNA QUE SE EJECUTA.
{0}#
{0}# Se podria deducir -"es titulo el que tiene hijos"-, pero entonces un
{0}# titulo recien creado y todavia vacio no lo seria, y desapareceria al
{0}# recargar. Armar la estructura primero y rellenarla despues es
{0}# exactamente como se escribe un presupuesto.
{0}#
{0}# Un titulo no lleva unidad, metrado ni precio: su total es la suma de lo
{0}# que cuelga. Y ningun parte diario puede imputar contra el.
{0}es_titulo = models.BooleanField("Es titulo", default=False)
'''


def bloque_clase(texto, clase):
    m = re.search(r"^class\s+" + re.escape(clase) + r"\s*\(", texto, re.M)
    if not m:
        return None
    sig = re.search(r"^class\s+\w+\s*\(", texto[m.end():], re.M)
    fin = m.end() + sig.start() if sig else len(texto)
    return (m.start(), fin)


def sangria_de(cuerpo):
    # [ \t]+ y no \s+: \s se come el salto de linea y el campo sale
    # entrelineado. Ya paso una vez.
    m = re.search(r"^([ \t]+)\S", cuerpo, re.M)
    return m.group(1) if m else "    "


def paso_modelo(texto):
    pos = bloque_clase(texto, "Partida")
    if not pos:
        return None, "no encuentro class Partida en models.py"
    ini, fin = pos
    cuerpo = texto[ini:fin]

    # El arbol se apoya en 'ruta'. Sin ese campo la escalera no existe y
    # esto no tendria donde colgar los niveles.
    if not re.search(r"^[ \t]+ruta\s*=", cuerpo, re.M):
        return None, ("Partida no tiene el campo 'ruta'; aplica antes "
                      "parche_ruta_partida.py")

    if re.search(r"^[ \t]+es_titulo\s*=", cuerpo, re.M):
        return texto, "ya estaba: Partida.es_titulo"

    campo = CAMPO.format(sangria_de(cuerpo))
    m = re.search(r"^[ \t]+class\s+Meta\b", cuerpo, re.M)
    if m:
        nuevo = cuerpo[:m.start()] + campo.rstrip("\n") + "\n\n" + cuerpo[m.start():]
    else:
        nuevo = cuerpo.rstrip("\n") + "\n" + campo
    return texto[:ini] + nuevo + texto[fin:], "anadido Partida.es_titulo"


# ══════════════════════════════════════════════════════════════════════════
# PIEZA 2 · el detalle, que ahora es un arbol
# ══════════════════════════════════════════════════════════════════════════

DETALLE = '''    def get_partidas_detalle(self, obj):
        """El presupuesto de la incidencia, en orden de arbol.

        EL TOTAL DE UN TITULO SE SUMA, NO SE GUARDA. Es lo que cuelga de el,
        recalculado en cada lectura. Un total guardado deja de cuadrar con
        sus hijos en cuanto se corrige uno, y como los dos numeros son
        plausibles nadie lo nota hasta que alguien suma a mano.

        EL EJECUTADO ES DE TODA LA OBRA, no solo de esta incidencia. El saldo
        de una partida no depende de quien se lo haya ido gastando: si otro
        sujeto ya excavo 100 de los 173, aqui quedan 73 aunque esta
        incidencia no haya tocado ninguno. Un saldo "propio" invitaria a
        pasarse del presupuesto entre varios sin que ninguno lo notara.

        Solo suma el metrado imputado en la MISMA unidad que la partida. Lo
        imputado en otra no se suma -daria un avance falso- pero tampoco se
        esconde: queda a la vista en el saldo.
        """
        partidas = sorted(obj.partidas.all(), key=lambda p: _orden(p.codigo))
        if not partidas:
            return []

        hojas = [p for p in partidas if not getattr(p, "es_titulo", False)]
        hecho = {}
        if hojas:
            filas = (DailyPartActivity.objects
                     .filter(partida_id__in=[p.id for p in hojas])
                     .values("partida_id", "metrado_unidad")
                     .annotate(suma=Sum("metrado")))
            for f in filas:
                hecho.setdefault(f["partida_id"], {})[
                    _normaliza(f["metrado_unidad"])] = float(f["suma"] or 0)

        # Lo que aporta cada hoja, para poder sumarlo en sus ancestros.
        aporte = {}
        for p in hojas:
            total = float(p.metrado or 0)
            eje = hecho.get(p.id, {}).get(_normaliza(p.unidad), 0.0)
            precio = float(p.precio or 0)
            aporte[p.codigo] = (total * precio, eje * precio)

        salida = []
        for p in partidas:
            titulo = bool(getattr(p, "es_titulo", False))
            fila = {
                "id": p.id,
                "codigo": p.codigo,
                "descripcion": p.descripcion,
                "es_titulo": titulo,
                "nivel": _nivel(p.codigo),
                "padre": _padre(p.codigo),
            }
            if titulo:
                # Suma de lo que cuelga. Se mira el codigo y no la ruta
                # porque un titulo recien creado todavia no esta en la ruta
                # de nadie, y asi un titulo vacio suma 0 en vez de fallar.
                imp = val = 0.0
                for cod, (i, v) in aporte.items():
                    if cod.startswith(p.codigo + "."):
                        imp += i
                        val += v
                fila.update({
                    "unidad": "", "metrado": None, "precio": None,
                    "importe": round(imp, 2),
                    "ejecutado": None, "saldo": None, "avance": None,
                    "valorizado": round(val, 2),
                })
            else:
                total = float(p.metrado or 0)
                eje = hecho.get(p.id, {}).get(_normaliza(p.unidad), 0.0)
                precio = float(p.precio or 0)
                fila.update({
                    "unidad": p.unidad,
                    "metrado": total,
                    "precio": precio,
                    "importe": round(total * precio, 2),
                    "ejecutado": round(eje, 4),
                    "saldo": round(total - eje, 4),
                    "avance": round(eje / total * 100, 2) if total else None,
                    "valorizado": round(eje * precio, 2),
                })
            salida.append(fila)
        return salida

'''


def paso_detalle(texto):
    """Cambia get_partidas_detalle por la version con arbol.

    Se reemplaza el bloque entero entre sus dos linderos, que los escribio
    el parche anterior, en vez de parchear lineas sueltas dentro: un
    reemplazo por trozos sobre un metodo que ya cambio de forma deja mitades
    de las dos versiones.
    """
    if "es_titulo" in texto and "_orden(" in texto:
        return texto, "ya estaba: el detalle en arbol"

    ini = texto.find("    def get_partidas_detalle(self, obj):")
    fin = texto.find("    def get_presupuestado(self, obj):")
    if ini < 0 or fin < 0 or fin < ini:
        return None, ("no encuentro get_partidas_detalle/get_presupuestado "
                      "tal como los escribe parche_partidas_de_incidencia.py")
    return texto[:ini] + DETALLE + texto[fin:], "detalle reescrito en arbol"


# ══════════════════════════════════════════════════════════════════════════
# PIEZA 3 · las vistas de alta, edicion y baja
# ══════════════════════════════════════════════════════════════════════════

VISTAS = MARCA + '''
# No edites dentro de este bloque: el parche lo reemplaza entero.

def _tramos(codigo):
    return [t for t in (codigo or "").split(".") if t]


def _nivel(codigo):
    return len(_tramos(codigo))


def _padre(codigo):
    t = _tramos(codigo)
    return ".".join(t[:-1]) if len(t) > 1 else None


def _orden(codigo):
    """Clave para ordenar codigos jerarquicos por numero, no por texto.

    "01.10" y "01.9" ordenan al reves si se comparan como texto. Con dos
    digitos por tramo coinciden, pero el dia que alguien cargue un codigo de
    un digito -y el Excel del presupuesto los trae asi en los niveles de
    arriba- el arbol saldria desordenado sin que nada fallase.
    """
    salida = []
    for t in _tramos(codigo):
        m = re.match(r"^\\s*(\\d+)", t)
        salida.append((0, int(m.group(1))) if m else (1, 0))
    return salida


def _obra_de(inc):
    """El nombre de obra con el que se guardan las partidas de esta incidencia.

    Es el codigo de la incidencia, y si no lo tiene, su id. Esto es lo que
    las mantiene separadas del presupuesto de cualquier obra real: el
    selector de presupuestos filtra por obra, asi que no se cuelan, y el
    UniqueConstraint(obra, codigo) de Partida hace que el 01 de esta
    incidencia no choque con el 01 de ninguna otra parte.
    """
    return (inc.code or "").strip() or "INCIDENTE-%s" % inc.pk


def _siguiente_codigo(obra, padre_cod):
    """El correlativo siguiente entre los HERMANOS de ese nivel.

    Se mira el mayor que ya hay y se suma uno, en vez de contar cuantos son.
    Contando, borrar el 02 de tres devolveria un 03 que ya existe y el alta
    reventaria contra el UniqueConstraint.
    """
    prefijo = (padre_cod + ".") if padre_cod else ""
    hondo = _nivel(padre_cod) + 1 if padre_cod else 1
    mayor = 0
    for c in Partida.objects.filter(obra=obra).values_list("codigo", flat=True):
        c = c or ""
        if _nivel(c) != hondo or not c.startswith(prefijo):
            continue
        m = re.match(r"^\\s*(\\d+)", _tramos(c)[-1])
        if m:
            mayor = max(mayor, int(m.group(1)))
    return "%s%02d" % (prefijo, mayor + 1)


def _numero(v, campo, errores, minimo=None):
    try:
        n = float(v)
    except (TypeError, ValueError):
        errores[campo] = ["Tiene que ser un numero."]
        return None
    if minimo is not None and n < minimo:
        errores[campo] = ["No puede ser menor que %s." % minimo]
        return None
    return n


def _lee_campos(datos, errores, titulo=False, obligatorios=True):
    """Los campos del formulario, limpios.

    Se validan aqui y no en un ModelSerializer porque 'obra', 'codigo' y
    'ruta' no los manda el formulario -los pone el servidor- y un serializer
    completo obligaria a inventarlos en el navegador o a marcarlos read_only
    y rellenarlos igual a mano.
    """
    out = {}
    desc = (datos.get("descripcion") or "").strip()
    if obligatorios or "descripcion" in datos:
        if not desc:
            errores["descripcion"] = ["Hace falta la descripcion."]
        elif len(desc) > 300:
            errores["descripcion"] = ["Maximo 300 caracteres."]
        else:
            out["descripcion"] = desc

    if titulo:
        # Un titulo no lleva nada mas. Si llegaran unidad o precio seria un
        # formulario equivocado, y guardarlos en silencio dejaria una fila
        # que suma y ademas tiene precio propio.
        return out

    unidad = (datos.get("unidad") or "").strip()
    if obligatorios or "unidad" in datos:
        if not unidad:
            errores["unidad"] = ["Hace falta la unidad."]
        elif len(unidad) > 12:
            errores["unidad"] = ["Maximo 12 caracteres."]
        else:
            out["unidad"] = unidad
    if obligatorios or "metrado" in datos:
        n = _numero(datos.get("metrado", 0), "metrado", errores, minimo=0)
        if n is not None:
            out["metrado"] = n
    if obligatorios or "precio" in datos:
        n = _numero(datos.get("precio", 0), "precio", errores, minimo=0)
        if n is not None:
            out["precio"] = n
    return out


def _ruta_bajo(padre):
    """La ruta de un hijo: la del padre mas el padre.

    Es el mismo campo que usa la escalera del parte diario, asi que el arbol
    que se arme aqui se recorre con el codigo de siempre.
    """
    if padre is None:
        return []
    base = padre.ruta
    if isinstance(base, str):
        try:
            base = json.loads(base or "[]")
        except ValueError:
            base = []
    if not isinstance(base, list):
        base = []
    return base + [[padre.codigo, padre.descripcion]]


@api_view(["POST"])
@permission_classes([AllowAny])
def incidencia_partida_alta(request, pk):
    """Crea un titulo o una partida y lo cuelga donde toque.

    Devuelve la incidencia entera, no solo lo creado: los totales de los
    titulos de arriba acaban de cambiar y pedirlos aparte dejaria medio
    segundo los numeros viejos en pantalla.
    """
    try:
        inc = IncidentReport.objects.get(pk=pk)
    except IncidentReport.DoesNotExist:
        return Response({"detail": "No existe."},
                        status=status.HTTP_404_NOT_FOUND)

    tipo = (request.data.get("tipo") or "partida").strip().lower()
    if tipo not in ("titulo", "partida"):
        return Response({"tipo": ["Tiene que ser 'titulo' o 'partida'."]},
                        status=status.HTTP_400_BAD_REQUEST)
    es_titulo = tipo == "titulo"

    padre = None
    padre_id = request.data.get("padre")
    if padre_id not in (None, "", "null"):
        padre = inc.partidas.filter(pk=padre_id).first()
        if padre is None:
            return Response({"padre": ["Ese titulo no esta en esta incidencia."]},
                            status=status.HTTP_400_BAD_REQUEST)
        if not getattr(padre, "es_titulo", False):
            # Colgar de una partida la convertiria en un titulo a medias: con
            # metrado propio y ademas hijos que suman. El total dejaria de
            # significar una cosa sola.
            return Response(
                {"padre": ["Solo se puede colgar de un titulo. '%s' es una "
                           "partida." % padre.codigo]},
                status=status.HTTP_400_BAD_REQUEST)

    errores = {}
    campos = _lee_campos(request.data, errores, titulo=es_titulo)
    if errores:
        return Response(errores, status=status.HTTP_400_BAD_REQUEST)

    obra = _obra_de(inc)
    codigo = _siguiente_codigo(obra, padre.codigo if padre else None)
    p = Partida.objects.create(
        obra=obra,
        proyecto=(inc.description or "")[:300],
        codigo=codigo,
        es_titulo=es_titulo,
        unidad=campos.get("unidad", ""),
        metrado=campos.get("metrado", 0),
        precio=campos.get("precio", 0),
        descripcion=campos["descripcion"],
        ruta=json.dumps(_ruta_bajo(padre)),
        activo=True)
    inc.partidas.add(p)
    return Response(IncidentReportSerializer(inc).data,
                    status=status.HTTP_201_CREATED)


@api_view(["PATCH", "DELETE"])
@permission_classes([AllowAny])
def incidencia_partida_detalle(request, pk, partida_id):
    """Corrige o quita una fila propia de esta incidencia."""
    try:
        inc = IncidentReport.objects.get(pk=pk)
    except IncidentReport.DoesNotExist:
        return Response({"detail": "No existe la incidencia."},
                        status=status.HTTP_404_NOT_FOUND)

    p = inc.partidas.filter(pk=partida_id).first()
    if p is None:
        return Response({"detail": "Esa partida no esta en esta incidencia."},
                        status=status.HTTP_404_NOT_FOUND)

    propia = p.obra == _obra_de(inc)
    es_titulo = bool(getattr(p, "es_titulo", False))

    if request.method == "PATCH":
        if not propia:
            return Response(
                {"detail": "Esa partida es del presupuesto de %s. Desde aqui "
                           "no se edita." % p.obra},
                status=status.HTTP_409_CONFLICT)
        errores = {}
        campos = _lee_campos(request.data, errores, titulo=es_titulo,
                             obligatorios=False)
        if errores:
            return Response(errores, status=status.HTTP_400_BAD_REQUEST)
        for k, v in campos.items():
            setattr(p, k, v)
        p.save()
        # Si se le cambio la descripcion a un titulo, la ruta copiada en sus
        # hijos se quedo con el texto viejo. Se repasa: el usuario ve el
        # nombre nuevo arriba y el viejo en la escalera del parte, y no hay
        # forma de adivinar cual es el bueno.
        if es_titulo and "descripcion" in campos:
            _repasar_rutas(inc, p)
        return Response(IncidentReportSerializer(inc).data)

    # DELETE
    hijos = [h for h in inc.partidas.all()
             if (h.codigo or "").startswith(p.codigo + ".")]
    if hijos:
        return Response({
            "detail": "No se puede quitar: '%s' tiene %d fila(s) colgando. "
                      "Quitalas primero." % (p.codigo, len(hijos)),
            "hijos": len(hijos),
        }, status=status.HTTP_409_CONFLICT)

    usos = DailyPartActivity.objects.filter(partida_id=p.pk).count()
    if usos:
        return Response({
            "detail": "No se puede quitar: %d parte(s) ya le imputaron "
                      "metrado. Si el metrado estaba mal, corrigelo en la "
                      "partida en vez de borrarla." % usos,
            "partes": usos,
        }, status=status.HTTP_409_CONFLICT)

    inc.partidas.remove(p)
    # Si es suya y nadie la usa, se borra de verdad. Dejarla colgando llenaria
    # el catalogo de partidas huerfanas de incidencias que ya nadie mira.
    if propia:
        p.delete()
    return Response(IncidentReportSerializer(inc).data)


def _repasar_rutas(inc, titulo):
    """Refresca el texto del titulo dentro de la ruta de sus descendientes."""
    for h in inc.partidas.all():
        if not (h.codigo or "").startswith(titulo.codigo + "."):
            continue
        r = h.ruta
        if isinstance(r, str):
            try:
                r = json.loads(r or "[]")
            except ValueError:
                continue
        if not isinstance(r, list):
            continue
        cambio = False
        for tramo in r:
            if isinstance(tramo, list) and len(tramo) == 2 \\
                    and tramo[0] == titulo.codigo:
                tramo[1] = titulo.descripcion
                cambio = True
        if cambio:
            h.ruta = json.dumps(r)
            h.save(update_fields=["ruta"])
'''


IMPORT_VIEJO = "from .models import DailyPartActivity, IncidentReport"
IMPORT_NUEVO = "from .models import DailyPartActivity, IncidentReport, Partida"

IMPORT_RE_VIEJO = "from django.db.models import Sum"
IMPORT_RE_NUEVO = "import json\nimport re\n\nfrom django.db.models import Sum"


def paso_vista(texto):
    """→ (texto_nuevo, aviso)."""
    if "class IncidentReportSerializer" not in texto:
        return None, ("views_incidentes.py no tiene IncidentReportSerializer; "
                      "aplica antes parche_partidas_de_incidencia.py")

    # ── los imports ──
    if IMPORT_VIEJO in texto:
        texto = texto.replace(IMPORT_VIEJO, IMPORT_NUEVO, 1)
    elif "Partida" not in texto.split("class ")[0]:
        return None, ("no encuentro el import de .models tal como lo escribe "
                      "el parche anterior; dime como quedo")
    if not re.search(r"^import json$", texto, re.M):
        if IMPORT_RE_VIEJO not in texto:
            return None, "no encuentro el import de Sum para colocar json/re"
        texto = texto.replace(IMPORT_RE_VIEJO, IMPORT_RE_NUEVO, 1)
    elif not re.search(r"^import re$", texto, re.M):
        texto = texto.replace("import json\n", "import json\nimport re\n", 1)

    # ── el detalle ──
    texto, av = paso_detalle(texto)
    if texto is None:
        return None, av

    # ── el bloque de vistas: se REEMPLAZA si ya hay uno ──
    # Siempre va al final del fichero, asi que cortar desde la marca hasta el
    # final lo quita entero. Si no hay marca pero si estan las funciones, es
    # la version vieja del parche: se corta desde donde empiece.
    corte = texto.find(MARCA)
    if corte < 0:
        # La version vieja del parche no llevaba marca: empezaba por un
        # banner de guiones dobles. Se busca con regex y no con la cadena
        # literal porque contar los guiones a mano es justo la clase de
        # detalle que no cuadra y deja el bloque viejo pegado al nuevo.
        m = re.search(r"^#\s*═+\s*\n#\s*LAS PARTIDAS PROPIAS DE LA INCIDENCIA",
                      texto, re.M)
        if m:
            corte = m.start()
    if corte < 0:
        m = re.search(r"^def _obra_de\(inc\):", texto, re.M)
        if m:
            corte = m.start()
    reemplazo = corte >= 0
    if reemplazo:
        texto = texto[:corte]

    texto = texto.rstrip("\n") + "\n\n\n" + VISTAS
    return texto, ("vistas reemplazadas por la version con arbol" if reemplazo
                   else "anadidas las vistas de titulos y partidas")


# ══════════════════════════════════════════════════════════════════════════
# PIEZA 4 · las rutas
# ══════════════════════════════════════════════════════════════════════════

IMPORT = ("from .views_incidentes import (\n"
          "    incidencia_partida_alta, incidencia_partida_detalle,\n"
          ")\n")

RUTA = ("    # El presupuesto propio de la incidencia: se escribe aqui, no se\n"
        "    # elige de ningun presupuesto -una incidencia no tiene-.\n"
        "    path('incidentes/<int:pk>/partidas/', incidencia_partida_alta,\n"
        "         name='incidencia-partida-alta'),\n"
        "    path('incidentes/<int:pk>/partidas/<int:partida_id>/',\n"
        "         incidencia_partida_detalle, name='incidencia-partida-detalle'),\n")


def paso_urls(texto):
    if "incidencia_partida_alta" in texto:
        return texto, "ya estaban: las rutas de partidas"

    m = re.search(r"^urlpatterns\s*=\s*\[", texto, re.M)
    if not m:
        return None, "no encuentro urlpatterns = [ en urls.py"
    if "views_incidentes" not in texto:
        return None, ("urls.py no conoce views_incidentes; aplica antes "
                      "parche_partidas_de_incidencia.py")

    nuevo = (texto[:m.start()] + IMPORT + "\n"
             + texto[m.start():m.end()] + "\n" + RUTA
             + texto[m.end():])
    return nuevo, "anadidas las dos rutas de partidas"


# ══════════════════════════════════════════════════════════════════════════

def respaldo(ruta):
    sello = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    copia = "%s.bak-%s" % (ruta, sello)
    shutil.copy2(ruta, copia)
    return copia


def principal():
    base = base_del_proyecto()
    if not base:
        print("No encuentro la carpeta del proyecto. Pasala con --base /ruta")
        return 1

    app = os.path.join(base, "operations")
    f_models = os.path.join(app, "models.py")
    f_vista = os.path.join(app, "views_incidentes.py")
    f_urls = os.path.join(app, "urls.py")

    print("proyecto: %s" % base)
    print("modo    : %s" % ("APLICAR" if APLICAR else "solo mostrar"))
    print("")

    if not os.path.isfile(f_vista):
        print("MAL  no existe %s" % f_vista)
        print("     Aplica antes parche_partidas_de_incidencia.py.")
        return 1
    for f in (f_models, f_urls):
        if not os.path.isfile(f):
            print("MAL  no encuentro %s" % f)
            return 1

    txt_m = io.open(f_models, encoding="utf-8").read()
    txt_v = io.open(f_vista, encoding="utf-8").read()
    txt_u = io.open(f_urls, encoding="utf-8").read()

    nuevo_m, av_m = paso_modelo(txt_m)
    nuevo_v, av_v = paso_vista(txt_v)
    nuevo_u, av_u = paso_urls(txt_u)

    print("1. models.py            %s" % av_m)
    print("2. views_incidentes.py  %s" % av_v)
    print("3. urls.py              %s" % av_u)
    print("")

    fallos = []
    for quien, nuevo, av in (("models.py", nuevo_m, av_m),
                             ("views_incidentes.py", nuevo_v, av_v),
                             ("urls.py", nuevo_u, av_u)):
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
    for quien, txt, falta in (
            ("models.py", nuevo_m, "es_titulo"),
            ("views_incidentes.py", nuevo_v, "def incidencia_partida_alta"),
            ("views_incidentes.py", nuevo_v, "def _siguiente_codigo"),
            ("views_incidentes.py", nuevo_v, "\"es_titulo\": titulo"),
            ("urls.py", nuevo_u, "incidencia_partida_alta")):
        if falta not in txt:
            print("NO SE ESCRIBE NADA: en %s no salio %r." % (quien, falta))
            return 1
    if nuevo_v.count("def incidencia_partida_alta") != 1:
        print("NO SE ESCRIBE NADA: incidencia_partida_alta sale %d veces."
              % nuevo_v.count("def incidencia_partida_alta"))
        return 1

    if not APLICAR:
        print("Nada tocado. Para aplicarlo:")
        print("    python3 %s --aplicar" % os.path.basename(__file__))
        return 0

    escritos = []
    for ruta, viejo, nuevo, nombre in (
            (f_models, txt_m, nuevo_m, "models.py"),
            (f_vista, txt_v, nuevo_v, "views_incidentes.py"),
            (f_urls, txt_u, nuevo_u, "urls.py")):
        if nuevo != viejo:
            print("respaldo %s" % respaldo(ruta))
            io.open(ruta, "w", encoding="utf-8").write(nuevo)
            escritos.append(nombre)

    print("")
    print("escrito: %s" % (", ".join(escritos) if escritos else "nada, ya estaba"))
    print("")
    if "models.py" in escritos:
        print("Hay migracion -un campo nuevo, aditivo, default False-:")
        print("    docker compose exec web python manage.py makemigrations operations")
        print("    docker compose exec web python manage.py migrate")
    print("    docker compose up -d --no-deps --force-recreate web")
    return 0


if __name__ == "__main__":
    sys.exit(principal())
