// ═══════════════════════════════════════════════════════════════════════════
//  MantenedorEquipos.jsx
//  Mantenedor (CRUD) de catálogos. Flujo:
//    Equipo → Origen (JURP / Externa) → POTENCIA/CAPACIDAD → Placas
//  Cada "placa" es una máquina física con:
//    - código autogenerado (JURP001… o EX01…) según origen
//    - placa única
//    - estado: 0 disponible / 1 no disponible (se crea en 0)
//  Nota: en el modelo de datos, la POTENCIA/CAPACIDAD se guarda en la tabla
//  "marcas" (campo nombre). Solo cambia la etiqueta visible.
//
//  En el origen Externa hay un botón que copia el catálogo de JURP hasta el
//  nivel de POTENCIA/CAPACIDAD. Las placas NO se copian: cada máquina física
//  pertenece a un solo origen.
// ═══════════════════════════════════════════════════════════════════════════
import { useState, useEffect, useCallback } from 'react';
import Swal from 'sweetalert2';
import { FaPlus, FaEdit, FaTrash, FaTimes, FaChevronRight, FaSync, FaCircle, FaSearch, FaTools, FaCopy } from 'react-icons/fa';
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
  const [buscarEquipo, setBuscarEquipo] = useState('');
  const [buscarMarca, setBuscarMarca] = useState('');
  const [cargando, setCargando] = useState(false);
  const [copiando, setCopiando] = useState(false);

  // ── Cargas ──────────────────────────────────────────────────────────────
  // Equipos filtrados por el origen seleccionado (JURP / Externa).
  const cargarEquipos = useCallback(async (origen) => {
    setCargando(true);
    try {
      const r = await fetch(`${API}/equipos/?origen=${origen}`);
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

  // Placas de la marca (el origen ya viene heredado del equipo).
  const cargarPlacas = useCallback(async (marcaId) => {
    if (!marcaId) { setPlacas([]); return; }
    try {
      const r = await fetch(`${API}/modelos/?marca=${marcaId}`);
      if (r.ok) setPlacas(await r.json());
    } catch (e) { console.error(e); }
  }, []);

  // Al abrir o cambiar el origen: recargar equipos y limpiar toda la cadena.
  useEffect(() => {
    if (abierto) { cargarEquipos(origenSel); setEquipoSel(null); setMarcaSel(null); setMarcas([]); setPlacas([]); setBuscarEquipo(''); setBuscarMarca(''); }
  }, [abierto, origenSel, cargarEquipos]);
  useEffect(() => { cargarMarcas(equipoSel?.id); setMarcaSel(null); setPlacas([]); setBuscarMarca(''); }, [equipoSel, cargarMarcas]);
  useEffect(() => { cargarPlacas(marcaSel?.id); }, [marcaSel, cargarPlacas]);

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

  // ── Copiar el catálogo de JURP a Externa (hasta POTENCIA/CAPACIDAD) ─────
  // No copia placas: cada máquina física pertenece a un solo origen.
  // Compara por nombre, así que se puede repetir sin duplicar nada.
  const copiarDeJURP = async () => {
    const c = await Swal.fire({
      title: 'Copiar catálogo de JURP',
      html: 'Se copiarán a <b>Externa</b> los <b>equipos</b> y sus <b>potencias / capacidades</b>.'
          + '<br><br><small style="color:#64748b">Las placas no se copian. Lo que ya exista con el mismo nombre se respeta.</small>',
      icon: 'question', showCancelButton: true,
      confirmButtonText: 'Sí, copiar', cancelButtonText: 'Cancelar',
      confirmButtonColor: '#1268C3',
    });
    if (!c.isConfirmed) return;

    setCopiando(true);
    try {
      const rEq = await fetch(`${API}/equipos/?origen=JURP`);
      if (!rEq.ok) throw new Error('No se pudo leer el catálogo de JURP.');
      const equiposJurp = await rEq.json();
      if (!equiposJurp.length) {
        Swal.fire('Sin datos', 'JURP no tiene equipos registrados.', 'info');
        return;
      }

      // Equipos externos que ya existen, indexados por nombre.
      const rExt = await fetch(`${API}/equipos/?origen=EXTERNA`);
      const equiposExt = rExt.ok ? await rExt.json() : [];
      const porNombre = new Map(equiposExt.map(e => [(e.nombre || '').trim().toUpperCase(), e]));

      let nuevosEquipos = 0, nuevasPotencias = 0, fallos = 0;

      for (const eq of equiposJurp) {
        const clave = (eq.nombre || '').trim().toUpperCase();
        if (!clave) continue;

        // 1) el equipo en Externa: se reutiliza si ya está, si no se crea
        let destino = porNombre.get(clave);
        if (!destino) {
          const r = await fetch(`${API}/equipos/`, {
            method: 'POST', headers: headers(),
            body: JSON.stringify({ nombre: clave, origen: 'EXTERNA', requiere_placa: !!eq.requiere_placa, activo: true }),
          });
          if (!r.ok) { fallos++; continue; }
          destino = await r.json();
          porNombre.set(clave, destino);
          nuevosEquipos++;
        }

        // 2) sus potencias / capacidades
        const [rPotJurp, rPotExt] = await Promise.all([
          fetch(`${API}/marcas/?equipo=${eq.id}`),
          fetch(`${API}/marcas/?equipo=${destino.id}`),
        ]);
        const potJurp = rPotJurp.ok ? await rPotJurp.json() : [];
        const potExt = rPotExt.ok ? await rPotExt.json() : [];
        const yaEstan = new Set(potExt.map(m => (m.nombre || '').trim().toUpperCase()));

        for (const p of potJurp) {
          const nombre = (p.nombre || '').trim().toUpperCase();
          if (!nombre || yaEstan.has(nombre)) continue;
          const r = await fetch(`${API}/marcas/`, {
            method: 'POST', headers: headers(),
            body: JSON.stringify({ equipo: destino.id, nombre, activo: true }),
          });
          if (r.ok) { yaEstan.add(nombre); nuevasPotencias++; } else { fallos++; }
        }
      }

      await cargarEquipos('EXTERNA');
      setEquipoSel(null); setMarcaSel(null); setMarcas([]); setPlacas([]);

      const sinCambios = nuevosEquipos === 0 && nuevasPotencias === 0;
      Swal.fire({
        icon: sinCambios ? 'info' : 'success',
        title: sinCambios ? 'Ya estaba todo copiado' : 'Catálogo copiado',
        html: sinCambios
          ? 'Externa ya tenía los mismos equipos y potencias que JURP.'
          : `Se agregaron <b>${nuevosEquipos}</b> equipo(s) y <b>${nuevasPotencias}</b> potencia(s) / capacidad(es).`
            + (fallos ? `<br><br><small style="color:#b45309">${fallos} registro(s) no se pudieron crear.</small>` : ''),
      });
    } catch (e) {
      Swal.fire('Error', e.message || 'No se pudo copiar el catálogo.', 'error');
    } finally {
      setCopiando(false);
    }
  };

  // ── Equipos ────────────────────────────────────────────────────────────
  const nuevoEquipo = async () => {
    const origenTxt = origenSel === 'JURP' ? 'JURP (propia)' : 'Externa';
    const { value: form } = await Swal.fire({
      title: `Nuevo equipo · ${origenTxt}`,
      html:
        '<input id="sw-nombre" class="swal2-input" placeholder="Ej. CAMIONETA, TRACTOR S/ORUGAS">' +
        '<label style="display:flex;align-items:center;gap:8px;justify-content:center;margin-top:12px;font-size:14px;cursor:pointer">' +
        '<input type="checkbox" id="sw-placa-chk" style="width:16px;height:16px"> ¿Este equipo tiene placa? (camioneta, cama baja)</label>',
      focusConfirm: false, showCancelButton: true, confirmButtonText: 'Crear',
      preConfirm: () => {
        const nombre = document.getElementById('sw-nombre').value.trim();
        if (!nombre) { Swal.showValidationMessage('Escribe un nombre'); return false; }
        return { nombre, requiere_placa: document.getElementById('sw-placa-chk').checked };
      },
    });
    if (form) crear('equipos', { nombre: form.nombre.toUpperCase(), origen: origenSel, requiere_placa: form.requiere_placa, activo: true }, () => cargarEquipos(origenSel));
  };
  const editarEquipo = async (eq) => {
    const { value: form } = await Swal.fire({
      title: 'Editar equipo',
      html:
        `<input id="sw-nombre" class="swal2-input" placeholder="Nombre" value="${eq.nombre}">` +
        `<label style="display:flex;align-items:center;gap:8px;justify-content:center;margin-top:12px;font-size:14px;cursor:pointer">` +
        `<input type="checkbox" id="sw-placa-chk" ${eq.requiere_placa ? 'checked' : ''} style="width:16px;height:16px"> ¿Este equipo tiene placa?</label>`,
      focusConfirm: false, showCancelButton: true, confirmButtonText: 'Guardar',
      preConfirm: () => {
        const nombre = document.getElementById('sw-nombre').value.trim();
        if (!nombre) { Swal.showValidationMessage('Escribe un nombre'); return false; }
        return { nombre, requiere_placa: document.getElementById('sw-placa-chk').checked };
      },
    });
    if (form) editar('equipos', eq.id, { nombre: form.nombre.toUpperCase(), requiere_placa: form.requiere_placa }, () => cargarEquipos(origenSel));
  };

  // ── POTENCIA / CAPACIDAD (guardado en tabla "marcas") ──────────────────
  const nuevaMarca = async () => {
    if (!equipoSel) return;
    const { value } = await Swal.fire({ title: `Nueva POTENCIA / CAPACIDAD para ${equipoSel.nombre}`, input: 'text', inputPlaceholder: 'Ej. 170-250 HP · 1.1-2.75 YD3', showCancelButton: true, confirmButtonText: 'Crear', inputValidator: v => !v && 'Escribe la potencia / capacidad' });
    if (value) crear('marcas', { equipo: equipoSel.id, nombre: value.toUpperCase().trim(), activo: true }, () => cargarMarcas(equipoSel.id));
  };
  const editarMarca = async (ma) => {
    const { value } = await Swal.fire({ title: 'Editar POTENCIA / CAPACIDAD', input: 'text', inputValue: ma.nombre, showCancelButton: true, confirmButtonText: 'Guardar' });
    if (value && value !== ma.nombre) editar('marcas', ma.id, { nombre: value.toUpperCase().trim() }, () => cargarMarcas(equipoSel.id));
  };

  // ── Placas (máquinas) ──────────────────────────────────────────────────
  const nuevaPlaca = async () => {
    if (!marcaSel) return;
    const origenTxt = origenSel === 'JURP' ? 'JURP (propia)' : 'Externa';
    const pidePlaca = !!equipoSel?.requiere_placa;
    const { value: form } = await Swal.fire({
      title: `Nueva máquina · ${origenTxt}`,
      html:
        `<p style="font-size:13px;color:#64748b;margin:0 0 10px">Equipo: <b>${equipoSel.nombre}</b> · Pot./Cap.: <b>${marcaSel.nombre}</b><br>El código se generará automáticamente.</p>` +
        '<input id="sw-modelo" class="swal2-input" placeholder="Modelo (ej. D8T, 320)">' +
        (pidePlaca ? '<input id="sw-placa" class="swal2-input" placeholder="Placa (ej. ABC-123)">' : ''),
      focusConfirm: false, showCancelButton: true, confirmButtonText: 'Crear',
      preConfirm: () => {
        const modelo = document.getElementById('sw-modelo').value.trim();
        if (!modelo) { Swal.showValidationMessage('El modelo es obligatorio'); return false; }
        if (pidePlaca) {
          const placa = document.getElementById('sw-placa').value.trim();
          if (!placa) { Swal.showValidationMessage('La placa es obligatoria para este equipo'); return false; }
          return { modelo, placa };
        }
        return { modelo, placa: '' };
      },
    });
    if (form) crear('modelos', { marca: marcaSel.id, origen: equipoSel?.origen || origenSel, modelo: form.modelo.toUpperCase(), placa: form.placa ? form.placa.toUpperCase() : null }, () => cargarPlacas(marcaSel.id));
  };
  const editarPlaca = async (mo) => {
    const pidePlaca = !!equipoSel?.requiere_placa;
    const { value: form } = await Swal.fire({
      title: `Editar máquina · ${mo.codigo}`,
      html:
        `<input id="sw-modelo" class="swal2-input" placeholder="Modelo" value="${mo.modelo || ''}">` +
        (pidePlaca ? `<input id="sw-placa" class="swal2-input" placeholder="Placa" value="${mo.placa || ''}">` : ''),
      focusConfirm: false, showCancelButton: true, confirmButtonText: 'Guardar',
      preConfirm: () => {
        const modelo = document.getElementById('sw-modelo').value.trim();
        if (!modelo) { Swal.showValidationMessage('El modelo es obligatorio'); return false; }
        if (pidePlaca) {
          const placa = document.getElementById('sw-placa').value.trim();
          if (!placa) { Swal.showValidationMessage('La placa es obligatoria para este equipo'); return false; }
          return { modelo, placa };
        }
        return { modelo, placa: '' };
      },
    });
    if (form) editar('modelos', mo.id, { modelo: form.modelo.toUpperCase(), placa: form.placa ? form.placa.toUpperCase() : null }, () => cargarPlacas(marcaSel.id));
  };
  // Alterna estado 0 (disponible) ⇄ 1 (no disponible).
  const toggleEstado = async (mo) => {
    const nuevo = mo.estado === 0 ? 1 : 0;
    editar('modelos', mo.id, { estado: nuevo }, () => cargarPlacas(marcaSel.id));
  };

  // Pone / quita una máquina de mantenimiento (con observación).
  const toggleMantenimiento = async (mo) => {
    const entrando = !mo.en_mantenimiento;
    const { value: obs, isConfirmed } = await Swal.fire({
      title: entrando ? `Enviar a mantenimiento · ${mo.codigo}` : `Marcar operativa · ${mo.codigo}`,
      input: 'textarea',
      inputLabel: 'Observación (opcional)',
      inputPlaceholder: entrando
        ? 'Ej. Cambio de aceite, falla hidráulica...'
        : 'Ej. Mantenimiento completado, lista para operar',
      inputValue: entrando ? '' : (mo.mantenimiento_obs || ''),
      showCancelButton: true,
      confirmButtonText: entrando ? 'Enviar a mantenimiento' : 'Marcar operativa',
      confirmButtonColor: entrando ? '#d97706' : '#16a34a',
    });
    if (!isConfirmed) return;
    try {
      const r = await fetch(`${API}/modelos/${mo.id}/mantenimiento/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ en_mantenimiento: entrando, observacion: obs || '' }),
      });
      if (r.ok) {
        cargarPlacas(marcaSel.id);
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

  // Listas filtradas por los buscadores.
  const equiposFiltrados = equipos.filter(eq =>
    !buscarEquipo.trim() || eq.nombre.toLowerCase().includes(buscarEquipo.toLowerCase().trim()));
  const marcasFiltradas = marcas.filter(ma =>
    !buscarMarca.trim() || ma.nombre.toLowerCase().includes(buscarMarca.toLowerCase().trim()));

  if (!abierto) return null;

  return (
    <div className="mnt-overlay" onClick={onClose}>
      <div className="mnt-modal" onClick={e => e.stopPropagation()}>
        <div className="mnt-header">
          <h3>Mantenedor de maquinaria</h3>
          <button className="mnt-btn-x" onClick={onClose}><FaTimes /></button>
        </div>

        {/* ── Paso 1: Origen (filtra toda la jerarquía) ──────────────────── */}
        <div className="mnt-origen-bar">
          <span className="mnt-origen-lbl">1 · Selecciona el origen:</span>
          <button className={`mnt-origen-btn ${origenSel === 'JURP' ? 'on' : ''}`} onClick={() => setOrigenSel('JURP')}>JURP (propia)</button>
          <button className={`mnt-origen-btn ${origenSel === 'EXTERNA' ? 'on ext' : ''}`} onClick={() => setOrigenSel('EXTERNA')}>Externa</button>

          {/* Copiar el catálogo de JURP (solo tiene sentido en Externa) */}
          {origenSel === 'EXTERNA' && (
            <button className="mnt-btn-add" onClick={copiarDeJURP} disabled={copiando}
              title="Copia los equipos y sus potencias / capacidades desde JURP"
              style={{ marginLeft: 'auto', background: '#1268C3' }}>
              {copiando ? <><FaSync className="mnt-spin" /> Copiando…</> : <><FaCopy /> Copiar catálogo de JURP</>}
            </button>
          )}
        </div>

        <div className="mnt-cols">
          {/* ── Equipos ─────────────────────────────────────────────────── */}
          <div className="mnt-col">
            <div className="mnt-col-head">
              <span>2 · Equipos <small>{origenSel === 'JURP' ? 'JURP' : 'Externa'}</small></span>
              <button className="mnt-btn-add" onClick={nuevoEquipo}><FaPlus /> Nuevo</button>
            </div>
            <div style={{ position:'relative', padding:'8px 10px', borderBottom:'1px solid #e2e8f0' }}>
              <FaSearch size={11} style={{ position:'absolute', left:'20px', top:'50%', transform:'translateY(-50%)', color:'#94a3b8' }} />
              <input type="text" placeholder="Buscar equipo..." value={buscarEquipo} onChange={e => setBuscarEquipo(e.target.value)}
                style={{ width:'100%', padding:'6px 8px 6px 28px', border:'1px solid #cbd5e1', borderRadius:'6px', fontSize:'12px', boxSizing:'border-box' }} />
              {buscarEquipo && <button onClick={() => setBuscarEquipo('')} style={{ position:'absolute', right:'18px', top:'50%', transform:'translateY(-50%)', background:'none', border:'none', cursor:'pointer', color:'#94a3b8', display:'flex', padding:0 }}><FaTimes size={11} /></button>}
            </div>
            <div className="mnt-list">
              {(cargando || copiando) && <div className="mnt-empty"><FaSync className="mnt-spin" /> {copiando ? 'Copiando catálogo…' : 'Cargando...'}</div>}
              {!cargando && !copiando && equipos.length === 0 && (
                <div className="mnt-empty">
                  Sin equipos {origenSel === 'JURP' ? 'propios' : 'externos'}.
                  {origenSel === 'EXTERNA' ? ' Créalos o copia el catálogo de JURP.' : ' Crea el primero.'}
                </div>
              )}
              {!cargando && !copiando && equipos.length > 0 && equiposFiltrados.length === 0 && <div className="mnt-empty">Ningún equipo coincide con "{buscarEquipo}".</div>}
              {!copiando && equiposFiltrados.map(eq => (
                <div key={eq.id} className={`mnt-item ${equipoSel?.id === eq.id ? 'sel' : ''}`} onClick={() => setEquipoSel(eq)}>
                  <span className="mnt-item-name">{eq.nombre}</span>
                  <span className="mnt-item-actions">
                    <button onClick={e => { e.stopPropagation(); editarEquipo(eq); }} title="Editar"><FaEdit /></button>
                    <button onClick={e => { e.stopPropagation(); eliminar('equipos', eq.id, () => cargarEquipos(origenSel), eq.nombre); }} title="Eliminar" className="del"><FaTrash /></button>
                    <FaChevronRight className="mnt-item-arrow" />
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* ── POTENCIA / CAPACIDAD ────────────────────────────────────── */}
          <div className="mnt-col">
            <div className="mnt-col-head">
              <span>3 · POTENCIA / CAPACIDAD {equipoSel && <small>de {equipoSel.nombre}</small>}</span>
              <button className="mnt-btn-add" onClick={nuevaMarca} disabled={!equipoSel}><FaPlus /> Nueva</button>
            </div>
            {equipoSel && (
              <div style={{ position:'relative', padding:'8px 10px', borderBottom:'1px solid #e2e8f0' }}>
                <FaSearch size={11} style={{ position:'absolute', left:'20px', top:'50%', transform:'translateY(-50%)', color:'#94a3b8' }} />
                <input type="text" placeholder="Buscar potencia / capacidad..." value={buscarMarca} onChange={e => setBuscarMarca(e.target.value)}
                  style={{ width:'100%', padding:'6px 8px 6px 28px', border:'1px solid #cbd5e1', borderRadius:'6px', fontSize:'12px', boxSizing:'border-box' }} />
                {buscarMarca && <button onClick={() => setBuscarMarca('')} style={{ position:'absolute', right:'18px', top:'50%', transform:'translateY(-50%)', background:'none', border:'none', cursor:'pointer', color:'#94a3b8', display:'flex', padding:0 }}><FaTimes size={11} /></button>}
              </div>
            )}
            <div className="mnt-list">
              {!equipoSel && <div className="mnt-empty">Selecciona un equipo →</div>}
              {equipoSel && marcas.length === 0 && <div className="mnt-empty">Sin registros. Crea el primero.</div>}
              {equipoSel && marcas.length > 0 && marcasFiltradas.length === 0 && <div className="mnt-empty">Ninguna coincide con "{buscarMarca}".</div>}
              {marcasFiltradas.map(ma => (
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
              <span>4 · Modelo / Placa {marcaSel && <small>· {origenSel === 'JURP' ? 'JURP' : 'Externa'}</small>}</span>
              <button className="mnt-btn-add" onClick={nuevaPlaca} disabled={!marcaSel}><FaPlus /> Nueva</button>
            </div>
            <div className="mnt-list">
              {!marcaSel && <div className="mnt-empty">Selecciona pot./cap. →</div>}
              {marcaSel && placas.length === 0 && <div className="mnt-empty">Sin placas {origenSel === 'JURP' ? 'JURP' : 'externas'}. Crea la primera.</div>}
              {placas.map(mo => (
                <div key={mo.id} className="mnt-item mnt-item-placa">
                  <span className="mnt-item-name">
                    <span className={`mnt-codigo ${mo.origen === 'JURP' ? 'jurp' : 'ext'}`}>{mo.codigo}</span>
                    <span className="mnt-placa-txt">{mo.placa ? `${mo.modelo || ''} · ${mo.placa}` : (mo.modelo || 's/modelo')}</span>
                  </span>
                  <span className="mnt-item-actions always">
                    <button
                      className={`mnt-estado ${mo.estado === 0 ? 'disp' : 'nodisp'}`}
                      onClick={() => toggleEstado(mo)}
                      disabled={mo.en_mantenimiento}
                      title={mo.en_mantenimiento
                        ? 'En mantenimiento (no editable aquí)'
                        : (mo.estado === 0 ? 'Disponible (clic para marcar no disponible)' : 'No disponible (clic para marcar disponible)')}
                    >
                      <FaCircle /> {mo.estado === 0 ? 'Disponible' : 'No disp.'}
                    </button>
                    <button
                      className={`mnt-estado ${mo.en_mantenimiento ? 'mant on' : 'mant'}`}
                      onClick={() => toggleMantenimiento(mo)}
                      title={mo.en_mantenimiento ? 'En mantenimiento (clic para marcar operativa)' : 'Enviar a mantenimiento'}
                    >
                      <FaTools /> {mo.en_mantenimiento ? 'En mant.' : 'Mant.'}
                    </button>
                    <button onClick={() => editarPlaca(mo)} title="Editar placa"><FaEdit /></button>
                    <button onClick={() => eliminar('modelos', mo.id, () => cargarPlacas(marcaSel.id), mo.codigo)} title="Eliminar" className="del"><FaTrash /></button>
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="mnt-footer">
          <span className="mnt-hint">Código automático: JURP001... (propia) · EX01... (externa). Placa única. Se crea disponible.</span>
          <button className="mnt-btn-cerrar" onClick={onClose}>Cerrar</button>
        </div>
      </div>
    </div>
  );
}