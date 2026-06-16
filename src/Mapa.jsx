import { useState, useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, GeoJSON, useMap } from 'react-leaflet';
import L, { divIcon } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { 
  FaCloudShowersHeavy, FaExclamationTriangle, FaLocationArrow, 
  FaCheck, FaTimes, FaChevronLeft, FaChevronRight, FaGlobe, FaSyncAlt 
} from 'react-icons/fa';

import geoCanalMadre from './data/Canal_Madre.json';
import geoLateral10 from './data/Lateral_10.json';
import geoRedes from './data/Redes_Presurizado.json';
import logo from './assets/logo1.png';

// ── KMZ layers (convertidos a GeoJSON) ──────────────────────────────────────
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

// ── Configuración de capas KMZ ──────────────────────────────────────────────
const KMZ_CONFIG = [
  // Canales / polígonos
  { key: 'KMZ_CanalMadre',       label: 'Canal Madre',        color: '#1971c2', data: kmzCanalMadre,       tipo: 'poly' },
  { key: 'KMZ_Lateral10',        label: 'Lateral 10',         color: '#4dabf7', data: kmzLateral10,        tipo: 'poly' },
  { key: 'KMZ_RedesPresurizado', label: 'Redes Presurizado',  color: '#74c0fc', data: kmzRedesPresurizado, tipo: 'poly' },
  { key: 'KMZ_Evacuador',        label: 'Evacuador',          color: '#a5d8ff', data: kmzEvacuador,        tipo: 'poly' },
  // Puntos
  { key: 'KMZ_Bocatoma',         label: 'Bocatoma',           color: '#206bc4', data: kmzBocatoma,         tipo: 'point' },
  { key: 'KMZ_Entrega',          label: 'Entrega',            color: '#2f9e44', data: kmzEntrega,          tipo: 'point' },
  { key: 'KMZ_Toma',             label: 'Toma',               color: '#f59f00', data: kmzToma,             tipo: 'point' },
  { key: 'KMZ_Canoa',            label: 'Canoa',              color: '#f76707', data: kmzCanoa,            tipo: 'point' },
  { key: 'KMZ_Alcantarilla',     label: 'Alcantarilla',       color: '#7048e8', data: kmzAlcantarilla,     tipo: 'point' },
  { key: 'KMZ_PuenteVehicular',  label: 'Puente Vehicular',   color: '#8a6d3b', data: kmzPuenteVehicular,  tipo: 'point' },
  { key: 'KMZ_PuentePeatonal',   label: 'Puente Peatonal',    color: '#e8590c', data: kmzPuentePeatonal,   tipo: 'point' },
  { key: 'KMZ_Aliviadero',       label: 'Aliviadero',         color: '#c92a2a', data: kmzAliviadero,       tipo: 'point' },
  { key: 'KMZ_CajaHidraulica',   label: 'Caja Hidráulica',    color: '#495057', data: kmzCajaHidraulica,   tipo: 'point' },
  { key: 'KMZ_Desarenador',      label: 'Desarenador',        color: '#a0522d', data: kmzDesarenador,      tipo: 'point' },
  { key: 'KMZ_EstacionControl',  label: 'Estación Control',   color: '#fd7e14', data: kmzEstacionControl,  tipo: 'point' },
  { key: 'KMZ_Partidor',         label: 'Partidor',           color: '#9c36b5', data: kmzPartidor,         tipo: 'point' },
  { key: 'KMZ_PaseTuberias',     label: 'Pase Tuberías',      color: '#5c7cfa', data: kmzPaseTuberias,     tipo: 'point' },
  { key: 'KMZ_CamaraRP',         label: 'Cámara Rompepresión',color: '#e67700', data: kmzCamaraRP,         tipo: 'point' },
  { key: 'KMZ_Rapida',           label: 'Rápida',             color: '#f03e3e', data: kmzRapida,           tipo: 'point' },
];

const KMZ_CAPAS_DEFAULT = Object.fromEntries(KMZ_CONFIG.map(c => [c.key, false]));

function BotonEncuadreGeneral({ centro }) {
  const map = useMap();
  return (
    <div className="leaflet-top leaflet-left" style={{ top: '80px', left: '10px', position: 'absolute', zIndex: 1000 }}>
      <div className="leaflet-control leaflet-bar">
        <a href="#" role="button" title="Centrar todo el mapa" 
          onClick={(e) => { e.preventDefault(); map.flyTo(centro, 10, { animate: true, duration: 1.5 }); }} 
          style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', fontSize: '18px', width: '34px', height: '34px', backgroundColor: '#fff', color: '#206bc4' }}>
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

function MapaChavimochic() {
  const centroMapa = [-8.4186, -78.7533]; 
  const [leyendaExpandida, setLeyendaExpandida] = useState(true);
  const [mapaBase, setMapaBase] = useState('satelite');
  const [filtroTiempo, setFiltroTiempo] = useState(30);
  const [seccionKMZ, setSeccionKMZ] = useState(false);
  
  const [capas, setCapas] = useState({ Incidentes_Nuevos: true, Incidentes_Atencion: true, Lluvias: true, Canales: true });
  const [capasKMZ, setCapasKMZ] = useState(KMZ_CAPAS_DEFAULT);
  const [incidentesAPI, setIncidentesAPI] = useState([]);
  const [lluviasAPI, setLluviasAPI] = useState([]); 
  const [cargandoAPIs, setCargandoAPIs] = useState(false);
  const [miUbicacion, setMiUbicacion] = useState(null);
  const [buscandoGPS, setBuscandoGPS] = useState(false);
  const [detalleActivo, setDetalleActivo] = useState(null);
  const [cargandoDetalle, setCargandoDetalle] = useState(false);

  const totalKMZ = KMZ_CONFIG.reduce((acc, c) => acc + (c.data?.features?.length || 0), 0);
  const activasKMZ = KMZ_CONFIG.filter(c => capasKMZ[c.key]).length;

  const obtenerDatosDeApis = async () => {
    const token = localStorage.getItem('userToken');
    if (!token) return;
    setCargandoAPIs(true);
    try {
      const resInc = await fetch('/api/v1/mobile/hi-incidents/list/', { headers: { 'Content-Type': 'application/json', 'Authorization': `Token ${token}` } });
      if (resInc.ok) {
        const dataInc = await resInc.json();
        const tiposMapa = { '1': 'Deslizamiento', '2': 'Obstrucción', '3': 'Falla Mecánica', '4': 'Robo', '5': 'Daño Estructural', '6': 'Otro' };
        const incidentesMapeados = (dataInc.results || []).map(inc => {
          const lat = parseFloat(inc.latitude_marker || inc.latitude);
          const lng = parseFloat(inc.longitude_marker || inc.longitude);
          let tipoNombre = tiposMapa[inc.type?.toString()] || 'Incidente';
          const anotherTypeStr = inc.another_type || inc.location_text;
          if (anotherTypeStr && (tipoNombre === 'Otro' || tipoNombre === 'Otros')) tipoNombre = `Otro (${anotherTypeStr.trim()})`;
          return { 
            id: inc.id, lat, lng, tipo: tipoNombre, estado: inc.status || 'pat', 
            gravedad: inc.severity || 'lev', descripcion: inc.description || 'Sin descripción.', 
            usuario: inc.user?.username || inc.username || 'Usuario', lugar: inc.location_text || 'Coordenada de Campo', 
            fecha: new Date(inc.created_at).toLocaleString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute:'2-digit' }),
            timestamp: new Date(inc.created_at).getTime(), 
            imagenUrl: inc.thumbnail || inc.image || null,
            codigo: inc.code || 'Sin Código'
          };
        }).filter(inc => !isNaN(inc.lat) && !isNaN(inc.lng) && inc.lat !== 0 && inc.lng !== 0);
        setIncidentesAPI(incidentesMapeados);
      }

      const resDevices = await fetch('/api/v1/mobile/devices/?device_type=pluviometro', { headers: { 'Content-Type': 'application/json', 'Authorization': `Token ${token}` } });
      if (resDevices.ok) {
        const devicesData = await resDevices.json();
        const pluviometros = devicesData.results || [];
        const now = new Date(); const past24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        const formatoFecha = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        const nuevaDataLluvia = [];
        for (let equipo of pluviometros) {
          const lat = parseFloat(equipo.latitude); const lng = parseFloat(equipo.longitude);
          if (isNaN(lat) || isNaN(lng)) continue;
          let totalRain = 0.0;
          try {
            const resRain = await fetch(`/api/v1/mobile/davis/rain-gauges/filtered-data/?start_date=${formatoFecha(past24h)}&end_date=${formatoFecha(now)}&station_id=${equipo.id}&metric=rainfall_mm`, { headers: { 'Content-Type': 'application/json', 'Authorization': `Token ${token}` } });
            if (resRain.ok) { const rainData = await resRain.json(); for (let record of (rainData.data || [])) totalRain += parseFloat(record.value) || 0.0; }
          } catch (e) { console.error(e); }
          nuevaDataLluvia.push({ id: equipo.id, name: equipo.nombre || "Pluviómetro", lat, lng, totalRain, isCritical: totalRain > 20.0 });
        }
        setLluviasAPI(nuevaDataLluvia);
      }
    } catch (error) { console.error(error); } finally { setCargandoAPIs(false); }
  };

  useEffect(() => { obtenerDatosDeApis(); }, []);

  const cargarDetalleIncidente = async (id) => {
    setDetalleActivo(null);
    setCargandoDetalle(true);
    const token = localStorage.getItem('userToken');
    try {
      const res = await fetch(`/api/v1/mobile/hi-incidents/${id}/`, { headers: { 'Authorization': `Token ${token}`, 'Content-Type': 'application/json' } });
      if (res.ok) { const data = await res.json(); setDetalleActivo(data); }
    } catch (error) { console.error("Error al cargar detalle:", error); } finally { setCargandoDetalle(false); }
  };

  const toggleCapa = (nombreCapa) => { setCapas(prev => ({ ...prev, [nombreCapa]: !prev[nombreCapa] })); };
  const toggleCapaKMZ = (key) => { setCapasKMZ(prev => ({ ...prev, [key]: !prev[key] })); };
  const activarTodasKMZ = () => setCapasKMZ(Object.fromEntries(KMZ_CONFIG.map(c => [c.key, true])));
  const desactivarTodasKMZ = () => setCapasKMZ(KMZ_CAPAS_DEFAULT);

  const obtenerMiUbicacion = () => {
    setBuscandoGPS(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => { setMiUbicacion([pos.coords.latitude, pos.coords.longitude]); setBuscandoGPS(false); },
      () => { alert("Error GPS. Verifica los permisos de tu navegador."); setBuscandoGPS(false); }, { enableHighAccuracy: true }
    );
  };

  const obtenerUrlMapa = () => {
    switch (mapaBase) {
      case 'calles': return "https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}";
      case 'topografico': return "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png";
      case 'oscuro': return "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";
      case 'satelite':
      default: return "https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}";
    }
  };

  const crearIconoIncidente = (gravedad) => {
    let colorCentro = '#f59f00'; let colorBorde = '#e67e22'; 
    if (gravedad === 'mod') { colorCentro = '#f76707'; colorBorde = '#d9480f'; } 
    if (gravedad === 'gra') { colorCentro = '#d63939'; colorBorde = '#c92a2a'; } 
    return divIcon({ className: 'icono-vacio', html: `<div style="position: relative; width: 20px; height: 20px;"><div style="position: absolute; top: 0; left: 0; width: 20px; height: 20px; background-color: ${colorCentro}; opacity: 0.4; border-radius: 50%; animation: pulse 1.5s infinite;"></div><div style="position: absolute; top: 4px; left: 4px; width: 12px; height: 12px; background-color: ${colorCentro}; border: 2px solid ${colorBorde}; border-radius: 50%; box-shadow: 0 2px 4px rgba(0,0,0,0.4);"></div></div>`, iconSize: [20, 20], iconAnchor: [10, 10] });
  };

  const estiloCanales = { color: '#206bc4', weight: 4, opacity: 0.8 }; 

  const crearEstiloKMZ = (color) => ({ color, weight: 2, opacity: 0.85, fillOpacity: 0.3, fillColor: color });

  const crearIconoKMZ = (color) => divIcon({ 
    className: 'icono-vacio', 
    html: `<div style="background-color:${color}; border: 2px solid white; width: 10px; height: 10px; border-radius: 50%; box-shadow: 0 1px 3px rgba(0,0,0,0.4);"></div>`, 
    iconSize: [14, 14], iconAnchor: [7, 7] 
  });

  const iconoGPS = divIcon({ className: 'icono-vacio', html: `<div style="background-color: #206bc4; border: 3px solid white; width: 16px; height: 16px; border-radius: 50%; box-shadow: 0 0 10px rgba(0,0,0,0.5);"></div>`, iconSize: [22, 22], iconAnchor: [11, 11] });
  const crearIconoLluvia = (totalRain, isCritical) => divIcon({ className: 'icono-vacio', html: `<div style="display: flex; flex-direction: column; align-items: center; margin-top: -30px;"><div style="background: white; border: 1px solid ${isCritical ? '#d63939' : '#206bc4'}; color: ${isCritical ? '#d63939' : '#206bc4'}; font-size: 11px; font-weight: 700; padding: 2px 6px; border-radius: 4px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); white-space: nowrap;">${totalRain.toFixed(1)} mm</div><div style="font-size: 26px; color: ${isCritical ? '#d63939' : '#206bc4'}; line-height: 1; margin-top: 2px;">🌧️</div></div>`, iconSize: [60, 60], iconAnchor: [30, 45] });

  const getEstadoBadgeMap = (estado) => {
    switch (estado) {
      case 'pat': return <span style={{backgroundColor:'#f59f00', color:'#fff', padding:'2px 6px', borderRadius:'4px', fontSize:'10px', fontWeight:'bold'}}>Pendiente</span>;
      case 'ate': return <span style={{backgroundColor:'#206bc4', color:'#fff', padding:'2px 6px', borderRadius:'4px', fontSize:'10px', fontWeight:'bold'}}>En Atención</span>;
      case 'cer': return <span style={{backgroundColor:'#2fb344', color:'#fff', padding:'2px 6px', borderRadius:'4px', fontSize:'10px', fontWeight:'bold'}}>Cerrado</span>;
      default: return <span style={{backgroundColor:'#6c7a89', color:'#fff', padding:'2px 6px', borderRadius:'4px', fontSize:'10px'}}>{estado}</span>;
    }
  };

  const tiempoLimite = Date.now() - (filtroTiempo * 24 * 60 * 60 * 1000);
  const incidentesFiltrados = filtroTiempo === 0 ? incidentesAPI : incidentesAPI.filter(inc => inc.timestamp >= tiempoLimite);

  return (
    <div style={{ height: '100%', width: '100%', position: 'relative' }}>
      <MapContainer center={centroMapa} zoom={10} style={{ height: '100%', width: '100%', zIndex: 0 }}>
        <TileLayer url={obtenerUrlMapa()} maxZoom={20} attribution="&copy; JURP Maps" />
        <VolarAUbicacion posicion={miUbicacion} />
        <BotonEncuadreGeneral centro={centroMapa} />
        
        {miUbicacion && <Marker position={miUbicacion} icon={iconoGPS}><Popup>Estás aquí</Popup></Marker>}

        {/* Trazado de canales (datos originales) */}
        {capas.Canales && <><GeoJSON data={geoCanalMadre} style={estiloCanales} /><GeoJSON data={geoLateral10} style={estiloCanales} /><GeoJSON data={geoRedes} style={estiloCanales} /></>}

        {/* ── Capas KMZ ─────────────────────────────────────────────────────── */}
        {KMZ_CONFIG.map(cfg => {
          if (!capasKMZ[cfg.key] || !cfg.data?.features?.length) return null;
          if (cfg.tipo === 'poly') {
            return (
              <GeoJSON key={cfg.key} data={cfg.data} style={() => crearEstiloKMZ(cfg.color)}
                onEachFeature={(feature, layer) => {
                  if (feature.properties?.name) layer.bindPopup(`<b>${feature.properties.name}</b><br/><small>${cfg.label}</small>`);
                }}
              />
            );
          } else {
            const soloPoints = { ...cfg.data, features: cfg.data.features.filter(f => f.geometry?.type === 'Point') };
            if (!soloPoints.features.length) return null;
            return (
              <GeoJSON key={cfg.key} data={soloPoints}
                pointToLayer={(feature, latlng) => L.marker(latlng, { icon: crearIconoKMZ(cfg.color) })}
                onEachFeature={(feature, layer) => {
                  if (feature.properties?.name) layer.bindPopup(`<b>${feature.properties.name}</b><br/><small>${cfg.label}</small>`);
                }}
              />
            );
          }
        })}

        {/* Incidentes */}
        {(capas.Incidentes_Nuevos || capas.Incidentes_Atencion) && incidentesFiltrados.map(inc => {
          if (!capas.Incidentes_Nuevos && inc.estado !== 'eat') return null;
          if (!capas.Incidentes_Atencion && inc.estado === 'eat') return null;
          return (
            <Marker key={inc.id} position={[inc.lat, inc.lng]} icon={crearIconoIncidente(inc.gravedad)}
              eventHandlers={{ click: () => cargarDetalleIncidente(inc.id) }}>
              <Popup minWidth={280} maxWidth={320} className="popup-incidente-custom">
                <div style={{ padding: '2px', fontFamily: 'system-ui, sans-serif' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #e2e8f0', paddingBottom: '6px', marginBottom: '8px' }}>
                    <h4 style={{ margin: 0, color: '#1d273b', fontSize: '15px', fontWeight: 'bold' }}>{inc.tipo}</h4>
                    {getEstadoBadgeMap(inc.estado)}
                  </div>
                  {cargandoDetalle ? (
                    <div style={{ textAlign: 'center', padding: '20px 0', color: '#206bc4' }}>
                      <FaSyncAlt className="icon-spin" /> <span style={{fontSize: '12px', marginLeft: '5px'}}>Cargando evidencia...</span>
                    </div>
                  ) : detalleActivo && detalleActivo.id === inc.id ? (
                    <div style={{ display: 'flex', overflowX: 'auto', gap: '8px', paddingBottom: '8px', marginBottom: '8px' }}>
                      {detalleActivo.images && detalleActivo.images.map((item, idx) => (
                        <a key={`img-${idx}`} href={item.image} target="_blank" rel="noopener noreferrer" style={{flexShrink: 0}}>
                          <img src={item.image} alt="Evidencia" style={{ width: '120px', height: '100px', objectFit: 'cover', borderRadius: '4px', border: '1px solid #e2e8f0' }} />
                        </a>
                      ))}
                      {detalleActivo.videos && detalleActivo.videos.map((item, idx) => (
                        <div key={`vid-${idx}`} style={{flexShrink: 0, width: '150px', height: '100px'}}>
                          <video src={item.video} style={{ width: '150px', height: '100px', objectFit: 'cover', borderRadius: '4px', border: '1px solid #e2e8f0', backgroundColor: '#000' }} controls preload="metadata" />
                        </div>
                      ))}
                      {(!detalleActivo.images?.length && !detalleActivo.videos?.length && inc.imagenUrl) && (
                        <img src={inc.imagenUrl} alt="Evidencia" style={{ width: '100%', height: '140px', objectFit: 'cover', borderRadius: '6px' }} />
                      )}
                    </div>
                  ) : (
                    inc.imagenUrl && (
                      <div style={{ width: '100%', height: '140px', overflow: 'hidden', borderRadius: '6px', marginBottom: '10px', backgroundColor: '#f8fafc', border: '1px solid #e2e8f0' }}>
                        <img src={inc.imagenUrl} alt="Evidencia" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      </div>
                    )
                  )}
                  <div style={{ fontSize: '12px', color: '#475569', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <div><strong>Código:</strong> <span style={{color: '#206bc4', fontWeight: 'bold'}}>{inc.codigo}</span></div>
                    <div><strong>Ubicación:</strong> {inc.lugar}</div>
                    <div style={{ backgroundColor: '#f1f5f9', padding: '8px', borderRadius: '4px', border: '1px solid #e2e8f0', maxHeight: '100px', overflowY: 'auto' }}>
                      <strong style={{color: '#1e293b'}}>Descripción del reporte:</strong><br/>
                      <span style={{color: '#334155', lineHeight: '1.4', display: 'block', marginTop: '4px'}}>{inc.descripcion}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px dashed #cbd5e1', paddingTop: '8px', marginTop: '2px', fontSize: '11px' }}>
                      <span title="Reportado por">👤 <b>{inc.usuario}</b></span>
                      <span title="Fecha y Hora">🕒 {inc.fecha}</span>
                    </div>
                  </div>
                </div>
              </Popup>
            </Marker>
          );
        })}

        {capas.Lluvias && lluviasAPI.map(pluv => <Marker key={pluv.id} position={[pluv.lat, pluv.lng]} icon={crearIconoLluvia(pluv.totalRain, pluv.isCritical)}><Popup><b>{pluv.name}</b></Popup></Marker>)}
      </MapContainer>

      {/* ── Panel de Control ─────────────────────────────────────────────── */}
      <div className={`panel-control-avanzado ${leyendaExpandida ? '' : 'colapsado'}`}>
        <div className="pca-cabecera">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <img src={logo} alt="Logo" style={{ height: '30px', width: 'auto' }} />
            {leyendaExpandida && <span style={{ color: '#1d273b', fontWeight: '600', fontSize: '0.875rem' }}>Panel de Control</span>}
          </div>
          <button className="pca-btn-icon" onClick={() => setLeyendaExpandida(!leyendaExpandida)}>
            {leyendaExpandida ? <FaChevronLeft size={10} /> : <FaChevronRight size={10} />}
          </button>
        </div>

        {leyendaExpandida && (
          <div className="pca-cuerpo">
            <div className="pca-seccion">
              <div className="pca-label">Mapa Base</div>
              <select className="pca-select" value={mapaBase} onChange={e => setMapaBase(e.target.value)}>
                <option value="satelite">Google Satélite</option>
                <option value="calles">Google Calles</option>
                <option value="topografico">Topográfico (Relieve)</option>
                <option value="oscuro">Modo Oscuro</option>
              </select>
            </div>

            <hr className="pca-divider" style={{ marginTop: '15px' }} />
            <div className="pca-switches">
              <label className="pca-switch-row"><div className="pca-switch-container"><input type="checkbox" checked={capas.Canales} onChange={() => toggleCapa('Canales')} /><span className="pca-slider-round"></span></div><div style={{ width: '12px', height: '12px', borderRadius: '50%', backgroundColor: '#206bc4' }}></div><span>Trazado de Canales</span></label>
              <label className="pca-switch-row"><div className="pca-switch-container"><input type="checkbox" checked={capas.Incidentes_Atencion} onChange={() => { toggleCapa('Incidentes_Atencion'); toggleCapa('Incidentes_Nuevos'); }} /><span className="pca-slider-round"></span></div><FaExclamationTriangle color="#d63939" /><span>Alertas de Incidentes</span></label>
              
              {(capas.Incidentes_Nuevos || capas.Incidentes_Atencion) && (
                <div style={{ paddingLeft: '40px', marginTop: '-5px', marginBottom: '10px' }}>
                  <select className="pca-select" style={{ fontSize: '11px', padding: '2px 4px', height: 'auto' }}
                    value={filtroTiempo} onChange={e => setFiltroTiempo(Number(e.target.value))}>
                    <option value={1}>Últimas 24 horas</option>
                    <option value={7}>Últimos 7 días</option>
                    <option value={30}>Últimos 30 días</option>
                    <option value={0}>Histórico Completo</option>
                  </select>
                </div>
              )}

              <label className="pca-switch-row"><div className="pca-switch-container"><input type="checkbox" checked={capas.Lluvias} onChange={() => toggleCapa('Lluvias')} /><span className="pca-slider-round"></span></div><FaCloudShowersHeavy color="#206bc4" /><span>Estaciones Pluviómetros</span></label>
            </div>

            {/* ── Infraestructura Hidráulica (KMZ) ─────────────────────────── */}
            <hr className="pca-divider" />
            <div className="pca-seccion">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', cursor: 'pointer' }}
                onClick={() => setSeccionKMZ(v => !v)}>
                <div className="pca-label" style={{margin:0}}>📂 Infraestructura Hidráulica</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span className="pca-badge">{totalKMZ}</span>
                  {activasKMZ > 0 && <span style={{ fontSize: '10px', background: '#206bc4', color: '#fff', padding: '1px 5px', borderRadius: '10px' }}>{activasKMZ} activas</span>}
                  <span style={{ fontSize: '10px', color: '#666' }}>{seccionKMZ ? '▲' : '▼'}</span>
                </div>
              </div>

              {seccionKMZ && (
                <>
                  <div className="pca-action-buttons" style={{ marginBottom: '6px' }}>
                    <button onClick={activarTodasKMZ} className="pca-btn-action text-blue"><FaCheck /> Todas</button>
                    <button onClick={desactivarTodasKMZ} className="pca-btn-action"><FaTimes /> Ninguna</button>
                  </div>
                  <div className="pca-label" style={{ fontSize: '10px', color: '#888', marginBottom: '4px' }}>Polígonos (canales)</div>
                  <div className="pca-list">
                    {KMZ_CONFIG.filter(c => c.tipo === 'poly').map(cfg => (
                      <label key={cfg.key} className="pca-list-item">
                        <div className="pca-item-left">
                          <input type="checkbox" checked={capasKMZ[cfg.key]} onChange={() => toggleCapaKMZ(cfg.key)} className="pca-checkbox" />
                          <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <span style={{ display: 'inline-block', width: '10px', height: '10px', backgroundColor: cfg.color, borderRadius: '2px' }}></span>
                            {cfg.label}
                          </span>
                        </div>
                        <span className="pca-badge">{cfg.data?.features?.length || 0}</span>
                      </label>
                    ))}
                  </div>
                  <div className="pca-label" style={{ fontSize: '10px', color: '#888', marginBottom: '4px', marginTop: '8px' }}>Puntos (infraestructura)</div>
                  <div className="pca-list">
                    {KMZ_CONFIG.filter(c => c.tipo === 'point').map(cfg => (
                      <label key={cfg.key} className="pca-list-item">
                        <div className="pca-item-left">
                          <input type="checkbox" checked={capasKMZ[cfg.key]} onChange={() => toggleCapaKMZ(cfg.key)} className="pca-checkbox" />
                          <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <span style={{ display: 'inline-block', width: '10px', height: '10px', backgroundColor: cfg.color, borderRadius: '50%' }}></span>
                            {cfg.label}
                          </span>
                        </div>
                        <span className="pca-badge">{cfg.data?.features?.filter(f => f.geometry?.type === 'Point').length || 0}</span>
                      </label>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      <button onClick={obtenerDatosDeApis} className="btn-flotante-actualizar">{cargandoAPIs ? 'Actualizando...' : 'Actualizar Datos'}</button>
      <button onClick={obtenerMiUbicacion} disabled={buscandoGPS} className="btn-flotante-gps"><FaLocationArrow /></button>
    </div>
  );
}

export default MapaChavimochic;