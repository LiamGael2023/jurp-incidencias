// ═══════════════════════════════════════════════════════════════════════════
//  Gestión de costeo
// ═══════════════════════════════════════════════════════════════════════════
//
// Mano de obra, materiales y equipo de UN sujeto, con sus partes diarios, sus
// subtotales y su cierre. Sirve igual para una incidencia que para una
// actividad de obra, porque lo único que cambia entre las dos es de qué
// cuelgan las líneas.
//
// ESTABA DENTRO DE Incidentes.jsx. El acoplamiento era menos profundo de lo
// que parecía: de todo el incidente sólo se leían cinco campos y el vínculo
// de escritura era UN campo del formulario. Por eso el contrato de abajo es
// pequeño: `sujeto` dice quién paga, `campoVinculo` dice cómo se guarda, y
// nada más de aquí sabe qué es una incidencia.
//
// LO QUE NO SE TOCÓ AL MOVERLO: el JSX y las funciones vinieron tal cual.
// Mover 1.300 líneas y aprovechar para arreglarlas a la vez es la forma
// segura de no saber después cuál de las dos cosas rompió qué.


import { useState, useEffect, Fragment } from 'react';
import { createPortal } from 'react-dom';
import {
  FaCalendarAlt, FaCheckCircle, FaChevronRight, FaDownload, FaFileExcel,
  FaFileInvoice, FaFilePdf, FaListUl, FaPen, FaPlus,
  FaSave, FaSearch, FaSyncAlt, FaTimes, FaTrash,
  FaTruck, FaUser,
} from 'react-icons/fa';
import Swal from 'sweetalert2';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import ExcelJS from 'exceljs';
import logo from './assets/jurp.png';
import refAltura from './assets/ref_altura.png';
import refAncho from './assets/ref_ancho.png';
import MantenedorEquipos from './MantenedorEquipos';
import VisorImagen from './VisorImagen';
import { API_OPS } from './api';
import { rutaDe, cuelgaDe, bajarSolo } from './arbolPartidas';
import { imgToBase64 } from './costeo/imagen';
import {
  CATEGORIAS, IMG_METRADO, STEP4, txtEstadoInc,
  UNIDADES_METRADO, UNIDADES_METRADO_TXT, actividadesDesdeBackend, actividadesParaBackend,
  calcMetradoDe, correlativoMas, detalleMaquinaDeParte, estadoInicialActividad,
  estadoInicialRecurso, fechaCorta, fechaDe, fmtCant,
  fmtNum, formulaMetrado, generarCorrelativo, getFechaHoy,
  hayReduccionEn, heDeActividad, horasCobradas, horasDeActividad,
  horasDeLista, muertasDeActividad, muertasDeLista, normalizar, rangoHorometro,
  resumenActividades, resumenReduccion, round2, round4,
  textoActividad, tramoDeLista,
} from './costeo/calculos';

const Portal = ({ children }) => createPortal(children, document.body);

/**
 * @param sujeto  { id, titulo, subtitulo, detalle, bloqueado }
 *                titulo es lo que va en la cabecera; subtitulo y detalle, las
 *                dos líneas del recuadro azul. `bloqueado` cierra la pantalla
 *                a cambios: lo decide quien llama, porque "cerrado" significa
 *                cosas distintas en una incidencia y en una actividad.
 * @param campoVinculo  'incident_report' o 'actividad_obra'. Es el campo con
 *                que cada línea de costeo queda colgada de su sujeto.
 * @param abierto / onCerrar   el modal lo controla quien llama.
 * @param onCambio   se llama cuando algo se guardó o se cerró, para que la
 *                pantalla de fuera se refresque.
 * @param onCerrarSujeto / onReabrir   los dos botones del pie. Si no se pasan,
 *                no se dibujan: una actividad no se "cierra" como una
 *                incidencia.
 */
export default function GestionCosteo({
  sujeto, campoVinculo = 'incident_report',
  abierto, onCerrar, onCambio,
  onCerrarSujeto, onReabrir,
}) {
  // ── el estado, todo junto arriba: los efectos de mas abajo lo leen y
  //    en JS un const no existe hasta su linea ──────────────────────────
  const [catActividades, setCatActividades] = useState([]);
  const [catEquipos, setCatEquipos] = useState([]);
  const [catMarcas, setCatMarcas] = useState([]);
  const [catModelos, setCatModelos] = useState([]);
  const [todosModelos, setTodosModelos] = useState([]);
  const [catUnidades, setCatUnidades] = useState(['bol', 'm3', 'm2', 'und', 'kg', 'gln', 'rll']);
  const [catCargos, setCatCargos] = useState([]);   // catálogo de cargos (backend)
  const [mantenedorAbierto, setMantenedorAbierto] = useState(false);
  const [recursos, setRecursos] = useState([]); 
  const [guardando, setGuardando] = useState(false);
  const [modalPdfAbierto, setModalPdfAbierto] = useState(false);
  const [pdfUrlActivo, setPdfUrlActivo] = useState(null);
  const [imgRefModal, setImgRefModal] = useState(null);
  const [modalPartes, setModalPartes] = useState(null);   // fila agrupada de maquinaria
  const [rangoDesde, setRangoDesde] = useState('');
  const [rangoHasta, setRangoHasta] = useState('');
  const [editando, setEditando] = useState(null);
  const [formTipo, setFormTipo] = useState(null);         // 'Personal' | 'Maquinaria' | 'Insumo' | null → modal de añadir
  const [selectorMaquina, setSelectorMaquina] = useState(false); // paso 1: elegir máquina
  const [buscarMaquina, setBuscarMaquina] = useState('');
  const [nuevoRecurso, setNuevoRecurso] = useState(estadoInicialRecurso);
  const [actividades, setActividades] = useState([]);       // las del parte abierto
  const [actForm, setActForm] = useState(estadoInicialActividad);
  const [actEditando, setActEditando] = useState(null);     // índice, o null = nueva
  const [modalActividad, setModalActividad] = useState(false);
  const [partidas, setPartidas] = useState([]);             // presupuesto de obra
  const [modalAvance, setModalAvance] = useState(false);
  const [casRuta, setCasRuta] = useState([]);
  const [filtroAvance, setFiltroAvance] = useState('todas');

  // Cerrado significa cosas distintas en una incidencia y en una actividad,
  // asi que lo decide quien llama y aqui solo se obedece.
  const bloqueado = !!(sujeto && sujeto.bloqueado);
  const textoCerrado = (sujeto && sujeto.textoCerrado) || 'Cerrada';
  const textoCerrar = (sujeto && sujeto.textoCerrar) || 'Cerrar';
  const tituloCerrar = (sujeto && sujeto.tituloCerrar) || '';

  // Las tres lineas de la cabecera. Se leen del sujeto si las trae y, si no,
  // de donde las tenia la incidencia: asi la pantalla de incidencias sigue
  // diciendo lo mismo que decia sin tener que tocarla.
  const titulo = (sujeto && (sujeto.titulo || sujeto.codigoIncidente || sujeto.codigo)) || '';
  const subtitulo = (sujeto && (sujeto.subtitulo
    || (sujeto.tipo ? `${sujeto.tipo} en ${sujeto.lugar || ''}` : sujeto.nombre))) || '';
  const detalle = (sujeto && (sujeto.detalle || sujeto.codigo)) || '';


  // Al cambiar de sujeto se vacia y se vuelve a cargar. Vaciar primero no es
  // adorno: si no, lo del anterior se queda a la vista mientras llega lo del
  // nuevo, y alguien lo cuenta.
  useEffect(() => {
    if (!sujeto) return;
    setRecursos([]);
    setNuevoRecurso({ ...estadoInicialRecurso, numeroParte: generarCorrelativo() });
    obtenerCorrelativoParte();
    cargarCosteosGuardados(sujeto.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sujeto && sujeto.id]);


  useEffect(() => { cargarEquiposCat(nuevoRecurso.origen); }, []);

  const cargarActividades = async () => {
    try {
      const r = await fetch(`${API_OPS}/actividades/?activo=true`);
      if (r.ok) setCatActividades(await r.json());
    } catch (e) { console.error(e); }
  };

  useEffect(() => { cargarActividades(); }, []);

  useEffect(() => { cargarPartidas(); }, []);

  useEffect(() => { cargarCargos(); }, []);

  useEffect(() => { cargarTodosModelos(); }, []);

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

  useEffect(() => {
    if (abierto && sujeto && todosModelos.length > 0) {
      cargarCosteosGuardados(sujeto.id);
    }
  }, [todosModelos.length]);

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
      // Hereda proveedor, operador, tarifa… del parte anterior de esta máquina.
      ...datosDelUltimoParte(maq.codigo),
    });
    setActividades([]);
    obtenerCorrelativoParte(partesPendientes());
    setFormTipo('Maquinaria');
  };

  const eliminarRecurso = (idLocal) => setRecursos(recursos.filter(r => r.idLocal !== idLocal));

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
  const cargarPartidas = async () => {
    try {
      const r = await fetch(`${API_OPS}/partidas/`);
      if (!r.ok) return;
      const d = await r.json();
      setPartidas(Array.isArray(d) ? d : (d.partidas || []));
    } catch (e) { /* backend sin el endpoint: se sigue sin partidas */ }
  };
  const cargarCargos = async () => {
    try {
      const r = await fetch(`${API_OPS}/cargos/?activo=true`);
      if (r.ok) setCatCargos(await r.json());
    } catch (e) { console.error(e); }
  };
  const cargarTodosModelos = async () => {
    try {
      const r = await fetch(`${API_OPS}/modelos/`);
      if (r.ok) setTodosModelos(await r.json());
    } catch (e) { console.error(e); }
  };
  const partesPendientes = () => recursos.filter(
    r => r.tipo === 'Maquinaria' && !r.guardadoEnDB && !r.esBorrador
  ).length;
  const obtenerCorrelativoParte = async (offset = 0) => {
    try {
      const r = await fetch(`${API_OPS}/daily-part-heavy-equipments/siguiente-correlativo/`);
      if (r.ok) {
        const data = await r.json();
        if (data?.numero_parte) {
          const numero = correlativoMas(data.numero_parte, offset);
          setNuevoRecurso(prev => ({ ...prev, numeroParte: numero }));
        }
      }
    } catch (e) { console.error(e); }
  };
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
      const formatPers = listPers.filter(i => String(i[campoVinculo]) === idStr).map(i => {
        // Recupera el cargo y el desglose de cuadrilla desde el texto guardado
        // (o desde los campos del backend si existen), para no mostrar "undefined".
        const descripcion = (i.description || '').split('\n')[0].trim();
        return {
          idLocal: `db-pers-${i.id}`, dbId: i.id, endpoint: 'incident-personnels', tipo: 'Personal',
          fechaRecurso: i.date || '',
          descripcion,
          numPersonas: i.num_personas ?? 1,
          origen: i.origin || 'JURP',
          horasTrabajo: i.horas_normales ?? parseFloat(i.quantity_hours) ?? 0,
          horasExtras: i.horas_extras ?? 0,
          descripcionResumen: i.description,
          cantidad: round4(i.quantity_hours), precioUnitario: parseFloat(i.unit_price),
          total: round2(parseFloat(i.quantity_hours) * parseFloat(i.unit_price)), guardadoEnDB: true
        };
      });
      const formatMat = listMat.filter(i => String(i[campoVinculo]) === idStr).map(i => ({ idLocal: `db-mat-${i.id}`, dbId: i.id, endpoint: 'incident-materials', tipo: 'Insumo', fechaRecurso: i.date || '', descripcionResumen: i.description, unidad: i.unit || 'und', cantidad: round4(i.quantity), precioUnitario: parseFloat(i.unit_price), total: round2(parseFloat(i.quantity) * parseFloat(i.unit_price)), guardadoEnDB: true }));
      const formatMaq = listMaq.filter(i => String(i[campoVinculo]) === idStr).map(i => {
        // Resuelve la máquina del catálogo para poder agregarle más partes luego.
        const mp = (i.model_plate || '').trim();
        let modeloTxt = mp, placaTxt = mp;
        if (mp.includes('/')) { const [a, b] = mp.split('/', 2).map(x => x.trim()); modeloTxt = a; placaTxt = b || ''; }
        // El FK manda; el texto solo es respaldo para partes antiguos.
        let maq = i.maquina ? todosModelos.find(m => String(m.id) === String(i.maquina)) : null;
        if (!maq && placaTxt) maq = todosModelos.find(m => m.placa && m.placa.toLowerCase() === placaTxt.toLowerCase());
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
          // Sin estos, al abrir la edición del parte los campos salían vacíos
          // y se sobrescribían con nada al guardar.
          proveedor: i.provider || '', licencia: i.licencia || '', categoria: i.categoria || '',
          horasEfectivas: i.horas_efectivas != null ? String(i.horas_efectivas) : '',
          obsReduccion: i.obs_reduccion || '',
          metradoManual: i.metrado != null ? String(i.metrado) : '',
          unidadMetrado: i.metrado_unidad || 'm3',
          calcularMetrado: !!i.metrado_calculado,
          anchoSup: i.width_top ?? '', anchoInf: i.width_bottom ?? '',
          altura: i.height ?? '', longitud: i.length ?? '',
          // Las actividades vienen anidadas. Un parte anterior a este cambio no
          // las trae: se le arma una sola línea con lo que hay en la cabecera,
          // así al editarlo no se queda sin actividades.
          actividadesLista: (i.actividades && i.actividades.length)
            ? actividadesDesdeBackend(i.actividades)
            : (i.activities ? [{
                ...estadoInicialActividad,
                zonaTrabajo: i.work_zone_text || '',
                actividad: IMG_METRADO[i.activities] ? i.activities : 'OTROS',
                actividadOtros: IMG_METRADO[i.activities] ? '' : i.activities,
                hmInicio: i.start_horometer != null ? String(i.start_horometer) : '',
                hmFin: i.end_horometer != null ? String(i.end_horometer) : '',
                horasEfectivas: i.horas_efectivas != null ? String(i.horas_efectivas) : '',
                obsReduccion: i.obs_reduccion || '',
                metradoManual: i.metrado != null ? String(i.metrado) : '',
                unidadMetrado: i.metrado_unidad || 'm3',
                anchoSup: i.width_top ?? '', anchoInf: i.width_bottom ?? '',
                altura: i.height ?? '', longitud: i.length ?? '',
              }] : []),
          cantidad: horasCobradas(i),
          precioUnitario: parseFloat(i.unit_price),
          total: round2(horasCobradas(i) * (parseFloat(i.unit_price) || 0)),
          guardadoEnDB: true,
        };
      });
      setRecursos([...formatPers, ...formatMat, ...formatMaq]);
    } catch (error) { console.error("❌ Error al obtener los recursos guardados:", error); }
  };
  const abrirModalPdf = (dbId) => {
    const url = `https://gideonstudio.duckdns.org/api/v1/mobile/operations/daily-part-heavy-equipments/${dbId}/pdf/`;
    setPdfUrlActivo(url);
    setModalPdfAbierto(true);
  };
  const eliminarRecursoGuardado = async (fila) => {
    if (bloqueado) { Swal.fire('Incidencia cerrada', 'Reábrela para poder editar.', 'info'); return; }
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
        if (sujeto) cargarCosteosGuardados(sujeto.id);
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
        if (sujeto) cargarCosteosGuardados(sujeto.id);
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
  // Cerrar y reabrir los hace quien llama, que es el unico que sabe lo que
  // significan. Aqui solo se recarga despues, para que la pantalla refleje
  // lo que acaba de pasar sin que el de fuera tenga que acordarse.
  const cerrar = async () => {
    if (!sujeto || !onCerrarSujeto) return;
    await onCerrarSujeto(sujeto);
    cargarCosteosGuardados(sujeto.id);
  };
  const reabrir = async () => {
    if (!sujeto || !onReabrir) return;
    await onReabrir(sujeto);
    cargarCosteosGuardados(sujeto.id);
  };

  const horasMaquina = String(horasDeLista(actividades));
  const volCalc = calcMetradoDe(actForm);
  const volumenMetrado = round4(volCalc.val);
  const esActividadOtros = actForm.actividad === 'OTROS';
  const tieneMetradoActividad = IMG_METRADO[actForm.actividad] !== undefined || esActividadOtros;
  const abrirNuevaActividad = () => {
    // El horómetro encadena: la tarea siguiente arranca donde terminó la
    // anterior. La primera parte del HM Fin del último parte de la máquina.
    const previo = actividades.length
      ? actividades[actividades.length - 1].hmFin
      : (nuevoRecurso.hmInicio !== '' && nuevoRecurso.hmInicio != null ? String(nuevoRecurso.hmInicio) : '');
    // Hereda la zona del parte para no volver a escribirla en cada línea.
    setActForm({ ...estadoInicialActividad, zonaTrabajo: nuevoRecurso.zonaTrabajo || '', hmInicio: previo });
    setCasRuta(bajarSolo(partidas, []));
    setActEditando(null);
    setModalActividad(true);
  };
  const abrirEditarActividad = (i) => {
    const a = { ...estadoInicialActividad, ...actividades[i] };
    setActForm(a);
    // La escalera se reconstruye desde la partida guardada, para que al
    // reabrir se vea el camino completo y no tres combos en blanco.
    const p = partidas.find(x => String(x.id) === String(a.partidaId));
    setCasRuta(p ? rutaDe(p).map(n => n[0]) : []);
    setActEditando(i);
    setModalActividad(true);
  };
  const quitarActividad = (i) => setActividades(actividades.filter((_, j) => j !== i));
  const guardarActividad = () => {
    const a = actForm;
    if (!a.actividad) return Swal.fire({ icon: 'warning', title: 'Atención', text: 'Selecciona la actividad realizada' });
    if (a.actividad === 'OTROS' && !(a.actividadOtros || '').trim())
      return Swal.fire({ icon: 'warning', title: 'Atención', text: 'Escribe la descripción de la actividad realizada.' });
    if (a.actividad === 'OTROS' && !(parseFloat(a.metradoManual) > 0))
      return Swal.fire({ icon: 'warning', title: 'Atención', text: 'Ingresa el metrado manual de la actividad.' });
    // El tramo de horómetro es lo que se cobra: sin él la actividad no suma horas.
    if (a.hmInicio === '' || a.hmFin === '')
      return Swal.fire({ icon: 'warning', title: 'Atención', text: 'Completa el horómetro de inicio y fin de esta actividad.' });
    if (horasDeActividad(a) <= 0)
      return Swal.fire({ icon: 'warning', title: 'Atención', text: 'El horómetro final debe ser mayor al inicial.' });
    // Dos actividades no pueden ocupar el mismo tramo: serían horas cobradas dos veces.
    const choca = actividades.some((o, j) => j !== actEditando &&
      parseFloat(a.hmInicio) < parseFloat(o.hmFin) && parseFloat(a.hmFin) > parseFloat(o.hmInicio));
    if (choca) return Swal.fire({
      icon: 'warning', title: 'Horómetro superpuesto',
      text: 'Ese tramo se cruza con el de otra actividad del parte. Revisa los horómetros.',
    });
    // Las horas efectivas no pueden pasar del tramo, y si son menos hay que
    // decir por qué: eso es lo que justifica cobrar menos de lo trabajado.
    const tramo = horasDeActividad(a);
    const he = heDeActividad(a);
    if (he < 0 || he > tramo) return Swal.fire({
      icon: 'warning', title: 'Atención',
      text: `Las horas efectivas deben estar entre 0 y ${tramo}.`,
    });
    if (he < tramo && !(a.obsReduccion || '').trim()) return Swal.fire({
      icon: 'warning', title: 'Observación requerida',
      text: 'Detalla el motivo de la reducción de horas de esta actividad.',
    });
    const lista = [...actividades];
    if (actEditando === null) lista.push(a); else lista[actEditando] = a;
    setActividades(lista);
    setModalActividad(false);
    setActEditando(null);
  };
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
  const ultimoHmFinDeMaquina = (codigo) => {
    const cod = (codigo || '').toUpperCase();
    if (!cod) return 0;
    const codigoDeRec = (r) => ((r.codigoMaquina || (r.descripcionResumen || '').split('·')[0]).trim().split(' ')[0] || '').toUpperCase();
    const partes = recursos.filter(r => r.tipo === 'Maquinaria' && !r.esBorrador && codigoDeRec(r) === cod);
    if (partes.length === 0) return 0;
    const maxFin = Math.max(...partes.map(r => parseFloat(r.hmFin) || 0));
    return isFinite(maxFin) ? maxFin : 0;
  };
  const datosDelUltimoParte = (codigo) => {
    const cod = (codigo || '').toUpperCase();
    if (!cod) return {};
    const codigoDeRec = (r) => ((r.codigoMaquina || (r.descripcionResumen || '').split('·')[0]).trim().split(' ')[0] || '').toUpperCase();
    const partes = recursos.filter(r => r.tipo === 'Maquinaria' && !r.esBorrador && codigoDeRec(r) === cod);
    if (!partes.length) return {};
    // El más reciente por fecha; a igualdad de fecha, el de mayor horómetro.
    const ultimo = [...partes].sort((a, b) => {
      const f = String(b.fechaParte || '').localeCompare(String(a.fechaParte || ''));
      return f !== 0 ? f : (parseFloat(b.hmFin) || 0) - (parseFloat(a.hmFin) || 0);
    })[0];
    return {
      proveedor: ultimo.proveedor || '',
      operador: ultimo.operador || '',
      licencia: ultimo.licencia || '',
      categoria: ultimo.categoria || '',
      zonaTrabajo: ultimo.zonaTrabajo || '',
      turno: ultimo.turno || 'Día',
      precioUnitario: ultimo.precioUnitario || 0,
    };
  };
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
      ...datosDelUltimoParte(grupo.codigoMaquina || (grupo.descripcionResumen || '').split('·')[0]),
    });
    setActividades([]);
    obtenerCorrelativoParte(partesPendientes());
    setFormTipo('Maquinaria');
  };
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
    if (sujeto) cargarCosteosGuardados(sujeto.id);
  };
  const agregarRecurso = () => {
    let descFinal = nuevoRecurso.descripcion;
    let cantFinal = round4(parseFloat(nuevoRecurso.cantidad) || 0);
    if (nuevoRecurso.tipo === 'Maquinaria') {
      // Las horas salen de las actividades: sin ellas no hay nada que costear.
      if (actividades.length === 0) return Swal.fire({ icon: 'warning', title: 'Atención', text: 'Agrega al menos una actividad al parte.' });
      const totalHM = parseFloat(horasMaquina) || 0;
      // Lo que se exige es que el horómetro haya avanzado, no que haya horas
      // cobrables. Un parte entero de horas muertas —la máquina encendida que
      // no pudo trabajar— es un parte válido y hay que registrarlo: el
      // horómetro corrió, el combustible se gastó y queda escrito por qué no
      // se cobra. Cada línea reducida ya exige su motivo al agregarse.
      if (tramoDeLista(actividades) <= 0) return Swal.fire({ icon: 'warning', title: 'Atención', text: 'Las actividades del parte no suman horas. Revisa sus horómetros.' });
      if (!nuevoRecurso.numeroParte) return Swal.fire({ icon: 'warning', title: 'Atención', text: 'El Número de Parte es obligatorio' });
      if (!nuevoRecurso.proveedor || !nuevoRecurso.proveedor.trim()) return Swal.fire({ icon: 'warning', title: 'Atención', text: 'El Proveedor es obligatorio' });
      if (!nuevoRecurso.equipo) return Swal.fire({ icon: 'warning', title: 'Atención', text: 'Selecciona un equipo' });
      // El correlativo tiene que ser único: si se repite, al guardar quedarían
      // dos partes distintos con el mismo N° y no se podrían diferenciar.
      const repetido = recursos.some(r => r.tipo === 'Maquinaria' && !r.esBorrador &&
        (r.numeroParte || '').trim() === (nuevoRecurso.numeroParte || '').trim());
      if (repetido) return Swal.fire({
        icon: 'warning', title: 'N° de Parte repetido',
        text: `Ya hay un parte ${nuevoRecurso.numeroParte} en esta incidencia. Cámbialo antes de agregarlo.`,
      });
      // Lo que se cobra: la suma de las horas efectivas de cada actividad.
      // Cada línea ya validó su reducción y su motivo al agregarse a la hoja.
      cantFinal = round4(totalHM);
      const equipoFinal = nuevoRecurso.equipo;
      const marcaFinal = nuevoRecurso.marca;
      // Detalle corto: solo código · equipo marca modelo. El resto va en el PDF del parte.
      descFinal = [nuevoRecurso.codigoMaquina, '·', equipoFinal, marcaFinal, nuevoRecurso.modeloMaquina || '']
        .filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    } else if (nuevoRecurso.tipo === 'Personal') {
      const pers = parseInt(nuevoRecurso.numPersonas) || 0;
      const hrs = parseFloat(nuevoRecurso.horasTrabajo) || 0;
      const ext = parseFloat(nuevoRecurso.horasExtras) || 0;
      cantFinal = round4(pers * (hrs + ext));
      if (!nuevoRecurso.fechaRecurso) return Swal.fire({ icon: 'warning', title: 'Atención', text: 'Indica la fecha del trabajo' });
      if (!descFinal) return Swal.fire({ icon: 'warning', title: 'Atención', text: 'Ingresa el cargo (Ej. Peón)' });
      if (cantFinal <= 0) return Swal.fire({ icon: 'warning', title: 'Atención', text: 'Ingresa la cantidad de personas y horas' });
      descFinal = `${nuevoRecurso.descripcion}\n(Cuadrilla: ${pers} persona(s) x ${hrs}h normales + ${ext}h extras)`;
    } else {
      if (!nuevoRecurso.fechaRecurso) return Swal.fire({ icon: 'warning', title: 'Atención', text: 'Indica la fecha de uso del insumo' });
      if (!descFinal) return Swal.fire({ icon: 'warning', title: 'Atención', text: 'Ingresa una descripción' });
    }
    // El parte viaja con sus actividades: de ahí salen la lista, el resumen de
    // cabecera y el JSON que se manda al backend al guardar.
    const res = nuevoRecurso.tipo === 'Maquinaria'
      ? resumenActividades(actividades)
      : { texto: '', metrado: 0, unidad: 'm3', calculado: false };
    const recursoCalculado = { ...nuevoRecurso, idLocal: Date.now(), descripcionResumen: descFinal, cantidad: cantFinal, precioUnitario: parseFloat(nuevoRecurso.precioUnitario) || 0, total: round2(cantFinal * (parseFloat(nuevoRecurso.precioUnitario) || 0)), guardadoEnDB: false,
      ...(nuevoRecurso.tipo === 'Maquinaria' ? {
        actividadesLista: [...actividades],
        hmInicio: rangoHorometro(actividades).inicio,
        hmFin: rangoHorometro(actividades).fin,
        horasEfectivas: String(horasDeLista(actividades)),
        obsReduccion: resumenReduccion(actividades),
        actividad: res.texto, actividadOtros: '',
        metradoManual: String(res.metrado), unidadMetrado: res.unidad, calcularMetrado: false,
      } : {}) };
    setRecursos([...recursos, recursoCalculado]);
    setNuevoRecurso({...estadoInicialRecurso, numeroParte: generarCorrelativo()});
    setActividades([]);
    // +1: el que se acaba de agregar todavía no está en `recursos` aquí.
    obtenerCorrelativoParte(partesPendientes() + 1);
    cerrarFormulario();   // cierra el modal y limpia el modo edición
  };
  const editarEntrada = (entrada, grupo) => {
    if (bloqueado) {
      Swal.fire('Incidencia cerrada', 'Reábrela para poder editar.', 'info');
      return;
    }
    const base = {
      ...estadoInicialRecurso,
      tipo: grupo.tipo,
      fechaRecurso: entrada.fechaRecurso || '',
      precioUnitario: entrada.precioUnitario ?? 0,
    };
    if (grupo.tipo === 'Personal') {
      setNuevoRecurso({
        ...base,
        descripcion: (grupo.descripcion || '').split('\n')[0].trim(),
        origen: grupo.origen || 'JURP',
        numPersonas: entrada.numPersonas ?? 1,
        horasTrabajo: entrada.horasTrabajo ?? 0,
        horasExtras: entrada.horasExtras ?? 0,
      });
    } else {
      setNuevoRecurso({
        ...base,
        descripcion: (grupo.descripcionResumen || grupo.descripcion || '').trim(),
        unidad: entrada.unidad || grupo.unidad || 'und',
        cantidad: entrada.cantidad ?? 0,
      });
    }
    setEditando({
      dbId: entrada.dbId, endpoint: entrada.endpoint,
      idLocal: entrada.idLocal, guardadoEnDB: entrada.guardadoEnDB, tipo: grupo.tipo,
    });
    setFormTipo(grupo.tipo);
  };
  const editarParte = (reg) => {
    if (bloqueado) {
      Swal.fire('Incidencia cerrada', 'Reábrela para poder editar.', 'info');
      return;
    }
    const totalHM = Math.max(0, (parseFloat(reg.hmFin) || 0) - (parseFloat(reg.hmInicio) || 0));
    setNuevoRecurso({
      ...estadoInicialRecurso,
      ...reg,
      tipo: 'Maquinaria',
      fechaParte: (reg.fechaParte || '').slice(0, 10) || getFechaHoy(),
      // La cantidad guardada son las horas efectivas: se recupera para no
      // perder la reducción al volver a guardar.
      horasEfectivas: reg.cantidad != null && reg.cantidad !== totalHM ? String(reg.cantidad) : '',
      obsReduccion: reg.obsReduccion || '',
    });
    // La hoja de actividades se llena con las del parte que se está editando.
    setActividades(reg.actividadesLista ? [...reg.actividadesLista] : []);
    setEditando({
      dbId: reg.dbId, endpoint: reg.endpoint,
      idLocal: reg.idLocal, guardadoEnDB: reg.guardadoEnDB, tipo: 'Maquinaria',
    });
    setModalPartes(null);
    setFormTipo('Maquinaria');
  };
  const cerrarFormulario = () => {
    setFormTipo(null); setEditando(null);
    setModalActividad(false); setActEditando(null); setActividades([]);
  };
  const guardarEdicion = async () => {
    const r = nuevoRecurso;
    if (!editando) return;

    // ── validaciones, las mismas del alta ──
    if (editando.tipo === 'Personal') {
      if (!r.fechaRecurso) return Swal.fire({ icon: 'warning', title: 'Atención', text: 'Indica la fecha del trabajo' });
      if (!r.descripcion) return Swal.fire({ icon: 'warning', title: 'Atención', text: 'Ingresa el cargo' });
      if (round4((parseInt(r.numPersonas) || 0) * ((parseFloat(r.horasTrabajo) || 0) + (parseFloat(r.horasExtras) || 0))) <= 0)
        return Swal.fire({ icon: 'warning', title: 'Atención', text: 'Ingresa personas y horas' });
    } else if (editando.tipo === 'Insumo') {
      if (!r.fechaRecurso) return Swal.fire({ icon: 'warning', title: 'Atención', text: 'Indica la fecha de uso' });
      if (!r.descripcion) return Swal.fire({ icon: 'warning', title: 'Atención', text: 'Ingresa una descripción' });
    } else {
      if (actividades.length === 0) return Swal.fire({ icon: 'warning', title: 'Atención', text: 'El parte debe tener al menos una actividad.' });
      // Igual que al crearlo: basta con que el horómetro haya avanzado. Un
      // parte de puras horas muertas se cobra en cero pero existe.
      if (tramoDeLista(actividades) <= 0) return Swal.fire({ icon: 'warning', title: 'Atención', text: 'Las actividades del parte no suman horas. Revisa sus horómetros.' });
      if (!r.proveedor?.trim()) return Swal.fire({ icon: 'warning', title: 'Atención', text: 'El Proveedor es obligatorio' });
    }

    // ── registro aún no guardado: se corrige en memoria ──
    if (!editando.guardadoEnDB || !editando.dbId) {
      setRecursos(prev => prev.map(x => {
        if (x.idLocal !== editando.idLocal) return x;
        if (editando.tipo === 'Personal') {
          const pers = parseInt(r.numPersonas) || 0;
          const hrs = parseFloat(r.horasTrabajo) || 0;
          const ext = parseFloat(r.horasExtras) || 0;
          const cant = round4(pers * (hrs + ext));
          return { ...x, ...r, cantidad: cant,
            descripcionResumen: `${r.descripcion}\n(Cuadrilla: ${pers} persona(s) x ${hrs}h normales + ${ext}h extras)`,
            total: round2(cant * (parseFloat(r.precioUnitario) || 0)) };
        }
        if (editando.tipo === 'Insumo') {
          const cant = round4(parseFloat(r.cantidad) || 0);
          return { ...x, ...r, cantidad: cant, descripcionResumen: r.descripcion,
            total: round2(cant * (parseFloat(r.precioUnitario) || 0)) };
        }
        const efec = round4(parseFloat(horasMaquina) || 0);
        const res = resumenActividades(actividades);
        const rg = rangoHorometro(actividades);
        return { ...x, ...r, cantidad: efec, total: round2(efec * (parseFloat(r.precioUnitario) || 0)),
          actividadesLista: [...actividades], hmInicio: rg.inicio, hmFin: rg.fin,
          horasEfectivas: String(efec), obsReduccion: resumenReduccion(actividades),
          actividad: res.texto, actividadOtros: '',
          metradoManual: String(res.metrado), unidadMetrado: res.unidad, calcularMetrado: false };
      }));
      cerrarFormulario();
      Swal.fire({ icon: 'success', title: 'Actualizado', timer: 1100, showConfirmButton: false });
      return;
    }

    // ── registro en la BD: PATCH ──
    setGuardando(true);
    const fd = new FormData();
    try {
      if (editando.tipo === 'Personal') {
        const pers = parseInt(r.numPersonas) || 0;
        const hrs = parseFloat(r.horasTrabajo) || 0;
        const ext = parseFloat(r.horasExtras) || 0;
        fd.append('date', r.fechaRecurso);
        fd.append('description', `${r.descripcion}\n(Cuadrilla: ${pers} persona(s) x ${hrs}h normales + ${ext}h extras)`);
        fd.append('quantity_hours', round4(pers * (hrs + ext)));
        fd.append('unit_price', parseFloat(r.precioUnitario) || 0);
        fd.append('num_personas', pers);
        fd.append('horas_normales', hrs);
        fd.append('horas_extras', ext);
        fd.append('origin', r.origen || 'JURP');
      } else if (editando.tipo === 'Insumo') {
        fd.append('date', r.fechaRecurso);
        fd.append('description', r.descripcion);
        fd.append('quantity', round4(parseFloat(r.cantidad) || 0));
        fd.append('unit_price', parseFloat(r.precioUnitario) || 0);
        fd.append('unit', r.unidad || 'und');
      } else {
        fd.append('date', /^\d{4}-\d{2}-\d{2}$/.test(r.fechaParte) ? r.fechaParte : getFechaHoy());
        fd.append('shift', r.turno);
        fd.append('work_zone_text', r.zonaTrabajo || '');
        fd.append('provider', r.proveedor);
        fd.append('operator', r.operador || '');
        fd.append('licencia', r.licencia || '');
        fd.append('categoria', r.categoria || '');
        const rgHM = rangoHorometro(actividades);
        fd.append('start_horometer', rgHM.inicio === '' ? 0 : rgHM.inicio);
        fd.append('end_horometer', rgHM.fin === '' ? 0 : rgHM.fin);
        fd.append('horas_efectivas', horasDeLista(actividades));
        fd.append('obs_reduccion', resumenReduccion(actividades));
        fd.append('fuel_gallons', parseFloat(r.combustible) || 0);
        fd.append('fuel_voucher', r.vale || '');
        const res = resumenActividades(actividades);
        fd.append('activities', res.texto || textoActividad(r));
        fd.append('observations', r.observaciones || '');
        fd.append('unit_price', parseFloat(r.precioUnitario) || 0);
        fd.append('actividades_json', JSON.stringify(actividadesParaBackend(actividades)));
        if (actividades.length) {
          // Medidas de cabecera: las de la primera línea. Un campo vacío no se
          // manda: el backend espera un número y "" le da error de validación.
          const p = actividades[0];
          if (p.anchoSup !== '' && p.anchoSup != null) fd.append('width_top', p.anchoSup);
          if (p.anchoInf !== '' && p.anchoInf != null) fd.append('width_bottom', p.anchoInf);
          if (p.altura !== '' && p.altura != null) fd.append('height', p.altura);
          if (p.longitud !== '' && p.longitud != null) fd.append('length', p.longitud);
          fd.append('metrado', Number(res.metrado).toFixed(4));
          fd.append('metrado_unidad', res.unidad);
          fd.append('metrado_calculado', res.calculado ? 'true' : 'false');
        }
      }

      const res = await fetch(`${API_OPS}/${editando.endpoint}/${editando.dbId}/`, { method: 'PATCH', body: fd });
      if (!res.ok) {
        let detalle = '';
        try { detalle = JSON.stringify(await res.json()); } catch (e) { detalle = `código ${res.status}`; }
        throw new Error(detalle);
      }
      cerrarFormulario();
      if (sujeto) cargarCosteosGuardados(sujeto.id);
      Swal.fire({ icon: 'success', title: 'Cambios guardados', timer: 1400, showConfirmButton: false });
    } catch (e) {
      Swal.fire('Error al actualizar', e.message || 'No se pudo guardar el cambio.', 'error');
    } finally { setGuardando(false); }
  };
  const eliminarRecursosLocales = (idsLocales) => setRecursos(recursos.filter(r => !idsLocales.includes(r.idLocal)));
  const eliminarEntradaInsumo = async (entrada) => {
    if (bloqueado) { Swal.fire('Incidencia cerrada', 'Reábrela para poder editar.', 'info'); return; }
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
        if (sujeto) cargarCosteosGuardados(sujeto.id);
        Swal.fire({ icon: 'success', title: 'Eliminado', timer: 1000, showConfirmButton: false });
      } else {
        Swal.fire('Error', `No se pudo eliminar (código ${r.status}).`, 'error');
      }
    } catch (e) {
      Swal.fire('Error', 'Fallo de conexión al eliminar.', 'error');
    }
  };
  const recursosEnRango = recursos.filter(r => {
    const f = fechaDe(r);
    if (!f) return true;
    const soloFecha = String(f).slice(0, 10);
    if (rangoDesde && soloFecha < rangoDesde) return false;
    if (rangoHasta && soloFecha > rangoHasta) return false;
    return true;
  });
  const hayRango = !!(rangoDesde || rangoHasta);
  const ocultosPorRango = recursos.length - recursosEnRango.length;
  const costoTotalIncidente = round2(recursosEnRango.reduce((sum, item) => sum + item.total, 0));
  const recursosAgrupados = (() => {
    const grupos = new Map();
    // Código de máquina desde el detalle (ej. "JURP002 · ...") o del campo.
    const codigoDe = (r) => ((r.codigoMaquina || (r.descripcionResumen || '').split('·')[0]).trim().split(' ')[0] || '').toUpperCase();
    for (const r of recursosEnRango) {
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
      g.cantidadTotal = round4(g.cantidadTotal + r.cantidad);
      g.totalSum = round2(g.totalSum + r.total);
      g.count += 1;
      if (r.guardadoEnDB && r.dbId) g.registros.push({ dbId: r.dbId, endpoint: r.endpoint });
      if (r.tipo === 'Maquinaria') {
        if (!r.cerrado) g.tieneParteAbierto = true;
        g.partesMaq.push({ dbId: r.dbId, idLocal: r.idLocal, cerrado: r.cerrado, guardadoEnDB: r.guardadoEnDB, endpoint: r.endpoint, numeroParte: r.numeroParte || '', registro: r });
      }
      if (r.tipo === 'Insumo') {
        g.entradas.push({ idLocal: r.idLocal, dbId: r.dbId, guardadoEnDB: r.guardadoEnDB, endpoint: r.endpoint, cantidad: r.cantidad, precioUnitario: r.precioUnitario, total: r.total, unidad: r.unidad || 'und', fechaRecurso: r.fechaRecurso });
      }
      if (r.tipo === 'Personal') {
        g.entradas.push({ idLocal: r.idLocal, dbId: r.dbId, guardadoEnDB: r.guardadoEnDB, endpoint: r.endpoint, cantidad: r.cantidad, precioUnitario: r.precioUnitario, total: r.total, numPersonas: r.numPersonas, horasTrabajo: r.horasTrabajo, horasExtras: r.horasExtras, fechaRecurso: r.fechaRecurso });
      }
    }
    // Dentro de cada grupo, las entradas se ordenan por fecha del trabajo.
    // Sin fecha (registros anteriores al campo) van al final.
    for (const g of grupos.values()) {
      g.entradas.sort((a, b) => (b.fechaRecurso || '').localeCompare(a.fechaRecurso || ''));
    }

    // Y los grupos entre sí: mano de obra e insumos por nombre (cargo o
    // descripción), maquinaria por código de máquina. Así la lista sale
    // siempre en el mismo orden y no según cómo se fueron cargando.
    const nombreDe = (g) => (
      g.tipo === 'Maquinaria' ? (g.codigoMaquina || g.descripcionResumen || '')
      : g.tipo === 'Personal' ? (g.descripcion || g.descripcionResumen || '')
      : (g.descripcionResumen || g.descripcion || '')
    ).split('\n')[0].trim();

    return Array.from(grupos.values()).sort((a, b) =>
      nombreDe(a).localeCompare(nombreDe(b), 'es', { sensitivity: 'base' })
    );
  })();
  const subtotalCategoria = (tipo) => round2(recursosAgrupados
    .filter(r => r.tipo === tipo)
    .reduce((s, r) => s + r.totalSum, 0));
  const exportarPDF = async () => {
    if (!sujeto) return;
    const doc = new jsPDF();
    const inc = sujeto;
    const estadoTexto = txtEstadoInc(inc.estado);
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
                fmtCant(r.cantidadTotal),
                r.tipo === 'Personal' ? 'HH' : r.tipo === 'Maquinaria' ? 'HE' : (r.unidad || 'und'),
                fmtCant(r.precioUnitario),
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
        showFoot: 'lastPage',   // el total va solo al final, no en cada página
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
    if (!sujeto) return;
    const inc = sujeto;
    const estadoTexto = txtEstadoInc(inc.estado);
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
          if (j === 2 || j === 4) cell.numFmt = '#,##0.00##';   // cantidad y P. Unit: hasta 4 decimales
          if (j === 5) cell.numFmt = '#,##0.00';                 // importe: siempre 2
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
        // El unico sitio donde se escribe de que cuelga la linea.
        formData.append(campoVinculo, sujeto.id);
        if (r.tipo === 'Personal') {
          endpoint = `${BASE_URL}/api/v1/mobile/operations/incident-personnels/`;
          if (r.fechaRecurso) formData.append('date', r.fechaRecurso);
          formData.append('description', r.descripcionResumen || r.descripcion); 
          formData.append('quantity_hours', r.cantidad);
          formData.append('unit_price', r.precioUnitario);
          formData.append('num_personas', parseInt(r.numPersonas)||0);
          formData.append('horas_normales', parseFloat(r.horasTrabajo)||0);
          formData.append('horas_extras', parseFloat(r.horasExtras)||0);
          formData.append('origin', r.origen || 'JURP');
        } else if (r.tipo === 'Insumo') {
          endpoint = `${BASE_URL}/api/v1/mobile/operations/incident-materials/`;
          if (r.fechaRecurso) formData.append('date', r.fechaRecurso);
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
          // Identidad exacta de la máquina: evita confundir unidades con la
          // misma marca y modelo cuando ninguna tiene placa.
          if (r.modeloId) formData.append('maquina', r.modeloId);
          formData.append('equipment_name', r.equipo);
          formData.append('brand_name', r.marca);
          formData.append('model_plate', r.placa ? `${r.modeloMaquina || ''} / ${r.placa}`.trim() : (r.modeloMaquina || ''));
          // La cabecera guarda el rango del día (primer inicio, último fin).
          // Las horas que se cobran son la suma de los tramos, no este rango.
          const rgHM = rangoHorometro(r.actividadesLista || []);
          formData.append('start_horometer', rgHM.inicio === '' ? 0 : rgHM.inicio);
          formData.append('end_horometer', rgHM.fin === '' ? 0 : rgHM.fin);
          formData.append('horas_efectivas', horasDeLista(r.actividadesLista || []));
          formData.append('obs_reduccion', resumenReduccion(r.actividadesLista || []));
          formData.append('fuel_gallons', parseFloat(r.combustible) || 0);
          formData.append('fuel_voucher', r.vale);
          // Cabecera: el texto de todas las actividades y el metrado resumido.
          // El detalle real viaja en actividades_json.
          const lineas = r.actividadesLista || [];
          const res = resumenActividades(lineas);
          formData.append('activities', res.texto || textoActividad(r));
          formData.append('observations', r.observaciones); formData.append('unit_price', r.precioUnitario);
          if (r.fotoParte) formData.append('part_photo', r.fotoParte);
          if (r.fotoVale) formData.append('voucher_photo', r.fotoVale);
          // El parte va como multipart (lleva fotos), así que la lista viaja
          // como texto JSON en un solo campo.
          formData.append('actividades_json', JSON.stringify(actividadesParaBackend(lineas)));
          if (lineas.length) {
            // Medidas de cabecera: las de la primera línea, para que los partes
            // de una sola actividad sigan viéndose igual que siempre.
            const p = lineas[0];
            if (p.anchoSup !== '' && p.anchoSup != null) formData.append('width_top', p.anchoSup);
            if (p.anchoInf !== '' && p.anchoInf != null) formData.append('width_bottom', p.anchoInf);
            if (p.altura !== '' && p.altura != null) formData.append('height', p.altura);
            if (p.longitud !== '' && p.longitud != null) formData.append('length', p.longitud);
            formData.append('metrado', Number(res.metrado).toFixed(4));
            formData.append('metrado_unidad', res.unidad);
            formData.append('metrado_calculado', res.calculado ? 'true' : 'false');
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
      setRecursos([]); onCerrar(); 
    } catch (error) {
      console.error(error);
      Swal.fire({ icon: 'error', title: 'Error al guardar', text: error.message || 'Hubo un error al guardar en la base de datos.' });
    } finally { setGuardando(false); }
  };
  const renderCamposMetrado = () => {
    const act = actForm.actividad;
    const set = (campo, val) => setActForm({...actForm, [campo]: val});
    const activo = !!actForm.calcularMetrado;
    const inp = (campo, label, step=STEP4) => (
      <div className="tbl-col"><label className="tbl-form-label" style={{ color: activo ? undefined : '#94a3b8' }}>{label}</label><input type="number" step={step} className="tbl-form-control" placeholder="0.00" value={actForm[campo]} disabled={!activo} onChange={e => set(campo, e.target.value)} style={{ background: activo ? undefined : '#f1f5f9', cursor: activo ? undefined : 'not-allowed' }} /></div>
    );
    if (act === 'EXCAVACION DE MATERIAL' || act === 'ENROCADO')
      return <>{inp('anchoBase','Base B (m)')}{inp('corona','Corona b (m)')}{inp('altura','Altura h (m)')}{inp('longitud','Longitud L (m)')}</>;
    if (act === 'CARGUIO DE MATERIAL')
      return <>{inp('nViajes','N° Viajes','1')}{inp('volTolva','Vol. Tolva (m³)')}{inp('fe','Fe (esponj.)')}</>;
    if (act === 'DESCOLMATACION DE CAUCE')
      return <>{inp('anchoSup','Ancho a (m)')}{inp('hPromedio','h promedio (m)')}{inp('longitud','Longitud L (m)')}</>;
    if (act === 'ELIMINACION')
      return <>{inp('nViajes','N° Viajes','1')}{inp('volTolva','Vol. Tolva (m³)')}</>;
    if (act === 'CONFORMACION DE DIQUE')
      return <>{inp('corona','Corona b (m)')}{inp('altura','Altura h (m)')}{inp('talud','Talud Z (H:V)')}{inp('longitud','Longitud L (m)')}</>;
    if (act === 'PERFILADO DE TALUD')
      return <>{inp('altura','Altura h (m)')}{inp('talud','Talud Z (H:V)')}{inp('longitud','Longitud L (m)')}</>;
    if (act === 'HABILITACION DE ACCESO')
      return <div className="tbl-col-4">{inp('longitud','Longitud L (m)')}</div>;
    return null;
  };

  return (<>
      {/* ── MODAL PRINCIPAL (GESTIÓN) — solo cierra con botón Cerrar ─────── */}
      {abierto && sujeto && (
        <Portal><div className="tbl-modal-backdrop">
          <div className="tbl-modal-dialog" onClick={e => e.stopPropagation()} style={{maxWidth: '1240px', width: '95vw'}}>
            <div className="tbl-modal-content">
              <div className="tbl-modal-header">
                <h5 className="tbl-modal-title">Gestión · {titulo}</h5>
                <button className="tbl-btn-close" onClick={onCerrar}><FaTimes/></button>
              </div>
              <div className="tbl-modal-body">
                <div className="tbl-alert tbl-alert-info">
                  <div style={{ fontSize:'11px', fontWeight:700, color:'#1463A5', marginBottom:'4px', letterSpacing:'0.3px' }}>{titulo}</div>
                  <h4 className="tbl-alert-title">{subtitulo}</h4>
                  <div className="tbl-text-muted">{detalle}</div>
                </div>
                {/* Rango de fechas: acota el costeo a un periodo concreto.
                    Útil para el informe semanal o de quincena. */}
                <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap', margin:'12px 0 4px', padding:'10px 12px', background:'#f8fafc', border:'1px solid #e2e8f0', borderRadius:8 }}>
                  <span style={{ fontSize:12, fontWeight:600, color:'#64748b', display:'flex', alignItems:'center', gap:6 }}>
                    <FaCalendarAlt size={12} /> Periodo:
                  </span>
                  <input type="date" value={rangoDesde} onChange={e => setRangoDesde(e.target.value)}
                    style={{ padding:'6px 9px', border:'1px solid #cbd5e1', borderRadius:6, fontSize:12, color:'#334155' }} />
                  <span style={{ fontSize:12, color:'#94a3b8' }}>a</span>
                  <input type="date" value={rangoHasta} onChange={e => setRangoHasta(e.target.value)}
                    style={{ padding:'6px 9px', border:'1px solid #cbd5e1', borderRadius:6, fontSize:12, color:'#334155' }} />
                  {hayRango && (
                    <>
                      <button onClick={() => { setRangoDesde(''); setRangoHasta(''); }}
                        style={{ display:'flex', alignItems:'center', gap:5, background:'#fff', border:'1px solid #cbd5e1', color:'#64748b', borderRadius:6, padding:'6px 11px', fontSize:12, fontWeight:600, cursor:'pointer' }}>
                        <FaTimes size={10} /> Ver todo
                      </button>
                      <span style={{ fontSize:11.5, color:'#b45309', background:'#fffbeb', border:'1px solid #fde68a', borderRadius:6, padding:'5px 10px' }}>
                        {ocultosPorRango > 0
                          ? `${ocultosPorRango} registro(s) fuera del periodo — el costo mostrado es solo del rango`
                          : 'Todos los registros están dentro del periodo'}
                      </span>
                    </>
                  )}
                </div>

                {/* La tabla agrupada va aquí abajo (sin formulario inline) */}

                <div className="tbl-table-responsive tbl-border-top">
                  <table className="tbl-table tbl-table-vcenter">
                    <thead><tr><th style={{width:'24px'}}></th><th>Detalle</th><th className="tbl-text-end">Cantidad</th><th className="tbl-text-end">P. Unit.</th><th className="tbl-text-end">Total</th><th></th></tr></thead>
                    <tbody>
                      {CATEGORIAS.map(cat => {
                          const filas = recursosAgrupados.filter(r => r.tipo === cat.key);
                          return (
                            <Fragment key={cat.key}>
                              {/* Cabecera de categoría con botón Añadir */}
                              <tr style={{ background:'#eef2f7' }}>
                                <td colSpan="5" style={{ padding:'7px 10px' }}>
                                  <span style={{ fontWeight:700, fontSize:'11px', letterSpacing:'0.6px', color:'#334155' }}>{cat.titulo}</span>
                                </td>
                                <td style={{ background:'#eef2f7', textAlign:'right', paddingRight:'10px' }}>
                                  {!bloqueado && (
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
                                          <span style={{ display:'inline-block', minWidth:46, fontWeight:700, color: e.fechaRecurso ? '#0284c7' : '#cbd5e1' }}>
                                            {fechaCorta(e.fechaRecurso)}
                                          </span>
                                          {r.tipo === 'Personal'
                                            ? `${e.numPersonas} pers × ${e.horasTrabajo}h${parseFloat(e.horasExtras) > 0 ? ` + ${e.horasExtras}h ext` : ''}`
                                            : `Entrada ${idx + 1}`}
                                        </td>
                                        <td className="tbl-text-end">{fmtCant(e.cantidad)} <span style={{fontSize:'10px', color:'#94a3b8'}}>{r.tipo === 'Personal' ? 'HH' : e.unidad}</span></td>
                                        <td className="tbl-text-end">S/ {fmtCant(e.precioUnitario)}</td>
                                        <td className="tbl-text-end" style={{ color:'#475569' }}>S/ {fmtNum(e.total)}</td>
                                        <td>
                                          {!bloqueado && (
                                            <div style={{ display:'flex', gap:5 }}>
                                              <button type="button" onClick={() => editarEntrada(e, r)} title="Editar esta entrada"
                                                style={{padding:'4px 8px', backgroundColor:'#e0f2fe', color:'#0284c7', borderRadius:'4px', border:'none', cursor:'pointer', display:'inline-flex'}}><FaPen size={12} /></button>
                                              <button type="button" onClick={() => (e.guardadoEnDB && e.dbId) ? eliminarEntradaInsumo(e) : eliminarRecursosLocales([e.idLocal])} className="tbl-btn-action text-danger" title="Eliminar esta entrada" style={{padding:'4px 8px', backgroundColor:'#fee2e2', borderRadius:'4px', border:'none', cursor:'pointer', display:'inline-flex'}}><FaTrash size={13} /></button>
                                            </div>
                                          )}
                                        </td>
                                      </tr>
                                    ))}
                                    <tr style={{ background:'#f1f5f9', borderBottom:'2px solid #e2e8f0' }}>
                                      <td></td>
                                      <td style={{ fontSize:'11px', fontWeight:700, color:'#334155', textAlign:'right' }}>Total {(r.descripcion || r.descripcionResumen || '').split('\n')[0]}</td>
                                      <td className="tbl-text-end" style={{ fontWeight:700, color:'#334155' }}>{fmtCant(r.cantidadTotal)} <span style={{fontSize:'10px', color:'#626976'}}>{r.tipo === 'Personal' ? 'HH' : (r.unidad||'und')}</span></td>
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
                                    {(r.tipo === 'Personal' || r.tipo === 'Insumo') && (
                                      <span style={{ marginRight:7, fontSize:10.5, fontWeight:700, padding:'2px 7px', borderRadius:4, background: r.fechaRecurso ? '#e0f2fe' : '#f1f5f9', color: r.fechaRecurso ? '#0284c7' : '#94a3b8' }}>
                                        {fechaCorta(r.fechaRecurso)}
                                      </span>
                                    )}
                                    {r.tipo === 'Personal' && r.count > 1
                                      ? (r.descripcion ? `${r.descripcion} (Cuadrilla: ${r.numPersonas} persona(s) x ${r.horasTrabajo}h normales + ${r.horasExtras}h extras)` : (r.descripcionResumen || ''))
                                      : (r.descripcionResumen || r.descripcion)}
                                    {r.count > 1 && <span style={{marginLeft:'6px', backgroundColor:'#e0f2fe', color:'#0284c7', fontWeight:'bold', fontSize:'10px', padding:'1px 6px', borderRadius:'10px'}}>×{r.count}</span>}
                                  </td>
                                  <td className="tbl-text-end font-bold">{fmtCant(r.cantidadTotal)} <span style={{fontSize: '10px', marginLeft: '4px', color: '#626976'}}>{r.tipo === 'Personal' ? 'HH' : r.tipo === 'Maquinaria' ? 'HE' : (r.unidad||'und')}</span></td>
                                  <td className="tbl-text-end">S/ {fmtCant(r.tipo === 'Insumo' && r.cantidadTotal > 0 ? (r.totalSum / r.cantidadTotal) : r.precioUnitario)}</td>
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
                                        {!bloqueado && r.count === 1 && r.entradas?.length === 1 && (
                                          <button type="button" onClick={() => editarEntrada(r.entradas[0], r)} title="Editar este registro"
                                            style={{padding:'4px 8px', backgroundColor:'#e0f2fe', color:'#0284c7', borderRadius:'4px', border:'none', cursor:'pointer', display:'inline-flex'}}><FaPen size={13} /></button>
                                        )}
                                        {!bloqueado && (
                                          <button type="button" onClick={() => eliminarRecursoGuardado(r)} className="tbl-btn-action text-danger" title={r.count > 1 ? `Eliminar los ${r.count} registros` : 'Eliminar de la base'} style={{padding: '4px 8px', backgroundColor: '#fee2e2', borderRadius: '4px', border: 'none', cursor: 'pointer', display: 'inline-flex'}}><FaTrash size={14} /></button>
                                        )}
                                      </div>
                                    ) : (bloqueado ? null : (
                                      // Registro aún sin guardar: también se
                                      // puede corregir, no solo descartar.
                                      <div style={{display:'flex', gap:'6px', alignItems:'center'}}>
                                        {(r.tipo === 'Personal' || r.tipo === 'Insumo') && r.entradas?.length === 1 && (
                                          <button type="button" onClick={() => editarEntrada(r.entradas[0], r)} title="Editar este registro"
                                            style={{padding:'4px 8px', backgroundColor:'#e0f2fe', color:'#0284c7', borderRadius:'4px', border:'none', cursor:'pointer', display:'inline-flex'}}><FaPen size={13} /></button>
                                        )}
                                        <button className="tbl-btn-action text-danger" onClick={() => eliminarRecursosLocales(r.idsLocales)} title="Eliminar"><FaTimes/></button>
                                      </div>
                                    ))}
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
                  {!bloqueado && (
                    <button className="tbl-btn tbl-btn-primary" onClick={guardarCosteos} disabled={guardando}>{guardando ? <><FaSyncAlt className="icon-spin" style={{marginRight: '8px'}} /> Guardando...</> : <><FaSave style={{marginRight: '8px'}} /> Guardar Costeos</>}</button>
                  )}

                  {/* Cerrar incidencia / Reabrir */}
                  {/* Cerrar y reabrir son del que llama: una incidencia se
                      cierra liberando maquinas, y una actividad se termina,
                      que no es lo mismo. Si no se pasan, no se dibujan. */}
                  {bloqueado ? (
                    <>
                      <span style={{background:'#dcfce7',color:'#15803d',padding:'6px 14px',borderRadius:'4px',fontSize:'13px',fontWeight:'600',display:'flex',alignItems:'center',gap:'6px'}}><FaCheckCircle/> {textoCerrado}</span>
                      {onReabrir && (
                        <button className="tbl-btn" onClick={reabrir} style={{background:'#fff',color:'#206bc4',border:'1px solid #206bc4',padding:'6px 14px',borderRadius:'4px',cursor:'pointer',fontSize:'13px',display:'flex',alignItems:'center',gap:'6px'}} title="Reabrir para volver a editar"><FaSyncAlt/> Reabrir</button>
                      )}
                    </>
                  ) : onCerrarSujeto ? (
                    <button className="tbl-btn" onClick={cerrar} style={{background:'#2fb344',color:'#fff',border:'none',padding:'6px 14px',borderRadius:'4px',cursor:'pointer',fontSize:'13px',display:'flex',alignItems:'center',gap:'6px'}} title={tituloCerrar}><FaCheckCircle/> {textoCerrar}</button>
                  ) : null}

                  {/* Cerrar (última) */}
                  <button className="tbl-btn tbl-btn-link" onClick={onCerrar}>Cerrar</button>
                </div>
              </div>
            </div>
          </div>
        </div></Portal>
      )}
      {/* ── Modal PASO 1: Selector de máquina ───────────────────────────── */}
      {selectorMaquina && (
        <Portal><div className="tbl-modal-backdrop" style={{ zIndex: 10001 }}>
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
        </div></Portal>
      )}

      {/* ── Modal: Añadir recurso (Mano de obra / Equipo / Insumo) ──────── */}
      {formTipo && (
        <Portal><div className="tbl-modal-backdrop" style={{ zIndex: 10001 }}>
          <div className="tbl-modal-dialog" onClick={e => e.stopPropagation()} style={{ maxWidth: formTipo === 'Maquinaria' ? '900px' : '760px' }}>
            <div className="tbl-modal-content">
              <div className="tbl-modal-header">
                <h5 className="tbl-modal-title">
                  {editando
                    ? (formTipo === 'Personal' ? '✏️ Editar Mano de Obra' : formTipo === 'Maquinaria' ? '✏️ Editar Parte Diario' : '✏️ Editar Insumo / Material')
                    : (formTipo === 'Personal' ? '👷 Añadir Mano de Obra' : formTipo === 'Maquinaria' ? '🚜 Parte Diario de Maquinaria' : '📦 Añadir Insumo / Material')}
                </h5>
                <button className="tbl-btn-close" onClick={cerrarFormulario}><FaTimes/></button>
              </div>
              <div className="tbl-modal-body">
                {nuevoRecurso.tipo === 'Maquinaria' ? (
                  <div style={{ background: '#f8fafc', padding: '20px', borderRadius: '4px', border: '1px solid #e2e8f0', marginBottom: '15px' }}>
                    <div style={{ display:'flex', alignItems:'center', gap:'8px', marginBottom:'20px', color:'#206bc4', fontWeight:'bold', fontSize:'16px' }}><FaFileInvoice /> Formulario: Parte Diario de Maquinaria</div>
                    <div className="tbl-row tbl-mb-3">
                      <div className="tbl-col"><label className="tbl-form-label">N° de Parte {!editando && <span style={{color:'red'}}>*</span>}</label><input type="text" className="tbl-form-control" value={nuevoRecurso.numeroParte} disabled={!!editando} onChange={e => setNuevoRecurso({...nuevoRecurso, numeroParte: e.target.value})} style={{fontWeight: 'bold', backgroundColor: '#f1f5f9', cursor: editando ? 'not-allowed' : undefined}}/></div>
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
                      {!editando && (
                        <button type="button" onClick={() => { setFormTipo(null); cargarTodosModelos(); setBuscarMaquina(''); setSelectorMaquina(true); }}
                          style={{ background:'#fff', border:'1px solid #cbd5e1', color:'#206bc4', borderRadius:'6px', padding:'5px 12px', fontSize:'12px', fontWeight:600, cursor:'pointer', whiteSpace:'nowrap' }}>
                          Cambiar máquina
                        </button>
                      )}
                    </div>
                    <div className="tbl-row tbl-mb-3">
                      <div className="tbl-col-3"><label className="tbl-form-label">Precio Unit. (S/ HE)</label><input type="number" step={STEP4} className="tbl-form-control" value={nuevoRecurso.precioUnitario} onChange={e => setNuevoRecurso({...nuevoRecurso, precioUnitario: e.target.value})} /></div>
                    </div>
                    {/* ── ACTIVIDADES DEL PARTE ──────────────────────────────
                         Una máquina hace varias tareas en la misma jornada y el
                         formato impreso admite varias líneas. El horómetro (y con
                         él el costo) sigue siendo uno solo para todo el parte. */}
                    <div style={{ background:'#f0f6ff', border:'1px solid #bfdbfe', borderRadius:'6px', padding:'14px', marginBottom:'15px' }}>
                      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:'10px', marginBottom:'10px', flexWrap:'wrap' }}>
                        <div>
                          <div style={{ fontSize:'13px', fontWeight:700, color:'#1463A5' }}>
                            Actividades realizadas <span style={{color:'red'}}>*</span>
                          </div>
                          <div style={{ fontSize:'11px', color:'#64748b', marginTop:'2px' }}>
                            Agrega una línea por cada tarea, con su tramo de horómetro, sus horas efectivas y su metrado. El parte cobra la suma de las HE.
                          </div>
                        </div>
                        <div style={{ display:'flex', gap:'8px', alignItems:'center' }}>
                          {partidas.length > 0 && (
                            /* Puesto aquí a propósito: quien imputa el metrado es
                               quien tiene que poder ver cuánto queda de la partida
                               ANTES de cargarle más, no después en otra pantalla. */
                            <button type="button" onClick={() => { cargarPartidas(); setModalAvance(true); }}
                              style={{ display:'inline-flex', alignItems:'center', gap:'6px', background:'#fff', color:'#1463A5', border:'1px solid #bfdbfe', borderRadius:'6px', padding:'8px 12px', fontSize:'12.5px', fontWeight:600, cursor:'pointer', whiteSpace:'nowrap' }}>
                              <FaListUl size={11} /> Avance del presupuesto
                            </button>
                          )}
                          <button type="button" onClick={abrirNuevaActividad}
                            style={{ display:'inline-flex', alignItems:'center', gap:'6px', background:'#1463A5', color:'#fff', border:'none', borderRadius:'6px', padding:'8px 14px', fontSize:'13px', fontWeight:600, cursor:'pointer', whiteSpace:'nowrap' }}>
                            <FaPlus size={11} /> Agregar actividad
                          </button>
                        </div>
                      </div>

                      {/* Hoja resumen.

                           El contenedor desplaza en horizontal y la tabla tiene
                           un ancho minimo: son nueve columnas, cinco de ellas de
                           numeros que no pueden partirse. En pantalla ancha sobra
                           sitio y el scroll ni aparece; en una tableta estrecha la
                           tabla se desliza dentro de su caja en vez de reventar el
                           modal y dejar los botones fuera de la vista. */}
                      <div style={{ overflowX:'auto' }}>
                      <table style={{ width:'100%', minWidth:'760px', borderCollapse:'collapse', fontSize:'12.5px', background:'#fff', borderRadius:'5px', overflow:'hidden' }}>
                        <thead>
                          <tr style={{ background:'#e0f2fe' }}>
                            <th style={{ textAlign:'left', padding:'8px 10px', fontSize:'10.5px', color:'#0369a1', width:'34px' }}>#</th>
                            <th style={{ textAlign:'left', padding:'8px 10px', fontSize:'10.5px', color:'#0369a1' }}>ZONA</th>
                            <th style={{ textAlign:'left', padding:'8px 10px', fontSize:'10.5px', color:'#0369a1' }}>ACTIVIDAD</th>
                            <th style={{ textAlign:'right', padding:'8px 10px', fontSize:'10.5px', color:'#0369a1', whiteSpace:'nowrap' }}>METRADO</th>
                            <th style={{ textAlign:'right', padding:'8px 10px', fontSize:'10.5px', color:'#0369a1', whiteSpace:'nowrap' }}>HM INI · FIN</th>
                            <th style={{ textAlign:'right', padding:'8px 10px', fontSize:'10.5px', color:'#0369a1', whiteSpace:'nowrap' }}>TRAMO</th>
                            <th style={{ textAlign:'right', padding:'8px 10px', fontSize:'10.5px', color:'#b45309', whiteSpace:'nowrap' }}>H. MUERTAS</th>
                            <th style={{ textAlign:'right', padding:'8px 10px', fontSize:'10.5px', color:'#0369a1', whiteSpace:'nowrap' }}>HE</th>
                            <th style={{ textAlign:'right', padding:'8px 10px', fontSize:'10.5px', color:'#0369a1', width:'96px' }}></th>
                          </tr>
                        </thead>
                        <tbody>
                          {actividades.length === 0 ? (
                            <tr><td colSpan="9" style={{ padding:'16px 10px', textAlign:'center', color:'#94a3b8', fontStyle:'italic' }}>
                              Todavía no hay actividades. Usa "Agregar actividad".
                            </td></tr>
                          ) : actividades.map((a, i) => {
                            const mv = calcMetradoDe(a);
                            const muertas = muertasDeActividad(a);
                            // Las notas van en una linea aparte, a todo lo ancho.
                            //
                            // Antes colgaban de su celda. La de horas muertas
                            // ademas heredaba el white-space:nowrap de la celda,
                            // asi que una frase corriente -"no pudo realizar
                            // acomodo de roca"- no podia partirse y estiraba esa
                            // columna hasta 345px: medido, la tabla pedia 1001px
                            // donde solo hay 822, y se comia la columna HE y los
                            // botones de editar y quitar.
                            //
                            // Abajo caben enteras, se leen como frases y las
                            // columnas vuelven a medir lo que mide su numero.
                            const notas = [];
                            // La partida va en la línea de notas y no en una
                            // columna propia: son nueve columnas y el código
                            // más la descripción no caben sin volver a
                            // desbordar la tabla.
                            if (a.partidaCodigo) notas.push({ k:'par', color:'#0369a1', etq:'Partida:',
                              txt:`${a.partidaCodigo}${a.partidaDescripcion ? ' · ' + a.partidaDescripcion : ''}` });
                            if (a.observacion) notas.push({ k:'obs', color:'#94a3b8', etq:'', txt:a.observacion });
                            if (muertas > 0 && (a.obsReduccion || '').trim())
                              notas.push({ k:'red', color:'#b45309', etq:'H. muertas:', txt:a.obsReduccion });
                            return (
                              <Fragment key={i}>
                              <tr style={{ borderTop:'1px solid #f1f5f9' }}>
                                <td style={{ padding:'8px 10px', color:'#94a3b8', fontWeight:700 }}>{i + 1}</td>
                                <td style={{ padding:'8px 10px', color:'#475569' }}>{a.zonaTrabajo || '—'}</td>
                                <td style={{ padding:'8px 10px', color:'#1e293b', fontWeight:600 }}>
                                  {textoActividad(a) || '—'}
                                </td>
                                <td style={{ padding:'8px 10px', textAlign:'right', color:'#1463A5', fontWeight:700, whiteSpace:'nowrap' }}>
                                  {fmtCant(mv.val)} {mv.unit}
                                </td>
                                <td style={{ padding:'8px 10px', textAlign:'right', color:'#475569', whiteSpace:'nowrap' }}>
                                  {a.hmInicio === '' || a.hmFin === '' ? '—' : `${fmtCant(a.hmInicio)} · ${fmtCant(a.hmFin)}`}
                                </td>
                                <td style={{ padding:'8px 10px', textAlign:'right', color:'#64748b', whiteSpace:'nowrap' }}>
                                  {fmtCant(horasDeActividad(a))} h
                                </td>
                                <td style={{ padding:'8px 10px', textAlign:'right', whiteSpace:'nowrap', fontWeight: muertas > 0 ? 700 : 400, color: muertas > 0 ? '#b45309' : '#cbd5e1' }}>
                                  {muertas > 0 ? `${fmtCant(muertas)} h` : '—'}
                                </td>
                                <td style={{ padding:'8px 10px', textAlign:'right', fontWeight:700, whiteSpace:'nowrap', color:'#1463A5' }}>
                                  {fmtCant(heDeActividad(a))} h
                                </td>
                                <td style={{ padding:'8px 10px' }}>
                                  <div style={{ display:'flex', gap:'5px', justifyContent:'flex-end' }}>
                                    <button type="button" onClick={() => abrirEditarActividad(i)} title="Editar actividad"
                                      style={{ padding:'4px 8px', background:'#e0f2fe', color:'#0284c7', border:'none', borderRadius:'4px', cursor:'pointer', display:'inline-flex' }}><FaPen size={11} /></button>
                                    <button type="button" onClick={() => quitarActividad(i)} title="Quitar actividad"
                                      style={{ padding:'4px 8px', background:'#fee2e2', color:'#dc2626', border:'none', borderRadius:'4px', cursor:'pointer', display:'inline-flex' }}><FaTrash size={11} /></button>
                                  </div>
                                </td>
                              </tr>
                              {notas.length > 0 && (
                                <tr>
                                  <td></td>
                                  <td colSpan="8" style={{ padding:'0 10px 8px', fontSize:'10.5px', lineHeight:1.45 }}>
                                    {notas.map((n, j) => (
                                      <span key={n.k} style={{ color:n.color }}>
                                        {j > 0 && <span style={{ color:'#cbd5e1' }}> · </span>}
                                        {n.etq && <b>{n.etq} </b>}{n.txt}
                                      </span>
                                    ))}
                                  </td>
                                </tr>
                              )}
                              </Fragment>
                            );
                          })}
                        </tbody>
                        {actividades.length > 1 && (() => {
                          // Solo se totaliza si todas las líneas comparten unidad:
                          // sumar m³ con m² daría un número que no significa nada.
                          const unidades = [...new Set(actividades.map(a => calcMetradoDe(a).unit))];
                          const suma = actividades.reduce((s, a) => s + (calcMetradoDe(a).val || 0), 0);
                          return (
                            <tfoot>
                              <tr style={{ background:'#f8fafc', borderTop:'2px solid #e2e8f0' }}>
                                <td colSpan="3" style={{ padding:'9px 10px', textAlign:'right', fontWeight:700, color:'#334155' }}>
                                  {actividades.length} actividades
                                </td>
                                <td style={{ padding:'9px 10px', textAlign:'right', fontWeight:800, color:'#1463A5', whiteSpace:'nowrap' }}>
                                  {unidades.length === 1 ? `${fmtCant(suma)} ${unidades[0]}` : 'unidades mixtas'}
                                </td>
                                <td></td>
                                <td style={{ padding:'9px 10px', textAlign:'right', fontWeight:700, color:'#64748b', whiteSpace:'nowrap' }}>
                                  {fmtCant(tramoDeLista(actividades))} h
                                </td>
                                <td style={{ padding:'9px 10px', textAlign:'right', fontWeight:800, whiteSpace:'nowrap', color: muertasDeLista(actividades) > 0 ? '#b45309' : '#cbd5e1' }}>
                                  {muertasDeLista(actividades) > 0 ? `${fmtCant(muertasDeLista(actividades))} h` : '—'}
                                </td>
                                <td style={{ padding:'9px 10px', textAlign:'right', fontWeight:800, color:'#1463A5', whiteSpace:'nowrap' }}>
                                  {fmtCant(horasMaquina)} h
                                </td>
                                <td></td>
                              </tr>
                            </tfoot>
                          );
                        })()}
                      </table>
                      </div>
                    </div>

                    <div className="tbl-row tbl-mb-3">
                      {/* El horometro se captura en cada actividad. Aqui solo se
                          muestra el resultado: el rango del dia y la suma de tramos. */}
                      {(() => {
                        const rg = rangoHorometro(actividades);
                        const caja = (etq, val) => (
                          <div className="tbl-col">
                            <label className="tbl-form-label">{etq}</label>
                            <div style={{ padding:'8px 10px', background:'#f1f5f9', border:'1px solid #e2e8f0', borderRadius:'4px', fontWeight:700, color: val === '' ? '#94a3b8' : '#334155' }}>
                              {val === '' ? '—' : fmtCant(val)}
                            </div>
                          </div>
                        );
                        return (
                          <>
                            {caja('HM Inicio del día', rg.inicio)}
                            {caja('HM Fin del día', rg.fin)}
                            <div className="tbl-col-auto" style={{display: 'flex', flexDirection: 'column', justifyContent: 'flex-end'}}><div style={{background: '#e0f2fe', color: '#0284c7', padding: '8px 12px', borderRadius: '4px', fontWeight: 'bold', fontSize: '13px', border: '1px solid #bae6fd'}} title="Suma de las horas efectivas de cada actividad">HE: {fmtCant(horasMaquina)} h</div></div>
                          </>
                        );
                      })()}
                      <div className="tbl-col"><label className="tbl-form-label">Combustible (Gls)</label><input type="number" step={STEP4} className="tbl-form-control" value={nuevoRecurso.combustible} onChange={e => setNuevoRecurso({...nuevoRecurso, combustible: e.target.value})} /></div>
                      <div className="tbl-col"><label className="tbl-form-label">Vale N°</label><input type="text" className="tbl-form-control" value={nuevoRecurso.vale} onChange={e => setNuevoRecurso({...nuevoRecurso, vale: e.target.value})} /></div>
                    </div>
                    {/* Las horas efectivas se anotan en cada actividad. Aquí solo el total. */}
                    {(() => {
                      const tramo = tramoDeLista(actividades);
                      const he = parseFloat(horasMaquina) || 0;
                      const reduce = he < tramo;
                      const conMotivo = actividades.filter(a => hayReduccionEn(a));
                      return (
                        <div style={{ display:'flex', alignItems:'center', gap:'12px', flexWrap:'wrap', padding:'10px 12px', marginBottom:'15px', borderRadius:'6px', background: reduce ? '#fffbeb' : '#f8fafc', border: `1px solid ${reduce ? '#fde68a' : '#e2e8f0'}` }}>
                          <span style={{ fontSize:'12px', fontWeight:700, color:'#334155' }}>Horas Efectivas (HE) del parte:</span>
                          <span style={{ fontSize:'16px', fontWeight:800, color:'#1463A5' }}>{fmtCant(he)} h</span>
                          {reduce && (
                            <span style={{ fontSize:'12px', color:'#b45309' }}>
                              de {fmtCant(tramo)} h de horómetro · {fmtCant(tramo - he)} h muertas
                            </span>
                          )}
                          {conMotivo.length > 0 && (
                            <span style={{ fontSize:'11.5px', color:'#92400e', flexBasis:'100%' }}>
                              {conMotivo.map(a => `${textoActividad(a)}: ${a.obsReduccion}`).join(' · ')}
                            </span>
                          )}
                        </div>
                      );
                    })()}
                    <div className="tbl-row tbl-mb-3">
                      <div className="tbl-col"><label className="tbl-form-label">Observaciones del parte</label><input type="text" className="tbl-form-control" placeholder="Condiciones del terreno, clima..." value={nuevoRecurso.observaciones} onChange={e => setNuevoRecurso({...nuevoRecurso, observaciones: e.target.value})} /></div>
                    </div>
                  </div>
                ) : nuevoRecurso.tipo === 'Personal' ? (
                  <>
                  <div className="tbl-row tbl-mb-3">
                    <div className="tbl-col-3">
                      <label className="tbl-form-label">Fecha del trabajo <span style={{color:'red'}}>*</span></label>
                      <input type="date" className="tbl-form-control" value={nuevoRecurso.fechaRecurso}
                        onChange={e => setNuevoRecurso({...nuevoRecurso, fechaRecurso: e.target.value})} />
                    </div>
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
                    <div className="tbl-col-2"><label className="tbl-form-label">H. Normales</label><input type="number" min="0" step={STEP4} className="tbl-form-control" value={nuevoRecurso.horasTrabajo} onChange={e => setNuevoRecurso({...nuevoRecurso, horasTrabajo: e.target.value})} /></div>
                    <div className="tbl-col-2"><label className="tbl-form-label">H. Extras</label><input type="number" min="0" step={STEP4} className="tbl-form-control" value={nuevoRecurso.horasExtras} onChange={e => setNuevoRecurso({...nuevoRecurso, horasExtras: e.target.value})} /></div>
                    <div className="tbl-col-2"><label className="tbl-form-label">S/ por HH</label><input type="number" step={STEP4} className="tbl-form-control" value={nuevoRecurso.precioUnitario} onChange={e => setNuevoRecurso({...nuevoRecurso, precioUnitario: e.target.value})} /></div>
                    <div className="tbl-col-1"><label className="tbl-form-label">Total</label><input type="text" className="tbl-form-control" disabled value={round4((parseInt(nuevoRecurso.numPersonas)||0) * ((parseFloat(nuevoRecurso.horasTrabajo)||0) + (parseFloat(nuevoRecurso.horasExtras)||0))) || 0} style={{backgroundColor: '#e0f2fe', color: '#0284c7', fontWeight: 'bold'}} title="Total HH teóricas" /></div>
                  </div>
                  </>
                ) : (
                  <div className="tbl-row tbl-mb-3">
                    <div className="tbl-col-2"><label className="tbl-form-label">Fecha de uso <span style={{color:'red'}}>*</span></label>
                      <input type="date" className="tbl-form-control" value={nuevoRecurso.fechaRecurso}
                        onChange={e => setNuevoRecurso({...nuevoRecurso, fechaRecurso: e.target.value})} /></div>
                    <div className="tbl-col"><label className="tbl-form-label">Descripción del Insumo</label><input type="text" className="tbl-form-control" placeholder="Ej. Piedra chancada, Cemento..." value={nuevoRecurso.descripcion} onChange={e => setNuevoRecurso({...nuevoRecurso, descripcion: e.target.value})} /></div>
                    <div className="tbl-col-2"><label className="tbl-form-label">Cant.</label><input type="number" step={STEP4} className="tbl-form-control" value={nuevoRecurso.cantidad} onChange={e => setNuevoRecurso({...nuevoRecurso, cantidad: e.target.value})} /></div>
                    <div className="tbl-col-2">
                      <label className="tbl-form-label">Unidad <button type="button" onClick={gestionarUnidades} title="Gestionar unidades" style={{ background:'none', border:'none', color:'#206bc4', cursor:'pointer', fontSize:'11px', padding:'0 0 0 4px' }}><FaPlus /> gestionar</button></label>
                      <select className="tbl-form-select" value={nuevoRecurso.unidad} onChange={e => setNuevoRecurso({...nuevoRecurso, unidad: e.target.value})}>
                        {catUnidades.map(u => <option key={u} value={u}>{u}</option>)}
                      </select>
                    </div>
                    <div className="tbl-col-2"><label className="tbl-form-label">Precio Unit. (S/)</label><input type="number" step={STEP4} className="tbl-form-control" value={nuevoRecurso.precioUnitario} onChange={e => setNuevoRecurso({...nuevoRecurso, precioUnitario: e.target.value})} /></div>
                  </div>
                )}

              </div>
              <div className="tbl-modal-footer" style={{ display:'flex', gap:'8px', justifyContent:'flex-end' }}>
                <button className="tbl-btn tbl-btn-link" onClick={cerrarFormulario}>Cancelar</button>
                {editando ? (
                  <button className="tbl-btn tbl-btn-primary" onClick={guardarEdicion} disabled={guardando}>
                    {guardando ? <><FaSyncAlt className="icon-spin" style={{marginRight:'5px'}}/> Guardando…</> : <><FaSave style={{marginRight:'5px'}}/> Guardar cambios</>}
                  </button>
                ) : (
                  <button className="tbl-btn tbl-btn-success" onClick={agregarRecurso}><FaPlus style={{marginRight:'5px'}}/> Agregar a la lista</button>
                )}
              </div>
            </div>
          </div>
        </div></Portal>
      )}
      {/* ── Modal: partes diarios de una máquina ───────────────────────── */}
      {modalPartes && (
        <Portal><div onClick={() => setModalPartes(null)} style={{ position:'fixed', inset:0, zIndex:10001, background:'rgba(0,0,0,0.6)', display:'flex', alignItems:'center', justifyContent:'center', padding:'20px' }}>
          <div onClick={e => e.stopPropagation()} style={{ background:'#fff', borderRadius:'10px', overflow:'hidden', maxWidth:'1280px', width:'96vw', maxHeight:'92vh', display:'flex', flexDirection:'column' }}>
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
            <div style={{ overflowY:'auto', overflowX:'hidden', padding:'0', flex:1 }}>
              {modalPartes.partesMaq.length === 0 ? (
                <div style={{ padding:'40px', textAlign:'center', color:'#94a3b8', fontSize:'14px' }}>Esta máquina aún no tiene partes diarios. Usa "+ Parte Diario" para crear el primero.</div>
              ) : (
                <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'13px' }}>
                  <thead>
                    <tr style={{ background:'#f1f5f9', borderBottom:'2px solid #e2e8f0' }}>
                      <th style={{ textAlign:'left', padding:'11px 16px', fontSize:'11px', color:'#475569', letterSpacing:'0.4px', whiteSpace:'nowrap' }}>N° PARTE</th>
                      <th style={{ textAlign:'left', padding:'11px 10px', fontSize:'11px', color:'#475569' }}>FECHA</th>
                      <th style={{ textAlign:'left', padding:'11px 10px', fontSize:'11px', color:'#475569' }}>ESTADO</th>
                      <th style={{ textAlign:'left', padding:'11px 10px', fontSize:'11px', color:'#475569' }}>ACTIVIDAD</th>
                      <th style={{ textAlign:'right', padding:'11px 10px', fontSize:'11px', color:'#475569' }}>HORAS</th>
                      <th style={{ textAlign:'right', padding:'11px 10px', fontSize:'11px', color:'#475569' }}>COMBUST.</th>
                      <th style={{ textAlign:'right', padding:'11px 10px', fontSize:'11px', color:'#475569' }}>TOTAL</th>
                      <th style={{ textAlign:'right', padding:'11px 16px', fontSize:'11px', color:'#475569', whiteSpace:'nowrap' }}>ACCIONES</th>
                    </tr>
                  </thead>
                  <tbody>
                    {modalPartes.partesMaq.map((p, idx) => {
                      const reg = p.registro || {};
                      const horas = parseFloat(reg.cantidad) || 0;
                      // En OTROS el texto real de la actividad es la descripción escrita.
                      const actTxt = textoActividad(reg) || '—';
                      return (
                        <tr key={p.idLocal || idx} style={{ borderBottom:'1px solid #f1f5f9', background: p.cerrado ? '#fff' : '#fffbeb' }}>
                          <td style={{ padding:'12px 16px', fontWeight:700, color:'#1e293b', whiteSpace:'nowrap' }}>{p.numeroParte || `#${p.dbId}`}</td>
                          <td style={{ padding:'12px 10px', color:'#475569', whiteSpace:'nowrap' }}>{reg.fechaParte ? (reg.fechaParte.split('T')[0].split('-').reverse().join('/')) : '—'}</td>
                          <td style={{ padding:'12px 10px' }}>
                            <span style={{ fontSize:'10px', fontWeight:700, padding:'3px 9px', borderRadius:'4px', background: p.cerrado ? '#dcfce7' : '#fef3c7', color: p.cerrado ? '#15803d' : '#b45309', whiteSpace:'nowrap' }}>
                              {p.cerrado ? 'CERRADO' : 'ABIERTO'}
                            </span>
                          </td>
                          <td style={{ padding:'12px 10px', color:'#475569', maxWidth:'320px', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }} title={actTxt}>{actTxt}</td>
                          <td style={{ padding:'12px 10px', textAlign:'right', fontWeight:600, color:'#334155', whiteSpace:'nowrap' }}>{fmtCant(horas)} HE</td>
                          <td style={{ padding:'12px 10px', textAlign:'right', color:'#334155', whiteSpace:'nowrap' }}>{fmtCant(reg.combustible || 0)} Gls</td>
                          <td style={{ padding:'12px 10px', textAlign:'right', fontWeight:700, color:'#1463A5', whiteSpace:'nowrap' }}>S/ {fmtNum(reg.total || 0)}</td>
                          <td style={{ padding:'12px 16px' }}>
                            <div style={{ display:'flex', gap:'6px', justifyContent:'flex-end', alignItems:'center', flexWrap:'nowrap' }}>
                              {p.dbId && (
                                <button type="button" onClick={() => { setModalPartes(null); abrirModalPdf(p.dbId); }} title="Ver PDF del parte"
                                  style={{ display:'inline-flex', alignItems:'center', gap:'5px', padding:'5px 11px', backgroundColor:'#e0f2fe', color:'#0284c7', borderRadius:'5px', border:'none', cursor:'pointer', fontSize:'12px', fontWeight:600, whiteSpace:'nowrap' }}>
                                  <FaFilePdf size={12} /> Ver PDF
                                </button>
                              )}
                              {/* Editable mientras la incidencia siga abierta: cerrar el
                                  parte solo libera la máquina, el costeo se sigue corrigiendo. */}
                              {!bloqueado && (
                                <button type="button" onClick={() => editarParte(p.registro)} title="Editar este parte"
                                  style={{ display:'inline-flex', alignItems:'center', gap:'5px', padding:'5px 11px', backgroundColor:'#e0f2fe', color:'#0284c7', borderRadius:'5px', border:'none', cursor:'pointer', fontSize:'12px', fontWeight:600, whiteSpace:'nowrap' }}>
                                  <FaPen size={11} /> Editar
                                </button>
                              )}
                              {!p.cerrado && !bloqueado && (
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
                      <td style={{ padding:'14px 10px', textAlign:'right', fontWeight:700, color:'#334155', whiteSpace:'nowrap' }}>{fmtCant(modalPartes.cantidadTotal)} HE</td>
                      <td style={{ padding:'14px 10px', textAlign:'right', fontWeight:700, color:'#334155', whiteSpace:'nowrap' }}>{fmtCant(modalPartes.partesMaq.reduce((s, p) => s + (parseFloat(p.registro?.combustible) || 0), 0))} Gls</td>
                      <td style={{ padding:'14px 10px', textAlign:'right', fontWeight:800, fontSize:'15px', color:'#1463A5', whiteSpace:'nowrap' }}>S/ {fmtNum(modalPartes.totalSum)}</td>
                      <td style={{ padding:'14px 22px' }}></td>
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>

            {/* Footer */}
            <div style={{ padding:'12px 22px', borderTop:'1px solid #e2e8f0', background:'#f8fafc', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              {bloqueado ? <span style={{fontSize:'12px', color:'#94a3b8', fontStyle:'italic'}}>Incidencia cerrada</span> : (
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
        </div></Portal>
      )}
      {/* ── Modal: AVANCE DEL PRESUPUESTO ───────────────────────────────
           Ejecutado contra presupuestado, partida por partida.

           El metrado se valoriza al precio unitario del presupuesto, no al
           costo de la máquina: son dos cuentas distintas y mezclarlas es de
           donde salen las valorizaciones que no cuadran. Lo que se cobra al
           cliente es metrado × precio de partida; lo que cuesta mover la
           máquina es otra cosa y vive en el costeo de la incidencia. */}
      {modalAvance && (
        <Portal><div onClick={() => setModalAvance(false)}
          style={{ position:'fixed', inset:0, zIndex:10002, background:'rgba(0,0,0,0.6)', display:'flex', alignItems:'center', justifyContent:'center', padding:'16px' }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background:'#fff', borderRadius:'12px', width:'100%', maxWidth:'1100px', maxHeight:'92vh', display:'flex', flexDirection:'column', overflow:'hidden' }}>
            {(() => {
              const num = (x) => parseFloat(x) || 0;
              const conAvance = partidas.filter(p => num(p.ejecutado) > 0);
              const pasadas = partidas.filter(p => num(p.metrado) > 0 && num(p.ejecutado) > num(p.metrado));
              const descuadres = partidas.filter(p => p.otras_unidades && Object.keys(p.otras_unidades).length);
              const lista = filtroAvance === 'avance' ? conAvance
                : filtroAvance === 'pasadas' ? pasadas
                : filtroAvance === 'descuadre' ? descuadres
                : partidas;
              const presupuestado = partidas.reduce((s, p) => s + num(p.metrado) * num(p.precio), 0);
              const ejecutado = partidas.reduce((s, p) => s + num(p.ejecutado) * num(p.precio), 0);
              // El ARBOL del presupuesto, como en el Excel.
              //
              // Antes se agrupaba por el campo 'estructura', y eso mezclaba
              // niveles: para las ramas cortas (TRABAJOS PRELIMINARES, OBRAS
              // PROVISIONALES, FLETE) ese campo es el titulo de nivel 2, asi
              // que las tres acababan colgando de "ESTRUCTURAS DE TRATAMIENTO"
              // como si fueran hermanas de CAJA DE DERIVACION. No lo son.
              //
              // Con la ruta completa el arbol se arma tal cual esta escrito.
              const raiz = { hijos: [], partidas: [] };
              lista.forEach(p => {
                let n = raiz;
                rutaDe(p).forEach(([c, d]) => {
                  let h = n.hijos.find(x => x.codigo === c);
                  if (!h) { h = { codigo: c, desc: d, hijos: [], partidas: [] }; n.hijos.push(h); }
                  n = h;
                });
                n.partidas.push(p);
              });
              // Los subtotales de un titulo SOLO pueden ir en soles: debajo
              // cuelgan m3, kg, und y glb, y sumar eso daria un numero que no
              // significa nada. Es lo mismo que hace el Excel, que en los
              // titulos deja vacias las columnas de unidad y metrado.
              const totalizar = (n) => {
                let pres = 0, ejec = 0;
                n.partidas.forEach(p => {
                  pres += num(p.metrado) * num(p.precio);
                  ejec += num(p.ejecutado) * num(p.precio);
                });
                n.hijos.forEach(h => { const s = totalizar(h); pres += s.pres; ejec += s.ejec; });
                n.pres = pres; n.ejec = ejec;
                return { pres, ejec };
              };
              totalizar(raiz);
              const sinRuta = lista.length > 0 && raiz.hijos.length === 0;
              const Filtro = ({ k, txt, n }) => (
                <button type="button" onClick={() => setFiltroAvance(k)}
                  style={{ padding:'5px 11px', borderRadius:'6px', fontSize:'12px', fontWeight:600, cursor:'pointer',
                           border:`1px solid ${filtroAvance === k ? '#1463A5' : '#e2e8f0'}`,
                           background: filtroAvance === k ? '#eff6ff' : '#fff',
                           color: filtroAvance === k ? '#1463A5' : '#64748b' }}>
                  {txt} <span style={{ opacity:0.7 }}>({n})</span>
                </button>
              );
              return (
                <>
                  <div style={{ padding:'16px 20px', background:'#1463A5', color:'#fff' }}>
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:'12px' }}>
                      <div>
                        <h5 style={{ margin:0, fontSize:'16px' }}>Avance del presupuesto</h5>
                        <div style={{ fontSize:'11.5px', opacity:0.85, marginTop:'3px' }}>
                          {partidas[0]?.proyecto || partidas[0]?.obra || ''}
                        </div>
                      </div>
                      <button onClick={() => setModalAvance(false)}
                        style={{ background:'none', border:'none', color:'#fff', cursor:'pointer', fontSize:'18px', display:'flex' }}><FaTimes /></button>
                    </div>
                    <div style={{ display:'flex', gap:'22px', marginTop:'12px', flexWrap:'wrap', fontSize:'12.5px' }}>
                      <span>Presupuestado: <b>S/ {fmtNum(presupuestado)}</b></span>
                      <span>Ejecutado: <b>S/ {fmtNum(ejecutado)}</b></span>
                      <span>Avance: <b>{presupuestado ? (ejecutado / presupuestado * 100).toFixed(2) : '0.00'}%</b></span>
                    </div>
                  </div>

                  <div style={{ padding:'12px 20px', borderBottom:'1px solid #e2e8f0', display:'flex', gap:'8px', flexWrap:'wrap' }}>
                    <Filtro k="todas" txt="Todas" n={partidas.length} />
                    <Filtro k="avance" txt="Con avance" n={conAvance.length} />
                    <Filtro k="pasadas" txt="Pasadas del 100%" n={pasadas.length} />
                    <Filtro k="descuadre" txt="Con metrado en otra unidad" n={descuadres.length} />
                  </div>

                  <div style={{ overflow:'auto', padding:'0 20px 16px' }}>
                    {lista.length === 0 ? (
                      <div style={{ padding:'28px', textAlign:'center', color:'#94a3b8', fontSize:'13px', fontStyle:'italic' }}>
                        Ninguna partida en este filtro.
                      </div>
                    ) : (
                      <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'12.5px' }}>
                        <thead>
                          <tr style={{ fontSize:'10.5px', color:'#64748b', textAlign:'left' }}>
                            <th style={{ padding:'10px 8px 6px 0', fontWeight:600 }}>Partida</th>
                            <th style={{ padding:'10px 8px 6px', fontWeight:600, textAlign:'right', whiteSpace:'nowrap' }}>Metrado</th>
                            <th style={{ padding:'10px 8px 6px', fontWeight:600, textAlign:'right', whiteSpace:'nowrap' }}>Ejecutado</th>
                            <th style={{ padding:'10px 8px 6px', fontWeight:600, textAlign:'right', whiteSpace:'nowrap' }}>Saldo</th>
                            <th style={{ padding:'10px 0 6px 8px', fontWeight:600, width:'150px' }}>Avance</th>
                          </tr>
                        </thead>
                        <tbody>
                          {sinRuta && (
                            /* El presupuesto se cargó sin la ruta: no hay árbol
                               que dibujar. Se listan planas antes que no
                               mostrar nada. */
                            <tr><td colSpan="5" style={{ padding:'8px 0', fontSize:'11px', color:'#b45309' }}>
                              El presupuesto está cargado sin la ruta, así que no se puede
                              mostrar el árbol. Recarga el catálogo en el servidor.
                            </td></tr>
                          )}
                          {(function filas(nodo, prof) {
                            const out = [];
                            nodo.hijos.forEach(h => {
                              const pct = h.pres ? h.ejec / h.pres * 100 : 0;
                              // Los títulos muestran SOLES, no metrado: debajo
                              // cuelgan unidades distintas y sumarlas no significa
                              // nada. Es lo que hace el propio Excel.
                              out.push(
                                <tr key={'t' + h.codigo} style={{ background: prof === 0 ? '#eff6ff' : '#f8fafc', borderTop:'1px solid #e2e8f0' }}>
                                  <td style={{ padding:'7px 8px 7px 0', paddingLeft: prof * 18 }}>
                                    <span style={{ fontFamily:'monospace', fontSize:'11px', color:'#64748b' }}>{h.codigo}</span>
                                    {'  '}
                                    <span style={{ fontWeight:700, color: prof === 0 ? '#1463A5' : '#334155',
                                      fontSize: prof === 0 ? '12px' : '11.5px', letterSpacing: prof === 0 ? '0.3px' : 0 }}>
                                      {h.desc}
                                    </span>
                                  </td>
                                  <td style={{ padding:'7px 8px', textAlign:'right', whiteSpace:'nowrap', color:'#64748b', fontSize:'11.5px' }}>
                                    S/ {fmtNum(h.pres)}
                                  </td>
                                  <td style={{ padding:'7px 8px', textAlign:'right', whiteSpace:'nowrap', fontWeight:700, fontSize:'11.5px', color: h.ejec > 0 ? '#1463A5' : '#cbd5e1' }}>
                                    S/ {fmtNum(h.ejec)}
                                  </td>
                                  <td style={{ padding:'7px 8px', textAlign:'right', whiteSpace:'nowrap', fontSize:'11.5px', color:'#64748b' }}>
                                    S/ {fmtNum(h.pres - h.ejec)}
                                  </td>
                                  <td style={{ padding:'7px 0 7px 8px' }}>
                                    <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
                                      <div style={{ flex:1, height:'7px', background:'#e2e8f0', borderRadius:'4px', overflow:'hidden' }}>
                                        <div style={{ width:`${Math.min(100, pct)}%`, height:'100%', background:'#1463A5' }} />
                                      </div>
                                      <span style={{ fontSize:'11.5px', fontWeight:700, width:'52px', textAlign:'right', color:'#475569' }}>
                                        {pct.toFixed(1)}%
                                      </span>
                                    </div>
                                  </td>
                                </tr>
                              );
                              out.push(...filas(h, prof + 1));
                            });
                            nodo.partidas.forEach(p => {
                              const pres = num(p.metrado), ejec = num(p.ejecutado);
                              const pct = pres ? ejec / pres * 100 : 0;
                              const pasada = pres > 0 && ejec > pres;
                              const otras = p.otras_unidades && Object.keys(p.otras_unidades).length
                                ? Object.entries(p.otras_unidades).map(([u, v]) => `${fmtCant(v)} ${u}`).join(', ')
                                : '';
                              out.push(
                                <tr key={p.id} style={{ borderTop:'1px solid #f1f5f9' }}>
                                  <td style={{ padding:'7px 8px 7px 0', paddingLeft: prof * 18 }}>
                                    <div style={{ color:'#1e293b' }}>
                                      <span style={{ color:'#94a3b8', fontFamily:'monospace', fontSize:'11px' }}>{p.codigo}</span>
                                      {'  '}{p.descripcion}
                                    </div>
                                    {/* Metrado imputado con una unidad que no es la de
                                        la partida: no suma al avance, pero esconderlo
                                        seria dar por perdido trabajo que se hizo. */}
                                    {otras && (
                                      <div style={{ fontSize:'11px', color:'#b45309', marginTop:'2px' }}>
                                        Sin sumar, en otra unidad: {otras}
                                      </div>
                                    )}
                                  </td>
                                  <td style={{ padding:'7px 8px', textAlign:'right', whiteSpace:'nowrap', color:'#64748b' }}>
                                    {fmtCant(pres)} {p.unidad}
                                  </td>
                                  <td style={{ padding:'7px 8px', textAlign:'right', whiteSpace:'nowrap', fontWeight:700, color: ejec > 0 ? '#1463A5' : '#cbd5e1' }}>
                                    {fmtCant(ejec)} {p.unidad}
                                  </td>
                                  <td style={{ padding:'7px 8px', textAlign:'right', whiteSpace:'nowrap', color: pasada ? '#b91c1c' : '#15803d' }}>
                                    {fmtCant(num(p.saldo))}
                                  </td>
                                  <td style={{ padding:'7px 0 7px 8px' }}>
                                    <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
                                      <div style={{ flex:1, height:'7px', background:'#f1f5f9', borderRadius:'4px', overflow:'hidden' }}>
                                        <div style={{ width:`${Math.min(100, pct)}%`, height:'100%',
                                          background: pasada ? '#dc2626' : pct >= 99.5 ? '#15803d' : '#1463A5' }} />
                                      </div>
                                      <span style={{ fontSize:'11.5px', fontWeight:700, width:'52px', textAlign:'right',
                                        color: pasada ? '#b91c1c' : '#475569' }}>
                                        {pres ? pct.toFixed(1) : '—'}%
                                      </span>
                                    </div>
                                  </td>
                                </tr>
                              );
                            });
                            return out;
                          })(raiz, 0)}
                        </tbody>
                      </table>
                    )}
                  </div>

                  <div style={{ padding:'12px 20px', borderTop:'1px solid #e2e8f0', background:'#f8fafc', display:'flex', justifyContent:'space-between', alignItems:'center', gap:'12px', flexWrap:'wrap' }}>
                    <span style={{ fontSize:'11.5px', color:'#64748b' }}>
                      El ejecutado se valoriza al precio del presupuesto, no al costo de la máquina.
                    </span>
                    <button onClick={() => setModalAvance(false)} className="tbl-btn tbl-btn-link">Cerrar</button>
                  </div>
                </>
              );
            })()}
          </div>
        </div></Portal>
      )}

      {/* ── Modal: UNA actividad del parte (zona, tarea y metrado) ─────── */}
      {modalActividad && (
        <Portal><div className="tbl-modal-backdrop" style={{ zIndex: 10002 }}>
          <div className="tbl-modal-dialog" onClick={e => e.stopPropagation()} style={{ maxWidth: '820px' }}>
            <div className="tbl-modal-content">
              <div className="tbl-modal-header">
                <h5 className="tbl-modal-title">
                  {actEditando === null ? '➕ Agregar actividad' : `✏️ Editar actividad ${actEditando + 1}`}
                </h5>
                <button className="tbl-btn-close" onClick={() => { setModalActividad(false); setActEditando(null); }}><FaTimes/></button>
              </div>
              <div className="tbl-modal-body">
                <div className="tbl-row tbl-mb-3">
                  <div className="tbl-col">
                    <label className="tbl-form-label">Zona de trabajo</label>
                    <input type="text" className="tbl-form-control" placeholder="Ej. Tramo 15, Canal Moche km 3+200"
                      value={actForm.zonaTrabajo}
                      onChange={e => setActForm({ ...actForm, zonaTrabajo: e.target.value })} />
                  </div>
                  <div className="tbl-col">
                    <label className="tbl-form-label">Actividad realizada <span style={{color:'red'}}>*</span></label>
                    <select className="tbl-form-select" value={actForm.actividad} onChange={e => {
                        const v = e.target.value;
                        if (v === 'OTROS') {
                          // OTROS: sin fórmula ni medidas de campo, solo metrado manual.
                          setActForm({ ...actForm, actividad: v, calcularMetrado: false,
                            longitud: '', altura: '', anchoSup: '', anchoInf: '', anchoBase: '', corona: '',
                            talud: '', hPromedio: '', nViajes: '', volTolva: '', fe: '1.25' });
                        } else {
                          setActForm({ ...actForm, actividad: v, actividadOtros: '' });
                        }
                      }}>
                      <option value="">— Seleccionar actividad —</option>
                      <option value="EXCAVACION DE MATERIAL">EXCAVACIÓN DE MATERIAL</option>
                      <option value="CARGUIO DE MATERIAL">CARGUÍO DE MATERIAL</option>
                      <option value="DESCOLMATACION DE CAUCE">DESCOLMATACIÓN DE CAUCE</option>
                      <option value="ELIMINACION">ELIMINACIÓN DE MATERIAL</option>
                      <option value="CONFORMACION DE DIQUE">CONFORMACIÓN DE DIQUE</option>
                      <option value="ENROCADO">ENROCADO</option>
                      <option value="PERFILADO DE TALUD">PERFILADO DE TALUD</option>
                      <option value="HABILITACION DE ACCESO">HABILITACIÓN DE ACCESO</option>
                      <option value="OTROS">OTROS (metrado manual)</option>
                    </select>
                  </div>
                </div>

                {/* ── Partida del presupuesto, en escalera ─────────────────
                     Se baja por el árbol del presupuesto, nivel por nivel:

                       01           CONSTRUCCION Y MEJORAMIENTO ... TOMA 10
                       01.02        ESTRUCTURAS DE TRATAMIENTO
                       01.02.01     TRABAJOS PRELIMINARES
                       01.02.01.01  Movilizacion y desmovilizacion ...

                     La profundidad NO es fija: 78 partidas tienen cuatro
                     ancestros y 5 tienen tres (TRABAJOS PRELIMINARES, OBRAS
                     PROVISIONALES, FLETE cuelgan directas). Por eso los
                     peldaños se dibujan según la rama y no con un número fijo
                     de combos: con cinco fijos, esas tres ramas mostrarían un
                     combo vacío que no lleva a ninguna parte.

                     Un nivel con una sola opción se da por elegido. Es lo que
                     pasa arriba, donde solo hay un presupuesto: se ve el
                     camino completo sin tener que abrir dos combos que no
                     deciden nada. */}
                {partidas.length > 0 && (() => {
                  const norm = (u) => (u || '').toString().trim().toLowerCase()
                    .replace('³', '3').replace('²', '2');
                  const mv = calcMetradoDe(actForm);
                  const uAct = norm(mv.unit || actForm.unidadMetrado);
                  const sel = partidas.find(p => String(p.id) === String(actForm.partidaId));
                  const choca = sel && uAct && norm(sel.unidad) !== uAct;

                  const candidatas = partidas.filter(p => cuelgaDe(p, casRuta));

                  // Un peldaño por cada nivel del camino, más el siguiente.
                  const peldanos = [];
                  for (let i = 0; i <= casRuta.length; i++) {
                    const base = partidas.filter(p => cuelgaDe(p, casRuta.slice(0, i)));
                    const ops = [];
                    base.forEach(p => {
                      const n = rutaDe(p)[i];
                      if (n && !ops.some(o => o[0] === n[0])) ops.push(n);
                    });
                    if (ops.length) peldanos.push({ i, ops, valor: casRuta[i] || '' });
                  }

                  // Las partidas del último nivel: las que ya no tienen más ruta.
                  const hojas = candidatas.filter(p => rutaDe(p).length === casRuta.length);

                  const ponerPartida = (id) => {
                    const p = partidas.find(x => String(x.id) === String(id));
                    setActForm({ ...actForm,
                      partidaId: id,
                      // Copiados a propósito: si mañana se recarga el
                      // presupuesto, este parte sigue diciendo a qué se cargó.
                      partidaCodigo: p ? p.codigo : '',
                      partidaDescripcion: p ? p.descripcion : '' });
                  };

                  // Al elegir un nivel se corta lo que había debajo y se
                  // vuelven a bajar los niveles de un solo hijo.
                  const elegirNivel = (i, cod) => {
                    const corte = casRuta.slice(0, i);
                    setCasRuta(bajarSolo(partidas, cod ? corte.concat([cod]) : corte));
                    ponerPartida('');
                  };

                  const ETQ = ['Presupuesto', 'Partida de control', 'Estructura', 'Capítulo', 'Subcapítulo'];
                  return (
                    <div style={{ background:'#f8fafc', border:'1px solid #e2e8f0', borderRadius:'6px', padding:'12px', marginBottom:'15px' }}>
                      <div style={{ fontSize:'12.5px', fontWeight:700, color:'#334155', marginBottom:'8px' }}>
                        Partida del presupuesto <small style={{ color:'#94a3b8', fontWeight:400 }}>· opcional</small>
                      </div>

                      {peldanos.map(({ i, ops, valor }) => (
                        <div key={i} style={{ marginBottom:'8px' }}>
                          <label className="tbl-form-label">
                            {i + 1} · {ETQ[i] || `Nivel ${i + 1}`}
                          </label>
                          <select className="tbl-form-select" value={valor}
                            onChange={e => elegirNivel(i, e.target.value)}>
                            <option value="">— Elegir —</option>
                            {ops.map(([c, d]) => (
                              <option key={c} value={c}>{c} · {d}</option>
                            ))}
                          </select>
                        </div>
                      ))}

                      {hojas.length > 0 && (
                        <div style={{ marginBottom:'4px' }}>
                          <label className="tbl-form-label">
                            {peldanos.length + 1} · Partida
                          </label>
                          <select className="tbl-form-select" value={actForm.partidaId}
                            onChange={e => ponerPartida(e.target.value)}>
                            <option value="">— Elegir —</option>
                            {hojas.map(p => (
                              <option key={p.id} value={p.id}>
                                {p.codigo} · {p.descripcion} ({p.unidad})
                              </option>
                            ))}
                          </select>
                        </div>
                      )}

                      {sel ? (
                        <div style={{ marginTop:'8px', fontSize:'11.5px', color:'#475569', display:'flex', gap:'14px', flexWrap:'wrap' }}>
                          <span>Presupuestado: <b>{fmtCant(sel.metrado)} {sel.unidad}</b></span>
                          <span>Ejecutado: <b>{fmtCant(sel.ejecutado || 0)} {sel.unidad}</b></span>
                          <span style={{ color: (sel.saldo ?? 0) < 0 ? '#b91c1c' : '#15803d' }}>
                            Saldo: <b>{fmtCant(sel.saldo ?? 0)} {sel.unidad}</b>
                          </span>
                        </div>
                      ) : (
                        <div style={{ marginTop:'8px', fontSize:'11px', color:'#94a3b8' }}>
                          Sin partida: la actividad se guarda igual, pero su metrado no entra en el avance.
                        </div>
                      )}
                      {choca && (
                        /* Se avisa, no se bloquea: bloquear en campo acaba en
                           que apuntan cualquier cosa con tal de poder guardar. */
                        <div style={{ marginTop:'8px', fontSize:'11.5px', color:'#b45309', background:'#fffbeb', border:'1px solid #fde68a', borderRadius:'6px', padding:'7px 9px' }}>
                          Esta actividad mide en <b>{mv.unit || actForm.unidadMetrado}</b> y la partida
                          está en <b>{sel.unidad}</b>. Se guardará igual, pero ese metrado no sumará
                          al avance de la partida.
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* Descripción libre — solo cuando es OTROS */}
                {esActividadOtros && (
                  <div className="tbl-row tbl-mb-3">
                    <div className="tbl-col">
                      <label className="tbl-form-label">Descripción de la actividad <span style={{color:'red'}}>*</span></label>
                      <input type="text" className="tbl-form-control" placeholder="Ej. RIEGO DE PLATAFORMA CON CISTERNA"
                        value={actForm.actividadOtros}
                        onChange={e => setActForm({ ...actForm, actividadOtros: e.target.value.toUpperCase() })} />
                      <small style={{ fontSize:'11px', color:'#64748b' }}>Se guarda como el nombre de esta línea y aparece en el PDF y en los reportes.</small>
                    </div>
                  </div>
                )}

                {/* ── Metrado de esta actividad (con imagen de referencia) ── */}
                {tieneMetradoActividad && (
                  <div style={{ background:'#f0f6ff', padding:'14px', borderRadius:'4px', border:'1px solid #bfdbfe', marginTop:'4px' }}>
                    {esActividadOtros ? (
                      <div style={{ fontSize:'12px', fontWeight:'700', color:'#1463A5' }}>
                        OTROS · metrado de ingreso manual
                      </div>
                    ) : (
                    <div style={{ display:'flex', gap:'14px', alignItems:'flex-start' }}>
                      <div style={{ flexShrink:0, width:'160px' }}>
                        <div style={{ fontSize:'12px', fontWeight:'700', color:'#1463A5', marginBottom:'6px' }}>📐 Referencia</div>
                        <img src={IMG_METRADO[actForm.actividad]} alt={actForm.actividad} onClick={() => setImgRefModal({src: IMG_METRADO[actForm.actividad], titulo: actForm.actividad})} style={{ width:'100%', borderRadius:'4px', border:'1px solid #bfdbfe', cursor:'pointer' }} title="Clic para ampliar" />
                      </div>
                      <div style={{ flex:1 }}>
                        <div style={{ fontSize:'12px', fontWeight:'700', color:'#1463A5', marginBottom:'10px' }}>{actForm.actividad}</div>
                        <div className="tbl-row tbl-mb-2" style={{ gap:'8px' }}>{renderCamposMetrado()}</div>
                      </div>
                    </div>
                    )}
                    <div style={{ marginTop:'8px', padding:'8px 12px', background:'#fff', borderRadius:'4px', border:'1px solid #bfdbfe', display:'flex', justifyContent:'space-between', alignItems:'center', gap:'10px' }}>
                      {(!esActividadOtros && actForm.calcularMetrado) ? (
                        <>
                          <span style={{ fontSize:'11px', color:'#626976' }}>{formulaMetrado[actForm.actividad]}</span>
                          <span style={{ fontSize:'16px', fontWeight:'700', color: volCalc.val > 0 ? '#1463A5' : '#94a3b8' }}>{fmtCant(volumenMetrado)} {volCalc.unit}</span>
                        </>
                      ) : (
                        <>
                          <span style={{ fontSize:'11px', color:'#626976', whiteSpace:'nowrap' }}>Metrado (ingreso manual){esActividadOtros && <span style={{color:'red'}}> *</span>}</span>
                          <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
                            <input type="number" step={STEP4} className="tbl-form-control" placeholder="0.0000"
                              value={actForm.metradoManual}
                              onChange={e => setActForm({ ...actForm, metradoManual: e.target.value })}
                              style={{ width:'130px', textAlign:'right', fontWeight:700, color:'#1463A5' }} />
                            <select className="tbl-form-select" value={actForm.unidadMetrado}
                              onChange={e => setActForm({ ...actForm, unidadMetrado: e.target.value })}
                              style={{ width:'80px' }}>
                              {UNIDADES_METRADO.map(u => <option key={u} value={u}>{UNIDADES_METRADO_TXT[u]}</option>)}
                            </select>
                          </div>
                        </>
                      )}
                    </div>

                    {/* Check para activar el cálculo por fórmula (no aplica en OTROS) */}
                    {!esActividadOtros && (
                      <label style={{ marginTop:'8px', display:'flex', alignItems:'center', gap:'8px', fontSize:'12px', color:'#1463A5', fontWeight:600, cursor:'pointer', userSelect:'none' }}>
                        <input type="checkbox" checked={!!actForm.calcularMetrado}
                          onChange={e => setActForm({ ...actForm, calcularMetrado: e.target.checked })}
                          style={{ width:'15px', height:'15px', cursor:'pointer' }} />
                        Calcular metrado con las medidas de campo
                      </label>
                    )}
                  </div>
                )}

                {/* Horómetro de esta actividad: de aquí salen sus horas y su costo. */}
                <div className="tbl-row tbl-mb-3" style={{ marginTop:'12px' }}>
                  <div className="tbl-col">
                    <label className="tbl-form-label">
                      HM Inicio <span style={{color:'red'}}>*</span>
                      {actForm.hmInicio !== '' && actEditando === null && <span style={{color:'#0284c7', fontSize:'10px', fontWeight:600}}> · encadenado</span>}
                    </label>
                    <input type="number" step={STEP4} className="tbl-form-control" value={actForm.hmInicio}
                      onChange={e => setActForm({ ...actForm, hmInicio: e.target.value })} />
                  </div>
                  <div className="tbl-col">
                    <label className="tbl-form-label">HM Fin <span style={{color:'red'}}>*</span></label>
                    <input type="number" step={STEP4} className="tbl-form-control" value={actForm.hmFin}
                      onChange={e => setActForm({ ...actForm, hmFin: e.target.value })} />
                  </div>
                  <div className="tbl-col-auto" style={{ display:'flex', flexDirection:'column', justifyContent:'flex-end' }}>
                    <div style={{ background:'#e0f2fe', color:'#0284c7', padding:'8px 12px', borderRadius:'4px', fontWeight:'bold', fontSize:'13px', border:'1px solid #bae6fd', whiteSpace:'nowrap', textAlign:'center' }}>
                      Tramo: {fmtCant(horasDeActividad(actForm))} h
                      {muertasDeActividad(actForm) > 0 && (
                        <div style={{ fontSize:'11px', fontWeight:600, color:'#b45309' }}>
                          {fmtCant(muertasDeActividad(actForm))} h muertas
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Horas efectivas de ESTA actividad: lo que entra al costo. */}
                {(() => {
                  const tramo = horasDeActividad(actForm);
                  const he = heDeActividad(actForm);
                  const reduce = he < tramo;
                  return (
                    <div className="tbl-row tbl-mb-3">
                      <div className="tbl-col-3">
                        <label className="tbl-form-label">Horas Efectivas (HE)</label>
                        <input type="number" min="0" max={tramo} step={STEP4} className="tbl-form-control"
                          placeholder={String(tramo)}
                          value={actForm.horasEfectivas}
                          onChange={e => setActForm({ ...actForm, horasEfectivas: e.target.value })}
                          style={reduce ? {borderColor:'#f59e0b', backgroundColor:'#fffbeb', fontWeight:'bold'} : {fontWeight:'bold'}}
                          title="Por defecto = las horas del tramo. Edítalo si se cobran menos." />
                      </div>
                      <div className="tbl-col">
                        <label className="tbl-form-label">
                          Motivo de las horas muertas {reduce
                            ? <span style={{color:'#d97706',fontSize:'11px',fontWeight:600}}>· requerido ({fmtCant(tramo - he)} h muertas)</span>
                            : <span style={{color:'#94a3b8',fontSize:'11px'}}>· sin horas muertas</span>}
                        </label>
                        <input type="text" className="tbl-form-control"
                          placeholder={reduce ? 'Avería, espera de volquetes, traslado...' : 'Sin reducción de horas'}
                          value={actForm.obsReduccion}
                          onChange={e => setActForm({ ...actForm, obsReduccion: e.target.value })}
                          style={reduce && !(actForm.obsReduccion || '').trim() ? {borderColor:'#f59e0b', backgroundColor:'#fffbeb'} : {}} />
                      </div>
                    </div>
                  );
                })()}

                <div className="tbl-row tbl-mb-3">
                  <div className="tbl-col">
                    <label className="tbl-form-label">Observación de esta actividad <span style={{color:'#94a3b8', fontSize:'11px'}}>· opcional</span></label>
                    <input type="text" className="tbl-form-control" placeholder="Detalle propio de esta línea"
                      value={actForm.observacion}
                      onChange={e => setActForm({ ...actForm, observacion: e.target.value })} />
                  </div>
                </div>
              </div>
              <div className="tbl-modal-footer" style={{ display:'flex', gap:'8px', justifyContent:'flex-end' }}>
                <button className="tbl-btn tbl-btn-link" onClick={() => { setModalActividad(false); setActEditando(null); }}>Cancelar</button>
                <button className="tbl-btn tbl-btn-success" onClick={guardarActividad}>
                  <FaSave style={{marginRight:'5px'}}/> {actEditando === null ? 'Agregar a la hoja' : 'Guardar cambios'}
                </button>
              </div>
            </div>
          </div>
        </div></Portal>
      )}
      <VisorImagen foto={imgRefModal} onCerrar={() => setImgRefModal(null)} />

      {/* ── MODAL PDF ──────────────────────────────────────────────────────
           z-index 10004: el visor se abre DESDE la gestión de costeo, que es
           9999. Con el mismo número ganaba solo porque su portal se monta
           después; cualquier re-render que invirtiera ese orden lo mandaba
           detrás del modal desde el que se abrió. */}
      {modalPdfAbierto && (
        <Portal><div className="tbl-modal-backdrop" onClick={() => setModalPdfAbierto(false)} style={{ zIndex: 10004, backgroundColor: 'rgba(0,0,0,0.75)' }}>
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
        </div></Portal>
      )}
      <MantenedorEquipos
        abierto={mantenedorAbierto}
        onClose={() => { setMantenedorAbierto(false); cargarEquiposCat(nuevoRecurso.origen); if (nuevoRecurso.equipoId) cargarMarcasCat(nuevoRecurso.equipoId); if (nuevoRecurso.marcaId) cargarModelosCat(nuevoRecurso.marcaId); }}
      />
  </>);
}
