import { useState, useEffect, useCallback } from 'react';
import {
  FaFileExcel, FaDownload, FaTimes, FaSyncAlt, FaFileArchive,
  FaExclamationCircle, FaCheckCircle,
} from 'react-icons/fa';
import './ReportesANA.css';

/**
 * Descarga de los formatos oficiales de la ANA.
 *
 * Los archivos no se arman aquí: el backend invoca al mismo generador que
 * se usa por consola, así que el formato que baja la Junta es idéntico al
 * que se revisa en el servidor. Este panel solo elige parámetros y pide.
 *
 * Uso en Mapa.jsx:
 *
 *   const [verReportes, setVerReportes] = useState(false);
 *
 *   // en la barra de herramientas
 *   <button className={`gis-tool ${verReportes ? 'activo' : ''}`}
 *     title="Formatos ANA" onClick={() => setVerReportes(v => !v)}>
 *     <FaFileExcel />
 *   </button>
 *
 *   // fuera del mapa
 *   {verReportes && (
 *     <PanelReportes campanias={inv.campanias}
 *       onCerrar={() => setVerReportes(false)} />
 *   )}
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

export default function PanelReportes({ campanias = [], onCerrar }) {
  const [ambito, setAmbito] = useState('JURP');
  const [campania, setCampania] = useState('');   // '' = inventario base
  const [formatos, setFormatos] = useState([]);
  const [cargando, setCargando] = useState(false);
  const [bajando, setBajando] = useState(null);   // clave en curso
  const [error, setError] = useState(null);

  const parametros = useCallback(() => {
    const p = new URLSearchParams({ ambito });
    if (campania) p.set('campania', campania);
    return p.toString();
  }, [ambito, campania]);

  // El catálogo dice qué formatos hay y cuáles ya están generados, para
  // que el usuario sepa cuáles bajan al instante y cuáles hay que armar.
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
    } finally {
      setCargando(false);
    }
  }, [parametros]);

  useEffect(() => { cargarCatalogo(); }, [cargarCatalogo]);

  // La descarga pasa por fetch y no por un enlace directo para poder
  // mostrar el error cuando el generador falla: un <a> dejaría al usuario
  // con un archivo de error sin explicación.
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

      // el archivo queda en el servidor: el catálogo lo refleja
      cargarCatalogo();
    } catch (e) {
      setError(e.message || 'No se pudo descargar');
    } finally {
      setBajando(null);
    }
  };

  const anio = campania || 'base';
  const nombreZip = `Formatos_ANA_${ambito}${campania ? `_${campania}` : ''}.zip`;

  return (
    <div className="rep-panel gis-glass">

      <div className="gis-capas-head">
        <span className="gis-sub">Formatos ANA</span>
        <button className="gis-tool" style={{ width: 26, height: 26 }} onClick={onCerrar}>
          <FaTimes />
        </button>
      </div>

      <div className="gis-capas-body">

        <div className="rep-intro">
          Formatos oficiales del inventario de infraestructura hidráulica
          menor, generados desde la base de datos.
        </div>

        {/* ── ámbito ── */}
        <div className="rep-campo">
          <label>Ámbito</label>
          <div className="rep-botones">
            {AMBITOS.map(a => (
              <button key={a.valor} title={a.nota}
                className={ambito === a.valor ? 'activo' : ''}
                onClick={() => setAmbito(a.valor)}>
                {a.etiqueta}
              </button>
            ))}
          </div>
        </div>

        {/* ── campaña ── */}
        <div className="rep-campo">
          <label>Estado a reportar</label>
          <select value={campania} onChange={e => setCampania(e.target.value)}>
            <option value="">Inventario base (sin evaluar)</option>
            {campanias.map(c => (
              <option key={c.id} value={c.anio}>
                Campaña {c.anio}
              </option>
            ))}
          </select>
          <div className="rep-nota">
            {campania
              ? `Los activos toman el estado que se les registró en ${campania}.`
              : 'Los activos salen con el estado del levantamiento original.'}
          </div>
        </div>

        {/* ── todo junto ── */}
        <button className="rep-btn-zip"
          onClick={() => descargar('todos', nombreZip)}
          disabled={bajando !== null}>
          {bajando === 'todos'
            ? <><FaSyncAlt className="icon-spin" /> Generando los 14 formatos…</>
            : <><FaFileArchive /> Descargar todos en un ZIP</>}
        </button>

        {error && (
          <div className="inv-error" style={{ marginTop: 8 }}>
            <FaExclamationCircle /> {error}
          </div>
        )}

        {/* ── uno por uno ── */}
        <div className="gis-capas-grupo">
          <div className="gis-capas-titulo">
            Formatos
            {cargando && <FaSyncAlt className="icon-spin" size={10}
              style={{ marginLeft: 7, color: '#74c0fc' }} />}
          </div>

          {formatos.map(f => (
            <button key={f.clave} className="rep-formato"
              onClick={() => descargar(f.clave, f.archivo)}
              disabled={bajando !== null}>
              <span className="rep-clave">{f.clave}</span>
              <span className="rep-titulo">
                {f.titulo}
                {f.generado && f.vigente && (
                  <i className="rep-listo" title="Ya generado, descarga inmediata">
                    <FaCheckCircle size={9} /> {pesoLegible(f.tamano)}
                  </i>
                )}
              </span>
              {bajando === f.clave
                ? <FaSyncAlt className="icon-spin" size={12} />
                : <FaDownload size={11} />}
            </button>
          ))}

          {!cargando && formatos.length === 0 && !error && (
            <div className="rep-vacio">No hay formatos disponibles.</div>
          )}
        </div>

        <div className="rep-pie">
          Los formatos que no están generados se arman al pedirlos y puede
          tomar unos segundos. Una vez creados quedan guardados y se
          rehacen solo cuando cambian los datos.
        </div>

      </div>
    </div>
  );
}