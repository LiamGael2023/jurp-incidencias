/**
 * El cuadro del presupuesto: títulos que agrupan y partidas con metrado.
 *
 * Lo usan dos pantallas —el costeo de una incidencia y el presupuesto de un
 * proyecto— y por eso vive aquí. Las dos dibujaban lo mismo, y dos copias de
 * una tabla con cabecera de dos pisos, sangrado por nivel y totales que se
 * suman se separan con el primer arreglo que se le haga a una.
 *
 * CABECERA DE DOS PISOS: las tres preguntas que se hace cualquiera mirando
 * esto —qué estaba programado, qué se lleva hecho, qué queda—. Sin agrupar,
 * «Cant.» aparecía tres veces y había que contar columnas para saber de cuál
 * era cada una.
 *
 * UN TITULO NO TIENE CANTIDADES. 3 m³ más 2 glb no son 5 de nada, así que
 * sus celdas de Cant. van vacías. Lo que sí suma es el dinero.
 *
 * LA FILA RAIZ NO ES UN DATO: es el sujeto —la incidencia o el proyecto— con
 * el total. Se dibuja, no se guarda. En el Excel del presupuesto ese nivel
 * es el nombre de la obra.
 */
import { FaPen, FaTrash } from 'react-icons/fa';
import { totalesDe } from './arbolPresupuesto';

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const fmt = (n) => (parseFloat(n) || 0).toLocaleString('es-PE',
  { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/* Vacío, no «0.00». Un cero donde no hay dato se lee como un dato. */
const cel = (v) => (v === null || v === undefined || v === '') ? '' : fmt(v);

const saldoImporteDe = (f) =>
  f.saldoImporte !== undefined && f.saldoImporte !== null
    ? num(f.saldoImporte)
    : num(f.importe) - num(f.valorizado);

export default function TablaPresupuesto({
  filas = [], raiz = null, acciones = false, ocupado = false,
  onEditar, onBorrar, tituloAccion = 'Corregir', borrarAccion = 'Borrar',
}) {
  if (!filas.length && !raiz) return null;
  const tot = totalesDe(filas);

  const fila = (f) => {
    const titulo = !!f.es_titulo;
    // El saldo en rojo cuando ya se pasó: es el único número de esta tabla
    // que obliga a hacer algo.
    const pasada = !titulo && num(f.saldo) < 0;
    return (
      <tr key={f.id ?? f.codigo} className={titulo ? 'cos-prog-titulo' : undefined}>
        <td className="cod"
          style={{ paddingLeft: 10 + (f.nivel || 1) * 12 }}>{f.codigo}</td>
        <td>{f.descripcion}</td>
        <td className="n g">{titulo ? '' : f.unidad}</td>
        <td className="n">{cel(titulo ? null : f.metrado)}</td>
        <td className="n">{cel(titulo ? null : f.precio)}</td>
        <td className="n">{fmt(f.importe)}</td>
        <td className="n g">{cel(titulo ? null : f.ejecutado)}</td>
        <td className="n">{fmt(f.valorizado)}</td>
        <td className={`n g${pasada ? ' mal' : ''}`}>
          {cel(titulo ? null : f.saldo)}{pasada && <b> pasada</b>}
        </td>
        <td className={`n${pasada ? ' mal' : ''}`}>{fmt(saldoImporteDe(f))}</td>
        {acciones && (
          <td className="n">
            {/* Solo lo que EXISTE como fila se puede tocar. Los títulos de un
                presupuesto importado se reconstruyen desde la ruta de sus
                partidas y no tienen id: ofrecer un lápiz que no puede
                guardar nada sería prometer algo que no hay. */}
            {f.id != null && onEditar && (
              <button type="button" className="cos-prog-edita" disabled={ocupado}
                title={`${tituloAccion} ${titulo ? 'este título' : 'esta partida'}`}
                onClick={() => onEditar(f)}><FaPen size={10} /></button>
            )}
            {f.id != null && onBorrar && (
              <button type="button" className="cos-prog-quita" disabled={ocupado}
                title={`${borrarAccion} ${titulo ? 'este título' : 'esta partida'}`}
                onClick={() => onBorrar(f)}><FaTrash size={10} /></button>
            )}
          </td>
        )}
      </tr>
    );
  };

  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="cos-prog-tabla">
        <thead>
          <tr className="cos-prog-grupos">
            <th rowSpan={2}>Item</th>
            <th rowSpan={2}>Descripción</th>
            <th className="g cen" colSpan={4}>Programado</th>
            <th className="g cen" colSpan={2}>Ejecutado</th>
            <th className="g cen" colSpan={2}>Saldo</th>
            {acciones && <th rowSpan={2} />}
          </tr>
          <tr>
            <th className="n g">Unid.</th>
            <th className="n">Cant.</th>
            <th className="n">Precio</th>
            <th className="n">Total</th>
            <th className="n g">Cant.</th>
            <th className="n">Total</th>
            <th className="n g">Cant.</th>
            <th className="n">Total</th>
          </tr>
        </thead>
        <tbody>
          {raiz && (
            <tr className="cos-prog-raiz">
              <td className="cod">{raiz.codigo ?? '1'}</td>
              <td>{raiz.descripcion}</td>
              <td className="g" /><td /><td />
              <td className="n">{fmt(tot.importe)}</td>
              <td className="g" />
              <td className="n">{fmt(tot.valorizado)}</td>
              <td className="g" />
              <td className="n">{fmt(tot.saldo)}</td>
              {acciones && <td />}
            </tr>
          )}
          {filas.map(fila)}
        </tbody>
      </table>
    </div>
  );
}
