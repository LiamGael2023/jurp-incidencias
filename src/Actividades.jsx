// ═══════════════════════════════════════════════════════════════════════════
//  Actividades de obra
// ═══════════════════════════════════════════════════════════════════════════
//
// Lo mismo que Incidentes, pero colgando de un PROYECTO en vez de un
// incidente. La diferencia no es cosmética: un incidente tiene tipo y
// gravedad porque algo falló; una actividad tiene obra, partidas y avance
// porque estaba presupuestada. Meter las dos en la misma pantalla obligaría a
// dejar medio formulario vacío en cada caso.
//
// EL PROYECTO NO TIENE CATÁLOGO PROPIO. Sale de las obras que tienen
// presupuesto cargado (/partidas/obras/), que es la única fuente que existe.
// Un segundo catálogo de proyectos sería una segunda verdad sobre lo mismo, y
// el día que no coincidieran nadie sabría cuál mirar.
//
// EL VALORIZADO que se muestra es metrado imputado × precio de la partida: lo
// que se le cobra al cliente. NO es lo que cuesta mover la máquina, que es
// otra cuenta y vive en el costeo. Mezclarlas es de donde salen las
// valorizaciones que no cuadran.

import { useState, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  FaPlus, FaSyncAlt, FaSearch, FaTimes, FaExclamationTriangle, FaHardHat,
  FaCheckCircle, FaPauseCircle, FaPlayCircle, FaTrash, FaEdit, FaClipboardList,
  FaCubes, FaMapMarkerAlt, FaUserTie, FaCalendarAlt, FaSpinner,
} from 'react-icons/fa';

const API = 'https://gideonstudio.duckdns.org/api/v1/mobile/operations';

const Portal = ({ children }) => createPortal(children, document.body);

const soles = (n) => 'S/ ' + (parseFloat(n) || 0).toLocaleString('es-PE',
  { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const dia = (iso) => {
  if (!iso) return '—';
  const [a, m, d] = String(iso).slice(0, 10).split('-');
  return `${d}/${m}/${a}`;
};

// Los tres estados, con su color y su icono. Verde/ámbar/gris y no el
// semáforo de gravedad: una actividad suspendida no es un peligro, es una
// actividad parada.
const ESTADOS = {
  ejecucion:  { texto: 'En ejecución', color: '#1463A5', fondo: '#eff6ff',
                borde: '#bfdbfe', icono: <FaPlayCircle /> },
  terminada:  { texto: 'Terminada',    color: '#15803d', fondo: '#f0fdf4',
                borde: '#bbf7d0', icono: <FaCheckCircle /> },
  suspendida: { texto: 'Suspendida',   color: '#92400e', fondo: '#fffbeb',
                borde: '#fde68a', icono: <FaPauseCircle /> },
};
const estadoDe = (e) => ESTADOS[e] || ESTADOS.ejecucion;

const VACIA = {
  obra: '', nombre: '', descripcion: '', ubicacion_text: '',
  responsable: '', estado: 'ejecucion', fecha_inicio: '', fecha_fin: '',
};

export default function Actividades() {
  const [obras, setObras] = useState([]);
  const [obra, setObra] = useState('');
  const [lista, setLista] = useState([]);
  const [resumen, setResumen] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState('');
  const [filtro, setFiltro] = useState('todas');
  const [busca, setBusca] = useState('');

  const [editando, setEditando] = useState(null);   // objeto o null
  const [guardando, setGuardando] = useState(false);
  const [detalle, setDetalle] = useState(null);
  const [borrando, setBorrando] = useState(null);

  // ── carga ─────────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`${API}/partidas/obras/`);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const j = await r.json();
        const l = Array.isArray(j) ? j : [];
        setObras(l);
        if (l.length) setObra(o => o || l[0].obra);
      } catch (e) {
        setError('No se pudo leer la lista de obras. ' + e.message);
      }
    })();
  }, []);

  const cargar = useCallback(async () => {
    setCargando(true); setError('');
    try {
      const q = obra ? `?obra=${encodeURIComponent(obra)}` : '';
      const [rl, rr] = await Promise.all([
        fetch(`${API}/actividades-obra/${q}`),
        fetch(`${API}/actividades-obra/resumen/${q}`),
      ]);
      if (rl.status === 404) {
        throw new Error('El backend todavía no tiene el módulo de actividades.');
      }
      if (!rl.ok) throw new Error('HTTP ' + rl.status);
      setLista(await rl.json());
      setResumen(rr.ok ? await rr.json() : null);
    } catch (e) {
      setLista([]); setError(e.message || String(e));
    } finally { setCargando(false); }
  }, [obra]);

  useEffect(() => { if (obra) cargar(); }, [obra, cargar]);

  // ── derivados ─────────────────────────────────────────────────────────
  const visibles = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return lista.filter(a => {
      if (filtro !== 'todas' && a.estado !== filtro) return false;
      if (!t) return true;
      return [a.nombre, a.codigo, a.ubicacion_text, a.responsable]
        .some(x => String(x || '').toLowerCase().includes(t));
    });
  }, [lista, filtro, busca]);

  const valorizadoTotal = useMemo(
    () => lista.reduce((s, a) => s + (a.avance?.valorizado || 0), 0), [lista]);
  const conDescuadre = useMemo(
    () => lista.filter(a => (a.avance?.metrado_otra_unidad || 0) > 0).length, [lista]);

  // ── acciones ──────────────────────────────────────────────────────────
  const guardar = async () => {
    if (!editando.nombre.trim()) { setError('Falta el nombre de la actividad.'); return; }
    setGuardando(true); setError('');
    try {
      const nueva = !editando.id;
      const r = await fetch(
        nueva ? `${API}/actividades-obra/` : `${API}/actividades-obra/${editando.id}/`,
        { method: nueva ? 'POST' : 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...editando, obra: editando.obra || obra }) });
      if (!r.ok) {
        let d = {}; try { d = await r.json(); } catch { d = {}; }
        throw new Error(d.detail || JSON.stringify(d).slice(0, 160));
      }
      setEditando(null);
      await cargar();
    } catch (e) {
      setError(e.message || String(e));
    } finally { setGuardando(false); }
  };

  const borrar = async (act, confirmar) => {
    setError('');
    try {
      const r = await fetch(
        `${API}/actividades-obra/${act.id}/${confirmar ? '?confirmar=si' : ''}`,
        { method: 'DELETE' });
      if (r.status === 409) {
        const d = await r.json();
        setBorrando({ act, aviso: d.detail, registros: d.registros });
        return;
      }
      if (!r.ok && r.status !== 204) throw new Error('HTTP ' + r.status);
      setBorrando(null); setDetalle(null);
      await cargar();
    } catch (e) {
      setError(e.message || String(e));
      setBorrando(null);
    }
  };

  // ── pintado ───────────────────────────────────────────────────────────
  const Tarjeta = ({ titulo, valor, pie, color, icono }) => (
    <div style={{ flex:'1 1 180px', minWidth:'180px', background:'#fff',
      border:'1px solid #e2e8f0', borderRadius:'10px', padding:'13px 15px',
      borderTop:`3px solid ${color}` }}>
      <div style={{ display:'flex', alignItems:'center', gap:'7px', fontSize:'11px',
        fontWeight:700, letterSpacing:'.03em', color:'#64748b',
        textTransform:'uppercase' }}>{icono} {titulo}</div>
      <div style={{ fontSize:'22px', fontWeight:800, color:'#1e293b',
        marginTop:'6px', lineHeight:1.1 }}>{valor}</div>
      {pie && <div style={{ fontSize:'11.5px', color:'#94a3b8', marginTop:'3px' }}>{pie}</div>}
    </div>
  );

  return (
    <div className="tbl-page-wrapper">

      {/* Cabecera */}
      <div className="tbl-page-header" style={{ display:'flex', alignItems:'flex-end',
        justifyContent:'space-between', gap:'14px', flexWrap:'wrap' }}>
        <div>
          <div className="tbl-page-pretitle">Ejecución de obra</div>
          <h2 className="tbl-page-title" style={{ display:'flex', alignItems:'center', gap:'9px' }}>
            <FaHardHat color="#1463A5" /> Actividades
          </h2>
          <div style={{ fontSize:'12.5px', color:'#64748b', marginTop:'3px' }}>
            {obras.find(o => o.obra === obra)?.proyecto
              || 'Trabajo programado, con sus partes diarios y su avance contra el presupuesto.'}
          </div>
        </div>
        <div style={{ display:'flex', gap:'9px', alignItems:'flex-end', flexWrap:'wrap' }}>
          <label style={{ fontSize:'11px', fontWeight:700, color:'#64748b' }}>
            <div style={{ marginBottom:'4px' }}>OBRA</div>
            <select value={obra} onChange={e => setObra(e.target.value)}
              style={ctrl({ minWidth:'190px' })}>
              {obras.length === 0 && <option value="">— sin presupuesto cargado —</option>}
              {obras.map(o => (
                <option key={o.obra} value={o.obra}>{o.obra} ({o.partidas})</option>
              ))}
            </select>
          </label>
          <button onClick={cargar} disabled={cargando} style={btnSec}>
            <FaSyncAlt size={11} className={cargando ? 'icon-spin' : ''} /> Actualizar
          </button>
          <button onClick={() => setEditando({ ...VACIA, obra })} disabled={!obra}
            style={btnPri}>
            <FaPlus size={11} /> Nueva actividad
          </button>
        </div>
      </div>

      <div className="tbl-page-body">

        {error && (
          <div style={aviso('#fef2f2', '#fecaca', '#b91c1c')}>
            <FaExclamationTriangle style={{ marginTop:'2px', flexShrink:0 }} />
            <span>{error}</span>
          </div>
        )}

        {/* Tarjetas */}
        <div style={{ display:'flex', gap:'12px', flexWrap:'wrap', marginBottom:'14px' }}>
          <Tarjeta titulo="Actividades" valor={resumen?.total ?? lista.length}
            pie={`${resumen?.por_estado?.ejecucion || 0} en ejecución`}
            color="#1463A5" icono={<FaClipboardList size={10} />} />
          <Tarjeta titulo="Terminadas" valor={resumen?.por_estado?.terminada || 0}
            color="#059669" icono={<FaCheckCircle size={10} />} />
          <Tarjeta titulo="Suspendidas" valor={resumen?.por_estado?.suspendida || 0}
            color="#d97706" icono={<FaPauseCircle size={10} />} />
          <Tarjeta titulo="Valorizado" valor={soles(valorizadoTotal)}
            pie="metrado imputado × precio de partida"
            color="#64748b" icono={<FaCubes size={10} />} />
        </div>

        {/* Metrado que no se pudo contar: va arriba, no escondido al final */}
        {conDescuadre > 0 && (
          <div style={aviso('#fef2f2', '#fecaca', '#b91c1c')}>
            <FaExclamationTriangle style={{ marginTop:'2px', flexShrink:0 }} />
            <span>
              <b>{conDescuadre} actividad(es)</b> tienen metrado imputado en una unidad
              distinta a la de su partida. Ese metrado <b>no se valorizó</b>: sumar m³ con
              m² daría un avance falso. Están marcadas en la tabla.
            </span>
          </div>
        )}

        {/* Filtros */}
        <div style={{ display:'flex', gap:'8px', alignItems:'center', flexWrap:'wrap',
          marginBottom:'12px' }}>
          {[['todas', 'Todas'], ['ejecucion', 'En ejecución'],
            ['terminada', 'Terminadas'], ['suspendida', 'Suspendidas']].map(([k, t]) => (
            <button key={k} onClick={() => setFiltro(k)}
              style={{ padding:'6px 13px', borderRadius:'7px', fontSize:'12.5px',
                fontWeight:600, cursor:'pointer', fontFamily:'inherit',
                border:`1px solid ${filtro === k ? '#1463A5' : '#e2e8f0'}`,
                background: filtro === k ? '#eff6ff' : '#fff',
                color: filtro === k ? '#1463A5' : '#64748b' }}>
              {t}
            </button>
          ))}
          <div style={{ position:'relative', marginLeft:'auto' }}>
            <FaSearch size={12} style={{ position:'absolute', left:'11px', top:'10px',
              color:'#94a3b8' }} />
            <input value={busca} onChange={e => setBusca(e.target.value)}
              placeholder="Buscar por nombre, código, zona…"
              style={ctrl({ paddingLeft:'32px', minWidth:'250px' })} />
          </div>
        </div>

        {/* Tabla */}
        <div style={{ background:'#fff', border:'1px solid #e2e8f0', borderRadius:'10px',
          overflow:'hidden' }}>
          {cargando && !lista.length ? (
            <div style={{ padding:'50px', textAlign:'center', color:'#64748b',
              fontSize:'13px' }}>
              <FaSpinner className="icon-spin" style={{ marginRight:'8px' }} /> Cargando…
            </div>
          ) : visibles.length === 0 ? (
            <div style={{ padding:'44px 24px', textAlign:'center', color:'#64748b',
              fontSize:'13px', lineHeight:1.6 }}>
              {lista.length === 0
                ? <>No hay actividades en esta obra todavía.<br />
                    <span style={{ color:'#94a3b8' }}>
                      Crea la primera con «Nueva actividad». Después le cuelgas los partes
                      diarios y el avance sale solo.</span></>
                : 'Ninguna actividad coincide con el filtro.'}
            </div>
          ) : (
            <div style={{ overflowX:'auto' }}>
              <table style={{ width:'100%', minWidth:'900px', borderCollapse:'collapse',
                fontSize:'12.5px' }}>
                <thead>
                  <tr style={{ background:'#f8fafc', color:'#64748b', fontSize:'11px',
                    textTransform:'uppercase', letterSpacing:'.03em' }}>
                    {['Código', 'Actividad', 'Zona', 'Responsable', 'Inicio',
                      'Partes', 'Valorizado', 'Estado', ''].map((h, i) => (
                      <th key={i} style={{ textAlign: i >= 5 && i <= 6 ? 'right' : 'left',
                        padding:'9px 12px', fontWeight:700, whiteSpace:'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visibles.map(a => {
                    const est = estadoDe(a.estado);
                    const descuadre = (a.avance?.metrado_otra_unidad || 0) > 0;
                    return (
                      <tr key={a.id} onClick={() => setDetalle(a)}
                        style={{ borderTop:'1px solid #f1f5f9', cursor:'pointer' }}
                        onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
                        onMouseLeave={e => e.currentTarget.style.background = '#fff'}>
                        <td style={{ padding:'10px 12px', fontFamily:'monospace',
                          fontSize:'11.5px', color:'#64748b', whiteSpace:'nowrap' }}>
                          {a.codigo || '—'}
                        </td>
                        <td style={{ padding:'10px 12px', color:'#1e293b', fontWeight:600 }}>
                          {a.nombre}
                          {descuadre && (
                            <span title="Tiene metrado en una unidad distinta a la de su partida"
                              style={{ marginLeft:'7px', color:'#dc2626' }}>
                              <FaExclamationTriangle size={11} />
                            </span>
                          )}
                        </td>
                        <td style={{ padding:'10px 12px', color:'#64748b' }}>
                          {a.ubicacion_text || '—'}</td>
                        <td style={{ padding:'10px 12px', color:'#64748b' }}>
                          {a.responsable || '—'}</td>
                        <td style={{ padding:'10px 12px', color:'#64748b',
                          whiteSpace:'nowrap' }}>{dia(a.fecha_inicio)}</td>
                        <td style={{ padding:'10px 12px', textAlign:'right',
                          color: a.partes ? '#1e293b' : '#cbd5e1', fontWeight:600 }}>
                          {a.partes}</td>
                        <td style={{ padding:'10px 12px', textAlign:'right', fontWeight:700,
                          color: a.avance?.valorizado ? '#1463A5' : '#cbd5e1',
                          whiteSpace:'nowrap' }}>
                          {soles(a.avance?.valorizado)}</td>
                        <td style={{ padding:'10px 12px' }}>
                          <span style={{ display:'inline-flex', alignItems:'center',
                            gap:'5px', fontSize:'11.5px', fontWeight:700,
                            padding:'3px 9px', borderRadius:'12px',
                            background:est.fondo, color:est.color,
                            border:`1px solid ${est.borde}`, whiteSpace:'nowrap' }}>
                            {est.icono} {est.texto}
                          </span>
                        </td>
                        <td style={{ padding:'10px 12px', textAlign:'right',
                          whiteSpace:'nowrap' }}>
                          <button onClick={e => { e.stopPropagation(); setEditando({ ...a }); }}
                            title="Editar" style={btnIco}><FaEdit size={13} /></button>
                          <button onClick={e => { e.stopPropagation(); borrar(a, false); }}
                            title="Eliminar" style={{ ...btnIco, color:'#dc2626' }}>
                            <FaTrash size={12} /></button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div style={{ fontSize:'11.5px', color:'#94a3b8', marginTop:'12px',
          lineHeight:1.6 }}>
          El valorizado es metrado imputado × precio del presupuesto: lo que se le cobra
          al cliente. No es el costo de operar la maquinaria, que se calcula aparte.
        </div>
      </div>

      {/* ── Modal: crear o editar ──────────────────────────────────────── */}
      {editando && (
        <Portal>
          <div onClick={() => !guardando && setEditando(null)} style={fondo}>
            <div onClick={e => e.stopPropagation()} style={dialogo('620px')}>
              <div style={cabecera}>
                <div>
                  <div style={{ fontSize:'16px', fontWeight:700, color:'#0b2545' }}>
                    {editando.id ? 'Editar actividad' : 'Nueva actividad'}
                  </div>
                  <div style={{ fontSize:'12px', color:'#64748b', marginTop:'2px' }}>
                    {editando.id
                      ? editando.codigo
                      : `En ${editando.obra || obra}. El código se asigna solo.`}
                  </div>
                </div>
                <button onClick={() => setEditando(null)} style={btnCerrar}><FaTimes /></button>
              </div>

              <div style={{ padding:'16px 20px', overflowY:'auto', background:'#f8fafc' }}>
                <Campo etiqueta="ACTIVIDAD" obligatorio>
                  <input value={editando.nombre} autoFocus
                    onChange={e => setEditando({ ...editando, nombre: e.target.value })}
                    placeholder="Excavación de caja de derivación"
                    style={ctrl({ width:'100%' })} />
                </Campo>

                <Campo etiqueta="DESCRIPCIÓN">
                  <textarea value={editando.descripcion || ''} rows={2}
                    onChange={e => setEditando({ ...editando, descripcion: e.target.value })}
                    placeholder="Qué comprende y cualquier cosa que convenga dejar escrita."
                    style={ctrl({ width:'100%', resize:'vertical', lineHeight:1.5 })} />
                </Campo>

                <div style={{ display:'flex', gap:'12px', flexWrap:'wrap' }}>
                  <Campo etiqueta="ZONA / PROGRESIVA" ancho="1 1 240px">
                    <input value={editando.ubicacion_text || ''}
                      onChange={e => setEditando({ ...editando, ubicacion_text: e.target.value })}
                      placeholder="Prog. 2+300" style={ctrl({ width:'100%' })} />
                  </Campo>
                  <Campo etiqueta="RESPONSABLE" ancho="1 1 240px">
                    <input value={editando.responsable || ''}
                      onChange={e => setEditando({ ...editando, responsable: e.target.value })}
                      placeholder="Residente o capataz" style={ctrl({ width:'100%' })} />
                  </Campo>
                </div>

                <div style={{ display:'flex', gap:'12px', flexWrap:'wrap' }}>
                  <Campo etiqueta="INICIO REAL" ancho="1 1 160px">
                    <input type="date" value={editando.fecha_inicio || ''}
                      onChange={e => setEditando({ ...editando, fecha_inicio: e.target.value })}
                      style={ctrl({ width:'100%' })} />
                  </Campo>
                  <Campo etiqueta="FIN REAL" ancho="1 1 160px">
                    <input type="date" value={editando.fecha_fin || ''}
                      onChange={e => setEditando({ ...editando, fecha_fin: e.target.value })}
                      style={ctrl({ width:'100%' })} />
                  </Campo>
                  <Campo etiqueta="ESTADO" ancho="1 1 180px">
                    <select value={editando.estado}
                      onChange={e => setEditando({ ...editando, estado: e.target.value })}
                      style={ctrl({ width:'100%' })}>
                      {Object.entries(ESTADOS).map(([k, v]) => (
                        <option key={k} value={k}>{v.texto}</option>
                      ))}
                    </select>
                  </Campo>
                </div>

                {/* Las fechas son REALES, no programadas, y conviene decirlo:
                    si alguien las lee como previstas, cualquier informe que
                    compare contra ellas dirá cosas que nadie midió. */}
                <div style={{ fontSize:'11.5px', color:'#94a3b8', marginTop:'4px',
                  lineHeight:1.5 }}>
                  Las fechas son las <b>reales</b>, no las programadas. El cronograma no
                  está cargado todavía, así que aquí no hay nada contra qué comparar.
                </div>
              </div>

              <div style={pie}>
                <button onClick={() => setEditando(null)} disabled={guardando}
                  style={btnSec}>Cancelar</button>
                <button onClick={guardar} disabled={guardando || !editando.nombre.trim()}
                  style={btnPri}>
                  {guardando ? <FaSpinner className="icon-spin" /> : <FaCheckCircle />}
                  {' '}{editando.id ? 'Guardar' : 'Crear'}
                </button>
              </div>
            </div>
          </div>
        </Portal>
      )}

      {/* ── Modal: ficha ───────────────────────────────────────────────── */}
      {detalle && (
        <Portal>
          <div onClick={() => setDetalle(null)} style={fondo}>
            <div onClick={e => e.stopPropagation()} style={dialogo('760px')}>
              <div style={cabecera}>
                <div>
                  <div style={{ fontSize:'16px', fontWeight:700, color:'#0b2545' }}>
                    {detalle.nombre}
                  </div>
                  <div style={{ fontSize:'12px', color:'#64748b', marginTop:'2px',
                    fontFamily:'monospace' }}>
                    {detalle.codigo} · {detalle.obra}
                  </div>
                </div>
                <button onClick={() => setDetalle(null)} style={btnCerrar}><FaTimes /></button>
              </div>

              <div style={{ padding:'16px 20px', overflowY:'auto', background:'#f8fafc' }}>
                <div style={{ display:'flex', gap:'10px', flexWrap:'wrap',
                  marginBottom:'14px' }}>
                  <Dato icono={<FaMapMarkerAlt />} titulo="Zona"
                    valor={detalle.ubicacion_text || '—'} />
                  <Dato icono={<FaUserTie />} titulo="Responsable"
                    valor={detalle.responsable || '—'} />
                  <Dato icono={<FaCalendarAlt />} titulo="Inicio"
                    valor={dia(detalle.fecha_inicio)} />
                  <Dato icono={<FaCalendarAlt />} titulo="Fin"
                    valor={dia(detalle.fecha_fin)} />
                </div>

                {detalle.descripcion && (
                  <div style={{ background:'#fff', border:'1px solid #e2e8f0',
                    borderRadius:'9px', padding:'12px 14px', marginBottom:'14px',
                    fontSize:'13px', color:'#1e293b', lineHeight:1.6,
                    whiteSpace:'pre-wrap' }}>
                    {detalle.descripcion}
                  </div>
                )}

                <div style={{ display:'flex', gap:'12px', flexWrap:'wrap',
                  marginBottom:'14px' }}>
                  <Tarjeta titulo="Partes diarios" valor={detalle.partes}
                    color="#1463A5" icono={<FaClipboardList size={10} />} />
                  <Tarjeta titulo="Valorizado"
                    valor={soles(detalle.avance?.valorizado)}
                    pie="al precio del presupuesto"
                    color="#059669" icono={<FaCubes size={10} />} />
                </div>

                {(detalle.avance?.metrado_otra_unidad || 0) > 0 && (
                  <div style={aviso('#fef2f2', '#fecaca', '#b91c1c')}>
                    <FaExclamationTriangle style={{ marginTop:'2px', flexShrink:0 }} />
                    <span>
                      <b>{detalle.avance.metrado_otra_unidad}</b> de metrado imputado en una
                      unidad distinta a la de su partida. No se valorizó. Corrige la unidad
                      en esas líneas del parte.
                    </span>
                  </div>
                )}

                {detalle.partes === 0 && (
                  <div style={aviso('#fffbeb', '#fde68a', '#92400e')}>
                    <FaExclamationTriangle style={{ marginTop:'2px', flexShrink:0 }} />
                    <span>
                      Esta actividad no tiene partes diarios todavía, así que su avance es
                      cero. El avance no se escribe a mano: sale del metrado que se imputa
                      a las partidas en cada parte.
                    </span>
                  </div>
                )}
              </div>

              <div style={pie}>
                <button onClick={() => { setEditando({ ...detalle }); setDetalle(null); }}
                  style={btnSec}><FaEdit /> Editar</button>
                <button onClick={() => setDetalle(null)} style={btnPri}>Cerrar</button>
              </div>
            </div>
          </div>
        </Portal>
      )}

      {/* ── Modal: confirmar borrado ───────────────────────────────────── */}
      {borrando && (
        <Portal>
          <div onClick={() => setBorrando(null)} style={fondo}>
            <div onClick={e => e.stopPropagation()} style={dialogo('500px')}>
              <div style={{ padding:'20px' }}>
                <div style={{ fontSize:'16px', fontWeight:800, color:'#b91c1c',
                  display:'flex', alignItems:'center', gap:'9px', marginBottom:'9px' }}>
                  <FaExclamationTriangle /> Esto borra trabajo registrado
                </div>
                <div style={{ fontSize:'13px', color:'#1e293b', lineHeight:1.6 }}>
                  <b>{borrando.act.nombre}</b> tiene <b>{borrando.registros} registro(s)</b>
                  {' '}colgando: partes diarios, personal y materiales. Borrarla se los lleva
                  por delante y no se puede deshacer.
                </div>
              </div>
              <div style={pie}>
                <button onClick={() => setBorrando(null)} style={btnSec}>Cancelar</button>
                <button onClick={() => borrar(borrando.act, true)}
                  style={{ ...btnPri, background:'#dc2626' }}>
                  <FaTrash /> Borrar de todas formas
                </button>
              </div>
            </div>
          </div>
        </Portal>
      )}
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
const Campo = ({ etiqueta, obligatorio, ancho, children }) => (
  <div style={{ flex: ancho || '1 1 100%', marginBottom:'11px' }}>
    <label style={{ display:'block', fontSize:'11px', fontWeight:700, color:'#475569',
      marginBottom:'4px' }}>
      {etiqueta}{obligatorio && <span style={{ color:'#dc2626' }}> *</span>}
    </label>
    {children}
  </div>
);

const Dato = ({ icono, titulo, valor }) => (
  <div style={{ flex:'1 1 150px', minWidth:'150px', background:'#fff',
    border:'1px solid #e2e8f0', borderRadius:'9px', padding:'10px 12px' }}>
    <div style={{ display:'flex', alignItems:'center', gap:'6px', fontSize:'10.5px',
      fontWeight:700, color:'#94a3b8', textTransform:'uppercase' }}>
      {icono} {titulo}
    </div>
    <div style={{ fontSize:'13px', color:'#1e293b', fontWeight:600, marginTop:'3px' }}>
      {valor}
    </div>
  </div>
);

const ctrl = (extra = {}) => ({
  padding:'9px 11px', border:'1px solid #cbd5e1', borderRadius:'7px',
  fontSize:'13px', fontFamily:'inherit', background:'#fff', boxSizing:'border-box',
  ...extra,
});

const aviso = (fondo, borde, color) => ({
  background:fondo, border:`1px solid ${borde}`, borderRadius:'9px',
  padding:'11px 14px', fontSize:'12.5px', color, marginBottom:'14px',
  display:'flex', gap:'9px', alignItems:'flex-start', lineHeight:1.6,
});

const btnBase = {
  display:'inline-flex', alignItems:'center', gap:'7px', borderRadius:'7px',
  padding:'9px 14px', fontSize:'12.5px', fontWeight:600, cursor:'pointer',
  fontFamily:'inherit',
};
const btnSec = { ...btnBase, background:'#fff', color:'#475569', border:'1px solid #cbd5e1' };
const btnPri = { ...btnBase, background:'#1463A5', color:'#fff', border:'none' };
const btnIco = { background:'transparent', border:'none', cursor:'pointer',
  color:'#64748b', padding:'5px 6px', lineHeight:1 };
const btnCerrar = { background:'transparent', border:'none', cursor:'pointer',
  color:'#64748b', fontSize:'17px', lineHeight:1 };

const fondo = { position:'fixed', inset:0, zIndex:100000, background:'rgba(2,8,20,.6)',
  display:'flex', alignItems:'center', justifyContent:'center', padding:'16px' };
const dialogo = (ancho) => ({ background:'#fff', borderRadius:'13px', width:'100%',
  maxWidth:ancho, maxHeight:'92vh', display:'flex', flexDirection:'column',
  overflow:'hidden', fontFamily:'system-ui, -apple-system, Segoe UI, Roboto, sans-serif' });
const cabecera = { padding:'14px 20px', borderBottom:'1px solid #e2e8f0',
  display:'flex', alignItems:'center', justifyContent:'space-between', gap:'12px' };
const pie = { padding:'12px 20px', borderTop:'1px solid #e2e8f0', background:'#fff',
  display:'flex', gap:'9px', justifyContent:'flex-end', flexWrap:'wrap' };
