import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
// maplibre-gl 6 eliminó el export default: ahora todo son exports nombrados,
// así que hay que importar el espacio de nombres completo.
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// MapLibre 6 busca su worker como './maplibre-gl-worker.mjs' junto al bundle,
// y Vite no copia ese archivo: sin worker, ninguna fuente GeoJSON llega a
// dibujarse (ni los canales ni las columnas de lluvia), sin un solo error a la
// vista. '?worker&url' hace que Vite empaquete el worker con sus dependencias
// y devuelva su URL final.
import urlWorkerMapLibre from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import {
  FaTimes, FaGlobeAmericas, FaPlay, FaPause, FaSyncAlt, FaCloudRain, FaFlask, FaUndo,
  FaExclamationTriangle, FaCheckCircle,
} from 'react-icons/fa';
import { capaBase } from './capasBase';
import { fmtFecha, estaCaida } from './lluviaEstacion';
import {
  MIN_SLOT, NIVELES, nivelDe, horaDeMinuto,
  COLOR_SIN_DATOS, COLOR_LLOVIO, COLOR_SECO,
  cargarDia, simularDia, preparar, hayLluvia,
  cargarPronostico, equivalente15, HORAS_CONFIABLES,
  circulo, bboxEstaciones, pintarManto, gradienteCSS,
} from './lluvia3D';

/**
 * Vista 3D en globo.
 *
 * Leaflet es 2D por diseño y no tiene proyección esférica, así que esta vista
 * usa MapLibre GL, que sí la trae de forma nativa. Conviven sin estorbarse: el
 * visor 2D sigue siendo el de trabajo (medición, capas, ruteo) y este es el de
 * presentación y lectura del terreno.
 *
 * La proyección 'globe' se convierte sola a mercator al acercarse, así que el
 * vuelo desde el espacio hasta el canal es continuo, sin saltos.
 *
 * MODO LLUVIA (gemelo pluviométrico): reproduce la lluvia sobre el relieve.
 * Cada estación es una columna cuya altura es el acumulado y cuyo color es el
 * nivel de alerta del instante; entre estaciones, un manto interpolado (IDW)
 * muestra dónde cae el agua, y sobre él caen gotas donde llueve. Tres fuentes:
 *
 *   Reales      un día de lecturas, cada 15 min, con los incidentes
 *               apareciendo a la hora en que se reportaron.
 *   Simulación  una tormenta sintética para presentar y para el "¿qué
 *               pasaría si?".
 *   Pronóstico  lluvia prevista hora a hora (Open-Meteo) para los próximos
 *               3 o 7 días, con su probabilidad y el próximo evento que
 *               cruza un umbral de alerta.
 */

maplibregl.setWorkerUrl(urlWorkerMapLibre);

// Mismas teselas que el visor 2D, para que la imagen no cambie entre vistas.
// Salen de capasBase.js: tres copias de la misma URL era tres sitios donde
// corregirla, y en WebGL una textura servida sin cabeceras CORS contamina el
// contexto igual que contamina el lienzo en 2D.
// Relieve abierto de AWS (Terrarium). No necesita clave.
const TILES_DEM = 'https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png';

const CENTRO = [-78.7533, -8.4186];   // [lng, lat] — MapLibre usa este orden

// Por debajo de este zoom los incidentes se muestran como una sola marca con
// el total. Está alto a propósito: en el 3D la lectura es de conjunto, y los
// pines sueltos se ven como una hilera de puntos pegados a la costa. El
// detalle uno por uno se ve en el mapa 2D.
const ZOOM_AGRUPA = 11;

const COLOR_GRAVEDAD = { lev: '#f59f00', mod: '#f76707', gra: '#ef4444' };
const resuelto = (e) => e === 'ate' || e === 'cer';
const colorIncidente = (inc) =>
  resuelto(inc.estado) ? '#2fb344' : (COLOR_GRAVEDAD[inc.gravedad] || '#f59f00');

// ── Parámetros del modo lluvia ─────────────────────────────────────────
// Metros de columna por milímetro acumulado. Es una escala de lectura, no
// física: con 700, 3 mm —ya un evento en Virú y Chao— dan 2 km de columna,
// visibles desde la vista de conjunto; un día extremo se corta en 12 km.
const M_POR_MM = 700;
const BASE_COLUMNA = 150;
// El radio se achica al acercarse: a la vista de conjunto una columna de
// 1,1 km se ve; de cerca esa misma columna tapa a las vecinas.
const radioColumna = (z) => Math.max(180, Math.min(1100, 1100 * 2 ** (9.5 - z)));
const LADO_MANTO = 160;               // píxeles del lienzo interpolado
const TOPE_INTENSIDAD = 1.4;          // mm/15 min en el extremo de la rampa
const MAX_GOTAS = 3200;
// Velocidad = segundos simulados por segundo real.
const VEL_DIA = [
  { v: 60, t: '60x', d: '1 min por segundo' },
  { v: 300, t: '300x', d: '5 min por segundo' },
  { v: 900, t: '900x', d: '15 min por segundo' },
  { v: 3600, t: '3600x', d: '1 h por segundo' },
];
const VEL_PRON = [
  { v: 900, t: '¼ h/s', d: '15 min por segundo' },
  { v: 3600, t: '1 h/s', d: '1 hora por segundo' },
  { v: 14400, t: '4 h/s', d: '4 horas por segundo' },
];

const DIAS_SEM = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];

// ── Ayudas sobre el conjunto de datos cargado ──────────────────────────
// 'd' = { intensidad, acumulado, maxSlot, nSlots, minSlot, t0, prob }
const duracion = (d) => (d ? d.nSlots * d.minSlot : 1440);
const slotDe = (d, min) => (d ? Math.min(d.nSlots - 1, Math.max(0, Math.floor(min / d.minSlot))) : 0);
const eq15 = (d, v) => (d ? equivalente15(v, d.minSlot) : v);
const unidad = (d) => (d?.minSlot === 60 ? 'mm/h' : 'mm/15 min');
function instante(d, min) {
  if (!d?.t0) return { corto: horaDeMinuto(min), largo: horaDeMinuto(min) };
  const t = new Date(d.t0.getTime() + Math.floor(min / d.minSlot) * d.minSlot * 60000);
  const hh = `${String(t.getHours()).padStart(2, '0')}:00`;
  return { corto: `${DIAS_SEM[t.getDay()]} ${hh}`, largo: `${DIAS_SEM[t.getDay()]} ${t.getDate()} · ${hh}`, fecha: t };
}

function buscarProximoEvento(d, desde, ests) {
  if (!d?.t0) return null;
  for (let s = desde; s < d.nSlots; s++) {
    let mejor = null;
    for (const e of ests) {
      const v = d.intensidad[e.id]?.[s];
      if (v == null) continue;
      const nv = nivelDe(eq15(d, v));
      if (nv && (!mejor || v > mejor.v)) mejor = { v, nv, est: e.name, p: d.prob?.[e.id]?.[s] ?? null };
    }
    if (mejor) return { ...mejor, slot: s, cuando: instante(d, s * d.minSlot).largo };
  }
  return { ninguno: true };
}

const vidrio = {
  background: 'rgba(8,22,40,.66)', backdropFilter: 'blur(10px)',
  border: '1px solid rgba(255,255,255,.14)', borderRadius: 12,
};

function Mapa3D({ incidentes = [], capasLinea = [], estaciones = [], onCerrar, onSeleccionar }) {
  const contenedor = useRef(null);
  const mapa = useRef(null);
  const marcadores = useRef([]);

  const [listo, setListo] = useState(false);
  // Relieve y capas van siempre encendidos: eran dos interruptores que nadie
  // tocaba y que quitaban sitio a lo que sí se usa.
  const [relieve] = useState(true);
  const [verCapas] = useState(true);
  const [volando, setVolando] = useState(false);
  // Arranca quieto: la primera vista debe mostrar el globo con Perú al frente,
  // no un planeta girando que hay que perseguir. El giro queda a un botón.
  const [girando, setGirando] = useState(false);
  const [zoom, setZoom] = useState(2.1);
  const giro = useRef(null);
  const zoomRef = useRef(2.1);

  // ── Estado del modo lluvia ───────────────────────────────────────────
  const [modoLluvia, setModoLluvia] = useState(false);
  const [fuente, setFuente] = useState('real');          // 'real' | 'sim' | 'pron'
  const [fecha, setFecha] = useState(() => fmtFecha(new Date()));
  const [diasPron, setDiasPron] = useState(3);
  const [pico, setPico] = useState(1.6);                  // mm/15 min (simulación)
  const [vistaManto, setVistaManto] = useState('int');    // 'int' | 'acu'
  const [datos, setDatos] = useState(null);
  const [cargandoLluvia, setCargandoLluvia] = useState(false);
  const [aviso, setAviso] = useState('');
  const [reproduciendo, setReproduciendo] = useState(false);
  const [vel, setVel] = useState(900);
  const [minutoUI, setMinutoUI] = useState(0);

  const minutoRef = useRef(0);
  const datosRef = useRef(null);
  const reproRef = useRef(false);
  const velRef = useRef(900);
  const vistaRef = useRef('int');
  const slotPintado = useRef(-1);
  const lienzoManto = useRef(null);
  const lienzoGotas = useRef(null);
  const gotas = useRef([]);
  const marcasEst = useRef([]);

  useEffect(() => { reproRef.current = reproduciendo; }, [reproduciendo]);
  useEffect(() => { velRef.current = vel; }, [vel]);

  // Estaciones utilizables: con coordenadas, y marcadas si hoy están caídas.
  const ests = useMemo(() => estaciones
    .filter(e => Number.isFinite(e.lat) && Number.isFinite(e.lng))
    .map(e => ({ ...e, caida: estaCaida(e) })), [estaciones]);
  const bbox = useMemo(() => bboxEstaciones(ests), [ests]);

  // Detiene el giro del globo. Se llama en cuanto el usuario toca el mapa:
  // si siguiera rotando bajo el cursor sería imposible apuntar a nada.
  const pararGiro = useCallback(() => {
    if (giro.current) { cancelAnimationFrame(giro.current); giro.current = null; }
    setGirando(false);
  }, []);

  // ── El vuelo: del espacio a Chavimochic ──────────────────────────────
  // Ya no se dispara solo al entrar: la vista arranca en el globo y el vuelo
  // queda a un botón, para quien quiera la aproximación.
  const volarAlCanal = useCallback(() => {
    const m = mapa.current;
    if (!m) return;
    pararGiro();
    setVolando(true);
    m.flyTo({
      center: CENTRO,
      zoom: 11.5,
      pitch: 62,        // cámara inclinada: es lo que hace visible el relieve
      bearing: -18,
      duration: 5000,
      curve: 1.5,       // curva de aproximación, no un zoom plano
      essential: true,
    });
    setTimeout(() => setVolando(false), 5100);
  }, [pararGiro]);

  // Vuelve al globo completo y retoma el giro.
  const volverAlGlobo = useCallback(() => {
    const m = mapa.current;
    if (!m) return;
    setModoLluvia(false);
    setReproduciendo(false);
    m.flyTo({ center: CENTRO, zoom: 2.1, pitch: 0, bearing: 0, duration: 2600, essential: true });
    setTimeout(() => setGirando(true), 2700);
  }, []);

  // ── Construcción del mapa (una sola vez) ─────────────────────────────
  useEffect(() => {
    if (mapa.current || !contenedor.current) return;

    const m = new maplibregl.Map({
      container: contenedor.current,
      style: {
        version: 8,
        sources: {
          satelite: {
            type: 'raster',
            tiles: [capaBase('satelite').url],
            tileSize: 256,
            maxzoom: capaBase('satelite').maxZoom,
            attribution: capaBase('satelite').credito,
          },
        },
        layers: [
          { id: 'fondo', type: 'background', paint: { 'background-color': '#04101f' } },
          { id: 'satelite', type: 'raster', source: 'satelite' },
        ],
        // Cielo y atmósfera: sin esto el globo se ve recortado sobre negro.
        sky: {
          'sky-color': '#0a1a33',
          'sky-horizon-blend': 0.5,
          'horizon-color': '#5b93c9',
          'horizon-fog-blend': 0.5,
          'fog-color': '#9fc9ec',
          'fog-ground-blend': 0.6,
        },
      },
      center: CENTRO,
      zoom: 2.1,
      pitch: 0,
      bearing: 0,
      attributionControl: false,
      maxPitch: 80,
    });

    mapa.current = m;
    m.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
    m.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');

    m.on('style.load', () => {
      // Proyección esférica. 'globe' pasa sola a mercator al acercarse, así
      // que el vuelo no da tirones al llegar.
      m.setProjection({ type: 'globe' });

      // Relieve real del terreno.
      m.addSource('dem', {
        type: 'raster-dem',
        tiles: [TILES_DEM],
        tileSize: 256,
        maxzoom: 14,
        encoding: 'terrarium',
        attribution: 'Elevación: AWS Terrain Tiles',
      });
      m.setTerrain({ source: 'dem', exaggeration: 1.4 });

      // Capas de línea (canales y caminos).
      capasLinea.forEach((capa, i) => {
        const id = `linea-${i}`;
        if (!capa?.data?.features?.length) return;
        m.addSource(id, { type: 'geojson', data: capa.data });
        m.addLayer({
          id,
          type: 'line',
          source: id,
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: {
            'line-color': capa.color || '#35B6E9',
            'line-width': ['interpolate', ['linear'], ['zoom'], 8, 1.2, 14, 3.5],
            'line-opacity': 0.9,
          },
        });
      });

      setListo(true);
    });

    // Cualquier interacción del usuario detiene el giro automático.
    ['mousedown', 'touchstart', 'wheel', 'dragstart'].forEach(ev => m.on(ev, pararGiro));
    m.on('zoom', () => { zoomRef.current = m.getZoom(); setZoom(zoomRef.current); });

    return () => { m.remove(); mapa.current = null; };
  }, [capasLinea, pararGiro]);

  // ── Giro lento del globo ─────────────────────────────────────────────
  // Un globo quieto parece una imagen; girando se lee como un globo. Se para
  // en cuanto el usuario interactúa, y solo gira si está alejado.
  useEffect(() => {
    const m = mapa.current;
    if (!m || !listo || !girando) return;
    let cancelado = false;
    const paso = () => {
      if (cancelado || !mapa.current) return;
      const c = m.getCenter();
      m.setCenter([c.lng + 0.12, c.lat]);
      giro.current = requestAnimationFrame(paso);
    };
    giro.current = requestAnimationFrame(paso);
    return () => { cancelado = true; if (giro.current) cancelAnimationFrame(giro.current); };
  }, [listo, girando]);

  // ════════════════════════ MODO LLUVIA ════════════════════════════════

  // Capas del modo lluvia: se crean una vez y se encienden/apagan.
  useEffect(() => {
    const m = mapa.current;
    if (!m || !listo || !bbox) return;
    const [o, s, e, n] = bbox;
    const coords = [[o, n], [e, n], [e, s], [o, s]];

    if (!lienzoManto.current) {
      const c = document.createElement('canvas');
      c.width = LADO_MANTO; c.height = LADO_MANTO;
      lienzoManto.current = c;
    }
    const primeraLinea = capasLinea.findIndex(c => c?.data?.features?.length);
    const debajoDe = primeraLinea >= 0 && m.getLayer(`linea-${primeraLinea}`) ? `linea-${primeraLinea}` : undefined;

    if (!m.getSource('lluvia-manto')) {
      m.addSource('lluvia-manto', { type: 'canvas', canvas: lienzoManto.current, coordinates: coords, animate: true });
      m.addLayer({
        id: 'lluvia-manto', type: 'raster', source: 'lluvia-manto',
        layout: { visibility: 'none' },
        paint: { 'raster-opacity': 0.88, 'raster-fade-duration': 0, 'raster-resampling': 'linear' },
      }, debajoDe);
    } else {
      m.getSource('lluvia-manto').setCoordinates(coords);
    }

    if (!m.getSource('lluvia-col')) {
      m.addSource('lluvia-col', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      m.addLayer({
        id: 'lluvia-col', type: 'fill-extrusion', source: 'lluvia-col',
        layout: { visibility: 'none' },
        paint: {
          'fill-extrusion-color': ['get', 'color'],
          'fill-extrusion-height': ['get', 'h'],
          'fill-extrusion-base': 0,
          'fill-extrusion-opacity': 0.92,
        },
      });
    }
  }, [listo, bbox, capasLinea]);

  // Columnas de un instante. Aparte del manto porque también se rehacen al
  // cambiar el zoom (el radio depende de él) y eso no debe repintar el IDW.
  const pintarColumnas = useCallback((slot) => {
    const m = mapa.current;
    const d = datosRef.current;
    if (!m || !d) return;
    const radio = radioColumna(zoomRef.current);
    const features = ests.map(e => {
      const inten = d.intensidad[e.id];
      let color, h;
      if (!inten) {
        color = COLOR_SIN_DATOS; h = BASE_COLUMNA * 0.6;
      } else {
        const iv = inten[slot], av = d.acumulado[e.id][slot];
        const nv = nivelDe(eq15(d, iv));
        color = nv ? nv.color : ((iv > 0 || av > 0) ? COLOR_LLOVIO : COLOR_SECO);
        h = Math.min(BASE_COLUMNA + av * M_POR_MM, 12000);
      }
      return {
        type: 'Feature',
        properties: { color, h },
        geometry: { type: 'Polygon', coordinates: [circulo(e.lng, e.lat, radio)] },
      };
    });
    m.getSource('lluvia-col')?.setData({ type: 'FeatureCollection', features });
  }, [ests]);

  // Redibuja columnas, manto y etiquetas para un instante.
  const pintarSlot = useCallback((slot) => {
    const m = mapa.current;
    const d = datosRef.current;
    if (!m || !d) return;
    slotPintado.current = slot;
    pintarColumnas(slot);

    const puntos = [];
    const ultimos = Object.values(d.acumulado).filter(Boolean).map(a => a[d.nSlots - 1]);
    const acuMax = Math.max(10, ...ultimos);

    ests.forEach((e, i) => {
      const inten = d.intensidad[e.id];
      const iv = inten ? inten[slot] : 0;
      const av = inten ? d.acumulado[e.id][slot] : 0;
      const p = d.prob?.[e.id]?.[slot];
      if (inten) puntos.push({ lng: e.lng, lat: e.lat, v: vistaRef.current === 'int' ? eq15(d, iv) : av });

      const mk = marcasEst.current[i];
      if (!mk) return;
      const nv = inten ? nivelDe(eq15(d, iv)) : null;
      const pill = mk.querySelector('.l3d-pill');
      pill.textContent = !inten ? 'sin datos'
        : (p != null ? `${av.toFixed(1)} mm · ${p}%` : `${av.toFixed(1)} mm`);
      pill.style.background = !inten ? 'rgba(71,85,105,.85)' : (nv ? nv.color : 'rgba(8,22,40,.82)');
      pill.style.color = nv ? nv.texto : '#fff';
      mk.title = `${e.name}\n${!inten
        ? 'Sin lecturas en ese periodo'
        : `${d.t0 ? 'Prevista' : 'Ahora'}: ${iv.toFixed(2)} ${unidad(d)}${p != null ? ` (prob. ${p}%)` : ''}\nAcumulado${d.t0 ? ' previsto' : ''}: ${av.toFixed(2)} mm`}`;
    });

    if (lienzoManto.current && bbox) {
      const tope = vistaRef.current === 'int' ? TOPE_INTENSIDAD : acuMax;
      pintarManto(lienzoManto.current, bbox, puntos, tope);
    }
    // Más allá de las horas confiables el manto se atenúa: es tendencia.
    if (m.getLayer('lluvia-manto')) {
      const tendencia = d.t0 && slot * d.minSlot >= HORAS_CONFIABLES * 60;
      m.setPaintProperty('lluvia-manto', 'raster-opacity', tendencia ? 0.45 : 0.88);
    }
  }, [ests, bbox, pintarColumnas]);

  // Entrar/salir: visibilidad de capas, vuelo y etiquetas de estaciones.
  useEffect(() => {
    const m = mapa.current;
    if (!m || !listo) return;
    const vis = modoLluvia ? 'visible' : 'none';
    ['lluvia-manto', 'lluvia-col'].forEach(id => { if (m.getLayer(id)) m.setLayoutProperty(id, 'visibility', vis); });
    const src = m.getSource('lluvia-manto');
    if (src) { if (modoLluvia) src.play(); else src.pause(); }

    marcasEst.current.forEach(el => el._marcador?.remove());
    marcasEst.current = [];
    if (!modoLluvia) return;

    // Encuadre sobre las estaciones mismas (sin el margen del manto), dejando
    // libre el sitio del panel y de la línea de tiempo.
    const enc = bboxEstaciones(ests, 0.03);
    if (enc) {
      m.fitBounds([[enc[0], enc[1]], [enc[2], enc[3]]],
        { pitch: 58, bearing: -22, padding: { top: 80, bottom: 170, left: 30, right: 350 }, duration: 3200, essential: true });
    }
    ests.forEach(e => {
      const el = document.createElement('div');
      el.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:2px;pointer-events:auto;cursor:default';
      el.innerHTML = `
        <div class="l3d-pill" style="font:700 10.5px/1 system-ui;padding:4px 7px;border-radius:6px;border:1px solid rgba(255,255,255,.4);box-shadow:0 2px 8px rgba(0,0,0,.45);white-space:nowrap;color:#fff;background:rgba(8,22,40,.82)">—</div>
        <div class="l3d-nom" style="font:600 9.5px/1 system-ui;color:#e2eef8;text-shadow:0 1px 3px #000,0 0 6px #000;white-space:nowrap">${e.name}</div>`;
      el._marcador = new maplibregl.Marker({ element: el, anchor: 'top', offset: [0, 6] }).setLngLat([e.lng, e.lat]).addTo(m);
      marcasEst.current.push(el);
    });
    if (datosRef.current) pintarSlot(slotDe(datosRef.current, minutoRef.current));
    return () => {
      marcasEst.current.forEach(el => el._marcador?.remove());
      marcasEst.current = [];
    };
  }, [modoLluvia, listo, ests, bbox, pintarSlot]);

  // Nombres solo de cerca (desde lejos se amontonan) y columnas más finas
  // conforme se acerca la cámara.
  const zoomEscalon = Math.round(zoom * 4) / 4;
  useEffect(() => {
    marcasEst.current.forEach(el => {
      const n = el.querySelector('.l3d-nom');
      if (n) n.style.display = zoomEscalon >= 10.2 ? 'block' : 'none';
    });
    if (modoLluvia && datosRef.current) pintarColumnas(slotDe(datosRef.current, minutoRef.current));
  }, [zoomEscalon, modoLluvia, pintarColumnas]);

  // Carga de datos según la fuente.
  useEffect(() => {
    if (!modoLluvia) return;
    let cancelado = false;
    const aplicar = (series, extra, minutoInicial, mensaje) => {
      if (cancelado) return;
      const d = { ...preparar(series), nSlots: 96, minSlot: MIN_SLOT, t0: null, prob: null, ...extra };
      datosRef.current = d;
      setDatos(d);
      setAviso(mensaje);
      minutoRef.current = minutoInicial;
      setMinutoUI(minutoInicial);
      slotPintado.current = -1;
      pintarSlot(slotDe(d, minutoInicial));
    };

    // Todas las fuentes pasan por una promesa: así aplican sus datos fuera
    // del cuerpo del efecto, igual.
    let carga;
    if (fuente === 'sim') {
      carga = Promise.resolve(simularDia(ests, { intensidadPico: pico }))
        .then(series => { aplicar(series, {}, 11 * 60, ''); if (!cancelado) setReproduciendo(true); });
    } else if (fuente === 'pron') {
      carga = Promise.resolve()
        .then(() => { if (!cancelado) setCargandoLluvia(true); })
        .then(() => cargarPronostico(ests, diasPron))
        .then(({ series, prob, t0, nSlots, minSlot }) => {
          const msg = hayLluvia(series) ? ''
            : `Los modelos no prevén lluvia en los próximos ${diasPron} días.`;
          aplicar(series, { prob, t0, nSlots, minSlot }, 0, msg);
          if (!msg && !cancelado) setReproduciendo(true);
        })
        .catch(err => {
          if (cancelado) return;
          datosRef.current = null;
          setDatos(null);
          setAviso(`No se pudo obtener el pronóstico: ${err.message}`);
        });
    } else {
      const [y, mo, d] = fecha.split('-').map(Number);
      const dia = new Date(y, mo - 1, d);
      carga = Promise.resolve()
        .then(() => { if (!cancelado) setCargandoLluvia(true); })
        .then(() => cargarDia(ests, dia, localStorage.getItem('userToken')))
        .then(series => {
          const sinSerie = Object.values(series).every(s => !s);
          const msg = sinSerie
            ? 'Ninguna estación tiene lecturas ese día.'
            : (hayLluvia(series) ? '' : `No se registró lluvia el ${dia.toLocaleDateString('es-PE')}. Prueba otra fecha o la simulación.`);
          aplicar(series, {}, 0, msg);
          if (!msg && !cancelado) setReproduciendo(true);
        });
    }
    carga.finally(() => { if (!cancelado) setCargandoLluvia(false); });
    return () => { cancelado = true; };
  }, [modoLluvia, fuente, fecha, diasPron, pico, ests, pintarSlot]);

  // Cambiar entre intensidad y acumulado repinta en el acto.
  useEffect(() => {
    vistaRef.current = vistaManto;
    if (modoLluvia && datosRef.current) pintarSlot(slotDe(datosRef.current, minutoRef.current));
  }, [vistaManto, modoLluvia, pintarSlot]);

  // Bucle de animación: avanza el reloj y hace caer la lluvia.
  useEffect(() => {
    if (!modoLluvia) return;
    const m = mapa.current;
    const cv = lienzoGotas.current;
    if (!m || !cv) return;
    const ctx = cv.getContext('2d');
    let raf, prev = performance.now(), ultimoUI = 0;

    const ajustar = () => {
      const dpr = window.devicePixelRatio || 1;
      cv.width = cv.clientWidth * dpr; cv.height = cv.clientHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    ajustar();
    window.addEventListener('resize', ajustar);

    const paso = (ahora) => {
      const dt = Math.min(0.1, (ahora - prev) / 1000);
      prev = ahora;
      const d = datosRef.current;
      const fin = duracion(d) - 0.01;

      if (d && reproRef.current) {
        minutoRef.current += velRef.current * dt / 60;
        if (minutoRef.current >= fin) { minutoRef.current = fin; setReproduciendo(false); }
      }
      const slot = slotDe(d, minutoRef.current);
      if (d && slot !== slotPintado.current) pintarSlot(slot);
      if (ahora - ultimoUI > 120) { ultimoUI = ahora; setMinutoUI(minutoRef.current); }

      // Gotas: nacen sobre cada estación en proporción a lo que llueve ahí.
      const W = cv.clientWidth, H = cv.clientHeight;
      ctx.clearRect(0, 0, W, H);
      if (d) {
        const z = m.getZoom();
        const lista = gotas.current;
        for (const e of ests) {
          const s = d.intensidad[e.id];
          const iv = s ? eq15(d, s[slot]) : 0;
          if (iv < 0.03) continue;
          const p = m.project([e.lng, e.lat]);
          if (p.x < -200 || p.x > W + 200 || p.y < -200 || p.y > H + 300) continue;
          const mpp = 156543 * Math.cos(e.lat * Math.PI / 180) / 2 ** z;
          const r = Math.max(30, Math.min(240, 4500 / mpp));
          let nuevas = iv * 420 * dt * (r / 60);
          while (nuevas > 0 && lista.length < MAX_GOTAS) {
            if (nuevas < 1 && Math.random() > nuevas) break;
            nuevas -= 1;
            const vy = 650 + Math.random() * 450;
            lista.push({
              x: p.x + (Math.random() - 0.5) * 2 * r,
              y: p.y - r * 1.4 - Math.random() * r * 1.6,
              suelo: p.y + (Math.random() - 0.35) * r * 0.6,
              vy, vx: vy * 0.16, l: 7 + Math.random() * 9 * Math.min(1.6, iv + 0.4),
            });
          }
        }
        ctx.strokeStyle = 'rgba(205,232,255,.72)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        let k = 0;
        for (let i = 0; i < lista.length; i++) {
          const g = lista[i];
          g.x += g.vx * dt; g.y += g.vy * dt;
          if (g.y > g.suelo) continue;
          ctx.moveTo(g.x, g.y);
          ctx.lineTo(g.x - g.l * 0.16, g.y - g.l);
          lista[k++] = g;
        }
        lista.length = k;
        ctx.stroke();
      }
      raf = requestAnimationFrame(paso);
    };
    raf = requestAnimationFrame(paso);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', ajustar);
      gotas.current = [];
      ctx.clearRect(0, 0, cv.width, cv.height);
    };
  }, [modoLluvia, ests, pintarSlot]);

  const buscar = (min) => {
    minutoRef.current = Math.max(0, Math.min(duracion(datosRef.current) - 0.01, min));
    setMinutoUI(minutoRef.current);
  };

  const cambiarFuente = (f) => {
    setFuente(f);
    const lista = f === 'pron' ? VEL_PRON : VEL_DIA;
    if (!lista.some(s => s.v === vel)) setVel(f === 'pron' ? 3600 : 900);
  };

  // KPIs del instante actual.
  const slotUI = slotDe(datos, minutoUI);
  const resumen = useMemo(() => {
    if (!datos) return null;
    let maxI = 0, estI = null, maxA = 0, estA = null, conLluvia = 0, sinDatos = 0, maxP = 0, estP = null;
    const ranking = [];
    for (const e of ests) {
      const s = datos.intensidad[e.id], a = datos.acumulado[e.id];
      if (!s) { sinDatos++; continue; }
      if (s[slotUI] > 0) conLluvia++;
      if (s[slotUI] > maxI) { maxI = s[slotUI]; estI = e.name; }
      if (a[slotUI] > maxA) { maxA = a[slotUI]; estA = e.name; }
      const p = datos.prob?.[e.id]?.[slotUI] ?? 0;
      if (p > maxP) { maxP = p; estP = e.name; }
      ranking.push({ id: e.id, name: e.name, a: a[slotUI], i: s[slotUI] });
    }
    ranking.sort((x, y) => y.a - x.a);
    return { maxI, estI, maxA, estA, maxP, estP, conLluvia, sinDatos, total: ests.length, ranking: ranking.slice(0, 5) };
  }, [datos, slotUI, ests]);

  // Pronóstico: el primer instante, desde ahora, en que alguna estación
  // cruza un umbral de alerta. Es la pregunta que el operario quiere ver
  // contestada sin tener que reproducir nada.
  const proximoEvento = useMemo(() => buscarProximoEvento(datos, slotUI, ests), [datos, slotUI, ests]);

  // Incidentes visibles: en modo lluvia con datos reales solo los de ese día,
  // y van apareciendo a la hora en que se reportaron.
  const incVisibles = useMemo(() => {
    if (!modoLluvia) return incidentes;
    if (fuente !== 'real') return [];
    const [y, mo, d] = fecha.split('-').map(Number);
    const ini = new Date(y, mo - 1, d).getTime();
    const corte = ini + minutoUI * 60000;
    return incidentes.filter(i => i.timestamp >= ini && i.timestamp <= corte);
  }, [incidentes, modoLluvia, fuente, fecha, minutoUI]);
  const claveInc = incVisibles.map(i => i.id).join(',');
  const incRef = useRef(incVisibles);
  // Se actualiza en un efecto (no en el render) y antes del de marcadores,
  // que solo se rehace cuando cambia la lista, no en cada tic del reloj.
  useEffect(() => { incRef.current = incVisibles; });

  // ── Marcadores de incidentes ─────────────────────────────────────────
  useEffect(() => {
    const m = mapa.current;
    if (!m || !listo) return;

    marcadores.current.forEach(mk => mk.remove());
    marcadores.current = [];

    const validos = incRef.current.filter(i => Number.isFinite(i.lat) && Number.isFinite(i.lng));

    // Desde el globo, siete pines separados por décimas de grado se ven como
    // una hilera de puntos pegados que no se pueden distinguir ni pulsar. A
    // poco zoom se agrupan en una sola marca con el total. En modo lluvia no:
    // ahí cada incidente cuenta dónde y cuándo pegó el agua.
    if (validos.length && zoom < ZOOM_AGRUPA && !modoLluvia) {
      const lat = validos.reduce((a, i) => a + i.lat, 0) / validos.length;
      const lng = validos.reduce((a, i) => a + i.lng, 0) / validos.length;
      const abiertos = validos.filter(i => !resuelto(i.estado)).length;
      const color = abiertos > 0 ? '#f76707' : '#2fb344';

      const el = document.createElement('div');
      el.style.cssText = 'cursor:pointer;position:relative;width:44px;height:74px;display:flex;flex-direction:column;align-items:center';
      el.title = 'Ver los incidentes en el mapa';
      el.innerHTML = `
        <div style="position:relative;width:44px;height:44px">
          <div style="position:absolute;inset:0;border-radius:50%;background:${color};opacity:.28;animation:m3d-pulso 2.4s infinite"></div>
          <div style="position:absolute;inset:7px;border-radius:50%;background:${color};border:2px solid rgba(255,255,255,.9);box-shadow:0 0 16px ${color};display:flex;align-items:center;justify-content:center;color:#fff;font:700 13px/1 system-ui">${validos.length}</div>
        </div>
        <div style="margin-top:5px;background:rgba(8,22,40,.82);border:1px solid rgba(255,255,255,.25);color:#fff;font:700 10px/1 system-ui;padding:5px 9px;border-radius:6px;white-space:nowrap;box-shadow:0 2px 10px rgba(0,0,0,.4)">Clic aquí</div>`;
      // El globo es la vista de contexto; el trabajo se hace en el 2D. Al
      // pulsar la marca se sale del 3D en vez de acercar dentro de él.
      el.addEventListener('click', () => { pararGiro(); if (onCerrar) onCerrar(); });

      const marcador = new maplibregl.Marker({ element: el }).setLngLat([lng, lat]).addTo(m);
      marcadores.current.push(marcador);
      return;
    }

    validos.forEach(inc => {
      const color = colorIncidente(inc);

      const el = document.createElement('div');
      el.style.cssText = 'cursor:pointer;width:22px;height:22px;position:relative';
      el.innerHTML = `
        <div style="position:absolute;inset:0;border-radius:50%;background:${color};opacity:.35;animation:m3d-pulso 1.8s infinite"></div>
        <div style="position:absolute;top:5px;left:5px;width:12px;height:12px;border-radius:50%;background:${color};border:2px solid rgba(255,255,255,.85);box-shadow:0 0 10px ${color}"></div>`;

      const popup = new maplibregl.Popup({ offset: 16, closeButton: false })
        .setHTML(`
          <div style="font-family:system-ui;min-width:170px">
            <div style="font-size:10px;font-weight:800;color:#1463A5;letter-spacing:.3px">${inc.codigoIncidente || ''}</div>
            <div style="font-size:13px;font-weight:700;color:#1e293b;margin:2px 0 3px">${inc.tipo || 'Incidente'}</div>
            <div style="font-size:11px;color:#64748b">${inc.lugar || inc.codigo || ''}</div>
            <div style="font-size:11px;color:#64748b">${inc.fecha || ''}</div>
          </div>`);

      const marcador = new maplibregl.Marker({ element: el })
        .setLngLat([inc.lng, inc.lat])
        .setPopup(popup)
        .addTo(m);

      if (onSeleccionar) el.addEventListener('click', () => { pararGiro(); onSeleccionar(inc); });
      marcadores.current.push(marcador);
    });
  }, [claveInc, listo, onSeleccionar, onCerrar, pararGiro, zoom, modoLluvia]);

  // ── Interruptores ────────────────────────────────────────────────────
  useEffect(() => {
    const m = mapa.current;
    if (!m || !listo) return;
    // Quitar el relieve devuelve rendimiento en equipos flojos.
    m.setTerrain(relieve ? { source: 'dem', exaggeration: 1.4 } : null);
  }, [relieve, listo]);

  useEffect(() => {
    const m = mapa.current;
    if (!m || !listo) return;
    capasLinea.forEach((_, i) => {
      const id = `linea-${i}`;
      if (m.getLayer(id)) m.setLayoutProperty(id, 'visibility', verCapas ? 'visible' : 'none');
    });
  }, [verCapas, listo, capasLinea]);

  const btn = (activo) => ({
    display: 'inline-flex', alignItems: 'center', gap: 7,
    padding: '9px 14px', borderRadius: 10, cursor: 'pointer',
    fontSize: 12.5, fontWeight: 700, fontFamily: 'inherit',
    border: `1px solid ${activo ? '#35B6E9' : 'rgba(255,255,255,.35)'}`,
    background: activo ? 'rgba(53,182,233,.25)' : 'rgba(8,22,40,.55)',
    color: '#fff', backdropFilter: 'blur(8px)',
  });
  const chip = (activo) => ({
    padding: '5px 9px', borderRadius: 7, cursor: 'pointer', fontSize: 11, fontWeight: 700,
    fontFamily: 'inherit', color: activo ? '#04101f' : '#cfe1ef',
    background: activo ? '#35B6E9' : 'rgba(255,255,255,.06)',
    border: `1px solid ${activo ? '#35B6E9' : 'rgba(255,255,255,.18)'}`,
  });
  const etiqueta = { fontSize: 10, fontWeight: 700, color: '#7fa5c0', letterSpacing: '.06em', textTransform: 'uppercase' };

  const esPron = fuente === 'pron';
  const dur = duracion(datos);
  const velocidades = esPron ? VEL_PRON : VEL_DIA;
  const ahoraTxt = instante(datos, minutoUI);
  const enTendencia = esPron && datos?.t0 && minutoUI >= HORAS_CONFIABLES * 60;
  const pctConfiable = esPron && datos ? Math.min(100, (HORAS_CONFIABLES * 60 / dur) * 100) : 100;

  // Perfil del periodo.
  const nBarras = datos?.nSlots || 96;
  const anchoPerfil = 288;
  const paso = anchoPerfil / nBarras;
  const maxBarra = datos ? Math.max(TOPE_INTENSIDAD * 0.6, ...Array.from(datos.maxSlot, v => eq15(datos, v))) : 1;
  const marcasEje = useMemo(() => {
    if (!datos?.t0) return [['00', 0], ['06', 25], ['12', 50], ['18', 75], ['24 h', 100]];
    const out = [];
    for (let s = 0; s < datos.nSlots; s++) {
      const t = new Date(datos.t0.getTime() + s * datos.minSlot * 60000);
      if (t.getHours() === 0) out.push([`${DIAS_SEM[t.getDay()]} ${t.getDate()}`, (s / datos.nSlots) * 100]);
    }
    return out;
  }, [datos]);

  const tituloPanel = fuente === 'sim' ? 'Escenario simulado'
    : esPron ? `Pronóstico · próximos ${diasPron} días`
      : new Date(fecha + 'T12:00').toLocaleDateString('es-PE', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });

  const kpis = !resumen ? [] : esPron ? [
    ['Máx. prevista', resumen.maxI.toFixed(1), 'mm/h', resumen.estI, nivelDe(eq15(datos, resumen.maxI))],
    ['Acum. previsto', resumen.maxA.toFixed(1), 'mm', resumen.estA, null],
    ['Prob. máxima', `${resumen.maxP}`, '%', resumen.estP, null],
    ['Con lluvia', `${resumen.conLluvia}`, `de ${resumen.total - resumen.sinDatos}`, null, null],
  ] : [
    ['Intensidad máx.', resumen.maxI.toFixed(2), 'mm/15 min', resumen.estI, nivelDe(resumen.maxI)],
    ['Acumulado máx.', resumen.maxA.toFixed(1), 'mm', resumen.estA, null],
    ['Lloviendo ahora', `${resumen.conLluvia}`, `de ${resumen.total - resumen.sinDatos}`, null, null],
    ['Sin datos', `${resumen.sinDatos}`, `de ${resumen.total}`, null, null],
  ];

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 4000, background: '#04101f' }}>
      <style>{`
        @keyframes m3d-pulso { 0%{transform:scale(.8);opacity:.5} 70%{transform:scale(1.8);opacity:0} 100%{opacity:0} }
        .maplibregl-popup-content { border-radius: 9px; padding: 10px 12px; }
        .l3d-rango { -webkit-appearance:none; appearance:none; width:100%; height:6px; border-radius:3px; background:rgba(255,255,255,.18); outline:none; }
        .l3d-rango::-webkit-slider-thumb { -webkit-appearance:none; width:16px; height:16px; border-radius:50%; background:#35B6E9; border:2px solid #fff; cursor:pointer; box-shadow:0 0 8px #35B6E9; }
        .l3d-rango::-moz-range-thumb { width:14px; height:14px; border-radius:50%; background:#35B6E9; border:2px solid #fff; cursor:pointer; }
        .l3d-fecha { background:rgba(255,255,255,.06); border:1px solid rgba(255,255,255,.18); color:#fff; border-radius:7px; padding:4px 7px; font:600 11px system-ui; color-scheme:dark; }
      `}</style>

      <div ref={contenedor} style={{ position: 'absolute', inset: 0 }} />

      {/* Lluvia animada, por encima del mapa y sin capturar el ratón */}
      <canvas ref={lienzoGotas}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 2, display: modoLluvia ? 'block' : 'none' }} />

      {/* Cabecera */}
      <div style={{ position: 'absolute', top: 16, left: 16, zIndex: 10, display: 'flex', alignItems: 'center', gap: 12, ...vidrio, padding: '10px 16px' }}>
        {modoLluvia ? <FaCloudRain size={20} color="#F37021" /> : <FaGlobeAmericas size={20} color="#35B6E9" />}
        <div style={{ fontSize: 15, fontWeight: 800, color: '#fff', letterSpacing: '.04em' }}>
          {modoLluvia ? 'PLUVIRA · GEMELO DE LLUVIA' : 'VISTA 3D'}
        </div>
        {modoLluvia && fuente === 'sim' && (
          <span style={{ fontSize: 10, fontWeight: 800, color: '#04101f', background: '#FFF200', padding: '3px 7px', borderRadius: 5 }}>SIMULACIÓN</span>
        )}
        {modoLluvia && esPron && (
          <span style={{ fontSize: 10, fontWeight: 800, color: '#04101f', background: '#8fd0f5', padding: '3px 7px', borderRadius: 5 }}>PRONÓSTICO</span>
        )}
      </div>

      {/* Controles */}
      <div style={{ position: 'absolute', top: 16, right: 60, zIndex: 10, display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        <button onClick={() => { if (modoLluvia) setReproduciendo(false); else pararGiro(); setModoLluvia(!modoLluvia); }} disabled={!ests.length}
          title={ests.length ? 'Reproducir la lluvia sobre el terreno' : 'No hay estaciones con ubicación'}
          style={{ ...btn(modoLluvia), ...(modoLluvia ? { borderColor: '#F37021', background: 'rgba(243,112,33,.3)' } : {}) }}>
          <FaCloudRain size={13} /> Lluvia 3D
        </button>
        {!modoLluvia && (
          <button onClick={volarAlCanal} disabled={volando} style={btn(false)}>
            {volando ? <FaSyncAlt className="icon-spin" /> : <FaPlay size={11} />}
            {volando ? 'Volando…' : 'Ir a JURP'}
          </button>
        )}
        <button onClick={volverAlGlobo} style={btn(false)}>
          <FaGlobeAmericas size={12} /> Ver el globo
        </button>
        {!modoLluvia && (
          <button onClick={() => (girando ? pararGiro() : setGirando(true))} style={btn(girando)}>
            <FaSyncAlt size={11} /> {girando ? 'Girando' : 'Girar'}
          </button>
        )}
        <button onClick={onCerrar} style={{ ...btn(false), background: 'rgba(214,57,57,.55)', borderColor: 'rgba(255,255,255,.35)' }}>
          <FaTimes size={12} /> Salir del 3D
        </button>
      </div>

      {/* ── Panel del modo lluvia ── */}
      {modoLluvia && (
        <div style={{ position: 'absolute', top: 70, right: 16, zIndex: 10, width: 312, maxHeight: 'calc(100vh - 230px)', overflowY: 'auto', ...vidrio, padding: 16, color: '#fff' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <div style={etiqueta}>{tituloPanel}</div>
            {cargandoLluvia && <FaSyncAlt className="icon-spin" size={11} color="#8fd0f5" />}
          </div>
          <div style={{ fontSize: esPron ? 30 : 40, fontWeight: 800, letterSpacing: '-.02em', fontVariantNumeric: 'tabular-nums', lineHeight: 1.15, margin: '2px 0 10px' }}>
            {esPron && datos ? ahoraTxt.largo : ahoraTxt.corto}
          </div>

          {enTendencia && (
            <div style={{ fontSize: 11, color: '#cfe1ef', background: 'rgba(255,255,255,.06)', border: '1px dashed rgba(255,255,255,.3)', borderRadius: 8, padding: '7px 10px', marginBottom: 10 }}>
              Más de {HORAS_CONFIABLES} h adelante: tómalo como tendencia, no como dato para decidir.
            </div>
          )}

          {aviso && (
            <div style={{ fontSize: 11.5, color: '#ffd8a8', background: 'rgba(243,112,33,.14)', border: '1px solid rgba(243,112,33,.35)', borderRadius: 8, padding: '8px 10px', marginBottom: 10 }}>
              {aviso}
            </div>
          )}

          {/* Próximo evento (solo pronóstico) */}
          {proximoEvento && (
            proximoEvento.ninguno ? (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 11.5, color: '#b2f2bb', background: 'rgba(47,179,68,.12)', border: '1px solid rgba(47,179,68,.35)', borderRadius: 8, padding: '8px 10px', marginBottom: 10 }}>
                <FaCheckCircle /> Sin alertas previstas en el periodo.
              </div>
            ) : (
              <button onClick={() => buscar(proximoEvento.slot * datos.minSlot)}
                style={{ display: 'flex', gap: 9, alignItems: 'flex-start', width: '100%', textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit',
                         color: '#fff', background: 'rgba(255,255,255,.05)', border: `1px solid ${proximoEvento.nv.color}`, borderRadius: 9, padding: '9px 10px', marginBottom: 10 }}>
                <FaExclamationTriangle color={proximoEvento.nv.color} style={{ marginTop: 2, flexShrink: 0 }} />
                <span style={{ fontSize: 11.5, lineHeight: 1.4 }}>
                  <b>Alerta {proximoEvento.nv.nombre.toLowerCase()} prevista</b><br />
                  {proximoEvento.cuando} · {proximoEvento.est}<br />
                  <span style={{ color: '#9fb3c8' }}>
                    {proximoEvento.v.toFixed(1)} mm/h{proximoEvento.p != null ? ` · prob. ${proximoEvento.p}%` : ''} · clic para ir
                  </span>
                </span>
              </button>
            )
          )}

          {resumen && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {kpis.map(([t, v, u, sub, nv]) => (
                  <div key={t} style={{ background: 'rgba(255,255,255,.05)', border: `1px solid ${nv ? nv.color : 'rgba(255,255,255,.1)'}`, borderRadius: 9, padding: '8px 10px' }}>
                    <div style={{ ...etiqueta, fontSize: 9.5 }}>{t}</div>
                    <div style={{ fontSize: 20, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
                      {v} <span style={{ fontSize: 10.5, fontWeight: 600, color: '#9fb3c8' }}>{u}</span>
                    </div>
                    {sub && <div style={{ fontSize: 10, color: '#9fb3c8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</div>}
                  </div>
                ))}
              </div>

              {/* Perfil del periodo: máximo por instante. Clic para ir. */}
              <div style={{ ...etiqueta, margin: '14px 0 6px' }}>{esPron ? 'Lluvia máxima prevista' : 'Intensidad máxima del día'}</div>
              <svg viewBox={`0 0 ${anchoPerfil} 60`} preserveAspectRatio="none" style={{ width: '100%', height: 64, cursor: 'pointer', display: 'block' }}
                onClick={(ev) => {
                  const r = ev.currentTarget.getBoundingClientRect();
                  buscar(((ev.clientX - r.left) / r.width) * dur);
                }}>
                {esPron && pctConfiable < 100 && (
                  <rect x={anchoPerfil * pctConfiable / 100} y={0} width={anchoPerfil * (1 - pctConfiable / 100)} height={60} fill="rgba(255,255,255,.05)" />
                )}
                {Array.from(datos.maxSlot).map((raw, i) => {
                  const v = eq15(datos, raw);
                  const h = Math.max(v > 0 ? 2 : 0.6, (v / maxBarra) * 56);
                  const nv = nivelDe(v);
                  return <rect key={i} x={i * paso} y={60 - h} width={Math.max(0.6, paso * 0.75)} height={h}
                    fill={nv ? nv.color : (v > 0 ? COLOR_LLOVIO : 'rgba(255,255,255,.15)')} opacity={i <= slotUI ? 1 : 0.45} />;
                })}
                <line x1={slotUI * paso + paso * 0.37} x2={slotUI * paso + paso * 0.37} y1={0} y2={60} stroke="#fff" strokeWidth={1.2} />
              </svg>
              <div style={{ position: 'relative', height: 12, fontSize: 9.5, color: '#7fa5c0', marginTop: 2 }}>
                {marcasEje.map(([t, x]) => (
                  <span key={t + x} style={{ position: 'absolute', left: `${x}%`, transform: x >= 99 ? 'translateX(-100%)' : 'none', whiteSpace: 'nowrap' }}>{t}</span>
                ))}
              </div>

              {resumen.ranking.some(r => r.a > 0) && (
                <>
                  <div style={{ ...etiqueta, margin: '14px 0 6px' }}>{esPron ? 'Mayor acumulado previsto' : 'Mayor acumulado'}</div>
                  {resumen.ranking.filter(r => r.a > 0).map(r => {
                    const nv = nivelDe(eq15(datos, r.i));
                    return (
                      <div key={r.id} style={{ display: 'grid', gridTemplateColumns: '1fr 54px', alignItems: 'center', gap: 8, marginBottom: 5 }}>
                        <div>
                          <div style={{ fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</div>
                          <div style={{ height: 4, borderRadius: 2, background: 'rgba(255,255,255,.1)', marginTop: 3 }}>
                            <div style={{ height: 4, borderRadius: 2, width: `${(r.a / resumen.ranking[0].a) * 100}%`, background: nv ? nv.color : COLOR_LLOVIO }} />
                          </div>
                        </div>
                        <div style={{ fontSize: 12, fontWeight: 800, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.a.toFixed(1)} mm</div>
                      </div>
                    );
                  })}
                </>
              )}
            </>
          )}

          {fuente === 'sim' && (
            <>
              <div style={{ ...etiqueta, margin: '14px 0 4px', display: 'flex', alignItems: 'center', gap: 6 }}>
                <FaFlask size={10} /> ¿Qué pasaría si…?
              </div>
              <div style={{ fontSize: 11, color: '#cfe1ef', marginBottom: 6 }}>
                Núcleo de la tormenta: <b>{pico.toFixed(2)} mm/15 min</b>
                {nivelDe(pico) && <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 800, padding: '2px 6px', borderRadius: 4, background: nivelDe(pico).color, color: nivelDe(pico).texto }}>{nivelDe(pico).nombre}</span>}
              </div>
              <input type="range" className="l3d-rango" min={0.3} max={3} step={0.05} value={pico}
                onChange={e => setPico(parseFloat(e.target.value))} />
            </>
          )}

          {esPron && (
            <div style={{ fontSize: 9.5, color: '#7fa5c0', marginTop: 12, lineHeight: 1.45 }}>
              Pronóstico: Open-Meteo (modelos ECMWF, GFS, ICON y otros) para la coordenada de cada estación.
              Los colores comparan la lluvia horaria en su equivalente por 15 min. Lo oficial son los avisos de SENAMHI.
            </div>
          )}
        </div>
      )}

      {/* ── Línea de tiempo ── */}
      {modoLluvia && (
        <div style={{ position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 10, width: 'min(880px, calc(100vw - 32px))', ...vidrio, padding: '10px 14px', color: '#fff' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button onClick={() => { if (minutoRef.current >= dur - 1) buscar(0); setReproduciendo(r => !r); }} disabled={!datos}
              style={{ width: 38, height: 38, borderRadius: '50%', border: 'none', background: '#35B6E9', color: '#04101f', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}>
              {reproduciendo ? <FaPause size={13} /> : <FaPlay size={13} style={{ marginLeft: 2 }} />}
            </button>
            <button onClick={() => buscar(0)} title={esPron ? 'Volver a ahora' : 'Volver a las 00:00'} style={{ ...chip(false), padding: '6px 8px' }}><FaUndo size={10} /></button>
            <div style={{ fontSize: 13, fontWeight: 800, fontVariantNumeric: 'tabular-nums', minWidth: 44, whiteSpace: 'nowrap' }}>{ahoraTxt.corto}</div>
            <input type="range" className="l3d-rango" min={0} max={Math.max(1, dur - 1)} step={1} value={Math.floor(minutoUI)}
              onChange={e => buscar(parseInt(e.target.value, 10))}
              style={{ flex: 1, ...(esPron && pctConfiable < 100
                ? { background: `linear-gradient(90deg, rgba(255,255,255,.3) ${pctConfiable}%, rgba(255,255,255,.08) ${pctConfiable}%)` } : {}) }} />
            <div style={{ display: 'flex', gap: 4 }}>
              {velocidades.map(s => (
                <button key={s.v} title={s.d} onClick={() => setVel(s.v)} style={chip(vel === s.v)}>{s.t}</button>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 9, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={etiqueta}>Datos</span>
              <button onClick={() => cambiarFuente('real')} style={chip(fuente === 'real')}>Reales</button>
              <button onClick={() => cambiarFuente('pron')} style={chip(esPron)}>Pronóstico</button>
              <button onClick={() => cambiarFuente('sim')} style={chip(fuente === 'sim')}>Simulación</button>
            </div>
            {fuente === 'real' && (
              <input type="date" className="l3d-fecha" value={fecha} max={fmtFecha(new Date())}
                onChange={e => e.target.value && setFecha(e.target.value)} />
            )}
            {esPron && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                {[3, 7].map(n => (
                  <button key={n} onClick={() => setDiasPron(n)} style={chip(diasPron === n)}>{n} días</button>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={etiqueta}>Manto</span>
              <button onClick={() => setVistaManto('int')} style={chip(vistaManto === 'int')}>Intensidad</button>
              <button onClick={() => setVistaManto('acu')} style={chip(vistaManto === 'acu')}>Acumulado</button>
            </div>
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, fontSize: 10.5, color: '#9fb3c8' }}>
              <span>{vistaManto === 'int' ? '0' : '0 mm'}</span>
              <span style={{ width: 90, height: 8, borderRadius: 4, background: gradienteCSS(), display: 'inline-block' }} />
              <span>{vistaManto === 'int' ? (esPron ? `${(TOPE_INTENSIDAD * 4).toFixed(1)} mm/h` : `${TOPE_INTENSIDAD} mm/15′`) : 'máx. del periodo'}</span>
            </div>
          </div>
        </div>
      )}

      {/* Leyenda */}
      <div style={{ position: 'absolute', bottom: modoLluvia ? 118 : 16, left: 16, zIndex: 10, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', maxWidth: 'calc(100vw - 32px)', ...vidrio, borderRadius: 10, padding: '9px 14px', fontSize: 11.5, color: '#cfe1ef', fontWeight: 600 }}>
        {modoLluvia ? (
          <>
            {NIVELES.map(n => (
              <span key={n.nivel} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <i style={{ width: 9, height: 9, borderRadius: 2, background: n.color, display: 'inline-block' }} />
                {n.nombre} ≥ {esPron ? `${(n.desde * 4).toFixed(2)} mm/h` : n.desde}
              </span>
            ))}
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <i style={{ width: 9, height: 9, borderRadius: 2, background: COLOR_SIN_DATOS, display: 'inline-block' }} /> Sin datos
            </span>
            <span style={{ color: '#7fa5c0' }}>· altura = acumulado · color = {unidad(datos)}</span>
          </>
        ) : (
          <>
            {[['#f59f00', 'Leve'], ['#f76707', 'Moderada'], ['#ef4444', 'Grave'], ['#2fb344', 'Resuelto']].map(([c, t]) => (
              <span key={t} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <i style={{ width: 9, height: 9, borderRadius: '50%', background: c, display: 'inline-block' }} /> {t}
              </span>
            ))}
            <span style={{ color: '#7fa5c0' }}>·</span>
            <span style={{ color: '#7fa5c0' }}>{incidentes.length} incidente(s)</span>
          </>
        )}
      </div>

      {listo && zoom < ZOOM_AGRUPA && !modoLluvia && (
        <div style={{ position: 'absolute', bottom: 70, left: '50%', transform: 'translateX(-50%)', zIndex: 10,
                      ...vidrio, borderRadius: 10, padding: '8px 16px', fontSize: 12, color: '#cfe1ef', fontWeight: 600 }}>
          Arrastra el globo para explorarlo · pulsa la marca de Perú para ir al mapa
        </div>
      )}

      {!listo && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8fd0f5', fontSize: 14, fontWeight: 700, gap: 10, zIndex: 5 }}>
          <FaSyncAlt className="icon-spin" /> Cargando el globo…
        </div>
      )}
    </div>
  );
}

export default Mapa3D;
