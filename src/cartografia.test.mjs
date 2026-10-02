import {
  latLngToUTM, lngDeEste, latDeNorte, escalaDeLamina, escalaRedonda,
  pasoCuadricula, barraEscala, numeroLamina, cuadriculaUTM, distanciaMetros, utmALatLng,
  zoomParaEscala, escalaDeZoom, terrenoDeLamina, cabeEnLamina,
  puntoEnPoligono, puntoEnGeometria, cajaDe, enCaja,
} from './cartografia.js';

let mal = 0;
const t = (et, got, esp, tol = 0) => {
  const ok = typeof esp === 'number' ? Math.abs(got - esp) <= tol : JSON.stringify(got) === JSON.stringify(esp);
  if (!ok) { mal++; console.log(`  FALLA ${et}\n     esperaba ${esp}\n     dio      ${got}`); }
  else console.log(`  ok    ${et}  ${typeof got === 'object' ? JSON.stringify(got) : got}`);
};

console.log('─── UTM contra valores del propio Anexo V ───');
// B-1.C, toma "Intercuencas": CANAL MADRE 36+130, zona 17S, N 9041598.28 E 765353.78
// Se invierte: de esa UTM saco lat/lng y vuelvo a proyectar.
// La toma esta en zona 17S, y Viru pisa el limite con la 18: hay que fijarla.
const Z = 17;
const { lat: lat0, lng: lng0 } = utmALatLng(765353.78, 9041598.28, Z, true);
const ida = latLngToUTM(lat0, lng0, Z);
t('ida y vuelta del este  (m)',  ida.este,  765353.78, 0.05);
t('ida y vuelta del norte (m)',  ida.norte, 9041598.28, 0.05);
t('zona', ida.zona, 17);
t('hemisferio', ida.hemisferio, 'S');

console.log('\n─── UTM contra un punto conocido: el meridiano central ───');
// En el meridiano central de la zona 17 (lng -81) el este debe ser 500000 exacto
t('este en el meridiano central', latLngToUTM(-8.4, -81).este, 500000, 0.001);
// En el ecuador y meridiano central, el norte es 0 (hemisferio norte)
t('norte en el ecuador', latLngToUTM(0, -81).norte, 0, 0.001);

console.log('\n─── Escala ───');
// 50 km de terreno en 800 mm de papel => 1:62500
t('50 km en 800 mm', Math.round(escalaDeLamina(50000, 800)), 62500);
t('se redondea al catalogo', escalaRedonda(62500), 75000);
t('escala invalida da null', escalaDeLamina(0, 800), null);

console.log('\n─── Paso de cuadricula: entre 3 y 7 lineas ───');
for (const ext of [800, 4000, 30000, 120000, 600000]) {
  const p = pasoCuadricula(ext);
  const n = ext / p;
  const ok = n <= 7;
  if (!ok) mal++;
  console.log(`  ${ok ? 'ok   ' : 'FALLA'} ${String(ext).padStart(7)} m -> paso ${String(p).padStart(6)} m = ${n.toFixed(1)} lineas`);
}

console.log('\n─── Barra de escala ───');
const b = barraEscala(100000, 79);
t('cabe en el papel (mm)', b.anchoMm <= 79, true);
t('rotulos en km', b.unidad, 'Kilómetros');
t('empieza en cero', b.cortes[0], 0);
t('cinco cortes', b.cortes.length, 5);
// A 1:1000 y 79 mm, 79 m de terreno -> debe elegir metros, no kilometros
t('a escala chica usa metros', barraEscala(1000, 79).unidad, 'Metros');

console.log('\n─── Numero de lamina ───');
t('con sub-sector', numeroLamina({ anio: 2025, subSector: 1 }), 'JURP-INV2025-SHMn-SSI-01');
t('sub-sector V',   numeroLamina({ anio: 2025, subSector: 5, correlativo: 3 }), 'JURP-INV2025-SHMn-SSV-03');
t('lamina general', numeroLamina({ anio: 2025, correlativo: 1 }), 'JURP-INV2025-SHMn-01');
t('correlativo de dos digitos', numeroLamina({ anio: 2026, subSector: 2, correlativo: 12 }), 'JURP-INV2026-SHMn-SSII-12');

console.log('\n─── Cuadricula sobre un encuadre real (Viru) ───');
const lim = { norte: -8.30, sur: -8.55, este: -78.60, oeste: -78.90 };
// aPixel simula Leaflet: proyeccion lineal sobre un area de 1572x950
const aPixel = (lat, lng) => ({
  x: ((lng - lim.oeste) / (lim.este - lim.oeste)) * 1572,
  y: ((lim.norte - lat) / (lim.norte - lim.sur)) * 950,
});
const g = cuadriculaUTM(lim, aPixel);
console.log(`  paso E ${g.pasoE} m, paso N ${g.pasoN} m, zona ${g.zona}`);
console.log(`  ${g.verticales.length} verticales, ${g.horizontales.length} horizontales`);
t('todas las verticales caen dentro del area',
  g.verticales.every(v => v.puntos.every(p => p.x >= -1 && p.x <= 1573)), true);
t('todas las horizontales caen dentro',
  g.horizontales.every(v => v.puntos.every(p => p.y >= -1 && p.y <= 951)), true);
t('los valores son multiplos del paso',
  g.verticales.every(v => v.valor % g.pasoE === 0), true);
t('van en orden', g.verticales.every((v,i,a) => i === 0 || v.x > a[i-1].x), true);

console.log('\n─── Curvatura de la cuadricula (lo que se corregiria mal con lineas rectas) ───');
for (const l of [g.verticales[2], g.horizontales[2]]) {
  const xs = l.puntos.map(p => p.x), ys = l.puntos.map(p => p.y);
  const desvX = Math.max(...xs) - Math.min(...xs);
  const desvY = Math.max(...ys) - Math.min(...ys);
  const esVertical = l.puntos[0].x !== undefined && desvY > desvX;
  console.log(`  linea ${l.valor}: se desvia ${(esVertical ? desvX : desvY).toFixed(2)} px de la recta`);
}

console.log('\n─── Escala fija: de 1:10 000 al zoom del mapa ───');
// El area de mapa de la lamina A1: 821 x 462 mm de papel, dibujada en 1642 px.
const AREA = { anchoMm: 821, altoMm: 462, anchoPx: 1642 };
const LAT_VIRU = -8.42;
const z10k = zoomParaEscala({ escala: 10000, lat: LAT_VIRU, anchoPx: AREA.anchoPx, anchoMm: AREA.anchoMm });
console.log(`  zoom para 1:10 000 en Viru: ${z10k.toFixed(4)}`);
t('y de vuelta da la misma escala',
  escalaDeZoom({ zoom: z10k, lat: LAT_VIRU, anchoPx: AREA.anchoPx, anchoMm: AREA.anchoMm }), 10000, 0.5);
t('1:25 000 exige alejarse justo un zoom menos un poco',
  zoomParaEscala({ escala: 25000, lat: LAT_VIRU, anchoPx: AREA.anchoPx, anchoMm: AREA.anchoMm }) < z10k, true);
// La latitud importa: el mismo zoom NO es la misma escala lejos del ecuador.
const zEcuador = zoomParaEscala({ escala: 10000, lat: 0, anchoPx: AREA.anchoPx, anchoMm: AREA.anchoMm });
t('en el ecuador el zoom para 1:10 000 es otro', Math.abs(zEcuador - z10k) > 0.015, true);
t('ignorar la latitud desviaria la escala (%)',
  Math.abs(escalaDeZoom({ zoom: zEcuador, lat: LAT_VIRU, anchoPx: AREA.anchoPx, anchoMm: AREA.anchoMm }) / 10000 - 1) * 100,
  1.08, 0.2);

console.log('\n─── Cuanto terreno entra en la lamina ───');
t('ancho a 1:10 000 (km)', terrenoDeLamina(10000, AREA.anchoMm) / 1000, 8.21, 0.01);
t('alto  a 1:10 000 (km)', terrenoDeLamina(10000, AREA.altoMm) / 1000, 4.62, 0.01);
const cabe = (largoKm) => cabeEnLamina({ escala: 10000, anchoMm: AREA.anchoMm, altoMm: AREA.altoMm,
  anchoMetros: largoKm * 1000, altoMetros: 500 });
t('el Tramo III (7.0 km) entra', cabe(7.0).cabe, true);
t('el Tramo V (8.4 km) no entra', cabe(8.4).cabe, false);
t('y dice cuanto sobra (m)', Math.round(cabe(8.4).sobraAncho), 190, 2);

console.log('\n─── Punto en poligono: a que sector pertenece un activo ───');
// Un cuadrado de 1 grado con un hueco en el medio.
const CUADRADO = [[[0,0],[4,0],[4,4],[0,4],[0,0]], [[1,1],[2,1],[2,2],[1,2],[1,1]]];
t('dentro', puntoEnPoligono([3, 3], CUADRADO), true);
t('fuera', puntoEnPoligono([5, 3], CUADRADO), false);
t('dentro del hueco cuenta como fuera', puntoEnPoligono([1.5, 1.5], CUADRADO), true === false);
// Los vertices y los bordes son el caso que rompe las implementaciones ingenuas:
// un vertice a la altura exacta del rayo se cuenta dos veces y da "fuera".
t('un punto a la altura de un vertice no se cuenta dos veces',
  puntoEnPoligono([3, 4 - 1e-9], CUADRADO), true);
t('justo al oeste del poligono', puntoEnPoligono([-0.001, 2], CUADRADO), false);

const MULTI = { type: 'MultiPolygon', coordinates: [
  [[[0,0],[1,0],[1,1],[0,1],[0,0]]],
  [[[5,5],[6,5],[6,6],[5,6],[5,5]]],
]};
t('MultiPolygon: en la primera parte', puntoEnGeometria([0.5, 0.5], MULTI), true);
t('MultiPolygon: en la segunda parte', puntoEnGeometria([5.5, 5.5], MULTI), true);
t('MultiPolygon: entre las dos', puntoEnGeometria([3, 3], MULTI), false);

const caja = cajaDe(MULTI);
t('la caja envolvente abarca las dos partes', JSON.stringify(caja),
  JSON.stringify({ oeste: 0, este: 6, sur: 0, norte: 6 }));
t('la caja descarta lo lejano', enCaja([10, 10], caja), false);
t('y no descarta lo que si puede estar', enCaja([5.5, 5.5], caja), true);

console.log('\n─── Distancia ───');
// Un grado de latitud ~ 110.6 km
t('un grado de latitud (km)', distanciaMetros([-8,-78],[-9,-78])/1000, 110.6, 0.6);

console.log(mal ? `\n${mal} FALLA(S)` : '\nTODAS PASAN');
process.exit(mal ? 1 : 0);
