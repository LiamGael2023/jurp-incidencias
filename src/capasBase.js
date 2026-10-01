// ═══════════════════════════════════════════════════════════════════════════
//  capasBase.js — las capas base de los visores, en un solo sitio.
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
//  marcadas con `exportable` sí permiten la captura; el botón de la cámara
//  ofrece cambiarse a una de ellas cuando hace falta.
// ═══════════════════════════════════════════════════════════════════════════

export const CAPAS_BASE = {
  satelite: {
    etiqueta: 'Satélite',
    url: 'https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
    credito: 'Imágenes © Google',
    maxZoom: 20,
    exportable: false,
  },
  calles: {
    etiqueta: 'Calles',
    url: 'https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}',
    credito: '© Google',
    maxZoom: 20,
    exportable: false,
  },
  satelite_esri: {
    etiqueta: 'Satélite (exportable)',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    credito: 'Esri, Maxar, Earthstar Geographics',
    maxZoom: 19,
    exportable: true,
  },
  topografico: {
    etiqueta: 'Topográfico',
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    credito: '© OpenStreetMap, SRTM · OpenTopoMap (CC-BY-SA)',
    // OpenTopoMap no publica teselas por encima del 17. Antes se pedían hasta
    // el 20 y por encima de ese zoom el mapa salía en blanco.
    maxZoom: 17,
    exportable: true,
  },
  oscuro: {
    etiqueta: 'Oscuro',
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    credito: '© OpenStreetMap, © CARTO',
    maxZoom: 20,
    exportable: true,
  },
};

export const CAPA_POR_DEFECTO = 'satelite';

/** La capa pedida, o la de por defecto si el nombre no existe. */
export const capaBase = (clave) => CAPAS_BASE[clave] || CAPAS_BASE[CAPA_POR_DEFECTO];

/** ¿Se puede exportar el mapa con esta capa? */
export const esExportable = (clave) => !!capaBase(clave).exportable;

/** La primera capa exportable del mismo tipo, para ofrecerla al capturar. */
export const alternativaExportable = (clave) => {
  if (esExportable(clave)) return clave;
  const esSatelite = /sat/i.test(clave);
  const candidatas = Object.entries(CAPAS_BASE).filter(([, c]) => c.exportable);
  const igual = candidatas.find(([k]) => /sat/i.test(k) === esSatelite);
  return (igual || candidatas[0])?.[0] || clave;
};

/**
 * Props para <TileLayer>.
 *
 * crossOrigin solo en las capas que lo admiten: pedirlo a un servidor que no
 * envía la cabecera hace que el navegador descarte la tesela, y el mapa se
 * queda en blanco. Es justo lo que no se puede hacer con las de Google.
 */
export const propsTeselas = (clave) => {
  const c = capaBase(clave);
  return {
    url: c.url,
    attribution: c.credito,
    maxZoom: c.maxZoom,
    ...(c.exportable ? { crossOrigin: 'anonymous' } : {}),
  };
};

/** Las opciones del selector, en el orden en que se muestran. */
export const OPCIONES_BASE = Object.entries(CAPAS_BASE)
  .map(([clave, c]) => ({ clave, etiqueta: c.etiqueta }));
