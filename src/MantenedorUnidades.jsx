// ═══════════════════════════════════════════════════════════════════════════
//  Mantenedor de unidades de medida
// ═══════════════════════════════════════════════════════════════════════════
//
// POR QUE EXISTE. Las partidas del presupuesto se miden en algo —m3, H-H,
// Glb— y hasta ahora esa lista eran siete valores escritos dentro del código
// de React. El botón «gestionar» que había en la ventana de costeo no
// guardaba nada: lo que se añadía vivía en la memoria del navegador y
// desaparecía al recargar. Peor que no tenerlo, porque parecía funcionar.
//
// VIVE EN PROYECTOS a propósito. Es donde se crea la obra y se le importa el
// presupuesto; la unidad es parte de ese vocabulario, no de un parte diario
// concreto. Quien configura un proyecto lo configura entero desde el mismo
// sitio.
//
// DESACTIVAR NO ES BORRAR, y el servidor lo impone: un DELETE pone
// `activo=false`. Las partidas guardan el código como texto, así que si la
// fila desapareciera, las que ya usan "m3" mostrarían un código que no está
// en ningún catálogo y nadie podría comprobar qué significaba.
//
// EL CÓDIGO SE RESPETA TAL CUAL. "H-H" no es "h-h": ese texto sale impreso
// en los informes y en el Excel. Lo único que se impide es que convivan dos
// que solo se distingan por las mayúsculas.

import { useState, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  FaPlus, FaTimes, FaSyncAlt, FaSearch, FaEdit, FaCheck,
  FaExclamationTriangle, FaBan, FaUndo, FaRulerCombined,
} from 'react-icons/fa';
import { API_OPS } from './api';

const API = `${API_OPS}/unidades/`;

const Portal = ({ children }) => createPortal(children, document.body);

const VACIA = { codigo: '', nombre: '' };

export default function MantenedorUnidades({ onCerrar, onCambio }) {
  const [lista, setLista] = useState([]);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState('');
  const [busca, setBusca] = useState('');
  const [verInactivas, setVerInactivas] = useState(false);
  const [nueva, setNueva] = useState({ ...VACIA });
  const [editando, setEditando] = useState(null);   // {id, codigo, nombre}
  const [ocupado, setOcupado] = useState(null);     // id, o 'nueva'

  const cargar = useCallback(async () => {
    setCargando(true); setError('');
    try {
      const r = await fetch(API);
      if (!r.ok) {
        /* Un 404 aquí no es un fallo de datos: es que el servidor todavía no
         * tiene el catálogo. El remedio es otro —aplicar el parche— y decirlo
         * ahorra buscar en el sitio equivocado. */
        setError(r.status === 404
          ? 'Este servidor todavía no tiene el catálogo de unidades. '
            + 'Se habilita aplicando parche_unidades.py.'
          : `El servidor respondió ${r.status}.`);
        setLista([]);
        return;
      }
      const d = await r.json();
      setLista(Array.isArray(d) ? d : (d.results || []));
    } catch (e) {
      setError('No se pudo conectar con el servidor.');
      setLista([]);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const visibles = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return lista
      .filter(u => verInactivas || u.activo)
      .filter(u => !q
        || String(u.codigo || '').toLowerCase().includes(q)
        || String(u.nombre || '').toLowerCase().includes(q));
  }, [lista, busca, verInactivas]);

  /* Del servidor viene el detalle de por qué no se pudo; enseñarlo evita el
   * «no se pudo guardar» que no dice nada. */
  const motivo = async (res, porDefecto) => {
    try {
      const j = await res.json();
      if (typeof j === 'string') return j;
      if (j.detail) return j.detail;
      const primero = Object.values(j)[0];
      if (Array.isArray(primero)) return primero[0];
      if (typeof primero === 'string') return primero;
    } catch (e) { /* cuerpo no JSON */ }
    return porDefecto;
  };

  const crear = async () => {
    const codigo = nueva.codigo.trim();
    if (!codigo) { setError('Escribe el código de la unidad.'); return; }
    setOcupado('nueva'); setError('');
    try {
      const r = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codigo, nombre: nueva.nombre.trim(), activo: true }),
      });
      if (!r.ok) { setError(await motivo(r, `El servidor respondió ${r.status}.`)); return; }
      setNueva({ ...VACIA });
      await cargar();
      if (onCambio) onCambio();
    } catch (e) { setError('No se pudo conectar con el servidor.'); }
    finally { setOcupado(null); }
  };

  const guardarEdicion = async () => {
    const { id, codigo, nombre } = editando;
    if (!codigo.trim()) { setError('El código no puede quedar vacío.'); return; }
    setOcupado(id); setError('');
    try {
      const r = await fetch(`${API}${id}/`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codigo: codigo.trim(), nombre: nombre.trim() }),
      });
      if (!r.ok) { setError(await motivo(r, `El servidor respondió ${r.status}.`)); return; }
      setEditando(null);
      await cargar();
      if (onCambio) onCambio();
    } catch (e) { setError('No se pudo conectar con el servidor.'); }
    finally { setOcupado(null); }
  };

  const alternar = async (u) => {
    setOcupado(u.id); setError('');
    try {
      /* Desactivar va por DELETE porque el servidor ya lo interpreta así y no
       * borra nada. Reactivar es un PATCH, que no tiene atajo. */
      const r = u.activo
        ? await fetch(`${API}${u.id}/`, { method: 'DELETE' })
        : await fetch(`${API}${u.id}/`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ activo: true }),
          });
      if (!r.ok) { setError(await motivo(r, `El servidor respondió ${r.status}.`)); return; }
      await cargar();
      if (onCambio) onCambio();
    } catch (e) { setError('No se pudo conectar con el servidor.'); }
    finally { setOcupado(null); }
  };

  const activas = lista.filter(u => u.activo).length;

  return (
    <Portal>
      <div onClick={onCerrar} style={fondo}>
        <div onClick={e => e.stopPropagation()} style={dialogo}>

          <div style={cabecera}>
            <div>
              <div style={{ fontSize:'16px', fontWeight:700, color:'#0b2545',
                display:'flex', alignItems:'center', gap:'8px' }}>
                <FaRulerCombined color="#1463A5" /> Unidades de medida
              </div>
              <div style={{ fontSize:'12px', color:'#64748b', marginTop:'2px' }}>
                Lo que eligen las partidas del presupuesto. {activas} activa(s).
              </div>
            </div>
            <button onClick={onCerrar} style={btnCerrar}><FaTimes /></button>
          </div>

          <div style={{ padding:'14px 20px', background:'#f8fafc', overflowY:'auto' }}>

            {error && (
              <div style={aviso}>
                <FaExclamationTriangle style={{ marginTop:'2px', flexShrink:0 }} />
                <span>{error}</span>
              </div>
            )}

            {/* ── Alta ── */}
            <div style={{ display:'flex', gap:'8px', flexWrap:'wrap',
              alignItems:'center', marginBottom:'14px' }}>
              <input value={nueva.codigo} maxLength={20}
                onChange={e => setNueva({ ...nueva, codigo: e.target.value })}
                onKeyDown={e => e.key === 'Enter' && crear()}
                placeholder="Código (m3, H-H…)"
                style={ctrl({ width:'150px', fontFamily:'monospace' })} />
              <input value={nueva.nombre} maxLength={120}
                onChange={e => setNueva({ ...nueva, nombre: e.target.value })}
                onKeyDown={e => e.key === 'Enter' && crear()}
                placeholder="Nombre (Metro Cúbico…)"
                style={ctrl({ flex:1, minWidth:'190px' })} />
              <button onClick={crear} disabled={ocupado === 'nueva'} style={btnPri}>
                <FaPlus size={11} /> {ocupado === 'nueva' ? 'Guardando…' : 'Añadir'}
              </button>
            </div>

            {/* ── Filtros ── */}
            <div style={{ display:'flex', gap:'8px', flexWrap:'wrap',
              alignItems:'center', marginBottom:'10px' }}>
              <div style={{ position:'relative', flex:1, minWidth:'180px' }}>
                <FaSearch size={11} style={{ position:'absolute', left:'11px',
                  top:'11px', color:'#94a3b8' }} />
                <input value={busca} onChange={e => setBusca(e.target.value)}
                  placeholder="Buscar…"
                  style={ctrl({ paddingLeft:'31px', width:'100%' })} />
              </div>
              <label style={{ display:'inline-flex', alignItems:'center', gap:'6px',
                fontSize:'12.5px', color:'#475569', cursor:'pointer' }}>
                <input type="checkbox" checked={verInactivas}
                  onChange={e => setVerInactivas(e.target.checked)} />
                Ver desactivadas
              </label>
              <button onClick={cargar} disabled={cargando} style={btnSec}>
                <FaSyncAlt size={11} className={cargando ? 'icon-spin' : ''} /> Actualizar
              </button>
            </div>

            {cargando && lista.length === 0 && (
              <div style={nota}>Consultando…</div>
            )}

            {!cargando && visibles.length === 0 && (
              <div style={nota}>
                {busca ? 'Ninguna unidad coincide con la búsqueda.'
                       : 'No hay unidades. Añade la primera arriba.'}
              </div>
            )}

            {visibles.length > 0 && (
              <div style={{ background:'#fff', border:'1px solid #e2e8f0',
                borderRadius:'10px', overflow:'hidden' }}>
                <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'13px' }}>
                  <thead>
                    <tr style={{ background:'#f1f5f9', color:'#475569',
                      fontSize:'11px', textTransform:'uppercase', letterSpacing:'.04em' }}>
                      <th style={th}>Código</th>
                      <th style={th}>Nombre</th>
                      <th style={{ ...th, textAlign:'right' }} />
                    </tr>
                  </thead>
                  <tbody>
                    {visibles.map(u => {
                      const enEdicion = editando && editando.id === u.id;
                      const trabajando = ocupado === u.id;
                      return (
                        <tr key={u.id} style={{ borderTop:'1px solid #f1f5f9',
                          background: u.activo ? '#fff' : '#fafafa',
                          opacity: u.activo ? 1 : .65 }}>
                          <td style={{ ...td, fontFamily:'monospace', fontWeight:700 }}>
                            {enEdicion
                              ? <input value={editando.codigo} maxLength={20}
                                  onChange={e => setEditando({ ...editando, codigo: e.target.value })}
                                  style={ctrl({ width:'130px', fontFamily:'monospace' })} />
                              : u.codigo}
                          </td>
                          <td style={{ ...td, color:'#475569' }}>
                            {enEdicion
                              ? <input value={editando.nombre} maxLength={120}
                                  onChange={e => setEditando({ ...editando, nombre: e.target.value })}
                                  onKeyDown={e => e.key === 'Enter' && guardarEdicion()}
                                  style={ctrl({ width:'100%' })} />
                              : (u.nombre || <span style={{ color:'#94a3b8' }}>sin nombre</span>)}
                            {!u.activo && !enEdicion && (
                              <span style={etiqueta}>desactivada</span>
                            )}
                          </td>
                          <td style={{ ...td, textAlign:'right', whiteSpace:'nowrap' }}>
                            {enEdicion ? (
                              <>
                                <button onClick={guardarEdicion} disabled={trabajando}
                                  style={{ ...btnIco, color:'#15803d' }}>
                                  <FaCheck size={12} /> Guardar
                                </button>
                                <button onClick={() => setEditando(null)} style={btnIco}>
                                  <FaTimes size={12} /> Cancelar
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  onClick={() => { setError(''); setEditando({
                                    id: u.id, codigo: u.codigo || '', nombre: u.nombre || '' }); }}
                                  disabled={trabajando} style={btnIco} title="Corregir">
                                  <FaEdit size={12} /> Editar
                                </button>
                                <button onClick={() => alternar(u)} disabled={trabajando}
                                  style={{ ...btnIco, color: u.activo ? '#b91c1c' : '#15803d' }}
                                  title={u.activo
                                    ? 'Dejar de ofrecerla (no borra las partidas que ya la usan)'
                                    : 'Volver a ofrecerla'}>
                                  {u.activo ? <><FaBan size={12} /> Desactivar</>
                                            : <><FaUndo size={12} /> Reactivar</>}
                                </button>
                              </>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <div style={{ fontSize:'11.5px', color:'#94a3b8', marginTop:'12px',
              lineHeight:1.6 }}>
              Desactivar no borra nada: la unidad deja de ofrecerse para lo
              nuevo y las partidas que ya la usan se siguen entendiendo. El
              código se guarda tal cual lo escribas, porque es el que sale
              impreso en los informes.
            </div>
          </div>
        </div>
      </div>
    </Portal>
  );
}

/* ── Estilos, los mismos que usa Proyectos ──────────────────────────────── */

const ctrl = (extra = {}) => ({
  padding:'9px 11px', border:'1px solid #cbd5e1', borderRadius:'7px',
  fontSize:'13px', fontFamily:'inherit', background:'#fff', boxSizing:'border-box',
  ...extra,
});
const btnBase = { display:'inline-flex', alignItems:'center', gap:'7px',
  borderRadius:'7px', padding:'9px 14px', fontSize:'12.5px', fontWeight:600,
  cursor:'pointer', fontFamily:'inherit' };
const btnSec = { ...btnBase, background:'#fff', color:'#475569', border:'1px solid #cbd5e1' };
const btnPri = { ...btnBase, background:'#1463A5', color:'#fff', border:'none' };
const btnIco = { background:'transparent', border:'none', cursor:'pointer',
  color:'#64748b', padding:'5px 7px', lineHeight:1, display:'inline-flex',
  alignItems:'center', gap:'4px', fontFamily:'inherit', fontSize:'12px',
  fontWeight:600 };
const btnCerrar = { background:'transparent', border:'none', cursor:'pointer',
  color:'#64748b', fontSize:'17px', lineHeight:1 };
const fondo = { position:'fixed', inset:0, zIndex:100000, background:'rgba(2,8,20,.6)',
  display:'flex', alignItems:'center', justifyContent:'center', padding:'16px' };
const dialogo = { background:'#fff', borderRadius:'13px', width:'100%',
  maxWidth:'720px', maxHeight:'92vh', display:'flex', flexDirection:'column',
  overflow:'hidden', fontFamily:'system-ui, -apple-system, Segoe UI, Roboto, sans-serif' };
const cabecera = { display:'flex', justifyContent:'space-between',
  alignItems:'flex-start', gap:'12px', padding:'15px 20px',
  borderBottom:'1px solid #e2e8f0' };
const aviso = { background:'#fef2f2', border:'1px solid #fecaca', borderRadius:'9px',
  padding:'11px 14px', fontSize:'12.5px', color:'#b91c1c', marginBottom:'14px',
  display:'flex', gap:'9px', alignItems:'flex-start', lineHeight:1.6 };
const nota = { background:'#fff', border:'1px solid #e2e8f0', borderRadius:'10px',
  padding:'18px', fontSize:'12.5px', color:'#64748b', textAlign:'center' };
const th = { padding:'9px 12px', textAlign:'left', fontWeight:700 };
const td = { padding:'9px 12px', verticalAlign:'middle' };
const etiqueta = { marginLeft:'8px', background:'#f1f5f9', color:'#64748b',
  borderRadius:'10px', padding:'2px 8px', fontSize:'10.5px', fontWeight:700 };
