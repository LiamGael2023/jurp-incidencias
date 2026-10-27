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

/* El resumen, copiado de su captura: la 10.2 muy baja, la 10.6/7 baja y el
 * resto en su nivel. Los caudales en l/s, que es como se guardan. */
const RESUMEN = [
  { id: 1, nombre: '10.2', estado_poza: 'Muy bajo', caudal_salida: '130.00',
    desnivel_sedimentador: '5.00', turbidez_salida: '197.00',
    ultima_lectura: '2026-10-26T16:00:00' },
  { id: 2, nombre: '10.3 A', estado_poza: 'En su nivel', caudal_salida: '60.00',
    desnivel_sedimentador: '0.00', turbidez_salida: '8.23',
    ultima_lectura: '2026-10-26T16:00:00' },
  { id: 3, nombre: '10.4', estado_poza: 'En su nivel', caudal_salida: '100.00',
    desnivel_sedimentador: '0.00', turbidez_salida: '25.80',
    ultima_lectura: '2026-10-27T04:00:00' },
  { id: 5, nombre: '10.5', estado_poza: 'En su nivel', caudal_salida: '200.00',
    desnivel_sedimentador: '0.00', turbidez_salida: '15.50',
    ultima_lectura: '2026-10-27T04:00:00' },
  { id: 7, nombre: '10.6/7', estado_poza: 'Bajo', caudal_salida: '619.00',
    desnivel_sedimentador: '0.80', turbidez_salida: '16.30',
    ultima_lectura: '2026-10-27T04:00:00' },
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

const SERIES = {
  caudal_ingreso: TOMAS.map((t, i) => serieDe(t.nombre, 100 + i * 50)),
  caudal_salida: TOMAS.map((t, i) => serieDe(t.nombre, 60 + i * 40)),
  caudal_excedencia: [serieDe('10.6/7', 200)],
  caudal_total: [serieDe('Q. de captación', 1000), serieDe('Q. entrega al Usuario', 900),
    serieDe('Excedencia 10.6/7', 100)],
  /* Calidad de Agua. El canal va muy por encima de las tomas —197 NTU
   * contra 8–26—, que es justo la diferencia que el gráfico viejo esconde
   * poniéndole un segundo eje. */
  turbidez_salida: TOMAS.map((t, i) => serieDe(t.nombre, 8 + i * 3)),
  turbidez_canal: [serieDe('Canal L10', 190)],
  dosaje_floculante: TOMAS.map((t, i) => serieDe(t.nombre, 1 + i * 0.3)),
  dosaje_c_organico: TOMAS.map((t, i) => serieDe(t.nombre, 2 + i * 0.2)),
  dosaje_sulfato_ferrico: TOMAS.map((t, i) => serieDe(t.nombre, 0.5 + i * 0.1)),

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
    const s = SERIES[q.get('metrica')];
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
