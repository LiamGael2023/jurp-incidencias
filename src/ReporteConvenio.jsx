// ─────────────────────────────────────────────────────────────────────────
//  ReporteConvenio — el avance físico de la obra, para salir fuera
// ─────────────────────────────────────────────────────────────────────────
//
// QUÉ ES. El reporte que JURP manda a la JUCH: cuánto se programó y cuánto se
// lleva hecho, por dren, en las magnitudes que mide el convenio —longitud y
// combustible— más los beneficiarios. Hasta ahora se armaba a mano en un
// Excel aparte, copiando números de aquí.
//
// EN QUÉ SE DIFERENCIA DE «AVANCE DE OBRA». Aquél valoriza: dice cuánto vale
// lo ejecutado al precio del presupuesto, y es el control interno. Éste no
// habla de dinero en ningún sitio: habla de metros y de galones, que es el
// idioma del convenio. Mezclarlos daría un reporte que a la JUCH le sobra
// medio y al que lleva la obra le falta la otra mitad.
//
// LAS MAGNITUDES NO ESTÁN ESCRITAS AQUÍ. El reporte de referencia tiene dos
// bloques fijos, «Longitud» y «Combustible». Aquí se arman solos a partir de
// las unidades que usen las partidas: hoy salen m y Gln porque es lo que hay
// en Valle Virú, y el día que una obra mida también en m³ aparecerá su bloque
// sin tocar nada. Un bloque por unidad y NUNCA uno que las junte: los metros
// y los galones no se suman, y ese es justamente el error que un reporte
// bonito esconde mejor.
//
// LOS DRENES SON LOS TÍTULOS DE PRIMER NIVEL del presupuesto —«01 · DV
// Compositan I»—, no una lista aparte. Así el reporte no puede desalinearse
// del presupuesto: si se añade un dren, aparece.

import { useState, useEffect, useCallback, useMemo } from 'react';
import ReactApexChart from 'react-apexcharts';
import {
  FaSyncAlt, FaFilePdf, FaExclamationTriangle, FaUsers, FaEdit,
  FaCheck, FaTimes, FaFileContract,
} from 'react-icons/fa';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import Swal from 'sweetalert2';
import { API_OPS } from './api';
import { colorAvance } from './AvanceFisico';

const cant = (n, d = 2) => (parseFloat(n) || 0).toLocaleString('es-PE',
  { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (n) => (parseFloat(n) || 0).toFixed(2) + ' %';
const num = (v) => parseFloat(v) || 0;

/* El código del dren del que cuelga una partida. Las hojas llevan su ruta
 * copiada del backend; el primer tramo es siempre el título de primer nivel. */
const drenDe = (p) => {
  try {
    const r = JSON.parse(p.ruta || '[]');
    return r.length ? r[0][0] : null;
  } catch { return null; }
};

export default function ReporteConvenio() {
  const [obras, setObras] = useState([]);
  const [obra, setObra] = useState('');
  const [filas, setFilas] = useState([]);
  /* Lo imputado, parte a parte, con su fecha. De aquí sale la cronología:
   * no se teclea en ningún sitio, se deduce de los partes que ya existen y
   * se va llenando sola conforme se registran. */
  const [movs, setMovs] = useState([]);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState('');
  const [editando, setEditando] = useState(null);   // {id, usuarios, area_ha}
  /* El id del proyecto, que la partida NO trae: su campo `proyecto` es el
   * nombre largo. Hace falta para la ruta de guardado, que va por proyecto. */
  const [proyectoId, setProyectoId] = useState(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`${API_OPS}/partidas/obras/`);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const lista = await r.json();
        setObras(Array.isArray(lista) ? lista : []);
        if (lista.length) setObra(lista[0].obra);
      } catch (e) {
        setError('No se pudo leer la lista de obras. ' + e.message);
      }
    })();
  }, []);

  const cargar = useCallback(async () => {
    if (!obra) return;
    setCargando(true); setError('');
    try {
      const r = await fetch(`${API_OPS}/partidas/?obra=${encodeURIComponent(obra)}`);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      const lista = Array.isArray(j) ? j : (j.partidas || []);
      setFilas(lista);

      /* Los partes traen la fecha; las partidas solo el total. Se piden
       * enteros y se agrupan aquí porque el backend no ofrece un corte por
       * mes, y añadir un endpoint para esto era otro despliegue. Son ~450 KB
       * hoy y crecen con cada parte: el día que pese, se mueve al servidor. */
      try {
        const pr = await (await fetch(`${API_OPS}/daily-part-heavy-equipments/`)).json();
        const partes = Array.isArray(pr) ? pr : (pr.results || []);
        const mias = new Set(lista.filter(x => !x.es_titulo).map(x => String(x.id)));
        const dePartida = {};
        lista.filter(x => !x.es_titulo).forEach(x => { dePartida[String(x.id)] = drenDe(x); });
        const out = [];
        partes.forEach(pt => (pt.actividades || []).forEach(a => {
          if (!mias.has(String(a.partida))) return;
          const f = String(pt.date || '').slice(0, 7);
          if (!f) return;   // sin fecha no hay mes al que llevarlo
          out.push({ mes: f, dren: dePartida[String(a.partida)] || '—',
                     unidad: (a.metrado_unidad || '').trim(), val: num(a.metrado) });
        }));
        setMovs(out);
      } catch { setMovs([]); }
      try {
        const pr = await (await fetch(`${API_OPS}/proyectos/`)).json();
        const mio = (Array.isArray(pr) ? pr : []).find(x => x.codigo === obra);
        setProyectoId(mio ? mio.id : null);
      } catch { setProyectoId(null); }
    } catch (e) {
      setFilas([]); setError('No se pudo cargar el presupuesto. ' + e.message);
    } finally { setCargando(false); }
  }, [obra]);

  useEffect(() => { cargar(); }, [cargar]);

  /* ── El reporte, armado del presupuesto ──────────────────────────────── */
  const datos = useMemo(() => {
    const drenes = filas
      .filter(p => p.es_titulo && !String(p.codigo).includes('.'))
      .sort((a, b) => String(a.codigo).localeCompare(String(b.codigo)));
    const hojas = filas.filter(p => !p.es_titulo && p.activo !== false);

    /* Una unidad, un bloque. Nunca una suma entre unidades. */
    const unidades = {};
    hojas.forEach(p => {
      const u = (p.unidad || '—').trim();
      unidades[u] = unidades[u] || { unidad: u, prog: 0, ejec: 0, porDren: {} };
      const d = drenDe(p) || '—';
      const g = unidades[u];
      g.porDren[d] = g.porDren[d] || { prog: 0, ejec: 0 };
      g.prog += num(p.metrado);  g.porDren[d].prog += num(p.metrado);
      g.ejec += num(p.ejecutado); g.porDren[d].ejec += num(p.ejecutado);
    });

    const bloques = Object.values(unidades)
      .map(b => ({ ...b, pct: b.prog ? b.ejec / b.prog * 100 : 0 }))
      // La magnitud principal primero: la que más volumen programado mueve.
      .sort((a, b) => b.prog - a.prog);

    /* La cronología, por unidad: meses × drenes. Los meses salen de lo que
     * hay, no de un calendario fijo: una obra que empezó en mayo no tiene por
     * qué enseñar enero en blanco. */
    const meses = [...new Set(movs.map(m => m.mes))].sort();
    bloques.forEach(b => {
      const celda = {};
      movs.filter(m => m.unidad === b.unidad).forEach(m => {
        celda[m.dren] = celda[m.dren] || {};
        celda[m.dren][m.mes] = (celda[m.dren][m.mes] || 0) + m.val;
      });
      const porMes = meses.map(x => movs
        .filter(m => m.unidad === b.unidad && m.mes === x)
        .reduce((s, m) => s + m.val, 0));
      let acum = 0;
      b.crono = { meses, celda, porMes, acumulado: porMes.map(v => (acum += v)) };
    });

    const usuarios = drenes.reduce((s, d) => s + num(d.usuarios), 0);
    const area = drenes.reduce((s, d) => s + num(d.area_ha), 0);
    /* `undefined` en todos los drenes significa que el servidor todavía no
     * tiene el campo; 0 significa que está y nadie lo ha llenado. Se dicen
     * distinto: lo primero se arregla aplicando un parche, lo segundo
     * escribiendo un número. */
    const soportaBenef = drenes.some(d => d.usuarios !== undefined);

    const proy = (obras.find(o => o.obra === obra) || {}).proyecto || '';
    return { drenes, bloques, usuarios, area, soportaBenef, proyecto: proy };
  }, [filas, movs, obras, obra]);

  /* ── Guardar los beneficiarios de un dren ───────────────────────────── */
  const guardarBenef = async () => {
    const { id, usuarios, area_ha } = editando;
    if (!proyectoId) { setError('No encuentro el proyecto de esta obra.'); return; }
    setGuardando(true); setError('');
    try {
      const r = await fetch(`${API_OPS}/proyectos/${proyectoId}/partidas/${id}/`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          usuarios: parseInt(usuarios, 10) || 0,
          area_ha: num(area_ha).toFixed(2),
        }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.detail || `El servidor respondió ${r.status}.`);
      }
      setEditando(null);
      await cargar();
    } catch (e) {
      setError('No se pudo guardar. ' + e.message);
    } finally { setGuardando(false); }
  };

  /* ── PDF ─────────────────────────────────────────────────────────────── */
  const exportarPDF = async () => {
    if (!datos.bloques.length) {
      Swal.fire({ icon: 'info', title: 'Nada que exportar',
        text: 'Esta obra no tiene partidas cargadas.' });
      return;
    }
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const W = doc.internal.pageSize.getWidth();

    doc.setFontSize(15); doc.setFont(undefined, 'bold');
    doc.text('REPORTE DE AVANCE', W / 2, 15, { align: 'center' });
    doc.setFontSize(11);
    doc.text(obra.toUpperCase(), W / 2, 22, { align: 'center' });
    doc.setFontSize(9); doc.setFont(undefined, 'normal');
    doc.text(datos.proyecto, W / 2, 28, { align: 'center', maxWidth: W - 30 });

    let y = 38;
    for (const b of datos.bloques) {
      doc.setFontSize(10); doc.setFont(undefined, 'bold');
      doc.text(`Avance en ${b.unidad}`, 14, y);
      doc.setFont(undefined, 'normal'); doc.setFontSize(9);
      doc.text(`Programado ${cant(b.prog)} · Ejecutado ${cant(b.ejec)} · ${pct(b.pct)}`,
        W - 14, y, { align: 'right' });
      y += 3;
      autoTable(doc, {
        startY: y,
        head: [['Código', 'Dren', `Programado (${b.unidad})`,
                `Ejecutado (${b.unidad})`, 'Saldo', 'Avance']],
        body: datos.drenes.map(d => {
          const v = b.porDren[d.codigo] || { prog: 0, ejec: 0 };
          return [d.codigo, d.descripcion, cant(v.prog), cant(v.ejec),
            cant(v.prog - v.ejec), pct(v.prog ? v.ejec / v.prog * 100 : 0)];
        }),
        foot: [['', 'TOTAL', cant(b.prog), cant(b.ejec),
          cant(b.prog - b.ejec), pct(b.pct)]],
        theme: 'grid',
        styles: { fontSize: 7.5, cellPadding: 1.4 },
        headStyles: { fillColor: [20, 99, 165] },
        footStyles: { fillColor: [241, 245, 249], textColor: 20, fontStyle: 'bold' },
        margin: { left: 14, right: 14 },
      });
      y = doc.lastAutoTable.finalY + 6;
      if (y > 150) { doc.addPage(); y = 18; }

      /* La cronología va detrás de su propia unidad, no toda junta al final:
       * el que lee quiere ver los metros y cuándo se hicieron sin pasar tres
       * páginas en medio. */
      const c = b.crono;
      if (c && c.meses.length) {
        const mes = (m) => {
          const [a2, mm] = m.split('-');
          return ['', 'Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Set','Oct','Nov','Dic'][+mm]
            + ' ' + a2.slice(2);
        };
        const conMov = datos.drenes.filter(d => c.celda[d.codigo]
          && Object.values(c.celda[d.codigo]).some(v => v > 0));
        autoTable(doc, {
          startY: y,
          head: [['Dren', ...c.meses.map(mes), 'Total']],
          body: conMov.map(d => {
            const f = c.celda[d.codigo] || {};
            const tot = c.meses.reduce((s, m) => s + (f[m] || 0), 0);
            return [d.descripcion, ...c.meses.map(m => (f[m] ? cant(f[m]) : '')), cant(tot)];
          }),
          foot: [['TOTAL', ...c.porMes.map(v => cant(v)), cant(b.ejec)]],
          theme: 'grid',
          styles: { fontSize: 7, cellPadding: 1.2 },
          headStyles: { fillColor: [100, 116, 139] },
          footStyles: { fillColor: [241, 245, 249], textColor: 20, fontStyle: 'bold' },
          margin: { left: 14, right: 14 },
        });
        y = doc.lastAutoTable.finalY + 8;
        if (y > 160) { doc.addPage(); y = 18; }
      }
    }

    if (datos.soportaBenef) {
      doc.setFontSize(10); doc.setFont(undefined, 'bold');
      doc.text('BENEFICIARIOS DIRECTOS', 14, y);
      doc.setFont(undefined, 'normal'); doc.setFontSize(9);
      doc.text(`${cant(datos.usuarios, 0)} usuarios · ${cant(datos.area)} ha`,
        W - 14, y, { align: 'right' });
    }

    doc.save(`reporte-avance-${obra}-${new Date().toISOString().slice(0, 10)}.pdf`);
  };

  const hay = datos.bloques.length > 0;

  return (
    <div className="tbl-page-wrapper">

      <div className="tbl-page-header" style={{ display:'flex', alignItems:'flex-end',
        justifyContent:'space-between', gap:'14px', flexWrap:'wrap' }}>
        <div>
          <div className="tbl-page-pretitle">Obra</div>
          <h2 className="tbl-page-title" style={{ display:'flex', alignItems:'center', gap:'9px' }}>
            <FaFileContract color="#1463A5" /> Reporte de avance
          </h2>
          <div style={{ fontSize:'12.5px', color:'#64748b', marginTop:'3px',
            maxWidth:'640px' }}>
            {datos.proyecto || 'Lo ejecutado contra lo programado, por dren y en sus propias unidades.'}
          </div>
        </div>
        <div style={{ display:'flex', gap:'9px', alignItems:'flex-end', flexWrap:'wrap' }}>
          <div>
            <label className="tbl-form-label">Obra</label>
            <select className="tbl-form-select" value={obra}
              onChange={e => setObra(e.target.value)} style={{ minWidth:'270px' }}>
              {obras.map(o => (
                <option key={o.obra} value={o.obra}>{o.obra} ({o.partidas})</option>
              ))}
            </select>
          </div>
          <button onClick={cargar} disabled={cargando} style={btnSec}>
            <FaSyncAlt size={11} className={cargando ? 'icon-spin' : ''} /> Actualizar
          </button>
          <button onClick={exportarPDF} disabled={!hay} style={btnPri}>
            <FaFilePdf size={11} /> PDF
          </button>
        </div>
      </div>

      <div className="tbl-page-body">

        {error && (
          <div style={avisoMal}>
            <FaExclamationTriangle style={{ marginTop:'2px', flexShrink:0 }} />
            <span>{error}</span>
          </div>
        )}

        {cargando && !filas.length && <div style={nota}>Consultando…</div>}

        {!cargando && !error && !hay && (
          <div style={nota}>
            Esta obra no tiene partidas cargadas. Impórtale el presupuesto desde
            Proyectos y aquí saldrá su avance.
          </div>
        )}

        {/* ── Un bloque por unidad ─────────────────────────────────────── */}
        {datos.bloques.map((b, i) => (
          <BloqueUnidad key={b.unidad} b={b} drenes={datos.drenes}
            principal={i === 0} />
        ))}

        {/* ── Beneficiarios ────────────────────────────────────────────── */}
        {hay && (
          <div style={caja}>
            <div style={{ display:'flex', justifyContent:'space-between',
              alignItems:'center', gap:'12px', flexWrap:'wrap', marginBottom:'12px' }}>
              <div style={{ fontSize:'14px', fontWeight:700, color:'#1e293b',
                display:'flex', alignItems:'center', gap:'8px' }}>
                <FaUsers color="#1463A5" /> Beneficiarios directos
              </div>
              {datos.soportaBenef && (
                <div style={{ display:'flex', gap:'26px', flexWrap:'wrap' }}>
                  <Cifra titulo="N° usuarios" valor={cant(datos.usuarios, 0)} />
                  <Cifra titulo="Área beneficiada (ha)" valor={cant(datos.area)} />
                </div>
              )}
            </div>

            {!datos.soportaBenef ? (
              <div style={avisoInfo}>
                <FaExclamationTriangle style={{ marginTop:'2px', flexShrink:0 }} />
                <span>
                  Este servidor todavía no guarda beneficiarios. Se habilita
                  aplicando <b>parche_beneficiarios.py</b>; después se escriben
                  aquí, dren por dren, y el total se suma solo.
                </span>
              </div>
            ) : (
              <div style={{ overflowX:'auto' }}>
                <table style={{ width:'100%', minWidth:'560px',
                  borderCollapse:'collapse', fontSize:'12.5px' }}>
                  <thead>
                    <tr style={cabecera}>
                      <th style={{ ...th, textAlign:'left' }}>Código</th>
                      <th style={{ ...th, textAlign:'left' }}>Dren</th>
                      <th style={th}>N° usuarios</th>
                      <th style={th}>Área (ha)</th>
                      <th style={{ ...th, textAlign:'right', width:'110px' }} />
                    </tr>
                  </thead>
                  <tbody>
                    {datos.drenes.map(d => {
                      const edita = editando && editando.id === d.id;
                      return (
                        <tr key={d.id} style={{ borderTop:'1px solid #f1f5f9' }}>
                          <td style={{ ...td, fontFamily:'monospace', fontSize:'11.5px',
                            color:'#64748b' }}>{d.codigo}</td>
                          <td style={{ ...td, color:'#1e293b', fontWeight:600 }}>
                            {d.descripcion}</td>
                          <td style={{ ...td, textAlign:'right' }}>
                            {edita ? (
                              <input type="number" min="0" step="1" className="tbl-form-control"
                                value={editando.usuarios}
                                onChange={e => setEditando({ ...editando, usuarios: e.target.value })}
                                style={{ width:'96px', textAlign:'right' }} />
                            ) : cant(d.usuarios, 0)}
                          </td>
                          <td style={{ ...td, textAlign:'right' }}>
                            {edita ? (
                              <input type="number" min="0" step="0.01" className="tbl-form-control"
                                value={editando.area_ha}
                                onChange={e => setEditando({ ...editando, area_ha: e.target.value })}
                                style={{ width:'110px', textAlign:'right' }} />
                            ) : cant(d.area_ha)}
                          </td>
                          <td style={{ ...td, textAlign:'right', whiteSpace:'nowrap' }}>
                            {edita ? (
                              <>
                                <button onClick={guardarBenef} disabled={guardando}
                                  style={{ ...btnIco, color:'#15803d' }}>
                                  <FaCheck size={12} /> {guardando ? '…' : 'Guardar'}
                                </button>
                                <button onClick={() => setEditando(null)} style={btnIco}>
                                  <FaTimes size={12} />
                                </button>
                              </>
                            ) : (
                              <button style={btnIco}
                                onClick={() => setEditando({
                                  id: d.id,
                                  usuarios: d.usuarios ?? 0, area_ha: d.area_ha ?? 0 })}>
                                <FaEdit size={12} /> Editar
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {hay && (
          <div style={{ fontSize:'11px', color:'#94a3b8', marginTop:'14px',
            lineHeight:1.6 }}>
            Este reporte no habla de dinero: lo ejecutado va en las unidades
            que mide el convenio. Lo valorizado está en <b>Avance de Obra</b>.
            Cada magnitud lleva su bloque y no se suman entre sí: los metros y
            los galones no se juntan en una cifra.
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Un bloque: una unidad, sus drenes, su medidor ──────────────────────── */
function BloqueUnidad({ b, drenes, principal }) {
  const conDato = drenes.filter(d => (b.porDren[d.codigo] || {}).prog > 0
                                  || (b.porDren[d.codigo] || {}).ejec > 0);
  const serie = conDato.length ? conDato : drenes;

  const opciones = {
    chart: { type: 'bar', toolbar: { show: false }, fontFamily: 'inherit',
             animations: { enabled: false } },
    plotOptions: { bar: { horizontal: true, barHeight: '72%', dataLabels: { position: 'top' } } },
    colors: ['#cbd5e1', '#16a34a'],
    dataLabels: {
      enabled: true,
      // Solo el ejecutado lleva etiqueta: con las dos, en veinte drenes, los
      // números se pisan y no se lee ninguno.
      enabledOnSeries: [1],
      formatter: (v) => (v > 0 ? cant(v, 0) : ''),
      offsetX: 26, style: { fontSize: '10px', colors: ['#334155'] },
    },
    xaxis: { categories: serie.map(d => d.descripcion),
             labels: { style: { fontSize: '10px' } } },
    yaxis: { labels: { style: { fontSize: '10.5px' }, maxWidth: 190 } },
    legend: { position: 'top', horizontalAlign: 'left', fontSize: '12px' },
    grid: { borderColor: '#f1f5f9' },
    tooltip: { y: { formatter: (v) => `${cant(v)} ${b.unidad}` } },
  };
  const v = (d, k) => +(((b.porDren[d.codigo] || {})[k]) || 0).toFixed(2);
  const series = [
    { name: 'Programado', data: serie.map(d => v(d, 'prog')) },
    { name: 'Ejecutado',  data: serie.map(d => v(d, 'ejec')) },
  ];

  const color = colorAvance(b.pct);
  const medidor = {
    chart: { type: 'radialBar', fontFamily: 'inherit', animations: { enabled: false } },
    plotOptions: { radialBar: {
      startAngle: -120, endAngle: 120, hollow: { size: '58%' },
      track: { background: '#f1f5f9' },
      dataLabels: {
        name: { show: true, fontSize: '11px', color: '#64748b', offsetY: 22 },
        value: { fontSize: '24px', fontWeight: 700, color, offsetY: -12,
                 formatter: () => pct(b.pct) },
      },
    } },
    colors: [color],
    labels: [`de ${cant(b.prog, 0)} ${b.unidad}`],
  };

  return (
    <div style={caja}>
      <div style={{ display:'flex', justifyContent:'space-between',
        alignItems:'center', gap:'12px', flexWrap:'wrap', marginBottom:'6px' }}>
        <div>
          <div style={{ fontSize:'14px', fontWeight:700, color:'#1e293b' }}>
            Avance físico en {b.unidad}
            {principal && (
              <span style={{ fontSize:'11px', fontWeight:600, color:'#1463A5',
                background:'#eff6ff', borderRadius:'10px', padding:'2px 9px',
                marginLeft:'8px' }}>magnitud principal</span>
            )}
          </div>
          <div style={{ fontSize:'11.5px', color:'#94a3b8', marginTop:'2px' }}>
            {conDato.length} de {drenes.length} drenes con esta unidad
          </div>
        </div>
        <div style={{ display:'flex', gap:'26px', flexWrap:'wrap' }}>
          <Cifra titulo={`Programado (${b.unidad})`} valor={cant(b.prog)} />
          <Cifra titulo={`Ejecutado (${b.unidad})`} valor={cant(b.ejec)} color="#16a34a" />
          <Cifra titulo="% de avance" valor={pct(b.pct)} color={color} />
        </div>
      </div>

      <div style={{ display:'flex', gap:'14px', flexWrap:'wrap',
        alignItems:'center' }}>
        <div style={{ flex:'1 1 460px', minWidth:'300px' }}>
          <ReactApexChart options={opciones} series={series} type="bar"
            height={Math.max(220, serie.length * 26 + 70)} />
        </div>
        <div style={{ flex:'0 0 230px' }}>
          <ReactApexChart options={medidor} series={[Math.min(100, b.pct)]}
            type="radialBar" height={230} />
        </div>
      </div>

      <Cronologia b={b} drenes={drenes} />
    </div>
  );
}

/* ── Cuándo se hizo cada cosa ────────────────────────────────────────────
 *
 * La matriz dren × mes y la curva acumulada, en la unidad del bloque. No se
 * escribe en ningún sitio: sale de la fecha de los partes y del metrado que
 * imputan, así que se va llenando sola y no puede desalinearse de lo que
 * dicen los totales de arriba.
 *
 * Solo salen los drenes con movimiento. Diecinueve filas en blanco para ver
 * las cuatro que tienen algo es el tipo de tabla que se deja de mirar. */
function Cronologia({ b, drenes }) {
  const { meses, celda, porMes, acumulado } = b.crono || {};
  if (!meses || !meses.length) {
    return (
      <div style={{ marginTop:'12px', fontSize:'11.5px', color:'#94a3b8',
        borderTop:'1px solid #f1f5f9', paddingTop:'10px' }}>
        Todavía no hay partes con metrado imputado en {b.unidad}, así que no
        hay cronología que mostrar. Aparecerá sola conforme se registren.
      </div>
    );
  }
  const conMov = drenes.filter(d => celda[d.codigo]
    && Object.values(celda[d.codigo]).some(v => v > 0));
  const etq = (m) => {
    const [a, mm] = m.split('-');
    return ['', 'Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Set','Oct','Nov','Dic'][+mm]
      + ' ' + a.slice(2);
  };

  const curva = {
    chart: { type:'line', toolbar:{ show:false }, fontFamily:'inherit',
             animations:{ enabled:false } },
    stroke: { curve:'straight', width:3 },
    markers: { size:4 },
    colors: ['#1463A5'],
    xaxis: { categories: meses.map(etq), labels:{ style:{ fontSize:'10.5px' } } },
    yaxis: { labels:{ formatter:(v)=>cant(v,0), style:{ fontSize:'10.5px' } } },
    grid: { borderColor:'#f1f5f9' },
    dataLabels: { enabled:false },
    tooltip: { y:{ formatter:(v)=>`${cant(v)} ${b.unidad} acumulados` } },
  };

  return (
    <div style={{ marginTop:'14px', borderTop:'1px solid #f1f5f9', paddingTop:'12px' }}>
      <div style={{ fontSize:'12.5px', fontWeight:700, color:'#334155',
        marginBottom:'8px' }}>
        Cronología en {b.unidad}
        <span style={{ fontWeight:400, color:'#94a3b8', fontSize:'11.5px' }}>
          {' '}· de la fecha de los partes, no se escribe aparte
        </span>
      </div>

      <div style={{ overflowX:'auto', marginBottom:'10px' }}>
        <table style={{ width:'100%', minWidth:`${260 + meses.length * 82}px`,
          borderCollapse:'collapse', fontSize:'12px' }}>
          <thead>
            <tr style={cabecera}>
              <th style={{ ...th, textAlign:'left' }}>Dren</th>
              {meses.map(m => <th key={m} style={th}>{etq(m)}</th>)}
              <th style={{ ...th, borderLeft:'2px solid #e2e8f0' }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {conMov.map(d => {
              const fila = celda[d.codigo] || {};
              const tot = meses.reduce((s, m) => s + (fila[m] || 0), 0);
              return (
                <tr key={d.id} style={{ borderTop:'1px solid #f1f5f9' }}>
                  <td style={{ ...td, color:'#1e293b', fontWeight:600 }}>
                    {d.descripcion}</td>
                  {meses.map(m => (
                    <td key={m} style={{ ...td, textAlign:'right',
                      color: fila[m] ? '#1e293b' : '#e2e8f0' }}>
                      {fila[m] ? cant(fila[m]) : '—'}
                    </td>
                  ))}
                  <td style={{ ...td, textAlign:'right', fontWeight:700,
                    color:'#1463A5', borderLeft:'2px solid #e2e8f0' }}>
                    {cant(tot)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr style={{ background:'#f8fafc', borderTop:'2px solid #e2e8f0',
              fontWeight:800, color:'#1e293b' }}>
              <td style={td}>TOTAL</td>
              {porMes.map((v, i) => (
                <td key={i} style={{ ...td, textAlign:'right' }}>{cant(v)}</td>
              ))}
              <td style={{ ...td, textAlign:'right', color:'#1463A5',
                borderLeft:'2px solid #e2e8f0' }}>{cant(b.ejec)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <ReactApexChart options={curva}
        series={[{ name:`Acumulado (${b.unidad})`, data: acumulado.map(v => +v.toFixed(2)) }]}
        type="line" height={210} />
    </div>
  );
}

const Cifra = ({ titulo, valor, color }) => (
  <div style={{ textAlign:'right' }}>
    <div style={{ fontSize:'10.5px', color:'#94a3b8', textTransform:'uppercase',
      letterSpacing:'.04em', fontWeight:700 }}>{titulo}</div>
    <div style={{ fontSize:'19px', fontWeight:800, color: color || '#1e293b' }}>
      {valor}
    </div>
  </div>
);

/* ── Estilos ────────────────────────────────────────────────────────────── */
const caja = { background:'#fff', border:'1px solid #e2e8f0', borderRadius:'10px',
  padding:'16px 18px', marginBottom:'14px' };
const btnBase = { display:'inline-flex', alignItems:'center', gap:'7px',
  borderRadius:'7px', padding:'9px 14px', fontSize:'12.5px', fontWeight:600,
  cursor:'pointer', fontFamily:'inherit' };
const btnSec = { ...btnBase, background:'#fff', color:'#475569', border:'1px solid #cbd5e1' };
const btnPri = { ...btnBase, background:'#1463A5', color:'#fff', border:'none' };
const btnIco = { background:'transparent', border:'none', cursor:'pointer',
  color:'#64748b', padding:'5px 7px', display:'inline-flex', alignItems:'center',
  gap:'4px', fontFamily:'inherit', fontSize:'12px', fontWeight:600 };
const cabecera = { background:'#f8fafc', color:'#64748b', fontSize:'11px',
  textTransform:'uppercase', letterSpacing:'.03em' };
const th = { padding:'9px 10px', fontWeight:700, textAlign:'right' };
const td = { padding:'8px 10px', verticalAlign:'middle' };
const nota = { background:'#fff', border:'1px solid #e2e8f0', borderRadius:'10px',
  padding:'30px', fontSize:'12.5px', color:'#64748b', textAlign:'center' };
const avisoMal = { background:'#fef2f2', border:'1px solid #fecaca', borderRadius:'9px',
  padding:'11px 14px', fontSize:'12.5px', color:'#b91c1c', marginBottom:'14px',
  display:'flex', gap:'9px', alignItems:'flex-start', lineHeight:1.6 };
const avisoInfo = { background:'#fffbeb', border:'1px solid #fde68a', borderRadius:'9px',
  padding:'11px 14px', fontSize:'12.5px', color:'#92400e',
  display:'flex', gap:'9px', alignItems:'flex-start', lineHeight:1.6 };
