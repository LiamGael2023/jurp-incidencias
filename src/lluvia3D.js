/**
 * Gemelo de lluvia para la vista 3D.
 *
 * Reconstruye un día completo de lluvia en intervalos de 15 minutos —el ritmo
 * al que reportan las Davis— para poder reproducirlo en el tiempo sobre el
 * terreno. Todo lo que dibuja Mapa3D sale de aquí:
 *
 *   intensidad[id][slot]  mm caídos en ese cuarto de hora
 *   acumulado[id][slot]   mm desde las 00:00 hasta el final de ese slot
 *
 * Los niveles de alerta son los MISMOS que usa el mapa 2D (UMBRALES_LLUVIA en
 * Mapa.jsx): milímetros por intervalo, no acumulado del día. Si el 3D pintara
 * otro color para el mismo número, el operario dejaría de creerle a los dos.
 *
 * Las estaciones InnovaWeather no tienen serie (su widget solo da la lectura
 * del momento), así que en la reproducción salen como "sin historial".
 */
import { fmtFecha } from './lluviaEstacion';

export const SLOTS = 96;              // 24 h × 4 cuartos de hora
export const MIN_SLOT = 15;

// Mismo código oficial que NIVELES_ALERTA / UMBRALES_LLUVIA del mapa 2D.
export const NIVELES = [
  { desde: 0.21, nivel: 'ama', color: '#FFF200', texto: '#0b2545', nombre: 'Amarilla' },
  { desde: 0.63, nivel: 'nar', color: '#F37021', texto: '#0b2545', nombre: 'Naranja' },
  { desde: 1.06, nivel: 'roj', color: '#ED1C24', texto: '#ffffff', nombre: 'Roja' },
];
export const nivelDe = (mm) => NIVELES.filter(n => mm >= n.desde).pop() || null;

export const COLOR_SIN_DATOS = '#64748b';
export const COLOR_LLOVIO = '#35B6E9';   // llovió antes, ahora no
export const COLOR_SECO = '#9fb3c8';

export const horaDeMinuto = (min) => {
  const m = Math.max(0, Math.min(1439, Math.floor(min)));
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

// Solo las estaciones del backend JURP tienen serie histórica.
const tieneSerie = (e) => e.tipo === 'pluviometro' || e.tipo === 'davis';

// ── Datos reales ───────────────────────────────────────────────────────
async function serieDelDia(stationId, fecha, token) {
  const f = fmtFecha(fecha);
  const url = `/api/v1/mobile/davis/rain-gauges/filtered-data/?start_date=${f}&end_date=${f}`
    + `&station_id=${stationId}&metric=rainfall_mm&max_points=9000`;
  try {
    const r = await fetch(url, { headers: { Authorization: `Token ${token}` } });
    if (!r.ok) return null;
    const j = await r.json();
    const mismoDia = fecha.toDateString();
    const serie = new Float32Array(SLOTS);
    let n = 0;
    for (const x of j.data || []) {
      const t = new Date(x.timestamp);
      const v = parseFloat(x.value);
      if (Number.isNaN(v) || t.toDateString() !== mismoDia) continue;
      n++;
      if (v > 0) serie[Math.floor((t.getHours() * 60 + t.getMinutes()) / MIN_SLOT)] += v;
    }
    // Sin lecturas no es "0 mm": es que no se sabe. Se devuelve null para que
    // el mapa lo diga en vez de afirmar que no llovió.
    return n ? serie : null;
  } catch {
    return null;
  }
}

/** Serie de un día para todas las estaciones. → { [id]: Float32Array | null } */
export async function cargarDia(estaciones, fecha, token) {
  const conSerie = estaciones.filter(tieneSerie);
  const series = await Promise.all(conSerie.map(e => serieDelDia(e.id, fecha, token)));
  const out = {};
  estaciones.forEach(e => { out[e.id] = null; });
  conSerie.forEach((e, i) => { out[e.id] = series[i]; });
  return out;
}

// ── Simulación ─────────────────────────────────────────────────────────
// Para presentar el gemelo cuando no llueve (casi todo el año en la costa) y
// para el "¿qué pasaría si?". Usa las coordenadas REALES de las estaciones:
// una celda de tormenta baja de la sierra hacia el mar por la tarde, como
// bajan los eventos de Niño costero sobre Virú y Chao.

function prng(semilla) {
  let s = semilla >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * @param intensidadPico  mm por cuarto de hora en el núcleo de la celda
 *                        (1.06 = roja; 2 ya es un evento extremo aquí).
 */
export function simularDia(estaciones, { intensidadPico = 1.6, semilla = 7 } = {}) {
  const pts = estaciones.filter(e => Number.isFinite(e.lat) && Number.isFinite(e.lng));
  const out = {};
  estaciones.forEach(e => { out[e.id] = null; });
  if (!pts.length) return out;

  const lats = pts.map(e => e.lat), lngs = pts.map(e => e.lng);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  const spanLng = Math.max(maxLng - minLng, 0.2);
  const spanLat = Math.max(maxLat - minLat, 0.2);
  const rnd = prng(semilla);

  // Dos celdas: la principal cruza de NE a SO entre 13:00 y 20:00, una
  // secundaria más débil y temprana por el sur.
  const celdas = [
    { ini: 13 * 4, fin: 20 * 4, a: intensidadPico, sigma: 0.32,
      desde: [maxLng + 0.15, maxLat + 0.05], hasta: [minLng - 0.1, minLat + spanLat * 0.3] },
    { ini: 10 * 4, fin: 15 * 4, a: intensidadPico * 0.45, sigma: 0.22,
      desde: [maxLng + 0.05, minLat + spanLat * 0.2], hasta: [minLng + spanLng * 0.3, minLat - 0.1] },
  ];

  for (const e of pts) {
    // Las estaciones que hoy están caídas siguen caídas en la simulación:
    // inventar datos donde no hay equipo funcionando sería engañoso.
    if (e.caida) continue;
    const serie = new Float32Array(SLOTS);
    for (let s = 0; s < SLOTS; s++) {
      let v = 0;
      for (const c of celdas) {
        if (s < c.ini || s > c.fin) continue;
        const p = (s - c.ini) / (c.fin - c.ini);
        const cx = c.desde[0] + (c.hasta[0] - c.desde[0]) * p;
        const cy = c.desde[1] + (c.hasta[1] - c.desde[1]) * p;
        const d2 = (e.lng - cx) ** 2 + (e.lat - cy) ** 2;
        const envolvente = Math.sin(Math.PI * p) ** 0.7;      // crece y se apaga
        v += c.a * envolvente * Math.exp(-d2 / (2 * c.sigma ** 2));
      }
      v *= 0.75 + rnd() * 0.5;                                // ruido de pluviómetro
      serie[s] = v < 0.03 ? 0 : Math.round(v * 100) / 100;    // resolución 0.01 mm
    }
    out[e.id] = serie;
  }
  return out;
}

// ── Derivados ──────────────────────────────────────────────────────────
/** → { intensidad, acumulado, maxSlot: Float32Array(96) con el máximo por slot } */
export function preparar(series) {
  const intensidad = {}, acumulado = {};
  const maxSlot = new Float32Array(SLOTS);
  for (const [id, s] of Object.entries(series)) {
    if (!s) { intensidad[id] = null; acumulado[id] = null; continue; }
    const ac = new Float32Array(SLOTS);
    let suma = 0;
    for (let i = 0; i < SLOTS; i++) {
      suma += s[i];
      ac[i] = suma;
      if (s[i] > maxSlot[i]) maxSlot[i] = s[i];
    }
    intensidad[id] = s;
    acumulado[id] = ac;
  }
  return { intensidad, acumulado, maxSlot };
}

export const hayLluvia = (series) =>
  Object.values(series).some(s => s && s.some(v => v > 0));

// ── Geometría ──────────────────────────────────────────────────────────
/** Polígono circular (para fill-extrusion). */
export function circulo(lng, lat, radioM = 380, n = 20) {
  const dLat = radioM / 111320;
  const dLng = radioM / (111320 * Math.cos(lat * Math.PI / 180));
  const anillo = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    anillo.push([lng + Math.cos(a) * dLng, lat + Math.sin(a) * dLat]);
  }
  return anillo;
}

/** Recuadro que contiene a las estaciones, con margen. → [oeste, sur, este, norte] */
export function bboxEstaciones(estaciones, margen = 0.18) {
  const pts = estaciones.filter(e => Number.isFinite(e.lat) && Number.isFinite(e.lng));
  if (!pts.length) return null;
  return [
    Math.min(...pts.map(e => e.lng)) - margen,
    Math.min(...pts.map(e => e.lat)) - margen,
    Math.max(...pts.map(e => e.lng)) + margen,
    Math.max(...pts.map(e => e.lat)) + margen,
  ];
}

// ── Manto interpolado (IDW) ────────────────────────────────────────────
// Rampa secuencial azul→violeta, distinta del código de alerta a propósito:
// el manto dice "cuánta agua", los colores de alerta los llevan las columnas.
const RAMPA = [
  [0.00, [125, 211, 252, 0]],
  [0.06, [125, 211, 252, 110]],
  [0.30, [56, 152, 236, 170]],
  [0.60, [37, 99, 235, 200]],
  [0.85, [124, 58, 237, 215]],
  [1.00, [219, 39, 119, 225]],
];
function colorRampa(t) {
  t = Math.max(0, Math.min(1, t));
  for (let i = 1; i < RAMPA.length; i++) {
    if (t <= RAMPA[i][0]) {
      const [t0, c0] = RAMPA[i - 1], [t1, c1] = RAMPA[i];
      const k = (t - t0) / (t1 - t0);
      return c0.map((v, j) => v + (c1[j] - v) * k);
    }
  }
  return RAMPA[RAMPA.length - 1][1];
}
export const gradienteCSS = () =>
  `linear-gradient(90deg, ${RAMPA.map(([t, c]) => `rgba(${c[0]},${c[1]},${c[2]},${Math.max(c[3], 60) / 255}) ${t * 100}%`).join(', ')})`;

/**
 * Pinta el manto sobre un canvas que MapLibre usa como fuente 'canvas'.
 * @param puntos  [{lng, lat, v}] solo estaciones con dato
 * @param tope    valor que corresponde al extremo de la rampa
 * @param alcance grados: más allá de esta distancia a la estación más
 *                cercana el manto se desvanece (no se inventa lluvia lejos).
 */
export function pintarManto(canvas, bbox, puntos, tope, alcance = 0.2) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const img = ctx.createImageData(W, H);
  const [o, s, e, n] = bbox;
  if (puntos.length && puntos.some(p => p.v > 0)) {
    for (let y = 0; y < H; y++) {
      const lat = n - (y + 0.5) / H * (n - s);
      for (let x = 0; x < W; x++) {
        const lng = o + (x + 0.5) / W * (e - o);
        let num = 0, den = 0, dmin = Infinity, exacto = null;
        for (const p of puntos) {
          const d2 = (p.lng - lng) ** 2 + (p.lat - lat) ** 2;
          if (d2 < 1e-10) { exacto = p.v; break; }
          const w = 1 / d2;
          num += w * p.v; den += w;
          if (d2 < dmin) dmin = d2;
        }
        const v = exacto ?? num / den;
        const fade = exacto != null ? 1 : Math.max(0, 1 - Math.sqrt(dmin) / alcance);
        const c = colorRampa(v / tope);
        const i = (y * W + x) * 4;
        img.data[i] = c[0]; img.data[i + 1] = c[1]; img.data[i + 2] = c[2];
        img.data[i + 3] = c[3] * Math.sqrt(fade);
      }
    }
  }
  ctx.putImageData(img, 0, 0);
}
