/* La rejilla de permisos: qué pantallas ve cada rol y qué puede hacer.
 *
 * ──────────────────────────────────────────────────────────────────────
 * UNA SOLA REJILLA PARA DOS COSAS QUE NO SON IGUALES
 * ──────────────────────────────────────────────────────────────────────
 *
 * Por ROL la casilla tiene dos estados: puede o no puede. Por PERSONA
 * tiene tres —hereda, sí, no—, y el tercero es el importante: «hereda» no
 * es «no». Con solo dos estados, dar de alta la excepción de alguien para
 * quitarle una cosa le congelaría de paso todo lo demás tal como está hoy,
 * y dejaría de recibir los cambios que se hagan en su rol. Nadie
 * entendería por qué, y se descubriría meses después.
 *
 * Son el mismo componente porque son la misma tabla y el mismo gesto. Lo
 * que cambia es la casilla, y eso es una función.
 *
 * ──────────────────────────────────────────────────────────────────────
 * «SIN CONFIGURAR» NO ES «SIN PERMISOS»
 * ──────────────────────────────────────────────────────────────────────
 *
 * Un rol que no se ha tocado nunca se comporta como antes de que esto
 * existiera: puede todo. Eso es lo que permite aplicar el cambio sin
 * dejar a nadie fuera el primer día. En cuanto se guarda una vez, manda
 * la rejilla: lo que no esté marcado, no se puede.
 *
 * La diferencia se dice en la pantalla, porque una rejilla con todo en
 * blanco y un rol sin configurar se ven igual y significan lo contrario.
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  FaTimes, FaSave, FaSyncAlt, FaCheck, FaBan, FaLink,
  FaExclamationTriangle, FaUserShield,
} from 'react-icons/fa';
import Swal from 'sweetalert2';
import { pedir } from './sesion';
import './PermisosPantalla.css';

const API = '/api/v1/mobile/permisos/';
const ACCIONES = ['ver', 'crear', 'editar', 'borrar'];
const ROTULO = { ver: 'Ver', crear: 'Crear', editar: 'Editar', borrar: 'Borrar' };

/* Los módulos, en el orden del menú. Un rótulo por grupo convierte
 * veintitrés filas iguales en cuatro bloques que se reconocen. */
const MODULOS = [
  ['pluvira', 'PLUVIRA'],
  ['inventario', 'Inventario'],
  ['sentria', 'SENTRIA'],
  ['hydrometrix', 'HYDROMETRIX'],
];

const vacia = () => ({ ver: false, crear: false, editar: false, borrar: false });
const sinDecir = () => ({ ver: null, crear: null, editar: null, borrar: null });

export default function PermisosPantalla({ modo, rol, usuario, roles = [], onCerrar }) {
  const esRol = modo === 'rol';

  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [fallo, setFallo] = useState(null);
  const [pantallas, setPantallas] = useState([]);
  const [rejilla, setRejilla] = useState({});      // lo que se edita
  const [heredado, setHeredado] = useState({});    // solo en modo usuario
  const [configurado, setConfigurado] = useState(false);
  const [rolElegido, setRolElegido] = useState(rol || (roles[0] || {}).code || '');
  const [sucio, setSucio] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    setFallo(null);

    const url = esRol ? `${API}roles/` : `${API}usuarios/${usuario.id}/`;
    const { ok, res, datos } = await pedir(url, { callar: [403, 404] });
    setCargando(false);

    if (!ok) {
      setFallo(res && res.status === 404
        ? 'Este servidor todavía no tiene permisos por pantalla. Aplica el '
          + 'parche parche_permisos_pantalla.py.'
        : res && res.status === 403
          ? 'No tienes permiso para configurar permisos.'
          : res ? `El servidor respondió ${res.status}.` : 'No se pudo consultar.');
      return;
    }

    setPantallas(datos.pantallas || []);

    if (esRol) {
      const suyo = (datos.roles || {})[rolElegido];
      setConfigurado(!!suyo);
      const base = {};
      for (const p of datos.pantallas || []) {
        base[p.clave] = suyo && suyo[p.clave]
          ? { ...vacia(), ...suyo[p.clave] }
          : vacia();
      }
      setRejilla(base);
    } else {
      const propias = datos.excepciones || {};
      const base = {};
      for (const p of datos.pantallas || []) {
        base[p.clave] = { ...sinDecir(), ...(propias[p.clave] || {}) };
      }
      setRejilla(base);
      setHeredado(datos.efectivos || {});
    }
    setSucio(false);
  }, [esRol, usuario, rolElegido]);

  useEffect(() => { cargar(); }, [cargar]);

  /* Lo que de verdad va a poder esa persona, casilla por casilla: su
   * excepción si la hay, y si no, lo que diga el rol. Es lo que se pinta
   * en gris debajo, para no tener que abrir dos pantallas para saberlo. */
  const efectivo = useMemo(() => {
    if (esRol) return {};
    const fuera = {};
    for (const p of pantallas) {
      const mio = rejilla[p.clave] || sinDecir();
      const base = heredado[p.clave] || vacia();
      fuera[p.clave] = {};
      for (const a of ACCIONES) {
        fuera[p.clave][a] = mio[a] === null || mio[a] === undefined
          ? !!base[a] : !!mio[a];
      }
    }
    return fuera;
  }, [esRol, pantallas, rejilla, heredado]);

  const porModulo = useMemo(() => {
    const fuera = [];
    for (const [clave, titulo] of MODULOS) {
      const suyas = pantallas.filter(p => p.modulo === clave);
      if (suyas.length) fuera.push([titulo, suyas]);
    }
    // Un módulo nuevo en el servidor no se queda invisible aquí: se pinta
    // al final con su clave por rótulo, que es feo pero visible. Que una
    // pantalla no salga en la rejilla significa que nadie puede
    // configurarla, y eso no se puede descubrir por casualidad.
    const sueltas = pantallas.filter(
      p => !MODULOS.some(([c]) => c === p.modulo));
    if (sueltas.length) fuera.push(['Otros', sueltas]);
    return fuera;
  }, [pantallas]);

  const tocar = (clave, accion, valor) => {
    setRejilla(r => ({ ...r, [clave]: { ...r[clave], [accion]: valor } }));
    setSucio(true);
  };

  /* En modo usuario la casilla gira: hereda -> sí -> no -> hereda. Tres
   * estados no caben en un checkbox, y un desplegable por casilla serían
   * noventa y dos desplegables en una pantalla. */
  const girar = (clave, accion) => {
    const actual = (rejilla[clave] || {})[accion];
    const siguiente = actual === null || actual === undefined ? true
      : actual === true ? false : null;
    tocar(clave, accion, siguiente);
  };

  /* Marcar una fila o una columna entera. En una rejilla de 23x4, dar
   * «ver» a todo a mano son veintitrés clics y un despiste. */
  const filaEntera = (clave, valor) => {
    setRejilla(r => ({
      ...r,
      [clave]: ACCIONES.reduce((o, a) => ({ ...o, [a]: valor }), {}),
    }));
    setSucio(true);
  };

  const columnaEntera = (accion, valor) => {
    setRejilla(r => {
      const fuera = { ...r };
      for (const p of pantallas) {
        fuera[p.clave] = { ...fuera[p.clave], [accion]: valor };
      }
      return fuera;
    });
    setSucio(true);
  };

  const guardar = async () => {
    const cuerpo = esRol
      ? { rol: rolElegido, permisos: rejilla }
      : { permisos: rejilla };

    if (esRol) {
      const nada = pantallas.every(
        p => !ACCIONES.some(a => (rejilla[p.clave] || {})[a]));
      if (nada) {
        const r = await Swal.fire({
          icon: 'warning',
          title: 'Vas a dejar este rol sin nada',
          html: 'Con la rejilla entera en blanco, quien tenga el rol '
            + `<b>${rolElegido}</b> no podrá entrar a ninguna pantalla.`
            + '<br><br>Si lo que quieres es dejarlo como estaba —sin '
            + 'restringir—, usa <b>Quitar la configuración</b>.',
          showCancelButton: true,
          confirmButtonText: 'Sí, dejarlo sin nada',
          cancelButtonText: 'Cancelar',
          confirmButtonColor: '#d63939',
          focusCancel: true,
        });
        if (!r.isConfirmed) return;
      }
    }

    setGuardando(true);
    const url = esRol ? `${API}roles/` : `${API}usuarios/${usuario.id}/`;
    const { ok, res, datos } = await pedir(url, {
      method: 'POST', body: JSON.stringify(cuerpo), callar: [400, 403, 404],
    });
    setGuardando(false);

    if (!ok) {
      let porQue = null;
      try { porQue = await res.clone().json(); } catch { /* no es JSON */ }
      Swal.fire('No se pudo guardar',
        (porQue && porQue.detail)
          || (res ? `El servidor respondió ${res.status}.` : 'Sin respuesta.'),
        'error');
      return;
    }

    setSucio(false);
    if (!esRol && datos && datos.efectivos) setHeredado(datos.efectivos);
    if (esRol) setConfigurado(true);

    await Swal.fire({
      icon: 'success',
      title: 'Permisos guardados',
      html: esRol
        ? 'Tendrán efecto la próxima vez que esas personas carguen la '
          + 'página. Las que estén dentro ahora mismo seguirán viendo el '
          + 'menú de antes hasta que recarguen —pero el servidor ya les '
          + 'dice que no.'
        : 'La excepción queda guardada y manda sobre su rol.',
    });
  };

  const quitarConfiguracion = async () => {
    const r = await Swal.fire({
      icon: 'question',
      title: esRol ? `¿Dejar «${rolElegido}» sin restringir?`
        : '¿Quitar todas sus excepciones?',
      html: esRol
        ? 'Volverá a comportarse como antes de configurar nada: podrá '
          + 'entrar a todas las pantallas y hacer de todo.<br><br>No es lo '
          + 'mismo que dejar la rejilla en blanco, que lo bloquearía entero.'
        : 'Pasará a tener exactamente lo que diga su rol, sin retoques.',
      showCancelButton: true,
      confirmButtonText: 'Sí, quitarla',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#b45309',
    });
    if (!r.isConfirmed) return;

    setGuardando(true);
    const url = esRol ? `${API}roles/` : `${API}usuarios/${usuario.id}/`;
    const { ok, res } = await pedir(url, {
      method: 'POST',
      body: JSON.stringify(esRol ? { rol: rolElegido, permisos: null }
        : { permisos: null }),
      callar: [400, 403, 404],
    });
    setGuardando(false);
    if (!ok) {
      Swal.fire('No se pudo',
        res ? `El servidor respondió ${res.status}.` : 'Sin respuesta.',
        'error');
      return;
    }
    await cargar();
  };

  const cerrar = async () => {
    if (sucio) {
      const r = await Swal.fire({
        icon: 'warning',
        title: 'Hay cambios sin guardar',
        text: 'Si cierras ahora se pierden.',
        showCancelButton: true,
        confirmButtonText: 'Cerrar sin guardar',
        cancelButtonText: 'Seguir aquí',
        confirmButtonColor: '#d63939',
        focusCancel: true,
      });
      if (!r.isConfirmed) return;
    }
    onCerrar();
  };

  return (
    <div className="pp-fondo" onClick={(e) => {
      if (e.target === e.currentTarget) cerrar();
    }}>
      <div className="pp-caja">
        <div className="pp-cabecera">
          <div>
            <h3>
              <FaUserShield />{' '}
              {esRol ? 'Permisos por rol' : `Permisos de ${usuario.username}`}
            </h3>
            <p>
              {esRol
                ? 'Qué pantallas ve cada rol y qué puede hacer dentro. '
                  + 'Las personas lo heredan de aquí.'
                : 'Retoques sobre lo que le da su rol. Lo que dejes en '
                  + '«hereda» sigue a su rol, también si cambia mañana.'}
            </p>
          </div>
          <button type="button" className="pp-cerrar" onClick={cerrar}
            title="Cerrar">
            <FaTimes />
          </button>
        </div>

        {esRol && (
          <div className="pp-barra">
            <label>Rol</label>
            <select value={rolElegido} disabled={sucio}
              title={sucio ? 'Guarda o descarta antes de cambiar de rol' : ''}
              onChange={(e) => setRolElegido(e.target.value)}>
              {roles.map(r => (
                <option key={r.code} value={r.code}>{r.label}</option>
              ))}
            </select>
            <span className={`pp-estado ${configurado ? 'pp-si' : 'pp-no'}`}>
              {configurado ? 'Configurado' : 'Sin configurar · puede todo'}
            </span>
          </div>
        )}

        {cargando && <div className="pp-aviso">Cargando…</div>}
        {fallo && (
          <div className="pp-aviso pp-mal">
            <FaExclamationTriangle /> {fallo}
            <button type="button" className="pp-reintentar" onClick={cargar}>
              <FaSyncAlt size={11} /> Reintentar
            </button>
          </div>
        )}

        {!cargando && !fallo && (
          <>
            {!esRol && (
              <div className="pp-leyenda">
                <span><FaLink /> hereda del rol</span>
                <span className="pp-l-si"><FaCheck /> sí, aunque el rol no</span>
                <span className="pp-l-no"><FaBan /> no, aunque el rol sí</span>
              </div>
            )}

            <div className="pp-tabla-caja">
              <table className="pp-tabla">
                <thead>
                  <tr>
                    <th className="pp-th-pantalla">Pantalla</th>
                    {ACCIONES.map(a => (
                      <th key={a}>
                        {ROTULO[a]}
                        {esRol && (
                          <div className="pp-col-todo">
                            <button type="button"
                              onClick={() => columnaEntera(a, true)}
                              title={`Dar «${ROTULO[a]}» en todas`}>todas</button>
                            <button type="button"
                              onClick={() => columnaEntera(a, false)}
                              title={`Quitar «${ROTULO[a]}» en todas`}>ninguna</button>
                          </div>
                        )}
                      </th>
                    ))}
                    {esRol && <th className="pp-th-fila">Fila</th>}
                  </tr>
                </thead>
                <tbody>
                  {porModulo.map(([titulo, suyas]) => (
                    <Bloque key={titulo} titulo={titulo} pantallas={suyas}
                      esRol={esRol} rejilla={rejilla} efectivo={efectivo}
                      tocar={tocar} girar={girar} filaEntera={filaEntera} />
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        <div className="pp-pie">
          <button type="button" className="pp-quitar"
            onClick={quitarConfiguracion}
            disabled={cargando || guardando || !!fallo
              || (esRol && !configurado)}>
            {esRol ? 'Quitar la configuración' : 'Quitar las excepciones'}
          </button>
          <div className="pp-pie-der">
            <button type="button" className="pp-cancelar" onClick={cerrar}>
              Cancelar
            </button>
            <button type="button" className="pp-guardar" onClick={guardar}
              disabled={cargando || guardando || !!fallo}>
              <FaSave size={12} /> {guardando ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Bloque({ titulo, pantallas, esRol, rejilla, efectivo, tocar, girar,
  filaEntera }) {
  return (
    <>
      <tr className="pp-modulo">
        <td colSpan={esRol ? 6 : 5}>{titulo}</td>
      </tr>
      {pantallas.map(p => {
        const fila = rejilla[p.clave] || {};
        return (
          <tr key={p.clave}>
            <td className="pp-pantalla">
              {p.titulo}
              <span className="pp-clave">{p.clave}</span>
            </td>
            {ACCIONES.map(a => (
              <td key={a} className="pp-celda">
                {esRol ? (
                  <input type="checkbox" checked={!!fila[a]}
                    onChange={(e) => tocar(p.clave, a, e.target.checked)} />
                ) : (
                  <TresEstados valor={fila[a]}
                    resultado={(efectivo[p.clave] || {})[a]}
                    onClick={() => girar(p.clave, a)} />
                )}
              </td>
            ))}
            {esRol && (
              <td className="pp-celda pp-fila-todo">
                <button type="button" onClick={() => filaEntera(p.clave, true)}
                  title="Marcar las cuatro">todo</button>
                <button type="button" onClick={() => filaEntera(p.clave, false)}
                  title="Desmarcar las cuatro">nada</button>
              </td>
            )}
          </tr>
        );
      })}
    </>
  );
}

/* La casilla de tres estados.
 *
 * Debajo, en pequeño, lo que acaba pudiendo de verdad. Sin eso, «hereda»
 * obliga a abrir la pantalla del rol para saber si esa persona puede o no,
 * que es justo la pregunta que se viene a responder aquí. */
function TresEstados({ valor, resultado, onClick }) {
  const estado = valor === null || valor === undefined ? 'hereda'
    : valor ? 'si' : 'no';
  const icono = estado === 'hereda' ? <FaLink />
    : estado === 'si' ? <FaCheck /> : <FaBan />;
  const titulo = estado === 'hereda' ? 'Lo que diga su rol'
    : estado === 'si' ? 'Sí, aunque su rol no lo dé'
      : 'No, aunque su rol lo dé';

  return (
    <button type="button" className={`pp-tres pp-tres-${estado}`}
      onClick={onClick} title={`${titulo} — clic para cambiar`}>
      {icono}
      <span className={`pp-resultado ${resultado ? 'pp-r-si' : 'pp-r-no'}`}>
        {resultado ? 'puede' : 'no'}
      </span>
    </button>
  );
}
