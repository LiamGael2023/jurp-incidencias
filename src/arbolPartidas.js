// ═══════════════════════════════════════════════════════════════════════════
//  El árbol del presupuesto
// ═══════════════════════════════════════════════════════════════════════════
//
// Las tres funciones que leen la jerarquía de una partida. Van aparte del
// componente para que el parte y la actividad bajen por el MISMO árbol: dos
// copias de esto acabarían bajando distinto el día que alguien arregle una
// y no la otra.

// ── el árbol, leído de la propia partida ──────────────────────────────────

/**
 * La ruta de una partida, como lista de [codigo, descripcion].
 *
 * Viaja como texto JSON desde el backend. Si viniera rota se trata como
 * vacía: la partida seguirá siendo elegible desde su nivel, que es mejor que
 * reventar el formulario entero por una fila mal cargada.
 */
export const rutaDe = (p) => {
  if (!p) return [];
  if (Array.isArray(p.ruta)) return p.ruta;
  try { const x = JSON.parse(p.ruta || '[]'); return Array.isArray(x) ? x : []; }
  catch { return []; }
};

/** ¿La partida cuelga del camino dado? */
export const cuelgaDe = (p, camino) => {
  const r = rutaDe(p);
  return camino.every((c, i) => r[i] && r[i][0] === c);
};

/**
 * Baja sola mientras el nivel tenga UN solo hijo y ninguna partida acabe ahí.
 *
 * Si alguna acaba en ese nivel la decisión es del que elige, no mía: bajar
 * automáticamente le escondería una opción válida.
 */
export const bajarSolo = (lista, camino) => {
  let cam = camino.slice();
  for (let v = 0; v < 8; v++) {
    const base = lista.filter(p => cuelgaDe(p, cam));
    const hijos = [];
    base.forEach(p => {
      const n = rutaDe(p)[cam.length];
      if (n && !hijos.some(h => h === n[0])) hijos.push(n[0]);
    });
    const terminan = base.some(p => rutaDe(p).length === cam.length);
    if (hijos.length === 1 && !terminan) cam = cam.concat([hijos[0]]);
    else break;
  }
  return cam;
};
