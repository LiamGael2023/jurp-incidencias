import { useState, useEffect } from 'react';
import { 
  FaSyncAlt, FaEye, FaMapMarkerAlt, 
  FaCalendarAlt, FaCamera, FaVideo, 
  FaImage, FaChevronLeft, FaChevronRight, FaTimes, FaPlus, FaFileInvoice, FaSave, FaFilePdf 
} from 'react-icons/fa';
import './Incidentes.css';
import Swal from 'sweetalert2';

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

  // --- ESTADOS DEL MODAL PDF (NUEVO) ---
  const [modalPdfAbierto, setModalPdfAbierto] = useState(false);
  const [pdfUrlActivo, setPdfUrlActivo] = useState(null);

  // Funciones auxiliares para valores por defecto
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
  const token = localStorage.getItem('userToken'); // 1. Sacamos el token
  if (!token) return;
  
  setCargando(true);
  try {
    // 2. Usamos la ruta relativa y pasamos el token en los headers
    const res = await fetch('/api/v1/mobile/hi-incidents/list/', { 
      headers: { 
        'Content-Type': 'application/json', 
        'Authorization': `Token ${token}` // ¡Aquí va el token!
      } 
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

  const cargarCosteosGuardados = async (incidenteId) => {
  const BASE_URL = ''; // Usamos el proxy de Vercel
  const token = localStorage.getItem('userToken'); // Obtenemos el token
  
  try {
    // Preparamos los headers con el token
    const headers = { 'Authorization': `Token ${token}` };

    const [resPers, resMat, resMaq] = await Promise.all([
      fetch(`${BASE_URL}/api/v1/mobile/operations/incident-personnels/`, { headers }),
      fetch(`${BASE_URL}/api/v1/mobile/operations/incident-materials/`, { headers }),
      fetch(`${BASE_URL}/api/v1/mobile/operations/daily-part-heavy-equipments/`, { headers })
    ]);

    const [dataPers, dataMat, dataMaq] = await Promise.all([
      resPers.json(), resMat.json(), resMaq.json()
    ]);

      const listPers = Array.isArray(dataPers) ? dataPers : (dataPers.results || []);
      const listMat = Array.isArray(dataMat) ? dataMat : (dataMat.results || []);
      const listMaq = Array.isArray(dataMaq) ? dataMaq : (dataMaq.results || []);

      const idStr = String(incidenteId);

      const formatPers = listPers.filter(i => String(i.incident_report) === idStr).map(i => ({
        idLocal: `db-pers-${i.id}`, tipo: 'Personal', descripcionResumen: i.description,
        cantidad: parseFloat(i.quantity_hours), precioUnitario: parseFloat(i.unit_price),
        total: parseFloat(i.quantity_hours) * parseFloat(i.unit_price), guardadoEnDB: true
      }));

      const formatMat = listMat.filter(i => String(i.incident_report) === idStr).map(i => ({
        idLocal: `db-mat-${i.id}`, tipo: 'Insumo', descripcionResumen: i.description,
        cantidad: parseFloat(i.quantity), precioUnitario: parseFloat(i.unit_price),
        total: parseFloat(i.quantity) * parseFloat(i.unit_price), guardadoEnDB: true
      }));

      const formatMaq = listMaq.filter(i => String(i.incident_report) === idStr).map(i => ({
        idLocal: `db-maq-${i.id}`, dbId: i.id, tipo: 'Maquinaria', 
        descripcionResumen: `Parte N° ${i.part_number} | ${i.equipment_name}\nActividad: ${i.activities}`,
        cantidad: Math.max(0, parseFloat(i.end_horometer) - parseFloat(i.start_horometer)),
        precioUnitario: parseFloat(i.unit_price),
        total: Math.max(0, parseFloat(i.end_horometer) - parseFloat(i.start_horometer)) * parseFloat(i.unit_price),
        guardadoEnDB: true
      }));

      setRecursos([...formatPers, ...formatMat, ...formatMaq]);
    } catch (error) {
      console.error("❌ Error al obtener los recursos guardados:", error);
    }
  };

  useEffect(() => { obtenerIncidentes(); }, []);

  const abrirModal = (inc) => {
    setIncidenteActivo(inc); 
    setRecursos([]); 
    setNuevoRecurso({...estadoInicialRecurso, numeroParte: generarCorrelativo()});
    setModalAbierto(true);
    cargarCosteosGuardados(inc.id); 
  };

  // NUEVA FUNCIÓN PARA ABRIR EL MODAL DEL PDF
  const abrirModalPdf = (dbId) => {
    const url = `https://gideonstudio.duckdns.org/api/v1/mobile/operations/daily-part-heavy-equipments/${dbId}/pdf/`;
    setPdfUrlActivo(url);
    setModalPdfAbierto(true);
  };

  const horasMaquina = (nuevoRecurso.hmFin && nuevoRecurso.hmInicio) 
    ? Math.max(0, (parseFloat(nuevoRecurso.hmFin) - parseFloat(nuevoRecurso.hmInicio))).toFixed(1) 
    : 0;

  const volumenMetrado = nuevoRecurso.incluirMetrado 
    ? (((parseFloat(nuevoRecurso.anchoSup)||0 + parseFloat(nuevoRecurso.anchoInf)||0) / 2) * (parseFloat(nuevoRecurso.altura)||0) * (parseFloat(nuevoRecurso.longitud)||0)).toFixed(2)
    : 0;

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
    } else {
      if (!descFinal) return Swal.fire({ icon: 'warning', title: 'Atención', text: 'Ingresa una descripción' });
    }

    const recursoCalculado = {
      ...nuevoRecurso,
      idLocal: Date.now(),
      descripcionResumen: descFinal, 
      cantidad: cantFinal,
      precioUnitario: parseFloat(nuevoRecurso.precioUnitario) || 0,
      total: cantFinal * (parseFloat(nuevoRecurso.precioUnitario) || 0),
      guardadoEnDB: false
    };

    setRecursos([...recursos, recursoCalculado]);
    setNuevoRecurso({...estadoInicialRecurso, numeroParte: generarCorrelativo()});
  };

  const eliminarRecurso = (idLocal) => setRecursos(recursos.filter(r => r.idLocal !== idLocal));
  const costoTotalIncidente = recursos.reduce((sum, item) => sum + item.total, 0);

  const recursosNuevos = recursos.filter(r => !r.guardadoEnDB);
  if (recursosNuevos.length === 0) return Swal.fire({ icon: 'info', title: 'Todo al día', text: 'No hay recursos nuevos.' });
  
  setGuardando(true);
  const BASE_URL = ''; // Usamos proxy
  const token = localStorage.getItem('userToken'); // Obtenemos el token

  try {
    for (const r of recursosNuevos) {
      let endpoint = '';
      let formData = new FormData();
      formData.append('incident_report', incidenteActivo.id);

        if (r.tipo === 'Personal') {
          endpoint = `${BASE_URL}/api/v1/mobile/operations/incident-personnels/`;
          formData.append('description', r.descripcion);
          formData.append('quantity_hours', r.cantidad);
          formData.append('unit_price', r.precioUnitario);
        } else if (r.tipo === 'Insumo') {
          endpoint = `${BASE_URL}/api/v1/mobile/operations/incident-materials/`;
          formData.append('description', r.descripcion);
          formData.append('quantity', r.cantidad);
          formData.append('unit_price', r.precioUnitario);
        } else if (r.tipo === 'Maquinaria') {
          endpoint = `${BASE_URL}/api/v1/mobile/operations/daily-part-heavy-equipments/`;
          formData.append('part_number', r.numeroParte);
          formData.append('date', r.fechaParte);
          formData.append('shift', r.turno);
          formData.append('work_zone_text', r.zonaTrabajo);
          formData.append('provider', r.proveedor);
          formData.append('operator', r.operador);
          formData.append('equipment_name', r.equipo === 'OTRO' ? r.equipoOtro : r.equipo);
          formData.append('brand_name', r.marca === 'OTRO' ? r.marcaOtro : r.marca);
          formData.append('model_plate', r.placa);
          formData.append('start_horometer', r.hmInicio);
          formData.append('end_horometer', r.hmFin);
          formData.append('fuel_gallons', r.combustible || 0);
          formData.append('fuel_voucher', r.vale);
          formData.append('activities', r.actividad);
          formData.append('observations', r.observaciones);
          formData.append('unit_price', r.precioUnitario);
          if (r.fotoParte) formData.append('part_photo', r.fotoParte);
          if (r.fotoVale) formData.append('voucher_photo', r.fotoVale);
          if (r.incluirMetrado) {
            formData.append('width_top', r.anchoSup);
            formData.append('width_bottom', r.anchoInf);
            formData.append('height', r.altura);
            formData.append('length', r.longitud);
          }
        }

        const res = await fetch(endpoint, { 
          method: 'POST', 
          headers: {
            'Authorization': `Token ${token}` // Autenticación
            // Nota: Con FormData NO se pone 'Content-Type', el navegador lo pone solo
          },
          body: formData 
        });
        if (!res.ok) throw new Error(`Error al guardar el registro de ${r.tipo}`);
      }
      
      Swal.fire({ icon: 'success', title: 'Éxito', text: 'Se guardó correctamente', confirmButtonColor: '#206bc4' });
      setRecursos([]); 
      setModalAbierto(false); 
    } catch (error) {
      console.error(error);
      Swal.fire({ icon: 'error', title: 'Error', text: 'Hubo un error al guardar en la base de datos de pruebas.' });
    } finally {
      setGuardando(false);
    }
  };

  const indexUltimoItem = paginaActual * itemsPorPagina;
  const indexPrimerItem = indexUltimoItem - itemsPorPagina;
  const incidentesActuales = incidentes.slice(indexPrimerItem, indexUltimoItem);
  const totalPaginas = Math.ceil(incidentes.length / itemsPorPagina);

  const getEstadoBadge = (estado) => {
    switch (estado) {
      case 'pat': return <span className="tbl-badge bg-orange-lt">Pendiente</span>;
      case 'ate': return <span className="tbl-badge bg-blue-lt">En Atención</span>;
      case 'cer': return <span className="tbl-badge bg-green-lt">Cerrado</span>;
      default: return <span className="tbl-badge bg-secondary-lt">{estado}</span>;
    }
  };

  const getGravedadBadge = (gravedad) => {
    switch (gravedad) {
      case 'lev': return <span className="tbl-badge bg-green-lt">Leve</span>;
      case 'mod': return <span className="tbl-badge bg-yellow-lt">Moderada</span>;
      case 'gra': return <span className="tbl-badge bg-red-lt">Grave</span>;
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
                  <div className="tbl-card-img-top">
                    {inc.imagenUrl ? <img src={inc.imagenUrl} alt="Evidencia" /> : <div className="tbl-img-placeholder"><FaCamera size={24} /><span>Sin Evidencia</span></div>}
                    <div className="tbl-card-badges">{getEstadoBadge(inc.estado)}{getGravedadBadge(inc.gravedad)}</div>
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

      {/* ---------------- MODAL PRINCIPAL (GESTIÓN) ---------------- */}
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
                    <div style={{ display:'flex', alignItems:'center', gap:'8px', marginBottom:'20px', color:'#206bc4', fontWeight:'bold', fontSize:'16px' }}>
                      <FaFileInvoice /> Formulario: Parte Diario de Maquinaria
                    </div>

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
                ) : (
                  <div className="tbl-row tbl-mb-3">
                    <div className="tbl-col"><label className="tbl-form-label">Descripción</label><input type="text" className="tbl-form-control" placeholder={nuevoRecurso.tipo === 'Personal' ? "Ej. Operario, Peón..." : "Ej. Piedra chancada, Cemento..."} value={nuevoRecurso.descripcion} onChange={e => setNuevoRecurso({...nuevoRecurso, descripcion: e.target.value})} /></div>
                    <div className="tbl-col-2"><label className="tbl-form-label">Cant.</label><input type="number" className="tbl-form-control" value={nuevoRecurso.cantidad} onChange={e => setNuevoRecurso({...nuevoRecurso, cantidad: e.target.value})} /></div>
                    <div className="tbl-col-2"><label className="tbl-form-label">Precio Unit. (S/)</label><input type="number" className="tbl-form-control" value={nuevoRecurso.precioUnitario} onChange={e => setNuevoRecurso({...nuevoRecurso, precioUnitario: e.target.value})} /></div>
                  </div>
                )}
                
                <div style={{display: 'flex', justifyContent: 'flex-end', marginBottom: '20px'}}>
                  <button className="tbl-btn tbl-btn-success" onClick={agregarRecurso}><FaPlus style={{marginRight:'5px'}}/> Agregar a la lista</button>
                </div>

                <div className="tbl-table-responsive tbl-border-top">
                  <table className="tbl-table tbl-table-vcenter">
                    <thead>
                      <tr><th>Tipo</th><th>Detalle (Resumen)</th><th className="tbl-text-end">Cantidad</th><th className="tbl-text-end">P. Unit.</th><th className="tbl-text-end">Total</th><th></th></tr>
                    </thead>
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
                                  <span className="tbl-badge bg-green-lt">En BD</span>
                                  {r.tipo === 'Maquinaria' && (
                                    <button 
                                      type="button"
                                      onClick={() => abrirModalPdf(r.dbId)} 
                                      className="tbl-btn-action text-blue" 
                                      title="Ver Parte Diario (PDF)"
                                      style={{padding: '4px 8px', backgroundColor: '#e0f2fe', borderRadius: '4px', border: 'none', cursor: 'pointer', display: 'inline-flex'}}
                                    >
                                      <FaFilePdf size={16} />
                                    </button>
                                  )}
                                </div>
                              ) : (
                                <button className="tbl-btn-action text-danger" onClick={() => eliminarRecurso(r.idLocal)} title="Eliminar de la lista temporal"><FaTimes/></button>
                              )}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="tbl-modal-footer">
                <div className="tbl-text-start tbl-text-muted">Costo Total: <span style={{fontSize: '1.25rem', color: '#1e293b', fontWeight: 'bold'}}>S/ {costoTotalIncidente.toFixed(2)}</span></div>
                <div>
                  <button className="tbl-btn tbl-btn-link" onClick={() => setModalAbierto(false)}>Cerrar</button>
                  <button className="tbl-btn tbl-btn-primary" onClick={guardarCosteos} disabled={guardando}>{guardando ? <><FaSyncAlt className="icon-spin" style={{marginRight: '8px'}} /> Guardando...</> : <><FaSave style={{marginRight: '8px'}} /> Guardar Costeos</>}</button>
                </div>
              </div>

            </div>
          </div>
        </div>
      )}

      {/* ---------------- MODAL SECUNDARIO (VISOR DE PDF) ---------------- */}
      {modalPdfAbierto && (
        <div 
          className="tbl-modal-backdrop" 
          onClick={() => setModalPdfAbierto(false)} 
          style={{ zIndex: 9999, backgroundColor: 'rgba(0,0,0,0.75)' }}
        >
          <div 
            className="tbl-modal-dialog" 
            onClick={e => e.stopPropagation()} 
            style={{ 
              maxWidth: '850px', 
              height: '90vh', 
              display: 'flex', 
              flexDirection: 'column',
              position: 'relative',
              zIndex: 10000,
              marginTop: '2vh'
            }}
          >
            <div className="tbl-modal-content" style={{ flex: 1, display: 'flex', flexDirection: 'column', boxShadow: '0 0 20px rgba(0,0,0,0.5)' }}>
              <div className="tbl-modal-header" style={{ borderBottom: '1px solid #e2e8f0', padding: '15px 20px', backgroundColor: '#f8fafc' }}>
                <h5 className="tbl-modal-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <FaFilePdf color="#dc2626" /> Visor de Parte Diario
                </h5>
                <button className="tbl-btn-close" onClick={() => setModalPdfAbierto(false)}><FaTimes/></button>
              </div>
              
              <div className="tbl-modal-body" style={{ flex: 1, padding: 0, overflow: 'hidden', backgroundColor: '#525659' }}>
                <iframe 
                  src={pdfUrlActivo} 
                  style={{ width: '100%', height: '100%', border: 'none' }} 
                  title="Visor PDF"
                />
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );


export default Incidentes;