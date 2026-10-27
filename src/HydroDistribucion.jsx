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
  FaRegCalendarAlt, FaChartBar, FaDatabase,
  FaExclamationTriangle, FaCircle, FaArrowUp, FaExchangeAlt,
} from 'react-icons/fa';
import './Hydrometrix.css';
import {
  normalizaTomas, normalizaResumen, normalizaVolumen, parametros,
  COLOR_ESTADO, ROTULO_ESTADO, momentoLegible, cifra, MESES,
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
                        metrica="caudal_ingreso" catalogo={catalogo}
                        tomas={catalogo} recarga={recarga} />
            <PanelSerie titulo="Caudal de salida" icono={<FaTachometerAlt />}
                        metrica="caudal_salida" catalogo={catalogo}
                        tomas={catalogo} recarga={recarga} />
          </div>
          <div className="hm-rejilla-2">
            {/* La excedencia es de una sola toma: ni filtro de tomas ni
                leyenda, que el título ya dice cuál es. */}
            <PanelSerie titulo="Caudal de excedencia (toma 10.6/7)"
                        icono={<FaChartBar />} tipo="bar"
                        metrica="caudal_excedencia" catalogo={catalogo}
                        tomas={catalogo} conTomas={false}
                        colorFijo="#eda100" recarga={recarga} />
            <PanelSerie titulo="Caudal total vs Excedencia"
                        icono={<FaExchangeAlt />}
                        metrica="caudal_total" catalogo={catalogo}
                        tomas={catalogo} conTomas={false} recarga={recarga} />
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
