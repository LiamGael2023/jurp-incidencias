#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
La ficha de levantamiento en campo, en PDF.

    python3 fichas_inspeccion.py --tipo tomas_canal_madre --ambito PECH \\
        --salida /opt/jurp-gis/reportes [--campania 2026] [--fid 12]
    python3 fichas_inspeccion.py --prueba ficha.pdf      # sin base de datos

Dos páginas por estructura, como el formato de papel: la primera con los
datos y los croquis acotados, la segunda con el croquis de detalle y la
evidencia fotográfica.

QUÉ SALE CUANDO NO HAY EVALUACIÓN
----------------------------------
La identificación y la ubicación salen de la capa, que siempre las tiene;
las casillas técnicas salen de la última evaluación, que puede no existir.
Sin evaluación la ficha NO queda inservible: queda prellenada con el
código, la progresiva y las coordenadas, que es exactamente lo que hoy se
copia a mano antes de salir al canal. Es el mismo archivo que luego, con
las evaluaciones cargadas, sale relleno.

POR QUÉ SE DIBUJA A MANO Y NO CON TABLAS
-----------------------------------------
El formato es un plano, no un listado: cajas de ancho fijo, casillas de
marcar, croquis anclados a su recuadro. Con flujo de párrafos se parece
pero no encaja, y lo que se entrega a la ANA se compara contra el papel.

Las medidas van en puntos desde la esquina superior izquierda —`y` crece
hacia abajo, al revés que reportlab— porque así se leen igual que en la
hoja. `_y()` hace la vuelta en el único sitio donde importa.
"""

import argparse
import datetime as dt
import io
import os
import sys

from reportlab.lib.pagesizes import A4
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas as rl_canvas


# ── geometría de la hoja ──────────────────────────────────────────────────

ANCHO, ALTO = A4
MARGEN = 24
UTIL = ANCHO - 2 * MARGEN

NEGRO = (0, 0, 0)
GRIS = (.45, .45, .45)
GRIS_SUAVE = (.82, .82, .82)
FRANJA = (.90, .90, .90)


def _y(y):
    """De 'puntos desde arriba' a las coordenadas de reportlab."""
    return ALTO - y


class Hoja(object):
    """Primitivas de dibujo. Todo en puntos desde la esquina superior."""

    def __init__(self, c):
        self.c = c

    # ── trazos ──
    def caja(self, x, y, w, h, grosor=0.6, relleno=None):
        if relleno:
            self.c.setFillColorRGB(*relleno)
            self.c.rect(x, _y(y + h), w, h, stroke=0, fill=1)
        self.c.setStrokeColorRGB(*NEGRO)
        self.c.setLineWidth(grosor)
        self.c.rect(x, _y(y + h), w, h, stroke=1, fill=0)

    def linea(self, x1, y1, x2, y2, grosor=0.5, color=NEGRO):
        self.c.setStrokeColorRGB(*color)
        self.c.setLineWidth(grosor)
        self.c.line(x1, _y(y1), x2, _y(y2))

    # ── texto ──
    def txt(self, x, y, texto, tam=7, negrita=False, color=NEGRO, centro=False,
            derecha=False):
        if texto is None:
            texto = ''
        self.c.setFillColorRGB(*color)
        self.c.setFont('Helvetica-Bold' if negrita else 'Helvetica', tam)
        if centro:
            self.c.drawCentredString(x, _y(y), str(texto))
        elif derecha:
            self.c.drawRightString(x, _y(y), str(texto))
        else:
            self.c.drawString(x, _y(y), str(texto))

    def parrafo(self, x, y, w, texto, tam=6.5, interlinea=8, maximo=None):
        """Texto que se corta por ancho. Devuelve cuántas líneas ocupó."""
        if not texto:
            return 0
        self.c.setFont('Helvetica', tam)
        palabras = str(texto).split()
        lineas, actual = [], ''
        for p in palabras:
            prueba = (actual + ' ' + p).strip()
            if self.c.stringWidth(prueba, 'Helvetica', tam) <= w:
                actual = prueba
            else:
                if actual:
                    lineas.append(actual)
                actual = p
        if actual:
            lineas.append(actual)
        if maximo:
            lineas = lineas[:maximo]
        for i, l in enumerate(lineas):
            self.txt(x, y + i * interlinea, l, tam)
        return len(lineas)

    # ── campos ──
    def rotulo_valor(self, x, y, rotulo, valor, w_rotulo=None, w_linea=90,
                     tam=7):
        """Rótulo y, al lado, el valor subrayado. Como en el papel.

        La raya va aunque el valor esté vacío: es donde se escribe a mano
        cuando la ficha se imprime en blanco, que es el caso de hoy.
        """
        self.txt(x, y, rotulo, tam)
        ancho_r = w_rotulo if w_rotulo is not None else (
            self.c.stringWidth(rotulo, 'Helvetica', tam) + 4)
        x0 = x + ancho_r
        self.linea(x0, y + 1.5, x0 + w_linea, y + 1.5, 0.5, GRIS)
        if valor not in (None, ''):
            self.txt(x0 + w_linea / 2.0, y, valor, tam, negrita=True,
                     centro=True)

    def casilla(self, x, y, marcada=False, lado=7):
        """Casilla de marcar. La X va dibujada, no como carácter.

        `y` es el borde SUPERIOR, como en todo lo demás de esta hoja. El
        rect de reportlab crece hacia arriba desde su esquina, así que hay
        que darle y+lado: con _y(y) a secas la casilla se dibuja un cuadro
        por encima de donde toca y queda flotando sobre su etiqueta.
        """
        self.c.setStrokeColorRGB(*NEGRO)
        self.c.setLineWidth(0.6)
        self.c.rect(x, _y(y + lado), lado, lado, stroke=1, fill=0)
        if marcada:
            self.c.setLineWidth(0.9)
            self.c.line(x + 1, _y(y + 1), x + lado - 1, _y(y + lado - 1))
            self.c.line(x + 1, _y(y + lado - 1), x + lado - 1, _y(y + 1))

    def opcion(self, x, y, etiqueta, marcada=False, tam=6.5):
        """Etiqueta seguida de su casilla. Devuelve el x donde termina."""
        self.txt(x, y + 5.5, etiqueta, tam)
        ancho = self.c.stringWidth(etiqueta, 'Helvetica', tam) + 3
        self.casilla(x + ancho, y, marcada)
        return x + ancho + 10

    def si_no(self, x, y, valor):
        """El par SI/NO del formato: dos casillas, una marcada."""
        si = _es_si(valor)
        no = _es_no(valor)
        self.txt(x, y + 5.5, 'SI', 6)
        self.casilla(x + 11, y, si)
        self.txt(x + 23, y + 5.5, 'NO', 6)
        self.casilla(x + 35, y, no)

    def brm(self, x, y, estado):
        """Las tres casillas B / R / M del estado de conservación."""
        letra = (str(estado or '')[:1] or '').upper()
        for i, l in enumerate('BRM'):
            self.txt(x + i * 16, y + 5.5, l, 6)
            self.casilla(x + 7 + i * 16, y, l == letra, 6.5)

    def seccion(self, y, titulo, alto=10):
        """La franja gris con el número y el nombre de la sección."""
        self.caja(MARGEN, y, UTIL, alto, 0.6, FRANJA)
        self.txt(MARGEN + 3, y + alto - 2.8, titulo, 6.5, negrita=True)
        return y + alto

    def imagen(self, ruta, x, y, w, h):
        """Un croquis dentro de su recuadro, sin deformarlo."""
        if not ruta or not os.path.exists(ruta):
            return False
        try:
            lector = ImageReader(ruta)
            iw, ih = lector.getSize()
            escala = min(w / float(iw), h / float(ih))
            dw, dh = iw * escala, ih * escala
            self.c.drawImage(lector, x + (w - dw) / 2.0,
                             _y(y + h) + (h - dh) / 2.0, dw, dh,
                             preserveAspectRatio=True, mask='auto')
            return True
        except Exception:
            # Una imagen rota no puede tumbar las veintidós fichas.
            return False


# ── lectura de valores ────────────────────────────────────────────────────

SI = ('si', 'sí', 's', 'true', 't', '1', 'x', 'yes')
NO = ('no', 'n', 'false', 'f', '0')


def _es_si(v):
    if v is True:
        return True
    return str(v).strip().lower() in SI if v not in (None, '') else False


def _es_no(v):
    if v is False:
        return True
    return str(v).strip().lower() in NO if v not in (None, '') else False


def val(d, clave, por_defecto=''):
    v = (d or {}).get(clave)
    return por_defecto if v in (None, '') else v


def num(d, clave, dec=2):
    v = (d or {}).get(clave)
    if v in (None, ''):
        return ''
    try:
        return f'{float(v):,.{dec}f}'
    except (TypeError, ValueError):
        return str(v)


def progresiva(v):
    """12345 → 12+345. Lo que la ficha llama progresiva."""
    if v in (None, ''):
        return ''
    try:
        n = int(float(v))
        return f'{n // 1000}+{n % 1000:03d}'
    except (TypeError, ValueError):
        return str(v)


# ── la hoja 1 ─────────────────────────────────────────────────────────────

def cabecera(h, pagina, total, anio, logos):
    y = MARGEN
    alto = 22
    h.caja(MARGEN, y, UTIL, alto)
    h.txt(MARGEN + 4, y + 13,
          f'FORMATO DE LEVANTAMIENTO DE INFORMACIÓN EN CAMPO  -  INVENTARIO {anio}',
          7, negrita=True)
    # La hoja, a la derecha, en su propio recuadro.
    h.linea(ANCHO - MARGEN - 42, y, ANCHO - MARGEN - 42, y + alto)
    h.txt(ANCHO - MARGEN - 21, y + 9, 'HOJA', 6, negrita=True, centro=True)
    h.txt(ANCHO - MARGEN - 21, y + 17, f'{pagina:02d}/{total:02d}', 6,
          centro=True)
    if logos.get('jurp'):
        h.imagen(logos['jurp'], ANCHO - MARGEN - 140, y + 2, 94, alto - 4)
    return y + alto


def hoja1(h, f, anio, esquemas, logos):
    v = f.get('valores') or {}
    y = cabecera(h, 1, 2, anio, logos)

    # ── 1. información general ──
    y = h.seccion(y, '1. INFORMACION GENERAL')
    alto = 34
    h.caja(MARGEN, y, UTIL, alto)
    h.rotulo_valor(MARGEN + 6, y + 12, 'Estructura', f.get('estructura') or 'TOMA LATERAL',
                   w_rotulo=56, w_linea=120)
    h.rotulo_valor(MARGEN + 200, y + 12, 'Denominación', f.get('nombre'),
                   w_rotulo=62, w_linea=130)
    # La fecha, en tres casillas, como en el papel.
    hoy = f.get('fecha') or ''
    h.txt(ANCHO - MARGEN - 120, y + 12, 'Fecha :', 7)
    for i, parte in enumerate((hoy[:2], hoy[3:5], hoy[6:10])):
        ancho = 24 if i < 2 else 34
        x = ANCHO - MARGEN - 88 + i * 26 + (0 if i < 2 else 0)
        h.caja(x, y + 4, ancho, 12, 0.5)
        h.txt(x + ancho / 2.0, y + 13, parte, 7, centro=True)
    h.rotulo_valor(MARGEN + 6, y + 27, 'Código', f.get('cod_est'),
                   w_rotulo=56, w_linea=120)
    y += alto

    # ── 2. codificación y localización ──
    y = h.seccion(y, '2. INFORMACION DE CODIFICACION Y LOCALIZACION')
    alto = 74
    h.caja(MARGEN, y, UTIL, alto)
    canal = (f.get('canal') or '').lower()
    h.txt(MARGEN + 6, y + 12, 'Nombre del Canal   :', 7)
    h.txt(MARGEN + 96, y + 12, 'Canal Lateral 10', 7)
    h.casilla(MARGEN + 166, y + 6, 'lateral' in canal)
    h.txt(MARGEN + 212, y + 12, 'Canal Madre PECH', 7)
    h.casilla(MARGEN + 288, y + 6, 'madre' in canal or 'pech' in canal)
    h.txt(MARGEN + 330, y + 12, 'Otro', 7)
    h.linea(MARGEN + 350, y + 13, ANCHO - MARGEN - 46, y + 13, 0.5, GRIS)
    h.casilla(ANCHO - MARGEN - 40, y + 6, bool(canal) and 'lateral' not in canal
              and 'madre' not in canal and 'pech' not in canal)

    for i, x in enumerate((MARGEN + 96, MARGEN + 212, MARGEN + 330)):
        texto = progresiva(f.get('progresiva')) if i == (
            0 if 'lateral' in canal else 1) else ''
        h.rotulo_valor(x - 36, y + 28, 'Progresiva :', texto, w_rotulo=48,
                       w_linea=70)

    h.txt(MARGEN + 6, y + 50, 'Ubicación Geográfica :', 7)
    h.txt(MARGEN + 96, y + 44, 'UTM  Datum WGS 84', 7)
    h.rotulo_valor(MARGEN + 212, y + 44, 'Este       :', f.get('este'),
                   w_rotulo=50, w_linea=90)
    h.rotulo_valor(MARGEN + 212, y + 58, 'Norte     :', f.get('norte'),
                   w_rotulo=50, w_linea=90)
    h.rotulo_valor(MARGEN + 96, y + 62, 'Zona :', f.get('zona') or '17S',
                   w_rotulo=32, w_linea=50)
    h.rotulo_valor(MARGEN + 212, y + 70, 'Elevación :', f.get('elevacion'),
                   w_rotulo=50, w_linea=90)
    h.txt(ANCHO - MARGEN - 200, y + 44, 'Observaciones :', 7)
    h.parrafo(ANCHO - MARGEN - 200, y + 56, 192, val(v, 'obs_ubic'), 6.5, 9, 2)
    y += alto

    # ── 3. características técnicas ──
    y = h.seccion(y, '3. CARACTERISTICAS TECNICAS')
    alto = 160
    h.caja(MARGEN, y, UTIL, alto)
    c1, c2, c3 = MARGEN + 6, MARGEN + 150, MARGEN + 268
    x_croquis = MARGEN + 372

    h.rotulo_valor(c1, y + 12, 'Año de Construcción :', val(v, 'anio_const'),
                   w_rotulo=94, w_linea=46)
    tipo = val(v, 'tipo')
    h.txt(c1, y + 30, 'Tipo', 6.5, negrita=True)
    for i, (etiqueta, llave) in enumerate((
            ('Permanente', 'perman'), ('Semi - Rustico', 'semi'),
            ('Rustico', 'rustic'), ('Otro', 'otro'))):
        h.txt(c1 + 22, y + 42 + i * 13, etiqueta, 6.5)
        h.casilla(c1 + 100, y + 36 + i * 13, llave in tipo)

    h.txt(c2, y + 12, 'Material', 6.5, negrita=True)
    h.txt(c2 + 70, y + 12, 'Estado', 6.5, negrita=True)
    material = str(val(v, 'material')).lower()
    for i, (etiqueta, llave) in enumerate((
            ('Concreto', 'concret'), ('Mampostería', 'mampost'),
            ('Madera', 'madera'), ('No Precisa', 'no precisa'),
            ('Otros', 'otro'))):
        h.txt(c2, y + 30 + i * 14, etiqueta, 6.5)
        marcado = llave in material
        h.casilla(c2 + 52, y + 24 + i * 14, marcado)
        if marcado:
            h.brm(c2 + 68, y + 24 + i * 14, val(v, 'mat_estado'))
    h.txt(c2, y + 104, 'Nota : B (Bueno), R (Regular) , M (Malo)', 5.5,
          color=GRIS)

    h.txt(c3, y + 12, 'Información Técnica', 6.5, negrita=True)
    for i, (etiqueta, texto, unidad) in enumerate((
            ('Diseño', num(v, 'q_diseno'), 'm3/s'),
            ('Operación', num(v, 'q_opera'), 'm3/s'),
            ('Áreas', num(v, 'area_total'), 'Ha'),
            ('Usuarios', val(v, 'n__usuario'), ''),
            ('Area Bajo Riego', num(v, 'area_riego'), 'Ha'))):
        h.rotulo_valor(c3, y + 30 + i * 15, etiqueta, texto, w_rotulo=62,
                       w_linea=44)
        if unidad:
            h.txt(c3 + 110, y + 30 + i * 15, unidad, 5.5, color=GRIS)

    h.imagen(esquemas.get('toma'), x_croquis, y + 6, UTIL - (x_croquis - MARGEN) - 6,
             alto - 12)
    y += alto

    # ── la banda de componentes ──
    alto = 150
    h.caja(MARGEN, y, UTIL, alto)
    anchos = [136, 150, 130, UTIL - 136 - 150 - 130]
    xs, acum = [], MARGEN
    for a in anchos:
        xs.append(acum)
        acum += a
    for x in xs[1:]:
        h.linea(x, y, x, y + alto)

    # Toma lateral: dimensiones
    x = xs[0] + 5
    h.txt(x, y + 11, 'Toma Lateral', 6.5, negrita=True)
    h.brm(x + 62, y + 5, val(v, 'tom_estado'))
    h.txt(x, y + 24, 'Dimensiones', 6, color=GRIS)
    h.txt(x + 62, y + 24, '/   Estado', 6, color=GRIS)
    for i, (etiqueta, texto) in enumerate((
            ('Ancho(b):', num(v, 'tom_ancho')),
            ('Longitud (L2):', num(v, 'tom_long2')),
            ('Longitud (L3):', num(v, 'tom_long3')),
            ('Altura (h):', num(v, 'tom_altura')),
            ('Espesor Muro (e):', num(v, 'tom_espes')),
            ('Espesor Losa (e1):', num(v, 'tom_esplos')),
            ('Talud    (Z):', num(v, 'tom_talud')))):
        h.rotulo_valor(x, y + 40 + i * 15, etiqueta, texto, w_rotulo=76,
                       w_linea=40, tam=6.5)
        h.txt(x + 120, y + 40 + i * 15, 'm', 5.5, color=GRIS)

    # Compuerta metálica
    x = xs[1] + 5
    h.txt(x, y + 11, 'Compuerta Metálica :', 6.5, negrita=True)
    h.imagen(esquemas.get('toma-compuerta'), x + 74, y + 16, 68, 56)
    for i, (etiqueta, texto, unidad) in enumerate((
            ('a =', num(v, 'com_ancho'), 'm'),
            ('b =', num(v, 'com_alto'), 'm'),
            ('H =', num(v, 'com_htotal'), 'm'),
            ('e_PL =', num(v, 'com_eplan'), 'mm'),
            ('V_vástago =', val(v, 'com_vast'), ''))):
        h.rotulo_valor(x, y + 26 + i * 14, etiqueta, texto, w_rotulo=48,
                       w_linea=24, tam=6.5)
        if unidad:
            h.txt(x + 76, y + 26 + i * 14, unidad, 5.5, color=GRIS)
    h.txt(x, y + 100, 'Cuenta con sello ?', 6.5)
    h.si_no(x + 72, y + 94, val(v, 'com_sello'))
    h.rotulo_valor(x, y + 118, 'Tipo :', val(v, 'com_tsello'), w_rotulo=26,
                   w_linea=58, tam=6.5)
    h.rotulo_valor(x, y + 134, 'e =', num(v, 'com_esello'), w_rotulo=20,
                   w_linea=40, tam=6.5)
    h.txt(x + 64, y + 134, 'mm', 5.5, color=GRIS)

    # Retención
    x = xs[2] + 5
    h.txt(x, y + 11, 'Cuenta con retención ?', 6.5)
    h.si_no(x, y + 18, val(v, 'ret_hay'))
    h.imagen(esquemas.get('toma-retencion'), x + 52, y + 16, 72, 46)
    h.rotulo_valor(x, y + 74, 'h =', num(v, 'ret_altura'), w_rotulo=20,
                   w_linea=36, tam=6.5)
    h.txt(x + 60, y + 74, 'm', 5.5, color=GRIS)
    h.txt(x, y + 90, 'Estado :', 6.5)
    h.brm(x + 38, y + 84, val(v, 'estado2'))
    h.txt(x, y + 106, 'Cuenta con compuerta', 6.5)
    h.txt(x, y + 114, 'de purga?', 6.5)
    h.si_no(x + 72, y + 102, val(v, 'ret_purga'))
    h.rotulo_valor(x, y + 130, 'Dimensiones :', val(v, 'ret_dimpur'),
                   w_rotulo=56, w_linea=62, tam=6.5)
    h.txt(x, y + 144, 'Baranda metálica :', 6.5)
    h.si_no(x + 74, y + 138, val(v, 'bar_hay'))

    # Estructura de salida. La columna mide ciento treinta puntos: aqui
    # todo va en dos niveles -etiqueta y, debajo, sus casillas- porque
    # poniendolo en linea el ultimo recuadro se sale de la hoja.
    x = xs[3] + 5
    h.txt(x, y + 11, 'Estructura de salida :', 6.5, negrita=True)
    salida = str(val(v, 'sld_tipo')).lower()
    h.txt(x, y + 26, 'Canal', 6.5)
    h.casilla(x + 42, y + 20, 'canal' in salida)
    h.txt(x, y + 40, 'Tubería', 6.5)
    h.casilla(x + 42, y + 34, 'tub' in salida)
    h.rotulo_valor(x + 58, y + 40, 'ø =', num(v, 'sld_diam', 0), w_rotulo=16,
                   w_linea=30, tam=6.5)
    h.txt(x + 106, y + 40, 'mm', 5.5, color=GRIS)

    mat = str(val(v, 'sld_mat')).lower()
    h.txt(x, y + 56, 'Material :', 6.5)
    h.txt(x + 42, y + 56, 'PVC', 6.5)
    h.casilla(x + 60, y + 50, 'pvc' in mat)
    h.txt(x + 74, y + 56, 'Concreto', 6.5)
    h.casilla(x + 110, y + 50, 'concret' in mat)
    h.txt(x + 42, y + 70, 'Fierro', 6.5)
    h.casilla(x + 70, y + 64, 'fierro' in mat)
    h.txt(x + 86, y + 70, 'Otro', 6.5)
    h.casilla(x + 106, y + 64, bool(mat) and not any(
        k in mat for k in ('pvc', 'concret', 'fierro')))

    h.txt(x, y + 90, 'Estructura de Medición :', 6.5)
    h.si_no(x + 2, y + 96, val(v, 'sld_medic'))
    medic = str(val(v, 'sld_tmedic')).lower()
    h.txt(x, y + 122, 'Volumétrico', 6.5)
    h.casilla(x + 50, y + 116, 'volum' in medic)
    h.txt(x + 66, y + 122, 'Vertedero', 6.5)
    h.casilla(x + 108, y + 116, 'verted' in medic)
    h.txt(x, y + 140, 'Orificio', 6.5)
    h.casilla(x + 38, y + 134, 'orific' in medic)
    h.txt(x + 60, y + 140, 'Otro', 6.5)
    h.casilla(x + 84, y + 134, bool(medic) and not any(
        k in medic for k in ('volum', 'verted', 'orific')))
    y += alto

    # ── 4. inspección visual ──
    y = h.seccion(y, '4. INSPECCION VISUAL')
    alto = ALTO - MARGEN - 34 - y
    h.caja(MARGEN, y, UTIL, alto)
    mitad = MARGEN + UTIL / 2.0
    preguntas = [
        ('Se evidencia problemas en el concreto armado : Fisuras, corrosión de '
         'las armaduras, desgaste , etc.', 'insp_concreto', 'insp_concreto_c', 0),
        ('La estructura fue rebasada en época de  crecidas (ocurrencia de '
         'Fenómenos Extraordinarios) ?', 'insp_rebasada', 'insp_rebasada_c', 1),
        ('La estructuras metálicas se encuentra se encuentran operativas?',
         'insp_metal_op', 'insp_metal_op_c', 0),
        ('La estructura cuenta con elementos de seguridad para su operación así '
         'como la señalética correspondiente  ?', 'insp_segurid', 'insp_segurid_c', 1),
    ]
    for i, (texto, campo, detalle, col) in enumerate(preguntas):
        fila = i // 2
        x = (MARGEN + 6) if col == 0 else (mitad + 6)
        yy = y + 12 + fila * 50
        h.parrafo(x, yy, UTIL / 2.0 - 70, texto, 6.5, 8, 3)
        h.si_no(x + UTIL / 2.0 - 58, yy - 6, val(v, campo))
        h.linea(x, yy + 30, x + UTIL / 2.0 - 20, yy + 30, 0.4, GRIS_SUAVE)
        h.txt(x, yy + 28, val(v, detalle), 6.5)

    h.txt(MARGEN + 6, y + 118, 'Nota Adicional :', 6.5)
    h.parrafo(MARGEN + 6, y + 132, UTIL - 20, val(v, 'nota_adic'), 6.5, 11, 4)
    for k in range(4):
        h.linea(MARGEN + 6, y + 136 + k * 11, ANCHO - MARGEN - 6,
                y + 136 + k * 11, 0.4, GRIS_SUAVE)

    # ── 5. responsables ──
    y = ALTO - MARGEN - 34
    y = h.seccion(y, '5. RESPONSABLES DEL REGISTRO')
    h.caja(MARGEN, y, UTIL, 24)
    h.rotulo_valor(MARGEN + 10, y + 15, 'Nombre :', f.get('evaluador'),
                   w_rotulo=44, w_linea=170)
    h.rotulo_valor(MARGEN + 250, y + 15, 'Cargo :', f.get('cargo'),
                   w_rotulo=36, w_linea=180)


# ── la hoja 2 ─────────────────────────────────────────────────────────────

def _general_y_localizacion(h, f, anio, logos):
    """Las secciones 1 y 2, que son iguales en todas las hojas oficiales.

    Se repiten aqui en vez de llamarse a las de `hoja1` porque aquella las
    tiene embebidas y sacarlas obligaria a tocar la unica hoja que lleva
    meses funcionando. El dia que haya que cambiar algo de estas dos, se
    cambia aqui y en hoja1; son veinte lineas y no vale la pena el riesgo.

    Devuelve la `y` donde sigue la seccion 3.
    """
    v = f.get('valores') or {}
    y = cabecera(h, 1, 2, anio, logos)

    # ── 1 ──
    y = h.seccion(y, '1. INFORMACION GENERAL')
    alto = 42
    h.caja(MARGEN, y, UTIL, alto)
    h.rotulo_valor(MARGEN + 6, y + 15, 'Estructura', f.get('estructura'),
                   w_rotulo=56, w_linea=140)
    h.rotulo_valor(MARGEN + 220, y + 15, 'Denominación', f.get('nombre'),
                   w_rotulo=64, w_linea=140)
    hoy = f.get('fecha') or ''
    h.txt(ANCHO - MARGEN - 118, y + 15, 'Fecha :', 7)
    for i, parte in enumerate((hoy[:2], hoy[3:5], hoy[6:10])):
        ancho = 24 if i < 2 else 34
        h.caja(ANCHO - MARGEN - 86 + i * 26, y + 7, ancho, 13, 0.5)
        h.txt(ANCHO - MARGEN - 86 + i * 26 + ancho / 2.0, y + 16, parte, 7,
              centro=True)
    h.rotulo_valor(MARGEN + 6, y + 33, 'Código', f.get('cod_est'),
                   w_rotulo=56, w_linea=140)
    y += alto

    # ── 2 ──
    y = h.seccion(y, '2. INFORMACION DE CODIFICACION Y LOCALIZACION')
    alto = 88
    h.caja(MARGEN, y, UTIL, alto)
    canal = (f.get('canal') or '').lower()
    h.txt(MARGEN + 6, y + 12, 'Nombre del Canal   :', 7)
    h.txt(MARGEN + 96, y + 12, 'Canal Lateral 10', 7)
    h.casilla(MARGEN + 166, y + 6, 'lateral' in canal)
    h.txt(MARGEN + 212, y + 12, 'Canal Madre PECH', 7)
    h.casilla(MARGEN + 288, y + 6, 'madre' in canal or 'pech' in canal)
    h.txt(MARGEN + 330, y + 12, 'Otro', 7)
    h.linea(MARGEN + 350, y + 13, ANCHO - MARGEN - 46, y + 13, 0.5, GRIS)
    otro = bool(canal) and 'lateral' not in canal and 'madre' not in canal \
        and 'pech' not in canal
    if otro:
        h.txt(MARGEN + 354, y + 12, f.get('canal'), 7, negrita=True)
    h.casilla(ANCHO - MARGEN - 40, y + 6, otro)

    # La progresiva se queda en la mitad izquierda y el bloque UTM empieza
    # en 236: con la raya de la progresiva llegando a 252 se cruzaban, y
    # «Este» aparecia escrito encima de la progresiva.
    h.rotulo_valor(MARGEN + 96, y + 30, 'Progresiva :',
                   progresiva(f.get('progresiva')), w_rotulo=54, w_linea=80)
    h.txt(MARGEN + 6, y + 60, 'Ubicación Geográfica :', 7)
    h.txt(MARGEN + 116, y + 52, 'UTM  Datum WGS 84', 7)
    for i, (rotulo, valor) in enumerate((
            ('Este', f.get('este')), ('Norte', f.get('norte')),
            ('Zona', f.get('zona') or '17S'),
            ('Elevación', f.get('elevacion')))):
        h.rotulo_valor(MARGEN + 236, y + 30 + i * 14, rotulo + ' :', valor,
                       w_rotulo=48, w_linea=100)
    h.txt(MARGEN + 400, y + 30, 'Observaciones :', 7)
    h.parrafo(MARGEN + 400, y + 44, UTIL - 412, val(v, 'obs_ubic'), 6.5, 9,
              maximo=4)
    return y + alto


def _seccion_inspeccion(h, y, v, preguntas, alto=None):
    """La sección 4: cuatro preguntas de SI/NO con su renglón de detalle.

    Las preguntas cambian con la estructura —a una canoa se le pregunta por
    la colmatación del cauce y a un sifón por la corrosión de la tubería—
    pero la rejilla es la misma en todas las hojas: dos columnas, dos filas,
    y debajo la nota adicional.
    """
    y = h.seccion(y, '4. INSPECCION VISUAL')
    alto = alto or 150
    h.caja(MARGEN, y, UTIL, alto)
    ancho_col = (UTIL - 24) / 2.0
    for i, (texto, campo, campo_c) in enumerate(preguntas[:4]):
        cx = MARGEN + 10 + (i % 2) * (ancho_col + 8)
        cy = y + 8 + (i // 2) * 52
        h.parrafo(cx, cy + 6, ancho_col - 50, texto, 6, 7.5, maximo=3)
        h.si_no(cx + ancho_col - 46, cy, val(v, campo))
        h.linea(cx, cy + 36, cx + ancho_col - 10, cy + 36, 0.5, GRIS)
        h.parrafo(cx + 2, cy + 34, ancho_col - 14, val(v, campo_c), 6.5, 8,
                  maximo=1)

    h.txt(MARGEN + 10, y + 118, 'Nota Adicional :', 6.5)
    renglon = y + 130
    while renglon < y + alto - 4:
        h.linea(MARGEN + 10, renglon, ANCHO - MARGEN - 10, renglon, 0.4,
                GRIS_SUAVE)
        renglon += 13
    h.parrafo(MARGEN + 12, y + 128, UTIL - 26, val(v, 'nota_adic'), 6.5, 13,
              maximo=3)
    return y + alto


def _normalizar(texto):
    """Sin tildes, en minúsculas y con los espacios colapsados."""
    import unicodedata
    t = unicodedata.normalize('NFD', str(texto or ''))
    t = ''.join(c for c in t if unicodedata.category(c) != 'Mn')
    return ' '.join(t.lower().replace('-', ' ').split())


def _coincide(etiqueta, valor):
    """Si esa casilla del formato es la que corresponde al valor guardado.

    Comparar por el principio de la palabra —que es lo que se hacía— marca
    «Rústico» cuando el valor es «Semi - Rústico», porque «rust» aparece en
    los dos, y la ficha sale con dos tipos marcados. Aquí tienen que ser el
    mismo texto o uno empezar por el otro, y así «Semi - Rustico» solo
    marca su propia casilla. Las tildes se ignoran: la base guarda
    «Mamposteria» y el formato dice «Mampostería».
    """
    e, v = _normalizar(etiqueta), _normalizar(valor)
    if not e or not v:
        return False
    return e == v or v.startswith(e) or e.startswith(v)


def _alto_bloque(bloque):
    """Lo que ocupa un bloque de dimensiones, para cuadrar la sección."""
    opciones = bloque.get('opciones')
    alto_op = (len(opciones[2]) * 13 + 8) if opciones else 0
    return 20 + alto_op + len(bloque.get('campos') or []) * 12 + 8


def _bloque(h, v, bloque, x, y, ancho):
    """Una parte de la estructura: su estado, sus materiales y sus cotas.

    Las tres formas que traen los formatos oficiales caben aquí:

      · solo cotas —el cuerpo de una canoa—;
      · una matriz de materiales con su B/R/M encima de las cotas, que es
        como la alcantarilla y el sifón declaran el revestimiento de cada
        transición;
      · solo la matriz, sin cotas, como la columna de accesorios del sifón.

    La alternativa era un dibujo por formato, y entonces el ancho de las
    rayas y la altura de los renglones dejaban de coincidir entre hojas que
    se archivan juntas.
    """
    titulo = bloque.get('titulo', '')
    hueco = ancho - 70 if bloque.get('estado') else ancho - 12
    # «Estructura de regulación» no entra a 6.5 puntos en una columna de
    # ciento treinta y seis, y se montaba sobre su propio B/R/M.
    tam = 6.5 if h.c.stringWidth(titulo, 'Helvetica-Bold', 6.5) <= hueco \
        else 5.6
    h.txt(x + 6, y + 10, titulo, tam, negrita=True)
    if bloque.get('estado'):
        h.brm(x + ancho - 58, y + 3, val(v, bloque['estado']))
    yy = y + 20

    opciones = bloque.get('opciones')
    if opciones:
        campo, campo_estado, etiquetas = opciones
        elegido = val(v, campo)
        for etiqueta in etiquetas:
            marcada = _coincide(etiqueta, elegido)
            h.txt(x + 6, yy + 6, etiqueta, 6)
            h.casilla(x + 62, yy, marcada)
            if marcada and campo_estado:
                h.brm(x + 80, yy, val(v, campo_estado))
            yy += 13
        # Aire entre la matriz y las cotas: las etiquetas de las opciones se
        # escriben 6 puntos por debajo de su casilla, asi que sin esto la
        # primera cota sale pegada a «Otro» y parecen el mismo renglon.
        yy += 8

    for etiqueta, campo, unidad in (bloque.get('campos') or []):
        h.txt(x + 6, yy, etiqueta, 6)
        x0, x1 = x + 76, x + ancho - 22
        h.linea(x0, yy + 1.5, x1, yy + 1.5, 0.5, GRIS)
        h.txt((x0 + x1) / 2.0, yy, num(v, campo), 6.5, negrita=True,
              centro=True)
        if unidad:
            h.txt(x + ancho - 18, yy, unidad, 5.5, color=GRIS)
        yy += 12


def hoja1_formato(h, f, anio, esquemas, logos, spec):
    """La hoja 1 de una estructura con formato oficial propio.

    UNA HOJA Y NUEVE DESCRIPCIONES, NO NUEVE HOJAS
    ----------------------------------------------
    Los formatos de canoa, sifón, alcantarilla, aliviadero, desarenador,
    entrega y puente comparten el esqueleto: identificación, localización,
    una banda con año/tipo/material y el esquema acotado, los bloques de
    dimensiones de sus partes, cuatro preguntas de inspección y los
    responsables. Lo que cambia son los bloques y las preguntas.

    Dibujar nueve funciones habría significado copiar ese esqueleto nueve
    veces y arreglar cada error nueve veces. Aquí el esqueleto se dibuja una
    vez y cada estructura es una entrada en `FORMATOS` con sus bloques y sus
    preguntas: añadir la décima son veinte líneas.
    """
    v = f.get('valores') or {}
    y = _general_y_localizacion(h, f, anio, logos)

    # ── 3. características técnicas ──
    y = h.seccion(y, '3. CARACTERISTICAS TECNICAS')
    # Un formato puede traer sus bloques en una tira o en varias: el
    # aliviadero reparte sus seis partes en dos, y el desarenador sus siete
    # en dos tambien, porque en una sola fila las columnas quedarian de
    # setenta puntos y no entra «Numero de Naves».
    filas = spec.get('filas') or ([spec['bloques']] if spec.get('bloques')
                                  else [])
    bloques = filas[0] if len(filas) == 1 else []
    # Un bloque solo —la entrega, el puente— va DENTRO de la banda, junto al
    # material y antes del esquema, que es como está el papel. Tirado a lo
    # ancho de la hoja como una franja propia se vería una tabla de una sola
    # columna con cuatro centímetros de aire a cada lado.
    en_banda = len(bloques) == 1
    sin_material = spec.get('sin_material')
    alto_banda = 150 if en_banda else 128
    altos_fila = [max(_alto_bloque(b) for b in fila) for fila in filas] \
        if filas else [30]
    alto_bloques = 0 if en_banda else sum(altos_fila)
    alto = alto_banda + alto_bloques
    h.caja(MARGEN, y, UTIL, alto)

    # banda: año y tipo | material y estado | [dimensiones] | esquema
    if en_banda:
        x2, x3 = MARGEN + 140, MARGEN + 280
        h.linea(x3, y, x3, y + alto_banda, 0.5)
        _bloque(h, v, bloques[0], x3, y, 140)
        x_esquema = MARGEN + 420
        h.linea(x_esquema, y, x_esquema, y + alto_banda, 0.5)
    elif sin_material:
        # El desarenador no declara material en su hoja: el año y el tipo a
        # la izquierda y la foto ocupando el resto.
        x2 = x3 = x_esquema = MARGEN + 180
    else:
        x2, x3 = MARGEN + 160, MARGEN + 330
        x_esquema = x3
        h.linea(x3, y, x3, y + alto_banda, 0.5)
    h.linea(x2, y, x2, y + alto_banda, 0.5)

    h.txt(MARGEN + 8, y + 14, 'Año de Construcción :', 6.5)
    h.caja(MARGEN + 8, y + 18, 120, 14, 0.5)
    h.txt(MARGEN + 68, y + 28, val(v, 'anio_const'), 7, negrita=True,
          centro=True)
    tipo = val(v, 'tipo')
    # El rótulo va encima de la lista y no a su izquierda: puesto al lado
    # cae justo sobre la tercera opción, porque las cuatro ocupan los 64
    # puntos centrales de la banda.
    h.txt(MARGEN + 8, y + 48, 'Tipo', 6.5, negrita=True)
    for i, etiqueta in enumerate(('Permanente', 'Semi - Rustico', 'Rustico',
                                  'Otro')):
        marcada = _coincide(etiqueta, tipo)
        h.txt(MARGEN + 18, y + 62 + i * 15, etiqueta, 6.5)
        h.casilla(MARGEN + 110, y + 56 + i * 15, marcada)
    if _coincide('Otro', tipo) or val(v, 'tipo_otro'):
        h.linea(MARGEN + 18, y + 122, MARGEN + 150, y + 122, 0.5, GRIS)
        h.txt(MARGEN + 20, y + 120, val(v, 'tipo_otro'), 6.5)

    if not sin_material:
        h.txt(x2 + 30, y + 12, 'Material', 6.5, negrita=True)
        h.txt(x2 + 110, y + 12, 'Estado', 6.5, negrita=True)
        material = val(v, 'material')
        for i, etiqueta in enumerate(('Concreto', 'Mampostería', 'Madera',
                                      'No Precisa', 'Otros')):
            yy = y + 26 + i * 16
            marcado = _coincide(etiqueta, material)
            h.txt(x2 + 6, yy + 6, etiqueta, 6.5)
            h.casilla(x2 + 70, yy, marcado)
            if marcado:
                h.brm(x2 + 104, yy, val(v, 'mat_estado'))
        h.linea(x2 + 40, y + 108, x3 - 8, y + 108, 0.5, GRIS)
        h.txt(x2 + 42, y + 106, val(v, 'mat_otro'), 6.5)
        h.txt(x2 + 6, y + 122, 'Nota : B (Bueno), R (Regular) , M (Malo)',
              5.5, color=GRIS)

    lamina = esquemas.get(spec.get('esquema') or '')
    if lamina:
        h.imagen(lamina, x_esquema + 6, y + 6,
                 (MARGEN + UTIL) - x_esquema - 12, alto_banda - 12)

    # bloques de dimensiones, una tira debajo de otra
    if not en_banda:
        yb = y + alto_banda
        for fila, alto_fila in zip(filas, altos_fila):
            h.linea(MARGEN, yb, MARGEN + UTIL, yb, 0.5)
            ancho_b = UTIL / float(max(len(fila), 1))
            for i, bloque in enumerate(fila):
                bx = MARGEN + i * ancho_b
                if i:
                    h.linea(bx, yb, bx, yb + alto_fila, 0.5)
                _bloque(h, v, bloque, bx, yb, ancho_b)
            yb += alto_fila
    y += alto

    # ── 4. inspección visual ──
    # Lo que quede hasta los responsables, que van pegados al pie.
    alto_insp = (ALTO - MARGEN - 34) - y - 10
    y = _seccion_inspeccion(h, y, v, spec.get('inspeccion') or [],
                            alto=max(120, alto_insp))

    # ── 5. responsables ──
    y = ALTO - MARGEN - 34
    y = h.seccion(y, '5. RESPONSABLES DEL REGISTRO')
    h.caja(MARGEN, y, UTIL, 24)
    h.rotulo_valor(MARGEN + 10, y + 15, 'Nombre :', f.get('evaluador'),
                   w_rotulo=44, w_linea=170)
    h.rotulo_valor(MARGEN + 250, y + 15, 'Cargo :', f.get('cargo'),
                   w_rotulo=36, w_linea=180)


def hoja1_generica(h, f, anio, esquemas, logos):
    """La hoja 1 de cualquier estructura que no sea una toma.

    POR QUE NO SIRVE LA DE LAS TOMAS
    --------------------------------
    `hoja1` esta calcada del formato de tomas laterales: pregunta por el
    numero de compuertas, el tipo de toma y las dimensiones del vano. Usarla
    para una caja hidraulica o un puente seria entregar al inspector un
    cuestionario que no es el de lo que tiene delante, y eso es peor que no
    darle ninguno.

    Esta hoja pregunta lo que vale para todas: que es, donde esta, que
    dimensiones declara la capa y como se encontro. Las caracteristicas no
    estan escritas aqui sino que salen de las columnas de la propia tabla,
    de modo que cada capa muestra las suyas sin que haya que mantener una
    lista por tipo.
    """
    v = f.get('valores') or {}
    y = cabecera(h, 1, 2, anio, logos)

    # ── 1. información general ──
    y = h.seccion(y, '1. INFORMACION GENERAL')
    alto = 34
    h.caja(MARGEN, y, UTIL, alto)
    h.rotulo_valor(MARGEN + 6, y + 12, 'Estructura', f.get('estructura'),
                   w_rotulo=56, w_linea=120)
    h.rotulo_valor(MARGEN + 200, y + 12, 'Denominación', f.get('nombre'),
                   w_rotulo=62, w_linea=130)
    hoy = f.get('fecha') or ''
    h.txt(ANCHO - MARGEN - 120, y + 12, 'Fecha :', 7)
    for i, parte in enumerate((hoy[:2], hoy[3:5], hoy[6:10])):
        ancho = 24 if i < 2 else 34
        x = ANCHO - MARGEN - 88 + i * 26
        h.caja(x, y + 4, ancho, 12, 0.5)
        h.txt(x + ancho / 2.0, y + 13, parte, 7, centro=True)
    h.rotulo_valor(MARGEN + 6, y + 27, 'Código', f.get('cod_est'),
                   w_rotulo=56, w_linea=120)
    y += alto

    # ── 2. localización ──
    y = h.seccion(y, '2. CODIFICACION Y LOCALIZACION')
    alto = 42
    h.caja(MARGEN, y, UTIL, alto)
    h.rotulo_valor(MARGEN + 6, y + 14, 'Nombre del canal', f.get('canal'),
                   w_rotulo=86, w_linea=160)
    h.rotulo_valor(MARGEN + 290, y + 14, 'Progresiva',
                   progresiva(f.get('progresiva')), w_rotulo=56, w_linea=100)
    h.rotulo_valor(MARGEN + 6, y + 31, 'Este (m)', f.get('este'),
                   w_rotulo=56, w_linea=90)
    h.rotulo_valor(MARGEN + 170, y + 31, 'Norte (m)', f.get('norte'),
                   w_rotulo=60, w_linea=90)
    h.rotulo_valor(MARGEN + 340, y + 31, 'Zona', f.get('zona') or '17S',
                   w_rotulo=32, w_linea=48)
    # Hasta MARGEN + UTIL y ni un punto más: con w_rotulo + w_linea de más,
    # la raya se sale del recuadro y cruza el borde de la hoja.
    h.rotulo_valor(MARGEN + 430, y + 31, 'Elev. (msnm)', f.get('elevacion'),
                   w_rotulo=60, w_linea=55)
    y += alto

    # ── 3. características de la capa ──
    y = h.seccion(y, '3. CARACTERISTICAS DE LA ESTRUCTURA')
    datos = (f.get('caracteristicas') or [])[:24]
    # Dos columnas, y una altura minima para que la seccion no se cierre
    # sobre si misma cuando la capa no declara nada: en una ficha en blanco
    # ese recuadro es donde se anota a mano.
    filas_por_columna = max(4, (len(datos) + 1) // 2)
    alto = 14 * filas_por_columna + 8
    h.caja(MARGEN, y, UTIL, alto)
    ancho_col = UTIL / 2.0
    for i, (etiqueta, valor) in enumerate(datos):
        col, fila = i // filas_por_columna, i % filas_por_columna
        h.rotulo_valor(MARGEN + 8 + col * ancho_col, y + 13 + fila * 14,
                       etiqueta, valor, w_rotulo=ancho_col * 0.46,
                       w_linea=ancho_col * 0.44, tam=6.5)
    if not datos:
        for fila in range(filas_por_columna):
            for col in range(2):
                h.rotulo_valor(MARGEN + 8 + col * ancho_col,
                               y + 13 + fila * 14, '', '',
                               w_rotulo=ancho_col * 0.46,
                               w_linea=ancho_col * 0.44, tam=6.5)
    y += alto

    # ── 4. estado en que se encontró ──
    y = h.seccion(y, '4. ESTADO Y CONDICION DE OPERACION')
    alto = 66
    h.caja(MARGEN, y, UTIL, alto)
    h.txt(MARGEN + 6, y + 14, 'Estado de conservación :', 7)
    h.brm(MARGEN + 120, y + 6, val(v, 'estado_cons') or f.get('estado'))
    h.txt(MARGEN + 182, y + 14, '( B: Bueno   R: Regular   M: Malo )', 6,
          color=GRIS)
    h.rotulo_valor(MARGEN + 330, y + 14, 'Condición operativa',
                   val(v, 'condicion') or val(v, 'operacion'),
                   w_rotulo=96, w_linea=110)
    h.txt(MARGEN + 6, y + 32, 'Requiere mantenimiento :', 7)
    h.si_no(MARGEN + 124, y + 24, f.get('requiere_mant'))
    h.txt(MARGEN + 6, y + 50, 'Observaciones :', 7)
    h.linea(MARGEN + 80, y + 51, ANCHO - MARGEN - 8, y + 51, 0.5, GRIS)
    h.parrafo(MARGEN + 84, y + 49, UTIL - 96, f.get('observaciones'),
              6.5, 8, maximo=2)
    y += alto

    # ── 5. lo que quede de hoja, rayado ──
    # Sin esto la hoja genérica termina a media página y el inspector se
    # queda sin sitio donde anotar lo que el formulario no previó, que en
    # campo es la mitad de lo que se apunta.
    sobra = ALTO - MARGEN - y
    if sobra > 40:
        y = h.seccion(y, '5. NOTAS DE CAMPO')
        alto = ALTO - MARGEN - y
        h.caja(MARGEN, y, UTIL, alto)
        renglon = y + 18
        while renglon < y + alto - 6:
            h.linea(MARGEN + 10, renglon, ANCHO - MARGEN - 10, renglon,
                    0.4, GRIS_SUAVE)
            renglon += 16

    # El croquis del tipo, si lo hay: no todas las estructuras tienen lámina
    # dibujada, y la hoja 2 ya reserva su recuadro.
    f['croquis'] = f.get('croquis') or esquemas.get(f.get('esquema') or '')


def hoja2(h, f, anio, logos, fotos):
    y = cabecera(h, 2, 2, anio, logos)

    y = h.seccion(y, '6. CROQUIS DE DETALLES')
    alto = 300
    h.caja(MARGEN, y, UTIL, alto)
    # La cuadrícula es para dibujar a mano cuando la ficha se imprime; con
    # croquis cargado se tapa sola.
    paso = 12
    x = MARGEN + paso
    while x < ANCHO - MARGEN:
        h.linea(x, y + 2, x, y + alto - 2, 0.25, GRIS_SUAVE)
        x += paso
    yy = y + paso
    while yy < y + alto - 2:
        h.linea(MARGEN + 2, yy, ANCHO - MARGEN - 2, yy, 0.25, GRIS_SUAVE)
        yy += paso
    if f.get('croquis'):
        h.imagen(f['croquis'], MARGEN + 8, y + 8, UTIL - 16, alto - 16)
    y += alto

    y = h.seccion(y, '7. EVIDENCIA FOTOGRAFICA')
    alto = ALTO - MARGEN - 34 - y
    h.caja(MARGEN, y, UTIL, alto)
    ancho_f = (UTIL - 30) / 2.0
    alto_f = (alto - 24) / 2.0
    for i in range(4):
        fx = MARGEN + 10 + (i % 2) * (ancho_f + 10)
        fy = y + 8 + (i // 2) * (alto_f + 8)
        h.caja(fx, fy, ancho_f, alto_f, 0.4)
        if i < len(fotos):
            h.imagen(fotos[i], fx + 2, fy + 2, ancho_f - 4, alto_f - 4)
        elif i == 0 and not fotos:
            h.txt(fx + ancho_f / 2.0, fy + alto_f / 2.0,
                  'Sin evidencia fotográfica registrada', 7, color=GRIS,
                  centro=True)

    y = ALTO - MARGEN - 34
    y = h.seccion(y, '5. RESPONSABLES DEL REGISTRO')
    h.caja(MARGEN, y, UTIL, 24)
    h.rotulo_valor(MARGEN + 10, y + 15, 'Nombre :', f.get('evaluador'),
                   w_rotulo=44, w_linea=170)
    h.rotulo_valor(MARGEN + 250, y + 15, 'Cargo :', f.get('cargo'),
                   w_rotulo=36, w_linea=180)


# ── armado ────────────────────────────────────────────────────────────────

def dibujar(fichas, ruta, anio, esquemas, logos):
    c = rl_canvas.Canvas(ruta, pagesize=A4)
    c.setTitle(f'Fichas de inspección {anio}')
    c.setAuthor('JURP')
    h = Hoja(c)
    for f in fichas:
        # Tres caminos, de más a menos específico: la hoja de las tomas, la
        # hoja oficial de esa estructura, y la genérica para las que todavía
        # no tienen formato dibujado.
        if f.get('formato'):
            hoja1_formato(h, f, anio, esquemas, logos, f['formato'])
        elif f.get('generica'):
            hoja1_generica(h, f, anio, esquemas, logos)
        else:
            hoja1(h, f, anio, esquemas, logos)
        c.showPage()
        hoja2(h, f, anio, logos, f.get('fotos') or [])
        c.showPage()
    c.save()
    return ruta


# ── datos ─────────────────────────────────────────────────────────────────

# ── los formatos oficiales, uno por estructura ────────────────────────────
#
# Cada entrada describe lo que distingue a esa hoja de las demás: el croquis
# acotado, los bloques de dimensiones de sus partes y las cuatro preguntas
# de inspección. El esqueleto —identificación, localización, año, material,
# responsables, croquis y fotos— lo dibuja `hoja1_formato` para todas.
#
# Los nombres de campo son los de `inventario.campos_evaluables`, que es de
# donde sale el formulario que llena el inspector: así la ficha impresa y la
# pantalla preguntan exactamente lo mismo. Si aquí se escribe un campo que
# allí no existe, la cota sale en blanco y no da error, que es lo que debe
# pasar con un dato que nadie ha levantado.

PREGUNTAS_CAUCE = [
    ('Se evidencia problemas en el concreto armado : Fisuras, corrosión '
     'de las armaduras, desgaste, etc.', 'insp_concreto', 'insp_concreto_c'),
    ('La estructura fue rebasada en época de crecidas (ocurrencia de '
     'Fenómenos Extraordinarios) ?', 'insp_rebasada', 'insp_rebasada_c'),
    ('Se evidencia colmatación de los cauces de ingreso y/o salida.',
     'insp_colmatada', 'insp_colmatada_c'),
    ('La estructura se encuentra obstruida (Considerar el ingreso y '
     'salida) ?', 'insp_obstruida', 'insp_obstruida_c'),
]

REVESTIMIENTOS = ['Concreto', 'Mampostería', 'Enrocado', 'Otro']

FORMATOS = {
    'canoas': {
        'esquema': 'canoa',
        'bloques': [
            {'titulo': 'Transición de Ingreso', 'estado': 'ing_estado',
             'campos': [
                 ('Longitud  (Lt1)', 'ing_long', 'm'),
                 ('Base mayor (B1)', 'ing_bmayor', 'm'),
                 ('Base menor (b)', 'ing_bmenor', 'm'),
                 ('Altura Muro (h1)', 'ing_h1', 'm'),
                 ('Espesor Muro (e)', 'ing_espes', 'm'),
                 ('Espesor Losa (e1)', 'ing_esplos', 'm')]},
            {'titulo': 'Cuerpo Canoa', 'estado': 'cue_estado', 'campos': [
                ('Longitud  (L)', 'cue_long', 'm'),
                ('Base  (b)', 'cue_base', 'm'),
                ('Altura Muro (h1)', 'cue_altura', 'm'),
                ('Espesor Muro (e)', 'cue_espes', 'm'),
                ('Espesor Losa (e1)', 'cue_esplos', 'm')]},
            {'titulo': 'Poza de Disipación', 'estado': 'poz_estado',
             'campos': [
                 ('Longitud  (L3)', 'poz_long', 'm'),
                 ('Base  (b)', 'poz_base', 'm'),
                 ('Altura Muro (h)', 'poz_altura', 'm'),
                 ('Espesor  (e)', 'poz_espes', 'm')]},
            {'titulo': 'Transición de Salida', 'estado': 'sal_estado',
             'campos': [
                 ('Longitud  (Lt2)', 'sal_long', 'm'),
                 ('Base mayor (B2)', 'sal_bmayor', 'm'),
                 ('Base menor (b)', 'sal_bmenor', 'm'),
                 ('Altura Muro (h2)', 'sal_h2', 'm'),
                 ('Espesor Muro (e)', 'sal_espes', 'm'),
                 ('Espesor Losa (e1)', 'sal_esplos', 'm')]},
        ],
        'inspeccion': PREGUNTAS_CAUCE,
    },

    'entregas': {
        'esquema': 'entrega',
        'bloques': [
            {'titulo': 'Dimensiones', 'campos': [
                ('Longitud  (L1)', 'ent_long1', 'm'),
                ('Longitud  (L2)', 'ent_long2', 'm'),
                ('Longitud  (L3)', 'ent_long3', 'm'),
                ('Ancho  (b)', 'ent_ancho', 'm'),
                ('Ancho mayor (B)', 'ent_bmayor', 'm'),
                ('Altura  (h)', 'ent_altura', 'm'),
                ('Espesor Muro (e)', 'ent_espes', 'm')]},
        ],
        'inspeccion': [
            PREGUNTAS_CAUCE[0], PREGUNTAS_CAUCE[1],
            ('Se evidencia colmatación de la estructura.',
             'insp_colmatada', 'insp_colmatada_c'),
            PREGUNTAS_CAUCE[3],
        ],
    },

    # Los dos puentes comparten formato y campos; solo cambia el titulo que
    # imprime la seccion 1, que sale de TABLAS.
    'puente_vehicular': {
        'esquema': 'puente',
        'bloques': [
            {'titulo': 'Dimensiones', 'campos': [
                ('Ancho  (A)', 'pue_ancho', 'm'),
                ('Murete guarda May. (B)', 'pue_mgmay', 'm'),
                ('Murete guarda Men. (b)', 'pue_mgmen', 'm'),
                ('Longitud  (L)', 'pue_long', 'm'),
                ('Transición losa  (l)', 'pue_translo', 'm'),
                ('Altura  (h)', 'pue_altura', 'm'),
                ('Espesor losa  (e)', 'pue_esplos', 'm')]},
        ],
        'inspeccion': [
            PREGUNTAS_CAUCE[0], PREGUNTAS_CAUCE[1],
            ('Se evidencia colmatación de la estructura.',
             'insp_colmatada', 'insp_colmatada_c'),
            PREGUNTAS_CAUCE[3],
        ],
    },

    'alcantarilla': {
        'esquema': 'alcantarilla',
        'bloques': [
            {'titulo': 'Transición de Ingreso',
             'opciones': ('ing_revest', 'ing_estado', REVESTIMIENTOS),
             'campos': [
                 ('Longitud  (Lt1)', 'ing_long', 'm'),
                 ('Base mayor (B1)', 'ing_bmayor', 'm'),
                 ('Base menor (b)', 'ing_bmenor', 'm'),
                 ('Altura Muro (h1)', 'ing_h1', 'm'),
                 ('Altura Muro (h2)', 'ing_h2', 'm'),
                 ('Espesor  (e)', 'ing_espes', 'm')]},
            {'titulo': 'Cuerpo Alcantarilla',
             'opciones': ('cue_tipo', 'cue_estado',
                          ['Tubería', 'Cajón', 'Otro']),
             'campos': [
                 ('Longitud  (L)', 'cue_long', 'm'),
                 ('Diámetro  (Ø)', 'cue_diam', 'm'),
                 ('Base  (b)', 'cue_base', 'm'),
                 ('Altura  (h)', 'cue_altura', 'm'),
                 ('Espesor  (e)', 'cue_espes', 'm'),
                 ('Espesor Losa (e1)', 'cue_esplos', 'm')]},
            {'titulo': 'Transición de Salida',
             'opciones': ('sal_revest', 'sal_estado', REVESTIMIENTOS),
             'campos': [
                 ('Longitud  (Lt2)', 'sal_long', 'm'),
                 ('Base mayor (B2)', 'sal_bmayor', 'm'),
                 ('Base menor (b)', 'sal_bmenor', 'm'),
                 ('Altura Muro (h3)', 'sal_h3', 'm'),
                 ('Espesor  (e)', 'sal_espes', 'm')]},
            {'titulo': 'Canales de Ingreso y Salida',
             'opciones': ('can_ing_mat', 'can_ing_estado',
                          ['Concreto', 'Mampostería', 'Tierra']),
             'campos': []},
        ],
        'inspeccion': [
            ('La estructura se encuentra operativa ?',
             'insp_operativa', 'insp_operativa_c'),
            PREGUNTAS_CAUCE[1],
            ('Se evidencia colmatación de los cauces de ingreso y/o salida.',
             'insp_colmatada', 'insp_colmatada_c'),
            ('La estructura se encuentra obstruida ?',
             'insp_obstruida', 'insp_obstruida_c'),
        ],
    },

    'sifon': {
        'esquema': 'sifon',
        'bloques': [
            {'titulo': 'Transición de Ingreso',
             'opciones': ('ing_revest', 'ing_estado', REVESTIMIENTOS),
             'campos': [
                 ('Longitud  (Lt1)', 'ing_long', 'm'),
                 ('Base mayor (B1)', 'ing_bmayor', 'm'),
                 ('Base menor (b)', 'ing_bmenor', 'm'),
                 ('Altura Muro (h1)', 'ing_h1', 'm'),
                 ('Altura Muro (h2)', 'ing_h2', 'm'),
                 ('Espesor  (e)', 'ing_espes', 'm')]},
            {'titulo': 'Ducto (Cuerpo Sifón)',
             'opciones': ('cue_tipo', 'cue_estado',
                          ['Tubería', 'Cajón', 'Otro']),
             'campos': [
                 ('Longitud  (L)', 'cue_long', 'm'),
                 ('Diámetro  (Ø)', 'cue_diam', 'mm'),
                 ('Base  (b)', 'cue_base', 'm'),
                 ('Altura  (h)', 'cue_altura', 'm'),
                 ('Espesor  (e)', 'cue_espes', 'm'),
                 ('Espesor Losa (e1)', 'cue_esplos', 'm')]},
            {'titulo': 'Transición de Salida',
             'opciones': ('sal_revest', 'sal_estado', REVESTIMIENTOS),
             'campos': [
                 ('Longitud  (Lt2)', 'sal_long', 'm'),
                 ('Base mayor (B2)', 'sal_bmayor', 'm'),
                 ('Base menor (b)', 'sal_bmenor', 'm'),
                 ('Altura Muro (h)', 'sal_h', 'm'),
                 ('Altura Muro (h3)', 'sal_h3', 'm'),
                 ('Espesor  (e)', 'sal_espes', 'm')]},
            {'titulo': 'Inspección y Purga',
             'opciones': ('pur_mat', 'pur_esc_estado',
                          ['Concreto', 'Acero', 'Otro']),
             'campos': [
                 ('Ancho', 'pur_ancho', 'm'),
                 ('Largo', 'pur_largo', 'm'),
                 ('Altura', 'pur_altura', 'm'),
                 ('Espesor', 'pur_espes', 'm'),
                 ('Válvula compuerta Ø', 'pur_vdiam', 'mm'),
                 ('Tubería de desfogue Ø', 'pur_ddiam', 'mm')]},
        ],
        'inspeccion': [
            PREGUNTAS_CAUCE[0],
            ('La tubería cuenta con cobertura y/o protección ?',
             'insp_cobertura', 'insp_cobertura_c'),
            ('Se evidencia desgaste por corrosión de la tubería de acero ?',
             'insp_corr_tub', 'insp_corr_tub_c'),
            ('La zona de descarga de la purga se encuentra habilitada ?',
             'insp_descarga', 'insp_descarga_c'),
        ],
    },
}

FORMATOS['aliviadero'] = {
    'esquema': 'aliviadero',
    'filas': [
        [{'titulo': 'Canal de Ingreso', 'estado': 'apr_estado', 'campos': [
            ('Caudal Diseño', 'apr_qdis', 'm3/s'),
            ('Caudal Operación', 'apr_qope', 'm3/s'),
            ('Base  (b)', 'apr_base', 'm'),
            ('Altura der. (hd)', 'apr_hd', 'm'),
            ('Talud der. (zd)', 'apr_zd', ''),
            ('Altura izq. (hi)', 'apr_hi', 'm'),
            ('Talud izq. (zi)', 'apr_zi', '')]},
         {'titulo': 'Aliviadero',
          'opciones': ('ali_revest', 'ali_estado', REVESTIMIENTOS),
          'campos': [
              ('Longitud', 'ali_long', 'm'),
              ('Base  (b1)', 'ali_base', 'm'),
              ('Altura  (h1)', 'ali_altura', 'm'),
              ('Espesor  (e)', 'ali_espes', 'm'),
              ('Talud  (Z)', 'ali_talud', '')]},
         {'titulo': 'Partidor', 'estado': 'par_estado', 'campos': [
             ('Longitud', 'par_long', 'm'),
             ('Base  (b2)', 'par_base', 'm'),
             ('Altura  (h2)', 'par_altura', 'm'),
             ('Espesor  (e)', 'par_espes', 'm'),
             ('Compuertas metálicas', 'par_compu', ''),
             ('Barandas de seguridad', 'par_baran', '')]}],
        [{'titulo': 'Canal hacia el Sifón', 'estado': 'sif_estado',
          'campos': [
              ('Longitud', 'sif_long', 'm'),
              ('Base  (b4)', 'sif_base', 'm'),
              ('Altura  (h4)', 'sif_altura', 'm'),
              ('Espesor  (e)', 'sif_espes', 'm'),
              ('Talud  (Z)', 'sif_talud', '')]},
         {'titulo': 'Canal de Excedencia', 'estado': 'exc_estado', 'campos': [
             ('Longitud', 'exc_long', 'm'),
             ('Base  (b4)', 'exc_base', 'm'),
             ('Altura  (h4)', 'exc_altura', 'm'),
             ('Espesor  (e)', 'exc_espes', 'm'),
             ('Talud  (Z)', 'exc_talud', '')]},
         {'titulo': 'Disipador', 'estado': 'dis_estado', 'campos': [
             ('a', 'dis_a', 'm'), ('b', 'dis_b', 'm'), ('c', 'dis_c', 'm'),
             ('d', 'dis_d', 'm'), ('e', 'dis_e', 'm'), ('f', 'dis_f', 'm')]},
         {'titulo': 'Disipador (cont.) y conducción', 'campos': [
             ('g', 'dis_g', 'm'), ('h', 'dis_h', 'm'), ('i', 'dis_i', 'm'),
             ('j', 'dis_j', 'm'), ('k', 'dis_k', 'm'),
             ('Tubería  Ø', 'tub_diam', 'mm')]}],
    ],
    'inspeccion': [
        PREGUNTAS_CAUCE[0],
        ('La estructuras metálicas presentan corrosión ?',
         'insp_metal_cor', 'insp_metal_cor_c'),
        ('Se evidencia de sedimentos en la estructura ?',
         'insp_sedimento', 'insp_sedimento_c'),
        ('La zona de descarga del aliviadero se encuentra habilitada ?',
         'insp_descarga', 'insp_descarga_c'),
    ],
}

FORMATOS['desarenadores'] = {
    'esquema': 'desarenador',
    'sin_material': True,
    'filas': [
        [{'titulo': 'Canal de Aproximación',
          'opciones': ('apr_tipo', 'apr_estado',
                       ['Canal Abierto', 'Tubería', 'Conducto', 'Otro']),
          'campos': [
              ('Longitud', 'apr_long', 'm'),
              ('Ancho', 'apr_ancho', 'm'),
              ('Altura', 'apr_altura', 'm'),
              ('Espesor  (e)', 'apr_espes', 'm')]},
         {'titulo': 'Estructura de regulación', 'estado': 'reg_estado',
          'campos': [
              ('Número de Naves', 'reg_naves', 'und'),
              ('Base  (b)', 'reg_base', 'm'),
              ('Base mayor (B)', 'reg_bmayor', 'm'),
              ('Altura  (h)', 'reg_altura', 'm'),
              ('Espesor  (e)', 'reg_espes', 'm'),
              ('Compuertas metálicas', 'reg_compu', ''),
              ('Barandas de seguridad', 'reg_baran', '')]},
         {'titulo': 'Transición de entrada', 'campos': [
             ('Número de Naves', 'ent_naves', 'und'),
             ('Longitud', 'ent_long', 'm'),
             ('Base Mayor (B)', 'ent_bmayor', 'm'),
             ('Base Menor (b)', 'ent_bmenor', 'm'),
             ('Altura  (h)', 'ent_altura', 'm'),
             ('Espesor  (e)', 'ent_espes', 'm')]},
         {'titulo': 'Tanque Sedimentador', 'estado': 'tan_estado', 'campos': [
             ('Número de Naves', 'tan_naves', 'und'),
             ('Longitud', 'tan_long', 'm'),
             ('Ancho  (b)', 'tan_base', 'm'),
             ('Base  (c)', 'tan_basec', 'm'),
             ('Altura  (h)', 'tan_altura', 'm'),
             ('Altura  (h1)', 'tan_h1', 'm'),
             ('Altura  (h2)', 'tan_h2', 'm'),
             ('Altura  (h3)', 'tan_h3', 'm'),
             ('Espesor  (e)', 'tan_espes', 'm')]}],
        [{'titulo': 'Transición de salida', 'estado': 'sal_estado',
          'campos': [
              ('Longitud', 'sal_long', 'm'),
              ('Ancho  (b)', 'sal_base', 'm'),
              ('Base  (c)', 'sal_basec', 'm'),
              ('Altura  (h)', 'sal_altura', 'm'),
              ('Espesor  (e)', 'sal_espes', 'm')]},
         {'titulo': 'Equipamiento', 'campos': [
             ('Puente de Maniobras', 'eq_puente', ''),
             ('Conductos de purga', 'eq_purga', ''),
             ('Purga  Ø', 'eq_pdiam', 'mm'),
             ('Purga  N°', 'eq_pnum', 'und'),
             ('Compuertas metálicas', 'eq_compu', ''),
             ('Compuertas  N°', 'eq_cnum', 'und')]},
         {'titulo': 'Cámara de Carga', 'estado': 'cam_estado', 'campos': [
             ('Longitud', 'cam_long', 'm'),
             ('Ancho  (b)', 'cam_base', 'm'),
             ('Base  (c)', 'cam_basec', 'm'),
             ('Altura  (h)', 'cam_altura', 'm'),
             ('Espesor  (e)', 'cam_espes', 'm'),
             ('Otros', 'cam_otros', '')]}],
    ],
    'inspeccion': [
        PREGUNTAS_CAUCE[0],
        ('La estructuras metálicas presentan corrosión ?',
         'insp_metal_cor', 'insp_metal_cor_c'),
        ('Se evidencia de sedimentos en la estructura ?',
         'insp_sedimento', 'insp_sedimento_c'),
        ('La estructura presente alguna avería ?',
         'insp_averia', 'insp_averia_c'),
    ],
}

# El puente peatonal usa el mismo formato que el vehicular: mismos campos
# en campos_evaluables y mismo papel. Lo unico que cambia es el titulo, que
# sale de TABLAS.
FORMATOS['puente_peatonal'] = FORMATOS['puente_vehicular']


# tipo → (tabla, canal, nombre que se imprime como «Estructura»)
#
# Las dos tomas llevan el formato propio de la ANA. Las demas usan la hoja
# generica: el `canal` sale de la propia fila y por eso va vacio aqui.
TABLAS = {
    'tomas_canal_madre': ('inventario.tomas_canal_madre', 'Canal Madre PECH',
                          'TOMA LATERAL'),
    'tomas_l10': ('inventario.tomas_l10', 'Canal Lateral 10', 'TOMA LATERAL'),

    'tomas_otros_sectores': ('inventario.tomas_otros_sectores', '', 'TOMA'),
    'alcantarilla':      ('inventario.alcantarilla', '', 'ALCANTARILLA'),
    'aliviadero':        ('inventario.aliviadero', '', 'ALIVIADERO'),
    'bocatomas':         ('inventario.bocatomas', '', 'BOCATOMA'),
    'cajas_hidraulicas': ('inventario.cajas_hidraulicas', '',
                          'CAJA HIDRAULICA'),
    'camara_rompepresion': ('inventario.camara_rompepresion', '',
                            'CAMARA ROMPEPRESION'),
    'canoas':            ('inventario.canoas', '', 'CANOA'),
    'desarenadores':     ('inventario.desarenadores', '', 'DESARENADOR'),
    'entregas':          ('inventario.entregas', '', 'ENTREGA'),
    'estaciones_control': ('inventario.estaciones_control', '',
                           'ESTACION DE CONTROL'),
    'laterales':         ('inventario.laterales', '', 'LATERAL'),
    'partidor':          ('inventario.partidor', '', 'PARTIDOR'),
    'pases_de_tuberias': ('inventario.pases_de_tuberias', '',
                          'PASE DE TUBERIA'),
    'puente_peatonal':   ('inventario.puente_peatonal', '', 'PUENTE PEATONAL'),
    'puente_vehicular':  ('inventario.puente_vehicular', '',
                          'PUENTE VEHICULAR'),
    'rapidas':           ('inventario.rapidas', '', 'RAPIDA'),
    'reservorios':       ('inventario.reservorios', '', 'RESERVORIO'),
    'sifon':             ('inventario.sifon', '', 'SIFON'),
}

# Los dos tipos con formato propio. El resto va por la hoja generica.
CON_FORMATO_PROPIO = ('tomas_canal_madre', 'tomas_l10')

# La lámina acotada de cada tipo. El nombre del tipo suele coincidir con el
# del archivo —`alcantarilla`, `aliviadero`, `sifon`— y cuando no, va aquí.
#
# Los tipos que no aparecen no tienen lámina dibujada todavía: su recuadro
# sale con la cuadrícula, que es donde el inspector dibuja a mano. Es mejor
# eso que prestarles el croquis de otra estructura, que acotaría cosas que
# la que tiene delante no tiene.
ESQUEMA_DE = {
    'canoas': 'canoa',
    'desarenadores': 'desarenador',
    'entregas': 'entrega',
    'laterales': 'canal',
    'puente_peatonal': 'puente',
    'puente_vehicular': 'puente',
    'tomas_otros_sectores': 'toma',
}

# Columnas que no son caracteristicas de la estructura: identificadores,
# geometria, herencia del CAD y la contabilidad de campanias. Las de la
# cabecera tambien salen, porque ya se imprimen en las secciones 1 y 2.
COLUMNAS_OCULTAS = {
    'fid', 'ogc_fid', 'geom', 'ambito', 'fuente', 'cod_est', 'tramo',
    'etiqueta', 'campania_alta', 'campania_baja', 'motivo_baja',
    'progresiva_kmz', 'objectid', 'objectid_1', 'shape_leng', 'shape_le_1',
    'handle', 'layer', 'entity', 'lyrfrzn', 'lyron', 'color', 'linetype',
    'linewt', 'refname', 'docupdate', 'docid', 'globalwidt',
    'nombre', 'nombre_del', 'nombre_de_', 'nombre_canal', 'progresiva',
    'norte', 'este', 'zona', 'observacio', 'observaciones', 'un', 'unir',
}

# De donde sacar el nombre del canal, en orden de preferencia.
COLUMNAS_CANAL = ('nombre_del', 'nombre_de_', 'nombre_canal', 'nombre_d_1')


def _etiqueta(columna):
    """El nombre de columna, legible.

    Los shapefile traen las unidades pegadas al nombre —`ancho__m_`,
    `altura__m_`— porque DBF corta a diez caracteres y no admite
    parentesis. Deshacer eso aqui es mas barato que mantener un diccionario
    de trescientas columnas, y cuando no acierta se lee igual.
    """
    t = str(columna)
    for sufijo, unidad in (('__m_', ' (m)'), ('__mm_', ' (mm)'),
                           ('__m3_', ' (m3)'), ('__km_', ' (km)'),
                           ('__s_', ' (s)'), ('__', ' ')):
        if t.endswith(sufijo):
            t = t[:-len(sufijo)] + unidad
            break
    t = t.rstrip('_').replace('_', ' ').strip()
    return (t[:1].upper() + t[1:]) if t else ''


def caracteristicas_de(R, tabla, pk, fids):
    """Las columnas propias de la capa, por activo.

    Se leen del catalogo y no de una lista escrita aqui: son veinte capas
    con columnas distintas, y una lista por capa envejeceria mal. Si la
    consulta falla, la ficha sale con la seccion en blanco —que es util
    igual, porque es donde se anota a mano— en vez de no salir.
    """
    if not fids:
        return {}
    try:
        esquema, nombre = tabla.split('.', 1)
        filas = R.consultar(f"""
            SELECT column_name FROM information_schema.columns
            WHERE table_schema = '{esquema}' AND table_name = '{nombre}'
            ORDER BY ordinal_position;""") or []
        cols = [c[0] for c in filas
                if c and c[0] and c[0].lower() not in COLUMNAS_OCULTAS]
        canal_col = next((c for c in COLUMNAS_CANAL
                          if any(x and x[0] == c for x in filas)), None)
        if canal_col:
            cols.append(canal_col)
        if not cols:
            return {}

        # Mismo cuidado que en leer_fichas: un salto de linea dentro de un
        # valor parte la fila en dos y descuadra todo lo que viene detras.
        sel = ', '.join(
            f"""translate(coalesce("{c}"::text, ''), E'\n\r', '  ')"""
            for c in cols)
        ids = ', '.join(str(int(x)) for x in fids)
        filas = R.consultar(
            f'SELECT "{pk}", {sel} FROM {tabla} WHERE "{pk}" IN ({ids});') or []
    except Exception as e:                       # noqa: BLE001
        print(f'  caracteristicas de {tabla}: {e}', file=sys.stderr)
        return {}

    salida = {}
    for fila in filas:
        if len(fila) != len(cols) + 1:
            continue
        valores = dict(zip(cols, fila[1:]))
        canal = valores.pop(canal_col, '') if canal_col else ''
        salida[str(fila[0])] = {
            'canal': canal,
            'lista': [(_etiqueta(c), v) for c, v in valores.items()
                      if v not in (None, '')],
        }
    return salida


def leer_fichas(R, tipo, ambito, campania, fid=None):
    tabla, canal, estructura = TABLAS[tipo]
    pk = 'ogc_fid' if 'canal_madre' in tabla or 'otros' in tabla else 'fid'

    join = ''
    if campania:
        join = f"""
        LEFT JOIN LATERAL (
            SELECT e.valores, e.evaluador, e.id
            FROM inventario.evaluaciones e
            JOIN inventario.campanias c ON c.id = e.campania_id
            WHERE e.tipo_activo = '{tipo}' AND e.activo_fid = a.{pk}
              AND c.anio <= {campania}
            ORDER BY c.anio DESC LIMIT 1
        ) ev ON true"""
    else:
        join = f"""
        LEFT JOIN LATERAL (
            SELECT e.valores, e.evaluador, e.id
            FROM inventario.evaluaciones e
            WHERE e.tipo_activo = '{tipo}' AND e.activo_fid = a.{pk}
            ORDER BY e.id DESC LIMIT 1
        ) ev ON true"""

    cond = []
    if ambito and ambito != 'todos':
        cond.append(f"a.ambito = '{ambito}'")
    if fid:
        cond.append(f'a.{pk} = {int(fid)}')
    where = ('WHERE ' + ' AND '.join(cond)) if cond else ''

    # SIN SALTOS DE LINEA EN EL TEXTO.
    #
    # `consultar` lanza psql con -A -F \x1f y luego parte la salida POR
    # LINEAS. Un nombre o una observacion con un salto dentro rompe su fila
    # en dos trozos, y lo que llega aqui son dos filas cortas en vez de una
    # buena: «not enough values to unpack». Se limpia en la consulta, que es
    # donde todavia se sabe que es un solo campo.
    def plano(col):
        # El ::text no es adorno: `progresiva` es texto en las tomas pero
        # double precision en las canoas y en media docena de capas mas, y
        # translate() solo acepta texto. Sin el cast, el generador muere con
        # «function translate(double precision, unknown, unknown) does not
        # exist» y la ficha no sale para ninguna de esas capas.
        return f"translate(coalesce({col}::text, ''), E'\n\r', '  ')"

    filas = R.consultar(f"""
        SELECT a.{pk}, {plano('a.nombre')}, {plano('a.cod_est')},
               {plano('a.progresiva')}, {plano('a.progresiva_kmz')},
               round(ST_X(ST_Centroid(a.geom))::numeric, 2),
               round(ST_Y(ST_Centroid(a.geom))::numeric, 2),
               {plano('ev.valores::text')}, {plano('ev.evaluador')}, ev.id
        FROM {tabla} a {join} {where}
        ORDER BY a.{pk};""")
    if not filas:
        return []

    salida = []
    for fila in filas:
        # Red de seguridad por si aun asi llega una fila partida: una sola
        # estructura rara no debe dejar sin fichas a las otras veintiuna.
        if len(fila) != 10:
            print(f'  fila con {len(fila)} campos, se omite', file=sys.stderr)
            continue
        (clave, nombre, cod, prog, prog_kmz, este, norte,
         valores, evaluador, eval_id) = fila
        salida.append({
            'fid': clave,
            'generica': tipo not in CON_FORMATO_PROPIO,
            'formato': FORMATOS.get(tipo),
            'esquema': ESQUEMA_DE.get(tipo, tipo),
            'nombre': nombre,
            'estructura': estructura,
            'canal': canal,
            'cod_est': cod,
            'progresiva': prog or prog_kmz,
            'este': f'{float(este):,.2f}' if este not in (None, '') else '',
            'norte': f'{float(norte):,.2f}' if norte not in (None, '') else '',
            'zona': '17S',
            'elevacion': '',
            'valores': _json(valores),
            'evaluador': evaluador,
            'cargo': '',
            'fecha': '',
            'fotos': fotos_de(R, eval_id or None),
        })

    # Las caracteristicas se piden de una sola vez para todas las fichas:
    # una consulta por estructura serian veintidos viajes a psql, cada uno
    # levantando su proceso.
    if tipo not in CON_FORMATO_PROPIO and salida:
        extra = caracteristicas_de(R, tabla, pk, [s['fid'] for s in salida])
        for s in salida:
            dato = extra.get(str(s['fid'])) or {}
            s['caracteristicas'] = dato.get('lista') or []
            s['canal'] = s['canal'] or dato.get('canal') or ''
            v = s.get('valores') or {}
            # Lo que el inspector anotó manda sobre lo que declara la capa:
            # la ficha se lee para saber cómo se encontró la estructura.
            s['estado'] = val(v, 'estado_cons')
            s['observaciones'] = val(v, 'observaciones')
            s['requiere_mant'] = val(v, 'requiere_mant')

    return salida


def _json(texto):
    """El JSONB llega como texto: psql no lo convierte a dict."""
    if not texto:
        return {}
    if isinstance(texto, dict):
        return texto
    try:
        import json
        return json.loads(texto)
    except (ValueError, TypeError):
        return {}


def fotos_de(R, eval_id, maximo=4):
    """Las rutas en disco de las fotos de esa evaluación.

    `url` guarda la ruta relativa dentro de media; el PDF necesita el
    archivo, no la URL. Las que no estén en disco se saltan: una foto que
    falta no debe dejar la ficha sin las otras tres.
    """
    if not eval_id:
        return []
    filas = R.consultar(
        f'SELECT url FROM inventario.fotos WHERE evaluacion_id = {int(eval_id)} '
        f'ORDER BY id LIMIT {maximo};') or []
    raiz = os.environ.get('MEDIA_ROOT', '/app/media')
    rutas = []
    for (url,) in filas:
        if not url:
            continue
        rel = str(url).split('/media/')[-1].lstrip('/')
        ruta = os.path.join(raiz, rel)
        if os.path.exists(ruta):
            rutas.append(ruta)
    return rutas


def buscar_esquemas(carpeta):
    if not carpeta or not os.path.isdir(carpeta):
        return {}
    encontrados = {}
    for nombre in os.listdir(carpeta):
        base, ext = os.path.splitext(nombre)
        if ext.lower() in ('.webp', '.png', '.jpg', '.jpeg'):
            encontrados[base] = os.path.join(carpeta, nombre)
    return encontrados


def extraer_logos(carpeta_tmp):
    """Saca los logos de logos_ana.py a archivos, para poder dibujarlos."""
    try:
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        import logos_ana as L
    except ImportError:
        return {}
    import base64
    salida = {}
    for nombre, atributo in (('jurp', '_JURP'), ('ana', '_ANA'),
                             ('minagri', '_MINAGRI')):
        dato = getattr(L, atributo, None)
        if not dato:
            continue
        try:
            crudo = base64.b64decode(''.join(dato) if isinstance(dato, tuple)
                                     else dato)
            ruta = os.path.join(carpeta_tmp, f'logo_{nombre}.png')
            with open(ruta, 'wb') as f:
                f.write(crudo)
            salida[nombre] = ruta
        except Exception:
            continue
    return salida


# ── prueba sin base de datos ──────────────────────────────────────────────

FICHA_PRUEBA = {
    'fid': 1,
    'nombre': 'INTERCUENCAS',
    'estructura': 'TOMA LATERAL',
    'canal': 'Canal Madre PECH',
    'cod_est': 'INTERCUENCAS',
    'progresiva': 36130,
    'este': '765,353.78',
    'norte': '9,041,598.28',
    'zona': '17S',
    'elevacion': '248.57',
    'fecha': '05/06/2025',
    'evaluador': 'YESSICA MEDINA SAVALETA',
    'cargo': 'RESPONSABLE DE ESTUDIOS',
    'valores': {
        'anio_const': 1990, 'tipo': 'Permanente', 'material': 'Concreto',
        'mat_estado': 'B', 'q_diseno': 0.5, 'q_opera': 0.5,
        'area_total': 2565.9, 'n__usuario': 2, 'area_riego': 828.76,
        'tom_estado': 'B', 'tom_ancho': 1.4, 'tom_long2': 2.27,
        'tom_long3': 0.3, 'tom_altura': 4.4, 'tom_espes': 0.25,
        'tom_esplos': 0.2, 'tom_talud': 1,
        'com_ancho': 0.8, 'com_alto': 0.8, 'com_htotal': 5.2,
        'com_eplan': 9.52, 'com_vast': '1 1/2"', 'com_sello': 'si',
        'com_tsello': 'Plancha de Acero',
        'ret_hay': 'no', 'estado2': 'B', 'ret_purga': 'no', 'bar_hay': 'no',
        'sld_tipo': 'Tubería', 'sld_diam': 500, 'sld_mat': 'PVC',
        'sld_medic': 'no',
        'insp_concreto': 'no', 'insp_metal_op': 'si', 'insp_rebasada': 'no',
        'insp_segurid': 'no', 'insp_segurid_c': 'Falta señaletica',
        'nota_adic': 'Caja H = 4.54 m, A = 2.10 m y e = 0.20 m',
        'obs_ubic': '',
    },
    'fotos': [],
}


# La misma estructura que vio el inspector en la pantalla de la caja
# hidraulica: sirve para comprobar la hoja generica sin base de datos.
FICHA_PRUEBA_GENERICA = {
    'fid': 170,
    'generica': True,
    'esquema': 'canal_rectangular',
    'nombre': '10.6-C15',
    'estructura': 'CAJA HIDRAULICA',
    'canal': 'Sub lateral 10.6',
    'cod_est': '10.6-C15',
    'progresiva': 3558.65,
    'este': '765,120.40',
    'norte': '9,040,880.15',
    'zona': '17S',
    'elevacion': '231.40',
    'fecha': '09/11/2026',
    'evaluador': 'cherrera',
    'cargo': '',
    'estado': 'B',
    'observaciones': 'Operativa. Tapa de concreto sin fisuras visibles.',
    'requiere_mant': 'no',
    'caracteristicas': [
        ('Material', 'Concreto'), ('Estado', 'Bueno'),
        ('Diametro (mm)', '400'), ('Ancho (m)', '3.45'),
        ('Largo (m)', '3.20'), ('Altura (m)', '2.43'),
        ('Espesor (m)', '0.20'), ('Numero', '170'),
        ('Material1', 'Concreto'), ('Estado1', 'B'),
    ],
    'valores': {'estado_cons': 'B', 'condicion': 'Operativo'},
    'fotos': [],
}


# La canoa C-01 del formato que trajo el inspector: sirve para comprobar la
# hoja oficial sin base de datos, y para ver de un vistazo si una cota se
# desplazo al tocar el dibujante.
FICHA_PRUEBA_CANOA = {
    'fid': 1,
    'formato': FORMATOS['canoas'],
    'esquema': 'canoa',
    'nombre': 'C - 01',
    'estructura': 'CANOA',
    'canal': 'Canal Lateral 10',
    'cod_est': 'C - 01',
    'progresiva': 729.03,
    'este': '747,636.59',
    'norte': '9,072,472.94',
    'zona': '17S',
    'elevacion': '146.04',
    'fecha': '10/06/2025',
    'evaluador': 'JUAN ALFARO MELENDEZ',
    'cargo': 'SUPERVISOR PREMAFEN',
    'valores': {
        'anio_const': 1993, 'tipo': 'Permanente',
        'material': 'Concreto', 'mat_estado': 'R',
        'obs_ubic': 'Prrog. Plano conforme a obra 1 + 748.',
        'ing_estado': 'R', 'ing_long': 4.50, 'ing_bmayor': 4.50,
        'ing_bmenor': 1.50, 'ing_h1': 1.00, 'ing_espes': 0.20,
        'ing_esplos': 0.20,
        'cue_estado': 'R', 'cue_long': 10.85, 'cue_base': 1.50,
        'cue_altura': 1.00, 'cue_espes': 0.20, 'cue_esplos': 0.20,
        'poz_estado': 'R', 'poz_long': 4.60, 'poz_base': 1.50,
        'poz_altura': 1.00, 'poz_espes': 0.20,
        'sal_estado': 'R', 'sal_long': 4.40, 'sal_bmayor': 1.50,
        'sal_h2': 1.00, 'sal_espes': 0.20, 'sal_esplos': 0.20,
        'insp_concreto': 'no',
        'insp_rebasada': 'si', 'insp_rebasada_c': 'Fenomeno EL NINO 2017.',
        'insp_colmatada': 'no', 'insp_colmatada_c': 'Presencia de vegetacion.',
        'insp_obstruida': 'no',
        'nota_adic': 'Existencia de diques de rotacion de roca. Diques de '
                     'encruzamiento de material propio de cauce. Existencia '
                     'de revestimiento con manposteria al ingreso.',
    },
    'fotos': [],
}


def _prueba_formato(tipo, estructura, nombre, valores, esquema):
    """Una ficha de prueba de cualquier formato, con la cabecera comun."""
    base = dict(FICHA_PRUEBA_CANOA)
    base.update({
        'formato': FORMATOS[tipo], 'esquema': esquema, 'nombre': nombre,
        'estructura': estructura, 'cod_est': nombre, 'valores': valores,
    })
    return base


FICHA_PRUEBA_ENTREGA = _prueba_formato(
    'entregas', 'ENTREGAS', 'E - 01', {
        'anio_const': 1993, 'tipo': 'Permanente',
        'material': 'Mamposteria', 'mat_estado': 'R',
        'ent_long1': 2.10, 'ent_long2': 4.00, 'ent_long3': 2.00,
        'ent_ancho': 2.00, 'ent_bmayor': 8.00, 'ent_altura': 0.70,
        'ent_espes': 0.30,
        'insp_concreto': 'si', 'insp_concreto_c': 'Muro izquierdo con ruptura',
        'insp_rebasada': 'si', 'insp_rebasada_c': 'Fenomeno EL NINO 2017',
        'insp_colmatada': 'no', 'insp_obstruida': 'no',
        'nota_adic': 'La estructura aguas arriba cuenta con diques de '
                     'encauzamiento de material propio (arena) y '
                     'descolmatacion de la quebrada',
    }, 'entrega')

FICHA_PRUEBA_ALCANTARILLA = _prueba_formato(
    'alcantarilla', 'ALCANTARILLA', 'ALC-01', {
        'anio_const': 1993, 'tipo': 'Permanente',
        'material': 'Concreto', 'mat_estado': 'B',
        'ing_revest': 'Mamposteria', 'ing_estado': 'R', 'ing_long': 4.00,
        'ing_bmayor': 3.00, 'ing_bmenor': 1.00, 'ing_h1': 1.00,
        'ing_h2': 1.40, 'ing_espes': 0.30,
        'cue_tipo': 'Tuberia', 'cue_estado': 'B', 'cue_long': 34.60,
        'cue_diam': 1.00,
        'sal_revest': 'Mamposteria', 'sal_estado': 'R', 'sal_long': 5.00,
        'sal_bmayor': 3.00, 'sal_bmenor': 1.00, 'sal_h3': 1.00,
        'sal_espes': 0.30,
        'insp_operativa': 'no', 'insp_operativa_c': 'Inoperativa',
        'insp_rebasada': 'si', 'insp_rebasada_c': 'Fenomeno EL NINO 2017',
        'insp_colmatada': 'si', 'insp_obstruida': 'si',
        'nota_adic': 'Los datos corresponden a los planos conforme a obra, '
                     'debido a que la estructura se encuentra totalmente '
                     'colmatada.',
    }, 'alcantarilla')


FICHA_PRUEBA_ALIVIADERO = _prueba_formato(
    'aliviadero', 'ALIVIADERO', 'ALV-01', {
        'anio_const': 1995, 'tipo': 'Permanente',
        'material': 'Concreto', 'mat_estado': 'R',
        'apr_estado': 'R', 'apr_qdis': 3.00, 'apr_qope': 3.00,
        'apr_base': 1.20, 'apr_hd': 1.40, 'apr_zd': 1.40,
        'apr_hi': 1.40, 'apr_zi': 1.50,
        'ali_revest': 'Concreto', 'ali_estado': 'R', 'ali_long': 18.00,
        'ali_base': 1.50, 'ali_altura': 1.60, 'ali_espes': 0.075,
        'ali_talud': 1.5,
        'par_estado': 'B', 'par_long': 8.70, 'par_base': 3.20,
        'par_altura': 2.00, 'par_espes': 0.20,
        'sif_estado': 'R', 'sif_long': 44.80, 'sif_base': 0.90,
        'sif_altura': 1.20, 'sif_espes': 0.20, 'sif_talud': 1.5,
        'exc_estado': 'B', 'exc_long': 61.80, 'exc_base': 1.20,
        'exc_altura': 1.20, 'exc_espes': 0.20, 'exc_talud': 1.5,
        'dis_estado': 'R', 'dis_a': 3.50, 'dis_b': 2.33, 'dis_c': 1.00,
        'dis_d': 2.47, 'dis_e': 0.30, 'dis_f': 0.50, 'dis_g': 1.50,
        'dis_h': 0.30, 'dis_i': 0.30, 'dis_j': 1.50, 'dis_k': 0.90,
        'tub_diam': 1200,
        'insp_concreto': 'no', 'insp_metal_cor': 'si',
        'insp_metal_cor_c': 'Desgaste de ataguias, produce filtraciones',
        'insp_sedimento': 'no', 'insp_descarga': 'si',
    }, 'aliviadero')

FICHA_PRUEBA_DESARENADOR = _prueba_formato(
    'desarenadores', 'DESARENADOR', 'D 10.1 - I', {
        'anio_const': 1995, 'tipo': 'Semi - Rustico',
        'obs_ubic': 'Correspondiente a la Toma Lateral 10.1I prog. 1+553.70.',
        'apr_tipo': 'Canal Abierto', 'apr_estado': 'R', 'apr_long': 6.00,
        'apr_ancho': 1.50, 'apr_altura': 1.80, 'apr_espes': 0.15,
        'reg_compu': 'no', 'reg_baran': 'no',
        'tan_naves': 1, 'tan_long': 23.20, 'tan_base': 5.00,
        'tan_altura': 1.80, 'tan_espes': 0.15,
        'eq_puente': 'no', 'eq_purga': 'si', 'eq_pnum': 1, 'eq_cnum': 1,
        'cam_otros': 'Tuberia de fondo.',
        'insp_concreto': 'no', 'insp_metal_cor': 'no',
        'insp_sedimento': 'no', 'insp_averia': 'no',
    }, 'desarenador')


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--tipo', default='tomas_canal_madre',
                   choices=sorted(TABLAS))
    p.add_argument('--ambito', default='PECH')
    p.add_argument('--campania', type=int)
    p.add_argument('--fid', type=int, help='una sola estructura')
    p.add_argument('--salida', default='.')
    p.add_argument('--esquemas', default='/opt/jurp-gis/esquemas')
    p.add_argument('--prueba', metavar='RUTA')
    args = p.parse_args()

    anio = args.campania or dt.date.today().year
    esquemas = buscar_esquemas(args.esquemas)

    if args.prueba:
        # Las dos hojas: la de las tomas y la generica. Se ven seguidas
        # porque el riesgo al tocar una es romper la otra sin notarlo.
        dibujar([FICHA_PRUEBA, FICHA_PRUEBA_CANOA,
                 FICHA_PRUEBA_ENTREGA, FICHA_PRUEBA_ALCANTARILLA,
                 FICHA_PRUEBA_ALIVIADERO, FICHA_PRUEBA_DESARENADOR,
                 FICHA_PRUEBA_GENERICA],
                args.prueba, anio, esquemas, {})
        print(f'escrito {args.prueba}')
        return 0

    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import reportes_ana as R

    fichas = leer_fichas(R, args.tipo, args.ambito, args.campania, args.fid)
    if not fichas:
        print(f'sin estructuras para {args.tipo} / {args.ambito}',
              file=sys.stderr)
        return 1

    os.makedirs(args.salida, exist_ok=True)
    import tempfile
    tmp = tempfile.mkdtemp()
    logos = extraer_logos(tmp)

    sufijo = f'_{args.campania}' if args.campania else ''
    if args.fid:
        sufijo += f'_{args.fid}'
    ruta = os.path.join(args.salida,
                        f'Fichas_Inspeccion_{args.tipo}_{args.ambito}{sufijo}.pdf')
    dibujar(fichas, ruta, anio, esquemas, logos)
    print(f'escrito {ruta} ({len(fichas)} fichas)')
    return 0


if __name__ == '__main__':
    sys.exit(main())
