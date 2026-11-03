import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../controllers/inventario_controller.dart';
import '../../utils/app_colors.dart';
import '../../utils/catalogo_capas.dart';

/// Qué se ve en el mapa.
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
      width: 330,
      child: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 14, 10, 6),
              child: Row(
                children: [
                  const Expanded(
                    child: Text('Capas',
                        style: TextStyle(
                            fontSize: 18,
                            fontWeight: FontWeight.w800,
                            color: AppColors.tinta)),
                  ),
                  IconButton(
                    icon: const Icon(Icons.close),
                    onPressed: () => Navigator.of(context).pop(),
                  ),
                ],
              ),
            ),

            // Ámbito. Es un filtro del servidor, no de la pantalla: cambiarlo
            // vuelve a pedir las capas encendidas.
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: SegmentedButton<String>(
                segments: const [
                  ButtonSegment(value: 'todo', label: Text('Todo')),
                  ButtonSegment(value: 'JURP', label: Text('JURP')),
                  ButtonSegment(value: 'PECH', label: Text('PECH')),
                ],
                selected: {inv.ambito},
                showSelectedIcon: false,
                onSelectionChanged: (s) =>
                    context.read<InventarioController>().cambiarAmbito(s.first),
              ),
            ),

            Padding(
              padding: const EdgeInsets.fromLTRB(16, 10, 16, 4),
              child: Row(
                children: [
                  TextButton(
                    onPressed: () => context
                        .read<InventarioController>()
                        .todasLasCapasVisibles(true),
                    child: const Text('Encender todas'),
                  ),
                  const Spacer(),
                  TextButton(
                    onPressed: () => context
                        .read<InventarioController>()
                        .todasLasCapasVisibles(false),
                    child: const Text('Apagar todas'),
                  ),
                ],
              ),
            ),
            const Divider(height: 1),

            Expanded(
              child: ListView(
                padding: const EdgeInsets.only(bottom: 24),
                children: [
                  for (final g in gruposCapas) ...[
                    Padding(
                      padding: const EdgeInsets.fromLTRB(16, 16, 16, 6),
                      child: Text(
                        g.titulo.toUpperCase(),
                        style: TextStyle(
                          fontSize: 11,
                          letterSpacing: 0.7,
                          fontWeight: FontWeight.w800,
                          color: g.contexto
                              ? AppColors.gris
                              : AppColors.verdeOscuro,
                        ),
                      ),
                    ),
                    for (final c in g.capas)
                      if (!c.oculta) _FilaCapa(capa: c, inv: inv),
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

    return CheckboxListTile(
      dense: true,
      value: encendida,
      controlAffinity: ListTileControlAffinity.leading,
      onChanged: (_) =>
          context.read<InventarioController>().alternarCapa(capa.codigo),
      title: Row(
        children: [
          Container(
            width: 13,
            height: 13,
            decoration: BoxDecoration(
              color: capa.color,
              shape: capa.tipo == TipoGeom.punto
                  ? BoxShape.circle
                  : BoxShape.rectangle,
              borderRadius:
                  capa.tipo == TipoGeom.punto ? null : BorderRadius.circular(3),
              border: Border.all(color: Colors.black26),
            ),
          ),
          const SizedBox(width: 9),
          Expanded(
            child: Text(capa.label,
                style: const TextStyle(fontSize: 14),
                overflow: TextOverflow.ellipsis),
          ),
          if (cargando)
            const SizedBox(
                width: 13,
                height: 13,
                child: CircularProgressIndicator(strokeWidth: 2))
          else
            Text(
              // Cuántos hay según el servidor y, si ya se bajaron y no
              // cuadran -porque el ámbito filtra-, cuántos se están
              // dibujando. Un número solo haría pensar que faltan.
              encendida && bajadas > 0 && total != null && bajadas != total
                  ? '$bajadas/$total'
                  : '${total ?? '—'}',
              style: const TextStyle(fontSize: 12, color: AppColors.gris),
            ),
        ],
      ),
    );
  }
}
