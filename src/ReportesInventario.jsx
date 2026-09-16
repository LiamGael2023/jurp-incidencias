import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  FaSyncAlt, FaFileExcel, FaDownload, FaFileArchive, FaExclamationCircle,
  FaCheckCircle, FaClipboardCheck, FaChevronDown, FaChevronRight,
} from 'react-icons/fa';
import './Incidentes.css';
import './EstadisticasGIS.css';

/**
 * Reportes del módulo INVENTARIO.
 *
 * Reúne dos cosas que antes vivían separadas: el avance de la campaña (que
 * estaba solo en el panel del mapa) y los formatos oficiales de la ANA (que
 * estaban en un panel flotante, estrecho y encima del mapa). Aquí hay
 * pantalla completa, así que los formatos van en rejilla y el avance se lee
 * de un vistazo antes de exportar.
 *
 * Los archivos no se arman en el navegador: el backend invoca al mismo
 * generador que se usa por consola, de modo que el Excel que baja la Junta
 * es idéntico al que se revisa en el servidor.
 */

const API = '/vigapi/inventario';

const AMBITOS = [
  { valor: 'JURP',  etiqueta: 'JURP',        nota: 'Lo que administra la Junta' },
  { valor: 'PECH',  etiqueta: 'Chavimochic', nota: 'Obras del Canal Madre' },
  { valor: 'todos', etiqueta: 'Todo',        nota: 'Ambos ámbitos' },
];

const pesoLegible = (b) => {
  if (!b) return '';
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1048576).toFixed(1)} MB`;
};

const fmt = (n) => (parseFloat(n) || 0).toLocaleString('es-PE');

function ReportesInventario() {
  // ── datos de campaña ──────────────────────────────────────────────────
  const [campanias, setCampanias] = useState([]);
  const [campaniaActiva, setCampaniaActiva] = useState(null);
  const [avance, setAvance] = useState([]);
  const [cargandoAvance, setCargandoAvance] = useState(true);
  const [verAvance, setVerAvance] = useState(true);

  // ── formatos ──────────────────────────────────────────────────────────
  const [ambito, setAmbito] = useState('JURP');
  const [campania, setCampania] = useState('');   // '' = inventario base
  const [formatos, setFormatos] = useState([]);
  const [cargando, setCargando] = useState(false);
  const [bajando, setBajando] = useState(null);   // clave en curso
  const [error, setError] = useState(null);

  // ── carga inicial: campañas y avance ──────────────────────────────────
  useEffect(() => {
    (async () => {
      setCargandoAvance(true);
      try {
        const rc = await fetch(`${API}/campanias/`);
        if (rc.ok) {
          const d = await rc.json();
          const lista = d.results || d;
          setCampanias(lista);
          const activa = lista.find(c => c.estado === 'en_proceso') || lista[0];
          setCampaniaActiva(activa || null);
          if (activa) {
            const ra = await fetch(`${API}/campanias/${activa.id}/avance/`);
            if (ra.ok) setAvance((await ra.json()).detalle || []);
          }
        }
      } catch (e) { /* el avance es contexto: su fallo no bloquea la descarga */ }
      finally { setCargandoAvance(false); }
    })();
  }, []);

  const parametros = useCallback(() => {
    const p = new URLSearchParams({ ambito });
    if (campania) p.set('campania', campania);
    return p.toString();
  }, [ambito, campania]);

  // El catálogo dice qué formatos hay y cuáles ya están generados, para que
  // se sepa cuáles bajan al instante y cuáles hay que armar.
  const cargarCatalogo = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const r = await fetch(`${API}/reportes/?${parametros()}`);
      if (!r.ok) throw new Error(`El servidor respondió ${r.status}`);
      const d = await r.json();
      setFormatos(d.formatos || []);
    } catch (e) {
      setError(e.message || 'No se pudo consultar los formatos');
      setFormatos([]);
    } finally { setCargando(false); }
  }, [parametros]);

  useEffect(() => { cargarCatalogo(); }, [cargarCatalogo]);

  // La descarga pasa por fetch y no por un enlace directo para poder mostrar
  // el error cuando el generador falla: un <a> dejaría al usuario con un
  // archivo de error sin explicación.
  const descargar = async (clave, nombre) => {
    setBajando(clave);
    setError(null);
    try {
      const url = clave === 'todos'
        ? `${API}/reportes/todos/?${parametros()}`
        : `${API}/reportes/${encodeURIComponent(clave)}/?${parametros()}`;

      const r = await fetch(url);
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.detail || `El servidor respondió ${r.status}`);
      }

      const blob = await r.blob();
      const enlace = document.createElement('a');
      enlace.href = URL.createObjectURL(blob);
      enlace.download = nombre;
      enlace.click();
      URL.revokeObjectURL(enlace.href);

      cargarCatalogo();   // el archivo queda en el servidor; el catálogo lo refleja
    } catch (e) {
      setError(e.message || 'No se pudo descargar');
    } finally { setBajando(null); }
  };

  // ── totales de la campaña ─────────────────────────────────────────────
  const totales = useMemo(() => avance.reduce(
    (a, x) => ({
      total: a.total + (x.total || 0),
      evaluados: a.evaluados + (x.evaluados || 0),
      criticos: a.criticos + (x.criticos || 0),
    }),
    { total: 0, evaluados: 0, criticos: 0 }
  ), [avance]);
  const pct = totales.total ? (totales.evaluados / totales.total * 100) : 0;

  const nombreZip = `Formatos_ANA_${ambito}${campania ? `_${campania}` : ''}.zip`;
  const listos = formatos.filter(f => f.generado && f.vigente).length;

  const sel = {
    padding: '9px 12px', border: '1px solid #cbd5e1', borderRadius: 8,
    fontSize: 13, color: '#334155', background: '#fff', cursor: 'pointer',
  };

  return (
    <div className="tbl-page-wrapper">
      <div className="tbl-page-header">
        <div className="tbl-row align-items-center">
          <div className="tbl-col">
            <div className="tbl-page-pretitle">Módulo Inventario</div>
            <h2 className="tbl-page-title">Reportes y formatos ANA</h2>
          </div>
          <div className="tbl-col-auto">
            <button className="tbl-btn tbl-btn-primary" onClick={cargarCatalogo}
              disabled={cargando}>
              <FaSyncAlt className={cargando ? 'icon-spin' : ''} style={{ marginRight: 8 }} />
              Actualizar
            </button>
          </div>
        </div>
      </div>

      <div className="tbl-page-body">

        {/* ── Estado de la campaña ── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                      gap: 12, marginBottom: 16 }}>
          {[
            { et: 'Campaña vigente', va: campaniaActiva?.anio || '—', col: '#0CA678' },
            { et: 'Activos', va: fmt(totales.total), col: '#1463A5' },
            { et: 'Evaluados', va: fmt(totales.evaluados), col: '#0284c7' },
            { et: 'Pendientes', va: fmt(totales.total - totales.evaluados), col: '#f59f00' },
            { et: 'Estado crítico', va: fmt(totales.criticos),
              col: totales.criticos ? '#d63939' : '#2fb344' },
          ].map(k => (
            <div key={k.et} style={{ background: '#fff', border: '1px solid #e2e8f0',
              borderLeft: `4px solid ${k.col}`, borderRadius: 10, padding: '12px 15px',
              boxShadow: '0 1px 3px rgba(0,0,0,.05)' }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: '#64748b',
                textTransform: 'uppercase', letterSpacing: '.4px' }}>{k.et}</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: '#1e293b', marginTop: 3 }}>
                {cargandoAvance ? '…' : k.va}
              </div>
            </div>
          ))}
        </div>

        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10,
                      padding: '14px 16px', marginBottom: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        fontSize: 12.5, color: '#475569', marginBottom: 8, fontWeight: 600 }}>
            <button type="button" onClick={() => setVerAvance(v => !v)}
              style={{ display: 'flex', alignItems: 'center', gap: 7, background: 'none',
                       border: 'none', padding: 0, cursor: 'pointer', font: 'inherit',
                       color: '#475569' }}>
              {verAvance ? <FaChevronDown size={10} /> : <FaChevronRight size={10} />}
              Avance de la campaña por tipo de activo
            </button>
            <span style={{ color: '#0CA678', fontWeight: 800 }}>{pct.toFixed(1)}%</span>
          </div>
          <div style={{ height: 9, background: '#f1f5f9', borderRadius: 5, overflow: 'hidden' }}>
            <div style={{ width: `${pct}%`, height: '100%',
                          background: 'linear-gradient(90deg,#0CA678,#35B6E9)' }} />
          </div>

          {verAvance && avance.length > 0 && (
            <div className="tbl-table-responsive" style={{ marginTop: 14 }}>
              <table className="tbl-table tbl-table-vcenter" style={{ fontSize: 12.5 }}>
                <thead>
                  <tr>
                    <th>TIPO DE ACTIVO</th>
                    <th className="tbl-text-end">TOTAL</th>
                    <th className="tbl-text-end">EVALUADOS</th>
                    <th className="tbl-text-end">PENDIENTES</th>
                    <th className="tbl-text-end">% AVANCE</th>
                    <th className="tbl-text-end">CRÍTICOS</th>
                  </tr>
                </thead>
                <tbody>
                  {avance.filter(a => a.total > 0).map(a => (
                    <tr key={a.tipo}>
                      <td style={{ color: '#475569' }}>{a.nombre}</td>
                      <td className="tbl-text-end">{fmt(a.total)}</td>
                      <td className="tbl-text-end" style={{ fontWeight: 700 }}>{fmt(a.evaluados)}</td>
                      <td className="tbl-text-end" style={{ color: '#b45309' }}>
                        {fmt((a.total || 0) - (a.evaluados || 0))}
                      </td>
                      <td className="tbl-text-end" style={{ fontWeight: 700, color: '#0CA678' }}>
                        {a.porcentaje ?? 0}%
                      </td>
                      <td className="tbl-text-end"
                          style={{ color: a.criticos ? '#d63939' : '#94a3b8',
                                   fontWeight: a.criticos ? 700 : 400 }}>
                        {a.criticos || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ── Parámetros del reporte ── */}
        <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10,
                      padding: '16px 18px', marginBottom: 18 }}>
          <div style={{ fontSize: 13, color: '#475569', marginBottom: 14 }}>
            Formatos oficiales del inventario de infraestructura hidráulica menor,
            generados desde la base de datos.
          </div>

          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '.1em',
                textTransform: 'uppercase', color: '#7b93ad', marginBottom: 7 }}>Ámbito</div>
              <div style={{ display: 'flex', gap: 6 }}>
                {AMBITOS.map(a => (
                  <button key={a.valor} title={a.nota} onClick={() => setAmbito(a.valor)}
                    style={{
                      padding: '9px 16px', borderRadius: 8, fontSize: 13, fontWeight: 700,
                      cursor: 'pointer', fontFamily: 'inherit',
                      border: `1px solid ${ambito === a.valor ? '#0CA678' : '#cbd5e1'}`,
                      background: ambito === a.valor ? '#0CA678' : '#fff',
                      color: ambito === a.valor ? '#fff' : '#5b7590',
                    }}>
                    {a.etiqueta}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ minWidth: 260 }}>
              <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '.1em',
                textTransform: 'uppercase', color: '#7b93ad', marginBottom: 7 }}>
                Estado a reportar
              </div>
              <select value={campania} onChange={e => setCampania(e.target.value)}
                style={{ ...sel, width: '100%' }}>
                <option value="">Inventario base (sin evaluar)</option>
                {campanias.map(c => (
                  <option key={c.id} value={c.anio}>Campaña {c.anio}</option>
                ))}
              </select>
              <div style={{ fontSize: 11.5, color: '#7b93ad', marginTop: 6, fontStyle: 'italic' }}>
                {campania
                  ? `Los activos toman el estado que se les registró en ${campania}.`
                  : 'Los activos salen con el estado del levantamiento original.'}
              </div>
            </div>

            <div style={{ marginLeft: 'auto', paddingTop: 22 }}>
              <button onClick={() => descargar('todos', nombreZip)} disabled={bajando !== null}
                style={{
                  display: 'flex', alignItems: 'center', gap: 9, padding: '12px 22px',
                  background: '#0CA678', color: '#fff', border: 'none', borderRadius: 9,
                  fontSize: 13.5, fontWeight: 700, fontFamily: 'inherit',
                  cursor: bajando ? 'not-allowed' : 'pointer', opacity: bajando ? .6 : 1,
                  boxShadow: '0 3px 10px rgba(12,166,120,.3)',
                }}>
                {bajando === 'todos'
                  ? <><FaSyncAlt className="icon-spin" /> Generando los {formatos.length} formatos…</>
                  : <><FaFileArchive /> Descargar todos en un ZIP</>}
              </button>
            </div>
          </div>
        </div>

        {error && (
          <div style={{ background: '#fee2e2', border: '1px solid #fecaca', color: '#b91c1c',
            borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 13,
            display: 'flex', alignItems: 'center', gap: 8 }}>
            <FaExclamationCircle /> {error}
          </div>
        )}

        {/* ── Formatos, uno por uno ── */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      marginBottom: 12 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#1e293b',
                        display: 'flex', alignItems: 'center', gap: 8 }}>
            <FaFileExcel style={{ color: '#0CA678' }} />
            Formatos disponibles ({formatos.length})
            {cargando && <FaSyncAlt className="icon-spin" size={12} style={{ color: '#74c0fc' }} />}
          </div>
          {listos > 0 && (
            <span style={{ fontSize: 12, color: '#15803d', fontWeight: 600 }}>
              <FaCheckCircle size={11} style={{ marginRight: 5 }} />
              {listos} ya generado(s): descarga inmediata
            </span>
          )}
        </div>

        {formatos.length === 0 && !cargando ? (
          <div className="tbl-empty" style={{ textAlign: 'center', padding: 40, color: '#64748b' }}>
            <FaClipboardCheck size={26} style={{ color: '#cbd5e1', marginBottom: 10 }} />
            <div>No hay formatos disponibles para este ámbito.</div>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))',
                        gap: 12 }}>
            {formatos.map(f => {
              const listo = f.generado && f.vigente;
              const enCurso = bajando === f.clave;
              return (
                <button key={f.clave} onClick={() => descargar(f.clave, f.archivo)}
                  disabled={bajando !== null}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left',
                    background: '#fff', border: '1px solid #e2e8f0',
                    borderLeft: `4px solid ${listo ? '#0CA678' : '#cbd5e1'}`,
                    borderRadius: 10, padding: '13px 15px', cursor: bajando ? 'not-allowed' : 'pointer',
                    fontFamily: 'inherit', boxShadow: '0 1px 3px rgba(0,0,0,.05)',
                    opacity: bajando && !enCurso ? .55 : 1,
                  }}>
                  <span style={{
                    fontSize: 11, fontWeight: 800, color: '#0CA678', background: '#dcfce7',
                    border: '1px solid #bbf7d0', borderRadius: 6, padding: '4px 8px',
                    whiteSpace: 'nowrap', flexShrink: 0,
                  }}>{f.clave}</span>

                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 13.5, fontWeight: 600,
                      color: '#1e293b', overflow: 'hidden', textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap' }}>{f.titulo}</span>
                    <span style={{ display: 'block', fontSize: 11, color: '#7b93ad', marginTop: 2 }}>
                      {listo
                        ? <><FaCheckCircle size={9} style={{ color: '#2fb344', marginRight: 4 }} />
                            Generado · {pesoLegible(f.tamano)}</>
                        : 'Se arma al pedirlo'}
                    </span>
                  </span>

                  <span style={{ color: '#0284c7', flexShrink: 0, display: 'flex' }}>
                    {enCurso ? <FaSyncAlt className="icon-spin" size={14} /> : <FaDownload size={14} />}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        <div style={{ marginTop: 18, background: '#f8fafc', border: '1px solid #e2e8f0',
          borderRadius: 8, padding: '11px 14px', fontSize: 12, color: '#7b93ad', lineHeight: 1.6 }}>
          Los formatos que no están generados se arman al pedirlos y puede tomar unos
          segundos. Una vez creados quedan guardados y se rehacen solo cuando cambian
          los datos.
        </div>

      </div>
    </div>
  );
}

export default ReportesInventario;