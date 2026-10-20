/* La ventana del presupuesto de un proyecto.
 *
 *     npx vite --port 5199 --strictPort &
 *     node pruebas/web/presupuesto.prueba.mjs
 *
 * Lo que vigila, por orden de lo que duele:
 *
 * 1. Que el arbol se dibuje con sus titulos, que NO son filas de la base:
 *    salen de la ruta de cada partida.
 * 2. Que lo que no existe no se ofrezca. A un titulo reconstruido desde la
 *    ruta no se le puede colgar nada ni editarlo, porque no hay fila que
 *    guardar. Un lapiz ahi seria una promesa falsa.
 * 3. Que un proyecto sin presupuesto lo diga y deje escribirlo.
 * 4. Que si el servidor no tiene la ruta de alta, se diga, en vez de
 *    ofrecer botones que devuelven 404.
 */
import pw from '/opt/node-tools/node_modules/playwright-core/index.js';
import { medidorDe, MINIMO } from './contraste.mjs';

const BASE = 'http://localhost:5199/pruebas/web/presupuesto.html';
const r = [];
const ok = (c, m, e) => { r.push(!!c); console.log(`${c ? 'ok  ' : 'MAL '} ${m}${e ? `   [${e}]` : ''}`); };

const b = await pw.chromium.launch();
const p = await b.newPage({ viewport: { width: 1500, height: 1000 } });
const errs = [];
p.on('pageerror', e => errs.push(String(e)));

const ir = async (v) => {
  await p.goto(`${BASE}?v=${v}`, { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('.pre-caja', { timeout: 15000 });
  await p.waitForTimeout(700);
};
const btn = (txt) => p.locator(`button.pre-btn:has-text("${txt}")`).click();

// ══════════ UN PRESUPUESTO IMPORTADO ══════════
await ir('importado');
const E = await p.evaluate(() => window.__ESPERADO);

ok(await p.locator('.cos-prog-tabla tbody tr').count() === E.hojas + E.titulos + 1,
   'salen las partidas, sus títulos y la raíz',
   `${await p.locator('.cos-prog-tabla tbody tr').count()}`);
ok(await p.locator('.cos-prog-titulo').count() === E.titulos,
   'los títulos salen de la ruta, aunque no sean filas de la base',
   `${await p.locator('.cos-prog-titulo').count()}`);
const codigos = (await p.locator('.cos-prog-tabla td.cod').allInnerTexts()).map(x => x.trim());
ok(codigos.join(',') === '1,01,01.01,01.01.01,01.01.02,01.02,01.02.01',
   'y en el orden del presupuesto', codigos.join(','));

// La raíz es el proyecto y suma solo las hojas.
const raiz = await p.evaluate(() =>
  [...document.querySelector('.cos-prog-raiz').querySelectorAll('td')]
    .map(td => td.textContent.replace(/[^\d.-]/g, '')));
ok(Math.abs(Number(raiz[5]) - E.importe) < 0.02,
   'la raíz suma solo las hojas', `${raiz[5]} — esperado ${E.importe}`);
ok(Math.abs(Number(raiz[7]) - E.valorizado) < 0.02,
   'y valoriza lo ejecutado igual', `${raiz[7]} — esperado ${E.valorizado}`);

// ── lo que no existe, no se ofrece ──
ok(await p.locator('.cos-prog-titulo .cos-prog-edita').count() === 0,
   'un título reconstruido desde la ruta NO ofrece lápiz: no hay fila que guardar');
ok(await p.locator('.cos-prog-tabla tbody tr:not(.cos-prog-titulo):not(.cos-prog-raiz) .cos-prog-edita').count() === E.hojas,
   'pero las partidas sí, que existen', `${E.hojas}`);

// ── el descuadre contra lo que declara el Excel ──
const barra = await p.locator('.pre-barra').innerText();
ok(/3 partidas/.test(barra), 'la barra dice cuántas partidas hay', barra.replace(/\n/g, ' ').slice(0, 60));
ok(await p.locator('.pre-descuadre').count() === 1,
   'y avisa de que no cuadra con el costo directo declarado');
ok(/3,621|3621/.test(await p.locator('.pre-descuadre').innerText()),
   'diciendo cuánto falta', await p.locator('.pre-descuadre').innerText());

// Y cuando SI cuadra, no avisa: un aviso que sale siempre deja de leerse.
await ir('cuadra');
ok(await p.locator('.pre-descuadre').count() === 0,
   'y cuando el pie cuadra, no avisa de nada');
await ir('importado');
await p.waitForTimeout(300);

// ── al colgar algo, solo se ofrecen títulos que existen ──
/* COLGAR DE UN CAPITULO DEL EXCEL. Ninguno de los 39 capítulos de un
 * presupuesto importado es una fila: existen dentro de la ruta de sus
 * partidas. Si para colgar algo hiciera falta un id, no se podría añadir
 * nada a un presupuesto importado, que es justo cuando hace falta. */
await btn('Partida');
await p.waitForTimeout(300);
const dest = await p.locator('.cos-prog-forma select option').allInnerTexts();
ok(dest.length === 1 + E.titulos,
   'se ofrecen los capítulos del Excel, aunque no sean filas',
   dest.join(' | '));
ok(/TRABAJOS PRELIMINARES/.test(dest.join('|')),
   'con su nombre, el de la ruta', dest.join(' | '));

await p.locator('.cos-prog-forma select').selectOption(
  { label: dest.find(x => /TRABAJOS PRELIMINARES/.test(x)) });
await p.locator('.cos-prog-forma input').nth(0).fill('Partida nueva en el capitulo');
await p.locator('.cos-prog-forma input').nth(1).fill('und');
await p.locator('.cos-prog-forma input').nth(2).fill('2');
await p.locator('.cos-prog-forma input').nth(3).fill('150');
await p.locator('.cos-prog-ok').click();
await p.waitForTimeout(700);
const postCap = await p.evaluate(() => window.__POST);
ok(postCap && postCap.padre === null && postCap.padre_codigo === '01.01',
   'se manda el CODIGO del capítulo, sin id, que no lo tiene',
   JSON.stringify(postCap));
const codsCap = (await p.locator('.cos-prog-tabla td.cod').allInnerTexts()).map(x => x.trim());
ok(codsCap.includes('01.01.03'),
   'y el servidor le da el código que sigue dentro de ese capítulo',
   codsCap.join(' | '));

// ══════════ SIN PRESUPUESTO ══════════
await ir('vacio');
ok(await p.locator('.pre-vacio').count() === 1, 'un proyecto sin presupuesto lo dice');
const vac = await p.locator('.pre-vacio').innerText();
ok(/avance será siempre cero|avance sera siempre cero/i.test(vac),
   'y explica la consecuencia, no solo que está vacío', vac.replace(/\n/g, ' ').slice(0, 80));
ok(/escríbelo aquí|escribelo aqui/i.test(vac),
   'y que se puede escribir a mano');

// ── escribir un título y colgarle una partida ──
await btn('Título');
await p.waitForTimeout(300);
ok(await p.locator('.cos-prog-forma').getAttribute('data-tipo') === 'titulo',
   'el botón de Título abre su formulario');
await p.locator('.cos-prog-forma input').nth(0).fill('TRABAJOS PRELIMINARES');
await p.locator('.cos-prog-ok').click();
await p.waitForTimeout(700);
const post1 = await p.evaluate(() => window.__POST);
ok(post1 && post1.tipo === 'titulo' && !('unidad' in post1),
   'se manda como título, sin unidad', JSON.stringify(post1));
ok(await p.locator('.cos-prog-titulo').count() === 1, 'y aparece en la tabla');

await btn('Partida');
await p.waitForTimeout(300);
const ops = await p.locator('.cos-prog-forma select option').allInnerTexts();
ok(ops.length === 2 && /TRABAJOS PRELIMINARES/.test(ops.join('|')),
   'ahora sí se puede colgar del título recién creado', ops.join(' | '));
await p.locator('.cos-prog-forma select').selectOption({ label: ops[1] });
await p.locator('.cos-prog-forma input').nth(0).fill('Movilizacion');
await p.locator('.cos-prog-forma input').nth(1).fill('glb');
await p.locator('.cos-prog-forma input').nth(2).fill('1');
await p.locator('.cos-prog-forma input').nth(3).fill('5000');
await p.locator('.cos-prog-ok').click();
await p.waitForTimeout(700);
const post2 = await p.evaluate(() => window.__POST);
ok(post2 && post2.padre, 'y se manda colgada de él', JSON.stringify(post2));
const cods2 = (await p.locator('.cos-prog-tabla td.cod').allInnerTexts()).map(x => x.trim());
ok(cods2.includes('01.01'), 'con el código que le toca dentro del título', cods2.join(' | '));
const raiz2 = await p.evaluate(() =>
  [...document.querySelector('.cos-prog-raiz').querySelectorAll('td')]
    .map(td => td.textContent.replace(/[^\d.-]/g, '')));
ok(Math.abs(Number(raiz2[5]) - 5000) < 0.02,
   'y el total del proyecto pasa a 5 000, contando la hoja una sola vez', raiz2[5]);

// ══════════ EL SERVIDOR TODAVIA NO LO SOPORTA ══════════
await ir('viejo');
ok(await p.locator('.pre-btn-alta').count() === 0,
   'sin la ruta de alta no se ofrecen botones que fallarían');
const falta = await p.locator('.cos-prog-falta').innerText();
ok(/parche_presupuesto_proyecto/.test(falta), 'y se dice qué aplicar', falta.slice(0, 80));
ok(/ver lo importado/i.test(falta), 'aclarando que lo importado sí se ve');

const flojos = (await medidorDe(p)(
  '.pre-codigo, .pre-nombre, .pre-kpi, .pre-descuadre, .pre-btn, .pre-vacio p, .cos-prog-falta'))
  .filter(f => f.visible && f.texto && f.ratio < MINIMO);
ok(flojos.length === 0, 'todo el texto de la ventana pasa AA',
   flojos.map(f => `"${f.texto}" ${f.ratio}:1`).join(' | '));

ok(errs.length === 0, 'sin errores de JavaScript', errs.join(' | ').slice(0, 200));

await b.close();
const mal = r.filter(x => !x).length;
console.log(`\n${r.length - mal} de ${r.length} en orden${mal ? `, ${mal} MAL` : ''}.`);
process.exit(mal ? 1 : 0);
