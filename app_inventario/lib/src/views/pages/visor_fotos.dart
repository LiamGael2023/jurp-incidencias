import 'package:flutter/material.dart';

import '../../models/modelos.dart';

/// Ver una foto a pantalla completa.
///
/// POR QUÉ A PANTALLA COMPLETA Y CON ZOOM. La miniatura de 96 px sirve para
/// saber que la foto está, no para mirarla: lo que el inspector fotografía
/// es una grieta, un sedimento, una compuerta torcida, y eso no se ve en un
/// cuadradito. Quien abre una foto del inventario la abre para mirarla de
/// cerca, así que se puede ampliar con los dedos hasta cinco aumentos.
///
/// Y se pasa de una a otra deslizando, sin volver atrás: las fotos de una
/// estructura se miran en serie —general, detalle, entorno— y salir y
/// entrar tres veces para ver tres fotos es el tipo de roce que hace que al
/// final nadie las mire.
class VisorFotos extends StatefulWidget {
  final List<Foto> fotos;
  final int inicial;

  /// Borra en el servidor. Devuelve el motivo del fallo, o null si fue
  /// bien. Lo hace quien llama porque es quien tiene el servicio; el visor
  /// solo pregunta y refleja el resultado.
  final Future<String?> Function(Foto)? onBorrar;

  const VisorFotos({
    super.key,
    required this.fotos,
    this.inicial = 0,
    this.onBorrar,
  });

  @override
  State<VisorFotos> createState() => _VisorFotosState();
}

class _VisorFotosState extends State<VisorFotos> {
  late final PageController _paginas =
      PageController(initialPage: widget.inicial);
  late List<Foto> _fotos = [...widget.fotos];
  late int _actual = widget.inicial;
  bool _borrando = false;

  @override
  void dispose() {
    _paginas.dispose();
    super.dispose();
  }

  Future<void> _borrar() async {
    final foto = _fotos[_actual];

    final confirma = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('¿Borrar esta foto?'),
        content: const Text('No se puede deshacer.'),
        actions: [
          // Conservar primero y a la derecha el borrar: el gesto por
          // inercia es pulsar lo de la izquierda, y por inercia no se
          // borra una evidencia de campo.
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Conservar'),
          ),
          TextButton(
            onPressed: () => Navigator.of(context).pop(true),
            style: TextButton.styleFrom(
                foregroundColor: const Color(0xFFC92A2A)),
            child: const Text('Borrar'),
          ),
        ],
      ),
    );
    if (confirma != true || widget.onBorrar == null) return;

    setState(() => _borrando = true);
    final fallo = await widget.onBorrar!(foto);
    if (!mounted) return;

    if (fallo != null) {
      setState(() => _borrando = false);
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(fallo)));
      return;
    }

    setState(() {
      _fotos.removeAt(_actual);
      _borrando = false;
      if (_actual >= _fotos.length) _actual = _fotos.length - 1;
    });
    if (_fotos.isEmpty && mounted) Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    if (_fotos.isEmpty) return const SizedBox.shrink();

    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        backgroundColor: Colors.black54,
        foregroundColor: Colors.white,
        elevation: 0,
        title: Text('${_actual + 1} de ${_fotos.length}',
            style: const TextStyle(fontSize: 15)),
        actions: [
          if (widget.onBorrar != null)
            IconButton(
              tooltip: 'Borrar',
              icon: _borrando
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(
                          strokeWidth: 2.2, color: Colors.white))
                  : const Icon(Icons.delete_outline),
              onPressed: _borrando ? null : _borrar,
            ),
        ],
      ),
      body: PageView.builder(
        controller: _paginas,
        itemCount: _fotos.length,
        onPageChanged: (i) => setState(() => _actual = i),
        itemBuilder: (_, i) => InteractiveViewer(
          minScale: 1,
          maxScale: 5,
          child: Center(
            child: Image.network(
              _fotos[i].url,
              fit: BoxFit.contain,
              // Una foto de campo son varios cientos de kilobytes y la red
              // de campo es la que es: sin esto, la pantalla se queda negra
              // y parece que no funcionó.
              loadingBuilder: (_, hijo, progreso) {
                if (progreso == null) return hijo;
                final total = progreso.expectedTotalBytes;
                return Center(
                  child: CircularProgressIndicator(
                    color: Colors.white,
                    value: total == null
                        ? null
                        : progreso.cumulativeBytesLoaded / total,
                  ),
                );
              },
              errorBuilder: (_, __, ___) => const Padding(
                padding: EdgeInsets.all(28),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(Icons.broken_image_outlined,
                        color: Colors.white38, size: 46),
                    SizedBox(height: 12),
                    Text(
                      'No se pudo cargar la imagen.\n'
                      'El registro está, pero el archivo no llegó.',
                      textAlign: TextAlign.center,
                      style: TextStyle(color: Colors.white70),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
      bottomNavigationBar: (_fotos[_actual].descripcion).isEmpty
          ? null
          : Container(
              color: Colors.black54,
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
              width: double.infinity,
              child: Text(
                _fotos[_actual].descripcion,
                style: const TextStyle(color: Colors.white, fontSize: 13.5),
              ),
            ),
    );
  }
}
