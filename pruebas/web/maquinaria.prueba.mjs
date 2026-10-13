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

// ── La tabla va agrupada por incidencia ──────────────────────────────────
// El código ya no se repite en cada fila: va una vez en la cabecera de su
// grupo, con el subtotal de la incidencia al lado. Es lo que se mira al
// valorizar, y sumar diez filas a ojo es justo lo que esto ahorra.
//
// Las filas de grupo y las de parte se distinguen por sus celdas: una fila
// de parte tiene una por columna; la de grupo une las primeras.
const leerTabla = () => p.evaluate(() => {
  const th = [...document.querySelectorAll('table thead th')].map(t => t.innerText.trim());
  const ancho = (tr) => [...tr.children]
    .reduce((a, c) => a + (parseInt(c.getAttribute('colspan'), 10) || 1), 0);
  const grupos = [];
  let partes = 0, anchoParte = null;
  for (const tb of document.querySelectorAll('table tbody')) {
    for (const tr of tb.children) {
      if (tr.children.length < th.length) {
        const c = [...tr.children].map(x => x.innerText.replace(/\s+/g, ' ').trim());
        grupos.push({ cab: c[0], horas: c[1], combust: c[2], costo: c[4], ancho: ancho(tr) });
      } else { partes++; anchoParte = anchoParte ?? ancho(tr); }
    }
  }
  return { th, grupos, partes, anchoParte,
           pieAncho: ancho(document.querySelector('table tfoot tr')),
           pieTxt: document.querySelector('table tfoot')?.innerText.replace(/\s+/g, ' ') || '' };
});

const t0 = await leerTabla();
ok(t0.th[0] === 'N° PARTE' && !t0.th.includes('N° INCIDENCIA'),
   'la columna de incidencia sale de las filas: va en la cabecera del grupo',
   t0.th.slice(0, 3).join(' · '));
ok(t0.th.length === t0.anchoParte && t0.th.length === t0.pieAncho
   && t0.th.length === t0.grupos[0].ancho,
   'cabecera, filas, cabeceras de grupo y pie suman las mismas columnas',
   `${t0.th.length} · ${t0.anchoParte} · ${t0.grupos[0].ancho} · ${t0.pieAncho}`);
ok(t0.partes === ESPERADO.total.partes, 'están los 11 partes, repartidos', t0.partes);
ok(t0.grupos.length === 4, 'en cuatro grupos: las tres incidencias y los sueltos',
   t0.grupos.map(g => g.cab.split(' ')[0]).join(' · '));
ok(/INCIDENTE-001/.test(t0.grupos[0].cab) && /Sin incidencia/.test(t0.grupos[3].cab),
   'la del parte más reciente arriba, y los partes sin incidencia al final',
   t0.grupos.map(g => g.cab.split(' ')[0]).join(' → '));

for (const [cod, esp] of Object.entries(ESPERADO)) {
  if (cod === 'total') continue;
  const g = t0.grupos.find(x => x.cab.includes(cod));
  ok(g && g.cab.includes(`${esp.partes} parte`),
     `${cod}: su cabecera dice cuántos partes tiene`, g && g.cab);
  ok(g && g.horas.includes(esp.horas.toFixed(2)),
     'y suma SUS horas, no las de la máquina entera', g && g.horas);
  ok(g && g.costo.replace(/,/g, '').includes(esp.costo.toFixed(2)),
     'y su costo', g && g.costo);
}
ok(/4 incidencias/.test(t0.pieTxt) && /11 parte/.test(t0.pieTxt),
   'y el pie dice cuántas incidencias y cuántos partes hay en total',
   t0.pieTxt.slice(0, 60));

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
for (const [cod, esp] of Object.entries(ESPERADO)) {
  if (cod === 'total') continue;
  await p.selectOption(sel, cod);
  await p.waitForTimeout(500);
  const v = await leerTabla();
  ok(v.partes === esp.partes, `${cod}: la tabla deja ${esp.partes} partes`, v.partes);
  ok(v.grupos.length === 1, 'en un solo grupo, el de la incidencia elegida',
     v.grupos.map(g => g.cab).join(' · '));
  ok(v.pieTxt.includes(`${esp.partes} parte`), 'y el pie cuenta los mismos', v.pieTxt.slice(0, 60));
  ok(v.pieTxt.includes(esp.horas.toFixed(2)),
     `y suma ${esp.horas} horas, no las del historial entero`, v.pieTxt.slice(0, 80));
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
i = next(n for n, f in enumerate(filas) if 'N° PARTE' in f and 'N° INCIDENCIA' in f)
cuerpo = [f for f in filas[i+1:] if f[0] and not str(f[0]).startswith('TOTAL')]
tot = next(f for f in filas[i+1:] if f[0] and str(f[0]).startswith('TOTAL'))
titulo = ' '.join(str(c) for f in filas[:4] for c in f if c)
print(json.dumps({'filas': len(cuerpo), 'horas': tot[6], 'costo': tot[9],
                  'cabecera': [str(c) for c in filas[i] if c],
                  'incs': sorted({str(f[0]) for f in cuerpo}), 'titulo': titulo,
                  'conCodigo': sum(1 for f in cuerpo if str(f[0]).startswith('INCIDENTE-'))}))
`));
// EL EXCEL NO AGRUPA, a diferencia de la pantalla y el PDF, y no es un
// descuido: una hoja se ordena y se filtra, y para eso cada fila tiene que
// bastarse a sí misma. Con el código solo en la cabecera de un grupo,
// ordenar por fecha dejaría las filas sin saber de qué incidencia son.
ok(xl.cabecera[0] === 'N° INCIDENCIA' && xl.cabecera[1] === 'N° PARTE',
   'el Excel SÍ lleva la columna de incidencia, y primera',
   xl.cabecera.slice(0, 3).join(' · '));
ok(xl.conCodigo === xl.filas,
   'y con el código en TODAS sus filas: es lo que deja ordenar y filtrar',
   `${xl.conCodigo} de ${xl.filas}`);
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
cab = next((l for l in t.split('\\n') if 'N° PARTE' in l), '')
# La linea de grupo: lleva el codigo y NO lleva numero de parte.
# 'parte(s)' lo distingue del titulo del documento, que tambien lleva el
# codigo desde que el nombre dice de que incidencia es el recorte.
grupo = [l for l in t.split('\\n')
         if re.search(r'INCIDENTE-\\d+-\\d+', l) and 'parte(s)' in l
         and not re.search(r'PD-\\d{4}', l)]
print(json.dumps({'incs': sorted(set(re.findall(r'INCIDENTE-\\d+-\\d+', t))),
                  'sinColumnaInc': 'INCIDENCIA' not in cab,
                  'grupos': len(grupo),
                  'grupoConSubtotal': bool(grupo and re.search(r'parte\\(s\\).*20[.,]00 HE', grupo[0])),
                  'partes': len(re.findall(r'PD-\\d{4}-\\d+', t)),
                  'total': bool(re.search(r'TOTAL . 5 parte', t)),
                  'horas': bool(re.search(r'20[.,]00 HE', t)),
                  'costo': bool(re.search(r'1,?500[.,]00', t))}))
`));
ok(pf.sinColumnaInc, 'el PDF tampoco repite el código en cada fila');
ok(pf.grupos === 1, 'lleva una cabecera de grupo, la de la incidencia filtrada', pf.grupos);
ok(pf.grupoConSubtotal, 'y esa cabecera trae su cuenta de partes y su subtotal de horas');
ok(pf.partes === 5, 'y lleva 5 partes, no los once', pf.partes);
ok(pf.incs.length === 1, 'todos de la misma incidencia', pf.incs.join(' '));
ok(pf.total && pf.horas && pf.costo,
   'con el pie cuadrado: 5 partes, 20 HE y S/ 1 500',
   `total ${pf.total} horas ${pf.horas} costo ${pf.costo}`);

// Volver a «todas» tiene que devolver el historial entero.
await p.selectOption(sel, '');
await p.waitForTimeout(500);
const v = await leerTabla();
ok(v.partes === ESPERADO.total.partes, 'quitar el filtro devuelve los 11 partes', v.partes);
ok(v.grupos.length === 4, 'y los cuatro grupos', v.grupos.length);
ok(v.pieTxt.includes('11 parte'), 'y el pie vuelve al total', v.pieTxt.slice(0, 50));

ok(errs.length === 0, 'ningún error de JS en toda la prueba', errs.join(' | '));

rmSync(dir, { recursive: true, force: true });
const mal = r.filter(x => !x).length;
console.log(`\n${r.length - mal}/${r.length} bien`);
await b.close();
process.exit(mal ? 1 : 0);
