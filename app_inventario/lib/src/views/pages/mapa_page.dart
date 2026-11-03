import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:geolocator/geolocator.dart';
import 'package:latlong2/latlong.dart';
import 'package:provider/provider.dart';

import '../../controllers/inventario_controller.dart';
import '../../models/modelos.dart';
import '../../services/auth_service.dart';
import '../../utils/app_colors.dart';
import '../../utils/catalogo_capas.dart';
import '../widgets/panel_capas.dart';
import 'ficha_page.dart';
import 'login_page.dart';
import 'pendientes_page.dart';
import 'reportes_page.dart';

/// El visor. Es la pantalla principal de la app: se entra aquí y desde aquí
/// se evalúa.
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

  LatLngBounds? _vista;
  double _zoom = 11;
  LatLng? _yo;

  @override
  void initState() {
    super.initState();
    // Después del primer frame: el controlador avisa a los oyentes y
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
            color: capa.color.withOpacity(0.18),
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
            borderColor: Colors.black38,
            borderStrokeWidth: 1,
          ));
        }
      }
    }
    return out;
  }

  List<Marker> _marcadores(InventarioController inv) {
    final out = <Marker>[];
    // Por debajo de este zoom los puntos se amontonan en manchas que no
    // dicen nada y además ahogan el teléfono. Las líneas y los polígonos sí
    // se siguen viendo, que es lo que orienta de lejos.
    if (_zoom < 12.5) return out;

    for (final capa in todasLasCapas) {
      if (capa.tipo != TipoGeom.punto) continue;
      if (inv.visibles[capa.codigo] != true) continue;

      for (final a in inv.activosDe(capa.codigo)) {
        final pt = a.punto;
        if (pt == null || !_enVista(pt)) continue;

        final ev = inv.evaluacionDe(capa.codigo, a.fid);
        out.add(Marker(
          point: pt,
          width: 30,
          height: 30,
          child: GestureDetector(
            onTap: () => _abrirFicha(a, capa),
            child: _PuntoActivo(
              color: capa.color,
              estado: ev?.estadoCons,
              evaluado: ev != null,
              esPech: a.esPech,
            ),
          ),
        ));
      }
    }
    return out;
  }

  Future<void> _abrirFicha(Activo a, Capa capa) async {
    await Navigator.of(context).push(MaterialPageRoute(
      builder: (_) => FichaPage(activo: a, capa: capa),
    ));
    if (mounted) setState(() {});   // vuelve con la evaluación ya hecha
  }

  // ── pantalla ──────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    final inv = context.watch<InventarioController>();

    return Scaffold(
      key: _llaveScaffold,
      appBar: AppBar(
        titleSpacing: 12,
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Text('Inventario',
                style: TextStyle(fontSize: 17, fontWeight: FontWeight.w800)),
            Text(
              inv.campania == null
                  ? 'sin campaña'
                  : 'campaña ${inv.campania!.anio}'
                      ' · ${inv.evaluadosCampania} de ${inv.totalCampania}',
              style: const TextStyle(fontSize: 12, color: Colors.white70),
            ),
          ],
        ),
        actions: [
          if (inv.pendientes > 0)
            _BotonPendientes(
              cuantos: inv.pendientes,
              onTap: () => Navigator.of(context).push(MaterialPageRoute(
                  builder: (_) => const PendientesPage())),
            ),
          IconButton(
            tooltip: 'Reportes',
            icon: const Icon(Icons.assignment_outlined),
            onPressed: () => Navigator.of(context).push(
                MaterialPageRoute(builder: (_) => const ReportesPage())),
          ),
          PopupMenuButton<String>(
            onSelected: (v) async {
              if (v == 'salir') {
                await AuthService().salir();
                if (!mounted) return;
                Navigator.of(context).pushAndRemoveUntil(
                  MaterialPageRoute(builder: (_) => const LoginPage()),
                  (_) => false,
                );
              }
            },
            itemBuilder: (_) => const [
              PopupMenuItem(value: 'salir', child: Text('Cerrar sesión')),
            ],
          ),
        ],
      ),

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
                // arrastre llegan decenas de estos avisos y un setState por
                // cada uno —con miles de marcadores detrás— hace el mapa a
                // tirones justo en el teléfono más lento.
                //
                // El criterio es: cambió el zoom de forma apreciable, o se
                // ha corrido más de un cuarto de pantalla. Comparar los
                // límites por igualdad no sirve: son objetos nuevos en cada
                // aviso y nunca son «iguales».
                final z = pos.zoom ?? _zoom;
                final b = pos.bounds;
                var moverse = true;
                if (b != null && _vista != null) {
                  final altura = (b.north - b.south).abs();
                  final ancho = (b.east - b.west).abs();
                  moverse = (b.center.latitude - _vista!.center.latitude)
                              .abs() >
                          altura * 0.25 ||
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
                urlTemplate: 'https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
                userAgentPackageName: 'pe.org.jriegopresurizado.inventario',
                maxZoom: 20,
              ),
              PolygonLayer(polygons: _poligonos(inv)),
              PolylineLayer(polylines: _lineas(inv)),
              if (_yo != null)
                MarkerLayer(markers: [
                  Marker(
                    point: _yo!,
                    width: 22,
                    height: 22,
                    child: const _MiPosicion(),
                  ),
                ]),
              MarkerLayer(markers: _marcadores(inv)),
            ],
          ),

          if (inv.iniciando)
            const _Cargando(texto: 'Cargando el inventario…'),

          if (inv.error != null && !inv.iniciando)
            _Error(
              texto: inv.error!,
              onReintentar: () => context.read<InventarioController>().iniciar(),
            ),

          if (_zoom < 12.5)
            const Positioned(
              left: 0,
              right: 0,
              bottom: 16,
              child: Center(child: _Pista('Acércate para ver las estructuras')),
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
            onPressed: _irAMiPosicion,
            child: const Icon(Icons.my_location),
          ),
          const SizedBox(height: 10),
          FloatingActionButton.extended(
            heroTag: 'capas',
            onPressed: () => _llaveScaffold.currentState?.openEndDrawer(),
            icon: const Icon(Icons.layers_outlined),
            label: const Text('Capas'),
          ),
        ],
      ),
    );
  }
}

/// El punto de un activo.
///
/// Lleva tres datos a la vez, como en el visor web: el relleno dice de qué
/// capa es, el anillo cómo está de conservación (sin anillo = sin evaluar) y
/// la forma de qué ámbito —los del PECH van huecos y más chicos, porque son
/// contexto y no deben competir por la vista con lo que la Junta evalúa—.
class _PuntoActivo extends StatelessWidget {
  final Color color;
  final String? estado;
  final bool evaluado;
  final bool esPech;

  const _PuntoActivo({
    required this.color,
    required this.estado,
    required this.evaluado,
    required this.esPech,
  });

  @override
  Widget build(BuildContext context) {
    final lado = esPech ? 15.0 : 19.0;
    return Center(
      child: Container(
        width: lado,
        height: lado,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          color: esPech ? Colors.white.withOpacity(0.55) : color,
          border: Border.all(
            color: evaluado ? AppColors.deEstado(estado) : Colors.white,
            width: evaluado ? 3 : 1.6,
          ),
          boxShadow: const [
            BoxShadow(color: Colors.black38, blurRadius: 3, spreadRadius: 0.5),
          ],
        ),
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
          boxShadow: const [BoxShadow(color: Colors.black45, blurRadius: 4)],
        ),
      );
}

class _BotonPendientes extends StatelessWidget {
  final int cuantos;
  final VoidCallback onTap;
  const _BotonPendientes({required this.cuantos, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 4),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(20),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 11),
          decoration: BoxDecoration(
            color: const Color(0xFFD9480F),
            borderRadius: BorderRadius.circular(20),
          ),
          child: Row(
            children: [
              const Icon(Icons.cloud_upload_outlined,
                  size: 17, color: Colors.white),
              const SizedBox(width: 6),
              Text('$cuantos',
                  style: const TextStyle(
                      color: Colors.white,
                      fontWeight: FontWeight.w800,
                      fontSize: 14)),
            ],
          ),
        ),
      ),
    );
  }
}

class _Cargando extends StatelessWidget {
  final String texto;
  const _Cargando({required this.texto});

  @override
  Widget build(BuildContext context) => Positioned(
        top: 14,
        left: 14,
        right: 14,
        child: Material(
          elevation: 3,
          borderRadius: BorderRadius.circular(10),
          child: Padding(
            padding: const EdgeInsets.all(13),
            child: Row(children: [
              const SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(strokeWidth: 2.2)),
              const SizedBox(width: 12),
              Expanded(child: Text(texto)),
            ]),
          ),
        ),
      );
}

class _Error extends StatelessWidget {
  final String texto;
  final VoidCallback onReintentar;
  const _Error({required this.texto, required this.onReintentar});

  @override
  Widget build(BuildContext context) => Positioned(
        top: 14,
        left: 14,
        right: 14,
        child: Material(
          elevation: 3,
          borderRadius: BorderRadius.circular(10),
          color: const Color(0xFFFEF2F2),
          child: Padding(
            padding: const EdgeInsets.all(13),
            child: Row(children: [
              const Icon(Icons.error_outline, color: Color(0xFFB91C1C)),
              const SizedBox(width: 10),
              Expanded(
                  child: Text(texto,
                      style: const TextStyle(color: Color(0xFFB91C1C)))),
              TextButton(
                  onPressed: onReintentar, child: const Text('Reintentar')),
            ]),
          ),
        ),
      );
}

class _Pista extends StatelessWidget {
  final String texto;
  const _Pista(this.texto);

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
        decoration: BoxDecoration(
          color: Colors.black.withOpacity(0.62),
          borderRadius: BorderRadius.circular(20),
        ),
        child: Text(texto,
            style: const TextStyle(color: Colors.white, fontSize: 13)),
      );
}
