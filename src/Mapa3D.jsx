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
} from 'react-icons/fa';
import { capaBase } from './capasBase';
import { fmtFecha, estaCaida } from './lluviaEstacion';
import {
  SLOTS, MIN_SLOT, NIVELES, nivelDe, horaDeMinuto,
  COLOR_SIN_DATOS, COLOR_LLOVIO, COLOR_SECO,
  cargarDia, simularDia, preparar, hayLluvia,
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
 * MODO LLUVIA (gemelo pluviométrico): reproduce un día de lluvia sobre el
 * relieve. Cada estación es una columna cuya altura es el acumulado del día y
 * cuyo color es el nivel de alerta del cuarto de hora en curso; entre
 * estaciones, un manto interpolado (IDW) muestra dónde está cayendo el agua, y
 * sobre él caen gotas donde llueve. La línea de tiempo permite recorrer el
 * día, acelerarlo y ver los incidentes aparecer a la hora en que se
 * reportaron. Con "Simulación" se puede presentar sin que llueva y plantear un
 * "¿qué pasaría si?" con la intensidad del núcleo de la tormenta.
 */

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
const RADIO_COLUMNA = 1100;           // metros
const LADO_MANTO = 160;               // píxeles del lienzo interpolado
const TOPE_INTENSIDAD = 1.4;          // mm/15 min en el extremo de la rampa
const MAX_GOTAS = 3200;
// Velocidad = segundos simulados por segundo real. 900x es un cuarto de hora
// por segundo: el día entero en minuto y medio.
const VELOCIDADES = [
  { v: 60, t: '60x', d: '1 min por segundo' },
  { v: 300, t: '300x', d: '5 min por segundo' },
  { v: 900, t: '900x', d: '15 min por segundo' },
  { v: 3600, t: '3600x', d: '1 h por segundo' },
];

const vidrio = {
  background: 'rgba(8,22,40,.66)', backdropFilter: 'blur(10px)',
  border: '1px solid rgba(255,255,255,.14)', borderRadius: 12,
};

maplibregl.setWorkerUrl(urlWorkerMapLibre);

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

  // ── Estado del modo lluvia ───────────────────────────────────────────
  const [modoLluvia, setModoLluvia] = useState(false);
  const [fuente, setFuente] = useState('real');          // 'real' | 'sim'
  const [fecha, setFecha] = useState(() => fmtFecha(new Date()));
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
    m.on('zoom', () => setZoom(m.getZoom()));

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

  // Redibuja columnas, manto y etiquetas para un cuarto de hora.
  const pintarSlot = useCallback((slot) => {
    const m = mapa.current;
    const d = datosRef.current;
    if (!m || !d) return;
    slotPintado.current = slot;

    const features = [];
    const puntos = [];
    const acuMaxDia = Math.max(10, ...Object.values(d.acumulado).filter(Boolean).map(a => a[SLOTS - 1]));

    ests.forEach((e, i) => {
      const inten = d.intensidad[e.id];
      const acu = d.acumulado[e.id];
      let color, h, iv = 0, av = 0;
      if (!inten) {
        color = COLOR_SIN_DATOS; h = BASE_COLUMNA * 0.6;
      } else {
        iv = inten[slot]; av = acu[slot];
        const nv = nivelDe(iv);
        color = nv ? nv.color : (iv > 0 ? COLOR_LLOVIO : (av > 0 ? COLOR_LLOVIO : COLOR_SECO));
        h = Math.min(BASE_COLUMNA + av * M_POR_MM, 12000);
        puntos.push({ lng: e.lng, lat: e.lat, v: vistaRef.current === 'int' ? iv : av });
      }
      features.push({
        type: 'Feature',
        properties: { color, h },
        geometry: { type: 'Polygon', coordinates: [circulo(e.lng, e.lat, RADIO_COLUMNA)] },
      });

      // Etiqueta de la estación.
      const mk = marcasEst.current[i];
      if (mk) {
        const nv = inten ? nivelDe(iv) : null;
        const pill = mk.querySelector('.l3d-pill');
        pill.textContent = !inten ? 'sin datos' : `${av.toFixed(1)} mm`;
        pill.style.background = !inten ? 'rgba(71,85,105,.85)' : (nv ? nv.color : 'rgba(8,22,40,.82)');
        pill.style.color = nv ? nv.texto : '#fff';
        mk.title = `${e.name}\n${!inten ? 'Sin lecturas ese día' : `Ahora: ${iv.toFixed(2)} mm/15 min\nAcumulado: ${av.toFixed(2)} mm`}`;
      }
    });

    m.getSource('lluvia-col')?.setData({ type: 'FeatureCollection', features });
    if (lienzoManto.current && bbox) {
      const tope = vistaRef.current === 'int' ? TOPE_INTENSIDAD : acuMaxDia;
      pintarManto(lienzoManto.current, bbox, puntos, tope);
    }
  }, [ests, bbox]);

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
    if (datosRef.current) pintarSlot(Math.min(SLOTS - 1, Math.floor(minutoRef.current / MIN_SLOT)));
    return () => {
      marcasEst.current.forEach(el => el._marcador?.remove());
      marcasEst.current = [];
    };
  }, [modoLluvia, listo, ests, bbox, pintarSlot]);

  // Los nombres solo se ven de cerca; desde lejos se amontonan.
  useEffect(() => {
    marcasEst.current.forEach(el => {
      const n = el.querySelector('.l3d-nom');
      if (n) n.style.display = zoom >= 10.2 ? 'block' : 'none';
    });
  }, [zoom, modoLluvia]);

  // Carga de datos: real (API) o simulación.
  useEffect(() => {
    if (!modoLluvia) return;
    let cancelado = false;
    const aplicar = (series, minutoInicial, mensaje) => {
      if (cancelado) return;
      const d = preparar(series);
      datosRef.current = d;
      setDatos(d);
      setAviso(mensaje);
      minutoRef.current = minutoInicial;
      setMinutoUI(minutoInicial);
      slotPintado.current = -1;
      pintarSlot(Math.floor(minutoInicial / MIN_SLOT));
    };

    // La simulación también pasa por una promesa: así las dos fuentes
    // aplican sus datos fuera del cuerpo del efecto, igual.
    let carga;
    if (fuente === 'sim') {
      carga = Promise.resolve(simularDia(ests, { intensidadPico: pico }))
        .then(series => { aplicar(series, 11 * 60, ''); if (!cancelado) setReproduciendo(true); });
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
          aplicar(series, 0, msg);
          if (!msg && !cancelado) setReproduciendo(true);
        });
    }
    carga.finally(() => { if (!cancelado) setCargandoLluvia(false); });
    return () => { cancelado = true; };
  }, [modoLluvia, fuente, fecha, pico, ests, pintarSlot]);

  // Cambiar entre intensidad y acumulado repinta en el acto.
  useEffect(() => {
    vistaRef.current = vistaManto;
    if (modoLluvia && datosRef.current) pintarSlot(Math.min(SLOTS - 1, Math.floor(minutoRef.current / MIN_SLOT)));
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

      if (d && reproRef.current) {
        minutoRef.current += velRef.current * dt / 60;
        if (minutoRef.current >= 1439.99) { minutoRef.current = 1439.99; setReproduciendo(false); }
      }
      const slot = Math.min(SLOTS - 1, Math.floor(minutoRef.current / MIN_SLOT));
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
          const iv = s ? s[slot] : 0;
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
    minutoRef.current = Math.max(0, Math.min(1439.99, min));
    setMinutoUI(minutoRef.current);
  };

  // KPIs del instante actual.
  const slotUI = Math.min(SLOTS - 1, Math.floor(minutoUI / MIN_SLOT));
  const resumen = useMemo(() => {
    if (!datos) return null;
    let maxI = 0, estI = null, maxA = 0, estA = null, conLluvia = 0, sinDatos = 0;
    const ranking = [];
    for (const e of ests) {
      const s = datos.intensidad[e.id], a = datos.acumulado[e.id];
      if (!s) { sinDatos++; continue; }
      if (s[slotUI] > 0) conLluvia++;
      if (s[slotUI] > maxI) { maxI = s[slotUI]; estI = e.name; }
      if (a[slotUI] > maxA) { maxA = a[slotUI]; estA = e.name; }
      ranking.push({ id: e.id, name: e.name, a: a[slotUI], i: s[slotUI] });
    }
    ranking.sort((x, y) => y.a - x.a);
    return { maxI, estI, maxA, estA, conLluvia, sinDatos, total: ests.length, ranking: ranking.slice(0, 5) };
  }, [datos, slotUI, ests]);

  // Incidentes visibles: en modo lluvia (datos reales) solo los de ese día,
  // y van apareciendo a la hora en que se reportaron.
  const incVisibles = useMemo(() => {
    if (!modoLluvia) return incidentes;
    if (fuente === 'sim') return [];
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

  const maxBarra = datos ? Math.max(TOPE_INTENSIDAD * 0.6, ...datos.maxSlot) : 1;

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
            <div style={etiqueta}>{fuente === 'sim' ? 'Escenario simulado' : new Date(fecha + 'T12:00').toLocaleDateString('es-PE', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })}</div>
            {cargandoLluvia && <FaSyncAlt className="icon-spin" size={11} color="#8fd0f5" />}
          </div>
          <div style={{ fontSize: 40, fontWeight: 800, letterSpacing: '-.02em', fontVariantNumeric: 'tabular-nums', lineHeight: 1.1, margin: '2px 0 10px' }}>
            {horaDeMinuto(minutoUI)}
          </div>

          {aviso && (
            <div style={{ fontSize: 11.5, color: '#ffd8a8', background: 'rgba(243,112,33,.14)', border: '1px solid rgba(243,112,33,.35)', borderRadius: 8, padding: '8px 10px', marginBottom: 10 }}>
              {aviso}
            </div>
          )}

          {resumen && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {[
                  ['Intensidad máx.', `${resumen.maxI.toFixed(2)}`, 'mm/15 min', resumen.estI, nivelDe(resumen.maxI)],
                  ['Acumulado máx.', `${resumen.maxA.toFixed(1)}`, 'mm', resumen.estA, null],
                  ['Lloviendo ahora', `${resumen.conLluvia}`, `de ${resumen.total - resumen.sinDatos}`, null, null],
                  ['Sin datos', `${resumen.sinDatos}`, `de ${resumen.total}`, null, null],
                ].map(([t, v, u, sub, nv]) => (
                  <div key={t} style={{ background: 'rgba(255,255,255,.05)', border: `1px solid ${nv ? nv.color : 'rgba(255,255,255,.1)'}`, borderRadius: 9, padding: '8px 10px' }}>
                    <div style={{ ...etiqueta, fontSize: 9.5 }}>{t}</div>
                    <div style={{ fontSize: 20, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
                      {v} <span style={{ fontSize: 10.5, fontWeight: 600, color: '#9fb3c8' }}>{u}</span>
                    </div>
                    {sub && <div style={{ fontSize: 10, color: '#9fb3c8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</div>}
                  </div>
                ))}
              </div>

              {/* Perfil del día: máximo por cuarto de hora. Clic para ir. */}
              <div style={{ ...etiqueta, margin: '14px 0 6px' }}>Intensidad máxima del día</div>
              <svg viewBox={`0 0 ${SLOTS * 3} 60`} preserveAspectRatio="none" style={{ width: '100%', height: 64, cursor: 'pointer', display: 'block' }}
                onClick={(ev) => {
                  const r = ev.currentTarget.getBoundingClientRect();
                  buscar(((ev.clientX - r.left) / r.width) * 1440);
                }}>
                {Array.from(datos.maxSlot).map((v, i) => {
                  const h = Math.max(v > 0 ? 2 : 0.6, (v / maxBarra) * 56);
                  const nv = nivelDe(v);
                  return <rect key={i} x={i * 3} y={60 - h} width={2.3} height={h}
                    fill={nv ? nv.color : (v > 0 ? COLOR_LLOVIO : 'rgba(255,255,255,.15)')} opacity={i <= slotUI ? 1 : 0.45} />;
                })}
                <line x1={slotUI * 3 + 1.1} x2={slotUI * 3 + 1.1} y1={0} y2={60} stroke="#fff" strokeWidth={1.2} />
              </svg>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9.5, color: '#7fa5c0', marginTop: 2 }}>
                <span>00</span><span>06</span><span>12</span><span>18</span><span>24 h</span>
              </div>

              {resumen.ranking.some(r => r.a > 0) && (
                <>
                  <div style={{ ...etiqueta, margin: '14px 0 6px' }}>Mayor acumulado</div>
                  {resumen.ranking.filter(r => r.a > 0).map(r => {
                    const nv = nivelDe(r.i);
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
        </div>
      )}

      {/* ── Línea de tiempo ── */}
      {modoLluvia && (
        <div style={{ position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 10, width: 'min(860px, calc(100vw - 32px))', ...vidrio, padding: '10px 14px', color: '#fff' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button onClick={() => { if (minutoRef.current >= 1439) buscar(0); setReproduciendo(r => !r); }} disabled={!datos}
              style={{ width: 38, height: 38, borderRadius: '50%', border: 'none', background: '#35B6E9', color: '#04101f', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}>
              {reproduciendo ? <FaPause size={13} /> : <FaPlay size={13} style={{ marginLeft: 2 }} />}
            </button>
            <button onClick={() => buscar(0)} title="Volver a las 00:00" style={{ ...chip(false), padding: '6px 8px' }}><FaUndo size={10} /></button>
            <div style={{ fontSize: 13, fontWeight: 800, fontVariantNumeric: 'tabular-nums', width: 44 }}>{horaDeMinuto(minutoUI)}</div>
            <input type="range" className="l3d-rango" min={0} max={1439} step={1} value={Math.floor(minutoUI)}
              onChange={e => buscar(parseInt(e.target.value, 10))} style={{ flex: 1 }} />
            <div style={{ display: 'flex', gap: 4 }}>
              {VELOCIDADES.map(s => (
                <button key={s.v} title={s.d} onClick={() => setVel(s.v)} style={chip(vel === s.v)}>{s.t}</button>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 9, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={etiqueta}>Datos</span>
              <button onClick={() => setFuente('real')} style={chip(fuente === 'real')}>Reales</button>
              <button onClick={() => setFuente('sim')} style={chip(fuente === 'sim')}>Simulación</button>
            </div>
            {fuente === 'real' && (
              <input type="date" className="l3d-fecha" value={fecha} max={fmtFecha(new Date())}
                onChange={e => e.target.value && setFecha(e.target.value)} />
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={etiqueta}>Manto</span>
              <button onClick={() => setVistaManto('int')} style={chip(vistaManto === 'int')}>Intensidad</button>
              <button onClick={() => setVistaManto('acu')} style={chip(vistaManto === 'acu')}>Acumulado</button>
            </div>
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, fontSize: 10.5, color: '#9fb3c8' }}>
              <span>{vistaManto === 'int' ? '0' : '0 mm'}</span>
              <span style={{ width: 90, height: 8, borderRadius: 4, background: gradienteCSS(), display: 'inline-block' }} />
              <span>{vistaManto === 'int' ? `${TOPE_INTENSIDAD} mm/15′` : 'máx. del día'}</span>
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
                <i style={{ width: 9, height: 9, borderRadius: 2, background: n.color, display: 'inline-block' }} /> {n.nombre} ≥ {n.desde}
              </span>
            ))}
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <i style={{ width: 9, height: 9, borderRadius: 2, background: COLOR_SIN_DATOS, display: 'inline-block' }} /> Sin datos
            </span>
            <span style={{ color: '#7fa5c0' }}>· altura = acumulado · color = mm/15 min</span>
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
