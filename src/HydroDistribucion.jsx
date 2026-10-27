/*
 * HYDROMETRIX · Distribución.
 *
 * Las mismas seis vistas que el sistema viejo —resumen por toma, caudal de
 * ingreso y de salida, excedencia de la 10.6/7, total contra excedencia, y
 * los dos volúmenes— con el marco de NEXHYDRO.
 *
 * DOS COSAS QUE NO SE COPIAN DEL ORIGINAL:
 *
 *   1. El color de cada toma sale del CATALOGO, no del orden en que entra
 *      al gráfico. Si saliera del orden, quitar una toma del filtro
 *      repintaría las demás y la 10.4 sería azul en un panel y naranja en
 *      el de al lado.
 *
 *   2. Cuando una respuesta no se entiende, el panel lo dice y enseña lo
 *      que llegó. El original, ante lo mismo, dibuja un lienzo en blanco, y
 *      un lienzo en blanco se lee como «no hubo caudal» —una afirmación
 *      sobre el agua que el programa no está en condiciones de hacer—.
 */
import { useMemo, useState } from 'react';
import {
  FaWater, FaSyncAlt, FaTachometerAlt, FaLayerGroup, FaTint,
  FaRegCalendarAlt, FaChartBar, FaDatabase, FaUserClock,
  FaExclamationTriangle, FaCircle, FaArrowUp, FaExchangeAlt,
} from 'react-icons/fa';
import './Hydrometrix.css';
import {
  normalizaTomas, normalizaResumen, normalizaVolumen, normalizaSeries,
  parametros, COLOR_ESTADO, ROTULO_ESTADO, momentoLegible, cifra, MESES,
  METRICAS, sumaSeries, convierteCaudal,
} from './datosHydro';
import {
  Tarjeta, Bloque, Grafico, Aviso, Ampliado, BarraGrafico, descargaCSV,
  SelectorAnio, SelectorTomas, SelectorPeriodo, SelectorFecha,
  PanelSerie, useDatos, useFiltros, rotuloPeriodo,
} from './HydroPiezas';

/* ── La tarjeta de una toma ────────────────────────────────────────────── */

const ICONO_ESTADO = {
  normal: <FaCircle />,
  bajo: <FaExclamationTriangle />,
  'muy-bajo': <FaExclamationTriangle />,
  excedencia: <FaArrowUp />,
  desconocido: <FaCircle />,
};

function Dato({ icono, rotulo, valor, unidad }) {
  return (
    <div className="hm-dato">
      {icono}<span>{rotulo}</span>
      <b>{valor}{unidad && valor !== '—' && <small>{unidad}</small>}</b>
    </div>
  );
}

function TarjetaToma({ t }) {
  const c = COLOR_ESTADO[t.estado] || COLOR_ESTADO.desconocido;
  return (
    <article
      className="hm-toma"
      style={{
        '--punto': c.punto, '--fondo': c.fondo,
        '--insignia-fondo': c.fondo, '--insignia-texto': c.texto,
        '--insignia-borde': c.borde,
      }}
    >
      <div className="hm-toma-cab">
        <b>{t.toma}</b>
        {/* El estado nunca va solo en el color: icono y palabra, porque
            quien no distingue rojo de verde tiene que poder leerlo igual. */}
        <span className="hm-insignia">
          {ICONO_ESTADO[t.estado]}
          {t.estadoTexto || ROTULO_ESTADO[t.estado]}
        </span>
      </div>
      <Dato icono={<FaTachometerAlt />} rotulo="Caudal de salida"
            valor={cifra(t.caudalSalida)} unidad="l/s" />
      <Dato icono={<FaLayerGroup />} rotulo="Desnivel de sedimentador"
            valor={cifra(t.desnivel)} unidad="m" />
      <Dato icono={<FaTint />} rotulo="Turbidez de salida"
            valor={cifra(t.turbidez)} unidad="NTU" />
      <Dato icono={<FaRegCalendarAlt />} rotulo="Última lectura"
            valor={momentoLegible(t.ultima)} />

      {/* EL DIA A MEDIAS. El servidor dice cuántas lecturas se esperaban y
          cuántas llegaron. Cuando no están todas, estos números son de un
          día incompleto, y eso cambia cómo se leen: un caudal bajo puede
          ser caudal bajo o pueden ser horas que faltan. Solo se enseña
          cuando falta algo; si está completo, decirlo sería ruido en las
          siete tarjetas. */}
      {t.completado !== null && t.completado < 100 && (
        <div className="hm-parcial">
          <FaExclamationTriangle />
          <span>
            Día incompleto: {t.recibidas} de {t.esperadas} lecturas
            {t.faltantes.length > 0 && ` · falta ${t.faltantes.slice(0, 3).join(', ')}`}
          </span>
        </div>
      )}

      {(t.operario || t.turno) && (
        <div className="hm-pie">
          <FaUserClock />
          <span>{[t.turno, t.operario].filter(Boolean).join(' · ')}</span>
        </div>
      )}
    </article>
  );
}

/* ── La pantalla ───────────────────────────────────────────────────────── */

export default function HydroDistribucion() {
  const [recarga, setRecarga] = useState(0);

  const sinFiltro = useMemo(() => parametros({}), []);
  const cat = useDatos('tomas/', sinFiltro, normalizaTomas, recarga);
  const res = useDatos('tomas/status-summary/', sinFiltro, normalizaResumen, recarga);

  const catalogo = cat.datos || [];

  /* Volumen mensual: una sola toma y un año. Arranca en la primera del
   * catálogo porque el gráfico no admite «todas» —son doce barras de una
   * toma— y empezar sin nada elegido dejaría el panel vacío sin motivo. */
  const [tomaVol, setTomaVol] = useState('');
  const [anio, setAnio] = useState(new Date().getFullYear());
  const tomaElegida = tomaVol || (catalogo[0] ? String(catalogo[0].id) : '');
  const paramsMes = useMemo(
    () => parametros({ toma: tomaElegida, anio }),
    [tomaElegida, anio],
  );
  /* Envuelto porque `useDatos` lo lleva en sus dependencias: una función
   * escrita en línea sería nueva en cada render y volvería a pedir los
   * datos sin parar. */
  const normMes = useMemo(() => (x) => normalizaVolumen(x, MESES), []);
  const vMes = useDatos('volumes/by-month/', paramsMes, normMes, recarga);

  return (
    <div className="hm">
      <header className="hm-head">
        <div>
          {/* Sin repetir «HYDROMETRIX»: el rail de la izquierda ya lleva el
              logo del módulo, y decirlo dos veces en la misma pantalla no
              añade nada. */}
          <div className="hm-pretitulo">Operadores L10</div>
          <h1 className="hm-titulo">Distribución</h1>
        </div>
        <div className="hm-head-der">
          <button type="button" className="hm-icono"
                  title="Volver a pedir los datos" aria-label="Actualizar"
                  onClick={() => setRecarga((n) => n + 1)}>
            <FaSyncAlt />
          </button>
        </div>
      </header>

      <div className="hm-body">
        {/* ── Resumen por toma ── */}
        <Bloque titulo="Resumen de registro de operadores" icono={<FaChartBar />}>
          {res.cargando && <div className="hm-hueco">Cargando el resumen…</div>}
          {res.error && <Aviso tono="error" texto={res.error} />}
          {res.diagnostico && (
            <Tarjeta><Grafico diagnostico={res.diagnostico} /></Tarjeta>
          )}
          {res.datos && res.datos.length > 0 && (
            <div className="hm-rejilla-tomas">
              {res.datos.map((t) => <TarjetaToma key={t.id} t={t} />)}
            </div>
          )}
          {res.datos && res.datos.length === 0 && (
            <Aviso tono="vacio" texto="El servidor no devolvió ninguna toma." />
          )}
        </Bloque>

        {/* ── Caudales ── */}
        <Bloque titulo="Caudales" icono={<FaWater />}>
          <div className="hm-rejilla-2">
            <PanelSerie titulo="Caudal de ingreso" icono={<FaTachometerAlt />}
                        metrica={METRICAS.caudalIngreso} catalogo={catalogo}
                        tomas={catalogo} recarga={recarga} />
            <PanelSerie titulo="Caudal de salida" icono={<FaTachometerAlt />}
                        metrica={METRICAS.caudalSalida} catalogo={catalogo}
                        tomas={catalogo} recarga={recarga} />
          </div>
          <div className="hm-rejilla-2">
            {/* La excedencia es de una sola toma: ni filtro de tomas ni
                leyenda, que el título ya dice cuál es. */}
            <PanelSerie titulo="Caudal de excedencia (toma 10.6/7)"
                        icono={<FaChartBar />} tipo="bar"
                        metrica={METRICAS.excedencia} catalogo={catalogo}
                        tomas={catalogo} conTomas={false}
                        colorFijo="#eda100" recarga={recarga} />
            <TotalVsExcedencia recarga={recarga} />
          </div>
        </Bloque>

        {/* ── Volúmenes ── */}
        <Bloque titulo="Volúmenes" icono={<FaDatabase />}
                derecha="Comparativos en m3">
          <div className="hm-rejilla-2">
            <VolumenPorTomas tomas={catalogo} recarga={recarga} />
            <VolumenMensual
              tomas={catalogo} toma={tomaElegida} onToma={setTomaVol}
              anio={anio} onAnio={setAnio} r={vMes}
            />
          </div>
        </Bloque>

        {cat.error && (
          <Aviso tono="error"
                 texto={`No se pudo leer el catálogo de tomas: ${cat.error}`} />
        )}
      </div>
    </div>
  );
}

/* ── Caudal total contra excedencia ────────────────────────────────────── */

/**
 * Lo que capta el sistema, lo que entrega y lo que se va por la excedencia.
 *
 * ESTE ES EL UNICO PANEL QUE CALCULA ALGO EN EL NAVEGADOR, y conviene
 * saberlo. `series/` no tiene una métrica de «total»: las que ofrece son
 * por toma. Así que captación y entrega salen de SUMAR las tomas —ingreso
 * y salida respectivamente—, y la excedencia viene tal cual de la 10.6/7.
 *
 * Es una reconstrucción de lo que hace el sistema viejo, no una copia de su
 * cuenta: si allí la captación sale de un medidor propio y no de la suma,
 * los números no coincidirán. Por eso el panel lo dice en voz alta en vez
 * de presentarlo como un dato del servidor. Si no cuadra con el gráfico
 * viejo, el aviso es lo que hace que se note en vez de pasar en silencio.
 */
function TotalVsExcedencia({ recarga }) {
  const f = useFiltros();
  const [unidad, setUnidad] = useState('m3/h');
  const [ampliado, setAmpliado] = useState(false);

  const pIng = useMemo(() => parametros({
    metrica: METRICAS.caudalIngreso, periodo: f.periodo, fecha: f.fecha,
  }), [f.periodo, f.fecha]);
  const pSal = useMemo(() => parametros({
    metrica: METRICAS.caudalSalida, periodo: f.periodo, fecha: f.fecha,
  }), [f.periodo, f.fecha]);
  const pExc = useMemo(() => parametros({
    metrica: METRICAS.excedencia, periodo: f.periodo, fecha: f.fecha,
  }), [f.periodo, f.fecha]);

  const ing = useDatos('series/', pIng, normalizaSeries, recarga);
  const sal = useDatos('series/', pSal, normalizaSeries, recarga);
  const exc = useDatos('series/', pExc, normalizaSeries, recarga);

  const cargando = ing.cargando || sal.cargando || exc.cargando;
  const error = ing.error || sal.error || exc.error;
  const diagnostico = ing.diagnostico || sal.diagnostico || exc.diagnostico;

  const vista = useMemo(() => {
    if (!ing.datos || !sal.datos || !exc.datos) return null;
    const cat = ing.datos.categorias;
    const aUnidad = (xs) => xs.map(
      (v) => (v === null ? null : convierteCaudal(v, unidad)),
    );
    return {
      categorias: cat,
      series: [
        { nombre: 'Q. de captación', datos: aUnidad(sumaSeries(ing.datos.series)) },
        { nombre: 'Q. entrega al Usuario', datos: aUnidad(sumaSeries(sal.datos.series)) },
        {
          nombre: 'Excedencia 10.6/7',
          datos: aUnidad(exc.datos.series[0] ? exc.datos.series[0].datos : []),
        },
      ],
    };
  }, [ing.datos, sal.datos, exc.datos, unidad]);

  const lienzo = (altura) => (
    <Grafico tipo="line" altura={altura} unidad={unidad}
             categorias={vista ? vista.categorias : []}
             series={vista ? vista.series : []}
             colores={['#1268C3', '#1baf7a', '#eda100']}
             cargando={cargando} error={error} diagnostico={diagnostico} />
  );

  return (
    <>
      <Tarjeta
        titulo="Caudal total vs Excedencia"
        icono={<FaExchangeAlt />}
        filtros={(
          <>
            <SelectorPeriodo id="pe-total" valor={f.periodo}
                             onCambio={f.setPeriodo} />
            <SelectorFecha id="fe-total" valor={f.fecha} periodo={f.periodo}
                           onCambio={f.setFecha} />
          </>
        )}
      >
        <BarraGrafico
          unidad={unidad} onUnidad={setUnidad}
          onDescargar={vista ? () => descargaCSV(
            `Total vs excedencia ${rotuloPeriodo(f.periodo, f.fecha)}`,
            vista.categorias, vista.series, unidad,
          ) : undefined}
          onAmpliar={() => setAmpliado(true)}
        />
        {lienzo(300)}
        {vista && (
          <Aviso tono="info"
                 texto={'Captación y entrega son la suma de las tomas —el '
                   + 'servidor no sirve un total ya hecho—. La excedencia sí '
                   + 'viene de la 10.6/7. En las horas en que falte alguna '
                   + 'toma, el total queda en blanco en vez de sumar a '
                   + 'medias.'} />
        )}
      </Tarjeta>

      {ampliado && (
        <Ampliado titulo={`Caudal total vs Excedencia · ${rotuloPeriodo(f.periodo, f.fecha)}`}
                  onCerrar={() => setAmpliado(false)}>
          {lienzo(560)}
        </Ampliado>
      )}
    </>
  );
}

/* ── Volumen por tomas ─────────────────────────────────────────────────── */

/**
 * Una barra por toma, del periodo elegido.
 *
 * NO pasa por `series/` como los caudales: tiene su propia ruta,
 * `volumes/by-toma/`, que ya devuelve el total agregado. Pedirlo como serie
 * horaria obligaría a sumar aquí lo que el servidor ya suma, y así es como
 * acaban saliendo dos números distintos para lo mismo.
 *
 * Tampoco lleva conmutador de unidad: los volúmenes vienen en m³ y el ×3,6
 * de los caudales aquí no significa nada.
 */
function VolumenPorTomas({ tomas, recarga }) {
  const f = useFiltros();
  const [ampliado, setAmpliado] = useState(false);

  const params = useMemo(
    () => parametros({ tomas: f.tomas, periodo: f.periodo, fecha: f.fecha }),
    [f.tomas, f.periodo, f.fecha],
  );
  const r = useDatos('volumes/by-toma/', params, normalizaVolumen, recarga);

  const series = r.datos ? [{ nombre: 'Volumen', datos: r.datos.datos }] : [];

  /* Un solo color para todas las barras, como en el sistema viejo. Pintar
   * cada barra del color de su toma sería más coherente con los gráficos de
   * arriba, pero aquí el eje ya dice de qué toma es cada una: el color no
   * añadiría nada y ApexCharts mete una leyenda de siete entradas para
   * repetir lo que pone debajo. */
  const lienzo = (altura) => (
    <Grafico tipo="bar" altura={altura} unidad="m3"
             categorias={r.datos ? r.datos.categorias : []}
             series={series} colores={['#1268C3']}
             cargando={r.cargando} error={r.error} diagnostico={r.diagnostico} />
  );

  return (
    <>
      <Tarjeta
        titulo="Volumen por tomas"
        icono={<FaChartBar />}
        filtros={(
          <>
            <SelectorTomas id="tm-voltomas" etiqueta="Tomas" tomas={tomas}
                           seleccion={f.tomas} onCambio={f.setTomas} />
            <SelectorPeriodo id="pe-voltomas" valor={f.periodo}
                             onCambio={f.setPeriodo} />
            <SelectorFecha id="fe-voltomas" valor={f.fecha} periodo={f.periodo}
                           onCambio={f.setFecha} />
          </>
        )}
      >
        <BarraGrafico
          onDescargar={r.datos ? () => descargaCSV(
            `Volumen por tomas ${rotuloPeriodo(f.periodo, f.fecha)}`,
            r.datos.categorias, series, 'm3',
          ) : undefined}
          onAmpliar={() => setAmpliado(true)}
        />
        {lienzo(300)}
      </Tarjeta>

      {ampliado && (
        <Ampliado titulo={`Volumen por tomas · ${rotuloPeriodo(f.periodo, f.fecha)}`}
                  onCerrar={() => setAmpliado(false)}>
          {lienzo(560)}
        </Ampliado>
      )}
    </>
  );
}

/* ── Volumen mensual ───────────────────────────────────────────────────── */

/**
 * Los doce meses salen siempre, tengan dato o no.
 *
 * Si el eje se armara con los meses que traen datos, un año con lecturas
 * desde julio se dibujaría como si el año empezase en julio: las barras
 * llenarían el ancho y nadie vería que faltan seis meses.
 */
function VolumenMensual({ tomas, toma, onToma, anio, onAnio, r }) {
  const [ampliado, setAmpliado] = useState(false);
  const series = r.datos ? [{ nombre: 'Volumen', datos: r.datos.datos }] : [];

  const lienzo = (altura) => (
    <Grafico tipo="bar" altura={altura} unidad="m3"
             categorias={r.datos ? r.datos.categorias : []}
             series={series} colores={['#1baf7a']}
             cargando={r.cargando} error={r.error} diagnostico={r.diagnostico} />
  );

  return (
    <>
      <Tarjeta
        titulo="Volumen Mensual"
        icono={<FaDatabase />}
        filtros={(
          <>
            <div className="hm-campo">
              <label htmlFor="vol-toma">Toma</label>
              <select id="vol-toma" className="hm-select" value={toma}
                      onChange={(e) => onToma(e.target.value)}>
                {tomas.length === 0 && <option value="">—</option>}
                {tomas.map((t) => (
                  <option key={t.id} value={t.id}>{t.nombre}</option>
                ))}
              </select>
            </div>
            <SelectorAnio id="vol-anio" valor={anio} onCambio={onAnio} />
          </>
        )}
      >
        <BarraGrafico
          onDescargar={r.datos ? () => descargaCSV(
            `Volumen mensual ${anio}`, r.datos.categorias, series, 'm3',
          ) : undefined}
          onAmpliar={() => setAmpliado(true)}
        />
        {lienzo(300)}
      </Tarjeta>

      {ampliado && (
        <Ampliado titulo={`Volumen Mensual · ${anio}`}
                  onCerrar={() => setAmpliado(false)}>
          {lienzo(560)}
        </Ampliado>
      )}
    </>
  );
}
