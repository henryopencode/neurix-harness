#!/bin/bash
# Build and install the current checkout with the desktop app's own Node runtime.
set -euo pipefail

NEURIX_SOURCE_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
shopt -s nullglob
NEURIX_NODE_CANDIDATES=(
  "${NEURIX_UPDATE_NODE:-}"
  "/Applications/Neurix Harness.app/Contents/Resources/runtime/primary-runtime/dependencies/node/bin/node"
  "$HOME/Applications/Neurix Harness.app/Contents/Resources/runtime/primary-runtime/dependencies/node/bin/node"
  "$NEURIX_SOURCE_DIR/apps/desktop/.desktop-build/targets/mac-arm64/runtime/primary-runtime/dependencies/node/bin/node"
  "$NEURIX_SOURCE_DIR/apps/desktop/.desktop-build/targets/mac-x64/runtime/primary-runtime/dependencies/node/bin/node"
  "$HOME"/.nvm/versions/node/v*/bin/node
  /opt/homebrew/bin/node
  /usr/local/bin/node
)

for NEURIX_NODE in "${NEURIX_NODE_CANDIDATES[@]}"; do
  if [[ -x "$NEURIX_NODE" ]] && "$NEURIX_NODE" -e '
    const [major, minor] = process.versions.node.split(".").map(Number);
    process.exit(major > 24 || major === 24 && minor >= 9 ? 0 : 1);
  ' >/dev/null 2>&1; then
    NEURIX_RESULT=0
    "$NEURIX_NODE" "$NEURIX_SOURCE_DIR/apps/desktop/scripts/update-installed-macos.mjs" "$@" || NEURIX_RESULT=$?
    if [[ $# -eq 0 && -t 0 ]]; then
      read -r -p '按回车关闭窗口…' NEURIX_CLOSE
    fi
    exit "$NEURIX_RESULT"
  fi
done

printf '%s\n' '未找到 Node 24.9 或更高版本。请设置 NEURIX_UPDATE_NODE 为可用 Node 的绝对路径。' >&2
exit 1
