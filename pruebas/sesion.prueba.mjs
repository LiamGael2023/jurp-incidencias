/* Que la app sepa QUE paso cuando los datos no llegan.
 *
 *     node pruebas/sesion.prueba.mjs
 *
 * El fallo que esto evita no es que falle una peticion: es que falle y nadie
 * se entere. Las pantallas hacian `if (res.ok) {...}` sin else, asi que un
 * 401, un 504 y un corte de red producian lo mismo -una lista vacia- y los
 * tres se arreglan de forma distinta.
 */
import {
  clasificar, pedir, avisar, alFallar, olvidarAvisos,
  duracionLegible, minutosDeSesion, marcarEntrada, TEXTOS,
} from '../src/sesion.js';

const r = [];
const ok = (c, m, e) => { r.push(!!c); console.log(`${c ? 'ok  ' : 'MAL '} ${m}${e ? `   [${e}]` : ''}`); };

/* localStorage de mentira: node no lo trae, y el modulo tiene que aguantar
 * que no exista -modo privado del navegador- sin reventar. */
const almacen = new Map();
globalThis.localStorage = {
  getItem: (k) => (almacen.has(k) ? almacen.get(k) : null),
  setItem: (k, v) => almacen.set(k, String(v)),
  removeItem: (k) => almacen.delete(k),
};

const res = (status, cuerpo = {}, ok_ = null) => ({
  ok: ok_ === null ? status >= 200 && status < 300 : ok_,
  status,
  json: async () => cuerpo,
});

// ── clasificar: cada caso tiene su nombre ────────────────────────────────
ok(clasificar(res(200), true) === 'ok', '200 es ok');
ok(clasificar(res(401), true) === 'sesion', '401 es la sesión');
ok(clasificar(res(403), true) === 'sesion', '403 CON token también: te conoce y la rechaza');
ok(clasificar(res(403), false) === 'permiso',
   '403 SIN token no es la sesión, es permiso');
ok(clasificar(res(500), true) === 'servidor', '500 es el servidor');
ok(clasificar(res(504), true) === 'servidor',
   'y 504 también: es el proxy, no tu sesión');
ok(clasificar(res(418), true) === 'raro', 'un código inesperado se dice raro');
ok(clasificar(null, true) === 'red', 'sin respuesta es la red');

// Lo que distingue este modulo: tres causas, tres textos.
const textos = new Set([TEXTOS.sesion, TEXTOS.servidor, TEXTOS.red]);
ok(textos.size === 3, 'los tres motivos no dicen lo mismo');
ok(/vuelve a entrar/i.test(TEXTOS.sesion), 'y el de sesión dice qué hacer');
ok(/conexión/i.test(TEXTOS.red), 'el de red, también');

// ── avisar: no apila el mismo cartel cinco veces ─────────────────────────
olvidarAvisos();
const vistos = [];
const quitar = alFallar((a) => vistos.push(a));
ok(avisar('servidor', { url: '/a' }) === true, 'el primer aviso pasa');
ok(avisar('servidor', { url: '/b' }) === false,
   'el segundo igual, enseguida, no: el mapa lanza cinco peticiones a la vez');
ok(avisar('red', { url: '/c' }) === true,
   'pero otro motivo distinto sí pasa: son cosas distintas');
ok(vistos.length === 2, 'así que se avisó dos veces, no tres', `${vistos.length}`);
quitar();
ok(avisar('raro') && vistos.length === 2, 'y al desuscribirse deja de llegar');

// Un oyente que revienta no puede tumbar a los demás.
olvidarAvisos();
const buenos = [];
const q1 = alFallar(() => { throw new Error('roto'); });
const q2 = alFallar((a) => buenos.push(a));
avisar('servidor');
ok(buenos.length === 1, 'un oyente roto no impide que el resto se entere');
q1(); q2();

// ── pedir: el token, y los tres finales ──────────────────────────────────
olvidarAvisos();
almacen.clear();
let avisado = [];
const q3 = alFallar((a) => avisado.push(a));

// Sin token: antes era `if (!token) return;` y la pantalla quedaba muda.
let out = await pedir('/x');
ok(out.motivo === 'sesion' && !out.ok, 'sin token no se pide, y se dice');
ok(avisado.length === 1 && avisado[0].sinToken === true,
   'avisando que fue por no haber token', JSON.stringify(avisado[0] || {}));

almacen.set('userToken', 'abc123');
olvidarAvisos(); avisado = [];

let pedido = null;
globalThis.fetch = async (u, o) => { pedido = { u, o }; return res(200, { results: [1, 2] }); };
out = await pedir('/datos');
ok(out.ok && out.datos.results.length === 2, 'con token, devuelve los datos ya leídos');
ok(pedido.o.headers.Authorization === 'Token abc123',
   'y manda el token en la cabecera', pedido.o.headers.Authorization);
ok(avisado.length === 0, 'una petición que va bien no avisa de nada');

globalThis.fetch = async () => res(401);
out = await pedir('/datos');
ok(out.motivo === 'sesion' && avisado.some(a => a.motivo === 'sesion'),
   'un 401 se cuenta como sesión');

olvidarAvisos(); avisado = [];
globalThis.fetch = async () => res(504);
out = await pedir('/datos');
ok(out.motivo === 'servidor' && avisado[0].status === 504,
   'un 504 se cuenta como servidor, con su código', JSON.stringify(avisado[0] || {}));

olvidarAvisos(); avisado = [];
globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
out = await pedir('/datos');
ok(out.motivo === 'red' && avisado[0].motivo === 'red',
   'un corte de red se cuenta como red, sin reventar');

/* Un 200 cuyo cuerpo no es JSON. Pasa cuando un proxy devuelve su propia
 * pagina de error con codigo 200, y es de los que mas cuestan: res.ok dice
 * que todo fue bien. */
olvidarAvisos(); avisado = [];
globalThis.fetch = async () => ({ ok: true, status: 200,
  json: async () => { throw new SyntaxError('Unexpected token <'); } });
out = await pedir('/datos');
ok(!out.ok && out.motivo === 'raro',
   'un 200 con cuerpo roto NO se da por bueno');

// ── cuánto llevaba abierta la sesión ─────────────────────────────────────
almacen.clear();
ok(minutosDeSesion() === null, 'sin marca de entrada, no se inventa una duración');
marcarEntrada();
ok(minutosDeSesion() === 0, 'recién entrado, cero minutos');
almacen.set('sesionDesde', String(Date.now() - 200 * 60000));
ok(minutosDeSesion() === 200, 'y se cuentan los que pasaron', `${minutosDeSesion()}`);
ok(duracionLegible(45) === '45 min', 'menos de una hora va en minutos');
ok(duracionLegible(200) === '3 h 20 min', 'y más, en horas y minutos',
   duracionLegible(200));
ok(duracionLegible(120) === '2 h', 'una hora exacta no dice "0 min"',
   duracionLegible(120));
almacen.set('sesionDesde', 'no-es-un-numero');
ok(minutosDeSesion() === null, 'una marca corrupta no da una duración falsa');

// El modulo tiene que aguantar que no haya localStorage: modo privado.
const guardado = globalThis.localStorage;
delete globalThis.localStorage;
let revento = false;
try { marcarEntrada(); minutosDeSesion(); } catch (e) { revento = true; }
ok(!revento, 'sin localStorage no revienta: en modo privado no existe');
globalThis.localStorage = guardado;

const mal = r.filter(x => !x).length;
console.log(`\n${r.length - mal} de ${r.length} en orden${mal ? `, ${mal} MAL` : ''}.`);
process.exit(mal ? 1 : 0);
