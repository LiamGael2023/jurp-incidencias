/* El presupuesto plano convertido en árbol: orden, títulos y sumas.
 *
 *     node pruebas/arbol_presupuesto.prueba.mjs
 *
 * Sin navegador: esto es aritmética y orden, y los dos fallan en silencio.
 * Un título que suma de más da un total plausible; un orden alfabético pone
 * el 01.10 antes del 01.9 y la tabla sigue pareciendo correcta.
 *
 * Los datos imitan el Excel de verdad -Obras10_6-: los niveles de arriba
 * vienen SIN rellenar ("1", "1.02") y los de abajo rellenos ("01.02.01"),
 * que es justo lo que rompe la comparación por texto.
 */
import { construirArbol, totalesDe, destinosDe, ordenDe, padreDe, nivelDe }
  from '../src/arbolPresupuesto.js';

const r = [];
const ok = (c, m, e) => { r.push(!!c); console.log(`${c ? 'ok  ' : 'MAL '} ${m}${e ? `   [${e}]` : ''}`); };

const ruta = (...pares) => JSON.stringify(pares);

/* Dos capítulos, cuatro partidas. Los importes están elegidos para que
 * sumar de más se note: si un título contara también a los otros títulos,
 * el total saldría exactamente al doble. */
const PARTIDAS = [
  { id: 1, codigo: '01.01.01', descripcion: 'Movilizacion', unidad: 'glb',
    metrado: 1, precio: 5000, ejecutado: 0,
    ruta: ruta(['01', 'ESTRUCTURAS'], ['01.01', 'TRABAJOS PRELIMINARES']) },
  { id: 2, codigo: '01.01.02', descripcion: 'Trazo y replanteo', unidad: 'mes',
    metrado: 3, precio: 6207, ejecutado: 1,
    ruta: ruta(['01', 'ESTRUCTURAS'], ['01.01', 'TRABAJOS PRELIMINARES']) },
  { id: 3, codigo: '01.02.01', descripcion: 'Almacen provisional', unidad: 'm2',
    metrado: 24, precio: 102.67, ejecutado: 24,
    ruta: ruta(['01', 'ESTRUCTURAS'], ['01.02', 'OBRAS PROVISIONALES']) },
  { id: 4, codigo: '01.02.02', descripcion: 'Seguridad en el trabajo', unidad: 'gbl',
    metrado: 1, precio: 6300, ejecutado: 0,
    ruta: ruta(['01', 'ESTRUCTURAS'], ['01.02', 'OBRAS PROVISIONALES']) },
];

const a = construirArbol(PARTIDAS);

// ── estructura ──
ok(a.length === 7, 'salen las 4 partidas y sus 3 títulos', `${a.length}`);
ok(a.filter(f => f.es_titulo).length === 3, 'tres títulos');
ok(a.filter(f => f.es_titulo).every(f => f.id === null),
   'los títulos del Excel no tienen id: no son filas de la base');
ok(a[0].codigo === '01' && a[0].descripcion === 'ESTRUCTURAS',
   'el título raíz sale de la ruta, con su nombre', `${a[0].codigo} ${a[0].descripcion}`);
ok(a.map(f => f.codigo).join(',') === '01,01.01,01.01.01,01.01.02,01.02,01.02.01,01.02.02',
   'y el orden es el del presupuesto', a.map(f => f.codigo).join(','));
ok(a.find(f => f.codigo === '01.01.01').nivel === 3, 'el nivel sale del código');
ok(padreDe('01.02.01') === '01.02' && padreDe('01') === null, 'y el padre también');

// ── las sumas ──
const t1 = a.find(f => f.codigo === '01.01');
ok(Math.abs(t1.importe - (5000 + 18621)) < 0.01,
   'un título suma lo que cuelga de él', `${t1.importe}`);
const raiz = a.find(f => f.codigo === '01');
ok(Math.abs(raiz.importe - (5000 + 18621 + 2464.08 + 6300)) < 0.01,
   'y el de arriba suma sus nietos, no a sus hijos otra vez', `${raiz.importe}`);
ok(t1.metrado === null && t1.unidad === '',
   'un título no tiene metrado ni unidad: 3 mes más 1 glb no son 4 de nada');

const tot = totalesDe(a);
ok(Math.abs(tot.importe - 32385.08) < 0.01,
   'el total cuenta SOLO las hojas', `${tot.importe}`);
ok(tot.partidas === 4 && tot.titulos === 3, 'y dice cuántas son de cada');
ok(Math.abs(tot.valorizado - (0 + 6207 + 2464.08 + 0)) < 0.01,
   'lo valorizado es lo ejecutado a precio de presupuesto', `${tot.valorizado}`);
ok(Math.abs(tot.saldo - (tot.importe - tot.valorizado)) < 0.01,
   'y el saldo es la resta');

// ── EL ORDEN POR NUMERO: lo que falla en silencio ──
ok(JSON.stringify(ordenDe('01.09')) < JSON.stringify(ordenDe('01.10')) ||
   ordenDe('01.09')[1][1] < ordenDe('01.10')[1][1],
   '01.09 ordena antes que 01.10');
const diez = construirArbol([
  { id: 9, codigo: '1.9', descripcion: 'Nueve', unidad: 'und', metrado: 1, precio: 1,
    ejecutado: 0, ruta: ruta(['1', 'CAP']) },
  { id: 10, codigo: '1.10', descripcion: 'Diez', unidad: 'und', metrado: 1, precio: 1,
    ejecutado: 0, ruta: ruta(['1', 'CAP']) },
]);
ok(diez.map(f => f.codigo).join(',') === '1,1.9,1.10',
   'y con códigos SIN rellenar -como los trae el Excel- también',
   diez.map(f => f.codigo).join(','));

// ── los casos que llegan de un servidor real ──
ok(construirArbol([]).length === 0, 'sin partidas, árbol vacío');
ok(construirArbol([{ id: 1, codigo: '', descripcion: 'x' }]).length === 0,
   'una partida sin código se ignora en vez de romper la tabla');
const rota = construirArbol([
  { id: 1, codigo: '01.01', descripcion: 'X', unidad: 'und', metrado: 2, precio: 3,
    ejecutado: 0, ruta: '{esto no es json' },
]);
ok(rota.length === 1 && rota[0].codigo === '01.01',
   'una ruta rota deja la partida sin título, no tumba el árbol',
   `${rota.length}`);
const sinRuta = construirArbol([
  { id: 1, codigo: '05', descripcion: 'Suelta', unidad: 'und', metrado: 2, precio: 3,
    ejecutado: 0 },
]);
ok(sinRuta.length === 1 && sinRuta[0].nivel === 1,
   'y una partida sin ruta queda en la raíz');

// Un título escrito a mano SI tiene id, y manda sobre el reconstruido.
const conPropio = construirArbol([
  { id: 77, codigo: '01', descripcion: 'CAPITULO A MANO', es_titulo: true },
  { id: 1, codigo: '01.01', descripcion: 'Partida', unidad: 'und', metrado: 2,
    precio: 10, ejecutado: 0, ruta: ruta(['01', 'NOMBRE VIEJO DE LA RUTA']) },
]);
const suTitulo = conPropio.find(f => f.codigo === '01');
ok(suTitulo.id === 77 && suTitulo.descripcion === 'CAPITULO A MANO',
   'un título guardado manda sobre el nombre copiado en la ruta',
   `${suTitulo.id} ${suTitulo.descripcion}`);
ok(Math.abs(suTitulo.importe - 20) < 0.01, 'y suma igual', `${suTitulo.importe}`);

// Solo los títulos con id se pueden elegir como destino: a uno
// reconstruido desde la ruta no se le puede colgar nada, porque no existe.
const dest = destinosDe(conPropio);
ok(dest.length === 2 && dest[0].id === '' && dest[1].id === '77',
   'los destinos son la raíz y los títulos que existen de verdad',
   dest.map(d => d.id).join('|'));
ok(destinosDe(a).length === 1,
   'un presupuesto importado no ofrece títulos donde colgar: no son filas',
   `${destinosDe(a).length}`);

const mal = r.filter(x => !x).length;
console.log(`\n${r.length - mal} de ${r.length} en orden${mal ? `, ${mal} MAL` : ''}.`);
process.exit(mal ? 1 : 0);
