#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd -P)"
APP_NAME="Panelize Link"
BUILT_APP="$REPO_ROOT/dist/$APP_NAME.app"
DEST_APP="$HOME/Applications/$APP_NAME.app"
BROWSER="chrome"
HOST_NAME="com.panelize.global_sender"

# Chrome derives an unpacked extension's ID from the absolute path it was
# loaded from: the first 16 bytes of the path's SHA-256, with every hex digit
# mapped onto a-p. Deriving it here keeps the native-host manifest in step with
# the checkout the extension is loaded from.
unpacked_extension_id() {
  local path="$1"
  local hex digit id="" alphabet="abcdefghijklmnop"
  local i
  if command -v shasum >/dev/null 2>&1; then
    hex="$(printf '%s' "$path" | shasum -a 256 | awk '{ print $1 }')"
  elif command -v sha256sum >/dev/null 2>&1; then
    hex="$(printf '%s' "$path" | sha256sum | awk '{ print $1 }')"
  else
    echo "No SHA-256 tool found (need shasum or sha256sum)." >&2
    return 1
  fi
  hex="${hex:0:32}"
  for ((i = 0; i < 32; i++)); do
    digit="${hex:i:1}"
    id+="${alphabet:$((16#$digit)):1}"
  done
  printf '%s\n' "$id"
}

EXTENSION_ID="$(unpacked_extension_id "$REPO_ROOT")"

usage() {
  cat <<'EOF'
Usage: install.sh [--extension-id <32-char-id>] [--browser chrome|edge]

Builds Panelize Link.app, installs it under ~/Applications, and registers the
user-level Native Messaging host. No sudo is used.

By default the ID Chrome assigns to this checkout when it is loaded unpacked
from the repository root is used. Pass --extension-id when the extension is
loaded from another path or installed from the Chrome Web Store.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --extension-id)
      EXTENSION_ID="${2:-}"
      shift 2
      ;;
    --browser)
      BROWSER="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ ! "$EXTENSION_ID" =~ ^[a-p]{32}$ ]]; then
  echo "Invalid extension ID: $EXTENSION_ID" >&2
  exit 2
fi

case "$BROWSER" in
  chrome)
    NATIVE_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
    ;;
  edge)
    NATIVE_DIR="$HOME/Library/Application Support/Microsoft Edge/NativeMessagingHosts"
    ;;
  *)
    echo "Unsupported browser: $BROWSER (use chrome or edge)" >&2
    exit 2
    ;;
esac

"$SCRIPT_DIR/build-app.sh" >/dev/null

mkdir -p "$HOME/Applications"
if [[ -e "$DEST_APP" ]]; then
  BACKUP="$DEST_APP.backup-$(date +%Y%m%d%H%M%S)"
  mv "$DEST_APP" "$BACKUP"
  echo "Previous app kept at $BACKUP"
fi
ditto "$BUILT_APP" "$DEST_APP"
codesign --force --deep --sign - "$DEST_APP" >/dev/null 2>&1 || true

mkdir -p "$NATIVE_DIR"
MANIFEST="$NATIVE_DIR/$HOST_NAME.json"
if [[ -e "$MANIFEST" ]]; then
  cp "$MANIFEST" "$MANIFEST.backup-$(date +%Y%m%d%H%M%S)"
fi

HOST_PATH="$DEST_APP/Contents/MacOS/PanelizeSearchBridge"
cat > "$MANIFEST" <<JSON
{
  "name": "$HOST_NAME",
  "description": "Panelize Link global prompt sender",
  "path": "$HOST_PATH",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://$EXTENSION_ID/"
  ]
}
JSON

/usr/bin/plutil -convert xml1 -o /dev/null "$MANIFEST"

echo "Installed: $DEST_APP"
echo "Native host: $MANIFEST"
echo "Extension ID: $EXTENSION_ID"
echo
echo "Next: check that the Panelize extension at $BROWSER://extensions uses this"
echo "ID (or rerun with --extension-id), reload it, then open the app once:"
echo "  open \"$DEST_APP\""
echo
echo "The browser starts the app in the background after it reconnects."
echo "Optional: add the app to System Settings > General > Login Items."