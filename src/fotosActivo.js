/**
 * Fotos de un activo del inventario: preparar, nombrar y localizar.
 *
 * Lo que no es React vive aquí para poder comprobarlo sin montar el mapa.
 *
 * POR QUÉ SE COMPRIME ANTES DE SUBIR. Las fotos las toma el inspector con el
 * teléfono en campo: cada una son 3-5 MB de un sensor de 12 MP. Tres fotos por
 * estructura y unas mil estructuras son del orden de diez gigas en el
 * servidor, para mirarlas en un recuadro de 90 píxeles y, como mucho,
 * ampliarlas a pantalla. Reducidas al lado mayor de 1600 px quedan en unos
 * 300 KB sin que se pierda nada de lo que se mira en ellas —una grieta, un
 * sedimento, una compuerta torcida—.
 *
 * Y hay una razón menos obvia: la subida va por el proxy de Vercel, que no
 * está pensado para cuerpos grandes. Un archivo de cinco megas tiene bastantes
 * papeletas de morir por el camino con un error que no dice nada, y en campo,
 * con la cobertura que hay en Chao, de cinco megas a trescientos kilobytes va
 * de "no sube" a "sube".
 *
 * NO SE RECOMPRIME LO QUE YA ES PEQUEÑO. Pasar un JPEG de 200 KB por el lienzo
 * otra vez solo añade artefactos: si ya cabe y ya es pequeño, se sube tal cual.
 */
import { MEDIA } from './api.js';

/** Lado mayor al que se reduce. 1600 cubre pantalla completa en un portátil. */
export const MAX_LADO = 1600;
/** Calidad del JPEG resultante. 0.82 es el punto donde deja de notarse. */
export const CALIDAD = 0.82;
/** Por debajo de esto no se toca el archivo. */
export const SIN_TOCAR_BYTES = 400 * 1024;
/** Tope duro de entrada, antes de comprimir. */
export const MAX_ENTRADA_BYTES = 25 * 1024 * 1024;

const TIPOS = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];

/**
 * ¿Se puede subir este archivo?
 * → null si sí, o el motivo por el que no, en texto para enseñar.
 */
export function motivoRechazo(file) {
  if (!file) return 'Archivo vacío';
  const tipo = (file.type || '').toLowerCase();
  // Algunos navegadores no rellenan el tipo; se cae a la extensión.
  const ext = (file.name || '').toLowerCase().split('.').pop();
  const porExt = ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif'].includes(ext);
  if (tipo && !TIPOS.includes(tipo) && !tipo.startsWith('image/')) {
    return `${file.name || 'El archivo'} no es una imagen`;
  }
  if (!tipo && !porExt) return `${file.name || 'El archivo'} no parece una imagen`;
  if (file.size > MAX_ENTRADA_BYTES) {
    return `${file.name} pesa ${(file.size / 1048576).toFixed(1)} MB; el máximo son 25 MB`;
  }
  return null;
}

/** Medidas de destino conservando la proporción. Nunca agranda. */
export function medidaDestino(ancho, alto, maxLado = MAX_LADO) {
  if (!(ancho > 0) || !(alto > 0)) return null;
  const mayor = Math.max(ancho, alto);
  if (mayor <= maxLado) return { ancho, alto, reducida: false };
  const k = maxLado / mayor;
  return {
    ancho: Math.max(1, Math.round(ancho * k)),
    alto: Math.max(1, Math.round(alto * k)),
    reducida: true,
  };
}

/** El nombre con el que se guarda. Un .heic recomprimido ya no es un .heic. */
export function nombreSalida(nombre, recomprimida) {
  const base = (nombre || 'foto').replace(/\.[^.]+$/, '') || 'foto';
  const limpio = base.replace(/[^\w.-]+/g, '_').slice(0, 60);
  return recomprimida ? `${limpio}.jpg` : (nombre || 'foto.jpg');
}

/**
 * Reduce una imagen si hace falta. → { archivo, reducida, antes, despues }
 *
 * Si algo falla —un HEIC que el navegador no sabe decodificar, un lienzo
 * contaminado— devuelve el original en vez de romper: mejor subir cinco megas
 * que perder la foto que el inspector acaba de tomar en campo.
 */
export async function prepararFoto(file, { maxLado = MAX_LADO, calidad = CALIDAD } = {}) {
  const intacta = (motivo) => ({
    archivo: file, reducida: false, antes: file.size, despues: file.size, motivo,
  });
  if (file.size <= SIN_TOCAR_BYTES) return intacta('ya era pequeña');
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') {
    return intacta('el navegador no puede redimensionar');
  }
  try {
    const bitmap = await createImageBitmap(file);
    const m = medidaDestino(bitmap.width, bitmap.height, maxLado);
    if (!m || !m.reducida) { bitmap.close?.(); return intacta('ya cabía'); }

    const lienzo = document.createElement('canvas');
    lienzo.width = m.ancho; lienzo.height = m.alto;
    const ctx = lienzo.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, m.ancho, m.alto);
    bitmap.close?.();

    const blob = await new Promise(r => lienzo.toBlob(r, 'image/jpeg', calidad));
    if (!blob) return intacta('no se pudo convertir');
    // Si la "reducción" engorda el archivo, se queda el original.
    if (blob.size >= file.size) return intacta('comprimida pesaba más');

    return {
      archivo: new File([blob], nombreSalida(file.name, true), { type: 'image/jpeg' }),
      reducida: true, antes: file.size, despues: blob.size,
    };
  } catch (e) {
    return intacta('falló al leer la imagen');
  }
}

/**
 * Dónde está la foto. El backend puede devolver una URL completa o una ruta
 * relativa de /media/.
 *
 * Una ruta relativa NO vale tal cual: el inventario se pide a /vigapi/, que es
 * una reescritura del borde de Vercel, así que un '/media/...' suelto lo
 * resolvería el navegador contra el dominio del front y traería un 404. Las
 * fotos cuelgan de la raíz del backend, que es lo que MEDIA apunta.
 */
export function urlFoto(foto) {
  const ruta = foto?.imagen_url || foto?.imagen || foto?.url || foto?.archivo || '';
  if (!ruta) return '';
  if (/^(https?:)?\/\//.test(ruta) || ruta.startsWith('data:')) return ruta;
  return `${MEDIA}${ruta.startsWith('/') ? '' : '/'}${ruta}`;
}

/** Las más recientes primero; sin fecha, al final. */
export const ordenarFotos = (fotos = []) =>
  [...fotos].sort((a, b) => {
    const fa = a.tomada || a.fecha || a.creado || '';
    const fb = b.tomada || b.fecha || b.creado || '';
    if (fa && fb) return fb.localeCompare(fa);
    if (fa) return -1;
    if (fb) return 1;
    return (b.id || 0) - (a.id || 0);
  });

/** "2.4 MB", "312 KB" — para decir cuánto se ahorró al reducir. */
export const peso = (bytes) =>
  bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
