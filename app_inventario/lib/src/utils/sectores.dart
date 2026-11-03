import 'package:flutter/material.dart';
import 'package:latlong2/latlong.dart';

import '../models/modelos.dart';
import 'app_colors.dart';

/* ══════════════════════════════════════════════════════════════════════════
   Sectores: cómo se llaman y qué cae dentro de cada uno.

   Es la traducción de sectores.js y de los tests de cartografia.js del visor
   web. Se porta y no se pide al servidor porque son dos cosas de dibujo y de
   lectura, no datos: qué columna rotula mejor una capa y si un punto cae
   dentro de un polígono.
   ══════════════════════════════════════════════════════════════════════════ */

/* ── Qué campo rotula ──────────────────────────────────────────────────────

   EL PROBLEMA REAL: la capa de sectores trae un campo `ambito` que vale
   «PECH» en los cinco polígonos, y otro con el nombre de verdad. Coger el
   primero que suene a nombre escribía PECH cinco veces en el mapa —cinco
   rótulos diciendo lo mismo, que es no rotular pero ocupando sitio—.

   Lo que distingue a un sector de otro no se adivina del nombre de la
   columna: se cuenta. Gana el campo con más valores distintos; la lista de
   nombres probables queda solo para desempatar. Y si ninguno distingue, no
   se rotula: es más honesto un sector sin nombre que cinco iguales. */

const _noRotulan = {
  'fid', 'id', 'pk', 'gid', 'objectid', 'geom', 'geometry', 'the_geom',
  'shape_length', 'shape_area', 'st_length', 'st_area', 'ambito',
};

const _preferidos = [
  'nombre', 'sector', 'nom_sector', 'nombre_sector', 'sector_nom', 'nom',
  'descripcion', 'codigo',
];

String _texto(dynamic v) {
  if (v == null) return '';
  final s = '$v'.trim();
  final b = s.toLowerCase();
  return (b == 'none' || b == 'null') ? '' : s;
}

/// Qué campo rotula mejor este conjunto de polígonos, o null si ninguno.
///
/// Gana el que más valores distintos tiene. A igualdad, el que suene a
/// nombre; y a igualdad de eso, el más corto, que es el que cabe escrito
/// sobre el mapa.
String? campoRotulo(List<Activo> activos) {
  if (activos.isEmpty) return null;

  final distintos = <String, Set<String>>{};
  final largo = <String, int>{};

  for (final a in activos) {
    a.props.forEach((k, v) {
      if (_noRotulan.contains(k)) return;
      final s = _texto(v);
      if (s.isEmpty || s.length > 60) return;   // un párrafo no es un rótulo
      distintos.putIfAbsent(k, () => <String>{}).add(s);
      largo[k] = (largo[k] ?? 0) + s.length;
    });
  }

  String? mejor;
  var mejorDistintos = 0, mejorPref = _preferidos.length;
  var mejorMedio = double.infinity;

  distintos.forEach((k, vals) {
    // Con un solo valor distinto no rotula: es justo el caso «PECH».
    if (vals.length < 2) return;
    final pref = _preferidos.indexOf(k);
    final p = pref < 0 ? _preferidos.length : pref;
    final medio = (largo[k] ?? 0) / activos.length;

    final gana = mejor == null ||
        vals.length > mejorDistintos ||
        (vals.length == mejorDistintos && p < mejorPref) ||
        (vals.length == mejorDistintos && p == mejorPref && medio < mejorMedio);

    if (gana) {
      mejor = k;
      mejorDistintos = vals.length;
      mejorPref = p;
      mejorMedio = medio;
    }
  });

  return mejor;
}

/// El nombre de un polígono según el campo elegido para toda la capa.
String nombreRasgo(Activo a, String? campo) =>
    campo == null ? '' : _texto(a.props[campo]);

/* ── Geometría ───────────────────────────────────────────────────────────── */

/// Caja envolvente, para descartar rápido antes de hacer cuentas.
class Caja {
  final double oeste, este, sur, norte;
  const Caja(this.oeste, this.este, this.sur, this.norte);

  bool contiene(LatLng p) =>
      p.longitude >= oeste &&
      p.longitude <= este &&
      p.latitude >= sur &&
      p.latitude <= norte;
}

Caja? cajaDe(List<List<LatLng>> anillos) {
  var oeste = double.infinity, este = -double.infinity;
  var sur = double.infinity, norte = -double.infinity;
  var hay = false;
  for (final anillo in anillos) {
    for (final p in anillo) {
      hay = true;
      if (p.longitude < oeste) oeste = p.longitude;
      if (p.longitude > este) este = p.longitude;
      if (p.latitude < sur) sur = p.latitude;
      if (p.latitude > norte) norte = p.latitude;
    }
  }
  return hay ? Caja(oeste, este, sur, norte) : null;
}

/// ¿Cae el punto dentro de estos anillos?
///
/// Lanza un rayo hacia el este y cuenta cruces: impar, dentro; par, fuera.
/// Es el algoritmo de toda la vida y aquí basta, porque los sectores son
/// polígonos de riego de pocos kilómetros y a esa escala la curvatura de la
/// Tierra no cambia de qué lado del borde cae un punto.
///
/// El primer anillo es el contorno y los siguientes son huecos: un punto en
/// un hueco está fuera.
bool puntoEnAnillos(LatLng punto, List<List<LatLng>> anillos) {
  var dentro = false;
  for (var a = 0; a < anillos.length; a++) {
    final anillo = anillos[a];
    var cruza = false;
    for (var i = 0, j = anillo.length - 1; i < anillo.length; j = i++) {
      final xi = anillo[i].longitude, yi = anillo[i].latitude;
      final xj = anillo[j].longitude, yj = anillo[j].latitude;
      // El rayo cruza este lado si el lado atraviesa la latitud del punto y
      // el corte queda al este. El `!=` evita contar dos veces un vértice.
      if ((yi > punto.latitude) != (yj > punto.latitude) &&
          punto.longitude <
              (xj - xi) * (punto.latitude - yi) / (yj - yi) + xi) {
        cruza = !cruza;
      }
    }
    if (a == 0) {
      dentro = cruza;
    } else if (cruza) {
      dentro = false;
    }
  }
  return dentro;
}

/* ── Un sector ───────────────────────────────────────────────────────────── */

class Sector {
  final String nombre;
  final Color color;
  final List<List<List<LatLng>>> partes;   // partes → anillos
  final Caja? caja;

  Sector({
    required this.nombre,
    required this.color,
    required this.partes,
  }) : caja = cajaDe([for (final p in partes) ...p]);

  bool contiene(LatLng punto) {
    if (caja != null && !caja!.contiene(punto)) return false;
    for (final anillos in partes) {
      if (puntoEnAnillos(punto, anillos)) return true;
    }
    return false;
  }
}

/* ── El filtro ───────────────────────────────────────────────────────────── */

/// Decide qué se enseña cuando hay sectores apagados.
///
/// UN TRAMO NO ES UN PUNTO. Un canal de ocho kilómetros entra y sale de
/// varios sectores, así que mirarle un solo vértice —el primero— lo metía
/// entero en el sector donde empieza y lo escondía en todos los demás. Se
/// mira una muestra de vértices repartidos: si alguno cae en un sector
/// encendido, el tramo se enseña.
///
/// Veinticuatro vértices y no todos: una capa de redes tiene cientos de
/// miles y probarlos todos contra cinco polígonos congela el teléfono sin
/// cambiar el resultado.
class FiltroSectores {
  final List<Sector> zonas;
  final Map<String, Set<String>> _cache = {};

  FiltroSectores(this.zonas);

  static const int _tope = 24;

  List<LatLng> _muestra(Activo a) {
    if (a.lineas.isEmpty) {
      return a.punto == null ? const [] : [a.punto!];
    }
    final todos = <LatLng>[for (final l in a.lineas) ...l];
    if (todos.length <= _tope) return todos;
    final paso = todos.length / _tope;
    return [
      for (var i = 0; i < _tope; i++) todos[(i * paso).floor()],
    ];
  }

  Set<String> sectoresDe(Activo a) {
    final llave = '${a.tipo}:${a.fid}';
    final guardado = _cache[llave];
    if (guardado != null) return guardado;

    final s = <String>{};
    for (final p in _muestra(a)) {
      for (final z in zonas) {
        if (s.contains(z.nombre)) continue;
        if (z.contiene(p)) s.add(z.nombre);
      }
    }
    _cache[llave] = s;
    return s;
  }

  /// ¿Se enseña este activo con estos sectores encendidos?
  ///
  /// Lo que no cae en NINGÚN sector se esconde mientras haya filtro. Es lo
  /// coherente —algo fuera de todos los sectores tampoco está en el que
  /// pediste— pero se esconde en silencio, así que el panel dice cuántos
  /// sectores hay encendidos en vez de dejar que alguien eche de menos media
  /// capa sin saber por qué.
  bool pasa(Activo a, Set<String> encendidos) {
    final s = sectoresDe(a);
    if (s.isEmpty) return false;
    for (final n in s) {
      if (encendidos.contains(n)) return true;
    }
    return false;
  }
}

/// Construye los sectores a partir de los polígonos ya descargados.
///
/// Los colores son los de la paleta del visor, en orden: con un solo verde
/// para todos eran una mancha continua y no se veía dónde acababa uno y
/// empezaba el siguiente.
List<Sector> sectoresDeActivos(List<Activo> activos) {
  final campo = campoRotulo(activos);
  final out = <Sector>[];
  for (var i = 0; i < activos.length; i++) {
    final a = activos[i];
    if (a.partes.isEmpty) continue;
    final nombre = nombreRasgo(a, campo);
    out.add(Sector(
      nombre: nombre.isEmpty ? 'Sector ${i + 1}' : nombre,
      color: AppColors.sectores[i % AppColors.sectores.length],
      partes: a.partes,
    ));
  }
  return out;
}
