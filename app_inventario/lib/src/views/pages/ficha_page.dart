import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_image_compress/flutter_image_compress.dart';
import 'package:image_picker/image_picker.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'package:provider/provider.dart';

import '../../controllers/inventario_controller.dart';
import '../../models/modelos.dart';
import '../../utils/app_colors.dart';
import '../../utils/catalogo_capas.dart';
import 'evaluacion_page.dart';

/// Lo que se sabe de una estructura: sus características, cómo quedó la
/// última evaluación y sus fotos.
///
/// Se enseñan TODAS las propiedades que trae la capa y no un puñado elegido
/// a mano. Para una toma puede bastar con ocho campos; para una alcantarilla
/// lo que el inspector necesita ver —la luz, el diámetro, el número de
/// hojas— es otro, y descartarlo al leer lo vuelve invisible sin que nadie
/// se entere de que existía.
class FichaPage extends StatefulWidget {
  final Activo activo;
  final Capa capa;

  const FichaPage({super.key, required this.activo, required this.capa});

  @override
  State<FichaPage> createState() => _FichaPageState();
}

class _FichaPageState extends State<FichaPage> {
  List<Foto>? _fotos;
  String? _falloFotos;
  bool _subiendo = false;

  @override
  void initState() {
    super.initState();
    _cargarFotos();
  }

  Future<void> _cargarFotos() async {
    final inv = context.read<InventarioController>();
    try {
      final f = await inv.api.fotos(widget.activo.tipo, widget.activo.fid);
      if (mounted) setState(() => _fotos = f);
    } catch (e) {
      if (mounted) {
        setState(() {
          _fotos = [];
          _falloFotos = 'No se pudieron consultar las fotos';
        });
      }
    }
  }

  // ── fotos ─────────────────────────────────────────────────────────────

  /// Reduce la foto antes de subirla.
  ///
  /// La toma el inspector con el teléfono: cada una son 3-5 MB de un sensor
  /// de 12 MP. Tres por estructura y unas mil estructuras son diez gigas en
  /// el servidor para mirarlas en un recuadro. Reducidas al lado mayor de
  /// 1600 px quedan en unos 300 KB sin perder nada de lo que se mira —una
  /// grieta, un sedimento, una compuerta torcida—. Y con la cobertura que
  /// hay en Chao, de cinco megas a trescientos kilobytes va de «no sube» a
  /// «sube».
  Future<File?> _preparar(XFile x) async {
    try {
      final dir = await getTemporaryDirectory();
      final destino = p.join(dir.path,
          'foto_${DateTime.now().millisecondsSinceEpoch}.jpg');
      final salida = await FlutterImageCompress.compressAndGetFile(
        x.path,
        destino,
        quality: 82,
        minWidth: 1600,
        minHeight: 1600,
      );
      if (salida != null) return File(salida.path);
    } catch (_) {
      // Si la compresión falla —un formato raro del fabricante— se sube el
      // original: mejor cinco megas que perder la evidencia.
    }
    return File(x.path);
  }

  Future<void> _tomarFoto(ImageSource origen) async {
    final x = await ImagePicker().pickImage(
      source: origen,
      imageQuality: 100,   // la compresión la hace _preparar, no el picker
    );
    if (x == null) return;

    setState(() => _subiendo = true);
    final archivo = await _preparar(x);
    try {
      if (archivo == null) throw Exception('No se pudo preparar la foto');
      final inv = context.read<InventarioController>();
      final nueva = await inv.api
          .subirFoto(widget.activo.tipo, widget.activo.fid, archivo);
      if (!mounted) return;
      setState(() {
        _fotos = [...?_fotos, nueva];
        _subiendo = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => _subiendo = false);
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
        content: Text('No se pudo subir la foto. ¿Hay señal?'),
      ));
    }
  }

  // ── pantalla ──────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    final inv = context.watch<InventarioController>();
    final a = widget.activo;
    final ev = inv.evaluacionDe(a.tipo, a.fid);
    final filas = _caracteristicas(a.props);

    return Scaffold(
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Text(a.nombre,
                style: const TextStyle(
                    fontSize: 17, fontWeight: FontWeight.w800)),
            Text(widget.capa.label,
                style: const TextStyle(fontSize: 12, color: Colors.white70)),
          ],
        ),
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(14, 14, 14, 100),
        children: [
          if (ev != null) _TarjetaEvaluacion(ev: ev),
          if (ev != null) const SizedBox(height: 14),

          _Tarjeta(
            titulo: 'Características',
            hijo: filas.isEmpty
                ? const Text('La capa no trae datos de esta estructura.',
                    style: TextStyle(color: AppColors.gris))
                : Column(
                    children: [
                      for (final f in filas)
                        Padding(
                          padding: const EdgeInsets.symmetric(vertical: 5),
                          child: Row(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              SizedBox(
                                width: 132,
                                child: Text(f.$1,
                                    style: const TextStyle(
                                        fontSize: 13.5,
                                        color: AppColors.gris)),
                              ),
                              Expanded(
                                child: Text(f.$2,
                                    style: const TextStyle(
                                        fontSize: 14.5,
                                        fontWeight: FontWeight.w600,
                                        color: AppColors.tinta)),
                              ),
                            ],
                          ),
                        ),
                    ],
                  ),
          ),

          const SizedBox(height: 14),
          _Tarjeta(
            titulo: 'Fotos',
            hijo: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (_fotos == null)
                  const Padding(
                    padding: EdgeInsets.symmetric(vertical: 14),
                    child: Center(child: CircularProgressIndicator()),
                  )
                else if (_fotos!.isEmpty)
                  Text(
                    _falloFotos ??
                        'Sin fotos. La primera es la que más sirve: una '
                            'vista general de la estructura, con el canal '
                            'de fondo.',
                    style: const TextStyle(color: AppColors.gris),
                  )
                else
                  SizedBox(
                    height: 96,
                    child: ListView.separated(
                      scrollDirection: Axis.horizontal,
                      itemCount: _fotos!.length,
                      separatorBuilder: (_, __) => const SizedBox(width: 8),
                      itemBuilder: (_, i) => ClipRRect(
                        borderRadius: BorderRadius.circular(8),
                        child: Image.network(
                          _fotos![i].url,
                          width: 96,
                          height: 96,
                          fit: BoxFit.cover,
                          errorBuilder: (_, __, ___) => Container(
                            width: 96,
                            height: 96,
                            color: const Color(0xFFF1F6FB),
                            child: const Icon(Icons.broken_image_outlined,
                                color: AppColors.gris),
                          ),
                        ),
                      ),
                    ),
                  ),
                const SizedBox(height: 12),
                if (_subiendo)
                  const LinearProgressIndicator()
                else
                  Row(
                    children: [
                      Expanded(
                        child: OutlinedButton.icon(
                          onPressed: () => _tomarFoto(ImageSource.camera),
                          icon: const Icon(Icons.photo_camera_outlined),
                          label: const Text('Cámara'),
                        ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: OutlinedButton.icon(
                          onPressed: () => _tomarFoto(ImageSource.gallery),
                          icon: const Icon(Icons.photo_library_outlined),
                          label: const Text('Galería'),
                        ),
                      ),
                    ],
                  ),
              ],
            ),
          ),
        ],
      ),

      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(14, 8, 14, 12),
          child: ElevatedButton.icon(
            onPressed: () async {
              await Navigator.of(context).push(MaterialPageRoute(
                builder: (_) => EvaluacionPage(
                    activo: widget.activo, capa: widget.capa),
              ));
              if (mounted) setState(() {});
            },
            icon: Icon(ev == null ? Icons.fact_check_outlined : Icons.edit),
            label:
                Text(ev == null ? 'EVALUAR' : 'CORREGIR LA EVALUACIÓN'),
          ),
        ),
      ),
    );
  }
}

/* ── características ─────────────────────────────────────────────────────
   Qué se enseña y en qué orden. Primero lo que identifica la estructura,
   después dónde está, después cómo es, y al final lo que sobra. Lo que no
   esté en la lista va después, alfabético: así una columna nueva en la capa
   aparece sola, aunque sea al final. */

const _ocultos = {
  'fid', 'id', 'pk', 'gid', 'objectid', 'geom', 'geometry', 'the_geom',
  'shape_length', 'shape_area', 'st_length', 'st_area', 'tipo_activo',
};

const _orden = [
  'codigo', 'nombre', 'tipo', 'clase', 'subtipo',
  'nombre_canal', 'canal', 'progresiva', 'margen', 'sector', 'comision',
  'bloque', 'lateral', 'altitud', 'este', 'norte', 'ambito',
  'material', 'estado', 'luz', 'diametro', 'ancho', 'alto', 'largo',
  'longitud', 'seccion', 'capacidad', 'caudal', 'num_hojas',
  'num_compuertas', 'tipo_compuerta', 'accionamiento', 'revestimiento',
  'ano_construccion', 'num_usuarios', 'area_total', 'area_bajo_riego',
  'predios', 'observaciones',
];

/// Unidades que no vienen en el dato y sin las cuales el número miente.
const _unidad = {
  'area_total': 'ha', 'area_bajo_riego': 'ha', 'altitud': 'm s. n. m.',
  'longitud': 'm', 'ancho': 'm', 'alto': 'm', 'largo': 'm', 'luz': 'm',
  'diametro': 'm', 'caudal': 'm³/s', 'capacidad': 'm³', 'seccion': 'm²',
  'este': 'm', 'norte': 'm',
};

String _etiqueta(String clave) {
  final t = clave.replaceAll('_', ' ').trim();
  return t.isEmpty ? clave : t[0].toUpperCase() + t.substring(1);
}

/// Un valor en texto, o null si no hay nada que enseñar.
///
/// Vacío, null y la cadena 'None' que a veces llega de Django son lo mismo:
/// no se sabe. Y un campo que no se sabe no ocupa una fila, porque una tabla
/// llena de guiones no se lee.
///
/// OJO con el cero y con false: SÍ son datos. «0 usuarios» dice algo muy
/// distinto de «no se sabe cuántos usuarios».
String? _valor(String clave, dynamic v) {
  if (v == null) return null;
  if (v is bool) return v ? 'Sí' : 'No';
  if (v is num) {
    final n = v == v.roundToDouble() ? v.toInt().toString() : '$v';
    return _unidad[clave] == null ? n : '$n ${_unidad[clave]}';
  }
  final s = '$v'.trim();
  if (s.isEmpty) return null;
  final b = s.toLowerCase();
  if (b == 'none' || b == 'null') return null;
  if (b == 'true') return 'Sí';
  if (b == 'false') return 'No';
  return _unidad[clave] != null && double.tryParse(s) != null
      ? '$s ${_unidad[clave]}'
      : s;
}

List<(String, String)> _caracteristicas(Map<String, dynamic> props) {
  final filas = <(String, String, int)>[];
  props.forEach((k, v) {
    if (_ocultos.contains(k)) return;
    final txt = _valor(k, v);
    if (txt == null) return;
    final i = _orden.indexOf(k);
    filas.add((_etiqueta(k), txt, i < 0 ? _orden.length : i));
  });
  filas.sort((a, b) => a.$3 != b.$3 ? a.$3.compareTo(b.$3) : a.$1.compareTo(b.$1));
  return [for (final f in filas) (f.$1, f.$2)];
}

/* ── piezas de la pantalla ───────────────────────────────────────────── */

class _Tarjeta extends StatelessWidget {
  final String titulo;
  final Widget hijo;
  const _Tarjeta({required this.titulo, required this.hijo});

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: Colors.white,
          border: Border.all(color: AppColors.borde),
          borderRadius: BorderRadius.circular(12),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(titulo.toUpperCase(),
                style: const TextStyle(
                    fontSize: 11,
                    letterSpacing: 0.7,
                    fontWeight: FontWeight.w800,
                    color: AppColors.gris)),
            const SizedBox(height: 10),
            hijo,
          ],
        ),
      );
}

class _TarjetaEvaluacion extends StatelessWidget {
  final Evaluacion ev;
  const _TarjetaEvaluacion({required this.ev});

  @override
  Widget build(BuildContext context) {
    final color = AppColors.deEstado(ev.estadoCons);
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.white,
        border: Border.all(color: AppColors.borde),
        borderRadius: BorderRadius.circular(12),
      ),
      // La franja de color es el dato de un vistazo: en campo muchas veces
      // solo se quiere saber «¿esta ya está, y cómo quedó?».
      child: Row(
        children: [
          Container(width: 6, height: 44, color: color),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Evaluada · ${AppColors.nombresEstado[ev.estadoCons] ?? 'sin estado'}',
                  style: const TextStyle(
                      fontWeight: FontWeight.w800, color: AppColors.tinta),
                ),
                if ((ev.evaluador ?? '').isNotEmpty)
                  Text('por ${ev.evaluador}',
                      style: const TextStyle(
                          fontSize: 12.5, color: AppColors.gris)),
                if (ev.requiereMant)
                  const Padding(
                    padding: EdgeInsets.only(top: 4),
                    child: Text('Requiere mantenimiento',
                        style: TextStyle(
                            fontSize: 12.5,
                            fontWeight: FontWeight.w700,
                            color: Color(0xFFD9480F))),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
