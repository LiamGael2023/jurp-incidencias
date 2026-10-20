/* Los sectores, pintados en un mapa de verdad.
 *
 *     npx vite --port 5199 --strictPort &
 *     node pruebas/web/sectores.prueba.mjs
 *
 * El reparto de colores se comprueba sin navegador en pruebas/sectores.prueba.mjs.
 * Lo que solo se puede ver aqui es lo otro: que el rotulo aparezca cuando el
 * sector tiene sitio y se vaya cuando no.
 *
 * Primero puse un zoom fijo para eso y estaba mal por partida doble: con
 * cinco sectores que ocupan el valle entero, a la escala en que uno mira el
 * valle no salia ninguno; y un numero de zoom no sabe cuantos sectores hay ni
 * como de grandes son. Medir el tamano en pantalla se ajusta solo.
 */
import pw from '/opt/node-tools/node_modules/playwright-core/index.js';

const BASE = 'http://localhost:5199/pruebas/web/sectores.html';
const r = [];
const ok = (c, m, e) => { r.push(!!c); console.log(`${c ? 'ok  ' : 'MAL '} ${m}${e ? `   [${e}]` : ''}`); };

const b = await pw.chromium.launch();
const p = await b.newPage({ viewport: { width: 1000, height: 700 } });
const errs = [];
p.on('pageerror', e => errs.push(String(e)));

const ver = async (z) => {
  await p.goto(`${BASE}?z=${z}`, { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('.inv-eti-sector', { timeout: 10000 });
  await p.waitForTimeout(600);
  return p.evaluate(() => {
    const et = [...document.querySelectorAll('.inv-eti-sector')];
    const visibles = et.filter(e => Number(getComputedStyle(e).opacity) > .5);
    const trazos = [...document.querySelectorAll('.leaflet-overlay-pane path')]
      .map(e => e.getAttribute('stroke'));
    return {
      total: et.length,
      visibles: visibles.length,
      nombres: visibles.map(e => e.textContent),
      colores: trazos,
    };
  });
};

// ── los colores ──
const z12 = await ver(12);
ok(z12.total === 6, 'se dibujan los seis sectores', `${z12.total}`);
ok(new Set(z12.colores).size >= 3, 'con varios colores, no uno solo',
   [...new Set(z12.colores)].join(' '));
ok(!z12.colores.includes('#aec14a'),
   'ninguno conserva el verde único de la capa', z12.colores.join(' '));

// Los que se tocan, distintos. La malla es 3x2: 0-1-2 abajo, 3-4-5 arriba.
const VECINOS = [[0, 1], [1, 2], [3, 4], [4, 5], [0, 3], [1, 4], [2, 5]];
const choques = VECINOS.filter(([i, j]) => z12.colores[i] === z12.colores[j]);
ok(choques.length === 0, 'dos sectores que se tocan nunca repiten color',
   choques.map(([i, j]) => `${i}↔${j}`).join(' '));

// Y los que no se tocan, que reutilicen: cuatro colores no dan para mas.
ok(new Set(z12.colores).size <= 4, 'no se inventa colores fuera de la paleta',
   `${new Set(z12.colores).size}`);

// ── los rótulos ──
ok(z12.nombres.length === 6, 'de cerca se ven todos los nombres',
   z12.nombres.join(' | '));
ok(z12.nombres.includes('Chao Norte'), 'y dicen el nombre del sector');

const z6 = await ver(6);
ok(z6.visibles === 0, 'de lejos no sale ninguno: se pisarian', `${z6.visibles}`);

// El umbral no es un numero de zoom sino el sitio en pantalla, asi que tiene
// que haber un punto donde cambia. Si no lo hubiera, la regla no se aplica.
const cuentas = [];
for (const z of [6, 8, 9, 10, 12]) cuentas.push((await ver(z)).visibles);
ok(cuentas[0] === 0 && cuentas[cuentas.length - 1] === 6,
   'aparecen al acercarse y se van al alejarse', cuentas.join(' → '));
ok(cuentas.every((v, i) => i === 0 || v >= cuentas[i - 1]),
   'y nunca al reves: mas zoom, nunca menos rotulos', cuentas.join(' → '));

ok(errs.length === 0, 'sin errores de JavaScript', errs.join(' | ').slice(0, 150));

await b.close();
const mal = r.filter(x => !x).length;
console.log(`\n${r.length - mal} de ${r.length} en orden${mal ? `, ${mal} MAL` : ''}.`);
process.exit(mal ? 1 : 0);
