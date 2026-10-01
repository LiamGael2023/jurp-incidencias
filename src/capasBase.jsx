// ═══════════════════════════════════════════════════════════════════════════
//  capasBase.js — las capas base de los visores, en un solo sitio.
//
//  El juego de capas, sus nombres y los grupos del selector son los del visor
//  SGRH del PECH: seis opciones agrupadas por tipo, con control de opacidad.
//  Se copian a propósito, incluidas las claves internas ('esri', 'osm',
//  'topo'), para que una vista compartida con ?base=... valga en los dos
//  sistemas y para que quien ya usa el visor del Proyecto encuentre aquí lo
//  mismo con el mismo nombre.
//
//  Estaban escritas a mano en Mapa.jsx, MapaInventario.jsx y Mapa3D.jsx: tres
//  copias de la misma URL son tres sitios donde corregirla, y el día que se
//  corrija una y no las otras dos nadie se entera hasta que alguien compara.
//
//  SOBRE LA CAPTURA DEL MAPA. html2canvas redibuja el mapa en un lienzo. Si
//  una tesela viene de un servidor que no autoriza su lectura (sin cabecera
//  Access-Control-Allow-Origin), el navegador marca el lienzo como contaminado:
//  se ve en pantalla pero no se puede exportar, y el fallo aparece más tarde,
//  al convertirlo a PNG, como un SecurityError que no menciona las teselas.
//
//  Las de Google no la envían, así que con ellas la captura no funciona. Aun
//  así siguen siendo la capa por defecto, porque son las que la Junta viene
//  usando y las que se sabe que cargan bien desde sus equipos. Las capas
//  marcadas con `exportable` sí deberían permitir la captura; el botón de la
//  cámara ofrece cambiarse a una de ellas cuando hace falta.
//
//  «Deberían», y de ahí el párrafo siguiente: pedir CORS a un servidor que no
//  lo envía no degrada la tesela, la borra —el navegador la descarta y el mapa
//  se queda en blanco—. Ya pasó una vez en PLUVIRA por marcar como exportable
//  una capa que no se pudo comprobar. Desde aquí no hay forma de verificarlo:
//  la salida a internet de este entorno responde 403 a todos los proveedores.
//  Así que la marca `exportable` es una hipótesis y <TeselasBase> la comprueba
//  sola: si una capa a la que se le pidió CORS no logra cargar ni una tesela,
//  se vuelve a montar sin pedirlo y se recuerda. El mapa se ve siempre; lo
//  único que se pierde es la posibilidad de exportar con esa capa.
//
//  SOBRE maxNativeZoom. Es hasta dónde el proveedor tiene imagen de verdad.
//  Más allá, Leaflet amplía la última tesela buena en vez de pedir una que no
//  existe: se ve algo más blanda, pero el mapa sigue. Sin este valor, al
//  acercarse sobre el valle aparecían recuadros grises con «Map data not yet
//  available», que es lo que Google devuelve cuando no tiene imagen a ese zoom
//  en esa zona. El visor del PECH tiene este mismo defecto —fija maxZoom por
//  capa y no maxNativeZoom—, así que esa parte no se copia.
//
//  maxZoom va más alto a propósito: para ubicar un activo hace falta acercarse
//  más de lo que llega cualquier satélite, y a partir de maxNativeZoom eso ya
//  no produce recuadros grises sino imagen ampliada.
// ═══════════════════════════════════════════════════════════════════════════

import { useRef, useState, useCallback } from 'react';
import { TileLayer } from 'react-leaflet';

export const CAPAS_BASE = {
  satelite: {
    etiqueta: 'Google Satélite',
    grupo: 'Satélite',
    url: 'https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
    credito: 'Imágenes © Google',
    maxZoom: 22,
    maxNativeZoom: 20,
    exportable: false,
  },
  esri: {
    etiqueta: 'ESRI World Imagery',
    grupo: 'Satélite',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    credito: 'Esri, Maxar, Earthstar Geographics',
    maxZoom: 22,
    maxNativeZoom: 19,
    exportable: true,
  },
  calles: {
    etiqueta: 'Google Calles',
    grupo: 'Calles',
    url: 'https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}',
    credito: '© Google',
    maxZoom: 22,
    maxNativeZoom: 20,
    exportable: false,
  },
  osm: {
    etiqueta: 'OpenStreetMap',
    grupo: 'Calles',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    credito: '© OpenStreetMap',
    maxZoom: 22,
    maxNativeZoom: 19,
    exportable: true,
  },
  topo: {
    etiqueta: 'OpenTopoMap',
    grupo: 'Topográfico',
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    credito: '© OpenStreetMap, SRTM · OpenTopoMap (CC-BY-SA)',
    maxZoom: 22,
    maxNativeZoom: 17,
    exportable: true,
  },
  oscuro: {
    etiqueta: 'Carto Dark',
    grupo: 'Oscuro',
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    credito: '© OpenStreetMap, © CARTO',
    maxZoom: 22,
    maxNativeZoom: 20,
    exportable: true,
  },
};

export const CAPA_POR_DEFECTO = 'satelite';

// Nombres que usaba este proyecto antes de alinearse con el visor del PECH.
// Alguien puede tenerlos guardados en el navegador o en un enlace compartido.
const ALIAS = { satelite_esri: 'esri', topografico: 'topo' };

/** La clave canónica de una capa: resuelve alias y nombres que ya no existen. */
export const claveCapa = (k) => (CAPAS_BASE[k] ? k : (ALIAS[k] || CAPA_POR_DEFECTO));

/** La capa pedida, o la de por defecto si el nombre no existe. */
export const capaBase = (k) => CAPAS_BASE[claveCapa(k)];

// ───────────────────────────────────────────────────────────────────────────
//  Capas que se marcaron exportables pero que, en la práctica, no lo son
//  (el servidor no envía la cabecera y el navegador descarta las teselas).
//  Se recuerda para no repetir el parpadeo en blanco en cada recarga.
//
//  La nota caduca a la semana a propósito. La señal que la provoca —ninguna
//  tesela carga— también la produce un proveedor caído, y no estaría bien
//  dejar una capa marcada para siempre por un rato malo. Si el problema es de
//  verdad de CORS, se vuelve a detectar la próxima vez que se use la capa.
// ───────────────────────────────────────────────────────────────────────────
const LLAVE_DEGRADADAS = 'capasSinCors';
const CADUCIDAD_MS = 7 * 24 * 60 * 60 * 1000;

const leerDegradadas = () => {
  try {
    const bruto = JSON.parse(localStorage.getItem(LLAVE_DEGRADADAS) || '{}');
    // Hasta aquí se guardaba una lista de nombres; ahora, nombre → fecha.
    if (Array.isArray(bruto)) return Object.fromEntries(bruto.map((k) => [k, Date.now()]));
    return bruto && typeof bruto === 'object' ? bruto : {};
  } catch { return {}; }
};

const DEGRADADAS = leerDegradadas();

const degradar = (k) => {
  DEGRADADAS[k] = Date.now();
  try { localStorage.setItem(LLAVE_DEGRADADAS, JSON.stringify(DEGRADADAS)); } catch {}
};

const estaDegradada = (k) => {
  const cuando = DEGRADADAS[k];
  if (!cuando) return false;
  if (Date.now() - cuando < CADUCIDAD_MS) return true;
  delete DEGRADADAS[k];
  try { localStorage.setItem(LLAVE_DEGRADADAS, JSON.stringify(DEGRADADAS)); } catch {}
  return false;
};

/** ¿Se puede exportar el mapa con esta capa? */
export const puedeExportar = (k) => {
  const c = claveCapa(k);
  return !!CAPAS_BASE[c].exportable && !estaDegradada(c);
};

/** Nombre anterior de puedeExportar; se mantiene para no romper llamadas. */
export const esExportable = puedeExportar;

/** La primera capa exportable del mismo tipo, para ofrecerla al capturar. */
export const alternativaExportable = (k) => {
  const c = claveCapa(k);
  if (puedeExportar(c)) return c;
  const grupo = CAPAS_BASE[c].grupo;
  const candidatas = Object.keys(CAPAS_BASE).filter(puedeExportar);
  const igual = candidatas.find((x) => CAPAS_BASE[x].grupo === grupo);
  return igual || candidatas[0] || c;
};

/**
 * Props para <TileLayer>.
 *
 * crossOrigin solo en las capas que lo admiten: pedirlo a un servidor que no
 * envía la cabecera hace que el navegador descarte la tesela, y el mapa se
 * queda en blanco. Es justo lo que no se puede hacer con las de Google.
 */
export const propsTeselas = (k, opacidad, { cors = true } = {}) => {
  const c = claveCapa(k), cap = CAPAS_BASE[c];
  return {
    url: cap.url,
    attribution: cap.credito,
    maxZoom: cap.maxZoom,
    maxNativeZoom: cap.maxNativeZoom,
    ...(opacidad != null ? { opacity: opacidad } : {}),
    ...(cors && puedeExportar(c) ? { crossOrigin: 'anonymous' } : {}),
  };
};

/**
 * Props para el minimapa.
 *
 * Nunca pide CORS: el minimapa queda fuera de la captura (es un widget de
 * navegación, no contenido del mapa), así que no gana nada pidiéndolo y sí
 * arriesga quedarse en blanco si el servidor no lo envía.
 */
export const propsMinimapa = (k) => propsTeselas(k, null, { cors: false });

/**
 * La capa base del mapa, con red de seguridad.
 *
 * Es <TileLayer> más una comprobación: si a una capa se le pidió CORS y no
 * carga ni una tesela, se vuelve a montar sin pedirlo. Sin esto, una capa mal
 * marcada como exportable deja el mapa en blanco y no hay forma de notarlo
 * desde el código; con esto, lo único que se pierde es poder exportar con ella.
 *
 * La condición es «ninguna tesela cargada y varias fallidas»: un rechazo por
 * CORS tumba todas las teselas a la vez, mientras que un hueco suelto en el
 * servidor falla unas pocas y las demás entran.
 */
export function TeselasBase({ base, opacidad }) {
  const c = claveCapa(base);
  const [, repintar] = useState(0);
  const cuenta = useRef({ capa: c, exitos: 0, fallos: 0 });

  if (cuenta.current.capa !== c) cuenta.current = { capa: c, exitos: 0, fallos: 0 };

  const conCors = puedeExportar(c);

  const alFallar = useCallback(() => {
    const n = cuenta.current;
    if (n.exitos > 0 || !puedeExportar(n.capa)) return;
    if (++n.fallos < 4) return;
    degradar(n.capa);
    console.warn(
      `[capasBase] «${CAPAS_BASE[n.capa].etiqueta}» no autoriza la lectura de sus `
      + 'teselas (sin Access-Control-Allow-Origin). Se vuelve a cargar sin pedirlo; '
      + 'el mapa se verá bien, pero la captura no podrá usar esta capa.');
    repintar((x) => x + 1);
  }, []);

  const alCargar = useCallback(() => { cuenta.current.exitos += 1; }, []);

  return (
    <TileLayer
      // Remontar es la única forma de cambiar crossOrigin: Leaflet lo fija al
      // crear la capa y no lo relee después.
      key={`${c}${conCors ? '+cors' : ''}`}
      {...propsTeselas(c, opacidad)}
      eventHandlers={{ tileerror: alFallar, tileload: alCargar }}
    />
  );
}

/** Las opciones del selector, en el orden en que se muestran. */
export const OPCIONES_BASE = Object.entries(CAPAS_BASE)
  .map(([k, c]) => ({ clave: k, etiqueta: c.etiqueta, grupo: c.grupo }));

/** Las mismas, por grupo, para los <optgroup> del selector. */
export const GRUPOS_BASE = OPCIONES_BASE.reduce((acc, o) => {
  (acc[o.grupo] = acc[o.grupo] || []).push(o);
  return acc;
}, {});

/**
 * Selector de capa base con opacidad, igual que en el visor del PECH.
 *
 * Los dos controles van juntos porque se usan juntos: se baja la opacidad del
 * satélite para que se lean los activos encima, y se vuelve a subir. Lleva
 * jurp-no-capture para que no salga en la foto del mapa.
 */
export function SelectorBase({ base, onBase, opacidad = 1, onOpacidad, className = 'gis-select' }) {
  return (
    <div className="base-sel jurp-no-capture">
      <select className={className} value={claveCapa(base)}
        onChange={(e) => onBase(e.target.value)}>
        {Object.entries(GRUPOS_BASE).map(([grupo, opciones]) => (
          <optgroup key={grupo} label={grupo}>
            {opciones.map((o) => (
              <option key={o.clave} value={o.clave}>{o.etiqueta}</option>
            ))}
          </optgroup>
        ))}
      </select>
      {onOpacidad && (
        <input type="range" className="base-opacidad"
          min="20" max="100" step="5"
          value={Math.round(opacidad * 100)}
          onChange={(e) => onOpacidad(Number(e.target.value) / 100)}
          title={`Opacidad del mapa base: ${Math.round(opacidad * 100)}%`} />
      )}
    </div>
  );
}
