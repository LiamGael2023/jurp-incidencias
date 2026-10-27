/* El armazón de las pantallas de HYDROMETRIX para medirlas en el navegador.
 *
 * Lo monta `hydro.prueba.mjs`. Aquí solo se finge el servidor y se pone la
 * pantalla dentro del mismo marco que en producción: `.maq` con el rail
 * flotando encima.
 */
import { createRoot } from 'react-dom/client';
import HydroDistribucion from '../../src/HydroDistribucion';
import HydroCalidad from '../../src/HydroCalidad';
import '../../src/MaquinariaGIS.css';

const json = (x) => Promise.resolve({
  ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(x)),
});

/* Las siete tomas de verdad, con los nombres que salen en sus pantallas. */
const TOMAS = [
  { id: 1, nombre: '10.2' }, { id: 2, nombre: '10.3 A' },
  { id: 3, nombre: '10.4' }, { id: 4, nombre: '10.4 A' },
  { id: 5, nombre: '10.5' }, { id: 6, nombre: '10.5 A' },
  { id: 7, nombre: '10.6/7' },
];

/* El resumen, CON LOS NOMBRES DE CAMPO DE VERDAD —copiados de una respuesta
 * del servidor, no inventados—. Durante un rato estuvieron adivinados y
 * los tres que importan fallaban: el caudal es `caudal_salida_reciente`, la
 * turbidez lleva `_poza` detrás y la fecha es `last_timestamp`. Con los
 * nombres de mentira esta prueba pasaba y la pantalla no funcionaba.
 *
 * Los valores son los de su captura: la 10.2 muy baja, la 10.6/7 baja y el
 * resto en su nivel. Los caudales en l/s, que es como se guardan. */
const resumen = (toma, estado, caudal, nivel, turbidez, cuando, extra) => ({
  toma,
  estado_poza: estado,
  caudal_salida_reciente: caudal,
  nivel_poza: nivel,
  turbidez_salida_poza: turbidez,
  last_timestamp: cuando,
  turno: 'Diurno',
  nombre_operario: 'José Paredes',
  completion: { expected: 23, percentage: 100, received: 23 },
  missing_fields: [],
  ...(extra || {}),
});

const RESUMEN = [
  resumen('10.2', 'Muy bajo', 130, 5, 197, '2026-10-26T16:00:00-05:00'),
  resumen('10.3 A', 'En su nivel', 60, 0, 8.23, '2026-10-26T16:00:00-05:00'),
  resumen('10.4', 'En su nivel', 100, 0, 25.8, '2026-10-27T04:00:00-05:00'),
  resumen('10.5', 'En su nivel', 200, 0, 15.5, '2026-10-27T04:00:00-05:00'),
  /* Esta trae el día a medias: es la que comprueba que la tarjeta lo diga
   * en vez de enseñar los números como si estuvieran completos. */
  resumen('10.6/7', 'Bajo', 619, 0.8, 16.3, '2026-10-27T04:00:00-05:00', {
    completion: { expected: 23, percentage: 61, received: 14 },
    missing_fields: ['caudal_salida_poza'],
  }),
];

/* Las series llegan en la forma (b) —una serie por toma, con sus puntos—,
 * y A PROPOSITO con las horas desordenadas y un hueco: es lo que obliga al
 * eje a ordenarse y al hueco a quedarse en hueco. */
const horas = ['01:00', '02:00', '03:00', '04:00'];
const serieDe = (nombre, base) => ({
  toma: nombre,
  puntos: [
    { hora: '03:00', valor: base + 20 },
    { hora: '01:00', valor: base },
    // las 02:00 faltan en la 10.2, para ver el hueco
    ...(nombre === '10.2' ? [] : [{ hora: '02:00', valor: base + 10 }]),
    { hora: '04:00', valor: base + 30 },
  ],
});

/* Las claves son los nombres que el servidor dijo aceptar al rechazar uno
 * inventado. No hay «caudal_total»: por eso la captación y la entrega se
 * suman en el navegador, y por eso esa suma se prueba aparte. */
const SERIES = {
  caudal_ingreso_poza: TOMAS.map((t, i) => serieDe(t.nombre, 100 + i * 50)),
  caudal_salida_poza: TOMAS.map((t, i) => serieDe(t.nombre, 60 + i * 40)),
  caudal_excedencia: [serieDe('10.6/7', 200)],
  /* Calidad de Agua. El canal va muy por encima de las tomas —197 NTU
   * contra 8–26—, que es justo la diferencia que el gráfico viejo esconde
   * poniéndole un segundo eje. */
  turbidez_salida_poza: TOMAS.map((t, i) => serieDe(t.nombre, 8 + i * 3)),
  turbidez_canal: [serieDe('Canal L10', 190)],
  ppm_floculante: TOMAS.map((t, i) => serieDe(t.nombre, 1 + i * 0.3)),
  ppm_c_organico: TOMAS.map((t, i) => serieDe(t.nombre, 2 + i * 0.2)),
  ppm_sulfato_ferrico: TOMAS.map((t, i) => serieDe(t.nombre, 0.5 + i * 0.1)),
};

window.localStorage.setItem('userToken', 'ficticio');

window.fetch = async (u) => {
  const url = String(u);
  if (url.includes('operadores/tomas/status-summary/')) return json({ results: RESUMEN });
  if (url.includes('operadores/tomas/')) return json({ results: TOMAS });
  if (url.includes('operadores/volumes/by-month/')) {
    return json({ results: [{ mes: 'Septiembre', volumen: 270000 },
      { mes: 'Octubre', volumen: 240000 }] });
  }
  /* Esta ruta responde A PROPOSITO con otra forma: es la que comprueba que
   * un panel que no entiende la respuesta lo diga, en vez de dibujar un
   * lienzo en blanco que se leería como «no hubo volumen». */
  if (url.includes('operadores/volumes/by-toma/')) {
    return json({ mensaje: 'sin implementar', detalle_raro: 1 });
  }
  if (url.includes('operadores/series/')) {
    const q = new URL(url, 'http://x').searchParams;
    /* `metric`, como lo pide el servidor. Si la pantalla volviera a mandar
     * `metrica`, aquí no encontraria nada y los graficos saldrian vacios:
     * es lo que paso de verdad, y asi se nota. */
    const s = SERIES[q.get('metric')];
    if (!Array.isArray(s)) return json(s || { results: [] });
    /* EL FILTRO TIENE QUE FILTRAR DE VERDAD. Si este servidor de mentira
     * devolviera siempre las siete tomas, la comprobación de que el color
     * de la 10.5 no cambia al filtrar pasaría sin haber filtrado nada:
     * nunca habría otra serie ocupando su puesto. */
    const pedidas = (q.get('tomas') || '').split(',').filter(Boolean);
    if (!pedidas.length) return json({ results: s });
    const nombres = pedidas
      .map((id) => TOMAS.find((t) => String(t.id) === id)?.nombre)
      .filter(Boolean);
    return json({ results: s.filter((x) => nombres.includes(x.toma)) });
  }
  return json({ results: [] });
};

/* El armazón de verdad: .maq con el rail flotando encima. No se monta
 * RailGIS porque lo que se mide es el hueco que le deja la pantalla, no el
 * rail en sí; sin él vale el ancho por defecto de --rail-w. */
const raiz = document.getElementById('app');
const maq = document.createElement('div');
maq.className = 'maq';
const main = document.createElement('div');
main.className = 'maq-main';
maq.appendChild(main);
raiz.appendChild(maq);

/* `?v=calidad` monta la otra pantalla. Comparten casi todas las piezas,
 * pero montarla aunque sea una vez es lo que separa «las piezas funcionan»
 * de «la pantalla arranca»: el fallo que ya nos pasó —un nombre sin
 * importar— no rompe las piezas, deja la pantalla en blanco. */
const cual = new URL(window.location.href).searchParams.get('v');
createRoot(main).render(cual === 'calidad' ? <HydroCalidad /> : <HydroDistribucion />);

export { horas };
