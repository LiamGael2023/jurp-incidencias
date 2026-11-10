import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';
import 'package:latlong2/latlong.dart';
import 'package:provider/provider.dart';

import '../../controllers/inventario_controller.dart';
import '../../services/auth_service.dart';
import '../../utils/app_colors.dart';
import '../../utils/app_theme.dart';
import '../../utils/catalogo_capas.dart';
import '../../utils/utm.dart';
import '../widgets/simbolo_capa.dart';

/// Dar de alta una estructura que la capa no tenía.
///
/// EL PUNTO SALE DEL GPS, NO DE TOCAR EL MAPA, al revés que en el visor
/// web. Son dos situaciones distintas: en la oficina se marca sobre la
/// ortofoto porque se está mirando dónde debería ir; en campo el inspector
/// está parado delante de la obra, y el sitio exacto lo sabe el teléfono
/// mejor que su dedo sobre una pantalla de cinco pulgadas a pleno sol.
/// Se puede volver a tomar tantas veces como haga falta, y se enseña la
/// precisión para que quien firme sepa con qué se quedó.
///
/// EL ALTA NO ENTRA EN LA CAPA. Queda pendiente de que alguien la apruebe
/// desde el visor web, y la pantalla lo dice antes de guardar: un apunte de
/// campo no puede volverse dato oficial sin que nadie lo mire, porque el
/// inventario es lo que la Junta reporta al ANA.
///
/// SIN FOTO, DE MOMENTO. El almacén de fotos cuelga de una estructura que
/// ya existe (`tipo_activo` + `fid`) y un alta todavía no tiene fid. Antes
/// que inventar aquí una ruta que el servidor no tiene —y que fallaría en
/// el cerro, que es donde se usa—, el alta se guarda sin foto y las fotos
/// se añaden en cuanto se aprueba y la estructura existe. La descripción
/// está para lo que la foto habría contado.
class AltaPage extends StatefulWidget {
  /// Si se entra desde una capa concreta, ya viene elegida.
  final String? tipoInicial;

  const AltaPage({super.key, this.tipoInicial});

  @override
  State<AltaPage> createState() => _AltaPageState();
}

class _AltaPageState extends State<AltaPage> {
  String? _tipo;
  final _nombre = TextEditingController();
  final _descripcion = TextEditingController();

  LatLng? _punto;
  double? _precision;
  DateTime? _tomado;
  bool _vieja = false;       // la posición es la última conocida, no una nueva

  bool _buscando = false;
  bool _guardando = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _tipo = widget.tipoInicial;
    // El GPS tarda, así que se pide nada más abrir: cuando el inspector
    // termine de elegir el tipo y escribir el nombre, el punto ya está.
    _tomarPunto();
  }

  @override
  void dispose() {
    _nombre.dispose();
    _descripcion.dispose();
    super.dispose();
  }

  void _avisar(String texto, {String? accion, VoidCallback? onAccion}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      content: Text(texto),
      duration: const Duration(seconds: 6),
      action: accion == null
          ? null
          : SnackBarAction(label: accion, onPressed: onAccion ?? () {}),
    ));
  }

  /// Toma la posición. Cada fallo se dice por su nombre: «no se pudo
  /// obtener la ubicación» vale para cinco cosas distintas y cada una se
  /// arregla de otra manera, y en el cerro uno se queda tocando el botón
  /// sin saber qué mirar.
  Future<void> _tomarPunto() async {
    if (_buscando) return;
    setState(() => _buscando = true);
    try {
      if (!await Geolocator.isLocationServiceEnabled()) {
        _avisar('La ubicación del teléfono está apagada.',
            accion: 'Activar', onAccion: Geolocator.openLocationSettings);
        return;
      }

      var permiso = await Geolocator.checkPermission();
      if (permiso == LocationPermission.denied) {
        permiso = await Geolocator.requestPermission();
      }
      if (permiso == LocationPermission.deniedForever) {
        _avisar('Negaste el permiso de ubicación para siempre.',
            accion: 'Ajustes', onAccion: Geolocator.openAppSettings);
        return;
      }
      if (permiso == LocationPermission.denied) {
        _avisar('Sin permiso de ubicación no puedo situar la estructura.');
        return;
      }

      // Veinte segundos y no quince: aquí la posición no es para centrar un
      // mapa, es la coordenada que queda registrada. Merece esperar un poco
      // más a que el aparato afine.
      Position? p;
      var vieja = false;
      try {
        p = await Geolocator.getCurrentPosition(
          desiredAccuracy: LocationAccuracy.best,
          timeLimit: const Duration(seconds: 20),
        );
      } catch (_) {
        p = await Geolocator.getLastKnownPosition();
        vieja = p != null;
      }

      if (p == null) {
        _avisar('El GPS todavía no fija satélites. Sal a cielo abierto y '
            'vuelve a intentarlo.');
        return;
      }

      if (!mounted) return;
      // En una copia final: dentro del closure de setState, Dart no arrastra
      // la promoción de una variable local, y `p` volvería a ser nullable.
      final pos = p;
      setState(() {
        _punto = LatLng(pos.latitude, pos.longitude);
        _precision = pos.accuracy;
        _tomado = DateTime.now();
        _vieja = vieja;
      });
      if (vieja) {
        _avisar('Es la última posición conocida, no una nueva. '
            'Vuelve a tomarla cuando el GPS fije.');
      }
    } finally {
      if (mounted) setState(() => _buscando = false);
    }
  }

  Future<void> _guardar() async {
    final tipo = _tipo;
    final punto = _punto;
    if (tipo == null) {
      setState(() => _error = 'Elige qué tipo de estructura es.');
      return;
    }
    if (punto == null) {
      setState(() => _error = 'Falta la ubicación: toma el punto con el GPS.');
      return;
    }

    setState(() {
      _guardando = true;
      _error = null;
    });

    final inv = context.read<InventarioController>();
    final navegador = Navigator.of(context);
    try {
      // Quién la registró sale de la sesión y no de un campo que rellenar:
      // en campo, un campo más es un campo que se deja en blanco, y luego
      // no hay a quién preguntarle qué vio.
      final quien = await AuthService().nombre;
      final subio = await inv.guardarAlta(
        tipoActivo: tipo,
        lat: punto.latitude,
        lng: punto.longitude,
        nombre: _nombre.text,
        descripcion: _descripcion.text,
        registradoPor: quien,
      );
      if (!mounted) return;
      navegador.pop(true);
      // El aviso lo da la pantalla de atrás, que es la que sigue viva.
      ScaffoldMessenger.of(navegador.context).showSnackBar(SnackBar(
        content: Text(subio
            ? 'Alta registrada. Queda pendiente de validación.'
            : 'Sin señal: el alta quedó en la bandeja. TODAVÍA NO está '
                'en el servidor.'),
        backgroundColor:
            subio ? AppColors.verdeOscuro : const Color(0xFFD9480F),
        duration: const Duration(seconds: 6),
      ));
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _guardando = false;
        _error = e.toString().replaceFirst('Exception: ', '');
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final List<Capa> tipos = InventarioController.tiposConAlta;
    final punto = _punto;
    final utm = punto == null
        ? null
        : latLngAUTM(punto.latitude, punto.longitude);

    return Scaffold(
      appBar: AppBar(title: const Text('Estructura nueva')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(14, 14, 14, 110),
        children: [
          // ── dónde ──
          Container(
            padding: const EdgeInsets.all(14),
            decoration: AppTheme.tarjeta,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Icon(
                      punto == null
                          ? Icons.gps_not_fixed
                          : (_vieja ? Icons.gps_not_fixed : Icons.gps_fixed),
                      size: 18,
                      color: punto == null || _vieja
                          ? AppColors.gris
                          : AppColors.verde,
                    ),
                    const SizedBox(width: 8),
                    const Text('Ubicación',
                        style: TextStyle(
                            fontWeight: FontWeight.w800, fontSize: 14.5)),
                    const Spacer(),
                    if (_buscando)
                      const SizedBox(
                          width: 18,
                          height: 18,
                          child: CircularProgressIndicator(strokeWidth: 2.2))
                    else
                      TextButton.icon(
                        onPressed: _tomarPunto,
                        icon: const Icon(Icons.my_location, size: 16),
                        label: Text(punto == null ? 'Tomar' : 'Volver a tomar'),
                      ),
                  ],
                ),
                const SizedBox(height: 6),
                if (punto == null)
                  Text(
                    _buscando
                        ? 'Fijando satélites…'
                        : 'Todavía sin punto. Ponte junto a la estructura y '
                            'toma la ubicación.',
                    style: const TextStyle(
                        fontSize: 13, color: AppColors.gris, height: 1.35),
                  )
                else ...[
                  // Se enseñan las dos: grados porque es lo que se pega en
                  // un WhatsApp o en Google Maps, y UTM porque es como se
                  // reporta y como está la capa.
                  SelectableText(
                    '${punto.latitude.toStringAsFixed(6)}, '
                    '${punto.longitude.toStringAsFixed(6)}',
                    style: const TextStyle(
                        fontSize: 14, fontWeight: FontWeight.w600),
                  ),
                  const SizedBox(height: 2),
                  SelectableText('$utm',
                      style: const TextStyle(
                          fontSize: 12.5, color: AppColors.gris)),
                  const SizedBox(height: 8),
                  _Precision(
                      metros: _precision, vieja: _vieja, cuando: _tomado),
                ],
              ],
            ),
          ),
          const SizedBox(height: 14),

          // ── qué ──
          Container(
            padding: const EdgeInsets.all(14),
            decoration: AppTheme.tarjeta,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('Qué es',
                    style: TextStyle(
                        fontWeight: FontWeight.w800, fontSize: 14.5)),
                const SizedBox(height: 10),
                DropdownButtonFormField<String>(
                  value: _tipo,
                  isExpanded: true,
                  decoration: const InputDecoration(
                      labelText: 'Tipo de estructura'),
                  items: [
                    for (final c in tipos)
                      DropdownMenuItem(
                        value: c.codigo,
                        child: Row(
                          children: [
                            SimboloCapa(capa: c, lado: 18),
                            const SizedBox(width: 8),
                            Flexible(
                              child: Text(c.label,
                                  overflow: TextOverflow.ellipsis),
                            ),
                          ],
                        ),
                      ),
                  ],
                  onChanged: _guardando
                      ? null
                      : (v) => setState(() {
                            _tipo = v;
                            _error = null;
                          }),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _nombre,
                  textCapitalization: TextCapitalization.characters,
                  decoration: const InputDecoration(
                    labelText: 'Código o nombre',
                    hintText: 'C-14, Toma 23…',
                    helperText: 'Si la obra lleva un código pintado, ese.',
                  ),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _descripcion,
                  maxLines: 4,
                  textCapitalization: TextCapitalization.sentences,
                  decoration: const InputDecoration(
                    labelText: 'Descripción',
                    alignLabelWithHint: true,
                    hintText: 'Cómo es, en qué estado está, junto a qué '
                        'está, por dónde se llega…',
                  ),
                ),
              ],
            ),
          ),

          const SizedBox(height: 14),
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: const Color(0xFFF1F6FC),
              border: Border.all(color: AppColors.borde),
              borderRadius: BorderRadius.circular(10),
            ),
            child: const Text(
              'El alta NO entra en el inventario al guardarla: queda '
              'pendiente de que la revisen desde la oficina. Las fotos se '
              'añaden cuando se apruebe y la estructura exista.',
              style: TextStyle(
                  fontSize: 12.5, color: AppColors.gris, height: 1.4),
            ),
          ),

          if (_error != null) ...[
            const SizedBox(height: 12),
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: const Color(0xFFFEF2F2),
                border: Border.all(color: const Color(0xFFFECACA)),
                borderRadius: BorderRadius.circular(10),
              ),
              child: Text(_error!,
                  style: const TextStyle(color: Color(0xFFB91C1C))),
            ),
          ],
        ],
      ),

      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(14, 8, 14, 12),
          child: ElevatedButton.icon(
            onPressed: _guardando ? null : _guardar,
            icon: _guardando
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(
                        strokeWidth: 2.2, color: Colors.white))
                : const Icon(Icons.add_location_alt_outlined),
            label: Text(_guardando ? 'GUARDANDO…' : 'REGISTRAR EL ALTA'),
          ),
        ),
      ),
    );
  }
}

/// Qué tan buena es la posición, en palabras.
///
/// «±4 m» no le dice nada a casi nadie y «precisión 23.8» menos todavía. Lo
/// que importa es si vale para clavar una estructura o si conviene esperar
/// un poco, así que eso es lo que se escribe.
class _Precision extends StatelessWidget {
  final double? metros;
  final bool vieja;
  final DateTime? cuando;

  const _Precision({this.metros, this.vieja = false, this.cuando});

  @override
  Widget build(BuildContext context) {
    final m = metros;
    final (texto, color) = switch (m) {
      null => ('Sin dato de precisión', AppColors.gris),
      _ when vieja => ('Posición anterior, no tomada ahora', AppColors.estados['M']!),
      _ when m <= 8 => ('Buena: ±${m.round()} m', AppColors.estados['B']!),
      _ when m <= 20 => ('Aceptable: ±${m.round()} m', AppColors.estados['R']!),
      _ => ('Floja: ±${m.round()} m — espera a que afine', AppColors.estados['M']!),
    };

    final c = cuando;
    String dos(int n) => n.toString().padLeft(2, '0');

    return Row(
      children: [
        Container(
          width: 8,
          height: 8,
          decoration: BoxDecoration(color: color, shape: BoxShape.circle),
        ),
        const SizedBox(width: 7),
        Expanded(
          child: Text(texto,
              style: TextStyle(
                  fontSize: 12.5, color: color, fontWeight: FontWeight.w600)),
        ),
        // La hora de la toma: si el inspector anduvo un rato antes de
        // guardar, el punto es de donde estaba entonces, no de donde está.
        if (c != null)
          Text('${dos(c.hour)}:${dos(c.minute)}',
              style: const TextStyle(fontSize: 12, color: AppColors.gris)),
      ],
    );
  }
}
