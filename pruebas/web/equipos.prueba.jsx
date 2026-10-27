/* La pantalla de usuarios, montada de verdad.
 *
 *   ?v=mezcla      PLUVIRA: usuarios con y sin equipo enlazado
 *   ?v=limpio      todos identifican su equipo: ya se puede bloquear
 *   ?v=viejo       el servidor todavía no tiene esta parte (404)
 *   ?v=sinpermiso  no eres de Gerencia (403 en usuarios)
 *   ?v=sinequipos  eres de Gerencia pero no admin del servidor (403 en equipos)
 *   ?v=sentria     SENTRIA: mismo contrato, sin equipos enlazados
 *
 * POR QUE SE REHIZO. Este banco simulaba solo el endpoint de equipos, de
 * cuando la pantalla listaba enlaces. Cuando pasó a listar USUARIOS —con su
 * rol, su clave y su estado— nadie actualizó el banco, así que la prueba
 * seguía ahí pero ya no probaba la pantalla: fallaba al primer `innerText`.
 * Una prueba que nadie corre no avisa de nada, y una que corre contra un
 * contrato viejo es peor, porque parece que sí.
 */
import { createRoot } from 'react-dom/client';
import EquiposEnlazados from '../../src/EquiposEnlazados';
import { alFallar } from '../../src/sesion';

/* Los avisos globales que dispara pedir(). La pantalla explica el 403 con su
 * propio mensaje; si además se avisa por aquí, el usuario ve dos carteles
 * que dicen lo mismo y uno peor. */
window.__AVISOS = [];
alFallar(a => window.__AVISOS.push(a.motivo));

const v = new URLSearchParams(location.search).get('v') || 'mezcla';
localStorage.setItem('userToken', 'token-de-prueba');

const hace = (d) => new Date(Date.now() - d * 86400000).toISOString();

const ROLES = [
  { code: 'mobile_gerencia', label: 'Gerencia' },
  { code: 'vigilante_group', label: 'Vigilante' },
  { code: 'operador_group', label: 'Operador' },
  { code: 'supervisor_group', label: 'Supervisor' },
];

let USUARIOS = [
  { id: 1, username: 'jperez', first_name: 'Juan', last_name: 'Pérez',
    email: 'jperez@jurp.pe', is_active: true,
    role: 'vigilante_group', role_label: 'Vigilante', last_login: hace(0) },
  { id: 2, username: 'mquispe', first_name: 'María', last_name: 'Quispe',
    email: '', is_active: true,
    role: 'supervisor_group', role_label: 'Supervisor', last_login: hace(45) },
  /* Sin equipo y sin haber entrado nunca. Es el caso que antes NO se veía,
   * cuando la fila era el enlace: se creaba la cuenta y no aparecía. */
  { id: 3, username: 'rsilva', first_name: 'Rosa', last_name: 'Silva',
    email: '', is_active: true,
    role: 'operador_group', role_label: 'Operador', last_login: null },
  { id: 4, username: 'ccastro', first_name: 'Carlos', last_name: 'Castro',
    email: '', is_active: false,
    role: 'vigilante_group', role_label: 'Vigilante', last_login: hace(200) },
];

let EQUIPOS = [
  { id: 11, usuario: 'jperez', equipo: 'Samsung SM-A135M', plataforma: 'android',
    device_id: 'a1b2…a7b8', desde: hace(40), ultimo_uso: hace(0), activo: true,
    liberado_por: null, liberado_en: null },
  { id: 12, usuario: 'mquispe', equipo: 'iPhone 12', plataforma: 'ios',
    device_id: 'ff01…9c3d', desde: hace(90), ultimo_uso: hace(45), activo: true,
    liberado_por: null, liberado_en: null },
  /* Una liberada: tiene que seguir legible, porque es el historial que
   * explica por qué esa cuenta entró desde otro celular. */
  { id: 13, usuario: 'ccastro', equipo: 'Xiaomi Redmi 9', plataforma: 'android',
    device_id: '77aa…2b10', desde: hace(200), ultimo_uso: hace(120),
    activo: false, liberado_por: 'admin.soporte', liberado_en: hace(118) },
];

window.__LIBERADO = null;
window.__CREADO = null;
window.__ROL = null;
window.__ACTIVIDAD = null;
window.__URLS = [];

const json = (d, s = 200) => new Response(JSON.stringify(d),
  { status: s, headers: { 'Content-Type': 'application/json' } });

window.fetch = async (u, opc = {}) => {
  const url = String(u);
  const metodo = (opc.method || 'GET').toUpperCase();
  const cuerpo = opc.body ? JSON.parse(opc.body) : null;
  window.__URLS.push(`${metodo} ${url}`);

  /* ── usuarios ── */
  if (url.includes('/users/')) {
    if (v === 'viejo') return json({ detail: 'Not found.' }, 404);
    if (v === 'sinpermiso') {
      return json({ detail: 'Tu usuario no pertenece a Gerencia.',
                    codigo: 'sin_permiso' }, 403);
    }
    if (url.endsWith('/roles/')) return json({ results: ROLES });
    if (url.endsWith('/list/')) return json({ results: USUARIOS });

    const mRol = url.match(/\/users\/(\d+)\/role\/$/);
    if (mRol && metodo === 'POST') {
      const id = Number(mRol[1]);
      /* EL ENCIERRO, tal como lo responde el servidor: 409 con su motivo.
       * Es el caso que no se puede probar con datos de mentira si la
       * pantalla se traga el cuerpo del error. */
      if (id === 2 && cuerpo.role !== 'mobile_gerencia' && v === 'mezcla'
          && USUARIOS.find(x => x.id === 2).role === 'mobile_gerencia') {
        return json({ detail: 'Es la unica cuenta de Gerencia.',
                      codigo: 'encierro' }, 409);
      }
      window.__ROL = { id, role: cuerpo.role };
      const r = ROLES.find(x => x.code === cuerpo.role);
      USUARIOS = USUARIOS.map(x => x.id === id
        ? { ...x, role: cuerpo.role, role_label: r ? r.label : '' } : x);
      return json({ ok: true });
    }

    const mAct = url.match(/\/users\/(\d+)\/toggle-active\/$/);
    if (mAct && metodo === 'POST') {
      const id = Number(mAct[1]);
      window.__ACTIVIDAD = id;
      USUARIOS = USUARIOS.map(x => x.id === id
        ? { ...x, is_active: !x.is_active } : x);
      return json({ ok: true });
    }

    const mCla = url.match(/\/users\/(\d+)\/reset-password\/$/);
    if (mCla && metodo === 'POST') {
      return json({ ok: true, credentials: {
        username: USUARIOS.find(x => x.id === Number(mCla[1])).username,
        password: 'Kj7mN4pQxR', role_label: 'Vigilante' } });
    }

    const mEd = url.match(/\/users\/(\d+)\/update\/$/);
    if (mEd && metodo === 'POST') {
      const id = Number(mEd[1]);
      USUARIOS = USUARIOS.map(x => x.id === id ? { ...x, ...cuerpo } : x);
      return json({ ok: true });
    }

    if (metodo === 'POST') {
      window.__CREADO = cuerpo;
      const r = ROLES.find(x => x.code === cuerpo.role);
      USUARIOS = [...USUARIOS, {
        id: 99, ...cuerpo, is_active: true,
        role_label: r ? r.label : '', last_login: null,
      }];
      return json({ ok: true, credentials: {
        username: cuerpo.username, password: 'Kj7mN4pQxR',
        role_label: r ? r.label : '' } }, 201);
    }
    return json({ results: [] });
  }

  /* ── equipos ── */
  if (url.includes('/dispositivos/')) {
    if (v === 'sinequipos') {
      return json({ detail: 'No tienes permiso.' }, 403);
    }
    const mLib = url.match(/\/dispositivos\/(\d+)\/liberar\/$/);
    if (mLib && metodo === 'POST') {
      const id = Number(mLib[1]);
      window.__LIBERADO = id;
      EQUIPOS = EQUIPOS.map(f => f.id === id
        ? { ...f, activo: false, liberado_por: 'yo.mismo',
            liberado_en: new Date().toISOString() }
        : f);
      return json({ ok: true });
    }
    return json({ sin_identificar: v === 'limpio' ? 0 : 12,
                  resultados: EQUIPOS });
  }

  return json([]);
};

/* SENTRIA usa la misma pantalla con otro servidor y sin equipos. Que sea el
 * mismo componente es el punto: si se duplicara, esta prueba no diría nada
 * del otro. */
const props = v === 'sentria'
  ? { apiUsuarios: '/vigapi/mobile/users/', apiEquipos: null,
      sistema: 'SENTRIA' }
  : {};

createRoot(document.getElementById('app')).render(<EquiposEnlazados {...props} />);
