import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

import 'app_colors.dart';

/// El tema.
///
/// Toma dos cosas de sitios distintos, a propósito:
///
///   · De PLUVIRA, los ACABADOS —Poppins, tarjetas blancas flotantes con
///     esquinas de 14-16 px y sombra suave, avisos flotantes—. Es la familia
///     visual de las apps de la Junta y una app que se sale de ella parece
///     de otro proveedor.
///   · Del visor web, el MATERIAL del mapa: paneles de cristal oscuro sobre
///     la ortofoto. Sobre satélite un panel blanco deslumbra al sol y tapa
///     justo lo que uno quiere ver.
///
/// Todo lo que se toca mide 48 px o más y el texto no baja de 14. No es
/// gusto: esta app se usa de pie, al sol y a veces con guantes.
class AppTheme {
  /// Radio de las tarjetas. Uno solo para toda la app: mezclar 8, 12 y 20 se
  /// nota aunque nadie sepa decir por qué.
  static const double radio = 16;
  static const double radioChico = 12;

  static const List<BoxShadow> sombraTarjeta = [
    BoxShadow(color: AppColors.sombra, blurRadius: 14, offset: Offset(0, 4)),
  ];
  static const List<BoxShadow> sombraFlotante = [
    BoxShadow(
        color: AppColors.sombraFuerte, blurRadius: 18, offset: Offset(0, 6)),
  ];

  /// Decoración de una tarjeta blanca.
  static BoxDecoration get tarjeta => BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(radio),
        border: Border.all(color: AppColors.borde),
        boxShadow: sombraTarjeta,
      );

  /// Decoración de un panel de cristal, para lo que flota sobre el mapa.
  static BoxDecoration get cristal => BoxDecoration(
        color: AppColors.cristal,
        borderRadius: BorderRadius.circular(radio),
        border: Border.all(color: AppColors.cristalBorde),
        boxShadow: sombraFlotante,
      );

  static ThemeData get claro {
    final base = ThemeData.light(useMaterial3: true);

    // Poppins, la de PLUVIRA. Se descarga una vez y queda en caché; si el
    // teléfono está sin señal la primera vez, Flutter cae a la tipografía
    // del sistema y la app funciona igual: no es motivo para pesar 2 MB más
    // empaquetando la fuente.
    final texto = GoogleFonts.poppinsTextTheme(base.textTheme);

    return base.copyWith(
      colorScheme: ColorScheme.fromSeed(
        seedColor: AppColors.verde,
        primary: AppColors.verde,
        secondary: AppColors.azul,
        error: const Color(0xFFE03131),
      ),
      scaffoldBackgroundColor: AppColors.fondo,
      textTheme: texto,

      appBarTheme: AppBarTheme(
        backgroundColor: AppColors.verde,
        foregroundColor: Colors.white,
        elevation: 0,
        centerTitle: false,
        titleTextStyle: texto.titleMedium?.copyWith(
          color: Colors.white,
          fontSize: 17,
          fontWeight: FontWeight.w700,
        ),
      ),

      // Flotantes y con margen: un aviso pegado al borde inferior queda
      // debajo del botón de guardar y no se lee.
      snackBarTheme: const SnackBarThemeData(
        behavior: SnackBarBehavior.floating,
        insetPadding: EdgeInsets.all(14),
      ),

      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: Colors.white,
        contentPadding:
            const EdgeInsets.symmetric(horizontal: 14, vertical: 15),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(radioChico),
          borderSide: const BorderSide(color: AppColors.borde),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(radioChico),
          borderSide: const BorderSide(color: AppColors.borde),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(radioChico),
          borderSide: const BorderSide(color: AppColors.verde, width: 2),
        ),
        labelStyle: const TextStyle(
            color: AppColors.tinta, fontWeight: FontWeight.w600, fontSize: 15),
        floatingLabelStyle: const TextStyle(
            color: AppColors.verdeOscuro, fontWeight: FontWeight.w700),
      ),

      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: AppColors.verde,
          foregroundColor: Colors.white,
          minimumSize: const Size.fromHeight(52),
          elevation: 2,
          shadowColor: AppColors.sombra,
          textStyle: const TextStyle(
              fontSize: 15.5, fontWeight: FontWeight.w700, letterSpacing: 0.3),
          shape:
              RoundedRectangleBorder(borderRadius: BorderRadius.circular(radioChico)),
        ),
      ),

      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: AppColors.azul,
          minimumSize: const Size.fromHeight(48),
          side: const BorderSide(color: AppColors.borde),
          textStyle:
              const TextStyle(fontSize: 14.5, fontWeight: FontWeight.w600),
          shape:
              RoundedRectangleBorder(borderRadius: BorderRadius.circular(radioChico)),
        ),
      ),

      // El botón segmentado se deja con su estilo de serie: su tema se
      // configura con WidgetStateProperty, que hasta hace poco se llamaba
      // MaterialStateProperty, y no merece la pena que el tema entero no
      // compile según la versión de Flutter que tenga cada equipo.
      listTileTheme: const ListTileThemeData(minVerticalPadding: 10),
      dividerTheme: const DividerThemeData(color: AppColors.borde, space: 1),
    );
  }
}
