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
import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  FaPlus, FaSyncAlt, FaCheckCircle, FaExclamationTriangle, FaRegCircle,
  FaSave, FaLock, FaCalendarAlt, FaBell,
} from 'react-icons/fa';
import Swal from 'sweetalert2';
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
 * lo que decide a quién hay que llamar hoy. */
function estadoDe(t) {
  if (t.hallazgos > 0) return { clave: 'hallazgo', texto: 'Con hallazgo' };
  if (t.recorrido) return { clave: 'ok', texto: 'Sin novedad' };
  return { clave: 'pendiente', texto: 'Sin recorrer' };
}

const ICONO = {
  hallazgo: <FaExclamationTriangle size={11} />,
  ok: <FaCheckCircle size={11} />,
  pendiente: <FaRegCircle size={11} />,
};

export default function Monitoreos() {
  const [rutinas, setRutinas] = useState([]);
  const [elegida, setElegida] = useState(null);     // la rutina abierta
  const [candidatos, setCandidatos] = useState([]);
  const [avisados, setAvisados] = useState([]);   // el grupo de Gerencia
  const [cargando, setCargando] = useState(true);
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
    const conHallazgo = tramos.filter(t => t.hallazgos > 0).length;
    const sinAsignar = tramos.filter(t => !t.asignado).length;
    return { total, hechos, conHallazgo, sinAsignar,
      pct: total ? Math.round((hechos / total) * 100) : 0 };
  }, [tramos]);

  const hayCambios = Object.keys(pendientes).length > 0;

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
  };

  const guardarAsignaciones = async () => {
    const asignaciones = Object.keys(pendientes).map(tramo => ({
      tramo, usuario: pendientes[tramo] || null,
    }));
    setOcupado(true);
    const { ok, datos, res } = await pedir(`${API}rutinas/${elegida.id}/asignar/`,
      { method: 'POST', body: JSON.stringify({ asignaciones }) });
    setOcupado(false);

    if (!ok && !(datos && datos.rutina)) {
      Swal.fire('No se pudo guardar',
        res ? `El servidor respondió ${res.status}.` : 'Sin respuesta.', 'error');
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

  const cerrar = async () => {
    const r = await Swal.fire({
      icon: 'warning',
      title: `¿Cerrar «${esc(elegida.nombre)}»?`,
      html: 'Deja de aparecer en la app y no se podrán registrar más '
        + 'recorridos.<br><br>Lo registrado se conserva.',
      showCancelButton: true,
      confirmButtonText: 'Sí, cerrar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#b45309',
      focusCancel: true,
    });
    if (!r.isConfirmed) return;
    setOcupado(true);
    const { ok, datos } = await pedir(`${API}rutinas/${elegida.id}/`,
      { method: 'POST', body: JSON.stringify({ cerrada: true }) });
    setOcupado(false);
    if (ok && datos && datos.rutina) { setElegida(datos.rutina); await cargar(elegida.id); }
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
              {!elegida.cerrada && (
                <button type="button" className="mon-btn" onClick={cerrar}
                  disabled={ocupado}>
                  <FaLock size={11} /> Cerrar rutina
                </button>
              )}
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
                    : (t.asignado ? String(t.asignado.id) : '');
                  const cambiado = pendientes[t.tramo] !== undefined;
                  return (
                    <tr key={t.id} className={cambiado ? 'mon-cambiado' : undefined}>
                      <td className="mon-tramo">{t.tramo}</td>

                      <td>
                        <select className="mon-sel"
                          value={elegido}
                          disabled={elegida.cerrada || ocupado}
                          onChange={e => setPendientes(p => ({
                            ...p, [t.tramo]: e.target.value,
                          }))}>
                          <option value="">— sin asignar —</option>
                          {candidatos.map(c => (
                            <option key={c.id} value={c.id}>
                              {c.nombre} ({c.username})
                              {c.grupo === 'mobile_gerencia' ? ' · gerencia' : ''}
                            </option>
                          ))}
                        </select>
                        {/* A QUIÉN BUSCAR EN LA LISTA. El padrón tiene más de
                            sesenta cuentas móviles y catorce de los treinta y
                            un coordinadores tienen dos, así que sin tener
                            delante el nombre del que corresponde a este tramo
                            hay que ir a buscarlo al cuadro de papel. */}
                        {!t.asignado && (t.contactos || []).length > 0 && (
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
                        {t.hallazgos > 0 && (
                          <div className="mon-sub">
                            {t.hallazgos} hallazgo{t.hallazgos === 1 ? '' : 's'}
                          </div>
                        )}
                      </td>

                    </tr>
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
    <h2><FaClipboardRoute /> Monitoreos rutinarios</h2>
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
