import { useState, useEffect, useMemo, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, GeoJSON, useMap, useMapEvents } from 'react-leaflet';
import L, { divIcon } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import { 
  FaCloudShowersHeavy, FaExclamationTriangle, FaLocationArrow, 
  FaCheck, FaTimes, FaChevronLeft, FaChevronRight, FaGlobe, FaSyncAlt,
  FaSearch, FaChartBar, FaFilter
} from 'react-icons/fa';

import geoCanalMadre from './data/Canal_Madre.json';
import geoLateral10 from './data/Lateral_10.json';
import geoRedes from './data/Redes_Presurizado.json';
import logo from './assets/logo1.png';

// ── Herramientas del visor (minimapa, medición, perfil, street view, captura) ─
import {
  BarraHerramientas, MiniMapa, HerramientaMedicion, useCapturaMapa,
} from './MapaHerramientas';
import './MapaHerramientas.css';

// ── Simbología hidráulica ───────────────────────────────────────────────────
import icoBocatoma        from './assets/simbologia/bocatoma.png';
import icoEntrega         from './assets/simbologia/entrega.png';
import icoToma            from './assets/simbologia/toma.png';
import icoCanoa           from './assets/simbologia/canoa.png';
import icoAlcantarilla    from './assets/simbologia/alcantarilla.png';
import icoPaseVehicular   from './assets/simbologia/pase_vehicular.png';
import icoPasePeatonal    from './assets/simbologia/pase_peatonal.png';
import icoAliviadero      from './assets/simbologia/aliviadero.png';
import icoDesarenador     from './assets/simbologia/desarenador.png';
import icoRapida          from './assets/simbologia/rapida.png';
import icoCanalMadre      from './assets/simbologia/canal_madre.png';
import icoCanalRect       from './assets/simbologia/canal_rectangular.png';
import icoConducCubierto  from './assets/simbologia/conducto_cubierto.png';
import icoCaida           from './assets/simbologia/caida.png';
import icoCanalTrap       from './assets/simbologia/canal_trapezoidal.png';
import icoAcueducto       from './assets/simbologia/acueducto.png';

// ── KMZ layers ──────────────────────────────────────────────────────────────
import kmzEntrega         from './data/kmz/Entrega.json';
import kmzPuentePeatonal  from './data/kmz/Puente_Peatonal.json';
import kmzPuenteVehicular from './data/kmz/Puente_Vehicular.json';
import kmzBocatoma        from './data/kmz/Bocatoma.json';
import kmzAliviadero      from './data/kmz/Aliviadero.json';
import kmzToma            from './data/kmz/Toma.json';
import kmzCanoa           from './data/kmz/Canoa.json';
import kmzAlcantarilla    from './data/kmz/Alcantarilla.json';
import kmzEstacionControl from './data/kmz/Estacion_Control.json';
import kmzRapida          from './data/kmz/Rapida.json';
import kmzCanalMadre      from './data/kmz/Canal_Madre.json';
import kmzLateral10       from './data/kmz/Lateral_10.json';
import kmzCajaHidraulica  from './data/kmz/Caja_Hidraulica.json';
import kmzCamaraRP        from './data/kmz/Camara_Rompepresion.json';
import kmzDesarenador     from './data/kmz/Desarenador.json';
import kmzEvacuador       from './data/kmz/Evacuador.json';
import kmzPartidor        from './data/kmz/Partidor.json';
import kmzPaseTuberias    from './data/kmz/Pase_de_Tuberias.json';
import kmzRedesPresurizado from './data/kmz/Redes_Presurizado.json';

// ── Garitas y Vías ──────────────────────────────────────────────────────────
import geoGaritasJURP    from './data/garitas/GARITAS_JURP.json';
import geoGaritasOtros   from './data/garitas/GARITAS_OTROS.json';
import geoCaminosServ    from './data/garitas/CAMINOS_DE_SERVICIO.json';
import geoViasAcceso     from './data/garitas/VIAS_DE_ACCESO.json';
import geoViaAuxiliar    from './data/garitas/VIA_AUXILIAR.json';
import geoRedNacional    from './data/garitas/RED_NACIONAL.json';
import icoGaritaJURP     from './assets/simbologia/garita_jurp.png';
import icoGaritaOtros    from './assets/simbologia/garita_otros.png';

// ── Helpers ─────────────────────────────────────────────────────────────────
const crearIconoSimbologia = (iconUrl, size = 28) => L.icon({ iconUrl, iconSize: [size, size], iconAnchor: [size/2, size/2], popupAnchor: [0, -(size/2)] });

function latLngToUTM(lat, lng) {
  const zone = Math.floor((lng + 180) / 6) + 1;
  const k0 = 0.9996, a = 6378137, e2 = 0.00669437999014;
  const ep2 = e2 / (1 - e2);
  const latR = lat * Math.PI / 180, lngR = lng * Math.PI / 180;
  const lngO = ((zone - 1) * 6 - 180 + 3) * Math.PI / 180;
  const N = a / Math.sqrt(1 - e2 * Math.sin(latR) ** 2);
  const T = Math.tan(latR) ** 2, C = ep2 * Math.cos(latR) ** 2;
  const A = Math.cos(latR) * (lngR - lngO);
  const M = a * ((1 - e2/4 - 3*e2*e2/64) * latR - (3*e2/8 + 3*e2*e2/32) * Math.sin(2*latR) + (15*e2*e2/256) * Math.sin(4*latR));
  const easting = k0 * N * (A + (1-T+C)*A**3/6 + (5-18*T+T*T)*A**5/120) + 500000;
  let northing = k0 * (M + N * Math.tan(latR) * (A*A/2 + (5-T+9*C+4*C*C)*A**4/24));
  if (lat < 0) northing += 10000000;
  return { e: easting.toFixed(2), n: northing.toFixed(2), z: `${zone}S` };
}

// ── Config KMZ ──────────────────────────────────────────────────────────────
const KMZ_CONFIG = [
  { key: 'KMZ_CanalMadre',       label: 'Canal Madre',        color: '#1971c2', data: kmzCanalMadre,       tipo: 'poly', icon: icoCanalMadre },
  { key: 'KMZ_Lateral10',        label: 'Lateral 10',         color: '#4dabf7', data: kmzLateral10,        tipo: 'poly', icon: icoCanalTrap },
  { key: 'KMZ_RedesPresurizado', label: 'Redes Presurizado',  color: '#74c0fc', data: kmzRedesPresurizado, tipo: 'poly', icon: icoConducCubierto },
  { key: 'KMZ_Evacuador',        label: 'Evacuador',          color: '#a5d8ff', data: kmzEvacuador,        tipo: 'poly', icon: icoAcueducto },
  { key: 'KMZ_Bocatoma',         label: 'Bocatoma',           color: '#206bc4', data: kmzBocatoma,         tipo: 'point', icon: icoBocatoma },
  { key: 'KMZ_Entrega',          label: 'Entrega',            color: '#2f9e44', data: kmzEntrega,          tipo: 'point', icon: icoEntrega },
  { key: 'KMZ_Toma',             label: 'Toma',               color: '#f59f00', data: kmzToma,             tipo: 'point', icon: icoToma },
  { key: 'KMZ_Canoa',            label: 'Canoa',              color: '#f76707', data: kmzCanoa,            tipo: 'point', icon: icoCanoa },
  { key: 'KMZ_Alcantarilla',     label: 'Alcantarilla',       color: '#7048e8', data: kmzAlcantarilla,     tipo: 'point', icon: icoAlcantarilla },
  { key: 'KMZ_PuenteVehicular',  label: 'Puente Vehicular',   color: '#8a6d3b', data: kmzPuenteVehicular,  tipo: 'point', icon: icoPaseVehicular },
  { key: 'KMZ_PuentePeatonal',   label: 'Puente Peatonal',    color: '#e8590c', data: kmzPuentePeatonal,   tipo: 'point', icon: icoPasePeatonal },
  { key: 'KMZ_Aliviadero',       label: 'Aliviadero',         color: '#c92a2a', data: kmzAliviadero,       tipo: 'point', icon: icoAliviadero },
  { key: 'KMZ_CajaHidraulica',   label: 'Caja Hidráulica',    color: '#495057', data: kmzCajaHidraulica,   tipo: 'point', icon: icoCanalRect },
  { key: 'KMZ_Desarenador',      label: 'Desarenador',        color: '#a0522d', data: kmzDesarenador,      tipo: 'point', icon: icoDesarenador },
  { key: 'KMZ_EstacionControl',  label: 'Estación Control',   color: '#fd7e14', data: kmzEstacionControl,  tipo: 'point', icon: icoBocatoma },
  { key: 'KMZ_Partidor',         label: 'Partidor',           color: '#9c36b5', data: kmzPartidor,         tipo: 'point', icon: icoCanalTrap },
  { key: 'KMZ_PaseTuberias',     label: 'Pase Tuberías',      color: '#5c7cfa', data: kmzPaseTuberias,     tipo: 'point', icon: icoConducCubierto },
  { key: 'KMZ_CamaraRP',         label: 'Cámara Rompepresión',color: '#e67700', data: kmzCamaraRP,         tipo: 'point', icon: icoCaida },
  { key: 'KMZ_Rapida',           label: 'Rápida',             color: '#f03e3e', data: kmzRapida,           tipo: 'point', icon: icoRapida },
  // Garitas
  { key: 'GAR_JURP',             label: 'Garitas JURP',       color: '#1098ad', data: geoGaritasJURP,     tipo: 'point', icon: icoGaritaJURP },
  { key: 'GAR_Otros',            label: 'Garitas Otros',      color: '#9c36b5', data: geoGaritasOtros,    tipo: 'point', icon: icoGaritaOtros },
  // Vías
  { key: 'VIA_CaminosServ',      label: 'Caminos de Servicio',color: '#e67700', data: geoCaminosServ,     tipo: 'line', icon: null },
  { key: 'VIA_Acceso',           label: 'Vías de Acceso',     color: '#d6336c', data: geoViasAcceso,      tipo: 'line', icon: null },
  { key: 'VIA_Auxiliar',         label: 'Vía Auxiliar',       color: '#ae3ec9', data: geoViaAuxiliar,     tipo: 'line', icon: null },
  { key: 'VIA_RedNacional',      label: 'Red Nacional',       color: '#d63939', data: geoRedNacional,     tipo: 'line', icon: null },
];

const KMZ_CAPAS_DEFAULT = Object.fromEntries(KMZ_CONFIG.map(c => [c.key, false]));

// ── Indice de búsqueda (pre-computado) ──────────────────────────────────────
const SEARCH_INDEX = KMZ_CONFIG.flatMap(cfg =>
  (cfg.data?.features || [])
    .filter(f => f.geometry?.type === 'Point' && f.properties?.name)
    .map(f => ({
      name: f.properties.name,
      tipo: cfg.label,
      tramo: f.properties.TRAMO || '',
      progresiva: f.properties.PROGRESIVA || '',
      coords: f.geometry.coordinates,
      icon: cfg.icon,
      color: cfg.color,
    }))
);

// ── Componentes auxiliares ───────────────────────────────────────────────────
// Control de zoom (+/−) recolocado en la esquina superior derecha, para dejar
// libre toda la columna izquierda a los botones del visor.
function ZoomDerecha() {
  const map = useMap();
  useEffect(() => {
    const zc = L.control.zoom({ position: 'topright' });
    zc.addTo(map);
    return () => zc.remove();
  }, [map]);
  return null;
}

function BotonEncuadreGeneral({ centro }) {
  const map = useMap();
  return (
    <div className="leaflet-top leaflet-left" style={{ top: '10px', left: '10px', position: 'absolute', zIndex: 1000 }}>
      <div className="leaflet-control leaflet-bar">
        <a href="#" role="button" title="Centrar todo el mapa"
          onClick={(e) => { e.preventDefault(); map.flyTo(centro, 10, { animate: true, duration: 1.5 }); }}
          style={{ display:'flex',justifyContent:'center',alignItems:'center',fontSize:'18px',width:'34px',height:'34px',backgroundColor:'#fff',color:'#206bc4' }}>
          <FaGlobe />
        </a>
      </div>
    </div>
  );
}

function VolarAUbicacion({ posicion }) {
  const map = useMap();
  useEffect(() => { if (posicion) map.flyTo(posicion, 16, { animate: true, duration: 1.5 }); }, [posicion, map]);
  return null;
}

function CoordenadasUTM() {
  const [coords, setCoords] = useState(null);
  useMapEvents({
    mousemove(e) { setCoords(latLngToUTM(e.latlng.lat, e.latlng.lng)); },
    mouseout() { setCoords(null); }
  });
  if (!coords) return null;
  return (
    <div style={{ position:'absolute', bottom:'8px', left:'50%', transform:'translateX(-50%)', zIndex:1000, background:'rgba(0,0,0,0.75)', color:'#fff', padding:'4px 12px', borderRadius:'4px', fontSize:'11px', fontFamily:'monospace', pointerEvents:'none', whiteSpace:'nowrap' }}>
      UTM {coords.z} &nbsp; E {coords.e} &nbsp; N {coords.n}
    </div>
  );
}

// ── Cluster layer (imperativo) ──────────────────────────────────────────────
function ClusteredLayer({ data, icon, color, label, buildPopup }) {
  const map = useMap();
  useEffect(() => {
    if (!data?.features?.length) return;
    const points = data.features.filter(f => f.geometry?.type === 'Point');
    if (!points.length) return;

    const cluster = L.markerClusterGroup({
      maxClusterRadius: 50,
      spiderfyOnMaxZoom: true,
      showCoverageOnHover: false,
      iconCreateFunction: (cl) => {
        const n = cl.getChildCount();
        const sz = n > 50 ? 40 : n > 20 ? 34 : 28;
        return L.divIcon({
          html: `<div style="background:${color};color:#fff;border-radius:50%;width:${sz}px;height:${sz}px;display:flex;align-items:center;justify-content:center;font-size:${sz > 34 ? 13 : 11}px;font-weight:700;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.35)">${n}</div>`,
          className: 'icono-vacio', iconSize: [sz+4, sz+4], iconAnchor: [(sz+4)/2, (sz+4)/2]
        });
      }
    });

    const leafIcon = crearIconoSimbologia(icon);
    for (const f of points) {
      const [lng, lat] = f.geometry.coordinates;
      const marker = L.marker([lat, lng], { icon: leafIcon });
      marker.bindTooltip(f.properties.name || '', { direction: 'top', offset: [0, -14], className: 'tooltip-infra' });
      marker.bindPopup(buildPopup(f.properties, icon, label), { maxWidth: 320 });
      cluster.addLayer(marker);
    }
    map.addLayer(cluster);
    return () => { map.removeLayer(cluster); };
  }, [data, map, icon, color, label, buildPopup]);
  return null;
}

// ── Componente principal ────────────────────────────────────────────────────
function MapaChavimochic() {
  const centroMapa = [-8.4186, -78.7533];
  const [leyendaExpandida, setLeyendaExpandida] = useState(true);
  const [mapaBase, setMapaBase] = useState('satelite');
  const [filtroTiempo, setFiltroTiempo] = useState(30);
  const [seccionKMZ, setSeccionKMZ] = useState(false);
  const [seccionStats, setSeccionStats] = useState(false);
  const [filtroTramo, setFiltroTramo] = useState('');
  const [filtroEstado, setFiltroEstado] = useState('');
  const [busqueda, setBusqueda] = useState('');
  const [resultadosBusqueda, setResultadosBusqueda] = useState([]);
  const [mostrarResultados, setMostrarResultados] = useState(false);
  const [flyTarget, setFlyTarget] = useState(null);

  const [capas, setCapas] = useState({ Incidentes_Nuevos: true, Incidentes_Atencion: true, Lluvias: true, Canales: true });
  const [capasKMZ, setCapasKMZ] = useState(KMZ_CAPAS_DEFAULT);
  const [incidentesAPI, setIncidentesAPI] = useState([]);
  const [lluviasAPI, setLluviasAPI] = useState([]);
  const [cargandoAPIs, setCargandoAPIs] = useState(false);
  const [miUbicacion, setMiUbicacion] = useState(null);
  const [buscandoGPS, setBuscandoGPS] = useState(false);
  const [detalleActivo, setDetalleActivo] = useState(null);
  const [cargandoDetalle, setCargandoDetalle] = useState(false);
  const [modalMedia, setModalMedia] = useState(null); // { src, type: 'image'|'video' }

  const mapRef = useRef(null);
  const contenedorRef = useRef(null);           // div del mapa (para captura)
  const [herramienta, setHerramienta] = useState(null); // 'distancia'|'area'|'elevacion'|'streetview'|null
  const { ocupado: capturando, descargar, compartir } = useCapturaMapa(contenedorRef);

  // ── Estadísticas ──────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const allFeatures = KMZ_CONFIG.flatMap(c => (c.data?.features || []).map(f => ({ ...f.properties, _tipo: c.label })));
    const tramos = {}; const estados = {}; const tipos = {};
    for (const f of allFeatures) {
      const t = f.TRAMO || 'Sin Tramo';
      const e = f.ESTADO || 'Sin dato';
      const tp = f._tipo;
      tramos[t] = (tramos[t] || 0) + 1;
      estados[e] = (estados[e] || 0) + 1;
      tipos[tp] = (tipos[tp] || 0) + 1;
    }
    return { tramos, estados, tipos, total: allFeatures.length };
  }, []);

  const tramosUnicos = useMemo(() => Object.keys(stats.tramos).sort(), [stats]);
  const estadosUnicos = useMemo(() => Object.keys(stats.estados).filter(e => e !== 'Sin dato').sort(), [stats]);

  const totalKMZ = KMZ_CONFIG.reduce((acc, c) => acc + (c.data?.features?.length || 0), 0);
  const activasKMZ = KMZ_CONFIG.filter(c => capasKMZ[c.key]).length;

  // ── Filtrado de datos KMZ por tramo/estado ────────────────────────────
  const getFilteredData = (cfg) => {
    if (!cfg.data?.features?.length) return cfg.data;
    if (!filtroTramo && !filtroEstado) return cfg.data;
    const filtered = cfg.data.features.filter(f => {
      const p = f.properties || {};
      if (filtroTramo && (p.TRAMO || '') !== filtroTramo) return false;
      if (filtroEstado && (p.ESTADO || '') !== filtroEstado) return false;
      return true;
    });
    return { ...cfg.data, features: filtered };
  };

  // ── Búsqueda ──────────────────────────────────────────────────────────
  const handleBusqueda = (val) => {
    setBusqueda(val);
    if (val.length < 2) { setResultadosBusqueda([]); setMostrarResultados(false); return; }
    const q = val.toLowerCase();
    const res = SEARCH_INDEX.filter(it =>
      it.name.toLowerCase().includes(q) ||
      it.progresiva.toLowerCase().includes(q) ||
      it.tramo.toLowerCase().includes(q) ||
      it.tipo.toLowerCase().includes(q)
    ).slice(0, 8);
    setResultadosBusqueda(res);
    setMostrarResultados(true);
  };

  const seleccionarResultado = (item) => {
    const [lng, lat] = item.coords;
    setFlyTarget([lat, lng]);
    setMostrarResultados(false);
    setBusqueda(item.name);
    setTimeout(() => setFlyTarget(null), 2000);
  };

  // ── Zoom a capa ───────────────────────────────────────────────────────
  const zoomACapa = (cfg) => {
    if (!mapRef.current || !cfg.data?.features?.length) return;
    const map = mapRef.current;
    const bounds = L.geoJSON(cfg.data).getBounds();
    if (bounds.isValid()) map.flyToBounds(bounds, { padding: [40, 40], maxZoom: 15, duration: 1 });
  };

  // ── APIs ──────────────────────────────────────────────────────────────
  const obtenerDatosDeApis = async () => {
    const token = localStorage.getItem('userToken');
    if (!token) return;
    setCargandoAPIs(true);
    try {
      const resInc = await fetch('/api/v1/mobile/hi-incidents/list/', { headers: { 'Content-Type':'application/json', 'Authorization':`Token ${token}` } });
      if (resInc.ok) {
        const dataInc = await resInc.json();
        const tiposMapa = { '1':'Deslizamiento','2':'Obstrucción','3':'Falla Mecánica','4':'Robo','5':'Daño Estructural','6':'Otro' };
        const incidentesMapeados = (dataInc.results||[]).map(inc => {
          const lat = parseFloat(inc.latitude_marker||inc.latitude), lng = parseFloat(inc.longitude_marker||inc.longitude);
          let tipoNombre = tiposMapa[inc.type?.toString()]||'Incidente';
          const anotherTypeStr = inc.another_type||inc.location_text;
          if (anotherTypeStr && (tipoNombre==='Otro'||tipoNombre==='Otros')) tipoNombre = `Otro (${anotherTypeStr.trim()})`;
          return { id:inc.id, lat, lng, tipo:tipoNombre, estado:inc.status||'pat', gravedad:inc.severity||'lev', descripcion:inc.description||'Sin descripción.', usuario:inc.user?.username||inc.username||'Usuario', lugar:inc.location_text||'Coordenada de Campo', fecha:new Date(inc.created_at).toLocaleString('es-PE',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}), timestamp:new Date(inc.created_at).getTime(), imagenUrl:inc.thumbnail||inc.image||null, codigo:inc.code||'Sin Código' };
        }).filter(inc => !isNaN(inc.lat)&&!isNaN(inc.lng)&&inc.lat!==0&&inc.lng!==0);
        setIncidentesAPI(incidentesMapeados);
      }
      const resDevices = await fetch('/api/v1/mobile/devices/?device_type=pluviometro', { headers: { 'Content-Type':'application/json', 'Authorization':`Token ${token}` } });
      if (resDevices.ok) {
        const devicesData = await resDevices.json(); const pluviometros = devicesData.results||[];
        const now = new Date(); const past24h = new Date(now.getTime()-24*60*60*1000);
        const fmt = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
        const nd = [];
        for (let eq of pluviometros) {
          const lat=parseFloat(eq.latitude), lng=parseFloat(eq.longitude); if(isNaN(lat)||isNaN(lng)) continue;
          let totalRain=0;
          try { const r=await fetch(`/api/v1/mobile/davis/rain-gauges/filtered-data/?start_date=${fmt(past24h)}&end_date=${fmt(now)}&station_id=${eq.id}&metric=rainfall_mm`,{headers:{'Content-Type':'application/json','Authorization':`Token ${token}`}}); if(r.ok){const d=await r.json();for(let rec of(d.data||[]))totalRain+=parseFloat(rec.value)||0;} } catch(e){console.error(e);}
          nd.push({id:eq.id,name:eq.nombre||"Pluviómetro",lat,lng,totalRain,isCritical:totalRain>20});
        }
        setLluviasAPI(nd);
      }
    } catch(error){console.error(error)} finally{setCargandoAPIs(false)}
  };

  useEffect(() => { obtenerDatosDeApis(); }, []);

  const cargarDetalleIncidente = async (id) => {
    setDetalleActivo(null); setCargandoDetalle(true);
    const token = localStorage.getItem('userToken');
    try { const res = await fetch(`/api/v1/mobile/hi-incidents/${id}/`,{headers:{'Authorization':`Token ${token}`,'Content-Type':'application/json'}}); if(res.ok){ const json = await res.json(); setDetalleActivo(json.data || json); } } catch(e){console.error(e)} finally{setCargandoDetalle(false)}
  };

  const toggleCapa = (n) => setCapas(p=>({...p,[n]:!p[n]}));
  const toggleCapaKMZ = (key) => {
    const newVal = !capasKMZ[key];
    setCapasKMZ(p => ({...p, [key]: newVal}));
    if (newVal) {
      const cfg = KMZ_CONFIG.find(c => c.key === key);
      if (cfg) zoomACapa(cfg);
    }
  };
  const activarTodasKMZ = () => setCapasKMZ(Object.fromEntries(KMZ_CONFIG.map(c=>[c.key,true])));
  const desactivarTodasKMZ = () => setCapasKMZ(KMZ_CAPAS_DEFAULT);

  const obtenerMiUbicacion = () => {
    setBuscandoGPS(true);
    navigator.geolocation.getCurrentPosition(
      p=>{setMiUbicacion([p.coords.latitude,p.coords.longitude]);setBuscandoGPS(false);},
      ()=>{alert("Error GPS.");setBuscandoGPS(false);},{enableHighAccuracy:true}
    );
  };

  const obtenerUrlMapa = () => {
    switch(mapaBase) {
      case 'calles': return "https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}";
      case 'topografico': return "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png";
      case 'oscuro': return "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";
      default: return "https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}";
    }
  };

  // ── Iconos ────────────────────────────────────────────────────────────
  const crearIconoIncidente = (g) => { let cc='#f59f00',cb='#e67e22'; if(g==='mod'){cc='#f76707';cb='#d9480f'} if(g==='gra'){cc='#d63939';cb='#c92a2a'} return divIcon({className:'icono-vacio',html:`<div style="position:relative;width:20px;height:20px"><div style="position:absolute;top:0;left:0;width:20px;height:20px;background:${cc};opacity:0.4;border-radius:50%;animation:pulse 1.5s infinite"></div><div style="position:absolute;top:4px;left:4px;width:12px;height:12px;background:${cc};border:2px solid ${cb};border-radius:50%;box-shadow:0 2px 4px rgba(0,0,0,0.4)"></div></div>`,iconSize:[20,20],iconAnchor:[10,10]}); };
  const estiloCanales = { color:'#206bc4',weight:4,opacity:0.8 };
  const crearEstiloKMZ = (c) => ({color:c,weight:2,opacity:0.85,fillOpacity:0.3,fillColor:c});
  const iconoGPS = divIcon({className:'icono-vacio',html:`<div style="background:#206bc4;border:3px solid white;width:16px;height:16px;border-radius:50%;box-shadow:0 0 10px rgba(0,0,0,0.5)"></div>`,iconSize:[22,22],iconAnchor:[11,11]});
  const crearIconoLluvia = (r,c) => divIcon({className:'icono-vacio',html:`<div style="display:flex;flex-direction:column;align-items:center;margin-top:-30px"><div style="background:white;border:1px solid ${c?'#d63939':'#206bc4'};color:${c?'#d63939':'#206bc4'};font-size:11px;font-weight:700;padding:2px 6px;border-radius:4px;box-shadow:0 2px 4px rgba(0,0,0,0.1);white-space:nowrap">${r.toFixed(1)} mm</div><div style="font-size:26px;line-height:1;margin-top:2px">🌧️</div></div>`,iconSize:[60,60],iconAnchor:[30,45]});

  const getEstadoBadge = (e) => { const m={'pat':['#f59f00','Pendiente'],'ate':['#206bc4','En Atención'],'cer':['#2fb344','Cerrado']}; const [bg,t]=m[e]||['#6c7a89',e]; return <span style={{backgroundColor:bg,color:'#fff',padding:'2px 6px',borderRadius:'4px',fontSize:'10px',fontWeight:'bold'}}>{t}</span>; };

  // ── Popup builder KMZ ─────────────────────────────────────────────────
  const buildPopup = useMemo(() => (props, iconUrl, label) => {
    const skip = new Set(['name','folder','FID','nro_ord','N_','Nº','Label','Field','_tipo']);
    const labelMap = {NOMBRE:'Nombre',PROGRESIVA:'Progresiva',ESTADO:'Estado',TRAMO:'Tramo',ESTRUCTURA:'Estructura',COD_EST:'Canal/Sistema',ESTE:'Este (UTM)',NORTE:'Norte (UTM)',MARGEN:'Margen',EMPRESA:'Empresa',LONGITUD:'Longitud',TIPO_EST:'Tipo',Nombre_del_Canal:'Canal',NRO:'Nro.'};
    const rows = Object.entries(props).filter(([k,v])=>!skip.has(k)&&v&&v.toString().trim()).map(([k,v])=>`<tr><td style="color:#64748b;padding:3px 8px 3px 0;font-size:11px;white-space:nowrap">${labelMap[k]||k}</td><td style="font-weight:500;padding:3px 0;font-size:11px">${v}</td></tr>`).join('');
    return `<div style="font-family:system-ui,sans-serif;min-width:200px"><div style="display:flex;align-items:center;gap:8px;border-bottom:1px solid #e2e8f0;padding-bottom:6px;margin-bottom:6px"><img src="${iconUrl}" style="width:24px;height:24px"/><div><div style="font-weight:700;font-size:13px;color:#1d273b">${props.name||'Sin nombre'}</div><div style="font-size:10px;color:#64748b">${label}</div></div></div>${rows?`<table style="border-collapse:collapse;width:100%">${rows}</table>`:'<span style="font-size:11px;color:#94a3b8">Sin datos adicionales</span>'}</div>`;
  }, []);

  const tiempoLimite = Date.now() - (filtroTiempo*24*60*60*1000);
  const incidentesFiltrados = filtroTiempo===0 ? incidentesAPI : incidentesAPI.filter(i=>i.timestamp>=tiempoLimite);

  return (
    <div ref={contenedorRef} style={{ height:'100%',width:'100%',position:'relative' }}>
      {/* ── Barra de herramientas del visor ────────────────────────────── */}
      <BarraHerramientas
        herramienta={herramienta}
        setHerramienta={setHerramienta}
        onCaptura={descargar}
        onCompartir={compartir}
        capturando={capturando}
      />

      {/* ── Barra de búsqueda ──────────────────────────────────────────── */}
      <div style={{ position:'absolute',top:'20px',left:'50%',transform:'translateX(-50%)',zIndex:1001,width:'340px' }}>
        <div style={{ position:'relative' }}>
          <FaSearch style={{ position:'absolute',left:'10px',top:'50%',transform:'translateY(-50%)',color:'#94a3b8',fontSize:'13px' }} />
          <input type="text" value={busqueda} onChange={e=>handleBusqueda(e.target.value)} onFocus={()=>resultadosBusqueda.length&&setMostrarResultados(true)}
            placeholder="Buscar estructura, progresiva, tramo..."
            style={{ width:'100%',padding:'8px 12px 8px 32px',border:'1px solid rgba(98,105,118,0.16)',borderRadius:'4px',fontSize:'13px',background:'#fff',boxShadow:'0 2px 8px rgba(0,0,0,0.12)',fontFamily:'inherit',outline:'none' }} />
          {busqueda && <button onClick={()=>{setBusqueda('');setResultadosBusqueda([]);setMostrarResultados(false);}} style={{position:'absolute',right:'8px',top:'50%',transform:'translateY(-50%)',background:'none',border:'none',cursor:'pointer',color:'#94a3b8',fontSize:'14px'}}>✕</button>}
        </div>
        {mostrarResultados && resultadosBusqueda.length > 0 && (
          <div style={{ position:'absolute',top:'100%',left:0,right:0,background:'#fff',border:'1px solid rgba(98,105,118,0.16)',borderRadius:'0 0 4px 4px',boxShadow:'0 4px 12px rgba(0,0,0,0.1)',maxHeight:'260px',overflowY:'auto' }}>
            {resultadosBusqueda.map((r,i) => (
              <div key={i} onClick={()=>seleccionarResultado(r)} style={{ padding:'8px 12px',cursor:'pointer',borderBottom:'1px solid #f1f5f9',display:'flex',alignItems:'center',gap:'8px',fontSize:'12px' }}
                onMouseEnter={e=>e.currentTarget.style.background='#f8fafc'} onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                <img src={r.icon} alt="" style={{width:'20px',height:'20px'}} />
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontWeight:600,color:'#1d273b',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{r.name}</div>
                  <div style={{color:'#64748b',fontSize:'11px'}}>{r.tipo} · {r.tramo} · Prog. {r.progresiva}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <MapContainer center={centroMapa} zoom={10} style={{height:'100%',width:'100%',zIndex:0}} ref={mapRef} zoomControl={false} zoomControlOptions={{position:'topright'}}>
        <ZoomDerecha />
        <TileLayer url={obtenerUrlMapa()} maxZoom={20} attribution="&copy; JURP Maps" />
        <VolarAUbicacion posicion={miUbicacion || flyTarget} />
        <BotonEncuadreGeneral centro={centroMapa} />
        <CoordenadasUTM />

        {/* ── Herramientas (dentro del mapa) ───────────────────────────── */}
        <MiniMapa tileUrl={obtenerUrlMapa()} />
        <HerramientaMedicion
          modo={herramienta === 'distancia' || herramienta === 'area' ? herramienta : null}
          onFinish={() => {}}
        />
        
        {miUbicacion && <Marker position={miUbicacion} icon={iconoGPS}><Popup>Estás aquí</Popup></Marker>}
        {capas.Canales && <><GeoJSON data={geoCanalMadre} style={estiloCanales}/><GeoJSON data={geoLateral10} style={estiloCanales}/><GeoJSON data={geoRedes} style={estiloCanales}/></>}

        {/* ── Capas KMZ con clustering ─────────────────────────────────── */}
        {KMZ_CONFIG.map(cfg => {
          if (!capasKMZ[cfg.key]) return null;
          const data = getFilteredData(cfg);
          if (!data?.features?.length) return null;

          if (cfg.tipo === 'poly' || cfg.tipo === 'line') {
            const style = cfg.tipo === 'line' 
              ? () => ({color:cfg.color, weight:3, opacity:0.8, dashArray: cfg.tipo === 'line' ? '8 4' : null})
              : () => crearEstiloKMZ(cfg.color);
            return (
              <GeoJSON key={cfg.key + filtroTramo + filtroEstado} data={data} style={style}
                onEachFeature={(f,layer) => {
                  layer.bindTooltip(f.properties?.name||'', {direction:'top',className:'tooltip-infra'});
                  layer.bindPopup(buildPopup(f.properties,cfg.icon,cfg.label),{maxWidth:320});
                }}
              />
            );
          }
          return (
            <ClusteredLayer key={cfg.key + filtroTramo + filtroEstado} data={data} icon={cfg.icon} color={cfg.color} label={cfg.label} buildPopup={buildPopup} />
          );
        })}

        {/* Incidentes */}
        {(capas.Incidentes_Nuevos||capas.Incidentes_Atencion)&&incidentesFiltrados.map(inc => {
          if(!capas.Incidentes_Nuevos&&inc.estado!=='eat') return null;
          if(!capas.Incidentes_Atencion&&inc.estado==='eat') return null;
          return (
            <Marker key={inc.id} position={[inc.lat,inc.lng]} icon={crearIconoIncidente(inc.gravedad)} eventHandlers={{click:()=>cargarDetalleIncidente(inc.id)}}>
              <Popup minWidth={280} maxWidth={320} className="popup-incidente-custom">
                <div style={{padding:'2px',fontFamily:'system-ui,sans-serif'}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',borderBottom:'1px solid #e2e8f0',paddingBottom:'6px',marginBottom:'8px'}}>
                    <h4 style={{margin:0,color:'#1d273b',fontSize:'15px',fontWeight:'bold'}}>{inc.tipo}</h4>{getEstadoBadge(inc.estado)}
                  </div>
                  {cargandoDetalle ? <div style={{textAlign:'center',padding:'20px 0',color:'#206bc4'}}><FaSyncAlt className="icon-spin"/><span style={{fontSize:'12px',marginLeft:'5px'}}>Cargando...</span></div>
                  : detalleActivo&&detalleActivo.id===inc.id ? (
                    <div style={{display:'flex',overflowX:'auto',gap:'8px',paddingBottom:'8px',marginBottom:'8px'}}>
                      {detalleActivo.images?.map((it,i)=>{ const src = it.content?.startsWith('http') ? it.content : `data:image/jpeg;base64,${it.content}`; return <div key={i} onClick={()=>setModalMedia({src,type:'image'})} style={{flexShrink:0,cursor:'pointer'}}><img src={src} alt="" style={{width:'120px',height:'100px',objectFit:'cover',borderRadius:'4px',border:'1px solid #e2e8f0'}}/></div>; })}
                      {detalleActivo.videos?.map((it,i)=>{ const src = it.content?.startsWith('http') ? it.content : `data:video/mp4;base64,${it.content}`; return <div key={i} onClick={()=>setModalMedia({src,type:'video'})} style={{flexShrink:0,cursor:'pointer',position:'relative'}}><video src={src} style={{width:'150px',height:'100px',objectFit:'cover',borderRadius:'4px',border:'1px solid #e2e8f0',background:'#000'}} preload="metadata"/><div style={{position:'absolute',top:'50%',left:'50%',transform:'translate(-50%,-50%)',background:'rgba(0,0,0,0.5)',borderRadius:'50%',width:'32px',height:'32px',display:'flex',alignItems:'center',justifyContent:'center',color:'#fff',fontSize:'16px'}}>▶</div></div>; })}
                      {(!detalleActivo.images?.length&&!detalleActivo.videos?.length&&inc.imagenUrl)&&<div onClick={()=>setModalMedia({src:inc.imagenUrl,type:'image'})} style={{cursor:'pointer'}}><img src={inc.imagenUrl} alt="" style={{width:'100%',height:'140px',objectFit:'cover',borderRadius:'6px'}}/></div>}
                    </div>
                  ) : inc.imagenUrl&&<div onClick={()=>setModalMedia({src:inc.imagenUrl,type:'image'})} style={{width:'100%',height:'140px',overflow:'hidden',borderRadius:'6px',marginBottom:'10px',background:'#f8fafc',border:'1px solid #e2e8f0',cursor:'pointer'}}><img src={inc.imagenUrl} alt="" style={{width:'100%',height:'100%',objectFit:'cover'}}/></div>}
                  <div style={{fontSize:'12px',color:'#475569',display:'flex',flexDirection:'column',gap:'6px'}}>
                    <div><strong>Código:</strong> <span style={{color:'#206bc4',fontWeight:'bold'}}>{inc.codigo}</span></div>
                    <div><strong>Ubicación:</strong> {inc.lugar}</div>
                    <div style={{background:'#f1f5f9',padding:'8px',borderRadius:'4px',border:'1px solid #e2e8f0',maxHeight:'100px',overflowY:'auto'}}><strong style={{color:'#1e293b'}}>Descripción:</strong><br/><span style={{color:'#334155',lineHeight:'1.4',display:'block',marginTop:'4px'}}>{inc.descripcion}</span></div>
                    <div style={{display:'flex',justifyContent:'space-between',borderTop:'1px dashed #cbd5e1',paddingTop:'8px',marginTop:'2px',fontSize:'11px'}}><span>👤 <b>{inc.usuario}</b></span><span>🕒 {inc.fecha}</span></div>
                  </div>
                </div>
              </Popup>
            </Marker>
          );
        })}
        {capas.Lluvias && lluviasAPI.map(p=><Marker key={p.id} position={[p.lat,p.lng]} icon={crearIconoLluvia(p.totalRain,p.isCritical)}><Popup><b>{p.name}</b></Popup></Marker>)}
      </MapContainer>

      {/* ── Panel de Control ────────────────────────────────────────────── */}
      <div className={`panel-control-avanzado ${leyendaExpandida?'':'colapsado'}`}>
        <div className="pca-cabecera">
          <div style={{display:'flex',alignItems:'center',gap:'8px'}}>
            <img src={logo} alt="Logo" style={{height:'30px',width:'auto'}} />
            {leyendaExpandida&&<span style={{color:'#1d273b',fontWeight:'600',fontSize:'0.875rem'}}>Panel de Control</span>}
          </div>
          <button className="pca-btn-icon" onClick={()=>setLeyendaExpandida(!leyendaExpandida)}>{leyendaExpandida?<FaChevronLeft size={10}/>:<FaChevronRight size={10}/>}</button>
        </div>

        {leyendaExpandida && (
          <div className="pca-cuerpo">
            <div className="pca-seccion">
              <div className="pca-label">Mapa Base</div>
              <select className="pca-select" value={mapaBase} onChange={e=>setMapaBase(e.target.value)}>
                <option value="satelite">Google Satélite</option><option value="calles">Google Calles</option><option value="topografico">Topográfico</option><option value="oscuro">Modo Oscuro</option>
              </select>
            </div>

            <hr className="pca-divider" style={{marginTop:'15px'}}/>
            <div className="pca-switches">
              <label className="pca-switch-row"><div className="pca-switch-container"><input type="checkbox" checked={capas.Canales} onChange={()=>toggleCapa('Canales')}/><span className="pca-slider-round"></span></div><div style={{width:'12px',height:'12px',borderRadius:'50%',backgroundColor:'#206bc4'}}></div><span>Trazado de Canales</span></label>
              <label className="pca-switch-row"><div className="pca-switch-container"><input type="checkbox" checked={capas.Incidentes_Atencion} onChange={()=>{toggleCapa('Incidentes_Atencion');toggleCapa('Incidentes_Nuevos');}}/><span className="pca-slider-round"></span></div><FaExclamationTriangle color="#d63939"/><span>Alertas de Incidentes</span></label>
              {(capas.Incidentes_Nuevos||capas.Incidentes_Atencion)&&<div style={{paddingLeft:'40px',marginTop:'-5px',marginBottom:'10px'}}><select className="pca-select" style={{fontSize:'11px',padding:'2px 4px',height:'auto'}} value={filtroTiempo} onChange={e=>setFiltroTiempo(Number(e.target.value))}><option value={1}>Últimas 24 horas</option><option value={7}>Últimos 7 días</option><option value={30}>Últimos 30 días</option><option value={0}>Histórico Completo</option></select></div>}
              <label className="pca-switch-row"><div className="pca-switch-container"><input type="checkbox" checked={capas.Lluvias} onChange={()=>toggleCapa('Lluvias')}/><span className="pca-slider-round"></span></div><FaCloudShowersHeavy color="#206bc4"/><span>Estaciones Pluviómetros</span></label>
            </div>

            {/* ── Filtros ──────────────────────────────────────────────────── */}
            <hr className="pca-divider"/>
            <div className="pca-seccion">
              <div className="pca-label"><FaFilter style={{marginRight:'4px'}}/>Filtros Infraestructura</div>
              <div style={{display:'flex',gap:'6px'}}>
                <select className="pca-select" style={{fontSize:'11px',flex:1}} value={filtroTramo} onChange={e=>setFiltroTramo(e.target.value)}>
                  <option value="">Todos los tramos</option>
                  {tramosUnicos.map(t=><option key={t} value={t}>{t}</option>)}
                </select>
                <select className="pca-select" style={{fontSize:'11px',flex:1}} value={filtroEstado} onChange={e=>setFiltroEstado(e.target.value)}>
                  <option value="">Todo estado</option>
                  {estadosUnicos.map(e2=><option key={e2} value={e2}>{e2}</option>)}
                </select>
              </div>
              {(filtroTramo||filtroEstado)&&<button onClick={()=>{setFiltroTramo('');setFiltroEstado('');}} style={{marginTop:'4px',background:'none',border:'none',color:'#206bc4',cursor:'pointer',fontSize:'11px',padding:0}}>✕ Limpiar filtros</button>}
            </div>

            {/* ── Infraestructura Hidráulica ────────────────────────────────── */}
            <hr className="pca-divider"/>
            <div className="pca-seccion">
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'8px',cursor:'pointer'}} onClick={()=>setSeccionKMZ(v=>!v)}>
                <div className="pca-label" style={{margin:0}}>📂 Infraestructura Hidráulica</div>
                <div style={{display:'flex',alignItems:'center',gap:'6px'}}>
                  <span className="pca-badge">{totalKMZ}</span>
                  {activasKMZ>0&&<span style={{fontSize:'10px',background:'#206bc4',color:'#fff',padding:'1px 5px',borderRadius:'10px'}}>{activasKMZ}</span>}
                  <span style={{fontSize:'10px',color:'#666'}}>{seccionKMZ?'▲':'▼'}</span>
                </div>
              </div>
              {seccionKMZ&&<>
                <div className="pca-action-buttons" style={{marginBottom:'6px'}}>
                  <button onClick={activarTodasKMZ} className="pca-btn-action text-blue"><FaCheck/> Todas</button>
                  <button onClick={desactivarTodasKMZ} className="pca-btn-action"><FaTimes/> Ninguna</button>
                </div>
                <div className="pca-label" style={{fontSize:'10px',color:'#888',marginBottom:'4px'}}>Polígonos (canales)</div>
                <div className="pca-list">
                  {KMZ_CONFIG.filter(c=>c.tipo==='poly').map(cfg=>(
                    <label key={cfg.key} className="pca-list-item"><div className="pca-item-left"><input type="checkbox" checked={capasKMZ[cfg.key]} onChange={()=>toggleCapaKMZ(cfg.key)} className="pca-checkbox"/><span style={{display:'flex',alignItems:'center',gap:'4px'}}><img src={cfg.icon} alt="" style={{width:'18px',height:'18px'}}/>{cfg.label}</span></div><span className="pca-badge">{cfg.data?.features?.length||0}</span></label>
                  ))}
                </div>
                <div className="pca-label" style={{fontSize:'10px',color:'#888',marginBottom:'4px',marginTop:'8px'}}>Puntos (infraestructura)</div>
                <div className="pca-list">
                  {KMZ_CONFIG.filter(c=>c.tipo==='point' && !c.key.startsWith('GAR_')).map(cfg=>(
                    <label key={cfg.key} className="pca-list-item"><div className="pca-item-left"><input type="checkbox" checked={capasKMZ[cfg.key]} onChange={()=>toggleCapaKMZ(cfg.key)} className="pca-checkbox"/><span style={{display:'flex',alignItems:'center',gap:'4px'}}><img src={cfg.icon} alt="" style={{width:'18px',height:'18px'}}/>{cfg.label}</span></div><span className="pca-badge">{cfg.data?.features?.filter(f=>f.geometry?.type==='Point').length||0}</span></label>
                  ))}
                </div>
                <div className="pca-label" style={{fontSize:'10px',color:'#888',marginBottom:'4px',marginTop:'8px'}}>🏠 Garitas de Vigilancia</div>
                <div className="pca-list">
                  {KMZ_CONFIG.filter(c=>c.key.startsWith('GAR_')).map(cfg=>(
                    <label key={cfg.key} className="pca-list-item"><div className="pca-item-left"><input type="checkbox" checked={capasKMZ[cfg.key]} onChange={()=>toggleCapaKMZ(cfg.key)} className="pca-checkbox"/><span style={{display:'flex',alignItems:'center',gap:'4px'}}><img src={cfg.icon} alt="" style={{width:'18px',height:'18px'}}/>{cfg.label}</span></div><span className="pca-badge">{cfg.data?.features?.length||0}</span></label>
                  ))}
                </div>
                <div className="pca-label" style={{fontSize:'10px',color:'#888',marginBottom:'4px',marginTop:'8px'}}>🛣️ Vías y Caminos</div>
                <div className="pca-list">
                  {KMZ_CONFIG.filter(c=>c.tipo==='line').map(cfg=>(
                    <label key={cfg.key} className="pca-list-item"><div className="pca-item-left"><input type="checkbox" checked={capasKMZ[cfg.key]} onChange={()=>toggleCapaKMZ(cfg.key)} className="pca-checkbox"/><span style={{display:'flex',alignItems:'center',gap:'4px'}}><span style={{display:'inline-block',width:'18px',height:'3px',backgroundColor:cfg.color,borderRadius:'2px'}}></span>{cfg.label}</span></div><span className="pca-badge">{cfg.data?.features?.length||0}</span></label>
                  ))}
                </div>
              </>}
            </div>

            {/* ── Estadísticas ─────────────────────────────────────────────── */}
            <hr className="pca-divider"/>
            <div className="pca-seccion">
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'8px',cursor:'pointer'}} onClick={()=>setSeccionStats(v=>!v)}>
                <div className="pca-label" style={{margin:0}}><FaChartBar style={{marginRight:'4px'}}/>Estadísticas</div>
                <span style={{fontSize:'10px',color:'#666'}}>{seccionStats?'▲':'▼'}</span>
              </div>
              {seccionStats&&<div style={{fontSize:'11px',color:'#475569'}}>
                <div style={{marginBottom:'8px'}}><strong>Por Tipo:</strong>
                  {Object.entries(stats.tipos).sort((a,b)=>b[1]-a[1]).map(([k,v])=>(
                    <div key={k} style={{display:'flex',justifyContent:'space-between',padding:'2px 0'}}><span>{k}</span><span className="pca-badge">{v}</span></div>
                  ))}
                </div>
                <div style={{marginBottom:'8px'}}><strong>Por Estado:</strong>
                  {Object.entries(stats.estados).sort((a,b)=>b[1]-a[1]).slice(0,6).map(([k,v])=>(
                    <div key={k} style={{display:'flex',justifyContent:'space-between',padding:'2px 0'}}><span>{k}</span><span className="pca-badge">{v}</span></div>
                  ))}
                </div>
                <div><strong>Por Tramo:</strong>
                  {Object.entries(stats.tramos).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([k,v])=>(
                    <div key={k} style={{display:'flex',justifyContent:'space-between',padding:'2px 0'}}><span style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',maxWidth:'160px'}}>{k}</span><span className="pca-badge">{v}</span></div>
                  ))}
                </div>
                <div style={{marginTop:'6px',textAlign:'right',fontWeight:600}}>Total: {stats.total} elementos</div>
              </div>}
            </div>
          </div>
        )}
      </div>

      <button onClick={obtenerDatosDeApis} className="btn-flotante-actualizar">{cargandoAPIs?'Actualizando...':'Actualizar Datos'}</button>
      <button onClick={obtenerMiUbicacion} disabled={buscandoGPS} className="btn-flotante-gps"><FaLocationArrow/></button>

      {/* ── Modal Fullscreen ───────────────────────────────────────────── */}
      {modalMedia && (
        <div onClick={() => setModalMedia(null)} style={{ position:'fixed',top:0,left:0,right:0,bottom:0,zIndex:9999,background:'rgba(0,0,0,0.9)',display:'flex',alignItems:'center',justifyContent:'center',cursor:'zoom-out' }}>
          <button onClick={() => setModalMedia(null)} style={{ position:'absolute',top:'20px',right:'20px',background:'rgba(255,255,255,0.15)',border:'none',color:'#fff',fontSize:'24px',cursor:'pointer',borderRadius:'50%',width:'40px',height:'40px',display:'flex',alignItems:'center',justifyContent:'center',zIndex:10000 }}>✕</button>
          {modalMedia.type === 'image' ? (
            <img src={modalMedia.src} alt="Evidencia" onClick={e => e.stopPropagation()} style={{ maxWidth:'90vw',maxHeight:'90vh',objectFit:'contain',borderRadius:'8px',cursor:'default' }} />
          ) : (
            <video src={modalMedia.src} onClick={e => e.stopPropagation()} controls autoPlay style={{ maxWidth:'90vw',maxHeight:'90vh',borderRadius:'8px',cursor:'default',background:'#000' }} />
          )}
        </div>
      )}
    </div>
  );
}

export default MapaChavimochic;