import 'package:flutter/material.dart';

import '../../services/auth_service.dart';
import '../../utils/app_colors.dart';
import 'mapa_page.dart';

/// La puerta.
///
/// Sigue el patrón del login de PLUVIRA, que es el que la Junta ya reconoce:
/// barra de marca arriba, fondo claro con el logo del producto, y el
/// formulario dentro de una tarjeta oscura con sombra grande. Cambia el
/// color —verde en vez de azul— porque cambia el producto, no el patrón.
///
/// Las credenciales son las de siempre, el padrón de riego, así que aquí no
/// se da de alta a nadie ni se recupera ninguna clave: eso se hace donde se
/// hacía. Un enlace que lleva a una pantalla que no existe es peor que no
/// poner enlace.
class LoginPage extends StatefulWidget {
  const LoginPage({super.key});

  @override
  State<LoginPage> createState() => _LoginPageState();
}

class _LoginPageState extends State<LoginPage> {
  final _usuario = TextEditingController();
  final _clave = TextEditingController();
  final _focoUsuario = FocusNode();
  final _focoClave = FocusNode();

  bool _cargando = false;
  bool _verClave = false;
  String? _error;

  @override
  void dispose() {
    _usuario.dispose();
    _clave.dispose();
    _focoUsuario.dispose();
    _focoClave.dispose();
    super.dispose();
  }

  Future<void> _entrar() async {
    FocusScope.of(context).unfocus();

    if (_usuario.text.trim().isEmpty || _clave.text.isEmpty) {
      setState(() => _error = 'Completa usuario y contraseña.');
      return;
    }

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
      backgroundColor: AppColors.fondo,
      body: SafeArea(
        bottom: false,
        child: Column(
          children: [
            // Barra de 6 px con los colores de la marca, como en PLUVIRA.
            Container(
              height: 6,
              decoration: const BoxDecoration(
                gradient: LinearGradient(
                  colors: [
                    AppColors.verdeOscuro,
                    AppColors.verde,
                    AppColors.azul
                  ],
                  stops: [0.0, 0.6, 1.0],
                ),
              ),
            ),
            Expanded(
              child: Stack(
                children: [
                  // Fondo apenas insinuado. RepaintBoundary porque no cambia
                  // nunca y no tiene por qué repintarse cada vez que se
                  // teclea una letra.
                  const Positioned.fill(
                    child: RepaintBoundary(
                      child: CustomPaint(painter: _FondoAgua()),
                    ),
                  ),
                  LayoutBuilder(
                    builder: (context, medidas) => SingleChildScrollView(
                      physics: const ClampingScrollPhysics(),
                      child: ConstrainedBox(
                        constraints:
                            BoxConstraints(minHeight: medidas.maxHeight),
                        child: IntrinsicHeight(
                          child: Column(
                            children: [
                              const SizedBox(height: 26),
                              _marca(),
                              const SizedBox(height: 24),
                              Padding(
                                padding:
                                    const EdgeInsets.symmetric(horizontal: 22),
                                child: _tarjeta(),
                              ),
                              const Spacer(),
                              _pie(),
                              const SizedBox(height: 16),
                            ],
                          ),
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  // ── marca ─────────────────────────────────────────────────────────────

  Widget _marca() => Padding(
        padding: const EdgeInsets.symmetric(horizontal: 24),
        child: Column(
          children: [
            const Text(
              'JUNTA DE USUARIOS DE RIEGO PRESURIZADO',
              textAlign: TextAlign.center,
              style: TextStyle(
                color: AppColors.verdeOscuro,
                fontSize: 10.5,
                fontWeight: FontWeight.w600,
                letterSpacing: 2.6,
                height: 1.4,
              ),
            ),
            const SizedBox(height: 16),
            Image.asset(
              'assets/img/logo-inventario.png',
              height: 72,
              fit: BoxFit.contain,
              // Si el asset faltara, mejor el nombre escrito que un hueco
              // gris con un icono de imagen rota.
              errorBuilder: (_, __, ___) => const Text(
                'INVENTARIO',
                style: TextStyle(
                  color: AppColors.verde,
                  fontSize: 34,
                  fontWeight: FontWeight.w800,
                  letterSpacing: 2,
                ),
              ),
            ),
          ],
        ),
      );

  // ── tarjeta ───────────────────────────────────────────────────────────

  Widget _tarjeta() => Container(
        padding: const EdgeInsets.fromLTRB(22, 26, 22, 24),
        decoration: BoxDecoration(
          gradient: const LinearGradient(
            colors: [Color(0xFF0F9B72), Color(0xFF05543E)],
            begin: Alignment(-0.34, -1),
            end: Alignment(0.34, 1),
          ),
          borderRadius: BorderRadius.circular(24),
          boxShadow: const [
            BoxShadow(
              color: Color(0x4D05543E),
              blurRadius: 38,
              offset: Offset(0, 16),
            ),
          ],
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text(
              'Ingresa a tu cuenta',
              style: TextStyle(
                color: Colors.white,
                fontSize: 23,
                fontWeight: FontWeight.w700,
                letterSpacing: -0.3,
                height: 1.2,
              ),
            ),
            const SizedBox(height: 4),
            const Text(
              'Usa el usuario que te asignó la JURP.',
              style: TextStyle(
                color: Color(0xBFFFFFFF),
                fontSize: 13,
                height: 1.4,
              ),
            ),
            const SizedBox(height: 20),

            _campo(
              etiqueta: 'Usuario',
              controlador: _usuario,
              foco: _focoUsuario,
              pista: 'Ej. jperez',
              icono: Icons.person_outline,
              accion: TextInputAction.next,
              alEnviar: () => _focoClave.requestFocus(),
            ),
            const SizedBox(height: 14),
            _campo(
              etiqueta: 'Contraseña',
              controlador: _clave,
              foco: _focoClave,
              pista: '••••••••',
              icono: Icons.lock_outline,
              oculto: !_verClave,
              accion: TextInputAction.done,
              alEnviar: _entrar,
              // En campo se teclea con una mano y al sol; poder ver lo que
              // se escribió evita el tercer intento fallido y el bloqueo.
              sufijo: IconButton(
                icon: Icon(
                  _verClave
                      ? Icons.visibility_off_outlined
                      : Icons.visibility_outlined,
                  size: 20,
                  color: AppColors.gris,
                ),
                onPressed: () => setState(() => _verClave = !_verClave),
              ),
            ),

            if (_error != null) ...[
              const SizedBox(height: 16),
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: const Color(0x33FFFFFF),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: const Color(0x55FFFFFF)),
                ),
                child: Row(
                  children: [
                    const Icon(Icons.error_outline,
                        color: Colors.white, size: 19),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        _error!,
                        style: const TextStyle(
                            color: Colors.white, fontSize: 13, height: 1.35),
                      ),
                    ),
                  ],
                ),
              ),
            ],

            const SizedBox(height: 22),

            // Blanco sobre la tarjeta verde. En PLUVIRA el botón es naranja
            // porque la tarjeta es azul: lo que importa del patrón es que el
            // botón NO sea del color de la tarjeta. Aquí no se usa un naranja
            // porque ese tono ya significa «regular» en todo el resto de la
            // app, y un color no debería querer decir dos cosas.
            SizedBox(
              height: 54,
              child: ElevatedButton(
                onPressed: _cargando ? null : _entrar,
                style: ElevatedButton.styleFrom(
                  backgroundColor: Colors.white,
                  foregroundColor: AppColors.verdeOscuro,
                  disabledBackgroundColor: const Color(0x66FFFFFF),
                  elevation: 0,
                  shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(14)),
                  textStyle: const TextStyle(
                      fontSize: 15.5,
                      fontWeight: FontWeight.w800,
                      letterSpacing: 0.6),
                ),
                child: _cargando
                    ? const SizedBox(
                        height: 22,
                        width: 22,
                        child: CircularProgressIndicator(
                            strokeWidth: 2.6, color: AppColors.verdeOscuro),
                      )
                    : const Text('INICIAR SESIÓN'),
              ),
            ),
          ],
        ),
      );

  /// Un campo con su etiqueta encima.
  ///
  /// La etiqueta va fuera y no flotando dentro: una etiqueta flotante
  /// desaparece al escribir, y en un formulario de dos campos que se llena
  /// al sol, con una mano, eso basta para teclear la clave en el casillero
  /// del usuario.
  Widget _campo({
    required String etiqueta,
    required TextEditingController controlador,
    required FocusNode foco,
    required IconData icono,
    String? pista,
    bool oculto = false,
    Widget? sufijo,
    TextInputAction accion = TextInputAction.next,
    VoidCallback? alEnviar,
  }) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          etiqueta.toUpperCase(),
          style: const TextStyle(
            color: Color(0xD9FFFFFF),
            fontSize: 10.5,
            fontWeight: FontWeight.w700,
            letterSpacing: 1.1,
          ),
        ),
        const SizedBox(height: 7),
        TextField(
          controller: controlador,
          focusNode: foco,
          obscureText: oculto,
          autocorrect: false,
          enableSuggestions: false,
          textInputAction: accion,
          onSubmitted: (_) => alEnviar?.call(),
          onChanged: (_) {
            if (_error != null) setState(() => _error = null);
          },
          style: const TextStyle(
              fontSize: 15.5,
              color: AppColors.tinta,
              fontWeight: FontWeight.w600),
          decoration: InputDecoration(
            hintText: pista,
            hintStyle: const TextStyle(
                color: Color(0xFF93A3B8), fontWeight: FontWeight.w400),
            prefixIcon: Icon(icono, size: 20, color: AppColors.verde),
            suffixIcon: sufijo,
            filled: true,
            fillColor: Colors.white,
            contentPadding:
                const EdgeInsets.symmetric(horizontal: 14, vertical: 16),
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(14),
              borderSide: BorderSide.none,
            ),
            enabledBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(14),
              borderSide: BorderSide.none,
            ),
            focusedBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(14),
              borderSide: const BorderSide(color: Colors.white, width: 2),
            ),
          ),
        ),
      ],
    );
  }

  Widget _pie() => const Padding(
        padding: EdgeInsets.symmetric(horizontal: 30),
        child: Text(
          'Inventario de infraestructura de riego\n'
          'Moche · Virú · Chao',
          textAlign: TextAlign.center,
          style: TextStyle(
            color: AppColors.gris,
            fontSize: 11.5,
            height: 1.5,
          ),
        ),
      );
}

/// El fondo: tres manchas de agua muy tenues.
///
/// Apenas se ven, y esa es la idea: el fondo de un login tiene que dar
/// textura sin competir con los dos campos que hay que llenar. Son círculos
/// y no un dibujo elaborado porque esto se repinta a pantalla completa.
class _FondoAgua extends CustomPainter {
  const _FondoAgua();

  @override
  void paint(Canvas lienzo, Size medida) {
    final pincel = Paint()..style = PaintingStyle.fill;

    pincel.color = AppColors.verde.withOpacity(0.055);
    lienzo.drawCircle(
        Offset(medida.width * 0.88, medida.height * 0.08),
        medida.width * 0.38,
        pincel);

    pincel.color = AppColors.azul.withOpacity(0.045);
    lienzo.drawCircle(
        Offset(medida.width * 0.06, medida.height * 0.34),
        medida.width * 0.30,
        pincel);

    pincel.color = AppColors.verde.withOpacity(0.04);
    lienzo.drawCircle(
        Offset(medida.width * 0.78, medida.height * 0.92),
        medida.width * 0.42,
        pincel);
  }

  @override
  bool shouldRepaint(covariant CustomPainter viejo) => false;
}
