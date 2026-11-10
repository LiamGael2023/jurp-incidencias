import { useState, useEffect } from 'react';
import { FaTimes, FaSyncAlt, FaDownload, FaExclamationCircle } from 'react-icons/fa';

/**
 * Un PDF del servidor, dentro de un modal.
 *
 * POR QUÉ SE PIDE CON fetch Y NO SE APUNTA EL IFRAME A LA URL
 * -----------------------------------------------------------
 * La ruta va con cabecera de sesión y un iframe no la lleva: apuntándolo
 * directamente contestaría 401 y el visor saldría en blanco, sin decir por
 * qué. Aquí se pide con fetch, se muestra desde un blob, y si el servidor
 * contesta mal se enseña su mensaje —que es el del generador— en vez de un
 * marco vacío.
 *
 * El blob se suelta al cerrar. Cada apertura crea uno y el navegador los
 * retiene mientras exista la pestaña; en una sesión de trabajo con treinta
 * formatos eso es memoria que no vuelve.
 *
 * Uso:
 *   {visor && (
 *     <VisorPDF url={...} titulo="Formato B-1.A" nombre="B-1.A.pdf"
 *       onCerrar={() => setVisor(null)} />
 *   )}
 */
export default function VisorPDF({ url, titulo, subtitulo, nombre, onCerrar }) {
  const [blob, setBlob] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let vivo = true;
    let creada = null;
    setBlob(null);
    setError(null);
    (async () => {
      try {
        const r = await fetch(url);
        if (!r.ok) {
          const d = await r.json().catch(() => ({}));
          throw new Error(d.detail || `El servidor respondió ${r.status}`);
        }
        creada = URL.createObjectURL(await r.blob());
        if (vivo) setBlob(creada); else URL.revokeObjectURL(creada);
      } catch (e) {
        if (vivo) setError(e.message || 'No se pudo armar el documento');
      }
    })();
    return () => { vivo = false; if (creada) URL.revokeObjectURL(creada); };
  }, [url]);

  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onCerrar(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onCerrar]);

  return (
    <div onClick={onCerrar}
      style={{
        position: 'fixed', inset: 0, zIndex: 1300,
        background: 'rgba(15,23,42,.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20,
      }}>
      <div onClick={e => e.stopPropagation()}
        style={{
          width: 'min(1000px, 96vw)', height: 'min(90vh, 1000px)',
          background: '#fff', borderRadius: 12, overflow: 'hidden',
          display: 'flex', flexDirection: 'column',
          boxShadow: '0 20px 60px rgba(0,0,0,.35)',
        }}>

        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '13px 16px', borderBottom: '1px solid #e2e8f0',
          background: '#f8fafc',
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#1e293b',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {titulo}
            </div>
            {subtitulo && (
              <div style={{ fontSize: 11.5, color: '#7b93ad', marginTop: 2 }}>
                {subtitulo}
              </div>
            )}
          </div>

          {blob && (
            <a href={blob} download={nombre}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 7,
                padding: '7px 14px', background: '#0CA678', color: '#fff',
                borderRadius: 7, fontSize: 12.5, fontWeight: 700,
                textDecoration: 'none',
              }}>
              <FaDownload size={11} /> Descargar
            </a>
          )}

          <button onClick={onCerrar} title="Cerrar (Esc)"
            style={{
              width: 30, height: 30, display: 'grid', placeItems: 'center',
              background: '#fff', border: '1px solid #e2e8f0',
              borderRadius: 7, color: '#64748b', cursor: 'pointer',
            }}>
            <FaTimes size={13} />
          </button>
        </div>

        <div style={{ flex: 1, minHeight: 0, display: 'flex',
          background: '#525659' }}>
          {error ? (
            <div style={{
              margin: 'auto', maxWidth: 560, padding: 24, color: '#fff',
              fontSize: 13, lineHeight: 1.5, textAlign: 'center',
            }}>
              <FaExclamationCircle size={22} style={{ color: '#ffa8a8' }} />
              <div style={{ marginTop: 10 }}>{error}</div>
            </div>
          ) : blob ? (
            <iframe src={blob} title={titulo}
              style={{ flex: 1, width: '100%', border: 'none' }} />
          ) : (
            <div style={{ margin: 'auto', color: '#cbd5e1', fontSize: 13,
              display: 'flex', alignItems: 'center', gap: 9 }}>
              <FaSyncAlt className="icon-spin" /> Armando el documento…
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
