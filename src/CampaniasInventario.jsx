import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  FaSyncAlt, FaFileExcel, FaFilePdf, FaExclamationCircle, FaCheckCircle,
  FaCalendarPlus, FaLock, FaSearch, FaMapMarkerAlt, FaTimes,
} from 'react-icons/fa';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import ExcelJS from 'exceljs';
import Swal from 'sweetalert2';
import { TODAS_LAS_CAPAS } from './InventarioGIS';
import './Incidentes.css';
import './EstadisticasGIS.css';
import './CampaniasInventario.css';

/**
 * CAMPAÑAS DEL INVENTARIO: el año, y todo lo evaluado en él.
 *
 * Antes la campaña solo se veía de refilón —un rótulo en el panel del mapa y
 * una barra de avance— y las evaluaciones no se veían en ninguna parte como
 * lista: había que ir pulsando estructuras en el mapa una por una. Para saber
 * qué se evaluó en el año, quién lo hizo y qué salió mal, no había pantalla.
 *
 * Aquí está: el año, su estado, cuánto se lleva, y la tabla de todo lo
 * evaluado, con búsqueda, filtros y descarga.
 *
 * LAS ESTRUCTURAS NO SE COPIAN DE UN AÑO A OTRO, Y NO HACE FALTA.
 * Viven en las capas del GIS, no dentro de la campaña; una evaluación es una
 * fila que apunta a (campaña, tipo de activo, fid). Así que una campaña nueva
 * arranca sola con TODAS las estructuras pendientes: pendiente es,
 * literalmente, que todavía no exista su fila. Duplicar las estructuras por
 * año habría significado mantener el mismo canal en siete sitios y que
 * corregir una coordenada obligara a corregirla siete veces.
 *
 * Lo que sí se conserva es lo evaluado: cada año guarda el suyo y se consulta
 * cambiando de campaña en el desplegable.
 */

const API = '/vigapi/inventario';
const cab = () => ({ Authorization: `Token ${localStorage.getItem('userToken')}` });

const ETIQUETA_CAPA = Object.fromEntries(
  TODAS_LAS_CAPAS.map(c => [c.codigo, c.label || c.codigo]));
const COLOR_CAPA = Object.fromEntries(
  TODAS_LAS_CAPAS.map(c => [c.codigo, c.color || '#4c6ef5']));

/* Una capa que el catálogo del front no conozca —porque el servidor la añadió
 * después— no debe salir como 'tomas_laterales' en crudo ni sin color: se
 * presenta lo mejor que se pueda en vez de delatar el nombre de la columna. */
const CAPA_POR_DEFECTO = '#4c6ef5';
const rotuloCapa = (cod) => ETIQUETA_CAPA[cod]
  || String(cod || '').replace(/_/g, ' ').replace(/^./, m => m.toUpperCase());

const ESTADO = {
  B: { txt: 'Bueno', color: '#2f9e44' },
  R: { txt: 'Regular', color: '#f59f00' },
  M: { txt: 'Malo', color: '#e03131' },
};
const estadoDe = (c) => ESTADO[c] || { txt: c || '—', color: '#868e96' };

const fmt = (n) => (parseFloat(n) || 0).toLocaleString('es-PE');
const hoy = () => new Date().toISOString().slice(0, 10);

/* El año que toca proponer: el siguiente al mayor que ya exista, nunca uno
 * que ya esté. Proponer "el año actual" sin más crearía un duplicado en
 * cuanto alguien abra la pantalla dos veces el mismo enero. */
const proximoAnio = (campanias) => {
  const anios = campanias.map(c => Number(c.anio)).filter(Number.isFinite);
  const base = anios.length ? Math.max(...anios) : new Date().getFullYear() - 1;
  return base + 1;
};

function CampaniasInventario({ irAActivo }) {
  const [campanias, setCampanias] = useState([]);
  const [activa, setActiva] = useState(null);
  const [avance, setAvance] = useState([]);
  const [evaluaciones, setEvaluaciones] = useState([]);
  const [indice, setIndice] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [cargandoTabla, setCargandoTabla] = useState(false);
  const [error, setError] = useState(null);

  const [busca, setBusca] = useState('');
  const [capaFiltro, setCapaFiltro] = useState('');
  const [estadoFiltro, setEstadoFiltro] = useState('');
  const [soloMant, setSoloMant] = useState(false);

  const [creando, setCreando] = useState(false);
  const [nueva, setNueva] = useState(null);     // { anio, nombre, ini, fin }
  const [avisoAccion, setAvisoAccion] = useState(null);

  // ── carga ────────────────────────────────────────────────────────────
  const cargarCampanias = useCallback(async () => {
    setCargando(true); setError(null);
    try {
      const r = await fetch(`${API}/campanias/`, { headers: cab() });
      if (!r.ok) throw new Error(`El servidor respondió ${r.status}`);
      const d = await r.json();
      const lista = (d.results || d).slice()
        .sort((a, b) => Number(b.anio) - Number(a.anio));
      setCampanias(lista);
      setActiva(a => lista.find(c => c.id === a?.id)
        || lista.find(c => c.estado === 'en_proceso') || lista[0] || null);
    } catch (e) {
      setError(e.message || 'No se pudo consultar las campañas');
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => { cargarCampanias(); }, [cargarCampanias]);

  // El índice trae nombre, canal y progresiva de cada activo. Se pide una vez
  // y sirve para toda la pantalla: la evaluación solo guarda el fid, y una
  // tabla de fids no la lee nadie.
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`${API}/capas/indice/`, { headers: cab() });
        if (r.ok) setIndice(await r.json());
      } catch (e) { /* sin índice, la tabla muestra el código y el fid */ }
    })();
  }, []);

  /* "No hay evaluaciones" y "el servidor fallo" NO son lo mismo, y la tabla
   * los pintaba igual: si /evaluaciones/ devolvia un 500 -que es justo lo que
   * lleva fallando en el servidor nuevo-, la pantalla decia tan tranquila
   * "todavia no hay ninguna evaluacion en la campana 2026". Afirmar que un
   * ano esta sin evaluar cuando en realidad no se pudo preguntar es peor que
   * no enseinar nada: manda a alguien a reevaluar lo que ya estaba hecho. */
  const [falloTabla, setFalloTabla] = useState(null);

  useEffect(() => {
    if (!activa) { setEvaluaciones([]); setAvance([]); setFalloTabla(null); return; }
    let cancelado = false;
    (async () => {
      setCargandoTabla(true); setFalloTabla(null);
      try {
        const [re, ra] = await Promise.all([
          fetch(`${API}/evaluaciones/?campania=${activa.anio}`, { headers: cab() }),
          fetch(`${API}/campanias/${activa.id}/avance/`, { headers: cab() }),
        ]);
        if (cancelado) return;

        if (re.ok) { const d = await re.json(); setEvaluaciones(d.results || d || []); }
        else { setEvaluaciones([]); setFalloTabla(`El servidor respondió ${re.status} al pedir las evaluaciones`); }

        if (ra.ok) { const d = await ra.json(); setAvance(d.detalle || []); }
        else {
          setAvance([]);
          // El avance da el total del inventario. Sin él, la cifra "X de Y"
          // sale sin Y, y conviene decir por qué en vez de enseñar un hueco.
          if (re.ok) setFalloTabla(`El servidor respondió ${ra.status} al pedir el avance: `
            + 'las cifras salen sin el total del inventario');
        }
      } catch (e) {
        if (!cancelado) {
          setEvaluaciones([]); setAvance([]);
          setFalloTabla('No se pudo consultar las evaluaciones');
        }
      } finally {
        if (!cancelado) setCargandoTabla(false);
      }
    })();
    return () => { cancelado = true; };
  }, [activa]);

  // ── la tabla ─────────────────────────────────────────────────────────
  const porClave = useMemo(() => {
    const m = new Map();
    indice.forEach(a => m.set(`${a.tipo}:${a.fid}`, a));
    return m;
  }, [indice]);

  const filas = useMemo(() => evaluaciones.map(e => {
    const a = porClave.get(`${e.tipo_activo}:${e.activo_fid}`) || {};
    return {
      id: e.id,
      tipo: e.tipo_activo,
      fid: e.activo_fid,
      capa: rotuloCapa(e.tipo_activo),
      nombre: a.nombre || e.activo_nombre || `#${e.activo_fid}`,
      canal: a.canal || '',
      progresiva: a.progresiva || '',
      estado: e.estado_cons || '',
      condicion: e.condicion || '',
      fecha: e.fecha || '',
      evaluador: e.evaluador || '',
      mant: !!e.requiere_mant,
      prioridad: e.prioridad || '',
      obs: e.observaciones || '',
      lat: a.lat, lng: a.lng,
    };
  }), [evaluaciones, porClave]);

  const norm = (v) => String(v || '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '');

  const vista = useMemo(() => {
    const q = norm(busca.trim());
    return filas.filter(f => {
      if (capaFiltro && f.tipo !== capaFiltro) return false;
      if (estadoFiltro && f.estado !== estadoFiltro) return false;
      if (soloMant && !f.mant) return false;
      if (q.length >= 2 && !(norm(f.nombre).includes(q) || norm(f.canal).includes(q)
        || norm(f.capa).includes(q) || norm(f.evaluador).includes(q)
        || norm(f.progresiva).includes(q))) return false;
      return true;
    }).sort((a, b) => (b.fecha || '').localeCompare(a.fecha || '')
      || a.capa.localeCompare(b.capa, 'es'));
  }, [filas, busca, capaFiltro, estadoFiltro, soloMant]);

  const resumen = useMemo(() => {
    const r = { B: 0, R: 0, M: 0, mant: 0 };
    vista.forEach(f => { if (r[f.estado] != null) r[f.estado]++; if (f.mant) r.mant++; });
    return r;
  }, [vista]);

  const capasPresentes = useMemo(() => {
    const s = new Map();
    filas.forEach(f => s.set(f.tipo, f.capa));
    return [...s.entries()].sort((a, b) => a[1].localeCompare(b[1], 'es'));
  }, [filas]);

  const totalInventario = useMemo(
    () => avance.reduce((a, d) => a + (Number(d.total) || 0), 0), [avance]);
  const pct = totalInventario ? Math.round((filas.length / totalInventario) * 100) : 0;

  // ── abrir y cerrar el año ────────────────────────────────────────────
  const abrirFormNueva = () => {
    const anio = proximoAnio(campanias);
    setNueva({
      anio, nombre: `Campaña ${anio}`,
      ini: `${anio}-01-01`, fin: `${anio}-12-31`,
    });
    setAvisoAccion(null);
  };

  /* El servidor puede no admitir escritura en este endpoint: si el viewset es
   * de solo lectura responde 405, y con permisos de por medio, 403. Se dicen
   * los dos por su nombre en vez de un "error" genérico, porque uno se
   * arregla en el backend y el otro dando permisos al usuario. */
  const explicar = (status) =>
    status === 405 ? 'El servidor no permite crear campañas desde la web '
      + '(el endpoint es de solo lectura). Hay que habilitarlo en el backend.'
      : status === 403 ? 'Tu usuario no tiene permiso para crear campañas.'
      : status === 401 ? 'La sesión caducó. Vuelve a entrar.'
      : `El servidor respondió ${status}.`;

  const crear = async () => {
    if (!nueva) return;
    if (campanias.some(c => Number(c.anio) === Number(nueva.anio))) {
      setAvisoAccion({ mal: true, txt: `La campaña ${nueva.anio} ya existe.` });
      return;
    }
    setCreando(true); setAvisoAccion(null);
    try {
      const r = await fetch(`${API}/campanias/`, {
        method: 'POST',
        headers: { ...cab(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          anio: Number(nueva.anio), nombre: nueva.nombre,
          fecha_ini: nueva.ini, fecha_fin: nueva.fin, estado: 'en_proceso',
        }),
      });
      if (!r.ok) {
        /* SOLO el 400 trae algo que merezca enseñarse tal cual: son los
         * errores de validación por campo ("anio: ya existe"), que dicen
         * exactamente qué corregir. Para 405, 403 y 401, Django manda un
         * `detail` genérico —"Method not allowed"— que al usuario no le dice
         * ni qué pasó ni quién lo arregla; ahí manda nuestra explicación.
         * Tenerlo al revés hacía que el mensaje útil no se enseñara nunca. */
        const d = r.status === 400 ? await r.json().catch(() => ({})) : {};
        const porCampo = Object.entries(d)
          .filter(([k]) => k !== 'detail')
          .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(' ') : v}`).join(' · ');
        setAvisoAccion({ mal: true, txt: porCampo || explicar(r.status) });
        return;
      }
      const creada = await r.json();
      setNueva(null);
      setAvisoAccion({ txt: `Campaña ${creada.anio} abierta. Todas las `
        + 'estructuras del inventario quedan pendientes de evaluar.' });
      await cargarCampanias();
      setActiva(creada);
    } catch (e) {
      setAvisoAccion({ mal: true, txt: 'No se pudo crear la campaña.' });
    } finally {
      setCreando(false);
    }
  };

  const cerrar = async () => {
    if (!activa) return;
    const { isConfirmed } = await Swal.fire({
      icon: 'question',
      title: `¿Cerrar la campaña ${activa.anio}?`,
      html: 'Deja de poder evaluarse: el botón «Evaluar» desaparece de las '
        + 'estructuras.<br><br><small style="color:#64748b">Lo ya evaluado se '
        + 'conserva y se sigue consultando desde aquí, cambiando de año.</small>',
      showCancelButton: true,
      confirmButtonText: `Cerrar ${activa.anio}`,
      cancelButtonText: 'Dejarla abierta',
      confirmButtonColor: '#d97706',
      cancelButtonColor: '#5b7590',
      reverseButtons: true,
      focusCancel: true,
    });
    if (!isConfirmed) return;
    setCreando(true); setAvisoAccion(null);
    try {
      const r = await fetch(`${API}/campanias/${activa.id}/`, {
        method: 'PATCH',
        headers: { ...cab(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ estado: 'cerrada' }),
      });
      if (!r.ok) { setAvisoAccion({ mal: true, txt: explicar(r.status) }); return; }
      setAvisoAccion({ txt: `Campaña ${activa.anio} cerrada.` });
      await cargarCampanias();
    } catch (e) {
      setAvisoAccion({ mal: true, txt: 'No se pudo cerrar la campaña.' });
    } finally {
      setCreando(false);
    }
  };

  // ── descargas ────────────────────────────────────────────────────────
  const baseNombre = `evaluaciones_campania_${activa?.anio || ''}`;

  const aExcel = async () => {
    const wb = new ExcelJS.Workbook();
    const hoja = wb.addWorksheet(`Campaña ${activa?.anio || ''}`);

    hoja.mergeCells('A1:I1');
    hoja.getCell('A1').value =
      `EVALUACIONES DEL INVENTARIO — CAMPAÑA ${activa?.anio || ''}`;
    hoja.getCell('A1').font = { bold: true, size: 13 };
    hoja.mergeCells('A2:I2');
    // Qué filtros estaban puestos. Sin esto, dos Excel del mismo día con
    // distinto número de filas no se pueden explicar.
    hoja.getCell('A2').value = `${vista.length} de ${filas.length} evaluaciones`
      + `${capaFiltro ? ` · capa: ${rotuloCapa(capaFiltro)}` : ''}`
      + `${estadoFiltro ? ` · estado: ${estadoDe(estadoFiltro).txt}` : ''}`
      + `${soloMant ? ' · solo las que requieren mantenimiento' : ''}`
      + `${busca.trim() ? ` · búsqueda: "${busca.trim()}"` : ''}`
      + ` · generado ${hoy()}`;
    hoja.getCell('A2').font = { size: 9, color: { argb: 'FF666666' } };

    const cabecera = ['Capa', 'Estructura', 'Canal', 'Progresiva', 'Estado',
                      'Condición', 'Mantenimiento', 'Fecha', 'Evaluador'];
    const fc = hoja.addRow([]);
    const fh = hoja.addRow(cabecera);
    fh.eachCell(c => {
      c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B2A5B' } };
      c.alignment = { vertical: 'middle', horizontal: 'center' };
    });
    void fc;

    vista.forEach(f => hoja.addRow([
      f.capa, f.nombre, f.canal, f.progresiva,
      estadoDe(f.estado).txt, f.condicion,
      f.mant ? (f.prioridad || 'Sí') : 'No', f.fecha, f.evaluador,
    ]));

    hoja.columns = [22, 30, 20, 13, 12, 16, 15, 12, 20].map(width => ({ width }));
    hoja.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: 9 } };
    hoja.views = [{ state: 'frozen', ySplit: 4 }];

    const buffer = await wb.xlsx.writeBuffer();
    const url = URL.createObjectURL(new Blob([buffer],
      { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    const a = document.createElement('a');
    a.href = url; a.download = `${baseNombre}.xlsx`; a.click();
    URL.revokeObjectURL(url);
  };

  const aPDF = () => {
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    doc.setFontSize(13);
    doc.text(`Evaluaciones del inventario — Campaña ${activa?.anio || ''}`, 14, 14);
    doc.setFontSize(8.5);
    doc.setTextColor(110);
    doc.text(`${vista.length} de ${filas.length} evaluaciones`
      + `${capaFiltro ? ` · capa: ${rotuloCapa(capaFiltro)}` : ''}`
      + `${estadoFiltro ? ` · estado: ${estadoDe(estadoFiltro).txt}` : ''}`
      + `${soloMant ? ' · solo con mantenimiento' : ''}`
      + ` · generado ${hoy()}`, 14, 20);
    doc.setTextColor(0);

    autoTable(doc, {
      startY: 25,
      head: [['Capa', 'Estructura', 'Canal', 'Prog.', 'Estado',
              'Condición', 'Mant.', 'Fecha', 'Evaluador']],
      body: vista.map(f => [
        f.capa, f.nombre, f.canal, f.progresiva,
        estadoDe(f.estado).txt, f.condicion,
        f.mant ? (f.prioridad || 'Sí') : 'No', f.fecha, f.evaluador,
      ]),
      styles: { fontSize: 7.5, cellPadding: 1.6 },
      headStyles: { fillColor: [11, 42, 91], textColor: 255, fontSize: 7.5 },
      alternateRowStyles: { fillColor: [246, 249, 252] },
      // El estado se colorea como en el mapa: leer "Malo" y verlo en rojo son
      // dos lecturas distintas, y en una tabla de cien filas cuenta.
      didParseCell: (d) => {
        if (d.section === 'body' && d.column.index === 4) {
          const f = vista[d.row.index];
          const c = estadoDe(f.estado).color;
          d.cell.styles.textColor = [
            parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16),
            parseInt(c.slice(5, 7), 16)];
          d.cell.styles.fontStyle = 'bold';
        }
      },
    });
    doc.save(`${baseNombre}.pdf`);
  };

  // ── pintado ──────────────────────────────────────────────────────────
  if (cargando) {
    return (
      <div className="cmp-wrap">
        <div className="cmp-cargando"><FaSyncAlt className="icon-spin" /> Consultando campañas…</div>
      </div>
    );
  }

  return (
    <div className="cmp-wrap">

      <div className="cmp-cab">
        <div className="cmp-cab-izq">
          <label className="cmp-rotulo">Campaña</label>
          {campanias.length > 0 ? (
            <select className="cmp-anio" value={activa?.id || ''}
              onChange={e => setActiva(campanias.find(c => String(c.id) === e.target.value))}>
              {campanias.map(c => (
                <option key={c.id} value={c.id}>
                  {c.anio}{c.estado === 'cerrada' ? ' (cerrada)' : ''}
                </option>
              ))}
            </select>
          ) : <span className="cmp-anio-vacio">ninguna</span>}

          {activa && (
            <span className={`cmp-estado est-${activa.estado}`}>
              {activa.estado === 'en_proceso' ? 'en proceso' : activa.estado}
            </span>
          )}
          {activa?.fecha_ini && (
            <span className="cmp-fechas">{activa.fecha_ini} → {activa.fecha_fin || '…'}</span>
          )}
        </div>

        <div className="cmp-cab-der">
          <button className="cmp-btn" onClick={cargarCampanias} title="Volver a consultar">
            <FaSyncAlt /> Actualizar
          </button>
          {activa?.estado === 'en_proceso' && (
            <button className="cmp-btn" onClick={cerrar} disabled={creando}>
              <FaLock /> Cerrar {activa.anio}
            </button>
          )}
          <button className="cmp-btn cmp-btn-pri" onClick={abrirFormNueva} disabled={creando}>
            <FaCalendarPlus /> Nueva campaña
          </button>
        </div>
      </div>

      {error && (
        <div className="cmp-error">
          <FaExclamationCircle /> {error}
          <button onClick={cargarCampanias}>Reintentar</button>
        </div>
      )}

      {avisoAccion && (
        <div className={`cmp-aviso${avisoAccion.mal ? ' mal' : ''}`}>
          {avisoAccion.mal ? <FaExclamationCircle /> : <FaCheckCircle />}
          <span>{avisoAccion.txt}</span>
          <button onClick={() => setAvisoAccion(null)}><FaTimes /></button>
        </div>
      )}

      {/* ── abrir año nuevo ── */}
      {nueva && (
        <div className="cmp-nueva">
          <div className="cmp-nueva-tit">Abrir campaña</div>
          <div className="cmp-nueva-campos">
            <label>Año
              <input type="number" value={nueva.anio}
                onChange={e => setNueva(n => ({ ...n, anio: e.target.value,
                  nombre: `Campaña ${e.target.value}`,
                  ini: `${e.target.value}-01-01`, fin: `${e.target.value}-12-31` }))} />
            </label>
            <label>Nombre
              <input type="text" value={nueva.nombre}
                onChange={e => setNueva(n => ({ ...n, nombre: e.target.value }))} />
            </label>
            <label>Desde
              <input type="date" value={nueva.ini}
                onChange={e => setNueva(n => ({ ...n, ini: e.target.value }))} />
            </label>
            <label>Hasta
              <input type="date" value={nueva.fin}
                onChange={e => setNueva(n => ({ ...n, fin: e.target.value }))} />
            </label>
          </div>
          <p className="cmp-nueva-nota">
            Las estructuras no se copian: viven en las capas del GIS y ya están
            en todos los años. La campaña nueva arranca con <b>las
            {' '}{fmt(totalInventario || 0)} estructuras pendientes</b> de
            evaluar, y lo evaluado en {activa?.anio} se conserva y se consulta
            cambiando de año aquí arriba.
          </p>
          <div className="cmp-nueva-pie">
            <button className="cmp-btn" onClick={() => setNueva(null)}>Cancelar</button>
            <button className="cmp-btn cmp-btn-pri" onClick={crear} disabled={creando}>
              {creando ? 'Abriendo…' : `Abrir campaña ${nueva.anio}`}
            </button>
          </div>
        </div>
      )}

      {!activa && !error && (
        <div className="cmp-vacio">
          No hay ninguna campaña todavía. Abre la primera para empezar a evaluar.
        </div>
      )}

      {activa && (
        <>
          {/* ── avance ── */}
          <div className="cmp-kpis">
            <div className="cmp-kpi">
              <b>{fmt(filas.length)}</b>
              <span>evaluadas{totalInventario ? ` de ${fmt(totalInventario)}` : ''}</span>
              <div className="cmp-barra"><i style={{ width: `${pct}%` }} /></div>
            </div>
            {['B', 'R', 'M'].map(k => (
              <div className="cmp-kpi" key={k}>
                <b style={{ color: ESTADO[k].color }}>{fmt(resumen[k])}</b>
                <span>{ESTADO[k].txt}</span>
              </div>
            ))}
            <div className="cmp-kpi">
              <b style={{ color: '#d9480f' }}>{fmt(resumen.mant)}</b>
              <span>requieren mantenimiento</span>
            </div>
          </div>

          {/* ── filtros ── */}
          <div className="cmp-filtros">
            <div className="cmp-buscar">
              <FaSearch size={11} />
              <input type="text" value={busca} placeholder="Estructura, canal, progresiva o evaluador…"
                onChange={e => setBusca(e.target.value)} />
              {busca && <button onClick={() => setBusca('')}><FaTimes size={10} /></button>}
            </div>
            <select value={capaFiltro} onChange={e => setCapaFiltro(e.target.value)}>
              <option value="">Todas las capas</option>
              {capasPresentes.map(([cod, lab]) => (
                <option key={cod} value={cod}>{lab}</option>
              ))}
            </select>
            <select value={estadoFiltro} onChange={e => setEstadoFiltro(e.target.value)}>
              <option value="">Cualquier estado</option>
              {Object.entries(ESTADO).map(([k, v]) => (
                <option key={k} value={k}>{v.txt}</option>
              ))}
            </select>
            <label className="cmp-check">
              <input type="checkbox" checked={soloMant}
                onChange={e => setSoloMant(e.target.checked)} />
              Solo con mantenimiento
            </label>
            <div className="cmp-descargas">
              <button className="cmp-btn" onClick={aExcel} disabled={!vista.length}>
                <FaFileExcel /> Excel
              </button>
              <button className="cmp-btn" onClick={aPDF} disabled={!vista.length}>
                <FaFilePdf /> PDF
              </button>
            </div>
          </div>

          {/* ── tabla ── */}
          {cargandoTabla ? (
            <div className="cmp-cargando"><FaSyncAlt className="icon-spin" /> Cargando evaluaciones…</div>
          ) : falloTabla ? (
            <div className="cmp-error">
              <FaExclamationCircle /> {falloTabla}. No se sabe qué hay evaluado
              en {activa.anio}: lo que ves arriba no es el estado real.
              <button onClick={() => setActiva(a => ({ ...a }))}>Reintentar</button>
            </div>
          ) : vista.length === 0 ? (
            <div className="cmp-vacio">
              {filas.length === 0
                ? `Todavía no hay ninguna evaluación en la campaña ${activa.anio}.`
                : 'Ninguna evaluación coincide con el filtro.'}
            </div>
          ) : (
            <div className="cmp-tabla-wrap">
              <table className="cmp-tabla">
                <thead>
                  <tr>
                    <th>Capa</th><th>Estructura</th><th>Canal</th><th>Prog.</th>
                    <th>Estado</th><th>Condición</th><th>Mant.</th>
                    <th>Fecha</th><th>Evaluador</th><th />
                  </tr>
                </thead>
                <tbody>
                  {vista.map(f => (
                    <tr key={f.id}>
                      <td>
                        <i className="cmp-punto" style={{ background: COLOR_CAPA[f.tipo] || CAPA_POR_DEFECTO }} />
                        {f.capa}
                      </td>
                      <td className="cmp-nombre" title={f.obs || ''}>{f.nombre}</td>
                      <td>{f.canal}</td>
                      <td>{f.progresiva}</td>
                      <td>
                        <b style={{ color: estadoDe(f.estado).color }}>
                          {estadoDe(f.estado).txt}
                        </b>
                      </td>
                      <td>{f.condicion || '—'}</td>
                      <td>
                        {f.mant
                          ? <span className="cmp-mant">{f.prioridad || 'Sí'}</span>
                          : <span className="cmp-no">no</span>}
                      </td>
                      <td>{f.fecha}</td>
                      <td>{f.evaluador}</td>
                      <td>
                        {irAActivo && (
                          <button className="cmp-ir" title="Ver la estructura en el mapa"
                            onClick={() => irAActivo({
                              tipo: f.tipo, fid: f.fid, lat: f.lat, lng: f.lng })}>
                            <FaMapMarkerAlt size={11} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default CampaniasInventario;
