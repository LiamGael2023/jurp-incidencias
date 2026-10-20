/* ¿Son lo mismo «Áreas con licencia» y «Lotes»?
 *
 * Pegar en la consola del navegador con el inventario abierto.
 *
 * Compara las dos capas por los cuatro sitios por donde se las puede
 * distinguir: cuántas son, qué campos traen, si sus geometrías coinciden una
 * a una, y si unas caen dentro de las otras. Esto último es lo que separa
 * «es la misma capa duplicada» de «una es el padre de la otra».
 */
(async () => {
  const API = '/vigapi/inventario';
  const traer = async (c) => {
    const r = await fetch(`${API}/capas/${c}/?srid=4326`);
    if (!r.ok) throw new Error(`${c}: el servidor respondió ${r.status}`);
    return (await r.json()).features || [];
  };

  const [A, B] = await Promise.all([traer('areas_licencia'), traer('lotes')]);
  console.log(`Áreas con licencia: ${A.length}   ·   Lotes: ${B.length}`);

  // ── 1. Los campos que trae cada una ──
  const campos = (fs) => {
    const s = new Set();
    fs.forEach(f => Object.keys(f.properties || {}).forEach(k => s.add(k)));
    return [...s].sort();
  };
  const ca = campos(A), cb = campos(B);
  console.log('campos Áreas:', ca.join(', '));
  console.log('campos Lotes:', cb.join(', '));
  console.log('solo en Áreas:', ca.filter(k => !cb.includes(k)).join(', ') || '—');
  console.log('solo en Lotes:', cb.filter(k => !ca.includes(k)).join(', ') || '—');

  // ── 2. ¿Geometrías idénticas? ──
  // Se firma cada polígono con sus coordenadas redondeadas a 6 decimales
  // (unos 10 cm). Si las dos capas son la misma cosa, las firmas coinciden.
  const firma = (f) => JSON.stringify(f.geometry?.coordinates)
    .replace(/-?\d+\.\d+/g, (n) => (+n).toFixed(6));
  const fa = new Set(A.map(firma));
  const comunes = B.filter(f => fa.has(firma(f))).length;
  console.log(`geometrías idénticas en ambas: ${comunes} `
    + `(${A.length ? (comunes / Math.min(A.length, B.length) * 100).toFixed(0) : 0}% de la menor)`);

  // ── 3. ¿Unas dentro de otras? ──
  const dentro = (p, anillo) => {
    let d = false;
    for (let i = 0, j = anillo.length - 1; i < anillo.length; j = i++) {
      const [xi, yi] = anillo[i], [xj, yj] = anillo[j];
      if ((yi > p[1]) !== (yj > p[1])
        && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) d = !d;
    }
    return d;
  };
  const anillos = (f) => {
    const g = f.geometry; if (!g) return [];
    return g.type === 'MultiPolygon' ? g.coordinates.map(p => p[0]) : [g.coordinates?.[0]];
  };
  const centro = (f) => {
    const a = anillos(f)[0] || [];
    if (!a.length) return null;
    const x = a.reduce((s, p) => s + p[0], 0) / a.length;
    const y = a.reduce((s, p) => s + p[1], 0) / a.length;
    return [x, y];
  };
  const anillosA = A.flatMap(anillos).filter(Boolean);
  let lotesDentro = 0;
  for (const f of B) {
    const c = centro(f);
    if (c && anillosA.some(r => dentro(c, r))) lotesDentro++;
  }
  console.log(`lotes cuyo centro cae dentro de un área con licencia: `
    + `${lotesDentro} de ${B.length}`);

  // ── 4. Una muestra de cada una, para leerlas ──
  console.log('ejemplo Área:', A[0]?.properties);
  console.log('ejemplo Lote:', B[0]?.properties);

  // ── el veredicto ──
  const casiIguales = comunes / Math.min(A.length, B.length) > 0.9;
  const anidadas = lotesDentro / B.length > 0.8;
  console.log('\n→ ' + (casiIguales
    ? 'SON LA MISMA COSA: las geometrías coinciden. Sobra una de las dos capas.'
    : anidadas
      ? 'NO son lo mismo: los lotes están DENTRO de las áreas con licencia. '
        + 'Una es la unidad de riego y la otra el predio; conviene que el '
        + 'rótulo lo diga.'
      : 'NO son lo mismo y tampoco se anidan: son dos coberturas distintas.'));
})();
