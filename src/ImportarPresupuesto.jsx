// ═══════════════════════════════════════════════════════════════════════════
//  Importar el presupuesto de obra de un proyecto
// ═══════════════════════════════════════════════════════════════════════════
//
// SE LEE AQUÍ, NO EN EL SERVIDOR, y por una razón concreta: así se ve lo que
// va a entrar ANTES de que entre. Un importador que carga y luego avisa es un
// importador que ya ensució la base, y deshacerlo a mano son dos horas.
//
// ES UN PASO DE DOS TIEMPOS, a propósito:
//
//   1. Elegir el archivo  → se parsea en el navegador y se enseña el árbol,
//                           los totales y lo que no cuadre.
//   2. Cargar             → solo si los números cuadran.
//
// SI LA SUMA DE LAS PARTIDAS NO CUADRA CON EL COSTO DIRECTO DEL EXCEL, el
// botón de cargar no se habilita. No es una molestia: significa que faltan
// partidas o que se leyó una columna que no era, y un presupuesto cargado a
// medias da avances que parecen buenos y no lo son. El servidor lo vuelve a
// comprobar por su cuenta -esta pantalla puede estar desactualizada-, así que
// el descuadre tendría que colarse dos veces para entrar.
//
// REIMPORTAR ES SEGURO. El servidor casa por (proyecto, código) y no cambia
// ids, así que las actividades que ya imputaron una partida siguen apuntando a
// la misma. Las partidas que ya no vienen en el Excel no se borran: se
// desactivan, porque borrarlas dejaría los partes ya firmados sin partida.

import { useState, useMemo, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  FaFileExcel, FaTimes, FaExclamationTriangle, FaCheckCircle, FaSpinner,
  FaUpload, FaFolderOpen, FaChevronRight, FaBan,
} from 'react-icons/fa';
import { leerPresupuesto, leerNombreProyecto } from './importarPresupuesto';

const Portal = ({ children }) => createPortal(children, document.body);

const soles = (n) => 'S/ ' + (parseFloat(n) || 0).toLocaleString('es-PE',
  { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nmero = (n) => (parseFloat(n) || 0).toLocaleString('es-PE',
  { maximumFractionDigits: 4 });

const ROTULOS = {
  costo_directo: 'Costo directo',
  gastos_generales: 'Gastos generales',
  utilidad: 'Utilidad',
  subtotal: 'Subtotal',
  igv: 'I.G.V.',
  total: 'Presupuesto total',
};

export default function ModalImportarPresupuesto({ proyecto, onCerrar, onCargado, api }) {
  const [leyendo, setLeyendo] = useState(false);
  const [datos, setDatos] = useState(null);      // lo que salió del Excel
  const [archivo, setArchivo] = useState('');
  const [nombreExcel, setNombreExcel] = useState('');
  const [fallo, setFallo] = useState('');
  const [subiendo, setSubiendo] = useState(false);
  const [resultado, setResultado] = useState(null);
  const [encima, setEncima] = useState(false);
  const [abierto, setAbierto] = useState({});    // nodos desplegados del árbol
  const entrada = useRef(null);

  // Esc cierra, salvo mientras se está cargando: cortar un POST a medias deja
  // el proyecto en un estado que nadie pidió.
  useEffect(() => {
    const t = (e) => { if (e.key === 'Escape' && !subiendo) onCerrar(); };
    window.addEventListener('keydown', t);
    return () => window.removeEventListener('keydown', t);
  }, [onCerrar, subiendo]);

  const tomar = async (f) => {
    if (!f) return;
    setFallo(''); setDatos(null); setResultado(null);
    setArchivo(f.name); setLeyendo(true);
    try {
      const buffer = new Uint8Array(await f.arrayBuffer());
      const r = leerPresupuesto(buffer);
      setDatos(r);
      setNombreExcel(leerNombreProyecto(buffer));
      // El primer nivel desplegado: ver el árbol cerrado no dice nada.
      const ab = {};
      r.partidas.forEach(p => { if (p.ruta[0]) ab[p.ruta[0][0]] = true; });
      setAbierto(ab);
    } catch (e) {
      setDatos(null);
      setFallo(e.message || String(e));
    } finally { setLeyendo(false); }
  };

  // El árbol de la vista previa: nodos con sus hijos y su importe, armado de
  // las rutas que trae cada partida.
  const arbol = useMemo(() => {
    if (!datos) return [];
    const raiz = { hijos: new Map(), importe: 0, partidas: 0 };
    for (const p of datos.partidas) {
      const imp = p.metrado * p.precio;
      let n = raiz;
      n.importe += imp; n.partidas += 1;
      for (const [cod, desc] of p.ruta) {
        if (!n.hijos.has(cod)) {
          n.hijos.set(cod, { codigo: cod, descripcion: desc, hijos: new Map(),
            importe: 0, partidas: 0 });
        }
        n = n.hijos.get(cod);
        n.importe += imp; n.partidas += 1;
      }
      n.hijos.set(p.codigo, { codigo: p.codigo, descripcion: p.descripcion,
        hijos: new Map(), importe: imp, partidas: 0, hoja: p });
    }
    const plano = (nodo, nivel, salida) => {
      for (const h of nodo.hijos.values()) {
        salida.push({ ...h, nivel });
        if (h.hijos.size && abierto[h.codigo]) plano(h, nivel + 1, salida);
      }
      return salida;
    };
    return plano(raiz, 0, []);
  }, [datos, abierto]);

  const cargar = async () => {
    setSubiendo(true); setFallo('');
    try {
      const r = await fetch(`${api}/proyectos/${proyecto.id}/presupuesto/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partidas: datos.partidas, totales: datos.totales }),
      });
      let d = {}; try { d = await r.json(); } catch { d = {}; }
      if (!r.ok) throw new Error(d.detail || `HTTP ${r.status}`);
      setResultado(d);
      onCargado && onCargado(d);
    } catch (e) {
      setFallo(e.message || String(e));
    } finally { setSubiendo(false); }
  };

  const puedeCargar = !!datos && datos.cuadra && !subiendo && !resultado;
  const reimporta = (proyecto.partidas || 0) > 0;

  return (
    <Portal>
      <div onClick={() => !subiendo && onCerrar()} style={fondo}>
        <div onClick={e => e.stopPropagation()} style={dialogo}>

          {/* ── cabecera ─────────────────────────────────────────────── */}
          <div style={cabecera}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize:'16px', fontWeight:700, color:'#0b2545',
                display:'flex', alignItems:'center', gap:'9px' }}>
                <FaFileExcel color="#15803d" /> Importar presupuesto de obra
              </div>
              <div style={{ fontSize:'12px', color:'#64748b', marginTop:'3px',
                overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                {proyecto.codigo} — {proyecto.nombre}
              </div>
            </div>
            <button onClick={() => !subiendo && onCerrar()} style={btnCerrar}>
              <FaTimes />
            </button>
          </div>

          <div style={{ padding:'16px 20px', overflowY:'auto', background:'#f8fafc',
            flex:1 }}>

            {/* ── ya cargado ──────────────────────────────────────────── */}
            {resultado ? (
              <div style={{ background:'#f0fdf4', border:'1px solid #bbf7d0',
                borderRadius:'10px', padding:'18px 20px' }}>
                <div style={{ fontSize:'15px', fontWeight:800, color:'#15803d',
                  display:'flex', alignItems:'center', gap:'9px', marginBottom:'10px' }}>
                  <FaCheckCircle /> Presupuesto cargado
                </div>
                <div style={{ fontSize:'13px', color:'#166534', lineHeight:1.8 }}>
                  Partidas nuevas: <b>{resultado.nuevas}</b><br />
                  Partidas actualizadas: <b>{resultado.actualizadas}</b><br />
                  {resultado.desactivadas > 0 && <>
                    Partidas que ya no vienen en el Excel y quedaron desactivadas:{' '}
                    <b>{resultado.desactivadas}</b>
                    <div style={{ fontSize:'12px', color:'#166534', opacity:.85 }}>
                      No se borran: si algún parte ya las usó, borrarlas perdería
                      ese avance.
                    </div>
                  </>}
                  Activas en total: <b>{resultado.activas}</b><br />
                  Suman <b>{soles(resultado.suma_partidas)}</b>
                </div>
                <div style={{ marginTop:'14px', fontSize:'12.5px', color:'#475569' }}>
                  Ya puedes crear actividades en este proyecto: sus partidas son
                  las que van a aparecer en el selector.
                </div>
              </div>
            ) : (
              <>
                {/* ── elegir archivo ───────────────────────────────────── */}
                <div
                  onDragOver={e => { e.preventDefault(); setEncima(true); }}
                  onDragLeave={() => setEncima(false)}
                  onDrop={e => { e.preventDefault(); setEncima(false);
                    tomar(e.dataTransfer.files && e.dataTransfer.files[0]); }}
                  onClick={() => entrada.current && entrada.current.click()}
                  style={{ border:`2px dashed ${encima ? '#15803d' : '#cbd5e1'}`,
                    background: encima ? '#f0fdf4' : '#fff', borderRadius:'11px',
                    padding: datos ? '14px 16px' : '28px 20px', textAlign:'center',
                    cursor:'pointer', transition:'all .12s' }}>
                  <input ref={entrada} type="file" accept=".xlsx,.xls" hidden
                    onChange={e => tomar(e.target.files && e.target.files[0])} />
                  {leyendo ? (
                    <div style={{ color:'#64748b', fontSize:'13px' }}>
                      <FaSpinner className="icon-spin" /> Leyendo {archivo}…
                    </div>
                  ) : archivo ? (
                    <div style={{ fontSize:'13px', color:'#1e293b' }}>
                      <FaFileExcel color="#15803d" /> <b>{archivo}</b>
                      <span style={{ color:'#64748b' }}> — clic para cambiarlo</span>
                    </div>
                  ) : (
                    <>
                      <FaUpload size={22} color="#94a3b8" />
                      <div style={{ fontSize:'13.5px', color:'#1e293b', fontWeight:600,
                        marginTop:'9px' }}>
                        Arrastra aquí el Excel del presupuesto, o haz clic
                      </div>
                      <div style={{ fontSize:'12px', color:'#64748b', marginTop:'4px' }}>
                        Formato S10 (.xlsx). Se lee en tu navegador: nada se sube
                        hasta que le des a cargar.
                      </div>
                    </>
                  )}
                </div>

                {reimporta && !datos && (
                  <div style={aviso('#eff6ff', '#bfdbfe', '#1e40af')}>
                    <FaExclamationTriangle style={{ marginTop:'2px', flexShrink:0 }} />
                    <span>
                      Este proyecto ya tiene <b>{proyecto.partidas} partidas</b>
                      {' '}cargadas. Reimportar no rompe nada: las partidas se
                      actualizan sin cambiar de id, así que las actividades que ya
                      imputaron siguen apuntando a la misma. Las que no vengan en el
                      Excel nuevo se desactivan en vez de borrarse.
                    </span>
                  </div>
                )}

                {fallo && (
                  <div style={aviso('#fef2f2', '#fecaca', '#b91c1c')}>
                    <FaBan style={{ marginTop:'2px', flexShrink:0 }} />
                    <span><b>No se cargó nada.</b> {fallo}</span>
                  </div>
                )}

                {/* ── vista previa ─────────────────────────────────────── */}
                {datos && (
                  <div style={{ marginTop:'14px' }}>

                    {!datos.cuadra ? (
                      <div style={aviso('#fef2f2', '#fecaca', '#b91c1c')}>
                        <FaExclamationTriangle style={{ marginTop:'2px', flexShrink:0 }} />
                        <span>
                          <b>Los números no cuadran, así que no se puede cargar.</b><br />
                          Las {datos.partidas.length} partidas leídas suman{' '}
                          <b>{soles(datos.suma)}</b>, pero el Excel declara un costo
                          directo de <b>{soles(datos.totales.costo_directo)}</b>.
                          Diferencia: <b>{soles(Math.abs(
                            datos.suma - (datos.totales.costo_directo || 0)))}</b>.
                          <br />
                          Falta alguna partida o se leyó una columna que no era.
                          Cargarlo daría avances que parecen buenos y no lo son.
                        </span>
                      </div>
                    ) : (
                      <div style={aviso('#f0fdf4', '#bbf7d0', '#15803d')}>
                        <FaCheckCircle style={{ marginTop:'2px', flexShrink:0 }} />
                        <span>
                          Cuadra: las <b>{datos.partidas.length} partidas</b> suman{' '}
                          <b>{soles(datos.suma)}</b>, igual que el costo directo del
                          Excel.
                        </span>
                      </div>
                    )}

                    {datos.avisos.length > 0 && (
                      <div style={aviso('#fffbeb', '#fde68a', '#92400e')}>
                        <FaExclamationTriangle style={{ marginTop:'2px', flexShrink:0 }} />
                        <span>
                          {datos.avisos.map((a, i) => <div key={i}>{a}</div>)}
                        </span>
                      </div>
                    )}

                    {nombreExcel && nombreExcel !== proyecto.nombre && (
                      <div style={aviso('#eff6ff', '#bfdbfe', '#1e40af')}>
                        <FaExclamationTriangle style={{ marginTop:'2px', flexShrink:0 }} />
                        <span>
                          El Excel dice que el proyecto es{' '}
                          <b>«{nombreExcel}»</b>, y aquí se llama{' '}
                          <b>«{proyecto.nombre}»</b>. Comprueba que es el archivo del
                          proyecto correcto antes de cargar: el nombre no se cambia
                          solo.
                        </span>
                      </div>
                    )}

                    {/* los totales del pie */}
                    <div style={{ background:'#fff', border:'1px solid #e2e8f0',
                      borderRadius:'10px', padding:'12px 14px', marginBottom:'12px' }}>
                      <div style={rotuloBloque}>Lo que declara el Excel</div>
                      <div style={{ display:'flex', flexWrap:'wrap', gap:'0 22px' }}>
                        {Object.entries(ROTULOS).map(([k, r]) => (
                          <div key={k} style={{ minWidth:'150px', padding:'4px 0',
                            fontSize:'12.5px' }}>
                            <span style={{ color:'#64748b' }}>{r}: </span>
                            <b style={{ color: datos.totales[k] == null
                              ? '#cbd5e1' : '#1e293b' }}>
                              {datos.totales[k] == null ? 'no viene'
                                : soles(datos.totales[k])}
                            </b>
                          </div>
                        ))}
                      </div>
                      {datos.totales.subtotal != null && (
                        <div style={{ fontSize:'11.5px', color:'#94a3b8',
                          marginTop:'6px' }}>
                          El subtotal no se guarda: sale de sumar costo directo,
                          gastos generales y utilidad.
                        </div>
                      )}
                    </div>

                    {/* el árbol */}
                    <div style={{ background:'#fff', border:'1px solid #e2e8f0',
                      borderRadius:'10px', overflow:'hidden' }}>
                      <div style={{ ...rotuloBloque, padding:'11px 14px 0' }}>
                        Lo que va a entrar — {datos.partidas.length} partidas
                        <span style={{ fontWeight:400, color:'#94a3b8' }}>
                          {' '}· clic en un título para abrirlo
                        </span>
                      </div>
                      <div style={{ maxHeight:'34vh', overflowY:'auto',
                        padding:'8px 6px 10px' }}>
                        {arbol.map((n, i) => {
                          const esHoja = !!n.hoja;
                          const desplegable = n.hijos.size > 0;
                          return (
                            <div key={n.codigo + i}
                              onClick={() => desplegable &&
                                setAbierto(a => ({ ...a, [n.codigo]: !a[n.codigo] }))}
                              style={{ display:'flex', alignItems:'baseline', gap:'8px',
                                padding:'4px 10px 4px ' + (10 + n.nivel * 17) + 'px',
                                fontSize:'12.5px', borderRadius:'5px',
                                cursor: desplegable ? 'pointer' : 'default',
                                background: esHoja ? 'transparent' : '#f8fafc',
                                marginBottom:'1px' }}>
                              {desplegable && (
                                <FaChevronRight size={8} color="#94a3b8"
                                  style={{ flexShrink:0, transition:'transform .12s',
                                    transform: abierto[n.codigo] ? 'rotate(90deg)' : 'none' }} />
                              )}
                              <span style={{ fontFamily:'monospace', fontSize:'11px',
                                color:'#94a3b8', flexShrink:0, minWidth:'82px' }}>
                                {n.codigo}
                              </span>
                              <span style={{ flex:1, color: esHoja ? '#475569' : '#0b2545',
                                fontWeight: esHoja ? 400 : 700, minWidth:0 }}>
                                {n.descripcion}
                                {esHoja && (
                                  <span style={{ color:'#94a3b8', fontSize:'11.5px' }}>
                                    {' '}· {nmero(n.hoja.metrado)} {n.hoja.unidad} ×{' '}
                                    {soles(n.hoja.precio)}
                                  </span>
                                )}
                              </span>
                              <span style={{ flexShrink:0, fontWeight: esHoja ? 400 : 700,
                                color: esHoja ? '#64748b' : '#1463A5',
                                whiteSpace:'nowrap' }}>
                                {soles(n.importe)}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* ── pie ──────────────────────────────────────────────────── */}
          <div style={pie}>
            {resultado ? (
              <button onClick={onCerrar} style={btnPri}>
                <FaFolderOpen /> Listo
              </button>
            ) : (
              <>
                {datos && !datos.cuadra && (
                  <div style={{ flex:1, fontSize:'11.5px', color:'#b91c1c',
                    alignSelf:'center', minWidth:'180px' }}>
                    No se habilita hasta que los números cuadren.
                  </div>
                )}
                <button onClick={onCerrar} disabled={subiendo} style={btnSec}>
                  Cancelar
                </button>
                <button onClick={cargar} disabled={!puedeCargar}
                  style={{ ...btnPri, background: puedeCargar ? '#15803d' : '#cbd5e1',
                    cursor: puedeCargar ? 'pointer' : 'not-allowed' }}>
                  {subiendo ? <FaSpinner className="icon-spin" /> : <FaUpload />}
                  {' '}{subiendo ? 'Cargando…'
                    : datos ? `Cargar ${datos.partidas.length} partidas`
                            : 'Cargar'}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </Portal>
  );
}

// ───────────────────────────────────────────────────────────────────────────
const rotuloBloque = { fontSize:'11px', fontWeight:700, color:'#475569',
  textTransform:'uppercase', letterSpacing:'.03em', marginBottom:'7px' };
const aviso = (f, b, c) => ({ background:f, border:`1px solid ${b}`,
  borderRadius:'9px', padding:'11px 14px', fontSize:'12.5px', color:c,
  marginTop:'12px', display:'flex', gap:'9px', alignItems:'flex-start',
  lineHeight:1.6 });
const btnBase = { display:'inline-flex', alignItems:'center', gap:'7px',
  borderRadius:'7px', padding:'9px 14px', fontSize:'12.5px', fontWeight:600,
  cursor:'pointer', fontFamily:'inherit' };
const btnSec = { ...btnBase, background:'#fff', color:'#475569',
  border:'1px solid #cbd5e1' };
const btnPri = { ...btnBase, background:'#1463A5', color:'#fff', border:'none' };
const btnCerrar = { background:'transparent', border:'none', cursor:'pointer',
  color:'#64748b', fontSize:'17px', lineHeight:1 };
const fondo = { position:'fixed', inset:0, zIndex:100000,
  background:'rgba(2,8,20,.6)', display:'flex', alignItems:'center',
  justifyContent:'center', padding:'16px' };
const dialogo = { background:'#fff', borderRadius:'13px', width:'100%',
  maxWidth:'880px', maxHeight:'92vh', display:'flex', flexDirection:'column',
  overflow:'hidden',
  fontFamily:'system-ui, -apple-system, Segoe UI, Roboto, sans-serif' };
const cabecera = { padding:'14px 20px', borderBottom:'1px solid #e2e8f0',
  display:'flex', alignItems:'center', justifyContent:'space-between', gap:'12px' };
const pie = { padding:'12px 20px', borderTop:'1px solid #e2e8f0',
  background:'#fff', display:'flex', gap:'9px', justifyContent:'flex-end',
  flexWrap:'wrap' };
