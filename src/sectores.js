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

/* ── DE QUÉ CAMPO SALE EL NOMBRE ──

   Primero lo buscaba en una lista de nombres probables —'nombre', 'sector',
   'nom_sector'…— y cogía el primero que existiera. Salió mal de la peor
   manera: los cinco sectores quedaron rotulados «PECH», porque ese era el
   valor del primer campo que encajaba. Cinco etiquetas iguales no rotulan
   nada, y encima parecen puestas a propósito.

   El fallo de fondo es que la lista adivina. Un rótulo que sirve para
   distinguir cinco polígonos tiene que ser DISTINTO en cada uno: eso no se
   adivina del nombre de la columna, se cuenta. Así que se miran todos los
   campos y gana el que más valores distintos tenga; la lista de nombres
   probables queda solo para desempatar.

   Y si ninguno distingue —todos los campos repiten—, no se rotula. Es más
   honesto un sector sin nombre que cinco diciendo lo mismo. */

/* Campos que nunca son el nombre: identificadores internos, restos de la
 * geometría y el ámbito, que por definición se repite en toda la capa. */
const NO_ROTULAN = new Set([
  'fid', 'id', 'pk', 'gid', 'objectid', 'geom', 'geometry', 'the_geom',
  'shape_length', 'shape_area', 'st_length', 'st_area', 'ambito',
]);

/* Solo para desempatar entre campos que distinguen igual de bien. */
const PREFERIDOS = ['nombre', 'sector', 'nom_sector', 'nombre_sector',
                    'sector_nom', 'nom', 'descripcion', 'codigo'];

const texto = (v) => {
  if (v === null || v === undefined) return '';
  const s = String(v).trim();
  return s.toLowerCase() === 'none' || s.toLowerCase() === 'null' ? '' : s;
};

/**
 * Qué campo rotula mejor este conjunto de polígonos, o null si ninguno.
 *
 * Gana el que más valores distintos tiene. A igualdad, el que suene a nombre;
 * y a igualdad de eso, el más corto, que es el que cabe escrito en el mapa.
 */
export function campoRotulo(features = []) {
  const n = features.length;
  if (!n) return null;

  const cuenta = new Map();   // campo → Set de valores
  const largo = new Map();    // campo → suma de longitudes
  for (const f of features) {
    for (const [k, v] of Object.entries(f?.properties || {})) {
      if (NO_ROTULAN.has(k)) continue;
      const s = texto(v);
      if (!s || s.length > 60) continue;      // un párrafo no es un rótulo
      if (!cuenta.has(k)) { cuenta.set(k, new Set()); largo.set(k, 0); }
      cuenta.get(k).add(s);
      largo.set(k, largo.get(k) + s.length);
    }
  }

  let mejor = null;
  for (const [k, vals] of cuenta) {
    // Con un solo valor distinto no rotula: es justo el caso "PECH".
    if (vals.size < 2) continue;
    const pref = PREFERIDOS.indexOf(k);
    const cand = {
      campo: k,
      distintos: vals.size,
      pref: pref < 0 ? PREFERIDOS.length : pref,
      medio: largo.get(k) / n,
    };
    if (!mejor
      || cand.distintos > mejor.distintos
      || (cand.distintos === mejor.distintos && cand.pref < mejor.pref)
      || (cand.distintos === mejor.distintos && cand.pref === mejor.pref
          && cand.medio < mejor.medio)) {
      mejor = cand;
    }
  }
  return mejor ? mejor.campo : null;
}

/** El nombre de un polígono según el campo elegido para toda la capa. */
export const nombreRasgo = (p, campo) => {
  if (campo) return texto(p?.[campo]) || null;
  // Sin campo decidido —un polígono suelto, fuera de una capa— se cae a la
  // lista de siempre. No distingue nada, pero no deja la ficha muda.
  for (const k of PREFERIDOS) {
    const s = texto(p?.[k]);
    if (s) return s;
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

/**
 * Lo que necesita una capa de sectores para pintarse: el color de cada
 * polígono y de qué campo sale su nombre.
 *
 * Se calcula una vez por FeatureCollection. La clave es el propio objeto: si
 * la capa se vuelve a descargar llega otro y se recalcula solo.
 *
 * → { color(f) → hex, campo, nombre(f) → string|null }
 */
export function datosDeCapa(fc) {
  if (!fc?.features?.length) return null;
  let d = cacheSector.get(fc);
  if (!d) {
    const color = colorearPorVecindad(fc.features);
    const campo = campoRotulo(fc.features);
    d = {
      campo,
      color: (f) => color.get(f),
      nombre: (f) => nombreRasgo(f?.properties, campo),
    };
    cacheSector.set(fc, d);
  }
  return d;
}
