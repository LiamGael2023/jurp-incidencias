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
await pag.waitForTimeout(1000);
const pts = await pag.evaluate(() => window.__posts || []);
ok(pts.length >= 1, 'hace el POST', pts[0] || '(ninguno)');
ok(pts.some(u => u.includes('/actividades-obra/11/cerrar-partes/')),
   'al endpoint que cierra los partes, no un PATCH al estado',
   (pts[0] || '').split('operations')[1]);
const pch = await pag.evaluate(() => window.__patches || []);
ok(pch.length === 0, 'y NO manda ya un PATCH', JSON.stringify(pch).slice(0, 80));
await pag.waitForTimeout(500);
const t2 = await pag.locator('body').innerText();
ok(t2.includes('Actividad terminada'), 'la pantalla queda marcada como terminada');
ok(t2.includes('Reabrir'), 'con el botón de reabrir');
ok(/EX02, CG01/.test(t2), 'y dice qué máquinas quedaron libres',
   (t2.match(/[^\n]*libres[^\n]*/) || [''])[0]);

console.log('\n== LA FICHA ENSENA LO QUE IMPUTARON LOS PARTES ==');
await pag.goto('http://localhost:5199/pruebas/web/actividades.html',
  { waitUntil: 'networkidle' });
await pag.waitForTimeout(900);
await pag.locator('td', { hasText: 'Excavacion de la caja' }).first().click();
await pag.waitForTimeout(700);
const tf = await pag.locator('body').innerText();
ok(/Esta actividad/i.test(tf) && /toda la obra/i.test(tf),
   'separa lo de la actividad de lo de la obra');
ok(/Imputado/i.test(tf) && /Valorizado/i.test(tf), 'con sus dos columnas');
ok(tf.includes('01.02.04.01.01'), 'la partida tocada');
ok(/Partidas tocadas/i.test(tf), 'la tarjeta cuenta las tocadas');
ok(!/Presupuestado/i.test(tf), 'y ya no hay «presupuestado» inventado',
   (tf.match(/Presupuestado[^\n]*/) || [''])[0]);
ok(/73\.54/.test(tf), 'el saldo es el de la obra', (tf.match(/73[^\n]*/)||[''])[0]);
await pag.screenshot({ path: DIR + '/ficha-partes.png' });

console.log('\n== Y EL FORMULARIO YA NO PIDE PARTIDAS ==');
await pag.keyboard.press('Escape');
await pag.goto('http://localhost:5199/pruebas/web/actividades.html',
  { waitUntil: 'networkidle' });
await pag.waitForTimeout(800);
await pag.locator('button', { hasText: 'Nueva actividad' }).click();
await pag.waitForTimeout(600);
const tn = await pag.locator('body').innerText();
ok(!/partidas que ejecuta/i.test(tn),
   'no hay bloque de declaración en el alta',
   (tn.match(/[^\n]*ejecuta[^\n]*/) || [''])[0]);
ok(/ACTIVIDAD/.test(tn) && /ZONA/.test(tn), 'pero el formulario sigue entero');
await pag.screenshot({ path: DIR + '/alta-simple.png' });

console.log('\n== LA UNIDAD LA MANDA LA PARTIDA ==');
await pag.goto('http://localhost:5199/pruebas/web/actividades.html',
  { waitUntil: 'networkidle' });
await pag.waitForTimeout(900);
await pag.locator('button[title="Costeo y partes diarios"]').first().click();
await pag.waitForTimeout(1300);
await pag.locator('button', { hasText: 'Parte Diario' }).first().click();
await pag.waitForTimeout(1000);
await pag.locator('button').filter({ hasText: /Agregar actividad/i }).first().click();
await pag.waitForTimeout(1000);

const selects = () => pag.locator('select.tbl-form-select');
const porOpcion = async (txt) => {
  for (const s of await selects().all()) {
    const o = await s.locator('option').allInnerTexts();
    if (o.some(x => x.includes(txt))) return s;
  }
  return null;
};

// elegir EXCAVACION, que mide en m3
await (await porOpcion('EXCAVACIÓN DE MATERIAL')).selectOption('EXCAVACION DE MATERIAL');
await pag.waitForTimeout(500);
// bajar a TRABAJOS PRELIMINARES, donde estan las tres de prueba
const nivel = await porOpcion('01.02.01 ·');
if (nivel) { await nivel.selectOption('01.02.01'); await pag.waitForTimeout(500); }

const combo = await porOpcion('01.02.01.90');
ok(!!combo, 'el combo de partidas tiene las tres de prueba');
const estado = await combo.locator('option').evaluateAll(
  os => os.map(o => ({ t: o.textContent.trim(), dis: o.disabled })));
const m3 = estado.find(x => x.t.includes('01.02.01.90'));
const m2 = estado.find(x => x.t.includes('01.02.01.91'));
const glb = estado.find(x => x.t.includes('01.02.01.92'));
ok(m3 && !m3.dis, 'la de m³ se puede elegir (la actividad mide en m³)');
ok(m2 && m2.dis, 'la de m² sale bloqueada', m2 && m2.t.slice(-24));
ok(glb && glb.dis, 'y la de glb también', glb && glb.t.slice(-24));
const tl = await pag.locator('body').innerText();
ok(/solo las que miden en m/i.test(tl), 'y la etiqueta dice la regla antes',
   (tl.match(/solo las que miden[^\n]*/i) || [''])[0]);
await pag.screenshot({ path: DIR + '/unidades.png' });

console.log('\n== AL ELEGIRLA, LA UNIDAD SE FIJA ==');
await combo.selectOption('9001');
await pag.waitForTimeout(600);
const tu = await pag.locator('body').innerText();
ok(/Presupuestado:\s*100/.test(tu.replace(/\s+/g, ' ')), 'enseña el saldo de esa partida',
   (tu.match(/Presupuestado[^\n]*/) || [''])[0]);
const quedan = await pag.locator('select.tbl-form-select').evaluateAll(
  ss => ss.filter(s => [...s.options].some(o => /^m³$|^m²$|^glb$/.test(o.textContent))).length);
ok(quedan === 0, 'el combo de unidad desaparece: la pone la partida', quedan);

console.log('\n== CAMBIAR DE ACTIVIDAD SUELTA LA PARTIDA ==');
await (await porOpcion('EXCAVACIÓN DE MATERIAL')).selectOption('PERFILADO DE TALUD');
await pag.waitForTimeout(700);
const tc = await pag.locator('body').innerText();
ok(/Se quitó la partida 01\.02\.01\.90/.test(tc), 'la suelta y dice por qué',
   (tc.match(/Se quitó[^\n]*/) || [''])[0]);
ok(/está en m3 y esto mide en m²/.test(tc) || /m3.*m²/.test(tc),
   'nombrando las dos unidades', (tc.match(/Se quitó[^\n]*/) || [''])[0]);

console.log('\n== CONSOLA ==');
const graves = err.filter(e => !/favicon|ResizeObserver|ERR_TUNNEL|fonts.googleapis/.test(e));
ok(graves.length === 0, 'sin errores', graves.slice(0, 3).join(' | '));
await nav.close();
console.log('\n' + (f ? `>>> ${f} FALLAN` : '>>> TODO BIEN') + '\n');
process.exit(f ? 1 : 0);
