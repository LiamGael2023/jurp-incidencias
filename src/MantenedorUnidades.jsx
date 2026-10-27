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
// CADA UNIDAD DICE CÓMO SE MIDE. En la hoja de metrados de JURP las columnas
// son LARGO, ANCHO, ALTURA, ÁREA y Coefi., y no todas se llenan siempre: en
// el Excel original están pintadas de amarillo, fila por fila, las que
// corresponden a cada unidad. Eso no lo decide quien llena la hoja, lo decide
// la unidad: un galón no tiene largo. Por eso las casillas se guardan aquí y
// no dentro del formulario de metrados —el día que JURP añada una unidad
// nueva también tiene que poder decir cómo se mide, sin tocar el código—.
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

/* Las cinco casillas de la hoja de metrados, en el orden del Excel. */
const DIMS = [
  { campo: 'usa_largo',       corto: 'largo',  largo: 'Largo (m)' },
  { campo: 'usa_ancho',       corto: 'ancho',  largo: 'Ancho (m)' },
  { campo: 'usa_altura',      corto: 'altura', largo: 'Altura (m)' },
  { campo: 'usa_area',        corto: 'área',   largo: 'Área (m²)' },
  { campo: 'usa_coeficiente', corto: 'coef.',  largo: 'Coeficiente' },
];

/* El horómetro NO es una casilla de medida: no multiplica nada. Dice si la
 * línea de un parte de maquinaria lleva tramo de horómetro. El combustible
 * no: no es trabajo de la máquina, es lo que se le echó. Va en su propio
 * grupo para que no parezca un factor más de la fórmula. */
const OTRAS = [
  { campo: 'usa_horometro', corto: 'horóm.', largo: 'Lleva horómetro' },
];

/* Unidad recién nacida: sin dimensiones y con coeficiente, que es como está
 * el Excel para diecisiete de las veinte. Lo normal es que la nueva también
 * se cuente de a una. */
const VACIA = {
  codigo: '', nombre: '',
  usa_largo: false, usa_ancho: false, usa_altura: false,
  usa_area: false, usa_coeficiente: true, usa_horometro: true,
};

export default function MantenedorUnidades({ onCerrar, onCambio }) {
  const [lista, setLista] = useState([]);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState('');
  const [busca, setBusca] = useState('');
  const [verInactivas, setVerInactivas] = useState(false);
  const [nueva, setNueva] = useState({ ...VACIA });
  const [editando, setEditando] = useState(null);   // la fila completa
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

  const soloDims = (o) => [...DIMS, ...OTRAS]
    .reduce((a, d) => ({ ...a, [d.campo]: !!o[d.campo] }), {});

  const crear = async () => {
    const codigo = nueva.codigo.trim();
    if (!codigo) { setError('Escribe el código de la unidad.'); return; }
    setOcupado('nueva'); setError('');
    try {
      const r = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          codigo, nombre: nueva.nombre.trim(), activo: true, ...soloDims(nueva) }),
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
        body: JSON.stringify({
          codigo: codigo.trim(), nombre: nombre.trim(), ...soloDims(editando) }),
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

  /* Los campos que habilita una unidad, para leerlos de un vistazo sin tener
   * que abrir la edición. */
  const Casillas = ({ u }) => {
    const dims = DIMS.filter(d => d.campo !== 'usa_coeficiente' && u[d.campo]);
    if (!dims.length) {
      return (
        <span style={{ fontSize:'11.5px', color:'#94a3b8' }}>
          se cuenta de a una{u.usa_coeficiente ? ' · coef.' : ''}
        </span>
      );
    }
    return (
      <span style={{ display:'inline-flex', gap:'4px', flexWrap:'wrap' }}>
        {dims.map(d => <span key={d.campo} style={pastilla}>{d.corto}</span>)}
        {u.usa_coeficiente && <span style={{ ...pastilla, ...pastillaGris }}>coef.</span>}
      </span>
    );
  };

  /* Se marca la EXCEPCION, no la norma: casi todas llevan horómetro, y
   * ponérselo a las diecinueve para que se vea la que no lo lleva es ruido
   * que esconde justo el dato que importa. */
  const SinHorometro = ({ u }) => (!u.usa_horometro ? (
    <span style={{ ...pastilla, background:'#fef3c7', color:'#92400e' }}
      title="Su línea en un parte de maquinaria no pide horómetro ni horas">
      sin horómetro
    </span>
  ) : null);

  /* Las cinco casillas en modo edición. El mismo bloque sirve para el alta y
   * para corregir, que es lo que evita que se separen con el tiempo. */
  const Marcar = ({ valor, onMarcar }) => (
    <div style={{ display:'flex', gap:'12px', flexWrap:'wrap', alignItems:'center' }}>
      <span style={{ fontSize:'11.5px', color:'#64748b', fontWeight:600 }}>
        Habilita:
      </span>
      {DIMS.map(d => (
        <label key={d.campo} style={{ display:'inline-flex', alignItems:'center',
          gap:'5px', fontSize:'12.5px', color:'#475569', cursor:'pointer' }}>
          <input type="checkbox" checked={!!valor[d.campo]}
            onChange={e => onMarcar({ ...valor, [d.campo]: e.target.checked })} />
          {d.largo}
        </label>
      ))}
      <span style={{ borderLeft:'1px solid #e2e8f0', height:'18px' }} />
      {OTRAS.map(d => (
        <label key={d.campo} style={{ display:'inline-flex', alignItems:'center',
          gap:'5px', fontSize:'12.5px', color:'#475569', cursor:'pointer' }}
          title="En un parte de maquinaria, si la línea pide tramo de horómetro y horas">
          <input type="checkbox" checked={!!valor[d.campo]}
            onChange={e => onMarcar({ ...valor, [d.campo]: e.target.checked })} />
          {d.largo}
        </label>
      ))}
    </div>
  );

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
                Lo que eligen las partidas, y qué casillas habilita cada una
                en la hoja de metrados. {activas} activa(s).
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
            <div style={panel}>
              <div style={{ display:'flex', gap:'8px', flexWrap:'wrap',
                alignItems:'center', marginBottom:'10px' }}>
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
              <Marcar valor={nueva} onMarcar={setNueva} />
            </div>

            {/* ── Filtros ── */}
            <div style={{ display:'flex', gap:'8px', flexWrap:'wrap',
              alignItems:'center', margin:'12px 0 10px' }}>
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
                      <th style={th}>Habilita</th>
                      <th style={{ ...th, textAlign:'right' }} />
                    </tr>
                  </thead>
                  <tbody>
                    {visibles.map(u => {
                      const enEdicion = editando && editando.id === u.id;
                      const trabajando = ocupado === u.id;

                      /* En edición la fila se convierte en un panel a todo lo
                       * ancho: siete controles no caben en celdas sin quedar
                       * ilegibles. */
                      if (enEdicion) {
                        return (
                          <tr key={u.id} style={{ borderTop:'1px solid #f1f5f9',
                            background:'#f8fafc' }}>
                            <td colSpan={4} style={{ padding:'12px' }}>
                              <div style={{ display:'flex', gap:'8px', flexWrap:'wrap',
                                alignItems:'center', marginBottom:'10px' }}>
                                <input value={editando.codigo} maxLength={20}
                                  onChange={e => setEditando({ ...editando, codigo: e.target.value })}
                                  style={ctrl({ width:'150px', fontFamily:'monospace' })} />
                                <input value={editando.nombre} maxLength={120}
                                  onChange={e => setEditando({ ...editando, nombre: e.target.value })}
                                  onKeyDown={e => e.key === 'Enter' && guardarEdicion()}
                                  placeholder="Nombre"
                                  style={ctrl({ flex:1, minWidth:'190px' })} />
                                <button onClick={guardarEdicion} disabled={trabajando}
                                  style={btnPri}>
                                  <FaCheck size={11} /> {trabajando ? 'Guardando…' : 'Guardar'}
                                </button>
                                <button onClick={() => setEditando(null)} style={btnSec}>
                                  <FaTimes size={11} /> Cancelar
                                </button>
                              </div>
                              <Marcar valor={editando} onMarcar={setEditando} />
                            </td>
                          </tr>
                        );
                      }

                      return (
                        <tr key={u.id} style={{ borderTop:'1px solid #f1f5f9',
                          background: u.activo ? '#fff' : '#fafafa',
                          opacity: u.activo ? 1 : .65 }}>
                          <td style={{ ...td, fontFamily:'monospace', fontWeight:700 }}>
                            {u.codigo}
                          </td>
                          <td style={{ ...td, color:'#475569' }}>
                            {u.nombre || <span style={{ color:'#94a3b8' }}>sin nombre</span>}
                            {!u.activo && <span style={etiqueta}>desactivada</span>}
                          </td>
                          <td style={td}>
                            <Casillas u={u} /> <SinHorometro u={u} />
                          </td>
                          <td style={{ ...td, textAlign:'right', whiteSpace:'nowrap' }}>
                            <button
                              onClick={() => { setError(''); setEditando({ ...u }); }}
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
              <b>Habilita</b> son las casillas que se podrán llenar al medir:
              un galón no tiene largo, y si el formulario lo deja escribir,
              el parcial sale multiplicado por un número que no significa
              nada. <b>m3</b> y <b>m2</b> llevan área además de las
              dimensiones a propósito: el volumen sale de largo × ancho ×
              altura o de área × altura, según lo que se haya medido en
              campo.
              <br />
              <b>Lleva horómetro</b> es aparte: no multiplica nada. Dice si, en
              un parte de maquinaria, la línea pide tramo de horómetro y horas
              efectivas. El combustible no las lleva —no es trabajo de la
              máquina, es lo que se le echó—.
              <br />
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
  maxWidth:'860px', maxHeight:'92vh', display:'flex', flexDirection:'column',
  overflow:'hidden', fontFamily:'system-ui, -apple-system, Segoe UI, Roboto, sans-serif' };
const cabecera = { display:'flex', justifyContent:'space-between',
  alignItems:'flex-start', gap:'12px', padding:'15px 20px',
  borderBottom:'1px solid #e2e8f0' };
const panel = { background:'#fff', border:'1px solid #e2e8f0', borderRadius:'10px',
  padding:'12px' };
const aviso = { background:'#fef2f2', border:'1px solid #fecaca', borderRadius:'9px',
  padding:'11px 14px', fontSize:'12.5px', color:'#b91c1c', marginBottom:'14px',
  display:'flex', gap:'9px', alignItems:'flex-start', lineHeight:1.6 };
const nota = { background:'#fff', border:'1px solid #e2e8f0', borderRadius:'10px',
  padding:'18px', fontSize:'12.5px', color:'#64748b', textAlign:'center' };
const th = { padding:'9px 12px', textAlign:'left', fontWeight:700 };
const td = { padding:'9px 12px', verticalAlign:'middle' };
const etiqueta = { marginLeft:'8px', background:'#f1f5f9', color:'#64748b',
  borderRadius:'10px', padding:'2px 8px', fontSize:'10.5px', fontWeight:700 };
const pastilla = { background:'#e0f2fe', color:'#0369a1', borderRadius:'10px',
  padding:'2px 8px', fontSize:'10.5px', fontWeight:700 };
const pastillaGris = { background:'#f1f5f9', color:'#64748b' };
