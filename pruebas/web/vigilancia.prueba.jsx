/* El módulo de Vigilancia dentro del armazón del rail.
 *
 * POR QUE EXISTE. Esta pantalla vivía en la barra lateral clásica y se
 * movió al rail de NEXHYDRO para que SENTRIA tuviera un solo menú. El rail
 * no empuja el contenido: flota encima. Cada bloque se aparta solo, con
 * `--rail-w`, y la hoja de estilos ya lo hace para `.maq .tbl-page-body`
 * —pero el cuerpo de esta pantalla llevaba `padding: 0` en línea, que gana
 * sobre la hoja, así que las pestañas y las tarjetas quedaron debajo del
 * menú: ni se leían ni se podían pulsar.
 *
 * Se mide el padding de verdad en el navegador. Leer el JSX no habría visto
 * nada: el fallo nace de qué regla gana, no de qué pone cada una.
 */
import { createRoot } from 'react-dom/client';
import Vigilancia from '../../src/Vigilancia';
import '../../src/MaquinariaGIS.css';   // define .maq y el hueco del rail

localStorage.setItem('userToken', 'token-de-prueba');

const json = (d) => new Response(JSON.stringify(d),
  { status: 200, headers: { 'Content-Type': 'application/json' } });

const INCIDENTES = [
  { id: 1, tipo: 'Persona indocumentada', titulo: 'Reporte: Persona indocumentada',
    descripcion: 'Salió una persona del fundo San Camilo', reportado_por: 'v_calderonr',
    fecha: '2026-10-25T20:42:00Z', evidencias: [] },
  { id: 2, tipo: 'Incidente', titulo: 'Reporte: Incidente',
    descripcion: 'Moto no cuenta con placas', reportado_por: 'v_calderonr',
    fecha: '2026-09-10T12:50:00Z', evidencias: [] },
  /* El que la tabla NO puede enseñar entero: descripción larga, cinco
   * fotos -la tabla corta en tres- y coordenadas. Es el caso para el que
   * existe el detalle. */
  { id: 3, tipo: 'Incidente General', titulo: 'Reporte: Incidente General',
    descripcion: 'Siendo las 02:40 horas se detecta el ingreso de dos personas '
      + 'por el sector sur, se procede a dar aviso al supervisor de turno y se '
      + 'realiza el recorrido perimétrico correspondiente sin novedad posterior.',
    reportado_por_nombre: 'v_montoya', fecha_reporte: '2026-10-22T05:27:00Z',
    latitud: '-8.1150', longitud: '-79.0280',
    evidencias: [{ archivo: '/media/a.jpg' }, { archivo: '/media/b.jpg' },
      { archivo: '/media/c.jpg' }, { archivo: '/media/d.jpg' },
      { archivo: '/media/e.jpg' }] },
];

/* Como vienen de verdad: seis filas, prioridad ALTA/MEDIA/BAJA, sin estado
 * -se registran, no se cierran- y con la garita más cercana y su distancia.
 * El orden de llegada es a propósito el peor posible: una BAJA primero. */
const VULNERABILIDADES = [
  { id: 1, titulo: 'Reja perimétrica cortada', detalles: 'Sector norte, junto al canal',
    prioridad: 'BAJA', latitud: '-8.11', longitud: '-79.03',
    reportado_por_nombre: 'v_calderonr', fecha_reporte: '2026-10-20T18:00:00Z',
    garita_asignada: 'Garita 2', garita_cercana: 'Garita 2',
    distancia_garita_m: 41.6, evidencias: [{ archivo: '/media/v1.jpg' }] },
  { id: 2, titulo: 'Luminaria apagada', detalles: 'Acceso principal sin iluminación',
    prioridad: 'ALTA', latitud: '-8.12', longitud: '-79.04',
    reportado_por_nombre: 'v_montoya', fecha_reporte: '2026-10-21T02:10:00Z',
    garita_asignada: 'Garita 1', garita_cercana: 'Garita 1',
    distancia_garita_m: 12, evidencias: [] },
  { id: 3, titulo: 'Candado forzado', detalles: 'Portón de servicio',
    prioridad: 'ALTA', latitud: '-8.13', longitud: '-79.05',
    reportado_por_nombre: 'v_cueva', fecha_reporte: '2026-10-24T22:30:00Z',
    /* Reportada lejos de su puesto: la distancia sin esta explicación
     * parecería un error de GPS. */
    garita_asignada: 'Garita 1', garita_cercana: 'Garita 4',
    distancia_garita_m: 870.4, evidencias: [{ archivo: '/media/v3a.jpg' },
      { archivo: '/media/v3b.jpg' }, { archivo: '/media/v3c.jpg' },
      { archivo: '/media/v3d.jpg' }] },
  { id: 4, titulo: 'Cámara desalineada', detalles: 'No cubre el ingreso',
    prioridad: 'MEDIA', latitud: '-8.14', longitud: '-79.06',
    reportado_por_nombre: 'v_chavez', fecha_reporte: '2026-10-19T14:00:00Z',
    garita_asignada: 'Garita 3', garita_cercana: 'Garita 3',
    distancia_garita_m: 7, evidencias: [] },
];

window.fetch = async (u) => {
  const url = String(u);
  if (url.includes('/incidentes/lista/')) return json({ results: INCIDENTES });
  if (url.includes('/incidentes/gestion/')) return json({ results: [] });
  if (url.includes('/transito/')) return json({ results: [] });
  if (url.includes('/alertas/')) return json({ results: [] });
  if (url.includes('/vulnerabilidades/lista/')) return json({ results: VULNERABILIDADES });
  return json({ results: [] });
};

/* El armazón de verdad: .maq con el rail flotando encima. No se monta
 * RailGIS porque lo que se mide es el hueco que le deja la pantalla, no el
 * rail en sí; sin él vale el ancho por defecto de --rail-w. */
const raiz = document.getElementById('app');
const maq = document.createElement('div');
maq.className = 'maq';
const main = document.createElement('div');
main.className = 'maq-main';
maq.appendChild(main);
raiz.appendChild(maq);

createRoot(main).render(<Vigilancia />);
