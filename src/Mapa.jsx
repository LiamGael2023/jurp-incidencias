import { useState, useEffect, useMemo, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, GeoJSON, useMap, useMapEvents } from 'react-leaflet';
import L, { divIcon } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import './MapaDashboard.css';
import { FaCloudShowersHeavy, FaExclamationTriangle, FaLocationArrow, FaCheck, FaTimes, FaChevronLeft, FaChevronRight, FaGlobe, FaSyncAlt, FaSearch, FaChartBar, FaFilter, FaLayerGroup, FaTint, FaFilePdf, FaFileExcel, FaDownload } from 'react-icons/fa';
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

// Formatea números con separador de miles y 2 decimales (es-PE).
const fmtNum = (n) => (parseFloat(n) || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ── Componente principal ────────────────────────────────────────────────────
function MapaChavimochic() {
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
  const tiempoLimite = Date.now() - (filtroTiempo * 864e5);
  const incFiltrados = filtroTiempo === 0 ? incidentesAPI : incidentesAPI.filter(i => i.timestamp >= tiempoLimite);
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
    } catch(e) { console.error(e); } finally { setCargandoAPIs(false); }
  };
  useEffect(() => { obtenerDatosDeApis(); }, []);

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

  const cargarDetalleIncidente = async (id) => { setDetalleActivo(null); setCargandoDetalle(true); const tk = localStorage.getItem('userToken'); try { const r = await fetch(`/api/v1/mobile/hi-incidents/${id}/`, { headers: { 'Authorization': `Token ${tk}` } }); if (r.ok) { const j = await r.json(); setDetalleActivo(j.data || j); } } catch(e) {} finally { setCargandoDetalle(false); } };

  // ── Handlers ──────────────────────────────────────────────────────────
  const toggleCapa = (n) => setCapas(p => ({ ...p, [n]: !p[n] }));
  const toggleCapaKMZ = (key) => { const v = !capasKMZ[key]; setCapasKMZ(p => ({ ...p, [key]: v })); if (v) { const cfg = KMZ_CONFIG.find(c => c.key === key); if (cfg?.data?.features?.length && mapRef.current) { const b = L.geoJSON(cfg.data).getBounds(); if (b.isValid()) mapRef.current.flyToBounds(b, { padding: [40, 40], maxZoom: 15, duration: 1 }); } } };

  const obtenerUrlMapa = () => ({ satelite: "https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}", calles: "https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}", topografico: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", oscuro: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" })[mapaBase] || "https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}";

  // ── Iconos ────────────────────────────────────────────────────────────
  const crearIconoIncidente = (g) => { let c = '#f59f00'; if (g === 'mod') c = '#f76707'; if (g === 'gra') c = '#ef4444'; return divIcon({ className: 'icono-vacio', html: `<div style="position:relative;width:20px;height:20px"><div style="position:absolute;inset:0;background:${c};opacity:0.4;border-radius:50%;animation:pulse 1.5s infinite"></div><div style="position:absolute;top:4px;left:4px;width:12px;height:12px;background:${c};border:2px solid rgba(0,0,0,0.3);border-radius:50%;box-shadow:0 0 8px ${c}88"></div></div>`, iconSize: [20, 20], iconAnchor: [10, 10] }); };
  const iconoGPS = divIcon({ className: 'icono-vacio', html: '<div style="background:#0ea5e9;border:3px solid #fff;width:16px;height:16px;border-radius:50%;box-shadow:0 0 12px #0ea5e988"></div>', iconSize: [22, 22], iconAnchor: [11, 11] });
  const crearIconoLluvia = (r, cr) => divIcon({ className: 'icono-vacio', html: `<div style="display:flex;flex-direction:column;align-items:center;margin-top:-30px"><div style="background:${cr?'#1e293b':'#111827'};border:1px solid ${cr?'#ef4444':'#0ea5e9'};color:${cr?'#ef4444':'#0ea5e9'};font-size:10px;font-weight:700;padding:2px 6px;border-radius:4px">${r.toFixed(1)} mm</div><div style="font-size:22px;line-height:1;margin-top:2px">🌧️</div></div>`, iconSize: [60, 60], iconAnchor: [30, 45] });
  const badge = (e) => ({ pat: ['#f59f00', 'Pendiente'], ate: ['#0ea5e9', 'En Atención'], cer: ['#22c55e', 'Cerrado'] }[e] || ['#64748b', e]);

  const buildPopup = useMemo(() => (props, iconUrl, label) => {
    const skip = new Set(['name', 'folder', 'FID', 'nro_ord', 'N_', 'Nº', 'Label', 'Field', '_tipo']);
    const lm = { NOMBRE: 'Nombre', PROGRESIVA: 'Progresiva', ESTADO: 'Estado', TRAMO: 'Tramo', ESTRUCTURA: 'Estructura', COD_EST: 'Canal/Sistema', ESTE: 'Este', NORTE: 'Norte' };
    const rows = Object.entries(props).filter(([k, v]) => !skip.has(k) && v && String(v).trim()).map(([k, v]) => `<tr><td style="color:#64748b;padding:3px 8px 3px 0;font-size:11px">${lm[k] || k}</td><td style="font-weight:500;font-size:11px;color:#e2e8f0">${v}</td></tr>`).join('');
    return `<div style="font-family:system-ui;min-width:200px;background:#fff;color:#1d273b;border-radius:6px;padding:10px"><div style="display:flex;align-items:center;gap:8px;border-bottom:1px solid #e2e8f0;padding-bottom:6px;margin-bottom:6px">${iconUrl ? `<img src="${iconUrl}" style="width:24px;height:24px"/>` : ''}<div><div style="font-weight:700;font-size:13px">${props.name || ''}</div><div style="font-size:10px;color:#64748b">${label}</div></div></div>${rows ? `<table style="border-collapse:collapse;width:100%">${rows}</table>` : '<span style="font-size:11px;color:#475569">Sin datos</span>'}</div>`;
  }, []);

  return (
    <div className="dash" ref={contenedorRef}>
      {/* ── KPI Bar ──────────────────────────────────────────────────── */}
      <div className="dash-kpi-bar">
        <div className="dash-kpi"><div className="dash-kpi-icon" style={{ color: '#1463A5' }}>🏗️</div><div><div className="dash-kpi-label">Infraestructura</div><div className="dash-kpi-value">{totalKMZ.toLocaleString()}</div><div className="dash-kpi-sub">elementos registrados</div></div></div>
        <div className="dash-kpi"><div className="dash-kpi-icon" style={{ color: '#f59f00' }}>⚠️</div><div><div className="dash-kpi-label">Incidentes</div><div className="dash-kpi-value">{incidentesAPI.length}</div><div className="dash-kpi-sub">{incPend} pendientes · {incAte} atención</div></div></div>
        <div className="dash-kpi"><div className="dash-kpi-icon" style={{ color: '#22c55e' }}>🌧️</div><div><div className="dash-kpi-label">Estaciones</div><div className="dash-kpi-value">{lluviasAPI.length}</div><div className="dash-kpi-sub">pluviómetros activos</div></div></div>
        <div className="dash-kpi"><div className="dash-kpi-icon" style={{ color: '#06b6d4' }}><FaTint /></div><div><div className="dash-kpi-label">Lluvia Máx 24h</div><div className="dash-kpi-value">{lluviaMax.toFixed(1)} <span style={{ fontSize: '12px', color: '#64748b' }}>mm</span></div><div className="dash-kpi-sub">acumulado mayor</div></div></div>
        <div className="dash-kpi"><div className="dash-kpi-icon" style={{ color: '#a855f7' }}>🛡️</div><div><div className="dash-kpi-label">Garitas</div><div className="dash-kpi-value">{(geoGaritasJURP?.features?.length || 0) + (geoGaritasOtros?.features?.length || 0)}</div><div className="dash-kpi-sub">puntos de vigilancia</div></div></div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <select value={mapaBase} onChange={e => setMapaBase(e.target.value)} style={{ background: '#f8fafc', color: '#626976', border: '1px solid #e2e8f0', borderRadius: '4px', padding: '4px 8px', fontSize: '11px', fontFamily: 'inherit' }}>
            <option value="satelite">Satélite</option><option value="calles">Calles</option><option value="topografico">Topográfico</option><option value="oscuro">Oscuro</option>
          </select>
          <button onClick={obtenerDatosDeApis} style={{ background: '#1463A5', color: '#fff', border: 'none', borderRadius: '4px', padding: '6px 12px', fontSize: '11px', fontWeight: '600', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}><FaSyncAlt className={cargandoAPIs ? 'icon-spin' : ''} /> {cargandoAPIs ? '...' : 'Actualizar'}</button>
        </div>
      </div>

      {/* ── Body ─────────────────────────────────────────────────────── */}
      <div className="dash-body">
        {/* ── Map Column ──────────────────────────────────────────────── */}
        <div className="dash-map-col">
          <div className="dash-map-wrap">
            {/* Toolbar */}
            <BarraHerramientas herramienta={herramienta} setHerramienta={setHerramienta} onCaptura={descargar} onCompartir={compartir} capturando={capturando} />

            {/* Search */}
            <div className="dash-search">
              <FaSearch style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#475569', fontSize: '12px', zIndex: 1 }} />
              <input value={busqueda} onChange={e => handleBusqueda(e.target.value)} onFocus={() => resultadosBusqueda.length && setMostrarResultados(true)} placeholder="Buscar estructura, progresiva..." />
              {busqueda && <button onClick={() => { setBusqueda(''); setResultadosBusqueda([]); setMostrarResultados(false); }} style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#475569', cursor: 'pointer' }}>✕</button>}
              {mostrarResultados && resultadosBusqueda.length > 0 && (
                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '0 0 6px 6px', maxHeight: '200px', overflowY: 'auto' }}>
                  {resultadosBusqueda.map((r, i) => (
                    <div key={i} onClick={() => seleccionarResultado(r)} style={{ padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid #0f172a', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px' }} onMouseEnter={e => { e.currentTarget.style.background = '#0f172a'; }} onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}>
                      {r.icon && <img src={r.icon} alt="" style={{ width: '18px', height: '18px' }} />}
                      <div style={{ flex: 1 }}><div style={{ fontWeight: 600, color: '#e2e8f0' }}>{r.name}</div><div style={{ color: '#475569', fontSize: '10px' }}>{r.tipo} · {r.progresiva}</div></div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Map controls */}
            <div className="dash-map-controls" style={{ top: '50px' }}>
              <button className="dash-map-btn" onClick={() => mapRef.current?.flyTo(centroMapa, 10, { duration: 1 })} title="Vista general"><FaGlobe /></button>
              <button className="dash-map-btn" onClick={() => setShowLayers(v => !v)} title="Capas" style={showLayers ? { borderColor: '#1463A5', color: '#1463A5' } : {}}><FaLayerGroup /></button>
              <button className="dash-map-btn" onClick={() => { navigator.geolocation.getCurrentPosition(p => setMiUbicacion([p.coords.latitude, p.coords.longitude])); }} title="Mi ubicación"><FaLocationArrow /></button>
            </div>

            {/* Layer panel */}
            {showLayers && (
              <div className="dash-layers" style={{ left: '50px' }}>
                <div className="dash-layers-header"><span>Capas</span><button onClick={() => setShowLayers(false)} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer' }}><FaTimes size={12} /></button></div>
                <div className="dash-layers-body">
                  <div className="dash-layer-group">
                    <div className="dash-layer-group-title">General</div>
                    <div className="dash-layer-item"><label><input type="checkbox" checked={capas.Canales} onChange={() => toggleCapa('Canales')} /> Trazado Canales</label></div>
                    <div className="dash-layer-item"><label><input type="checkbox" checked={capas.Incidentes_Atencion} onChange={() => { toggleCapa('Incidentes_Atencion'); toggleCapa('Incidentes_Nuevos'); }} /> Incidentes</label></div>
                    <div className="dash-layer-item"><label><input type="checkbox" checked={capas.Lluvias} onChange={() => toggleCapa('Lluvias')} /> Pluviómetros</label></div>
                    {(capas.Incidentes_Nuevos || capas.Incidentes_Atencion) && (
                      <select value={filtroTiempo} onChange={e => setFiltroTiempo(Number(e.target.value))} style={{ width: '100%', margin: '4px 0', background: '#f8fafc', color: '#626976', border: '1px solid #e2e8f0', borderRadius: '4px', padding: '3px 6px', fontSize: '10px' }}>
                        <option value={1}>24 horas</option><option value={7}>7 días</option><option value={30}>30 días</option><option value={0}>Todo</option>
                      </select>
                    )}
                  </div>
                  <div className="dash-layer-group">
                    <div className="dash-layer-group-title">Filtros</div>
                    <select value={filtroTramo} onChange={e => setFiltroTramo(e.target.value)} style={{ width: '100%', margin: '2px 0', background: '#f8fafc', color: '#626976', border: '1px solid #e2e8f0', borderRadius: '4px', padding: '3px 6px', fontSize: '10px' }}>
                      <option value="">Todos los tramos</option>{tramosUnicos.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                    <select value={filtroEstado} onChange={e => setFiltroEstado(e.target.value)} style={{ width: '100%', margin: '2px 0', background: '#f8fafc', color: '#626976', border: '1px solid #e2e8f0', borderRadius: '4px', padding: '3px 6px', fontSize: '10px' }}>
                      <option value="">Todo estado</option>{estadosUnicos.map(e2 => <option key={e2} value={e2}>{e2}</option>)}
                    </select>
                    {(filtroTramo || filtroEstado) && <button onClick={() => { setFiltroTramo(''); setFiltroEstado(''); }} style={{ background: 'none', border: 'none', color: '#1463A5', cursor: 'pointer', fontSize: '10px', padding: '2px 0' }}>✕ Limpiar</button>}
                  </div>
                  <div className="dash-layer-group">
                    <div className="dash-layer-group-title">Infraestructura ({totalKMZ})</div>
                    <div style={{ display: 'flex', gap: '4px', marginBottom: '6px' }}>
                      <button onClick={() => setCapasKMZ(Object.fromEntries(KMZ_CONFIG.map(c => [c.key, true])))} style={{ flex: 1, background: '#f8fafc', border: '1px solid #e2e8f0', color: '#1463A5', borderRadius: '4px', padding: '2px', fontSize: '10px', cursor: 'pointer' }}>Todas</button>
                      <button onClick={() => setCapasKMZ(KMZ_CAPAS_DEFAULT)} style={{ flex: 1, background: '#f8fafc', border: '1px solid #e2e8f0', color: '#64748b', borderRadius: '4px', padding: '2px', fontSize: '10px', cursor: 'pointer' }}>Ninguna</button>
                    </div>
                    {KMZ_CONFIG.map(c => (
                      <div key={c.key} className="dash-layer-item">
                        <label><input type="checkbox" checked={capasKMZ[c.key]} onChange={() => toggleCapaKMZ(c.key)} />
                          {c.icon ? <img src={c.icon} alt="" style={{ width: '14px', height: '14px' }} /> : <span style={{ display: 'inline-block', width: '14px', height: c.tipo === 'line' ? '3px' : '14px', background: c.color, borderRadius: c.tipo === 'line' ? '2px' : '50%' }} />}
                          <span style={{ fontSize: '11px' }}>{c.label}</span>
                        </label>
                        <span className="dash-layer-badge">{c.data?.features?.length || 0}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            <MapContainer center={centroMapa} zoom={10} style={{ height: '100%', width: '100%' }} ref={mapRef} zoomControl={false}>
              <ZoomDerecha />
              <TileLayer url={obtenerUrlMapa()} maxZoom={20} />
              <FlyToComp pos={miUbicacion || flyTarget} />
              <UTMDisplay />
              <MiniMapa tileUrl={obtenerUrlMapa()} />
              <HerramientaMedicion modo={herramienta === 'distancia' || herramienta === 'area' ? herramienta : null} onFinish={() => {}} />

              {miUbicacion && <Marker position={miUbicacion} icon={iconoGPS}><Popup>Mi ubicación</Popup></Marker>}
              {capas.Canales && <><GeoJSON data={geoCanalMadre} style={{ color: '#1463A5', weight: 3, opacity: 0.7 }} /><GeoJSON data={geoLateral10} style={{ color: '#1463A5', weight: 3, opacity: 0.7 }} /><GeoJSON data={geoRedes} style={{ color: '#1463A5', weight: 3, opacity: 0.7 }} /></>}

              {KMZ_CONFIG.map(cfg => {
                if (!capasKMZ[cfg.key]) return null;
                const data = getFilteredData(cfg);
                if (!data?.features?.length) return null;
                if (cfg.tipo === 'poly' || cfg.tipo === 'line') {
                  const st = cfg.tipo === 'line' ? () => ({ color: cfg.color, weight: 3, opacity: 0.8, dashArray: '8 4' }) : () => ({ color: cfg.color, weight: 2, opacity: 0.8, fillOpacity: 0.25, fillColor: cfg.color });
                  return <GeoJSON key={cfg.key + filtroTramo + filtroEstado} data={data} style={st} onEachFeature={(f, l) => { l.bindTooltip(f.properties?.name || '', { direction: 'top', className: 'tooltip-infra' }); l.bindPopup(buildPopup(f.properties, cfg.icon, cfg.label), { maxWidth: 320 }); }} />;
                }
                return <ClusteredLayer key={cfg.key + filtroTramo + filtroEstado} data={data} icon={cfg.icon} color={cfg.color} label={cfg.label} buildPopup={buildPopup} />;
              })}

              {(capas.Incidentes_Nuevos || capas.Incidentes_Atencion) && incFiltrados.map(inc => {
                if (!capas.Incidentes_Nuevos && inc.estado !== 'eat') return null;
                if (!capas.Incidentes_Atencion && inc.estado === 'eat') return null;
                const [bg, tx] = badge(inc.estado);
                return (
                  <Marker key={inc.id} position={[inc.lat, inc.lng]} icon={crearIconoIncidente(inc.gravedad)} eventHandlers={{ click: () => { cargarDetalleIncidente(inc.id); setIncSeleccionado(inc); setGrupoAbierto(null); } }}>
                    <Popup minWidth={260} maxWidth={300}>
                      <div style={{ fontFamily: 'system-ui', background: '#f8fafc', color: '#e2e8f0', borderRadius: '6px', padding: '10px', margin: '-14px -19px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #334155', paddingBottom: '6px', marginBottom: '8px' }}><b>{inc.tipo}</b><span className={`dash-badge dash-badge-${inc.estado === 'pat' ? 'orange' : inc.estado === 'ate' ? 'blue' : 'green'}`}>{tx}</span></div>
                        {cargandoDetalle ? <div style={{ textAlign: 'center', padding: '16px', color: '#1463A5' }}><FaSyncAlt className="icon-spin" /></div>
                        : detalleActivo && detalleActivo.id === inc.id ? (
                          <div style={{ display: 'flex', gap: '6px', overflowX: 'auto', marginBottom: '8px' }}>
                            {detalleActivo.images?.map((it, j) => { const s = it.content?.startsWith('http') ? it.content : `data:image/jpeg;base64,${it.content}`; return <div key={j} onClick={() => setModalMedia({ src: s, type: 'image' })} style={{ flexShrink: 0, cursor: 'pointer' }}><img src={s} alt="" style={{ width: '100px', height: '80px', objectFit: 'cover', borderRadius: '4px', border: '1px solid #e2e8f0' }} /></div>; })}
                          </div>
                        ) : inc.imagenUrl && <div onClick={() => setModalMedia({ src: inc.imagenUrl, type: 'image' })} style={{ cursor: 'pointer', marginBottom: '8px' }}><img src={inc.imagenUrl} alt="" style={{ width: '100%', height: '120px', objectFit: 'cover', borderRadius: '4px' }} /></div>}
                        <div style={{ fontSize: '11px', color: '#626976', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          <div style={{ fontSize:'10px', fontWeight:700, color:'#1463A5', background:'#eff6ff', border:'1px solid #bfdbfe', borderRadius:'4px', padding:'2px 6px', display:'inline-block', width:'fit-content' }}>{inc.codigoIncidente}</div>
                          <div><b style={{ color: '#1463A5' }}>{inc.codigo}</b> · {inc.lugar}</div>
                          <div style={{ background: '#f8fafc', padding: '6px', borderRadius: '4px' }}>{inc.descripcion || 'Sin descripción'}</div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', color: '#475569', fontSize: '10px' }}>👤 {inc.usuario} · 🕒 {inc.fecha}</div>
                        </div>
                      </div>
                    </Popup>
                  </Marker>
                );
              })}

              {capas.Lluvias && lluviasAPI.map(p => <Marker key={p.id} position={[p.lat, p.lng]} icon={crearIconoLluvia(p.totalRain, p.isCritical)}><Popup><b style={{ color: '#e2e8f0' }}>{p.name}</b></Popup></Marker>)}
            </MapContainer>
          </div>
        </div>

        {/* ── Charts Column ───────────────────────────────────────────── */}
        <div className="dash-charts-col">
          <div className="dash-panel" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div className="dash-panel-title" style={{ display:'flex', alignItems:'center', gap:'8px' }}>
              <span className="accent">📋</span> {incSeleccionado ? 'Recursos del Incidente' : 'Recursos Utilizados'}
              <button onClick={() => setModalReporteRec(true)} disabled={recursosGlobales.total === 0}
                title="Descargar reporte de recursos"
                style={{ marginLeft:'auto', display:'inline-flex', alignItems:'center', gap:'5px', background:'#e0f2fe', color:'#0284c7', border:'none', borderRadius:'6px', padding:'4px 10px', fontSize:'11px', fontWeight:600, cursor:'pointer', opacity: recursosGlobales.total === 0 ? 0.45 : 1 }}>
                <FaDownload size={10} /> Reporte
              </button>
            </div>
            {incSeleccionado && (
              <div style={{ background: '#f0f6ff', border: '1px solid #bfdbfe', borderRadius: '6px', padding: '8px 10px', marginBottom: '8px', flexShrink: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '6px' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: '12px', color: '#1d273b' }}>{incSeleccionado.tipo}</div>
                    <div style={{ fontSize:'9px', fontWeight:700, color:'#1463A5', marginBottom:'2px' }}>{incSeleccionado.codigoIncidente}</div>
                    <div style={{ fontSize: '10px', color: '#626976', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{incSeleccionado.codigo} · {incSeleccionado.lugar}</div>
                    <div style={{ fontSize: '9px', color: '#94a3b8', marginTop: '2px' }}>🕒 {incSeleccionado.fecha}</div>
                  </div>
                  <button onClick={() => { setIncSeleccionado(null); setGrupoAbierto(null); }} style={{ background: '#fff', border: '1px solid #cbd5e1', color: '#626976', borderRadius: '4px', padding: '3px 8px', fontSize: '10px', cursor: 'pointer', whiteSpace: 'nowrap', fontWeight: 600 }} title="Ver todos los recursos">✕ Ver todos</button>
                </div>
              </div>
            )}
            <div style={{ overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {/* ── PERSONAL ─────────────────────────────────────────── */}
              <div style={{ background: grupoAbierto === 'personal' ? '#eff6ff' : '#f8fafc', borderRadius: '6px', border: `1px solid ${grupoAbierto === 'personal' ? '#bfdbfe' : '#e2e8f0'}`, overflow: 'hidden' }}>
                <div onClick={() => setGrupoAbierto(grupoAbierto === 'personal' ? null : 'personal')} style={{ padding: '10px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ color: '#626976', fontSize: '9px' }}>{grupoAbierto === 'personal' ? '▼' : '▶'}</span>
                  <span style={{ fontSize: '16px' }}>👷</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: '12px', color: '#1d273b' }}>Personal</div>
                    <div style={{ fontSize: '10px', color: '#626976' }}>{recursosGlobales.listaPers.length} cargo{recursosGlobales.listaPers.length !== 1 ? 's' : ''}</div>
                  </div>
                  <span style={{ fontSize: '13px', fontWeight: 700, color: '#1463A5' }}>S/ {fmtNum(recursosGlobales.totPers)}</span>
                </div>
                {grupoAbierto === 'personal' && (
                  <div style={{ padding: '0 12px 10px', borderTop: '1px dashed #cbd5e1', paddingTop: '8px' }}>
                    {recursosGlobales.listaPers.length === 0 ? <div style={{ fontSize: '10px', color: '#94a3b8', fontStyle: 'italic' }}>Sin personal registrado</div> : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        {recursosGlobales.listaPers.map((p, i) => (
                          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px', background: '#fff', padding: '5px 8px', borderRadius: '4px' }}>
                            <span style={{ fontWeight: 600, color: '#1d273b', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.nombre}</span>
                            <span style={{ color: '#626976', fontSize: '10px', whiteSpace: 'nowrap' }}>{p.horas.toFixed(1)} HH</span>
                            <span style={{ fontWeight: 700, color: '#1463A5', fontSize: '11px', whiteSpace: 'nowrap' }}>S/ {fmtNum(p.monto)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* ── MAQUINARIA ───────────────────────────────────────── */}
              <div style={{ background: grupoAbierto === 'maquinaria' ? '#fffbeb' : '#f8fafc', borderRadius: '6px', border: `1px solid ${grupoAbierto === 'maquinaria' ? '#fde68a' : '#e2e8f0'}`, overflow: 'hidden' }}>
                <div onClick={() => setGrupoAbierto(grupoAbierto === 'maquinaria' ? null : 'maquinaria')} style={{ padding: '10px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ color: '#626976', fontSize: '9px' }}>{grupoAbierto === 'maquinaria' ? '▼' : '▶'}</span>
                  <span style={{ fontSize: '16px' }}>🚜</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: '12px', color: '#1d273b' }}>Maquinaria</div>
                    <div style={{ fontSize: '10px', color: '#626976' }}>
                      {recursosGlobales.listaMaqs.length} equipo{recursosGlobales.listaMaqs.length !== 1 ? 's' : ''}
                      {recursosGlobales.enUso > 0 && <span style={{ color: '#16a34a', fontWeight: 600 }}> · 🟢 {recursosGlobales.enUso} en uso</span>}
                    </div>
                  </div>
                  <span style={{ fontSize: '13px', fontWeight: 700, color: '#b45309' }}>S/ {fmtNum(recursosGlobales.totMaqs)}</span>
                </div>
                {grupoAbierto === 'maquinaria' && (
                  <div style={{ padding: '0 12px 10px', borderTop: '1px dashed #cbd5e1', paddingTop: '8px' }}>
                    {recursosGlobales.listaMaqs.length === 0 ? <div style={{ fontSize: '10px', color: '#94a3b8', fontStyle: 'italic' }}>Sin maquinaria registrada</div> : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        {recursosGlobales.listaMaqs.map((m, i) => (
                          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', background: '#fff', padding: '5px 8px', borderRadius: '4px' }}>
                            <span style={{ background: m.enUso ? '#dcfce7' : '#f1f5f9', color: m.enUso ? '#16a34a' : '#626976', padding: '1px 5px', borderRadius: '3px', fontWeight: 600, fontSize: '9px', whiteSpace: 'nowrap' }}>{m.enUso ? '🟢 En uso' : '✅ Disp.'}</span>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontWeight: 600, color: '#1d273b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.nombre}</div>
                              <div style={{ fontSize: '9px', color: '#626976', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.marca} {m.placa}</div>
                            </div>
                            <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                              <div style={{ fontSize: '10px', color: '#626976' }}>{m.horas.toFixed(1)} HE</div>
                              <div style={{ fontWeight: 700, color: '#b45309', fontSize: '11px' }}>S/ {fmtNum(m.monto)}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* ── INSUMOS ──────────────────────────────────────────── */}
              <div style={{ background: grupoAbierto === 'insumos' ? '#ecfdf5' : '#f8fafc', borderRadius: '6px', border: `1px solid ${grupoAbierto === 'insumos' ? '#a7f3d0' : '#e2e8f0'}`, overflow: 'hidden' }}>
                <div onClick={() => setGrupoAbierto(grupoAbierto === 'insumos' ? null : 'insumos')} style={{ padding: '10px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ color: '#626976', fontSize: '9px' }}>{grupoAbierto === 'insumos' ? '▼' : '▶'}</span>
                  <span style={{ fontSize: '16px' }}>📦</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: '12px', color: '#1d273b' }}>Insumos</div>
                    <div style={{ fontSize: '10px', color: '#626976' }}>{recursosGlobales.listaMats.length} ítem{recursosGlobales.listaMats.length !== 1 ? 's' : ''}</div>
                  </div>
                  <span style={{ fontSize: '13px', fontWeight: 700, color: '#047857' }}>S/ {fmtNum(recursosGlobales.totMats)}</span>
                </div>
                {grupoAbierto === 'insumos' && (
                  <div style={{ padding: '0 12px 10px', borderTop: '1px dashed #cbd5e1', paddingTop: '8px' }}>
                    {recursosGlobales.listaMats.length === 0 ? <div style={{ fontSize: '10px', color: '#94a3b8', fontStyle: 'italic' }}>Sin insumos registrados</div> : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        {recursosGlobales.listaMats.map((m, i) => (
                          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px', background: '#fff', padding: '5px 8px', borderRadius: '4px' }}>
                            <span style={{ fontWeight: 600, color: '#1d273b', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.nombre}</span>
                            <span style={{ color: '#626976', fontSize: '10px', whiteSpace: 'nowrap' }}>{m.cantidad.toFixed(1)} u</span>
                            <span style={{ fontWeight: 700, color: '#047857', fontSize: '11px', whiteSpace: 'nowrap' }}>S/ {fmtNum(m.monto)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* ── TOTAL ────────────────────────────────────────────── */}
              <div style={{ background: '#f0f6ff', border: '1px solid #bfdbfe', borderRadius: '6px', padding: '10px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'auto' }}>
                <span style={{ fontSize: '11px', fontWeight: 700, color: '#626976', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Costo Total</span>
                <span style={{ fontSize: '16px', fontWeight: 700, color: '#1463A5' }}>S/ {fmtNum(recursosGlobales.total)}</span>
              </div>
            </div>
          </div>
          <div className="dash-panel">
            <div className="dash-panel-title"><span className="accent">🏗️</span> Infraestructura por Tipo</div>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={porTipoInfra} layout="vertical"><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" /><XAxis type="number" tick={{ fontSize: 10 }} stroke="#cbd5e1" /><YAxis type="category" dataKey="name" tick={{ fontSize: 9 }} stroke="#cbd5e1" width={90} /><Tooltip contentStyle={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '6px', fontSize: '11px' }} /><Bar dataKey="value" radius={[0, 4, 4, 0]} maxBarSize={16}>{porTipoInfra.map((d, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}</Bar></BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* ── Footer ───────────────────────────────────────────────────── */}
      <div className="dash-footer">
        <span><span className="dot" /> Sistema Activo</span>
        <span>Última actualización: {new Date().toLocaleString('es-PE')}</span>
        <span style={{ marginLeft: 'auto' }}>Sistema Integrado de Monitoreo — JURP</span>
      </div>

      {/* ── Modal ────────────────────────────────────────────────────── */}
      {modalMedia && (
        <div onClick={() => setModalMedia(null)} style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.92)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'zoom-out' }}>
          <button onClick={() => setModalMedia(null)} style={{ position: 'absolute', top: '16px', right: '20px', background: 'rgba(255,255,255,0.1)', border: 'none', color: '#fff', fontSize: '20px', cursor: 'pointer', borderRadius: '50%', width: '36px', height: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
          {modalMedia.type === 'image' ? <img src={modalMedia.src} alt="" onClick={e => e.stopPropagation()} style={{ maxWidth: '90vw', maxHeight: '90vh', objectFit: 'contain', borderRadius: '8px' }} />
          : <video src={modalMedia.src} onClick={e => e.stopPropagation()} controls autoPlay style={{ maxWidth: '90vw', maxHeight: '90vh', borderRadius: '8px', background: '#000' }} />}
        </div>
      )}

      {/* ── Modal: formato del reporte de recursos ─────────────────────── */}
      {modalReporteRec && (
        <div onClick={() => !generandoRec && setModalReporteRec(false)}
          style={{ position:'fixed', inset:0, zIndex:10002, background:'rgba(0,0,0,0.6)', display:'flex', alignItems:'center', justifyContent:'center', padding:'16px' }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background:'#fff', borderRadius:'12px', width:'100%', maxWidth:'420px', overflow:'hidden', boxShadow:'0 20px 40px rgba(0,0,0,0.25)' }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'14px 18px', borderBottom:'1px solid #e2e8f0', background:'#f8fafc' }}>
              <h5 style={{ margin:0, fontSize:'15px', color:'#1e293b', display:'flex', alignItems:'center', gap:'8px' }}>
                📋 Reporte de Recursos
              </h5>
              <button onClick={() => !generandoRec && setModalReporteRec(false)} disabled={generandoRec}
                style={{ background:'none', border:'none', cursor:'pointer', color:'#64748b', fontSize:'17px', display:'flex' }}>
                <FaTimes />
              </button>
            </div>
            <div style={{ padding:'18px' }}>
              <p style={{ margin:'0 0 6px', fontSize:'13px', color:'#334155' }}>
                {incSeleccionado
                  ? <>Recursos de <b>{incSeleccionado.codigoIncidente || incSeleccionado.tipo}</b>.</>
                  : <>Recursos de <b>todas las incidencias</b>.</>}
              </p>
              <p style={{ margin:'0 0 14px', fontSize:'12px', color:'#64748b' }}>
                {recursosGlobales.listaPers.length} cargo(s) · {recursosGlobales.listaMaqs.length} equipo(s) · {recursosGlobales.listaMats.length} insumo(s)
                <br />Costo total: <b style={{ color:'#1463A5' }}>S/ {nf(recursosGlobales.total)}</b>
              </p>
              {generandoRec ? (
                <div style={{ textAlign:'center', padding:'20px 0' }}>
                  <FaSyncAlt className="icon-spin" style={{ fontSize:'24px', color:'#0ea5e9' }} />
                  <p style={{ fontSize:'13px', color:'#64748b', marginTop:'8px' }}>Generando…</p>
                </div>
              ) : (
                <div style={{ display:'flex', gap:'10px' }}>
                  <button onClick={reporteRecursosPDF}
                    style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', gap:'6px', padding:'16px 10px', background:'#fef2f2', color:'#b91c1c', border:'2px solid #fecaca', borderRadius:'10px', cursor:'pointer', fontSize:'13px', fontWeight:700 }}>
                    <FaFilePdf size={24} /> PDF
                  </button>
                  <button onClick={reporteRecursosExcel}
                    style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', gap:'6px', padding:'16px 10px', background:'#f0fdf4', color:'#15803d', border:'2px solid #bbf7d0', borderRadius:'10px', cursor:'pointer', fontSize:'13px', fontWeight:700 }}>
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