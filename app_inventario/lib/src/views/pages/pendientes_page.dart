import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../controllers/inventario_controller.dart';
import '../../services/pendientes_service.dart';
import '../../utils/app_colors.dart';
import '../../utils/app_theme.dart';
import '../../utils/catalogo_capas.dart';

/// La bandeja: lo que se evaluó sin señal y todavía no está en el servidor.
///
/// Existe para que se pueda VER. Una cola invisible es una promesa: el
/// inspector supone que ya subió, borra las fotos del teléfono y el dato se
/// pierde dos semanas después, cuando alguien repasa la campaña. Aquí se
/// cuenta, se nombra y se sube a mano.
class PendientesPage extends StatefulWidget {
  const PendientesPage({super.key});

  @override
  State<PendientesPage> createState() => _PendientesPageState();
}

class _PendientesPageState extends State<PendientesPage> {
  List<Pendiente>? _lista;
  bool _enviando = false;

  @override
  void initState() {
    super.initState();
    _cargar();
  }

  Future<void> _cargar() async {
    final l = await context.read<InventarioController>().bandeja.todos();
    if (mounted) setState(() => _lista = l);
  }

  Future<void> _enviar() async {
    setState(() => _enviando = true);
    final r = await context.read<InventarioController>().enviarPendientes();
    await _cargar();
    if (!mounted) return;
    setState(() => _enviando = false);

    final texto = r.fallos.isEmpty
        ? 'Se subieron ${r.subidas}.'
        : 'Se subieron ${r.subidas}. Quedaron problemas:\n'
            '${r.fallos.take(4).join('\n')}';
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      content: Text(texto),
      duration: const Duration(seconds: 6),
      backgroundColor:
          r.fallos.isEmpty ? AppColors.verdeOscuro : const Color(0xFFD9480F),
    ));
  }

  @override
  Widget build(BuildContext context) {
    final lista = _lista;

    return Scaffold(
      appBar: AppBar(title: const Text('Pendientes de subir')),
      body: lista == null
          ? const Center(child: CircularProgressIndicator())
          : lista.isEmpty
              ? const _Vacio()
              : ListView.separated(
                  padding: const EdgeInsets.all(14),
                  itemCount: lista.length,
                  separatorBuilder: (_, __) => const SizedBox(height: 10),
                  itemBuilder: (_, i) {
                    final x = lista[i];
                    final capa = capaPorCodigo(x.tipo);
                    return Container(
                      padding: const EdgeInsets.all(13),
                      decoration: AppTheme.tarjeta,
                      child: Row(
                        children: [
                          const Icon(Icons.cloud_off_outlined,
                              color: Color(0xFFD9480F)),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(x.nombre,
                                    style: const TextStyle(
                                        fontWeight: FontWeight.w800,
                                        color: AppColors.tinta)),
                                Text(
                                  '${capa?.label ?? x.tipo}'
                                  '${x.fotos.isEmpty ? '' : ' · ${x.fotos.length} foto(s)'}',
                                  style: const TextStyle(
                                      fontSize: 12.5, color: AppColors.gris),
                                ),
                                Text(_cuando(x.cuando),
                                    style: const TextStyle(
                                        fontSize: 12, color: AppColors.gris)),
                              ],
                            ),
                          ),
                        ],
                      ),
                    );
                  },
                ),
      bottomNavigationBar: lista == null || lista.isEmpty
          ? null
          : SafeArea(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(14, 8, 14, 12),
                child: ElevatedButton.icon(
                  onPressed: _enviando ? null : _enviar,
                  icon: _enviando
                      ? const SizedBox(
                          height: 18,
                          width: 18,
                          child: CircularProgressIndicator(
                              strokeWidth: 2.2, color: Colors.white))
                      : const Icon(Icons.cloud_upload_outlined),
                  label: Text(_enviando
                      ? 'Subiendo…'
                      : 'SUBIR ${lista.length} FICHA(S)'),
                ),
              ),
            ),
    );
  }

  String _cuando(DateTime d) {
    final dos = (int n) => n.toString().padLeft(2, '0');
    return 'Evaluada el ${dos(d.day)}/${dos(d.month)}/${d.year} '
        'a las ${dos(d.hour)}:${dos(d.minute)}';
  }
}

class _Vacio extends StatelessWidget {
  const _Vacio();

  @override
  Widget build(BuildContext context) => const Center(
        child: Padding(
          padding: EdgeInsets.all(30),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.cloud_done_outlined, size: 48, color: AppColors.verde),
              SizedBox(height: 14),
              Text('Todo subido',
                  style:
                      TextStyle(fontSize: 17, fontWeight: FontWeight.w800)),
              SizedBox(height: 6),
              Text(
                'No queda ninguna ficha esperando señal.',
                textAlign: TextAlign.center,
                style: TextStyle(color: AppColors.gris),
              ),
            ],
          ),
        ),
      );
}
