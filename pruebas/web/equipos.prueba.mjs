/* El panel de equipos enlazados.
 *
 *     npx vite --port 5199 --strictPort &
 *     node pruebas/web/equipos.prueba.mjs
 *
 * Lo que vigila, por orden de lo que duele:
 *
 * 1. QUE EL NUMERO DE "SIN IDENTIFICAR" SE VEA Y SE ENTIENDA. Es el que
 *    decide si se puede encender el bloqueo: con gente en la app vieja,
 *    encenderlo deja fuera justo a los de campo.
 * 2. QUE LIBERAR PREGUNTE CON EL EQUIPO DELANTE. Liberar al usuario
 *    equivocado no da error: le deja entrar desde cualquier celular, que es
 *    lo que esta pantalla existe para impedir.
 * 3. QUE LA FIRMA SE VEA. Sin ella, "¿quien libero esta cuenta tres veces
 *    este mes?" no tiene respuesta.
 * 4. QUE SI EL SERVIDOR NO LO SOPORTA, SE DIGA, en vez de una tabla vacia
 *    que se lee como "nadie esta enlazado" -que es lo contrario-.
 */
import pw from '/opt/node-tools/node_modules/playwright-core/index.js';
import { medidorDe, MINIMO } from './contraste.mjs';

const BASE = 'http://localhost:5199/pruebas/web/equipos.html';
const r = [];
const ok = (c, m, e) => { r.push(!!c); console.log(`${c ? 'ok  ' : 'MAL '} ${m}${e ? `   [${e}]` : ''}`); };

const b = await pw.chromium.launch();
const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
const errs = [];
p.on('pageerror', e => errs.push(String(e)));

const ir = async (v) => {
  await p.goto(`${BASE}?v=${v}`, { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('.eqe', { timeout: 10000 });
  await p.waitForTimeout(400);
};

// ══════════ CON GENTE EN LA APP VIEJA ══════════
await ir('mezcla');
const aviso = await p.locator('.eqe-aviso').innerText();
ok(/12/.test(aviso), 'dice cuántos entran sin identificar su equipo',
   aviso.replace(/\n/g, ' ').slice(0, 80));
ok(/no van a poder entrar|app vieja/i.test(aviso),
   'y qué pasa si se enciende el bloqueo ahora',
   aviso.replace(/\n/g, ' ').slice(0, 110));
ok(await p.locator('.eqe-aviso-mal').count() === 1,
   'con el color de advertencia, no el de todo en orden');

ok(await p.locator('.eqe-tabla tbody tr').count() === 2,
   'por defecto solo los enlazados', `${await p.locator('.eqe-tabla tbody tr').count()}`);
const prim = await p.locator('.eqe-tabla tbody tr').first().innerText();
ok(/jperez/.test(prim) && /SM-A135M/.test(prim),
   'con el usuario y su equipo', prim.replace(/\n/g, ' ').slice(0, 70));
ok(/hace 45 días|hace 45 dias/.test(await p.locator('.eqe-tabla').innerText()),
   'y cuánto hace del último uso, que es lo que dice si el enlace sigue vivo');

// ══════════ LIBERAR ══════════
await p.locator('.eqe-liberar').first().click();
await p.waitForSelector('.swal2-popup', { timeout: 5000 });
const pregunta = await p.locator('.swal2-popup').innerText();
ok(/jperez/.test(pregunta), 'se pregunta nombrando al usuario',
   pregunta.replace(/\n/g, ' ').slice(0, 70));
ok(/SM-A135M/.test(pregunta), 'y el equipo del que se va a soltar');
ok(await p.evaluate(() => document.activeElement.className).then(c => /cancel/.test(c)),
   'con el foco en Conservar, no en Liberar');

// Cancelar no libera nada.
await p.locator('.swal2-cancel').click();
await p.waitForTimeout(400);
ok(await p.evaluate(() => window.__LIBERADO) === null,
   'cancelar no suelta nada');

await p.locator('.eqe-liberar').first().click();
await p.waitForSelector('.swal2-confirm', { timeout: 5000 });
await p.locator('.swal2-confirm').click();
await p.waitForTimeout(700);
ok(await p.evaluate(() => window.__LIBERADO) === 1,
   'confirmar sí, y por POST a su ruta',
   (await p.evaluate(() => window.__URLS)).filter(x => x.includes('liberar')).join(' | '));
ok(await p.locator('.eqe-tabla tbody tr').count() === 1,
   'y sale de la lista de enlazados');

// ══════════ LA FIRMA ══════════
await ir('mezcla');
await p.locator('.eqe-chip:has-text("Liberados")').click();
await p.waitForTimeout(600);
const lib = await p.locator('.eqe-tabla tbody tr').first().innerText();
ok(/rsilva/.test(lib), 'los liberados se pueden consultar', lib.replace(/\n/g, ' ').slice(0, 50));
ok(/admin\.soporte/.test(lib),
   'con la firma de quién lo liberó', lib.replace(/\n/g, ' ').slice(0, 90));
ok(await p.locator('.eqe-tabla tbody tr .eqe-liberar').count() === 0,
   'y no se ofrece liberar lo que ya está liberado');

// Una fila liberada se apaga, pero tiene que seguir legible: es historial.
const grises = (await medidorDe(p)('.eqe-libre td, .eqe-libre .eqe-sub'))
  .filter(f => f.visible && f.texto && f.ratio < MINIMO);
ok(grises.length === 0, 'y sigue siendo legible, que es historial',
   grises.map(f => `"${f.texto}" ${f.ratio}:1`).join(' | '));

// ══════════ TODOS IDENTIFICADOS ══════════
await ir('limpio');
ok(await p.locator('.eqe-aviso-ok').count() === 1,
   'con todos identificados, el aviso cambia de signo');
ok(/ya se puede encender/i.test(await p.locator('.eqe-aviso').innerText()),
   'y dice que ya se puede bloquear sin dejar a nadie fuera');

// ══════════ EL SERVIDOR NO LO SOPORTA ══════════
await ir('viejo');
ok(await p.locator('.eqe-tabla').count() === 0, 'sin soporte no se dibuja una tabla vacía');
/* Se mira que EXISTA antes de leerlo: sin esta comprobacion, quitar la
 * rama del 404 no daba un MAL sino un timeout de treinta segundos que
 * tumbaba el resto de la prueba. */
ok(await p.locator('.eqe-falta').count() === 1,
   'y sale el aviso de que falta en el servidor');
const falta = await p.locator('.eqe-falta').count()
  ? await p.locator('.eqe-falta').innerText() : '';
ok(/todavía no enlaza|todavia no enlaza/i.test(falta),
   'se dice que el servidor no lo tiene', falta.replace(/\n/g, ' ').slice(0, 70));
ok(/cualquiera que tenga la clave/i.test(falta),
   'y qué significa eso mientras tanto, que es lo que importa',
   falta.replace(/\n/g, ' ').slice(0, 130));

// ══════════ UN USUARIO SIN PERMISO ══════════
// El menu ofrece esta pantalla, y el endpoint es solo para administradores.
// Lo que ve el de campo que la abre tiene que decirle la verdad: no es que
// su sesion se haya caido —mandarlo a volver a entrar lo hace salir y entrar
// para nada, y en un sistema donde ya se sospecha de tokens que caducan, eso
// ensucia justo el dato que se intenta limpiar.
await ir('sinpermiso');
ok(await p.locator('.eqe-falta').count() === 0,
   'un 403 no se confunde con "el servidor no lo tiene"');
ok(await p.locator('.eqe-fallo').count() === 1, 'sale un aviso');
const noPerm = await p.locator('.eqe-fallo').count()
  ? await p.locator('.eqe-fallo').innerText() : '';
ok(/no es administrador|no eres administrador/i.test(noPerm),
   'y dice que es cuestion de permisos', noPerm.replace(/\n/g, ' ').slice(0, 110));
ok(!/sesi[oó]n/i.test(noPerm),
   'sin mandarlo a volver a entrar, que no arreglaria nada',
   noPerm.replace(/\n/g, ' ').slice(0, 110));
const flojosP = (await medidorDe(p)('.eqe-fallo'))
  .filter(f => f.visible && f.texto && f.ratio < MINIMO);
ok(flojosP.length === 0, 'y el aviso se lee',
   flojosP.map(f => `"${f.texto}" ${f.ratio}:1`).join(' | '));

// ══════════ QUE SE LEA ══════════
await ir('mezcla');
const flojos = (await medidorDe(p)(
  '.eqe-cab h2, .eqe-cab p, .eqe-aviso, .eqe-tabla th, .eqe-tabla td, .eqe-sub, .eqe-tag, .eqe-liberar, .eqe-chip'))
  .filter(f => f.visible && f.texto && f.ratio < MINIMO);
ok(flojos.length === 0, 'todo el panel pasa AA',
   flojos.map(f => `"${f.texto}" ${f.ratio}:1`).join(' | '));

ok(errs.length === 0, 'sin errores de JavaScript', errs.join(' | ').slice(0, 200));

await b.close();
const mal = r.filter(x => !x).length;
console.log(`\n${r.length - mal} de ${r.length} en orden${mal ? `, ${mal} MAL` : ''}.`);
process.exit(mal ? 1 : 0);
