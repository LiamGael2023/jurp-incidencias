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

/**
 * Total de un día.
 * → { mm, lecturas, sinDatos }
 *
 * 'sinDatos' distingue "la estación no reportó" de "reportó y no llovió":
 * mostrar 0 mm en el primer caso afirmaría algo que no se sabe.
 */
export async function lluviaDelDia(stationId, tipo, fecha, token) {
  try {
    const res = await pedirDia(stationId, fecha, token);
    if (!res) return { mm: 0, lecturas: 0, sinDatos: true };

    const { json, lecturas } = res;
    const n = typeof json.stats?.count === 'number' ? json.stats.count : lecturas.length;
    if (!n) return { mm: 0, lecturas: 0, sinDatos: true };

    const mm = typeof json.total_precipitation === 'number'
      ? json.total_precipitation
      : lecturas.reduce((a, x) => a + x.v, 0);

    return { mm, lecturas: n, sinDatos: false };
  } catch (e) {
    return { mm: 0, lecturas: 0, sinDatos: true };
  }
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