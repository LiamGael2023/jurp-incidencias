/**
 * El presupuesto plano, convertido en árbol.
 *
 * El servidor devuelve las partidas como una lista: cada una con su código,
 * su metrado y su `ruta` —el camino de ancestros, en JSON, que puso el
 * importador del Excel—. La pantalla necesita el árbol:
 *
 *     01          TRABAJOS PRELIMINARES                     23,621.00
 *     01.01       Movilizacion de maquinaria   glb  1.00  5,000.00
 *     01.02       Trazo y replanteo            mes  3.00  6,207.00
 *
 * LOS TITULOS NO SON FILAS EN LA BASE, salvo los que se escriben a mano.
 * Los del presupuesto importado existen solo dentro de la `ruta` de cada
 * partida, que es como los guardó el importador. Así que aquí se reconstruyen
 * desde ahí. Eso tiene una consecuencia que conviene tener presente: un
 * título del Excel bajo el que no quedó ninguna partida no existe, y no se
 * puede dibujar. No es una pérdida: un capítulo vacío no aporta nada al
 * presupuesto, y fabricarlo obligaría a guardar filas que nadie cargó.
 *
 * EL TOTAL DE UN TITULO SE SUMA, NO SE GUARDA. Es lo que cuelga de él. Un
 * total guardado deja de cuadrar con sus hijos en cuanto se corrige uno, y
 * como los dos números son plausibles nadie lo nota hasta que alguien los
 * suma a mano.
 *
 * ESTE MODULO NO TOCA EL DOM a propósito: así se puede comprobar el orden y
 * las sumas sin montar el navegador, que es donde estos errores se esconden
 * mejor.
 */

import { rutaDe } from './arbolPartidas.js';

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export const tramos = (codigo) =>
  String(codigo ?? '').split('.').filter(t => t !== '');

export const nivelDe = (codigo) => tramos(codigo).length;

export const padreDe = (codigo) => {
  const t = tramos(codigo);
  return t.length > 1 ? t.slice(0, -1).join('.') : null;
};

/**
 * Clave para ordenar códigos jerárquicos POR NUMERO, no por texto.
 *
 * "01.10" y "01.9" se ordenan al revés si se comparan como cadenas. Con dos
 * dígitos por tramo coinciden, pero el Excel del presupuesto trae los
 * niveles de arriba sin rellenar —"1", "1.02"— así que el caso ocurre de
 * verdad, y cuando ocurre el árbol sale desordenado sin que nada falle.
 */
export const ordenDe = (codigo) => tramos(codigo).map(t => {
  const m = /^\s*(\d+)/.exec(t);
  return m ? [0, Number(m[1])] : [1, 0];
});

const compara = (a, b) => {
  const x = ordenDe(a), y = ordenDe(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const p = x[i] || [-1, 0], q = y[i] || [-1, 0];
    if (p[0] !== q[0]) return p[0] - q[0];
    if (p[1] !== q[1]) return p[1] - q[1];
  }
  return String(a).localeCompare(String(b));
};

const texto = (v) => {
  if (v === null || v === undefined) return '';
  const s = String(v).trim();
  return (s.toLowerCase() === 'none' || s.toLowerCase() === 'null') ? '' : s;
};

/**
 * → filas ordenadas del árbol.
 *
 * Cada fila: { id, codigo, descripcion, es_titulo, nivel, unidad, metrado,
 *              precio, importe, ejecutado, valorizado, saldo, saldoImporte }
 *
 * `id` es null en los títulos reconstruidos desde la ruta: no son filas de
 * la base y no se pueden editar ni borrar. Los títulos escritos a mano sí
 * llegan con id, y entonces se conserva.
 */
export function construirArbol(partidas = []) {
  const hojas = [];
  const nodos = new Map();   // codigo → fila

  for (const p of partidas) {
    const cod = texto(p?.codigo);
    if (!cod) continue;

    if (p?.es_titulo) {
      // Título guardado (escrito a mano). Manda sobre el reconstruido.
      nodos.set(cod, {
        id: p.id ?? null, codigo: cod, descripcion: texto(p.descripcion),
        es_titulo: true,
      });
      continue;
    }

    // Los ancestros, tal como los dejó el importador en la ruta.
    for (const tramo of rutaDe(p)) {
      if (!Array.isArray(tramo) || tramo.length < 1) continue;
      const c = texto(tramo[0]);
      if (!c || c === cod) continue;
      const previo = nodos.get(c);
      if (!previo) {
        nodos.set(c, { id: null, codigo: c, descripcion: texto(tramo[1]),
                       es_titulo: true });
      } else if (previo.es_titulo && !previo.descripcion) {
        previo.descripcion = texto(tramo[1]);
      }
    }

    const metrado = num(p.metrado);
    const precio = num(p.precio);
    const ejecutado = num(p.ejecutado);
    const fila = {
      id: p.id ?? null,
      codigo: cod,
      descripcion: texto(p.descripcion),
      es_titulo: false,
      unidad: texto(p.unidad),
      metrado,
      precio,
      importe: metrado * precio,
      ejecutado,
      valorizado: ejecutado * precio,
      saldo: metrado - ejecutado,
      saldoImporte: (metrado - ejecutado) * precio,
    };
    hojas.push(fila);
    // Una hoja pisa a un título del mismo código: si el Excel trae una
    // partida con el código de un capítulo, lo que manda es la partida, que
    // es la que lleva metrado.
    nodos.set(cod, fila);
  }

  for (const h of hojas) nodos.set(h.codigo, h);

  const filas = [...nodos.values()];

  // Las sumas de cada título: lo que cuelga de él, por prefijo de código.
  for (const f of filas) {
    if (!f.es_titulo) continue;
    let importe = 0, valorizado = 0;
    for (const h of hojas) {
      if (h.codigo.startsWith(f.codigo + '.')) {
        importe += h.importe;
        valorizado += h.valorizado;
      }
    }
    f.unidad = '';
    f.metrado = null;
    f.precio = null;
    f.ejecutado = null;
    f.saldo = null;
    f.importe = importe;
    f.valorizado = valorizado;
    f.saldoImporte = importe - valorizado;
  }

  for (const f of filas) f.nivel = nivelDe(f.codigo);
  filas.sort((a, b) => compara(a.codigo, b.codigo));
  return filas;
}

/**
 * Los totales del presupuesto: SOLO las hojas.
 *
 * Un título ya trae la suma de lo que cuelga de él, así que contarlo además
 * de sus hijos duplica el importe. El error no se ve —los dos números son
 * plausibles— y por eso el filtro está aquí y no en cada pantalla que
 * quiera un total.
 */
export function totalesDe(filas = []) {
  const hojas = filas.filter(f => !f.es_titulo);
  const importe = hojas.reduce((a, f) => a + num(f.importe), 0);
  const valorizado = hojas.reduce((a, f) => a + num(f.valorizado), 0);
  return {
    partidas: hojas.length,
    titulos: filas.length - hojas.length,
    importe,
    valorizado,
    saldo: importe - valorizado,
  };
}

/** Los títulos donde se puede colgar algo, con su sangría, más la raíz. */
export const destinosDe = (filas = []) => [
  { id: '', etiqueta: '— En la raíz —' },
  ...filas.filter(f => f.es_titulo && f.id != null).map(f => ({
    id: String(f.id),
    etiqueta: `${' '.repeat(Math.max(0, (f.nivel || 1) - 1) * 4)}${f.codigo} · ${f.descripcion}`,
  })),
];
