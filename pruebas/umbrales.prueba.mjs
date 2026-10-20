/* ¿Dicen lo mismo todas las copias de los umbrales de lluvia?
 *
 *     node pruebas/umbrales.prueba.mjs
 *
 * POR QUÉ EXISTE. Los umbrales de alerta (0.21 / 0.63 / 1.06 mm por cuarto de
 * hora) y sus colores oficiales estaban escritos a mano en cuatro sitios, con
 * un comentario en cada uno diciendo «los mismos que…». Eso no es una
 * garantía: es una nota. El día que alguien baje el umbral amarillo en el
 * mapa 2D, el gemelo 3D seguiría pintando con el viejo y el aviso al teléfono
 * saldría con un tercero, y nadie lo vería, porque nunca se miran las tres
 * cosas a la vez.
 *
 * Ahora el front sale todo de src/umbralesLluvia.js. Lo que esta prueba vigila
 * es lo que NO puede importarse desde ahí:
 *
 *   - el comando de push del servidor, que los lleva en mm/h (×4)
 *   - el parche que fija el valor del backend (RAIN_ALERT_THRESHOLD_MM)
 *   - que nadie vuelva a escribir los números a mano en el front
 *
 * Y comprueba lo que motivó el repaso: que el manto del 3D pinte una lluvia
 * del MISMO color con el que la columna de esa estación la pinta. Antes no:
 * la columna usaba el código de alerta y el manto una rampa azul→rosa
 * normalizada a 1.4 mm/15 min, o sea que una estación en alerta roja salía
 * rodeada de violeta. Dos escalas para una variable.
 */
import { readFileSync } from 'node:fs';
import { NIVELES_LLUVIA, nivelDe, porHora, MIN_UMBRAL } from '../src/umbralesLluvia.js';
import { colorManto, NIVELES, etiquetaEstacion } from '../src/lluvia3D.js';

let mal = 0, bien = 0;
const t = (etiqueta, obtenido, esperado) => {
  const ok = JSON.stringify(obtenido) === JSON.stringify(esperado);
  if (ok) { bien++; return; }
  mal++;
  console.log(`MAL  ${etiqueta}\n       esperaba ${JSON.stringify(esperado)}\n       obtuvo   ${JSON.stringify(obtenido)}`);
};
const leer = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

// ── 1. La fuente, tal como la conoce el proyecto ───────────────────────
t('son tres niveles', NIVELES_LLUVIA.length, 3);
t('códigos', NIVELES_LLUVIA.map(n => n.nivel), ['ama', 'nar', 'roj']);
t('umbrales', NIVELES_LLUVIA.map(n => n.desde), [0.21, 0.63, 1.06]);
t('colores oficiales', NIVELES_LLUVIA.map(n => n.color), ['#FFF200', '#F37021', '#ED1C24']);
t('la unidad es el cuarto de hora', MIN_UMBRAL, 15);
t('ascendentes', NIVELES_LLUVIA.every((n, i) => i === 0 || n.desde > NIVELES_LLUVIA[i - 1].desde), true);

// Los bordes: el umbral pertenece al nivel que abre, no al anterior.
t('justo por debajo del amarillo no hay nivel', nivelDe(0.2099), null);
t('en el amarillo exacto', nivelDe(0.21)?.nivel, 'ama');
t('en el naranja exacto', nivelDe(0.63)?.nivel, 'nar');
t('en el rojo exacto', nivelDe(1.06)?.nivel, 'roj');
t('cero no es nivel', nivelDe(0), null);

// ── 2. El 3D reexporta, no recopia ─────────────────────────────────────
t('lluvia3D reexporta los mismos niveles', NIVELES, NIVELES_LLUVIA);

// ── 3. El manto y las columnas pintan igual ────────────────────────────
// colorManto recibe mm/15 min, igual que nivelDe. Si para un mismo valor el
// manto no devuelve el color del nivel, las dos escalas han vuelto a
// separarse.
const aRGB = (hex) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
for (const mm of [0.21, 0.4, 0.63, 0.9, 1.06, 2.5, 40]) {
  const nv = nivelDe(mm);
  t(`manto a ${mm} mm/15′ pinta del color de la alerta ${nv.nombre}`,
    colorManto(mm).slice(0, 3), aRGB(nv.color));
}
// Por debajo del amarillo el manto NO usa color de alerta: sigue siendo azul.
for (const mm of [0.05, 0.2]) {
  const c = colorManto(mm).slice(0, 3);
  t(`a ${mm} mm/15′ el manto no usa ningún color de alerta`,
    NIVELES_LLUVIA.some(n => JSON.stringify(aRGB(n.color)) === JSON.stringify(c)), false);
}
t('sin lluvia el manto es transparente', colorManto(0)[3], 0);

// ── 4. El comando de push del servidor, en mm/h ────────────────────────
const py = leer('deploy/backend-vigilantes/pronostico_lluvia.py');
const bloque = py.match(/NIVELES = \[\s*#[^\n]*\n([\s\S]*?)\]/);
if (!bloque) {
  mal++;
  console.log('MAL  no encuentro la lista NIVELES en pronostico_lluvia.py');
} else {
  const enPy = [...bloque[1].matchAll(/\("(\w+)",\s*([\d.]+)\)/g)]
    .map(m => [m[1], parseFloat(m[2])]);
  t('el servidor lleva los tres niveles',
    enPy.map(([n]) => n), ['amarilla', 'naranja', 'roja']);
  t('y en su equivalente por hora (×4)',
    enPy.map(([, v]) => v),
    NIVELES_LLUVIA.map(n => +porHora(n.desde).toFixed(2)));
}

// ── 5. El umbral que el parche fija en el backend ──────────────────────
// OJO: el parche lleva el antes Y el después en líneas seguidas —el valor
// viejo de dos umbrales y el nuevo de tres—. Lo que hay que comprobar es el
// DESPUÉS, o sea el que deja el backend. Buscar "el último que aparezca" o
// "el primero" es frágil; se busca el que tiene tantos umbrales como la
// fuente, y se exige que exista.
const parche = leer('pruebas/parche_umbrales_lluvia.py');
const listas = [...parche.matchAll(/RAIN_ALERT_THRESHOLD_MM',\s*'([\d.,]+)'/g)]
  .map(m => m[1].split(',').map(Number));
const esperados = NIVELES_LLUVIA.map(n => n.desde);
t('el parche del backend deja exactamente los umbrales de la fuente',
  listas.some(l => JSON.stringify(l) === JSON.stringify(esperados)), true);
t('y ese valor es el que el parche escribe, no el que reemplaza',
  listas.at(-1), esperados);

// ── 6. La etiqueta de cada estación ────────────────────────────────────
// Lo que motivó el repaso visual: en un día seco salían veinticinco píldoras
// diciendo "0.0 mm" apiladas, y el color de la píldora venía de una variable
// distinta de la del número.
const ET = (o) => etiquetaEstacion({ inten: true, minSlot: 15, ...o });

t('día seco: sin píldora, solo punto', ET({ iv: 0, av: 0 }).pill, false);
t('y el punto se atenúa', ET({ iv: 0, av: 0 }).tenue, true);
t('llovió antes aunque ahora no: sí hay píldora', ET({ iv: 0, av: 3.2 }).pill, true);
t('…y dice el acumulado', ET({ iv: 0, av: 3.2 }).texto, '3.2 mm');
t('…con fondo neutro, no de alerta', ET({ iv: 0, av: 3.2 }).fondo, 'rgba(8,22,40,.82)');

// EL FALLO QUE SE ARREGLA: antes, con lluvia en curso y acumulado aún en
// cero, salía una píldora amarilla diciendo "0.0 mm". El color decía una cosa
// y el número otra.
const arranca = ET({ iv: 0.3, av: 0.04 });
t('empieza a llover: la píldora va del color del nivel', arranca.fondo, '#FFF200');
t('…y el número es la intensidad que da ese color, no el acumulado',
  arranca.texto, '0.3 mm/15′');
t('nunca una píldora de alerta diciendo 0.0', arranca.texto.startsWith('0.0'), false);

t('en alerta roja', ET({ iv: 1.2, av: 9 }).fondo, '#ED1C24');
t('el texto del rojo es blanco', ET({ iv: 1.2, av: 9 }).color, '#ffffff');
t('el del amarillo, oscuro', ET({ iv: 0.3, av: 1 }).color, '#0b2545');

// Pronóstico: los datos vienen por hora, y el umbral se compara en su
// equivalente. 2 mm/h = 0.5 mm/15 min → naranja, no amarilla.
const pron = ET({ iv: 2, av: 5, minSlot: 60, p: 70 });
t('pronóstico: 2 mm/h son 0.5 mm/15′, o sea amarilla', pron.fondo, '#FFF200');
t('…y se escribe en mm/h, no en mm/15′', pron.texto, '2.0 mm/h · 70%');
// Los bordes exactos, que son donde esto se rompe: el umbral horario es el
// del cuarto de hora por cuatro.
t('2.52 mm/h es justo el naranja', ET({ iv: 2.52, av: 5, minSlot: 60 }).fondo, '#F37021');
t('2.51 mm/h todavía no', ET({ iv: 2.51, av: 5, minSlot: 60 }).fondo, '#FFF200');
t('4.24 mm/h es justo el rojo', ET({ iv: 4.24, av: 5, minSlot: 60 }).fondo, '#ED1C24');
t('0.84 mm/h es justo el amarillo', ET({ iv: 0.84, av: 1, minSlot: 60 }).fondo, '#FFF200');
t('0.83 mm/h no llega a alerta',
  ET({ iv: 0.83, av: 1, minSlot: 60 }).fondo, 'rgba(8,22,40,.82)');

// Probabilidad ausente ≠ 0 %: antes se escribía "· 0%" junto a un número de
// milímetros, que es una contradicción en cuatro caracteres.
t('sin probabilidad no se inventa un 0 %',
  ET({ iv: 2, av: 5, minSlot: 60, p: null }).texto, '2.0 mm/h');

// Sin datos: punto gris siempre, píldora solo de cerca.
t('sin datos de lejos: sin píldora', etiquetaEstacion({ inten: false, cerca: false }).pill, false);
t('sin datos de cerca: píldora', etiquetaEstacion({ inten: false, cerca: true }).pill, true);
t('…y su punto es el gris de sin datos',
  etiquetaEstacion({ inten: false, cerca: false }).punto, '#64748b');

// El punto lleva el color del nivel, igual que la columna y el manto.
for (const mm of [0.21, 0.7, 1.5]) {
  t(`el punto a ${mm} mm/15′ usa el color del nivel`,
    ET({ iv: mm, av: 1 }).punto, nivelDe(mm).color);
}

// ── 7. Que nadie vuelva a escribirlos a mano en el front ───────────────
// Los números sueltos en un .jsx son justo la forma en que esto se rompió.
for (const f of ['src/Mapa.jsx', 'src/Mapa3D.jsx', 'src/lluvia3D.js']) {
  const txt = leer(f).split('\n')
    .filter(l => !l.trimStart().startsWith('*') && !l.trimStart().startsWith('//'))
    .join('\n');
  const copias = txt.match(/0\.21|0\.63|1\.06|#FFF200|#F37021|#ED1C24/g) || [];
  t(`${f} no reescribe umbrales ni colores`, copias, []);
}

console.log(`\n${bien} comprobación(es) en orden${mal ? `, ${mal} MAL` : ''}.`);
process.exit(mal ? 1 : 0);
