import { useState } from 'react';
import './App.css';
import MapaChavimochic from './Mapa';
import Login from './Login';
import Incidentes from './Incidentes';
import { FaUserCircle, FaSignOutAlt, FaBars, FaMapMarkedAlt, FaListUl, FaChartPie, FaCog } from 'react-icons/fa';
import logo from './assets/logo1.png';

function App() {
  const [token, setToken] = useState(localStorage.getItem('userToken'));
  const [nombreUsuario, setNombreUsuario] = useState(localStorage.getItem('userName') || '');
  
  const [menuPerfilAbierto, setMenuPerfilAbierto] = useState(false);
  const [menuLateralAbierto, setMenuLateralAbierto] = useState(true);
  const [vistaActual, setVistaActual] = useState('mapa');

  const handleLoginSuccess = (newToken, newUserName) => {
    setToken(newToken);
    setNombreUsuario(newUserName);
  };

  const handleLogout = () => {
    localStorage.removeItem('userToken');
    localStorage.removeItem('userName');
    setToken(null);
    setNombreUsuario('');
    setMenuPerfilAbierto(false);
  };

  if (!token) {
    return <Login onLoginSuccess={handleLoginSuccess} />;
  }

  return (
    <div className="tbl-layout">
      
      {/* SIDEBAR CLARO (Fondo Blanco) */}
      <aside className={`tbl-sidebar ${menuLateralAbierto ? 'expanded' : 'collapsed'}`}>
  <div className="tbl-sidebar-header">
    <div className="tbl-brand" style={{ width: '100%', paddingLeft: '18px' }}>
      <img 
        src={logo} // 🟢 USAMOS EL LOGO LOCAL IMPORTADO
        alt="JURP" 
        className="tbl-brand-img" 
        style={{ height: '42px' }} 
      />
    </div>
  </div>
        
        <ul className="tbl-nav">
          <li className="tbl-nav-label">{menuLateralAbierto ? 'Menú Principal' : '...'}</li>
          
          <li className={`tbl-nav-item ${vistaActual === 'mapa' ? 'active' : ''}`} onClick={() => setVistaActual('mapa')}>
            <div className="tbl-nav-link">
              <span className="tbl-nav-icon"><FaMapMarkedAlt /></span>
              {menuLateralAbierto && <span className="tbl-nav-title">Monitoreo GIS</span>}
            </div>
          </li>
          
          <li className={`tbl-nav-item ${vistaActual === 'lista' ? 'active' : ''}`} onClick={() => setVistaActual('lista')}>
            <div className="tbl-nav-link">
              <span className="tbl-nav-icon"><FaListUl /></span>
              {menuLateralAbierto && <span className="tbl-nav-title">Incidentes</span>}
            </div>
          </li>
          
          <li className={`tbl-nav-item ${vistaActual === 'reportes' ? 'active' : ''}`} onClick={() => setVistaActual('reportes')}>
            <div className="tbl-nav-link">
              <span className="tbl-nav-icon"><FaChartPie /></span>
              {menuLateralAbierto && <span className="tbl-nav-title">Estadísticas</span>}
            </div>
          </li>
          
          <li className={`tbl-nav-item ${vistaActual === 'config' ? 'active' : ''}`} onClick={() => setVistaActual('config')}>
            <div className="tbl-nav-link">
              <span className="tbl-nav-icon"><FaCog /></span>
              {menuLateralAbierto && <span className="tbl-nav-title">Configuración</span>}
            </div>
          </li>
        </ul>
      </aside>

      <div className="tbl-main-content">
        {/* HEADER AZUL CORPORATIVO */}
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
                {/* Ícono de usuario en color blanco */}
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

        {/* ÁREA DE RENDERIZADO */}
        <div className="tbl-page-content">
          {vistaActual === 'mapa' && <MapaChavimochic />}
          {vistaActual === 'lista' && <Incidentes />}
          {vistaActual === 'reportes' && <div className="tbl-empty-state"><h3>Módulo de Estadísticas</h3><p>En construcción</p></div>}
          {vistaActual === 'config' && <div className="tbl-empty-state"><h3>Configuración</h3><p>En construcción</p></div>}
        </div>
      </div>
    </div>
  );
}

export default App;