// ═══════════════════════════════════════════════════════════════════════════
//  El costeo, en cuentas puras
// ═══════════════════════════════════════════════════════════════════════════
//
// Todo lo que calcula sin mirar la pantalla: horas efectivas, horas muertas,
// metrados por fórmula, el resumen de actividades de un parte, y la ida y
// vuelta de esas actividades al backend.
//
// ESTABA DENTRO DE Incidentes.jsx, en medio de 3.900 líneas de JSX. Sale de
// ahí porque la pantalla de gestión de costeo va a servir también para una
// actividad de obra, y estas cuentas tienen que ser LAS MISMAS en las dos.
// Dos copias de «cuántas horas se cobran» acabarían cobrando distinto el día
// que alguien arregle una y no la otra.
//
// Nada de aquí toca estado de React ni el DOM: se le pasa lo que necesita y
// devuelve un número, un texto o un objeto. Por eso se puede comprobar sola.

import imgExcavacion from '../assets/metrado/excavacion.png';
import imgCarguio from '../assets/metrado/carguio.png';
import imgDescolmatacion from '../assets/metrado/descolmatacion.png';
import imgEliminacion from '../assets/metrado/eliminacion.png';
import imgConformacion from '../assets/metrado/conformacion.png';
import imgEnrocado from '../assets/metrado/enrocado.png';
import imgPerfilado from '../assets/metrado/perfilado.png';
import imgHabilitacion from '../assets/metrado/habilitacion.png';

export const IMG_METRADO = {
  'CARGUIO DE MATERIAL': imgCarguio, 'CONFORMACION DE DIQUE': imgConformacion,
  'DESCOLMATACION DE CAUCE': imgDescolmatacion, 'ELIMINACION': imgEliminacion,
  'ENROCADO': imgEnrocado, 'EXCAVACION DE MATERIAL': imgExcavacion,
  'HABILITACION DE ACCESO': imgHabilitacion, 'PERFILADO DE TALUD': imgPerfilado,
};

export const ESTADOS = {
  pat: { texto: 'Pendiente',   color: '#f59f00' },
  eat: { texto: 'En Atención', color: '#206bc4' },
  ate: { texto: 'Resuelto',    color: '#2fb344' },
  cer: { texto: 'Cerrado',     color: '#2fb344' },
};

export const txtEstadoInc = (e) => ESTADOS[e]?.texto || e || '-';

export const getFechaHoy = () => {
  const hoy = new Date();
  return hoy.toISOString().split('T')[0];
};

export const generarCorrelativo = () => {
  const fecha = new Date();
  const strFecha = `${fecha.getFullYear()}${String(fecha.getMonth()+1).padStart(2,'0')}${String(fecha.getDate()).padStart(2,'0')}`;
  return `PD-____-${strFecha}`;
};

export const estadoInicialRecurso = {
  tipo: 'Personal', descripcion: '', cantidad: 1, precioUnitario: 0, unidad: 'und',
  // A que partida del presupuesto se carga este gasto. Vacio = ninguna, que
  // es valido: hay gasto que no cuelga de ninguna partida. A mano de obra e
  // insumos se les imputa COSTO, no metrado; el avance no lo toca.
  partidaId: '',
  // Día en que se hizo el trabajo / se usó el insumo. No es la fecha de
  // carga: sirve para costear por periodo aunque se registre días después.
  fechaRecurso: getFechaHoy(),
  numPersonas: 1, horasTrabajo: 8, horasExtras: 0, 
  horasEfectivas: '', obsReduccion: '',
  numeroParte: generarCorrelativo(), 
  fechaParte: getFechaHoy(), 
  turno: 'Día', zonaTrabajo: '',
  proveedor: '', operador: '', licencia: '', categoria: '',
  equipoId: '', equipo: '',
  origen: 'JURP',
  marcaId: '', marca: '',
  modeloId: '', placa: '', modeloMaquina: '', codigoMaquina: '',
  hmInicio: '', hmFin: '', combustible: '', vale: '', fotoVale: null,
  actividad: '', actividadOtros: '', observaciones: '', fotoParte: null,
  incluirMetrado: false, longitud: '', altura: '', anchoSup: '', anchoInf: '',
  nViajes: '', volTolva: '', fe: '1.25', hPromedio: '', anchoBase: '', corona: '', talud: '',
  // Metrado: por defecto se ingresa MANUAL. Al marcar el check se calcula por fórmula.
  calcularMetrado: false, metradoManual: '', unidadMetrado: 'm3'
};

/**
 * La unidad de una partida, con la ortografia del selector de metrado.
 *
 * El presupuesto escribe m³ y m², y el selector guarda m3 y m2. Comparar sin
 * igualar primero daba que «m³» y «m3» eran unidades distintas, y el metrado
 * no sumaba al avance sin que nada lo explicara.
 *
 * Devuelve la unidad tal cual si no es una de las cuatro que el selector
 * conoce: una partida en «und» o en «mes» existe y hay que poder imputarle,
 * aunque no haya opcion para ella en el combo.
 */
export const normaUnidad = (u) => (u || '').toString().trim().toLowerCase()
  .replace('\u00b3', '3').replace('\u00b2', '2');

export const UNIDADES_METRADO = ['m', 'm2', 'm3', 'glb'];

export const UNIDADES_METRADO_TXT = { m: 'm', m2: 'm²', m3: 'm³', glb: 'glb' };

/**
 * Las líneas nuevas se miden con la grilla del Excel de JURP; las viejas, con
 * las fórmulas de geometría que había antes.
 *
 * Se marca en la propia línea y no por fecha porque hay cientos de partes ya
 * guardados: al reabrir uno de 2025 tiene que seguir diciendo lo mismo que
 * decía, con su trapecio y su imagen de referencia. La marca viaja dentro de
 * `medidas`, que es texto libre en el backend, así que esto no necesitó
 * ninguna migración.
 */
export const MODO_GRILLA = 'grilla';

const num0 = (v) => { const x = parseFloat(v); return Number.isFinite(x) ? x : 0; };

/**
 * El metrado tal como lo saca la hoja de JURP:
 *
 *   PARCIAL = CANTIDAD × LARGO × ANCHO × ALTURA × Coefi.
 *   TOTAL   = PARCIAL × N° ESTRUC.
 *
 * `u` es la fila del catálogo de unidades, que dice qué casillas participan.
 * Las que esa unidad no habilita se ignoran aunque traigan número: un galón
 * no tiene largo, y multiplicar por uno que alguien dejó escrito daría un
 * total que nadie sabría de dónde salió.
 *
 * EL ÁREA SUSTITUYE A LARGO × ANCHO, no se suma a ellos. Es la segunda vía
 * que ofrece la hoja: un volumen sale de largo × ancho × altura, o de área ×
 * altura cuando el área venía medida de antes. Si hay área escrita, manda
 * ella.
 *
 * Un factor vacío NO cuenta como cero. Con un cero de verdad el total sería
 * siempre cero mientras se está escribiendo, y parecería que la fórmula está
 * rota. Vacío significa «esta casilla no participa».
 */
export const metradoGrilla = (a, u) => {
  const usa = (campo) => (u ? !!u[campo] : true);
  const trozos = [];
  let v = 1;

  const mete = (valor, etiqueta) => {
    const x = num0(valor);
    if (x <= 0) return;
    v *= x;
    trozos.push(`${x} ${etiqueta}`);
  };

  mete(a.cantidad, 'cant.');

  const area = num0(a.area);
  if (usa('usa_area') && area > 0) {
    mete(area, 'área');
  } else {
    if (usa('usa_largo')) mete(a.largo, 'largo');
    if (usa('usa_ancho')) mete(a.ancho, 'ancho');
  }
  if (usa('usa_altura')) mete(a.altura, 'altura');
  if (usa('usa_coeficiente')) mete(a.coeficiente, 'coef.');

  const parcial = v;
  mete(a.nEstruc, 'estruc.');

  return {
    val: round4(v),
    unit: (u ? u.codigo : '') || a.unidadMetrado || '',
    parcial: round4(parcial),
    formula: trozos.length ? trozos.join(' × ') : 'sin medidas',
  };
};

export const estadoInicialActividad = {
  zonaTrabajo: '', actividad: '', actividadOtros: '', observacion: '',
  hmInicio: '', hmFin: '', horasEfectivas: '', obsReduccion: '',
  // Grilla de metrado. `cantidad`, `coeficiente` y `nEstruc` nacen en 1
  // porque es lo que son el 90% de las veces y escribirlo cada vez es ruido.
  // `altura` no está aquí: ya existía abajo, entre los campos del calculador
  // viejo, y significa lo mismo —la altura en metros—. Declararla dos veces
  // dejaba el valor a merced de cuál de las dos líneas quedara última.
  modoMetrado: MODO_GRILLA,
  cantidad: '1', largo: '', ancho: '', area: '',
  coeficiente: '1', nEstruc: '1',
  // Numero del comprobante, solo en las unidades que lo piden (combustible).
  // Va en `medidas`, que es texto libre: sin columna nueva ni migracion.
  vale: '',
  /* La maquina llego ya con combustible: estas horas se trabajaron con lo
   * que traia y no hubo carga. Distingue dos cosas que en la hoja se ven
   * igual: una linea sin carga porque nadie la apunto -un dato que falta- y
   * una linea sin carga porque no hizo falta -un dato-. */
  combustibleAbastecido: false,
  // Lo que sale de la grilla, ya calculado. Se guarda en la línea porque la
  // grilla necesita el catálogo de unidades para saber qué casillas cuentan,
  // y el PDF, los reportes y el avance no lo tienen a mano: así siguen
  // leyendo el metrado por donde lo leían.
  metradoValor: '',
  // Partida del presupuesto a la que se imputa el metrado. Se guarda el id
  // (para sumar el avance) y tambien el codigo y la descripcion: un
  // presupuesto se modifica, y un parte ya firmado tiene que seguir
  // diciendo a que se cargo aunque esa partida cambie despues.
  partidaId: '', partidaCodigo: '', partidaDescripcion: '',
  calcularMetrado: false, metradoManual: '', unidadMetrado: 'm3',
  longitud: '', altura: '', anchoSup: '', anchoInf: '',
  anchoBase: '', corona: '', talud: '', hPromedio: '',
  nViajes: '', volTolva: '', fe: '1.25',
};

export const detalleMaquinaDeParte = (parte, catalogo) => {
  // Si el parte trae el FK de la máquina, esa es la identidad exacta.
  if (parte.maquina) {
    const m = catalogo.find(x => String(x.id) === String(parte.maquina));
    if (m) {
      return [m.codigo, '·', m.equipo_nombre || parte.equipment_name || '', m.marca_nombre || parte.brand_name || '', m.modelo || '']
        .filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    }
  }
  const mp = (parte.model_plate || '').trim();
  const marcaTxt = (parte.brand_name || '').trim();
  const equipoTxt = (parte.equipment_name || '').trim();

  let modeloTxt = mp, placaTxt = mp;
  if (mp.includes('/')) {
    const [a, b] = mp.split('/', 2).map(x => x.trim());
    modeloTxt = a; placaTxt = b || '';
  }

  let maq = null;
  if (placaTxt) maq = catalogo.find(m => m.placa && m.placa.toLowerCase() === placaTxt.toLowerCase());
  if (!maq && modeloTxt) {
    const porModelo = catalogo.filter(m => m.modelo && m.modelo.toLowerCase() === modeloTxt.toLowerCase());
    maq = porModelo.find(m => (m.marca_nombre || '').toLowerCase() === marcaTxt.toLowerCase()) || porModelo[0];
  }

  const codigo = maq?.codigo || '';
  const modelo = maq?.modelo || (modeloTxt !== placaTxt ? modeloTxt : '');
  return [codigo, codigo ? '·' : '', equipoTxt, marcaTxt, modelo]
    .filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
};

export const correlativoMas = (numero, n) => {
  if (!numero || n <= 0) return numero;
  const m = String(numero).match(/^(.*?)(\d+)(-\d+)$/);
  if (!m) return numero;
  const [, pre, num, post] = m;
  return `${pre}${String(parseInt(num, 10) + n).padStart(num.length, '0')}${post}`;
};

export const round2 = (n) => Math.round(((parseFloat(n) || 0) + Number.EPSILON) * 100) / 100;

export const round4 = (n) => Math.round(((parseFloat(n) || 0) + Number.EPSILON) * 10000) / 10000;

export const fmtCant = (n) => (parseFloat(n) || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 4 });

export const STEP4 = '0.0001';

export const horasDeActividad = (a) => {
  const i = parseFloat(a?.hmInicio), f = parseFloat(a?.hmFin);
  if (!Number.isFinite(i) || !Number.isFinite(f)) return 0;
  return round4(Math.max(0, f - i));
};

export const heDeActividad = (a) => (a?.horasEfectivas === '' || a?.horasEfectivas == null)
  ? horasDeActividad(a)
  : round4(parseFloat(a.horasEfectivas) || 0);

export const hayReduccionEn = (a) => heDeActividad(a) < horasDeActividad(a);

export const muertasDeActividad = (a) => round4(Math.max(0, horasDeActividad(a) - heDeActividad(a)));

export const muertasDeLista = (lista) => round4((lista || []).reduce((t, a) => t + muertasDeActividad(a), 0));

export const resumenReduccion = (lista) => (lista || [])
  .filter(a => hayReduccionEn(a))
  .map(a => `${textoActividad(a)}: ${(a.obsReduccion || '').trim()}`)
  .join(' · ');

/**
 * Las horas que se cobran de un parte tal como viene del backend.
 *
 * Tres fuentes, por orden: la cabecera si la trae, la suma de sus
 * actividades si las tiene, y el tramo de horometro si no hay ni una cosa ni
 * la otra. Los partes antiguos no llevaban actividades, asi que el tercer
 * caso no es defensivo: es como estan guardados cientos de ellos.
 */
export const horasCobradas = (i) => {
  if (i.horas_efectivas != null && i.horas_efectivas !== '') return round4(i.horas_efectivas);
  if (i.actividades && i.actividades.length) {
    return round4(i.actividades.reduce((t, a) => {
      if (a.horas_efectivas != null && a.horas_efectivas !== '') return t + (parseFloat(a.horas_efectivas) || 0);
      return t + Math.max(0, (parseFloat(a.end_horometer) || 0) - (parseFloat(a.start_horometer) || 0));
    }, 0));
  }
  return round4(Math.max(0, (parseFloat(i.end_horometer) || 0) - (parseFloat(i.start_horometer) || 0)));
};

export const horasDeLista = (lista) => round4((lista || []).reduce((t, a) => t + heDeActividad(a), 0));

export const tramoDeLista = (lista) => round4((lista || []).reduce((t, a) => t + horasDeActividad(a), 0));

export const rangoHorometro = (lista) => {
  const ini = (lista || []).map(a => parseFloat(a.hmInicio)).filter(Number.isFinite);
  const fin = (lista || []).map(a => parseFloat(a.hmFin)).filter(Number.isFinite);
  return { inicio: ini.length ? Math.min(...ini) : '', fin: fin.length ? Math.max(...fin) : '' };
};

export const calcMetradoDe = (r) => {
  /* Línea de la grilla nueva: el valor ya viene calculado en la propia línea.
   * Entra por aquí a propósito, en vez de que cada consumidor sepa de los dos
   * modos: el PDF, los reportes, el resumen y el avance siguen llamando a
   * calcMetradoDe como siempre y no se enteran del cambio. */
  if (r.modoMetrado === MODO_GRILLA) {
    return {
      val: parseFloat(r.metradoValor) || 0,
      unit: r.unidadMetrado || '',
    };
  }
  // OTROS, o sin el check marcado → el metrado es el que el usuario escribe a mano.
  if (r.actividad === 'OTROS' || !r.calcularMetrado) {
    return { val: parseFloat(r.metradoManual) || 0, unit: UNIDADES_METRADO_TXT[r.unidadMetrado] || r.unidadMetrado || 'm³' };
  }
  const L = parseFloat(r.longitud)||0, h = parseFloat(r.altura)||0;
  const B = parseFloat(r.anchoBase)||0, b = parseFloat(r.corona)||0;
  const N = parseFloat(r.nViajes)||0, vt = parseFloat(r.volTolva)||0;
  const fe = parseFloat(r.fe)||1.25, Z = parseFloat(r.talud)||0;
  const hp = parseFloat(r.hPromedio)||0, a = parseFloat(r.anchoSup)||0;
  const Ws = parseFloat(r.anchoSup)||0, Wi = parseFloat(r.anchoInf)||0;
  switch (r.actividad) {
    case 'EXCAVACION DE MATERIAL': return {val:((B+b)/2)*h*L, unit:'m³'};
    case 'CARGUIO DE MATERIAL': return {val:N*vt/fe, unit:'m³'};
    case 'DESCOLMATACION DE CAUCE': return {val:a*hp*L, unit:'m³'};
    case 'ELIMINACION': return {val:N*vt, unit:'m³'};
    case 'CONFORMACION DE DIQUE': {const Bc=b+2*Z*h; return {val:((Bc+b)/2)*h*L, unit:'m³'};}
    case 'ENROCADO': return {val:((B+b)/2)*h*L, unit:'m³'};
    case 'PERFILADO DE TALUD': return {val:h*Math.sqrt(1+Z*Z)*L, unit:'m²'};
    case 'HABILITACION DE ACCESO': return {val:L, unit:'m'};
    default: return {val:((Ws+Wi)/2)*h*L, unit:'m³'};
  }
};

export const fmtNum = (n) => (parseFloat(n) || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Cómo se llama la línea en el PDF, los reportes y el resumen del parte.
 *
 * En la grilla nueva no hay «actividad realizada»: el trabajo ES la partida
 * que se imputa, y su descripción es la que ya está escrita en el
 * presupuesto, aprobada. Inventar otro nombre al lado solo daba dos textos
 * para la misma cosa, que acababan sin parecerse.
 */
export const textoActividad = (r) => {
  if (r.modoMetrado === MODO_GRILLA) {
    return (r.partidaDescripcion || '').trim();
  }
  return r.actividad === 'OTROS' ? (r.actividadOtros || '').trim() : (r.actividad || '');
};

export const resumenActividades = (lista) => {
  if (!lista || !lista.length) return { texto: '', metrado: 0, unidad: 'm3', calculado: false };
  // Se agrupa por la unidad EFECTIVA: una línea calculada por fórmula la
  // impone la propia fórmula (PERFILADO da m², no m³), no el desplegable.
  const codigoUnidad = { 'm': 'm', 'm²': 'm2', 'm³': 'm3', 'glb': 'glb' };
  const porUnidad = {};
  lista.forEach(a => {
    const mv = calcMetradoDe(a);
    const u = codigoUnidad[mv.unit] || a.unidadMetrado || 'm3';
    porUnidad[u] = round4((porUnidad[u] || 0) + (mv.val || 0));
  });
  const unidades = Object.keys(porUnidad);
  const dominante = unidades.reduce((mejor, u) => (porUnidad[u] > porUnidad[mejor] ? u : mejor), unidades[0]);
  return {
    texto: lista.map(a => textoActividad(a)).filter(Boolean).join(' / '),
    metrado: porUnidad[dominante],
    unidad: dominante,
    calculado: lista.every(a => a.actividad !== 'OTROS' && !!a.calcularMetrado),
  };
};

export const actividadesParaBackend = (lista) => (lista || []).map((a, i) => {
  const mv = calcMetradoDe(a);
  const calculado = a.actividad !== 'OTROS' && !!a.calcularMetrado;
  const num = (v) => (v === '' || v == null ? null : v);

  return {
    orden: i + 1,
    work_zone_text: a.zonaTrabajo || '',
    actividad: textoActividad(a),
    start_horometer: num(a.hmInicio), end_horometer: num(a.hmFin),
    horas_efectivas: a.horasEfectivas === '' || a.horasEfectivas == null
      ? null : round4(parseFloat(a.horasEfectivas) || 0),
    obs_reduccion: a.obsReduccion || '',
    // El backend espera el id; '' significa sin partida. El codigo y la
    // descripcion viajan copiados a proposito, no por duplicar.
    partida: a.partidaId || '',
    partida_codigo: a.partidaCodigo || '',
    partida_descripcion: a.partidaDescripcion || '',
    width_top: num(a.anchoSup), width_bottom: num(a.anchoInf),
    height: num(a.altura), length: num(a.longitud),
    metrado: mv.val.toFixed(4),
    metrado_unidad: calculado ? mv.unit : (a.unidadMetrado || 'm3'),
    metrado_calculado: calculado,
    observacion: a.observacion || '',
    medidas: JSON.stringify({
      actividad: a.actividad, actividadOtros: a.actividadOtros || '',
      calcularMetrado: !!a.calcularMetrado, metradoManual: a.metradoManual,
      unidadMetrado: a.unidadMetrado, longitud: a.longitud, altura: a.altura,
      anchoSup: a.anchoSup, anchoInf: a.anchoInf, anchoBase: a.anchoBase,
      corona: a.corona, talud: a.talud, hPromedio: a.hPromedio,
      nViajes: a.nViajes, volTolva: a.volTolva, fe: a.fe,
      // La grilla. `medidas` es texto libre en el backend, así que todo esto
      // cabe sin migración: no hay columnas nuevas que crear.
      modoMetrado: a.modoMetrado || '',
      cantidad: a.cantidad, largo: a.largo, ancho: a.ancho, area: a.area,
      coeficiente: a.coeficiente, nEstruc: a.nEstruc,
      metradoValor: a.metradoValor, vale: a.vale || '',
      combustibleAbastecido: !!a.combustibleAbastecido,
    }),
  };
});

export const actividadesDesdeBackend = (arr) => (arr || []).map(a => {
  let crudo = {};
  try { crudo = a.medidas ? JSON.parse(a.medidas) : {}; } catch { crudo = {}; }
  /* Un parte guardado ANTES de la grilla no lleva la marca, y hay cientos.
   * `estadoInicialActividad` sí la trae —es lo que toca para una línea
   * nueva—, así que hay que quitársela a los viejos o se leerían con la
   * grilla y aparecerían con metrado cero. */
  const esGrilla = crudo.modoMetrado === MODO_GRILLA;
  return {
    ...estadoInicialActividad,
    modoMetrado: esGrilla ? MODO_GRILLA : '',
    ...crudo,
    zonaTrabajo: a.work_zone_text || '',
    hmInicio: a.start_horometer != null ? String(a.start_horometer) : '',
    hmFin: a.end_horometer != null ? String(a.end_horometer) : '',
    horasEfectivas: a.horas_efectivas != null ? String(a.horas_efectivas) : '',
    obsReduccion: a.obs_reduccion || '',
    partidaId: a.partida != null ? String(a.partida) : '',
    partidaCodigo: a.partida_codigo || '',
    partidaDescripcion: a.partida_descripcion || '',
    // Sin 'medidas' (partes de antes de este cambio) se conserva al menos el
    // metrado guardado, en vez de recalcularlo a cero con campos vacíos.
    /* El `|| 'OTROS'` es para los partes viejos sin `medidas`, que no decían
     * con qué fórmula se midieron. Una línea de la grilla tampoco trae
     * actividad —no existe el campo— pero ahí vacío es lo correcto: caer en
     * OTROS la pondría en modo manual y perdería su metrado. */
    actividad: esGrilla ? '' : (crudo.actividad || (IMG_METRADO[a.actividad] ? a.actividad : 'OTROS')),
    actividadOtros: esGrilla ? '' : (crudo.actividadOtros || (IMG_METRADO[a.actividad] ? '' : (a.actividad || ''))),
    calcularMetrado: crudo.calcularMetrado ?? false,
    metradoManual: crudo.metradoManual ?? (a.metrado != null ? String(a.metrado) : ''),
    unidadMetrado: crudo.unidadMetrado || a.metrado_unidad || 'm3',
    anchoSup: crudo.anchoSup ?? (a.width_top ?? ''),
    anchoInf: crudo.anchoInf ?? (a.width_bottom ?? ''),
    altura: crudo.altura ?? (a.height ?? ''),
    longitud: crudo.longitud ?? (a.length ?? ''),
    observacion: a.observacion || '',
  };
});

export const fechaDe = (r) => (r.tipo === 'Maquinaria' ? r.fechaParte : r.fechaRecurso) || '';

export const normalizar = (txt) => (txt || '')
  .toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/\s+/g, ' ')
  .trim();

export const CATEGORIAS = [
  { key: 'Personal',   titulo: 'MANO DE OBRA' },
  { key: 'Insumo',     titulo: 'MATERIALES / INSUMOS' },
  { key: 'Maquinaria', titulo: 'EQUIPO' },
];

export const fechaCorta = (iso) => {
  if (!iso) return '—';
  const [, m, d] = String(iso).slice(0, 10).split('-');
  return d && m ? `${d}/${m}` : iso;
};

export const formulaMetrado = {
  'EXCAVACION DE MATERIAL':'V = ((B+b)/2) × h × L','CARGUIO DE MATERIAL':'V = N × Vol.tolva / Fe',
  'DESCOLMATACION DE CAUCE':'V = a × h prom × L','ELIMINACION':'V = N × Vol.tolva',
  'CONFORMACION DE DIQUE':'V = ((B+b)/2) × h × L, B=b+2Zh','ENROCADO':'V = ((B+b)/2) × h × L',
  'PERFILADO DE TALUD':'A = h × √(1+Z²) × L','HABILITACION DE ACCESO':'Metrado = L',
};
