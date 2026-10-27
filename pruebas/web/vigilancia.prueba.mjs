/* Vigilancia no se dibuja debajo del rail.
 *
 *     npx vite --port 5199 --strictPort &
 *     node pruebas/web/vigilancia.prueba.mjs
 *
 * El rail del menú flota encima del contenido: cada bloque le reserva su
 * ancho con --rail-w. La cabecera lo hacía por hoja de estilos y el cuerpo
 * no, porque llevaba `padding: 0` en línea y eso gana. Resultado: las
 * pestañas y las tarjetas quedaban tapadas por el menú.
 *
 * Se mide en el navegador y no en el JSX: el fallo nace de qué regla gana,
 * no de qué pone cada una.
 */
import pw from '/opt/node-tools/node_modules/playwright-core/index.js';

const BASE = 'http://localhost:5199/pruebas/web/vigilancia.html';
const r = [];
const ok = (c, m, e) => { r.push(!!c); console.log(`${c ? 'ok  ' : 'MAL '} ${m}${e ? `   [${e}]` : ''}`); };

const b = await pw.chromium.launch();
const p = await b.newPage({ viewport: { width: 1500, height: 950 } });
const errs = [];
p.on('pageerror', e => errs.push(String(e)));

await p.goto(BASE, { waitUntil: 'domcontentloaded' });
await p.waitForSelector('.tbl-page-wrapper', { timeout: 10000 });
await p.waitForTimeout(600);

const RAIL = 286;   // el valor por defecto de --rail-w

const cab = await p.locator('.tbl-page-header').evaluate(
  el => parseFloat(getComputedStyle(el).paddingLeft));
ok(cab >= RAIL, 'la cabecera le deja sitio al rail', `${cab}px`);

const cuerpo = await p.locator('.tbl-page-body').evaluate(
  el => parseFloat(getComputedStyle(el).paddingLeft));
ok(cuerpo >= RAIL, 'y el cuerpo también, que es donde fallaba',
   `${cuerpo}px — con padding:0 en línea esto daba 0 y el menú tapaba las pestañas`);

/* Lo que de verdad importa: que lo que hay dentro quede a la derecha del
 * menú. El padding podría estar bien y el contenido salirse igual. */
const borde = await p.locator('.tbl-page-body > div').first().evaluate(
  el => el.getBoundingClientRect().left);
ok(borde >= RAIL, 'y lo que se pinta dentro empieza a la derecha del menú',
   `${Math.round(borde)}px`);

ok(errs.length === 0, 'sin errores de JavaScript', errs.join(' | ').slice(0, 200));

await b.close();
const malos = r.filter(x => !x).length;
console.log(`\n${r.length - malos} de ${r.length} en orden${malos ? `, ${malos} MAL` : ''}.`);
process.exit(malos ? 1 : 0);
