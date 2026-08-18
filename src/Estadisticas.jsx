import { useState, useEffect } from 'react';
import { FaSyncAlt, FaExclamationTriangle, FaCheckCircle, FaClock, FaClipboardList, FaThermometerHalf, FaTint, FaCloudRain, FaChartBar } from 'react-icons/fa';
import ReactApexChart from 'react-apexcharts';
import './Incidentes.css';
import './EstadisticasGIS.css';

const COLORS_TIPO = ['#1268C3','#f76707','#d63939','#2fb344','#ae3ec9','#f59f00'];
const COLORS_GRAVEDAD = {'lev':'#2fb344','mod':'#f76707','gra':'#d63939'};
const COLORS_ESTADO = {'pat':'#f59f00','ate':'#1268C3','cer':'#2fb344'};

const FUENTE = "'Inter', -apple-system, BlinkMacSystemFont, sans-serif";

/* Opciones base de las donas: leyenda abajo y total al centro. */
const opcionesDona = (labels, colors) => ({
  chart: { type: 'donut', fontFamily: FUENTE, toolbar: { show: false }, animations: { speed: 500 } },
  labels,
  colors,
  stroke: { width: 2, colors: ['#fff'] },
  dataLabels: {
    enabled: true,
    style: { fontSize: '12px', fontWeight: 700, fontFamily: FUENTE },
    dropShadow: { enabled: false },
    formatter: (val) => `${Math.round(val)}%`,
  },
  legend: {
    position: 'bottom',
    horizontalAlign: 'center',
    fontSize: '12px',
    fontWeight: 600,
    fontFamily: FUENTE,
    labels: { colors: '#5b7590' },
    markers: { width: 9, height: 9, radius: 9 },
    itemMargin: { horizontal: 8, vertical: 3 },
  },
  plotOptions: {
    pie: {
      donut: {
        size: '62%',
        labels: {
          show: true,
          name: { fontSize: '12px', fontWeight: 600, color: '#7b93ad', offsetY: -4 },
          value: { fontSize: '26px', fontWeight: 800, color: '#0B2A5B', offsetY: 2 },
          total: {
            show: true,
            showAlways: true,
            label: 'Total',
            color: '#7b93ad',
            fontSize: '11px',
            fontWeight: 700,
            formatter: (w) => w.globals.seriesTotals.reduce((a, b) => a + b, 0),
          },
        },
      },
    },
  },
  tooltip: {
    style: { fontSize: '12px', fontFamily: FUENTE },
    y: { formatter: (v) => `${v} incidente${v !== 1 ? 's' : ''}` },
  },
  states: { hover: { filter: { type: 'lighten', value: 0.08 } } },
  noData: { text: 'Sin datos', style: { color: '#7b93ad', fontSize: '13px', fontFamily: FUENTE } },
});

/* Opciones base de las barras: degradado azul → celeste. */
const opcionesBarras = (categorias, { unidad = '', rotarEtiquetas = false, decimales = false } = {}) => ({
  chart: { type: 'bar', fontFamily: FUENTE, toolbar: { show: false }, animations: { speed: 500 } },
  colors: ['#1268C3'],
  fill: {
    type: 'gradient',
    gradient: {
      shade: 'light', type: 'vertical', shadeIntensity: 0.2,
      gradientToColors: ['#35B6E9'], inverseColors: true,
      opacityFrom: 1, opacityTo: 1, stops: [0, 100],
    },
  },
  plotOptions: { bar: { borderRadius: 6, borderRadiusApplication: 'end', columnWidth: '55%' } },
  dataLabels: { enabled: false },
  grid: {
    borderColor: '#e2ecf6', strokeDashArray: 4,
    xaxis: { lines: { show: false } },
    yaxis: { lines: { show: true } },
    padding: { left: 4, right: 8 },
  },
  xaxis: {
    categories: categorias,
    axisBorder: { color: '#c9dff2' },
    axisTicks: { show: false },
    labels: {
      style: { colors: '#5b7590', fontSize: '11px', fontFamily: FUENTE },
      rotate: rotarEtiquetas ? -45 : 0,
      rotateAlways: rotarEtiquetas,
      hideOverlappingLabels: true,
    },
  },
  yaxis: {
    labels: {
      style: { colors: '#5b7590', fontSize: '11px', fontFamily: FUENTE },
      formatter: (v) => (decimales ? Number(v).toFixed(1) : Math.round(v)) + unidad,
    },
  },
  tooltip: {
    style: { fontSize: '12px', fontFamily: FUENTE },
    y: { formatter: (v) => `${decimales ? Number(v).toFixed(1) : v}${unidad}` },
  },
  states: { hover: { filter: { type: 'darken', value: 0.92 } } },
  noData: { text: 'Sin datos', style: { color: '#7b93ad', fontSize: '13px', fontFamily: FUENTE } },
});

function Estadisticas() {
  const [subMenu, setSubMenu] = useState('incidentes');
  const [incidentes, setIncidentes] = useState([]);
  const [estaciones, setEstaciones] = useState([]);
  const [lluviaChart, setLluviaChart] = useState([]);
  const [estacionSeleccionada, setEstacionSeleccionada] = useState(null);
  const [rangoSel, setRangoSel] = useState('hoy');   // 'hoy' | 7 | 15 | 30
  // Resumen de la última lluvia del día (solo en modo 'hoy').
  const [detalleHoy, setDetalleHoy] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [cargandoLluvia, setCargandoLluvia] = useState(false);

  const token = () => localStorage.getItem('userToken');

  // ── Cargar incidentes ─────────────────────────────────────────────────
  const cargarIncidentes = async () => {
    try {
      const res = await fetch('/api/v1/mobile/hi-incidents/list/', { headers: { 'Content-Type':'application/json', 'Authorization':`Token ${token()}` } });
      if (res.ok) { const d = await res.json(); setIncidentes(d.results || []); }
    } catch(e) { console.error(e); }
  };

  // ── Cargar estaciones (pluviómetros + Davis) ──────────────────────────
  const cargarEstaciones = async () => {
    try {
      const [r1, r2] = await Promise.all([
        fetch('/api/v1/mobile/devices/?device_type=pluviometro', { headers: { 'Authorization':`Token ${token()}` } }),
        fetch('/api/v1/mobile/devices/?device_type=estacion_davis', { headers: { 'Authorization':`Token ${token()}` } })
      ]);
      let all = [];
      if (r1.ok) { const d = await r1.json(); all.push(...(d.results||[])); }
      if (r2.ok) { const d = await r2.json(); all.push(...(d.results||[])); }

      // Cargar métricas actuales para cada estación
      const now = new Date();
      const past24h = new Date(now.getTime() - 24*60*60*1000);
      const fmt = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

      const enriched = await Promise.all(all.map(async (eq) => {
        let totalRain = 0, temp = '--', hum = '--';
        try {
          const [rR, rT, rH] = await Promise.all([
            fetch(`/api/v1/mobile/davis/rain-gauges/filtered-data/?start_date=${fmt(now)}&end_date=${fmt(now)}&station_id=${eq.id}&metric=rainfall_mm&max_points=9000`, { headers:{'Authorization':`Token ${token()}`} }),
            fetch(`/api/v1/mobile/davis/rain-gauges/filtered-data/?start_date=${fmt(past24h)}&end_date=${fmt(now)}&station_id=${eq.id}&metric=temp_out`, { headers:{'Authorization':`Token ${token()}`} }),
            fetch(`/api/v1/mobile/davis/rain-gauges/filtered-data/?start_date=${fmt(past24h)}&end_date=${fmt(now)}&station_id=${eq.id}&metric=hum_out`, { headers:{'Authorization':`Token ${token()}`} }),
          ]);
          // Acumulado del DÍA ACTUAL. Se prefiere 'total_precipitation', que
          // lo calcula el servidor; si no viene, se suma la serie del día.
          if (rR.ok) {
            const d = await rR.json();
            if (typeof d.total_precipitation === 'number') {
              totalRain = d.total_precipitation;
            } else {
              for (const r of (d.data||[])) {
                if (new Date(r.timestamp).toDateString() !== now.toDateString()) continue;
                totalRain += parseFloat(r.value)||0;
              }
            }
          }
          if (rT.ok) { const d = await rT.json(); const recs = d.data||[]; if(recs.length) temp = parseFloat(recs[recs.length-1].value).toFixed(1); }
          if (rH.ok) { const d = await rH.json(); const recs = d.data||[]; if(recs.length) hum = parseFloat(recs[recs.length-1].value).toFixed(1); }

          // Plan B: metrics endpoint
          if (temp === '--' || hum === '--') {
            const rM = await fetch(`/api/v1/mobile/devices/${eq.id}/metrics/`, { headers:{'Authorization':`Token ${token()}`} });
            if (rM.ok) {
              const mData = await rM.json();
              const metrics = mData.results || (Array.isArray(mData) ? mData : []);
              for (const m of metrics) {
                const code = m.code || m.metric || '';
                if ((code === 'temp_out' || code === 'temp') && temp === '--') temp = parseFloat(m.value).toFixed(1);
                if ((code === 'hum_out' || code === 'hum') && hum === '--') hum = parseFloat(m.value).toFixed(1);
              }
            }
          }
        } catch(e) { /* silencioso */ }
        return { ...eq, totalRain, temp, hum, isCritical: totalRain > 20 };
      }));

      setEstaciones(enriched);
      if (enriched.length > 0 && !estacionSeleccionada) setEstacionSeleccionada(enriched[0].id);
    } catch(e) { console.error(e); }
  };

  // ── Cargar datos de lluvia para gráfico ───────────────────────────────
  const cargarLluviaChart = async (stationId, rango) => {
    if (!stationId) return;
    setCargandoLluvia(true);
    try {
      const now = new Date();
      const fmt = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      const esHoy = rango === 'hoy';
      const dias = esHoy ? 1 : rango;
      const past = new Date(now.getTime() - (dias - 1) * 24 * 60 * 60 * 1000);

      // ── Rango de varios días ──────────────────────────────────────────
      // Se pide UN DÍA POR PETICIÓN y se usa 'total_precipitation', que lo
      // calcula el servidor. Con un rango amplio la API entrega la serie
      // reducida y sumar sus valores pierde precipitación: el mismo día daba
      // 8.2 mm en la vista de 7 días y 18.4 mm al consultarlo solo.
      if (!esHoy) {
        const dds = [];
        for (let i = dias - 1; i >= 0; i--) dds.push(new Date(now.getTime() - i * 864e5));

        const totales = await Promise.all(dds.map(async d => {
          try {
            const r = await fetch(`/api/v1/mobile/davis/rain-gauges/filtered-data/?start_date=${fmt(d)}&end_date=${fmt(d)}&station_id=${stationId}&metric=rainfall_mm&max_points=9000`, { headers:{'Authorization':`Token ${token()}`} });
            if (!r.ok) return 0;
            const j = await r.json();
            if (typeof j.total_precipitation === 'number') return j.total_precipitation;
            // Plan B: sumar la serie del día (sin reducir, es un solo día).
            return (j.data || []).reduce((a, x) => a + (parseFloat(x.value) || 0), 0);
          } catch (e) { return 0; }
        }));

        setLluviaChart(dds.map((d, i) => ({
          dia: i === dds.length - 1 ? 'Hoy'
            : `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}`,
          mm: parseFloat((totales[i] || 0).toFixed(1)),
        })));
        setDetalleHoy(null);
        return;
      }

      const res = await fetch(`/api/v1/mobile/davis/rain-gauges/filtered-data/?start_date=${fmt(past)}&end_date=${fmt(now)}&station_id=${stationId}&metric=rainfall_mm&max_points=9000`, { headers:{'Authorization':`Token ${token()}`} });
      if (!res.ok) { setLluviaChart([]); setDetalleHoy(null); return; }

      const data = await res.json();
      const records = data.data || [];

      if (esHoy) {
        // ── Acumulado por hora del día en curso ──────────────────────────
        // Arreglo indexado 0..23: el orden queda fijo, sin depender de cómo
        // JavaScript recorra las claves de un objeto.
        const porHora = new Array(24).fill(0);

        let ultimo = null;   // último registro con lluvia > 0
        for (const r of records) {
          const dt = new Date(r.timestamp);
          if (dt.toDateString() !== now.toDateString()) continue;
          const h = dt.getHours();
          const v = parseFloat(r.value) || 0;
          porHora[h] += v;
          if (v > 0) ultimo = { fecha: dt, valor: v, hora: h };
        }

        const horaActual = now.getHours();
        setLluviaChart(porHora.map((mm, h) => ({
          dia: String(h).padStart(2, '0'),
          mm: parseFloat(mm.toFixed(1)),
          enCurso: h === horaActual,
        })));

        const acumDia = porHora.reduce((a, b) => a + b, 0);
        setDetalleHoy(ultimo ? {
          hora: `${String(ultimo.hora).padStart(2, '0')}:${String(ultimo.fecha.getMinutes()).padStart(2, '0')}`,
          hace: Math.max(0, Math.round((now - ultimo.fecha) / 60000)),
          valor: ultimo.valor,
          acumHora: porHora[ultimo.hora],
          horaLabel: `${String(ultimo.hora).padStart(2, '0')}:00`,
          acumDia,
        } : { sinLluvia: true, acumDia });
      } else {
        setDetalleHoy(null);
      }
    } catch(e) { console.error(e); } finally { setCargandoLluvia(false); }
  };

  useEffect(() => {
    (async () => {
      setCargando(true);
      await Promise.all([cargarIncidentes(), cargarEstaciones()]);
      setCargando(false);
    })();
  }, []);

  useEffect(() => {
    if (estacionSeleccionada) cargarLluviaChart(estacionSeleccionada, rangoSel);
  }, [estacionSeleccionada, rangoSel]);

  // ── Procesamiento de datos ────────────────────────────────────────────
  const tiposMapa = { '1':'Deslizamiento','2':'Obstrucción','3':'Falla Mecánica','4':'Robo','5':'Daño Estructural','6':'Otro' };
  const totalInc = incidentes.length;
  const pendientes = incidentes.filter(i => i.status === 'pat').length;
  const enAtencion = incidentes.filter(i => i.status === 'ate').length;
  const cerrados = incidentes.filter(i => i.status === 'cer').length;

  const porTipo = Object.entries(incidentes.reduce((acc, i) => {
    const t = tiposMapa[i.type?.toString()] || 'Otro';
    acc[t] = (acc[t]||0) + 1; return acc;
  }, {})).map(([name, value]) => ({ name, value }));

  const porGravedad = Object.entries(incidentes.reduce((acc, i) => {
    const g = i.severity || 'lev';
    const label = g === 'lev' ? 'Leve' : g === 'mod' ? 'Moderada' : 'Grave';
    acc[label] = (acc[label]||0) + 1; return acc;
  }, {})).map(([name, value]) => ({ name, value }));

  const porEstado = [
    { name: 'Pendiente', value: pendientes, color: COLORS_ESTADO.pat },
    { name: 'En Atención', value: enAtencion, color: COLORS_ESTADO.ate },
    { name: 'Cerrado', value: cerrados, color: COLORS_ESTADO.cer },
  ].filter(d => d.value > 0);

  // ── Incidentes por mes (últimos 6 meses) ──────────────────────────────
  const porMes = (() => {
    const now = new Date();
    const meses = {};
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
      meses[key] = 0;
    }
    for (const inc of incidentes) {
      const d = new Date(inc.created_at);
      const key = `${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
      if (key in meses) meses[key]++;
    }
    return Object.entries(meses).map(([mes, cantidad]) => ({ mes, cantidad }));
  })();

  // ── Series y opciones para ApexCharts ─────────────────────────────────
  const donaEstado = {
    series: porEstado.map(d => d.value),
    options: opcionesDona(porEstado.map(d => d.name), porEstado.map(d => d.color)),
  };
  const donaTipo = {
    series: porTipo.map(d => d.value),
    options: opcionesDona(porTipo.map(d => d.name), porTipo.map((_, i) => COLORS_TIPO[i % COLORS_TIPO.length])),
  };
  const donaGravedad = {
    series: porGravedad.map(d => d.value),
    options: opcionesDona(
      porGravedad.map(d => d.name),
      porGravedad.map(d => d.name === 'Leve' ? COLORS_GRAVEDAD.lev : d.name === 'Moderada' ? COLORS_GRAVEDAD.mod : COLORS_GRAVEDAD.gra),
    ),
  };
  const barrasMes = {
    series: [{ name: 'Incidentes', data: porMes.map(d => d.cantidad) }],
    options: opcionesBarras(porMes.map(d => d.mes)),
  };
  const esModoHoy = rangoSel === 'hoy';
  const baseBarras = opcionesBarras(lluviaChart.map(d => d.dia), {
    unidad: ' mm',
    rotarEtiquetas: rangoSel !== 'hoy' && rangoSel > 15,
    decimales: true,
  });
  const barrasLluvia = {
    // Los datos van como números planos: si se pasan como objetos {x, y},
    // ApexCharts arma sus propias categorías y desordena las horas.
    series: [{ name: 'Lluvia', data: lluviaChart.map(d => d.mm) }],
    options: esModoHoy
      ? {
          ...baseBarras,
          // 'distributed' colorea cada barra por índice: así la hora en curso
          // sale más clara sin tocar el orden de los datos.
          colors: lluviaChart.map(d => d.enCurso ? '#8fd0f5' : '#1268C3'),
          fill: { type: 'solid' },
          legend: { show: false },
          plotOptions: {
            ...baseBarras.plotOptions,
            bar: { ...baseBarras.plotOptions.bar, distributed: true },
          },
          tooltip: { ...baseBarras.tooltip, x: { formatter: (v) => `${v}:00 h` } },
        }
      : baseBarras,
  };

  // Tarjeta de indicador: el color va por variable CSS (--c).
  const Kpi = ({ color, icono, etiqueta, valor }) => (
    <div className="est-kpi" style={{ '--c': color }}>
      <div className="est-kpi-label">{icono} {etiqueta}</div>
      <div className="est-kpi-valor">{valor}</div>
    </div>
  );

  if (cargando) return (
    <div className="tbl-page-wrapper">
      <div className="tbl-empty" style={{height:'60vh',display:'flex',alignItems:'center',justifyContent:'center',gap:'8px',fontWeight:600}}>
        <FaSyncAlt className="icon-spin"/> Cargando estadísticas…
      </div>
    </div>
  );

  return (
    <div className="tbl-page-wrapper">
      <div className="tbl-page-header">
        <div className="tbl-row align-items-center">
          <div className="tbl-col">
            <div className="tbl-page-pretitle">Panel Analítico</div>
            <h2 className="tbl-page-title">Estadísticas del Sistema</h2>
          </div>
          <div className="tbl-col-auto">
            <button className="tbl-btn tbl-btn-primary" onClick={async()=>{setCargando(true);await Promise.all([cargarIncidentes(),cargarEstaciones()]);setCargando(false);}}>
              <FaSyncAlt/> Actualizar
            </button>
          </div>
        </div>
      </div>

      <div className="tbl-page-body" style={{padding:'0'}}>

        {/* ── Sub-menú ───────────────────────────────────────────────────── */}
        <div className="est-tabs">
          {[
            {key:'incidentes', label:'Incidentes', icon:<FaChartBar/>},
            {key:'estaciones', label:'Estaciones Meteorológicas', icon:<FaCloudRain/>},
          ].map(tab => (
            <button key={tab.key} onClick={()=>setSubMenu(tab.key)}
              className={`est-tab ${subMenu===tab.key ? 'activa' : ''}`}>
              {tab.icon} {tab.label}
            </button>
          ))}
        </div>

        <div style={{padding:'20px 24px 24px'}}>

        {/* ══════════════════════════════════════════════════════════════════ */}
        {/* ── TAB: INCIDENTES ──────────────────────────────────────────── */}
        {/* ══════════════════════════════════════════════════════════════════ */}
        {subMenu === 'incidentes' && (<>
        <div style={{display:'flex',gap:'14px',flexWrap:'wrap',marginBottom:'18px'}}>
          <Kpi color="#1268C3" icono={<FaClipboardList/>} etiqueta="Total Incidentes" valor={totalInc} />
          <Kpi color="#f59f00" icono={<FaClock/>} etiqueta="Pendientes" valor={pendientes} />
          <Kpi color="#35B6E9" icono={<FaExclamationTriangle/>} etiqueta="En Atención" valor={enAtencion} />
          <Kpi color="#2fb344" icono={<FaCheckCircle/>} etiqueta="Cerrados" valor={cerrados} />
        </div>

        {/* ── Gráficos de incidentes ─────────────────────────────────────── */}
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(280px,1fr))',gap:'14px',marginBottom:'18px'}}>
          <div className="est-card">
            <div className="est-titulo">Incidentes por Estado</div>
            <ReactApexChart options={donaEstado.options} series={donaEstado.series} type="donut" height={265} />
          </div>
          <div className="est-card">
            <div className="est-titulo">Incidentes por Tipo</div>
            <ReactApexChart options={donaTipo.options} series={donaTipo.series} type="donut" height={265} />
          </div>
          <div className="est-card">
            <div className="est-titulo">Incidentes por Gravedad</div>
            <ReactApexChart options={donaGravedad.options} series={donaGravedad.series} type="donut" height={265} />
          </div>
        </div>

        {/* ── Tendencia mensual ───────────────────────────────────────────── */}
        <div className="est-card" style={{marginBottom:'18px'}}>
          <div className="est-titulo">Tendencia de Incidentes (Últimos 6 meses)</div>
          <ReactApexChart options={barrasMes.options} series={barrasMes.series} type="bar" height={260} />
        </div>

        </>)}

        {/* ══════════════════════════════════════════════════════════════════ */}
        {/* ── TAB: ESTACIONES METEOROLÓGICAS ───────────────────────────── */}
        {/* ══════════════════════════════════════════════════════════════════ */}
        {subMenu === 'estaciones' && (<>

        <div style={{display:'flex',gap:'14px',height:'calc(100vh - 250px)'}}>
          {/* ── Panel izquierdo: Estaciones ─────────────────────────────── */}
          <div className="est-card" style={{width:'320px', flexShrink:0, display:'flex', flexDirection:'column', overflow:'hidden'}}>
            <div className="est-titulo" style={{marginBottom:'12px'}}><FaCloudRain/> Estaciones</div>
            {estaciones.length === 0 ? <div style={{color:'#5b7590',fontSize:'13px'}}>No se encontraron estaciones.</div> : (
              <div style={{overflowY:'auto',flex:1,display:'flex',flexDirection:'column',gap:'8px',paddingRight:'4px'}}>
                {estaciones.map(eq => (
                  <div key={eq.id} onClick={()=>setEstacionSeleccionada(eq.id)}
                    className={`est-estacion ${estacionSeleccionada===eq.id ? 'activa' : ''}`}>
                    <div className="est-estacion-nombre">{eq.nombre || `Estación ${eq.id}`}</div>
                    <div className="est-estacion-datos">
                      <span style={{color: eq.isCritical ? '#d63939' : '#1268C3', fontWeight:'700'}}><FaCloudRain style={{marginRight:'3px'}}/>{eq.totalRain.toFixed(1)} mm</span>
                      <span><FaThermometerHalf style={{marginRight:'3px',color:'#f76707'}}/>{eq.temp}°C</span>
                      <span><FaTint style={{marginRight:'3px',color:'#35B6E9'}}/>{eq.hum}%</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Panel derecho: Gráfico de lluvias ──────────────────────── */}
          <div className="est-card" style={{flex:1, display:'flex', flexDirection:'column', overflow:'hidden'}}>
            {estacionSeleccionada ? (<>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:'12px',flexWrap:'wrap',flexShrink:0}}>
                <div className="est-titulo" style={{marginBottom:0}}><FaCloudRain/> Historial — {estaciones.find(e=>e.id===estacionSeleccionada)?.nombre || 'Estación'}</div>
                <div style={{display:'flex',gap:'6px'}}>
                  {[['hoy','Hoy'],[7,'7 días'],[15,'15 días'],[30,'30 días']].map(([v,txt]) => (
                    <button key={v} onClick={()=>setRangoSel(v)}
                      className={`est-rango ${rangoSel===v ? 'activo' : ''}`}>{txt}</button>
                  ))}
                </div>
              </div>
              {/* Resumen de la última lluvia (solo en modo 'hoy') */}
              {esModoHoy && detalleHoy && !cargandoLluvia && (
                <div className="est-ultima">
                  {detalleHoy.sinLluvia ? (
                    <div className="est-ultima-vacio">
                      <FaCloudRain /> Sin lluvia registrada hoy
                    </div>
                  ) : (
                    <>
                      <div className="est-ultima-cab">
                        <FaClock />
                        <div>
                          <div className="est-ultima-etq">Última lluvia</div>
                          <div className="est-ultima-hora">{detalleHoy.hora}</div>
                          <div className="est-ultima-hace">
                            {detalleHoy.hace < 1 ? 'hace un momento'
                              : detalleHoy.hace < 60 ? `hace ${detalleHoy.hace} min`
                              : `hace ${Math.floor(detalleHoy.hace / 60)} h`}
                          </div>
                        </div>
                      </div>
                      <div className="est-ultima-filas">
                        <div><span>En ese registro</span><b>{detalleHoy.valor.toFixed(1)} mm</b></div>
                        <div><span>En la hora {detalleHoy.horaLabel}</span><b>{detalleHoy.acumHora.toFixed(1)} mm</b></div>
                        <div className="total"><span>Acumulado hoy</span><b>{detalleHoy.acumDia.toFixed(1)} mm</b></div>
                      </div>
                    </>
                  )}
                </div>
              )}

              <div style={{flex:1,minHeight:0,marginTop:'14px'}}>
                {cargandoLluvia ? <div style={{textAlign:'center',padding:'40px',color:'#5b7590',fontWeight:600}}><FaSyncAlt className="icon-spin"/> Cargando…</div> : (
                  <ReactApexChart options={barrasLluvia.options} series={barrasLluvia.series} type="bar" height="100%" />
                )}
              </div>
              {esModoHoy && !cargandoLluvia && (
                <div className="est-leyenda-hora">
                  <span className="cuadro" /> Hora en curso: aún no termina
                </div>
              )}
            </>) : (
              <div style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center',color:'#5b7590',fontSize:'14px'}}>
                ← Selecciona una estación para ver su historial
              </div>
            )}
          </div>
        </div>

        </>)}

        </div>
      </div>
    </div>
  );
}

export default Estadisticas;