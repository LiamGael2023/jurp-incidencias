import { useState, useEffect, useRef, Fragment } from 'react';
import { 
  FaSyncAlt, FaEye, FaMapMarkerAlt, 
  FaCalendarAlt, FaCamera, FaVideo, 
  FaImage, FaChevronLeft, FaChevronRight, FaTimes, FaPlus, FaFileInvoice, FaSave, FaFilePdf, FaFileExcel, FaDownload, FaUser, FaTrash, FaCheckCircle, FaFilter, FaSearch, FaListUl, FaTruck
} from 'react-icons/fa';
import './Incidentes.css';
import Swal from 'sweetalert2';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import ExcelJS from 'exceljs';
import logo from './assets/jurp.png';
import refAltura from './assets/ref_altura.png';
import refAncho from './assets/ref_ancho.png';
import MantenedorEquipos from './MantenedorEquipos';
// ── Imágenes de referencia metrado por actividad ─────────────────────────────
import imgExcavacion from './assets/metrado/excavacion.png';
import imgCarguio from './assets/metrado/carguio.png';
import imgDescolmatacion from './assets/metrado/descolmatacion.png';
import imgEliminacion from './assets/metrado/eliminacion.png';
import imgConformacion from './assets/metrado/conformacion.png';
import imgEnrocado from './assets/metrado/enrocado.png';
import imgPerfilado from './assets/metrado/perfilado.png';
import imgHabilitacion from './assets/metrado/habilitacion.png';
const IMG_METRADO = {
  'CARGUIO DE MATERIAL': imgCarguio, 'CONFORMACION DE DIQUE': imgConformacion,
  'DESCOLMATACION DE CAUCE': imgDescolmatacion, 'ELIMINACION': imgEliminacion,
  'ENROCADO': imgEnrocado, 'EXCAVACION DE MATERIAL': imgExcavacion,
  'HABILITACION DE ACCESO': imgHabilitacion, 'PERFILADO DE TALUD': imgPerfilado,
};

function Incidentes({ incidenteAbrir, onIncidenteAbierto }) {
  const [incidentes, setIncidentes] = useState([]);
  const [incidentesCerrados, setIncidentesCerrados] = useState([]);  // IDs cerrados (operations)
  const [cargando, setCargando] = useState(true);
  const [paginaActual, setPaginaActual] = useState(1);
  const itemsPorPagina = 8;

  // --- FILTROS ---
  const [filtroTipo, setFiltroTipo] = useState('');       // '' = todos
  const [filtroEstado, setFiltroEstado] = useState('');   // '' | pat | ate | cer
  const [filtroGravedad, setFiltroGravedad] = useState(''); // '' | lev | mod | gra
  const [busqueda, setBusqueda] = useState('');

  // --- CATÁLOGOS (mantenedores) ---
  const [catEquipos, setCatEquipos] = useState([]);
  const [catMarcas, setCatMarcas] = useState([]);
  const [catModelos, setCatModelos] = useState([]);
  // Catálogo COMPLETO de modelos (sin filtros), solo para resolver el código
  // de máquina de los partes ya guardados (la API no devuelve el código).
  const [todosModelos, setTodosModelos] = useState([]);
  const [catActividades, setCatActividades] = useState([]);
  const [catUnidades, setCatUnidades] = useState(['bol', 'm3', 'm2', 'und', 'kg', 'gln', 'rll']);
  const [catCargos, setCatCargos] = useState([]);   // catálogo de cargos (backend)
  const [mantenedorAbierto, setMantenedorAbierto] = useState(false);

  // --- ESTADOS DEL MODAL PRINCIPAL ---
  const [modalAbierto, setModalAbierto] = useState(false);
  const [incidenteActivo, setIncidenteActivo] = useState(null);
  const [modalReporteGlobal, setModalReporteGlobal] = useState(false);
  const [generandoReporte, setGenerandoReporte] = useState(false);
  const [conDatosInfo, setConDatosInfo] = useState(null);  // {conDatos, total} del reporte
  const incidentesFiltradosRef = useRef([]);   // lista filtrada visible (para el reporte)
  const [recursos, setRecursos] = useState([]); 
  const [guardando, setGuardando] = useState(false);

  // --- ESTADOS DEL MODAL PDF ---
  const [modalPdfAbierto, setModalPdfAbierto] = useState(false);
  const [pdfUrlActivo, setPdfUrlActivo] = useState(null);
  const [imgRefModal, setImgRefModal] = useState(null);
  const [modalPartes, setModalPartes] = useState(null);   // fila agrupada de maquinaria
  const [formTipo, setFormTipo] = useState(null);         // 'Personal' | 'Maquinaria' | 'Insumo' | null → modal de añadir
  const [selectorMaquina, setSelectorMaquina] = useState(false); // paso 1: elegir máquina
  const [buscarMaquina, setBuscarMaquina] = useState('');

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
    return `PD-____-${strFecha}`;
  };
  
  const estadoInicialRecurso = {
    tipo: 'Personal', descripcion: '', cantidad: 1, precioUnitario: 0, unidad: 'und',
    numPersonas: 1, horasTrabajo: 8, horasExtras: 0, 
    horasEfectivas: '', obsReduccion: '',
    numeroParte: generarCorrelativo(), 
    fechaParte: getFechaHoy(), 
    turno: 'Día', zonaTrabajo: '',
    proveedor: '', operador: '', licencia: '', categoria: '',
    equipoId: '', equipo: '',
    origen: 'JURP',
    marcaId: '', marca: '',
    modeloId: '', placa: '', modeloMaquina: '', codigoMaquina: '',
    hmInicio: '', hmFin: '', combustible: '', vale: '', fotoVale: null,
    actividad: '', observaciones: '', fotoParte: null,
    incluirMetrado: false, longitud: '', altura: '', anchoSup: '', anchoInf: '',
    nViajes: '', volTolva: '', fe: '1.25', hPromedio: '', anchoBase: '', corona: '', talud: '',
    // Metrado: por defecto se ingresa MANUAL. Al marcar el check se calcula por fórmula.
    calcularMetrado: false, metradoManual: '', unidadMetrado: 'm3'
  };
  // Unidades disponibles para el metrado manual.
  const UNIDADES_METRADO = ['m', 'm2', 'm3', 'glb'];
  const UNIDADES_METRADO_TXT = { m: 'm', m2: 'm²', m3: 'm³', glb: 'glb' };

  const [nuevoRecurso, setNuevoRecurso] = useState(estadoInicialRecurso);

  // ── Carga de catálogos (equipos/marcas/modelos) ──────────────────────────
  const API_OPS = 'https://gideonstudio.duckdns.org/api/v1/mobile/operations';

  const cargarEquiposCat = async (origen) => {
    try {
      const r = await fetch(`${API_OPS}/equipos/?activo=true&origen=${origen}`);
      if (r.ok) setCatEquipos(await r.json());
    } catch (e) { console.error(e); }
  };
  const cargarMarcasCat = async (equipoId) => {
    if (!equipoId) { setCatMarcas([]); return; }
    try {
      const r = await fetch(`${API_OPS}/marcas/?activo=true&equipo=${equipoId}`);
      if (r.ok) setCatMarcas(await r.json());
    } catch (e) { console.error(e); }
  };
  const cargarModelosCat = async (marcaId) => {
    if (!marcaId) { setCatModelos([]); return; }
    try {
      const r = await fetch(`${API_OPS}/modelos/?activo=true&estado=0&marca=${marcaId}`);
      if (r.ok) setCatModelos(await r.json());
    } catch (e) { console.error(e); }
  };
  useEffect(() => { cargarEquiposCat(nuevoRecurso.origen); }, []);

  const cargarActividades = async () => {
    try {
      const r = await fetch(`${API_OPS}/actividades/?activo=true`);
      if (r.ok) setCatActividades(await r.json());
    } catch (e) { console.error(e); }
  };
  useEffect(() => { cargarActividades(); }, []);

  // Catálogo de cargos de mano de obra (persistido en el backend).
  const cargarCargos = async () => {
    try {
      const r = await fetch(`${API_OPS}/cargos/?activo=true`);
      if (r.ok) setCatCargos(await r.json());
    } catch (e) { console.error(e); }
  };
  useEffect(() => { cargarCargos(); }, []);

  // Carga el catálogo completo de modelos (todas las máquinas, sin filtrar).
  const cargarTodosModelos = async () => {
    try {
      const r = await fetch(`${API_OPS}/modelos/`);
      if (r.ok) setTodosModelos(await r.json());
    } catch (e) { console.error(e); }
  };
  useEffect(() => { cargarTodosModelos(); }, []);

  // Reconstruye "CODIGO · EQUIPO MARCA MODELO" de un parte guardado.
  // La API no devuelve el código de máquina, así que lo buscamos en el catálogo
  // por placa o por modelo+marca (misma lógica que el backend al liberar).
  const detalleMaquinaDeParte = (parte, catalogo) => {
    const mp = (parte.model_plate || '').trim();
    const marcaTxt = (parte.brand_name || '').trim();
    const equipoTxt = (parte.equipment_name || '').trim();

    let modeloTxt = mp, placaTxt = mp;
    if (mp.includes('/')) {
      const [a, b] = mp.split('/', 2).map(x => x.trim());
      modeloTxt = a; placaTxt = b || '';
    }

    let maq = null;
    if (placaTxt) maq = catalogo.find(m => m.placa && m.placa.toLowerCase() === placaTxt.toLowerCase());
    if (!maq && modeloTxt) {
      const porModelo = catalogo.filter(m => m.modelo && m.modelo.toLowerCase() === modeloTxt.toLowerCase());
      maq = porModelo.find(m => (m.marca_nombre || '').toLowerCase() === marcaTxt.toLowerCase()) || porModelo[0];
    }

    const codigo = maq?.codigo || '';
    const modelo = maq?.modelo || (modeloTxt !== placaTxt ? modeloTxt : '');
    return [codigo, codigo ? '·' : '', equipoTxt, marcaTxt, modelo]
      .filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  };

  const obtenerCorrelativoParte = async () => {
    try {
      const r = await fetch(`${API_OPS}/daily-part-heavy-equipments/siguiente-correlativo/`);
      if (r.ok) {
        const data = await r.json();
        if (data?.numero_parte) {
          setNuevoRecurso(prev => ({ ...prev, numeroParte: data.numero_parte }));
        }
      }
    } catch (e) { console.error(e); }
  };
  useEffect(() => { obtenerCorrelativoParte(); }, []);

  const onCambiaOrigen = (origen) => {
    setNuevoRecurso(prev => ({ ...prev, origen, equipoId: '', equipo: '', marcaId: '', marca: '', modeloId: '', placa: '', modeloMaquina: '', codigoMaquina: '' }));
    setCatMarcas([]); setCatModelos([]);
    cargarEquiposCat(origen);
  };
  const onCambiaEquipo = (id) => {
    const eq = catEquipos.find(e => String(e.id) === String(id));
    setNuevoRecurso(prev => ({ ...prev, equipoId: id, equipo: eq?.nombre || '', marcaId: '', marca: '', modeloId: '', placa: '', modeloMaquina: '', codigoMaquina: '' }));
    setCatMarcas([]); setCatModelos([]);
    cargarMarcasCat(id);
  };
  const onCambiaMarca = (id) => {
    const ma = catMarcas.find(m => String(m.id) === String(id));
    setNuevoRecurso(prev => ({ ...prev, marcaId: id, marca: ma?.nombre || '', modeloId: '', placa: '', modeloMaquina: '', codigoMaquina: '' }));
    setCatModelos([]);
    cargarModelosCat(id);
  };
  const onCambiaModelo = (id) => {
    const mo = catModelos.find(m => String(m.id) === String(id));
    setNuevoRecurso(prev => ({ ...prev, modeloId: id, placa: mo?.placa || '', modeloMaquina: mo?.modelo || '', codigoMaquina: mo?.codigo || '' }));
  };

  const onCambiaActividad = async (valor) => {
    if (valor === '__OTRO__') {
      const { value: nombre } = await Swal.fire({
        title: 'Nueva actividad',
        input: 'text',
        inputPlaceholder: 'Ej. RIEGO DE PLATAFORMA',
        showCancelButton: true,
        confirmButtonText: 'Agregar',
        inputValidator: (v) => !v && 'Escribe el nombre de la actividad',
      });
      if (!nombre) return;
      const limpio = nombre.toUpperCase().trim();
      try {
        const r = await fetch(`${API_OPS}/actividades/`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nombre: limpio, activo: true }),
        });
        if (r.ok) {
          await cargarActividades();
          setNuevoRecurso(prev => ({ ...prev, actividad: limpio }));
        } else {
          const e = await r.json();
          Swal.fire('Error', e.nombre ? e.nombre[0] : 'No se pudo crear la actividad.', 'error');
        }
      } catch (e) {
        Swal.fire('Error', 'Fallo de conexión al crear la actividad.', 'error');
      }
    } else {
      setNuevoRecurso(prev => ({ ...prev, actividad: valor }));
    }
  };

  // ── Gestionar cargos de mano de obra (persistidos en el backend) ────────
  const gestionarCargos = async () => {
    const html = `
      <div style="text-align:left">
        <div style="margin-bottom:10px;font-size:13px;color:#64748b">Cargos actuales:</div>
        <div id="lista-cargos" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px">
          ${catCargos.map(c => `<span style="background:#e0f2fe;color:#0284c7;padding:3px 10px;border-radius:12px;font-size:12px;font-weight:600;display:inline-flex;align-items:center;gap:6px">${c.nombre}<button data-del="${c.id}" data-nom="${c.nombre}" style="background:none;border:none;color:#dc2626;cursor:pointer;font-size:14px;padding:0;line-height:1">×</button></span>`).join('')}
        </div>
        <input id="nuevo-cargo" class="swal2-input" placeholder="Nuevo cargo (ej. CAPATAZ)" style="margin:0;width:100%" />
      </div>`;
    const { value: nuevo } = await Swal.fire({
      title: 'Cargos de mano de obra',
      html,
      showCancelButton: true,
      confirmButtonText: 'Agregar',
      cancelButtonText: 'Cerrar',
      confirmButtonColor: '#206bc4',
      didOpen: () => {
        document.querySelectorAll('[data-del]').forEach(btn => {
          btn.addEventListener('click', async () => {
            const id = btn.getAttribute('data-del');
            const nom = btn.getAttribute('data-nom');
            try {
              const r = await fetch(`${API_OPS}/cargos/${id}/`, { method: 'DELETE' });
              if (r.ok || r.status === 204) {
                btn.parentElement.remove();
                setCatCargos(prev => prev.filter(x => String(x.id) !== String(id)));
                setNuevoRecurso(prev => prev.descripcion === nom ? { ...prev, descripcion: '' } : prev);
              }
            } catch (e) { console.error(e); }
          });
        });
      },
      preConfirm: () => {
        const v = document.getElementById('nuevo-cargo').value.trim().toUpperCase();
        if (!v) { Swal.showValidationMessage('Escribe un cargo'); return false; }
        if (catCargos.some(c => c.nombre.toUpperCase() === v)) { Swal.showValidationMessage('Ese cargo ya existe'); return false; }
        return v;
      },
    });
    if (nuevo) {
      try {
        const r = await fetch(`${API_OPS}/cargos/`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nombre: nuevo, activo: true }),
        });
        if (r.ok) {
          await cargarCargos();
          setNuevoRecurso(prev => ({ ...prev, descripcion: nuevo }));
        } else {
          const e = await r.json().catch(() => ({}));
          Swal.fire('Error', e.nombre ? e.nombre[0] : 'No se pudo crear el cargo.', 'error');
        }
      } catch (e) {
        Swal.fire('Error', 'Fallo de conexión al crear el cargo.', 'error');
      }
    }
  };

  // ── Gestionar unidades de medida ────────────────────────────────────────
  const gestionarUnidades = async () => {
    const html = `
      <div style="text-align:left">
        <div style="margin-bottom:10px;font-size:13px;color:#64748b">Unidades actuales:</div>
        <div id="lista-unidades" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px">
          ${catUnidades.map(u => `<span style="background:#e0f2fe;color:#0284c7;padding:3px 10px;border-radius:12px;font-size:12px;font-weight:600;display:inline-flex;align-items:center;gap:6px">${u}<button data-del="${u}" style="background:none;border:none;color:#dc2626;cursor:pointer;font-size:14px;padding:0;line-height:1">×</button></span>`).join('')}
        </div>
        <input id="nueva-unidad" class="swal2-input" placeholder="Nueva unidad (ej. tn, m, pza)" style="margin:0;width:100%" />
      </div>`;
    const { value: nueva } = await Swal.fire({
      title: 'Unidades de medida',
      html,
      showCancelButton: true,
      confirmButtonText: 'Agregar',
      cancelButtonText: 'Cerrar',
      confirmButtonColor: '#206bc4',
      didOpen: () => {
        document.querySelectorAll('[data-del]').forEach(btn => {
          btn.addEventListener('click', () => {
            const u = btn.getAttribute('data-del');
            setCatUnidades(prev => prev.filter(x => x !== u));
            setNuevoRecurso(prev => prev.unidad === u ? { ...prev, unidad: 'und' } : prev);
            btn.parentElement.remove();
          });
        });
      },
      preConfirm: () => {
        const v = document.getElementById('nueva-unidad').value.trim().toLowerCase();
        if (!v) { Swal.showValidationMessage('Escribe una unidad'); return false; }
        if (catUnidades.includes(v)) { Swal.showValidationMessage('Esa unidad ya existe'); return false; }
        return v;
      },
    });
    if (nueva) {
      setCatUnidades(prev => [...prev, nueva]);
      setNuevoRecurso(prev => ({ ...prev, unidad: nueva }));
    }
  };

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
        const tiposMapa = {
          '1': 'Rebose y/o Colapso de canoa o alcantarilla',
          '2': 'Ingreso de sedimentos al Canal Madre',
          '3': 'Desborde Canal Madre',
          '4': 'Desborde Lateral 10',
          '5': 'Rotura de Canal',
          '6': 'Interrupción del flujo en el canal en tramos con retenciones',
          '7': 'Presencia de palizada en canal Madre',
          '8': 'Corte de camino de acceso y/o servicio',
          '9': 'Rotura de embalse de usuario',
          '10': 'Incremento de caudal',
          '11': 'Erosión de obras de defensa ribereña',
          '12': 'Desborde e inundación',
          '13': 'Lluvia',
          '14': 'Otros',
        };
        const listaFormateada = (data.results || []).map(inc => {
          const tipoBase = tiposMapa[inc.type?.toString()] || 'Incidente';
          let tipoNombre = tipoBase;
          const anotherType = inc.another_type?.trim();
          if (anotherType && (tipoBase === 'Otro' || tipoBase === 'Otros')) tipoNombre = `Otros (${anotherType})`;
          // Código de identificación: INCIDENTE-{id}-DDMMAAAA (fecha de creación).
          const f = new Date(inc.created_at);
          const fechaCod = `${String(f.getDate()).padStart(2,'0')}${String(f.getMonth()+1).padStart(2,'0')}${f.getFullYear()}`;
          const codigoIncidente = `INCIDENTE-${String(inc.id).padStart(3,'0')}-${fechaCod}`;
          // Coordenadas GPS que manda la app móvil. El backend puede nombrarlas
          // de varias formas, así que probamos las más habituales.
          const latRaw = inc.latitude ?? inc.latitude_marker ?? inc.lat ?? inc.latitud ?? null;
          const lngRaw = inc.longitude ?? inc.longitude_marker ?? inc.lng ?? inc.lon ?? inc.longitud ?? null;
          const latNum = latRaw !== null && latRaw !== '' ? parseFloat(latRaw) : null;
          const lngNum = lngRaw !== null && lngRaw !== '' ? parseFloat(lngRaw) : null;
          const tieneCoords = Number.isFinite(latNum) && Number.isFinite(lngNum);
          return {
            id: inc.id, codigoIncidente, codigo: inc.code || 'Sin Código', lugar: inc.location_text || '-',
            latitud: tieneCoords ? latNum : null,
            longitud: tieneCoords ? lngNum : null,
            tipo: tipoNombre, tipoBase, gravedad: inc.severity || 'lev', estado: inc.status || 'pat',
            usuario: inc.user?.username || 'Sistema',
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
      const formatPers = listPers.filter(i => String(i.incident_report) === idStr).map(i => {
        // Recupera el cargo y el desglose de cuadrilla desde el texto guardado
        // (o desde los campos del backend si existen), para no mostrar "undefined".
        const descripcion = (i.description || '').split('\n')[0].trim();
        return {
          idLocal: `db-pers-${i.id}`, dbId: i.id, endpoint: 'incident-personnels', tipo: 'Personal',
          descripcion,
          numPersonas: i.num_personas ?? 1,
          origen: i.origin || 'JURP',
          horasTrabajo: i.horas_normales ?? parseFloat(i.quantity_hours) ?? 0,
          horasExtras: i.horas_extras ?? 0,
          descripcionResumen: i.description,
          cantidad: parseFloat(i.quantity_hours), precioUnitario: parseFloat(i.unit_price),
          total: parseFloat(i.quantity_hours) * parseFloat(i.unit_price), guardadoEnDB: true
        };
      });
      const formatMat = listMat.filter(i => String(i.incident_report) === idStr).map(i => ({ idLocal: `db-mat-${i.id}`, dbId: i.id, endpoint: 'incident-materials', tipo: 'Insumo', descripcionResumen: i.description, unidad: i.unit || 'und', cantidad: parseFloat(i.quantity), precioUnitario: parseFloat(i.unit_price), total: parseFloat(i.quantity) * parseFloat(i.unit_price), guardadoEnDB: true }));
      const formatMaq = listMaq.filter(i => String(i.incident_report) === idStr).map(i => {
        // Resuelve la máquina del catálogo para poder agregarle más partes luego.
        const mp = (i.model_plate || '').trim();
        let modeloTxt = mp, placaTxt = mp;
        if (mp.includes('/')) { const [a, b] = mp.split('/', 2).map(x => x.trim()); modeloTxt = a; placaTxt = b || ''; }
        let maq = null;
        if (placaTxt) maq = todosModelos.find(m => m.placa && m.placa.toLowerCase() === placaTxt.toLowerCase());
        if (!maq && modeloTxt) {
          const porModelo = todosModelos.filter(m => m.modelo && m.modelo.toLowerCase() === modeloTxt.toLowerCase());
          maq = porModelo.find(m => (m.marca_nombre || '').toLowerCase() === (i.brand_name || '').toLowerCase()) || porModelo[0];
        }
        return {
          idLocal: `db-maq-${i.id}`, dbId: i.id, endpoint: 'daily-part-heavy-equipments',
          cerrado: i.cerrado || false, tipo: 'Maquinaria', numeroParte: i.part_number,
          descripcionResumen: detalleMaquinaDeParte(i, todosModelos),
          codigoMaquina: maq?.codigo || '', modeloId: maq?.id || '',
          equipoId: maq?.equipo || '', equipo: maq?.equipo_nombre || i.equipment_name || '',
          marcaId: maq?.marca || '', marca: maq?.marca_nombre || i.brand_name || '',
          modeloMaquina: maq?.modelo || modeloTxt || '', placa: maq?.placa || placaTxt || '',
          origen: maq?.origen || 'JURP',
          actividad: i.activities || '',
          hmInicio: i.start_horometer ?? '', hmFin: i.end_horometer ?? '',
          combustible: i.fuel_gallons ?? '', vale: i.fuel_voucher || '',
          fechaParte: i.date || '', turno: i.shift || 'Día', zonaTrabajo: i.work_zone_text || '',
          operador: i.operator || '', observaciones: i.observations || '',
          cantidad: Math.max(0, parseFloat(i.end_horometer) - parseFloat(i.start_horometer)),
          precioUnitario: parseFloat(i.unit_price),
          total: Math.max(0, parseFloat(i.end_horometer) - parseFloat(i.start_horometer)) * parseFloat(i.unit_price),
          guardadoEnDB: true,
        };
      });
      setRecursos([...formatPers, ...formatMat, ...formatMaq]);
    } catch (error) { console.error("❌ Error al obtener los recursos guardados:", error); }
  };
  useEffect(() => { obtenerIncidentes(); }, []);

  // Carga los IDs de incidentes cerrados (marca persistente en operations).
  useEffect(() => {
    fetch(`${API_OPS}/incidentes-cerrados/`)
      .then(r => r.ok ? r.json() : { cerrados: [] })
      .then(d => setIncidentesCerrados(d.cerrados || []))
      .catch(() => setIncidentesCerrados([]));
  }, []);
  // Al cambiar cualquier filtro, vuelve a la primera página.
  useEffect(() => { setPaginaActual(1); }, [filtroTipo, filtroEstado, filtroGravedad, busqueda]);

  const abrirModal = (inc) => {
    setIncidenteActivo(inc); setRecursos([]); 
    setNuevoRecurso({...estadoInicialRecurso, numeroParte: generarCorrelativo()});
    obtenerCorrelativoParte();
    setModalAbierto(true);
    cargarCosteosGuardados(inc.id); 
  };

  // Si llega una solicitud de abrir un incidente (enlace desde Maquinaria),
  // lo busca en la lista cargada y abre su modal.
  useEffect(() => {
    if (!incidenteAbrir || incidentes.length === 0) return;
    const inc = incidentes.find(i => i.id === incidenteAbrir);
    if (inc) {
      abrirModal(inc);
      if (onIncidenteAbierto) onIncidenteAbierto();
    }
  }, [incidenteAbrir, incidentes]);

  // Si el catálogo de modelos llega después de abrir el modal, recarga los
  // costeos para que la maquinaria muestre su código.
  useEffect(() => {
    if (modalAbierto && incidenteActivo && todosModelos.length > 0) {
      cargarCosteosGuardados(incidenteActivo.id);
    }
  }, [todosModelos.length]);
  const abrirModalPdf = (dbId) => {
    const url = `https://gideonstudio.duckdns.org/api/v1/mobile/operations/daily-part-heavy-equipments/${dbId}/pdf/`;
    setPdfUrlActivo(url);
    setModalPdfAbierto(true);
  };

  const eliminarRecursoGuardado = async (fila) => {
    if (incidentesCerrados.includes(incidenteActivo?.id)) { Swal.fire('Incidencia cerrada', 'Reábrela para poder editar.', 'info'); return; }
    const registros = fila.registros || [{ dbId: fila.dbId, endpoint: fila.endpoint }];
    const cuantos = registros.length;
    const conf = await Swal.fire({
      title: '¿Eliminar?',
      text: cuantos > 1
        ? `Se eliminarán ${cuantos} registros de "${fila.descripcionResumen}" de forma permanente.`
        : `Se eliminará este recurso de forma permanente.`,
      icon: 'warning', showCancelButton: true, confirmButtonColor: '#d33',
      confirmButtonText: 'Sí, eliminar', cancelButtonText: 'Cancelar',
    });
    if (!conf.isConfirmed) return;
    const BASE_URL = 'https://gideonstudio.duckdns.org';
    try {
      const resultados = await Promise.all(registros.map(reg =>
        fetch(`${BASE_URL}/api/v1/mobile/operations/${reg.endpoint}/${reg.dbId}/`, { method: 'DELETE' })
      ));
      const okAll = resultados.every(r => r.ok || r.status === 204);
      if (okAll) {
        if (incidenteActivo) cargarCosteosGuardados(incidenteActivo.id);
        Swal.fire({ icon: 'success', title: 'Eliminado', timer: 1200, showConfirmButton: false });
      } else {
        const codigos = resultados.map(r => r.status).join(', ');
        Swal.fire('Error', `No se pudieron eliminar todos los registros (código: ${codigos}).`, 'error');
      }
    } catch (e) {
      Swal.fire('Error', 'Fallo de conexión al eliminar.', 'error');
    }
  };

  const cerrarParteDiario = async (fila) => {
    // Un parte sin dbId todavía no está en la BD → no se puede cerrar.
    if (!fila || !fila.dbId) {
      Swal.fire({ icon: 'info', title: 'Guarda primero', text: 'Este parte aún no está guardado. Usa "Guardar Costeos" y luego finalízalo.' });
      return;
    }
    const conf = await Swal.fire({
      title: '¿Finalizar actividades?',
      html: `Se cerrará este parte diario.<br>La máquina quedará <b>disponible</b> para otros partes.`,
      icon: 'question', showCancelButton: true, confirmButtonColor: '#206bc4',
      confirmButtonText: 'Sí, finalizar', cancelButtonText: 'Cancelar',
    });
    if (!conf.isConfirmed) return;
    const BASE_URL = 'https://gideonstudio.duckdns.org';
    try {
      const r = await fetch(`${BASE_URL}/api/v1/mobile/operations/daily-part-heavy-equipments/${fila.dbId}/cerrar/`, { method: 'POST' });
      if (r.ok) {
        if (incidenteActivo) cargarCosteosGuardados(incidenteActivo.id);
        setNuevoRecurso(prev => {
          if (prev.marcaId) cargarModelosCat(prev.marcaId);
          return prev;
        });
        Swal.fire({ icon: 'success', title: 'Parte cerrado', text: 'La máquina fue liberada.', timer: 1500, showConfirmButton: false });
      } else {
        Swal.fire('Error', `No se pudo cerrar el parte (código: ${r.status}).`, 'error');
      }
    } catch (e) {
      Swal.fire('Error', 'Fallo de conexión al cerrar.', 'error');
    }
  };

  const cerrarIncidenteCompleto = async () => {
    if (!incidenteActivo) return;
    const conf = await Swal.fire({
      title: '¿Cerrar esta incidencia?',
      html: `Se cerrarán <b>todos los partes diarios</b> y sus máquinas quedarán disponibles.<br>La incidencia quedará <b>bloqueada</b> (no se podrá editar).`,
      icon: 'warning', showCancelButton: true, confirmButtonColor: '#2fb344',
      confirmButtonText: 'Sí, cerrar incidencia', cancelButtonText: 'Cancelar',
    });
    if (!conf.isConfirmed) return;
    try {
      // Un solo POST: cierra los partes, libera máquinas y marca el cierre.
      const r = await fetch(`${API_OPS}/incidentes/${incidenteActivo.id}/cerrar-partes/`, { method: 'POST' });
      if (!r.ok) {
        Swal.fire('Error', `No se pudo cerrar la incidencia (código: ${r.status}).`, 'error');
        return;
      }
      cargarCosteosGuardados(incidenteActivo.id);
      setIncidentesCerrados(prev => prev.includes(incidenteActivo.id) ? prev : [...prev, incidenteActivo.id]);
      Swal.fire({ icon: 'success', title: 'Incidencia cerrada', text: 'Partes cerrados, máquinas liberadas y costeo bloqueado.', timer: 2200, showConfirmButton: false });
    } catch (e) {
      Swal.fire('Error', 'Fallo de conexión.', 'error');
    }
  };

  // Reabre una incidencia cerrada (quita el bloqueo).
  const reabrirIncidencia = async () => {
    if (!incidenteActivo) return;
    const conf = await Swal.fire({
      title: '¿Reabrir esta incidencia?',
      text: 'Podrás volver a editar los costeos. Los partes ya cerrados seguirán cerrados.',
      icon: 'question', showCancelButton: true, confirmButtonColor: '#206bc4',
      confirmButtonText: 'Sí, reabrir', cancelButtonText: 'Cancelar',
    });
    if (!conf.isConfirmed) return;
    try {
      const r = await fetch(`${API_OPS}/incidentes/${incidenteActivo.id}/reabrir/`, { method: 'POST' });
      if (!r.ok) { Swal.fire('Error', `No se pudo reabrir (código: ${r.status}).`, 'error'); return; }
      setIncidentesCerrados(prev => prev.filter(id => id !== incidenteActivo.id));
      Swal.fire({ icon: 'success', title: 'Incidencia reabierta', timer: 1500, showConfirmButton: false });
    } catch (e) {
      Swal.fire('Error', 'Fallo de conexión.', 'error');
    }
  };

  const horasMaquina = (nuevoRecurso.hmFin && nuevoRecurso.hmInicio) ? Math.max(0, (parseFloat(nuevoRecurso.hmFin) - parseFloat(nuevoRecurso.hmInicio))).toFixed(1) : 0;

  // ── Cálculo de metrado según actividad ──────────────────────────────────
  // Calcula el metrado de CUALQUIER recurso (no solo el del formulario abierto).
  const calcMetradoDe = (r) => {
    // Sin el check marcado, el metrado es el que el usuario escribe a mano.
    if (!r.calcularMetrado) {
      return { val: parseFloat(r.metradoManual) || 0, unit: UNIDADES_METRADO_TXT[r.unidadMetrado] || r.unidadMetrado || 'm³' };
    }
    const L = parseFloat(r.longitud)||0, h = parseFloat(r.altura)||0;
    const B = parseFloat(r.anchoBase)||0, b = parseFloat(r.corona)||0;
    const N = parseFloat(r.nViajes)||0, vt = parseFloat(r.volTolva)||0;
    const fe = parseFloat(r.fe)||1.25, Z = parseFloat(r.talud)||0;
    const hp = parseFloat(r.hPromedio)||0, a = parseFloat(r.anchoSup)||0;
    const Ws = parseFloat(r.anchoSup)||0, Wi = parseFloat(r.anchoInf)||0;
    switch (r.actividad) {
      case 'EXCAVACION DE MATERIAL': return {val:((B+b)/2)*h*L, unit:'m³'};
      case 'CARGUIO DE MATERIAL': return {val:N*vt/fe, unit:'m³'};
      case 'DESCOLMATACION DE CAUCE': return {val:a*hp*L, unit:'m³'};
      case 'ELIMINACION': return {val:N*vt, unit:'m³'};
      case 'CONFORMACION DE DIQUE': {const Bc=b+2*Z*h; return {val:((Bc+b)/2)*h*L, unit:'m³'};}
      case 'ENROCADO': return {val:((B+b)/2)*h*L, unit:'m³'};
      case 'PERFILADO DE TALUD': return {val:h*Math.sqrt(1+Z*Z)*L, unit:'m²'};
      case 'HABILITACION DE ACCESO': return {val:L, unit:'m'};
      default: return {val:((Ws+Wi)/2)*h*L, unit:'m³'};
    }
  };
  const calcVolumen = () => calcMetradoDe(nuevoRecurso);
  const volCalc = calcVolumen();
  const volumenMetrado = volCalc.val.toFixed(2);
  // Formatea números con separador de miles (1000000.00 → 1,000,000.00)
  const fmtNum = (n) => (parseFloat(n) || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const tieneMetradoActividad = IMG_METRADO[nuevoRecurso.actividad] !== undefined;

  // Abre el modal de "Añadir". Para maquinaria abre primero el SELECTOR de
  // máquina (paso 1). Personal/Insumo abren su formulario directo.
  const abrirFormAñadir = (tipo) => {
    if (tipo === 'Maquinaria') {
      cargarTodosModelos();
      setBuscarMaquina('');
      setSelectorMaquina(true);
      return;
    }
    setNuevoRecurso({ ...estadoInicialRecurso, tipo, numeroParte: generarCorrelativo() });
    setFormTipo(tipo);
  };

  // Devuelve el HM Fin del último parte de una máquina (por código), o 0.
  // "Último" = el mayor end_horometer entre sus partes existentes.
  const ultimoHmFinDeMaquina = (codigo) => {
    const cod = (codigo || '').toUpperCase();
    if (!cod) return 0;
    const codigoDeRec = (r) => ((r.codigoMaquina || (r.descripcionResumen || '').split('·')[0]).trim().split(' ')[0] || '').toUpperCase();
    const partes = recursos.filter(r => r.tipo === 'Maquinaria' && !r.esBorrador && codigoDeRec(r) === cod);
    if (partes.length === 0) return 0;
    const maxFin = Math.max(...partes.map(r => parseFloat(r.hmFin) || 0));
    return isFinite(maxFin) ? maxFin : 0;
  };

  // Paso 1: al elegir máquina del selector, la agrega a la lista en BORRADOR
  // (sin parte diario todavía). Vive solo en pantalla hasta que tenga un parte.
  const seleccionarMaquina = (maq) => {
    // 🚧 Máquina en mantenimiento: no se puede asignar a un parte.
    if (maq.en_mantenimiento) {
      Swal.fire({
        icon: 'warning',
        title: 'Máquina en mantenimiento',
        html: `<b>${maq.codigo}</b> está en mantenimiento y no puede asignarse a un parte.`
              + (maq.mantenimiento_obs ? `<br><br><small style="color:#64748b">Motivo: ${maq.mantenimiento_obs}</small>` : ''),
        confirmButtonColor: '#d97706',
      });
      return;
    }
    // 🚧 Máquina ocupada (con parte abierto en otro incidente): tampoco se puede.
    if (maq.disponible === false) {
      Swal.fire({
        icon: 'warning',
        title: 'Máquina ocupada',
        html: `<b>${maq.codigo}</b> ya tiene un parte diario abierto y no puede asignarse a otro incidente.`
              + `<br><br><small style="color:#64748b">Cierra el parte anterior para liberarla.</small>`,
        confirmButtonColor: '#dc2626',
      });
      return;
    }
    setSelectorMaquina(false);
    // Evita duplicar una máquina ya presente (borrador o con partes).
    const codigo = (maq.codigo || '').toUpperCase();
    const yaEsta = recursos.some(r => r.tipo === 'Maquinaria' &&
      ((r.codigoMaquina || '').toUpperCase() === codigo ||
       (r.descripcionResumen || '').toUpperCase().startsWith(codigo)));
    if (yaEsta) {
      Swal.fire({ icon: 'info', title: 'Ya está en la lista', text: `${maq.codigo} ya fue agregada. Usa "+ Parte Diario" en su fila.` });
      return;
    }
    const detalle = [maq.codigo, '·', maq.equipo_nombre, maq.marca_nombre, maq.modelo || '']
      .filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    const borrador = {
      idLocal: `maq-borrador-${maq.id}-${Date.now()}`,
      tipo: 'Maquinaria', esBorrador: true, guardadoEnDB: false,
      descripcionResumen: detalle,
      origen: maq.origen || 'JURP',
      equipoId: maq.equipo || '', equipo: maq.equipo_nombre || '',
      marcaId: maq.marca || '', marca: maq.marca_nombre || '',
      modeloId: maq.id, modeloMaquina: maq.modelo || '', placa: maq.placa || '',
      codigoMaquina: maq.codigo || '',
      cantidad: 0, precioUnitario: 0, total: 0,
    };
    setRecursos(prev => [...prev, borrador]);
  };

  // Paso 2: abre el formulario de PARTE DIARIO para una máquina concreta.
  const abrirParteDiario = (maq) => {
    // 🚧 Máquina en mantenimiento: no se puede asignar a un parte.
    if (maq.en_mantenimiento) {
      Swal.fire({
        icon: 'warning',
        title: 'Máquina en mantenimiento',
        html: `<b>${maq.codigo}</b> está en mantenimiento y no puede asignarse a un parte.`
              + (maq.mantenimiento_obs ? `<br><br><small style="color:#64748b">Motivo: ${maq.mantenimiento_obs}</small>` : ''),
        confirmButtonColor: '#d97706',
      });
      return;
    }
    // 🚧 Máquina ocupada (con parte abierto en otro incidente): tampoco se puede.
    if (maq.disponible === false) {
      Swal.fire({
        icon: 'warning',
        title: 'Máquina ocupada',
        html: `<b>${maq.codigo}</b> ya tiene un parte diario abierto y no puede asignarse a otro incidente.`
              + `<br><br><small style="color:#64748b">Cierra el parte anterior para liberarla.</small>`,
        confirmButtonColor: '#dc2626',
      });
      return;
    }
    setSelectorMaquina(false);
    const hmInicioPrev = ultimoHmFinDeMaquina(maq.codigo);
    setNuevoRecurso({
      ...estadoInicialRecurso,
      tipo: 'Maquinaria',
      numeroParte: generarCorrelativo(),
      origen: maq.origen || 'JURP',
      equipoId: maq.equipo || '',
      equipo: maq.equipo_nombre || '',
      marcaId: maq.marca || '',
      marca: maq.marca_nombre || '',
      modeloId: maq.id,
      modeloMaquina: maq.modelo || '',
      placa: maq.placa || '',
      codigoMaquina: maq.codigo || '',
      hmInicio: hmInicioPrev,
    });
    obtenerCorrelativoParte();
    setFormTipo('Maquinaria');
  };

  // Desde una fila de máquina (grupo), agrega OTRO parte diario a la misma
  // máquina, reutilizando su identidad ya conocida.
  const agregarParteAMaquina = (grupo) => {
    const hmInicioPrev = ultimoHmFinDeMaquina(grupo.codigoMaquina || (grupo.descripcionResumen || '').split('·')[0]);
    setNuevoRecurso({
      ...estadoInicialRecurso, tipo: 'Maquinaria', numeroParte: generarCorrelativo(),
      origen: grupo.origen || 'JURP',
      equipoId: grupo.equipoId || '', equipo: grupo.equipo || '',
      marcaId: grupo.marcaId || '', marca: grupo.marca || '',
      modeloId: grupo.modeloId || '', modeloMaquina: grupo.modeloMaquina || '',
      placa: grupo.placa || '', codigoMaquina: grupo.codigoMaquina || '',
      precioUnitario: grupo.precioUnitario || 0,
      hmInicio: hmInicioPrev,
    });
    obtenerCorrelativoParte();
    setFormTipo('Maquinaria');
  };

  // Quita una máquina completa: su borrador (local) y todos sus partes.
  // Los partes ya guardados en BD se eliminan con confirmación.
  const quitarMaquina = async (grupo) => {
    const guardados = grupo.partesMaq.filter(p => p.guardadoEnDB && p.dbId);
    if (guardados.length > 0) {
      const c = await Swal.fire({
        title: '¿Quitar máquina?',
        text: `Se eliminarán ${guardados.length} parte(s) diario(s) de ${grupo.codigoMaquina}.`,
        icon: 'warning', showCancelButton: true, confirmButtonColor: '#d33',
        confirmButtonText: 'Sí, quitar', cancelButtonText: 'Cancelar',
      });
      if (!c.isConfirmed) return;
      for (const p of guardados) {
        try { await fetch(`${API_OPS}/${p.endpoint}/${p.dbId}/`, { method: 'DELETE' }); } catch (e) { console.error(e); }
      }
    }
    // Quita de la lista local (borrador + partes locales).
    const ids = new Set(grupo.idsLocales);
    setRecursos(prev => prev.filter(r => !ids.has(r.idLocal)));
    if (incidenteActivo) cargarCosteosGuardados(incidenteActivo.id);
  };

  const agregarRecurso = () => {
    let descFinal = nuevoRecurso.descripcion;
    let cantFinal = parseFloat(nuevoRecurso.cantidad) || 0;
    if (nuevoRecurso.tipo === 'Maquinaria') {
      const totalHM = parseFloat(horasMaquina) || 0;
      if (totalHM <= 0) return Swal.fire({ icon: 'warning', title: 'Atención', text: 'El Horómetro Final debe ser mayor al Inicial' });
      if (!nuevoRecurso.numeroParte) return Swal.fire({ icon: 'warning', title: 'Atención', text: 'El Número de Parte es obligatorio' });
      if (!nuevoRecurso.proveedor || !nuevoRecurso.proveedor.trim()) return Swal.fire({ icon: 'warning', title: 'Atención', text: 'El Proveedor es obligatorio' });
      if (!nuevoRecurso.equipo) return Swal.fire({ icon: 'warning', title: 'Atención', text: 'Selecciona un equipo' });
      const efectivas = (nuevoRecurso.horasEfectivas === '' || nuevoRecurso.horasEfectivas === null)
        ? totalHM
        : parseFloat(nuevoRecurso.horasEfectivas) || 0;
      if (efectivas < 0 || efectivas > totalHM) return Swal.fire({ icon: 'warning', title: 'Atención', text: `Las Horas Efectivas deben estar entre 0 y ${totalHM}` });
      if (efectivas < totalHM && !nuevoRecurso.obsReduccion.trim()) {
        return Swal.fire({ icon: 'warning', title: 'Observación requerida', text: 'Detalla el motivo de la reducción de horas efectivas.' });
      }
      cantFinal = efectivas;
      const equipoFinal = nuevoRecurso.equipo;
      const marcaFinal = nuevoRecurso.marca;
      // Detalle corto: solo código · equipo marca modelo. El resto va en el PDF del parte.
      descFinal = [nuevoRecurso.codigoMaquina, '·', equipoFinal, marcaFinal, nuevoRecurso.modeloMaquina || '']
        .filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
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
    obtenerCorrelativoParte();
    setFormTipo(null);   // cierra el modal de añadir
  };

  const eliminarRecurso = (idLocal) => setRecursos(recursos.filter(r => r.idLocal !== idLocal));
  const eliminarRecursosLocales = (idsLocales) => setRecursos(recursos.filter(r => !idsLocales.includes(r.idLocal)));

  // Elimina UNA entrada de insumo ya guardada en la BD.
  const eliminarEntradaInsumo = async (entrada) => {
    if (incidentesCerrados.includes(incidenteActivo?.id)) { Swal.fire('Incidencia cerrada', 'Reábrela para poder editar.', 'info'); return; }
    const conf = await Swal.fire({
      title: '¿Eliminar esta entrada?',
      text: `Se eliminará ${fmtNum(entrada.cantidad)} ${entrada.unidad} (S/ ${fmtNum(entrada.total)}) de forma permanente.`,
      icon: 'warning', showCancelButton: true, confirmButtonColor: '#d33',
      confirmButtonText: 'Sí, eliminar', cancelButtonText: 'Cancelar',
    });
    if (!conf.isConfirmed) return;
    try {
      const r = await fetch(`${API_OPS}/${entrada.endpoint}/${entrada.dbId}/`, { method: 'DELETE' });
      if (r.ok || r.status === 204) {
        if (incidenteActivo) cargarCosteosGuardados(incidenteActivo.id);
        Swal.fire({ icon: 'success', title: 'Eliminado', timer: 1000, showConfirmButton: false });
      } else {
        Swal.fire('Error', `No se pudo eliminar (código ${r.status}).`, 'error');
      }
    } catch (e) {
      Swal.fire('Error', 'Fallo de conexión al eliminar.', 'error');
    }
  };
  const costoTotalIncidente = recursos.reduce((sum, item) => sum + item.total, 0);

  const normalizar = (txt) => (txt || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  const recursosAgrupados = (() => {
    const grupos = new Map();
    // Código de máquina desde el detalle (ej. "JURP002 · ...") o del campo.
    const codigoDe = (r) => ((r.codigoMaquina || (r.descripcionResumen || '').split('·')[0]).trim().split(' ')[0] || '').toUpperCase();
    for (const r of recursos) {
      const detalle = r.descripcionResumen || r.descripcion || '';
      let clave;
      if (r.tipo === 'Maquinaria') {
        // Agrupa por máquina (código), no por precio: así el borrador y sus
        // partes quedan en la misma fila.
        clave = `maq|${codigoDe(r)}`;
      } else if (r.tipo === 'Personal') {
        // Personal: agrupa por cargo + origen (el desglose va por entrada).
        const cargo = normalizar(r.descripcion);
        clave = `pers|${r.origen || 'JURP'}|${cargo}`;
      } else {
        // Insumos: agrupa por descripción + unidad (sin importar precio ni si
        // está guardado). El P. Unitario se recalcula como promedio ponderado.
        clave = `${r.tipo}|${normalizar(detalle)}|${r.unidad || 'und'}`;
      }
      if (!grupos.has(clave)) {
        grupos.set(clave, {
          ...r, cantidadTotal: 0, totalSum: 0, count: 0,
          registros: [], idsLocales: [], partesMaq: [], entradas: [],
          idsBorrador: [], tieneParteAbierto: false,
        });
      }
      const g = grupos.get(clave);
      g.idsLocales.push(r.idLocal);
      if (r.tipo === 'Maquinaria' && r.esBorrador) {
        // El borrador aporta la identidad de la máquina pero no cuenta como parte.
        g.idsBorrador.push(r.idLocal);
        // Conserva los datos de máquina en el grupo.
        g.codigoMaquina = r.codigoMaquina; g.modeloId = r.modeloId; g.modeloMaquina = r.modeloMaquina;
        g.placa = r.placa; g.origen = r.origen; g.equipoId = r.equipoId; g.equipo = r.equipo;
        g.marcaId = r.marcaId; g.marca = r.marca;
        continue;
      }
      g.cantidadTotal += r.cantidad;
      g.totalSum += r.total;
      g.count += 1;
      if (r.guardadoEnDB && r.dbId) g.registros.push({ dbId: r.dbId, endpoint: r.endpoint });
      if (r.tipo === 'Maquinaria') {
        if (!r.cerrado) g.tieneParteAbierto = true;
        g.partesMaq.push({ dbId: r.dbId, idLocal: r.idLocal, cerrado: r.cerrado, guardadoEnDB: r.guardadoEnDB, endpoint: r.endpoint, numeroParte: r.numeroParte || '', registro: r });
      }
      if (r.tipo === 'Insumo') {
        g.entradas.push({ idLocal: r.idLocal, dbId: r.dbId, guardadoEnDB: r.guardadoEnDB, endpoint: r.endpoint, cantidad: r.cantidad, precioUnitario: r.precioUnitario, total: r.total, unidad: r.unidad || 'und' });
      }
      if (r.tipo === 'Personal') {
        g.entradas.push({ idLocal: r.idLocal, dbId: r.dbId, guardadoEnDB: r.guardadoEnDB, endpoint: r.endpoint, cantidad: r.cantidad, precioUnitario: r.precioUnitario, total: r.total, numPersonas: r.numPersonas, horasTrabajo: r.horasTrabajo, horasExtras: r.horasExtras });
      }
    }
    return Array.from(grupos.values());
  })();

  // Categorías del expediente: MANO DE OBRA / MATERIALES / EQUIPO.
  const CATEGORIAS = [
    { key: 'Personal',   titulo: 'MANO DE OBRA' },
    { key: 'Insumo',     titulo: 'MATERIALES' },
    { key: 'Maquinaria', titulo: 'EQUIPO' },
  ];
  const subtotalCategoria = (tipo) => recursosAgrupados
    .filter(r => r.tipo === tipo)
    .reduce((s, r) => s + r.totalSum, 0);

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
    doc.text(inc.tipo, 14, y); y += 9;
    doc.setFontSize(9);
    const infoRows = [
      ['Código Incidente:', inc.codigoIncidente || '-'],
      ['Código Infra.:', inc.codigo || 'Sin Código'],
      ['Ubicación:', inc.lugar || '-'],
      ['Fecha:', inc.fecha || '-'],
      ['Estado:', estadoTexto],
      ['Gravedad:', gravedadTexto],
      ['Reportado por:', inc.usuario || '-'],
    ];
    for (const [label, val] of infoRows) {
      doc.setFont(undefined,'bold'); doc.setTextColor(100,116,139); doc.text(label, 14, y);
      doc.setFont(undefined,'normal'); doc.setTextColor(30,41,59);
      const lines = doc.splitTextToSize(val, 140);
      doc.text(lines, 55, y);
      y += lines.length * 4.5 + 1.5;
    }
    y += 5; doc.setDrawColor(226,232,240); doc.line(14,y,196,y); y += 8;
    doc.setFontSize(11); doc.setFont(undefined,'bold'); doc.setTextColor(30,41,59);
    doc.text('Detalle de Recursos y Costeo', 14, y); y += 5;
    if (recursos.length > 0) {
      autoTable(doc, {
        startY: y,
        head: [['N°','Detalle','Cantidad','Unidad','P. Unit. (S/)','Total (S/)','']],
        body: (() => {
          // Filas agrupadas por categoría, con subtotal por grupo.
          const filas = [];
          let n = 0;
          for (const cat of CATEGORIAS) {
            const delGrupo = recursosAgrupados.filter(r => r.tipo === cat.key);
            if (!delGrupo.length) continue;
            filas.push([{ content: cat.titulo, colSpan: 7, styles: { fillColor: [238,242,247], fontStyle: 'bold', fontSize: 8, textColor: [51,65,85] } }]);
            for (const r of delGrupo) {
              n++;
              filas.push([
                n,
                (r.descripcionResumen || r.descripcion || '').replace(/\n/g, ' '),
                fmtNum(r.cantidadTotal),
                r.tipo === 'Personal' ? 'HH' : r.tipo === 'Maquinaria' ? 'HE' : (r.unidad || 'und'),
                fmtNum(r.precioUnitario),
                fmtNum(r.totalSum),
                '',
              ]);
            }
            filas.push([
              { content: `Subtotal ${cat.titulo}`, colSpan: 5, styles: { halign: 'right', fontStyle: 'bold', fontSize: 8, textColor: [100,116,139] } },
              { content: fmtNum(subtotalCategoria(cat.key)), styles: { halign: 'right', fontStyle: 'bold', fontSize: 8 } },
              '',
            ]);
          }
          return filas;
        })(),
        foot: [[{ content: 'COSTO TOTAL:', colSpan: 5, styles: { halign: 'right' } }, `S/ ${fmtNum(costoTotalIncidente)}`, '']],
        styles:{fontSize:8,cellPadding:2.5,lineColor:[226,232,240],lineWidth:0.1},
        headStyles:{fillColor:[20,99,165],textColor:[255,255,255],fontStyle:'bold',fontSize:8},
        footStyles:{fillColor:[241,245,249],textColor:[30,41,59],fontStyle:'bold',fontSize:9},
        alternateRowStyles:{fillColor:[248,250,252]},
        margin:{left:14,right:14},
        columnStyles:{0:{cellWidth:10,halign:'center'},1:{cellWidth:78},2:{cellWidth:20,halign:'right'},3:{cellWidth:14,halign:'center'},4:{cellWidth:26,halign:'right'},5:{cellWidth:30,halign:'right'},6:{cellWidth:4}},
      });
    } else {
      doc.setFontSize(9); doc.setFont(undefined,'normal'); doc.setTextColor(100,116,139);
      doc.text('No hay recursos registrados para este incidente.', 14, y+6);
    }
    const pageCount = doc.internal.getNumberOfPages();
    for (let i=1;i<=pageCount;i++){doc.setPage(i);doc.setFontSize(7);doc.setTextColor(150);doc.text(`Página ${i} de ${pageCount} — Sistema Integrado de Monitoreo — JURP`,105,290,{align:'center'});}
    const blobUrl = doc.output('bloburl');
    setPdfUrlActivo(blobUrl);
    setModalPdfAbierto(true);
  };

  const exportarExcel = async () => {
    if (!incidenteActivo) return;
    const inc = incidenteActivo;
    const estadoTexto = inc.estado === 'pat' ? 'Pendiente' : inc.estado === 'ate' ? 'En Atención' : inc.estado === 'cer' ? 'Cerrado' : inc.estado;
    const gravedadTexto = inc.gravedad === 'lev' ? 'Leve' : inc.gravedad === 'mod' ? 'Moderada' : inc.gravedad === 'gra' ? 'Grave' : inc.gravedad;
    const fechaGenerado = new Date().toLocaleString('es-PE');
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Reporte de Incidente');
    ws.columns = [{ width: 22 }, { width: 48 }, { width: 12 }, { width: 8 }, { width: 15 }, { width: 16 }, { width: 3 }];
    const azul = { type: 'pattern', pattern: 'solid', fgColor: { argb: '1463A5' } };
    const azulClaro = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'E0F2FE' } };
    const grisClaro = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F1F5F9' } };
    const fuenteBlanca = { bold: true, color: { argb: 'FFFFFF' }, size: 12 };
    const fuenteBlancaSm = { bold: true, color: { argb: 'FFFFFF' }, size: 10 };
    const borde = { top:{style:'thin',color:{argb:'E2E8F0'}}, bottom:{style:'thin',color:{argb:'E2E8F0'}}, left:{style:'thin',color:{argb:'E2E8F0'}}, right:{style:'thin',color:{argb:'E2E8F0'}} };
    for (let r = 1; r <= 3; r++) { for (let c = 1; c <= 7; c++) { ws.getCell(r, c).fill = azul; } }
    ws.getRow(1).height = 28; ws.getRow(2).height = 20; ws.getRow(3).height = 18;
    try {
      const logoB64 = await imgToBase64(logo);
      if (logoB64) {
        const imgId = wb.addImage({ base64: logoB64.split(',')[1], extension: 'png' });
        ws.addImage(imgId, { tl: { col: 0, row: 0 }, ext: { width: 75, height: 65 } });
      }
    } catch(e) {}
    ws.mergeCells('C1:G1');
    ws.getCell('C1').value = 'JUNTA DE RIEGO PRESURIZADO';
    ws.getCell('C1').font = fuenteBlanca;
    ws.getCell('C1').alignment = { vertical: 'middle' };
    ws.mergeCells('C2:G2');
    ws.getCell('C2').value = 'Reporte de Gestión de Incidente';
    ws.getCell('C2').font = fuenteBlancaSm;
    ws.getCell('C2').alignment = { vertical: 'middle' };
    ws.mergeCells('C3:G3');
    ws.getCell('C3').value = `Generado: ${fechaGenerado}`;
    ws.getCell('C3').font = { italic: true, size: 9, color: { argb: 'D0D5DD' } };
    ws.getCell('C3').alignment = { vertical: 'middle' };
    ws.getRow(4).height = 6;
    ws.mergeCells('A5:G5');
    ws.getCell('A5').value = 'DATOS DEL INCIDENTE';
    ws.getCell('A5').font = { bold: true, color: { argb: 'FFFFFF' }, size: 10 };
    ws.getCell('A5').fill = azul;
    ['B5','C5','D5','E5','F5','G5'].forEach(c => { ws.getCell(c).fill = azul; });
    ws.getRow(5).height = 22;
    const campos = [
      ['Tipo de Incidente', inc.tipo], ['Código Incidente', inc.codigoIncidente || '-'], ['Código Infraestructura', inc.codigo || 'Sin Código'],
      ['Ubicación', inc.lugar || '-'], ['Fecha', inc.fecha || '-'],
      ['Estado', estadoTexto], ['Gravedad', gravedadTexto], ['Reportado por', inc.usuario || '-'],
    ];
    campos.forEach(([label, val], i) => {
      ws.getCell(`A${6+i}`).value = label;
      ws.getCell(`A${6+i}`).font = { bold: true, size: 9, color: { argb: '64748B' } };
      ws.getCell(`A${6+i}`).fill = grisClaro;
      ws.mergeCells(`B${6+i}:G${6+i}`);
      ws.getCell(`B${6+i}`).value = val;
      ws.getCell(`B${6+i}`).font = { size: 10 };
    });
    const rStart = 6 + campos.length + 1;
    ws.mergeCells(`A${rStart}:G${rStart}`);
    ws.getCell(`A${rStart}`).value = 'DETALLE DE RECURSOS Y COSTEO';
    ws.getCell(`A${rStart}`).font = { bold: true, color: { argb: 'FFFFFF' }, size: 10 };
    ws.getCell(`A${rStart}`).fill = azul;
    ['B','C','D','E','F','G'].forEach(c => { ws.getCell(`${c}${rStart}`).fill = azul; });
    ws.getRow(rStart).height = 22;
    const hRow = rStart + 1;
    ['N°','Detalle','Cantidad','Unidad','P. Unit. (S/)','Total (S/)',''].forEach((h, i) => {
      const cell = ws.getCell(hRow, i + 1);
      cell.value = h;
      cell.font = { bold: true, color: { argb: 'FFFFFF' }, size: 9 };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '3B82F6' } };
      cell.alignment = { horizontal: i >= 3 ? 'right' : 'left', vertical: 'middle' };
      cell.border = borde;
    });
    let rowNum = hRow;
    let n = 0;
    for (const cat of CATEGORIAS) {
      const delGrupo = recursosAgrupados.filter(r => r.tipo === cat.key);
      if (!delGrupo.length) continue;

      // Cabecera de categoría
      rowNum++;
      ws.mergeCells(`A${rowNum}:G${rowNum}`);
      ws.getCell(`A${rowNum}`).value = cat.titulo;
      ws.getCell(`A${rowNum}`).font = { bold: true, size: 9, color: { argb: '334155' } };
      ws.getCell(`A${rowNum}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'EEF2F7' } };
      ws.getCell(`A${rowNum}`).border = borde;

      // Filas del grupo
      delGrupo.forEach((r, i) => {
        rowNum++; n++;
        const vals = [n, (r.descripcionResumen || r.descripcion || '').replace(/\n/g, ' '), r.cantidadTotal, r.tipo === 'Personal' ? 'HH' : r.tipo === 'Maquinaria' ? 'HE' : (r.unidad||'und'), parseFloat(r.precioUnitario), r.totalSum, ''];
        vals.forEach((v, j) => {
          const cell = ws.getCell(rowNum, j + 1);
          cell.value = v;
          cell.font = { size: 9 };
          cell.border = borde;
          if (j >= 2) cell.alignment = { horizontal: 'right' };
          if (j === 4 || j === 5) cell.numFmt = '#,##0.00';
          if (i % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F8FAFC' } };
        });
      });

      // Subtotal del grupo
      rowNum++;
      ws.mergeCells(`A${rowNum}:E${rowNum}`);
      ws.getCell(`A${rowNum}`).value = `Subtotal ${cat.titulo}`;
      ws.getCell(`A${rowNum}`).font = { bold: true, size: 9, color: { argb: '64748B' } };
      ws.getCell(`A${rowNum}`).alignment = { horizontal: 'right' };
      ws.getCell(`F${rowNum}`).value = subtotalCategoria(cat.key);
      ws.getCell(`F${rowNum}`).font = { bold: true, size: 9 };
      ws.getCell(`F${rowNum}`).numFmt = '#,##0.00';
      ws.getCell(`F${rowNum}`).alignment = { horizontal: 'right' };
    }
    const totalRow = rowNum + 2;
    ws.mergeCells(`A${totalRow}:E${totalRow}`);
    ws.getCell(`A${totalRow}`).value = 'COSTO TOTAL:';
    ws.getCell(`A${totalRow}`).font = { bold: true, size: 10 };
    ws.getCell(`A${totalRow}`).fill = azulClaro;
    ws.getCell(`A${totalRow}`).alignment = { horizontal: 'right' };
    ['B','C','D','E'].forEach(c => { ws.getCell(`${c}${totalRow}`).fill = azulClaro; });
    ws.getCell(`F${totalRow}`).value = costoTotalIncidente;
    ws.getCell(`F${totalRow}`).font = { bold: true, size: 11 };
    ws.getCell(`F${totalRow}`).numFmt = '"S/ "#,##0.00';
    ws.getCell(`F${totalRow}`).fill = azulClaro;
    ws.getCell(`F${totalRow}`).alignment = { horizontal: 'right' };
    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Reporte_Incidente_${inc.codigo || inc.id}_${new Date().toISOString().slice(0,10)}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ══════════════════════════════════════════════════════════════════════
  //  REPORTE GLOBAL — todas las incidencias en un solo archivo
  // ══════════════════════════════════════════════════════════════════════

  // Trae TODOS los costeos de una vez y los agrupa por incidente.
  // (Una sola llamada por tipo, no una por incidente: mucho más rápido.)
  const recopilarDatosGlobales = async () => {
    const BASE = 'https://gideonstudio.duckdns.org/api/v1/mobile/operations';
    const [rPers, rMat, rMaq] = await Promise.all([
      fetch(`${BASE}/incident-personnels/`),
      fetch(`${BASE}/incident-materials/`),
      fetch(`${BASE}/daily-part-heavy-equipments/`),
    ]);
    const [dPers, dMat, dMaq] = await Promise.all([rPers.json(), rMat.json(), rMaq.json()]);
    const lPers = Array.isArray(dPers) ? dPers : (dPers.results || []);
    const lMat  = Array.isArray(dMat)  ? dMat  : (dMat.results  || []);
    const lMaq  = Array.isArray(dMaq)  ? dMaq  : (dMaq.results  || []);

    const porIncidente = {};
    const asegurar = (id) => {
      const k = String(id);
      if (!porIncidente[k]) porIncidente[k] = { personal: [], materiales: [], maquinaria: [], total: 0 };
      return porIncidente[k];
    };

    lPers.forEach(i => {
      if (i.incident_report == null) return;
      const g = asegurar(i.incident_report);
      const cant = parseFloat(i.quantity_hours) || 0;
      const pu = parseFloat(i.unit_price) || 0;
      const tot = cant * pu;
      g.personal.push({
        descripcion: (i.description || '').split('\n')[0].trim() || '—',
        origen: i.origin || 'JURP',
        personas: i.num_personas ?? 1,
        horas: cant, precio: pu, total: tot,
      });
      g.total += tot;
    });

    lMat.forEach(i => {
      if (i.incident_report == null) return;
      const g = asegurar(i.incident_report);
      const cant = parseFloat(i.quantity) || 0;
      const pu = parseFloat(i.unit_price) || 0;
      const tot = cant * pu;
      g.materiales.push({
        descripcion: i.description || '—',
        unidad: i.unit || 'und',
        cantidad: cant, precio: pu, total: tot,
      });
      g.total += tot;
    });

    lMaq.forEach(i => {
      if (i.incident_report == null) return;
      const g = asegurar(i.incident_report);
      const hIni = parseFloat(i.start_horometer) || 0;
      const hFin = parseFloat(i.end_horometer) || 0;
      const horas = Math.max(0, hFin - hIni);
      const pu = parseFloat(i.unit_price) || 0;
      const tot = horas * pu;
      g.maquinaria.push({
        parte: i.part_number || '—',
        actividad: i.activities || '—',
        proveedor: i.provider || '—',
        metrado: parseFloat(i.metrado) || 0,
        metradoUnidad: i.metrado_unidad || 'm3',
        horas, precio: pu, total: tot,
        combustible: parseFloat(i.fuel_gallons) || 0,
      });
      g.total += tot;
    });

    return porIncidente;
  };

  const uMetrado = (u) => ({ m: 'm', m2: 'm²', m3: 'm³', glb: 'glb' }[u] || u || 'm³');
  const txtCoords = (i) => (i.latitud != null && i.longitud != null)
    ? `${i.latitud.toFixed(6)}, ${i.longitud.toFixed(6)}`
    : 'Sin GPS';
  const urlMaps = (i) => (i.latitud != null && i.longitud != null)
    ? `https://www.google.com/maps?q=${i.latitud},${i.longitud}` : '';
  const txtEstado = (e) => e === 'pat' ? 'Pendiente' : e === 'ate' ? 'En Atención' : e === 'cer' ? 'Cerrado' : e;
  const txtGravedad = (g) => g === 'lev' ? 'Leve' : g === 'mod' ? 'Moderada' : g === 'gra' ? 'Grave' : g;

  // Abre la ventanita de reporte y calcula cuántas incidencias tienen datos.
  const abrirModalReporte = async () => {
    setModalReporteGlobal(true);
    setConDatosInfo(null);
    try {
      const datos = await recopilarDatosGlobales();
      const base = incidentesFiltradosRef.current || [];
      const conDatos = base.filter(i => {
        const d = datos[String(i.id)];
        return d && (d.personal.length || d.maquinaria.length || d.materiales.length);
      }).length;
      setConDatosInfo({ conDatos, total: base.length });
    } catch (e) {
      setConDatosInfo({ conDatos: null, total: null });
    }
  };

  // ── Reporte global en PDF ──────────────────────────────────────────────
  const reporteGlobalPDF = async (listaEntrada) => {
    setGenerandoReporte(true);
    try {
      const datos = await recopilarDatosGlobales();
      // Solo las incidencias que tienen algún recurso costeado.
      const lista = (listaEntrada || []).filter(i => {
        const d = datos[String(i.id)];
        return d && (d.personal.length || d.maquinaria.length || d.materiales.length);
      });
      if (!lista.length) {
        Swal.fire('Sin datos', 'Ninguna de las incidencias seleccionadas tiene recursos costeados.', 'info');
        setGenerandoReporte(false);
        return;
      }
      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      const W = doc.internal.pageSize.getWidth();
      const logoB64 = await imgToBase64(logo).catch(() => null);

      // ── Portada / resumen ──
      doc.setFillColor(20, 99, 165);
      doc.rect(0, 0, W, 28, 'F');
      if (logoB64) { try { doc.addImage(logoB64, 'PNG', 10, 5, 19, 19); } catch (e) {} }
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(14); doc.setFont(undefined, 'bold');
      doc.text('JUNTA DE RIEGO PRESURIZADO', 34, 12);
      doc.setFontSize(11); doc.setFont(undefined, 'normal');
      doc.text('Reporte General de Incidencias', 34, 19);
      doc.setFontSize(8);
      doc.text(`Generado: ${new Date().toLocaleString('es-PE')} · ${lista.length} incidencia(s)`, 34, 24.5);

      const totalGeneral = lista.reduce((a, i) => a + (datos[String(i.id)]?.total || 0), 0);
      autoTable(doc, {
        startY: 34,
        head: [['CÓDIGO', 'TIPO', 'UBICACIÓN', 'COORDENADAS', 'FECHA', 'ESTADO', 'GRAVEDAD', 'REPORTADO POR', 'COSTO S/']],
        body: lista.map(i => ([
          i.codigoIncidente || '—', i.tipo || '—', i.lugar || '—', txtCoords(i), i.fecha || '—',
          txtEstado(i.estado), txtGravedad(i.gravedad), i.usuario || '—',
          (datos[String(i.id)]?.total || 0).toFixed(2),
        ])),
        foot: [['', '', '', '', '', '', '', 'TOTAL GENERAL', totalGeneral.toFixed(2)]],
        styles: { fontSize: 7.5, cellPadding: 2 },
        headStyles: { fillColor: [20, 99, 165], textColor: 255, fontSize: 7.5 },
        footStyles: { fillColor: [224, 242, 254], textColor: [20, 99, 165], fontStyle: 'bold' },
        columnStyles: { 3: { fontSize: 7 }, 8: { halign: 'right' } },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        margin: { left: 10, right: 10 },
      });

      // ── Una sección por incidencia ──
      lista.forEach((inc) => {
        const d = datos[String(inc.id)] || { personal: [], materiales: [], maquinaria: [], total: 0 };
        doc.addPage();
        doc.setFillColor(20, 99, 165);
        doc.rect(0, 0, W, 20, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(11); doc.setFont(undefined, 'bold');
        doc.text(`${inc.codigoIncidente || 'Incidencia'} · ${inc.tipo || ''}`, 10, 9);
        doc.setFontSize(8); doc.setFont(undefined, 'normal');
        doc.text(`${inc.lugar || '—'}  |  ${inc.fecha || '—'}  |  ${txtEstado(inc.estado)} · ${txtGravedad(inc.gravedad)}`, 10, 15.5);

        let y = 26;
        // Coordenadas GPS con enlace a Google Maps.
        if (inc.latitud != null && inc.longitud != null) {
          doc.setTextColor(71, 85, 105);
          doc.setFontSize(8.5); doc.setFont(undefined, 'bold');
          doc.text('Coordenadas GPS:', 10, y);
          doc.setFont(undefined, 'normal');
          doc.text(txtCoords(inc), 42, y);
          doc.setTextColor(20, 99, 165);
          doc.textWithLink('Ver en Google Maps', 90, y, { url: urlMaps(inc) });
          y += 7;
        }
        const bloque = (titulo, head, body, foots) => {
          if (!body.length) return;
          doc.setTextColor(20, 99, 165);
          doc.setFontSize(9); doc.setFont(undefined, 'bold');
          doc.text(titulo, 10, y);
          autoTable(doc, {
            startY: y + 2,
            head: [head], body, foot: foots ? [foots] : undefined,
            styles: { fontSize: 7.5, cellPadding: 1.8 },
            headStyles: { fillColor: [100, 116, 139], textColor: 255, fontSize: 7.5 },
            footStyles: { fillColor: [241, 245, 249], textColor: [30, 41, 59], fontStyle: 'bold', fontSize: 7.5 },
            alternateRowStyles: { fillColor: [248, 250, 252] },
            margin: { left: 10, right: 10 },
          });
          y = doc.lastAutoTable.finalY + 7;
        };

        bloque('MANO DE OBRA',
          ['CARGO', 'ORIGEN', 'N° PERS.', 'HORAS', 'P. UNIT.', 'TOTAL S/'],
          d.personal.map(x => ([x.descripcion, x.origen, String(x.personas), x.horas.toFixed(2), x.precio.toFixed(2), x.total.toFixed(2)])),
          ['', '', '', '', 'SUBTOTAL', d.personal.reduce((a, x) => a + x.total, 0).toFixed(2)]);

        bloque('MAQUINARIA',
          ['N° PARTE', 'ACTIVIDAD', 'PROVEEDOR', 'VOLUMEN', 'HORAS', 'P. UNIT.', 'TOTAL S/'],
          d.maquinaria.map(x => ([x.parte, x.actividad, x.proveedor, `${x.metrado.toFixed(2)} ${uMetrado(x.metradoUnidad)}`, x.horas.toFixed(2), x.precio.toFixed(2), x.total.toFixed(2)])),
          ['', '', '', '', '', 'SUBTOTAL', d.maquinaria.reduce((a, x) => a + x.total, 0).toFixed(2)]);

        bloque('MATERIALES',
          ['DESCRIPCIÓN', 'UNIDAD', 'CANTIDAD', 'P. UNIT.', 'TOTAL S/'],
          d.materiales.map(x => ([x.descripcion, x.unidad, x.cantidad.toFixed(2), x.precio.toFixed(2), x.total.toFixed(2)])),
          ['', '', '', 'SUBTOTAL', d.materiales.reduce((a, x) => a + x.total, 0).toFixed(2)]);

        doc.setTextColor(20, 99, 165);
        doc.setFontSize(11); doc.setFont(undefined, 'bold');
        doc.text(`COSTO TOTAL DE LA INCIDENCIA:  S/ ${d.total.toFixed(2)}`, 10, y + 2);
      });

      // Numeración de páginas
      const paginas = doc.internal.getNumberOfPages();
      for (let i = 1; i <= paginas; i++) {
        doc.setPage(i);
        doc.setTextColor(148, 163, 184);
        doc.setFontSize(7.5); doc.setFont(undefined, 'normal');
        doc.text(`Página ${i} de ${paginas}`, W - 10, doc.internal.pageSize.getHeight() - 6, { align: 'right' });
      }

      doc.save(`Reporte_General_Incidencias_${new Date().toISOString().slice(0, 10)}.pdf`);
      setModalReporteGlobal(false);
    } catch (e) {
      console.error(e);
      Swal.fire('Error', 'No se pudo generar el reporte. Inténtalo de nuevo.', 'error');
    } finally {
      setGenerandoReporte(false);
    }
  };

  // ── Reporte global en Excel ────────────────────────────────────────────
  const reporteGlobalExcel = async (listaEntrada) => {
    setGenerandoReporte(true);
    try {
      const datos = await recopilarDatosGlobales();
      // Solo las incidencias que tienen algún recurso costeado.
      const lista = (listaEntrada || []).filter(i => {
        const d = datos[String(i.id)];
        return d && (d.personal.length || d.maquinaria.length || d.materiales.length);
      });
      if (!lista.length) {
        Swal.fire('Sin datos', 'Ninguna de las incidencias seleccionadas tiene recursos costeados.', 'info');
        setGenerandoReporte(false);
        return;
      }
      const wb = new ExcelJS.Workbook();
      const azul = { type: 'pattern', pattern: 'solid', fgColor: { argb: '1463A5' } };
      const azulClaro = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'E0F2FE' } };
      const gris = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F1F5F9' } };
      const borde = { top:{style:'thin',color:{argb:'E2E8F0'}}, bottom:{style:'thin',color:{argb:'E2E8F0'}}, left:{style:'thin',color:{argb:'E2E8F0'}}, right:{style:'thin',color:{argb:'E2E8F0'}} };

      // ══ HOJA 1: RESUMEN ══
      const ws = wb.addWorksheet('Resumen');
      ws.columns = [{ width: 26 }, { width: 30 }, { width: 32 }, { width: 13 }, { width: 13 },
                    { width: 20 }, { width: 18 }, { width: 14 }, { width: 13 }, { width: 18 }, { width: 15 }];
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
      ws.getCell('B2').value = 'Reporte General de Incidencias';
      ws.getCell('B2').font = { bold: true, color: { argb: 'FFFFFF' }, size: 10 };
      ws.getCell('B2').alignment = { vertical: 'middle' };
      ws.mergeCells('B3:K3');
      ws.getCell('B3').value = `Generado: ${new Date().toLocaleString('es-PE')} · ${lista.length} incidencia(s)`;
      ws.getCell('B3').font = { italic: true, size: 9, color: { argb: 'D0D5DD' } };
      ws.getCell('B3').alignment = { vertical: 'middle' };
      ws.getRow(4).height = 6;

      const cab = ['CÓDIGO', 'TIPO', 'UBICACIÓN', 'LATITUD', 'LONGITUD', 'VER EN MAPA',
                   'FECHA', 'ESTADO', 'GRAVEDAD', 'REPORTADO POR', 'COSTO S/'];
      cab.forEach((h, i) => {
        const c = ws.getCell(5, i + 1);
        c.value = h; c.fill = azul; c.border = borde;
        c.font = { bold: true, color: { argb: 'FFFFFF' }, size: 9 };
        c.alignment = { horizontal: 'center', vertical: 'middle' };
      });
      ws.getRow(5).height = 20;

      lista.forEach((inc, i) => {
        const r = 6 + i;
        const tot = datos[String(inc.id)]?.total || 0;
        const tieneGps = inc.latitud != null && inc.longitud != null;
        const fila = [inc.codigoIncidente || '—', inc.tipo || '—', inc.lugar || '—',
                      tieneGps ? inc.latitud : '—', tieneGps ? inc.longitud : '—', '',
                      inc.fecha || '—', txtEstado(inc.estado), txtGravedad(inc.gravedad),
                      inc.usuario || '—', tot];
        fila.forEach((v, ci) => {
          const c = ws.getCell(r, ci + 1);
          c.value = v; c.border = borde; c.font = { size: 9 };
          if (ci === 3 || ci === 4) { if (tieneGps) c.numFmt = '0.000000'; c.alignment = { horizontal: 'right' }; }
          if (ci === 10) { c.numFmt = '#,##0.00'; c.alignment = { horizontal: 'right' }; }
        });
        // Enlace clicable a Google Maps
        if (tieneGps) {
          const cMapa = ws.getCell(r, 6);
          cMapa.value = { text: 'Abrir mapa', hyperlink: urlMaps(inc) };
          cMapa.font = { size: 9, color: { argb: '1463A5' }, underline: true };
          cMapa.alignment = { horizontal: 'center' };
        } else {
          ws.getCell(r, 6).value = '—';
          ws.getCell(r, 6).alignment = { horizontal: 'center' };
        }
      });

      const rTot = 6 + lista.length;
      ws.mergeCells(`A${rTot}:J${rTot}`);
      ws.getCell(`A${rTot}`).value = 'TOTAL GENERAL';
      ws.getCell(`A${rTot}`).font = { bold: true, size: 10, color: { argb: '1463A5' } };
      ws.getCell(`A${rTot}`).alignment = { horizontal: 'right' };
      ws.getCell(`A${rTot}`).fill = azulClaro;
      ws.getCell(`K${rTot}`).value = lista.reduce((a, i) => a + (datos[String(i.id)]?.total || 0), 0);
      ws.getCell(`K${rTot}`).numFmt = '#,##0.00';
      ws.getCell(`K${rTot}`).font = { bold: true, size: 11, color: { argb: '1463A5' } };
      ws.getCell(`K${rTot}`).fill = azulClaro;
      ws.getCell(`K${rTot}`).alignment = { horizontal: 'right' };
      ws.getCell(`K${rTot}`).border = borde;

      // ══ HOJA 2: DETALLE POR INCIDENCIA ══
      const wd = wb.addWorksheet('Detalle');
      wd.columns = [{ width: 30 }, { width: 34 }, { width: 16 }, { width: 15 },
                    { width: 14 }, { width: 14 }, { width: 15 }];
      let f = 1;
      const tituloSeccion = (texto, fill, size) => {
        wd.mergeCells(`A${f}:G${f}`);
        const c = wd.getCell(`A${f}`);
        c.value = texto; c.fill = fill;
        c.font = { bold: true, color: { argb: 'FFFFFF' }, size: size || 10 };
        c.alignment = { vertical: 'middle' };
        wd.getRow(f).height = size ? 22 : 18;
        f += 1;
      };
      const tablaDetalle = (encabezados, filas, etiquetaSub, subtotal) => {
        if (!filas.length) return;
        encabezados.forEach((h, i) => {
          const c = wd.getCell(f, i + 1);
          c.value = h; c.fill = gris; c.border = borde;
          c.font = { bold: true, size: 8.5, color: { argb: '475569' } };
          c.alignment = { horizontal: 'center' };
        });
        f += 1;
        filas.forEach(fila => {
          fila.forEach((v, ci) => {
            const c = wd.getCell(f, ci + 1);
            c.value = v; c.border = borde; c.font = { size: 9 };
            if (typeof v === 'number') { c.numFmt = '#,##0.00'; c.alignment = { horizontal: 'right' }; }
          });
          f += 1;
        });
        wd.getCell(f, encabezados.length - 1).value = etiquetaSub;
        wd.getCell(f, encabezados.length - 1).font = { bold: true, size: 9 };
        wd.getCell(f, encabezados.length - 1).alignment = { horizontal: 'right' };
        wd.getCell(f, encabezados.length).value = subtotal;
        wd.getCell(f, encabezados.length).numFmt = '#,##0.00';
        wd.getCell(f, encabezados.length).font = { bold: true, size: 9 };
        wd.getCell(f, encabezados.length).alignment = { horizontal: 'right' };
        f += 2;
      };

      lista.forEach(inc => {
        const d = datos[String(inc.id)] || { personal: [], materiales: [], maquinaria: [], total: 0 };
        tituloSeccion(`${inc.codigoIncidente || 'Incidencia'} · ${inc.tipo || ''}`, azul, 11);
        wd.mergeCells(`A${f}:G${f}`);
        wd.getCell(`A${f}`).value = `${inc.lugar || '—'}  |  ${inc.fecha || '—'}  |  ${txtEstado(inc.estado)} · ${txtGravedad(inc.gravedad)}  |  Reportado por: ${inc.usuario || '—'}`;
        wd.getCell(`A${f}`).font = { size: 9, color: { argb: '64748B' } };
        f += 1;
        // Coordenadas GPS con enlace a Google Maps
        if (inc.latitud != null && inc.longitud != null) {
          wd.getCell(`A${f}`).value = 'Coordenadas GPS:';
          wd.getCell(`A${f}`).font = { size: 9, bold: true, color: { argb: '64748B' } };
          wd.getCell(`B${f}`).value = txtCoords(inc);
          wd.getCell(`B${f}`).font = { size: 9, color: { argb: '334155' } };
          wd.getCell(`C${f}`).value = { text: 'Abrir en Google Maps', hyperlink: urlMaps(inc) };
          wd.getCell(`C${f}`).font = { size: 9, color: { argb: '1463A5' }, underline: true };
        } else {
          wd.getCell(`A${f}`).value = 'Coordenadas GPS:';
          wd.getCell(`A${f}`).font = { size: 9, bold: true, color: { argb: '64748B' } };
          wd.getCell(`B${f}`).value = 'Sin GPS';
          wd.getCell(`B${f}`).font = { size: 9, italic: true, color: { argb: '94A3B8' } };
        }
        f += 2;

        tablaDetalle(['CARGO', 'ORIGEN', 'N° PERS.', 'HORAS', 'P. UNIT.', 'TOTAL S/'],
          d.personal.map(x => ([x.descripcion, x.origen, x.personas, x.horas, x.precio, x.total])),
          'SUBTOTAL MANO DE OBRA', d.personal.reduce((a, x) => a + x.total, 0));

        tablaDetalle(['N° PARTE', 'ACTIVIDAD', 'PROVEEDOR', 'VOLUMEN', 'HORAS', 'P. UNIT.', 'TOTAL S/'],
          d.maquinaria.map(x => ([x.parte, x.actividad, x.proveedor, `${x.metrado.toFixed(2)} ${uMetrado(x.metradoUnidad)}`, x.horas, x.precio, x.total])),
          'SUBTOTAL MAQUINARIA', d.maquinaria.reduce((a, x) => a + x.total, 0));

        tablaDetalle(['DESCRIPCIÓN', 'UNIDAD', 'CANTIDAD', 'P. UNIT.', 'TOTAL S/'],
          d.materiales.map(x => ([x.descripcion, x.unidad, x.cantidad, x.precio, x.total])),
          'SUBTOTAL MATERIALES', d.materiales.reduce((a, x) => a + x.total, 0));

        wd.mergeCells(`A${f}:F${f}`);
        wd.getCell(`A${f}`).value = 'COSTO TOTAL DE LA INCIDENCIA';
        wd.getCell(`A${f}`).font = { bold: true, size: 10, color: { argb: '1463A5' } };
        wd.getCell(`A${f}`).alignment = { horizontal: 'right' };
        wd.getCell(`A${f}`).fill = azulClaro;
        wd.getCell(`G${f}`).value = d.total;
        wd.getCell(`G${f}`).numFmt = '#,##0.00';
        wd.getCell(`G${f}`).font = { bold: true, size: 10, color: { argb: '1463A5' } };
        wd.getCell(`G${f}`).fill = azulClaro;
        wd.getCell(`G${f}`).alignment = { horizontal: 'right' };
        f += 3;
      });

      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Reporte_General_Incidencias_${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      setModalReporteGlobal(false);
    } catch (e) {
      console.error(e);
      Swal.fire('Error', 'No se pudo generar el reporte. Inténtalo de nuevo.', 'error');
    } finally {
      setGenerandoReporte(false);
    }
  };

  const guardarCosteos = async () => {
    // Excluye los borradores de maquinaria (máquinas en la lista sin parte diario).
    const recursosNuevos = recursos.filter(r => !r.guardadoEnDB && !r.esBorrador);
    if (recursosNuevos.length === 0) return Swal.fire({ icon: 'info', title: 'Todo al día', text: 'No hay recursos nuevos por guardar.' });
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
          formData.append('num_personas', parseInt(r.numPersonas)||0);
          formData.append('horas_normales', parseFloat(r.horasTrabajo)||0);
          formData.append('horas_extras', parseFloat(r.horasExtras)||0);
          formData.append('origin', r.origen || 'JURP');
        } else if (r.tipo === 'Insumo') {
          endpoint = `${BASE_URL}/api/v1/mobile/operations/incident-materials/`;
          formData.append('description', r.descripcion);
          formData.append('quantity', r.cantidad);
          formData.append('unit_price', r.precioUnitario);
          formData.append('unit', r.unidad || 'und');
        } else if (r.tipo === 'Maquinaria') {
          endpoint = `${BASE_URL}/api/v1/mobile/operations/daily-part-heavy-equipments/`;
          formData.append('part_number', r.numeroParte); formData.append('date', /^\d{4}-\d{2}-\d{2}$/.test(r.fechaParte) ? r.fechaParte : getFechaHoy());
          formData.append('shift', r.turno); formData.append('work_zone_text', r.zonaTrabajo);
          formData.append('provider', r.proveedor); formData.append('operator', r.operador);
          formData.append('licencia', r.licencia || ''); formData.append('categoria', r.categoria || '');
          if (r.longitud !== '' && r.longitud != null) formData.append('longitud', r.longitud);
          formData.append('equipment_name', r.equipo);
          formData.append('brand_name', r.marca);
          formData.append('model_plate', r.placa ? `${r.modeloMaquina || ''} / ${r.placa}`.trim() : (r.modeloMaquina || '')); formData.append('start_horometer', parseFloat(r.hmInicio) || 0);
          formData.append('end_horometer', parseFloat(r.hmFin) || 0); formData.append('fuel_gallons', parseFloat(r.combustible) || 0);
          formData.append('fuel_voucher', r.vale); formData.append('activities', r.actividad);
          formData.append('observations', r.observaciones); formData.append('unit_price', r.precioUnitario);
          if (r.fotoParte) formData.append('part_photo', r.fotoParte);
          if (r.fotoVale) formData.append('voucher_photo', r.fotoVale);
          if (r.incluirMetrado || IMG_METRADO[r.actividad]) {
            if (r.anchoSup !== '' && r.anchoSup != null) formData.append('width_top', r.anchoSup);
            if (r.anchoInf !== '' && r.anchoInf != null) formData.append('width_bottom', r.anchoInf);
            if (r.altura !== '' && r.altura != null) formData.append('height', r.altura);
            if (r.longitud !== '' && r.longitud != null) formData.append('length', r.longitud);
            // Metrado final: calculado por fórmula o ingresado a mano.
            const mv = calcMetradoDe(r);
            formData.append('metrado', mv.val.toFixed(2));
            formData.append('metrado_unidad', r.calcularMetrado ? mv.unit : (r.unidadMetrado || 'm3'));
            formData.append('metrado_calculado', r.calcularMetrado ? 'true' : 'false');
          }
        }
        const res = await fetch(endpoint, { method: 'POST', body: formData });
        if (!res.ok) {
          let detalle = '';
          try { detalle = JSON.stringify(await res.json()); } catch (e) { detalle = `código ${res.status}`; }
          throw new Error(`Error al guardar ${r.tipo}: ${detalle}`);
        }
        if (r.tipo === 'Maquinaria' && r.modeloId) {
          try {
            await fetch(`${BASE_URL}/api/v1/mobile/operations/modelos/${r.modeloId}/`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ estado: 1 }),
            });
          } catch (e) { console.error('No se pudo actualizar disponibilidad de la máquina', e); }
        }
      }
      Swal.fire({ icon: 'success', title: 'Éxito', text: 'Se guardó correctamente', confirmButtonColor: '#206bc4' });
      setRecursos([]); setModalAbierto(false); 
    } catch (error) {
      console.error(error);
      Swal.fire({ icon: 'error', title: 'Error al guardar', text: error.message || 'Hubo un error al guardar en la base de datos.' });
    } finally { setGuardando(false); }
  };

  // ── Aplica los filtros antes de paginar ────────────────────────────────
  const incidentesFiltrados = incidentes.filter(inc => {
    if (filtroTipo && inc.tipoBase !== filtroTipo) return false;
    if (filtroEstado && inc.estado !== filtroEstado) return false;
    if (filtroGravedad && inc.gravedad !== filtroGravedad) return false;
    if (busqueda.trim()) {
      const q = busqueda.toLowerCase().trim();
      const texto = `${inc.codigoIncidente} ${inc.codigo} ${inc.lugar} ${inc.tipo} ${inc.usuario}`.toLowerCase();
      if (!texto.includes(q)) return false;
    }
    return true;
  });

  // Lista de tipos presentes (para el select), ordenada.
  const tiposDisponibles = [...new Set(incidentes.map(i => i.tipoBase))].sort();
  incidentesFiltradosRef.current = incidentesFiltrados;
  const hayFiltros = filtroTipo || filtroEstado || filtroGravedad || busqueda.trim();
  const limpiarFiltros = () => { setFiltroTipo(''); setFiltroEstado(''); setFiltroGravedad(''); setBusqueda(''); setPaginaActual(1); };

  const indexUltimoItem = paginaActual * itemsPorPagina;
  const indexPrimerItem = indexUltimoItem - itemsPorPagina;
  const incidentesActuales = incidentesFiltrados.slice(indexPrimerItem, indexUltimoItem);
  const totalPaginas = Math.max(1, Math.ceil(incidentesFiltrados.length / itemsPorPagina));

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

  // Renderiza los campos de metrado según la actividad seleccionada.
  const renderCamposMetrado = () => {
    const act = nuevoRecurso.actividad;
    const set = (campo, val) => setNuevoRecurso({...nuevoRecurso, [campo]: val});
    const activo = !!nuevoRecurso.calcularMetrado;
    const inp = (campo, label, step='0.01') => (
      <div className="tbl-col"><label className="tbl-form-label" style={{ color: activo ? undefined : '#94a3b8' }}>{label}</label><input type="number" step={step} className="tbl-form-control" placeholder="0.00" value={nuevoRecurso[campo]} disabled={!activo} onChange={e => set(campo, e.target.value)} style={{ background: activo ? undefined : '#f1f5f9', cursor: activo ? undefined : 'not-allowed' }} /></div>
    );
    if (act === 'EXCAVACION DE MATERIAL' || act === 'ENROCADO')
      return <>{inp('anchoBase','Base B (m)')}{inp('corona','Corona b (m)')}{inp('altura','Altura h (m)')}{inp('longitud','Longitud L (m)')}</>;
    if (act === 'CARGUIO DE MATERIAL')
      return <>{inp('nViajes','N° Viajes','1')}{inp('volTolva','Vol. Tolva (m³)','0.1')}{inp('fe','Fe (esponj.)')}</>;
    if (act === 'DESCOLMATACION DE CAUCE')
      return <>{inp('anchoSup','Ancho a (m)')}{inp('hPromedio','h promedio (m)')}{inp('longitud','Longitud L (m)')}</>;
    if (act === 'ELIMINACION')
      return <>{inp('nViajes','N° Viajes','1')}{inp('volTolva','Vol. Tolva (m³)','0.1')}</>;
    if (act === 'CONFORMACION DE DIQUE')
      return <>{inp('corona','Corona b (m)')}{inp('altura','Altura h (m)')}{inp('talud','Talud Z (H:V)','0.1')}{inp('longitud','Longitud L (m)')}</>;
    if (act === 'PERFILADO DE TALUD')
      return <>{inp('altura','Altura h (m)')}{inp('talud','Talud Z (H:V)','0.1')}{inp('longitud','Longitud L (m)')}</>;
    if (act === 'HABILITACION DE ACCESO')
      return <div className="tbl-col-4">{inp('longitud','Longitud L (m)')}</div>;
    return null;
  };
  const formulaMetrado = {
    'EXCAVACION DE MATERIAL':'V = ((B+b)/2) × h × L','CARGUIO DE MATERIAL':'V = N × Vol.tolva / Fe',
    'DESCOLMATACION DE CAUCE':'V = a × h prom × L','ELIMINACION':'V = N × Vol.tolva',
    'CONFORMACION DE DIQUE':'V = ((B+b)/2) × h × L, B=b+2Zh','ENROCADO':'V = ((B+b)/2) × h × L',
    'PERFILADO DE TALUD':'A = h × √(1+Z²) × L','HABILITACION DE ACCESO':'Metrado = L',
  };

  return (
    <div className="tbl-page-wrapper">
      <div className="tbl-page-header">
        <div className="tbl-row align-items-center">
          <div className="tbl-col">
            <div className="tbl-page-pretitle">Gestión de Campo</div>
            <h2 className="tbl-page-title">Incidentes y Reportes</h2>
          </div>
          <div className="tbl-col-auto" style={{ display: 'flex', gap: '8px' }}>
            <button className="tbl-btn" onClick={abrirModalReporte} disabled={cargando || incidentes.length === 0}
              style={{ background:'#0ea5e9', color:'#fff', border:'none', display:'flex', alignItems:'center', gap:'8px', opacity: (cargando || incidentes.length === 0) ? 0.5 : 1 }}
              title="Generar reporte de todas las incidencias">
              <FaFileInvoice /> Reporte
            </button>
            <button className="tbl-btn tbl-btn-primary" onClick={obtenerIncidentes} disabled={cargando}>
              <FaSyncAlt className={cargando ? 'icon-spin' : ''} style={{marginRight: '8px'}} /> {cargando ? 'Cargando...' : 'Actualizar Datos'}
            </button>
          </div>
        </div>
      </div>
      <div className="tbl-page-body">
        {/* ── Barra de filtros ──────────────────────────────────────────── */}
        {!cargando && incidentes.length > 0 && (
          <div style={{ display:'flex', gap:'10px', alignItems:'center', flexWrap:'wrap', marginBottom:'16px', padding:'12px 14px', background:'#f8fafc', border:'1px solid #e2e8f0', borderRadius:'8px' }}>
            <span style={{ fontSize:'13px', color:'#64748b', fontWeight:600, display:'flex', alignItems:'center', gap:'6px' }}><FaFilter size={12} /> Filtrar:</span>

            <select className="tbl-form-select" value={filtroTipo} onChange={e => setFiltroTipo(e.target.value)} style={filtroSelStyle}>
              <option value="">Todos los tipos</option>
              {tiposDisponibles.map(t => <option key={t} value={t}>{t}</option>)}
            </select>

            <select className="tbl-form-select" value={filtroEstado} onChange={e => setFiltroEstado(e.target.value)} style={filtroSelStyle}>
              <option value="">Todos los estados</option>
              <option value="pat">Pendiente</option>
              <option value="ate">En Atención</option>
              <option value="cer">Cerrado</option>
            </select>

            <select className="tbl-form-select" value={filtroGravedad} onChange={e => setFiltroGravedad(e.target.value)} style={filtroSelStyle}>
              <option value="">Toda gravedad</option>
              <option value="lev">Leve</option>
              <option value="mod">Moderada</option>
              <option value="gra">Grave</option>
            </select>

            <div style={{ position:'relative', flex:'1', minWidth:'180px', maxWidth:'320px' }}>
              <FaSearch size={11} style={{ position:'absolute', left:'10px', top:'50%', transform:'translateY(-50%)', color:'#94a3b8' }} />
              <input type="text" className="tbl-form-control" placeholder="Buscar por código, lugar, usuario..." value={busqueda} onChange={e => setBusqueda(e.target.value)}
                style={{ ...filtroSelStyle, paddingLeft:'30px', width:'100%' }} />
            </div>

            {hayFiltros && (
              <button onClick={limpiarFiltros} style={{ display:'flex', alignItems:'center', gap:'5px', background:'#fff', border:'1px solid #cbd5e1', color:'#64748b', borderRadius:'6px', padding:'7px 12px', fontSize:'12px', fontWeight:600, cursor:'pointer' }} title="Limpiar filtros">
                <FaTimes size={11} /> Limpiar
              </button>
            )}

            <span style={{ marginLeft:'auto', fontSize:'12px', color:'#64748b', fontWeight:600, whiteSpace:'nowrap' }}>
              {incidentesFiltrados.length} de {incidentes.length}
            </span>
          </div>
        )}

        {cargando ? <div className="tbl-empty">Cargando datos...</div> 
        : incidentes.length === 0 ? <div className="tbl-empty">No hay incidentes registrados.</div> 
        : incidentesFiltrados.length === 0 ? (
          <div className="tbl-empty" style={{ textAlign:'center', padding:'40px' }}>
            <div style={{ fontSize:'14px', color:'#64748b', marginBottom:'10px' }}>Ningún incidente coincide con los filtros.</div>
            <button onClick={limpiarFiltros} className="tbl-btn tbl-btn-primary" style={{ fontSize:'13px' }}>Limpiar filtros</button>
          </div>
        )
        : (
          <>
            <div className="tbl-row-cards">
              {incidentesActuales.map(inc => (
                <div className="tbl-card" key={inc.id}>
                  <div className="tbl-card-img-top" onClick={() => verEvidencias(inc)} style={{cursor:'pointer',position:'relative'}} title="Ver evidencias">
                    {inc.imagenUrl ? <img src={inc.imagenUrl} alt="Evidencia" /> : <div className="tbl-img-placeholder"><FaCamera size={24} /><span>Sin Evidencia</span></div>}
                    <div style={{position:'absolute',top:0,left:0,right:0,height:'50px',background:'linear-gradient(to bottom, rgba(0,0,0,0.55), transparent)',borderRadius:'4px 4px 0 0',pointerEvents:'none'}}></div>
                    <div className="tbl-card-badges" style={{position:'absolute',top:'8px',left:'8px',display:'flex',gap:'4px',zIndex:1}}>{incidentesCerrados.includes(inc.id) ? <span style={{padding:'3px 10px',borderRadius:'4px',fontSize:'11px',fontWeight:'700',letterSpacing:'0.5px',textShadow:'0 1px 2px rgba(0,0,0,0.15)',border:'1px solid rgba(255,255,255,0.3)',backgroundColor:'#2fb344',color:'#fff'}}>Cerrado</span> : getEstadoBadge(inc.estado)}{getGravedadBadge(inc.gravedad)}</div>
                    {(inc.imagesCount > 0 || inc.videosCount > 0) && (
                      <div style={{position:'absolute',bottom:'8px',right:'8px',background:'rgba(0,0,0,0.6)',color:'#fff',padding:'3px 8px',borderRadius:'12px',fontSize:'11px',display:'flex',alignItems:'center',gap:'6px'}}>
                        {inc.imagesCount > 0 && <span><FaImage size={10}/> {inc.imagesCount}</span>}
                        {inc.videosCount > 0 && <span><FaVideo size={10}/> {inc.videosCount}</span>}
                      </div>
                    )}
                  </div>
                  <div className="tbl-card-body">
                    <div style={{ fontSize:'10px', fontWeight:700, color:'#1463A5', background:'#eff6ff', border:'1px solid #bfdbfe', borderRadius:'4px', padding:'2px 8px', display:'inline-block', marginBottom:'6px', letterSpacing:'0.3px' }}>{inc.codigoIncidente}</div>
                    <h3 className="tbl-card-title" title={inc.tipo} style={{ fontSize:'0.95rem', lineHeight:'1.3', display:'-webkit-box', WebkitLineClamp:2, WebkitBoxOrient:'vertical', overflow:'hidden', minHeight:'2.6em' }}>{inc.tipo}</h3>
                    <div className="tbl-text-muted tbl-mb-2"><FaMapMarkerAlt className="tbl-icon tbl-text-blue" /><strong>{inc.codigo}</strong><br/><span style={{paddingLeft: '20px', fontSize: '0.85rem'}}>{inc.lugar}</span></div>
                    <div className="tbl-text-muted"><FaCalendarAlt className="tbl-icon" /> {inc.fecha}</div>
                  </div>
                  <div className="tbl-card-footer">
                    <div className="tbl-media-icons">{inc.imagesCount > 0 && <span title="Fotos"><FaImage /> {inc.imagesCount}</span>}{inc.videosCount > 0 && <span title="Videos"><FaVideo /> {inc.videosCount}</span>}</div>
                    <div className="tbl-avatar-group" title={`Registrado por ${inc.usuario}`}>
                      <FaUser style={{ fontSize: '11px', color: '#64748b', marginRight: '5px' }} />
                      <span className="tbl-avatar-text">{inc.usuario}</span>
                    </div>
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
      {/* ── MODAL PRINCIPAL (GESTIÓN) — solo cierra con botón Cerrar ─────── */}
      {modalAbierto && incidenteActivo && (
        <div className="tbl-modal-backdrop">
          <div className="tbl-modal-dialog" onClick={e => e.stopPropagation()} style={{maxWidth: '960px'}}>
            <div className="tbl-modal-content">
              <div className="tbl-modal-header">
                <h5 className="tbl-modal-title">Gestión · {incidenteActivo.codigoIncidente}</h5>
                <button className="tbl-btn-close" onClick={() => setModalAbierto(false)}><FaTimes/></button>
              </div>
              <div className="tbl-modal-body">
                <div className="tbl-alert tbl-alert-info">
                  <div style={{ fontSize:'11px', fontWeight:700, color:'#1463A5', marginBottom:'4px', letterSpacing:'0.3px' }}>{incidenteActivo.codigoIncidente}</div>
                  <h4 className="tbl-alert-title">{incidenteActivo.tipo} en {incidenteActivo.codigo}</h4>
                  <div className="tbl-text-muted">{incidenteActivo.lugar}</div>
                </div>
                {/* La tabla agrupada va aquí abajo (sin formulario inline) */}

                <div className="tbl-table-responsive tbl-border-top">
                  <table className="tbl-table tbl-table-vcenter">
                    <thead><tr><th style={{width:'24px'}}></th><th>Detalle</th><th className="tbl-text-end">Cantidad</th><th className="tbl-text-end">P. Unit.</th><th className="tbl-text-end">Total</th><th></th></tr></thead>
                    <tbody>
                      {CATEGORIAS.map(cat => {
                          const filas = recursosAgrupados.filter(r => r.tipo === cat.key);
                          const bloqueado = incidentesCerrados.includes(incidenteActivo?.id);
                          return (
                            <Fragment key={cat.key}>
                              {/* Cabecera de categoría con botón Añadir */}
                              <tr style={{ background:'#eef2f7' }}>
                                <td colSpan="5" style={{ padding:'7px 10px' }}>
                                  <span style={{ fontWeight:700, fontSize:'11px', letterSpacing:'0.6px', color:'#334155' }}>{cat.titulo}</span>
                                </td>
                                <td style={{ background:'#eef2f7', textAlign:'right', paddingRight:'10px' }}>
                                  {!incidentesCerrados.includes(incidenteActivo?.id) && (
                                    <button type="button" onClick={() => abrirFormAñadir(cat.key)} title={`Añadir a ${cat.titulo}`}
                                      style={{ display:'inline-flex', alignItems:'center', gap:'4px', background:'#206bc4', color:'#fff', border:'none', borderRadius:'5px', padding:'4px 10px', fontSize:'11px', fontWeight:600, cursor:'pointer', whiteSpace:'nowrap' }}>
                                      <FaPlus size={10} /> Añadir
                                    </button>
                                  )}
                                </td>
                              </tr>
                              {filas.length === 0 && (
                                <tr><td colSpan="6" style={{ padding:'10px 14px', fontSize:'11px', color:'#94a3b8', fontStyle:'italic' }}>Sin registros — usa "Añadir" para agregar.</td></tr>
                              )}
                              {filas.map(r => (
                                (r.tipo === 'Insumo' || r.tipo === 'Personal') && r.count > 1 ? (
                                  // ── Grupo con desglose inline (insumo o personal) ──
                                  <Fragment key={r.idLocal}>
                                    <tr style={{ background:'#fafbfc' }}>
                                      <td></td>
                                      <td style={{fontSize:'12px', fontWeight:700, color:'#1e293b'}}>
                                        {r.tipo === 'Personal' && (
                                          <span style={{marginRight:'6px', fontSize:'9px', fontWeight:700, padding:'2px 6px', borderRadius:'4px', backgroundColor: r.origen === 'EXTERNA' ? '#fef3c7' : '#e0f2fe', color: r.origen === 'EXTERNA' ? '#b45309' : '#0284c7'}}>{r.origen === 'EXTERNA' ? 'EXTERNA' : 'JURP'}</span>
                                        )}
                                        {r.tipo === 'Personal' ? '👷' : '📦'} {(r.descripcion || r.descripcionResumen || '').split('\n')[0].toUpperCase()}
                                        <span style={{marginLeft:'6px', backgroundColor:'#e0f2fe', color:'#0284c7', fontWeight:'bold', fontSize:'10px', padding:'1px 6px', borderRadius:'10px'}}>×{r.count}</span>
                                      </td>
                                      <td></td><td></td><td></td>
                                      <td></td>
                                    </tr>
                                    {r.entradas.map((e, idx) => (
                                      <tr key={e.idLocal || idx} style={{ fontSize:'12px' }}>
                                        <td></td>
                                        <td style={{ paddingLeft:'28px', color:'#64748b' }}>
                                          {r.tipo === 'Personal'
                                            ? `${e.numPersonas} pers × ${e.horasTrabajo}h${parseFloat(e.horasExtras) > 0 ? ` + ${e.horasExtras}h ext` : ''}`
                                            : `Entrada ${idx + 1}`}
                                        </td>
                                        <td className="tbl-text-end">{e.cantidad.toLocaleString('es-PE', {minimumFractionDigits: r.tipo==='Personal'?1:2, maximumFractionDigits: r.tipo==='Personal'?1:2})} <span style={{fontSize:'10px', color:'#94a3b8'}}>{r.tipo === 'Personal' ? 'HH' : e.unidad}</span></td>
                                        <td className="tbl-text-end">S/ {fmtNum(e.precioUnitario)}</td>
                                        <td className="tbl-text-end" style={{ color:'#475569' }}>S/ {fmtNum(e.total)}</td>
                                        <td>
                                          {!bloqueado && (
                                            <button type="button" onClick={() => (e.guardadoEnDB && e.dbId) ? eliminarEntradaInsumo(e) : eliminarRecursosLocales([e.idLocal])} className="tbl-btn-action text-danger" title="Eliminar esta entrada" style={{padding:'4px 8px', backgroundColor:'#fee2e2', borderRadius:'4px', border:'none', cursor:'pointer', display:'inline-flex'}}><FaTrash size={13} /></button>
                                          )}
                                        </td>
                                      </tr>
                                    ))}
                                    <tr style={{ background:'#f1f5f9', borderBottom:'2px solid #e2e8f0' }}>
                                      <td></td>
                                      <td style={{ fontSize:'11px', fontWeight:700, color:'#334155', textAlign:'right' }}>Total {(r.descripcion || r.descripcionResumen || '').split('\n')[0]}</td>
                                      <td className="tbl-text-end" style={{ fontWeight:700, color:'#334155' }}>{r.cantidadTotal.toLocaleString('es-PE', {minimumFractionDigits: r.tipo==='Personal'?1:2, maximumFractionDigits: r.tipo==='Personal'?1:2})} <span style={{fontSize:'10px', color:'#626976'}}>{r.tipo === 'Personal' ? 'HH' : (r.unidad||'und')}</span></td>
                                      <td></td>
                                      <td className="tbl-text-end text-blue" style={{ fontWeight:700 }}>S/ {fmtNum(r.totalSum)}</td>
                                      <td></td>
                                    </tr>
                                  </Fragment>
                                ) : (
                                <tr key={r.idLocal}>
                                  <td></td>
                                  <td style={{fontSize: '12px', whiteSpace: 'pre-wrap', maxWidth: '400px', lineHeight: '1.4'}}>
                                    {r.tipo === 'Personal' && (
                                      <span style={{marginRight:'6px', fontSize:'9px', fontWeight:700, padding:'2px 6px', borderRadius:'4px', backgroundColor: r.origen === 'EXTERNA' ? '#fef3c7' : '#e0f2fe', color: r.origen === 'EXTERNA' ? '#b45309' : '#0284c7'}}>{r.origen === 'EXTERNA' ? 'EXTERNA' : 'JURP'}</span>
                                    )}
                                    {r.tipo === 'Personal' && r.count > 1
                                      ? (r.descripcion ? `${r.descripcion} (Cuadrilla: ${r.numPersonas} persona(s) x ${r.horasTrabajo}h normales + ${r.horasExtras}h extras)` : (r.descripcionResumen || ''))
                                      : (r.descripcionResumen || r.descripcion)}
                                    {r.count > 1 && <span style={{marginLeft:'6px', backgroundColor:'#e0f2fe', color:'#0284c7', fontWeight:'bold', fontSize:'10px', padding:'1px 6px', borderRadius:'10px'}}>×{r.count}</span>}
                                  </td>
                                  <td className="tbl-text-end font-bold">{r.cantidadTotal.toLocaleString('es-PE', {minimumFractionDigits: r.tipo==='Personal'?1:2, maximumFractionDigits: r.tipo==='Personal'?1:2})} <span style={{fontSize: '10px', marginLeft: '4px', color: '#626976'}}>{r.tipo === 'Personal' ? 'HH' : r.tipo === 'Maquinaria' ? 'HE' : (r.unidad||'und')}</span></td>
                                  <td className="tbl-text-end">S/ {fmtNum(r.tipo === 'Insumo' && r.cantidadTotal > 0 ? (r.totalSum / r.cantidadTotal) : r.precioUnitario)}</td>
                                  <td className="tbl-text-end text-blue font-bold">S/ {fmtNum(r.totalSum)}</td>
                                  <td>
                                    {r.tipo === 'Maquinaria' ? (
                                      // ── Fila de MÁQUINA (borrador y/o con partes) ──
                                      <div style={{display:'flex', gap:'6px', alignItems:'center', flexWrap:'wrap'}}>
                                        {r.count === 0 ? (
                                          <span className="tbl-badge" style={{backgroundColor:'#fef3c7', color:'#b45309', fontWeight:600}}>Sin partes</span>
                                        ) : (() => {
                                          const cerrados = r.partesMaq.filter(p => p.cerrado).length;
                                          const activos = r.count - cerrados;
                                          return <span className="tbl-badge" style={{backgroundColor:'#e0f2fe', color:'#0284c7', fontWeight:600}}>{activos > 0 ? `${activos} activo${activos>1?'s':''}` : ''}{activos > 0 && cerrados > 0 ? ' · ' : ''}{cerrados > 0 ? `${cerrados} cerrado${cerrados>1?'s':''}` : ''}</span>;
                                        })()}

                                        {/* + Parte Diario — deshabilitado si hay parte abierto u oculto si cerrada */}
                                        {!bloqueado && (
                                          <button type="button" disabled={r.tieneParteAbierto}
                                            onClick={() => !r.tieneParteAbierto && agregarParteAMaquina(r)}
                                            title={r.tieneParteAbierto ? 'Finaliza el parte abierto para agregar otro' : 'Agregar un parte diario a esta máquina'}
                                            style={{padding:'4px 10px', backgroundColor: r.tieneParteAbierto ? '#f1f5f9' : '#dbeafe', color: r.tieneParteAbierto ? '#94a3b8' : '#1463A5', borderRadius:'4px', border:'none', cursor: r.tieneParteAbierto ? 'not-allowed' : 'pointer', display:'inline-flex', alignItems:'center', gap:'5px', fontSize:'12px', fontWeight:600}}>
                                            <FaPlus size={10} /> Parte Diario
                                          </button>
                                        )}

                                        {/* Todo se gestiona desde "Ver partes" */}
                                        <button type="button" onClick={() => setModalPartes(r)} title={`Ver y gestionar los ${r.count} parte(s)`} style={{padding:'4px 10px', backgroundColor:'#e0f2fe', color:'#0284c7', borderRadius:'4px', border:'none', cursor:'pointer', display:'inline-flex', alignItems:'center', gap:'5px', fontSize:'12px', fontWeight:600}}><FaListUl size={11} /> Ver partes ({r.count})</button>

                                        {/* Quitar la máquina (oculto si cerrada) */}
                                        {!bloqueado && (
                                          <button type="button" onClick={() => quitarMaquina(r)} title="Quitar esta máquina y sus partes" style={{padding:'4px 8px', backgroundColor:'#fee2e2', borderRadius:'4px', border:'none', cursor:'pointer', display:'inline-flex'}}><FaTrash size={14} /></button>
                                        )}
                                      </div>
                                    ) : (r.guardadoEnDB || (r.registros && r.registros.length > 0)) ? (
                                      <div style={{display: 'flex', gap: '6px', alignItems: 'center', flexWrap:'wrap'}}>
                                        <span className="tbl-badge bg-green-lt">Guardado{r.count > 1 ? ` (${r.count})` : ''}</span>
                                        {!bloqueado && (
                                          <button type="button" onClick={() => eliminarRecursoGuardado(r)} className="tbl-btn-action text-danger" title={r.count > 1 ? `Eliminar los ${r.count} registros` : 'Eliminar de la base'} style={{padding: '4px 8px', backgroundColor: '#fee2e2', borderRadius: '4px', border: 'none', cursor: 'pointer', display: 'inline-flex'}}><FaTrash size={14} /></button>
                                        )}
                                      </div>
                                    ) : (bloqueado ? null : <button className="tbl-btn-action text-danger" onClick={() => eliminarRecursosLocales(r.idsLocales)} title="Eliminar"><FaTimes/></button>)}
                                  </td>
                                </tr>
                                )
                              ))}
                              {/* Subtotal de la categoría (solo si hay filas) */}
                              {filas.length > 0 && (
                                <tr>
                                  <td colSpan="4" className="tbl-text-end" style={{ fontSize:'11px', color:'#64748b', fontWeight:600, paddingRight:'10px' }}>Subtotal {cat.titulo}</td>
                                  <td className="tbl-text-end" style={{ fontSize:'12px', fontWeight:700, color:'#334155' }}>S/ {fmtNum(subtotalCategoria(cat.key))}</td>
                                  <td></td>
                                </tr>
                              )}
                            </Fragment>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="tbl-modal-footer" style={{flexWrap:'wrap',gap:'8px'}}>
                <div className="tbl-text-start tbl-text-muted">Costo Total: <span style={{fontSize: '1.25rem', color: '#1e293b', fontWeight: 'bold'}}>S/ {fmtNum(costoTotalIncidente)}</span></div>
                <div style={{display:'flex',gap:'8px',alignItems:'center',flexWrap:'wrap'}}>
                  {/* Resumen: PDF / Excel (con borde) */}
                  <div style={{display:'flex',alignItems:'center',gap:'8px',border:'1px solid #cbd5e1',borderRadius:'6px',padding:'4px 10px',background:'#f8fafc'}}>
                    <span style={{fontSize:'12px',color:'#64748b',fontWeight:600}}>Resumen:</span>
                    <button className="tbl-btn" onClick={exportarPDF} style={{background:'#d63939',color:'#fff',border:'none',padding:'5px 12px',borderRadius:'4px',cursor:'pointer',fontSize:'13px',display:'flex',alignItems:'center',gap:'6px'}} title="Descargar PDF"><FaFilePdf/> PDF</button>
                    <button className="tbl-btn" onClick={exportarExcel} style={{background:'#2fb344',color:'#fff',border:'none',padding:'5px 12px',borderRadius:'4px',cursor:'pointer',fontSize:'13px',display:'flex',alignItems:'center',gap:'6px'}} title="Descargar Excel"><FaFileExcel/> Excel</button>
                  </div>

                  {/* Guardar Costeos */}
                  {!incidentesCerrados.includes(incidenteActivo?.id) && (
                    <button className="tbl-btn tbl-btn-primary" onClick={guardarCosteos} disabled={guardando}>{guardando ? <><FaSyncAlt className="icon-spin" style={{marginRight: '8px'}} /> Guardando...</> : <><FaSave style={{marginRight: '8px'}} /> Guardar Costeos</>}</button>
                  )}

                  {/* Cerrar incidencia / Reabrir */}
                  {incidentesCerrados.includes(incidenteActivo?.id) ? (
                    <>
                      <span style={{background:'#dcfce7',color:'#15803d',padding:'6px 14px',borderRadius:'4px',fontSize:'13px',fontWeight:'600',display:'flex',alignItems:'center',gap:'6px'}}><FaCheckCircle/> Incidencia cerrada</span>
                      <button className="tbl-btn" onClick={reabrirIncidencia} style={{background:'#fff',color:'#206bc4',border:'1px solid #206bc4',padding:'6px 14px',borderRadius:'4px',cursor:'pointer',fontSize:'13px',display:'flex',alignItems:'center',gap:'6px'}} title="Reabrir para volver a editar"><FaSyncAlt/> Reabrir</button>
                    </>
                  ) : (
                    <button className="tbl-btn" onClick={cerrarIncidenteCompleto} style={{background:'#2fb344',color:'#fff',border:'none',padding:'6px 14px',borderRadius:'4px',cursor:'pointer',fontSize:'13px',display:'flex',alignItems:'center',gap:'6px'}} title="Cierra los partes, libera las máquinas y bloquea el costeo"><FaCheckCircle/> Cerrar incidencia</button>
                  )}

                  {/* Cerrar (última) */}
                  <button className="tbl-btn tbl-btn-link" onClick={() => setModalAbierto(false)}>Cerrar</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* ── Modal PASO 1: Selector de máquina ───────────────────────────── */}
      {selectorMaquina && (
        <div className="tbl-modal-backdrop" style={{ zIndex: 10001 }}>
          <div className="tbl-modal-dialog" onClick={e => e.stopPropagation()} style={{ maxWidth: '620px' }}>
            <div className="tbl-modal-content">
              <div className="tbl-modal-header">
                <h5 className="tbl-modal-title">🚜 Seleccionar máquina</h5>
                <button className="tbl-btn-close" onClick={() => setSelectorMaquina(false)}><FaTimes/></button>
              </div>
              <div className="tbl-modal-body">
                <div style={{ position:'relative', marginBottom:'12px' }}>
                  <FaSearch size={12} style={{ position:'absolute', left:'12px', top:'50%', transform:'translateY(-50%)', color:'#94a3b8' }} />
                  <input type="text" className="tbl-form-control" placeholder="Buscar por código, equipo, marca, modelo o placa..." value={buscarMaquina} onChange={e => setBuscarMaquina(e.target.value)} style={{ paddingLeft:'34px' }} autoFocus />
                </div>
                <div style={{ maxHeight:'50vh', overflowY:'auto', display:'flex', flexDirection:'column', gap:'6px' }}>
                  {(() => {
                    const q = buscarMaquina.toLowerCase().trim();
                    const lista = todosModelos.filter(m => {
                      if (!q) return true;
                      const t = `${m.codigo} ${m.equipo_nombre} ${m.marca_nombre} ${m.modelo} ${m.placa || ''}`.toLowerCase();
                      return t.includes(q);
                    });
                    if (todosModelos.length === 0) return <div style={{ textAlign:'center', padding:'30px', color:'#94a3b8', fontSize:'13px' }}>Cargando catálogo de máquinas…</div>;
                    if (lista.length === 0) return <div style={{ textAlign:'center', padding:'30px', color:'#94a3b8', fontSize:'13px' }}>Ninguna máquina coincide con "{buscarMaquina}".</div>;
                    return lista.map(m => (
                      <div key={m.id} onClick={() => seleccionarMaquina(m)}
                        style={{ display:'flex', alignItems:'center', gap:'10px', padding:'10px 12px', border:'1px solid #e2e8f0', borderRadius:'8px', cursor: (m.en_mantenimiento || !m.disponible) ? 'not-allowed' : 'pointer', opacity: (m.en_mantenimiento || !m.disponible) ? 0.6 : 1, transition:'all 0.12s' }}
                        onMouseEnter={e => { if (!m.en_mantenimiento && m.disponible) { e.currentTarget.style.background='#eff6ff'; e.currentTarget.style.borderColor='#bfdbfe'; } }}
                        onMouseLeave={e => { e.currentTarget.style.background='#fff'; e.currentTarget.style.borderColor='#e2e8f0'; }}>
                        <FaTruck color="#475569" />
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ fontWeight:700, fontSize:'13px', color:'#1e293b' }}>
                            <span style={{ color: m.origen === 'JURP' ? '#206bc4' : '#d6832b' }}>{m.codigo}</span> · {m.equipo_nombre} {m.marca_nombre}
                          </div>
                          <div style={{ fontSize:'11px', color:'#64748b', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                            {m.modelo}{m.placa ? ` · Placa ${m.placa}` : ''}
                          </div>
                        </div>
                        <span style={{ fontSize:'11px', fontWeight:600, whiteSpace:'nowrap',
                          color: m.en_mantenimiento ? '#d97706' : (m.disponible ? '#16a34a' : '#dc2626') }}>
                          {m.en_mantenimiento ? '🔧 En mantenim.' : (m.disponible ? '● Disponible' : '● Ocupada')}
                        </span>
                        <FaChevronRight size={12} color="#cbd5e1" />
                      </div>
                    ));
                  })()}
                </div>
              </div>
              <div className="tbl-modal-footer" style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                <button type="button" onClick={() => setMantenedorAbierto(true)} style={{ background:'none', border:'none', color:'#206bc4', cursor:'pointer', fontSize:'12px', fontWeight:600, display:'flex', alignItems:'center', gap:'5px' }}>
                  <FaPlus size={11} /> ¿No está? Gestionar catálogo
                </button>
                <button className="tbl-btn tbl-btn-link" onClick={() => setSelectorMaquina(false)}>Cancelar</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Añadir recurso (Mano de obra / Equipo / Insumo) ──────── */}
      {formTipo && (
        <div className="tbl-modal-backdrop" style={{ zIndex: 10001 }}>
          <div className="tbl-modal-dialog" onClick={e => e.stopPropagation()} style={{ maxWidth: formTipo === 'Maquinaria' ? '900px' : '760px' }}>
            <div className="tbl-modal-content">
              <div className="tbl-modal-header">
                <h5 className="tbl-modal-title">
                  {formTipo === 'Personal' ? '👷 Añadir Mano de Obra' : formTipo === 'Maquinaria' ? '🚜 Parte Diario de Maquinaria' : '📦 Añadir Insumo / Material'}
                </h5>
                <button className="tbl-btn-close" onClick={() => setFormTipo(null)}><FaTimes/></button>
              </div>
              <div className="tbl-modal-body">
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
                      <div className="tbl-col"><label className="tbl-form-label">Proveedor <span style={{color:'red'}}>*</span></label><input type="text" className="tbl-form-control" placeholder="Nombre de empresa" value={nuevoRecurso.proveedor} onChange={e => setNuevoRecurso({...nuevoRecurso, proveedor: e.target.value})} /></div>
                      <div className="tbl-col"><label className="tbl-form-label">Operador</label><input type="text" className="tbl-form-control" placeholder="Nombre del operador" value={nuevoRecurso.operador} onChange={e => setNuevoRecurso({...nuevoRecurso, operador: e.target.value})} /></div>
                    </div>
                    <div className="tbl-row tbl-mb-3">
                      <div className="tbl-col-4"><label className="tbl-form-label">Licencia</label><input type="text" className="tbl-form-control" placeholder="N° de licencia" value={nuevoRecurso.licencia} onChange={e => setNuevoRecurso({...nuevoRecurso, licencia: e.target.value})} /></div>
                      <div className="tbl-col-4"><label className="tbl-form-label">Categoría</label><input type="text" className="tbl-form-control" placeholder="Ej. A-IIIb" value={nuevoRecurso.categoria} onChange={e => setNuevoRecurso({...nuevoRecurso, categoria: e.target.value})} /></div>
                    </div>
                    <div style={{ background:'#eff6ff', border:'1px solid #bfdbfe', borderRadius:'6px', padding:'12px 14px', marginBottom:'15px', display:'flex', alignItems:'center', gap:'10px' }}>
                      <FaTruck size={20} color="#1463A5" />
                      <div style={{ flex:1 }}>
                        <div style={{ fontSize:'10px', color:'#64748b', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.4px' }}>Máquina seleccionada</div>
                        <div style={{ fontSize:'14px', fontWeight:700, color:'#1e293b' }}>
                          {nuevoRecurso.codigoMaquina} · {nuevoRecurso.equipo} {nuevoRecurso.marca} {nuevoRecurso.modeloMaquina}{nuevoRecurso.placa ? ` · ${nuevoRecurso.placa}` : ''}
                        </div>
                      </div>
                      <button type="button" onClick={() => { setFormTipo(null); cargarTodosModelos(); setBuscarMaquina(''); setSelectorMaquina(true); }}
                        style={{ background:'#fff', border:'1px solid #cbd5e1', color:'#206bc4', borderRadius:'6px', padding:'5px 12px', fontSize:'12px', fontWeight:600, cursor:'pointer', whiteSpace:'nowrap' }}>
                        Cambiar máquina
                      </button>
                    </div>
                    <div className="tbl-row tbl-mb-3">
                      <div className="tbl-col-3"><label className="tbl-form-label">Precio Unit. (S/ HE)</label><input type="number" className="tbl-form-control" value={nuevoRecurso.precioUnitario} onChange={e => setNuevoRecurso({...nuevoRecurso, precioUnitario: e.target.value})} /></div>
                    </div>
                    <div className="tbl-row tbl-mb-3">
                      <div className="tbl-col"><label className="tbl-form-label">HM Inicio <span style={{color:'red'}}>*</span> {parseFloat(nuevoRecurso.hmInicio) > 0 && <span style={{color:'#0284c7', fontSize:'10px', fontWeight:600}}>· viene del parte anterior</span>}</label><input type="number" step="0.1" className="tbl-form-control" value={nuevoRecurso.hmInicio} onChange={e => setNuevoRecurso({...nuevoRecurso, hmInicio: e.target.value})} /></div>
                      <div className="tbl-col"><label className="tbl-form-label">HM Fin <span style={{color:'red'}}>*</span></label><input type="number" step="0.1" className="tbl-form-control" value={nuevoRecurso.hmFin} onChange={e => setNuevoRecurso({...nuevoRecurso, hmFin: e.target.value})} /></div>
                      <div className="tbl-col-auto" style={{display: 'flex', flexDirection: 'column', justifyContent: 'flex-end'}}><div style={{background: '#e0f2fe', color: '#0284c7', padding: '8px 12px', borderRadius: '4px', fontWeight: 'bold', fontSize: '13px', border: '1px solid #bae6fd'}}>Horas: {horasMaquina} h</div></div>
                      <div className="tbl-col"><label className="tbl-form-label">Combustible (Gls)</label><input type="number" className="tbl-form-control" value={nuevoRecurso.combustible} onChange={e => setNuevoRecurso({...nuevoRecurso, combustible: e.target.value})} /></div>
                      <div className="tbl-col"><label className="tbl-form-label">Vale N°</label><input type="text" className="tbl-form-control" value={nuevoRecurso.vale} onChange={e => setNuevoRecurso({...nuevoRecurso, vale: e.target.value})} /></div>
                    </div>
                    {(() => {
                      const totalHM = parseFloat(horasMaquina) || 0;
                      const efectivas = nuevoRecurso.horasEfectivas === '' ? totalHM : parseFloat(nuevoRecurso.horasEfectivas)||0;
                      const hayReduccion = efectivas < totalHM;
                      return (
                        <div className="tbl-row tbl-mb-3">
                          <div className="tbl-col-3">
                            <label className="tbl-form-label">Horas Efectivas (HE)</label>
                            <input type="number" min="0" max={totalHM} step="0.1" className="tbl-form-control"
                              placeholder={String(totalHM)}
                              value={nuevoRecurso.horasEfectivas}
                              onChange={e => setNuevoRecurso({...nuevoRecurso, horasEfectivas: e.target.value})}
                              style={hayReduccion ? {borderColor:'#f59e0b', backgroundColor:'#fffbeb', fontWeight:'bold'} : {fontWeight:'bold'}}
                              title="Por defecto = horas del horómetro. Edítalo si fueron menos." />
                          </div>
                          <div className="tbl-col">
                            <label className="tbl-form-label">
                              Observación {hayReduccion ? <span style={{color:'#d97706',fontSize:'11px',fontWeight:600}}>· requerida (reducción de {(totalHM - efectivas).toFixed(1)} HE)</span> : <span style={{color:'#94a3b8',fontSize:'11px'}}>· opcional</span>}
                            </label>
                            <input type="text" className="tbl-form-control"
                              placeholder={hayReduccion ? 'Detalla el motivo de la reducción de horas...' : 'Sin observaciones de reducción'}
                              value={nuevoRecurso.obsReduccion}
                              onChange={e => setNuevoRecurso({...nuevoRecurso, obsReduccion: e.target.value})}
                              style={hayReduccion && !nuevoRecurso.obsReduccion.trim() ? {borderColor:'#f59e0b', backgroundColor:'#fffbeb'} : {}} />
                          </div>
                        </div>
                      );
                    })()}
                    <div className="tbl-row tbl-mb-3">
                      <div className="tbl-col"><label className="tbl-form-label">Actividades Realizadas <span style={{color:'red'}}>*</span></label>
                        <select className="tbl-form-select" value={nuevoRecurso.actividad} onChange={e => setNuevoRecurso({...nuevoRecurso, actividad: e.target.value})}>
                          <option value="">— Seleccionar actividad —</option>
                          <option value="EXCAVACION DE MATERIAL">EXCAVACIÓN DE MATERIAL</option>
                          <option value="CARGUIO DE MATERIAL">CARGUÍO DE MATERIAL</option>
                          <option value="DESCOLMATACION DE CAUCE">DESCOLMATACIÓN DE CAUCE</option>
                          <option value="ELIMINACION">ELIMINACIÓN DE MATERIAL</option>
                          <option value="CONFORMACION DE DIQUE">CONFORMACIÓN DE DIQUE</option>
                          <option value="ENROCADO">ENROCADO</option>
                          <option value="PERFILADO DE TALUD">PERFILADO DE TALUD</option>
                          <option value="HABILITACION DE ACCESO">HABILITACIÓN DE ACCESO</option>
                        </select>
                      </div>
                      <div className="tbl-col"><label className="tbl-form-label">Observaciones</label><input type="text" className="tbl-form-control" placeholder="Condiciones del terreno, clima..." value={nuevoRecurso.observaciones} onChange={e => setNuevoRecurso({...nuevoRecurso, observaciones: e.target.value})} /></div>
                    </div>
                    {/* ── Metrado por actividad (con imagen de referencia) ────── */}
                    {/* ── Metrado por actividad (con imagen de referencia) ────── */}
                    {tieneMetradoActividad && (
                      <div style={{ background:'#f0f6ff', padding:'14px', borderRadius:'4px', border:'1px solid #bfdbfe', marginTop:'4px' }}>
                        <div style={{ display:'flex', gap:'14px', alignItems:'flex-start' }}>
                          <div style={{ flexShrink:0, width:'160px' }}>
                            <div style={{ fontSize:'12px', fontWeight:'700', color:'#1463A5', marginBottom:'6px' }}>📐 Referencia</div>
                            <img src={IMG_METRADO[nuevoRecurso.actividad]} alt={nuevoRecurso.actividad} onClick={() => setImgRefModal({src: IMG_METRADO[nuevoRecurso.actividad], titulo: nuevoRecurso.actividad})} style={{ width:'100%', borderRadius:'4px', border:'1px solid #bfdbfe', cursor:'pointer' }} title="Clic para ampliar" />
                          </div>
                          <div style={{ flex:1 }}>
                            <div style={{ fontSize:'12px', fontWeight:'700', color:'#1463A5', marginBottom:'10px' }}>{nuevoRecurso.actividad}</div>
                            <div className="tbl-row tbl-mb-2" style={{ gap:'8px' }}>{renderCamposMetrado()}</div>
                          </div>
                        </div>
                        <div style={{ marginTop:'8px', padding:'8px 12px', background:'#fff', borderRadius:'4px', border:'1px solid #bfdbfe', display:'flex', justifyContent:'space-between', alignItems:'center', gap:'10px' }}>
                          {nuevoRecurso.calcularMetrado ? (
                            <>
                              <span style={{ fontSize:'11px', color:'#626976' }}>{formulaMetrado[nuevoRecurso.actividad]}</span>
                              <span style={{ fontSize:'16px', fontWeight:'700', color: volCalc.val > 0 ? '#1463A5' : '#94a3b8' }}>{fmtNum(volumenMetrado)} {volCalc.unit}</span>
                            </>
                          ) : (
                            <>
                              <span style={{ fontSize:'11px', color:'#626976', whiteSpace:'nowrap' }}>Metrado (ingreso manual)</span>
                              <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
                                <input type="number" step="0.01" className="tbl-form-control" placeholder="0.00"
                                  value={nuevoRecurso.metradoManual}
                                  onChange={e => setNuevoRecurso({ ...nuevoRecurso, metradoManual: e.target.value })}
                                  style={{ width:'130px', textAlign:'right', fontWeight:700, color:'#1463A5' }} />
                                <select className="tbl-form-select" value={nuevoRecurso.unidadMetrado}
                                  onChange={e => setNuevoRecurso({ ...nuevoRecurso, unidadMetrado: e.target.value })}
                                  style={{ width:'80px' }}>
                                  {UNIDADES_METRADO.map(u => <option key={u} value={u}>{UNIDADES_METRADO_TXT[u]}</option>)}
                                </select>
                              </div>
                            </>
                          )}
                        </div>

                        {/* Check para activar el cálculo por fórmula */}
                        <label style={{ marginTop:'8px', display:'flex', alignItems:'center', gap:'8px', fontSize:'12px', color:'#1463A5', fontWeight:600, cursor:'pointer', userSelect:'none' }}>
                          <input type="checkbox" checked={!!nuevoRecurso.calcularMetrado}
                            onChange={e => setNuevoRecurso({ ...nuevoRecurso, calcularMetrado: e.target.checked })}
                            style={{ width:'15px', height:'15px', cursor:'pointer' }} />
                          Calcular metrado con las medidas de campo
                        </label>
                      </div>
                    )}
                  </div>
                ) : nuevoRecurso.tipo === 'Personal' ? (
                  <>
                  <div className="tbl-row tbl-mb-3">
                    <div className="tbl-col-3">
                      <label className="tbl-form-label">Origen</label>
                      <select className="tbl-form-select" value={nuevoRecurso.origen} onChange={e => setNuevoRecurso({...nuevoRecurso, origen: e.target.value})}>
                        <option value="JURP">JURP (propia)</option>
                        <option value="EXTERNA">Externa</option>
                      </select>
                    </div>
                  </div>
                  <div className="tbl-row tbl-mb-3">
                    <div className="tbl-col-3">
                      <label className="tbl-form-label">Cargo <button type="button" onClick={gestionarCargos} title="Gestionar cargos" style={{ background:'none', border:'none', color:'#206bc4', cursor:'pointer', fontSize:'11px', padding:'0 0 0 4px' }}><FaPlus /> gestionar</button></label>
                      <select className="tbl-form-select" value={nuevoRecurso.descripcion} onChange={e => setNuevoRecurso({...nuevoRecurso, descripcion: e.target.value})}>
                        <option value="">— Seleccionar —</option>
                        {catCargos.map(c => <option key={c.id} value={c.nombre}>{c.nombre}</option>)}
                      </select>
                    </div>
                    <div className="tbl-col-2"><label className="tbl-form-label">N° Personas</label><input type="number" min="1" className="tbl-form-control" value={nuevoRecurso.numPersonas} onChange={e => setNuevoRecurso({...nuevoRecurso, numPersonas: e.target.value})} /></div>
                    <div className="tbl-col-2"><label className="tbl-form-label">H. Normales</label><input type="number" min="0" className="tbl-form-control" value={nuevoRecurso.horasTrabajo} onChange={e => setNuevoRecurso({...nuevoRecurso, horasTrabajo: e.target.value})} /></div>
                    <div className="tbl-col-2"><label className="tbl-form-label">H. Extras</label><input type="number" min="0" className="tbl-form-control" value={nuevoRecurso.horasExtras} onChange={e => setNuevoRecurso({...nuevoRecurso, horasExtras: e.target.value})} /></div>
                    <div className="tbl-col-2"><label className="tbl-form-label">S/ por HH</label><input type="number" className="tbl-form-control" value={nuevoRecurso.precioUnitario} onChange={e => setNuevoRecurso({...nuevoRecurso, precioUnitario: e.target.value})} /></div>
                    <div className="tbl-col-1"><label className="tbl-form-label">Total</label><input type="text" className="tbl-form-control" disabled value={((parseInt(nuevoRecurso.numPersonas)||0) * ((parseFloat(nuevoRecurso.horasTrabajo)||0) + (parseFloat(nuevoRecurso.horasExtras)||0))) || 0} style={{backgroundColor: '#e0f2fe', color: '#0284c7', fontWeight: 'bold'}} title="Total HH teóricas" /></div>
                  </div>
                  </>
                ) : (
                  <div className="tbl-row tbl-mb-3">
                    <div className="tbl-col"><label className="tbl-form-label">Descripción del Insumo</label><input type="text" className="tbl-form-control" placeholder="Ej. Piedra chancada, Cemento..." value={nuevoRecurso.descripcion} onChange={e => setNuevoRecurso({...nuevoRecurso, descripcion: e.target.value})} /></div>
                    <div className="tbl-col-2"><label className="tbl-form-label">Cant.</label><input type="number" step="0.01" className="tbl-form-control" value={nuevoRecurso.cantidad} onChange={e => setNuevoRecurso({...nuevoRecurso, cantidad: e.target.value})} /></div>
                    <div className="tbl-col-2">
                      <label className="tbl-form-label">Unidad <button type="button" onClick={gestionarUnidades} title="Gestionar unidades" style={{ background:'none', border:'none', color:'#206bc4', cursor:'pointer', fontSize:'11px', padding:'0 0 0 4px' }}><FaPlus /> gestionar</button></label>
                      <select className="tbl-form-select" value={nuevoRecurso.unidad} onChange={e => setNuevoRecurso({...nuevoRecurso, unidad: e.target.value})}>
                        {catUnidades.map(u => <option key={u} value={u}>{u}</option>)}
                      </select>
                    </div>
                    <div className="tbl-col-2"><label className="tbl-form-label">Precio Unit. (S/)</label><input type="number" className="tbl-form-control" value={nuevoRecurso.precioUnitario} onChange={e => setNuevoRecurso({...nuevoRecurso, precioUnitario: e.target.value})} /></div>
                  </div>
                )}

              </div>
              <div className="tbl-modal-footer" style={{ display:'flex', gap:'8px', justifyContent:'flex-end' }}>
                <button className="tbl-btn tbl-btn-link" onClick={() => setFormTipo(null)}>Cancelar</button>
                <button className="tbl-btn tbl-btn-success" onClick={agregarRecurso}><FaPlus style={{marginRight:'5px'}}/> Agregar a la lista</button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* ── Modal: partes diarios de una máquina ───────────────────────── */}
      {modalPartes && (
        <div onClick={() => setModalPartes(null)} style={{ position:'fixed', inset:0, zIndex:10001, background:'rgba(0,0,0,0.6)', display:'flex', alignItems:'center', justifyContent:'center', padding:'20px' }}>
          <div onClick={e => e.stopPropagation()} style={{ background:'#fff', borderRadius:'10px', overflow:'hidden', maxWidth:'960px', width:'100%', maxHeight:'88vh', display:'flex', flexDirection:'column' }}>
            {/* Header */}
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'16px 22px', background:'#1463A5', color:'#fff' }}>
              <div style={{ display:'flex', alignItems:'center', gap:'12px', minWidth:0 }}>
                <FaTruck size={22} />
                <div style={{ minWidth:0 }}>
                  <h5 style={{ margin:0, fontSize:'17px', fontWeight:700, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{modalPartes.descripcionResumen}</h5>
                  <div style={{ fontSize:'12px', opacity:0.85, marginTop:'2px' }}>Partes diarios de esta máquina</div>
                </div>
              </div>
              <button onClick={() => setModalPartes(null)} style={{ background:'rgba(255,255,255,0.15)', border:'none', cursor:'pointer', color:'#fff', fontSize:'16px', display:'flex', borderRadius:'6px', padding:'8px' }}><FaTimes /></button>
            </div>

            {/* Tabla de partes */}
            <div style={{ overflowY:'auto', padding:'0' }}>
              {modalPartes.partesMaq.length === 0 ? (
                <div style={{ padding:'40px', textAlign:'center', color:'#94a3b8', fontSize:'14px' }}>Esta máquina aún no tiene partes diarios. Usa "+ Parte Diario" para crear el primero.</div>
              ) : (
                <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'13px' }}>
                  <thead>
                    <tr style={{ background:'#f1f5f9', borderBottom:'2px solid #e2e8f0' }}>
                      <th style={{ textAlign:'left', padding:'11px 22px', fontSize:'11px', color:'#475569', letterSpacing:'0.4px' }}>N° PARTE</th>
                      <th style={{ textAlign:'left', padding:'11px 10px', fontSize:'11px', color:'#475569' }}>FECHA</th>
                      <th style={{ textAlign:'left', padding:'11px 10px', fontSize:'11px', color:'#475569' }}>ESTADO</th>
                      <th style={{ textAlign:'left', padding:'11px 10px', fontSize:'11px', color:'#475569' }}>ACTIVIDAD</th>
                      <th style={{ textAlign:'right', padding:'11px 10px', fontSize:'11px', color:'#475569' }}>HORAS</th>
                      <th style={{ textAlign:'right', padding:'11px 10px', fontSize:'11px', color:'#475569' }}>COMBUST.</th>
                      <th style={{ textAlign:'right', padding:'11px 10px', fontSize:'11px', color:'#475569' }}>TOTAL</th>
                      <th style={{ textAlign:'right', padding:'11px 22px', fontSize:'11px', color:'#475569' }}>ACCIONES</th>
                    </tr>
                  </thead>
                  <tbody>
                    {modalPartes.partesMaq.map((p, idx) => {
                      const reg = p.registro || {};
                      const horas = parseFloat(reg.cantidad) || 0;
                      return (
                        <tr key={p.idLocal || idx} style={{ borderBottom:'1px solid #f1f5f9', background: p.cerrado ? '#fff' : '#fffbeb' }}>
                          <td style={{ padding:'12px 22px', fontWeight:700, color:'#1e293b' }}>{p.numeroParte || `#${p.dbId}`}</td>
                          <td style={{ padding:'12px 10px', color:'#475569', whiteSpace:'nowrap' }}>{reg.fechaParte ? (reg.fechaParte.split('T')[0].split('-').reverse().join('/')) : '—'}</td>
                          <td style={{ padding:'12px 10px' }}>
                            <span style={{ fontSize:'10px', fontWeight:700, padding:'3px 9px', borderRadius:'4px', background: p.cerrado ? '#dcfce7' : '#fef3c7', color: p.cerrado ? '#15803d' : '#b45309', whiteSpace:'nowrap' }}>
                              {p.cerrado ? 'CERRADO' : 'ABIERTO'}
                            </span>
                          </td>
                          <td style={{ padding:'12px 10px', color:'#475569', maxWidth:'200px', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }} title={reg.actividad || ''}>{reg.actividad || '—'}</td>
                          <td style={{ padding:'12px 10px', textAlign:'right', fontWeight:600, color:'#334155', whiteSpace:'nowrap' }}>{fmtNum(horas)} HE</td>
                          <td style={{ padding:'12px 10px', textAlign:'right', color:'#334155', whiteSpace:'nowrap' }}>{fmtNum(reg.combustible || 0)} Gls</td>
                          <td style={{ padding:'12px 10px', textAlign:'right', fontWeight:700, color:'#1463A5', whiteSpace:'nowrap' }}>S/ {fmtNum(reg.total || 0)}</td>
                          <td style={{ padding:'12px 22px' }}>
                            <div style={{ display:'flex', gap:'6px', justifyContent:'flex-end', alignItems:'center' }}>
                              {p.dbId && (
                                <button type="button" onClick={() => { setModalPartes(null); abrirModalPdf(p.dbId); }} title="Ver PDF del parte"
                                  style={{ display:'inline-flex', alignItems:'center', gap:'5px', padding:'5px 11px', backgroundColor:'#e0f2fe', color:'#0284c7', borderRadius:'5px', border:'none', cursor:'pointer', fontSize:'12px', fontWeight:600, whiteSpace:'nowrap' }}>
                                  <FaFilePdf size={12} /> Ver PDF
                                </button>
                              )}
                              {!p.cerrado && !incidentesCerrados.includes(incidenteActivo?.id) && (
                                <button type="button" onClick={() => { cerrarParteDiario(p.registro); setModalPartes(null); }} title="Finalizar este parte (libera la máquina)"
                                  style={{ display:'inline-flex', alignItems:'center', gap:'5px', padding:'5px 11px', backgroundColor:'#dcfce7', color:'#15803d', borderRadius:'5px', border:'none', cursor:'pointer', fontSize:'12px', fontWeight:600, whiteSpace:'nowrap' }}>
                                  <FaCheckCircle size={12} /> Finalizar
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  {/* Fila de total */}
                  <tfoot>
                    <tr style={{ background:'#f8fafc', borderTop:'2px solid #e2e8f0' }}>
                      <td colSpan="4" style={{ padding:'14px 22px', fontWeight:700, color:'#334155' }}>
                        TOTAL · {modalPartes.count} parte{modalPartes.count !== 1 ? 's' : ''}
                      </td>
                      <td style={{ padding:'14px 10px', textAlign:'right', fontWeight:700, color:'#334155', whiteSpace:'nowrap' }}>{fmtNum(modalPartes.cantidadTotal)} HE</td>
                      <td style={{ padding:'14px 10px', textAlign:'right', fontWeight:700, color:'#334155', whiteSpace:'nowrap' }}>{fmtNum(modalPartes.partesMaq.reduce((s, p) => s + (parseFloat(p.registro?.combustible) || 0), 0))} Gls</td>
                      <td style={{ padding:'14px 10px', textAlign:'right', fontWeight:800, fontSize:'15px', color:'#1463A5', whiteSpace:'nowrap' }}>S/ {fmtNum(modalPartes.totalSum)}</td>
                      <td style={{ padding:'14px 22px' }}></td>
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>

            {/* Footer */}
            <div style={{ padding:'12px 22px', borderTop:'1px solid #e2e8f0', background:'#f8fafc', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              {incidentesCerrados.includes(incidenteActivo?.id) ? <span style={{fontSize:'12px', color:'#94a3b8', fontStyle:'italic'}}>Incidencia cerrada</span> : (
                <button type="button" disabled={modalPartes.tieneParteAbierto}
                  onClick={() => { if (!modalPartes.tieneParteAbierto) { const g = modalPartes; setModalPartes(null); agregarParteAMaquina(g); } }}
                  title={modalPartes.tieneParteAbierto ? 'Finaliza el parte abierto para agregar otro' : 'Agregar un parte diario'}
                  style={{ display:'inline-flex', alignItems:'center', gap:'6px', padding:'8px 16px', background: modalPartes.tieneParteAbierto ? '#f1f5f9' : '#1463A5', color: modalPartes.tieneParteAbierto ? '#94a3b8' : '#fff', border:'none', borderRadius:'8px', fontSize:'13px', fontWeight:600, cursor: modalPartes.tieneParteAbierto ? 'not-allowed' : 'pointer' }}>
                  <FaPlus size={11} /> Agregar parte diario
                </button>
              )}
              <button onClick={() => setModalPartes(null)} className="tbl-btn tbl-btn-link">Cerrar</button>
            </div>
          </div>
        </div>
      )}
      {/* ── Modal de imagen de referencia (metrado) ────────────────────── */}
      {imgRefModal && (
        <div onClick={() => setImgRefModal(null)} style={{ position:'fixed', inset:0, zIndex:10001, background:'rgba(0,0,0,0.8)', display:'flex', alignItems:'center', justifyContent:'center', padding:'20px' }}>
          <div onClick={e => e.stopPropagation()} style={{ background:'#fff', borderRadius:'10px', overflow:'hidden', maxWidth:'1000px', width:'100%', maxHeight:'90vh', display:'flex', flexDirection:'column' }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'14px 18px', background:'#f8fafc', borderBottom:'1px solid #e2e8f0' }}>
              <h5 style={{ margin:0, fontSize:'15px', color:'#1e293b' }}>{imgRefModal.titulo}</h5>
              <button onClick={() => setImgRefModal(null)} style={{ background:'none', border:'none', cursor:'pointer', color:'#64748b', fontSize:'18px', display:'flex' }}><FaTimes /></button>
            </div>
            <div style={{ padding:'16px', overflow:'auto', textAlign:'center' }}>
              <img src={imgRefModal.src} alt={imgRefModal.titulo} style={{ maxWidth:'100%', height:'auto' }} />
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
          <button onClick={() => setModalMediaAbierto(false)} style={{ position:'absolute',top:'16px',right:'20px',background:'rgba(255,255,255,0.15)',border:'none',color:'#fff',fontSize:'22px',cursor:'pointer',borderRadius:'50%',width:'40px',height:'40px',display:'flex',alignItems:'center',justifyContent:'center',zIndex:10002 }}>✕</button>
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
              <div onClick={e=>e.stopPropagation()} style={{position:'relative',maxWidth:'90vw',maxHeight:'70vh',display:'flex',alignItems:'center',justifyContent:'center'}}>
                {galeriaMedia[galeriaIndex].type === 'image' ? (
                  <img src={galeriaMedia[galeriaIndex].src} alt="Evidencia" style={{maxWidth:'90vw',maxHeight:'70vh',objectFit:'contain',borderRadius:'8px'}} />
                ) : (
                  <video src={galeriaMedia[galeriaIndex].src} controls autoPlay style={{maxWidth:'90vw',maxHeight:'70vh',borderRadius:'8px',background:'#000'}} />
                )}
              </div>
              {galeriaMedia.length > 1 && (
                <div onClick={e=>e.stopPropagation()} style={{display:'flex',alignItems:'center',gap:'16px',marginTop:'16px'}}>
                  <button onClick={galeriaAnterior} disabled={galeriaIndex===0} style={{background:galeriaIndex===0?'rgba(255,255,255,0.1)':'rgba(255,255,255,0.2)',border:'none',color:'#fff',borderRadius:'50%',width:'40px',height:'40px',cursor:galeriaIndex===0?'default':'pointer',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'16px'}}><FaChevronLeft/></button>
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
              <div style={{color:'rgba(255,255,255,0.5)',fontSize:'12px',marginTop:'8px'}}>{galeriaIndex+1} / {galeriaMedia.length} · {galeriaMedia[galeriaIndex].type === 'image' ? 'Foto' : 'Video'}</div>
            </>
          )}
        </div>
      )}
      {/* ── Modal: elegir formato del reporte general ─────────────────── */}
      {modalReporteGlobal && (
        <div onClick={() => !generandoReporte && setModalReporteGlobal(false)}
          style={{ position:'fixed', inset:0, zIndex:10000, background:'rgba(0,0,0,0.6)', display:'flex', alignItems:'center', justifyContent:'center', padding:'16px' }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background:'#fff', borderRadius:'12px', width:'100%', maxWidth:'440px', overflow:'hidden', boxShadow:'0 20px 40px rgba(0,0,0,0.25)' }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'14px 18px', borderBottom:'1px solid #e2e8f0', background:'#f8fafc' }}>
              <h5 style={{ margin:0, fontSize:'16px', color:'#1e293b', display:'flex', alignItems:'center', gap:'8px' }}>
                <FaFileInvoice color="#0ea5e9" /> Reporte General
              </h5>
              <button onClick={() => !generandoReporte && setModalReporteGlobal(false)} disabled={generandoReporte}
                style={{ background:'none', border:'none', cursor:'pointer', color:'#64748b', fontSize:'18px', display:'flex' }}>
                <FaTimes />
              </button>
            </div>
            <div style={{ padding:'20px 18px' }}>
              {conDatosInfo === null ? (
                <p style={{ margin:'0 0 4px', fontSize:'13px', color:'#64748b' }}>
                  <FaSyncAlt className="icon-spin" style={{ marginRight:'6px' }} /> Revisando incidencias…
                </p>
              ) : (
                <p style={{ margin:'0 0 4px', fontSize:'13px', color:'#334155' }}>
                  Se generará un solo archivo con <b>{conDatosInfo.conDatos} incidencia(s) con información</b>,
                  cada una con su detalle de mano de obra, maquinaria y materiales.
                </p>
              )}
              {conDatosInfo && conDatosInfo.total > conDatosInfo.conDatos && (
                <p style={{ margin:'6px 0 4px', fontSize:'12px', color:'#b45309', background:'#fffbeb', border:'1px solid #fde68a', borderRadius:'6px', padding:'8px 10px' }}>
                  Se omitirán {conDatosInfo.total - conDatosInfo.conDatos} incidencia(s) sin recursos costeados.
                </p>
              )}
              {hayFiltros && incidentesFiltrados.length !== incidentes.length && (
                <p style={{ margin:'6px 0 4px', fontSize:'12px', color:'#0369a1', background:'#f0f9ff', border:'1px solid #bae6fd', borderRadius:'6px', padding:'8px 10px' }}>
                  Se aplicarán los filtros activos ({incidentesFiltrados.length} de {incidentes.length}).
                </p>
              )}
              <p style={{ margin:'10px 0 16px', fontSize:'13px', color:'#64748b' }}>Elige el formato:</p>

              {generandoReporte ? (
                <div style={{ textAlign:'center', padding:'24px 0' }}>
                  <FaSyncAlt className="icon-spin" style={{ fontSize:'26px', color:'#0ea5e9' }} />
                  <p style={{ fontSize:'13px', color:'#64748b', marginTop:'10px' }}>Generando reporte…</p>
                </div>
              ) : (
                <div style={{ display:'flex', gap:'12px', opacity: (conDatosInfo && conDatosInfo.conDatos === 0) ? 0.45 : 1, pointerEvents: (conDatosInfo && conDatosInfo.conDatos === 0) ? 'none' : 'auto' }}>
                  <button onClick={() => reporteGlobalPDF(incidentesFiltrados.length ? incidentesFiltrados : incidentes)}
                    style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', gap:'8px', padding:'18px 12px', background:'#fef2f2', color:'#b91c1c', border:'2px solid #fecaca', borderRadius:'10px', cursor:'pointer', fontSize:'14px', fontWeight:700 }}>
                    <FaFilePdf size={26} /> PDF
                  </button>
                  <button onClick={() => reporteGlobalExcel(incidentesFiltrados.length ? incidentesFiltrados : incidentes)}
                    style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', gap:'8px', padding:'18px 12px', background:'#f0fdf4', color:'#15803d', border:'2px solid #bbf7d0', borderRadius:'10px', cursor:'pointer', fontSize:'14px', fontWeight:700 }}>
                    <FaFileExcel size={26} /> Excel
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Mantenedor de catálogos (Equipos/Marcas/Modelos) ─────────────── */}
      <MantenedorEquipos
        abierto={mantenedorAbierto}
        onClose={() => { setMantenedorAbierto(false); cargarEquiposCat(nuevoRecurso.origen); if (nuevoRecurso.equipoId) cargarMarcasCat(nuevoRecurso.equipoId); if (nuevoRecurso.marcaId) cargarModelosCat(nuevoRecurso.marcaId); }}
      />
    </div>
  );
}
// Estilo compartido de los controles de la barra de filtros.
const filtroSelStyle = { padding:'7px 10px', border:'1px solid #cbd5e1', borderRadius:'6px', fontSize:'12px', color:'#334155', background:'#fff', cursor:'pointer', width:'auto', minWidth:'140px' };

export default Incidentes;