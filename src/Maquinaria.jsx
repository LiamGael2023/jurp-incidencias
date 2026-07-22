// ─────────────────────────────────────────────────────────────────────────────
//  Página: Panel de Maquinaria
//  Muestra todas las máquinas del catálogo con su estado (disponible / en
//  incidente). Filtros por origen y estado. Al hacer clic en cualquier máquina
//  se muestra su historial completo de partes diarios (abiertos y cerrados).
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useEffect } from 'react';
import Swal from 'sweetalert2';
import {
  FaTruck, FaSyncAlt, FaCheckCircle, FaExclamationTriangle, FaTimes,
  FaDownload, FaFilePdf, FaMapMarkerAlt, FaTools, FaClock, FaHistory, FaCog, FaSearch, FaExternalLinkAlt,
} from 'react-icons/fa';
import MantenedorEquipos from './MantenedorEquipos';

const API_OPS = 'https://gideonstudio.duckdns.org/api/v1/mobile/operations';

const fmtNum = (n) => (parseFloat(n) || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function Maquinaria({ irAIncidente }) {
  const [maquinas, setMaquinas] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [filtroOrigen, setFiltroOrigen] = useState('');   // '' | JURP | EXTERNA
  const [filtroEstado, setFiltroEstado] = useState('');   // '' | 0 | 1
  const [busqueda, setBusqueda] = useState('');
  const [pagina, setPagina] = useState(1);
  const PORPAGINA = 8;
  const [detalle, setDetalle] = useState(null);           // máquina seleccionada
  const [historial, setHistorial] = useState(null);       // { maquina, partes, totales }
  const [cargandoHist, setCargandoHist] = useState(false);
  const [pdfModal, setPdfModal] = useState(null);         // { url, nombre }
  const [mantenedorAbierto, setMantenedorAbierto] = useState(false);

  const cargar = async () => {
    setCargando(true);
    try {
      const params = new URLSearchParams();
      if (filtroOrigen) params.append('origen', filtroOrigen);
      if (filtroEstado === '0' || filtroEstado === '1') params.append('estado', filtroEstado);
      const r = await fetch(`${API_OPS}/maquinaria-estado/?${params.toString()}`);
      if (r.ok) {
        const d = await r.json();
        setMaquinas(d.maquinaria || []);
      }
    } catch (e) { console.error(e); } finally { setCargando(false); }
  };
  useEffect(() => { cargar(); }, [filtroOrigen, filtroEstado]);

  // Pone / quita una máquina de mantenimiento (con observación).
  const toggleMantenimiento = async (m) => {
    const entrando = !m.en_mantenimiento;
    const { value: obs, isConfirmed } = await Swal.fire({
      title: entrando ? `Enviar a mantenimiento · ${m.codigo}` : `Marcar operativa · ${m.codigo}`,
      input: 'textarea',
      inputLabel: 'Observación (opcional)',
      inputPlaceholder: entrando
        ? 'Ej. Cambio de aceite, falla hidráulica...'
        : 'Ej. Mantenimiento completado, lista para operar',
      inputValue: entrando ? '' : (m.mantenimiento_obs || ''),
      showCancelButton: true,
      confirmButtonText: entrando ? 'Enviar a mantenimiento' : 'Marcar operativa',
      confirmButtonColor: entrando ? '#d97706' : '#16a34a',
    });
    if (!isConfirmed) return;
    try {
      const r = await fetch(`${API_OPS}/modelos/${m.id}/mantenimiento/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ en_mantenimiento: entrando, observacion: obs || '' }),
      });
      if (r.ok) {
        cargar();
        Swal.fire({
          icon: 'success',
          title: entrando ? 'En mantenimiento' : 'Operativa',
          timer: 1400, showConfirmButton: false,
        });
      } else {
        const e = await r.json().catch(() => ({}));
        Swal.fire('No se pudo', e.detail || 'Inténtalo de nuevo.', 'error');
      }
    } catch (e) {
      Swal.fire('Error', 'Sin conexión con el servidor.', 'error');
    }
  };

  // Abre el modal con el historial de partes de una máquina.
  const abrirDetalle = async (m) => {
    setDetalle(m);
    setHistorial(null);
    setCargandoHist(true);
    try {
      const r = await fetch(`${API_OPS}/modelos/${m.id}/partes/`);
      if (r.ok) {
        setHistorial(await r.json());
      } else {
        Swal.fire('Error', `No se pudo cargar el historial (código ${r.status}). ¿Agregaste el endpoint en el backend?`, 'error');
      }
    } catch (e) {
      Swal.fire('Error', 'Fallo de conexión al cargar el historial.', 'error');
    } finally { setCargandoHist(false); }
  };

  // Abre el PDF del parte en un modal (igual que en Reportes / parte diario).
  const abrirPdfParte = async (parteId, nombre) => {
    const url = `${API_OPS}/daily-part-heavy-equipments/${parteId}/pdf/`;
    setPdfModal({ url, nombre: nombre || `Parte ${parteId}` });
  };

  // Filtra por texto de búsqueda (código, equipo, marca, modelo, placa).
  const maquinasFiltradas = maquinas.filter(m => {
    // Filtro "solo en mantenimiento" se resuelve aquí (no viaja al backend).
    if (filtroEstado === 'mant' && !m.en_mantenimiento) return false;
    if (!busqueda.trim()) return true;
    const q = busqueda.toLowerCase().trim();
    const texto = `${m.codigo} ${m.equipo} ${m.marca} ${m.modelo} ${m.placa || ''}`.toLowerCase();
    return texto.includes(q);
  });

  // Paginación de 8 en 8 sobre la lista filtrada.
  const totalPaginas = Math.max(1, Math.ceil(maquinasFiltradas.length / PORPAGINA));
  const paginaSegura = Math.min(pagina, totalPaginas);
  const inicio = (paginaSegura - 1) * PORPAGINA;
  const maquinasPagina = maquinasFiltradas.slice(inicio, inicio + PORPAGINA);
  // Al buscar o filtrar, vuelve a la primera página.
  useEffect(() => { setPagina(1); }, [busqueda, filtroOrigen, filtroEstado]);

  const disponibles = maquinas.filter(m => m.disponible).length;
  const enMantenimiento = maquinas.filter(m => m.en_mantenimiento).length;
  const ocupadas = maquinas.filter(m => !m.disponible && !m.en_mantenimiento).length;

  return (
    <div style={{ height: '100%', overflowY: 'auto', overflowX: 'hidden' }}>
    <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto' }}>
      {/* Encabezado */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <div style={{ fontSize: '12px', color: '#94a3b8', fontWeight: 600, letterSpacing: '0.5px' }}>GESTIÓN DE FLOTA</div>
          <h2 style={{ margin: '2px 0 0', fontSize: '24px', color: '#1e293b' }}>Panel de Maquinaria</h2>
        </div>
        <div style={{ display:'flex', gap:'8px', flexWrap:'wrap' }}>
          <button onClick={() => setMantenedorAbierto(true)} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: '#206bc4', border: 'none', borderRadius: '8px', padding: '8px 16px', cursor: 'pointer', fontSize: '13px', fontWeight: 600, color: '#fff' }}>
            <FaCog /> Gestionar catálogo
          </button>
          <button onClick={cargar} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: '#fff', border: '1px solid #cbd5e1', borderRadius: '8px', padding: '8px 16px', cursor: 'pointer', fontSize: '13px', fontWeight: 600, color: '#334155' }}>
            <FaSyncAlt /> Actualizar
          </button>
        </div>
      </div>

      {/* Tarjetas de resumen */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px', marginBottom: '20px' }}>
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderLeft: '4px solid #206bc4', borderRadius: '8px', padding: '14px 18px' }}>
          <div style={{ fontSize: '12px', color: '#64748b', fontWeight: 600 }}>TOTAL MÁQUINAS</div>
          <div style={{ fontSize: '28px', fontWeight: 700, color: '#1e293b' }}>{maquinas.length}</div>
        </div>
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderLeft: '4px solid #16a34a', borderRadius: '8px', padding: '14px 18px' }}>
          <div style={{ fontSize: '12px', color: '#64748b', fontWeight: 600 }}>DISPONIBLES</div>
          <div style={{ fontSize: '28px', fontWeight: 700, color: '#16a34a' }}>{disponibles}</div>
        </div>
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderLeft: '4px solid #dc2626', borderRadius: '8px', padding: '14px 18px' }}>
          <div style={{ fontSize: '12px', color: '#64748b', fontWeight: 600 }}>EN INCIDENTE</div>
          <div style={{ fontSize: '28px', fontWeight: 700, color: '#dc2626' }}>{ocupadas}</div>
        </div>
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderLeft: '4px solid #f59e0b', borderRadius: '8px', padding: '14px 18px' }}>
          <div style={{ fontSize: '12px', color: '#64748b', fontWeight: 600 }}>EN MANTENIMIENTO</div>
          <div style={{ fontSize: '28px', fontWeight: 700, color: '#d97706' }}>{enMantenimiento}</div>
        </div>
      </div>

      {/* Filtros */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '18px', flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: '13px', color: '#64748b', fontWeight: 600 }}>Filtrar:</span>
        <select value={filtroOrigen} onChange={e => setFiltroOrigen(e.target.value)} style={selStyle}>
          <option value="">Todos los orígenes</option>
          <option value="JURP">JURP (propia)</option>
          <option value="EXTERNA">Externa</option>
        </select>
        <select value={filtroEstado} onChange={e => setFiltroEstado(e.target.value)} style={selStyle}>
          <option value="">Todos los estados</option>
          <option value="0">Solo disponibles</option>
          <option value="1">Solo en incidente</option>
          <option value="mant">Solo en mantenimiento</option>
        </select>
        <div style={{ position:'relative', flex:'1', minWidth:'200px', maxWidth:'360px' }}>
          <FaSearch size={12} style={{ position:'absolute', left:'12px', top:'50%', transform:'translateY(-50%)', color:'#94a3b8' }} />
          <input type="text" placeholder="Buscar código, equipo, modelo, placa..." value={busqueda} onChange={e => setBusqueda(e.target.value)}
            style={{ width:'100%', padding:'8px 12px 8px 34px', border:'1px solid #cbd5e1', borderRadius:'8px', fontSize:'13px', color:'#334155', boxSizing:'border-box' }} />
          {busqueda && (
            <button onClick={() => setBusqueda('')} title="Limpiar" style={{ position:'absolute', right:'8px', top:'50%', transform:'translateY(-50%)', background:'none', border:'none', cursor:'pointer', color:'#94a3b8', display:'flex', padding:'2px' }}><FaTimes size={12} /></button>
          )}
        </div>
        {busqueda && <span style={{ fontSize:'12px', color:'#64748b', fontWeight:600, whiteSpace:'nowrap' }}>{maquinasFiltradas.length} de {maquinas.length}</span>}
      </div>

      {/* Grid de tarjetas */}
      {cargando ? (
        <div style={{ textAlign: 'center', padding: '60px', color: '#94a3b8' }}>
          <FaSyncAlt className="spin-anim" style={{ fontSize: '32px' }} />
          <p>Cargando maquinaria…</p>
        </div>
      ) : maquinas.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px', color: '#94a3b8' }}>
          <FaTruck style={{ fontSize: '40px', opacity: 0.4 }} />
          <p>No hay máquinas que coincidan con el filtro.</p>
        </div>
      ) : maquinasFiltradas.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px', color: '#94a3b8' }}>
          <FaSearch style={{ fontSize: '36px', opacity: 0.4 }} />
          <p>Ninguna máquina coincide con "{busqueda}".</p>
          <button onClick={() => setBusqueda('')} style={{ marginTop:'8px', background:'#206bc4', color:'#fff', border:'none', borderRadius:'8px', padding:'8px 16px', fontSize:'13px', fontWeight:600, cursor:'pointer' }}>Limpiar búsqueda</button>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '14px' }}>
          {maquinasPagina.map(m => {
            const enMant = !!m.en_mantenimiento;
            const ocupada = !m.disponible && !enMant;
            // Color de borde/banda según los 3 estados posibles.
            const cBorde = enMant ? '#fed7aa' : (ocupada ? '#fecaca' : '#bbf7d0');
            const cBandaBg = enMant ? '#fff7ed' : (ocupada ? '#fef2f2' : '#f0fdf4');
            const cTexto = enMant ? '#d97706' : (ocupada ? '#dc2626' : '#16a34a');
            const etiqueta = enMant ? 'EN MANTENIMIENTO' : (ocupada ? 'EN INCIDENTE' : 'DISPONIBLE');
            return (
              <div key={m.id}
                onClick={() => abrirDetalle(m)}
                style={{
                  background: '#fff', borderRadius: '10px', overflow: 'hidden',
                  border: `1px solid ${cBorde}`,
                  cursor: 'pointer',
                  transition: 'box-shadow 0.15s',
                }}
                onMouseEnter={e => e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)'}
                onMouseLeave={e => e.currentTarget.style.boxShadow = 'none'}
              >
                {/* Banda de estado */}
                <div style={{ background: cBandaBg, padding: '8px 14px', display: 'flex', alignItems: 'center', gap: '6px', borderBottom: `1px solid ${cBorde}` }}>
                  {enMant ? <FaTools color="#d97706" size={13} /> : (ocupada ? <FaExclamationTriangle color="#dc2626" size={13} /> : <FaCheckCircle color="#16a34a" size={13} />)}
                  <span style={{ fontSize: '12px', fontWeight: 700, color: cTexto }}>
                    {etiqueta}
                  </span>
                  <span style={{ marginLeft: 'auto', fontSize: '11px', fontWeight: 700, color: '#fff', background: m.origen === 'JURP' ? '#206bc4' : '#d6832b', padding: '2px 8px', borderRadius: '4px' }}>
                    {m.origen === 'JURP' ? 'JURP' : 'EXT'}
                  </span>
                </div>

                {/* Cuerpo */}
                <div style={{ padding: '14px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                    <FaTruck color="#475569" />
                    <span style={{ fontWeight: 700, fontSize: '15px', color: '#1e293b' }}>{m.codigo}</span>
                  </div>
                  <div style={{ fontSize: '13px', color: '#475569' }}>{m.equipo} · {m.marca}</div>
                  <div style={{ fontSize: '13px', color: '#64748b', marginTop: '2px' }}>
                    {m.modelo && <span>Modelo: <b>{m.modelo}</b></span>}
                    {m.modelo && m.placa && ' · '}
                    {m.placa && <span>Placa: <b>{m.placa}</b></span>}
                  </div>

                  {/* Info del incidente si está ocupada */}
                  {ocupada && m.parte_activo && (
                    <div style={{ marginTop: '10px', padding: '10px', background: '#fef2f2', borderRadius: '6px', fontSize: '12px', border: '1px solid #fecaca' }}>
                      <div style={{ color: '#991b1b', fontWeight: 700, marginBottom: '3px' }}>{m.parte_activo.part_number}</div>
                      {m.parte_activo.incidente_tipo && (
                        <div style={{ color: '#7f1d1d', marginBottom: '2px', fontWeight: 600 }}>{m.parte_activo.incidente_tipo}</div>
                      )}
                      <div style={{ color: '#7f1d1d', marginBottom: '6px' }}><FaMapMarkerAlt size={10} /> {m.parte_activo.incidente_lugar || 'Sin ubicación'}</div>
                      {m.parte_activo.incidente_id && irAIncidente && (
                        <button
                          onClick={(e) => { e.stopPropagation(); irAIncidente(m.parte_activo.incidente_id); }}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', background: '#dc2626', color: '#fff', border: 'none', borderRadius: '5px', padding: '5px 11px', fontSize: '11px', fontWeight: 600, cursor: 'pointer', width: '100%', justifyContent: 'center' }}>
                          <FaExternalLinkAlt size={10} /> Ir a la incidencia
                        </button>
                      )}
                    </div>
                  )}
                  {ocupada && !m.parte_activo && (
                    <div style={{ marginTop: '10px', fontSize: '11px', color: '#94a3b8', fontStyle: 'italic' }}>No disponible (sin parte vinculado)</div>
                  )}

                  {/* Info de mantenimiento si aplica */}
                  {enMant && (
                    <div style={{ marginTop: '10px', padding: '10px', background: '#fff7ed', borderRadius: '6px', fontSize: '12px', border: '1px solid #fed7aa' }}>
                      <div style={{ color: '#b45309', fontWeight: 700, marginBottom: '3px', display: 'flex', alignItems: 'center', gap: '5px' }}><FaTools size={11} /> En mantenimiento</div>
                      {m.mantenimiento_obs && <div style={{ color: '#92400e', marginBottom: '2px' }}>{m.mantenimiento_obs}</div>}
                      {m.mantenimiento_inicio && <div style={{ color: '#a16207', fontSize: '11px' }}>Desde: {new Date(m.mantenimiento_inicio).toLocaleString('es-PE')}</div>}
                    </div>
                  )}

                  {/* Botón enviar / liberar de mantenimiento (no disponible si hay parte abierto) */}
                  {!ocupada && (
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleMantenimiento(m); }}
                      style={{ marginTop: '10px', width: '100%', justifyContent: 'center', display: 'inline-flex', alignItems: 'center', gap: '6px',
                        background: enMant ? '#16a34a' : '#f59e0b', color: '#fff', border: 'none', borderRadius: '6px', padding: '7px 11px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>
                      <FaTools size={11} /> {enMant ? 'Marcar operativa' : 'Enviar a mantenimiento'}
                    </button>
                  )}

                  <div style={{ marginTop: '10px', color: '#206bc4', fontWeight: 600, fontSize: '11px', display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <FaHistory size={10} /> Ver historial de partes →
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Paginador (8 por página) ────────────────────────────────────── */}
      {maquinasFiltradas.length > PORPAGINA && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', marginTop: '20px', flexWrap: 'wrap' }}>
          <button onClick={() => setPagina(p => Math.max(1, p - 1))} disabled={paginaSegura === 1}
            style={{ padding: '7px 14px', borderRadius: '8px', border: '1px solid #cbd5e1', background: paginaSegura === 1 ? '#f1f5f9' : '#fff', color: paginaSegura === 1 ? '#94a3b8' : '#334155', cursor: paginaSegura === 1 ? 'default' : 'pointer', fontSize: '13px', fontWeight: 600 }}>
            ← Anterior
          </button>

          {Array.from({ length: totalPaginas }, (_, i) => i + 1)
            .filter(n => n === 1 || n === totalPaginas || Math.abs(n - paginaSegura) <= 1)
            .map((n, idx, arr) => (
              <span key={n} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {idx > 0 && arr[idx - 1] !== n - 1 && <span style={{ color: '#94a3b8' }}>…</span>}
                <button onClick={() => setPagina(n)}
                  style={{ minWidth: '36px', padding: '7px 0', borderRadius: '8px', border: '1px solid', borderColor: n === paginaSegura ? '#206bc4' : '#cbd5e1', background: n === paginaSegura ? '#206bc4' : '#fff', color: n === paginaSegura ? '#fff' : '#334155', cursor: 'pointer', fontSize: '13px', fontWeight: 700 }}>
                  {n}
                </button>
              </span>
            ))}

          <button onClick={() => setPagina(p => Math.min(totalPaginas, p + 1))} disabled={paginaSegura === totalPaginas}
            style={{ padding: '7px 14px', borderRadius: '8px', border: '1px solid #cbd5e1', background: paginaSegura === totalPaginas ? '#f1f5f9' : '#fff', color: paginaSegura === totalPaginas ? '#94a3b8' : '#334155', cursor: paginaSegura === totalPaginas ? 'default' : 'pointer', fontSize: '13px', fontWeight: 600 }}>
            Siguiente →
          </button>

          <span style={{ marginLeft: '8px', fontSize: '12px', color: '#64748b', whiteSpace: 'nowrap' }}>
            Página {paginaSegura} de {totalPaginas} · {maquinasFiltradas.length} máquinas
          </span>
        </div>
      )}

      {/* ── Modal de historial de partes ───────────────────────────────── */}
      {detalle && (
        <div onClick={() => { setDetalle(null); setHistorial(null); }} style={overlayStyle}>
          <div onClick={e => e.stopPropagation()} style={{ ...modalStyle, maxWidth: '960px' }}>
            <div style={modalHeadStyle}>
              <h5 style={{ margin: 0, fontSize: '16px', color: '#1e293b', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <FaTruck color="#475569" /> {detalle.codigo} · {detalle.modelo || detalle.placa}
              </h5>
              <button onClick={() => { setDetalle(null); setHistorial(null); }} style={xBtnStyle}><FaTimes /></button>
            </div>

            <div style={{ padding: '18px', overflowY: 'auto' }}>
              {/* Badge de estado */}
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px',
                background: detalle.en_mantenimiento ? '#fff7ed' : (detalle.disponible ? '#f0fdf4' : '#fef2f2'),
                color: detalle.en_mantenimiento ? '#d97706' : (detalle.disponible ? '#16a34a' : '#dc2626'),
                padding: '4px 12px', borderRadius: '6px', fontSize: '12px', fontWeight: 700, marginBottom: '14px' }}>
                {detalle.en_mantenimiento ? <FaTools size={12} /> : (detalle.disponible ? <FaCheckCircle size={12} /> : <FaExclamationTriangle size={12} />)}
                {detalle.en_mantenimiento ? 'EN MANTENIMIENTO' : (detalle.disponible ? 'DISPONIBLE' : 'EN INCIDENTE')}
              </div>

              {/* Datos de la máquina */}
              <div style={{ background: '#f8fafc', borderRadius: '8px', padding: '12px', marginBottom: '16px' }}>
                <Campo label="Equipo" valor={`${detalle.equipo} · ${detalle.marca}`} />
                <Campo label="Modelo" valor={detalle.modelo} />
                <Campo label="Placa" valor={detalle.placa} />
                <Campo label="Origen" valor={detalle.origen_texto} />
              </div>

              {/* Totales del historial */}
              {historial && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', marginBottom: '14px' }}>
                  <div style={{ background: '#eff6ff', borderRadius: '6px', padding: '8px 10px', textAlign: 'center' }}>
                    <div style={{ fontSize: '10px', color: '#64748b', fontWeight: 600 }}>PARTES</div>
                    <div style={{ fontSize: '18px', fontWeight: 700, color: '#206bc4' }}>{historial.total_partes}</div>
                  </div>
                  <div style={{ background: '#fffbeb', borderRadius: '6px', padding: '8px 10px', textAlign: 'center' }}>
                    <div style={{ fontSize: '10px', color: '#64748b', fontWeight: 600 }}>HORAS</div>
                    <div style={{ fontSize: '18px', fontWeight: 700, color: '#b45309' }}>{historial.total_horas}</div>
                  </div>
                  <div style={{ background: '#f0fdf4', borderRadius: '6px', padding: '8px 10px', textAlign: 'center' }}>
                    <div style={{ fontSize: '10px', color: '#64748b', fontWeight: 600 }}>COSTO</div>
                    <div style={{ fontSize: '16px', fontWeight: 700, color: '#16a34a' }}>S/ {fmtNum(historial.total_costo)}</div>
                  </div>
                </div>
              )}

              {/* Lista de partes */}
              <div style={{ fontSize: '12px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <FaHistory size={11} /> Historial de partes diarios
              </div>

              {cargandoHist ? (
                <div style={{ textAlign: 'center', padding: '30px', color: '#94a3b8' }}>
                  <FaSyncAlt className="spin-anim" style={{ fontSize: '22px' }} />
                  <p style={{ fontSize: '13px' }}>Cargando historial…</p>
                </div>
              ) : !historial ? (
                <div style={{ textAlign: 'center', padding: '20px', color: '#94a3b8', fontSize: '13px', fontStyle: 'italic' }}>
                  No se pudo cargar el historial.
                </div>
              ) : historial.partes.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '20px', color: '#94a3b8', fontSize: '13px', fontStyle: 'italic' }}>
                  Esta máquina aún no tiene partes diarios registrados.
                </div>
              ) : (
                <div style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                    <thead>
                      <tr style={{ background: '#f1f5f9', borderBottom: '2px solid #e2e8f0' }}>
                        <th style={{ textAlign: 'left', padding: '10px 14px', fontSize: '11px', color: '#475569' }}>N° PARTE</th>
                        <th style={{ textAlign: 'left', padding: '10px 8px', fontSize: '11px', color: '#475569' }}>FECHA</th>
                        <th style={{ textAlign: 'left', padding: '10px 8px', fontSize: '11px', color: '#475569' }}>ESTADO</th>
                        <th style={{ textAlign: 'left', padding: '10px 8px', fontSize: '11px', color: '#475569' }}>ACTIVIDAD</th>
                        <th style={{ textAlign: 'right', padding: '10px 8px', fontSize: '11px', color: '#475569' }}>HORAS</th>
                        <th style={{ textAlign: 'right', padding: '10px 8px', fontSize: '11px', color: '#475569' }}>COMBUST.</th>
                        <th style={{ textAlign: 'right', padding: '10px 8px', fontSize: '11px', color: '#475569' }}>TOTAL</th>
                        <th style={{ textAlign: 'right', padding: '10px 14px', fontSize: '11px', color: '#475569' }}>PDF</th>
                      </tr>
                    </thead>
                    <tbody>
                      {historial.partes.map(p => (
                        <tr key={p.id} style={{ borderBottom: '1px solid #f1f5f9', background: p.cerrado ? '#fff' : '#fffbeb' }}>
                          <td style={{ padding: '11px 14px', fontWeight: 700, color: '#1e293b' }}>{p.part_number}</td>
                          <td style={{ padding: '11px 8px', color: '#475569', whiteSpace: 'nowrap' }}>{p.date ? p.date.split('T')[0].split('-').reverse().join('/') : '—'}</td>
                          <td style={{ padding: '11px 8px' }}>
                            <span style={{ fontSize: '10px', fontWeight: 700, padding: '3px 9px', borderRadius: '4px', background: p.cerrado ? '#dcfce7' : '#fef3c7', color: p.cerrado ? '#15803d' : '#b45309', whiteSpace: 'nowrap' }}>
                              {p.cerrado ? 'CERRADO' : 'ABIERTO'}
                            </span>
                          </td>
                          <td style={{ padding: '11px 8px', color: '#475569', maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={p.activities || ''}>{p.activities || '—'}</td>
                          <td style={{ padding: '11px 8px', textAlign: 'right', fontWeight: 600, color: '#334155', whiteSpace: 'nowrap' }}>{fmtNum(p.horas)} HE</td>
                          <td style={{ padding: '11px 8px', textAlign: 'right', color: '#334155', whiteSpace: 'nowrap' }}>{fmtNum(p.fuel_gallons || 0)} Gls</td>
                          <td style={{ padding: '11px 8px', textAlign: 'right', fontWeight: 700, color: '#1463A5', whiteSpace: 'nowrap' }}>S/ {fmtNum(p.costo)}</td>
                          <td style={{ padding: '11px 14px', textAlign: 'right' }}>
                            <button onClick={() => abrirPdfParte(p.id, p.part_number)} title="Ver PDF"
                              style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', background: '#e0f2fe', color: '#0284c7', border: 'none', borderRadius: '5px', padding: '5px 10px', fontSize: '11px', fontWeight: 600, cursor: 'pointer' }}>
                              <FaFilePdf size={11} /> PDF
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr style={{ background: '#f8fafc', borderTop: '2px solid #e2e8f0' }}>
                        <td colSpan="4" style={{ padding: '13px 14px', fontWeight: 700, color: '#334155' }}>TOTAL · {historial.total_partes} parte{historial.total_partes !== 1 ? 's' : ''}</td>
                        <td style={{ padding: '13px 8px', textAlign: 'right', fontWeight: 700, color: '#334155', whiteSpace: 'nowrap' }}>{fmtNum(historial.total_horas)} HE</td>
                        <td style={{ padding: '13px 8px', textAlign: 'right', fontWeight: 700, color: '#334155', whiteSpace: 'nowrap' }}>{fmtNum(historial.partes.reduce((s, p) => s + (parseFloat(p.fuel_gallons) || 0), 0))} Gls</td>
                        <td style={{ padding: '13px 8px', textAlign: 'right', fontWeight: 800, fontSize: '15px', color: '#1463A5', whiteSpace: 'nowrap' }}>S/ {fmtNum(historial.total_costo)}</td>
                        <td style={{ padding: '13px 14px' }}></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Modal visor de PDF ─────────────────────────────────────────── */}
      {pdfModal && (
        <div onClick={() => setPdfModal(null)} style={{ ...overlayStyle, zIndex: 10000, alignItems: 'flex-start', padding: '2vh 16px' }}>
          <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: '900px', height: '92vh', display: 'flex', flexDirection: 'column', background: '#fff', borderRadius: '10px', overflow: 'hidden' }}>
            <div style={modalHeadStyle}>
              <h5 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px', fontSize: '16px', color: '#1e293b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                <FaFilePdf color="#dc2626" /> {pdfModal.nombre}
              </h5>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexShrink: 0 }}>
                <a href={pdfModal.url} target="_blank" rel="noreferrer" style={{ display: 'flex', alignItems: 'center', gap: '5px', background: '#206bc4', color: '#fff', textDecoration: 'none', borderRadius: '6px', padding: '6px 12px', fontSize: '13px', fontWeight: 600 }}>
                  <FaDownload size={13} /> Abrir aparte
                </a>
                <button onClick={() => setPdfModal(null)} style={xBtnStyle}><FaTimes /></button>
              </div>
            </div>
            <div style={{ flex: 1, backgroundColor: '#525659' }}>
              <iframe src={pdfModal.url} style={{ width: '100%', height: '100%', border: 'none' }} title="Visor PDF" />
            </div>
          </div>
        </div>
      )}

      {/* ── Mantenedor de catálogos (Equipos/Marcas/Modelos) ─────────────── */}
      <MantenedorEquipos
        abierto={mantenedorAbierto}
        onClose={() => { setMantenedorAbierto(false); cargar(); }}
      />
    </div>
    </div>
  );
}

// Componente auxiliar para mostrar un campo del detalle.
function Campo({ label, valor, icono }) {
  if (!valor) return null;
  return (
    <div style={{ display: 'flex', padding: '5px 0' }}>
      <div style={{ width: '110px', fontSize: '12px', color: '#94a3b8', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '5px', flexShrink: 0 }}>
        {icono}{label}
      </div>
      <div style={{ fontSize: '13px', color: '#1e293b', flex: 1 }}>{valor}</div>
    </div>
  );
}

const selStyle = { padding: '7px 12px', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '13px', color: '#334155', background: '#fff', cursor: 'pointer' };
const overlayStyle = { position: 'fixed', inset: 0, zIndex: 9999, backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' };
const modalStyle = { background: '#fff', borderRadius: '12px', width: '100%', maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' };
const modalHeadStyle = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid #e2e8f0', backgroundColor: '#f8fafc' };
const xBtnStyle = { background: 'none', border: 'none', cursor: 'pointer', color: '#64748b', fontSize: '18px', display: 'flex' };