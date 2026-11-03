import 'package:flutter/material.dart';

/// Qué capas hay, cómo se dibujan y en qué orden se listan.
///
/// Es la misma tabla que el visor web (InventarioGIS.jsx), transcrita. Que
/// esté copiada y no venga del servidor es deliberado: son los colores y la
/// agrupación con los que la Junta lee sus propios planos, y un cambio ahí
/// es una decisión de cartografía, no un dato. Lo que SÍ viene del servidor
/// —los totales, las geometrías, qué se evaluó— es todo lo demás.
///
/// Si algún día se añade una capa en el backend, aparece en /capas/ con su
/// total pero no se dibuja hasta que entre aquí. Es a propósito: una capa
/// sin color ni grupo asignado se pintaría gris y en el sitio equivocado.
enum TipoGeom { punto, linea, poligono }

class Capa {
  final String codigo;
  final String label;
  final Color color;
  final TipoGeom tipo;
  final double grosor;
  final bool contexto;   // obra del PECH: referencia, no la evalúa la Junta
  final bool oculta;     // se descarga pero no se dibuja ni se lista

  const Capa(
    this.codigo,
    this.label,
    this.color, {
    this.tipo = TipoGeom.punto,
    this.grosor = 3,
    this.contexto = false,
    this.oculta = false,
  });
}

class GrupoCapas {
  final String titulo;
  final List<Capa> capas;
  final bool contexto;
  const GrupoCapas(this.titulo, this.capas, {this.contexto = false});
}

const _azulToma = Color(0xFF4DABF7);

const List<GrupoCapas> gruposCapas = [
  GrupoCapas('Obras de captación y entrega', [
    Capa('tomas_l10', 'Tomas Lateral 10', _azulToma),
    Capa('tomas_otros_sectores', 'Tomas otros sectores', Color(0xFF74C0FC)),
    Capa('entregas', 'Entregas', Color(0xFF3BC9DB)),
    Capa('laterales', 'Laterales', Color(0xFF22B8CF)),
    Capa('partidor', 'Partidores', Color(0xFF15AABF)),
  ]),
  GrupoCapas('Obras de arte', [
    Capa('canoas', 'Canoas', Color(0xFF4C6EF5)),
    Capa('sifon', 'Sifones', _azulToma),
    Capa('alcantarilla', 'Alcantarillas', Color(0xFF9775FA)),
    Capa('aliviadero', 'Aliviaderos', Color(0xFFB197FC)),
    Capa('desarenadores', 'Desarenadores', Color(0xFF22B8CF)),
    Capa('camara_rompepresion', 'Cámaras rompepresión', Color(0xFF3BC9DB)),
    Capa('cajas_hidraulicas', 'Cajas hidráulicas', Color(0xFF66D9E8)),
    Capa('pases_de_tuberias', 'Pases de tuberías', Color(0xFF74C0FC)),
    Capa('reservorios', 'Reservorios', Color(0xFF1C7ED6)),
  ]),
  GrupoCapas('Cruces', [
    Capa('puente_vehicular', 'Puentes vehiculares', Color(0xFFADB5BD)),
    Capa('puente_peatonal', 'Puentes peatonales', Color(0xFFCED4DA)),
  ]),
  GrupoCapas('Red y territorio', [
    Capa('canal_madre', 'Canal madre', Color(0xFF1C7ED6),
        tipo: TipoGeom.linea, grosor: 4),
    Capa('canal_lateral_10', 'Canal Lateral 10', _azulToma,
        tipo: TipoGeom.linea, grosor: 3),
    Capa('subalterales', 'Subalterales', Color(0xFFA5D8FF),
        tipo: TipoGeom.linea, grosor: 2),
    Capa('redes_presurizado', 'Redes presurizado', Color(0xFF74C0FC),
        tipo: TipoGeom.linea, grosor: 2),
    Capa('sectores_pech', 'Sectores PECH', Color(0xFFAEC14A),
        tipo: TipoGeom.poligono),
    // Se descarga porque de ahí sale quién tiene licencia, pero no se
    // dibuja: comprobado contra el servidor, sus polígonos SON los lotes,
    // idénticos hasta los 10 cm. Pintarla era pintar los lotes dos veces.
    Capa('areas_licencia', 'Áreas con licencia', Color(0xFFC0D259),
        tipo: TipoGeom.poligono, oculta: true),
    Capa('lotes', 'Lotes', Color(0xFFD2E070), tipo: TipoGeom.poligono),
  ]),
  GrupoCapas('Chavimochic — obras del PECH', [
    Capa('bocatomas', 'Bocatomas', Color(0xFF7A93AB), contexto: true),
    Capa('estaciones_control', 'Estaciones de control', Color(0xFF8EA9C2),
        contexto: true),
    Capa('rapidas', 'Rápidas', Color(0xFF6B8CA8), contexto: true),
    // La obra es del PECH pero el inventario lo levanta y lo firma la Junta
    // como operador (formato B-1.C del ANA), así que SÍ entra en campaña.
    Capa('tomas_canal_madre', 'Tomas Canal Madre', Color(0xFFA1BCD1)),
    Capa('garitas_jurp', 'Garitas JURP', Color(0xFF15AABF), contexto: true),
    Capa('garitas_otros', 'Garitas de terceros', Color(0xFF94A3B8),
        contexto: true),
  ], contexto: true),
  GrupoCapas('Chavimochic — trazados y vías', [
    Capa('canal_madre_kmz', 'Canal Madre', Color(0xFF6B8CA8),
        tipo: TipoGeom.poligono, contexto: true),
    Capa('canal_lateral_10_kmz', 'Lateral 10', Color(0xFF86A5BD),
        tipo: TipoGeom.poligono, contexto: true),
    Capa('redes_presurizado_kmz', 'Redes presurizado', Color(0xFFA1BCD1),
        tipo: TipoGeom.poligono, contexto: true),
    Capa('evacuador_kmz', 'Evacuadores', Color(0xFFBCD3E4),
        tipo: TipoGeom.poligono, contexto: true),
    Capa('caminos_servicio_kmz', 'Caminos de servicio', Color(0xFF868E96),
        tipo: TipoGeom.poligono, contexto: true),
    Capa('vias_acceso_kmz', 'Vías de acceso', Color(0xFFADB5BD),
        tipo: TipoGeom.poligono, contexto: true),
    Capa('via_auxiliar_kmz', 'Vía auxiliar', Color(0xFF9AA3AB),
        tipo: TipoGeom.poligono, contexto: true),
    // La red vial nacional no entra en la app. Es la capa más pesada del
    // catálogo y la menos útil en campo: la Panamericana ya está dibujada
    // en la ortofoto de fondo, con su número de ruta y todo, así que lo
    // único que aportaba era tiempo de descarga y trazos grises encima de
    // una carretera que ya se veía. En el visor web sigue estando, que ahí
    // ni la espera ni el dato pesan igual.
  ], contexto: true),
];

/* ── Símbolo de cada capa ────────────────────────────────────────────────
   Sobre una ortofoto, veinte capas de puntos en veinte tonos de azul son
   veinte manchas iguales: el color solo no distingue una toma de una caja
   hidráulica. El dibujo dentro del punto sí, y encima se reconoce de lejos
   sin abrir la leyenda.

   No son los iconos oficiales del inventario -esos son PNG y viven en el
   visor web-, son los de Material: pesan cero y se ven nítidos a cualquier
   tamaño. Lo que importa es que dos capas vecinas no compartan dibujo. */
const _iconos = <String, IconData>{
  'tomas_l10': Icons.input,
  'tomas_otros_sectores': Icons.input,
  'tomas_canal_madre': Icons.input,
  'entregas': Icons.output,
  'laterales': Icons.water,
  'partidor': Icons.call_split,
  'canoas': Icons.waves,
  'sifon': Icons.swap_calls,
  'alcantarilla': Icons.hdr_strong,
  'aliviadero': Icons.water_damage,
  'desarenadores': Icons.filter_alt,
  'camara_rompepresion': Icons.compress,
  'cajas_hidraulicas': Icons.crop_square,
  'pases_de_tuberias': Icons.horizontal_rule,
  'reservorios': Icons.water_drop,
  'puente_vehicular': Icons.directions_car,
  'puente_peatonal': Icons.directions_walk,
  'bocatomas': Icons.login,
  'estaciones_control': Icons.sensors,
  'rapidas': Icons.trending_down,
  'garitas_jurp': Icons.security,
  'garitas_otros': Icons.shield_outlined,
};

IconData iconoDeCapa(String codigo) => _iconos[codigo] ?? Icons.place;

/// Todas las capas en una lista, sin las que no se dibujan.
final List<Capa> todasLasCapas = [
  for (final g in gruposCapas)
    for (final c in g.capas)
      if (!c.oculta) c,
];

Capa? capaPorCodigo(String codigo) {
  for (final c in todasLasCapas) {
    if (c.codigo == codigo) return c;
  }
  return null;
}
