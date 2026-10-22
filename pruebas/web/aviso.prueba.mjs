/* Que cuando los datos no llegan, la pantalla diga por que.
 *
 *     npx vite --port 5199 --strictPort &
 *     node pruebas/web/aviso.prueba.mjs
 *
 * El fallo original no era que fallara una peticion: era que fallara y
 * nadie se enterara. "Desaparecen las incidencias y lo del mapa" describe
 * las tres causas a la vez, porque las tres se veian igual.
 */
import pw from '/opt/node-tools/node_modules/playwright-core/index.js';
import { medidorDe, MINIMO } from './contraste.mjs';

const BASE = 'http://localhost:5199/pruebas/web/aviso.html';
const r = [];
const ok = (c, m, e) => { r.push(!!c); console.log(`${c ? 'ok  ' : 'MAL '} ${m}${e ? `   [${e}]` : ''}`); };

const b = await pw.chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
const errs = [];
p.on('pageerror', e => errs.push(String(e)));

const ir = async (v) => {
  await p.goto(`${BASE}?v=${v}`, { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('.avs', { timeout: 10000 });
  await p.waitForTimeout(250);
};

// ══════════ LA SESION ══════════
await ir('sesion');
const t1 = await p.locator('.avs').innerText();
ok(/vuelve a entrar/i.test(t1), 'un 401 dice que hay que volver a entrar',
   t1.replace(/\n/g, ' ').slice(0, 80));
ok(/3 h 20 min/.test(t1),
   'y cuánto llevaba abierta la sesión: si el token caduca, ese número se repite',
   t1.replace(/\n/g, ' '));
ok(await p.locator('.avs-sesion').count() === 1, 'con su propio color');
ok(await p.locator('.avs-btn-ok').innerText() === 'Volver a entrar',
   'y el botón que toca');

// NO cierra la sesión solo: puede haber un parte a medio escribir.
ok(await p.evaluate(() => localStorage.getItem('userToken')) === 'token-de-prueba',
   'y NO tira el token solo: la decisión es de quien está delante');
await p.locator('.avs-btn-ok').click();
await p.waitForTimeout(200);
ok(await p.evaluate(() => window.__SALIO) === true,
   'solo al pulsarlo se sale');
ok(await p.locator('.avs').count() === 0, 'y el cartel se va');

// ══════════ EL SERVIDOR ══════════
await ir('servidor');
const t2 = await p.locator('.avs').innerText();
ok(!/vuelve a entrar/i.test(t2),
   'un 504 NO manda volver a entrar: no es tu sesión',
   t2.replace(/\n/g, ' ').slice(0, 80));
ok(/504/.test(t2), 'dice el código', t2.replace(/\n/g, ' '));
ok(await p.locator('.avs-otro').count() === 1, 'y usa el otro color');
ok(/reintentar/i.test(await p.locator('.avs-btn-ok').innerText()),
   'ofreciendo reintentar, que es lo que sirve aquí');

// ══════════ LA RED ══════════
await ir('red');
const t3 = await p.locator('.avs').innerText();
ok(/conexión/i.test(t3), 'un corte de red habla de la conexión',
   t3.replace(/\n/g, ' ').slice(0, 70));
ok(!/código/.test(t3), 'y no inventa un código que no hubo');

// Los tres textos son distintos: si dijeran lo mismo, no servirían.
ok(new Set([t1, t2, t3]).size === 3, 'los tres casos dicen cosas distintas');

// ══════════ CINCO FALLOS, UN CARTEL ══════════
await ir('muchos');
ok(await p.locator('.avs').count() === 1,
   'cinco peticiones fallando a la vez dan UN cartel, no cinco',
   `${await p.locator('.avs').count()}`);

// ══════════ QUE SE LEA ══════════
await ir('sesion');
const flojos = (await medidorDe(p)('.avs-txt b, .avs-dato, .avs-btn'))
  .filter(f => f.visible && f.texto && f.ratio < MINIMO);
ok(flojos.length === 0, 'todo el aviso pasa AA',
   flojos.map(f => `"${f.texto}" ${f.ratio}:1`).join(' | '));

// Por encima de todo: el mapa ocupa la pantalla entera.
const z = await p.evaluate(() =>
  Number(getComputedStyle(document.querySelector('.avs')).zIndex));
ok(z >= 200000, 'y va por encima de los modales de la app', `${z}`);

ok(errs.length === 0, 'sin errores de JavaScript', errs.join(' | ').slice(0, 200));

await b.close();
const mal = r.filter(x => !x).length;
console.log(`\n${r.length - mal} de ${r.length} en orden${mal ? `, ${mal} MAL` : ''}.`);
process.exit(mal ? 1 : 0);
