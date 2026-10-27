# -*- coding: utf-8 -*-
"""Las piezas de parche_token_operadores.py.

    python3 pruebas/parche_token.prueba.py

POR QUE SE PRUEBA ESTO. El parche edita un fichero de produccion de un
servidor que sirve el sistema de verdad, y lo hace con sudo. Los dos fallos
que no se pueden permitir son:

  · tocar una clase que no tocaba -en el mismo fichero hay otras vistas con
    la misma linea-, y
  · dejar el fichero sintacticamente roto o usando un nombre que no esta
    importado, que es lo que deja el servidor sin arrancar.

Las dos se comprueban aqui, sobre texto, sin servidor y sin riesgo.
"""
from __future__ import print_function

import ast
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from parche_token_operadores import (          # noqa: E402
    arregla_import, fin_de_imports, fin_de_sentencia, localiza_asignacion,
    nombres_sin_importar, offset_de_linea, reescribe_lista,
)

r = []


def ok(cond, msg, extra=""):
    r.append(bool(cond))
    print("%s %s%s" % ("ok  " if cond else "MAL ", msg,
                       ("   [%s]" % extra) if extra else ""))


# ── Un fichero como el de verdad ────────────────────────────────────────
# Con lo que importa: varias clases, una que NO hay que tocar, una que ya
# tiene token, y una lista escrita en varias lineas.
FUENTE = '''# -*- coding: utf-8 -*-
import json

from django.db.models import Sum
from rest_framework.authentication import SessionAuthentication
from rest_framework.permissions import IsAuthenticated
from rest_framework.views import APIView


class ReporteListView(APIView):
    """Esta NO se toca: es del sistema viejo y nadie ha pedido cambiarla."""
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated]


class OperadoresRegistrosTokenListView(APIView):
    authentication_classes = [TokenAuthentication]
    permission_classes = [IsAuthenticated]


class OperadoresTomasListView(APIView):
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated]


class OperadoresTomasStatusSummaryView(APIView):
    authentication_classes = [
        SessionAuthentication,
    ]
    permission_classes = [IsAuthenticated]


class OperadoresSeriesView(APIView):
    authentication_classes = (SessionAuthentication,)
    permission_classes = [IsAuthenticated]
'''

# ── 1. encontrar la linea, y SOLO la que toca ───────────────────────────

sitio = localiza_asignacion(FUENTE, "OperadoresTomasListView")
ok(sitio is not None, "encuentra la asignacion de la clase pedida")
frag = FUENTE[sitio[0]:sitio[1]]
ok("SessionAuthentication" in frag, "y se trae la linea entera", frag.strip())

# La de al lado NO se toca. Si el parche usara una expresion regular suelta,
# ReporteListView caeria tambien y cambiaria el acceso de pantallas que
# nadie ha pedido tocar.
otro = localiza_asignacion(FUENTE, "ReporteListView")
ok(otro != sitio, "cada clase devuelve su propia linea, no la de la vecina")

ok(localiza_asignacion(FUENTE, "NoExisteEstaClase") is None,
   "una clase que no existe devuelve None en vez de inventarse algo")

# Una lista de varias lineas tiene que venir ENTERA: cortarla por el primer
# salto dejaria un corchete abierto y el fichero roto.
multi = localiza_asignacion(FUENTE, "OperadoresTomasStatusSummaryView")
texto_multi = FUENTE[multi[0]:multi[1]]
ok(texto_multi.count("[") == texto_multi.count("]"),
   "una lista de varias lineas se trae con sus dos corchetes",
   " ".join(texto_multi.split()))

# ── 2. reescribir ───────────────────────────────────────────────────────

nuevo = reescribe_lista("    authentication_classes = [SessionAuthentication]")
ok("TokenAuthentication, SessionAuthentication" in nuevo,
   "Token va DELANTE de Session", nuevo.strip())
# El orden importa de verdad: DRF prueba en orden y se queda con la primera
# que devuelva usuario. Detras, la sesion ganaria a la cabecera.
ok(nuevo.index("TokenAuthentication") < nuevo.index("SessionAuthentication"),
   "y el orden es lo que decide cual manda")
ok("    authentication_classes" in nuevo, "la sangria se respeta")

ok(reescribe_lista("    authentication_classes = [TokenAuthentication]") is None,
   "si ya lo tiene, no hace nada (es idempotente)")
ok(reescribe_lista("    permission_classes = [IsAuthenticated]") is None,
   "y no toca una linea que no es la suya")

tupla = reescribe_lista("    authentication_classes = (SessionAuthentication,)")
ok(tupla is not None and "TokenAuthentication, SessionAuthentication" in tupla,
   "una tupla tambien vale", (tupla or "").strip())

vacia = reescribe_lista("    authentication_classes = []")
ok(vacia is not None and "[TokenAuthentication]" in vacia,
   "una lista vacia no se queda con una coma colgando", (vacia or "").strip())

# ── 3. el import ────────────────────────────────────────────────────────

con, que = arregla_import(FUENTE)
ok("TokenAuthentication" in con, "deja TokenAuthentication importado", que)
ok(con.count("from rest_framework.authentication import") == 1,
   "sin duplicar la linea de import que ya existia")

ya = "from rest_framework.authentication import SessionAuthentication, TokenAuthentication\n"
sin_cambio, que2 = arregla_import(ya + "\nx = 1\n")
ok(sin_cambio == ya + "\nx = 1\n", "si ya estaba, no toca", que2)

suelto = "import json\n\n\nclass A(object):\n    pass\n"
nuevo_imp, que3 = arregla_import(suelto)
ok("TokenAuthentication" in nuevo_imp, "si no hay linea que ampliar, la crea", que3)
ast.parse(nuevo_imp)
ok(nuevo_imp.index("TokenAuthentication") < nuevo_imp.index("class A"),
   "y la pone antes del codigo, no en medio")

# Un import de varias lineas no se puede partir por la mitad.
largo = ("from x import (\n    a,\n    b,\n)\n\nclass A(object):\n    pass\n")
corte = fin_de_imports(largo)
ok(largo[:corte].count("(") == largo[:corte].count(")"),
   "el corte tras los imports no parte un import de varias lineas")

# ── 4. el resultado completo ────────────────────────────────────────────

texto = FUENTE
sitios = []
for clase in ["OperadoresTomasListView", "OperadoresTomasStatusSummaryView",
              "OperadoresSeriesView"]:
    s = localiza_asignacion(texto, clase)
    sitios.append((s, reescribe_lista(texto[s[0]:s[1]])))
for s, n in sorted(sitios, key=lambda x: x[0][0], reverse=True):
    texto = texto[:s[0]] + n + texto[s[1]:]
texto, _ = arregla_import(texto)

try:
    ast.parse(texto)
    compila = True
except SyntaxError as e:
    compila = False
    print("     %s" % e)
ok(compila, "el fichero entero sigue compilando despues de los tres cambios")

ok(nombres_sin_importar(texto, ["TokenAuthentication", "SessionAuthentication"]) == [],
   "y no queda ningun nombre usado sin importar")

# Lo que NO debia cambiar, no cambio.
ok("class ReporteListView" in texto, "ReporteListView sigue ahi")
reporte = texto[texto.index("class ReporteListView"):texto.index("class Operadores")]
ok("TokenAuthentication" not in reporte,
   "y sigue SIN token: no se le toco el acceso")

# Pasarlo dos veces no cambia nada mas.
otra_vez = texto
cambios = 0
for clase in ["OperadoresTomasListView", "OperadoresTomasStatusSummaryView",
              "OperadoresSeriesView"]:
    s = localiza_asignacion(otra_vez, clase)
    if reescribe_lista(otra_vez[s[0]:s[1]]) is not None:
        cambios += 1
ok(cambios == 0, "pasarlo otra vez no encuentra nada que hacer")

# ── 5. que las comprobaciones muerdan ───────────────────────────────────

# Un fichero que usa TokenAuthentication SIN importarlo compila igual: ast
# no ve esa clase de fallo, y es la que deja el servidor sin arrancar.
roto = "class A(object):\n    authentication_classes = [TokenAuthentication]\n"
ast.parse(roto)
ok(nombres_sin_importar(roto, ["TokenAuthentication"]) == ["TokenAuthentication"],
   "sabotaje: sin el import, la comprobacion de nombres lo caza")
ok(nombres_sin_importar(texto, ["TokenAuthentication"]) == [],
   "y no grita cuando el import si esta")

# El corte por corchetes, contra el corte ingenuo por salto de linea.
pedazo = "x = [\n  1,\n]\ny = 2\n"
ingenuo = pedazo.index("\n")
real = fin_de_sentencia(pedazo, 0)
ok(real > ingenuo, "sabotaje: cortar por el primer salto partiria la lista",
   "ingenuo=%d real=%d" % (ingenuo, real))
ok(pedazo[:real].count("[") == pedazo[:real].count("]"),
   "y el corte de verdad deja los corchetes cuadrados")

ok(offset_de_linea("a\nb\nc\n", 3) == 4, "offset_de_linea cuenta desde 1")

malos = len([x for x in r if not x])
print("")
print("%d de %d en orden%s." % (len(r) - malos, len(r),
                                (", %d MAL" % malos) if malos else ""))
sys.exit(1 if malos else 0)
