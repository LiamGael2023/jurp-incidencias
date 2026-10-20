/* El bloque "Programado" del modal de gestión, montado de verdad.
 *
 * Tres estados, que se eligen por la URL:
 *
 *   ?v=sin        el servidor responde pero la incidencia no tiene partidas
 *   ?v=con        tiene tres programadas, una pasada de saldo
 *   ?v=viejo      el servidor todavía no lleva el campo (parche sin aplicar)
 *   ?v=actividad  la OTRA rama del modal: una actividad de obra
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

const DETALLE = [
  { id: 1, codigo: '01.02.01.01', descripcion: 'Movilizacion y desmovilizacion de maquinaria pesada',
    unidad: 'glb', metrado: 1, precio: 8500, ejecutado: 0, saldo: 1, avance: 0 },
  { id: 3, codigo: '01.02.02.01', descripcion: 'Excavacion de material suelto',
    unidad: 'm3', metrado: 173, precio: 24.5, ejecutado: 100, saldo: 73, avance: 57.8 },
  { id: 2, codigo: '01.02.01.02', descripcion: 'Trazo y replanteo',
    unidad: 'm2', metrado: 420, precio: 3.2, ejecutado: 460, saldo: -40, avance: 109.5 },
];

window.__ESPERADO = { partidas: PARTIDAS.length, programadas: DETALLE.length,
                      pasada: '01.02.01.02' };
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
      const faltan = {};
      if (!c.descripcion) faltan.descripcion = ['Hace falta la descripcion.'];
      if (!c.unidad) faltan.unidad = ['Hace falta la unidad.'];
      if (Object.keys(faltan).length) return json(faltan, 400);
      // El mayor que ya hay, no cuántas son: igual que el servidor.
      const mayor = detalle.reduce(
        (a, d) => Math.max(a, parseInt(d.codigo, 10) || 0), 0);
      detalle = [...detalle, {
        id: 900 + detalle.length, codigo: String(mayor + 1).padStart(2, '0'),
        descripcion: c.descripcion, unidad: c.unidad,
        metrado: c.metrado, precio: c.precio,
        ejecutado: 0, saldo: c.metrado, avance: 0,
      }];
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
              detalle: 'C-08' }}
    campoVinculo={v === 'actividad' ? 'actividad_obra' : 'incident_report'}
    onCerrar={() => {}}
    onCambio={() => {}}
  />
);
