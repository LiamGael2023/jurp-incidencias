import 'package:flutter/material.dart';
import 'app_colors.dart';

/// Tema claro y con todo grande.
///
/// No es gusto: esta app se usa al sol, de pie, con una mano y a veces con
/// guantes. Un tema oscuro se vuelve un espejo al mediodía en el desierto, y
/// los controles de 32 px de un escritorio se fallan al pulsar. De ahí el
/// mínimo de 48 px de alto en lo que se toca y el texto de 15-16 px.
class AppTheme {
  static ThemeData get claro {
    final base = ThemeData.light(useMaterial3: true);
    return base.copyWith(
      colorScheme: ColorScheme.fromSeed(
        seedColor: AppColors.verde,
        primary: AppColors.verde,
        secondary: AppColors.azul,
      ),
      scaffoldBackgroundColor: AppColors.fondo,
      appBarTheme: const AppBarTheme(
        backgroundColor: AppColors.verde,
        foregroundColor: Colors.white,
        elevation: 0,
        centerTitle: false,
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: Colors.white,
        contentPadding:
            const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(10),
          borderSide: const BorderSide(color: AppColors.borde),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(10),
          borderSide: const BorderSide(color: AppColors.borde),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(10),
          borderSide: const BorderSide(color: AppColors.verde, width: 2),
        ),
        labelStyle: const TextStyle(
            color: AppColors.tinta, fontWeight: FontWeight.w600, fontSize: 15),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: AppColors.verde,
          foregroundColor: Colors.white,
          minimumSize: const Size.fromHeight(50),
          textStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
          shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(10)),
        ),
      ),
      // Las tarjetas se estilan donde se usan y no aquí: el tipo del tema
      // de Card cambió de nombre entre versiones de Flutter (CardTheme →
      // CardThemeData) y no vale la pena que el tema entero no compile por
      // un borde redondeado.
      listTileTheme: const ListTileThemeData(minVerticalPadding: 10),
      dividerTheme: const DividerThemeData(color: AppColors.borde, space: 1),
    );
  }
}
