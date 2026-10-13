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
      // El horómetro, para que las horas se puedan descomponer. El primer
      // parte de cada incidencia lleva una hora muerta y los demás ninguna:
      // así se ve que la columna no copia a la de al lado, y que un cero
      // sale distinto de un hueco.
      start_horometer: 1000 + np * 10,
      end_horometer: 1000 + np * 10 + (2 + i) + (i === 0 ? 1 : 0),
      horas_efectivas: 2 + i,
      obs_reduccion: i === 0 ? 'Espera de volquete' : '',
      fuel_gallons: 1,
      provider: 'PROYECTO ESPECIAL CHAVIMOCHIC',
      incidente_id: inc.id,
      incidente_creado: inc.creado,
      costo: 100 * (i + 1),         // 1ª: 1500 ; 7ª: 600 ; 12ª: 300
    });
  }
}
/* UN GRUPO CON DECIMALES DE VERDAD, los de una captura real.
 *
 * Con horas enteras el horómetro resta limpio y no se ve el fallo que
 * motivó esto: 1010.0 − 1000.3 da 9.700000000000045, y al quitarle las 9.70
 * efectivas quedan 4.6e-14 horas muertas. Imprime «0.00 HE» pero no es cero,
 * así que la celda salía resaltada en ámbar diciendo cero —y solo en algunas
 * filas, según qué decimales tocaran—.
 *
 * Ninguno de estos cuatro partes tiene horas muertas: las tres columnas
 * tienen que salir en gris, sin un solo resalte.
 */
const DECIMALES = [[1000.3, 1010.0, 9.7], [1010.0, 1015.7, 5.7],
                   [1015.7, 1019.9, 4.2], [1019.9, 1029.4, 9.5]];
INCS.push({ id: 3, creado: '2026-07-14T08:00:00Z', n: DECIMALES.length });
for (const [ini, fin, he] of DECIMALES) {
  np++;
  PARTES.push({
    id: np, part_number: `PD-${String(np).padStart(4, '0')}-20260921`,
    date: `2026-09-${String(np).padStart(2, '0')}`, cerrado: true,
    activities: 'DESCOLMATACION DE CAUCE',
    metrado: 0, metrado_unidad: 'm3', horas: he,
    start_horometer: ini, end_horometer: fin, horas_efectivas: he,
    obs_reduccion: '', fuel_gallons: 0, provider: 'LIZANA GROUP S.A.C.',
    incidente_id: 3, incidente_creado: '2026-07-14T08:00:00Z',
    costo: 100,
  });
}

// El parte huérfano: sin incidencia.
np++;
PARTES.push({
  id: np, part_number: `PD-${String(np).padStart(4, '0')}-20260930`,
  date: '2026-09-30', cerrado: false, activities: 'TRASLADO',
  metrado: 0, metrado_unidad: 'm3', horas: 1, fuel_gallons: 1,
  // SIN horómetro, a propósito: así se guardaron cientos de partes
  // antiguos, y la columna tiene que decir que no lo sabe en vez de
  // inventarse que no hubo horas muertas.
  start_horometer: null, end_horometer: null, horas_efectivas: null,
  provider: 'JURP', incidente_id: null, incidente_creado: null, costo: 50,
});

const HISTORIAL = {
  partes: PARTES,
  total_partes: PARTES.length,                                   // 15
  // Redondeado como lo hace el backend: sumar 9.7 + 5.7 + … deja brizna,
  // y aquí se simula un total que ya viene limpio.
  total_horas: Math.round(PARTES.reduce((a, p) => a + p.horas, 0) * 100) / 100,  // 64.1
  total_costo: PARTES.reduce((a, p) => a + p.costo, 0),          // 2850
};

const MAQUINA = {
  id: 1, codigo: 'EX01', equipo: 'EXCAVADORA SOBRE ORUGAS', marca: 'KOMATSU',
  modelo: 'PC220LC', placa: '', origen: 'EXTERNA', origen_texto: 'Externa',
  disponible: false, en_mantenimiento: true,
};

/* Horas esperadas. 'horas' son las efectivas; 'program' el tramo del
 * horómetro, que lleva una hora muerta en el primer parte de cada grupo.
 *
 *   1ª: efectivas 20, muertas 1 → programadas 21
 *   7ª: efectivas  9, muertas 1 → programadas 10
 *  12ª: efectivas  5, muertas 1 → programadas  6
 *   sueltos: 1 efectiva, SIN horómetro → programadas y muertas, en blanco
 */
window.__ESPERADO = {
  total: { partes: 15, horas: 64.1, costo: 2850, program: 66.1, muertas: 3 },
  'INCIDENTE-001-12062026': { partes: 5, horas: 20, costo: 1500, program: 21, muertas: 1 },
  'INCIDENTE-007-03072026': { partes: 3, horas: 9, costo: 600, program: 10, muertas: 1 },
  'INCIDENTE-012-21082026': { partes: 2, horas: 5, costo: 300, program: 6, muertas: 1 },
  // El de los decimales: 9.7 + 5.7 + 4.2 + 9.5 = 29.1, y NI UNA hora muerta.
  'INCIDENTE-003-14072026': { partes: 4, horas: 29.1, costo: 400, program: 29.1, muertas: 0 },
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
