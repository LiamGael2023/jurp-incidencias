import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { GeoJSON, Marker, Popup, Tooltip, useMap } from 'react-leaflet';
import { createPathComponent } from '@react-leaflet/core';
import L from 'leaflet';
import 'leaflet.markercluster';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import {
  FaClipboardCheck, FaTimes, FaSyncAlt, FaCrosshairs,
  FaChevronDown, FaChevronRight, FaExclamationCircle, FaPlusCircle, FaSearch,
  FaListUl, FaCamera, FaTrash, FaChevronLeft, FaImages, FaExpand, FaCheckCircle,
} from 'react-icons/fa';
import { prepararFoto, motivoRechazo, urlFoto, ordenarFotos, peso } from './fotosActivo';
import { caracteristicas, cobertura, tituloActivo } from './fichaActivo';
import Swal from 'sweetalert2';
import { datosDeCapa } from './sectores';
import { codcatsConLicencia, colorLote, tieneLicencia, textoLicencia,
         CAPA_LICENCIAS, COLOR_CON_LICENCIA, COLOR_SIN_LICENCIA } from './lotes';
import './InventarioGIS.css';

// Simbología oficial del inventario. Son los mismos archivos que usa el
// panel de capas KMZ, así que ambos paneles muestran el mismo símbolo para
// la misma estructura.
import icoToma from './assets/simbologia/toma.png';
import icoEntrega from './assets/simbologia/entrega.png';
import icoCanoa from './assets/simbologia/canoa.png';
import icoSifon from './assets/simbologia/sifon.png';
import icoAlcantarilla from './assets/simbologia/alcantarilla.png';
import icoAliviadero from './assets/simbologia/aliviadero.png';
import icoDesarenador from './assets/simbologia/desarenador.png';
import icoCaida from './assets/simbologia/caida.png';
import icoCanalRect from './assets/simbologia/canal_rectangular.png';
import icoCanalTrap from './assets/simbologia/canal_trapezoidal.png';
import icoConducCubierto from './assets/simbologia/conducto_cubierto.png';
import icoPaseVehicular from './assets/simbologia/pase_vehicular.png';
import icoPasePeatonal from './assets/simbologia/pase_peatonal.png';
import icoBocatoma from './assets/simbologia/bocatoma.png';
import icoRapida from './assets/simbologia/rapida.png';
import icoTransicion from './assets/simbologia/transicion.png';
import icoAcueducto from './assets/simbologia/acueducto.png';
import icoGaritaJURP from './assets/simbologia/garita_jurp.png';
import icoGaritaOtros from './assets/simbologia/garita_otros.png';

/**
 * Módulo de inventario de infraestructura de riego (ámbito JURP).
 *
 * A diferencia de las capas KMZ del visor —que cubren todo Chavimochic y son
 * de referencia— estas capas vienen de PostGIS, corresponden solo al ámbito
 * que administra la Junta y llevan estado de campaña: qué se evaluó, en qué
 * condición está y qué falta por revisar.
 *
 * Uso en Mapa.jsx:
 *
 *   const inv = useInventario();
 *
 *   // en la barra de herramientas
 *   <button className={`gis-tool ${inv.abierto ? 'activo' : ''}`}
 *     title="Inventario JURP" onClick={inv.alternar}><FaClipboardCheck /></button>
 *
 *   // dentro del <MapContainer>
 *   <CapasInventario inv={inv} />
 *
 *   // junto al panel de capas, fuera del mapa
 *   <PanelInventario inv={inv} onVolar={(b) => mapRef.current?.fitBounds(b)} />
 */

const API = '/vigapi/inventario';

// Agrupación para el panel. El orden es el que ve el usuario.
/*
 * Criterio de color de las capas
 * ------------------------------
 * Verde, amarillo, naranja y rojo están RESERVADOS para el estado de
 * conservación (bueno / regular / malo / colapsado). Ninguna capa los usa
 * como identidad: antes una "entrega" naranja se confundía con un activo
 * en mal estado, que es justo lo que el mapa tiene que dejar claro.
 *
 * Sobre imagen satelital todas las capas se ven a la vez, y en ese caso no
 * se sostienen más de tres identidades de color distinguibles. Por eso hay
 * solo dos familias cromáticas y un neutro:
 *
 *   azul  → agua: canales, tomas, entregas, obras de arte
 *   lima  → territorio: sectores, licencias, lotes (solo contorno)
 *   gris  → vías, caminos y todo lo que es de terceros
 *
 * Dentro del agua la distinción no la hace el tono sino la jerarquía: el
 * canal madre va oscuro y grueso, y las ramas se aclaran y adelgazan. Las
 * tuberías a presión van punteadas. Los puntos, además, llevan su propio
 * icono de simbología, así que el color ahí es lo de menos.
 *
 * El territorio va en lima, no en verde: el satélite de esta zona es oliva
 * donde hay cultivo (#70765c) y arena donde no (#ada686), y un verde de
 * hoja se pierde entre los campos. El lima se levanta del terreno y, sobre
 * todo, se separa del verde "bueno" del estado — que es el riesgo real de
 * usar esta familia. Contra ese verde da ΔE 17.4 en visión normal y contra
 * el azul del agua 26.4, sobre un mínimo de 15.
 *
 * Los tonos más oscuros de la misma familia se descartaron por eso mismo:
 * #8fb840 queda en 12.5 contra el estado y #2d913e en 3.8, o sea
 * indistinguible de un activo en buen estado.
 *
 * Aun así, sobre una ortofoto ningún color puro llega al contraste
 * mínimo: el fondo es de luminancia media y compite con todo. Eso no se
 * arregla con el tono sino con un halo oscuro bajo cada trazo, que está
 * en InventarioGIS.css. Es lo que hace que las capas se lean igual sobre
 * cultivo, sobre desierto y sobre el mar.
 */
const GRUPOS = [
  {
    titulo: 'Obras de captación y entrega',
    capas: [
      { codigo: 'tomas_l10',            label: 'Tomas Lateral 10',      color: '#4dabf7', ico: icoToma },
      { codigo: 'tomas_otros_sectores', label: 'Tomas otros sectores',  color: '#74c0fc', ico: icoToma },
      { codigo: 'entregas',             label: 'Entregas',              color: '#3bc9db', ico: icoEntrega },
      { codigo: 'laterales',            label: 'Laterales',             color: '#22b8cf', ico: icoCanalTrap },
      { codigo: 'partidor',             label: 'Partidores',            color: '#15aabf', ico: icoTransicion },
    ],
  },
  {
    titulo: 'Obras de arte',
    capas: [
      { codigo: 'canoas',              label: 'Canoas',               color: '#4c6ef5', ico: icoCanoa },
      { codigo: 'sifon',               label: 'Sifones',              color: '#4dabf7', ico: icoSifon },
      { codigo: 'alcantarilla',        label: 'Alcantarillas',        color: '#9775fa', ico: icoAlcantarilla },
      { codigo: 'aliviadero',          label: 'Aliviaderos',          color: '#b197fc', ico: icoAliviadero },
      { codigo: 'desarenadores',       label: 'Desarenadores',        color: '#22b8cf', ico: icoDesarenador },
      { codigo: 'camara_rompepresion', label: 'Cámaras rompepresión', color: '#3bc9db', ico: icoCaida },
      { codigo: 'cajas_hidraulicas',   label: 'Cajas hidráulicas',    color: '#66d9e8', ico: icoCanalRect },
      { codigo: 'pases_de_tuberias',   label: 'Pases de tuberías',    color: '#74c0fc', ico: icoConducCubierto },
      { codigo: 'reservorios',         label: 'Reservorios',          color: '#1c7ed6', ico: icoAcueducto },
    ],
  },
  {
    titulo: 'Cruces',
    capas: [
      { codigo: 'puente_vehicular', label: 'Puentes vehiculares', color: '#adb5bd', ico: icoPaseVehicular },
      { codigo: 'puente_peatonal',  label: 'Puentes peatonales',  color: '#ced4da', ico: icoPasePeatonal },
    ],
  },
  {
    titulo: 'Red y territorio',
    capas: [
      { codigo: 'canal_madre',       label: 'Canal madre',       color: '#1c7ed6', tipo: 'line', weight: 4 },
      { codigo: 'canal_lateral_10',  label: 'Canal Lateral 10',  color: '#4dabf7', tipo: 'line', weight: 3 },
      { codigo: 'subalterales',      label: 'Subalterales',      color: '#a5d8ff', tipo: 'line', weight: 2 },
      { codigo: 'redes_presurizado', label: 'Redes presurizado', color: '#74c0fc', tipo: 'line', dash: '3 5', weight: 2 },
      // porSector: cada polígono con su color y su nombre escrito encima.
      // Sin esto los sectores eran una sola mancha verde y no se veía dónde
      // acababa uno y empezaba el siguiente.
      { codigo: 'sectores_pech',     label: 'Sectores PECH',     color: '#aec14a', tipo: 'poly', porSector: true },
      /* ÁREAS CON LICENCIA NO ES UNA CAPA APARTE: comprobado contra el
         servidor, sus 205 polígonos SON 205 de los 211 lotes, idénticos
         hasta los 10 cm y con el mismo código catastral. Lo que la distingue
         es un campo, no una geometría. Se sigue descargando —de ahí sale
         quién tiene licencia— pero no se dibuja ni se lista: dibujarla era
         pintar 205 polígonos dos veces para esconder el único dato que
         importaba. */
      { codigo: 'areas_licencia',    label: 'Áreas con licencia', color: '#c0d259', tipo: 'poly', oculta: true },
      { codigo: 'lotes',             label: 'Lotes',             color: '#d2e070', tipo: 'poly', porLicencia: true },
    ],
  },
];

// Capas que vienen del KMZ: cubren todo Chavimochic y son de referencia.
// El grupo va aparte para que nadie las confunda con lo que la Junta evalúa.
const GRUPOS_CONTEXTO = [
  {
    titulo: 'Chavimochic — obras del PECH',
    contexto: true,
    capas: [
      { codigo: 'bocatomas',          label: 'Bocatomas',            color: '#7a93ab', ico: icoBocatoma },
      { codigo: 'estaciones_control', label: 'Estaciones de control', color: '#8ea9c2', ico: icoBocatoma },
      { codigo: 'rapidas',            label: 'Rápidas',              color: '#6b8ca8', ico: icoRapida },
      // Formato B-1.C del ANA: la obra es del PECH pero el inventario lo
      // levanta y lo firma la Junta como operador, asi que estas tomas si
      // entran en campana. Por eso 'evaluable' va aparte del ambito.
      { codigo: 'tomas_canal_madre',  label: 'Tomas Canal Madre',    color: '#a1bcd1', ico: icoToma, evaluable: true },
      { codigo: 'garitas_jurp',       label: 'Garitas JURP',         color: '#15aabf', ico: icoGaritaJURP },
      { codigo: 'garitas_otros',      label: 'Garitas de terceros',  color: '#94a3b8', ico: icoGaritaOtros },
    ],
  },
  {
    titulo: 'Chavimochic — trazados y vías',
    contexto: true,
    capas: [
      { codigo: 'canal_madre_kmz',       label: 'Canal Madre',       color: '#6b8ca8', tipo: 'poly' },
      { codigo: 'canal_lateral_10_kmz',  label: 'Lateral 10',        color: '#86a5bd', tipo: 'poly' },
      { codigo: 'redes_presurizado_kmz', label: 'Redes presurizado', color: '#a1bcd1', tipo: 'poly' },
      { codigo: 'evacuador_kmz',         label: 'Evacuadores',       color: '#bcd3e4', tipo: 'poly' },
      { codigo: 'caminos_servicio_kmz',  label: 'Caminos de servicio', color: '#868e96', tipo: 'poly' },
      { codigo: 'vias_acceso_kmz',       label: 'Vías de acceso',    color: '#adb5bd', tipo: 'poly' },
      { codigo: 'via_auxiliar_kmz',      label: 'Vía auxiliar',      color: '#9aa3ab', tipo: 'poly' },
      { codigo: 'red_nacional_kmz',      label: 'Red vial nacional', color: '#dee2e6', tipo: 'poly' },
    ],
  },
];

const TODOS_GRUPOS = [...GRUPOS, ...GRUPOS_CONTEXTO];
const TODAS = TODOS_GRUPOS.flatMap(g => g.capas);

// La leyenda de la lámina temática se arma de aquí, no de una lista paralela:
// una leyenda que no sale del mismo sitio que el dibujo acaba mintiendo el día
// que alguien cambia un color o agrega una capa. Van los dos grupos, incluidas
// las de contexto: si se dibujan sobre la lámina, tienen que estar en su
// leyenda.
export { TODOS_GRUPOS as GRUPOS_CAPAS, TODAS as TODAS_LAS_CAPAS };

// Desde este zoom cada activo lleva su nombre al lado. Mas lejos no se
// rotula: con dos mil seiscientos puntos el mapa se vuelve una mancha de
// texto, y ademas la mayoria sigue metida en un racimo.
const ZOOM_ETIQUETAS = 16;

/* Lado minimo, en pixeles de pantalla, para que un sector lleve su nombre
 * escrito encima.
 *
 * Primero puse un zoom fijo (11) y estaba mal: hay CINCO sectores y ocupan el
 * valle entero, asi que a la escala en la que uno mira el valle -que es
 * justo cuando quiere leerlos- quedaban por debajo del umbral y no salia
 * ninguno. Y un numero de zoom no sabe cuantos sectores hay ni como de
 * grandes son: con cinco sobra sitio, con cincuenta no.
 *
 * Medir el tamano en pantalla se ajusta solo: el rotulo aparece cuando el
 * poligono tiene sitio para el, se quite o se ponga zoom, y da igual si
 * manana la capa trae cinco o cincuenta. */
const MIN_PX_SECTOR = 70;

// El coloreado por vecindad y el rotulo de los sectores viven en su propio
// modulo: son funciones puras y asi se comprueban sin montar el mapa.

/**
 * Cuelga los marcadores del racimo, o directamente del mapa si está apagado.
 *
 * Va como envoltura y no duplicando el bloque de marcadores a propósito: si
 * hubiera dos copias, el día que se toque el dibujo de un marcador habría que
 * acordarse de las dos, y la que no se use ese día es la que se queda atrás.
 *
 * Al cambiar `activo` cambia el tipo del componente, así que React desmonta y
 * vuelve a montar los hijos. Es justo lo que hace falta: los marcadores tienen
 * que soltarse del grupo y colgarse del mapa, o al revés.
 */
const Racimo = ({ activo, innerRef, children }) => (
  activo ? <GrupoCluster ref={innerRef}>{children}</GrupoCluster> : <>{children}</>
);

/**
 * Racimo de marcadores.
 *
 * Con las capas encendidas hay más de dos mil puntos, y pintarlos uno a uno
 * deja el mapa inservible. Leaflet.markercluster los agrupa por cercanía y
 * solo dibuja lo que cabe en pantalla.
 *
 * El truco está en devolver el grupo como 'layerContainer' del contexto:
 * con eso los <Marker> hijos se añaden al racimo en vez de al mapa, y sus
 * popups siguen siendo JSX normal. No hay que reescribirlos a mano.
 */
// eslint-disable-next-line no-unused-vars -- children se descarta a propósito:
// los hijos los coloca react-leaflet dentro del grupo, no este factory.
const GrupoCluster = createPathComponent(({ children: _hijos, ...opciones }, ctx) => {
  const grupo = L.markerClusterGroup({
    chunkedLoading: true,        // añade por tandas, sin congelar la pestaña
    showCoverageOnHover: false,  // el polígono al pasar el ratón estorba
    maxClusterRadius: 55,
    disableClusteringAtZoom: 18, // de cerca, cada estructura por separado
    spiderfyOnMaxZoom: true,     // las que comparten punto se abren en abanico
    ...opciones,
  });
  return { instance: grupo, context: { ...ctx, layerContainer: grupo } };
});

// Filtro de ámbito. 'todo' no manda el parámetro y el backend devuelve
// Chavimochic completo.
const AMBITOS = [
  { valor: 'todo', etiqueta: 'Todo',        titulo: 'JURP y Chavimochic' },
  { valor: 'JURP', etiqueta: 'JURP',        titulo: 'Solo lo que administra la Junta' },
  { valor: 'PECH', etiqueta: 'Chavimochic', titulo: 'Solo obras del PECH' },
];
const META = Object.fromEntries(TODAS.map(c => [c.codigo, c]));

// Estado de conservación, con los códigos del formato ANA.
const COLOR_ESTADO = {
  B: '#2f9e44',   // bueno
  R: '#f59f00',   // regular
  M: '#e8590c',   // malo
  C: '#c92a2a',   // colapsado
  '-': '#868e96', // no aplica
};

const ETIQUETA_ESTADO = {
  B: 'Bueno', R: 'Regular', M: 'Malo', C: 'Colapsado', '-': 'No aplica',
};

// Condición operativa: lo que va a la columna Observaciones del formato.
const COLOR_CONDICION = {
  'Operativo': '#2f9e44',
  'Mantenimiento': '#f59f00',
  'Inoperativo': '#c92a2a',
  'No ubicado': '#868e96',
};

const token = () => localStorage.getItem('userToken');
// El inventario vive en otro backend (gideon), que no comparte la tabla de
// usuarios con el sistema de riego. Mandar el token de esa sesión hace que
// DRF intente autenticarlo, falle y devuelva 401 pese al permiso AllowAny.
const cabeceras = () => ({});

// El marcador carga tres datos a la vez:
//   relleno → capa a la que pertenece
//   anillo  → estado de conservación evaluado (sin anillo = sin evaluar)
//   forma   → ámbito: los de JURP van sólidos, los del PECH huecos y más
//             chicos, porque son contexto y no deben competir por la vista.
// Los divIcon se memorizan: sin esto React recrea el icono en cada render,
// remonta el marcador y se pierde la referencia que usa el buscador.
const cacheIconos = new Map();

const iconoActivo = (color, estado, ambito, ico) => {
  const llave = `${color}|${estado || ''}|${ambito || ''}|${ico || ''}`;
  if (cacheIconos.has(llave)) return cacheIconos.get(llave);
  const icono = construirIcono(color, estado, ambito, ico);
  cacheIconos.set(llave, icono);
  return icono;
};

const construirIcono = (color, estado, ambito, ico) => {
  const esPech = ambito === 'PECH';
  const cEstado = estado ? COLOR_ESTADO[estado] : null;

  // Con símbolo: se dibuja la simbología del inventario y el estado va en un
  // punto en la esquina, para no tapar el dibujo.
  if (ico) {
    return L.divIcon({
      className: 'inv-marker-wrap',
      html: `<span class="inv-simb ${esPech ? 'inv-pech' : ''}">`
          + `<img src="${ico}" alt="" />`
          + (cEstado ? `<i style="--e:${cEstado}"></i>` : '')
          + '</span>',
      iconSize: [26, 26],
      iconAnchor: [13, 13],
      popupAnchor: [0, -14],
    });
  }

  // Sin símbolo propio: círculo del color de la capa, con anillo de estado.
  return L.divIcon({
    className: 'inv-marker-wrap',
    html: `<span class="inv-marker ${esPech ? 'inv-pech' : ''}" `
        + `style="--c:${color};--e:${cEstado || 'transparent'}"></span>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
    popupAnchor: [0, -8],
  });
};

/* ══════════════════════════════════════════════════════════
   Hook: estado del módulo
   ══════════════════════════════════════════════════════════ */
export function useInventario() {
  const [abierto, setAbierto] = useState(false);
  const [campania, setCampania] = useState(null);
  const [campanias, setCampanias] = useState([]);
  const [avance, setAvance] = useState([]);
  const [altas, setAltas] = useState([]);
  const [totales, setTotales] = useState({});
  const [datos, setDatos] = useState({});        // codigo → FeatureCollection
  const [visibles, setVisibles] = useState({});  // codigo → bool
  const [cargando, setCargando] = useState({});  // codigo → bool
  const [evaluaciones, setEvaluaciones] = useState({}); // "tipo:fid" → evaluación
  const [error, setError] = useState(null);
  const [iniciando, setIniciando] = useState(false);
  // El racimo evita que el mapa se arrastre con miles de puntos, pero para
  // una captura estorba: en la foto salen burbujas con un número en vez de
  // los activos. Se puede apagar, y la elección se recuerda porque quien
  // documenta en campo lo apaga una vez y lo quiere apagado toda la jornada.
  const [cluster, setCluster] = useState(() => {
    try { return localStorage.getItem('invCluster') !== 'off'; }
    catch { return true; }   // modo privado o almacenamiento bloqueado
  });

  const alternarCluster = useCallback(() => setCluster(v => {
    try { localStorage.setItem('invCluster', v ? 'off' : 'on'); } catch { /* da igual */ }
    return !v;
  }), []);
  // índice de búsqueda: un registro por activo, con lo justo para
  // encontrarlo y volar hasta él
  const [indice, setIndice] = useState([]);
  // activo al que hay que volar y abrirle el popup: {tipo, fid}
  const [destacado, setDestacado] = useState(null);
  // activo que se está evaluando: {tipo, fid, props}
  const [evaluando, setEvaluando] = useState(null);
  // Activo cuya ficha está abierta: { tipo, fid, props, capa }
  const [ficha, setFicha] = useState(null);
  // definición de campos por tipo, cacheada tras el primer pedido
  const [formularios, setFormularios] = useState({});
  // 'todo' | 'JURP' | 'PECH' — filtro general, el que aplica por defecto
  const [ambito, setAmbito] = useState('todo');
  // Filtro propio de cada capa; pisa al general mientras esté puesto.
  // Se maneja desde los números del badge: clic en el verde deja solo JURP,
  // clic en el gris solo Chavimochic, clic otra vez vuelve a ambos.
  const [filtroCapa, setFiltroCapa] = useState({});

  // Trae todas las capas de a pocas. De golpe serían treinta y siete
  // peticiones a la vez: el navegador las encola igual y el backend las
  // sufre, así que se piden en tandas y el mapa se va llenando solo.
  const cargarTodas = useCallback(async (amb, codigos) => {
    const ambito_ = amb || 'todo';
    const filtro = ambito_ === 'todo' ? '' : `&ambito=${ambito_}`;

    // El fetch va aquí y no reusa cargarCapa a propósito: aquella se
    // recrea en cada render y la versión que quedaría capturada vería
    // una caché vieja. Aquí sabemos que no hay nada cargado todavía.
    const traer = async (codigo) => {
      setCargando(c => ({ ...c, [codigo]: true }));
      try {
        const r = await fetch(`${API}/capas/${codigo}/?srid=4326${filtro}`,
                              { headers: cabeceras() });
        if (r.ok) {
          const geo = await r.json();
          setDatos(d => ({ ...d, [`${codigo}::${ambito_}`]: geo }));
        }
      } catch (e) { /* esa capa queda vacía; el badge lo refleja */ }
      finally { setCargando(c => ({ ...c, [codigo]: false })); }
    };

    const TANDA = 4;
    const pendientes = codigos ? [...codigos] : TODAS.map(c => c.codigo);
    while (pendientes.length) {
      await Promise.all(pendientes.splice(0, TANDA).map(traer));
    }
  }, []);

  // Carga inicial: campaña vigente, totales por capa y evaluaciones hechas.
  const iniciar = useCallback(async () => {
    if (!token()) { setError('Sesión no iniciada'); return; }
    setIniciando(true); setError(null);
    try {
      const [rc, rt] = await Promise.all([
        fetch(`${API}/campanias/`, { headers: cabeceras() }),
        fetch(`${API}/capas/`, { headers: cabeceras() }),
      ]);
      if (!rc.ok || !rt.ok) throw new Error('No se pudo consultar el inventario');

      const camps = await rc.json();
      const lista = camps.results || camps;
      setCampanias(lista);
      const activa = lista.find(c => c.estado === 'en_proceso') || lista[0];
      setCampania(activa || null);

      // el backend devuelve total y, cuando la capa tiene ámbito, el
      // desglose jurp/pech para el badge del panel
      const caps = await rt.json();
      setTotales(Object.fromEntries(
        (caps.results || caps).map(c => [c.codigo, c])
      ));

      if (activa) {
        const [ra, re] = await Promise.all([
          fetch(`${API}/campanias/${activa.id}/avance/`, { headers: cabeceras() }),
          fetch(`${API}/evaluaciones/?campania=${activa.anio}`, { headers: cabeceras() }),
        ]);
        if (ra.ok) setAvance((await ra.json()).detalle || []);
        if (re.ok) {
          const ev = await re.json();
          setEvaluaciones(Object.fromEntries(
            (ev.results || ev).map(e => [`${e.tipo_activo}:${e.activo_fid}`, e])
          ));
        }

        // índice para el buscador. Se pide una vez: son ~2.000 registros
        // ligeros y evita tener que cargar todas las capas para buscar.
        try {
          const ri = await fetch(`${API}/capas/indice/`, { headers: cabeceras() });
          if (ri.ok) setIndice(await ri.json());
        } catch (e) { /* sin índice, el buscador queda vacío */ }

        // altas de campo pendientes de validar
        try {
          const rn = await fetch(`${API}/activos-nuevos/?validacion=pendiente`,
                                 { headers: cabeceras() });
          if (rn.ok) {
            const an = await rn.json();
            setAltas(an.results || an);
          }
        } catch (e) { /* sin altas, el panel simplemente no las muestra */ }
      }
      // Se abre con todo encendido: el mapa sirve para ver qué hay, y
      // llegar a eso marcando treinta y siete casillas no es verlo.
      setVisibles(Object.fromEntries(TODAS.map(c => [c.codigo, true])));
      cargarTodas();
    } catch (e) {
      setError(e.message || 'Error al cargar el inventario');
    } finally {
      setIniciando(false);
    }
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  // Ámbito que rige para una capa: el suyo si lo tiene, si no el general.
  const ambitoDe = useCallback(
    (codigo) => filtroCapa[codigo] || ambito,
    [filtroCapa, ambito]
  );

  // La caché se indexa por capa + ámbito: cambiar el filtro no debe
  // devolver el GeoJSON que se bajó con el filtro anterior.
  const clave = useCallback((codigo, amb) => `${codigo}::${amb || ambitoDe(codigo)}`,
                            [ambitoDe]);

  const cargarCapa = useCallback(async (codigo, amb) => {
    const k = `${codigo}::${amb}`;
    if (datos[k]) return;
    setCargando(c => ({ ...c, [codigo]: true }));
    try {
      const filtro = amb === 'todo' ? '' : `&ambito=${amb}`;
      const r = await fetch(`${API}/capas/${codigo}/?srid=4326${filtro}`,
                            { headers: cabeceras() });
      if (r.ok) {
        // El JSON se resuelve ANTES de tocar el estado: el actualizador de
        // useState es síncrono y no admite await dentro.
        const geo = await r.json();
        setDatos(d => ({ ...d, [k]: geo }));
      }
    } catch (e) { /* la capa queda vacía; el badge lo refleja */ }
    finally { setCargando(c => ({ ...c, [codigo]: false })); }
  }, [datos]);

  const alternarCapa = useCallback((codigo) => {
    setVisibles(v => {
      const nuevo = !v[codigo];
      if (nuevo) cargarCapa(codigo, ambitoDe(codigo));
      return { ...v, [codigo]: nuevo };
    });
  }, [cargarCapa, ambitoDe]);

  // El filtro general reemplaza a los de cada capa: si el usuario elige
  // "solo JURP" arriba, no tiene sentido que una capa siga en otro modo.
  const cambiarAmbito = useCallback((nuevo) => {
    setAmbito(nuevo);
    setFiltroCapa({});
    const encendidas = Object.entries(visibles).filter(([, v]) => v).map(([cod]) => cod);
    cargarTodas(nuevo, encendidas);
  }, [visibles, cargarTodas]);

  // Cada mitad del badge se comporta como una casilla: suma o quita ese
  // ámbito, sin pisar al otro. Los dos marcados = 'todo'; ninguno = la capa
  // se apaga, porque no habría nada que dibujar.
  const alternarAmbitoCapa = useCallback((codigo, amb) => {
    const actual = filtroCapa[codigo] || ambito;
    const activos = new Set(actual === 'todo' ? ['JURP', 'PECH'] : [actual]);

    if (activos.has(amb)) activos.delete(amb);
    else activos.add(amb);

    if (activos.size === 0) {                    // se destildaron los dos
      setVisibles(v => ({ ...v, [codigo]: false }));
      return;
    }

    const nuevo = activos.size === 2 ? 'todo' : [...activos][0];
    setFiltroCapa(f => {
      const copia = { ...f };
      if (nuevo === ambito) delete copia[codigo];
      else copia[codigo] = nuevo;
      return copia;
    });
    cargarCapa(codigo, nuevo);
    setVisibles(v => (v[codigo] ? v : { ...v, [codigo]: true }));
  }, [filtroCapa, ambito, cargarCapa]);

  const apagarTodas = useCallback(() => setVisibles({}), []);

  const alternar = useCallback(() => {
    setAbierto(a => {
      if (!a && !campania && !iniciando) iniciar();
      return !a;
    });
  }, [campania, iniciando, iniciar]);

  const evaluacionDe = useCallback(
    (tipo, fid) => evaluaciones[`${tipo}:${fid}`] || null,
    [evaluaciones]
  );

  // Los campos de cada tipo se piden una vez y quedan en memoria: son la
  // definición del formulario y no cambian durante la sesión.
  const cargarFormulario = useCallback(async (tipo) => {
    if (formularios[tipo]) return formularios[tipo];
    try {
      const r = await fetch(`${API}/campos-evaluables/?tipo_activo=${tipo}`,
                            { headers: cabeceras() });
      if (!r.ok) return null;
      const d = await r.json();
      const campos = (d.results || d).sort((a, b) => a.orden - b.orden);
      setFormularios(f => ({ ...f, [tipo]: campos }));
      return campos;
    } catch (e) {
      return null;
    }
  }, [formularios]);

  // Búsqueda por nombre, canal o progresiva. Sin acentos ni mayúsculas,
  // para que "cámara" encuentre "camara".
  const buscar = useCallback((texto) => {
    const q = (texto || '').trim().toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (q.length < 2) return [];
    const norm = (v) => String(v || '').toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return indice
      .filter(a => norm(a.nombre).includes(q) || norm(a.canal).includes(q)
                || norm(a.progresiva).includes(q) || norm(a.tipo).includes(q))
      .slice(0, 12);
  }, [indice]);

  // Lleva al activo: enciende su capa si estaba apagada, vuela y le abre
  // el popup. La capa tarda en llegar la primera vez, así que el marcador
  // se destaca cuando termine de dibujarse.
  const irA = useCallback((item) => {
    if (!visibles[item.tipo]) {
      setVisibles(v => ({ ...v, [item.tipo]: true }));
      cargarCapa(item.tipo, ambitoDe(item.tipo));
    }
    setDestacado({ tipo: item.tipo, fid: item.fid, lat: item.lat, lng: item.lng });
  }, [visibles, cargarCapa, ambitoDe]);

  const limpiarDestacado = useCallback(() => setDestacado(null), []);

  const abrirEvaluacion = useCallback((tipo, fid, props) => {
    cargarFormulario(tipo);
    setEvaluando({ tipo, fid, props });
  }, [cargarFormulario]);

  const cerrarEvaluacion = useCallback(() => setEvaluando(null), []);

  /* La ficha del activo: todo lo que se sabe de una estructura, más sus
   * fotos. Es una pantalla aparte y no el globo del mapa porque ahí no cabe
   * —el globo tiene que seguir siendo el vistazo rápido— y porque un globo se
   * cierra al pulsar fuera, que es justo lo que no debe pasar mientras se
   * está subiendo una foto. */
  const abrirFicha = useCallback((tipo, fid, props, capa) => {
    cargarFormulario(tipo);          // de aquí salen las etiquetas bonitas
    setFicha({ tipo, fid, props, capa });
  }, [cargarFormulario]);

  const cerrarFicha = useCallback(() => setFicha(null), []);

  // Guarda y refresca en memoria, para no volver a pedir toda la campaña.
  const guardarEvaluacion = useCallback(async (tipo, fid, cuerpo) => {
    if (!campania) return { ok: false, error: 'No hay campaña activa' };
    const previa = evaluaciones[`${tipo}:${fid}`];
    const url = previa ? `${API}/evaluaciones/${previa.id}/` : `${API}/evaluaciones/`;
    try {
      const r = await fetch(url, {
        method: previa ? 'PATCH' : 'POST',
        headers: { ...cabeceras(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...cuerpo, campania: campania.id,
                               tipo_activo: tipo, activo_fid: fid }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        const detalle = Object.entries(d)
          .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(' ') : v}`)
          .join(' · ');
        return { ok: false, error: detalle || `Error ${r.status}` };
      }
      setEvaluaciones(e => ({ ...e, [`${tipo}:${fid}`]: d }));

      // el avance cambia con cada evaluación
      try {
        const ra = await fetch(`${API}/campanias/${campania.id}/avance/`,
                               { headers: cabeceras() });
        if (ra.ok) setAvance((await ra.json()).detalle || []);
      } catch (e) { /* el avance se refresca al reabrir el panel */ }

      return { ok: true };
    } catch (e) {
      return { ok: false, error: 'No se pudo guardar' };
    }
  }, [campania, evaluaciones]);

  // Cambiar de campaña: recarga el avance y las evaluaciones de ese año.
  // Las geometrías no se vuelven a pedir: los activos son los mismos, lo
  // que cambia es su estado.
  const cambiarCampania = useCallback(async (id) => {
    const elegida = campanias.find(c => String(c.id) === String(id));
    if (!elegida) return;
    setCampania(elegida);
    try {
      const [ra, re] = await Promise.all([
        fetch(`${API}/campanias/${elegida.id}/avance/`, { headers: cabeceras() }),
        fetch(`${API}/evaluaciones/?campania=${elegida.anio}`, { headers: cabeceras() }),
      ]);
      if (ra.ok) setAvance((await ra.json()).detalle || []);
      if (re.ok) {
        const ev = await re.json();
        setEvaluaciones(Object.fromEntries(
          (ev.results || ev).map(e => [`${e.tipo_activo}:${e.activo_fid}`, e])
        ));
      }
    } catch (e) { setError('No se pudo cambiar de campaña'); }
  }, [campanias]);

  const totalVisibles = useMemo(
    () => Object.entries(visibles).filter(([, v]) => v)
      .reduce((a, [k]) => a + (datos[`${k}::${filtroCapa[k] || ambito}`]?.features?.length || 0), 0),
    [visibles, datos, ambito, filtroCapa]
  );

  // Lo que consumen los componentes: el GeoJSON del ámbito que rige
  // para esa capa en concreto.
  const datosDe = useCallback(
    (codigo) => datos[`${codigo}::${filtroCapa[codigo] || ambito}`],
    [datos, ambito, filtroCapa]
  );

  return {
    abierto, alternar, cerrar: () => setAbierto(false),
    campania, avance, totales, datos, visibles, cargando, error, iniciando,
    ambito, cambiarAmbito, ambitoDe, alternarAmbitoCapa, datosDe, clave,
    campanias, cambiarCampania, altas,
    indice, buscar, irA, destacado, limpiarDestacado,
    evaluando, abrirEvaluacion, cerrarEvaluacion, guardarEvaluacion, formularios,
    ficha, abrirFicha, cerrarFicha,
    alternarCapa, apagarTodas, evaluacionDe, totalVisibles, recargar: iniciar,
    cluster, alternarCluster,
  };
}

/* ══════════════════════════════════════════════════════════
   Capas sobre el mapa — va DENTRO del <MapContainer>
   ══════════════════════════════════════════════════════════ */
export function CapasInventario({ inv, racimo = null, limites = null, etiquetas = null,
                                  impresion = false, sinPuntos = false }) {
  /**
   * `etiquetas` fuerza el rótulo de cada activo sin esperar al zoom. En el
   * visor las etiquetas aparecen solo de cerca, porque con dos mil seiscientos
   * puntos el mapa se vuelve una mancha de texto; en una lámina impresa, en
   * cambio, los rótulos son el contenido —un plano sin nombres no sirve para
   * ir a buscar la estructura al campo—.
   *
   * Con "nombre" se rotula solo el nombre: en el papel no hay sitio para la
   * capa y el número, y el nombre es lo que figura en la ficha.
   */
  /**
   * `limites` recorta a lo que se ve. Sin recortar, el inventario entero son
   * más de tres mil marcadores y dibujarlos de una vez bloquea el navegador
   * medio segundo largo, aunque la mayoría caigan fuera de la pantalla. La
   * lámina temática lo usa porque su encuadre cubre ocho kilómetros y el
   * resto del valle no se ve.
   *
   * Lleva holgura a propósito: al desplazar el mapa, el recorte se recalcula
   * después del movimiento, y sin margen se verían huecos mientras tanto.
   */
  const dentro = (lat, lng) => {
    if (!limites) return true;
    const hLat = (limites.norte - limites.sur) * 0.25;
    const hLng = (limites.este - limites.oeste) * 0.25;
    return lat >= limites.sur - hLat && lat <= limites.norte + hLat
      && lng >= limites.oeste - hLng && lng <= limites.este + hLng;
  };
  // `racimo` fuerza el agrupamiento para esta vista sin tocar la preferencia
  // del usuario: la lámina temática lo necesita apagado siempre —en el papel
  // saldrían burbujas con un número en vez de las estructuras— pero quien
  // trabaja en el visor lo quiere como lo dejó.
  const conRacimo = racimo == null ? inv.cluster : racimo;
  const mapa = useMap();
  const refCluster = useRef(null);
  const [zoom, setZoom] = useState(() => mapa.getZoom());
  /* Quién tiene licencia. Sale de la capa de áreas, que ya se descarga y no
   * se dibuja: su único trabajo es decir qué códigos catastrales la tienen.
   * Se recalcula solo cuando esa capa llega o cambia de ámbito. */
  const fcLicencias = inv.datosDe(CAPA_LICENCIAS);
  const conLicencia = useMemo(() => codcatsConLicencia(fcLicencias), [fcLicencias]);

  const rotular = etiquetas ? true : zoom >= ZOOM_ETIQUETAS;
  /* Ensena o esconde el rotulo de UN sector segun el sitio que tenga en
   * pantalla. Lo gobierna la propia capa, no un efecto de React: el primer
   * intento recorria el mapa desde un useEffect y salia siempre a cero,
   * porque ese efecto corre antes de que las capas lleguen a anadirse. */
  const ajustarRotulo = useCallback((layer) => {
    const tt = layer.getTooltip?.();
    const b = layer.getBounds?.();
    if (!tt || !b || !mapa) return;
    const a = mapa.latLngToContainerPoint(b.getNorthWest());
    const c = mapa.latLngToContainerPoint(b.getSouthEast());
    const lado = Math.min(Math.abs(c.x - a.x), Math.abs(c.y - a.y));
    tt.setOpacity(etiquetas || lado >= MIN_PX_SECTOR ? 1 : 0);
  }, [mapa, etiquetas]);

  useEffect(() => {
    const alZoom = () => setZoom(mapa.getZoom());
    mapa.on('zoomend', alZoom);
    return () => mapa.off('zoomend', alZoom);
  }, [mapa]);
  const { destacado, limpiarDestacado } = inv;
  const DEPURAR = false;   // ponlo en true para ver el rastro en consola

  useEffect(() => {
    if (!destacado) return;
    let cancelado = false;
    let intentos = 0;
    let temporizador = null;

    // El marcador se busca en el propio mapa por sus coordenadas, no por
    // referencias de React: los refs en callbacks inline se pierden entre
    // renders y quedaba solo uno registrado de los cuarenta y nueve.
    // La tolerancia es ~1 m, suficiente para no confundir dos estructuras.
    const TOL = 1e-5;
    const coincide = (capa) => {
      if (!capa || !capa.getLatLng || !capa.getPopup || !capa.getPopup()) return false;
      const ll = capa.getLatLng();
      return Math.abs(ll.lat - destacado.lat) < TOL
          && Math.abs(ll.lng - destacado.lng) < TOL;
    };
    const hallar = () => {
      // Dentro del racimo el marcador puede no estar en el mapa todavía:
      // markercluster solo añade los que toca dibujar. Por eso se busca en
      // la lista del grupo, no recorriendo las capas del mapa.
      //
      // Con el racimo apagado NO se consulta el grupo aunque la referencia
      // siga apuntando a algo: sería un grupo ya desmontado, y sus marcadores
      // no están en el mapa. Abrirles el popup no haría nada y la búsqueda
      // fallaría sin decir por qué. Se recorre el mapa, que es la verdad.
      const grupo = conRacimo ? refCluster.current : null;
      if (grupo && grupo.getLayers) {
        const m = grupo.getLayers().find(coincide);
        if (m) return m;
      }
      let encontrado = null;
      mapa.eachLayer((capa) => {
        if (!encontrado && coincide(capa)) encontrado = capa;
      });
      return encontrado;
    };

    // El popup se abre DESPUÉS del vuelo: si se abre antes, el propio
    // desplazamiento del mapa lo cierra.
    const abrir = () => {
      if (cancelado) return;
      const m = hallar();
      if (DEPURAR) console.log('[inv] intento', intentos, '| marcador:', !!m);
      if (m) {
        const grupo = conRacimo ? refCluster.current : null;
        // Si está agrupado, el popup no se puede abrir sin desplegarlo antes.
        if (grupo && grupo.hasLayer && grupo.hasLayer(m) && grupo.zoomToShowLayer) {
          grupo.zoomToShowLayer(m, () => m.openPopup());
        } else {
          m.openPopup();
        }
        limpiarDestacado();
        return;
      }
      // la capa puede estar descargándose todavía
      if (++intentos < 30) temporizador = setTimeout(abrir, 200);
      else {
        if (DEPURAR) console.warn('[inv] sin marcador en', destacado);
        limpiarDestacado();       // sin marcador, queda el vuelo hecho
      }
    };

    mapa.flyTo([destacado.lat, destacado.lng], 17, { duration: 1.2 });
    mapa.once('moveend', abrir);
    // por si el mapa ya estaba en el punto y moveend no llega a dispararse
    temporizador = setTimeout(abrir, 1600);

    return () => {
      cancelado = true;
      clearTimeout(temporizador);
      mapa.off('moveend', abrir);
    };
    // conRacimo entra en las dependencias porque el efecto lo lee: si se
    // apaga el racimo mientras hay una búsqueda en vuelo, hay que rehacerla
    // contra el mapa en vez de contra un grupo que ya no está.
  }, [destacado, mapa, limpiarDestacado, conRacimo]);

  return (
    <>
      {TODAS.map(capa => {
        // Las capas de solo-datos alimentan a otra y no se dibujan.
        if (capa.oculta) return null;
        if (!inv.visibles[capa.codigo]) return null;
        const fc = inv.datosDe(capa.codigo);
        if (!fc?.features?.length) return null;

        // Líneas y polígonos: un solo GeoJSON por capa.
        if (capa.tipo === 'line' || capa.tipo === 'poly') {
          // Un color por sector, repartido para que dos vecinos no repitan.
          const porSector = capa.porSector ? datosDeCapa(fc) : null;
          // Verde o naranja según tenga licencia de agua.
          const licencias = capa.porLicencia ? conLicencia : null;
          return (
            <GeoJSON
              // El rótulo se ata al crear la capa, y onEachFeature no se
              // vuelve a ejecutar: la clave lleva el estado para que Leaflet
              // la rehaga al cruzar el zoom.
              key={`inv-${capa.codigo}`}
              data={fc}
              style={(f) => {
                const tono = (porSector && porSector.color(f))
                  || (licencias && colorLote(f, licencias, capa.color))
                  || capa.color;
                // Las obras del PECH van más tenues: son contexto.
                const esPech = (f?.properties?.ambito) === 'PECH';
                /*
                 * El papel no perdona lo que la pantalla sí.
                 *
                 * En un monitor, un polígono con 4 % de relleno y un borde de
                 * 1.2 px se ve: la pantalla ilumina y el ojo lo encuentra. Al
                 * imprimirlo a A1 sobre imagen satelital, ese mismo polígono
                 * desaparece —y con él el límite del sector, que es media
                 * razón de ser de la lámina—. Lo mismo con las líneas de
                 * contexto, que al 50 % y punteadas se confunden con un camino
                 * de la foto.
                 *
                 * Así que para imprimir se sube el trazo y se le da borde
                 * franco a las áreas, sin llegar a tapar la imagen: el relleno
                 * sigue siendo tenue, lo que manda es el contorno.
                 */
                const grueso = impresion ? 1.6 : 1;
                return {
                  color: tono,
                  // El grosor es la otra mitad de la jerarquía: el troncal
                  // pesa, las ramas adelgazan. Sin esto, cuatro pasos de
                  // azul no se distinguen de un vistazo.
                  weight: capa.tipo === 'line'
                    ? (capa.weight || 3) * grueso
                    : (porSector ? (impresion ? 2.6 : 2) : (impresion ? 2.2 : 1.2)),
                  opacity: (esPech && !porSector) ? (impresion ? 0.8 : 0.5) : 0.95,
                  // Un sector con color propio NO va punteado aunque sea del
                  // PECH: el guion lo decia "esto es contexto", y aqui el
                  // sector es justo lo que se quiere leer.
                  dashArray: (esPech && !porSector) ? '6 4' : (capa.dash || null),
                  fillColor: tono,
                  // Las áreas van casi sin relleno: son el suelo sobre el que
                  // se leen los canales, no la información principal. Con
                  // relleno fuerte tapaban la imagen satelital entera.
                  // Con color propio el relleno sube un poco: es lo que
                  // separa un sector del de al lado. Sigue siendo tenue, que
                  // debajo hay imagen satelital que no se debe tapar.
                  fillOpacity: capa.tipo !== 'poly' ? 0
                    : (porSector || licencias) ? (impresion ? 0.26 : 0.20)
                    : (impresion ? (esPech ? 0.10 : 0.16) : (esPech ? 0.04 : 0.08)),
                };
              }}
              onEachFeature={(f, layer) => {
                const p = f.properties || {};
                const filas = Object.entries(p)
                  .filter(([k, v]) => v !== null && v !== '' && k !== 'fid')
                  .slice(0, 10)
                  .map(([k, v]) => `<tr><th>${k.replace(/_/g, ' ')}</th><td>${v}</td></tr>`)
                  .join('');
                const amb = p.ambito || '';
                const chip = amb
                  ? `<span class="inv-badge-ambito amb-${amb}">`
                    + `${amb === 'JURP' ? 'JURP' : amb === 'PECH' ? 'Chavimochic' : 'sin ámbito'}`
                    + '</span>'
                  : '';
                const nombre = porSector ? porSector.nombre(f) : null;
                // La licencia, con todas las letras: el color la cuenta de un
                // vistazo, pero quien abre el globo quiere leerla.
                const lic = licencias
                  ? `<div class="inv-pop-lic ${tieneLicencia(f, licencias) ? 'si' : 'no'}">`
                    + `${textoLicencia(f, licencias)}</div>`
                  : '';
                layer.bindPopup(
                  `<div class="inv-pop"><div class="inv-pop-tit">${nombre || capa.label}</div>
                   <div class="inv-pop-sub">${nombre ? `${capa.label} ` : ''}${chip}</div>
                   ${lic}
                   <table class="inv-pop-tabla"><tbody>${filas}</tbody></table></div>`
                );
                // El nombre, en el centro del sector. Se ata siempre; quien
                // decide si se ve es el efecto de arriba, segun el sitio que
                // tenga el poligono en pantalla.
                if (nombre) {
                  layer.bindTooltip(nombre, {
                    permanent: true, direction: 'center',
                    className: 'inv-eti-sector', opacity: 1,
                  });
                  // Cada sector se vigila a si mismo: al entrar al mapa y en
                  // cada cambio de zoom. Asi no depende de cuando React
                  // decida repintar ni hay que recorrer dos mil capas.
                  const ajustar = () => ajustarRotulo(layer);
                  layer.on('add', ajustar);
                  layer.on('remove', () => mapa.off('zoomend', ajustar));
                  mapa.on('zoomend', ajustar);
                  ajustar();
                }
              }}
            />
          );
        }
        return null;
      })}

      {/* Los puntos de TODAS las capas van al mismo racimo. Uno por capa
          dejaría veintidós racimos pisándose en el mismo sitio; con uno
          solo, lo que se ve es cuántas estructuras hay en cada zona.

          El racimo se puede apagar: para documentar con una captura estorba,
          porque en la foto salen burbujas con un número en vez de los activos. */}
      <Racimo activo={conRacimo} innerRef={refCluster}>
      {!sinPuntos && TODAS.map(capa => {
        if (!inv.visibles[capa.codigo]) return null;
        if (capa.tipo === 'line' || capa.tipo === 'poly') return null;
        const fc = inv.datosDe(capa.codigo);
        if (!fc?.features?.length) return null;

        // Puntos: marcador propio para poder pintar el estado evaluado.
        return fc.features.map(f => {
          const c = f.geometry?.coordinates;
          if (!c) return null;
          const [lng, lat] = Array.isArray(c[0]) ? c[0] : c;  // MultiPoint o Point
          if (typeof lat !== 'number' || typeof lng !== 'number') return null;
          if (!dentro(lat, lng)) return null;

          const p = f.properties || {};
          const ev = inv.evaluacionDe(capa.codigo, p.fid);
          const entraEnCampania = p.ambito === 'JURP' || !!capa.evaluable;
          const esDestacado = destacado
            && destacado.tipo === capa.codigo
            && String(destacado.fid) === String(p.fid);

          return (
            <Marker
              key={`inv-${capa.codigo}-${p.fid}`}
              position={[lat, lng]}
              icon={iconoActivo(capa.color, ev?.estado_cons, p.ambito, capa.ico)}
              eventHandlers={{
                // Si el marcador se agrega al mapa siendo el destacado —el
                // caso de una capa que acaba de descargarse— se abre aquí,
                // que es el único momento en que existe con certeza.
                add: (e) => {
                  if (esDestacado) setTimeout(() => e.target.openPopup(), 80);
                },
              }}
            >
              {rotular && (etiquetas !== 'nombre' || p.nombre) && (
                <Tooltip permanent direction="right" offset={[12, 0]}
                  className={`inv-eti${etiquetas ? ' inv-eti-lamina' : ''}`} opacity={1}>
                  {/* El texto va en su propio span para poder devolverle el
                      giro cuando la lámina está orientada: si gira con el
                      mapa, el rótulo sale tumbado y no se lee. */}
                  {etiquetas === 'nombre'
                    ? <span className="inv-eti-txt">{p.nombre}</span>
                    : (p.nombre || p.codigo || `${capa.label} #${p.fid}`)}
                </Tooltip>
              )}
              <Popup>
                <div className="inv-pop">
                  <div className="inv-pop-tit" style={{ borderColor: capa.color }}>
                    {capa.ico && <img src={capa.ico} alt="" className="inv-pop-ico" />}
                    {p.nombre || p.codigo || `${capa.label} #${p.fid}`}
                  </div>
                  <div className="inv-pop-sub">
                    {capa.label}
                    {p.ambito && (
                      <span className={`inv-badge-ambito amb-${p.ambito}`}>
                        {p.ambito === 'JURP' ? 'JURP' :
                         p.ambito === 'PECH' ? 'Chavimochic' : 'sin ámbito'}
                      </span>
                    )}
                  </div>

                  {/* EL GLOBO ES EL VISTAZO, NO LA FICHA. Enseña lo que sitúa
                      la estructura y poco más; todo lo que trae la capa está
                      en la ficha, que es donde cabe y donde no se cierra al
                      pulsar fuera. Antes esta tabla era la única forma de ver
                      características, y por eso mostraba ocho campos elegidos
                      a mano y escondía el resto sin decirlo.

                      tbody explícito: sin él React avisa de anidamiento
                      inválido. */}
                  <table className="inv-pop-tabla">
                    <tbody>
                      {p.nombre_canal && <tr><th>Canal</th><td>{p.nombre_canal}</td></tr>}
                      {p.progresiva != null && <tr><th>Progresiva</th><td>{p.progresiva}</td></tr>}
                      {p.tipo && <tr><th>Tipo</th><td>{p.tipo}</td></tr>}
                      {p.estado && <tr><th>Estado (base)</th><td>{p.estado}</td></tr>}
                    </tbody>
                  </table>

                  {/* En la lámina no: ahí el mapa es una hoja para imprimir,
                      no hay dónde abrir una pantalla completa, y la vista que
                      la dibuja no monta la ficha. Un botón que no hace nada es
                      peor que no tenerlo. */}
                  {!impresion && (
                    <button type="button" className="inv-btn-ficha"
                      onClick={() => inv.abrirFicha(capa.codigo, p.fid, p, capa)}>
                      <FaListUl size={10} /> Ver ficha y fotos
                    </button>
                  )}

                  {ev ? (
                    <div className="inv-pop-eval" style={{ '--e': COLOR_ESTADO[ev.estado_cons] }}>
                      <div className="inv-pop-eval-tit">
                        Campaña {ev.campania_anio || inv.campania?.anio} ·
                        evaluado el {ev.fecha}
                        {ev.evaluador && ` · ${ev.evaluador}`}
                      </div>
                      <div className="inv-pop-eval-estado">
                        {ETIQUETA_ESTADO[ev.estado_cons] || ev.estado_cons}
                        {ev.condicion && (
                          <span className="inv-pop-cond"
                            style={{ '--c': COLOR_CONDICION[ev.condicion] || '#868e96' }}>
                            {ev.condicion}
                          </span>
                        )}
                        {ev.requiere_mant && <span className="inv-pop-mant">requiere mantenimiento</span>}
                      </div>

                      {/* lo levantado en campo, comparado con el dato base */}
                      {ev.valores && Object.keys(ev.valores).length > 0 && (
                        <table className="inv-pop-valores">
                          <tbody>
                            {Object.entries(ev.valores).map(([k, v]) => {
                              const base = p[k];
                              const cambio = base !== undefined
                                && String(base) !== String(v);
                              return (
                                <tr key={k} className={cambio ? 'cambio' : ''}>
                                  <th>{k.replace(/_/g, ' ')}</th>
                                  <td>
                                    {cambio && <s>{String(base)}</s>}
                                    {ETIQUETA_ESTADO[v] || String(v)}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      )}

                      {ev.observaciones && <div className="inv-pop-eval-obs">{ev.observaciones}</div>}
                    </div>
                  ) : entraEnCampania ? (
                    <div className="inv-pop-pend">
                      Sin evaluar en la campaña {inv.campania?.anio || ''}
                      {p.ambito === 'PECH' && ' — obra del PECH que opera la Junta'}
                      {p.campania_alta > (inv.campania?.anio || 0) &&
                        ' — alta posterior a esta campaña'}
                    </div>
                  ) : p.ambito === 'PECH' ? (
                    <div className="inv-pop-pend">
                      Obra del PECH — fuera del alcance de la campaña
                    </div>
                  ) : null}

                  {/* Entra en campaña lo que administra la Junta, más las
                      capas marcadas como evaluables aunque la obra sea de
                      terceros: la Junta las opera y las inventaría. */}
                  {entraEnCampania && inv.campania
                    && inv.campania.estado !== 'cerrada' && (
                    <button type="button" className="inv-btn-evaluar"
                      onClick={() => inv.abrirEvaluacion(capa.codigo, p.fid, p)}>
                      {ev ? 'Editar evaluación' : 'Evaluar'}
                    </button>
                  )}
                </div>
              </Popup>
            </Marker>
          );
        });
      })}
      </Racimo>
    </>
  );
}

/* ══════════════════════════════════════════════════════════
   Formulario de evaluación

   Los campos no están escritos aquí: se piden a la API, que los devuelve
   con sus opciones ya resueltas. Agregar un campo evaluable en la base
   lo hace aparecer en este formulario sin tocar el visor.
   ══════════════════════════════════════════════════════════ */
/**
 * Decide si un campo debe desaparecer del formulario por lo que ya se
 * respondió antes. Dos reglas, las dos tomadas de cómo se llena la ficha:
 *
 *  1. El detalle de una pregunta de inspección solo tiene sentido si la
 *     respuesta fue «Sí». Preguntar «¿está obstruida?» → No y acto seguido
 *     pedir el detalle de la obstrucción es pedir que se deje en blanco.
 *  2. Un bloque que empieza por «¿cuenta con…?» respondido No no necesita
 *     material, estado ni dimensiones. Se mira cualquier prefijo ancestro,
 *     así que un No en 'pur_hay' esconde también 'pur_esc_estado'.
 *
 * Solo esconde con un No explícito: sin responder, el campo sigue visible.
 */
function ocultoPorRespuesta(campo, valores) {
  const n = campo.campo;

  if (n.startsWith('insp_') && n.endsWith('_c')) {
    return valores[n.slice(0, -2)] !== 'S';
  }

  const partes = n.split('_');
  for (let i = 1; i < partes.length; i++) {
    const padre = partes.slice(0, i).join('_') + '_hay';
    if (padre !== n && valores[padre] === 'N') return true;
  }
  return false;
}

export function ModalEvaluacion({ inv }) {
  const [valores, setValores] = useState({});
  const [resumen, setResumen] = useState({});
  const [guardando, setGuardando] = useState(false);
  const [fallo, setFallo] = useState(null);
  const [cerradas, setCerradas] = useState({});
  // Tras un guardado fallido, los obligatorios vacíos se pintan en rojo.
  const [senalar, setSenalar] = useState(false);
  const cuerpo = useRef(null);

  const ev = inv.evaluando;
  const campos = ev ? (inv.formularios[ev.tipo] || null) : null;
  const previa = ev ? inv.evaluacionDe(ev.tipo, ev.fid) : null;

  // Las fichas del ANA llegan a setenta campos y en una sola lista no se
  // pueden llenar en un teléfono. La ficha de papel va por bloques (Ingreso,
  // Cuerpo, Salida, Inspección…) y el catálogo los trae en la etiqueta, antes
  // del separador ' · ', así que el formulario los recupera de ahí. Sin
  // separador, el campo va al bloque general, que queda arriba y abierto.
  const secciones = useMemo(() => {
    if (!campos) return null;
    const grupos = [];
    const porNombre = new Map();
    campos.forEach(c => {
      const corte = c.etiqueta.indexOf(' · ');
      const titulo = corte > 0 ? c.etiqueta.slice(0, corte) : '';
      const etiqueta = corte > 0 ? c.etiqueta.slice(corte + 3) : c.etiqueta;
      if (!porNombre.has(titulo)) {
        const g = { titulo, campos: [] };
        porNombre.set(titulo, g);
        grupos.push(g);
      }
      // La etiqueta corta evita repetir el nombre del bloque en cada fila;
      // la larga se conserva porque es la que valida 'guardar'.
      porNombre.get(titulo).campos.push({ ...c, corta: etiqueta });
    });
    return grupos;
  }, [campos]);

  // Al abrir: precarga con la evaluación previa si existe, y si no con el
  // dato que ya tiene el inventario. El técnico confirma o corrige, en vez
  // de escribir todo de cero.
  useEffect(() => {
    if (!ev || !campos) return;
    const inicial = {};
    campos.forEach(c => {
      const dePrevia = previa?.valores?.[c.campo];
      const deBase = ev.props?.[c.campo];
      inicial[c.campo] = dePrevia !== undefined && dePrevia !== null
        ? dePrevia
        : (deBase !== undefined && deBase !== null ? deBase : '');
    });
    setValores(inicial);
    setResumen({
      evaluador: previa?.evaluador || localStorage.getItem('userName') || '',
      observaciones: previa?.observaciones || '',
      requiere_mant: previa?.requiere_mant || false,
      prioridad: previa?.prioridad || '',
    });
    setFallo(null);
    setSenalar(false);
  }, [ev?.tipo, ev?.fid, campos]);

  if (!ev) return null;

  const cambiar = (campo, v) => setValores(s => ({ ...s, [campo]: v }));

  const guardar = async () => {
    // Un campo que el formulario escondió no se exige ni se envía: si el
    // técnico dijo que no hay canal de salida, un material tecleado antes de
    // cambiar de respuesta quedaría guardado contradiciendo al propio dato.
    const activos = (campos || []).filter(c => !ocultoPorRespuesta(c, valores));

    const faltan = activos
      .filter(c => c.obligatorio && (valores[c.campo] === '' || valores[c.campo] == null));
    if (faltan.length) {
      /* Antes esto era una lista de nombres al pie del formulario y había que
       * ir buscándolos a mano por bloques cerrados. Ahora se abren los bloques
       * que los contienen, se marcan los campos en rojo y la vista salta al
       * primero: el mensaje dice cuántos son, la pantalla dice cuáles. */
      setSenalar(true);
      const conFalta = new Set(faltan.map(c => {
        const corte = c.etiqueta.indexOf(' · ');
        return corte > 0 ? c.etiqueta.slice(0, corte) : '';
      }));
      setCerradas(s => {
        const n = { ...s };
        conFalta.forEach(t => { if (t) n[t] = false; });
        return n;
      });
      setFallo(faltan.length === 1
        ? 'Falta un campo obligatorio, marcado en rojo.'
        : `Faltan ${faltan.length} campos obligatorios, marcados en rojo.`);
      // Tras repintar con los bloques abiertos, llevar la vista al primero.
      setTimeout(() => {
        cuerpo.current?.querySelector('.inv-campo.falta')
          ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }, 60);
      return;
    }

    setGuardando(true);
    setSenalar(false);
    setFallo(null);

    // los numéricos viajan como número, no como texto
    const limpios = {};
    activos.forEach(c => {
      const v = valores[c.campo];
      if (v === '' || v == null) return;
      limpios[c.campo] = (c.tipo_dato === 'numero' || c.tipo_dato === 'entero')
        ? Number(v) : v;
    });

    const r = await inv.guardarEvaluacion(ev.tipo, ev.fid, {
      valores: limpios,
      // se replican fuera del JSON para poder filtrar sin abrirlo
      estado_cons: limpios.estado ?? null,
      condicion: limpios.observacio ?? null,
      evaluador: resumen.evaluador || null,
      observaciones: resumen.observaciones || null,
      requiere_mant: !!resumen.requiere_mant,
      prioridad: resumen.prioridad || null,
    });

    setGuardando(false);
    if (r.ok) inv.cerrarEvaluacion();
    else setFallo(r.error);
  };

  const nombre = ev.props?.nombre || ev.props?.codigo || `#${ev.fid}`;

  /* CUÁNTO FALTA. Una ficha del ANA son setenta campos repartidos en diez
   * bloques cerrados: sin esto, lo único que dice cuánto queda es el error al
   * intentar guardar, y entonces hay que abrir los bloques uno a uno. */
  const activos = (campos || []).filter(c => !ocultoPorRespuesta(c, valores));
  const sinLlenar = activos.filter(
    c => c.obligatorio && (valores[c.campo] === '' || valores[c.campo] == null));
  const obligatorios = activos.filter(c => c.obligatorio).length;
  const hechos = obligatorios - sinLlenar.length;
  const pct = obligatorios ? Math.round((hechos / obligatorios) * 100) : 100;

  const todas = (cerrar) => setCerradas(
    Object.fromEntries((secciones || []).map(g => [g.titulo, cerrar])));

  return (
    <div className="inv-modal-fondo" onClick={inv.cerrarEvaluacion}>
      <div className="inv-modal inv-eval gis-glass" onClick={e => e.stopPropagation()}>

        <div className="inv-modal-head">
          <div>
            <div className="inv-modal-tit">{nombre}</div>
            <div className="inv-modal-sub">
              {ev.tipo.replace(/_/g, ' ')} · campaña {inv.campania?.anio}
              {previa && <span className="inv-modal-previa">ya evaluado</span>}
            </div>
          </div>
          <button className="gis-tool" style={{ width: 26, height: 26 }}
            onClick={inv.cerrarEvaluacion}><FaTimes /></button>
        </div>

        {obligatorios > 0 && (
          <div className={`inv-avanza${sinLlenar.length === 0 ? ' listo' : ''}`}>
            <div className="inv-avanza-barra">
              <i style={{ width: `${pct}%` }} />
            </div>
            <span className="inv-avanza-txt">
              {sinLlenar.length === 0
                ? <><FaCheckCircle size={11} /> Obligatorios completos</>
                : <>Faltan <b>{sinLlenar.length}</b> de {obligatorios} obligatorios</>}
            </span>
            {secciones && secciones.length > 2 && (
              <span className="inv-avanza-todo">
                <button type="button" onClick={() => todas(false)}>Abrir todo</button>
                <button type="button" onClick={() => todas(true)}>Cerrar todo</button>
              </span>
            )}
          </div>
        )}

        <div className="inv-modal-body" ref={cuerpo}>
          {!campos && (
            <div className="inv-cargando">
              <FaSyncAlt className="icon-spin" /> Cargando formulario…
            </div>
          )}

          {campos && campos.length === 0 && (
            <div className="inv-error">
              <FaExclamationCircle /> Este tipo de activo no tiene campos
              evaluables definidos.
            </div>
          )}

          {secciones && secciones.map((g, i) => {
            // El bloque general va abierto; los demás cerrados, porque con
            // diez bloques abiertos de golpe no se ve dónde empieza nada.
            const abierta = g.titulo === '' || !(cerradas[g.titulo] ?? true);
            const visibles = g.campos.filter(c => !ocultoPorRespuesta(c, valores));
            if (!visibles.length) return null;
            const faltanAqui = visibles.filter(
              c => c.obligatorio && (valores[c.campo] === '' || valores[c.campo] == null)
            ).length;

            return (
              <div className="inv-bloque" key={g.titulo || '_general'}>
                {g.titulo !== '' && (
                  <button type="button"
                    className={`inv-bloque-tit${abierta ? ' abierta' : ''}`}
                    onClick={() => setCerradas(s => ({ ...s, [g.titulo]: abierta }))}>
                    {abierta ? <FaChevronDown size={10} /> : <FaChevronRight size={10} />}
                    <span>{g.titulo}</span>
                    {/* Qué hay dentro, sin tener que abrirlo. */}
                    <em className="inv-bloque-n">{visibles.length}</em>
                    {faltanAqui > 0
                      ? <b className="inv-bloque-falta">{faltanAqui}</b>
                      : <FaCheckCircle className="inv-bloque-ok" size={11} />}
                  </button>
                )}

                {abierta && (
                  <div className="inv-campos">
                    {visibles.map(c => {
                      const base = ev.props?.[c.campo];
                      const cambiado = base != null && String(base) !== String(valores[c.campo]);
                      const vacio = valores[c.campo] === '' || valores[c.campo] == null;
                      // Tras un intento de guardado fallido, el campo que falta
                      // se marca en rojo. Antes el único aviso era una lista de
                      // nombres al pie, y había que buscarlos a mano.
                      const senalado = senalar && c.obligatorio && vacio;
                      const esTexto = c.tipo_dato === 'texto' && /detalle|observ/i.test(c.corta);
                      return (
                        <div
                          className={`inv-campo${esTexto ? ' ancho' : ''}${senalado ? ' falta' : ''}`}
                          key={c.campo}>
                          <label>
                            {c.corta}
                            {c.obligatorio && <b className="inv-req">*</b>}
                            {cambiado && (
                              <span className="inv-campo-base">antes: {String(base)}</span>
                            )}
                          </label>

                          {c.tipo_dato === 'opcion' && c.opciones?.length ? (
                            <select value={valores[c.campo] ?? ''}
                                    onChange={e => cambiar(c.campo, e.target.value)}>
                              <option value="">— sin dato —</option>
                              {c.opciones.map(o => (
                                <option key={o.codigo} value={o.codigo}>{o.etiqueta}</option>
                              ))}
                            </select>
                          ) : c.tipo_dato === 'booleano' ? (
                            <label className="inv-check">
                              <input type="checkbox" checked={!!valores[c.campo]}
                                     onChange={e => cambiar(c.campo, e.target.checked)} />
                              <span>{valores[c.campo] ? 'Sí' : 'No'}</span>
                            </label>
                          ) : esTexto ? (
                            <textarea rows={2} value={valores[c.campo] ?? ''}
                                      onChange={e => cambiar(c.campo, e.target.value)} />
                          ) : (
                            <input
                              type={c.tipo_dato === 'numero' || c.tipo_dato === 'entero'
                                    ? 'number' : 'text'}
                              step={c.tipo_dato === 'numero' ? '0.01' : '1'}
                              value={valores[c.campo] ?? ''}
                              onChange={e => cambiar(c.campo, e.target.value)} />
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}

          <div className="inv-modal-sep">Registro</div>

          <div className="inv-campos">
            <div className="inv-campo">
              <label>Evaluador</label>
              <input type="text" value={resumen.evaluador}
                placeholder="Nombre de quien evalúa"
                onChange={e => setResumen(s => ({ ...s, evaluador: e.target.value }))} />
            </div>

            <div className="inv-campo inv-campo-fila">
              <label className="inv-check">
                <input type="checkbox" checked={resumen.requiere_mant}
                  onChange={e => setResumen(s => ({ ...s, requiere_mant: e.target.checked }))} />
                <span>Requiere mantenimiento</span>
              </label>
              {resumen.requiere_mant && (
                <select value={resumen.prioridad}
                  onChange={e => setResumen(s => ({ ...s, prioridad: e.target.value }))}>
                  <option value="">Prioridad…</option>
                  <option value="alta">Alta</option>
                  <option value="media">Media</option>
                  <option value="baja">Baja</option>
                </select>
              )}
            </div>

            <div className="inv-campo ancho">
              <label>Observaciones</label>
              <textarea rows={3} value={resumen.observaciones}
                placeholder="Detalle de lo observado en campo"
                onChange={e => setResumen(s => ({ ...s, observaciones: e.target.value }))} />
            </div>
          </div>

          {fallo && (
            <div className="inv-error"><FaExclamationCircle /> {fallo}</div>
          )}
        </div>

        <div className="inv-modal-pie">
          <button className="inv-btn-sec" onClick={inv.cerrarEvaluacion}>
            Cancelar
          </button>
          <button className="inv-btn-pri" onClick={guardar}
                  disabled={guardando || !campos?.length}>
            {guardando ? 'Guardando…' : (previa ? 'Actualizar' : 'Guardar evaluación')}
          </button>
        </div>

      </div>
    </div>
  );
}


/* ══════════════════════════════════════════════════════════
   Ficha del activo: lo que se sabe de la estructura, y sus fotos

   AL PULSAR UNA ESTRUCTURA solo salía un globo con ocho campos escogidos a
   mano. Lo demás que traía la capa —la luz de una alcantarilla, el número de
   hojas de una compuerta, el año— se descartaba sin decirlo, y no había forma
   de saber desde la pantalla que existía.

   La ficha enseña todas las características y añade lo que faltaba del todo:
   las fotos. Un inventario de obra sin fotografía obliga a ir hasta la
   estructura para saber cómo está, que es justo lo que el inventario debería
   ahorrar.

   NO ES UN GLOBO MÁS GRANDE. Un globo de Leaflet se cierra al pulsar el mapa,
   y eso es inaceptable mientras se sube una foto desde el teléfono con la
   cobertura de Chao. La ficha es un panel aparte, que solo se cierra cuando
   se le dice.
   ══════════════════════════════════════════════════════════ */

/* El contrato con el servidor, en un solo sitio.
 *
 *   GET    fotos/?tipo_activo=T&activo_fid=N   → lista
 *   POST   fotos/   multipart                  → { id, imagen, ... }
 *   DELETE fotos/<id>/
 *
 * La forma imita la de evaluaciones —se consulta por (tipo_activo, activo_fid)
 * y se crea mandando los dos— para que el backend no tenga que inventar una
 * convención nueva para esto.
 */
const API_FOTOS = `${API}/fotos/`;

function GaleriaFotos({ tipo, fid, nombre }) {
  const [fotos, setFotos] = useState(null);      // null = todavía cargando
  const [fallo, setFallo] = useState(null);
  const [subiendo, setSubiendo] = useState([]);  // [{ nombre, estado, nota }]
  const [mirando, setMirando] = useState(-1);    // índice en el visor grande
  const [encima, setEncima] = useState(false);   // arrastrando un archivo
  const entrada = useRef(null);
  const vivo = useRef(true);

  useEffect(() => { vivo.current = true; return () => { vivo.current = false; }; }, []);

  const cargar = useCallback(async () => {
    setFallo(null);
    try {
      const r = await fetch(`${API_FOTOS}?tipo_activo=${encodeURIComponent(tipo)}`
                            + `&activo_fid=${encodeURIComponent(fid)}`,
                            { headers: cabeceras() });
      if (!vivo.current) return;
      if (r.status === 404) {
        // Distinguir "no hay fotos" de "el servidor no sabe de fotos" importa:
        // lo primero lo arregla el inspector, lo segundo no.
        setFotos([]);
        setFallo('sin-endpoint');
        return;
      }
      if (!r.ok) { setFotos([]); setFallo(`Error ${r.status}`); return; }
      const d = await r.json();
      setFotos(ordenarFotos(d.results || d || []));
    } catch (e) {
      if (vivo.current) { setFotos([]); setFallo('No se pudo consultar'); }
    }
  }, [tipo, fid]);

  useEffect(() => { setFotos(null); cargar(); }, [cargar]);

  // Esc cierra el visor grande antes que la ficha.
  useEffect(() => {
    if (mirando < 0) return undefined;
    const h = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); setMirando(-1); }
      if (e.key === 'ArrowRight') setMirando(i => Math.min((fotos?.length || 1) - 1, i + 1));
      if (e.key === 'ArrowLeft') setMirando(i => Math.max(0, i - 1));
    };
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, [mirando, fotos]);

  const subir = useCallback(async (archivos) => {
    const lista = [...archivos].filter(Boolean);
    if (!lista.length) return;

    // Se marcan todas en pantalla antes de empezar: en campo la subida tarda,
    // y sin acuse el inspector vuelve a pulsar y sube la foto dos veces.
    setSubiendo(lista.map(a => ({ nombre: a.name, estado: 'espera' })));

    for (let i = 0; i < lista.length; i++) {
      const archivo = lista[i];
      const marcar = (estado, nota) => setSubiendo(s =>
        s.map((x, j) => (j === i ? { ...x, estado, nota } : x)));

      const malo = motivoRechazo(archivo);
      if (malo) { marcar('error', malo); continue; }

      marcar('preparando');
      const { archivo: listo, reducida, antes, despues } = await prepararFoto(archivo);
      marcar('subiendo', reducida ? `${peso(antes)} → ${peso(despues)}` : null);

      try {
        const fd = new FormData();
        fd.append('tipo_activo', tipo);
        fd.append('activo_fid', String(fid));
        fd.append('imagen', listo, listo.name);
        const r = await fetch(API_FOTOS, { method: 'POST', headers: cabeceras(), body: fd });
        if (!r.ok) {
          const d = await r.json().catch(() => ({}));
          const detalle = Object.entries(d)
            .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(' ') : v}`).join(' · ');
          marcar('error', detalle || `Error ${r.status}`);
          continue;
        }
        marcar('ok');
      } catch (e) {
        marcar('error', 'No se pudo subir');
      }
    }

    await cargar();
    // Las que salieron bien desaparecen de la lista de progreso; los errores
    // se quedan, porque son lo único que hay que leer.
    if (vivo.current) setSubiendo(s => s.filter(x => x.estado === 'error'));
  }, [tipo, fid, cargar]);

  const borrar = useCallback(async (foto) => {
    const { isConfirmed } = await Swal.fire({
      icon: 'warning',
      title: '¿Borrar esta foto?',
      text: 'No se puede deshacer.',
      showCancelButton: true,
      confirmButtonText: 'Borrar',
      cancelButtonText: 'Conservar',
      confirmButtonColor: '#d63939',
      cancelButtonColor: '#5b7590',
      reverseButtons: true,
      // El foco empieza en Cancelar: un Intro de mas no debe borrar una foto
      // que alguien subio desde el campo y no se puede volver a tomar.
      focusCancel: true,
    });
    if (!isConfirmed) return;
    try {
      const r = await fetch(`${API_FOTOS}${foto.id}/`, { method: 'DELETE', headers: cabeceras() });
      if (!r.ok && r.status !== 204) { setFallo(`No se pudo borrar (${r.status})`); return; }
      setMirando(-1);
      setFotos(f => (f || []).filter(x => x.id !== foto.id));
    } catch (e) {
      setFallo('No se pudo borrar');
    }
  }, []);

  const soltar = (e) => {
    e.preventDefault();
    setEncima(false);
    if (e.dataTransfer?.files?.length) subir(e.dataTransfer.files);
  };

  const n = fotos?.length || 0;

  return (
    <>
      <div className="inv-modal-sep">
        <FaImages size={10} /> Fotos{n > 0 && ` · ${n}`}
      </div>

      {fotos === null && (
        <div className="inv-cargando"><FaSyncAlt className="icon-spin" /> Cargando fotos…</div>
      )}

      {fallo === 'sin-endpoint' && (
        <div className="inv-nota">
          Este servidor todavía no guarda fotos de activos. Las que subas no se
          perderán: se enviarán en cuanto el inventario tenga el almacén de
          fotos activado.
        </div>
      )}
      {fallo && fallo !== 'sin-endpoint' && (
        <div className="inv-error"><FaExclamationCircle /> {fallo}</div>
      )}

      {fotos !== null && n === 0 && fallo !== 'sin-endpoint' && (
        <div className="inv-nota">
          Sin fotos. La primera es la que más sirve: una vista general de la
          estructura, con el canal de fondo.
        </div>
      )}

      {n > 0 && (
        <div className="inv-fotos">
          {fotos.map((f, i) => (
            <button type="button" key={f.id ?? i} className="inv-foto"
              onClick={() => setMirando(i)}
              title={f.descripcion || `Foto ${i + 1} de ${nombre}`}>
              <img src={urlFoto(f)} alt={f.descripcion || `Foto ${i + 1}`} loading="lazy" />
              <span className="inv-foto-lupa"><FaExpand size={9} /></span>
            </button>
          ))}
        </div>
      )}

      {/* Zona de subida. El input lleva capture para que en el teléfono abra
          la cámara directamente, que es como se usa en campo. */}
      <div className={`inv-subir${encima ? ' encima' : ''}`}
        onDragOver={e => { e.preventDefault(); setEncima(true); }}
        onDragLeave={() => setEncima(false)}
        onDrop={soltar}>
        <input ref={entrada} type="file" accept="image/*" capture="environment" multiple
          style={{ display: 'none' }}
          onChange={e => { subir(e.target.files); e.target.value = ''; }} />
        <button type="button" className="inv-btn-foto" onClick={() => entrada.current?.click()}>
          <FaCamera size={11} /> Añadir fotos
        </button>
        <span className="inv-subir-pista">o arrástralas aquí</span>
      </div>

      {subiendo.length > 0 && (
        <ul className="inv-subiendo">
          {subiendo.map((s, i) => (
            <li key={`${s.nombre}:${i}`} className={s.estado}>
              {s.estado === 'error' ? <FaExclamationCircle size={9} />
                : s.estado === 'ok' ? '✓'
                : <FaSyncAlt className="icon-spin" size={9} />}
              <span className="inv-subiendo-nom">{s.nombre}</span>
              {s.nota && <span className="inv-subiendo-nota">{s.nota}</span>}
            </li>
          ))}
        </ul>
      )}

      {mirando >= 0 && fotos?.[mirando] && (
        <div className="inv-visor" onClick={() => setMirando(-1)}>
          <img src={urlFoto(fotos[mirando])} alt="" onClick={e => e.stopPropagation()} />
          <div className="inv-visor-barra" onClick={e => e.stopPropagation()}>
            <button type="button" disabled={mirando === 0}
              onClick={() => setMirando(i => i - 1)}><FaChevronLeft /></button>
            <span>{mirando + 1} / {n}</span>
            <button type="button" disabled={mirando === n - 1}
              onClick={() => setMirando(i => i + 1)}><FaChevronRight /></button>
            <button type="button" className="inv-visor-borrar"
              onClick={() => borrar(fotos[mirando])}><FaTrash /> Borrar</button>
            <button type="button" onClick={() => setMirando(-1)}><FaTimes /></button>
          </div>
        </div>
      )}
    </>
  );
}

export function FichaActivo({ inv }) {
  const f = inv.ficha;
  const tipo = f?.tipo;

  // Las etiquetas bonitas de cada campo salen del formulario de evaluación,
  // que ya se pide al abrir la ficha. Si no ha llegado, se usan los nombres
  // de columna: la ficha se ve igual, solo menos pulida.
  const etiquetas = useMemo(() => {
    const campos = tipo ? inv.formularios[tipo] : null;
    return Object.fromEntries((campos || [])
      .filter(c => c.campo && c.etiqueta).map(c => [c.campo, c.etiqueta]));
  }, [inv.formularios, tipo]);

  const filas = useMemo(() => caracteristicas(f?.props, etiquetas), [f, etiquetas]);
  const cob = useMemo(() => cobertura(f?.props), [f]);

  useEffect(() => {
    if (!f) return undefined;
    const h = (e) => { if (e.key === 'Escape') inv.cerrarFicha(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [f, inv]);

  if (!f) return null;

  const ev = inv.evaluacionDe(f.tipo, f.fid);
  const nombre = tituloActivo(f.props, f.capa?.label, f.fid);
  const evaluable = inv.campania && inv.campania.estado !== 'cerrada';

  return (
    <div className="inv-modal-fondo" onClick={inv.cerrarFicha}>
      <div className="inv-modal inv-ficha gis-glass" onClick={e => e.stopPropagation()}>

        <div className="inv-modal-head">
          <div>
            <div className="inv-modal-tit">{nombre}</div>
            <div className="inv-modal-sub">
              {f.capa?.label || f.tipo.replace(/_/g, ' ')}
              {f.props?.ambito && (
                <span className={`inv-badge-ambito amb-${f.props.ambito}`}>
                  {f.props.ambito === 'JURP' ? 'JURP'
                    : f.props.ambito === 'PECH' ? 'Chavimochic' : 'sin ámbito'}
                </span>
              )}
            </div>
          </div>
          <button className="gis-tool" style={{ width: 26, height: 26 }}
            onClick={inv.cerrarFicha}><FaTimes /></button>
        </div>

        <div className="inv-modal-body">
          <div className="inv-modal-sep">
            Características
            {/* Decir cuántos campos vienen vacíos es la mitad del valor de un
                inventario: señala dónde falta levantar dato. */}
            {cob.vacios > 0 && (
              <span className="inv-cob" title="Campos de la capa que llegan sin dato">
                {cob.conDato} de {cob.total} con dato
              </span>
            )}
          </div>

          {filas.length === 0 ? (
            <div className="inv-nota">Esta capa no trae ninguna característica rellenada.</div>
          ) : (
            <table className="inv-ficha-tabla">
              <tbody>
                {filas.map(r => (
                  <tr key={r.clave}>
                    <th>{r.etiqueta}</th>
                    <td>{r.valor}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <GaleriaFotos tipo={f.tipo} fid={f.fid} nombre={nombre} />

          {ev && (
            <>
              <div className="inv-modal-sep">Evaluación de campaña</div>
              <div className="inv-pop-eval" style={{ '--e': COLOR_ESTADO[ev.estado_cons] }}>
                <div className="inv-pop-eval-tit">
                  Campaña {ev.campania_anio || inv.campania?.anio} · evaluado el {ev.fecha}
                  {ev.evaluador && ` · ${ev.evaluador}`}
                </div>
                <div className="inv-pop-eval-estado">
                  {ETIQUETA_ESTADO[ev.estado_cons] || ev.estado_cons}
                  {ev.requiere_mant && <span className="inv-pop-mant">requiere mantenimiento</span>}
                </div>
                {ev.observaciones && <div className="inv-pop-eval-obs">{ev.observaciones}</div>}
              </div>
            </>
          )}
        </div>

        {/* inv-modal-pie, no una clase propia: es el mismo pie del formulario
            de evaluación y así hereda el tema claro ya definido. */}
        <div className="inv-modal-pie">
          <button className="inv-btn-sec" onClick={inv.cerrarFicha}>Cerrar</button>
          {evaluable && (
            <button className="inv-btn-pri"
              onClick={() => { inv.cerrarFicha(); inv.abrirEvaluacion(f.tipo, f.fid, f.props); }}>
              {ev ? 'Editar evaluación' : 'Evaluar'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}


/* ══════════════════════════════════════════════════════════
   Buscador del inventario

   Busca sobre el índice que se descarga al abrir el panel, así que
   encuentra cualquier activo aunque su capa esté apagada. Al elegir uno,
   enciende la capa, vuela y le abre la ficha.

   Se exporta porque la barra superior del visor usa este mismo componente:
   tenía un buscador propio que solo miraba las capas ya descargadas y
   comparaba el texto tal cual, así que encontraba menos cosas y de otra
   manera. Dos buscadores parecidos pero distintos confunden más que uno.
   ══════════════════════════════════════════════════════════ */
export function BuscadorInventario({ inv, clase = '' }) {
  const [texto, setTexto] = useState('');
  const [abierto, setAbierto] = useState(false);

  const resultados = useMemo(() => inv.buscar(texto), [texto, inv.buscar]);

  const elegir = (item) => {
    inv.irA(item);
    setTexto(item.nombre || `${item.tipo} #${item.fid}`);
    setAbierto(false);
  };

  return (
    <div className={`inv-buscador ${clase}`.trim()}>
      <FaSearch className="inv-buscador-ico" />
      <input
        value={texto}
        placeholder={inv.indice.length
          ? `Buscar entre ${inv.indice.length.toLocaleString('es-PE')} activos…`
          : 'Cargando índice…'}
        onChange={(e) => { setTexto(e.target.value); setAbierto(true); }}
        onFocus={() => resultados.length && setAbierto(true)}
        disabled={!inv.indice.length}
      />
      {texto && (
        <button className="inv-buscador-x"
          onClick={() => { setTexto(''); setAbierto(false); }}>
          <FaTimes size={10} />
        </button>
      )}

      {abierto && resultados.length > 0 && (
        <div className="inv-buscador-lista">
          {resultados.map(r => (
            <button key={`${r.tipo}:${r.fid}`} onClick={() => elegir(r)}>
              <span className="inv-res-nom">
                {r.nombre || `#${r.fid}`}
                {r.ambito && (
                  <i className={`inv-res-amb amb-${r.ambito}`}>
                    {r.ambito === 'JURP' ? 'JURP' : 'PECH'}
                  </i>
                )}
              </span>
              <span className="inv-res-meta">
                {META[r.tipo]?.label || r.tipo}
                {r.canal && ` · ${r.canal}`}
                {r.progresiva != null && r.progresiva !== '' && ` · ${r.progresiva}`}
              </span>
            </button>
          ))}
        </div>
      )}

      {abierto && texto.length >= 2 && resultados.length === 0 && (
        <div className="inv-buscador-lista">
          <div className="inv-res-vacio">Sin coincidencias</div>
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   Badge de conteo: muestra cuántos hay según el filtro vigente,
   y con "todo" desglosa JURP/Chavimochic.
   ══════════════════════════════════════════════════════════ */
function BadgeCapa({ info, ambito, onFiltrar }) {
  if (info == null) return <span className="gis-capa-badge">—</span>;

  // el backend devuelve {total, jurp, pech} en las capas con ámbito
  const total = typeof info === 'number' ? info : info.total;
  const jurp = typeof info === 'object' ? info.jurp : undefined;
  const pech = typeof info === 'object' ? info.pech : undefined;

  // capa sin desglose (solo JURP, o base sin la columna): número simple
  if (jurp === undefined || (pech === 0 && jurp === total)) {
    return <span className="gis-capa-badge">{total}</span>;
  }

  const stop = (e, amb) => { e.preventDefault(); e.stopPropagation(); onFiltrar(amb); };

  // Qué ámbitos están marcados ahora mismo para esta capa.
  const verJurp = ambito === 'todo' || ambito === 'JURP';
  const verPech = ambito === 'todo' || ambito === 'PECH';

  return (
    <span className="inv-badge-doble">
      <button type="button"
        className={`amb-JURP ${verJurp ? '' : 'apagado'}`}
        title={`${jurp} de JURP — clic para ${verJurp ? 'ocultarlas' : 'mostrarlas'}`}
        onClick={(e) => stop(e, 'JURP')}>
        {jurp}
      </button>
      <button type="button"
        className={`amb-PECH ${verPech ? '' : 'apagado'}`}
        title={`${pech} del PECH — clic para ${verPech ? 'ocultarlas' : 'mostrarlas'}`}
        onClick={(e) => stop(e, 'PECH')}>
        {pech}
      </button>
    </span>
  );
}

/* ══════════════════════════════════════════════════════════
   Panel lateral — va FUERA del mapa
   ══════════════════════════════════════════════════════════ */
export function PanelInventario({ inv, onVolar }) {
  const [grupoAbierto, setGrupoAbierto] = useState({ 0: true });
  const [verAvance, setVerAvance] = useState(false);

  if (!inv.abierto) return null;

  const avanceTotal = inv.avance.reduce(
    (a, x) => ({ total: a.total + x.total, evaluados: a.evaluados + x.evaluados, criticos: a.criticos + x.criticos }),
    { total: 0, evaluados: 0, criticos: 0 }
  );
  const pct = avanceTotal.total ? (avanceTotal.evaluados / avanceTotal.total * 100) : 0;

  const volarACapa = (codigo) => {
    const fc = inv.datosDe(codigo);
    if (!fc?.features?.length || !onVolar) return;
    const capa = L.geoJSON(fc);
    onVolar(capa.getBounds());
  };

  return (
    <div className="gis-capas gis-glass inv-panel">
      <div className="gis-capas-head">
        <span className="gis-sub">Inventario JURP</span>
        <button className="gis-tool" style={{ width: 26, height: 26 }} onClick={inv.cerrar}>
          <FaTimes />
        </button>
      </div>

      <div className="gis-capas-body">

        {inv.iniciando && (
          <div className="inv-cargando"><FaSyncAlt className="icon-spin" /> Consultando inventario…</div>
        )}

        {inv.error && (
          <div className="inv-error">
            <FaExclamationCircle /> {inv.error}
            <button onClick={inv.recargar}>Reintentar</button>
          </div>
        )}

        {/* SIN CAMPAÑA NO SE EVALÚA, Y HAY QUE DECIRLO.
            El bloque de abajo se pinta solo si hay campaña, así que cuando no
            la hay el panel se quedaba mudo: las capas cargaban con normalidad,
            pero el botón «Evaluar» no aparecía en ninguna estructura y nada
            explicaba por qué. La campaña se crea en el servidor; el front solo
            las lee. */}
        {!inv.iniciando && !inv.error && !inv.campania && (
          <div className="inv-nota inv-sin-campania">
            <b>No hay campaña abierta.</b> Las capas se ven, pero no se puede
            evaluar hasta que se cree la campaña del año en el administrador
            del servidor y quede <i>en proceso</i>.
          </div>
        )}

        {/* ── campaña y avance ── */}
        {inv.campania && (
          <div className="inv-campania">
            <div className="inv-campania-head">
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {inv.campanias.length > 1 ? (
                  <select className="inv-campania-select"
                    value={inv.campania.id}
                    onChange={e => inv.cambiarCampania(e.target.value)}
                    onClick={e => e.stopPropagation()}
                    title="Ver el estado registrado en otra campaña">
                    {inv.campanias.map(c => (
                      <option key={c.id} value={c.id}>Campaña {c.anio}</option>
                    ))}
                  </select>
                ) : (
                  <span className="inv-campania-anio">Campaña {inv.campania.anio}</span>
                )}
                <span className={`inv-campania-estado est-${inv.campania.estado}`}>
                  {inv.campania.estado.replace('_', ' ')}
                </span>
              </div>
              <button type="button" className="inv-campania-plegar"
                onClick={() => setVerAvance(v => !v)}
                title={verAvance ? 'Ocultar detalle' : 'Ver detalle por tipo'}>
                {verAvance ? <FaChevronDown size={10} /> : <FaChevronRight size={10} />}
              </button>
            </div>

            <div className="inv-barra">
              <div className="inv-barra-fill" style={{ width: `${pct}%` }} />
            </div>
            <div className="inv-barra-txt">
              {avanceTotal.evaluados.toLocaleString('es-PE')} de {avanceTotal.total.toLocaleString('es-PE')} evaluados
              <span>{pct.toFixed(1)}%</span>
            </div>
            {avanceTotal.criticos > 0 && (
              <div className="inv-criticos">
                <FaExclamationCircle /> {avanceTotal.criticos} en estado crítico
              </div>
            )}

            {inv.altas.length > 0 && (
              <div className="inv-altas">
                <FaPlusCircle /> {inv.altas.length} alta(s) de campo por validar
                <ul>
                  {inv.altas.slice(0, 4).map(a => (
                    <li key={a.id}>
                      <b>{a.tipo_activo}</b> {a.nombre || a.descripcion || `#${a.id}`}
                      {a.registrado_por && <span> · {a.registrado_por}</span>}
                    </li>
                  ))}
                  {inv.altas.length > 4 && <li>y {inv.altas.length - 4} más…</li>}
                </ul>
              </div>
            )}

            {verAvance && (
              <table className="inv-avance">
                <tbody>
                  {inv.avance.filter(a => a.total > 0).map(a => (
                    <tr key={a.tipo}>
                      <td>{a.nombre}</td>
                      <td className="inv-avance-num">{a.evaluados}/{a.total}</td>
                      <td className="inv-avance-pct">{a.porcentaje}%</td>
                      <td className={a.criticos ? 'inv-avance-crit' : ''}
                          title={a.criticos ? `${a.criticos} en estado malo o colapsado` : ''}>
                        {a.criticos || ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* ── buscador ── */}
        <BuscadorInventario inv={inv} />

        {/* ── filtro de ámbito ── */}
        <div className="inv-ambito">
          <div className="inv-ambito-tit">Mostrar</div>
          <div className="inv-ambito-btns">
            {AMBITOS.map(a => (
              <button key={a.valor} title={a.titulo}
                className={inv.ambito === a.valor ? 'activo' : ''}
                onClick={() => inv.cambiarAmbito(a.valor)}>
                {a.etiqueta}
              </button>
            ))}
          </div>
        </div>
        <div className="inv-nota" style={{ margin: '4px 2px 0' }}>
          En cada capa, los dos números funcionan como casillas: pulsa uno
          para mostrar u ocultar ese ámbito.
        </div>

        {/* ── capas ── */}
        <div className="gis-capas-acciones" style={{ marginTop: 8 }}>
          <button onClick={inv.apagarTodas}>Apagar todas</button>
          <span className="inv-visibles">{inv.totalVisibles.toLocaleString('es-PE')} en pantalla</span>
        </div>

        {TODOS_GRUPOS.map((g, i) => (
          <div className={`gis-capas-grupo ${g.contexto ? 'inv-grupo-contexto' : ''}`}
               key={g.titulo}>
            <div
              className="gis-capas-titulo inv-grupo-tit"
              onClick={() => setGrupoAbierto(s => ({ ...s, [i]: !s[i] }))}
            >
              {grupoAbierto[i] ? <FaChevronDown size={9} /> : <FaChevronRight size={9} />}
              {g.titulo}
            </div>

            {grupoAbierto[i] && g.capas.filter(c => !c.oculta).map(c => (
              <div key={c.codigo} className="gis-capa">
                <label>
                  <input
                    type="checkbox"
                    checked={!!inv.visibles[c.codigo]}
                    onChange={() => inv.alternarCapa(c.codigo)}
                  />
                  {c.ico ? (
                    <img src={c.ico} alt="" className="inv-capa-ico" />
                  ) : c.porLicencia ? (
                    /* Dos muestras: esta capa se pinta por licencia, y una
                       sola pastilla de color estaría mintiendo sobre lo que
                       se va a ver en el mapa. */
                    <span className="inv-capa-par" title="Verde: con licencia · Naranja: sin licencia">
                      <i style={{ background: COLOR_CON_LICENCIA }} />
                      <i style={{ background: COLOR_SIN_LICENCIA }} />
                    </span>
                  ) : (
                    <span
                      style={{
                        display: 'inline-block',
                        width: 14,
                        height: c.tipo === 'line' ? 3 : 14,
                        background: c.color,
                        borderRadius: c.tipo === 'line' ? 2 : (c.tipo === 'poly' ? 3 : '50%'),
                      }}
                    />
                  )}
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.label}
                  </span>
                </label>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  {inv.cargando[c.codigo]
                    ? <FaSyncAlt className="icon-spin" size={11} style={{ color: '#74c0fc' }} />
                    : <BadgeCapa
                        info={inv.totales[c.codigo]}
                        ambito={inv.ambitoDe(c.codigo)}
                        onFiltrar={(amb) => inv.alternarAmbitoCapa(c.codigo, amb)} />}
                  {inv.datosDe(c.codigo) && (
                    <button
                      onClick={() => volarACapa(c.codigo)}
                      title="Centrar en esta capa"
                      style={{ background: 'none', border: 'none', color: '#74c0fc', cursor: 'pointer', display: 'flex', padding: 2 }}
                    >
                      <FaCrosshairs size={11} />
                    </button>
                  )}
                </span>
              </div>
            ))}
          </div>
        ))}

        {/* ── leyenda de estados ── */}
        <div className="gis-capas-grupo">
          <div className="gis-capas-titulo">Estado de conservación</div>
          <div className="inv-leyenda">
            {Object.entries(ETIQUETA_ESTADO).map(([k, v]) => (
              <span key={k} title={`Código ANA: ${k}`}>
                <i style={{ background: COLOR_ESTADO[k] }} />{v}
              </span>
            ))}
          </div>
          <div className="inv-nota">
            El anillo del marcador indica el estado evaluado en la campaña vigente.
            Sin anillo = pendiente de evaluar.
          </div>
        </div>

        <div className="gis-capas-grupo">
          <div className="gis-capas-titulo">Ámbito</div>
          <div className="inv-leyenda">
            <span><i className="inv-mini-jurp" />JURP · se evalúa</span>
            <span><i className="inv-mini-pech" />Chavimochic · contexto</span>
          </div>
          <div className="inv-nota">
            Los puntos huecos y las líneas punteadas son obras del PECH:
            se muestran como referencia y quedan fuera de la campaña.
          </div>
        </div>

      </div>
    </div>
  );
}

export { FaClipboardCheck };