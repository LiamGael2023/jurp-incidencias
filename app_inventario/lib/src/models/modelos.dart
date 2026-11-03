import 'package:latlong2/latlong.dart';

/// Los objetos que viajan entre el servidor y la pantalla.
///
/// Todos los `fromJson` son tolerantes a propósito: leen con `?? valor` y
/// convierten con `toString()` o `num.tryParse` en vez de castear. El
/// backend es Django y un mismo campo llega como número o como texto según
/// por dónde salga (un DecimalField serializa a string, un FloatField no).
/// Un cast duro aquí no da un dato malo: da una pantalla en blanco en el
/// cerro, que es mucho peor que un cero.

int _entero(dynamic v, [int porDefecto = 0]) {
  if (v is int) return v;
  if (v is num) return v.toInt();
  return int.tryParse('$v') ?? porDefecto;
}

double? _decimal(dynamic v) {
  if (v == null) return null;
  if (v is num) return v.toDouble();
  return double.tryParse('$v'.replaceAll(',', '.'));
}

bool _bool(dynamic v) =>
    v == true || v == 1 || '$v'.toLowerCase() == 'true';

String _texto(dynamic v) => v == null ? '' : '$v';

/// Una campaña de inventario. La vigente es la que está «en_proceso».
class Campania {
  final int id;
  final int anio;
  final String estado;

  const Campania({required this.id, required this.anio, required this.estado});

  factory Campania.desdeJson(Map<String, dynamic> j) => Campania(
        id: _entero(j['id']),
        anio: _entero(j['anio']),
        estado: _texto(j['estado']),
      );

  bool get vigente => estado == 'en_proceso';
}

/// Cuántos activos tiene una capa, y cómo se reparten entre la Junta y el
/// PECH. Sirve para el número que acompaña a cada capa en el panel.
class TotalCapa {
  final String codigo;
  final int total;
  final int jurp;
  final int pech;

  const TotalCapa(this.codigo, this.total, this.jurp, this.pech);

  factory TotalCapa.desdeJson(Map<String, dynamic> j) => TotalCapa(
        _texto(j['codigo']),
        _entero(j['total']),
        _entero(j['jurp']),
        _entero(j['pech']),
      );
}

/// Una opción de un campo de tipo lista.
class OpcionCampo {
  final String codigo;
  final String etiqueta;
  const OpcionCampo(this.codigo, this.etiqueta);

  factory OpcionCampo.desdeJson(Map<String, dynamic> j) =>
      OpcionCampo(_texto(j['codigo']), _texto(j['etiqueta']));
}

/// Un campo del formulario de evaluación, tal como lo define el servidor.
///
/// EL FORMULARIO NO ESTÁ ESCRITO EN LA APP. Lo devuelve
/// /campos-evaluables/?tipo_activo=…, con sus opciones ya resueltas, igual
/// que en el visor web. Añadir un campo en la base lo hace aparecer en el
/// teléfono sin publicar una versión nueva en la tienda —que es la
/// diferencia entre un cambio de una tarde y uno de dos semanas.
class CampoEvaluable {
  final String campo;
  final String etiqueta;      // «Compuerta · Ancho (a)»
  final String tipoDato;      // texto | numero | entero | opcion | booleano
  final bool obligatorio;
  final int orden;
  final List<OpcionCampo> opciones;

  const CampoEvaluable({
    required this.campo,
    required this.etiqueta,
    required this.tipoDato,
    required this.obligatorio,
    required this.orden,
    required this.opciones,
  });

  factory CampoEvaluable.desdeJson(Map<String, dynamic> j) => CampoEvaluable(
        campo: _texto(j['campo']),
        etiqueta: _texto(j['etiqueta']),
        tipoDato: _texto(j['tipo_dato']),
        obligatorio: _bool(j['obligatorio']),
        orden: _entero(j['orden']),
        opciones: [
          for (final o in (j['opciones'] as List? ?? const []))
            OpcionCampo.desdeJson(Map<String, dynamic>.from(o as Map))
        ],
      );

  /// La ficha de papel va por bloques (Ingreso, Compuerta, Salida…) y el
  /// catálogo los trae en la etiqueta, antes del separador ' · '. Sin
  /// separador, el campo va al bloque general.
  String get bloque {
    final i = etiqueta.indexOf(' · ');
    return i > 0 ? etiqueta.substring(0, i) : '';
  }

  /// La etiqueta sin el nombre del bloque delante, que ya está en la
  /// cabecera y repetirlo en cada fila come la mitad del ancho del teléfono.
  String get corta {
    final i = etiqueta.indexOf(' · ');
    return i > 0 ? etiqueta.substring(i + 3) : etiqueta;
  }

  bool get esNumero => tipoDato == 'numero' || tipoDato == 'entero';
}

/// Una evaluación ya guardada (o pendiente de subir).
class Evaluacion {
  final int? id;
  final String tipoActivo;
  final int activoFid;
  final Map<String, dynamic> valores;
  final String? estadoCons;
  final String? condicion;
  final String? evaluador;
  final String? observaciones;
  final bool requiereMant;
  final String? prioridad;

  const Evaluacion({
    this.id,
    required this.tipoActivo,
    required this.activoFid,
    required this.valores,
    this.estadoCons,
    this.condicion,
    this.evaluador,
    this.observaciones,
    this.requiereMant = false,
    this.prioridad,
  });

  String get llave => '$tipoActivo:$activoFid';

  factory Evaluacion.desdeJson(Map<String, dynamic> j) => Evaluacion(
        id: j['id'] == null ? null : _entero(j['id']),
        tipoActivo: _texto(j['tipo_activo']),
        activoFid: _entero(j['activo_fid']),
        valores: Map<String, dynamic>.from(
            (j['valores'] as Map?) ?? const <String, dynamic>{}),
        estadoCons: j['estado_cons'] == null ? null : _texto(j['estado_cons']),
        condicion: j['condicion'] == null ? null : _texto(j['condicion']),
        evaluador: j['evaluador'] == null ? null : _texto(j['evaluador']),
        observaciones:
            j['observaciones'] == null ? null : _texto(j['observaciones']),
        requiereMant: _bool(j['requiere_mant']),
        prioridad: j['prioridad'] == null ? null : _texto(j['prioridad']),
      );

  Map<String, dynamic> aJson() => {
        'tipo_activo': tipoActivo,
        'activo_fid': activoFid,
        'valores': valores,
        'estado_cons': estadoCons,
        'condicion': condicion,
        'evaluador': evaluador,
        'observaciones': observaciones,
        'requiere_mant': requiereMant,
        'prioridad': prioridad,
      };
}

/// Un activo del inventario, sacado de una «feature» del GeoJSON.
///
/// Guarda TODAS las propiedades y no un puñado elegido a mano: para una toma
/// pueden bastar ocho campos, pero en una alcantarilla lo que el inspector
/// necesita ver —la luz, el diámetro, el número de hojas— es otro, y
/// descartarlo al leer lo hace invisible sin que nadie se entere.
class Activo {
  final String tipo;          // código de la capa
  final int fid;
  final Map<String, dynamic> props;
  final LatLng? punto;        // centro, para los de punto y para centrar
  final List<List<LatLng>> lineas;   // líneas y anillos de polígono

  /// Solo para polígonos: los anillos agrupados por parte, con el contorno
  /// primero y los huecos después.
  ///
  /// `lineas` sirve para DIBUJAR y por eso los lleva todos aplanados; para
  /// preguntar «¿cae este punto dentro?» hace falta saber qué anillo es
  /// contorno y cuál es hueco, porque un punto en un hueco está fuera. Son
  /// las mismas listas, no copias: no ocupa el doble.
  final List<List<List<LatLng>>> partes;

  const Activo({
    required this.tipo,
    required this.fid,
    required this.props,
    this.punto,
    this.lineas = const [],
    this.partes = const [],
  });

  String get nombre {
    for (final c in ['nombre', 'codigo', 'denominacion']) {
      final v = props[c];
      if (v != null && '$v'.trim().isNotEmpty && '$v' != 'None') return '$v';
    }
    return '#$fid';
  }

  String get ambito => _texto(props['ambito']);
  bool get esPech => ambito == 'PECH';
}

/// Una fila del índice de búsqueda.
///
/// El índice es una lista ligera de TODAS las estructuras —unas dos mil
/// quinientas— con lo justo para encontrarlas y volar hasta ellas. Se pide
/// una sola vez y pesa poco, que es lo que permite buscar sin tener las
/// treinta y siete capas descargadas: si hubiera que cargarlas todas para
/// poder buscar, buscar sería lo último que uno haría.
class ItemIndice {
  final String tipo;
  final int fid;
  final String nombre;
  final String canal;
  final String progresiva;
  final double lat;
  final double lng;

  // No es `const`: la clase lleva un campo `late final` calculado, y eso y
  // un constructor constante no pueden convivir.
  ItemIndice({
    required this.tipo,
    required this.fid,
    required this.nombre,
    required this.canal,
    required this.progresiva,
    required this.lat,
    required this.lng,
  });

  factory ItemIndice.desdeJson(Map<String, dynamic> j) => ItemIndice(
        tipo: _texto(j['tipo']),
        fid: _entero(j['fid']),
        nombre: _texto(j['nombre']),
        canal: _texto(j['canal']),
        progresiva: _texto(j['progresiva']),
        lat: _decimal(j['lat']) ?? 0,
        lng: _decimal(j['lng']) ?? 0,
      );

  Map<String, dynamic> aJson() => {
        'tipo': tipo, 'fid': fid, 'nombre': nombre, 'canal': canal,
        'progresiva': progresiva, 'lat': lat, 'lng': lng,
      };

  bool get ubicado => lat != 0 || lng != 0;

  /// Todo lo buscable de esta fila, junto y ya normalizado. Se calcula una
  /// vez al construir y no en cada tecla: con dos mil quinientas filas y una
  /// búsqueda por pulsación, normalizar al vuelo se nota en el dedo.
  late final String buscable =
      _sinTildes('$nombre $canal $progresiva $tipo');
}

const _conTilde = 'áéíóúüñÁÉÍÓÚÜÑ';
const _sinTilde = 'aeiouunAEIOUUN';

String _sinTildes(String t) {
  var s = t.toLowerCase();
  for (var i = 0; i < _conTilde.length; i++) {
    s = s.replaceAll(_conTilde[i], _sinTilde[i].toLowerCase());
  }
  return s;
}

/// Minúsculas y sin tildes, para que «cámara» encuentre «camara».
String normalizaBusqueda(String t) => _sinTildes(t.trim());

/// Una foto de un activo.
class Foto {
  final int id;
  final String url;
  final String descripcion;

  const Foto(this.id, this.url, this.descripcion);

  factory Foto.desdeJson(Map<String, dynamic> j, String base) {
    var u = _texto(j['imagen'] ?? j['url'] ?? j['archivo']);
    if (u.isNotEmpty && !u.startsWith('http')) {
      u = u.startsWith('/') ? '$base$u' : '$base/$u';
    }
    return Foto(_entero(j['id']), u, _texto(j['descripcion']));
  }
}

/// Una fila del avance de campaña, por tipo de activo.
class AvanceCapa {
  final String tipo;
  /// El nombre bonito, tal como lo manda el servidor.
  final String nombre;
  final int total;
  final int evaluados;
  final int criticos;

  const AvanceCapa({
    required this.tipo,
    required this.nombre,
    required this.total,
    required this.evaluados,
    required this.criticos,
  });

  /// El campo es `tipo`, no `tipo_activo`.
  ///
  /// Leerlo con el nombre equivocado no daba un error: daba una lista de
  /// filas con su cuadrito de color, su «0/29» y el nombre en blanco. Un
  /// dato que falta en silencio es peor que uno que revienta, porque parece
  /// un problema de diseño y se busca donde no es. Se aceptan los dos
  /// nombres por si el backend cambia de opinión.
  factory AvanceCapa.desdeJson(Map<String, dynamic> j) => AvanceCapa(
        tipo: _texto(j['tipo'] ?? j['tipo_activo']),
        nombre: _texto(j['nombre']),
        total: _entero(j['total']),
        evaluados: _entero(j['evaluados']),
        criticos: _entero(j['criticos']),
      );

  int get pendientes => total - evaluados;
  double get porcentaje => total == 0 ? 0 : evaluados / total * 100;
}

/// Un formato oficial del ANA que el servidor genera y la app descarga.
class Formato {
  final String clave;
  final String titulo;
  final String archivo;
  final bool generado;
  final bool vigente;
  final int tamano;

  const Formato({
    required this.clave,
    required this.titulo,
    required this.archivo,
    required this.generado,
    required this.vigente,
    required this.tamano,
  });

  factory Formato.desdeJson(Map<String, dynamic> j) => Formato(
        clave: _texto(j['clave']),
        titulo: _texto(j['titulo']),
        archivo: _texto(j['archivo']),
        generado: _bool(j['generado']),
        vigente: _bool(j['vigente']),
        tamano: _entero(j['tamano']),
      );

  bool get listo => generado && vigente;
}

/// Expuestos para quien necesite las mismas conversiones tolerantes.
int enteroDe(dynamic v, [int pd = 0]) => _entero(v, pd);
double? decimalDe(dynamic v) => _decimal(v);
String textoDe(dynamic v) => _texto(v);
