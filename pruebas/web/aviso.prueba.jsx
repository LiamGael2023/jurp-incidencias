/* El aviso de sesión, montado de verdad.
 *
 *   ?v=sesion     el servidor rechaza la sesión (401)
 *   ?v=servidor   el servidor falla (504, como el de openresty)
 *   ?v=red        no se llega a hablar con él
 *   ?v=muchos     cinco peticiones fallan a la vez: un solo cartel
 */
import { createRoot } from 'react-dom/client';
import AvisoSesion from '../../src/AvisoSesion';
import { pedir, marcarEntrada } from '../../src/sesion';

const v = new URLSearchParams(location.search).get('v') || 'sesion';

localStorage.setItem('userToken', 'token-de-prueba');
// Una sesión que lleva 3 h 20 min abierta, para ver si lo dice.
localStorage.setItem('sesionDesde', String(Date.now() - 200 * 60000));

window.__RECARGO = false;
window.__SALIO = false;

const r = (status) => new Response('{}', { status });
window.fetch = async () => {
  if (v === 'red') throw new TypeError('Failed to fetch');
  return r(v === 'servidor' ? 504 : 401);
};

createRoot(document.getElementById('app')).render(
  <AvisoSesion onVolverAEntrar={() => { window.__SALIO = true; }} />
);

// Se lanza después de montar, para que el oyente ya esté suscrito.
setTimeout(() => {
  if (v === 'muchos') {
    // El mapa lanza cinco a la vez; no deben salir cinco carteles.
    for (let i = 0; i < 5; i++) pedir(`/x${i}`, { json: false });
  } else {
    pedir('/datos', { json: false });
  }
}, 150);
