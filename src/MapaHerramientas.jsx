// ═══════════════════════════════════════════════════════════════════════════
//  MapaHerramientas.jsx
//  Herramientas adicionales para el visor JURP. Cero dependencias nuevas:
//  usa react-leaflet v5, leaflet, recharts, jspdf y html2canvas (ya instalados).
//
//  Exporta:
//    <BarraHerramientas ... />       barra lateral de botones (foto, regla, etc.)
//    <MiniMapa />                    minimapa sincronizado en una esquina
//    <HerramientaMedicion ... />     medir distancia / área con clics
//    <StreetViewPicker ... />        clic en el mapa → abre Google Street View
//    <PerfilElevacion ... />         panel + gráfico de perfil de elevación
//    <CapturaMapa ... />             lógica de captura/compartir (html2canvas)
// ═══════════════════════════════════════════════════════════════════════════
import { useState, useEffect, useRef, useCallback } from 'react';
import { MapContainer, TileLayer, Rectangle, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { capaBase, puedeExportar, alternativaExportable, propsMinimapa } from './capasBase';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceDot
} from 'recharts';
import {
  FaRulerCombined, FaDrawPolygon, FaEraser, FaCamera, FaShareAlt,
  FaChartArea, FaStreetView, FaTimes, FaFilePdf, FaImage, FaSpinner
} from 'react-icons/fa';

// ── Utilidades geográficas ───────────────────────────────────────────────────
// Distancia entre dos [lat,lng] en metros (haversine).
function distanciaMetros(a, b) {
  const R = 6371000;
  const dLat = (b[0] - a[0]) * Math.PI / 180;
  const dLng = (b[1] - a[1]) * Math.PI / 180;
  const lat1 = a[0] * Math.PI / 180, lat2 = b[0] * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Área de un polígono [lat,lng][] en m² (fórmula esférica shoelace).
function areaMetros(pts) {
  if (pts.length < 3) return 0;
  const R = 6378137;
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const p1 = pts[i], p2 = pts[(i + 1) % pts.length];
    area += (p2[1] - p1[1]) * Math.PI / 180 *
            (2 + Math.sin(p1[0] * Math.PI / 180) + Math.sin(p2[0] * Math.PI / 180));
  }
  return Math.abs(area * R * R / 2);
}

function fmtDistancia(m) {
  return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${m.toFixed(0)} m`;
}
function fmtArea(m2) {
  if (m2 >= 1_000_000) return `${(m2 / 1_000_000).toFixed(2)} km²`;
  if (m2 >= 10_000) return `${(m2 / 10_000).toFixed(2)} ha`;
  return `${m2.toFixed(0)} m²`;
}

// Interpola N puntos equiespaciados a lo largo de una polilínea [lat,lng][].
function muestrearRuta(pts, n = 100) {
  if (pts.length < 2) return pts;
  const segLen = [];
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const d = distanciaMetros(pts[i], pts[i + 1]);
    segLen.push(d); total += d;
  }
  if (total === 0) return [pts[0]];
  const out = [];
  for (let k = 0; k < n; k++) {
    const target = (total * k) / (n - 1);
    let acc = 0, idx = 0;
    while (idx < segLen.length && acc + segLen[idx] < target) { acc += segLen[idx]; idx++; }
    if (idx >= segLen.length) { out.push(pts[pts.length - 1]); continue; }
    const t = segLen[idx] === 0 ? 0 : (target - acc) / segLen[idx];
    const a = pts[idx], b = pts[idx + 1];
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
//  MINIMAPA — segundo mapa pequeño sincronizado con el principal
// ═══════════════════════════════════════════════════════════════════════════
function MiniMapaSync({ setBounds, setCenter }) {
  const map = useMapEvents({
    move: () => { setCenter(map.getCenter()); setBounds(map.getBounds()); },
    zoom: () => { setCenter(map.getCenter()); setBounds(map.getBounds()); },
  });
  useEffect(() => { setCenter(map.getCenter()); setBounds(map.getBounds()); }, [map, setBounds, setCenter]);
  return null;
}

export function MiniMapa({ base }) {
  const [center, setCenter] = useState(null);
  const [bounds, setBounds] = useState(null);
  const miniRef = useRef(null);
  const [colapsado, setColapsado] = useState(false);

  // Mantiene el minimapa centrado, con zoom fijo más alejado (-4 del principal).
  useEffect(() => {
    if (miniRef.current && center) miniRef.current.setView(center, undefined, { animate: false });
  }, [center]);

  return (
    <>
      <MiniMapaSync setBounds={setBounds} setCenter={setCenter} />
      {/* Fuera de la captura: es un widget de navegación, no contenido del
          mapa, y en una foto para documentar un activo un segundo mapa en la
          esquina solo tapa terreno. */}
      <div className="jurp-minimapa-wrap jurp-no-capture"
           style={{ height: colapsado ? '28px' : '150px' }}>
        <button className="jurp-minimapa-toggle" onClick={() => setColapsado(v => !v)} title={colapsado ? 'Mostrar minimapa' : 'Ocultar minimapa'}>
          {colapsado ? '🗺' : '▁'}
        </button>
        {!colapsado && (
          <MapContainer
            center={center || [-8.4186, -78.7533]} zoom={7}
            zoomControl={false} attributionControl={false} dragging={false}
            scrollWheelZoom={false} doubleClickZoom={false} boxZoom={false}
            keyboard={false} touchZoom={false}
            style={{ height: '100%', width: '100%' }}
            ref={miniRef}
          >
            {/* La misma capa que el mapa grande pero sin pedir CORS: el
                minimapa no sale en la foto, así que no lo necesita, y pedirlo
                a un servidor que no envía la cabecera hace que el navegador
                descarte la tesela y el minimapa se quede en blanco. */}
            <TileLayer {...propsMinimapa(base)} />
            {bounds && <Rectangle bounds={bounds} pathOptions={{ color: '#E72276', weight: 2, fillOpacity: 0.1 }} />}
          </MapContainer>
        )}
      </div>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  MEDICIÓN — distancia (línea) o área (polígono) con clics
// ═══════════════════════════════════════════════════════════════════════════
/**
 * Medir distancias y áreas, varias veces seguidas.
 *
 * VARIOS TRAZOS, NO UNO. Antes todos los clics engordaban la misma línea:
 * para medir dos tramos había que apagar la herramienta, volver a
 * encenderla y perder el primero. Medir un canal es casi siempre comparar
 * —este tramo contra aquél, esta poza contra la de al lado— y eso pide
 * tenerlos los dos delante.
 *
 * Ahora el doble clic cierra el trazo y el siguiente clic empieza otro. Lo
 * ya cerrado se queda en el mapa con su cifra; la papelera lo borra todo.
 *
 * `limpiar` es un contador: cuando cambia, se borra lo medido sin apagar la
 * herramienta. Así la papelera limpia y se puede seguir midiendo, en vez de
 * tener que volver a pulsar la regla.
 */
export function HerramientaMedicion({ modo, onFinish, limpiar = 0 }) {
  // modo: 'distancia' | 'area' | null
  const map = useMap();
  const [pts, setPts] = useState([]);        // el trazo en curso
  const [hechos, setHechos] = useState([]);  // los ya cerrados, con su modo
  const capaRef = useRef(null);

  // Un trazo cuenta si tiene con qué: dos puntos una distancia, tres un
  // área. Con menos no hay nada que guardar y cerrarlo solo dejaría puntos
  // sueltos por el mapa.
  const minimo = modo === 'area' ? 3 : 2;

  useMapEvents({
    click(e) {
      if (!modo) return;
      setPts(p => [...p, [e.latlng.lat, e.latlng.lng]]);
    },
    dblclick() {
      if (!modo) return;
      /* Leaflet dispara los dos `click` del doble clic ANTES del `dblclick`,
       * así que el último punto llega repetido. Sin quitarlo, cada trazo
       * acaba con dos vértices en el mismo sitio: inofensivo en una
       * distancia, pero en un área mete un lado de longitud cero. */
      const p = [...pts];
      if (p.length >= 2) {
        const [aLat, aLng] = p[p.length - 1];
        const [bLat, bLng] = p[p.length - 2];
        if (aLat === bLat && aLng === bLng) p.pop();
      }
      if (p.length >= minimo) setHechos(h => [...h, { modo, pts: p }]);
      setPts([]);
      onFinish?.();
    },
  });

  // La papelera: borra lo medido y deja la herramienta puesta.
  useEffect(() => {
    if (!limpiar) return;
    setPts([]);
    setHechos([]);
  }, [limpiar]);

  /* ENTER TAMBIÉN CIERRA EL TRAZO, no solo el doble clic.
   *
   * El doble clic sigue valiendo, pero no es la única forma de pedir lo
   * mismo: en una tableta —que es con lo que se mira esto en reunión— dar
   * dos toques justos sin mover el dedo cuesta, y fallar significa un
   * vértice de más en mitad del canal. Escape cancela el trazo en curso sin
   * tocar los ya cerrados, que es lo que uno busca cuando se da cuenta de
   * que empezó en el sitio equivocado. */
  useEffect(() => {
    if (!modo) return undefined;
    const alPulsar = (e) => {
      if (e.key === 'Enter') {
        if (pts.length >= minimo) {
          setHechos(h => [...h, { modo, pts }]);
          onFinish?.();
        }
        setPts([]);
      } else if (e.key === 'Escape') {
        setPts([]);
      }
    };
    window.addEventListener('keydown', alPulsar);
    return () => window.removeEventListener('keydown', alPulsar);
  }, [modo, pts, minimo, onFinish]);

  /* MIENTRAS SE MIDE, LO DE ENCIMA DEL MAPA NO RECIBE CLICS.
   *
   * Leaflet no propaga al mapa el clic que cae sobre una capa: se lo queda
   * ella y abre su globo. Con el mapa vacío la regla se portaba bien, pero
   * sobre el inventario encendido —miles de estructuras y los trazos de los
   * canales— casi no queda sitio donde pinchar que no sea una capa, así que
   * medir a lo largo de un canal, que es justo para lo que se usa, no
   * añadía ni un punto: abría fichas. Desde fuera eso se ve exactamente
   * igual que una herramienta rota.
   *
   * Se apagan los clics de los paneles de marcadores y de vectores mientras
   * dura la medición, no de la capa del inventario: así vale para cualquier
   * mapa que use esta herramienta, sin que ninguno tenga que enterarse.
   *
   * Y se desactiva el zoom del doble clic, que es cómo se termina de medir:
   * si no, terminar una medición da un salto de zoom de regalo. */
  useEffect(() => {
    const cont = map.getContainer();
    if (!modo) return undefined;
    cont.classList.add('jurp-midiendo');
    const teniaZoom = map.doubleClickZoom.enabled();
    map.doubleClickZoom.disable();
    return () => {
      cont.classList.remove('jurp-midiendo');
      if (teniaZoom) map.doubleClickZoom.enable();
    };
  }, [modo, map]);

  // Redibuja cada vez que cambian los puntos: lo cerrado y lo que se está
  // midiendo ahora.
  useEffect(() => {
    if (capaRef.current) { map.removeLayer(capaRef.current); capaRef.current = null; }
    if (!hechos.length && (!modo || pts.length === 0)) return;

    const grupo = L.layerGroup();
    for (const t of hechos) dibujarTrazo(grupo, t.modo, t.pts, true);
    if (modo && pts.length) dibujarTrazo(grupo, modo, pts, false);

    grupo.addTo(map);
    capaRef.current = grupo;
  }, [pts, hechos, modo, map]);

  // Al desactivar el modo, limpia todo.
  useEffect(() => {
    if (!modo) {
      setPts([]);
      setHechos([]);
      if (capaRef.current) { map.removeLayer(capaRef.current); capaRef.current = null; }
    }
  }, [modo, map]);

  return null;
}

/**
 * Pinta un trazo en el grupo que se le pase.
 *
 * `cerrado` distingue el que se está midiendo del que ya está hecho: el de
 * en curso va a trazos, para que se vea que admite más puntos, y el cerrado
 * va continuo. Sin esa diferencia, con tres mediciones en pantalla no hay
 * forma de saber a cuál se le está añadiendo.
 */
function dibujarTrazo(grupo, modo, pts, cerrado) {
  const color = modo === 'area' ? '#6CA43A' : '#E72276';
  const guion = cerrado ? null : '6 4';
  const vertice = (p) => L.circleMarker(p, {
    radius: 4, color, fillColor: '#fff', fillOpacity: 1, weight: 2,
  }).addTo(grupo);

  if (modo === 'distancia') {
    L.polyline(pts, { color, weight: 3, dashArray: guion }).addTo(grupo);
    let acc = 0;
    pts.forEach((p, i) => {
      if (i > 0) acc += distanciaMetros(pts[i - 1], p);
      vertice(p);
      if (i === pts.length - 1 && pts.length > 1) {
        L.marker(p, { icon: L.divIcon({
          className: 'jurp-med-tooltip',
          html: `<span>${fmtDistancia(acc)}</span>`,
        }) }).addTo(grupo);
      }
    });
    return;
  }

  pts.forEach(vertice);
  if (pts.length >= 3) {
    const poly = L.polygon(pts, {
      color, weight: 2, dashArray: guion, fillColor: color, fillOpacity: 0.25,
    }).addTo(grupo);
    const c = poly.getBounds().getCenter();
    L.marker(c, { icon: L.divIcon({
      className: 'jurp-med-tooltip',
      html: `<span>${fmtArea(areaMetros(pts))}</span>`,
    }) }).addTo(grupo);
  } else if (pts.length === 2) {
    L.polyline(pts, { color, weight: 2, dashArray: '6 4' }).addTo(grupo);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  STREET VIEW — un clic en el mapa abre Google Street View en esa coordenada
// ═══════════════════════════════════════════════════════════════════════════
export function StreetViewPicker({ activo, onDone }) {
  const map = useMap();
  useMapEvents({
    click(e) {
      if (!activo) return;
      const { lat, lng } = e.latlng;
      // API pública de Street View, no requiere API key.
      const url = `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lng}`;
      window.open(url, '_blank', 'noopener');
      onDone?.();
    },
  });
  // Cambia el cursor mientras está activo.
  useEffect(() => {
    const c = map.getContainer();
    if (activo) c.style.cursor = 'crosshair';
    return () => { c.style.cursor = ''; };
  }, [activo, map]);
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
//  PERFIL DE ELEVACIÓN — dibuja una línea, consulta cotas (OpenTopoData) y grafica
// ═══════════════════════════════════════════════════════════════════════════
export function PerfilElevacion({ activo, onClose }) {
  const map = useMap();
  const [pts, setPts] = useState([]);
  const [cargando, setCargando] = useState(false);
  const [datos, setDatos] = useState(null);   // { perfil:[{d,ele,lat,lng}], distTotal, cotaIni, cotaFin, desnivel, pendiente, maxPend }
  const [error, setError] = useState(null);
  const [hoverIdx, setHoverIdx] = useState(null);
  const capaRef = useRef(null);
  const hoverMarkerRef = useRef(null);
  const panelRef = useRef(null);

  useMapEvents({
    click(e) { if (activo && !datos) setPts(p => [...p, [e.latlng.lat, e.latlng.lng]]); },
    dblclick() { if (activo && pts.length >= 2 && !datos) calcularPerfil(); },
  });

  // Dibuja la línea temporal mientras se marcan puntos.
  useEffect(() => {
    if (capaRef.current) { map.removeLayer(capaRef.current); capaRef.current = null; }
    if (!activo || pts.length === 0) return;
    const g = L.layerGroup();
    L.polyline(pts, { color: '#1971c2', weight: 4 }).addTo(g);
    pts.forEach(p => L.circleMarker(p, { radius: 4, color: '#1971c2', fillColor: '#fff', fillOpacity: 1, weight: 2 }).addTo(g));
    g.addTo(map);
    capaRef.current = g;
  }, [pts, activo, map]);

  // Marcador que sigue el hover del gráfico sobre el mapa.
  useEffect(() => {
    if (hoverMarkerRef.current) { map.removeLayer(hoverMarkerRef.current); hoverMarkerRef.current = null; }
    if (hoverIdx == null || !datos) return;
    const p = datos.perfil[hoverIdx];
    if (!p) return;
    hoverMarkerRef.current = L.circleMarker([p.lat, p.lng], {
      radius: 7, color: '#E72276', fillColor: '#E72276', fillOpacity: 0.9, weight: 3,
    }).addTo(map);
  }, [hoverIdx, datos, map]);

  const calcularPerfil = useCallback(async () => {
    setCargando(true); setError(null);
    try {
      const muestras = muestrearRuta(pts, 100);
      // OpenTopoData admite hasta 100 ubicaciones por petición, dataset SRTM 30m.
      const locs = muestras.map(p => `${p[0]},${p[1]}`).join('|');
      const resp = await fetch(`https://api.opentopodata.org/v1/srtm30m?locations=${locs}`);
      if (!resp.ok) throw new Error('Servicio de elevación no disponible');
      const json = await resp.json();
      if (json.status !== 'OK') throw new Error(json.error || 'Respuesta inválida');

      let distAcc = 0;
      const perfil = json.results.map((r, i) => {
        if (i > 0) distAcc += distanciaMetros(muestras[i - 1], muestras[i]);
        return {
          d: +(distAcc / 1000).toFixed(3),           // km
          ele: r.elevation != null ? Math.round(r.elevation) : null,
          lat: muestras[i][0], lng: muestras[i][1],
        };
      });

      const cotas = perfil.map(p => p.ele).filter(v => v != null);
      const cotaIni = perfil[0].ele ?? 0;
      const cotaFin = perfil[perfil.length - 1].ele ?? 0;
      const distTotal = distAcc;
      const desnivel = cotaFin - cotaIni;
      const pendiente = distTotal > 0 ? (desnivel / distTotal) * 100 : 0;
      // Pendiente máxima entre muestras consecutivas.
      let maxPend = 0;
      for (let i = 1; i < perfil.length; i++) {
        if (perfil[i].ele == null || perfil[i - 1].ele == null) continue;
        const dd = distanciaMetros([perfil[i - 1].lat, perfil[i - 1].lng], [perfil[i].lat, perfil[i].lng]);
        if (dd > 0) maxPend = Math.max(maxPend, Math.abs((perfil[i].ele - perfil[i - 1].ele) / dd) * 100);
      }

      setDatos({
        perfil, distTotal, cotaIni, cotaFin, desnivel, pendiente, maxPend,
        cotaMin: Math.min(...cotas), cotaMax: Math.max(...cotas),
      });
    } catch (err) {
      setError(err.message || 'Error obteniendo elevación');
    } finally {
      setCargando(false);
    }
  }, [pts]);

  const reiniciar = () => { setDatos(null); setPts([]); setError(null); setHoverIdx(null); };
  const cerrar = () => { reiniciar(); onClose?.(); };

  // Cursor crosshair mientras marca la línea.
  useEffect(() => {
    const c = map.getContainer();
    if (activo && !datos) c.style.cursor = 'crosshair';
    return () => { c.style.cursor = ''; };
  }, [activo, datos, map]);

  // Limpieza al desactivar.
  useEffect(() => () => {
    if (capaRef.current) map.removeLayer(capaRef.current);
    if (hoverMarkerRef.current) map.removeLayer(hoverMarkerRef.current);
  }, [map]);

  const exportarPNG = async () => {
    const { default: html2canvas } = await import('html2canvas');
    const canvas = await html2canvas(panelRef.current, { backgroundColor: '#fff', scale: 2 });
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = `perfil_elevacion_${Date.now()}.png`;
    a.click();
  };
  const exportarPDF = async () => {
    const { default: html2canvas } = await import('html2canvas');
    const { jsPDF } = await import('jspdf');
    const canvas = await html2canvas(panelRef.current, { backgroundColor: '#fff', scale: 2 });
    const img = canvas.toDataURL('image/png');
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const w = pdf.internal.pageSize.getWidth() - 20;
    const h = (canvas.height * w) / canvas.width;
    pdf.setFontSize(14); pdf.text('Perfil de Elevación — JURP', 10, 12);
    pdf.addImage(img, 'PNG', 10, 18, w, h);
    pdf.save(`perfil_elevacion_${Date.now()}.pdf`);
  };

  if (!activo) return null;

  return (
    <>
      {/* Ayuda flotante mientras se dibuja */}
      {!datos && (
        <div className="jurp-perfil-hint">
          {pts.length < 2
            ? '📍 Haz clic para marcar el inicio y el fin de la línea'
            : '✔ Doble clic para calcular el perfil'}
          {pts.length >= 2 && (
            <button className="jurp-perfil-hint-btn" onClick={calcularPerfil}>Calcular ahora</button>
          )}
          <button className="jurp-perfil-hint-x" onClick={cerrar} title="Cancelar"><FaTimes /></button>
        </div>
      )}

      {/* Panel de resultados */}
      {(cargando || datos || error) && (
        <div className="jurp-perfil-panel" ref={panelRef}>
          <div className="jurp-perfil-header">
            <div className="jurp-perfil-title"><FaChartArea /> Perfil de Elevación <span>— Línea recta</span></div>
            <div className="jurp-perfil-actions">
              <button onClick={exportarPDF} disabled={!datos} className="jurp-perfil-btn pdf"><FaFilePdf /> PDF</button>
              <button onClick={exportarPNG} disabled={!datos} className="jurp-perfil-btn png"><FaImage /> PNG</button>
              <button onClick={cerrar} className="jurp-perfil-btn x"><FaTimes /></button>
            </div>
          </div>

          {cargando && <div className="jurp-perfil-loading"><FaSpinner className="icon-spin" /> Consultando elevación del terreno…</div>}
          {error && <div className="jurp-perfil-error">⚠ {error} <button onClick={reiniciar}>Reintentar</button></div>}

          {datos && (
            <div className="jurp-perfil-body">
              <div className="jurp-perfil-stats">
                <Stat label="DISTANCIA" val={fmtDistancia(datos.distTotal)} />
                <Stat label="COTA INICIAL" val={`${datos.cotaIni} m.s.n.m.`} />
                <Stat label="COTA FINAL" val={`${datos.cotaFin} m.s.n.m.`} />
                <Stat label="DESNIVEL" val={`${datos.desnivel >= 0 ? '↑' : '↓'} ${Math.abs(datos.desnivel)} m`} />
                <Stat label="PENDIENTE MEDIA" val={`${datos.pendiente.toFixed(2)} %`} sub={`máx ${datos.maxPend.toFixed(1)}%`} />
              </div>
              <div className="jurp-perfil-chart">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={datos.perfil} margin={{ top: 10, right: 20, left: 0, bottom: 5 }}
                    onMouseMove={(s) => setHoverIdx(s?.activeTooltipIndex ?? null)}
                    onMouseLeave={() => setHoverIdx(null)}>
                    <defs>
                      <linearGradient id="gradEle" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#1971c2" stopOpacity={0.5} />
                        <stop offset="100%" stopColor="#1971c2" stopOpacity={0.05} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="d" tick={{ fontSize: 11 }} tickFormatter={v => v.toFixed(1)}
                      label={{ value: 'Distancia (km)', position: 'insideBottom', offset: -3, fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} domain={['dataMin - 2', 'dataMax + 2']}
                      label={{ value: 'Elevación (m.s.n.m.)', angle: -90, position: 'insideLeft', fontSize: 11 }} />
                    <Tooltip formatter={(v) => [`${v} m.s.n.m.`, 'Elevación']} labelFormatter={l => `Km ${(+l).toFixed(2)}`} />
                    <Area type="monotone" dataKey="ele" stroke="#1971c2" strokeWidth={2} fill="url(#gradEle)" isAnimationActive={false} />
                    {hoverIdx != null && datos.perfil[hoverIdx] && (
                      <ReferenceDot x={datos.perfil[hoverIdx].d} y={datos.perfil[hoverIdx].ele} r={5} fill="#E72276" stroke="#fff" strokeWidth={2} />
                    )}
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
function Stat({ label, val, sub }) {
  return (
    <div className="jurp-stat">
      <div className="jurp-stat-label">{label}</div>
      <div className="jurp-stat-val">{val}{sub && <span className="jurp-stat-sub"> ({sub})</span>}</div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  CAPTURA / COMPARTIR — screenshot del contenedor del mapa con html2canvas
// ═══════════════════════════════════════════════════════════════════════════
/**
 * Captura del mapa.
 *
 * `contenedorRef` debe apuntar al div que envuelve SOLO al mapa (.gis-mapa), no
 * a la pantalla entera. La foto es para documentar en campo: si entra el panel
 * de capas, la cabecera o la barra de herramientas, lo que se quería enseñar
 * queda tapado por la interfaz. Todo eso vive como hermano de .gis-mapa, así
 * que apuntar bien al contenedor lo deja fuera sin tener que ir enumerando
 * clases — una lista de clases se queda corta en cuanto alguien agrega un
 * panel nuevo y se olvida de marcarlo.
 *
 * Lo que sí se conserva dentro de la foto es la atribución de las teselas: es
 * un requisito de licencia del proveedor, no adorno de la aplicación.
 */
/**
 * Traduce el fallo de la captura a algo accionable.
 *
 * "No se pudo capturar el mapa" no sirve para nada: la causa casi siempre es
 * una capa base servida sin cabeceras CORS, y eso el usuario lo arregla
 * cambiando de capa en un segundo — si alguien se lo dice.
 */
function explicarFalloCaptura(e) {
  if (e?.name === 'SecurityError' || /taint/i.test(e?.message || ''))
    return 'La capa base no permite copiarse. Cambia de capa en el selector de '
         + 'arriba y vuelve a intentarlo.';
  return `No se pudo capturar el mapa: ${e?.message || e}`;
}

export function useCapturaMapa(contenedorRef, opciones = {}) {
  const [ocupado, setOcupado] = useState(false);
  // Con `base` y `cambiarBase`, la captura sabe ofrecer el cambio de capa
  // cuando la actual no se puede exportar. Sin ellos funciona igual, solo que
  // el usuario tiene que cambiarla a mano.
  const { base, cambiarBase } = opciones;

  const generar = useCallback(async () => {
    const { default: html2canvas } = await import('html2canvas');
    const nodo = contenedorRef.current;
    if (!nodo) throw new Error('No hay mapa que capturar');
    // useCORS permite capturar tiles de Google/OSM servidos con CORS.
    const canvas = await html2canvas(nodo, {
      // allowTaint va en false a propósito. En true, una tesela servida sin
      // cabeceras CORS se dibuja igual pero contamina el canvas, y el fallo
      // aparece después, al convertirlo a PNG, como un SecurityError que no
      // dice nada del origen. En false la tesela sencillamente no se dibuja y
      // el problema se ve en la imagen, que es donde se puede entender.
      useCORS: true, allowTaint: false, backgroundColor: null, scale: 2,
      // Por si algo de interfaz acaba dentro del mapa: los controles propios
      // de Leaflet (zoom, escala) y cualquier cosa marcada a mano.
      ignoreElements: (el) => (
        el.classList?.contains('jurp-no-capture') ||
        el.classList?.contains('leaflet-control-zoom') ||
        el.classList?.contains('leaflet-control-scale')
      ),
    });
    return canvas;
  }, [contenedorRef]);

  /**
   * Si la capa actual no se puede exportar, se ofrece cambiarla.
   *
   * Las teselas de Google no autorizan su lectura, así que con ellas la foto
   * sale sin mapa de fondo. Antes de gastar el tiempo de la captura conviene
   * decirlo y resolverlo, en vez de entregar una imagen vacía.
   *
   * Devuelve false si el usuario prefiere no capturar.
   */
  const prepararBase = useCallback(async () => {
    if (!base || !cambiarBase || puedeExportar(base)) return true;
    const alt = alternativaExportable(base);
    const ok = window.confirm(
      `La capa «${capaBase(base).etiqueta}» no permite exportarse, así que la foto `
      + `saldría sin el mapa de fondo.\n\n`
      + `¿Cambiar a «${capaBase(alt).etiqueta}» para esta captura?`);
    if (!ok) return false;
    cambiarBase(alt);
    // Las teselas nuevas tardan en llegar; capturar antes daría un mapa a medias.
    await new Promise(r => setTimeout(r, 1800));
    return true;
  }, [base, cambiarBase]);

  const descargar = useCallback(async () => {
    if (!(await prepararBase())) return;
    setOcupado(true);
    try {
      const canvas = await generar();
      const a = document.createElement('a');
      a.href = canvas.toDataURL('image/png');
      a.download = `mapa_jurp_${Date.now()}.png`;
      a.click();
    } catch (e) { console.error(e); alert(explicarFalloCaptura(e)); }
    finally { setOcupado(false); }
  }, [generar, prepararBase]);

  const compartir = useCallback(async () => {
    if (!(await prepararBase())) return;
    setOcupado(true);
    try {
      const canvas = await generar();
      const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
      const file = new File([blob], `mapa_jurp_${Date.now()}.png`, { type: 'image/png' });
      // Web Share API nivel 2 (móvil / navegadores modernos).
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Mapa JURP', text: 'Captura del visor JURP' });
      } else {
        // Fallback: descarga.
        const a = document.createElement('a');
        a.href = canvas.toDataURL('image/png');
        a.download = file.name; a.click();
        alert('Tu navegador no permite compartir directamente; se descargó la imagen.');
      }
    } catch (e) { console.error(e); alert(explicarFalloCaptura(e)); }
    finally { setOcupado(false); }
  }, [generar]);

  return { ocupado, descargar, compartir };
}

// ═══════════════════════════════════════════════════════════════════════════
//  BARRA DE HERRAMIENTAS — botones laterales (vive fuera de <MapContainer>)
// ═══════════════════════════════════════════════════════════════════════════
export function BarraHerramientas({ herramienta, setHerramienta, onCaptura, onCompartir, capturando, onLimpiar = null }) {
  const btn = (id, icon, title) => (
    <button
      className={`jurp-tool-btn ${herramienta === id ? 'activo' : ''}`}
      title={title}
      onClick={() => setHerramienta(herramienta === id ? null : id)}
    >{icon}</button>
  );
  return (
    <div className="jurp-toolbar jurp-no-capture">
      {btn('distancia', <FaRulerCombined />, 'Medir distancia')}
      {btn('area', <FaDrawPolygon />, 'Medir área')}
      {/* `onLimpiar` borra lo medido y deja la regla puesta, que es lo que
          hacen los dos visores. Sin él se apaga la herramienta, como antes:
          esta barra no se usa hoy en ningún sitio y no merece romperla. */}
      <button className="jurp-tool-btn" title="Borrar lo medido"
        onClick={() => (onLimpiar ? onLimpiar() : setHerramienta(null))}><FaEraser /></button>
      <div className="jurp-tool-sep" />
      <button className="jurp-tool-btn" title="Capturar mapa (PNG)" onClick={onCaptura} disabled={capturando}>
        {capturando ? <FaSpinner className="icon-spin" /> : <FaCamera />}
      </button>
      <button className="jurp-tool-btn" title="Compartir imagen" onClick={onCompartir} disabled={capturando}><FaShareAlt /></button>
    </div>
  );
}