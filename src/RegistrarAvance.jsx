import { useState, useRef } from 'react';
import {
  FaCamera, FaTimes, FaSpinner, FaCheckCircle, FaExclamationCircle,
  FaMapMarkerAlt, FaPlus, FaCalendarAlt,
} from 'react-icons/fa';

/**
 * REGISTRAR UN AVANCE EN LA BITÁCORA, DESDE LA WEB.
 *
 * La bitácora se alimentaba solo desde la app de campo. Eso está bien
 * mientras la app funciona: el que ve la obra es el que la cuenta. Pero
 * deja a la oficina sin forma de anotar nada —una coordinación por
 * teléfono, lo que informó una empresa, una corrección— y, el día que la
 * app falla, deja el seguimiento del incidente congelado sin alternativa.
 *
 * Usa el MISMO endpoint que la app (`/api/v1/mobile/hi-incident-actions/`)
 * y el mismo token que esta pantalla ya emplea para leerla. Nada nuevo en
 * el servidor: lo que entra por aquí es indistinguible de lo que entra por
 * el teléfono, que es lo que se quiere —una bitácora con dos orígenes
 * distintos deja de ser una bitácora—.
 *
 * LAS FOTOS SE ENCOGEN ANTES DE SUBIRLAS. Una foto de móvil son 3-5 MB, y
 * viajan en base64 dentro del JSON, que añade un tercio. Tres fotos sin
 * tocar serían quince megas por una anotación. Se reducen a 1280 px de
 * lado mayor y calidad 0,7: suficiente para ver una grieta o un
 * sedimento, que es para lo que se miran.
 *
 * Y SI EL SERVIDOR RECHAZA, SE ENSEÑA LO QUE DIJO, no solo el número.
 * Esta misma función en la app muestra «Error en el servidor: 400» y tira
 * el motivo a la basura; averiguar qué campo fallaba costó una mañana.
 */

const ESTADOS = [
  ['eat', 'En atención'],
  ['pat', 'Por atender'],
  ['ate', 'Atendido'],
];

const LADO_MAX = 1280;
const CALIDAD = 0.7;
const MAX_FOTOS = 6;

/**
 * LA FECHA DEL TRABAJO NO ES LA FECHA DEL REGISTRO.
 *
 * El servidor sella cada avance con el momento en que entra (`created_at`,
 * automático) y no admite otra cosa: el serializer de
 * `hi-incident-actions/` solo acepta incident, description, status,
 * latitude, longitude e images. Así que una anotación del lunes escrita el
 * miércoles quedaría fechada el miércoles.
 *
 * Eso importa aquí más que en la app, porque la oficina registra en
 * diferido por definición: lo que informó una empresa, lo que se coordinó
 * por teléfono, lo que el inspector no pudo subir porque le falló el móvil.
 *
 * Mientras el servidor no guarde una fecha propia, la del trabajo va
 * delante del texto —«DÍA 11/11/2026 — …»—, que es exactamente como ya la
 * escriben los inspectores a mano en la bitácora. Se lee igual y no
 * inventa un campo que el backend no tiene.
 */
function hoyLocal() {
  const d = new Date();
  // `toISOString()` pasa a UTC, y en Perú (UTC-5) eso adelanta un día
  // cada tarde a partir de las 19:00. Se compone a mano.
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function enPalabras(iso) {
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a}`;
}

/**
 * Los errores del servidor, en una línea legible.
 *
 * NO BASTA CON RECORRER LAS CLAVES DE PRIMER NIVEL. Cuando falla algo
 * dentro de una lista —`images`, por ejemplo— DRF contesta una lista de
 * objetos, uno por elemento, y concatenarlos sin más imprime
 * «[object Object]»: exactamente el mismo mensaje inútil que este
 * formulario existe para no dar. Hay que bajar hasta el texto.
 */
function aplanar(v) {
  if (Array.isArray(v)) {
    return v.map(aplanar).filter(Boolean).join(' ');
  }
  if (v && typeof v === 'object') {
    return Object.entries(v)
      .map(([k, x]) => {
        const dentro = aplanar(x);
        // Un objeto vacío es DRF diciendo «este elemento está bien»:
        // enseñarlo solo añade ruido al que lee el aviso.
        return dentro ? `${k}: ${dentro}` : '';
      })
      .filter(Boolean)
      .join(' · ');
  }
  return v === null || v === undefined ? '' : String(v);
}

/** Una imagen reducida y en base64, sin el prefijo `data:`. */
function encoger(archivo) {
  return new Promise((resolve, reject) => {
    const lector = new FileReader();
    lector.onerror = () => reject(new Error(`No pude leer ${archivo.name}`));
    lector.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error(`${archivo.name} no es una imagen`));
      img.onload = () => {
        const escala = Math.min(1, LADO_MAX / Math.max(img.width, img.height));
        const l = document.createElement('canvas');
        l.width = Math.round(img.width * escala);
        l.height = Math.round(img.height * escala);
        const ctx = l.getContext('2d');
        // Fondo blanco: un PNG con transparencia pasado a JPEG deja los
        // huecos en negro, y una foto con medio cielo negro parece un
        // fallo de la cámara.
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, l.width, l.height);
        ctx.drawImage(img, 0, 0, l.width, l.height);
        const url = l.toDataURL('image/jpeg', CALIDAD);
        resolve({
          vista: url,
          // El servidor espera base64 a secas, como lo manda la app.
          contenido: url.split(',')[1],
          nombre: archivo.name,
        });
      };
      img.src = lector.result;
    };
    lector.readAsDataURL(archivo);
  });
}

export default function RegistrarAvance({ incidenteId, onGuardado }) {
  const [abierto, setAbierto] = useState(false);
  const [texto, setTexto] = useState('');
  const [fecha, setFecha] = useState(hoyLocal);
  const [estado, setEstado] = useState('eat');
  const [fotos, setFotos] = useState([]);
  const [conUbicacion, setConUbicacion] = useState(false);
  const [punto, setPunto] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);
  const entrada = useRef(null);

  const anadir = async (e) => {
    const nuevos = Array.from(e.target.files || []);
    e.target.value = '';
    if (!nuevos.length) return;
    setError(null);
    const sitio = MAX_FOTOS - fotos.length;
    if (sitio <= 0) {
      setError(`No se pueden adjuntar más de ${MAX_FOTOS} fotos.`);
      return;
    }
    try {
      const listas = await Promise.all(nuevos.slice(0, sitio).map(encoger));
      setFotos(f => [...f, ...listas]);
      if (nuevos.length > sitio) {
        setError(`Solo caben ${MAX_FOTOS}: se añadieron las ${sitio} primeras.`);
      }
    } catch (err) {
      setError(err.message || 'No pude preparar las fotos');
    }
  };

  const pedirUbicacion = () => {
    if (!navigator.geolocation) {
      setError('Este navegador no da la ubicación.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setPunto({ lat: p.coords.latitude, lng: p.coords.longitude });
        setConUbicacion(true);
      },
      () => setError('No se pudo obtener la ubicación. Revisa el permiso del navegador.'),
      { enableHighAccuracy: true, timeout: 15000 },
    );
  };

  const limpiar = () => {
    setTexto(''); setFotos([]); setPunto(null);
    setConUbicacion(false); setError(null); setEstado('eat');
    setFecha(hoyLocal());
  };

  const guardar = async () => {
    if (!texto.trim()) { setError('Escribe qué se hizo.'); return; }
    if (!fecha) { setError('Indica de qué día es el trabajo.'); return; }
    setGuardando(true);
    setError(null);
    try {
      const cuerpo = {
        incident: Number(incidenteId),
        // La fecha del trabajo delante, porque el servidor solo sabe
        // cuándo se registró. Ver el comentario de `hoyLocal`.
        description: `DÍA ${enPalabras(fecha)} — ${texto.trim()}`,
        status: estado,
      };
      if (conUbicacion && punto) {
        cuerpo.latitude = punto.lat.toFixed(6);
        cuerpo.longitude = punto.lng.toFixed(6);
      }
      if (fotos.length) {
        cuerpo.images = fotos.map(f => ({ content: f.contenido }));
      }

      const token = localStorage.getItem('userToken');
      const r = await fetch('/api/v1/mobile/hi-incident-actions/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Token ${token}`,
        },
        body: JSON.stringify(cuerpo),
      });

      if (!r.ok) {
        // Lo que diga el servidor, tal cual. Un número a secas no le
        // sirve a nadie, y averiguarlo por otro lado cuesta horas.
        const crudo = await r.text();
        let detalle = crudo;
        try {
          detalle = aplanar(JSON.parse(crudo));
        } catch { /* no era JSON: se enseña crudo */ }
        throw new Error(`El servidor respondió ${r.status} — ${detalle.slice(0, 400)}`);
      }

      limpiar();
      setAbierto(false);
      onGuardado?.();
    } catch (e) {
      setError(e.message || 'No se pudo guardar');
    } finally {
      setGuardando(false);
    }
  };

  if (!abierto) {
    return (
      <button type="button" onClick={() => setAbierto(true)}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 7,
          padding: '8px 15px', background: '#1463A5', color: '#fff',
          border: 'none', borderRadius: 7, fontSize: 13, fontWeight: 700,
          cursor: 'pointer',
        }}>
        <FaPlus size={11} /> Registrar avance
      </button>
    );
  }

  const peso = fotos.reduce((s, f) => s + f.contenido.length, 0) / 1048576;

  return (
    <div style={{
      textAlign: 'left', background: '#fff', border: '1px solid #c9dff2',
      borderRadius: 10, padding: 16, marginBottom: 16,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
        <b style={{ fontSize: 14, color: '#1e293b', flex: 1 }}>Nuevo avance</b>
        <button type="button" onClick={() => { limpiar(); setAbierto(false); }}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b' }}>
          <FaTimes />
        </button>
      </div>

      <textarea
        value={texto}
        onChange={(e) => { setTexto(e.target.value); if (error) setError(null); }}
        rows={4}
        placeholder="Qué se hizo, dónde y con qué. Esto queda en la bitácora del incidente."
        style={{
          width: '100%', padding: 10, borderRadius: 8, fontSize: 13.5,
          border: '1px solid #cbd5e1', resize: 'vertical', fontFamily: 'inherit',
        }}
      />

      <div style={{ display: 'flex', gap: 10, marginTop: 10, flexWrap: 'wrap',
        alignItems: 'center' }}>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6,
          fontSize: 12.5, color: '#475569' }}>
          <FaCalendarAlt size={12} />
          <input type="date" value={fecha} max={hoyLocal()}
            onChange={(e) => { setFecha(e.target.value); if (error) setError(null); }}
            style={{ padding: '6px 8px', borderRadius: 7, fontSize: 13,
              border: `1px solid ${fecha && fecha !== hoyLocal() ? '#f0a848' : '#cbd5e1'}`,
              fontFamily: 'inherit', color: '#1e293b' }} />
        </label>

        <select value={estado} onChange={(e) => setEstado(e.target.value)}
          style={{ padding: '7px 10px', borderRadius: 7, fontSize: 13,
            border: '1px solid #cbd5e1' }}>
          {ESTADOS.map(([v, r]) => <option key={v} value={v}>{r}</option>)}
        </select>

        <button type="button" onClick={() => entrada.current?.click()}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '7px 12px', background: '#fff', border: '1px solid #cbd5e1',
            borderRadius: 7, fontSize: 13, cursor: 'pointer', color: '#334155' }}>
          <FaCamera size={12} /> Fotos
        </button>
        <input ref={entrada} type="file" accept="image/*" multiple
          onChange={anadir} style={{ display: 'none' }} />

        <button type="button" onClick={pedirUbicacion}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '7px 12px', borderRadius: 7, fontSize: 13, cursor: 'pointer',
            background: conUbicacion ? '#e3faf0' : '#fff',
            border: `1px solid ${conUbicacion ? '#a7e8cd' : '#cbd5e1'}`,
            color: conUbicacion ? '#0b7a56' : '#334155' }}>
          <FaMapMarkerAlt size={12} />
          {conUbicacion && punto
            ? `${punto.lat.toFixed(4)}, ${punto.lng.toFixed(4)}`
            : 'Añadir ubicación'}
        </button>
      </div>

      {fecha && fecha !== hoyLocal() && (
        <div style={{ marginTop: 10, fontSize: 12, color: '#8a5a12',
          background: '#fff8ec', border: '1px solid #f3dcb4',
          borderRadius: 7, padding: '7px 10px', lineHeight: 1.45 }}>
          Se anotará como trabajo del <b>{enPalabras(fecha)}</b>. En la
          bitácora aparecerá con la hora de hoy, que es cuando se registra;
          la fecha del trabajo va al principio del texto.
        </div>
      )}

      {fotos.length > 0 && (
        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          {fotos.map((f, i) => (
            <div key={i} style={{ position: 'relative' }}>
              <img src={f.vista} alt={f.nombre}
                style={{ width: 64, height: 64, objectFit: 'cover',
                  borderRadius: 7, border: '1px solid #cbd5e1' }} />
              <button type="button"
                onClick={() => setFotos(fs => fs.filter((_, j) => j !== i))}
                style={{ position: 'absolute', top: -6, right: -6, width: 20,
                  height: 20, borderRadius: '50%', border: 'none',
                  background: '#dc2626', color: '#fff', cursor: 'pointer',
                  fontSize: 11, lineHeight: 1 }}>×</button>
            </div>
          ))}
          <span style={{ alignSelf: 'flex-end', fontSize: 11.5, color: '#64748b' }}>
            {fotos.length} · {peso.toFixed(1)} MB
          </span>
        </div>
      )}

      {error && (
        <div style={{ marginTop: 12, padding: 10, borderRadius: 8,
          background: '#fef2f2', border: '1px solid #fecaca',
          color: '#b91c1c', fontSize: 12.5, lineHeight: 1.45,
          wordBreak: 'break-word' }}>
          <FaExclamationCircle style={{ marginRight: 6 }} />{error}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10,
        marginTop: 14 }}>
        <button type="button" onClick={() => { limpiar(); setAbierto(false); }}
          disabled={guardando}
          style={{ padding: '8px 15px', background: '#fff',
            border: '1px solid #cbd5e1', borderRadius: 7, fontSize: 13,
            cursor: 'pointer', color: '#334155' }}>
          Cancelar
        </button>
        <button type="button" onClick={guardar} disabled={guardando}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 7,
            padding: '8px 16px', background: guardando ? '#94a3b8' : '#0CA678',
            color: '#fff', border: 'none', borderRadius: 7, fontSize: 13,
            fontWeight: 700, cursor: guardando ? 'default' : 'pointer' }}>
          {guardando
            ? <><FaSpinner className="icon-spin" size={12} /> Guardando…</>
            : <><FaCheckCircle size={12} /> Guardar en la bitácora</>}
        </button>
      </div>
    </div>
  );
}
