/* La Lámina temática montada de verdad, no una copia de su JSX.
 *
 * Lo que se comprueba aquí no se puede comprobar leyendo el fichero: que el
 * membrete queda sin el bloque de texto, que el selector de escala sale
 * agrupado, que elegir 1:200 no rompe nada, y que buscar una estructura
 * centra la lámina SIN tocar la escala.
 *
 * El inventario va simulado y las teselas cortadas —desde aquí no hay red— y
 * la pantalla tiene que aguantarlo: una lámina vacía sigue siendo una lámina.
 */
import { createRoot } from 'react-dom/client';
import MapaTematico from '../../src/MapaTematico';
import '../../src/MapaTematico.css';
import 'leaflet/dist/leaflet.css';

/* El índice del buscador. Son pocos y a propósito distintos entre sí:
 *
 *   - dos que comparten prefijo, para ver que no se queda con el primero;
 *   - uno con tilde, porque la búsqueda tiene que ignorarlas;
 *   - uno con progresiva, que es otro de los campos por los que se busca;
 *   - y uno lejos de los demás, para comprobar que centrar de verdad mueve
 *     el encuadre y no solo rellena la caja de texto.
 */
const INDICE = [
  { tipo: 'tomas_l10', fid: 1, nombre: 'Toma 10.5', canal: 'Lateral 10',
    progresiva: '43+750', lat: -8.4186, lng: -78.7533 },
  { tipo: 'tomas_l10', fid: 2, nombre: 'Toma 10.6', canal: 'Lateral 10',
    progresiva: '44+120', lat: -8.4201, lng: -78.7510 },
  { tipo: 'canoas', fid: 7, nombre: 'Canoa Chacarrá', canal: 'Lateral 10',
    progresiva: '45+300', lat: -8.4320, lng: -78.7400 },
  { tipo: 'alcantarilla', fid: 9, nombre: 'Alcantarilla Virú Norte', canal: 'Troncal',
    progresiva: '12+000', lat: -8.3100, lng: -78.6900 },
];

// El inventario no arranca sin sesión, y el índice del buscador solo se pide
// cuando hay una campaña activa. Las dos cosas son de verdad en producción,
// así que aquí se dan en vez de esquivarlas: probar el buscador con el
// camino corto sería probar otro programa.
localStorage.setItem('userToken', 'prueba');
const CAMPANIA = { id: 1, anio: 2026, estado: 'en_proceso', nombre: 'Prueba' };

// Ni API ni teselas. Responde lo justo para que la pantalla se monte: la
// campaña, el índice de verdad y capas vacías.
window.__INDICE = INDICE;
window.fetch = async (u) => {
  const url = String(u);
  const cuerpo =
      url.includes('/capas/indice/') ? INDICE
    : url.includes('/campanias/') && url.includes('/avance/') ? { detalle: [] }
    : url.includes('/campanias/') ? [CAMPANIA]
    : url.includes('/capas/') ? []
    : url.includes('/evaluaciones/') ? []
    : url.includes('/activos-nuevos/') ? []
    : { type: 'FeatureCollection', features: [] };
  return new Response(JSON.stringify(cuerpo),
    { status: 200, headers: { 'Content-Type': 'application/json' } });
};

createRoot(document.getElementById('app')).render(<MapaTematico />);
