// ═══════════════════════════════════════════════════════════════════════════
//  Proyectos
// ═══════════════════════════════════════════════════════════════════════════
//
// Lo primero que se crea. Un proyecto tiene su presupuesto, y de ese
// presupuesto salen las partidas que las actividades imputan.
//
// EL ORDEN IMPORTA Y LA PANTALLA LO EMPUJA. Un proyecto sin presupuesto no
// sirve para nada: sus actividades no tendrían partidas que elegir y su
// avance sería siempre cero. Por eso los proyectos sin presupuesto salen
// marcados y con el botón de importar delante, en vez de parecer completos.
//
// LOS DOS NÚMEROS SE ENSEÑAN JUNTOS. El costo directo que declara el Excel y
// la suma real de las partidas cargadas. Mientras cuadren, una sola cifra
// bastaría; el día que dejen de cuadrar, enseñar solo una escondería
// justamente el problema.

import { useState, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  FaPlus, FaSyncAlt, FaTimes, FaExclamationTriangle, FaCheckCircle,
  FaFolderOpen, FaFileExcel, FaTrash, FaEdit, FaSpinner,
  FaMapMarkerAlt, FaSearch,
} from 'react-icons/fa';
import ModalImportarPresupuesto from './ImportarPresupuesto';

const API = 'https://gideonstudio.duckdns.org/api/v1/mobile/operations';

const Portal = ({ children }) => createPortal(children, document.body);

const soles = (n) => 'S/ ' + (parseFloat(n) || 0).toLocaleString('es-PE',
  { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dia = (iso) => {
  if (!iso) return '—';
  const [a, m, d] = String(iso).slice(0, 10).split('-');
  return `${d}/${m}/${a}`;
};

const ESTADOS = {
  activo:     { texto: 'Activo',     color: '#1463A5', fondo: '#eff6ff', borde: '#bfdbfe' },
  terminado:  { texto: 'Terminado',  color: '#15803d', fondo: '#f0fdf4', borde: '#bbf7d0' },
  suspendido: { texto: 'Suspendido', color: '#92400e', fondo: '#fffbeb', borde: '#fde68a' },
};

const VACIO = {
  codigo: '', nombre: '', entidad: '', ubicacion: '',
  fecha_inicio: '', plazo_dias: '', estado: 'activo',
};

export default function Proyectos() {
  const [lista, setLista] = useState([]);
  const [importando, setImportando] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState('');
  const [busca, setBusca] = useState('');
  const [editando, setEditando] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [borrando, setBorrando] = useState(null);

  const cargar = useCallback(async () => {
    setCargando(true); setError('');
    try {
      const r = await fetch(`${API}/proyectos/`);
      if (r.status === 404) throw new Error('El backend todavía no tiene el módulo de proyectos.');
      if (!r.ok) throw new Error('HTTP ' + r.status);
      setLista(await r.json());
    } catch (e) {
      setLista([]); setError(e.message || String(e));
    } finally { setCargando(false); }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const visibles = useMemo(() => {
    const t = busca.trim().toLowerCase();
    if (!t) return lista;
    return lista.filter(p => [p.codigo, p.nombre, p.entidad, p.ubicacion]
      .some(x => String(x || '').toLowerCase().includes(t)));
  }, [lista, busca]);

  const sinPresupuesto = useMemo(
    () => lista.filter(p => !p.partidas).length, [lista]);
  const descuadrados = useMemo(
    () => lista.filter(p => p.partidas &&
      Math.abs((p.suma_partidas || 0) - parseFloat(p.costo_directo || 0)) > 1), [lista]);

  const guardar = async () => {
    if (!editando.codigo.trim() || !editando.nombre.trim()) {
      setError('El código y el nombre son obligatorios.'); return;
    }
    setGuardando(true); setError('');
    try {
      const nuevo = !editando.id;
      const cuerpo = { ...editando };
      if (cuerpo.plazo_dias === '') cuerpo.plazo_dias = null;
      if (cuerpo.fecha_inicio === '') cuerpo.fecha_inicio = null;
      const r = await fetch(
        nuevo ? `${API}/proyectos/` : `${API}/proyectos/${editando.id}/`,
        { method: nuevo ? 'POST' : 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(cuerpo) });
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

  const borrar = async (pro, confirmar) => {
    setError('');
    try {
      const r = await fetch(
        `${API}/proyectos/${pro.id}/${confirmar ? '?confirmar=si' : ''}`,
        { method: 'DELETE' });
      if (r.status === 409) {
        const d = await r.json();
        setBorrando({ pro, aviso: d.detail }); return;
      }
      if (!r.ok && r.status !== 204) throw new Error('HTTP ' + r.status);
      setBorrando(null);
      await cargar();
    } catch (e) {
      setError(e.message || String(e)); setBorrando(null);
    }
  };

  return (
    <div className="tbl-page-wrapper">

      <div className="tbl-page-header" style={{ display:'flex', alignItems:'flex-end',
        justifyContent:'space-between', gap:'14px', flexWrap:'wrap' }}>
        <div>
          <div className="tbl-page-pretitle">Obra</div>
          <h2 className="tbl-page-title" style={{ display:'flex', alignItems:'center', gap:'9px' }}>
            <FaFolderOpen color="#1463A5" /> Proyectos
          </h2>
          <div style={{ fontSize:'12.5px', color:'#64748b', marginTop:'3px' }}>
            Se crea el proyecto, se le importa su presupuesto, y de ahí salen las
            partidas que imputan las actividades.
          </div>
        </div>
        <div style={{ display:'flex', gap:'9px', alignItems:'flex-end', flexWrap:'wrap' }}>
          <div style={{ position:'relative' }}>
            <FaSearch size={12} style={{ position:'absolute', left:'11px', top:'11px',
              color:'#94a3b8' }} />
            <input value={busca} onChange={e => setBusca(e.target.value)}
              placeholder="Buscar proyecto…"
              style={ctrl({ paddingLeft:'32px', minWidth:'230px' })} />
          </div>
          <button onClick={cargar} disabled={cargando} style={btnSec}>
            <FaSyncAlt size={11} className={cargando ? 'icon-spin' : ''} /> Actualizar
          </button>
          <button onClick={() => setEditando({ ...VACIO })} style={btnPri}>
            <FaPlus size={11} /> Nuevo proyecto
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

        {/* Un proyecto sin presupuesto no es un proyecto a medias: es uno que
            todavía no sirve. Conviene decirlo arriba. */}
        {sinPresupuesto > 0 && (
          <div style={aviso('#fffbeb', '#fde68a', '#92400e')}>
            <FaExclamationTriangle style={{ marginTop:'2px', flexShrink:0 }} />
            <span>
              <b>{sinPresupuesto} proyecto(s)</b> no tienen presupuesto cargado. Sus
              actividades no van a tener partidas que elegir y su avance será siempre
              cero. Impórtales el Excel desde el botón verde.
            </span>
          </div>
        )}

        {descuadrados.length > 0 && (
          <div style={aviso('#fef2f2', '#fecaca', '#b91c1c')}>
            <FaExclamationTriangle style={{ marginTop:'2px', flexShrink:0 }} />
            <span>
              <b>{descuadrados.length} proyecto(s)</b> tienen partidas que no suman su
              costo directo declarado. Falta alguna partida o se cargó un presupuesto
              incompleto: <b>{descuadrados.map(p => p.codigo).join(', ')}</b>.
            </span>
          </div>
        )}

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
                ? <>Todavía no hay proyectos.<br />
                    <span style={{ color:'#94a3b8' }}>
                      Crea el primero y después impórtale su presupuesto.</span></>
                : 'Ningún proyecto coincide con la búsqueda.'}
            </div>
          ) : (
            <div style={{ overflowX:'auto' }}>
              <table style={{ width:'100%', minWidth:'980px', borderCollapse:'collapse',
                fontSize:'12.5px' }}>
                <thead>
                  <tr style={{ background:'#f8fafc', color:'#64748b', fontSize:'11px',
                    textTransform:'uppercase', letterSpacing:'.03em' }}>
                    {['Código', 'Proyecto', 'Entidad', 'Inicio', 'Partidas',
                      'Costo directo', 'Actividades', 'Estado', ''].map((h, i) => (
                      <th key={i} style={{ textAlign: i >= 4 && i <= 6 ? 'right' : 'left',
                        padding:'9px 12px', fontWeight:700, whiteSpace:'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visibles.map(p => {
                    const est = ESTADOS[p.estado] || ESTADOS.activo;
                    const sinPres = !p.partidas;
                    const descuadra = p.partidas &&
                      Math.abs((p.suma_partidas || 0) - parseFloat(p.costo_directo || 0)) > 1;
                    return (
                      <tr key={p.id} style={{ borderTop:'1px solid #f1f5f9',
                        background: sinPres ? '#fffdf7' : '#fff' }}>
                        <td style={{ padding:'10px 12px', fontFamily:'monospace',
                          fontSize:'11.5px', color:'#64748b', whiteSpace:'nowrap' }}>
                          {p.codigo}</td>
                        <td style={{ padding:'10px 12px', color:'#1e293b', fontWeight:600,
                          maxWidth:'330px' }}>
                          {p.nombre}
                          {p.ubicacion && (
                            <div style={{ fontSize:'11px', color:'#94a3b8', fontWeight:400,
                              marginTop:'2px' }}>
                              <FaMapMarkerAlt size={9} /> {p.ubicacion}
                            </div>
                          )}
                        </td>
                        <td style={{ padding:'10px 12px', color:'#64748b' }}>
                          {p.entidad || '—'}</td>
                        <td style={{ padding:'10px 12px', color:'#64748b',
                          whiteSpace:'nowrap' }}>{dia(p.fecha_inicio)}</td>
                        <td style={{ padding:'10px 12px', textAlign:'right',
                          fontWeight:700, color: sinPres ? '#d97706' : '#1e293b' }}>
                          {sinPres
                            ? <span style={{ fontSize:'11.5px' }}>sin presupuesto</span>
                            : p.partidas}
                        </td>
                        <td style={{ padding:'10px 12px', textAlign:'right',
                          whiteSpace:'nowrap' }}>
                          <div style={{ fontWeight:700,
                            color: descuadra ? '#dc2626' : '#1463A5' }}>
                            {soles(p.costo_directo)}
                          </div>
                          {/* Los dos números juntos, siempre. Si enseñara solo
                              uno, el día que dejaran de cuadrar escondería
                              justamente el problema. */}
                          {p.partidas > 0 && (
                            <div style={{ fontSize:'10.5px',
                              color: descuadra ? '#dc2626' : '#94a3b8', marginTop:'1px' }}>
                              suman {soles(p.suma_partidas)}
                            </div>
                          )}
                        </td>
                        <td style={{ padding:'10px 12px', textAlign:'right',
                          color: p.actividades ? '#1e293b' : '#cbd5e1' }}>
                          {p.actividades}</td>
                        <td style={{ padding:'10px 12px' }}>
                          <span style={{ fontSize:'11.5px', fontWeight:700,
                            padding:'3px 9px', borderRadius:'12px', background:est.fondo,
                            color:est.color, border:`1px solid ${est.borde}`,
                            whiteSpace:'nowrap' }}>{est.texto}</span>
                        </td>
                        <td style={{ padding:'10px 12px', textAlign:'right',
                          whiteSpace:'nowrap' }}>
                          <button onClick={() => setImportando(p)}
                            title={sinPres ? 'Importar el presupuesto'
                                           : 'Volver a importar el presupuesto'}
                            style={{ ...btnIco, color: sinPres ? '#15803d' : '#64748b',
                              background: sinPres ? '#f0fdf4' : 'transparent',
                              border: sinPres ? '1px solid #bbf7d0' : 'none',
                              borderRadius:'6px', padding:'5px 9px', fontWeight:700,
                              fontSize:'11.5px' }}>
                            <FaFileExcel size={12} />{sinPres ? ' Importar' : ''}
                          </button>
                          <button onClick={() => setEditando({ ...p })} title="Editar"
                            style={btnIco}><FaEdit size={13} /></button>
                          <button onClick={() => borrar(p, false)} title="Eliminar"
                            style={{ ...btnIco, color:'#dc2626' }}><FaTrash size={12} /></button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ── Crear o editar ─────────────────────────────────────────────── */}
      {editando && (
        <Portal>
          <div onClick={() => !guardando && setEditando(null)} style={fondo}>
            <div onClick={e => e.stopPropagation()} style={dialogo('620px')}>
              <div style={cabecera}>
                <div>
                  <div style={{ fontSize:'16px', fontWeight:700, color:'#0b2545' }}>
                    {editando.id ? 'Editar proyecto' : 'Nuevo proyecto'}
                  </div>
                  <div style={{ fontSize:'12px', color:'#64748b', marginTop:'2px' }}>
                    {editando.id
                      ? 'El código no se puede cambiar una vez creado.'
                      : 'Después le importas el presupuesto desde el Excel.'}
                  </div>
                </div>
                <button onClick={() => setEditando(null)} style={btnCerrar}><FaTimes /></button>
              </div>

              <div style={{ padding:'16px 20px', overflowY:'auto', background:'#f8fafc' }}>
                <div style={{ display:'flex', gap:'12px', flexWrap:'wrap' }}>
                  <Campo etiqueta="CÓDIGO" obligatorio ancho="0 0 180px">
                    <input value={editando.codigo} disabled={!!editando.id} autoFocus
                      onChange={e => setEditando({ ...editando, codigo: e.target.value })}
                      placeholder="TOMA-10.6"
                      style={ctrl({ width:'100%', fontFamily:'monospace',
                        background: editando.id ? '#f1f5f9' : '#fff' })} />
                  </Campo>
                  <Campo etiqueta="ESTADO" ancho="0 0 170px">
                    <select value={editando.estado}
                      onChange={e => setEditando({ ...editando, estado: e.target.value })}
                      style={ctrl({ width:'100%' })}>
                      {Object.entries(ESTADOS).map(([k, v]) => (
                        <option key={k} value={k}>{v.texto}</option>
                      ))}
                    </select>
                  </Campo>
                </div>

                <Campo etiqueta="NOMBRE DEL PROYECTO" obligatorio>
                  <textarea value={editando.nombre} rows={2}
                    onChange={e => setEditando({ ...editando, nombre: e.target.value })}
                    placeholder="CONSTRUCCION Y MEJORAMIENTO DE OBRAS DE TRATAMIENTO DE AGUA EN TOMA 10.6"
                    style={ctrl({ width:'100%', resize:'vertical', lineHeight:1.5 })} />
                </Campo>

                <div style={{ display:'flex', gap:'12px', flexWrap:'wrap' }}>
                  <Campo etiqueta="ENTIDAD CONTRATANTE" ancho="1 1 260px">
                    <input value={editando.entidad || ''}
                      onChange={e => setEditando({ ...editando, entidad: e.target.value })}
                      placeholder="JURP" style={ctrl({ width:'100%' })} />
                  </Campo>
                  <Campo etiqueta="UBICACIÓN" ancho="1 1 260px">
                    <input value={editando.ubicacion || ''}
                      onChange={e => setEditando({ ...editando, ubicacion: e.target.value })}
                      placeholder="Virú — La Libertad" style={ctrl({ width:'100%' })} />
                  </Campo>
                </div>

                <div style={{ display:'flex', gap:'12px', flexWrap:'wrap' }}>
                  <Campo etiqueta="INICIO" ancho="1 1 170px">
                    <input type="date" value={editando.fecha_inicio || ''}
                      onChange={e => setEditando({ ...editando, fecha_inicio: e.target.value })}
                      style={ctrl({ width:'100%' })} />
                  </Campo>
                  <Campo etiqueta="PLAZO (DÍAS)" ancho="1 1 170px">
                    <input type="number" min="0" value={editando.plazo_dias ?? ''}
                      onChange={e => setEditando({ ...editando, plazo_dias: e.target.value })}
                      placeholder="120" style={ctrl({ width:'100%' })} />
                  </Campo>
                </div>

                {editando.id && editando.partidas > 0 && (
                  <div style={{ background:'#fff', border:'1px solid #e2e8f0',
                    borderRadius:'9px', padding:'12px 14px', marginTop:'6px',
                    fontSize:'12.5px', color:'#475569', lineHeight:1.7 }}>
                    <b>Presupuesto cargado</b> — {editando.partidas} partidas<br />
                    Costo directo {soles(editando.costo_directo)} ·
                    GG {soles(editando.gastos_generales)} ·
                    Utilidad {soles(editando.utilidad)}<br />
                    IGV {soles(editando.igv)} · <b>Total {soles(editando.total)}</b>
                  </div>
                )}
              </div>

              <div style={pie}>
                <button onClick={() => setEditando(null)} disabled={guardando}
                  style={btnSec}>Cancelar</button>
                <button onClick={guardar} style={btnPri}
                  disabled={guardando || !editando.codigo.trim() || !editando.nombre.trim()}>
                  {guardando ? <FaSpinner className="icon-spin" /> : <FaCheckCircle />}
                  {' '}{editando.id ? 'Guardar' : 'Crear'}
                </button>
              </div>
            </div>
          </div>
        </Portal>
      )}

      {/* ── Confirmar borrado ──────────────────────────────────────────── */}
      {borrando && (
        <Portal>
          <div onClick={() => setBorrando(null)} style={fondo}>
            <div onClick={e => e.stopPropagation()} style={dialogo('520px')}>
              <div style={{ padding:'20px' }}>
                <div style={{ fontSize:'16px', fontWeight:800, color:'#b91c1c',
                  display:'flex', alignItems:'center', gap:'9px', marginBottom:'9px' }}>
                  <FaExclamationTriangle /> Esto se lleva el presupuesto y las actividades
                </div>
                <div style={{ fontSize:'13px', color:'#1e293b', lineHeight:1.6 }}>
                  {borrando.aviso}
                </div>
              </div>
              <div style={pie}>
                <button onClick={() => setBorrando(null)} style={btnSec}>Cancelar</button>
                <button onClick={() => borrar(borrando.pro, true)}
                  style={{ ...btnPri, background:'#dc2626' }}>
                  <FaTrash /> Borrar de todas formas
                </button>
              </div>
            </div>
          </div>
        </Portal>
      )}

      {/* ── Importar el presupuesto ─────────────────────────────────────── */}
      {importando && (
        <ModalImportarPresupuesto
          proyecto={importando}
          api={API}
          onCerrar={() => setImportando(null)}
          onCargado={() => { cargar(); }}
        />
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

const ctrl = (extra = {}) => ({
  padding:'9px 11px', border:'1px solid #cbd5e1', borderRadius:'7px',
  fontSize:'13px', fontFamily:'inherit', background:'#fff', boxSizing:'border-box',
  ...extra,
});
const aviso = (f, b, c) => ({ background:f, border:`1px solid ${b}`, borderRadius:'9px',
  padding:'11px 14px', fontSize:'12.5px', color:c, marginBottom:'14px',
  display:'flex', gap:'9px', alignItems:'flex-start', lineHeight:1.6 });
const btnBase = { display:'inline-flex', alignItems:'center', gap:'7px',
  borderRadius:'7px', padding:'9px 14px', fontSize:'12.5px', fontWeight:600,
  cursor:'pointer', fontFamily:'inherit' };
const btnSec = { ...btnBase, background:'#fff', color:'#475569', border:'1px solid #cbd5e1' };
const btnPri = { ...btnBase, background:'#1463A5', color:'#fff', border:'none' };
const btnIco = { background:'transparent', border:'none', cursor:'pointer',
  color:'#64748b', padding:'5px 6px', lineHeight:1, display:'inline-flex',
  alignItems:'center', gap:'4px', fontFamily:'inherit' };
const btnCerrar = { background:'transparent', border:'none', cursor:'pointer',
  color:'#64748b', fontSize:'17px', lineHeight:1 };
const fondo = { position:'fixed', inset:0, zIndex:100000, background:'rgba(2,8,20,.6)',
  display:'flex', alignItems:'center', justifyContent:'center', padding:'16px' };
const dialogo = (ancho) => ({ background:'#fff', borderRadius:'13px', width:'100%',
  maxWidth:ancho, maxHeight:'92vh', display:'flex', flexDirection:'column',
  overflow:'hidden', fontFamily:'system-ui, -apple-system, Segoe UI, Roboto, sans-serif' });
const cabecera = { padding:'14px 20px', borderBottom:'1px solid #e2e8f0', display:'flex',
  alignItems:'center', justifyContent:'space-between', gap:'12px' };
const pie = { padding:'12px 20px', borderTop:'1px solid #e2e8f0', background:'#fff',
  display:'flex', gap:'9px', justifyContent:'flex-end', flexWrap:'wrap' };
