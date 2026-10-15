/* El login manda a cada app a SU padrón de usuarios.
 *
 * PLUVIRA y SENTRIA no comparten tabla de usuarios: cada una vive en un
 * servidor distinto, y el front las separa con los dos rewrites de
 * vercel.json. Si el login fuera a parar al servidor equivocado, el
 * vigilante vería «usuario o contraseña incorrectos» con sus datos bien
 * escritos —que es mentira, y manda a buscar el problema donde no está—.
 *
 * Se monta el Login de verdad y se apunta a dónde llama.
 */
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import Login from '../../src/Login';

window.__LLAMADAS = [];
const real = window.fetch;
window.fetch = async (u, opc) => {
  window.__LLAMADAS.push({ url: String(u), cuerpo: opc && opc.body });
  return new Response(JSON.stringify({
    token: 'abc123', user: { id: 7, groups: ['vigilancia'] },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};
void real;

function Banco() {
  const [app, setApp] = useState('pluvira');
  const [quien, setQuien] = useState('');
  return (
    <div>
      <div id="mando" style={{ padding: 8, background: '#eee' }}>
        <button id="a-pluvira" onClick={() => setApp('pluvira')}>pluvira</button>
        <button id="a-sentria" onClick={() => setApp('sentria')}>sentria</button>
        <button id="a-nada" onClick={() => setApp(undefined)}>sin app</button>
        <span id="app-actual">{String(app)}</span>
        <span id="entro">{quien}</span>
      </div>
      <Login key={String(app)} app={app}
        onLoginSuccess={(t, u) => setQuien(`${u}:${t}`)} />
    </div>
  );
}

createRoot(document.getElementById('app')).render(<Banco />);
