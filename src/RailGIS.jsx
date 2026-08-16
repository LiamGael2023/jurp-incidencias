import { useState, useEffect } from 'react';
import { FaSignOutAlt, FaBars } from 'react-icons/fa';
import iconoJURP from './assets/jurp-icono.png';
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
const ANCHO_ABIERTO = '300px';    // 18 (margen) + 264 (rail) + 18 (aire)
const ANCHO_CERRADO = '102px';    // 18 + 66 + 18

export default function RailGIS({ menu, vistaActual, onNavegar, usuario, onLogout }) {
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

  return (
    <aside className={`railx ${colapsado ? 'colapsado' : ''}`}>
      <div className="railx-inner">

        {/* ── marca ── */}
        <div className="railx-brand">
          <img className="railx-logo" src={iconoJURP} alt="JURP" />
          <span className="railx-nombre">
            NEXHYDRO
            <small>Ecosistema JURP</small>
          </span>
        </div>

        <button type="button" className="railx-colapsar" onClick={alternar}
          title={colapsado ? 'Expandir menú' : 'Colapsar menú'}
          aria-label="Alternar menú">
          <FaBars />
        </button>

        <hr className="railx-divisor" />

        {/* ── perfil ── */}
        <div className="railx-perfil">
          <span className="railx-avatar" title={usuario}>{iniciales}</span>
          <span className="railx-perfil-txt">
            <span className="railx-perfil-nombre">{usuario || 'Usuario'}</span>
            <span className="railx-perfil-rol">Administrador</span>
          </span>
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

        <button type="button" className="railx-salir" onClick={onLogout} title="Cerrar sesión">
          <span className="railx-ico"><FaSignOutAlt /></span>
          <span className="railx-label">Cerrar sesión</span>
          <span className="railx-tip">Cerrar sesión</span>
        </button>

      </div>
    </aside>
  );
}