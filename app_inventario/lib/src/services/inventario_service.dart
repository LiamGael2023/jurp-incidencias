import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;
import 'package:latlong2/latlong.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

import '../models/modelos.dart';
import 'auth_service.dart';

/// Todo lo que la app le pide al inventario.
///
/// Es el mismo backend que usa el visor web —/vigapi/inventario— y las
/// mismas rutas. No hay API «de móvil» aparte, y es lo que se quiere: una
/// sola verdad. El día que cambie un campo, cambia para los dos a la vez y
/// no hay forma de que uno se quede atrás sin que nadie lo note.
///
/// NO SE MANDA CABECERA DE AUTENTICACIÓN, igual que la web: estas rutas no
/// la piden. El login de esta app es la puerta, no la llave. Mandar un
/// «Authorization» que el servidor no espera es la clase de cosa que
/// funciona hasta el día que alguien activa una clase de autenticación y
/// entonces falla todo a la vez.
/// No se pudo hablar con el servidor: no hay señal, o no contestó.
///
/// ES DISTINTO DE QUE EL SERVIDOR RECHACE, y la diferencia decide qué pasa
/// con una ficha. Si el servidor contestó «altura: este campo es
/// obligatorio», guardarla en la bandeja la dejaría reintentándose para
/// siempre y fallando siempre igual, sin que nadie viera el motivo. Solo lo
/// que ni siquiera llegó merece esperar a que vuelva la cobertura.
class SinConexion implements Exception {
  final String mensaje;
  const SinConexion([this.mensaje = 'Sin conexión con el servidor']);
  @override
  String toString() => mensaje;
}

/// El servidor contestó, pero esa ruta no existe ahí.
///
/// ES OTRA COSA QUE NO TENER SEÑAL, y la diferencia importa: lo primero no
/// lo arregla el inspector por mucho que suba al cerro a buscar cobertura.
/// Pasa con el almacén de fotos, que no está desplegado en todos los
/// servidores; decirle «¿hay señal?» a alguien que tiene cuatro rayas es
/// mandarlo a perder la mañana.
class SinEndpoint implements Exception {
  final String mensaje;
  const SinEndpoint(
      [this.mensaje = 'Este servidor todavía no tiene esa función']);
  @override
  String toString() => mensaje;
}

class InventarioService {
  static const String base = '${AuthService.servidor}/vigapi/inventario';

  final http.Client _cliente = http.Client();

  Future<Map<String, dynamic>> _json(String ruta) async {
    final r = await http
        .get(Uri.parse('$base$ruta'))
        .timeout(const Duration(seconds: 40));
    if (r.statusCode != 200) {
      throw Exception('El servidor respondió ${r.statusCode}');
    }
    final d = jsonDecode(utf8.decode(r.bodyBytes));
    // Django REST pagina unas rutas y otras no: unas devuelven {results: []}
    // y otras la lista pelada. Se normaliza aquí y no en cada llamada.
    return d is List ? {'results': d} : Map<String, dynamic>.from(d as Map);
  }

  List<Map<String, dynamic>> _lista(Map<String, dynamic> d) => [
        for (final x in (d['results'] as List? ?? const []))
          Map<String, dynamic>.from(x as Map)
      ];

  // ── campañas, totales y avance ────────────────────────────────────────

  Future<List<Campania>> campanias() async =>
      [for (final j in _lista(await _json('/campanias/'))) Campania.desdeJson(j)];

  Future<Map<String, TotalCapa>> totales() async {
    final l = _lista(await _json('/capas/'));
    return {
      for (final j in l) '${j['codigo']}': TotalCapa.desdeJson(j),
    };
  }

  Future<List<AvanceCapa>> avance(int campaniaId) async {
    final d = await _json('/campanias/$campaniaId/avance/');
    return [
      for (final x in (d['detalle'] as List? ?? const []))
        AvanceCapa.desdeJson(Map<String, dynamic>.from(x as Map))
    ];
  }

  /// Las evaluaciones de una campaña, por «tipo:fid».
  Future<Map<String, Evaluacion>> evaluaciones(int anio) async {
    final l = _lista(await _json('/evaluaciones/?campania=$anio'));
    final m = <String, Evaluacion>{};
    for (final j in l) {
      final e = Evaluacion.desdeJson(j);
      m[e.llave] = e;
    }
    return m;
  }

  /// El índice de búsqueda: todas las estructuras, con lo justo para
  /// encontrarlas. Se guarda en el teléfono, así que buscar sigue
  /// funcionando sin señal aunque no se pueda abrir la ficha.
  Future<List<ItemIndice>> indice() async {
    final archivo = await _archivoCache('_indice');
    try {
      final d = await _json('/capas/indice/');
      final filas = _lista(d);
      await archivo.writeAsString(jsonEncode(filas));
      return [for (final j in filas) ItemIndice.desdeJson(j)];
    } catch (e) {
      if (await archivo.exists()) {
        final l = jsonDecode(await archivo.readAsString()) as List;
        return [
          for (final j in l)
            ItemIndice.desdeJson(Map<String, dynamic>.from(j as Map))
        ];
      }
      rethrow;
    }
  }

  // ── capas ─────────────────────────────────────────────────────────────

  /// Una capa entera, en GeoJSON, ya convertida a activos.
  ///
  /// GUARDA UNA COPIA EN EL TELÉFONO y la usa cuando no hay señal. No es un
  /// modo sin conexión completo —evaluar sigue necesitando el servidor—,
  /// pero que el mapa dibuje dónde están las estructuras cuando uno ya está
  /// en el cerro es la diferencia entre trabajar y volverse.
  Future<List<Activo>> capa(String codigo, String ambito) async {
    final filtro = ambito == 'todo' ? '' : '&ambito=$ambito';
    final archivo = await _archivoCache('$codigo-$ambito');

    try {
      final r = await http
          .get(Uri.parse('$base/capas/$codigo/?srid=4326$filtro'))
          .timeout(const Duration(seconds: 60));
      if (r.statusCode != 200) throw Exception('HTTP ${r.statusCode}');
      final texto = utf8.decode(r.bodyBytes);
      // Se guarda el cuerpo tal cual y no los objetos ya convertidos: si
      // algún día cambia cómo se leen, la copia vieja sigue sirviendo.
      await archivo.writeAsString(texto);
      return _activosDeGeoJson(codigo, jsonDecode(texto));
    } catch (e) {
      if (await archivo.exists()) {
        return _activosDeGeoJson(
            codigo, jsonDecode(await archivo.readAsString()));
      }
      rethrow;
    }
  }

  Future<File> _archivoCache(String nombre) async {
    final dir = Directory(
        p.join((await getApplicationDocumentsDirectory()).path, 'capas'));
    if (!await dir.exists()) await dir.create(recursive: true);
    return File(p.join(dir.path, '$nombre.json'));
  }

  /// ¿Qué capas hay guardadas y cuánto ocupan? Para poder enseñarlo y
  /// poder borrarlo: un teléfono de campo se llena, y entonces deja de
  /// tomar fotos, que es lo último que uno quiere descubrir en el cerro.
  Future<int> bytesEnCache() async {
    final dir = Directory(
        p.join((await getApplicationDocumentsDirectory()).path, 'capas'));
    if (!await dir.exists()) return 0;
    var total = 0;
    await for (final f in dir.list()) {
      if (f is File) total += await f.length();
    }
    return total;
  }

  Future<void> vaciarCache() async {
    final dir = Directory(
        p.join((await getApplicationDocumentsDirectory()).path, 'capas'));
    if (await dir.exists()) await dir.delete(recursive: true);
  }

  // ── GeoJSON → activos ─────────────────────────────────────────────────

  List<Activo> _activosDeGeoJson(String codigo, dynamic geo) {
    final feats = (geo is Map ? geo['features'] : null) as List? ?? const [];
    final salida = <Activo>[];

    for (final f in feats) {
      if (f is! Map) continue;
      final props = Map<String, dynamic>.from(
          (f['properties'] as Map?) ?? const <String, dynamic>{});
      final g = f['geometry'];
      if (g is! Map) continue;

      final lineas = <List<LatLng>>[];
      final partes = <List<List<LatLng>>>[];
      LatLng? punto;

      switch ('${g['type']}') {
        case 'Point':
          punto = _puntoDe(g['coordinates']);
          break;
        case 'MultiPoint':
          final c = g['coordinates'] as List? ?? const [];
          if (c.isNotEmpty) punto = _puntoDe(c.first);
          break;
        case 'LineString':
          lineas.add(_lineaDe(g['coordinates']));
          break;
        case 'MultiLineString':
          for (final l in (g['coordinates'] as List? ?? const [])) {
            lineas.add(_lineaDe(l));
          }
          break;
        case 'Polygon':
          final anillos = [
            for (final a in (g['coordinates'] as List? ?? const []))
              _lineaDe(a)
          ];
          partes.add(anillos);
          lineas.addAll(anillos);
          break;
        case 'MultiPolygon':
          for (final poli in (g['coordinates'] as List? ?? const [])) {
            // Nombre distinto del de la rama de arriba a propósito: las dos
            // viven en el mismo `switch` y compartir nombre ahí no compila.
            final anillosParte = [
              for (final a in (poli as List? ?? const [])) _lineaDe(a)
            ];
            partes.add(anillosParte);
            lineas.addAll(anillosParte);
          }
          break;
      }

      // A una línea o un polígono también se le calcula un punto: es a
      // donde vuela el mapa cuando se busca esa estructura, y dónde se
      // ancla su etiqueta.
      if (punto == null && lineas.isNotEmpty) {
        punto = _centroDe(lineas.first);
      }
      if (punto == null && lineas.isEmpty) continue;

      salida.add(Activo(
        tipo: codigo,
        fid: enteroDe(props['fid'] ?? f['id']),
        props: props,
        punto: punto,
        lineas: lineas,
        partes: partes,
      ));
    }
    return salida;
  }

  /// GeoJSON trae [longitud, latitud] —en ese orden—. Invertirlo es el
  /// error clásico y no da un fallo: da estructuras en mitad del océano.
  LatLng? _puntoDe(dynamic c) {
    if (c is! List || c.length < 2) return null;
    final lng = decimalDe(c[0]);
    final lat = decimalDe(c[1]);
    if (lat == null || lng == null) return null;
    return LatLng(lat, lng);
  }

  List<LatLng> _lineaDe(dynamic coords) {
    final pts = <LatLng>[];
    for (final c in (coords as List? ?? const [])) {
      final pt = _puntoDe(c);
      if (pt != null) pts.add(pt);
    }
    return pts;
  }

  LatLng? _centroDe(List<LatLng> pts) {
    if (pts.isEmpty) return null;
    var lat = 0.0, lng = 0.0;
    for (final p in pts) {
      lat += p.latitude;
      lng += p.longitude;
    }
    return LatLng(lat / pts.length, lng / pts.length);
  }

  // ── formulario y evaluación ───────────────────────────────────────────

  Future<List<CampoEvaluable>> campos(String tipo) async {
    final l = _lista(await _json('/campos-evaluables/?tipo_activo=$tipo'));
    final campos = [for (final j in l) CampoEvaluable.desdeJson(j)];
    campos.sort((a, b) => a.orden.compareTo(b.orden));
    return campos;
  }

  /// Guarda una evaluación. POST si es nueva, PATCH si ya existía.
  ///
  /// Devuelve la evaluación guardada, o lanza con el motivo que diga el
  /// servidor: cuando DRF rechaza por validación responde un diccionario de
  /// campo → errores, y enseñar «Error 400» en vez de «altura: este campo
  /// es obligatorio» deja al inspector sin saber qué corregir.
  Future<Evaluacion> guardarEvaluacion({
    required int campaniaId,
    required Evaluacion ev,
  }) async {
    final nueva = ev.id == null;
    final url = nueva
        ? Uri.parse('$base/evaluaciones/')
        : Uri.parse('$base/evaluaciones/${ev.id}/');

    final cuerpo = {...ev.aJson(), 'campania': campaniaId};

    final http.Response r;
    try {
      r = await (nueva
              ? http.post(url,
                  headers: {'Content-Type': 'application/json'},
                  body: jsonEncode(cuerpo))
              : http.patch(url,
                  headers: {'Content-Type': 'application/json'},
                  body: jsonEncode(cuerpo)))
          .timeout(const Duration(seconds: 40));
    } catch (_) {
      // Ni siquiera llegó: esto sí espera a que vuelva la señal.
      throw const SinConexion();
    }

    Map<String, dynamic> d;
    try {
      d = Map<String, dynamic>.from(
          jsonDecode(utf8.decode(r.bodyBytes)) as Map);
    } catch (_) {
      d = {};
    }

    if (r.statusCode >= 200 && r.statusCode < 300) {
      return Evaluacion.desdeJson(d);
    }

    final detalle = d.entries
        .map((e) => '${e.key}: '
            '${e.value is List ? (e.value as List).join(' ') : e.value}')
        .join(' · ');
    throw Exception(detalle.isEmpty ? 'Error ${r.statusCode}' : detalle);
  }

  // ── fotos ─────────────────────────────────────────────────────────────

  /// Las fotos de un activo.
  ///
  /// No pasa por `_json` porque aquí hay que mirar el código de estado: un
  /// 404 significa que este servidor no tiene almacén de fotos, y eso no es
  /// lo mismo que «no hay fotos» ni que «no hay señal».
  Future<List<Foto>> fotos(String tipo, int fid) async {
    final http.Response r;
    try {
      r = await http
          .get(Uri.parse('$base/fotos/?tipo_activo='
              '${Uri.encodeComponent(tipo)}&activo_fid=$fid'))
          .timeout(const Duration(seconds: 30));
    } catch (_) {
      throw const SinConexion();
    }
    if (r.statusCode == 404) throw const SinEndpoint();
    if (r.statusCode != 200) {
      throw Exception('El servidor respondió ${r.statusCode}');
    }
    final d = jsonDecode(utf8.decode(r.bodyBytes));
    final lista = d is List ? d : ((d as Map)['results'] as List? ?? const []);
    return [
      for (final j in lista)
        Foto.desdeJson(Map<String, dynamic>.from(j as Map), base,
            AuthService.servidor)
    ];
  }

  Future<Foto> subirFoto(String tipo, int fid, File imagen) async {
    final req = http.MultipartRequest('POST', Uri.parse('$base/fotos/'))
      ..fields['tipo_activo'] = tipo
      ..fields['activo_fid'] = '$fid'
      ..files.add(await http.MultipartFile.fromPath('imagen', imagen.path));

    final http.StreamedResponse res;
    try {
      res = await req.send().timeout(const Duration(minutes: 3));
    } catch (_) {
      throw const SinConexion();
    }

    final cuerpo = await res.stream.bytesToString();
    if (res.statusCode == 404) throw const SinEndpoint();

    if (res.statusCode < 200 || res.statusCode >= 300) {
      // Cuando DRF rechaza por validación responde campo → errores. Decirlo
      // ahorra abrir el servidor para enterarse de que la imagen pesaba más
      // de lo que acepta.
      String detalle = 'El servidor respondió ${res.statusCode}';
      try {
        final d = Map<String, dynamic>.from(jsonDecode(cuerpo) as Map);
        final txt = d.entries
            .map((e) => '${e.key}: '
                '${e.value is List ? (e.value as List).join(' ') : e.value}')
            .join(' · ');
        if (txt.isNotEmpty) detalle = txt;
      } catch (_) {}
      throw Exception(detalle);
    }

    return Foto.desdeJson(
        Map<String, dynamic>.from(jsonDecode(cuerpo) as Map),
        base, AuthService.servidor);
  }

  Future<void> borrarFoto(int id) async {
    final r = await http.delete(Uri.parse('$base/fotos/$id/'));
    if (r.statusCode >= 300) {
      throw Exception('El servidor respondió ${r.statusCode}');
    }
  }

  // ── reportes ──────────────────────────────────────────────────────────

  /// Los formatos disponibles para un ámbito.
  ///
  /// `anio` y NO el id de la campaña: el generador recibe el año —es lo que
  /// manda el visor web— y con un id recibía «campaña 1», buscaba una
  /// campaña del año 1 y devolvía cero registros sin que nada pareciera
  /// roto. Null = inventario base, con el estado del levantamiento original.
  Future<List<Formato>> formatos(String ambito, int? anio) async {
    final c = anio == null ? '' : '&campania=$anio';
    final d = await _json('/reportes/?ambito=$ambito$c');
    return [
      for (final x in (d['formatos'] as List? ?? const []))
        Formato.desdeJson(Map<String, dynamic>.from(x as Map))
    ];
  }

  /// Baja lo que haya en esa URL y lo deja escrito en el teléfono.
  ///
  /// PASA POR UNA PETICIÓN Y NO POR ABRIR EL ENLACE EN EL NAVEGADOR para
  /// poder enseñar el error cuando el generador falla: un enlace dejaría al
  /// usuario con un archivo de error sin explicación, y el archivo de error
  /// se llama igual que el bueno.
  ///
  /// El plazo es largo a propósito. Armar las fichas de una capa entera son
  /// decenas de páginas con sus croquis y sus fotos, y el servidor las
  /// dibuja al vuelo: cortar a los treinta segundos sería cortar justo lo
  /// que más se tarda en pedir.
  Future<File> _bajar(String ruta, String nombreArchivo) async {
    final r =
        await http.get(Uri.parse(ruta)).timeout(const Duration(minutes: 5));
    if (r.statusCode != 200) {
      String detalle = 'El servidor respondió ${r.statusCode}';
      try {
        final d = jsonDecode(utf8.decode(r.bodyBytes)) as Map;
        if (d['detail'] != null) detalle = '${d['detail']}';
      } catch (_) {}
      throw Exception(detalle);
    }
    final dir = await getApplicationDocumentsDirectory();
    final f = File(p.join(dir.path, nombreArchivo));
    await f.writeAsBytes(r.bodyBytes);
    return f;
  }

  /// Baja un formato y devuelve el archivo ya escrito en el teléfono.
  ///
  /// `pdf` pide la versión impresa del mismo formato. El Excel sirve para
  /// seguir trabajando el dato y el PDF para entregarlo: en campo, lo que
  /// se enseña y se firma es el PDF.
  Future<File> descargarFormato(
      String clave, String nombreArchivo, String ambito, int? anio,
      {bool pdf = false}) async {
    final c = anio == null ? '' : '&campania=$anio';
    final ruta = clave == 'todos'
        ? '$base/reportes/todos/?ambito=$ambito$c'
        : '$base/reportes/${Uri.encodeComponent(clave)}/'
            '${pdf ? 'pdf/' : ''}?ambito=$ambito$c';
    final nombre = nombreArchivo.isEmpty
        ? '$clave.${pdf ? 'pdf' : 'xlsx'}'
        : (pdf ? '${p.withoutExtension(nombreArchivo)}.pdf' : nombreArchivo);
    return _bajar(ruta, nombre);
  }

  /// Las fichas de inspección del ANA, en PDF.
  ///
  /// La misma ruta sirve tres cosas distintas según lo que se le pida, y
  /// son las tres que se usan:
  ///
  ///   fid != null      la ficha de ESA estructura, con lo evaluado dentro.
  ///                    Es la que se mira en campo, delante de la obra.
  ///   evaluadas        solo las que ya tienen evaluación en la campaña.
  ///                    `tipo` puede ser 'todas' para la campaña entera.
  ///   ninguna de las   el talonario en blanco de esa capa, para imprimir
  ///   dos              y salir con él.
  ///
  /// El PDF lo arma el servidor con el mismo generador que el visor web, y
  /// es a propósito: la ficha que firma la Junta no puede depender de si se
  /// imprimió desde un teléfono o desde un escritorio.
  Future<File> descargarFichas({
    required String tipo,
    int? fid,
    bool evaluadas = false,
    String ambito = 'todo',
    int? anio,
  }) async {
    final q = <String, String>{'tipo': tipo};
    if (fid != null) q['fid'] = '$fid';
    if (evaluadas) q['evaluadas'] = '1';
    if (ambito.isNotEmpty) q['ambito'] = ambito;
    if (anio != null) q['campania'] = '$anio';

    final nombre = fid != null
        ? 'ficha_${tipo}_$fid.pdf'
        : evaluadas
            ? 'fichas_evaluadas_$tipo.pdf'
            : 'fichas_$tipo.pdf';

    return _bajar(
      Uri.parse('$base/reportes/fichas/')
          .replace(queryParameters: q)
          .toString(),
      nombre,
    );
  }

  void cerrar() => _cliente.close();
}
