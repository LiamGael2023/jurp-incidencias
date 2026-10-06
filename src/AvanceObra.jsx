// ─────────────────────────────────────────────────────────────────────────
//  AvanceObra — tablero de ejecución de obra
// ─────────────────────────────────────────────────────────────────────────
//
// QUÉ MIDE. Lo ejecutado, valorizado al precio del presupuesto:
//
//     ejecutado = Σ (metrado imputado en los partes × precio de la partida)
//
// Eso es lo que se le cobra al cliente. NO es lo que cuesta mover la
// máquina: ese es otro número y vive en el costeo de la incidencia.
// Mezclarlos es de donde salen las valorizaciones que no cuadran.
//
// LO QUE ESTE TABLERO NO DICE, Y SE DICE EN VOZ ALTA EN LA PANTALLA.
// No dice si la obra va atrasada. Para eso hace falta una curva programada,
// y el presupuesto NO la tiene: el Excel dice cuánto metrado hay que hacer,
// no en qué semana hay que hacerlo. Dos obras con el mismo 12 % pueden ir
// una adelantada y la otra tres meses tarde, y desde aquí no se distinguen.
//
// Por eso la curva sale sola, azul, y debajo lo dice. La alternativa —
// repartir el presupuesto en partes iguales entre un inicio y un plazo
// inventados y pintar una línea gris— produce un atraso o un adelanto que
// nadie midió, y que se acaba citando en una reunión como si fuera un dato.
// Un hueco que se ve es menos caro que un número que no es.
//
// CUANDO LLEGUE EL CRONOGRAMA valorizado, el endpoint devolverá `programado`
// con el acumulado por semana y aquí se pintan las dos curvas, el avance
// programado, y la variación. El sitio ya está hecho: la pantalla pregunta
// por `datos.programado` y mientras venga null muestra el aviso.
//
// LA SEMANA empieza en lunes, y la semana 1 es la del primer parte con
// partida imputada, salvo que se indique otra fecha de arranque.

import { useState, useEffect, useCallback, useRef } from 'react';
import ReactApexChart from 'react-apexcharts';
import ApexCharts from 'apexcharts';
import {
  FaChartLine, FaSyncAlt, FaFilePdf, FaExclamationTriangle, FaLayerGroup,
  FaCalendarAlt, FaInfoCircle, FaCubes,
} from 'react-icons/fa';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import Swal from 'sweetalert2';

const API_OPS = 'https://gideonstudio.duckdns.org/api/v1/mobile/operations';

const soles = (n) => 'S/ ' + (parseFloat(n) || 0).toLocaleString('es-PE',
  { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (n) => (parseFloat(n) || 0).toFixed(2) + ' %';
const diaCorto = (iso) => {
  if (!iso) return '';
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a.slice(2)}`;
};

export default function AvanceObra() {
  const [obras, setObras] = useState([]);
  const [obra, setObra] = useState('');
  const [inicio, setInicio] = useState('');
  const [datos, setDatos] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState('');
  const idGrafico = useRef('curva-s-obra');

  // ── carga ─────────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`${API_OPS}/partidas/obras/`);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const j = await r.json();
        const lista = Array.isArray(j) ? j : [];
        setObras(lista);
        if (lista.length && !obra) setObra(lista[0].obra);
      } catch (e) {
        setError('No se pudo leer la lista de obras con presupuesto cargado. ' + e.message);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cargar = useCallback(async () => {
    if (!obra) return;
    setCargando(true);
    setError('');
    try {
      const q = new URLSearchParams({ obra });
      if (inicio) q.set('inicio', inicio);
      const r = await fetch(`${API_OPS}/partidas/avance-obra/?${q}`);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      setDatos(await r.json());
    } catch (e) {
      setDatos(null);
      setError('No se pudo cargar el avance. ' + e.message);
    } finally {
      setCargando(false);
    }
  }, [obra, inicio]);

  useEffect(() => { cargar(); }, [cargar]);

  // ── PDF ───────────────────────────────────────────────────────────────
  const exportarPDF = async () => {
    if (!datos || !datos.hay_datos) {
      Swal.fire({ icon: 'info', title: 'Nada que exportar',
        text: 'Todavía no hay metrado imputado a partidas en esta obra.' });
      return;
    }
    // La curva se lleva tal como se ve: la imagen viene del propio gráfico,
    // no se vuelve a dibujar a mano. Si el gráfico no estuviera montado, el
    // PDF sale sin ella en vez de reventar.
    let img = null;
    try {
      const r = await ApexCharts.exec(idGrafico.current, 'dataURI');
      img = r && r.imgURI ? r.imgURI : null;
    } catch { img = null; }

    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const W = doc.internal.pageSize.getWidth();

    doc.setFillColor(20, 99, 165);
    doc.rect(0, 0, W, 22, 'F');
    doc.setTextColor(255); doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
    doc.text('ESTADO DE EJECUCIÓN DE OBRA', 12, 10);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
    doc.text(String(datos.proyecto || datos.obra || '').slice(0, 130), 12, 16.5);
    doc.setFontSize(8);
    doc.text('Emitido ' + new Date().toLocaleString('es-PE'), W - 12, 16.5, { align: 'right' });

    // Tarjetas
    let y = 29;
    const tarjetas = [
      ['Costo directo', soles(datos.costo_directo)],
      ['Ejecutado valorizado', soles(datos.ejecutado)],
      ['Avance', pct(datos.avance)],
      ['Saldo por ejecutar', soles((datos.costo_directo || 0) - (datos.ejecutado || 0))],
    ];
    const anchoT = (W - 24 - 3 * 4) / 4;
    tarjetas.forEach(([t, v], i) => {
      const x = 12 + i * (anchoT + 4);
      doc.setDrawColor(226, 232, 240); doc.setFillColor(248, 250, 252);
      doc.roundedRect(x, y, anchoT, 16, 2, 2, 'FD');
      doc.setTextColor(100, 116, 139); doc.setFontSize(7.5);
      doc.text(t.toUpperCase(), x + 4, y + 6);
      doc.setTextColor(30, 41, 59); doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
      doc.text(v, x + 4, y + 12.5);
      doc.setFont('helvetica', 'normal');
    });
    y += 21;

    if (img) {
      const h = 72;
      doc.addImage(img, 'PNG', 12, y, W - 24, h);
      y += h + 2;
    }
    // La advertencia viaja en el PDF. Si solo estuviera en la pantalla, el
    // papel saldría afirmando más de lo que el dato puede sostener.
    doc.setTextColor(180, 83, 9); doc.setFontSize(7.5);
    doc.text('La curva es acumulado EJECUTADO. No hay cronograma valorizado cargado, '
      + 'por lo que este documento NO indica atraso ni adelanto respecto a lo programado.',
      12, y + 3.5);

    autoTable(doc, {
      startY: y + 8,
      head: [['Código', 'Estructura', 'Presupuesto', 'Ejecutado', 'Saldo', '% avance']],
      body: (datos.estructuras || []).map(e => [
        e.codigo || '—', e.descripcion || '',
        soles(e.presupuesto), soles(e.ejecutado),
        soles((e.presupuesto || 0) - (e.ejecutado || 0)), pct(e.pct),
      ]),
      foot: [['', 'TOTAL', soles(datos.costo_directo), soles(datos.ejecutado),
        soles((datos.costo_directo || 0) - (datos.ejecutado || 0)), pct(datos.avance)]],
      // Solo en la última página. Por defecto autoTable repite el pie en
      // todas, y entonces la primera enseña un TOTAL de obra debajo de las
      // ocho filas que caben, que no suman eso: se lee como un descuadre.
      showFoot: 'lastPage',
      styles: { fontSize: 7.5, cellPadding: 1.6 },
      headStyles: { fillColor: [20, 99, 165], fontSize: 7.5 },
      footStyles: { fillColor: [241, 245, 249], textColor: [30, 41, 59], fontStyle: 'bold' },
      columnStyles: {
        0: { cellWidth: 20 },
        2: { halign: 'right' }, 3: { halign: 'right' },
        4: { halign: 'right' }, 5: { halign: 'right' },
      },
      margin: { left: 12, right: 12 },
    });

    // El valorizado por semana va también al papel: es el detalle que
    // sostiene la curva, y sin él el PDF solo enseña un dibujo.
    autoTable(doc, {
      startY: (doc.lastAutoTable ? doc.lastAutoTable.finalY : y) + 7,
      head: [['Sem', 'Período', 'De la semana', 'Acumulado', '% acum.']],
      body: semanas.map(s => [
        'S' + s.n, `${diaCorto(s.desde)} – ${diaCorto(s.hasta)}`,
        soles(s.ejecutado), soles(s.acumulado), pct(s.pct),
      ]),
      styles: { fontSize: 7.5, cellPadding: 1.6 },
      headStyles: { fillColor: [71, 85, 105], fontSize: 7.5 },
      // Ancho fijo: cinco columnas estiradas a los 297 mm del A4 apaisado
      // dejan el encabezado en un extremo y la cifra en el otro, y hay que
      // cruzar media hoja con el dedo para leer una fila.
      tableWidth: 150,
      columnStyles: {
        0: { cellWidth: 13 }, 1: { cellWidth: 37 },
        2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' },
      },
      margin: { left: 12, right: 12 },
    });

    const avisos = [];
    if (datos.metrado_otra_unidad)
      avisos.push(`${datos.metrado_otra_unidad} de metrado imputado en una unidad distinta `
        + 'a la de su partida: no se valorizó.');
    if (datos.actividades_sin_fecha)
      avisos.push(`${datos.actividades_sin_fecha} actividad(es) sin fecha de parte: `
        + 'cuentan en el total pero no en la curva.');
    if (avisos.length) {
      let yy = (doc.lastAutoTable ? doc.lastAutoTable.finalY : y) + 5;
      doc.setTextColor(185, 28, 28); doc.setFontSize(7.5);
      avisos.forEach(a => { doc.text('• ' + a, 12, yy); yy += 4; });
    }

    doc.save(`avance-obra-${datos.obra || 'obra'}-${new Date().toISOString().slice(0, 10)}.pdf`);
  };

  // ── gráfico ───────────────────────────────────────────────────────────
  const semanas = (datos && datos.semanas) || [];
  const cd = (datos && datos.costo_directo) || 0;
  const cima = semanas.length ? semanas[semanas.length - 1].acumulado : 0;
  // Un 15 % de aire encima de la curva para que el último punto no quede
  // tocando el borde, y nunca más allá del costo directo.
  const topeEje = Math.max(1, Math.min(cd || cima * 1.15, cima * 1.15 || 1));
  const topePct = cd ? (topeEje / cd) * 100 : 0;
  const grafico = {
    options: {
      chart: { id: idGrafico.current, type: 'area', toolbar: { show: false },
        fontFamily: 'inherit', animations: { enabled: false } },
      stroke: { curve: 'smooth', width: 3 },
      fill: { type: 'gradient',
        gradient: { shadeIntensity: 1, opacityFrom: 0.35, opacityTo: 0.03, stops: [0, 95] } },
      colors: ['#1463A5'],
      dataLabels: { enabled: false },
      grid: { borderColor: '#e2e8f0', strokeDashArray: 3 },
      xaxis: {
        categories: semanas.map(s => `S${s.n}`),
        labels: { style: { fontSize: '11px', colors: '#64748b' } },
        axisBorder: { color: '#e2e8f0' }, axisTicks: { color: '#e2e8f0' },
      },
      yaxis: {
        // El eje se ajusta a lo ejecutado, NO al costo directo entero.
        //
        // Al principio de obra la curva contra el 100 % sale pegada al suelo:
        // una raya plana que no dice nada, y lo que hay que ver aquí es el
        // ritmo. Pero una curva autoescalada se lee sola como si la obra
        // estuviera llena, así que arriba se escribe hasta dónde llega el eje
        // en por ciento de la obra. Cuando la obra ya va avanzada el tope es
        // el costo directo y la escala vuelve a ser la absoluta.
        min: 0,
        max: topeEje,
        labels: {
          style: { fontSize: '11px', colors: '#64748b' },
          formatter: (v) => 'S/ ' + (v >= 1000 ? Math.round(v / 1000) + 'k'
            : Math.round(v)),
        },
      },
      tooltip: {
        shared: true,
        custom: ({ dataPointIndex }) => {
          const s = semanas[dataPointIndex];
          if (!s) return '';
          return `<div style="padding:8px 11px;font-size:12px">
            <b>Semana ${s.n}</b> &nbsp;<span style="color:#64748b">${diaCorto(s.desde)} – ${diaCorto(s.hasta)}</span>
            <div style="margin-top:5px">De la semana: <b>${soles(s.ejecutado)}</b></div>
            <div>Acumulado: <b>${soles(s.acumulado)}</b> (${pct(s.pct)})</div>
          </div>`;
        },
      },
      legend: { show: false },
    },
    series: [{ name: 'Ejecutado acumulado', data: semanas.map(s => s.acumulado) }],
  };

  // ── pintado ───────────────────────────────────────────────────────────
  const saldo = datos ? (datos.costo_directo || 0) - (datos.ejecutado || 0) : 0;
  const conEjec = (datos && datos.estructuras || []).filter(e => (e.ejecutado || 0) > 0).length;

  const Tarjeta = ({ titulo, valor, pie, color, icono }) => (
    <div style={{ flex:'1 1 190px', minWidth:'190px', background:'#fff', border:'1px solid #e2e8f0',
      borderRadius:'10px', padding:'14px 16px', borderTop:`3px solid ${color}` }}>
      <div style={{ display:'flex', alignItems:'center', gap:'7px', fontSize:'11px', fontWeight:700,
        letterSpacing:'.03em', color:'#64748b', textTransform:'uppercase' }}>
        {icono} {titulo}
      </div>
      <div style={{ fontSize:'23px', fontWeight:800, color:'#1e293b', marginTop:'7px', lineHeight:1.1 }}>
        {valor}
      </div>
      {pie && <div style={{ fontSize:'11.5px', color:'#94a3b8', marginTop:'4px' }}>{pie}</div>}
    </div>
  );

  return (
    /* Las clases del shell, no padding propio: el rail lateral FLOTA encima
       del contenido y es .tbl-page-header/.tbl-page-body quien lo aparta con
       --rail-w, y quien en móvil recupera el ancho cuando el rail baja a
       barra inferior. Con un contenedor propio la cabecera quedaría debajo
       del menú, que es el mismo tropiezo del modal de Maquinaria. */
    <div className="tbl-page-wrapper">

      {/* Cabecera */}
      <div className="tbl-page-header" style={{ display:'flex', alignItems:'flex-end',
        justifyContent:'space-between', gap:'14px', flexWrap:'wrap' }}>
        <div>
          <div className="tbl-page-pretitle">Control de obra</div>
          <h2 className="tbl-page-title" style={{ display:'flex', alignItems:'center', gap:'9px' }}>
            <FaChartLine color="#1463A5" /> Estado de ejecución de obra
          </h2>
          <div style={{ fontSize:'12.5px', color:'#64748b', marginTop:'3px' }}>
            {datos && datos.proyecto
              ? datos.proyecto
              : 'Metrado imputado en los partes, valorizado al precio del presupuesto.'}
          </div>
        </div>
        <div style={{ display:'flex', gap:'9px', alignItems:'flex-end', flexWrap:'wrap' }}>
          <label style={{ fontSize:'11px', fontWeight:700, color:'#64748b' }}>
            <div style={{ marginBottom:'4px' }}>OBRA</div>
            <select value={obra} onChange={e => setObra(e.target.value)}
              style={{ padding:'8px 10px', border:'1px solid #cbd5e1', borderRadius:'7px',
                fontSize:'13px', minWidth:'180px', background:'#fff' }}>
              {obras.length === 0 && <option value="">— sin presupuesto cargado —</option>}
              {obras.map(o => (
                <option key={o.obra} value={o.obra}>{o.obra} ({o.partidas})</option>
              ))}
            </select>
          </label>
          <label style={{ fontSize:'11px', fontWeight:700, color:'#64748b' }}>
            <div style={{ marginBottom:'4px' }}>ARRANQUE SEMANA 1</div>
            <input type="date" value={inicio} onChange={e => setInicio(e.target.value)}
              style={{ padding:'8px 10px', border:'1px solid #cbd5e1', borderRadius:'7px',
                fontSize:'13px', background:'#fff' }} />
          </label>
          <button onClick={cargar} disabled={cargando}
            style={{ display:'inline-flex', alignItems:'center', gap:'7px', background:'#fff',
              color:'#1463A5', border:'1px solid #bfdbfe', borderRadius:'7px', padding:'9px 13px',
              fontSize:'12.5px', fontWeight:600, cursor:'pointer' }}>
            <FaSyncAlt size={11} className={cargando ? 'icon-spin' : ''} /> Actualizar
          </button>
          <button onClick={exportarPDF}
            style={{ display:'inline-flex', alignItems:'center', gap:'7px', background:'#1463A5',
              color:'#fff', border:'none', borderRadius:'7px', padding:'9px 14px',
              fontSize:'12.5px', fontWeight:600, cursor:'pointer' }}>
            <FaFilePdf size={12} /> PDF
          </button>
        </div>
      </div>

      <div className="tbl-page-body">

      {error && (
        <div style={{ background:'#fef2f2', border:'1px solid #fecaca', borderRadius:'8px',
          padding:'11px 14px', fontSize:'12.5px', color:'#b91c1c', marginBottom:'14px',
          display:'flex', gap:'8px', alignItems:'flex-start' }}>
          <FaExclamationTriangle style={{ marginTop:'2px', flexShrink:0 }} /> <span>{error}</span>
        </div>
      )}

      {cargando && !datos && (
        <div style={{ padding:'50px', textAlign:'center', color:'#64748b', fontSize:'13px' }}>
          <FaSyncAlt className="icon-spin" style={{ marginRight:'8px' }} /> Calculando el avance…
        </div>
      )}

      {datos && datos.hay_datos === false && (
        <div style={{ background:'#fffbeb', border:'1px solid #fde68a', borderRadius:'10px',
          padding:'24px', fontSize:'13px', color:'#92400e', lineHeight:1.6 }}>
          <b style={{ display:'flex', alignItems:'center', gap:'8px', marginBottom:'6px' }}>
            <FaInfoCircle /> Todavía no hay avance que mostrar
          </b>
          {datos.partidas
            ? <>El presupuesto está cargado ({datos.partidas} partidas), pero ninguna actividad
                de los partes tiene partida imputada aún. En el parte diario, cada actividad
                se enlaza a su partida con el selector en escalera; en cuanto haya metrado
                imputado, esta pantalla empieza a llenarse.</>
            : <>Esta obra no tiene presupuesto cargado.</>}
        </div>
      )}

      {datos && datos.hay_datos && (
        <>
          {/* Tarjetas */}
          <div style={{ display:'flex', gap:'12px', flexWrap:'wrap', marginBottom:'14px' }}>
            <Tarjeta titulo="Costo directo" valor={soles(datos.costo_directo)}
              pie={`${datos.partidas} partidas`} color="#64748b" icono={<FaCubes size={10} />} />
            <Tarjeta titulo="Ejecutado valorizado" valor={soles(datos.ejecutado)}
              pie={`${datos.semana_actual} semana(s) con movimiento`} color="#1463A5"
              icono={<FaChartLine size={10} />} />
            <Tarjeta titulo="Avance" valor={pct(datos.avance)}
              pie="del costo directo" color="#059669" icono={<FaLayerGroup size={10} />} />
            <Tarjeta titulo="Saldo por ejecutar" valor={soles(saldo)}
              pie={pct(100 - (datos.avance || 0)) + ' restante'} color="#d97706"
              icono={<FaCalendarAlt size={10} />} />
          </div>

          {/* Barra general */}
          <div style={{ background:'#fff', border:'1px solid #e2e8f0', borderRadius:'10px',
            padding:'14px 16px', marginBottom:'14px' }}>
            <div style={{ display:'flex', justifyContent:'space-between', fontSize:'12px',
              color:'#64748b', marginBottom:'7px' }}>
              <span>Avance físico valorizado</span>
              <span style={{ fontWeight:700, color:'#1463A5' }}>{pct(datos.avance)}</span>
            </div>
            <div style={{ height:'13px', background:'#f1f5f9', borderRadius:'7px', overflow:'hidden' }}>
              <div style={{ width:`${Math.min(100, datos.avance || 0)}%`, height:'100%',
                background:'linear-gradient(90deg,#1463A5,#38bdf8)', borderRadius:'7px' }} />
            </div>
          </div>

          {/* Curva */}
          <div style={{ background:'#fff', border:'1px solid #e2e8f0', borderRadius:'10px',
            padding:'14px 16px 6px', marginBottom:'14px' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center',
              gap:'10px', flexWrap:'wrap', marginBottom:'4px' }}>
              <div style={{ fontSize:'14px', fontWeight:700, color:'#1e293b' }}>
                Curva de avance acumulado
              </div>
              <div style={{ fontSize:'11.5px', color:'#94a3b8' }}>
                Semana 1 desde {semanas.length ? diaCorto(semanas[0].desde) : '—'}
                {' · '}arranque: {datos.arranque}
              </div>
            </div>
            {/* Hasta dónde llega el eje, en obra. Sin esto, una curva
                autoescalada que sube hasta arriba se lee como obra llena. */}
            <div style={{ fontSize:'11.5px', color:'#64748b', marginTop:'2px' }}>
              El eje llega a <b>{soles(topeEje)}</b>, que es el{' '}
              <b>{pct(topePct)}</b> del costo directo. La escala está ajustada a
              lo ejecutado para que se vea el ritmo.
            </div>
            <ReactApexChart options={grafico.options} series={grafico.series}
              type="area" height={310} />

            {/* El hueco del programado, dicho. No se dibuja una curva gris
                inventada porque un atraso que nadie midió es peor que un
                atraso que no se sabe. */}
            {!datos.programado && (
              <div style={{ margin:'0 0 12px', background:'#fffbeb', border:'1px solid #fde68a',
                borderRadius:'8px', padding:'11px 13px', fontSize:'12px', color:'#92400e',
                lineHeight:1.55, display:'flex', gap:'9px', alignItems:'flex-start' }}>
                <FaInfoCircle style={{ marginTop:'2px', flexShrink:0 }} />
                <span>
                  Esta curva es <b>solo lo ejecutado</b>. Dice cuánto llevas y a qué ritmo,
                  pero <b>no si vas atrasado</b>: el presupuesto dice cuánto metrado hay que
                  hacer, no en qué semana. Falta cargar el <b>cronograma valorizado</b> —
                  o indicar fecha de inicio y plazo— para pintar la curva programada y
                  recién entonces hablar de atraso o adelanto.
                </span>
              </div>
            )}
          </div>

          {/* Avisos de datos */}
          {(datos.metrado_otra_unidad > 0 || datos.actividades_sin_fecha > 0) && (
            <div style={{ background:'#fef2f2', border:'1px solid #fecaca', borderRadius:'10px',
              padding:'12px 15px', marginBottom:'14px', fontSize:'12px', color:'#b91c1c',
              lineHeight:1.6 }}>
              <b style={{ display:'flex', alignItems:'center', gap:'7px', marginBottom:'4px' }}>
                <FaExclamationTriangle /> Metrado que no se pudo contar
              </b>
              {datos.metrado_otra_unidad > 0 && (
                <div>• <b>{datos.metrado_otra_unidad}</b> de metrado imputado en una unidad
                  distinta a la de su partida. No se valorizó: sumar m³ con m² daría un
                  avance falso. Corrige la unidad en esas actividades.</div>
              )}
              {datos.actividades_sin_fecha > 0 && (
                <div>• <b>{datos.actividades_sin_fecha}</b> actividad(es) cuyo parte no tiene
                  fecha. Cuentan en el total pero no caen en ninguna semana de la curva.</div>
              )}
            </div>
          )}

          {/* Estructuras */}
          <div style={{ background:'#fff', border:'1px solid #e2e8f0', borderRadius:'10px',
            overflow:'hidden' }}>
            <div style={{ padding:'13px 16px', borderBottom:'1px solid #e2e8f0',
              display:'flex', justifyContent:'space-between', alignItems:'center',
              gap:'10px', flexWrap:'wrap' }}>
              <div style={{ fontSize:'14px', fontWeight:700, color:'#1e293b' }}>
                Avance por estructura
              </div>
              <div style={{ fontSize:'11.5px', color:'#94a3b8' }}>
                {conEjec} de {(datos.estructuras || []).length} con ejecución
              </div>
            </div>
            <div style={{ overflowX:'auto' }}>
              <table style={{ width:'100%', minWidth:'760px', borderCollapse:'collapse',
                fontSize:'12.5px' }}>
                <thead>
                  <tr style={{ background:'#f8fafc', color:'#64748b', fontSize:'11px',
                    textTransform:'uppercase', letterSpacing:'.03em' }}>
                    <th style={{ textAlign:'left', padding:'9px 14px', fontWeight:700 }}>Código</th>
                    <th style={{ textAlign:'left', padding:'9px 10px', fontWeight:700 }}>Estructura</th>
                    <th style={{ textAlign:'right', padding:'9px 10px', fontWeight:700 }}>Presupuesto</th>
                    <th style={{ textAlign:'right', padding:'9px 10px', fontWeight:700 }}>Ejecutado</th>
                    <th style={{ textAlign:'right', padding:'9px 10px', fontWeight:700 }}>Saldo</th>
                    <th style={{ textAlign:'left', padding:'9px 14px', fontWeight:700, width:'190px' }}>Avance</th>
                  </tr>
                </thead>
                <tbody>
                  {(datos.estructuras || []).map(e => {
                    const p = Math.min(100, e.pct || 0);
                    const pasada = (e.pct || 0) > 100;
                    return (
                      <tr key={e.codigo || e.descripcion}
                        style={{ borderTop:'1px solid #f1f5f9',
                          background: (e.ejecutado || 0) > 0 ? '#fff' : '#fcfdfe' }}>
                        <td style={{ padding:'9px 14px', fontFamily:'monospace', fontSize:'11.5px',
                          color:'#64748b', whiteSpace:'nowrap' }}>{e.codigo || '—'}</td>
                        <td style={{ padding:'9px 10px', color:'#1e293b', fontWeight:600 }}>
                          {e.descripcion}
                        </td>
                        <td style={{ padding:'9px 10px', textAlign:'right', color:'#64748b',
                          whiteSpace:'nowrap' }}>{soles(e.presupuesto)}</td>
                        <td style={{ padding:'9px 10px', textAlign:'right', fontWeight:700,
                          color:(e.ejecutado || 0) > 0 ? '#1463A5' : '#cbd5e1',
                          whiteSpace:'nowrap' }}>{soles(e.ejecutado)}</td>
                        <td style={{ padding:'9px 10px', textAlign:'right', color:'#64748b',
                          whiteSpace:'nowrap' }}>
                          {soles((e.presupuesto || 0) - (e.ejecutado || 0))}
                        </td>
                        <td style={{ padding:'9px 14px' }}>
                          <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
                            <div style={{ flex:1, height:'8px', background:'#f1f5f9',
                              borderRadius:'5px', overflow:'hidden', minWidth:'70px' }}>
                              <div style={{ width:`${p}%`, height:'100%', borderRadius:'5px',
                                background: pasada ? '#dc2626' : '#1463A5' }} />
                            </div>
                            <span style={{ fontSize:'11.5px', fontWeight:700, minWidth:'52px',
                              textAlign:'right', color: pasada ? '#dc2626' : '#475569' }}>
                              {pct(e.pct)}
                            </span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr style={{ background:'#f8fafc', borderTop:'2px solid #e2e8f0',
                    fontWeight:800, color:'#1e293b' }}>
                    <td style={{ padding:'10px 14px' }} />
                    <td style={{ padding:'10px' }}>TOTAL</td>
                    <td style={{ padding:'10px', textAlign:'right', whiteSpace:'nowrap' }}>
                      {soles(datos.costo_directo)}</td>
                    <td style={{ padding:'10px', textAlign:'right', color:'#1463A5',
                      whiteSpace:'nowrap' }}>{soles(datos.ejecutado)}</td>
                    <td style={{ padding:'10px', textAlign:'right', whiteSpace:'nowrap' }}>
                      {soles(saldo)}</td>
                    <td style={{ padding:'10px 14px' }}>{pct(datos.avance)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* Detalle semanal */}
          <div style={{ background:'#fff', border:'1px solid #e2e8f0', borderRadius:'10px',
            overflow:'hidden', marginTop:'14px' }}>
            <div style={{ padding:'13px 16px', borderBottom:'1px solid #e2e8f0',
              fontSize:'14px', fontWeight:700, color:'#1e293b' }}>
              Valorizado por semana
            </div>
            <div style={{ overflowX:'auto' }}>
              <table style={{ width:'100%', minWidth:'560px', borderCollapse:'collapse',
                fontSize:'12.5px' }}>
                <thead>
                  <tr style={{ background:'#f8fafc', color:'#64748b', fontSize:'11px',
                    textTransform:'uppercase', letterSpacing:'.03em' }}>
                    <th style={{ textAlign:'left', padding:'9px 14px', fontWeight:700 }}>Sem</th>
                    <th style={{ textAlign:'left', padding:'9px 10px', fontWeight:700 }}>Período</th>
                    <th style={{ textAlign:'right', padding:'9px 10px', fontWeight:700 }}>De la semana</th>
                    <th style={{ textAlign:'right', padding:'9px 10px', fontWeight:700 }}>Acumulado</th>
                    <th style={{ textAlign:'right', padding:'9px 14px', fontWeight:700 }}>% acum.</th>
                  </tr>
                </thead>
                <tbody>
                  {semanas.map(s => (
                    <tr key={s.n} style={{ borderTop:'1px solid #f1f5f9',
                      background:(s.ejecutado || 0) > 0 ? '#fff' : '#fcfdfe' }}>
                      <td style={{ padding:'8px 14px', fontWeight:700, color:'#475569' }}>S{s.n}</td>
                      <td style={{ padding:'8px 10px', color:'#64748b', whiteSpace:'nowrap' }}>
                        {diaCorto(s.desde)} – {diaCorto(s.hasta)}
                      </td>
                      <td style={{ padding:'8px 10px', textAlign:'right',
                        color:(s.ejecutado || 0) > 0 ? '#1e293b' : '#cbd5e1',
                        whiteSpace:'nowrap' }}>{soles(s.ejecutado)}</td>
                      <td style={{ padding:'8px 10px', textAlign:'right', fontWeight:700,
                        color:'#1463A5', whiteSpace:'nowrap' }}>{soles(s.acumulado)}</td>
                      <td style={{ padding:'8px 14px', textAlign:'right', color:'#64748b' }}>
                        {pct(s.pct)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div style={{ fontSize:'11.5px', color:'#94a3b8', marginTop:'12px', lineHeight:1.6 }}>
            El ejecutado se valoriza al precio unitario del presupuesto (metrado imputado ×
            precio de la partida). No es el costo de operar la maquinaria, que se calcula
            aparte en la incidencia. La semana empieza en lunes.
          </div>
        </>
      )}
      </div>
    </div>
  );
}
