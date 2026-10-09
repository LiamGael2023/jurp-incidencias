// ═══════════════════════════════════════════════════════════════════════════
//  Leer un presupuesto de obra en formato S10 desde el Excel
// ═══════════════════════════════════════════════════════════════════════════
//
// Se lee EN EL NAVEGADOR, no en el servidor, y por una razón concreta: así el
// que importa ve lo que va a entrar ANTES de que entre. Un importador que
// carga y luego avisa es un importador que ya ensució la base.
//
// LO QUE ESTE PARSER NO HACE: adivinar. Si no encuentra la fila de cabecera o
// le falta alguna columna, se para y lo dice. Un presupuesto leído a medias
// es peor que uno no leído, porque parece correcto.

import * as XLSX from 'xlsx';

// Los rótulos de la cabecera, tal como vienen en el formato S10. Se buscan
// por texto normalizado -sin tildes ni mayúsculas- porque entre archivos
// cambian «Descripción» por «DESCRIPCION» y nada más.
const COLUMNAS = {
  item: ['item', 'nro', 'n'],
  descripcion: ['descripcion'],
  unidad: ['unid', 'und', 'unidad'],
  metrado: ['cant', 'cantidad', 'metrado'],
  precio: ['precio', 'p.u', 'pu', 'preciounitario'],
  total: ['total', 'parcial', 'subtotal'],
};

// El pie. Cada clave es lo que se guarda; la lista, cómo puede venir escrito.
const PIE = {
  costo_directo: ['costodirecto'],
  gastos_generales: ['gastosgenerales'],
  utilidad: ['utilidad'],
  subtotal: ['subtotal'],
  igv: ['igv', 'i.g.v', 'impuestogeneralalasventas'],
  total: ['presupuesto', 'presupuestototal', 'totalpresupuesto'],
};

/** Sin tildes, sin espacios, en minúsculas. Para comparar rótulos. */
function llano(v) {
  return String(v == null ? '' : v)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[\s.:()]/g, '');
}

/**
 * Número a partir de lo que venga: el Excel da unas celdas texto y otras no.
 *
 * Los porcentajes se rechazan a propósito. En el pie, «Gastos Generales» trae
 * el «5%» en una columna y el importe en otra; sin esto se guardaba 5 como si
 * fueran cinco soles, y además sin quejarse, que es lo peor que puede pasar.
 */
function num(v) {
  if (typeof v === 'number') return v;
  if (v == null || v === '') return null;
  const s = String(v).replace(/\s/g, '').replace(/,/g, '');
  if (s.includes('%')) return null;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Normaliza un código de partida.
 *
 * El Excel no es coherente: arriba escribe «1» y «1.02», y más abajo
 * «01.02.01». Si no se iguala, el árbol sale partido en dos y las partidas de
 * la rama de arriba se quedan huérfanas. Se deja todo con dos dígitos por
 * tramo, que es como está escrito el resto del presupuesto.
 */
export function normalizarCodigo(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return '';
  if (!/^[\d.]+$/.test(s)) return s;
  return s.split('.')
    .map(t => {
      const n = parseInt(t, 10);
      return Number.isFinite(n) ? String(n).padStart(2, '0') : t;
    })
    .join('.');
}

/** ¿`hijo` cuelga de `padre`? Por código, no por posición en la hoja. */
function cuelgaDe(hijo, padre) {
  return hijo !== padre && hijo.startsWith(padre + '.');
}

/**
 * Lee el libro y devuelve { partidas, totales, avisos }.
 *
 * Lanza si el archivo no tiene la forma esperada. No devuelve a medias.
 */
export function leerPresupuesto(buffer) {
  const libro = XLSX.read(buffer, { type: 'array' });
  const hoja = libro.Sheets[libro.SheetNames[0]];
  if (!hoja) throw new Error('El archivo no tiene ninguna hoja.');

  // Matriz cruda. header:1 da filas como arrays, que es lo que hace falta
  // para encontrar la cabecera: no se sabe aún cómo se llaman las columnas.
  const filas = XLSX.utils.sheet_to_json(hoja, { header: 1, raw: true, defval: null });

  // ── encontrar la cabecera ───────────────────────────────────────────────
  let iCab = -1;
  let col = {};
  for (let i = 0; i < Math.min(filas.length, 40); i++) {
    const f = filas[i] || [];
    const encontradas = {};
    f.forEach((celda, j) => {
      const t = llano(celda);
      if (!t) return;
      for (const [clave, alias] of Object.entries(COLUMNAS)) {
        if (encontradas[clave] !== undefined) continue;
        if (alias.some(a => t === a || t.startsWith(a))) encontradas[clave] = j;
      }
    });
    // Se exige item Y descripcion: con una sola se confundiría con
    // cualquier fila que ponga «Total» por ahí.
    if (encontradas.item !== undefined && encontradas.descripcion !== undefined) {
      iCab = i; col = encontradas; break;
    }
  }
  if (iCab < 0) {
    throw new Error(
      'No encuentro la fila de cabecera. Se buscan las columnas «Item» y '
      + '«Descripción» en las primeras 40 filas. ¿Es un presupuesto en formato S10?');
  }
  for (const obligatoria of ['unidad', 'metrado', 'precio']) {
    if (col[obligatoria] === undefined) {
      throw new Error(
        `La cabecera no tiene columna de ${obligatoria}. Sin ella no se puede `
        + 'medir el avance, así que no se carga nada.');
    }
  }

  // ── recorrer ────────────────────────────────────────────────────────────
  const nodos = [];      // títulos, en orden: [{codigo, descripcion}]
  const partidas = [];
  const avisos = [];
  const vistos = new Set();

  for (let i = iCab + 1; i < filas.length; i++) {
    const f = filas[i] || [];
    const codigo = normalizarCodigo(f[col.item]);
    const desc = String(f[col.descripcion] == null ? '' : f[col.descripcion])
      .replace(/\s+/g, ' ').trim();
    if (!codigo || !/^\d/.test(codigo)) continue;   // el pie no lleva código
    if (!desc) continue;

    const unidad = String(f[col.unidad] == null ? '' : f[col.unidad]).trim();
    const metrado = num(f[col.metrado]);
    const precio = num(f[col.precio]);

    // Una partida tiene unidad Y cantidad. Un título solo lleva su total.
    const esPartida = !!unidad && metrado !== null;

    if (!esPartida) {
      // Los títulos se apilan por código: cualquiera que ya no sea ancestro
      // de este se descarta. Apilar por sangría o por orden de hoja falla en
      // cuanto alguien inserta una fila.
      while (nodos.length && !cuelgaDe(codigo, nodos[nodos.length - 1].codigo)) {
        nodos.pop();
      }
      nodos.push({ codigo, descripcion: desc });
      continue;
    }

    if (vistos.has(codigo)) {
      avisos.push(`El código ${codigo} aparece más de una vez.`);
    }
    vistos.add(codigo);

    while (nodos.length && !cuelgaDe(codigo, nodos[nodos.length - 1].codigo)) {
      nodos.pop();
    }
    const ruta = nodos.map(n => [n.codigo, n.descripcion]);

    if (precio === null) {
      avisos.push(`${codigo} no tiene precio unitario; entra con 0.`);
    }

    partidas.push({
      codigo,
      descripcion: desc.slice(0, 300),
      unidad: unidad.slice(0, 12),
      metrado,
      precio: precio === null ? 0 : precio,
      // La estructura es la obra física (CAJA DE DERIVACION) y el grupo el
      // capítulo dentro de ella (MOVIMIENTO DE TIERRAS). Son los dos últimos
      // títulos por encima de la partida, no una profundidad fija: el árbol no
      // tiene la misma altura en todas las ramas -las partidas de FLETE cuelgan
      // un nivel más arriba que las de las cajas- y fijar la profundidad dejaba
      // esas cinco partidas con la estructura y el grupo intercambiados.
      estructura: ruta.length > 1 ? ruta[ruta.length - 2][1] : '',
      grupo: ruta.length ? ruta[ruta.length - 1][1] : '',
      ruta,
    });
  }

  if (!partidas.length) {
    throw new Error(
      'No encontré ninguna partida. Una partida necesita unidad y cantidad; '
      + 'si todas las filas son títulos, puede que las columnas no sean las '
      + 'que creo.');
  }

  // ── el pie ──────────────────────────────────────────────────────────────
  const totales = {};
  for (let i = iCab + 1; i < filas.length; i++) {
    const f = filas[i] || [];
    // El rótulo puede estar en cualquier columna, y el número a su derecha:
    // en este formato van en E y N, pero eso cambia entre plantillas.
    for (let j = 0; j < f.length; j++) {
      const t = llano(f[j]);
      if (!t) continue;
      for (const [clave, alias] of Object.entries(PIE)) {
        if (totales[clave] !== undefined) continue;
        if (!alias.some(a => t === a)) continue;
        for (let k = j + 1; k < f.length; k++) {
          const v = num(f[k]);
          if (v !== null) { totales[clave] = v; break; }
        }
      }
    }
  }

  // ── lo que debe cuadrar ─────────────────────────────────────────────────
  const suma = partidas.reduce((s, p) => s + p.metrado * p.precio, 0);
  const declarado = totales.costo_directo;
  const cuadra = declarado == null || Math.abs(suma - declarado) <= 1;
  if (!cuadra) {
    avisos.push(
      `La suma de las partidas (${suma.toFixed(2)}) no cuadra con el costo `
      + `directo del Excel (${declarado.toFixed(2)}). Falta alguna partida o `
      + 'se leyó una columna que no era.');
  }

  return {
    partidas,
    totales,
    suma,
    cuadra,
    avisos,
    // Para enseñar el árbol en la vista previa sin recalcularlo.
    raices: [...new Set(partidas.map(p => (p.ruta[0] || ['', ''])[1]))].filter(Boolean),
  };
}

/** El nombre del proyecto, si el Excel lo trae arriba. */
export function leerNombreProyecto(buffer) {
  try {
    const libro = XLSX.read(buffer, { type: 'array' });
    const hoja = libro.Sheets[libro.SheetNames[0]];
    const filas = XLSX.utils.sheet_to_json(hoja, { header: 1, raw: true, defval: null });
    for (let i = 0; i < Math.min(filas.length, 20); i++) {
      const f = filas[i] || [];
      for (let j = 0; j < f.length; j++) {
        if (llano(f[j]) === 'proyecto') {
          for (let k = j + 1; k < f.length; k++) {
            const v = String(f[k] == null ? '' : f[k]).trim();
            if (v && v !== ':' && v.length > 4) return v;
          }
        }
      }
    }
  } catch { /* el nombre es un extra, no un requisito */ }
  return '';
}
