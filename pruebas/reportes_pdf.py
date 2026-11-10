#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Los formatos de la ANA, en PDF.

    python3 reportes_pdf.py --formato B-1.A --ambito JURP --salida /opt/jurp-gis/reportes
    python3 reportes_pdf.py --prueba salida.pdf      # sin base de datos

Va junto a reportes_ana.py, en /opt/jurp-gis/, y le pide prestada la
configuración: la lista de columnas, sus anchos y los grupos de cabecera son
los mismos que arman el Excel. Añadir una columna allí la añade aquí sin
tocar nada.

POR QUÉ NO SE CONVIERTE EL EXCEL
---------------------------------
Sería lo cómodo, pero convertir xlsx a PDF con fidelidad necesita
LibreOffice, y en el contenedor no está —ni cabe: son setecientos megas por
un formato que ya sabemos dibujar—. Con reportlab, que sí está, el PDF se
dibuja de los mismos datos y además se controla el apaisado, que en estos
formatos importa: el B-1.A son veintinueve columnas.

LA CABECERA DE TRES PISOS
-------------------------
Los formatos de la ANA agrupan columnas: «Toma Lateral» abarca de la 2 a la
20, y dentro «Localización» de la 4 a la 8. Eso se dibuja como tres filas
con celdas combinadas, igual que en el papel. Una columna sin grupo ocupa
las tres filas de alto; con grupo pero sin subgrupo, las dos últimas.

Sin esa estructura las columnas se leen solas y el formato deja de parecerse
al oficial, que es justo lo que se entrega.
"""

import argparse
import datetime as dt
import os
import sys

from reportlab.lib import colors
from reportlab.lib.pagesizes import A3, landscape
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import (BaseDocTemplate, Frame, PageTemplate,
                                Paragraph, Spacer, Table, TableStyle)


# ── estilo ────────────────────────────────────────────────────────────────

AZUL_CABEZA = colors.HexColor('#D9E2F3')
AZUL_GRUPO = colors.HexColor('#BDD7EE')
GRIS_LINEA = colors.HexColor('#7F7F7F')

TITULO = ParagraphStyle('titulo', fontName='Helvetica-Bold', fontSize=9,
                        leading=11, alignment=1)
INSTIT = ParagraphStyle('instit', fontName='Helvetica', fontSize=6.5,
                        leading=8, alignment=1)
SUBTIT = ParagraphStyle('subtit', fontName='Helvetica-Bold', fontSize=7.5,
                        leading=10, alignment=1)
CABEZA = ParagraphStyle('cabeza', fontName='Helvetica-Bold', fontSize=5.2,
                        leading=6.2, alignment=1)
CELDA = ParagraphStyle('celda', fontName='Helvetica', fontSize=5,
                       leading=6, alignment=1)
CELDA_IZQ = ParagraphStyle('celda_izq', parent=CELDA, alignment=0)

MARGEN = 8 * mm


# ── formato de valores ────────────────────────────────────────────────────

def _texto(valor, tipo, progresiva):
    """Un valor de la base, tal como va en la celda.

    Los tipos son los mismos que declara la configuración del Excel —int,
    num2, num3, coord, prog— para que las dos salidas digan lo mismo. Un
    None se escribe vacío y no 'None', que es lo que se vería si se dejara
    a str().
    """
    if valor is None or valor == '':
        return ''
    try:
        if tipo == 'int':
            return f'{int(float(valor)):d}'
        if tipo == 'num2':
            return f'{float(valor):,.2f}'
        if tipo == 'num3':
            return f'{float(valor):,.3f}'
        if tipo == 'coord':
            return f'{float(valor):,.2f}'
        if tipo == 'prog' and progresiva:
            return progresiva(valor) or ''
    except (TypeError, ValueError):
        # Un campo declarado numérico que trae texto no debe tumbar el
        # reporte entero: se escribe tal cual y se ve en el PDF.
        pass
    return str(valor)


# ── la cabecera de tres pisos ─────────────────────────────────────────────

def _cabecera(cols, grupos, subgrupos):
    """Las tres filas de encabezado y los SPAN que las combinan.

    Devuelve (filas, ordenes). Las columnas van 1-indexadas en la
    configuración, como en Excel; aquí se pasan a 0 para reportlab.
    """
    n = len(cols)
    f0 = [''] * n
    f1 = [''] * n
    f2 = [''] * n
    ordenes = []

    de_grupo = {}
    for titulo, c1, c2 in grupos:
        f0[c1 - 1] = Paragraph(titulo, CABEZA)
        ordenes.append(('SPAN', (c1 - 1, 0), (c2 - 1, 0)))
        ordenes.append(('BACKGROUND', (c1 - 1, 0), (c2 - 1, 0), AZUL_GRUPO))
        for i in range(c1 - 1, c2):
            de_grupo[i] = True

    de_sub = {}
    for titulo, c1, c2 in subgrupos:
        f1[c1 - 1] = Paragraph(titulo, CABEZA)
        ordenes.append(('SPAN', (c1 - 1, 1), (c2 - 1, 1)))
        for i in range(c1 - 1, c2):
            de_sub[i] = True

    for i, (nombre, _, _, _) in enumerate(cols):
        p = Paragraph(nombre, CABEZA)
        if de_sub.get(i):
            f2[i] = p                       # grupo · subgrupo · nombre
        elif de_grupo.get(i):
            f1[i] = p                       # grupo · nombre (dos filas)
            ordenes.append(('SPAN', (i, 1), (i, 2)))
        else:
            f0[i] = p                       # nombre solo (tres filas)
            ordenes.append(('SPAN', (i, 0), (i, 2)))

    # Un subgrupo sin grupo encima: su celda se estira hacia arriba para que
    # no quede una fila vacía sobre él.
    for titulo, c1, c2 in subgrupos:
        if not de_grupo.get(c1 - 1):
            ordenes.append(('SPAN', (c1 - 1, 0), (c2 - 1, 1)))
            f0[c1 - 1] = f1[c1 - 1]
            f1[c1 - 1] = ''

    return [f0, f1, f2], ordenes


# ── dibujo ────────────────────────────────────────────────────────────────

def dibujar(cfg, filas, ruta, ambito, campania=None, cabecera=None,
            progresiva=None):
    cols = cfg['columnas']
    grupos = cfg.get('grupos') or []
    subgrupos = cfg.get('subgrupos') or []

    pagina = landscape(A3)
    ancho = pagina[0] - 2 * MARGEN

    # Los anchos de la configuración están en «caracteres» de Excel. Lo que
    # importa es la proporción: se reparte el ancho útil de la página.
    pesos = [c[2] or 8 for c in cols]
    total = float(sum(pesos)) or 1.0
    anchos = [ancho * p / total for p in pesos]

    doc = BaseDocTemplate(
        ruta, pagesize=pagina,
        leftMargin=MARGEN, rightMargin=MARGEN,
        topMargin=MARGEN, bottomMargin=12 * mm,
        title=cfg.get('titulo', ''), author='JURP',
    )

    def pie(canvas, documento):
        canvas.saveState()
        canvas.setFont('Helvetica', 6)
        canvas.setFillColor(colors.HexColor('#666666'))
        sello = dt.datetime.now().strftime('%d/%m/%Y %H:%M')
        canvas.drawString(MARGEN, 7 * mm,
                          f'Junta de Riego Presurizado Moche Virú Chao · '
                          f'ámbito {ambito}'
                          + (f' · campaña {campania}' if campania else
                             ' · inventario base'))
        canvas.drawRightString(pagina[0] - MARGEN, 7 * mm,
                               f'Generado {sello} · página {documento.page}')
        canvas.restoreState()

    marco = Frame(MARGEN, 12 * mm, ancho, pagina[1] - MARGEN - 12 * mm,
                  leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
    doc.addPageTemplates([PageTemplate(id='hoja', frames=[marco], onPage=pie)])

    cab = cabecera or {}
    historia = [Paragraph(cfg.get('titulo', ''), TITULO)]
    for k in ('ministerio', 'autoridad', 'aaa', 'ala'):
        if cab.get(k):
            historia.append(Paragraph(cab[k], INSTIT))
    historia.append(Spacer(1, 3))
    historia.append(Paragraph(cfg.get('subtitulo', ''), SUBTIT))
    historia.append(Spacer(1, 4))

    cabeceras, ordenes = _cabecera(cols, grupos, subgrupos)

    cuerpo = []
    for fila in filas:
        linea = []
        for valor, (_, _, _, tipo) in zip(fila, cols):
            txt = _texto(valor, tipo, progresiva)
            # El texto largo se alinea a la izquierda: centrado, un nombre
            # de tres renglones queda escalonado y cuesta leerlo.
            estilo = CELDA_IZQ if (tipo is None and len(txt) > 18) else CELDA
            linea.append(Paragraph(txt.replace('&', '&amp;')
                                   .replace('<', '&lt;'), estilo))
        cuerpo.append(linea)

    tabla = Table(cabeceras + cuerpo, colWidths=anchos, repeatRows=3)
    estilo = TableStyle([
        ('GRID', (0, 0), (-1, -1), 0.25, GRIS_LINEA),
        ('BACKGROUND', (0, 0), (-1, 2), AZUL_CABEZA),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('LEFTPADDING', (0, 0), (-1, -1), 1.5),
        ('RIGHTPADDING', (0, 0), (-1, -1), 1.5),
        ('TOPPADDING', (0, 0), (-1, -1), 1),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 1),
        # Una franja cada dos filas: con treinta columnas, seguir un renglón
        # de punta a punta sin eso es perder la línea a media hoja.
        ('ROWBACKGROUNDS', (0, 3), (-1, -1),
         [colors.white, colors.HexColor('#F2F6FB')]),
    ] + ordenes)
    tabla.setStyle(estilo)
    historia.append(tabla)

    doc.build(historia)
    return ruta


# ── datos ─────────────────────────────────────────────────────────────────

def filas_para(R, clave, cfg, ambito, campania, evaluables):
    """La misma consulta que arma el Excel.

    Se repite aquí en vez de llamarse a `generar()` porque aquella función
    consulta y escribe el .xlsx en el mismo paso. Si se toca la consulta
    allí —un filtro nuevo de campaña, otra forma de resolver las
    evaluaciones— hay que tocarla aquí: ver `generar()` en reportes_ana.py.
    """
    cols = cfg['columnas']
    tipo = cfg.get('tipo')
    evals = (evaluables or {}).get(tipo, {}) if campania else {}

    seleccion = []
    for _, sql_campo, _, _ in cols:
        clave_campo = sql_campo.strip('"')
        if clave_campo in evals:
            seleccion.append(R.expresion_con_evaluacion(sql_campo,
                                                        evals[clave_campo]))
        else:
            seleccion.append(sql_campo)

    condiciones = []
    if ambito:
        condiciones.append(f"a.ambito = '{ambito}'")

    if campania:
        join = f"""
        LEFT JOIN LATERAL (
            SELECT e.valores
            FROM inventario.evaluaciones e
            JOIN inventario.campanias c ON c.id = e.campania_id
            WHERE e.tipo_activo = '{tipo}' AND e.activo_fid = a.fid
              AND c.anio <= {campania}
            ORDER BY c.anio DESC LIMIT 1
        ) ev ON true"""
        condiciones.append(f'a.campania_alta <= {campania}')
        condiciones.append(
            f'(a.campania_baja IS NULL OR a.campania_baja > {campania})')
    else:
        join = ''

    where = ('WHERE ' + ' AND '.join(condiciones)) if condiciones else ''
    return R.consultar(
        f"SELECT {', '.join(seleccion)} FROM {cfg['tabla']} a {join} {where} "
        f"ORDER BY a.{cfg['orden']};")


def nombre_archivo(cfg, ambito, campania):
    sufijo = f'_{campania}' if campania else ''
    return f"{cfg['archivo']}_{ambito}{sufijo}.pdf"


# ── prueba sin base de datos ──────────────────────────────────────────────

CFG_PRUEBA = {
    'archivo': 'PRUEBA',
    'titulo': 'Formato B-1.A.- Inventario de Tomas Laterales',
    'subtitulo': 'INVENTARIO DE TOMAS LATERALES CANAL LATERAL 10',
    'grupos': [('Toma Lateral', 2, 8), ('Compuertas', 9, 11)],
    'subgrupos': [('Localización', 4, 6)],
    'columnas': [
        ('N°', 'n_', 5, 'int'),
        ('Nombre', 'nombre', 14, None),
        ('Progresiva', 'progresiva', 11, 'prog'),
        ('Zona', 'zona', 5, 'int'),
        ('Norte', 'norte', 13, 'coord'),
        ('Este', 'este', 12, 'coord'),
        ('Margen (D o I)', 'margen', 8, None),
        ('Material', 'material', 9, None),
        ('Ancho (m)', 'ancho', 8, 'num2'),
        ('Alto (m)', 'alto', 8, 'num2'),
        ('Estado', 'estado', 8, None),
    ],
}

FILAS_PRUEBA = [
    [1, 'Toma intercuencas del sector alto', 36130, 17, 9041598.28, 765353.78,
     'D', 'Concreto', 1.4, 0.8, 'Bueno'],
    [2, 'Toma 2', None, 17, 9041000.5, 765000.0, 'I', 'Concreto', 0.9, 0.6, 'Regular'],
    [3, 'Toma sin dato', 12005, 17, 9040500.0, 764800.25, 'D', None, None, None, 'Malo'],
]


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--formato')
    p.add_argument('--ambito', default='JURP')
    p.add_argument('--campania', type=int)
    p.add_argument('--salida', default='.')
    p.add_argument('--prueba', metavar='RUTA',
                   help='dibuja una tabla de ejemplo, sin tocar la base')
    args = p.parse_args()

    if args.prueba:
        dibujar(CFG_PRUEBA, FILAS_PRUEBA, args.prueba, 'JURP',
                cabecera={'ministerio': 'Ministerio de Desarrollo Agrario y Riego',
                          'autoridad': 'Autoridad Nacional del Agua',
                          'aaa': 'Autoridad Administrativa del Agua',
                          'ala': 'Administración Local del Agua'},
                progresiva=lambda v: f'{int(v) // 1000}+{int(v) % 1000:03d}')
        print(f'escrito {args.prueba}')
        return 0

    if not args.formato:
        p.error('hace falta --formato o --prueba')

    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import reportes_ana as R

    cfg = R.FORMATOS.get(args.formato)
    if not cfg:
        print(f'formato desconocido: {args.formato}', file=sys.stderr)
        return 1

    # El B-9 no tiene columnas: lo arma su propia función, por bloques.
    if 'columnas' not in cfg:
        print(f'{args.formato} no es tabular; no se dibuja aqui',
              file=sys.stderr)
        return 1

    evaluables = R.campos_evaluables() if args.campania else None
    filas = filas_para(R, args.formato, cfg, args.ambito, args.campania,
                       evaluables)
    if filas is None:
        print('la consulta fallo', file=sys.stderr)
        return 1
    if not filas:
        print(f'  {args.formato}: sin registros para el ambito {args.ambito}')
        return 1

    os.makedirs(args.salida, exist_ok=True)
    ruta = os.path.join(args.salida,
                        nombre_archivo(cfg, args.ambito, args.campania))
    dibujar(cfg, filas, ruta, args.ambito, args.campania,
            cabecera=getattr(R, 'CABECERA', {}),
            progresiva=getattr(R, 'progresiva', None))
    print(f'escrito {ruta}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
