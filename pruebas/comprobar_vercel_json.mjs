/* ¿Aguanta vercel.json lo que Vercel le va a exigir?
 *
 *     node pruebas/comprobar_vercel_json.mjs
 *
 * POR QUÉ EXISTE. Metí un `$comment` dentro de vercel.json para dejar
 * anotado que ese fichero no lee variables de entorno. Comprobé que seguía
 * siendo JSON válido —lo era— y lo empujé. Vercel lo valida además contra
 * SU esquema, que no admite claves que no conozca, y tumbó el despliegue
 * entero:
 *
 *     The `vercel.json` schema validation failed with the following
 *     message: should NOT have additional property `$comment`
 *
 * El fallo no estaba en el JSON sino en lo que yo comprobé: que estuviera
 * bien formado no es lo mismo que sirva. Esto mira lo segundo.
 *
 * NO ES EL ESQUEMA DE VERCEL, es la parte que cabe aquí sin red: las claves
 * de primer nivel y la forma de los rewrites. Eso basta para coger lo que
 * se cuela de verdad —una clave inventada, un comentario, una errata en
 * 'rewrites'— que es casi todo lo que uno rompe a mano.
 */
import { readFileSync } from 'node:fs';

// Las de primer nivel que Vercel documenta. Si algún día hace falta una que
// no esté, se añade AQUÍ: una lista que se puentea no comprueba nada.
const PERMITIDAS = new Set([
  'buildCommand', 'cleanUrls', 'crons', 'devCommand', 'env', 'framework',
  'functions', 'git', 'headers', 'ignoreCommand', 'images', 'installCommand',
  'outputDirectory', 'public', 'redirects', 'regions', 'rewrites', 'routes',
  'trailingSlash',
]);

const fallos = [];
const avisos = [];
let cfg;

try {
  cfg = JSON.parse(readFileSync('vercel.json', 'utf8'));
} catch (e) {
  console.error('vercel.json no es JSON válido: ' + e.message);
  process.exit(1);
}

for (const k of Object.keys(cfg)) {
  if (!PERMITIDAS.has(k)) {
    fallos.push(k.startsWith('$')
      ? `«${k}»: JSON no admite comentarios, y Vercel rechaza las claves que `
        + 'no conoce. Las notas van en DESPLIEGUE.md.'
      : `«${k}» no es una clave de primer nivel conocida.`);
  }
}

for (const [i, r] of (cfg.rewrites || []).entries()) {
  const d = `rewrites[${i}]`;
  if (typeof r.source !== 'string') fallos.push(`${d}: le falta «source».`);
  if (typeof r.destination !== 'string') fallos.push(`${d}: le falta «destination».`);
  // Un host viejo olvidado aquí no rompe el despliegue: lo deja en pie
  // llamando a un servidor que ya no está, que es peor.
  if (/duckdns/.test(r.destination || '')) {
    fallos.push(`${d}: sigue apuntando al servidor viejo → ${r.destination}`);
  }
  if (/^http:\/\//.test(r.destination || '')) {
    avisos.push(`${d}: va por HTTP, en claro → ${r.destination}`);
  }
}

for (const a of avisos) console.log('aviso  ' + a);
if (!fallos.length) {
  console.log(`\nvercel.json en orden: ${Object.keys(cfg).length} clave(s), `
    + `${(cfg.rewrites || []).length} rewrite(s).`);
  process.exit(0);
}
console.log('');
for (const f of fallos) console.log('MAL    ' + f);
console.log(`\n${fallos.length} problema(s): Vercel rechazaría este fichero.`);
process.exit(1);
