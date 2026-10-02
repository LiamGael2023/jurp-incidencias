// Pruebas de la lámina temática. Se ejecutan con:  node pruebas/lamina/lamina.test.mjs
import {
  compilar, servir, abrir, medirEscala, contador, soloGraves,
  capaJURP, capaKMZ, CAPAS_KMZ, SECTORES, alLng, LAT,
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
console.log('\n═══ Kilometraje, rótulos y rosa de los vientos ═══');
{
  // Un canal de 30 km cuyo trazado empieza en su vértice 0 pero cuyo
  // kilometraje OFICIAL arranca en el 40+000: si la lámina rotulara lo que
  // mide la línea, pondría 0+000 donde va 40+000.
  const DESFASE = 40000;
  const linea = [];
  for (let m = 0; m <= 30000; m += 200) linea.push([alLng(m), LAT + Math.sin(m / 6000) * 0.004]);
  const CANAL = { type: 'FeatureCollection', features: [{ type: 'Feature',
    properties: { fid: 1, nombre: 'Canal Madre' },
    geometry: { type: 'LineString', coordinates: linea } }] };
  const sobreCanal = (codigo) => ({ type: 'FeatureCollection',
    features: Array.from({ length: 24 }, (_, i) => {
      const m = i * 1200 + 300;
      return { type: 'Feature',
        geometry: { type: 'Point', coordinates: [alLng(m), LAT + Math.sin(m / 6000) * 0.004] },
        properties: { fid: `${codigo}-${i}`, nombre: `L${i + 1}-I`, nombre_canal: 'Lateral 10',
          progresiva: m + DESFASE, estado: 'R', ambito: 'JURP' } };
    }) });
  const capaDe = (c) => c === 'sectores_pech' ? SECTORES
    : c === 'canal_madre' ? CANAL
    : /canal|subalaterales|redes|vias|lotes|areas|red_nacional|camino|via_/.test(c)
      ? { type: 'FeatureCollection', features: [] } : sobreCanal(c);
  // El canal madre va con weight 4 en el catálogo de capas; impreso, x1.6.

  const { nav, pag } = await abrir({ dir, capaDe });
  await pag.waitForTimeout(6000);
  await pag.getByText('Encuadrar').click();
  await pag.waitForTimeout(2500);

  const r = await pag.evaluate(() => ({
    pk: [...document.querySelectorAll('.lam-pk')].map(e => e.textContent),
    etiquetas: [...document.querySelectorAll('.inv-eti-lamina')].map(e => e.textContent),
    rosa: !!document.querySelector('.lam-rosa svg, svg.lam-rosa'),
    letras: [...document.querySelectorAll('.lam-rosa text')].map(e => e.textContent).join(''),
  }));

  ok('hay marcas de kilometraje', r.pk.length >= 3, r.pk.join('  '));
  const km = r.pk.map(t => Number(t.split('+')[0]) * 1000 + Number(t.split('+')[1]));
  ok('rotulan el kilometraje OFICIAL, no lo que mide la línea',
    km.every(v => v >= DESFASE), `${r.pk[0]} … ${r.pk.at(-1)}`);
  const pasos = km.slice(1).map((v, i) => v - km[i]);
  ok('van a paso constante, sin saltos ni repeticiones',
    pasos.length > 0 && pasos.every(d => d === pasos[0]) && pasos[0] > 0,
    `pasos de ${[...new Set(pasos)].join(', ')} m`);
  ok('los rótulos son solo el nombre del activo',
    r.etiquetas.length > 0 && r.etiquetas.every(e => /^L\d+-I$/.test(e)),
    r.etiquetas.slice(0, 5).join(', '));
  ok('la rosa de los vientos está, con sus cuatro cardinales',
    r.rosa && ['N', 'E', 'S', 'O'].every(l => r.letras.includes(l)), r.letras);

  await nav.close();
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\n═══ Los canales y los sectores salen en la lámina exportada ═══');
console.log('    (estaban en pantalla y no en el PDF, según dónde cayera el encuadre)');
{
  const linea = [];
  for (let m = 0; m <= 30000; m += 200) linea.push([alLng(m), LAT + 0.0005]);
  const CANAL = { type: 'FeatureCollection', features: [{ type: 'Feature',
    properties: { fid: 1, nombre: 'Canal Madre' },
    geometry: { type: 'LineString', coordinates: linea } }] };
  const PUNTOS = (c) => ({ type: 'FeatureCollection', features: Array.from({ length: 20 }, (_, i) => ({
    type: 'Feature', geometry: { type: 'Point', coordinates: [alLng(i * 1200 + 300), LAT + 0.0005] },
    properties: { fid: `${c}-${i}`, nombre: `P${i}`, nombre_canal: 'L10',
      progresiva: i * 1200 + 300, estado: 'R', ambito: 'JURP' } })) });
  const capaDe = (c) => c === 'canal_madre' ? CANAL
    : /canal|subal|redes|vias|lotes|areas|sectores|red_nacional|camino|via_/.test(c)
      ? { type: 'FeatureCollection', features: [] } : PUNTOS(c);

  // Varios anchos de ventana: la hoja se dibuja a distinto zoom en cada uno y
  // el encuadre queda desplazado de forma distinta, que es lo que destapaba el
  // fallo. Antes salía en unos y en otros no, sin más patrón que ese.
  const azules = [];
  for (const ancho of [1400, 1920, 2400]) {
    const { nav, pag } = await abrir({ dir, ancho, capaDe });
    await pag.waitForTimeout(5500);
    await pag.getByText('Encuadrar').click();
    await pag.waitForTimeout(2200);
    const [d] = await Promise.all([
      pag.waitForEvent('download', { timeout: 60000 }).catch(() => null),
      pag.getByText('PNG', { exact: false }).click(),
    ]);
    if (d) {
      const ruta = `/tmp/lamina_vectores_${ancho}.png`;
      await d.saveAs(ruta);
      const fs2 = await import('node:fs');
      const n = await pag.evaluate(async (datos) => {
        const img = new Image();
        await new Promise(r => { img.onload = r; img.src = datos; });
        const c = document.createElement('canvas');
        c.width = img.width; c.height = img.height;
        c.getContext('2d').drawImage(img, 0, 0);
        const p2 = c.getContext('2d').getImageData(0, 0, img.width, Math.floor(img.height * 0.6)).data;
        let n2 = 0;
        for (let i = 0; i < p2.length; i += 4) {
          if (Math.abs(p2[i] - 28) < 25 && Math.abs(p2[i + 1] - 126) < 25 && Math.abs(p2[i + 2] - 214) < 25) n2++;
        }
        return n2;
      }, 'data:image/png;base64,' + fs2.readFileSync(ruta, 'base64'));
      /**
       * Grosor del trazo medido en el papel.
       *
       * Hay que mirar varias columnas y quedarse con la mediana: una sola
       * puede caer sobre un marcador, y entonces se mide el marcador. Así
       * empezó midiendo 4 px y acusando al código de dibujar con el trazo de
       * pantalla, cuando el trazo estaba bien.
       *
       * El color se acota al del canal —azul claro— para no contar los
       * marcadores, que son morados.
       */
      const grosor = await pag.evaluate(async (datos) => {
        const img = new Image();
        await new Promise(r => { img.onload = r; img.src = datos; });
        const c = document.createElement('canvas');
        c.width = img.width; c.height = img.height;
        const cx = c.getContext('2d');
        cx.drawImage(img, 0, 0);
        const alto = Math.floor(img.height * 0.6);
        const esCanal = (r2, g2, b2) => b2 > r2 + 60 && g2 > 90 && g2 < 200 && b2 > 150;
        const rachas = [];
        for (let col = 0; col < img.width; col += 20) {
          const p3 = cx.getImageData(col, 0, 1, alto).data;
          let mejor = 0, racha = 0;
          for (let y = 0; y < alto; y++) {
            const i = y * 4;
            if (esCanal(p3[i], p3[i + 1], p3[i + 2])) { racha++; if (racha > mejor) mejor = racha; }
            else racha = 0;
          }
          if (mejor) rachas.push(mejor);
        }
        rachas.sort((a, b) => a - b);
        return rachas.length ? rachas[rachas.length >> 1] : 0;
      }, 'data:image/png;base64,' + fs2.readFileSync(ruta, 'base64'));
      azules.push({ ancho, n, grosor });
    }
    await nav.close();
  }
  const cuentas = azules.map(a => a.n);
  // Los marcadores por sí solos daban unos 2000 píxeles de ese azul; el canal
  // añade un orden de magnitud. Si falta, la cuenta se desploma.
  ok('el canal aparece en los tres anchos', cuentas.every(n => n > 10000),
    azules.map(a => `${a.ancho}px → ${a.n}`).join('  ·  '));
  const min = Math.min(...cuentas), max = Math.max(...cuentas);
  ok('y con el mismo peso en todos', max - min < max * 0.2,
    `entre ${min} y ${max} píxeles`);
  // En pantalla el canal va a 4 px; impreso, a 6.4, y la lámina se exporta al
  // doble: unos 9 px frente a unos 14. El umbral va en medio, que es lo que
  // distingue un trazo del otro.
  ok('con el trazo de impresión, no el de pantalla',
    azules.every(a => a.grosor >= 11), azules.map(a => `${a.ancho}px → ${a.grosor} px`).join('  ·  '));
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\n═══ Girar la lámina ═══');
{
  // Canal en diagonal, que es el caso que justifica girar: así aprovecha el
  // papel en vez de cruzar la hoja por una esquina.
  const linea = [];
  for (let m = 0; m <= 24000; m += 200) linea.push([alLng(m), LAT - 0.00008 * (m / 200)]);
  const CANAL = { type: 'FeatureCollection', features: [{ type: 'Feature',
    properties: { fid: 1, nombre: 'Canal Madre' },
    geometry: { type: 'LineString', coordinates: linea } }] };
  const PUNTOS = (c) => ({ type: 'FeatureCollection', features: Array.from({ length: 20 }, (_, i) => {
    const m = i * 1200 + 300;
    return { type: 'Feature', geometry: { type: 'Point', coordinates: [alLng(m), LAT - 0.00008 * (m / 200)] },
      properties: { fid: `${c}-${i}`, nombre: `P${i}`, nombre_canal: 'L10',
        progresiva: m, estado: 'R', ambito: 'JURP' } };
  }) });
  const capaDe = (c) => c === 'canal_madre' ? CANAL : c === 'sectores_pech' ? SECTORES
    : /canal|subal|redes|vias|lotes|areas|red_nacional|camino|via_/.test(c)
      ? { type: 'FeatureCollection', features: [] } : PUNTOS(c);

  const { nav, pag } = await abrir({ dir, ancho: 2000, capaDe });
  await pag.waitForTimeout(6000);
  await pag.getByText('Encuadrar').click();
  await pag.waitForTimeout(2000);

  const estado = () => pag.evaluate(() => {
    const g = document.querySelector('.lam-mapa-giro');
    const rec = document.querySelector('.lam-mapa').getBoundingClientRect();
    const caja = g.getBoundingClientRect();
    const m = (sel) => { const e = document.querySelector(sel); return e ? getComputedStyle(e).transform : null; };
    const angulo = (t) => { if (!t || t === 'none') return 0;
      const n = t.match(/[-\d.e+]+/g).map(Number);
      return +(Math.atan2(n[1], n[0]) * 180 / Math.PI).toFixed(1); };
    return {
      contenedor: [g.offsetWidth, g.offsetHeight],
      cubre: caja.width >= rec.width - 2 && caja.height >= rec.height - 2,
      rosa: angulo(m('.lam-norte')),
      rotulo: angulo(m('.inv-eti-txt')),
      escala: (document.querySelector('.lam-estado')?.innerText || '').match(/1:[\d.,]+/)?.[0],
    };
  });

  const a = await estado();
  ok('sin girar, el contenedor es el del recuadro',
    a.contenedor[0] === 1642 && a.contenedor[1] === 924, a.contenedor.join('×'));

  await pag.evaluate(() => {
    const i = [...document.querySelectorAll('.lam-giro-fila input')][1];
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    set.call(i, '30'); i.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await pag.waitForTimeout(2200);
  const b = await estado();

  ok('al girar, el contenedor crece y sigue tapando el recuadro',
    b.cubre && b.contenedor[0] > a.contenedor[0] && b.contenedor[1] > a.contenedor[1],
    `${a.contenedor.join('×')} → ${b.contenedor.join('×')}`);
  ok('la rosa de los vientos gira con la lámina', Math.abs(b.rosa - 30) < 1, `${b.rosa}°`);
  ok('los rótulos se enderezan para poder leerse', Math.abs(b.rotulo + 30) < 1, `${b.rotulo}°`);
  // Lo que no puede pasar: que girar cambie la escala. Rotar no acerca.
  ok('y la escala sigue siendo la misma', b.escala === a.escala, `${a.escala} → ${b.escala}`);

  /**
   * ¿Sigue el canal dentro de la lámina girada?
   *
   * Contar su azul no sirve: el trazo va al 95 % de opacidad, así que se
   * mezcla con lo que tenga debajo —aquí el relleno del sector— y el color
   * exacto cambia. Lo que no cambia es que apagar la capa tiene que quitar
   * un montón de píxeles: se exporta con el canal y sin él, y se compara.
   */
  const exportar = async (nombre) => {
    const [dd] = await Promise.all([
      pag.waitForEvent('download', { timeout: 60000 }).catch(() => null),
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
      const p4 = c.getContext('2d').getImageData(0, 0, img.width, Math.floor(img.height * 0.6)).data;
      let n = 0;
      for (let i = 0; i < p4.length; i += 4) {
        if (p4[i + 2] > p4[i] + 35 && p4[i + 2] > 90 && p4[i + 2] < 235) n++;
      }
      return n;
    }, 'data:image/png;base64,' + fs2.readFileSync(ruta, 'base64'));
  };

  const conCanal = await exportar('lamina_girada');
  ok('la lámina girada se exporta', conCanal != null);
  await pag.evaluate(() => [...document.querySelectorAll('.lam-capa')]
    .find(e => e.innerText.trim() === 'Canal madre').querySelector('input').click());
  await pag.waitForTimeout(1500);
  const sinCanal = await exportar('lamina_girada_sin_canal');
  if (conCanal != null && sinCanal != null) {
    ok('con el canal dentro', conCanal - sinCanal > 8000,
      `${conCanal - sinCanal} píxeles que aporta el canal (con ${conCanal}, sin ${sinCanal})`);
  }
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
  // El clic se lanza sobre el elemento, no con el ratón: con novecientos
  // marcadores apilados, un clic por coordenadas cae sobre cualquiera. Las
  // marcas de kilometraje y los nombres de sector también son
  // .leaflet-marker-icon, y van sin interacción: hay que apuntar a un activo.
  await pag.evaluate(() => document
    .querySelector('.lam-mapa .leaflet-marker-icon:not(.lam-pk-icono):not(.lam-sector-icono)')
    .dispatchEvent(new MouseEvent('click', { bubbles: true })));
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
