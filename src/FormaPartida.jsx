/**
 * El alta de una fila del presupuesto propio de la incidencia.
 *
 * DOS CLASES DE FILA, y la diferencia no es cosmética:
 *
 *   - TÍTULO. Solo descripción. Su total es la suma de lo que cuelga, y lo
 *     calcula el servidor. Por eso aquí no hay dónde teclearlo: un total
 *     escrito a mano deja de cuadrar con sus hijos en cuanto se corrige uno,
 *     y como los dos números son plausibles nadie lo nota.
 *   - PARTIDA. Unidad, metrado y precio. Es la única contra la que un parte
 *     diario puede imputar.
 *
 * POR QUE UN FORMULARIO Y NO UNA ESCALERA. Aquí había un selector en tres
 * peldaños sobre el presupuesto de una obra. Para una incidencia no hay nada
 * que recorrer: no tiene presupuesto. Aparece cuando algo se rompe, y lo que
 * hace falta para arreglarlo se escribe entonces. La escalera sigue viva en
 * SelectorPartida para las actividades de obra, que sí lo tienen.
 *
 * EL CODIGO NO SE PIDE. Lo pone el servidor, jerárquico: 01, 02 en la raíz;
 * 01.01, 01.02 debajo del 01. Pedirlo a mano solo servía para que el
 * formulario rebotara con «ya existe» cuando alguien repitiera uno.
 *
 * EL IMPORTE NO SE ESCRIBE, SE VE. Es metrado × precio, y se recalcula
 * mientras escribes. Un campo más que cuadrar a mano es un campo más donde
 * el total deja de cuadrar sin que nadie se entere.
 */
import { useRef, useEffect } from 'react';
import { FaCheck, FaTimes } from 'react-icons/fa';

/* Las de siempre en estos presupuestos. Es una lista de ayuda, no una
 * jaula: el campo admite cualquier cosa, porque la unidad rara del día que
 * menos lo esperas existe y no vale bloquear el alta por ella. */
export const UNIDADES = ['m3', 'm2', 'ml', 'und', 'glb', 'gbl', 'kg', 'bls',
                         'p2', 'mes', 'día', 'hh', 'hm'];

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export const importeDe = (v) => num(v.metrado) * num(v.precio);

/** Los títulos donde se puede colgar algo, con su sangría, más la raíz. */
export const destinos = (filas = []) => [
  { id: '', etiqueta: '— En la raíz —' },
  ...filas.filter(f => f.es_titulo).map(f => ({
    id: String(f.id),
    etiqueta: `${' '.repeat(Math.max(0, (f.nivel || 1) - 1) * 4)}${f.codigo} · ${f.descripcion}`,
  })),
];

export default function FormaPartida({
  valor, errores = {}, guardando = false, tipo = 'partida',
  padres = [], titulo,
  onCambio, onGuardar, onCancelar,
}) {
  const primero = useRef(null);
  const esTitulo = tipo === 'titulo';

  /* El foco en la descripción al abrir. Sin esto hay que ir al ratón para
   * empezar a escribir en un formulario que se acaba de pedir a propósito. */
  useEffect(() => { if (primero.current) primero.current.focus(); }, []);

  const pon = (k) => (e) => onCambio({ ...valor, [k]: e.target.value });

  /* Enter guarda, Escape cancela. Son pocos campos y se rellenan seguidos;
   * obligar a soltar el teclado para pulsar un botón convierte un alta de
   * cinco segundos en una de quince. */
  const tecla = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); if (!guardando) onGuardar(); }
    if (e.key === 'Escape') { e.preventDefault(); onCancelar(); }
  };

  const importe = importeDe(valor);
  const cab = titulo || (esTitulo ? 'Nuevo título' : 'Nueva partida');

  return (
    <div className={`cos-prog-forma${esTitulo ? ' es-titulo' : ''}`}
      onKeyDown={tecla} data-tipo={tipo}>
      <div className="cos-prog-forma-tit">{cab}</div>

      <div className="cos-prog-campos">
        {/* Dónde va. Solo cuando hay algún título: con el presupuesto vacío
            la única respuesta posible es «en la raíz», y un desplegable de
            una sola opción es una decisión que no existe. */}
        {padres.length > 1 && (
          <label className="cos-prog-campo medio">
            <span>Dónde va</span>
            <select value={valor.padre ?? ''} onChange={pon('padre')}
              className={errores.padre ? 'mal' : ''}>
              {/* El valor es el CODIGO, no el id: en un presupuesto
                  importado los títulos no son filas y no tienen id, pero
                  código sí tienen, y es lo único que hace falta. */}
              {padres.map(d => (
                <option key={d.valor} value={d.valor}>{d.etiqueta}</option>
              ))}
            </select>
            {errores.padre && <em>{errores.padre}</em>}
          </label>
        )}

        <label className="cos-prog-campo ancho">
          <span>Descripción</span>
          <input ref={primero} type="text" value={valor.descripcion}
            maxLength={300}
            placeholder={esTitulo ? 'TRABAJOS PRELIMINARES' : 'Qué hay que hacer'}
            className={errores.descripcion ? 'mal' : ''}
            onChange={pon('descripcion')} />
          {errores.descripcion && <em>{errores.descripcion}</em>}
        </label>

        {/* Un título no lleva unidad, metrado ni precio: su total es la suma
            de lo que cuelga. Enseñar los campos en gris invitaría a
            preguntarse por qué no se pueden rellenar. */}
        {!esTitulo && (<>
          <label className="cos-prog-campo corto">
            <span>Unidad</span>
            <input type="text" value={valor.unidad} list="cos-unidades"
              maxLength={12} placeholder="m3"
              className={errores.unidad ? 'mal' : ''}
              onChange={pon('unidad')} />
            {errores.unidad && <em>{errores.unidad}</em>}
          </label>

          <label className="cos-prog-campo corto">
            <span>Metrado</span>
            <input type="number" min="0" step="any" value={valor.metrado}
              placeholder="0"
              className={errores.metrado ? 'mal' : ''}
              onChange={pon('metrado')} />
            {errores.metrado && <em>{errores.metrado}</em>}
          </label>

          <label className="cos-prog-campo corto">
            <span>Precio unitario</span>
            <input type="number" min="0" step="any" value={valor.precio}
              placeholder="0.00"
              className={errores.precio ? 'mal' : ''}
              onChange={pon('precio')} />
            {errores.precio && <em>{errores.precio}</em>}
          </label>

          <div className="cos-prog-campo corto cos-prog-importe">
            <span>Importe</span>
            <b data-prueba="importe">
              S/ {importe.toLocaleString('es-PE',
                { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </b>
          </div>
        </>)}
      </div>

      {esTitulo && (
        <div className="cos-prog-pista">
          Un título no lleva metrado ni precio: su total es la suma de las
          partidas que cuelguen de él.
        </div>
      )}

      <datalist id="cos-unidades">
        {UNIDADES.map(u => <option key={u} value={u} />)}
      </datalist>

      <div className="cos-prog-forma-pie">
        <button type="button" className="cos-prog-cancel"
          onClick={onCancelar} disabled={guardando}>
          <FaTimes size={10} /> Cancelar
        </button>
        <button type="button" className="cos-prog-ok"
          onClick={onGuardar} disabled={guardando}>
          <FaCheck size={10} /> {guardando ? 'Guardando…' : 'Guardar'}
        </button>
      </div>
    </div>
  );
}
