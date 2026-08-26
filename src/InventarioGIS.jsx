import { useState, useEffect, useCallback, useMemo } from 'react';
import { GeoJSON, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import {
  FaClipboardCheck, FaTimes, FaSyncAlt, FaCrosshairs,
  FaChevronDown, FaChevronRight, FaExclamationCircle,
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

const TODAS = GRUPOS.flatMap(g => g.capas);
const META = Object.fromEntries(TODAS.map(c => [c.codigo, c]));

// Colores por estado de conservación evaluado.
const COLOR_ESTADO = {
  bueno: '#2f9e44', regular: '#f59f00', malo: '#e8590c',
  colapsado: '#c92a2a', no_ubicado: '#868e96',
};

const ETIQUETA_ESTADO = {
  bueno: 'Bueno', regular: 'Regular', malo: 'Malo',
  colapsado: 'Colapsado', no_ubicado: 'No ubicado',
};

const token = () => localStorage.getItem('userToken');
const cabeceras = () => ({ Authorization: `Token ${token()}` });

// Punto con anillo de color: relleno = capa, borde = estado evaluado.
const iconoActivo = (color, estado) => L.divIcon({
  className: 'inv-marker-wrap',
  html: `<span class="inv-marker" style="--c:${color};--e:${estado ? COLOR_ESTADO[estado] : 'transparent'}"></span>`,
  iconSize: [16, 16],
  iconAnchor: [8, 8],
  popupAnchor: [0, -8],
});

/* ══════════════════════════════════════════════════════════
   Hook: estado del módulo
   ══════════════════════════════════════════════════════════ */
export function useInventario() {
  const [abierto, setAbierto] = useState(false);
  const [campania, setCampania] = useState(null);
  const [avance, setAvance] = useState([]);
  const [totales, setTotales] = useState({});
  const [datos, setDatos] = useState({});        // codigo → FeatureCollection
  const [visibles, setVisibles] = useState({});  // codigo → bool
  const [cargando, setCargando] = useState({});  // codigo → bool
  const [evaluaciones, setEvaluaciones] = useState({}); // "tipo:fid" → evaluación
  const [error, setError] = useState(null);
  const [iniciando, setIniciando] = useState(false);

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
      const activa = lista.find(c => c.estado === 'en_proceso') || lista[0];
      setCampania(activa || null);

      const caps = await rt.json();
      setTotales(Object.fromEntries((caps.results || caps).map(c => [c.codigo, c.total])));

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
      }
    } catch (e) {
      setError(e.message || 'Error al cargar el inventario');
    } finally {
      setIniciando(false);
    }
  }, []);

  // Trae el GeoJSON de una capa la primera vez que se enciende.
  const cargarCapa = useCallback(async (codigo) => {
    if (datos[codigo]) return;
    setCargando(c => ({ ...c, [codigo]: true }));
    try {
      const r = await fetch(`${API}/capas/${codigo}/?srid=4326`, { headers: cabeceras() });
      if (r.ok) {
        // El JSON se resuelve ANTES de tocar el estado: el actualizador de
        // useState es síncrono y no admite await dentro.
        const geo = await r.json();
        setDatos(d => ({ ...d, [codigo]: geo }));
      }
    } catch (e) { /* la capa queda vacía; el badge lo refleja */ }
    finally { setCargando(c => ({ ...c, [codigo]: false })); }
  }, [datos]);

  const alternarCapa = useCallback((codigo) => {
    setVisibles(v => {
      const nuevo = !v[codigo];
      if (nuevo) cargarCapa(codigo);
      return { ...v, [codigo]: nuevo };
    });
  }, [cargarCapa]);

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

  const totalVisibles = useMemo(
    () => Object.entries(visibles).filter(([, v]) => v)
      .reduce((a, [k]) => a + (datos[k]?.features?.length || 0), 0),
    [visibles, datos]
  );

  return {
    abierto, alternar, cerrar: () => setAbierto(false),
    campania, avance, totales, datos, visibles, cargando, error, iniciando,
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
        const fc = inv.datos[capa.codigo];
        if (!fc?.features?.length) return null;

        // Líneas y polígonos: un solo GeoJSON por capa.
        if (capa.tipo === 'line' || capa.tipo === 'poly') {
          return (
            <GeoJSON
              key={`inv-${capa.codigo}`}
              data={fc}
              style={{
                color: capa.color,
                weight: capa.tipo === 'line' ? 3 : 1.5,
                opacity: 0.9,
                fillColor: capa.color,
                fillOpacity: capa.tipo === 'poly' ? 0.12 : 0,
              }}
              onEachFeature={(f, layer) => {
                const p = f.properties || {};
                const filas = Object.entries(p)
                  .filter(([k, v]) => v !== null && v !== '' && k !== 'fid')
                  .slice(0, 10)
                  .map(([k, v]) => `<tr><th>${k.replace(/_/g, ' ')}</th><td>${v}</td></tr>`)
                  .join('');
                layer.bindPopup(
                  `<div class="inv-pop"><div class="inv-pop-tit">${capa.label}</div>
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
              icon={iconoActivo(capa.color, ev?.estado_cons)}
            >
              <Popup>
                <div className="inv-pop">
                  <div className="inv-pop-tit" style={{ borderColor: capa.color }}>
                    {p.nombre || p.codigo || `${capa.label} #${p.fid}`}
                  </div>
                  <div className="inv-pop-sub">{capa.label}</div>

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
                        Evaluado el {ev.fecha}
                        {ev.evaluador && ` · ${ev.evaluador}`}
                      </div>
                      <div className="inv-pop-eval-estado">
                        {ETIQUETA_ESTADO[ev.estado_cons] || ev.estado_cons}
                        {ev.requiere_mant && <span className="inv-pop-mant">requiere mantenimiento</span>}
                      </div>
                      {ev.observaciones && <div className="inv-pop-eval-obs">{ev.observaciones}</div>}
                    </div>
                  ) : (
                    <div className="inv-pop-pend">Sin evaluar en esta campaña</div>
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
    const fc = inv.datos[codigo];
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
            <div className="inv-campania-head" onClick={() => setVerAvance(v => !v)}>
              <div>
                <span className="inv-campania-anio">Campaña {inv.campania.anio}</span>
                <span className={`inv-campania-estado est-${inv.campania.estado}`}>
                  {inv.campania.estado.replace('_', ' ')}
                </span>
              </div>
              {verAvance ? <FaChevronDown size={10} /> : <FaChevronRight size={10} />}
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

            {verAvance && (
              <table className="inv-avance">
                <tbody>
                  {inv.avance.filter(a => a.total > 0).map(a => (
                    <tr key={a.tipo}>
                      <td>{a.nombre}</td>
                      <td className="inv-avance-num">{a.evaluados}/{a.total}</td>
                      <td className="inv-avance-pct">{a.porcentaje}%</td>
                      <td className={a.criticos ? 'inv-avance-crit' : ''}>{a.criticos || ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* ── capas ── */}
        <div className="gis-capas-acciones" style={{ marginTop: 8 }}>
          <button onClick={inv.apagarTodas}>Apagar todas</button>
          <span className="inv-visibles">{inv.totalVisibles.toLocaleString('es-PE')} en pantalla</span>
        </div>

        {GRUPOS.map((g, i) => (
          <div className="gis-capas-grupo" key={g.titulo}>
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
                    : <span className="gis-capa-badge">{inv.totales[c.codigo] ?? '—'}</span>}
                  {inv.datos[c.codigo] && (
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
              <span key={k}><i style={{ background: COLOR_ESTADO[k] }} />{v}</span>
            ))}
          </div>
          <div className="inv-nota">
            El anillo del marcador indica el estado evaluado en la campaña vigente.
            Sin anillo = pendiente de evaluar.
          </div>
        </div>

      </div>
    </div>
  );
}

export { FaClipboardCheck };