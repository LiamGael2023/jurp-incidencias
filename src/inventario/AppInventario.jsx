import { useState, useEffect } from 'react';
import { FaMapMarkedAlt, FaClipboardCheck } from 'react-icons/fa';
import '../App.css';
import '../IncidentesGIS.css';
import '../EstadisticasGIS.css';
import '../ReportesGIS.css';
import '../MaquinariaGIS.css';
import Login from '../Login';
import RailGIS from '../RailGIS';
import MapaInventario from '../MapaInventario';
import ReportesInventario from '../ReportesInventario';
import logoInventario from '../assets/nexhidra/logo-inventario.png';
import minInventario from '../assets/nexhidra/logo-inventario-min.png';

/**
 * INVENTARIO como aplicación propia.
 *
 * POR QUÉ EXISTE, SI YA ESTÁ DENTRO DE NEXHYDRO
 * ---------------------------------------------
 * Quien levanta el inventario no es quien usa el resto del sistema. El
 * inspector está en campo con el teléfono en una mano, va a una estructura,
 * la evalúa y pasa a la siguiente; no entra a pluviómetros, ni a partes
 * diarios, ni a rendición de petróleo. Hacerle atravesar la intro de
 * NEXHYDRO, elegir tarjeta y bajar hasta el final de un menú de diecisiete
 * opciones para llegar a la única que le sirve es trabajo que no hace falta.
 *
 * Aquí entra directo: login y mapa.
 *
 * ES LA MISMA APLICACIÓN, NO UNA COPIA. El visor, el formulario de
 * evaluación, la galería de fotos y los reportes son LOS MISMOS archivos que
 * usa NEXHYDRO —se importan, no se duplican—, así que lo que se arregle en
 * un sitio queda arreglado en los dos. Lo único propio de aquí es esta
 * cáscara: qué se ve en el menú y con qué marca.
 *
 * Y es el mismo padrón de usuarios (PLUVIRA) contra el mismo servidor: quien
 * ya entra a NEXHYDRO entra aquí con la misma clave, sin dar de alta a nadie
 * otra vez.
 */

/* Tres opciones, no diecisiete. La campaña se elige dentro del visor, así
 * que no necesita pantalla propia: esa vive en NEXHYDRO, que es donde se
 * abren y se cierran las campañas. */
const MENU = [
  { clave: 'inv-mapa',     titulo: 'Monitoreo GIS', icono: <FaMapMarkedAlt />,   apps: ['inventario'] },
  { clave: 'inv-reportes', titulo: 'Reportes',      icono: <FaClipboardCheck />, apps: ['inventario'] },
];

const VISTAS = new Set(MENU.map((m) => m.clave));

/* La pantalla abierta va en el hash, como en NEXHYDRO: recargar para ver un
 * cambio recién desplegado no debe devolver al mapa desde los reportes. */
const vistaDeURL = () => {
  const v = (window.location.hash || '').replace(/^#\/?/, '');
  return VISTAS.has(v) ? v : null;
};

export default function AppInventario() {
  const [token, setToken] = useState(() => localStorage.getItem('userToken'));
  const [usuario, setUsuario] = useState(() => localStorage.getItem('userName') || '');
  const [vista, setVista] = useState(() => vistaDeURL() || 'inv-mapa');

  /* Y al revés: si el hash cambia por fuera —un acceso directo del icono
   * instalado apunta a #inv-reportes, o alguien lo edita en la barra— la
   * pantalla tiene que seguirlo. Sin esto la URL decía una cosa y la
   * pantalla enseñaba otra. */
  useEffect(() => {
    const alCambiar = () => { const v = vistaDeURL(); if (v) setVista(v); };
    window.addEventListener('hashchange', alCambiar);
    return () => window.removeEventListener('hashchange', alCambiar);
  }, []);

  useEffect(() => {
    const actual = (window.location.hash || '').replace(/^#\/?/, '');
    if (actual === vista) return;
    // replaceState y no location.hash: asignarlo apila una entrada de
    // historial por cada clic y el botón «atrás» se vuelve inútil.
    window.history.replaceState(window.history.state, '',
      `${window.location.pathname}${window.location.search}#${vista}`);
  }, [vista]);

  const entrar = (t, n) => { setToken(t); setUsuario(n); };

  const salir = () => {
    for (const k of ['userToken', 'userName', 'userGroups', 'userId', 'authOrigen'])
      localStorage.removeItem(k);
    setToken(null);
    setUsuario('');
  };

  /* El padrón es el de PLUVIRA: el inventario vive en el backend de
   * vigilantes pero las cuentas son las del sistema de riego, igual que en
   * NEXHYDRO. Poner otra cosa aquí daría «usuario o contraseña incorrectos»
   * a gente con sus datos bien escritos. */
  if (!token) {
    return (
      <Login onLoginSuccess={entrar} app="pluvira"
             logoMarca={logoInventario} titulo="Inventario de infraestructura" />
    );
  }

  const propsRail = {
    menu: MENU,
    vistaActual: vista,
    onNavegar: setVista,
    usuario,
    onLogout: salir,
    app: 'inventario',
    // Aquí INVENTARIO no es un módulo dentro de otra cosa: es la aplicación.
    marca: { logo: logoInventario, min: minInventario, nombre: 'INVENTARIO' },
  };

  if (vista === 'inv-reportes') {
    return (
      <div className="maq">
        <RailGIS {...propsRail} />
        <div className="maq-main"><ReportesInventario /></div>
      </div>
    );
  }

  // El visor trae su propio rail y se monta a pantalla completa.
  return <MapaInventario {...propsRail} />;
}
