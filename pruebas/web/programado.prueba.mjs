/* Lo programado de una incidencia: lo que se ve y lo que se guarda.
 *
 *     npx vite --port 5199 --strictPort &
 *     node pruebas/web/programado.prueba.mjs
 *
 * Tres estados, y el tercero importa tanto como los otros: hasta que alguien
 * aplique el parche en el servidor, el campo no existe. Una pantalla que en
 * ese caso sale vacía se lee como "esta incidencia no tiene nada programado",
 * que es mentira: es que no se puede saber.
 */
import pw from '/opt/node-tools/node_modules/playwright-core/index.js';

const BASE = 'http://localhost:5199/pruebas/web/programado.html';
const r = [];
const ok = (c, m, e) => { r.push(!!c); console.log(`${c ? 'ok  ' : 'MAL '} ${m}${e ? `   [${e}]` : ''}`); };

const b = await pw.chromium.launch();
const p = await b.newPage({ viewport: { width: 1500, height: 1000 } });
const errs = [];
p.on('pageerror', e => errs.push(String(e)));

const ir = async (v) => {
  await p.goto(`${BASE}?v=${v}`, { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('.cos-prog', { timeout: 15000 });
  await p.waitForTimeout(900);
};

// ══════════ CON PARTIDAS PROGRAMADAS ══════════
await ir('con');
const E = await p.evaluate(() => window.__ESPERADO);

ok(await p.locator('.cos-prog-tabla tbody tr').count() === E.programadas,
   'salen las partidas programadas', `${E.programadas}`);
const cuerpo = await p.locator('.cos-prog').innerText();
ok(/presupuestado/i.test(cuerpo) && /ejecutado/i.test(cuerpo) && /saldo/i.test(cuerpo),
   'con presupuestado, ejecutado y saldo');

// El saldo negativo es el único número que obliga a hacer algo.
const pasada = await p.locator('.cos-prog-tabla td.mal').first().innerText();
ok(/-40/.test(pasada) && /pasada/i.test(pasada),
   'la partida pasada de saldo se marca', pasada.replace(/\n/g, ' '));
ok(await p.locator('.cos-prog-tabla td.mal').count() === 1,
   'y solo esa', `${await p.locator('.cos-prog-tabla td.mal').count()}`);

// ── el bloque va ARRIBA, antes del costeo ──
// Es lo que se decide primero: qué hay que hacer. Lo de abajo es lo que se
// gastó haciéndolo.
const orden = await p.evaluate(() => {
  const prog = document.querySelector('.cos-prog');
  const tabla = [...document.querySelectorAll('table')].find(t => /mano de obra/i.test(t.innerText));
  return tabla ? prog.compareDocumentPosition(tabla) & Node.DOCUMENT_POSITION_FOLLOWING : null;
});
ok(orden, 'el bloque va antes del costeo');

// ── quitar una ──
await p.locator('.cos-prog-quita').first().click();
await p.waitForTimeout(700);
const tras = await p.evaluate(() => window.__PATCH);
ok(Array.isArray(tras) && tras.length === E.programadas - 1,
   'quitar una manda el PATCH con el resto', JSON.stringify(tras));
ok(await p.locator('.cos-prog-tabla tbody tr').count() === E.programadas - 1,
   'y la tabla lo refleja');

// ── añadir una ──
await p.locator('.cos-prog-add').click();
await p.waitForSelector('.cos-prog-escalera', { timeout: 5000 });
ok(true, 'el añadir abre la escalera del presupuesto');
const combos = await p.locator('.cos-prog-escalera select').count();
ok(combos > 0, 'con sus peldaños', `${combos}`);

// ══════════ SIN NINGUNA PROGRAMADA ══════════
await ir('sin');
ok(await p.locator('.cos-prog-tabla').count() === 0, 'sin partidas no hay tabla');
const vacio = await p.locator('.cos-prog-nota').innerText();
ok(/presupuesto entero/i.test(vacio),
   'y se avisa de que el parte ofrecerá el presupuesto entero', vacio.replace(/\n/g, ' ').slice(0, 80));
ok(new RegExp(`\\b${E.partidas}\\b`).test(vacio),
   'diciendo cuántas son', vacio.replace(/\n/g, ' ').slice(0, 80));

// ══════════ EL SERVIDOR TODAVÍA NO LO SOPORTA ══════════
// Es el estado real hasta que se aplique el parche.
await ir('viejo');
const falta = await p.locator('.cos-prog-falta').innerText();
ok(/todavía no guarda|todavia no guarda/i.test(falta),
   'se dice que el servidor no lo soporta', falta.replace(/\n/g, ' ').slice(0, 70));
ok(/parche_partidas_de_incidencia/.test(falta),
   'y qué hay que aplicar para habilitarlo');
ok(await p.locator('.cos-prog-add').count() === 0,
   'y no se ofrece un botón que no puede funcionar');

// ══════════ LA OTRA RAMA: ACTIVIDAD DE OBRA ══════════
// Pedía /actividades/<id>/, el catálogo, en vez de /actividades-obra/<id>/.
// No daba 404: daba 200 sin `partidas`, y el bloque culpaba al servidor.
await ir('actividad');
const urls = await p.evaluate(() => window.__URLS);
const detalleAct = urls.filter(u => /\/actividades(-obra)?\/\d+\/$/.test(u));
ok(detalleAct.some(u => /\/actividades-obra\/\d+\/$/.test(u)),
   'la actividad se pide a actividades-obra/', detalleAct.join(' | ').slice(0, 120));
ok(!detalleAct.some(u => /\/actividades\/\d+\/$/.test(u)),
   'y NUNCA al catálogo actividades/<id>/', detalleAct.join(' | ').slice(0, 120));
ok(await p.locator('.cos-prog-falta').count() === 0,
   'así que no sale el aviso de "no soportado"');
ok(await p.locator('.cos-prog-tabla tbody tr').count() === E.programadas,
   'y se ven sus partidas programadas');

ok(errs.length === 0, 'sin errores de JavaScript', errs.join(' | ').slice(0, 150));

await b.close();
const mal = r.filter(x => !x).length;
console.log(`\n${r.length - mal} de ${r.length} en orden${mal ? `, ${mal} MAL` : ''}.`);
process.exit(mal ? 1 : 0);
