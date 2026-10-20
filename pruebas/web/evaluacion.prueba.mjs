/* ¿Se ve el formulario de evaluación, y la ficha del activo?
 *
 *     npx vite --port 5199 --strictPort &
 *     node pruebas/web/evaluacion.prueba.mjs
 *
 * POR QUÉ EXISTE. Dos veces seguidas entregué estas pantallas con la paleta
 * equivocada: texto casi blanco sobre el fondo blanco del modal. Las dos
 * compilaban, pasaban el linter y no se leía absolutamente nada; el fallo
 * llegó al usuario las dos veces. El CSS tiene dos temas en el mismo archivo
 * —el panel de capas oscuro y el modal claro— y leerlo no basta para saber
 * cuál gana.
 *
 * Un contraste no se revisa razonando: se pinta y se mide. Esto abre las dos
 * pantallas de verdad y calcula el contraste WCAG de cada rótulo contra el
 * fondo que de verdad tiene detrás.
 */
import pw from '/opt/node-tools/node_modules/playwright-core/index.js';

const BASE = 'http://localhost:5199/pruebas/web/evaluacion.html';
const r = [];
const ok = (c, m, e) => { r.push(!!c); console.log(`${c ? 'ok  ' : 'MAL '} ${m}${e ? `   [${e}]` : ''}`); };

const b = await pw.chromium.launch();
const p = await b.newPage({ viewport: { width: 1500, height: 1000 } });
const errs = [];
p.on('pageerror', e => errs.push(String(e)));

/* Contraste WCAG. El fondo se busca subiendo por los padres hasta encontrar
 * uno que no sea transparente: es lo que el ojo ve de verdad detrás del
 * texto, y es justo el paso que no se puede hacer leyendo el CSS. */
const MEDIDOR = `(sel) => {
  const lum = (c) => {
    const [r, g, b] = c.match(/[\\d.]+/g).slice(0, 3).map(Number).map(v => {
      v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const fondoDe = (el) => {
    for (let n = el; n; n = n.parentElement) {
      const bg = getComputedStyle(n).backgroundColor;
      const a = bg.match(/[\\d.]+/g);
      if (a && (a.length < 4 || Number(a[3]) > 0.5)) return bg;
    }
    return 'rgb(255,255,255)';
  };
  return [...document.querySelectorAll(sel)].map(el => {
    const s = getComputedStyle(el);
    const L1 = lum(s.color), L2 = lum(fondoDe(el));
    const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    return {
      texto: (el.textContent || '').trim().slice(0, 34),
      color: s.color, fondo: fondoDe(el),
      ratio: +ratio.toFixed(2),
      tam: parseFloat(s.fontSize),
      visible: el.offsetWidth > 0 && el.offsetHeight > 0,
    };
  });
}`;

const medir = (sel) => p.evaluate(new Function('return ' + MEDIDOR)(), sel);

// AA pide 4.5 para texto normal y 3.0 para texto grande (>=18.66px en negrita
// o >=24px). Aquí casi todo es texto pequeño, así que se exige 4.5.
const MINIMO = 4.5;
const revisar = async (sel, que) => {
  const filas = (await medir(sel)).filter(f => f.visible && f.texto);
  ok(filas.length > 0, `${que}: hay algo que medir`, `${filas.length} elemento(s)`);
  const flojos = filas.filter(f => f.ratio < MINIMO);
  ok(flojos.length === 0, `${que}: todos los textos se leen (>= ${MINIMO}:1)`,
     flojos.length ? flojos.map(f => `"${f.texto}" ${f.ratio}:1`).join(' | ')
                   : `peor ${Math.min(...filas.map(f => f.ratio)).toFixed(2)}:1`);
  return filas;
};

// ══════════ FORMULARIO DE EVALUACIÓN ══════════
await p.goto(BASE + '?v=eval', { waitUntil: 'domcontentloaded' });
await p.waitForSelector('.inv-modal', { timeout: 10000 });
await p.waitForTimeout(400);

const E = await p.evaluate(() => window.__ESPERADO);

ok(await p.locator('.inv-eval').count() === 1, 'el formulario usa la clase ancha');
const ancho = await p.locator('.inv-eval').evaluate(el => el.getBoundingClientRect().width);
ok(ancho > 700, 'es ancho de verdad, no la tira de 480', `${Math.round(ancho)} px`);

// Los títulos de bloque: lo que estaba invisible.
const titulos = await revisar('.inv-bloque-tit span', 'títulos de bloque');
ok(titulos.length === E.bloques.length,
   `salen los ${E.bloques.length} bloques`, titulos.map(t => t.texto).join(', '));

await revisar('.inv-campo label', 'rótulos de campo');
await revisar('.inv-avanza-txt', 'barra de avance');
await revisar('.inv-modal-sep', 'separadores');
await revisar('.inv-avanza-todo button', 'abrir/cerrar todo');

// La barra de avance cuenta los obligatorios, todos vacíos al abrir.
const avance = await p.locator('.inv-avanza-txt').innerText();
ok(avance.includes(String(E.obligatorios)),
   `dice cuántos obligatorios faltan (${E.obligatorios})`, avance.replace(/\n/g, ' '));

// Dos columnas en escritorio: los campos del bloque general no van apilados.
await p.locator('.inv-bloque-tit').first().click();
await p.waitForTimeout(250);
const columnas = await p.evaluate(() => {
  const g = document.querySelector('.inv-bloque-tit.abierta + .inv-campos');
  if (!g) return 0;
  const xs = new Set([...g.children].map(c => Math.round(c.getBoundingClientRect().left)));
  return xs.size;
});
ok(columnas >= 2, 'los campos se reparten en varias columnas', `${columnas} columna(s)`);

// Al abrir un bloque, sus rótulos también tienen que leerse.
await revisar('.inv-bloque-tit.abierta + .inv-campos label', 'rótulos del bloque abierto');

// El que falta se marca en rojo y la vista salta a él.
await p.locator('.inv-btn-pri').click();
await p.waitForTimeout(500);
const marcados = await p.locator('.inv-campo.falta').count();
ok(marcados === E.obligatorios, 'se marcan en rojo los obligatorios vacíos',
   `${marcados} de ${E.obligatorios}`);
const abiertos = await p.locator('.inv-bloque-tit.abierta').count();
ok(abiertos >= 2, 'se abren los bloques que contienen un campo que falta',
   `${abiertos} abierto(s)`);
const msg = await p.locator('.inv-error').innerText();
ok(/rojo/.test(msg), 'el mensaje remite a la marca, no lista nombres',
   msg.replace(/\n/g, ' ').slice(0, 70));

// Rellenar uno y ver que la cuenta baja: la barra tiene que estar viva.
await p.locator('.inv-campo.falta select').first().selectOption({ index: 1 });
await p.waitForTimeout(250);
const avance2 = await p.locator('.inv-avanza-txt').innerText();
ok(avance2.includes(String(E.obligatorios - 1)),
   'la barra baja al rellenar un obligatorio', avance2.replace(/\n/g, ' '));

// ══════════ FICHA DEL ACTIVO ══════════
await p.goto(BASE + '?v=ficha', { waitUntil: 'domcontentloaded' });
await p.waitForSelector('.inv-ficha', { timeout: 10000 });
await p.waitForTimeout(400);

await revisar('.inv-ficha-tabla th', 'rótulos de la ficha');
await revisar('.inv-ficha-tabla td', 'valores de la ficha');
await revisar('.inv-modal-sep', 'separadores de la ficha');
await revisar('.inv-nota', 'aviso de fotos');
await revisar('.inv-btn-foto', 'botón de añadir fotos');

// El cero se enseña: es el fallo que más fácil pasa desapercibido.
const filas = await p.locator('.inv-ficha-tabla tr').allInnerTexts();
ok(filas.some(f => /usuarios/i.test(f) && /\b0\b/.test(f)),
   'un valor 0 aparece en la ficha', filas.find(f => /usuarios/i.test(f)));
ok(!filas.some(f => /Tipo De Secc|De Diseño/.test(f)),
   'los rótulos no se capitalizan palabra por palabra');

// ── EL AVISO SE VE, NO SE ESCONDE DETRAS DE LA FICHA ──
// SweetAlert trae z-index 1060 y la ficha esta en 1200: sin la regla global,
// el "¿borrar esta foto?" se dibuja DEBAJO del panel desde el que se pulso.
// No se ve nada y la pantalla parece congelada, porque el fondo del aviso si
// bloquea los clics.
await p.goto(BASE + '?v=ficha&fotos=1', { waitUntil: 'domcontentloaded' });
await p.waitForSelector('.inv-ficha', { timeout: 10000 });
await p.waitForTimeout(400);
ok(await p.locator('.inv-foto').count() > 0, 'la galería trae una foto que borrar');
await p.locator('.inv-foto').first().click();
await p.waitForSelector('.inv-visor', { timeout: 5000 });
await p.locator('.inv-visor-borrar').click();
await p.waitForSelector('.swal2-container', { timeout: 5000 });
await p.waitForTimeout(300);

const capas = await p.evaluate(() => {
  const z = (sel) => {
    const el = document.querySelector(sel);
    return el ? Number(getComputedStyle(el).zIndex) || 0 : null;
  };
  const popup = document.querySelector('.swal2-popup');
  const r = popup.getBoundingClientRect();
  // Quien recibe el clic en el centro del aviso: si no es el propio aviso,
  // hay algo por encima tapandolo.
  const encima = document.elementFromPoint(r.left + r.width / 2, r.top + 20);
  return { swal: z('.swal2-container'), ficha: z('.inv-modal-fondo'), visor: z('.inv-visor'),
           alcanzable: popup.contains(encima) };
});
ok(capas.swal > capas.ficha, 'el aviso va por encima de la ficha',
   `swal ${capas.swal} vs ficha ${capas.ficha}`);
ok(capas.swal > capas.visor, 'y por encima del visor de fotos',
   `swal ${capas.swal} vs visor ${capas.visor}`);
ok(capas.alcanzable, 'y se puede pulsar: no hay nada tapándolo');

const botones = await p.locator('.swal2-actions button:visible').allInnerTexts();
ok(botones.some(t => /borrar/i.test(t)) && botones.some(t => /conservar/i.test(t)),
   'con botones que dicen qué hace cada uno', botones.join(' / '));
const enfocado = await p.evaluate(() => document.activeElement?.className || '');
ok(/cancel/i.test(enfocado), 'y el foco empieza en Conservar, no en Borrar', enfocado.slice(0, 40));

ok(errs.length === 0, 'sin errores de JavaScript', errs.join(' | ').slice(0, 160));

await b.close();
const mal = r.filter(x => !x).length;
console.log(`\n${r.length - mal} de ${r.length} en orden${mal ? `, ${mal} MAL` : ''}.`);
process.exit(mal ? 1 : 0);
