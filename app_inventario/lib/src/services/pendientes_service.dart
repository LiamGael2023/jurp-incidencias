import 'dart:convert';
import 'dart:io';

import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

import '../models/modelos.dart';
import 'inventario_service.dart';

/// Lo que se evaluó sin señal y todavía no ha llegado al servidor.
///
/// POR QUÉ EXISTE. El inventario se levanta en el cerro y en los laterales,
/// donde la señal va y viene. Sin esto, el inspector llena una ficha de
/// setenta campos, pulsa guardar, falla, y o la vuelve a llenar entera más
/// tarde o no la llena nunca. Las dos cosas pasaron en papel durante años.
///
/// LO QUE NO HACE: fingir. Una ficha en la bandeja NO está guardada, y la
/// app lo dice con todas las letras en la pantalla y en el contador de la
/// barra. El peor resultado posible de una cola de pendientes es que el
/// inspector crea que ya subió y borre sus fotos.
///
/// LAS FOTOS VIAJAN POR RUTA, no copiadas aquí. Son archivos del propio
/// teléfono y copiarlas duplicaría medio giga en la bandeja. El riesgo es
/// que el usuario vacíe la galería antes de subir; por eso, al reintentar,
/// una foto que ya no está no tumba la evaluación: se sube lo que haya y se
/// avisa de la que faltó.
/// Qué clase de cosa espera en la bandeja.
///
/// Las dos esperan por lo mismo —no había señal— pero no se suben igual ni
/// se pueden tratar igual: una evaluación va contra una estructura que ya
/// existe y se puede reemplazar si se rehace; un alta crea algo nuevo cada
/// vez que se manda, así que dos altas iguales son dos estructuras.
class ClasePendiente {
  static const evaluacion = 'evaluacion';
  static const alta = 'alta';
}

class Pendiente {
  final String id;             // local, para poder borrar uno concreto
  final String clase;          // evaluacion | alta
  final String tipo;
  final int fid;               // 0 en un alta: todavía no hay estructura
  final String nombre;         // para enseñarlo en la bandeja
  final int? evaluacionId;     // si era una corrección de una ya existente
  final Map<String, dynamic> cuerpo;
  final List<String> fotos;
  final DateTime cuando;

  const Pendiente({
    required this.id,
    required this.tipo,
    required this.fid,
    required this.nombre,
    required this.evaluacionId,
    required this.cuerpo,
    required this.fotos,
    required this.cuando,
    this.clase = ClasePendiente.evaluacion,
  });

  bool get esAlta => clase == ClasePendiente.alta;

  Map<String, dynamic> aJson() => {
        'id': id,
        'clase': clase,
        'tipo': tipo,
        'fid': fid,
        'nombre': nombre,
        'evaluacion_id': evaluacionId,
        'cuerpo': cuerpo,
        'fotos': fotos,
        'cuando': cuando.toIso8601String(),
      };

  factory Pendiente.desdeJson(Map<String, dynamic> j) => Pendiente(
        id: '${j['id']}',
        // Sin 'clase' es una bandeja escrita por una versión anterior, y
        // entonces todo lo que hay dentro son evaluaciones. Leerlo como
        // alta mandaría la ficha a crear estructuras.
        clase: j['clase'] == null ? ClasePendiente.evaluacion : '${j['clase']}',
        tipo: '${j['tipo']}',
        fid: enteroDe(j['fid']),
        nombre: '${j['nombre'] ?? ''}',
        evaluacionId:
            j['evaluacion_id'] == null ? null : enteroDe(j['evaluacion_id']),
        cuerpo: Map<String, dynamic>.from(
            (j['cuerpo'] as Map?) ?? const <String, dynamic>{}),
        fotos: [for (final f in (j['fotos'] as List? ?? const [])) '$f'],
        cuando: DateTime.tryParse('${j['cuando']}') ?? DateTime.now(),
      );

  Evaluacion get evaluacion => Evaluacion(
        id: evaluacionId,
        tipoActivo: tipo,
        activoFid: fid,
        valores: Map<String, dynamic>.from(
            (cuerpo['valores'] as Map?) ?? const <String, dynamic>{}),
        estadoCons: cuerpo['estado_cons'] as String?,
        condicion: cuerpo['condicion'] as String?,
        evaluador: cuerpo['evaluador'] as String?,
        observaciones: cuerpo['observaciones'] as String?,
        requiereMant: cuerpo['requiere_mant'] == true,
        prioridad: cuerpo['prioridad'] as String?,
      );
}

class ResultadoEnvio {
  final int subidas;
  final List<String> fallos;
  const ResultadoEnvio(this.subidas, this.fallos);
}

class PendientesService {
  Future<File> _archivo() async {
    final dir = await getApplicationDocumentsDirectory();
    return File(p.join(dir.path, 'pendientes.json'));
  }

  Future<List<Pendiente>> todos() async {
    final f = await _archivo();
    if (!await f.exists()) return [];
    try {
      final l = jsonDecode(await f.readAsString()) as List;
      return [
        for (final x in l) Pendiente.desdeJson(Map<String, dynamic>.from(x))
      ];
    } catch (_) {
      // Un archivo corrupto no puede dejar la app sin arrancar. Se avisa
      // devolviendo vacío; lo que había se queda en disco por si hace falta.
      return [];
    }
  }

  Future<void> _escribir(List<Pendiente> lista) async {
    final f = await _archivo();
    await f.writeAsString(jsonEncode([for (final x in lista) x.aJson()]));
  }

  Future<Pendiente> agregar({
    required String tipo,
    required int fid,
    required String nombre,
    required int? evaluacionId,
    required Map<String, dynamic> cuerpo,
    required List<String> fotos,
    String clase = ClasePendiente.evaluacion,
  }) async {
    final lista = await todos();
    final nuevo = Pendiente(
      id: DateTime.now().microsecondsSinceEpoch.toString(),
      clase: clase,
      tipo: tipo,
      fid: fid,
      nombre: nombre,
      evaluacionId: evaluacionId,
      cuerpo: cuerpo,
      fotos: fotos,
      cuando: DateTime.now(),
    );
    // Si ya había una ficha pendiente de ESTA misma estructura, la nueva la
    // reemplaza. Subir las dos crearía dos evaluaciones de lo mismo y la
    // segunda rebotaría contra la restricción del servidor.
    //
    // CON LAS ALTAS NO, Y ES IMPORTANTE: un alta todavía no tiene fid, así
    // que todas las de un mismo tipo valen 0. Aplicarles esta regla haría
    // que la segunda canoa encontrada en la mañana borrara la primera, sin
    // avisar y sin forma de recuperarla.
    if (clase != ClasePendiente.alta) {
      lista.removeWhere(
          (x) => !x.esAlta && x.tipo == tipo && x.fid == fid);
    }
    lista.add(nuevo);
    await _escribir(lista);
    return nuevo;
  }

  Future<void> quitar(String id) async {
    final lista = await todos();
    lista.removeWhere((x) => x.id == id);
    await _escribir(lista);
  }

  Future<int> cuantos() async => (await todos()).length;

  /// Intenta subir todo lo pendiente. Lo que sube se borra de la bandeja;
  /// lo que falla se queda, con su motivo.
  Future<ResultadoEnvio> enviar(
      InventarioService api, int campaniaId) async {
    final lista = await todos();
    var subidas = 0;
    final fallos = <String>[];

    for (final x in lista) {
      if (x.esAlta) {
        try {
          // El cuerpo se manda TAL CUAL se guardó, con sus coordenadas del
          // momento. Recalcularlo aquí pondría el alta donde el teléfono
          // recuperó la cobertura, que puede ser el pueblo de al lado.
          await api.enviarActivoNuevo(x.cuerpo);
          await quitar(x.id);
          subidas++;
        } catch (e) {
          fallos.add('${x.nombre}: ${_motivo(e)}');
        }
        continue;
      }
      try {
        final guardada = await api.guardarEvaluacion(
            campaniaId: campaniaId, ev: x.evaluacion);

        for (final ruta in x.fotos) {
          final f = File(ruta);
          if (!await f.exists()) {
            fallos.add('${x.nombre}: una foto ya no está en el teléfono');
            continue;
          }
          try {
            await api.subirFoto(x.tipo, x.fid, f);
          } catch (e) {
            fallos.add('${x.nombre}: no subió una foto');
          }
        }

        // La evaluación llegó; si alguna foto no, la ficha ya no se
        // reintenta entera —volvería a crear la evaluación—. Lo que falló
        // se dice y se sube a mano desde la ficha.
        await quitar(x.id);
        subidas++;
        if (guardada.id == null) {
          fallos.add('${x.nombre}: el servidor no devolvió identificador');
        }
      } catch (e) {
        fallos.add('${x.nombre}: ${_motivo(e)}');
      }
    }
    return ResultadoEnvio(subidas, fallos);
  }

  String _motivo(Object e) =>
      e.toString().replaceFirst('Exception: ', '').trim();
}
