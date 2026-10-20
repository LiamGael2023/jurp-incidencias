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
import { medidorDe, MINIMO } from './contraste.mjs';

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

/* ── quitar una ──
 * En una incidencia la partida ES suya, así que quitarla la BORRA: se va por
 * DELETE a su propia ruta, no por un PATCH que reescribe la lista. Antes
 * aquí se comprobaba el PATCH; ese camino sigue vivo pero solo para las
 * actividades de obra, y se comprueba en su apartado. */
await p.locator('.cos-prog-quita').first().click();
await p.waitForTimeout(700);
const urlsCon = await p.evaluate(() => window.__URLS);
ok(urlsCon.some(x => /^DELETE .*\/incidentes\/\d+\/partidas\/\d+\/$/.test(x)),
   'quitar una partida de la incidencia va por DELETE a su ruta',
   urlsCon.filter(x => x.startsWith('DELETE')).join(' | ').slice(0, 110));
ok(!urlsCon.some(x => /^PATCH .*\/incidentes\/\d+\/$/.test(x)),
   'y NO reescribiendo la lista entera con un PATCH');
ok(await p.locator('.cos-prog-tabla tbody tr').count() === E.programadas - 1,
   'y la tabla lo refleja');

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

// ══════════ CREAR UNA PARTIDA PROPIA DE LA INCIDENCIA ══════════
// Una incidencia no tiene presupuesto del que elegir: lo que haga falta para
// atenderla se escribe cuando pasa.
await ir('sin');
await p.locator('.cos-prog-add').click();
await p.waitForTimeout(300);
ok(await p.locator('.cos-prog-forma').count() === 1,
   'en una incidencia el añadir abre un formulario');
ok(await p.locator('.cos-prog-escalera').count() === 0,
   'y NO la escalera de presupuestos ajenos');
ok(await p.locator('.cos-prog-forma input').count() === 4,
   'con cuatro campos: descripción, unidad, metrado y precio',
   `${await p.locator('.cos-prog-forma input').count()}`);
ok(!/c[oó]digo/i.test(await p.locator('.cos-prog-forma').innerText()),
   'y sin pedir el código, que lo pone el servidor');

// ── guardar en blanco: se dice qué falta y no se llama al servidor ──
await p.locator('.cos-prog-ok').click();
await p.waitForTimeout(300);
ok(await p.evaluate(() => window.__POST) === null,
   'guardar en blanco no llega a pedir nada al servidor');
ok(await p.locator('.cos-prog-campo input.mal').count() === 2,
   'y marca los dos campos que faltan',
   `${await p.locator('.cos-prog-campo input.mal').count()}`);

// ── el importe se calcula mientras escribes ──
const campo = (i) => p.locator('.cos-prog-forma input').nth(i);
await campo(0).fill('Retiro de material colapsado en canoa 8');
await campo(1).fill('m3');
await campo(2).fill('120');
await campo(3).fill('24.5');
await p.waitForTimeout(200);
const imp = await p.locator('[data-prueba="importe"]').innerText();
ok(/2[.,]940/.test(imp), 'el importe sale solo: 120 × 24.5 = 2 940', imp);

// ── y se guarda ──
await p.locator('.cos-prog-ok').click();
await p.waitForTimeout(600);
const enviado = await p.evaluate(() => window.__POST);
ok(enviado && enviado.descripcion === 'Retiro de material colapsado en canoa 8'
   && enviado.unidad === 'm3' && enviado.metrado === 120 && enviado.precio === 24.5,
   'se manda lo escrito, con los números como números', JSON.stringify(enviado));
ok(await p.locator('.cos-prog-tabla tbody tr').count() === 1,
   'y la partida aparece en la tabla');
const fila = await p.locator('.cos-prog-tabla tbody tr').first().innerText();
ok(/\b01\b/.test(fila), 'con el código 01 que puso el servidor', fila.replace(/\n/g, ' '));

// ══════════ QUE SE LEA ══════════
// Dos veces escribí texto con la paleta oscura dentro de un panel claro y
// las dos las encontró el usuario, no yo. No se razona: se mide.
//
// El formulario sigue abierto del alta anterior, y eso es a propósito: quien
// mete una partida suele meter tres. Cerrarlo obligaría a volver a pulsar
// "Nueva partida" entre una y otra.
ok(await p.locator('.cos-prog-forma').count() === 1,
   'tras guardar, el formulario sigue abierto para la siguiente');
ok(await p.locator('.cos-prog-forma input').nth(0).inputValue() === '',
   'pero vacío, no con lo anterior dentro');

await p.locator('.cos-prog-forma input').nth(0).fill('x');
await p.locator('.cos-prog-forma input').nth(1).fill('');
await p.locator('.cos-prog-ok').click();   // para que salga un error pintado
await p.waitForTimeout(300);

const medir = medidorDe(p);
const textos = (await medir(
  '.cos-prog-forma-tit, .cos-prog-campo > span, .cos-prog-campo > em,'
  + ' .cos-prog-importe b, .cos-prog-ok, .cos-prog-cancel, .cos-prog-nota'))
  .filter(f => f.visible && f.texto);
const flojos = textos.filter(f => f.ratio < MINIMO);
ok(textos.length >= 6, 'hay texto que medir en el formulario', `${textos.length}`);
ok(flojos.length === 0, 'todo el texto del formulario pasa AA (4.5:1)',
   flojos.length ? flojos.map(f => `"${f.texto}" ${f.ratio}:1`).join(' | ')
                 : `peor ${Math.min(...textos.map(f => f.ratio)).toFixed(2)}:1`);

// El campo en rojo tiene que distinguirse del normal por algo más que el
// borde: el fondo cambia, y ese fondo no puede tragarse el texto.
const malos = (await medir('.cos-prog-campo input.mal')).filter(f => f.visible);
ok(malos.length > 0, 'hay un campo marcado como erróneo', `${malos.length}`);
ok(malos.every(f => f.ratio >= MINIMO),
   'y el texto dentro de un campo erróneo también se lee',
   malos.map(f => `${f.ratio}:1 sobre ${f.fondo}`).join(' | '));

// ══════════ CORREGIR Y BORRAR ══════════
await ir('con');
await p.locator('.cos-prog-edita').first().click();
await p.waitForTimeout(300);
ok(await p.locator('.cos-prog-forma').count() === 1, 'el lápiz abre el formulario');
const prellenado = await p.locator('.cos-prog-forma input').nth(0).inputValue();
ok(/movilizacion/i.test(prellenado), 'prellenado con la partida de la fila', prellenado);

await p.locator('.cos-prog-forma input').nth(2).fill('3');
await p.locator('.cos-prog-ok').click();
await p.waitForTimeout(600);
const editado = await p.evaluate(() => window.__PATCH_PARTIDA);
ok(editado && editado.metrado === 3, 'guardar manda el PATCH con el metrado nuevo',
   JSON.stringify(editado));
ok(await p.locator('.cos-prog-forma').count() === 0, 'y el formulario se cierra');

// ── borrar una con metrado ya imputado: 409, y se explica ──
const antes = await p.locator('.cos-prog-tabla tbody tr').count();
const filas = p.locator('.cos-prog-tabla tbody tr');
const n = await filas.count();
let iPasada = 0;
for (let i = 0; i < n; i++) {
  if (/pasada/i.test(await filas.nth(i).innerText())) { iPasada = i; break; }
}
await filas.nth(iPasada).locator('.cos-prog-quita').click();
await p.waitForTimeout(600);
const queja = await p.locator('.cos-prog-mal').innerText();
ok(/3 parte/.test(queja), 'borrar una con partes imputados se rechaza diciendo cuántos',
   queja.replace(/\n/g, ' ').slice(0, 90));
ok(await p.locator('.cos-prog-tabla tbody tr').count() === antes,
   'y la fila sigue ahí');

// ── borrar una sin imputar: se va ──
let iLibre = 0;
for (let i = 0; i < n; i++) {
  if (!/pasada/i.test(await filas.nth(i).innerText())) { iLibre = i; break; }
}
await filas.nth(iLibre).locator('.cos-prog-quita').click();
await p.waitForTimeout(600);
ok(await p.locator('.cos-prog-tabla tbody tr').count() === antes - 1,
   'una sin partes imputados sí se borra');

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
// La actividad SÍ tiene presupuesto: ahí la escalera se queda.
await p.locator('.cos-prog-add').click();
await p.waitForTimeout(300);
ok(await p.locator('.cos-prog-escalera').count() === 1,
   'en una actividad el añadir sigue abriendo la escalera');
ok(await p.locator('.cos-prog-forma').count() === 0,
   'y no el formulario de alta');
ok(await p.locator('.cos-prog-edita').count() === 0,
   'ni se ofrece editar una partida del presupuesto de la obra');

ok(errs.length === 0, 'sin errores de JavaScript', errs.join(' | ').slice(0, 150));

await b.close();
const mal = r.filter(x => !x).length;
console.log(`\n${r.length - mal} de ${r.length} en orden${mal ? `, ${mal} MAL` : ''}.`);
process.exit(mal ? 1 : 0);
