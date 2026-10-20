/**
 * LOS UMBRALES DE ALERTA POR LLUVIA, Y SUS COLORES. UN SOLO SITIO.
 *
 * Estaban escritos tres veces —`UMBRALES_LLUVIA` en Mapa.jsx, `NIVELES` en
 * lluvia3D.js y una tabla en el comando de push del servidor— con un
 * comentario en cada copia diciendo «los mismos que…». Un comentario no
 * mantiene nada sincronizado: el día que alguien baje el umbral amarillo en
 * el mapa 2D, el 3D seguiría pintando con el viejo y nadie se enteraría,
 * porque las dos pantallas no se miran a la vez.
 *
 * LOS COLORES NO SE ELIGEN. Son el código estándar de alerta meteorológica
 * (amarilla / naranja / roja) que el operario ya sabe leer. No se cambian por
 * los de marca.
 *
 * Naranja y roja quedan a ΔE 12.5 en visión normal —por debajo del piso de 15
 * recomendado—, o sea que cuestan de distinguir incluso con buena vista. Lo
 * que de verdad las separa es el número escrito al lado, así que ninguna
 * pantalla debe apoyarse solo en el color para decir el nivel.
 *
 * LA UNIDAD ES mm POR CUARTO DE HORA, que es el ritmo al que reportan las
 * Davis. Parecen cifras pequeñísimas hasta que uno recuerda dónde están estas
 * estaciones: en Virú y Chao, 3 mm en un día ya es un evento.
 *
 * Para comparar contra datos horarios —el pronóstico de Open-Meteo lo es—
 * está `porHora()`. Convertir el umbral y no el dato es lo correcto: el dato
 * medido no se toca.
 */

/** Minutos del intervalo en el que están expresados los umbrales. */
export const MIN_UMBRAL = 15;

export const NIVELES_LLUVIA = [
  { desde: 0.21, nivel: 'ama', nombre: 'Amarilla', color: '#FFF200', texto: '#0b2545' },
  { desde: 0.63, nivel: 'nar', nombre: 'Naranja',  color: '#F37021', texto: '#0b2545' },
  { desde: 1.06, nivel: 'roj', nombre: 'Roja',     color: '#ED1C24', texto: '#ffffff' },
];

/** Nivel que corresponde a una intensidad en mm/15 min, o null si no llega. */
export const nivelDe = (mm) =>
  NIVELES_LLUVIA.filter(n => mm >= n.desde).pop() || null;

/**
 * El mismo umbral expresado por hora. 0.21 mm/15 min → 0.84 mm/h.
 *
 * Es una equivalencia, no una igualdad: la lluvia real cae a ráfagas y un
 * modelo horario da el total repartido. Por eso lo que se pinta con datos
 * horarios siempre lleva escrito «previsto» y su unidad.
 */
export const porHora = (mm) => mm * 60 / MIN_UMBRAL;

/** Etiqueta del umbral en la unidad que toque. `minSlot` en minutos. */
export const umbralEn = (nivel, minSlot) =>
  minSlot === 60 ? porHora(nivel.desde) : nivel.desde;

/** Unidad corta, para etiquetas donde «mm/15 min» no cabe. */
export const unidadCorta = (minSlot) => (minSlot === 60 ? 'mm/h' : 'mm/15′');
