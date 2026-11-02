#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DESKTOP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$DESKTOP_DIR/../.." && pwd)"
APP_NAME="Panelize Search"
APP_PATH="$REPO_ROOT/dist/$APP_NAME.app"
VERSION="$(node -p "require('$REPO_ROOT/manifest.json').version")"

swift build \
  --package-path "$DESKTOP_DIR" \
  --configuration release \
  --product PanelizeSearchApp
swift build \
  --package-path "$DESKTOP_DIR" \
  --configuration release \
  --product PanelizeSearchBridge

BIN_DIR="$(swift build --package-path "$DESKTOP_DIR" --configuration release --show-bin-path)"
rm -rf "$APP_PATH"
mkdir -p "$APP_PATH/Contents/MacOS" "$APP_PATH/Contents/Resources"

cp "$BIN_DIR/PanelizeSearchApp" "$APP_PATH/Contents/MacOS/PanelizeSearchApp"
cp "$BIN_DIR/PanelizeSearchBridge" "$APP_PATH/Contents/MacOS/PanelizeSearchBridge"
chmod +x "$APP_PATH/Contents/MacOS/PanelizeSearchApp" "$APP_PATH/Contents/MacOS/PanelizeSearchBridge"

cat > "$APP_PATH/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>zh_CN</string>
  <key>CFBundleDisplayName</key>
  <string>$APP_NAME</string>
  <key>CFBundleExecutable</key>
  <string>PanelizeSearchApp</string>
  <key>CFBundleIconFile</key>
  <string>AppIcon</string>
  <key>CFBundleIdentifier</key>
  <string>com.panelize.search</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>$APP_NAME</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>$VERSION</string>
  <key>CFBundleVersion</key>
  <string>$VERSION</string>
  <key>LSMinimumSystemVersion</key>
  <string>13.0</string>
  <key>LSUIElement</key>
  <true/>
  <key>NSHighResolutionCapable</key>
  <true/>
</dict>
</plist>
PLIST

ICON_SOURCE="$REPO_ROOT/icons/icon-128.png"
if [[ -f "$ICON_SOURCE" ]]; then
  ICONSET="$(mktemp -d)/AppIcon.iconset"
  mkdir -p "$ICONSET"
  for size in 16 32 128 256 512; do
    sips -z "$size" "$size" "$ICON_SOURCE" --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
    double=$((size * 2))
    sips -z "$double" "$double" "$ICON_SOURCE" --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null
  done
  iconutil -c icns "$ICONSET" -o "$APP_PATH/Contents/Resources/AppIcon.icns"
fi

# Ad-hoc signing keeps local Native Messaging launches stable. Public
# distribution still requires Developer ID signing and notarization.
codesign --force --deep --sign - "$APP_PATH" >/dev/null 2>&1 || true

echo "$APP_PATH"