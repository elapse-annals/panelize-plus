#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
APP_NAME="Panelize Link"
BUILT_APP="$REPO_ROOT/dist/$APP_NAME.app"
DEST_APP="$HOME/Applications/$APP_NAME.app"
EXTENSION_ID="iokalaafkmjffolodkkgbbccmofbglii"
BROWSER="chrome"
HOST_NAME="com.panelize.global_sender"

usage() {
  cat <<'EOF'
Usage: install.sh [--extension-id <32-char-id>] [--browser chrome|edge]

Builds Panelize Link.app, installs it under ~/Applications, and registers the
user-level Native Messaging host. No sudo is used.

The default ID is the Chrome Web Store Panelize extension. Pass the ID shown on
chrome://extensions when testing an unpacked build.
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
echo
echo "Next: reload the Panelize extension in $BROWSER (or restart the browser),"
echo "then open the app once:"
echo "  open \"$DEST_APP\""
echo
echo "The browser starts the app in the background after it reconnects."
echo "Optional: add the app to System Settings > General > Login Items."