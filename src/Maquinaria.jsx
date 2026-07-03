// ─────────────────────────────────────────────────────────────────────────────
//  Página: Panel de Maquinaria
//  Muestra todas las máquinas del catálogo con su estado (disponible / en
//  incidente). Filtros por origen y estado. Al hacer clic en una máquina
//  ocupada, muestra el detalle del parte diario y permite abrir su PDF en modal.
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useEffect } from 'react';
import Swal from 'sweetalert2';
import {
  FaTruck, FaSyncAlt, FaCheckCircle, FaExclamationTriangle, FaTimes,
  FaDownload, FaFilePdf, FaMapMarkerAlt, FaTools, FaClock,
} from 'react-icons/fa';

const API_OPS = 'https://gideonstudio.duckdns.org/api/v1/mobile/operations';

export default function Maquinaria() {
  const [maquinas, setMaquinas] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [filtroOrigen, setFiltroOrigen] = useState('');   // '' | JURP | EXTERNA
  const [filtroEstado, setFiltroEstado] = useState('');   // '' | 0 | 1
  const [detalle, setDetalle] = useState(null);           // máquina seleccionada
  const [pdfModal, setPdfModal] = useState(null);         // { url, nombre }

  const cargar = async () => {
    setCargando(true);
    try {
      const params = new URLSearchParams();
      if (filtroOrigen) params.append('origen', filtroOrigen);
      if (filtroEstado !== '') params.append('estado', filtroEstado);
      const r = await fetch(`${API_OPS}/maquinaria-estado/?${params.toString()}`);
      if (r.ok) {
        const d = await r.json();
        setMaquinas(d.maquinaria || []);
      }
    } catch (e) { console.error(e); } finally { setCargando(false); }
  };

  useEffect(() => { cargar(); }, [filtroOrigen, filtroEstado]);

  // Abre el PDF del parte en un modal (igual que en Reportes / parte diario).
  const abrirPdfParte = async (parteId, nombre) => {
    const url = `${API_OPS}/daily-part-heavy-equipments/${parteId}/pdf/`;
    setPdfModal({ url, nombre: nombre || `Parte ${parteId}` });
  };

  const disponibles = maquinas.filter(m => m.disponible).length;
  const ocupadas = maquinas.filter(m => !m.disponible).length;

  return (
    <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto' }}>
      {/* Encabezado */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <div style={{ fontSize: '12px', color: '#94a3b8', fontWeight: 600, letterSpacing: '0.5px' }}>GESTIÓN DE FLOTA</div>
          <h2 style={{ margin: '2px 0 0', fontSize: '24px', color: '#1e293b' }}>Panel de Maquinaria</h2>
        </div>
        <button onClick={cargar} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: '#fff', border: '1px solid #cbd5e1', borderRadius: '8px', padding: '8px 16px', cursor: 'pointer', fontSize: '13px', fontWeight: 600, color: '#334155' }}>
          <FaSyncAlt /> Actualizar
        </button>
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
        </select>
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
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '14px' }}>
          {maquinas.map(m => {
            const ocupada = !m.disponible;
            return (
              <div key={m.id}
                onClick={() => ocupada && m.parte_activo && setDetalle(m)}
                style={{
                  background: '#fff', borderRadius: '10px', overflow: 'hidden',
                  border: `1px solid ${ocupada ? '#fecaca' : '#bbf7d0'}`,
                  cursor: (ocupada && m.parte_activo) ? 'pointer' : 'default',
                  transition: 'box-shadow 0.15s',
                }}
                onMouseEnter={e => { if (ocupada && m.parte_activo) e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)'; }}
                onMouseLeave={e => e.currentTarget.style.boxShadow = 'none'}
              >
                {/* Banda de estado */}
                <div style={{ background: ocupada ? '#fef2f2' : '#f0fdf4', padding: '8px 14px', display: 'flex', alignItems: 'center', gap: '6px', borderBottom: `1px solid ${ocupada ? '#fecaca' : '#bbf7d0'}` }}>
                  {ocupada ? <FaExclamationTriangle color="#dc2626" size={13} /> : <FaCheckCircle color="#16a34a" size={13} />}
                  <span style={{ fontSize: '12px', fontWeight: 700, color: ocupada ? '#dc2626' : '#16a34a' }}>
                    {ocupada ? 'EN INCIDENTE' : 'DISPONIBLE'}
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
                    <div style={{ marginTop: '10px', padding: '8px', background: '#fef2f2', borderRadius: '6px', fontSize: '12px' }}>
                      <div style={{ color: '#991b1b', fontWeight: 600 }}>{m.parte_activo.part_number}</div>
                      <div style={{ color: '#7f1d1d', marginTop: '2px' }}><FaMapMarkerAlt size={10} /> {m.parte_activo.incidente_lugar || 'Sin ubicación'}</div>
                      <div style={{ color: '#206bc4', marginTop: '4px', fontWeight: 600, fontSize: '11px' }}>Ver detalle →</div>
                    </div>
                  )}
                  {ocupada && !m.parte_activo && (
                    <div style={{ marginTop: '10px', fontSize: '11px', color: '#94a3b8', fontStyle: 'italic' }}>No disponible (sin parte vinculado)</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Modal de detalle del parte ─────────────────────────────────── */}
      {detalle && detalle.parte_activo && (
        <div onClick={() => setDetalle(null)} style={overlayStyle}>
          <div onClick={e => e.stopPropagation()} style={{ ...modalStyle, maxWidth: '560px' }}>
            <div style={modalHeadStyle}>
              <h5 style={{ margin: 0, fontSize: '16px', color: '#1e293b', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <FaTruck color="#475569" /> {detalle.codigo} · {detalle.modelo || detalle.placa}
              </h5>
              <button onClick={() => setDetalle(null)} style={xBtnStyle}><FaTimes /></button>
            </div>
            <div style={{ padding: '18px', overflowY: 'auto' }}>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: '#fef2f2', color: '#dc2626', padding: '4px 12px', borderRadius: '6px', fontSize: '12px', fontWeight: 700, marginBottom: '14px' }}>
                <FaExclamationTriangle size={12} /> EN INCIDENTE
              </div>

              <Campo label="N° de Parte" valor={detalle.parte_activo.part_number} />
              <Campo label="Incidente" valor={`${detalle.parte_activo.incidente_tipo}${detalle.parte_activo.incidente_codigo ? ` (${detalle.parte_activo.incidente_codigo})` : ''}`} />
              <Campo label="Ubicación" valor={detalle.parte_activo.incidente_lugar} icono={<FaMapMarkerAlt />} />
              <Campo label="Fecha / Turno" valor={`${detalle.parte_activo.date} · ${detalle.parte_activo.shift}`} icono={<FaClock />} />
              <Campo label="Zona de trabajo" valor={detalle.parte_activo.work_zone_text} />
              <Campo label="Operador" valor={detalle.parte_activo.operator} />
              <Campo label="Actividad" valor={detalle.parte_activo.activities} icono={<FaTools />} />
              <Campo label="Horómetro" valor={`${detalle.parte_activo.start_horometer} → ${detalle.parte_activo.end_horometer}`} />

              <button onClick={() => abrirPdfParte(detalle.parte_activo.id, detalle.parte_activo.part_number)}
                style={{ marginTop: '16px', width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', background: '#dc2626', color: '#fff', border: 'none', borderRadius: '8px', padding: '12px', fontSize: '14px', fontWeight: 600, cursor: 'pointer' }}>
                <FaFilePdf /> Ver PDF del parte diario
              </button>
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
    </div>
  );
}

// Componente auxiliar para mostrar un campo del detalle.
function Campo({ label, valor, icono }) {
  if (!valor) return null;
  return (
    <div style={{ display: 'flex', padding: '7px 0', borderBottom: '1px solid #f1f5f9' }}>
      <div style={{ width: '130px', fontSize: '12px', color: '#94a3b8', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '5px', flexShrink: 0 }}>
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
