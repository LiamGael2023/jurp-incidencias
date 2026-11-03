/**
 * Los dibujos acotados de la ficha de papel, para el formulario de evaluación.
 *
 * POR QUÉ. El formulario pide «Base (b₁)», «Altura (h₂)», «Talud (Z)»,
 * «Longitud (Lt₁)». Esas letras no significan nada por sí solas: lo que dice
 * dónde se mide cada una es el croquis que la ficha de inspección lleva
 * impreso al lado de los campos. Sin él, dos inspectores miden cosas
 * distintas y el inventario queda con números que no se pueden comparar.
 *
 * Los dibujos salen de los diez formatos de levantamiento en campo (canal,
 * tomas, desarenadores, canoas, pases, entregas, alcantarillas, aliviaderos,
 * sifones y redes sublaterales), recortados de la primera hoja de cada uno.
 * Son vectoriales en el PDF, así que están rasterizados a 300 ppp y guardados
 * en webp: las trece láminas juntas pesan menos de 200 KB, que es lo que pesa
 * UNA foto de campo sin comprimir.
 *
 * CÓMO SE COLOCAN. Dos sitios, según la lámina:
 *
 *   · Las que son de un componente concreto —la compuerta, la retención, los
 *     diques— se pintan DENTRO de su bloque del formulario, justo encima de
 *     los campos que acotan, igual que en el papel.
 *   · Las que son de la estructura entera van en una tira arriba del todo.
 *
 * El emparejamiento se hace por el título del bloque, y no por un índice ni
 * por el nombre del campo, porque los bloques los decide el catálogo del
 * servidor: ahí se pueden renombrar o reordenar sin tocar este archivo. Si un
 * título deja de coincidir, la lámina no desaparece: se cae a la tira de
 * arriba, que es el peor caso aceptable.
 */

/* Vite resuelve esto en build: cada webp acaba con su hash y su URL. */
const ARCHIVOS = import.meta.glob('./assets/esquemas/*.webp', {
  eager: true, query: '?url', import: 'default',
});

const url = (clave) => ARCHIVOS[`./assets/esquemas/${clave}.webp`] || null;

/* Qué enseña cada lámina y, si es de un componente, en qué bloque entra.
 * `bloques` son trozos de título en minúscula y sin tildes; basta con que uno
 * aparezca dentro del título del bloque. Vacío = lámina de la estructura
 * entera, va en la tira de arriba. */
const LAMINAS = {
  'canal': {
    titulo: 'Sección del canal y camino de servicio',
    pie: 'Rectangular y trapezoidal: b, B, e, y, h, Z, CS, x.',
    bloques: [],
  },
  'toma': {
    titulo: 'Planta y perfil de la toma',
    pie: 'L₁, L₂, L₃, e, b, Ø, h, Z.',
    bloques: ['toma'],
  },
  'toma-compuerta': {
    titulo: 'Compuerta metálica',
    pie: 'a, b, H y vástago.',
    bloques: ['compuerta'],
  },
  'toma-retencion': {
    titulo: 'Retención',
    pie: 'Altura h sobre la sección del canal.',
    bloques: ['retencion'],
  },
  'desarenador': {
    titulo: 'Sección del tanque sedimentador',
    pie: 'e, b, c, h, h₁, h₂, h₃.',
    bloques: ['sedimentador', 'tanque'],
  },
  'canoa': {
    titulo: 'Planta de la canoa',
    pie: 'B₁, B₂, b, Lp, Lt₁, Lt₂, Ls, L.',
    bloques: [],
  },
  'canoa-diques': {
    titulo: 'Diques de encauzamiento',
    pie: 'C, H y talud Z, en roca y en material propio.',
    bloques: ['dique', 'encauzamiento'],
  },
  'puente': {
    titulo: 'Sección y planta del pase',
    pie: 'A, B, b, L, l, h, e.',
    bloques: [],
  },
  'entrega': {
    titulo: 'Planta y perfil de la entrega',
    pie: 'L₁, L₂, L₃, B, b, e, h.',
    bloques: [],
  },
  'alcantarilla': {
    titulo: 'Planta y perfil de la alcantarilla',
    pie: 'B₁, B₂, L, Lt₁, Lt₂, h₁, h₂, h₃.',
    bloques: [],
  },
  'aliviadero': {
    titulo: 'Planta y sección del disipador',
    pie: 'a, b, c, d, e, f, h, i, j, k.',
    bloques: ['disipador'],
  },
  'sifon': {
    titulo: 'Perfil del sifón',
    pie: 'L, Lt₁, Lt₂, b, h, Ø y ducto de inspección.',
    bloques: [],
  },
  'sublateral': {
    titulo: 'Tubería y camino de servicio',
    pie: 'D, P_D, B, CS, x.',
    bloques: [],
  },
};

/* Qué láminas lleva cada capa del inventario. Una capa sin entrada
 * simplemente no enseña croquis; eso no es un fallo, es que esa estructura
 * no tiene ficha con dibujo. */
const POR_TIPO = {
  tomas_l10: ['toma', 'toma-compuerta', 'toma-retencion'],
  tomas_otros_sectores: ['toma', 'toma-compuerta', 'toma-retencion'],
  tomas_canal_madre: ['toma', 'toma-compuerta', 'toma-retencion'],
  entregas: ['entrega'],
  canoas: ['canoa', 'canoa-diques'],
  sifon: ['sifon'],
  alcantarilla: ['alcantarilla'],
  aliviadero: ['aliviadero'],
  desarenadores: ['desarenador'],
  puente_vehicular: ['puente'],
  laterales: ['canal'],
  canal_madre: ['canal'],
  canal_lateral_10: ['canal'],
  subalterales: ['sublateral'],
  redes_presurizado: ['sublateral'],
};

/** Minúsculas y sin tildes: «Retención» y «retencion» son el mismo bloque. */
export const normaliza = (t) => String(t || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().trim();

/**
 * Las láminas de un tipo de activo, ya con su URL resuelta.
 * → [{ clave, titulo, pie, bloques, src }]
 */
export function laminasDe(tipo) {
  const claves = POR_TIPO[tipo] || [];
  return claves
    .map((c) => ({ clave: c, ...(LAMINAS[c] || {}), src: url(c) }))
    // Una lámina sin archivo no se pinta: mejor un bloque sin croquis que un
    // recuadro roto encima de los campos.
    .filter((l) => l.src && l.titulo);
}

/** La lámina que le toca a un bloque del formulario, o null. */
export function laminaDeBloque(laminas, titulo) {
  const t = normaliza(titulo);
  if (!t) return null;
  return laminas.find(
    (l) => (l.bloques || []).some((clave) => t.includes(clave))
  ) || null;
}

/**
 * Las que no han encontrado bloque: van en la tira de arriba.
 * @param titulos los títulos de los bloques que el formulario va a pintar
 */
export function laminasSueltas(laminas, titulos) {
  const dentro = new Set();
  (titulos || []).forEach((t) => {
    const l = laminaDeBloque(laminas, t);
    if (l) dentro.add(l.clave);
  });
  return laminas.filter((l) => !dentro.has(l.clave));
}
