/// Los dibujos acotados de la ficha de papel.
///
/// El formulario pide «Base (b₁)», «Altura (h₂)», «Talud (Z)». Esas letras
/// no significan nada por sí solas: lo que dice dónde se mide cada una es el
/// croquis que la ficha de inspección lleva impreso al lado de los campos.
/// Sin él, dos inspectores miden cosas distintas y el inventario queda con
/// números que no se pueden comparar.
///
/// Es el mismo catálogo que el visor web (esquemasFicha.js) y las mismas
/// trece láminas, recortadas de los diez formatos de levantamiento en campo.
/// Aquí van dentro de la app y no se piden al servidor: pesan 184 KB en
/// total y se miran justamente donde no hay señal.
class Lamina {
  final String archivo;
  final String titulo;
  final String pie;

  /// Trozos de título de bloque, en minúscula y sin tildes. Si uno aparece
  /// en el título del bloque, la lámina se pinta DENTRO de ese bloque,
  /// encima de los campos que acota. Vacío = lámina de la estructura
  /// entera, va arriba del formulario.
  final List<String> bloques;

  const Lamina(this.archivo, this.titulo, this.pie, [this.bloques = const []]);

  String get ruta => 'assets/croquis/$archivo.webp';
}

const _laminas = <String, Lamina>{
  'canal': Lamina('canal', 'Sección del canal y camino de servicio',
      'Rectangular y trapezoidal: b, B, e, y, h, Z, CS, x.'),
  'toma': Lamina('toma', 'Planta y perfil de la toma',
      'L₁, L₂, L₃, e, b, Ø, h, Z.', ['toma']),
  'toma-compuerta': Lamina('toma-compuerta', 'Compuerta metálica',
      'a, b, H y vástago.', ['compuerta']),
  'toma-retencion': Lamina('toma-retencion', 'Retención',
      'Altura h sobre la sección del canal.', ['retencion']),
  'desarenador': Lamina('desarenador', 'Sección del tanque sedimentador',
      'e, b, c, h, h₁, h₂, h₃.', ['sedimentador', 'tanque']),
  'canoa': Lamina('canoa', 'Planta de la canoa',
      'B₁, B₂, b, Lp, Lt₁, Lt₂, Ls, L.'),
  'canoa-diques': Lamina('canoa-diques', 'Diques de encauzamiento',
      'C, H y talud Z, en roca y en material propio.',
      ['dique', 'encauzamiento']),
  'puente': Lamina('puente', 'Sección y planta del pase',
      'A, B, b, L, l, h, e.'),
  'entrega': Lamina('entrega', 'Planta y perfil de la entrega',
      'L₁, L₂, L₃, B, b, e, h.'),
  'alcantarilla': Lamina('alcantarilla', 'Planta y perfil de la alcantarilla',
      'B₁, B₂, L, Lt₁, Lt₂, h₁, h₂, h₃.'),
  'aliviadero': Lamina('aliviadero', 'Planta y sección del disipador',
      'a, b, c, d, e, f, h, i, j, k.', ['disipador']),
  'sifon': Lamina('sifon', 'Perfil del sifón',
      'L, Lt₁, Lt₂, b, h, Ø y ducto de inspección.'),
  'sublateral': Lamina('sublateral', 'Tubería y camino de servicio',
      'D, P_D, B, CS, x.'),
};

/// Qué láminas lleva cada capa. Una capa que no está aquí no enseña croquis,
/// y eso no es un fallo: esa estructura no tiene ficha con dibujo.
const _porTipo = <String, List<String>>{
  'tomas_l10': ['toma', 'toma-compuerta', 'toma-retencion'],
  'tomas_otros_sectores': ['toma', 'toma-compuerta', 'toma-retencion'],
  'tomas_canal_madre': ['toma', 'toma-compuerta', 'toma-retencion'],
  'entregas': ['entrega'],
  'canoas': ['canoa', 'canoa-diques'],
  'sifon': ['sifon'],
  'alcantarilla': ['alcantarilla'],
  'aliviadero': ['aliviadero'],
  'desarenadores': ['desarenador'],
  'puente_vehicular': ['puente'],
  'laterales': ['canal'],
  'canal_madre': ['canal'],
  'canal_lateral_10': ['canal'],
  'subalterales': ['sublateral'],
  'redes_presurizado': ['sublateral'],
};

const _tildes = 'áéíóúüñ';
const _sinTildes = 'aeiouun';

/// Minúsculas y sin tildes: «Retención» y «retencion» son el mismo bloque.
String normaliza(String t) {
  var s = t.toLowerCase().trim();
  for (var i = 0; i < _tildes.length; i++) {
    s = s.replaceAll(_tildes[i], _sinTildes[i]);
  }
  return s;
}

List<Lamina> laminasDe(String tipo) =>
    [for (final c in _porTipo[tipo] ?? const <String>[]) _laminas[c]!];

/// La lámina que le toca a un bloque del formulario, o null.
///
/// El emparejamiento va por el TÍTULO del bloque y no por un índice, porque
/// los bloques los decide el catálogo del servidor y ahí se pueden renombrar
/// o reordenar. Si un título deja de coincidir, la lámina no desaparece: se
/// cae a la tira de arriba, que es el peor caso aceptable.
Lamina? laminaDeBloque(List<Lamina> laminas, String titulo) {
  final t = normaliza(titulo);
  if (t.isEmpty) return null;
  for (final l in laminas) {
    for (final clave in l.bloques) {
      if (t.contains(clave)) return l;
    }
  }
  return null;
}

/// Las que no encontraron bloque: van arriba del formulario.
List<Lamina> laminasSueltas(List<Lamina> laminas, List<String> titulos) {
  final dentro = <String>{};
  for (final t in titulos) {
    final l = laminaDeBloque(laminas, t);
    if (l != null) dentro.add(l.archivo);
  }
  return [for (final l in laminas) if (!dentro.contains(l.archivo)) l];
}
