// ─────────────────────────────────────────────────────────────────────────────
//  Página: Panel de Maquinaria
//  Muestra todas las máquinas del catálogo con su estado (disponible / en
//  incidente). Filtros por origen y estado. Al hacer clic en cualquier máquina
//  se muestra su historial completo de partes diarios (abiertos y cerrados).
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useEffect } from 'react';
import Swal from 'sweetalert2';
import {
  FaTruck, FaSyncAlt, FaCheckCircle, FaExclamationTriangle, FaTimes,
  FaDownload, FaFilePdf, FaMapMarkerAlt, FaTools, FaClock, FaHistory, FaCog, FaSearch, FaExternalLinkAlt,
} from 'react-icons/fa';
import MantenedorEquipos from './MantenedorEquipos';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import ExcelJS from 'exceljs';
import logo from './assets/jurp.png';

const API_OPS = 'https://gideonstudio.duckdns.org/api/v1/mobile/operations';

const fmtNum = (n) => (parseFloat(n) || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function Maquinaria({ irAIncidente }) {
  const [maquinas, setMaquinas] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [filtroOrigen, setFiltroOrigen] = useState('');   // '' | JURP | EXTERNA
  const [filtroEstado, setFiltroEstado] = useState('');   // '' | 0 | 1
  const [busqueda, setBusqueda] = useState('');
  const [pagina, setPagina] = useState(1);
  const PORPAGINA = 8;
  const [detalle, setDetalle] = useState(null);           // máquina seleccionada
  const [historial, setHistorial] = useState(null);       // { maquina, partes, totales }
  const [cargandoHist, setCargandoHist] = useState(false);
  const [pdfModal, setPdfModal] = useState(null);
  const [modalReporteFlota, setModalReporteFlota] = useState(false);
  const [generandoFlota, setGenerandoFlota] = useState(false);         // { url, nombre }
  const [mantenedorAbierto, setMantenedorAbierto] = useState(false);

  const cargar = async () => {
    setCargando(true);
    try {
      const params = new URLSearchParams();
      if (filtroOrigen) params.append('origen', filtroOrigen);
      if (filtroEstado === '0' || filtroEstado === '1') params.append('estado', filtroEstado);
      const r = await fetch(`${API_OPS}/maquinaria-estado/?${params.toString()}`);
      if (r.ok) {
        const d = await r.json();
        setMaquinas(d.maquinaria || []);
      }
    } catch (e) { console.error(e); } finally { setCargando(false); }
  };
  useEffect(() => { cargar(); }, [filtroOrigen, filtroEstado]);

  // Libera una máquina que quedó marcada como ocupada sin parte abierto.
  const liberarMaquina = async (m) => {
    const c = await Swal.fire({
      title: `Liberar ${m.codigo}`,
      html: 'Esta máquina figura como ocupada pero no tiene ningún parte abierto.'
            + '<br><br>¿Quieres devolverla a <b>Disponible</b>?',
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Sí, liberar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#16a34a',
    });
    if (!c.isConfirmed) return;
    try {
      const r = await fetch(`${API_OPS}/modelos/${m.id}/liberar/`, { method: 'POST' });
      if (r.ok) {
        cargar();
        Swal.fire({ icon: 'success', title: 'Máquina liberada', timer: 1400, showConfirmButton: false });
      } else {
        const e = await r.json().catch(() => ({}));
        Swal.fire('No se pudo', e.detail || 'Inténtalo de nuevo.', 'error');
      }
    } catch (e) {
      Swal.fire('Error', 'Sin conexión con el servidor.', 'error');
    }
  };

  // Pone / quita una máquina de mantenimiento (con observación).
  const toggleMantenimiento = async (m) => {
    const entrando = !m.en_mantenimiento;
    const { value: obs, isConfirmed } = await Swal.fire({
      title: entrando ? `Enviar a mantenimiento · ${m.codigo}` : `Marcar operativa · ${m.codigo}`,
      input: 'textarea',
      inputLabel: 'Observación (opcional)',
      inputPlaceholder: entrando
        ? 'Ej. Cambio de aceite, falla hidráulica...'
        : 'Ej. Mantenimiento completado, lista para operar',
      inputValue: entrando ? '' : (m.mantenimiento_obs || ''),
      showCancelButton: true,
      confirmButtonText: entrando ? 'Enviar a mantenimiento' : 'Marcar operativa',
      confirmButtonColor: entrando ? '#d97706' : '#16a34a',
    });
    if (!isConfirmed) return;
    try {
      const r = await fetch(`${API_OPS}/modelos/${m.id}/mantenimiento/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ en_mantenimiento: entrando, observacion: obs || '' }),
      });
      if (r.ok) {
        cargar();
        Swal.fire({
          icon: 'success',
          title: entrando ? 'En mantenimiento' : 'Operativa',
          timer: 1400, showConfirmButton: false,
        });
      } else {
        const e = await r.json().catch(() => ({}));
        Swal.fire('No se pudo', e.detail || 'Inténtalo de nuevo.', 'error');
      }
    } catch (e) {
      Swal.fire('Error', 'Sin conexión con el servidor.', 'error');
    }
  };

  // Abre el modal con el historial de partes de una máquina.
  const abrirDetalle = async (m) => {
    setDetalle(m);
    setHistorial(null);
    setCargandoHist(true);
    try {
      const r = await fetch(`${API_OPS}/modelos/${m.id}/partes/`);
      if (r.ok) {
        setHistorial(await r.json());
      } else {
        Swal.fire('Error', `No se pudo cargar el historial (código ${r.status}). ¿Agregaste el endpoint en el backend?`, 'error');
      }
    } catch (e) {
      Swal.fire('Error', 'Fallo de conexión al cargar el historial.', 'error');
    } finally { setCargandoHist(false); }
  };

  // Abre el PDF del parte en un modal (igual que en Reportes / parte diario).
  const abrirPdfParte = async (parteId, nombre) => {
    const url = `${API_OPS}/daily-part-heavy-equipments/${parteId}/pdf/`;
    setPdfModal({ url, nombre: nombre || `Parte ${parteId}` });
  };

  // Convierte una imagen a base64 (para el logo en los reportes).
  const imgToBase64 = (src) => new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width; canvas.height = img.height;
      canvas.getContext('2d').drawImage(img, 0, 0);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });

  // Unidad legible del metrado (m3 → m³).
  const uMet = (u) => ({ m: 'm', m2: 'm²', m3: 'm³', glb: 'glb' }[u] || u || 'm³');

  // ══════════════════════════════════════════════════════════════════════
  //  REPORTE DE FLOTA — todas las máquinas con sus partes en un archivo
  // ══════════════════════════════════════════════════════════════════════

  // Trae TODOS los partes de una vez y los agrupa por máquina.
  const recopilarFlota = async () => {
    const r = await fetch(`${API_OPS}/daily-part-heavy-equipments/`);
    const d = await r.json();
    const todos = Array.isArray(d) ? d : (d.results || []);

    // Índice de máquinas por placa/código para vincular cada parte.
    const porMaquina = {};
    maquinas.forEach(m => { porMaquina[m.id] = { maquina: m, partes: [], horas: 0, costo: 0, metrado: 0, combustible: 0 }; });

    const norm = (t) => (t || '').toString().trim().toUpperCase().replace(/[\s-]/g, '');
    todos.forEach(p => {
      const marca = norm(p.model_plate);
      const hit = maquinas.find(m => {
        const cod = norm(m.codigo), pla = norm(m.placa), mod = norm(m.modelo);
        return (pla && marca.includes(pla)) || (cod && marca.includes(cod)) || (mod && marca === mod);
      });
      if (!hit || !porMaquina[hit.id]) return;
      const hIni = parseFloat(p.start_horometer) || 0;
      const hFin = parseFloat(p.end_horometer) || 0;
      const horas = Math.max(0, hFin - hIni);
      const pu = parseFloat(p.unit_price) || 0;
      const g = porMaquina[hit.id];
      g.partes.push({
        parte: p.part_number || '—',
        fecha: p.date || '—',
        actividad: p.activities || '—',
        proveedor: p.provider || '—',
        operador: p.operator || '—',
        metrado: parseFloat(p.metrado) || 0,
        metradoUnidad: p.metrado_unidad || 'm3',
        horas, precio: pu, costo: horas * pu,
        combustible: parseFloat(p.fuel_gallons) || 0,
        cerrado: !!p.cerrado,
      });
      g.horas += horas; g.costo += horas * pu;
      g.metrado += parseFloat(p.metrado) || 0;
      g.combustible += parseFloat(p.fuel_gallons) || 0;
    });
    return porMaquina;
  };

  const estadoTxt = (m) => m.en_mantenimiento ? 'EN MANTENIMIENTO' : (m.disponible ? 'DISPONIBLE' : 'EN INCIDENTE');

  // ── Reporte de flota en PDF ────────────────────────────────────────────
  const reporteFlotaPDF = async () => {
    setGenerandoFlota(true);
    try {
      const datos = await recopilarFlota();
      const lista = maquinasFiltradas;
      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      const W = doc.internal.pageSize.getWidth();
      const logoB64 = await imgToBase64(logo).catch(() => null);

      doc.setFillColor(20, 99, 165);
      doc.rect(0, 0, W, 28, 'F');
      if (logoB64) { try { doc.addImage(logoB64, 'PNG', 10, 5, 19, 19); } catch (e) {} }
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(14); doc.setFont(undefined, 'bold');
      doc.text('JUNTA DE RIEGO PRESURIZADO', 34, 12);
      doc.setFontSize(11); doc.setFont(undefined, 'normal');
      doc.text('Reporte General de Maquinaria', 34, 19);
      doc.setFontSize(8);
      doc.text(`Generado: ${new Date().toLocaleString('es-PE')} · ${lista.length} máquina(s)`, 34, 24.5);

      const tot = lista.reduce((a, m) => {
        const g = datos[m.id] || { horas: 0, costo: 0, combustible: 0 };
        return { h: a.h + g.horas, c: a.c + g.costo, f: a.f + g.combustible, p: a.p + (g.partes?.length || 0) };
      }, { h: 0, c: 0, f: 0, p: 0 });

      autoTable(doc, {
        startY: 34,
        head: [['CÓDIGO', 'EQUIPO', 'MARCA', 'MODELO', 'PLACA', 'ORIGEN', 'ESTADO', 'PARTES', 'HORAS', 'COMBUST.', 'COSTO S/']],
        body: lista.map(m => {
          const g = datos[m.id] || { partes: [], horas: 0, costo: 0, combustible: 0 };
          return [m.codigo, m.equipo || '—', m.marca || '—', m.modelo || '—', m.placa || '—',
                  m.origen === 'JURP' ? 'JURP' : 'EXT', estadoTxt(m),
                  String(g.partes.length), g.horas.toFixed(2), g.combustible.toFixed(2), g.costo.toFixed(2)];
        }),
        foot: [['', '', '', '', '', '', 'TOTALES', String(tot.p), tot.h.toFixed(2), tot.f.toFixed(2), tot.c.toFixed(2)]],
        styles: { fontSize: 7.5, cellPadding: 2 },
        headStyles: { fillColor: [20, 99, 165], textColor: 255, fontSize: 7.5 },
        footStyles: { fillColor: [224, 242, 254], textColor: [20, 99, 165], fontStyle: 'bold', fontSize: 7.5 },
        columnStyles: { 7: { halign: 'right' }, 8: { halign: 'right' }, 9: { halign: 'right' }, 10: { halign: 'right' } },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        margin: { left: 10, right: 10 },
      });

      // Detalle: una sección por máquina que tenga partes
      lista.forEach(m => {
        const g = datos[m.id];
        if (!g || !g.partes.length) return;
        doc.addPage();
        doc.setFillColor(20, 99, 165);
        doc.rect(0, 0, W, 20, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(11); doc.setFont(undefined, 'bold');
        doc.text(`${m.codigo} · ${m.equipo || ''}`, 10, 9);
        doc.setFontSize(8); doc.setFont(undefined, 'normal');
        doc.text(`${m.marca || '—'} ${m.modelo || ''}  |  Placa: ${m.placa || '—'}  |  ${m.origen === 'JURP' ? 'JURP (propia)' : 'Externa'}  |  ${estadoTxt(m)}`, 10, 15.5);

        autoTable(doc, {
          startY: 26,
          head: [['N° PARTE', 'FECHA', 'ESTADO', 'ACTIVIDAD', 'PROVEEDOR', 'VOLUMEN', 'HORAS', 'COMBUST.', 'TOTAL S/']],
          body: g.partes.map(x => ([
            x.parte, x.fecha, x.cerrado ? 'CERRADO' : 'ABIERTO', x.actividad, x.proveedor,
            `${x.metrado.toFixed(2)} ${uMet(x.metradoUnidad)}`,
            x.horas.toFixed(2), x.combustible.toFixed(2), x.costo.toFixed(2),
          ])),
          foot: [['', '', '', '', 'TOTALES', `${g.metrado.toFixed(2)}`, g.horas.toFixed(2), g.combustible.toFixed(2), g.costo.toFixed(2)]],
          styles: { fontSize: 7.5, cellPadding: 1.8 },
          headStyles: { fillColor: [100, 116, 139], textColor: 255, fontSize: 7.5 },
          footStyles: { fillColor: [241, 245, 249], textColor: [30, 41, 59], fontStyle: 'bold', fontSize: 7.5 },
          columnStyles: { 5: { halign: 'right' }, 6: { halign: 'right' }, 7: { halign: 'right' }, 8: { halign: 'right' } },
          alternateRowStyles: { fillColor: [248, 250, 252] },
          margin: { left: 10, right: 10 },
        });
      });

      const paginas = doc.internal.getNumberOfPages();
      for (let i = 1; i <= paginas; i++) {
        doc.setPage(i);
        doc.setTextColor(148, 163, 184);
        doc.setFontSize(7.5); doc.setFont(undefined, 'normal');
        doc.text(`Página ${i} de ${paginas}`, W - 10, doc.internal.pageSize.getHeight() - 6, { align: 'right' });
      }

      doc.save(`Reporte_Maquinaria_${new Date().toISOString().slice(0, 10)}.pdf`);
      setModalReporteFlota(false);
    } catch (e) {
      console.error(e);
      Swal.fire('Error', 'No se pudo generar el reporte.', 'error');
    } finally {
      setGenerandoFlota(false);
    }
  };

  // ── Reporte de flota en Excel ──────────────────────────────────────────
  const reporteFlotaExcel = async () => {
    setGenerandoFlota(true);
    try {
      const datos = await recopilarFlota();
      const lista = maquinasFiltradas;
      const wb = new ExcelJS.Workbook();
      const azul = { type: 'pattern', pattern: 'solid', fgColor: { argb: '1463A5' } };
      const azulClaro = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'E0F2FE' } };
      const gris = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F1F5F9' } };
      const borde = { top:{style:'thin',color:{argb:'E2E8F0'}}, bottom:{style:'thin',color:{argb:'E2E8F0'}}, left:{style:'thin',color:{argb:'E2E8F0'}}, right:{style:'thin',color:{argb:'E2E8F0'}} };

      // ══ HOJA 1: RESUMEN DE FLOTA ══
      const ws = wb.addWorksheet('Flota');
      ws.columns = [{ width: 14 }, { width: 30 }, { width: 18 }, { width: 16 }, { width: 14 },
                    { width: 10 }, { width: 19 }, { width: 10 }, { width: 12 }, { width: 13 }, { width: 15 }];
      for (let r = 1; r <= 3; r++) for (let c = 1; c <= 11; c++) ws.getCell(r, c).fill = azul;
      ws.getRow(1).height = 28; ws.getRow(2).height = 20; ws.getRow(3).height = 18;
      try {
        const logoB64 = await imgToBase64(logo);
        if (logoB64) {
          const imgId = wb.addImage({ base64: logoB64.split(',')[1], extension: 'png' });
          ws.addImage(imgId, { tl: { col: 0, row: 0 }, ext: { width: 75, height: 65 } });
        }
      } catch (e) {}
      ws.mergeCells('B1:K1');
      ws.getCell('B1').value = 'JUNTA DE RIEGO PRESURIZADO';
      ws.getCell('B1').font = { bold: true, color: { argb: 'FFFFFF' }, size: 12 };
      ws.getCell('B1').alignment = { vertical: 'middle' };
      ws.mergeCells('B2:K2');
      ws.getCell('B2').value = 'Reporte General de Maquinaria';
      ws.getCell('B2').font = { bold: true, color: { argb: 'FFFFFF' }, size: 10 };
      ws.getCell('B2').alignment = { vertical: 'middle' };
      ws.mergeCells('B3:K3');
      ws.getCell('B3').value = `Generado: ${new Date().toLocaleString('es-PE')} · ${lista.length} máquina(s)`;
      ws.getCell('B3').font = { italic: true, size: 9, color: { argb: 'D0D5DD' } };
      ws.getCell('B3').alignment = { vertical: 'middle' };
      ws.getRow(4).height = 6;

      const cab = ['CÓDIGO', 'EQUIPO', 'MARCA', 'MODELO', 'PLACA', 'ORIGEN', 'ESTADO', 'PARTES', 'HORAS', 'COMBUST.', 'COSTO S/'];
      cab.forEach((h, i) => {
        const c = ws.getCell(5, i + 1);
        c.value = h; c.fill = azul; c.border = borde;
        c.font = { bold: true, color: { argb: 'FFFFFF' }, size: 9 };
        c.alignment = { horizontal: 'center', vertical: 'middle' };
      });
      ws.getRow(5).height = 20;

      lista.forEach((m, i) => {
        const g = datos[m.id] || { partes: [], horas: 0, costo: 0, combustible: 0 };
        const r = 6 + i;
        const fila = [m.codigo, m.equipo || '—', m.marca || '—', m.modelo || '—', m.placa || '—',
                      m.origen === 'JURP' ? 'JURP' : 'EXT', estadoTxt(m),
                      g.partes.length, g.horas, g.combustible, g.costo];
        fila.forEach((v, ci) => {
          const c = ws.getCell(r, ci + 1);
          c.value = v; c.border = borde; c.font = { size: 9 };
          if (ci >= 7) { c.alignment = { horizontal: 'right' }; if (ci > 7) c.numFmt = '#,##0.00'; }
        });
      });

      const rTot = 6 + lista.length;
      ws.mergeCells(`A${rTot}:G${rTot}`);
      ws.getCell(`A${rTot}`).value = 'TOTALES';
      ws.getCell(`A${rTot}`).font = { bold: true, size: 10, color: { argb: '1463A5' } };
      ws.getCell(`A${rTot}`).alignment = { horizontal: 'right' };
      ws.getCell(`A${rTot}`).fill = azulClaro;
      const sum = (f) => lista.reduce((a, m) => a + (datos[m.id] ? f(datos[m.id]) : 0), 0);
      [[8, sum(g => g.partes.length)], [9, sum(g => g.horas)], [10, sum(g => g.combustible)], [11, sum(g => g.costo)]]
        .forEach(([col, val]) => {
          const c = ws.getCell(rTot, col);
          c.value = val; c.fill = azulClaro; c.border = borde;
          c.font = { bold: true, size: 10, color: { argb: '1463A5' } };
          c.alignment = { horizontal: 'right' };
          if (col > 8) c.numFmt = '#,##0.00';
        });

      // ══ HOJA 2: DETALLE DE PARTES ══
      const wd = wb.addWorksheet('Partes');
      wd.columns = [{ width: 22 }, { width: 13 }, { width: 11 }, { width: 28 }, { width: 20 },
                    { width: 15 }, { width: 11 }, { width: 12 }, { width: 14 }];
      let f = 1;
      lista.forEach(m => {
        const g = datos[m.id];
        if (!g || !g.partes.length) return;
        wd.mergeCells(`A${f}:I${f}`);
        const t = wd.getCell(`A${f}`);
        t.value = `${m.codigo} · ${m.equipo || ''} · ${m.marca || ''} ${m.modelo || ''}  |  Placa: ${m.placa || '—'}  |  ${estadoTxt(m)}`;
        t.fill = azul; t.font = { bold: true, color: { argb: 'FFFFFF' }, size: 10 };
        wd.getRow(f).height = 20;
        f += 1;

        const ch = ['N° PARTE', 'FECHA', 'ESTADO', 'ACTIVIDAD', 'PROVEEDOR', 'VOLUMEN', 'HORAS', 'COMBUST.', 'TOTAL S/'];
        ch.forEach((h, i) => {
          const c = wd.getCell(f, i + 1);
          c.value = h; c.fill = gris; c.border = borde;
          c.font = { bold: true, size: 8.5, color: { argb: '475569' } };
          c.alignment = { horizontal: 'center' };
        });
        f += 1;

        g.partes.forEach(x => {
          const fila = [x.parte, x.fecha, x.cerrado ? 'CERRADO' : 'ABIERTO', x.actividad, x.proveedor,
                        `${x.metrado.toFixed(2)} ${uMet(x.metradoUnidad)}`, x.horas, x.combustible, x.costo];
          fila.forEach((v, ci) => {
            const c = wd.getCell(f, ci + 1);
            c.value = v; c.border = borde; c.font = { size: 9 };
            if (ci >= 5) c.alignment = { horizontal: 'right' };
            if (ci >= 6) c.numFmt = '#,##0.00';
          });
          f += 1;
        });

        wd.getCell(f, 5).value = 'TOTALES';
        wd.getCell(f, 5).font = { bold: true, size: 9 };
        wd.getCell(f, 5).alignment = { horizontal: 'right' };
        [[6, `${g.metrado.toFixed(2)}`], [7, g.horas], [8, g.combustible], [9, g.costo]].forEach(([col, val]) => {
          const c = wd.getCell(f, col);
          c.value = val; c.fill = azulClaro; c.border = borde;
          c.font = { bold: true, size: 9, color: { argb: '1463A5' } };
          c.alignment = { horizontal: 'right' };
          if (col >= 7) c.numFmt = '#,##0.00';
        });
        f += 3;
      });

      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Reporte_Maquinaria_${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      setModalReporteFlota(false);
    } catch (e) {
      console.error(e);
      Swal.fire('Error', 'No se pudo generar el reporte.', 'error');
    } finally {
      setGenerandoFlota(false);
    }
  };

  // ── Exportar el historial de partes a Excel ─────────────────────────────
  const exportarHistorialExcel = async () => {
    if (!historial || !detalle) return;
    const maq = detalle;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Historial de Partes');
    ws.columns = [{ width: 20 }, { width: 12 }, { width: 11 }, { width: 26 }, { width: 14 },
                  { width: 11 }, { width: 12 }, { width: 22 }, { width: 16 }, { width: 14 }];
    const azul = { type: 'pattern', pattern: 'solid', fgColor: { argb: '1463A5' } };
    const grisClaro = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F1F5F9' } };
    const borde = { top:{style:'thin',color:{argb:'E2E8F0'}}, bottom:{style:'thin',color:{argb:'E2E8F0'}}, left:{style:'thin',color:{argb:'E2E8F0'}}, right:{style:'thin',color:{argb:'E2E8F0'}} };

    for (let r = 1; r <= 3; r++) for (let c = 1; c <= 10; c++) ws.getCell(r, c).fill = azul;
    ws.getRow(1).height = 28; ws.getRow(2).height = 20; ws.getRow(3).height = 18;
    try {
      const logoB64 = await imgToBase64(logo);
      if (logoB64) {
        const imgId = wb.addImage({ base64: logoB64.split(',')[1], extension: 'png' });
        ws.addImage(imgId, { tl: { col: 0, row: 0 }, ext: { width: 75, height: 65 } });
      }
    } catch (e) {}
    ws.mergeCells('C1:J1');
    ws.getCell('C1').value = 'JUNTA DE RIEGO PRESURIZADO';
    ws.getCell('C1').font = { bold: true, color: { argb: 'FFFFFF' }, size: 12 };
    ws.getCell('C1').alignment = { vertical: 'middle' };
    ws.mergeCells('C2:J2');
    ws.getCell('C2').value = `Historial de Partes Diarios · ${maq.codigo}`;
    ws.getCell('C2').font = { bold: true, color: { argb: 'FFFFFF' }, size: 10 };
    ws.getCell('C2').alignment = { vertical: 'middle' };
    ws.mergeCells('C3:J3');
    ws.getCell('C3').value = `Generado: ${new Date().toLocaleString('es-PE')}`;
    ws.getCell('C3').font = { italic: true, size: 9, color: { argb: 'D0D5DD' } };
    ws.getCell('C3').alignment = { vertical: 'middle' };
    ws.getRow(4).height = 6;

    // Datos de la máquina
    const datos = [
      ['Código', maq.codigo], ['Equipo', `${maq.equipo} · ${maq.marca}`],
      ['Modelo', maq.modelo || '—'], ['Placa', maq.placa || '—'],
      ['Origen', maq.origen === 'JURP' ? 'JURP (propia)' : 'Externa'],
    ];
    datos.forEach(([k, v], i) => {
      const r = 5 + i;
      ws.getCell(`A${r}`).value = k;
      ws.getCell(`A${r}`).font = { bold: true, size: 9, color: { argb: '64748B' } };
      ws.getCell(`A${r}`).fill = grisClaro;
      ws.mergeCells(`B${r}:J${r}`);
      ws.getCell(`B${r}`).value = v;
      ws.getCell(`B${r}`).font = { size: 10 };
    });

    const hRow = 5 + datos.length + 1;
    const cabeceras = ['N° PARTE', 'FECHA', 'ESTADO', 'ACTIVIDAD', 'VOLUMEN',
                       'HORAS', 'COMBUST.', 'PROVEEDOR', 'N° INCIDENCIA', 'TOTAL S/'];
    cabeceras.forEach((h, i) => {
      const c = ws.getCell(hRow, i + 1);
      c.value = h; c.fill = azul; c.border = borde;
      c.font = { bold: true, color: { argb: 'FFFFFF' }, size: 9 };
      c.alignment = { horizontal: 'center', vertical: 'middle' };
    });
    ws.getRow(hRow).height = 20;

    historial.partes.forEach((p, i) => {
      const r = hRow + 1 + i;
      const fila = [
        p.part_number,
        p.date || '—',
        p.cerrado ? 'CERRADO' : 'ABIERTO',
        p.activities || '—',
        `${(parseFloat(p.metrado) || 0).toFixed(2)} ${uMet(p.metrado_unidad)}`,
        parseFloat(p.horas) || 0,
        parseFloat(p.fuel_gallons) || 0,
        p.provider || '—',
        p.incidente_codigo || (p.incidente_id ? `#${p.incidente_id}` : '—'),
        parseFloat(p.costo) || 0,
      ];
      fila.forEach((v, ci) => {
        const c = ws.getCell(r, ci + 1);
        c.value = v; c.border = borde; c.font = { size: 9 };
        if (ci >= 5 && ci !== 7 && ci !== 8) c.alignment = { horizontal: 'right' };
        if (ci === 9) c.numFmt = '#,##0.00';
        if (ci === 5 || ci === 6) c.numFmt = '#,##0.00';
      });
    });

    // Totales
    const tRow = hRow + 1 + historial.partes.length;
    ws.getCell(tRow, 1).value = `TOTAL · ${historial.total_partes} parte(s)`;
    ws.getCell(tRow, 1).font = { bold: true, size: 10 };
    ws.getCell(tRow, 6).value = parseFloat(historial.total_horas) || 0;
    ws.getCell(tRow, 7).value = historial.partes.reduce((a, p) => a + (parseFloat(p.fuel_gallons) || 0), 0);
    ws.getCell(tRow, 10).value = parseFloat(historial.total_costo) || 0;
    [6, 7, 10].forEach(ci => {
      const c = ws.getCell(tRow, ci);
      c.font = { bold: true, size: 10 }; c.numFmt = '#,##0.00';
      c.alignment = { horizontal: 'right' };
    });
    for (let c = 1; c <= 10; c++) { ws.getCell(tRow, c).fill = grisClaro; ws.getCell(tRow, c).border = borde; }

    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Historial_${maq.codigo}_${new Date().toISOString().slice(0, 10)}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Exportar el historial de partes a PDF ───────────────────────────────
  const exportarHistorialPDF = async () => {
    if (!historial || !detalle) return;
    const maq = detalle;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const W = doc.internal.pageSize.getWidth();

    doc.setFillColor(20, 99, 165);
    doc.rect(0, 0, W, 26, 'F');
    try {
      const logoB64 = await imgToBase64(logo);
      if (logoB64) doc.addImage(logoB64, 'PNG', 10, 4, 18, 18);
    } catch (e) {}
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(13); doc.setFont(undefined, 'bold');
    doc.text('JUNTA DE RIEGO PRESURIZADO', 32, 11);
    doc.setFontSize(10); doc.setFont(undefined, 'normal');
    doc.text(`Historial de Partes Diarios · ${maq.codigo}`, 32, 17);
    doc.setFontSize(8);
    doc.text(`Generado: ${new Date().toLocaleString('es-PE')}`, 32, 22);

    doc.setTextColor(60, 60, 60);
    doc.setFontSize(9);
    const infoY = 33;
    doc.text(`Equipo: ${maq.equipo} · ${maq.marca}`, 10, infoY);
    doc.text(`Modelo: ${maq.modelo || '—'}`, 10, infoY + 5);
    doc.text(`Placa: ${maq.placa || '—'}`, 110, infoY);
    doc.text(`Origen: ${maq.origen === 'JURP' ? 'JURP (propia)' : 'Externa'}`, 110, infoY + 5);

    const cuerpo = historial.partes.map(p => ([
      p.part_number,
      p.date || '—',
      p.cerrado ? 'CERRADO' : 'ABIERTO',
      p.activities || '—',
      `${(parseFloat(p.metrado) || 0).toFixed(2)} ${uMet(p.metrado_unidad)}`,
      `${(parseFloat(p.horas) || 0).toFixed(2)} HE`,
      `${(parseFloat(p.fuel_gallons) || 0).toFixed(2)} Gls`,
      p.provider || '—',
      p.incidente_codigo || (p.incidente_id ? `#${p.incidente_id}` : '—'),
      `S/ ${(parseFloat(p.costo) || 0).toFixed(2)}`,
    ]));

    autoTable(doc, {
      startY: infoY + 11,
      head: [['N° PARTE', 'FECHA', 'ESTADO', 'ACTIVIDAD', 'VOLUMEN', 'HORAS', 'COMBUST.', 'PROVEEDOR', 'N° INCIDENCIA', 'TOTAL']],
      body: cuerpo,
      foot: [[
        `TOTAL · ${historial.total_partes} parte(s)`, '', '', '', '',
        `${(parseFloat(historial.total_horas) || 0).toFixed(2)} HE`,
        `${historial.partes.reduce((a, p) => a + (parseFloat(p.fuel_gallons) || 0), 0).toFixed(2)} Gls`,
        '', '',
        `S/ ${(parseFloat(historial.total_costo) || 0).toFixed(2)}`,
      ]],
      styles: { fontSize: 7.5, cellPadding: 2 },
      headStyles: { fillColor: [20, 99, 165], textColor: 255, fontSize: 7.5, halign: 'center' },
      footStyles: { fillColor: [241, 245, 249], textColor: [30, 41, 59], fontStyle: 'bold', fontSize: 7.5 },
      columnStyles: {
        4: { halign: 'right' }, 5: { halign: 'right' },
        6: { halign: 'right' }, 9: { halign: 'right' },
      },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      margin: { left: 10, right: 10 },
    });

    doc.save(`Historial_${maq.codigo}_${new Date().toISOString().slice(0, 10)}.pdf`);
  };

  // Filtra por texto de búsqueda (código, equipo, marca, modelo, placa).
  const maquinasFiltradas = maquinas.filter(m => {
    // Filtro "solo en mantenimiento" se resuelve aquí (no viaja al backend).
    if (filtroEstado === 'mant' && !m.en_mantenimiento) return false;
    if (!busqueda.trim()) return true;
    const q = busqueda.toLowerCase().trim();
    const texto = `${m.codigo} ${m.equipo} ${m.marca} ${m.modelo} ${m.placa || ''}`.toLowerCase();
    return texto.includes(q);
  });

  // Paginación de 8 en 8 sobre la lista filtrada.
  const totalPaginas = Math.max(1, Math.ceil(maquinasFiltradas.length / PORPAGINA));
  const paginaSegura = Math.min(pagina, totalPaginas);
  const inicio = (paginaSegura - 1) * PORPAGINA;
  const maquinasPagina = maquinasFiltradas.slice(inicio, inicio + PORPAGINA);
  // Al buscar o filtrar, vuelve a la primera página.
  useEffect(() => { setPagina(1); }, [busqueda, filtroOrigen, filtroEstado]);

  const disponibles = maquinas.filter(m => m.disponible).length;
  const enMantenimiento = maquinas.filter(m => m.en_mantenimiento).length;
  const ocupadas = maquinas.filter(m => !m.disponible && !m.en_mantenimiento).length;

  return (
    <div style={{ height: '100%', overflowY: 'auto', overflowX: 'hidden' }}>
    <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto' }}>
      {/* Encabezado */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <div style={{ fontSize: '12px', color: '#94a3b8', fontWeight: 600, letterSpacing: '0.5px' }}>GESTIÓN DE FLOTA</div>
          <h2 style={{ margin: '2px 0 0', fontSize: '24px', color: '#1e293b' }}>Panel de Maquinaria</h2>
        </div>
        <div style={{ display:'flex', gap:'8px', flexWrap:'wrap' }}>
          <button onClick={() => setMantenedorAbierto(true)} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: '#206bc4', border: 'none', borderRadius: '8px', padding: '8px 16px', cursor: 'pointer', fontSize: '13px', fontWeight: 600, color: '#fff' }}>
            <FaCog /> Gestionar catálogo
          </button>
          <button onClick={() => setModalReporteFlota(true)} disabled={cargando || maquinas.length === 0}
            style={{ display: 'flex', alignItems: 'center', gap: '6px', background: '#0ea5e9', border: 'none', borderRadius: '8px', padding: '8px 16px', cursor: 'pointer', fontSize: '13px', fontWeight: 600, color: '#fff', opacity: (cargando || maquinas.length === 0) ? 0.5 : 1 }}
            title="Reporte de toda la flota">
            <FaDownload /> Reporte
          </button>
          <button onClick={cargar} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: '#fff', border: '1px solid #cbd5e1', borderRadius: '8px', padding: '8px 16px', cursor: 'pointer', fontSize: '13px', fontWeight: 600, color: '#334155' }}>
            <FaSyncAlt /> Actualizar
          </button>
        </div>
      </div>

      {/* Tarjetas de resumen */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px', marginBottom: '20px' }}>
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderLeft: '4px solid #206bc4', borderRadius: '8px', padding: '14px 18px' }}>
          <div style={{ fontSize: '12px', color: '#64748b', fontWeight: 600 }}>TOTAL MÁQUINAS</div>
          <div style={{ fontSize: '28px', fontWeight: 700, color: '#1e293b' }}>{maquinas.length}</div>
        </div>
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderLeft: '4px solid #16a34a', borderRadius: '8px', padding: '14px 18px' }}>
          <div style={{ fontSize: '12px', color: '#64748b', fontWeight: 600 }}>DISPONIBLES</div>
          <div style={{ fontSize: '28px', fontWeight: 700, color: '#16a34a' }}>{disponibles}</div>
        </div>
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderLeft: '4px solid #dc2626', borderRadius: '8px', padding: '14px 18px' }}>
          <div style={{ fontSize: '12px', color: '#64748b', fontWeight: 600 }}>EN INCIDENTE</div>
          <div style={{ fontSize: '28px', fontWeight: 700, color: '#dc2626' }}>{ocupadas}</div>
        </div>
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderLeft: '4px solid #f59e0b', borderRadius: '8px', padding: '14px 18px' }}>
          <div style={{ fontSize: '12px', color: '#64748b', fontWeight: 600 }}>EN MANTENIMIENTO</div>
          <div style={{ fontSize: '28px', fontWeight: 700, color: '#d97706' }}>{enMantenimiento}</div>
        </div>
      </div>

      {/* Filtros */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '18px', flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: '13px', color: '#64748b', fontWeight: 600 }}>Filtrar:</span>
        <select value={filtroOrigen} onChange={e => setFiltroOrigen(e.target.value)} style={selStyle}>
          <option value="">Todos los orígenes</option>
          <option value="JURP">JURP (propia)</option>
          <option value="EXTERNA">Externa</option>
        </select>
        <select value={filtroEstado} onChange={e => setFiltroEstado(e.target.value)} style={selStyle}>
          <option value="">Todos los estados</option>
          <option value="0">Solo disponibles</option>
          <option value="1">Solo en incidente</option>
          <option value="mant">Solo en mantenimiento</option>
        </select>
        <div style={{ position:'relative', flex:'1', minWidth:'200px', maxWidth:'360px' }}>
          <FaSearch size={12} style={{ position:'absolute', left:'12px', top:'50%', transform:'translateY(-50%)', color:'#94a3b8' }} />
          <input type="text" placeholder="Buscar código, equipo, modelo, placa..." value={busqueda} onChange={e => setBusqueda(e.target.value)}
            style={{ width:'100%', padding:'8px 12px 8px 34px', border:'1px solid #cbd5e1', borderRadius:'8px', fontSize:'13px', color:'#334155', boxSizing:'border-box' }} />
          {busqueda && (
            <button onClick={() => setBusqueda('')} title="Limpiar" style={{ position:'absolute', right:'8px', top:'50%', transform:'translateY(-50%)', background:'none', border:'none', cursor:'pointer', color:'#94a3b8', display:'flex', padding:'2px' }}><FaTimes size={12} /></button>
          )}
        </div>
        {busqueda && <span style={{ fontSize:'12px', color:'#64748b', fontWeight:600, whiteSpace:'nowrap' }}>{maquinasFiltradas.length} de {maquinas.length}</span>}
      </div>

      {/* Grid de tarjetas */}
      {cargando ? (
        <div style={{ textAlign: 'center', padding: '60px', color: '#94a3b8' }}>
          <FaSyncAlt className="spin-anim" style={{ fontSize: '32px' }} />
          <p>Cargando maquinaria…</p>
        </div>
      ) : maquinas.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px', color: '#94a3b8' }}>
          <FaTruck style={{ fontSize: '40px', opacity: 0.4 }} />
          <p>No hay máquinas que coincidan con el filtro.</p>
        </div>
      ) : maquinasFiltradas.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px', color: '#94a3b8' }}>
          <FaSearch style={{ fontSize: '36px', opacity: 0.4 }} />
          <p>Ninguna máquina coincide con "{busqueda}".</p>
          <button onClick={() => setBusqueda('')} style={{ marginTop:'8px', background:'#206bc4', color:'#fff', border:'none', borderRadius:'8px', padding:'8px 16px', fontSize:'13px', fontWeight:600, cursor:'pointer' }}>Limpiar búsqueda</button>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '14px' }}>
          {maquinasPagina.map(m => {
            const enMant = !!m.en_mantenimiento;
            const ocupada = !m.disponible && !enMant;
            // Color de borde/banda según los 3 estados posibles.
            const cBorde = enMant ? '#fed7aa' : (ocupada ? '#fecaca' : '#bbf7d0');
            const cBandaBg = enMant ? '#fff7ed' : (ocupada ? '#fef2f2' : '#f0fdf4');
            const cTexto = enMant ? '#d97706' : (ocupada ? '#dc2626' : '#16a34a');
            const etiqueta = enMant ? 'EN MANTENIMIENTO' : (ocupada ? 'EN INCIDENTE' : 'DISPONIBLE');
            return (
              <div key={m.id}
                onClick={() => abrirDetalle(m)}
                style={{
                  background: '#fff', borderRadius: '10px', overflow: 'hidden',
                  border: `1px solid ${cBorde}`,
                  cursor: 'pointer',
                  transition: 'box-shadow 0.15s',
                }}
                onMouseEnter={e => e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)'}
                onMouseLeave={e => e.currentTarget.style.boxShadow = 'none'}
              >
                {/* Banda de estado */}
                <div style={{ background: cBandaBg, padding: '8px 14px', display: 'flex', alignItems: 'center', gap: '6px', borderBottom: `1px solid ${cBorde}` }}>
                  {enMant ? <FaTools color="#d97706" size={13} /> : (ocupada ? <FaExclamationTriangle color="#dc2626" size={13} /> : <FaCheckCircle color="#16a34a" size={13} />)}
                  <span style={{ fontSize: '12px', fontWeight: 700, color: cTexto }}>
                    {etiqueta}
                  </span>
                  <span style={{ marginLeft: 'auto', fontSize: '11px', fontWeight: 700, color: '#fff', background: m.origen === 'JURP' ? '#206bc4' : '#d6832b', padding: '2px 8px', borderRadius: '4px' }}>
                    {m.origen === 'JURP' ? 'JURP' : 'EXT'}
                  </span>
                </div>

                {/* Cuerpo */}
                <div style={{ padding: '14px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                    <FaTruck color="#475569" />
                    <span style={{ fontWeight: 700, fontSize: '15px', color: '#1e293b' }}>{m.codigo}</span>
                  </div>
                  <div style={{ fontSize: '13px', color: '#475569' }}>{m.equipo} · {m.marca}</div>
                  <div style={{ fontSize: '13px', color: '#64748b', marginTop: '2px' }}>
                    {m.modelo && <span>Modelo: <b>{m.modelo}</b></span>}
                    {m.modelo && m.placa && ' · '}
                    {m.placa && <span>Placa: <b>{m.placa}</b></span>}
                  </div>

                  {/* Info del incidente si está ocupada */}
                  {ocupada && m.parte_activo && (
                    <div style={{ marginTop: '10px', padding: '10px', background: '#fef2f2', borderRadius: '6px', fontSize: '12px', border: '1px solid #fecaca' }}>
                      <div style={{ color: '#991b1b', fontWeight: 700, marginBottom: '3px' }}>{m.parte_activo.part_number}</div>
                      {m.parte_activo.incidente_tipo && (
                        <div style={{ color: '#7f1d1d', marginBottom: '2px', fontWeight: 600 }}>{m.parte_activo.incidente_tipo}</div>
                      )}
                      <div style={{ color: '#7f1d1d', marginBottom: '6px' }}><FaMapMarkerAlt size={10} /> {m.parte_activo.incidente_lugar || 'Sin ubicación'}</div>
                      {m.parte_activo.incidente_id && irAIncidente && (
                        <button
                          onClick={(e) => { e.stopPropagation(); irAIncidente(m.parte_activo.incidente_id); }}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', background: '#dc2626', color: '#fff', border: 'none', borderRadius: '5px', padding: '5px 11px', fontSize: '11px', fontWeight: 600, cursor: 'pointer', width: '100%', justifyContent: 'center' }}>
                          <FaExternalLinkAlt size={10} /> Ir a la incidencia
                        </button>
                      )}
                    </div>
                  )}
                  {ocupada && !m.parte_activo && (
                    <div style={{ marginTop: '10px', padding: '10px', background: '#fef2f2', borderRadius: '6px', border: '1px solid #fecaca' }}>
                      <div style={{ fontSize: '11px', color: '#94a3b8', fontStyle: 'italic', marginBottom: m.ultimo_parte ? '8px' : '0' }}>
                        Marcada como ocupada, pero sin parte abierto.
                      </div>
                      {m.ultimo_parte && (
                        <div style={{ fontSize: '12px', marginBottom: '8px' }}>
                          <div style={{ color: '#64748b', fontSize: '11px', marginBottom: '2px' }}>Último parte: <b style={{ color: '#b91c1c' }}>{m.ultimo_parte.part_number}</b> · {m.ultimo_parte.date}</div>
                          {m.ultimo_parte.incidente_lugar && <div style={{ color: '#64748b', fontSize: '11px' }}>📍 {m.ultimo_parte.incidente_lugar}</div>}
                          {m.ultimo_parte.incidente_id && irAIncidente && (
                            <button onClick={(e) => { e.stopPropagation(); irAIncidente(m.ultimo_parte.incidente_id); }}
                              style={{ marginTop: '6px', width: '100%', justifyContent: 'center', display: 'inline-flex', alignItems: 'center', gap: '6px', background: '#dc2626', color: '#fff', border: 'none', borderRadius: '6px', padding: '7px 11px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>
                              <FaExternalLinkAlt size={10} /> Ir a la incidencia
                            </button>
                          )}
                        </div>
                      )}
                      <button onClick={(e) => { e.stopPropagation(); liberarMaquina(m); }}
                        style={{ width: '100%', justifyContent: 'center', display: 'inline-flex', alignItems: 'center', gap: '6px', background: '#16a34a', color: '#fff', border: 'none', borderRadius: '6px', padding: '7px 11px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>
                        <FaCheckCircle size={11} /> Liberar máquina
                      </button>
                    </div>
                  )}

                  {/* Info de mantenimiento si aplica */}
                  {enMant && (
                    <div style={{ marginTop: '10px', padding: '10px', background: '#fff7ed', borderRadius: '6px', fontSize: '12px', border: '1px solid #fed7aa' }}>
                      <div style={{ color: '#b45309', fontWeight: 700, marginBottom: '3px', display: 'flex', alignItems: 'center', gap: '5px' }}><FaTools size={11} /> En mantenimiento</div>
                      {m.mantenimiento_obs && <div style={{ color: '#92400e', marginBottom: '2px' }}>{m.mantenimiento_obs}</div>}
                      {m.mantenimiento_inicio && <div style={{ color: '#a16207', fontSize: '11px' }}>Desde: {new Date(m.mantenimiento_inicio).toLocaleString('es-PE')}</div>}
                    </div>
                  )}

                  {/* Botón enviar / liberar de mantenimiento (no disponible si hay parte abierto) */}
                  {!ocupada && (
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleMantenimiento(m); }}
                      style={{ marginTop: '10px', width: '100%', justifyContent: 'center', display: 'inline-flex', alignItems: 'center', gap: '6px',
                        background: enMant ? '#16a34a' : '#f59e0b', color: '#fff', border: 'none', borderRadius: '6px', padding: '7px 11px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>
                      <FaTools size={11} /> {enMant ? 'Marcar operativa' : 'Enviar a mantenimiento'}
                    </button>
                  )}

                  <div style={{ marginTop: '10px', color: '#206bc4', fontWeight: 600, fontSize: '11px', display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <FaHistory size={10} /> Ver historial de partes →
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Paginador (8 por página) ────────────────────────────────────── */}
      {maquinasFiltradas.length > PORPAGINA && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', marginTop: '20px', flexWrap: 'wrap' }}>
          <button onClick={() => setPagina(p => Math.max(1, p - 1))} disabled={paginaSegura === 1}
            style={{ padding: '7px 14px', borderRadius: '8px', border: '1px solid #cbd5e1', background: paginaSegura === 1 ? '#f1f5f9' : '#fff', color: paginaSegura === 1 ? '#94a3b8' : '#334155', cursor: paginaSegura === 1 ? 'default' : 'pointer', fontSize: '13px', fontWeight: 600 }}>
            ← Anterior
          </button>

          {Array.from({ length: totalPaginas }, (_, i) => i + 1)
            .filter(n => n === 1 || n === totalPaginas || Math.abs(n - paginaSegura) <= 1)
            .map((n, idx, arr) => (
              <span key={n} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {idx > 0 && arr[idx - 1] !== n - 1 && <span style={{ color: '#94a3b8' }}>…</span>}
                <button onClick={() => setPagina(n)}
                  style={{ minWidth: '36px', padding: '7px 0', borderRadius: '8px', border: '1px solid', borderColor: n === paginaSegura ? '#206bc4' : '#cbd5e1', background: n === paginaSegura ? '#206bc4' : '#fff', color: n === paginaSegura ? '#fff' : '#334155', cursor: 'pointer', fontSize: '13px', fontWeight: 700 }}>
                  {n}
                </button>
              </span>
            ))}

          <button onClick={() => setPagina(p => Math.min(totalPaginas, p + 1))} disabled={paginaSegura === totalPaginas}
            style={{ padding: '7px 14px', borderRadius: '8px', border: '1px solid #cbd5e1', background: paginaSegura === totalPaginas ? '#f1f5f9' : '#fff', color: paginaSegura === totalPaginas ? '#94a3b8' : '#334155', cursor: paginaSegura === totalPaginas ? 'default' : 'pointer', fontSize: '13px', fontWeight: 600 }}>
            Siguiente →
          </button>

          <span style={{ marginLeft: '8px', fontSize: '12px', color: '#64748b', whiteSpace: 'nowrap' }}>
            Página {paginaSegura} de {totalPaginas} · {maquinasFiltradas.length} máquinas
          </span>
        </div>
      )}

      {/* ── Modal: elegir formato del reporte de flota ─────────────────── */}
      {modalReporteFlota && (
        <div onClick={() => !generandoFlota && setModalReporteFlota(false)}
          style={{ position:'fixed', inset:0, zIndex:10001, background:'rgba(0,0,0,0.6)', display:'flex', alignItems:'center', justifyContent:'center', padding:'16px' }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background:'#fff', borderRadius:'12px', width:'100%', maxWidth:'440px', overflow:'hidden', boxShadow:'0 20px 40px rgba(0,0,0,0.25)' }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'14px 18px', borderBottom:'1px solid #e2e8f0', background:'#f8fafc' }}>
              <h5 style={{ margin:0, fontSize:'16px', color:'#1e293b', display:'flex', alignItems:'center', gap:'8px' }}>
                <FaTruck color="#0ea5e9" /> Reporte de Maquinaria
              </h5>
              <button onClick={() => !generandoFlota && setModalReporteFlota(false)} disabled={generandoFlota} style={xBtnStyle}><FaTimes /></button>
            </div>
            <div style={{ padding:'20px 18px' }}>
              <p style={{ margin:'0 0 6px', fontSize:'13px', color:'#334155' }}>
                Se generará un archivo con <b>{maquinasFiltradas.length} máquina(s)</b>, cada una con el
                detalle de sus partes diarios.
              </p>
              {(filtroOrigen || filtroEstado || busqueda.trim()) && (
                <p style={{ margin:'6px 0', fontSize:'12px', color:'#0369a1', background:'#f0f9ff', border:'1px solid #bae6fd', borderRadius:'6px', padding:'8px 10px' }}>
                  Se aplicarán los filtros activos ({maquinasFiltradas.length} de {maquinas.length}).
                </p>
              )}
              <p style={{ margin:'12px 0 16px', fontSize:'13px', color:'#64748b' }}>Elige el formato:</p>
              {generandoFlota ? (
                <div style={{ textAlign:'center', padding:'24px 0' }}>
                  <FaSyncAlt className="spin-anim" style={{ fontSize:'26px', color:'#0ea5e9' }} />
                  <p style={{ fontSize:'13px', color:'#64748b', marginTop:'10px' }}>Generando reporte…</p>
                </div>
              ) : (
                <div style={{ display:'flex', gap:'12px' }}>
                  <button onClick={reporteFlotaPDF}
                    style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', gap:'8px', padding:'18px 12px', background:'#fef2f2', color:'#b91c1c', border:'2px solid #fecaca', borderRadius:'10px', cursor:'pointer', fontSize:'14px', fontWeight:700 }}>
                    <FaFilePdf size={26} /> PDF
                  </button>
                  <button onClick={reporteFlotaExcel}
                    style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', gap:'8px', padding:'18px 12px', background:'#f0fdf4', color:'#15803d', border:'2px solid #bbf7d0', borderRadius:'10px', cursor:'pointer', fontSize:'14px', fontWeight:700 }}>
                    <FaDownload size={26} /> Excel
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Modal de historial de partes ───────────────────────────────── */}
      {detalle && (
        <div onClick={() => { setDetalle(null); setHistorial(null); }} style={overlayStyle}>
          <div onClick={e => e.stopPropagation()} style={{ ...modalStyle, maxWidth: '1400px', maxHeight: '94vh' }}>
            <div style={modalHeadStyle}>
              <h5 style={{ margin: 0, fontSize: '16px', color: '#1e293b', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <FaTruck color="#475569" /> {detalle.codigo} · {detalle.modelo || detalle.placa}
              </h5>
              <button onClick={() => { setDetalle(null); setHistorial(null); }} style={xBtnStyle}><FaTimes /></button>
            </div>

            <div style={{ padding: '18px', overflowY: 'auto' }}>
              {/* Badge de estado */}
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px',
                background: detalle.en_mantenimiento ? '#fff7ed' : (detalle.disponible ? '#f0fdf4' : '#fef2f2'),
                color: detalle.en_mantenimiento ? '#d97706' : (detalle.disponible ? '#16a34a' : '#dc2626'),
                padding: '4px 12px', borderRadius: '6px', fontSize: '12px', fontWeight: 700, marginBottom: '14px' }}>
                {detalle.en_mantenimiento ? <FaTools size={12} /> : (detalle.disponible ? <FaCheckCircle size={12} /> : <FaExclamationTriangle size={12} />)}
                {detalle.en_mantenimiento ? 'EN MANTENIMIENTO' : (detalle.disponible ? 'DISPONIBLE' : 'EN INCIDENTE')}
              </div>

              {/* Datos de la máquina */}
              <div style={{ background: '#f8fafc', borderRadius: '8px', padding: '12px', marginBottom: '16px' }}>
                <Campo label="Equipo" valor={`${detalle.equipo} · ${detalle.marca}`} />
                <Campo label="Modelo" valor={detalle.modelo} />
                <Campo label="Placa" valor={detalle.placa} />
                <Campo label="Origen" valor={detalle.origen_texto} />
              </div>

              {/* Totales del historial */}
              {historial && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', marginBottom: '14px' }}>
                  <div style={{ background: '#eff6ff', borderRadius: '6px', padding: '8px 10px', textAlign: 'center' }}>
                    <div style={{ fontSize: '10px', color: '#64748b', fontWeight: 600 }}>PARTES</div>
                    <div style={{ fontSize: '18px', fontWeight: 700, color: '#206bc4' }}>{historial.total_partes}</div>
                  </div>
                  <div style={{ background: '#fffbeb', borderRadius: '6px', padding: '8px 10px', textAlign: 'center' }}>
                    <div style={{ fontSize: '10px', color: '#64748b', fontWeight: 600 }}>HORAS</div>
                    <div style={{ fontSize: '18px', fontWeight: 700, color: '#b45309' }}>{historial.total_horas}</div>
                  </div>
                  <div style={{ background: '#f0fdf4', borderRadius: '6px', padding: '8px 10px', textAlign: 'center' }}>
                    <div style={{ fontSize: '10px', color: '#64748b', fontWeight: 600 }}>COSTO</div>
                    <div style={{ fontSize: '16px', fontWeight: 700, color: '#16a34a' }}>S/ {fmtNum(historial.total_costo)}</div>
                  </div>
                </div>
              )}

              {/* Lista de partes */}
              <div style={{ marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                <div style={{ fontSize: '12px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <FaHistory size={11} /> Historial de partes diarios
                </div>
                {historial && historial.partes && historial.partes.length > 0 && (
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
                    <button onClick={exportarHistorialExcel} title="Descargar en Excel"
                      style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', background: '#dcfce7', color: '#15803d', border: 'none', borderRadius: '6px', padding: '6px 12px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>
                      <FaDownload size={11} /> Excel
                    </button>
                    <button onClick={exportarHistorialPDF} title="Descargar en PDF"
                      style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', background: '#fee2e2', color: '#b91c1c', border: 'none', borderRadius: '6px', padding: '6px 12px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>
                      <FaFilePdf size={11} /> PDF
                    </button>
                  </div>
                )}
              </div>

              {cargandoHist ? (
                <div style={{ textAlign: 'center', padding: '30px', color: '#94a3b8' }}>
                  <FaSyncAlt className="spin-anim" style={{ fontSize: '22px' }} />
                  <p style={{ fontSize: '13px' }}>Cargando historial…</p>
                </div>
              ) : !historial ? (
                <div style={{ textAlign: 'center', padding: '20px', color: '#94a3b8', fontSize: '13px', fontStyle: 'italic' }}>
                  No se pudo cargar el historial.
                </div>
              ) : historial.partes.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '20px', color: '#94a3b8', fontSize: '13px', fontStyle: 'italic' }}>
                  Esta máquina aún no tiene partes diarios registrados.
                </div>
              ) : (
                <div style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                    <thead>
                      <tr style={{ background: '#f1f5f9', borderBottom: '2px solid #e2e8f0' }}>
                        <th style={{ textAlign: 'left', padding: '10px 10px', fontSize: '11px', color: '#475569', whiteSpace: 'nowrap' }}>N° PARTE</th>
                        <th style={{ textAlign: 'left', padding: '10px 8px', fontSize: '11px', color: '#475569' }}>FECHA</th>
                        <th style={{ textAlign: 'left', padding: '10px 8px', fontSize: '11px', color: '#475569' }}>ESTADO</th>
                        <th style={{ textAlign: 'left', padding: '10px 8px', fontSize: '11px', color: '#475569' }}>ACTIVIDAD</th>
                        <th style={{ textAlign: 'right', padding: '10px 8px', fontSize: '11px', color: '#475569' }}>VOLUMEN</th>
                        <th style={{ textAlign: 'right', padding: '10px 8px', fontSize: '11px', color: '#475569' }}>HORAS</th>
                        <th style={{ textAlign: 'right', padding: '10px 8px', fontSize: '11px', color: '#475569' }}>COMBUST.</th>
                        <th style={{ textAlign: 'left', padding: '10px 8px', fontSize: '11px', color: '#475569' }}>PROVEEDOR</th>
                        <th style={{ textAlign: 'left', padding: '10px 8px', fontSize: '11px', color: '#475569', whiteSpace: 'nowrap' }}>N° INCIDENCIA</th>
                        <th style={{ textAlign: 'right', padding: '10px 8px', fontSize: '11px', color: '#475569' }}>TOTAL</th>
                        <th style={{ textAlign: 'right', padding: '10px 14px', fontSize: '11px', color: '#475569' }}>PDF</th>
                      </tr>
                    </thead>
                    <tbody>
                      {historial.partes.map(p => (
                        <tr key={p.id} style={{ borderBottom: '1px solid #f1f5f9', background: p.cerrado ? '#fff' : '#fffbeb' }}>
                          <td style={{ padding: '11px 10px', fontWeight: 700, color: '#1e293b', whiteSpace: 'nowrap' }}>{p.part_number}</td>
                          <td style={{ padding: '11px 8px', color: '#475569', whiteSpace: 'nowrap' }}>{p.date ? p.date.split('T')[0].split('-').reverse().join('/') : '—'}</td>
                          <td style={{ padding: '11px 8px' }}>
                            <span style={{ fontSize: '10px', fontWeight: 700, padding: '3px 9px', borderRadius: '4px', background: p.cerrado ? '#dcfce7' : '#fef3c7', color: p.cerrado ? '#15803d' : '#b45309', whiteSpace: 'nowrap' }}>
                              {p.cerrado ? 'CERRADO' : 'ABIERTO'}
                            </span>
                          </td>
                          <td style={{ padding: '11px 8px', color: '#475569', maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={p.activities || ''}>{p.activities || '—'}</td>
                          <td style={{ padding: '11px 8px', textAlign: 'right', fontWeight: 600, color: '#334155', whiteSpace: 'nowrap' }}>{fmtNum(p.metrado || 0)} {uMet(p.metrado_unidad)}</td>
                          <td style={{ padding: '11px 8px', textAlign: 'right', fontWeight: 600, color: '#334155', whiteSpace: 'nowrap' }}>{fmtNum(p.horas)} HE</td>
                          <td style={{ padding: '11px 8px', textAlign: 'right', color: '#334155', whiteSpace: 'nowrap' }}>{fmtNum(p.fuel_gallons || 0)} Gls</td>
                          <td style={{ padding: '11px 8px', color: '#475569', maxWidth: '150px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={p.provider || ''}>{p.provider || '—'}</td>
                          <td style={{ padding: '11px 8px', color: '#475569', whiteSpace: 'nowrap' }}>{p.incidente_codigo || (p.incidente_id ? `#${p.incidente_id}` : '—')}</td>
                          <td style={{ padding: '11px 8px', textAlign: 'right', fontWeight: 700, color: '#1463A5', whiteSpace: 'nowrap' }}>S/ {fmtNum(p.costo)}</td>
                          <td style={{ padding: '11px 14px', textAlign: 'right' }}>
                            <button onClick={() => abrirPdfParte(p.id, p.part_number)} title="Ver PDF"
                              style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', background: '#e0f2fe', color: '#0284c7', border: 'none', borderRadius: '5px', padding: '5px 10px', fontSize: '11px', fontWeight: 600, cursor: 'pointer' }}>
                              <FaFilePdf size={11} /> PDF
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr style={{ background: '#f8fafc', borderTop: '2px solid #e2e8f0' }}>
                        <td colSpan="4" style={{ padding: '13px 14px', fontWeight: 700, color: '#334155' }}>TOTAL · {historial.total_partes} parte{historial.total_partes !== 1 ? 's' : ''}</td>
                        <td style={{ padding: '13px 8px', textAlign: 'right', fontWeight: 700, color: '#334155', whiteSpace: 'nowrap' }}>{fmtNum(historial.partes.reduce((s, p) => s + (parseFloat(p.metrado) || 0), 0))}</td>
                        <td style={{ padding: '13px 8px', textAlign: 'right', fontWeight: 700, color: '#334155', whiteSpace: 'nowrap' }}>{fmtNum(historial.total_horas)} HE</td>
                        <td style={{ padding: '13px 8px', textAlign: 'right', fontWeight: 700, color: '#334155', whiteSpace: 'nowrap' }}>{fmtNum(historial.partes.reduce((s, p) => s + (parseFloat(p.fuel_gallons) || 0), 0))} Gls</td>
                        <td style={{ padding: '13px 8px' }}></td>
                        <td style={{ padding: '13px 8px' }}></td>
                        <td style={{ padding: '13px 8px', textAlign: 'right', fontWeight: 800, fontSize: '15px', color: '#1463A5', whiteSpace: 'nowrap' }}>S/ {fmtNum(historial.total_costo)}</td>
                        <td style={{ padding: '13px 14px' }}></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Modal visor de PDF ─────────────────────────────────────────── */}
      {pdfModal && (
        <div onClick={() => setPdfModal(null)} style={{ ...overlayStyle, zIndex: 10000, alignItems: 'flex-start', padding: '2vh 16px' }}>
          <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: '900px', height: '92vh', display: 'flex', flexDirection: 'column', background: '#fff', borderRadius: '10px', overflow: 'hidden' }}>
            <div style={modalHeadStyle}>
              <h5 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px', fontSize: '16px', color: '#1e293b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                <FaFilePdf color="#dc2626" /> {pdfModal.nombre}
              </h5>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexShrink: 0 }}>
                <a href={pdfModal.url} target="_blank" rel="noreferrer" style={{ display: 'flex', alignItems: 'center', gap: '5px', background: '#206bc4', color: '#fff', textDecoration: 'none', borderRadius: '6px', padding: '6px 12px', fontSize: '13px', fontWeight: 600 }}>
                  <FaDownload size={13} /> Abrir aparte
                </a>
                <button onClick={() => setPdfModal(null)} style={xBtnStyle}><FaTimes /></button>
              </div>
            </div>
            <div style={{ flex: 1, backgroundColor: '#525659' }}>
              <iframe src={pdfModal.url} style={{ width: '100%', height: '100%', border: 'none' }} title="Visor PDF" />
            </div>
          </div>
        </div>
      )}

      {/* ── Mantenedor de catálogos (Equipos/Marcas/Modelos) ─────────────── */}
      <MantenedorEquipos
        abierto={mantenedorAbierto}
        onClose={() => { setMantenedorAbierto(false); cargar(); }}
      />
    </div>
    </div>
  );
}

// Componente auxiliar para mostrar un campo del detalle.
function Campo({ label, valor, icono }) {
  if (!valor) return null;
  return (
    <div style={{ display: 'flex', padding: '5px 0' }}>
      <div style={{ width: '110px', fontSize: '12px', color: '#94a3b8', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '5px', flexShrink: 0 }}>
        {icono}{label}
      </div>
      <div style={{ fontSize: '13px', color: '#1e293b', flex: 1 }}>{valor}</div>
    </div>
  );
}

const selStyle = { padding: '7px 12px', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '13px', color: '#334155', background: '#fff', cursor: 'pointer' };
const overlayStyle = { position: 'fixed', inset: 0, zIndex: 9999, backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' };
const modalStyle = { background: '#fff', borderRadius: '12px', width: '100%', maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' };
const modalHeadStyle = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid #e2e8f0', backgroundColor: '#f8fafc' };
const xBtnStyle = { background: 'none', border: 'none', cursor: 'pointer', color: '#64748b', fontSize: '18px', display: 'flex' };