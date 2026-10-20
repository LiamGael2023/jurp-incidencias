/* Lotes y licencia: el cruce y sus bordes.
 *
 *     node pruebas/lotes.prueba.mjs
 *
 * Lo que de verdad vigila esto es que un dato que FALTA no se convierta en un
 * "sin licencia". Pintar de naranja un lote del que no sabemos nada es
 * acusar a alguien de regar sin derecho por una columna vacía, y en una capa
 * que se enseña a la Junta eso no es un detalle de estilo.
 */
import {
  codcatsConLicencia, tieneLicencia, colorLote, textoLicencia, reparto,
  COLOR_CON_LICENCIA, COLOR_SIN_LICENCIA,
} from '../src/lotes.js';

let mal = 0, bien = 0;
const t = (etiqueta, ok, extra) => {
  if (ok) { bien++; return; }
  mal++;
  console.log(`MAL  ${etiqueta}${extra ? `   [${extra}]` : ''}`);
};
const f = (codcat, extra = {}) => ({ properties: { codcat, ...extra } });
const fc = (...cs) => ({ features: cs });

// Como llega de verdad: las áreas son un subconjunto de los lotes.
const AREAS = fc(f('10.4A-VI'), f('10.7-I'), f('14A-III'));
const LOTES = fc(f('10.4A-VI'), f('10.7-I'), f('14A-III'), f('VD.39'), f('VD.64'));
const CON = codcatsConLicencia(AREAS);

t('el conjunto trae un código por área', CON.size === 3, `${CON.size}`);
t('un lote del padrón de licencias la tiene', tieneLicencia(f('10.4A-VI'), CON) === true);
t('uno que no está, no la tiene', tieneLicencia(f('VD.39'), CON) === false);

// LO QUE NO PUEDE PASAR: que un hueco se lea como "sin licencia".
t('sin código catastral no se sabe', tieneLicencia(f(null), CON) === null);
t('con el código vacío tampoco', tieneLicencia(f('   '), CON) === null);
t('ni con la cadena "None" de Django', tieneLicencia(f('None'), CON) === null);
t('sin propiedades', tieneLicencia({}, CON) === null);
t('sin feature', tieneLicencia(null, CON) === null);

// Y si la capa de licencias no ha llegado, NADIE es "sin licencia".
t('sin la capa de licencias, no se sabe de nadie',
  tieneLicencia(f('10.4A-VI'), codcatsConLicencia(null)) === null);
t('con la capa vacía, tampoco',
  tieneLicencia(f('10.4A-VI'), codcatsConLicencia(fc())) === null);

// El código se compara sin importar mayúsculas ni espacios: viene de dos
// tablas distintas y una traía el nombre del usuario con otro formato.
t('no distingue mayúsculas', tieneLicencia(f('10.4a-vi'), CON) === true);
t('ni espacios de sobra', tieneLicencia(f('  10.4A-VI  '), CON) === true);

// ── el color ──
t('con licencia, verde', colorLote(f('10.7-I'), CON, '#ccc') === COLOR_CON_LICENCIA);
t('sin licencia, naranja', colorLote(f('VD.64'), CON, '#ccc') === COLOR_SIN_LICENCIA);
t('sin saber, el color de la capa', colorLote(f(null), CON, '#ccc') === '#ccc');
t('sin la capa de licencias, el color de la capa',
  colorLote(f('10.7-I'), new Set(), '#ccc') === '#ccc');

// ── el texto del globo ──
t('texto con licencia', textoLicencia(f('10.7-I'), CON) === 'Con licencia');
t('texto sin licencia', textoLicencia(f('VD.39'), CON) === 'Sin licencia');
t('texto sin dato', textoLicencia(f(null), CON) === 'Licencia: sin dato');

// ── el reparto, que es lo que se enseña ──
const r = reparto(LOTES, CON);
t('cuenta los lotes', r.total === 5, JSON.stringify(r));
t('tres con licencia', r.con === 3, JSON.stringify(r));
t('dos sin ella', r.sin === 2, JSON.stringify(r));
t('ninguno sin dato', r.sinDato === 0, JSON.stringify(r));

const rHuecos = reparto(fc(f('10.4A-VI'), f(null), f('')), CON);
t('los huecos se cuentan aparte, no como "sin licencia"',
  rHuecos.sin === 0 && rHuecos.sinDato === 2, JSON.stringify(rHuecos));

t('sin lotes no revienta', reparto(null, CON).total === 0);

console.log(`\n${bien} comprobación(es) en orden${mal ? `, ${mal} MAL` : ''}.`);
process.exit(mal ? 1 : 0);
