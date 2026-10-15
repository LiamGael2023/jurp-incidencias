/*
 * DÓNDE VIVE LA API. Un solo sitio.
 *
 * Estaba escrita a mano en doce pantallas, y mover el backend de servidor
 * significaba acertar con veintiuna cadenas repartidas por el código: la que
 * se quedara atrás no fallaba al compilar ni al desplegar, solo dejaba una
 * pantalla llamando a un servidor que ya no está.
 *
 * EL VALOR SALE DEL ENTORNO, no del código. `VITE_API_BASE` se define en
 * Vercel (Settings → Environment Variables) y el día que entre el dominio
 * definitivo se cambia ahí: un clic, sin tocar nada ni volver a desplegar a
 * mano. El valor por defecto es el que vale ahora mismo, para que un clon
 * recién bajado funcione sin configurar nada.
 *
 * Vite resuelve `import.meta.env` EN EL MOMENTO DE COMPILAR, así que la
 * variable tiene que estar puesta antes del build. Cambiarla en Vercel
 * obliga a redesplegar —el botón «Redeploy» basta—; no es como una variable
 * del servidor, que se lee en cada arranque.
 *
 * LA QUE NO PASA POR AQUÍ ES LA DE vercel.json. El proxy /vigapi/ se
 * resuelve en el borde de Vercel, antes de que exista nada de este código,
 * y su fichero de configuración no lee variables de entorno. Esa hay que
 * cambiarla a mano, y por eso está anotada en el propio vercel.json.
 */

// Sin barra al final: todo lo de abajo la pone, y dos seguidas rompen
// algunas rutas de Django.
const BASE = (import.meta.env.VITE_API_BASE || 'https://api.192.81.132.87.nip.io')
  .replace(/\/+$/, '');

/** El host, a secas. Para las imágenes y los PDF, que cuelgan de la raíz. */
export const API_BASE = BASE;

/** Lo que usa casi todo: incidencias, partes, maquinaria, proyectos. */
export const API_OPS = `${BASE}/api/v1/mobile/operations`;

/**
 * De dónde salen las fotos y los archivos subidos.
 *
 * Es el mismo host que la API, pero se exporta aparte porque son dos cosas
 * distintas: el día que las imágenes se sirvan desde un almacenamiento
 * propio o una CDN, se cambia esta línea y no veinte llamadas.
 */
export const MEDIA = BASE;
