#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
REPO_ROOT=""
APP_NAME="Panelize Link"
BUILT_APP=""
APP_SOURCE=""
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

EXTENSION_ID=""

usage() {
  cat <<'EOF'
Usage: install.sh [--app <path>] [--extension-id <32-char-id>] [--browser chrome|edge]

Builds Panelize Link.app (or installs the app given with --app), installs it
under ~/Applications, and registers the user-level Native Messaging host. No
sudo is used.

In a release download, the app next to this script is installed and
--extension-id is required. Copy the actual ID from chrome://extensions or
edge://extensions. No repository checkout or developer tools are needed.

In a source checkout without --app, builds the app and defaults to the ID for
the repository root. Pass --extension-id if the extension is loaded elsewhere.
EOF
}

require_value() {
  if [[ -z "${2:-}" || "$2" == --* ]]; then
    echo "Missing value for $1" >&2
    exit 2
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --app)
      require_value "$@"
      APP_SOURCE="$2"
      shift 2
      ;;
    --extension-id)
      require_value "$@"
      EXTENSION_ID="$2"
      shift 2
      ;;
    --browser)
      require_value "$@"
      BROWSER="$2"
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

if [[ -z "$APP_SOURCE" && -d "$SCRIPT_DIR/$APP_NAME.app" ]]; then
  APP_SOURCE="$SCRIPT_DIR/$APP_NAME.app"
fi

if [[ -z "$APP_SOURCE" ]]; then
  if [[ ! -x "$SCRIPT_DIR/build-app.sh" || ! -f "$SCRIPT_DIR/../../../manifest.json" ]]; then
    echo "App not found. Keep install.sh next to $APP_NAME.app or pass --app <path>." >&2
    exit 2
  fi
  REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd -P)"
  BUILT_APP="$REPO_ROOT/dist/$APP_NAME.app"
  if [[ -z "$EXTENSION_ID" ]]; then
    EXTENSION_ID="$(unpacked_extension_id "$REPO_ROOT")"
  fi
elif [[ -z "$EXTENSION_ID" ]]; then
  echo "--extension-id is required when installing a downloaded app." >&2
  echo "Copy the actual Panelize ID from chrome://extensions or edge://extensions." >&2
  exit 2
fi

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

if [[ -n "$APP_SOURCE" ]]; then
  if [[ ! -d "$APP_SOURCE" ]]; then
    echo "App not found: $APP_SOURCE" >&2
    exit 2
  fi
  BUILT_APP="$(cd "$(dirname "$APP_SOURCE")" && pwd -P)/$(basename "$APP_SOURCE")"
  echo "Using downloaded app: $BUILT_APP"
else
  "$SCRIPT_DIR/build-app.sh" >/dev/null
fi

for binary in PanelizeSearchApp PanelizeSearchBridge; do
  if [[ ! -x "$BUILT_APP/Contents/MacOS/$binary" ]]; then
    echo "Not a Panelize Link app (missing $binary): $BUILT_APP" >&2
    exit 2
  fi
done

BACKUP_SUFFIX="$(date +%Y%m%d%H%M%S)-$$"
mkdir -p "$HOME/Applications"
if [[ "$BUILT_APP" -ef "$DEST_APP" ]]; then
  echo "Using installed app: $DEST_APP"
else
  if [[ -e "$DEST_APP" ]]; then
    BACKUP="$DEST_APP.backup-$BACKUP_SUFFIX"
    mv "$DEST_APP" "$BACKUP"
    echo "Previous app kept at $BACKUP"
  fi
  ditto "$BUILT_APP" "$DEST_APP"
  codesign --force --deep --sign - "$DEST_APP" >/dev/null 2>&1 || true
fi

mkdir -p "$NATIVE_DIR"
MANIFEST="$NATIVE_DIR/$HOST_NAME.json"
if [[ -e "$MANIFEST" ]]; then
  cp "$MANIFEST" "$MANIFEST.backup-$BACKUP_SUFFIX"
fi

HOST_PATH="$DEST_APP/Contents/MacOS/PanelizeSearchBridge"
MANIFEST_TEMP="$(mktemp "$NATIVE_DIR/$HOST_NAME.XXXXXX")"
trap 'rm -f "$MANIFEST_TEMP"' EXIT
# plutil escapes paths correctly, including spaces, quotes and backslashes.
/usr/bin/plutil -create xml1 "$MANIFEST_TEMP"
/usr/bin/plutil -insert name -string "$HOST_NAME" "$MANIFEST_TEMP"
/usr/bin/plutil -insert description -string "Panelize Link global prompt sender" "$MANIFEST_TEMP"
/usr/bin/plutil -insert path -string "$HOST_PATH" "$MANIFEST_TEMP"
/usr/bin/plutil -insert type -string "stdio" "$MANIFEST_TEMP"
/usr/bin/plutil -insert allowed_origins -json "[\"chrome-extension://$EXTENSION_ID/\"]" "$MANIFEST_TEMP"
/usr/bin/plutil -convert json -r "$MANIFEST_TEMP"
mv "$MANIFEST_TEMP" "$MANIFEST"

echo "Installed: $DEST_APP"
echo "Native host: $MANIFEST"
echo "Extension ID: $EXTENSION_ID"
echo
echo "Next: check that the Panelize extension at $BROWSER://extensions uses this"
echo "ID (or rerun with --extension-id), reload it, then open the app once:"
echo "  open \"$DEST_APP\""
echo
echo "In Panelize settings, enable Global Input (macOS) > Enable global input bridge."
echo "If it is already enabled, turn it off and on again to reconnect."
echo "  chrome-extension://$EXTENSION_ID/options/options.html#global-send-bridge-toggle"
echo
echo "The browser starts the app in the background after it reconnects."
echo "Optional: add the app to System Settings > General > Login Items."
