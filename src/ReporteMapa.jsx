// ═══════════════════════════════════════════════════════════════════════════
//  ModalReporteMapa — el diálogo para enviar el mapa con una nota
// ═══════════════════════════════════════════════════════════════════════════
//
// La composición de la imagen y los tres caminos de envío viven en
// reporteMapa.js, que no exporta componentes y por tanto lo puede importar
// cualquier mapa (Monitoreo e Inventario) sin arrastrar este diálogo.

import { useState, useCallback, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  FaWhatsapp, FaBell, FaDownload, FaTimes, FaSpinner, FaExclamationTriangle,
  FaCheckCircle, FaCopy,
} from 'react-icons/fa';
import {
  componerReporte, enviarPorWhatsApp, descargarBlob, notificarApp, aBlob,
  normalizarTelefono,
} from './reporteMapa';

const Portal = ({ children }) => createPortal(children, document.body);

export function ModalReporteMapa({ abierto, onCerrar, generar, contexto, api, autor }) {
  const [paso, setPaso] = useState('generando');   // generando | listo | error
  const [error, setError] = useState('');
  const [nota, setNota] = useState('');
  const [telefono, setTelefono] = useState(
    () => localStorage.getItem('jurp_wa_destino') || '');
  const [vista, setVista] = useState(null);        // dataURL de la previsualización
  const [peso, setPeso] = useState(0);            // bytes del JPEG que se enviará
  const [enviando, setEnviando] = useState('');
  const [aviso, setAviso] = useState(null);        // { tipo, texto }
  const mapaRef = useRef(null);                    // canvas del mapa, sin estampar

  // El mapa se captura UNA vez al abrir. Volver a capturarlo con cada letra
  // que se escribe en la nota tardaría más que escribirla.
  useEffect(() => {
    if (!abierto) return;
    let vivo = true;
    setPaso('generando'); setError(''); setAviso(null); setVista(null);
    (async () => {
      try {
        const cv = await generar();
        if (!vivo) return;
        mapaRef.current = cv;
        setPaso('listo');
      } catch (e) {
        if (!vivo) return;
        setError(e?.message || String(e));
        setPaso('error');
      }
    })();
    return () => { vivo = false; };
  }, [abierto, generar]);

  // La previsualización se recompone al cambiar la nota, pero sin repetir la
  // captura: se redibuja sobre el canvas ya tomado.
  useEffect(() => {
    if (paso !== 'listo' || !mapaRef.current) return;
    const id = setTimeout(() => {
      try {
        const cv = componerReporte(mapaRef.current, { ...contexto, nota, autor });
        setVista(cv.toDataURL('image/jpeg', 0.9));
        // El peso se enseña: en campo, con datos móviles, importa.
        aBlob(cv, 'image/jpeg', 0.9).then(b => b && setPeso(b.size));
      } catch (e) { console.error(e); }
    }, 180);
    return () => clearTimeout(id);
  }, [paso, nota, contexto, autor]);

  const blobFinal = useCallback(async (tipo = 'image/jpeg') => {
    const cv = componerReporte(mapaRef.current, { ...contexto, nota, autor });
    return aBlob(cv, tipo, 0.9);
  }, [contexto, nota, autor]);

  const textoMensaje = useCallback(() => {
    const cab = `*${contexto?.titulo || 'Monitoreo GIS JURP'}*`;
    const nivel = contexto?.nivel?.texto ? `\nNivel: ${contexto.nivel.texto}` : '';
    const cuerpo = nota.trim() ? `\n\n${nota.trim()}` : '';
    const fecha = `\n\n${new Date().toLocaleString('es-PE')}`;
    return cab + nivel + cuerpo + fecha;
  }, [contexto, nota]);

  const irWhatsApp = async () => {
    setEnviando('wa'); setAviso(null);
    try {
      if (telefono.trim()) localStorage.setItem('jurp_wa_destino', telefono.trim());
      const blob = await blobFinal();
      const r = await enviarPorWhatsApp(blob, textoMensaje(), telefono.trim());
      if (r.via === 'nativo') setAviso({ tipo: 'ok', texto: 'Compartido.' });
      else if (r.via === 'cancelado') setAviso(null);
      else if (r.via === 'web') setAviso({ tipo: 'ok', texto:
        (r.conTexto
          ? 'WhatsApp Web se abrió en el chat, con el texto puesto. '
          : 'WhatsApp Web se abrió: elige el chat. ')
        + 'La imagen está copiada: pégala con Ctrl+V antes de enviar.' });
      else setAviso({ tipo: 'aviso', texto:
        'WhatsApp Web se abrió, pero tu navegador no dejó copiar la imagen, '
        + 'así que se descargó. Adjúntala a mano en el chat.' });
    } catch (e) {
      setAviso({ tipo: 'error', texto: e?.message || String(e) });
    } finally { setEnviando(''); }
  };

  const irApp = async () => {
    setEnviando('app'); setAviso(null);
    try {
      const blob = await blobFinal();
      await notificarApp(blob, {
        api,
        titulo: contexto?.nivel?.texto
          ? `Monitoreo · ${contexto.nivel.texto}` : 'Aviso del monitoreo',
        cuerpo: nota.trim() || 'Nueva captura del monitoreo GIS',
        token: localStorage.getItem('userToken'),
      });
      setAviso({ tipo: 'ok', texto: 'Notificación enviada a la app.' });
    } catch (e) {
      if (e?.codigo === 'SIN_ENDPOINT') {
        setAviso({ tipo: 'error', texto:
          'El backend todavía no tiene el endpoint de notificaciones '
          + '(/notificaciones/mapa/). La imagen NO se envió. Mientras tanto '
          + 'puedes mandarla por WhatsApp o descargarla.' });
      } else {
        setAviso({ tipo: 'error', texto: e?.message || String(e) });
      }
    } finally { setEnviando(''); }
  };

  const irDescarga = async () => {
    setEnviando('dl');
    try { descargarBlob(await blobFinal()); }
    finally { setEnviando(''); }
  };

  const copiarImagen = async () => {
    setEnviando('cp'); setAviso(null);
    try {
      const blob = await blobFinal('image/png');   // ClipboardItem solo traga PNG
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      setAviso({ tipo: 'ok', texto: 'Imagen copiada. Pégala donde quieras con Ctrl+V.' });
    } catch {
      setAviso({ tipo: 'error', texto: 'Tu navegador no permite copiar imágenes.' });
    } finally { setEnviando(''); }
  };

  if (!abierto) return null;
  const ocupado = !!enviando || paso !== 'listo';

  return (
    <Portal>
      <div onClick={onCerrar}
        style={{ position:'fixed', inset:0, zIndex:100000, background:'rgba(2,8,20,.72)',
          display:'flex', alignItems:'center', justifyContent:'center', padding:'16px' }}>
        <div onClick={e => e.stopPropagation()}
          style={{ background:'#fff', borderRadius:'14px', width:'100%', maxWidth:'1000px',
            maxHeight:'94vh', display:'flex', flexDirection:'column', overflow:'hidden',
            fontFamily:'system-ui, -apple-system, Segoe UI, Roboto, sans-serif' }}>

          {/* cabecera */}
          <div style={{ padding:'14px 20px', borderBottom:'1px solid #e2e8f0',
            display:'flex', alignItems:'center', justifyContent:'space-between', gap:'12px' }}>
            <div>
              <div style={{ fontSize:'16px', fontWeight:700, color:'#0b2545' }}>
                Enviar el mapa
              </div>
              <div style={{ fontSize:'12px', color:'#64748b', marginTop:'2px' }}>
                La foto sale con la hora, el nivel de alerta y la leyenda ya puestos.
              </div>
            </div>
            <button onClick={onCerrar} title="Cerrar"
              style={{ background:'transparent', border:'none', cursor:'pointer',
                color:'#64748b', fontSize:'18px', lineHeight:1 }}>
              <FaTimes />
            </button>
          </div>

          {/* cuerpo */}
          <div style={{ flex:1, overflowY:'auto', padding:'16px 20px', background:'#f8fafc' }}>
            {paso === 'generando' && (
              <div style={{ padding:'60px', textAlign:'center', color:'#64748b', fontSize:'14px' }}>
                <FaSpinner className="icon-spin" style={{ marginRight:'8px' }} />
                Fotografiando el mapa…
              </div>
            )}

            {paso === 'error' && (
              <div style={{ background:'#fef2f2', border:'1px solid #fecaca', borderRadius:'9px',
                padding:'14px', color:'#b91c1c', fontSize:'13px', lineHeight:1.6,
                display:'flex', gap:'9px' }}>
                <FaExclamationTriangle style={{ marginTop:'2px', flexShrink:0 }} />
                <span>
                  {/^SecurityError|taint/i.test(error)
                    ? 'La capa base no permite copiarse. Cambia de capa en el selector '
                      + 'de arriba y vuelve a intentarlo.'
                    : error}
                </span>
              </div>
            )}

            {paso === 'listo' && (
              <>
                {/* El previo se acota en alto a propósito. A tamaño completo
                    empuja la nota fuera de la pantalla, y la nota es lo que
                    el operario viene a escribir: lo primero que se ve tiene
                    que ser lo que hay que rellenar, no la foto. */}
                <div style={{ border:'1px solid #e2e8f0', borderRadius:'10px',
                  overflow:'hidden', background:'#f1f5f9', marginBottom:'14px',
                  display:'flex', alignItems:'center', justifyContent:'center' }}>
                  {vista
                    ? <img src={vista} alt="Vista previa del envío"
                        style={{ maxWidth:'100%', maxHeight:'38vh', width:'auto',
                          height:'auto', display:'block', objectFit:'contain' }} />
                    : <div style={{ padding:'40px', textAlign:'center', color:'#94a3b8',
                        fontSize:'13px' }}>Componiendo…</div>}
                </div>

                <label style={{ display:'block', fontSize:'12px', fontWeight:700,
                  color:'#475569', marginBottom:'5px' }}>
                  NOTA
                </label>
                <textarea value={nota} onChange={e => setNota(e.target.value)} rows={3}
                  maxLength={600}
                  placeholder="Qué está pasando y qué hay que hacer. Va impreso en la imagen y en el mensaje."
                  style={{ width:'100%', padding:'10px 12px', border:'1px solid #cbd5e1',
                    borderRadius:'8px', fontSize:'13.5px', fontFamily:'inherit',
                    resize:'vertical', lineHeight:1.5, boxSizing:'border-box' }} />
                <div style={{ display:'flex', justifyContent:'space-between',
                  fontSize:'11px', color:'#94a3b8', marginTop:'3px' }}>
                  <span>{peso ? `La imagen pesa ${(peso / 1024 / 1024).toFixed(2)} MB` : ''}</span>
                  <span>{nota.length}/600</span>
                </div>

                <label style={{ display:'block', fontSize:'12px', fontWeight:700,
                  color:'#475569', margin:'10px 0 5px' }}>
                  WHATSAPP DE DESTINO <span style={{ fontWeight:400, color:'#94a3b8' }}>
                    — opcional, con código de país</span>
                </label>
                <input value={telefono} onChange={e => setTelefono(e.target.value)}
                  placeholder="51987654321"
                  style={{ width:'100%', maxWidth:'260px', padding:'9px 12px',
                    border:'1px solid #cbd5e1', borderRadius:'8px', fontSize:'13.5px',
                    fontFamily:'inherit', boxSizing:'border-box' }} />
                {(() => {
                  // El número corregido se ENSEÑA. Arreglar en silencio un
                  // teléfono es de las cosas que luego nadie entiende: si el
                  // mensaje no llega, nadie sabe a qué número se mandó.
                  const n = normalizarTelefono(telefono);
                  if (n.cambiado) return (
                    <div style={{ fontSize:'11px', color:'#1463A5', marginTop:'4px' }}>
                      Se enviará a <b>+{n.numero}</b> — le agregué el 51 de Perú.
                    </div>
                  );
                  return (
                    <div style={{ fontSize:'11px', color:'#94a3b8', marginTop:'4px' }}>
                      {n.numero
                        ? <>Se enviará a <b>+{n.numero}</b>.</>
                        : 'Si lo dejas vacío, WhatsApp Web se abre y tú eliges el chat.'}
                    </div>
                  );
                })()}
              </>
            )}

            {aviso && (
              <div style={{ marginTop:'14px', borderRadius:'9px', padding:'11px 13px',
                fontSize:'12.5px', lineHeight:1.6, display:'flex', gap:'9px',
                alignItems:'flex-start',
                background: aviso.tipo === 'ok' ? '#f0fdf4'
                  : aviso.tipo === 'error' ? '#fef2f2' : '#fffbeb',
                border: '1px solid ' + (aviso.tipo === 'ok' ? '#bbf7d0'
                  : aviso.tipo === 'error' ? '#fecaca' : '#fde68a'),
                color: aviso.tipo === 'ok' ? '#15803d'
                  : aviso.tipo === 'error' ? '#b91c1c' : '#92400e' }}>
                {aviso.tipo === 'ok'
                  ? <FaCheckCircle style={{ marginTop:'2px', flexShrink:0 }} />
                  : <FaExclamationTriangle style={{ marginTop:'2px', flexShrink:0 }} />}
                <span>{aviso.texto}</span>
              </div>
            )}
          </div>

          {/* pie */}
          <div style={{ padding:'12px 20px', borderTop:'1px solid #e2e8f0', background:'#fff',
            display:'flex', gap:'9px', flexWrap:'wrap', justifyContent:'flex-end' }}>
            <button onClick={irDescarga} disabled={ocupado}
              style={btnSec}>
              {enviando === 'dl' ? <FaSpinner className="icon-spin" /> : <FaDownload />} Descargar
            </button>
            <button onClick={copiarImagen} disabled={ocupado} style={btnSec}>
              {enviando === 'cp' ? <FaSpinner className="icon-spin" /> : <FaCopy />} Copiar
            </button>
            <button onClick={irApp} disabled={ocupado}
              style={{ ...btnSec, color:'#1463A5', borderColor:'#bfdbfe' }}>
              {enviando === 'app' ? <FaSpinner className="icon-spin" /> : <FaBell />} Notificar a la app
            </button>
            <button onClick={irWhatsApp} disabled={ocupado}
              style={{ ...btnPri, background:'#25D366' }}>
              {enviando === 'wa' ? <FaSpinner className="icon-spin" /> : <FaWhatsapp size={16} />} WhatsApp
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
}

const btnBase = {
  display:'inline-flex', alignItems:'center', gap:'7px', borderRadius:'8px',
  padding:'9px 14px', fontSize:'13px', fontWeight:600, cursor:'pointer',
  fontFamily:'inherit',
};
const btnSec = { ...btnBase, background:'#fff', color:'#475569', border:'1px solid #cbd5e1' };
const btnPri = { ...btnBase, color:'#fff', border:'none' };
