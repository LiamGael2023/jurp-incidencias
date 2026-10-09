import pw from '/opt/node-tools/node_modules/playwright-core/index.js';
const { chromium } = pw;
const DIR = '/tmp/claude-0/-home-claude-jurp-incidencias/e0331ad9-b646-5636-9f14-d8d9a1af3936/scratchpad/t';
let f = 0;
const ok = (c, m, e) => { console.log((c ? '  OK   ' : '  FALLA') + '  ' + m + (e ? '   ' + e : '')); if (!c) f++; };
const nav = await chromium.launch();
const pag = await (await nav.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
const err = [];
pag.on('pageerror', e => err.push(String(e)));
pag.on('console', m => { if (m.type() === 'error') err.push(m.text()); });
await pag.goto('http://localhost:5199/pruebas/web/actividades.html', { waitUntil: 'networkidle' });
await pag.waitForTimeout(1000);

console.log('\n== DESDE LA LISTA ==');
ok((await pag.locator('body').innerText()).includes('Excavacion de la caja'), 'la actividad sale');
await pag.locator('button[title="Costeo y partes diarios"]').first().click();
await pag.waitForTimeout(1400);
const t = await pag.locator('body').innerText();

console.log('\n== LA PANTALLA DE GESTIÓN ==');
ok(/Gesti.n . ACT-0001/.test(t), 'cabecera con el código de la actividad',
   (t.match(/Gesti[^\n]*/) || [''])[0]);
ok(t.includes('Excavacion de la caja de derivacion'), 'y su nombre de subtítulo');
ok(t.includes('TRATAMIENTO TOMA 10.6') && t.includes('Prog 0+120'),
   'y el proyecto y la zona de detalle');
ok(/MANO DE OBRA/i.test(t), 'mano de obra');
ok(/MATERIALES/i.test(t), 'materiales');
ok(/EQUIPO/i.test(t), 'equipo');

console.log('\n== LAS LÍNEAS DE LA ACTIVIDAD ==');
ok(t.includes('OPERARIO'), 'el personal que cuelga de la actividad');
ok(t.includes('CEMENTO'), 'el material');
ok(t.includes('EXCAVADORA'), 'la máquina');
const tot = (t.match(/Costo Total:\s*S\/\s*([\d,.]+)/) || [])[1];
ok(tot === '1,652.80', 'el total: 200 + 320 + 1,132.80', tot);
await pag.screenshot({ path: DIR + '/gestion-actividad.png' });

console.log('\n== TERMINAR LA ACTIVIDAD ==');
ok(t.includes('Terminar actividad'), 'el botón dice «Terminar actividad», no «Cerrar incidencia»');
ok(!t.includes('Cerrar incidencia'), 'y no habla de incidencias');
await pag.locator('button', { hasText: 'Terminar actividad' }).click();
await pag.waitForTimeout(900);
const pts = await pag.evaluate(() => window.__patches);
ok(pts.length >= 1, 'manda el PATCH', JSON.stringify(pts[0] || {}).slice(0, 110));
if (pts.length) {
  ok(pts[0].url.includes('/actividades-obra/11/'), 'a la actividad', pts[0].url.split('operations')[1]);
  ok(pts[0].body.estado === 'terminada', 'con estado terminada', pts[0].body.estado);
}
await pag.waitForTimeout(400);
const t2 = await pag.locator('body').innerText();
ok(t2.includes('Actividad terminada'), 'y la pantalla queda marcada como terminada');
ok(t2.includes('Reabrir'), 'con el botón de reabrir');

console.log('\n== CONSOLA ==');
const graves = err.filter(e => !/favicon|ResizeObserver|ERR_TUNNEL|fonts.googleapis/.test(e));
ok(graves.length === 0, 'sin errores', graves.slice(0, 3).join(' | '));
await nav.close();
console.log('\n' + (f ? `>>> ${f} FALLAN` : '>>> TODO BIEN') + '\n');
process.exit(f ? 1 : 0);
