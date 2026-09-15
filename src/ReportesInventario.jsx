import { useState, useEffect, useMemo } from 'react';
import {
  FaSyncAlt, FaFileExcel, FaFilePdf, FaClipboardCheck, FaSearch,
  FaFilter, FaTimes, FaExclamationCircle, FaChevronLeft, FaChevronRight,
} from 'react-icons/fa';
import ExcelJS from 'exceljs';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import './Incidentes.css';
import './EstadisticasGIS.css';

/**
 * Reportes del módulo INVENTARIO.
 *
 * La tabla de abajo es la previsualización: lo que se ve es exactamente lo
 * que sale en el Excel y en el PDF, con los mismos filtros aplicados. Así no
 * hay sorpresas al exportar.
 */

const API = '/vigapi/inventario';
const token = () => localStorage.getItem('userToken');

// Mismos grupos y rótulos que el panel del mapa, para no hablar dos idiomas.
const CAPAS = [
  { codigo: 'tomas_l10',            label: 'Tomas Lateral 10' },
  { codigo: 'tomas_otros_sectores', label: 'Tomas otros sectores' },
  { codigo: 'entregas',             label: 'Entregas' },
  { codigo: 'laterales',            label: 'Laterales' },
  { codigo: 'partidor',             label: 'Partidores' },
  { codigo: 'canoas',               label: 'Canoas' },
  { codigo: 'sifon',                label: 'Sifones' },
  { codigo: 'alcantarilla',         label: 'Alcantarillas' },
  { codigo: 'aliviadero',           label: 'Aliviaderos' },
  { codigo: 'desarenadores',        label: 'Desarenadores' },
  { codigo: 'camara_rompepresion',  label: 'Cámaras rompepresión' },
  { codigo: 'cajas_hidraulicas',    label: 'Cajas hidráulicas' },
  { codigo: 'pases_de_tuberias',    label: 'Pases de tuberías' },
  { codigo: 'reservorios',          label: 'Reservorios' },
  { codigo: 'puente_vehicular',     label: 'Puentes vehiculares' },
  { codigo: 'puente_peatonal',      label: 'Puentes peatonales' },
];
const ETIQUETA = Object.fromEntries(CAPAS.map(c => [c.codigo, c.label]));

const ESTADOS = {
  bueno: { txt: 'Bueno', color: '#2f9e44', fondo: '#dcfce7' },
  regular: { txt: 'Regular', color: '#b45309', fondo: '#fef3c7' },
  malo: { txt: 'Malo', color: '#c2410c', fondo: '#ffedd5' },
  colapsado: { txt: 'Colapsado', color: '#b91c1c', fondo: '#fee2e2' },
  no_ubicado: { txt: 'No ubicado', color: '#475569', fondo: '#f1f5f9' },
};

const cab = () => ({ Authorization: `Token ${token()}` });
const fmt = (n) => (parseFloat(n) || 0).toLocaleString('es-PE');

function ReportesInventario() {
  const [campania, setCampania] = useState(null);
  const [avance, setAvance] = useState([]);
  const [evaluaciones, setEvaluaciones] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [generando, setGenerando] = useState(false);

  // Filtros de la previsualización
  const [fTipo, setFTipo] = useState('');
  const [fEstado, setFEstado] = useState('');
  const [q, setQ] = useState('');
  const [pagina, setPagina] = useState(1);
  const porPagina = 12;

  const cargar = async () => {
    setCargando(true); setError(null);
    try {
      const rc = await fetch(`${API}/campanias/`, { headers: cab() });
      if (!rc.ok) throw new Error('No se pudo consultar las campañas');
      const camps = await rc.json();
      const lista = camps.results || camps;
      const activa = lista.find(c => c.estado === 'en_proceso') || lista[0];
      setCampania(activa || null);

      if (activa) {
        const [ra, re] = await Promise.all([
          fetch(`${API}/campanias/${activa.id}/avance/`, { headers: cab() }),
          fetch(`${API}/evaluaciones/?campania=${activa.anio}`, { headers: cab() }),
        ]);
        if (ra.ok) setAvance((await ra.json()).detalle || []);
        if (re.ok) {
          const ev = await re.json();
          setEvaluaciones(ev.results || ev || []);
        }
      }
    } catch (e) {
      setError(e.message || 'Error al cargar el inventario');
    } finally { setCargando(false); }
  };

  useEffect(() => { cargar(); }, []);

  // ── Totales ──────────────────────────────────────────────────────────
  const totales = useMemo(() => avance.reduce(
    (a, x) => ({
      total: a.total + (x.total || 0),
      evaluados: a.evaluados + (x.evaluados || 0),
      criticos: a.criticos + (x.criticos || 0),
    }),
    { total: 0, evaluados: 0, criticos: 0 }
  ), [avance]);
  const pct = totales.total ? (totales.evaluados / totales.total * 100) : 0;

  // ── Filas de la previsualización ─────────────────────────────────────
  const filas = useMemo(() => {
    let l = evaluaciones.map(e => ({
      tipo: ETIQUETA[e.tipo_activo] || e.tipo_activo || '',
      tipoCod: e.tipo_activo || '',
      fid: e.activo_fid,
      estado: e.estado_cons || '',
      fecha: e.fecha || '',
      evaluador: e.evaluador || '',
      mantenimiento: e.requiere_mant ? 'Sí' : 'No',
      observaciones: e.observaciones || '',
    }));
    if (fTipo) l = l.filter(x => x.tipoCod === fTipo);
    if (fEstado) l = l.filter(x => x.estado === fEstado);
    if (q.trim()) {
      const t = q.toLowerCase();
      l = l.filter(x =>
        String(x.fid).includes(t) || x.tipo.toLowerCase().includes(t) ||
        x.evaluador.toLowerCase().includes(t) || x.observaciones.toLowerCase().includes(t));
    }
    return l.sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
  }, [evaluaciones, fTipo, fEstado, q]);

  useEffect(() => { setPagina(1); }, [fTipo, fEstado, q]);
  const totalPaginas = Math.max(1, Math.ceil(filas.length / porPagina));
  const visibles = filas.slice((pagina - 1) * porPagina, pagina * porPagina);
  const hayFiltros = fTipo || fEstado || q.trim();

  // ── Exportar a Excel ─────────────────────────────────────────────────
  const aExcel = async () => {
    setGenerando(true);
    try {
      const wb = new ExcelJS.Workbook();

      // Hoja 1: avance por tipo de activo
      const ws1 = wb.addWorksheet('Avance de campaña');
      ws1.columns = [
        { header: 'TIPO DE ACTIVO', key: 't', width: 32 },
        { header: 'TOTAL', key: 'to', width: 12 },
        { header: 'EVALUADOS', key: 'e', width: 13 },
        { header: 'PENDIENTES', key: 'p', width: 13 },
        { header: '% AVANCE', key: 'pc', width: 12 },
        { header: 'CRÍTICOS', key: 'c', width: 11 },
      ];
      avance.filter(a => a.total > 0).forEach(a => ws1.addRow({
        t: a.nombre, to: a.total, e: a.evaluados,
        p: (a.total || 0) - (a.evaluados || 0),
        pc: a.porcentaje != null ? a.porcentaje / 100 : 0,
        c: a.criticos || 0,
      }));
      ws1.addRow({});
      ws1.addRow({
        t: 'TOTAL', to: totales.total, e: totales.evaluados,
        p: totales.total - totales.evaluados,
        pc: totales.total ? totales.evaluados / totales.total : 0,
        c: totales.criticos,
      });

      // Hoja 2: el detalle que se está viendo en pantalla
      const ws2 = wb.addWorksheet('Evaluaciones');
      ws2.columns = [
        { header: 'TIPO', key: 't', width: 26 },
        { header: 'ID ACTIVO', key: 'f', width: 12 },
        { header: 'ESTADO', key: 'e', width: 14 },
        { header: 'FECHA', key: 'fe', width: 13 },
        { header: 'EVALUADOR', key: 'ev', width: 24 },
        { header: 'REQ. MANT.', key: 'm', width: 12 },
        { header: 'OBSERVACIONES', key: 'o', width: 48 },
      ];
      filas.forEach(f => ws2.addRow({
        t: f.tipo, f: f.fid, e: ESTADOS[f.estado]?.txt || f.estado,
        fe: f.fecha, ev: f.evaluador, m: f.mantenimiento, o: f.observaciones,
      }));

      for (const ws of [ws1, ws2]) {
        ws.getRow(1).eachCell(c => {
          c.font = { bold: true, color: { argb: 'FFFFFF' }, size: 9 };
          c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '0CA678' } };
          c.alignment = { horizontal: 'center', vertical: 'middle' };
        });
        ws.getRow(1).height = 20;
      }
      ws1.getColumn('pc').numFmt = '0.0%';

      const buf = await wb.xlsx.writeBuffer();
      const url = URL.createObjectURL(new Blob([buf], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `Inventario_${campania?.anio || ''}_${new Date().toISOString().slice(0,10)}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } finally { setGenerando(false); }
  };

  // ── Exportar a PDF ───────────────────────────────────────────────────
  const aPDF = () => {
    setGenerando(true);
    try {
      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      const W = doc.internal.pageSize.getWidth();

      doc.setFillColor(12, 166, 120);
      doc.rect(0, 0, W, 24, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(13); doc.setFont(undefined, 'bold');
      doc.text('INVENTARIO DE INFRAESTRUCTURA DE RIEGO', 12, 10);
      doc.setFontSize(9); doc.setFont(undefined, 'normal');
      doc.text(
        `Campaña ${campania?.anio || '—'}  ·  ${totales.evaluados} de ${totales.total} activos evaluados `
        + `(${pct.toFixed(1)}%)  ·  Generado ${new Date().toLocaleString('es-PE')}`, 12, 17);

      autoTable(doc, {
        startY: 30,
        head: [['TIPO DE ACTIVO', 'TOTAL', 'EVALUADOS', 'PENDIENTES', '% AVANCE', 'CRÍTICOS']],
        body: avance.filter(a => a.total > 0).map(a => ([
          a.nombre, String(a.total), String(a.evaluados),
          String((a.total || 0) - (a.evaluados || 0)),
          `${a.porcentaje ?? 0}%`, String(a.criticos || 0),
        ])),
        foot: [['TOTAL', String(totales.total), String(totales.evaluados),
                String(totales.total - totales.evaluados), `${pct.toFixed(1)}%`,
                String(totales.criticos)]],
        showFoot: 'lastPage',
        styles: { fontSize: 8, cellPadding: 2 },
        headStyles: { fillColor: [71, 85, 105], textColor: 255 },
        footStyles: { fillColor: [220, 252, 231], textColor: [12, 120, 90], fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        margin: { left: 12, right: 12 },
      });

      if (filas.length) {
        doc.addPage();
        autoTable(doc, {
          startY: 14,
          head: [['TIPO', 'ID', 'ESTADO', 'FECHA', 'EVALUADOR', 'MANT.', 'OBSERVACIONES']],
          body: filas.map(f => ([
            f.tipo, String(f.fid), ESTADOS[f.estado]?.txt || f.estado,
            f.fecha, f.evaluador, f.mantenimiento, (f.observaciones || '').slice(0, 70),
          ])),
          styles: { fontSize: 7.5, cellPadding: 1.8 },
          headStyles: { fillColor: [71, 85, 105], textColor: 255 },
          alternateRowStyles: { fillColor: [248, 250, 252] },
          margin: { left: 12, right: 12 },
        });
      }

      doc.save(`Inventario_${campania?.anio || ''}_${new Date().toISOString().slice(0,10)}.pdf`);
    } finally { setGenerando(false); }
  };

  const sel = { padding: '7px 10px', border: '1px solid #cbd5e1', borderRadius: 6,
                fontSize: 12, color: '#334155', background: '#fff', cursor: 'pointer' };

  if (cargando) return (
    <div className="tbl-page-wrapper">
      <div className="tbl-empty" style={{ height: '60vh', display: 'flex', alignItems: 'center',
        justifyContent: 'center', gap: 8, fontWeight: 600 }}>
        <FaSyncAlt className="icon-spin" /> Cargando inventario…
      </div>
    </div>
  );

  return (
    <div className="tbl-page-wrapper">
      <div className="tbl-page-header">
        <div className="tbl-row align-items-center">
          <div className="tbl-col">
            <div className="tbl-page-pretitle">Módulo Inventario</div>
            <h2 className="tbl-page-title">Reportes de Inventario</h2>
          </div>
          <div className="tbl-col-auto" style={{ display: 'flex', gap: 8 }}>
            <button className="tbl-btn" onClick={aExcel} disabled={generando || !avance.length}
              style={{ background: '#2fb344', color: '#fff', border: 'none',
                       display: 'flex', alignItems: 'center', gap: 8 }}>
              <FaFileExcel /> Excel
            </button>
            <button className="tbl-btn" onClick={aPDF} disabled={generando || !avance.length}
              style={{ background: '#d63939', color: '#fff', border: 'none',
                       display: 'flex', alignItems: 'center', gap: 8 }}>
              <FaFilePdf /> PDF
            </button>
            <button className="tbl-btn tbl-btn-primary" onClick={cargar}>
              <FaSyncAlt style={{ marginRight: 8 }} /> Actualizar
            </button>
          </div>
        </div>
      </div>

      <div className="tbl-page-body">
        {error && (
          <div style={{ background: '#fee2e2', border: '1px solid #fecaca', color: '#b91c1c',
                        borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 13 }}>
            <FaExclamationCircle style={{ marginRight: 6 }} /> {error}
          </div>
        )}

        {/* ── Avance de la campaña ── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
                      gap: 12, marginBottom: 16 }}>
          {[
            { et: 'Campaña', va: campania?.anio || '—', col: '#0CA678' },
            { et: 'Activos', va: fmt(totales.total), col: '#1463A5' },
            { et: 'Evaluados', va: fmt(totales.evaluados), col: '#0284c7' },
            { et: 'Pendientes', va: fmt(totales.total - totales.evaluados), col: '#f59f00' },
            { et: 'Estado crítico', va: fmt(totales.criticos), col: totales.criticos ? '#d63939' : '#2fb344' },
          ].map(k => (
            <div key={k.et} style={{ background: '#fff', border: '1px solid #e2e8f0',
              borderLeft: `4px solid ${k.col}`, borderRadius: 10, padding: '12px 15px',
              boxShadow: '0 1px 3px rgba(0,0,0,.05)' }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: '#64748b',
                textTransform: 'uppercase', letterSpacing: '.4px' }}>{k.et}</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: '#1e293b', marginTop: 3 }}>{k.va}</div>
            </div>
          ))}
        </div>

        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10,
                      padding: '14px 16px', marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5,
                        color: '#475569', marginBottom: 7, fontWeight: 600 }}>
            <span>Avance de la campaña</span>
            <span style={{ color: '#0CA678', fontWeight: 800 }}>{pct.toFixed(1)}%</span>
          </div>
          <div style={{ height: 9, background: '#f1f5f9', borderRadius: 5, overflow: 'hidden' }}>
            <div style={{ width: `${pct}%`, height: '100%',
                          background: 'linear-gradient(90deg,#0CA678,#35B6E9)' }} />
          </div>
        </div>

        {/* ── Filtros de la previsualización ── */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap',
          marginBottom: 14, padding: '12px 14px', background: '#f8fafc',
          border: '1px solid #e2e8f0', borderRadius: 8 }}>
          <span style={{ fontSize: 13, color: '#64748b', fontWeight: 600,
            display: 'flex', alignItems: 'center', gap: 6 }}>
            <FaFilter size={12} /> Previsualización:
          </span>
          <select value={fTipo} onChange={e => setFTipo(e.target.value)} style={{ ...sel, minWidth: 190 }}>
            <option value="">Todos los tipos</option>
            {CAPAS.map(c => <option key={c.codigo} value={c.codigo}>{c.label}</option>)}
          </select>
          <select value={fEstado} onChange={e => setFEstado(e.target.value)} style={{ ...sel, minWidth: 160 }}>
            <option value="">Todos los estados</option>
            {Object.entries(ESTADOS).map(([k, v]) => <option key={k} value={k}>{v.txt}</option>)}
          </select>
          <div style={{ position: 'relative', flex: 1, minWidth: 190, maxWidth: 320 }}>
            <FaSearch size={11} style={{ position: 'absolute', left: 10, top: '50%',
              transform: 'translateY(-50%)', color: '#94a3b8' }} />
            <input type="text" placeholder="ID, tipo, evaluador, observación…"
              value={q} onChange={e => setQ(e.target.value)}
              style={{ ...sel, paddingLeft: 30, width: '100%' }} />
          </div>
          {hayFiltros && (
            <button onClick={() => { setFTipo(''); setFEstado(''); setQ(''); }}
              style={{ display: 'flex', alignItems: 'center', gap: 5, background: '#fff',
                border: '1px solid #cbd5e1', color: '#64748b', borderRadius: 6,
                padding: '7px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
              <FaTimes size={11} /> Limpiar
            </button>
          )}
          <span style={{ fontSize: 12, color: '#64748b', fontWeight: 600 }}>
            {filas.length} evaluación(es) · esto es lo que se exporta
          </span>
        </div>

        {/* ── Tabla: lo que se ve es lo que sale en Excel y PDF ── */}
        {filas.length === 0 ? (
          <div className="tbl-empty" style={{ textAlign: 'center', padding: 40, color: '#64748b' }}>
            <FaClipboardCheck size={26} style={{ color: '#cbd5e1', marginBottom: 10 }} />
            <div>{evaluaciones.length ? 'Ninguna evaluación cumple los filtros.'
                                      : 'Todavía no hay evaluaciones en esta campaña.'}</div>
          </div>
        ) : (
          <>
            <div className="tbl-table-responsive" style={{ background: '#fff',
              border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden' }}>
              <table className="tbl-table tbl-table-vcenter" style={{ fontSize: 12.5 }}>
                <thead>
                  <tr>
                    <th>TIPO</th><th>ID</th><th>ESTADO</th><th>FECHA</th>
                    <th>EVALUADOR</th><th>MANT.</th><th>OBSERVACIONES</th>
                  </tr>
                </thead>
                <tbody>
                  {visibles.map((f, i) => {
                    const e = ESTADOS[f.estado] || { txt: f.estado, color: '#475569', fondo: '#f1f5f9' };
                    return (
                      <tr key={i}>
                        <td style={{ color: '#475569' }}>{f.tipo}</td>
                        <td style={{ fontWeight: 700, color: '#1e293b' }}>{f.fid}</td>
                        <td>
                          <span style={{ fontSize: 10.5, fontWeight: 700, padding: '3px 9px',
                            borderRadius: 4, whiteSpace: 'nowrap',
                            background: e.fondo, color: e.color }}>{e.txt.toUpperCase()}</span>
                        </td>
                        <td style={{ whiteSpace: 'nowrap', color: '#475569' }}>{f.fecha || '—'}</td>
                        <td style={{ color: '#475569' }}>{f.evaluador || '—'}</td>
                        <td style={{ color: f.mantenimiento === 'Sí' ? '#b45309' : '#64748b',
                                     fontWeight: f.mantenimiento === 'Sí' ? 700 : 400 }}>
                          {f.mantenimiento}
                        </td>
                        <td style={{ maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap', color: '#64748b' }} title={f.observaciones}>
                          {f.observaciones || '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="tbl-pagination-wrapper">
              <span className="tbl-text-muted">
                {filas.length} registro(s) · página {pagina} de {totalPaginas}
              </span>
              <ul className="tbl-pagination">
                <li className={`tbl-page-item ${pagina === 1 ? 'disabled' : ''}`}
                  onClick={() => setPagina(p => Math.max(1, p - 1))}>
                  <button className="tbl-page-link"><FaChevronLeft /></button>
                </li>
                <li className={`tbl-page-item ${pagina === totalPaginas ? 'disabled' : ''}`}
                  onClick={() => setPagina(p => Math.min(totalPaginas, p + 1))}>
                  <button className="tbl-page-link"><FaChevronRight /></button>
                </li>
              </ul>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default ReportesInventario;