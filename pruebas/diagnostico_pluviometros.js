/* ═══════════════════════════════════════════════════════════════════════════
   Por qué una estación sale «sin datos» en PLUVIRA.

   Se pega en la consola del navegador (F12) con la sesión abierta en la app.
   Solo consulta: no escribe nada en ningún sitio.

   QUÉ SEPARA. En el mapa, «sin datos» significa una cosa sola: el endpoint
   filtered-data no devolvió lecturas de HOY para esa estación. Eso tapa
   cuatro situaciones distintas que se arreglan de forma distinta:

     · la estación nunca ha transmitido         → instalación / alta
     · transmitía y dejó de hacerlo el día X    → campo: energía, cobertura
     · transmite hoy, pero no ha llovido        → ojo: NO debería salir así
     · la consulta falla (403, 500…)            → backend

   Y una quinta que es de la app y no del equipo: que la estación transmita de
   noche y la lectura caiga en otro día por la diferencia entre la hora de
   Perú y UTC. Por eso se mira también el día de antes y el de después.
   ═══════════════════════════════════════════════════════════════════════════ */

(async () => {
  const token = localStorage.getItem('userToken');
  if (!token) return console.error('No hay sesión: entra a la app primero.');
  const cab = { headers: { Authorization: `Token ${token}` } };

  const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const hoy = new Date();
  const hace = (n) => { const d = new Date(hoy); d.setDate(d.getDate() - n); return d; };

  // ── Equipos ──────────────────────────────────────────────────────────────
  const listar = async (tipo) => {
    const r = await fetch(`/api/v1/mobile/devices/?device_type=${tipo}`, cab);
    if (!r.ok) { console.error(`No se pudo listar ${tipo}: HTTP ${r.status}`); return []; }
    const d = await r.json();
    return (d.results || []).map(e => ({ ...e, tipo }));
  };
  const equipos = [...await listar('pluviometro'), ...await listar('estacion_davis')];
  console.log(`${equipos.length} equipos registrados. Consultando los últimos 30 días…`);

  // ── Una consulta por estación, de 30 días ────────────────────────────────
  const consultar = async (id, desde, hasta) => {
    const url = `/api/v1/mobile/davis/rain-gauges/filtered-data/`
      + `?start_date=${fmt(desde)}&end_date=${fmt(hasta)}`
      + `&station_id=${id}&metric=rainfall_mm&max_points=9000`;
    const r = await fetch(url, cab);
    if (!r.ok) return { error: `HTTP ${r.status}` };
    const j = await r.json();
    const lecturas = (j.data || [])
      .map(x => ({ t: new Date(x.timestamp), v: parseFloat(x.value) }))
      .filter(x => !Number.isNaN(x.v))
      .sort((a, b) => a.t - b.t);
    return { lecturas, total: j.total_precipitation, stats: j.stats };
  };

  const filas = [];
  for (const eq of equipos) {
    const nombre = eq.nombre || `(sin nombre) #${eq.id}`;
    const lat = parseFloat(eq.latitude), lng = parseFloat(eq.longitude);
    const sinUbicar = !Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0);

    const r = await consultar(eq.id, hace(30), hoy);
    if (r.error) {
      filas.push({ nombre, tipo: eq.tipo, id: eq.id, veredicto: `⛔ la consulta falla (${r.error})`,
        hoy: '-', ultima: '-', dias30: '-', sinUbicar });
      continue;
    }

    const diaDe = (t) => t.toDateString();
    const deHoy = r.lecturas.filter(x => diaDe(x.t) === hoy.toDateString());
    const ultima = r.lecturas.at(-1);
    const diasCallada = ultima ? Math.floor((hoy - ultima.t) / 86400000) : null;

    let veredicto;
    if (!r.lecturas.length) {
      // Nada en 30 días: ¿alguna vez? Se mira un año atrás de un tirón.
      const anio = await consultar(eq.id, hace(365), hoy);
      const nunca = !anio.error && !anio.lecturas.length;
      veredicto = nunca ? '🔴 no ha transmitido en un año' : '🔴 lleva más de 30 días callada';
    } else if (deHoy.length) {
      const mm = deHoy.reduce((a, x) => a + x.v, 0);
      veredicto = `🟢 transmite hoy (${deHoy.length} lecturas, ${mm.toFixed(1)} mm)`;
    } else if (diasCallada === 0 || diasCallada === 1) {
      veredicto = '🟡 transmitió ayer, hoy todavía no';
    } else {
      veredicto = `🟠 dejó de transmitir hace ${diasCallada} días`;
    }

    filas.push({
      nombre, tipo: eq.tipo, id: eq.id, veredicto,
      hoy: deHoy.length,
      ultima: ultima ? ultima.t.toLocaleString('es-PE') : '—',
      dias30: r.lecturas.length,
      sinUbicar,
    });
  }

  filas.sort((a, b) => a.veredicto.localeCompare(b.veredicto) || a.nombre.localeCompare(b.nombre));
  console.table(filas);

  const sinUbicar = filas.filter(f => f.sinUbicar);
  if (sinUbicar.length) {
    console.warn(`${sinUbicar.length} equipo(s) con coordenadas 0,0: el mapa NO los dibuja, `
      + 'transmitan o no. Hay que ubicarlos en el backend.',
      sinUbicar.map(f => f.nombre));
  }

  // ── La quinta posibilidad: el día cambiado ───────────────────────────────
  // Si una estación no tiene lecturas de hoy pero sí justo alrededor de la
  // medianoche, el problema es de husos horarios y no del equipo.
  const mudas = filas.filter(f => f.hoy === 0 && f.dias30 > 0);
  if (mudas.length) {
    console.log('\\nComprobando si alguna lectura cayó en el día de al lado…');
    for (const f of mudas.slice(0, 10)) {
      const r = await consultar(f.id, hace(1), new Date(hoy.getTime() + 86400000));
      const cerca = (r.lecturas || []).filter(x => Math.abs(x.t - hoy) < 36 * 3600000);
      if (cerca.length) {
        console.warn(`  ${f.nombre}: ${cerca.length} lectura(s) en las últimas 36 h, `
          + `la última ${cerca.at(-1).t.toLocaleString('es-PE')}. `
          + 'Si el mapa la da por sin datos, el problema es de fechas, no del equipo.');
      }
    }
  }

  console.log('\\nResumen:', filas.reduce((a, f) => {
    const k = f.veredicto.slice(0, 2); a[k] = (a[k] || 0) + 1; return a;
  }, {}));
  window.__diagnostico = filas;
  console.log('La tabla queda en window.__diagnostico por si quieres copiarla.');
})();
