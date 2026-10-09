import { zoomParaEscala, escalaDeZoom, terrenoDeLamina, cabeEnLamina, barraEscala }
  from '../../src/cartografia';

const r = [];
const ok = (c, m, e) => r.push({ ok: !!c, m, e: e === undefined ? '' : String(e) });

// El papel de la lámina, igual que en MapaTematico.jsx
const ANCHO_MM = 841 - 20;          // 821
const ALTO_MM = 594 - 20 - 112;     // 462
const PX_MM = 2;
const LAT = -8.42;
const ESCALAS = [1000, 2000, 2500, 5000, 10000, 20000, 25000];

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
