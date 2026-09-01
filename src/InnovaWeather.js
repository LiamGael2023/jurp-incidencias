/**
 * Estaciones InnovaWeather (Innova-T).
 *
 * La consulta la hace el BACKEND, no el navegador: innovat.com.pe no envía
 * cabeceras CORS y su API oficial además rechaza la petición ("Invalid
 * Request") salvo que lleve la sesión del sitio. El servidor consulta el
 * widget público por token, extrae los campos y los devuelve como JSON.
 *
 * LIMITACIÓN: por esta vía solo hay LECTURA ACTUAL — lluvia acumulada del día,
 * temperatura, humedad, viento, presión, radiación. No hay serie por horas ni
 * por días. Para eso haría falta que Innova-T habilite la API oficial sobre
 * este DID, o guardar cada lectura en nuestra base.
 */

// /vigapi/ es el proxy de Vercel hacia gideonstudio.duckdns.org/api/v1/
const API = '/vigapi/mobile/operations/innova';

/** Lectura actual de una estación. `did` opcional: si falta, la primera. */
export async function leerEstacion(did) {
  const url = did ? `${API}/?did=${encodeURIComponent(did)}` : `${API}/`;
  const r = await fetch(url);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error(d.detalle || d.error || `El servidor respondió ${r.status}`);
  }
  return d;
}

/** Todas las estaciones configuradas, con su lectura actual. */
export async function leerTodas() {
  const r = await fetch(`${API}/estaciones/`);
  if (!r.ok) throw new Error(`El servidor respondió ${r.status}`);
  const d = await r.json();
  // Las que vengan con error se descartan: una estación caída no debe
  // dejar sin datos a las demás ni romper el mapa.
  return (d.estaciones || []).filter(e => !e.error);
}

/** "Last Updated on Sep 1 2026, 3:11 pm -05" → "3:11 pm" */
export function horaDeLectura(texto) {
  if (!texto) return '';
  const m = String(texto).match(/(\d{1,2}:\d{2}\s*[ap]m)/i);
  return m ? m[1] : texto.replace(/^Last Updated on\s*/i, '');
}