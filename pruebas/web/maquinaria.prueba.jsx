/* La ficha de una máquina, montada de verdad, con su historial de partes.
 *
 * Lo que se prueba es el filtro por N° de incidencia: que la tabla, las tres
 * tarjetas de arriba, el pie y —sobre todo— los dos archivos que se
 * descargan digan todos lo mismo. Un Excel que sale con los 29 partes
 * después de filtrar a 4 es peor que no tener filtro.
 */
import { createRoot } from 'react-dom/client';
import Maquinaria from '../../src/Maquinaria';

/* Tres incidencias con distinto número de partes, a propósito:
 *
 *   INCIDENTE-001-12062026   5 partes
 *   INCIDENTE-007-03072026   3 partes
 *   INCIDENTE-012-21082026   2 partes
 *   sin incidencia           1 parte
 *
 * Las cantidades son distintas entre sí para que, al contar filas, no se
 * pueda confundir una incidencia con otra. Y hay un parte SIN incidencia
 * porque existen: no debe salir como opción del selector ni colarse en
 * ningún filtro, pero sí contar en el total sin filtrar.
 */
const INCS = [
  { id: 1, creado: '2026-06-12T08:00:00Z', n: 5 },
  { id: 7, creado: '2026-07-03T08:00:00Z', n: 3 },
  { id: 12, creado: '2026-08-21T08:00:00Z', n: 2 },
];

let np = 0;
const PARTES = [];
for (const inc of INCS) {
  for (let i = 0; i < inc.n; i++) {
    np++;
    PARTES.push({
      id: np,
      part_number: `PD-${String(np).padStart(4, '0')}-20260930`,
      date: `2026-09-${String(np).padStart(2, '0')}`,
      cerrado: true,
      activities: 'ENROCADO',
      metrado: 10 + np, metrado_unidad: 'm3',
      horas: 2 + i,                 // 1ª: 2+3+4+5+6 = 20 ; 7ª: 2+3+4 = 9 ; 12ª: 2+3 = 5
      fuel_gallons: 1,
      provider: 'PROYECTO ESPECIAL CHAVIMOCHIC',
      incidente_id: inc.id,
      incidente_creado: inc.creado,
      costo: 100 * (i + 1),         // 1ª: 1500 ; 7ª: 600 ; 12ª: 300
    });
  }
}
// El parte huérfano: sin incidencia.
np++;
PARTES.push({
  id: np, part_number: `PD-${String(np).padStart(4, '0')}-20260930`,
  date: '2026-09-30', cerrado: false, activities: 'TRASLADO',
  metrado: 0, metrado_unidad: 'm3', horas: 1, fuel_gallons: 1,
  provider: 'JURP', incidente_id: null, incidente_creado: null, costo: 50,
});

const HISTORIAL = {
  partes: PARTES,
  total_partes: PARTES.length,                                   // 11
  total_horas: PARTES.reduce((a, p) => a + p.horas, 0),          // 35
  total_costo: PARTES.reduce((a, p) => a + p.costo, 0),          // 2450
};

const MAQUINA = {
  id: 1, codigo: 'EX01', equipo: 'EXCAVADORA SOBRE ORUGAS', marca: 'KOMATSU',
  modelo: 'PC220LC', placa: '', origen: 'EXTERNA', origen_texto: 'Externa',
  disponible: false, en_mantenimiento: true,
};

window.__ESPERADO = {
  total: { partes: 11, horas: 35, costo: 2450 },
  'INCIDENTE-001-12062026': { partes: 5, horas: 20, costo: 1500 },
  'INCIDENTE-007-03072026': { partes: 3, horas: 9, costo: 600 },
  'INCIDENTE-012-21082026': { partes: 2, horas: 5, costo: 300 },
};

window.fetch = async (u) => {
  const url = String(u);
  const cuerpo = /\/modelos\/\d+\/partes\//.test(url) ? HISTORIAL
    : url.includes('maquinaria-estado') ? { maquinaria: [MAQUINA] }
    : {};
  return new Response(JSON.stringify(cuerpo),
    { status: 200, headers: { 'Content-Type': 'application/json' } });
};

createRoot(document.getElementById('app')).render(<Maquinaria />);
