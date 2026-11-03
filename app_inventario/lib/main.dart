import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'src/controllers/inventario_controller.dart';
import 'src/services/auth_service.dart';
import 'src/utils/app_theme.dart';
import 'src/views/pages/login_page.dart';
import 'src/views/pages/mapa_page.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const AppInventario());
}

class AppInventario extends StatelessWidget {
  const AppInventario({super.key});

  @override
  Widget build(BuildContext context) {
    return ChangeNotifierProvider(
      create: (_) => InventarioController(),
      child: MaterialApp(
        title: 'Inventario JURP',
        debugShowCheckedModeBanner: false,
        theme: AppTheme.claro,
        home: const _Arranque(),
      ),
    );
  }
}

/// Decide a dónde entrar: si ya hay sesión guardada, al mapa; si no, al
/// login. Es una pantalla y no un `if` en main porque leer la sesión toca
/// disco y eso es asíncrono.
class _Arranque extends StatefulWidget {
  const _Arranque();

  @override
  State<_Arranque> createState() => _ArranqueState();
}

class _ArranqueState extends State<_Arranque> {
  late final Future<bool> _sesion = AuthService().haySesion;

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<bool>(
      future: _sesion,
      builder: (context, snap) {
        if (!snap.hasData) {
          return const Scaffold(
            body: Center(child: CircularProgressIndicator()),
          );
        }
        return snap.data! ? const MapaPage() : const LoginPage();
      },
    );
  }
}
