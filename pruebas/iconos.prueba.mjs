/* Que ningún icono ni ningún gancho de React se use sin importarlo.
 *
 *     node pruebas/iconos.prueba.mjs
 *
 * POR QUE EXISTE. `<FaUserTag />` en el menú de App.jsx sin su import. El
 * build pasó —rolldown no mira nombres indefinidos, eso es cosa del
 * navegador— y el despliegue salió verde. En producción la página quedó en
 * blanco con `Uncaught ReferenceError: FaUserTag is not defined`, porque el
 * menú es una constante que se evalúa al cargar el módulo: no es que falle
 * esa pantalla, es que no arranca ninguna.
 *
 * Es el mismo fallo que en el lado Python vigila la prueba de los parches
 * —usar `re.compile` sin `import re`—, y aquí no había nada equivalente.
 *
 * Mira los iconos y no cualquier componente porque son los que se añaden de
 * uno en uno, copiando una línea de otro sitio, y los que no avisan hasta
 * que el navegador los busca. Un componente propio sin importar casi siempre
 * se nota antes, al escribirlo.
 *
 * LOS GANCHOS SE AÑADIERON DESPUES, y por lo mismo. Montando HYDROMETRIX se
 * quitó `useRef` de la lista de imports de HydroPiezas.jsx mientras se
 * limpiaba otra cosa, y `SelectorTomas` seguía usándolo para cerrarse al
 * pinchar fuera. El build volvió a pasar. Habría sido otra pantalla en
 * blanco, con el mismo mensaje y la misma cara de sorpresa.
 *
 * Son el mismo agujero —un nombre que no existe y que nadie comprueba hasta
 * que el navegador lo busca— y se tapa con la misma lista.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = new URL('../src/', import.meta.url).pathname;
const r = [];
const ok = (c, m, e) => { r.push(!!c); console.log(`${c ? 'ok  ' : 'MAL '} ${m}${e ? `   [${e}]` : ''}`); };

/* Prefijos de react-icons: Fa, Md, Bi, Bs, Fi, Hi, Io, Ri, Si, Tb, Gi... Se
 * reconocen por la forma del nombre, no por una lista: dos o tres minúsculas
 * iniciales y luego mayúscula. */
const USO = /<\s*([A-Z][a-z]{1,2}[A-Z]\w*)\b/g;
const IMPORTA = /import\s*\{([^}]*)\}\s*from\s*['"]react-icons\/[^'"]+['"]/g;

/* Un gancho es `useAlgo(` con mayúscula detrás de «use»: así entran
 * useState, useRef y los propios -useDatos, useFiltros- y no entra una
 * variable que se llame `usuario` o un método `.use(`. El punto delante lo
 * descarta la frontera \b junto con la comprobación de que no venga pegado
 * a un punto. */
const USO_GANCHO = /(^|[^.\w])\b(use[A-Z]\w*)\s*\(/g;

/* Fuera los comentarios antes de buscar. Sin esto, un `// va dentro del
 * <MapContainer>` explicando dónde va un componente contaba como uso, y la
 * prueba señalaba dos ficheros que no tenían nada roto. Una prueba que grita
 * donde no hay fallo se acaba ignorando, y entonces tampoco avisa cuando sí.
 *
 * El `//` de `http://` no es un comentario: por eso se exige que no venga
 * pegado a dos puntos. */
const sinComentarios = (t) => t
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

const ficheros = readdirSync(SRC).filter(f => f.endsWith('.jsx'));
ok(ficheros.length > 0, 'hay ficheros que revisar', `${ficheros.length}`);

let fallos = 0;
for (const f of ficheros) {
  const texto = sinComentarios(readFileSync(join(SRC, f), 'utf8'));

  const importados = new Set();
  for (const m of texto.matchAll(IMPORTA)) {
    for (const trozo of m[1].split(',')) {
      const nombre = trozo.trim().split(/\s+as\s+/).pop().trim();
      if (nombre) importados.add(nombre);
    }
  }
  /* Lo definido en el propio fichero vale igual: hay componentes locales que
   * se llaman así -Cabecera, Fila- y no vienen de react-icons. */
  for (const m of texto.matchAll(
      /(?:function|const|let|class)\s+([A-Z]\w*)/g)) {
    importados.add(m[1]);
  }
  for (const m of texto.matchAll(
      /import\s+([A-Z]\w*)\s+from|import\s*\{([^}]*)\}\s*from/g)) {
    if (m[1]) importados.add(m[1]);
    if (m[2]) {
      for (const t of m[2].split(',')) {
        const n = t.trim().split(/\s+as\s+/).pop().trim();
        if (n) importados.add(n);
      }
    }
  }
  /* Los ganchos propios se definen en minúscula -useDatos, useFiltros-, que
   * es justo lo que la regla de arriba descarta por empezar en mayúscula. */
  for (const m of texto.matchAll(
      /(?:function|const|let)\s+(use[A-Z]\w*)/g)) {
    importados.add(m[1]);
  }

  const sueltos = new Set();
  for (const m of texto.matchAll(USO)) {
    if (!importados.has(m[1])) sueltos.add(m[1]);
  }
  for (const m of texto.matchAll(USO_GANCHO)) {
    if (!importados.has(m[2])) sueltos.add(m[2]);
  }
  if (sueltos.size) {
    fallos += 1;
    ok(false, `${f} usa sin importar`, [...sueltos].join(', '));
  }
}
ok(fallos === 0, 'ningún fichero usa un icono o un gancho sin importarlo',
   fallos ? `${fallos} fichero(s)` : '');

/* Y que esto sirva de algo: con un import quitado, tiene que verlo.
 *
 * El icono se saca del propio fichero en vez de escribirlo aquí. La primera
 * versión decía `FaUserTag` a mano y se rompió en cuanto ese import dejó de
 * ser el último de la lista: la prueba daba MAL sin que hubiera nada roto,
 * que es la forma más rápida de que alguien la desactive. */
const app = sinComentarios(readFileSync(join(SRC, 'App.jsx'), 'utf8'));
const usados = [...app.matchAll(USO)].map(m => m[1]).filter(n => /^Fa/.test(n));
const victima = usados[0];
ok(!!victima, 'hay algún icono en App.jsx que sabotear', victima);
const roto = app.replace(new RegExp(`,\\s*${victima}\\b`), '');
ok(roto !== app, 'el sabotaje cambia algo', victima);
const impsRoto = new Set();
for (const m of roto.matchAll(IMPORTA)) {
  for (const t of m[1].split(',')) {
    const n = t.trim().split(/\s+as\s+/).pop().trim();
    if (n) impsRoto.add(n);
  }
}
ok([...roto.matchAll(USO)].some(m => m[1] === victima
                                 && !impsRoto.has(victima)),
   'y la comprobación muerde si falta un import', victima);

/* Lo mismo para los ganchos, con el caso real: quitarle `useRef` al fichero
 * que lo usa para cerrar el desplegable al pinchar fuera.
 *
 * El fichero y el gancho se buscan en lugar de escribirlos aquí, por la
 * misma razón que arriba: una prueba anclada a un nombre concreto se pone
 * roja el día que ese nombre cambia, sin que haya nada roto, y una prueba
 * que grita en falso se acaba apagando. */
const conGancho = ficheros
  .map(f => [f, sinComentarios(readFileSync(join(SRC, f), 'utf8'))])
  .find(([, t]) => /import\s*\{[^}]*\buseRef\b[^}]*\}\s*from\s*['"]react['"]/
    .test(t) && /(^|[^.\w])\buseRef\s*\(/.test(t));
ok(!!conGancho, 'hay un fichero que importa y usa useRef',
   conGancho ? conGancho[0] : 'ninguno');

if (conGancho) {
  const [nombreF, textoF] = conGancho;
  const sinImport = textoF.replace(
    /(import\s*\{[^}]*?),\s*useRef\b/, '$1');
  ok(sinImport !== textoF, 'el sabotaje del gancho cambia algo', nombreF);

  const impsG = new Set();
  for (const m of sinImport.matchAll(
      /import\s+([A-Z]\w*)\s+from|import\s*\{([^}]*)\}\s*from/g)) {
    if (m[1]) impsG.add(m[1]);
    if (m[2]) for (const t of m[2].split(',')) {
      const n = t.trim().split(/\s+as\s+/).pop().trim();
      if (n) impsG.add(n);
    }
  }
  for (const m of sinImport.matchAll(/(?:function|const|let)\s+(use[A-Z]\w*)/g)) {
    impsG.add(m[1]);
  }
  ok([...sinImport.matchAll(USO_GANCHO)].some(
       m => m[2] === 'useRef' && !impsG.has('useRef')),
     'y la comprobación de ganchos muerde si falta el import', nombreF);
}

const malos = r.filter(x => !x).length;
console.log(`\n${r.length - malos} de ${r.length} en orden${malos ? `, ${malos} MAL` : ''}.`);
process.exit(malos ? 1 : 0);
