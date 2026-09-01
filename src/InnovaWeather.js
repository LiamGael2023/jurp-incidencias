/**
 * Estaciones InnovaWeather (Innova-T).
 *
 * Son estaciones ajenas al sistema Davis de JURP: viven en el servidor de
 * Innova-T y se consultan por su DID. Este módulo las normaliza para que el
 * resto de la app las trate igual que a un pluviómetro propio.
 *
 * OJO con los datos: la API devuelve registros CENTINELA cuando no hay lectura
 * válida — temperatura 99.9, lluvia 1999.9, humedad >100, horas como "83:13:00"
 * y fechas imposibles (2050, 2055). Sumarlos sin filtrar daría acumulados de
 * miles de milímetros. Todo eso se descarta aquí.
 */

// Vercel reenvía /innovapi/* al servidor de Innova-T (ver vercel.json).
// Se usa ruta relativa para no chocar con CORS: el navegador no permite
// llamar a innovat.com.pe directamente desde el dominio de la app.
const API = '/innovapi/datarequestjson';

// Estaciones registradas. Añadir aquí las nuevas: solo hace falta el DID.
export const ESTACIONES_INNOVA = [
  { did: '001D0AE07DB6', nombre: 'VIRÚ - HUASCARÁN' },
];

const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * ¿Es un registro real o un centinela?
 * Se rechaza en bloque: si la fila trae marcas de "sin dato" en los campos
 * clave, sus demás valores tampoco son de fiar.
 */
export function registroValido(r, fechaEsperada = null) {
  if (!r) return false;

  // Hora imposible ("83:13:00").
  const h = parseInt(String(r.hora || '').slice(0, 2), 10);
  if (!Number.isFinite(h) || h > 23) return false;

  // Fecha fuera de un rango razonable (aparecen 2050, 2055…).
  const anio = parseInt(String(r.fecha || '').slice(0, 4), 10);
  const anioAhora = new Date().getFullYear();
  if (!Number.isFinite(anio) || anio < 2015 || anio > anioAhora + 1) return false;
  if (fechaEsperada && String(r.fecha) !== fechaEsperada) return false;

  // Centinelas de los sensores.
  const t = num(r.tempExt_c);
  if (t === null || t >= 99 || t <= -50) return false;

  const hum = num(r.humOut);
  if (hum !== null && (hum > 100 || hum < 0)) return false;

  const ll = num(r.lluvia_mm);
  if (ll === null || ll < 0 || ll >= 1000) return false;   // 1999.9 = sin dato

  return true;
}

const dosDigitos = (n) => String(n).padStart(2, '0');

// El formato IMPORTA: con yyyy/mm/dd la API devuelve las lecturas reales;
// con yyyymmdd (sin barras) responde 200 pero con registros centinela
// (temperatura 99.9, lluvia 1999.9, fechas de 2050). Es un fallo silencioso
// que parece dato bueno, así que la fecha se construye siempre aquí.
export const fechaInnova = (d = new Date()) =>
  `${d.getFullYear()}/${dosDigitos(d.getMonth() + 1)}/${dosDigitos(d.getDate())}`;

/**
 * Lee una estación en un rango de fechas (formato yyyy/mm/dd).
 * Devuelve { alias, lat, lng, registros, lluviaTotal, ultimo, descartados }.
 */
export async function leerEstacion(did, fecini = fechaInnova(), fecfin = fechaInnova()) {
  const url = `${API}?did=${encodeURIComponent(did)}&fecini=${fecini}&fecfin=${fecfin}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`InnovaWeather respondió ${r.status}`);
  const d = await r.json();

  // El campo error: 0 ok · 1 faltan datos · 2 auth · 3 estación ajena
  // · 4/5 inactiva · 6 sin datos en el rango.
  if (d.error && String(d.error) !== '0') {
    throw new Error(`InnovaWeather error ${d.error}${d.Msg ? `: ${d.Msg}` : ''}`);
  }

  const crudos = Array.isArray(d.data) ? d.data : [];
  const validos = crudos.filter(x => registroValido(x));

  // La lluvia del periodo es la SUMA de los incrementos por registro, igual
  // que se hace con los pluviómetros Davis.
  const lluviaTotal = validos.reduce((a, x) => a + (num(x.lluvia_mm) || 0), 0);

  const ultimo = validos.length ? validos[validos.length - 1] : null;

  return {
    did,
    alias: d.alias || did,
    lat: num(d.latitude),
    lng: num(d.longitude),
    registros: validos,
    lluviaTotal: Math.round(lluviaTotal * 10) / 10,
    temperatura: ultimo ? num(ultimo.tempExt_c) : null,
    humedad: ultimo ? num(ultimo.humOut) : null,
    viento: ultimo ? num(ultimo.viento_vel_prom) : null,
    ultimo,
    descartados: crudos.length - validos.length,
  };
}

/** Lee todas las estaciones configuradas. Las que fallen se omiten. */
export async function leerTodas(fecini, fecfin) {
  const res = await Promise.all(ESTACIONES_INNOVA.map(async e => {
    try {
      const d = await leerEstacion(e.did, fecini, fecfin);
      return { ...d, nombre: e.nombre || d.alias };
    } catch (err) {
      console.warn(`[InnovaWeather] ${e.nombre || e.did}:`, err.message);
      return null;
    }
  }));
  return res.filter(Boolean);
}

/** Acumulado por hora del día, para el gráfico de lluvia. */
export function lluviaPorHora(registros) {
  const porHora = new Array(24).fill(0);
  for (const r of registros) {
    const h = parseInt(String(r.hora || '').slice(0, 2), 10);
    if (h >= 0 && h <= 23) porHora[h] += num(r.lluvia_mm) || 0;
  }
  return porHora.map((mm, h) => ({
    hora: dosDigitos(h),
    mm: Math.round(mm * 10) / 10,
  }));
}