/* Qué puede hacer quien está mirando, y en qué pantalla.
 *
 * ──────────────────────────────────────────────────────────────────────
 * LO QUE ESTO ES Y LO QUE NO ES
 * ──────────────────────────────────────────────────────────────────────
 *
 * Esto es la CORTESÍA, no el candado. Esconde lo que esa persona no puede
 * hacer para que no descubra sus permisos a base de errores rojos. Quien
 * conozca la URL de la API seguiría pudiendo, y por eso el permiso de
 * verdad lo comprueba el servidor en cada petición: ahí vive el 403.
 *
 * Las dos piezas se necesitan. Solo el servidor da una pantalla llena de
 * botones que fallan; solo la web da una puerta con el cartel puesto y
 * sin cerradura.
 *
 * ──────────────────────────────────────────────────────────────────────
 * SE PIDE UNA VEZ, Y SI NO SE PUEDE, SE DEJA PASAR TODO
 * ──────────────────────────────────────────────────────────────────────
 *
 * Un servidor sin el parche responde 404 aquí. Si eso escondiera el menú,
 * actualizar la web antes que el servidor dejaría a todo el mundo con una
 * pantalla en blanco y sin forma de entender por qué. Así que cuando no
 * se sabe, se permite: es exactamente lo de hoy, que es un estado
 * conocido y que funciona.
 */
import { pedir } from './sesion';

const API = '/api/v1/mobile/permisos/';

export const ACCIONES = ['ver', 'crear', 'editar', 'borrar'];

/* El estado, fuera de React a propósito: lo consultan componentes que no
 * son hijos unos de otros —el menú, cada pantalla, un botón suelto— y
 * pasarlo por propiedades obligaría a enhebrarlo por veinte sitios. */
let rejilla = null;        // null = todavía no se sabe
let catalogo = [];
let cargando = null;       // la promesa en curso, para no pedirlo dos veces
const avisados = new Set();

/**
 * Pide los permisos de quien ha entrado. Idempotente: varias llamadas a la
 * vez comparten una sola petición.
 *
 * @param {boolean} forzar  vuelve a pedirlos aunque ya se tengan
 */
export async function cargarPermisos(forzar = false) {
  if (!forzar && rejilla !== null) return rejilla;
  if (!forzar && cargando) return cargando;

  cargando = (async () => {
    const { ok, datos } = await pedir(`${API}mios/`, { callar: [401, 403, 404] });
    if (ok && datos && datos.permisos) {
      rejilla = datos.permisos;
      catalogo = datos.pantallas || [];
    } else {
      /* SIN RESPUESTA NO SE RESTRINGE NADA. Un servidor viejo, un corte de
       * red o una sesión recién caducada no son razones para esconderle a
       * nadie la mitad del sistema. */
      rejilla = null;
      catalogo = [];
    }
    cargando = null;
    return rejilla;
  })();

  return cargando;
}

/** Olvida lo cargado. Al cerrar sesión, para que el siguiente no herede. */
export function olvidarPermisos() {
  rejilla = null;
  catalogo = [];
  cargando = null;
  avisados.clear();
}

/** ¿Se sabe algo de permisos? false = este servidor no los tiene. */
export function hayPermisos() {
  return rejilla !== null;
}

/** Las pantallas que el servidor declara, para la rejilla de configuración. */
export function pantallasConocidas() {
  return catalogo;
}

/**
 * ¿Puede esta persona hacer `accion` en `pantalla`?
 *
 * Mientras no se sepa —o el servidor no tenga permisos— devuelve true. Ver
 * arriba: no saber no es lo mismo que no poder.
 */
export function puedo(pantalla, accion = 'ver') {
  if (rejilla === null) return true;
  const fila = rejilla[pantalla];
  if (!fila) return false;
  return !!fila[accion];
}

/** Atajo para el caso de siempre: ¿sale esta pantalla en el menú? */
export const puedoVer = (pantalla) => puedo(pantalla, 'ver');

/**
 * Las cuatro acciones de una pantalla, de una vez.
 *
 * Para desestructurar en un componente: `const { crear, borrar } = loQuePuedo('lista')`.
 * Es lo mismo que cuatro llamadas a `puedo`, pero se lee como lo que es:
 * los permisos de ESTA pantalla, juntos y arriba del todo.
 */
export function loQuePuedo(pantalla) {
  const fuera = {};
  for (const a of ACCIONES) fuera[a] = puedo(pantalla, a);
  return fuera;
}
