/**
 * Sectores: un color para cada uno, y su nombre.
 *
 * Aqui esta la parte que no es React, para poder comprobarla sin montar el
 * mapa: repartir colores mirando quien linda con quien, y sacar el nombre del
 * sector venga en el campo que venga.
 */

/* ── POR QUE NO VALE "UN COLOR POR SECTOR" A SECAS ──

   Las capas de polígonos pintaban todas sus piezas del mismo color, así que
   los sectores del PECH se veían como una sola mancha verde: se intuía el
   contorno y no dónde acababa uno y empezaba el siguiente.

   NO BASTA CON "UN COLOR POR SECTOR". Medí la paleta categórica con el
   validador en modo todos-contra-todos, que es el que corresponde a un mapa
   —cualquier sector puede acabar al lado de cualquier otro— y los ocho
   colores no pasan: el peor par, rojo contra naranja, queda en ΔE 7.1 para
   visión normal, por debajo del piso de 15. Quitando los que chocan tampoco:
   violeta contra azul 10.5, magenta contra naranja 12.9, amarillo contra
   naranja 13.7. Solo los tres primeros pasan limpios.

   Pero el problema de un mapa no es distinguir CUALQUIER par: es distinguir
   los que se tocan. Eso es coloreado de mapas, y por el teorema de los cuatro
   colores cuatro bastan para que dos regiones vecinas nunca coincidan. Así
   que se usan cuatro medidos y se reparten mirando quién linda con quién, en
   vez de repartirlos al azar y rezar.

   Y la identidad no la lleva el color: cada sector lleva su nombre escrito
   encima. El color solo separa del de al lado.
   ══════════════════════════════════════════════════════════ */

const PALETA_SECTOR = [
  '#2a78d6',   // azul
  '#eb6834',   // naranja
  '#1baf7a',   // aqua
  '#eda100',   // amarillo — el cuarto, solo si la vecindad lo obliga
];

/** El nombre del sector, mire como lo mire la capa. */
export const nombreRasgo = (p) => {
  for (const k of ['nombre', 'sector', 'nom_sector', 'nombre_sector',
                   'sector_nom', 'nom', 'codigo', 'descripcion']) {
    const v = p?.[k];
    if (v !== null && v !== undefined && String(v).trim() !== '') return String(v).trim();
  }
  return null;
};

/** Caja envolvente de una geometría, recorriendo las coordenadas que haya. */
function caja(geom) {
  let o = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  const ver = (c) => {
    if (typeof c[0] === 'number') {
      if (c[0] < o) o = c[0];
      if (c[0] > e) e = c[0];
      if (c[1] < s) s = c[1];
      if (c[1] > n) n = c[1];
      return;
    }
    for (const x of c) ver(x);
  };
  if (geom?.coordinates) ver(geom.coordinates);
  return Number.isFinite(o) ? [o, s, e, n] : null;
}

/**
 * Reparte colores de modo que dos sectores que se tocan nunca repitan.
 *
 * La vecindad se mide con las cajas envolventes. Es una aproximación —dos
 * cajas pueden solaparse sin que los polígonos se toquen— y se equivoca
 * siempre del lado prudente: cree que son vecinos de más, nunca de menos. Lo
 * que no puede pasar es lo contrario, dar el mismo color a dos que sí lindan.
 *
 * El reparto es voraz empezando por el que más vecinos tiene, que es el orden
 * que menos colores gasta. Si los cuatro se agotan —no deberia, pero un dato
 * raro no va a dejar un polígono sin pintar— se reutiliza el menos usado
 * entre los vecinos.
 *
 * → WeakMap feature → color
 */
export function colorearPorVecindad(features = [], paleta = PALETA_SECTOR) {
  const cajas = features.map(f => caja(f?.geometry));
  const tocan = (a, b) => a && b
    && a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];

  const vecinos = features.map(() => []);
  for (let i = 0; i < features.length; i++) {
    for (let j = i + 1; j < features.length; j++) {
      if (tocan(cajas[i], cajas[j])) { vecinos[i].push(j); vecinos[j].push(i); }
    }
  }

  const orden = features.map((_, i) => i)
    .sort((a, b) => vecinos[b].length - vecinos[a].length);

  const color = new Array(features.length).fill(-1);
  for (const i of orden) {
    const usados = new Set(vecinos[i].map(j => color[j]).filter(c => c >= 0));
    let elegido = paleta.findIndex((_, k) => !usados.has(k));
    if (elegido < 0) {
      // Mas vecinos que colores: se escoge el menos repetido alrededor, que
      // es lo menos malo. Con cuatro colores y poligonos de verdad no pasa.
      const cuenta = paleta.map((_, k) => vecinos[i].filter(j => color[j] === k).length);
      elegido = cuenta.indexOf(Math.min(...cuenta));
    }
    color[i] = elegido;
  }

  const m = new WeakMap();
  features.forEach((f, i) => m.set(f, paleta[color[i]] || paleta[0]));
  return m;
}

/* Se calcula una vez por FeatureCollection. La clave es el propio objeto: si
 * la capa se vuelve a descargar llega otro y se recalcula solo. */
const cacheSector = new WeakMap();
export function coloresDeCapa(fc) {
  if (!fc?.features?.length) return null;
  let m = cacheSector.get(fc);
  if (!m) { m = colorearPorVecindad(fc.features); cacheSector.set(fc, m); }
  return m;
}
