#!/usr/bin/env bash
set -euo pipefail

# Build Panelize Link for Apple silicon and zip it for a GitHub Release.
# Runs on an arm64 macOS host, because the app is built with Swift and
# packaged with ditto. The extension's release zips do not include the client.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
VERSION="${RELEASE_VERSION:-$(node -p "require('$REPO_ROOT/manifest.json').version")}"
APP_NAME="Panelize Link"
APP_PATH="$REPO_ROOT/dist/$APP_NAME.app"
OUT_DIR="$REPO_ROOT/dist/release-$VERSION"
ZIP_PATH="$OUT_DIR/panelize-link-$VERSION-macos-arm64.zip"

if [[ "$(uname -s)" != "Darwin" || "$(uname -m)" != "arm64" ]]; then
  echo "[package-macos-app] The macOS client requires an arm64 macOS host." >&2
  exit 1
fi

"$REPO_ROOT/desktop/macos/Scripts/build-app.sh"

for binary in PanelizeSearchApp PanelizeSearchBridge; do
  if [[ ! -x "$APP_PATH/Contents/MacOS/$binary" ]]; then
    echo "[package-macos-app] Missing $APP_PATH/Contents/MacOS/$binary" >&2
    exit 1
  fi

  architectures="$(lipo -archs "$APP_PATH/Contents/MacOS/$binary")"
  if [[ "$architectures" != "arm64" ]]; then
    echo "[package-macos-app] $binary is not arm64 only: $architectures" >&2
    exit 1
  fi
done

mkdir -p "$OUT_DIR"
STAGING_DIR="$(mktemp -d "${TMPDIR:-/tmp}/panelize-link.XXXXXX")"
trap 'rm -rf "$STAGING_DIR"' EXIT
ditto "$APP_PATH" "$STAGING_DIR/$APP_NAME.app"
cp "$REPO_ROOT/desktop/macos/Scripts/install.sh" "$STAGING_DIR/install.sh"
cp "$REPO_ROOT/desktop/macos/Scripts/Install.command" "$STAGING_DIR/Install.command"
cp "$REPO_ROOT/desktop/macos/README.md" "$STAGING_DIR/README.md"
cp "$REPO_ROOT/desktop/macos/README.zh-CN.md" "$STAGING_DIR/README.zh-CN.md"
chmod +x "$STAGING_DIR/install.sh" "$STAGING_DIR/Install.command"

rm -f "$ZIP_PATH"
ditto -c -k --norsrc --noextattr "$STAGING_DIR" "$ZIP_PATH"

ZIP_ENTRIES="$(unzip -Z1 "$ZIP_PATH")"
for entry in \
  "$APP_NAME.app/Contents/MacOS/PanelizeSearchApp" \
  "$APP_NAME.app/Contents/MacOS/PanelizeSearchBridge" \
  Install.command install.sh README.md README.zh-CN.md; do
  if ! grep -Fxq "$entry" <<< "$ZIP_ENTRIES"; then
    echo "[package-macos-app] $ZIP_PATH does not contain $entry" >&2
    exit 1
  fi
done

echo "[package-macos-app] Created $ZIP_PATH"
