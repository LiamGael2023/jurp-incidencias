import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

/// Entrar al sistema.
///
/// EL PADRÓN ES EL DE SIEMPRE: el mismo de PLUVIRA y el de la web. Quien ya
/// entra a NEXHYDRO entra aquí con su clave, sin dar de alta a nadie otra
/// vez. Por eso el endpoint es el de riego y no uno propio del inventario.
///
/// SE DICE QUE ES «web» A PROPÓSITO. En PLUVIRA cada cuenta queda atada al
/// celular desde el que entra, para que prestar la clave no sirva. Esta app
/// la usan varios inspectores y a veces desde el teléfono de otro —se
/// quedan sin batería en el cerro—, así que va exenta, igual que el
/// navegador. El servidor solo exime a quien lo dice de forma explícita.
class AuthService {
  /// El Linode nuevo. Es el mismo host que sirve la web: /api sale al
  /// contenedor de riego y /vigapi al de vigilantes, y nginx reparte.
  static const String servidor = 'https://nexhydro.jriegopresurizado.org.pe';

  static const String _urlLogin = '$servidor/api/v1/mobile/auth/login/';

  static const _kToken = 'userToken';
  static const _kNombre = 'userName';
  static const _kUsuario = 'userUsername';

  /// → null si entró; si no, el motivo, ya en castellano y para enseñar.
  Future<String?> entrar(String usuario, String clave) async {
    try {
      final r = await http
          .post(
            Uri.parse(_urlLogin),
            headers: {'Content-Type': 'application/json'},
            body: jsonEncode({
              'username': usuario.trim(),
              'password': clave.trim(),
              'plataforma': 'web',
            }),
          )
          .timeout(const Duration(seconds: 25));

      final d = jsonDecode(r.body) as Map<String, dynamic>;

      if (r.statusCode == 200 && (d['ok'] == true || d['token'] != null)) {
        final token = '${d['token'] ?? d['key'] ?? ''}';
        if (token.isEmpty) return 'El servidor no devolvió una sesión válida';

        final u = (d['user'] as Map?) ?? const {};
        final nombre = [
          '${u['first_name'] ?? ''}',
          '${u['last_name'] ?? ''}',
        ].where((s) => s.trim().isNotEmpty).join(' ').trim();

        final p = await SharedPreferences.getInstance();
        await p.setString(_kToken, token);
        await p.setString(_kUsuario, '${u['username'] ?? usuario.trim()}');
        await p.setString(
            _kNombre, nombre.isEmpty ? '${u['username'] ?? usuario}' : nombre);
        return null;
      }

      // El mensaje del servidor, cuando lo hay, dice más que uno genérico.
      final detalle = d['message'] ?? d['detail'] ?? d['error'];
      if (detalle != null) return '$detalle';
      if (r.statusCode == 401 || r.statusCode == 400) {
        return 'Usuario o contraseña incorrectos';
      }
      return 'El servidor respondió ${r.statusCode}';
    } catch (e) {
      // En campo esto es casi siempre falta de señal, no un servidor caído.
      return 'No se pudo conectar. Revisa la señal e inténtalo otra vez.';
    }
  }

  Future<void> salir() async {
    final p = await SharedPreferences.getInstance();
    for (final k in [_kToken, _kNombre, _kUsuario]) {
      await p.remove(k);
    }
  }

  Future<String?> get token async =>
      (await SharedPreferences.getInstance()).getString(_kToken);

  Future<String> get nombre async =>
      (await SharedPreferences.getInstance()).getString(_kNombre) ?? '';

  Future<bool> get haySesion async => (await token)?.isNotEmpty ?? false;
}
