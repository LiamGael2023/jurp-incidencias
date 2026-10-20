/* Medir el contraste WCAG de lo que hay PINTADO en la página.
 *
 * Estaba escrito dentro de evaluacion.prueba.mjs y lo necesitaba la segunda
 * pantalla, así que vive aquí. Copiarlo habría dejado dos medidores que se
 * separan con el primer arreglo que se le haga a uno.
 *
 * POR QUE MEDIR Y NO LEER EL CSS. Dos veces escribí texto con la paleta
 * oscura dentro de un panel claro y las dos veces lo descubrió el usuario,
 * no yo: en la ficha del activo y en el formulario de evaluación. El color
 * declarado no dice nada por sí solo; lo que importa es contra qué fondo
 * acaba cayendo, y eso depende de qué ancestro tiene fondo opaco. Por eso el
 * fondo se busca SUBIENDO por los padres hasta dar con uno que no sea
 * transparente: es lo que el ojo ve de verdad detrás del texto, y es justo
 * el paso que no se puede hacer leyendo una hoja de estilos.
 */

/* Se pasa como fuente y no como función porque cruza al navegador. */
export const MEDIDOR = `(sel) => {
  const lum = (c) => {
    const [r, g, b] = c.match(/[\\d.]+/g).slice(0, 3).map(Number).map(v => {
      v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const fondoDe = (el) => {
    for (let n = el; n; n = n.parentElement) {
      const bg = getComputedStyle(n).backgroundColor;
      const a = bg.match(/[\\d.]+/g);
      if (a && (a.length < 4 || Number(a[3]) > 0.5)) return bg;
    }
    return 'rgb(255,255,255)';
  };
  return [...document.querySelectorAll(sel)].map(el => {
    const s = getComputedStyle(el);
    const L1 = lum(s.color), L2 = lum(fondoDe(el));
    const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    return {
      texto: (el.textContent || '').trim().slice(0, 34),
      color: s.color, fondo: fondoDe(el),
      ratio: +ratio.toFixed(2),
      tam: parseFloat(s.fontSize),
      visible: el.offsetWidth > 0 && el.offsetHeight > 0,
    };
  });
}`;

/** Un medidor atado a una página: medir('.sel') → filas. */
export const medidorDe = (page) =>
  (sel) => page.evaluate(new Function('return ' + MEDIDOR)(), sel);

/* AA para texto normal. El 3.0 de texto grande no se usa aquí a propósito:
 * en estas pantallas casi nada llega a 18.66px en negrita, y tener dos
 * listones invita a colar un gris flojo diciendo que el rótulo era grande. */
export const MINIMO = 4.5;
