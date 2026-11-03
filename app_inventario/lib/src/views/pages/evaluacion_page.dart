import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_image_compress/flutter_image_compress.dart';
import 'package:image_picker/image_picker.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'package:provider/provider.dart';

import '../../controllers/inventario_controller.dart';
import '../../models/modelos.dart';
import '../../services/inventario_service.dart';
import '../../services/auth_service.dart';
import '../../utils/app_colors.dart';
import '../../utils/app_theme.dart';
import '../../utils/catalogo_capas.dart';
import '../../utils/croquis.dart';

/// El formulario de evaluación.
///
/// NO ESTÁ ESCRITO AQUÍ: los campos los devuelve el servidor
/// (/campos-evaluables/?tipo_activo=…), con sus opciones ya resueltas. Un
/// campo nuevo en la base aparece en el teléfono sin publicar versión en la
/// tienda, que es la diferencia entre un cambio de una tarde y uno de dos
/// semanas de espera en revisión.
///
/// Los bloques salen de la propia etiqueta, antes del separador ' · ': la
/// ficha de papel va por componentes (Ingreso, Compuerta, Salida…) y una
/// ficha del ANA llega a setenta campos. En una sola lista, en un teléfono,
/// eso no se llena.
class EvaluacionPage extends StatefulWidget {
  final Activo activo;
  final Capa capa;

  const EvaluacionPage({super.key, required this.activo, required this.capa});

  @override
  State<EvaluacionPage> createState() => _EvaluacionPageState();
}

class _EvaluacionPageState extends State<EvaluacionPage> {
  List<CampoEvaluable>? _campos;
  String? _fallo;

  final Map<String, dynamic> _valores = {};
  final Map<String, bool> _cerrados = {};

  final _evaluador = TextEditingController();
  final _observaciones = TextEditingController();
  bool _requiereMant = false;
  String? _prioridad;

  final List<String> _fotosNuevas = [];
  bool _guardando = false;
  bool _senalar = false;

  List<Lamina> get _laminas => laminasDe(widget.activo.tipo);

  @override
  void initState() {
    super.initState();
    _cargar();
  }

  @override
  void dispose() {
    _evaluador.dispose();
    _observaciones.dispose();
    super.dispose();
  }

  Future<void> _cargar() async {
    final inv = context.read<InventarioController>();
    try {
      final campos = await inv.api.campos(widget.activo.tipo);
      final previa =
          inv.evaluacionDe(widget.activo.tipo, widget.activo.fid);

      // Al abrir se precarga con lo que ya hay: la evaluación anterior si
      // existe y, si no, el dato que trae el inventario. El técnico confirma
      // o corrige, en vez de escribir setenta campos de cero.
      for (final c in campos) {
        final dePrevia = previa?.valores[c.campo];
        final deBase = widget.activo.props[c.campo];
        _valores[c.campo] = dePrevia ?? deBase;
      }

      _evaluador.text = previa?.evaluador ?? await AuthService().nombre;
      _observaciones.text = previa?.observaciones ?? '';
      _requiereMant = previa?.requiereMant ?? false;
      _prioridad = previa?.prioridad;

      // Todos los bloques cerrados menos el general: con diez bloques
      // abiertos de golpe no se ve dónde empieza nada.
      for (final c in campos) {
        if (c.bloque.isNotEmpty) _cerrados[c.bloque] = true;
      }

      if (mounted) setState(() => _campos = campos);
    } catch (e) {
      if (mounted) {
        setState(() =>
            _fallo = 'No se pudo cargar el formulario. ${_motivo(e)}');
      }
    }
  }

  String _motivo(Object e) =>
      e.toString().replaceFirst('Exception: ', '').trim();

  /* ── qué campos se ven ────────────────────────────────────────────────
     Dos reglas, las dos tomadas de cómo se llena la ficha de papel:

       1. El detalle de una pregunta de inspección solo tiene sentido si la
          respuesta fue «Sí». Preguntar «¿está obstruida?» → No y acto
          seguido pedir el detalle de la obstrucción es pedir que se deje
          en blanco.
       2. Un bloque que empieza por «¿cuenta con…?» respondido No no
          necesita material, estado ni dimensiones.

     Solo esconde con un No explícito: sin responder, el campo sigue a la
     vista. */
  bool _oculto(CampoEvaluable c) {
    final n = c.campo;
    if (n.startsWith('insp_') && n.endsWith('_c')) {
      return _valores[n.substring(0, n.length - 2)] != 'S';
    }
    final partes = n.split('_');
    for (var i = 1; i < partes.length; i++) {
      final padre = '${partes.take(i).join('_')}_hay';
      if (padre != n && _valores[padre] == 'N') return true;
    }
    return false;
  }

  bool _vacio(CampoEvaluable c) {
    final v = _valores[c.campo];
    return v == null || '$v'.trim().isEmpty;
  }

  List<CampoEvaluable> get _visibles =>
      [for (final c in _campos ?? const <CampoEvaluable>[]) if (!_oculto(c)) c];

  List<CampoEvaluable> get _faltan =>
      [for (final c in _visibles) if (c.obligatorio && _vacio(c)) c];

  /// Los bloques en el orden en que llegaron, sin repetir.
  List<String> get _bloques {
    final out = <String>[];
    for (final c in _visibles) {
      if (!out.contains(c.bloque)) out.add(c.bloque);
    }
    return out;
  }

  // ── fotos ─────────────────────────────────────────────────────────────

  Future<void> _agregarFoto(ImageSource origen) async {
    final x = await ImagePicker().pickImage(source: origen, imageQuality: 100);
    if (x == null) return;
    try {
      final dir = await getTemporaryDirectory();
      final destino = p.join(
          dir.path, 'ev_${DateTime.now().millisecondsSinceEpoch}.jpg');
      final salida = await FlutterImageCompress.compressAndGetFile(
          x.path, destino, quality: 82, minWidth: 1600, minHeight: 1600);
      setState(() => _fotosNuevas.add(salida?.path ?? x.path));
    } catch (_) {
      setState(() => _fotosNuevas.add(x.path));
    }
  }

  // ── guardar ───────────────────────────────────────────────────────────

  Future<void> _guardar() async {
    final faltan = _faltan;
    if (faltan.isNotEmpty) {
      setState(() {
        _senalar = true;
        // Se abren los bloques que contienen lo que falta: si no, el aviso
        // manda a buscar a mano por bloques cerrados.
        for (final c in faltan) {
          if (c.bloque.isNotEmpty) _cerrados[c.bloque] = false;
        }
      });
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text(faltan.length == 1
            ? 'Falta un campo obligatorio, marcado en rojo.'
            : 'Faltan ${faltan.length} campos obligatorios, marcados en rojo.'),
      ));
      return;
    }

    setState(() => _guardando = true);

    final inv = context.read<InventarioController>();
    final previa = inv.evaluacionDe(widget.activo.tipo, widget.activo.fid);

    // Un campo que el formulario escondió no se envía: si el técnico dijo
    // que no hay canal de salida, un material tecleado antes de cambiar de
    // respuesta quedaría guardado contradiciendo al propio dato.
    final limpios = <String, dynamic>{};
    for (final c in _visibles) {
      final v = _valores[c.campo];
      if (v == null || '$v'.trim().isEmpty) continue;
      limpios[c.campo] =
          c.esNumero ? (num.tryParse('$v'.replaceAll(',', '.')) ?? v) : v;
    }

    final ev = Evaluacion(
      id: previa?.id,
      tipoActivo: widget.activo.tipo,
      activoFid: widget.activo.fid,
      valores: limpios,
      // Se replican fuera del JSON para poder filtrar sin abrirlo.
      estadoCons: limpios['estado']?.toString(),
      condicion: limpios['observacio']?.toString(),
      evaluador: _evaluador.text.trim().isEmpty ? null : _evaluador.text.trim(),
      observaciones: _observaciones.text.trim().isEmpty
          ? null
          : _observaciones.text.trim(),
      requiereMant: _requiereMant,
      prioridad: _requiereMant ? _prioridad : null,
    );

    bool subio;
    var sinAlmacen = false;
    final fotosPendientes = <String>[];
    try {
      subio = await inv.guardar(
        tipo: widget.activo.tipo,
        fid: widget.activo.fid,
        nombre: widget.activo.nombre,
        ev: ev,
        fotos: _fotosNuevas,
      );

      if (subio) {
        for (final ruta in _fotosNuevas) {
          try {
            await inv.api.subirFoto(
                widget.activo.tipo, widget.activo.fid, File(ruta));
          } on SinEndpoint {
            // Este servidor no tiene almacen de fotos. Apuntarlas como
            // pendientes seria prometer que se subiran algun dia: no hay a
            // donde. Se dice una vez y se deja de intentar.
            sinAlmacen = true;
            break;
          } catch (_) {
            fotosPendientes.add(ruta);
          }
        }
      }
    } catch (e) {
      if (!mounted) return;
      setState(() => _guardando = false);
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(_motivo(e))));
      return;
    }

    if (!mounted) return;
    setState(() => _guardando = false);

    // SE DICE LA VERDAD. Una ficha en la bandeja no está guardada, y el
    // peor resultado posible de una cola de pendientes es que el inspector
    // crea que ya subió y borre sus fotos.
    final String mensaje;
    if (!subio) {
      mensaje = 'Sin señal: la ficha quedó PENDIENTE de subir. Está '
          'guardada en el teléfono, súbela cuando tengas cobertura.';
    } else if (sinAlmacen) {
      mensaje = 'Evaluación guardada. Las fotos no: este servidor todavía '
          'no guarda fotos de activos.';
    } else if (fotosPendientes.isNotEmpty) {
      mensaje = 'Evaluación guardada; ${fotosPendientes.length} foto(s) no '
          'subieron. Vuelve a intentarlo desde la ficha.';
    } else {
      mensaje = 'Evaluación guardada.';
    }

    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      content: Text(mensaje),
      backgroundColor: subio ? AppColors.verdeOscuro : const Color(0xFFD9480F),
      duration: const Duration(seconds: 5),
    ));
    Navigator.of(context).pop();
  }

  // ── pantalla ──────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    final campos = _campos;
    final obligatorios =
        campos == null ? 0 : _visibles.where((c) => c.obligatorio).length;
    final faltan = campos == null ? 0 : _faltan.length;
    final laminas = _laminas;
    final sueltas = campos == null
        ? const <Lamina>[]
        : laminasSueltas(laminas, _bloques);

    return Scaffold(
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Text(widget.activo.nombre,
                style:
                    const TextStyle(fontSize: 17, fontWeight: FontWeight.w800)),
            Text(widget.capa.label,
                style: const TextStyle(fontSize: 12, color: Colors.white70)),
          ],
        ),
        bottom: obligatorios == 0
            ? null
            : PreferredSize(
                preferredSize: const Size.fromHeight(34),
                child: _Avance(hechos: obligatorios - faltan, total: obligatorios),
              ),
      ),

      body: campos == null
          ? Center(
              child: _fallo == null
                  ? const CircularProgressIndicator()
                  : Padding(
                      padding: const EdgeInsets.all(24),
                      child: Text(_fallo!, textAlign: TextAlign.center),
                    ),
            )
          : ListView(
              padding: const EdgeInsets.fromLTRB(14, 14, 14, 110),
              children: [
                // Los croquis de la estructura entera, antes de nada: es lo
                // primero que se mira en la ficha de papel.
                for (final l in sueltas) _Croquis(lamina: l),

                for (final b in _bloques) _bloque(b, laminas),

                const SizedBox(height: 18),
                _Rotulo('Registro'),
                TextField(
                  controller: _evaluador,
                  decoration: const InputDecoration(labelText: 'Evaluador'),
                ),
                const SizedBox(height: 12),
                SwitchListTile(
                  contentPadding: EdgeInsets.zero,
                  value: _requiereMant,
                  title: const Text('Requiere mantenimiento'),
                  onChanged: (v) => setState(() => _requiereMant = v),
                ),
                if (_requiereMant)
                  DropdownButtonFormField<String>(
                    value: _prioridad,
                    decoration: const InputDecoration(labelText: 'Prioridad'),
                    items: const [
                      DropdownMenuItem(value: 'alta', child: Text('Alta')),
                      DropdownMenuItem(value: 'media', child: Text('Media')),
                      DropdownMenuItem(value: 'baja', child: Text('Baja')),
                    ],
                    onChanged: (v) => setState(() => _prioridad = v),
                  ),
                const SizedBox(height: 12),
                TextField(
                  controller: _observaciones,
                  minLines: 3,
                  maxLines: 6,
                  decoration: const InputDecoration(
                    labelText: 'Observaciones',
                    hintText: 'Detalle de lo observado en campo',
                  ),
                ),

                const SizedBox(height: 18),
                _Rotulo('Evidencia fotográfica'),
                _TiraFotos(
                  rutas: _fotosNuevas,
                  onCamara: () => _agregarFoto(ImageSource.camera),
                  onGaleria: () => _agregarFoto(ImageSource.gallery),
                  onQuitar: (r) => setState(() => _fotosNuevas.remove(r)),
                ),
              ],
            ),

      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(14, 8, 14, 12),
          child: ElevatedButton(
            onPressed: _guardando || campos == null ? null : _guardar,
            child: _guardando
                ? const SizedBox(
                    height: 22,
                    width: 22,
                    child: CircularProgressIndicator(
                        strokeWidth: 2.4, color: Colors.white))
                : const Text('GUARDAR EVALUACIÓN'),
          ),
        ),
      ),
    );
  }

  Widget _bloque(String titulo, List<Lamina> laminas) {
    final dentro = [for (final c in _visibles) if (c.bloque == titulo) c];
    if (dentro.isEmpty) return const SizedBox.shrink();

    // El bloque general -sin título- va siempre abierto y arriba.
    final abierto = titulo.isEmpty || _cerrados[titulo] != true;
    final faltanAqui =
        dentro.where((c) => c.obligatorio && _vacio(c)).length;
    final croquis = laminaDeBloque(laminas, titulo);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (titulo.isNotEmpty)
          InkWell(
            onTap: () => setState(() => _cerrados[titulo] = abierto),
            child: Container(
              margin: const EdgeInsets.only(top: 12, bottom: 8),
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 13),
              decoration: BoxDecoration(
                color: abierto ? Colors.white : const Color(0xFFF1F6FB),
                borderRadius: BorderRadius.circular(AppTheme.radioChico),
                border: Border.all(
                    color: abierto ? AppColors.verde : AppColors.borde,
                    width: abierto ? 1.4 : 1),
                boxShadow: abierto ? AppTheme.sombraTarjeta : null,
              ),
              child: Row(
                children: [
                  Icon(abierto ? Icons.expand_more : Icons.chevron_right,
                      size: 20,
                      color: abierto ? AppColors.verdeOscuro : AppColors.gris),
                  const SizedBox(width: 6),
                  Expanded(
                    child: Text(titulo,
                        style: const TextStyle(
                            fontWeight: FontWeight.w800,
                            fontSize: 15,
                            color: AppColors.tinta)),
                  ),
                  // Qué hay dentro, sin tener que abrirlo.
                  Text('${dentro.length}',
                      style: const TextStyle(
                          fontSize: 12.5, color: AppColors.gris)),
                  const SizedBox(width: 8),
                  if (faltanAqui > 0)
                    Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 7, vertical: 2),
                      decoration: BoxDecoration(
                        color: const Color(0xFFD9480F),
                        borderRadius: BorderRadius.circular(9),
                      ),
                      child: Text('$faltanAqui',
                          style: const TextStyle(
                              color: Colors.white,
                              fontSize: 12,
                              fontWeight: FontWeight.w800)),
                    )
                  else
                    const Icon(Icons.check_circle,
                        size: 18, color: AppColors.verde),
                ],
              ),
            ),
          ),

        // En el papel el dibujo va al lado de las cotas que explica; aquí,
        // encima de ellas.
        if (abierto && croquis != null) _Croquis(lamina: croquis),

        if (abierto)
          for (final c in dentro)
            Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: _campo(c),
            ),
      ],
    );
  }

  Widget _campo(CampoEvaluable c) {
    final senalado = _senalar && c.obligatorio && _vacio(c);
    final etiqueta = c.corta + (c.obligatorio ? ' *' : '');

    InputDecoration deco([String? pista]) => InputDecoration(
          labelText: etiqueta,
          hintText: pista,
          errorText: senalado ? 'Obligatorio' : null,
        );

    switch (c.tipoDato) {
      case 'opcion':
        return DropdownButtonFormField<String>(
          value: c.opciones.any((o) => o.codigo == '${_valores[c.campo]}')
              ? '${_valores[c.campo]}'
              : null,
          isExpanded: true,
          decoration: deco(),
          items: [
            const DropdownMenuItem<String>(
                value: null, child: Text('— sin dato —')),
            for (final o in c.opciones)
              DropdownMenuItem(value: o.codigo, child: Text(o.etiqueta)),
          ],
          onChanged: (v) => setState(() => _valores[c.campo] = v),
        );

      case 'booleano':
        return SwitchListTile(
          contentPadding: EdgeInsets.zero,
          value: _valores[c.campo] == true,
          title: Text(etiqueta),
          onChanged: (v) => setState(() => _valores[c.campo] = v),
        );

      case 'numero':
      case 'entero':
        return TextFormField(
          initialValue: _valores[c.campo] == null ? '' : '${_valores[c.campo]}',
          keyboardType: TextInputType.numberWithOptions(
              decimal: c.tipoDato == 'numero'),
          decoration: deco(),
          onChanged: (v) => setState(() => _valores[c.campo] = v),
        );

      default:
        final largo = RegExp('detalle|observ', caseSensitive: false)
            .hasMatch(c.corta);
        return TextFormField(
          initialValue: _valores[c.campo] == null ? '' : '${_valores[c.campo]}',
          minLines: largo ? 2 : 1,
          maxLines: largo ? 5 : 1,
          decoration: deco(),
          onChanged: (v) => setState(() => _valores[c.campo] = v),
        );
    }
  }
}

/* ── piezas ──────────────────────────────────────────────────────────── */

/// Un croquis de la ficha, con su pie de cotas y un toque para verlo grande.
///
/// Lo de ampliar no es un adorno: en el teléfono la lámina cabe a unos 150
/// px de alto y a ese tamaño las cotas —b₁, h₂, Lt₁— no se leen. Mirarlas
/// de cerca es parte de llenar la ficha, igual que en el papel uno se acerca
/// el formato a los ojos.
class _Croquis extends StatelessWidget {
  final Lamina lamina;
  const _Croquis({required this.lamina});

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      decoration: AppTheme.tarjeta,
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          InkWell(
            onTap: () => showDialog(
              context: context,
              builder: (_) => _CroquisGrande(lamina: lamina),
            ),
            child: Padding(
              padding: const EdgeInsets.all(8),
              child: Image.asset(lamina.ruta,
                  height: 150, fit: BoxFit.contain),
            ),
          ),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.fromLTRB(11, 8, 11, 10),
            color: const Color(0xFFF8FBFE),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(lamina.titulo,
                    style: const TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w700,
                        color: Color(0xFF33506E))),
                const SizedBox(height: 2),
                Text(lamina.pie,
                    style:
                        const TextStyle(fontSize: 12, color: AppColors.gris)),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _CroquisGrande extends StatelessWidget {
  final Lamina lamina;
  const _CroquisGrande({required this.lamina});

  @override
  Widget build(BuildContext context) => Dialog(
        insetPadding: const EdgeInsets.all(12),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              title: Text(lamina.titulo,
                  style: const TextStyle(fontWeight: FontWeight.w700)),
              trailing: IconButton(
                icon: const Icon(Icons.close),
                onPressed: () => Navigator.of(context).pop(),
              ),
            ),
            Flexible(
              // Se puede ampliar con los dedos: algunas cotas están
              // impresas muy pequeñas en el formato original.
              child: InteractiveViewer(
                maxScale: 6,
                child: Image.asset(lamina.ruta, fit: BoxFit.contain),
              ),
            ),
            const SizedBox(height: 10),
          ],
        ),
      );
}

class _Avance extends StatelessWidget {
  final int hechos;
  final int total;
  const _Avance({required this.hechos, required this.total});

  @override
  Widget build(BuildContext context) {
    final faltan = total - hechos;
    return Container(
      color: Colors.white,
      padding: const EdgeInsets.fromLTRB(14, 7, 14, 7),
      child: Row(
        children: [
          Expanded(
            child: ClipRRect(
              borderRadius: BorderRadius.circular(4),
              child: LinearProgressIndicator(
                value: total == 0 ? 1 : hechos / total,
                minHeight: 7,
                backgroundColor: const Color(0xFFE6EEF7),
                valueColor: AlwaysStoppedAnimation(
                    faltan == 0 ? AppColors.verde : AppColors.azul),
              ),
            ),
          ),
          const SizedBox(width: 12),
          Text(
            faltan == 0 ? 'Obligatorios completos' : 'Faltan $faltan de $total',
            style: TextStyle(
                fontSize: 12.5,
                fontWeight: FontWeight.w700,
                color: faltan == 0 ? AppColors.verdeOscuro : AppColors.tinta),
          ),
        ],
      ),
    );
  }
}

class _Rotulo extends StatelessWidget {
  final String texto;
  const _Rotulo(this.texto);

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(bottom: 10),
        child: Text(texto.toUpperCase(),
            style: const TextStyle(
                fontSize: 11,
                letterSpacing: 0.8,
                fontWeight: FontWeight.w800,
                color: AppColors.gris)),
      );
}

class _TiraFotos extends StatelessWidget {
  final List<String> rutas;
  final VoidCallback onCamara;
  final VoidCallback onGaleria;
  final void Function(String) onQuitar;

  const _TiraFotos({
    required this.rutas,
    required this.onCamara,
    required this.onGaleria,
    required this.onQuitar,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (rutas.isNotEmpty)
          SizedBox(
            height: 92,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              itemCount: rutas.length,
              separatorBuilder: (_, __) => const SizedBox(width: 8),
              itemBuilder: (_, i) => Stack(
                children: [
                  ClipRRect(
                    borderRadius: BorderRadius.circular(8),
                    child: Image.file(File(rutas[i]),
                        width: 92, height: 92, fit: BoxFit.cover),
                  ),
                  Positioned(
                    right: 2,
                    top: 2,
                    child: InkWell(
                      onTap: () => onQuitar(rutas[i]),
                      child: Container(
                        padding: const EdgeInsets.all(3),
                        decoration: const BoxDecoration(
                            color: Colors.black54, shape: BoxShape.circle),
                        child: const Icon(Icons.close,
                            size: 14, color: Colors.white),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        if (rutas.isNotEmpty) const SizedBox(height: 10),
        Row(
          children: [
            Expanded(
              child: OutlinedButton.icon(
                onPressed: onCamara,
                icon: const Icon(Icons.photo_camera_outlined),
                label: const Text('Cámara'),
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: OutlinedButton.icon(
                onPressed: onGaleria,
                icon: const Icon(Icons.photo_library_outlined),
                label: const Text('Galería'),
              ),
            ),
          ],
        ),
        const Padding(
          padding: EdgeInsets.only(top: 8),
          child: Text(
            'Las fotos se suben al guardar. Si no hay señal, quedan en la '
            'bandeja junto con la ficha.',
            style: TextStyle(fontSize: 12, color: AppColors.gris),
          ),
        ),
      ],
    );
  }
}
