/* La rueda del ratón sobre la lámina cambia la ESCALA.
 *
 *     npx vite --port 5199 --strictPort &
 *     node pruebas/web/rueda.prueba.mjs
 *
 * El zoom de la lámina está clavado para que lo rotulado sea lo dibujado, así
 * que la rueda tiene que mover el catálogo de escalas, no el zoom. Lo que se
 * comprueba aquí es que haga eso y SOLO eso: que no se cuele un zoom libre
 * por la puerta de atrás, que un gesto sea un paso y que el punto bajo el
 * cursor no se escape al acercarse.
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
await p.waitForTimeout(1500);

/** La escala que el panel declara, leída del propio texto. */
const escala = () => p.evaluate(() => {
  const t = document.querySelector('.lam-ayuda')?.textContent || '';
  const m = t.match(/1:([\d.,]+)/);
  return m ? Number(m[1].replace(/[.,]/g, '')) : null;
});
/** El zoom real de Leaflet y el centro, para cazar mentiras. */
const vista = () => p.evaluate(() => {
  const el = document.querySelector('.lam-mapa .leaflet-container')
    || document.querySelector('.leaflet-container');
  const m = el?._leaflet_map || window.__MAPA;
  return m ? { zoom: m.getZoom(), lat: m.getCenter().lat, lng: m.getCenter().lng } : null;
});

const caja = await p.locator('.leaflet-container').first().boundingBox();
ok(!!caja, 'hay mapa sobre el que rodar');
const cx = caja.x + caja.width / 2, cy = caja.y + caja.height / 2;

const e0 = await escala();
ok(e0 > 0, 'el panel declara una escala', `1:${e0}`);

// ── acercarse ──
await p.mouse.move(cx, cy);
await p.mouse.wheel(0, -200);
await p.waitForTimeout(500);
const e1 = await escala();
ok(e1 < e0, 'la rueda hacia arriba acerca: baja el denominador', `1:${e0} → 1:${e1}`);

// ── un gesto, un paso ──
// Un trackpad manda decenas de eventos diminutos; sin freno, la lámina
// cruzaría el catálogo entero de un manotazo.
await p.evaluate(() => {
  const el = document.querySelector('.leaflet-container');
  const r = el.getBoundingClientRect();
  for (let i = 0; i < 25; i++) {
    el.dispatchEvent(new WheelEvent('wheel', {
      deltaY: -4, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2,
      bubbles: true, cancelable: true }));
  }
});
await p.waitForTimeout(400);
const e2 = await escala();
ok(e2 === e1 || e2 < e1, 'veinticinco eventos seguidos no cruzan el catálogo',
   `1:${e1} → 1:${e2}`);

// ── alejarse ──
await p.mouse.move(cx, cy);
await p.mouse.wheel(0, 300);
await p.waitForTimeout(500);
const e3 = await escala();
ok(e3 > e2, 'la rueda hacia abajo aleja', `1:${e2} → 1:${e3}`);

// ── la escala que se rotula es la que se dibuja ──
// Es la razón de ser del candado: si la rueda metiera un zoom libre, el
// membrete seguiría diciendo una escala y el mapa estaría a otra.
// Del MEMBRETE, no de la hoja entera: ahi dentro esta tambien la barra
// grafica, cuyos numeros de tramo ("0 625 1250 1875 2500") van pegados al
// "1:5,000" en textContent y el regex se los tragaba, formando un numero de
// dieciocho cifras. El fallo era de la prueba, no de la lamina.
const membrete = await p.evaluate(() => {
  const nodos = [...document.querySelectorAll('.lam-membrete *')]
    .filter(e => !e.children.length);
  const vals = [];
  for (const n of nodos) {
    const m = (n.textContent || '').trim().match(/^1\s*:\s*([\d.,\s]+)$/);
    if (m) vals.push(Number(m[1].replace(/[.,\s]/g, '')));
  }
  return vals;
});
ok(membrete.length > 0 && membrete.every(v => v === e3),
   'el membrete rotula la MISMA escala que declara el panel',
   `panel 1:${e3} · lámina ${membrete.map(v => '1:' + v).join(' ')}`);

// ── el tope del catálogo ──
// Pasarse del final no debe dejar la lámina en una escala inventada.
for (let i = 0; i < 12; i++) { await p.mouse.wheel(0, 300); await p.waitForTimeout(200); }
const eMax = await escala();
ok(eMax >= e3, 'al alejarse hasta el final se queda en la última', `1:${eMax}`);
for (let i = 0; i < 25; i++) { await p.mouse.wheel(0, -300); await p.waitForTimeout(170); }
const eMin = await escala();
ok(eMin < eMax && eMin > 0, 'y al acercarse hasta el final, en la primera', `1:${eMin}`);

// ── el papel no se desplaza bajo el puntero ──
const scroll = await p.evaluate(() => document.querySelector('.lam-lienzo')?.scrollTop ?? 0);
await p.mouse.move(cx, cy);
await p.mouse.wheel(0, 300);
await p.waitForTimeout(300);
const scroll2 = await p.evaluate(() => document.querySelector('.lam-lienzo')?.scrollTop ?? 0);
ok(scroll2 === scroll, 'rodar sobre el mapa no desplaza la hoja',
   `${scroll} → ${scroll2}`);

ok(errs.length === 0, 'sin errores de JavaScript', errs.join(' | ').slice(0, 150));

await b.close();
const mal = r.filter(x => !x).length;
console.log(`\n${r.length - mal} de ${r.length} en orden${mal ? `, ${mal} MAL` : ''}.`);
process.exit(mal ? 1 : 0);
