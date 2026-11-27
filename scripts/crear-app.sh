#!/bin/bash
# Crea en el escritorio la app «El Barrio - Panel», con el logo del club: bash scripts/crear-app.sh
# Al abrirla arranca el panel de edición y lo muestra en Chrome (ver scripts/abrir-panel.sh).

set -e
DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP="$HOME/Desktop/El Barrio - Panel.app"
LAUNCHER="$DIR/scripts/abrir-panel.sh"
chmod +x "$LAUNCHER"

rm -rf "$APP"
osacompile -o "$APP" -e "try
  do shell script quoted form of \"$LAUNCHER\"
on error errorText
  display alert \"No se pudo abrir el panel de El Barrio\" message errorText as critical
end try"

# Icono a partir del logo, en todos los tamaños que usa macOS.
WORK="$(mktemp -d)"
ICONSET="$WORK/icono.iconset"
mkdir "$ICONSET"
for size in 16 32 128 256 512; do
  sips -s format png -z $size $size "$DIR/public/img/logo.jpg" --out "$ICONSET/icon_${size}x${size}.png" > /dev/null
  sips -s format png -z $((size * 2)) $((size * 2)) "$DIR/public/img/logo.jpg" --out "$ICONSET/icon_${size}x${size}@2x.png" > /dev/null
done
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/applet.icns"
rm -rf "$WORK"
# macOS reciente toma el icono de Assets.car antes que de applet.icns: se quita para que use el logo.
rm -f "$APP/Contents/Resources/Assets.car"
/usr/libexec/PlistBuddy -c "Delete :CFBundleIconName" "$APP/Contents/Info.plist" 2>/dev/null || true
# Cambiar el icono invalida la firma de la app; se vuelve a firmar en local para que macOS la abra.
codesign --force --deep --sign - "$APP" 2>/dev/null
touch "$APP"

echo "Creada: $APP"
