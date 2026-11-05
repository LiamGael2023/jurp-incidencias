/* El símbolo que le toca a un elemento del canal, por su nombre.
 *
 * ──────────────────────────────────────────────────────────────────────
 * POR QUÉ POR EL NOMBRE Y NO POR UN CÓDIGO
 * ──────────────────────────────────────────────────────────────────────
 *
 * Los recorridos rutinarios guardan el elemento con el nombre que lleva en
 * el KMZ —«Canoa C2D (38+291.00)», «TRAMO II 39+000 - 39+200 TUNEL -
 * CANAL»— porque es el único identificador que comparten el mapa de la app
 * y el del visor. El servidor no tiene el KMZ, así que no puede mandar un
 * tipo de estructura: lo que manda es ese nombre, y de ahí sale el símbolo.
 *
 * ──────────────────────────────────────────────────────────────────────
 * LA TABLA SALE DE CONTAR EL KMZ, NO DE SUPONER
 * ──────────────────────────────────────────────────────────────────────
 *
 * Esto es lo que hay de verdad en el Canal Madre (1084 elementos):
 *
 *   sub-tramos   CANAL 467 · TUNEL 223 · CONDUCTO CUBIERTO 50 ·
 *                SIFON 27 · ACUEDUCTO 1
 *   obras        TOMA 73 · CANOA 73 · ENTREGA 64 · ALCANTARILLA 45 ·
 *                PTE. 34 · ESTACION 6 · ALIVIADERO 5 · RAPIDA 3 ·
 *                BOCATOMA 2
 *
 * Dos cosas que solo se ven contando:
 *
 * - El KMZ escribe «CONDCUTO CUBIERTO» en tres sitios. Corregir el archivo
 *   renombraría elementos que ya están registrados con ese nombre, así que
 *   la expresión admite las dos formas.
 * - Los «Pte.» son 25 vehiculares y 9 peatonales, así que el peatonal va
 *   antes en la tabla: con el genérico delante, los nueve saldrían con el
 *   símbolo equivocado y nadie lo notaría.
 *
 * Las estaciones hidrométricas no tienen símbolo en la simbología oficial.
 * Se quedan sin él antes que prestado de otra cosa: un icono equivocado se
 * lee como un dato, y uno ausente se lee como lo que es.
 */

// La misma simbología que usan el inventario y el panel de capas KMZ, para
// que la misma estructura se vea igual en las tres pantallas.
import icoToma from './assets/simbologia/toma.png';
import icoEntrega from './assets/simbologia/entrega.png';
import icoCanoa from './assets/simbologia/canoa.png';
import icoSifon from './assets/simbologia/sifon.png';
import icoAlcantarilla from './assets/simbologia/alcantarilla.png';
import icoAliviadero from './assets/simbologia/aliviadero.png';
import icoDesarenador from './assets/simbologia/desarenador.png';
import icoCaida from './assets/simbologia/caida.png';
import icoConducCubierto from './assets/simbologia/conducto_cubierto.png';
import icoPaseVehicular from './assets/simbologia/pase_vehicular.png';
import icoPasePeatonal from './assets/simbologia/pase_peatonal.png';
import icoBocatoma from './assets/simbologia/bocatoma.png';
import icoRapida from './assets/simbologia/rapida.png';
import icoTransicion from './assets/simbologia/transicion.png';
import icoAcueducto from './assets/simbologia/acueducto.png';
import icoCanalMadre from './assets/simbologia/canal_madre.png';
import icoTunel from './assets/simbologia/tunel.png';

/* Mayúsculas y sin acentos: el KMZ escribe «Estación» y «Estacion» en el
 * mismo archivo, y comparar con acentos haría que una de las dos fallara. */
const normaliza = (t) => (t || '')
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '')
  .toUpperCase()
  .trim();

/* Las obras se reconocen por cómo EMPIEZA el nombre: «Canoa C2D», «Entrega
 * E3F», «Pte. Peatonal PP1». El peatonal va antes que el genérico, o todos
 * los puentes saldrían como vehiculares. */
const OBRAS = [
  [/^BOCATOMA/, icoBocatoma, 'Bocatoma'],
  [/^(PTE\.?|PUENTE)\s*PEATONAL/, icoPasePeatonal, 'Pase peatonal'],
  [/^(PTE\.?|PUENTE)/, icoPaseVehicular, 'Pase vehicular'],
  [/^TOMA/, icoToma, 'Toma'],
  [/^CANOA/, icoCanoa, 'Canoa'],
  [/^ENTREGA/, icoEntrega, 'Entrega'],
  [/^ALCANTARILLA/, icoAlcantarilla, 'Alcantarilla'],
  [/^ALIVIADERO/, icoAliviadero, 'Aliviadero'],
  [/^RAPIDA/, icoRapida, 'Rápida'],
  [/^SIFON/, icoSifon, 'Sifón'],
  [/^DESARENADOR/, icoDesarenador, 'Desarenador'],
  [/^CAIDA/, icoCaida, 'Caída'],
  [/^TRANSICION/, icoTransicion, 'Transición'],
  [/^ACUEDUCTO/, icoAcueducto, 'Acueducto'],
];

/* Los sub-tramos llevan la estructura al final: «… 39+000 - 39+200 TUNEL -
 * CANAL». Se busca de lo más específico a lo más general, porque un nombre
 * puede llevar dos —«TUNEL - CANAL» es un túnel que sigue en canal— y lo
 * que lo distingue de la franja de al lado es lo primero. */
const SUBTRAMOS = [
  [/ACUEDUCTO/, icoAcueducto, 'Acueducto'],
  [/SIFON/, icoSifon, 'Sifón'],
  [/TUNEL/, icoTunel, 'Túnel'],
  [/COND(UC|CU)TO\s*CUBIERTO/, icoConducCubierto, 'Conducto cubierto'],
  [/CANAL/, icoCanalMadre, 'Canal'],
];

/**
 * El símbolo de un elemento, o null si no le corresponde ninguno.
 *
 * @param {string} clave  el nombre del KMZ, tal como lo guarda el servidor
 * @param {string} tipo   'subtramo', 'obra' o 'tramo'
 * @returns {{src: string, nombre: string}|null}
 */
export function simboloDeElemento(clave, tipo) {
  const t = normaliza(clave);
  if (!t) return tipo === 'tramo' ? { src: icoCanalMadre, nombre: 'Canal' } : null;

  // Con el tipo sabido se mira solo su tabla; sin él —un registro viejo— se
  // prueban las dos, primero las obras, que son las que se reconocen por el
  // principio del nombre y no se confunden con un sub-tramo.
  const tablas = tipo === 'subtramo' ? [SUBTRAMOS]
    : tipo === 'obra' ? [OBRAS]
    : [OBRAS, SUBTRAMOS];

  for (const tabla of tablas) {
    for (const [patron, src, nombre] of tabla) {
      if (patron.test(t)) return { src, nombre };
    }
  }
  return null;
}
