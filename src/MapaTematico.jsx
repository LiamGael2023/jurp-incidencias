import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { MapContainer, Rectangle, useMap, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import html2canvas from 'html2canvas';
import {
  FaCrosshairs, FaDownload, FaFilePdf, FaSyncAlt, FaExclamationTriangle,
  FaLayerGroup, FaChevronDown, FaChevronRight,
} from 'react-icons/fa';
import { TeselasBase, SelectorBase, capaBase, puedeExportar, alternativaExportable,
         CAPA_POR_DEFECTO } from './capasBase';
import { useInventario, CapasInventario, GRUPOS_CAPAS, TODAS_LAS_CAPAS } from './InventarioGIS';
import {
  latLngToUTM, utmTexto, zonaDe, cuadriculaUTM, barraEscala, numeroLamina,
  zoomParaEscala, escalaDeZoom, terrenoDeLamina, cabeEnLamina, distanciaMetros,
  puntoEnGeometria, cajaDe, enCaja,
} from './cartografia';
import logoJURP from './assets/logo1.png';
import './MapaTematico.css';

/**
 * Generador de láminas temáticas del inventario.
 *
 * No es un visor más: lo que se arma aquí es el documento del Anexo V, y eso
 * cambia las reglas respecto de los otros mapas.
 *
 * LA ESCALA MANDA. En los visores el zoom es libre y la escala es el
 * resultado. Aquí es al revés: la lámina es 1:10 000 y punto, así que el zoom
 * se calcula a partir de la escala y queda bloqueado. Si se pudiera acercar,
 * la lámina diría 1:10 000 y no lo sería, que es peor que no rotular nada.
 *
 * EL ENCUADRE SALE DE LOS DATOS, no de dónde quedó la vista: el canal o tramo
 * y el rango de progresivas. Así la misma lámina sale igual mañana y la del
 * tramo vecino encaja al lado.
 *
 * LA CAPA BASE ES OTRA. Los visores abren con Google porque es lo que la
 * Junta usa y lo que se sabe que carga. Esta pantalla abre con una capa
 * exportable, porque aquí la foto no es un extra: es el producto. Con Google
 * la lámina saldría sin fondo (ver capasBase.jsx).
 */

// ── Papel ──────────────────────────────────────────────────────────────────
// A1 apaisado. Se dibuja a 2 px por milímetro: suficiente para que el texto
// del membrete se lea en pantalla y para que el PDF salga limpio, sin inflar
// el lienzo hasta donde html2canvas empieza a sufrir.
const PX_MM = 2;
const PAPEL = { anchoMm: 841, altoMm: 594 };
const MARGEN_MM = 10;
const PIE_MM = 112;                       // franja inferior: leyenda, notas, membrete
const MAPA_MM = {
  ancho: PAPEL.anchoMm - MARGEN_MM * 2,                 // 821
  alto: PAPEL.altoMm - MARGEN_MM * 2 - PIE_MM,          // 462
};
const mm = (v) => v * PX_MM;

const ESCALA = 10000;

// ── Progresivas ────────────────────────────────────────────────────────────
// Vienen como "43+750.37". Es un formato de obra, no un número: hay que
// convertirlo para poder comparar, y devolverlo para poder rotularlo.
export const progAMetros = (v) => {
  const m = /^\s*(\d+)\s*\+\s*(\d+(?:[.,]\d+)?)/.exec(String(v ?? ''));
  if (!m) { const n = parseFloat(v); return Number.isFinite(n) ? n : null; }
  return parseInt(m[1], 10) * 1000 + parseFloat(m[2].replace(',', '.'));
};
export const metrosAProg = (m) => (m == null || !Number.isFinite(m)) ? ''
  : `${Math.floor(m / 1000)}+${(m % 1000).toFixed(0).padStart(3, '0')}`;

// Los nombres de los campos vienen de los shapefiles y no están normalizados
// (TRAMO, tramo, Tramo). Se busca por patrón en vez de por nombre exacto para
// no quedarse sin datos por una mayúscula.
const valorDe = (props, re) => {
  for (const [k, v] of Object.entries(props || {})) {
    if (re.test(k) && v !== null && v !== '') return v;
  }
  return null;
};
const RE_PROG = /^progresiva$/i;

/**
 * Por qué se puede agrupar, en orden de lo general a lo particular.
 *
 * No está fijo a propósito. El Anexo V habla de sector y tramo, pero lo que
 * el inventario sirve hoy es `nombre_canal` —los shapefiles originales sí
 * traían TRAMO y la capa publicada no lo expone—. Antes que pedir que cambie
 * la base para poder abrir la pantalla, se usa lo que haya: se miran los
 * datos cargados y se arma un selector por cada campo que exista de verdad.
 * El día que el backend publique `tramo`, aparece su selector sin tocar nada.
 */
const AGRUPACIONES = [
  { clave: 'sector', re: /^(sub)?_?sector$/i, etiqueta: 'Sector' },
  { clave: 'tramo', re: /^tramo$/i, etiqueta: 'Tramo' },
  { clave: 'canal', re: /^nombre_canal$/i, etiqueta: 'Canal' },
];

// El sector no es un atributo de los activos: es una capa de polígonos. Para
// poder agrupar por él hay que preguntar en cuál cae cada punto.
const CAPA_SECTORES = 'sectores_pech';

/**
 * Asigna a cada punto el sector que lo contiene.
 *
 * Se prueba contra la caja envolvente antes que contra el polígono: son miles
 * de activos contra decenas de sectores y el test completo en todos los pares
 * cuesta lo suficiente como para que se note al cambiar de capa.
 */
function asignarSector(puntos, fcSectores) {
  if (!fcSectores?.features?.length) return;
  const sectores = fcSectores.features.map(f => ({
    nombre: valorDe(f.properties, /^(sector|nombre)$/i),
    geom: f.geometry,
    caja: cajaDe(f.geometry),
  })).filter(s => s.nombre && s.geom);
  if (!sectores.length) return;
  for (const p of puntos) {
    if (p.sector) continue;            // si el activo ya lo trae, manda el dato
    const c = [p.lng, p.lat];
    for (const s of sectores) {
      if (!enCaja(c, s.caja)) continue;
      if (puntoEnGeometria(c, s.geom)) { p.sector = s.nombre; break; }
    }
  }
}

/** Romanos para ordenar los tramos: "Tramo IX" va después de "Tramo V". */
const VALOR_ROMANO = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
const deRomano = (s) => {
  const t = String(s || '').toUpperCase().replace(/[^IVXLCDM]/g, '');
  if (!t) return null;
  let n = 0;
  for (let i = 0; i < t.length; i++) {
    const a = VALOR_ROMANO[t[i]], b = VALOR_ROMANO[t[i + 1]];
    n += (b && a < b) ? -a : a;
  }
  return n;
};
/**
 * Orden natural de los valores de agrupación.
 *
 * "Tramo IX" va después de "Tramo V" y "Lateral 10" después de "Lateral 9":
 * ordenar como texto pone el 10 antes del 2, que es justo lo que confunde a
 * quien busca su canal en la lista.
 */
const ordenValor = (t) => {
  const s = String(t ?? '');
  const r = /^\s*tramo\b/i.test(s) ? deRomano(s) : null;
  if (r != null) return r;
  const n = parseFloat(s.replace(/[^\d.]/g, ''));
  return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
};
const compararValores = (a, b) => {
  const d = ordenValor(a) - ordenValor(b);
  return d !== 0 ? d : String(a).localeCompare(String(b), 'es');
};

/**
 * Lee del inventario ya cargado por qué se puede agrupar y dónde cae cada
 * estructura. Trabaja sobre lo que está en memoria —no pide nada— porque el
 * inventario ya se descargó para dibujarse.
 */
function leerEstructura(inv) {
  const puntos = [];
  for (const capa of TODAS_LAS_CAPAS) {
    const fc = inv.datosDe(capa.codigo);
    if (!fc?.features?.length) continue;
    for (const f of fc.features) {
      const c = f.geometry?.coordinates;
      if (!c) continue;
      const par = Array.isArray(c[0]) ? c[0] : c;
      const [lng, lat] = par;
      if (typeof lat !== 'number' || typeof lng !== 'number') continue;
      const p = f.properties || {};
      const punto = { lat, lng, capa: capa.codigo, prog: progAMetros(valorDe(p, RE_PROG)) };
      for (const g of AGRUPACIONES) punto[g.clave] = valorDe(p, g.re);
      puntos.push(punto);
    }
  }
  asignarSector(puntos, inv.datosDe(CAPA_SECTORES));

  // Solo se ofrecen los niveles que tienen valores: un selector vacío no es
  // una opción, es una pregunta sin respuesta.
  const niveles = AGRUPACIONES
    .map(g => ({ ...g, valores: [...new Set(puntos.map(p => p[g.clave]).filter(Boolean))].sort(compararValores) }))
    .filter(g => g.valores.length);
  return { puntos, niveles };
}

/** Extremos de progresiva y envolvente de un conjunto de puntos. */
function extremos(puntos) {
  if (!puntos.length) return null;
  const progs = puntos.map(p => p.prog).filter(v => v != null);
  const lats = puntos.map(p => p.lat), lngs = puntos.map(p => p.lng);
  return {
    progMin: progs.length ? Math.min(...progs) : null,
    progMax: progs.length ? Math.max(...progs) : null,
    sur: Math.min(...lats), norte: Math.max(...lats),
    oeste: Math.min(...lngs), este: Math.max(...lngs),
    n: puntos.length,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  Dentro del mapa
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fija la vista al centro pedido y al zoom que exige la escala.
 *
 * El zoom se bloquea con min = max: cualquier gesto que lo moviera rompería
 * el 1:10 000 que la lámina declara. Mover el encuadre sí se permite, porque
 * eso no cambia la escala.
 */
function EncuadreFijo({ centro, zoom, onMover }) {
  const map = useMap();
  useEffect(() => {
    if (!centro || zoom == null) return;
    map.setMinZoom(zoom); map.setMaxZoom(zoom);
    map.setView(centro, zoom, { animate: false });
    onMover?.();
  }, [centro?.[0], centro?.[1], zoom, map]);
  useMapEvents({ moveend: () => onMover?.() });
  return null;
}

/**
 * Cuadrícula UTM sobre el mapa, con sus rótulos en los bordes.
 *
 * Va en un SVG encima del mapa y no como capa de Leaflet porque los rótulos
 * tienen que quedar pegados al marco de la lámina, que es papel, no mapa.
 *
 * Las líneas se dibujan con varios puntos, no de esquina a esquina: una línea
 * de UTM constante no es ni un meridiano ni un paralelo, y sobre Web Mercator
 * se curva. Derecha se desviaría unos milímetros en A1.
 */
function CuadriculaUTM({ version }) {
  const map = useMap();
  const [g, setG] = useState(null);

  useEffect(() => {
    if (!map) return;
    const b = map.getBounds();
    const lim = { norte: b.getNorth(), sur: b.getSouth(), este: b.getEast(), oeste: b.getWest() };
    const aPixel = (lat, lng) => {
      const p = map.latLngToContainerPoint([lat, lng]);
      return { x: p.x, y: p.y };
    };
    try { setG(cuadriculaUTM(lim, aPixel)); } catch { setG(null); }
  }, [map, version]);

  if (!g) return null;
  const tam = map.getSize();
  const linea = (pts) => pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

  return (
    <svg className="lam-grid" width={tam.x} height={tam.y}>
      {g.verticales.map(v => (
        <g key={`v${v.valor}`}>
          <polyline points={linea(v.puntos)} />
          <text x={v.x} y={13} textAnchor="middle">{v.valor}</text>
          <text x={v.x} y={tam.y - 5} textAnchor="middle">{v.valor}</text>
        </g>
      ))}
      {g.horizontales.map(h => (
        <g key={`h${h.valor}`}>
          <polyline points={linea(h.puntos)} />
          <text x={4} y={h.y - 4}>{h.valor}</text>
          <text x={tam.x - 4} y={h.y - 4} textAnchor="end">{h.valor}</text>
        </g>
      ))}
    </svg>
  );
}

/** Mapa de localización: la región con el recuadro de lo que cubre la lámina. */
function Localizacion({ limites }) {
  if (!limites) return <div className="lam-loc-vacio">—</div>;
  const centro = [(limites.norte + limites.sur) / 2, (limites.este + limites.oeste) / 2];
  return (
    <MapContainer center={centro} zoom={7} className="lam-loc-mapa"
      zoomControl={false} attributionControl={false} dragging={false}
      scrollWheelZoom={false} doubleClickZoom={false} boxZoom={false}
      keyboard={false} touchZoom={false}>
      <TeselasBase base="topo" />
      <Rectangle bounds={[[limites.sur, limites.oeste], [limites.norte, limites.este]]}
        pathOptions={{ color: '#e8590c', weight: 2, fillOpacity: 0.25 }} />
    </MapContainer>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  La pantalla
// ═══════════════════════════════════════════════════════════════════════════

const NOTAS_POR_DEFECTO = [
  'La cuadrícula está representada en el Sistema de Coordenadas UTM · DATUM WGS 84 · ZONA 17 S',
  'Las unidades de los mapas se encuentran en el Sistema Internacional, salvo otra indicación',
  'Las elevaciones están referidas a alturas ortométricas (msnm)',
].join('\n');

const PROFESIONALES_POR_DEFECTO = [
  { rol: 'Elaborado', nombre: '', cargo: 'Jefe de Estudios y Desarrollo de Proyectos' },
  { rol: 'SIG', nombre: '', cargo: 'Especialista SIG' },
  { rol: 'Revisado', nombre: '', cargo: 'Gerente' },
  { rol: 'Aprobado', nombre: '', cargo: 'Presidente' },
];

const leerGuardado = (llave, porDefecto) => {
  try {
    const v = JSON.parse(localStorage.getItem(llave) || 'null');
    return v == null ? porDefecto : v;
  } catch { return porDefecto; }
};
const guardar = (llave, v) => { try { localStorage.setItem(llave, JSON.stringify(v)); } catch {} };

function MapaTematico({ menu, vistaActual, onNavegar, usuario, onLogout, app, RailGIS }) {
  const inv = useInventario();

  // La capa base arranca en una exportable: aquí la captura es el producto.
  const [base, setBase] = useState(() => alternativaExportable(CAPA_POR_DEFECTO));

  const [filtros, setFiltros] = useState({});   // clave de nivel → valor elegido
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [centro, setCentro] = useState(null);
  const [version, setVersion] = useState(0);     // repinta la cuadrícula al mover
  const [limites, setLimites] = useState(null);
  const [ocupado, setOcupado] = useState(null);
  const [panel, setPanel] = useState(true);

  // Datos del membrete, que no cambian de una lámina a la siguiente.
  const [proyecto, setProyecto] = useState(() => leerGuardado('lamProyecto',
    'ACTUALIZACIÓN DEL INVENTARIO DE LA INFRAESTRUCTURA HIDRÁULICA DEL SECTOR HIDRÁULICO MENOR RIEGO PRESURIZADO MOCHE VIRÚ CHAO'));
  const [titulo, setTitulo] = useState('GENERAL INVENTARIO DE INFRAESTRUCTURA HIDRÁULICA');
  const [notas, setNotas] = useState(() => leerGuardado('lamNotas', NOTAS_POR_DEFECTO));
  const [profesionales, setProfesionales] = useState(() => leerGuardado('lamProfesionales', PROFESIONALES_POR_DEFECTO));
  const [fuente, setFuente] = useState(() => leerGuardado('lamFuente', 'Elaboración JURP 2025'));
  const [revision, setRevision] = useState('—');
  const [correlativo, setCorrelativo] = useState(1);
  const [subSector, setSubSector] = useState(1);

  useEffect(() => { guardar('lamProfesionales', profesionales); }, [profesionales]);
  useEffect(() => { guardar('lamNotas', notas); }, [notas]);
  useEffect(() => { guardar('lamProyecto', proyecto); }, [proyecto]);
  useEffect(() => { guardar('lamFuente', fuente); }, [fuente]);

  const laminaRef = useRef(null);
  const mapRef = useRef(null);
  const lienzoRef = useRef(null);

  /**
   * La hoja, tan grande como quepa.
   *
   * Se mide el hueco de verdad y no el ancho de la ventana: el rail y el
   * panel se llevan su parte, y de ellos el rail además cambia al plegarse.
   * Nunca pasa de 1, porque ampliar una hoja de papel por encima de su tamaño
   * solo la vuelve borrosa.
   */
  useEffect(() => {
    const caja = lienzoRef.current;
    if (!caja || typeof ResizeObserver === 'undefined') return;
    const ajustar = () => {
      const disponible = caja.clientWidth - 48;      // el aire de .lam-lienzo
      const z = Math.max(0.35, Math.min(1, disponible / mm(PAPEL.anchoMm)));
      caja.style.setProperty('--lam-zoom', z.toFixed(3));
      // Leaflet mide su contenedor en píxeles de pantalla: si cambia el zoom
      // y no se le avisa, sigue dibujando teselas para el tamaño anterior.
      mapRef.current?.invalidateSize();
    };
    ajustar();
    const ro = new ResizeObserver(ajustar);
    ro.observe(caja);
    return () => ro.disconnect();
  }, []);

  // Carga el inventario al entrar: sin él no hay sectores ni tramos que elegir.
  useEffect(() => { if (!inv.campania && !inv.iniciando) inv.recargar(); }, []);

  const estructura = useMemo(() => leerEstructura(inv), [inv.datos]);

  /**
   * Los puntos que pasan los niveles elegidos, antes de recortar por
   * progresiva.
   *
   * Los niveles no conviven en la misma capa: `tramo` solo lo traen las capas
   * de Chavimochic y `nombre_canal` solo las de JURP, así que exigir que un
   * punto cumpla los dos deja la selección vacía siempre. La regla es: un
   * punto entra si no contradice ningún nivel elegido y coincide al menos con
   * uno. Un nivel que ese punto no tiene, simplemente no opina.
   */
  const delTramo = useMemo(() => {
    const elegidos = Object.entries(filtros).filter(([, v]) => v);
    if (!elegidos.length) return estructura.puntos;
    return estructura.puntos.filter(p => {
      let coincideAlguno = false;
      for (const [k, v] of elegidos) {
        if (p[k] == null) continue;
        if (p[k] !== v) return false;
        coincideAlguno = true;
      }
      return coincideAlguno;
    });
  }, [estructura, filtros]);

  const rangoTramo = useMemo(() => extremos(delTramo), [delTramo]);

  // Al cambiar de nivel se proponen sus extremos; el usuario recorta desde ahí.
  // La firma depende de los valores elegidos, no del recálculo: si no, pisaría
  // lo que el usuario acaba de escribir en las progresivas.
  const firmaFiltros = JSON.stringify(filtros);
  useEffect(() => {
    if (!rangoTramo || rangoTramo.progMin == null) { setDesde(''); setHasta(''); return; }
    setDesde(metrosAProg(rangoTramo.progMin));
    setHasta(metrosAProg(rangoTramo.progMax));
  }, [firmaFiltros]);

  const seleccion = useMemo(() => {
    const a = progAMetros(desde), b = progAMetros(hasta);
    if (a == null || b == null) return delTramo;
    const lo = Math.min(a, b), hi = Math.max(a, b);
    return delTramo.filter(p => p.prog == null || (p.prog >= lo && p.prog <= hi));
  }, [delTramo, desde, hasta]);

  const envolvente = useMemo(() => extremos(seleccion), [seleccion]);

  // Cuánto mide en el terreno lo que se eligió, y si entra en la lámina.
  const medida = useMemo(() => {
    if (!envolvente) return null;
    const anchoM = distanciaMetros([envolvente.sur, envolvente.oeste], [envolvente.sur, envolvente.este]);
    const altoM = distanciaMetros([envolvente.sur, envolvente.oeste], [envolvente.norte, envolvente.oeste]);
    return { anchoM, altoM, ...cabeEnLamina({ escala: ESCALA, anchoMm: MAPA_MM.ancho, altoMm: MAPA_MM.alto, anchoMetros: anchoM, altoMetros: altoM }) };
  }, [envolvente]);

  const latCentro = envolvente ? (envolvente.norte + envolvente.sur) / 2 : -8.42;
  const zoom = useMemo(() => zoomParaEscala({
    escala: ESCALA, lat: latCentro, anchoPx: mm(MAPA_MM.ancho), anchoMm: MAPA_MM.ancho,
  }), [latCentro]);

  const encuadrar = useCallback(() => {
    if (!envolvente) return;
    setCentro([(envolvente.norte + envolvente.sur) / 2, (envolvente.este + envolvente.oeste) / 2]);
    setVersion(v => v + 1);
  }, [envolvente]);

  // Lo que la lámina rotula del encuadre real, no del pedido.
  const alMover = useCallback(() => {
    const m = mapRef.current;
    if (!m) return;
    const b = m.getBounds();
    setLimites({ norte: b.getNorth(), sur: b.getSouth(), este: b.getEast(), oeste: b.getWest() });
    setVersion(v => v + 1);
  }, []);

  const zonaLamina = limites ? zonaDe((limites.este + limites.oeste) / 2) : 17;
  const barra = barraEscala(ESCALA, 60);
  const lamina = numeroLamina({ anio: new Date().getFullYear(), subSector, correlativo });

  // Las capas encendidas, en el orden del catálogo, para la leyenda.
  const leyenda = useMemo(() => GRUPOS_CAPAS
    .map(g => ({ titulo: g.titulo, capas: g.capas.filter(c => inv.visibles[c.codigo]) }))
    .filter(g => g.capas.length), [inv.visibles]);

  // ── Exportar ────────────────────────────────────────────────────────────
  /**
   * La lámina a lienzo.
   *
   * En pantalla la hoja se reduce con `zoom` para que quepa; html2canvas no
   * entiende `zoom` —toma las medidas del texto sin reducir y las posiciones
   * reducidas— y el resultado es una lámina con todas las palabras encimadas.
   * Se quita en el clon que dibuja, no en la página: así se captura a tamaño
   * natural sin que al usuario le salte la hoja de sitio.
   */
  const generarLienzo = async () => {
    const el = laminaRef.current;
    const ancho = mm(PAPEL.anchoMm), alto = mm(PAPEL.altoMm);
    return html2canvas(el, {
      useCORS: true, allowTaint: false, backgroundColor: '#ffffff',
      scale: 2, logging: false,
      width: ancho, height: alto,
      windowWidth: ancho + 80, windowHeight: alto + 80,
      ignoreElements: (n) => n.classList?.contains('lam-no-imprimir'),
      onclone: (doc) => {
        const hoja = doc.querySelector('.lam-hoja');
        if (hoja) { hoja.style.zoom = '1'; hoja.style.boxShadow = 'none'; }
        const lienzo = doc.querySelector('.lam-lienzo');
        if (lienzo) { lienzo.style.padding = '0'; lienzo.style.overflow = 'visible'; }
      },
    });
  };

  const falloCaptura = (e) => {
    if (/SecurityError|tainted/i.test(String(e))) {
      return `La capa «${capaBase(base).etiqueta}» no autoriza la lectura de sus teselas, `
        + 'así que la lámina saldría sin mapa de fondo. Cambia a una capa exportable en el selector.';
    }
    return 'No se pudo generar la lámina: ' + (e?.message || e);
  };

  const descargarPNG = async () => {
    setOcupado('png');
    try {
      const c = await generarLienzo();
      const a = document.createElement('a');
      a.href = c.toDataURL('image/png');
      a.download = `${lamina}.png`;
      a.click();
    } catch (e) { console.error(e); alert(falloCaptura(e)); }
    finally { setOcupado(null); }
  };

  const descargarPDF = async () => {
    setOcupado('pdf');
    try {
      const c = await generarLienzo();
      const { jsPDF } = await import('jspdf');
      // A1 apaisado, en milímetros: la lámina sale al tamaño que dice ser, y
      // por tanto a la escala que dice tener. Un PDF a otro tamaño rompe el
      // 1:10 000 aunque el mapa esté perfecto.
      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [PAPEL.anchoMm, PAPEL.altoMm] });
      doc.addImage(c.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, PAPEL.anchoMm, PAPEL.altoMm);
      doc.save(`${lamina}.pdf`);
    } catch (e) { console.error(e); alert(falloCaptura(e)); }
    finally { setOcupado(null); }
  };

  const editarProf = (i, campo, v) =>
    setProfesionales(ps => ps.map((p, j) => j === i ? { ...p, [campo]: v } : p));

  const sinTramos = !inv.iniciando && estructura.niveles.length === 0 && estructura.puntos.length > 0;

  return (
    <div className="lam">
      {RailGIS && <RailGIS menu={menu} vistaActual={vistaActual} onNavegar={onNavegar}
        usuario={usuario} onLogout={onLogout} app={app} />}

      {/* ══════════════ PANEL ══════════════ */}
      <aside className={`lam-panel lam-no-imprimir ${panel ? '' : 'cerrado'}`}>
        <button className="lam-panel-tirador" onClick={() => setPanel(v => !v)}
          title={panel ? 'Ocultar el panel' : 'Mostrar el panel'}>
          {panel ? <FaChevronRight /> : <FaChevronDown />}
        </button>

        {panel && (
        <div className="lam-panel-cuerpo">
          <h2>Lámina temática</h2>
          <p className="lam-ayuda">
            Escala fija <b>1:{ESCALA.toLocaleString('es-PE')}</b>. El encuadre sale de lo que
            elijas abajo, no de dónde quede la vista, y el zoom está bloqueado para que la
            escala rotulada sea la de verdad.
          </p>

          {inv.iniciando && <div className="lam-aviso">Cargando el inventario…</div>}

          {sinTramos && (
            <div className="lam-aviso lam-aviso-ojo">
              <FaExclamationTriangle /> El inventario cargado no trae ningún campo por el que
              agrupar (<code>sector</code>, <code>tramo</code> o <code>nombre_canal</code>).
              Puedes encuadrar moviendo el mapa, pero el encuadre no será reproducible.
              <button onClick={inv.recargar}><FaSyncAlt /> Recargar</button>
            </div>
          )}

          {estructura.niveles.map(n => (
            <label key={n.clave}>{n.etiqueta}
              <select value={filtros[n.clave] || ''}
                onChange={e => setFiltros(f => ({ ...f, [n.clave]: e.target.value }))}>
                <option value="">Todos</option>
                {n.valores.map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            </label>
          ))}

          <div className="lam-par">
            <label>Desde (progresiva)
              <input value={desde} onChange={e => setDesde(e.target.value)} placeholder="43+750" />
            </label>
            <label>Hasta
              <input value={hasta} onChange={e => setHasta(e.target.value)} placeholder="50+790" />
            </label>
          </div>

          {rangoTramo?.progMin != null && (
            <div className="lam-medida">
              Va de <b>{metrosAProg(rangoTramo.progMin)}</b> a <b>{metrosAProg(rangoTramo.progMax)}</b>.
              {medida && (
                medida.cabe
                  ? <> Lo elegido mide {(medida.anchoM / 1000).toFixed(2)} km y <b>entra</b> en la lámina.</>
                  : <> Lo elegido mide {(medida.anchoM / 1000).toFixed(2)} km y en una lámina
                      entran {(medida.capAncho / 1000).toFixed(2)} km: <b>sobran {Math.round(medida.sobraAncho)} m</b>.
                      Recorta el rango o genera varias láminas.</>
              )}
              {envolvente && <div className="lam-medida-n">{envolvente.n} estructuras en el encuadre</div>}
            </div>
          )}

          <button className="lam-btn lam-btn-primario" onClick={encuadrar} disabled={!envolvente}>
            <FaCrosshairs /> Encuadrar
          </button>

          <hr />

          <label>Mapa (título de la lámina)
            <input value={titulo} onChange={e => setTitulo(e.target.value)} />
          </label>
          <label>Proyecto
            <textarea rows={3} value={proyecto} onChange={e => setProyecto(e.target.value)} />
          </label>
          <label>Notas generales (una por línea)
            <textarea rows={4} value={notas} onChange={e => setNotas(e.target.value)} />
          </label>

          <div className="lam-prof-edit">
            <div className="lam-prof-tit">Profesionales responsables</div>
            {profesionales.map((p, i) => (
              <div key={p.rol} className="lam-prof-fila">
                <span>{p.rol}</span>
                <input value={p.nombre} placeholder="Nombre y apellidos"
                  onChange={e => editarProf(i, 'nombre', e.target.value)} />
                <input value={p.cargo} placeholder="Cargo"
                  onChange={e => editarProf(i, 'cargo', e.target.value)} />
              </div>
            ))}
          </div>

          <div className="lam-par">
            <label>Sub-sector
              <input type="number" min="1" max="10" value={subSector}
                onChange={e => setSubSector(parseInt(e.target.value) || 1)} />
            </label>
            <label>N° de lámina
              <input type="number" min="1" value={correlativo}
                onChange={e => setCorrelativo(parseInt(e.target.value) || 1)} />
            </label>
          </div>
          <div className="lam-par">
            <label>Fuente
              <input value={fuente} onChange={e => setFuente(e.target.value)} />
            </label>
            <label>Revisión
              <input value={revision} onChange={e => setRevision(e.target.value)} />
            </label>
          </div>
          <div className="lam-lamina-num">Quedará como <b>{lamina}</b></div>

          <hr />

          <label>Capa base
            <SelectorBase base={base} onBase={setBase} className="lam-select" />
          </label>
          {!puedeExportar(base) && (
            <div className="lam-aviso lam-aviso-ojo">
              <FaExclamationTriangle /> Con «{capaBase(base).etiqueta}» la lámina saldrá
              sin mapa de fondo: ese servidor no autoriza la lectura de sus teselas.
            </div>
          )}

          <div className="lam-capas">
            <div className="lam-prof-tit"><FaLayerGroup /> Capas en la lámina</div>
            {GRUPOS_CAPAS.map(g => (
              <div key={g.titulo} className="lam-capas-grupo">
                <div className="lam-capas-tit">{g.titulo}</div>
                {g.capas.map(c => (
                  <label key={c.codigo} className="lam-capa">
                    <input type="checkbox" checked={!!inv.visibles[c.codigo]}
                      onChange={() => inv.alternarCapa(c.codigo)} />
                    <i style={{ background: c.color }} />{c.label}
                  </label>
                ))}
              </div>
            ))}
          </div>

          <div className="lam-acciones">
            <button className="lam-btn" onClick={descargarPNG} disabled={!!ocupado}>
              <FaDownload /> {ocupado === 'png' ? 'Generando…' : 'PNG'}
            </button>
            <button className="lam-btn lam-btn-primario" onClick={descargarPDF} disabled={!!ocupado}>
              <FaFilePdf /> {ocupado === 'pdf' ? 'Generando…' : 'PDF A1'}
            </button>
          </div>
        </div>
        )}
      </aside>

      {/* ══════════════ LÁMINA ══════════════ */}
      <div className="lam-lienzo" ref={lienzoRef}>
        <div className="lam-hoja" ref={laminaRef}
          style={{ width: mm(PAPEL.anchoMm), height: mm(PAPEL.altoMm) }}>

          {/* Mapa */}
          <div className="lam-mapa" style={{
            left: mm(MARGEN_MM), top: mm(MARGEN_MM),
            width: mm(MAPA_MM.ancho), height: mm(MAPA_MM.alto),
          }}>
            <MapContainer
              center={centro || [-8.4186, -78.7533]} zoom={zoom || 15}
              zoomSnap={0} zoomDelta={0} zoomControl={false} attributionControl={false}
              scrollWheelZoom={false} doubleClickZoom={false} touchZoom={false} boxZoom={false}
              style={{ height: '100%', width: '100%' }} ref={mapRef}>
              <TeselasBase base={base} />
              <CapasInventario inv={inv} racimo={false} />
              <EncuadreFijo centro={centro} zoom={zoom} onMover={alMover} />
              <CuadriculaUTM version={version} />
            </MapContainer>
            <div className="lam-norte">
              <svg viewBox="0 0 40 46" width="34" height="40">
                <circle cx="20" cy="23" r="17" fill="rgba(255,255,255,.75)" stroke="#111" strokeWidth="1" />
                <polygon points="20,5 25,23 20,19 15,23" fill="#111" />
                <polygon points="20,41 25,23 20,27 15,23" fill="#fff" stroke="#111" strokeWidth=".6" />
                <text x="20" y="4" fontSize="6" textAnchor="middle">N</text>
              </svg>
            </div>
          </div>

          {/* Pie */}
          <div className="lam-pie" style={{
            left: mm(MARGEN_MM), top: mm(MARGEN_MM + MAPA_MM.alto),
            width: mm(MAPA_MM.ancho), height: mm(PIE_MM),
          }}>

            <div className="lam-caja lam-leyenda">
              <div className="lam-caja-tit">LEYENDA</div>
              <div className="lam-leyenda-cols">
                {leyenda.length === 0
                  ? <div className="lam-vacio">Sin capas encendidas</div>
                  : leyenda.map(g => (
                    <div key={g.titulo} className="lam-leyenda-grupo">
                      <div className="lam-leyenda-sub">{g.titulo}</div>
                      {g.capas.map(c => (
                        <div key={c.codigo} className="lam-leyenda-it">
                          {c.ico
                            ? <img src={c.ico} alt="" />
                            : <i className={c.tipo === 'line' ? 'linea' : c.tipo === 'poly' ? 'area' : ''}
                                style={c.tipo === 'line'
                                  ? { background: 'none', borderTop: `3px ${c.dash ? 'dotted' : 'solid'} ${c.color}` }
                                  : { background: c.color }} />}
                          <span>{c.label}</span>
                        </div>
                      ))}
                    </div>
                  ))}
              </div>
            </div>

            <div className="lam-caja lam-escala">
              <div className="lam-caja-tit">ESCALA GRÁFICA</div>
              <div className="lam-escala-num">1:{ESCALA.toLocaleString('es-PE')}</div>
              {barra && (
                <>
                  <div className="lam-barra" style={{ width: mm(barra.anchoMm) }}>
                    {[0, 1, 2, 3].map(i => <span key={i} className={i % 2 ? 'claro' : 'oscuro'} />)}
                  </div>
                  <div className="lam-barra-rot" style={{ width: mm(barra.anchoMm) }}>
                    {barra.cortes.map((c, i) => <span key={i}>{c}</span>)}
                  </div>
                  <div className="lam-barra-uni">{barra.unidad}</div>
                </>
              )}
            </div>

            <div className="lam-caja lam-notas">
              <div className="lam-caja-tit">NOTAS GENERALES</div>
              <ol>
                {notas.split('\n').filter(l => l.trim()).map((l, i) => <li key={i}>{l}</li>)}
                <li>La base gráfica fue elaborada por la JURP.</li>
              </ol>
            </div>

            <div className="lam-caja lam-loc">
              <div className="lam-caja-tit">LOCALIZACIÓN</div>
              <Localizacion limites={limites} />
            </div>

            <div className="lam-caja lam-prof">
              <div className="lam-caja-tit azul">ESTUDIOS Y DESARROLLO DE PROYECTOS</div>
              <div className="lam-caja-sub">PROFESIONALES RESPONSABLES</div>
              <table>
                <tbody>
                  {profesionales.map(p => (
                    <tr key={p.rol}>
                      <th>{p.rol} :</th>
                      <td>
                        <div className="n">{p.nombre || '—'}</div>
                        <div className="c">{p.cargo}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="lam-membrete">
              <div className="lam-membrete-top">
                <img src={logoJURP} alt="JURP" className="lam-logo" />
                <div className="lam-entidad">
                  JUNTA DE USUARIOS DE AGUA<br />
                  DEL SECTOR HIDRÁULICO MENOR<br />
                  RIEGO PRESURIZADO<br />
                  MOCHE VIRÚ CHAO
                </div>
              </div>
              <div className="lam-fila"><b>PROYECTO :</b><span className="azul">{proyecto}</span></div>
              <div className="lam-fila"><b>MAPA :</b><span className="centrado">{titulo}</span></div>
              <div className="lam-datos">
                <div>
                  <div><b>DATUM</b> WGS 84</div>
                  <div><b>PROYECCIÓN</b> UTM Zona {zonaLamina} S</div>
                  <div><b>FUENTE :</b> {fuente}</div>
                </div>
                <div><b>ESCALA :</b><div className="grande">1:{ESCALA.toLocaleString('es-PE')}</div></div>
                <div>
                  <div><b>FECHA :</b> {new Date().toLocaleDateString('es-PE')}</div>
                  <div><b>REVISIÓN :</b> {revision}</div>
                </div>
                <div><b>N° LÁMINA</b><div className="grande">{lamina}</div></div>
              </div>
            </div>
          </div>
        </div>

        {/* Lo que el papel no dice y conviene ver mientras se arma. */}
        <div className="lam-estado lam-no-imprimir">
          {limites && (
            <>UTM {utmTexto(latLngToUTM((limites.norte + limites.sur) / 2, (limites.este + limites.oeste) / 2))}
              {' · '}escala real 1:{Math.round(escalaDeZoom({
                zoom: mapRef.current?.getZoom() ?? zoom, lat: latCentro,
                anchoPx: mm(MAPA_MM.ancho), anchoMm: MAPA_MM.ancho,
              }) || 0).toLocaleString('es-PE')}</>
          )}
        </div>
      </div>
    </div>
  );
}

export default MapaTematico;
