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

/* Hay dos botones de alta en la incidencia -Título y Partida- asi que se
 * eligen por su texto; .first() daria siempre el mismo y la prueba del
 * titulo pasaria creando una partida. */
const btn = (txt) => p.locator(`button.cos-prog-add:has-text("${txt}")`).click();

const ir = async (v) => {
  await p.goto(`${BASE}?v=${v}`, { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('.cos-prog', { timeout: 15000 });
  await p.waitForTimeout(900);
};

// ══════════ CON PARTIDAS PROGRAMADAS ══════════
await ir('con');
const E = await p.evaluate(() => window.__ESPERADO);

// +1 por la raíz: la incidencia, que se dibuja y no se guarda.
ok(await p.locator('.cos-prog-tabla tbody tr').count() === E.programadas + 1,
   'salen todas las filas del presupuesto, más la raíz', `${E.programadas + 1}`);
ok(await p.locator('.cos-prog-titulo').count() === E.titulos,
   'los títulos se distinguen de las partidas', `${E.titulos}`);
ok(await p.locator('.cos-prog-raiz').count() === 1,
   'y hay una sola fila raíz');
const raiz = await p.locator('.cos-prog-raiz').innerText();
ok(new RegExp(E.total.toLocaleString('es-PE', { minimumFractionDigits: 2 })
     .replace(/[.,]/g, '[.,]')).test(raiz),
   'cuyo total es la suma de las hojas, no de todo',
   `${raiz.replace(/\n/g, ' ')} — esperado ${E.total}`);

/* Las tres columnas de la raíz, por su número exacto. El riesgo no es que
 * falte una: es que sumen también los títulos, que ya traen la suma de sus
 * hijos. El total saldría justo al doble y los dos números son plausibles. */
const celdasRaiz = await p.evaluate(() =>
  [...document.querySelector('.cos-prog-raiz').querySelectorAll('td')]
    .map(td => td.textContent.replace(/[^\d.-]/g, '')));
ok(Number(celdasRaiz[5]) === E.total,
   'la raíz valoriza el programado sin contar los títulos',
   `${celdasRaiz[5]} — esperado ${E.total}`);
ok(Number(celdasRaiz[7]) === E.valorizado,
   'y lo ejecutado igual', `${celdasRaiz[7]} — esperado ${E.valorizado}`);
ok(Math.abs(Number(celdasRaiz[9]) - (E.total - E.valorizado)) < 0.02,
   'y el saldo es la resta de los dos',
   `${celdasRaiz[9]} — esperado ${E.total - E.valorizado}`);
// Un título que sumara también a los títulos de debajo contaría doble.
const sumaTitulos = await p.evaluate(() => [...document.querySelectorAll('.cos-prog-titulo')]
  .map(tr => tr.querySelectorAll('td')[5].textContent.trim()));
ok(sumaTitulos.length === E.titulos && sumaTitulos.every(x => x && x !== '0.00'),
   'y cada título trae el suyo', sumaTitulos.join(' | '));
const cuerpo = await p.locator('.cos-prog').innerText();
ok(/unid/i.test(cuerpo) && /cant/i.test(cuerpo) && /precio/i.test(cuerpo)
   && /total/i.test(cuerpo) && /ejecutado/i.test(cuerpo) && /saldo/i.test(cuerpo),
   'con las columnas del expediente: unidad, cantidad, precio y total');

// El saldo negativo es el único número que obliga a hacer algo.
const pasada = await p.locator('.cos-prog-tabla td.mal').first().innerText();
ok(/-40/.test(pasada) && /pasada/i.test(pasada),
   'la partida pasada de saldo se marca', pasada.replace(/\n/g, ' '));
/* Una sola FILA marcada, no una sola celda: desde que el saldo va en
 * cantidad y en soles, la partida pasada marca dos celdas y contarlas daba
 * un MAL que no existia. */
const filasMal = await p.evaluate(() => new Set(
  [...document.querySelectorAll('.cos-prog-tabla td.mal')].map(td => td.parentElement)).size);
ok(filasMal === 1, 'y solo esa', `${filasMal} filas`);

// ── la cabecera de dos pisos ──
const g = await p.locator('.cos-prog-grupos th.g').allInnerTexts();
ok(g.length === 3 && /programado/i.test(g[0]) && /ejecutado/i.test(g[1])
   && /saldo/i.test(g[2]), 'la cabecera agrupa en Programado, Ejecutado y Saldo',
   g.join(' | '));
const anchos = await p.evaluate(() => [...document.querySelectorAll('.cos-prog-grupos th.g')]
  .map(th => th.colSpan));
ok(JSON.stringify(anchos) === '[4,2,2]',
   'con cuatro columnas lo programado y dos cada uno de los otros',
   JSON.stringify(anchos));
const celdas = await p.evaluate(() => {
  const tr = document.querySelector('.cos-prog-tabla tbody tr:not(.cos-prog-raiz):not(.cos-prog-titulo)');
  return [...tr.querySelectorAll('td')].length;
});
ok(celdas === 11, 'y cada partida trae las diez columnas más las acciones',
   `${celdas}`);

// El saldo en soles es el total menos lo valorizado: si se escribiera a
// mano dejaria de cuadrar con las dos columnas que tiene al lado.
const cuadra = await p.evaluate(() => {
  const n = (s) => Number(String(s).replace(/[^\d.-]/g, ''));
  return [...document.querySelectorAll(
    '.cos-prog-tabla tbody tr:not(.cos-prog-raiz):not(.cos-prog-titulo)')]
    .map(tr => [...tr.querySelectorAll('td')].map(td => td.textContent))
    .every(c => Math.abs((n(c[5]) - n(c[7])) - n(c[9])) < 0.02);
});
ok(cuadra, 'el saldo en soles cuadra con total menos ejecutado en todas las filas');

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
const antesBorrar = await p.locator('.cos-prog-tabla tbody tr').count();
await p.locator('.cos-prog-titulo .cos-prog-quita').first().click();
await p.waitForTimeout(700);
const urlsCon = await p.evaluate(() => window.__URLS);
ok(urlsCon.some(x => /^DELETE .*\/incidentes\/\d+\/partidas\/\d+\/$/.test(x)),
   'quitar va por DELETE a la ruta de esa fila',
   urlsCon.filter(x => x.startsWith('DELETE')).join(' | ').slice(0, 110));
ok(!urlsCon.some(x => /^PATCH .*\/incidentes\/\d+\/$/.test(x)),
   'y NO reescribiendo la lista entera con un PATCH');
// Ese primero es un título CON hijos: llevárselo tiraría filas que no se
// están mirando.
const quejaTit = await p.locator('.cos-prog-mal').innerText();
ok(/colgando/.test(quejaTit), 'un título con hijos no se borra, y se dice por qué',
   quejaTit.replace(/\n/g, ' ').slice(0, 80));
ok(await p.locator('.cos-prog-tabla tbody tr').count() === antesBorrar,
   'y no se va ninguna fila');

// Una hoja suelta sí se va.
await p.locator('tr:not(.cos-prog-titulo):not(.cos-prog-raiz) .cos-prog-quita')
  .first().click();
await p.waitForTimeout(700);
ok(await p.locator('.cos-prog-tabla tbody tr').count() === antesBorrar - 1,
   'una partida sin partes imputados sí se va');

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
   'y no se ofrece ningún botón que no pueda funcionar');

// ══════════ CREAR UNA PARTIDA PROPIA DE LA INCIDENCIA ══════════
// Una incidencia no tiene presupuesto del que elegir: lo que haga falta para
// atenderla se escribe cuando pasa.
await ir('sin');
await btn('Partida');
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
ok(await p.locator('.cos-prog-tabla tbody tr').count() === 2,
   'y la partida aparece en la tabla, bajo la raíz');
const fila = await p.locator('.cos-prog-tabla tbody tr').nth(1).innerText();
ok(/\b01\b/.test(fila), 'con el código 01 que puso el servidor', fila.replace(/\n/g, ' '));

// ══════════ ARMAR LA ESTRUCTURA: UN TITULO Y UNA PARTIDA DENTRO ══════════
// Es lo que se pidió: que el presupuesto de la incidencia se arme como el
// del expediente, con títulos que agrupan.
await btn('Título');
await p.waitForTimeout(300);
ok(await p.locator('.cos-prog-forma').getAttribute('data-tipo') === 'titulo',
   'el botón de Título abre el formulario de título');
ok(await p.locator('.cos-prog-forma input[type="number"]').count() === 0,
   'que no pide metrado ni precio');
ok(/suma/i.test(await p.locator('.cos-prog-forma').innerText()),
   'y dice que su total lo suman sus hijos');

await p.locator('.cos-prog-forma input').nth(0).fill('TRABAJOS PRELIMINARES');
await p.locator('.cos-prog-ok').click();
await p.waitForTimeout(600);
const postTit = await p.evaluate(() => window.__POST);
ok(postTit && postTit.tipo === 'titulo' && !('unidad' in postTit),
   'se manda como título, sin unidad ni precio', JSON.stringify(postTit));
ok(await p.locator('.cos-prog-titulo').count() === 1,
   'y aparece como título en la tabla');
const codTit = await p.locator('.cos-prog-titulo td.cod').innerText();
ok(codTit.trim() === '02', 'con el código de raíz que sigue', codTit);

// ── ahora una partida DENTRO de ese título ──
await btn('Partida');
await p.waitForTimeout(300);
const opciones = await p.locator('.cos-prog-forma select option').allInnerTexts();
ok(opciones.length === 2 && /TRABAJOS PRELIMINARES/.test(opciones.join('|')),
   'el formulario ofrece colgarla del título recién creado', opciones.join(' | '));
await p.locator('.cos-prog-forma select').selectOption({ label: opciones[1] });
await p.locator('.cos-prog-forma input').nth(0).fill('Trazo y replanteo');
await p.locator('.cos-prog-forma input').nth(1).fill('mes');
await p.locator('.cos-prog-forma input').nth(2).fill('3');
await p.locator('.cos-prog-forma input').nth(3).fill('6207');
await p.locator('.cos-prog-ok').click();
await p.waitForTimeout(600);
const postHijo = await p.evaluate(() => window.__POST);
ok(postHijo && postHijo.padre, 'se manda colgada de ese título',
   JSON.stringify(postHijo));
const codigos = await p.locator('.cos-prog-tabla tbody td.cod').allInnerTexts();
ok(codigos.map(x => x.trim()).includes('02.01'),
   'y el servidor le da el código 02.01, dentro del título',
   codigos.map(x => x.trim()).join(' | '));

// El sangrado es lo que hace legible el árbol: un hijo no puede empezar
// donde empieza su padre.
const sangria = await p.evaluate(() => {
  const celda = (cod) => [...document.querySelectorAll('.cos-prog-tabla td.cod')]
    .find(td => td.textContent.trim() === cod);
  const pad = (td) => td ? parseFloat(getComputedStyle(td).paddingLeft) : null;
  return { padre: pad(celda('02')), hijo: pad(celda('02.01')) };
});
ok(sangria.hijo > sangria.padre, 'y se dibuja sangrado bajo él',
   `padre ${sangria.padre}px, hijo ${sangria.hijo}px`);

// La raíz suma las hojas, no los títulos: si contara los dos, el total
// saldría doblado y los dos números son plausibles.
const totalRaiz = await p.evaluate(() =>
  document.querySelector('.cos-prog-raiz').querySelectorAll('td')[5].textContent.trim());
/* El número exacto, no uno de dos posibles. Lo puesto: 120 × 24.50 = 2 940
 * y 3 × 6 207 = 18 621, que suman 21 561. Si la raíz contara también los
 * títulos saldría 40 182, y aceptar "2940 ó 21561" dejaba pasar justo el
 * error que esto vigila. */
ok(totalRaiz.replace(/[^\d]/g, '') === '2156100',
   'y la raíz suma solo las hojas: 21 561.00', totalRaiz);

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
// ── el lápiz de un TÍTULO: solo se renombra ──
await p.locator('.cos-prog-titulo .cos-prog-edita').first().click();
await p.waitForTimeout(300);
ok(await p.locator('.cos-prog-forma').count() === 1, 'el lápiz abre el formulario');
ok(await p.locator('.cos-prog-forma').getAttribute('data-tipo') === 'titulo',
   'y sabe que es un título');
ok(await p.locator('.cos-prog-forma input[type="number"]').count() === 0,
   'un título no ofrece metrado ni precio: su total lo suman sus hijos');
const nomTit = await p.locator('.cos-prog-forma input').nth(0).inputValue();
ok(/TRABAJOS/i.test(nomTit), 'prellenado con el nombre del título', nomTit);
await p.locator('.cos-prog-forma input').nth(0).fill('TRABAJOS PRELIMINARES Y ACCESOS');
await p.locator('.cos-prog-ok').click();
await p.waitForTimeout(600);
const editTit = await p.evaluate(() => window.__PATCH_PARTIDA);
ok(editTit && editTit.descripcion === 'TRABAJOS PRELIMINARES Y ACCESOS'
   && !('unidad' in editTit) && !('precio' in editTit),
   'y al renombrarlo solo se manda la descripción', JSON.stringify(editTit));

// ── el lápiz de una PARTIDA: los cuatro campos ──
await p.locator('tr:not(.cos-prog-titulo):not(.cos-prog-raiz) .cos-prog-edita')
  .first().click();
await p.waitForTimeout(300);
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
let iPasada = 0;
const nf = await filas.count();
for (let i = 0; i < nf; i++) {
  if (/pasada/i.test(await filas.nth(i).innerText())) { iPasada = i; break; }
}
await filas.nth(iPasada).locator('.cos-prog-quita').click();
await p.waitForTimeout(600);
const queja = await p.locator('.cos-prog-mal').innerText();
ok(/3 parte/.test(queja), 'borrar una con partes imputados se rechaza diciendo cuántos',
   queja.replace(/\n/g, ' ').slice(0, 90));
ok(await p.locator('.cos-prog-tabla tbody tr').count() === antes,
   'y la fila sigue ahí');

/* ── borrar una sin imputar: se va ──
 * Se busca entre las HOJAS: la raíz no tiene botones y un título con hijos
 * se rechaza, así que recorrer todas las filas daba con una sin papelera y
 * la prueba se quedaba esperando treinta segundos. */
const hojas = p.locator(
  '.cos-prog-tabla tbody tr:not(.cos-prog-titulo):not(.cos-prog-raiz)');
const nh = await hojas.count();
let iLibre = -1;
for (let i = 0; i < nh; i++) {
  if (!/pasada/i.test(await hojas.nth(i).innerText())) { iLibre = i; break; }
}
ok(iLibre >= 0, 'hay una partida sin metrado imputado que borrar', `${nh} hojas`);
await hojas.nth(iLibre).locator('.cos-prog-quita').click();
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
await btn('Partida');
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
