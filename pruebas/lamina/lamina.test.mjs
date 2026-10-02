// Pruebas de la lámina temática. Se ejecutan con:  node pruebas/lamina/lamina.test.mjs
import {
  compilar, servir, abrir, medirEscala, contador, soloGraves,
  capaJURP, capaKMZ, CAPAS_KMZ, SECTORES,
} from './banco.mjs';

const { ok, fin } = contador();
const dir = compilar();
const srv = await servir(dir);

// Las tres familias que devuelve la API, repartidas por los 155 km del canal.
const inventario = (c) => c === 'sectores_pech' ? SECTORES
  : CAPAS_KMZ.includes(c) ? capaKMZ(c)
  : capaJURP(c, { paso: 2000, n: 60 });

// ───────────────────────────────────────────────────────────────────────────
console.log('\n═══ Los tres niveles salen de donde los tiene la API ═══');
{
  const { nav, pag } = await abrir({ dir, capaDe: inventario });
  await pag.waitForTimeout(5000);
  const niveles = await pag.evaluate(() => [...document.querySelectorAll('.lam-panel label')]
    .filter(l => l.querySelector('select')).map(l => l.childNodes[0].textContent.trim()));
  ok('Sector (de los polígonos), Tramo (de las KMZ) y Canal (de las de JURP)',
    ['Sector', 'Tramo', 'Canal'].every(n => niveles.includes(n)), niveles.join(' | '));

  const campos = await pag.evaluate(() => [...document.querySelectorAll('.lam-panel input')]
    .slice(0, 2).map(e => e.value));
  ok('las progresivas se proponen solas al llegar los datos',
    campos.every(v => /^\d+\+\d{3}$/.test(v)), campos.join(' → ') || '(vacías)');
  await nav.close();
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\n═══ La escala: un milímetro de papel, diez metros de terreno ═══');
for (const ancho of [1280, 1920, 2560]) {
  const { nav, pag, avisos } = await abrir({ dir, ancho, capaDe: inventario });
  await pag.waitForTimeout(5000);
  await pag.locator('.lam-panel input').nth(1).fill('6+000');
  await pag.waitForTimeout(600);
  await pag.getByText('Encuadrar').click();
  await pag.waitForTimeout(1800);
  const m = await medirEscala(pag);
  ok(`a ${ancho} px de ventana (hoja al ${m?.zoomHoja}) → 1:${Math.round(m?.escala || 0).toLocaleString('es-PE')}`,
    m?.escala && Math.abs(m.escala - 10000) / 10000 < 0.01,
    `${m?.metros} m en ${m?.mm.toFixed(1)} mm`);
  ok(`  consola limpia a ${ancho} px`, soloGraves(avisos).length === 0,
    soloGraves(avisos).slice(0, 2).join(' | ') || 'limpia');
  await nav.close();
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\n═══ La leyenda nombra lo dibujado, no lo encendido ═══');
{
  // Tres capas al principio del canal; las demás, a cien kilómetros.
  const CERCA = ['tomas_l10', 'alcantarilla', 'canoas'];
  const capaDe = (c) => c === 'sectores_pech' ? SECTORES
    : capaJURP(c, { desde: CERCA.includes(c) ? 0 : 100000, paso: 200, n: 30 });

  const { nav, pag } = await abrir({ dir, capaDe });
  await pag.waitForTimeout(5000);
  await pag.locator('.lam-panel input').nth(1).fill('3+000');
  await pag.waitForTimeout(600);
  await pag.getByText('Encuadrar').click();
  await pag.waitForTimeout(2000);

  const leer = () => pag.evaluate(() => ({
    entradas: [...document.querySelectorAll('.lam-leyenda-it span')].map(e => e.textContent.trim()),
    encendidas: document.querySelectorAll('.lam-capa input:checked').length,
    desborda: (() => {
      const caja = document.querySelector('.lam-leyenda');
      const cols = document.querySelector('.lam-leyenda-cols');
      return cols && caja ? cols.scrollHeight > caja.clientHeight + 2 : false;
    })(),
  }));

  const r = await leer();
  ok('mucho más corta que la lista de capas', r.entradas.length < r.encendidas,
    `${r.entradas.length} entradas de ${r.encendidas} capas encendidas`);
  ok('nombra las que están en el encuadre',
    ['Tomas Lateral 10', 'Alcantarillas', 'Canoas'].every(x => r.entradas.includes(x)), r.entradas.join(' | '));
  ok('calla las que están a cien kilómetros',
    !r.entradas.includes('Sifones') && !r.entradas.includes('Reservorios'), r.entradas.join(' | '));
  ok('y no se desborda del recuadro', !r.desborda);

  await pag.evaluate(() => [...document.querySelectorAll('.lam-capa')]
    .find(e => e.innerText.trim() === 'Canoas').querySelector('input').click());
  await pag.waitForTimeout(800);
  ok('al apagar una capa, sale de la leyenda', !(await leer()).entradas.includes('Canoas'));

  // Y al llevarse el encuadre a los cien kilómetros, se da la vuelta.
  await pag.locator('.lam-panel input').nth(0).fill('100+000');
  await pag.locator('.lam-panel input').nth(1).fill('103+000');
  await pag.waitForTimeout(600);
  await pag.getByText('Encuadrar').click();
  await pag.waitForTimeout(2200);
  const r2 = await leer();
  ok('al mover el encuadre, la leyenda se da la vuelta',
    r2.entradas.includes('Sifones') && !r2.entradas.includes('Tomas Lateral 10'),
    r2.entradas.slice(0, 6).join(' | '));

  const [d] = await Promise.all([
    pag.waitForEvent('download', { timeout: 45000 }).catch(() => null),
    pag.getByText('PNG', { exact: false }).click(),
  ]);
  ok('la lámina se exporta', !!d, d ? d.suggestedFilename() : 'no hubo descarga');
  await nav.close();
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\n═══ El popup se lee, y no sale impreso ═══');
{
  const { nav, pag } = await abrir({ dir, capaDe: (c) => c === 'sectores_pech' ? SECTORES
    : capaJURP(c, { paso: 400, n: 25 }) });
  await pag.waitForTimeout(5000);
  await pag.locator('.lam-panel input').nth(1).fill('4+000');
  await pag.waitForTimeout(600);
  await pag.getByText('Encuadrar').click();
  await pag.waitForTimeout(2000);
  await pag.locator('.lam-mapa .leaflet-marker-icon').first().click({ force: true });
  await pag.waitForTimeout(900);

  const colores = await pag.evaluate(() => {
    const w = document.querySelector('.leaflet-popup-content-wrapper');
    const t = document.querySelector('.inv-pop-tit') || document.querySelector('.inv-pop');
    if (!w || !t) return null;
    return { fondo: getComputedStyle(w).backgroundColor, texto: getComputedStyle(t).color };
  });
  ok('el popup se abre', !!colores);

  if (colores) {
    // Contraste real: el fondo lleva transparencia, así que se compone sobre
    // el blanco del papel antes de medir. Un popup con texto claro sobre
    // fondo claro da menos de 2:1 y no se lee, que es como estaba.
    const nums = (s) => (s.match(/[\d.]+/g) || []).map(Number);
    const sobreBlanco = ([r, g, b, a = 1]) => [r, g, b].map(v => v * a + 255 * (1 - a));
    const lum = ([r, g, b]) => {
      const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const f = sobreBlanco(nums(colores.fondo)), t = sobreBlanco(nums(colores.texto));
    const [a, b] = [lum(f), lum(t)].sort((x, y) => y - x);
    const razon = (a + 0.05) / (b + 0.05);
    ok('el texto contrasta con el fondo del popup', razon >= 4.5,
      `${razon.toFixed(1)}:1 (fondo ${colores.fondo}, texto ${colores.texto})`);
  }

  /**
   * ¿Sale el popup impreso?
   *
   * Contar píxeles oscuros a secas no sirve: los marcadores ya son oscuros y
   * dan medio punto porcentual por su cuenta. Lo que lo distingue es que
   * exportar con el popup abierto y con el popup cerrado dé la MISMA lámina.
   * Si se colara, la versión abierta tendría una mancha de miles de píxeles.
   */
  const exportar = async (nombre) => {
    const [dd] = await Promise.all([
      pag.waitForEvent('download', { timeout: 45000 }).catch(() => null),
      pag.getByText('PNG', { exact: false }).click(),
    ]);
    if (!dd) return null;
    const ruta = `/tmp/${nombre}.png`;
    await dd.saveAs(ruta);
    const fs2 = await import('node:fs');
    return pag.evaluate(async (datos) => {
      const img = new Image();
      await new Promise(r => { img.onload = r; img.src = datos; });
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      c.getContext('2d').drawImage(img, 0, 0);
      const d2 = c.getContext('2d').getImageData(0, 0, img.width, Math.floor(img.height * 0.6)).data;
      let n = 0;
      for (let i = 0; i < d2.length; i += 4) if (d2[i] < 45 && d2[i + 1] < 55 && d2[i + 2] < 70) n++;
      return n;
    }, 'data:image/png;base64,' + fs2.readFileSync(ruta, 'base64'));
  };

  const conPopup = await exportar('lamina_popup_abierto');
  ok('la lámina se exporta con el popup abierto', conPopup != null);
  await pag.locator('.leaflet-popup-close-button').click({ force: true }).catch(() => {});
  await pag.waitForTimeout(1200);
  const sinPopup = await exportar('lamina_popup_cerrado');
  if (conPopup != null && sinPopup != null) {
    const diferencia = Math.abs(conPopup - sinPopup);
    ok('y sale igual que con el popup cerrado', diferencia < 2000,
      `${diferencia} píxeles oscuros de diferencia (abierto ${conPopup}, cerrado ${sinPopup})`);
  }
  await nav.close();
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\n═══ Mientras carga, el navegador no se congela ═══');
console.log('    (con el racimo apagado son miles de marcadores sueltos)');
{
  const { nav, pag } = await abrir({ dir, ancho: 1900, demora: 150,
    capaDe: (c) => c === 'sectores_pech' ? SECTORES : capaJURP(c, { paso: 1722, n: 90 }) });
  await pag.evaluate(() => {
    window.__largas = [];
    try { new PerformanceObserver(l => { for (const e of l.getEntries()) window.__largas.push(Math.round(e.duration)); })
      .observe({ entryTypes: ['longtask'] }); } catch (e) {}
  });
  await pag.waitForTimeout(12000);
  const largas = await pag.evaluate(() => window.__largas || []);
  const bloqueo = largas.reduce((a, b) => a + b, 0);
  // Antes de recortar por encuadre y de esperar a que termine la descarga,
  // esto daba 46 tareas y 4737 ms.
  ok('el bloqueo total se mantiene bajo', bloqueo < 2000,
    `${largas.length} tareas largas, ${bloqueo} ms`);
  await nav.close();
}

srv.close();
const fallos = fin();
console.log(fallos === 0 ? '\n✓ todo en orden\n' : `\n✗ ${fallos} comprobación(es) fallida(s)\n`);
process.exit(fallos ? 1 : 0);
