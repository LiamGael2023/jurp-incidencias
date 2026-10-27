/*
 * HYDROMETRIX: de dónde salen los números y cómo se leen.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * LO QUE AQUI SE DA POR SABIDO, porque está medido contra el servidor:
 *
 *   · Las rutas cuelgan de /api/operadores/ —sin v1—, y ya agregan del lado
 *     del servidor: la web no rehace ninguna cuenta.
 *   · Los caudales se guardan en LITROS POR SEGUNDO. m³/h es ×3,6.
 *   · El estado de la poza viene guardado («Muy bajo», «Bajo», «En su
 *     nivel», «Excedencia»); no se deduce de umbrales aquí.
 *   · Las lecturas son horarias: 3998 filas en `registro_operadores`.
 *
 * LO QUE NO ESTA MEDIDO es el NOMBRE EXACTO DE CADA CAMPO de las respuestas
 * y de los filtros. Por eso este fichero no asume uno: pregunta por una
 * lista de nombres plausibles y se queda con el primero que venga. Y cuando
 * no reconoce nada, NO PINTA UN GRAFICO VACIO —que se lee como «no hay
 * datos» y es mentira—: devuelve la respuesta cruda para que la pantalla la
 * enseñe y el nombre bueno se añada aquí en una línea.
 *
 * ESA TOLERANCIA ES UN ANDAMIO, NO UN DISEÑO. En cuanto se vea una
 * respuesta de verdad, cada lista de candidatos se queda con el nombre que
 * sea y las demás sobran. Mientras tanto evita lo único que no tiene
 * arreglo: que alguien lea un número equivocado y se lo crea.
 * ──────────────────────────────────────────────────────────────────────────
 */

/* ── Unidades ──────────────────────────────────────────────────────────── */

/** Un litro por segundo son 3,6 metros cúbicos por hora. */
export const LPS_A_M3H = 3.6;

export const UNIDADES = {
  'm3/h': { etiqueta: 'm3/h', factor: LPS_A_M3H },
  'l/s': { etiqueta: 'l/s', factor: 1 },
};

/**
 * Pasa un caudal guardado (l/s) a la unidad que se está mostrando.
 *
 * Se aplica SOLO a caudales. Los volúmenes ya vienen en m³ y las turbideces
 * en NTU: multiplicarlos por 3,6 daría un número que sigue pareciendo
 * razonable, que es la peor clase de error —nadie lo nota hasta que lo
 * compara con el papel—.
 */
export function convierteCaudal(valor, unidad) {
  const n = numero(valor);
  if (n === null) return null;
  const u = UNIDADES[unidad] || UNIDADES['m3/h'];
  return n * u.factor;
}

/** A número, o null. `''`, `null` y `'—'` no son cero. */
export function numero(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const n = parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/* ── Leer campos sin saber cómo se llaman ──────────────────────────────── */

/**
 * El primer candidato que exista y no sea nulo.
 *
 * Compara sin distinguir mayúsculas ni guiones bajos, así que `caudalSalida`
 * encuentra `caudal_salida` y al revés: el backend es Django y el día que
 * alguien ponga un serializador en camelCase esto no se entera.
 */
export function campo(obj, candidatos) {
  if (!obj || typeof obj !== 'object') return undefined;
  const plano = {};
  for (const k of Object.keys(obj)) plano[llanura(k)] = obj[k];
  for (const c of candidatos) {
    const v = plano[llanura(c)];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

const llanura = (s) => String(s).toLowerCase().replace(/[\s_-]/g, '');

/** Sin tildes y en minúsculas, para comparar rótulos escritos a mano. */
export function sinTildes(s) {
  return String(s == null ? '' : s)
    .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/**
 * La lista que trae una respuesta, venga como venga.
 *
 * DRF pagina con `{count, results}`; sin paginar devuelve el array pelado; y
 * algunas vistas a medida envuelven en `data`. Las tres se ven en este mismo
 * servidor, así que no hay una forma «la buena» que esperar.
 */
export function listaDe(resp) {
  if (Array.isArray(resp)) return resp;
  if (!resp || typeof resp !== 'object') return [];
  for (const k of ['results', 'data', 'items', 'lista', 'rows']) {
    if (Array.isArray(resp[k])) return resp[k];
  }
  return [];
}

/* ── Los nombres que se prueban ────────────────────────────────────────── */

const N = {
  idToma: ['id', 'toma_id', 'pk', 'codigo_toma'],
  nombreToma: ['nombre', 'toma', 'name', 'codigo', 'label', 'titulo',
    'descripcion', 'toma_nombre', 'nombre_toma'],

  estado: ['estado_poza', 'estado', 'status', 'nivel_estado', 'estado_nivel'],
  caudalSalida: ['caudal_salida', 'caudal_de_salida', 'q_salida', 'salida',
    'caudal_out', 'caudal'],
  caudalIngreso: ['caudal_ingreso', 'caudal_de_ingreso', 'q_ingreso',
    'ingreso', 'caudal_in'],
  desnivel: ['desnivel_sedimentador', 'desnivel', 'desnivel_poza',
    'nivel_poza', 'nivel'],
  turbidez: ['turbidez_salida', 'turbidez_de_salida', 'turbidez', 'ntu',
    'turbidez_out'],
  ultima: ['ultima_lectura', 'ultima', 'fecha_hora', 'last_reading',
    'fecha_lectura', 'hora_lectura', 'fecha', 'actualizado'],

  // Series
  categorias: ['categorias', 'categories', 'labels', 'etiquetas', 'x',
    'horas', 'ejes'],
  series: ['series', 'datasets', 'data', 'resultados'],
  nombreSerie: ['name', 'nombre', 'toma', 'label', 'serie', 'titulo'],
  datosSerie: ['data', 'datos', 'valores', 'values', 'puntos', 'points', 'y'],

  // Un punto suelto, cuando la serie viene como lista de objetos
  x: ['x', 'hora', 'etiqueta', 'label', 'fecha', 'categoria', 'dia', 'mes'],
  y: ['y', 'valor', 'value', 'caudal', 'volumen', 'total', 'cantidad',
    'turbidez', 'dosaje', 'ppm'],

  volumen: ['volumen', 'volume', 'total', 'valor', 'm3', 'metros_cubicos'],
  mes: ['mes', 'month', 'numero_mes', 'mes_numero'],
};

/* ── Normalizadores ────────────────────────────────────────────────────── */

/**
 * Cada normalizador devuelve la MISMA forma:
 *
 *     { ok, datos, crudo, visto }
 *
 * `ok:false` no es un error de red: es «la respuesta llegó y no la entiendo».
 * `visto` son las claves que traía el primer elemento, que es exactamente lo
 * que hay que mirar para arreglarlo. La pantalla lo enseña tal cual.
 */
const fallo = (crudo, visto) => ({ ok: false, datos: null, crudo, visto });
const bien = (datos, crudo) => ({ ok: true, datos, crudo, visto: null });

const clavesDe = (x) => {
  const l = listaDe(x);
  if (l.length && l[0] && typeof l[0] === 'object') return Object.keys(l[0]);
  if (x && typeof x === 'object') return Object.keys(x);
  return [];
};

/** El catálogo de tomas: `[{ id, nombre }]`. */
export function normalizaTomas(resp) {
  const lista = listaDe(resp);
  if (!lista.length) return fallo(resp, clavesDe(resp));
  const datos = lista.map((o, i) => {
    if (typeof o === 'string' || typeof o === 'number') {
      return { id: o, nombre: String(o) };
    }
    const id = campo(o, N.idToma);
    const nombre = campo(o, N.nombreToma);
    return {
      id: id !== undefined ? id : i,
      nombre: nombre !== undefined ? String(nombre) : `Toma ${id ?? i}`,
    };
  });
  return bien(datos, resp);
}

/** Las tarjetas del resumen. */
export function normalizaResumen(resp) {
  const lista = listaDe(resp);
  if (!lista.length) return fallo(resp, clavesDe(resp));
  const datos = lista.map((o, i) => ({
    id: campo(o, N.idToma) ?? i,
    toma: String(campo(o, N.nombreToma) ?? `Toma ${i + 1}`),
    estadoTexto: campo(o, N.estado) ?? null,
    estado: clasificaEstado(campo(o, N.estado)),
    caudalSalida: numero(campo(o, N.caudalSalida)),
    desnivel: numero(campo(o, N.desnivel)),
    turbidez: numero(campo(o, N.turbidez)),
    ultima: campo(o, N.ultima) ?? null,
  }));
  /* Si no se reconoció NINGUN caudal en NINGUNA tarjeta, los nombres no son
   * los que creemos y lo que se pintaría son siete tarjetas con guiones. Eso
   * es indistinguible de «hoy no hubo lecturas», así que se declara fallo y
   * la pantalla enseña la respuesta en vez de inventarse una lectura. */
  if (datos.every((d) => d.caudalSalida === null && d.turbidez === null)) {
    return fallo(resp, clavesDe(resp));
  }
  return bien(datos, resp);
}

/**
 * Pone las categorías en su orden, SOLO cuando se sabe cuál es.
 *
 * Cuando las series vienen por separado, el eje se arma con la unión de las
 * horas de todas. Si la 10.2 trae 01:00 y 03:00 y la 10.4 trae 01:00 y
 * 02:00, la unión en orden de llegada sale 01:00, 03:00, 02:00 y el gráfico
 * dibuja las horas desordenadas: una línea que sube, baja y vuelve a subir
 * sin que el agua haya hecho nada de eso.
 *
 * Se ordena solo si TODAS las etiquetas son del mismo tipo reconocible.
 * «Lunes, Martes» y «Enero, Febrero» ya vienen en su orden y alfabetizarlas
 * las estropearía —Abril delante de Enero—, así que esas se dejan como
 * llegaron.
 */
export function ordenaCategorias(cats) {
  if (cats.length < 2) return cats;

  const hora = /^(\d{1,2}):(\d{2})$/;
  if (cats.every((c) => hora.test(c))) {
    return [...cats].sort((a, b) => {
      const [, ha, ma] = a.match(hora);
      const [, hb, mb] = b.match(hora);
      return (Number(ha) * 60 + Number(ma)) - (Number(hb) * 60 + Number(mb));
    });
  }
  // Las fechas ISO se ordenan bien como texto; por eso se guardan así.
  if (cats.every((c) => /^\d{4}-\d{2}-\d{2}/.test(c))) return [...cats].sort();
  if (cats.every((c) => /^-?\d+(\.\d+)?$/.test(c))) {
    return [...cats].sort((a, b) => Number(a) - Number(b));
  }
  return cats;
}

/**
 * Una serie temporal, en cualquiera de las tres formas que se ven por aquí:
 *
 *   a) { labels: [...], series: [{ name, data: [...] }] }
 *   b) [{ toma: '10.2', puntos: [{ hora, valor }, ...] }, ...]
 *   c) [{ toma: '10.2', hora: '01:00', valor: 130 }, ...]   ← filas planas
 *
 * Sale siempre `{ categorias, series: [{ nombre, datos }] }`, con los datos
 * ya alineados a las categorías: un hueco es `null` y no se une con una
 * recta —dibujar una recta entre dos lecturas separadas por cuatro horas es
 * enseñar un caudal que no pasó—.
 */
export function normalizaSeries(resp) {
  if (!resp) return fallo(resp, []);

  // (a) el servidor ya manda categorías y series
  const cats = campo(resp, N.categorias);
  const ser = campo(resp, N.series);
  if (Array.isArray(cats) && Array.isArray(ser) && ser.length
      && typeof ser[0] === 'object' && campo(ser[0], N.datosSerie)) {
    const categorias = cats.map(String);
    const series = ser.map((s, i) => ({
      nombre: String(campo(s, N.nombreSerie) ?? `Serie ${i + 1}`),
      datos: (campo(s, N.datosSerie) || []).map(numero),
    }));
    return bien({ categorias, series }, resp);
  }

  const lista = listaDe(resp);
  if (!lista.length) return fallo(resp, clavesDe(resp));

  // (b) cada elemento es una serie con sus puntos dentro
  const puntos0 = campo(lista[0], N.datosSerie);
  if (Array.isArray(puntos0)) {
    const categorias = [];
    const porSerie = lista.map((s, i) => {
      const nombre = String(campo(s, N.nombreSerie) ?? `Serie ${i + 1}`);
      const pares = (campo(s, N.datosSerie) || []).map((p) => {
        if (p && typeof p === 'object') {
          return [String(campo(p, N.x) ?? ''), numero(campo(p, N.y) ?? p)];
        }
        return [null, numero(p)];
      });
      for (const [x] of pares) {
        if (x !== null && x !== '' && !categorias.includes(x)) categorias.push(x);
      }
      return { nombre, pares };
    });
    // Sin etiquetas propias, los puntos van en el orden en que llegaron.
    if (!categorias.length) {
      const largo = Math.max(...porSerie.map((s) => s.pares.length), 0);
      return bien({
        categorias: Array.from({ length: largo }, (_, i) => String(i)),
        series: porSerie.map((s) => ({
          nombre: s.nombre, datos: s.pares.map(([, y]) => y),
        })),
      }, resp);
    }
    const enOrden = ordenaCategorias(categorias);
    return bien({
      categorias: enOrden,
      series: porSerie.map((s) => {
        const mapa = new Map(s.pares);
        return {
          nombre: s.nombre,
          datos: enOrden.map((c) => (mapa.has(c) ? mapa.get(c) : null)),
        };
      }),
    }, resp);
  }

  // (c) filas planas: toma + etiqueta + valor
  const nombre0 = campo(lista[0], N.nombreSerie);
  const x0 = campo(lista[0], N.x);
  const y0 = campo(lista[0], N.y);
  if (nombre0 !== undefined && x0 !== undefined && y0 !== undefined) {
    const categorias = [];
    const mapa = new Map();
    for (const f of lista) {
      const n = String(campo(f, N.nombreSerie));
      const x = String(campo(f, N.x));
      const y = numero(campo(f, N.y));
      if (!categorias.includes(x)) categorias.push(x);
      if (!mapa.has(n)) mapa.set(n, new Map());
      mapa.get(n).set(x, y);
    }
    const enOrden = ordenaCategorias(categorias);
    return bien({
      categorias: enOrden,
      series: [...mapa.entries()].map(([nombre, pares]) => ({
        nombre,
        datos: enOrden.map((c) => (pares.has(c) ? pares.get(c) : null)),
      })),
    }, resp);
  }

  return fallo(resp, clavesDe(resp));
}

/**
 * Volumen por tomas o por mes: una sola serie de barras.
 *
 * `etiquetas` permite forzar el eje —los doce meses del año salen siempre,
 * tenga datos o no, porque un gráfico mensual que enseña solo julio y agosto
 * parece que el año empezó en julio—.
 */
export function normalizaVolumen(resp, etiquetasFijas = null) {
  const lista = listaDe(resp);
  if (!lista.length) return fallo(resp, clavesDe(resp));

  const pares = lista.map((o, i) => {
    if (typeof o === 'number') return [String(i + 1), o];
    const x = campo(o, [...N.nombreSerie, ...N.x, ...N.mes]);
    const y = campo(o, N.volumen) ?? campo(o, N.y);
    return [String(x ?? i + 1), numero(y)];
  });
  if (pares.every(([, y]) => y === null)) return fallo(resp, clavesDe(resp));

  if (etiquetasFijas) {
    const mapa = new Map(pares.map(([x, y]) => [sinTildes(x), y]));
    return bien({
      categorias: etiquetasFijas,
      datos: etiquetasFijas.map((e, i) => {
        const porNombre = mapa.get(sinTildes(e));
        if (porNombre !== undefined) return porNombre;
        // También por número de mes: 1..12 y 0..11.
        const porNumero = mapa.get(String(i + 1)) ?? mapa.get(String(i));
        return porNumero !== undefined ? porNumero : null;
      }),
    }, resp);
  }
  return bien({
    categorias: pares.map(([x]) => x),
    datos: pares.map(([, y]) => y),
  }, resp);
}

/* ── El estado de la poza ──────────────────────────────────────────────── */

/**
 * El texto guardado, a una de las cuatro casillas conocidas.
 *
 * Lo que no se reconoce se queda en 'desconocido' y la tarjeta enseña el
 * texto tal cual. Meterlo a la fuerza en «En su nivel» pintaría de verde un
 * estado que nadie ha dicho que lo sea.
 */
export function clasificaEstado(texto) {
  const t = sinTildes(texto);
  if (!t) return 'desconocido';
  if (t.includes('excedencia') || t.includes('exceso')) return 'excedencia';
  if (t.includes('muy bajo') || t.includes('muybajo') || t.includes('critico')) {
    return 'muy-bajo';
  }
  if (t.includes('bajo')) return 'bajo';
  if (t.includes('nivel') || t.includes('normal') || t.includes('ok')) {
    return 'normal';
  }
  return 'desconocido';
}

/* ── Colores ───────────────────────────────────────────────────────────── */

/*
 * La paleta pasa el validador del método de visualización: banda de
 * luminosidad, suelo de croma, separación bajo protanopía y deuteranopía, y
 * suelo de visión normal. El primer color es el azul de HYDROMETRIX, que es
 * el del rail: el módulo y sus gráficos hablan el mismo idioma.
 *
 * Tres de ellos quedan por debajo de 3:1 contra el blanco. Por eso cada
 * gráfico lleva leyenda con su marca de color, valores en el tooltip y
 * descarga a Excel: el color nunca es lo único que distingue una serie.
 */
export const PALETA = [
  '#1268C3', // azul HYDROMETRIX
  '#eb6834', // naranja
  '#1baf7a', // agua
  '#eda100', // amarillo
  '#e87ba4', // magenta
  '#008300', // verde
  '#6250d6', // violeta
  '#e34948', // rojo
];

/*
 * Los colores de estado son fijos y no se mezclan con los de las series.
 *
 * «En su nivel» va sobre BLANCO a propósito, aunque su insignia sea verde.
 * Teñir de verde las cinco tomas normales deja la pantalla entera en color
 * y las dos que hay que mirar —la muy baja y la baja— dejan de destacar:
 * si todo resalta, nada resalta. Lo normal es el fondo; lo que se sale, la
 * señal.
 */
export const COLOR_ESTADO = {
  normal: { punto: '#0ca30c', fondo: '#fff', borde: '#bbf7d0', texto: '#15803d' },
  bajo: { punto: '#fab219', fondo: '#fffbeb', borde: '#fde68a', texto: '#92400e' },
  'muy-bajo': { punto: '#d03b3b', fondo: '#fef2f2', borde: '#fecaca', texto: '#b91c1c' },
  excedencia: { punto: '#ec835a', fondo: '#fff7ed', borde: '#fed7aa', texto: '#c2410c' },
  desconocido: { punto: '#626976', fondo: '#f8fafc', borde: '#e2e8f0', texto: '#475569' },
};

export const ROTULO_ESTADO = {
  normal: 'En su nivel',
  bajo: 'Bajo',
  'muy-bajo': 'Muy bajo',
  excedencia: 'Excedencia',
  desconocido: '—',
};

/**
 * El color de una toma, atado a la toma y no a su puesto en el gráfico.
 *
 * Si el color saliera del orden de las series, quitar una toma del filtro
 * repintaría todas las demás: el mismo número cambiaría de color entre dos
 * pantallas y la lectura se volvería imposible. Por eso el índice se saca
 * del CATALOGO COMPLETO de tomas, que no depende de lo que esté filtrado.
 */
export function colorDeToma(nombre, catalogo) {
  const i = (catalogo || []).findIndex((t) => sinTildes(t) === sinTildes(nombre));
  if (i < 0) {
    // Fuera del catálogo —el canal fijo, por ejemplo— un color estable
    // sacado del propio nombre, para que no baile entre recargas.
    let h = 0;
    for (const c of String(nombre)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return PALETA[h % PALETA.length];
  }
  return PALETA[i % PALETA.length];
}

/* ── Los filtros, y cómo se mandan ─────────────────────────────────────── */

export const PERIODOS = [
  { clave: 'dia', titulo: 'Día', ingles: 'day' },
  { clave: 'semana', titulo: 'Semana', ingles: 'week' },
  { clave: 'mes', titulo: 'Mes', ingles: 'month' },
];

export const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

/**
 * Los parámetros de la consulta, en castellano y en inglés a la vez.
 *
 * POR QUE LOS DOS. No está medido si la vista lee `periodo` o `period`. Son
 * claves distintas, así que mandar las dos no se pisa: la que el servidor no
 * conozca la ignora —Django lee de `request.GET` por nombre—, y la que sí,
 * funciona. Cuando se vea una respuesta de verdad se deja una sola.
 */
export function parametros({ tomas, periodo, fecha, anio, toma, metrica } = {}) {
  const p = new URLSearchParams();
  if (metrica) {
    /* Qué se quiere ver. `series/` sirve caudales, turbideces y dosajes, así
     * que sin esto la ruta no sabe cuál de los tres. */
    p.set('metrica', metrica);
    p.set('metric', metrica);
    p.set('campo', metrica);
  }
  if (Array.isArray(tomas) && tomas.length) {
    const v = tomas.join(',');
    p.set('tomas', v);
    p.set('toma_ids', v);
    p.set('tomas[]', v);
  }
  if (toma !== undefined && toma !== null && toma !== '') {
    p.set('toma', String(toma));
    p.set('toma_id', String(toma));
  }
  if (periodo) {
    const def = PERIODOS.find((x) => x.clave === periodo);
    p.set('periodo', periodo);
    p.set('period', def ? def.ingles : periodo);
  }
  if (fecha) {
    p.set('fecha', fecha);
    p.set('date', fecha);
  }
  if (anio) {
    p.set('anio', String(anio));
    p.set('year', String(anio));
  }
  return p;
}

/* ── La llamada ────────────────────────────────────────────────────────── */

/**
 * El prefijo. `/api/` lo reescribe Vercel hacia el servidor de PLUVIRA, que
 * es donde viven estas lecturas. Llamar al dominio a pelo lo bloquea CORS, y
 * además saldría por http con el token encima.
 */
export const BASE_HYDRO = '/api/operadores';

/**
 * Qué significa cada fallo, dicho de manera que lleve al arreglo.
 *
 * EL 403 DE DRF SON DOS COSAS DISTINTAS, y confundirlas cuesta horas:
 *
 *   · «No tienes permiso para realizar esta acción» → el token SE ACEPTO y
 *     el usuario entró; lo que falla es la clase de permiso de la vista.
 *     Se arregla en el servidor, dándole el permiso a esa cuenta.
 *
 *   · «No se proveyeron las credenciales» → el token NO se miró siquiera.
 *     Pasa cuando la vista solo lleva SessionAuthentication, que es lo
 *     normal en una vista escrita para las páginas del propio sistema: la
 *     cabecera `Authorization: Token ...` se ignora y DRF responde 403 en
 *     vez de 401 porque no hay esquema que pedir. No es un problema de
 *     permisos y no se arregla tocando grupos: hay que añadir
 *     TokenAuthentication a esas vistas.
 *
 * Por eso el mensaje del servidor se enseña SIEMPRE, pegado al nuestro.
 */
export function explica(estado, detalle, ruta, codigo) {
  const d = sinTildes(detalle);
  /* El código, cuando viene, manda sobre el texto: es lo único que el
   * servidor promete no cambiar de redacción. Estas rutas contestan
   * `{"codigo":"not_authenticated", "detalle":"Falta autenticación..."}`,
   * que no es la forma de DRF y por eso hay que mirarla aparte. */
  const sinCredenciales = sinTildes(codigo) === 'not_authenticated'
    || d.includes('no se proveyeron') || d.includes('falta autenticacion')
    || d.includes('not provided') || d.includes('no fueron proporcionadas');
  /* Un token que el servidor mira y rechaza SI es sesión caducada, y eso se
   * arregla volviendo a entrar. Mezclarlo con lo anterior mandaría a tocar
   * el servidor por algo que se resuelve con un login. */
  const tokenMalo = d.includes('invalid') || d.includes('invalido')
    || d.includes('caduc') || d.includes('expir');

  if (estado === 401 && tokenMalo) {
    return 'La sesión caducó o el token ya no vale. Vuelve a entrar.';
  }
  if (estado === 401 || (estado === 403 && sinCredenciales)) {
    return 'Esta ruta no está aceptando el token de la sesión. '
      + 'Si acabas de entrar, lo más probable es que solo admita sesión de '
      + 'navegador y haya que añadirle autenticación por token.';
  }
  if (estado === 403) {
    return 'Tu cuenta entró, pero esta ruta no te deja ver sus datos.';
  }
  if (estado === 404) {
    return `La ruta /api/operadores/${ruta} no existe en el servidor.`;
  }
  if (estado >= 500) {
    return `El servidor falló al preparar estos datos (${estado}).`;
  }
  return `El servidor respondió ${estado}.`;
}

/**
 * Pide una ruta y devuelve `{ ok, estado, cuerpo, detalle, error }`.
 *
 * No lanza: una pantalla con seis paneles no puede caerse entera porque uno
 * de los seis responda mal. Cada panel enseña lo suyo.
 */
export async function pide(ruta, params) {
  const token = localStorage.getItem('userToken');
  if (!token) {
    return { ok: false, estado: 0, cuerpo: null, error: 'Sesión no iniciada. Vuelve a entrar.' };
  }
  const cola = params && [...params.keys()].length ? `?${params}` : '';
  let r;
  try {
    r = await fetch(`${BASE_HYDRO}/${ruta}${cola}`, {
      headers: { Authorization: `Token ${token}`, Accept: 'application/json' },
    });
  } catch {
    return { ok: false, estado: 0, cuerpo: null, error: 'No se pudo conectar con el servidor.' };
  }

  const texto = await r.text();
  let cuerpo = null;
  try { cuerpo = JSON.parse(texto); } catch { cuerpo = null; }

  if (!r.ok) {
    /* El mensaje del servidor vale más que uno nuestro: si la vista exige
     * `date` y le mandamos `fecha`, el 400 lo dice con el nombre bueno. */
    /* `detalle` y `codigo` son de este servidor; `detail` es lo que pone
     * DRF de fábrica. Se prueban los dos: leyendo solo el de DRF, el
     * mensaje se quedaba sin el del servidor y acababa volcando el JSON
     * entero en la pantalla. */
    const detalle = (cuerpo && (cuerpo.detalle || cuerpo.detail
        || cuerpo.mensaje || cuerpo.error))
      || (texto || '').slice(0, 200);
    const codigo = cuerpo && (cuerpo.codigo || cuerpo.code);
    return {
      ok: false,
      estado: r.status,
      cuerpo,
      detalle,
      codigo,
      error: `${explica(r.status, detalle, ruta, codigo)}${
        detalle ? ` · El servidor dice: «${detalle}»` : ''}`,
    };
  }
  if (cuerpo === null) {
    /* 200 con HTML dentro es el síntoma clásico de haber pegado contra la
     * web en vez de contra la API: decirlo ahorra media hora. */
    return {
      ok: false,
      estado: 200,
      cuerpo: null,
      error: 'El servidor respondió, pero no con JSON. Puede que la ruta no sea la de la API.',
    };
  }
  return { ok: true, estado: 200, cuerpo, error: null };
}

/** La fecha de hoy en el formato que esperan los `<input type="date">`. */
export function hoy() {
  const d = new Date();
  const dd = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${dd(d.getMonth() + 1)}-${dd(d.getDate())}`;
}

/** `2026-10-26` → `26/10/2026`. Para rótulos, no para mandar al servidor. */
export function fechaLegible(iso) {
  if (!iso) return '';
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return String(iso);
  return `${m[3]}/${m[2]}/${m[1]}`;
}

/** Una fecha+hora del servidor, en algo que se lee de un vistazo. */
export function momentoLegible(valor) {
  if (!valor) return '—';
  const d = new Date(valor);
  if (Number.isNaN(d.getTime())) return String(valor);
  const dd = (n) => String(n).padStart(2, '0');
  return `${dd(d.getDate())}/${dd(d.getMonth() + 1)}/${d.getFullYear()} `
    + `${dd(d.getHours())}:${dd(d.getMinutes())}`;
}

/** Un número con dos decimales y separador de miles, o una raya. */
export function cifra(v, decimales = 2) {
  const n = numero(v);
  if (n === null) return '—';
  return n.toLocaleString('es-PE', {
    minimumFractionDigits: decimales, maximumFractionDigits: decimales,
  });
}
