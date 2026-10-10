/* Comprueba la Lámina temática montada de verdad en un navegador.
 *
 *     npx vite --port 5199 --strictPort &
 *     node pruebas/web/lamina.prueba.mjs
 *
 * Lo que se mira aquí no se ve leyendo el fichero:
 *
 *   - el membrete lleva SOLO el logo, sin el bloque de texto que repetía lo
 *     que el propio logo ya trae impreso;
 *   - el selector de escala sale agrupado por para qué sirve cada lámina;
 *   - y sobre todo: LO ROTULADO ES LO DIBUJADO. El membrete dice una escala
 *     y el mapa tiene que estar a esa, no a la de antes. Con 1:200 en el
 *     catálogo ese desfase pasó de un factor 2 a uno de 50, así que se
 *     comprueba escala por escala en vez de confiar en que el candado de
 *     zoom hace lo suyo.
 *
 * Las teselas van cortadas a propósito: desde aquí no hay red, y la pantalla
 * tiene que aguantarlo. Una lámina sin fondo sigue siendo una lámina.
 */
import pw from '/opt/node-tools/node_modules/playwright-core/index.js';

const URL = 'http://localhost:5199/pruebas/web/lamina.html';
const ESCALAS = ['200', '500', '1000', '2000', '2500', '5000', '10000', '20000', '25000'];

const r = [];
const ok = (c, m, e) => { r.push(!!c); console.log(`${c ? 'ok  ' : 'MAL '} ${m}${e ? `   [${e}]` : ''}`); };
const n = (s) => Number(String(s).replace(/[.,]/g, ''));

const b = await pw.chromium.launch();
const p = await b.newPage({ viewport: { width: 1700, height: 1100 } });
const errs = [];
p.on('pageerror', e => errs.push(String(e)));
for (const t of ['**://mt1.google.com/**', '**://server.arcgisonline.com/**',
  '**://*.tile.opentopomap.org/**', '**://*.basemaps.cartocdn.com/**',
  '**://*.tile.openstreetmap.org/**'])
  await p.route(t, x => x.abort());

await p.goto(URL, { waitUntil: 'domcontentloaded' });
await p.waitForSelector('.lam-membrete', { timeout: 15000 });
await p.waitForTimeout(2500);

// ── El membrete ──────────────────────────────────────────────────────────
const mem = await p.evaluate(() => ({
  entidad: !!document.querySelector('.lam-entidad'),
  logos: document.querySelectorAll('.lam-logo').length,
  // offsetHeight y NO getBoundingClientRect: la hoja se dibuja a tamaño de
  // papel y se encoge con un `zoom` de CSS para caber en la pantalla, así
  // que el rect devuelve 25 px donde el papel tiene 42. Lo que importa es
  // el papel, que es lo que se imprime.
  alto: document.querySelector('.lam-logo')?.offsetHeight || 0,
  desborda: (() => { const m = document.querySelector('.lam-membrete');
    return m.scrollHeight > m.clientHeight + 1; })(),
}));
ok(!mem.entidad, 'el membrete ya no repite el nombre de la Junta en texto');
ok(mem.logos === 1, 'y lleva el logo, uno solo', mem.logos);
ok(mem.alto >= 35, 'el logo ocupa el sitio que dejó el texto', mem.alto + ' px');
ok(!mem.desborda, 'y el membrete no se desborda por haberlo agrandado');

// ── El selector ──────────────────────────────────────────────────────────
const g = await p.evaluate(() => [...document.querySelectorAll('.lam-panel optgroup')]
  .filter(x => /^1:/.test(x.children[0]?.textContent || ''))
  .map(x => ({ t: x.label, v: [...x.children].map(o => o.value) })));
ok(g.length === 3, 'las escalas salen en tres grupos, no en una lista corrida', g.length);
ok(g[0]?.v.join() === '200,500', 'el primero es el de detalle', g[0]?.v.join(' '));
ok(g.flatMap(x => x.v).join() === ESCALAS.join(),
   'y entre los tres están todas, de más cerca a más lejos');

// ── Lo rotulado es lo dibujado ───────────────────────────────────────────
for (const v of ESCALAS) {
  await p.selectOption('.lam-panel select', v);
  await p.waitForTimeout(700);
  const o = await p.evaluate(() => {
    const m = document.querySelector('.lam-estado').innerText.replace(/\s+/g, ' ');
    return { real: (/escala real 1:([\d.,]+)/.exec(m) || [])[1],
             rot: document.querySelector('.lam-datos .grande').textContent };
  });
  ok(o.real && Math.abs(n(o.real) - n(v)) / n(v) < 0.02,
     `${o.rot}: el mapa está dibujado a esa escala`, 'dibuja 1:' + o.real);
}

// ── El buscador de estructuras ───────────────────────────────────────────
// Lo que de verdad se comprueba aquí es que buscar CENTRA y no ACERCA. En el
// visor, elegir un resultado vuela a zoom 17; si esta pantalla reutilizara
// aquella acción, el candado del zoom saltaría y el membrete quedaría
// rotulando una escala que ya no es la dibujada.
const ESC = '2500';
await p.selectOption('.lam-panel select', ESC);
await p.waitForTimeout(700);

const centroDe = () => p.evaluate(() => {
  const t = document.querySelector('.lam-estado').innerText.replace(/\s+/g, ' ');
  const u = /UTM \S+ E (\d+) N (\d+)/.exec(t);
  return { utm: u ? `${u[1]},${u[2]}` : null,
           real: (/escala real 1:([\d.,]+)/.exec(t) || [])[1] };
});
const antes = await centroDe();

const buscador = '.lam-buscador input';
ok(await p.isEnabled(buscador), 'el buscador se habilita cuando llega el índice');

// Sin tilde tiene que encontrar la que la lleva: es el índice del visor.
await p.fill(buscador, 'chacarra');
await p.waitForTimeout(400);
const res = await p.evaluate(() => [...document.querySelectorAll('.lam-buscador-lista button')]
  .map(b => b.innerText.replace(/\s+/g, ' ').trim()));
ok(res.length === 1 && /Chacarr/.test(res[0]),
   'busca sin acentos: «chacarra» encuentra «Canoa Chacarrá»', res.join(' | '));
ok(/Canoas/.test(res[0]) && /45\+300/.test(res[0]),
   'y el resultado dice de qué capa es y en qué progresiva', res[0]);

// Dos que comparten prefijo: tienen que salir las dos, no la primera.
await p.fill(buscador, 'toma 10');
await p.waitForTimeout(400);
ok(await p.evaluate(() => document.querySelectorAll('.lam-buscador-lista button').length) === 2,
   '«toma 10» devuelve las dos tomas, no solo una');

// Y por progresiva, que es otro de los campos del índice.
await p.fill(buscador, '12+000');
await p.waitForTimeout(400);
ok(await p.evaluate(() => /Alcantarilla/.test(
  document.querySelector('.lam-buscador-lista button')?.innerText || '')),
   'también se busca por progresiva');

// Elegir: centra en la estructura y NO cambia la escala.
await p.click('.lam-buscador-lista button');
await p.waitForTimeout(900);
const despues = await centroDe();
ok(despues.utm && despues.utm !== antes.utm,
   'elegir un resultado mueve el encuadre', `${antes.utm} → ${despues.utm}`);
ok(n(despues.real) === n(ESC),
   'y la escala sigue siendo la elegida: buscar centra, no acerca',
   `rotulada 1:${ESC}, dibujada 1:${despues.real}`);
ok(await p.evaluate(() => document.querySelectorAll('.lam-buscador-lista').length === 0),
   'la lista se cierra al elegir');

ok(errs.length === 0, 'ningún error de JS en toda la prueba', errs.join(' | '));

const mal = r.filter(x => !x).length;
console.log(`\n${r.length - mal}/${r.length} bien`);
await b.close();
process.exit(mal ? 1 : 0);
