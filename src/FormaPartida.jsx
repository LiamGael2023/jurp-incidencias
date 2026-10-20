/**
 * El alta de una partida propia de la incidencia.
 *
 * POR QUE UN FORMULARIO Y NO UNA ESCALERA. Aquí había un selector en tres
 * peldaños —Presupuesto → Partida de control → Estructura— sobre el
 * presupuesto de una obra. Para una incidencia no hay nada que recorrer: no
 * tiene presupuesto. Aparece cuando algo se rompe, y lo que hace falta para
 * arreglarlo se escribe entonces. La escalera sigue viva en SelectorPartida
 * para las actividades de obra, que sí lo tienen.
 *
 * EL CODIGO NO SE PIDE. Lo pone el servidor, correlativo dentro de esta
 * incidencia (01, 02, 03…). Pedirlo a mano solo servía para que el
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
export const UNIDADES = ['m3', 'm2', 'ml', 'und', 'glb', 'kg', 'bls', 'p2',
                         'hm', 'día', 'hh', 'hm3'];

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export const importeDe = (v) => num(v.metrado) * num(v.precio);

export default function FormaPartida({
  valor, errores = {}, guardando = false, titulo = 'Nueva partida',
  onCambio, onGuardar, onCancelar,
}) {
  const primero = useRef(null);

  /* El foco en la descripción al abrir. Sin esto hay que ir al ratón para
   * empezar a escribir en un formulario que se acaba de pedir a propósito. */
  useEffect(() => { if (primero.current) primero.current.focus(); }, []);

  const pon = (k) => (e) => onCambio({ ...valor, [k]: e.target.value });

  /* Enter guarda, Escape cancela. Son cuatro campos y se rellenan seguidos;
   * obligar a soltar el teclado para pulsar un botón convierte un alta de
   * cinco segundos en una de quince. */
  const tecla = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); if (!guardando) onGuardar(); }
    if (e.key === 'Escape') { e.preventDefault(); onCancelar(); }
  };

  const importe = importeDe(valor);

  return (
    <div className="cos-prog-forma" onKeyDown={tecla}>
      <div className="cos-prog-forma-tit">{titulo}</div>

      <div className="cos-prog-campos">
        <label className="cos-prog-campo ancho">
          <span>Descripción</span>
          <input ref={primero} type="text" value={valor.descripcion}
            maxLength={300} placeholder="Qué hay que hacer"
            className={errores.descripcion ? 'mal' : ''}
            onChange={pon('descripcion')} />
          {errores.descripcion && <em>{errores.descripcion}</em>}
        </label>

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
      </div>

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
