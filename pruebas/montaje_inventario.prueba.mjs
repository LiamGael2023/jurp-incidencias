/* ¿Monta cada pantalla del inventario lo que sus botones necesitan?
 *
 *     node pruebas/montaje_inventario.prueba.mjs
 *
 * POR QUÉ EXISTE. El popup de un activo tiene botones que no hacen nada por sí
 * mismos: solo cambian un estado del hook, y lo que abre la pantalla es un
 * componente que la vista tiene que haber montado aparte.
 *
 * Hay DOS vistas que usan useInventario —el visor general (Mapa.jsx) y la
 * pantalla de Inventario (MapaInventario.jsx)— y es facilísimo montar algo en
 * una y olvidarlo en la otra. Pasó exactamente eso: «Ver ficha y fotos» quedó
 * montado solo en Mapa.jsx, y en Inventario el botón no hacía absolutamente
 * nada. Sin error en consola, sin aviso, sin nada que mirar.
 *
 * Ese es el problema de fondo: este fallo es MUDO. No lo caza ni el compilador
 * ni el linter ni una prueba de las otras, porque todo el código es correcto;
 * lo que falta es una línea en un sitio. La única forma de que no se repita es
 * comprobar el montaje en sí.
 *
 * Si mañana se añade otro componente de pantalla completa al inventario, va a
 * esta lista.
 */
import { readFileSync } from 'node:fs';

/* Componentes que TODA vista con useInventario debe montar, y el botón que
 * se queda muerto si falta. */
const OBLIGATORIOS = [
  ['ModalEvaluacion', 'el botón «Evaluar» del popup'],
  ['FichaActivo', 'el botón «Ver ficha y fotos» del popup'],
];

const VISTAS = ['src/Mapa.jsx', 'src/MapaInventario.jsx'];

let mal = 0, bien = 0;
const t = (etiqueta, ok) => {
  if (ok) { bien++; return; }
  mal++;
  console.log(`MAL  ${etiqueta}`);
};
const leer = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

/* La lámina también usa el hook, pero dibuja las capas en modo impresión: es
 * una hoja para imprimir, no tiene dónde abrir una pantalla completa y el
 * popup no enseña el botón. Por eso está exenta, y la prueba comprueba que
 * SIGUE estándolo: si alguien le quita el `impresion`, el botón aparecería
 * sobre una vista que no monta la ficha y volveríamos al botón muerto. */
const EXENTAS = ['src/MapaTematico.jsx'];

// 1. Las vistas de la lista son, de verdad, las que usan el hook. Si alguien
//    añade una pantalla nueva, esto lo dice en vez de dejarla sin vigilar.
const todas = ['src/Mapa.jsx', 'src/MapaInventario.jsx', 'src/MapaTematico.jsx',
               'src/Mapa3D.jsx', 'src/App.jsx'];
const usanElHook = todas.filter(f => {
  try { return /\buseInventario\s*\(/.test(leer(f)); } catch { return false; }
});
t(`las vistas que usan useInventario están todas contempladas (encontradas: ${usanElHook.join(', ')})`,
  JSON.stringify(usanElHook.sort()) === JSON.stringify([...VISTAS, ...EXENTAS].sort()));

for (const exenta of EXENTAS) {
  t(`${exenta} sigue dibujando en modo impresión, que es lo que la exime`,
    /<CapasInventario[^>]*\bimpresion\b/s.test(leer(exenta)));
}

// El botón de la ficha solo se pinta fuera del modo impresión.
t('el popup esconde «Ver ficha y fotos» cuando se imprime',
  /\{!impresion && \([\s\S]{0,200}inv\.abrirFicha/.test(leer('src/InventarioGIS.jsx')));

// 2. Cada vista monta cada componente obligatorio, y además lo importa.
for (const vista of VISTAS) {
  const txt = leer(vista);
  for (const [comp, boton] of OBLIGATORIOS) {
    t(`${vista} importa ${comp}`,
      new RegExp(`import[^;]*\\b${comp}\\b[^;]*from\\s*'\\./InventarioGIS'`, 's').test(txt));
    // El montaje, no una mención en un comentario: <Comp ... />
    t(`${vista} monta <${comp}/> — si no, ${boton} no hace nada`,
      new RegExp(`<${comp}\\b[^>]*/>`).test(txt));
  }
}

// 3. Y al revés: que el popup no llame a algo que el hook no expone. Un
//    inv.abrirLoQueSea que no existe revienta al pulsar, y en producción eso
//    es una pantalla que se queda congelada.
const gis = leer('src/InventarioGIS.jsx');
const llamadas = [...gis.matchAll(/\binv\.(\w+)\(/g)].map(m => m[1]);
const devueltos = (() => {
  // El return del hook: desde "return {" hasta el "};" de ese bloque.
  const i = gis.indexOf('export function useInventario');
  const r = gis.slice(i).match(/return\s*\{([\s\S]*?)\n\s*\};/);
  return new Set((r ? r[1] : '').match(/[A-Za-z_]\w*/g) || []);
})();
const huerfanas = [...new Set(llamadas)].filter(n => !devueltos.has(n));
t(`el popup no llama a nada que el hook no devuelva (huérfanas: ${huerfanas.join(', ') || 'ninguna'})`,
  huerfanas.length === 0);

console.log(`\n${bien} comprobación(es) en orden${mal ? `, ${mal} MAL` : ''}.`);
process.exit(mal ? 1 : 0);
