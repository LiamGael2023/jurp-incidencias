/**
 * Pedir datos a la API sabiendo QUE pasó cuando no llegan.
 *
 * EL PROBLEMA QUE RESUELVE. Las pantallas pedían así:
 *
 *     const res = await fetch(url, { headers: { Authorization: ... } });
 *     if (res.ok) { ...pintar... }
 *
 * Sin `else`. Un 401, un 504 y un corte de red producen exactamente lo
 * mismo: nada. La lista se queda vacía o con lo de antes, y quien mira la
 * pantalla ve «desaparecieron las incidencias» sin una sola pista de por
 * qué. Los tres casos se arreglan de forma distinta —volver a entrar,
 * esperar al servidor, mirar la conexión— y el síntoma era idéntico.
 *
 * Esto no adivina la causa: la clasifica y la cuenta.
 *
 * NO CIERRA LA SESION SOLA, a propósito. Un 401 suelto puede venir de un
 * endpoint concreto —hay varios en este sistema que responden 401 por otros
 * motivos: el inventario vive en otro backend que no comparte usuarios, y
 * vigilancia puede no reconocer todavía el token de PLUVIRA—. Tirar el
 * token por uno de esos dejaría a alguien fuera en mitad de un parte sin
 * guardar. Se avisa y se ofrece el botón; la decisión es suya.
 *
 * MIDE CUANTO LLEVABA ABIERTA la sesión cuando la rechazaron. Si el token
 * caduca, ese número se va a repetir; si es el servidor que falla a ratos,
 * saldrá cualquier cosa. Es la diferencia entre saberlo y suponerlo.
 */

const CLAVE_TOKEN = 'userToken';
const CLAVE_DESDE = 'sesionDesde';

/** El token de la sesión, o null. */
export const tokenActual = () => {
  try { return localStorage.getItem(CLAVE_TOKEN); } catch (e) { return null; }
};

/** Se llama al entrar: marca cuándo empezó esta sesión. */
export const marcarEntrada = () => {
  try { localStorage.setItem(CLAVE_DESDE, String(Date.now())); } catch (e) { /* modo privado */ }
};

/** Cuánto lleva abierta la sesión, en minutos, o null si no se sabe. */
export const minutosDeSesion = () => {
  try {
    const t = Number(localStorage.getItem(CLAVE_DESDE));
    if (!t || !Number.isFinite(t)) return null;
    return Math.max(0, Math.round((Date.now() - t) / 60000));
  } catch (e) { return null; }
};

export const duracionLegible = (min) => {
  if (min === null || min === undefined) return null;
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
};

/* ── Quién se entera ──────────────────────────────────────────────────── */

const oyentes = new Set();

/** Suscribe una función a los fallos. Devuelve cómo desuscribirse. */
export const alFallar = (fn) => {
  oyentes.add(fn);
  return () => oyentes.delete(fn);
};

/* Varias peticiones en paralelo fallan a la vez —el mapa lanza cinco—, y
 * avisar cinco veces apila cinco carteles iguales. Se deja pasar uno cada
 * pocos segundos por motivo. */
const ESPERA_MS = 4000;
const ultimo = new Map();

export function avisar(motivo, detalle = {}) {
  const ahora = Date.now();
  if (ahora - (ultimo.get(motivo) || 0) < ESPERA_MS) return false;
  ultimo.set(motivo, ahora);
  const aviso = {
    motivo,
    cuando: ahora,
    minutos: minutosDeSesion(),
    ...detalle,
  };
  for (const fn of oyentes) {
    try { fn(aviso); } catch (e) { /* un oyente roto no tumba al resto */ }
  }
  return true;
}

/** Para las pruebas y para el cierre de sesión: olvida lo ya avisado. */
export const olvidarAvisos = () => ultimo.clear();

/* ── Clasificar ───────────────────────────────────────────────────────── */

/**
 * De una respuesta -o de la ausencia de ella-, qué pasó.
 *
 *   'ok'        llegó y vale
 *   'sesion'    el servidor no aceptó quién eres (401, o 403 con token)
 *   'permiso'   te conoce pero no te deja (403 sin token: no es la sesión)
 *   'servidor'  el servidor está mal (5xx, incluido el 504 del proxy)
 *   'red'       no se llegó a hablar con él
 *   'raro'      cualquier otro código
 */
export function clasificar(res, hayToken) {
  if (!res) return 'red';
  if (res.ok) return 'ok';
  if (res.status === 401) return 'sesion';
  if (res.status === 403) return hayToken ? 'sesion' : 'permiso';
  if (res.status >= 500) return 'servidor';
  return 'raro';
}

export const TEXTOS = {
  sesion: 'El servidor no aceptó tu sesión. Vuelve a entrar para seguir viendo los datos.',
  servidor: 'El servidor no respondió bien. Los datos que ves pueden estar incompletos.',
  red: 'No se pudo conectar con el servidor. Revisa tu conexión.',
  raro: 'El servidor respondió algo inesperado. Los datos pueden estar incompletos.',
  permiso: 'Tu usuario no tiene permiso para ver esto.',
};

/* ── Pedir ────────────────────────────────────────────────────────────── */

/**
 * Como fetch, pero pone el token, clasifica el resultado y lo cuenta.
 *
 * Devuelve { ok, res, datos, motivo }. `datos` solo viene si se pidió JSON
 * y llegó bien; así quien llama no tiene que repetir el try del .json(),
 * que es donde se escondía otro fallo mudo: un 200 con cuerpo roto.
 */
export async function pedir(url, opciones = {}) {
  const token = tokenActual();
  const { json = true, ...resto } = opciones;

  if (!token) {
    // Antes esto era `if (!token) return;` y la pantalla se quedaba vacía
    // sin decir nada. Sigue sin pedir, pero ahora se entera alguien.
    avisar('sesion', { url, sinToken: true });
    return { ok: false, res: null, datos: null, motivo: 'sesion' };
  }

  const cabeceras = { Authorization: `Token ${token}`, ...(resto.headers || {}) };
  if (json && !cabeceras['Content-Type'] && resto.body) {
    cabeceras['Content-Type'] = 'application/json';
  }

  let res = null;
  try {
    res = await fetch(url, { ...resto, headers: cabeceras });
  } catch (e) {
    avisar('red', { url });
    return { ok: false, res: null, datos: null, motivo: 'red' };
  }

  const motivo = clasificar(res, true);
  if (motivo !== 'ok') {
    avisar(motivo, { url, status: res.status });
    return { ok: false, res, datos: null, motivo };
  }

  if (!json) return { ok: true, res, datos: null, motivo: 'ok' };

  try {
    return { ok: true, res, datos: await res.json(), motivo: 'ok' };
  } catch (e) {
    // Un 200 con cuerpo que no es JSON. Pasa cuando un proxy devuelve su
    // propia página de error con código 200, y es de los fallos que más
    // tiempo cuestan porque `res.ok` dice que todo fue bien.
    avisar('raro', { url, status: res.status, cuerpo: 'no es JSON' });
    return { ok: false, res, datos: null, motivo: 'raro' };
  }
}
