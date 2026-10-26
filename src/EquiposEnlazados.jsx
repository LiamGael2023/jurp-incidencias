/**
 * Usuarios y equipos: quién tiene cuenta, con qué rol, y desde qué celular.
 *
 * POR QUE ESTAN JUNTOS. Antes esta pantalla listaba solo equipos enlazados,
 * y la gestión de usuarios vivía únicamente en la app móvil. Pero las dos
 * cosas se hacen en el mismo momento y sobre la misma persona: se crea la
 * cuenta, se le da un rol, y cuando cambia de celular hay que liberarla.
 * Tenerlas en pantallas distintas -o en aplicaciones distintas- obligaba a
 * saltar de una a otra para una sola gestión.
 *
 * LA LISTA ES DE USUARIOS, NO DE EQUIPOS. Es el cambio importante. Antes la
 * fila era el enlace, así que quien todavía no había entrado desde un
 * celular sencillamente no existía en la pantalla: se creaba un usuario y no
 * aparecía por ningún lado. Ahora la fila es la persona y el equipo es una
 * columna, que puede estar vacía.
 *
 * DOS PERMISOS DISTINTOS, A PROPOSITO DEL SERVIDOR. Gestionar usuarios lo
 * autoriza el grupo mobile_gerencia; ver los equipos enlazados exige
 * is_staff. No son el mismo permiso y no se pueden fusionar desde aquí, así
 * que la pantalla carga las dos cosas por separado y funciona con lo que
 * tenga: si falta el permiso de equipos, se muestran los usuarios igual y se
 * dice por qué falta la columna. Lo contrario -no mostrar nada porque una de
 * las dos llamadas falló- escondía la mitad útil de la pantalla.
 *
 * LA CLAVE NO SE ELIGE, SE GENERA. El servidor crea una aleatoria y la
 * devuelve UNA SOLA VEZ, en la respuesta de crear o de resetear. No hay
 * forma de volver a verla. Por eso aparece en un diálogo que hay que cerrar
 * a conciencia y con un botón de copiar: si se pierde, el único remedio es
 * resetear otra vez.
 *
 * RESETEAR Y CAMBIAR DE ROL CIERRAN SESION. El servidor borra el token de
 * esa persona. Se avisa antes, porque hacerlo a alguien que está en campo
 * llenando un parte le tira el trabajo.
 *
 * LIBERAR NO BORRA. Desactiva el enlace y queda firmado quién lo hizo y
 * cuándo. Un campo en el usuario solo sabría dónde está ahora; la tabla sabe
 * por dónde pasó, que es lo que hace falta cuando alguien dice «me liberaron
 * y sigo sin poder entrar», y lo que permite ver si alguien libera de más.
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  FaMobileAlt, FaSearch, FaSyncAlt, FaUnlock, FaExclamationTriangle,
  FaCheckCircle, FaHistory, FaUserPlus, FaKey, FaUserSlash, FaUserCheck,
  FaUserTag,
} from 'react-icons/fa';
import Swal from 'sweetalert2';
import { pedir } from './sesion';
import './EquiposEnlazados.css';

const API_EQUIPOS = '/api/v1/mobile/auth/dispositivos/';
const API_USUARIOS = '/api/v1/mobile/users/';

const fecha = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—'
    : d.toLocaleString('es-PE', { day: '2-digit', month: '2-digit',
        year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

/* Cuánto hace del último uso. Un «hace 40 días» dice más que una fecha
 * cuando lo que se decide es si ese enlace sigue vivo o quedó colgado. */
const desdeHace = (iso) => {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  const dias = Math.floor((Date.now() - t) / 86400000);
  if (dias <= 0) return 'hoy';
  if (dias === 1) return 'ayer';
  /* Los días se enseñan hasta los tres meses. Antes se pasaba a meses a los
   * 30, y entonces "hace 45 días" salía como "hace un mes": para decidir si
   * un enlace quedó colgado, el número de días dice bastante más. */
  if (dias < 90) return `hace ${dias} días`;
  const m = Math.round(dias / 30);
  return `hace ${m} meses`;
};

const FILTROS = [
  { clave: 'todos', texto: 'Todos' },
  { clave: 'activos', texto: 'Activos' },
  { clave: 'inactivos', texto: 'Inactivos' },
  { clave: 'enlazados', texto: 'Con equipo' },
  { clave: 'sinequipo', texto: 'Sin equipo' },
];

/* Escapar antes de meter nada en el html de un diálogo. Los nombres los
 * teclea una persona, y un apellido con un `<` no debería poder inyectar
 * marcado en la pantalla de quien administra. */
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

/**
 * Enseña la credencial recién generada. Es la única vez que se puede ver.
 */
async function mostrarCredenciales(cred, titulo) {
  const usuario = esc(cred.username);
  const clave = esc(cred.password);
  await Swal.fire({
    icon: 'success',
    title: titulo,
    html:
      `<div style="text-align:left;line-height:1.7">
         <div><b>Usuario:</b> <code>${usuario}</code></div>
         <div><b>Clave:</b> <code id="eqe-clave">${clave}</code></div>
         ${cred.role_label ? `<div><b>Rol:</b> ${esc(cred.role_label)}</div>` : ''}
       </div>
       <p style="margin-top:14px;font-size:.9em;color:#b45309">
         Esta clave no se vuelve a mostrar. Cópiala y entrégasela ahora;
         si se pierde, habrá que generar otra.
       </p>`,
    confirmButtonText: 'Ya la copié',
    showCancelButton: true,
    cancelButtonText: 'Copiar al portapapeles',
    cancelButtonColor: '#2563eb',
    allowOutsideClick: false,
    allowEscapeKey: false,
    preConfirm: () => true,
  }).then((r) => {
    if (r.dismiss === Swal.DismissReason.cancel) {
      try {
        navigator.clipboard.writeText(`${cred.username} / ${cred.password}`);
      } catch (e) { /* sin portapapeles: queda el texto a la vista */ }
      /* Se vuelve a abrir: copiar no es cerrar, y cerrar sin querer es
       * perder la clave para siempre. */
      return mostrarCredenciales(cred, titulo);
    }
    return null;
  });
}

export default function EquiposEnlazados() {
  const [usuarios, setUsuarios] = useState([]);
  const [equipos, setEquipos] = useState([]);
  const [roles, setRoles] = useState([]);
  const [sinIdentificar, setSinIdentificar] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [fallo, setFallo] = useState('');
  const [sinEquipos, setSinEquipos] = useState('');     // por qué falta la columna
  const [soporte, setSoporte] = useState('probando');   // 'ok' | 'no-soportado'
  const [busca, setBusca] = useState('');
  const [filtro, setFiltro] = useState('todos');
  /* El rol va en desplegable y no en chips como los demas filtros: los roles
   * los define el servidor y pueden crecer, y cuatro chips mas en esa barra
   * la parten en dos lineas. */
  const [rol, setRol] = useState('');
  const [ocupado, setOcupado] = useState(null);         // id de la fila en curso

  const cargar = useCallback(async () => {
    setCargando(true); setFallo(''); setSinEquipos('');

    /* Las dos llamadas van en paralelo y se juzgan por separado: tienen
     * permisos distintos en el servidor y una puede fallar sin la otra. */
    const [u, e, r] = await Promise.all([
      pedir(`${API_USUARIOS}list/`),
      pedir(`${API_EQUIPOS}?estado=todos`),
      pedir(`${API_USUARIOS}roles/`),
    ]);
    setCargando(false);

    if (!u.ok) {
      /* Un 404 aquí no es un fallo: es que el servidor todavía no tiene esta
       * parte. Se distingue de un error de verdad porque la respuesta es
       * distinta y el remedio también —aplicar el parche frente a mirar el
       * servidor—. */
      if (u.res && u.res.status === 404) { setSoporte('no-soportado'); return; }
      setSoporte('ok');
      setFallo(u.res && u.res.status === 403
        ? 'Tu usuario no pertenece a Gerencia, así que no puede administrar cuentas. Pídele el permiso a administración.'
        : u.motivo === 'sesion'
          ? 'El servidor no aceptó tu sesión.'
          : u.res ? `El servidor respondió ${u.res.status}.`
                  : 'No se pudo consultar.');
      return;
    }

    setSoporte('ok');
    setUsuarios(u.datos && Array.isArray(u.datos.results) ? u.datos.results : []);
    setRoles(r.ok && r.datos && Array.isArray(r.datos.results) ? r.datos.results : []);

    if (e.ok) {
      const d = e.datos || {};
      setEquipos(Array.isArray(d) ? d : (d.resultados || []));
      setSinIdentificar(typeof d.sin_identificar === 'number' ? d.sin_identificar : null);
    } else {
      setEquipos([]); setSinIdentificar(null);
      /* No es motivo para vaciar la pantalla: los usuarios se ven igual. */
      setSinEquipos(e.res && e.res.status === 403
        ? 'No tienes permiso de administrador del servidor, así que no se muestra desde qué celular entra cada uno.'
        : 'No se pudo consultar los equipos enlazados.');
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  /* El enlace de cada persona. Se prefiere el activo: una cuenta puede tener
   * varios registros históricos y el que importa es el vigente. */
  const equipoDe = useMemo(() => {
    const m = new Map();
    for (const q of equipos) {
      const k = String(q.usuario || '').toLowerCase();
      const previo = m.get(k);
      if (!previo || (q.activo && !previo.activo)) m.set(k, q);
    }
    return m;
  }, [equipos]);

  const visibles = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return usuarios.filter((u) => {
      const eq = equipoDe.get(String(u.username).toLowerCase());
      if (rol && u.role !== rol) return false;
      if (filtro === 'activos' && !u.is_active) return false;
      if (filtro === 'inactivos' && u.is_active) return false;
      if (filtro === 'enlazados' && !(eq && eq.activo)) return false;
      if (filtro === 'sinequipo' && eq && eq.activo) return false;
      if (!q) return true;
      return [u.username, u.first_name, u.last_name, u.role_label,
              eq && eq.equipo]
        .some(v => String(v || '').toLowerCase().includes(q));
    });
  }, [usuarios, equipoDe, busca, filtro, rol]);

  const nombreDe = (u) => `${u.first_name || ''} ${u.last_name || ''}`.trim();

  /* ── Acciones ──────────────────────────────────────────────────────── */

  const crear = async () => {
    if (!roles.length) {
      Swal.fire('Sin roles', 'El servidor no devolvió los roles disponibles, '
        + 'así que no se puede elegir uno. Actualiza y vuelve a intentarlo.', 'warning');
      return;
    }
    const opciones = roles
      .map(r => `<option value="${esc(r.code)}">${esc(r.label)}</option>`).join('');

    const { value: datos } = await Swal.fire({
      title: 'Nuevo usuario',
      html:
        `<input id="f-user" class="swal2-input" placeholder="Usuario (sin espacios)" maxlength="30">
         <input id="f-nom"  class="swal2-input" placeholder="Nombre" maxlength="30">
         <input id="f-ape"  class="swal2-input" placeholder="Apellido" maxlength="30">
         <input id="f-mail" class="swal2-input" placeholder="Correo (opcional)" type="email">
         <select id="f-rol" class="swal2-input">${opciones}</select>
         <p style="font-size:.85em;color:#64748b;margin-top:10px">
           La clave la genera el servidor y se muestra una sola vez.
         </p>`,
      focusConfirm: false,
      showCancelButton: true,
      confirmButtonText: 'Crear',
      cancelButtonText: 'Cancelar',
      preConfirm: () => {
        const v = (id) => (document.getElementById(id).value || '').trim();
        const username = v('f-user');
        /* Se valida aquí con la misma regla del servidor, para que el error
         * salga antes de viajar y diga qué se admite, no un 400 seco. */
        if (!/^[\w.@+-]{3,30}$/.test(username)) {
          Swal.showValidationMessage(
            'Usuario inválido: de 3 a 30 caracteres, sin espacios (letras, números, . @ + - _).');
          return false;
        }
        return {
          username,
          first_name: v('f-nom'),
          last_name: v('f-ape'),
          email: v('f-mail'),
          role: document.getElementById('f-rol').value,
        };
      },
    });
    if (!datos) return;

    setOcupado('nuevo');
    const { ok, res, datos: resp } = await pedir(API_USUARIOS,
      { method: 'POST', body: JSON.stringify(datos) });
    setOcupado(null);

    if (!ok) {
      let detalle = res ? `El servidor respondió ${res.status}.` : 'Sin respuesta.';
      try { const j = await res.clone().json(); if (j.detail) detalle = j.detail; }
      catch (err) { /* se queda el genérico */ }
      Swal.fire('No se pudo crear', detalle, 'error');
      return;
    }
    await cargar();
    if (resp && resp.credentials) {
      await mostrarCredenciales(resp.credentials, 'Usuario creado');
    }
  };

  const resetear = async (u) => {
    const r = await Swal.fire({
      icon: 'warning',
      title: `¿Generar clave nueva para ${esc(u.username)}?`,
      html: 'El servidor crea una clave aleatoria y te la muestra una sola vez.'
        + '<br><br><b>Se cerrará su sesión</b>: si está en campo con un parte '
        + 'a medias, lo pierde.',
      showCancelButton: true,
      confirmButtonText: 'Sí, generar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#b45309',
      focusCancel: true,
    });
    if (!r.isConfirmed) return;

    setOcupado(u.id);
    const { ok, res, datos } = await pedir(`${API_USUARIOS}${u.id}/reset-password/`,
      { method: 'POST' });
    setOcupado(null);

    if (!ok) {
      Swal.fire('No se pudo cambiar la clave',
        res ? `El servidor respondió ${res.status}.` : 'Sin respuesta.', 'error');
      return;
    }
    if (datos && datos.credentials) {
      await mostrarCredenciales(datos.credentials, 'Clave nueva');
    }
    await cargar();
  };

  const alternarActivo = async (u) => {
    const apagando = u.is_active;
    const r = await Swal.fire({
      icon: 'warning',
      title: apagando ? `¿Desactivar a ${esc(u.username)}?` : `¿Reactivar a ${esc(u.username)}?`,
      html: apagando
        ? 'No podrá entrar hasta que se le reactive, y se cierra su sesión ahora mismo.'
        : 'Volverá a poder entrar con su clave actual.',
      showCancelButton: true,
      confirmButtonText: apagando ? 'Sí, desactivar' : 'Sí, reactivar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: apagando ? '#b91c1c' : '#15803d',
      focusCancel: apagando,
    });
    if (!r.isConfirmed) return;

    setOcupado(u.id);
    const { ok, res } = await pedir(`${API_USUARIOS}${u.id}/toggle-active/`,
      { method: 'POST' });
    setOcupado(null);
    if (!ok) {
      Swal.fire('No se pudo cambiar',
        res ? `El servidor respondió ${res.status}.` : 'Sin respuesta.', 'error');
      return;
    }
    await cargar();
  };

  const cambiarRol = async (u) => {
    if (!roles.length) return;
    const opciones = roles.map(r =>
      `<option value="${esc(r.code)}"${r.code === u.role ? ' selected' : ''}>${esc(r.label)}</option>`
    ).join('');

    const { value: rol } = await Swal.fire({
      title: `Rol de ${esc(u.username)}`,
      html: `<select id="f-rol2" class="swal2-input">${opciones}</select>
             <p style="font-size:.85em;color:#b45309;margin-top:10px">
               Al cambiar el rol se cierra su sesión, para que entre con los
               permisos nuevos.
             </p>`,
      showCancelButton: true,
      confirmButtonText: 'Cambiar',
      cancelButtonText: 'Cancelar',
      preConfirm: () => document.getElementById('f-rol2').value,
    });
    if (!rol || rol === u.role) return;

    setOcupado(u.id);
    const { ok, res } = await pedir(`${API_USUARIOS}${u.id}/role/`,
      { method: 'POST', body: JSON.stringify({ role: rol }) });
    setOcupado(null);
    if (!ok) {
      Swal.fire('No se pudo cambiar el rol',
        res ? `El servidor respondió ${res.status}.` : 'Sin respuesta.', 'error');
      return;
    }
    await cargar();
  };

  const liberar = async (u, eq) => {
    /* Se pregunta con el nombre del equipo delante. Liberar al usuario
     * equivocado no da error: le deja entrar desde cualquier celular, y eso
     * es justo lo que esta pantalla existe para impedir. */
    const r = await Swal.fire({
      icon: 'warning',
      title: `¿Liberar a ${esc(u.username)}?`,
      html: `Su cuenta dejará de estar atada a <b>${esc(eq.equipo || 'ese equipo')}</b>.`
        + '<br><br>El próximo celular desde el que entre quedará enlazado.',
      showCancelButton: true,
      confirmButtonText: 'Sí, liberar',
      cancelButtonText: 'Conservar',
      confirmButtonColor: '#b45309',
      focusCancel: true,
    });
    if (!r.isConfirmed) return;

    setOcupado(u.id);
    const { ok, res } = await pedir(`${API_EQUIPOS}${eq.id}/liberar/`,
      { method: 'POST', json: false });
    setOcupado(null);
    if (!ok) {
      Swal.fire('No se pudo liberar',
        res ? `El servidor respondió ${res.status}.` : 'Sin respuesta.', 'error');
      return;
    }
    await cargar();
  };

  /* ── Pintar ────────────────────────────────────────────────────────── */

  if (soporte === 'no-soportado') {
    return (
      <div className="eqe">
        <Cabecera />
        <div className="eqe-falta">
          <FaExclamationTriangle size={15} />
          <div>
            <b>Este servidor todavía no administra usuarios desde la web.</b>
            <p>
              Se habilita en el backend de PLUVIRA, que es quien emite el
              token. Mientras tanto, las cuentas se gestionan desde la app.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const hayEquipos = !sinEquipos;

  return (
    <div className="eqe">
      <Cabecera />

      {/* EL NUMERO QUE DECIDE SI SE PUEDE ENCENDER EL BLOQUEO. Son los que
          siguen con la app vieja; con el bloqueo activo, esos no entran. */}
      {sinIdentificar !== null && (
        <div className={`eqe-aviso ${sinIdentificar > 0 ? 'eqe-aviso-mal' : 'eqe-aviso-ok'}`}>
          {sinIdentificar > 0 ? <FaExclamationTriangle size={14} /> : <FaCheckCircle size={14} />}
          <div>
            {sinIdentificar > 0 ? (<>
              <b>{sinIdentificar} usuario(s) entran sin identificar su equipo.</b>
              {' '}Siguen con la app vieja. Si enciendes el bloqueo ahora, esos
              no van a poder entrar.
            </>) : (<>
              <b>Todos los que entran identifican su equipo.</b>
              {' '}Ya se puede encender el bloqueo sin dejar a nadie fuera.
            </>)}
          </div>
        </div>
      )}

      {sinEquipos && (
        <div className="eqe-aviso eqe-aviso-mal">
          <FaExclamationTriangle size={14} />
          <div>{sinEquipos}</div>
        </div>
      )}

      <div className="eqe-barra">
        <div className="eqe-busca">
          <FaSearch size={12} />
          <input type="text" value={busca} placeholder="Buscar usuario, nombre o equipo…"
            onChange={e => setBusca(e.target.value)} />
        </div>
        <div className="eqe-estados">
          {FILTROS.map(x => (
            <button key={x.clave} type="button"
              className={`eqe-chip${filtro === x.clave ? ' act' : ''}`}
              onClick={() => setFiltro(x.clave)}>{x.texto}</button>
          ))}
        </div>
        {roles.length > 0 && (
          <select className="eqe-rolsel" value={rol}
            onChange={e => setRol(e.target.value)}
            title="Filtrar por rol">
            <option value="">Todos los roles</option>
            {roles.map(r => (
              <option key={r.code} value={r.code}>{r.label}</option>
            ))}
          </select>
        )}
        <button type="button" className="eqe-nuevo" onClick={crear}
          disabled={cargando || ocupado === 'nuevo'}>
          <FaUserPlus size={12} /> Nuevo usuario
        </button>
        <button type="button" className="eqe-btn" onClick={cargar} disabled={cargando}>
          <FaSyncAlt size={11} /> Actualizar
        </button>
      </div>

      {fallo && <div className="eqe-fallo">{fallo}</div>}
      {cargando && <div className="eqe-nota">Consultando…</div>}

      {!cargando && !fallo && visibles.length === 0 && (
        <div className="eqe-nota">
          {busca || filtro !== 'todos' || rol
            ? 'Ningún usuario coincide con el filtro.'
            : 'Todavía no hay usuarios con rol móvil.'}
        </div>
      )}

      {visibles.length > 0 && (
        <div className="eqe-tabla-wrap">
          <table className="eqe-tabla">
            <thead>
              <tr>
                <th>Usuario</th>
                <th>Rol</th>
                {hayEquipos && <th>Equipo</th>}
                {hayEquipos && <th>Último uso</th>}
                <th>Estado</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {visibles.map((u) => {
                const eq = equipoDe.get(String(u.username).toLowerCase());
                const enlazado = eq && eq.activo;
                const trabajando = ocupado === u.id;
                return (
                  <tr key={u.id} className={u.is_active ? undefined : 'eqe-libre'}>
                    <td>
                      <b>{u.username}</b>
                      {nombreDe(u) && <div className="eqe-sub">{nombreDe(u)}</div>}
                      {u.email && <div className="eqe-sub eqe-id">{u.email}</div>}
                    </td>

                    <td>
                      <span className="eqe-tag eqe-tag-rol">{u.role_label || '—'}</span>
                      <div className="eqe-sub">
                        {u.last_login ? `entró ${desdeHace(u.last_login)}` : 'nunca entró'}
                      </div>
                    </td>

                    {hayEquipos && (
                      <td>
                        {enlazado ? (<>
                          <span className="eqe-equipo">
                            <FaMobileAlt size={11} /> {eq.equipo || 'sin nombre'}
                          </span>
                          <div className="eqe-sub eqe-id">{eq.plataforma} · {eq.device_id}</div>
                        </>) : (
                          <span className="eqe-sub">sin equipo enlazado</span>
                        )}
                        {/* LA FIRMA. Sin ella, "¿quién liberó esta cuenta
                            tres veces este mes?" no tiene respuesta. */}
                        {eq && !eq.activo && (eq.liberado_por || eq.liberado_en) && (
                          <div className="eqe-sub eqe-firma">
                            <FaHistory size={9} />{' '}
                            liberado por {eq.liberado_por || 'alguien'} · {fecha(eq.liberado_en)}
                          </div>
                        )}
                      </td>
                    )}

                    {hayEquipos && (
                      <td>
                        {enlazado ? (<>
                          {fecha(eq.ultimo_uso)}
                          {desdeHace(eq.ultimo_uso) && (
                            <div className="eqe-sub">{desdeHace(eq.ultimo_uso)}</div>
                          )}
                        </>) : '—'}
                      </td>
                    )}

                    <td>
                      {u.is_active
                        ? <span className="eqe-tag eqe-tag-act">Activo</span>
                        : <span className="eqe-tag eqe-tag-lib">Desactivado</span>}
                    </td>

                    <td className="eqe-acc">
                      <div className="eqe-acciones">
                        <button type="button" className="eqe-mini" disabled={trabajando}
                          title="Generar una clave nueva" onClick={() => resetear(u)}>
                          <FaKey size={10} /> Clave
                        </button>
                        <button type="button" className="eqe-mini" disabled={trabajando || !roles.length}
                          title="Cambiar el rol" onClick={() => cambiarRol(u)}>
                          <FaUserTag size={10} /> Rol
                        </button>
                        <button type="button"
                          className={`eqe-mini${u.is_active ? ' eqe-mini-mal' : ' eqe-mini-ok'}`}
                          disabled={trabajando}
                          title={u.is_active ? 'Desactivar la cuenta' : 'Reactivar la cuenta'}
                          onClick={() => alternarActivo(u)}>
                          {u.is_active ? <FaUserSlash size={10} /> : <FaUserCheck size={10} />}
                          {u.is_active ? ' Desactivar' : ' Reactivar'}
                        </button>
                        {enlazado && (
                          <button type="button" className="eqe-liberar" disabled={trabajando}
                            onClick={() => liberar(u, eq)}>
                            <FaUnlock size={11} />
                            {trabajando ? ' …' : ' Liberar'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const Cabecera = () => (
  <div className="eqe-cab">
    <h2><FaMobileAlt /> Usuarios y equipos</h2>
    <p>
      Las cuentas de la app, con su rol y el celular al que están atadas. Cada
      cuenta queda enlazada al primer equipo desde el que se entró; si alguien
      cambia de celular o lo pierde, libérala aquí. Las claves las genera el
      servidor y solo se ven una vez.
    </p>
  </div>
);
