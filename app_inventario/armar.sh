#!/usr/bin/env bash
#
# Deja la app lista para ejecutar.
#
# QUÉ HACE Y POR QUÉ. Las carpetas android/ e ios/ no están en el
# repositorio: las genera Flutter y dependen de su versión, así que
# escribirlas a mano envejece mal y ensucia el historial en cada equipo.
# Este guion las genera, recupera el pubspec si `flutter create` lo pisó,
# añade los permisos de cámara y GPS —que `flutter create` no pone, y sin
# ellos la app arranca pero la cámara falla en silencio, que es lo peor que
# puede pasar en campo— y baja las librerías.
#
#   bash armar.sh          → prepara y deja todo listo
#   bash armar.sh --correr → además ejecuta en el dispositivo conectado
#
set -euo pipefail
cd "$(dirname "$0")"

ORG=pe.org.jriegopresurizado
NOMBRE=inventario_jurp

if ! command -v flutter >/dev/null 2>&1; then
  echo "No encuentro flutter en el PATH." >&2
  exit 1
fi

echo "==> Flutter: $(flutter --version | head -1)"

# ── 1. plataformas ────────────────────────────────────────────────────────
# `flutter create` sobre una carpeta que ya tiene lib/ y assets/ los respeta:
# solo añade lo que falta. El pubspec sí lo puede reescribir, y el nuestro
# tiene las versiones fijadas a las de PLUVIRA, así que se guarda antes.
cp pubspec.yaml /tmp/pubspec.inventario.bak
flutter create --org "$ORG" --project-name "$NOMBRE" \
               --platforms=android,ios . >/dev/null
cp /tmp/pubspec.inventario.bak pubspec.yaml
echo "==> android/ e ios/ generadas; pubspec intacto"

# ── 2. permisos de Android ────────────────────────────────────────────────
MANIFIESTO=android/app/src/main/AndroidManifest.xml
if [ -f "$MANIFIESTO" ] && ! grep -q ACCESS_FINE_LOCATION "$MANIFIESTO"; then
  python3 - "$MANIFIESTO" <<'PY'
import sys
ruta = sys.argv[1]
permisos = '''    <uses-permission android:name="android.permission.INTERNET"/>
    <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION"/>
    <uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION"/>
    <uses-permission android:name="android.permission.CAMERA"/>
    <!-- Android 13 en adelante, para elegir de la galeria -->
    <uses-permission android:name="android.permission.READ_MEDIA_IMAGES"/>
'''
t = open(ruta, encoding='utf-8').read()
# Van dentro de <manifest> y antes de <application>, que es donde el
# compilador de Android los espera.
i = t.find('<application')
print('permisos ya estaban' if 'ACCESS_FINE_LOCATION' in t
      else 'permisos anadidos')
if 'ACCESS_FINE_LOCATION' not in t and i > 0:
    open(ruta, 'w', encoding='utf-8').write(t[:i] + permisos + t[i:])
PY
  echo "==> permisos de Android puestos"
fi

# ── 3. permisos de iOS ────────────────────────────────────────────────────
PLIST=ios/Runner/Info.plist
if [ -f "$PLIST" ] && ! grep -q NSCameraUsageDescription "$PLIST"; then
  python3 - "$PLIST" <<'PY'
import sys
ruta = sys.argv[1]
claves = '''	<key>NSLocationWhenInUseUsageDescription</key>
	<string>Para ubicarte en el mapa junto a la estructura que vas a evaluar.</string>
	<key>NSCameraUsageDescription</key>
	<string>Para tomar la evidencia fotografica de cada estructura.</string>
	<key>NSPhotoLibraryUsageDescription</key>
	<string>Para adjuntar fotos que ya tengas tomadas.</string>
'''
t = open(ruta, encoding='utf-8').read()
i = t.rfind('</dict>')
if i > 0:
    open(ruta, 'w', encoding='utf-8').write(t[:i] + claves + t[i:])
PY
  echo "==> permisos de iOS puestos"
fi

# ── 4. librerías ──────────────────────────────────────────────────────────
flutter pub get

echo
echo "Listo. Para ejecutar:  flutter run"
echo "Para un APK de prueba: flutter build apk --release"

if [ "${1:-}" = "--correr" ]; then
  flutter run
fi
