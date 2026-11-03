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

  /// El índice de búsqueda. Se pide aparte y sin bloquear el arranque: el
  /// mapa tiene que dibujarse aunque el índice tarde, y buscar es lo segundo
  /// que hace el inspector, no lo primero.
  List<ItemIndice> indice = [];

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
      cargarIndice();   // en segundo plano, a propósito
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
  ///
  /// PRIMERO LO QUE SE EVALÚA. Las capas del PECH son contexto —trazados,
  /// vías, garitas de terceros— y algunas son enormes. Si se bajan en el
  /// orden del catálogo, el inspector mira dos minutos un mapa con carreteras
  /// y sin estructuras. Las suyas aparecen antes.
  Future<void> cargarEncendidas() async {
    final orden = [
      ...todasLasCapas.where((c) => !c.contexto),
      ...todasLasCapas.where((c) => c.contexto),
    ];
    for (final c in orden) {
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

  // ── búsqueda ──────────────────────────────────────────────────────────

  Future<void> cargarIndice() async {
    try {
      indice = await api.indice();
      notifyListeners();
    } catch (_) {
      // Sin índice el mapa funciona igual; solo no se puede buscar. No vale
      // la pena un error en pantalla por esto.
    }
  }

  /// Busca por nombre, canal, progresiva o tipo. Sin tildes ni mayúsculas.
  ///
  /// Desde dos letras: con una sola, «a» devuelve media lista y el teléfono
  /// se pasa un segundo dibujándola para nada.
  List<ItemIndice> buscar(String texto, {int tope = 30}) {
    final q = normalizaBusqueda(texto);
    if (q.length < 2) return const [];
    final out = <ItemIndice>[];
    for (final i in indice) {
      if (i.buscable.contains(q)) {
        out.add(i);
        if (out.length >= tope) break;
      }
    }
    return out;
  }

  /// Enciende una capa y la descarga si hacía falta. Lo usa la búsqueda:
  /// llevar a una estructura de una capa apagada y dejarla invisible al
  /// llegar sería un viaje a ninguna parte.
  Future<void> asegurarCapa(String codigo) async {
    if (visibles[codigo] != true) {
      visibles[codigo] = true;
      notifyListeners();
    }
    await cargarCapa(codigo);
  }

  /// El activo ya descargado que corresponde a una fila del índice, si está.
  Activo? activoDe(String tipo, int fid) {
    for (final a in activosDe(tipo)) {
      if (a.fid == fid) return a;
    }
    return null;
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
