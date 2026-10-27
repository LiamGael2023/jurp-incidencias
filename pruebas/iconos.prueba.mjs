/* Que ningún icono se use sin importarlo.
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

  const sueltos = new Set();
  for (const m of texto.matchAll(USO)) {
    if (!importados.has(m[1])) sueltos.add(m[1]);
  }
  if (sueltos.size) {
    fallos += 1;
    ok(false, `${f} usa sin importar`, [...sueltos].join(', '));
  }
}
ok(fallos === 0, 'ningún fichero usa un icono sin importarlo',
   fallos ? `${fallos} fichero(s)` : '');

/* Y que esto sirva de algo: con el import quitado, tiene que verlo. */
const app = sinComentarios(readFileSync(join(SRC, 'App.jsx'), 'utf8'));
const roto = app.replace(', FaUserTag }', ' }');
ok(roto !== app, 'el sabotaje cambia algo');
const impsRoto = new Set();
for (const m of roto.matchAll(IMPORTA)) {
  for (const t of m[1].split(',')) {
    const n = t.trim().split(/\s+as\s+/).pop().trim();
    if (n) impsRoto.add(n);
  }
}
ok([...roto.matchAll(USO)].some(m => m[1] === 'FaUserTag'
                                 && !impsRoto.has(m[1])),
   'y la comprobación muerde si falta un import');

const malos = r.filter(x => !x).length;
console.log(`\n${r.length - malos} de ${r.length} en orden${malos ? `, ${malos} MAL` : ''}.`);
process.exit(malos ? 1 : 0);
