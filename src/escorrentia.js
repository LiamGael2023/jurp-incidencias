/**
 * Escorrentía: por dónde se iría el agua que cae sobre cada pluviómetro.
 *
 * Sigue la máxima pendiente del terreno desde la estación (método D8: en cada
 * celda, el agua pasa a la vecina más baja de las ocho) hasta que llega al
 * mar, se estanca o se aleja demasiado. Por el camino se anotan los cruces con
 * el Canal Madre, el Lateral 10, las redes y los caminos: ese punto es donde
 * la lluvia de esa zona le pega a la infraestructura, que es la pregunta de
 * operación —"si llueve fuerte en Quebrada Honda, ¿dónde entra el agua al
 * canal?"—.
 *
 * EL RELIEVE es el mismo que dibuja el 3D: teselas Terrarium de AWS (SRTM de
 * 30 m), a zoom 12, o sea celdas de unos 38 m en Virú. Se piden solo las que
 * pisa el recorrido, no un mosaico de todo el valle.
 *
 * LO QUE NO SABE. El modelo de elevación es anterior a los canales y no ve
 * drenes, alcantarillas ni bordos de chacra: en la pampa irrigada, casi plana,
 * el recorrido es orientativo. En las quebradas, donde la pendiente manda, es
 * fiable. Por eso cada recorrido dice cómo terminó, y "se estanca" es una
 * respuesta válida, no un error.
 */

export const ZOOM_DEM = 12;
const LADO = 256;
const TILES_DEM = 'https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png';

const MAX_PASOS = 5000;
const MAX_KM = 60;
// Si no hay vecina más baja (un hoyo del modelo, o terreno plano), se busca
// la celda más baja más cercana dentro de este radio y se salta hasta ella.
// 30 celdas son ~1,1 km: suficiente para atravesar los charcos falsos del
// SRTM, poco para inventar un cauce donde el agua de verdad se queda.
const RADIO_BRECHA = 30;
const COTA_MAR = 1.5;    // metros

// ── Coordenadas: lng/lat ↔ píxel global de la teselación ──────────────
const n = (z) => LADO * 2 ** z;
export function aPixel(lng, lat, z = ZOOM_DEM) {
  const s = Math.sin(lat * Math.PI / 180);
  return [
    ((lng + 180) / 360) * n(z),
    (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n(z),
  ];
}
export function aLngLat(px, py, z = ZOOM_DEM) {
  const lng = (px / n(z)) * 360 - 180;
  const k = Math.PI - (2 * Math.PI * py) / n(z);
  return [lng, (180 / Math.PI) * Math.atan(Math.sinh(k))];
}
/** Metros que mide un píxel a esa latitud. */
export const metrosPixel = (lat, z = ZOOM_DEM) =>
  (40075016.686 * Math.cos(lat * Math.PI / 180)) / n(z);

// ── Teselas de relieve ─────────────────────────────────────────────────
/**
 * Lector de cotas con caché de teselas. `cargar(tx, ty)` devuelve un
 * Float32Array de 256×256 cotas o null; se inyecta para poder probar el
 * trazado con un relieve sintético sin red.
 */
export function crearRelieve(cargar, z = ZOOM_DEM) {
  const cache = new Map();
  const pendientes = new Map();
  const clave = (tx, ty) => `${tx}/${ty}`;

  async function asegurar(px, py) {
    const tx = Math.floor(px / LADO), ty = Math.floor(py / LADO);
    const k = clave(tx, ty);
    if (cache.has(k)) return;
    if (!pendientes.has(k)) {
      pendientes.set(k, Promise.resolve(cargar(tx, ty, z)).catch(() => null)
        .then(t => { cache.set(k, t); pendientes.delete(k); }));
    }
    await pendientes.get(k);
  }
  // Síncrono: solo para celdas cuya tesela ya está en caché.
  function cota(px, py) {
    const tx = Math.floor(px / LADO), ty = Math.floor(py / LADO);
    const t = cache.get(clave(tx, ty));
    if (!t) return null;
    return t[(py - ty * LADO) * LADO + (px - tx * LADO)];
  }
  return { z, asegurar, cota, teselas: () => cache.size };
}

/** Cargador real: tesela Terrarium → cotas en metros. Solo navegador. */
export async function cargarTeselaTerrarium(tx, ty, z) {
  const url = TILES_DEM.replace('{z}', z).replace('{x}', tx).replace('{y}', ty);
  const r = await fetch(url);
  if (!r.ok) return null;
  const bmp = await createImageBitmap(await r.blob());
  const c = typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(LADO, LADO)
    : Object.assign(document.createElement('canvas'), { width: LADO, height: LADO });
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  const px = ctx.getImageData(0, 0, LADO, LADO).data;
  const out = new Float32Array(LADO * LADO);
  for (let i = 0; i < out.length; i++) {
    // Codificación Terrarium: (R·256 + G + B/256) − 32768
    out[i] = px[i * 4] * 256 + px[i * 4 + 1] + px[i * 4 + 2] / 256 - 32768;
  }
  return out;
}

// ── Trazado ────────────────────────────────────────────────────────────
const VECINAS = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
];

/**
 * Recorrido del agua desde (lng, lat).
 * → { coords: [[lng,lat]…], cotas: [m…], km, fin, cotaInicio, cotaFin }
 *   fin: 'mar' | 'estanca' | 'largo' | 'sin_relieve'
 */
export async function trazarFlujo(relieve, lng, lat) {
  const z = relieve.z;
  let [fx, fy] = aPixel(lng, lat, z);
  let x = Math.floor(fx), y = Math.floor(fy);
  const mpp = metrosPixel(lat, z);
  const visto = new Set();
  const k = (a, b) => a * 1e7 + b;

  await relieve.asegurar(x, y);
  let e = relieve.cota(x, y);
  if (e == null) return { coords: [[lng, lat]], cotas: [], km: 0, fin: 'sin_relieve', cotaInicio: null, cotaFin: null };

  const celdas = [[x, y]];
  const cotas = [e];
  visto.add(k(x, y));
  let dist = 0;
  let fin = 'largo';

  for (let paso = 0; paso < MAX_PASOS; paso++) {
    if (e <= COTA_MAR) { fin = 'mar'; break; }
    if (dist * mpp / 1000 > MAX_KM) { fin = 'largo'; break; }

    // 1. Vecina con mayor caída por metro recorrido.
    let mejor = null, mejorCaida = 0;
    for (const [dx, dy, d] of VECINAS) {
      const nx = x + dx, ny = y + dy;
      if (visto.has(k(nx, ny))) continue;
      await relieve.asegurar(nx, ny);
      const en = relieve.cota(nx, ny);
      if (en == null) continue;
      const caida = (e - en) / d;
      if (caida > mejorCaida) { mejorCaida = caida; mejor = [nx, ny, en, d]; }
    }

    if (mejor) {
      [x, y, e] = mejor;
      dist += mejor[3];
      visto.add(k(x, y));
      celdas.push([x, y]); cotas.push(e);
      continue;
    }

    // 2. Hoyo o llano: la celda más baja más cercana, anillo por anillo.
    let salto = null;
    for (let r = 2; r <= RADIO_BRECHA && !salto; r++) {
      let candidata = null;
      for (let dx = -r; dx <= r; dx++) {
        for (let dy = -r; dy <= r; dy++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;   // solo el anillo
          const nx = x + dx, ny = y + dy;
          if (visto.has(k(nx, ny))) continue;
          await relieve.asegurar(nx, ny);
          const en = relieve.cota(nx, ny);
          if (en == null || en >= e - 0.01) continue;
          const d = Math.hypot(dx, dy);
          if (!candidata || d < candidata[3] - 1e-9 || (Math.abs(d - candidata[3]) < 1e-9 && en < candidata[2])) {
            candidata = [nx, ny, en, d];
          }
        }
      }
      salto = candidata;
    }
    if (!salto) { fin = 'estanca'; break; }

    // Se recorre la recta hasta la celda baja, para que la línea sea
    // continua y esas celdas no vuelvan a usarse.
    const [sx, sy, se, sd] = salto;
    const pasos = Math.ceil(sd);
    for (let i = 1; i <= pasos; i++) {
      const ix = Math.round(x + (sx - x) * i / pasos), iy = Math.round(y + (sy - y) * i / pasos);
      if (visto.has(k(ix, iy))) continue;
      visto.add(k(ix, iy));
      celdas.push([ix, iy]);
      cotas.push(i === pasos ? se : e);
    }
    dist += sd;
    x = sx; y = sy; e = se;
  }

  // Centro de cada celda, con la estación como primer punto exacto.
  const crudo = celdas.map(([cx, cy], i) => (i === 0 ? [lng, lat] : aLngLat(cx + 0.5, cy + 0.5, z)));
  return {
    coords: suavizar(crudo),
    cotas,
    km: (dist * mpp) / 1000,
    fin,
    cotaInicio: cotas[0],
    cotaFin: cotas[cotas.length - 1],
  };
}

/** Media móvil de 5 puntos: quita la escalera de la rejilla sin mover los extremos. */
export function suavizar(coords, v = 2) {
  if (coords.length < 2 * v + 2) return coords;
  return coords.map((p, i) => {
    if (i === 0 || i === coords.length - 1) return p;
    let sx = 0, sy = 0, c = 0;
    for (let j = Math.max(0, i - v); j <= Math.min(coords.length - 1, i + v); j++) {
      sx += coords[j][0]; sy += coords[j][1]; c++;
    }
    return [sx / c, sy / c];
  });
}

// ── Cruces con la infraestructura ──────────────────────────────────────
function segmentos(geo) {
  const out = [];
  const agregar = (linea) => { for (let i = 1; i < linea.length; i++) out.push([linea[i - 1], linea[i]]); };
  const visitar = (g) => {
    if (!g) return;
    if (g.type === 'LineString') agregar(g.coordinates);
    else if (g.type === 'MultiLineString') g.coordinates.forEach(agregar);
    else if (g.type === 'Polygon') g.coordinates.forEach(agregar);
    else if (g.type === 'MultiPolygon') g.coordinates.forEach(p => p.forEach(agregar));
    else if (g.type === 'GeometryCollection') g.geometries.forEach(visitar);
  };
  for (const f of geo?.features || []) visitar(f.geometry);
  return out;
}

function corte(p1, p2, q1, q2) {
  const d = (p2[0] - p1[0]) * (q2[1] - q1[1]) - (p2[1] - p1[1]) * (q2[0] - q1[0]);
  if (Math.abs(d) < 1e-15) return null;
  const t = ((q1[0] - p1[0]) * (q2[1] - q1[1]) - (q1[1] - p1[1]) * (q2[0] - q1[0])) / d;
  const u = ((q1[0] - p1[0]) * (p2[1] - p1[1]) - (q1[1] - p1[1]) * (p2[0] - p1[0])) / d;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { t, punto: [p1[0] + t * (p2[0] - p1[0]), p1[1] + t * (p2[1] - p1[1])] };
}

const kmEntre = (a, b) => {
  const mLat = 111.32, mLng = 111.32 * Math.cos(a[1] * Math.PI / 180);
  return Math.hypot((b[0] - a[0]) * mLng, (b[1] - a[1]) * mLat);
};

/**
 * Prepara las capas una sola vez: segmentos con su caja, para descartar
 * rápido los que no tocan el recorrido.
 * @param capas [{ nombre, data, color }]
 */
export function prepararCapas(capas) {
  return capas
    .filter(c => c?.data?.features?.length)
    .map(c => ({
      nombre: c.nombre, color: c.color,
      segs: segmentos(c.data).map(([a, b]) => ({
        a, b,
        x0: Math.min(a[0], b[0]), x1: Math.max(a[0], b[0]),
        y0: Math.min(a[1], b[1]), y1: Math.max(a[1], b[1]),
      })),
    }));
}

/**
 * Primer cruce del recorrido con cada capa, en orden de distancia.
 * → [{ capa, color, punto: [lng,lat], km }]
 */
export function cruces(coords, capasPrep) {
  const encontrados = new Map();
  let km = 0;
  for (let i = 1; i < coords.length; i++) {
    const p1 = coords[i - 1], p2 = coords[i];
    const x0 = Math.min(p1[0], p2[0]), x1 = Math.max(p1[0], p2[0]);
    const y0 = Math.min(p1[1], p2[1]), y1 = Math.max(p1[1], p2[1]);
    for (const c of capasPrep) {
      if (encontrados.has(c.nombre)) continue;
      for (const s of c.segs) {
        if (s.x1 < x0 || s.x0 > x1 || s.y1 < y0 || s.y0 > y1) continue;
        const r = corte(p1, p2, s.a, s.b);
        if (r) {
          encontrados.set(c.nombre, { capa: c.nombre, color: c.color, punto: r.punto, km: km + kmEntre(p1, r.punto) });
          break;
        }
      }
    }
    km += kmEntre(p1, p2);
  }
  return [...encontrados.values()].sort((a, b) => a.km - b.km);
}

/** Frase corta con el destino del agua, para el panel. */
export function destino(r) {
  if (!r) return '';
  const agua = r.cruces?.find(c => !/camino|v[ií]a/i.test(c.capa));
  if (agua) return `entra al ${agua.capa} a ${agua.km.toFixed(1)} km`;
  if (r.fin === 'mar') return `llega al mar a ${r.km.toFixed(1)} km`;
  if (r.fin === 'estanca') return `se estanca a ${r.km.toFixed(1)} km (zona plana)`;
  if (r.fin === 'sin_relieve') return 'sin relieve disponible';
  return `recorre más de ${Math.round(r.km)} km`;
}
