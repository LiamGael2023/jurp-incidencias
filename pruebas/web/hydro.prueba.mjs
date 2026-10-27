/* Distribución, en el navegador.
 *
 *     npx vite --port 5199 --strictPort &
 *     node pruebas/web/hydro.prueba.mjs
 *
 * LO QUE SE MIDE AQUI Y NO EN hydro_datos.prueba.mjs. Aquella comprueba que
 * los números salgan bien de la respuesta; esta, que lleguen a la pantalla
 * y signifiquen lo que parecen. Son fallos distintos: un normalizador
 * perfecto no impide que el menú tape la primera tarjeta, que el color de
 * la 10.5 cambie al filtrar, o que un panel que no entendió la respuesta
 * dibuje un lienzo en blanco —que se lee como «no hubo caudal»—.
 */
import pw from '/opt/node-tools/node_modules/playwright-core/index.js';

const BASE = 'http://localhost:5199/pruebas/web/hydro.html';
const r = [];
const ok = (c, m, e) => { r.push(!!c); console.log(`${c ? 'ok  ' : 'MAL '} ${m}${e ? `   [${e}]` : ''}`); };

const b = await pw.chromium.launch();
const p = await b.newPage({ viewport: { width: 1600, height: 1000 } });
const errs = [];
p.on('pageerror', (e) => errs.push(String(e)));

await p.goto(BASE, { waitUntil: 'domcontentloaded' });
await p.waitForSelector('.hm', { timeout: 15000 });
await p.waitForTimeout(1200);

/* ══════════ 1. el hueco del rail ══════════ */
const RAIL = 286;   // el valor por defecto de --rail-w

const cab = await p.locator('.hm-head').evaluate(
  (el) => parseFloat(getComputedStyle(el).paddingLeft));
ok(cab >= RAIL, 'la cabecera le deja sitio al rail', `${cab}px`);

const cuerpo = await p.locator('.hm-body').evaluate(
  (el) => parseFloat(getComputedStyle(el).paddingLeft));
ok(cuerpo >= RAIL, 'y el cuerpo también', `${cuerpo}px`);

/* El padding puede estar bien y el contenido salirse igual, así que se
 * pregunta por lo que de verdad se pinta. */
const izq = await p.locator('.hm-toma').first().evaluate(
  (el) => el.getBoundingClientRect().left);
ok(izq >= RAIL, 'la primera tarjeta empieza a la derecha del menú',
   `${Math.round(izq)}px`);

/* ══════════ 2. el resumen por toma ══════════ */
const tarjetas = p.locator('.hm-toma');
ok(await tarjetas.count() === 5, 'sale una tarjeta por toma',
   `${await tarjetas.count()}`);

const primera = (await tarjetas.first().innerText()).toLowerCase();
ok(primera.includes('10.2'), 'la primera es la 10.2');
ok(primera.includes('130.00'), 'con su caudal en l/s, sin convertir');
ok(primera.includes('197.00'), 'y su turbidez');
ok(primera.includes('26/10/2026 16:00'), 'y la hora de la última lectura');

/* EL ESTADO NO VA SOLO EN EL COLOR. Quien no distingue rojo de verde tiene
 * que poder leerlo igual, así que la insignia lleva icono y palabra. */
const insignia = tarjetas.first().locator('.hm-insignia');
ok((await insignia.innerText()).toLowerCase().includes('muy bajo'),
   'el estado se dice con palabras, no solo con color');
ok(await insignia.locator('svg').count() === 1, 'y lleva su icono');

/* Y que el color no sea el mismo para todos, que sería no decir nada. */
const colores = await tarjetas.evaluateAll(
  (els) => els.map((e) => getComputedStyle(e).borderLeftColor));
ok(new Set(colores).size >= 3, 'los estados se distinguen entre sí',
   `${new Set(colores).size} colores`);

/* ══════════ 3. el eje se ordena ══════════ */
/* Las series llegan con las horas desordenadas a propósito. Si el eje
 * saliera en orden de llegada, el gráfico dibujaría una línea que baja y
 * vuelve a subir sin que el agua haya hecho nada de eso. */
await p.waitForSelector('.apexcharts-canvas', { timeout: 10000 });
await p.waitForTimeout(500);

/* Cada rótulo de eje es un <text> con un <tspan> y un <title> dentro, así
 * que textContent devuelve «01:0001:00». Se lee el tspan. */
const textos = (g) => [...g.querySelectorAll('text')]
  .map((t) => (t.querySelector('tspan') || t).textContent.trim());

const ejeX = await p.locator('.apexcharts-xaxis-texts-g').first().evaluate(textos);
ok(JSON.stringify(ejeX) === JSON.stringify(['01:00', '02:00', '03:00', '04:00']),
   'las horas salen en orden cronológico', ejeX.join(' '));

/* ══════════ 4. el color sigue a la toma, no a su puesto ══════════ */
/* El color se lee del trazo de la serie y no de la leyenda: la leyenda
 * pinta su marca con un <path> dentro de un <svg>, y preguntarle el
 * `background` al <span> devuelve «rgba(0,0,0,0)» para TODAS. Comparar dos
 * transparentes da igualdad siempre, así que la comprobación habría pasado
 * aunque el color sí cambiase. Pasó, de hecho, antes de mirar el DOM.
 *
 * ApexCharts además saca puntos y espacios del nombre: «10.5» acaba en
 * seriesName="10x5". */
const trazos = async (n) => p.locator('.apexcharts-canvas').nth(n)
  .evaluate((c) => [...c.querySelectorAll('.apexcharts-series')].map((s) => ({
    nombre: s.getAttribute('seriesName'),
    color: s.querySelector('path')?.getAttribute('stroke'),
  })));

const antes = await trazos(0);
ok(antes.length === 7, 'el primer gráfico trae las siete tomas', `${antes.length}`);
const color105 = antes.find((x) => x.nombre === '10x5')?.color;
ok(!!color105 && /rgba?\(/.test(color105),
   'la 10.5 tiene un color de verdad, no un transparente', color105);
/* Y que ese color sea el de la paleta y no el que ApexCharts trae de
 * fábrica: #1268C3 es el azul de HYDROMETRIX, el primero de la lista. */
ok((antes.find((x) => x.nombre === '10x2')?.color || '').includes('18,104,195'),
   'la primera toma lleva el azul del módulo',
   antes.find((x) => x.nombre === '10x2')?.color);
ok(new Set(antes.map((x) => x.color)).size === 7,
   'y las siete tomas llevan siete colores distintos');

// Se filtra a dos tomas: 10.4 y 10.5.
const panel = p.locator('.hm-tarjeta').filter({ hasText: 'Caudal de ingreso' }).first();
await panel.locator('.hm-desplegable').click();
await p.waitForTimeout(200);
await panel.locator('.hm-menu-item', { hasText: '10.4' }).first().click();
await panel.locator('.hm-menu-item', { hasText: '10.5' }).first().click();
await p.keyboard.press('Escape');
await p.waitForTimeout(900);

const despues = await trazos(0);
/* Que el filtro haya filtrado. Sin esto la comprobación siguiente pasaría
 * sola: con las siete series intactas nadie puede ocupar el puesto de la
 * 10.5, y «conserva su color» no diría nada. */
ok(despues.length === 2, 'el filtro deja dos tomas', `${despues.length} series`);
const color105b = despues.find((x) => x.nombre === '10x5')?.color;
ok(!!color105b && color105b === color105,
   'la 10.5 conserva su color después de filtrar',
   `${color105} → ${color105b}`);

/* ══════════ 5. la unidad ══════════ */
/* Lo guardado son l/s y la pantalla enseña m3/h: ×3,6. Si el conmutador no
 * hiciera nada, o lo hiciera dos veces, el número seguiría pareciendo
 * razonable y nadie lo notaría hasta compararlo con el papel. */
const topeY = async () => {
  const t = await p.locator('.apexcharts-canvas').nth(1)
    .evaluate((c) => [...c.querySelectorAll('.apexcharts-yaxis text')]
      .map((e) => (e.querySelector('tspan') || e).textContent.trim()));
  const n = t.map((x) => parseFloat(String(x).replace(/[^\d.-]/g, '')))
    .filter(Number.isFinite);
  return n.length ? Math.max(...n) : NaN;
};
const enM3h = await topeY();
const salida = p.locator('.hm-tarjeta').filter({ hasText: 'Caudal de salida' }).first();
await salida.locator('.hm-pastilla', { hasText: 'l/s' }).click();
await p.waitForTimeout(800);
const enLs = await topeY();
ok(enM3h > enLs, 'en m3/h el eje llega más alto que en l/s', `${enM3h} → ${enLs}`);
const razon = enM3h / enLs;
ok(razon > 2.5 && razon < 5, 'y la razón entre los dos ronda 3,6', razon.toFixed(2));

/* ══════════ 6. lo que no se entiende, se dice ══════════ */
/* «Volumen por tomas» recibe una respuesta con otra forma. Un lienzo en
 * blanco ahí diría «no hubo volumen», que es una afirmación sobre el agua
 * que el programa no está en condiciones de hacer. */
const vol = p.locator('.hm-tarjeta').filter({ hasText: 'Volumen por tomas' }).first();
const diag = vol.locator('.hm-aviso-diag');
ok(await diag.count() === 1, 'el panel que no entiende la respuesta lo dice');
ok((await diag.innerText()).includes('detalle_raro'),
   'y enseña las claves que llegaron, que es lo que hace falta para arreglarlo');
ok(await vol.locator('.apexcharts-canvas').count() === 0,
   'y no dibuja un lienzo vacío en su lugar');
/* Y que nombre la ruta DE VERDAD. Este panel llegó a pedir sus datos a
 * `series/` teniendo ruta propia; el aviso decía `series/` y habría mandado
 * a buscar el fallo al sitio equivocado. */
ok((await diag.innerText()).includes('volumes/by-toma/'),
   'y nombra la ruta que falló, no otra');

/* ══════════ 6b. tres series que no son tomas, tres colores ══════════ */
/* «Caudal total vs Excedencia» no lleva tomas sino agregados —captación,
 * entrega, excedencia—. Al no estar en el catálogo, los tres cayeron en el
 * mismo color: un gráfico de tres líneas del mismo rosa, que informa lo
 * mismo que uno de una. */
const totalIdx = await p.locator('.hm-tarjeta').evaluateAll(
  (els) => els.findIndex((e) => e.textContent.includes('Caudal total vs')));
const canvasTotal = await p.locator('.apexcharts-canvas').evaluateAll(
  (cs) => cs.map((c) => [...c.querySelectorAll('.apexcharts-series')]
    .map((s) => s.querySelector('path')?.getAttribute('stroke'))));
const trio = canvasTotal.find((x) => x.length === 3);
ok(!!trio && new Set(trio).size === 3,
   'los tres agregados llevan tres colores distintos',
   (trio || []).join(' · '));
ok(totalIdx >= 0, 'y el panel existe');

/* ══════════ 7. ampliar ══════════ */
await salida.locator('.hm-barra-der .hm-icono').last().click();
await p.waitForTimeout(600);
ok(await p.locator('.hm-lupa').count() === 1, 'el botón de ampliar abre la lupa');
const altoLupa = await p.locator('.hm-lupa .apexcharts-canvas').first()
  .evaluate((el) => el.getBoundingClientRect().height);
ok(altoLupa > 400, 'y dentro el gráfico es más alto que en la tarjeta',
   `${Math.round(altoLupa)}px`);
await p.keyboard.press('Escape');
await p.waitForTimeout(300);
ok(await p.locator('.hm-lupa').count() === 0, 'y Escape la cierra');

/* ══════════ 8. Calidad de Agua arranca ══════════ */
/* Comparte casi todo con Distribución, pero el fallo que ya nos pasó —un
 * nombre usado sin importar— no rompe las piezas: deja la pantalla en
 * blanco. Eso solo se ve montándola. */
await p.goto(`${BASE}?v=calidad`, { waitUntil: 'domcontentloaded' });
await p.waitForSelector('.hm', { timeout: 15000 });
await p.waitForTimeout(1500);

ok((await p.locator('.hm-titulo').innerText()).includes('Calidad'),
   'Calidad de Agua se monta');
const bloques = await p.locator('.hm-bloque-cab h2').allInnerTexts();
ok(bloques.some((t) => t.includes('NTU')) && bloques.some((t) => t.includes('Dosaje')),
   'con sus dos bloques', bloques.join(' · '));

/* LOS DOS LIENZOS DE TURBIDEZ, Y CON EL MISMO EJE. El gráfico viejo mete
 * las tomas y el canal en un solo lienzo con dos escalas de NTU, y así el
 * canal a 197 se dibuja a la misma altura que una toma a 50. Aquí van
 * separados: si alguien los junta y vuelve a poner dos ejes, esto cae. */
const ejesY = await p.locator('.hm-rejilla-2 .apexcharts-canvas').first()
  .locator('.apexcharts-yaxis').count();
ok(ejesY === 1, 'el gráfico de turbidez tiene un solo eje', `${ejesY}`);

/* innerText no vale sobre un <text> de SVG: Playwright lo rechaza porque no
 * es un HTMLElement. Se lee el textContent desde el propio navegador. */
const tituloY = await p.locator('.hm-rejilla-2 .apexcharts-canvas').first()
  .evaluate((c) => c.querySelector('.apexcharts-yaxis-title text')?.textContent || '');
ok(tituloY.includes('NTU'), 'y está rotulado en NTU', tituloY);

/* Y el del canal, lo mismo: la comparación entre los dos lienzos solo vale
 * si los dos dicen NTU. */
const tituloCanal = await p.locator('.hm-rejilla-2 .apexcharts-canvas').nth(1)
  .evaluate((c) => c.querySelector('.apexcharts-yaxis-title text')?.textContent || '');
ok(tituloCanal.includes('NTU'), 'el canal también va en NTU', tituloCanal);

/* LA ESCALA, Y QUE EL AVISO DIGA LA VERDAD SOBRE ELLA.
 *
 * Decir «mismo eje» y dejar que cada lienzo se escale solo es el engaño
 * del eje doble repartido en dos tarjetas: el canal, de 190 a 220,
 * dibujaría sus alturas como las tomas de 0 a 60. Pasó de verdad, y se vio
 * mirando la pantalla, no leyendo el código.
 *
 * La pantalla ofrece las dos escalas a propósito —cada una responde una
 * pregunta distinta—, así que lo que se comprueba es que el aviso
 * corresponda con la que está puesta. */
const tope = async (n) => {
  const t = await p.locator('.hm-rejilla-2 .apexcharts-canvas').nth(n)
    .evaluate((c) => [...c.querySelectorAll('.apexcharts-yaxis text')]
      .map((e) => parseFloat(((e.querySelector('tspan') || e).textContent || '')
        .replace(/[^\d.-]/g, ''))).filter(Number.isFinite));
  return { max: Math.max(...t), min: Math.min(...t) };
};
// Arranca en «Propia»: cada lienzo con su escala, y el aviso avisando.
const propiaA = await tope(0);
const propiaB = await tope(1);
ok(propiaA.max < propiaB.max,
   'con escala propia, cada lienzo llega hasta lo suyo',
   `tomas ${propiaA.max} · canal ${propiaB.max}`);
const avisoPropia = await p.locator('.hm-aviso-info').first().innerText();
ok(avisoPropia.includes('su propia escala') && avisoPropia.includes('no las alturas'),
   'y el aviso dice que las alturas NO se comparan');

// Se pone «Compartida».
await p.locator('.hm-pastilla', { hasText: 'Compartida' }).click();
await p.waitForTimeout(900);
const compA = await tope(0);
const compB = await tope(1);
ok(compA.max === compB.max && compA.min === compB.min,
   'con escala compartida los dos lienzos usan el mismo eje',
   `tomas ${compA.min}–${compA.max} · canal ${compB.min}–${compB.max}`);
ok(compA.min === 0, 'y los dos arrancan en cero', `${compA.min}`);
/* La vara la pone el más alto de los dos: el canal ronda 220, así que el
 * eje tiene que llegar ahí y no quedarse en los 60 de las tomas. */
ok(compA.max >= 200, 'la vara la pone el más alto de los dos', `${compA.max}`);
const avisoComp = await p.locator('.hm-aviso-info').first().innerText();
ok(avisoComp.includes('comparten eje'),
   'y ahora el aviso dice que sí se comparan');
ok(avisoComp !== avisoPropia, 'el aviso cambió con la escala');

ok(await p.locator('.hm-rejilla-3 .hm-tarjeta').count() === 3,
   'y salen los tres dosajes');

/* ══════════ 9. nada se ha roto por el camino ══════════ */
ok(errs.length === 0, 'ningún error en consola', errs.slice(0, 2).join(' | '));

await b.close();
const malos = r.filter((x) => !x).length;
console.log(`\n${r.length - malos} de ${r.length} en orden${malos ? `, ${malos} MAL` : ''}.`);
process.exit(malos ? 1 : 0);
