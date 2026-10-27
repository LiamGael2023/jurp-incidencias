/* La pantalla de usuarios: PLUVIRA y SENTRIA, el mismo componente.
 *
 *     npx vite --port 5199 --strictPort &
 *     node pruebas/web/equipos.prueba.mjs
 *
 * Lo que vigila, por orden de lo que duele:
 *
 * 1. QUE LA FILA SEA LA PERSONA, NO EL ENLACE. Cuando la fila era el equipo,
 *    quien todavía no había entrado desde un celular no aparecía: se creaba
 *    la cuenta y no se veía por ningún lado.
 * 2. QUE LA CLAVE SE VEA UNA VEZ Y SE PUEDA COPIAR. El servidor no la
 *    guarda en claro; si se cierra ese diálogo sin copiarla, el único
 *    remedio es generar otra.
 * 3. QUE SE AVISE DE LO QUE CIERRA SESION. Cambiar el rol o la clave le tira
 *    la sesión a quien esté en campo llenando un parte.
 * 4. QUE EL ENCIERRO DEL SERVIDOR SE LEA. Un 409 con su motivo tiene que
 *    llegar a la pantalla; si se traga el cuerpo, el usuario ve "no se pudo"
 *    y vuelve a intentarlo.
 * 5. QUE SENTRIA NO ENSEÑE COLUMNAS DE EQUIPO NI AVISOS DE PERMISOS QUE NO
 *    EXISTEN. No tener equipos es cómo está hecho ese sistema, no un
 *    problema que se arregle pidiendo un permiso.
 */
import pw from '/opt/node-tools/node_modules/playwright-core/index.js';
import { medidorDe, MINIMO } from './contraste.mjs';

const BASE = 'http://localhost:5199/pruebas/web/equipos.html';
const r = [];
const ok = (c, m, e) => { r.push(!!c); console.log(`${c ? 'ok  ' : 'MAL '} ${m}${e ? `   [${e}]` : ''}`); };

const b = await pw.chromium.launch();
const p = await b.newPage({ viewport: { width: 1500, height: 950 } });
const errs = [];
p.on('pageerror', e => errs.push(String(e)));

const ir = async (v) => {
  await p.goto(`${BASE}?v=${v}`, { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('.eqe', { timeout: 10000 });
  await p.waitForTimeout(450);
};

const filas = () => p.locator('.eqe-tabla tbody tr');

// ══════════ PLUVIRA: USUARIOS CON Y SIN EQUIPO ══════════
await ir('mezcla');

ok(await filas().count() === 4, 'se listan TODOS los usuarios, no solo los enlazados',
   `${await filas().count()}`);
const tabla = await p.locator('.eqe-tabla').innerText();
ok(/rsilva/.test(tabla),
   'incluida la que nunca entró desde un celular',
   'cuando la fila era el enlace, ésta no aparecía');
ok(/nunca entró/.test(tabla), 'y se dice que nunca entró');
ok(/Vigilante/.test(tabla) && /Supervisor/.test(tabla),
   'con su rol en cada fila');
ok(/Samsung SM-A135M/.test(tabla), 'y el equipo al lado, cuando lo hay');
ok(/sin equipo enlazado/.test(tabla), 'o que no lo hay, cuando no');
ok(/Desactivado/.test(tabla), 'y los desactivados se distinguen');

// La firma de quién liberó: sin ella, "¿quién liberó esto tres veces este
// mes?" no tiene respuesta.
ok(/admin\.soporte/.test(tabla), 'la firma de quién liberó sigue a la vista');

// ══════════ EL AVISO QUE DECIDE EL ENCENDIDO ══════════
const aviso = await p.locator('.eqe-aviso').first().innerText();
ok(/12/.test(aviso), 'dice cuántos entran sin identificar su equipo',
   aviso.replace(/\n/g, ' ').slice(0, 70));

// ══════════ CREAR: LA CLAVE SE VE UNA VEZ ══════════
await p.locator('.eqe-nuevo').click();
await p.waitForSelector('.swal2-popup', { timeout: 5000 });
const opciones = await p.locator('.swal2-popup select option').allInnerTexts();
ok(opciones.join('|').includes('Vigilante'),
   'al crear se ofrecen los roles QUE DA EL SERVIDOR', opciones.join(' | '));
ok(!opciones.join('|').includes('undefined'), 'y ninguna opción muda');

/* EL ROL NO VIENE PRESELECCIONADO, y es lo que más importa de este diálogo.
 * El servidor devuelve los grupos por nombre, así que el primero de la lista
 * en SENTRIA es `mobile_gerencia`: sin opción vacía, rellenar los nombres y
 * pulsar Crear sin mirar el combo creaba una cuenta capaz de administrar a
 * todas las demás. */
ok(await p.locator('#f-rol').inputValue() === '',
   'y NINGUNO viene elegido de antemano',
   await p.locator('#f-rol').inputValue());

await p.fill('#f-user', 'nuevo.vigilante');
await p.locator('.swal2-confirm').click();
await p.waitForTimeout(350);
const queja = await p.locator('.swal2-validation-message').count()
  ? await p.locator('.swal2-validation-message').innerText() : '';
ok(/rol/i.test(queja), 'y sin elegirlo no deja crear', queja.slice(0, 80));
ok(await p.evaluate(() => window.__CREADO) === null,
   'ni se manda nada al servidor');

await p.fill('#f-nom', 'Nuevo');
await p.fill('#f-ape', 'Vigilante');
await p.locator('#f-rol').selectOption('vigilante_group');
await p.locator('.swal2-confirm').click();
await p.waitForTimeout(700);

const creado = await p.evaluate(() => window.__CREADO);
ok(creado && creado.username === 'nuevo.vigilante', 'se crea con lo tecleado',
   JSON.stringify(creado));
ok(creado && creado.role === 'vigilante_group', 'y con el rol elegido');

const cred = await p.locator('.swal2-popup').innerText();
ok(/Kj7mN4pQxR/.test(cred), 'la clave generada se enseña',
   cred.replace(/\n/g, ' ').slice(0, 90));
ok(/no se vuelve a mostrar|solo se ven? una vez|cópiala/i.test(cred),
   'avisando de que no se vuelve a ver',
   cred.replace(/\n/g, ' ').slice(0, 120));
await p.locator('.swal2-confirm').click();
await p.waitForTimeout(400);

// ══════════ CAMBIAR EL ROL AVISA DE QUE CIERRA SESION ══════════
await ir('mezcla');
await filas().first().locator('button:has-text("Rol")').click();
await p.waitForSelector('.swal2-popup', { timeout: 5000 });
const dlgRol = await p.locator('.swal2-popup').innerText();
ok(/cierra su sesión|cerrará su sesión|cierra la sesión/i.test(dlgRol),
   'cambiar el rol avisa de que le cierra la sesión',
   dlgRol.replace(/\n/g, ' ').slice(0, 120));
await p.locator('#f-rol2').selectOption('supervisor_group');
await p.locator('.swal2-confirm').click();
await p.waitForTimeout(700);
const rol = await p.evaluate(() => window.__ROL);
ok(rol && rol.role === 'supervisor_group', 'y lo manda al servidor',
   JSON.stringify(rol));

// ══════════ SENTRIA: MISMO COMPONENTE, SIN EQUIPOS ══════════
await ir('sentria');
ok(await filas().count() === 4, 'SENTRIA lista sus usuarios igual',
   `${await filas().count()}`);

const urls = await p.evaluate(() => window.__URLS);
ok(urls.every(u => !u.includes('/dispositivos/')),
   'sin pedir equipos, que ahí no existen', urls.join(' | ').slice(0, 140));
ok(urls.some(u => u.includes('/vigapi/mobile/users/list/')),
   'y contra el servidor de vigilancia', urls.join(' | ').slice(0, 140));

/* En minúsculas a propósito: el CSS pone las cabeceras en mayúsculas, así
 * que `includes('Equipo')` era falso aunque la columna estuviera ahí. La
 * comprobación pasaba por el motivo equivocado. */
const cabeceras = (await p.locator('.eqe-tabla thead th').allInnerTexts())
  .join('|').toLowerCase();
ok(!cabeceras.includes('equipo'), 'no hay columna de equipo', cabeceras);
ok(!cabeceras.includes('último uso'), 'ni de último uso', cabeceras);
ok(cabeceras.includes('rol'), 'pero sí la de rol', cabeceras);

// Lo que distingue "este sistema no tiene equipos" de "no tienes permiso":
// si se confundieran, SENTRIA tendría un aviso permanente sobre un permiso
// que no existe.
ok(await p.locator('.eqe-aviso').count() === 0,
   'y ningún aviso sobre permisos que no existen',
   await p.locator('.eqe-aviso').count()
     ? await p.locator('.eqe-aviso').first().innerText() : '');
const cab = await p.locator('.eqe-cab').innerText();
ok(!/y equipos/i.test(cab), 'ni un título que hable de equipos',
   cab.replace(/\n/g, ' ').slice(0, 70));

// ══════════ GERENCIA SIN SER ADMIN DEL SERVIDOR ══════════
// Aquí sí falta un permiso, y es otra cosa: los usuarios se ven igual.
await ir('sinequipos');
ok(await filas().count() === 4,
   'si fallan los equipos, los usuarios se ven igual',
   'lo contrario escondía la mitad útil de la pantalla');
const avisoSE = await p.locator('.eqe-aviso').first().innerText();
ok(/permiso/i.test(avisoSE), 'y se explica por qué falta la columna',
   avisoSE.replace(/\n/g, ' ').slice(0, 110));

// ══════════ NO ERES DE GERENCIA ══════════
await ir('sinpermiso');
ok(await filas().count() === 0, 'sin permiso no se listan usuarios');
const fallo = await p.locator('.eqe-fallo').count()
  ? await p.locator('.eqe-fallo').innerText() : '';
ok(/Gerencia/i.test(fallo), 'y se dice que es cuestión de permisos',
   fallo.replace(/\n/g, ' ').slice(0, 110));
ok(!/sesi[oó]n/i.test(fallo),
   'sin mandarlo a volver a entrar, que no arreglaría nada',
   fallo.replace(/\n/g, ' ').slice(0, 110));
/* Y UNA SOLA VEZ. La pantalla ya lo explica, con más detalle que el cartel
 * global: avisar también por ahí ponía «no tienes permiso (código 403)»
 * encima del mensaje bueno. Las dos llamadas —usuarios y roles— fallan
 * juntas, así que basta con que una no lo silencie para que salga. */
ok((await p.evaluate(() => window.__AVISOS)).length === 0,
   'y no se avisa además por el cartel de arriba',
   (await p.evaluate(() => window.__AVISOS)).join(', '));

/* EL MOTIVO LO PONE EL SERVIDOR. Quién administra cuentas no es lo mismo en
 * los dos sistemas: en PLUVIRA es Gerencia y en SENTRIA son los
 * supervisores. Si el texto estuviera escrito en la pantalla, SENTRIA
 * mandaría a pedirle el permiso a un grupo que allí no administra nada. */
await ir('sinpermiso-sentria');
const falloS = await p.locator('.eqe-fallo').count()
  ? await p.locator('.eqe-fallo').innerText() : '';
ok(/Supervisor/i.test(falloS), 'en SENTRIA el motivo habla de Supervisor',
   falloS.replace(/\n/g, ' ').slice(0, 110));
ok(!/Gerencia/i.test(falloS), 'y no de Gerencia, que ahí no administra nada',
   falloS.replace(/\n/g, ' ').slice(0, 110));

// ══════════ EL SERVIDOR NO LO SOPORTA ══════════
await ir('viejo');
ok(await p.locator('.eqe-tabla').count() === 0,
   'sin soporte no se dibuja una tabla vacía');
ok(await p.locator('.eqe-falta').count() === 1,
   'y sale el aviso de que falta en el servidor');

// ══════════ QUE SE LEA ══════════
await ir('mezcla');
const flojos = (await medidorDe(p)(
  '.eqe-cab h2, .eqe-cab p, .eqe-aviso, .eqe-tabla th, .eqe-tabla td, .eqe-sub, .eqe-tag, .eqe-mini, .eqe-liberar, .eqe-chip, .eqe-nuevo'))
  .filter(f => f.visible && f.texto && f.ratio < MINIMO);
ok(flojos.length === 0, 'toda la pantalla pasa AA',
   flojos.map(f => `"${f.texto}" ${f.ratio}:1`).join(' | '));

ok(errs.length === 0, 'sin errores de JavaScript', errs.join(' | ').slice(0, 200));

await b.close();
const malos = r.filter(x => !x).length;
console.log(`\n${r.length - malos} de ${r.length} en orden${malos ? `, ${malos} MAL` : ''}.`);
process.exit(malos ? 1 : 0);
