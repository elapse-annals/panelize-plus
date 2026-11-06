#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"

pause_before_exit() {
  if [[ -t 0 ]]; then
    read -r -p "按回车关闭 / Press Enter to close…" _ || true
  fi
}
trap pause_before_exit EXIT

echo "Panelize Link 安装 / Install"
echo "请先退出正在运行的 Panelize Link。 / Quit Panelize Link before installing."
echo
read -r -p "浏览器 / Browser [1: Chrome (default), 2: Edge]: " browser_choice
case "$browser_choice" in
  ""|1|chrome|Chrome) browser="chrome" ;;
  2|edge|Edge) browser="edge" ;;
  *) echo "不支持的浏览器 / Unsupported browser: $browser_choice" >&2; exit 2 ;;
esac

echo "从 $browser://extensions 复制 Panelize 的 ID，或复制扩展设置页地址。"
echo "Copy the Panelize ID from $browser://extensions, or paste its settings URL."
read -r -p "扩展 ID 或设置页地址 / Extension ID or settings URL: " extension_id
if [[ "$extension_id" == chrome-extension://* ]]; then
  extension_id="${extension_id#chrome-extension://}"
  extension_id="${extension_id%%/*}"
fi
if [[ ! "$extension_id" =~ ^[a-p]{32}$ ]]; then
  echo "扩展 ID 必须是 32 位 a-p 字母。 / Expected a 32-character extension ID (a-p)." >&2
  exit 2
fi

/bin/bash "$SCRIPT_DIR/install.sh" --browser "$browser" --extension-id "$extension_id"

echo
echo "安装完成：重新加载扩展，打开 Panelize Link，并在扩展设置中开启「启用全局输入桥接」。"
echo "Installed: reload the extension, open Panelize Link, and enable the global input bridge in its settings."
