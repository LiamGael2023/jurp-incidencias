import { useEffect, useRef, useState, useCallback } from 'react';
// maplibre-gl 6 eliminó el export default: ahora todo son exports nombrados,
// así que hay que importar el espacio de nombres completo.
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import {
  FaTimes, FaGlobeAmericas, FaMountain, FaLayerGroup,
  FaPlay, FaSyncAlt, FaLocationArrow,
} from 'react-icons/fa';

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
 */

// Mismas teselas que el visor 2D, para que la imagen no cambie entre vistas.
const TILES_SATELITE = 'https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}';
// Relieve abierto de AWS (Terrarium). No necesita clave.
const TILES_DEM = 'https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png';

const CENTRO = [-78.7533, -8.4186];   // [lng, lat] — MapLibre usa este orden

const COLOR_GRAVEDAD = { lev: '#f59f00', mod: '#f76707', gra: '#ef4444' };
const resuelto = (e) => e === 'ate' || e === 'cer';
const colorIncidente = (inc) =>
  resuelto(inc.estado) ? '#2fb344' : (COLOR_GRAVEDAD[inc.gravedad] || '#f59f00');

function Mapa3D({ incidentes = [], capasLinea = [], onCerrar, onSeleccionar }) {
  const contenedor = useRef(null);
  const mapa = useRef(null);
  const marcadores = useRef([]);

  const [listo, setListo] = useState(false);
  const [relieve, setRelieve] = useState(true);
  const [verCapas, setVerCapas] = useState(true);
  const [volando, setVolando] = useState(false);

  // ── El vuelo: del espacio a Chavimochic ──────────────────────────────
  const volarAlCanal = useCallback(() => {
    const m = mapa.current;
    if (!m) return;
    setVolando(true);
    // Primero atrás, al globo completo; luego la aproximación.
    m.jumpTo({ center: CENTRO, zoom: 0.8, pitch: 0, bearing: 0 });
    setTimeout(() => {
      m.flyTo({
        center: CENTRO,
        zoom: 11.5,
        pitch: 62,        // cámara inclinada: es lo que hace visible el relieve
        bearing: -18,
        duration: 6500,
        curve: 1.5,       // curva de aproximación, no un zoom plano
        essential: true,
      });
      setTimeout(() => setVolando(false), 6600);
    }, 350);
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
            tiles: [TILES_SATELITE],
            tileSize: 256,
            maxzoom: 20,
            attribution: 'Imagery © Google',
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
      zoom: 0.8,
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
      volarAlCanal();
    });

    return () => { m.remove(); mapa.current = null; };
  }, [capasLinea, volarAlCanal]);

  // ── Marcadores de incidentes ─────────────────────────────────────────
  useEffect(() => {
    const m = mapa.current;
    if (!m || !listo) return;

    marcadores.current.forEach(mk => mk.remove());
    marcadores.current = [];

    incidentes.forEach(inc => {
      if (!Number.isFinite(inc.lat) || !Number.isFinite(inc.lng)) return;
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

      if (onSeleccionar) el.addEventListener('click', () => onSeleccionar(inc));
      marcadores.current.push(marcador);
    });
  }, [incidentes, listo, onSeleccionar]);

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

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 4000, background: '#04101f' }}>
      <style>{`
        @keyframes m3d-pulso { 0%{transform:scale(.8);opacity:.5} 70%{transform:scale(1.8);opacity:0} 100%{opacity:0} }
        .maplibregl-popup-content { border-radius: 9px; padding: 10px 12px; }
      `}</style>

      <div ref={contenedor} style={{ position: 'absolute', inset: 0 }} />

      {/* Cabecera */}
      <div style={{ position: 'absolute', top: 16, left: 16, zIndex: 10, display: 'flex', alignItems: 'center', gap: 12, background: 'rgba(8,22,40,.62)', backdropFilter: 'blur(10px)', border: '1px solid rgba(255,255,255,.14)', borderRadius: 12, padding: '10px 16px' }}>
        <FaGlobeAmericas size={20} color="#35B6E9" />
        <div style={{ fontSize: 15, fontWeight: 800, color: '#fff', letterSpacing: '.04em' }}>
          VISTA 3D
        </div>
      </div>

      {/* Controles */}
      <div style={{ position: 'absolute', top: 16, right: 60, zIndex: 10, display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        <button onClick={volarAlCanal} disabled={volando} style={btn(false)}>
          {volando ? <FaSyncAlt className="icon-spin" /> : <FaPlay size={11} />}
          {volando ? 'Volando…' : 'Repetir vuelo'}
        </button>
        <button onClick={() => setRelieve(v => !v)} style={btn(relieve)}>
          <FaMountain size={12} /> Relieve
        </button>
        <button onClick={() => setVerCapas(v => !v)} style={btn(verCapas)}>
          <FaLayerGroup size={12} /> Capas
        </button>
        <button onClick={() => mapa.current?.flyTo({ center: CENTRO, zoom: 11.5, pitch: 62, bearing: -18, duration: 1800 })} style={btn(false)}>
          <FaLocationArrow size={11} /> Centrar
        </button>
        <button onClick={onCerrar} style={{ ...btn(false), background: 'rgba(214,57,57,.55)', borderColor: 'rgba(255,255,255,.35)' }}>
          <FaTimes size={12} /> Salir del 3D
        </button>
      </div>

      {/* Leyenda */}
      <div style={{ position: 'absolute', bottom: 16, left: 16, zIndex: 10, display: 'flex', alignItems: 'center', gap: 14, background: 'rgba(8,22,40,.62)', backdropFilter: 'blur(10px)', border: '1px solid rgba(255,255,255,.14)', borderRadius: 10, padding: '9px 14px', fontSize: 11.5, color: '#cfe1ef', fontWeight: 600 }}>
        {[['#f59f00', 'Leve'], ['#f76707', 'Moderada'], ['#ef4444', 'Grave'], ['#2fb344', 'Resuelto']].map(([c, t]) => (
          <span key={t} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <i style={{ width: 9, height: 9, borderRadius: '50%', background: c, display: 'inline-block' }} /> {t}
          </span>
        ))}
        <span style={{ color: '#7fa5c0' }}>·</span>
        <span style={{ color: '#7fa5c0' }}>{incidentes.length} incidente(s)</span>
      </div>

      {!listo && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8fd0f5', fontSize: 14, fontWeight: 700, gap: 10, zIndex: 5 }}>
          <FaSyncAlt className="icon-spin" /> Cargando el globo…
        </div>
      )}
    </div>
  );
}

export default Mapa3D;