/* La Lámina temática montada de verdad, no una copia de su JSX.
 *
 * Lo que se comprueba aquí no se puede comprobar leyendo el fichero: que el
 * membrete queda sin el bloque de texto, que el selector de escala sale
 * agrupado y que elegir 1:200 no rompe nada. El inventario y las teselas van
 * cortados —desde aquí no hay red— y la pantalla tiene que aguantarlo: una
 * lámina vacía sigue siendo una lámina.
 */
import { createRoot } from 'react-dom/client';
import MapaTematico from '../../src/MapaTematico';
import '../../src/MapaTematico.css';
import 'leaflet/dist/leaflet.css';

// Ni API ni teselas. El inventario responde vacío en vez de fallar, para que
// lo que se vea sea la pantalla y no su pantalla de error.
window.fetch = async (u) => new Response(
  JSON.stringify(String(u).includes('campanias') ? [] : { type: 'FeatureCollection', features: [] }),
  { status: 200, headers: { 'Content-Type': 'application/json' } });

createRoot(document.getElementById('app')).render(<MapaTematico />);
