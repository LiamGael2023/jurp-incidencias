/**
 * Equipos enlazados: qué celular tiene cada cuenta, y cómo soltarlo.
 *
 * POR QUE EXISTE. La cuenta queda atada al teléfono desde el que se entró la
 * primera vez, para que prestar la clave no sirva. Pero un celular se
 * pierde, se cambia o se restaura de fábrica —y los identificadores de
 * Android e iOS no sobreviven a eso—, así que sin un sitio donde liberar el
 * enlace la medida se convierte en llamadas diarias. Esta pantalla no es un
 * extra del enlace: es la mitad que lo hace viable.
 *
 * EL NUMERO QUE MANDA ES «sin identificar». Son los usuarios que entraron
 * sin mandar el identificador, es decir, los que siguen con la app vieja.
 * Mientras ese número no sea cero, encender el bloqueo deja fuera a esa
 * gente, que además es la de campo. Por eso va arriba y en grande, y no
 * escondido en una esquina.
 *
 * LIBERAR NO BORRA. Desactiva el enlace y queda firmado quién lo hizo y
 * cuándo. Un campo en el usuario solo sabría dónde está ahora; la tabla sabe
 * por dónde pasó, que es lo que hace falta cuando alguien dice «me liberaron
 * y sigo sin poder entrar», y lo que permite ver si alguien libera de más.
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  FaMobileAlt, FaSearch, FaSyncAlt, FaUnlock, FaExclamationTriangle,
  FaCheckCircle, FaHistory,
} from 'react-icons/fa';
import Swal from 'sweetalert2';
import { pedir } from './sesion';
import './EquiposEnlazados.css';

const API = '/api/v1/mobile/auth/dispositivos/';

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

const ESTADOS = [
  { clave: 'activos', texto: 'Enlazados' },
  { clave: 'liberados', texto: 'Liberados' },
  { clave: 'todos', texto: 'Todos' },
];

export default function EquiposEnlazados() {
  const [filas, setFilas] = useState([]);
  const [sinIdentificar, setSinIdentificar] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [fallo, setFallo] = useState('');
  const [soporte, setSoporte] = useState('probando');  // 'ok' | 'no-soportado'
  const [busca, setBusca] = useState('');
  const [estado, setEstado] = useState('activos');
  const [liberando, setLiberando] = useState(null);

  const cargar = useCallback(async () => {
    setCargando(true); setFallo('');
    const { ok, res, datos, motivo } = await pedir(`${API}?estado=${estado}`);
    setCargando(false);
    if (!ok) {
      /* Un 404 aquí no es un fallo: es que el servidor todavía no tiene esta
       * parte. Se distingue de un error de verdad porque la respuesta es
       * distinta y el remedio también —aplicar el parche frente a mirar el
       * servidor—. */
      if (res && res.status === 404) { setSoporte('no-soportado'); return; }
      setSoporte('ok');
      /* UN 403 AQUI NO ES LA SESION. El servidor pide 401 cuando no sabe
       * quién eres y 403 cuando lo sabe y no te deja: esta pantalla es solo
       * para administradores. Decirle "vuelve a entrar" a quien tiene la
       * sesión perfectamente bien lo manda a salir y entrar para nada —y en
       * un sistema donde ya se sospecha de tokens que caducan, añade ruido
       * justo al dato que se está intentando limpiar. */
      setFallo(res && res.status === 403
        ? 'Tu usuario no es administrador, así que esta pantalla no te muestra nada. Pídele a administración que te dé el permiso.'
        : motivo === 'sesion'
          ? 'El servidor no aceptó tu sesión.'
          : res ? `El servidor respondió ${res.status}.`
                : 'No se pudo consultar.');
      return;
    }
    setSoporte('ok');
    setFilas(Array.isArray(datos) ? datos : (datos.resultados || []));
    setSinIdentificar(datos && typeof datos.sin_identificar === 'number'
      ? datos.sin_identificar : null);
  }, [estado]);

  useEffect(() => { cargar(); }, [cargar]);

  const visibles = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return filas;
    return filas.filter(f =>
      [f.usuario, f.nombre_usuario, f.equipo, f.plataforma]
        .some(v => String(v || '').toLowerCase().includes(q)));
  }, [filas, busca]);

  const liberar = async (f) => {
    /* Se pregunta con el nombre del equipo delante. Liberar al usuario
     * equivocado no da error: le deja entrar desde cualquier celular, y eso
     * es justo lo que esta pantalla existe para impedir. */
    const r = await Swal.fire({
      icon: 'warning',
      title: `¿Liberar a ${f.usuario}?`,
      html: `Su cuenta dejará de estar atada a <b>${f.equipo || 'ese equipo'}</b>.`
        + '<br><br>El próximo celular desde el que entre quedará enlazado.',
      showCancelButton: true,
      confirmButtonText: 'Sí, liberar',
      cancelButtonText: 'Conservar',
      confirmButtonColor: '#b45309',
      focusCancel: true,
    });
    if (!r.isConfirmed) return;

    setLiberando(f.id);
    const { ok, res } = await pedir(`${API}${f.id}/liberar/`,
      { method: 'POST', json: false });
    setLiberando(null);
    if (!ok) {
      Swal.fire('No se pudo liberar',
        res ? `El servidor respondió ${res.status}.` : 'Sin respuesta.', 'error');
      return;
    }
    await cargar();
  };

  if (soporte === 'no-soportado') {
    return (
      <div className="eqe">
        <Cabecera />
        <div className="eqe-falta">
          <FaExclamationTriangle size={15} />
          <div>
            <b>Este servidor todavía no enlaza cuentas con equipos.</b>
            <p>
              Se habilita en el backend de PLUVIRA, que es quien emite el
              token. Mientras tanto, cualquiera que tenga la clave puede
              entrar desde cualquier celular.
            </p>
          </div>
        </div>
      </div>
    );
  }

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

      <div className="eqe-barra">
        <div className="eqe-busca">
          <FaSearch size={12} />
          <input type="text" value={busca} placeholder="Buscar usuario o equipo…"
            onChange={e => setBusca(e.target.value)} />
        </div>
        <div className="eqe-estados">
          {ESTADOS.map(x => (
            <button key={x.clave} type="button"
              className={`eqe-chip${estado === x.clave ? ' act' : ''}`}
              onClick={() => setEstado(x.clave)}>{x.texto}</button>
          ))}
        </div>
        <button type="button" className="eqe-btn" onClick={cargar} disabled={cargando}>
          <FaSyncAlt size={11} /> Actualizar
        </button>
      </div>

      {fallo && <div className="eqe-fallo">{fallo}</div>}
      {cargando && <div className="eqe-nota">Consultando…</div>}

      {!cargando && !fallo && visibles.length === 0 && (
        <div className="eqe-nota">
          {busca ? 'Ningún usuario coincide con la búsqueda.'
                 : estado === 'activos'
                   ? 'Todavía no hay ninguna cuenta enlazada a un equipo.'
                   : 'No hay nada en esta lista.'}
        </div>
      )}

      {visibles.length > 0 && (
        <div className="eqe-tabla-wrap">
          <table className="eqe-tabla">
            <thead>
              <tr>
                <th>Usuario</th>
                <th>Equipo</th>
                <th>Enlazado</th>
                <th>Último uso</th>
                <th>Estado</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {visibles.map(f => (
                <tr key={f.id} className={f.activo ? undefined : 'eqe-libre'}>
                  <td>
                    <b>{f.usuario}</b>
                    {f.nombre_usuario && <div className="eqe-sub">{f.nombre_usuario}</div>}
                  </td>
                  <td>
                    <span className="eqe-equipo">
                      <FaMobileAlt size={11} /> {f.equipo || 'sin nombre'}
                    </span>
                    <div className="eqe-sub eqe-id">{f.plataforma} · {f.device_id}</div>
                  </td>
                  <td>{fecha(f.desde)}</td>
                  <td>
                    {fecha(f.ultimo_uso)}
                    {desdeHace(f.ultimo_uso) && (
                      <div className="eqe-sub">{desdeHace(f.ultimo_uso)}</div>
                    )}
                  </td>
                  <td>
                    {f.activo ? (
                      <span className="eqe-tag eqe-tag-act">Enlazado</span>
                    ) : (
                      <>
                        <span className="eqe-tag eqe-tag-lib">Liberado</span>
                        {/* LA FIRMA. Sin ella, "¿quién liberó esta cuenta
                            tres veces este mes?" no tiene respuesta. */}
                        {(f.liberado_por || f.liberado_en) && (
                          <div className="eqe-sub eqe-firma">
                            <FaHistory size={9} />{' '}
                            {f.liberado_por || 'alguien'} · {fecha(f.liberado_en)}
                          </div>
                        )}
                      </>
                    )}
                  </td>
                  <td className="eqe-acc">
                    {f.activo && (
                      <button type="button" className="eqe-liberar"
                        disabled={liberando === f.id}
                        onClick={() => liberar(f)}>
                        <FaUnlock size={11} />
                        {liberando === f.id ? ' Liberando…' : ' Liberar'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const Cabecera = () => (
  <div className="eqe-cab">
    <h2><FaMobileAlt /> Equipos enlazados</h2>
    <p>
      Cada cuenta queda atada al celular desde el que se entró la primera vez.
      Desde otro equipo el ingreso se rechaza, aunque la clave sea correcta.
      Si alguien cambia de celular o lo pierde, libéralo aquí.
    </p>
  </div>
);
