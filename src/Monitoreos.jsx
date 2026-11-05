/**
 * Monitoreos rutinarios: crear la ronda, repartir los tramos, ver quién fue.
 *
 * LA PANTALLA ES EL TABLERO, NO EL FORMULARIO. Crear una rutina se hace una
 * vez al mes; mirar cómo va se hace todos los días. Por eso lo que ocupa la
 * pantalla es la tabla de tramos con su estado, y crear es un botón.
 *
 * EL ORDEN DE LOS TRAMOS ES EL DEL CANAL, no el alfabético. Alfabéticamente
 * «X» va antes que «XIII» y «II» antes que «IX», que es exactamente al revés
 * de como se recorre el agua. Quien mira esta tabla está siguiendo el canal
 * de arriba abajo.
 *
 * LAS ASIGNACIONES SE GUARDAN DE GOLPE. Un select que guarda al cambiar son
 * catorce peticiones y catorce sitios donde quedarse a medias sin que se
 * note; además, repartir tramos es una sola decisión —quién cubre qué— y se
 * toma mirando los catorce a la vez, no uno por uno.
 *
 * LOS CONTACTOS VAN EN LA FILA. La empresa y el celular del coordinador no
 * son adorno: son lo que hace falta tener delante cuando aparece algo en ese
 * tramo y hay que avisar. Esconderlos detrás de un clic es garantizar que
 * nadie los use.
 */
import { Fragment, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { FaTrashAlt, FaChevronDown, FaChevronUp, FaExternalLinkAlt,
  FaPlus, FaSyncAlt, FaCheckCircle, FaExclamationTriangle, FaRegCircle,
  FaSave, FaLock, FaLockOpen, FaCalendarAlt, FaBell, FaTimes, FaSearch, FaPhoneAlt,
  FaPen,
} from 'react-icons/fa';
import Swal from 'sweetalert2';
import { simboloDeElemento } from './simbolos';
import { pedir } from './sesion';
import './Monitoreos.css';

const API = '/api/v1/mobile/monitoreo/';

/* El orden del canal. Se escribe aquí y no se calcula para que una rutina
 * con tramos sueltos los siga ordenando igual. */
const ORDEN = ['0', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX',
  'X', 'XI', 'XII', 'XIII'];
const porCanal = (a, b) =>
  ORDEN.indexOf(String(a)) - ORDEN.indexOf(String(b));

const fecha = (v) => {
  if (!v) return '—';
  const d = new Date(String(v).length <= 10 ? `${v}T12:00:00` : v);
  return Number.isNaN(d.getTime()) ? String(v)
    : d.toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

const hoyISO = () => new Date().toISOString().slice(0, 10);

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

/* El estado de un tramo en tres palabras. Es lo que se lee de un vistazo y
 * lo que decide a quién hay que llamar hoy.
 *
 * RECORRER UN TRAMO ES RECORRERLO POR DENTRO: sus franjas de 200 m y las
 * obras de arte que hay en ellas, y la app registra una fila por elemento.
 * Así que un tramo con cuatro elementos revisados de cuarenta no está «Sin
 * novedad»: está a medias, y llamarlo hecho es lo que hace que nadie
 * vuelva. Cuántos elementos tiene cada tramo sale del KMZ, que lo lleva la
 * app y no el servidor, así que aquí se dice cuántos van y no cuántos
 * faltan.
 *
 * Los servidores sin el parche del elemento no mandan estos campos, y
 * entonces se lee lo de siempre. */
function estadoDe(t) {
  if (t.hallazgos > 0 || t.elementos_con_hallazgo > 0) {
    return { clave: 'hallazgo', texto: 'Con hallazgo' };
  }
  if (t.elementos_revisados > 0) {
    return { clave: 'parcial', texto: `${t.elementos_revisados} revisados` };
  }
  if (t.recorrido) return { clave: 'ok', texto: 'Sin novedad' };
  return { clave: 'pendiente', texto: 'Sin recorrer' };
}

const ICONO = {
  hallazgo: <FaExclamationTriangle size={11} />,
  ok: <FaCheckCircle size={11} />,
  /* A medias lleva el círculo vacío, no el check: el check es «ya está», y
   * un tramo empezado no lo está. El ámbar dice el resto. */
  parcial: <FaRegCircle size={11} />,
  pendiente: <FaRegCircle size={11} />,
};

export default function Monitoreos({ irAIncidente }) {
  const [rutinas, setRutinas] = useState([]);
  const [elegida, setElegida] = useState(null);     // la rutina abierta
  const [candidatos, setCandidatos] = useState([]);
  const [avisados, setAvisados] = useState([]);   // el grupo de Gerencia
  const [cargando, setCargando] = useState(true);
  /* El desglose de un tramo: id → { cargando, fallo, lista }.
   *
   * SE PIDE AL DESPLEGAR, no con la rutina. Una rutina entera son 14 tramos
   * con hasta 201 elementos cada uno; traerlos todos para que casi siempre
   * se mire uno sería más de mil filas de JSON por carga de pantalla. Una
   * vez traído se queda: volver a plegar y desplegar no vuelve a pedirlo. */
  const [desglose, setDesglose] = useState({});
  const [fallo, setFallo] = useState('');
  const [soporte, setSoporte] = useState('probando'); // ok | no-soportado
  const [ocupado, setOcupado] = useState(false);
  /* Lo que el usuario cambió y todavía no mandó: tramo -> id de usuario. */
  const [pendientes, setPendientes] = useState({});

  const cargar = useCallback(async (abrirId) => {
    setCargando(true); setFallo('');
    const [r, c] = await Promise.all([
      pedir(`${API}rutinas/`, { callar: [403, 404] }),
      pedir(`${API}candidatos/`, { callar: [403, 404] }),
    ]);
    setCargando(false);

    if (!r.ok) {
      /* Un 404 no es un error: es que el servidor todavía no tiene esta
       * parte, y el remedio es aplicar el parche, no mirar los datos. */
      if (r.res && r.res.status === 404) { setSoporte('no-soportado'); return; }
      setSoporte('ok');
      let porQue = '';
      if (r.res && r.res.status === 403) {
        try { const j = await r.res.clone().json(); porQue = j.detail || ''; }
        catch { /* queda el genérico */ }
        porQue = porQue || 'Tu usuario no puede administrar monitoreos.';
      }
      setFallo(porQue || (r.res ? `El servidor respondió ${r.res.status}.`
        : 'No se pudo consultar.'));
      return;
    }

    setSoporte('ok');
    const lista = (r.datos && r.datos.results) || [];
    setRutinas(lista);
    setCandidatos((c.ok && c.datos && c.datos.results) || []);
    setAvisados((c.ok && c.datos && c.datos.avisados) || []);

    const id = abrirId != null ? abrirId
      : (elegida ? elegida.id : (lista[0] && lista[0].id));
    if (id != null) await abrir(id);
    else setElegida(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const abrir = useCallback(async (id) => {
    const { ok, datos } = await pedir(`${API}rutinas/${id}/`, { callar: [404] });
    if (ok && datos && datos.rutina) {
      setElegida(datos.rutina);
      setPendientes({});
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const tramos = useMemo(() => {
    const t = (elegida && elegida.tramos) || [];
    return [...t].sort((a, b) => porCanal(a.tramo, b.tramo));
  }, [elegida]);

  const avance = useMemo(() => {
    const total = tramos.length;
    const hechos = tramos.filter(t => t.recorrido).length;
    const conHallazgo = tramos.filter(
      t => t.hallazgos > 0 || t.elementos_con_hallazgo > 0).length;
    const sinAsignar = tramos.filter(t => !(t.asignados || []).length).length;
    return { total, hechos, conHallazgo, sinAsignar,
      pct: total ? Math.round((hechos / total) * 100) : 0 };
  }, [tramos]);

  const hayCambios = Object.keys(pendientes).length > 0;

  /* Apunta el reparto de un tramo sin mandarlo todavía. Se guarda de golpe
   * con el botón, por lo mismo de siempre: repartir catorce tramos es una
   * decisión, no catorce. */
  const cambiar = (tramo, ids) =>
    setPendientes(p => ({ ...p, [tramo]: ids.map(String) }));

  /* El nombre de una ficha. Se busca primero en los candidatos y si no, en
   * lo que ya venía asignado: una cuenta puede haberse desactivado después
   * de que se le asignara el tramo, y entonces no está en la lista pero su
   * nombre sí tiene que salir —si no, la ficha quedaría con un número—. */
  const nombreDe = (id, tramo) => fichaDe(id, tramo).nombre || `#${id}`;

  /* El celular sale del cuadro, cruzado por nombre en el servidor. Cuando
   * el nombre de la cuenta no se parece al del cuadro no hay teléfono, y
   * entonces no se enseña ninguno: mejor que enseñar el de otro. */
  const celularDe = (id, tramo) => fichaDe(id, tramo).celular || '';

  const fichaDe = (id, tramo) =>
    candidatos.find(x => String(x.id) === String(id))
    || (tramo.asignados || []).find(x => String(x.id) === String(id))
    || {};

  /* Cuándo se registró, en corto: lo que importa al revisar es el día y la
   * hora, no el año, que es el de la rutina que se está mirando. */
  const cuando = (iso) => {
    if (!iso) return '';
    const f = new Date(iso);
    if (Number.isNaN(f.getTime())) return '';
    return f.toLocaleString('es-PE', {
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    });
  };

  /* El desglose de un tramo: qué elementos se revisaron y cómo. */
  const pintarDesglose = (t, estado) => {
    if (estado.cargando) {
      return <div className="mon-desglose-aviso">Cargando el desglose…</div>;
    }
    if (estado.fallo) {
      return <div className="mon-desglose-aviso mon-mal">{estado.fallo}</div>;
    }
    const lista = estado.lista || [];
    if (lista.length === 0) {
      return <div className="mon-desglose-aviso">Todavía no hay nada registrado en este tramo.</div>;
    }
    return (
      <div className="mon-desglose">
        {/* LO QUE NO ESTÁ, DICHO. Aquí solo salen los elementos con fila:
          * los que nadie ha revisado no existen para el servidor, porque la
          * lista completa vive en el KMZ que lleva la app. Callarlo haría
          * leer «el tramo II tiene 43 elementos» cuando lo que dice es «43
          * están revisados». */}
        <div className="mon-desglose-aviso">
          {lista.length} elemento{lista.length === 1 ? '' : 's'} registrado
          {lista.length === 1 ? '' : 's'} en el tramo {t.tramo}, en el orden
          en que se caminan. Los que falten por revisar no aparecen todavía.
        </div>
        <table className="mon-desglose-tabla">
          <thead>
            <tr>
              <th>Elemento</th>
              <th>Resultado</th>
              <th>Quién</th>
              <th>Cuándo</th>
            </tr>
          </thead>
          <tbody>
            {lista.map(v => (
              <tr key={v.id} className={v.sin_novedad ? undefined : 'mon-con-hallazgo'}>
                <td>
                  {/* EL SIMBOLO AL LADO. Cuarenta filas de texto se leen
                    * todas iguales; el simbolo deja ver de un vistazo que
                    * en esta franja hay un tunel y aqui al lado una canoa,
                    * que es como se reconoce el recorrido. Es la misma
                    * simbologia del inventario y del panel de capas, para
                    * que la misma estructura se vea igual en las tres
                    * pantallas. */}
                  <div className="mon-el-fila">
                    {(() => {
                      const sim = simboloDeElemento(v.elemento, v.tipo_elemento);
                      return sim
                        ? <img className="mon-el-sim" src={sim.src}
                               alt={sim.nombre} title={sim.nombre} />
                        : <span className="mon-el-sim mon-el-sin" />;
                    })()}
                    <div>
                      <div className="mon-el-nombre">
                        {v.elemento || 'Todo el tramo'}
                      </div>
                      <div className="mon-sub">
                        {v.tipo_elemento === 'obra' ? 'Obra de arte'
                          : v.tipo_elemento === 'subtramo' ? 'Sub-tramo'
                          : 'Tramo entero'}
                      </div>
                    </div>
                  </div>
                </td>
                <td>
                  {v.sin_novedad ? (
                    <span className="mon-el-ok">Sin novedad</span>
                  ) : (
                    <>
                      <span className="mon-el-mal">Con hallazgo</span>
                      {v.codigo && <div className="mon-codigo">{v.codigo}</div>}
                      {v.observacion && (
                        <div className="mon-sub">{v.observacion}</div>
                      )}
                      {v.incidente && (
                        <button type="button" className="mon-ver-inc"
                          onClick={() => irAIncidente && irAIncidente(v.incidente)}
                          disabled={!irAIncidente}
                          title="Abrir el hallazgo para gestionarlo">
                          <FaExternalLinkAlt size={10} /> Gestionar el hallazgo
                        </button>
                      )}
                    </>
                  )}
                </td>
                <td className="mon-sub">{v.por ? v.por.nombre : '—'}</td>
                <td className="mon-sub">{cuando(v.registrada_en)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  /* Despliega un tramo y trae sus elementos la primera vez. */
  const alternarDesglose = async (tramo) => {
    const id = tramo.id;
    const ya = desglose[id];
    if (ya && !ya.fallo) {
      setDesglose(d => ({ ...d, [id]: { ...ya, abierto: !ya.abierto } }));
      return;
    }
    setDesglose(d => ({ ...d, [id]: { abierto: true, cargando: true } }));
    const { ok, res, datos } = await pedir(`${API}tramos/${id}/elementos/`,
      { callar: [403, 404] });
    if (!ok) {
      /* Un 404 aquí es un servidor sin esta parte del parche, no un tramo
       * que no existe: el tramo lo acabamos de sacar de la misma rutina. */
      const porQue = res && res.status === 404
        ? 'Este servidor todavía no sirve el desglose. Aplica el parche de monitoreos.'
        : (res ? `El servidor respondió ${res.status}.` : 'No se pudo consultar.');
      setDesglose(d => ({ ...d, [id]: { abierto: true, fallo: porQue } }));
      return;
    }
    setDesglose(d => ({
      ...d,
      [id]: { abierto: true, lista: (datos && datos.results) || [] },
    }));
  };

  /* ── Acciones ──────────────────────────────────────────────────────── */

  const crear = async () => {
    const hoy = hoyISO();
    const { value: datos } = await Swal.fire({
      title: 'Nueva rutina',
      html:
        `<input id="m-nom" class="swal2-input" maxlength="140"
                placeholder="Nombre (ej. Recorrido noviembre 2026)">
         <label class="mon-lbl">Desde</label>
         <input id="m-ini" class="swal2-input" type="date" value="${hoy}">
         <label class="mon-lbl">Hasta</label>
         <input id="m-fin" class="swal2-input" type="date" value="${hoy}">
         <textarea id="m-not" class="swal2-textarea"
                   placeholder="Notas (opcional)"></textarea>
         <p class="mon-ayuda">Nace con los 14 tramos del Canal Madre.
           Los que no apliquen se dejan sin asignar.</p>`,
      focusConfirm: false,
      showCancelButton: true,
      confirmButtonText: 'Crear',
      cancelButtonText: 'Cancelar',
      preConfirm: () => {
        const v = (id) => (document.getElementById(id).value || '').trim();
        if (!v('m-nom')) {
          Swal.showValidationMessage('Ponle un nombre que distinga esta ronda.');
          return false;
        }
        if (!v('m-ini') || !v('m-fin')) {
          Swal.showValidationMessage('Hacen falta las dos fechas.');
          return false;
        }
        if (v('m-fin') < v('m-ini')) {
          Swal.showValidationMessage('La fecha de fin es anterior a la de inicio.');
          return false;
        }
        return { nombre: v('m-nom'), fecha_inicio: v('m-ini'),
          fecha_fin: v('m-fin'), notas: v('m-not') };
      },
    });
    if (!datos) return;

    setOcupado(true);
    const { ok, res, datos: resp } = await pedir(`${API}rutinas/`,
      { method: 'POST', body: JSON.stringify(datos) });
    setOcupado(false);
    if (!ok) {
      let detalle = res ? `El servidor respondió ${res.status}.` : 'Sin respuesta.';
      try { const j = await res.clone().json(); if (j.detail) detalle = j.detail; }
      catch { /* queda el genérico */ }
      Swal.fire('No se pudo crear', detalle, 'error');
      return;
    }
    await cargar(resp && resp.rutina && resp.rutina.id);

    /* DE DONDE SALIO EL REPARTO, DICHO.
     *
     * Heredar de la ronda anterior es repetir una decisión que ya se tomó;
     * sacarlo del cuadro es que el sistema CRUZÓ nombres escritos a mano
     * con cuentas, y eso hay que mirarlo antes de darlo por bueno. No son
     * lo mismo y la pantalla no debería presentarlos igual. */
    const delCuadro = resp && resp.del_cuadro;
    if (delCuadro) {
      Swal.fire({
        icon: 'info',
        title: 'Rutina creada',
        html: `${resp.heredados ? `${resp.heredados} tramo(s) vienen de la `
          + 'ronda anterior, y ' : ''}`
          + `<b>${delCuadro} tramo(s) se asignaron desde el cuadro</b>`
          + ' de JURP, cruzando el nombre del coordinador con su cuenta.'
          + '<br><br>Revísalos: donde el nombre coincidía con dos cuentas'
          + ' —o con ninguna— el tramo quedó vacío a propósito.',
      });
    }
  };

  const guardarAsignaciones = async () => {
    const asignaciones = Object.keys(pendientes).map(tramo => ({
      tramo, usuarios: pendientes[tramo] || [],
    }));
    setOcupado(true);
    const { ok, datos, res } = await pedir(`${API}rutinas/${elegida.id}/asignar/`,
      { method: 'POST', body: JSON.stringify({ asignaciones }) });
    setOcupado(false);

    if (!ok) {
      /* `pedir` deja `datos` en null siempre que la respuesta no fue 2xx,
       * así que el motivo hay que sacarlo del cuerpo a mano. Sin esto el
       * aviso decía «respondió 400» y se callaba el porqué, que es lo único
       * que sirve para arreglarlo. */
      let detalle = res ? `El servidor respondió ${res.status}.` : 'Sin respuesta.';
      try { const j = await res.clone().json(); if (j.detail) detalle = j.detail; }
      catch { /* queda el genérico */ }
      Swal.fire('No se pudo guardar', detalle, 'error');
      return;
    }

    /* EL SERVIDOR PUEDE SER MÁS VIEJO QUE ESTA PANTALLA. El reparto de
     * varias personas por tramo se manda en `usuarios`; un servidor sin ese
     * parche lee el `usuario` suelto de antes, no lo encuentra, y deja el
     * tramo VACÍO. Devuelve 200 y la pantalla, obediente, borraba las
     * fichas: parecía que guardar no hacía nada cuando en realidad estaba
     * desasignando.
     *
     * Se reconoce porque los tramos vuelven sin la clave `asignados`. En ese
     * caso no se pisa lo que hay en pantalla y se dice qué falta. */
    const vuelven = (datos && datos.rutina && datos.rutina.tramos) || [];
    if (vuelven.length && !vuelven.some(x => x.asignados !== undefined)) {
      Swal.fire('El servidor todavía no admite varios por tramo',
        'Falta aplicar el parche de monitoreos en PLUVIRA y correr '
        + '<code>migrate core</code>. No se guardó nada.', 'warning');
      return;
    }
    /* El servidor contesta 207 cuando guardó unas sí y otras no. Guardar a
     * medias y decir «listo» es peor que fallar: el que queda sin asignar no
     * aparece por ninguna parte hasta que alguien lo echa de menos. */
    if (datos && datos.fallos && datos.fallos.length) {
      Swal.fire('Se guardó a medias',
        `No se pudo con: ${esc(datos.fallos.join('; '))}`, 'warning');
    }
    if (datos && datos.rutina) { setElegida(datos.rutina); setPendientes({}); }
  };

  /**
   * Escribe el celular de una persona y lo guarda en su cuenta.
   *
   * SE GUARDA EN LA CUENTA Y NO EN EL CUADRO. El cuadro es de JURP y dice a
   * quién avisar POR TRAMO; esto es el número de una persona, que la sigue
   * aunque cambie de tramo o no aparezca en el cuadro.
   */
  const pedirCelular = async (persona) => {
    if (!persona || !persona.id) return;
    const { value: numero } = await Swal.fire({
      title: `Celular de ${esc(persona.nombre || persona.username)}`,
      input: 'tel',
      inputValue: persona.celular || '',
      inputPlaceholder: '9XXXXXXXX',
      inputAttributes: { maxlength: 12, inputmode: 'numeric' },
      html: persona.celular_origen === 'cuadro'
        ? '<p style="font-size:.85em;color:#64748b">Ahora sale del cuadro de '
          + 'JURP. Lo que escribas aquí queda en su cuenta y manda sobre el '
          + 'cuadro.</p>'
        : '<p style="font-size:.85em;color:#64748b">Nueve dígitos, '
          + 'empezando en 9. Déjalo vacío para quitarlo.</p>',
      showCancelButton: true,
      confirmButtonText: 'Guardar',
      cancelButtonText: 'Cancelar',
      inputValidator: (v) => {
        const d = String(v || '').replace(/\D/g, '');
        if (d && (d.length !== 9 || d[0] !== '9')) {
          return 'Un celular son 9 dígitos y empieza en 9.';
        }
        return null;
      },
    });
    if (numero === undefined) return;      // canceló

    setOcupado(true);
    const { ok, res, datos } = await pedir(`${API}telefono/`, {
      method: 'POST',
      body: JSON.stringify({ usuario: persona.id, celular: numero }),
      callar: [404],
    });
    setOcupado(false);

    if (!ok) {
      if (res && res.status === 404) {
        Swal.fire('Este servidor no lo admite todavía',
          'Falta aplicar el parche de monitoreos en PLUVIRA.', 'info');
        return;
      }
      let detalle = res ? `El servidor respondió ${res.status}.` : 'Sin respuesta.';
      try { const j = await res.clone().json(); if (j.detail) detalle = j.detail; }
      catch { /* queda el genérico */ }
      Swal.fire('No se pudo guardar', detalle, 'error');
      return;
    }

    /* Se refresca en sitio en vez de recargar la rutina entera: recargar
     * perdería el reparto que estuviera a medio hacer. */
    const nueva = (datos && datos.persona) || null;
    if (nueva) {
      setCandidatos(cs => cs.map(c => (c.id === nueva.id ? { ...c, ...nueva } : c)));
      setElegida(r => r && ({
        ...r,
        tramos: (r.tramos || []).map(x => ({
          ...x,
          asignados: (x.asignados || []).map(
            a => (a.id === nueva.id ? { ...a, ...nueva } : a)),
        })),
      }));
    }
  };

  /**
   * Cierra la rutina, o la vuelve a abrir.
   *
   * CERRAR NO ES BORRAR, Y POR ESO SE PUEDE DESHACER. Una ronda se cierra
   * cuando se da por terminada, y eso se decide mirando un tablero donde
   * casi siempre falta algún tramo: cerrarla de más es un error de un clic,
   * y sin vuelta atrás obligaría a crear otra rutina y repartir los catorce
   * tramos otra vez. Lo registrado no se toca en ninguno de los dos
   * sentidos.
   */
  /* Borrar una rutina entera.
   *
   * ──────────────────────────────────────────────────────────────────
   * ESTO NO ES «CERRAR»
   * ──────────────────────────────────────────────────────────────────
   *
   * Cerrar deja la ronda como está y la saca del trabajo pendiente; esto
   * la hace desaparecer con los registros de quien la recorrió dentro. Es
   * para una rutina creada por error o de prueba, no para una que ya se
   * anduvo — por eso va en rojo, aparte, y el servidor exige confirmar
   * cuando hay algo que perder.
   *
   * SE PREGUNTA PRIMERO. El primer DELETE va sin confirmar justamente para
   * que el servidor cuente qué hay dentro: así el aviso dice «43 registros
   * y 1 hallazgo», que es lo que hace falta para decidir, en vez de un
   * «¿seguro?» que nadie lee. */
  const borrarRutina = async () => {
    if (!elegida) return;

    /* QUÉ HAY DENTRO, SIN PREGUNTARLE AL SERVIDOR.
     *
     * La rutina que se está mirando ya trae sus tramos con el número de
     * registros, así que la cuenta sale de lo que hay en pantalla. Antes se
     * tanteaba con un DELETE sin confirmar para que el servidor la diera, y
     * eso tenía un efecto feo: una rutina vacía se borraba en ese tanteo,
     * sin preguntar nada. Borrar es borrar, y siempre se pregunta. */
    const tramos = (elegida.tramos || []);
    const registros = tramos.reduce(
      (n, t) => n + (t.visitas || 0), 0);
    const hallazgos = tramos.reduce(
      (n, t) => n + (t.elementos_con_hallazgo || t.hallazgos || 0), 0);

    const r = await Swal.fire({
      icon: 'warning',
      title: `¿Borrar «${esc(elegida.nombre)}»?`,
      html: (registros
        ? `Tiene <b>${registros} registro(s)</b>`
          + (hallazgos ? ` y <b>${hallazgos} hallazgo(s)</b>` : '')
          + ' de los recorridos ya hechos. Se borran con ella y no hay'
          + ' vuelta atrás.<br><br>'
          + 'Los incidentes de los hallazgos NO se borran: vuelven a la'
          + ' lista de Incidentes.<br><br>'
        : 'No tiene ningún recorrido registrado, así que no se pierde'
          + ' nada de campo.<br><br>')
        + 'El reparto de los tramos tampoco se pierde: vive aparte y lo'
        + ' hereda la siguiente rutina.<br><br>'
        + 'Si solo quieres que deje de aparecer en la app, usa'
        + ' <b>Cerrar rutina</b>.',
      showCancelButton: true,
      focusCancel: true,
      confirmButtonText: 'Sí, borrarla',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#d63939',
    });
    if (!r.isConfirmed) return;

    setOcupado(true);
    const { ok, res, datos } = await pedir(
      `${API}rutinas/${elegida.id}/?confirmar=1`,
      { method: 'DELETE', callar: [404, 409] });
    setOcupado(false);

    if (!ok) {
      let porQue = null;
      try { porQue = await res.clone().json(); } catch { /* no es JSON */ }
      Swal.fire('No se pudo borrar',
        (porQue && porQue.detail)
          || (res ? `El servidor respondió ${res.status}.` : 'Sin respuesta.'),
        'error');
      return;
    }
    await Swal.fire('Rutina borrada',
      `Se borró «${esc((datos && datos.borrada) || elegida.nombre)}».`,
      'success');
    await cargar();
  };

  const alternarCierre = async () => {
    const cerrando = !elegida.cerrada;
    const r = await Swal.fire({
      icon: cerrando ? 'warning' : 'question',
      title: cerrando
        ? `¿Cerrar «${esc(elegida.nombre)}»?`
        : `¿Reabrir «${esc(elegida.nombre)}»?`,
      html: cerrando
        ? 'Deja de aparecer en la app y no se podrán registrar más '
          + 'recorridos.<br><br>Lo registrado se conserva, y se puede '
          + 'reabrir.'
        : 'Vuelve a aparecer en la app de quienes tienen tramos asignados, '
          + 'y se podrán registrar recorridos otra vez.'
          + '<br><br>Si sus fechas ya pasaron, no aparecerá en la app hasta '
          + 'que las cambies: ahí solo salen las rutinas vigentes.',
      showCancelButton: true,
      confirmButtonText: cerrando ? 'Sí, cerrar' : 'Sí, reabrir',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: cerrando ? '#b45309' : '#15803d',
      focusCancel: cerrando,
    });
    if (!r.isConfirmed) return;

    setOcupado(true);
    const { ok, res, datos } = await pedir(`${API}rutinas/${elegida.id}/`,
      { method: 'POST', body: JSON.stringify({ cerrada: cerrando }) });
    setOcupado(false);

    if (!ok) {
      let detalle = res ? `El servidor respondió ${res.status}.` : 'Sin respuesta.';
      try { const j = await res.clone().json(); if (j.detail) detalle = j.detail; }
      catch { /* queda el genérico */ }
      Swal.fire(cerrando ? 'No se pudo cerrar' : 'No se pudo reabrir',
        detalle, 'error');
      return;
    }
    if (datos && datos.rutina) { setElegida(datos.rutina); await cargar(elegida.id); }
  };

  /* ── Pintado ───────────────────────────────────────────────────────── */

  if (soporte === 'no-soportado') {
    return (
      <div className="mon">
        <Cabecera avisados={avisados} />
        <div className="mon-nota">
          Este servidor todavía no tiene los monitoreos rutinarios.
          Falta aplicar el parche en PLUVIRA.
        </div>
      </div>
    );
  }

  return (
    <div className="mon">
      <Cabecera avisados={avisados} />

      <div className="mon-barra">
        <select className="mon-sel-rutina"
          value={elegida ? elegida.id : ''}
          onChange={e => abrir(Number(e.target.value))}
          disabled={!rutinas.length}>
          {!rutinas.length && <option value="">Todavía no hay rutinas</option>}
          {rutinas.map(r => (
            <option key={r.id} value={r.id}>
              {r.nombre} · {fecha(r.fecha_inicio)} a {fecha(r.fecha_fin)}
              {r.cerrada ? ' (cerrada)' : ''}
            </option>
          ))}
        </select>

        <button type="button" className="mon-nueva" onClick={crear}
          disabled={ocupado}>
          <FaPlus size={12} /> Nueva rutina
        </button>
        <button type="button" className="mon-btn" onClick={() => cargar()}
          disabled={cargando}>
          <FaSyncAlt size={11} /> Actualizar
        </button>
      </div>

      {fallo && <div className="mon-fallo">{fallo}</div>}
      {cargando && <div className="mon-nota">Consultando…</div>}

      {!cargando && !fallo && !rutinas.length && (
        <div className="mon-nota">
          Todavía no hay ninguna rutina. Crea la primera: nace con los 14
          tramos del Canal Madre listos para repartir.
        </div>
      )}

      {elegida && (
        <>
          <div className="mon-resumen">
            <div className="mon-resumen-dato">
              <b>{avance.hechos}</b> de {avance.total} recorridos
              <div className="mon-prog">
                <span style={{ width: `${avance.pct}%` }} />
              </div>
            </div>
            <div className="mon-resumen-dato">
              <b className={avance.conHallazgo ? 'mon-rojo' : undefined}>
                {avance.conHallazgo}
              </b> con hallazgo
            </div>
            <div className="mon-resumen-dato">
              <b className={avance.sinAsignar ? 'mon-ambar' : undefined}>
                {avance.sinAsignar}
              </b> sin asignar
            </div>
            <div className="mon-resumen-fechas">
              <FaCalendarAlt size={11} /> {fecha(elegida.fecha_inicio)} — {fecha(elegida.fecha_fin)}
              {elegida.cerrada && <span className="mon-tag mon-tag-cerrada">Cerrada</span>}
              {!elegida.cerrada && elegida.vigente && (
                <span className="mon-tag mon-tag-viva">Vigente</span>)}
            </div>
            <div className="mon-resumen-acc">
              {hayCambios && (
                <button type="button" className="mon-guardar"
                  onClick={guardarAsignaciones} disabled={ocupado}>
                  <FaSave size={11} /> Guardar asignaciones
                </button>
              )}
              <button type="button" className="mon-btn"
                onClick={alternarCierre} disabled={ocupado}>
                {elegida.cerrada
                  ? <><FaLockOpen size={11} /> Reabrir rutina</>
                  : <><FaLock size={11} /> Cerrar rutina</>}
              </button>
              <button type="button" className="mon-btn mon-btn-mal"
                onClick={borrarRutina} disabled={ocupado}
                title="Borra la rutina y todo lo registrado en ella">
                <FaTrashAlt size={11} /> Borrar
              </button>
            </div>
          </div>

          <div className="mon-tabla-wrap">
            <table className="mon-tabla">
              <thead>
                <tr>
                  <th>Tramo</th>
                  <th>Quién lo recorre</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {tramos.map(t => {
                  const est = estadoDe(t);
                  const elegido = pendientes[t.tramo] !== undefined
                    ? pendientes[t.tramo]
                    : (t.asignados || []).map(a => String(a.id));
                  const cambiado = pendientes[t.tramo] !== undefined;
                  const abierto = desglose[t.id] && desglose[t.id].abierto;
                  return (
                    /* Dos filas por tramo: la suya y, debajo, su desglose.
                     * Van bajo un Fragment porque una tabla no admite nada
                     * entre <tbody> y <tr>, y el desglose necesita el ancho
                     * entero -el nombre de un sub-tramo no cabe en una
                     * celda de tres-. */
                    <Fragment key={t.id}>
                    <tr className={cambiado ? 'mon-cambiado' : undefined}>
                      <td className="mon-tramo">
                        {t.tramo}
                        {/* DESPLEGAR EL TRAMO. La fila dice cuantos van;
                          * esto dice CUALES y como se evaluo cada uno, que
                          * es lo que hace falta para revisar un recorrido
                          * o para responder "cuando se miro la entrega
                          * E12". Se pide solo al abrirlo. */}
                        {t.visitas > 0 && (
                          <button type="button" className="mon-desplegar"
                            onClick={() => alternarDesglose(t)}
                            title="Ver los elementos revisados">
                            {desglose[t.id] && desglose[t.id].abierto
                              ? <FaChevronUp size={9} />
                              : <FaChevronDown size={9} />}
                            {t.elementos_revisados || t.visitas}
                          </button>
                        )}
                      </td>

                      <td>
                        {/* FICHAS Y NO UNA LISTA MULTIPLE. Un <select
                            multiple> obliga a mantener pulsado Ctrl para
                            sumar y deselecciona todo con un clic suelto: en
                            una tabla de catorce filas eso se paga con
                            repartos borrados sin querer. Con fichas, quitar
                            es un botón y añadir es elegir. */}
                        {elegido.length > 0 && (
                          <div className="mon-fichas">
                            {elegido.map(id => (
                              <span key={id} className="mon-ficha">
                                {nombreDe(id, t)}
                                {/* El celular de quien recorre, marcable. En
                                    una tablet en campo evita copiar nueve
                                    cifras a mano, que es donde se equivoca
                                    todo el mundo. */}
                                {celularDe(id, t) ? (
                                  <>
                                    <a className="mon-tel"
                                      href={`tel:${celularDe(id, t)}`}
                                      onClick={e => e.stopPropagation()}>
                                      <FaPhoneAlt size={8} /> {celularDe(id, t)}
                                    </a>
                                    <button type="button" className="mon-lapiz"
                                      title="Corregir el celular"
                                      disabled={ocupado}
                                      onClick={() => pedirCelular(fichaDe(id, t))}>
                                      <FaPen size={8} />
                                    </button>
                                  </>
                                ) : (
                                  /* SIN NUMERO, UN BOTON PARA PONERLO. El
                                     cruce con el cuadro no siempre acierta
                                     -el cuadro dice «ILICH LOPEZ» y la
                                     cuenta «Ilich Lopez Camones»- y hay
                                     gente que recorre y no está en él. */
                                  <button type="button" className="mon-poner"
                                    disabled={ocupado}
                                    onClick={() => pedirCelular(fichaDe(id, t))}>
                                    <FaPhoneAlt size={8} /> poner celular
                                  </button>
                                )}
                                {!elegida.cerrada && (
                                  <button type="button" className="mon-quita"
                                    title="Quitar"
                                    disabled={ocupado}
                                    onClick={() => cambiar(t.tramo,
                                      elegido.filter(x => x !== id))}>
                                    <FaTimes size={9} />
                                  </button>
                                )}
                              </span>
                            ))}
                          </div>
                        )}
                        <ElegirPersona
                          gente={candidatos.filter(
                            c => !elegido.includes(String(c.id)))}
                          deshabilitado={elegida.cerrada || ocupado}
                          rotulo={elegido.length ? 'Añadir a alguien más'
                            : 'Asignar a alguien'}
                          onElegir={(id) => cambiar(t.tramo, [...elegido, id])} />
                        {/* A QUIÉN BUSCAR EN LA LISTA. El padrón tiene más de
                            sesenta cuentas móviles y catorce de los treinta y
                            un coordinadores tienen dos, así que sin tener
                            delante el nombre del que corresponde a este tramo
                            hay que ir a buscarlo al cuadro de papel. */}
                        {elegido.length === 0 && (t.contactos || []).length > 0 && (
                          <div className="mon-sub mon-pista">
                            del cuadro: {(t.contactos || [])
                              .map(c => `${c.coordinador} (${c.empresa})`)
                              .join(' · ')}
                          </div>
                        )}
                        {t.visitas > 0 && (
                          <div className="mon-sub">
                            {t.visitas} registro{t.visitas === 1 ? '' : 's'}
                            {t.detalle && t.detalle[0] && t.detalle[0].por
                              && ` · último por ${t.detalle[0].por.nombre}`}
                          </div>
                        )}
                      </td>

                      <td>
                        <span className={`mon-estado mon-${est.clave}`}>
                          {ICONO[est.clave]} {est.texto}
                        </span>
                        {(t.elementos_con_hallazgo > 0 || t.hallazgos > 0) && (
                          <div className="mon-sub">
                            {t.elementos_con_hallazgo > 0
                              ? `${t.elementos_con_hallazgo} elemento${
                                  t.elementos_con_hallazgo === 1 ? '' : 's'
                                } con hallazgo`
                              : `${t.hallazgos} hallazgo${
                                  t.hallazgos === 1 ? '' : 's'
                                }`}
                          </div>
                        )}
                        {t.elementos_revisados > 0
                          && t.elementos_con_hallazgo > 0 && (
                          <div className="mon-sub">
                            {t.elementos_revisados} elementos revisados
                          </div>
                        )}

                        {/* QUE se encontro, y como llegar a atenderlo.
                          *
                          * Decir «1 elemento con hallazgo» y pararse ahi
                          * obliga a ir a Incidentes, buscar cual de los
                          * ocho es y cruzarlo de memoria. El hallazgo YA es
                          * un incidente -lo crea el mismo formulario de
                          * campo-, asi que desde aqui se abre su gestion
                          * directamente, con su costeo y su parte diario.
                          *
                          * El servidor manda en `detalle` solo los
                          * hallazgos cuando responde a esta pantalla: los
                          * «sin novedad» son cientos y ya van contados
                          * arriba. */}
                        {(t.detalle || [])
                          .filter(v => v && !v.sin_novedad)
                          .map(v => (
                            <div key={v.id} className="mon-hallazgo">
                              <div className="mon-hallazgo-que">
                                {v.elemento || 'Todo el tramo'}
                              </div>
                              {v.observacion && (
                                <div className="mon-sub">{v.observacion}</div>
                              )}
                              {v.codigo && (
                                <div className="mon-sub mon-codigo">{v.codigo}</div>
                              )}
                              {v.incidente ? (
                                <button
                                  type="button"
                                  className="mon-ver-inc"
                                  onClick={() => irAIncidente && irAIncidente(v.incidente)}
                                  disabled={!irAIncidente}
                                  title="Abrir el hallazgo para gestionarlo"
                                >
                                  <FaExternalLinkAlt size={10} /> Gestionar el hallazgo
                                </button>
                              ) : (
                                /* Un hallazgo sin incidente es el que se
                                 * registro en masivo con observacion: no
                                 * hay nada que abrir, y decirlo evita que
                                 * alguien lo busque en Incidentes. */
                                <div className="mon-sub mon-pista">
                                  sin incidente enlazado
                                </div>
                              )}
                            </div>
                          ))}
                      </td>

                    </tr>
                    {abierto && (
                      <tr className="mon-fila-desglose">
                        <td colSpan={3}>
                          {pintarDesglose(t, desglose[t.id])}
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

const Cabecera = ({ avisados = [] }) => (
  <div className="mon-cab">
    <h2><FaClipboardRoute /> Monitoreo de Sistema Hidráulico</h2>
    <p>
      Una ronda con fecha de inicio y fin. Cada tramo del Canal Madre lo
      recorre el coordinador de su empresa usuaria, que en la app registra lo
      que encontró — sin novedad, o un hallazgo con el formulario de
      incidente de siempre.
    </p>
    {/* A QUIÉN SE AVISA NO ES UNA COLUMNA. Es el grupo de Gerencia entero y
        es el mismo para los catorce tramos: repetirlo en cada fila sería
        catorce veces el mismo dato ocupando el sitio del que sí cambia. */}
    <p className="mon-avisa">
      <FaBell size={11} /> Los hallazgos se avisan al grupo de <b>Gerencia</b>
      {avisados.length > 0 && (
        <span className="mon-sub">
          {' '}— {avisados.map(a => a.nombre).join(', ')}
        </span>
      )}
    </p>
  </div>
);

/* Un icono propio: react-icons no trae ninguno que diga «recorrido por
 * tramos», y los que se le parecen ya los usa otro menú. */
const FaClipboardRoute = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round"
    strokeLinejoin="round" aria-hidden="true">
    <path d="M4 20c3 0 3-6 6-6s3 6 6 6 4-4 4-4" />
    <circle cx="5" cy="6" r="2.4" />
    <circle cx="19" cy="6" r="2.4" />
    <path d="M7.4 6h9.2" strokeDasharray="2 2.5" />
  </svg>
);


/* Normaliza para buscar: sin tildes y en minúsculas. El padrón tiene
 * «Ludeña», «Mariños» y «Centurión», y quien escribe deprisa en una tablet
 * no pone la tilde. */
const normaliza = (t) => String(t || '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/**
 * Elegir una persona de una lista larga, escribiendo.
 *
 * POR QUÉ NO UN <select>. El padrón pasa de sesenta cuentas móviles. Un
 * desplegable nativo con sesenta opciones obliga a recorrerlas con la rueda
 * buscando un apellido, y encima catorce de los coordinadores tienen DOS
 * cuentas casi iguales —«Aemilio» y «Ealvarez» son la misma persona—, así
 * que hay que leerlas con calma justo cuando menos se puede.
 *
 * POR QUÉ NO SELECT2. Es jQuery, y esto es React 19. Meter jQuery para un
 * desplegable significa dos librerías manipulando el mismo DOM y un bulto
 * que hay que cargar en cada pantalla.
 *
 * SE ABRE HACIA ABAJO EMPUJANDO LA FILA, no flotando. La tabla puede tener
 * barra de desplazamiento, y un panel flotante dentro de un contenedor con
 * overflow sale cortado: se ve media lista y no hay manera de llegar al
 * resto.
 */
function ElegirPersona({ gente, onElegir, deshabilitado, rotulo }) {
  const [abierto, setAbierto] = useState(false);
  const [texto, setTexto] = useState('');
  const [marcado, setMarcado] = useState(0);
  const caja = useRef(null);
  const campo = useRef(null);

  useEffect(() => {
    if (!abierto) return undefined;
    const fuera = (e) => {
      if (caja.current && !caja.current.contains(e.target)) setAbierto(false);
    };
    document.addEventListener('mousedown', fuera);
    return () => document.removeEventListener('mousedown', fuera);
  }, [abierto]);

  useEffect(() => {
    if (abierto && campo.current) campo.current.focus();
  }, [abierto]);

  const filtrada = useMemo(() => {
    const t = normaliza(texto).trim();
    if (!t) return gente;
    /* Se buscan TODAS las palabras, en cualquier orden: «alvarez emilio»
     * encuentra lo mismo que «emilio alvarez». */
    const partes = t.split(/\s+/);
    return gente.filter((p) => {
      const h = normaliza(
        `${p.nombre} ${p.username} ${p.grupo || ''} ${p.celular || ''}`);
      return partes.every(x => h.includes(x));
    });
  }, [gente, texto]);

  const elegir = (p) => {
    if (!p) return;
    onElegir(String(p.id));
    setTexto('');
    setAbierto(false);
  };

  const teclas = (e) => {
    if (e.key === 'Escape') { setAbierto(false); return; }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setMarcado(m => Math.min(m + 1, filtrada.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setMarcado(m => Math.max(m - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      elegir(filtrada[marcado]);
    }
  };

  if (!abierto) {
    return (
      <button type="button" className="mon-abrir" disabled={deshabilitado}
        onClick={() => { setAbierto(true); setMarcado(0); }}>
        <FaSearch size={10} /> {rotulo}
      </button>
    );
  }

  return (
    <div className="mon-buscador" ref={caja}>
      <input ref={campo} className="mon-busca" type="text"
        placeholder="Escribe un nombre o un usuario…"
        value={texto}
        onChange={(e) => { setTexto(e.target.value); setMarcado(0); }}
        onKeyDown={teclas} />
      <div className="mon-lista">
        {filtrada.length === 0 && (
          <div className="mon-vacio">Nadie coincide con «{texto}».</div>
        )}
        {filtrada.map((p, i) => (
          <button key={p.id} type="button"
            className={`mon-opcion${i === marcado ? ' act' : ''}`}
            onMouseEnter={() => setMarcado(i)}
            onClick={() => elegir(p)}>
            <b>{p.nombre}</b>
            <span className="mon-sub">
              {p.username}
              {p.grupo === 'mobile_gerencia' ? ' · gerencia' : ''}
              {p.celular ? ` · ${p.celular}` : ''}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
