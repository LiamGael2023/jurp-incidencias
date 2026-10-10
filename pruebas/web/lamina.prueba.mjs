/* Comprueba la Lámina temática montada de verdad en un navegador.
 *
 *     npx vite --port 5199 --strictPort &
 *     node pruebas/web/lamina.prueba.mjs
 *
 * Lo que se mira aquí no se ve leyendo el fichero:
 *
 *   - el membrete lleva SOLO el logo, sin el bloque de texto que repetía lo
 *     que el propio logo ya trae impreso;
 *   - el selector de escala sale agrupado por para qué sirve cada lámina;
 *   - y sobre todo: LO ROTULADO ES LO DIBUJADO. El membrete dice una escala
 *     y el mapa tiene que estar a esa, no a la de antes. Con 1:200 en el
 *     catálogo ese desfase pasó de un factor 2 a uno de 50, así que se
 *     comprueba escala por escala en vez de confiar en que el candado de
 *     zoom hace lo suyo.
 *
 * Las teselas van cortadas a propósito: desde aquí no hay red, y la pantalla
 * tiene que aguantarlo. Una lámina sin fondo sigue siendo una lámina.
 */
import pw from '/opt/node-tools/node_modules/playwright-core/index.js';

const URL = 'http://localhost:5199/pruebas/web/lamina.html';
const ESCALAS = ['200', '500', '1000', '2000', '2500', '5000', '10000', '20000', '25000'];

const r = [];
const ok = (c, m, e) => { r.push(!!c); console.log(`${c ? 'ok  ' : 'MAL '} ${m}${e ? `   [${e}]` : ''}`); };
const n = (s) => Number(String(s).replace(/[.,]/g, ''));

const b = await pw.chromium.launch();
const p = await b.newPage({ viewport: { width: 1700, height: 1100 } });
const errs = [];
p.on('pageerror', e => errs.push(String(e)));
for (const t of ['**://mt1.google.com/**', '**://server.arcgisonline.com/**',
  '**://*.tile.opentopomap.org/**', '**://*.basemaps.cartocdn.com/**',
  '**://*.tile.openstreetmap.org/**'])
  await p.route(t, x => x.abort());

await p.goto(URL, { waitUntil: 'domcontentloaded' });
await p.waitForSelector('.lam-membrete', { timeout: 15000 });
await p.waitForTimeout(2500);

// ── El membrete ──────────────────────────────────────────────────────────
const mem = await p.evaluate(() => ({
  entidad: !!document.querySelector('.lam-entidad'),
  logos: document.querySelectorAll('.lam-logo').length,
  // offsetHeight y NO getBoundingClientRect: la hoja se dibuja a tamaño de
  // papel y se encoge con un `zoom` de CSS para caber en la pantalla, así
  // que el rect devuelve 25 px donde el papel tiene 42. Lo que importa es
  // el papel, que es lo que se imprime.
  alto: document.querySelector('.lam-logo')?.offsetHeight || 0,
  desborda: (() => { const m = document.querySelector('.lam-membrete');
    return m.scrollHeight > m.clientHeight + 1; })(),
}));
ok(!mem.entidad, 'el membrete ya no repite el nombre de la Junta en texto');
ok(mem.logos === 1, 'y lleva el logo, uno solo', mem.logos);
ok(mem.alto >= 35, 'el logo ocupa el sitio que dejó el texto', mem.alto + ' px');
ok(!mem.desborda, 'y el membrete no se desborda por haberlo agrandado');

// ── El selector ──────────────────────────────────────────────────────────
const g = await p.evaluate(() => [...document.querySelectorAll('.lam-escala optgroup')]
  .filter(x => /^1:/.test(x.children[0]?.textContent || ''))
  .map(x => ({ t: x.label, v: [...x.children].map(o => o.value) })));
ok(g.length === 3, 'las escalas salen en tres grupos, no en una lista corrida', g.length);
ok(g[0]?.v.join() === '200,500', 'el primero es el de detalle', g[0]?.v.join(' '));
ok(g.flatMap(x => x.v).join() === ESCALAS.join(),
   'y entre los tres están todas, de más cerca a más lejos');

// ── Lo rotulado es lo dibujado ───────────────────────────────────────────
for (const v of ESCALAS) {
  await p.selectOption('.lam-escala', v);
  await p.waitForTimeout(700);
  const o = await p.evaluate(() => {
    const m = document.querySelector('.lam-estado').innerText.replace(/\s+/g, ' ');
    return { real: (/escala real 1:([\d.,]+)/.exec(m) || [])[1],
             rot: document.querySelector('.lam-datos .grande').textContent };
  });
  ok(o.real && Math.abs(n(o.real) - n(v)) / n(v) < 0.02,
     `${o.rot}: el mapa está dibujado a esa escala`, 'dibuja 1:' + o.real);
}

// ── El buscador de estructuras ───────────────────────────────────────────
// Lo que de verdad se comprueba aquí es que buscar CENTRA y no ACERCA. En el
// visor, elegir un resultado vuela a zoom 17; si esta pantalla reutilizara
// aquella acción, el candado del zoom saltaría y el membrete quedaría
// rotulando una escala que ya no es la dibujada.
const ESC = '2500';
await p.selectOption('.lam-escala', ESC);
await p.waitForTimeout(700);

const centroDe = () => p.evaluate(() => {
  const t = document.querySelector('.lam-estado').innerText.replace(/\s+/g, ' ');
  const u = /UTM \S+ E (\d+) N (\d+)/.exec(t);
  return { utm: u ? `${u[1]},${u[2]}` : null,
           real: (/escala real 1:([\d.,]+)/.exec(t) || [])[1] };
});
const antes = await centroDe();

const buscador = '.lam-buscador input';
ok(await p.isEnabled(buscador), 'el buscador se habilita cuando llega el índice');

// Sin tilde tiene que encontrar la que la lleva: es el índice del visor.
await p.fill(buscador, 'chacarra');
await p.waitForTimeout(400);
const res = await p.evaluate(() => [...document.querySelectorAll('.lam-buscador-lista button')]
  .map(b => b.innerText.replace(/\s+/g, ' ').trim()));
ok(res.length === 1 && /Chacarr/.test(res[0]),
   'busca sin acentos: «chacarra» encuentra «Canoa Chacarrá»', res.join(' | '));
ok(/Canoas/.test(res[0]) && /45\+300/.test(res[0]),
   'y el resultado dice de qué capa es y en qué progresiva', res[0]);

// Dos que comparten prefijo: tienen que salir las dos, no la primera.
await p.fill(buscador, 'toma 10');
await p.waitForTimeout(400);
ok(await p.evaluate(() => document.querySelectorAll('.lam-buscador-lista button').length) === 2,
   '«toma 10» devuelve las dos tomas, no solo una');

// Y por progresiva, que es otro de los campos del índice.
await p.fill(buscador, '12+000');
await p.waitForTimeout(400);
ok(await p.evaluate(() => /Alcantarilla/.test(
  document.querySelector('.lam-buscador-lista button')?.innerText || '')),
   'también se busca por progresiva');

// Elegir: centra en la estructura y NO cambia la escala.
await p.click('.lam-buscador-lista button');
await p.waitForTimeout(900);
const despues = await centroDe();
ok(despues.utm && despues.utm !== antes.utm,
   'elegir un resultado mueve el encuadre', `${antes.utm} → ${despues.utm}`);
ok(n(despues.real) === n(ESC),
   'y la escala sigue siendo la elegida: buscar centra, no acerca',
   `rotulada 1:${ESC}, dibujada 1:${despues.real}`);
ok(await p.evaluate(() => document.querySelectorAll('.lam-buscador-lista').length === 0),
   'la lista se cierra al elegir');

// ── El panel cabe en una pantalla ────────────────────────────────────────
// Medía 2.706 px de alto —dos pantallas y media— y había que recorrerlo
// entero para llegar a exportar. Lo que lo hacía largo son los rótulos del
// membrete y la lista de capas: se escriben una vez para toda la serie,
// así que van plegados.
const pan = await p.evaluate(() => {
  const c = document.querySelector('.lam-panel-cuerpo');
  const a = document.querySelector('.lam-acciones');
  return { alto: c.scrollHeight, hueco: c.clientHeight,
    secs: [...document.querySelectorAll('.lam-sec')].map(s => ({
      nom: s.querySelector('.lam-sec-nom').textContent,
      abierta: s.classList.contains('abierta'),
      res: s.querySelector('.lam-sec-res')?.textContent || '',
      oculto: s.querySelector('.lam-sec-cuerpo').hidden })),
    exportarALaVista: a.getBoundingClientRect().bottom <= window.innerHeight + 1,
    // El buscador NO va dentro de una sección: un atajo detrás de un
    // desplegable deja de ser un atajo.
    buscadorFuera: !document.querySelector('.lam-sec .lam-buscador') };
});
ok(pan.secs.length === 3, 'el panel se reparte en tres secciones',
   pan.secs.map(s => s.nom).join(' · '));
ok(pan.secs[0].abierta && !pan.secs[1].abierta && !pan.secs[2].abierta,
   'abre solo la del encuadre, que es la que se toca en cada lámina');
ok(pan.secs.slice(1).every(s => s.oculto && s.res),
   'y las cerradas dicen qué llevan dentro sin abrirlas',
   pan.secs.slice(1).map(s => s.res).join(' | '));
ok(pan.buscadorFuera, 'el buscador queda fuera de las secciones');
ok(pan.alto <= pan.hueco + 1, 'todo cabe sin desplazar',
   `${pan.alto} px de contenido en ${pan.hueco} px de hueco`);
ok(pan.exportarALaVista, 'y PNG/PDF se ven sin recorrer el panel');

// Abrir una sección no debe esconder los botones: están fuera del scroll.
await p.click('.lam-sec:nth-of-type(3) .lam-sec-tit');
await p.waitForTimeout(300);
const tras = await p.evaluate(() => {
  const a = document.querySelector('.lam-acciones');
  const s = document.querySelectorAll('.lam-sec')[2];
  return { abierta: s.classList.contains('abierta'),
           campos: s.querySelectorAll('input, textarea').length,
           exportar: a.getBoundingClientRect().bottom <= window.innerHeight + 1 };
});
ok(tras.abierta && tras.campos > 5, 'desplegar los rótulos saca sus campos', tras.campos);
ok(tras.exportar, 'y PNG/PDF siguen a la vista con la sección abierta');
await p.click('.lam-sec:nth-of-type(3) .lam-sec-tit');
await p.waitForTimeout(300);

// ── El temblor al plegar el rail ─────────────────────────────────────────
// Se encoge el hueco como lo encoge el rail —0,35 s de transición— y se
// cuentan los cuadros largos. El culpable era `--lam-zoom`: es un `zoom` de
// CSS sobre la hoja, y por debajo cuelgan los 700 marcadores con sus rótulos,
// así que cada cambio los recoloca todos. Antes se aplicaban once tamaños
// intermedios que a nadie le interesan; ahora solo el final.
const temblor = await p.evaluate(async () => {
  const l = document.querySelector('.lam-lienzo');
  const w0 = l.clientWidth;
  const zooms = new Set(); const cuadros = [];
  let t0 = performance.now();
  for (let i = 1; i <= 21; i++) {
    l.style.flex = `0 0 ${w0 - i * 9}px`;
    await new Promise(r => requestAnimationFrame(r));
    const t = performance.now(); cuadros.push(t - t0); t0 = t;
    zooms.add(getComputedStyle(l).getPropertyValue('--lam-zoom').trim());
  }
  await new Promise(r => setTimeout(r, 1200));
  const fin = getComputedStyle(l).getPropertyValue('--lam-zoom').trim();
  zooms.add(fin);
  // El hueco real al terminar, no el que se pidió: el `flex-basis` puede
  // quedar por encima del mínimo de contenido y entonces no mide lo pedido.
  const ancho = l.clientWidth;
  l.style.flex = '';
  return { pasos: zooms.size, largos: cuadros.filter(c => c > 50).length,
           peor: Math.round(Math.max(...cuadros)), fin: +fin, ancho };
});
ok(temblor.pasos <= 3,
   'plegar el rail no rehace la hoja en cada paso de la animación',
   `${temblor.pasos} tamaños aplicados`);
ok(temblor.largos <= 3,
   'y no deja cuadros largos: eso es lo que se veía temblar',
   `${temblor.largos} de 21 por encima de 50 ms, el peor ${temblor.peor} ms`);
// Esperar no vale de nada si al final la hoja no acaba del tamaño correcto.
ok(Math.abs(temblor.fin - Math.min(1, (temblor.ancho - 56) / (841 * 2))) < 0.02,
   'y al soltar, la hoja queda del tamaño del hueco nuevo', temblor.fin);

ok(errs.length === 0, 'ningún error de JS en toda la prueba', errs.join(' | '));

const mal = r.filter(x => !x).length;
console.log(`\n${r.length - mal}/${r.length} bien`);
await b.close();
process.exit(mal ? 1 : 0);
