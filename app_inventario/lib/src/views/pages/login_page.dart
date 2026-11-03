import 'package:flutter/material.dart';

import '../../services/auth_service.dart';
import '../../utils/app_colors.dart';
import 'mapa_page.dart';

/// La puerta. Las credenciales son las de siempre —el padrón de riego—, así
/// que aquí no se da de alta a nadie ni se recupera ninguna clave: eso se
/// hace donde se hacía, y poner un enlace que lleva a una pantalla que no
/// existe es peor que no ponerlo.
class LoginPage extends StatefulWidget {
  const LoginPage({super.key});

  @override
  State<LoginPage> createState() => _LoginPageState();
}

class _LoginPageState extends State<LoginPage> {
  final _usuario = TextEditingController();
  final _clave = TextEditingController();
  final _form = GlobalKey<FormState>();

  bool _cargando = false;
  bool _verClave = false;
  String? _error;

  @override
  void dispose() {
    _usuario.dispose();
    _clave.dispose();
    super.dispose();
  }

  Future<void> _entrar() async {
    if (!_form.currentState!.validate()) return;
    setState(() {
      _cargando = true;
      _error = null;
    });

    final fallo = await AuthService().entrar(_usuario.text, _clave.text);

    if (!mounted) return;
    if (fallo == null) {
      Navigator.of(context).pushReplacement(
        MaterialPageRoute(builder: (_) => const MapaPage()),
      );
    } else {
      setState(() {
        _cargando = false;
        _error = fallo;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.white,
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(horizontal: 28, vertical: 32),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Form(
                key: _form,
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Image.asset('assets/img/logo-inventario.png',
                        height: 64, fit: BoxFit.contain),
                    const SizedBox(height: 10),
                    const Text(
                      'Inventario de infraestructura',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.w700,
                          color: AppColors.tinta),
                    ),
                    const SizedBox(height: 6),
                    const Text(
                      'Junta de Riego Presurizado Moche Virú Chao',
                      textAlign: TextAlign.center,
                      style: TextStyle(fontSize: 13, color: AppColors.gris),
                    ),
                    const SizedBox(height: 32),
                    TextFormField(
                      controller: _usuario,
                      autocorrect: false,
                      enableSuggestions: false,
                      textInputAction: TextInputAction.next,
                      decoration: const InputDecoration(
                        labelText: 'Usuario',
                        prefixIcon: Icon(Icons.person_outline),
                      ),
                      validator: (v) => (v == null || v.trim().isEmpty)
                          ? 'Escribe tu usuario'
                          : null,
                    ),
                    const SizedBox(height: 14),
                    TextFormField(
                      controller: _clave,
                      obscureText: !_verClave,
                      textInputAction: TextInputAction.done,
                      onFieldSubmitted: (_) => _entrar(),
                      decoration: InputDecoration(
                        labelText: 'Contraseña',
                        prefixIcon: const Icon(Icons.lock_outline),
                        // En campo se teclea con una mano y al sol; poder
                        // ver lo que se escribió evita el tercer intento
                        // fallido y el bloqueo de la cuenta.
                        suffixIcon: IconButton(
                          icon: Icon(_verClave
                              ? Icons.visibility_off_outlined
                              : Icons.visibility_outlined),
                          onPressed: () =>
                              setState(() => _verClave = !_verClave),
                        ),
                      ),
                      validator: (v) => (v == null || v.isEmpty)
                          ? 'Escribe tu contraseña'
                          : null,
                    ),
                    if (_error != null) ...[
                      const SizedBox(height: 16),
                      Container(
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: const Color(0xFFFEF2F2),
                          border: Border.all(color: const Color(0xFFFECACA)),
                          borderRadius: BorderRadius.circular(10),
                        ),
                        child: Row(
                          children: [
                            const Icon(Icons.error_outline,
                                color: Color(0xFFB91C1C), size: 20),
                            const SizedBox(width: 10),
                            Expanded(
                              child: Text(_error!,
                                  style: const TextStyle(
                                      color: Color(0xFFB91C1C),
                                      fontSize: 13.5)),
                            ),
                          ],
                        ),
                      ),
                    ],
                    const SizedBox(height: 24),
                    ElevatedButton(
                      onPressed: _cargando ? null : _entrar,
                      child: _cargando
                          ? const SizedBox(
                              height: 22,
                              width: 22,
                              child: CircularProgressIndicator(
                                  strokeWidth: 2.4, color: Colors.white),
                            )
                          : const Text('INICIAR SESIÓN'),
                    ),
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
