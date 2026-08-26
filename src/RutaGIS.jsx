import { useState, useMemo, useCallback } from 'react';
import { Polyline, Marker, Popup } from 'react-leaflet';
import { divIcon } from 'leaflet';

/**
 * Ruteo sobre la red de caminos propia (KMZ de caminos de servicio, vías de
 * acceso, vía auxiliar y red nacional).
 *
 * No usa ningún servicio externo: arma un grafo con los vértices de esas
 * líneas y resuelve el camino más corto con Dijkstra. La ventaja frente a
 * Google/OSM es que los caminos de servicio del canal sí están aquí; la
 * limitación es que solo puede rutear por lo que exista en esas capas.
 *
 * Uso en Mapa.jsx:
 *
 *   const ruta = useRuta([geoCaminosServ, geoViasAcceso, geoViaAuxiliar, geoRedNacional]);
 *
 *   // dentro del <MapContainer>
 *   <CapaRuta ruta={ruta} />
 *
 *   // botón, cuando haya un incidente seleccionado
 *   <button onClick={() => ruta.trazar(miUbicacion, [inc.lat, inc.lng])}>Cómo llegar</button>
 */

const RADIO_TIERRA = 6371000;

// Distancia en metros entre dos [lng, lat].
export function distanciaM(a, b) {
  const [lng1, lat1] = a, [lng2, lat2] = b;
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad, dLng = (lng2 - lng1) * rad;
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * RADIO_TIERRA * Math.asin(Math.sqrt(s));
}

// Todas las líneas de una FeatureCollection, como arreglos de [lng,lat].
function lineasDe(fc) {
  const out = [];
  for (const f of (fc?.features || [])) {
    const g = f.geometry;
    if (!g) continue;
    if (g.type === 'LineString') out.push(g.coordinates);
    else if (g.type === 'MultiLineString') out.push(...g.coordinates);
  }
  return out.filter(l => Array.isArray(l) && l.length >= 2);
}

/**
 * Arma el grafo. Los vértices se ajustan a una rejilla de `tol` metros, así
 * dos caminos que se cruzan sin compartir el vértice exacto quedan unidos
 * (en los KMZ eso pasa casi siempre: los trazos se dibujaron por separado).
 * Subir `tol` conecta más, pero puede unir caminos que en realidad no se tocan.
 */
export function construirGrafo(capas, tol = 12) {
  const gradoLng = tol / 111320;
  const gradoLat = tol / 110540;
  const nodos = new Map();
  const ady = [];

  const idDe = (lng, lat) => {
    const gl = Math.round(lng / gradoLng), gt = Math.round(lat / gradoLat);
    const k = `${gl}|${gt}`;
    let n = nodos.get(k);
    if (!n) {
      n = { id: ady.length, coord: [gl * gradoLng, gt * gradoLat] };
      nodos.set(k, n);
      ady.push([]);
    }
    return n;
  };

  const unir = (n1, n2) => {
    if (n1.id === n2.id) return;
    const m = distanciaM(n1.coord, n2.coord);
    if (!ady[n1.id].some(e => e.a === n2.id)) ady[n1.id].push({ a: n2.id, m });
    if (!ady[n2.id].some(e => e.a === n1.id)) ady[n2.id].push({ a: n1.id, m });
  };

  for (const fc of capas) {
    for (const linea of lineasDe(fc)) {
      let prev = null;
      for (const c of linea) {
        if (!Array.isArray(c) || c.length < 2) continue;
        const n = idDe(c[0], c[1]);
        if (prev) unir(prev, n);
        prev = n;
      }
    }
  }

  const grafo = { nodos: [...nodos.values()].sort((a, b) => a.id - b.id), ady };
  return coserComponentes(grafo);
}

/**
 * Los KMZ se dibujaron por tramos, así que el grafo nace partido en islas.
 * Se cose en DOS pasadas, y el orden importa:
 *
 *  1. Todos los pares de nodos a menos de `puenteCorto` se unen SIEMPRE.
 *     Son cruces y empalmes reales entre un camino y otro. Si aquí solo se
 *     creara un empalme por par de islas, la ruta se vería obligada a rodear
 *     hasta ese único punto en vez de girar en el cruce que tiene al lado.
 *
 *  2. Solo si aún quedan islas sueltas, se tienden puentes de hasta
 *     `puenteMax`, de menor a mayor y uno por par de islas (Kruskal). Esto
 *     salva los huecos de digitalización sin inventar caminos largos.
 */
function coserComponentes(grafo, puenteCorto = 50, puenteMax = 350) {
  const N = grafo.ady.length;
  if (!N) return { ...grafo, componentes: 0, puentes: 0, empalmes: 0 };

  // Union-Find
  const padre = new Int32Array(N).map((_, i) => i);
  const raiz = (x) => { while (padre[x] !== x) { padre[x] = padre[padre[x]]; x = padre[x]; } return x; };
  const unir = (a, b) => { const ra = raiz(a), rb = raiz(b); if (ra === rb) return false; padre[ra] = rb; return true; };
  for (let u = 0; u < N; u++) for (const e of grafo.ady[u]) unir(u, e.a);

  const hayArista = (i, j) => grafo.ady[i].some(e => e.a === j);
  const conectar = (i, j, m, tipo) => {
    if (hayArista(i, j)) return false;
    grafo.ady[i].push({ a: j, m, [tipo]: true });
    grafo.ady[j].push({ a: i, m, [tipo]: true });
    return true;
  };

  // Rejilla espacial: solo se comparan celdas vecinas, no todos contra todos.
  const construirRejilla = (lado) => {
    const celLng = lado / 111320, celLat = lado / 110540;
    const rej = new Map();
    for (let i = 0; i < N; i++) {
      const [lng, lat] = grafo.nodos[i].coord;
      const k = `${Math.floor(lng / celLng)}|${Math.floor(lat / celLat)}`;
      if (!rej.has(k)) rej.set(k, []);
      rej.get(k).push(i);
    }
    return rej;
  };

  const paresCercanos = (lado) => {
    const rej = construirRejilla(lado);
    const pares = [];
    for (const [k, ids] of rej) {
      const [gx, gy] = k.split('|').map(Number);
      const vecinos = [];
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        const v = rej.get(`${gx + dx}|${gy + dy}`);
        if (v) vecinos.push(...v);
      }
      for (const i of ids) for (const j of vecinos) {
        if (j <= i) continue;
        const m = distanciaM(grafo.nodos[i].coord, grafo.nodos[j].coord);
        if (m <= lado) pares.push([m, i, j]);
      }
    }
    return pares;
  };

  // ── Pasada 1: todos los empalmes cortos ──
  let empalmes = 0;
  for (const [m, i, j] of paresCercanos(puenteCorto)) {
    if (conectar(i, j, m, 'empalme')) { empalmes++; unir(i, j); }
  }

  // ── Pasada 2: puentes largos, solo para lo que siga aislado ──
  let puentes = 0;
  const comps = new Set(); for (let i = 0; i < N; i++) comps.add(raiz(i));
  if (comps.size > 1) {
    const candidatos = paresCercanos(puenteMax)
      .filter(([, i, j]) => raiz(i) !== raiz(j))
      .sort((a, b) => a[0] - b[0]);
    for (const [m, i, j] of candidatos) {
      if (raiz(i) === raiz(j)) continue;   // ya quedaron unidas
      if (conectar(i, j, m, 'puente')) { puentes++; unir(i, j); }
    }
  }

  const finales = new Set(); for (let i = 0; i < N; i++) finales.add(raiz(i));
  return { ...grafo, componentes: finales.size, puentes, empalmes };
}

function nodoMasCercano(grafo, punto) {
  let mejor = null, mejorM = Infinity;
  for (const n of grafo.nodos) {
    const m = distanciaM(punto, n.coord);
    if (m < mejorM) { mejorM = m; mejor = n; }
  }
  return { nodo: mejor, metros: mejorM };
}

// Dijkstra con montículo binario.
function dijkstra(grafo, desde, hasta) {
  const N = grafo.ady.length;
  const dist = new Float64Array(N).fill(Infinity);
  const previo = new Int32Array(N).fill(-1);
  const listo = new Uint8Array(N);
  dist[desde] = 0;

  const heap = [[0, desde]];
  const subir = (i) => {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= heap[i][0]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]]; i = p;
    }
  };
  const bajar = (i) => {
    for (;;) {
      const l = 2 * i + 1, r = l + 1;
      let m = i;
      if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
      if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
      if (m === i) break;
      [heap[m], heap[i]] = [heap[i], heap[m]]; i = m;
    }
  };
  const meter = (d, v) => { heap.push([d, v]); subir(heap.length - 1); };
  const sacar = () => {
    const top = heap[0], last = heap.pop();
    if (heap.length) { heap[0] = last; bajar(0); }
    return top;
  };

  while (heap.length) {
    const [d, u] = sacar();
    if (listo[u]) continue;
    listo[u] = 1;
    if (u === hasta) break;
    for (const e of grafo.ady[u]) {
      const nd = d + e.m;
      if (nd < dist[e.a]) { dist[e.a] = nd; previo[e.a] = u; meter(nd, e.a); }
    }
  }

  if (dist[hasta] === Infinity) return null;
  const camino = [];
  for (let v = hasta; v !== -1; v = previo[v]) camino.push(v);
  return { camino: camino.reverse(), metros: dist[hasta] };
}

/** Ruta entre dos [lng,lat]. Devuelve { coords, metros, ... } o { error }. */
export function calcularRuta(grafo, origen, destino, saltoMax = 800) {
  if (!grafo?.nodos?.length) return { error: 'La red de caminos está vacía.' };

  const o = nodoMasCercano(grafo, origen);
  const d = nodoMasCercano(grafo, destino);
  if (o.metros > saltoMax) return { error: `Estás a ${Math.round(o.metros)} m del camino más cercano; demasiado lejos para trazar la ruta.` };
  if (d.metros > saltoMax) return { error: `El incidente está a ${Math.round(d.metros)} m del camino más cercano; demasiado lejos para trazar la ruta.` };

  const r = dijkstra(grafo, o.nodo.id, d.nodo.id);
  if (!r) return { error: 'No hay un camino continuo entre los dos puntos con las capas disponibles.' };

  // Se añaden los tramos de enlace: del punto real al camino, y del camino al destino.
  const coords = [origen, ...r.camino.map(i => grafo.nodos[i].coord), destino];
  return {
    coords,
    metros: r.metros + o.metros + d.metros,
    saltoOrigen: o.metros,
    saltoDestino: d.metros,
  };
}

export const fmtDistancia = (m) =>
  m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`;

// Tiempo estimado a 30 km/h, que es lo razonable en camino de servicio.
export const fmtTiempo = (m, kmh = 30) => {
  const min = Math.round((m / 1000) / kmh * 60);
  if (min < 1) return 'menos de 1 min';
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${min % 60} min`;
};

/* ══════════════════════════════════════════════════════════
   Hook: estado de la ruta
   ══════════════════════════════════════════════════════════ */
export function useRuta(capas) {
  // El grafo se arma una sola vez: las capas KMZ son estáticas.
  const grafo = useMemo(() => construirGrafo(capas), [capas]);
  const [ruta, setRuta] = useState(null);       // { coords, metros, destino }
  const [error, setError] = useState(null);
  const [calculando, setCalculando] = useState(false);

  /** origen y destino en [lat, lng] (como los maneja Leaflet). */
  const trazar = useCallback((origenLatLng, destinoLatLng, etiqueta = '') => {
    setError(null);
    if (!origenLatLng) {
      setError('Primero marca tu ubicación con el botón del GPS.');
      return;
    }
    setCalculando(true);
    // Se difiere un tick para que el spinner alcance a pintarse.
    setTimeout(() => {
      const o = [origenLatLng[1], origenLatLng[0]];
      const d = [destinoLatLng[1], destinoLatLng[0]];
      const r = calcularRuta(grafo, o, d);
      if (r.error) { setError(r.error); setRuta(null); }
      else setRuta({ ...r, etiqueta, destinoLatLng });
      setCalculando(false);
    }, 20);
  }, [grafo]);

  const limpiar = useCallback(() => { setRuta(null); setError(null); }, []);

  return {
    grafo, ruta, error, calculando, trazar, limpiar,
    nodos: grafo.nodos.length,
    componentes: grafo.componentes,   // 1 = red totalmente conectada
    empalmes: grafo.empalmes,         // cruces cortos conectados
    puentes: grafo.puentes,           // huecos largos que hubo que salvar
  };
}

/* ══════════════════════════════════════════════════════════
   Trazado sobre el mapa — va DENTRO del <MapContainer>
   ══════════════════════════════════════════════════════════ */
const iconoDestino = divIcon({
  className: 'icono-vacio',
  html: `<div style="width:14px;height:14px;border-radius:50%;background:#35B6E9;border:3px solid #fff;box-shadow:0 0 10px #35B6E9"></div>`,
  iconSize: [20, 20], iconAnchor: [10, 10],
});

export function CapaRuta({ ruta }) {
  if (!ruta?.ruta?.coords?.length) return null;
  const { coords, metros } = ruta.ruta;
  // Leaflet quiere [lat, lng]; el grafo trabaja en [lng, lat].
  const puntos = coords.map(c => [c[1], c[0]]);
  return (
    <>
      {/* halo oscuro debajo para que la línea se lea sobre el satélite */}
      <Polyline positions={puntos} pathOptions={{ color: '#05233f', weight: 9, opacity: 0.55 }} />
      <Polyline positions={puntos} pathOptions={{ color: '#35B6E9', weight: 4, opacity: 0.95 }}>
        <Popup>
          <div style={{ fontFamily: 'system-ui', fontSize: 12 }}>
            <b>Ruta por caminos de servicio</b><br />
            {fmtDistancia(metros)} · aprox. {fmtTiempo(metros)}
          </div>
        </Popup>
      </Polyline>
      {ruta.ruta.destinoLatLng && <Marker position={ruta.ruta.destinoLatLng} icon={iconoDestino} />}
    </>
  );
}