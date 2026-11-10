#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
El Formato B-9 completo, en Excel.

    python3 reportes_b9_excel.py --ambito todos --salida /opt/jurp-gis/reportes
    python3 reportes_b9_excel.py --prueba salida.xlsx    # sin base de datos

POR QUE NO SE ARREGLA generar_b9() EN SU SITIO
----------------------------------------------
Porque entonces habria dos lecturas distintas del mismo formato: la del
Excel y la de `reportes_b9_datos`, que es la que usa el PDF. Ya ocurrio una
vez --el Excel pone las tomas laterales en la fila del sector mayor, deja
vacios los dos canales y del 2do orden solo escribe la denominacion-- y
cada diferencia hay que descubrirla comparando dos hojas a mano.

Aqui el Excel y el PDF salen de la misma funcion `leer_datos`, con las
mismas columnas declaradas en `reportes_b9_pdf`. Si manana cambia una
consulta, cambian los dos. Y las tres tablas del formato oficial estan en
los dos, que es lo que faltaba: el generador de hoy solo arma la primera.

DIFERENCIAS CON LA HOJA DE HOY
------------------------------
  1. Las TOMAS LATERALES bajan al Sector Hidraulico Menor, que es de donde
     son: el Lateral 10.
  2. CANAL DE DERIVACION y CANAL PRINCIPAL se llenan.
  3. El LATERAL DE 2do ORDEN ocupa sus cinco columnas y no una.
  4. Se anaden RESUMEN DE OBRAS DE ARTE y RESUMEN DE RESERVORIOS.
"""

import argparse
import os
import sys

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from reportes_b9_pdf import (  # noqa: E402
    C_BOCA, C_DERIV, C_ORD1, C_ORD2, C_PRINC, C_TOMA_CM, C_TOMA_LAT,
    CABECERA_PRUEBA, DATOS_PRUEBA, T1_COLS, T1_GRUPOS, T2_COLS,
    T2_GRUPO_PUENTE, T3_COLS)


# ── estilo ────────────────────────────────────────────────────────────────
# Los mismos azules del PDF: las dos salidas se archivan juntas y conviene
# que se reconozcan como la misma hoja.

F_TITULO = Font(name='Arial', size=11, bold=True)
F_INSTIT = Font(name='Arial', size=8)
F_SUBTIT = Font(name='Arial', size=9, bold=True)
F_ETIQ = Font(name='Arial', size=9, bold=True)
F_CABEZA = Font(name='Arial', size=7, bold=True)
F_DATO = Font(name='Arial', size=8)
F_TOTAL = Font(name='Arial', size=8, bold=True)

FILL_CABEZA = PatternFill('solid', fgColor='D9E2F3')
FILL_GRUPO = PatternFill('solid', fgColor='BDD7EE')

_fino = Side(style='thin', color='7F7F7F')
BORDE = Border(left=_fino, right=_fino, top=_fino, bottom=_fino)

CENTRO = Alignment(horizontal='center', vertical='center', wrap_text=True)
IZQ = Alignment(horizontal='left', vertical='center', wrap_text=True)


def _celda(ws, fila, col, valor=None, fuente=F_DATO, alineacion=CENTRO,
           relleno=None, formato=None):
    c = ws.cell(row=fila, column=col)
    if valor not in (None, ''):
        c.value = valor
    c.font = fuente
    c.alignment = alineacion
    c.border = BORDE
    if relleno:
        c.fill = relleno
    if formato:
        c.number_format = formato
    return c


def _num(v):
    """El valor como numero cuando lo es, para que Excel pueda sumarlo."""
    if v in (None, ''):
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return v


def _cabecera_hoja(ws, ncol, titulo, cabecera, datos, fila=1):
    """El membrete: formato, institución, sector y operador."""
    ultima = get_column_letter(ncol)
    lineas = [(titulo, F_TITULO)]
    for k in ('ministerio', 'autoridad', 'aaa', 'ala'):
        if (cabecera or {}).get(k):
            lineas.append((cabecera[k], F_INSTIT))
    for texto, fuente in lineas:
        ws.merge_cells(f'A{fila}:{ultima}{fila}')
        c = ws.cell(row=fila, column=1, value=texto)
        c.font = fuente
        c.alignment = CENTRO
        fila += 1

    fila += 1
    for etiqueta, clave in (('Nombre del Sector Hidráulico', 'sector'),
                            ('Nombre del Operador', 'operador')):
        ws.merge_cells(start_row=fila, start_column=1,
                       end_row=fila, end_column=ncol)
        c = ws.cell(row=fila, column=1,
                    value=f'{etiqueta}: {datos.get(clave, "")}')
        c.font = F_ETIQ
        c.alignment = IZQ
        fila += 1
    return fila + 1


# ── tabla 1 ───────────────────────────────────────────────────────────────

def _tabla_uno(ws, datos, fila):
    ncol = len(T1_COLS)
    ws.merge_cells(start_row=fila, start_column=1, end_row=fila,
                   end_column=ncol)
    c = ws.cell(row=fila, column=1,
                value='RESUMEN BOCATOMAS, TOMAS, CANALES PRINCIPALES Y '
                      'SECUNDARIOS')
    c.font = F_SUBTIT
    c.alignment = IZQ
    fila += 1

    f_grupo, f_col = fila, fila + 1
    for titulo, ini, fin in T1_GRUPOS:
        ws.merge_cells(start_row=f_grupo, start_column=ini,
                       end_row=f_grupo, end_column=fin)
        _celda(ws, f_grupo, ini, titulo.replace('<sup>', '')
               .replace('</sup>', ''), F_CABEZA, relleno=FILL_GRUPO)
    for j in range(2, ncol + 1):
        if not ws.cell(row=f_grupo, column=j).value:
            _celda(ws, f_grupo, j, None, F_CABEZA, relleno=FILL_GRUPO)

    ws.merge_cells(start_row=f_grupo, start_column=1, end_row=f_col,
                   end_column=1)
    _celda(ws, f_grupo, 1, T1_COLS[0][0].replace('<br/>', ' '), F_CABEZA,
           relleno=FILL_CABEZA)
    for j, (nombre, _) in enumerate(T1_COLS[1:], start=2):
        _celda(ws, f_col, j, nombre.replace('<br/>', ' '), F_CABEZA,
               relleno=FILL_CABEZA)

    fila = f_col + 1
    mayor = datos.get('mayor') or {}
    menor = datos.get('menor') or {}

    def pintar(f):
        for j in range(1, ncol + 1):
            _celda(ws, f, j)

    def poner(f, col, valores, formato=None):
        for i, v in enumerate(valores or []):
            _celda(ws, f, col + i + 1, _num(v), formato=formato)

    inicio_mayor = None
    if mayor:
        pintar(fila)
        _celda(ws, fila, 1, mayor.get('nombre'), alineacion=IZQ)
        poner(fila, C_BOCA, mayor.get('bocatomas'))
        poner(fila, C_TOMA_CM, mayor.get('tomas_cm'))
        if mayor.get('derivacion'):
            d = mayor['derivacion']
            _celda(ws, fila, C_DERIV + 1, _num(d[0]))
            for k, v in enumerate(d[1:4]):
                _celda(ws, fila, C_DERIV + 2 + k, _num(v), formato='0.00')
        inicio_mayor = fila
        fila += 1

    ord1 = menor.get('orden1') or []
    ord2 = menor.get('orden2') or []
    altura = max(len(ord1), len(ord2), 1)
    inicio = fila
    for i in range(altura):
        pintar(fila)
        if i < len(ord1):
            rev, sin, tot, den = ord1[i]
            _celda(ws, fila, C_ORD1 + 1, i + 1)
            for k, v in enumerate((rev, sin, tot)):
                _celda(ws, fila, C_ORD1 + 2 + k, _num(v), formato='0.00')
            _celda(ws, fila, C_ORD1 + 5, den)
        if i < len(ord2):
            rev, sin, tot, den = ord2[i]
            _celda(ws, fila, C_ORD2 + 1, i + 1)
            for k, v in enumerate((rev, sin, tot)):
                _celda(ws, fila, C_ORD2 + 2 + k, _num(v), formato='0.00')
            _celda(ws, fila, C_ORD2 + 5, den)
        fila += 1
    fin = fila - 1

    # Lo que es un solo dato para todo el bloque va combinado en vertical,
    # igual que en el PDF: si no, el 22 de tomas laterales se repetiria una
    # vez por lateral y el total dejaria de cuadrar a la vista.
    if menor:
        _celda(ws, inicio, 1, menor.get('nombre'), alineacion=IZQ)
        poner(inicio, C_TOMA_LAT, menor.get('tomas_lat'))
        if menor.get('principal'):
            pr = menor['principal']
            _celda(ws, inicio, C_PRINC + 1, _num(pr[0]))
            for k, v in enumerate(pr[1:4]):
                _celda(ws, inicio, C_PRINC + 2 + k, _num(v), formato='0.00')
            _celda(ws, inicio, C_PRINC + 5, pr[4] if len(pr) > 4 else None)
        if altura > 1:
            columnas = ([1]
                        + [C_BOCA + 1 + i for i in range(3)]
                        + [C_TOMA_CM + 1 + i for i in range(3)]
                        + [C_TOMA_LAT + 1 + i for i in range(3)]
                        + [C_DERIV + 1 + i for i in range(4)]
                        + [C_PRINC + 1 + i for i in range(5)])
            for col in columnas:
                ws.merge_cells(start_row=inicio, start_column=col,
                               end_row=fin, end_column=col)

    # ── TOTAL ──
    pintar(fila)
    _celda(ws, fila, 1, 'TOTAL', F_TOTAL, IZQ, FILL_CABEZA)
    for j in range(2, ncol + 1):
        ws.cell(row=fila, column=j).fill = FILL_CABEZA
        ws.cell(row=fila, column=j).font = F_TOTAL

    def total(col, valores, formato=None):
        for i, v in enumerate(valores or []):
            if isinstance(v, str):
                continue
            _celda(ws, fila, col + i + 1, _num(v), F_TOTAL,
                   relleno=FILL_CABEZA, formato=formato)

    total(C_BOCA, mayor.get('bocatomas'))
    total(C_TOMA_CM, mayor.get('tomas_cm'))
    total(C_TOMA_LAT, menor.get('tomas_lat'))
    if mayor.get('derivacion'):
        d = mayor['derivacion']
        _celda(ws, fila, C_DERIV + 1, _num(d[0]), F_TOTAL,
               relleno=FILL_CABEZA)
        for k, v in enumerate(d[1:4]):
            _celda(ws, fila, C_DERIV + 2 + k, _num(v), F_TOTAL,
                   relleno=FILL_CABEZA, formato='0.00')
    if menor.get('principal'):
        pr = menor['principal']
        _celda(ws, fila, C_PRINC + 1, _num(pr[0]), F_TOTAL,
               relleno=FILL_CABEZA)
        for k, v in enumerate(pr[1:4]):
            _celda(ws, fila, C_PRINC + 2 + k, _num(v), F_TOTAL,
                   relleno=FILL_CABEZA, formato='0.00')
    # Los kilometrajes van como SUM y no como numero calculado: quien abra
    # la hoja y corrija un lateral ve el total moverse, que es la razon de
    # entregar esto en Excel y no solo en PDF.
    for col, lista in ((C_ORD1, ord1), (C_ORD2, ord2)):
        if not lista:
            continue
        _celda(ws, fila, col + 1, len(lista), F_TOTAL, relleno=FILL_CABEZA)
        for k in range(3):
            letra = get_column_letter(col + 2 + k)
            _celda(ws, fila, col + 2 + k,
                   f'=SUM({letra}{inicio}:{letra}{fin})', F_TOTAL,
                   relleno=FILL_CABEZA, formato='0.00')

    ws.column_dimensions['A'].width = 30
    for j in range(2, ncol + 1):
        ws.column_dimensions[get_column_letter(j)].width = 11
    ws.row_dimensions[f_col].height = 32
    ws.print_title_rows = f'{f_grupo}:{f_col}'
    return fila + 2, inicio_mayor


# ── tabla 2 ───────────────────────────────────────────────────────────────

def _tabla_dos(ws, datos, fila):
    obras = datos.get('obras') or {}
    nombre = (datos.get('menor') or {}).get('nombre', '')
    ncol = len(T2_COLS)

    ws.merge_cells(start_row=fila, start_column=1, end_row=fila,
                   end_column=ncol)
    c = ws.cell(row=fila, column=1, value='RESUMEN DE OBRAS DE ARTE')
    c.font = F_SUBTIT
    c.alignment = IZQ
    fila += 1

    pv, pp = (i + 1 for i in T2_GRUPO_PUENTE)
    f_grupo, f_col = fila, fila + 1
    ws.merge_cells(start_row=f_grupo, start_column=pv, end_row=f_grupo,
                   end_column=pp)
    _celda(ws, f_grupo, pv, 'Puente', F_CABEZA, relleno=FILL_GRUPO)
    _celda(ws, f_col, pv, T2_COLS[pv - 1][0].replace('<br/>', ' '), F_CABEZA,
           relleno=FILL_CABEZA)
    _celda(ws, f_col, pp, T2_COLS[pp - 1][0].replace('<br/>', ' '), F_CABEZA,
           relleno=FILL_CABEZA)
    for j, (titulo, _, _) in enumerate(T2_COLS, start=1):
        if j in (pv, pp):
            continue
        ws.merge_cells(start_row=f_grupo, start_column=j, end_row=f_col,
                       end_column=j)
        _celda(ws, f_grupo, j, titulo.replace('<br/>', ' '), F_CABEZA,
               relleno=FILL_CABEZA)

    fila = f_col + 1
    _celda(ws, fila, 1, nombre, alineacion=IZQ)
    for j, (_, clave, _) in enumerate(T2_COLS[1:], start=2):
        _celda(ws, fila, j, _num(obras.get(clave, 0)))
    fila += 1

    _celda(ws, fila, 1, 'TOTAL', F_TOTAL, IZQ, FILL_CABEZA)
    for j in range(2, ncol + 1):
        letra = get_column_letter(j)
        _celda(ws, fila, j, f'=SUM({letra}{fila - 1}:{letra}{fila - 1})',
               F_TOTAL, relleno=FILL_CABEZA)
    return fila + 2


# ── tabla 3 ───────────────────────────────────────────────────────────────

def _tabla_tres(ws, datos, fila):
    reservorios = datos.get('reservorios') or []
    nombre = (datos.get('menor') or {}).get('nombre', '')
    ncol = len(T3_COLS)

    ws.merge_cells(start_row=fila, start_column=1, end_row=fila,
                   end_column=ncol)
    c = ws.cell(row=fila, column=1, value='RESUMEN DE RESERVORIOS')
    c.font = F_SUBTIT
    c.alignment = IZQ
    fila += 1

    f_grupo, f_col = fila, fila + 1
    ws.merge_cells(start_row=f_grupo, start_column=2, end_row=f_grupo,
                   end_column=ncol)
    _celda(ws, f_grupo, 2, 'Reservorios', F_CABEZA, relleno=FILL_GRUPO)
    ws.merge_cells(start_row=f_grupo, start_column=1, end_row=f_col,
                   end_column=1)
    _celda(ws, f_grupo, 1, T3_COLS[0][0].replace('<br/>', ' '), F_CABEZA,
           relleno=FILL_CABEZA)
    for j, (titulo, _) in enumerate(T3_COLS[1:], start=2):
        _celda(ws, f_col, j, titulo.replace('<br/>', ' ')
               .replace('<super>', '').replace('</super>', ''), F_CABEZA,
               relleno=FILL_CABEZA)

    fila = f_col + 1
    inicio = fila
    for i, (capacidad, denominacion) in enumerate(reservorios):
        _celda(ws, fila, 1)
        _celda(ws, fila, 2, i + 1)
        _celda(ws, fila, 3, _num(capacidad), formato='0.000')
        _celda(ws, fila, 4, denominacion, alineacion=IZQ)
        fila += 1
    if not reservorios:
        for j in range(1, ncol + 1):
            _celda(ws, fila, j)
        fila += 1
    fin = fila - 1
    _celda(ws, inicio, 1, nombre, alineacion=IZQ)
    if fin > inicio:
        ws.merge_cells(start_row=inicio, start_column=1, end_row=fin,
                       end_column=1)

    _celda(ws, fila, 1, 'TOTAL', F_TOTAL, IZQ, FILL_CABEZA)
    _celda(ws, fila, 2, None, F_TOTAL, relleno=FILL_CABEZA)
    _celda(ws, fila, 3, f'=SUM(C{inicio}:C{fin})', F_TOTAL,
           relleno=FILL_CABEZA, formato='0.000')
    _celda(ws, fila, 4, None, F_TOTAL, relleno=FILL_CABEZA)

    for j, (_, peso) in enumerate(T3_COLS, start=1):
        ws.column_dimensions[get_column_letter(j)].width = max(12, peso)
    return fila + 1


# ── la hoja ───────────────────────────────────────────────────────────────

def escribir(datos, ruta, ambito='todos', campania=None, cabecera=None):
    wb = Workbook()
    ws = wb.active
    ws.title = 'B-9'

    fila = _cabecera_hoja(
        ws, len(T1_COLS),
        'Formato B-9.- Resumen del Inventario de Infraestructura Hidráulica',
        cabecera, datos)
    fila, _ = _tabla_uno(ws, datos, fila)
    fila = _tabla_dos(ws, datos, fila)
    fila = _tabla_tres(ws, datos, fila)

    ws.cell(row=fila + 1, column=1,
            value=f'Ámbito: {ambito}   ·   '
                  + (f'Campaña {campania}' if campania
                     else 'Inventario base')
                  + '   ·   Generado desde la base de datos del inventario '
                    '(PostGIS)').font = Font(name='Arial', size=8,
                                             italic=True)

    ws.page_setup.orientation = 'landscape'
    ws.page_setup.paperSize = 8          # A3
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.freeze_panes = 'B1'

    wb.save(ruta)
    return ruta


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--ambito', default='todos')
    p.add_argument('--campania', type=int)
    p.add_argument('--salida', default='.')
    p.add_argument('--prueba', metavar='RUTA',
                   help='escribe la hoja de referencia, sin tocar la base')
    args = p.parse_args()

    if args.prueba:
        escribir(DATOS_PRUEBA, args.prueba, 'todos',
                 cabecera=CABECERA_PRUEBA)
        print(f'escrito {args.prueba}')
        return 0

    import reportes_ana as R
    from reportes_b9_datos import leer_datos, _asegurar_clave
    _asegurar_clave()

    datos = leer_datos(R, args.ambito, args.campania)
    if datos is None:
        print('la consulta fallo', file=sys.stderr)
        return 1

    os.makedirs(args.salida, exist_ok=True)
    sufijo = f'_{args.campania}' if args.campania else ''
    ruta = os.path.join(args.salida,
                        f'F_B-9_Resumen_{args.ambito}{sufijo}.xlsx')
    escribir(datos, ruta, args.ambito, args.campania,
             cabecera=getattr(R, 'CABECERA', CABECERA_PRUEBA))
    print(f'escrito {ruta}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
