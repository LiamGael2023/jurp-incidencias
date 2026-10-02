// ═══════════════════════════════════════════════════════════════════════════
//  cartografia.js
//  Lo que una lámina necesita saber del mapa: coordenadas UTM, escala real,
//  cuadrícula y barra gráfica.
//
//  Vive aparte de los visores porque es matemática y se puede probar sin
//  navegador, que es justo lo que no se puede hacer con el resto del mapa. Y
//  porque latLngToUTM estaba copiado en Mapa.jsx y MapaInventario.jsx: dos
//  copias de una conversión de coordenadas es dos sitios donde corregir el
//  día que aparezca un error de un metro.
// ═══════════════════════════════════════════════════════════════════════════

// Parámetros del elipsoide WGS 84 y de la proyección UTM.
const A = 6378137;                 // semieje mayor (m)
const E2 = 0.00669437999014;       // excentricidad al cuadrado
const EP2 = E2 / (1 - E2);
const K0 = 0.9996;                 // factor de escala en el meridiano central

/** Zona UTM de una longitud. */
export const zonaDe = (lng) => Math.floor((lng + 180) / 6) + 1;

/**
 * Latitud y longitud → UTM (WGS 84).
 *
 * Devuelve números, no cadenas: quien quiera rotularlos los formatea, pero
 * quien quiera calcular con ellos no debería tener que volver a parsearlos.
 */
export function latLngToUTM(lat, lng, zonaForzada) {
  // La zona se puede forzar y es imprescindible al dibujar una cuadrícula:
  // Virú está sobre el límite entre la 17 y la 18, y si cada punto eligiera su
  // propia zona, el este se reiniciaría a 500000 a mitad de la lámina. Una
  // lámina se proyecta entera en una sola zona, la de su centro.
  const zona = zonaForzada || zonaDe(lng);
  const latR = lat * Math.PI / 180;
  const lngR = lng * Math.PI / 180;
  const lngO = ((zona - 1) * 6 - 180 + 3) * Math.PI / 180;

  const N = A / Math.sqrt(1 - E2 * Math.sin(latR) ** 2);
  const T = Math.tan(latR) ** 2;
  const C = EP2 * Math.cos(latR) ** 2;
  const a = Math.cos(latR) * (lngR - lngO);

  const M = A * ((1 - E2 / 4 - 3 * E2 * E2 / 64 - 5 * E2 ** 3 / 256) * latR
    - (3 * E2 / 8 + 3 * E2 * E2 / 32 + 45 * E2 ** 3 / 1024) * Math.sin(2 * latR)
    + (15 * E2 * E2 / 256 + 45 * E2 ** 3 / 1024) * Math.sin(4 * latR)
    - (35 * E2 ** 3 / 3072) * Math.sin(6 * latR));

  const este = K0 * N * (a + (1 - T + C) * a ** 3 / 6
    + (5 - 18 * T + T * T + 72 * C - 58 * EP2) * a ** 5 / 120) + 500000;

  let norte = K0 * (M + N * Math.tan(latR) * (a * a / 2
    + (5 - T + 9 * C + 4 * C * C) * a ** 4 / 24
    + (61 - 58 * T + T * T + 600 * C - 330 * EP2) * a ** 6 / 720));

  // Hemisferio sur: se desplaza el origen para no manejar negativos.
  if (lat < 0) norte += 10000000;

  return { este, norte, zona, hemisferio: lat < 0 ? 'S' : 'N' };
}

export const utmTexto = (u) =>
  `${u.zona}${u.hemisferio} E ${u.este.toFixed(0)} N ${u.norte.toFixed(0)}`;

/**
 * Inversas por bisección.
 *
 * No hay fórmula cerrada aquí porque no se implementó la proyección inversa;
 * se busca el valor que, pasado por la directa, da el que se pide. Converge en
 * una treintena de pasos al milímetro, y para dibujar una cuadrícula eso sobra.
 * La alternativa era traerse proj4 entero para dos funciones.
 */
export function lngDeEste(este, lat, lngIni, zona) {
  // La zona se fija: sin ella la búsqueda cruza el límite de zona y el este
  // vuelve a 500000, con lo que deja de ser monótono y la bisección se pierde.
  const z = zona || zonaDe(lngIni);
  let lo = lngIni - 4, hi = lngIni + 4;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (latLngToUTM(lat, mid, z).este < este) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

export function latDeNorte(norte, lng, latRef = -8, zona) {
  // La búsqueda se queda en un hemisferio. En el sur el norte lleva un falso
  // origen de 10 000 km, así que al cruzar el ecuador salta de 0 a 10 000 000:
  // sobre todo el rango la función no es monótona y la bisección da cualquier
  // cosa. latRef dice en qué hemisferio está la lámina.
  const z = zona || zonaDe(lng);
  const sur = latRef < 0;
  let lo = sur ? -85 : 0, hi = sur ? -1e-9 : 85;
  for (let i = 0; i < 70; i++) {
    const mid = (lo + hi) / 2;
    if (latLngToUTM(mid, lng, z).norte < norte) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * UTM → latitud y longitud.
 *
 * Las dos inversas de arriba no bastan por separado: el norte depende también
 * de la longitud, así que resolver la latitud fijando una longitud cualquiera
 * deja un error de más de cien metros. Se alternan hasta que dejan de moverse,
 * que son tres o cuatro vueltas.
 */
export function utmALatLng(este, norte, zona, sur = true) {
  const lngCentral = (zona - 1) * 6 - 180 + 3;
  let lat = sur ? -8 : 8, lng = lngCentral;
  for (let i = 0; i < 6; i++) {
    lat = latDeNorte(norte, lng, sur ? -1 : 1, zona);
    lng = lngDeEste(este, lat, lngCentral, zona);
  }
  return { lat, lng };
}

/** Distancia en metros entre dos [lat,lng] (haversine). */
export function distanciaMetros(a, b) {
  const R = 6371008.8;
  const dLat = (b[0] - a[0]) * Math.PI / 180;
  const dLng = (b[1] - a[1]) * Math.PI / 180;
  const l1 = a[0] * Math.PI / 180, l2 = b[0] * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(l1) * Math.cos(l2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Escala de la lámina: cuántas veces se redujo el terreno para caber en el
 * papel.
 *
 * Es el único número de la lámina que no se puede estimar a ojo ni copiar de
 * otra: depende del encuadre y del tamaño de impresión a la vez. Por eso se
 * calcula en el momento de generar, con los límites reales del mapa.
 */
export function escalaDeLamina(oesteEsteMetros, anchoPapelMm) {
  if (!(oesteEsteMetros > 0) || !(anchoPapelMm > 0)) return null;
  return oesteEsteMetros / (anchoPapelMm / 1000);
}

/**
 * El camino inverso: de una escala fija al encuadre que le toca.
 *
 * Hasta aquí la escala salía del encuadre —se miraba el mapa y se calculaba
 * en cuánto había quedado reducido—. La lámina del inventario trabaja al
 * revés: la escala es 1:10 000 y no se negocia, así que lo que hay que
 * averiguar es cuánto terreno cabe y a qué zoom hay que poner el mapa para
 * que un milímetro de papel sean diez metros exactos.
 *
 * Cuánto terreno abarca un lado del papel, en metros.
 */
export const terrenoDeLamina = (escala, ladoPapelMm) => (ladoPapelMm / 1000) * escala;

/**
 * Zoom —con decimales— al que hay que poner el mapa para que lo que se
 * dibuja en pantalla salga impreso a la escala pedida.
 *
 * Leaflet trabaja en zoom; la lámina trabaja en escala. El puente es la
 * resolución: a zoom z, en la latitud φ, cada píxel de la proyección Web
 * Mercator vale 156543.034·cos(φ)/2^z metros. Se despeja z de los metros por
 * píxel que exige la escala.
 *
 * Importa el coseno de la latitud: Web Mercator estira el terreno conforme se
 * aleja del ecuador, así que el mismo zoom NO es la misma escala en Virú que
 * en Lima. Ignorarlo es el error clásico de rotular 1:10 000 una lámina que
 * no lo es.
 *
 * Hace falta zoomSnap: 0 en el mapa; con el valor por defecto Leaflet redondea
 * al entero más cercano y la escala se va al doble o a la mitad.
 */
export function zoomParaEscala({ escala, lat, anchoPx, anchoMm, tamTesela = 256 }) {
  if (!(escala > 0) || !(anchoPx > 0) || !(anchoMm > 0)) return null;
  const metrosPorPixel = terrenoDeLamina(escala, anchoMm) / anchoPx;
  const resolucionZ0 = (2 * Math.PI * A) / tamTesela;   // 156543.034 m/px en el ecuador
  const r = resolucionZ0 * Math.cos(lat * Math.PI / 180);
  return Math.log2(r / metrosPorPixel);
}

/** La comprobación de vuelta: a qué escala quedó de verdad un mapa dibujado. */
export function escalaDeZoom({ zoom, lat, anchoPx, anchoMm, tamTesela = 256 }) {
  if (!(anchoPx > 0) || !(anchoMm > 0)) return null;
  const resolucionZ0 = (2 * Math.PI * A) / tamTesela;
  const metrosPorPixel = resolucionZ0 * Math.cos(lat * Math.PI / 180) / Math.pow(2, zoom);
  return (metrosPorPixel * anchoPx) / (anchoMm / 1000);
}

/**
 * ¿Entra este tramo en una lámina?
 *
 * Devuelve los metros que abarca el encuadre y cuánto sobra, para poder
 * decirlo antes de generar en vez de entregar una lámina recortada. El largo
 * del tramo se mide en línea recta entre sus extremos, que es lo que ocupa en
 * el papel; un canal sinuoso recorre más metros de los que ocupa.
 */
export function cabeEnLamina({ escala, anchoMm, altoMm, anchoMetros, altoMetros }) {
  const capAncho = terrenoDeLamina(escala, anchoMm);
  const capAlto = terrenoDeLamina(escala, altoMm);
  return {
    capAncho, capAlto,
    cabe: anchoMetros <= capAncho && altoMetros <= capAlto,
    sobraAncho: Math.max(0, anchoMetros - capAncho),
    sobraAlto: Math.max(0, altoMetros - capAlto),
  };
}

/** Redondea la escala a un valor de catálogo: nadie rotula 1:73.418. */
const ESCALAS = [
  500, 1000, 2000, 2500, 5000, 7500, 10000, 15000, 20000, 25000,
  50000, 75000, 100000, 150000, 200000, 250000, 500000, 1000000,
];
export const escalaRedonda = (e) =>
  e == null ? null : (ESCALAS.find(v => v >= e) || ESCALAS[ESCALAS.length - 1]);

/**
 * Paso de la cuadrícula: el intervalo redondo que deja entre 3 y 7 líneas.
 *
 * Menos de tres y no se lee como cuadrícula; más de siete y tapa el mapa.
 */
export function pasoCuadricula(extensionMetros) {
  const PASOS = [100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000, 250000];
  return PASOS.find(p => extensionMetros / p <= 7) || PASOS[PASOS.length - 1];
}

/**
 * Líneas de la cuadrícula UTM para un encuadre, con su posición en píxeles
 * dentro del área de mapa y el valor que va rotulado en el borde.
 *
 * `aPixel` traduce [lat,lng] a {x,y} dentro de la lámina — lo aporta Leaflet,
 * para que este módulo no dependa del mapa.
 */
export function cuadriculaUTM({ norte, sur, este, oeste }, aPixel) {
  const latMedia = (norte + sur) / 2;
  const lngMedia = (este + oeste) / 2;
  // Toda la lámina en la zona de su centro, aunque el encuadre pise el límite.
  const zona = zonaDe(lngMedia);

  const esqOeste = latLngToUTM(latMedia, oeste, zona);
  const esqEste = latLngToUTM(latMedia, este, zona);
  const esqSur = latLngToUTM(sur, lngMedia, zona);
  const esqNorte = latLngToUTM(norte, lngMedia, zona);

  const pasoE = pasoCuadricula(esqEste.este - esqOeste.este);
  const pasoN = pasoCuadricula(esqNorte.norte - esqSur.norte);

  // Cada línea se traza como una polilínea de varios puntos y no como un
  // segmento recto. Una línea de este UTM constante no es un meridiano ni una
  // de norte constante es un paralelo: sobre una lámina de 30 km la diferencia
  // pasa del centenar de metros, que a 1:100.000 es más de un milímetro de
  // papel — se ve, y en una cuadrícula rotulada es un error de lectura.
  const N_PUNTOS = 5;
  const entre = (a, b, i) => a + (b - a) * (i / (N_PUNTOS - 1));

  const verticales = [];
  for (let v = Math.ceil(esqOeste.este / pasoE) * pasoE; v <= esqEste.este; v += pasoE) {
    const puntos = [];
    for (let i = 0; i < N_PUNTOS; i++) {
      const lat = entre(sur, norte, i);
      puntos.push(aPixel(lat, lngDeEste(v, lat, lngMedia, zona)));
    }
    verticales.push({ valor: v, puntos, x: puntos[Math.floor(N_PUNTOS / 2)].x });
  }

  const horizontales = [];
  for (let v = Math.ceil(esqSur.norte / pasoN) * pasoN; v <= esqNorte.norte; v += pasoN) {
    const puntos = [];
    for (let i = 0; i < N_PUNTOS; i++) {
      const lng = entre(oeste, este, i);
      puntos.push(aPixel(latDeNorte(v, lng, latMedia, zona), lng));
    }
    horizontales.push({ valor: v, puntos, y: puntos[Math.floor(N_PUNTOS / 2)].y });
  }

  return { verticales, horizontales, pasoE, pasoN, zona, hemisferio: latMedia < 0 ? 'S' : 'N' };
}

/**
 * Barra de escala gráfica.
 *
 * Se elige el largo redondo en metros que más se acerca al ancho disponible
 * sin pasarse, y se parte en cuatro tramos. Los rótulos van en el corte, no
 * en el centro del tramo: así el 0 queda en el extremo izquierdo, que es
 * donde el ojo lo busca.
 */
export function barraEscala(escala, anchoBarraMm) {
  if (!escala || !(anchoBarraMm > 0)) return null;
  const metrosDisponibles = (anchoBarraMm / 1000) * escala;
  const REDONDOS = [
    10, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000,
    10000, 20000, 25000, 50000, 100000, 200000, 250000, 500000,
  ];
  // El mayor redondo que cabe; si ninguno cabe, el más pequeño.
  const total = [...REDONDOS].reverse().find(v => v <= metrosDisponibles) || REDONDOS[0];
  const km = total >= 1000;
  const unidad = km ? 'Kilómetros' : 'Metros';
  const div = km ? 1000 : 1;
  const cortes = [0, 1, 2, 3, 4].map(i => +( (total * i / 4) / div ).toFixed(2));
  return {
    total,                                   // metros que abarca la barra
    anchoMm: (total / escala) * 1000,        // lo que mide en el papel
    cortes, unidad,
  };
}

/**
 * Número de lámina, con la estructura del Anexo V:
 *   JURP-INV2025-SHMn-SSI-01
 *   └─┬─┘ └──┬──┘ └─┬┘ └┬┘ └┬┘
 *     │      │      │   │   └── correlativo dentro del sub-sector
 *     │      │      │   └────── sub-sector en romano (se omite si es general)
 *     │      │      └────────── sector hidráulico menor
 *     │      └───────────────── inventario y año de campaña
 *     └──────────────────────── entidad
 */
const ROMANOS = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
export function numeroLamina({ anio, subSector, correlativo = 1, entidad = 'JURP' }) {
  const partes = [entidad, `INV${anio}`, 'SHMn'];
  if (subSector) partes.push('SS' + (ROMANOS[subSector] || subSector));
  partes.push(String(correlativo).padStart(2, '0'));
  return partes.join('-');
}
