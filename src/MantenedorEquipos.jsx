// ═══════════════════════════════════════════════════════════════════════════
//  MantenedorEquipos.jsx
//  Mantenedor (CRUD) de catálogos. Flujo:
//    Equipo → Origen (JURP / Externa) → Marca → Placas
//  Cada "placa" es una máquina física con:
//    - código autogenerado (JURP001… o EX01…) según origen
//    - placa única
//    - estado: 0 disponible / 1 no disponible (se crea en 0)
// ═══════════════════════════════════════════════════════════════════════════
import { useState, useEffect, useCallback } from 'react';
import Swal from 'sweetalert2';
import { FaPlus, FaEdit, FaTrash, FaTimes, FaChevronRight, FaSync, FaCircle } from 'react-icons/fa';
import './MantenedorEquipos.css';

const API = 'https://gideonstudio.duckdns.org/api/v1/mobile/operations';

// Endpoints AllowAny; no enviamos token (uno vencido daría 401).
function headers(json = true) {
  const h = {};
  if (json) h['Content-Type'] = 'application/json';
  return h;
}

export default function MantenedorEquipos({ abierto, onClose }) {
  const [equipos, setEquipos] = useState([]);
  const [marcas, setMarcas] = useState([]);
  const [placas, setPlacas] = useState([]);
  const [equipoSel, setEquipoSel] = useState(null);
  const [origenSel, setOrigenSel] = useState('JURP');   // JURP | EXTERNA
  const [marcaSel, setMarcaSel] = useState(null);
  const [cargando, setCargando] = useState(false);

  // ── Cargas ──────────────────────────────────────────────────────────────
  const cargarEquipos = useCallback(async () => {
    setCargando(true);
    try {
      const r = await fetch(`${API}/equipos/`);
      if (r.ok) setEquipos(await r.json());
    } catch (e) { console.error(e); } finally { setCargando(false); }
  }, []);

  const cargarMarcas = useCallback(async (equipoId) => {
    if (!equipoId) { setMarcas([]); return; }
    try {
      const r = await fetch(`${API}/marcas/?equipo=${equipoId}`);
      if (r.ok) setMarcas(await r.json());
    } catch (e) { console.error(e); }
  }, []);

  // Placas filtradas por marca + origen seleccionado.
  const cargarPlacas = useCallback(async (marcaId, origen) => {
    if (!marcaId) { setPlacas([]); return; }
    try {
      const r = await fetch(`${API}/modelos/?marca=${marcaId}&origen=${origen}`);
      if (r.ok) setPlacas(await r.json());
    } catch (e) { console.error(e); }
  }, []);

  useEffect(() => { if (abierto) cargarEquipos(); }, [abierto, cargarEquipos]);
  useEffect(() => { cargarMarcas(equipoSel?.id); setMarcaSel(null); setPlacas([]); }, [equipoSel, cargarMarcas]);
  useEffect(() => { cargarPlacas(marcaSel?.id, origenSel); }, [marcaSel, origenSel, cargarPlacas]);

  // ── CRUD genérico ─────────────────────────────────────────────────────────
  const crear = async (recurso, body, recargar) => {
    try {
      const r = await fetch(`${API}/${recurso}/`, { method: 'POST', headers: headers(), body: JSON.stringify(body) });
      if (r.ok) recargar();
      else { const e = await r.json(); Swal.fire('Error', formatoError(e), 'error'); }
    } catch (e) { Swal.fire('Error', 'No se pudo crear.', 'error'); }
  };
  const editar = async (recurso, id, body, recargar) => {
    try {
      const r = await fetch(`${API}/${recurso}/${id}/`, { method: 'PATCH', headers: headers(), body: JSON.stringify(body) });
      if (r.ok) recargar();
      else { const e = await r.json(); Swal.fire('Error', formatoError(e), 'error'); }
    } catch (e) { Swal.fire('Error', 'No se pudo editar.', 'error'); }
  };
  const eliminar = async (recurso, id, recargar, nombre) => {
    const c = await Swal.fire({
      title: '¿Eliminar?', text: `Se eliminará "${nombre}" y lo que dependa de él.`,
      icon: 'warning', showCancelButton: true, confirmButtonColor: '#d33',
      confirmButtonText: 'Sí, eliminar', cancelButtonText: 'Cancelar',
    });
    if (!c.isConfirmed) return;
    try {
      const r = await fetch(`${API}/${recurso}/${id}/`, { method: 'DELETE' });
      if (r.ok || r.status === 204) recargar();
      else Swal.fire('Error', 'No se pudo eliminar.', 'error');
    } catch (e) { Swal.fire('Error', 'No se pudo eliminar.', 'error'); }
  };
  // Extrae mensajes de error legibles del backend (p.ej. placa duplicada).
  const formatoError = (e) => {
    if (typeof e === 'string') return e;
    if (e?.placa) return Array.isArray(e.placa) ? e.placa[0] : e.placa;
    return Object.entries(e).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`).join(' · ');
  };

  // ── Equipos ────────────────────────────────────────────────────────────
  const nuevoEquipo = async () => {
    const { value } = await Swal.fire({ title: 'Nuevo equipo', input: 'text', inputPlaceholder: 'Ej. TRACTOR', showCancelButton: true, confirmButtonText: 'Crear', inputValidator: v => !v && 'Escribe un nombre' });
    if (value) crear('equipos', { nombre: value.toUpperCase().trim(), activo: true }, cargarEquipos);
  };
  const editarEquipo = async (eq) => {
    const { value } = await Swal.fire({ title: 'Editar equipo', input: 'text', inputValue: eq.nombre, showCancelButton: true, confirmButtonText: 'Guardar' });
    if (value && value !== eq.nombre) editar('equipos', eq.id, { nombre: value.toUpperCase().trim() }, cargarEquipos);
  };

  // ── Marcas ─────────────────────────────────────────────────────────────
  const nuevaMarca = async () => {
    if (!equipoSel) return;
    const { value } = await Swal.fire({ title: `Nueva marca para ${equipoSel.nombre}`, input: 'text', inputPlaceholder: 'Ej. CAT', showCancelButton: true, confirmButtonText: 'Crear', inputValidator: v => !v && 'Escribe un nombre' });
    if (value) crear('marcas', { equipo: equipoSel.id, nombre: value.toUpperCase().trim(), activo: true }, () => cargarMarcas(equipoSel.id));
  };
  const editarMarca = async (ma) => {
    const { value } = await Swal.fire({ title: 'Editar marca', input: 'text', inputValue: ma.nombre, showCancelButton: true, confirmButtonText: 'Guardar' });
    if (value && value !== ma.nombre) editar('marcas', ma.id, { nombre: value.toUpperCase().trim() }, () => cargarMarcas(equipoSel.id));
  };

  // ── Placas (máquinas) ──────────────────────────────────────────────────
  const nuevaPlaca = async () => {
    if (!marcaSel) return;
    const origenTxt = origenSel === 'JURP' ? 'JURP (propia)' : 'Externa';
    const { value: placa } = await Swal.fire({
      title: `Nueva placa · ${origenTxt}`,
      html: `<p style="font-size:13px;color:#64748b;margin:0 0 8px">Equipo: <b>${equipoSel.nombre}</b> · Marca: <b>${marcaSel.nombre}</b><br>El código se generará automáticamente.</p>`,
      input: 'text', inputPlaceholder: 'Placa (ej. ABC-123)',
      showCancelButton: true, confirmButtonText: 'Crear',
      inputValidator: v => !v && 'Escribe la placa',
    });
    if (placa) crear('modelos', { marca: marcaSel.id, origen: origenSel, placa: placa.toUpperCase().trim() }, () => cargarPlacas(marcaSel.id, origenSel));
  };
  const editarPlaca = async (mo) => {
    const { value: placa } = await Swal.fire({
      title: `Editar placa · ${mo.codigo}`,
      input: 'text', inputValue: mo.placa, showCancelButton: true, confirmButtonText: 'Guardar',
      inputValidator: v => !v && 'Escribe la placa',
    });
    if (placa && placa.toUpperCase().trim() !== mo.placa) editar('modelos', mo.id, { placa: placa.toUpperCase().trim() }, () => cargarPlacas(marcaSel.id, origenSel));
  };
  // Alterna estado 0 (disponible) ⇄ 1 (no disponible).
  const toggleEstado = async (mo) => {
    const nuevo = mo.estado === 0 ? 1 : 0;
    editar('modelos', mo.id, { estado: nuevo }, () => cargarPlacas(marcaSel.id, origenSel));
  };

  if (!abierto) return null;

  return (
    <div className="mnt-overlay" onClick={onClose}>
      <div className="mnt-modal" onClick={e => e.stopPropagation()}>
        <div className="mnt-header">
          <h3>Mantenedor de maquinaria</h3>
          <button className="mnt-btn-x" onClick={onClose}><FaTimes /></button>
        </div>

        <div className="mnt-cols">
          {/* ── Equipos ─────────────────────────────────────────────────── */}
          <div className="mnt-col">
            <div className="mnt-col-head">
              <span>Equipos</span>
              <button className="mnt-btn-add" onClick={nuevoEquipo}><FaPlus /> Nuevo</button>
            </div>
            <div className="mnt-list">
              {cargando && <div className="mnt-empty"><FaSync className="mnt-spin" /> Cargando…</div>}
              {!cargando && equipos.length === 0 && <div className="mnt-empty">Sin equipos. Crea el primero.</div>}
              {equipos.map(eq => (
                <div key={eq.id} className={`mnt-item ${equipoSel?.id === eq.id ? 'sel' : ''}`} onClick={() => setEquipoSel(eq)}>
                  <span className="mnt-item-name">{eq.nombre}</span>
                  <span className="mnt-item-actions">
                    <button onClick={e => { e.stopPropagation(); editarEquipo(eq); }} title="Editar"><FaEdit /></button>
                    <button onClick={e => { e.stopPropagation(); eliminar('equipos', eq.id, cargarEquipos, eq.nombre); }} title="Eliminar" className="del"><FaTrash /></button>
                    <FaChevronRight className="mnt-item-arrow" />
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* ── Marcas (con selector de origen arriba) ──────────────────── */}
          <div className="mnt-col">
            <div className="mnt-col-head">
              <span>Marcas {equipoSel && <small>de {equipoSel.nombre}</small>}</span>
              <button className="mnt-btn-add" onClick={nuevaMarca} disabled={!equipoSel}><FaPlus /> Nueva</button>
            </div>
            {/* Selector JURP / Externa */}
            <div className="mnt-origen">
              <button className={`mnt-origen-btn ${origenSel === 'JURP' ? 'on' : ''}`} onClick={() => setOrigenSel('JURP')}>JURP</button>
              <button className={`mnt-origen-btn ${origenSel === 'EXTERNA' ? 'on ext' : ''}`} onClick={() => setOrigenSel('EXTERNA')}>Externa</button>
            </div>
            <div className="mnt-list">
              {!equipoSel && <div className="mnt-empty">Selecciona un equipo →</div>}
              {equipoSel && marcas.length === 0 && <div className="mnt-empty">Sin marcas. Crea la primera.</div>}
              {marcas.map(ma => (
                <div key={ma.id} className={`mnt-item ${marcaSel?.id === ma.id ? 'sel' : ''}`} onClick={() => setMarcaSel(ma)}>
                  <span className="mnt-item-name">{ma.nombre}</span>
                  <span className="mnt-item-actions">
                    <button onClick={e => { e.stopPropagation(); editarMarca(ma); }} title="Editar"><FaEdit /></button>
                    <button onClick={e => { e.stopPropagation(); eliminar('marcas', ma.id, () => cargarMarcas(equipoSel.id), ma.nombre); }} title="Eliminar" className="del"><FaTrash /></button>
                    <FaChevronRight className="mnt-item-arrow" />
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* ── Placas ──────────────────────────────────────────────────── */}
          <div className="mnt-col">
            <div className="mnt-col-head">
              <span>Placas {marcaSel && <small>· {origenSel === 'JURP' ? 'JURP' : 'Externa'}</small>}</span>
              <button className="mnt-btn-add" onClick={nuevaPlaca} disabled={!marcaSel}><FaPlus /> Nueva</button>
            </div>
            <div className="mnt-list">
              {!marcaSel && <div className="mnt-empty">Selecciona una marca →</div>}
              {marcaSel && placas.length === 0 && <div className="mnt-empty">Sin placas {origenSel === 'JURP' ? 'JURP' : 'externas'}. Crea la primera.</div>}
              {placas.map(mo => (
                <div key={mo.id} className="mnt-item mnt-item-placa">
                  <span className="mnt-item-name">
                    <span className={`mnt-codigo ${mo.origen === 'JURP' ? 'jurp' : 'ext'}`}>{mo.codigo}</span>
                    <span className="mnt-placa-txt">{mo.placa}</span>
                  </span>
                  <span className="mnt-item-actions always">
                    <button
                      className={`mnt-estado ${mo.estado === 0 ? 'disp' : 'nodisp'}`}
                      onClick={() => toggleEstado(mo)}
                      title={mo.estado === 0 ? 'Disponible (clic para marcar no disponible)' : 'No disponible (clic para marcar disponible)'}
                    >
                      <FaCircle /> {mo.estado === 0 ? 'Disponible' : 'No disp.'}
                    </button>
                    <button onClick={() => editarPlaca(mo)} title="Editar placa"><FaEdit /></button>
                    <button onClick={() => eliminar('modelos', mo.id, () => cargarPlacas(marcaSel.id, origenSel), mo.codigo)} title="Eliminar" className="del"><FaTrash /></button>
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="mnt-footer">
          <span className="mnt-hint">Código automático: JURP001… (propia) · EX01… (externa). Placa única. Se crea disponible.</span>
          <button className="mnt-btn-cerrar" onClick={onClose}>Cerrar</button>
        </div>
      </div>
    </div>
  );
}