import { useState, useEffect } from 'react';
import { FaSignOutAlt, FaBars, FaChevronDown, FaClipboardCheck } from 'react-icons/fa';
import logoNexhydro from './assets/nexhidra/logo-nexhydro.png';
import logoNexhydroMin from './assets/nexhidra/logo-nexhydro-min.png';
import logoHydrometrix from './assets/nexhidra/logo-hydrometrix.png';
import logoPluvira from './assets/nexhidra/logo-pluvira.png';
import logoSentria from './assets/nexhidra/logo-sentria.png';
import minHydrometrix from './assets/nexhidra/logo-hydrometrix-min.png';
import minPluvira from './assets/nexhidra/logo-pluvira-min.png';
import minSentria from './assets/nexhidra/logo-sentria-min.png';
import logoInventario from './assets/nexhidra/logo-inventario.png';
import minInventario from './assets/nexhidra/logo-inventario-min.png';
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
  inventario:  { logo: logoInventario,  min: minInventario,  color: '#0CA678', nombre: 'INVENTARIO',
                 icono: <FaClipboardCheck /> },
};

export default function RailGIS({ menu, vistaActual, onNavegar, usuario, onLogout, app }) {
  const [colapsado, setColapsado] = useState(
    () => localStorage.getItem('railColapsado') === '1'
  );

  // Secciones plegadas, por clave. Se guarda para que el menú no se vuelva a
  // desplegar entero en cada navegación (cada vista monta su propio rail).
  const [seccionesCerradas, setSeccionesCerradas] = useState(() => {
    try { return JSON.parse(localStorage.getItem('railSecciones') || '{}'); }
    catch (e) { return {}; }
  });

  const alternarSeccion = (clave) => {
    setSeccionesCerradas(prev => {
      const sig = { ...prev, [clave]: !prev[clave] };
      localStorage.setItem('railSecciones', JSON.stringify(sig));
      return sig;
    });
  };

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
            Solo cuando el menú no declara secciones propias: si las declara,
            cada módulo lleva su cabecera dentro del menú y este bloque
            duplicaría la información.
            Si el módulo todavía no tiene logo, se rotula con su nombre en
            texto para que el rail no quede mudo. */}
        {!(menu || []).some(m => m.seccion) && (
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
        )}

        {/* ── navegación ──
            Una entrada con `seccion: true` no navega: es un rótulo que separa
            bloques del menú. Al colapsar el rail se queda solo la línea, que
            es lo único que cabe. */}
        <ul className="railx-nav">
          {(() => {
            // Las opciones pertenecen a la última sección declarada. Las que
            // van antes de la primera no tienen sección y siempre se ven.
            let seccionActual = null;
            return (menu || []).map(m => {
              if (m.seccion) {
                seccionActual = m.clave;
                const cerrada = !!seccionesCerradas[m.clave];
                // Los datos visuales salen de APPS: así el logo y el color de
                // cada módulo se definen en un solo sitio.
                const mod = APPS[m.modulo] || {};
                const rotulo = m.titulo || mod.nombre || '';
                return (
                  <li key={m.clave} className="railx-seccion"
                      style={{ '--sec': mod.color || '#0CA678' }}>
                    <hr className="railx-divisor railx-seccion-hr" />
                    <button type="button" className="railx-seccion-btn"
                      onClick={() => alternarSeccion(m.clave)}
                      title={cerrada ? `Mostrar ${rotulo}` : `Ocultar ${rotulo}`}
                      aria-expanded={!cerrada}>
                      <span className="railx-seccion-etq">Módulo</span>
                      <span className="railx-seccion-mod">
                        {mod.logo ? (
                          <img className="railx-seccion-logo" src={mod.logo} alt={rotulo} />
                        ) : (
                          <>
                            <span className="railx-seccion-ico">{m.icono || mod.icono}</span>
                            <span className="railx-seccion-txt">{rotulo}</span>
                          </>
                        )}
                        <span className={`railx-seccion-chev ${cerrada ? 'cerrada' : ''}`}>
                          <FaChevronDown />
                        </span>
                      </span>
                    </button>
                    {/* Colapsado: el logo no cabe, se usa la versión mínima */}
                    {mod.min && <img className="railx-seccion-min" src={mod.min} alt={rotulo} />}
                  </li>
                );
              }
              if (seccionActual && seccionesCerradas[seccionActual]) return null;
              return (
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
              );
            });
          })()}
        </ul>

        {/* Estilos del rótulo de sección: van aquí para no tocar RailGIS.css */}
        <style>{`
          .railx-seccion{ display:block; list-style:none; }
          .railx-seccion-hr{ margin:12px 0 0; }
          /* !important: .railx-nav button ya trae display:flex y padding
             propios, y sin esto el rótulo y el logo salen en la misma fila. */
          .railx-seccion-btn{
            display:block !important; width:100%;
            background:none !important; border:none; padding:0 !important;
            margin:0; text-align:left; cursor:pointer; font:inherit;
            color:inherit; border-radius:12px; transition:background .18s;
            height:auto !important;
          }
          .railx-seccion-btn:hover{ background:rgba(0,0,0,.035) !important; }
          .railx-seccion-etq{
            display:block; padding:14px 18px 0;
            font-size:10.5px; font-weight:800; letter-spacing:.14em;
            text-transform:uppercase; color:#8aa4bd;
          }
          .railx-seccion-mod{
            display:flex; align-items:center; gap:10px;
            padding:6px 18px 10px;
          }
          /* Por ALTURA, no por ancho: los lockups tienen proporciones
             distintas (PLUVIRA es más compacto, INVENTARIO más alargado) y
             fijando el ancho uno acababa más alto que el otro. */
          .railx-seccion-logo{
            height:30px; width:auto; max-width:100%; object-fit:contain; display:block;
          }
          .railx-seccion-min{ display:none; }
          .railx-seccion-chev{
            margin-left:auto; display:flex; font-size:12px; color:#8aa4bd;
            transition:transform .22s;
          }
          .railx-seccion-chev.cerrada{ transform:rotate(-90deg); }
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
          /* Colapsado: solo el icono o el logotipo mínimo, centrados. */
          .railx.colapsado .railx-seccion-etq,
          .railx.colapsado .railx-seccion-txt,
          .railx.colapsado .railx-seccion-chev,
          .railx.colapsado .railx-seccion-logo{ display:none; }
          .railx.colapsado .railx-seccion-mod{ padding:10px 0 8px; justify-content:center; }
          .railx.colapsado .railx-seccion-min{
            display:block; width:30px; height:auto; margin:0 auto 8px;
          }
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