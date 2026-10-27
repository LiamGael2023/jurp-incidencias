/**
 * El presupuesto de un proyecto: verlo, y escribirlo cuando no hay Excel.
 *
 * POR QUE HACIA FALTA. La pantalla de Proyectos decía cuántas partidas tiene
 * cada uno y cuánto suman, pero no dejaba verlas. Para mirar el presupuesto
 * había que entrar a una actividad y abrir el selector, que es un sitio para
 * ELEGIR una partida, no para leer el cuadro. Y un proyecto sin Excel se
 * quedaba en «sin presupuesto» para siempre: la única forma de cargarlo era
 * importar un archivo que a veces no existe.
 *
 * EL ARBOL SE ARMA EN EL NAVEGADOR. El servidor devuelve las partidas en una
 * lista plana, y cada una trae su `ruta` —el camino de ancestros que dejó el
 * importador—. De ahí salen los títulos. No hace falta endpoint nuevo para
 * VER el presupuesto; sí para escribirlo.
 *
 * POR QUE NO SIRVE EL IMPORTADOR PARA ESCRIBIR A MANO. El endpoint de
 * importación rechaza cualquier fila sin unidad —"sin unidad no se puede
 * medir el avance"— y un título no tiene unidad. Además recibe la lista
 * entera y desactiva lo que no venga: mandarle una partida suelta
 * desactivaría el resto del presupuesto. Así que el alta va por su propia
 * ruta, y mientras no esté aplicada en el servidor se dice, en vez de
 * ofrecer un botón que devuelve 404.
 */
import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  FaTimes, FaPlus, FaSyncAlt, FaExclamationTriangle, FaFolderOpen,
} from 'react-icons/fa';
import Swal from 'sweetalert2';
import { API_OPS } from './api';
import { construirArbol, totalesDe, destinosDe, dondeVa } from './arbolPresupuesto';
import TablaPresupuesto from './TablaPresupuesto';
import FormaPartida from './FormaPartida';
import './GestionCosteo.css';

const Portal = ({ children }) => createPortal(children, document.body);

const soles = (n) => 'S/ ' + (parseFloat(n) || 0).toLocaleString('es-PE',
  { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const VACIA = { descripcion: '', unidad: '', metrado: '', precio: '', padre: '' };

export default function PresupuestoProyecto({ proyecto, abierto, onCerrar, onCambio }) {
  const [filas, setFilas] = useState([]);
  const [cargando, setCargando] = useState(false);
  const [fallo, setFallo] = useState('');
  // 'probando' | 'ok' | 'no-soportado'
  const [soporte, setSoporte] = useState('probando');
  const [abiertoAlta, setAbiertoAlta] = useState(false);
  const [tipo, setTipo] = useState('partida');
  const [nueva, setNueva] = useState(VACIA);
  const [edit, setEdit] = useState(null);
  const [errores, setErrores] = useState({});
  const [guardando, setGuardando] = useState(false);
  const [aviso, setAviso] = useState(null);
  /* El catálogo de unidades, para sugerirlas en el formulario. Se mantiene
   * en Proyectos → Unidades; aquí solo se lee. */
  const [unidades, setUnidades] = useState([]);

  const cargar = useCallback(async () => {
    if (!proyecto) return;
    setCargando(true); setFallo('');
    try {
      const r = await fetch(
        `${API_OPS}/partidas/?obra=${encodeURIComponent(proyecto.codigo || '')}`);
      if (!r.ok) {
        /* Un fallo del servidor NO puede verse igual que un presupuesto
         * vacío: lo segundo invita a escribirlo, y escribirlo encima de uno
         * que sí existe duplicaría códigos. */
        setFallo(`El servidor respondió ${r.status} al pedir las partidas.`);
        setFilas([]);
        return;
      }
      const d = await r.json();
      setFilas(construirArbol(d.partidas || []));
    } catch (e) {
      setFallo('No se pudo consultar el presupuesto.');
      setFilas([]);
    } finally { setCargando(false); }
  }, [proyecto]);

  /* SE PREGUNTA ANTES DE OFRECER. La ruta de alta puede no existir todavía
   * en el servidor. Un GET contra ella responde 405 si está —sólo admite
   * POST— y 404 si no: eso distingue las dos cosas sin escribir nada. */
  const probar = useCallback(async () => {
    if (!proyecto) return;
    try {
      const r = await fetch(`${API_OPS}/proyectos/${proyecto.id}/partidas/`);
      setSoporte(r.status === 404 ? 'no-soportado' : 'ok');
    } catch (e) {
      setSoporte('no-soportado');
    }
  }, [proyecto]);

  useEffect(() => {
    if (!abierto || !proyecto) return;
    setAbiertoAlta(false); setEdit(null); setErrores({}); setAviso(null);
    setNueva(VACIA); setSoporte('probando');
    cargar(); probar();
    /* Sin catálogo (servidor sin el módulo) se queda vacío y FormaPartida
     * cae en su lista de sugerencias de siempre. */
    fetch(`${API_OPS}/unidades/?activo=true`)
      .then(r => (r.ok ? r.json() : []))
      .then(d => setUnidades((Array.isArray(d) ? d : (d.results || [])).map(u => u.codigo)))
      .catch(() => setUnidades([]));
  }, [abierto, proyecto, cargar, probar]);

  if (!abierto || !proyecto) return null;

  const tot = totalesDe(filas);
  const declarado = Number(proyecto.costo_directo || 0);
  // Los dos números juntos: mientras cuadren sobra uno, pero el día que no
  // cuadren enseñar solo uno escondería justamente el problema.
  const descuadre = declarado > 0 && Math.abs(declarado - tot.importe) > 0.5;

  const explicar = async (r) => {
    if (r.status === 404) {
      setAviso({ mal: true, txt: 'Este servidor todavía no admite escribir '
        + 'partidas a mano: falta aplicar parche_presupuesto_proyecto.py.' });
      return;
    }
    let d = null;
    try { d = await r.json(); } catch (e) { /* cuerpo vacío o no JSON */ }
    if (d && typeof d === 'object' && !d.detail) {
      const porCampo = {};
      for (const k of Object.keys(d)) {
        if (VACIA.hasOwnProperty(k)) porCampo[k] = [].concat(d[k]).join(' ');
      }
      if (Object.keys(porCampo).length) { setErrores(porCampo); return; }
    }
    setAviso({ mal: true, txt: (d && d.detail) || `El servidor respondió ${r.status}.` });
  };

  const crear = async () => {
    setErrores({}); setAviso(null);
    const faltan = {};
    if (!nueva.descripcion.trim()) faltan.descripcion = 'Hace falta.';
    if (tipo !== 'titulo' && !nueva.unidad.trim()) faltan.unidad = 'Hace falta.';
    if (Object.keys(faltan).length) { setErrores(faltan); return; }

    const donde = dondeVa(destinosDe(filas), nueva.padre);
    const cuerpo = tipo === 'titulo'
      ? { tipo: 'titulo', ...donde, descripcion: nueva.descripcion.trim() }
      : { tipo: 'partida', ...donde,
          descripcion: nueva.descripcion.trim(),
          unidad: nueva.unidad.trim(),
          metrado: Number(nueva.metrado) || 0,
          precio: Number(nueva.precio) || 0 };

    setGuardando(true);
    try {
      const r = await fetch(`${API_OPS}/proyectos/${proyecto.id}/partidas/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cuerpo),
      });
      if (!r.ok) { await explicar(r); return; }
      await cargar();
      // Se vacía todo MENOS dónde va: quien mete tres partidas seguidas las
      // mete en el mismo título.
      setNueva({ ...VACIA, padre: nueva.padre });
      if (onCambio) onCambio();
    } catch (e) {
      setAviso({ mal: true, txt: 'No se pudo guardar.' });
    } finally { setGuardando(false); }
  };

  const editar = async () => {
    setErrores({}); setAviso(null); setGuardando(true);
    try {
      const cuerpo = edit.es_titulo
        ? { descripcion: edit.descripcion.trim() }
        : { descripcion: edit.descripcion.trim(), unidad: edit.unidad.trim(),
            metrado: Number(edit.metrado) || 0, precio: Number(edit.precio) || 0 };
      const r = await fetch(
        `${API_OPS}/proyectos/${proyecto.id}/partidas/${edit.id}/`,
        { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(cuerpo) });
      if (!r.ok) { await explicar(r); return; }
      await cargar();
      setEdit(null);
      if (onCambio) onCambio();
    } catch (e) {
      setAviso({ mal: true, txt: 'No se pudo guardar.' });
    } finally { setGuardando(false); }
  };

  const borrar = async (f) => {
    const ok = await Swal.fire({
      icon: 'warning',
      title: `¿Quitar ${f.es_titulo ? 'el título' : 'la partida'} ${f.codigo}?`,
      text: f.descripcion,
      showCancelButton: true,
      confirmButtonText: 'Sí, quitar',
      cancelButtonText: 'Conservar',
      confirmButtonColor: '#dc2626',
      focusCancel: true,
    });
    if (!ok.isConfirmed) return;
    setAviso(null); setGuardando(true);
    try {
      const r = await fetch(
        `${API_OPS}/proyectos/${proyecto.id}/partidas/${f.id}/`, { method: 'DELETE' });
      if (!r.ok) { await explicar(r); return; }
      await cargar();
      if (onCambio) onCambio();
    } catch (e) {
      setAviso({ mal: true, txt: 'No se pudo quitar.' });
    } finally { setGuardando(false); }
  };

  const puedeEscribir = soporte === 'ok';

  return (
    <Portal>
      <div className="pre-fondo" onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCerrar();
      }}>
        <div className="pre-caja" role="dialog" aria-label="Presupuesto del proyecto">
          <div className="pre-cab">
            <div>
              <div className="pre-codigo">{proyecto.codigo}</div>
              <div className="pre-nombre">{proyecto.nombre}</div>
            </div>
            <button type="button" className="pre-cerrar" onClick={onCerrar}
              title="Cerrar"><FaTimes /></button>
          </div>

          <div className="pre-barra">
            <span className="pre-kpi">
              <b>{tot.partidas}</b> partidas
              {tot.titulos > 0 && <i> · {tot.titulos} títulos</i>}
            </span>
            <span className="pre-kpi">
              Costo directo <b>{soles(tot.importe)}</b>
            </span>
            {descuadre && (
              <span className="pre-descuadre">
                <FaExclamationTriangle size={11} />
                {' '}El Excel declara {soles(declarado)}: faltan{' '}
                {soles(Math.abs(declarado - tot.importe))}
              </span>
            )}
            <span style={{ flex: 1 }} />
            <button type="button" className="pre-btn" onClick={cargar}
              disabled={cargando}>
              <FaSyncAlt size={11} /> Actualizar
            </button>
            {puedeEscribir && ['titulo', 'partida'].map(tp => (
              <button key={tp} type="button" className="pre-btn pre-btn-alta"
                onClick={() => {
                  const cerrar = abiertoAlta && tipo === tp;
                  setAbiertoAlta(!cerrar); setTipo(tp);
                  setErrores({}); setEdit(null);
                  if (!cerrar) setNueva({ ...VACIA, padre: nueva.padre });
                }}>
                {abiertoAlta && tipo === tp
                  ? <><FaTimes size={10} /> Cancelar</>
                  : <><FaPlus size={10} /> {tp === 'titulo' ? 'Título' : 'Partida'}</>}
              </button>
            ))}
          </div>

          <div className="pre-cuerpo">
            {fallo && (
              <div className="cos-prog-nota cos-prog-mal">{fallo}</div>
            )}

            {soporte === 'no-soportado' && (
              <div className="cos-prog-nota cos-prog-falta">
                Este servidor todavía no admite escribir el presupuesto a mano.
                Se habilita aplicando <code>parche_presupuesto_proyecto.py</code>
                {' '}en el servidor. Mientras tanto se puede ver lo importado.
              </div>
            )}

            {aviso && (
              <div className={`cos-prog-nota${aviso.mal ? ' cos-prog-mal' : ''}`}>
                {aviso.txt}
              </div>
            )}

            {edit && (
              <FormaPartida
                key={`edit-${edit.id}`}
                tipo={edit.es_titulo ? 'titulo' : 'partida'}
                titulo={`Corregir ${edit.es_titulo ? 'el título' : 'la partida'} ${edit.codigo}`}
                valor={edit} errores={errores} guardando={guardando}
                onCambio={setEdit} onGuardar={editar}
                unidades={unidades}
                onCancelar={() => { setEdit(null); setErrores({}); }}
              />
            )}

            {abiertoAlta && (
              <FormaPartida
                tipo={tipo}
                padres={destinosDe(filas)}
                valor={nueva} errores={errores} guardando={guardando}
                onCambio={setNueva} onGuardar={crear}
                unidades={unidades}
                onCancelar={() => { setAbiertoAlta(false); setErrores({}); }}
              />
            )}

            {cargando && <div className="cos-prog-nota">Consultando…</div>}

            {!cargando && !fallo && filas.length === 0 && (
              <div className="pre-vacio">
                <FaFolderOpen size={26} />
                <p><b>Este proyecto no tiene presupuesto.</b></p>
                <p>
                  Sus actividades no van a tener partidas que elegir y su
                  avance será siempre cero.{' '}
                  {puedeEscribir
                    ? 'Impórtale el Excel desde la lista de proyectos, o escríbelo aquí con los botones Título y Partida.'
                    : 'Impórtale el Excel desde la lista de proyectos.'}
                </p>
              </div>
            )}

            {filas.length > 0 && (
              <TablaPresupuesto
                filas={filas}
                raiz={{ codigo: '1', descripcion: proyecto.nombre }}
                acciones={puedeEscribir}
                ocupado={guardando}
                onEditar={(f) => {
                  setErrores({}); setAbiertoAlta(false);
                  setEdit({
                    id: f.id, codigo: f.codigo, es_titulo: !!f.es_titulo,
                    descripcion: f.descripcion || '',
                    unidad: f.unidad || '',
                    metrado: f.es_titulo ? '' : String(f.metrado ?? ''),
                    precio: f.es_titulo ? '' : String(f.precio ?? ''),
                  });
                }}
                onBorrar={borrar}
              />
            )}
          </div>
        </div>
      </div>
    </Portal>
  );
}
