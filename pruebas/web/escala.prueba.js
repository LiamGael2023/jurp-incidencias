import { zoomParaEscala, escalaDeZoom, terrenoDeLamina, cabeEnLamina, barraEscala,
  pasoCuadricula } from '../../src/cartografia';

const r = [];
const ok = (c, m, e) => r.push({ ok: !!c, m, e: e === undefined ? '' : String(e) });

// El papel de la lámina, igual que en MapaTematico.jsx
const ANCHO_MM = 841 - 20;          // 821
const ALTO_MM = 594 - 20 - 112;     // 462
const PX_MM = 2;
const LAT = -8.42;
// El catálogo entero, incluidas las de detalle que pidió la Junta.
const ESCALAS = [200, 500, 1000, 2000, 2500, 5000, 10000, 20000, 25000];

// Lo que cabe en el papel a cada escala
ok(Math.abs(terrenoDeLamina(10000, ANCHO_MM) - 8210) < 1,
   '1:10.000 → 8,21 km de largo', terrenoDeLamina(10000, ANCHO_MM));
ok(Math.abs(terrenoDeLamina(1000, ANCHO_MM) - 821) < 1,
   '1:1.000 → 821 m', terrenoDeLamina(1000, ANCHO_MM));
ok(Math.abs(terrenoDeLamina(2000, ANCHO_MM) - 1642) < 1, '1:2.000 → 1,64 km');

// El zoom que pide cada escala, y la vuelta
for (const e of ESCALAS) {
  const z = zoomParaEscala({ escala: e, lat: LAT, anchoPx: ANCHO_MM * PX_MM, anchoMm: ANCHO_MM });
  const vuelta = escalaDeZoom({ zoom: z, lat: LAT, anchoPx: ANCHO_MM * PX_MM, anchoMm: ANCHO_MM });
  ok(Math.abs(vuelta - e) / e < 0.001,
     `1:${e.toLocaleString('es-PE')} → zoom ${z.toFixed(2)} y vuelve a 1:${Math.round(vuelta)}`);
}

// Más cerca = más zoom, siempre
const zooms = ESCALAS.map(e =>
  zoomParaEscala({ escala: e, lat: LAT, anchoPx: ANCHO_MM * PX_MM, anchoMm: ANCHO_MM }));
ok(zooms.every((z, i) => i === 0 || z < zooms[i - 1]),
   'cuanto más abierta la escala, menos zoom', zooms.map(z => z.toFixed(1)).join(' > '));
ok(zooms[0] > zooms[zooms.length - 1], '1:1.000 pide más zoom que 1:25.000',
   `${zooms[0].toFixed(2)} vs ${zooms[zooms.length - 1].toFixed(2)}`);

// Cuántas láminas hacen falta para el tramo de la pantalla (5,39 km)
const TRAMO = 5390;
const laminas = (e) => {
  const c = cabeEnLamina({ escala: e, anchoMm: ANCHO_MM, altoMm: ALTO_MM,
    anchoMetros: TRAMO, altoMetros: 500 });
  return c.cabe ? 1 : Math.ceil(TRAMO / c.capAncho);
};
ok(laminas(10000) === 1, '5,39 km entran en UNA lámina a 1:10.000', laminas(10000));
ok(laminas(5000) === 2, 'y en dos a 1:5.000', laminas(5000));
ok(laminas(2000) === 4, 'cuatro a 1:2.000', laminas(2000));
ok(laminas(1000) === 7, 'siete a 1:1.000', laminas(1000));

// La barra gráfica se adapta
const b10 = barraEscala(10000, 60), b1 = barraEscala(1000, 60);
ok(b10.total === 500 && b10.unidad === 'Metros',
   'barra a 1:10.000: 500 m', `${b10.total} ${b10.unidad}`);
ok(b1.total < b10.total, 'y a 1:1.000 abarca menos', `${b1.total} ${b1.unidad}`);
ok(Math.abs(b1.anchoMm - (b1.total / 1000) * 1000) < 0.01,
   'la barra mide en el papel lo que dice su escala', b1.anchoMm.toFixed(1) + ' mm');

// A escalas cerradas se pasa del maxNativeZoom del satélite
const zoom1k = zoomParaEscala({ escala: 1000, lat: LAT, anchoPx: ANCHO_MM * PX_MM, anchoMm: ANCHO_MM });
ok(zoom1k > 17, '1:1.000 se pasa del zoom nativo de las capas de 17 (saldrá borrosa)',
   zoom1k.toFixed(2));
const zoom10k = zoomParaEscala({ escala: 10000, lat: LAT, anchoPx: ANCHO_MM * PX_MM, anchoMm: ANCHO_MM });
ok(zoom10k < 17, '1:10.000 no', zoom10k.toFixed(2));

window.__r = r;

// ── La capa base y la escala tienen que hablarse ──────────────────────────
import { CAPAS_BASE, puedeExportar, alternativaExportable } from '../../src/capasBase';

const zoomDe = (e) => zoomParaEscala({ escala: e, lat: LAT,
  anchoPx: ANCHO_MM * PX_MM, anchoMm: ANCHO_MM });

// El aviso se dispara por la ESCALA, no por el maxNativeZoom declarado: ese
// es una promesa global y sobre el valle los proveedores se quedan antes.
const ofrece = (e, capa) => e <= 5000 && puedeExportar(capa);

ok(!ofrece(10000, 'esri'), 'a 1:10.000 con ESRI no se ofrece cambiar');
ok(ofrece(5000, 'esri'), 'a 1:5.000 sí, que es donde empieza a quedarse corto');
ok(ofrece(2000, 'esri') && ofrece(1000, 'esri'), 'y más cerca también');
ok(!ofrece(1000, 'satelite'), 'pero estando ya en Google no se ofrece Google');

ok(puedeExportar('esri') && !puedeExportar('satelite'),
   'ESRI exporta y Google no: ese es el precio de la foto');
ok(alternativaExportable('satelite') === 'esri',
   'y la vuelta desde Google lleva a ESRI, del mismo grupo',
   alternativaExportable('satelite'));

// ── Las escalas de detalle: 1:200 y 1:500 ────────────────────────────────
// Las pidió la Junta para ver una estructura o un empalme. Se comprueban
// aparte porque son las que rompen los supuestos del resto de la pantalla.

ok(Math.abs(terrenoDeLamina(200, ANCHO_MM) - 164.2) < 0.5,
   '1:200 → 164 m de lámina: una estructura y su entorno',
   terrenoDeLamina(200, ANCHO_MM).toFixed(1));
ok(Math.abs(terrenoDeLamina(500, ANCHO_MM) - 410.5) < 0.5,
   '1:500 → 410 m', terrenoDeLamina(500, ANCHO_MM).toFixed(1));

// LA CUADRÍCULA ES LO QUE SE ROMPÍA. Con la tabla de pasos empezando en 100 m,
// a 1:200 la lámina (164 × 92 m) daba una vertical y CERO horizontales.
const lineas = (escala) => {
  const ancho = terrenoDeLamina(escala, ANCHO_MM);
  const alto = terrenoDeLamina(escala, ALTO_MM);
  return { v: Math.floor(ancho / pasoCuadricula(ancho)),
           h: Math.floor(alto / pasoCuadricula(alto)),
           paso: pasoCuadricula(ancho) };
};
for (const e of ESCALAS) {
  const l = lineas(e);
  ok(l.v >= 3 && l.h >= 2,
     `1:${e.toLocaleString('es-PE')}: cuadrícula legible (paso ${l.paso} m)`,
     `${l.v} verticales × ${l.h} horizontales`);
}
ok(pasoCuadricula(164.2) === 25, 'a 1:200 el paso baja a 25 m', pasoCuadricula(164.2));
// Los pasos cortos nuevos NO deben tocar las láminas de siempre: para que uno
// de 5/10/25/50 m salga elegido, la lámina tiene que medir menos de 350 m.
ok(pasoCuadricula(8210) === 2500 && pasoCuadricula(4105) === 1000
   && pasoCuadricula(821) === 250 && pasoCuadricula(20525) === 5000,
   'y de 1:1.000 para arriba el paso es el mismo de antes',
   [821, 4105, 8210, 20525].map(x => `${x}m→${pasoCuadricula(x)}`).join(' '));

// La barra gráfica tiene que seguir dando números redondos, no 3,28 m.
for (const e of [200, 500]) {
  const b = barraEscala(e, 60);
  ok(b.total > 0 && Number.isInteger(b.total) && b.anchoMm > 10,
     `barra a 1:${e}: ${b.total} ${b.unidad} en ${b.anchoMm.toFixed(0)} mm`);
}

// El zoom que piden, contra lo que las capas tienen de verdad.
const ESTIRA = (e, capa) => {
  const z = zoomDe(e), n = CAPAS_BASE[capa].maxNativeZoom;
  return z <= n ? 1 : Math.pow(2, z - n);
};
ok(zoomDe(200) < CAPAS_BASE.satelite.maxZoom,
   '1:200 cabe en el maxZoom de Google: la lámina se puede dibujar',
   `zoom ${zoomDe(200).toFixed(2)} < ${CAPAS_BASE.satelite.maxZoom}`);
ok(ESTIRA(500, 'satelite') === 1,
   'a 1:500 Google todavía tiene tesela propia: foto nítida');
ok(ESTIRA(200, 'satelite') > 1 && ESTIRA(200, 'satelite') < 2,
   'a 1:200 ya no, y se amplía menos del doble — suave, no ilegible',
   '×' + ESTIRA(200, 'satelite').toFixed(2));
ok(ESTIRA(200, 'esri') > ESTIRA(200, 'satelite'),
   'ESRI se queda un paso antes que Google, por eso se ofrece el cambio',
   `esri ×${ESTIRA(200, 'esri').toFixed(2)} vs google ×${ESTIRA(200, 'satelite').toFixed(2)}`);
