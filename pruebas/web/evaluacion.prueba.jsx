/* El formulario de evaluación y la ficha del activo, montados de verdad.
 *
 * Lo que de verdad se comprueba aquí es que SE VEAN. Dos veces seguidas
 * entregué estas pantallas con la paleta equivocada —texto casi blanco sobre
 * el fondo blanco del modal— y las dos veces compilaban, pasaban el linter y
 * no se leía nada. Un contraste no se revisa leyendo el CSS: hay que pintarlo
 * y medirlo.
 *
 * Por eso el arnés monta los componentes con un catálogo de campos parecido
 * al real —bloques, obligatorios, condicionales— y la prueba lee el color
 * calculado de cada rótulo.
 */
import { createRoot } from 'react-dom/client';
import { ModalEvaluacion, FichaActivo } from '../../src/InventarioGIS';

/* Un catálogo como los del ANA: bloques en la etiqueta antes de ' · ', dos
 * obligatorios sueltos arriba y bastantes campos repartidos. */
const CAMPOS = [
  { campo: 'estado_cons', etiqueta: 'Estado de conservación', orden: 1,
    tipo_dato: 'opcion', obligatorio: true,
    opciones: [{ codigo: 'B', etiqueta: 'Bueno' }, { codigo: 'R', etiqueta: 'Regular' },
               { codigo: 'M', etiqueta: 'Malo' }] },
  { campo: 'condicion', etiqueta: 'Condición operativa', orden: 2,
    tipo_dato: 'opcion', obligatorio: true,
    opciones: [{ codigo: 'OP', etiqueta: 'Operativa' },
               { codigo: 'IN', etiqueta: 'Inoperativa' }] },

  { campo: 'ubi_margen', etiqueta: 'Ubicación · Margen', orden: 3,
    tipo_dato: 'opcion', obligatorio: false,
    opciones: [{ codigo: 'I', etiqueta: 'Izquierda' }, { codigo: 'D', etiqueta: 'Derecha' }] },
  { campo: 'ubi_progresiva', etiqueta: 'Ubicación · Progresiva', orden: 4,
    tipo_dato: 'texto', obligatorio: false },

  { campo: 'obra_material', etiqueta: 'Obra · Material', orden: 5,
    tipo_dato: 'opcion', obligatorio: true,
    opciones: [{ codigo: 'C', etiqueta: 'Concreto' }, { codigo: 'T', etiqueta: 'Tierra' }] },
  { campo: 'obra_ancho', etiqueta: 'Obra · Ancho', orden: 6,
    tipo_dato: 'numero', obligatorio: false },
  { campo: 'obra_detalle', etiqueta: 'Obra · Detalle', orden: 7,
    tipo_dato: 'texto', obligatorio: false },

  { campo: 'comp_hay', etiqueta: 'Compuerta · Hay', orden: 8,
    tipo_dato: 'opcion', obligatorio: false,
    opciones: [{ codigo: 'S', etiqueta: 'Sí' }, { codigo: 'N', etiqueta: 'No' }] },
  { campo: 'comp_tipo', etiqueta: 'Compuerta · Tipo', orden: 9,
    tipo_dato: 'texto', obligatorio: false },
  { campo: 'comp_operativa', etiqueta: 'Compuerta · Operativa', orden: 10,
    tipo_dato: 'booleano', obligatorio: false },

  { campo: 'insp_limpieza', etiqueta: 'Inspección · Requiere limpieza', orden: 11,
    tipo_dato: 'booleano', obligatorio: false },
  { campo: 'insp_riesgo', etiqueta: 'Inspección · Riesgo', orden: 12,
    tipo_dato: 'opcion', obligatorio: true,
    opciones: [{ codigo: 'A', etiqueta: 'Alto' }, { codigo: 'B', etiqueta: 'Bajo' }] },
];

const PROPS = {
  fid: 3, nombre: '3B', codigo: '3B', ambito: 'JURP',
  nombre_canal: 'Lateral 10', progresiva: '22.5', margen: 'I',
  material: 'C', estado: 'R', area_total: 6190.96, num_usuarios: 0,
  observaciones: 'Sensor (FLO-DAR)', luz: 1.2, tipo_uso: 'A',
};

const CAPA = { codigo: 'tomas_otros', label: 'Tomas Otros Sectores', color: '#4c6ef5' };

window.__CAMPOS = CAMPOS;
window.__ESPERADO = {
  obligatorios: 4,          // estado_cons, condicion, obra_material, insp_riesgo
  bloques: ['Ubicación', 'Obra', 'Compuerta', 'Inspección'],
  // Compuerta · Tipo y · Operativa se esconden si 'Hay' = N
  ocultosConCompN: ['comp_tipo', 'comp_operativa'],
};

function inventarioFalso(que) {
  return {
    campania: { id: 1, anio: 2026, estado: 'abierta' },
    formularios: { tomas_otros: CAMPOS },
    evaluando: que === 'eval' ? { tipo: 'tomas_otros', fid: 3, props: PROPS } : null,
    ficha: que === 'ficha' ? { tipo: 'tomas_otros', fid: 3, props: PROPS, capa: CAPA } : null,
    evaluacionDe: () => null,
    cerrarEvaluacion: () => {},
    cerrarFicha: () => {},
    abrirEvaluacion: () => {},
    guardarEvaluacion: async () => ({ ok: true }),
  };
}

/* EL STUB VA AQUI, NO EN UN useEffect.
 * Los efectos de los hijos corren ANTES que los del padre, asi que la galeria
 * ya habia pedido sus fotos con el fetch de verdad antes de que el padre lo
 * sustituyera, y la prueba no veia ninguna foto. A nivel de modulo se instala
 * antes de que React monte nada. */
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
// ?fotos=1 para el caso con galeria; sin el, la ficha ensena el aviso de
// "todavia no hay fotos", que tambien hay que comprobar que se lee.
const CON_FOTOS = new URLSearchParams(location.search).has('fotos');
window.fetch = async (u) => {
  const url = String(u);
  if (url.includes('/fotos/') && CON_FOTOS) {
    return new Response(JSON.stringify([
      { id: 7, imagen: PNG, tomada: '2026-09-12', descripcion: 'Vista general' },
    ]), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  return new Response('{}', { status: 404 });
};

function Banco() {
  const cual = new URLSearchParams(location.search).get('v') || 'eval';
  const inv = inventarioFalso(cual);
  return cual === 'ficha' ? <FichaActivo inv={inv} /> : <ModalEvaluacion inv={inv} />;
}

createRoot(document.getElementById('app')).render(<Banco />);
