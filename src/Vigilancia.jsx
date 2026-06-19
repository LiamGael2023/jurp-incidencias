import { useState, useEffect } from 'react';
import { FaSyncAlt, FaShieldAlt, FaClock, FaCar, FaExclamationTriangle, FaChevronLeft, FaChevronRight, FaTimes, FaImage, FaMapMarkerAlt, FaUser, FaCalendarAlt, FaCheckCircle, FaSignInAlt, FaSignOutAlt } from 'react-icons/fa';
import './Incidentes.css';

const BASE = '/vigapi';

function Vigilancia() {
  const [tab, setTab] = useState('incidentes');
  const [cargando, setCargando] = useState(false);

  // Data
  const [incidentes, setIncidentes] = useState([]);
  const [turnos, setTurnos] = useState([]);
  const [transitos, setTransitos] = useState([]);
  const [alertas, setAlertas] = useState([]);

  // Paginación
  const [pagInc, setPagInc] = useState(1);
  const [pagTur, setPagTur] = useState(1);
  const [pagTra, setPagTra] = useState(1);
  const itemsPP = 10;

  // Modal imagen
  const [modalImg, setModalImg] = useState(null);

  // ── Cargar datos ──────────────────────────────────────────────────────
  const cargarTodo = async () => {
    setCargando(true);
    try {
      const [rInc, rTur, rTra, rAle] = await Promise.all([
        fetch(`${BASE}/incidentes/lista/`),
        fetch(`${BASE}/incidentes/gestion/`),
        fetch(`${BASE}/transito/`),
        fetch(`${BASE}/alertas/`),
      ]);

      if (rInc.ok) { const d = await rInc.json(); setIncidentes(Array.isArray(d) ? d : d.results || []); }
      if (rTur.ok) { const d = await rTur.json(); setTurnos(Array.isArray(d) ? d : d.results || []); }
      if (rTra.ok) { const d = await rTra.json(); setTransitos(Array.isArray(d) ? d : d.results || []); }
      if (rAle.ok) { const d = await rAle.json(); setAlertas(Array.isArray(d) ? d : d.results || []); }
    } catch(e) { console.error('Error cargando vigilancia:', e); }
    finally { setCargando(false); }
  };

  useEffect(() => { cargarTodo(); }, []);

  // ── Helpers ────────────────────────────────────────────────────────────
  const fmtFecha = (f) => { try { return new Date(f).toLocaleString('es-PE', {day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}); } catch(e) { return f; } };
  const fmtDuracion = (ini, fin) => { if (!fin) return 'En curso...'; const ms = new Date(fin) - new Date(ini); const h = Math.floor(ms/3600000); const m = Math.floor((ms%3600000)/60000); return `${h}h ${m}m`; };
  const paginar = (data, pag) => data.slice((pag-1)*itemsPP, pag*itemsPP);
  const totalPags = (data) => Math.max(1, Math.ceil(data.length / itemsPP));

  // ── KPIs ──────────────────────────────────────────────────────────────
  const turnosActivos = turnos.filter(t => t.activo).length;
  const turnosHoy = turnos.filter(t => { try { return new Date(t.inicio).toDateString() === new Date().toDateString(); } catch(e) { return false; } }).length;
  const transitosHoy = transitos.filter(t => { try { return new Date(t.fecha).toDateString() === new Date().toDateString(); } catch(e) { return false; } }).length;
  const ingresos = transitos.filter(t => t.tipo === 'INGRESO').length;
  const salidas = transitos.filter(t => t.tipo === 'SALIDA').length;
  const alertasActivas = alertas.filter(a => a.estado === 'activa').length;

  const kpi = (color, icon, label, value) => (
    <div style={{background:'#fff',borderRadius:'4px',border:'1px solid rgba(98,105,118,0.16)',padding:'16px 20px',flex:1,minWidth:'140px',borderLeft:`4px solid ${color}`,display:'flex',alignItems:'center',gap:'12px'}}>
      <div style={{fontSize:'22px',color}}>{icon}</div>
      <div>
        <div style={{fontSize:'11px',color:'#626976',textTransform:'uppercase',fontWeight:'600'}}>{label}</div>
        <div style={{fontSize:'24px',fontWeight:'700',color:'#1d273b'}}>{value}</div>
      </div>
    </div>
  );

  const tabBtn = (key, icon, label) => (
    <button onClick={()=>{setTab(key);}} style={{padding:'12px 20px',border:'none',background:'transparent',cursor:'pointer',fontSize:'13px',fontWeight:tab===key?'700':'500',color:tab===key?'#206bc4':'#626976',borderBottom:tab===key?'2px solid #206bc4':'2px solid transparent',marginBottom:'-2px',transition:'all 0.2s',display:'flex',alignItems:'center',gap:'6px'}}>
      {icon} {label}
    </button>
  );

  const paginador = (pag, setPag, total) => (
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'12px 0'}}>
      <span style={{fontSize:'12px',color:'#626976'}}>Página {pag} de {total}</span>
      <div style={{display:'flex',gap:'4px'}}>
        <button disabled={pag===1} onClick={()=>setPag(p=>p-1)} className="tbl-page-link" style={{padding:'4px 10px',border:'1px solid #e2e8f0',borderRadius:'4px',background:'#fff',cursor:pag===1?'default':'pointer'}}><FaChevronLeft size={10}/></button>
        <button disabled={pag>=total} onClick={()=>setPag(p=>p+1)} className="tbl-page-link" style={{padding:'4px 10px',border:'1px solid #e2e8f0',borderRadius:'4px',background:'#fff',cursor:pag>=total?'default':'pointer'}}><FaChevronRight size={10}/></button>
      </div>
    </div>
  );

  if (cargando) return <div className="tbl-page-wrapper"><div className="tbl-empty" style={{height:'60vh',display:'flex',alignItems:'center',justifyContent:'center'}}><FaSyncAlt className="icon-spin" style={{marginRight:'8px'}}/> Cargando módulo de vigilancia...</div></div>;

  return (
    <div className="tbl-page-wrapper">
      <div className="tbl-page-header">
        <div className="tbl-row align-items-center">
          <div className="tbl-col">
            <div className="tbl-page-pretitle">Seguridad y Control</div>
            <h2 className="tbl-page-title">Módulo de Vigilancia</h2>
          </div>
          <div className="tbl-col-auto">
            <button className="tbl-btn tbl-btn-primary" onClick={cargarTodo}><FaSyncAlt style={{marginRight:'8px'}}/> Actualizar</button>
          </div>
        </div>
      </div>

      <div className="tbl-page-body" style={{padding:0,overflowY:'auto',maxHeight:'calc(100vh - 140px)'}}>
        {/* ── Tabs ──────────────────────────────────────────────────────── */}
        <div style={{display:'flex',borderBottom:'2px solid #e2e8f0',background:'#fff',padding:'0 20px',position:'sticky',top:0,zIndex:10}}>
          {tabBtn('incidentes', <FaExclamationTriangle/>, `Incidentes (${incidentes.length})`)}
          {tabBtn('turnos', <FaClock/>, `Turnos (${turnos.length})`)}
          {tabBtn('transitos', <FaCar/>, `Tránsitos (${transitos.length})`)}
        </div>

        <div style={{padding:'20px'}}>

          {/* ════════════════════════════════════════════════════════════════ */}
          {/* ── TAB: INCIDENTES ──────────────────────────────────────────── */}
          {/* ════════════════════════════════════════════════════════════════ */}
          {tab === 'incidentes' && (<>
            <div style={{display:'flex',gap:'12px',flexWrap:'wrap',marginBottom:'20px'}}>
              {kpi('#d63939', <FaExclamationTriangle/>, 'Total Incidentes', incidentes.length)}
              {kpi('#f59f00', <FaShieldAlt/>, 'Alertas Activas', alertasActivas)}
              {kpi('#206bc4', <FaUser/>, 'Alertas Total', alertas.length)}
            </div>

            <div style={{background:'#fff',borderRadius:'4px',border:'1px solid rgba(98,105,118,0.16)',overflow:'hidden'}}>
              <table style={{width:'100%',borderCollapse:'collapse',fontSize:'13px'}}>
                <thead>
                  <tr style={{background:'#f8fafc',borderBottom:'1px solid #e2e8f0'}}>
                    <th style={{padding:'10px 14px',textAlign:'left',fontWeight:'600',color:'#475569'}}>Tipo</th>
                    <th style={{padding:'10px 14px',textAlign:'left',fontWeight:'600',color:'#475569'}}>Título</th>
                    <th style={{padding:'10px 14px',textAlign:'left',fontWeight:'600',color:'#475569'}}>Descripción</th>
                    <th style={{padding:'10px 14px',textAlign:'left',fontWeight:'600',color:'#475569'}}>Reportado por</th>
                    <th style={{padding:'10px 14px',textAlign:'left',fontWeight:'600',color:'#475569'}}>Fecha</th>
                    <th style={{padding:'10px 14px',textAlign:'center',fontWeight:'600',color:'#475569'}}>Evidencias</th>
                  </tr>
                </thead>
                <tbody>
                  {paginar(incidentes, pagInc).map((inc, i) => (
                    <tr key={inc.id || i} style={{borderBottom:'1px solid #f1f5f9'}}>
                      <td style={{padding:'10px 14px'}}><span style={{background:'#fee2e2',color:'#dc2626',padding:'2px 8px',borderRadius:'4px',fontSize:'11px',fontWeight:'600'}}>{inc.tipo}</span></td>
                      <td style={{padding:'10px 14px',fontWeight:'600',color:'#1d273b'}}>{inc.titulo}</td>
                      <td style={{padding:'10px 14px',color:'#475569',maxWidth:'250px',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{inc.descripcion}</td>
                      <td style={{padding:'10px 14px',color:'#475569'}}>{inc.reportado_por_nombre}</td>
                      <td style={{padding:'10px 14px',color:'#475569',whiteSpace:'nowrap'}}>{fmtFecha(inc.fecha_reporte)}</td>
                      <td style={{padding:'10px 14px',textAlign:'center'}}>
                        {(inc.evidencias || []).length > 0 ? (
                          <div style={{display:'flex',gap:'4px',justifyContent:'center'}}>
                            {inc.evidencias.slice(0,3).map((ev, j) => (
                              <img key={j} src={ev.archivo} alt="" onClick={()=>setModalImg(ev.archivo)} style={{width:'36px',height:'36px',objectFit:'cover',borderRadius:'4px',border:'1px solid #e2e8f0',cursor:'pointer'}} />
                            ))}
                            {inc.evidencias.length > 3 && <span style={{fontSize:'11px',color:'#626976',alignSelf:'center'}}>+{inc.evidencias.length-3}</span>}
                          </div>
                        ) : <span style={{color:'#cbd5e1',fontSize:'11px'}}>—</span>}
                      </td>
                    </tr>
                  ))}
                  {incidentes.length === 0 && <tr><td colSpan="6" style={{padding:'30px',textAlign:'center',color:'#626976'}}>No hay incidentes registrados</td></tr>}
                </tbody>
              </table>
              {paginador(pagInc, setPagInc, totalPags(incidentes))}
            </div>
          </>)}

          {/* ════════════════════════════════════════════════════════════════ */}
          {/* ── TAB: TURNOS ──────────────────────────────────────────────── */}
          {/* ════════════════════════════════════════════════════════════════ */}
          {tab === 'turnos' && (<>
            <div style={{display:'flex',gap:'12px',flexWrap:'wrap',marginBottom:'20px'}}>
              {kpi('#2fb344', <FaCheckCircle/>, 'Total Turnos', turnos.length)}
              {kpi('#206bc4', <FaClock/>, 'Activos Ahora', turnosActivos)}
              {kpi('#f59f00', <FaCalendarAlt/>, 'Turnos Hoy', turnosHoy)}
            </div>

            <div style={{background:'#fff',borderRadius:'4px',border:'1px solid rgba(98,105,118,0.16)',overflow:'hidden'}}>
              <table style={{width:'100%',borderCollapse:'collapse',fontSize:'13px'}}>
                <thead>
                  <tr style={{background:'#f8fafc',borderBottom:'1px solid #e2e8f0'}}>
                    <th style={{padding:'10px 14px',textAlign:'left',fontWeight:'600',color:'#475569'}}>ID</th>
                    <th style={{padding:'10px 14px',textAlign:'left',fontWeight:'600',color:'#475569'}}>Inicio</th>
                    <th style={{padding:'10px 14px',textAlign:'left',fontWeight:'600',color:'#475569'}}>Fin</th>
                    <th style={{padding:'10px 14px',textAlign:'left',fontWeight:'600',color:'#475569'}}>Duración</th>
                    <th style={{padding:'10px 14px',textAlign:'center',fontWeight:'600',color:'#475569'}}>Estado</th>
                    <th style={{padding:'10px 14px',textAlign:'center',fontWeight:'600',color:'#475569'}}>Foto Inicio</th>
                    <th style={{padding:'10px 14px',textAlign:'center',fontWeight:'600',color:'#475569'}}>Foto Fin</th>
                  </tr>
                </thead>
                <tbody>
                  {paginar(turnos, pagTur).map((t, i) => (
                    <tr key={t.id || i} style={{borderBottom:'1px solid #f1f5f9'}}>
                      <td style={{padding:'10px 14px',fontWeight:'600',color:'#1d273b'}}>#{t.id}</td>
                      <td style={{padding:'10px 14px',color:'#475569',whiteSpace:'nowrap'}}>{fmtFecha(t.inicio)}</td>
                      <td style={{padding:'10px 14px',color:'#475569',whiteSpace:'nowrap'}}>{t.fin ? fmtFecha(t.fin) : '—'}</td>
                      <td style={{padding:'10px 14px',fontWeight:'600',color:'#206bc4'}}>{fmtDuracion(t.inicio, t.fin)}</td>
                      <td style={{padding:'10px 14px',textAlign:'center'}}>
                        {t.activo ? <span style={{background:'#d3f9d8',color:'#2b8a3e',padding:'3px 10px',borderRadius:'4px',fontSize:'11px',fontWeight:'700'}}>Activo</span>
                                  : <span style={{background:'#f1f3f5',color:'#626976',padding:'3px 10px',borderRadius:'4px',fontSize:'11px',fontWeight:'600'}}>Cerrado</span>}
                      </td>
                      <td style={{padding:'10px 14px',textAlign:'center'}}>
                        {t.foto_inicio ? <img src={t.foto_inicio} alt="" onClick={()=>setModalImg(t.foto_inicio)} style={{width:'40px',height:'40px',objectFit:'cover',borderRadius:'4px',border:'1px solid #e2e8f0',cursor:'pointer'}}/> : <span style={{color:'#cbd5e1'}}>—</span>}
                      </td>
                      <td style={{padding:'10px 14px',textAlign:'center'}}>
                        {t.foto_fin ? <img src={t.foto_fin} alt="" onClick={()=>setModalImg(t.foto_fin)} style={{width:'40px',height:'40px',objectFit:'cover',borderRadius:'4px',border:'1px solid #e2e8f0',cursor:'pointer'}}/> : <span style={{color:'#cbd5e1'}}>—</span>}
                      </td>
                    </tr>
                  ))}
                  {turnos.length === 0 && <tr><td colSpan="7" style={{padding:'30px',textAlign:'center',color:'#626976'}}>No hay turnos registrados</td></tr>}
                </tbody>
              </table>
              {paginador(pagTur, setPagTur, totalPags(turnos))}
            </div>
          </>)}

          {/* ════════════════════════════════════════════════════════════════ */}
          {/* ── TAB: TRÁNSITOS ───────────────────────────────────────────── */}
          {/* ════════════════════════════════════════════════════════════════ */}
          {tab === 'transitos' && (<>
            <div style={{display:'flex',gap:'12px',flexWrap:'wrap',marginBottom:'20px'}}>
              {kpi('#206bc4', <FaCar/>, 'Total Tránsitos', transitos.length)}
              {kpi('#2fb344', <FaSignInAlt/>, 'Ingresos', ingresos)}
              {kpi('#d63939', <FaSignOutAlt/>, 'Salidas', salidas)}
              {kpi('#f59f00', <FaCalendarAlt/>, 'Hoy', transitosHoy)}
            </div>

            <div style={{background:'#fff',borderRadius:'4px',border:'1px solid rgba(98,105,118,0.16)',overflow:'hidden'}}>
              <table style={{width:'100%',borderCollapse:'collapse',fontSize:'13px'}}>
                <thead>
                  <tr style={{background:'#f8fafc',borderBottom:'1px solid #e2e8f0'}}>
                    <th style={{padding:'10px 14px',textAlign:'left',fontWeight:'600',color:'#475569'}}>Tipo</th>
                    <th style={{padding:'10px 14px',textAlign:'left',fontWeight:'600',color:'#475569'}}>Vigilante</th>
                    <th style={{padding:'10px 14px',textAlign:'left',fontWeight:'600',color:'#475569'}}>Garita</th>
                    <th style={{padding:'10px 14px',textAlign:'left',fontWeight:'600',color:'#475569'}}>Placa</th>
                    <th style={{padding:'10px 14px',textAlign:'center',fontWeight:'600',color:'#475569'}}>Ocup.</th>
                    <th style={{padding:'10px 14px',textAlign:'left',fontWeight:'600',color:'#475569'}}>Fecha</th>
                    <th style={{padding:'10px 14px',textAlign:'left',fontWeight:'600',color:'#475569'}}>Observación</th>
                    <th style={{padding:'10px 14px',textAlign:'center',fontWeight:'600',color:'#475569'}}>Fotos</th>
                  </tr>
                </thead>
                <tbody>
                  {paginar(transitos, pagTra).map((t, i) => (
                    <tr key={t.id || i} style={{borderBottom:'1px solid #f1f5f9'}}>
                      <td style={{padding:'10px 14px'}}>
                        {t.tipo === 'INGRESO' 
                          ? <span style={{background:'#d3f9d8',color:'#2b8a3e',padding:'3px 10px',borderRadius:'4px',fontSize:'11px',fontWeight:'700',display:'inline-flex',alignItems:'center',gap:'4px'}}><FaSignInAlt size={10}/> Ingreso</span>
                          : <span style={{background:'#fee2e2',color:'#dc2626',padding:'3px 10px',borderRadius:'4px',fontSize:'11px',fontWeight:'700',display:'inline-flex',alignItems:'center',gap:'4px'}}><FaSignOutAlt size={10}/> Salida</span>}
                      </td>
                      <td style={{padding:'10px 14px',fontWeight:'500',color:'#1d273b'}}>{t.usuario_nombre}</td>
                      <td style={{padding:'10px 14px',color:'#475569'}}>{t.garita || '—'}</td>
                      <td style={{padding:'10px 14px',fontWeight:'700',color:'#1d273b',letterSpacing:'1px'}}>{t.placa}</td>
                      <td style={{padding:'10px 14px',textAlign:'center',fontWeight:'600'}}>{t.ocupantes}</td>
                      <td style={{padding:'10px 14px',color:'#475569',whiteSpace:'nowrap'}}>{fmtFecha(t.fecha)}</td>
                      <td style={{padding:'10px 14px',color:'#475569',maxWidth:'180px',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{t.observacion || '—'}</td>
                      <td style={{padding:'10px 14px',textAlign:'center'}}>
                        <div style={{display:'flex',gap:'4px',justifyContent:'center'}}>
                          {(t.foto_documento || t.foto_documento_url) && <img src={t.foto_documento || t.foto_documento_url} alt="Doc" onClick={()=>setModalImg(t.foto_documento || t.foto_documento_url)} style={{width:'36px',height:'36px',objectFit:'cover',borderRadius:'4px',border:'1px solid #e2e8f0',cursor:'pointer'}} title="Documento"/>}
                          {(t.foto_movilidad || t.foto_movilidad_url) && <img src={t.foto_movilidad || t.foto_movilidad_url} alt="Mov" onClick={()=>setModalImg(t.foto_movilidad || t.foto_movilidad_url)} style={{width:'36px',height:'36px',objectFit:'cover',borderRadius:'4px',border:'1px solid #e2e8f0',cursor:'pointer'}} title="Movilidad"/>}
                          {!(t.foto_documento || t.foto_documento_url) && !(t.foto_movilidad || t.foto_movilidad_url) && <span style={{color:'#cbd5e1',fontSize:'11px'}}>—</span>}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {transitos.length === 0 && <tr><td colSpan="8" style={{padding:'30px',textAlign:'center',color:'#626976'}}>No hay tránsitos registrados</td></tr>}
                </tbody>
              </table>
              {paginador(pagTra, setPagTra, totalPags(transitos))}
            </div>
          </>)}

        </div>
      </div>

      {/* ── Modal Imagen ─────────────────────────────────────────────────── */}
      {modalImg && (
        <div onClick={()=>setModalImg(null)} style={{position:'fixed',top:0,left:0,right:0,bottom:0,zIndex:10001,background:'rgba(0,0,0,0.9)',display:'flex',alignItems:'center',justifyContent:'center',cursor:'zoom-out'}}>
          <button onClick={()=>setModalImg(null)} style={{position:'absolute',top:'16px',right:'20px',background:'rgba(255,255,255,0.15)',border:'none',color:'#fff',fontSize:'22px',cursor:'pointer',borderRadius:'50%',width:'40px',height:'40px',display:'flex',alignItems:'center',justifyContent:'center'}}>✕</button>
          <img src={modalImg} alt="Evidencia" onClick={e=>e.stopPropagation()} style={{maxWidth:'90vw',maxHeight:'90vh',objectFit:'contain',borderRadius:'8px',cursor:'default'}} />
        </div>
      )}
    </div>
  );
}

export default Vigilancia;