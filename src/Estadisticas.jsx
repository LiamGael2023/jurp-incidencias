import { useState, useEffect } from 'react';
import { FaSyncAlt, FaExclamationTriangle, FaCheckCircle, FaClock, FaClipboardList, FaThermometerHalf, FaTint, FaCloudRain } from 'react-icons/fa';
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import './Incidentes.css';

const COLORS_TIPO = ['#206bc4','#f76707','#d63939','#2fb344','#ae3ec9','#f59f00'];
const COLORS_GRAVEDAD = {'lev':'#2fb344','mod':'#f76707','gra':'#d63939'};
const COLORS_ESTADO = {'pat':'#f59f00','ate':'#206bc4','cer':'#2fb344'};

function Estadisticas() {
  const [subMenu, setSubMenu] = useState('incidentes');
  const [incidentes, setIncidentes] = useState([]);
  const [estaciones, setEstaciones] = useState([]);
  const [lluviaChart, setLluviaChart] = useState([]);
  const [estacionSeleccionada, setEstacionSeleccionada] = useState(null);
  const [diasRango, setDiasRango] = useState(7);
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
            fetch(`/api/v1/mobile/davis/rain-gauges/filtered-data/?start_date=${fmt(past24h)}&end_date=${fmt(now)}&station_id=${eq.id}&metric=rainfall_mm`, { headers:{'Authorization':`Token ${token()}`} }),
            fetch(`/api/v1/mobile/davis/rain-gauges/filtered-data/?start_date=${fmt(past24h)}&end_date=${fmt(now)}&station_id=${eq.id}&metric=temp_out`, { headers:{'Authorization':`Token ${token()}`} }),
            fetch(`/api/v1/mobile/davis/rain-gauges/filtered-data/?start_date=${fmt(past24h)}&end_date=${fmt(now)}&station_id=${eq.id}&metric=hum_out`, { headers:{'Authorization':`Token ${token()}`} }),
          ]);
          if (rR.ok) { const d = await rR.json(); for (const r of (d.data||[])) totalRain += parseFloat(r.value)||0; }
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
  const cargarLluviaChart = async (stationId, days) => {
    if (!stationId) return;
    setCargandoLluvia(true);
    try {
      const now = new Date();
      const past = new Date(now.getTime() - (days-1)*24*60*60*1000);
      const fmt = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      const res = await fetch(`/api/v1/mobile/davis/rain-gauges/filtered-data/?start_date=${fmt(past)}&end_date=${fmt(now)}&station_id=${stationId}&metric=rainfall_mm&max_points=9000`, { headers:{'Authorization':`Token ${token()}`} });
      if (res.ok) {
        const data = await res.json();
        const records = data.data || [];
        const dailyRain = {};
        for (let i = days-1; i >= 0; i--) {
          const d = new Date(now.getTime() - i*24*60*60*1000);
          const key = i === 0 ? 'Hoy' : `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}`;
          dailyRain[key] = 0;
        }
        for (const r of records) {
          try {
            const dt = new Date(r.timestamp);
            const isToday = dt.toDateString() === now.toDateString();
            const key = isToday ? 'Hoy' : `${String(dt.getDate()).padStart(2,'0')}/${String(dt.getMonth()+1).padStart(2,'0')}`;
            if (key in dailyRain) dailyRain[key] += parseFloat(r.value) || 0;
          } catch(e) {}
        }
        setLluviaChart(Object.entries(dailyRain).map(([dia, mm]) => ({ dia, mm: parseFloat(mm.toFixed(1)) })));
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
    if (estacionSeleccionada) cargarLluviaChart(estacionSeleccionada, diasRango);
  }, [estacionSeleccionada, diasRango]);

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

  const kpiStyle = (color) => ({ background:'#fff', borderRadius:'4px', border:'1px solid rgba(98,105,118,0.16)', padding:'20px', flex:1, minWidth:'180px', borderLeft:`4px solid ${color}` });
  const sectionTitle = { fontSize:'14px', fontWeight:'700', color:'#1d273b', marginBottom:'16px', display:'flex', alignItems:'center', gap:'8px' };
  const cardBox = { background:'#fff', borderRadius:'4px', border:'1px solid rgba(98,105,118,0.16)', padding:'20px' };

  if (cargando) return <div className="tbl-page-wrapper"><div className="tbl-empty" style={{height:'60vh',display:'flex',alignItems:'center',justifyContent:'center'}}><FaSyncAlt className="icon-spin" style={{marginRight:'8px'}}/> Cargando estadísticas...</div></div>;

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
              <FaSyncAlt style={{marginRight:'8px'}}/> Actualizar
            </button>
          </div>
        </div>
      </div>

      <div className="tbl-page-body" style={{padding:'0',overflowY:'auto',maxHeight:'calc(100vh - 140px)'}}>

        {/* ── Sub-menú ───────────────────────────────────────────────────── */}
        <div style={{display:'flex',gap:'0',borderBottom:'2px solid #e2e8f0',background:'#fff',padding:'0 20px',position:'sticky',top:0,zIndex:10}}>
          {[
            {key:'incidentes', label:'Incidentes', icon:'📊'},
            {key:'estaciones', label:'Estaciones Meteorológicas', icon:'🌧️'},
            {key:'vigilancia', label:'Vigilancia', icon:'🔒'},
          ].map(tab => (
            <button key={tab.key} onClick={()=>setSubMenu(tab.key)} style={{padding:'12px 20px',border:'none',background:'transparent',cursor:'pointer',fontSize:'13px',fontWeight:subMenu===tab.key?'700':'500',color:subMenu===tab.key?'#206bc4':'#626976',borderBottom:subMenu===tab.key?'2px solid #206bc4':'2px solid transparent',marginBottom:'-2px',transition:'all 0.2s',display:'flex',alignItems:'center',gap:'6px'}}>
              <span>{tab.icon}</span> {tab.label}
            </button>
          ))}
        </div>

        <div style={{padding:'20px'}}>

        {/* ══════════════════════════════════════════════════════════════════ */}
        {/* ── TAB: INCIDENTES ──────────────────────────────────────────── */}
        {/* ══════════════════════════════════════════════════════════════════ */}
        {subMenu === 'incidentes' && (<>
        <div style={{display:'flex',gap:'16px',flexWrap:'wrap',marginBottom:'24px'}}>
          <div style={kpiStyle('#206bc4')}>
            <div style={{fontSize:'12px',color:'#626976',textTransform:'uppercase',fontWeight:'600',marginBottom:'4px'}}><FaClipboardList style={{marginRight:'4px'}}/> Total Incidentes</div>
            <div style={{fontSize:'28px',fontWeight:'700',color:'#1d273b'}}>{totalInc}</div>
          </div>
          <div style={kpiStyle('#f59f00')}>
            <div style={{fontSize:'12px',color:'#626976',textTransform:'uppercase',fontWeight:'600',marginBottom:'4px'}}><FaClock style={{marginRight:'4px'}}/> Pendientes</div>
            <div style={{fontSize:'28px',fontWeight:'700',color:'#f59f00'}}>{pendientes}</div>
          </div>
          <div style={kpiStyle('#206bc4')}>
            <div style={{fontSize:'12px',color:'#626976',textTransform:'uppercase',fontWeight:'600',marginBottom:'4px'}}><FaExclamationTriangle style={{marginRight:'4px'}}/> En Atención</div>
            <div style={{fontSize:'28px',fontWeight:'700',color:'#206bc4'}}>{enAtencion}</div>
          </div>
          <div style={kpiStyle('#2fb344')}>
            <div style={{fontSize:'12px',color:'#626976',textTransform:'uppercase',fontWeight:'600',marginBottom:'4px'}}><FaCheckCircle style={{marginRight:'4px'}}/> Cerrados</div>
            <div style={{fontSize:'28px',fontWeight:'700',color:'#2fb344'}}>{cerrados}</div>
          </div>
        </div>

        {/* ── Gráficos de incidentes ─────────────────────────────────────── */}
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:'16px',marginBottom:'24px'}}>
          {/* Por Estado */}
          <div style={cardBox}>
            <div style={sectionTitle}>Incidentes por Estado</div>
            <ResponsiveContainer width="100%" height={250}>
              <PieChart>
                <Pie data={porEstado} cx="50%" cy="45%" innerRadius={40} outerRadius={75} dataKey="value" paddingAngle={2}>
                  {porEstado.map((d,i) => <Cell key={i} fill={d.color}/>)}
                </Pie>
                <Tooltip formatter={(v,n)=>[v,n]}/>
                <Legend verticalAlign="bottom" iconType="circle" wrapperStyle={{fontSize:'12px'}} formatter={(v,entry)=>`${v} (${entry.payload.value})`}/>
              </PieChart>
            </ResponsiveContainer>
          </div>
          {/* Por Tipo */}
          <div style={cardBox}>
            <div style={sectionTitle}>Incidentes por Tipo</div>
            <ResponsiveContainer width="100%" height={250}>
              <PieChart>
                <Pie data={porTipo} cx="50%" cy="45%" innerRadius={40} outerRadius={75} dataKey="value" paddingAngle={2}>
                  {porTipo.map((d,i) => <Cell key={i} fill={COLORS_TIPO[i % COLORS_TIPO.length]}/>)}
                </Pie>
                <Tooltip formatter={(v,n)=>[v,n]}/>
                <Legend verticalAlign="bottom" iconType="circle" wrapperStyle={{fontSize:'12px'}} formatter={(v,entry)=>`${v} (${entry.payload.value})`}/>
              </PieChart>
            </ResponsiveContainer>
          </div>
          {/* Por Gravedad */}
          <div style={cardBox}>
            <div style={sectionTitle}>Incidentes por Gravedad</div>
            <ResponsiveContainer width="100%" height={250}>
              <PieChart>
                <Pie data={porGravedad} cx="50%" cy="45%" innerRadius={40} outerRadius={75} dataKey="value" paddingAngle={2}>
                  {porGravedad.map((d,i) => { const c = d.name==='Leve'?COLORS_GRAVEDAD.lev:d.name==='Moderada'?COLORS_GRAVEDAD.mod:COLORS_GRAVEDAD.gra; return <Cell key={i} fill={c}/>; })}
                </Pie>
                <Tooltip formatter={(v,n)=>[v,n]}/>
                <Legend verticalAlign="bottom" iconType="circle" wrapperStyle={{fontSize:'12px'}} formatter={(v,entry)=>`${v} (${entry.payload.value})`}/>
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* ── Tendencia mensual ───────────────────────────────────────────── */}
        <div style={{...cardBox, marginBottom:'24px'}}>
          <div style={sectionTitle}>Tendencia de Incidentes (Últimos 6 meses)</div>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={porMes}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0"/>
              <XAxis dataKey="mes" tick={{fontSize:12}} stroke="#626976"/>
              <YAxis allowDecimals={false} tick={{fontSize:12}} stroke="#626976"/>
              <Tooltip contentStyle={{borderRadius:'4px',border:'1px solid #e2e8f0'}}/>
              <Bar dataKey="cantidad" name="Incidentes" fill="#206bc4" radius={[4,4,0,0]} maxBarSize={50}/>
            </BarChart>
          </ResponsiveContainer>
        </div>

        </>)}

        {/* ══════════════════════════════════════════════════════════════════ */}
        {/* ── TAB: ESTACIONES METEOROLÓGICAS ───────────────────────────── */}
        {/* ══════════════════════════════════════════════════════════════════ */}
        {subMenu === 'estaciones' && (<>

        <div style={{display:'flex',gap:'16px',height:'calc(100vh - 240px)'}}>
          {/* ── Panel izquierdo: Estaciones ─────────────────────────────── */}
          <div style={{...cardBox, width:'320px', flexShrink:0, display:'flex', flexDirection:'column', overflow:'hidden'}}>
            <div style={{...sectionTitle, marginBottom:'12px'}}><FaCloudRain/> Estaciones</div>
            {estaciones.length === 0 ? <div style={{color:'#626976',fontSize:'13px'}}>No se encontraron estaciones.</div> : (
              <div style={{overflowY:'auto',flex:1,display:'flex',flexDirection:'column',gap:'8px',paddingRight:'4px'}}>
                {estaciones.map(eq => (
                  <div key={eq.id} onClick={()=>setEstacionSeleccionada(eq.id)} style={{padding:'10px 12px',borderRadius:'4px',border: estacionSeleccionada===eq.id ? '2px solid #206bc4' : '1px solid rgba(98,105,118,0.16)',cursor:'pointer',background: estacionSeleccionada===eq.id ? '#f0f6ff' : '#fff',transition:'all 0.2s',flexShrink:0}}>
                    <div style={{fontWeight:'600',fontSize:'12px',color:'#1d273b',marginBottom:'6px'}}>{eq.nombre || `Estación ${eq.id}`}</div>
                    <div style={{display:'flex',gap:'8px',fontSize:'11px',color:'#475569',flexWrap:'wrap'}}>
                      <span style={{color: eq.isCritical ? '#d63939' : '#206bc4', fontWeight:'700'}}><FaCloudRain style={{marginRight:'2px'}}/>{eq.totalRain.toFixed(1)} mm</span>
                      <span><FaThermometerHalf style={{marginRight:'2px',color:'#f76707'}}/>{eq.temp}°C</span>
                      <span><FaTint style={{marginRight:'2px',color:'#206bc4'}}/>{eq.hum}%</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Panel derecho: Gráfico de lluvias ──────────────────────── */}
          <div style={{...cardBox, flex:1, display:'flex', flexDirection:'column', overflow:'hidden'}}>
            {estacionSeleccionada ? (<>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'16px',flexShrink:0}}>
                <div style={sectionTitle}><FaCloudRain/> Historial — {estaciones.find(e=>e.id===estacionSeleccionada)?.nombre || 'Estación'}</div>
                <div style={{display:'flex',gap:'6px'}}>
                  {[7,15,30].map(d => (
                    <button key={d} onClick={()=>setDiasRango(d)} style={{padding:'4px 12px',borderRadius:'4px',border: diasRango===d ? '1px solid #206bc4' : '1px solid rgba(98,105,118,0.16)',background: diasRango===d ? '#206bc4' : '#fff',color: diasRango===d ? '#fff' : '#626976',fontSize:'12px',fontWeight:'600',cursor:'pointer'}}>{d} días</button>
                  ))}
                </div>
              </div>
              <div style={{flex:1,minHeight:0}}>
                {cargandoLluvia ? <div style={{textAlign:'center',padding:'40px',color:'#626976'}}><FaSyncAlt className="icon-spin"/> Cargando...</div> : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={lluviaChart}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0"/>
                      <XAxis dataKey="dia" tick={{fontSize:11}} stroke="#626976" interval={diasRango > 15 ? 2 : 0} angle={diasRango > 15 ? -45 : 0} textAnchor={diasRango > 15 ? 'end' : 'middle'} height={diasRango > 15 ? 60 : 30}/>
                      <YAxis tick={{fontSize:11}} stroke="#626976" unit=" mm"/>
                      <Tooltip formatter={(v)=>[`${v} mm`,'Lluvia']} contentStyle={{borderRadius:'4px',border:'1px solid #e2e8f0'}}/>
                      <Bar dataKey="mm" name="Lluvia (mm)" fill="#206bc4" radius={[4,4,0,0]} maxBarSize={diasRango<=7 ? 40 : 20}/>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </>) : (
              <div style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center',color:'#626976',fontSize:'14px'}}>
                ← Selecciona una estación para ver su historial
              </div>
            )}
          </div>
        </div>

        </>)}

        {/* ══════════════════════════════════════════════════════════════════ */}
        {/* ── TAB: VIGILANCIA ──────────────────────────────────────────── */}
        {/* ══════════════════════════════════════════════════════════════════ */}
        {subMenu === 'vigilancia' && (
          <div style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',minHeight:'400px',color:'#626976'}}>
            <div style={{fontSize:'48px',marginBottom:'16px'}}>🔒</div>
            <h3 style={{margin:'0 0 8px',color:'#1d273b',fontSize:'18px'}}>Módulo de Vigilancia</h3>
            <p style={{margin:0,fontSize:'14px'}}>En construcción</p>
          </div>
        )}

        </div>
      </div>
    </div>
  );
}

export default Estadisticas;