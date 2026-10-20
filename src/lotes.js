/**
 * Lotes y licencia de agua.
 *
 * LAS DOS CAPAS ERAN LA MISMA. «Áreas con licencia» y «Lotes» se dibujaban
 * como coberturas distintas, en el mismo verde amarillento y casi sin
 * relleno, y era imposible distinguirlas a ojo. Lo comprobamos contra el
 * servidor: las 205 áreas son, geométricamente, 205 de los 211 lotes —
 * coincidencia del 100 % firmando las coordenadas a 10 cm—, con el mismo
 * código catastral, el mismo nombre y la misma superficie.
 *
 * Lo único que las separaba:
 *
 *   - Lotes trae 6 más. Son los que NO tienen licencia.
 *   - Áreas trae un campo extra, `padron`, con un único valor: 'LICENCIA'.
 *
 * O sea que Lotes es el padrón completo y Áreas su subconjunto con licencia.
 * Dibujar las dos era pintar 205 polígonos dos veces —y en un mapa que ya iba
 * justo— para esconder la única información que importaba: cuál tiene
 * licencia y cuál no. Eso no se podía leer; había que encender y apagar una
 * capa y comparar de memoria.
 *
 * Ahora se dibuja UNA capa, Lotes, y la licencia es el color.
 *
 * EL CRUCE VA POR `codcat`, el código catastral, que es el identificador
 * propio de la parcela y viene en las dos. No por la geometría: firmar
 * cuatrocientos polígonos en cada repintado cuesta más que el dibujo entero,
 * y el código ya es la clave que usa el catastro para esto mismo.
 */

/* Verde y naranja: el par pasa el validador todos-contra-todos en visión
 * normal y en las tres deficiencias de color. Y no se apoya solo en el
 * color — el globo de cada lote dice si tiene licencia con todas las letras. */
export const COLOR_CON_LICENCIA = '#1baf7a';
export const COLOR_SIN_LICENCIA = '#eb6834';

export const CAPA_LICENCIAS = 'areas_licencia';

const clave = (p) => {
  const v = p?.codcat;
  if (v === null || v === undefined) return null;
  const s = String(v).trim().toUpperCase();
  return s && s !== 'NONE' && s !== 'NULL' ? s : null;
};

/**
 * Los códigos catastrales que tienen licencia.
 *
 * @param fcAreas FeatureCollection de la capa de áreas con licencia
 * @returns Set de códigos, vacío si la capa no ha llegado
 */
export function codcatsConLicencia(fcAreas) {
  const s = new Set();
  for (const f of fcAreas?.features || []) {
    const k = clave(f?.properties);
    if (k) s.add(k);
  }
  return s;
}

/**
 * ¿Este lote tiene licencia?
 *
 * Devuelve null —no false— cuando no se puede saber: sin la capa de licencias
 * cargada, o sin código catastral con el que cruzar. Un lote que no sabemos
 * no es un lote sin licencia, y pintarlo de naranja estaría acusando a
 * alguien de regar sin derecho por un dato que falta.
 */
export function tieneLicencia(feature, conLicencia) {
  if (!conLicencia || conLicencia.size === 0) return null;
  const k = clave(feature?.properties);
  if (!k) return null;
  return conLicencia.has(k);
}

/** El color de un lote según su licencia. `base` es el de la capa. */
export const colorLote = (feature, conLicencia, base) => {
  const l = tieneLicencia(feature, conLicencia);
  return l === null ? base : (l ? COLOR_CON_LICENCIA : COLOR_SIN_LICENCIA);
};

/** Para el globo: «Con licencia», «Sin licencia» o «Licencia: sin dato». */
export const textoLicencia = (feature, conLicencia) => {
  const l = tieneLicencia(feature, conLicencia);
  return l === null ? 'Licencia: sin dato' : (l ? 'Con licencia' : 'Sin licencia');
};

/**
 * El reparto, para el panel y la leyenda.
 * → { con, sin, sinDato, total }
 */
export function reparto(fcLotes, conLicencia) {
  const r = { con: 0, sin: 0, sinDato: 0, total: 0 };
  for (const f of fcLotes?.features || []) {
    r.total++;
    const l = tieneLicencia(f, conLicencia);
    if (l === null) r.sinDato++;
    else if (l) r.con++;
    else r.sin++;
  }
  return r;
}
