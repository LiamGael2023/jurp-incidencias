/* El panel de equipos enlazados, montado de verdad.
 *
 *   ?v=mezcla   enlazados y liberados, y gente con la app vieja
 *   ?v=limpio   todos identifican su equipo: ya se puede bloquear
 *   ?v=viejo    el servidor todavía no tiene esta parte
 *   ?v=sinpermiso  usuario normal: el servidor responde 403
 */
import { createRoot } from 'react-dom/client';
import EquiposEnlazados from '../../src/EquiposEnlazados';

const v = new URLSearchParams(location.search).get('v') || 'mezcla';
localStorage.setItem('userToken', 'token-de-prueba');

const hace = (d) => new Date(Date.now() - d * 86400000).toISOString();

let FILAS = [
  { id: 1, usuario: 'jperez', nombre_usuario: 'Juan Pérez',
    equipo: 'Samsung SM-A135M', plataforma: 'android', device_id: 'a1b2…a7b8',
    desde: hace(40), ultimo_uso: hace(0), activo: true,
    liberado_por: null, liberado_en: null },
  { id: 2, usuario: 'mquispe', nombre_usuario: 'María Quispe',
    equipo: 'iPhone 12', plataforma: 'ios', device_id: 'ff01…9c3d',
    desde: hace(90), ultimo_uso: hace(45), activo: true,
    liberado_por: null, liberado_en: null },
  /* Una liberada: tiene que seguir legible, porque es el historial que
   * explica por que esa cuenta entro desde otro celular. */
  { id: 3, usuario: 'rsilva', nombre_usuario: 'Rosa Silva',
    equipo: 'Xiaomi Redmi 9', plataforma: 'android', device_id: '77aa…2b10',
    desde: hace(200), ultimo_uso: hace(120), activo: false,
    liberado_por: 'admin.soporte', liberado_en: hace(118) },
];

window.__LIBERADO = null;
window.__URLS = [];

const json = (d, s = 200) => new Response(JSON.stringify(d),
  { status: s, headers: { 'Content-Type': 'application/json' } });

window.fetch = async (u, opc = {}) => {
  const url = String(u);
  const metodo = (opc.method || 'GET').toUpperCase();
  window.__URLS.push(`${metodo} ${url}`);

  if (v === 'viejo') return json({ detail: 'Not found.' }, 404);
  /* Lo que ve un usuario de campo que abre esta pantalla: el servidor sabe
   * quién es y no le deja. Eso NO es la sesión, y el mensaje tiene que
   * decirlo —mandarlo a volver a entrar lo hace salir y entrar para nada. */
  if (v === 'sinpermiso') {
    return json({ detail: 'No tiene permiso para realizar esta acción.',
                  codigo: 'permission_denied' }, 403);
  }

  const mLib = url.match(/\/dispositivos\/(\d+)\/liberar\/$/);
  if (mLib && metodo === 'POST') {
    const id = Number(mLib[1]);
    window.__LIBERADO = id;
    FILAS = FILAS.map(f => f.id === id
      ? { ...f, activo: false, liberado_por: 'yo.mismo', liberado_en: new Date().toISOString() }
      : f);
    return json({ ok: true });
  }

  if (url.includes('/dispositivos/')) {
    const estado = (url.match(/estado=(\w+)/) || [])[1] || 'activos';
    const filas = estado === 'todos' ? FILAS
      : estado === 'liberados' ? FILAS.filter(f => !f.activo)
      : FILAS.filter(f => f.activo);
    return json({ sin_identificar: v === 'limpio' ? 0 : 12, resultados: filas });
  }
  return json([]);
};

createRoot(document.getElementById('app')).render(<EquiposEnlazados />);
