import 'package:flutter/material.dart';

import '../../utils/catalogo_capas.dart';

/// El símbolo de una capa, el mismo que sale en el mapa.
///
/// POR QUÉ ES UN WIDGET Y NO TRES COPIAS. Sale en el panel de capas, en el
/// avance de campaña y en los resultados de la búsqueda, y en los tres
/// sitios tiene que ser idéntico al del mapa: para eso sirve un símbolo. En
/// cuanto hay dos dibujos distintos del mismo activo, el de la lista deja de
/// servir para encontrarlo en el mapa, que es lo único que se le pide.
///
/// Las de punto llevan su dibujo; las de línea, una barra; las de polígono,
/// un cuadrado relleno. Un cuadrito de color para todas no distinguía un
/// canal de una caja hidráulica, y cuando lo único que varía entre quince
/// filas es el tono del azul, no varía nada.
class SimboloCapa extends StatelessWidget {
  final Capa? capa;
  final double lado;

  const SimboloCapa({super.key, required this.capa, this.lado = 22});

  @override
  Widget build(BuildContext context) {
    final c = capa;
    if (c == null) {
      // Una capa que el catálogo no conoce: cuadrito gris, sin inventar un
      // símbolo que no significaría nada.
      return Container(
        width: lado * 0.55,
        height: lado * 0.55,
        decoration: BoxDecoration(
          color: const Color(0xFFADB5BD),
          borderRadius: BorderRadius.circular(3),
        ),
      );
    }

    switch (c.tipo) {
      case TipoGeom.punto:
        return Container(
          width: lado,
          height: lado,
          decoration: BoxDecoration(
            color: Colors.white,
            shape: BoxShape.circle,
            border: Border.all(color: c.color, width: 2),
          ),
          child: Icon(iconoDeCapa(c.codigo), size: lado * 0.5, color: c.color),
        );

      case TipoGeom.linea:
        // Una barra del grosor con el que se dibuja en el mapa: así se ve de
        // un vistazo cuál es el canal madre y cuál un sublateral.
        return SizedBox(
          width: lado,
          height: lado,
          child: Center(
            child: Container(
              height: c.grosor.clamp(2.5, 5),
              decoration: BoxDecoration(
                color: c.color,
                borderRadius: BorderRadius.circular(3),
              ),
            ),
          ),
        );

      case TipoGeom.poligono:
        return Container(
          width: lado * 0.8,
          height: lado * 0.8,
          decoration: BoxDecoration(
            color: c.color.withOpacity(0.35),
            borderRadius: BorderRadius.circular(4),
            border: Border.all(color: c.color, width: 1.6),
          ),
        );
    }
  }
}
