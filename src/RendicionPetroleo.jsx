// ─────────────────────────────────────────────────────────────────────────
//  RendicionPetroleo — qué vales están sustentados y con qué documento
// ─────────────────────────────────────────────────────────────────────────
//
// EL PAPEL QUE SUSTITUYE. Un Excel titulado «CONTROL DE RENDICIÓN DE INSUMO :
// PETRÓLEO»: una fila por vale con su fecha, sus galones y su dren, y a la
// derecha el documento que lo rinde ante cada entidad, con su fecha.
//
// LA MITAD IZQUIERDA YA EXISTÍA. Cada carga de combustible es una línea de
// parte medida en galones, con su número de vale, la fecha del parte y la
// partida a la que se cargó. No se vuelve a teclear nada: esta pantalla lo
// lee y le añade lo único que faltaba, el sustento.
//
// DOS COSAS QUE MANDAN SOBRE LA PANTALLA, y vienen del papel:
//
//   UN DOCUMENTO CUBRE VARIOS VALES. Un oficio rinde diez cargas de una vez.
//   Por eso se marca con casillas y se rinde en bloque, en vez de abrir el
//   vale y escribirle su documento: eso serían diez veces el mismo dato.
//
//   UN VALE SE RINDE ANTE VARIAS ENTIDADES. El mismo va en un informe a JURP
//   y en un oficio a la Junta de Usuarios Virú. Por eso cada fila lleva una
//   columna por entidad y no un «rendido: sí/no».
//
// LO QUE NO SE ESCONDE. Las cargas sin número de vale salen igual, marcadas.
// Esconderlas las volvería invisibles justo cuando lo que hace falta es ir a
// buscar ese número.

import { useState, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  FaGasPump, FaSyncAlt, FaExclamationTriangle, FaFileUpload, FaTimes,
  FaCheck, FaPaperclip, FaTrash, FaFilePdf,
} from 'react-icons/fa';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import Swal from 'sweetalert2';
import { API_OPS, API_BASE } from './api';

const Portal = ({ children }) => createPortal(children, document.body);

const cant = (n) => (parseFloat(n) || 0).toLocaleString('es-PE',
  { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dia = (iso) => {
  if (!iso) return '—';
  const [a, m, d] = String(iso).slice(0, 10).split('-');
  return `${d}/${m}/${a}`;
};

/* Las tres del papel. El código es lo que guarda el servidor; el rótulo, lo
 * que se lee. «Otro» lleva además un nombre escrito a mano, como en el
 * Excel, donde la columna se titula «Otro : Especificar». */
const ENTIDADES = [
  { clave: 'jurp', corto: 'JURP', largo: 'Junta de Riego Presurizado' },
  { clave: 'juv',  corto: 'JUV',  largo: 'Junta de Usuarios Virú' },
  { clave: 'otro', corto: 'Otro', largo: 'Otro' },
];

const VACIO = { entidad: 'jurp', entidad_otro: '', numero: '', fecha: '', archivo: null };

export default function RendicionPetroleo() {
  const [proyectos, setProyectos] = useState([]);
  const [proyecto, setProyecto] = useState('');
  const [vales, setVales] = useState([]);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState('');
  const [soporta, setSoporta] = useState(true);
  const [marcados, setMarcados] = useState(new Set());
  const [form, setForm] = useState(null);     // el modal de rendir
  const [guardando, setGuardando] = useState(false);
  const [verEntidad, setVerEntidad] = useState('');   // filtro «pendientes ante…»

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`${API_OPS}/proyectos/`);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const l = await r.json();
        setProyectos(Array.isArray(l) ? l : []);
        if (l.length) setProyecto(String(l[0].id));
      } catch (e) { setError('No se pudo leer la lista de proyectos. ' + e.message); }
    })();
  }, []);

  const cargar = useCallback(async () => {
    if (!proyecto) return;
    setCargando(true); setError(''); setMarcados(new Set());
    try {
      const r = await fetch(`${API_OPS}/rendicion/vales/?proyecto=${proyecto}`);
      if (r.status === 404) { setSoporta(false); setVales([]); return; }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const d = await r.json();
      setSoporta(true);
      setVales(d.vales || []);
    } catch (e) {
      setVales([]); setError('No se pudo cargar la rendición. ' + e.message);
    } finally { setCargando(false); }
  }, [proyecto]);

  useEffect(() => { cargar(); }, [cargar]);

  /* El documento de un vale ante una entidad, si lo hay. */
  const docDe = (v, clave) => (v.rendiciones || []).find(d => d.entidad === clave);

  const visibles = useMemo(() => {
    if (!verEntidad) return vales;
    return vales.filter(v => !docDe(v, verEntidad));
  }, [vales, verEntidad]);

  const resumen = useMemo(() => {
    const total = vales.reduce((s, v) => s + (parseFloat(v.galones) || 0), 0);
    const porEnt = {};
    ENTIDADES.forEach(e => {
      const sinRendir = vales.filter(v => !docDe(v, e.clave));
      porEnt[e.clave] = {
        pendientes: sinRendir.length,
        galones: sinRendir.reduce((s, v) => s + (parseFloat(v.galones) || 0), 0),
      };
    });
    return { total, galones: total, porEnt, sinNumero: vales.filter(v => !v.vale).length };
  }, [vales]);

  const alternar = (id) => {
    const n = new Set(marcados);
    if (n.has(id)) n.delete(id); else n.add(id);
    setMarcados(n);
  };

  const abrirRendir = () => {
    if (!marcados.size) return;
    setForm({ ...VACIO, fecha: new Date().toISOString().slice(0, 10) });
  };

  const rendir = async () => {
    if (!form.numero.trim()) { setError('Escribe el número del documento.'); return; }
    if (!form.fecha) { setError('Indica la fecha del documento.'); return; }
    setGuardando(true); setError('');
    try {
      /* multipart y no JSON porque va un archivo. El mismo documento se liga
       * a todos los vales marcados en una sola llamada: el servidor lo hace
       * en una transacción, así que o quedan rendidos todos o ninguno. */
      const fd = new FormData();
      fd.append('proyecto', proyecto);
      fd.append('entidad', form.entidad);
      fd.append('entidad_otro', form.entidad_otro || '');
      fd.append('numero', form.numero.trim());
      fd.append('fecha', form.fecha);
      if (form.archivo) fd.append('archivo', form.archivo);
      [...marcados].forEach(id => fd.append('vales', id));

      const r = await fetch(`${API_OPS}/rendicion/documentos/`, { method: 'POST', body: fd });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.detail || Object.values(d)[0] || `El servidor respondió ${r.status}.`);
      }
      setForm(null);
      await cargar();
      Swal.fire({ icon: 'success', title: 'Rendido',
        text: `${marcados.size} vale(s) quedaron sustentados.`,
        timer: 1800, showConfirmButton: false });
    } catch (e) {
      setError(String(e.message || e));
    } finally { setGuardando(false); }
  };

  const borrarDoc = async (doc) => {
    const ok = await Swal.fire({
      icon: 'warning', title: `¿Deshacer ${doc.numero}?`,
      text: `Sus ${doc.vales} vale(s) vuelven a quedar pendientes ante ${doc.entidad_nombre}.`,
      showCancelButton: true, confirmButtonText: 'Deshacer',
      cancelButtonText: 'Cancelar', confirmButtonColor: '#dc2626',
    });
    if (!ok.isConfirmed) return;
    try {
      const r = await fetch(`${API_OPS}/rendicion/documentos/${doc.id}/`, { method: 'DELETE' });
      if (!r.ok && r.status !== 204) throw new Error('HTTP ' + r.status);
      await cargar();
    } catch (e) { setError('No se pudo deshacer. ' + e.message); }
  };

  const exportarPDF = () => {
    if (!vales.length) return;
    const pro = proyectos.find(p => String(p.id) === String(proyecto)) || {};
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const W = doc.internal.pageSize.getWidth();
    doc.setFontSize(13); doc.setFont(undefined, 'bold');
    doc.text('CONTROL DE RENDICIÓN DE INSUMO : PETRÓLEO', W / 2, 15, { align: 'center' });
    doc.setFontSize(10); doc.setFont(undefined, 'normal');
    doc.text(`${pro.codigo || ''} — ${pro.nombre || ''}`, W / 2, 21,
      { align: 'center', maxWidth: W - 30 });
    autoTable(doc, {
      startY: 28,
      head: [['Fecha', 'Vale', 'Cantidad (Gln)', 'Dren',
              ...ENTIDADES.map(e => `${e.corto}\n(documento · fecha)`)]],
      body: vales.map(v => [
        dia(v.fecha), v.vale || '—', cant(v.galones), v.dren,
        ...ENTIDADES.map(e => {
          const d = docDe(v, e.clave);
          return d ? `${d.numero}\n${dia(d.fecha)}` : '';
        }),
      ]),
      foot: [['', 'TOTAL', cant(resumen.galones), '', '', '', '']],
      theme: 'grid',
      styles: { fontSize: 7.5, cellPadding: 1.5, valign: 'middle' },
      headStyles: { fillColor: [20, 99, 165] },
      footStyles: { fillColor: [241, 245, 249], textColor: 20, fontStyle: 'bold' },
      margin: { left: 12, right: 12 },
    });
    doc.save(`rendicion-petroleo-${pro.codigo || 'obra'}-${new Date().toISOString().slice(0,10)}.pdf`);
  };

  return (
    <div className="tbl-page-wrapper">

      <div className="tbl-page-header" style={{ display:'flex', alignItems:'flex-end',
        justifyContent:'space-between', gap:'14px', flexWrap:'wrap' }}>
        <div>
          <div className="tbl-page-pretitle">Obra</div>
          <h2 className="tbl-page-title" style={{ display:'flex', alignItems:'center', gap:'9px' }}>
            <FaGasPump color="#1463A5" /> Rendición de petróleo
          </h2>
          <div style={{ fontSize:'12.5px', color:'#64748b', marginTop:'3px' }}>
            Los vales de combustible de la obra y el documento que sustenta cada uno.
          </div>
        </div>
        <div style={{ display:'flex', gap:'9px', alignItems:'flex-end', flexWrap:'wrap' }}>
          <div>
            <label className="tbl-form-label">Proyecto</label>
            <select className="tbl-form-select" value={proyecto}
              onChange={e => setProyecto(e.target.value)} style={{ minWidth:'250px' }}>
              {proyectos.map(p => <option key={p.id} value={p.id}>{p.codigo}</option>)}
            </select>
          </div>
          <button onClick={cargar} disabled={cargando} style={btnSec}>
            <FaSyncAlt size={11} className={cargando ? 'icon-spin' : ''} /> Actualizar
          </button>
          <button onClick={exportarPDF} disabled={!vales.length} style={btnSec}>
            <FaFilePdf size={11} /> PDF
          </button>
          <button onClick={abrirRendir} disabled={!marcados.size} style={{
            ...btnPri, opacity: marcados.size ? 1 : .45,
            cursor: marcados.size ? 'pointer' : 'not-allowed' }}>
            <FaFileUpload size={11} /> Rendir {marcados.size || ''}
          </button>
        </div>
      </div>

      <div className="tbl-page-body">

        {error && (
          <div style={avisoMal}>
            <FaExclamationTriangle style={{ marginTop:'2px', flexShrink:0 }} />
            <span>{error}</span>
          </div>
        )}

        {!soporta && (
          <div style={avisoInfo}>
            <FaExclamationTriangle style={{ marginTop:'2px', flexShrink:0 }} />
            <span>
              Este servidor todavía no tiene la rendición. Se habilita aplicando
              <b> parche_rendicion.py</b> y corriendo <b>migrar_vales</b>.
            </span>
          </div>
        )}

        {/* ── Resumen, y el filtro que de verdad se usa ─────────────────── */}
        {soporta && vales.length > 0 && (
          <div style={{ display:'flex', gap:'10px', flexWrap:'wrap', marginBottom:'14px' }}>
            <Tarjeta titulo="Vales" valor={vales.length}
              pie={`${cant(resumen.galones)} Gln en total`} activo={!verEntidad}
              onClick={() => setVerEntidad('')} />
            {ENTIDADES.map(e => (
              <Tarjeta key={e.clave} titulo={`Pendientes · ${e.corto}`}
                valor={resumen.porEnt[e.clave].pendientes}
                pie={`${cant(resumen.porEnt[e.clave].galones)} Gln sin rendir`}
                color={resumen.porEnt[e.clave].pendientes ? '#b45309' : '#15803d'}
                activo={verEntidad === e.clave}
                onClick={() => setVerEntidad(verEntidad === e.clave ? '' : e.clave)} />
            ))}
          </div>
        )}

        {verEntidad && (
          <div style={{ fontSize:'12px', color:'#475569', marginBottom:'10px' }}>
            Mostrando solo los pendientes ante <b>
              {ENTIDADES.find(e => e.clave === verEntidad).largo}</b>.{' '}
            <button onClick={() => setVerEntidad('')} style={enlace}>Ver todos</button>
          </div>
        )}

        {cargando && !vales.length && <div style={nota}>Consultando…</div>}

        {soporta && !cargando && !vales.length && (
          <div style={nota}>
            Esta obra no tiene cargas de combustible registradas. Aparecerán
            aquí conforme se imputen en los partes, contra una partida medida
            en galones.
          </div>
        )}

        {visibles.length > 0 && (
          <div style={{ background:'#fff', border:'1px solid #e2e8f0',
            borderRadius:'10px', overflow:'hidden' }}>
            <div style={{ overflowX:'auto' }}>
              <table style={{ width:'100%', minWidth:'900px',
                borderCollapse:'collapse', fontSize:'12.5px' }}>
                <thead>
                  <tr style={cabecera}>
                    <th style={{ ...th, width:'36px', textAlign:'center' }}>
                      <input type="checkbox"
                        checked={visibles.length > 0 && visibles.every(v => marcados.has(v.id))}
                        onChange={e => setMarcados(e.target.checked
                          ? new Set(visibles.map(v => v.id)) : new Set())}
                        title="Marcar todos los de la lista" />
                    </th>
                    <th style={{ ...th, textAlign:'left' }}>Fecha</th>
                    <th style={{ ...th, textAlign:'left' }}>Vale</th>
                    <th style={th}>Cantidad (Gln)</th>
                    <th style={{ ...th, textAlign:'left' }}>Dren</th>
                    {ENTIDADES.map(e => (
                      <th key={e.clave} style={{ ...th, textAlign:'left',
                        borderLeft:'1px solid #e2e8f0' }} title={e.largo}>
                        {e.corto}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visibles.map(v => {
                    const sel = marcados.has(v.id);
                    return (
                      <tr key={v.id} style={{ borderTop:'1px solid #f1f5f9',
                        background: sel ? '#eff6ff' : '#fff' }}>
                        <td style={{ ...td, textAlign:'center' }}>
                          <input type="checkbox" checked={sel}
                            onChange={() => alternar(v.id)} />
                        </td>
                        <td style={{ ...td, whiteSpace:'nowrap' }}>{dia(v.fecha)}</td>
                        <td style={{ ...td, fontFamily:'monospace', fontWeight:700 }}>
                          {v.vale || (
                            <span style={{ fontFamily:'inherit', fontWeight:600,
                              color:'#b45309', fontSize:'11.5px' }}>sin número</span>
                          )}
                        </td>
                        <td style={{ ...td, textAlign:'right', fontWeight:700 }}>
                          {cant(v.galones)}</td>
                        <td style={{ ...td, color:'#475569' }}>{v.dren}</td>
                        {ENTIDADES.map(e => {
                          const d = docDe(v, e.clave);
                          return (
                            <td key={e.clave} style={{ ...td,
                              borderLeft:'1px solid #f1f5f9' }}>
                              {d ? (
                                <div style={{ display:'flex', alignItems:'center', gap:'6px' }}>
                                  <div style={{ minWidth:0 }}>
                                    <div style={{ fontWeight:600, color:'#15803d',
                                      fontSize:'11.5px', overflow:'hidden',
                                      textOverflow:'ellipsis', whiteSpace:'nowrap',
                                      maxWidth:'190px' }} title={d.numero}>
                                      {d.numero}
                                    </div>
                                    <div style={{ fontSize:'10.5px', color:'#94a3b8' }}>
                                      {dia(d.fecha)}
                                      {d.entidad === 'otro' && d.entidad_nombre
                                        && ` · ${d.entidad_nombre}`}
                                    </div>
                                  </div>
                                  {d.archivo && (
                                    <a href={d.archivo.startsWith('http') ? d.archivo
                                      : `${API_BASE}${d.archivo}`}
                                      target="_blank" rel="noreferrer"
                                      style={{ color:'#1463A5' }} title="Ver el escaneado">
                                      <FaPaperclip size={12} />
                                    </a>
                                  )}
                                  <button onClick={() => borrarDoc(d)} style={btnIco}
                                    title="Deshacer esta rendición">
                                    <FaTrash size={11} />
                                  </button>
                                </div>
                              ) : (
                                <span style={{ color:'#cbd5e1', fontSize:'11.5px' }}>
                                  pendiente
                                </span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {vales.length > 0 && (
          <div style={{ fontSize:'11px', color:'#94a3b8', marginTop:'14px', lineHeight:1.6 }}>
            Los vales salen de los partes: cada carga es una línea medida en una
            unidad que pide comprobante. No se escriben aquí.{' '}
            {resumen.sinNumero > 0 && (
              <>Hay <b>{resumen.sinNumero}</b> carga(s) sin número de vale
              apuntado; salen igual, porque esconderlas sería la forma de no
              arreglarlas nunca.</>
            )}
          </div>
        )}
      </div>

      {/* ── Rendir lo marcado ──────────────────────────────────────────── */}
      {form && (
        <Portal>
          <div style={fondo} onClick={() => !guardando && setForm(null)}>
            <div style={dialogo} onClick={e => e.stopPropagation()}>
              <div style={cabModal}>
                <div>
                  <div style={{ fontSize:'15px', fontWeight:700, color:'#0b2545' }}>
                    Rendir {marcados.size} vale(s)
                  </div>
                  <div style={{ fontSize:'11.5px', color:'#64748b', marginTop:'2px' }}>
                    {cant(vales.filter(v => marcados.has(v.id))
                      .reduce((s, v) => s + (parseFloat(v.galones) || 0), 0))} Gln
                    {' '}con un solo documento
                  </div>
                </div>
                <button onClick={() => setForm(null)} style={btnCerrar}><FaTimes /></button>
              </div>

              <div style={{ padding:'16px 20px' }}>
                {error && <div style={{ ...avisoMal, marginBottom:'12px' }}>{error}</div>}

                <label className="tbl-form-label">Se rinde ante</label>
                <div style={{ display:'flex', gap:'8px', flexWrap:'wrap', marginBottom:'12px' }}>
                  {ENTIDADES.map(e => (
                    <button key={e.clave} type="button"
                      onClick={() => setForm({ ...form, entidad: e.clave })}
                      style={{ ...btnBase, flex:'1 1 150px', justifyContent:'center',
                        border:'1px solid ' + (form.entidad === e.clave ? '#1463A5' : '#cbd5e1'),
                        background: form.entidad === e.clave ? '#eff6ff' : '#fff',
                        color: form.entidad === e.clave ? '#1463A5' : '#475569' }}>
                      {form.entidad === e.clave && <FaCheck size={10} />} {e.largo}
                    </button>
                  ))}
                </div>

                {form.entidad === 'otro' && (
                  <div style={{ marginBottom:'12px' }}>
                    <label className="tbl-form-label">¿Cuál?</label>
                    <input className="tbl-form-control" maxLength={120}
                      placeholder="Nombre de la entidad"
                      value={form.entidad_otro}
                      onChange={e => setForm({ ...form, entidad_otro: e.target.value })} />
                  </div>
                )}

                <div style={{ display:'flex', gap:'10px', flexWrap:'wrap', marginBottom:'12px' }}>
                  <div style={{ flex:'1 1 280px' }}>
                    <label className="tbl-form-label">
                      Documento <span style={{ color:'red' }}>*</span>
                    </label>
                    <input className="tbl-form-control" maxLength={160}
                      placeholder="Ej. OFICIO N°130-2026-G/JUASHMV"
                      value={form.numero}
                      onChange={e => setForm({ ...form, numero: e.target.value })} />
                  </div>
                  <div style={{ flex:'0 1 170px' }}>
                    <label className="tbl-form-label">
                      Fecha <span style={{ color:'red' }}>*</span>
                    </label>
                    <input type="date" className="tbl-form-control" value={form.fecha}
                      onChange={e => setForm({ ...form, fecha: e.target.value })} />
                  </div>
                </div>

                <label className="tbl-form-label">
                  Escaneado <small style={{ color:'#94a3b8', fontWeight:400 }}>
                    · la evidencia</small>
                </label>
                <input type="file" className="tbl-form-control"
                  accept=".pdf,image/*"
                  onChange={e => setForm({ ...form, archivo: e.target.files[0] || null })} />
                {!form.archivo && (
                  <div style={{ fontSize:'11px', color:'#b45309', marginTop:'5px' }}>
                    Sin archivo queda registrado igual, pero sin evidencia que
                    enseñar cuando alguien la pida.
                  </div>
                )}
              </div>

              <div style={pieModal}>
                <button onClick={() => setForm(null)} disabled={guardando} style={btnSec}>
                  Cancelar
                </button>
                <button onClick={rendir} disabled={guardando} style={btnPri}>
                  <FaCheck size={11} /> {guardando ? 'Guardando…' : 'Rendir'}
                </button>
              </div>
            </div>
          </div>
        </Portal>
      )}
    </div>
  );
}

const Tarjeta = ({ titulo, valor, pie, color, activo, onClick }) => (
  <button onClick={onClick} style={{
    flex:'1 1 170px', textAlign:'left', cursor:'pointer', fontFamily:'inherit',
    background:'#fff', borderRadius:'10px', padding:'12px 14px',
    border:'1px solid ' + (activo ? '#1463A5' : '#e2e8f0'),
    boxShadow: activo ? '0 0 0 2px #eff6ff' : 'none' }}>
    <div style={{ fontSize:'10.5px', color:'#94a3b8', textTransform:'uppercase',
      letterSpacing:'.04em', fontWeight:700 }}>{titulo}</div>
    <div style={{ fontSize:'22px', fontWeight:800, color: color || '#1e293b' }}>{valor}</div>
    <div style={{ fontSize:'11px', color:'#94a3b8' }}>{pie}</div>
  </button>
);

/* ── Estilos ────────────────────────────────────────────────────────────── */
const btnBase = { display:'inline-flex', alignItems:'center', gap:'7px',
  borderRadius:'7px', padding:'9px 14px', fontSize:'12.5px', fontWeight:600,
  cursor:'pointer', fontFamily:'inherit' };
const btnSec = { ...btnBase, background:'#fff', color:'#475569', border:'1px solid #cbd5e1' };
const btnPri = { ...btnBase, background:'#1463A5', color:'#fff', border:'none' };
const btnIco = { background:'transparent', border:'none', cursor:'pointer',
  color:'#94a3b8', padding:'3px 4px', display:'inline-flex', alignItems:'center' };
const btnCerrar = { background:'transparent', border:'none', cursor:'pointer',
  color:'#64748b', fontSize:'17px', lineHeight:1 };
const enlace = { background:'none', border:'none', padding:0, color:'#1463A5',
  cursor:'pointer', fontSize:'12px', fontWeight:700, fontFamily:'inherit' };
const cabecera = { background:'#f8fafc', color:'#64748b', fontSize:'11px',
  textTransform:'uppercase', letterSpacing:'.03em' };
const th = { padding:'9px 10px', fontWeight:700, textAlign:'right' };
const td = { padding:'9px 10px', verticalAlign:'middle' };
const nota = { background:'#fff', border:'1px solid #e2e8f0', borderRadius:'10px',
  padding:'30px', fontSize:'12.5px', color:'#64748b', textAlign:'center' };
const avisoMal = { background:'#fef2f2', border:'1px solid #fecaca', borderRadius:'9px',
  padding:'11px 14px', fontSize:'12.5px', color:'#b91c1c', marginBottom:'14px',
  display:'flex', gap:'9px', alignItems:'flex-start', lineHeight:1.6 };
const avisoInfo = { background:'#fffbeb', border:'1px solid #fde68a', borderRadius:'9px',
  padding:'11px 14px', fontSize:'12.5px', color:'#92400e', marginBottom:'14px',
  display:'flex', gap:'9px', alignItems:'flex-start', lineHeight:1.6 };
const fondo = { position:'fixed', inset:0, zIndex:100000, background:'rgba(2,8,20,.6)',
  display:'flex', alignItems:'center', justifyContent:'center', padding:'16px' };
const dialogo = { background:'#fff', borderRadius:'13px', width:'100%', maxWidth:'620px',
  maxHeight:'92vh', display:'flex', flexDirection:'column', overflow:'auto',
  fontFamily:'system-ui, -apple-system, Segoe UI, Roboto, sans-serif' };
const cabModal = { display:'flex', justifyContent:'space-between', alignItems:'flex-start',
  gap:'12px', padding:'15px 20px', borderBottom:'1px solid #e2e8f0' };
const pieModal = { display:'flex', justifyContent:'flex-end', gap:'9px',
  padding:'13px 20px', borderTop:'1px solid #e2e8f0', background:'#f8fafc' };
