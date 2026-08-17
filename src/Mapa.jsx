import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { MapContainer, TileLayer, Marker, Popup, GeoJSON, ImageOverlay, useMap, useMapEvents } from 'react-leaflet';
import L, { divIcon } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import './MapaDashboard.css';
import './MapaGIS.css';
import RailGIS from './RailGIS';
import JSZip from 'jszip';
import { kml as kmlAGeoJSON } from '@tmcw/togeojson';
import { FaFileUpload, FaTrash, FaCrosshairs, FaSave, FaCloudShowersHeavy, FaExclamationTriangle, FaLocationArrow, FaCheck, FaTimes, FaChevronLeft, FaChevronRight, FaGlobe, FaSyncAlt, FaSearch, FaChartBar, FaFilter, FaLayerGroup, FaTint, FaFilePdf, FaFileExcel, FaDownload, FaRulerCombined, FaDrawPolygon, FaEraser, FaCamera, FaShareAlt, FaPlus, FaMinus, FaSignOutAlt, FaChevronUp, FaChevronDown } from 'react-icons/fa';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import ExcelJS from 'exceljs';
import Swal from 'sweetalert2';
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, Legend } from 'recharts';
// ── Herramientas del visor ───────────────────────────────────────────────────
import { BarraHerramientas, MiniMapa, HerramientaMedicion, useCapturaMapa } from './MapaHerramientas';
import './MapaHerramientas.css';

import geoCanalMadre from './data/Canal_Madre.json';
import geoLateral10 from './data/Lateral_10.json';
import geoRedes from './data/Redes_Presurizado.json';
import logo from './assets/logo1.png';

import icoBocatoma from './assets/simbologia/bocatoma.png';
import icoEntrega from './assets/simbologia/entrega.png';
import icoToma from './assets/simbologia/toma.png';
import icoCanoa from './assets/simbologia/canoa.png';
import icoAlcantarilla from './assets/simbologia/alcantarilla.png';
import icoPaseVehicular from './assets/simbologia/pase_vehicular.png';
import icoPasePeatonal from './assets/simbologia/pase_peatonal.png';
import icoAliviadero from './assets/simbologia/aliviadero.png';
import icoDesarenador from './assets/simbologia/desarenador.png';
import icoRapida from './assets/simbologia/rapida.png';
import icoCanalMadre from './assets/simbologia/canal_madre.png';
import icoCanalRect from './assets/simbologia/canal_rectangular.png';
import icoConducCubierto from './assets/simbologia/conducto_cubierto.png';
import icoCaida from './assets/simbologia/caida.png';
import icoCanalTrap from './assets/simbologia/canal_trapezoidal.png';
import icoAcueducto from './assets/simbologia/acueducto.png';
import icoGaritaJURP from './assets/simbologia/garita_jurp.png';
import icoGaritaOtros from './assets/simbologia/garita_otros.png';

import kmzEntrega from './data/kmz/Entrega.json';
import kmzPuentePeatonal from './data/kmz/Puente_Peatonal.json';
import kmzPuenteVehicular from './data/kmz/Puente_Vehicular.json';
import kmzBocatoma from './data/kmz/Bocatoma.json';
import kmzAliviadero from './data/kmz/Aliviadero.json';
import kmzToma from './data/kmz/Toma.json';
import kmzCanoa from './data/kmz/Canoa.json';
import kmzAlcantarilla from './data/kmz/Alcantarilla.json';
import kmzEstacionControl from './data/kmz/Estacion_Control.json';
import kmzRapida from './data/kmz/Rapida.json';
import kmzCanalMadre from './data/kmz/Canal_Madre.json';
import kmzLateral10 from './data/kmz/Lateral_10.json';
import kmzCajaHidraulica from './data/kmz/Caja_Hidraulica.json';
import kmzCamaraRP from './data/kmz/Camara_Rompepresion.json';
import kmzDesarenador from './data/kmz/Desarenador.json';
import kmzEvacuador from './data/kmz/Evacuador.json';
import kmzPartidor from './data/kmz/Partidor.json';
import kmzPaseTuberias from './data/kmz/Pase_de_Tuberias.json';
import kmzRedesPresurizado from './data/kmz/Redes_Presurizado.json';
import geoGaritasJURP from './data/garitas/GARITAS_JURP.json';
import geoGaritasOtros from './data/garitas/GARITAS_OTROS.json';
import geoCaminosServ from './data/garitas/CAMINOS_DE_SERVICIO.json';
import geoViasAcceso from './data/garitas/VIAS_DE_ACCESO.json';
import geoViaAuxiliar from './data/garitas/VIA_AUXILIAR.json';
import geoRedNacional from './data/garitas/RED_NACIONAL.json';

// ── Helpers ─────────────────────────────────────────────────────────────────
const crearIconoSimbologia = (url, sz = 28) => L.icon({ iconUrl: url, iconSize: [sz, sz], iconAnchor: [sz/2, sz/2], popupAnchor: [0, -(sz/2)] });
function latLngToUTM(lat, lng) {
  const zone = Math.floor((lng + 180) / 6) + 1, k0 = 0.9996, a = 6378137, e2 = 0.00669437999014, ep2 = e2 / (1 - e2);
  const latR = lat * Math.PI / 180, lngR = lng * Math.PI / 180, lngO = ((zone - 1) * 6 - 180 + 3) * Math.PI / 180;
  const N = a / Math.sqrt(1 - e2 * Math.sin(latR) ** 2), T = Math.tan(latR) ** 2, C = ep2 * Math.cos(latR) ** 2, A = Math.cos(latR) * (lngR - lngO);
  const M = a * ((1 - e2/4 - 3*e2*e2/64) * latR - (3*e2/8 + 3*e2*e2/32) * Math.sin(2*latR) + (15*e2*e2/256) * Math.sin(4*latR));
  const easting = k0 * N * (A + (1-T+C)*A**3/6 + (5-18*T+T*T)*A**5/120) + 500000;
  let northing = k0 * (M + N * Math.tan(latR) * (A*A/2 + (5-T+9*C+4*C*C)*A**4/24));
  if (lat < 0) northing += 10000000;
  return { e: easting.toFixed(1), n: northing.toFixed(1), z: `${zone}S` };
}
const COLORS = ['#0ea5e9','#22c55e','#f59f00','#ef4444','#a855f7','#ec4899','#f97316','#06b6d4'];
// Colores que se van asignando a cada KMZ/KML que cargue el usuario.
const COLORS_USUARIO = ['#e8590c','#7048e8','#12b886','#f03e3e','#1098ad','#ae3ec9','#f59f00','#4c6ef5'];
// Capas KMZ/KML guardadas en el servidor.
const API_CAPAS = 'https://gideonstudio.duckdns.org/api/v1/mobile/operations/capas-mapa';

// ── Config KMZ ──────────────────────────────────────────────────────────────
const KMZ_CONFIG = [
  { key:'KMZ_CanalMadre', label:'Canal Madre', color:'#1971c2', data:kmzCanalMadre, tipo:'poly', icon:icoCanalMadre },
  { key:'KMZ_Lateral10', label:'Lateral 10', color:'#4dabf7', data:kmzLateral10, tipo:'poly', icon:icoCanalTrap },
  { key:'KMZ_RedesPresurizado', label:'Redes Presurizado', color:'#74c0fc', data:kmzRedesPresurizado, tipo:'poly', icon:icoConducCubierto },
  { key:'KMZ_Evacuador', label:'Evacuador', color:'#a5d8ff', data:kmzEvacuador, tipo:'poly', icon:icoAcueducto },
  { key:'KMZ_Bocatoma', label:'Bocatoma', color:'#206bc4', data:kmzBocatoma, tipo:'point', icon:icoBocatoma },
  { key:'KMZ_Entrega', label:'Entrega', color:'#2f9e44', data:kmzEntrega, tipo:'point', icon:icoEntrega },
  { key:'KMZ_Toma', label:'Toma', color:'#f59f00', data:kmzToma, tipo:'point', icon:icoToma },
  { key:'KMZ_Canoa', label:'Canoa', color:'#f76707', data:kmzCanoa, tipo:'point', icon:icoCanoa },
  { key:'KMZ_Alcantarilla', label:'Alcantarilla', color:'#7048e8', data:kmzAlcantarilla, tipo:'point', icon:icoAlcantarilla },
  { key:'KMZ_PuenteVehicular', label:'Puente Vehicular', color:'#8a6d3b', data:kmzPuenteVehicular, tipo:'point', icon:icoPaseVehicular },
  { key:'KMZ_PuentePeatonal', label:'Puente Peatonal', color:'#e8590c', data:kmzPuentePeatonal, tipo:'point', icon:icoPasePeatonal },
  { key:'KMZ_Aliviadero', label:'Aliviadero', color:'#c92a2a', data:kmzAliviadero, tipo:'point', icon:icoAliviadero },
  { key:'KMZ_CajaHidraulica', label:'Caja Hidráulica', color:'#495057', data:kmzCajaHidraulica, tipo:'point', icon:icoCanalRect },
  { key:'KMZ_Desarenador', label:'Desarenador', color:'#a0522d', data:kmzDesarenador, tipo:'point', icon:icoDesarenador },
  { key:'KMZ_EstacionControl', label:'Estación Control', color:'#fd7e14', data:kmzEstacionControl, tipo:'point', icon:icoBocatoma },
  { key:'KMZ_Partidor', label:'Partidor', color:'#9c36b5', data:kmzPartidor, tipo:'point', icon:icoCanalTrap },
  { key:'KMZ_PaseTuberias', label:'Pase Tuberías', color:'#5c7cfa', data:kmzPaseTuberias, tipo:'point', icon:icoConducCubierto },
  { key:'KMZ_CamaraRP', label:'Cámara Rompepresión', color:'#e67700', data:kmzCamaraRP, tipo:'point', icon:icoCaida },
  { key:'KMZ_Rapida', label:'Rápida', color:'#f03e3e', data:kmzRapida, tipo:'point', icon:icoRapida },
  { key:'GAR_JURP', label:'Garitas JURP', color:'#1098ad', data:geoGaritasJURP, tipo:'point', icon:icoGaritaJURP },
  { key:'GAR_Otros', label:'Garitas Otros', color:'#9c36b5', data:geoGaritasOtros, tipo:'point', icon:icoGaritaOtros },
  { key:'VIA_CaminosServ', label:'Caminos de Servicio', color:'#e67700', data:geoCaminosServ, tipo:'line', icon:null },
  { key:'VIA_Acceso', label:'Vías de Acceso', color:'#d6336c', data:geoViasAcceso, tipo:'line', icon:null },
  { key:'VIA_Auxiliar', label:'Vía Auxiliar', color:'#ae3ec9', data:geoViaAuxiliar, tipo:'line', icon:null },
  { key:'VIA_RedNacional', label:'Red Nacional', color:'#d63939', data:geoRedNacional, tipo:'line', icon:null },
];
const KMZ_CAPAS_DEFAULT = Object.fromEntries(KMZ_CONFIG.map(c => [c.key, false]));
const SEARCH_INDEX = KMZ_CONFIG.flatMap(cfg => (cfg.data?.features || []).filter(f => f.geometry?.type === 'Point' && f.properties?.name).map(f => ({ name: f.properties.name, tipo: cfg.label, tramo: f.properties.TRAMO || '', progresiva: f.properties.PROGRESIVA || '', coords: f.geometry.coordinates, icon: cfg.icon, color: cfg.color })));

// ── Sub-componentes ─────────────────────────────────────────────────────────
function ZoomDerecha() { const map = useMap(); useEffect(() => { const zc = L.control.zoom({ position: 'topright' }); zc.addTo(map); return () => zc.remove(); }, [map]); return null; }
function UTMDisplay() { const [c, setC] = useState(null); useMapEvents({ mousemove(e) { setC(latLngToUTM(e.latlng.lat, e.latlng.lng)); }, mouseout() { setC(null); } }); return c ? <div className="dash-utm">UTM {c.z} E {c.e} N {c.n}</div> : null; }
function FlyToComp({ pos }) { const map = useMap(); useEffect(() => { if (pos) map.flyTo(pos, 16, { duration: 1.5 }); }, [pos, map]); return null; }

function ClusteredLayer({ data, icon, color, label, buildPopup }) {
  const map = useMap();
  useEffect(() => {
    if (!data?.features?.length) return;
    const points = data.features.filter(f => f.geometry?.type === 'Point');
    if (!points.length) return;
    const cluster = L.markerClusterGroup({ maxClusterRadius: 50, spiderfyOnMaxZoom: true, showCoverageOnHover: false,
      iconCreateFunction: (cl) => { const n = cl.getChildCount(), sz = n > 50 ? 40 : n > 20 ? 34 : 28;
        return L.divIcon({ html: `<div style="background:${color};color:#fff;border-radius:50%;width:${sz}px;height:${sz}px;display:flex;align-items:center;justify-content:center;font-size:${sz > 34 ? 13 : 11}px;font-weight:700;border:2px solid rgba(255,255,255,0.3);box-shadow:0 0 12px ${color}55">${n}</div>`, className: 'icono-vacio', iconSize: [sz+4, sz+4], iconAnchor: [(sz+4)/2, (sz+4)/2] }); }
    });
    const leafIcon = crearIconoSimbologia(icon);
    for (const f of points) { const [lng, lat] = f.geometry.coordinates; const m = L.marker([lat, lng], { icon: leafIcon }); m.bindTooltip(f.properties.name || '', { direction: 'top', offset: [0, -14], className: 'tooltip-infra' }); m.bindPopup(buildPopup(f.properties, icon, label), { maxWidth: 320 }); cluster.addLayer(m); }
    map.addLayer(cluster);
    return () => { map.removeLayer(cluster); };
  }, [data, map, icon, color, label, buildPopup]);
  return null;
}

// Icono de incidente. Fuera del componente para que su identidad no cambie
// en cada render y no rearme el cluster.
const crearIconoIncidente = (g) => {
  let c = '#f59f00';
  if (g === 'mod') c = '#f76707';
  if (g === 'gra') c = '#ef4444';
  return divIcon({ className: 'icono-vacio', html: `<div style="position:relative;width:20px;height:20px"><div style="position:absolute;inset:0;background:${c};opacity:0.4;border-radius:50%;animation:pulse 1.5s infinite"></div><div style="position:absolute;top:4px;left:4px;width:12px;height:12px;background:${c};border:2px solid rgba(0,0,0,0.3);border-radius:50%;box-shadow:0 0 8px ${c}88"></div></div>`, iconSize: [20, 20], iconAnchor: [10, 10] });
};
const badge = (e) => ({ pat: ['#f59f00', 'Pendiente'], ate: ['#0ea5e9', 'En Atención'], cer: ['#22c55e', 'Cerrado'] }[e] || ['#64748b', e]);

// Agrupa los incidentes en clusters. Al hacer clic en uno avisa al panel.
function ClusterIncidentes({ incidentes, onSeleccionar }) {
  const map = useMap();
  useEffect(() => {
    if (!incidentes.length) return;
    const grupo = L.markerClusterGroup({
      maxClusterRadius: 45, showCoverageOnHover: false, spiderfyOnMaxZoom: true,
      disableClusteringAtZoom: 15,
      iconCreateFunction: (cl) => {
        const n = cl.getChildCount();
        const hijos = cl.getAllChildMarkers();
        const grave = hijos.some(m => m.options.gravedad === 'gra');
        const c = grave ? '#ef4444' : '#f59f00';
        const sz = n > 20 ? 42 : n > 8 ? 36 : 30;
        return L.divIcon({
          html: `<div style="background:${c};color:#fff;border-radius:50%;width:${sz}px;height:${sz}px;display:flex;align-items:center;justify-content:center;font-size:${sz > 36 ? 14 : 12}px;font-weight:700;border:2px solid rgba(255,255,255,.45);box-shadow:0 0 14px ${c}88">${n}</div>`,
          className: 'icono-vacio', iconSize: [sz, sz], iconAnchor: [sz / 2, sz / 2],
        });
      },
    });
    for (const inc of incidentes) {
      const m = L.marker([inc.lat, inc.lng], { icon: crearIconoIncidente(inc.gravedad), gravedad: inc.gravedad });
      m.bindTooltip(inc.tipo || 'Incidente', { direction: 'top', offset: [0, -14], className: 'tooltip-infra' });
      m.on('click', () => onSeleccionar(inc));
      grupo.addLayer(m);
    }
    map.addLayer(grupo);
    return () => { map.removeLayer(grupo); };
  }, [incidentes, map, onSeleccionar]);
  return null;
}

// "hace 3 min" a partir de un timestamp
const haceRato = (ts, ahora) => {
  if (!ts) return 'sin datos';
  const seg = Math.max(0, Math.floor((ahora - ts) / 1000));
  if (seg < 60) return 'hace un momento';
  const min = Math.floor(seg / 60);
  if (min < 60) return `hace ${min} min`;
  const hrs = Math.floor(min / 60);
  return `hace ${hrs} h`;
};

// Formatea números con separador de miles y 2 decimales (es-PE).
const fmtNum = (n) => (parseFloat(n) || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ── Componente principal ────────────────────────────────────────────────────
function MapaChavimochic({ menu, vistaActual, onNavegar, usuario, onLogout, onVerIncidente }) {
  const centroMapa = [-8.4186, -78.7533];
  const [mapaBase, setMapaBase] = useState('satelite');
  const [filtroTiempo, setFiltroTiempo] = useState(0);
  const [filtroTramo, setFiltroTramo] = useState('');
  const [filtroEstado, setFiltroEstado] = useState('');
  const [busqueda, setBusqueda] = useState('');
  const [resultadosBusqueda, setResultadosBusqueda] = useState([]);
  const [mostrarResultados, setMostrarResultados] = useState(false);
  const [flyTarget, setFlyTarget] = useState(null);
  const [showLayers, setShowLayers] = useState(false);
  // Capas KMZ/KML que el usuario sube desde su equipo (no se guardan en el
  // servidor: viven mientras dure la sesión de la pestaña).
  const [capasUsuario, setCapasUsuario] = useState([]);
  const [cargandoKmz, setCargandoKmz] = useState(false);
  // Capas que viven en el servidor: se listan al abrir y se descargan bajo
  // demanda (al marcarlas), para no bajar megas que quizá nadie mire.
  const [capasGuardadas, setCapasGuardadas] = useState([]);
  const [ocupadaCapa, setOcupadaCapa] = useState(null);   // id en proceso
  const inputKmzRef = useRef(null);

  const [capas, setCapas] = useState({ Incidentes_Nuevos: true, Incidentes_Atencion: true, Lluvias: true, Canales: true });
  const [capasKMZ, setCapasKMZ] = useState(KMZ_CAPAS_DEFAULT);
  const [incidentesAPI, setIncidentesAPI] = useState([]);
  const [lluviasAPI, setLluviasAPI] = useState([]);
  const [cargandoAPIs, setCargandoAPIs] = useState(false);
  const [miUbicacion, setMiUbicacion] = useState(null);
  const [detalleActivo, setDetalleActivo] = useState(null);
  const [cargandoDetalle, setCargandoDetalle] = useState(false);
  const [modalMedia, setModalMedia] = useState(null);
  const [herramienta, setHerramienta] = useState(null);
  const [costeos, setCosteos] = useState({}); // { incidentId: { personal, maquinaria, insumos, total } }
  const [rawRecursos, setRawRecursos] = useState({ pers: [], mats: [], maqs: [] });
  const [grupoAbierto, setGrupoAbierto] = useState(null); // 'personal' | 'maquinaria' | 'insumos' | null
  const [incSeleccionado, setIncSeleccionado] = useState(null); // incidente filtrado en panel recursos
  const [panelMin, setPanelMin] = useState({ incidentes: false, recursos: false, infra: false });
  const toggleMin = (k) => setPanelMin(p => ({ ...p, [k]: !p[k] }));
  const [filtroEstadoInc, setFiltroEstadoInc] = useState('');   // '' | 'pat' | 'ate' | 'cer'
  const [ultimaAct, setUltimaAct] = useState(null);             // timestamp real de la última carga
  const [ahora, setAhora] = useState(Date.now());               // reloj para el "hace X min"

  const mapRef = useRef(null);
  const contenedorRef = useRef(null);
  const { ocupado: capturando, descargar, compartir } = useCapturaMapa(contenedorRef);

  // ── Stats ─────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const all = KMZ_CONFIG.flatMap(c => (c.data?.features || []).map(f => ({ ...f.properties, _tipo: c.label })));
    const tramos = {}, estados = {}, tipos = {};
    for (const f of all) { const t = f.TRAMO || 'Sin Tramo'; const e = f.ESTADO || 'Sin dato'; tramos[t] = (tramos[t] || 0) + 1; estados[e] = (estados[e] || 0) + 1; tipos[f._tipo] = (tipos[f._tipo] || 0) + 1; }
    return { tramos, estados, tipos, total: all.length };
  }, []);
  const tramosUnicos = useMemo(() => Object.keys(stats.tramos).sort(), [stats]);
  const estadosUnicos = useMemo(() => Object.keys(stats.estados).filter(e => e !== 'Sin dato').sort(), [stats]);
  const totalKMZ = KMZ_CONFIG.reduce((a, c) => a + (c.data?.features?.length || 0), 0);
  const activasKMZ = KMZ_CONFIG.filter(c => capasKMZ[c.key]).length;

  // Chart data
  const porTipoInfra = useMemo(() => Object.entries(stats.tipos).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([name, value]) => ({ name, value })), [stats]);
  const incPorTipo = useMemo(() => { const m = {}; for (const i of incidentesAPI) m[i.tipo] = (m[i.tipo] || 0) + 1; return Object.entries(m).map(([name, value]) => ({ name, value })); }, [incidentesAPI]);

  // ── Recursos agrupados globalmente ─────────────────────────────────────
  const recursosGlobales = useMemo(() => {
    const { pers: allPers, mats: allMats, maqs: allMaqs } = rawRecursos;
    // Si hay incidente seleccionado, filtra solo sus recursos.
    const fil = (arr) => incSeleccionado ? arr.filter(x => String(x.incident_report) === String(incSeleccionado.id)) : arr;
    const pers = fil(allPers), mats = fil(allMats), maqs = fil(allMaqs);
    const incCerrado = (id) => { const i = incidentesAPI.find(x => String(x.id) === String(id)); return i?.estado === 'cer'; };

    // Personal: agrupa por descripción (cargo)
    const gPers = {};
    for (const p of pers) {
      const cargo = (p.description || 'Sin cargo').split('\n')[0].trim();
      const hrs = parseFloat(p.quantity_hours || 0), pu = parseFloat(p.unit_price || 0);
      if (!gPers[cargo]) gPers[cargo] = { nombre: cargo, horas: 0, monto: 0, veces: 0 };
      gPers[cargo].horas += hrs; gPers[cargo].monto += hrs * pu; gPers[cargo].veces++;
    }

    // Insumos: agrupa por descripción
    const gMats = {};
    for (const m of mats) {
      const desc = (m.description || 'Sin descripción').trim();
      const cant = parseFloat(m.quantity || 0), pu = parseFloat(m.unit_price || 0);
      if (!gMats[desc]) gMats[desc] = { nombre: desc, cantidad: 0, monto: 0, veces: 0 };
      gMats[desc].cantidad += cant; gMats[desc].monto += cant * pu; gMats[desc].veces++;
    }

    // Maquinaria: agrupa por equipo+marca+placa (máquina única)
    const gMaqs = {};
    for (const q of maqs) {
      const nombre = q.equipment_name || 'Equipo', marca = q.brand_name || '', placa = q.model_plate || '';
      const key = `${nombre}|${marca}|${placa}`;
      const hrs = Math.max(0, parseFloat(q.end_horometer || 0) - parseFloat(q.start_horometer || 0));
      const pu = parseFloat(q.unit_price || 0);
      const enUso = hrs === 0 && !incCerrado(q.incident_report);
      if (!gMaqs[key]) gMaqs[key] = { nombre, marca, placa, horas: 0, monto: 0, partes: 0, enUso: false };
      gMaqs[key].horas += hrs; gMaqs[key].monto += hrs * pu; gMaqs[key].partes++;
      if (enUso) gMaqs[key].enUso = true;
    }

    const listaPers = Object.values(gPers).sort((a, b) => b.monto - a.monto);
    const listaMats = Object.values(gMats).sort((a, b) => b.monto - a.monto);
    const listaMaqs = Object.values(gMaqs).sort((a, b) => b.monto - a.monto);
    const totPers = listaPers.reduce((s, x) => s + x.monto, 0);
    const totMats = listaMats.reduce((s, x) => s + x.monto, 0);
    const totMaqs = listaMaqs.reduce((s, x) => s + x.monto, 0);
    const enUso = listaMaqs.filter(m => m.enUso).length;

    return { listaPers, listaMats, listaMaqs, totPers, totMats, totMaqs, total: totPers + totMats + totMaqs, enUso };
  }, [rawRecursos, incidentesAPI, incSeleccionado]);
  // ══════════════════════════════════════════════════════════════════════
  //  REPORTE DE RECURSOS UTILIZADOS (PDF / Excel)
  // ══════════════════════════════════════════════════════════════════════
  const [modalReporteRec, setModalReporteRec] = useState(false);
  const [generandoRec, setGenerandoRec] = useState(false);

  const imgToBase64Rec = (src) => new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width; canvas.height = img.height;
      canvas.getContext('2d').drawImage(img, 0, 0);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });

  const nf = (n) => (parseFloat(n) || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const reporteRecursosPDF = async () => {
    setGenerandoRec(true);
    try {
      const R = recursosGlobales;
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const W = doc.internal.pageSize.getWidth();
      const logoB64 = await imgToBase64Rec(logo).catch(() => null);
      const alcance = incSeleccionado
        ? `${incSeleccionado.codigoIncidente || ''} · ${incSeleccionado.tipo || ''}`
        : 'Todas las incidencias';

      doc.setFillColor(20, 99, 165);
      doc.rect(0, 0, W, 28, 'F');
      if (logoB64) { try { doc.addImage(logoB64, 'PNG', 10, 5, 19, 19); } catch (e) {} }
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(13); doc.setFont(undefined, 'bold');
      doc.text('JUNTA DE RIEGO PRESURIZADO', 33, 11);
      doc.setFontSize(10); doc.setFont(undefined, 'normal');
      doc.text('Reporte de Recursos Utilizados', 33, 17.5);
      doc.setFontSize(7.5);
      doc.text(`${alcance}  |  Generado: ${new Date().toLocaleString('es-PE')}`, 33, 23);

      let y = 36;
      const seccion = (titulo, head, body, foot) => {
        if (!body.length) return;
        doc.setTextColor(20, 99, 165);
        doc.setFontSize(10); doc.setFont(undefined, 'bold');
        doc.text(titulo, 12, y);
        autoTable(doc, {
          startY: y + 2,
          head: [head], body, foot: [foot],
          styles: { fontSize: 8, cellPadding: 2 },
          headStyles: { fillColor: [100, 116, 139], textColor: 255, fontSize: 8 },
          footStyles: { fillColor: [224, 242, 254], textColor: [20, 99, 165], fontStyle: 'bold', fontSize: 8 },
          alternateRowStyles: { fillColor: [248, 250, 252] },
          margin: { left: 12, right: 12 },
        });
        y = doc.lastAutoTable.finalY + 9;
      };

      seccion(`PERSONAL  (${R.listaPers.length} cargo${R.listaPers.length !== 1 ? 's' : ''})`,
        ['CARGO', 'REGISTROS', 'HORAS (HH)', 'MONTO S/'],
        R.listaPers.map(x => ([x.nombre, String(x.veces), nf(x.horas), nf(x.monto)])),
        ['', '', 'SUBTOTAL', nf(R.totPers)]);

      seccion(`MAQUINARIA  (${R.listaMaqs.length} equipo${R.listaMaqs.length !== 1 ? 's' : ''})`,
        ['EQUIPO', 'MARCA', 'PLACA', 'PARTES', 'HORAS (HE)', 'MONTO S/'],
        R.listaMaqs.map(x => ([x.nombre, x.marca || '—', x.placa || '—', String(x.partes), nf(x.horas), nf(x.monto)])),
        ['', '', '', '', 'SUBTOTAL', nf(R.totMaqs)]);

      seccion(`INSUMOS  (${R.listaMats.length} item${R.listaMats.length !== 1 ? 's' : ''})`,
        ['DESCRIPCIÓN', 'REGISTROS', 'CANTIDAD', 'MONTO S/'],
        R.listaMats.map(x => ([x.nombre, String(x.veces), nf(x.cantidad), nf(x.monto)])),
        ['', '', 'SUBTOTAL', nf(R.totMats)]);

      // Costo total
      doc.setFillColor(224, 242, 254);
      doc.rect(12, y - 4, W - 24, 12, 'F');
      doc.setTextColor(20, 99, 165);
      doc.setFontSize(12); doc.setFont(undefined, 'bold');
      doc.text('COSTO TOTAL', 16, y + 4);
      doc.text(`S/ ${nf(R.total)}`, W - 16, y + 4, { align: 'right' });

      doc.save(`Recursos_Utilizados_${new Date().toISOString().slice(0, 10)}.pdf`);
      setModalReporteRec(false);
    } catch (e) {
      console.error(e);
      Swal.fire('Error', 'No se pudo generar el reporte.', 'error');
    } finally { setGenerandoRec(false); }
  };

  const reporteRecursosExcel = async () => {
    setGenerandoRec(true);
    try {
      const R = recursosGlobales;
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Recursos Utilizados');
      ws.columns = [{ width: 40 }, { width: 18 }, { width: 15 }, { width: 14 }, { width: 16 }, { width: 16 }];
      const azul = { type: 'pattern', pattern: 'solid', fgColor: { argb: '1463A5' } };
      const azulClaro = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'E0F2FE' } };
      const gris = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F1F5F9' } };
      const borde = { top:{style:'thin',color:{argb:'E2E8F0'}}, bottom:{style:'thin',color:{argb:'E2E8F0'}}, left:{style:'thin',color:{argb:'E2E8F0'}}, right:{style:'thin',color:{argb:'E2E8F0'}} };

      for (let r = 1; r <= 3; r++) for (let c = 1; c <= 6; c++) ws.getCell(r, c).fill = azul;
      ws.getRow(1).height = 28; ws.getRow(2).height = 20; ws.getRow(3).height = 18;
      try {
        const b64 = await imgToBase64Rec(logo);
        if (b64) {
          const id = wb.addImage({ base64: b64.split(',')[1], extension: 'png' });
          ws.addImage(id, { tl: { col: 0, row: 0 }, ext: { width: 70, height: 62 } });
        }
      } catch (e) {}
      ws.mergeCells('B1:F1');
      ws.getCell('B1').value = 'JUNTA DE RIEGO PRESURIZADO';
      ws.getCell('B1').font = { bold: true, color: { argb: 'FFFFFF' }, size: 12 };
      ws.getCell('B1').alignment = { vertical: 'middle' };
      ws.mergeCells('B2:F2');
      ws.getCell('B2').value = 'Reporte de Recursos Utilizados';
      ws.getCell('B2').font = { bold: true, color: { argb: 'FFFFFF' }, size: 10 };
      ws.getCell('B2').alignment = { vertical: 'middle' };
      ws.mergeCells('B3:F3');
      ws.getCell('B3').value = `${incSeleccionado ? (incSeleccionado.codigoIncidente || '') + ' · ' + (incSeleccionado.tipo || '') : 'Todas las incidencias'}  |  Generado: ${new Date().toLocaleString('es-PE')}`;
      ws.getCell('B3').font = { italic: true, size: 9, color: { argb: 'D0D5DD' } };
      ws.getCell('B3').alignment = { vertical: 'middle' };

      let f = 5;
      const bloque = (titulo, cab, filas, subtotal, colSub) => {
        if (!filas.length) return;
        ws.mergeCells(`A${f}:F${f}`);
        ws.getCell(`A${f}`).value = titulo;
        ws.getCell(`A${f}`).fill = azul;
        ws.getCell(`A${f}`).font = { bold: true, color: { argb: 'FFFFFF' }, size: 10 };
        ws.getRow(f).height = 20;
        f += 1;
        cab.forEach((h, i) => {
          const c = ws.getCell(f, i + 1);
          c.value = h; c.fill = gris; c.border = borde;
          c.font = { bold: true, size: 9, color: { argb: '475569' } };
          c.alignment = { horizontal: 'center' };
        });
        f += 1;
        filas.forEach(fila => {
          fila.forEach((v, ci) => {
            const c = ws.getCell(f, ci + 1);
            c.value = v; c.border = borde; c.font = { size: 9 };
            if (typeof v === 'number') { c.numFmt = '#,##0.00'; c.alignment = { horizontal: 'right' }; }
          });
          f += 1;
        });
        ws.getCell(f, colSub - 1).value = 'SUBTOTAL';
        ws.getCell(f, colSub - 1).font = { bold: true, size: 9 };
        ws.getCell(f, colSub - 1).alignment = { horizontal: 'right' };
        const cs = ws.getCell(f, colSub);
        cs.value = subtotal; cs.numFmt = '#,##0.00'; cs.fill = azulClaro; cs.border = borde;
        cs.font = { bold: true, size: 10, color: { argb: '1463A5' } };
        cs.alignment = { horizontal: 'right' };
        f += 2;
      };

      bloque(`PERSONAL (${R.listaPers.length} cargo${R.listaPers.length !== 1 ? 's' : ''})`,
        ['CARGO', 'REGISTROS', 'HORAS (HH)', 'MONTO S/'],
        R.listaPers.map(x => ([x.nombre, x.veces, x.horas, x.monto])), R.totPers, 4);

      bloque(`MAQUINARIA (${R.listaMaqs.length} equipo${R.listaMaqs.length !== 1 ? 's' : ''})`,
        ['EQUIPO', 'MARCA', 'PLACA', 'PARTES', 'HORAS (HE)', 'MONTO S/'],
        R.listaMaqs.map(x => ([x.nombre, x.marca || '—', x.placa || '—', x.partes, x.horas, x.monto])), R.totMaqs, 6);

      bloque(`INSUMOS (${R.listaMats.length} item${R.listaMats.length !== 1 ? 's' : ''})`,
        ['DESCRIPCIÓN', 'REGISTROS', 'CANTIDAD', 'MONTO S/'],
        R.listaMats.map(x => ([x.nombre, x.veces, x.cantidad, x.monto])), R.totMats, 4);

      ws.mergeCells(`A${f}:E${f}`);
      ws.getCell(`A${f}`).value = 'COSTO TOTAL';
      ws.getCell(`A${f}`).fill = azulClaro;
      ws.getCell(`A${f}`).font = { bold: true, size: 12, color: { argb: '1463A5' } };
      ws.getCell(`A${f}`).alignment = { horizontal: 'right' };
      ws.getCell(`F${f}`).value = R.total;
      ws.getCell(`F${f}`).numFmt = '#,##0.00';
      ws.getCell(`F${f}`).fill = azulClaro;
      ws.getCell(`F${f}`).font = { bold: true, size: 12, color: { argb: '1463A5' } };
      ws.getCell(`F${f}`).alignment = { horizontal: 'right' };
      ws.getRow(f).height = 24;

      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Recursos_Utilizados_${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      setModalReporteRec(false);
    } catch (e) {
      console.error(e);
      Swal.fire('Error', 'No se pudo generar el reporte.', 'error');
    } finally { setGenerandoRec(false); }
  };

  const incMes = useMemo(() => { const now = new Date(), m = {}; for (let i = 5; i >= 0; i--) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); m[`${String(d.getMonth()+1).padStart(2, '0')}/${d.getFullYear()}`] = 0; } for (const x of incidentesAPI) { const d = new Date(x.timestamp); const k = `${String(d.getMonth()+1).padStart(2, '0')}/${d.getFullYear()}`; if (k in m) m[k]++; } return Object.entries(m).map(([mes, cant]) => ({ mes, cant })); }, [incidentesAPI]);

  // Filtered
  const getFilteredData = (cfg) => { if (!cfg.data?.features?.length || (!filtroTramo && !filtroEstado)) return cfg.data; return { ...cfg.data, features: cfg.data.features.filter(f => { const p = f.properties || {}; if (filtroTramo && (p.TRAMO || '') !== filtroTramo) return false; if (filtroEstado && (p.ESTADO || '') !== filtroEstado) return false; return true; }) }; };
  const incFiltrados = useMemo(() => {
    const limite = Date.now() - (filtroTiempo * 864e5);
    return filtroTiempo === 0 ? incidentesAPI : incidentesAPI.filter(i => i.timestamp >= limite);
  }, [incidentesAPI, filtroTiempo]);

  // Los que se dibujan en el mapa, según las capas activas
  const incEnMapa = useMemo(() => {
    if (!capas.Incidentes_Nuevos && !capas.Incidentes_Atencion) return [];
    return incFiltrados.filter(i => (capas.Incidentes_Nuevos && i.estado !== 'eat') || (capas.Incidentes_Atencion && i.estado === 'eat'));
  }, [incFiltrados, capas.Incidentes_Nuevos, capas.Incidentes_Atencion]);

  // Los que se listan en el panel, ordenados del más reciente al más viejo
  const incLista = useMemo(() => {
    const l = filtroEstadoInc ? incFiltrados.filter(i => i.estado === filtroEstadoInc) : incFiltrados;
    return [...l].sort((a, b) => b.timestamp - a.timestamp);
  }, [incFiltrados, filtroEstadoInc]);
  const incPend = incidentesAPI.filter(i => i.estado === 'pat').length;
  const incAte = incidentesAPI.filter(i => i.estado === 'ate').length;
  const lluviaMax = lluviasAPI.length ? Math.max(...lluviasAPI.map(l => l.totalRain)) : 0;

  // ── Search ────────────────────────────────────────────────────────────
  const handleBusqueda = (val) => { setBusqueda(val); if (val.length < 2) { setResultadosBusqueda([]); setMostrarResultados(false); return; } const q = val.toLowerCase(); setResultadosBusqueda(SEARCH_INDEX.filter(it => it.name.toLowerCase().includes(q) || it.progresiva.toLowerCase().includes(q) || it.tipo.toLowerCase().includes(q)).slice(0, 6)); setMostrarResultados(true); };
  const seleccionarResultado = (item) => { const [lng, lat] = item.coords; setFlyTarget([lat, lng]); setMostrarResultados(false); setBusqueda(item.name); setTimeout(() => setFlyTarget(null), 2000); };

  // ── APIs ───────────────────────────────────────────────────────────────
  const obtenerDatosDeApis = async () => {
    const token = localStorage.getItem('userToken'); if (!token) return; setCargandoAPIs(true);
    try {
      const resInc = await fetch('/api/v1/mobile/hi-incidents/list/', { headers: { 'Content-Type': 'application/json', 'Authorization': `Token ${token}` } });
      if (resInc.ok) { const dataInc = await resInc.json(); const tm = { '1': 'Rebose y/o Colapso de canoa o alcantarilla', '2': 'Ingreso de sedimentos al Canal Madre', '3': 'Desborde Canal Madre', '4': 'Desborde Lateral 10', '5': 'Rotura de Canal', '6': 'Interrupción del flujo en el canal en tramos con retenciones', '7': 'Presencia de palizada en canal Madre', '8': 'Corte de camino de acceso y/o servicio', '9': 'Rotura de embalse de usuario', '10': 'Incremento de caudal', '11': 'Erosión de obras de defensa ribereña', '12': 'Desborde e inundación', '13': 'Lluvia', '14': 'Otros' };
        setIncidentesAPI((dataInc.results || []).map(inc => { const lat = parseFloat(inc.latitude_marker || inc.latitude), lng = parseFloat(inc.longitude_marker || inc.longitude); let tp = tm[inc.type?.toString()] || 'Incidente'; const at = inc.another_type; if (at && at.trim() && (tp === 'Otro' || tp === 'Otros')) tp = `Otro (${at.trim()})`; const f = new Date(inc.created_at); const codigoIncidente = `INCIDENTE-${String(inc.id).padStart(3,'0')}-${String(f.getDate()).padStart(2,'0')}${String(f.getMonth()+1).padStart(2,'0')}${f.getFullYear()}`; return { id: inc.id, codigoIncidente, lat, lng, tipo: tp, estado: inc.status || 'pat', gravedad: inc.severity || 'lev', descripcion: inc.description || '', usuario: inc.user?.username || '', lugar: inc.location_text || '', fecha: new Date(inc.created_at).toLocaleString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }), timestamp: new Date(inc.created_at).getTime(), imagenUrl: inc.thumbnail || inc.image || null, codigo: inc.code || 'Sin Código' }; }).filter(i => !isNaN(i.lat) && !isNaN(i.lng) && i.lat !== 0)); }
      const resD = await fetch('/api/v1/mobile/devices/?device_type=pluviometro', { headers: { 'Authorization': `Token ${token}` } });
      if (resD.ok) { const dd = await resD.json(); const now = new Date(), p24 = new Date(now.getTime() - 864e5), fmt = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; const nd = [];
        for (const eq of (dd.results || [])) { const la = parseFloat(eq.latitude), lo = parseFloat(eq.longitude); if (isNaN(la) || isNaN(lo)) continue; let rain = 0; try { const rr = await fetch(`/api/v1/mobile/davis/rain-gauges/filtered-data/?start_date=${fmt(p24)}&end_date=${fmt(now)}&station_id=${eq.id}&metric=rainfall_mm`, { headers: { 'Authorization': `Token ${token}` } }); if (rr.ok) { const rd = await rr.json(); for (const rec of (rd.data || [])) rain += parseFloat(rec.value) || 0; } } catch(e) {} nd.push({ id: eq.id, name: eq.nombre || 'Pluviómetro', lat: la, lng: lo, totalRain: rain, isCritical: rain > 20 }); }
        setLluviasAPI(nd); }
    } catch(e) { console.error(e); } finally { setCargandoAPIs(false); setUltimaAct(Date.now()); }
  };
  useEffect(() => { obtenerDatosDeApis(); }, []);

  // Auto-refresh cada 3 min, en pausa si la pestaña está oculta
  useEffect(() => {
    const id = setInterval(() => { if (!document.hidden) obtenerDatosDeApis(); }, 180000);
    return () => clearInterval(id);
  }, []);

  // Reloj para que el "hace X min" avance solo
  useEffect(() => {
    const id = setInterval(() => setAhora(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);

  // ── Cargar costeos de gestión ──────────────────────────────────────────
  const cargarCosteos = async () => {
    const BASE = 'https://gideonstudio.duckdns.org';
    try {
      const [rP, rM, rQ] = await Promise.all([
        fetch(`${BASE}/api/v1/mobile/operations/incident-personnels/`),
        fetch(`${BASE}/api/v1/mobile/operations/incident-materials/`),
        fetch(`${BASE}/api/v1/mobile/operations/daily-part-heavy-equipments/`),
      ]);
      const parse = async (r) => { if (!r.ok) return []; const d = await r.json(); return Array.isArray(d) ? d : d.results || []; };
      const [pers, mats, maqs] = await Promise.all([parse(rP), parse(rM), parse(rQ)]);
      setRawRecursos({ pers, mats, maqs });
      const resumen = {};
      const initR = (id) => { if (!resumen[id]) resumen[id] = { personal: 0, maquinaria: 0, insumos: 0, total: 0, items: 0, equipos: [] }; };
      for (const p of pers) { const id = String(p.incident_report); initR(id); const sub = parseFloat(p.quantity_hours || 0) * parseFloat(p.unit_price || 0); resumen[id].personal += sub; resumen[id].total += sub; resumen[id].items++; }
      for (const m of mats) { const id = String(m.incident_report); initR(id); const sub = parseFloat(m.quantity || 0) * parseFloat(m.unit_price || 0); resumen[id].insumos += sub; resumen[id].total += sub; resumen[id].items++; }
      for (const q of maqs) { const id = String(q.incident_report); initR(id); const hrs = Math.max(0, parseFloat(q.end_horometer || 0) - parseFloat(q.start_horometer || 0)); const sub = hrs * parseFloat(q.unit_price || 0); resumen[id].maquinaria += sub; resumen[id].total += sub; resumen[id].items++; resumen[id].equipos.push({ nombre: q.equipment_name || 'Equipo', marca: q.brand_name || '', placa: q.model_plate || '', operador: q.operator || '', horas: hrs.toFixed(1), enUso: hrs === 0 }); }
      setCosteos(resumen);
    } catch(e) { console.error('Costeos:', e); }
  };
  useEffect(() => { cargarCosteos(); }, []);

  const cargarDetalleIncidente = useCallback(async (id) => { setDetalleActivo(null); setCargandoDetalle(true); const tk = localStorage.getItem('userToken'); try { const r = await fetch(`/api/v1/mobile/hi-incidents/${id}/`, { headers: { 'Authorization': `Token ${tk}` } }); if (r.ok) { const j = await r.json(); setDetalleActivo(j.data || j); } } catch(e) {} finally { setCargandoDetalle(false); } }, []);

  // Selecciona un incidente: lo enfoca en el mapa, carga su detalle y lo fija
  // en el panel de recursos. Lo usan el cluster y la lista.
  const seleccionarIncidente = useCallback((inc, volar = true) => {
    setIncSeleccionado(inc);
    setGrupoAbierto(null);
    cargarDetalleIncidente(inc.id);
    if (volar) { setFlyTarget([inc.lat, inc.lng]); setTimeout(() => setFlyTarget(null), 2000); }
  }, [cargarDetalleIncidente]);

  // Google Earth Pro exporta KML que usan prefijos (xsi:, gx:…) sin
  // declararlos en la raíz <kml>. Eso es XML inválido y DOMParser lo rechaza,
  // así que los declaramos antes de parsear.
  const sanearKml = (texto) => {
    let t = texto.replace(/^\uFEFF/, '').trim();
    const NS = {
      xsi: 'http://www.w3.org/2001/XMLSchema-instance',
      gx: 'http://www.google.com/kml/ext/2.2',
      atom: 'http://www.w3.org/2005/Atom',
      kml: 'http://www.opengis.net/kml/2.2',
      xsd: 'http://www.w3.org/2001/XMLSchema',
    };
    const m = t.match(/<kml\b([^>]*)>/);
    if (!m) return t;
    const attrs = m[1];
    let faltan = '';
    for (const [pref, uri] of Object.entries(NS)) {
      if (t.includes(`${pref}:`) && !attrs.includes(`xmlns:${pref}=`)) {
        faltan += ` xmlns:${pref}="${uri}"`;
      }
    }
    if (!faltan) return t;
    return t.slice(0, m.index) + `<kml${attrs}${faltan}>` + t.slice(m.index + m[0].length);
  };

  // ── Convertir un KMZ / KML en algo dibujable ───────────────────────────
  // KMZ es un ZIP con un .kml dentro: se descomprime y se convierte a GeoJSON.
  // Devuelve { data, imagenes, total }. Lo usan tanto la carga desde el equipo
  // como la descarga de las capas guardadas en el servidor.
  const procesarKMZ = async (file, nombreArchivo) => {
    const esKmz = /\.kmz$/i.test(nombreArchivo);
    const esKml = /\.kml$/i.test(nombreArchivo);
    if (!esKmz && !esKml) throw new Error('Solo se admiten archivos .kmz o .kml.');

    let textoKml = '';
    let zipKmz = null;
    if (esKmz) {
      zipKmz = await JSZip.loadAsync(file);
      const entrada = Object.keys(zipKmz.files).find(n => /\.kml$/i.test(n) && !zipKmz.files[n].dir);
      if (!entrada) throw new Error('El KMZ no contiene ningún archivo .kml.');
      textoKml = await zipKmz.files[entrada].async('string');
    } else {
      textoKml = await file.text();
    }

    const doc = new DOMParser().parseFromString(sanearKml(textoKml), 'text/xml');
    const err = doc.querySelector('parsererror');
    if (err) throw new Error(`El KML está mal formado. ${err.textContent.trim().slice(0, 160)}`);

    const geo = kmlAGeoJSON(doc);

    // togeojson convierte cada <GroundOverlay> en un rectángulo y tira la
    // imagen. Los separamos: el rectángulo no se dibuja y en su lugar se
    // monta la imagen real, que vive dentro del propio KMZ.
    const overlays = [];
    const vectores = [];
    for (const f of (geo.features || [])) {
      if (f.properties?.['@geometry-type'] === 'groundoverlay') overlays.push(f);
      else vectores.push(f);
    }
    geo.features = vectores;

    // Resuelve la imagen de cada overlay a una URL utilizable.
    const imagenes = [];
    for (const f of overlays) {
      const href = f.properties?.icon || '';
      const coords = f.geometry?.coordinates?.[0] || [];
      if (!href || coords.length < 3) continue;

      const lats = coords.map(c => c[1]);
      const lngs = coords.map(c => c[0]);
      const bounds = [
        [Math.min(...lats), Math.min(...lngs)],
        [Math.max(...lats), Math.max(...lngs)],
      ];

      let url = null;
      if (/^https?:\/\//i.test(href)) {
        url = href;                       // la imagen está en internet
      } else if (zipKmz) {
        // Ruta relativa dentro del KMZ; puede venir con %20 o mayúsculas.
        const buscada = decodeURIComponent(href).replace(/^\.\//, '').toLowerCase();
        const entrada = Object.keys(zipKmz.files).find(n =>
          !zipKmz.files[n].dir && n.toLowerCase() === buscada);
        if (entrada) {
          const blob = await zipKmz.files[entrada].async('blob');
          url = URL.createObjectURL(blob);
        }
      }
      if (url) imagenes.push({ url, bounds, nombre: f.properties?.name || 'Imagen' });
    }

    const total = geo.features.length + imagenes.length;
    if (!total) throw new Error('El archivo no tiene elementos dibujables.');
    return { data: geo, imagenes, total };
  };

  // ── Cargar un KMZ / KML desde el equipo ────────────────────────────────
  const cargarArchivoKMZ = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';                 // permite volver a elegir el mismo
    if (!file) return;

    setCargandoKmz(true);
    try {
      const { data, imagenes, total } = await procesarKMZ(file, file.name);
      const capa = {
        id: `usr-${Date.now()}`,
        nombre: file.name.replace(/\.(kmz|kml)$/i, ''),
        data, imagenes, total,
        archivo: file,                   // se conserva para poder guardarla
        color: COLORS_USUARIO[capasUsuario.length % COLORS_USUARIO.length],
        visible: true,
      };
      setCapasUsuario(prev => [...prev, capa]);
      setShowLayers(true);
      volarACapa(capa);

      Swal.fire({
        icon: 'success', title: 'Capa cargada',
        text: `${capa.nombre}: ${total} elemento(s). Puedes guardarla para que quede disponible siempre.`,
        timer: 2600, showConfirmButton: false,
      });
    } catch (err) {
      console.error(err);
      Swal.fire('No se pudo cargar', err.message || 'Revisa que el archivo sea un KMZ/KML válido.', 'error');
    } finally {
      setCargandoKmz(false);
    }
  };

  // ── Capas guardadas en el servidor ─────────────────────────────────────
  const listarCapasGuardadas = useCallback(async () => {
    try {
      const r = await fetch(`${API_CAPAS}/`);
      if (!r.ok) return;
      const lista = await r.json();
      setCapasGuardadas((lista || []).map((c, i) => ({
        id: c.id,
        nombre: c.nombre,
        color: c.color || COLORS_USUARIO[i % COLORS_USUARIO.length],
        extension: c.extension,
        tamano: c.tamano,
        visible: !!c.visible_por_defecto,
        data: null, imagenes: [], total: 0,   // se llenan al descargarla
      })));
    } catch (e) { console.error('Capas guardadas:', e); }
  }, []);
  useEffect(() => { listarCapasGuardadas(); }, [listarCapasGuardadas]);

  // Descarga y dibuja una capa guardada (solo la primera vez).
  const traerCapaGuardada = useCallback(async (capa) => {
    if (capa.data) return capa;
    setOcupadaCapa(capa.id);
    try {
      const r = await fetch(`${API_CAPAS}/${capa.id}/descargar/`);
      if (!r.ok) throw new Error(`El servidor respondió ${r.status}.`);
      const blob = await r.blob();
      const nombreArchivo = `${capa.nombre}.${capa.extension || 'kmz'}`;
      const { data, imagenes, total } = await procesarKMZ(blob, nombreArchivo);
      const llena = { ...capa, data, imagenes, total };
      setCapasGuardadas(prev => prev.map(c => c.id === capa.id ? llena : c));
      return llena;
    } catch (e) {
      Swal.fire('No se pudo abrir la capa', e.message || 'Inténtalo de nuevo.', 'error');
      return null;
    } finally { setOcupadaCapa(null); }
  }, []);

  const alternarCapaGuardada = async (capa) => {
    if (capa.visible) {
      setCapasGuardadas(prev => prev.map(c => c.id === capa.id ? { ...c, visible: false } : c));
      return;
    }
    const llena = capa.data ? capa : await traerCapaGuardada(capa);
    if (!llena) return;
    setCapasGuardadas(prev => prev.map(c => c.id === capa.id ? { ...llena, visible: true } : c));
  };

  // Sube al servidor una capa que se cargó desde el equipo.
  const guardarCapaEnServidor = async (capa) => {
    if (!capa.archivo) return;
    const { value: nombre } = await Swal.fire({
      title: 'Guardar capa',
      input: 'text',
      inputLabel: 'Nombre con el que quedará disponible para todos',
      inputValue: capa.nombre,
      showCancelButton: true,
      confirmButtonText: 'Guardar',
      confirmButtonColor: '#1268C3',
      inputValidator: v => !v?.trim() && 'Escribe un nombre',
    });
    if (!nombre) return;

    setOcupadaCapa(capa.id);
    try {
      const fd = new FormData();
      fd.append('nombre', nombre.trim());
      fd.append('archivo', capa.archivo);
      fd.append('color', capa.color);
      fd.append('creado_por', usuario || '');
      const r = await fetch(`${API_CAPAS}/`, { method: 'POST', body: fd });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        throw new Error(e.archivo || e.detail || `El servidor respondió ${r.status}.`);
      }
      // La capa deja de ser temporal: pasa a la lista de guardadas, ya dibujada.
      const creada = await r.json();
      setCapasUsuario(prev => prev.filter(c => c.id !== capa.id));
      setCapasGuardadas(prev => [{
        id: creada.id, nombre: creada.nombre, color: creada.color,
        extension: creada.extension, tamano: creada.tamano,
        visible: true, data: capa.data, imagenes: capa.imagenes, total: capa.total,
      }, ...prev]);
      Swal.fire({ icon: 'success', title: 'Capa guardada', timer: 1500, showConfirmButton: false });
    } catch (e) {
      Swal.fire('No se pudo guardar', e.message, 'error');
    } finally { setOcupadaCapa(null); }
  };

  const borrarCapaGuardada = async (capa) => {
    const c = await Swal.fire({
      title: `¿Eliminar "${capa.nombre}"?`,
      text: 'Se borra del servidor para todos los usuarios.',
      icon: 'warning', showCancelButton: true,
      confirmButtonText: 'Sí, eliminar', cancelButtonText: 'Cancelar',
      confirmButtonColor: '#d33',
    });
    if (!c.isConfirmed) return;
    try {
      const r = await fetch(`${API_CAPAS}/${capa.id}/`, { method: 'DELETE' });
      if (!r.ok && r.status !== 204) throw new Error(`El servidor respondió ${r.status}.`);
      (capa.imagenes || []).forEach(im => {
        if (im.url.startsWith('blob:')) URL.revokeObjectURL(im.url);
      });
      setCapasGuardadas(prev => prev.filter(x => x.id !== capa.id));
    } catch (e) {
      Swal.fire('No se pudo eliminar', e.message, 'error');
    }
  };

  // Encuadra el mapa sobre una capa cargada.
  const volarACapa = (capa) => {
    if (!mapRef.current || !capa) return;
    try {
      const b = L.latLngBounds([]);
      if (capa.data?.features?.length) b.extend(L.geoJSON(capa.data).getBounds());
      (capa.imagenes || []).forEach(im => b.extend(im.bounds));
      if (b.isValid()) mapRef.current.flyToBounds(b, { padding: [50, 50], maxZoom: 16, duration: 1 });
    } catch (e) { /* geometría vacía */ }
  };

  const alternarCapaUsuario = (id) =>
    setCapasUsuario(prev => prev.map(c => c.id === id ? { ...c, visible: !c.visible } : c));

  const quitarCapaUsuario = (id) =>
    setCapasUsuario(prev => {
      const c = prev.find(x => x.id === id);
      // Las imágenes son blobs en memoria: hay que soltarlas al quitar la capa.
      (c?.imagenes || []).forEach(im => {
        if (im.url.startsWith('blob:')) URL.revokeObjectURL(im.url);
      });
      return prev.filter(x => x.id !== id);
    });

  // ── Handlers ──────────────────────────────────────────────────────────
  const toggleCapa = (n) => setCapas(p => ({ ...p, [n]: !p[n] }));
  const toggleCapaKMZ = (key) => { const v = !capasKMZ[key]; setCapasKMZ(p => ({ ...p, [key]: v })); if (v) { const cfg = KMZ_CONFIG.find(c => c.key === key); if (cfg?.data?.features?.length && mapRef.current) { const b = L.geoJSON(cfg.data).getBounds(); if (b.isValid()) mapRef.current.flyToBounds(b, { padding: [40, 40], maxZoom: 15, duration: 1 }); } } };

  const obtenerUrlMapa = () => ({ satelite: "https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}", calles: "https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}", topografico: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", oscuro: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" })[mapaBase] || "https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}";

  // ── Iconos ────────────────────────────────────────────────────────────
  const iconoGPS = divIcon({ className: 'icono-vacio', html: '<div style="background:#0ea5e9;border:3px solid #fff;width:16px;height:16px;border-radius:50%;box-shadow:0 0 12px #0ea5e988"></div>', iconSize: [22, 22], iconAnchor: [11, 11] });
  const crearIconoLluvia = (r, cr) => divIcon({ className: 'icono-vacio', html: `<div style="display:flex;flex-direction:column;align-items:center;margin-top:-30px"><div style="background:${cr?'#1e293b':'#111827'};border:1px solid ${cr?'#ef4444':'#0ea5e9'};color:${cr?'#ef4444':'#0ea5e9'};font-size:10px;font-weight:700;padding:2px 6px;border-radius:4px">${r.toFixed(1)} mm</div><div style="font-size:22px;line-height:1;margin-top:2px">🌧️</div></div>`, iconSize: [60, 60], iconAnchor: [30, 45] });

  const buildPopup = useMemo(() => (props, iconUrl, label) => {
    const skip = new Set(['name', 'folder', 'FID', 'nro_ord', 'N_', 'Nº', 'Label', 'Field', '_tipo']);
    const lm = { NOMBRE: 'Nombre', PROGRESIVA: 'Progresiva', ESTADO: 'Estado', TRAMO: 'Tramo', ESTRUCTURA: 'Estructura', COD_EST: 'Canal/Sistema', ESTE: 'Este', NORTE: 'Norte' };
    const rows = Object.entries(props).filter(([k, v]) => !skip.has(k) && v && String(v).trim()).map(([k, v]) => `<tr><td style="color:#7fa5c0;padding:3px 8px 3px 0;font-size:11px">${lm[k] || k}</td><td style="font-weight:500;font-size:11px;color:#eaf3fa">${v}</td></tr>`).join('');
    return `<div style="font-family:system-ui;min-width:200px;color:#dce9f5"><div style="display:flex;align-items:center;gap:8px;border-bottom:1px solid rgba(255,255,255,.12);padding-bottom:6px;margin-bottom:6px">${iconUrl ? `<img src="${iconUrl}" style="width:24px;height:24px"/>` : ''}<div><div style="font-weight:700;font-size:13px;color:#eef6fd">${props.name || ''}</div><div style="font-size:10px;color:#7fa5c0">${label}</div></div></div>${rows ? `<table style="border-collapse:collapse;width:100%">${rows}</table>` : '<span style="font-size:11px;color:#7fa5c0">Sin datos</span>'}</div>`;
  }, []);

  const maxInfra = Math.max(1, ...porTipoInfra.map(t => t.value));

  const gruposRecursos = [
    { key: 'personal',   label: 'Personal',   icono: '👷', tinte: 'rgba(32,107,196,.18)',  color: '#74c0fc',
      sub: `${recursosGlobales.listaPers.length} cargo${recursosGlobales.listaPers.length !== 1 ? 's' : ''}`,
      monto: recursosGlobales.totPers },
    { key: 'maquinaria', label: 'Maquinaria', icono: '🚜', tinte: 'rgba(245,159,10,.16)',  color: '#f5b455',
      sub: `${recursosGlobales.listaMaqs.length} equipo${recursosGlobales.listaMaqs.length !== 1 ? 's' : ''}${recursosGlobales.enUso > 0 ? ` · ${recursosGlobales.enUso} en uso` : ''}`,
      monto: recursosGlobales.totMaqs },
    { key: 'insumos',    label: 'Insumos',    icono: '📦', tinte: 'rgba(47,179,68,.16)',   color: '#74e08a',
      sub: `${recursosGlobales.listaMats.length} ítem${recursosGlobales.listaMats.length !== 1 ? 's' : ''}`,
      monto: recursosGlobales.totMats },
  ];

  return (
    <div className="gis" ref={contenedorRef}>

      {/* ══════════════ MAPA A SANGRE COMPLETA ══════════════ */}
      <div className="gis-mapa">
        <MapContainer center={centroMapa} zoom={10} style={{ height: '100%', width: '100%' }} ref={mapRef} zoomControl={false}>
          <TileLayer url={obtenerUrlMapa()} maxZoom={20} />
          <FlyToComp pos={miUbicacion || flyTarget} />
          <UTMDisplay />
          <MiniMapa tileUrl={obtenerUrlMapa()} />
          <HerramientaMedicion modo={herramienta === 'distancia' || herramienta === 'area' ? herramienta : null} onFinish={() => {}} />

          {miUbicacion && <Marker position={miUbicacion} icon={iconoGPS}><Popup>Mi ubicación</Popup></Marker>}

          {capas.Canales && <>
            <GeoJSON data={geoCanalMadre} style={{ color: '#4dabf7', weight: 3, opacity: 0.75 }} />
            <GeoJSON data={geoLateral10} style={{ color: '#4dabf7', weight: 3, opacity: 0.75 }} />
            <GeoJSON data={geoRedes} style={{ color: '#4dabf7', weight: 3, opacity: 0.75 }} />
          </>}

          {KMZ_CONFIG.map(cfg => {
            if (!capasKMZ[cfg.key]) return null;
            const data = getFilteredData(cfg);
            if (!data?.features?.length) return null;
            if (cfg.tipo === 'poly' || cfg.tipo === 'line') {
              const st = cfg.tipo === 'line'
                ? () => ({ color: cfg.color, weight: 3, opacity: 0.85, dashArray: '8 4' })
                : () => ({ color: cfg.color, weight: 2, opacity: 0.85, fillOpacity: 0.25, fillColor: cfg.color });
              return <GeoJSON key={cfg.key + filtroTramo + filtroEstado} data={data} style={st}
                onEachFeature={(f, l) => {
                  l.bindTooltip(f.properties?.name || '', { direction: 'top', className: 'tooltip-infra' });
                  l.bindPopup(buildPopup(f.properties, cfg.icon, cfg.label), { maxWidth: 320 });
                }} />;
            }
            return <ClusteredLayer key={cfg.key + filtroTramo + filtroEstado} data={data} icon={cfg.icon} color={cfg.color} label={cfg.label} buildPopup={buildPopup} />;
          })}

          {/* imágenes (GroundOverlay) de las capas, guardadas y temporales */}
          {[...capasGuardadas, ...capasUsuario].filter(c => c.visible).flatMap(c =>
            (c.imagenes || []).map((im, i) => (
              <ImageOverlay key={`${c.id}-img-${i}`} url={im.url} bounds={im.bounds} opacity={0.75} />
            ))
          )}

          {/* capas KMZ/KML: las guardadas en el servidor y las temporales */}
          {[...capasGuardadas, ...capasUsuario].filter(c => c.visible && c.data?.features?.length).map(c => (
            <GeoJSON key={c.id} data={c.data}
              style={() => ({ color: c.color, weight: 3, opacity: .9, fillColor: c.color, fillOpacity: .22 })}
              pointToLayer={(f, latlng) => L.circleMarker(latlng, {
                radius: 6, color: '#fff', weight: 2, fillColor: c.color, fillOpacity: 1,
              })}
              onEachFeature={(f, capa) => {
                const p = f.properties || {};
                const nombre = p.name || p.Name || 'Sin nombre';
                const filas = Object.entries(p)
                  .filter(([k, v]) => !['name', 'Name', 'styleUrl', 'styleHash', 'stroke', 'fill', 'icon'].includes(k) && v && String(v).trim())
                  .map(([k, v]) => `<tr><td style="color:#7fa5c0;padding:3px 8px 3px 0;font-size:11px">${k}</td><td style="font-weight:500;font-size:11px;color:#eaf3fa">${String(v).slice(0, 120)}</td></tr>`)
                  .join('');
                capa.bindTooltip(nombre, { direction: 'top', className: 'tooltip-infra' });
                capa.bindPopup(
                  `<div style="font-family:system-ui;min-width:190px;color:#dce9f5">
                     <div style="font-weight:700;font-size:13px;color:#eef6fd;border-bottom:1px solid rgba(255,255,255,.12);padding-bottom:6px;margin-bottom:6px">
                       ${nombre}<div style="font-size:10px;font-weight:600;color:${c.color}">${c.nombre}</div>
                     </div>
                     ${filas ? `<table style="border-collapse:collapse;width:100%">${filas}</table>`
                             : '<span style="font-size:11px;color:#7fa5c0">Sin atributos</span>'}
                   </div>`, { maxWidth: 320 });
              }} />
          ))}

          <ClusterIncidentes incidentes={incEnMapa} onSeleccionar={seleccionarIncidente} />

          {capas.Lluvias && lluviasAPI.map(p => (
            <Marker key={p.id} position={[p.lat, p.lng]} icon={crearIconoLluvia(p.totalRain, p.isCritical)}>
              <Popup><b style={{ color: '#eaf3fa' }}>{p.name}</b></Popup>
            </Marker>
          ))}
        </MapContainer>
      </div>
      <div className="gis-vineta" />

      {/* ══════════════ RAIL ══════════════ */}
      <RailGIS
        menu={menu}
        vistaActual={vistaActual}
        onNavegar={onNavegar}
        usuario={usuario}
        onLogout={onLogout}
      />

      {/* ══════════════ BARRA SUPERIOR ══════════════ */}
      <header className="gis-top">
        <div className="gis-marca gis-glass">
          <div>
            <div className="gis-marca-t1">Sistema Integrado de Monitoreo</div>
            <div className="gis-marca-t2">JUNTA DE RIEGO PRESURIZADO</div>
          </div>
        </div>

        <div className="gis-buscador">
          <div className="gis-buscador-caja">
            <FaSearch className="gis-buscador-ico" />
            <input value={busqueda} onChange={e => handleBusqueda(e.target.value)}
              onFocus={() => resultadosBusqueda.length && setMostrarResultados(true)}
              placeholder="Buscar estructura, progresiva…" />
            {busqueda && (
              <button className="gis-buscador-x" onClick={() => { setBusqueda(''); setResultadosBusqueda([]); setMostrarResultados(false); }}>
                <FaTimes />
              </button>
            )}
            {mostrarResultados && resultadosBusqueda.length > 0 && (
              <div className="gis-resultados gis-glass">
                {resultadosBusqueda.map((r, i) => (
                  <div key={i} className="gis-resultado" onClick={() => seleccionarResultado(r)}>
                    {r.icon && <img src={r.icon} alt="" />}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <b>{r.name}</b>
                      <span>{r.tipo}{r.progresiva ? ` · ${r.progresiva}` : ''}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="gis-acciones gis-glass">
          <span className="gis-chip-activo"><span className="gis-punto" />ACTIVO</span>
          <select className="gis-select" value={mapaBase} onChange={e => setMapaBase(e.target.value)}>
            <option value="satelite">Satélite</option>
            <option value="calles">Calles</option>
            <option value="topografico">Topográfico</option>
            <option value="oscuro">Oscuro</option>
          </select>
          <button className="gis-btn-primario" onClick={obtenerDatosDeApis}>
            <FaSyncAlt className={cargandoAPIs ? 'icon-spin' : ''} />{cargandoAPIs ? '…' : 'Actualizar'}
          </button>
        </div>
      </header>

      {/* ══════════════ KPIs ══════════════ */}
      <div className="gis-kpis">
        <div className="gis-kpi gis-glass">
          <span className="gis-kpi-ico" style={{ background: 'rgba(32,107,196,.18)', color: '#74c0fc' }}>🏗️</span>
          <span>
            <span className="gis-kpi-label">Infraestructura</span>
            <span className="gis-kpi-valor">{totalKMZ.toLocaleString('es-PE')}</span>
          </span>
        </div>
        <div className="gis-kpi gis-glass">
          <span className="gis-kpi-ico" style={{ background: 'rgba(245,159,10,.16)', color: '#f5b455' }}>⚠️</span>
          <span>
            <span className="gis-kpi-label">Incidentes</span>
            <span className="gis-kpi-valor">{incidentesAPI.length}<small>{incPend} pend · {incAte} aten</small></span>
          </span>
        </div>
        <div className="gis-kpi gis-glass">
          <span className="gis-kpi-ico" style={{ background: 'rgba(47,179,68,.16)', color: '#74e08a' }}>🌧️</span>
          <span>
            <span className="gis-kpi-label">Estaciones</span>
            <span className="gis-kpi-valor">{lluviasAPI.length}</span>
          </span>
        </div>
        <div className="gis-kpi gis-glass">
          <span className="gis-kpi-ico" style={{ background: 'rgba(6,182,212,.16)', color: '#5ad4e6' }}><FaTint /></span>
          <span>
            <span className="gis-kpi-label">Lluvia 24 h</span>
            <span className="gis-kpi-valor">{lluviaMax.toFixed(1)}<small>mm</small></span>
          </span>
        </div>
      </div>

      {/* ══════════════ HERRAMIENTAS ══════════════ */}
      <div className="gis-tools gis-glass">
        <button className="gis-tool" title="Vista general" onClick={() => mapRef.current?.flyTo(centroMapa, 10, { duration: 1 })}><FaGlobe /></button>
        <button className={`gis-tool ${showLayers ? 'activo' : ''}`} title="Capas" onClick={() => setShowLayers(v => !v)}><FaLayerGroup /></button>
        <button className={`gis-tool ${capasUsuario.length || capasGuardadas.some(c => c.visible) ? 'activo' : ''}`}
          title="Cargar un KMZ o KML desde tu equipo"
          onClick={() => inputKmzRef.current?.click()} disabled={cargandoKmz}>
          {cargandoKmz ? <FaSyncAlt className="icon-spin" /> : <FaFileUpload />}
        </button>
        <button className="gis-tool" title="Mi ubicación" onClick={() => navigator.geolocation.getCurrentPosition(p => setMiUbicacion([p.coords.latitude, p.coords.longitude]))}><FaLocationArrow /></button>
        <div className="gis-tool-sep" />
        <button className={`gis-tool ${herramienta === 'distancia' ? 'activo' : ''}`} title="Medir distancia"
          onClick={() => setHerramienta(herramienta === 'distancia' ? null : 'distancia')}><FaRulerCombined /></button>
        <button className={`gis-tool ${herramienta === 'area' ? 'activo' : ''}`} title="Medir área"
          onClick={() => setHerramienta(herramienta === 'area' ? null : 'area')}><FaDrawPolygon /></button>
        <button className="gis-tool" title="Limpiar medición" onClick={() => setHerramienta(null)}><FaEraser /></button>
        <div className="gis-tool-sep" />
        <button className="gis-tool" title="Capturar mapa" onClick={descargar} disabled={capturando}><FaCamera /></button>
        <button className="gis-tool" title="Compartir captura" onClick={compartir} disabled={capturando}><FaShareAlt /></button>
        <div className="gis-tool-sep" />
        <button className="gis-tool" title="Acercar" onClick={() => mapRef.current?.zoomIn()}><FaPlus /></button>
        <button className="gis-tool" title="Alejar" onClick={() => mapRef.current?.zoomOut()}><FaMinus /></button>
      </div>

      {/* selector de archivo, oculto: lo dispara el botón de la barra */}
      <input ref={inputKmzRef} type="file" accept=".kmz,.kml" onChange={cargarArchivoKMZ} style={{ display: 'none' }} />

      {/* ══════════════ PANEL DE CAPAS ══════════════ */}
      {showLayers && (
        <div className="gis-capas gis-glass">
          <div className="gis-capas-head">
            <span className="gis-sub">Capas y filtros</span>
            <button className="gis-tool" style={{ width: 26, height: 26 }} onClick={() => setShowLayers(false)}><FaTimes /></button>
          </div>
          <div className="gis-capas-body">
            <div className="gis-capas-grupo">
              <div className="gis-capas-titulo">General</div>
              <div className="gis-capa"><label><input type="checkbox" checked={capas.Canales} onChange={() => toggleCapa('Canales')} /> Trazado de canales</label></div>
              <div className="gis-capa"><label><input type="checkbox" checked={capas.Incidentes_Atencion} onChange={() => { toggleCapa('Incidentes_Atencion'); toggleCapa('Incidentes_Nuevos'); }} /> Incidentes</label></div>
              <div className="gis-capa"><label><input type="checkbox" checked={capas.Lluvias} onChange={() => toggleCapa('Lluvias')} /> Pluviómetros</label></div>
              {(capas.Incidentes_Nuevos || capas.Incidentes_Atencion) && (
                <select className="gis-mini-select" value={filtroTiempo} onChange={e => setFiltroTiempo(Number(e.target.value))}>
                  <option value={1}>24 horas</option><option value={7}>7 días</option><option value={30}>30 días</option><option value={0}>Todo</option>
                </select>
              )}
            </div>

            {/* capas guardadas en el servidor */}
            <div className="gis-capas-grupo">
              <div className="gis-capas-titulo">Capas guardadas ({capasGuardadas.length})</div>
              {capasGuardadas.length === 0 ? (
                <div style={{ fontSize: '10.5px', color: '#6f95b1', fontStyle: 'italic', padding: '2px 0' }}>
                  Ninguna todavía. Carga un archivo y guárdalo.
                </div>
              ) : capasGuardadas.map(c => (
                <div key={c.id} className="gis-capa">
                  <label>
                    <input type="checkbox" checked={c.visible}
                      disabled={ocupadaCapa === c.id}
                      onChange={() => alternarCapaGuardada(c)} />
                    <span style={{ display: 'inline-block', width: 14, height: 14, background: c.color, borderRadius: '50%' }} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={c.nombre}>
                      {c.nombre}
                    </span>
                  </label>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    {ocupadaCapa === c.id
                      ? <FaSyncAlt className="icon-spin" size={11} style={{ color: '#74c0fc' }} />
                      : <span className="gis-capa-badge">{c.total || '—'}</span>}
                    {c.data && (
                      <button onClick={() => volarACapa(c)} title="Centrar en esta capa"
                        style={{ background: 'none', border: 'none', color: '#74c0fc', cursor: 'pointer', display: 'flex', padding: 2 }}>
                        <FaCrosshairs size={11} />
                      </button>
                    )}
                    <button onClick={() => borrarCapaGuardada(c)} title="Eliminar del servidor"
                      style={{ background: 'none', border: 'none', color: '#f0616d', cursor: 'pointer', display: 'flex', padding: 2 }}>
                      <FaTrash size={11} />
                    </button>
                  </span>
                </div>
              ))}
            </div>

            {/* capas cargadas desde el equipo (aún sin guardar) */}
            <div className="gis-capas-grupo">
              <div className="gis-capas-titulo">Sin guardar (solo esta sesión)</div>
              <div className="gis-capas-acciones">
                <button onClick={() => inputKmzRef.current?.click()} disabled={cargandoKmz}>
                  {cargandoKmz ? 'Cargando…' : '+ Cargar archivo'}
                </button>
              </div>
              {capasUsuario.length === 0 ? (
                <div style={{ fontSize: '10.5px', color: '#6f95b1', fontStyle: 'italic', padding: '2px 0' }}>
                  Ninguna cargada todavía.
                </div>
              ) : capasUsuario.map(c => (
                <div key={c.id} className="gis-capa">
                  <label>
                    <input type="checkbox" checked={c.visible} onChange={() => alternarCapaUsuario(c.id)} />
                    <span style={{ display: 'inline-block', width: 14, height: 14, background: c.color, borderRadius: '50%' }} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={c.nombre}>{c.nombre}</span>
                  </label>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span className="gis-capa-badge">{c.total}</span>
                    <button onClick={() => guardarCapaEnServidor(c)} title="Guardar en el servidor"
                      disabled={ocupadaCapa === c.id}
                      style={{ background: 'none', border: 'none', color: '#74e08a', cursor: 'pointer', display: 'flex', padding: 2 }}>
                      {ocupadaCapa === c.id ? <FaSyncAlt className="icon-spin" size={11} /> : <FaSave size={11} />}
                    </button>
                    <button onClick={() => volarACapa(c)} title="Centrar en esta capa"
                      style={{ background: 'none', border: 'none', color: '#74c0fc', cursor: 'pointer', display: 'flex', padding: 2 }}>
                      <FaCrosshairs size={11} />
                    </button>
                    <button onClick={() => quitarCapaUsuario(c.id)} title="Quitar capa"
                      style={{ background: 'none', border: 'none', color: '#f0616d', cursor: 'pointer', display: 'flex', padding: 2 }}>
                      <FaTrash size={11} />
                    </button>
                  </span>
                </div>
              ))}
            </div>

            <div className="gis-capas-grupo">
              <div className="gis-capas-titulo">Filtros</div>
              <select className="gis-mini-select" value={filtroTramo} onChange={e => setFiltroTramo(e.target.value)}>
                <option value="">Todos los tramos</option>{tramosUnicos.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              <select className="gis-mini-select" value={filtroEstado} onChange={e => setFiltroEstado(e.target.value)}>
                <option value="">Todo estado</option>{estadosUnicos.map(e2 => <option key={e2} value={e2}>{e2}</option>)}
              </select>
              {(filtroTramo || filtroEstado) && (
                <button className="gis-inc-link" style={{ padding: '4px 0' }} onClick={() => { setFiltroTramo(''); setFiltroEstado(''); }}>✕ Limpiar filtros</button>
              )}
            </div>

            <div className="gis-capas-grupo">
              <div className="gis-capas-titulo">Infraestructura ({totalKMZ.toLocaleString('es-PE')})</div>
              <div className="gis-capas-acciones">
                <button onClick={() => setCapasKMZ(Object.fromEntries(KMZ_CONFIG.map(c => [c.key, true])))}>Todas</button>
                <button onClick={() => setCapasKMZ(KMZ_CAPAS_DEFAULT)}>Ninguna</button>
              </div>
              {KMZ_CONFIG.map(c => (
                <div key={c.key} className="gis-capa">
                  <label>
                    <input type="checkbox" checked={capasKMZ[c.key]} onChange={() => toggleCapaKMZ(c.key)} />
                    {c.icon
                      ? <img src={c.icon} alt="" />
                      : <span style={{ display: 'inline-block', width: 14, height: c.tipo === 'line' ? 3 : 14, background: c.color, borderRadius: c.tipo === 'line' ? 2 : '50%' }} />}
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.label}</span>
                  </label>
                  <span className="gis-capa-badge">{c.data?.features?.length || 0}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ══════════════ PANEL DERECHO ══════════════ */}
      <aside className="gis-panel">

        {/* ── Lista de incidentes ── */}
        <div className="gis-tarjeta gis-glass">
          <div className="gis-tarjeta-head">
            <span className="gis-sub">Incidentes ({incLista.length})</span>
            <button className="gis-btn-plegar" onClick={() => toggleMin('incidentes')}
              title={panelMin.incidentes ? 'Expandir' : 'Minimizar'}>
              {panelMin.incidentes ? <FaChevronDown /> : <FaChevronUp />}
            </button>
          </div>
          {!panelMin.incidentes && <>
            <div className="gis-filtros-inc">
              {[['', 'Todos'], ['pat', 'Pendientes'], ['ate', 'Atención'], ['cer', 'Cerrados']].map(([v, t]) => (
                <button key={v} className={`gis-chip ${filtroEstadoInc === v ? 'activo' : ''}`}
                  onClick={() => setFiltroEstadoInc(v)}>{t}</button>
              ))}
            </div>
            <div className="gis-lista-inc">
              {incLista.length === 0 && <div className="gis-detalle-vacio" style={{ padding: '4px 16px 12px' }}>Sin incidentes para este filtro</div>}
              {incLista.map(inc => {
                const [color, texto] = badge(inc.estado);
                const activo = incSeleccionado && incSeleccionado.id === inc.id;
                return (
                  <button key={inc.id} className={`gis-inc-item ${activo ? 'activo' : ''}`}
                    onClick={() => seleccionarIncidente(inc)}>
                    <span className="gis-inc-dot" style={{ background: color }} />
                    <span className="gis-inc-txt">
                      <b>{inc.tipo}</b>
                      <span>{inc.lugar || inc.codigo} · {inc.fecha}</span>
                    </span>
                    <span className="gis-inc-estado" style={{ color, borderColor: `${color}55`, background: `${color}18` }}>{texto}</span>
                  </button>
                );
              })}
            </div>
          </>}
        </div>

        {/* ── Recursos ── */}
        <div className="gis-tarjeta gis-glass">
          <div className="gis-tarjeta-head">
            <span className="gis-sub">{incSeleccionado ? 'Recursos del incidente' : 'Recursos utilizados'}</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <button className="gis-btn-mini" onClick={() => setModalReporteRec(true)} disabled={recursosGlobales.total === 0}>
                <FaDownload size={10} /> Reporte
              </button>
              <button className="gis-btn-plegar" onClick={() => toggleMin('recursos')}
                title={panelMin.recursos ? 'Expandir' : 'Minimizar'}>
                {panelMin.recursos ? <FaChevronDown /> : <FaChevronUp />}
              </button>
            </span>
          </div>

          {!panelMin.recursos && <>
          {incSeleccionado && (
            <div className="gis-inc-chip">
              <div className="gis-inc-top">
                <span className="gis-inc-tipo">{incSeleccionado.tipo}</span>
                <button className="gis-inc-link" onClick={() => { setIncSeleccionado(null); setGrupoAbierto(null); }}>Ver todos</button>
              </div>
              <div className="gis-inc-cod">{incSeleccionado.codigoIncidente}</div>
              <div className="gis-inc-meta">{incSeleccionado.codigo} · {incSeleccionado.lugar} · {incSeleccionado.fecha}</div>
              {incSeleccionado.descripcion && <div className="gis-inc-desc">{incSeleccionado.descripcion}</div>}
              {cargandoDetalle ? (
                <div style={{ textAlign: 'center', padding: 10, color: '#74c0fc' }}><FaSyncAlt className="icon-spin" /></div>
              ) : detalleActivo && detalleActivo.id === incSeleccionado.id && detalleActivo.images?.length > 0 ? (
                <div className="gis-inc-fotos">
                  {detalleActivo.images.map((it, j) => {
                    const src = it.content?.startsWith('http') ? it.content : `data:image/jpeg;base64,${it.content}`;
                    return <img key={j} src={src} alt="" onClick={() => setModalMedia({ src, type: 'image' })} />;
                  })}
                </div>
              ) : incSeleccionado.imagenUrl && (
                <div className="gis-inc-fotos">
                  <img src={incSeleccionado.imagenUrl} alt="" onClick={() => setModalMedia({ src: incSeleccionado.imagenUrl, type: 'image' })} />
                </div>
              )}
              {onVerIncidente && (
                <button className="gis-btn-ficha" onClick={() => onVerIncidente(incSeleccionado.id)}>
                  Ver ficha completa <FaChevronRight size={10} />
                </button>
              )}
            </div>
          )}

          {gruposRecursos.map(g => (
            <div key={g.key}>
              <button className="gis-fila" onClick={() => setGrupoAbierto(grupoAbierto === g.key ? null : g.key)}>
                <span className="gis-fila-ico" style={{ background: g.tinte, color: g.color }}>{g.icono}</span>
                <span className="gis-fila-txt"><b>{g.label}</b><span>{g.sub}</span></span>
                <span className="gis-fila-monto">S/ {fmtNum(g.monto)}</span>
                <FaChevronRight className={`gis-fila-chev ${grupoAbierto === g.key ? 'abierto' : ''}`} />
              </button>

              {grupoAbierto === 'personal' && g.key === 'personal' && (
                <div className="gis-detalle">
                  {recursosGlobales.listaPers.length === 0 ? <div className="gis-detalle-vacio">Sin personal registrado</div>
                    : recursosGlobales.listaPers.map((p, i) => (
                      <div key={i} className="gis-detalle-item">
                        <span className="nom">{p.nombre}</span>
                        <span className="uni">{p.horas.toFixed(1)} HH</span>
                        <span className="mon">S/ {fmtNum(p.monto)}</span>
                      </div>
                    ))}
                </div>
              )}

              {grupoAbierto === 'maquinaria' && g.key === 'maquinaria' && (
                <div className="gis-detalle">
                  {recursosGlobales.listaMaqs.length === 0 ? <div className="gis-detalle-vacio">Sin maquinaria registrada</div>
                    : recursosGlobales.listaMaqs.map((m, i) => (
                      <div key={i} className="gis-detalle-item">
                        <span className={`gis-uso ${m.enUso ? 'si' : 'no'}`}>{m.enUso ? 'En uso' : 'Disp.'}</span>
                        <span className="nom">{m.nombre}<span style={{ display: 'block', fontSize: 9, color: '#6f95b1', fontWeight: 400 }}>{m.marca} {m.placa}</span></span>
                        <span className="uni">{m.horas.toFixed(1)} HE</span>
                        <span className="mon">S/ {fmtNum(m.monto)}</span>
                      </div>
                    ))}
                </div>
              )}

              {grupoAbierto === 'insumos' && g.key === 'insumos' && (
                <div className="gis-detalle">
                  {recursosGlobales.listaMats.length === 0 ? <div className="gis-detalle-vacio">Sin insumos registrados</div>
                    : recursosGlobales.listaMats.map((m, i) => (
                      <div key={i} className="gis-detalle-item">
                        <span className="nom">{m.nombre}</span>
                        <span className="uni">{m.cantidad.toFixed(1)} u</span>
                        <span className="mon">S/ {fmtNum(m.monto)}</span>
                      </div>
                    ))}
                </div>
              )}
            </div>
          ))}

          <div className="gis-total">
            <span className="gis-sub" style={{ color: '#9ecdf3' }}>Costo total</span>
            <b>S/ {fmtNum(recursosGlobales.total)}</b>
          </div>
          </>}
        </div>

        <div className="gis-tarjeta gis-glass" style={{ padding: '14px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: panelMin.infra ? 0 : 13 }}>
            <span className="gis-sub">Infraestructura por tipo</span>
            <button className="gis-btn-plegar" onClick={() => toggleMin('infra')}
              title={panelMin.infra ? 'Expandir' : 'Minimizar'}>
              {panelMin.infra ? <FaChevronDown /> : <FaChevronUp />}
            </button>
          </div>
          {!panelMin.infra && <div className="gis-barras">
            {porTipoInfra.map((t, i) => (
              <div className="gis-barra" key={t.name}>
                <span className="gis-barra-label">{t.name}</span>
                <div className="gis-barra-track">
                  <div className="gis-barra-fill" style={{ width: `${(t.value / maxInfra) * 100}%`, background: COLORS[i % COLORS.length] }} />
                </div>
                <span className="gis-barra-num">{t.value}</span>
              </div>
            ))}
          </div>}
        </div>
      </aside>

      {/* ══════════════ LEYENDA ══════════════ */}
      <div className="gis-leyenda gis-glass">
        <span><i style={{ background: '#f59f00' }} />Pendiente</span>
        <span><i style={{ background: '#d63939' }} />Atención</span>
        <span><i style={{ background: '#2fb344' }} />Resuelto</span>
        <span className="gis-leyenda-sep" />
        <code>{cargandoAPIs ? 'ACTUALIZANDO…' : `ÚLT. ACT. ${haceRato(ultimaAct, ahora)}`}</code>
      </div>

      {/* ══════════════ MODAL DE IMAGEN ══════════════ */}
      {modalMedia && (
        <div onClick={() => setModalMedia(null)}
          style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.92)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'zoom-out' }}>
          <button onClick={() => setModalMedia(null)}
            style={{ position: 'absolute', top: 16, right: 20, background: 'rgba(255,255,255,0.1)', border: 'none', color: '#fff', fontSize: 20, cursor: 'pointer', borderRadius: '50%', width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
          {modalMedia.type === 'image'
            ? <img src={modalMedia.src} alt="" onClick={e => e.stopPropagation()} style={{ maxWidth: '90vw', maxHeight: '90vh', objectFit: 'contain', borderRadius: 8 }} />
            : <video src={modalMedia.src} onClick={e => e.stopPropagation()} controls autoPlay style={{ maxWidth: '90vw', maxHeight: '90vh', borderRadius: 8, background: '#000' }} />}
        </div>
      )}

      {/* ══════════════ MODAL DE REPORTE ══════════════ */}
      {modalReporteRec && (
        <div onClick={() => !generandoRec && setModalReporteRec(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 10002, background: 'rgba(4,10,18,0.72)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div onClick={e => e.stopPropagation()} className="gis-glass"
            style={{ borderRadius: 18, width: '100%', maxWidth: 420, overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid rgba(255,255,255,.08)' }}>
              <h5 style={{ margin: 0, fontSize: 15, color: '#eef6fd' }}>📋 Reporte de recursos</h5>
              <button onClick={() => !generandoRec && setModalReporteRec(false)} disabled={generandoRec}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#8fb4cd', fontSize: 16, display: 'flex' }}><FaTimes /></button>
            </div>
            <div style={{ padding: 18 }}>
              <p style={{ margin: '0 0 6px', fontSize: 13, color: '#cfe1ef' }}>
                {incSeleccionado
                  ? <>Recursos de <b style={{ color: '#74c0fc' }}>{incSeleccionado.codigoIncidente || incSeleccionado.tipo}</b>.</>
                  : <>Recursos de <b style={{ color: '#74c0fc' }}>todas las incidencias</b>.</>}
              </p>
              <p style={{ margin: '0 0 14px', fontSize: 12, color: '#7fa5c0' }}>
                {recursosGlobales.listaPers.length} cargo(s) · {recursosGlobales.listaMaqs.length} equipo(s) · {recursosGlobales.listaMats.length} insumo(s)
                <br />Costo total: <b style={{ color: '#eaf3fa' }}>S/ {nf(recursosGlobales.total)}</b>
              </p>
              {generandoRec ? (
                <div style={{ textAlign: 'center', padding: '20px 0' }}>
                  <FaSyncAlt className="icon-spin" style={{ fontSize: 24, color: '#74c0fc' }} />
                  <p style={{ fontSize: 13, color: '#7fa5c0', marginTop: 8 }}>Generando…</p>
                </div>
              ) : (
                <div style={{ display: 'flex', gap: 10 }}>
                  <button onClick={reporteRecursosPDF}
                    style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '16px 10px', background: 'rgba(214,57,57,.14)', color: '#ff8f8f', border: '1px solid rgba(214,57,57,.35)', borderRadius: 12, cursor: 'pointer', fontSize: 13, fontWeight: 700, fontFamily: 'inherit' }}>
                    <FaFilePdf size={24} /> PDF
                  </button>
                  <button onClick={reporteRecursosExcel}
                    style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '16px 10px', background: 'rgba(47,179,68,.14)', color: '#74e08a', border: '1px solid rgba(47,179,68,.35)', borderRadius: 12, cursor: 'pointer', fontSize: 13, fontWeight: 700, fontFamily: 'inherit' }}>
                    <FaFileExcel size={24} /> Excel
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default MapaChavimochic;