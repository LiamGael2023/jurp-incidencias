/**
 * Lluvia de una estación, leída del endpoint filtered-data de JURP.
 *
 * Pluviómetros y estaciones Davis no guardan la lluvia igual:
 *
 *   pluviómetro   → metric 'rainfall_mm': cada lectura es lo que cayó en ese
 *                   intervalo. El total del día es la suma.
 *   estación Davis → metric 'rainfall_mm_per_day': WeatherLink v1 solo entrega
 *                   el ACUMULADO DEL DÍA en cada snapshot ('rainfall_mm' viene
 *                   vacío). El total del día es el último valor, y lo que cayó
 *                   en una hora es la diferencia entre acumulados.
 *
 * Con Davis no se usa 'total_precipitation': el servidor suma todos los
 * acumulados y el resultado sale multiplicado por el número de lecturas.
 *
 * Si la estación no tiene ninguna lectura en el día se marca 'sinDatos':
 * "0 mm" y "no hay dato" no son lo mismo y el mapa no debe confundirlos.
 */

export const fmtFecha = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Acepta el tipo del mapa ('davis') y el del backend ('estacion_davis').
export const esDavis = (tipo) => tipo === 'davis' || tipo === 'estacion_davis';

export const metricaLluvia = (tipo) => (esDavis(tipo) ? 'rainfall_mm_per_day' : 'rainfall_mm');

// Coordenadas 0,0 = estación sin ubicar en el backend (caería frente a África).
export const sinUbicacion = (lat, lng) =>
  !Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0);

async function pedirDia(stationId, tipo, fecha, token) {
  const f = fmtFecha(fecha);
  const url = `/api/v1/mobile/davis/rain-gauges/filtered-data/?start_date=${f}&end_date=${f}`
    + `&station_id=${stationId}&metric=${metricaLluvia(tipo)}&max_points=9000`;
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
 */
export async function lluviaDelDia(stationId, tipo, fecha, token) {
  try {
    const res = await pedirDia(stationId, tipo, fecha, token);
    if (!res) return { mm: 0, lecturas: 0, sinDatos: true };
    const { json, lecturas } = res;
    const n = typeof json.stats?.count === 'number' ? json.stats.count : lecturas.length;
    if (!n) return { mm: 0, lecturas: 0, sinDatos: true };

    let mm;
    if (esDavis(tipo)) {
      // El acumulado solo sube durante el día: el máximo es el total.
      mm = lecturas.reduce((m, x) => Math.max(m, x.v), 0);
    } else if (typeof json.total_precipitation === 'number') {
      mm = json.total_precipitation;
    } else {
      mm = lecturas.reduce((a, x) => a + x.v, 0);
    }
    return { mm, lecturas: n, sinDatos: false };
  } catch (e) {
    return { mm: 0, lecturas: 0, sinDatos: true };
  }
}

/**
 * Lluvia del día hora por hora.
 * → { horas: [24 números] | [], ultimo: {fecha, valor, hora} | null, lecturas }
 *   'horas' vacío cuando no hay lecturas, para que el gráfico diga "sin datos"
 *   en vez de dibujar 24 ceros.
 */
export async function lluviaPorHora(stationId, tipo, fecha, token) {
  try {
    const res = await pedirDia(stationId, tipo, fecha, token);
    if (!res || !res.lecturas.length) return { horas: [], ultimo: null, lecturas: 0 };

    const horas = new Array(24).fill(0);
    let ultimo = null;
    let previo = 0;   // acumulado anterior (solo Davis)

    for (const x of res.lecturas) {
      let cayo;
      if (esDavis(tipo)) {
        // Diferencia con el acumulado anterior. Si baja, la consola reinició
        // el contador: lo leído es lo caído desde el reinicio.
        cayo = x.v >= previo ? x.v - previo : x.v;
        previo = x.v;
      } else {
        cayo = x.v;
      }
      if (cayo <= 0) continue;
      horas[x.t.getHours()] += cayo;
      ultimo = { fecha: x.t, valor: cayo, hora: x.t.getHours() };
    }
    return { horas, ultimo, lecturas: res.lecturas.length };
  } catch (e) {
    return { horas: [], ultimo: null, lecturas: 0 };
  }
}
