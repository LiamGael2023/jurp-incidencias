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
      // El degradado verde ocupa la pantalla y la tarjeta blanca flota
      // encima, como el login de PLUVIRA con su tarjeta azul. Es la familia
      // visual de las apps de la Junta: quien entra reconoce la casa antes
      // de leer el título.
      body: Container(
        decoration: const BoxDecoration(
          gradient: LinearGradient(
            colors: [AppColors.verde, AppColors.verdeOscuro, Color(0xFF05513B)],
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
          ),
        ),
        child: SafeArea(
          child: Center(
            child: SingleChildScrollView(
              padding: const EdgeInsets.symmetric(horizontal: 22, vertical: 28),
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 440),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Padding(
                      padding: const EdgeInsets.only(bottom: 26),
                      child: Column(
                        children: [
                          Image.asset('assets/img/logo-inventario-min.png',
                              height: 62, fit: BoxFit.contain),
                          const SizedBox(height: 14),
                          const Text(
                            'INVENTARIO',
                            textAlign: TextAlign.center,
                            style: TextStyle(
                              fontSize: 26,
                              letterSpacing: 2.4,
                              fontWeight: FontWeight.w800,
                              color: Colors.white,
                              height: 1.1,
                            ),
                          ),
                          const SizedBox(height: 4),
                          Text(
                            'Junta de Riego Presurizado Moche Virú Chao',
                            textAlign: TextAlign.center,
                            style: TextStyle(
                              fontSize: 12.5,
                              color: Colors.white.withOpacity(0.82),
                            ),
                          ),
                        ],
                      ),
                    ),
                    _Tarjeta(child: _formulario()),
                    const SizedBox(height: 18),
                    Text(
                      'Infraestructura de riego · Campaña vigente',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        fontSize: 11.5,
                        color: Colors.white.withOpacity(0.7),
                      ),
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

  Widget _formulario() {
    return Form(
                key: _form,
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    const Text(
                      'Iniciar sesión',
                      style: TextStyle(
                          fontSize: 17,
                          fontWeight: FontWeight.w800,
                          color: AppColors.tinta),
                    ),
                    const SizedBox(height: 4),
                    const Text(
                      'Con tus credenciales de siempre.',
                      style: TextStyle(fontSize: 12.5, color: AppColors.gris),
                    ),
                    const SizedBox(height: 22),
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
              );
  }
}

/// La tarjeta blanca sobre el degradado.
class _Tarjeta extends StatelessWidget {
  final Widget child;
  const _Tarjeta({required this.child});

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.fromLTRB(22, 22, 22, 24),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(20),
          boxShadow: const [
            BoxShadow(
                color: Color(0x33000000), blurRadius: 24, offset: Offset(0, 10)),
          ],
        ),
        child: child,
      );
}
