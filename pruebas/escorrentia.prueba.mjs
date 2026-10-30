/* ¿El agua baja por donde tiene que bajar?
 *
 *     node pruebas/escorrentia.prueba.mjs
 *
 * Prueba src/escorrentia.js con un relieve sintético, sin red: un valle que
 * baja hacia el oeste hasta el mar, con un cauce en el centro, un hoyo falso
 * a mitad de camino (como los que tiene el SRTM) y un canal que corre de
 * norte a sur. Lo que se comprueba es lo que el operario va a leer:
 *
 *   - que el recorrido termine en el mar y no se quede en el hoyo
 *   - que vaya siempre cuesta abajo o en llano, nunca subiendo
 *   - que el cruce con el canal salga, y a la distancia correcta
 *   - que en una meseta cerrada diga "se estanca" en vez de inventar cauce
 */
import {
  crearRelieve, trazarFlujo, prepararCapas, cruces, destino,
  aPixel, aLngLat, metrosPixel, ZOOM_DEM,
} from '../src/escorrentia.js';

let mal = 0, bien = 0;
const ok = (c, msg) => { if (c) { bien++; } else { mal++; console.log('FALLA:', msg); } };

const LNG0 = -78.70, LAT0 = -8.45;
const [PX0, PY0] = aPixel(LNG0, LAT0);
const mpp = metrosPixel(LAT0);

// Relieve: sube 6 m por cada 100 m hacia el este; valle en V centrado en
// la latitud de la estación; mar (cota < 0) a 10 km al oeste.
function cotaSintetica(px, py) {
  const xm = (px - PX0) * mpp, ym = (py - PY0) * mpp;
  if (xm < -10000) return -5;
  let e = 600 + xm * 0.06 + Math.abs(ym) * 0.04;
  // Hoyo falso de ~150 m de diámetro a 4 km al oeste, 3 m de hondo.
  const d = Math.hypot(xm + 4000, ym);
  if (d < 75) e -= 3 * (1 - d / 75) + 1.2;
  return e;
}
const relieve = crearRelieve((tx, ty) => {
  const t = new Float32Array(256 * 256);
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) t[y * 256 + x] = cotaSintetica(tx * 256 + x, ty * 256 + y);
  return t;
});

// Estación en el cauce, 2 km al este.
const [elng, elat] = aLngLat(PX0 + 2000 / mpp, PY0);
const r = await trazarFlujo(relieve, elng, elat);

ok(r.fin === 'mar', `debía llegar al mar y terminó en "${r.fin}"`);
ok(r.km > 11 && r.km < 14, `distancia al mar ~12 km, salió ${r.km.toFixed(2)}`);
ok(r.coords[0][0] === elng && r.coords[0][1] === elat, 'el recorrido debe empezar en la estación');
let sube = 0;
for (let i = 1; i < r.cotas.length; i++) if (r.cotas[i] > r.cotas[i - 1] + 1e-6) sube++;
ok(sube === 0, `el agua subió ${sube} veces`);
const oeste = r.coords[r.coords.length - 1][0] < elng;
ok(oeste, 'debía terminar al oeste de la estación');

// Canal norte-sur a 3 km al oeste de la estación (1 km al este del origen).
const [clng] = aLngLat(PX0 + 1000 / mpp, PY0);
const canal = {
  nombre: 'Canal Madre', color: '#35B6E9',
  data: { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: [[clng, LAT0 - 0.2], [clng, LAT0 + 0.2]] } }] },
};
const camino = {
  nombre: 'Caminos Servicio', color: '#e67700',
  data: { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: [[elng - 0.005, LAT0 - 0.2], [elng - 0.005, LAT0 + 0.2]] } }] },
};
const cx = cruces(r.coords, prepararCapas([canal, camino]));
ok(cx.length === 2, `debían salir 2 cruces, salieron ${cx.length}`);
ok(cx[0]?.capa === 'Caminos Servicio', 'el camino está antes que el canal');
const canalCruce = cx.find(c => c.capa === 'Canal Madre');
ok(canalCruce && Math.abs(canalCruce.km - 1.0) < 0.15, `cruce del canal a ~1 km, salió ${canalCruce?.km?.toFixed(2)}`);
const frase = destino({ ...r, cruces: cx });
ok(/entra al Canal Madre a 1\.0 km/.test(frase), `frase de destino: "${frase}"`);

// Meseta cerrada: plano rodeado de bordes más altos → debe estancarse.
const plano = crearRelieve((tx, ty) => {
  const t = new Float32Array(256 * 256);
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    const xm = (tx * 256 + x - PX0) * mpp, ym = (ty * 256 + y - PY0) * mpp;
    t[y * 256 + x] = Math.hypot(xm, ym) < 3000 ? 100 : 200;
  }
  return t;
});
const rp = await trazarFlujo(plano, LNG0, LAT0);
ok(rp.fin === 'estanca', `en meseta cerrada debía estancarse, terminó en "${rp.fin}"`);
ok(/se estanca/.test(destino(rp)), 'la frase debe decir que se estanca');

// Sin relieve (tesela que no carga).
const vacio = crearRelieve(() => null);
const rv = await trazarFlujo(vacio, LNG0, LAT0);
ok(rv.fin === 'sin_relieve', 'sin tesela debe decir sin relieve');

console.log(`zoom ${ZOOM_DEM}, ${mpp.toFixed(1)} m/píxel · recorrido ${r.km.toFixed(2)} km, ${r.coords.length} puntos, ${relieve.teselas()} teselas`);
console.log(mal ? `${mal} fallas, ${bien} bien` : `todo bien (${bien} comprobaciones)`);
process.exit(mal ? 1 : 0);
