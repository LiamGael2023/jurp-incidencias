/* Los sectores pintados de verdad sobre un mapa.
 *
 * Seis sectores que se tocan entre si, como los del valle: lo que se mira es
 * que dos vecinos nunca compartan color y que cada uno lleve su nombre.
 */
import { MapContainer, GeoJSON, TileLayer } from 'react-leaflet';
import { createRoot } from 'react-dom/client';
import 'leaflet/dist/leaflet.css';
import { coloresDeCapa, nombreRasgo } from '../../src/sectores';
import '../../src/InventarioGIS.css';

const NOMBRES = ['Moche', 'Virú Alto', 'Virú Bajo', 'Chao Norte', 'Chao Sur', 'Tomaval'];
const FC = { type: 'FeatureCollection', features: NOMBRES.map((nombre, i) => {
  const x = -78.85 + (i % 3) * 0.12, y = -8.55 + Math.floor(i / 3) * 0.12;
  return { type: 'Feature', properties: { nombre, ambito: 'PECH' },
    geometry: { type: 'Polygon', coordinates: [[
      [x, y], [x + 0.12, y], [x + 0.12, y + 0.12], [x, y + 0.12], [x, y]]] } };
}) };

const colores = coloresDeCapa(FC);
window.__COLORES = NOMBRES.map((n, i) => colores.get(FC.features[i]));
window.__NOMBRES = NOMBRES;

const MIN_PX_SECTOR = 70;

function Banco() {
  const z = Number(new URLSearchParams(location.search).get('z') || 11);
  return (
    <MapContainer center={[-8.49, -78.79]} zoom={z} style={{ height: '100%' }}>
      <TileLayer url="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGMI87MDAAHgAOP0T1/AAAAAAElFTkSuQmCC" />
      <GeoJSON
        data={FC}
        style={(f) => ({
          color: colores.get(f), weight: 2, opacity: .95,
          fillColor: colores.get(f), fillOpacity: .20,
        })}
        onEachFeature={(f, layer) => {
          layer.bindTooltip(nombreRasgo(f.properties), {
            permanent: true, direction: 'center',
            className: 'inv-eti-sector', opacity: 1,
          });
          const ajustar = () => {
            const tt = layer.getTooltip(), b = layer.getBounds?.();
            const m = layer._map;
            if (!tt || !b || !m) return;
            const a = m.latLngToContainerPoint(b.getNorthWest());
            const c = m.latLngToContainerPoint(b.getSouthEast());
            const lado = Math.min(Math.abs(c.x - a.x), Math.abs(c.y - a.y));
            tt.setOpacity(lado >= MIN_PX_SECTOR ? 1 : 0);
            window.__ROTULOS_VISIBLES = document.querySelectorAll(
              '.inv-eti-sector').length
              ? [...document.querySelectorAll('.inv-eti-sector')]
                  .filter(e => Number(getComputedStyle(e).opacity) > .5).length
              : 0;
            window.__ZOOM = m.getZoom();
          };
          layer.on('add', () => { ajustar(); layer._map.on('zoomend', ajustar); });
        }} />
    </MapContainer>
  );
}
createRoot(document.getElementById('app')).render(<Banco />);
