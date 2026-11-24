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
 * y su fichero de configuración no lee variables de entorno: esa hay que
 * cambiarla a mano. Tampoco admite comentarios —Vercel lo valida contra su
 * esquema y rechaza cualquier clave que no conozca—, así que lo que hay que
 * saber de él está en DESPLIEGUE.md.
 */

// Sin barra al final: todo lo de abajo la pone, y dos seguidas rompen
// algunas rutas de Django.
const BASE = (import.meta.env?.VITE_API_BASE || 'https://api.192.81.132.87.nip.io')
  .replace(/\/+$/, '');

/** El host, a secas. Para las imágenes y los PDF, que cuelgan de la raíz. */
export const API_BASE = BASE;

/**
 * Lo que usa casi todo: incidencias, partes, maquinaria, proyectos.
 *
 * VA POR RUTA RELATIVA, NO POR HOST. Hasta el 24/11/2026 esto era
 * `${BASE}/api/v1/mobile/operations`, o sea que el navegador de cada usuario
 * tenía que resolver y alcanzar `api.192.81.132.87.nip.io` por su cuenta.
 * Unos podían y otros no: `nip.io` es un DNS comodín que bastantes redes
 * corporativas y operadores bloquean, y cuando el nombre no resuelve la
 * petición no llega ni a salir. El navegador no da código de estado, solo
 * «Failed to fetch», que es lo que veían en Proyectos y en Actividades.
 *
 * Ahora sale del MISMO ORIGEN que el front, y el salto al backend lo da el
 * servidor. Los dos despliegues ya tenían la reescritura puesta:
 *
 *   nginx (Linode)   /vigapi/(.*)  →  127.0.0.1:8005/api/v1/$1
 *   vercel.json      /vigapi/(.*)  →  https://api.192.81.132.87.nip.io/api/v1/$1
 *
 * En Vercel se sigue pasando por `nip.io`, pero desde el borde de Vercel, no
 * desde el navegador del usuario: da igual lo que bloquee su red.
 *
 * Con esto desaparecen de golpe tres puntos de fallo que no controlábamos
 * —que el DNS del usuario resuelva `nip.io`, que su firewall lo deje pasar y
 * que el certificado de ese nombre siga válido— y además el CORS, porque ya
 * no hay dos orígenes.
 *
 * Comprobado antes de cambiarlo: las dos rutas devuelven byte a byte lo
 * mismo (`/proyectos/`, 863 bytes, HTTP 200 por ambas).
 */
export const API_OPS = '/vigapi/mobile/operations';

/**
 * De dónde salen las fotos y los archivos subidos.
 *
 * Es el mismo host que la API, pero se exporta aparte porque son dos cosas
 * distintas: el día que las imágenes se sirvan desde un almacenamiento
 * propio o una CDN, se cambia esta línea y no veinte llamadas.
 */
export const MEDIA = BASE;

/**
 * El inventario, que NO cuelga de BASE.
 *
 * Va por `/vigapi/`, una reescritura de nginx hacia el backend de vigilancia
 * —`/vigapi/(.*)` → `127.0.0.1:8005/api/v1/$1`—, así que es una ruta del
 * mismo origen que el front y no un host. Estaba escrita a mano en
 * `InventarioGIS.jsx` y en `CampaniasInventario.jsx`; aquí está una sola vez
 * porque `fotosActivo.js` también la necesita para resolver las imágenes.
 */
export const API_INVENTARIO = '/vigapi/inventario';
