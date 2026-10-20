/* El bloque "Programado" del modal de gestión, montado de verdad.
 *
 * Tres estados, que se eligen por la URL:
 *
 *   ?v=sin        el servidor responde pero la incidencia no tiene partidas
 *   ?v=con        tiene tres programadas, una pasada de saldo
 *   ?v=viejo      el servidor todavía no lleva el campo (parche sin aplicar)
 *   ?v=actividad  la OTRA rama del modal: una actividad de obra
 *   ?v=cerrada    la incidencia está cerrada: no se puede escribir
 *
 * El tercero importa tanto como los otros: es el estado real hasta que
 * alguien corra el parche, y tiene que decirlo en vez de salir vacío.
 *
 * EL CUARTO EXISTE POR UN FALLO QUE NO SE VEÍA. El modal pedía
 * /operations/actividades/<id>/, que es el CATÁLOGO operations.Actividad —los
 * tipos de trabajo—, no operations.ActividadObra, que es la actividad
 * programada y la que lleva las partidas. No daba 404: devolvía 200 con un
 * objeto sin `partidas`, así que el bloque se declaraba «no soportado» y
 * echaba la culpa al servidor. Aquí el doble responde las DOS rutas, y el
 * catálogo contesta justo lo que contestaba de verdad: un objeto sin
 * partidas. Si alguien vuelve al nombre corto, el bloque sale vacío y la
 * prueba lo dice.
 */
import { createRoot } from 'react-dom/client';
import GestionCosteo from '../../src/GestionCosteo';
import '../../src/Incidentes.css';

const v = new URLSearchParams(location.search).get('v') || 'con';

/* Un presupuesto como el real: dos obras, para que se note si el selector
 * del parte ofrece las de la otra. */
const PARTIDAS = [
  { id: 1, codigo: '01.02.01.01', descripcion: 'Movilizacion y desmovilizacion de maquinaria pesada', unidad: 'glb', metrado: 1, precio: 8500 },
  { id: 2, codigo: '01.02.01.02', descripcion: 'Trazo y replanteo', unidad: 'm2', metrado: 420, precio: 3.2 },
  { id: 3, codigo: '01.02.02.01', descripcion: 'Excavacion de material suelto', unidad: 'm3', metrado: 173, precio: 24.5 },
  { id: 4, codigo: '02.01.01.01', descripcion: 'Encofrado de muro (OTRA OBRA)', unidad: 'm2', metrado: 90, precio: 48 },
  { id: 5, codigo: '02.01.01.02', descripcion: 'Concreto f c=210 (OTRA OBRA)', unidad: 'm3', metrado: 36, precio: 420 },
];

/* El presupuesto de la incidencia, con la forma del expediente: títulos que
 * agrupan y partidas con metrado solo en las hojas. */
const DETALLE = [
  { id: 10, codigo: '01', descripcion: 'TRABAJOS PRELIMINARES',
    es_titulo: true, nivel: 1, unidad: '', metrado: null, precio: null,
    importe: 9844, valorizado: 1472, ejecutado: null, saldo: null, avance: null },
  { id: 1, codigo: '01.01', descripcion: 'Movilizacion y desmovilizacion de maquinaria pesada',
    es_titulo: false, nivel: 2,
    unidad: 'glb', metrado: 1, precio: 8500, importe: 8500, valorizado: 0,
    ejecutado: 0, saldo: 1, avance: 0 },
  { id: 2, codigo: '01.02', descripcion: 'Trazo y replanteo',
    es_titulo: false, nivel: 2,
    unidad: 'm2', metrado: 420, precio: 3.2, importe: 1344, valorizado: 1472,
    ejecutado: 460, saldo: -40, avance: 109.5 },
  { id: 20, codigo: '02', descripcion: 'OBRAS PROVISIONALES',
    es_titulo: true, nivel: 1, unidad: '', metrado: null, precio: null,
    importe: 4238.5, valorizado: 2450, ejecutado: null, saldo: null, avance: null },
  { id: 3, codigo: '02.01', descripcion: 'Excavacion de material suelto',
    es_titulo: false, nivel: 2,
    unidad: 'm3', metrado: 173, precio: 24.5, importe: 4238.5, valorizado: 2450,
    ejecutado: 100, saldo: 73, avance: 57.8 },
];

window.__ESPERADO = {
  partidas: PARTIDAS.length,
  programadas: DETALLE.length,
  titulos: DETALLE.filter(d => d.es_titulo).length,
  hojas: DETALLE.filter(d => !d.es_titulo).length,
  // La suma de las hojas: es lo que tiene que salir en la fila raíz.
  total: DETALLE.filter(d => !d.es_titulo).reduce((a, d) => a + d.importe, 0),
  valorizado: DETALLE.filter(d => !d.es_titulo)
    .reduce((a, d) => a + d.valorizado, 0),
  pasada: '01.02',
};
window.__PATCH = null;
/* Todas las URL pedidas, para poder afirmar a QUÉ ruta fue el modal. Sin
 * esto, "el bloque se ve" no distingue entre pedir la ruta correcta y pedir
 * otra que casualmente responda. */
window.__URLS = [];
window.__POST = null;
window.__PATCH_PARTIDA = null;

const json = (d, s = 200) => new Response(JSON.stringify(d),
  { status: s, headers: { 'Content-Type': 'application/json' } });

let detalle = (v === 'con' || v === 'actividad') ? [...DETALLE] : [];

const real = window.fetch;
window.fetch = async (u, opc = {}) => {
  const url = String(u);
  const metodo = (opc.method || 'GET').toUpperCase();
  window.__URLS.push(`${metodo} ${url}`);

  /* ── LAS PARTIDAS PROPIAS DE LA INCIDENCIA ──
   * El servidor correlativo: 01, 02, 03… dentro de la incidencia, y un 409
   * si la partida ya tiene metrado imputado en un parte. */
  const mPart = url.match(/\/incidentes\/\d+\/partidas\/(?:(\d+)\/)?$/);
  if (mPart) {
    const pid = mPart[1] ? Number(mPart[1]) : null;
    const devuelve = () => json({ id: 7, partidas: detalle.map(d => d.id),
                                  partidas_detalle: detalle });

    if (metodo === 'POST') {
      const c = JSON.parse(opc.body);
      window.__POST = c;
      const esTitulo = c.tipo === 'titulo';
      const faltan = {};
      if (!c.descripcion) faltan.descripcion = ['Hace falta la descripcion.'];
      if (!esTitulo && !c.unidad) faltan.unidad = ['Hace falta la unidad.'];
      if (Object.keys(faltan).length) return json(faltan, 400);

      const padre = c.padre ? detalle.find(d => String(d.id) === String(c.padre)) : null;
      if (c.padre && !padre) return json({ padre: ['No esta.'] }, 400);
      if (padre && !padre.es_titulo) {
        return json({ padre: [`Solo se puede colgar de un titulo. '${padre.codigo}' es una partida.`] }, 400);
      }
      /* El correlativo entre HERMANOS, mirando el mayor —no contando—, igual
       * que el servidor: contar devuelve un código repetido en cuanto se
       * borra uno de en medio. */
      const prefijo = padre ? `${padre.codigo}.` : '';
      const hondo = padre ? padre.nivel + 1 : 1;
      const mayor = detalle
        .filter(d => d.nivel === hondo && d.codigo.startsWith(prefijo))
        .reduce((a, d) => Math.max(a, parseInt(d.codigo.split('.').pop(), 10) || 0), 0);
      const codigo = prefijo + String(mayor + 1).padStart(2, '0');

      const fila = esTitulo
        ? { id: 900 + detalle.length, codigo, descripcion: c.descripcion,
            es_titulo: true, nivel: hondo, unidad: '', metrado: null,
            precio: null, importe: 0, valorizado: 0, ejecutado: null, saldo: null, avance: null }
        : { id: 900 + detalle.length, codigo, descripcion: c.descripcion,
            es_titulo: false, nivel: hondo, unidad: c.unidad,
            metrado: c.metrado, precio: c.precio,
            importe: c.metrado * c.precio, valorizado: 0,
            ejecutado: 0, saldo: c.metrado, avance: 0 };
      detalle = [...detalle, fila].sort((a, b) => a.codigo.localeCompare(b.codigo));
      return devuelve();
    }
    if (metodo === 'PATCH') {
      window.__PATCH_PARTIDA = { id: pid, ...JSON.parse(opc.body) };
      detalle = detalle.map(d => d.id === pid
        ? { ...d, ...JSON.parse(opc.body),
            saldo: JSON.parse(opc.body).metrado - d.ejecutado }
        : d);
      return devuelve();
    }
    if (metodo === 'DELETE') {
      const fila = detalle.find(d => d.id === pid);
      // Un título con algo colgando se llevaría por delante filas que no se
      // están mirando.
      const hijos = fila
        ? detalle.filter(d => d.codigo.startsWith(fila.codigo + '.')) : [];
      if (hijos.length) {
        return json({ detail: `No se puede quitar: '${fila.codigo}' tiene `
                              + `${hijos.length} fila(s) colgando. Quitalas primero.`,
                      hijos: hijos.length }, 409);
      }
      // La id 2 es la que lleva 460 ejecutados: tiene partes imputados.
      if (pid === 2) {
        return json({ detail: 'No se puede quitar: 3 parte(s) ya le imputaron '
                              + 'metrado. Si el metrado estaba mal, corrigelo '
                              + 'en la partida en vez de borrarla.',
                      partes: 3 }, 409);
      }
      detalle = detalle.filter(d => d.id !== pid);
      return devuelve();
    }
  }

  /* ── LA ACTIVIDAD DE OBRA: la ruta buena y la trampa ──
   * El orden importa: actividades-obra/ se mira ANTES, porque
   * /actividades/\d+/$ también casaría con ella si se probara primero. */
  if (/\/actividades-obra\/\d+\/$/.test(url)) {
    if (metodo === 'PATCH') {
      const ids = JSON.parse(opc.body).partidas;
      window.__PATCH = ids;
      detalle = ids.map(id => DETALLE.find(d => d.id === id));
      return json({ id: 7, partidas: ids, partidas_detalle: detalle });
    }
    return json({ id: 7, obra: 'CANAL LATERAL 10', nombre: 'Protección de canoa',
                  partidas: detalle.map(d => d.id), partidas_detalle: detalle });
  }
  /* El catálogo. Responde 200 y NO trae partidas: exactamente lo que hacía
   * de verdad cuando el modal pedía la ruta equivocada. */
  if (/\/actividades\/\d+\/$/.test(url)) {
    return json({ id: 7, nombre: 'Excavación', activo: true });
  }

  if (/\/incidentes\/\d+\/$/.test(url)) {
    if (v === 'viejo') return json({ id: 7, codigo: 'INCIDENTE-002' });  // sin el campo
    if (metodo === 'PATCH') {
      const ids = JSON.parse(opc.body).partidas;
      window.__PATCH = ids;
      detalle = ids.map(id => DETALLE.find(d => d.id === id)
        || { ...PARTIDAS.find(p => p.id === id), ejecutado: 0, saldo: PARTIDAS.find(p => p.id === id).metrado, avance: 0 });
      return json({ id: 7, partidas: ids, partidas_detalle: detalle });
    }
    return json({ id: 7, partidas: detalle.map(d => d.id), partidas_detalle: detalle });
  }
  if (url.includes('/partidas/')) return json(PARTIDAS);
  if (url.includes('/incidentes-cerrados/')) return json([]);
  // Lo demás: listas vacías, que el costeo no es lo que se prueba aquí.
  if (url.includes(real ? '/api/' : '/api/')) return json([]);
  return json([]);
};

createRoot(document.getElementById('app')).render(
  <GestionCosteo
    abierto
    sujeto={{ id: 7, titulo: 'INCIDENTE-002-14082026',
              subtitulo: 'Otros (Proteccion de Canoa 8) en CANAL LATERAL 10',
              detalle: 'C-08',
              /* Cerrada: los botones se ocultan, y el aviso tiene que decir
                 por qué en vez de invitar a escribir. */
              bloqueado: v === 'cerrada',
              textoCerrado: 'Incidencia cerrada' }}
    campoVinculo={v === 'actividad' ? 'actividad_obra' : 'incident_report'}
    onCerrar={() => {}}
    onCambio={() => {}}
  />
);
