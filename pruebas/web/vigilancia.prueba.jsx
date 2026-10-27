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
];

window.fetch = async (u) => {
  const url = String(u);
  if (url.includes('/incidentes/lista/')) return json({ results: INCIDENTES });
  if (url.includes('/incidentes/gestion/')) return json({ results: [] });
  if (url.includes('/transito/')) return json({ results: [] });
  if (url.includes('/alertas/')) return json({ results: [] });
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
