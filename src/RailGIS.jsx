import { FaSignOutAlt } from 'react-icons/fa';
import iconoJURP from './assets/jurp-icono.png';
import './MapaGIS.css';

/**
 * Rail de navegación compartido por todas las vistas del sistema.
 * Los estilos viven en MapaGIS.css (.gis-rail y derivados).
 *
 *   menu        → arreglo [{ clave, titulo, icono }]
 *   vistaActual → clave de la vista activa
 *   onNavegar   → función(clave)
 *   usuario     → nombre para el avatar
 *   onLogout    → cerrar sesión
 */
export default function RailGIS({ menu, vistaActual, onNavegar, usuario, onLogout }) {
  const iniciales = (usuario || 'JU')
    .replace(/[^a-zA-Z ]/g, ' ').trim().split(/\s+/)
    .slice(0, 2).map(p => p[0]).join('').toUpperCase() || 'JU';

  return (
    <nav className="gis-rail">
      <img className="gis-rail-logo" src={iconoJURP} alt="JURP" />
      {(menu || []).map(m => (
        <button
          key={m.clave}
          className={`gis-rail-btn ${vistaActual === m.clave ? 'activo' : ''}`}
          onClick={() => onNavegar && onNavegar(m.clave)}
        >
          {m.icono}
          <span className="gis-tip">{m.titulo}</span>
        </button>
      ))}
      <span className="gis-rail-sep" />
      <button className="gis-rail-btn" onClick={onLogout} title="Cerrar sesión">
        <FaSignOutAlt />
        <span className="gis-tip">Cerrar sesión</span>
      </button>
      <span className="gis-avatar" title={usuario}>{iniciales}</span>
    </nav>
  );
}
