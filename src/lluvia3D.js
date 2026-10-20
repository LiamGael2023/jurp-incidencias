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
import { fmtFecha } from './lluviaEstacion.js';
import { NIVELES_LLUVIA, nivelDe, unidadCorta } from './umbralesLluvia.js';

export const SLOTS = 96;              // 24 h × 4 cuartos de hora
export const MIN_SLOT = 15;

// Los umbrales y sus colores viven en umbralesLluvia.js, que es de donde los
// lee también el mapa 2D. Aquí solo se reexportan para no tocar a quien ya
// los importaba de este módulo.
export const NIVELES = NIVELES_LLUVIA;
export { nivelDe };

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

// ── Pronóstico (Open-Meteo) ────────────────────────────────────────────
// Lluvia prevista por hora para la coordenada de cada estación. Open-Meteo
// combina por dentro los modelos globales (ECMWF, GFS, ICON…) y elige el que
// mejor anda en cada zona; la probabilidad sale de sus ensembles.
//
// Se pide desde el navegador (la API admite CORS) y se guarda una hora en
// localStorage: los modelos se actualizan cada pocas horas, y sin caché cada
// apertura del 3D repetiría la misma consulta.
//
// No necesita sensor: una estación caída tiene igual su pronóstico.

const OPEN_METEO = 'https://api.open-meteo.com/v1/forecast';
const CACHE_PRON_MS = 60 * 60 * 1000;

// Más allá de esto el pronóstico es tendencia, no dato para decidir.
export const HORAS_CONFIABLES = 72;

export async function cargarPronostico(estaciones, dias = 3) {
  const pts = estaciones.filter(e => Number.isFinite(e.lat) && Number.isFinite(e.lng));
  if (!pts.length) throw new Error('No hay estaciones con ubicación.');
  const lat = pts.map(e => e.lat.toFixed(4)).join(',');
  const lng = pts.map(e => e.lng.toFixed(4)).join(',');
  const clave = `pron3d:${dias}:${lat}:${lng}`;

  let crudo = null;
  // Cuándo se pidió de verdad. Un pronóstico sin su hora no se puede juzgar:
  // el mismo número vale distinto recién traído que seis horas después, y con
  // la caché de una hora lo que se ve en pantalla casi nunca es de ahora
  // mismo. Se devuelve para que el panel lo diga.
  let consultado = Date.now();
  try {
    const c = JSON.parse(localStorage.getItem(clave) || 'null');
    if (c && Date.now() - c.t < CACHE_PRON_MS) { crudo = c.d; consultado = c.t; }
  } catch { /* sin almacenamiento: se consulta */ }

  if (!crudo) {
    const url = `${OPEN_METEO}?latitude=${lat}&longitude=${lng}`
      + '&hourly=precipitation,precipitation_probability'
      + `&forecast_days=${Math.min(16, dias + 1)}&timezone=America%2FLima`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`El servicio de pronóstico respondió ${r.status}`);
    crudo = await r.json();
    consultado = Date.now();
    try { localStorage.setItem(clave, JSON.stringify({ t: consultado, d: crudo })); } catch { /* lleno */ }
  }

  // Con una sola coordenada la respuesta es un objeto; con varias, una lista.
  const lista = Array.isArray(crudo) ? crudo : [crudo];
  const horas = lista[0]?.hourly?.time || [];
  // Arranca en la hora en curso: lo ya pasado lo dicen las estaciones.
  const ahora = new Date();
  ahora.setMinutes(0, 0, 0);
  let ini = horas.findIndex(t => new Date(t) >= ahora);
  if (ini < 0) ini = 0;
  const nSlots = Math.min(dias * 24, horas.length - ini);

  const series = {}, prob = {};
  estaciones.forEach(e => { series[e.id] = null; prob[e.id] = null; });
  pts.forEach((e, i) => {
    const h = lista[i]?.hourly;
    if (!h) return;
    // La probabilidad va en Int16 y no en Uint8 para poder guardar -1 = no se
    // sabe. No todos los modelos la publican, y antes un hueco se escribía
    // como 0 %: la píldora decía "1.2 mm · 0 %", que es una contradicción en
    // cuatro caracteres. Ausente no es cero.
    const s = new Float32Array(nSlots), p = new Int16Array(nSlots);
    for (let k = 0; k < nSlots; k++) {
      s[k] = Math.max(0, h.precipitation?.[ini + k] ?? 0);
      const pb = h.precipitation_probability?.[ini + k];
      p[k] = pb == null ? -1 : Math.max(0, Math.min(100, pb));
    }
    series[e.id] = s; prob[e.id] = p;
  });

  return {
    series, prob, nSlots, minSlot: 60,
    t0: new Date(horas[ini]),
    consultado: new Date(consultado),
  };
}

/** Probabilidad en un instante, o null si el modelo no la publica. */
export const probDe = (d, id, slot) => {
  const v = d?.prob?.[id]?.[slot];
  return v == null || v < 0 ? null : v;
};

/**
 * Los umbrales de alerta están en mm por cuarto de hora. Una lluvia horaria
 * se compara en su equivalente: 1 mm/h repartido parejo son 0.25 mm/15 min.
 * Es una aproximación (la lluvia real llega en ráfagas), por eso el panel
 * siempre dice qué unidad está mostrando.
 */
export const equivalente15 = (mm, minSlot) => mm * MIN_SLOT / minSlot;

// ── Qué dice la etiqueta de una estación ───────────────────────────────
/**
 * Decide qué muestra la marca de una estación en un instante.
 *
 * DOS COSAS QUE ARREGLA.
 *
 * 1. Antes la píldora salía siempre, y en un día seco —que en la costa es
 *    casi todo el año— eran veinticinco etiquetas diciendo "0.0 mm" apiladas
 *    unas sobre otras, tapando el valle entero para no contar nada. Las
 *    marcas son elementos del DOM y MapLibre no las descarta por colisión
 *    como haría con una capa 'symbol', así que el amontonamiento no se
 *    resuelve solo. Cero es el fondo, no una noticia: donde no hay nada que
 *    decir queda el punto, que sigue diciendo dónde está la estación y de qué
 *    color.
 *
 * 2. El número y el color hablaban de variables distintas: el texto era el
 *    acumulado y el fondo el nivel de la intensidad del instante. Se llegaba
 *    a una píldora amarilla diciendo "0.0 mm" —llueve ahora, todavía no ha
 *    acumulado nada—, que se lee como un fallo. Ahora, si hay nivel, el
 *    número es la intensidad que lo provoca; si no lo hay, es el acumulado y
 *    el fondo es neutro.
 *
 * @param inten  false si la estación no tiene serie en este periodo
 * @param cerca  si la cámara está lo bastante cerca como para que quepan las
 *               etiquetas de las estaciones sin datos
 * @returns { pill, texto, fondo, color, borde, punto, tenue }
 */
export function etiquetaEstacion({ inten, iv = 0, av = 0, p = null, minSlot = MIN_SLOT, cerca = false }) {
  if (!inten) {
    return {
      pill: cerca, texto: 'sin datos', fondo: 'transparente',
      color: '#94a3b8', borde: 'rgba(148,163,184,.35)',
      punto: COLOR_SIN_DATOS, tenue: false,
    };
  }
  const nv = nivelDe(equivalente15(iv, minSlot));
  if (nv) {
    const prob = p != null ? ` · ${p}%` : '';
    return {
      pill: true,
      texto: `${iv.toFixed(iv < 10 ? 1 : 0)} ${unidadCorta(minSlot)}${prob}`,
      fondo: nv.color, color: nv.texto, borde: 'rgba(255,255,255,.4)',
      punto: nv.color, tenue: false,
    };
  }
  if (av > 0 || iv > 0) {
    return {
      pill: true, texto: `${av.toFixed(1)} mm`,
      fondo: 'rgba(8,22,40,.82)', color: '#dbeafe', borde: 'rgba(255,255,255,.28)',
      punto: av > 0 ? COLOR_LLOVIO : COLOR_SECO, tenue: false,
    };
  }
  return { pill: false, texto: '', punto: COLOR_SECO, tenue: true };
}

// ── Derivados ──────────────────────────────────────────────────────────
/** → { intensidad, acumulado, maxSlot: Float32Array con el máximo por slot } */
export function preparar(series) {
  const intensidad = {}, acumulado = {};
  const n = Object.values(series).find(Boolean)?.length || SLOTS;
  const maxSlot = new Float32Array(n);
  for (const [id, s] of Object.entries(series)) {
    if (!s) { intensidad[id] = null; acumulado[id] = null; continue; }
    const ac = new Float32Array(n);
    let suma = 0;
    for (let i = 0; i < n; i++) {
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
//
// DOS RAMPAS, porque el manto muestra dos variables distintas.
//
// INTENSIDAD va por los umbrales de alerta. Antes usaba una rampa azul→rosa
// normalizada al tope de la escala, y eso hacía que la misma lluvia saliera
// de dos colores a la vez: una estación en alerta roja pintaba su columna de
// rojo mientras el manto a su alrededor salía violeta, porque el rosa de la
// rampa no llegaba hasta 1.4 mm/15 min —por encima del umbral rojo—. Dos
// escalas para una variable, y la leyenda abajo enseñaba las dos.
//
// Las bandas son planas a propósito: el nivel de alerta es discreto. Un
// degradado entre el amarillo y el naranja produciría un color que no
// significa nada, y aquí el color es lo que se lee para decidir.
//
// Por debajo del umbral amarillo el manto sigue siendo azul translúcido: hay
// que ver dónde está cayendo agua aunque no haya alerta, que es casi siempre.
//
// ACUMULADO no tiene umbrales —son milímetros desde las 00:00, no una
// intensidad—, así que conserva la rampa secuencial de toda la vida.

const AZUL_SUAVE = [125, 211, 252];

const hexARGB = (h) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));

/**
 * Color por umbral. Recibe el valor YA en mm/15 min (quien llama lo convierte
 * con equivalente15), así que no depende del tope de la escala: 0.21 es
 * amarillo siempre, se esté mirando un día real o un pronóstico horario.
 */
export function colorManto(mm) {
  const nv = nivelDe(mm);
  if (nv) return [...hexARGB(nv.color), 225];
  // Llueve, pero por debajo de alerta: azul que gana cuerpo hacia el umbral.
  if (mm <= 0) return [...AZUL_SUAVE, 0];
  const k = Math.min(1, mm / NIVELES[0].desde);
  return [...AZUL_SUAVE, 40 + 110 * k];
}

const RAMPA_ACU = [
  [0.00, [125, 211, 252, 0]],
  [0.06, [125, 211, 252, 110]],
  [0.30, [56, 152, 236, 170]],
  [0.60, [37, 99, 235, 200]],
  [0.85, [124, 58, 237, 215]],
  [1.00, [219, 39, 119, 225]],
];
function colorAcumulado(t) {
  t = Math.max(0, Math.min(1, t));
  for (let i = 1; i < RAMPA_ACU.length; i++) {
    if (t <= RAMPA_ACU[i][0]) {
      const [t0, c0] = RAMPA_ACU[i - 1], [t1, c1] = RAMPA_ACU[i];
      const k = (t - t0) / (t1 - t0);
      return c0.map((v, j) => v + (c1[j] - v) * k);
    }
  }
  return RAMPA_ACU[RAMPA_ACU.length - 1][1];
}

const rgba = (c, aMin = 0) => `rgba(${c[0]},${c[1]},${c[2]},${Math.max(c[3], aMin) / 255})`;

/**
 * La barra de la leyenda, con la MISMA escala que pinta el manto. Si saliera
 * de una lista aparte volveríamos al problema de arriba por otra puerta.
 *
 * @param vista 'int' | 'acu'
 * @param tope  valor del extremo derecho (solo se usa en 'int', para situar
 *              los umbrales dentro de la barra)
 */
export const gradienteCSS = (vista = 'acu', tope = 1.4) => {
  if (vista !== 'int') {
    return `linear-gradient(90deg, ${RAMPA_ACU
      .map(([t, c]) => `${rgba(c, 60)} ${t * 100}%`).join(', ')})`;
  }
  // Bandas duras: cada umbral corta en seco, como en el manto. La primera es
  // el tramo sin alerta; después, una por nivel, hasta donde empieza el
  // siguiente.
  const bandas = [
    { hasta: NIVELES[0].desde / tope, color: [...AZUL_SUAVE, 120] },
    ...NIVELES.map((n, i) => ({
      hasta: i + 1 < NIVELES.length ? NIVELES[i + 1].desde / tope : 1,
      color: [...hexARGB(n.color), 225],
    })),
  ];
  const paradas = [];
  let desde = 0;
  for (const b of bandas) {
    const hasta = Math.min(1, b.hasta);
    if (hasta <= desde) continue;   // tope por debajo de este umbral
    paradas.push(`${rgba(b.color, 60)} ${desde * 100}%`,
                 `${rgba(b.color, 60)} ${hasta * 100}%`);
    desde = hasta;
  }
  return `linear-gradient(90deg, ${paradas.join(', ')})`;
};

/**
 * Pinta el manto sobre un canvas que MapLibre usa como fuente 'canvas'.
 * @param puntos  [{lng, lat, v}] solo estaciones con dato
 * @param tope    valor que corresponde al extremo de la rampa (solo 'acu')
 * @param vista   'int' pinta por umbrales de alerta; 'acu', rampa continua
 * @param alcance grados: más allá de esta distancia a la estación más
 *                cercana el manto se desvanece (no se inventa lluvia lejos).
 */
export function pintarManto(canvas, bbox, puntos, tope, vista = 'acu', alcance = 0.2) {
  const color = vista === 'int' ? colorManto : (v) => colorAcumulado(v / tope);
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
        const c = color(v);
        const i = (y * W + x) * 4;
        img.data[i] = c[0]; img.data[i + 1] = c[1]; img.data[i + 2] = c[2];
        img.data[i + 3] = c[3] * Math.sqrt(fade);
      }
    }
  }
  ctx.putImageData(img, 0, 0);
}
