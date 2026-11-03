import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../controllers/inventario_controller.dart';
import '../../models/modelos.dart';
import '../../utils/app_colors.dart';
import '../../utils/catalogo_capas.dart';
import '../widgets/simbolo_capa.dart';

/// Buscar una estructura por su nombre, su canal o su progresiva.
///
/// POR QUÉ ES UNA PANTALLA Y NO UN DESPLEGABLE SOBRE EL MAPA. En el visor
/// web el buscador cabe encima del mapa porque hay sitio de sobra. En un
/// teléfono, al tocar el campo sube el teclado y se come media pantalla:
/// entre el teclado y la lista no queda mapa, así que fingir que sigue ahí
/// solo sirve para que los resultados salgan en una rendija de cuatro
/// líneas. A pantalla completa caben treinta.
///
/// BUSCA EN EL ÍNDICE, no en las capas descargadas. El índice son las dos
/// mil quinientas estructuras con lo justo para encontrarlas, y se pide una
/// sola vez. Si hubiera que tener las treinta y siete capas bajadas para
/// poder buscar, buscar sería lo último que haría nadie.
class BuscarPage extends StatefulWidget {
  const BuscarPage({super.key});

  @override
  State<BuscarPage> createState() => _BuscarPageState();
}

class _BuscarPageState extends State<BuscarPage> {
  final _campo = TextEditingController();
  final _foco = FocusNode();
  String _texto = '';

  @override
  void initState() {
    super.initState();
    // El teclado, abierto al entrar: se vino aquí a escribir.
    WidgetsBinding.instance
        .addPostFrameCallback((_) => _foco.requestFocus());
  }

  @override
  void dispose() {
    _campo.dispose();
    _foco.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final inv = context.watch<InventarioController>();
    final resultados = inv.buscar(_texto);
    final corto = normalizaBusqueda(_texto).length < 2;

    return Scaffold(
      appBar: AppBar(
        title: TextField(
          controller: _campo,
          focusNode: _foco,
          autocorrect: false,
          textInputAction: TextInputAction.search,
          style: const TextStyle(color: Colors.white, fontSize: 16),
          cursorColor: Colors.white,
          decoration: InputDecoration(
            border: InputBorder.none,
            filled: false,
            hintText: inv.indice.isEmpty
                ? 'Cargando el índice…'
                : 'Buscar entre ${inv.indice.length} activos…',
            hintStyle: const TextStyle(color: Colors.white70, fontSize: 15.5),
          ),
          onChanged: (v) => setState(() => _texto = v),
        ),
        actions: [
          if (_texto.isNotEmpty)
            IconButton(
              icon: const Icon(Icons.close),
              onPressed: () {
                _campo.clear();
                setState(() => _texto = '');
                _foco.requestFocus();
              },
            ),
        ],
      ),
      body: corto
          ? const _Pista(
              icono: Icons.search,
              texto: 'Escribe al menos dos letras.\nBusca por nombre, canal, '
                  'progresiva o tipo de estructura.',
            )
          : resultados.isEmpty
              ? const _Pista(
                  icono: Icons.search_off,
                  texto: 'Ninguna estructura coincide.',
                )
              : ListView.separated(
                  itemCount: resultados.length,
                  separatorBuilder: (_, __) => const Divider(height: 1),
                  itemBuilder: (_, i) =>
                      _Resultado(item: resultados[i], inv: inv),
                ),
    );
  }
}

class _Resultado extends StatelessWidget {
  final ItemIndice item;
  final InventarioController inv;
  const _Resultado({required this.item, required this.inv});

  @override
  Widget build(BuildContext context) {
    final capa = capaPorCodigo(item.tipo);
    final ev = inv.evaluacionDe(item.tipo, item.fid);

    final detalle = [
      capa?.label ?? item.tipo,
      if (item.canal.isNotEmpty) item.canal,
      if (item.progresiva.isNotEmpty) 'prog. ${item.progresiva}',
    ].join(' · ');

    return ListTile(
      // Sin coordenadas no hay a dónde volar. Se enseña igualmente —existe y
      // el inspector tiene que saberlo— pero apagada y sin poder pulsarla.
      enabled: item.ubicado,
      onTap: item.ubicado ? () => Navigator.of(context).pop(item) : null,
      leading: Container(
        width: 38,
        height: 38,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: (capa?.color ?? AppColors.gris).withOpacity(0.12),
          shape: BoxShape.circle,
        ),
        child: SimboloCapa(capa: capa, lado: 24),
      ),
      title: Text(
        item.nombre.isEmpty ? '#${item.fid}' : item.nombre,
        style: const TextStyle(
            fontWeight: FontWeight.w700, color: AppColors.tinta),
      ),
      subtitle: Text(
        item.ubicado ? detalle : '$detalle · sin ubicación',
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: const TextStyle(fontSize: 12.5),
      ),
      trailing: ev == null
          ? const Icon(Icons.chevron_right, color: AppColors.gris)
          : Container(
              width: 13,
              height: 13,
              decoration: BoxDecoration(
                color: AppColors.deEstado(ev.estadoCons),
                shape: BoxShape.circle,
                border: Border.all(color: Colors.white, width: 1.5),
              ),
            ),
    );
  }
}

class _Pista extends StatelessWidget {
  final IconData icono;
  final String texto;
  const _Pista({required this.icono, required this.texto});

  @override
  Widget build(BuildContext context) => Center(
        child: Padding(
          padding: const EdgeInsets.all(34),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icono, size: 44, color: AppColors.borde),
              const SizedBox(height: 14),
              Text(texto,
                  textAlign: TextAlign.center,
                  style: const TextStyle(color: AppColors.gris, height: 1.45)),
            ],
          ),
        ),
      );
}
