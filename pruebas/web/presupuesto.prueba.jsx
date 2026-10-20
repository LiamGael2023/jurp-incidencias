/* El presupuesto de un proyecto, montado de verdad.
 *
 *   ?v=importado   un Excel cargado cuyo pie NO cuadra con sus partidas
 *   ?v=cuadra      el mismo, con el pie cuadrando: no debe avisar de nada
 *   ?v=vacio       un proyecto sin presupuesto, con el alta habilitada
 *   ?v=viejo       el servidor no tiene la ruta de alta todavía
 *
 * El tercero es el estado real hasta que alguien corra el parche, y tiene
 * que decirlo en vez de ofrecer botones que devuelven 404.
 */
import { createRoot } from 'react-dom/client';
import PresupuestoProyecto from '../../src/PresupuestoProyecto';
import '../../src/PresupuestoProyecto.css';

const v = new URLSearchParams(location.search).get('v') || 'importado';

const ruta = (...p) => JSON.stringify(p);

/* Como lo devuelve el servidor: lista plana, con la ruta de ancestros que
 * dejó el importador. Los títulos NO son filas. */
const IMPORTADO = [
  { id: 1, codigo: '01.01.01', descripcion: 'Movilizacion y desmovilizacion',
    unidad: 'glb', metrado: 1, precio: 5000, ejecutado: 0,
    ruta: ruta(['01', 'ESTRUCTURAS DE TRATAMIENTO'], ['01.01', 'TRABAJOS PRELIMINARES']) },
  { id: 2, codigo: '01.01.02', descripcion: 'Trazo y replanteo durante obra',
    unidad: 'mes', metrado: 3, precio: 6207, ejecutado: 1,
    ruta: ruta(['01', 'ESTRUCTURAS DE TRATAMIENTO'], ['01.01', 'TRABAJOS PRELIMINARES']) },
  { id: 3, codigo: '01.02.01', descripcion: 'Almacen provisional de la obra',
    unidad: 'm2', metrado: 24, precio: 102.67, ejecutado: 24,
    ruta: ruta(['01', 'ESTRUCTURAS DE TRATAMIENTO'], ['01.02', 'OBRAS PROVISIONALES']) },
];

window.__ESPERADO = {
  hojas: IMPORTADO.length,
  titulos: 3,                       // 01, 01.01, 01.02
  importe: 5000 + 18621 + 2464.08,
  valorizado: 0 + 6207 + 2464.08,
};
window.__POST = null;
window.__URLS = [];

const json = (d, s = 200) => new Response(JSON.stringify(d),
  { status: s, headers: { 'Content-Type': 'application/json' } });

let partidas = v === 'vacio' ? [] : [...IMPORTADO];

window.fetch = async (u, opc = {}) => {
  const url = String(u);
  const metodo = (opc.method || 'GET').toUpperCase();
  window.__URLS.push(`${metodo} ${url}`);

  if (/\/partidas\/\?obra=/.test(url)) {
    return json({ obra: 'Obras10_6', total: partidas.length, partidas });
  }
  /* La sonda: un GET contra la ruta de alta responde 405 si existe -solo
   * admite POST- y 404 si no. Así se distingue sin escribir nada. */
  const mAlta = url.match(/\/proyectos\/\d+\/partidas\/(?:(\d+)\/)?$/);
  if (mAlta) {
    if (v === 'viejo') return json({ detail: 'Not found.' }, 404);
    if (metodo === 'GET') return json({ detail: 'Method not allowed.' }, 405);
    if (metodo === 'POST') {
      const c = JSON.parse(opc.body);
      window.__POST = c;
      if (!c.descripcion) return json({ descripcion: ['Hace falta.'] }, 400);
      if (c.tipo !== 'titulo' && !c.unidad) return json({ unidad: ['Hace falta.'] }, 400);
      const padre = c.padre ? partidas.find(p => String(p.id) === String(c.padre)) : null;
      const prefijo = padre ? `${padre.codigo}.` : '';
      const hondo = prefijo ? prefijo.split('.').filter(Boolean).length + 1 : 1;
      const mayor = partidas
        .filter(p => p.codigo.startsWith(prefijo)
                  && p.codigo.split('.').filter(Boolean).length === hondo)
        .reduce((a, p) => Math.max(a, parseInt(p.codigo.split('.').pop(), 10) || 0), 0);
      partidas = [...partidas, {
        id: 900 + partidas.length,
        codigo: prefijo + String(mayor + 1).padStart(2, '0'),
        descripcion: c.descripcion,
        es_titulo: c.tipo === 'titulo',
        unidad: c.unidad || '', metrado: c.metrado || 0, precio: c.precio || 0,
        ejecutado: 0,
        ruta: padre ? ruta([padre.codigo, padre.descripcion]) : '[]',
      }];
      return json({ ok: true }, 201);
    }
    if (metodo === 'DELETE') {
      partidas = partidas.filter(p => String(p.id) !== mAlta[1]);
      return json({ ok: true });
    }
    if (metodo === 'PATCH') {
      const c = JSON.parse(opc.body);
      partidas = partidas.map(p => String(p.id) === mAlta[1] ? { ...p, ...c } : p);
      return json({ ok: true });
    }
  }
  return json([]);
};

createRoot(document.getElementById('app')).render(
  <PresupuestoProyecto
    abierto
    proyecto={{ id: 5, codigo: 'Obras10_6',
      nombre: 'CONSTRUCCION Y MEJORAMIENTO DE OBRAS DE TRATAMIENTO DE AGUA EN TOMA 10.6',
      /* El pie del Excel. En 'importado' declara 3 621 de mas que lo que
       suman sus partidas: ese es el caso que hay que ver, porque una suma
       que no cuadra con el pie significa que falta una partida o que se
       leyo una columna que no era. En 'cuadra' coincide, y entonces no
       debe avisar de nada. */
    costo_directo: v === 'importado' ? 29706.08
                 : v === 'cuadra' ? 26085.08 : 0 }}
    onCerrar={() => {}}
    onCambio={() => {}}
  />
);
