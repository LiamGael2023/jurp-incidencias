import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  FaSyncAlt, FaSearch, FaFilter, FaTimes, FaFilePdf, FaFileExcel,
  FaCheckCircle, FaTruck, FaClipboardList, FaChevronLeft, FaChevronRight,
  FaExclamationTriangle, FaEye,
} from 'react-icons/fa';
import ExcelJS from 'exceljs';
import Swal from 'sweetalert2';
import './Incidentes.css';

/**
 * Listado global de partes diarios.
 *
 * Hasta ahora los partes solo se veían entrando a una incidencia o a una
 * máquina. Esta vista responde las preguntas que antes no tenían respuesta:
 * qué se emitió en un rango de fechas, cuánto suman las horas y el costo, y
 * sobre todo qué partes quedaron abiertos sin que nadie los finalizara.
 */

const API = 'https://gideonstudio.duckdns.org/api/v1/mobile/operations';

// Rango por defecto: el mes en curso. Con el histórico creciendo, abrir con
// "todo" sería una lista inmanejable desde el primer día.
const primerDiaDelMes = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
};
const hoyISO = () => new Date().toISOString().slice(0, 10);

const fmtNum = (n) => (parseFloat(n) || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtCant = (n) => (parseFloat(n) || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
const uMetrado = (u) => ({ m: 'm', m2: 'm²', m3: 'm³', glb: 'glb' }[u] || u || 'm³');

function Partes({ irAIncidente }) {
  const [partes, setPartes] = useState([]);
  const [totales, setTotales] = useState({ total_partes: 0, total_horas: 0, total_costo: 0, total_combustible: 0, abiertos: 0, cerrados: 0 });
  const [cargando, setCargando] = useState(true);
  const [maquinas, setMaquinas] = useState([]);
  const [detalle, setDetalle] = useState(null);      // parte abierto en el modal
  const [pdfUrl, setPdfUrl] = useState(null);
  const [cerrando, setCerrando] = useState(null);    // id del parte en proceso

  // ── Filtros ─────────────────────────────────────────────────────────
  const [desde, setDesde] = useState(primerDiaDelMes());
  const [hasta, setHasta] = useState(hoyISO());
  const [estado, setEstado] = useState('');          // '' | abierto | cerrado
  const [maquina, setMaquina] = useState('');
  const [q, setQ] = useState('');
  const [pagina, setPagina] = useState(1);
  const porPagina = 15;

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const p = new URLSearchParams();
      if (desde) p.set('desde', desde);
      if (hasta) p.set('hasta', hasta);
      if (estado) p.set('estado', estado);
      if (maquina) p.set('maquina', maquina);
      if (q.trim()) p.set('q', q.trim());
      const r = await fetch(`${API}/partes-diarios/?${p.toString()}`);
      if (r.ok) {
        const d = await r.json();
        setPartes(d.partes || []);
        setTotales({
          total_partes: d.total_partes || 0,
          total_horas: d.total_horas || 0,
          total_costo: d.total_costo || 0,
          total_combustible: d.total_combustible || 0,
          abiertos: d.abiertos || 0,
          cerrados: d.cerrados || 0,
        });
        setPagina(1);
      }
    } catch (e) { console.error('Partes:', e); }
    finally { setCargando(false); }
  }, [desde, hasta, estado, maquina, q]);

  useEffect(() => { cargar(); }, []);   // primera carga

  // Catálogo de máquinas para el filtro.
  useEffect(() => {
    fetch(`${API}/modelos/`)
      .then(r => r.ok ? r.json() : [])
      .then(d => setMaquinas(Array.isArray(d) ? d : (d.results || [])))
      .catch(() => setMaquinas([]));
  }, []);

  const limpiar = () => {
    setDesde(primerDiaDelMes()); setHasta(hoyISO());
    setEstado(''); setMaquina(''); setQ('');
  };
  const hayFiltros = estado || maquina || q.trim() ||
    desde !== primerDiaDelMes() || hasta !== hoyISO();

  // ── Cerrar un parte desde aquí ──────────────────────────────────────
  // Es la razón principal de esta vista: hasta ahora, para finalizar un parte
  // olvidado había que adivinar en qué incidencia estaba.
  const cerrarParte = async (parte) => {
    const c = await Swal.fire({
      title: '¿Finalizar este parte?',
      html: `<b>${parte.part_number}</b><br>${parte.codigo || parte.equipo}<br><br>
             Se cerrará el parte y la máquina quedará <b>disponible</b>.`,
      icon: 'question', showCancelButton: true, confirmButtonColor: '#206bc4',
      confirmButtonText: 'Sí, finalizar', cancelButtonText: 'Cancelar',
    });
    if (!c.isConfirmed) return;
    setCerrando(parte.id);
    try {
      const r = await fetch(`${API}/daily-part-heavy-equipments/${parte.id}/cerrar/`, { method: 'POST' });
      if (r.ok) {
        const d = await r.json();
        Swal.fire({
          icon: 'success', title: 'Parte cerrado',
          text: d.maquina_liberada ? `Se liberó la máquina ${d.maquina_liberada}.` : 'El parte quedó cerrado.',
          timer: 1800, showConfirmButton: false,
        });
        cargar();
      } else {
        Swal.fire('Error', `No se pudo cerrar (código ${r.status}).`, 'error');
      }
    } catch (e) {
      Swal.fire('Error', 'Fallo de conexión al cerrar.', 'error');
    } finally { setCerrando(null); }
  };

  // ── Exportar a Excel lo que se está viendo ──────────────────────────
  const exportarExcel = async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Partes Diarios');
    ws.columns = [
      { header: 'N° PARTE', key: 'n', width: 22 },
      { header: 'FECHA', key: 'f', width: 12 },
      { header: 'ESTADO', key: 'e', width: 11 },
      { header: 'CÓDIGO', key: 'c', width: 11 },
      { header: 'EQUIPO', key: 'eq', width: 30 },
      { header: 'MARCA', key: 'ma', width: 16 },
      { header: 'PLACA', key: 'pl', width: 12 },
      { header: 'TURNO', key: 't', width: 9 },
      { header: 'ZONA', key: 'z', width: 22 },
      { header: 'OPERADOR', key: 'op', width: 26 },
      { header: 'PROVEEDOR', key: 'pr', width: 28 },
      { header: 'ACTIVIDAD', key: 'ac', width: 28 },
      { header: 'HM INICIO', key: 'hi', width: 12 },
      { header: 'HM FIN', key: 'hf', width: 12 },
      { header: 'HORAS', key: 'h', width: 11 },
      { header: 'P. UNIT.', key: 'pu', width: 13 },
      { header: 'COSTO S/', key: 'co', width: 14 },
      { header: 'COMBUST.', key: 'cb', width: 12 },
      { header: 'METRADO', key: 'me', width: 13 },
      { header: 'UND', key: 'un', width: 7 },
      { header: 'INCIDENCIA', key: 'in', width: 34 },
    ];
    ws.getRow(1).eachCell(c => {
      c.font = { bold: true, color: { argb: 'FFFFFF' }, size: 9 };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '1463A5' } };
      c.alignment = { horizontal: 'center', vertical: 'middle' };
    });
    ws.getRow(1).height = 20;

    partes.forEach(p => {
      ws.addRow({
        n: p.part_number, f: p.date_txt, e: p.cerrado ? 'Cerrado' : 'Abierto',
        c: p.codigo, eq: p.equipo, ma: p.marca, pl: p.placa, t: p.shift,
        z: p.work_zone_text, op: p.operator, pr: p.provider, ac: p.activities,
        hi: p.start_horometer, hf: p.end_horometer, h: p.horas,
        pu: p.unit_price, co: p.costo, cb: p.fuel_gallons,
        me: p.metrado, un: uMetrado(p.metrado_unidad),
        in: p.incidente_tipo ? `${p.incidente_tipo} · ${p.incidente_lugar || ''}` : '',
      });
    });
    // Formato numérico: cantidades con hasta 4 decimales, importes con 2.
    for (let i = 2; i <= partes.length + 1; i++) {
      ['M', 'N', 'O', 'R', 'S'].forEach(col => { ws.getCell(`${col}${i}`).numFmt = '#,##0.00##'; });
      ['P', 'Q'].forEach(col => { ws.getCell(`${col}${i}`).numFmt = '#,##0.00'; });
    }

    // Fila de totales
    const fT = partes.length + 3;
    ws.getCell(`A${fT}`).value = `TOTALES (${totales.total_partes} partes)`;
    ws.getCell(`A${fT}`).font = { bold: true, size: 11, color: { argb: '1463A5' } };
    ws.getCell(`O${fT}`).value = totales.total_horas;
    ws.getCell(`Q${fT}`).value = totales.total_costo;
    ws.getCell(`R${fT}`).value = totales.total_combustible;
    ['O', 'Q', 'R'].forEach(col => {
      const c = ws.getCell(`${col}${fT}`);
      c.numFmt = '#,##0.00'; c.font = { bold: true, size: 10 };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'E0F2FE' } };
    });

    const buf = await wb.xlsx.writeBuffer();
    const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `Partes_Diarios_${desde}_a_${hasta}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Paginación ──────────────────────────────────────────────────────
  const totalPaginas = Math.max(1, Math.ceil(partes.length / porPagina));
  const visibles = useMemo(
    () => partes.slice((pagina - 1) * porPagina, pagina * porPagina),
    [partes, pagina]
  );

  const selStyle = { padding: '7px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 12, color: '#334155', background: '#fff', cursor: 'pointer', minWidth: 140 };

  return (
    <div className="tbl-page-wrapper">
      <div className="tbl-page-header">
        <div className="tbl-row align-items-center">
          <div className="tbl-col">
            <div className="tbl-page-pretitle">Gestión de Flota</div>
            <h2 className="tbl-page-title">Partes Diarios</h2>
          </div>
          <div className="tbl-col-auto" style={{ display: 'flex', gap: 8 }}>
            <button className="tbl-btn" onClick={exportarExcel} disabled={!partes.length}
              style={{ background: '#2fb344', color: '#fff', border: 'none', display: 'flex', alignItems: 'center', gap: 8, opacity: partes.length ? 1 : .5 }}>
              <FaFileExcel /> Excel
            </button>
            <button className="tbl-btn tbl-btn-primary" onClick={cargar} disabled={cargando}>
              <FaSyncAlt className={cargando ? 'icon-spin' : ''} style={{ marginRight: 8 }} />
              {cargando ? 'Cargando...' : 'Actualizar'}
            </button>
          </div>
        </div>
      </div>

      <div className="tbl-page-body">

        {/* ── Tarjetas de totales del filtro aplicado ── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12, marginBottom: 16 }}>
          {[
            { et: 'Partes', va: totales.total_partes, ico: <FaClipboardList />, col: '#1463A5' },
            { et: 'Horas máquina', va: fmtNum(totales.total_horas), su: 'HE', ico: <FaTruck />, col: '#0284c7' },
            { et: 'Costo total', va: `S/ ${fmtNum(totales.total_costo)}`, ico: <FaFilePdf />, col: '#7048e8' },
            { et: 'Combustible', va: fmtNum(totales.total_combustible), su: 'Gls', ico: <FaSyncAlt />, col: '#f59f00' },
            { et: 'Sin finalizar', va: totales.abiertos, ico: <FaExclamationTriangle />, col: totales.abiertos ? '#d63939' : '#2fb344' },
          ].map(k => (
            <div key={k.et} style={{ background: '#fff', border: '1px solid #e2e8f0', borderLeft: `4px solid ${k.col}`, borderRadius: 10, padding: '12px 15px', boxShadow: '0 1px 3px rgba(0,0,0,.05)' }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.4px', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ color: k.col }}>{k.ico}</span> {k.et}
              </div>
              <div style={{ fontSize: 22, fontWeight: 800, color: '#1e293b', marginTop: 3 }}>
                {k.va} {k.su && <small style={{ fontSize: 12, fontWeight: 600, color: '#64748b' }}>{k.su}</small>}
              </div>
            </div>
          ))}
        </div>

        {/* ── Filtros ── */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 16, padding: '12px 14px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8 }}>
          <span style={{ fontSize: 13, color: '#64748b', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
            <FaFilter size={12} /> Filtrar:
          </span>

          <label style={{ fontSize: 12, color: '#64748b', display: 'flex', alignItems: 'center', gap: 5 }}>
            Desde <input type="date" value={desde} onChange={e => setDesde(e.target.value)} style={selStyle} />
          </label>
          <label style={{ fontSize: 12, color: '#64748b', display: 'flex', alignItems: 'center', gap: 5 }}>
            Hasta <input type="date" value={hasta} onChange={e => setHasta(e.target.value)} style={selStyle} />
          </label>

          <select value={estado} onChange={e => setEstado(e.target.value)} style={selStyle}>
            <option value="">Todos los estados</option>
            <option value="abierto">Sin finalizar</option>
            <option value="cerrado">Cerrados</option>
          </select>

          <select value={maquina} onChange={e => setMaquina(e.target.value)} style={{ ...selStyle, minWidth: 200 }}>
            <option value="">Todas las máquinas</option>
            {maquinas.map(m => (
              <option key={m.id} value={m.id}>
                {m.codigo} · {m.equipo_nombre} {m.marca_nombre}
              </option>
            ))}
          </select>

          <div style={{ position: 'relative', flex: 1, minWidth: 190, maxWidth: 320 }}>
            <FaSearch size={11} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
            <input type="text" placeholder="N° parte, operador, actividad, zona..."
              value={q} onChange={e => setQ(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && cargar()}
              style={{ ...selStyle, paddingLeft: 30, width: '100%' }} />
          </div>

          <button onClick={cargar} className="tbl-btn tbl-btn-primary" style={{ fontSize: 12, padding: '7px 14px' }}>
            Aplicar
          </button>
          {hayFiltros && (
            <button onClick={limpiar} style={{ display: 'flex', alignItems: 'center', gap: 5, background: '#fff', border: '1px solid #cbd5e1', color: '#64748b', borderRadius: 6, padding: '7px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
              <FaTimes size={11} /> Limpiar
            </button>
          )}
        </div>

        {/* ── Tabla ── */}
        {cargando ? (
          <div className="tbl-empty">Cargando partes…</div>
        ) : partes.length === 0 ? (
          <div className="tbl-empty" style={{ textAlign: 'center', padding: 40 }}>
            <div style={{ fontSize: 14, color: '#64748b', marginBottom: 10 }}>
              No hay partes diarios en este rango.
            </div>
            {hayFiltros && <button onClick={limpiar} className="tbl-btn tbl-btn-primary" style={{ fontSize: 13 }}>Limpiar filtros</button>}
          </div>
        ) : (
          <>
            <div className="tbl-table-responsive" style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden' }}>
              <table className="tbl-table tbl-table-vcenter" style={{ fontSize: 12.5 }}>
                <thead>
                  <tr>
                    <th>N° PARTE</th>
                    <th>FECHA</th>
                    <th>MÁQUINA</th>
                    <th>ACTIVIDAD</th>
                    <th>OPERADOR</th>
                    <th className="tbl-text-end">HORAS</th>
                    <th className="tbl-text-end">METRADO</th>
                    <th className="tbl-text-end">COSTO</th>
                    <th>ESTADO</th>
                    <th style={{ textAlign: 'right' }}>ACCIONES</th>
                  </tr>
                </thead>
                <tbody>
                  {visibles.map(p => (
                    <tr key={p.id} style={{ background: p.cerrado ? '#fff' : '#fffbeb' }}>
                      <td style={{ fontWeight: 700, color: '#1e293b', whiteSpace: 'nowrap' }}>{p.part_number}</td>
                      <td style={{ whiteSpace: 'nowrap', color: '#475569' }}>{p.date_txt}</td>
                      <td>
                        <span style={{ fontWeight: 700, color: p.origen === 'JURP' ? '#206bc4' : '#d6832b' }}>{p.codigo || '—'}</span>
                        <div style={{ fontSize: 10.5, color: '#64748b' }}>{p.equipo} {p.marca}</div>
                      </td>
                      <td style={{ maxWidth: 190, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#475569' }} title={p.activities}>
                        {p.activities || '—'}
                      </td>
                      <td style={{ maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#475569' }} title={p.operator}>
                        {p.operator || '—'}
                      </td>
                      <td className="tbl-text-end" style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{fmtCant(p.horas)} HE</td>
                      <td className="tbl-text-end" style={{ whiteSpace: 'nowrap', color: '#475569' }}>
                        {p.metrado ? `${fmtCant(p.metrado)} ${uMetrado(p.metrado_unidad)}` : '—'}
                      </td>
                      <td className="tbl-text-end" style={{ fontWeight: 700, color: '#1463A5', whiteSpace: 'nowrap' }}>S/ {fmtNum(p.costo)}</td>
                      <td>
                        <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 9px', borderRadius: 4, whiteSpace: 'nowrap', background: p.cerrado ? '#dcfce7' : '#fef3c7', color: p.cerrado ? '#15803d' : '#b45309' }}>
                          {p.cerrado ? 'CERRADO' : 'ABIERTO'}
                        </span>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 5, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                          <button type="button" onClick={() => setDetalle(p)} title="Ver detalle"
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 9px', background: '#f1f5f9', color: '#475569', border: 'none', borderRadius: 5, cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>
                            <FaEye size={11} /> Detalle
                          </button>
                          <button type="button" onClick={() => setPdfUrl(`${API}/daily-part-heavy-equipments/${p.id}/pdf/`)} title="Ver PDF del parte"
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 9px', background: '#fee2e2', color: '#b91c1c', border: 'none', borderRadius: 5, cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>
                            <FaFilePdf size={11} /> PDF
                          </button>
                          {!p.cerrado && (
                            <button type="button" onClick={() => cerrarParte(p)} disabled={cerrando === p.id}
                              title="Finalizar el parte y liberar la máquina"
                              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 9px', background: '#dcfce7', color: '#15803d', border: 'none', borderRadius: 5, cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>
                              {cerrando === p.id ? <FaSyncAlt className="icon-spin" size={11} /> : <FaCheckCircle size={11} />} Finalizar
                            </button>
                          )}
                          {p.incidente_id && irAIncidente && (
                            <button type="button" onClick={() => irAIncidente(p.incidente_id)} title="Abrir la incidencia"
                              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 9px', background: '#e0f2fe', color: '#0284c7', border: 'none', borderRadius: 5, cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>
                              Incidencia →
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="tbl-pagination-wrapper">
              <span className="tbl-text-muted">
                {partes.length} parte(s) · página {pagina} de {totalPaginas}
              </span>
              <ul className="tbl-pagination">
                <li className={`tbl-page-item ${pagina === 1 ? 'disabled' : ''}`} onClick={() => setPagina(p => Math.max(1, p - 1))}>
                  <button className="tbl-page-link"><FaChevronLeft /></button>
                </li>
                <li className={`tbl-page-item ${pagina === totalPaginas ? 'disabled' : ''}`} onClick={() => setPagina(p => Math.min(totalPaginas, p + 1))}>
                  <button className="tbl-page-link"><FaChevronRight /></button>
                </li>
              </ul>
            </div>
          </>
        )}
      </div>

      {/* ── Modal de detalle ── */}
      {detalle && (
        <div className="tbl-modal-backdrop" onClick={() => setDetalle(null)} style={{ zIndex: 10001 }}>
          <div className="tbl-modal-dialog" onClick={e => e.stopPropagation()} style={{ maxWidth: 720 }}>
            <div className="tbl-modal-content">
              <div className="tbl-modal-header">
                <h5 className="tbl-modal-title">
                  <FaClipboardList style={{ marginRight: 8 }} /> {detalle.part_number}
                </h5>
                <button className="tbl-btn-close" onClick={() => setDetalle(null)}><FaTimes /></button>
              </div>
              <div className="tbl-modal-body">
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 10 }}>
                  {[
                    ['Fecha', detalle.date_txt],
                    ['Turno', detalle.shift],
                    ['Estado', detalle.cerrado ? 'Cerrado' : 'Abierto'],
                    ['Máquina', `${detalle.codigo} · ${detalle.equipo}`],
                    ['Marca / Modelo', `${detalle.marca} ${detalle.modelo}`],
                    ['Placa', detalle.placa || '—'],
                    ['Zona de trabajo', detalle.work_zone_text || '—'],
                    ['Proveedor', detalle.provider || '—'],
                    ['Operador', detalle.operator || '—'],
                    ['Actividad', detalle.activities || '—'],
                    ['HM inicio → fin', `${fmtCant(detalle.start_horometer)} → ${fmtCant(detalle.end_horometer)}`],
                    ['Horas', `${fmtCant(detalle.horas)} HE`],
                    ['Precio unitario', `S/ ${fmtNum(detalle.unit_price)}`],
                    ['Costo', `S/ ${fmtNum(detalle.costo)}`],
                    ['Combustible', `${fmtCant(detalle.fuel_gallons)} Gls${detalle.fuel_voucher ? ` · vale ${detalle.fuel_voucher}` : ''}`],
                    ['Metrado', detalle.metrado ? `${fmtCant(detalle.metrado)} ${uMetrado(detalle.metrado_unidad)} ${detalle.metrado_calculado ? '(por fórmula)' : '(manual)'}` : '—'],
                  ].map(([et, va]) => (
                    <div key={et} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 7, padding: '8px 11px' }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.3px' }}>{et}</div>
                      <div style={{ fontSize: 13, color: '#1e293b', marginTop: 2 }}>{va}</div>
                    </div>
                  ))}
                </div>

                {detalle.observations && (
                  <div style={{ marginTop: 12, background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 7, padding: '9px 12px' }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#b45309', textTransform: 'uppercase' }}>Observaciones</div>
                    <div style={{ fontSize: 13, color: '#78350f', marginTop: 2, whiteSpace: 'pre-wrap' }}>{detalle.observations}</div>
                  </div>
                )}

                {detalle.incidente_id && (
                  <div style={{ marginTop: 12, background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 7, padding: '9px 12px' }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#1463A5', textTransform: 'uppercase' }}>Incidencia</div>
                    <div style={{ fontSize: 13, color: '#1e293b', marginTop: 2 }}>
                      {detalle.incidente_tipo} · {detalle.incidente_codigo} · {detalle.incidente_lugar}
                    </div>
                  </div>
                )}
              </div>
              <div className="tbl-modal-footer" style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button className="tbl-btn" onClick={() => setPdfUrl(`${API}/daily-part-heavy-equipments/${detalle.id}/pdf/`)}
                  style={{ background: '#d63939', color: '#fff', border: 'none', padding: '6px 14px', borderRadius: 4, cursor: 'pointer', fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <FaFilePdf /> Ver PDF
                </button>
                <button className="tbl-btn tbl-btn-link" onClick={() => setDetalle(null)}>Cerrar</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Visor de PDF ── */}
      {pdfUrl && (
        <div className="tbl-modal-backdrop" onClick={() => setPdfUrl(null)} style={{ zIndex: 10002, backgroundColor: 'rgba(0,0,0,.75)' }}>
          <div className="tbl-modal-dialog" onClick={e => e.stopPropagation()} style={{ maxWidth: 880, height: '90vh', display: 'flex', flexDirection: 'column', marginTop: '2vh' }}>
            <div className="tbl-modal-content" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
              <div className="tbl-modal-header" style={{ background: '#f8fafc' }}>
                <h5 className="tbl-modal-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <FaFilePdf color="#dc2626" /> Parte Diario
                </h5>
                <button className="tbl-btn-close" onClick={() => setPdfUrl(null)}><FaTimes /></button>
              </div>
              <div className="tbl-modal-body" style={{ flex: 1, padding: 0, overflow: 'hidden', background: '#525659' }}>
                <iframe src={pdfUrl} style={{ width: '100%', height: '100%', border: 'none' }} title="Visor PDF" />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Partes;
