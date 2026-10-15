/* ¿Cada app pregunta a SU padrón de usuarios?
 *
 *     npx vite --port 5199 --strictPort &
 *     node pruebas/web/login.prueba.mjs
 *
 * PLUVIRA y SENTRIA no comparten tabla de usuarios: viven en servidores
 * distintos y el front los separa con los dos rewrites de vercel.json. Si el
 * login fuera al servidor equivocado, el vigilante vería «usuario o
 * contraseña incorrectos» con sus datos bien escritos —mentira, y manda a
 * buscar el problema donde no está—.
 *
 * Se monta el Login de verdad y se mira A DÓNDE llama, no qué dice el código.
 */
import pw from '/opt/node-tools/node_modules/playwright-core/index.js';

const r = [];
const ok = (c, m, e) => { r.push(!!c); console.log(`${c ? 'ok  ' : 'MAL '} ${m}${e ? `   [${e}]` : ''}`); };

const b = await pw.chromium.launch();
const p = await b.newPage();
const errs = [];
p.on('pageerror', e => errs.push(String(e)));
await p.goto('http://localhost:5199/pruebas/web/login.html', { waitUntil: 'domcontentloaded' });
await p.waitForSelector('.boton-login');

const entrar = async (boton, usuario) => {
  await p.click(boton);
  await p.waitForTimeout(250);
  await p.fill('#username', usuario);
  await p.fill('#password', 'clave');
  await p.click('.boton-login');
  await p.waitForTimeout(400);
  return p.evaluate(() => ({
    llamadas: window.__LLAMADAS.map(x => x.url),
    guardado: {
      token: localStorage.getItem('userToken'),
      origen: localStorage.getItem('authOrigen'),
      usuario: localStorage.getItem('userName'),
    },
    entro: document.querySelector('#entro').textContent,
  }));
};

const s = await entrar('#a-sentria', 'vigilante01');
ok(s.llamadas.at(-1) === '/vigapi/mobile/auth/login/',
   'SENTRIA pregunta al padrón de vigilantes, el del Linode nuevo', s.llamadas.at(-1));
ok(s.guardado.origen === 'sentria',
   'y deja marcado de qué padrón salió el token', s.guardado.origen);
ok(s.entro === 'vigilante01:abc123', 'y avisa a App.jsx con el token', s.entro);

await p.evaluate(() => { localStorage.clear(); window.__LLAMADAS = []; });

const u = await entrar('#a-pluvira', 'jperez');
ok(u.llamadas.at(-1) === '/api/v1/mobile/auth/login/',
   'PLUVIRA pregunta al padrón de riego, el de siempre', u.llamadas.at(-1));
ok(u.guardado.origen === 'pluvira', 'y lo marca como tal', u.guardado.origen);

await p.evaluate(() => { localStorage.clear(); window.__LLAMADAS = []; });

// Sin app definida: el histórico, que cubre a casi todo el mundo.
const n = await entrar('#a-nada', 'alguien');
ok(n.llamadas.at(-1) === '/api/v1/mobile/auth/login/',
   'sin app definida cae en PLUVIRA, que es el padrón histórico', n.llamadas.at(-1));

// Las dos rutas tienen que ser DISTINTAS: si alguien las iguala por
// descuido, lo de arriba seguiría pasando y esto no.
ok(s.llamadas.at(-1) !== u.llamadas.at(-1),
   'y los dos caminos no son el mismo');

ok(errs.length === 0, 'ningún error de JS', errs.join(' | '));

const mal = r.filter(x => !x).length;
console.log(`\n${r.length - mal}/${r.length} bien`);
await b.close();
process.exit(mal ? 1 : 0);
