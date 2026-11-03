import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:geolocator/geolocator.dart';
import 'package:latlong2/latlong.dart';
import 'package:provider/provider.dart';

import '../../controllers/inventario_controller.dart';
import '../../models/modelos.dart';
import '../../services/auth_service.dart';
import '../../utils/app_colors.dart';
import '../../utils/app_theme.dart';
import '../../utils/catalogo_capas.dart';
import '../widgets/panel_capas.dart';
import 'ficha_page.dart';
import 'login_page.dart';
import 'pendientes_page.dart';
import 'reportes_page.dart';

/// El visor. Es la pantalla principal: se entra aquí y desde aquí se evalúa.
///
/// NO LLEVA BARRA SUPERIOR SÓLIDA. En una app de mapa esa franja se come
/// cincuenta píxeles de alto para repetir lo que uno ya sabe —en qué app
/// está— y encima parte la pantalla justo donde el mapa gana. Lo que hace
/// falta saber (campaña, avance, qué botones hay) va en tarjetas de cristal
/// flotando encima, como en el visor web: se lee, y debajo se sigue viendo
/// el canal.
class MapaPage extends StatefulWidget {
  const MapaPage({super.key});

  @override
  State<MapaPage> createState() => _MapaPageState();
}

class _MapaPageState extends State<MapaPage> {
  final MapController _mapa = MapController();
  // El cajón de capas se abre desde un botón que vive DENTRO del Scaffold,
  // así que Scaffold.of() desde ahí no lo encuentra: busca hacia arriba y
  // arriba está este widget, no el Scaffold. Con la llave no hay duda.
  final GlobalKey<ScaffoldState> _llaveScaffold = GlobalKey<ScaffoldState>();

  /// Centro del ámbito de la Junta: Moche–Virú–Chao.
  static const LatLng _centro = LatLng(-8.4186, -78.7533);

  /// Por debajo de este zoom los puntos se amontonan en manchas que no dicen
  /// nada y además ahogan el teléfono. Las líneas y los polígonos sí se
  /// siguen viendo, que es lo que orienta de lejos.
  static const double _zoomPuntos = 12.5;

  LatLngBounds? _vista;
  double _zoom = 11;
  LatLng? _yo;
  bool _leyendaAbierta = false;

  /// Cuántos activos se están dibujando ahora mismo. Se cuenta al construir
  /// los marcadores, que es cuando se sabe de verdad.
  int _enPantalla = 0;

  @override
  void initState() {
    super.initState();
    // Después del primer frame: el controlador avisa a sus oyentes y
    // llamarlo durante el build es justo lo que Flutter prohíbe.
    WidgetsBinding.instance.addPostFrameCallback((_) async {
      final inv = context.read<InventarioController>();
      await inv.iniciar();
      if (mounted) inv.cargarEncendidas();
    });
  }

  // ── posición ──────────────────────────────────────────────────────────

  Future<void> _irAMiPosicion() async {
    try {
      var permiso = await Geolocator.checkPermission();
      if (permiso == LocationPermission.denied) {
        permiso = await Geolocator.requestPermission();
      }
      if (permiso == LocationPermission.denied ||
          permiso == LocationPermission.deniedForever) {
        _aviso('Sin permiso de ubicación');
        return;
      }
      final p = await Geolocator.getCurrentPosition(
          desiredAccuracy: LocationAccuracy.high);
      final punto = LatLng(p.latitude, p.longitude);
      setState(() => _yo = punto);
      _mapa.move(punto, 17);
    } catch (e) {
      _aviso('No se pudo obtener la ubicación');
    }
  }

  void _aviso(String texto) {
    if (!mounted) return;
    ScaffoldMessenger.of(context)
        .showSnackBar(SnackBar(content: Text(texto)));
  }

  // ── capas dibujadas ───────────────────────────────────────────────────

  bool _enVista(LatLng p) => _vista?.contains(p) ?? true;

  List<Polygon> _poligonos(InventarioController inv) {
    final out = <Polygon>[];
    for (final capa in todasLasCapas) {
      if (capa.tipo != TipoGeom.poligono) continue;
      if (inv.visibles[capa.codigo] != true) continue;
      for (final a in inv.activosDe(capa.codigo)) {
        for (final anillo in a.lineas) {
          if (anillo.length < 3) continue;
          out.add(Polygon(
            points: anillo,
            color: capa.color.withOpacity(0.16),
            borderColor: capa.color,
            borderStrokeWidth: 1.4,
            isFilled: true,
          ));
        }
      }
    }
    return out;
  }

  List<Polyline> _lineas(InventarioController inv) {
    final out = <Polyline>[];
    for (final capa in todasLasCapas) {
      if (capa.tipo != TipoGeom.linea) continue;
      if (inv.visibles[capa.codigo] != true) continue;
      for (final a in inv.activosDe(capa.codigo)) {
        for (final tramo in a.lineas) {
          if (tramo.length < 2) continue;
          out.add(Polyline(
            points: tramo,
            color: capa.color,
            strokeWidth: capa.grosor,
            // Halo oscuro bajo el trazo: sobre una ortofoto ningún color
            // puro llega al contraste mínimo, y sin el borde las capas
            // desaparecen sobre el cultivo y sobre el desierto.
            borderColor: Colors.black45,
            borderStrokeWidth: 1.2,
          ));
        }
      }
    }
    return out;
  }

  List<Marker> _marcadores(InventarioController inv) {
    final out = <Marker>[];
    if (_zoom < _zoomPuntos) {
      _enPantalla = 0;
      return out;
    }

    for (final capa in todasLasCapas) {
      if (capa.tipo != TipoGeom.punto) continue;
      if (inv.visibles[capa.codigo] != true) continue;

      for (final a in inv.activosDe(capa.codigo)) {
        final pt = a.punto;
        if (pt == null || !_enVista(pt)) continue;

        final ev = inv.evaluacionDe(capa.codigo, a.fid);
        out.add(Marker(
          point: pt,
          width: 38,
          height: 38,
          child: GestureDetector(
            onTap: () => _abrirFicha(a, capa),
            child: _PuntoActivo(
              color: capa.color,
              icono: iconoDeCapa(capa.codigo),
              estado: ev?.estadoCons,
              evaluado: ev != null,
              esPech: a.esPech,
            ),
          ),
        ));
      }
    }
    _enPantalla = out.length;
    return out;
  }

  Future<void> _abrirFicha(Activo a, Capa capa) async {
    await Navigator.of(context).push(MaterialPageRoute(
      builder: (_) => FichaPage(activo: a, capa: capa),
    ));
    if (mounted) setState(() {});   // vuelve con la evaluación ya hecha
  }

  Future<void> _salir() async {
    await AuthService().salir();
    if (!mounted) return;
    Navigator.of(context).pushAndRemoveUntil(
      MaterialPageRoute(builder: (_) => const LoginPage()),
      (_) => false,
    );
  }

  void _ir(Widget pagina) =>
      Navigator.of(context).push(MaterialPageRoute(builder: (_) => pagina));

  // ── pantalla ──────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    final inv = context.watch<InventarioController>();
    final marcadores = _marcadores(inv);

    return Scaffold(
      key: _llaveScaffold,
      endDrawer: const PanelCapas(),
      body: Stack(
        children: [
          FlutterMap(
            mapController: _mapa,
            options: MapOptions(
              initialCenter: _centro,
              initialZoom: 11,
              maxZoom: 19,
              onMapReady: () {
                setState(() {
                  _vista = _mapa.camera.visibleBounds;
                  _zoom = _mapa.camera.zoom;
                });
              },
              onPositionChanged: (pos, _) {
                // Solo se repinta cuando cambió algo que importa. En cada
                // arrastre llegan decenas de avisos y un setState por cada
                // uno —con miles de marcadores detrás— hace el mapa a
                // tirones justo en el teléfono más lento.
                //
                // El criterio: cambió el zoom de forma apreciable, o se ha
                // corrido más de un cuarto de pantalla. Comparar los
                // límites por igualdad no sirve: son objetos nuevos en cada
                // aviso y nunca son «iguales».
                final z = pos.zoom ?? _zoom;
                final b = pos.bounds;
                var moverse = true;
                if (b != null && _vista != null) {
                  final alto = (b.north - b.south).abs();
                  final ancho = (b.east - b.west).abs();
                  moverse = (b.center.latitude - _vista!.center.latitude)
                              .abs() >
                          alto * 0.25 ||
                      (b.center.longitude - _vista!.center.longitude).abs() >
                          ancho * 0.25;
                }
                if ((z - _zoom).abs() > 0.2 || moverse) {
                  setState(() {
                    _zoom = z;
                    _vista = b;
                  });
                }
              },
            ),
            children: [
              TileLayer(
                // La misma ortofoto que el visor web y que PLUVIRA: sobre
                // satélite se reconoce el canal, que es como el inspector
                // se ubica en campo.
                urlTemplate:
                    'https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
                userAgentPackageName: 'pe.org.jriegopresurizado.inventario',
                maxZoom: 20,
              ),
              PolygonLayer(polygons: _poligonos(inv)),
              PolylineLayer(polylines: _lineas(inv)),
              if (_yo != null)
                MarkerLayer(markers: [
                  Marker(
                    point: _yo!,
                    width: 24,
                    height: 24,
                    child: const _MiPosicion(),
                  ),
                ]),
              MarkerLayer(markers: marcadores),
            ],
          ),

          // ── cabecera de cristal ──
          SafeArea(
            bottom: false,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(12, 10, 12, 0),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Expanded(child: _Cabecera(inv: inv)),
                      const SizedBox(width: 8),
                      Column(
                        children: [
                          if (inv.pendientes > 0)
                            _BotonCristal(
                              icono: Icons.cloud_upload_outlined,
                              insignia: '${inv.pendientes}',
                              onTap: () => _ir(const PendientesPage()),
                            ),
                          if (inv.pendientes > 0) const SizedBox(height: 8),
                          _BotonCristal(
                            icono: Icons.assignment_outlined,
                            onTap: () => _ir(const ReportesPage()),
                          ),
                          const SizedBox(height: 8),
                          _BotonCristal(
                            icono: Icons.logout,
                            onTap: _salir,
                          ),
                        ],
                      ),
                    ],
                  ),
                  if (inv.iniciando)
                    const Padding(
                      padding: EdgeInsets.only(top: 10),
                      child: _Nota(
                        icono: Icons.downloading,
                        texto: 'Cargando el inventario…',
                      ),
                    ),
                  if (inv.error != null && !inv.iniciando)
                    Padding(
                      padding: const EdgeInsets.only(top: 10),
                      child: _Nota(
                        icono: Icons.error_outline,
                        texto: inv.error!,
                        color: const Color(0xFFE03131),
                        accion: 'Reintentar',
                        onAccion: () =>
                            context.read<InventarioController>().iniciar(),
                      ),
                    ),
                ],
              ),
            ),
          ),

          // ── leyenda de estados ──
          Positioned(
            left: 12,
            bottom: 14,
            child: SafeArea(
              top: false,
              child: _Leyenda(
                abierta: _leyendaAbierta,
                enPantalla: _enPantalla,
                lejos: _zoom < _zoomPuntos,
                onAlternar: () =>
                    setState(() => _leyendaAbierta = !_leyendaAbierta),
              ),
            ),
          ),
        ],
      ),

      floatingActionButton: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          FloatingActionButton.small(
            heroTag: 'pos',
            backgroundColor: Colors.white,
            foregroundColor: AppColors.azul,
            elevation: 3,
            onPressed: _irAMiPosicion,
            child: const Icon(Icons.my_location),
          ),
          const SizedBox(height: 10),
          FloatingActionButton.extended(
            heroTag: 'capas',
            onPressed: () => _llaveScaffold.currentState?.openEndDrawer(),
            icon: const Icon(Icons.layers_outlined),
            label: const Text('Capas',
                style: TextStyle(fontWeight: FontWeight.w700)),
          ),
        ],
      ),
    );
  }
}

/* ── piezas de la pantalla ───────────────────────────────────────────── */

/// La tarjeta de arriba a la izquierda: quién es esto y cómo va la campaña.
///
/// La barra de avance usa las MISMAS tres bandas que el visor web —rojo
/// hasta 25, naranja hasta 75, verde de ahí para arriba—. Que el mismo
/// número se vea del mismo color en el teléfono y en la pantalla de la
/// oficina no es decoración: es lo que evita la conversación de «en el mío
/// sale distinto».
class _Cabecera extends StatelessWidget {
  final InventarioController inv;
  const _Cabecera({required this.inv});

  Color get _colorAvance {
    final p = inv.porcentaje;
    if (p < 25) return const Color(0xFFE03131);
    if (p < 75) return const Color(0xFFF59F00);
    return AppColors.verde;
  }

  @override
  Widget build(BuildContext context) {
    final hay = inv.campania != null && inv.totalCampania > 0;

    return Container(
      padding: const EdgeInsets.fromLTRB(14, 11, 14, 12),
      decoration: AppTheme.cristal,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(
            children: [
              Image.asset('assets/img/logo-inventario-min.png',
                  height: 22, width: 22),
              const SizedBox(width: 9),
              const Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Inventario de Infraestructura',
                      style: TextStyle(
                        color: Colors.white,
                        fontSize: 14.5,
                        fontWeight: FontWeight.w700,
                        height: 1.15,
                      ),
                    ),
                    Text(
                      'JUNTA DE RIEGO PRESURIZADO',
                      style: TextStyle(
                        color: AppColors.cristalSuave,
                        fontSize: 9,
                        letterSpacing: 0.9,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          if (hay) ...[
            const SizedBox(height: 11),
            Row(
              children: [
                _Pastilla(texto: 'Campaña ${inv.campania!.anio}'),
                const SizedBox(width: 8),
                Text(
                  '${inv.evaluadosCampania} de ${inv.totalCampania}',
                  style: const TextStyle(
                      color: AppColors.cristalTexto,
                      fontSize: 12,
                      fontWeight: FontWeight.w600),
                ),
                const Spacer(),
                Text(
                  '${inv.porcentaje.toStringAsFixed(1)} %',
                  style: TextStyle(
                      color: _colorAvance,
                      fontSize: 12.5,
                      fontWeight: FontWeight.w800),
                ),
              ],
            ),
            const SizedBox(height: 7),
            ClipRRect(
              borderRadius: BorderRadius.circular(4),
              child: LinearProgressIndicator(
                value: inv.porcentaje / 100,
                minHeight: 6,
                backgroundColor: Colors.white24,
                valueColor: AlwaysStoppedAnimation(_colorAvance),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _Pastilla extends StatelessWidget {
  final String texto;
  const _Pastilla({required this.texto});

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 3),
        decoration: BoxDecoration(
          color: AppColors.verde.withOpacity(0.22),
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: AppColors.verde.withOpacity(0.55)),
        ),
        child: Text(texto,
            style: const TextStyle(
                color: Color(0xFF63E6BE),
                fontSize: 11,
                fontWeight: FontWeight.w700)),
      );
}

/// Botón redondo de cristal, de los de la columna derecha.
class _BotonCristal extends StatelessWidget {
  final IconData icono;
  final String? insignia;
  final VoidCallback onTap;

  const _BotonCristal({
    required this.icono,
    required this.onTap,
    this.insignia,
  });

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(14),
        child: Container(
          width: 46,
          height: 46,
          decoration: BoxDecoration(
            color: AppColors.cristal,
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: AppColors.cristalBorde),
            boxShadow: AppTheme.sombraFlotante,
          ),
          child: Stack(
            alignment: Alignment.center,
            children: [
              Icon(icono, color: Colors.white, size: 21),
              if (insignia != null)
                Positioned(
                  top: 5,
                  right: 5,
                  child: Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
                    decoration: BoxDecoration(
                      color: const Color(0xFFD9480F),
                      borderRadius: BorderRadius.circular(9),
                      border: Border.all(color: AppColors.cristal, width: 1.5),
                    ),
                    child: Text(insignia!,
                        style: const TextStyle(
                            color: Colors.white,
                            fontSize: 10,
                            fontWeight: FontWeight.w800)),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Aviso de una línea, bajo la cabecera.
class _Nota extends StatelessWidget {
  final IconData icono;
  final String texto;
  final Color? color;
  final String? accion;
  final VoidCallback? onAccion;

  const _Nota({
    required this.icono,
    required this.texto,
    this.color,
    this.accion,
    this.onAccion,
  });

  @override
  Widget build(BuildContext context) {
    final c = color ?? Colors.white;
    return Container(
      padding: const EdgeInsets.fromLTRB(13, 10, 8, 10),
      decoration: AppTheme.cristal,
      child: Row(
        children: [
          Icon(icono, size: 18, color: c),
          const SizedBox(width: 10),
          Expanded(
            child: Text(texto,
                style: TextStyle(color: c, fontSize: 12.5),
                maxLines: 3,
                overflow: TextOverflow.ellipsis),
          ),
          if (accion != null)
            TextButton(
              onPressed: onAccion,
              style: TextButton.styleFrom(
                  foregroundColor: Colors.white,
                  visualDensity: VisualDensity.compact),
              child: Text(accion!),
            ),
        ],
      ),
    );
  }
}

/// La leyenda de estados, abajo a la izquierda.
///
/// Empieza cerrada y como una sola pastilla con el conteo: en el teléfono,
/// cinco filas de colores fijas tapan un cuarto del mapa, y el estado se
/// consulta de vez en cuando, no todo el rato.
class _Leyenda extends StatelessWidget {
  final bool abierta;
  final int enPantalla;
  final bool lejos;
  final VoidCallback onAlternar;

  const _Leyenda({
    required this.abierta,
    required this.enPantalla,
    required this.lejos,
    required this.onAlternar,
  });

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onAlternar,
        borderRadius: BorderRadius.circular(AppTheme.radio),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 160),
          padding: const EdgeInsets.fromLTRB(13, 10, 13, 11),
          decoration: AppTheme.cristal,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(abierta ? Icons.expand_more : Icons.expand_less,
                      size: 16, color: AppColors.cristalSuave),
                  const SizedBox(width: 7),
                  Text(
                    lejos
                        ? 'Acércate para ver las estructuras'
                        : '$enPantalla en pantalla',
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 12,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ],
              ),
              if (abierta) ...[
                const SizedBox(height: 10),
                for (final e in const ['B', 'R', 'M', 'C'])
                  Padding(
                    padding: const EdgeInsets.only(bottom: 5),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Container(
                          width: 11,
                          height: 11,
                          decoration: BoxDecoration(
                            color: AppColors.deEstado(e),
                            shape: BoxShape.circle,
                            border:
                                Border.all(color: Colors.white24, width: 1),
                          ),
                        ),
                        const SizedBox(width: 8),
                        Text(AppColors.nombresEstado[e]!,
                            style: const TextStyle(
                                color: AppColors.cristalTexto, fontSize: 12)),
                      ],
                    ),
                  ),
                Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Container(
                      width: 11,
                      height: 11,
                      decoration: BoxDecoration(
                        color: Colors.white,
                        shape: BoxShape.circle,
                        border: Border.all(color: Colors.white24),
                      ),
                    ),
                    const SizedBox(width: 8),
                    const Text('Sin evaluar',
                        style: TextStyle(
                            color: AppColors.cristalTexto, fontSize: 12)),
                  ],
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

/// El punto de un activo.
///
/// Lleva tres datos a la vez, como en el visor web: el DIBUJO dice de qué
/// capa es, el ANILLO cómo está de conservación (blanco = sin evaluar) y el
/// TAMAÑO el ámbito —los del PECH van más chicos y apagados, porque son
/// contexto y no deben competir por la vista con lo que la Junta evalúa—.
///
/// El fondo es blanco y no del color de la capa: sobre una ortofoto, un
/// disco de color saturado compite con el cultivo y con el agua, y el
/// dibujo de dentro se pierde. Con fondo blanco el símbolo se lee siempre.
class _PuntoActivo extends StatelessWidget {
  final Color color;
  final IconData icono;
  final String? estado;
  final bool evaluado;
  final bool esPech;

  const _PuntoActivo({
    required this.color,
    required this.icono,
    required this.estado,
    required this.evaluado,
    required this.esPech,
  });

  @override
  Widget build(BuildContext context) {
    final lado = esPech ? 24.0 : 30.0;
    final anillo = evaluado ? AppColors.deEstado(estado) : Colors.white;

    return Center(
      child: Container(
        width: lado,
        height: lado,
        decoration: BoxDecoration(
          color: esPech ? const Color(0xE6FFFFFF) : Colors.white,
          shape: BoxShape.circle,
          border: Border.all(color: anillo, width: evaluado ? 3 : 2),
          boxShadow: const [
            BoxShadow(color: AppColors.sombraFuerte, blurRadius: 4),
          ],
        ),
        child: Icon(icono,
            size: esPech ? 11 : 14,
            color: esPech ? color.withOpacity(0.75) : color),
      ),
    );
  }
}

class _MiPosicion extends StatelessWidget {
  const _MiPosicion();

  @override
  Widget build(BuildContext context) => Container(
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          color: AppColors.azul,
          border: Border.all(color: Colors.white, width: 3),
          boxShadow: const [
            BoxShadow(color: AppColors.sombraFuerte, blurRadius: 5)
          ],
        ),
      );
}
