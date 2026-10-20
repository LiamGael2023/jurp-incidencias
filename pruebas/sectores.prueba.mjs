/* Un color por sector, y que dos vecinos no repitan.
 *
 *     node pruebas/sectores.prueba.mjs
 *
 * POR QUE IMPORTA MEDIRLO. Repartir colores por un hash del nombre es lo
 * facil y falla justo donde se nota: dos sectores que se tocan pueden caer en
 * el mismo color y el limite entre ellos desaparece. Como son pocos colores
 * -la paleta categorica validada solo da tres limpios contra todos-, la
 * colision no es rara: es lo normal.
 *
 * Por eso el reparto mira quien linda con quien. Esto comprueba que de verdad
 * lo hace, sobre mallas donde la respuesta se sabe de antemano.
 */
import { colorearPorVecindad, nombreRasgo } from '../src/sectores.js';

let mal = 0, bien = 0;
const t = (etiqueta, ok, extra) => {
  if (ok) { bien++; return; }
  mal++;
  console.log(`MAL  ${etiqueta}${extra ? `   [${extra}]` : ''}`);
};

/** Un cuadrado de lado 1 con la esquina en (x, y). */
const cuadro = (x, y, props = {}) => ({
  type: 'Feature', properties: props,
  geometry: { type: 'Polygon', coordinates: [[
    [x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1], [x, y],
  ]] },
});

/** ¿Hay dos vecinos del mismo color? Devuelve los pares que fallan. */
function colisiones(features, colores) {
  const malos = [];
  const caja = (f) => {
    const c = f.geometry.coordinates.flat(2);
    const xs = c.filter((_, i) => i % 2 === 0), ys = c.filter((_, i) => i % 2 === 1);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  };
  for (let i = 0; i < features.length; i++) {
    for (let j = i + 1; j < features.length; j++) {
      const a = caja(features[i]), b = caja(features[j]);
      const tocan = a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
      if (tocan && colores.get(features[i]) === colores.get(features[j])) {
        malos.push(`${i}↔${j}`);
      }
    }
  }
  return malos;
}

// ── una tira: cada uno toca al siguiente ──────────────────────────────
const tira = Array.from({ length: 8 }, (_, i) => cuadro(i, 0, { nombre: `S${i}` }));
let c = colorearPorVecindad(tira);
t('la tira no deja dos vecinos iguales', colisiones(tira, c).length === 0,
  colisiones(tira, c).join(' '));
t('y todos quedan pintados', tira.every(f => !!c.get(f)));

// ── una malla 4x4: cada uno toca hasta ocho ───────────────────────────
const malla = [];
for (let x = 0; x < 4; x++) for (let y = 0; y < 4; y++) malla.push(cuadro(x, y, { nombre: `${x}-${y}` }));
c = colorearPorVecindad(malla);
const colMalla = colisiones(malla, c);
t('la malla tampoco', colMalla.length === 0, colMalla.join(' '));

const usados = new Set(malla.map(f => c.get(f)));
t('usa varios colores, no uno solo', usados.size >= 3, `${usados.size} colores`);
t('y ninguno fuera de la paleta de cuatro', usados.size <= 4, `${usados.size}`);

// ── polígonos separados: pueden repetir, y deben ──────────────────────
// Si dos sectores no se tocan, gastar un color nuevo en cada uno agotaria la
// paleta sin motivo. El reparto tiene que reutilizar.
const sueltos = [cuadro(0, 0), cuadro(10, 10), cuadro(20, 20), cuadro(30, 30),
                 cuadro(40, 40), cuadro(50, 50)];
c = colorearPorVecindad(sueltos);
t('seis sectores separados reutilizan colores',
  new Set(sueltos.map(f => c.get(f))).size < 6,
  `${new Set(sueltos.map(f => c.get(f))).size} colores para 6`);

// ── estable: el mismo dato da el mismo reparto ────────────────────────
const a1 = colorearPorVecindad(malla), a2 = colorearPorVecindad(malla);
t('el reparto no cambia entre llamadas',
  malla.every(f => a1.get(f) === a2.get(f)));

// ── casos que llegan de verdad ────────────────────────────────────────
t('un solo sector no revienta', colorearPorVecindad([cuadro(0, 0)]).get !== undefined);
t('ninguno tampoco', colorearPorVecindad([]) !== null);
const sinGeom = [{ type: 'Feature', properties: {}, geometry: null }, cuadro(0, 0)];
t('una geometría nula no tumba el reparto',
  !!colorearPorVecindad(sinGeom).get(sinGeom[1]));

// Multipolígono: un sector en dos trozos tiene que medirse entero.
const multi = {
  type: 'Feature', properties: { nombre: 'Partido' },
  geometry: { type: 'MultiPolygon', coordinates: [
    [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
    [[[5, 5], [6, 5], [6, 6], [5, 6], [5, 5]]],
  ] },
};
const conMulti = [multi, cuadro(5, 5, { nombre: 'Vecino del trozo lejano' })];
c = colorearPorVecindad(conMulti);
t('un sector en dos trozos no repite color con quien toca su segundo trozo',
  c.get(multi) !== c.get(conMulti[1]));

// ── el nombre, mire como lo mire la capa ──────────────────────────────
t('nombre', nombreRasgo({ nombre: 'Chao Alto' }) === 'Chao Alto');
t('sector', nombreRasgo({ sector: 'Virú' }) === 'Virú');
t('nom_sector', nombreRasgo({ nom_sector: 'Moche' }) === 'Moche');
t('prefiere nombre sobre codigo',
  nombreRasgo({ codigo: 'S-01', nombre: 'Chao' }) === 'Chao');
t('cae al codigo si no hay nombre', nombreRasgo({ codigo: 'S-01' }) === 'S-01');
t('sin nada, null', nombreRasgo({ otra: 'x' }) === null);
t('vacío no cuenta como nombre',
  nombreRasgo({ nombre: '   ', codigo: 'S-02' }) === 'S-02');
t('propiedades ausentes', nombreRasgo(null) === null);
t('un número sirve de nombre', nombreRasgo({ codigo: 7 }) === '7');

console.log(`\n${bien} comprobación(es) en orden${mal ? `, ${mal} MAL` : ''}.`);
process.exit(mal ? 1 : 0);
