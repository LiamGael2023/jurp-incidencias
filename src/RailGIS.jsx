import { useState, useEffect } from 'react';
import { FaSignOutAlt, FaBars } from 'react-icons/fa';
import logoNexhydro from './assets/nexhidra/logo-nexhydro.png';
import logoNexhydroMin from './assets/nexhidra/logo-nexhydro-min.png';
import logoHydrometrix from './assets/nexhidra/logo-hydrometrix.png';
import logoPluvira from './assets/nexhidra/logo-pluvira.png';
import logoSentria from './assets/nexhidra/logo-sentria.png';
import './RailGIS.css';

/**
 * Barra lateral compartida por todas las vistas del sistema.
 * Adaptada del sidebar-12 de frontend-joe a la paleta JURP.
 *
 *   menu        → arreglo [{ clave, titulo, icono }]
 *   vistaActual → clave de la vista activa
 *   onNavegar   → función(clave)
 *   usuario     → nombre para el perfil
 *   onLogout    → cerrar sesión
 *
 * El estado colapsado se guarda en localStorage: cada vista monta su propio
 * RailGIS, así que sin eso se volvería a abrir en cada navegación.
 * También publica --rail-w en :root para que el contenido se corra solo.
 */
const ANCHO_ABIERTO = '286px';    // 264 (rail) + 22 (aire)
const ANCHO_CERRADO = '88px';     // 66 + 22

// La app por la que se entró: tiñe el rail y se muestra bajo el logo NEXHYDRO.
const APPS = {
  pluvira:     { logo: logoPluvira,     color: '#EE7B12', nombre: 'PLUVIRA' },
  sentria:     { logo: logoSentria,     color: '#2E9E4F', nombre: 'SENTRIA' },
  hydrometrix: { logo: logoHydrometrix, color: '#1268C3', nombre: 'HYDROMETRIX' },
};

export default function RailGIS({ menu, vistaActual, onNavegar, usuario, onLogout, app }) {
  const [colapsado, setColapsado] = useState(
    () => localStorage.getItem('railColapsado') === '1'
  );

  // Publica el ancho para que .inc-main / .est-main / .rep-main lo usen.
  useEffect(() => {
    document.documentElement.style.setProperty(
      '--rail-w', colapsado ? ANCHO_CERRADO : ANCHO_ABIERTO
    );
  }, [colapsado]);

  const alternar = () => {
    setColapsado(v => {
      localStorage.setItem('railColapsado', v ? '0' : '1');
      return !v;
    });
  };

  const iniciales = (usuario || 'JU')
    .replace(/[^a-zA-Z ]/g, ' ').trim().split(/\s+/)
    .slice(0, 2).map(p => p[0]).join('').toUpperCase() || 'JU';

  const info = APPS[app] || APPS.pluvira;

  return (
    <aside className={`railx ${colapsado ? 'colapsado' : ''}`} style={{ '--app': info.color }}>
      <div className="railx-inner">

        {/* ── marca: logo completo abierta, solo la gota al colapsar ── */}
        <div className="railx-brand">
          <img className="railx-logo" src={logoNexhydro}
            alt="NEXHYDRO — Ecosistema Digital JURP" />
          <img className="railx-logo-min" src={logoNexhydroMin} alt="NEXHYDRO" />
        </div>

        <button type="button" className="railx-colapsar" onClick={alternar}
          title={colapsado ? 'Expandir menú' : 'Colapsar menú'}
          aria-label="Alternar menú">
          <FaBars />
        </button>

        <hr className="railx-divisor" />

        {/* ── módulo activo dentro del ecosistema ── */}
        <div className="railx-app">
          <span className="railx-app-etq">Módulo</span>
          <img className="railx-app-logo" src={info.logo} alt={info.nombre} />
          <span className="railx-app-punto" title={info.nombre} />
        </div>

        {/* ── navegación ── */}
        <ul className="railx-nav">
          {(menu || []).map(m => (
            <li key={m.clave}>
              <button type="button"
                className={vistaActual === m.clave ? 'activo' : ''}
                onClick={() => onNavegar && onNavegar(m.clave)}
                title={m.titulo}>
                <span className="railx-ico">{m.icono}</span>
                <span className="railx-label">{m.titulo}</span>
                <span className="railx-tip">{m.titulo}</span>
              </button>
            </li>
          ))}
        </ul>

        {/* ── perfil, al pie ── */}
        <hr className="railx-divisor railx-divisor-pie" />
        <div className="railx-perfil">
          <span className="railx-avatar" title={usuario}>{iniciales}</span>
          <span className="railx-perfil-txt">
            <span className="railx-perfil-nombre">{usuario || 'Usuario'}</span>
            <span className="railx-perfil-rol">Administrador</span>
          </span>
        </div>

        <button type="button" className="railx-salir" onClick={onLogout} title="Cerrar sesión">
          <span className="railx-ico"><FaSignOutAlt /></span>
          <span className="railx-label">Cerrar sesión</span>
          <span className="railx-tip">Cerrar sesión</span>
        </button>

      </div>
    </aside>
  );
}