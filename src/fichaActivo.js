/**
 * Qué características se enseñan de un activo, en qué orden y cómo.
 *
 * El globo del mapa enseñaba ocho campos elegidos a mano —canal, progresiva,
 * tipo, material, estado, usuarios, área y observaciones— y descartaba en
 * silencio todo lo demás que traía la capa. Para una toma eso puede bastar;
 * para una alcantarilla o una compuerta, lo que el inspector necesita ver
 * —luz, diámetro, número de hojas, año— simplemente no aparecía, y no había
 * forma de saber desde la pantalla que existía.
 *
 * Aquí se enseña TODO lo que trae la capa. El trabajo no es elegir campos
 * sino ordenarlos para que se lean: primero lo que identifica la estructura,
 * después dónde está, después cómo es, y al final lo que sobra.
 *
 * LAS ETIQUETAS SALEN DEL PROPIO SERVIDOR cuando las hay. El endpoint
 * campos-evaluables ya devuelve el nombre bonito de cada campo para el
 * formulario de evaluación; reusarlo evita mantener un diccionario paralelo
 * que se queda viejo en cuanto alguien añade una columna.
 */

/* Lo que no se enseña nunca: identificadores internos y restos de la
 * geometría. No aportan y empujan hacia abajo lo que sí. */
const OCULTOS = new Set([
  'fid', 'id', 'pk', 'gid', 'objectid', 'geom', 'geometry', 'the_geom',
  'shape_length', 'shape_area', 'st_length', 'st_area',
  'ambito',            // va en la cabecera de la ficha
  'tipo_activo',       // es la capa, ya está en el subtítulo
]);

/* El orden de lectura. Lo que no esté aquí va después, alfabético. */
const ORDEN = [
  // identidad
  'codigo', 'nombre', 'tipo', 'clase', 'subtipo',
  // ubicación
  'nombre_canal', 'canal', 'progresiva', 'margen', 'sector', 'comision',
  'bloque', 'lateral', 'altitud', 'este', 'norte',
  // cómo es
  'material', 'estado', 'luz', 'diametro', 'ancho', 'alto', 'largo',
  'longitud', 'seccion', 'capacidad', 'caudal', 'num_hojas', 'num_compuertas',
  'tipo_compuerta', 'accionamiento', 'revestimiento', 'ano_construccion',
  'campania_alta',
  // a quién sirve
  'num_usuarios', 'area_total', 'area_bajo_riego', 'predios',
  // al final
  'observaciones',
];
const PESO = new Map(ORDEN.map((c, i) => [c, i]));

/* Unidades que no vienen en el dato y sin las cuales el número miente. */
const UNIDAD = {
  area_total: 'ha', area_bajo_riego: 'ha', altitud: 'm s. n. m.',
  longitud: 'm', ancho: 'm', alto: 'm', largo: 'm', luz: 'm', diametro: 'm',
  caudal: 'm³/s', capacidad: 'm³', seccion: 'm²', este: 'm', norte: 'm',
};

/** 'nombre_canal' → 'Nombre canal'. Solo cuando el servidor no da etiqueta. */
export const etiquetaDe = (clave) => {
  const t = String(clave).replace(/_/g, ' ').trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
};

/**
 * Un valor, en texto, o null si no hay nada que enseñar.
 *
 * Vacío, null y la cadena 'None' que a veces llega de Django son lo mismo: no
 * se sabe. Y un campo que no se sabe no ocupa una fila en la ficha, porque
 * una tabla llena de guiones no se lee.
 *
 * OJO con el cero y con false: SÍ son datos. "0 usuarios" dice algo muy
 * distinto de "no se sabe cuántos usuarios", y confundirlos es la forma más
 * fácil de que una ficha mienta.
 */
export function valorTexto(clave, v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'boolean') return v ? 'Sí' : 'No';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return null;
    const n = Number.isInteger(v) ? String(v) : String(+v.toFixed(3));
    return UNIDAD[clave] ? `${n} ${UNIDAD[clave]}` : n;
  }
  const s = String(v).trim();
  if (s === '' || s.toLowerCase() === 'none' || s.toLowerCase() === 'null') return null;
  if (s.toLowerCase() === 'true') return 'Sí';
  if (s.toLowerCase() === 'false') return 'No';
  return UNIDAD[clave] && /^-?[\d.,]+$/.test(s) ? `${s} ${UNIDAD[clave]}` : s;
}

/**
 * Las características de un activo, listas para pintar.
 *
 * @param props     properties del GeoJSON
 * @param etiquetas { campo: 'Etiqueta' } del formulario, si se cargó
 * @returns [{ clave, etiqueta, valor }]
 */
export function caracteristicas(props = {}, etiquetas = {}) {
  const filas = [];
  for (const [clave, bruto] of Object.entries(props || {})) {
    if (OCULTOS.has(clave)) continue;
    const valor = valorTexto(clave, bruto);
    if (valor === null) continue;
    filas.push({ clave, etiqueta: etiquetas[clave] || etiquetaDe(clave), valor });
  }
  filas.sort((a, b) => {
    const pa = PESO.has(a.clave) ? PESO.get(a.clave) : ORDEN.length;
    const pb = PESO.has(b.clave) ? PESO.get(b.clave) : ORDEN.length;
    return pa !== pb ? pa - pb : a.etiqueta.localeCompare(b.etiqueta, 'es');
  });
  return filas;
}

/** Cuántos campos trae la capa y cuántos están sin rellenar. */
export function cobertura(props = {}) {
  let total = 0, conDato = 0;
  for (const [clave, v] of Object.entries(props || {})) {
    if (OCULTOS.has(clave)) continue;
    total++;
    if (valorTexto(clave, v) !== null) conDato++;
  }
  return { total, conDato, vacios: total - conDato };
}

/** El nombre con el que se titula la ficha. */
export const tituloActivo = (props = {}, etiquetaCapa = 'Activo', fid = '') =>
  props.nombre || props.codigo || `${etiquetaCapa} #${fid}`;
