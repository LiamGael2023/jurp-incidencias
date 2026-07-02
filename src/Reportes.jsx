// ═══════════════════════════════════════════════════════════════════════════
//  Reportes.jsx
//  Réplica en React de la API de reportes de la app Flutter.
//  Backend: http://sistema.jriegopresurizado.org.pe/api/v1/mobile/hi-report-files
//    GET  /list/     → lista de reportes { results: [{id, name, created_at}] }
//    POST /          → subir { name, type:"pdf", content:<base64> }
//    GET  /{id}/     → detalle con { content:<base64> } para descargar
//  Auth: header Authorization: Token <token>
//  Subida permitida solo al grupo "mobile_gerencia".
// ═══════════════════════════════════════════════════════════════════════════
import { useState, useEffect, useRef, useCallback } from 'react';
import Swal from 'sweetalert2';
import { FaFilePdf, FaUpload, FaEye, FaSyncAlt, FaFolderOpen, FaSpinner, FaTimes, FaDownload } from 'react-icons/fa';

// Ruta relativa: el proxy /api la redirige al backend de incidentes.
const BASE_URL = '/api/v1/mobile/hi-report-files';
const MAX_MB = 15;

export default function Reportes() {
  const [reportes, setReportes] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [subiendo, setSubiendo] = useState(false);
  const [puedeSubir, setPuedeSubir] = useState(false);
  const [pdfModal, setPdfModal] = useState(null);   // { url, nombre } o null
  const fileInputRef = useRef(null);

  const authHeaders = () => {
    const t = localStorage.getItem('userToken');
    return { 'Content-Type': 'application/json', ...(t ? { 'Authorization': `Token ${t}` } : {}) };
  };

  // Solo el grupo mobile_gerencia puede subir. Los grupos se guardan al hacer login.
  useEffect(() => {
    try {
      const grupos = JSON.parse(localStorage.getItem('userGroups') || '[]');
      setPuedeSubir(Array.isArray(grupos) && grupos.includes('mobile_gerencia'));
    } catch { setPuedeSubir(false); }
  }, []);

  const cargarReportes = useCallback(async () => {
    try {
      const r = await fetch(`${BASE_URL}/list/`, { headers: authHeaders() });
      if (r.ok) {
        const data = await r.json();
        const lista = data.results || [];
        lista.sort((a, b) => b.id - a.id);   // más recientes primero
        setReportes(lista);
      } else {
        Swal.fire('Error', `No se pudieron cargar los reportes (código: ${r.status}).`, 'error');
      }
    } catch (e) {
      Swal.fire('Error', 'Error de red al cargar reportes.', 'error');
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => { cargarReportes(); }, [cargarReportes]);

  // Convierte un File a base64 (sin el prefijo data:...).
  const fileABase64 = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  const alSeleccionarArchivo = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';   // permite volver a elegir el mismo archivo
    if (!file) return;
    if (file.type !== 'application/pdf') {
      Swal.fire('Archivo inválido', 'Solo se permiten archivos PDF.', 'warning');
      return;
    }
    if (file.size > MAX_MB * 1024 * 1024) {
      Swal.fire('Muy grande', `El archivo supera los ${MAX_MB} MB.`, 'warning');
      return;
    }

    // Pedir nombre del reporte.
    const { value: nombre } = await Swal.fire({
      title: 'Nombrar documento',
      input: 'text',
      inputLabel: 'Ingresa un título descriptivo para este reporte',
      inputPlaceholder: 'Ej. Informe Mensual Moche',
      showCancelButton: true,
      confirmButtonText: 'Subir',
      confirmButtonColor: '#206bc4',
      inputValidator: (v) => !v?.trim() && 'El nombre es obligatorio',
    });
    if (!nombre) return;

    setSubiendo(true);
    try {
      const base64 = await fileABase64(file);
      const r = await fetch(`${BASE_URL}/`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ name: nombre.trim(), type: 'pdf', content: base64 }),
      });
      if (r.ok) {
        Swal.fire({ icon: 'success', title: 'Cargado', text: 'El reporte se subió correctamente.', timer: 1600, showConfirmButton: false });
        await cargarReportes();
      } else {
        Swal.fire('Error', `No se pudo subir (código: ${r.status}).`, 'error');
      }
    } catch (e) {
      Swal.fire('Error', 'Error de conexión al subir.', 'error');
    } finally {
      setSubiendo(false);
    }
  };

  // Descarga el detalle (base64), reconstruye el PDF y lo muestra en un modal.
  const abrirPdf = async (id, name) => {
    Swal.fire({ title: 'Descargando…', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
    try {
      const r = await fetch(`${BASE_URL}/${id}/`, { headers: authHeaders() });
      if (!r.ok) { Swal.close(); Swal.fire('Error', `No se pudo descargar (código: ${r.status}).`, 'error'); return; }
      const data = await r.json();
      // Django puede devolverlo en data.content o data.data.content.
      const base64 = data?.data?.content ?? data?.content ?? '';
      Swal.close();
      if (!base64) { Swal.fire('Vacío', 'El documento no tiene contenido en el servidor.', 'warning'); return; }

      // base64 → Blob → URL para el iframe del modal.
      const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      setPdfModal({ url, nombre: name || `Reporte #${id}` });
    } catch (e) {
      Swal.close();
      Swal.fire('Error', 'Tiempo de espera agotado o error de red.', 'error');
    }
  };

  // Cierra el modal y libera la URL del blob.
  const cerrarPdfModal = () => {
    if (pdfModal?.url) URL.revokeObjectURL(pdfModal.url);
    setPdfModal(null);
  };

  const formatoFecha = (iso) => {
    if (!iso) return 'Fecha desconocida';
    try {
      const d = new Date(iso);
      const p = (n) => String(n).padStart(2, '0');
      return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} - ${p(d.getHours())}:${p(d.getMinutes())}`;
    } catch { return 'Formato inválido'; }
  };

  return (
    <div style={{ padding: '24px', maxWidth: '900px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <div style={{ fontSize: '12px', color: '#94a3b8', fontWeight: 600, letterSpacing: '0.5px' }}>GESTIÓN DE CAMPO</div>
          <h2 style={{ margin: 0, fontSize: '24px', color: '#1e293b' }}>Reportes y Documentos</h2>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={cargarReportes} style={btnSecundario} title="Actualizar">
            <FaSyncAlt /> Actualizar
          </button>
          {puedeSubir && (
            <button onClick={() => fileInputRef.current?.click()} disabled={subiendo} style={btnPrimario} title="Subir un PDF">
              {subiendo ? <><FaSpinner className="icon-spin" /> Procesando…</> : <><FaUpload /> Subir PDF</>}
            </button>
          )}
        </div>
      </div>

      <input ref={fileInputRef} type="file" accept="application/pdf" onChange={alSeleccionarArchivo} style={{ display: 'none' }} />

      {cargando ? (
        <div style={{ textAlign: 'center', padding: '60px', color: '#64748b' }}>
          <FaSpinner className="icon-spin" size={28} /><div style={{ marginTop: '12px' }}>Cargando reportes…</div>
        </div>
      ) : reportes.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: '#94a3b8' }}>
          <FaFolderOpen size={64} style={{ opacity: 0.4 }} />
          <div style={{ marginTop: '16px', fontSize: '16px', fontWeight: 'bold' }}>No hay reportes disponibles.</div>
          {puedeSubir && <div style={{ marginTop: '6px', fontSize: '13px' }}>Presiona "Subir PDF" para agregar uno.</div>}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {reportes.map((rep) => (
            <div key={rep.id} style={tarjeta}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '14px', minWidth: 0 }}>
                <div style={{ background: '#fee2e2', borderRadius: '10px', padding: '12px', display: 'flex' }}>
                  <FaFilePdf color="#dc2626" size={26} />
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 'bold', fontSize: '15px', color: '#1e293b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {rep.name || `Reporte Técnico #${rep.id}`}
                  </div>
                  <div style={{ color: '#64748b', fontSize: '12px', marginTop: '3px' }}>
                    Subido el: {formatoFecha(rep.created_at)}
                  </div>
                </div>
              </div>
              <button onClick={() => abrirPdf(rep.id, rep.name)} style={btnVer} title="Ver / descargar PDF">
                <FaEye size={16} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* ── Modal visor de PDF (igual que el parte diario) ─────────────── */}
      {pdfModal && (
        <div onClick={cerrarPdfModal} style={{ position: 'fixed', inset: 0, zIndex: 9999, backgroundColor: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '2vh 16px' }}>
          <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: '900px', height: '92vh', display: 'flex', flexDirection: 'column', background: '#fff', borderRadius: '10px', overflow: 'hidden', boxShadow: '0 0 20px rgba(0,0,0,0.5)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #e2e8f0', padding: '14px 18px', backgroundColor: '#f8fafc' }}>
              <h5 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px', fontSize: '16px', color: '#1e293b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                <FaFilePdf color="#dc2626" /> {pdfModal.nombre}
              </h5>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexShrink: 0 }}>
                <a href={pdfModal.url} download={`${pdfModal.nombre}.pdf`} style={{ display: 'flex', alignItems: 'center', gap: '5px', background: '#206bc4', color: '#fff', textDecoration: 'none', borderRadius: '6px', padding: '6px 12px', fontSize: '13px', fontWeight: 600 }} title="Descargar">
                  <FaDownload size={13} /> Descargar
                </a>
                <button onClick={cerrarPdfModal} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b', fontSize: '18px', display: 'flex' }} title="Cerrar"><FaTimes /></button>
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

// ── Estilos ────────────────────────────────────────────────────────────────
const btnPrimario = { display: 'flex', alignItems: 'center', gap: '6px', background: '#206bc4', color: '#fff', border: 'none', borderRadius: '6px', padding: '8px 14px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' };
const btnSecundario = { display: 'flex', alignItems: 'center', gap: '6px', background: '#fff', color: '#475569', border: '1px solid #cbd5e1', borderRadius: '6px', padding: '8px 14px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' };
const tarjeta = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#fff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '14px 16px', gap: '12px' };
const btnVer = { background: 'rgba(32,107,196,0.1)', border: 'none', borderRadius: '50%', width: '40px', height: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#206bc4', cursor: 'pointer', flexShrink: 0 };