/* CÓMO QUIERE VER CADA UNO SUS CAPAS.
 *
 * ──────────────────────────────────────────────────────────────────────
 * POR QUÉ EXISTE ESTO
 * ──────────────────────────────────────────────────────────────────────
 *
 * El estilo de cada capa estaba escrito en el código, y cada vez que
 * alguien quería un trazo más fino o un relleno más tenue hacía falta un
 * commit y un despliegue. Tres peticiones así en una sola tarde —el
 * relleno de los lotes, el blanco de las cuencas, el celeste de los
 * cauces— dejaron claro que el cuello de botella no era el cambio, era
 * tener que pedirlo.
 *
 * Ahora lo ajusta quien lo necesita, en el momento.
 *
 * ──────────────────────────────────────────────────────────────────────
 * LO QUE HAY EN EL CÓDIGO SIGUE SIENDO EL PUNTO DE PARTIDA
 * ──────────────────────────────────────────────────────────────────────
 *
 * Esto NO reemplaza el estilo de cada capa: lo pisa, campo a campo y solo
 * donde el usuario haya tocado algo. Un ajuste guardado es «quiero ESTE
 * grosor», no «quiero este estilo entero».
 *
 * Importa porque el estilo del código sigue vivo: la lámina engorda los
 * trazos al imprimir, las capas del PECH van más tenues, un sector
 * coloreado no se puntea. Si guardar un color congelara el estilo
 * completo, el día que se afine cualquiera de esas reglas los que hayan
 * tocado algo se quedarían fuera sin enterarse.
 *
 * ──────────────────────────────────────────────────────────────────────
 * VIVE EN EL NAVEGADOR, Y ESO TIENE CONSECUENCIAS
 * ──────────────────────────────────────────────────────────────────────
 *
 * `localStorage`, o sea: por navegador y por equipo. Quien ajuste el mapa
 * en la oficina no se lo encuentra igual en casa, y dos personas pueden
 * sacar la misma lámina con aspecto distinto.
 *
 * Es deliberado para esta primera versión: no toca el servidor, no hay
 * que decidir quién manda sobre el estilo de los demás, y resuelve hoy el
 * problema de tener que pedir cada cambio. Cuando haga falta que la
 * lámina salga igual para todos, lo que se añade encima es un «fijar como
 * predeterminado» que escriba esto mismo en el servidor.
 *
 * Y puede fallar: navegación privada, almacenamiento lleno, un perfil con
 * las cookies bloqueadas. Por eso todo va envuelto: si no se puede
 * guardar, el mapa se ve con el estilo del código y nadie ve un error.
 * Un ajuste de color no es motivo para romper una pantalla.
 */

import { useState, useEffect } from 'react';

const CLAVE = 'jurp.estiloCapas.v1';

/* Lo que una capa puede llevar ajustado. Cualquier otra cosa que llegue
 * guardada se ignora: es la defensa contra un localStorage de una versión
 * futura —o de alguien que lo editó a mano— metiendo campos en el estilo
 * de Leaflet. */
export const CAMPOS = ['color', 'weight', 'opacity', 'fillOpacity', 'dash', 'rotulo'];

/* ══════════════════════════════════════════════════════════════════════
 * EL ESTADO
 * ══════════════════════════════════════════════════════════════════════
 *
 * Fuera de React, como los permisos y por el mismo motivo: lo consultan
 * la función de estilo de las capas —que corre dentro de Leaflet, no en
 * un componente— y el panel de ajustes, que está en otra rama del árbol.
 */
let ajustes = null;             // null = todavía no se ha leído
const oyentes = new Set();

function leerDisco() {
  try {
    const crudo = localStorage.getItem(CLAVE);
    if (!crudo) return {};
    const d = JSON.parse(crudo);
    if (!d || typeof d !== 'object') return {};
    // Se copia campo a campo en vez de confiar en lo que haya: ver CAMPOS.
    const limpio = {};
    for (const [codigo, v] of Object.entries(d)) {
      if (!v || typeof v !== 'object') continue;
      const fila = {};
      for (const k of CAMPOS) if (v[k] !== undefined) fila[k] = v[k];
      if (Object.keys(fila).length) limpio[codigo] = fila;
    }
    return limpio;
  } catch {
    /* JSON corrupto, almacenamiento bloqueado, cuota llena. Ninguna de
     * las tres es razón para dejar al usuario sin mapa. */
    return {};
  }
}

function escribirDisco() {
  try {
    if (!ajustes || !Object.keys(ajustes).length) localStorage.removeItem(CLAVE);
    else localStorage.setItem(CLAVE, JSON.stringify(ajustes));
    return true;
  } catch {
    return false;
  }
}

function avisar() {
  for (const fn of oyentes) {
    try { fn(); } catch { /* un oyente roto no tumba a los demás */ }
  }
}

/** Todos los ajustes guardados. Se lee del disco la primera vez. */
export function todosLosAjustes() {
  if (ajustes === null) ajustes = leerDisco();
  return ajustes;
}

/** Lo que el usuario haya tocado en esta capa. `{}` si no ha tocado nada. */
export function ajusteDe(codigo) {
  return todosLosAjustes()[codigo] || {};
}

/** ¿Tiene esta capa algo ajustado a mano? Para marcarlo en la lista. */
export function estaAjustada(codigo) {
  return Object.keys(ajusteDe(codigo)).length > 0;
}

/** ¿Hay algo ajustado en cualquier capa? Para habilitar «restablecer todo». */
export function hayAjustes() {
  return Object.keys(todosLosAjustes()).length > 0;
}

/**
 * Guarda uno o varios campos de una capa.
 *
 * Un valor `undefined` BORRA ese campo, que es como se vuelve al valor
 * del código sin tener que recordarlo. Y cuando una capa se queda sin
 * ningún campo, desaparece entera del almacenamiento: así `estaAjustada`
 * dice la verdad y no queda un `{}` haciendo creer que hay algo tocado.
 */
export function ajustar(codigo, cambios) {
  const todo = todosLosAjustes();
  const fila = { ...(todo[codigo] || {}) };

  for (const [k, v] of Object.entries(cambios)) {
    if (!CAMPOS.includes(k)) continue;
    if (v === undefined) delete fila[k];
    else fila[k] = v;
  }

  if (Object.keys(fila).length) todo[codigo] = fila;
  else delete todo[codigo];

  ajustes = todo;
  const guardado = escribirDisco();
  avisar();
  return guardado;
}

/** Devuelve una capa a como viene de fábrica. */
export function restablecer(codigo) {
  const todo = todosLosAjustes();
  if (!(codigo in todo)) return true;
  delete todo[codigo];
  ajustes = todo;
  const guardado = escribirDisco();
  avisar();
  return guardado;
}

/** Devuelve TODAS las capas a como vienen de fábrica. */
export function restablecerTodo() {
  ajustes = {};
  const guardado = escribirDisco();
  avisar();
  return guardado;
}

/**
 * Avisa cuando algo cambia. Devuelve la función para dejar de escuchar.
 *
 * Lo usa el hook de abajo, pero también sirve desde fuera de React: la
 * capa de Leaflet se entera por aquí para repintarse con `setStyle` en
 * vez de reconstruirse, que con cuatro megas de GeoJSON es la diferencia
 * entre mover un deslizador y congelar la pestaña.
 */
export function suscribir(fn) {
  oyentes.add(fn);
  return () => oyentes.delete(fn);
}

/**
 * EL ESTILO FINAL DE UNA CAPA: el del código, con lo del usuario encima.
 *
 * `base` es lo que la capa trae calculado —ya con el engorde de la lámina,
 * la atenuación del PECH y el rayado de contexto aplicados—, y aquí solo
 * se pisan los campos que el usuario haya tocado.
 *
 * `dash` se trata aparte porque en Leaflet el campo se llama `dashArray` y
 * porque es el único que puede querer valer «ninguno» a propósito: un
 * `false` guardado significa «esta capa la quiero continua aunque el
 * sistema la puntee», que no es lo mismo que no haber tocado nada.
 */
export function conAjustes(codigo, base) {
  const a = ajusteDe(codigo);
  if (!Object.keys(a).length) return base;

  const fuera = { ...base };
  if (a.color !== undefined) { fuera.color = a.color; fuera.fillColor = a.color; }
  if (a.weight !== undefined) fuera.weight = a.weight;
  if (a.opacity !== undefined) fuera.opacity = a.opacity;
  if (a.fillOpacity !== undefined) fuera.fillOpacity = a.fillOpacity;
  if (a.dash !== undefined) fuera.dashArray = a.dash ? '6 4' : null;
  return fuera;
}

/** ¿Debe rotularse esta capa? `undefined` = lo que diga el código. */
export function rotuloAjustado(codigo) {
  return ajusteDe(codigo).rotulo;
}

/* ══════════════════════════════════════════════════════════════════════
 * LOS COLORES DE CADA SECTOR
 * ══════════════════════════════════════════════════════════════════════
 *
 * Un sector no es una capa, pero se guarda igual: como una entrada más,
 * con una clave reservada. Así hereda sin escribir nada el guardado, la
 * suscripción, «restablecer todo» y la lista blanca de campos.
 *
 * SE GUARDA POR NOMBRE, no por posición en la lista. El reparto
 * automático de colores mira qué sector linda con cuál, así que si mañana
 * llega un polígono nuevo el reparto cambia entero. Un color fijado para
 * SECTOR 3 tiene que seguir siendo de SECTOR 3 después de eso.
 */
const PREFIJO_SECTOR = 'sector:';

export function colorDeSector(nombre) {
  if (!nombre) return undefined;
  return ajusteDe(PREFIJO_SECTOR + nombre).color;
}

export function ponerColorDeSector(nombre, color) {
  return ajustar(PREFIJO_SECTOR + nombre, { color });
}

/** ¿Hay algún sector con color elegido a mano? */
export function haySectoresAjustados() {
  return Object.keys(todosLosAjustes()).some(k => k.startsWith(PREFIJO_SECTOR));
}

/** Devuelve todos los sectores a los colores que reparte el algoritmo. */
export function restablecerSectores() {
  const todo = todosLosAjustes();
  for (const k of Object.keys(todo)) {
    if (k.startsWith(PREFIJO_SECTOR)) delete todo[k];
  }
  ajustes = todo;
  const guardado = escribirDisco();
  avisar();
  return guardado;
}

/**
 * Para los componentes: se repintan cuando alguien ajusta algo.
 *
 * Devuelve un número que sube con cada cambio. No devuelve los ajustes en
 * sí a propósito: quien los necesite los pide con `ajusteDe`, y así un
 * componente que solo quiere enterarse del cambio no acarrea el objeto
 * entero por sus dependencias.
 */
export function useAjustesCapas() {
  const [v, setV] = useState(0);
  useEffect(() => suscribir(() => setV(n => n + 1)), []);
  return v;
}
