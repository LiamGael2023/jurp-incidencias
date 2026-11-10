import 'dart:math' as math;

/// Latitud y longitud → UTM (WGS 84).
///
/// POR QUÉ ESTÁ ESCRITO AQUÍ Y NO SE USA EL PAQUETE `utm`.
/// Esta conversión decide dónde queda clavada una estructura nueva en la
/// base: si se equivoca, el alta aparece a kilómetros y PostGIS la acepta
/// sin protestar, porque el SRID se lo damos nosotros. Son treinta líneas
/// de fórmulas estándar, las mismas que ya usa el visor web
/// (`src/cartografia.js`) y que llevan meses colocando puntos donde deben,
/// y tenerlas aquí permite comprobar que los dos coinciden al metro.
///
/// La prueba está en `herramientas/comparar_utm.py`: compara esta
/// implementación con la del visor sobre los extremos del ámbito de la
/// Junta.

// Parámetros del elipsoide WGS 84 y de la proyección UTM.
const double _a = 6378137; // semieje mayor (m)
const double _e2 = 0.00669437999014; // excentricidad al cuadrado
const double _ep2 = _e2 / (1 - _e2);
const double _k0 = 0.9996; // factor de escala en el meridiano central

/// Zona UTM de una longitud.
int zonaDe(double lng) => ((lng + 180) / 6).floor() + 1;

class PuntoUTM {
  final double este;
  final double norte;
  final int zona;
  final String hemisferio;

  const PuntoUTM(this.este, this.norte, this.zona, this.hemisferio);

  /// El SRID de la zona, que es lo que la API espera dentro del EWKT.
  /// 327xx es el sur y 326xx el norte, en WGS 84.
  int get srid => (hemisferio == 'S' ? 32700 : 32600) + zona;

  /// La geometría tal como la quiere `/activos-nuevos/`.
  ///
  /// EWKT Y NO GRADOS, a propósito: la capa está en UTM 17S y mandar
  /// grados la colocaría a seiscientos kilómetros, en coordenadas que
  /// PostGIS aceptaría sin pestañear porque el SRID lo damos nosotros.
  String get ewkt =>
      'SRID=$srid;POINT(${este.toStringAsFixed(2)} ${norte.toStringAsFixed(2)})';

  @override
  String toString() =>
      '$zona$hemisferio E ${este.round()} N ${norte.round()}';
}

/// `zonaForzada` para cuando todo un dibujo tiene que ir en la misma zona.
/// Virú está sobre el límite entre la 17 y la 18, y si cada punto eligiera
/// la suya, el este se reiniciaría a 500000 a mitad del trabajo.
PuntoUTM latLngAUTM(double lat, double lng, [int? zonaForzada]) {
  final zona = zonaForzada ?? zonaDe(lng);
  final latR = lat * math.pi / 180;
  final lngR = lng * math.pi / 180;
  final lngO = ((zona - 1) * 6 - 180 + 3) * math.pi / 180;

  final sinLat = math.sin(latR);
  final cosLat = math.cos(latR);
  final tanLat = math.tan(latR);

  final n = _a / math.sqrt(1 - _e2 * sinLat * sinLat);
  final t = tanLat * tanLat;
  final c = _ep2 * cosLat * cosLat;
  final x = cosLat * (lngR - lngO);

  const e3 = _e2 * _e2 * _e2;
  final m = _a *
      ((1 - _e2 / 4 - 3 * _e2 * _e2 / 64 - 5 * e3 / 256) * latR -
          (3 * _e2 / 8 + 3 * _e2 * _e2 / 32 + 45 * e3 / 1024) *
              math.sin(2 * latR) +
          (15 * _e2 * _e2 / 256 + 45 * e3 / 1024) * math.sin(4 * latR) -
          (35 * e3 / 3072) * math.sin(6 * latR));

  final este = _k0 *
          n *
          (x +
              (1 - t + c) * math.pow(x, 3) / 6 +
              (5 - 18 * t + t * t + 72 * c - 58 * _ep2) * math.pow(x, 5) / 120) +
      500000;

  var norte = _k0 *
      (m +
          n *
              tanLat *
              (x * x / 2 +
                  (5 - t + 9 * c + 4 * c * c) * math.pow(x, 4) / 24 +
                  (61 - 58 * t + t * t + 600 * c - 330 * _ep2) *
                      math.pow(x, 6) /
                      720));

  // Hemisferio sur: se desplaza el origen para no manejar negativos.
  if (lat < 0) norte += 10000000;

  return PuntoUTM(este, norte.toDouble(), zona, lat < 0 ? 'S' : 'N');
}
