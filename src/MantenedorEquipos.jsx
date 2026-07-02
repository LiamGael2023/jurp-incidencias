// ═══════════════════════════════════════════════════════════════════════════
//  MantenedorEquipos.jsx
//  Mantenedor (CRUD) de catálogos: Equipos → Marcas → Modelos/Placas.
//  Consume la API de operations:
//    /api/v1/mobile/operations/equipos/
//    /api/v1/mobile/operations/marcas/?equipo=<id>
//    /api/v1/mobile/operations/modelos/?marca=<id>
//
//  Uso:
//    import MantenedorEquipos from './MantenedorEquipos';
//    <MantenedorEquipos abierto={x} onClose={...} />
// ═══════════════════════════════════════════════════════════════════════════
import { useState, useEffect, useCallback } from 'react';
import Swal from 'sweetalert2';
import { FaPlus, FaEdit, FaTrash, FaTimes, FaChevronRight, FaSync } from 'react-icons/fa';
import './MantenedorEquipos.css';

const API = 'https://gideonstudio.duckdns.org/api/v1/mobile/operations';

// Cabeceras. Los endpoints de operations son AllowAny; NO enviamos token
// porque un token vencido en localStorage provoca 401 (la maquinaria del
// módulo tampoco manda Authorization). Solo enviamos Content-Type al escribir.
function headers(json = true) {
  const h = {};
  if (json) h['Content-Type'] = 'application/json';
  return h;
}

export default function MantenedorEquipos({ abierto, onClose }) {
  const [equipos, setEquipos] = useState([]);
  const [marcas, setMarcas] = useState([]);
  const [modelos, setModelos] = useState([]);
  const [equipoSel, setEquipoSel] = useState(null);
  const [marcaSel, setMarcaSel] = useState(null);
  const [cargando, setCargando] = useState(false);

  // ── Cargas ──────────────────────────────────────────────────────────────
  const cargarEquipos = useCallback(async () => {
    setCargando(true);
    try {
      const r = await fetch(`${API}/equipos/`, { headers: headers(false) });
      if (r.ok) setEquipos(await r.json());
    } catch (e) { console.error(e); } finally { setCargando(false); }
  }, []);

  const cargarMarcas = useCallback(async (equipoId) => {
    if (!equipoId) { setMarcas([]); return; }
    try {
      const r = await fetch(`${API}/marcas/?equipo=${equipoId}`, { headers: headers(false) });
      if (r.ok) setMarcas(await r.json());
    } catch (e) { console.error(e); }
  }, []);

  const cargarModelos = useCallback(async (marcaId) => {
    if (!marcaId) { setModelos([]); return; }
    try {
      const r = await fetch(`${API}/modelos/?marca=${marcaId}`, { headers: headers(false) });
      if (r.ok) setModelos(await r.json());
    } catch (e) { console.error(e); }
  }, []);

  useEffect(() => { if (abierto) cargarEquipos(); }, [abierto, cargarEquipos]);
  useEffect(() => { cargarMarcas(equipoSel?.id); setMarcaSel(null); setModelos([]); }, [equipoSel, cargarMarcas]);
  useEffect(() => { cargarModelos(marcaSel?.id); }, [marcaSel, cargarModelos]);

  // ── Helpers CRUD genéricos ────────────────────────────────────────────────
  const crear = async (recurso, body, recargar) => {
    try {
      const r = await fetch(`${API}/${recurso}/`, { method: 'POST', headers: headers(), body: JSON.stringify(body) });
      if (r.ok) { recargar(); }
      else { const e = await r.json(); Swal.fire('Error', JSON.stringify(e), 'error'); }
    } catch (e) { Swal.fire('Error', 'No se pudo crear.', 'error'); }
  };
  const editar = async (recurso, id, body, recargar) => {
    try {
      const r = await fetch(`${API}/${recurso}/${id}/`, { method: 'PATCH', headers: headers(), body: JSON.stringify(body) });
      if (r.ok) { recargar(); }
      else { const e = await r.json(); Swal.fire('Error', JSON.stringify(e), 'error'); }
    } catch (e) { Swal.fire('Error', 'No se pudo editar.', 'error'); }
  };
  const eliminar = async (recurso, id, recargar, nombre) => {
    const c = await Swal.fire({
      title: '¿Eliminar?', text: `Se eliminará "${nombre}" y todo lo que dependa de él.`,
      icon: 'warning', showCancelButton: true, confirmButtonColor: '#d33',
      confirmButtonText: 'Sí, eliminar', cancelButtonText: 'Cancelar',
    });
    if (!c.isConfirmed) return;
    try {
      const r = await fetch(`${API}/${recurso}/${id}/`, { method: 'DELETE', headers: headers(false) });
      if (r.ok || r.status === 204) recargar();
      else Swal.fire('Error', 'No se pudo eliminar.', 'error');
    } catch (e) { Swal.fire('Error', 'No se pudo eliminar.', 'error'); }
  };

  // ── Acciones por columna ────────────────────────────────────────────────
  const nuevoEquipo = async () => {
    const { value } = await Swal.fire({ title: 'Nuevo equipo', input: 'text', inputPlaceholder: 'Ej. TRACTOR', showCancelButton: true, confirmButtonText: 'Crear', inputValidator: v => !v && 'Escribe un nombre' });
    if (value) crear('equipos', { nombre: value.toUpperCase().trim(), activo: true }, cargarEquipos);
  };
  const editarEquipo = async (eq) => {
    const { value } = await Swal.fire({ title: 'Editar equipo', input: 'text', inputValue: eq.nombre, showCancelButton: true, confirmButtonText: 'Guardar' });
    if (value && value !== eq.nombre) editar('equipos', eq.id, { nombre: value.toUpperCase().trim() }, cargarEquipos);
  };

  const nuevaMarca = async () => {
    if (!equipoSel) return;
    const { value } = await Swal.fire({ title: `Nueva marca para ${equipoSel.nombre}`, input: 'text', inputPlaceholder: 'Ej. CAT', showCancelButton: true, confirmButtonText: 'Crear', inputValidator: v => !v && 'Escribe un nombre' });
    if (value) crear('marcas', { equipo: equipoSel.id, nombre: value.toUpperCase().trim(), activo: true }, () => cargarMarcas(equipoSel.id));
  };
  const editarMarca = async (ma) => {
    const { value } = await Swal.fire({ title: 'Editar marca', input: 'text', inputValue: ma.nombre, showCancelButton: true, confirmButtonText: 'Guardar' });
    if (value && value !== ma.nombre) editar('marcas', ma.id, { nombre: value.toUpperCase().trim() }, () => cargarMarcas(equipoSel.id));
  };

  const nuevoModelo = async () => {
    if (!marcaSel) return;
    const { value: form } = await Swal.fire({
      title: `Nuevo modelo para ${marcaSel.nombre}`,
      html:
        '<input id="sw-nombre" class="swal2-input" placeholder="Modelo (ej. D6, 320)">' +
        '<input id="sw-placa" class="swal2-input" placeholder="Placa (opcional, ej. CAN737)">',
      focusConfirm: false, showCancelButton: true, confirmButtonText: 'Crear',
      preConfirm: () => {
        const nombre = document.getElementById('sw-nombre').value.trim();
        if (!nombre) { Swal.showValidationMessage('El modelo es obligatorio'); return false; }
        return { nombre, placa: document.getElementById('sw-placa').value.trim() };
      },
    });
    if (form) crear('modelos', { marca: marcaSel.id, nombre: form.nombre, placa: form.placa || null, activo: true }, () => cargarModelos(marcaSel.id));
  };
  const editarModelo = async (mo) => {
    const { value: form } = await Swal.fire({
      title: 'Editar modelo',
      html:
        `<input id="sw-nombre" class="swal2-input" placeholder="Modelo" value="${mo.nombre || ''}">` +
        `<input id="sw-placa" class="swal2-input" placeholder="Placa" value="${mo.placa || ''}">`,
      focusConfirm: false, showCancelButton: true, confirmButtonText: 'Guardar',
      preConfirm: () => ({ nombre: document.getElementById('sw-nombre').value.trim(), placa: document.getElementById('sw-placa').value.trim() }),
    });
    if (form && form.nombre) editar('modelos', mo.id, { nombre: form.nombre, placa: form.placa || null }, () => cargarModelos(marcaSel.id));
  };

  if (!abierto) return null;

  return (
    <div className="mnt-overlay" onClick={onClose}>
      <div className="mnt-modal" onClick={e => e.stopPropagation()}>
        <div className="mnt-header">
          <h3>Mantenedor de equipos</h3>
          <button className="mnt-btn-x" onClick={onClose}><FaTimes /></button>
        </div>

        <div className="mnt-cols">
          {/* ── Columna Equipos ─────────────────────────────────────────── */}
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
                  <span className="mnt-item-name">{eq.nombre}{!eq.activo && <em> (inactivo)</em>}</span>
                  <span className="mnt-item-actions">
                    <button onClick={e => { e.stopPropagation(); editarEquipo(eq); }} title="Editar"><FaEdit /></button>
                    <button onClick={e => { e.stopPropagation(); eliminar('equipos', eq.id, cargarEquipos, eq.nombre); }} title="Eliminar" className="del"><FaTrash /></button>
                    <FaChevronRight className="mnt-item-arrow" />
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* ── Columna Marcas ──────────────────────────────────────────── */}
          <div className="mnt-col">
            <div className="mnt-col-head">
              <span>Marcas {equipoSel && <small>de {equipoSel.nombre}</small>}</span>
              <button className="mnt-btn-add" onClick={nuevaMarca} disabled={!equipoSel}><FaPlus /> Nueva</button>
            </div>
            <div className="mnt-list">
              {!equipoSel && <div className="mnt-empty">Selecciona un equipo →</div>}
              {equipoSel && marcas.length === 0 && <div className="mnt-empty">Sin marcas. Crea la primera.</div>}
              {marcas.map(ma => (
                <div key={ma.id} className={`mnt-item ${marcaSel?.id === ma.id ? 'sel' : ''}`} onClick={() => setMarcaSel(ma)}>
                  <span className="mnt-item-name">{ma.nombre}{!ma.activo && <em> (inactivo)</em>}</span>
                  <span className="mnt-item-actions">
                    <button onClick={e => { e.stopPropagation(); editarMarca(ma); }} title="Editar"><FaEdit /></button>
                    <button onClick={e => { e.stopPropagation(); eliminar('marcas', ma.id, () => cargarMarcas(equipoSel.id), ma.nombre); }} title="Eliminar" className="del"><FaTrash /></button>
                    <FaChevronRight className="mnt-item-arrow" />
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* ── Columna Modelos ─────────────────────────────────────────── */}
          <div className="mnt-col">
            <div className="mnt-col-head">
              <span>Modelos / Placas {marcaSel && <small>de {marcaSel.nombre}</small>}</span>
              <button className="mnt-btn-add" onClick={nuevoModelo} disabled={!marcaSel}><FaPlus /> Nuevo</button>
            </div>
            <div className="mnt-list">
              {!marcaSel && <div className="mnt-empty">Selecciona una marca →</div>}
              {marcaSel && modelos.length === 0 && <div className="mnt-empty">Sin modelos. Crea el primero.</div>}
              {modelos.map(mo => (
                <div key={mo.id} className="mnt-item">
                  <span className="mnt-item-name">{mo.nombre}{mo.placa && <span className="mnt-placa"> / {mo.placa}</span>}{!mo.activo && <em> (inactivo)</em>}</span>
                  <span className="mnt-item-actions">
                    <button onClick={() => editarModelo(mo)} title="Editar"><FaEdit /></button>
                    <button onClick={() => eliminar('modelos', mo.id, () => cargarModelos(marcaSel.id), mo.nombre)} title="Eliminar" className="del"><FaTrash /></button>
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="mnt-footer">
          <span className="mnt-hint">Los cambios se reflejan de inmediato en el formulario del parte diario.</span>
          <button className="mnt-btn-cerrar" onClick={onClose}>Cerrar</button>
        </div>
      </div>
    </div>
  );
}