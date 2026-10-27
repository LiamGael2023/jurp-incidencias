// ─────────────────────────────────────────────────────────────────────────
//  AvanceFisico — lo ejecutado en metrado, no en soles
// ─────────────────────────────────────────────────────────────────────────
//
// POR QUE EXISTE. El tablero de arriba valoriza: ejecutado = metrado × precio
// de la partida. Es lo que se le cobra al cliente, y es el número que importa
// casi siempre. Pero un presupuesto importado de Excel sin la columna de
// precios deja todas las partidas a 0.00, y entonces una obra con 750 de
// 3.000 m hechos se ve EXACTAMENTE igual que una obra sin empezar: S/ 0.00 y
// 0 %. Las dos cosas no son lo mismo y la pantalla no las distinguía.
//
// LOS METRADOS NO SE SUMAN ENTRE UNIDADES, y eso manda sobre todo el diseño.
// Una estructura con partidas en m, m³ y Gln no tiene un «total ejecutado»
// físico: sumarlos daría un número con las unidades mezcladas, que es
// exactamente la clase de dato que luego alguien cita en una reunión. Por eso
// aquí:
//
//   · cada PARTIDA lleva su avance en su propia unidad, que siempre es cierto;
//   · cada ESTRUCTURA lleva un subtotal POR UNIDAD, uno por cada una que use;
//   · y NO hay un porcentaje físico único de la obra. Para eso hace falta
//     ponderar, y lo único que pondera partidas de distinta unidad es el
//     precio — que es justamente lo que falta cuando esta sección hace
//     falta—. En su lugar se dice cuántas partidas tienen ejecución, que es
//     un dato y no una media inventada.
//
// DE DONDE SALEN LOS DATOS. De /partidas/?obra=X, que ya devuelve metrado,
// ejecutado, saldo, avance y unidad por partida. No hizo falta tocar el
// backend.

import { useState, useEffect, useCallback, useMemo } from 'react';
import { FaRulerCombined, FaExclamationTriangle } from 'react-icons/fa';
import { API_OPS } from './api';

const cant = (n) => (parseFloat(n) || 0).toLocaleString('es-PE',
  { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (n) => (parseFloat(n) || 0).toFixed(2) + ' %';

/** La estructura a la que cuelga una partida: el primer tramo de su ruta. */
const estructuraDe = (p) => {
  try {
    const r = JSON.parse(p.ruta || '[]');
    if (Array.isArray(r) && r.length) return { codigo: r[0][0], nombre: r[0][1] };
  } catch { /* ruta mal formada: va al cajón de sin estructura */ }
  return { codigo: '—', nombre: 'SIN ESTRUCTURA' };
};

export default function AvanceFisico({ obra }) {
  const [filas, setFilas] = useState([]);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState('');
  const [todas, setTodas] = useState(false);

  const cargar = useCallback(async () => {
    if (!obra) return;
    setCargando(true); setError('');
    try {
      const r = await fetch(`${API_OPS}/partidas/?obra=${encodeURIComponent(obra)}`);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      const lista = Array.isArray(j) ? j : (j.partidas || []);
      setFilas(lista.filter(p => !p.es_titulo && p.activo !== false));
    } catch (e) {
      setFilas([]); setError('No se pudo leer el metrado de las partidas. ' + e.message);
    } finally { setCargando(false); }
  }, [obra]);

  useEffect(() => { cargar(); }, [cargar]);

  const grupos = useMemo(() => {
    const visibles = todas ? filas : filas.filter(p => (parseFloat(p.ejecutado) || 0) > 0);
    const mapa = new Map();
    visibles.forEach(p => {
      const e = estructuraDe(p);
      const k = `${e.codigo}|${e.nombre}`;
      if (!mapa.has(k)) mapa.set(k, { ...e, partidas: [], porUnidad: {} });
      const g = mapa.get(k);
      g.partidas.push(p);
      // Un subtotal POR UNIDAD. Nunca uno solo: ver la cabecera del archivo.
      const u = (p.unidad || '—').trim();
      if (!g.porUnidad[u]) g.porUnidad[u] = { presupuestado: 0, ejecutado: 0 };
      g.porUnidad[u].presupuestado += parseFloat(p.metrado) || 0;
      g.porUnidad[u].ejecutado += parseFloat(p.ejecutado) || 0;
    });
    return [...mapa.values()].sort((a, b) => String(a.codigo).localeCompare(String(b.codigo)));
  }, [filas, todas]);

  const conEjec = filas.filter(p => (parseFloat(p.ejecutado) || 0) > 0).length;
  const sinPrecio = filas.length > 0 && filas.every(p => !(parseFloat(p.precio) > 0));

  if (!obra) return null;

  return (
    <div style={caja}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center',
        gap:'10px', flexWrap:'wrap', marginBottom:'4px' }}>
        <div>
          <div style={{ fontSize:'14px', fontWeight:700, color:'#1e293b',
            display:'flex', alignItems:'center', gap:'8px' }}>
            <FaRulerCombined color="#1463A5" /> Avance físico por partida
          </div>
          <div style={{ fontSize:'11.5px', color:'#94a3b8', marginTop:'2px' }}>
            Metrado ejecutado contra el presupuestado, cada partida en su unidad.
          </div>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:'12px', flexWrap:'wrap' }}>
          <span style={{ fontSize:'11.5px', color:'#94a3b8' }}>
            {conEjec} de {filas.length} partidas con ejecución
          </span>
          <label style={{ display:'inline-flex', alignItems:'center', gap:'6px',
            fontSize:'12px', color:'#475569', cursor:'pointer' }}>
            <input type="checkbox" checked={todas} onChange={e => setTodas(e.target.checked)} />
            Ver también las que no han empezado
          </label>
        </div>
      </div>

      {/* Si el presupuesto no tiene precios, el tablero de arriba sale todo a
          cero y parece que no se ha hecho nada. Decirlo aquí, donde se ve que
          sí se hizo, es lo que cierra el malentendido. */}
      {sinPrecio && (
        <div style={avisoCaja}>
          <FaExclamationTriangle style={{ marginTop:'2px', flexShrink:0 }} />
          <span>
            Ninguna partida de este presupuesto tiene precio unitario, así que
            todo lo valorizado de arriba sale en <b>S/ 0.00</b> aunque el
            trabajo esté hecho. El avance real es el de esta tabla. Cargando
            los precios, el resto del tablero se llena solo.
          </span>
        </div>
      )}

      {error && <div style={avisoCaja}>{error}</div>}
      {cargando && !filas.length && <div style={nota}>Consultando…</div>}

      {!cargando && !error && grupos.length === 0 && (
        <div style={nota}>
          {todas
            ? 'Este presupuesto no tiene partidas cargadas.'
            : 'Todavía no hay metrado imputado a ninguna partida de esta obra.'}
        </div>
      )}

      {grupos.map(g => (
        <div key={`${g.codigo}|${g.nombre}`} style={{ marginTop:'14px' }}>
          <div style={{ display:'flex', alignItems:'baseline', gap:'8px',
            flexWrap:'wrap', marginBottom:'5px' }}>
            <span style={{ fontFamily:'monospace', fontSize:'11.5px', color:'#64748b' }}>
              {g.codigo}
            </span>
            <span style={{ fontSize:'13px', fontWeight:700, color:'#1e293b' }}>
              {g.nombre}
            </span>
            {/* Un subtotal por cada unidad que use la estructura. Si usa tres,
                salen tres: no hay forma honesta de juntarlos en uno. */}
            {Object.entries(g.porUnidad).map(([u, t]) => (
              <span key={u} style={pastilla}>
                {cant(t.ejecutado)} / {cant(t.presupuestado)} {u}
              </span>
            ))}
          </div>

          <div style={{ overflowX:'auto' }}>
            <table style={{ width:'100%', minWidth:'640px', borderCollapse:'collapse',
              fontSize:'12.5px' }}>
              <thead>
                <tr style={{ background:'#f8fafc', color:'#64748b', fontSize:'11px',
                  textTransform:'uppercase', letterSpacing:'.03em' }}>
                  <th style={{ ...th, textAlign:'left' }}>Ítem</th>
                  <th style={{ ...th, textAlign:'left' }}>Partida</th>
                  <th style={th}>Unid.</th>
                  <th style={th}>Presupuestado</th>
                  <th style={th}>Ejecutado</th>
                  <th style={th}>Saldo</th>
                  <th style={{ ...th, textAlign:'left', width:'170px' }}>Avance</th>
                </tr>
              </thead>
              <tbody>
                {g.partidas.map(p => {
                  const prog = parseFloat(p.metrado) || 0;
                  const ejec = parseFloat(p.ejecutado) || 0;
                  const a = parseFloat(p.avance) || 0;
                  const pasada = a > 100;
                  return (
                    <tr key={p.id} style={{ borderTop:'1px solid #f1f5f9',
                      background: ejec > 0 ? '#fff' : '#fcfdfe' }}>
                      <td style={{ ...td, fontFamily:'monospace', fontSize:'11.5px',
                        color:'#64748b', whiteSpace:'nowrap' }}>{p.codigo}</td>
                      <td style={{ ...td, color:'#1e293b' }}>{p.descripcion}</td>
                      <td style={{ ...td, textAlign:'right', color:'#64748b' }}>{p.unidad}</td>
                      <td style={{ ...td, textAlign:'right', color:'#64748b',
                        whiteSpace:'nowrap' }}>{cant(prog)}</td>
                      <td style={{ ...td, textAlign:'right', fontWeight:700,
                        color: ejec > 0 ? '#1463A5' : '#cbd5e1',
                        whiteSpace:'nowrap' }}>{cant(ejec)}</td>
                      <td style={{ ...td, textAlign:'right',
                        color: (prog - ejec) < 0 ? '#b91c1c' : '#64748b',
                        whiteSpace:'nowrap' }}>{cant(prog - ejec)}</td>
                      <td style={td}>
                        <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
                          <div style={{ flex:1, height:'8px', background:'#f1f5f9',
                            borderRadius:'5px', overflow:'hidden', minWidth:'60px' }}>
                            <div style={{ width:`${Math.min(100, a)}%`, height:'100%',
                              borderRadius:'5px',
                              background: pasada ? '#dc2626' : '#1463A5' }} />
                          </div>
                          <span style={{ fontSize:'11.5px', fontWeight:700, minWidth:'52px',
                            textAlign:'right', color: pasada ? '#dc2626' : '#475569' }}>
                            {pct(a)}
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {grupos.length > 0 && (
        <div style={{ fontSize:'11px', color:'#94a3b8', marginTop:'14px', lineHeight:1.6 }}>
          No hay un porcentaje físico único de la obra, y es a propósito: lo
          único que permite ponderar partidas de distinta unidad es el precio.
          Sin precios, una media entre metros y galones sería un número que
          nadie midió.
        </div>
      )}
    </div>
  );
}

const caja = { background:'#fff', border:'1px solid #e2e8f0', borderRadius:'10px',
  padding:'16px 18px', marginTop:'16px' };
const th = { padding:'9px 10px', fontWeight:700, textAlign:'right' };
const td = { padding:'9px 10px', verticalAlign:'middle' };
const nota = { fontSize:'12.5px', color:'#64748b', textAlign:'center', padding:'18px' };
const pastilla = { background:'#e0f2fe', color:'#0369a1', borderRadius:'10px',
  padding:'2px 9px', fontSize:'11px', fontWeight:700 };
const avisoCaja = { background:'#fffbeb', border:'1px solid #fde68a', borderRadius:'8px',
  padding:'10px 12px', fontSize:'12px', color:'#92400e', margin:'10px 0 0',
  display:'flex', gap:'9px', alignItems:'flex-start', lineHeight:1.6 };
