import 'dart:math' as math;

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

  /// Radio del racimo, en píxeles. Es el mismo que el del visor web
  /// (maxClusterRadius: 55), para que el mapa se agrupe igual en los dos.
  static const double _radioRacimo = 55;

  /// De aquí para arriba, cada estructura por separado. Equivale al
  /// disableClusteringAtZoom del visor.
  static const double _zoomSinRacimo = 17.5;

  LatLngBounds? _vista;
  double _zoom = 11;
  LatLng? _yo;
  /// Radio de incertidumbre en metros, tal como lo declara el aparato.
  double _precision = 0;
  bool _buscandoPos = false;
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

  /// Lleva el mapa a donde está el inspector.
  ///
  /// CADA FALLO SE DICE POR SU NOMBRE. «No se pudo obtener la ubicación»
  /// vale para cinco cosas distintas —el GPS apagado, el permiso sin dar, el
  /// permiso denegado para siempre, el aparato sin fijar satélites, el
  /// permiso que falta en el manifiesto— y cada una se arregla de una
  /// manera. Con el mensaje genérico, en el cerro, uno se queda tocando el
  /// botón sin saber qué mirar.
  ///
  /// Donde se puede, el aviso lleva el botón que lleva al sitio donde se
  /// arregla.
  Future<void> _irAMiPosicion() async {
    if (_buscandoPos) return;
    setState(() => _buscandoPos = true);
    try {
      // 1. ¿Está el GPS encendido? Es el caso más común con diferencia, y
      //    el único que no se nota mirando la app.
      if (!await Geolocator.isLocationServiceEnabled()) {
        _aviso('La ubicación del teléfono está apagada.',
            accion: 'Activar', onAccion: Geolocator.openLocationSettings);
        return;
      }

      // 2. El permiso.
      var permiso = await Geolocator.checkPermission();
      if (permiso == LocationPermission.denied) {
        permiso = await Geolocator.requestPermission();
      }
      if (permiso == LocationPermission.deniedForever) {
        _aviso('Negaste el permiso de ubicación para siempre.',
            accion: 'Ajustes', onAccion: Geolocator.openAppSettings);
        return;
      }
      if (permiso == LocationPermission.denied) {
        _aviso('Sin permiso de ubicación no puedo situarte en el mapa.');
        return;
      }

      // 3. La posición. Con límite de tiempo: bajo techo o en una quebrada
      //    el aparato puede estar diez minutos sin fijar satélites, y sin
      //    tope esto se queda esperando callado para siempre.
      Position? p;
      try {
        p = await Geolocator.getCurrentPosition(
          desiredAccuracy: LocationAccuracy.high,
          timeLimit: const Duration(seconds: 15),
        );
      } catch (_) {
        // 4. Si no fija a tiempo, vale la última conocida: en campo, a cien
        //    metros de donde uno estaba hace un minuto, sirve igual para
        //    encontrar la estructura. Eso sí, se avisa de que es vieja.
        p = await Geolocator.getLastKnownPosition();
        if (p != null) _aviso('Última posición conocida; el GPS aún no fija.');
      }

      if (p == null) {
        _aviso('El GPS no logró fijar posición. Sal a cielo abierto y '
            'vuelve a intentarlo.');
        return;
      }

      final punto = LatLng(p.latitude, p.longitude);
      setState(() {
        _yo = punto;
        _precision = p!.accuracy;
      });
      _mapa.move(punto, 17);
    } catch (e) {
      // El caso que no se puede arreglar desde el teléfono: la app se
      // compiló sin declarar el permiso. Pasa cuando se generó android/ a
      // mano sin añadir lo que dice el LEEME, y desde dentro de la app no
      // hay nada que tocar: hay que recompilar.
      final txt = e.toString().toLowerCase();
      if (txt.contains('manifest') ||
          (txt.contains('permission') && txt.contains('define'))) {
        _aviso('La app se compiló sin el permiso de ubicación en el '
            'AndroidManifest. Hay que añadirlo y recompilar.');
      } else {
        _aviso('No se pudo obtener la ubicación: $e');
      }
    } finally {
      if (mounted) setState(() => _buscandoPos = false);
    }
  }

  /// Diagnóstico del GPS, con pulsación larga sobre el botón de ubicación.
  ///
  /// POR QUÉ HACE FALTA. Cuando el botón falla en el cerro, lo que llega es
  /// «no sale mi ubicación», y desde aquí no hay forma de saber cuál de las
  /// cinco causas es. Esto pregunta las cuatro cosas por separado y las
  /// enseña juntas: con una foto de esta pantalla se sabe exactamente dónde
  /// está el problema, sin ir y volver tres veces.
  Future<void> _diagnosticoUbicacion() async {
    final lineas = <String>[];

    Future<void> mirar(String que, Future<Object?> Function() fn) async {
      try {
        lineas.add('$que: ${await fn()}');
      } catch (e) {
        lineas.add('$que: ERROR → $e');
      }
    }

    await mirar('Servicio de ubicación activo',
        () => Geolocator.isLocationServiceEnabled());
    await mirar('Permiso concedido', () => Geolocator.checkPermission());
    await mirar('Última posición conocida',
        () async => (await Geolocator.getLastKnownPosition())?.toString() ?? 'ninguna');
    await mirar(
        'Posición ahora (10 s)',
        () async => (await Geolocator.getCurrentPosition(
                desiredAccuracy: LocationAccuracy.high,
                timeLimit: const Duration(seconds: 10)))
            .toString());

    if (!mounted) return;
    showDialog<void>(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('Diagnóstico de ubicación'),
        content: SingleChildScrollView(
          child: SelectableText(
            lineas.join('\n\n'),
            style: const TextStyle(fontSize: 12.5, height: 1.4),
          ),
        ),
        actions: [
          TextButton(
            onPressed: Geolocator.openAppSettings,
            child: const Text('Permisos de la app'),
          ),
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('Cerrar'),
          ),
        ],
      ),
    );
  }

  void _aviso(String texto, {String? accion, VoidCallback? onAccion}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      content: Text(texto),
      duration: const Duration(seconds: 6),
      action: accion == null
          ? null
          : SnackBarAction(
              label: accion,
              textColor: Colors.white,
              onPressed: onAccion ?? () {},
            ),
    ));
  }

  // ── capas dibujadas ───────────────────────────────────────────────────

  bool _enVista(LatLng p) => _vista?.contains(p) ?? true;

  /// El color con que se pinta un polígono.
  ///
  /// Los SECTORES llevan uno distinto cada uno, como en el visor web: con un
  /// solo verde para todos eran una mancha continua y no se veía dónde
  /// acababa uno y empezaba el siguiente, que es justo lo que uno mira en un
  /// mapa de sectores. Van en orden por la paleta de cuatro, así que dos
  /// seguidos nunca repiten.
  Color _colorPoligono(Capa capa, int indice) => capa.codigo == 'sectores_pech'
      ? AppColors.sectores[indice % AppColors.sectores.length]
      : capa.color;

  List<Polygon> _poligonos(InventarioController inv) {
    final out = <Polygon>[];
    for (final capa in todasLasCapas) {
      if (capa.tipo != TipoGeom.poligono) continue;
      if (inv.visibles[capa.codigo] != true) continue;

      final activos = inv.activosDe(capa.codigo);
      for (var i = 0; i < activos.length; i++) {
        final color = _colorPoligono(capa, i);
        for (final anillo in activos[i].lineas) {
          if (anillo.length < 3) continue;
          out.add(Polygon(
            points: anillo,
            color: color.withOpacity(0.18),
            borderColor: color,
            borderStrokeWidth: 1.6,
            isFilled: true,
          ));
        }
      }
    }
    return out;
  }

  /// El nombre de cada sector, escrito encima.
  ///
  /// De lejos los colores dicen que hay sectores distintos, pero no CUÁL es
  /// cuál, y el inspector trabaja por sector. Solo a partir de cierto zoom:
  /// con todo el valle en pantalla los rótulos se pisan unos a otros.
  List<Marker> _rotulosSectores(InventarioController inv) {
    if (inv.visibles['sectores_pech'] != true || _zoom < 9.5) return const [];
    final out = <Marker>[];
    final activos = inv.activosDe('sectores_pech');
    for (var i = 0; i < activos.length; i++) {
      final pt = activos[i].punto;
      if (pt == null || !_enVista(pt)) continue;
      out.add(Marker(
        point: pt,
        width: 160,
        height: 22,
        child: _RotuloSector(texto: activos[i].nombre.toUpperCase()),
      ));
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

  /// Los puntos que caen en pantalla, agrupados en racimos.
  ///
  /// POR QUÉ HAY QUE AGRUPAR. Con las capas encendidas hay más de dos mil
  /// estructuras. Dibujarlas una a una deja el teléfono inservible, y de
  /// lejos no se vería nada útil igualmente: dos mil puntos sobre el valle
  /// son una mancha. Antes esto se resolvía escondiéndolos por debajo de
  /// cierto zoom, y el resultado era peor —la app parecía vacía y el
  /// inspector no sabía si es que no había nada o es que no cargó—.
  ///
  /// Se agrupa en una rejilla del tamaño del racimo del visor web (55 px),
  /// así que el mapa se agrupa igual en el teléfono y en la pantalla de la
  /// oficina. La rejilla se calcula en grados a partir del zoom: a zoom z el
  /// mundo mide 256·2^z píxeles de ancho para 360 grados.
  List<Marker> _marcadores(InventarioController inv) {
    final visibles = <_PuntoVisible>[];
    for (final capa in todasLasCapas) {
      if (capa.tipo != TipoGeom.punto) continue;
      if (inv.visibles[capa.codigo] != true) continue;
      for (final a in inv.activosDe(capa.codigo)) {
        final pt = a.punto;
        if (pt == null || !_enVista(pt)) continue;
        visibles.add(_PuntoVisible(a, capa, pt));
      }
    }
    _enPantalla = visibles.length;

    // De cerca no se agrupa: ahí es donde se evalúa, y hay que poder tocar
    // una estructura concreta.
    if (_zoom >= _zoomSinRacimo) {
      return [for (final p in visibles) _marcadorSuelto(p, inv)];
    }

    final gradosPorPixel = 360.0 / (256.0 * math.pow(2, _zoom).toDouble());
    final celda = gradosPorPixel * _radioRacimo;

    final grupos = <String, List<_PuntoVisible>>{};
    for (final p in visibles) {
      final i = (p.punto.latitude / celda).floor();
      final j = (p.punto.longitude / celda).floor();
      grupos.putIfAbsent('$i:$j', () => <_PuntoVisible>[]).add(p);
    }

    final out = <Marker>[];
    grupos.forEach((_, lista) {
      if (lista.length == 1) {
        out.add(_marcadorSuelto(lista.first, inv));
        return;
      }
      var lat = 0.0, lng = 0.0;
      for (final p in lista) {
        lat += p.punto.latitude;
        lng += p.punto.longitude;
      }
      final centro = LatLng(lat / lista.length, lng / lista.length);
      final lado = lista.length < 10 ? 42.0 : (lista.length < 100 ? 50.0 : 58.0);
      out.add(Marker(
        point: centro,
        width: lado,
        height: lado,
        child: GestureDetector(
          // Tocar un racimo acerca: es lo que hace el visor web y lo que
          // todo el mundo espera de un número dentro de un círculo.
          onTap: () => _mapa.move(centro, math.min(18.0, _zoom + 2.0)),
          child: _Racimo(cuantos: lista.length),
        ),
      ));
    });
    return out;
  }

  Marker _marcadorSuelto(_PuntoVisible p, InventarioController inv) {
    final ev = inv.evaluacionDe(p.capa.codigo, p.activo.fid);
    return Marker(
      point: p.punto,
      width: 38,
      height: 38,
      child: GestureDetector(
        onTap: () => _abrirFicha(p.activo, p.capa),
        child: _PuntoActivo(
          color: p.capa.color,
          icono: iconoDeCapa(p.capa.codigo),
          estado: ev?.estadoCons,
          evaluado: ev != null,
          esPech: p.activo.esPech,
        ),
      ),
    );
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
              MarkerLayer(markers: _rotulosSectores(inv)),
              // El círculo de precisión no es adorno: dice si el punto azul
              // vale un metro o cincuenta. Con el GPS de un teléfono junto a
              // un cerro, la diferencia decide si uno está buscando LA toma
              // o la de al lado.
              if (_yo != null && _precision > 0)
                CircleLayer(circles: [
                  CircleMarker(
                    point: _yo!,
                    radius: _precision,
                    useRadiusInMeter: true,
                    color: AppColors.azul.withOpacity(0.14),
                    borderColor: AppColors.azul.withOpacity(0.5),
                    borderStrokeWidth: 1,
                  ),
                ]),
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
          // Pulsación larga: el diagnóstico. No lleva botón propio porque
          // es para cuando algo falla, no para el uso diario.
          GestureDetector(
            onLongPress: _diagnosticoUbicacion,
            child: FloatingActionButton.small(
            heroTag: 'pos',
            backgroundColor: Colors.white,
            foregroundColor: AppColors.azul,
            elevation: 3,
            onPressed: _irAMiPosicion,
            // Fijar satélites tarda; sin esta señal uno cree que el botón
            // no hizo nada y lo pulsa cuatro veces.
            child: _buscandoPos
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(
                        strokeWidth: 2.4, color: AppColors.azul),
                  )
                : const Icon(Icons.my_location),
            ),
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
  final VoidCallback onAlternar;

  const _Leyenda({
    required this.abierta,
    required this.enPantalla,
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
                    '$enPantalla en pantalla',
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

/// Un punto que toca dibujar, con la capa de la que salió.
class _PuntoVisible {
  final Activo activo;
  final Capa capa;
  final LatLng punto;
  const _PuntoVisible(this.activo, this.capa, this.punto);
}

/// El punto de un activo.
///
/// Lleva tres datos a la vez, como en el visor web: el DIBUJO dice de qué
/// capa es, el PUNTO DE LA ESQUINA cómo está de conservación, y el TAMAÑO
/// el ámbito —los del PECH van más chicos y apagados, porque son contexto y
/// no deben competir por la vista con lo que la Junta evalúa—.
///
/// El estado va en la esquina y no como anillo alrededor, igual que en la
/// web: un anillo grueso de color se come el dibujo de dentro justo cuando
/// más falta hace distinguir una toma de una caja hidráulica.
///
/// El fondo es blanco y no del color de la capa: sobre una ortofoto un disco
/// de color saturado compite con el cultivo y con el agua, y el símbolo se
/// pierde. Con fondo blanco se lee siempre.
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

    return Center(
      child: SizedBox(
        width: lado + 8,
        height: lado + 8,
        child: Stack(
          alignment: Alignment.center,
          children: [
            Container(
              width: lado,
              height: lado,
              decoration: BoxDecoration(
                color: esPech ? const Color(0xE6FFFFFF) : Colors.white,
                shape: BoxShape.circle,
                border: Border.all(
                    color: esPech ? Colors.white70 : color, width: 2),
                boxShadow: const [
                  BoxShadow(color: AppColors.sombraFuerte, blurRadius: 4),
                ],
              ),
              child: Icon(icono,
                  size: esPech ? 11 : 14,
                  color: esPech ? color.withOpacity(0.75) : color),
            ),
            if (evaluado)
              Positioned(
                right: 2,
                bottom: 2,
                child: Container(
                  width: 12,
                  height: 12,
                  decoration: BoxDecoration(
                    color: AppColors.deEstado(estado),
                    shape: BoxShape.circle,
                    border: Border.all(color: Colors.white, width: 1.8),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

/// Un racimo: cuántas estructuras hay agrupadas ahí.
///
/// Los tres colores son los de leaflet.markercluster, que es lo que se ve en
/// la web: verde por debajo de diez, amarillo por debajo de cien, naranja de
/// ahí para arriba. El anillo exterior translúcido es parte del dibujo, no
/// adorno: sobre una ortofoto un disco opaco parece una estructura más.
class _Racimo extends StatelessWidget {
  final int cuantos;
  const _Racimo({required this.cuantos});

  @override
  Widget build(BuildContext context) {
    final color = AppColors.deRacimo(cuantos);
    return Center(
      child: Container(
        decoration: BoxDecoration(
          color: color.withOpacity(0.45),
          shape: BoxShape.circle,
        ),
        padding: const EdgeInsets.all(5),
        child: Container(
          decoration: BoxDecoration(
            color: color.withOpacity(0.92),
            shape: BoxShape.circle,
          ),
          alignment: Alignment.center,
          child: Padding(
            padding: const EdgeInsets.all(6),
            child: FittedBox(
              child: Text(
                '$cuantos',
                style: const TextStyle(
                  color: Colors.white,
                  fontWeight: FontWeight.w800,
                  fontSize: 15,
                  shadows: [
                    Shadow(color: AppColors.sombraFuerte, blurRadius: 2),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// El nombre de un sector, escrito sobre el mapa.
///
/// Texto blanco con sombra y sin recuadro, como en el visor: un recuadro
/// sólido sobre la ortofoto tapa justo el terreno que se está mirando.
class _RotuloSector extends StatelessWidget {
  final String texto;
  const _RotuloSector({required this.texto});

  @override
  Widget build(BuildContext context) => Center(
        child: Text(
          texto,
          textAlign: TextAlign.center,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(
            color: Colors.white,
            fontSize: 12,
            fontWeight: FontWeight.w800,
            letterSpacing: 0.8,
            shadows: [
              Shadow(color: Colors.black, blurRadius: 4),
              Shadow(color: Colors.black54, blurRadius: 8),
            ],
          ),
        ),
      );
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
