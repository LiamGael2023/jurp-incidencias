#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
El Formato B-9 —el resumen del inventario— en PDF.

    python3 reportes_b9_pdf.py --ambito todos --salida /opt/jurp-gis/reportes
    python3 reportes_b9_pdf.py --prueba salida.pdf     # sin base de datos

POR QUE NO VA EN reportes_pdf.py
--------------------------------
Aquel dibuja cualquier formato tabular leyendo `columnas` de la
configuracion: una cabecera, una fila por activo. El B-9 no es eso. Es un
resumen de tres tablas distintas en una hoja, con celdas combinadas en
vertical —el nombre del subsector abarca las doce filas de laterales— y con
cada bloque alimentado por una consulta propia. Forzarlo en el motor
generico habria significado llenarlo de excepciones; aqui se dibuja tal como
sale el oficial.

LAS TRES TABLAS
---------------
Son las del formato de la ANA, en este orden:

  1. RESUMEN BOCATOMAS, TOMAS, CANALES PRINCIPALES Y SECUNDARIOS
  2. RESUMEN DE OBRAS DE ARTE
  3. RESUMEN DE RESERVORIOS

El generador en Excel de hoy solo arma la primera. Las otras dos se
dibujan aqui por primera vez.

LAS COMBINACIONES DE LA PRIMERA TABLA
-------------------------------------
El Sector Hidraulico Menor ocupa tantas filas como laterales tenga —una por
lateral de 1er orden y otra por lateral de 2do orden, lo que sea mayor—,
pero sus tomas y su canal principal son un solo dato para todo el bloque. En
el papel eso es una celda alta que abarca las doce filas; aqui son SPAN
verticales. Sin ellos el 22 de tomas laterales se repetiria doce veces y el
total dejaria de cuadrar a la vista.

EL TOTAL
--------
El TOTAL del formato oficial suma *todas* las columnas numericas, incluida
la del «Nº» correlativo: por eso en la hoja de referencia pone 78 bajo los
laterales de 1er orden, que es 1+2+...+12. Aqui el «Nº» del TOTAL es la
cuenta de laterales —12—, que es lo que esa columna dice que es. Las
columnas de denominacion van vacias y no con la suma de los numeros que
parezcan un numero.
"""

import argparse
import datetime as dt
import os
import shutil
import sys
import tempfile

from reportlab.lib import colors
from reportlab.lib.pagesizes import A3, landscape
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import (BaseDocTemplate, Frame, PageTemplate,
                                Paragraph, Spacer, Table, TableStyle)

# Los logos y su colocacion se comparten con los formatos tabulares: los dos
# modulos viven en la misma carpeta junto al generador.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
try:
    from reportes_pdf import dibujar_logos, extraer_logos
except ImportError:                                  # pragma: sin cobertura
    def extraer_logos(_):
        return {}

    def dibujar_logos(*_a, **_k):
        return None


# ── estilo ────────────────────────────────────────────────────────────────
# Los mismos azules que reportes_pdf.py: las dos salidas se archivan juntas.

AZUL_CABEZA = colors.HexColor('#D9E2F3')
AZUL_GRUPO = colors.HexColor('#BDD7EE')
GRIS_LINEA = colors.HexColor('#7F7F7F')

TITULO = ParagraphStyle('titulo', fontName='Helvetica-Bold', fontSize=9,
                        leading=11, alignment=1)
INSTIT = ParagraphStyle('instit', fontName='Helvetica', fontSize=6.5,
                        leading=8, alignment=1)
ROTULO = ParagraphStyle('rotulo', fontName='Helvetica', fontSize=7.5,
                        leading=11, alignment=0)
SUBTIT = ParagraphStyle('subtit', fontName='Helvetica-Bold', fontSize=7.5,
                        leading=10, alignment=0)
CABEZA = ParagraphStyle('cabeza', fontName='Helvetica-Bold', fontSize=5.4,
                        leading=6.4, alignment=1)
CELDA = ParagraphStyle('celda', fontName='Helvetica', fontSize=5.6,
                       leading=6.8, alignment=1)
CELDA_IZQ = ParagraphStyle('celda_izq', parent=CELDA, alignment=0)
CELDA_TOT = ParagraphStyle('celda_tot', parent=CELDA,
                           fontName='Helvetica-Bold')

MARGEN = 8 * mm


# ── la primera tabla ──────────────────────────────────────────────────────
# (titulo, peso). El peso es proporcional: lo que importa es el reparto del
# ancho util, no el numero.

T1_GRUPOS = [
    ('BOCATOMAS', 2, 4),
    ('TOMAS DIRECTAS CANAL MADRE PECH', 5, 7),
    ('TOMAS LATERALES', 8, 10),
    ('CANAL DE DERIVACION', 11, 14),
    ('CANAL PRINCIPAL', 15, 19),
    ('LATERAL DE 1<sup>er</sup> ORDEN', 20, 24),
    ('LATERAL DE 2<sup>do</sup> ORDEN', 25, 29),
]

T1_COLS = [
    ('Nombre del Sub sector<br/>Hidráulico', 26),
    ('Nº', 6), ('Permanente', 10), ('Rustica', 9),
    ('Nº', 6), ('Permanente', 10), ('Rustica', 9),
    ('Nº', 6), ('Permanente', 10), ('Rustica', 9),
    ('Nº', 6), ('Revestido<br/>(km.)', 10), ('Sin Revestir<br/>(km.)', 10),
    ('Total (km.)', 10),
    ('Nº', 6), ('Revestido<br/>(km.)', 10), ('Sin Revestir<br/>(km.)', 10),
    ('Total (km.)', 10), ('Denominación', 13),
    ('Nº', 6), ('Revestido<br/>(km.)', 10), ('Sin<br/>Revestir', 9),
    ('Total (km.)', 10), ('Denominación', 13),
    ('Nº', 6), ('Revestido<br/>(km.)', 10), ('Sin<br/>Revestir', 9),
    ('Total (km.)', 10), ('Denominación', 15),
]

# Donde empieza cada bloque de la primera tabla, para no contar a mano.
C_BOCA, C_TOMA_CM, C_TOMA_LAT = 1, 4, 7
C_DERIV, C_PRINC, C_ORD1, C_ORD2 = 10, 14, 19, 24


# ── la segunda ────────────────────────────────────────────────────────────
# `Puente` abarca dos columnas; el resto ocupa las dos filas de cabecera.

T2_COLS = [
    ('Nombre del Sub sector<br/>Hidráulico', 'nombre', 26),
    ('Alcantarilla', 'alcantarilla', 11),
    ('Canoas', 'canoas', 10),
    ('Vehicular', 'puente_vehicular', 10),
    ('Peatonal', 'puente_peatonal', 10),
    ('Desarenador', 'desarenador', 11),
    ('Aliviadero', 'aliviadero', 10),
    ('Partidor', 'partidor', 10),
    ('Entregas', 'entregas', 10),
    ('Sifon', 'sifon', 9),
    ('Disipador de<br/>Impacto', 'disipador', 11),
    ('Pases de<br/>Tuberias', 'pases_tuberias', 11),
    ('Cajas<br/>Hidraulicas', 'cajas_hidraulicas', 11),
    ('Otros', 'otros', 9),
]
T2_GRUPO_PUENTE = (3, 4)      # columnas 0-indexadas que cubre «Puente»


# ── la tercera ────────────────────────────────────────────────────────────

T3_COLS = [
    ('Nombre del Sub sector<br/>Hidráulico', 26),
    ('Nº', 8),
    ('Capacidad de<br/>Almacenamiento<br/>(hm<super>3</super>)', 16),
    ('Denominación', 22),
]


# ── valores ───────────────────────────────────────────────────────────────

def _n(v, dec=2):
    """Un numero de la base, listo para la celda.

    None y '' salen vacios y no 'None', que es lo que se veria si se dejara
    a str(). El cero si se escribe: en este formato un 0 significa «se
    revisó y no hay», que no es lo mismo que una celda en blanco.
    """
    if v is None or v == '':
        return ''
    try:
        return f'{float(v):,.{dec}f}'
    except (TypeError, ValueError):
        return str(v)


def _e(v):
    """Entero, o vacio."""
    if v is None or v == '':
        return ''
    try:
        return f'{int(float(v)):d}'
    except (TypeError, ValueError):
        return str(v)


def _p(txt, estilo=CELDA):
    return Paragraph(str(txt).replace('&', '&amp;').replace('<', '&lt;')
                     if ('<' in str(txt) and '<sup' not in str(txt)
                         and '<br' not in str(txt) and '<super' not in str(txt))
                     else str(txt), estilo)


def _anchos(pesos, ancho_util):
    total = float(sum(pesos)) or 1.0
    return [ancho_util * p / total for p in pesos]


# ── tabla 1 ───────────────────────────────────────────────────────────────

def _tabla_uno(datos, ancho_util):
    """Las dos filas de cabecera, el cuerpo y los SPAN verticales."""
    n = len(T1_COLS)
    f0 = [''] * n
    f1 = [''] * n
    ordenes = [('SPAN', (0, 0), (0, 1))]
    f0[0] = _p(T1_COLS[0][0], CABEZA)

    for titulo, c1, c2 in T1_GRUPOS:
        f0[c1 - 1] = _p(titulo, CABEZA)
        ordenes.append(('SPAN', (c1 - 1, 0), (c2 - 1, 0)))
        ordenes.append(('BACKGROUND', (c1 - 1, 0), (c2 - 1, 0), AZUL_GRUPO))
    for i, (nombre, _) in enumerate(T1_COLS):
        if i:
            f1[i] = _p(nombre, CABEZA)

    cuerpo = []
    mayor = datos.get('mayor') or {}
    menor = datos.get('menor') or {}

    def bloque(fila, col, valores, formato):
        for i, v in enumerate(valores or []):
            fila[col + i] = _p(formato(v) if not isinstance(v, str) else v)

    # ── el Sector Hidraulico Mayor: una sola fila ──
    if mayor:
        f = [''] * n
        f[0] = _p(mayor.get('nombre', ''), CELDA_IZQ)
        bloque(f, C_BOCA, mayor.get('bocatomas'), _e)
        bloque(f, C_TOMA_CM, mayor.get('tomas_cm'), _e)
        bloque(f, C_DERIV, mayor.get('derivacion'), _n)
        # El Nº de la derivacion es una cuenta, no un kilometraje.
        if mayor.get('derivacion'):
            f[C_DERIV] = _p(_e(mayor['derivacion'][0]))
        cuerpo.append(f)
        fila_mayor = 1

    # ── el Sector Hidraulico Menor: tantas filas como laterales ──
    ord1 = menor.get('orden1') or []
    ord2 = menor.get('orden2') or []
    altura = max(len(ord1), len(ord2), 1)
    inicio = len(cuerpo) + 2            # +2 por las dos filas de cabecera

    for i in range(altura):
        f = [''] * n
        if i == 0:
            f[0] = _p(menor.get('nombre', ''), CELDA)
            bloque(f, C_TOMA_LAT, menor.get('tomas_lat'), _e)
            if menor.get('principal'):
                pr = menor['principal']
                f[C_PRINC] = _p(_e(pr[0]))
                for k, v in enumerate(pr[1:4]):
                    f[C_PRINC + 1 + k] = _p(_n(v))
                f[C_PRINC + 4] = _p(pr[4] if len(pr) > 4 else '')
        if i < len(ord1):
            rev, sin, tot, den = ord1[i]
            f[C_ORD1] = _p(_e(i + 1))
            f[C_ORD1 + 1] = _p(_n(rev))
            f[C_ORD1 + 2] = _p(_n(sin))
            f[C_ORD1 + 3] = _p(_n(tot))
            f[C_ORD1 + 4] = _p(den or '')
        if i < len(ord2):
            rev, sin, tot, den = ord2[i]
            f[C_ORD2] = _p(_e(i + 1))
            f[C_ORD2 + 1] = _p(_n(rev))
            f[C_ORD2 + 2] = _p(_n(sin))
            f[C_ORD2 + 3] = _p(_n(tot))
            f[C_ORD2 + 4] = _p(den or '')
        cuerpo.append(f)

    fin = inicio + altura - 1
    if altura > 1:
        # Todo lo que no sea un lateral es un solo dato para el bloque
        # entero: una celda alta, como en el papel. Si no se combinan, los
        # bloques que no aplican al subsector menor —bocatomas, tomas del
        # canal madre, derivacion— salen como doce casillas vacias en fila,
        # que se leen como doce registros en blanco y no como «aqui no va
        # nada».
        for col in ([0]
                    + list(range(C_BOCA, C_BOCA + 3))
                    + list(range(C_TOMA_CM, C_TOMA_CM + 3))
                    + list(range(C_TOMA_LAT, C_TOMA_LAT + 3))
                    + list(range(C_DERIV, C_DERIV + 4))
                    + list(range(C_PRINC, C_PRINC + 5))):
            ordenes.append(('SPAN', (col, inicio), (col, fin)))

    # ── TOTAL ──
    tot = [''] * n
    tot[0] = _p('TOTAL', CELDA_TOT)

    def suma(col, valores, enteros=False):
        if not valores:
            return
        for i, v in enumerate(valores):
            if isinstance(v, str):
                continue
            tot[col + i] = _p(_e(v) if enteros else _n(v), CELDA_TOT)

    suma(C_BOCA, mayor.get('bocatomas'), True)
    suma(C_TOMA_CM, mayor.get('tomas_cm'), True)
    suma(C_TOMA_LAT, menor.get('tomas_lat'), True)
    if mayor.get('derivacion'):
        d = mayor['derivacion']
        tot[C_DERIV] = _p(_e(d[0]), CELDA_TOT)
        for k, v in enumerate(d[1:4]):
            tot[C_DERIV + 1 + k] = _p(_n(v), CELDA_TOT)
    if menor.get('principal'):
        pr = menor['principal']
        tot[C_PRINC] = _p(_e(pr[0]), CELDA_TOT)
        for k, v in enumerate(pr[1:4]):
            tot[C_PRINC + 1 + k] = _p(_n(v), CELDA_TOT)
    for col, lista in ((C_ORD1, ord1), (C_ORD2, ord2)):
        if not lista:
            continue
        tot[col] = _p(_e(len(lista)), CELDA_TOT)
        for k in range(3):
            tot[col + 1 + k] = _p(
                _n(sum(float(f[k] or 0) for f in lista)), CELDA_TOT)

    cuerpo.append(tot)
    ultima = len(cuerpo) + 1

    tabla = Table([f0, f1] + cuerpo, colWidths=_anchos([c[1] for c in T1_COLS],
                                                       ancho_util),
                  repeatRows=2)
    tabla.setStyle(TableStyle([
        ('GRID', (0, 0), (-1, -1), 0.25, GRIS_LINEA),
        ('BACKGROUND', (0, 0), (-1, 1), AZUL_CABEZA),
        ('BACKGROUND', (0, ultima), (-1, ultima), AZUL_CABEZA),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('LEFTPADDING', (0, 0), (-1, -1), 1.5),
        ('RIGHTPADDING', (0, 0), (-1, -1), 1.5),
        ('TOPPADDING', (0, 0), (-1, -1), 2),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 2),
    ] + ordenes))
    return tabla


# ── tabla 2 ───────────────────────────────────────────────────────────────

def _tabla_dos(datos, ancho_util):
    obras = datos.get('obras') or {}
    nombre = (datos.get('menor') or {}).get('nombre', '')

    n = len(T2_COLS)
    f0 = [''] * n
    f1 = [''] * n
    ordenes = []
    pv, pp = T2_GRUPO_PUENTE
    f0[pv] = _p('Puente', CABEZA)
    ordenes.append(('SPAN', (pv, 0), (pp, 0)))
    ordenes.append(('BACKGROUND', (pv, 0), (pp, 0), AZUL_GRUPO))
    f1[pv] = _p(T2_COLS[pv][0], CABEZA)
    f1[pp] = _p(T2_COLS[pp][0], CABEZA)
    for i, (titulo, _, _) in enumerate(T2_COLS):
        if i in (pv, pp):
            continue
        f0[i] = _p(titulo, CABEZA)
        ordenes.append(('SPAN', (i, 0), (i, 1)))

    fila = [_p(nombre, CELDA)] + [
        _p(_e(obras.get(clave, 0))) for _, clave, _ in T2_COLS[1:]]
    total = [_p('TOTAL', CELDA_TOT)] + [
        _p(_e(obras.get(clave, 0)), CELDA_TOT) for _, clave, _ in T2_COLS[1:]]

    tabla = Table([f0, f1, fila, total],
                  colWidths=_anchos([c[2] for c in T2_COLS], ancho_util),
                  hAlign='LEFT')
    tabla.setStyle(TableStyle([
        ('GRID', (0, 0), (-1, -1), 0.25, GRIS_LINEA),
        ('BACKGROUND', (0, 0), (-1, 1), AZUL_CABEZA),
        ('BACKGROUND', (0, 3), (-1, 3), AZUL_CABEZA),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('TOPPADDING', (0, 0), (-1, -1), 2),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 2),
    ] + ordenes))
    return tabla


# ── tabla 3 ───────────────────────────────────────────────────────────────

def _tabla_tres(datos, ancho_util):
    reservorios = datos.get('reservorios') or []
    nombre = (datos.get('menor') or {}).get('nombre', '')

    f0 = ['', _p('Reservorios', CABEZA), '', '']
    f1 = [_p(T3_COLS[0][0], CABEZA)] + [_p(c[0], CABEZA) for c in T3_COLS[1:]]
    ordenes = [
        ('SPAN', (1, 0), (3, 0)),
        ('BACKGROUND', (1, 0), (3, 0), AZUL_GRUPO),
        ('SPAN', (0, 0), (0, 1)),
    ]
    f0[0] = f1[0]
    f1[0] = ''

    cuerpo = []
    for i, (capacidad, denominacion) in enumerate(reservorios):
        cuerpo.append(['', _p(_e(i + 1)), _p(_n(capacidad, 3)),
                       _p(denominacion or '', CELDA_IZQ)])
    if not cuerpo:
        cuerpo.append(['', '', '', ''])
    cuerpo[0][0] = _p(nombre, CELDA)
    if len(cuerpo) > 1:
        ordenes.append(('SPAN', (0, 2), (0, len(cuerpo) + 1)))

    total = [_p('TOTAL', CELDA_TOT), '',
             _p(_n(sum(float(r[0] or 0) for r in reservorios), 3), CELDA_TOT),
             '']
    fin = len(cuerpo) + 2

    tabla = Table([f0, f1] + cuerpo + [total],
                  colWidths=_anchos([c[1] for c in T3_COLS], ancho_util),
                  hAlign='LEFT')
    tabla.setStyle(TableStyle([
        ('GRID', (0, 0), (-1, -1), 0.25, GRIS_LINEA),
        ('BACKGROUND', (0, 0), (-1, 1), AZUL_CABEZA),
        ('BACKGROUND', (0, fin), (-1, fin), AZUL_CABEZA),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('TOPPADDING', (0, 0), (-1, -1), 2),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 2),
    ] + ordenes))
    return tabla


# ── la hoja ───────────────────────────────────────────────────────────────

def dibujar(datos, ruta, ambito='todos', campania=None, cabecera=None,
            logos=None):
    pagina = landscape(A3)
    ancho = pagina[0] - 2 * MARGEN

    doc = BaseDocTemplate(
        ruta, pagesize=pagina,
        leftMargin=MARGEN, rightMargin=MARGEN,
        topMargin=MARGEN, bottomMargin=12 * mm,
        title='Formato B-9.- Resumen del Inventario de Infraestructura '
              'Hidráulica', author='JURP')

    def adorno(canvas, documento):
        canvas.saveState()
        # Los mismos logos y la misma colocacion que los formatos tabulares:
        # las catorce hojas se archivan juntas y tienen que verse iguales.
        dibujar_logos(canvas, pagina, logos, MARGEN)
        canvas.setFont('Helvetica', 6)
        canvas.setFillColor(colors.HexColor('#666666'))
        sello = dt.datetime.now().strftime('%d/%m/%Y %H:%M')
        canvas.drawString(MARGEN, 7 * mm,
                          'Junta de Riego Presurizado Moche Virú Chao · '
                          f'ámbito {ambito}'
                          + (f' · campaña {campania}' if campania
                             else ' · inventario base'))
        canvas.drawRightString(pagina[0] - MARGEN, 7 * mm,
                               f'Generado {sello} · página {documento.page}')
        canvas.restoreState()

    marco = Frame(MARGEN, 12 * mm, ancho, pagina[1] - MARGEN - 12 * mm,
                  leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
    doc.addPageTemplates([PageTemplate(id='hoja', frames=[marco],
                                       onPage=adorno)])

    cab = cabecera or {}
    historia = [
        Spacer(1, 2 * mm),
        Paragraph('Formato B-9.- Resumen del Inventario de Infraestructura '
                  'Hidráulica', TITULO),
    ]
    for k in ('ministerio', 'autoridad', 'aaa', 'ala'):
        if cab.get(k):
            historia.append(Paragraph(cab[k], INSTIT))
    historia.append(Spacer(1, 6))
    historia.append(Paragraph(
        f"<b>Nombre del Sector Hidráulico:</b> {datos.get('sector', '')}",
        ROTULO))
    historia.append(Paragraph(
        f"<b>Nombre del Operador:</b> {datos.get('operador', '')}", ROTULO))
    historia.append(Spacer(1, 6))

    historia.append(Paragraph(
        'RESUMEN BOCATOMAS, TOMAS, CANALES PRINCIPALES Y SECUNDARIOS', SUBTIT))
    historia.append(Spacer(1, 3))
    historia.append(_tabla_uno(datos, ancho))

    # Las dos tablas chicas no se estiran a lo ancho de la hoja: en el
    # formato oficial ocupan su propio ancho, pegadas al margen izquierdo.
    historia.append(Spacer(1, 7 * mm))
    historia.append(Paragraph('RESUMEN DE OBRAS DE ARTE', SUBTIT))
    historia.append(Spacer(1, 3))
    historia.append(_tabla_dos(datos, ancho * 0.60))

    historia.append(Spacer(1, 7 * mm))
    historia.append(Paragraph('RESUMEN DE RESERVORIOS', SUBTIT))
    historia.append(Spacer(1, 3))
    historia.append(_tabla_tres(datos, ancho * 0.28))

    doc.build(historia)
    return ruta


# ── prueba sin base de datos ──────────────────────────────────────────────
# Son los numeros de la hoja de referencia (FB9_Resumen.pdf, junio 2025):
# sirven para comprobar el dibujo sin levantar nada.

DATOS_PRUEBA = {
    'sector': 'Sector Hidráulico Menor Riego Presurizado Moche Virú Chao',
    'operador': 'Junta de Usuarios de agua del Sector Hidráulico Menor Riego '
                'Presurizado Moche Viru Chao',
    'mayor': {
        'nombre': 'Sector Hidráulico Mayor CHAVIMOCHIC',
        'bocatomas': None,
        'tomas_cm': (57, 57, 0),
        'derivacion': (1, 155, 0, 155),
    },
    'menor': {
        'nombre': 'Sector Hidráulico Menor Riego Presurizado Moche Viru Chao',
        'tomas_lat': (22, 0, 22),
        'principal': (1, 20.05, 0, 20.05, 'Lateral 10'),
        'orden1': [
            (0.33, 0.00, 0.33, '10.1A'), (0.25, 0.00, 0.25, '10.2'),
            (0.45, 0.00, 0.45, '10.2A'), (1.63, 0.00, 1.63, '10.3'),
            (0.51, 0.00, 0.51, '10.3A'), (1.60, 0.00, 1.60, '10.4'),
            (1.81, 0.00, 1.81, '10.4 A'), (5.36, 0.00, 5.36, '10.5'),
            (1.10, 0.00, 1.10, '10.5A'), (4.72, 0.00, 4.72, '10.6'),
            (5.95, 0.00, 5.95, '10.7'), (7.33, 0.00, 7.33, 'Canal Evacuador'),
        ],
        'orden2': [
            (1.31, 0.00, 1.31, '10.5 Ramal I'),
            (1.60, 0.00, 1.60, '10.5 Ramal II'),
            (2.75, 0.00, 2.75, '10.5 Ramal III'),
            (0.48, 0.00, 0.48, '10.5 CH14'),
            (0.91, 0.00, 0.91, '10.5 Ramal IV'),
            (0.92, 0.00, 0.92, '10.5 Ramal IV'),
            (0.14, 0.00, 0.14, '10.5 CH20'),
            (1.25, 0.00, 1.25, '10.6 Ramal I'),
            (4.19, 0.00, 4.19, '10.6 Ramal II'),
            (0.71, 0.00, 0.71, '10.7 Ramal I'),
            (0.64, 0.00, 0.64, '10.7 CH12'),
            (0.90, 0.00, 0.90, '10.7 Ramal II'),
        ],
    },
    'obras': {
        'alcantarilla': 4, 'canoas': 8, 'puente_vehicular': 7,
        'puente_peatonal': 2, 'desarenador': 18, 'aliviadero': 2,
        'partidor': 1, 'entregas': 6, 'sifon': 2, 'disipador': 1,
        'pases_tuberias': 10, 'cajas_hidraulicas': 210, 'otros': 8,
    },
    'reservorios': [
        (0.004, 'SED 10.2'), (0.002, 'SED 10.2 - A'), (0.006, 'SED 10.3'),
        (0.009, 'SED 10.3 - A'), (0.013, 'SED 10.4'), (0.012, 'SED 10.4 - A'),
        (0.034, 'SED 10.5'), (0.012, 'SED 10.5 - A'), (0.034, 'SED 10.6-7'),
        (0.089, 'RES 10.6-7'),
    ],
}

CABECERA_PRUEBA = {
    'ministerio': 'Ministerio de Desarrollo Agrario y Riego',
    'autoridad': 'Autoridad Nacional del Agua',
    'aaa': 'Autoridad Administrativa del Agua',
    'ala': 'Administración Local del Agua',
}


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--ambito', default='todos')
    p.add_argument('--campania', type=int)
    p.add_argument('--salida', default='.')
    p.add_argument('--prueba', metavar='RUTA',
                   help='dibuja la hoja de referencia, sin tocar la base')
    args = p.parse_args()

    tmp = tempfile.mkdtemp(prefix='logos_ana_')
    try:
        return _generar(args, extraer_logos(tmp))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def _generar(args, logos):
    if args.prueba:
        dibujar(DATOS_PRUEBA, args.prueba, 'todos',
                cabecera=CABECERA_PRUEBA, logos=logos)
        print(f'escrito {args.prueba}')
        return 0

    import reportes_ana as R                       # noqa: F401
    from reportes_b9_datos import leer_datos       # noqa: F401

    datos = leer_datos(R, args.ambito, args.campania)
    if datos is None:
        print('la consulta fallo', file=sys.stderr)
        return 1

    os.makedirs(args.salida, exist_ok=True)
    sufijo = f'_{args.campania}' if args.campania else ''
    ruta = os.path.join(args.salida, f'FB9_Resumen_{args.ambito}{sufijo}.pdf')
    dibujar(datos, ruta, args.ambito, args.campania,
            cabecera=getattr(R, 'CABECERA', CABECERA_PRUEBA), logos=logos)
    print(f'escrito {ruta}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
