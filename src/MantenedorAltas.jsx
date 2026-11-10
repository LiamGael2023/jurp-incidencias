import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  FaSyncAlt, FaSearch, FaTimes, FaCheckCircle, FaBan, FaClone,
  FaMapMarkerAlt, FaExclamationCircle, FaPlusCircle, FaFileExcel,
} from 'react-icons/fa';
import ExcelJS from 'exceljs';
import Swal from 'sweetalert2';
import { TODAS_LAS_CAPAS } from './InventarioGIS';
import { API_INVENTARIO } from './api.js';
import { puntoDeEWKB, latLngToUTM, utmTexto } from './cartografia';
import './Incidentes.css';
import './EstadisticasGIS.css';
import './CampaniasInventario.css';
import './MantenedorAltas.css';

/**
 * MANTENEDOR DE ESTRUCTURAS NUEVAS: lo que llega de campo, y qué se hizo
 * con ello.
 *
 * Hasta ahora las altas se validaban desde un rinconcito del panel del
 * mapa: una lista de las PENDIENTES, con dos botones. Eso servía para ir
 * despachándolas de una en una, pero dejaba tres preguntas sin sitio donde
 * contestarse —qué se registró este año, qué se rechazó y por qué, y
 * cuántas lleva cada inspector— y una cuarta más incómoda: una vez
 * aprobada o rechazada, el alta desaparecía de la pantalla y no había
 * forma de volver a verla.
 *
 * Un alta rechazada no es basura: es la constancia de que alguien fue
 * hasta allí, miró, y se decidió que no entraba. Eso hay que poder
 * consultarlo.
 *
 * DÓNDE ESTÁ LA ESTRUCTURA. El backend manda la geometría en EWKB
 * hexadecimal, que es como la guarda PostGIS. La lista del mapa no lo leía
 * y por eso enseñaba el nombre pero no el sitio —justo lo que hay que
 * mirar antes de aprobar—. Aquí se lee (`puntoDeEWKB`) y se enseñan las
 * dos formas: grados, para pegarlos en un mapa, y UTM, que es como se
 * reporta. Si el día de mañana el serializer manda `lat`/`lng` ya hechos,
 * se usan esos y este camino sobra sin romper nada.
 *
 * APROBAR NO ES UN BOTÓN MÁS. Mete la estructura en su capa del GIS, y a
 * partir de ahí cuenta para el avance de la campaña y sale en los formatos
 * que se entregan al ANA. Por eso pide confirmación diciendo exactamente
 * eso, y por eso rechazar y duplicar piden un motivo: dentro de un año,
 * «rechazada» a secas no le sirve a nadie.
 */

const API = API_INVENTARIO;

/* Sin cabecera de autorización, como el resto del inventario: el backend
 * valida el token de PLUVIRA pero rechaza con él cualquier escritura, con
 * un 401 que salta antes de llegar a la vista. Está explicado largo en
 * CampaniasInventario.jsx. */
const cab = () => ({});

const ESTADOS = {
  pendiente: { rotulo: 'Pendiente', clase: 'est-pendiente' },
  aprobado: { rotulo: 'Aprobada', clase: 'est-aprobado' },
  rechazado: { rotulo: 'Rechazada', clase: 'est-rechazado' },
  duplicado: { rotulo: 'Duplicada', clase: 'est-duplicado' },
};

const NOMBRE_CAPA = Object.fromEntries(
  TODAS_LAS_CAPAS.map((c) => [c.codigo, c.label]));

const fecha = (s) => {
  if (!s) return '';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return String(s).slice(0, 10);
  const dos = (n) => String(n).padStart(2, '0');
  return `${dos(d.getDate())}/${dos(d.getMonth() + 1)}/${d.getFullYear()}`;
};

/** Las coordenadas del alta, vengan como vengan. */
function sitioDe(a) {
  if (Number.isFinite(a?.lat) && Number.isFinite(a?.lng)) {
    return { lat: a.lat, lng: a.lng };
  }
  return puntoDeEWKB(a?.geom || a?.geometria || '');
}

export default function MantenedorAltas({ irAActivo }) {
  const [altas, setAltas] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [trabajando, setTrabajando] = useState(null);
  const [recarga, setRecarga] = useState(0);

  const [texto, setTexto] = useState('');
  const [filtroEstado, setFiltroEstado] = useState('pendiente');
  const [filtroCapa, setFiltroCapa] = useState('');

  useEffect(() => {
    let vivo = true;
    (async () => {
      setCargando(true);
      setError(null);
      try {
        // Se piden TODAS y se filtra aquí. Son decenas, no miles: pedir por
        // estado obligaría a ir y volver al servidor en cada clic de un
        // filtro, y a recargar entera la pantalla al validar una.
        const r = await fetch(`${API}/activos-nuevos/`, { headers: cab() });
        if (!r.ok) throw new Error(`El servidor respondió ${r.status}`);
        const d = await r.json();
        if (vivo) setAltas(Array.isArray(d) ? d : (d.results || []));
      } catch (e) {
        if (vivo) setError(e.message || 'No se pudo leer la lista');
      } finally {
        if (vivo) setCargando(false);
      }
    })();
    return () => { vivo = false; };
  }, [recarga]);

  const validar = useCallback(async (a, destino) => {
    const nombre = a.nombre || a.descripcion || `#${a.id}`;
    const capa = NOMBRE_CAPA[a.tipo_activo] || a.tipo_activo;

    let nota = null;
    if (destino === 'aprobado') {
      const { isConfirmed } = await Swal.fire({
        icon: 'question',
        title: '¿Aprobar el alta?',
        html: `<b>${nombre}</b><br>${capa}<br><br>`
          + 'Entrará en su capa del GIS: a partir de ahí cuenta para el '
          + 'avance de la campaña y sale en los formatos del ANA.',
        showCancelButton: true,
        confirmButtonText: 'Sí, aprobar',
        cancelButtonText: 'No',
        confirmButtonColor: '#0CA678',
      });
      if (!isConfirmed) return;
    } else {
      const { value, isConfirmed } = await Swal.fire({
        icon: 'warning',
        title: destino === 'duplicado'
          ? '¿Marcar como duplicada?' : '¿Rechazar el alta?',
        html: `<b>${nombre}</b><br>${capa}`,
        input: 'text',
        inputLabel: 'Motivo',
        inputPlaceholder: destino === 'duplicado'
          ? 'De cuál es duplicada' : 'Por qué no entra',
        showCancelButton: true,
        confirmButtonText: 'Sí',
        cancelButtonText: 'No',
        // El motivo no es obligatorio en el servidor, pero sí aquí: dentro
        // de un año «rechazada» a secas no le sirve a nadie, y el que fue
        // hasta allí merece saber por qué no entró.
        inputValidator: (v) => (v && v.trim())
          ? undefined : 'Escribe el motivo: quedará en el historial.',
      });
      if (!isConfirmed) return;
      nota = value.trim();
    }

    setTrabajando(a.id);
    setAviso(null);
    try {
      const r = await fetch(`${API}/activos-nuevos/${a.id}/validar/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...cab() },
        body: JSON.stringify({
          validacion: destino,
          nota,
          validado_por: (() => {
            try { return localStorage.getItem('userName') || null; }
            catch { return null; }
          })(),
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        throw new Error(d.detail || d.validacion || `Error ${r.status}`);
      }
      setAviso({
        mal: false,
        texto: destino === 'aprobado'
          ? `«${nombre}» ya figura en ${capa}.`
          : `«${nombre}» quedó como ${ESTADOS[destino].rotulo.toLowerCase()}.`,
      });
      setRecarga((n) => n + 1);
    } catch (e) {
      setAviso({ mal: true, texto: e.message || 'No se pudo' });
    } finally {
      setTrabajando(null);
    }
  }, []);

  const capasConAltas = useMemo(() => {
    const vistos = new Set(altas.map((a) => a.tipo_activo));
    return TODAS_LAS_CAPAS.filter((c) => vistos.has(c.codigo));
  }, [altas]);

  const cuentas = useMemo(() => {
    const c = { pendiente: 0, aprobado: 0, rechazado: 0, duplicado: 0 };
    for (const a of altas) {
      if (c[a.validacion] !== undefined) c[a.validacion] += 1;
    }
    return c;
  }, [altas]);

  const filtradas = useMemo(() => {
    const t = texto.trim().toLowerCase();
    return altas.filter((a) => {
      if (filtroEstado && a.validacion !== filtroEstado) return false;
      if (filtroCapa && a.tipo_activo !== filtroCapa) return false;
      if (!t) return true;
      return [a.nombre, a.descripcion, a.registrado_por, a.validado_por,
        a.nota, NOMBRE_CAPA[a.tipo_activo], a.tipo_activo]
        .some((x) => String(x || '').toLowerCase().includes(t));
    }).sort((x, y) => String(y.creado || '').localeCompare(String(x.creado || '')));
  }, [altas, texto, filtroEstado, filtroCapa]);

  const exportar = useCallback(async () => {
    const libro = new ExcelJS.Workbook();
    const h = libro.addWorksheet('Estructuras nuevas');
    h.columns = [
      { header: 'Capa', key: 'capa', width: 24 },
      { header: 'Nombre', key: 'nombre', width: 22 },
      { header: 'Descripción', key: 'desc', width: 42 },
      { header: 'Latitud', key: 'lat', width: 13 },
      { header: 'Longitud', key: 'lng', width: 13 },
      { header: 'UTM', key: 'utm', width: 24 },
      { header: 'Registró', key: 'quien', width: 18 },
      { header: 'Fecha', key: 'fecha', width: 12 },
      { header: 'Estado', key: 'estado', width: 13 },
      { header: 'Validó', key: 'valido', width: 18 },
      { header: 'Motivo', key: 'nota', width: 40 },
    ];
    h.getRow(1).font = { bold: true };
    for (const a of filtradas) {
      const p = sitioDe(a);
      h.addRow({
        capa: NOMBRE_CAPA[a.tipo_activo] || a.tipo_activo,
        nombre: a.nombre || '',
        desc: a.descripcion || '',
        lat: p ? Number(p.lat.toFixed(6)) : '',
        lng: p ? Number(p.lng.toFixed(6)) : '',
        utm: p ? utmTexto(latLngToUTM(p.lat, p.lng)) : '',
        quien: a.registrado_por || '',
        fecha: fecha(a.creado),
        estado: (ESTADOS[a.validacion] || {}).rotulo || a.validacion,
        valido: a.validado_por || '',
        nota: a.nota || '',
      });
    }
    const buf = await libro.xlsx.writeBuffer();
    const url = URL.createObjectURL(new Blob([buf],
      { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'estructuras_nuevas.xlsx';
    a.click();
    URL.revokeObjectURL(url);
  }, [filtradas]);

  return (
    <div className="cmp-wrap">
      <div className="cmp-cab">
        <div className="cmp-cab-izq">
          <span className="cmp-rotulo"><FaPlusCircle /> ESTRUCTURAS NUEVAS</span>
          <span className="cmp-fechas">
            lo que llega de campo y no estaba en el inventario
          </span>
        </div>
        <div className="cmp-cab-der">
          <button className="cmp-btn" onClick={() => setRecarga((n) => n + 1)}>
            <FaSyncAlt /> Actualizar
          </button>
          <button className="cmp-btn" onClick={exportar}
            disabled={!filtradas.length}>
            <FaFileExcel /> Excel
          </button>
        </div>
      </div>

      {error && (
        <div className="cmp-error">
          <FaExclamationCircle /> <span>{error}</span>
          <button onClick={() => setError(null)}><FaTimes /></button>
        </div>
      )}
      {aviso && (
        <div className={`cmp-aviso${aviso.mal ? ' mal' : ''}`}>
          {aviso.mal ? <FaExclamationCircle /> : <FaCheckCircle />}
          <span>{aviso.texto}</span>
          <button onClick={() => setAviso(null)}><FaTimes /></button>
        </div>
      )}

      {/* Las pestañas son el filtro y el contador a la vez: el número que
          importa —cuántas esperan— se ve sin tener que buscarlo. */}
      <div className="alt-pestanas">
        {[['pendiente', 'Por validar'], ['aprobado', 'Aprobadas'],
          ['rechazado', 'Rechazadas'], ['duplicado', 'Duplicadas'],
          ['', 'Todas']].map(([clave, rotulo]) => (
          <button key={clave || 'todas'}
            className={`alt-pestana${filtroEstado === clave ? ' activa' : ''}`}
            onClick={() => setFiltroEstado(clave)}>
            {rotulo}
            <b>{clave ? cuentas[clave] : altas.length}</b>
          </button>
        ))}
      </div>

      <div className="cmp-filtros">
        <div className="cmp-buscar">
          <FaSearch />
          <input value={texto} onChange={(e) => setTexto(e.target.value)}
            placeholder="Nombre, descripción, quién la registró, motivo…" />
          {texto && (
            <button onClick={() => setTexto('')}><FaTimes /></button>
          )}
        </div>
        <select value={filtroCapa} onChange={(e) => setFiltroCapa(e.target.value)}>
          <option value="">Todas las capas</option>
          {capasConAltas.map((c) => (
            <option key={c.codigo} value={c.codigo}>{c.label}</option>
          ))}
        </select>
      </div>

      {cargando ? (
        <div className="cmp-cargando"><FaSyncAlt className="icon-spin" /> Cargando…</div>
      ) : !filtradas.length ? (
        <div className="cmp-vacio">
          {altas.length === 0
            ? 'Todavía no se ha registrado ninguna estructura desde campo.'
            : filtroEstado === 'pendiente'
              ? 'Nada por validar. Todo lo que llegó está despachado.'
              : 'Nada con esos filtros.'}
        </div>
      ) : (
        <div className="cmp-tabla-wrap">
          <table className="cmp-tabla">
            <thead>
              <tr>
                <th>CAPA</th>
                <th>ESTRUCTURA</th>
                <th>DÓNDE</th>
                <th>REGISTRÓ</th>
                <th>FECHA</th>
                <th>ESTADO</th>
                <th>MOTIVO</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtradas.map((a) => {
                const p = sitioDe(a);
                const est = ESTADOS[a.validacion] || {};
                const ocupado = trabajando === a.id;
                return (
                  <tr key={a.id}>
                    <td>{NOMBRE_CAPA[a.tipo_activo] || a.tipo_activo}</td>
                    <td>
                      <b>{a.nombre || `#${a.id}`}</b>
                      {a.descripcion && (
                        <div className="alt-desc">{a.descripcion}</div>
                      )}
                    </td>
                    <td>
                      {p ? (
                        <span className="alt-sitio">
                          {p.lat.toFixed(5)}, {p.lng.toFixed(5)}
                          <small>{utmTexto(latLngToUTM(p.lat, p.lng))}</small>
                        </span>
                      ) : (
                        <span className="alt-sin-sitio">sin coordenada</span>
                      )}
                    </td>
                    <td>{a.registrado_por || '—'}</td>
                    <td>{fecha(a.creado)}</td>
                    <td>
                      <span className={`cmp-estado ${est.clase || ''}`}>
                        {est.rotulo || a.validacion}
                      </span>
                      {a.validado_por && (
                        <div className="alt-quien">por {a.validado_por}</div>
                      )}
                    </td>
                    <td className="alt-nota">{a.nota || ''}</td>
                    <td>
                      <div className="cmp-acciones">
                        {p && irAActivo && a.validacion === 'aprobado'
                          && a.promovido_fid && (
                          <button className="cmp-ir" title="Verla en el mapa"
                            onClick={() => irAActivo({
                              tipo: a.tipo_activo, fid: a.promovido_fid,
                              lat: p.lat, lng: p.lng,
                            })}>
                            <FaMapMarkerAlt size={11} />
                          </button>
                        )}
                        {a.validacion === 'pendiente' && (
                          <>
                            <button className="alt-ok" title="Aprobar: entra en su capa"
                              disabled={ocupado}
                              onClick={() => validar(a, 'aprobado')}>
                              <FaCheckCircle size={12} />
                            </button>
                            <button className="alt-dup" title="Marcar como duplicada"
                              disabled={ocupado}
                              onClick={() => validar(a, 'duplicado')}>
                              <FaClone size={11} />
                            </button>
                            <button className="cmp-borrar" title="Rechazar"
                              disabled={ocupado}
                              onClick={() => validar(a, 'rechazado')}>
                              <FaBan size={11} />
                            </button>
                          </>
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
