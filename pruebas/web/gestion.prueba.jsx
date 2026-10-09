import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import GestionCosteo from '../../src/GestionCosteo';
import '../../src/Incidentes.css';

const PERS = [{ id: 1, incident_report: 42, date: '2026-10-01', description: 'OPERARIO',
  quantity_hours: '8', unit_price: '25', num_personas: 2, horas_normales: 8,
  horas_extras: 0, origin: 'JURP' }];
const MAT = [{ id: 2, incident_report: 42, date: '2026-10-02', description: 'ALIMENTACION',
  quantity: '1', unit_price: '208', unit: 'und' },
  { id: 3, incident_report: 42, date: '2026-10-03', description: 'ALIMENTACION',
  quantity: '1', unit_price: '300', unit: 'und' }];
const MAQ = [{ id: 4, incident_report: 42, part_number: 'PD-0261-20261009',
  date: '2026-10-04', shift: 'Día', work_zone_text: 'CANOA 08', provider: 'PECH',
  operator: 'JORGE RAMIREZ', start_horometer: '100', end_horometer: '108',
  horas_efectivas: '8', unit_price: '188.80', equipment_name: 'VOLQUETE',
  brand_name: 'MERCEDEZ BENZ', model_plate: 'EAF-498', maquina: 9,
  activities: 'ELIMINACION', actividades: [], cerrado: false }];
const OTRO = [{ id: 9, incident_report: 99, date: '2026-10-01', description: 'DE OTRO',
  quantity: '5', unit_price: '1000', unit: 'und' }];

const j = (d) => new Response(JSON.stringify(d),
  { status: 200, headers: { 'Content-Type': 'application/json' } });
window.__posts = [];
window.fetch = async (url, opc) => {
  const u = String(url);
  if (opc && opc.method === 'POST') {
    const b = {}; if (opc.body && opc.body.forEach) opc.body.forEach((v, k) => { b[k] = v; });
    window.__posts.push({ url: u, body: b });
    return j({ id: 100 });
  }
  if (u.includes('incident-personnels')) return j(PERS);
  if (u.includes('incident-materials')) return j(MAT.concat(OTRO));
  if (u.includes('daily-part-heavy-equipments/siguiente-correlativo')) return j({ siguiente: 'PD-0262-20261009' });
  if (u.includes('daily-part-heavy-equipments')) return j(MAQ);
  if (u.includes('/modelos/')) return j([{ id: 9, codigo: 'EX02', placa: 'EAF-498',
    modelo: 'AROCS 3351', marca_nombre: 'MERCEDEZ BENZ', equipo_nombre: 'VOLQUETE',
    estado: 0, precio_hora: '188.80' }]);
  if (u.includes('/cargos/')) return j([{ id: 1, nombre: 'OPERARIO', activo: true }]);
  if (u.includes('/unidades/')) return j([{ id: 1, nombre: 'und', activo: true }]);
  if (u.includes('/actividades/')) return j([{ id: 1, nombre: 'ELIMINACION', activo: true }]);
  if (u.includes('/partidas/')) return j({ partidas: [] });
  if (u.includes('/equipos/') || u.includes('/marcas/')) return j([]);
  return j([]);
};

const INC = { id: 42, codigoIncidente: 'INCIDENTE-002-14082026', tipo: 'Otros',
  codigo: 'C-08', lugar: 'CANAL LATERAL 10 C-08 9+562.22',
  titulo: 'INCIDENTE-002-14082026', subtitulo: 'Otros en C-08',
  detalle: 'CANAL LATERAL 10 C-08 9+562.22', bloqueado: false,
  textoCerrado: 'Incidencia cerrada', textoCerrar: 'Cerrar incidencia' };

const VINCULO = new URLSearchParams(location.search).get('vinculo') || 'incident_report';

function App() {
  const [abierto, setAbierto] = useState(true);
  return <GestionCosteo abierto={abierto} sujeto={INC} campoVinculo={VINCULO}
    onCerrar={() => setAbierto(false)} onCambio={() => { window.__cambio = true; }}
    onCerrarSujeto={() => { window.__cerrado = true; }}
    onReabrir={() => { window.__reabierto = true; }} />;
}
createRoot(document.getElementById('r')).render(<App />);
