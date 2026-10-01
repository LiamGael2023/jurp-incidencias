// ═══════════════════════════════════════════════════════════════════════════
//  capasBase.js — las capas base de los visores, en un solo sitio.
//
//  Estaban escritas a mano en Mapa.jsx y en MapaInventario.jsx, y por eso el
//  mismo error vivía dos veces: las dos usaban mt1.google.com, que no envía
//  cabeceras CORS, y con eso la captura del mapa no podía funcionar en ninguno
//  de los dos. Corregir una copia y no la otra era el desenlace probable.
//
//  POR QUÉ IMPORTA EL CORS. html2canvas redibuja el mapa en un lienzo. Si una
//  tesela viene de un servidor que no autoriza su lectura, el navegador marca
//  el lienzo como contaminado: se ve en pantalla pero no se puede exportar, y
//  el fallo aparece más tarde y en otro sitio, al convertirlo a PNG, como un
//  SecurityError que no menciona las teselas. De ahí que la captura fallara
//  siempre con satélite y el mensaje no dijera nada útil.
//
//  Y DE PASO, LA LICENCIA. mt1.google.com es un endpoint interno de Google
//  Maps: usarlo directamente está fuera de sus condiciones de uso. Los de aquí
//  se publican para este uso, y cada uno exige su atribución — que no es
//  adorno, es la condición, y por eso viaja también dentro de la captura.
// ═══════════════════════════════════════════════════════════════════════════

export const CAPAS_BASE = {
  satelite: {
    etiqueta: 'Satélite',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    credito: 'Esri, Maxar, Earthstar Geographics',
    maxZoom: 19,
  },
  calles: {
    etiqueta: 'Calles',
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    credito: '&copy; OpenStreetMap, &copy; CARTO',
    maxZoom: 20,
  },
  topografico: {
    etiqueta: 'Topográfico',
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    credito: '&copy; OpenStreetMap, SRTM · OpenTopoMap (CC-BY-SA)',
    maxZoom: 17,
  },
  oscuro: {
    etiqueta: 'Oscuro',
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    credito: '&copy; OpenStreetMap, &copy; CARTO',
    maxZoom: 20,
  },
};

export const CAPA_POR_DEFECTO = 'satelite';

/** La capa pedida, o la de por defecto si el nombre no existe. */
export const capaBase = (clave) => CAPAS_BASE[clave] || CAPAS_BASE[CAPA_POR_DEFECTO];

/**
 * Props para <TileLayer>, con todo lo que la captura necesita.
 *
 * crossOrigin va siempre: sin él el navegador guarda la tesela sin permiso de
 * lectura y el lienzo se contamina aunque el servidor sí lo autorice.
 */
export const propsTeselas = (clave) => {
  const c = capaBase(clave);
  return {
    url: c.url,
    attribution: c.credito,
    maxZoom: c.maxZoom,
    crossOrigin: 'anonymous',
  };
};

/** Las opciones del selector, en el orden en que se muestran. */
export const OPCIONES_BASE = Object.entries(CAPAS_BASE)
  .map(([clave, c]) => ({ clave, etiqueta: c.etiqueta }));
