// Captura la lámina para mirarla: brújula, rótulos y kilometraje.
import { compilar, servir, abrir, alLng, LAT, SECTORES, capaJURP } from './banco.mjs';

const dir = compilar();
const srv = await servir(dir);

// Un canal con vértices reales y activos con su progresiva OFICIAL, que
// empieza en el 40+000 para que se vea si la calibración funciona.
const DESFASE = 40000;
const linea = [];
for (let m = 0; m <= 30000; m += 200) {
  linea.push([alLng(m), LAT + Math.sin(m / 6000) * 0.004]);
}
const CANAL = { type: 'FeatureCollection', features: [
  { type: 'Feature', properties: { fid: 1, nombre: 'Canal Madre' },
    geometry: { type: 'LineString', coordinates: linea } }]};

const sobreCanal = (codigo) => ({ type: 'FeatureCollection',
  features: Array.from({ length: 24 }, (_, i) => {
    const m = i * 1200 + 300;
    return { type: 'Feature',
      geometry: { type: 'Point', coordinates: [alLng(m), LAT + Math.sin(m / 6000) * 0.004] },
      properties: { fid: `${codigo}-${i}`, nombre: `${codigo === 'tomas_l10' ? 'L' : 'B'}${i + 1}-I`,
        nombre_canal: 'Lateral 10', progresiva: m + DESFASE, estado: 'R', ambito: 'JURP' } };
  })});

const capaDe = (c) => c === 'sectores_pech' ? SECTORES
  : c === 'canal_madre' ? CANAL
  : /canal|subalaterales|redes|vias|lotes|areas|red_nacional|camino|via_/.test(c)
    ? { type: 'FeatureCollection', features: [] }
    : sobreCanal(c);

const { nav, pag } = await abrir({ dir, ancho: 1920, capaDe });
await pag.waitForTimeout(6000);
await pag.getByText('Encuadrar').click();
await pag.waitForTimeout(2500);

const r = await pag.evaluate(() => ({
  pk: [...document.querySelectorAll('.lam-pk')].map(e => e.textContent),
  etiquetas: [...document.querySelectorAll('.inv-eti-lamina')].map(e => e.textContent).slice(0, 8),
  rosa: !!document.querySelector('.lam-rosa'),
}));
console.log('kilometraje :', r.pk.join('  ') || '(ninguno)');
console.log('rótulos     :', r.etiquetas.join(', ') || '(ninguno)');
console.log('rosa        :', r.rosa ? 'sí' : 'no');

const caja = await pag.locator('.lam-mapa').boundingBox();
await pag.screenshot({ path: '/tmp/lam_pk.png',
  clip: { x: caja.x, y: caja.y, width: caja.width, height: Math.min(caja.height, 520) } });
await nav.close(); srv.close();
