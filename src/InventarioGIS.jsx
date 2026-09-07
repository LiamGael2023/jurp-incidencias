import { useState, useEffect, useCallback, useMemo } from 'react';
import { GeoJSON, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import {
  FaClipboardCheck, FaTimes, FaSyncAlt, FaCrosshairs,
  FaChevronDown, FaChevronRight, FaExclamationCircle, FaPlusCircle,
} from 'react-icons/fa';
import './InventarioGIS.css';

/**
 * Módulo de inventario de infraestructura de riego (ámbito JURP).
 *
 * A diferencia de las capas KMZ del visor —que cubren todo Chavimochic y son
 * de referencia— estas capas vienen de PostGIS, corresponden solo al ámbito
 * que administra la Junta y llevan estado de campaña: qué se evaluó, en qué
 * condición está y qué falta por revisar.
 *
 * Uso en Mapa.jsx:
 *
 *   const inv = useInventario();
 *
 *   // en la barra de herramientas
 *   <button className={`gis-tool ${inv.abierto ? 'activo' : ''}`}
 *     title="Inventario JURP" onClick={inv.alternar}><FaClipboardCheck /></button>
 *
 *   // dentro del <MapContainer>
 *   <CapasInventario inv={inv} />
 *
 *   // junto al panel de capas, fuera del mapa
 *   <PanelInventario inv={inv} onVolar={(b) => mapRef.current?.fitBounds(b)} />
 */

const API = '/vigapi/inventario';

// Agrupación para el panel. El orden es el que ve el usuario.
const GRUPOS = [
  {
    titulo: 'Obras de captación y entrega',
    capas: [
      { codigo: 'tomas_l10',            label: 'Tomas Lateral 10',      color: '#f59f00' },
      { codigo: 'tomas_otros_sectores', label: 'Tomas otros sectores',  color: '#f08c00' },
      { codigo: 'entregas',             label: 'Entregas',              color: '#e8590c' },
      { codigo: 'laterales',            label: 'Laterales',             color: '#d9480f' },
      { codigo: 'partidor',             label: 'Partidores',            color: '#c92a2a' },
    ],
  },
  {
    titulo: 'Obras de arte',
    capas: [
      { codigo: 'canoas',              label: 'Canoas',               color: '#4c6ef5' },
      { codigo: 'sifon',               label: 'Sifones',              color: '#3b5bdb' },
      { codigo: 'alcantarilla',        label: 'Alcantarillas',        color: '#7048e8' },
      { codigo: 'aliviadero',          label: 'Aliviaderos',          color: '#9c36b5' },
      { codigo: 'desarenadores',       label: 'Desarenadores',        color: '#0c8599' },
      { codigo: 'camara_rompepresion', label: 'Cámaras rompepresión', color: '#1098ad' },
      { codigo: 'cajas_hidraulicas',   label: 'Cajas hidráulicas',    color: '#0ca678' },
      { codigo: 'pases_de_tuberias',   label: 'Pases de tuberías',    color: '#2f9e44' },
      { codigo: 'reservorios',         label: 'Reservorios',          color: '#1971c2' },
    ],
  },
  {
    titulo: 'Cruces',
    capas: [
      { codigo: 'puente_vehicular', label: 'Puentes vehiculares', color: '#868e96' },
      { codigo: 'puente_peatonal',  label: 'Puentes peatonales',  color: '#adb5bd' },
    ],
  },
  {
    titulo: 'Red y territorio',
    capas: [
      { codigo: 'canal_madre',       label: 'Canal madre',       color: '#1c7ed6', tipo: 'line' },
      { codigo: 'canal_lateral_10',  label: 'Canal Lateral 10',  color: '#f03e3e', tipo: 'line' },
      { codigo: 'subalterales',      label: 'Subalterales',      color: '#ae3ec9', tipo: 'line' },
      { codigo: 'redes_presurizado', label: 'Redes presurizado', color: '#f59f00', tipo: 'line' },
      { codigo: 'sectores_pech',     label: 'Sectores PECH',     color: '#c92a2a', tipo: 'poly' },
      { codigo: 'areas_licencia',    label: 'Áreas con licencia', color: '#f76707', tipo: 'poly' },
      { codigo: 'lotes',             label: 'Lotes',             color: '#e8590c', tipo: 'poly' },
    ],
  },
];

// Capas que vienen del KMZ: cubren todo Chavimochic y son de referencia.
// El grupo va aparte para que nadie las confunda con lo que la Junta evalúa.
const GRUPOS_CONTEXTO = [
  {
    titulo: 'Chavimochic — obras del PECH',
    contexto: true,
    capas: [
      { codigo: 'bocatomas',          label: 'Bocatomas',            color: '#495057' },
      { codigo: 'estaciones_control', label: 'Estaciones de control', color: '#5c7cfa' },
      { codigo: 'rapidas',            label: 'Rápidas',              color: '#f03e3e' },
      { codigo: 'tomas_canal_madre',  label: 'Tomas Canal Madre',    color: '#e8590c' },
      { codigo: 'garitas_jurp',       label: 'Garitas JURP',         color: '#1098ad' },
      { codigo: 'garitas_otros',      label: 'Garitas de terceros',  color: '#9c36b5' },
    ],
  },
  {
    titulo: 'Chavimochic — trazados y vías',
    contexto: true,
    capas: [
      { codigo: 'canal_madre_kmz',       label: 'Canal Madre',       color: '#1971c2', tipo: 'poly' },
      { codigo: 'canal_lateral_10_kmz',  label: 'Lateral 10',        color: '#4dabf7', tipo: 'poly' },
      { codigo: 'redes_presurizado_kmz', label: 'Redes presurizado', color: '#74c0fc', tipo: 'poly' },
      { codigo: 'evacuador_kmz',         label: 'Evacuadores',       color: '#a5d8ff', tipo: 'poly' },
      { codigo: 'caminos_servicio_kmz',  label: 'Caminos de servicio', color: '#e67700', tipo: 'poly' },
      { codigo: 'vias_acceso_kmz',       label: 'Vías de acceso',    color: '#d6336c', tipo: 'poly' },
      { codigo: 'via_auxiliar_kmz',      label: 'Vía auxiliar',      color: '#ae3ec9', tipo: 'poly' },
      { codigo: 'red_nacional_kmz',      label: 'Red vial nacional', color: '#d63939', tipo: 'poly' },
    ],
  },
];

const TODOS_GRUPOS = [...GRUPOS, ...GRUPOS_CONTEXTO];
const TODAS = TODOS_GRUPOS.flatMap(g => g.capas);

// Filtro de ámbito. 'todo' no manda el parámetro y el backend devuelve
// Chavimochic completo.
const AMBITOS = [
  { valor: 'todo', etiqueta: 'Todo',        titulo: 'JURP y Chavimochic' },
  { valor: 'JURP', etiqueta: 'JURP',        titulo: 'Solo lo que administra la Junta' },
  { valor: 'PECH', etiqueta: 'Chavimochic', titulo: 'Solo obras del PECH' },
];
const META = Object.fromEntries(TODAS.map(c => [c.codigo, c]));

// Estado de conservación, con los códigos del formato ANA.
const COLOR_ESTADO = {
  B: '#2f9e44',   // bueno
  R: '#f59f00',   // regular
  M: '#e8590c',   // malo
  C: '#c92a2a',   // colapsado
  '-': '#868e96', // no aplica
};

const ETIQUETA_ESTADO = {
  B: 'Bueno', R: 'Regular', M: 'Malo', C: 'Colapsado', '-': 'No aplica',
};

// Condición operativa: lo que va a la columna Observaciones del formato.
const COLOR_CONDICION = {
  'Operativo': '#2f9e44',
  'Mantenimiento': '#f59f00',
  'Inoperativo': '#c92a2a',
  'No ubicado': '#868e96',
};

const token = () => localStorage.getItem('userToken');
// El inventario vive en otro backend (gideon), que no comparte la tabla de
// usuarios con el sistema de riego. Mandar el token de esa sesión hace que
// DRF intente autenticarlo, falle y devuelva 401 pese al permiso AllowAny.
const cabeceras = () => ({});

// El marcador carga tres datos a la vez:
//   relleno → capa a la que pertenece
//   anillo  → estado de conservación evaluado (sin anillo = sin evaluar)
//   forma   → ámbito: los de JURP van sólidos, los del PECH huecos y más
//             chicos, porque son contexto y no deben competir por la vista.
const iconoActivo = (color, estado, ambito) => {
  const esPech = ambito === 'PECH';
  return L.divIcon({
    className: 'inv-marker-wrap',
    html: `<span class="inv-marker ${esPech ? 'inv-pech' : ''}" `
        + `style="--c:${color};--e:${estado ? COLOR_ESTADO[estado] : 'transparent'}"></span>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
    popupAnchor: [0, -8],
  });
};

/* ══════════════════════════════════════════════════════════
   Hook: estado del módulo
   ══════════════════════════════════════════════════════════ */
export function useInventario() {
  const [abierto, setAbierto] = useState(false);
  const [campania, setCampania] = useState(null);
  const [campanias, setCampanias] = useState([]);
  const [avance, setAvance] = useState([]);
  const [altas, setAltas] = useState([]);
  const [totales, setTotales] = useState({});
  const [datos, setDatos] = useState({});        // codigo → FeatureCollection
  const [visibles, setVisibles] = useState({});  // codigo → bool
  const [cargando, setCargando] = useState({});  // codigo → bool
  const [evaluaciones, setEvaluaciones] = useState({}); // "tipo:fid" → evaluación
  const [error, setError] = useState(null);
  const [iniciando, setIniciando] = useState(false);
  // activo que se está evaluando: {tipo, fid, props}
  const [evaluando, setEvaluando] = useState(null);
  // definición de campos por tipo, cacheada tras el primer pedido
  const [formularios, setFormularios] = useState({});
  // 'todo' | 'JURP' | 'PECH' — filtro general, el que aplica por defecto
  const [ambito, setAmbito] = useState('todo');
  // Filtro propio de cada capa; pisa al general mientras esté puesto.
  // Se maneja desde los números del badge: clic en el verde deja solo JURP,
  // clic en el gris solo Chavimochic, clic otra vez vuelve a ambos.
  const [filtroCapa, setFiltroCapa] = useState({});

  // Carga inicial: campaña vigente, totales por capa y evaluaciones hechas.
  const iniciar = useCallback(async () => {
    if (!token()) { setError('Sesión no iniciada'); return; }
    setIniciando(true); setError(null);
    try {
      const [rc, rt] = await Promise.all([
        fetch(`${API}/campanias/`, { headers: cabeceras() }),
        fetch(`${API}/capas/`, { headers: cabeceras() }),
      ]);
      if (!rc.ok || !rt.ok) throw new Error('No se pudo consultar el inventario');

      const camps = await rc.json();
      const lista = camps.results || camps;
      setCampanias(lista);
      const activa = lista.find(c => c.estado === 'en_proceso') || lista[0];
      setCampania(activa || null);

      // el backend devuelve total y, cuando la capa tiene ámbito, el
      // desglose jurp/pech para el badge del panel
      const caps = await rt.json();
      setTotales(Object.fromEntries(
        (caps.results || caps).map(c => [c.codigo, c])
      ));

      if (activa) {
        const [ra, re] = await Promise.all([
          fetch(`${API}/campanias/${activa.id}/avance/`, { headers: cabeceras() }),
          fetch(`${API}/evaluaciones/?campania=${activa.anio}`, { headers: cabeceras() }),
        ]);
        if (ra.ok) setAvance((await ra.json()).detalle || []);
        if (re.ok) {
          const ev = await re.json();
          setEvaluaciones(Object.fromEntries(
            (ev.results || ev).map(e => [`${e.tipo_activo}:${e.activo_fid}`, e])
          ));
        }

        // altas de campo pendientes de validar
        try {
          const rn = await fetch(`${API}/activos-nuevos/?validacion=pendiente`,
                                 { headers: cabeceras() });
          if (rn.ok) {
            const an = await rn.json();
            setAltas(an.results || an);
          }
        } catch (e) { /* sin altas, el panel simplemente no las muestra */ }
      }
    } catch (e) {
      setError(e.message || 'Error al cargar el inventario');
    } finally {
      setIniciando(false);
    }
  }, []);

  // Ámbito que rige para una capa: el suyo si lo tiene, si no el general.
  const ambitoDe = useCallback(
    (codigo) => filtroCapa[codigo] || ambito,
    [filtroCapa, ambito]
  );

  // La caché se indexa por capa + ámbito: cambiar el filtro no debe
  // devolver el GeoJSON que se bajó con el filtro anterior.
  const clave = useCallback((codigo, amb) => `${codigo}::${amb || ambitoDe(codigo)}`,
                            [ambitoDe]);

  const cargarCapa = useCallback(async (codigo, amb) => {
    const k = `${codigo}::${amb}`;
    if (datos[k]) return;
    setCargando(c => ({ ...c, [codigo]: true }));
    try {
      const filtro = amb === 'todo' ? '' : `&ambito=${amb}`;
      const r = await fetch(`${API}/capas/${codigo}/?srid=4326${filtro}`,
                            { headers: cabeceras() });
      if (r.ok) {
        // El JSON se resuelve ANTES de tocar el estado: el actualizador de
        // useState es síncrono y no admite await dentro.
        const geo = await r.json();
        setDatos(d => ({ ...d, [k]: geo }));
      }
    } catch (e) { /* la capa queda vacía; el badge lo refleja */ }
    finally { setCargando(c => ({ ...c, [codigo]: false })); }
  }, [datos]);

  const alternarCapa = useCallback((codigo) => {
    setVisibles(v => {
      const nuevo = !v[codigo];
      if (nuevo) cargarCapa(codigo, ambitoDe(codigo));
      return { ...v, [codigo]: nuevo };
    });
  }, [cargarCapa, ambitoDe]);

  // El filtro general reemplaza a los de cada capa: si el usuario elige
  // "solo JURP" arriba, no tiene sentido que una capa siga en otro modo.
  const cambiarAmbito = useCallback((nuevo) => {
    setAmbito(nuevo);
    setFiltroCapa({});
    Object.entries(visibles).forEach(([cod, v]) => { if (v) cargarCapa(cod, nuevo); });
  }, [visibles, cargarCapa]);

  // Cada mitad del badge se comporta como una casilla: suma o quita ese
  // ámbito, sin pisar al otro. Los dos marcados = 'todo'; ninguno = la capa
  // se apaga, porque no habría nada que dibujar.
  const alternarAmbitoCapa = useCallback((codigo, amb) => {
    const actual = filtroCapa[codigo] || ambito;
    const activos = new Set(actual === 'todo' ? ['JURP', 'PECH'] : [actual]);

    if (activos.has(amb)) activos.delete(amb);
    else activos.add(amb);

    if (activos.size === 0) {                    // se destildaron los dos
      setVisibles(v => ({ ...v, [codigo]: false }));
      return;
    }

    const nuevo = activos.size === 2 ? 'todo' : [...activos][0];
    setFiltroCapa(f => {
      const copia = { ...f };
      if (nuevo === ambito) delete copia[codigo];
      else copia[codigo] = nuevo;
      return copia;
    });
    cargarCapa(codigo, nuevo);
    setVisibles(v => (v[codigo] ? v : { ...v, [codigo]: true }));
  }, [filtroCapa, ambito, cargarCapa]);

  const apagarTodas = useCallback(() => setVisibles({}), []);

  const alternar = useCallback(() => {
    setAbierto(a => {
      if (!a && !campania && !iniciando) iniciar();
      return !a;
    });
  }, [campania, iniciando, iniciar]);

  const evaluacionDe = useCallback(
    (tipo, fid) => evaluaciones[`${tipo}:${fid}`] || null,
    [evaluaciones]
  );

  // Los campos de cada tipo se piden una vez y quedan en memoria: son la
  // definición del formulario y no cambian durante la sesión.
  const cargarFormulario = useCallback(async (tipo) => {
    if (formularios[tipo]) return formularios[tipo];
    try {
      const r = await fetch(`${API}/campos-evaluables/?tipo_activo=${tipo}`,
                            { headers: cabeceras() });
      if (!r.ok) return null;
      const d = await r.json();
      const campos = (d.results || d).sort((a, b) => a.orden - b.orden);
      setFormularios(f => ({ ...f, [tipo]: campos }));
      return campos;
    } catch (e) {
      return null;
    }
  }, [formularios]);

  const abrirEvaluacion = useCallback((tipo, fid, props) => {
    cargarFormulario(tipo);
    setEvaluando({ tipo, fid, props });
  }, [cargarFormulario]);

  const cerrarEvaluacion = useCallback(() => setEvaluando(null), []);

  // Guarda y refresca en memoria, para no volver a pedir toda la campaña.
  const guardarEvaluacion = useCallback(async (tipo, fid, cuerpo) => {
    if (!campania) return { ok: false, error: 'No hay campaña activa' };
    const previa = evaluaciones[`${tipo}:${fid}`];
    const url = previa ? `${API}/evaluaciones/${previa.id}/` : `${API}/evaluaciones/`;
    try {
      const r = await fetch(url, {
        method: previa ? 'PATCH' : 'POST',
        headers: { ...cabeceras(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...cuerpo, campania: campania.id,
                               tipo_activo: tipo, activo_fid: fid }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        const detalle = Object.entries(d)
          .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(' ') : v}`)
          .join(' · ');
        return { ok: false, error: detalle || `Error ${r.status}` };
      }
      setEvaluaciones(e => ({ ...e, [`${tipo}:${fid}`]: d }));

      // el avance cambia con cada evaluación
      try {
        const ra = await fetch(`${API}/campanias/${campania.id}/avance/`,
                               { headers: cabeceras() });
        if (ra.ok) setAvance((await ra.json()).detalle || []);
      } catch (e) { /* el avance se refresca al reabrir el panel */ }

      return { ok: true };
    } catch (e) {
      return { ok: false, error: 'No se pudo guardar' };
    }
  }, [campania, evaluaciones]);

  // Cambiar de campaña: recarga el avance y las evaluaciones de ese año.
  // Las geometrías no se vuelven a pedir: los activos son los mismos, lo
  // que cambia es su estado.
  const cambiarCampania = useCallback(async (id) => {
    const elegida = campanias.find(c => String(c.id) === String(id));
    if (!elegida) return;
    setCampania(elegida);
    try {
      const [ra, re] = await Promise.all([
        fetch(`${API}/campanias/${elegida.id}/avance/`, { headers: cabeceras() }),
        fetch(`${API}/evaluaciones/?campania=${elegida.anio}`, { headers: cabeceras() }),
      ]);
      if (ra.ok) setAvance((await ra.json()).detalle || []);
      if (re.ok) {
        const ev = await re.json();
        setEvaluaciones(Object.fromEntries(
          (ev.results || ev).map(e => [`${e.tipo_activo}:${e.activo_fid}`, e])
        ));
      }
    } catch (e) { setError('No se pudo cambiar de campaña'); }
  }, [campanias]);

  const totalVisibles = useMemo(
    () => Object.entries(visibles).filter(([, v]) => v)
      .reduce((a, [k]) => a + (datos[`${k}::${filtroCapa[k] || ambito}`]?.features?.length || 0), 0),
    [visibles, datos, ambito, filtroCapa]
  );

  // Lo que consumen los componentes: el GeoJSON del ámbito que rige
  // para esa capa en concreto.
  const datosDe = useCallback(
    (codigo) => datos[`${codigo}::${filtroCapa[codigo] || ambito}`],
    [datos, ambito, filtroCapa]
  );

  return {
    abierto, alternar, cerrar: () => setAbierto(false),
    campania, avance, totales, datos, visibles, cargando, error, iniciando,
    ambito, cambiarAmbito, ambitoDe, alternarAmbitoCapa, datosDe, clave,
    campanias, cambiarCampania, altas,
    evaluando, abrirEvaluacion, cerrarEvaluacion, guardarEvaluacion, formularios,
    alternarCapa, apagarTodas, evaluacionDe, totalVisibles, recargar: iniciar,
  };
}

/* ══════════════════════════════════════════════════════════
   Capas sobre el mapa — va DENTRO del <MapContainer>
   ══════════════════════════════════════════════════════════ */
export function CapasInventario({ inv }) {
  return (
    <>
      {TODAS.map(capa => {
        if (!inv.visibles[capa.codigo]) return null;
        const fc = inv.datosDe(capa.codigo);
        if (!fc?.features?.length) return null;

        // Líneas y polígonos: un solo GeoJSON por capa.
        if (capa.tipo === 'line' || capa.tipo === 'poly') {
          return (
            <GeoJSON
              key={`inv-${capa.codigo}`}
              data={fc}
              style={(f) => {
                // Las obras del PECH van más tenues: son contexto.
                const esPech = (f?.properties?.ambito) === 'PECH';
                return {
                  color: capa.color,
                  weight: capa.tipo === 'line' ? 3 : 1.5,
                  opacity: esPech ? 0.5 : 0.9,
                  dashArray: esPech ? '6 4' : null,
                  fillColor: capa.color,
                  fillOpacity: capa.tipo === 'poly' ? (esPech ? 0.06 : 0.12) : 0,
                };
              }}
              onEachFeature={(f, layer) => {
                const p = f.properties || {};
                const filas = Object.entries(p)
                  .filter(([k, v]) => v !== null && v !== '' && k !== 'fid')
                  .slice(0, 10)
                  .map(([k, v]) => `<tr><th>${k.replace(/_/g, ' ')}</th><td>${v}</td></tr>`)
                  .join('');
                const amb = p.ambito || '';
                const chip = amb
                  ? `<span class="inv-badge-ambito amb-${amb}">`
                    + `${amb === 'JURP' ? 'JURP' : amb === 'PECH' ? 'Chavimochic' : 'sin ámbito'}`
                    + '</span>'
                  : '';
                layer.bindPopup(
                  `<div class="inv-pop"><div class="inv-pop-tit">${capa.label}</div>
                   <div class="inv-pop-sub">${chip}</div>
                   <table class="inv-pop-tabla"><tbody>${filas}</tbody></table></div>`
                );
              }}
            />
          );
        }

        // Puntos: marcador propio para poder pintar el estado evaluado.
        return fc.features.map(f => {
          const c = f.geometry?.coordinates;
          if (!c) return null;
          const [lng, lat] = Array.isArray(c[0]) ? c[0] : c;  // MultiPoint o Point
          if (typeof lat !== 'number' || typeof lng !== 'number') return null;

          const p = f.properties || {};
          const ev = inv.evaluacionDe(capa.codigo, p.fid);

          return (
            <Marker
              key={`inv-${capa.codigo}-${p.fid}`}
              position={[lat, lng]}
              icon={iconoActivo(capa.color, ev?.estado_cons, p.ambito)}
            >
              <Popup>
                <div className="inv-pop">
                  <div className="inv-pop-tit" style={{ borderColor: capa.color }}>
                    {p.nombre || p.codigo || `${capa.label} #${p.fid}`}
                  </div>
                  <div className="inv-pop-sub">
                    {capa.label}
                    {p.ambito && (
                      <span className={`inv-badge-ambito amb-${p.ambito}`}>
                        {p.ambito === 'JURP' ? 'JURP' :
                         p.ambito === 'PECH' ? 'Chavimochic' : 'sin ámbito'}
                      </span>
                    )}
                  </div>

                  {/* tbody explícito: sin él React avisa de anidamiento inválido */}
                  <table className="inv-pop-tabla">
                    <tbody>
                      {p.nombre_canal && <tr><th>Canal</th><td>{p.nombre_canal}</td></tr>}
                      {p.progresiva != null && <tr><th>Progresiva</th><td>{p.progresiva}</td></tr>}
                      {p.tipo && <tr><th>Tipo</th><td>{p.tipo}</td></tr>}
                      {p.material && <tr><th>Material</th><td>{p.material}</td></tr>}
                      {p.estado && <tr><th>Estado (base)</th><td>{p.estado}</td></tr>}
                      {p.num_usuarios != null && <tr><th>Usuarios</th><td>{p.num_usuarios}</td></tr>}
                      {p.area_total != null && <tr><th>Área</th><td>{p.area_total} ha</td></tr>}
                      {p.observaciones && <tr><th>Obs.</th><td>{p.observaciones}</td></tr>}
                    </tbody>
                  </table>

                  {ev ? (
                    <div className="inv-pop-eval" style={{ '--e': COLOR_ESTADO[ev.estado_cons] }}>
                      <div className="inv-pop-eval-tit">
                        Campaña {ev.campania_anio || inv.campania?.anio} ·
                        evaluado el {ev.fecha}
                        {ev.evaluador && ` · ${ev.evaluador}`}
                      </div>
                      <div className="inv-pop-eval-estado">
                        {ETIQUETA_ESTADO[ev.estado_cons] || ev.estado_cons}
                        {ev.condicion && (
                          <span className="inv-pop-cond"
                            style={{ '--c': COLOR_CONDICION[ev.condicion] || '#868e96' }}>
                            {ev.condicion}
                          </span>
                        )}
                        {ev.requiere_mant && <span className="inv-pop-mant">requiere mantenimiento</span>}
                      </div>

                      {/* lo levantado en campo, comparado con el dato base */}
                      {ev.valores && Object.keys(ev.valores).length > 0 && (
                        <table className="inv-pop-valores">
                          <tbody>
                            {Object.entries(ev.valores).map(([k, v]) => {
                              const base = p[k];
                              const cambio = base !== undefined
                                && String(base) !== String(v);
                              return (
                                <tr key={k} className={cambio ? 'cambio' : ''}>
                                  <th>{k.replace(/_/g, ' ')}</th>
                                  <td>
                                    {cambio && <s>{String(base)}</s>}
                                    {ETIQUETA_ESTADO[v] || String(v)}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      )}

                      {ev.observaciones && <div className="inv-pop-eval-obs">{ev.observaciones}</div>}
                    </div>
                  ) : p.ambito === 'JURP' ? (
                    <div className="inv-pop-pend">
                      Sin evaluar en la campaña {inv.campania?.anio || ''}
                      {p.campania_alta > (inv.campania?.anio || 0) &&
                        ' — alta posterior a esta campaña'}
                    </div>
                  ) : p.ambito === 'PECH' ? (
                    <div className="inv-pop-pend">
                      Obra del PECH — fuera del alcance de la campaña
                    </div>
                  ) : null}

                  {/* solo lo que administra la Junta entra en la campaña */}
                  {p.ambito === 'JURP' && inv.campania
                    && inv.campania.estado !== 'cerrada' && (
                    <button type="button" className="inv-btn-evaluar"
                      onClick={() => inv.abrirEvaluacion(capa.codigo, p.fid, p)}>
                      {ev ? 'Editar evaluación' : 'Evaluar'}
                    </button>
                  )}
                </div>
              </Popup>
            </Marker>
          );
        });
      })}
    </>
  );
}

/* ══════════════════════════════════════════════════════════
   Formulario de evaluación

   Los campos no están escritos aquí: se piden a la API, que los devuelve
   con sus opciones ya resueltas. Agregar un campo evaluable en la base
   lo hace aparecer en este formulario sin tocar el visor.
   ══════════════════════════════════════════════════════════ */
export function ModalEvaluacion({ inv }) {
  const [valores, setValores] = useState({});
  const [resumen, setResumen] = useState({});
  const [guardando, setGuardando] = useState(false);
  const [fallo, setFallo] = useState(null);

  const ev = inv.evaluando;
  const campos = ev ? (inv.formularios[ev.tipo] || null) : null;
  const previa = ev ? inv.evaluacionDe(ev.tipo, ev.fid) : null;

  // Al abrir: precarga con la evaluación previa si existe, y si no con el
  // dato que ya tiene el inventario. El técnico confirma o corrige, en vez
  // de escribir todo de cero.
  useEffect(() => {
    if (!ev || !campos) return;
    const inicial = {};
    campos.forEach(c => {
      const dePrevia = previa?.valores?.[c.campo];
      const deBase = ev.props?.[c.campo];
      inicial[c.campo] = dePrevia !== undefined && dePrevia !== null
        ? dePrevia
        : (deBase !== undefined && deBase !== null ? deBase : '');
    });
    setValores(inicial);
    setResumen({
      evaluador: previa?.evaluador || localStorage.getItem('userName') || '',
      observaciones: previa?.observaciones || '',
      requiere_mant: previa?.requiere_mant || false,
      prioridad: previa?.prioridad || '',
    });
    setFallo(null);
  }, [ev?.tipo, ev?.fid, campos]);

  if (!ev) return null;

  const cambiar = (campo, v) => setValores(s => ({ ...s, [campo]: v }));

  const guardar = async () => {
    const faltan = (campos || [])
      .filter(c => c.obligatorio && (valores[c.campo] === '' || valores[c.campo] == null))
      .map(c => c.etiqueta);
    if (faltan.length) {
      setFallo(`Falta completar: ${faltan.join(', ')}`);
      return;
    }

    setGuardando(true);
    setFallo(null);

    // los numéricos viajan como número, no como texto
    const limpios = {};
    (campos || []).forEach(c => {
      const v = valores[c.campo];
      if (v === '' || v == null) return;
      limpios[c.campo] = (c.tipo_dato === 'numero' || c.tipo_dato === 'entero')
        ? Number(v) : v;
    });

    const r = await inv.guardarEvaluacion(ev.tipo, ev.fid, {
      valores: limpios,
      // se replican fuera del JSON para poder filtrar sin abrirlo
      estado_cons: limpios.estado ?? null,
      condicion: limpios.observacio ?? null,
      evaluador: resumen.evaluador || null,
      observaciones: resumen.observaciones || null,
      requiere_mant: !!resumen.requiere_mant,
      prioridad: resumen.prioridad || null,
    });

    setGuardando(false);
    if (r.ok) inv.cerrarEvaluacion();
    else setFallo(r.error);
  };

  const nombre = ev.props?.nombre || ev.props?.codigo || `#${ev.fid}`;

  return (
    <div className="inv-modal-fondo" onClick={inv.cerrarEvaluacion}>
      <div className="inv-modal gis-glass" onClick={e => e.stopPropagation()}>

        <div className="inv-modal-head">
          <div>
            <div className="inv-modal-tit">{nombre}</div>
            <div className="inv-modal-sub">
              {ev.tipo.replace(/_/g, ' ')} · campaña {inv.campania?.anio}
              {previa && <span className="inv-modal-previa">ya evaluado</span>}
            </div>
          </div>
          <button className="gis-tool" style={{ width: 26, height: 26 }}
            onClick={inv.cerrarEvaluacion}><FaTimes /></button>
        </div>

        <div className="inv-modal-body">
          {!campos && (
            <div className="inv-cargando">
              <FaSyncAlt className="icon-spin" /> Cargando formulario…
            </div>
          )}

          {campos && campos.length === 0 && (
            <div className="inv-error">
              <FaExclamationCircle /> Este tipo de activo no tiene campos
              evaluables definidos.
            </div>
          )}

          {campos && campos.map(c => {
            const base = ev.props?.[c.campo];
            const cambiado = base != null && String(base) !== String(valores[c.campo]);
            return (
              <div className="inv-campo" key={c.campo}>
                <label>
                  {c.etiqueta}
                  {c.obligatorio && <b className="inv-req">*</b>}
                  {cambiado && (
                    <span className="inv-campo-base">antes: {String(base)}</span>
                  )}
                </label>

                {c.tipo_dato === 'opcion' && c.opciones?.length ? (
                  <select value={valores[c.campo] ?? ''}
                          onChange={e => cambiar(c.campo, e.target.value)}>
                    <option value="">— sin dato —</option>
                    {c.opciones.map(o => (
                      <option key={o.codigo} value={o.codigo}>{o.etiqueta}</option>
                    ))}
                  </select>
                ) : c.tipo_dato === 'booleano' ? (
                  <input type="checkbox" checked={!!valores[c.campo]}
                         onChange={e => cambiar(c.campo, e.target.checked)} />
                ) : (
                  <input
                    type={c.tipo_dato === 'numero' || c.tipo_dato === 'entero'
                          ? 'number' : 'text'}
                    step={c.tipo_dato === 'numero' ? '0.01' : '1'}
                    value={valores[c.campo] ?? ''}
                    onChange={e => cambiar(c.campo, e.target.value)} />
                )}
              </div>
            );
          })}

          <div className="inv-modal-sep">Registro</div>

          <div className="inv-campo">
            <label>Evaluador</label>
            <input type="text" value={resumen.evaluador}
              placeholder="Nombre de quien evalúa"
              onChange={e => setResumen(s => ({ ...s, evaluador: e.target.value }))} />
          </div>

          <div className="inv-campo">
            <label>Observaciones</label>
            <textarea rows={2} value={resumen.observaciones}
              placeholder="Detalle de lo observado en campo"
              onChange={e => setResumen(s => ({ ...s, observaciones: e.target.value }))} />
          </div>

          <div className="inv-campo inv-campo-fila">
            <label>
              <input type="checkbox" checked={resumen.requiere_mant}
                onChange={e => setResumen(s => ({ ...s, requiere_mant: e.target.checked }))} />
              Requiere mantenimiento
            </label>
            {resumen.requiere_mant && (
              <select value={resumen.prioridad}
                onChange={e => setResumen(s => ({ ...s, prioridad: e.target.value }))}>
                <option value="">Prioridad…</option>
                <option value="alta">Alta</option>
                <option value="media">Media</option>
                <option value="baja">Baja</option>
              </select>
            )}
          </div>

          {fallo && (
            <div className="inv-error"><FaExclamationCircle /> {fallo}</div>
          )}
        </div>

        <div className="inv-modal-pie">
          <button className="inv-btn-sec" onClick={inv.cerrarEvaluacion}>
            Cancelar
          </button>
          <button className="inv-btn-pri" onClick={guardar}
                  disabled={guardando || !campos?.length}>
            {guardando ? 'Guardando…' : (previa ? 'Actualizar' : 'Guardar evaluación')}
          </button>
        </div>

      </div>
    </div>
  );
}


/* ══════════════════════════════════════════════════════════
   Badge de conteo: muestra cuántos hay según el filtro vigente,
   y con "todo" desglosa JURP/Chavimochic.
   ══════════════════════════════════════════════════════════ */
function BadgeCapa({ info, ambito, onFiltrar }) {
  if (info == null) return <span className="gis-capa-badge">—</span>;

  // el backend devuelve {total, jurp, pech} en las capas con ámbito
  const total = typeof info === 'number' ? info : info.total;
  const jurp = typeof info === 'object' ? info.jurp : undefined;
  const pech = typeof info === 'object' ? info.pech : undefined;

  // capa sin desglose (solo JURP, o base sin la columna): número simple
  if (jurp === undefined || (pech === 0 && jurp === total)) {
    return <span className="gis-capa-badge">{total}</span>;
  }

  const stop = (e, amb) => { e.preventDefault(); e.stopPropagation(); onFiltrar(amb); };

  // Qué ámbitos están marcados ahora mismo para esta capa.
  const verJurp = ambito === 'todo' || ambito === 'JURP';
  const verPech = ambito === 'todo' || ambito === 'PECH';

  return (
    <span className="inv-badge-doble">
      <button type="button"
        className={`amb-JURP ${verJurp ? '' : 'apagado'}`}
        title={`${jurp} de JURP — clic para ${verJurp ? 'ocultarlas' : 'mostrarlas'}`}
        onClick={(e) => stop(e, 'JURP')}>
        {jurp}
      </button>
      <button type="button"
        className={`amb-PECH ${verPech ? '' : 'apagado'}`}
        title={`${pech} del PECH — clic para ${verPech ? 'ocultarlas' : 'mostrarlas'}`}
        onClick={(e) => stop(e, 'PECH')}>
        {pech}
      </button>
    </span>
  );
}

/* ══════════════════════════════════════════════════════════
   Panel lateral — va FUERA del mapa
   ══════════════════════════════════════════════════════════ */
export function PanelInventario({ inv, onVolar }) {
  const [grupoAbierto, setGrupoAbierto] = useState({ 0: true });
  const [verAvance, setVerAvance] = useState(false);

  if (!inv.abierto) return null;

  const avanceTotal = inv.avance.reduce(
    (a, x) => ({ total: a.total + x.total, evaluados: a.evaluados + x.evaluados, criticos: a.criticos + x.criticos }),
    { total: 0, evaluados: 0, criticos: 0 }
  );
  const pct = avanceTotal.total ? (avanceTotal.evaluados / avanceTotal.total * 100) : 0;

  const volarACapa = (codigo) => {
    const fc = inv.datosDe(codigo);
    if (!fc?.features?.length || !onVolar) return;
    const capa = L.geoJSON(fc);
    onVolar(capa.getBounds());
  };

  return (
    <div className="gis-capas gis-glass inv-panel">
      <div className="gis-capas-head">
        <span className="gis-sub">Inventario JURP</span>
        <button className="gis-tool" style={{ width: 26, height: 26 }} onClick={inv.cerrar}>
          <FaTimes />
        </button>
      </div>

      <div className="gis-capas-body">

        {inv.iniciando && (
          <div className="inv-cargando"><FaSyncAlt className="icon-spin" /> Consultando inventario…</div>
        )}

        {inv.error && (
          <div className="inv-error">
            <FaExclamationCircle /> {inv.error}
            <button onClick={inv.recargar}>Reintentar</button>
          </div>
        )}

        {/* ── campaña y avance ── */}
        {inv.campania && (
          <div className="inv-campania">
            <div className="inv-campania-head">
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {inv.campanias.length > 1 ? (
                  <select className="inv-campania-select"
                    value={inv.campania.id}
                    onChange={e => inv.cambiarCampania(e.target.value)}
                    onClick={e => e.stopPropagation()}
                    title="Ver el estado registrado en otra campaña">
                    {inv.campanias.map(c => (
                      <option key={c.id} value={c.id}>Campaña {c.anio}</option>
                    ))}
                  </select>
                ) : (
                  <span className="inv-campania-anio">Campaña {inv.campania.anio}</span>
                )}
                <span className={`inv-campania-estado est-${inv.campania.estado}`}>
                  {inv.campania.estado.replace('_', ' ')}
                </span>
              </div>
              <button type="button" className="inv-campania-plegar"
                onClick={() => setVerAvance(v => !v)}
                title={verAvance ? 'Ocultar detalle' : 'Ver detalle por tipo'}>
                {verAvance ? <FaChevronDown size={10} /> : <FaChevronRight size={10} />}
              </button>
            </div>

            <div className="inv-barra">
              <div className="inv-barra-fill" style={{ width: `${pct}%` }} />
            </div>
            <div className="inv-barra-txt">
              {avanceTotal.evaluados.toLocaleString('es-PE')} de {avanceTotal.total.toLocaleString('es-PE')} evaluados
              <span>{pct.toFixed(1)}%</span>
            </div>
            {avanceTotal.criticos > 0 && (
              <div className="inv-criticos">
                <FaExclamationCircle /> {avanceTotal.criticos} en estado crítico
              </div>
            )}

            {inv.altas.length > 0 && (
              <div className="inv-altas">
                <FaPlusCircle /> {inv.altas.length} alta(s) de campo por validar
                <ul>
                  {inv.altas.slice(0, 4).map(a => (
                    <li key={a.id}>
                      <b>{a.tipo_activo}</b> {a.nombre || a.descripcion || `#${a.id}`}
                      {a.registrado_por && <span> · {a.registrado_por}</span>}
                    </li>
                  ))}
                  {inv.altas.length > 4 && <li>y {inv.altas.length - 4} más…</li>}
                </ul>
              </div>
            )}

            {verAvance && (
              <table className="inv-avance">
                <tbody>
                  {inv.avance.filter(a => a.total > 0).map(a => (
                    <tr key={a.tipo}>
                      <td>{a.nombre}</td>
                      <td className="inv-avance-num">{a.evaluados}/{a.total}</td>
                      <td className="inv-avance-pct">{a.porcentaje}%</td>
                      <td className={a.criticos ? 'inv-avance-crit' : ''}
                          title={a.criticos ? `${a.criticos} en estado malo o colapsado` : ''}>
                        {a.criticos || ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* ── filtro de ámbito ── */}
        <div className="inv-ambito">
          <div className="inv-ambito-tit">Mostrar</div>
          <div className="inv-ambito-btns">
            {AMBITOS.map(a => (
              <button key={a.valor} title={a.titulo}
                className={inv.ambito === a.valor ? 'activo' : ''}
                onClick={() => inv.cambiarAmbito(a.valor)}>
                {a.etiqueta}
              </button>
            ))}
          </div>
        </div>
        <div className="inv-nota" style={{ margin: '4px 2px 0' }}>
          En cada capa, los dos números funcionan como casillas: pulsa uno
          para mostrar u ocultar ese ámbito.
        </div>

        {/* ── capas ── */}
        <div className="gis-capas-acciones" style={{ marginTop: 8 }}>
          <button onClick={inv.apagarTodas}>Apagar todas</button>
          <span className="inv-visibles">{inv.totalVisibles.toLocaleString('es-PE')} en pantalla</span>
        </div>

        {TODOS_GRUPOS.map((g, i) => (
          <div className={`gis-capas-grupo ${g.contexto ? 'inv-grupo-contexto' : ''}`}
               key={g.titulo}>
            <div
              className="gis-capas-titulo inv-grupo-tit"
              onClick={() => setGrupoAbierto(s => ({ ...s, [i]: !s[i] }))}
            >
              {grupoAbierto[i] ? <FaChevronDown size={9} /> : <FaChevronRight size={9} />}
              {g.titulo}
            </div>

            {grupoAbierto[i] && g.capas.map(c => (
              <div key={c.codigo} className="gis-capa">
                <label>
                  <input
                    type="checkbox"
                    checked={!!inv.visibles[c.codigo]}
                    onChange={() => inv.alternarCapa(c.codigo)}
                  />
                  <span
                    style={{
                      display: 'inline-block',
                      width: 14,
                      height: c.tipo === 'line' ? 3 : 14,
                      background: c.color,
                      borderRadius: c.tipo === 'line' ? 2 : (c.tipo === 'poly' ? 3 : '50%'),
                    }}
                  />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.label}
                  </span>
                </label>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  {inv.cargando[c.codigo]
                    ? <FaSyncAlt className="icon-spin" size={11} style={{ color: '#74c0fc' }} />
                    : <BadgeCapa
                        info={inv.totales[c.codigo]}
                        ambito={inv.ambitoDe(c.codigo)}
                        onFiltrar={(amb) => inv.alternarAmbitoCapa(c.codigo, amb)} />}
                  {inv.datosDe(c.codigo) && (
                    <button
                      onClick={() => volarACapa(c.codigo)}
                      title="Centrar en esta capa"
                      style={{ background: 'none', border: 'none', color: '#74c0fc', cursor: 'pointer', display: 'flex', padding: 2 }}
                    >
                      <FaCrosshairs size={11} />
                    </button>
                  )}
                </span>
              </div>
            ))}
          </div>
        ))}

        {/* ── leyenda de estados ── */}
        <div className="gis-capas-grupo">
          <div className="gis-capas-titulo">Estado de conservación</div>
          <div className="inv-leyenda">
            {Object.entries(ETIQUETA_ESTADO).map(([k, v]) => (
              <span key={k} title={`Código ANA: ${k}`}>
                <i style={{ background: COLOR_ESTADO[k] }} />{v}
              </span>
            ))}
          </div>
          <div className="inv-nota">
            El anillo del marcador indica el estado evaluado en la campaña vigente.
            Sin anillo = pendiente de evaluar.
          </div>
        </div>

        <div className="gis-capas-grupo">
          <div className="gis-capas-titulo">Ámbito</div>
          <div className="inv-leyenda">
            <span><i className="inv-mini-jurp" />JURP · se evalúa</span>
            <span><i className="inv-mini-pech" />Chavimochic · contexto</span>
          </div>
          <div className="inv-nota">
            Los puntos huecos y las líneas punteadas son obras del PECH:
            se muestran como referencia y quedan fuera de la campaña.
          </div>
        </div>

      </div>
    </div>
  );
}

export { FaClipboardCheck };