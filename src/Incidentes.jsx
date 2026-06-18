import { useState, useEffect } from 'react';
import { 
  FaSyncAlt, FaEye, FaMapMarkerAlt, 
  FaCalendarAlt, FaCamera, FaVideo, 
  FaImage, FaChevronLeft, FaChevronRight, FaTimes, FaPlus, FaFileInvoice, FaSave, FaFilePdf, FaFileExcel, FaDownload
} from 'react-icons/fa';
import './Incidentes.css';
import Swal from 'sweetalert2';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import ExcelJS from 'exceljs';
import logo from './assets/jurp.png';

function Incidentes() {
  const [incidentes, setIncidentes] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [paginaActual, setPaginaActual] = useState(1);
  const itemsPorPagina = 8;

  // --- ESTADOS DEL MODAL PRINCIPAL ---
  const [modalAbierto, setModalAbierto] = useState(false);
  const [incidenteActivo, setIncidenteActivo] = useState(null);
  const [recursos, setRecursos] = useState([]); 
  const [guardando, setGuardando] = useState(false);

  // --- ESTADOS DEL MODAL PDF ---
  const [modalPdfAbierto, setModalPdfAbierto] = useState(false);
  const [pdfUrlActivo, setPdfUrlActivo] = useState(null);

  // --- ESTADOS DEL MODAL DE EVIDENCIAS (GALERÍA) ---
  const [modalMediaAbierto, setModalMediaAbierto] = useState(false);
  const [galeriaMedia, setGaleriaMedia] = useState([]);
  const [galeriaIndex, setGaleriaIndex] = useState(0);
  const [cargandoMedia, setCargandoMedia] = useState(false);
  const [galeriaIncidente, setGaleriaIncidente] = useState(null);

  const getFechaHoy = () => {
    const hoy = new Date();
    return hoy.toISOString().split('T')[0];
  };

  const generarCorrelativo = () => {
    const fecha = new Date();
    const strFecha = `${fecha.getFullYear()}${String(fecha.getMonth()+1).padStart(2,'0')}${String(fecha.getDate()).padStart(2,'0')}`;
    const random = Math.floor(1000 + Math.random() * 9000); 
    return `PD-${strFecha}-${random}`;
  };
  
  const estadoInicialRecurso = {
    tipo: 'Personal', descripcion: '', cantidad: 1, precioUnitario: 0,
    numPersonas: 1, horasTrabajo: 8, horasExtras: 0, 
    numeroParte: generarCorrelativo(), 
    fechaParte: getFechaHoy(), 
    turno: 'Día', zonaTrabajo: '',
    proveedor: '', operador: '',
    equipo: 'TRACTOR', equipoOtro: '', 
    marca: 'CAT', marcaOtro: '', 
    placa: '', 
    hmInicio: '', hmFin: '', combustible: '', vale: '', fotoVale: null,
    actividad: '', observaciones: '', fotoParte: null,
    incluirMetrado: false, longitud: '', altura: '', anchoSup: '', anchoInf: ''
  };
  const [nuevoRecurso, setNuevoRecurso] = useState(estadoInicialRecurso);

  const obtenerIncidentes = async () => {
    const token = localStorage.getItem('userToken'); 
    if (!token) return;
    setCargando(true);
    try {
      const res = await fetch('/api/v1/mobile/hi-incidents/list/', { 
        headers: { 'Content-Type': 'application/json', 'Authorization': `Token ${token}` } 
      });
      if (res.ok) {
        const data = await res.json();
        const tiposMapa = { '1': 'Deslizamiento', '2': 'Obstrucción', '3': 'Falla Mecánica', '4': 'Robo', '5': 'Daño Estructural', '6': 'Otro' };
        const listaFormateada = (data.results || []).map(inc => {
          let tipoNombre = tiposMapa[inc.type?.toString()] || 'Incidente';
          const anotherType = inc.another_type?.trim();
          if (anotherType && (tipoNombre === 'Otro' || tipoNombre === 'Otros')) tipoNombre = `Otro (${anotherType})`;
          return {
            id: inc.id, codigo: inc.code || 'Sin Código', lugar: inc.location_text || '-',
            tipo: tipoNombre, gravedad: inc.severity || 'lev', estado: inc.status || 'pat',
            usuario: inc.user?.username || inc.username || 'Sistema',
            fecha: new Date(inc.created_at).toLocaleString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute:'2-digit' }),
            imagesCount: inc.images_count || 0, videosCount: inc.videos_count || 0,
            imagenUrl: inc.thumbnail || inc.image || null 
          };
        });
        setIncidentes(listaFormateada);
        setPaginaActual(1);
      }
    } catch (error) { console.error(error); } finally { setCargando(false); }
  };

  // ── Cargar thumbnails desde el detalle para cards sin imagen ───────────
  const cargarThumbnails = async (lista) => {
    const token = localStorage.getItem('userToken');
    if (!token) return;
    const sinThumb = lista.filter(i => !i.imagenUrl && (i.imagesCount > 0 || i.videosCount > 0));
    if (!sinThumb.length) return;

    const updates = {};
    await Promise.all(sinThumb.map(async (inc) => {
      try {
        const res = await fetch(`/api/v1/mobile/hi-incidents/${inc.id}/`, {
          headers: { 'Authorization': `Token ${token}`, 'Content-Type': 'application/json' }
        });
        if (res.ok) {
          const json = await res.json();
          const detail = json.data || json;
          const firstImg = (detail.images || [])[0];
          if (firstImg?.content) {
            updates[inc.id] = firstImg.content.startsWith('http') ? firstImg.content : `data:image/jpeg;base64,${firstImg.content}`;
          }
        }
      } catch (e) { /* silencioso */ }
    }));

    if (Object.keys(updates).length > 0) {
      setIncidentes(prev => prev.map(i => updates[i.id] ? { ...i, imagenUrl: updates[i.id] } : i));
    }
  };

  useEffect(() => {
    if (incidentes.length > 0) cargarThumbnails(incidentes);
  }, [incidentes.length]);

  // ── Cargar evidencias (imágenes y videos) de un incidente ──────────────
  const verEvidencias = async (inc) => {
    setGaleriaIncidente(inc);
    setGaleriaMedia([]);
    setGaleriaIndex(0);
    setCargandoMedia(true);
    setModalMediaAbierto(true);

    const token = localStorage.getItem('userToken');
    try {
      const res = await fetch(`/api/v1/mobile/hi-incidents/${inc.id}/`, {
        headers: { 'Authorization': `Token ${token}`, 'Content-Type': 'application/json' }
      });
      if (res.ok) {
        const json = await res.json();
        const detail = json.data || json;
        const media = [];
        (detail.images || []).forEach(it => {
          const src = it.content?.startsWith('http') ? it.content : `data:image/jpeg;base64,${it.content}`;
          media.push({ src, type: 'image' });
        });
        (detail.videos || []).forEach(it => {
          const src = it.content?.startsWith('http') ? it.content : `data:video/mp4;base64,${it.content}`;
          media.push({ src, type: 'video' });
        });
        if (media.length === 0 && inc.imagenUrl) {
          media.push({ src: inc.imagenUrl, type: 'image' });
        }
        setGaleriaMedia(media);
      }
    } catch (e) { console.error(e); } finally { setCargandoMedia(false); }
  };

  const galeriaAnterior = () => setGaleriaIndex(i => Math.max(0, i - 1));
  const galeriaSiguiente = () => setGaleriaIndex(i => Math.min(galeriaMedia.length - 1, i + 1));

  const cargarCosteosGuardados = async (incidenteId) => {
    const BASE_URL = 'https://gideonstudio.duckdns.org'; 
    try {
      const [resPers, resMat, resMaq] = await Promise.all([
        fetch(`${BASE_URL}/api/v1/mobile/operations/incident-personnels/`),
        fetch(`${BASE_URL}/api/v1/mobile/operations/incident-materials/`),
        fetch(`${BASE_URL}/api/v1/mobile/operations/daily-part-heavy-equipments/`)
      ]);
      const [dataPers, dataMat, dataMaq] = await Promise.all([resPers.json(), resMat.json(), resMaq.json()]);
      const listPers = Array.isArray(dataPers) ? dataPers : (dataPers.results || []);
      const listMat = Array.isArray(dataMat) ? dataMat : (dataMat.results || []);
      const listMaq = Array.isArray(dataMaq) ? dataMaq : (dataMaq.results || []);
      const idStr = String(incidenteId);
      const formatPers = listPers.filter(i => String(i.incident_report) === idStr).map(i => ({ idLocal: `db-pers-${i.id}`, tipo: 'Personal', descripcionResumen: i.description, cantidad: parseFloat(i.quantity_hours), precioUnitario: parseFloat(i.unit_price), total: parseFloat(i.quantity_hours) * parseFloat(i.unit_price), guardadoEnDB: true }));
      const formatMat = listMat.filter(i => String(i.incident_report) === idStr).map(i => ({ idLocal: `db-mat-${i.id}`, tipo: 'Insumo', descripcionResumen: i.description, cantidad: parseFloat(i.quantity), precioUnitario: parseFloat(i.unit_price), total: parseFloat(i.quantity) * parseFloat(i.unit_price), guardadoEnDB: true }));
      const formatMaq = listMaq.filter(i => String(i.incident_report) === idStr).map(i => ({ idLocal: `db-maq-${i.id}`, dbId: i.id, tipo: 'Maquinaria', descripcionResumen: `Parte N° ${i.part_number} | ${i.equipment_name}\nActividad: ${i.activities}`, cantidad: Math.max(0, parseFloat(i.end_horometer) - parseFloat(i.start_horometer)), precioUnitario: parseFloat(i.unit_price), total: Math.max(0, parseFloat(i.end_horometer) - parseFloat(i.start_horometer)) * parseFloat(i.unit_price), guardadoEnDB: true }));
      setRecursos([...formatPers, ...formatMat, ...formatMaq]);
    } catch (error) { console.error("❌ Error al obtener los recursos guardados:", error); }
  };

  useEffect(() => { obtenerIncidentes(); }, []);

  const abrirModal = (inc) => {
    setIncidenteActivo(inc); setRecursos([]); 
    setNuevoRecurso({...estadoInicialRecurso, numeroParte: generarCorrelativo()});
    setModalAbierto(true);
    cargarCosteosGuardados(inc.id); 
  };

  const abrirModalPdf = (dbId) => {
    const url = `https://gideonstudio.duckdns.org/api/v1/mobile/operations/daily-part-heavy-equipments/${dbId}/pdf/`;
    setPdfUrlActivo(url);
    setModalPdfAbierto(true);
  };

  const horasMaquina = (nuevoRecurso.hmFin && nuevoRecurso.hmInicio) ? Math.max(0, (parseFloat(nuevoRecurso.hmFin) - parseFloat(nuevoRecurso.hmInicio))).toFixed(1) : 0;

  const volumenMetrado = nuevoRecurso.incluirMetrado ? (((parseFloat(nuevoRecurso.anchoSup)||0 + parseFloat(nuevoRecurso.anchoInf)||0) / 2) * (parseFloat(nuevoRecurso.altura)||0) * (parseFloat(nuevoRecurso.longitud)||0)).toFixed(2) : 0;

  const agregarRecurso = () => {
    let descFinal = nuevoRecurso.descripcion;
    let cantFinal = parseFloat(nuevoRecurso.cantidad) || 0;
    if (nuevoRecurso.tipo === 'Maquinaria') {
      cantFinal = parseFloat(horasMaquina) || 0;
      if (cantFinal <= 0) return Swal.fire({ icon: 'warning', title: 'Atención', text: 'El Horómetro Final debe ser mayor al Inicial' });
      if (!nuevoRecurso.numeroParte) return Swal.fire({ icon: 'warning', title: 'Atención', text: 'El Número de Parte es obligatorio' });
      const equipoFinal = nuevoRecurso.equipo === 'OTRO' ? nuevoRecurso.equipoOtro : nuevoRecurso.equipo;
      const marcaFinal = nuevoRecurso.marca === 'OTRO' ? nuevoRecurso.marcaOtro : nuevoRecurso.marca;
      descFinal = `Parte N° ${nuevoRecurso.numeroParte} | ${equipoFinal} ${marcaFinal} (${nuevoRecurso.placa})\n`;
      descFinal += `Zona: ${nuevoRecurso.zonaTrabajo} | Op: ${nuevoRecurso.operador} | Prov: ${nuevoRecurso.proveedor}\n`;
      descFinal += `HM: ${nuevoRecurso.hmInicio} a ${nuevoRecurso.hmFin} | Comb: ${nuevoRecurso.combustible || 0} Gls (Vale: ${nuevoRecurso.vale})\n`;
      descFinal += `Actividad: ${nuevoRecurso.actividad}`;
      if (nuevoRecurso.incluirMetrado) descFinal += `\nVol. Extraído: ${volumenMetrado} m3`;
    } else if (nuevoRecurso.tipo === 'Personal') {
      const pers = parseInt(nuevoRecurso.numPersonas) || 0;
      const hrs = parseFloat(nuevoRecurso.horasTrabajo) || 0;
      const ext = parseFloat(nuevoRecurso.horasExtras) || 0;
      cantFinal = pers * (hrs + ext);
      if (!descFinal) return Swal.fire({ icon: 'warning', title: 'Atención', text: 'Ingresa el cargo (Ej. Peón)' });
      if (cantFinal <= 0) return Swal.fire({ icon: 'warning', title: 'Atención', text: 'Ingresa la cantidad de personas y horas' });
      descFinal = `${nuevoRecurso.descripcion}\n(Cuadrilla: ${pers} persona(s) x ${hrs}h normales + ${ext}h extras)`;
    } else {
      if (!descFinal) return Swal.fire({ icon: 'warning', title: 'Atención', text: 'Ingresa una descripción' });
    }
    const recursoCalculado = { ...nuevoRecurso, idLocal: Date.now(), descripcionResumen: descFinal, cantidad: cantFinal, precioUnitario: parseFloat(nuevoRecurso.precioUnitario) || 0, total: cantFinal * (parseFloat(nuevoRecurso.precioUnitario) || 0), guardadoEnDB: false };
    setRecursos([...recursos, recursoCalculado]);
    setNuevoRecurso({...estadoInicialRecurso, numeroParte: generarCorrelativo()});
  };

  const eliminarRecurso = (idLocal) => setRecursos(recursos.filter(r => r.idLocal !== idLocal));
  const costoTotalIncidente = recursos.reduce((sum, item) => sum + item.total, 0);

  // ── Helper: convertir imagen importada a base64 ────────────────────────
  const imgToBase64 = (src) => new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      canvas.getContext('2d').drawImage(img, 0, 0);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });

  // ── Exportar PDF ──────────────────────────────────────────────────────
  const exportarPDF = async () => {
    if (!incidenteActivo) return;
    const doc = new jsPDF();
    const inc = incidenteActivo;
    const estadoTexto = inc.estado === 'pat' ? 'Pendiente' : inc.estado === 'ate' ? 'En Atención' : inc.estado === 'cer' ? 'Cerrado' : inc.estado;
    const gravedadTexto = inc.gravedad === 'lev' ? 'Leve' : inc.gravedad === 'mod' ? 'Moderada' : inc.gravedad === 'gra' ? 'Grave' : inc.gravedad;
    const fechaGenerado = new Date().toLocaleString('es-PE');

    doc.setFillColor(20, 99, 165);
    doc.rect(0, 0, 210, 30, 'F');
    const logoBase64 = await imgToBase64(logo);
    if (logoBase64) doc.addImage(logoBase64, 'PNG', 12, 4, 22, 22);
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(15); doc.setFont(undefined, 'bold');
    doc.text('JUNTA DE RIEGO PRESURIZADO', logoBase64 ? 38 : 14, 13);
    doc.setFontSize(10); doc.setFont(undefined, 'normal');
    doc.text('Reporte de Gestión de Incidente', logoBase64 ? 38 : 14, 20);
    doc.setFontSize(8);
    doc.text(`Generado: ${fechaGenerado}`, 196, 26, { align: 'right' });

    let y = 40;
    doc.setTextColor(30, 41, 59); doc.setFontSize(14); doc.setFont(undefined, 'bold');
    doc.text(inc.tipo, 14, y); y += 8;
    doc.setFontSize(9);
    const infoIzq = [['Código:', inc.codigo || 'Sin Código'],['Ubicación:', inc.lugar || '-'],['Fecha:', inc.fecha || '-']];
    const infoDer = [['Estado:', estadoTexto],['Gravedad:', gravedadTexto],['Reportado por:', inc.usuario || '-']];
    for (let i = 0; i < infoIzq.length; i++) {
      doc.setFont(undefined,'bold'); doc.setTextColor(100,116,139); doc.text(infoIzq[i][0], 14, y);
      doc.setFont(undefined,'normal'); doc.setTextColor(30,41,59); doc.text(infoIzq[i][1], 50, y);
      doc.setFont(undefined,'bold'); doc.setTextColor(100,116,139); doc.text(infoDer[i][0], 115, y);
      doc.setFont(undefined,'normal'); doc.setTextColor(30,41,59); doc.text(infoDer[i][1], 152, y);
      y += 5.5;
    }
    y += 5; doc.setDrawColor(226,232,240); doc.line(14,y,196,y); y += 8;
    doc.setFontSize(11); doc.setFont(undefined,'bold'); doc.setTextColor(30,41,59);
    doc.text('Detalle de Recursos y Costeo', 14, y); y += 5;

    if (recursos.length > 0) {
      autoTable(doc, {
        startY: y,
        head: [['N°','Tipo','Detalle','Cantidad','Unidad','P. Unit. (S/)','Total (S/)']],
        body: recursos.map((r,i) => [i+1, r.tipo, (r.descripcionResumen||r.descripcion||'').replace(/\n/g,' '), r.cantidad.toFixed(2), r.tipo==='Personal'?'HH':r.tipo==='Maquinaria'?'HE':'Unid.', parseFloat(r.precioUnitario).toFixed(2), r.total.toFixed(2)]),
        foot: [['','','','','','COSTO TOTAL:',`S/ ${costoTotalIncidente.toFixed(2)}`]],
        styles:{fontSize:8,cellPadding:2.5,lineColor:[226,232,240],lineWidth:0.1},
        headStyles:{fillColor:[20,99,165],textColor:[255,255,255],fontStyle:'bold',fontSize:8},
        footStyles:{fillColor:[241,245,249],textColor:[30,41,59],fontStyle:'bold',fontSize:9},
        alternateRowStyles:{fillColor:[248,250,252]},
        margin:{left:14,right:14},
        columnStyles:{0:{cellWidth:10,halign:'center'},1:{cellWidth:20},2:{cellWidth:68},3:{cellWidth:18,halign:'right'},4:{cellWidth:14,halign:'center'},5:{cellWidth:24,halign:'right'},6:{cellWidth:28,halign:'right'}},
      });
    } else {
      doc.setFontSize(9); doc.setFont(undefined,'normal'); doc.setTextColor(100,116,139);
      doc.text('No hay recursos registrados para este incidente.', 14, y+6);
    }
    const pageCount = doc.internal.getNumberOfPages();
    for (let i=1;i<=pageCount;i++){doc.setPage(i);doc.setFontSize(7);doc.setTextColor(150);doc.text(`Página ${i} de ${pageCount} — Sistema Integrado de Monitoreo — JURP`,105,290,{align:'center'});}

    // Mostrar en modal
    const blobUrl = doc.output('bloburl');
    setPdfUrlActivo(blobUrl);
    setModalPdfAbierto(true);
  };

  // ── Exportar Excel (con logo y headers azules) ────────────────────────
  const exportarExcel = async () => {
    if (!incidenteActivo) return;
    const inc = incidenteActivo;
    const estadoTexto = inc.estado === 'pat' ? 'Pendiente' : inc.estado === 'ate' ? 'En Atención' : inc.estado === 'cer' ? 'Cerrado' : inc.estado;
    const gravedadTexto = inc.gravedad === 'lev' ? 'Leve' : inc.gravedad === 'mod' ? 'Moderada' : inc.gravedad === 'gra' ? 'Grave' : inc.gravedad;
    const fechaGenerado = new Date().toLocaleString('es-PE');

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Reporte de Incidente');

    // Anchos de columna
    ws.columns = [
      { width: 6 }, { width: 16 }, { width: 50 }, { width: 14 }, { width: 10 }, { width: 16 }, { width: 16 }
    ];

    const azul = { type: 'pattern', pattern: 'solid', fgColor: { argb: '1463A5' } };
    const azulClaro = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'E0F2FE' } };
    const grisClaro = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F1F5F9' } };
    const fuenteBlanca = { bold: true, color: { argb: 'FFFFFF' }, size: 12 };
    const fuenteBlancaSm = { bold: true, color: { argb: 'FFFFFF' }, size: 10 };
    const borde = { top:{style:'thin',color:{argb:'E2E8F0'}}, bottom:{style:'thin',color:{argb:'E2E8F0'}}, left:{style:'thin',color:{argb:'E2E8F0'}}, right:{style:'thin',color:{argb:'E2E8F0'}} };

    // Logo
    try {
      const logoB64 = await imgToBase64(logo);
      if (logoB64) {
        const imgId = wb.addImage({ base64: logoB64.split(',')[1], extension: 'png' });
        ws.addImage(imgId, { tl: { col: 0, row: 0 }, ext: { width: 80, height: 80 } });
      }
    } catch(e) {}

    // Header
    ws.mergeCells('B1:G1');
    const r1 = ws.getCell('B1');
    r1.value = 'JUNTA DE RIEGO PRESURIZADO';
    r1.font = fuenteBlanca; r1.fill = azul; r1.alignment = { vertical: 'middle' };
    ws.getRow(1).height = 30;
    ['A1','C1','D1','E1','F1','G1'].forEach(c => { ws.getCell(c).fill = azul; });

    ws.mergeCells('B2:G2');
    const r2 = ws.getCell('B2');
    r2.value = 'Reporte de Gestión de Incidente';
    r2.font = fuenteBlancaSm; r2.fill = azul; r2.alignment = { vertical: 'middle' };
    ws.getRow(2).height = 22;
    ['A2','C2','D2','E2','F2','G2'].forEach(c => { ws.getCell(c).fill = azul; });

    ws.mergeCells('A3:G3');
    const r3 = ws.getCell('A3');
    r3.value = `Generado: ${fechaGenerado}`;
    r3.font = { italic: true, size: 9, color: { argb: '626976' } };

    // Sección: Datos del incidente
    const row5 = ws.getRow(5);
    ws.mergeCells('A5:G5');
    ws.getCell('A5').value = 'DATOS DEL INCIDENTE';
    ws.getCell('A5').font = { bold: true, color: { argb: 'FFFFFF' }, size: 10 };
    ws.getCell('A5').fill = azul;
    ['B5','C5','D5','E5','F5','G5'].forEach(c => { ws.getCell(c).fill = azul; });
    row5.height = 22;

    const campos = [
      ['Tipo de Incidente', inc.tipo],
      ['Código', inc.codigo || 'Sin Código'],
      ['Ubicación', inc.lugar || '-'],
      ['Fecha', inc.fecha || '-'],
      ['Estado', estadoTexto],
      ['Gravedad', gravedadTexto],
      ['Reportado por', inc.usuario || '-'],
    ];
    campos.forEach(([label, val], i) => {
      const row = ws.getRow(6 + i);
      ws.getCell(`A${6+i}`).value = label;
      ws.getCell(`A${6+i}`).font = { bold: true, size: 9, color: { argb: '64748B' } };
      ws.getCell(`A${6+i}`).fill = grisClaro;
      ws.mergeCells(`B${6+i}:G${6+i}`);
      ws.getCell(`B${6+i}`).value = val;
      ws.getCell(`B${6+i}`).font = { size: 10 };
    });

    // Sección: Recursos
    const rStart = 14;
    ws.mergeCells(`A${rStart}:G${rStart}`);
    ws.getCell(`A${rStart}`).value = 'DETALLE DE RECURSOS Y COSTEO';
    ws.getCell(`A${rStart}`).font = { bold: true, color: { argb: 'FFFFFF' }, size: 10 };
    ws.getCell(`A${rStart}`).fill = azul;
    ['B','C','D','E','F','G'].forEach(c => { ws.getCell(`${c}${rStart}`).fill = azul; });
    ws.getRow(rStart).height = 22;

    // Header tabla
    const hRow = rStart + 1;
    ['N°','Tipo','Detalle','Cantidad','Unidad','P. Unit. (S/)','Total (S/)'].forEach((h, i) => {
      const cell = ws.getCell(hRow, i + 1);
      cell.value = h;
      cell.font = { bold: true, color: { argb: 'FFFFFF' }, size: 9 };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '3B82F6' } };
      cell.alignment = { horizontal: i >= 3 ? 'right' : 'left', vertical: 'middle' };
      cell.border = borde;
    });

    // Filas de datos
    recursos.forEach((r, i) => {
      const rowNum = hRow + 1 + i;
      const vals = [
        i + 1,
        r.tipo,
        (r.descripcionResumen || r.descripcion || '').replace(/\n/g, ' '),
        r.cantidad,
        r.tipo === 'Personal' ? 'HH' : r.tipo === 'Maquinaria' ? 'HE' : 'Unid.',
        parseFloat(r.precioUnitario),
        r.total,
      ];
      vals.forEach((v, j) => {
        const cell = ws.getCell(rowNum, j + 1);
        cell.value = v;
        cell.font = { size: 9 };
        cell.border = borde;
        if (j >= 3) cell.alignment = { horizontal: 'right' };
        if (j === 5 || j === 6) cell.numFmt = '#,##0.00';
        if (i % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F8FAFC' } };
      });
    });

    // Fila total
    const totalRow = hRow + 1 + recursos.length + 1;
    ws.mergeCells(`A${totalRow}:E${totalRow}`);
    ws.getCell(`F${totalRow}`).value = 'COSTO TOTAL:';
    ws.getCell(`F${totalRow}`).font = { bold: true, size: 10 };
    ws.getCell(`F${totalRow}`).fill = azulClaro;
    ws.getCell(`F${totalRow}`).alignment = { horizontal: 'right' };
    ws.getCell(`G${totalRow}`).value = costoTotalIncidente;
    ws.getCell(`G${totalRow}`).font = { bold: true, size: 11 };
    ws.getCell(`G${totalRow}`).numFmt = '"S/ "#,##0.00';
    ws.getCell(`G${totalRow}`).fill = azulClaro;

    // Descargar
    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Reporte_Incidente_${inc.codigo || inc.id}_${new Date().toISOString().slice(0,10)}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const guardarCosteos = async () => {
    const recursosNuevos = recursos.filter(r => !r.guardadoEnDB);
    if (recursosNuevos.length === 0) return Swal.fire({ icon: 'info', title: 'Todo al día', text: 'No hay recursos nuevos.' });
    setGuardando(true);
    const BASE_URL = 'https://gideonstudio.duckdns.org'; 
    const token = localStorage.getItem('userToken'); 
    try {
      for (const r of recursosNuevos) {
        let endpoint = '';
        let formData = new FormData();
        formData.append('incident_report', incidenteActivo.id);
        if (r.tipo === 'Personal') {
          endpoint = `${BASE_URL}/api/v1/mobile/operations/incident-personnels/`;
          formData.append('description', r.descripcionResumen || r.descripcion); 
          formData.append('quantity_hours', r.cantidad);
          formData.append('unit_price', r.precioUnitario);
        } else if (r.tipo === 'Insumo') {
          endpoint = `${BASE_URL}/api/v1/mobile/operations/incident-materials/`;
          formData.append('description', r.descripcion);
          formData.append('quantity', r.cantidad);
          formData.append('unit_price', r.precioUnitario);
        } else if (r.tipo === 'Maquinaria') {
          endpoint = `${BASE_URL}/api/v1/mobile/operations/daily-part-heavy-equipments/`;
          formData.append('part_number', r.numeroParte); formData.append('date', r.fechaParte);
          formData.append('shift', r.turno); formData.append('work_zone_text', r.zonaTrabajo);
          formData.append('provider', r.proveedor); formData.append('operator', r.operador);
          formData.append('equipment_name', r.equipo === 'OTRO' ? r.equipoOtro : r.equipo);
          formData.append('brand_name', r.marca === 'OTRO' ? r.marcaOtro : r.marca);
          formData.append('model_plate', r.placa); formData.append('start_horometer', r.hmInicio);
          formData.append('end_horometer', r.hmFin); formData.append('fuel_gallons', r.combustible || 0);
          formData.append('fuel_voucher', r.vale); formData.append('activities', r.actividad);
          formData.append('observations', r.observaciones); formData.append('unit_price', r.precioUnitario);
          if (r.fotoParte) formData.append('part_photo', r.fotoParte);
          if (r.fotoVale) formData.append('voucher_photo', r.fotoVale);
          if (r.incluirMetrado) { formData.append('width_top', r.anchoSup); formData.append('width_bottom', r.anchoInf); formData.append('height', r.altura); formData.append('length', r.longitud); }
        }
        const res = await fetch(endpoint, { method: 'POST', body: formData });
        if (!res.ok) throw new Error(`Error al guardar el registro de ${r.tipo}`);
      }
      Swal.fire({ icon: 'success', title: 'Éxito', text: 'Se guardó correctamente', confirmButtonColor: '#206bc4' });
      setRecursos([]); setModalAbierto(false); 
    } catch (error) {
      console.error(error);
      Swal.fire({ icon: 'error', title: 'Error', text: 'Hubo un error al guardar en la base de datos.' });
    } finally { setGuardando(false); }
  };

  const indexUltimoItem = paginaActual * itemsPorPagina;
  const indexPrimerItem = indexUltimoItem - itemsPorPagina;
  const incidentesActuales = incidentes.slice(indexPrimerItem, indexUltimoItem);
  const totalPaginas = Math.ceil(incidentes.length / itemsPorPagina);

  const getEstadoBadge = (estado) => {
    const base = {padding:'3px 10px',borderRadius:'4px',fontSize:'11px',fontWeight:'700',letterSpacing:'0.5px',textShadow:'0 1px 2px rgba(0,0,0,0.15)',border:'1px solid rgba(255,255,255,0.3)'};
    switch (estado) {
      case 'pat': return <span style={{...base,backgroundColor:'#f59f00',color:'#fff'}}>Pendiente</span>;
      case 'ate': return <span style={{...base,backgroundColor:'#206bc4',color:'#fff'}}>En Atención</span>;
      case 'cer': return <span style={{...base,backgroundColor:'#2fb344',color:'#fff'}}>Cerrado</span>;
      default: return <span className="tbl-badge bg-secondary-lt">{estado}</span>;
    }
  };

  const getGravedadBadge = (gravedad) => {
    const base = {padding:'3px 10px',borderRadius:'4px',fontSize:'11px',fontWeight:'700',letterSpacing:'0.5px',textShadow:'0 1px 2px rgba(0,0,0,0.15)',border:'1px solid rgba(255,255,255,0.3)'};
    switch (gravedad) {
      case 'lev': return <span style={{...base,backgroundColor:'#2fb344',color:'#fff'}}>Leve</span>;
      case 'mod': return <span style={{...base,backgroundColor:'#f76707',color:'#fff'}}>Moderada</span>;
      case 'gra': return <span style={{...base,backgroundColor:'#d63939',color:'#fff'}}>Grave</span>;
      default: return <span className="tbl-badge bg-secondary-lt">{gravedad}</span>;
    }
  };

  return (
    <div className="tbl-page-wrapper">
      <div className="tbl-page-header">
        <div className="tbl-row align-items-center">
          <div className="tbl-col">
            <div className="tbl-page-pretitle">Gestión de Campo</div>
            <h2 className="tbl-page-title">Incidentes y Reportes</h2>
          </div>
          <div className="tbl-col-auto">
            <button className="tbl-btn tbl-btn-primary" onClick={obtenerIncidentes} disabled={cargando}>
              <FaSyncAlt className={cargando ? 'icon-spin' : ''} style={{marginRight: '8px'}} /> {cargando ? 'Cargando...' : 'Actualizar Datos'}
            </button>
          </div>
        </div>
      </div>

      <div className="tbl-page-body">
        {cargando ? <div className="tbl-empty">Cargando datos...</div> 
        : incidentes.length === 0 ? <div className="tbl-empty">No hay incidentes registrados.</div> 
        : (
          <>
            <div className="tbl-row-cards">
              {incidentesActuales.map(inc => (
                <div className="tbl-card" key={inc.id}>
                  <div className="tbl-card-img-top" onClick={() => verEvidencias(inc)} style={{cursor:'pointer',position:'relative'}} title="Ver evidencias">
                    {inc.imagenUrl ? <img src={inc.imagenUrl} alt="Evidencia" /> : <div className="tbl-img-placeholder"><FaCamera size={24} /><span>Sin Evidencia</span></div>}
                    <div style={{position:'absolute',top:0,left:0,right:0,height:'50px',background:'linear-gradient(to bottom, rgba(0,0,0,0.55), transparent)',borderRadius:'4px 4px 0 0',pointerEvents:'none'}}></div>
                    <div className="tbl-card-badges" style={{position:'absolute',top:'8px',left:'8px',display:'flex',gap:'4px',zIndex:1}}>{getEstadoBadge(inc.estado)}{getGravedadBadge(inc.gravedad)}</div>
                    {(inc.imagesCount > 0 || inc.videosCount > 0) && (
                      <div style={{position:'absolute',bottom:'8px',right:'8px',background:'rgba(0,0,0,0.6)',color:'#fff',padding:'3px 8px',borderRadius:'12px',fontSize:'11px',display:'flex',alignItems:'center',gap:'6px'}}>
                        {inc.imagesCount > 0 && <span><FaImage size={10}/> {inc.imagesCount}</span>}
                        {inc.videosCount > 0 && <span><FaVideo size={10}/> {inc.videosCount}</span>}
                      </div>
                    )}
                  </div>
                  <div className="tbl-card-body">
                    <h3 className="tbl-card-title">{inc.tipo}</h3>
                    <div className="tbl-text-muted tbl-mb-2"><FaMapMarkerAlt className="tbl-icon tbl-text-blue" /><strong>{inc.codigo}</strong><br/><span style={{paddingLeft: '20px', fontSize: '0.85rem'}}>{inc.lugar}</span></div>
                    <div className="tbl-text-muted"><FaCalendarAlt className="tbl-icon" /> {inc.fecha}</div>
                  </div>
                  <div className="tbl-card-footer">
                    <div className="tbl-media-icons">{inc.imagesCount > 0 && <span title="Fotos"><FaImage /> {inc.imagesCount}</span>}{inc.videosCount > 0 && <span title="Videos"><FaVideo /> {inc.videosCount}</span>}</div>
                    <div className="tbl-avatar-group"><span className="tbl-avatar-text">{inc.usuario}</span></div>
                  </div>
                  <div className="tbl-card-btn-bottom" onClick={() => abrirModal(inc)}><FaEye /> Gestionar / Parte Diario</div>
                </div>
              ))}
            </div>
            <div className="tbl-pagination-wrapper">
              <span className="tbl-text-muted">Mostrando página {paginaActual} de {totalPaginas}</span>
              <ul className="tbl-pagination">
                <li className={`tbl-page-item ${paginaActual === 1 ? 'disabled' : ''}`} onClick={() => setPaginaActual(p => Math.max(1, p - 1))}><button className="tbl-page-link"><FaChevronLeft /></button></li>
                <li className={`tbl-page-item ${paginaActual === totalPaginas ? 'disabled' : ''}`} onClick={() => setPaginaActual(p => Math.min(totalPaginas, p + 1))}><button className="tbl-page-link"><FaChevronRight /></button></li>
              </ul>
            </div>
          </>
        )}
      </div>

      {/* ── MODAL PRINCIPAL (GESTIÓN) ──────────────────────────────────── */}
      {modalAbierto && incidenteActivo && (
        <div className="tbl-modal-backdrop" onClick={() => setModalAbierto(false)}>
          <div className="tbl-modal-dialog" onClick={e => e.stopPropagation()} style={{maxWidth: '960px'}}>
            <div className="tbl-modal-content">
              <div className="tbl-modal-header">
                <h5 className="tbl-modal-title">Gestión de Incidente #{incidenteActivo.id}</h5>
                <button className="tbl-btn-close" onClick={() => setModalAbierto(false)}><FaTimes/></button>
              </div>
              <div className="tbl-modal-body">
                <div className="tbl-alert tbl-alert-info">
                  <h4 className="tbl-alert-title">{incidenteActivo.tipo} en {incidenteActivo.codigo}</h4>
                  <div className="tbl-text-muted">{incidenteActivo.lugar}</div>
                </div>
                <div className="tbl-row tbl-mb-3 align-items-center">
                  <div className="tbl-col-3">
                    <label className="tbl-form-label">Tipo de Recurso</label>
                    <select className="tbl-form-select" value={nuevoRecurso.tipo} onChange={e => setNuevoRecurso({...nuevoRecurso, tipo: e.target.value})}>
                      <option value="Personal">Personal (HH / Día)</option>
                      <option value="Maquinaria">Maquinaria (HE / Día)</option>
                      <option value="Insumo">Insumos / Materiales</option>
                    </select>
                  </div>
                </div>

                {nuevoRecurso.tipo === 'Maquinaria' ? (
                  <div style={{ background: '#f8fafc', padding: '20px', borderRadius: '4px', border: '1px solid #e2e8f0', marginBottom: '15px' }}>
                    <div style={{ display:'flex', alignItems:'center', gap:'8px', marginBottom:'20px', color:'#206bc4', fontWeight:'bold', fontSize:'16px' }}><FaFileInvoice /> Formulario: Parte Diario de Maquinaria</div>
                    <div className="tbl-row tbl-mb-3">
                      <div className="tbl-col"><label className="tbl-form-label">N° de Parte <span style={{color:'red'}}>*</span></label><input type="text" className="tbl-form-control" value={nuevoRecurso.numeroParte} onChange={e => setNuevoRecurso({...nuevoRecurso, numeroParte: e.target.value})} style={{fontWeight: 'bold', backgroundColor: '#f1f5f9'}}/></div>
                      <div className="tbl-col"><label className="tbl-form-label">Fecha</label><input type="date" className="tbl-form-control" value={nuevoRecurso.fechaParte} onChange={e => setNuevoRecurso({...nuevoRecurso, fechaParte: e.target.value})} /></div>
                      <div className="tbl-col"><label className="tbl-form-label">Turno</label><select className="tbl-form-select" value={nuevoRecurso.turno} onChange={e => setNuevoRecurso({...nuevoRecurso, turno: e.target.value})}><option value="Día">Día</option><option value="Noche">Noche</option></select></div>
                      <div className="tbl-col"><label className="tbl-form-label">Zona de Trabajo</label><input type="text" className="tbl-form-control" placeholder="Ej. Tramo 15" value={nuevoRecurso.zonaTrabajo} onChange={e => setNuevoRecurso({...nuevoRecurso, zonaTrabajo: e.target.value})} /></div>
                    </div>
                    <div className="tbl-row tbl-mb-3">
                      <div className="tbl-col"><label className="tbl-form-label">Proveedor</label><input type="text" className="tbl-form-control" placeholder="Nombre de empresa" value={nuevoRecurso.proveedor} onChange={e => setNuevoRecurso({...nuevoRecurso, proveedor: e.target.value})} /></div>
                      <div className="tbl-col"><label className="tbl-form-label">Operador</label><input type="text" className="tbl-form-control" placeholder="Nombre del operador" value={nuevoRecurso.operador} onChange={e => setNuevoRecurso({...nuevoRecurso, operador: e.target.value})} /></div>
                    </div>
                    <div className="tbl-row tbl-mb-3">
                      <div className="tbl-col-3"><label className="tbl-form-label">Equipo</label><select className="tbl-form-select" value={nuevoRecurso.equipo} onChange={e => setNuevoRecurso({...nuevoRecurso, equipo: e.target.value})}><option value="TRACTOR">TRACTOR</option><option value="EXCAVADORA">EXCAVADORA</option><option value="RETROEXCAVADORA">RETROEXCAVADORA</option><option value="VOLQUETE">VOLQUETE</option><option value="MOTONIVELADORA">MOTONIVELADORA</option><option value="CAMIONETA">CAMIONETA</option><option value="OTRO">Otro...</option></select>{nuevoRecurso.equipo === 'OTRO' && (<input type="text" className="tbl-form-control tbl-mt-2" placeholder="Especificar equipo" value={nuevoRecurso.equipoOtro} onChange={e => setNuevoRecurso({...nuevoRecurso, equipoOtro: e.target.value})} />)}</div>
                      <div className="tbl-col-3"><label className="tbl-form-label">Marca</label><select className="tbl-form-select" value={nuevoRecurso.marca} onChange={e => setNuevoRecurso({...nuevoRecurso, marca: e.target.value})}><option value="CAT">CAT</option><option value="KOMATSU">KOMATSU</option><option value="DOOSAN">DOOSAN</option><option value="JOHN DEERE">JOHN DEERE</option><option value="VOLVO">VOLVO</option><option value="OTRO">Otro...</option></select>{nuevoRecurso.marca === 'OTRO' && (<input type="text" className="tbl-form-control tbl-mt-2" placeholder="Especificar marca" value={nuevoRecurso.marcaOtro} onChange={e => setNuevoRecurso({...nuevoRecurso, marcaOtro: e.target.value})} />)}</div>
                      <div className="tbl-col-3"><label className="tbl-form-label">Modelo / Placa</label><input type="text" className="tbl-form-control" placeholder="Ej. 320 / CAN737" value={nuevoRecurso.placa} onChange={e => setNuevoRecurso({...nuevoRecurso, placa: e.target.value})} /></div>
                      <div className="tbl-col-3"><label className="tbl-form-label">Precio Unit. (S/ HE)</label><input type="number" className="tbl-form-control" value={nuevoRecurso.precioUnitario} onChange={e => setNuevoRecurso({...nuevoRecurso, precioUnitario: e.target.value})} /></div>
                    </div>
                    <div className="tbl-row tbl-mb-3">
                      <div className="tbl-col"><label className="tbl-form-label">HM Inicio <span style={{color:'red'}}>*</span></label><input type="number" step="0.1" className="tbl-form-control" value={nuevoRecurso.hmInicio} onChange={e => setNuevoRecurso({...nuevoRecurso, hmInicio: e.target.value})} /></div>
                      <div className="tbl-col"><label className="tbl-form-label">HM Fin <span style={{color:'red'}}>*</span></label><input type="number" step="0.1" className="tbl-form-control" value={nuevoRecurso.hmFin} onChange={e => setNuevoRecurso({...nuevoRecurso, hmFin: e.target.value})} /></div>
                      <div className="tbl-col-auto" style={{display: 'flex', flexDirection: 'column', justifyContent: 'flex-end'}}><div style={{background: '#e0f2fe', color: '#0284c7', padding: '8px 12px', borderRadius: '4px', fontWeight: 'bold', fontSize: '13px', border: '1px solid #bae6fd'}}>Horas: {horasMaquina} h</div></div>
                      <div className="tbl-col"><label className="tbl-form-label">Combustible (Gls)</label><input type="number" className="tbl-form-control" value={nuevoRecurso.combustible} onChange={e => setNuevoRecurso({...nuevoRecurso, combustible: e.target.value})} /></div>
                      <div className="tbl-col"><label className="tbl-form-label">Vale N°</label><input type="text" className="tbl-form-control" value={nuevoRecurso.vale} onChange={e => setNuevoRecurso({...nuevoRecurso, vale: e.target.value})} /></div>
                    </div>
                    <div className="tbl-row tbl-mb-3">
                      <div className="tbl-col"><label className="tbl-form-label">Actividades Realizadas <span style={{color:'red'}}>*</span></label><input type="text" className="tbl-form-control" placeholder="Ej. Descolmatación..." value={nuevoRecurso.actividad} onChange={e => setNuevoRecurso({...nuevoRecurso, actividad: e.target.value})} /></div>
                      <div className="tbl-col"><label className="tbl-form-label">Observaciones</label><input type="text" className="tbl-form-control" placeholder="Condiciones del terreno, clima..." value={nuevoRecurso.observaciones} onChange={e => setNuevoRecurso({...nuevoRecurso, observaciones: e.target.value})} /></div>
                    </div>
                  </div>
                ) : nuevoRecurso.tipo === 'Personal' ? (
                  <div className="tbl-row tbl-mb-3">
                    <div className="tbl-col-3"><label className="tbl-form-label">Cargo</label><input type="text" className="tbl-form-control" placeholder="Ej. Peón, Operario..." value={nuevoRecurso.descripcion} onChange={e => setNuevoRecurso({...nuevoRecurso, descripcion: e.target.value})} /></div>
                    <div className="tbl-col-2"><label className="tbl-form-label">N° Personas</label><input type="number" min="1" className="tbl-form-control" value={nuevoRecurso.numPersonas} onChange={e => setNuevoRecurso({...nuevoRecurso, numPersonas: e.target.value})} /></div>
                    <div className="tbl-col-2"><label className="tbl-form-label">H. Normales</label><input type="number" min="0" className="tbl-form-control" value={nuevoRecurso.horasTrabajo} onChange={e => setNuevoRecurso({...nuevoRecurso, horasTrabajo: e.target.value})} /></div>
                    <div className="tbl-col-2"><label className="tbl-form-label">H. Extras</label><input type="number" min="0" className="tbl-form-control" value={nuevoRecurso.horasExtras} onChange={e => setNuevoRecurso({...nuevoRecurso, horasExtras: e.target.value})} /></div>
                    <div className="tbl-col-2"><label className="tbl-form-label">S/ por HH</label><input type="number" className="tbl-form-control" value={nuevoRecurso.precioUnitario} onChange={e => setNuevoRecurso({...nuevoRecurso, precioUnitario: e.target.value})} /></div>
                    <div className="tbl-col-1"><label className="tbl-form-label">Total</label><input type="text" className="tbl-form-control" disabled value={(nuevoRecurso.numPersonas * ((parseFloat(nuevoRecurso.horasTrabajo)||0) + (parseFloat(nuevoRecurso.horasExtras)||0))) || 0} style={{backgroundColor: '#e0f2fe', color: '#0284c7', fontWeight: 'bold'}} title="Total HH" /></div>
                  </div>
                ) : (
                  <div className="tbl-row tbl-mb-3">
                    <div className="tbl-col"><label className="tbl-form-label">Descripción del Insumo</label><input type="text" className="tbl-form-control" placeholder="Ej. Piedra chancada, Cemento..." value={nuevoRecurso.descripcion} onChange={e => setNuevoRecurso({...nuevoRecurso, descripcion: e.target.value})} /></div>
                    <div className="tbl-col-2"><label className="tbl-form-label">Cant.</label><input type="number" className="tbl-form-control" value={nuevoRecurso.cantidad} onChange={e => setNuevoRecurso({...nuevoRecurso, cantidad: e.target.value})} /></div>
                    <div className="tbl-col-2"><label className="tbl-form-label">Precio Unit. (S/)</label><input type="number" className="tbl-form-control" value={nuevoRecurso.precioUnitario} onChange={e => setNuevoRecurso({...nuevoRecurso, precioUnitario: e.target.value})} /></div>
                  </div>
                )}
                
                <div style={{display: 'flex', justifyContent: 'flex-end', marginBottom: '20px'}}>
                  <button className="tbl-btn tbl-btn-success" onClick={agregarRecurso}><FaPlus style={{marginRight:'5px'}}/> Agregar a la lista</button>
                </div>
                <div className="tbl-table-responsive tbl-border-top">
                  <table className="tbl-table tbl-table-vcenter">
                    <thead><tr><th>Tipo</th><th>Detalle (Resumen)</th><th className="tbl-text-end">Cantidad</th><th className="tbl-text-end">P. Unit.</th><th className="tbl-text-end">Total</th><th></th></tr></thead>
                    <tbody>
                      {recursos.length === 0 ? <tr><td colSpan="6" className="tbl-text-center tbl-text-muted py-4">Aún no hay registros para este incidente.</td></tr> : (
                        recursos.map(r => (
                          <tr key={r.idLocal}>
                            <td><span className="tbl-badge bg-secondary-lt">{r.tipo}</span></td>
                            <td style={{fontSize: '11px', whiteSpace: 'pre-wrap', maxWidth: '400px', lineHeight: '1.4'}}>{r.descripcionResumen || r.descripcion}</td>
                            <td className="tbl-text-end font-bold">{r.cantidad} <span style={{fontSize: '10px', marginLeft: '4px', color: '#626976'}}>{r.tipo === 'Personal' ? 'HH' : r.tipo === 'Maquinaria' ? 'HE' : 'Unid.'}</span></td>
                            <td className="tbl-text-end">S/ {parseFloat(r.precioUnitario).toFixed(2)}</td>
                            <td className="tbl-text-end text-blue font-bold">S/ {r.total.toFixed(2)}</td>
                            <td>
                              {r.guardadoEnDB ? (
                                <div style={{display: 'flex', gap: '8px', alignItems: 'center'}}>
                                  <span className="tbl-badge bg-green-lt">Guardado</span>
                                  {r.tipo === 'Maquinaria' && (<button type="button" onClick={() => abrirModalPdf(r.dbId)} className="tbl-btn-action text-blue" title="Ver Parte Diario (PDF)" style={{padding: '4px 8px', backgroundColor: '#e0f2fe', borderRadius: '4px', border: 'none', cursor: 'pointer', display: 'inline-flex'}}><FaFilePdf size={16} /></button>)}
                                </div>
                              ) : (<button className="tbl-btn-action text-danger" onClick={() => eliminarRecurso(r.idLocal)} title="Eliminar"><FaTimes/></button>)}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="tbl-modal-footer" style={{flexWrap:'wrap',gap:'8px'}}>
                <div className="tbl-text-start tbl-text-muted">Costo Total: <span style={{fontSize: '1.25rem', color: '#1e293b', fontWeight: 'bold'}}>S/ {costoTotalIncidente.toFixed(2)}</span></div>
                <div style={{display:'flex',gap:'8px',alignItems:'center',flexWrap:'wrap'}}>
                  <button className="tbl-btn" onClick={exportarPDF} style={{background:'#d63939',color:'#fff',border:'none',padding:'6px 14px',borderRadius:'4px',cursor:'pointer',fontSize:'13px',display:'flex',alignItems:'center',gap:'6px'}} title="Descargar PDF"><FaFilePdf/> PDF</button>
                  <button className="tbl-btn" onClick={exportarExcel} style={{background:'#2fb344',color:'#fff',border:'none',padding:'6px 14px',borderRadius:'4px',cursor:'pointer',fontSize:'13px',display:'flex',alignItems:'center',gap:'6px'}} title="Descargar Excel"><FaFileExcel/> Excel</button>
                  <button className="tbl-btn tbl-btn-link" onClick={() => setModalAbierto(false)}>Cerrar</button>
                  <button className="tbl-btn tbl-btn-primary" onClick={guardarCosteos} disabled={guardando}>{guardando ? <><FaSyncAlt className="icon-spin" style={{marginRight: '8px'}} /> Guardando...</> : <><FaSave style={{marginRight: '8px'}} /> Guardar Costeos</>}</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL PDF ──────────────────────────────────────────────────── */}
      {modalPdfAbierto && (
        <div className="tbl-modal-backdrop" onClick={() => setModalPdfAbierto(false)} style={{ zIndex: 9999, backgroundColor: 'rgba(0,0,0,0.75)' }}>
          <div className="tbl-modal-dialog" onClick={e => e.stopPropagation()} style={{ maxWidth: '850px', height: '90vh', display: 'flex', flexDirection: 'column', position: 'relative', zIndex: 10000, marginTop: '2vh' }}>
            <div className="tbl-modal-content" style={{ flex: 1, display: 'flex', flexDirection: 'column', boxShadow: '0 0 20px rgba(0,0,0,0.5)' }}>
              <div className="tbl-modal-header" style={{ borderBottom: '1px solid #e2e8f0', padding: '15px 20px', backgroundColor: '#f8fafc' }}>
                <h5 className="tbl-modal-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><FaFilePdf color="#dc2626" /> Visor de Documento PDF</h5>
                <button className="tbl-btn-close" onClick={() => setModalPdfAbierto(false)}><FaTimes/></button>
              </div>
              <div className="tbl-modal-body" style={{ flex: 1, padding: 0, overflow: 'hidden', backgroundColor: '#525659' }}>
                <iframe src={pdfUrlActivo} style={{ width: '100%', height: '100%', border: 'none' }} title="Visor PDF" />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL GALERÍA DE EVIDENCIAS ────────────────────────────────── */}
      {modalMediaAbierto && (
        <div onClick={() => setModalMediaAbierto(false)} style={{ position:'fixed',top:0,left:0,right:0,bottom:0,zIndex:10001,background:'rgba(0,0,0,0.92)',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center' }}>
          {/* Botón cerrar */}
          <button onClick={() => setModalMediaAbierto(false)} style={{ position:'absolute',top:'16px',right:'20px',background:'rgba(255,255,255,0.15)',border:'none',color:'#fff',fontSize:'22px',cursor:'pointer',borderRadius:'50%',width:'40px',height:'40px',display:'flex',alignItems:'center',justifyContent:'center',zIndex:10002 }}>✕</button>

          {/* Header con info del incidente */}
          {galeriaIncidente && (
            <div onClick={e=>e.stopPropagation()} style={{ color:'#fff',textAlign:'center',marginBottom:'16px',pointerEvents:'none' }}>
              <div style={{fontSize:'16px',fontWeight:'700'}}>{galeriaIncidente.tipo} — {galeriaIncidente.codigo}</div>
              <div style={{fontSize:'12px',color:'rgba(255,255,255,0.6)',marginTop:'2px'}}>{galeriaIncidente.lugar} · {galeriaIncidente.fecha}</div>
            </div>
          )}

          {cargandoMedia ? (
            <div style={{color:'#fff',fontSize:'14px',display:'flex',alignItems:'center',gap:'8px'}}><FaSyncAlt className="icon-spin"/> Cargando evidencias...</div>
          ) : galeriaMedia.length === 0 ? (
            <div style={{color:'rgba(255,255,255,0.5)',fontSize:'14px'}}>No se encontraron evidencias para este incidente.</div>
          ) : (
            <>
              {/* Media principal */}
              <div onClick={e=>e.stopPropagation()} style={{position:'relative',maxWidth:'90vw',maxHeight:'70vh',display:'flex',alignItems:'center',justifyContent:'center'}}>
                {galeriaMedia[galeriaIndex].type === 'image' ? (
                  <img src={galeriaMedia[galeriaIndex].src} alt="Evidencia" style={{maxWidth:'90vw',maxHeight:'70vh',objectFit:'contain',borderRadius:'8px'}} />
                ) : (
                  <video src={galeriaMedia[galeriaIndex].src} controls autoPlay style={{maxWidth:'90vw',maxHeight:'70vh',borderRadius:'8px',background:'#000'}} />
                )}
              </div>

              {/* Controles de navegación */}
              {galeriaMedia.length > 1 && (
                <div onClick={e=>e.stopPropagation()} style={{display:'flex',alignItems:'center',gap:'16px',marginTop:'16px'}}>
                  <button onClick={galeriaAnterior} disabled={galeriaIndex===0} style={{background:galeriaIndex===0?'rgba(255,255,255,0.1)':'rgba(255,255,255,0.2)',border:'none',color:'#fff',borderRadius:'50%',width:'40px',height:'40px',cursor:galeriaIndex===0?'default':'pointer',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'16px'}}><FaChevronLeft/></button>
                  
                  {/* Thumbnails */}
                  <div style={{display:'flex',gap:'6px',overflowX:'auto',maxWidth:'60vw',padding:'4px'}}>
                    {galeriaMedia.map((m,i) => (
                      <div key={i} onClick={()=>setGaleriaIndex(i)} style={{flexShrink:0,width:'56px',height:'56px',borderRadius:'6px',overflow:'hidden',border:i===galeriaIndex?'2px solid #fff':'2px solid transparent',cursor:'pointer',opacity:i===galeriaIndex?1:0.5,transition:'all 0.2s'}}>
                        {m.type === 'image' ? (
                          <img src={m.src} alt="" style={{width:'100%',height:'100%',objectFit:'cover'}} />
                        ) : (
                          <div style={{width:'100%',height:'100%',background:'#1e293b',display:'flex',alignItems:'center',justifyContent:'center',color:'#fff',fontSize:'18px'}}>▶</div>
                        )}
                      </div>
                    ))}
                  </div>

                  <button onClick={galeriaSiguiente} disabled={galeriaIndex===galeriaMedia.length-1} style={{background:galeriaIndex===galeriaMedia.length-1?'rgba(255,255,255,0.1)':'rgba(255,255,255,0.2)',border:'none',color:'#fff',borderRadius:'50%',width:'40px',height:'40px',cursor:galeriaIndex===galeriaMedia.length-1?'default':'pointer',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'16px'}}><FaChevronRight/></button>
                </div>
              )}

              {/* Contador */}
              <div style={{color:'rgba(255,255,255,0.5)',fontSize:'12px',marginTop:'8px'}}>{galeriaIndex+1} / {galeriaMedia.length} · {galeriaMedia[galeriaIndex].type === 'image' ? 'Foto' : 'Video'}</div>
            </>
          )}
        </div>
      )}

    </div>
  );
}

export default Incidentes;