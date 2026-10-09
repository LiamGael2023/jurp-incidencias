// ═══════════════════════════════════════════════════════════════════════════
//  Elegir una partida del presupuesto, bajando por el árbol
// ═══════════════════════════════════════════════════════════════════════════
//
// Se baja nivel por nivel, como está en el Excel:
//
//   01           CONSTRUCCION Y MEJORAMIENTO … TOMA 10.6
//   01.02        ESTRUCTURAS DE TRATAMIENTO
//   01.02.04     CAJA DE DERIVACION
//   01.02.04.01  MOVIMIENTO DE TIERRAS
//   01.02.04.01.01  Excavación manual …
//
// LA PROFUNDIDAD NO ES FIJA y esto es lo que manda en el diseño: de las 83
// partidas del presupuesto cargado, 78 cuelgan de cuatro títulos y 5 cuelgan
// de tres —TRABAJOS PRELIMINARES, OBRAS PROVISIONALES y FLETE van directas—.
// Por eso los peldaños se dibujan según la rama y no con un número fijo de
// combos: con cinco fijos, esas tres ramas enseñarían un combo vacío que no
// lleva a ninguna parte.
//
// UN NIVEL CON UNA SOLA OPCIÓN SE DA POR ELEGIDO. Arriba del todo solo hay un
// presupuesto, así que se ve el camino completo sin tener que abrir dos
// combos que no deciden nada.
//
// Esto vivía dentro de Incidentes.jsx. Está aquí para que el parte y la
// actividad elijan la partida de la misma manera: dos escaleras distintas
// para el mismo árbol acabarían bajando distinto. Las funciones que leen el
// árbol están en arbolPartidas.js.

import { rutaDe, cuelgaDe, bajarSolo } from './arbolPartidas';

const ETQ = ['Presupuesto', 'Partida de control', 'Estructura', 'Capítulo',
  'Subcapítulo'];

/**
 * Los combos dependientes.
 *
 *   partidas  lista completa del presupuesto del proyecto
 *   camino    códigos elegidos hasta ahora (estado del que llama)
 *   onCamino  nuevo camino
 *   valor     id de la partida elegida, o ''
 *   onElegir  id de la partida (o '' al vaciar)
 *   ocultar   ids que ya no se ofrecen (las que ya están puestas)
 */
export default function EscaleraPartida({
  partidas, camino, onCamino, valor, onElegir, ocultar = [], compacto = false,
}) {
  if (!partidas || !partidas.length) return null;

  // Un peldaño por cada nivel del camino, más el siguiente.
  const peldanos = [];
  for (let i = 0; i <= camino.length; i++) {
    const base = partidas.filter(p => cuelgaDe(p, camino.slice(0, i)));
    const ops = [];
    base.forEach(p => {
      const n = rutaDe(p)[i];
      if (n && !ops.some(o => o[0] === n[0])) ops.push(n);
    });
    if (ops.length) peldanos.push({ i, ops, valor: camino[i] || '' });
  }

  // Las de este nivel: las que ya no tienen más ruta por debajo.
  const fuera = new Set(ocultar.map(String));
  const enEsteNivel = partidas
    .filter(p => cuelgaDe(p, camino) && rutaDe(p).length === camino.length);
  const hojas = enEsteNivel.filter(p => !fuera.has(String(p.id)));

  // Al elegir un nivel se corta lo que había debajo y se vuelven a bajar los
  // niveles de un solo hijo.
  const elegirNivel = (i, cod) => {
    const corte = camino.slice(0, i);
    onCamino(bajarSolo(partidas, cod ? corte.concat([cod]) : corte));
    onElegir('');
  };

  const sel = { ...ctrl, width:'100%' };

  return (
    <div>
      {peldanos.map(({ i, ops, valor: v }) => (
        <div key={i} style={{ marginBottom: compacto ? '7px' : '9px' }}>
          <label style={etiqueta}>{i + 1} · {ETQ[i] || `Nivel ${i + 1}`}</label>
          <select value={v} onChange={e => elegirNivel(i, e.target.value)}
            style={sel}>
            <option value="">— Elegir —</option>
            {ops.map(([c, d]) => (
              <option key={c} value={c}>{c} · {d}</option>
            ))}
          </select>
        </div>
      ))}

      {hojas.length > 0 ? (
        <div>
          <label style={etiqueta}>{peldanos.length + 1} · Partida</label>
          <select value={valor || ''} onChange={e => onElegir(e.target.value)}
            style={sel}>
            <option value="">— Elegir —</option>
            {hojas.map(p => (
              <option key={p.id} value={p.id}>
                {p.codigo} · {p.descripcion} ({p.unidad})
              </option>
            ))}
          </select>
        </div>
      ) : enEsteNivel.length > 0 && (
        /* Solo cuando LAS HABÍA y ya están todas puestas. Un nivel que
           simplemente no tiene partidas -porque todavía quedan títulos por
           debajo- no es nada digno de mención: el combo de abajo ya dice
           que hay que seguir bajando. */
        <div style={{ fontSize:'11.5px', color:'#94a3b8', paddingTop:'3px' }}>
          Las partidas de este nivel ya están todas puestas.
        </div>
      )}
    </div>
  );
}

const etiqueta = { display:'block', fontSize:'11px', fontWeight:700,
  color:'#475569', marginBottom:'4px' };
const ctrl = { padding:'8px 10px', border:'1px solid #cbd5e1',
  borderRadius:'7px', fontSize:'12.5px', fontFamily:'inherit',
  background:'#fff', boxSizing:'border-box' };
