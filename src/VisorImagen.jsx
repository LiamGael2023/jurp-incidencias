// ═══════════════════════════════════════════════════════════════════════════
//  Ver una imagen a tamaño grande
// ═══════════════════════════════════════════════════════════════════════════
//
// La usan dos sitios: las imágenes de referencia de metrado, dentro del parte
// diario, y las fotos de la bitácora de atenciones. Son la misma ventana, así
// que es un componente y no dos copias.
//
// `foto` es `{ src, titulo }` o null. Null = cerrada: así quien la usa guarda
// una sola cosa en su estado en vez de un booleano y una imagen que se pueden
// desincronizar.

import { createPortal } from 'react-dom';
import { FaTimes } from 'react-icons/fa';

export default function VisorImagen({ foto, onCerrar }) {
  if (!foto) return null;
  return createPortal(
    <div onClick={onCerrar}
      style={{ position:'fixed', inset:0, zIndex:10003, background:'rgba(0,0,0,0.8)',
        display:'flex', alignItems:'center', justifyContent:'center', padding:'20px' }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background:'#fff', borderRadius:'10px', overflow:'hidden',
          maxWidth:'1000px', width:'100%', maxHeight:'90vh', display:'flex',
          flexDirection:'column' }}>
        <div style={{ display:'flex', alignItems:'center',
          justifyContent:'space-between', padding:'14px 18px', background:'#f8fafc',
          borderBottom:'1px solid #e2e8f0' }}>
          <h5 style={{ margin:0, fontSize:'15px', color:'#1e293b' }}>{foto.titulo}</h5>
          <button onClick={onCerrar}
            style={{ background:'none', border:'none', cursor:'pointer',
              color:'#64748b', fontSize:'18px', display:'flex' }}><FaTimes /></button>
        </div>
        <div style={{ padding:'16px', overflow:'auto', textAlign:'center' }}>
          <img src={foto.src} alt={foto.titulo} style={{ maxWidth:'100%', height:'auto' }} />
        </div>
      </div>
    </div>, document.body);
}
