import { useState, useRef, useEffect } from 'react';
import { MapContainer, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './MapaDashboard.css';
import './MapaGIS.css';
import RailGIS from './RailGIS';
import {
  FaGlobe, FaSyncAlt, FaSearch, FaTimes, FaCamera, FaShareAlt,
  FaPlus, FaMinus, FaRulerCombined, FaDrawPolygon, FaEraser, FaLocationArrow,
} from 'react-icons/fa';
import { MiniMapa, HerramientaMedicion, useCapturaMapa } from './MapaHerramientas';
import './MapaHerramientas.css';
import { useInventario, CapasInventario, PanelInventario, ModalEvaluacion } from './InventarioGIS';

/**
 * Visor del módulo INVENTARIO.
 *
 * Es un mapa propio, no el de incidencias: aquí no hay incidentes,
 * pluviómetros, ruteo, plan de contingencia ni capas KMZ. Solo el inventario
 * de infraestructura (PostGIS) sobre la cartografía base, con las
 * herramientas de medición y captura.
 *
 * La lógica de las capas y del avance de campaña vive en InventarioGIS.jsx,
 * que se comparte con el visor de incidencias.
 */

const CENTRO = [-8.4186, -78.7533];

const BASES = {
  satelite:    'https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
  calles:      'https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}',
  topografico: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
  oscuro:      'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
};

// Coordenadas UTM en la esquina, igual que en el visor de incidencias.
function latLngToUTM(lat, lng) {
  const zone = Math.floor((lng + 180) / 6) + 1, k0 = 0.9996, a = 6378137,
        e2 = 0.00669437999014, ep2 = e2 / (1 - e2);
  const latR = lat * Math.PI / 180, lngR = lng * Math.PI / 180,
        lngO = ((zone - 1) * 6 - 180 + 3) * Math.PI / 180;
  const N = a / Math.sqrt(1 - e2 * Math.sin(latR) ** 2), T = Math.tan(latR) ** 2,
        C = ep2 * Math.cos(latR) ** 2, A = Math.cos(latR) * (lngR - lngO);
  const M = a * ((1 - e2/4 - 3*e2*e2/64) * latR - (3*e2/8 + 3*e2*e2/32) * Math.sin(2*latR)
            + (15*e2*e2/256) * Math.sin(4*latR));
  const easting = k0 * N * (A + (1-T+C)*A**3/6 + (5-18*T+T*T)*A**5/120) + 500000;
  let northing = k0 * (M + N * Math.tan(latR) * (A*A/2 + (5-T+9*C+4*C*C)*A**4/24));
  if (lat < 0) northing += 10000000;
  return { e: easting.toFixed(1), n: northing.toFixed(1), z: `${zone}S` };
}

function UTMDisplay() {
  const [c, setC] = useState(null);
  useMapEvents({
    mousemove(e) { setC(latLngToUTM(e.latlng.lat, e.latlng.lng)); },
    mouseout() { setC(null); },
  });
  return c ? <div className="dash-utm">UTM {c.z} E {c.e} N {c.n}</div> : null;
}

function IrA({ pos }) {
  const map = useMap();
  useEffect(() => { if (pos) map.flyTo(pos, 16, { duration: 1.2 }); }, [pos, map]);
  return null;
}

function MapaInventario({ menu, vistaActual, onNavegar, usuario, onLogout, app }) {
  const [base, setBase] = useState('satelite');
  const [herramienta, setHerramienta] = useState(null);
  const [destino, setDestino] = useState(null);
  const [busqueda, setBusqueda] = useState('');
  const [resultados, setResultados] = useState([]);
  const [buscando, setBuscando] = useState(false);

  const mapRef = useRef(null);
  const contenedorRef = useRef(null);
  const { ocupado: capturando, descargar, compartir } = useCapturaMapa(contenedorRef);

  const inv = useInventario();

  // El panel del inventario es la razón de esta vista: se abre al entrar.
  useEffect(() => { if (!inv.abierto) inv.alternar(); }, []);   // solo al montar

  // ── Búsqueda dentro de las capas ya descargadas ──────────────────────
  // Solo mira lo que está cargado en memoria: buscar en el servidor exigiría
  // un endpoint de búsqueda que el inventario todavía no tiene.
  const buscar = (txt) => {
    setBusqueda(txt);
    if (txt.trim().length < 2) { setResultados([]); return; }
    const q = txt.toLowerCase();
    const out = [];
    for (const [codigo, fc] of Object.entries(inv.datos || {})) {
      for (const f of (fc?.features || [])) {
        const p = f.properties || {};
        const nombre = String(p.nombre || p.codigo || '');
        if (!nombre.toLowerCase().includes(q)) continue;
        const c = f.geometry?.coordinates;
        if (!c) continue;
        const [lng, lat] = Array.isArray(c[0]) ? c[0] : c;
        if (typeof lat !== 'number' || typeof lng !== 'number') continue;
        out.push({ nombre, capa: codigo, lat, lng });
        if (out.length >= 8) break;
      }
      if (out.length >= 8) break;
    }
    setResultados(out);
  };

  const irAResultado = (r) => {
    setDestino([r.lat, r.lng]);
    setResultados([]);
    setBusqueda(r.nombre);
    setTimeout(() => setDestino(null), 1800);
  };

  return (
    <div className="gis" ref={contenedorRef}>

      {/* ══════════════ MAPA ══════════════ */}
      <div className="gis-mapa">
        <MapContainer center={CENTRO} zoom={10} style={{ height: '100%', width: '100%' }}
          ref={mapRef} zoomControl={false}>
          <TileLayer url={BASES[base] || BASES.satelite} maxZoom={20} />
          <UTMDisplay />
          <MiniMapa tileUrl={BASES[base] || BASES.satelite} />
          <IrA pos={destino} />
          <HerramientaMedicion
            modo={herramienta === 'distancia' || herramienta === 'area' ? herramienta : null}
            onFinish={() => {}} />

          <CapasInventario inv={inv} />
        </MapContainer>
      </div>
      <div className="gis-vineta" />

      {/* ══════════════ RAIL ══════════════ */}
      <RailGIS menu={menu} vistaActual={vistaActual} onNavegar={onNavegar}
        usuario={usuario} onLogout={onLogout} app={app} />

      {/* ══════════════ BARRA SUPERIOR ══════════════ */}
      <header className="gis-top">
        <div className="gis-marca gis-glass">
          <div>
            <div className="gis-marca-t1">Inventario de Infraestructura</div>
            <div className="gis-marca-t2">JUNTA DE RIEGO PRESURIZADO</div>
          </div>
        </div>

        <div className="gis-buscador">
          <div className="gis-buscador-caja">
            <FaSearch className="gis-buscador-ico" />
            <input value={busqueda} onChange={e => buscar(e.target.value)}
              placeholder="Buscar en las capas encendidas…" />
            {busqueda && (
              <button className="gis-buscador-x"
                onClick={() => { setBusqueda(''); setResultados([]); }}>
                <FaTimes />
              </button>
            )}
            {resultados.length > 0 && (
              <div className="gis-resultados gis-glass">
                {resultados.map((r, i) => (
                  <div key={i} className="gis-resultado" onClick={() => irAResultado(r)}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <b>{r.nombre}</b>
                      <span>{r.capa}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="gis-acciones gis-glass">
          <span className="gis-chip-activo"><span className="gis-punto" />ACTIVO</span>
          <select className="gis-select" value={base} onChange={e => setBase(e.target.value)}>
            <option value="satelite">Satélite</option>
            <option value="calles">Calles</option>
            <option value="topografico">Topográfico</option>
            <option value="oscuro">Oscuro</option>
          </select>
          <button className="gis-btn-primario" onClick={inv.recargar} disabled={inv.iniciando}>
            <FaSyncAlt className={inv.iniciando ? 'icon-spin' : ''} />
            {inv.iniciando ? '…' : 'Actualizar'}
          </button>
        </div>
      </header>

      {/* ══════════════ HERRAMIENTAS ══════════════ */}
      <div className="gis-tools gis-glass">
        <button className="gis-tool" title="Vista general"
          onClick={() => mapRef.current?.flyTo(CENTRO, 10, { duration: 1 })}><FaGlobe /></button>
        <button className="gis-tool" title="Mi ubicación"
          onClick={() => navigator.geolocation.getCurrentPosition(
            p => setDestino([p.coords.latitude, p.coords.longitude]))}><FaLocationArrow /></button>
        <div className="gis-tool-sep" />
        <button className={`gis-tool ${herramienta === 'distancia' ? 'activo' : ''}`}
          title="Medir distancia"
          onClick={() => setHerramienta(herramienta === 'distancia' ? null : 'distancia')}>
          <FaRulerCombined />
        </button>
        <button className={`gis-tool ${herramienta === 'area' ? 'activo' : ''}`}
          title="Medir área"
          onClick={() => setHerramienta(herramienta === 'area' ? null : 'area')}>
          <FaDrawPolygon />
        </button>
        <button className="gis-tool" title="Limpiar medición"
          onClick={() => setHerramienta(null)}><FaEraser /></button>
        <div className="gis-tool-sep" />
        <button className="gis-tool" title="Capturar mapa"
          onClick={descargar} disabled={capturando}><FaCamera /></button>
        <button className="gis-tool" title="Compartir captura"
          onClick={compartir} disabled={capturando}><FaShareAlt /></button>
        <div className="gis-tool-sep" />
        <button className="gis-tool" title="Acercar"
          onClick={() => mapRef.current?.zoomIn()}><FaPlus /></button>
        <button className="gis-tool" title="Alejar"
          onClick={() => mapRef.current?.zoomOut()}><FaMinus /></button>
      </div>

      {/* ══════════════ PANEL DEL INVENTARIO ══════════════ */}
      <PanelInventario inv={inv}
        onVolar={(b) => mapRef.current?.fitBounds(b, { padding: [50, 50], maxZoom: 16 })} />

      {/* Formulario de evaluación. Sin esto, el botón "Evaluar" del popup
          cambia el estado pero no se abre nada en pantalla. */}
      <ModalEvaluacion inv={inv} />

      {/* ══════════════ LEYENDA ══════════════ */}
      <div className="gis-leyenda gis-glass">
        <span><i style={{ background: '#2f9e44' }} />Bueno</span>
        <span><i style={{ background: '#f59f00' }} />Regular</span>
        <span><i style={{ background: '#e8590c' }} />Malo</span>
        <span><i style={{ background: '#c92a2a' }} />Colapsado</span>
        <span><i style={{ background: '#868e96' }} />No ubicado</span>
        <span className="gis-leyenda-sep" />
        <code>{inv.totalVisibles.toLocaleString('es-PE')} ACTIVOS EN PANTALLA</code>
      </div>
    </div>
  );
}

export default MapaInventario;