// ═══════════════════════════════════════════════════════════════════════════
//  reporteMapa — componer la imagen del mapa y mandarla
// ═══════════════════════════════════════════════════════════════════════════
//
// POR QUE NO BASTA LA CAPTURA QUE YA HABIA. `useCapturaMapa` fotografía el
// mapa y nada más, a propósito: deja fuera paneles y cabecera para que no
// tapen lo que se quiere enseñar. Eso está bien para guardar la imagen, pero
// mal para mandarla: quien la recibe en WhatsApp ve puntos de colores sin
// saber de cuándo son, qué significa el rojo, ni cuántas estaciones hay.
//
// Así que la foto se compone: la captura del mapa en medio, y encima y debajo
// una banda con la hora, el nivel de alerta, el conteo de estaciones, la
// leyenda de lluvia y la nota. Todo dibujado sobre el canvas, no como HTML
// alrededor, porque lo que viaja por WhatsApp es un PNG y nada más.
//
// SOBRE WHATSAPP, QUE ES LO QUE MAS CONFUNDE. No existe forma de adjuntar una
// imagen a un chat desde un enlace wa.me: ese enlace solo lleva texto. Hay
// tres caminos reales y cada uno sirve en un sitio distinto:
//
//   1. navigator.share con archivos — en móvil abre la hoja de compartir del
//      sistema y WhatsApp sale ahí. Es el camino bueno y el que se intenta
//      primero.
//   2. En escritorio eso casi nunca existe. Entonces se copia la imagen al
//      portapapeles y se abre WhatsApp Web con el texto ya puesto: el usuario
//      pega con Ctrl+V. Se le dice, no se le deja adivinar.
//   3. Si ninguna de las dos, se descarga el PNG y se avisa.
//
// Mandar el mensaje DESDE el servidor sin abrir WhatsApp es otra cosa: exige
// la API Cloud de WhatsApp Business, cuenta de Meta verificada y plantillas
// aprobadas. Es trámite, no código, y no se finge aquí.

// ───────────────────────────────────────────────────────────────────────────
//  Dibujo sobre canvas
// ───────────────────────────────────────────────────────────────────────────

/** Parte un texto en líneas que caben en `ancho`. */
function enLineas(ctx, texto, ancho) {
  const fuera = [];
  for (const parrafo of String(texto || '').split('\n')) {
    if (!parrafo.trim()) { fuera.push(''); continue; }
    let linea = '';
    for (const palabra of parrafo.split(/\s+/)) {
      const prueba = linea ? linea + ' ' + palabra : palabra;
      if (ctx.measureText(prueba).width > ancho && linea) {
        fuera.push(linea);
        linea = palabra;
      } else {
        linea = prueba;
      }
    }
    if (linea) fuera.push(linea);
  }
  return fuera;
}

function rectRedondo(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * Compone la imagen final: banda superior, mapa, banda inferior.
 *
 * `mapa` es el canvas que devuelve html2canvas. Se escribe en píxeles de ese
 * canvas, que viene a escala 2, así que las medidas van en una unidad `u`
 * derivada de su ancho — si mañana se captura a otra escala, el estampado
 * sigue proporcionado en vez de salir diminuto o gigante.
 */
export function componerReporte(mapa, ctx0) {
  const {
    titulo = 'Monitoreo GIS — Junta de Riego Presurizado',
    subtitulo = 'NEXHYDRO · PLUVIRA',
    nivel = null,          // { texto, color }
    nota = '',
    autor = '',
    conteos = null,        // { pluviometros, davis, innova, sinDatos }
    maximo = null,         // { nombre, mm }
    leyenda = [],          // [{ etiqueta, color, texto }]
  } = ctx0 || {};

  const W = mapa.width;
  const u = W / 1000;                       // unidad proporcional al ancho
  const px = (n) => Math.round(n * u);
  const margen = px(26);
  const anchoUtil = W - margen * 2;

  // ── medir el alto antes de crear el lienzo ───────────────────────────────
  const medidor = document.createElement('canvas').getContext('2d');
  medidor.font = `${px(19)}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
  const lineasNota = nota.trim() ? enLineas(medidor, nota.trim(), anchoUtil - px(24)) : [];

  const altoCab = px(96);
  const altoLeyenda = leyenda.length ? px(52) : 0;
  const altoNota = lineasNota.length
    ? px(18) + px(24) + lineasNota.length * px(27) + px(18)
    : 0;
  const altoPie = px(14) + altoLeyenda + altoNota + px(44);

  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = altoCab + mapa.height + altoPie;
  const c = cv.getContext('2d');

  const TINTA = '#0b2545';
  const SUAVE = '#64748b';

  // ── fondo ────────────────────────────────────────────────────────────────
  c.fillStyle = '#ffffff';
  c.fillRect(0, 0, cv.width, cv.height);

  // ── cabecera ─────────────────────────────────────────────────────────────
  c.fillStyle = TINTA;
  c.fillRect(0, 0, W, altoCab);

  c.textBaseline = 'alphabetic';
  c.fillStyle = '#ffffff';
  c.font = `700 ${px(26)}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
  c.fillText(titulo, margen, px(40));

  c.fillStyle = 'rgba(255,255,255,.72)';
  c.font = `${px(18)}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
  c.fillText(subtitulo, margen, px(68));

  // fecha y hora, a la derecha
  const sello = new Date().toLocaleString('es-PE', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
  c.textAlign = 'right';
  c.fillStyle = 'rgba(255,255,255,.92)';
  c.font = `600 ${px(19)}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
  c.fillText(sello, W - margen, px(68));

  // chip de nivel de alerta
  if (nivel && nivel.texto) {
    c.font = `700 ${px(18)}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
    const t = String(nivel.texto).toUpperCase();
    const ancho = c.measureText(t).width + px(26);
    const x = W - margen - ancho;
    c.textAlign = 'left';
    c.fillStyle = nivel.color || '#f59f0a';
    rectRedondo(c, x, px(16), ancho, px(30), px(15));
    c.fill();
    // El texto oscuro o claro según el fondo: el amarillo oficial no sostiene
    // blanco y el rojo oficial no sostiene oscuro.
    c.fillStyle = contrasta(nivel.color || '#f59f0a');
    c.fillText(t, x + px(13), px(37));
  }
  c.textAlign = 'left';

  // ── el mapa ──────────────────────────────────────────────────────────────
  c.drawImage(mapa, 0, altoCab);
  c.strokeStyle = 'rgba(11,37,69,.18)';
  c.lineWidth = Math.max(1, px(1.5));
  c.strokeRect(0.5, altoCab + 0.5, W - 1, mapa.height - 1);

  // ── pie ──────────────────────────────────────────────────────────────────
  let y = altoCab + mapa.height + px(32);

  if (leyenda.length) {
    c.font = `600 ${px(17)}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
    let x = margen;
    for (const it of leyenda) {
      const r = px(9);
      c.fillStyle = it.color;
      c.beginPath(); c.arc(x + r, y - px(6), r, 0, Math.PI * 2); c.fill();
      c.strokeStyle = 'rgba(11,37,69,.35)'; c.lineWidth = Math.max(1, px(1));
      c.beginPath(); c.arc(x + r, y - px(6), r, 0, Math.PI * 2); c.stroke();
      c.fillStyle = TINTA;
      c.fillText(it.etiqueta, x + r * 2 + px(8), y);
      x += r * 2 + px(8) + c.measureText(it.etiqueta).width + px(26);
    }
    y += px(34);
  }

  // conteos y máximo, en una línea
  const trozos = [];
  if (conteos) {
    const p = [];
    if (conteos.pluviometros) p.push(`${conteos.pluviometros} pluviómetros`);
    if (conteos.davis) p.push(`${conteos.davis} Davis`);
    if (conteos.innova) p.push(`${conteos.innova} Innova`);
    if (p.length) trozos.push(p.join(' · '));
    if (conteos.sinDatos) trozos.push(`${conteos.sinDatos} sin datos`);
  }
  if (maximo && maximo.nombre) {
    trozos.push(`máx. ${Number(maximo.mm || 0).toFixed(1)} mm en ${maximo.nombre}`);
  }
  if (trozos.length) {
    c.fillStyle = SUAVE;
    c.font = `${px(17)}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
    c.fillText(trozos.join('   ·   '), margen, y);
    y += px(26);
  }

  // la nota
  if (lineasNota.length) {
    const alto = px(24) + lineasNota.length * px(27) + px(14);
    c.fillStyle = '#f1f5f9';
    rectRedondo(c, margen, y - px(6), anchoUtil, alto, px(8));
    c.fill();
    c.fillStyle = '#1463A5';
    c.fillRect(margen, y - px(6), px(4), alto);

    c.fillStyle = TINTA;
    c.font = `${px(19)}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
    let ty = y + px(22);
    for (const l of lineasNota) { c.fillText(l, margen + px(16), ty); ty += px(27); }
    y += alto + px(8);
  }

  if (autor) {
    c.fillStyle = SUAVE;
    c.font = `${px(15)}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
    c.fillText(`Enviado por ${autor}`, margen, y + px(14));
  }

  return cv;
}

/** Texto oscuro o blanco según la luminancia del fondo. */
function contrasta(hex) {
  const h = String(hex).replace('#', '');
  if (h.length < 6) return '#0b2545';
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const f = (v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  const L = 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  return L > 0.42 ? '#0b2545' : '#ffffff';
}

// ───────────────────────────────────────────────────────────────────────────
//  Envíos
// ───────────────────────────────────────────────────────────────────────────

/**
 * El nombre lleva la extensión que de verdad tiene el archivo.
 *
 * Un .png que por dentro es JPEG lo rechazan algunos clientes y confunde al
 * que lo recibe.
 */
export const nombreArchivo = (tipo = 'image/jpeg') =>
  `mapa_jurp_${new Date().toISOString().slice(0, 16).replace(/[:T-]/g, '')}`
  + (tipo === 'image/png' ? '.png' : '.jpg');

/**
 * El PNG no es el formato para esto.
 *
 * Lo que se fotografía es imagen satelital, o sea contenido fotográfico, y el
 * PNG lo guarda sin pérdida: 8 MB para algo que WhatsApp va a recomprimir de
 * todas formas, con la subida arrastrándose por una conexión de campo. En
 * JPEG al 90 % la misma foto baja a cientos de kilobytes y a ojo no se nota.
 *
 * La excepción es el portapapeles: ClipboardItem solo acepta PNG de forma
 * fiable, así que ahí sí va PNG.
 */
export function aBlob(canvas, tipo = 'image/jpeg', calidad = 0.9) {
  return new Promise(res => canvas.toBlob(res, tipo, calidad));
}

/**
 * ¿Estamos en un móvil?
 *
 * Importa porque decide el camino de WhatsApp, y equivocarse se nota: en
 * Windows `navigator.share` existe y abre la hoja de compartir del SISTEMA,
 * donde WhatsApp solo aparece si está instalada la app de escritorio. Si no
 * lo está —que es lo normal en una PC de oficina— el botón de WhatsApp lleva
 * a una pantalla llena de Outlook, Teams y Paint, y de WhatsApp nada.
 *
 * Se mira userAgentData.mobile, que es el dato declarado por el navegador, y
 * solo si no existe se cae al user-agent.
 */
function esMovil() {
  try {
    if (navigator.userAgentData && typeof navigator.userAgentData.mobile === 'boolean')
      return navigator.userAgentData.mobile;
  } catch { /* algunos navegadores lanzan al tocarlo */ }
  return /Android|iPhone|iPad|iPod|Opera Mini|IEMobile|Mobile Safari/i
    .test(navigator.userAgent || '');
}

/**
 * Normaliza el número a formato internacional.
 *
 * Nueve dígitos que empiezan en 9 es un celular peruano sin prefijo, que es
 * como lo escribe todo el mundo aquí. Sin el 51 delante el enlace apunta a un
 * número que no existe y WhatsApp abre un chat vacío, sin decir por qué.
 *
 * Se devuelve también si se tocó, para poder enseñarlo: corregir en silencio
 * un número de teléfono es de las cosas que luego nadie entiende.
 */
export function normalizarTelefono(crudo) {
  const d = String(crudo || '').replace(/\D/g, '');
  if (!d) return { numero: '', cambiado: false };
  if (d.length === 9 && d.startsWith('9')) return { numero: '51' + d, cambiado: true };
  return { numero: d, cambiado: false };
}

/**
 * Manda por WhatsApp. Devuelve cómo se hizo, para poder decirlo.
 *
 * DOS CAMINOS, según dónde se esté:
 *
 *   Móvil      → navigator.share. La hoja del sistema trae WhatsApp y la foto
 *                va adjunta sola. Es el único camino que no pide pegar nada.
 *
 *   Escritorio → WhatsApp Web directo, con la imagen en el portapapeles. NO
 *                se usa la hoja de compartir de Windows: WhatsApp solo sale
 *                ahí si está instalada la app de escritorio, y si no lo está
 *                el botón no lleva a WhatsApp.
 *
 * Se va a web.whatsapp.com/send y no a wa.me porque wa.me mete por medio una
 * página intermedia de «Continuar al chat» con un botón de descarga; un paso
 * más y una invitación a instalar algo que no hace falta.
 */
/**
 * La hoja de compartir del sistema, en el dispositivo que sea.
 *
 * Es el ÚNICO camino que incrusta la imagen en el chat sin que nadie pegue
 * nada, y funciona igual en el móvil y en el escritorio. La diferencia no
 * está en el sistema operativo sino en si WhatsApp está INSTALADO: Windows
 * lista WhatsApp en la hoja con un «Instalar» al lado cuando no lo está, y
 * entonces no es un destino de verdad y la foto no tiene dónde ir.
 *
 * Por eso esto se ofrece siempre y no solo en móvil. Antes lo limité al
 * móvil al ver la hoja de Windows sin WhatsApp, y eso fue quitarle al usuario
 * la única opción que hace exactamente lo que quiere.
 */
export async function compartirNativo(hacer) {
  const blob = await hacer('image/jpeg');
  const file = new File([blob], nombreArchivo(blob.type), { type: blob.type });
  if (!navigator.canShare || !navigator.canShare({ files: [file] })) {
    const e = new Error('SIN_COMPARTIR');
    e.codigo = 'SIN_COMPARTIR';
    throw e;
  }
  try {
    await navigator.share({ files: [file], title: 'Mapa JURP' });
    return { via: 'nativo' };
  } catch (e) {
    if (e && e.name === 'AbortError') return { via: 'cancelado' };
    throw e;
  }
}

export async function enviarPorWhatsApp(hacer, texto, telefono, opciones = {}) {
  const { forzarWeb = false } = opciones;

  // ── escritorio ──────────────────────────────────────────────────────────
  if (forzarWeb || !esMovil()) {
    // EL ORDEN AQUI ES TODO, Y ES LO QUE FALLABA.
    //
    // Antes se componía la imagen, se esperaba a tenerla, y RECIEN entonces
    // se escribía el portapapeles. Entre el clic y esa escritura pasaba casi
    // un segundo —componer el canvas, pasarlo a PNG— y para cuando llegaba,
    // el navegador ya no la consideraba parte del gesto del usuario: la
    // rechazaba sin ruido y el chat se abría con el texto y sin foto.
    //
    // ClipboardItem acepta una PROMESA de blob. Así la escritura se pide en
    // el mismo instante del clic, mientras la imagen todavía se está
    // componiendo, y el navegador la concede.
    const png = hacer('image/png');
    let copiada = false;
    try {
      if (navigator.clipboard && window.ClipboardItem) {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
        copiada = true;
      }
    } catch { copiada = false; }

    const { numero } = normalizarTelefono(telefono);
    const url = numero
      ? `https://web.whatsapp.com/send?phone=${numero}&text=${encodeURIComponent(texto)}`
      // Sin número no hay a quién escribirle: WhatsApp Web se abre y el
      // usuario elige el chat. El texto no se puede prellenar sin destino.
      : 'https://web.whatsapp.com/';
    window.open(url, '_blank', 'noopener');

    if (copiada) return { via: 'web', numero, conTexto: !!numero };
    descargarBlob(await hacer('image/jpeg'));
    return { via: 'web-sin-copia', numero, conTexto: !!numero };
  }

  // ── móvil ───────────────────────────────────────────────────────────────
  const blob = await hacer('image/jpeg');
  const file = new File([blob], nombreArchivo(blob.type), { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text: texto, title: 'Mapa JURP' });
      return { via: 'nativo' };
    } catch (e) {
      // AbortError = el usuario cerró la hoja de compartir. No es un fallo.
      if (e && e.name === 'AbortError') return { via: 'cancelado' };
    }
  }
  const { numero } = normalizarTelefono(telefono);
  window.open(numero
    ? `https://wa.me/${numero}?text=${encodeURIComponent(texto)}`
    : `https://wa.me/?text=${encodeURIComponent(texto)}`, '_blank', 'noopener');
  descargarBlob(blob);
  return { via: 'web-sin-copia', numero, conTexto: !!numero };
}

export function descargarBlob(blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nombreArchivo(blob.type);
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

/**
 * Notificación push a la app.
 *
 * Si el backend todavía no tiene el endpoint, lo DICE. Un botón que se queda
 * callado tras un 404 es peor que uno que no está: el operario cree que el
 * aviso salió y nadie lo recibe.
 */
/**
 * Sube la imagen al servidor. Devuelve { url, enviados, ... }.
 *
 * Sirve para dos cosas a la vez, y por eso vale la pena: avisa a los
 * teléfonos con la foto dentro de la notificación, y deja la imagen en una
 * URL pública que se puede pegar en el mensaje de WhatsApp. Con ese enlace,
 * el envío por WhatsApp deja de necesitar que nadie pegue nada.
 */
export async function notificarApp(blob, { api, titulo, cuerpo, clave, origen, solo }) {
  const fd = new FormData();
  fd.append('imagen', new File([blob], nombreArchivo(blob.type), { type: blob.type }));
  fd.append('titulo', titulo || 'Aviso del monitoreo');
  fd.append('cuerpo', cuerpo || '');
  fd.append('origen', origen || 'monitoreo_gis');
  // Publicar sin avisar: para el enlace de WhatsApp. Mandar una foto por
  // WhatsApp no es motivo para hacer sonar los teléfonos de los vigilantes.
  if (solo) fd.append('solo_publicar', '1');

  // NO se manda Authorization, y es a propósito.
  //
  // El backend de vigilancia valida el token de PLUVIRA pero rechaza con él
  // cualquier escritura: «Las credenciales de PLUVIRA solo permiten consultar
  // datos». Ese rechazo lo da la capa de autenticación ANTES de llegar a la
  // vista, así que mandar la cabecera convierte un POST que habría pasado en
  // un 401. Sin cabecera, la petición llega como anónima y la vista decide:
  // publicar sí, notificar solo con la clave.
  const cabeceras = {};
  if (clave) cabeceras['X-Notif-Clave'] = clave;

  const r = await fetch(`${api}/notificaciones/mapa/`, {
    method: 'POST',
    headers: cabeceras,
    body: fd,
  });

  if (r.status === 404) {
    const e = new Error('SIN_ENDPOINT');
    e.codigo = 'SIN_ENDPOINT';
    throw e;
  }
  if (r.status === 403) {
    const e = new Error('SIN_PERMISO');
    e.codigo = 'SIN_PERMISO';
    throw e;
  }
  if (!r.ok) {
    let detalle = '';
    try { detalle = (await r.text()).slice(0, 180); } catch { detalle = ''; }
    throw new Error(`El servidor respondió ${r.status}. ${detalle}`);
  }
  return r.json().catch(() => ({}));
}

/**
 * A cuántos teléfonos llegaría. Devuelve null si el backend no lo soporta.
 *
 * Se pregunta ANTES de mandar porque son teléfonos de vigilantes reales: que
 * nadie los haga sonar sin saber cuántos son.
 */
export async function cuantosDispositivos(api) {
  try {
    const r = await fetch(`${api}/notificaciones/mapa/`);
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}
