import { useState, useEffect } from 'react';
import './App.css';
import MapaChavimochic from './Mapa';
import Login from './Login';
import Nexhidra from './Nexhidra';
import Incidentes from './Incidentes';
import Estadisticas from './Estadisticas';
import Vigilancia from './Vigilancia';
import Reportes from './Reportes';
import Maquinaria from './Maquinaria';
import { FaUserCircle, FaSignOutAlt, FaBars, FaMapMarkedAlt, FaListUl, FaChartPie, FaShieldAlt, FaFilePdf, FaTruck } from 'react-icons/fa';
import logo from './assets/logo1.png';

const URL_CAUDIXA = 'http://sistema.jriegopresurizado.org.pe/';

/* Menu completo. "apps" indica desde que tarjeta de NEXHIDRA se ve cada opcion. */
const MENU = [
  { clave: 'mapa',         titulo: 'Monitoreo GIS', icono: <FaMapMarkedAlt />, apps: ['pluvira'] },
  { clave: 'lista',        titulo: 'Incidentes',    icono: <FaListUl />,       apps: ['pluvira'] },
  { clave: 'vigilancia',   titulo: 'Vigilancia',    icono: <FaShieldAlt />,    apps: ['sentria'] },
  { clave: 'estadisticas', titulo: 'Estadísticas',  icono: <FaChartPie />,     apps: ['pluvira'] },
  { clave: 'reportes',     titulo: 'Reportes',      icono: <FaFilePdf />,      apps: ['pluvira'] },
  { clave: 'maquinaria',   titulo: 'Maquinaria',    icono: <FaTruck />,        apps: ['pluvira'] },
];

const vistaInicial = (app) => (app === 'sentria' ? 'vigilancia' : 'mapa');

/* Lee ?app=pluvira | ?app=sentria de la URL. Sirve para abrir cada login
   directo en una pestaña nueva, saltando la intro. */
const appDeURL = () => {
  const a = new URLSearchParams(window.location.search).get('app');
  return a === 'pluvira' || a === 'sentria' ? a : null;
};

function App() {
  const [token, setToken] = useState(localStorage.getItem('userToken'));
  const [nombreUsuario, setNombreUsuario] = useState(localStorage.getItem('userName') || '');

  // Que tarjeta de NEXHIDRA se eligio: define que opciones de menu se muestran.
  const [appElegida, setAppElegida] = useState(
    () => appDeURL() || localStorage.getItem('appElegida') || 'pluvira'
  );

  // Intro NEXHIDRA: se muestra antes del login. Si ya hay sesión activa se salta.
  const [mostrarIntro, setMostrarIntro] = useState(
    () => !appDeURL() && !localStorage.getItem('userToken')
  );

  const [menuPerfilAbierto, setMenuPerfilAbierto] = useState(false);
  const [menuLateralAbierto, setMenuLateralAbierto] = useState(true);
  const [vistaActual, setVistaActual] = useState(
    () => vistaInicial(appDeURL() || localStorage.getItem('appElegida') || 'pluvira')
  );

  // Si se entro por URL directa, dejamos la eleccion guardada.
  useEffect(() => {
    const desdeURL = appDeURL();
    if (desdeURL) localStorage.setItem('appElegida', desdeURL);
  }, []);
  // ID del incidente que se debe abrir automáticamente al entrar a la vista
  // Incidentes (usado por el enlace desde el Panel de Maquinaria).
  const [incidenteAbrir, setIncidenteAbrir] = useState(null);

  // Opciones visibles segun la app elegida.
  const menuVisible = MENU.filter((m) => m.apps.includes(appElegida));

  // Sale de la intro y deja una entrada en el historial, para que el boton
  // "atras" del navegador regrese a NEXHIDRA.
  const salirDeIntro = (app) => {
    localStorage.setItem('appElegida', app);
    setAppElegida(app);
    setVistaActual(vistaInicial(app));
    window.history.pushState({ nexhidra: app }, '');
    setMostrarIntro(false);
  };

  // El boton "atras" vuelve a mostrar la intro.
  useEffect(() => {
    const alRetroceder = () => setMostrarIntro(true);
    window.addEventListener('popstate', alRetroceder);
    return () => window.removeEventListener('popstate', alRetroceder);
  }, []);

  const handleLoginSuccess = (newToken, newUserName) => {
    setToken(newToken);
    setNombreUsuario(newUserName);
  };

  const handleLogout = () => {
    localStorage.removeItem('userToken');
    localStorage.removeItem('userName');
    localStorage.removeItem('userGroups');
    localStorage.removeItem('userId');
    localStorage.removeItem('appElegida');
    setToken(null);
    setNombreUsuario('');
    setMenuPerfilAbierto(false);
    setMostrarIntro(true);   // al cerrar sesión vuelve a la intro NEXHIDRA
  };

  // Navega a la vista Incidentes y solicita abrir un incidente concreto.
  const irAIncidente = (incidenteId) => {
    setIncidenteAbrir(incidenteId);
    setVistaActual('lista');
  };

  // 1) Intro NEXHIDRA
  //    PLUVIRA  -> login, menu completo sin Vigilancia
  //    SENTRIA  -> login, solo el menu Vigilancia
  //    CAUDIXA  -> sale al sistema de riego presurizado
  if (mostrarIntro) {
    return (
      <Nexhidra
        onEntrar={() => salirDeIntro('pluvira')}
        onSentria={() => salirDeIntro('sentria')}
        onCaudixa={() => { window.location.href = URL_CAUDIXA; }}
        hrefPluvira="?app=pluvira"
        hrefSentria="?app=sentria"
        hrefCaudixa={URL_CAUDIXA}
      />
    );
  }

  // 2) Login
  if (!token) {
    return <Login onLoginSuccess={handleLoginSuccess} />;
  }

  return (
    <div className="tbl-layout">

      <aside className={`tbl-sidebar ${menuLateralAbierto ? 'expanded' : 'collapsed'}`}>
        <div className="tbl-sidebar-header">
          <div className="tbl-brand" style={{ width: '100%', paddingLeft: '18px' }}>
            <img src={logo} alt="JURP" className="tbl-brand-img" style={{ height: '42px' }} />
          </div>
        </div>

        <ul className="tbl-nav">
          <li className="tbl-nav-label">{menuLateralAbierto ? 'Menú Principal' : '...'}</li>

          {menuVisible.map((m) => (
            <li
              key={m.clave}
              className={`tbl-nav-item ${vistaActual === m.clave ? 'active' : ''}`}
              onClick={() => setVistaActual(m.clave)}
            >
              <div className="tbl-nav-link">
                <span className="tbl-nav-icon">{m.icono}</span>
                {menuLateralAbierto && <span className="tbl-nav-title">{m.titulo}</span>}
              </div>
            </li>
          ))}
        </ul>
      </aside>
      <div className="tbl-main-content">
        <header className="tbl-header">
          <div className="tbl-header-left">
            <button className="tbl-btn-menu" onClick={() => setMenuLateralAbierto(!menuLateralAbierto)}>
              <FaBars />
            </button>
            <h1 className="tbl-header-title d-none-mobile">Sistema Integrado de Monitoreo</h1>
          </div>
          <div className="tbl-header-right">
            <div className="tbl-dropdown">
              <div className="tbl-user-menu" onClick={() => setMenuPerfilAbierto(!menuPerfilAbierto)}>
                <FaUserCircle size={32} color="#ffffff" />
                <div className="tbl-user-info d-none-mobile">
                  <span className="tbl-user-name">{nombreUsuario}</span>
                  <span className="tbl-user-role">Administrador</span>
                </div>
              </div>

              {menuPerfilAbierto && (
                <div className="tbl-dropdown-menu">
                  <div className="tbl-dropdown-item text-danger" onClick={handleLogout}>
                    <FaSignOutAlt className="tbl-dropdown-icon" /> Cerrar Sesión
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>
        <div className="tbl-page-content">
          {vistaActual === 'mapa' && <MapaChavimochic />}
          {vistaActual === 'lista' && (
            <Incidentes
              incidenteAbrir={incidenteAbrir}
              onIncidenteAbierto={() => setIncidenteAbrir(null)}
            />
          )}
          {vistaActual === 'vigilancia' && <Vigilancia />}
          {vistaActual === 'estadisticas' && <Estadisticas />}
          {vistaActual === 'reportes' && <Reportes />}
          {vistaActual === 'maquinaria' && <Maquinaria irAIncidente={irAIncidente} />}
        </div>
      </div>
    </div>
  );
}

export default App;