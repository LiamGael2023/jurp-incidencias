/* La pantalla de Campañas: que se lea, que cuente bien y que los archivos
 * que descarga digan lo mismo que la tabla.
 *
 *     npx vite --port 5199 --strictPort &
 *     node pruebas/web/campanias.prueba.mjs
 *
 * Mide el contraste como la prueba del formulario —dos entregas seguidas se
 * fueron con texto ilegible— y además abre el Excel y el PDF descargados,
 * porque una tabla filtrada que exporta sin filtrar es peor que no exportar.
 */
import pw from '/opt/node-tools/node_modules/playwright-core/index.js';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = 'http://localhost:5199/pruebas/web/campanias.html';
const r = [];
const ok = (c, m, e) => { r.push(!!c); console.log(`${c ? 'ok  ' : 'MAL '} ${m}${e ? `   [${e}]` : ''}`); };
const dir = mkdtempSync(join(tmpdir(), 'cmp-'));
const py = (c) => execFileSync('python3', ['-I', '-c', c], { encoding: 'utf-8' }).trim();

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
  return [...document.querySelectorAll(sel)].filter(e => e.offsetWidth && e.offsetHeight)
    .map(el => {
      const s = getComputedStyle(el);
      const L1 = lum(s.color), L2 = lum(fondoDe(el));
      return { texto: (el.textContent || '').trim().slice(0, 30),
               ratio: +((Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05)).toFixed(2) };
    });
}`;

const b = await pw.chromium.launch();
const p = await b.newPage({ viewport: { width: 1600, height: 1050 }, acceptDownloads: true });
const errs = [];
p.on('pageerror', e => errs.push(String(e)));
p.on('dialog', d => d.accept());

const revisar = async (sel, que) => {
  const f = await p.evaluate(new Function('return ' + MEDIDOR)(), sel);
  const flojos = f.filter(x => x.texto && x.ratio < 4.5);
  ok(f.length > 0, `${que}: hay algo que medir`, `${f.length}`);
  ok(flojos.length === 0, `${que}: se lee (>= 4.5:1)`,
     flojos.length ? flojos.map(x => `"${x.texto}" ${x.ratio}`).join(' | ')
                   : `peor ${Math.min(...f.map(x => x.ratio)).toFixed(2)}:1`);
};

await p.goto(BASE, { waitUntil: 'domcontentloaded' });
await p.waitForSelector('.cmp-tabla', { timeout: 10000 });
await p.waitForTimeout(400);
const E = await p.evaluate(() => window.__ESPERADO);

// ── lo que enseña ──
const filas = await p.locator('.cmp-tabla tbody tr').count();
ok(filas === E.evaluaciones, 'salen todas las evaluaciones del año', `${filas}`);
ok((await p.locator('.cmp-anio').inputValue()) === '1', 'arranca en la campaña en proceso');
ok((await p.locator('.cmp-estado').innerText()).toLowerCase().includes('proceso'),
   'y dice que está en proceso');   // el CSS lo pasa a versalitas

const kpis = await p.locator('.cmp-kpi').allInnerTexts();
ok(kpis[0].includes(String(E.evaluaciones)) && kpis[0].includes(String(E.total)),
   'la primera cifra es evaluadas de total', kpis[0].replace(/\n/g, ' '));
ok(kpis.some(k => k.includes(String(E.conMant))), 'cuenta las que requieren mantenimiento');

// El nombre sale del índice, no el fid: una tabla de números no la lee nadie.
const primera = await p.locator('.cmp-tabla tbody tr').first().innerText();
ok(/Estructura \d+/.test(primera), 'la estructura sale con su nombre, no con su fid',
   primera.replace(/\n/g, ' | ').slice(0, 60));
ok(/Lateral/.test(primera), 'y con su canal');

await revisar('.cmp-tabla td', 'celdas');
await revisar('.cmp-tabla thead th', 'cabecera');
await revisar('.cmp-kpi span', 'rótulos de cifras');
await revisar('.cmp-rotulo, .cmp-fechas, .cmp-estado', 'cabecera de campaña');

// ── filtros ──
await p.locator('.cmp-check input').check();
await p.waitForTimeout(250);
const conMant = await p.locator('.cmp-tabla tbody tr').count();
ok(conMant === E.conMant, 'el filtro de mantenimiento deja solo esas', `${conMant}`);

// ── el Excel tiene que decir lo mismo que la tabla filtrada ──
const d1 = await Promise.all([p.waitForEvent('download'), p.locator('.cmp-btn:has-text("Excel")').click()]);
const xlsx = join(dir, 'c.xlsx');
await d1[0].saveAs(xlsx);
const filasXlsx = py(`
import openpyxl
w = openpyxl.load_workbook(r'${xlsx}')
h = w.active
print(sum(1 for i, row in enumerate(h.iter_rows(min_row=5, values_only=True)) if row and row[0]))
`);
ok(Number(filasXlsx) === E.conMant, 'el Excel trae las filas FILTRADAS, no todas',
   `${filasXlsx} vs ${E.conMant}`);
const nota = py(`
import openpyxl
print(openpyxl.load_workbook(r'${xlsx}').active['A2'].value or '')
`);
ok(/mantenimiento/.test(nota), 'y deja escrito qué filtro estaba puesto', nota.slice(0, 70));

// ── el PDF, igual ──
const d2 = await Promise.all([p.waitForEvent('download'), p.locator('.cmp-btn:has-text("PDF")').click()]);
const pdf = join(dir, 'c.pdf');
await d2[0].saveAs(pdf);
const txt = py(`
import pdfplumber
with pdfplumber.open(r'${pdf}') as d:
    print(' '.join((p.extract_text() or '') for p in d.pages))
`);
ok(txt.includes('Campaña 2026'), 'el PDF lleva el año en el título');
ok(/mantenimiento/.test(txt), 'y también qué filtro se aplicó');

await p.locator('.cmp-check input').uncheck();
await p.waitForTimeout(250);

// ── ir a la estructura ──
await p.locator('.cmp-ir').first().click();
const ido = await p.evaluate(() => window.__IDO);
ok(ido && ido.tipo && ido.fid, 'pulsar el marcador pide abrir esa estructura',
   ido ? `${ido.tipo}:${ido.fid}` : 'nada');
ok(ido && ido.lat && ido.lng, 'y le pasa sus coordenadas, para poder volar');

// ── abrir año nuevo ──
await p.locator('.cmp-btn:has-text("Nueva campaña")').click();
await p.waitForSelector('.cmp-nueva');
const anio = await p.locator('.cmp-nueva-campos input').first().inputValue();
ok(Number(anio) === E.proximoAnio, 'propone el año siguiente al último, no el actual',
   `${anio}`);
await revisar('.cmp-nueva-nota', 'nota de qué se copia');
const notaNueva = await p.locator('.cmp-nueva-nota').innerText();
ok(/no se copian/i.test(notaNueva), 'explica que las estructuras no se duplican');
ok(notaNueva.includes('300'), 'y cuántas quedarán pendientes');

await p.locator('.cmp-btn-pri:has-text("Abrir campaña")').click();
await p.waitForTimeout(500);
const creado = await p.evaluate(() => window.__CREADO);
ok(creado?.metodo === 'POST', 'crea con POST');
ok(creado?.cuerpo?.estado === 'en_proceso',
   'y la deja en proceso, que es lo que el front busca para activarla',
   JSON.stringify(creado?.cuerpo || {}));
ok(Number(creado?.cuerpo?.anio) === E.proximoAnio, 'con el año propuesto');

// ── y si el servidor no deja escribir ──
await p.goto(BASE + '?sinescritura=1', { waitUntil: 'domcontentloaded' });
await p.waitForSelector('.cmp-tabla', { timeout: 10000 });
await p.locator('.cmp-btn:has-text("Nueva campaña")').click();
await p.locator('.cmp-btn-pri:has-text("Abrir campaña")').click();
await p.waitForTimeout(400);
const aviso = await p.locator('.cmp-aviso.mal').innerText();
ok(/solo lectura|backend/i.test(aviso),
   'un 405 se explica por su nombre, no como "error"', aviso.replace(/\n/g, ' ').slice(0, 90));
await revisar('.cmp-aviso.mal', 'aviso de error');

// ── un 500 NO es "no hay evaluaciones" ──
// Es el fallo que lleva dando el inventario en el servidor nuevo, y decir
// "todavia no hay ninguna evaluacion" cuando no se pudo preguntar manda a
// alguien a reevaluar lo que ya estaba hecho.
await p.goto(BASE + '?evals500=1', { waitUntil: 'domcontentloaded' });
await p.waitForSelector('.cmp-kpis', { timeout: 10000 });
await p.waitForTimeout(500);
const cuerpo = await p.locator('.cmp-wrap').innerText();
ok(!/no hay ninguna evaluaci/i.test(cuerpo),
   'un 500 no se disfraza de "no hay ninguna evaluación"');
const err = await p.locator('.cmp-error').innerText();
ok(/500/.test(err), 'dice el código que devolvió el servidor', err.replace(/\n/g, ' ').slice(0, 80));
ok(/no es el estado real|no se sabe/i.test(err),
   'y avisa de que las cifras de arriba no son el estado real');

ok(errs.length === 0, 'sin errores de JavaScript', errs.join(' | ').slice(0, 150));

await b.close();
const mal = r.filter(x => !x).length;
console.log(`\n${r.length - mal} de ${r.length} en orden${mal ? `, ${mal} MAL` : ''}.`);
process.exit(mal ? 1 : 0);
