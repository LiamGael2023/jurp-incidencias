/* La ficha del activo: qué características salen, y cómo se tratan las fotos.
 *
 *     node pruebas/ficha_activo.prueba.mjs
 *
 * Son las dos partes de la ficha que no dependen de React ni del mapa, que es
 * justo donde se rompen estas pantallas: decidir qué campo se enseña y de qué
 * forma, y decidir qué se sube y a qué dirección apunta cada foto.
 *
 * Lo que de verdad vigila esto:
 *
 *   - que un 0 o un false SE ENSEÑEN. "0 usuarios" dice algo muy distinto de
 *     "no se sabe cuántos usuarios", y tratarlos igual hace que la ficha
 *     mienta sin que nadie lo note.
 *   - que una ruta relativa de /media/ se resuelva contra el backend. El
 *     inventario se pide a /vigapi/, que es una reescritura del borde de
 *     Vercel: un '/media/...' suelto lo resolvería el navegador contra el
 *     dominio del front y daría un 404 silencioso, con el hueco de la imagen
 *     rota y ningún error en consola que lo explique.
 */
import {
  caracteristicas, cobertura, valorTexto, etiquetaDe, tituloActivo,
} from '../src/fichaActivo.js';
import {
  medidaDestino, nombreSalida, motivoRechazo, urlFoto, ordenarFotos, peso,
  prepararFoto, MAX_LADO,
} from '../src/fotosActivo.js';
import { MEDIA } from '../src/api.js';

let mal = 0, bien = 0;
const t = (etiqueta, obtenido, esperado) => {
  const ok = JSON.stringify(obtenido) === JSON.stringify(esperado);
  if (ok) { bien++; return; }
  mal++;
  console.log(`MAL  ${etiqueta}\n       esperaba ${JSON.stringify(esperado)}\n       obtuvo   ${JSON.stringify(obtenido)}`);
};

// ── Valores: lo que se enseña y lo que no ──────────────────────────────
t('un texto se enseña', valorTexto('material', 'Concreto'), 'Concreto');
t('vacío no', valorTexto('material', ''), null);
t('null no', valorTexto('material', null), null);
t('sin definir no', valorTexto('material', undefined), null);
t('la cadena "None" de Django tampoco', valorTexto('material', 'None'), null);
t('ni "null"', valorTexto('material', 'null'), null);

// EL CERO SÍ. Es el fallo clásico de estas fichas.
t('cero SE enseña', valorTexto('num_usuarios', 0), '0');
t('false SE enseña', valorTexto('operativo', false), 'No');
t('true', valorTexto('operativo', true), 'Sí');
t('"false" en texto también', valorTexto('operativo', 'false'), 'No');

t('las unidades que el dato no trae', valorTexto('area_total', 12.5), '12.5 ha');
t('cero con unidad sigue siendo cero', valorTexto('area_total', 0), '0 ha');
t('unidad sobre un número en texto', valorTexto('longitud', '340'), '340 m');
t('pero no sobre un texto de verdad', valorTexto('material', 'Concreto'), 'Concreto');
t('decimales recortados', valorTexto('caudal', 1.23456789), '1.235 m³/s');
t('NaN no se enseña', valorTexto('caudal', NaN), null);
t('infinito tampoco', valorTexto('caudal', Infinity), null);

t('etiqueta a partir del nombre de columna', etiquetaDe('nombre_canal'), 'Nombre canal');

// ── Qué filas salen y en qué orden ─────────────────────────────────────
const PROPS = {
  fid: 412, id: 9, geom: 'POINT(...)',        // internos: fuera
  ambito: 'JURP',                              // va en la cabecera
  observaciones: 'Sedimento en la entrada',
  material: 'Concreto',
  num_usuarios: 0,
  nombre: 'Alcantarilla Km 4+200',
  nombre_canal: 'Canal Madre',
  progresiva: '4+200',
  luz: 1.2,
  zz_campo_raro: 'algo',
  otro_campo: null,                            // sin dato: no ocupa fila
};

const filas = caracteristicas(PROPS);
const claves = filas.map(f => f.clave);

t('no se cuelan los identificadores internos',
  claves.filter(c => ['fid', 'id', 'geom'].includes(c)), []);
t('el ámbito no se repite en la tabla', claves.includes('ambito'), false);
t('un campo sin dato no ocupa fila', claves.includes('otro_campo'), false);
t('el cero SÍ ocupa fila', claves.includes('num_usuarios'), true);

t('orden: primero identifica, luego ubica, luego describe',
  claves, ['nombre', 'nombre_canal', 'progresiva', 'material', 'luz',
           'num_usuarios', 'observaciones', 'zz_campo_raro']);
t('las observaciones van al final, antes de lo desconocido',
  claves.indexOf('observaciones') < claves.indexOf('zz_campo_raro'), true);

// LO QUE MOTIVÓ ESTO: el globo enseñaba ocho campos a mano y 'luz' no era uno
// de ellos, así que la luz de una alcantarilla no se veía en ninguna parte.
t('un campo que el globo descartaba ahora aparece', claves.includes('luz'), true);
t('…con su unidad', filas.find(f => f.clave === 'luz').valor, '1.2 m');

// Las etiquetas del servidor mandan sobre las deducidas.
const conEtiquetas = caracteristicas(PROPS, { luz: 'Luz del vano', nombre_canal: 'Canal' });
t('etiqueta del servidor', conEtiquetas.find(f => f.clave === 'luz').etiqueta, 'Luz del vano');
t('y para los demás, la deducida',
  conEtiquetas.find(f => f.clave === 'progresiva').etiqueta, 'Progresiva');

// Cobertura: cuántos campos vienen sin rellenar.
const cob = cobertura(PROPS);
t('campos contables', cob.total, 9);
t('con dato', cob.conDato, 8);
t('vacíos', cob.vacios, 1);
t('props vacío no revienta', cobertura({}), { total: 0, conDato: 0, vacios: 0 });
t('caracteristicas de nada', caracteristicas(null), []);

t('título por nombre', tituloActivo(PROPS, 'Alcantarilla', 412), 'Alcantarilla Km 4+200');
t('…o por código', tituloActivo({ codigo: 'ALC-07' }, 'Alcantarilla', 412), 'ALC-07');
t('…o por capa y fid', tituloActivo({}, 'Alcantarilla', 412), 'Alcantarilla #412');

// ── Fotos: medidas ─────────────────────────────────────────────────────
t('una foto de teléfono se reduce',
  medidaDestino(4032, 3024), { ancho: 1600, alto: 1200, reducida: true });
t('en vertical, el lado mayor manda',
  medidaDestino(3024, 4032), { ancho: 1200, alto: 1600, reducida: true });
t('NUNCA se agranda', medidaDestino(800, 600), { ancho: 800, alto: 600, reducida: false });
t('justo en el límite no se toca',
  medidaDestino(MAX_LADO, 900), { ancho: MAX_LADO, alto: 900, reducida: false });
t('medidas imposibles', medidaDestino(0, 100), null);

t('un .heic recomprimido deja de serlo', nombreSalida('IMG_0042.HEIC', true), 'IMG_0042.jpg');
t('si no se recomprime, conserva su nombre',
  nombreSalida('IMG_0042.HEIC', false), 'IMG_0042.HEIC');
t('los espacios y acentos no viajan en el nombre',
  nombreSalida('toma 3 – canal ñ.jpg', true), 'toma_3_canal_.jpg');
t('sin nombre', nombreSalida('', true), 'foto.jpg');

// ── Fotos: qué se acepta ───────────────────────────────────────────────
const falso = (nombre, type, size) => ({ name: nombre, type, size });
t('un jpeg entra', motivoRechazo(falso('a.jpg', 'image/jpeg', 2e6)), null);
t('un heic de iPhone entra', motivoRechazo(falso('a.heic', 'image/heic', 3e6)), null);
t('sin tipo, decide la extensión', motivoRechazo(falso('a.JPG', '', 1e6)), null);
t('un pdf no es una foto',
  motivoRechazo(falso('a.pdf', 'application/pdf', 1e5)), 'a.pdf no es una imagen');
t('sin tipo y con extensión rara tampoco',
  motivoRechazo(falso('a.xyz', '', 1e5)), 'a.xyz no parece una imagen');
t('nada', motivoRechazo(null), 'Archivo vacío');
const enorme = motivoRechazo(falso('a.jpg', 'image/jpeg', 30 * 1024 * 1024));
t('30 MB se rechaza antes de intentarlo', enorme, 'a.jpg pesa 30.0 MB; el máximo son 25 MB');

// Fuera del navegador no hay lienzo: devuelve el original en vez de romper.
// Es el mismo camino que sigue un HEIC que Chrome no sabe decodificar, y lo
// que tiene que pasar es que la foto se suba igual, no que se pierda.
const grande = { name: 'a.jpg', type: 'image/jpeg', size: 5e6 };
const r = await prepararFoto(grande);
t('sin lienzo, se sube el original', r.archivo, grande);
t('…y se dice que no se redujo', r.reducida, false);
const pequena = { name: 'b.jpg', type: 'image/jpeg', size: 120 * 1024 };
t('lo que ya es pequeño no se recomprime',
  (await prepararFoto(pequena)).motivo, 'ya era pequeña');

// ── Fotos: dónde están ─────────────────────────────────────────────────
// ESTO es lo que daría imágenes rotas sin aviso.
t('una ruta relativa cuelga del backend, no del front',
  urlFoto({ imagen: '/media/inv/412.jpg' }), `${MEDIA}/media/inv/412.jpg`);
t('…aunque venga sin barra',
  urlFoto({ imagen: 'media/inv/412.jpg' }), `${MEDIA}/media/inv/412.jpg`);
t('una URL completa se respeta',
  urlFoto({ imagen: 'https://cdn.ejemplo.pe/a.jpg' }), 'https://cdn.ejemplo.pe/a.jpg');
t('y un data: también', urlFoto({ imagen: 'data:image/jpeg;base64,xx' }), 'data:image/jpeg;base64,xx');
t('acepta los nombres de campo que puede usar el serializador',
  urlFoto({ imagen_url: '/media/x.jpg' }), `${MEDIA}/media/x.jpg`);
t('sin foto, cadena vacía y no "undefined"', urlFoto({}), '');
t('sin objeto tampoco revienta', urlFoto(null), '');

// ── Fotos: orden ───────────────────────────────────────────────────────
t('las recientes primero',
  ordenarFotos([
    { id: 1, tomada: '2026-03-01' },
    { id: 2, tomada: '2026-09-14' },
    { id: 3, tomada: '2026-07-02' },
  ]).map(f => f.id), [2, 3, 1]);
t('las que no traen fecha van al final',
  ordenarFotos([{ id: 1 }, { id: 2, tomada: '2026-01-01' }]).map(f => f.id), [2, 1]);
t('no modifica el array que recibe', (() => {
  const orig = [{ id: 1, tomada: '2026-01-01' }, { id: 2, tomada: '2026-09-01' }];
  ordenarFotos(orig);
  return orig.map(f => f.id);
})(), [1, 2]);

t('peso en MB', peso(2.4 * 1048576), '2.4 MB');
t('peso en KB', peso(312 * 1024), '312 KB');

console.log(`\n${bien} comprobación(es) en orden${mal ? `, ${mal} MAL` : ''}.`);
process.exit(mal ? 1 : 0);
