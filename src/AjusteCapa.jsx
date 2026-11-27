/* EL PANELITO QUE DEJA RETOCAR UNA CAPA.
 *
 * ──────────────────────────────────────────────────────────────────────
 * QUÉ ENSEÑA CUANDO NO HAY NADA AJUSTADO
 * ──────────────────────────────────────────────────────────────────────
 *
 * Los valores de fábrica, los que la capa declara en su catálogo. No el
 * color exacto que se ve en pantalla, que puede no ser el mismo: la
 * lámina engorda los trazos al imprimir, las capas del PECH van más
 * tenues, un lote se colorea por licencia y un sector por reparto. Esos
 * cálculos dependen de cada polígono, así que no hay UN valor que
 * enseñar.
 *
 * Lo que sí es cierto es que, en cuanto se mueve un control, ese campo
 * pasa a mandar sobre todo lo demás. Mientras no se toque, el sistema
 * sigue decidiendo.
 *
 * ──────────────────────────────────────────────────────────────────────
 * POR QUÉ CADA CONTROL TIENE SU PROPIA «X»
 * ──────────────────────────────────────────────────────────────────────
 *
 * Porque ajustar el grosor no debería obligarte a quedarte también con
 * un color congelado. Cada campo se suelta por separado y vuelve a lo
 * que diga el sistema, que es lo que permite afinar una cosa sin
 * renunciar a que las demás mejoren solas.
 */
import { useState, useRef, useEffect } from 'react';
import { FaSlidersH, FaUndo, FaTimes } from 'react-icons/fa';
import { ajusteDe, ajustar, restablecer, estaAjustada,
         useAjustesCapas } from './estiloCapas';

/* Lo que trae la capa de fábrica, para enseñarlo mientras no se toque.
 * Son aproximaciones a propósito: ver la cabecera. */
function deFabrica(capa) {
  return {
    color: capa.color || '#888888',
    weight: capa.weight || (capa.tipo === 'line' ? 3 : 1.2),
    opacity: capa.opacidad != null ? capa.opacidad : 0.95,
    fillOpacity: capa.sinRelleno ? 0 : (capa.tipo === 'poly' ? 0.08 : 0),
    dash: !!capa.dash && !capa.continua,
    rotulo: !!capa.rotulo,
  };
}

function Fila({ etiqueta, tocado, onSoltar, children }) {
  return (
    <div className={`aj-fila${tocado ? ' aj-tocado' : ''}`}>
      <span className="aj-eti">{etiqueta}</span>
      <span className="aj-ctl">{children}</span>
      <button type="button" className="aj-soltar" onClick={onSoltar}
        disabled={!tocado}
        title={tocado ? 'Volver a lo que decide el sistema' : 'Sin ajustar'}>
        <FaUndo />
      </button>
    </div>
  );
}

/**
 * @param capa        la capa, o un sector disfrazado de capa
 * @param cosa        cómo llamarla en los textos: «capa» o «sector».
 * @param soloCampos  limita qué controles salen. Para un sector solo
 *                    tienen sentido el color y el relleno: el grosor y el
 *                    punteado son del contorno, que es uno para toda la
 *                    capa, y los nombres salen del campo del rótulo. Un
 *                    panel con cuatro controles que no hacen nada enseña
 *                    a desconfiar del que sí hace algo.
 */
export default function AjusteCapa({ capa, soloCampos = null, cosa = 'capa' }) {
  const [abierto, setAbierto] = useState(false);
  const caja = useRef(null);

  /* SE SUSCRIBE ÉL MISMO, y no se fía de que lo haga quien lo coloca.
   *
   * Los valores que enseña salen de un módulo que vive fuera de React, así
   * que mover un deslizador cambia el mapa pero no vuelve a dibujar este
   * panel: el número se quedaría clavado en el valor anterior y la «X» de
   * soltar no se encendería. Funcionaba por casualidad mientras un
   * ancestro estuviera suscrito, y eso se rompe en cuanto alguien use
   * este componente en otra pantalla. */
  useAjustesCapas();

  /* Se cierra al pinchar fuera. Sin esto quedan tres paneles abiertos a
   * la vez y la lista de capas se vuelve ilegible. */
  useEffect(() => {
    if (!abierto) return;
    const fuera = (e) => {
      if (caja.current && !caja.current.contains(e.target)) setAbierto(false);
    };
    const tecla = (e) => { if (e.key === 'Escape') setAbierto(false); };
    document.addEventListener('mousedown', fuera);
    document.addEventListener('keydown', tecla);
    return () => {
      document.removeEventListener('mousedown', fuera);
      document.removeEventListener('keydown', tecla);
    };
  }, [abierto]);

  const a = ajusteDe(capa.codigo);
  const base = deFabrica(capa);
  const val = { ...base, ...a };
  const tocada = estaAjustada(capa.codigo);
  const esArea = capa.tipo === 'poly';
  const sale = (campo) => !soloCampos || soloCampos.includes(campo);

  const poner = (campo, v) => ajustar(capa.codigo, { [campo]: v });
  const soltar = (campo) => ajustar(capa.codigo, { [campo]: undefined });

  return (
    <span className="aj-raiz" ref={caja}>
      <button type="button"
        className={`aj-boton${tocada ? ' aj-boton-on' : ''}`}
        onClick={() => setAbierto(v => !v)}
        title={tocada ? `Ajustes tuyos en est${cosa === 'capa' ? 'a capa' : 'e ' + cosa}`
          : `Ajustar est${cosa === 'capa' ? 'a capa' : 'e ' + cosa}`}>
        <FaSlidersH />
      </button>

      {abierto && (
        <div className="aj-panel" onClick={(e) => e.stopPropagation()}>
          <div className="aj-cab">
            <strong>{capa.label}</strong>
            <button type="button" className="aj-cerrar"
              onClick={() => setAbierto(false)} title="Cerrar"><FaTimes /></button>
          </div>

          {sale('color') && (
            <Fila etiqueta="Color" tocado={a.color !== undefined}
              onSoltar={() => soltar('color')}>
              <input type="color" value={val.color}
                onChange={(e) => poner('color', e.target.value)} />
            </Fila>
          )}

          {sale('weight') && (
            <Fila etiqueta="Grosor" tocado={a.weight !== undefined}
              onSoltar={() => soltar('weight')}>
              {/* Desde 0,3: el blanco fino de las cuencas está en 0,7 y hay
                  que poder bajar de ahí. Hasta 6, que es más de lo que
                  cualquiera va a querer y evita que un resbalón deje una
                  capa de veinte píxeles. */}
              <input type="range" min="0.3" max="6" step="0.1" value={val.weight}
                onChange={(e) => poner('weight', parseFloat(e.target.value))} />
              <em>{Number(val.weight).toFixed(1)}</em>
            </Fila>
          )}

          {sale('opacity') && (
            <Fila etiqueta="Trazo" tocado={a.opacity !== undefined}
              onSoltar={() => soltar('opacity')}>
              <input type="range" min="0" max="1" step="0.05" value={val.opacity}
                onChange={(e) => poner('opacity', parseFloat(e.target.value))} />
              <em>{Math.round(val.opacity * 100)}%</em>
            </Fila>
          )}

          {esArea && sale('fillOpacity') && (
            <Fila etiqueta="Relleno" tocado={a.fillOpacity !== undefined}
              onSoltar={() => soltar('fillOpacity')}>
              <input type="range" min="0" max="1" step="0.02" value={val.fillOpacity}
                onChange={(e) => poner('fillOpacity', parseFloat(e.target.value))} />
              <em>{Math.round(val.fillOpacity * 100)}%</em>
            </Fila>
          )}

          {sale('dash') && (
            <Fila etiqueta="Punteada" tocado={a.dash !== undefined}
              onSoltar={() => soltar('dash')}>
              <input type="checkbox" checked={!!val.dash}
                onChange={(e) => poner('dash', e.target.checked)} />
            </Fila>
          )}

          {sale('rotulo') && (
            <Fila etiqueta="Nombres" tocado={a.rotulo !== undefined}
              onSoltar={() => soltar('rotulo')}>
              <input type="checkbox" checked={!!val.rotulo}
                onChange={(e) => poner('rotulo', e.target.checked)} />
            </Fila>
          )}

          <div className="aj-pie">
            <button type="button" onClick={() => restablecer(capa.codigo)}
              disabled={!tocada}>
              Restablecer est{cosa === 'capa' ? 'a capa' : 'e ' + cosa}
            </button>
          </div>
          {/* Dónde vive esto, dicho sin rodeos: alguien va a ajustar el
              mapa en un equipo y buscarlo en otro. */}
          <div className="aj-nota">Se guarda en este navegador.</div>
        </div>
      )}
    </span>
  );
}
