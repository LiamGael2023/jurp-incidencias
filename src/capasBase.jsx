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
import { TileLayer, WMSTileLayer, useMap, useMapEvents } from 'react-leaflet';

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

  // SIN FONDO. No es una capa: es la ausencia de ella.
  //
  // Hace falta para mirar lo que va ENCIMA sin nada que compita: comprobar
  // hasta dónde llega de verdad una ortofoto, ver si el trazado de un canal
  // cuadra con el inventario, o revisar un KMZ recién cargado. Con el
  // satélite debajo, un hueco en la capa de arriba no se distingue de un
  // trozo donde la capa simplemente coincide con la foto.
  //
  // `vacia` es lo que mira TeselasBase para no montar nada. El minimapa, en
  // cambio, sigue con la capa por defecto: es un widget para saber dónde
  // estás, y en negro no sirve de nada.
  ninguna: {
    etiqueta: 'Sin mapa base',
    grupo: 'Ninguno',
    url: null,
    credito: '',
    maxZoom: 22,
    maxNativeZoom: 22,
    exportable: true,   // no hay teselas ajenas que contaminen el lienzo
    vacia: true,
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
  // Sin la vacía: ofrecer «quítate el mapa de fondo» como arreglo para poder
  // exportar sería resolver el problema borrando la foto.
  const candidatas = Object.keys(CAPAS_BASE)
    .filter((x) => !CAPAS_BASE[x].vacia && puedeExportar(x));
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
  // «Sin mapa base» no tiene teselas; quien la pida para un <TileLayer> se
  // queda con la de por defecto. Montar una capa con url null deja el mapa
  // lanzando peticiones a «null» hasta que alguien mira la consola.
  const c0 = claveCapa(k);
  const c = CAPAS_BASE[c0].vacia ? CAPA_POR_DEFECTO : c0;
  const cap = CAPAS_BASE[c];
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

  // Los hooks van antes: «sin mapa base» no monta nada, pero React exige
  // que el número de hooks no cambie entre renders.
  const vacia = !!CAPAS_BASE[c].vacia;

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

  if (vacia) return null;

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

// ═══════════════════════════════════════════════════════════════════════════
//  LA ORTOFOTO DEL VUELO (GeoServer)
//
//  No es una capa base: va ENCIMA de la que esté puesta. Son los vuelos de
//  dron de los laterales, a 6 cm por píxel, servidos como un solo WMS desde
//  el GeoServer del Linode (ver deploy/geoserver/LEEME.md).
//
//  ARRANCA APAGADA, siempre. Son gigas de teselas: encenderla sin quererlo
//  en el teléfono de un recorredor, con la cobertura que hay en el canal, es
//  gastarle los datos y dejarle el mapa colgado. Se enciende cuando se
//  necesita y se apaga sola al recargar.
//
//  EL FORMATO TIENE QUE TENER CANAL ALFA. El vuelo es una franja estrecha
//  dentro de un rectángulo enorme; fuera de ella no hay imagen, y GeoServer la
//  recorta con la huella de cada vuelo. Pidiendo image/jpeg ese vacío vuelve
//  como blanco y tapa el satélite alrededor del canal.
//
//  Lo elegante sería image/vnd.jpeg-png, que decide por tesela —JPEG donde es
//  toda imagen, PNG donde hay transparencia— y dejaría el interior pesando
//  como JPEG. En este GeoServer ESE FORMATO SE CUELGA: la petición no vuelve
//  nunca. Y como Leaflet no avisa de una tesela que no responde, el síntoma
//  es un mapa que no pinta nada, sin un solo error en la consola. Una hora
//  buscándolo en la memoria de la JVM y en la huella, que no eran.
//
//  Así que PNG, que son unos 120 KB por tesela en vez de 25. Se nota con poca
//  señal; la solución de fondo es servirlas por GWC cacheadas, no cambiar el
//  formato.
//
//  La URL es ABSOLUTA aunque el front y GeoServer vivan en el mismo host.
//  Así la capa también funciona desde Vercel y desde `npm run dev` sin añadir
//  un proxy en dos sitios. No hace falta CORS: son <img>, y Leaflet no pide
//  crossOrigin salvo que se le diga. El precio es que, con la ortofoto
//  encendida, la captura del mapa queda inhabilitada igual que con las capas
//  de Google —mismo motivo, el lienzo se marca como contaminado—.
//
//  maxNativeZoom 21: el ráster está a 6,1 cm/px, que es justo lo que mide un
//  píxel de zoom 21 a esta latitud. Más allá, Leaflet amplía la última tesela
//  buena en vez de pedirle a GeoServer que invente detalle que no existe.
// ═══════════════════════════════════════════════════════════════════════════

const SERVIDOR_GEO = (import.meta.env?.VITE_GEOSERVER
  || 'https://nexhydro.jriegopresurizado.org.pe/geoserver').replace(/\/+$/, '');

export const ORTOFOTO = {
  etiqueta: 'Ortofoto del vuelo',
  url: `${SERVIDOR_GEO}/jurp/wms`,
  capa: 'jurp:ortofotos',
  maxZoom: 22,
  maxNativeZoom: 21,

  // HASTA DÓNDE LLEGA LA IMAGEN. Sin esto, Leaflet pide teselas de TODA la
  // pantalla, estén o no dentro del vuelo: a zoom regional son sesenta
  // peticiones de las que cincuenta y ocho caen sobre mar y cerro. GeoServer
  // las encola —control-flow deja seis por usuario— y las que sí tienen
  // imagen esperan detrás. El síntoma es una lista de peticiones en
  // «pending» durante medio minuto y un mapa que nunca pinta.
  //
  // Con los límites puestos, Leaflet descarta esas teselas sin pedirlas.
  //
  // Salen del propio GeoServer, del latLonBoundingBox de la capa:
  //   curl -u admin:*** .../rest/workspaces/jurp/coveragestores/ortofotos\
  //        /coverages/ortofotos.json
  // Al añadir un lateral nuevo el mosaico crece, así que hay que volver a
  // leerlo y actualizar estos cuatro números — si no, el lateral nuevo se
  // publica bien y aun así no se ve.
  limites: [[-8.4178, -78.9070], [-8.3314, -78.7148]],

  // NO PEDIRLA POR DEBAJO DE ESTE ZOOM. Dos motivos, y el segundo es el
  // grave.
  //
  // El cosmético: la franja volada mide unos 150 m de ancho. A zoom 9 una
  // tesela cubre 39 km, así que la ortofoto entera ocuparía menos de un
  // píxel. No se ve nada y se gasta banda.
  //
  // El serio: a esa escala GeoServer tiene que rasterizar la huella ENTERA
  // —miles de vértices— dentro de una imagen de 256 píxeles. Medido: la
  // tesela de 1 km vuelve en 0,17 s y la de 39 km no vuelve en 60 s. Y como
  // el navegador lanza varias a la vez, llenan la cola de control-flow y
  // tumban también a las buenas. De ahí la lista de peticiones en «pending»
  // y el mapa que no pintaba nunca.
  //
  // Desde 13, una tesela cubre 5 km y la franja ya son ocho píxeles: se ve
  // dónde está, y al acercarse aparece el detalle.
  //
  // El corte lo aplica el componente mirando el zoom del mapa, NO la opción
  // `minZoom` de la capa: esa le impone su mínimo al mapa entero y, sin
  // capa base debajo, deja el mapa sin poder alejarse. Explicado abajo.
  minZoom: 13,
};

/**
 * La ortofoto, encima de la capa base. Devuelve null si está apagada o si
 * el mapa está más lejos de lo que tiene sentido pedirla.
 *
 * EL CORTE POR ZOOM SE HACE AQUÍ, NO CON LA OPCIÓN `minZoom` DE LA CAPA.
 * Leaflet calcula el zoom mínimo del MAPA como el mayor de los mínimos de
 * sus capas de teselas. Con el satélite debajo —que llega al 0— da igual,
 * pero quitando el mapa base la ortofoto se queda sola y el mapa entero
 * deja de poder alejarse del 13: te acercas a mirar un detalle y ya no
 * puedes volver. Decidiéndolo nosotros, la capa no impone nada.
 */
export function Ortofoto({ activa, opacidad = 1 }) {
  const mapa = useMap();
  const [zoom, setZoom] = useState(() => mapa.getZoom());
  useMapEvents({ zoomend: () => setZoom(mapa.getZoom()) });

  if (!activa || zoom < ORTOFOTO.minZoom) return null;

  return (
    <WMSTileLayer
      url={ORTOFOTO.url}
      layers={ORTOFOTO.capa}
      format="image/png"
      transparent
      opacity={opacidad}
      maxZoom={ORTOFOTO.maxZoom}
      maxNativeZoom={ORTOFOTO.maxNativeZoom}
      bounds={ORTOFOTO.limites}
      // Pedir solo cuando el mapa se queda quieto. Arrastrando, cada paso
      // lanzaría teselas que se cancelan al siguiente: con una capa cara eso
      // es llenar la cola de trabajo que ya no le sirve a nadie.
      updateWhenIdle
      // Por encima de la capa base, que va con el 1 de por defecto, y por
      // debajo de los vectores, que viven en otro panel de Leaflet.
      zIndex={2}
      attribution="Ortofoto JURP"
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
