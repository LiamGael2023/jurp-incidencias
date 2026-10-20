/* La pantalla de Campañas del inventario, montada con datos de mentira.
 *
 * El servidor se sustituye por un fetch propio: así se puede comprobar el
 * caso que más importa y que en producción casi nunca se ve a voluntad —el
 * endpoint que NO deja crear campañas— sin tocar nada real.
 */
import { createRoot } from 'react-dom/client';
import CampaniasInventario from '../../src/CampaniasInventario';

const CAMPANIAS = [
  { id: 1, anio: 2026, nombre: 'Campaña 2026', estado: 'en_proceso',
    fecha_ini: '2026-01-01', fecha_fin: '2026-12-31' },
  { id: 2, anio: 2025, nombre: 'Campaña 2025', estado: 'cerrada',
    fecha_ini: '2025-01-01', fecha_fin: '2025-12-31' },
];

const CAPAS = ['tomas_laterales', 'alcantarillas', 'compuertas'];
const EVALS = [];
const INDICE = [];
for (let i = 1; i <= 24; i++) {
  const tipo = CAPAS[i % 3];
  const estado = ['B', 'R', 'M'][i % 3];
  EVALS.push({
    id: i, tipo_activo: tipo, activo_fid: i, campania_anio: 2026,
    estado_cons: estado, condicion: estado === 'M' ? 'Inoperativa' : 'Operativa',
    fecha: `2026-0${(i % 9) + 1}-1${i % 9}`,
    evaluador: ['Luis Ramos', 'Ana Vega', 'Pedro Díaz'][i % 3],
    requiere_mant: i % 4 === 0, prioridad: i % 4 === 0 ? 'alta' : '',
    observaciones: i % 5 === 0 ? 'Sedimento en la entrada' : '',
  });
  INDICE.push({ tipo, fid: i, nombre: `Estructura ${i}`,
                canal: `Lateral ${1 + (i % 7)}`, progresiva: `${i}+${i * 10}`,
                lat: -8.4 - i / 100, lng: -78.7 - i / 100 });
}

window.__ESPERADO = {
  evaluaciones: EVALS.length,
  conMant: EVALS.filter(e => e.requiere_mant).length,
  malos: EVALS.filter(e => e.estado_cons === 'M').length,
  total: 300,
  proximoAnio: 2027,
};

const json = (d, status = 200) =>
  new Response(JSON.stringify(d), { status, headers: { 'Content-Type': 'application/json' } });

// ?sinescritura=1 simula el viewset de solo lectura: POST y PATCH dan 405.
const sinEscritura = new URLSearchParams(location.search).has('sinescritura');
window.__CREADO = null;

window.fetch = async (u, opc = {}) => {
  const url = String(u);
  const metodo = (opc.method || 'GET').toUpperCase();
  if (metodo !== 'GET') {
    if (sinEscritura) return json({ detail: 'Method not allowed' }, 405);
    const cuerpo = JSON.parse(opc.body || '{}');
    window.__CREADO = { metodo, cuerpo };
    if (metodo === 'POST') {
      const nueva = { id: 9, ...cuerpo };
      CAMPANIAS.unshift(nueva);
      return json(nueva, 201);
    }
    return json({ ok: true });
  }
  if (url.includes('/campanias/') && url.includes('/avance/')) {
    return json({ detalle: CAPAS.map(c => ({ tipo: c, total: 100, evaluados: 8 })) });
  }
  if (url.includes('/campanias/')) return json(CAMPANIAS);
  if (url.includes('/capas/indice/')) return json(INDICE);
  if (url.includes('/evaluaciones/')) {
    const anio = Number(new URL(url, location.origin).searchParams.get('campania'));
    return json(anio === 2026 ? EVALS : []);
  }
  return json([]);
};

createRoot(document.getElementById('app')).render(
  <div style={{ height: '100vh' }}>
    <CampaniasInventario irAActivo={(a) => { window.__IDO = a; }} />
  </div>
);
