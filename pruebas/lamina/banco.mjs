// ═══════════════════════════════════════════════════════════════════════════
//  banco.mjs — lo común a las pruebas de la lámina temática.
//
//  La pantalla se monta en un navegador de verdad con el inventario simulado:
//  no hay forma de comprobar de otro modo lo que importa aquí, que es
//  geométrico y de rendimiento —que un milímetro de papel sean diez metros,
//  que la leyenda nombre lo que está dibujado, que el navegador no se congele
//  mientras cargan las capas—.
//
//  El inventario de mentira imita los campos REALES que devuelve la API, que
//  no son los que uno supondría: las capas de JURP traen `nombre_canal` y la
//  progresiva como número en metros; `tramo` solo lo traen las de Chavimochic;
//  y el sector no es un atributo sino la capa de polígonos sectores_pech.
// ═══════════════════════════════════════════════════════════════════════════

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

export const AQUI = path.dirname(fileURLToPath(import.meta.url));
export const RAIZ = path.resolve(AQUI, '../..');
const SALIDA = path.join(AQUI, '.build');

// Rutas del entorno donde se desarrolló. Se pueden cambiar sin tocar el código.
const CHROMIUM = process.env.CHROMIUM
  || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const PLAYWRIGHT = process.env.PLAYWRIGHT
  || '/opt/node-tools/node_modules/playwright/index.mjs';

export const { chromium } = await import(PLAYWRIGHT);

// ── Inventario simulado ────────────────────────────────────────────────────
export const LAT = -8.42, LNG0 = -78.80;
const M_GRADO = 111320 * Math.cos(LAT * Math.PI / 180);
export const alLng = (m) => LNG0 + m / M_GRADO;

export const SECTORES = { type: 'FeatureCollection', features: [
  { type: 'Feature', properties: { fid: 1, sector: 'Sector Virú' },
    geometry: { type: 'Polygon', coordinates: [[[alLng(-500), LAT - 0.02], [alLng(8000), LAT - 0.02],
      [alLng(8000), LAT + 0.02], [alLng(-500), LAT + 0.02], [alLng(-500), LAT - 0.02]]] } },
  { type: 'Feature', properties: { fid: 2, sector: 'Sector Chao' },
    geometry: { type: 'Polygon', coordinates: [[[alLng(8000), LAT - 0.02], [alLng(160000), LAT - 0.02],
      [alLng(160000), LAT + 0.02], [alLng(8000), LAT + 0.02], [alLng(8000), LAT - 0.02]]] } },
]};

export const CAPAS_KMZ = ['toma_canal_madre', 'bocatoma', 'rapida', 'estacion_control',
  'garita_jurp', 'garita_otros', 'canal_madre_kmz', 'evacuador_kmz'];

/** Capa de JURP: nombre_canal + progresiva numérica, sin tramo ni sector. */
export const capaJURP = (codigo, { desde = 0, paso = 500, n = 40 } = {}) => ({
  type: 'FeatureCollection',
  features: Array.from({ length: n }, (_, i) => {
    const m = desde + i * paso;
    return { type: 'Feature',
      geometry: { type: 'Point', coordinates: [alLng(m), LAT + 0.001] },
      properties: { fid: `${codigo}-${i}`, numero: i + 1, nombre: `${codigo} ${i}`,
        nombre_canal: m < 10000 ? 'Lateral 10' : 'Lateral 2',
        progresiva: m + 53.7, margen: 'I', estado: 'R', ambito: 'JURP' } };
  }),
});

/** Capa KMZ de Chavimochic: trae tramo y NO trae nombre_canal. */
export const capaKMZ = (codigo, { desde = 0, paso = 500, n = 40 } = {}) => ({
  type: 'FeatureCollection',
  features: Array.from({ length: n }, (_, i) => {
    const m = desde + i * paso;
    return { type: 'Feature',
      geometry: { type: 'Point', coordinates: [alLng(m), LAT - 0.001] },
      properties: { ogc_fid: i, fid: `${codigo}-${i}`, nombre: `KMZ ${i}`,
        progresiva: `${Math.floor(m / 1000)}+${String(m % 1000).padStart(3, '0')}`,
        estado: 'B', tramo: m < 6000 ? 'Tramo V' : 'Tramo XII', ambito: 'PECH' } };
  }),
});

// ── Montaje ────────────────────────────────────────────────────────────────
/** Compila la pantalla a un paquete suelto que se pueda servir por HTTP. */
export function compilar() {
  fs.mkdirSync(SALIDA, { recursive: true });
  fs.writeFileSync(path.join(SALIDA, 'main.jsx'),
    `import { createRoot } from 'react-dom/client';\n`
    + `import MapaTematico from '${path.join(RAIZ, 'src/MapaTematico')}';\n`
    + `createRoot(document.getElementById('raiz')).render(<MapaTematico />);\n`);
  fs.writeFileSync(path.join(SALIDA, 'index.html'),
    '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="out.css">'
    + '<style>html,body{margin:0;height:100%}</style></head>'
    + '<body><div id="raiz"></div><script src="out.js"></script></body></html>');
  // Una tesela verde: lo que importa no es la imagen sino que llegue con
  // cabecera CORS, como las capas exportables de verdad.
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAQAAAAEAAQMAAABmvDolAAAAA1BMVEU8WkbcS0DnAAAAL0lEQVR4'
    + '2u3BAQ0AAADCoPdPbQ8HFAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPBtTVwAAWfLzNcAAAAASUVORK5CYII=',
    'base64');
  fs.writeFileSync(path.join(SALIDA, 'tesela.png'), png);
  execFileSync('npx', ['esbuild', path.join(SALIDA, 'main.jsx'), '--bundle', '--jsx=automatic',
    '--loader:.jsx=jsx', '--loader:.png=dataurl', '--loader:.svg=dataurl',
    `--outdir=${SALIDA}`, '--entry-names=out',
    '--define:process.env.NODE_ENV="development"'], { cwd: RAIZ, stdio: 'pipe' });
  return SALIDA;
}

const TIPOS = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png' };

export async function servir(dir, puerto = 8099) {
  const srv = http.createServer((q, r) => {
    const f = path.join(dir, q.url === '/' ? 'index.html' : q.url.split('?')[0]);
    if (!fs.existsSync(f)) { r.writeHead(404); return r.end(); }
    r.writeHead(200, { 'Content-Type': TIPOS[path.extname(f)] || 'text/plain' });
    r.end(fs.readFileSync(f));
  });
  await new Promise(r => srv.listen(puerto, r));
  return srv;
}

/**
 * Abre la pantalla con el inventario simulado.
 * `capaDe(codigo)` decide qué devuelve cada capa; `demora` escalona las
 * respuestas para imitar la descarga real.
 */
export async function abrir({ dir, ancho = 1920, alto = 1000, capaDe, demora = 0 }) {
  const tesela = fs.readFileSync(path.join(dir, 'tesela.png'));
  const nav = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
  const ctx = await nav.newContext({ viewport: { width: ancho, height: alto } });
  const pag = await ctx.newPage();
  const avisos = [];
  pag.on('console', m => { if (m.type() === 'error') avisos.push(m.text()); });
  pag.on('pageerror', e => avisos.push('PAGEERROR ' + e.message));
  pag.on('response', r => { if (r.status() === 404) avisos.push('404 ' + r.url()); });

  await pag.route('**/*', async (ruta) => {
    const u = ruta.request().url();
    if (/google|arcgis|openstreetmap|opentopomap|cartocdn/.test(u))
      return ruta.fulfill({ status: 200, body: tesela, contentType: 'image/png',
        headers: { 'access-control-allow-origin': '*' } });
    if (u.includes('/vigapi/inventario/')) {
      const j = (o) => ruta.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
      if (/\/campanias\/$/.test(u)) return j([{ id: 1, anio: 2026, estado: 'en_proceso' }]);
      if (/\/capas\/$/.test(u)) return j([]);
      if (/avance|evaluaciones|indice|activos-nuevos/.test(u)) return j([]);
      const m = /\/capas\/([a-z0-9_]+)\/\?/.exec(u);
      if (m) {
        if (demora) await new Promise(r => setTimeout(r, demora + Math.random() * demora));
        return j(capaDe(m[1]));
      }
      return j([]);
    }
    return ruta.continue();
  });
  await pag.addInitScript(() => { localStorage.setItem('userToken', 'prueba'); });
  await pag.goto('http://localhost:8099/');
  await pag.waitForSelector('.lam-hoja', { timeout: 20000 });
  return { nav, ctx, pag, avisos };
}

/** Ruido del banco de pruebas que no es de la pantalla. */
export const soloGraves = (avisos) => avisos.filter(a =>
  !/favicon|Download the React|marker-(icon|shadow)/.test(a)
  && !(/Failed to load resource/.test(a) && avisos.some(x => /marker-/.test(x))));

/**
 * La escala medida sobre el dibujo: dos líneas de la cuadrícula con su valor
 * UTM, y los píxeles entre ellas traducidos a milímetros de papel (2 px = 1 mm).
 * Es la única comprobación que vale: lo que diga el rótulo no demuestra nada.
 */
export const medirEscala = (pag) => pag.evaluate(() => {
  const svg = document.querySelector('.lam-grid');
  if (!svg) return null;
  const vs = [...svg.querySelectorAll('g')].map(g => {
    const t = g.querySelector('text'), pl = g.querySelector('polyline');
    if (!t || !pl) return null;
    const pts = pl.getAttribute('points').split(' ').map(s => s.split(',').map(Number));
    return { valor: Number(t.textContent), x: pts[0][0],
             vertical: Math.abs(pts[0][0] - pts.at(-1)[0]) < Math.abs(pts[0][1] - pts.at(-1)[1]) };
  }).filter(Boolean).filter(v => v.vertical).sort((a, b) => a.x - b.x);
  if (vs.length < 2) return { n: vs.length };
  const metros = Math.abs(vs.at(-1).valor - vs[0].valor);
  const px = Math.abs(vs.at(-1).x - vs[0].x);
  return { n: vs.length, metros, mm: px / 2, escala: metros / ((px / 2) / 1000),
           zoomHoja: getComputedStyle(document.querySelector('.lam-lienzo')).getPropertyValue('--lam-zoom').trim() };
});

export function contador() {
  let fallos = 0;
  const ok = (etiqueta, cond, extra = '') => {
    console.log(`${cond ? '  ok  ' : ' FALLA'} ${etiqueta}${extra ? ` — ${extra}` : ''}`);
    if (!cond) fallos++;
  };
  return { ok, fin: () => fallos };
}
