// Captura la lámina para mirarla con ojo: trazos, sector, kilometraje y rosa.
import { compilar, servir, abrir, alLng, LAT, SECTORES } from './banco.mjs';
import fs from 'node:fs';

const dir = compilar();
const srv = await servir(dir);

const DESFASE = 40000;
const linea = [];
for (let m = 0; m <= 30000; m += 200) linea.push([alLng(m), LAT + Math.sin(m / 9000) * 0.003]);
const CANAL = { type: 'FeatureCollection', features: [{ type: 'Feature',
  properties: { fid: 1, nombre: 'Canal Madre' },
  geometry: { type: 'LineString', coordinates: linea } }] };
const sobreCanal = (codigo) => ({ type: 'FeatureCollection',
  features: Array.from({ length: 24 }, (_, i) => {
    const m = i * 1200 + 300;
    return { type: 'Feature',
      geometry: { type: 'Point', coordinates: [alLng(m), LAT + Math.sin(m / 9000) * 0.003] },
      properties: { fid: `${codigo}-${i}`, nombre: `C${i + 1}`, nombre_canal: 'Lateral 10',
        progresiva: m + DESFASE, estado: 'R', ambito: 'JURP' } };
  }) });
const capaDe = (c) => c === 'sectores_pech' ? SECTORES
  : c === 'canal_madre' ? CANAL
  : /canal|subal|redes|vias|lotes|areas|red_nacional|camino|via_/.test(c)
    ? { type: 'FeatureCollection', features: [] } : sobreCanal(c);

const { nav, pag } = await abrir({ dir, ancho: 2000, capaDe });
await pag.waitForTimeout(6000);
await pag.getByText('Encuadrar').click();
await pag.waitForTimeout(2500);

console.log(await pag.evaluate(() => ({
  pk: [...document.querySelectorAll('.lam-pk')].map(e => e.textContent).join(' '),
  sector: [...document.querySelectorAll('.lam-sector')].map(e => e.textContent),
  trazos: document.querySelectorAll('.lam-mapa .leaflet-overlay-pane path').length,
})));

const [d] = await Promise.all([
  pag.waitForEvent('download', { timeout: 45000 }).catch(() => null),
  pag.getByText('PNG', { exact: false }).click(),
]);
if (d) { await d.saveAs('/tmp/lam_vista.png'); console.log('lámina en /tmp/lam_vista.png'); }
await nav.close(); srv.close();
