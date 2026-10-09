import { createRoot } from 'react-dom/client';
import Actividades from '../../src/Actividades';
import '../../src/Incidentes.css';
import PARTIDAS_BASE from './partidas.json';
// Tres partidas de la misma rama con unidades distintas: es lo que hace
// visible si el selector deja elegir una que no cuadra.
const PARTIDAS = PARTIDAS_BASE.concat([
  { id: 9001, obra: 'Obras10_6', codigo: '01.02.01.90', descripcion: 'Prueba en m3',
    unidad: 'm3', metrado: 100, precio: 10, ejecutado: 0, saldo: 100, avance: 0,
    otras_unidades: {}, activo: true,
    ruta: JSON.stringify([['01','RAIZ'],['01.02','ESTRUCTURAS DE TRATAMIENTO'],
      ['01.02.01','TRABAJOS PRELIMINARES']]) },
  { id: 9002, obra: 'Obras10_6', codigo: '01.02.01.91', descripcion: 'Prueba en m2',
    unidad: 'm2', metrado: 50, precio: 4, ejecutado: 0, saldo: 50, avance: 0,
    otras_unidades: {}, activo: true,
    ruta: JSON.stringify([['01','RAIZ'],['01.02','ESTRUCTURAS DE TRATAMIENTO'],
      ['01.02.01','TRABAJOS PRELIMINARES']]) },
  { id: 9003, obra: 'Obras10_6', codigo: '01.02.01.92', descripcion: 'Prueba en glb',
    unidad: 'glb', metrado: 1, precio: 5000, ejecutado: 0, saldo: 1, avance: 0,
    otras_unidades: {}, activo: true,
    ruta: JSON.stringify([['01','RAIZ'],['01.02','ESTRUCTURAS DE TRATAMIENTO'],
      ['01.02.01','TRABAJOS PRELIMINARES']]) },
]);

const PROYECTOS = [{ id: 1, codigo: 'Obras10_6', nombre: 'TRATAMIENTO TOMA 10.6',
  partidas: 83, costo_directo: '1007949.21', suma_partidas: 1007949.21,
  actividades: 1, estado: 'activo' }];
const ACTS = [{ id: 11, obra: 'Obras10_6', proyecto: 'TRATAMIENTO TOMA 10.6',
  codigo: 'ACT-0001', nombre: 'Excavacion de la caja de derivacion',
  estado: 'ejecucion', partes: 1, avance: { valorizado: 400, metrado_otra_unidad: 0 },
  // Sale de lo que imputaron sus partes, no de una declaracion.
  presupuestado: 0, partidas: [], partidas_detalle: [
    { id: 20, codigo: '01.02.04.01.01', descripcion: 'Excavacion manual', unidad: 'm3',
      precio: 6.72, imputado: 40, valorizado: 268.8,
      metrado: 173.54, importe: 1166.19, ejecutado: 100, saldo: 73.54, avance: 57.62 }],
  ubicacion_text: 'Prog 0+120', responsable: 'J. Perez' }];
// costeo que cuelga de la ACTIVIDAD 11, no de ningun incidente
const PERS = [{ id: 1, actividad_obra: 11, incident_report: null, date: '2026-10-01',
  description: 'OPERARIO', quantity_hours: '8', unit_price: '25', num_personas: 1,
  horas_normales: 8, horas_extras: 0, origin: 'JURP' }];
const MAT = [{ id: 2, actividad_obra: 11, incident_report: null, date: '2026-10-02',
  description: 'CEMENTO', quantity: '10', unit_price: '32', unit: 'bls' }];
const MAQ = [{ id: 4, actividad_obra: 11, incident_report: null,
  part_number: 'PD-0300-20261009', date: '2026-10-04', shift: 'Día',
  work_zone_text: 'Prog 0+120', provider: 'PECH', operator: 'J. RAMIREZ',
  start_horometer: '100', end_horometer: '106', horas_efectivas: '6',
  unit_price: '188.80', equipment_name: 'EXCAVADORA', brand_name: 'CAT',
  model_plate: 'XYZ-111', maquina: 9, activities: 'EXCAVACION DE MATERIAL',
  actividades: [], cerrado: true }];

const j = (d) => new Response(JSON.stringify(d),
  { status: 200, headers: { 'Content-Type': 'application/json' } });
window.__patches = [];
window.__urls = [];
window.fetch = async (url, opc) => {
  const u = String(url);
  window.__urls.push(u);
  if (opc && opc.method === 'PATCH') {
    window.__patches.push({ url: u, body: JSON.parse(opc.body) }); return j({ ok: true });
  }
  // El servidor de verdad CAMBIA el estado al terminar. El mock tiene que
  // hacerlo tambien: la pantalla se refresca desde el servidor, asi que un
  // mock que no cambia nada la deja como estaba y parece un fallo.
  if (opc && opc.method === 'POST' && u.includes('/cerrar-partes/')) {
    window.__posts = (window.__posts || []).concat([u]);
    window.__estado = 'terminada';
    return j({ detail: 'ok', cerrados: 2, maquinas_liberadas: ['EX02', 'CG01'],
      estado: 'terminada' });
  }
  if (opc && opc.method === 'POST' && u.includes('/reabrir/')) {
    window.__posts = (window.__posts || []).concat([u]);
    window.__estado = 'ejecucion';
    return j({ detail: 'ok', estado: 'ejecucion' });
  }
  if (opc && opc.method === 'POST') { window.__guardado = true; return j({ id: 100 }); }
  if (u.includes('/proyectos/')) return j(PROYECTOS);
  // Sin ?obra= se responde VACIO a proposito: si la pantalla pide asi es
  // que no sabe de que obra es, y eso es un fallo que debe verse.
  if (u.includes('/partidas/?obra=')) return j({ partidas: PARTIDAS });
  if (u.includes('/partidas/')) return j({ partidas: [] });
  if (u.includes('/resumen/')) return j({ total: 1, por_estado: { ejecucion: 1 }, valorizado: 400, partes: 1 });
  // Tras guardar, el servidor devuelve otro valorizado: es lo que hace
  // visible si la lista se refresca sola o se queda con lo viejo.
  if (u.includes('/actividades-obra/')) {
    const base = window.__guardado
      ? ACTS.map(a => ({ ...a, partes: 2,
          avance: { valorizado: 999.99, metrado_otra_unidad: 0 } }))
      : ACTS;
    return j(window.__estado
      ? base.map(a => ({ ...a, estado: window.__estado }))
      : base);
  }
  if (u.includes('incident-personnels')) return j(PERS);
  if (u.includes('incident-materials')) return j(MAT);
  if (u.includes('daily-part-heavy-equipments/siguiente-correlativo')) return j({ siguiente: 'PD-0301-20261009' });
  if (u.includes('daily-part-heavy-equipments')) return j(MAQ);
  if (u.includes('/modelos/')) return j([{ id: 9, codigo: 'EX02', placa: 'XYZ-111',
    modelo: 'CAT 320', marca_nombre: 'CAT', equipo_nombre: 'EXCAVADORA', estado: 0,
    precio_hora: '188.80' }]);
  if (u.includes('/cargos/')) return j([{ id: 1, nombre: 'OPERARIO', activo: true }]);
  if (u.includes('/actividades/')) return j([{ id: 1, nombre: 'EXCAVACION DE MATERIAL', activo: true }]);
  return j([]);
};
createRoot(document.getElementById('r')).render(<Actividades />);
