import 'dart:io';

import 'package:flutter/material.dart';
import 'package:open_filex/open_filex.dart';
import 'package:provider/provider.dart';
import 'package:share_plus/share_plus.dart';

import '../../controllers/inventario_controller.dart';
import '../../models/modelos.dart';
import '../../utils/app_colors.dart';
import '../../utils/app_theme.dart';
import '../../utils/catalogo_capas.dart';
import '../widgets/simbolo_capa.dart';

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

  /// Qué estado llevan los activos en el formato: null = el del
  /// levantamiento original; un año = el que se les registró en esa
  /// campaña. Arranca en null, como el visor web, porque es lo que siempre
  /// existe: una campaña recién abierta todavía no tiene nada evaluado y el
  /// formato saldría vacío.
  int? _anio;

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
      final f = await inv.api.formatos(_ambito, _anio);
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

  /// Baja algo y lo abre. `tarea` es lo que se marca como «bajando»: hace
  /// falta para que el Excel y el PDF del mismo formato no se enciendan a
  /// la vez, y para que las fichas tengan su propio indicador.
  Future<void> _bajarYAbrir(
      String tarea, String titulo, Future<File> Function() traer) async {
    setState(() {
      _bajando = tarea;
      _error = null;
    });
    try {
      final archivo = await traer();
      if (!mounted) return;
      setState(() => _bajando = null);

      // Se abre con la app que el teléfono tenga para hojas de cálculo o
      // PDF; si no hay ninguna, se ofrece compartirlo —que es lo que acaba
      // pasando en campo: va por WhatsApp a la oficina—.
      final r = await OpenFilex.open(archivo.path);
      if (r.type != ResultType.done && mounted) {
        await Share.shareXFiles([XFile(archivo.path)], text: titulo);
      }
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _bajando = null;
        _error = e.toString().replaceFirst('Exception: ', '');
      });
    }
  }

  Future<void> _descargar(Formato f, {bool pdf = false}) {
    final inv = context.read<InventarioController>();
    return _bajarYAbrir(
      pdf ? '${f.clave}:pdf' : f.clave,
      f.titulo,
      () => inv.api
          .descargarFormato(f.clave, f.archivo, _ambito, _anio, pdf: pdf),
    );
  }

  /// Todas las fichas ya evaluadas de la campaña, en un solo PDF.
  ///
  /// Es lo que se entrega: el talonario relleno. Sin campaña elegida no
  /// tiene sentido —el inventario base no tiene nada evaluado— y por eso el
  /// botón solo aparece con un año seleccionado.
  Future<void> _fichasEvaluadas() {
    final inv = context.read<InventarioController>();
    return _bajarYAbrir('fichas_evaluadas', 'Fichas evaluadas',
        () => inv.api.descargarFichas(
            tipo: 'todas',
            evaluadas: true,
            ambito: _ambito,
            anio: _anio));
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

          // Qué estado llevan los activos en el formato. Es la misma
          // elección que ofrece el visor web, y hace falta: una campaña
          // recién abierta no tiene nada evaluado, así que pedir el formato
          // «de la campaña» devuelve un archivo vacío que parece un fallo.
          DropdownButtonFormField<int?>(
            value: _anio,
            isExpanded: true,
            decoration: const InputDecoration(labelText: 'Estado a reportar'),
            items: [
              const DropdownMenuItem<int?>(
                value: null,
                child: Text('Inventario base (sin evaluar)'),
              ),
              for (final c in inv.campanias)
                DropdownMenuItem<int?>(
                  value: c.anio,
                  child: Text('Campaña ${c.anio}'),
                ),
            ],
            onChanged: (v) {
              setState(() => _anio = v);
              _cargar();
            },
          ),
          Padding(
            padding: const EdgeInsets.only(top: 6, bottom: 12),
            child: Text(
              _anio == null
                  ? 'Los activos salen con el estado del levantamiento '
                      'original.'
                  : 'Los activos toman el estado que se les registró en '
                      '$_anio.',
              style: const TextStyle(
                  fontSize: 12, color: AppColors.gris, height: 1.35),
            ),
          ),

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
                bajandoPdf: _bajando == '${f.clave}:pdf',
                onTap: () => _descargar(f),
                onPdf: () => _descargar(f, pdf: true),
              ),

          // Las fichas de inspección rellenas. Solo con campaña elegida: el
          // inventario base no tiene ninguna evaluada y el PDF saldría
          // vacío, que parece un fallo del generador y no lo es.
          if (_anio != null) ...[
            const SizedBox(height: 14),
            const Text('Fichas de inspección',
                style: TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
            const SizedBox(height: 8),
            Container(
              decoration: AppTheme.tarjeta,
              child: ListTile(
                onTap: _bajando == 'fichas_evaluadas' ? null : _fichasEvaluadas,
                leading: _bajando == 'fichas_evaluadas'
                    ? const SizedBox(
                        width: 22,
                        height: 22,
                        child: CircularProgressIndicator(strokeWidth: 2.2))
                    : const Icon(Icons.picture_as_pdf_outlined,
                        color: AppColors.verde),
                title: const Text('Fichas evaluadas de la campaña',
                    style: TextStyle(fontSize: 14.5)),
                // El contador solo vale si el año elegido es el que la app
                // tiene cargado: `inv.evaluaciones` son las de la campaña
                // activa, no las del año del desplegable. Enseñarlo para
                // otro año sería dar un número de otra campaña.
                subtitle: Text(
                  _anio == inv.campania?.anio
                      ? '${inv.evaluaciones.length} evaluadas en $_anio · '
                          'se arma al pedirlo'
                      : 'Las evaluadas en $_anio · se arma al pedirlo',
                  style: const TextStyle(fontSize: 12.5),
                ),
                trailing: const Icon(Icons.download_outlined),
              ),
            ),
          ],

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
      decoration: AppTheme.tarjeta,
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
    final capa = capaPorCodigo(a.tipo);
    // El nombre que manda el servidor manda; si no viene, el de la capa; y
    // si tampoco, el código pelado. Lo que nunca puede salir es un hueco.
    final titulo = a.nombre.isNotEmpty
        ? a.nombre
        : (capa?.label ?? (a.tipo.isEmpty ? 'Sin tipo' : a.tipo));

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 7),
      child: Row(
        children: [
          // El mismo símbolo que en el mapa y en el panel de capas. Con un
          // cuadrito de color, quince filas de tonos de azul no se
          // distinguen entre sí ni de lo que se ve en el mapa.
          SizedBox(width: 26, child: Center(child: SimboloCapa(capa: capa))),
          const SizedBox(width: 10),
          Expanded(
            child: Text(titulo,
                style: const TextStyle(fontSize: 14),
                overflow: TextOverflow.ellipsis),
          ),
          if (a.criticos > 0) ...[
            // Los críticos van aquí y no escondidos en un informe: son las
            // estructuras que hay que ir a arreglar.
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 1),
              decoration: BoxDecoration(
                color: const Color(0xFFC92A2A),
                borderRadius: BorderRadius.circular(9),
              ),
              child: Text('${a.criticos}',
                  style: const TextStyle(
                      color: Colors.white,
                      fontSize: 11,
                      fontWeight: FontWeight.w800)),
            ),
            const SizedBox(width: 8),
          ],
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
  final bool bajandoPdf;
  final VoidCallback onTap;
  final VoidCallback onPdf;

  const _FilaFormato({
    required this.f,
    required this.bajando,
    required this.bajandoPdf,
    required this.onTap,
    required this.onPdf,
  });

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
      decoration: AppTheme.tarjeta,
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
        // Dos salidas del mismo formato: la fila entera baja el Excel, que
        // es para seguir trabajando el dato, y el botón del PDF la versión
        // que se entrega y se firma. En campo casi siempre se quiere la
        // segunda, pero quien reporta a la oficina quiere la primera.
        trailing: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.download_outlined),
            const SizedBox(width: 2),
            bajandoPdf
                ? const SizedBox(
                    width: 22,
                    height: 22,
                    child: CircularProgressIndicator(strokeWidth: 2.2))
                : IconButton(
                    icon: const Icon(Icons.picture_as_pdf_outlined),
                    tooltip: 'En PDF',
                    color: AppColors.gris,
                    onPressed: bajando ? null : onPdf,
                  ),
          ],
        ),
      ),
    );
  }
}
