/* El filtro por N° de incidencia en la ficha de una máquina.
 *
 *     npx vite --port 5199 --strictPort &
 *     node pruebas/web/maquinaria.prueba.mjs
 *
 * No basta con mirar la tabla: lo que se entrega es el Excel y el PDF, y lo
 * que no se puede permitir es que la pantalla diga una cosa y el archivo
 * descargado diga otra. Así que se pulsan los botones de verdad, se guarda
 * lo que descargan y se abre para contar sus filas y leer sus totales.
 *
 * Para abrir los archivos hacen falta `openpyxl` y `pdfplumber`, que vienen
 * con el entorno.
 */
import pw from '/opt/node-tools/node_modules/playwright-core/index.js';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const URL = 'http://localhost:5199/pruebas/web/maquinaria.html';
const r = [];
const ok = (c, m, e) => { r.push(!!c); console.log(`${c ? 'ok  ' : 'MAL '} ${m}${e ? `   [${e}]` : ''}`); };

const dir = mkdtempSync(join(tmpdir(), 'maq-'));
const py = (codigo) => execFileSync('python3', ['-I', '-c', codigo], { encoding: 'utf-8' }).trim();

const b = await pw.chromium.launch();
const p = await b.newPage({ viewport: { width: 1700, height: 1100 }, acceptDownloads: true });
const errs = [];
p.on('pageerror', e => errs.push(String(e)));
// El reporte pregunta si va valorizado; aquí siempre que sí.
p.on('dialog', d => d.dismiss());

await p.goto(URL, { waitUntil: 'domcontentloaded' });
await p.waitForSelector('.maq-card, [class*="maq"], body');
await p.waitForTimeout(2500);

const ESPERADO = await p.evaluate(() => window.__ESPERADO);

// Abrir la ficha de la máquina.
await p.getByText('EX01', { exact: false }).first().click();
await p.waitForTimeout(1500);

const sel = 'select[title="Ver solo los partes de una incidencia"]';
ok(await p.locator(sel).count() === 1, 'la ficha trae el selector de incidencia');

const opciones = await p.locator(`${sel} option`).allTextContents();
ok(opciones.length === 4,
   'ofrece las tres incidencias del historial, más «todas»', opciones.join(' | '));
// El parte sin incidencia no es una incidencia: no puede salir como opción.
ok(!opciones.some(o => /—|null|undefined/.test(o)),
   'y el parte sin incidencia no aparece como opción');
ok(/\(5\)/.test(opciones[1]) && /\(3\)/.test(opciones[2]) && /\(2\)/.test(opciones[3]),
   'cada una dice cuántos partes tiene, de más a menos', opciones.slice(1).join(' '));

// Lo que se ve en pantalla: filas, tarjetas y pie.
const enPantalla = () => p.evaluate(() => {
  const modal = document.querySelector('table')?.closest('div[style*="overflow"]')?.parentElement
             || document.body;
  const filas = document.querySelectorAll('table tbody tr').length;
  const txt = (document.querySelector('table')?.closest('div')?.parentElement?.innerText) || '';
  const tarjetas = [...document.querySelectorAll('div')]
    .filter(d => /^PARTES/.test(d.innerText) && d.children.length === 2)
    .map(d => d.innerText.replace(/\s+/g, ' '));
  const pie = document.querySelector('table tfoot')?.innerText.replace(/\s+/g, ' ') || '';
  return { filas, pie, tarjetas, modal: !!modal, txt: txt.slice(0, 0) };
});

for (const [cod, esp] of Object.entries(ESPERADO)) {
  if (cod === 'total') continue;
  await p.selectOption(sel, cod);
  await p.waitForTimeout(500);
  const v = await enPantalla();
  ok(v.filas === esp.partes, `${cod}: la tabla deja ${esp.partes} filas`, v.filas);
  ok(v.pie.includes(`${esp.partes} parte`), 'y el pie cuenta las mismas', v.pie.slice(0, 60));
  ok(v.pie.includes(esp.horas.toFixed(2)) || v.pie.includes(String(esp.horas)),
     `y suma ${esp.horas} horas, no las del historial entero`, v.pie.slice(0, 80));
}

// Las tarjetas de arriba también siguen el filtro.
await p.selectOption(sel, 'INCIDENTE-001-12062026');
await p.waitForTimeout(500);
const cab = await p.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
ok(/5 de 11/.test(cab), 'la tarjeta de PARTES dice «5 de 11», no 11 a secas',
   (cab.match(/PARTES[^|]{0,30}/) || [''])[0]);
ok(/S\/ 1,?500/.test(cab), 'y el costo es el de la incidencia, no el total',
   (cab.match(/S\/ [\d,.]+/g) || []).join(' '));

// ── Y AHORA LO QUE DE VERDAD SE ENTREGA ──────────────────────────────────
const descargar = async (boton) => {
  const espera = p.waitForEvent('download', { timeout: 60000 });
  await p.getByRole('button', { name: boton }).first().click();
  // Pregunta si lleva importes: valorizado.
  await p.waitForTimeout(700);
  await p.getByRole('button', { name: 'Valorizado' }).first().click();
  const d = await espera;
  const ruta = join(dir, d.suggestedFilename());
  await d.saveAs(ruta);
  return { ruta, nombre: d.suggestedFilename() };
};

const x = await descargar('Excel');
ok(/INC-001/.test(x.nombre), 'el Excel sale con la incidencia en el nombre', x.nombre);
const xl = JSON.parse(py(`
import json, openpyxl
w = openpyxl.load_workbook(${JSON.stringify(x.ruta)}).active
filas = [[c.value for c in f] for f in w.iter_rows()]
i = next(n for n, f in enumerate(filas) if f and f[0] == 'N° PARTE')
cuerpo = [f for f in filas[i+1:] if f[0] and not str(f[0]).startswith('TOTAL')]
tot = next(f for f in filas[i+1:] if f[0] and str(f[0]).startswith('TOTAL'))
titulo = ' '.join(str(c) for f in filas[:4] for c in f if c)
print(json.dumps({'filas': len(cuerpo), 'horas': tot[5], 'costo': tot[9],
                  'incs': sorted({str(f[8]) for f in cuerpo}), 'titulo': titulo}))
`));
ok(xl.filas === 5, 'y lleva dentro 5 filas, las de esa incidencia', xl.filas);
ok(xl.incs.length === 1 && xl.incs[0] === 'INCIDENTE-001-12062026',
   'todas de la misma incidencia', xl.incs.join(' '));
ok(Math.abs(xl.horas - 20) < 0.01 && Math.abs(xl.costo - 1500) < 0.01,
   'y sus totales son los de lo filtrado', `${xl.horas} h · S/ ${xl.costo}`);
ok(xl.titulo.includes('INCIDENTE-001-12062026'),
   'el encabezado del archivo dice que es un recorte');

const d = await descargar('PDF');
ok(/INC-001/.test(d.nombre), 'el PDF sale con la incidencia en el nombre', d.nombre);
const pf = JSON.parse(py(`
import json, re, pdfplumber
with pdfplumber.open(${JSON.stringify(d.ruta)}) as doc:
    t = '\\n'.join(p.extract_text() or '' for p in doc.pages)
print(json.dumps({'incs': sorted(set(re.findall(r'INCIDENTE-\\d+-\\d+', t))),
                  'partes': len(re.findall(r'PD-\\d{4}-\\d+', t)),
                  'total': bool(re.search(r'TOTAL . 5 parte', t)),
                  'horas': bool(re.search(r'20[.,]00 HE', t)),
                  'costo': bool(re.search(r'1,?500[.,]00', t))}))
`));
ok(pf.partes === 5, 'y lleva 5 partes, no los once', pf.partes);
ok(pf.incs.length === 1, 'todos de la misma incidencia', pf.incs.join(' '));
ok(pf.total && pf.horas && pf.costo,
   'con el pie cuadrado: 5 partes, 20 HE y S/ 1 500',
   `total ${pf.total} horas ${pf.horas} costo ${pf.costo}`);

// Volver a «todas» tiene que devolver el historial entero.
await p.selectOption(sel, '');
await p.waitForTimeout(500);
const v = await enPantalla();
ok(v.filas === ESPERADO.total.partes, 'quitar el filtro devuelve los 11 partes', v.filas);
ok(v.pie.includes('11 parte'), 'y el pie vuelve al total', v.pie.slice(0, 50));

ok(errs.length === 0, 'ningún error de JS en toda la prueba', errs.join(' | '));

rmSync(dir, { recursive: true, force: true });
const mal = r.filter(x => !x).length;
console.log(`\n${r.length - mal}/${r.length} bien`);
await b.close();
process.exit(mal ? 1 : 0);
