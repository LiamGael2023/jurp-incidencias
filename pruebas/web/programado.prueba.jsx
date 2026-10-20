/* El bloque "Programado" del modal de gestión, montado de verdad.
 *
 * Tres estados, que se eligen por la URL:
 *
 *   ?v=sin      el servidor responde pero la incidencia no tiene partidas
 *   ?v=con      tiene tres programadas, una pasada de saldo
 *   ?v=viejo    el servidor todavía no lleva el campo (parche sin aplicar)
 *
 * El tercero importa tanto como los otros: es el estado real hasta que
 * alguien corra el parche, y tiene que decirlo en vez de salir vacío.
 */
import { createRoot } from 'react-dom/client';
import GestionCosteo from '../../src/GestionCosteo';
import '../../src/Incidentes.css';

const v = new URLSearchParams(location.search).get('v') || 'con';

/* Un presupuesto como el real: dos obras, para que se note si el selector
 * del parte ofrece las de la otra. */
const PARTIDAS = [
  { id: 1, codigo: '01.02.01.01', descripcion: 'Movilizacion y desmovilizacion de maquinaria pesada', unidad: 'glb', metrado: 1, precio: 8500 },
  { id: 2, codigo: '01.02.01.02', descripcion: 'Trazo y replanteo', unidad: 'm2', metrado: 420, precio: 3.2 },
  { id: 3, codigo: '01.02.02.01', descripcion: 'Excavacion de material suelto', unidad: 'm3', metrado: 173, precio: 24.5 },
  { id: 4, codigo: '02.01.01.01', descripcion: 'Encofrado de muro (OTRA OBRA)', unidad: 'm2', metrado: 90, precio: 48 },
  { id: 5, codigo: '02.01.01.02', descripcion: 'Concreto f c=210 (OTRA OBRA)', unidad: 'm3', metrado: 36, precio: 420 },
];

const DETALLE = [
  { id: 1, codigo: '01.02.01.01', descripcion: 'Movilizacion y desmovilizacion de maquinaria pesada',
    unidad: 'glb', metrado: 1, precio: 8500, ejecutado: 0, saldo: 1, avance: 0 },
  { id: 3, codigo: '01.02.02.01', descripcion: 'Excavacion de material suelto',
    unidad: 'm3', metrado: 173, precio: 24.5, ejecutado: 100, saldo: 73, avance: 57.8 },
  { id: 2, codigo: '01.02.01.02', descripcion: 'Trazo y replanteo',
    unidad: 'm2', metrado: 420, precio: 3.2, ejecutado: 460, saldo: -40, avance: 109.5 },
];

window.__ESPERADO = { partidas: PARTIDAS.length, programadas: DETALLE.length,
                      pasada: '01.02.01.02' };
window.__PATCH = null;

const json = (d, s = 200) => new Response(JSON.stringify(d),
  { status: s, headers: { 'Content-Type': 'application/json' } });

let detalle = v === 'con' ? [...DETALLE] : [];

const real = window.fetch;
window.fetch = async (u, opc = {}) => {
  const url = String(u);
  const metodo = (opc.method || 'GET').toUpperCase();

  if (/\/incidentes\/\d+\/$/.test(url)) {
    if (v === 'viejo') return json({ id: 7, codigo: 'INCIDENTE-002' });  // sin el campo
    if (metodo === 'PATCH') {
      const ids = JSON.parse(opc.body).partidas;
      window.__PATCH = ids;
      detalle = ids.map(id => DETALLE.find(d => d.id === id)
        || { ...PARTIDAS.find(p => p.id === id), ejecutado: 0, saldo: PARTIDAS.find(p => p.id === id).metrado, avance: 0 });
      return json({ id: 7, partidas: ids, partidas_detalle: detalle });
    }
    return json({ id: 7, partidas: detalle.map(d => d.id), partidas_detalle: detalle });
  }
  if (url.includes('/partidas/')) return json(PARTIDAS);
  if (url.includes('/incidentes-cerrados/')) return json([]);
  // Lo demás: listas vacías, que el costeo no es lo que se prueba aquí.
  if (url.includes(real ? '/api/' : '/api/')) return json([]);
  return json([]);
};

createRoot(document.getElementById('app')).render(
  <GestionCosteo
    abierto
    sujeto={{ id: 7, titulo: 'INCIDENTE-002-14082026',
              subtitulo: 'Otros (Proteccion de Canoa 8) en CANAL LATERAL 10',
              detalle: 'C-08' }}
    campoVinculo="incident_report"
    onCerrar={() => {}}
    onCambio={() => {}}
  />
);
