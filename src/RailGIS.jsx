import { useState, useEffect } from 'react';
import { FaSignOutAlt, FaBars } from 'react-icons/fa';
import logoNexhydro from './assets/nexhidra/logo-nexhydro.png';
import logoNexhydroMin from './assets/nexhidra/logo-nexhydro-min.png';
import logoHydrometrix from './assets/nexhidra/logo-hydrometrix.png';
import logoPluvira from './assets/nexhidra/logo-pluvira.png';
import logoSentria from './assets/nexhidra/logo-sentria.png';
import minHydrometrix from './assets/nexhidra/logo-hydrometrix-min.png';
import minPluvira from './assets/nexhidra/logo-pluvira-min.png';
import minSentria from './assets/nexhidra/logo-sentria-min.png';
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
// Las que aún no tienen logo se rotulan con texto (ver railx-app-texto).
const APPS = {
  pluvira:     { logo: logoPluvira,     min: minPluvira,     color: '#EE7B12', nombre: 'PLUVIRA' },
  sentria:     { logo: logoSentria,     min: minSentria,     color: '#2E9E4F', nombre: 'SENTRIA' },
  hydrometrix: { logo: logoHydrometrix, min: minHydrometrix, color: '#1268C3', nombre: 'HYDROMETRIX' },
  inventario:  { logo: null,            min: null,           color: '#0CA678', nombre: 'INVENTARIO' },
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

        {/* ── módulo activo dentro del ecosistema ──
            Si el módulo todavía no tiene logo, se rotula con su nombre en
            texto para que el rail no quede mudo. */}
        <div className="railx-app">
          <span className="railx-app-etq">Módulo</span>
          {info.logo ? (
            <>
              <img className="railx-app-logo" src={info.logo} alt={info.nombre} />
              <img className="railx-app-min" src={info.min} alt={info.nombre} title={info.nombre} />
            </>
          ) : (
            <>
              <span className="railx-app-logo" style={{
                display: 'block', fontFamily: "'Sora', system-ui, sans-serif",
                fontWeight: 800, fontSize: 21, letterSpacing: '.06em',
                color: info.color, lineHeight: 1.15,
              }}>{info.nombre}</span>
              <span className="railx-app-min" title={info.nombre} style={{
                display: 'block', fontFamily: "'Sora', system-ui, sans-serif",
                fontWeight: 800, fontSize: 13, letterSpacing: '.04em',
                color: info.color, textAlign: 'center',
              }}>INV</span>
            </>
          )}
        </div>

        {/* ── navegación ──
            Una entrada con `seccion: true` no navega: es un rótulo que separa
            bloques del menú. Al colapsar el rail se queda solo la línea, que
            es lo único que cabe. */}
        <ul className="railx-nav">
          {(menu || []).map(m => (
            m.seccion ? (
              // Cabecera de módulo dentro del menú: mismo trato visual que el
              // bloque "MÓDULO / PLUVIRA" de arriba, para que se lea como otro
              // módulo y no como un grupo más de opciones.
              <li key={m.clave} className="railx-seccion" aria-hidden="true">
                <hr className="railx-divisor railx-seccion-hr" />
                <span className="railx-seccion-etq">Módulo</span>
                <span className="railx-seccion-mod">
                  <span className="railx-seccion-ico">{m.icono}</span>
                  <span className="railx-seccion-txt">{m.titulo}</span>
                </span>
              </li>
            ) : (
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
            )
          ))}
        </ul>

        {/* Estilos del rótulo de sección: van aquí para no tocar RailGIS.css */}
        <style>{`
          .railx-seccion{ display:block; pointer-events:none; list-style:none; }
          .railx-seccion-hr{ margin:14px 0 0; }
          .railx-seccion-etq{
            display:block; padding:14px 18px 0;
            font-size:10.5px; font-weight:800; letter-spacing:.14em;
            text-transform:uppercase; color:#8aa4bd;
          }
          .railx-seccion-mod{
            display:flex; align-items:center; gap:10px;
            padding:8px 18px 4px;
          }
          .railx-seccion-ico{
            display:flex; align-items:center; justify-content:center;
            width:34px; height:34px; flex:0 0 34px; border-radius:10px;
            background:var(--sec, #0CA678); color:#fff; font-size:17px;
          }
          .railx-seccion-txt{
            font-family:'Sora', system-ui, sans-serif;
            font-size:21px; font-weight:800; letter-spacing:.01em;
            color:var(--sec, #0CA678); white-space:nowrap; line-height:1.1;
          }
          /* Colapsado: solo cabe el icono, centrado bajo la línea. */
          .railx.colapsado .railx-seccion-etq,
          .railx.colapsado .railx-seccion-txt{ display:none; }
          .railx.colapsado .railx-seccion-mod{ padding:10px 0 4px; justify-content:center; }
        `}</style>

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