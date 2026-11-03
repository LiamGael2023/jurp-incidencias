import 'package:flutter/material.dart';

/// Los colores de INVENTARIO, los mismos del visor web.
///
/// El verde es el del logo del módulo; el azul, el de JURP. Los cuatro
/// estados de conservación son los que pinta el mapa web, y tienen que ser
/// los mismos aquí: un inspector que ve naranja en el teléfono y naranja en
/// la pantalla de la oficina está viendo el mismo dato. Cambiarlos "porque
/// en móvil se ve mejor" rompe eso en silencio.
class AppColors {
  static const verde = Color(0xFF0CA678);      // marca INVENTARIO
  static const verdeOscuro = Color(0xFF087F5B);
  static const azul = Color(0xFF1268C3);       // JURP
  static const tinta = Color(0xFF0B2A5B);
  static const gris = Color(0xFF5B7590);
  static const fondo = Color(0xFFF5F8FC);
  static const borde = Color(0xFFDDE8F3);

  /// Estado de conservación, con los códigos del formato del ANA.
  ///
  /// SON EXACTAMENTE LOS DEL VISOR WEB. No se retocan «porque en el teléfono
  /// se ve mejor»: el inspector mira el mapa en el celular y el jefe el
  /// mismo mapa en la oficina, y si un naranja aquí es un rojo allá, la
  /// conversación que sigue es sobre los colores y no sobre la estructura.
  static const estados = <String, Color>{
    'B': Color(0xFF2F9E44),   // bueno
    'R': Color(0xFFF59F00),   // regular
    'M': Color(0xFFE8590C),   // malo
    'C': Color(0xFFC92A2A),   // colapsado
    '-': Color(0xFF868E96),   // no aplica
  };

  static const estadoSinDato = Color(0xFF868E96);

  /// Los colores de un racimo, según cuántos agrupa. Los mismos tres de
  /// leaflet.markercluster, que es lo que se ve en la web.
  static const racimoChico = Color(0xFF6ECC39);
  static const racimoMedio = Color(0xFFF0C20C);
  static const racimoGrande = Color(0xFFF18017);

  static Color deRacimo(int n) => n < 10
      ? racimoChico
      : n < 100
          ? racimoMedio
          : racimoGrande;

  // ── Cristal oscuro ────────────────────────────────────────────────────
  // Es el material del visor web: paneles translúcidos sobre la ortofoto.
  // Sobre satélite un panel blanco deslumbra al sol y además tapa el mapa;
  // el cristal oscuro deja ver lo que hay debajo y se lee en la calle.
  static const cristal = Color(0xE60D1B2E);
  static const cristalBorde = Color(0x1FFFFFFF);
  static const cristalTexto = Color(0xFFE8F0F8);
  static const cristalSuave = Color(0xFF9FB6CC);

  // ── Sombras ───────────────────────────────────────────────────────────
  // Literales ARGB y no withOpacity: así son `const` y el widget no se
  // reconstruye por una sombra.
  static const sombra = Color(0x26000000);
  static const sombraFuerte = Color(0x40000000);

  static Color deEstado(String? e) =>
      estados[(e ?? '').toUpperCase()] ?? estadoSinDato;

  static const nombresEstado = <String, String>{
    'B': 'Bueno', 'R': 'Regular', 'M': 'Malo', 'C': 'Colapsado',
    '-': 'No aplica',
  };

  /// Los cuatro colores con que se pintan los sectores, los del visor web.
  ///
  /// Son cuatro y no veinte a propósito: con muchos tonos, dos sectores
  /// vecinos acaban en verdes parecidos y la línea entre ellos deja de
  /// verse, que es justo para lo que sirve el color aquí.
  static const sectores = <Color>[
    Color(0xFF2A78D6),   // azul
    Color(0xFFEB6834),   // naranja
    Color(0xFF1BAF7A),   // aqua
    Color(0xFFEDA100),   // amarillo
  ];
}
