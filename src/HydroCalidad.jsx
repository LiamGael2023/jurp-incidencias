/*
 * HYDROMETRIX · Calidad de Agua.
 *
 * Turbidez de salida por toma frente al canal fijo, y los tres dosajes.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * EL EJE DOBLE DEL GRAFICO VIEJO, Y POR QUE AQUI SON DOS GRAFICOS.
 *
 * El original mete en un solo lienzo las turbideces de las tomas (0–60 NTU,
 * eje izquierdo) y la del canal (0–240 NTU, eje derecho). Las dos son NTU
 * —la misma magnitud, la misma unidad—, así que el segundo eje no está
 * resolviendo una diferencia de unidades: está escondiendo una diferencia
 * de tamaño.
 *
 * Lo que eso produce es una mentira visual concreta: el canal a 197 NTU y
 * una toma a 50 NTU se dibujan a la misma altura. Quien mire el gráfico sin
 * leer los dos ejes —que es casi todo el mundo, casi siempre— concluye que
 * están igual de turbios cuando uno lo está cuatro veces más.
 *
 * Se parte en dos lienzos con el MISMO eje de NTU y el mismo eje de tiempo,
 * uno al lado del otro y con los filtros compartidos. Se compara igual de
 * bien —es para lo que sirve poner dos gráficos en paralelo— y ninguna
 * altura significa dos cosas distintas.
 *
 * Si se prefiere el aspecto del original, se dice y vuelve; pero conviene
 * saber qué se está cambiando por qué.
 * ──────────────────────────────────────────────────────────────────────────
 */
import { useMemo, useState } from 'react';
import {
  FaFlask, FaSyncAlt, FaTint, FaWater, FaVial, FaFillDrip,
} from 'react-icons/fa';
import './Hydrometrix.css';
import { normalizaTomas, parametros, METRICAS } from './datosHydro';
import {
  Bloque, Aviso, PanelSerie, FilaFiltros, useDatos, useFiltros,
  useEscalaCompartida,
} from './HydroPiezas';

/* Los tres dosajes, en el orden del sistema viejo. Los tres llevan una
 * serie por toma y el color sale del catálogo, igual que en Distribución:
 * la 10.4 es del mismo color en el floculante, en el sulfato y en los
 * caudales de la otra pantalla. */
const DOSAJES = [
  { metrica: METRICAS.floculante, titulo: 'Floculante', icono: <FaVial /> },
  { metrica: METRICAS.organico, titulo: 'C. Orgánico', icono: <FaFillDrip /> },
  { metrica: METRICAS.sulfato, titulo: 'Sulfato Férrico', icono: <FaVial /> },
];

export default function HydroCalidad() {
  const [recarga, setRecarga] = useState(0);

  const sinFiltro = useMemo(() => parametros({}), []);
  const cat = useDatos('tomas/', sinFiltro, normalizaTomas, recarga);
  const catalogo = cat.datos || [];

  /* Dos juegos de filtros, como en el original: el de las turbideces y el
   * de los dosajes. Se arranca en «Semana» porque los dosajes se apuntan a
   * diario y un solo día deja un gráfico de un punto. */
  const fNtu = useFiltros({ periodo: 'semana' });
  const fDos = useFiltros({ periodo: 'semana' });

  /*
   * LA ESCALA DE LOS DOS LIENZOS DE TURBIDEZ, que no tiene una respuesta
   * buena y por eso se elige.
   *
   * El canal va a ~197 NTU y las tomas a 8–26. Son dos preguntas distintas
   * sobre los mismos números:
   *
   *   · «¿se está yendo alguna toma?» se responde con la escala PROPIA: en
   *     0–60 se ve subir una toma dos puntos. Con la del canal, las siete
   *     quedan aplastadas contra el suelo y no se distingue nada.
   *   · «¿cuánto limpia el tratamiento?» se responde con la COMPARTIDA: ahí
   *     se ve de un vistazo que lo que entra es cuatro veces lo que sale.
   *
   * Lo que NO se puede hacer es tener las dos a la vez y callárselo, que es
   * lo que hace el eje doble del sistema viejo: el canal a 197 dibujado a
   * la misma altura que una toma a 50. El aviso de abajo dice siempre cuál
   * de las dos se está mirando.
   */
  const escalaNtu = useEscalaCompartida();
  const [compartida, setCompartida] = useState(false);
  const escalaActiva = { ...escalaNtu, max: compartida ? escalaNtu.max : undefined };

  return (
    <div className="hm">
      <header className="hm-head">
        <div>
          <div className="hm-pretitulo">Operadores L10</div>
          <h1 className="hm-titulo">Calidad de Agua</h1>
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
        {/* ── Turbidez ── */}
        <Bloque titulo="NTUs" icono={<FaTint />}
                derecha="Turbidez de salida vs canal fijo (10.2)">
          <FilaFiltros id="ntu" etiquetaTomas="Tomas para salida"
                       tomas={catalogo} f={fNtu}>
            <div className="hm-campo hm-campo-ancho">
              <label htmlFor="ntu-escala">Escala</label>
              <div className="hm-unidad" id="ntu-escala">
                <button type="button"
                        className={`hm-pastilla${compartida ? '' : ' activa'}`}
                        aria-pressed={!compartida}
                        onClick={() => setCompartida(false)}>
                  Propia
                </button>
                <button type="button"
                        className={`hm-pastilla${compartida ? ' activa' : ''}`}
                        aria-pressed={compartida}
                        onClick={() => setCompartida(true)}>
                  Compartida
                </button>
              </div>
            </div>
          </FilaFiltros>
          <div className="hm-rejilla-2">
            <PanelSerie titulo="Turbidez de salida por toma" icono={<FaTint />}
                        metrica={METRICAS.turbidezSalida} catalogo={catalogo}
                        tomas={catalogo} esCaudal={false} unidadFija="NTU"
                        filtrosExternos={fNtu} escala={escalaActiva}
                        recarga={recarga} />
            <PanelSerie titulo="Canal fijo L10 (10.2)" icono={<FaWater />}
                        metrica={METRICAS.turbidezCanal} catalogo={catalogo}
                        tomas={catalogo} conTomas={false} esCaudal={false}
                        unidadFija="NTU" colorFijo="#eda100"
                        filtrosExternos={fNtu} escala={escalaActiva}
                        recarga={recarga} />
          </div>
          {/* El aviso dice SIEMPRE cuál de las dos escalas está puesta.
              Callarlo es lo que convierte dos gráficos honrados en el
              engaño del eje doble. */}
          <Aviso tono="info" texto={compartida
            ? 'Los dos gráficos comparten eje, así que las alturas se '
              + 'comparan directamente: se ve de un vistazo cuánto baja la '
              + 'turbidez del canal a la salida. A cambio, las tomas quedan '
              + 'apretadas abajo y entre ellas casi no se distinguen.'
            : 'Cada gráfico tiene su propia escala —mírense los números del '
              + 'eje, no las alturas—. Así se ve si una toma se está yendo. '
              + 'Para comparar el canal con las tomas, pon la escala en '
              + '«Compartida».'} />
        </Bloque>

        {/* ── Dosajes ── */}
        <Bloque titulo="Dosajes" icono={<FaFlask />}
                derecha="Filtros compartidos para los 3 gráficos">
          <FilaFiltros id="dos" etiquetaTomas="Tomas para dosajes"
                       tomas={catalogo} f={fDos} />
          {/* Estos tres NO comparten escala, al revés que los dos de
              turbidez. Allí son la misma medida en dos sitios y el bloque
              se llama «vs»: la comparación es el objetivo. Aquí son tres
              productos distintos, y nadie pregunta si hay más floculante
              que sulfato; cada uno se mira contra su propia historia, y
              forzarles una vara común aplastaría al que dosifica poco. */}
          <div className="hm-rejilla-3">
            {DOSAJES.map((d) => (
              <PanelSerie key={d.metrica} titulo={d.titulo} icono={d.icono}
                          metrica={d.metrica} catalogo={catalogo}
                          tomas={catalogo} esCaudal={false} unidadFija="ppm"
                          filtrosExternos={fDos} recarga={recarga}
                          altura={260} />
            ))}
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
