/* Trabajador de servicio de la app de INVENTARIO.
 *
 * Hace dos cosas y ninguna más, a propósito:
 *
 *   1. Que el navegador ofrezca «Instalar». Android no pone el icono en el
 *      escritorio si no hay un trabajador registrado, por mucho manifiesto
 *      que haya.
 *   2. Que la segunda apertura no vuelva a bajar el bundle. Son varios
 *      megas entre Leaflet, jsPDF y ExcelJS, y en campo eso es medio minuto
 *      mirando una pantalla blanca.
 *
 * LO QUE NO HACE: trabajar sin señal. Evaluar una estructura necesita el
 * catálogo de campos, la campaña y el POST de la evaluación, y todo eso es
 * el servidor. Guardar las evaluaciones en el teléfono y subirlas luego es
 * un trabajo aparte —cola de pendientes, conflictos, teselas del mapa
 * guardadas— y fingirlo con un caché a medias sería peor que no tenerlo:
 * el inspector creería que guardó.
 *
 * LA REGLA DEL CACHÉ, en una línea: se guarda lo que lleva hash en el
 * nombre y nada más.
 *
 * Vite nombra cada archivo con el hash de su contenido —index-DSmHLRZy.js—,
 * así que ese archivo NUNCA cambia: servirlo del caché no puede dar nada
 * viejo. El HTML sí cambia sin cambiar de nombre, así que va siempre a la
 * red y solo cae al caché si no hay señal. A las APIs no se las toca.
 */

const CACHE = 'inventario-v1';

self.addEventListener('install', (e) => {
  // Sin esperar: el trabajador nuevo manda desde el primer momento. Si no,
  // un despliegue tarda dos aperturas en verse y eso ya costó una tarde.
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const nombres = await caches.keys();
    await Promise.all(nombres.filter(n => n !== CACHE).map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Las APIs, nunca. Una evaluación o un avance de campaña servidos de un
  // caché son datos falsos con cara de datos buenos.
  if (/^\/(api|vigapi|innovapi)\//.test(url.pathname)) return;

  // El HTML: red primero, caché solo como red de emergencia. Así un
  // despliegue se ve en la siguiente apertura, no en la de después.
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const res = await fetch(req);
        const c = await caches.open(CACHE);
        c.put(req, res.clone());
        return res;
      } catch (err) {
        return (await caches.match(req)) || (await caches.match('/inventario/'))
          || Response.error();
      }
    })());
    return;
  }

  // Los archivos con hash: caché primero, porque no pueden cambiar.
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/inventario/')) {
    e.respondWith((async () => {
      const guardado = await caches.match(req);
      if (guardado) return guardado;
      const res = await fetch(req);
      if (res.ok) (await caches.open(CACHE)).put(req, res.clone());
      return res;
    })());
  }
});
