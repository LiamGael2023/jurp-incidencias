import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../controllers/inventario_controller.dart';
import '../../utils/app_colors.dart';
import '../../utils/app_theme.dart';
import '../../utils/catalogo_capas.dart';
import 'simbolo_capa.dart';

/// Qué se ve en el mapa.
///
/// Va en oscuro, como el panel del visor web, y no en blanco: se abre
/// ENCIMA del mapa y hay que poder comparar lo de la lista con lo que se ve
/// detrás. Un panel blanco a pantalla completa, al sol, deslumbra y además
/// rompe la continuidad con el mapa que se está mirando.
///
/// Las capas vienen agrupadas como en los planos de la Junta —captación,
/// obras de arte, cruces, red— y al final las del PECH, aparte y rotuladas
/// como contexto: son obras que la Junta no evalúa (salvo las tomas del
/// Canal Madre) y mezclarlas haría pensar que faltan por inspeccionar.
class PanelCapas extends StatelessWidget {
  const PanelCapas({super.key});

  @override
  Widget build(BuildContext context) {
    final inv = context.watch<InventarioController>();

    return Drawer(
      width: 340,
      backgroundColor: const Color(0xFF0B1725),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.horizontal(left: Radius.circular(22)),
      ),
      child: SafeArea(
        child: Column(
          children: [
            // ── cabecera ──
            Padding(
              padding: const EdgeInsets.fromLTRB(18, 14, 8, 10),
              child: Row(
                children: [
                  Image.asset('assets/img/logo-inventario-min.png',
                      height: 20, width: 20),
                  const SizedBox(width: 9),
                  const Expanded(
                    child: Text(
                      'INVENTARIO JURP',
                      style: TextStyle(
                        color: Colors.white,
                        fontSize: 13,
                        letterSpacing: 1.1,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ),
                  IconButton(
                    icon: const Icon(Icons.close, color: AppColors.cristalSuave),
                    onPressed: () => Navigator.of(context).pop(),
                  ),
                ],
              ),
            ),

            // ── ámbito ──
            // Es un filtro del SERVIDOR, no de la pantalla: cambiarlo vuelve
            // a pedir las capas encendidas. Por eso no es instantáneo.
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: _Ambito(
                valor: inv.ambito,
                onCambiar: (v) =>
                    context.read<InventarioController>().cambiarAmbito(v),
              ),
            ),

            Padding(
              padding: const EdgeInsets.fromLTRB(16, 10, 16, 8),
              child: Row(
                children: [
                  _Enlace(
                    texto: 'Encender todas',
                    onTap: () => context
                        .read<InventarioController>()
                        .todasLasCapasVisibles(true),
                  ),
                  const Spacer(),
                  _Enlace(
                    texto: 'Apagar todas',
                    onTap: () => context
                        .read<InventarioController>()
                        .todasLasCapasVisibles(false),
                  ),
                ],
              ),
            ),

            const Divider(color: Colors.white12, height: 1),

            Expanded(
              child: ListView(
                padding: const EdgeInsets.only(bottom: 26),
                children: [
                  for (final g in gruposCapas) ...[
                    Padding(
                      padding: const EdgeInsets.fromLTRB(18, 18, 16, 8),
                      child: Row(
                        children: [
                          Container(
                            width: 3,
                            height: 13,
                            decoration: BoxDecoration(
                              color: g.contexto
                                  ? AppColors.cristalSuave
                                  : AppColors.verde,
                              borderRadius: BorderRadius.circular(2),
                            ),
                          ),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Text(
                              g.titulo.toUpperCase(),
                              style: TextStyle(
                                fontSize: 10.5,
                                letterSpacing: 0.9,
                                fontWeight: FontWeight.w800,
                                color: g.contexto
                                    ? AppColors.cristalSuave
                                    : const Color(0xFF63E6BE),
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                    for (final c in g.capas)
                      if (!c.oculta) ...[
                        _FilaCapa(capa: c, inv: inv),
                        // Los sectores se despliegan en su propia lista:
                        // cada uno se enciende y se apaga por separado, y
                        // apagar uno esconde TODO lo que hay dentro.
                        if (c.codigo == 'sectores_pech' &&
                            inv.visibles[c.codigo] == true &&
                            inv.sectores.isNotEmpty)
                          _ListaSectores(inv: inv),
                      ],
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Los sectores, uno por uno.
///
/// NO ES UN FILTRO DE DIBUJO: apagar un sector esconde todo lo que hay
/// DENTRO de él —tomas, canales, lotes—, no solo su contorno. Es lo que
/// hace el visor web y es para lo que sirve: el inspector trabaja por
/// sector y quiere ver el suyo sin el ruido de los otros cuatro.
///
/// El contorno del sector apagado sí se queda, en trazo fino: si se borrara
/// del todo, uno perdería la referencia de dónde estaba justo mientras mira
/// lo que hay en los demás.
class _ListaSectores extends StatelessWidget {
  final InventarioController inv;
  const _ListaSectores({required this.inv});

  @override
  Widget build(BuildContext context) {
    final sectores = inv.sectores;
    final encendidos =
        sectores.where((s) => !inv.sectoresApagados.contains(s.nombre)).length;

    return Container(
      margin: const EdgeInsets.fromLTRB(44, 2, 16, 8),
      padding: const EdgeInsets.fromLTRB(10, 8, 10, 6),
      decoration: BoxDecoration(
        color: Colors.white.withOpacity(0.04),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: Colors.white10),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  '$encendidos de ${sectores.length} encendidos',
                  style: const TextStyle(
                      fontSize: 11, color: AppColors.cristalSuave),
                ),
              ),
              _Enlace(
                texto: 'Todos',
                onTap: () =>
                    context.read<InventarioController>().todosLosSectores(true),
              ),
              const SizedBox(width: 12),
              _Enlace(
                texto: 'Ninguno',
                onTap: () => context
                    .read<InventarioController>()
                    .todosLosSectores(false),
              ),
            ],
          ),
          const SizedBox(height: 4),
          for (final s in sectores)
            InkWell(
              onTap: () =>
                  context.read<InventarioController>().alternarSector(s.nombre),
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 6),
                child: Row(
                  children: [
                    _Casilla(
                      marcada: !inv.sectoresApagados.contains(s.nombre),
                    ),
                    const SizedBox(width: 10),
                    Container(
                      width: 13,
                      height: 13,
                      decoration: BoxDecoration(
                        color: s.color,
                        borderRadius: BorderRadius.circular(3),
                        border: Border.all(color: Colors.black26),
                      ),
                    ),
                    const SizedBox(width: 9),
                    Expanded(
                      child: Text(
                        s.nombre,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.w600,
                          color: inv.sectoresApagados.contains(s.nombre)
                              ? AppColors.cristalSuave
                              : AppColors.cristalTexto,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// La casilla, dibujada a mano: un Checkbox de Material sobre oscuro
/// arrastra su propio color de marca y su área táctil de 48 px, que aquí
/// descuadra la lista.
class _Casilla extends StatelessWidget {
  final bool marcada;
  const _Casilla({required this.marcada});

  @override
  Widget build(BuildContext context) => Container(
        width: 18,
        height: 18,
        decoration: BoxDecoration(
          color: marcada ? AppColors.verde : Colors.transparent,
          borderRadius: BorderRadius.circular(5),
          border: Border.all(
            color: marcada ? AppColors.verde : Colors.white30,
            width: 1.6,
          ),
        ),
        child: marcada
            ? const Icon(Icons.check, size: 12, color: Colors.white)
            : null,
      );
}

/// El selector de ámbito, hecho a mano y no con SegmentedButton: aquí va
/// sobre fondo oscuro y el de Material arrastra su propio esquema de color.
class _Ambito extends StatelessWidget {
  final String valor;
  final void Function(String) onCambiar;
  const _Ambito({required this.valor, required this.onCambiar});

  static const _opciones = [
    ('todo', 'Todo'),
    ('JURP', 'JURP'),
    ('PECH', 'Chavimochic'),
  ];

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(3),
      decoration: BoxDecoration(
        color: Colors.white10,
        borderRadius: BorderRadius.circular(AppTheme.radioChico),
      ),
      child: Row(
        children: [
          for (final o in _opciones)
            Expanded(
              child: GestureDetector(
                onTap: () => onCambiar(o.$1),
                child: AnimatedContainer(
                  duration: const Duration(milliseconds: 140),
                  padding: const EdgeInsets.symmetric(vertical: 9),
                  decoration: BoxDecoration(
                    color: valor == o.$1 ? AppColors.verde : Colors.transparent,
                    borderRadius: BorderRadius.circular(9),
                  ),
                  child: Text(
                    o.$2,
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      color: valor == o.$1
                          ? Colors.white
                          : AppColors.cristalSuave,
                      fontSize: 12.5,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _Enlace extends StatelessWidget {
  final String texto;
  final VoidCallback onTap;
  const _Enlace({required this.texto, required this.onTap});

  @override
  Widget build(BuildContext context) => GestureDetector(
        onTap: onTap,
        child: Text(texto,
            style: const TextStyle(
                color: Color(0xFF74C0FC),
                fontSize: 12.5,
                fontWeight: FontWeight.w600)),
      );
}

class _FilaCapa extends StatelessWidget {
  final Capa capa;
  final InventarioController inv;
  const _FilaCapa({required this.capa, required this.inv});

  @override
  Widget build(BuildContext context) {
    final encendida = inv.visibles[capa.codigo] == true;
    final total = inv.totales[capa.codigo]?.total;
    final cargando = inv.estaCargando(capa.codigo);
    final bajadas = inv.activosDe(capa.codigo).length;

    return InkWell(
      onTap: () =>
          context.read<InventarioController>().alternarCapa(capa.codigo),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 7, 16, 7),
        child: Row(
          children: [
            // La casilla, dibujada a mano: un Checkbox de Material sobre
            // oscuro arrastra su propio color de marca y su área táctil de
            // 48 px, que aquí descuadra la lista.
            Container(
              width: 19,
              height: 19,
              decoration: BoxDecoration(
                color: encendida ? AppColors.verde : Colors.transparent,
                borderRadius: BorderRadius.circular(5),
                border: Border.all(
                  color: encendida ? AppColors.verde : Colors.white30,
                  width: 1.6,
                ),
              ),
              child: encendida
                  ? const Icon(Icons.check, size: 13, color: Colors.white)
                  : null,
            ),
            const SizedBox(width: 11),

            // El símbolo con el que sale en el mapa, para poder emparejar
            // la lista con lo que se ve detrás sin tener que probar. La
            // capa apagada lo lleva atenuado: sigue diciendo cuál es, pero
            // sin competir con las encendidas.
            SizedBox(
              width: 24,
              child: Center(
                child: Opacity(
                  opacity: encendida ? 1 : 0.45,
                  child: SimboloCapa(capa: capa),
                ),
              ),
            ),
            const SizedBox(width: 10),

            Expanded(
              child: Text(
                capa.label,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontSize: 13.5,
                  fontWeight: FontWeight.w600,
                  color: encendida
                      ? AppColors.cristalTexto
                      : AppColors.cristalSuave,
                ),
              ),
            ),

            if (cargando)
              const SizedBox(
                width: 13,
                height: 13,
                child: CircularProgressIndicator(
                    strokeWidth: 2, color: AppColors.cristalSuave),
              )
            else
              Text(
                // Cuántos hay según el servidor y, si ya se bajaron y no
                // cuadran —porque el ámbito filtra—, cuántos se están
                // dibujando. Un número solo haría pensar que faltan.
                encendida && bajadas > 0 && total != null && bajadas != total
                    ? '$bajadas/$total'
                    : '${total ?? '—'}',
                style: const TextStyle(
                    fontSize: 11.5,
                    color: AppColors.cristalSuave,
                    fontWeight: FontWeight.w600),
              ),
          ],
        ),
      ),
    );
  }
}
