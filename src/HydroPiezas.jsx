/*
 * Las piezas que repiten las dos pantallas de HYDROMETRIX.
 *
 * Están aquí y no copiadas en cada una porque son ocho gráficos con el mismo
 * marco: el día que cambie el tipo de letra de los ejes, o el aviso de
 * «respuesta no reconocida», se cambia una vez.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactApexChart from 'react-apexcharts';
import {
  FaChevronDown, FaExpand, FaTimes, FaExclamationCircle, FaCheck, FaDownload,
} from 'react-icons/fa';
import {
  PERIODOS, UNIDADES, fechaLegible, MESES, pide, hoy,
  parametros, normalizaSeries, convierteCaudal, colorDeToma, sinTildes,
} from './datosHydro';

/* ── Tarjeta ───────────────────────────────────────────────────────────── */

/**
 * El marco de cada gráfico: título, lo que haya que poner a la derecha, y el
 * botón de ampliar.
 *
 * `acciones` es para los filtros que van EN la cabecera —periodo y fecha—,
 * que es donde los tiene el sistema viejo: moverlos abajo obligaría a bajar
 * la vista para cambiar el día y volver a subir para ver el efecto.
 */
export function Tarjeta({
  titulo, icono, acciones, filtros, nota, children, onAmpliar,
}) {
  return (
    <section className="hm-tarjeta">
      {(titulo || acciones || onAmpliar) && (
        <header className="hm-tarjeta-cab">
          <h3>{icono}{titulo}</h3>
          <div className="hm-tarjeta-acciones">
            {acciones}
            {onAmpliar && (
              <button type="button" className="hm-icono" onClick={onAmpliar}
                      title="Ver en grande" aria-label="Ver en grande">
                <FaExpand />
              </button>
            )}
          </div>
        </header>
      )}
      {filtros && <div className="hm-filtros">{filtros}</div>}
      {nota && <p className="hm-nota">{nota}</p>}
      <div className="hm-tarjeta-cuerpo">{children}</div>
    </section>
  );
}

/**
 * La barra que va justo encima del lienzo: unidad a la izquierda, descargar
 * y ampliar a la derecha. Es donde las tiene el sistema viejo.
 */
export function BarraGrafico({ unidad, onUnidad, onDescargar, onAmpliar }) {
  if (!onUnidad && !onDescargar && !onAmpliar) return null;
  return (
    <div className="hm-barra">
      {onUnidad && <ConmutadorUnidad valor={unidad} onCambio={onUnidad} />}
      <div className="hm-barra-der">
        {onDescargar && (
          <button type="button" className="hm-icono" onClick={onDescargar}
                  title="Descargar los datos (CSV)"
                  aria-label="Descargar los datos">
            <FaDownload />
          </button>
        )}
        {onAmpliar && (
          <button type="button" className="hm-icono" onClick={onAmpliar}
                  title="Ver en grande" aria-label="Ver en grande">
            <FaExpand />
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Descarga lo que se está viendo, como tabla.
 *
 * No es un adorno. Tres de los colores de la paleta quedan por debajo de
 * 3:1 contra el blanco, y la regla que lo permite exige que el valor se
 * pueda leer en algún sitio que no sea el color: el tooltip y esta tabla
 * son ese sitio. Además es lo que de verdad piden los operadores —llevarse
 * el día a una hoja— y hoy lo hacen a mano.
 *
 * Con punto y coma y BOM porque el Excel en español parte por punto y coma
 * y sin BOM se come las tildes.
 */
export function descargaCSV(nombre, categorias, series, unidad) {
  const esc = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const cabecera = ['', ...series.map((s) => (
    unidad ? `${s.nombre} (${unidad})` : s.nombre
  ))];
  const filas = categorias.map((c, i) => [
    c, ...series.map((s) => {
      const v = s.datos[i];
      // Coma decimal, que es lo que entiende el Excel en español.
      return v === null || v === undefined ? '' : String(v).replace('.', ',');
    }),
  ]);
  const texto = [cabecera, ...filas].map((f) => f.map(esc).join(';')).join('\r\n');
  /* El BOM va como escape y no como carácter: escrito tal cual es invisible
   * en el editor y el primer que lo 'limpie' rompe las tildes en Excel
   * sin que nada falle ni avise. */
  const BOM = String.fromCharCode(0xFEFF);
  const blob = new Blob([BOM + texto], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${nombre}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Un bloque de la página: el rótulo que agrupa varias tarjetas. */
export function Bloque({ titulo, icono, derecha, children }) {
  return (
    <div className="hm-bloque">
      <div className="hm-bloque-cab">
        <h2>{icono}{titulo}</h2>
        {derecha && <span className="hm-bloque-der">{derecha}</span>}
      </div>
      {children}
    </div>
  );
}

/* ── Filtros ───────────────────────────────────────────────────────────── */

/**
 * El selector de tomas.
 *
 * Es un desplegable con casillas y no un `<select multiple>` porque son
 * siete tomas y hay que poder decir «todas» de un clic; con el nativo hay
 * que arrastrar o ir con Ctrl, y en un móvil directamente no se puede.
 *
 * `seleccion` vacía significa TODAS, no ninguna. Es lo que espera quien
 * entra sin tocar nada —el sistema viejo rotula «Todas las tomas»— y evita
 * el gráfico en blanco de la primera carga.
 */
export function SelectorTomas({ etiqueta, tomas, seleccion, onCambio, id }) {
  const [abierto, setAbierto] = useState(false);
  const caja = useRef(null);

  useEffect(() => {
    if (!abierto) return undefined;
    const fuera = (e) => {
      if (caja.current && !caja.current.contains(e.target)) setAbierto(false);
    };
    const escape = (e) => { if (e.key === 'Escape') setAbierto(false); };
    document.addEventListener('mousedown', fuera);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', fuera);
      document.removeEventListener('keydown', escape);
    };
  }, [abierto]);

  const todas = !seleccion || seleccion.length === 0;
  const rotulo = todas
    ? 'Todas las tomas'
    : seleccion.length === 1
      ? (tomas.find((t) => String(t.id) === String(seleccion[0]))?.nombre
         || '1 toma')
      : `${seleccion.length} tomas`;

  const alterna = (idToma) => {
    const s = new Set((seleccion || []).map(String));
    const k = String(idToma);
    if (s.has(k)) s.delete(k); else s.add(k);
    // Marcarlas todas es lo mismo que no filtrar: se deja vacío para que el
    // rótulo vuelva a decir «Todas las tomas» y no «7 tomas».
    onCambio(s.size === tomas.length ? [] : [...s]);
  };

  return (
    <div className="hm-campo" ref={caja}>
      {etiqueta && <label htmlFor={id}>{etiqueta}</label>}
      <button type="button" id={id} className="hm-desplegable"
              aria-expanded={abierto} aria-haspopup="true"
              onClick={() => setAbierto((v) => !v)}>
        <span>{rotulo}</span><FaChevronDown />
      </button>
      {abierto && (
        <div className="hm-menu" role="menu">
          <button type="button" className="hm-menu-item hm-menu-todas"
                  onClick={() => { onCambio([]); }}>
            <span className="hm-casilla">{todas && <FaCheck />}</span>
            Todas las tomas
          </button>
          <div className="hm-menu-raya" />
          {tomas.map((t) => {
            const marcada = !todas
              && (seleccion || []).map(String).includes(String(t.id));
            return (
              <button type="button" key={t.id} className="hm-menu-item"
                      onClick={() => alterna(t.id)}>
                <span className="hm-casilla">{marcada && <FaCheck />}</span>
                {t.nombre}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Día / Semana / Mes. */
export function SelectorPeriodo({ valor, onCambio, id }) {
  return (
    <div className="hm-campo hm-campo-corto">
      <label htmlFor={id}>Periodo</label>
      <select id={id} className="hm-select" value={valor}
              onChange={(e) => onCambio(e.target.value)}>
        {PERIODOS.map((p) => (
          <option key={p.clave} value={p.clave}>{p.titulo}</option>
        ))}
      </select>
    </div>
  );
}

/**
 * La fecha.
 *
 * Con periodo «Mes» el sistema viejo enseña «Octubre de 2026» en vez del día
 * concreto, porque el día no se usa: dejarlo visible invita a cambiarlo y a
 * pensar que el gráfico va a moverse.
 */
export function SelectorFecha({ valor, onCambio, periodo, id }) {
  const mes = periodo === 'mes';
  return (
    <div className="hm-campo hm-campo-corto">
      <label htmlFor={id}>Fecha</label>
      {mes ? (
        <input id={id} className="hm-select" type="month"
               value={(valor || '').slice(0, 7)}
               onChange={(e) => onCambio(`${e.target.value}-01`)} />
      ) : (
        <input id={id} className="hm-select" type="date" value={valor || ''}
               onChange={(e) => onCambio(e.target.value)} />
      )}
    </div>
  );
}

/** El año, para el volumen mensual. */
export function SelectorAnio({ valor, onCambio, id }) {
  const actual = new Date().getFullYear();
  const anios = [];
  for (let a = actual; a >= actual - 6; a -= 1) anios.push(a);
  return (
    <div className="hm-campo hm-campo-corto">
      <label htmlFor={id}>Año</label>
      <select id={id} className="hm-select" value={valor}
              onChange={(e) => onCambio(Number(e.target.value))}>
        {anios.map((a) => <option key={a} value={a}>{a}</option>)}
      </select>
    </div>
  );
}

/** m3/h o l/s. Solo para caudales. */
export function ConmutadorUnidad({ valor, onCambio }) {
  return (
    <div className="hm-unidad">
      <span className="hm-unidad-rotulo">Unidad:</span>
      {Object.keys(UNIDADES).map((u) => (
        <button type="button" key={u}
                className={`hm-pastilla${valor === u ? ' activa' : ''}`}
                aria-pressed={valor === u}
                onClick={() => onCambio(u)}>
          {UNIDADES[u].etiqueta}
        </button>
      ))}
    </div>
  );
}

/* ── Gráfico ───────────────────────────────────────────────────────────── */

const TIPO_LETRA = "'Inter', -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";

/**
 * El tema. Lo mismo para los ocho gráficos.
 *
 * Marcas finas y rejilla discreta: la rejilla es una referencia, no un dato,
 * y cuando compite con las líneas obliga a mirar dos veces cuál es cuál.
 */
function opcionesBase({ tipo, categorias, colores, unidad, apilado = false }) {
  return {
    chart: {
      type: tipo,
      fontFamily: TIPO_LETRA,
      foreColor: '#626976',
      stacked: apilado,
      /* Sin la barra propia de ApexCharts: la descarga ya está en la barra
       * de arriba, y dos iconos de descargar que hacen cosas distintas
       * —uno la imagen, otro los datos— es un sitio donde equivocarse. */
      toolbar: { show: false },
      animations: { enabled: false },
      zoom: { enabled: false },
    },
    colors: colores,
    dataLabels: { enabled: false },
    /* Recta y no curva: una curva inventa valores entre dos lecturas, y
     * aquí entre dos puntos hay una hora de caudal real que nadie midió. */
    stroke: tipo === 'bar'
      ? { width: 0 }
      : { width: 2, curve: 'straight' },
    markers: { size: tipo === 'bar' ? 0 : 4, strokeWidth: 2, strokeColors: '#fff', hover: { sizeOffset: 2 } },
    plotOptions: {
      bar: { columnWidth: '55%', borderRadius: 4, borderRadiusApplication: 'end' },
    },
    grid: {
      borderColor: '#eef2f7',
      strokeDashArray: 3,
      padding: { left: 6, right: 12, top: 0 },
      xaxis: { lines: { show: true } },
      yaxis: { lines: { show: true } },
    },
    xaxis: {
      categories: categorias,
      axisBorder: { color: '#e2e8f0' },
      axisTicks: { color: '#e2e8f0' },
      labels: {
        rotate: -45, rotateAlways: false, hideOverlappingLabels: true,
        style: { fontSize: '11px', colors: '#626976' },
      },
      tooltip: { enabled: false },
    },
    yaxis: {
      title: unidad
        ? { text: unidad, style: { fontSize: '11px', fontWeight: 500, color: '#626976' } }
        : undefined,
      labels: {
        style: { fontSize: '11px', colors: '#626976' },
        formatter: (v) => (v === null || v === undefined ? '' : Number(v).toFixed(2)),
      },
    },
    legend: {
      position: 'bottom', horizontalAlign: 'center',
      fontSize: '12px', markers: { width: 9, height: 9, radius: 9 },
      itemMargin: { horizontal: 8, vertical: 3 },
    },
    tooltip: {
      shared: tipo !== 'bar',
      intersect: false,
      /* El cursor vertical: con siete líneas juntas, sin él hay que acertar
       * el píxel exacto para leer un valor. */
      followCursor: false,
      style: { fontSize: '12px', fontFamily: TIPO_LETRA },
      y: {
        formatter: (v) => (v === null || v === undefined
          ? 'sin lectura'
          : `${Number(v).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${unidad ? ` ${unidad}` : ''}`),
      },
    },
    /* Los huecos no se unen con una recta: si a las 11:00 no hubo lectura,
     * el gráfico lo enseña como lo que es, un hueco. */
    noData: { text: '' },
  };
}

/**
 * Un gráfico, con su estado de carga, su error y su diagnóstico.
 *
 * NUNCA pinta un lienzo vacío sin explicación: un gráfico en blanco se lee
 * como «no hubo caudal», que es una afirmación sobre el agua, no sobre el
 * software.
 */
export function Grafico({
  tipo = 'line', categorias = [], series = [], colores, unidad,
  altura = 300, cargando, error, diagnostico, apilado, maxY,
}) {
  if (cargando) return <div className="hm-hueco">Cargando…</div>;
  if (error) return <Aviso tono="error" texto={error} />;
  if (diagnostico) return <Diagnostico {...diagnostico} />;
  if (!series.length || !categorias.length) {
    return <Aviso tono="vacio" texto="No hay lecturas para estos filtros." />;
  }

  const op = opcionesBase({ tipo, categorias, colores, unidad, apilado });
  /* Una sola serie no necesita leyenda: el título ya la nombra, y una
   * leyenda de un elemento solo gasta alto. */
  if (series.length < 2) op.legend = { show: false };
  /* ESCALA IMPUESTA DESDE FUERA. Dos gráficos que se van a comparar tienen
   * que medir con la misma vara. Dejando que cada uno se escale solo, uno
   * sale de 0 a 60 y el otro de 190 a 220, y entonces una barra alta en el
   * segundo vale menos que una baja en el primero: exactamente el engaño
   * del eje doble, solo que repartido en dos tarjetas. */
  if (Number.isFinite(maxY)) {
    op.yaxis = { ...op.yaxis, min: 0, max: maxY, forceNiceScale: true };
  }
  return (
    <ReactApexChart
      type={tipo}
      height={altura}
      options={op}
      series={series.map((s) => ({ name: s.nombre, data: s.datos, type: s.tipo }))}
    />
  );
}

/* ── Avisos ────────────────────────────────────────────────────────────── */

export function Aviso({ tono = 'info', texto, children }) {
  return (
    <div className={`hm-aviso hm-aviso-${tono}`}>
      <FaExclamationCircle />
      <div>{texto}{children}</div>
    </div>
  );
}

/**
 * «La respuesta llegó y no la entiendo».
 *
 * Enseña las claves que traía, que es justo lo que hace falta para arreglar
 * la lista de nombres en datosHydro.js. Es preferible a un gráfico vacío por
 * una razón concreta: el vacío dice «no hay agua» y esto dice «no sé leer
 * esto», y solo una de las dos es verdad.
 */
export function Diagnostico({ ruta, visto, crudo }) {
  const [abierto, setAbierto] = useState(false);
  return (
    <div className="hm-aviso hm-aviso-diag">
      <FaExclamationCircle />
      <div>
        <strong>No reconozco la respuesta de esta ruta.</strong>
        <div className="hm-diag-ruta">/api/operadores/{ruta}</div>
        {visto && visto.length > 0 && (
          <div className="hm-diag-claves">
            Vino con: {visto.map((k) => <code key={k}>{k}</code>)}
          </div>
        )}
        <p>
          Los datos están en el servidor; lo que falta es el nombre exacto de
          cada campo. Con esta lista se corrige en una línea.
        </p>
        <button type="button" className="hm-enlace"
                onClick={() => setAbierto((v) => !v)}>
          {abierto ? 'Ocultar la respuesta' : 'Ver la respuesta'}
        </button>
        {abierto && (
          <pre className="hm-diag-crudo">
            {JSON.stringify(crudo, null, 2).slice(0, 4000)}
          </pre>
        )}
      </div>
    </div>
  );
}

/* ── Ampliar ───────────────────────────────────────────────────────────── */

/** El gráfico a pantalla completa. Siete líneas en 280 px no se leen. */
export function Ampliado({ titulo, onCerrar, children }) {
  useEffect(() => {
    const esc = (e) => { if (e.key === 'Escape') onCerrar(); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onCerrar]);

  return (
    <div className="hm-lupa" onClick={onCerrar} role="presentation">
      <div className="hm-lupa-caja" onClick={(e) => e.stopPropagation()}
           role="dialog" aria-label={titulo}>
        <header>
          <h3>{titulo}</h3>
          <button type="button" className="hm-icono" onClick={onCerrar}
                  aria-label="Cerrar">
            <FaTimes />
          </button>
        </header>
        <div className="hm-lupa-cuerpo">{children}</div>
      </div>
    </div>
  );
}

/* ── Pedir y normalizar, en un sitio ───────────────────────────────────── */

/**
 * Una ruta, sus filtros y su normalizador: devuelve
 * `{ cargando, error, datos, diagnostico }`, que es justo lo que `Grafico`
 * espera recibir.
 *
 * CADA PANEL PIDE LO SUYO. Son seis gráficos con filtros independientes
 * —cada uno con su día y sus tomas, como en el sistema viejo—, así que una
 * sola carga común tendría que pedir el producto de todas las
 * combinaciones. Además, si uno falla los otros cinco siguen funcionando.
 *
 * `vivo` corta la respuesta que llega tarde: cambiar de día dos veces
 * seguidas lanza dos peticiones, y sin esto la primera en volver —que puede
 * ser la vieja— pisaría a la nueva y el gráfico enseñaría otro día que el
 * que marca el filtro.
 *
 * `normaliza` tiene que ser una función ESTABLE —de módulo, o envuelta en
 * useMemo—. Entra en las dependencias a propósito: guardarla en una ref
 * para esquivarlas es escribir en la ref durante el render, que es
 * exactamente lo que React pide no hacer, y además deja un camino por el
 * que un normalizador nuevo no vuelve a pedir los datos.
 */
export function useDatos(ruta, params, normaliza, recarga = 0) {
  const cola = params ? params.toString() : '';
  const clave = `${ruta}?${cola}#${recarga}`;

  const [estado, setEstado] = useState({
    clave: null, error: null, datos: null, diagnostico: null,
  });

  useEffect(() => {
    let vivo = true;
    pide(ruta, new URLSearchParams(cola)).then((r) => {
      if (!vivo) return;
      if (!r.ok) {
        setEstado({ clave, error: r.error, datos: null, diagnostico: null });
        return;
      }
      const n = normaliza(r.cuerpo);
      setEstado(n.ok
        ? { clave, error: null, datos: n.datos, diagnostico: null }
        : {
          clave, error: null, datos: null,
          diagnostico: { ruta, visto: n.visto, crudo: n.crudo },
        });
    });
    return () => { vivo = false; };
  }, [ruta, cola, clave, normaliza, recarga]);

  /* «Cargando» SE DEDUCE, no se guarda. Guardarlo obligaba a poner el
   * estado a «cargando» dentro del efecto —un render de más cada vez que
   * se toca un filtro, y React avisa de ello—. Comparando la clave de lo
   * que hay con la de lo que se está pidiendo sale lo mismo sin ese render.
   *
   * De paso cierra la carrera por el otro lado: cada respuesta se guarda
   * con la clave que la pidió, así que una que llegue tarde ya no puede
   * hacerse pasar por la actual. */
  return { ...estado, cargando: estado.clave !== clave };
}

/**
 * Una vara de medir para varios gráficos.
 *
 * Cada panel apunta su valor más alto y todos leen el máximo de todos, así
 * que los dos lienzos de turbidez acaban con el mismo eje y sus alturas
 * significan lo mismo. Sin esto cada uno se escala solo y la comparación
 * —que es la única razón de ponerlos uno al lado del otro— no se sostiene.
 */
export function useEscalaCompartida() {
  const [topes, setTopes] = useState({});
  const registra = useCallback((quien, valor) => {
    setTopes((t) => (t[quien] === valor ? t : { ...t, [quien]: valor }));
  }, []);
  const vistos = Object.values(topes).filter(Number.isFinite);
  /* Un 10% de aire arriba para que el punto más alto no toque el borde. */
  const max = vistos.length ? Math.max(...vistos) * 1.1 : undefined;
  return useMemo(() => ({ max, registra }), [max, registra]);
}

/** Los filtros de un panel. Cada gráfico lleva los suyos. */
export function useFiltros(inicial = {}) {
  const [tomas, setTomas] = useState(inicial.tomas || []);
  const [periodo, setPeriodo] = useState(inicial.periodo || 'dia');
  const [fecha, setFecha] = useState(inicial.fecha || hoy());
  return { tomas, setTomas, periodo, setPeriodo, fecha, setFecha };
}

/* ── El panel que repiten casi todos los gráficos ──────────────────────── */

/**
 * Filtros arriba, barra de unidad y acciones, y el lienzo.
 *
 * `esCaudal` decide si se convierte a m³/h. Los volúmenes, las turbideces y
 * los dosajes NO se convierten: multiplicar un volumen por 3,6 da un número
 * que sigue pareciendo razonable, y nadie lo nota hasta que lo compara con
 * el papel.
 *
 * `filtrosExternos` es para los bloques donde un juego de filtros manda
 * sobre varios gráficos a la vez —los tres dosajes—. Cuando viene, el panel
 * no dibuja su propia fila.
 */
export function PanelSerie({
  titulo, icono, metrica, tipo = 'line', catalogo = [], tomas = [],
  esCaudal = true, unidadFija, conTomas = true, recarga, colorFijo,
  filtrosExternos, altura = 300, escala,
}) {
  const propios = useFiltros();
  const f = filtrosExternos || propios;
  const [unidad, setUnidad] = useState('m3/h');
  const [ampliado, setAmpliado] = useState(false);

  const params = useMemo(() => parametros({
    metrica,
    tomas: conTomas ? f.tomas : undefined,
    periodo: f.periodo,
    fecha: f.fecha,
  }), [metrica, conTomas, f.tomas, f.periodo, f.fecha]);

  const r = useDatos('series/', params, normalizaSeries, recarga);

  /*
   * EL CATALOGO, MAS LO QUE NO SEA UNA TOMA.
   *
   * `colorDeToma` saca el color del puesto en el catálogo, y lo que no está
   * en él cae en un color sacado del nombre. Eso funcionaba para una serie
   * suelta, pero el gráfico de «Caudal total vs Excedencia» tiene TRES que
   * no son tomas —captación, entrega y excedencia— y las tres cayeron en el
   * mismo rosa: un gráfico de tres líneas del mismo color, que es lo mismo
   * que un gráfico de una.
   *
   * Añadiéndolas al final del catálogo cada una coge un puesto propio y
   * distinto, y sigue siendo estable entre recargas y entre filtros, que es
   * lo que había que conservar.
   */
  const nombres = useMemo(() => {
    const base = catalogo.map((t) => t.nombre);
    if (!r.datos) return base;
    const fuera = r.datos.series
      .map((s) => s.nombre)
      .filter((n) => !base.some((b) => sinTildes(b) === sinTildes(n)))
      // Ordenadas, para que el color no dependa de en qué orden las mande
      // el servidor esta vez.
      .sort();
    return [...base, ...fuera];
  }, [catalogo, r.datos]);
  const vista = useMemo(() => {
    if (!r.datos) return null;
    return {
      categorias: r.datos.categorias,
      series: r.datos.series.map((s) => ({
        nombre: s.nombre,
        datos: esCaudal
          ? s.datos.map((v) => (v === null ? null : convierteCaudal(v, unidad)))
          : s.datos,
      })),
    };
  }, [r.datos, esCaudal, unidad]);

  const unidadTexto = unidadFija || (esCaudal ? unidad : '');
  const colores = vista
    ? vista.series.map((s) => colorFijo || colorDeToma(s.nombre, nombres))
    : [];

  /* Si este panel comparte vara con otro, apunta a cuánto llega lo suyo. */
  const registra = escala && escala.registra;
  useEffect(() => {
    if (!registra) return;
    const vs = vista
      ? vista.series.flatMap((s) => s.datos).filter((v) => v !== null && v !== undefined)
      : [];
    registra(metrica, vs.length ? Math.max(...vs) : 0);
  }, [vista, registra, metrica]);

  const lienzo = (alto) => (
    <Grafico tipo={tipo} altura={alto} unidad={unidadTexto} maxY={escala && escala.max}
             categorias={vista ? vista.categorias : []}
             series={vista ? vista.series : []}
             colores={colores}
             cargando={r.cargando} error={r.error} diagnostico={r.diagnostico} />
  );

  return (
    <>
      <Tarjeta
        titulo={titulo}
        icono={icono}
        filtros={filtrosExternos ? null : (
          <>
            {conTomas && (
              <SelectorTomas id={`tm-${metrica}`} etiqueta="Tomas"
                             tomas={tomas} seleccion={f.tomas}
                             onCambio={f.setTomas} />
            )}
            <SelectorPeriodo id={`pe-${metrica}`} valor={f.periodo}
                             onCambio={f.setPeriodo} />
            <SelectorFecha id={`fe-${metrica}`} valor={f.fecha}
                           periodo={f.periodo} onCambio={f.setFecha} />
          </>
        )}
      >
        <BarraGrafico
          unidad={esCaudal ? unidad : undefined}
          onUnidad={esCaudal ? setUnidad : undefined}
          onDescargar={vista ? () => descargaCSV(
            `${titulo} ${rotuloPeriodo(f.periodo, f.fecha)}`,
            vista.categorias, vista.series, unidadTexto,
          ) : undefined}
          onAmpliar={() => setAmpliado(true)}
        />
        {lienzo(altura)}
      </Tarjeta>

      {ampliado && (
        <Ampliado titulo={`${titulo} · ${rotuloPeriodo(f.periodo, f.fecha)}`}
                  onCerrar={() => setAmpliado(false)}>
          {lienzo(560)}
        </Ampliado>
      )}
    </>
  );
}

/** Una fila de filtros suelta, para los bloques que comparten uno solo. */
export function FilaFiltros({ etiquetaTomas = 'Tomas', tomas, f, id, children }) {
  return (
    <div className="hm-tarjeta">
      <div className="hm-filtros">
        <SelectorTomas id={`tm-${id}`} etiqueta={etiquetaTomas}
                       tomas={tomas} seleccion={f.tomas} onCambio={f.setTomas} />
        <SelectorPeriodo id={`pe-${id}`} valor={f.periodo} onCambio={f.setPeriodo} />
        <SelectorFecha id={`fe-${id}`} valor={f.fecha} periodo={f.periodo}
                       onCambio={f.setFecha} />
        {children}
      </div>
    </div>
  );
}

/* ── Rótulos ───────────────────────────────────────────────────────────── */

/** Lo que dice la cabecera del gráfico sobre qué se está viendo. */
export function rotuloPeriodo(periodo, fecha) {
  if (periodo === 'mes') {
    const m = String(fecha || '').match(/^(\d{4})-(\d{2})/);
    return m ? `${MESES[Number(m[2]) - 1]} de ${m[1]}` : '';
  }
  if (periodo === 'semana') return `Semana del ${fechaLegible(fecha)}`;
  return fechaLegible(fecha);
}
