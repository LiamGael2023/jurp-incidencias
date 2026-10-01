import { useState, useRef, useEffect } from 'react';
import { MapContainer, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './MapaDashboard.css';
import './MapaGIS.css';
import RailGIS from './RailGIS';
import {
  FaGlobe, FaSyncAlt, FaCamera, FaShareAlt,
  FaPlus, FaMinus, FaRulerCombined, FaDrawPolygon, FaEraser, FaLocationArrow,
  FaObjectGroup, FaObjectUngroup,
} from 'react-icons/fa';
import { MiniMapa, HerramientaMedicion, useCapturaMapa } from './MapaHerramientas';
import './MapaHerramientas.css';
import { useInventario, CapasInventario, PanelInventario, ModalEvaluacion,
         BuscadorInventario } from './InventarioGIS';

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

// El satélite y las calles salían de mt1.google.com, que NO envía cabeceras
// CORS. Eso hacía imposible capturar el mapa: html2canvas dibujaba las teselas
// pero el canvas quedaba contaminado, y toDataURL lanzaba SecurityError — que
// el botón convertía en un "No se pudo capturar el mapa" sin decir por qué.
//
// ESRI World Imagery responde con Access-Control-Allow-Origin, así que las
// teselas entran en la captura. Es además el endpoint publicado para este uso,
// mientras que mt1.google.com es interno de Google Maps y usarlo directamente
// queda fuera de sus condiciones.
const BASES = {
  satelite:    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  calles:      'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
  topografico: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
  oscuro:      'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
};

// Atribución exigida por cada proveedor. No es decorativa: es la condición de
// uso de las teselas, y por eso viaja también dentro de la captura.
const CREDITOS = {
  satelite:    'Esri, Maxar, Earthstar Geographics',
  calles:      '&copy; OpenStreetMap, &copy; CARTO',
  topografico: '&copy; OpenStreetMap, SRTM · OpenTopoMap (CC-BY-SA)',
  oscuro:      '&copy; OpenStreetMap, &copy; CARTO',
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

  const mapRef = useRef(null);
  const contenedorRef = useRef(null);
  const { ocupado: capturando, descargar, compartir } = useCapturaMapa(contenedorRef);

  const inv = useInventario();

  // El panel del inventario es la razón de esta vista: se abre al entrar.
  useEffect(() => { if (!inv.abierto) inv.alternar(); }, []);   // solo al montar

  return (
    <div className="gis">

      {/* ══════════════ MAPA ══════════════ */}
      {/* La captura cuelga de aquí y no de .gis: así la foto sale sin
          cabecera, panel, herramientas ni leyenda, que son hermanos de este div. */}
      <div className="gis-mapa" ref={contenedorRef}>
        <MapContainer center={CENTRO} zoom={10} style={{ height: '100%', width: '100%' }}
          ref={mapRef} zoomControl={false}>
          {/* crossOrigin pide las teselas con CORS desde el primer momento. Sin
              esto el navegador las guarda sin permiso de lectura y el canvas de
              la captura queda contaminado aunque el servidor sí lo permita. */}
          <TileLayer url={BASES[base] || BASES.satelite} maxZoom={20}
            crossOrigin="anonymous" attribution={CREDITOS[base] || CREDITOS.satelite} />
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

        {/* El mismo buscador del panel, no uno parecido. */}
        <div className="gis-buscador">
          <BuscadorInventario inv={inv} clase="inv-buscador-top" />
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
        {/* Va pegado a la cámara porque es ahí donde hace falta: con el racimo
            encendido, la captura sale con burbujas numeradas en vez de los
            activos. El estado se recuerda entre sesiones.

            Apagarlo con el inventario entero encendido pinta miles de
            marcadores de una vez y el navegador deja de responder unos
            segundos — que desde fuera se ve igual que un botón roto. Por eso
            se avisa antes y se sugiere la salida: apagar capas primero. */}
        <button className={`gis-tool ${inv.cluster ? 'activo' : ''}`}
          title={inv.cluster
            ? `Agrupando ${inv.totalVisibles.toLocaleString('es-PE')} activos — apágalo para verlos uno a uno`
            : `Mostrando ${inv.totalVisibles.toLocaleString('es-PE')} activos sin agrupar — enciéndelo si el mapa va lento`}
          onClick={() => {
            const MUCHOS = 800;
            if (inv.cluster && inv.totalVisibles > MUCHOS) {
              const sigue = window.confirm(
                `Vas a mostrar ${inv.totalVisibles.toLocaleString('es-PE')} activos sin agrupar.\n\n`
                + 'El mapa puede tardar unos segundos en responder. Si solo necesitas '
                + 'fotografiar una zona, apaga antes las capas que no vas a mostrar.\n\n'
                + '¿Continuar?');
              if (!sigue) return;
            }
            inv.alternarCluster();
          }}>
          {inv.cluster ? <FaObjectGroup /> : <FaObjectUngroup />}
        </button>
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