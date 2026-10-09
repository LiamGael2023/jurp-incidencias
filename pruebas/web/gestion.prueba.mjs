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
await pag.goto('http://localhost:5199/pruebas/web/gestion.html', { waitUntil: 'networkidle' });
await pag.waitForTimeout(1200);
const t = await pag.locator('body').innerText();

console.log('\n== LA PANTALLA SALE ==');
ok(/Gesti.n . INCIDENTE-002-14082026/.test(t), 'cabecera con el título del sujeto',
   (t.match(/Gesti[^\n]*/) || [''])[0]);
ok(t.includes('Otros en C-08'), 'y el subtítulo');
ok(t.includes('CANAL LATERAL 10 C-08'), 'y el detalle');
ok(/MANO DE OBRA/i.test(t), 'sección de mano de obra');
ok(/MATERIALES/i.test(t), 'sección de materiales');
ok(/EQUIPO/i.test(t), 'sección de equipo');

console.log('\n== LOS DATOS ==');
ok(t.includes('OPERARIO'), 'la línea de personal');
ok(t.includes('ALIMENTACION'), 'las de materiales');
ok(!t.includes('DE OTRO'), 'y NO las de otro incidente (filtra por el vínculo)');
ok(t.includes('VOLQUETE'), 'la máquina');
ok(/S\/ 208\.00/.test(t), 'importes de materiales');
ok(/508\.00/.test(t), 'subtotal de materiales 208 + 300', (t.match(/Subtotal[^\n]*/g)||[]).join(' | '));
ok(/1,510\.40/.test(t), 'equipo 8 h × 188.80 = 1,510.40',
   (t.match(/1,5[\d.,]*/g)||[]).join(','));
ok(/Costo Total/.test(t), 'el costo total está');
const total = (t.match(/Costo Total:\s*S\/\s*([\d,.]+)/) || [])[1];
ok(total === '2,218.40', 'y suma 200 + 508 + 1,510.40', total);

console.log('\n== LOS BOTONES ==');
ok(t.includes('Guardar Costeos'), 'guardar');
ok(t.includes('Cerrar incidencia'), 'y el cierre, con el texto del sujeto');
ok(/PDF/.test(t) && /Excel/.test(t), 'PDF y Excel');
await pag.screenshot({ path: DIR + '/gestion.png' });

console.log('\n== EL VÍNCULO ==');
// La misma pantalla con el otro campo de vinculo: las mismas filas, que
// cuelgan de un incidente, ya no son suyas y no deben salir.
await pag.goto('http://localhost:5199/pruebas/web/gestion.html?vinculo=actividad_obra',
  { waitUntil: 'networkidle' });
await pag.waitForTimeout(1200);
const t2 = await pag.locator('body').innerText();
ok(/Gesti.n/.test(t2), 'la pantalla sigue saliendo');
ok(!t2.includes('OPERARIO') && !t2.includes('ALIMENTACION') && !t2.includes('VOLQUETE'),
   'y no enseña lo que cuelga de un incidente',
   (t2.match(/OPERARIO|ALIMENTACION|VOLQUETE/g) || []).join(','));
const tot2 = (t2.match(/Costo Total:\s*S\/\s*([\d,.]+)/) || [])[1];
ok(tot2 === '0.00', 'el total es cero', tot2);

console.log('\n== CONSOLA ==');
const graves = err.filter(e => !/favicon|ResizeObserver|ERR_TUNNEL|fonts.googleapis/.test(e));
ok(graves.length === 0, 'sin errores', graves.slice(0, 3).join(' | '));
await nav.close();
console.log('\n' + (f ? `>>> ${f} FALLAN` : '>>> TODO BIEN') + '\n');
process.exit(f ? 1 : 0);
