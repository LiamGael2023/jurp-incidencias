import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import AvisoSesion from './AvisoSesion.jsx'

/* EL AVISO VA FUERA DE App, no dentro.
 *
 * App tiene seis ramas de return -una por tipo de pantalla- y meterlo en
 * todas seria repetirlo seis veces y olvidarlo en la septima. Va fijo y por
 * encima de todo, asi que no necesita estar en el arbol de nadie.
 *
 * "Volver a entrar" tira el token y recarga, en vez de llamar al logout de
 * App: desde aqui no se alcanza, y recargar deja la app en el mismo estado
 * que un arranque limpio, que es justo lo que hace falta cuando la sesion
 * ya no vale. */
const volverAEntrar = () => {
  try {
    for (const k of ['userToken', 'userName', 'userGroups', 'userId', 'authOrigen'])
      localStorage.removeItem(k);
  } catch (e) { /* modo privado: la recarga lleva al login igual */ }
  window.location.reload();
};

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
    <AvisoSesion onVolverAEntrar={volverAEntrar} />
  </StrictMode>,
)
