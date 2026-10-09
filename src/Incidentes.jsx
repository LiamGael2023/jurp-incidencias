import { useState, useEffect, useRef, Fragment } from 'react';
import { createPortal } from 'react-dom';
import { 
  FaSyncAlt, FaEye, FaMapMarkerAlt, 
  FaCalendarAlt, FaCamera, FaVideo, 
  FaImage, FaChevronLeft, FaChevronRight, FaTimes, FaPlus, FaFileInvoice, FaSave, FaFilePdf, FaFileExcel, FaDownload, FaUser, FaTrash, FaCheckCircle, FaFilter, FaSearch, FaListUl, FaTruck, FaPen
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
import { rutaDe, cuelgaDe, bajarSolo } from './arbolPartidas';
import {
  CATEGORIAS, ESTADOS, IMG_METRADO, STEP4,
  UNIDADES_METRADO, UNIDADES_METRADO_TXT, actividadesDesdeBackend, actividadesParaBackend,
  calcMetradoDe, correlativoMas, detalleMaquinaDeParte, estadoInicialActividad,
  estadoInicialRecurso, fechaCorta, fechaDe, fmtCant,
  fmtNum, formulaMetrado, generarCorrelativo, getFechaHoy,
  hayReduccionEn, heDeActividad, horasCobradas, horasDeActividad,
  horasDeLista,
  muertasDeActividad, muertasDeLista, normalizar, rangoHorometro,
  resumenActividades, resumenReduccion, round2, round4,
  textoActividad, tramoDeLista, txtEstadoInc,
} from './costeo/calculos';
import { imgToBase64 } from './costeo/imagen';
import GestionCosteo from './GestionCosteo';
import VisorImagen from './VisorImagen';
import { API_OPS } from './api';
// ── Imágenes de referencia metrado por actividad ─────────────────────────────

// Los modales se cuelgan del <body>, no del árbol de la página.
//
// Esta pantalla va envuelta en <div className="inc"> con un <div
// className="inc-main"> que lleva z-index, y la barra lateral de la app es un
// flex item con z-index 1002. En flexbox un z-index distinto de 'auto' crea
// contexto de apilamiento AUNQUE el elemento sea estático, así que la barra
// forma el suyo y el z-index 9999 del velo del modal queda encerrado dentro de
// .inc-main: por alto que sea, hacia afuera toda esa caja vale menos que la
// barra, y el menú se dibujaba encima del modal.
//
// Subir el z-index de .inc por encima de 1002 también lo arregla, pero .inc es
// position:fixed con inset:0 y fondo propio: con el modal cerrado taparía el
// menú entero. Comprobado en Chromium con las hojas reales.
//
// Sacarlos al body los deja en el contexto raíz, que es donde debe vivir algo
// que cubre toda la pantalla.
const Portal = ({ children }) => createPortal(children, document.body);


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
  // Catálogo COMPLETO de modelos (sin filtros), solo para resolver el código
  // de máquina de los partes ya guardados (la API no devuelve el código).

  // --- ESTADOS DEL MODAL PRINCIPAL ---
  const [modalAbierto, setModalAbierto] = useState(false);
  const [incidenteActivo, setIncidenteActivo] = useState(null);
  const [modalReporteGlobal, setModalReporteGlobal] = useState(false);
  const [generandoReporte, setGenerandoReporte] = useState(false);
  const [conDatosInfo, setConDatosInfo] = useState(null);  // {conDatos, total} del reporte
  const incidentesFiltradosRef = useRef([]);   // lista filtrada visible (para el reporte)

  // --- ESTADOS DEL MODAL PDF ---
  // Rango para acotar el costeo a un periodo (informe semanal, quincena…).
  // Vacío = todo. Aplica a mano de obra, insumos y partes de maquinaria.
  // Registro que se está editando. Reutiliza el mismo formulario de alta:
  // si está en null se crea, si tiene valor se actualiza ese registro.
  //   { dbId, endpoint, idLocal, guardadoEnDB, tipo }

  // --- ESTADOS DEL MODAL DE EVIDENCIAS (GALERÍA) ---
  const [modalMediaAbierto, setModalMediaAbierto] = useState(false);
  const [galeriaMedia, setGaleriaMedia] = useState([]);
  const [galeriaIndex, setGaleriaIndex] = useState(0);
  const [cargandoMedia, setCargandoMedia] = useState(false);
  const [galeriaIncidente, setGaleriaIncidente] = useState(null);

  // --- BITÁCORA DE ATENCIONES (mismas entradas que registra la app móvil) ---
  const [modalBitacora, setModalBitacora] = useState(null);   // incidente activo
  // La foto que se esta mirando a tamano grande, de la bitacora.
  const [imgRefModal, setImgRefModal] = useState(null);
  const [bitacora, setBitacora] = useState([]);
  const [cargandoBitacora, setCargandoBitacora] = useState(false);
  const [fotosAccion, setFotosAccion] = useState({});         // {accionId: [src, ...]}
  const [accionAbierta, setAccionAbierta] = useState(null);   // acción con fotos desplegadas

  // ── Estados que maneja el backend de JURP (los escribe la app móvil) ──
  //   pat = Pendiente de atención
  //   eat = En atención (cuadrilla trabajando)
  //   ate = Atendido / Resuelto  ← la app manda este al pulsar "SÍ, FINALIZAR"
  //   cer = Cerrado
  // El "cerrado" del costeo es OTRA cosa: vive en IncidenteCerrado (operations)
  // y se consulta en el arreglo incidentesCerrados.


  
  // Unidades disponibles para el metrado manual.


  // ── Actividades del parte diario ────────────────────────────────────────
  // Una máquina suele hacer varias tareas en la misma jornada (excavar,
  // cargar, eliminar) y el formato oficial impreso admite varias líneas.
  // El horómetro sigue siendo UNO por parte: de ahí sale el costo. Cada
  // actividad aporta el QUÉ se hizo y CUÁNTO se midió.
  //
  // Los nombres de campo son los mismos que usaba el formulario, para que
  // calcMetradoDe() sirva igual a una actividad que al parte completo.
  // Escalera de la partida. Es estado de pantalla, no del parte: lo que se
  // guarda es partidaId. Al reabrir una actividad se deduce de ella.
  // Codigos elegidos en la escalera, de arriba abajo:
  //   ['01', '01.02', '01.02.04', '01.02.04.01']
  // La profundidad NO es fija: hay ramas con cuatro ancestros y otras con
  // tres, asi que se guarda el camino y no un combo por nivel.

  // ── Carga de catálogos (equipos/marcas/modelos) ──────────────────────────



  // Partidas del presupuesto, con lo ejecutado hasta hoy.
  //
  // Se piden todas y se agrupan aquí: son decenas, no miles, y tenerlas en
  // memoria permite avisar en el formulario cuánto queda de la partida sin
  // ir al servidor en cada clic.
  //
  // Si el endpoint todavía no existe (backend sin desplegar) la lista queda
  // vacía y el selector no se dibuja: vale más que el formulario siga
  // funcionando sin partidas a que reviente entero por un 404.

  // rutaDe, cuelgaDe y bajarSolo viven en arbolPartidas.js: la actividad de
  // obra baja por el mismo árbol y dos copias acabarían bajando distinto el
  // día que alguien arregle una y no la otra.

  // Catálogo de cargos de mano de obra (persistido en el backend).

  // Carga el catálogo completo de modelos (todas las máquinas, sin filtrar).

  // Reconstruye "CODIGO · EQUIPO MARCA MODELO" de un parte guardado.
  // La API no devuelve el código de máquina, así que lo buscamos en el catálogo
  // por placa o por modelo+marca (misma lógica que el backend al liberar).

  // Partes de maquinaria que están en la lista pero todavía NO se guardaron.
  // Cada uno ya reservó un correlativo en pantalla, aunque el backend aún no
  // lo sepa: sin contarlos, el siguiente parte repetiría el mismo número.

  // Suma n al correlativo respetando el formato PD-0027-20260827.




  // ── Gestionar cargos de mano de obra (persistidos en el backend) ────────

  // ── Gestionar unidades de medida ────────────────────────────────────────

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
  // Trae la bitácora del incidente. Es el mismo endpoint que usa la app:
  // cada entrada es una atención o avance registrado en campo.
  const verBitacora = async (inc) => {
    setModalBitacora(inc);
    setBitacora([]);
    setFotosAccion({});
    setAccionAbierta(null);
    setCargandoBitacora(true);
    const token = localStorage.getItem('userToken');
    try {
      const res = await fetch(`/api/v1/mobile/hi-incident-actions/list/?incident_id=${inc.id}`, {
        headers: { 'Content-Type': 'application/json', 'Authorization': `Token ${token}` }
      });
      if (res.ok) {
        const json = await res.json();
        setBitacora(json.results || []);
      }
    } catch (e) { console.error(e); } finally { setCargandoBitacora(false); }
  };

  // Las fotos no vienen en el listado: hay que pedir el detalle de la acción.
  const verFotosAccion = async (accionId) => {
    if (accionAbierta === accionId) { setAccionAbierta(null); return; }
    setAccionAbierta(accionId);
    if (fotosAccion[accionId]) return;   // ya descargadas
    const token = localStorage.getItem('userToken');
    try {
      const res = await fetch(`/api/v1/mobile/hi-incident-actions/${accionId}/`, {
        headers: { 'Content-Type': 'application/json', 'Authorization': `Token ${token}` }
      });
      if (res.ok) {
        const json = await res.json();
        const detail = json.data || json;
        const srcs = (detail.images || []).map(it =>
          it.content?.startsWith('http') ? it.content : `data:image/jpeg;base64,${it.content}`
        );
        setFotosAccion(prev => ({ ...prev, [accionId]: srcs }));
      }
    } catch (e) { console.error(e); }
  };

  // Fecha de la bitácora en formato local legible.
  const fechaBitacora = (iso) => {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString('es-PE', {
        day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
      });
    } catch (e) { return iso; }
  };

  // El usuario puede venir como objeto {username} o como texto plano.
  const usuarioAccion = (u) => {
    if (!u) return 'Usuario';
    if (typeof u === 'string') return u;
    return u.username || 'Usuario';
  };

  const galeriaAnterior = () => setGaleriaIndex(i => Math.max(0, i - 1));
  const galeriaSiguiente = () => setGaleriaIndex(i => Math.min(galeriaMedia.length - 1, i + 1));

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

  // Abrir es solo eso: decir cual y mostrarla. Vaciar la pantalla y traer
  // sus costeos es cosa de GestionCosteo, que lo hace al cambiar de sujeto.
  const abrirModal = (inc) => { setIncidenteActivo(inc); setModalAbierto(true); };

  const cerrarIncidenteCompleto = async (sujeto) => {
    if (!sujeto) return;
    const conf = await Swal.fire({
      title: '¿Cerrar esta incidencia?',
      html: `Se cerrarán <b>todos los partes diarios</b> y sus máquinas quedarán disponibles.<br>La incidencia quedará <b>bloqueada</b> (no se podrá editar).`,
      icon: 'warning', showCancelButton: true, confirmButtonColor: '#2fb344',
      confirmButtonText: 'Sí, cerrar incidencia', cancelButtonText: 'Cancelar',
    });
    if (!conf.isConfirmed) return;
    try {
      // Un solo POST: cierra los partes, libera máquinas y marca el cierre.
      const r = await fetch(`${API_OPS}/incidentes/${sujeto.id}/cerrar-partes/`, { method: 'POST' });
      if (!r.ok) {
        Swal.fire('Error', `No se pudo cerrar la incidencia (código: ${r.status}).`, 'error');
        return;
      }
      setIncidentesCerrados(prev => prev.includes(sujeto.id) ? prev : [...prev, sujeto.id]);
      obtenerIncidentes();
      Swal.fire({ icon: 'success', title: 'Incidencia cerrada', text: 'Partes cerrados, máquinas liberadas y costeo bloqueado.', timer: 2200, showConfirmButton: false });
    } catch (e) {
      Swal.fire('Error', 'Fallo de conexión.', 'error');
    }
  };
  const reabrirIncidencia = async (sujeto) => {
    if (!sujeto) return;
    const conf = await Swal.fire({
      title: '¿Reabrir esta incidencia?',
      text: 'Podrás volver a editar los costeos. Los partes ya cerrados seguirán cerrados.',
      icon: 'question', showCancelButton: true, confirmButtonColor: '#206bc4',
      confirmButtonText: 'Sí, reabrir', cancelButtonText: 'Cancelar',
    });
    if (!conf.isConfirmed) return;
    try {
      const r = await fetch(`${API_OPS}/incidentes/${sujeto.id}/reabrir/`, { method: 'POST' });
      if (!r.ok) { Swal.fire('Error', `No se pudo reabrir (código: ${r.status}).`, 'error'); return; }
      setIncidentesCerrados(prev => prev.filter(id => id !== sujeto.id));
      obtenerIncidentes();
      Swal.fire({ icon: 'success', title: 'Incidencia reabierta', timer: 1500, showConfirmButton: false });
    } catch (e) {
      Swal.fire('Error', 'Fallo de conexión.', 'error');
    }
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




  // Reabre una incidencia cerrada (quita el bloqueo).

  // ── Precisión: se ingresan hasta 4 decimales; los IMPORTES se redondean a 2 ──
  // Cantidades y medidas: hasta 4 decimales (mínimo 2, sin ceros de relleno extra).
  // Paso de los inputs numéricos en toda la gestión del incidente.

  // Horas que se cobran de un parte ya guardado: manda horas_efectivas (es lo
  // que se costeó); si no está, la suma de los tramos de sus actividades; y
  // como último recurso el rango de la cabecera, para los partes antiguos.

  // Horas de una actividad: su propio tramo de horometro.
  // Horas efectivas de una actividad: lo que de verdad se cobra. Vacío = todo
  // el tramo; menos que el tramo exige un motivo.
  // Horas muertas: lo trabajado que no se cobra (avería, espera, traslado).
  // Los motivos de las líneas reducidas, juntos, para el campo de cabecera
  // que ya existía (lo usan los reportes y los partes antiguos).
  // Horas del parte: la SUMA de las efectivas de sus actividades, no el rango
  // de la cabecera. Lo que la máquina estuvo parada no se cobra.
  // Rango del dia, para la cabecera del parte y para sembrar el HM del siguiente.

  // ── Cálculo de metrado según actividad ──────────────────────────────────
  // Calcula el metrado de CUALQUIER recurso (no solo el del formulario abierto).
  // El bloque de metrado vive ahora en la ventana de actividad, así que estos
  // derivados miran a la actividad que se está editando, no al parte.
  // Formatea números con separador de miles (1000000.00 → 1,000,000.00)
  // OTROS = actividad libre: sin fórmula ni medidas, solo metrado manual.
  // Texto de actividad que se muestra/guarda (en OTROS, la descripción escrita).

  // ── Manejo de la lista de actividades ───────────────────────────────────


  // Resumen de la lista para los campos de cabecera del parte, que siguen
  // existiendo (el costeo, los reportes y los partes antiguos los usan).
  // Si todas las líneas comparten unidad, el metrado de cabecera es la suma.
  // Si se mezclan (m³ con m², por ejemplo), sumar sería inventar un número:
  // se toma el total de la unidad que más pesa y el detalle queda por línea.

  // Lista lista para el backend (campos de DailyPartActivity). 'medidas'
  // guarda los valores crudos del formulario para poder reabrir la actividad
  // tal como se capturó, incluso las que no tienen columna propia.

  // Y el camino de vuelta, al reabrir un parte guardado.

  // Abre el modal de "Añadir". Para maquinaria abre primero el SELECTOR de
  // máquina (paso 1). Personal/Insumo abren su formulario directo.

  // Devuelve el HM Fin del último parte de una máquina (por código), o 0.
  // "Último" = el mayor end_horometer entre sus partes existentes.

  // Datos que se heredan del último parte de la máquina al crear uno nuevo.
  // Proveedor, operador, licencia, tarifa y zona casi nunca cambian de un día
  // al siguiente, y volver a teclearlos en cada parte es donde se cuelan los
  // errores. Lo que SÍ cambia cada día (horómetros, combustible, metrado,
  // observaciones) se deja en blanco a propósito.

  // Paso 1: al elegir máquina del selector, la agrega a la lista en BORRADOR
  // (sin parte diario todavía). Vive solo en pantalla hasta que tenga un parte.

  // Paso 2: abre el formulario de PARTE DIARIO para una máquina concreta.

  // Desde una fila de máquina (grupo), agrega OTRO parte diario a la misma
  // máquina, reutilizando su identidad ya conocida.

  // Quita una máquina completa: su borrador (local) y todos sus partes.
  // Los partes ya guardados en BD se eliminan con confirmación.


  // Abre el formulario cargado con una entrada existente de mano de obra o
  // insumo. `grupo` aporta lo que no viaja en la entrada (cargo, origen…).

  // Igual, para un parte diario de maquinaria.

  // Cierra el formulario dejando siempre limpio el modo edición.

  // Guarda la edición. Si el registro ya está en la BD va por PATCH; si aún
  // no se guardó, se actualiza en la lista local y viajará con "Guardar Costeos".


  // Elimina UNA entrada de insumo ya guardada en la BD.
  // Fecha por la que se filtra cada recurso: la maquinaria usa la del parte,
  // la mano de obra y los insumos la del trabajo.

  // Recursos dentro del rango. Los que no tienen fecha (registros anteriores
  // al campo) se muestran siempre: ocultarlos sería esconder costos reales.




  // Categorías del expediente: MANO DE OBRA / MATERIALES / EQUIPO.
  // Fecha en formato corto para la tabla (DD/MM).





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
      const horas = horasCobradas(i);
      const pu = parseFloat(i.unit_price) || 0;
      const tot = horas * pu;
      g.maquinaria.push({
        parte: i.part_number || '—',
        // Identificación de la máquina (viene en el propio parte).
        equipo: i.equipment_name || '—',
        marca: i.brand_name || '',
        placa: i.model_plate || '—',
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
  const txtEstado = (e) => txtEstadoInc(e);
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
        showFoot: 'lastPage',   // el total va solo al final, no en cada página
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
            showFoot: 'lastPage',   // el subtotal va solo al final del bloque
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
          d.personal.map(x => ([x.descripcion, x.origen, String(x.personas), fmtCant(x.horas), fmtCant(x.precio), x.total.toFixed(2)])),
          ['', '', '', '', 'SUBTOTAL', d.personal.reduce((a, x) => a + x.total, 0).toFixed(2)]);

        bloque('MAQUINARIA',
          ['N° PARTE', 'MÁQUINA', 'PLACA/CÓDIGO', 'ACTIVIDAD', 'PROVEEDOR', 'VOLUMEN', 'HORAS', 'P. UNIT.', 'TOTAL S/'],
          d.maquinaria.map(x => ([x.parte, `${x.equipo}${x.marca ? ' · ' + x.marca : ''}`, x.placa, x.actividad, x.proveedor, `${fmtCant(x.metrado)} ${uMetrado(x.metradoUnidad)}`, fmtCant(x.horas), fmtCant(x.precio), x.total.toFixed(2)])),
          ['', '', '', '', '', '', '', 'SUBTOTAL', d.maquinaria.reduce((a, x) => a + x.total, 0).toFixed(2)]);

        bloque('MATERIALES',
          ['DESCRIPCIÓN', 'UNIDAD', 'CANTIDAD', 'P. UNIT.', 'TOTAL S/'],
          d.materiales.map(x => ([x.descripcion, x.unidad, fmtCant(x.cantidad), fmtCant(x.precio), x.total.toFixed(2)])),
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
      wd.columns = [{ width: 22 }, { width: 30 }, { width: 16 }, { width: 30 }, { width: 18 },
                    { width: 15 }, { width: 12 }, { width: 13 }, { width: 15 }];
      let f = 1;
      const tituloSeccion = (texto, fill, size) => {
        wd.mergeCells(`A${f}:I${f}`);
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
        wd.mergeCells(`A${f}:I${f}`);
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

        tablaDetalle(['N° PARTE', 'MÁQUINA', 'PLACA/CÓDIGO', 'ACTIVIDAD', 'PROVEEDOR', 'VOLUMEN', 'HORAS', 'P. UNIT.', 'TOTAL S/'],
          d.maquinaria.map(x => ([x.parte, `${x.equipo}${x.marca ? ' · ' + x.marca : ''}`, x.placa, x.actividad, x.proveedor, `${fmtCant(x.metrado)} ${uMetrado(x.metradoUnidad)}`, x.horas, x.precio, x.total])),
          'SUBTOTAL MAQUINARIA', d.maquinaria.reduce((a, x) => a + x.total, 0));

        tablaDetalle(['DESCRIPCIÓN', 'UNIDAD', 'CANTIDAD', 'P. UNIT.', 'TOTAL S/'],
          d.materiales.map(x => ([x.descripcion, x.unidad, x.cantidad, x.precio, x.total])),
          'SUBTOTAL MATERIALES', d.materiales.reduce((a, x) => a + x.total, 0));

        wd.mergeCells(`A${f}:H${f}`);
        wd.getCell(`A${f}`).value = 'COSTO TOTAL DE LA INCIDENCIA';
        wd.getCell(`A${f}`).font = { bold: true, size: 10, color: { argb: '1463A5' } };
        wd.getCell(`A${f}`).alignment = { horizontal: 'right' };
        wd.getCell(`A${f}`).fill = azulClaro;
        wd.getCell(`I${f}`).value = d.total;
        wd.getCell(`I${f}`).numFmt = '#,##0.00';
        wd.getCell(`I${f}`).font = { bold: true, size: 10, color: { argb: '1463A5' } };
        wd.getCell(`I${f}`).fill = azulClaro;
        wd.getCell(`I${f}`).alignment = { horizontal: 'right' };
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


  // ── Aplica los filtros antes de paginar ────────────────────────────────
  const incidentesFiltrados = incidentes.filter(inc => {
    if (filtroTipo && inc.tipoBase !== filtroTipo) return false;
    if (filtroEstado) {
      // "Cerrado" no es un estado de JURP: es la marca de cierre del costeo.
      if (filtroEstado === 'cerrado_costeo') {
        if (!incidentesCerrados.includes(inc.id)) return false;
      } else {
        // Un incidente con el costeo cerrado ya no cuenta como pendiente/en
        // atención/resuelto: se busca por la opción "Cerrado (costeo)".
        if (incidentesCerrados.includes(inc.id)) return false;
        if (inc.estado !== filtroEstado) return false;
      }
    }
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
    const e = ESTADOS[estado];
    if (!e) return <span className="tbl-badge bg-secondary-lt">{estado}</span>;
    return <span style={{...base, backgroundColor: e.color, color:'#fff'}}>{e.texto}</span>;
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
  // Trabaja sobre la actividad que se está editando en su propia ventana.

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
              <option value="eat">En Atención</option>
              <option value="ate">Resuelto</option>
              <option value="cer">Cerrado</option>
              <option value="cerrado_costeo">Cerrado (costeo)</option>
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
                    <div style={{ fontSize:'17px', fontWeight:800, color:'#1463A5', background:'#eff6ff', border:'1px solid #bfdbfe', borderRadius:'6px', padding:'6px 14px', display:'inline-block', marginBottom:'10px', letterSpacing:'0.5px' }}>{inc.codigoIncidente}</div>
                    <h3 className="tbl-card-title" title={inc.tipo} style={{ fontSize:'1.4rem', fontWeight:800, color:'#0f172a', lineHeight:'1.25', display:'-webkit-box', WebkitLineClamp:3, WebkitBoxOrient:'vertical', overflow:'hidden', minHeight:'2.5em', marginBottom:'10px' }}>{inc.tipo}</h3>
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
                  <div className="tbl-card-btn-bottom" style={{ borderBottom:'1px solid #c9dff2' }} onClick={() => verBitacora(inc)}><FaListUl /> Ver bitácora</div>
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
      {/* La gestión de costeo vive en su propio componente: la misma
          pantalla sirve para una actividad de obra. */}
      <GestionCosteo
        abierto={modalAbierto && !!incidenteActivo}
        sujeto={incidenteActivo && {
          ...incidenteActivo,
          titulo: incidenteActivo.codigoIncidente,
          subtitulo: `${incidenteActivo.tipo} en ${incidenteActivo.codigo}`,
          detalle: incidenteActivo.lugar,
          bloqueado: incidentesCerrados.includes(incidenteActivo.id),
          textoCerrado: 'Incidencia cerrada',
          textoCerrar: 'Cerrar incidencia',
          tituloCerrar: 'Cierra los partes, libera las máquinas y bloquea el costeo',
        }}
        campoVinculo="incident_report"
        onCerrar={() => setModalAbierto(false)}
        onCambio={obtenerIncidentes}
        onCerrarSujeto={cerrarIncidenteCompleto}
        onReabrir={reabrirIncidencia}
      />
      {/* ── Modal: BITÁCORA DE ATENCIONES (lo que se registra en la app) ── */}
      {modalBitacora && (
        <Portal><div onClick={() => setModalBitacora(null)} style={{ position:'fixed', inset:0, zIndex:10001, background:'rgba(0,0,0,0.6)', display:'flex', alignItems:'center', justifyContent:'center', padding:'20px' }}>
          <div onClick={e => e.stopPropagation()} style={{ background:'#fff', borderRadius:'12px', overflow:'hidden', maxWidth:'760px', width:'100%', maxHeight:'88vh', display:'flex', flexDirection:'column' }}>
            {/* Cabecera */}
            <div style={{ padding:'16px 22px', background:'#1463A5', color:'#fff' }}>
              <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:'12px' }}>
                <div style={{ minWidth:0 }}>
                  <div style={{ fontSize:'11px', fontWeight:700, opacity:0.85, letterSpacing:'0.4px' }}>{modalBitacora.codigoIncidente}</div>
                  <h5 style={{ margin:'3px 0 0', fontSize:'17px', fontWeight:700 }}>Bitácora de Atenciones</h5>
                  <div style={{ fontSize:'12px', opacity:0.85, marginTop:'3px' }}>{modalBitacora.tipo}</div>
                </div>
                <button onClick={() => setModalBitacora(null)} style={{ background:'rgba(255,255,255,0.15)', border:'none', cursor:'pointer', color:'#fff', fontSize:'16px', display:'flex', borderRadius:'6px', padding:'8px', flexShrink:0 }}><FaTimes /></button>
              </div>
            </div>

            {/* Línea de tiempo */}
            <div style={{ overflowY:'auto', padding:'18px 22px', background:'#f8fafc' }}>
              {cargandoBitacora ? (
                <div style={{ textAlign:'center', padding:'40px', color:'#64748b', fontSize:'13px' }}>
                  <FaSyncAlt className="icon-spin" style={{ marginRight:'8px' }} /> Cargando bitácora…
                </div>
              ) : bitacora.length === 0 ? (
                <div style={{ textAlign:'center', padding:'40px', color:'#94a3b8', fontSize:'13px' }}>
                  Todavía no hay atenciones registradas para este incidente.
                </div>
              ) : (
                bitacora.map((acc, idx) => {
                  const fotos = fotosAccion[acc.id];
                  const abierta = accionAbierta === acc.id;
                  const nFotos = acc.images_count || 0;
                  return (
                    <div key={acc.id || idx} style={{ display:'flex', gap:'12px', marginBottom:'4px' }}>
                      {/* Riel de la línea de tiempo */}
                      <div style={{ display:'flex', flexDirection:'column', alignItems:'center', flexShrink:0 }}>
                        <div style={{ width:'11px', height:'11px', borderRadius:'50%', background:'#1463A5', border:'2px solid #bfdbfe', marginTop:'5px' }}></div>
                        {idx < bitacora.length - 1 && <div style={{ flex:1, width:'2px', background:'#dbeafe', minHeight:'24px' }}></div>}
                      </div>
                      {/* Contenido de la entrada */}
                      <div style={{ flex:1, minWidth:0, background:'#fff', border:'1px solid #e2e8f0', borderRadius:'9px', padding:'11px 14px', marginBottom:'14px' }}>
                        <div style={{ display:'flex', alignItems:'center', gap:'8px', flexWrap:'wrap', marginBottom:'6px' }}>
                          <span style={{ display:'inline-flex', alignItems:'center', gap:'5px', fontSize:'11px', fontWeight:700, color:'#0284c7', background:'#e0f2fe', borderRadius:'5px', padding:'2px 8px' }}>
                            <FaUser size={9} /> {usuarioAccion(acc.user)}
                          </span>
                          <span style={{ fontSize:'11px', color:'#64748b', display:'inline-flex', alignItems:'center', gap:'5px' }}>
                            <FaCalendarAlt size={10} /> {fechaBitacora(acc.created_at)}
                          </span>
                        </div>
                        <div style={{ fontSize:'13px', color:'#1e293b', lineHeight:'1.5', whiteSpace:'pre-wrap' }}>
                          {acc.description || 'Acción registrada sin descripción'}
                        </div>
                        {nFotos > 0 && (
                          <>
                            <button type="button" onClick={() => verFotosAccion(acc.id)}
                              style={{ marginTop:'9px', display:'inline-flex', alignItems:'center', gap:'6px', background:'#eff6ff', color:'#1463A5', border:'1px solid #bfdbfe', borderRadius:'6px', padding:'4px 10px', fontSize:'11px', fontWeight:600, cursor:'pointer' }}>
                              <FaImage size={11} /> {abierta ? 'Ocultar' : `Ver ${nFotos} foto${nFotos > 1 ? 's' : ''}`}
                            </button>
                            {abierta && (
                              <div style={{ marginTop:'10px' }}>
                                {!fotos ? (
                                  <div style={{ fontSize:'12px', color:'#64748b' }}><FaSyncAlt className="icon-spin" style={{ marginRight:'6px' }} /> Cargando fotos…</div>
                                ) : fotos.length === 0 ? (
                                  <div style={{ fontSize:'12px', color:'#94a3b8', fontStyle:'italic' }}>No se pudieron cargar las fotos.</div>
                                ) : (
                                  <div style={{ display:'flex', gap:'8px', flexWrap:'wrap' }}>
                                    {fotos.map((src, i) => (
                                      <img key={i} src={src} alt={`Evidencia ${i + 1}`}
                                        onClick={() => setImgRefModal({ src, titulo: `Atención del ${fechaBitacora(acc.created_at)}` })}
                                        style={{ width:'104px', height:'104px', objectFit:'cover', borderRadius:'7px', border:'1px solid #e2e8f0', cursor:'pointer' }}
                                        title="Clic para ampliar" />
                                    ))}
                                  </div>
                                )}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Pie */}
            <div style={{ padding:'12px 22px', borderTop:'1px solid #e2e8f0', background:'#f8fafc', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <span style={{ fontSize:'12px', color:'#64748b' }}>
                {cargandoBitacora ? '' : `${bitacora.length} atención(es) registrada(s) desde la app`}
              </span>
              <button onClick={() => setModalBitacora(null)} className="tbl-btn tbl-btn-link">Cerrar</button>
            </div>
          </div>
        </div></Portal>
      )}
      <VisorImagen foto={imgRefModal} onCerrar={() => setImgRefModal(null)} />

      {/* ── MODAL GALERÍA DE EVIDENCIAS ────────────────────────────────── */}
      {modalMediaAbierto && (
        <Portal><div onClick={() => setModalMediaAbierto(false)} style={{ position:'fixed',top:0,left:0,right:0,bottom:0,zIndex:10001,background:'rgba(0,0,0,0.92)',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center' }}>
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
        </div></Portal>
      )}
      {/* ── Modal: elegir formato del reporte general ─────────────────── */}
      {modalReporteGlobal && (
        <Portal><div onClick={() => !generandoReporte && setModalReporteGlobal(false)}
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
        </div></Portal>
      )}

    </div>
  );
}
// Estilo compartido de los controles de la barra de filtros.
const filtroSelStyle = { padding:'7px 10px', border:'1px solid #cbd5e1', borderRadius:'6px', fontSize:'12px', color:'#334155', background:'#fff', cursor:'pointer', width:'auto', minWidth:'140px' };

export default Incidentes;