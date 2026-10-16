/**
 * Lluvia de una estación, leída del endpoint filtered-data de JURP.
 *
 * Todas las estaciones se consultan igual: metric 'rainfall_mm', y el total
 * del día sale de 'total_precipitation', que calcula el servidor.
 *
 * Antes había que distinguir el tipo de equipo, porque las Davis de la
 * generación v1 tienen 'rainfall_mm' vacío y solo guardan el acumulado del
 * día. Eso ahora lo resuelve el backend (ver _derivar_intervalos en
 * src/apps/davis/views.py): cuando una estación no tiene el campo, deriva la
 * serie restando acumulados consecutivos. La regla vive en un solo lugar, y
 * una estación nueva funciona sin tocar el cliente.
 *
 * Las funciones siguen aceptando el parámetro 'tipo' para no obligar a
 * cambiar a quien las llama; ya no se usa.
 */

export const fmtFecha = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Coordenadas 0,0 = estación sin ubicar en el backend (caería frente a África).
export const sinUbicacion = (lat, lng) =>
  !Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0);

async function pedirDia(stationId, fecha, token) {
  const f = fmtFecha(fecha);
  const url = `/api/v1/mobile/davis/rain-gauges/filtered-data/?start_date=${f}&end_date=${f}`
    + `&station_id=${stationId}&metric=rainfall_mm&max_points=9000`;
  const r = await fetch(url, { headers: { Authorization: `Token ${token}` } });
  if (!r.ok) return null;
  const j = await r.json();
  const mismoDia = fecha.toDateString();
  const lecturas = (j.data || [])
    .map(x => ({ t: new Date(x.timestamp), v: parseFloat(x.value) }))
    .filter(x => !Number.isNaN(x.v) && x.t.toDateString() === mismoDia)
    .sort((a, b) => a.t - b.t);
  return { json: j, lecturas };
}

// Días hacia atrás que se miran para saber desde cuándo calla una estación.
// Más allá de esto da igual el número exacto: lo que hay que decir es "lleva
// semanas", y rastrear sesenta días por cada estación sale caro para no
// añadir nada.
const DIAS_BUSQUEDA = 10;

/**
 * Cuándo reportó por última vez, mirando hacia atrás DIAS_BUSQUEDA.
 * → Date | null   (null = ni siquiera en esa ventana)
 *
 * Solo se llama para estaciones que hoy no tienen nada, que es cuando la
 * pregunta importa. Mientras reportan con normalidad nadie paga esta
 * consulta, que es la cara.
 */
async function ultimaLectura(stationId, fecha, token) {
  const desde = new Date(fecha);
  desde.setDate(desde.getDate() - DIAS_BUSQUEDA);
  const url = `/api/v1/mobile/davis/rain-gauges/filtered-data/`
    + `?start_date=${fmtFecha(desde)}&end_date=${fmtFecha(fecha)}`
    + `&station_id=${stationId}&metric=rainfall_mm&max_points=9000`;
  try {
    const r = await fetch(url, { headers: { Authorization: `Token ${token}` } });
    if (!r.ok) return null;
    const j = await r.json();
    // max_points va alto a propósito: la API recorta la serie ANTES de
    // calcular las estadísticas, así que pedir pocos puntos no aligera la
    // respuesta, devuelve mal la fecha.
    const t = j.stats?.last_timestamp;
    return t ? new Date(t) : null;
  } catch (e) {
    return null;
  }
}

/**
 * Total de un día.
 * → { mm, lecturas, sinDatos, ultima }
 *
 * 'sinDatos' distingue "la estación no reportó" de "reportó y no llovió":
 * mostrar 0 mm en el primer caso afirmaría algo que no se sabe.
 *
 * 'ultima' separa dos cosas que se veían iguales: a las 00:10 casi ninguna
 * estación ha reportado todavía y eso es normal, mientras que una que calla
 * desde hace nueve días está muerta. Sin esta fecha, las dos salían como
 * "sin datos" y la segunda se perdía entre las primeras —que es exactamente
 * lo que pasó con LUZMILA.
 */
export async function lluviaDelDia(stationId, tipo, fecha, token) {
  try {
    const res = await pedirDia(stationId, fecha, token);
    if (!res) return { mm: 0, lecturas: 0, sinDatos: true, ultima: null };

    const { json, lecturas } = res;
    const n = typeof json.stats?.count === 'number' ? json.stats.count : lecturas.length;
    if (!n) {
      const ultima = await ultimaLectura(stationId, fecha, token);
      return { mm: 0, lecturas: 0, sinDatos: true, ultima };
    }

    const mm = typeof json.total_precipitation === 'number'
      ? json.total_precipitation
      : lecturas.reduce((a, x) => a + x.v, 0);

    const ult = json.stats?.last_timestamp;
    return { mm, lecturas: n, sinDatos: false, ultima: ult ? new Date(ult) : null };
  } catch (e) {
    return { mm: 0, lecturas: 0, sinDatos: true, ultima: null };
  }
}

/**
 * Horas que una estación puede estar callada antes de considerarla caída.
 * Las Davis reportan cada quince minutos: seis horas son veinticuatro
 * lecturas perdidas, suficiente para descartar un corte pasajero.
 */
export const HORAS_CAIDA = 6;

/**
 * ¿Está caída? Recibe lo que devuelve lluviaDelDia.
 *
 * Una estación que reportó hace media hora no está caída aunque hoy no tenga
 * lecturas —pasa cada noche, entre medianoche y su primer envío—.
 */
export function estaCaida(est, ahora = new Date()) {
  if (!est || !est.sinDatos) return false;
  if (!est.ultima) return true;            // ni rastro en diez días
  return (ahora - est.ultima) > HORAS_CAIDA * 3600 * 1000;
}

/** "9 d" / "7 h" / "más de 10 d", para decirlo en poco espacio. */
export function desdeCuando(est, ahora = new Date()) {
  if (!est || !est.ultima) return `más de ${DIAS_BUSQUEDA} d`;
  const ms = ahora - est.ultima;
  const dias = Math.floor(ms / 86400000);
  return dias >= 1 ? `${dias} d` : `${Math.floor(ms / 3600000)} h`;
}

/**
 * Lluvia del día hora por hora.
 * → { horas: [24 números] | [], ultimo: {fecha, valor, hora} | null, lecturas }
 *   'horas' vacío cuando no hay lecturas, para que el gráfico diga "sin
 *   datos" en vez de dibujar 24 ceros.
 */
export async function lluviaPorHora(stationId, tipo, fecha, token) {
  try {
    const res = await pedirDia(stationId, fecha, token);
    if (!res || !res.lecturas.length) return { horas: [], ultimo: null, lecturas: 0 };

    const horas = new Array(24).fill(0);
    let ultimo = null;

    for (const x of res.lecturas) {
      if (x.v <= 0) continue;
      horas[x.t.getHours()] += x.v;
      ultimo = { fecha: x.t, valor: x.v, hora: x.t.getHours() };
    }
    return { horas, ultimo, lecturas: res.lecturas.length };
  } catch (e) {
    return { horas: [], ultimo: null, lecturas: 0 };
  }
}