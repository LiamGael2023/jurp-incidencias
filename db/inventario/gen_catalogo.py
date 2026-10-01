#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Genera alta_catalogo_fichas.sql a partir de un catálogo declarado una sola vez.

Por qué un generador y no SQL escrito a mano: las diez fichas comparten un
núcleo y un vocabulario de dimensiones. Escribirlas una por una son ~450 filas
de SQL con los mismos nombres repetidos diez veces, y la primera vez que haya
que corregir "Espesor Muro (e)" hay que acordarse de los diez sitios. Aquí el
campo se declara una vez y se expande.

    python3 gen_catalogo.py > alta_catalogo_fichas.sql
"""

# ══════════════════════════════════════════════════════════════════════════
#  Dominios nuevos
# ══════════════════════════════════════════════════════════════════════════
# Códigos de una o dos letras en mayúscula, como los dominios que ya están
# en la base (B/R/M/C, I/D, Pe/Ru/P).
DOMINIOS = {
    'si_no':          [('S', 'Sí'), ('N', 'No')],
    'estado_brm':     [('B', 'Bueno'), ('R', 'Regular'), ('M', 'Malo')],
    'tipo_obra':      [('Pe', 'Permanente'), ('SR', 'Semi-rústico'),
                       ('Ru', 'Rústico'), ('O', 'Otro')],
    'material_obra':  [('C', 'Concreto'), ('M', 'Mampostería'), ('MA', 'Madera'),
                       ('NP', 'No precisa'), ('O', 'Otros')],
    'revestimiento':  [('C', 'Concreto'), ('M', 'Mampostería'), ('E', 'Enrocado'),
                       ('T', 'Tierra'), ('O', 'Otro')],
    'tipo_cuerpo':    [('T', 'Tubería'), ('CA', 'Cajón'), ('O', 'Otro')],
    'tipo_seccion':   [('R', 'Rectangular'), ('T', 'Trapezoidal'),
                       ('C', 'Circular'), ('O', 'Otro')],
    'tipo_conduc':    [('CA', 'Canal abierto'), ('TU', 'Tubería'),
                       ('CC', 'Conducto cubierto'), ('O', 'Otro')],
    'material_tub':   [('A', 'Acero'), ('C', 'Concreto'), ('PV', 'PVC'),
                       ('AC', 'Asbesto/cemento'), ('NP', 'No precisa'),
                       ('O', 'Otros')],
    'mat_revest_can': [('C', 'Concreto'), ('M', 'Mampostería'),
                       ('G', 'Geomembrana'), ('PV', 'PVC'), ('O', 'Otro')],
    'mat_junta':      [('E', 'Elastomérico'), ('A', 'Asfalto'), ('O', 'Otro')],
    'tipo_medicion':  [('P', 'Parshall'), ('SC', 'Sin cuello'), ('RBC', 'RBC'),
                       ('O', 'Otros')],
    'tipo_uso':       [('A', 'Agrario'), ('M', 'Multisectorial')],
    'tipo_caida':     [('SC', 'Sin caída'), ('CV', 'Caída vertical'),
                       ('CI', 'Caída inclinada')],
    'margen_cs':      [('I', 'Izquierda'), ('D', 'Derecha'), ('A', 'Ambas')],
    'tipo_red':       [('TR', 'Troncal'), ('SE', 'Secundaria'), ('O', 'Otro')],
    'tipo_operacion': [('M', 'Manual'), ('A', 'Automática'), ('-', 'No precisa')],
}

# Dominios que ya están en la base y este archivo no toca: el catálogo los usa
# pero no los redefine, para no pisar etiquetas que ya se ven en el formulario.
DOMINIOS_BASE = {'condicion_operativa', 'margen', 'estado_conservacion'}

# ══════════════════════════════════════════════════════════════════════════
#  Catálogo de campos: cada campo se declara UNA vez
# ══════════════════════════════════════════════════════════════════════════
# (campo, etiqueta, tipo_dato, dominio, obligatorio)
# La etiqueta se puede sobreescribir por tipo de activo cuando la ficha usa
# otra redacción para el mismo dato (ver ETIQUETA_POR_TIPO).

# ── Núcleo: lo que piden las 10 fichas en las secciones 1, 2 y cabecera 3 ──
# Fuera quedan, con criterio explícito:
#   · Estructura        -> es el propio tipo de activo
#   · Denominación      -> columna 'nombre' de la tabla
#   · Código            -> columna 'numero' de la tabla
#   · Nombre del Canal  -> ya está en la capa ('ambito' JURP/PECH + 'tramo')
#   · Este/Norte/Zona/Elevación -> los da el GPS al ubicar el activo
#   · Fecha, responsable, croquis, fotografías -> los pone el sistema
# Lo que va SIN prefijo de bloque queda arriba del formulario y siempre
# abierto, así que aquí entra solo lo que el técnico responde en toda visita.
NUCLEO = [
    ('estado',      'Estado de conservación',  'opcion', 'estado_brm',          True),
    ('observacio',  'Condición operativa',     'opcion', 'condicion_operativa', True),
]

# Un activo puntual se ubica con una progresiva; un tramo, con dos.
NUCLEO_PUNTO = [
    ('progresiva',  'Ubicación · progresiva',           'texto', None,     False),
    # Del formato del ANA, no de la ficha de campo.
    ('margen',      'Ubicación · margen (D o I)',       'opcion', 'margen', False),
    ('obs_ubic',    'Ubicación · observaciones',        'texto', None,      False),
]

NUCLEO_TRAMO = [
    ('prog_ini',    'Ubicación · progresiva inicio',    'texto', None, False),
    ('prog_fin',    'Ubicación · progresiva fin',       'texto', None, False),
    ('obs_ubic',    'Ubicación · observaciones',        'texto', None, False),
]

# Tipo y material de la obra: idénticos en 8 fichas (las de punto).
NUCLEO_OBRA = [
    ('anio_const',  'Obra · año de construcción',       'entero', None,            False),
    ('tipo',        'Obra · tipo',                      'opcion', 'tipo_obra',     False),
    ('tipo_otro',   'Obra · tipo (otro)',               'texto',  None,            False),
    ('material',    'Obra · material',                  'opcion', 'material_obra', False),
    ('mat_estado',  'Obra · estado del material',       'opcion', 'estado_brm',    False),
    ('mat_otro',    'Obra · material (otros)',          'texto',  None,            False),
]

# ══════════════════════════════════════════════════════════════════════════
#  Bloques reutilizables
# ══════════════════════════════════════════════════════════════════════════
# Un bloque es un componente de la obra. El mismo bloque aparece en varias
# fichas con el mismo juego de dimensiones, así que se declara una vez y se
# instancia con un prefijo y un título.

def transicion(pref, titulo, *, con_losa=True, alturas=('h1', 'h2'),
               con_revest=True):
    """Transición de ingreso o salida: el patrón más repetido del lote.
    Aparece en canoa, sifón, alcantarilla y desarenador."""
    c = []
    if con_revest:
        c += [(f'{pref}_revest', f'{titulo} · revestimiento', 'opcion', 'revestimiento', False)]
    c += [(f'{pref}_estado', f'{titulo} · estado', 'opcion', 'estado_brm', False)]
    c += [(f'{pref}_long',   f'{titulo} · longitud (m)',     'numero', None, False),
          (f'{pref}_bmayor', f'{titulo} · base mayor B (m)', 'numero', None, False),
          (f'{pref}_bmenor', f'{titulo} · base menor b (m)', 'numero', None, False)]
    for a in alturas:
        c += [(f'{pref}_{a}', f'{titulo} · altura muro {a} (m)', 'numero', None, False)]
    c += [(f'{pref}_espes', f'{titulo} · espesor e (m)', 'numero', None, False)]
    if con_losa:
        c += [(f'{pref}_esplos', f'{titulo} · espesor losa e1 (m)', 'numero', None, False)]
    return c


def cuerpo(pref, titulo, *, con_tipo=True, con_diam=True, con_losa=True):
    """Cuerpo de la obra: alcantarilla y sifón usan el mismo juego."""
    c = []
    if con_tipo:
        c += [(f'{pref}_tipo', f'{titulo} · tipo', 'opcion', 'tipo_cuerpo', False)]
    c += [(f'{pref}_estado', f'{titulo} · estado',           'opcion', 'estado_brm', False),
          (f'{pref}_long',   f'{titulo} · longitud L (m)',   'numero', None, False)]
    if con_diam:
        c += [(f'{pref}_diam', f'{titulo} · diámetro Ø (m)', 'numero', None, False)]
    c += [(f'{pref}_base',   f'{titulo} · base b (m)',       'numero', None, False),
          (f'{pref}_altura', f'{titulo} · altura h (m)',     'numero', None, False),
          (f'{pref}_espes',  f'{titulo} · espesor e (m)',    'numero', None, False)]
    if con_losa:
        c += [(f'{pref}_esplos', f'{titulo} · espesor losa e1 (m)', 'numero', None, False)]
    return c


def caja(pref, titulo, *, con_estado=True, con_talud=False, con_naves=False,
         base_c=False):
    """Cajón o canal rectangular simple: longitud, base, altura, espesor.
    Lo usan el aliviadero (sus 5 tramos), el desarenador y las cajas de purga."""
    c = []
    if con_estado:
        c += [(f'{pref}_estado', f'{titulo} · estado', 'opcion', 'estado_brm', False)]
    if con_naves:
        c += [(f'{pref}_naves', f'{titulo} · número de naves', 'entero', None, False)]
    c += [(f'{pref}_long',   f'{titulo} · longitud (m)',  'numero', None, False),
          (f'{pref}_base',   f'{titulo} · base b (m)',    'numero', None, False)]
    if base_c:
        c += [(f'{pref}_basec', f'{titulo} · base c (m)', 'numero', None, False)]
    c += [(f'{pref}_altura', f'{titulo} · altura h (m)',  'numero', None, False),
          (f'{pref}_espes',  f'{titulo} · espesor e (m)', 'numero', None, False)]
    if con_talud:
        c += [(f'{pref}_talud', f'{titulo} · talud Z (1:H)', 'numero', None, False)]
    return c


def canal_lateral(pref, titulo):
    """Canal de ingreso o de salida: ¿cuenta con él?, material y estado."""
    return [
        (f'{pref}_hay',    f'{titulo} · ¿cuenta con canal?', 'opcion', 'si_no',         False),
        (f'{pref}_mat',    f'{titulo} · revestimiento',      'opcion', 'revestimiento', False),
        (f'{pref}_estado', f'{titulo} · estado',             'opcion', 'estado_brm',    False),
    ]


def si_no_estado(pref, titulo):
    """Elemento accesorio que existe o no y, si existe, en qué estado."""
    return [
        (f'{pref}_hay',    f'{titulo} · ¿cuenta con?', 'opcion', 'si_no',      False),
        (f'{pref}_estado', f'{titulo} · estado',       'opcion', 'estado_brm', False),
    ]


def medicion(pref='med'):
    """Estructuras de medición al inicio. Compartido por canal y sublateral."""
    return [
        (f'{pref}_hay',    'Medición · ¿hay estructura al inicio?', 'opcion', 'si_no',         False),
        (f'{pref}_tipo',   'Medición · tipo',                       'opcion', 'tipo_medicion', False),
        (f'{pref}_otro',   'Medición · otro (especificar)',         'texto',  None,            False),
        (f'{pref}_estado', 'Medición · estado',                     'opcion', 'estado_brm',    False),
    ]


def camino_servicio(pref='cs'):
    """Camino de servicio. Compartido por canal y sublateral."""
    return [
        (f'{pref}_hay',    'Camino de servicio · ¿existe?', 'opcion', 'si_no',      False),
        (f'{pref}_margen', 'Camino de servicio · margen',   'opcion', 'margen_cs',  False),
        (f'{pref}_estado', 'Camino de servicio · estado',   'opcion', 'estado_brm', False),
    ]


def caudales():
    """Caudales y derecho de uso. Compartido por canal y sublateral."""
    return [
        ('q_diseno',   'Caudales · de diseño (m³/s)',     'numero', None,       False),
        ('q_opera',    'Caudales · de operación (m³/s)',  'numero', None,       False),
        ('uso',        'Caudales · tipo de uso',          'opcion', 'tipo_uso', False),
        ('n__usuario', 'Caudales · n° de usuarios',       'entero', None,       False),
        ('area_total', 'Caudales · área total (ha)',      'numero', None,       False),
        ('area_riego', 'Caudales · área bajo riego (ha)', 'numero', None,       False),
        ('vol_otorg',  'Caudales · volumen otorgado (m³)', 'numero', None,      False),
    ]


# ══════════════════════════════════════════════════════════════════════════
#  Batería de inspección visual
# ══════════════════════════════════════════════════════════════════════════
# Las 10 fichas toman de 4 a 6 preguntas de esta lista. La redacción impresa
# varía entre fichas (erratas: "corrosion"/"corrosión", "epoca"/"época",
# "matenimiento") pero el hecho que se observa es el mismo, así que el campo
# es uno y la etiqueta se normaliza. Cada pregunta lleva su comentario: en las
# fichas llenadas es ahí donde está el hallazgo útil ("Muro izquierdo con
# ruptura", "Falta señaletica"), no en el sí/no.
PREGUNTAS = {
    'concreto':  '¿Problemas en el concreto armado (fisuras, corrosión de armaduras, desgaste)?',
    'revest':    '¿Problemas en el revestimiento (fisuras, desgaste)?',
    'metal_cor': '¿Las estructuras metálicas presentan corrosión?',
    'metal_op':  '¿Las estructuras metálicas se encuentran operativas?',
    'operativa': '¿La estructura se encuentra operativa?',
    'rebasada':  '¿Fue rebasada en época de crecidas (fenómenos extraordinarios)?',
    'obstruida': '¿La estructura se encuentra obstruida (ingreso y salida)?',
    'colmatada': '¿Se evidencia colmatación?',
    'sedimento': '¿Se evidencian sedimentos en la estructura?',
    'segurid':   '¿Cuenta con elementos de seguridad y señalética para su operación?',
    'descarga':  '¿La zona de descarga se encuentra habilitada?',
    'averia':    '¿Presenta alguna avería?',
    'mant_cs':   '¿Se evidencia mantenimiento del camino de servicio?',
    'bermas':    '¿Las bermas se encuentran definidas?',
    'riesgo':    '¿Existen zonas de riesgo en el tramo (deslizamiento, asentamiento, arenamiento)?',
    'pintado':   '¿Existe el pintado de progresivas y señalética en el tramo?',
    'cobertura': '¿La tubería cuenta con cobertura y/o protección?',
    'corr_tub':  '¿Se evidencia desgaste por corrosión en la tubería de acero?',
    'construcc': '¿Existen construcciones sobre la tubería?',
    'tension':   '¿Existen líneas de alta, media o baja tensión sobre el emplazamiento?',
    'interfer':  '¿Existen interferencias en el tramo (líneas de riego, cerco perimétrico, otras)?',
    'acceso':    '¿El acceso a la tubería es restringido?',
}

# Cuando la ficha precisa el objeto de la pregunta, la etiqueta se afina por
# tipo. Es el mismo campo: así un reporte puede contar colmataciones de todo
# el sistema sin traducir nombres.
MATIZ = {
    ('colmatada', 'canoa'):        '¿Se evidencia colmatación de los cauces de ingreso y/o salida?',
    ('colmatada', 'alcantarilla'): '¿Se evidencia colmatación de los cauces de ingreso y/o salida?',
    ('colmatada', 'puente'):       '¿Se evidencia colmatación de la estructura?',
    ('colmatada', 'entrega'):      '¿Se evidencia colmatación de la estructura?',
    ('colmatada', 'canal'):        '¿Se evidencia colmatación de la caja hidráulica?',
    ('descarga',  'aliviadero'):   '¿La zona de descarga del aliviadero se encuentra habilitada?',
    ('descarga',  'sifon'):        '¿La zona de descarga de la purga se encuentra habilitada?',
}


def inspeccion(*claves):
    """Expande las preguntas pedidas: cada una es sí/no + comentario."""
    c = []
    for k in claves:
        c += [(f'insp_{k}',   f'Inspección · {PREGUNTAS[k]}',           'opcion', 'si_no', True),
              (f'insp_{k}_c', f'Inspección · {PREGUNTAS[k]} — detalle', 'texto', None,   False)]
    return c


NOTA = [('nota_adic', 'Inspección · notas adicionales', 'texto', None, False)]


# ══════════════════════════════════════════════════════════════════════════
#  Los diez tipos
# ══════════════════════════════════════════════════════════════════════════
# La clave es el código en tipos_activo. Si alguno no coincide con el de la
# base, el SQL lo avisa por NOTICE y no inserta nada de ese tipo: no hay
# forma de que deje el catálogo a medias.
TIPOS = {}

# ── ALCANTARILLA (ficha 07) ───────────────────────────────────────────────
TIPOS['alcantarilla'] = (
    NUCLEO + NUCLEO_PUNTO + NUCLEO_OBRA
    + transicion('ing', 'Ingreso', con_losa=False)
    + cuerpo('cue', 'Cuerpo')
    + transicion('sal', 'Salida', con_losa=False, alturas=('h3',))
    + canal_lateral('can_ing', 'Canal de ingreso')
    + canal_lateral('can_sal', 'Canal de salida')
    + inspeccion('operativa', 'colmatada', 'rebasada', 'obstruida')
    + NOTA
)

# ── CANOA (ficha 04) ──────────────────────────────────────────────────────
TIPOS['canoas'] = (
    NUCLEO + NUCLEO_PUNTO + NUCLEO_OBRA
    + transicion('ing', 'Ingreso', alturas=('h1',))
    + [('diq_hay',    'Diques de encauzamiento · ¿cuenta con?',  'opcion', 'si_no',         False),
       ('diq_mat',    'Diques de encauzamiento · material',      'opcion', 'revestimiento', False),
       ('diq_estado', 'Diques de encauzamiento · estado',        'opcion', 'estado_brm',    False),
       ('diq_corona', 'Diques de encauzamiento · corona C (m)',  'numero', None,            False),
       ('diq_altura', 'Diques de encauzamiento · altura H (m)',  'numero', None,            False),
       ('diq_talud',  'Diques de encauzamiento · talud Z',       'numero', None,            False)]
    + cuerpo('cue', 'Cuerpo canoa', con_tipo=False, con_diam=False)
    + [('poz_caida', 'Poza de disipación · tipo de caída', 'opcion', 'tipo_caida', False)]
    + caja('poz', 'Poza de disipación')
    + transicion('sal', 'Salida', alturas=('h2',))
    + canal_lateral('can_sal', 'Canal de salida')
    + inspeccion('concreto', 'colmatada', 'rebasada', 'obstruida')
    + NOTA
)

# ── TOMA LATERAL (fichas 01, 02, 03 del Canal Madre y la 02 de laterales) ─
TIPOS['toma_lateral'] = (
    NUCLEO + NUCLEO_PUNTO + NUCLEO_OBRA
    + caudales()
    + [('tom_estado', 'Toma · estado',                 'opcion', 'estado_brm', False),
       ('tom_ancho',  'Toma · ancho b (m)',            'numero', None,         False),
       ('tom_long2',  'Toma · longitud L2 (m)',        'numero', None,         False),
       ('tom_long3',  'Toma · longitud L3 (m)',        'numero', None,         False),
       ('tom_altura', 'Toma · altura h (m)',           'numero', None,         False),
       ('tom_espes',  'Toma · espesor muro e (m)',     'numero', None,         False),
       ('tom_esplos', 'Toma · espesor losa e1 (m)',    'numero', None,         False),
       ('tom_talud',  'Toma · talud Z (1:H)',          'numero', None,         False),
       ('com_ancho',  'Compuerta · ancho a (m)',       'numero', None,         False),
       ('com_alto',   'Compuerta · alto b (m)',        'numero', None,         False),
       ('com_htotal', 'Compuerta · altura total H (m)', 'numero', None,        False),
       ('com_eplan',  'Compuerta · espesor plancha (mm)', 'numero', None,      False),
       ('com_vast',   'Compuerta · vástago (pulg)',    'texto',  None,         False),
       ('com_sello',  'Compuerta · ¿cuenta con sello?', 'opcion', 'si_no',     False),
       ('com_tsello', 'Compuerta · tipo de sello',     'texto',  None,         False),
       ('com_esello', 'Compuerta · espesor de sello (mm)', 'numero', None,     False),
       # Del formato B-1.A del ANA, que la ficha de campo no pide:
       ('com_hay',    'Compuerta · ¿cuenta con compuerta?', 'opcion', 'si_no', False),
       ('com_mat',    'Compuerta · material',          'opcion', 'material_tub', False),
       ('com_opera',  'Compuerta · operación',         'opcion', 'tipo_operacion', False),
       ('com_estado', 'Compuerta · estado',            'opcion', 'estado_brm', False)]
    + [('ret_hay',    'Retención · ¿cuenta con?',      'opcion', 'si_no',      False),
       ('ret_altura', 'Retención · altura h (m)',      'numero', None,         False),
       ('ret_estado', 'Retención · estado',            'opcion', 'estado_brm', False),
       ('ret_purga',  'Retención · ¿compuerta de purga?', 'opcion', 'si_no',   False),
       ('ret_dimpur', 'Retención · dimensiones de la purga', 'texto', None,    False),
       ('ret_mat',    'Retención · material',          'opcion', 'material_tub', False)]
    + si_no_estado('bar', 'Baranda metálica')
    + [('sld_tipo',   'Salida · tipo',                 'opcion', 'tipo_conduc', False),
       ('sld_diam',   'Salida · diámetro Ø (mm)',      'numero', None,          False),
       ('sld_mat',    'Salida · material',             'opcion', 'material_tub', False),
       ('sld_medic',  'Salida · ¿estructura de medición?', 'opcion', 'si_no',   False),
       ('sld_tmedic', 'Salida · tipo de medición',     'texto',  None,          False)]
    + inspeccion('concreto', 'metal_op', 'rebasada', 'segurid')
    + NOTA
)

# ── ENTREGAS (ficha 06) ───────────────────────────────────────────────────
TIPOS['entregas'] = (
    NUCLEO + NUCLEO_PUNTO + NUCLEO_OBRA
    + [('ent_long1',  'Dimensiones · longitud L1 (m)',       'numero', None, False),
       ('ent_long2',  'Dimensiones · longitud L2 (m)',       'numero', None, False),
       ('ent_long3',  'Dimensiones · longitud L3 (m)',       'numero', None, False),
       ('ent_ancho',  'Dimensiones · ancho b (m)',           'numero', None, False),
       ('ent_bmayor', 'Dimensiones · ancho mayor B (m)',     'numero', None, False),
       ('ent_altura', 'Dimensiones · altura h (m)',          'numero', None, False),
       ('ent_espes',  'Dimensiones · espesor de muro e (m)', 'texto',  None, False)]
    + inspeccion('concreto', 'colmatada', 'rebasada', 'obstruida')
    + NOTA
)

# ── PASE / PUENTE VEHICULAR (ficha 05) ────────────────────────────────────
TIPOS['puente_vehicular'] = (
    NUCLEO + NUCLEO_PUNTO + NUCLEO_OBRA
    + [('pue_ancho',  'Dimensiones · ancho A (m)',                 'numero', None, False),
       ('pue_mgmay',  'Dimensiones · murete guarda mayor B (m)',   'numero', None, False),
       ('pue_mgmen',  'Dimensiones · murete guarda menor b (m)',   'numero', None, False),
       ('pue_long',   'Dimensiones · longitud L (m)',              'numero', None, False),
       ('pue_translo', 'Dimensiones · transición de losa l (m)',   'numero', None, False),
       ('pue_altura', 'Dimensiones · altura h (m)',                'numero', None, False),
       ('pue_esplos', 'Dimensiones · espesor de losa e (m)',       'numero', None, False)]
    + inspeccion('concreto', 'colmatada', 'rebasada', 'obstruida')
    + NOTA
)

# ── SIFON (ficha 09) ──────────────────────────────────────────────────────
TIPOS['sifon'] = (
    NUCLEO + NUCLEO_PUNTO
    + [('anio_const', 'Obra · año de construcción',         'entero', None,           False),
       ('tipo',       'Obra · tipo',                        'opcion', 'tipo_obra',    False),
       ('tipo_otro',  'Obra · tipo (otro)',                 'texto',  None,           False),
       ('material',   'Obra · material',                    'opcion', 'material_tub', False),
       ('mat_estado', 'Obra · estado del material',         'opcion', 'estado_brm',   False),
       ('mat_espes',  'Obra · espesor del acero (mm)',      'numero', None,           False),
       ('mat_otro',   'Obra · material (otros)',            'texto',  None,           False)]
    + transicion('ing', 'Ingreso', con_losa=False)
    + [('rej_ing_hay', 'Rejilla de ingreso · ¿cuenta con?', 'opcion', 'si_no',      False),
       ('rej_ing_est', 'Rejilla de ingreso · estado',       'opcion', 'estado_brm', False),
       ('rej_ing_lon', 'Rejilla de ingreso · longitud (m)', 'numero', None,         False),
       ('rej_ing_alt', 'Rejilla de ingreso · alto (m)',     'numero', None,         False)]
    + cuerpo('cue', 'Ducto')
    + [('cue_mat',   'Ducto · material de la tubería', 'opcion', 'material_tub', False),
       ('cue_otro',  'Ducto · otro (especificar)',     'texto',  None,           False)]
    + transicion('sal', 'Salida', con_losa=False, alturas=('h', 'h3'))
    + [('rej_sal_hay', 'Salida · ¿cuenta con rejilla de seguridad?', 'opcion', 'si_no', False)]
    + [('pur_hay',   'Purga · ¿cuenta con caja de inspección y purga?', 'opcion', 'si_no',        False),
       ('pur_mat',   'Purga · material de la caja',  'opcion', 'material_tub', False),
       ('pur_ancho', 'Purga · ancho (m)',            'numero', None,           False),
       ('pur_largo', 'Purga · largo (m)',            'numero', None,           False),
       ('pur_altura', 'Purga · altura (m)',          'numero', None,           False),
       ('pur_espes', 'Purga · espesor (m)',          'numero', None,           False)]
    + si_no_estado('pur_esc', 'Purga · escalera metálica')
    + [('pur_valv',  'Purga · ¿válvula compuerta?',  'opcion', 'si_no', False),
       ('pur_vdiam', 'Purga · diámetro de válvula (mm)', 'numero', None, False),
       ('pur_desf',  'Purga · ¿tubería de desfogue?', 'opcion', 'si_no', False),
       ('pur_ddiam', 'Purga · diámetro de desfogue (mm)', 'numero', None, False)]
    + si_no_estado('pur_rej', 'Purga · rejilla de seguridad')
    + inspeccion('concreto', 'cobertura', 'corr_tub', 'descarga')
    + NOTA
)

# ── ALIVIADERO (ficha 08) ─────────────────────────────────────────────────
TIPOS['aliviadero'] = (
    NUCLEO + NUCLEO_PUNTO
    + [('anio_const', 'Obra · año de construcción', 'entero', None,        False),
       ('tipo',       'Obra · tipo',                'opcion', 'tipo_obra', False),
       ('tipo_otro',  'Obra · tipo (otro)',         'texto',  None,        False)]
    + [('apr_estado', 'Canal de ingreso · estado',        'opcion', 'estado_brm', False),
       ('apr_qdis',   'Canal de ingreso · caudal de diseño (m³/s)',    'numero', None, False),
       ('apr_qope',   'Canal de ingreso · caudal de operación (m³/s)', 'numero', None, False),
       ('apr_base',   'Canal de ingreso · base b (m)',    'numero', None, False),
       ('apr_hd',     'Canal de ingreso · altura derecha hd (m)',   'numero', None, False),
       ('apr_zd',     'Canal de ingreso · talud derecho zd',        'numero', None, False),
       ('apr_hi',     'Canal de ingreso · altura izquierda hi (m)', 'numero', None, False),
       ('apr_zi',     'Canal de ingreso · talud izquierdo zi',      'numero', None, False)]
    + [('ali_revest', 'Aliviadero · revestimiento', 'opcion', 'revestimiento', False)]
    + caja('ali', 'Aliviadero', con_talud=True)
    + caja('par', 'Partidor')
    + [('par_compu', 'Partidor · ¿compuertas metálicas?', 'opcion', 'si_no', False),
       ('par_baran', 'Partidor · ¿barandas de seguridad?', 'opcion', 'si_no', False)]
    + caja('sif', 'Canal hacia el sifón', con_talud=True)
    + caja('exc', 'Canal de excedencia', con_talud=True)
    + [('dis_estado', 'Disipador · estado', 'opcion', 'estado_brm', False)]
    + [(f'dis_{d}', f'Disipador · {d} (m)', 'numero', None, False)
       for d in ('a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k')]
    + [('tub_mat',  'Conducción · material de la tubería', 'opcion', 'material_tub', False),
       ('tub_diam', 'Conducción · diámetro Ø (mm)',        'numero', None,           False)]
    + si_no_estado('enr', 'Enrocado de protección')
    + inspeccion('concreto', 'metal_cor', 'sedimento', 'descarga')
)

# ── DESARENADOR (ficha 03) ────────────────────────────────────────────────
TIPOS['desarenadores'] = (
    NUCLEO + NUCLEO_PUNTO
    + [('anio_const', 'Obra · año de construcción', 'entero', None,        False),
       ('tipo',       'Obra · tipo',                'opcion', 'tipo_obra', False),
       ('tipo_otro',  'Obra · tipo (otro)',         'texto',  None,        False)]
    + [('apr_tipo',   'Aproximación · tipo',          'opcion', 'tipo_conduc', False),
       ('apr_estado', 'Aproximación · estado',        'opcion', 'estado_brm',  False),
       ('apr_long',   'Aproximación · longitud (m)',  'numero', None,          False),
       ('apr_ancho',  'Aproximación · ancho (m)',     'numero', None,          False),
       ('apr_altura', 'Aproximación · altura (m)',    'numero', None,          False),
       ('apr_espes',  'Aproximación · espesor e (m)', 'numero', None,          False)]
    + caja('reg', 'Regulación', con_naves=True)
    + [('reg_bmayor', 'Regulación · base mayor B (m)',      'numero', None,    False),
       ('reg_compu',  'Regulación · ¿compuertas metálicas?', 'opcion', 'si_no', False),
       ('reg_baran',  'Regulación · ¿barandas de seguridad?', 'opcion', 'si_no', False)]
    + [('ent_naves',  'Transición de entrada · número de naves', 'entero', None, False),
       ('ent_long',   'Transición de entrada · longitud (m)',    'numero', None, False),
       ('ent_bmayor', 'Transición de entrada · base mayor B (m)', 'numero', None, False),
       ('ent_bmenor', 'Transición de entrada · base menor b (m)', 'numero', None, False),
       ('ent_altura', 'Transición de entrada · altura h (m)',    'numero', None, False),
       ('ent_espes',  'Transición de entrada · espesor e (m)',   'numero', None, False)]
    + caja('tan', 'Tanque sedimentador', con_naves=True, base_c=True)
    + [(f'tan_{a}', f'Tanque sedimentador · altura {a} (m)', 'numero', None, False)
       for a in ('h1', 'h2', 'h3')]
    + caja('sal', 'Transición de salida', base_c=True)
    + [('eq_puente', 'Equipamiento · ¿puente de maniobras?',  'opcion', 'si_no', False),
       ('eq_purga',  'Equipamiento · ¿conductos de purga?',   'opcion', 'si_no', False),
       ('eq_pdiam',  'Equipamiento · diámetro de purga (mm)', 'numero', None,    False),
       ('eq_pnum',   'Equipamiento · número de conductos de purga', 'entero', None, False),
       ('eq_compu',  'Equipamiento · ¿compuertas metálicas?', 'opcion', 'si_no', False),
       ('eq_cnum',   'Equipamiento · número de compuertas',   'entero', None,    False)]
    + caja('cam', 'Cámara de carga', base_c=True)
    + [('cam_otros', 'Cámara de carga · otros', 'texto', None, False)]
    + inspeccion('concreto', 'metal_cor', 'sedimento', 'averia')
)

# ── CANAL (ficha 01) — georreferencia un tramo ────────────────────────────
TIPOS['laterales'] = (
    NUCLEO + NUCLEO_TRAMO
    + [('anio_const', 'Obra · año de construcción', 'entero', None,           False),
       ('tipo',       'Obra · tipo de sección',     'opcion', 'tipo_seccion', False),
       ('tipo_otro',  'Obra · tipo (otro)',         'texto',  None,           False)]
    + caudales()
    + [('cap_vent', 'Caudales · n° de ventanas de captación', 'entero', None, False)]
    + medicion()
    + camino_servicio()
    + [('rev_tipo',   'Revestimiento · ¿revestido o en tierra?', 'opcion', 'tipo_conduc',   False),
       ('rev_mat',    'Revestimiento · material',               'opcion', 'mat_revest_can', False),
       ('rev_estado', 'Revestimiento · estado',                 'opcion', 'estado_brm',    False),
       ('rev_obs',    'Revestimiento · observación',            'texto',  None,            False)]
    + [('jun_hay',    'Juntas · ¿existen?',          'opcion', 'si_no',      False),
       ('jun_estado', 'Juntas · estado',             'opcion', 'estado_brm', False),
       ('jun_separ',  'Juntas · separación (m)',     'numero', None,         False),
       ('jun_espes',  'Juntas · espesor (m)',        'numero', None,         False),
       ('jun_mat',    'Juntas · material',           'opcion', 'mat_junta',  False)]
    # Estructuras hidráulicas del tramo: es un conteo, no una evaluación.
    + [(f'eh_{c}', f'Obras en el tramo · {e} (und.)', 'entero', None, False)
       for c, e in (('canoa', 'canoas'), ('alcant', 'alcantarillas'),
                    ('entreg', 'entregas'), ('toma', 'tomas'),
                    ('ppeat', 'puentes peatonales'), ('pveh', 'puentes vehiculares'),
                    ('reten', 'retenciones'), ('pases', 'pases de tubería'))]
    + [('eh_otros',   'Obras en el tramo · otros',        'texto',  None,         False),
       ('esc_hay',    'Escalines · ¿existen?',            'opcion', 'si_no',      False),
       ('esc_estado', 'Escalines · estado',               'opcion', 'estado_brm', False),
       ('esc_mat',    'Escalines · material',             'texto',  None,         False)]
    + [(f'dim_{c}', f'Sección · {e}', 'numero', None, False)
       for c, e in (('b', 'base b (m)'), ('bmay', 'base mayor B (m)'),
                    ('c', 'c (m)'), ('e', 'espesor e (m)'),
                    ('y', 'tirante y (m)'), ('bi', 'berma izquierda BI (m)'),
                    ('bd', 'berma derecha BD (m)'), ('cs', 'camino de servicio CS (m)'),
                    ('x', 'x (m)'), ('diam', 'diámetro Ø (m)'))]
    + [('dim_z',     'Sección · talud z (1:H)',   'texto',  None, False),
       ('dim_pend',  'Sección · pendiente S (%)', 'numero', None, False)]
    + inspeccion('revest', 'colmatada', 'mant_cs', 'bermas', 'riesgo', 'pintado')
    + NOTA
)

# ── RED DE DISTRIBUCION / SUBLATERAL (ficha 10) — también un tramo ────────
TIPOS['sublateral'] = (
    NUCLEO + NUCLEO_TRAMO
    + [('sublat',     'Ubicación · sublateral',          'texto',  None,           False),
       ('anio_const', 'Obra · año de construcción',      'entero', None,           False),
       ('tipo',       'Obra · tipo de conducción',       'opcion', 'tipo_conduc',  False),
       ('tipo_otro',  'Obra · tipo (otro)',              'texto',  None,           False),
       ('red_tipo',   'Obra · troncal o secundaria',     'opcion', 'tipo_red',     False),
       ('material',   'Obra · material de la tubería',   'opcion', 'material_tub', False),
       ('mat_estado', 'Obra · estado del material',      'opcion', 'estado_brm',   False)]
    + caudales()
    + [('cap_vent', 'Caudales · n° de ventanas de captación', 'entero', None, False)]
    + medicion()
    + camino_servicio()
    + [(f'eh_{c}', f'Accesorios · {e} (und.)', 'entero', None, False)
       for c, e in (('cajas', 'cajas de inspección'), ('valv', 'válvulas de aire'),
                    ('hidrom', 'hidrómetros'), ('hidran', 'hidrantes'))]
    + [('eh_otros', 'Accesorios · otros', 'texto', None, False)]
    + [(f'dim_{c}', f'Sección · {e}', 'numero', None, False)
       for c, e in (('diam', 'diámetro D (mm)'), ('pd', 'profundidad PD (m)'),
                    ('b', 'ancho de zanja B (m)'),
                    ('cs', 'camino de servicio CS (m)'), ('x', 'x (m)'))]
    + [('dim_pend', 'Sección · pendiente S (%)', 'numero', None, False)]
    + inspeccion('construcc', 'pintado', 'mant_cs', 'tension', 'interfer', 'acceso')
    + NOTA
)
# ── PARTIDOR ──────────────────────────────────────────────────────────────
# No tiene ficha propia. El bloque «Partidor ③» de la ficha 08 (aliviadero) lo
# describe entero, así que se reutiliza con los campos sin prefijo de bloque.
# Esto es inferencia mía, no un formato levantado por JURP: si aparece la ficha
# del partidor, hay que cotejarlo.
TIPOS['partidor'] = (
    NUCLEO + NUCLEO_PUNTO
    + [('anio_const', 'Obra · año de construcción', 'entero', None,        False),
       ('tipo',       'Obra · tipo',                'opcion', 'tipo_obra', False),
       ('tipo_otro',  'Obra · tipo (otro)',         'texto',  None,        False)]
    + caja('par', 'Dimensiones')
    + [('par_compu', 'Dimensiones · ¿compuertas metálicas?',  'opcion', 'si_no', False),
       ('par_baran', 'Dimensiones · ¿barandas de seguridad?', 'opcion', 'si_no', False)]
    + inspeccion('concreto', 'metal_cor', 'sedimento', 'averia')
    + NOTA
)


# ══════════════════════════════════════════════════════════════════════════
#  Una misma ficha para varias capas
# ══════════════════════════════════════════════════════════════════════════
# Las cuatro fichas de tomas que levantó JURP son la misma plantilla, y en el
# inventario esas tomas están repartidas en tres capas. Un pase peatonal se
# mide igual que uno vehicular (ancho, muretes, longitud, altura, losa), así
# que comparte la ficha 05. Lo segundo es inferencia, no viene de una ficha.
# Se listan TODOS los destinos, incluido el tipo original cuando también es
# una capa real: 'toma_lateral' es solo el nombre de la plantilla y no existe
# como capa, pero 'puente_vehicular' sí, y omitirlo lo dejaría sin campos.
COPIAS = {
    'toma_lateral':     ['tomas_canal_madre', 'tomas_l10', 'tomas_otros_sectores'],
    'puente_vehicular': ['puente_vehicular', 'puente_peatonal'],
}

# ══════════════════════════════════════════════════════════════════════════
#  Nombres que no se pueden cambiar
# ══════════════════════════════════════════════════════════════════════════
# Estas capas vienen de shapefiles y sus columnas YA tienen datos cargados:
# el formulario precarga por nombre de campo, así que si el catálogo los
# renombra el técnico pierde el valor base contra el que comparar. Manda el
# nombre de la columna, aunque sea feo.
#
# El significado sale de los formatos del ANA, no de adivinar: en el B-1.A las
# columnas Estado y Operación aparecen varias veces (toma, compuerta,
# retención) y el shapefile las desambiguó con sufijo numérico en orden de
# aparición, de ahí estado/estado1/estado2 y operación/operaci_1.
RENOMBRES = {
    'tomas_canal_madre': {        # formato B-1.C
        'com_hay':    'compuertas',
        'ret_mat':    'material1',
        'ret_estado': 'estado2',
    },
    'tomas_l10': {                # formato B-1.A
        'q_opera':    'operación',
        'area_total': 'Áreas_tot',
        'area_riego': 'Áreas_baj',
        'com_estado': 'estado1',
        'com_opera':  'operaci_1',
        'ret_estado': 'estado2',
    },
    'tomas_otros_sectores': {
        'q_opera':    'caudal_m3_',
    },
    'laterales': {
        'q_opera':    'operación',
        'area_total': 'Área_tota',
        'eh_toma':    'número_to',
    },
}


# ══════════════════════════════════════════════════════════════════════════
#  Emisión del SQL
# ══════════════════════════════════════════════════════════════════════════
def lit(v):
    if v is None:
        return 'NULL'
    if isinstance(v, bool):
        return 'true' if v else 'false'
    return "'" + str(v).replace("'", "''") + "'"


def resolver():
    """Expande las copias y aplica los nombres de columna que ya existen.

    Devuelve {codigo_de_tipo_activo: [(campo, etiqueta, dato, dominio, oblig)]}
    con el orden del catálogo y sin duplicados.
    """
    salida = {}
    for plantilla, campos in TIPOS.items():
        destinos = COPIAS.get(plantilla, [plantilla])
        for tipo in destinos:
            ren = RENOMBRES.get(tipo, {})
            vistos, lista = set(), []
            for campo, etiqueta, dato, dom, oblig in campos:
                campo = ren.get(campo, campo)
                if campo in vistos:
                    continue
                vistos.add(campo)
                # La etiqueta se afina cuando la ficha precisa el objeto.
                clave = campo[5:] if campo.startswith('insp_') else None
                if clave and clave.endswith('_c'):
                    base = MATIZ.get((clave[:-2], plantilla))
                    if base:
                        etiqueta = f'Inspección · {base} — detalle'
                elif clave:
                    base = MATIZ.get((clave, plantilla))
                    if base:
                        etiqueta = f'Inspección · {base}'
                lista.append((campo, etiqueta, dato, dom, oblig))
            salida[tipo] = lista
    return salida


def main():
    import sys
    w = sys.stdout.write

    # Comprobación de coherencia antes de emitir nada: un campo declarado dos
    # veces en el mismo tipo con distinta etiqueta es un error de catálogo, y
    # en SQL se vería como un UPDATE que oscila entre dos valores.
    problemas = []
    for tipo, campos in TIPOS.items():
        visto = {}
        for c in campos:
            if c[0] in visto and visto[c[0]] != c:
                problemas.append(f'{tipo}.{c[0]}: declarado dos veces distinto')
            visto[c[0]] = c
        for c in campos:
            if c[3] and c[3] not in DOMINIOS and c[3] not in DOMINIOS_BASE:
                problemas.append(f'{tipo}.{c[0]}: dominio «{c[3]}» no declarado')
    # Un renombre que apunte a un campo que el catálogo no declara es un error
    # silencioso: el campo viejo se quedaría fuera y el nuevo nunca se crearía.
    for tipo, ren in RENOMBRES.items():
        plantilla = next((p for p, d in COPIAS.items() if tipo in d), tipo)
        declarados = {c[0] for c in TIPOS.get(plantilla, [])}
        for viejo in ren:
            if viejo not in declarados:
                problemas.append(f'{tipo}: renombra «{viejo}», que {plantilla} no declara')
    if problemas:
        sys.stderr.write('CATALOGO INCOHERENTE:\n  ' + '\n  '.join(problemas) + '\n')
        sys.exit(1)

    resuelto = resolver()
    total = sum(len(v) for v in resuelto.values())

    w(f"""-- ════════════════════════════════════════════════════════════════════════
--  Catálogo de campos de las fichas de inspección — {len(resuelto)} tipos, {total} campos
--
--  GENERADO por gen_catalogo.py. No editar a mano: corregir el generador y
--  volver a emitirlo, o el próximo cambio pisa la corrección.
--
--  Las diez fichas son la misma plantilla con bloques intercambiables, así
--  que el catálogo declara cada campo UNA vez y lo expande a los tipos que
--  lo usan. Un mismo dato lleva el mismo nombre de campo en todos los tipos
--  ('ing_long' es la longitud de la transición de ingreso en canoa, sifón,
--  alcantarilla y desarenador), de modo que un reporte pueda cruzar tipos
--  sin traducir nombres.
--
--      docker exec -i jurp_postgis psql -U gis_admin -d jurp_gis \\
--          < alta_catalogo_fichas.sql
--
--  Idempotente y autocorrectivo: inserta lo que falta y alinea lo que ya
--  está (etiqueta, tipo, dominio, obligatoriedad, orden). Correrlo dos veces
--  no duplica nada y deja la base igual a este archivo.
--
--  Si un código de tipo de activo no existe en tipos_activo, se avisa por
--  NOTICE y NO se inserta nada de ese tipo. Nunca queda a medias.
-- ════════════════════════════════════════════════════════════════════════

-- ── Diagnóstico: los tipos que hay en la base, para cotejar los códigos ──
SELECT codigo, nombre, evaluable FROM tipos_activo ORDER BY codigo;

BEGIN;

-- ── 1) Dominios ─────────────────────────────────────────────────────────
INSERT INTO dominios (dominio, codigo, etiqueta, orden)
SELECT v.dominio, v.codigo, v.etiqueta, v.orden
FROM (VALUES
""")
    filas = []
    for dom, ops in DOMINIOS.items():
        for i, (cod, et) in enumerate(ops, 1):
            filas.append(f"  ({lit(dom)}, {lit(cod)}, {lit(et)}, {i})")
    w(',\n'.join(filas))
    w("""
) AS v(dominio, codigo, etiqueta, orden)
WHERE NOT EXISTS (
  SELECT 1 FROM dominios d
  WHERE d.dominio = v.dominio AND d.codigo = v.codigo
);

-- ── 2) El catálogo, declarado una sola vez ──────────────────────────────
-- Va en tabla temporal para que el INSERT y el UPDATE de alineación lean la
-- misma lista: mantener dos copias de cientos de filas es garantía de que
-- algún día una se quede atrás.
CREATE TEMP TABLE catalogo (
  tipo_activo text    NOT NULL,
  campo       text    NOT NULL,
  etiqueta    text    NOT NULL,
  tipo_dato   text    NOT NULL,
  dominio     text,
  obligatorio boolean NOT NULL,
  orden       integer NOT NULL,
  PRIMARY KEY (tipo_activo, campo)
) ON COMMIT DROP;

INSERT INTO catalogo VALUES
""")
    filas = []
    for tipo in sorted(resuelto):
        for i, (campo, etiqueta, dato, dom, oblig) in enumerate(resuelto[tipo], 1):
            filas.append(
                f"  ({lit(tipo)}, {lit(campo)}, {lit(etiqueta)}, {lit(dato)}, "
                f"{lit(dom)}, {lit(oblig)}, {i * 10})")
    w(',\n'.join(filas))
    w(""";

-- ── 3) Insertar lo que falta, solo de tipos que existen ─────────────────
INSERT INTO campos_evaluables (tipo_activo, campo, etiqueta, tipo_dato,
                               dominio, obligatorio, orden)
SELECT k.tipo_activo, k.campo, k.etiqueta, k.tipo_dato,
       k.dominio, k.obligatorio, k.orden
FROM catalogo k
WHERE EXISTS (SELECT 1 FROM tipos_activo t WHERE t.codigo = k.tipo_activo)
  AND NOT EXISTS (
    SELECT 1 FROM campos_evaluables c
    WHERE c.tipo_activo = k.tipo_activo AND c.campo = k.campo
  );

-- ── 4) Alinear lo que ya estaba ─────────────────────────────────────────
UPDATE campos_evaluables c
SET etiqueta    = k.etiqueta,
    tipo_dato   = k.tipo_dato,
    dominio     = k.dominio,
    obligatorio = k.obligatorio,
    orden       = k.orden
FROM catalogo k
WHERE c.tipo_activo = k.tipo_activo
  AND c.campo = k.campo
  AND (c.etiqueta, c.tipo_dato, c.dominio, c.obligatorio, c.orden)
      IS DISTINCT FROM
      (k.etiqueta, k.tipo_dato, k.dominio, k.obligatorio, k.orden);

-- ── 5) Los tipos del catálogo quedan marcados como evaluables ───────────
UPDATE tipos_activo t SET evaluable = true
WHERE EXISTS (SELECT 1 FROM catalogo k WHERE k.tipo_activo = t.codigo)
  AND NOT t.evaluable;

-- ── 6) Avisos y guardas ─────────────────────────────────────────────────
DO $$
DECLARE faltan text; sobran text; sin_dom text;
BEGIN
  -- Un desplegable sin opciones se ve igual que un campo roto en el
  -- teléfono, y en campo no hay a quién preguntarle. Esto aborta.
  SELECT string_agg(DISTINCT c.dominio, ', ') INTO sin_dom
  FROM campos_evaluables c
  WHERE EXISTS (SELECT 1 FROM catalogo k WHERE k.tipo_activo = c.tipo_activo)
    AND c.dominio IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM dominios d WHERE d.dominio = c.dominio);
  IF sin_dom IS NOT NULL THEN
    RAISE EXCEPTION 'hay campos apuntando a dominios que no existen: %', sin_dom;
  END IF;

  -- Tipos del catálogo que no están en la base: hay que crearlos o
  -- corregir el código en el generador.
  SELECT string_agg(DISTINCT k.tipo_activo, ', ') INTO faltan
  FROM catalogo k
  WHERE NOT EXISTS (SELECT 1 FROM tipos_activo t WHERE t.codigo = k.tipo_activo);
  IF faltan IS NOT NULL THEN
    RAISE NOTICE 'NO se cargaron estos tipos porque no existen en tipos_activo: %', faltan;
    RAISE NOTICE 'Revisa el SELECT de arriba, corrige el codigo y vuelve a correr.';
  END IF;

  -- Campos que están en la base y no en el catálogo: no se borran solos.
  SELECT string_agg(c.tipo_activo || '.' || c.campo, ', ') INTO sobran
  FROM campos_evaluables c
  WHERE EXISTS (SELECT 1 FROM catalogo k WHERE k.tipo_activo = c.tipo_activo)
    AND NOT EXISTS (SELECT 1 FROM catalogo k
                    WHERE k.tipo_activo = c.tipo_activo AND k.campo = c.campo);
  IF sobran IS NOT NULL THEN
    RAISE NOTICE 'campos fuera del catalogo, revisalos a mano: %', sobran;
  END IF;
END $$;

COMMIT;

-- ── 7) Comprobación ─────────────────────────────────────────────────────
SELECT t.codigo,
       t.nombre,
       count(c.campo)                                AS campos,
       count(c.campo) FILTER (WHERE c.obligatorio)   AS obligatorios
FROM tipos_activo t
LEFT JOIN campos_evaluables c ON c.tipo_activo = t.codigo
GROUP BY t.codigo, t.nombre
HAVING count(c.campo) > 0
ORDER BY t.codigo;
""")


if __name__ == '__main__':
    main()
