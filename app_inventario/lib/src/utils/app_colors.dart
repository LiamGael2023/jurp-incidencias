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

  /// Estado de conservación. Las claves son las del servidor.
  static const estados = <String, Color>{
    'B': Color(0xFF20C997),   // bueno
    'R': Color(0xFFFAB005),   // regular
    'M': Color(0xFFFF6B35),   // malo
    'C': Color(0xFFE03131),   // colapsado
  };

  static const estadoSinDato = Color(0xFF868E96);

  static Color deEstado(String? e) =>
      estados[(e ?? '').toUpperCase()] ?? estadoSinDato;

  static const nombresEstado = <String, String>{
    'B': 'Bueno', 'R': 'Regular', 'M': 'Malo', 'C': 'Colapsado',
  };
}
