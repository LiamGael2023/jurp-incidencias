import 'package:flutter/material.dart';
import 'package:open_filex/open_filex.dart';
import 'package:provider/provider.dart';
import 'package:share_plus/share_plus.dart';

import '../../controllers/inventario_controller.dart';
import '../../models/modelos.dart';
import '../../utils/app_colors.dart';
import '../../utils/catalogo_capas.dart';

/// Avance de la campaña y los formatos oficiales del ANA.
///
/// Los archivos NO se arman en el teléfono: los genera el mismo backend que
/// los genera para la web, así que el Excel que baja un inspector es
/// idéntico al que revisa la Junta. Armarlos aquí habría significado dos
/// generadores que se separan al primer cambio de formato.
class ReportesPage extends StatefulWidget {
  const ReportesPage({super.key});

  @override
  State<ReportesPage> createState() => _ReportesPageState();
}

class _ReportesPageState extends State<ReportesPage> {
  String _ambito = 'JURP';
  List<Formato>? _formatos;
  String? _error;
  String? _bajando;

  @override
  void initState() {
    super.initState();
    _cargar();
  }

  Future<void> _cargar() async {
    setState(() {
      _formatos = null;
      _error = null;
    });
    final inv = context.read<InventarioController>();
    try {
      final f = await inv.api.formatos(_ambito, inv.campania?.id);
      if (mounted) setState(() => _formatos = f);
    } catch (e) {
      if (mounted) {
        setState(() {
          _formatos = [];
          _error = e.toString().replaceFirst('Exception: ', '');
        });
      }
    }
  }

  Future<void> _descargar(Formato f) async {
    setState(() {
      _bajando = f.clave;
      _error = null;
    });
    final inv = context.read<InventarioController>();
    try {
      final archivo = await inv.api
          .descargarFormato(f.clave, f.archivo, _ambito, inv.campania?.id);
      if (!mounted) return;
      setState(() => _bajando = null);

      // Se abre con la app que el teléfono tenga para hojas de cálculo; si
      // no hay ninguna, se ofrece compartirlo —que es lo que acaba pasando
      // en campo: va por WhatsApp a la oficina—.
      final r = await OpenFilex.open(archivo.path);
      if (r.type != ResultType.done && mounted) {
        await Share.shareXFiles([XFile(archivo.path)], text: f.titulo);
      }
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _bajando = null;
        _error = e.toString().replaceFirst('Exception: ', '');
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final inv = context.watch<InventarioController>();
    final formatos = _formatos;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Reportes'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: _cargar,
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(14, 14, 14, 30),
        children: [
          _Resumen(inv: inv),
          const SizedBox(height: 16),

          const Text('Avance por tipo de activo',
              style: TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
          const SizedBox(height: 8),
          for (final a in inv.avance.where((x) => x.total > 0))
            _FilaAvance(a: a),

          const SizedBox(height: 22),
          const Text('Formatos oficiales',
              style: TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
          const SizedBox(height: 10),
          SegmentedButton<String>(
            segments: const [
              ButtonSegment(value: 'JURP', label: Text('JURP')),
              ButtonSegment(value: 'PECH', label: Text('Chavimochic')),
              ButtonSegment(value: 'todos', label: Text('Todo')),
            ],
            selected: {_ambito},
            showSelectedIcon: false,
            onSelectionChanged: (s) {
              setState(() => _ambito = s.first);
              _cargar();
            },
          ),
          const SizedBox(height: 12),

          if (_error != null)
            Container(
              padding: const EdgeInsets.all(12),
              margin: const EdgeInsets.only(bottom: 12),
              decoration: BoxDecoration(
                color: const Color(0xFFFEF2F2),
                border: Border.all(color: const Color(0xFFFECACA)),
                borderRadius: BorderRadius.circular(10),
              ),
              child: Text(_error!,
                  style: const TextStyle(color: Color(0xFFB91C1C))),
            ),

          if (formatos == null)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 24),
              child: Center(child: CircularProgressIndicator()),
            )
          else if (formatos.isEmpty)
            const Text('No hay formatos disponibles para este ámbito.',
                style: TextStyle(color: AppColors.gris))
          else
            for (final f in formatos)
              _FilaFormato(
                f: f,
                bajando: _bajando == f.clave,
                onTap: () => _descargar(f),
              ),

          const SizedBox(height: 14),
          const Text(
            'Los formatos que no están generados se arman al pedirlos y '
            'pueden tardar unos segundos. Una vez creados quedan guardados '
            'y se rehacen solo cuando cambian los datos.',
            style: TextStyle(fontSize: 12.5, color: AppColors.gris),
          ),
        ],
      ),
    );
  }
}

class _Resumen extends StatelessWidget {
  final InventarioController inv;
  const _Resumen({required this.inv});

  @override
  Widget build(BuildContext context) {
    final pct = inv.porcentaje;
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        border: Border.all(color: AppColors.borde),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            inv.campania == null
                ? 'Sin campaña vigente'
                : 'Campaña ${inv.campania!.anio}',
            style: const TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w800,
                color: AppColors.tinta),
          ),
          const SizedBox(height: 10),
          ClipRRect(
            borderRadius: BorderRadius.circular(5),
            child: LinearProgressIndicator(
              value: pct / 100,
              minHeight: 10,
              backgroundColor: const Color(0xFFE6EEF7),
              // Las mismas bandas que el visor web: rojo hasta 25, naranja
              // hasta 75, verde de ahí para arriba. Que el mismo número se
              // vea del mismo color en los dos sitios no es decoración.
              valueColor: AlwaysStoppedAnimation(pct < 25
                  ? const Color(0xFFE03131)
                  : pct < 75
                      ? const Color(0xFFF59F00)
                      : AppColors.verde),
            ),
          ),
          const SizedBox(height: 8),
          Text(
            '${inv.evaluadosCampania} de ${inv.totalCampania} evaluados '
            '· ${pct.toStringAsFixed(1)} %',
            style: const TextStyle(color: AppColors.gris),
          ),
        ],
      ),
    );
  }
}

class _FilaAvance extends StatelessWidget {
  final AvanceCapa a;
  const _FilaAvance({required this.a});

  @override
  Widget build(BuildContext context) {
    final capa = capaPorCodigo(a.tipoActivo);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 5),
      child: Row(
        children: [
          Container(
            width: 11,
            height: 11,
            decoration: BoxDecoration(
              color: capa?.color ?? AppColors.gris,
              borderRadius: BorderRadius.circular(3),
            ),
          ),
          const SizedBox(width: 9),
          Expanded(
            child: Text(capa?.label ?? a.tipoActivo,
                style: const TextStyle(fontSize: 14),
                overflow: TextOverflow.ellipsis),
          ),
          Text('${a.evaluados}/${a.total}',
              style: const TextStyle(
                  fontSize: 13.5,
                  fontWeight: FontWeight.w700,
                  color: AppColors.tinta)),
        ],
      ),
    );
  }
}

class _FilaFormato extends StatelessWidget {
  final Formato f;
  final bool bajando;
  final VoidCallback onTap;

  const _FilaFormato(
      {required this.f, required this.bajando, required this.onTap});

  String get _peso {
    if (f.tamano <= 0) return '';
    if (f.tamano < 1024) return '${f.tamano} B';
    if (f.tamano < 1048576) return '${(f.tamano / 1024).round()} KB';
    return '${(f.tamano / 1048576).toStringAsFixed(1)} MB';
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      decoration: BoxDecoration(
        color: Colors.white,
        border: Border.all(color: AppColors.borde),
        borderRadius: BorderRadius.circular(10),
      ),
      child: ListTile(
        onTap: bajando ? null : onTap,
        leading: bajando
            ? const SizedBox(
                width: 22,
                height: 22,
                child: CircularProgressIndicator(strokeWidth: 2.2))
            : Icon(
                f.listo ? Icons.description : Icons.build_circle_outlined,
                color: f.listo ? AppColors.verde : AppColors.gris,
              ),
        title: Text(f.titulo, style: const TextStyle(fontSize: 14.5)),
        subtitle: Text(
          f.listo ? 'Generado · $_peso' : 'Se arma al pedirlo',
          style: const TextStyle(fontSize: 12.5),
        ),
        trailing: const Icon(Icons.download_outlined),
      ),
    );
  }
}
