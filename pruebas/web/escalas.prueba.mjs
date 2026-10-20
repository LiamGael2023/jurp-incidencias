/* Las escalas de cuenca: que entren, que no mientan y que no revienten.
 *
 *     npx vite --port 5199 --strictPort &
 *     node pruebas/web/escalas.prueba.mjs
 *
 * El catálogo llegaba hasta 1:25.000 y el canal madre mide 155 km: hacían
 * falta cuatro láminas para recorrerlo. Con 1:50.000, 1:100.000 y 1:200.000
 * entra de una vez.
 *
 * Pero abrir la escala trae un problema que no es de dibujo sino de
 * cartografía: a 1:200.000 el encuadre es el valle entero, o sea las 2.633
 * estructuras, y el símbolo de una toma cubriría 800 m de terreno. Saldrían
 * amontonadas y además es justo lo que congelaba el navegador antes de que
 * existiera el recorte al encuadre. Así que a partir de 1:25.000 no se
 * dibujan, y lo que esto vigila es que eso se diga y que la leyenda no siga
 * explicando símbolos que ya no están.
 */
import pw from '/opt/node-tools/node_modules/playwright-core/index.js';

const URL = 'http://localhost:5199/pruebas/web/lamina.html';
const r = [];
const ok = (c, m, e) => { r.push(!!c); console.log(`${c ? 'ok  ' : 'MAL '} ${m}${e ? `   [${e}]` : ''}`); };

const b = await pw.chromium.launch();
const p = await b.newPage({ viewport: { width: 1700, height: 1000 } });
const errs = [];
p.on('pageerror', e => errs.push(String(e)));

await p.goto(URL, { waitUntil: 'domcontentloaded' });
await p.waitForSelector('.lam-membrete', { timeout: 20000 });
await p.waitForTimeout(1800);

const sel = p.locator('select').filter({ hasText: 'por lámina' }).first();
const ops = (await sel.locator('option').allInnerTexts()).filter(o => o.includes(':'));

// ── el catálogo ──
// Del lado derecho de los dos puntos: quitar todo lo que no sea dígito
// convertía "1:200" en 1200.
const denom = ops.map(o => Number((o.match(/1\s*:\s*([\d.,]+)/) || [])[1].replace(/[.,]/g, '')));
ok(denom.includes(50000) && denom.includes(100000) && denom.includes(200000),
   'están las tres escalas de cuenca', denom.join(' '));
ok(denom.every((v, i) => i === 0 || v > denom[i - 1]),
   'el catálogo va de más cerca a más lejos', denom.join(' '));

// 155 km de canal tienen que entrar en UNA lámina a la escala más abierta.
const km = Number((ops.at(-1).match(/([\d.]+) km/) || [])[1]);
ok(km >= 155, 'a la escala más abierta cabe el canal madre entero',
   `${km} km por lámina`);

const estado = () => p.evaluate(() => ({
  marcas: document.querySelectorAll('.leaflet-marker-icon').length,
  rotulos: document.querySelectorAll('.leaflet-tooltip').length,
  aviso: document.querySelector('.lam-aviso-escala')?.textContent?.trim().slice(0, 60) || null,
  leyenda: [...document.querySelectorAll('.lam-leyenda *')]
    .filter(e => !e.children.length).map(e => e.textContent.trim()).filter(Boolean),
  membrete: (document.querySelector('.lam-membrete')?.textContent.match(/1\s*:\s*[\d.,]+/) || [])[0],
}));

const ir = async (d) => {
  await sel.selectOption({ label: ops.find(o => o.startsWith(`1:${d.toLocaleString('en-US')}`)) });
  await p.waitForTimeout(1400);
  return estado();
};

/* TRES BANDAS, no dos. Que el símbolo valga y que el nombre valga son dos
 * preguntas distintas, y antes las respondía una sola:
 *
 *   hasta 1:25.000   estructura y nombre
 *   30.000-40.000    la estructura sí, el nombre no: a esa escala los
 *                    rótulos se pisan unos a otros
 *   desde 1:50.000   ninguna de las dos
 */

// ── hasta 1:25.000, todo ──
const e25 = await ir(25000);
ok(e25.marcas > 0, 'a 1:25.000 se dibujan las estructuras', `${e25.marcas}`);
ok(e25.rotulos > 0, 'y con su nombre', `${e25.rotulos}`);
ok(!e25.aviso, 'y no hace falta avisar de nada');
ok(e25.membrete === '1:25,000', 'el membrete lo rotula', e25.membrete);

// ── la banda intermedia: símbolo sí, nombre no ──
for (const d of [30000, 40000]) {
  const e = await ir(d);
  ok(e.marcas > 0, `a 1:${d} las estructuras siguen dibujándose`, `${e.marcas}`);
  ok(e.rotulos === 0, `pero sin nombre`, `${e.rotulos} rótulos`);
  ok(/sin nombre/.test(e.aviso || ''), 'y se dice', e.aviso);
  // Lo que hace utilizable la escala abierta: el rótulo es un nodo del DOM
  // por estructura y son la mitad de lo que cuesta repintar.
  ok(e.leyenda.length > 0, 'la leyenda sigue explicando los símbolos que sí están');
}

// ── desde 1:50.000, ninguna ──
for (const d of [50000, 100000, 200000]) {
  const e = await ir(d);
  ok(e.marcas === 0, `a 1:${d} no se dibujan estructuras`, `${e.marcas}`);
  ok(!!e.aviso, `y se dice por qué`, e.aviso);
  // La leyenda no puede seguir explicando símbolos que no están.
  const puntos = e.leyenda.filter(x => /^Tomas|^Entregas|^Partidores|^Cámaras|^Sifones|^Alcantarillas/.test(x));
  ok(puntos.length === 0, `la leyenda de 1:${d} no explica símbolos ausentes`,
     puntos.join(' | ') || 'ninguno');
  ok(e.membrete === `1:${d.toLocaleString('en-US')}`,
     `el membrete rotula 1:${d}`, e.membrete);
}

// ── y se vuelve atrás sin secuelas ──
const vuelta = await ir(10000);
ok(vuelta.marcas > 0, 'al volver a 1:10.000 reaparecen las estructuras', `${vuelta.marcas}`);
ok(vuelta.rotulos > 0, 'y sus nombres', `${vuelta.rotulos}`);
ok(!vuelta.aviso, 'y el aviso se va');

// ── el hueco que motivó todo esto ──
// Un tramo de veinte a treinta kilómetros no cabía en la lámina de 25.000 y
// en la de 50.000 sobraba media hoja.
const kmDe = (d) => Number((ops.find(o => o.startsWith(`1:${d.toLocaleString('en-US')}`))
  .match(/([\d.]+) km/) || [])[1]);
ok(kmDe(30000) > 20 && kmDe(40000) < 41,
   'las nuevas llenan el salto de 20,5 a 41 km por lámina',
   `25k=${kmDe(25000)} · 30k=${kmDe(30000)} · 40k=${kmDe(40000)} · 50k=${kmDe(50000)}`);

ok(errs.length === 0, 'sin errores de JavaScript', errs.join(' | ').slice(0, 150));

await b.close();
const mal = r.filter(x => !x).length;
console.log(`\n${r.length - mal} de ${r.length} en orden${mal ? `, ${mal} MAL` : ''}.`);
process.exit(mal ? 1 : 0);
