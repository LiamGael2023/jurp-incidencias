import { useState, useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, GeoJSON, useMap } from 'react-leaflet';
import L, { divIcon } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { FaCloudShowersHeavy, FaExclamationTriangle, FaLocationArrow, FaLayerGroup, FaCheck, FaTimes, FaExchangeAlt, FaChevronLeft, FaChevronRight } from 'react-icons/fa';

import geoCanalMadre from './data/Canal_Madre.json';
import geoLateral10 from './data/Lateral_10.json';
import geoRedes from './data/Redes_Presurizado.json';
import geoBocatoma from './data/Bocatoma.json';
import geoPuenteVehicular from './data/Puente_Vehicular.json';
import geoPuenteVehicular2 from './data/Puente_Vehicular_2.json';
import geoPuentePeatonal from './data/Puente_Peatonal.json';
import geoPuentePeatonal2 from './data/Puente_Peatonal_2.json';
import geoAlcantarilla from './data/Alcantarilla.json';
import geoAlcantarilla2 from './data/Alcantarilla_2.json';
import logo from './assets/logo1.png';

function VolarAUbicacion({ posicion }) {
  const map = useMap();
  useEffect(() => { if (posicion) map.flyTo(posicion, 16, { animate: true, duration: 1.5 }); }, [posicion, map]);
  return null;
}

function MapaChavimochic() {
  const centroMapa = [-8.4186, -78.7533]; 
  const [leyendaExpandida, setLeyendaExpandida] = useState(true);
  const [mapaBase, setMapaBase] = useState('satelite');
  const [capas, setCapas] = useState({ Incidentes_Nuevos: true, Incidentes_Atencion: true, Lluvias: true, Canales: true, Bocatomas: false, Puentes_Vehiculares: false, Puentes_Peatonales: false, Alcantarillas: false });
  const [incidentesAPI, setIncidentesAPI] = useState([]);
  const [lluviasAPI, setLluviasAPI] = useState([]); 
  const [cargandoAPIs, setCargandoAPIs] = useState(false);
  const [miUbicacion, setMiUbicacion] = useState(null);
  const [buscandoGPS, setBuscandoGPS] = useState(false);

  const countBocatomas = geoBocatoma?.features?.length || 0;
  const countPtesVeh = (geoPuenteVehicular?.features?.length || 0) + (geoPuenteVehicular2?.features?.length || 0);
  const countPtesPea = (geoPuentePeatonal?.features?.length || 0) + (geoPuentePeatonal2?.features?.length || 0);
  const countAlcantarillas = (geoAlcantarilla?.features?.length || 0) + (geoAlcantarilla2?.features?.length || 0);
  const totalIHM = countBocatomas + countPtesVeh + countPtesPea + countAlcantarillas;

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
          return { id: inc.id, lat: lat, lng: lng, tipo: tipoNombre, estado: inc.status || 'pat', gravedad: inc.severity || 'lev', descripcion: inc.description || 'Sin descripción', usuario: inc.user?.username || 'Usuario Desconocido', lugar: inc.location_text || 'Coordenada Libre', fecha: new Date(inc.created_at).toLocaleString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute:'2-digit' }) };
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

  const toggleCapa = (nombreCapa) => { setCapas(prev => ({ ...prev, [nombreCapa]: !prev[nombreCapa] })); };
  const obtenerMiUbicacion = () => {
    setBuscandoGPS(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => { setMiUbicacion([pos.coords.latitude, pos.coords.longitude]); setBuscandoGPS(false); },
      () => { alert("Error GPS"); setBuscandoGPS(false); }, { enableHighAccuracy: true }
    );
  };

  // 🟢 Función para determinar la URL del mapa según la selección
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
    let colorCentro = '#f59f00'; let colorBorde = '#e67e22'; // Yellow Tabler
    if (gravedad === 'mod') { colorCentro = '#f76707'; colorBorde = '#d9480f'; } // Orange Tabler
    if (gravedad === 'gra') { colorCentro = '#d63939'; colorBorde = '#c92a2a'; } // Red Tabler
    return divIcon({ className: 'icono-vacio', html: `<div style="position: relative; width: 20px; height: 20px;"><div style="position: absolute; top: 0; left: 0; width: 20px; height: 20px; background-color: ${colorCentro}; opacity: 0.4; border-radius: 50%; animation: pulse 1.5s infinite;"></div><div style="position: absolute; top: 4px; left: 4px; width: 12px; height: 12px; background-color: ${colorCentro}; border: 2px solid ${colorBorde}; border-radius: 50%; box-shadow: 0 2px 4px rgba(0,0,0,0.4);"></div></div>`, iconSize: [20, 20], iconAnchor: [10, 10] });
  };
  const estiloCanales = { color: '#206bc4', weight: 4, opacity: 0.8 }; // Blue Tabler
  const crearIconoPunto = (colorBorde) => divIcon({ className: 'icono-vacio', html: `<div style="background-color: white; border: 3px solid ${colorBorde}; width: 14px; height: 14px; border-radius: 50%; box-shadow: 0 2px 4px rgba(0,0,0,0.3);"></div>`, iconSize: [20, 20], iconAnchor: [10, 10] });
  const iconoGPS = divIcon({ className: 'icono-vacio', html: `<div style="background-color: #206bc4; border: 3px solid white; width: 16px; height: 16px; border-radius: 50%; box-shadow: 0 0 10px rgba(0,0,0,0.5);"></div>`, iconSize: [22, 22], iconAnchor: [11, 11] });
  const crearIconoLluvia = (totalRain, isCritical) => divIcon({ className: 'icono-vacio', html: `<div style="display: flex; flex-direction: column; align-items: center; margin-top: -30px;"><div style="background: white; border: 1px solid ${isCritical ? '#d63939' : '#206bc4'}; color: ${isCritical ? '#d63939' : '#206bc4'}; font-size: 11px; font-weight: 700; padding: 2px 6px; border-radius: 4px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); white-space: nowrap;">${totalRain.toFixed(1)} mm</div><div style="font-size: 26px; color: ${isCritical ? '#d63939' : '#206bc4'}; line-height: 1; margin-top: 2px;">🌧️</div></div>`, iconSize: [60, 60], iconAnchor: [30, 45] });

  return (
    <div style={{ height: '100%', width: '100%', position: 'relative' }}>
      <MapContainer center={centroMapa} zoom={10} style={{ height: '100%', width: '100%', zIndex: 0 }}>
        {/* 🟢 Usamos la función para obtener la URL dinámica sin opacidad */}
        <TileLayer url={obtenerUrlMapa()} maxZoom={20} attribution="&copy; Map Contributors" />
        <VolarAUbicacion posicion={miUbicacion} />
        {miUbicacion && <Marker position={miUbicacion} icon={iconoGPS}><Popup>Estás aquí</Popup></Marker>}

        {capas.Canales && <><GeoJSON data={geoCanalMadre} style={estiloCanales} /><GeoJSON data={geoLateral10} style={estiloCanales} /><GeoJSON data={geoRedes} style={estiloCanales} /></>}
        {capas.Bocatomas && <GeoJSON data={geoBocatoma} pointToLayer={(f, ll) => L.marker(ll, { icon: crearIconoPunto('#206bc4') })} />}
        {capas.Puentes_Vehiculares && <><GeoJSON data={geoPuenteVehicular} pointToLayer={(f, ll) => L.marker(ll, { icon: crearIconoPunto('#8a6d3b') })} /><GeoJSON data={geoPuenteVehicular2} pointToLayer={(f, ll) => L.marker(ll, { icon: crearIconoPunto('#8a6d3b') })} /></>}
        {capas.Puentes_Peatonales && <><GeoJSON data={geoPuentePeatonal} pointToLayer={(f, ll) => L.marker(ll, { icon: crearIconoPunto('#f76707') })} /><GeoJSON data={geoPuentePeatonal2} pointToLayer={(f, ll) => L.marker(ll, { icon: crearIconoPunto('#f76707') })} /></>}
        {capas.Alcantarillas && <><GeoJSON data={geoAlcantarilla} pointToLayer={(f, ll) => L.marker(ll, { icon: crearIconoPunto('#6f42c1') })} /><GeoJSON data={geoAlcantarilla2} pointToLayer={(f, ll) => L.marker(ll, { icon: crearIconoPunto('#6f42c1') })} /></>}

        {capas.Incidentes_Nuevos && incidentesAPI.map(inc => inc.estado !== 'eat' && <Marker key={inc.id} position={[inc.lat, inc.lng]} icon={crearIconoIncidente(inc.gravedad)}><Popup><b>{inc.tipo}</b></Popup></Marker>)}
        {capas.Incidentes_Atencion && incidentesAPI.map(inc => inc.estado === 'eat' && <Marker key={inc.id} position={[inc.lat, inc.lng]} icon={crearIconoIncidente(inc.gravedad)}><Popup><b>{inc.tipo}</b> (En Atención)</Popup></Marker>)}
        {capas.Lluvias && lluviasAPI.map(pluv => <Marker key={pluv.id} position={[pluv.lat, pluv.lng]} icon={crearIconoLluvia(pluv.totalRain, pluv.isCritical)}><Popup><b>{pluv.name}</b></Popup></Marker>)}
      </MapContainer>

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
              {/* 🟢 Nuevas opciones agregadas al selector */}
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
              <label className="pca-switch-row"><div className="pca-switch-container"><input type="checkbox" checked={capas.Lluvias} onChange={() => toggleCapa('Lluvias')} /><span className="pca-slider-round"></span></div><FaCloudShowersHeavy color="#206bc4" /><span>Estaciones Pluviómetros</span></label>
            </div>

            <hr className="pca-divider" />
            <div className="pca-seccion">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}><div className="pca-label" style={{margin:0}}>Inventario IHM</div><div className="pca-badge-total">{totalIHM}</div></div>
              <div className="pca-action-buttons">
                <button onClick={() => setCapas(p => ({...p, Bocatomas:true, Puentes_Vehiculares:true, Puentes_Peatonales:true, Alcantarillas:true}))} className="pca-btn-action text-blue"><FaCheck /> Todos</button>
                <button onClick={() => setCapas(p => ({...p, Bocatomas:false, Puentes_Vehiculares:false, Puentes_Peatonales:false, Alcantarillas:false}))} className="pca-btn-action"><FaTimes /> Ninguno</button>
              </div>
              <div className="pca-list">
                <label className="pca-list-item"><div className="pca-item-left"><input type="checkbox" checked={capas.Bocatomas} onChange={() => toggleCapa('Bocatomas')} className="pca-checkbox" /><span>🔵 Bocatoma</span></div><span className="pca-badge">{countBocatomas}</span></label>
                <label className="pca-list-item"><div className="pca-item-left"><input type="checkbox" checked={capas.Puentes_Vehiculares} onChange={() => toggleCapa('Puentes_Vehiculares')} className="pca-checkbox" /><span>🟤 Ptes. Vehic.</span></div><span className="pca-badge">{countPtesVeh}</span></label>
                <label className="pca-list-item"><div className="pca-item-left"><input type="checkbox" checked={capas.Puentes_Peatonales} onChange={() => toggleCapa('Puentes_Peatonales')} className="pca-checkbox" /><span>🟠 Ptes. Peatonales</span></div><span className="pca-badge">{countPtesPea}</span></label>
                <label className="pca-list-item"><div className="pca-item-left"><input type="checkbox" checked={capas.Alcantarillas} onChange={() => toggleCapa('Alcantarillas')} className="pca-checkbox" /><span>🟣 Alcantarillas</span></div><span className="pca-badge">{countAlcantarillas}</span></label>
              </div>
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