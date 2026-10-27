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

// ══════════ LA PESTAÑA DE VULNERABILIDADES ══════════
const pestanas = await p.locator('.tbl-page-body button').allInnerTexts();
ok(pestanas.join('|').includes('Vulnerabilidades (4)'),
   'la pestaña sale con su cuenta', pestanas.join(' | ').slice(0, 90));

await p.locator('button:has-text("Vulnerabilidades")').click();
await p.waitForTimeout(400);

const filas = p.locator('.tbl-page-body table tbody tr');
ok(await filas.count() === 4, 'se listan las cuatro', `${await filas.count()}`);

/* LO QUE MAS IMPORTA DE ESTA PESTAÑA: no tienen estado, se registran y no
 * se cierran. Así que lo único que separa lo urgente de lo demás es la
 * prioridad, y si la lista llega desordenada hay que leerla entera. */
const prioridades = await filas.locator('td:nth-child(1)').allInnerTexts();
ok(prioridades.map(x => x.trim()).join(',') === 'ALTA,ALTA,MEDIA,BAJA',
   'las ALTA primero, aunque lleguen al final',
   prioridades.map(x => x.trim()).join(','));

const primera = await filas.first().innerText();
ok(/Candado forzado/.test(primera),
   'y entre las ALTA, la más reciente arriba',
   primera.replace(/\n/g, ' ').slice(0, 70));

/* Los KPI son por prioridad y no un total: seis vulnerabilidades son pocas
 * o muchas según cuántas sean ALTA. */
const tarjetas = await p.locator('.tbl-page-body > div:last-of-type > div:first-child').innerText();
ok(/ALTA[\s\S]*2/i.test(tarjetas), 'el resumen cuenta las ALTA',
   tarjetas.replace(/\n/g, ' ').slice(0, 80));

const lejana = await filas.nth(0).innerText();
ok(/870/.test(lejana), 'se ve a qué distancia de la garita quedó',
   lejana.replace(/\n/g, ' ').slice(0, 110));
ok(/asignado a Garita 1/.test(lejana),
   'y que fue lejos de su puesto, que es lo que explica la distancia',
   lejana.replace(/\n/g, ' ').slice(0, 110));

ok(await filas.nth(0).locator('img').count() === 3,
   'las evidencias se ven, hasta tres');
ok(/\+1/.test(lejana), 'y se dice cuántas quedan fuera',
   lejana.replace(/\n/g, ' ').slice(0, 110));

const sinFoto = await filas.nth(1).innerText();
ok(/—/.test(sinFoto), 'cuando no hay evidencias se dice, no se deja en blanco');

ok(errs.length === 0, 'sin errores de JavaScript', errs.join(' | ').slice(0, 200));

await b.close();
const malos = r.filter(x => !x).length;
console.log(`\n${r.length - malos} de ${r.length} en orden${malos ? `, ${malos} MAL` : ''}.`);
process.exit(malos ? 1 : 0);
