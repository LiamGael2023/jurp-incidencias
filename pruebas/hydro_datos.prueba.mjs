/* La capa de datos de HYDROMETRIX.
 *
 *     node pruebas/hydro_datos.prueba.mjs
 *
 * QUE SE COMPRUEBA Y POR QUE. `datosHydro.js` existe porque todavía no se
 * ha visto una respuesta de verdad de /api/operadores/: prueba varios
 * nombres de campo y se queda con el que venga. Eso es útil mientras dure,
 * pero es exactamente la clase de código que puede equivocarse en silencio
 * —leer un campo que no era, convertir dos veces, dar por bueno un vacío—,
 * y el resultado de equivocarse aquí es un número plausible y falso en una
 * pantalla que alguien va a usar para decidir cuánta agua suelta.
 *
 * Así que lo que se mide es lo que duele:
 *
 *   1. Que la conversión de unidad sea la buena y se aplique UNA vez.
 *   2. Que las tres formas de respuesta que puede tener una serie acaben
 *      todas en la misma estructura, con los huecos como huecos.
 *   3. Que cuando NO se entiende la respuesta se diga, en vez de devolver
 *      una lista vacía que la pantalla pintaría como «no hubo caudal».
 *   4. Que el color de una toma no dependa de qué otras tomas estén
 *      filtradas.
 */
import {
  convierteCaudal, numero, campo, listaDe, sinTildes,
  normalizaTomas, normalizaResumen, normalizaSeries, normalizaVolumen,
  clasificaEstado, colorDeToma, parametros, MESES, cifra, momentoLegible,
  ordenaCategorias, explica,
} from '../src/datosHydro.js';

const r = [];
const ok = (c, m, e) => {
  r.push(!!c);
  console.log(`${c ? 'ok  ' : 'MAL '} ${m}${e ? `   [${e}]` : ''}`);
};

/* ── 1. unidades ───────────────────────────────────────────────────────── */

/* El ancla: su gráfico de caudal de salida tope en 3600 m3/h y la lectura
 * guardada de la 10.6/7 era 619 l/s con un máximo de 1000. 1000 × 3,6 =
 * 3600. Si alguna vez este número deja de salir, o lo guardado cambió de
 * unidad o alguien metió otra conversión por el camino. */
ok(convierteCaudal(1000, 'm3/h') === 3600, '1000 l/s son 3600 m3/h');
ok(convierteCaudal(1000, 'l/s') === 1000, 'en l/s no se toca');
ok(convierteCaudal(619, 'm3/h') === 619 * 3.6, '619 l/s salen a 2228,4 m3/h');
ok(convierteCaudal(null, 'm3/h') === null, 'sin lectura sigue sin lectura');
ok(convierteCaudal('', 'm3/h') === null, 'la cadena vacía no es cero');
/* Unidad desconocida: se cae del lado de m3/h, que es lo que se enseña por
 * defecto. Devolver el crudo en su lugar mezclaría l/s con m3/h en el mismo
 * eje sin avisar. */
ok(convierteCaudal(100, 'barriles') === 360, 'una unidad rara cae en m3/h');

ok(numero('0.80') === 0.8, 'decimal con punto');
ok(numero('0,80') === 0.8, 'decimal con coma');
ok(numero(0) === 0, 'el cero es un número');
ok(numero(null) === null && numero('') === null, 'ni null ni vacío son cero');

/* ── 2. leer campos sin saber el nombre ────────────────────────────────── */

ok(campo({ caudal_salida: 7 }, ['caudal_salida']) === 7, 'campo exacto');
ok(campo({ caudalSalida: 7 }, ['caudal_salida']) === 7, 'camelCase también');
ok(campo({ 'caudal-salida': 7 }, ['caudal_salida']) === 7, 'con guion también');
ok(campo({ a: null, b: 2 }, ['a', 'b']) === 2, 'un nulo no cuenta como presente');
ok(campo({ a: 0 }, ['a']) === 0, 'pero el cero sí');
ok(campo(null, ['a']) === undefined, 'sin objeto no revienta');

ok(listaDe([1, 2]).length === 2, 'array pelado');
ok(listaDe({ results: [1] }).length === 1, 'paginado de DRF');
ok(listaDe({ data: [1, 2, 3] }).length === 3, 'envuelto en data');
ok(listaDe({ otra: 1 }).length === 0, 'lo que no es lista, no es lista');

ok(sinTildes('Última Lectura') === 'ultima lectura', 'sin tildes');

/* ── 3. las tres formas de una serie ───────────────────────────────────── */

const esperado = (n) => (x) => x.ok
  && x.datos.categorias.length === 3
  && x.datos.series.length === n;

// (a) el servidor ya manda categorías y series
const a = normalizaSeries({
  labels: ['01:00', '02:00', '03:00'],
  series: [{ name: '10.2', data: [1, 2, 3] }, { name: '10.4', data: [4, 5, 6] }],
});
ok(esperado(2)(a), 'forma (a): labels + series');
ok(a.datos.series[0].nombre === '10.2' && a.datos.series[0].datos[2] === 3,
   'forma (a): los valores llegan enteros');

// (b) cada elemento es una serie con sus puntos
const b = normalizaSeries([
  { toma: '10.2', puntos: [{ hora: '01:00', valor: 1 }, { hora: '03:00', valor: 3 }] },
  { toma: '10.4', puntos: [{ hora: '01:00', valor: 9 }, { hora: '02:00', valor: 8 }] },
]);
ok(esperado(2)(b), 'forma (b): serie con puntos dentro');
/* LA UNION, Y EN ORDEN. Las dos series traen horas distintas, así que el
 * eje es la unión de ambas. En orden de llegada saldría 01:00, 03:00,
 * 02:00 y el gráfico dibujaría las horas desordenadas: una línea que baja y
 * vuelve a subir sin que el agua haya hecho nada de eso. */
ok(JSON.stringify(b.datos.categorias) === JSON.stringify(['01:00', '02:00', '03:00']),
   'forma (b): la unión de las horas, y en orden cronológico');
/* Y los valores tienen que haber seguido a su hora al reordenarse: la 10.2
 * medía 3 a las 03:00, no a las 02:00. */
ok(b.datos.series.find((s) => s.nombre === '10.2').datos[2] === 3,
   'forma (b): al ordenar, cada valor se queda con su hora');
/* EL HUECO ES UN HUECO. La 10.2 no tiene lectura a las 02:00. Si saliera 0,
 * el gráfico dibujaría una caída a cero que no pasó; si se omitiera, la
 * línea uniría la 01:00 con la 03:00 y enseñaría un caudal inventado. */
const serie102 = b.datos.series.find((s) => s.nombre === '10.2');
const i0200 = b.datos.categorias.indexOf('02:00');
ok(serie102.datos[i0200] === null, 'forma (b): la hora que falta queda en null');

// (c) filas planas
const c = normalizaSeries({
  results: [
    { toma: '10.2', hora: '01:00', valor: 1 },
    { toma: '10.2', hora: '02:00', valor: 2 },
    { toma: '10.4', hora: '01:00', valor: 5 },
    { toma: '10.2', hora: '03:00', valor: 3 },
  ],
});
ok(c.ok && c.datos.series.length === 2, 'forma (c): filas planas');
ok(c.datos.series.find((s) => s.nombre === '10.4').datos[1] === null,
   'forma (c): la 10.4 no tiene las 02:00 y queda en null');

/* Lo que NO se puede ordenar solo. Los días y los meses ya vienen en su
 * orden; alfabetizarlos pondría Abril delante de Enero y el Viernes delante
 * del Lunes. Por eso solo se ordena lo que se reconoce: horas, fechas ISO y
 * números. */
ok(JSON.stringify(ordenaCategorias(['Lunes', 'Martes', 'Miércoles']))
   === JSON.stringify(['Lunes', 'Martes', 'Miércoles']),
   'los días de la semana se dejan como vienen');
ok(ordenaCategorias(['Enero', 'Febrero'])[0] === 'Enero',
   'los meses tampoco se alfabetizan');
ok(JSON.stringify(ordenaCategorias(['10:00', '9:00']))
   === JSON.stringify(['9:00', '10:00']),
   'las 9:00 van antes que las 10:00, no después');
ok(JSON.stringify(ordenaCategorias(['2026-10-02', '2026-09-30']))
   === JSON.stringify(['2026-09-30', '2026-10-02']), 'fechas ISO en orden');
ok(JSON.stringify(ordenaCategorias(['10', '2'])) === JSON.stringify(['2', '10']),
   'los números, como números');

/* ── 4. decir que no se entiende, en vez de enseñar un vacío ───────────── */

const raro = normalizaSeries({ mensaje: 'hola', cosa: 1 });
ok(raro.ok === false, 'una respuesta rara NO se da por buena');
ok(Array.isArray(raro.visto) && raro.visto.includes('mensaje'),
   'y dice qué claves traía', (raro.visto || []).join(','));

const resumenMudo = normalizaResumen({
  results: [{ nombre: '10.2', loquesea: 1 }, { nombre: '10.4', loquesea: 2 }],
});
ok(resumenMudo.ok === false,
   'un resumen del que no se reconoce ni un caudal ni una turbidez es un fallo');

const resumenBueno = normalizaResumen({
  results: [{
    nombre: '10.6/7', estado_poza: 'Bajo', caudal_salida: '619.00',
    desnivel_sedimentador: '0.80', turbidez_salida: '16.30',
    ultima_lectura: '2026-10-27T04:00:00Z',
  }],
});
ok(resumenBueno.ok && resumenBueno.datos[0].caudalSalida === 619,
   'un resumen de verdad sí se lee');
ok(resumenBueno.datos[0].estado === 'bajo', 'y clasifica el estado');
/* El texto guardado se conserva aparte del que se clasifica: si mañana el
 * servidor escribe «Nivel bajo» en vez de «Bajo», la tarjeta sigue
 * enseñando lo que dice el servidor y no lo que creemos entender. */
ok(resumenBueno.datos[0].estadoTexto === 'Bajo', 'y guarda el texto original');

const vacio = normalizaTomas({ results: [] });
ok(vacio.ok === false, 'un catálogo de tomas vacío también se declara');

/* ── 5. estados ────────────────────────────────────────────────────────── */

ok(clasificaEstado('Muy bajo') === 'muy-bajo', 'muy bajo');
ok(clasificaEstado('Bajo') === 'bajo', 'bajo');
ok(clasificaEstado('En su nivel') === 'normal', 'en su nivel');
ok(clasificaEstado('Excedencia') === 'excedencia', 'excedencia');
ok(clasificaEstado('MUY BAJO') === 'muy-bajo', 'da igual la caja');
/* «Muy bajo» contiene «bajo»: el orden de las comprobaciones importa, y si
 * alguien las reordena esta línea se pone roja. */
ok(clasificaEstado('muy bajo') !== 'bajo', '«muy bajo» no se queda en «bajo»');
ok(clasificaEstado('en revisión') === 'desconocido',
   'lo que no se reconoce no se pinta de verde');
ok(clasificaEstado(null) === 'desconocido', 'sin estado, desconocido');

/* ── 6. el color sigue a la toma, no a su puesto ───────────────────────── */

const catalogo = ['10.2', '10.3 A', '10.4', '10.4 A', '10.5', '10.5 A', '10.6/7'];
const todas = catalogo.map((t) => colorDeToma(t, catalogo));
ok(new Set(todas).size === catalogo.length, 'siete tomas, siete colores');

/* LA PROPIEDAD QUE IMPORTA. Si el color saliera del orden en el gráfico,
 * filtrar dos tomas repintaría las supervivientes y la 10.5 sería violeta
 * en un panel y azul en el de al lado. */
const filtrado = ['10.4', '10.5'];
ok(colorDeToma('10.5', catalogo) === todas[4],
   'la 10.5 conserva su color con el filtro puesto');
ok(filtrado.map((t) => colorDeToma(t, catalogo)).join() === `${todas[2]},${todas[4]}`,
   'y ninguna de las que quedan cambia');
ok(colorDeToma('Canal L10', catalogo) === colorDeToma('Canal L10', catalogo),
   'lo que no está en el catálogo también tiene color estable');

/* ── 7. volúmenes ──────────────────────────────────────────────────────── */

/* Los doce meses, siempre. Un año con lecturas desde julio no puede
 * dibujarse como si el año empezase en julio. */
const vm = normalizaVolumen({
  results: [{ mes: 'Julio', volumen: 100 }, { mes: 'Agosto', volumen: 200 }],
}, MESES);
ok(vm.ok && vm.datos.categorias.length === 12, 'el eje son los doce meses');
ok(vm.datos.datos[6] === 100 && vm.datos.datos[7] === 200, 'julio y agosto en su sitio');
ok(vm.datos.datos[0] === null, 'enero sin dato queda vacío, no en cero');

const vmNum = normalizaVolumen({ results: [{ mes: 9, volumen: 55 }] }, MESES);
ok(vmNum.datos.datos[8] === 55, 'el mes también vale como número');

const vt = normalizaVolumen({ results: [{ toma: '10.2', volumen: 1 }] });
ok(vt.ok && vt.datos.categorias[0] === '10.2', 'volumen por tomas');

/* ── 8. los parámetros ─────────────────────────────────────────────────── */

const p = parametros({ metrica: 'caudal_salida', tomas: [1, 2], periodo: 'dia', fecha: '2026-10-26' });
ok(p.get('periodo') === 'dia' && p.get('period') === 'day',
   'el periodo va en los dos idiomas');
ok(p.get('fecha') === '2026-10-26' && p.get('date') === '2026-10-26', 'la fecha también');
ok(p.get('tomas') === '1,2', 'las tomas van separadas por comas');
ok(p.get('metrica') === 'caudal_salida', 'y la métrica');
ok([...parametros({}).keys()].length === 0, 'sin filtros no se manda nada');
/* Sin tomas elegidas NO se manda `tomas=`: una lista vacía podría leerse en
 * el servidor como «ninguna toma» y devolver cero filas, cuando lo que
 * quiere decir la pantalla es «todas». */
ok(!parametros({ tomas: [] }).has('tomas'), '«todas» no manda la lista vacía');

/* ── 8b. qué significa cada fallo ──────────────────────────────────────── */

/* LOS DOS 403. El de DRF significa cosas opuestas según lo que diga el
 * detalle, y confundirlas manda a arreglar el sitio equivocado: uno se
 * resuelve dándole un permiso a la cuenta y el otro añadiendo
 * TokenAuthentication a la vista. Ningún grupo arregla el segundo. */
const e403permiso = explica(403, 'No tiene permiso para realizar esta acción.', 'tomas/');
ok(e403permiso.includes('entró'),
   '403 con «no tiene permiso» habla de la cuenta', e403permiso.slice(0, 48));

const e403sin = explica(403, 'Las credenciales de autenticación no se proveyeron.', 'tomas/');
ok(e403sin.includes('token'),
   '403 con «no se proveyeron» habla del token, no de la cuenta',
   e403sin.slice(0, 48));
ok(e403permiso !== e403sin, 'y los dos mensajes son distintos');

const e403ingles = explica(403, 'Authentication credentials were not provided.', 'tomas/');
ok(e403ingles === e403sin, 'da igual si el servidor responde en inglés');

/* Un token mirado y rechazado SI es sesión caducada: eso se arregla
 * volviendo a entrar, no tocando el servidor. */
ok(explica(401, 'Token inválido.', 'tomas/').includes('Vuelve a entrar'),
   '401 con «token inválido» manda a volver a entrar');
ok(!explica(401, 'Token inválido.', 'tomas/').includes('token de la sesión'),
   'y no manda a tocar el servidor');

ok(explica(404, '', 'tomas/').includes('/api/operadores/tomas/'),
   'el 404 nombra la ruta que falló');
ok(explica(500, '', 'tomas/').includes('500'), 'el 500 se dice tal cual');

/* ── 9. rótulos ────────────────────────────────────────────────────────── */

ok(cifra(619) === '619.00' || cifra(619).replace(',', '.') === '619.00',
   'dos decimales', cifra(619));
ok(cifra(null) === '—', 'sin dato, raya');
ok(momentoLegible(null) === '—', 'sin fecha, raya');
ok(/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/.test(momentoLegible('2026-10-27T04:00:00')),
   'fecha y hora legibles', momentoLegible('2026-10-27T04:00:00'));

/* ── 10. que todo esto sirva de algo ───────────────────────────────────── */

/* Cada comprobación de arriba tiene que poder fallar. Las que más fácil se
 * rompen en silencio son las dos que sostienen el resto: el factor de
 * conversión y la negativa a dar por buena una respuesta que no se entiende. */
const factorMalo = (v) => v * 1;   // como si lo guardado ya fuese m3/h
ok(factorMalo(1000) !== 3600, 'sabotaje: con factor 1 el ancla de 3600 cae');

const tolerante = (x) => ({ ok: true, datos: { categorias: [], series: [] } });
ok(tolerante({ mensaje: 'hola' }).ok !== raro.ok,
   'sabotaje: un normalizador que lo acepta todo daría ok donde ahora da fallo');

const colorPorPuesto = (nombre, lista) => lista.indexOf(nombre);
ok(colorPorPuesto('10.5', filtrado) !== colorPorPuesto('10.5', catalogo),
   'sabotaje: atando el color al puesto, la 10.5 cambia al filtrar');

const malos = r.filter((x) => !x).length;
console.log(`\n${r.length - malos} de ${r.length} en orden${malos ? `, ${malos} MAL` : ''}.`);
process.exit(malos ? 1 : 0);
