import 'package:flutter/foundation.dart';

import '../models/modelos.dart';
import '../services/inventario_service.dart';
import '../services/pendientes_service.dart';
import '../utils/catalogo_capas.dart';

/// El estado del inventario: qué campaña, qué capas están encendidas, qué
/// hay descargado y qué se evaluó.
///
/// Un solo controlador para el mapa y los reportes, y no uno por pantalla:
/// las dos miran la misma campaña y el mismo avance, y tenerlo por duplicado
/// garantiza que un día enseñen números distintos de lo mismo.
class InventarioController extends ChangeNotifier {
  final InventarioService api;
  final PendientesService bandeja;

  InventarioController({InventarioService? api, PendientesService? bandeja})
      : api = api ?? InventarioService(),
        bandeja = bandeja ?? PendientesService();

  // ── estado ────────────────────────────────────────────────────────────
  bool iniciando = true;
  String? error;

  List<Campania> campanias = [];
  Campania? campania;

  Map<String, TotalCapa> totales = {};
  List<AvanceCapa> avance = [];
  Map<String, Evaluacion> evaluaciones = {};

  /// 'todo' | 'JURP' | 'PECH'. Arranca en todo: el mapa sirve para ver qué
  /// hay, y arrancar filtrado esconde la mitad sin decirlo.
  String ambito = 'todo';

  /// Qué capas están encendidas. Arranca TODO encendido, como la web:
  /// llegar a ver el inventario marcando treinta y siete casillas no es
  /// verlo.
  late Map<String, bool> visibles = {
    for (final c in todasLasCapas) c.codigo: true,
  };

  /// Los activos ya descargados, por «codigo::ambito».
  final Map<String, List<Activo>> _datos = {};
  final Set<String> _cargando = {};

  int pendientes = 0;

  // ── arranque ──────────────────────────────────────────────────────────

  Future<void> iniciar() async {
    iniciando = true;
    error = null;
    notifyListeners();
    try {
      final r = await Future.wait([campanias_(), api.totales()]);
      campanias = r[0] as List<Campania>;
      totales = r[1] as Map<String, TotalCapa>;

      campania = campanias.where((c) => c.vigente).isNotEmpty
          ? campanias.firstWhere((c) => c.vigente)
          : (campanias.isEmpty ? null : campanias.first);

      if (campania != null) await _cargarCampania(campania!);
      await contarPendientes();
    } catch (e) {
      error = _motivo(e);
    } finally {
      iniciando = false;
      notifyListeners();
    }
  }

  Future<List<Campania>> campanias_() => api.campanias();

  Future<void> _cargarCampania(Campania c) async {
    final r = await Future.wait([api.avance(c.id), api.evaluaciones(c.anio)]);
    avance = r[0] as List<AvanceCapa>;
    evaluaciones = r[1] as Map<String, Evaluacion>;
  }

  Future<void> cambiarCampania(Campania c) async {
    campania = c;
    notifyListeners();
    try {
      await _cargarCampania(c);
    } catch (e) {
      error = _motivo(e);
    }
    notifyListeners();
  }

  Future<void> refrescarAvance() async {
    if (campania == null) return;
    try {
      avance = await api.avance(campania!.id);
      notifyListeners();
    } catch (_) {
      // El avance se vuelve a pedir al abrir el panel; no vale la pena
      // molestar con un error por esto.
    }
  }

  // ── capas ─────────────────────────────────────────────────────────────

  String _llave(String codigo) => '$codigo::$ambito';

  List<Activo> activosDe(String codigo) => _datos[_llave(codigo)] ?? const [];

  bool estaCargando(String codigo) => _cargando.contains(_llave(codigo));

  /// Descarga una capa si hace falta. Al cambiar de ámbito no se borra lo
  /// anterior: volver a «todo» después de mirar solo JURP es instantáneo.
  Future<void> cargarCapa(String codigo) async {
    final k = _llave(codigo);
    if (_datos.containsKey(k) || _cargando.contains(k)) return;
    _cargando.add(k);
    notifyListeners();
    try {
      _datos[k] = await api.capa(codigo, ambito);
    } catch (e) {
      error = 'No se pudo cargar ${capaPorCodigo(codigo)?.label ?? codigo}: '
          '${_motivo(e)}';
    } finally {
      _cargando.remove(k);
      notifyListeners();
    }
  }

  /// Las encendidas, de una en una. En serie y no todas a la vez: son
  /// treinta y siete peticiones y algunas traen miles de geometrías;
  /// lanzarlas en paralelo en una red de campo las hace fallar a todas.
  Future<void> cargarEncendidas() async {
    for (final c in todasLasCapas) {
      if (visibles[c.codigo] == true) await cargarCapa(c.codigo);
    }
  }

  void alternarCapa(String codigo) {
    visibles[codigo] = !(visibles[codigo] ?? false);
    notifyListeners();
    if (visibles[codigo] == true) cargarCapa(codigo);
  }

  void todasLasCapasVisibles(bool encendidas) {
    for (final c in todasLasCapas) {
      visibles[c.codigo] = encendidas;
    }
    notifyListeners();
    if (encendidas) cargarEncendidas();
  }

  Future<void> cambiarAmbito(String nuevo) async {
    if (nuevo == ambito) return;
    ambito = nuevo;
    notifyListeners();
    await cargarEncendidas();
  }

  // ── evaluaciones ──────────────────────────────────────────────────────

  Evaluacion? evaluacionDe(String tipo, int fid) =>
      evaluaciones['$tipo:$fid'];

  /// Guarda contra el servidor. Si no hay señal, la deja en la bandeja y lo
  /// DICE —devuelve `false`—, para que la pantalla no diga «guardado».
  ///
  /// Si el servidor SÍ contestó y rechazó —un obligatorio que falta, un
  /// número fuera de rango—, el error sube tal cual a la pantalla. Meter eso
  /// en la bandeja lo dejaría reintentándose para siempre, fallando igual
  /// cada vez y sin que nadie viera nunca el motivo.
  Future<bool> guardar({
    required String tipo,
    required int fid,
    required String nombre,
    required Evaluacion ev,
    List<String> fotos = const [],
  }) async {
    if (campania == null) throw Exception('No hay campaña activa');
    try {
      final guardada =
          await api.guardarEvaluacion(campaniaId: campania!.id, ev: ev);
      evaluaciones[guardada.llave] = guardada;
      notifyListeners();
      refrescarAvance();
      return true;
    } on SinConexion {
      await bandeja.agregar(
        tipo: tipo,
        fid: fid,
        nombre: nombre,
        evaluacionId: ev.id,
        cuerpo: ev.aJson(),
        fotos: fotos,
      );
      await contarPendientes();
      return false;
    }
  }

  Future<void> contarPendientes() async {
    pendientes = await bandeja.cuantos();
    notifyListeners();
  }

  Future<ResultadoEnvio> enviarPendientes() async {
    if (campania == null) {
      return const ResultadoEnvio(0, ['No hay campaña activa']);
    }
    final r = await bandeja.enviar(api, campania!.id);
    if (r.subidas > 0) {
      try {
        evaluaciones = await api.evaluaciones(campania!.anio);
      } catch (_) {/* se refresca al reabrir */}
      refrescarAvance();
    }
    await contarPendientes();
    return r;
  }

  // ── resumen ───────────────────────────────────────────────────────────

  int get totalCampania =>
      avance.fold(0, (a, x) => a + x.total);
  int get evaluadosCampania =>
      avance.fold(0, (a, x) => a + x.evaluados);
  double get porcentaje =>
      totalCampania == 0 ? 0 : evaluadosCampania / totalCampania * 100;

  String _motivo(Object e) =>
      e.toString().replaceFirst('Exception: ', '').trim();
}
