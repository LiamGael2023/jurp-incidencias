import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';
import AppInventario from './AppInventario.jsx';
import AvisoSesion from '../AvisoSesion.jsx';

/* El aviso de sesión caducada va fuera de la app, como en NEXHYDRO: encima
 * de todo y sin estar en el árbol de nadie. «Volver a entrar» tira el token
 * y recarga, que deja la pantalla igual que un arranque limpio. */
const volverAEntrar = () => {
  try {
    for (const k of ['userToken', 'userName', 'userGroups', 'userId', 'authOrigen'])
      localStorage.removeItem(k);
  } catch (e) { /* modo privado: la recarga lleva al login igual */ }
  window.location.reload();
};

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AppInventario />
    <AvisoSesion onVolverAEntrar={volverAEntrar} />
  </StrictMode>,
);

/* EL TRABAJADOR DE SERVICIO: lo que hace que el navegador ofrezca
 * «Instalar» y que la segunda apertura no vuelva a bajar el bundle.
 *
 * Solo en producción. En `npm run dev` un trabajador registrado se queda
 * sirviendo lo de antes y uno acaba depurando un cambio que sí estaba
 * hecho; es una tarde perdida que no hace falta volver a perder.
 *
 * Si falla el registro no pasa nada: la app funciona igual, solo que sin
 * instalarse. Por eso no se avisa de nada. */
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/inventario/sw.js', { scope: '/inventario/' })
      .catch(() => { /* sin trabajador, app normal */ });
  });
}
