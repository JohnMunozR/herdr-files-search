#!/usr/bin/env bash
# Installer script for herdr-files-search
# Supports both local repository install and curl | bash remote install
set -euo pipefail

HERDR_DIR="${HOME}/.config/herdr-app"
MOD_DIR="${HERDR_DIR}/mods/files-search"
REPO_URL="https://github.com/JohnMunozR/herdr-files-search"
BRANCH="main"

echo "=== Installing herdr-files-search mod ==="

# Check prerequisites
if ! command -v herdr-app >/dev/null 2>&1; then
  echo "Error: herdr-app executable was not found on PATH." >&2
  exit 1
fi

mkdir -p "${MOD_DIR}"

SCRIPT_DIR=""
if [ -n "${BASH_SOURCE[0]:-}" ] && [ -f "${BASH_SOURCE[0]}" ]; then
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fi

if [ -n "${SCRIPT_DIR}" ] && [ -f "${SCRIPT_DIR}/mods/files-search/main.js" ]; then
  echo "--> Installing from local workspace: ${SCRIPT_DIR}"
  cp -r "${SCRIPT_DIR}/mods/files-search/"* "${MOD_DIR}/"
else
  echo "--> Downloading release files from ${REPO_URL} (${BRANCH})..."
  TMP_DIR="$(mktemp -d)"
  trap 'rm -rf "${TMP_DIR}"' EXIT
  curl -fsSL "${REPO_URL}/archive/refs/heads/${BRANCH}.tar.gz" | tar -xz -C "${TMP_DIR}"
  cp -r "${TMP_DIR}/herdr-files-search-${BRANCH}/mods/files-search/"* "${MOD_DIR}/"
fi

echo "--> Verifying mod syntax and types with herdr-app check..."
herdr-app check "${MOD_DIR}/main.js"

echo "--> Updating Herdr layouts to use files-search..."
LAYOUTS_DIR="${HERDR_DIR}/layouts"
if [ -d "${LAYOUTS_DIR}" ]; then
  for layout_file in "${LAYOUTS_DIR}"/*.json; do
    [ -f "${layout_file}" ] || continue
    if grep -q '"mod": "files"' "${layout_file}"; then
      sed -i 's/"mod": "files"/"mod": "files-search"/g' "${layout_file}"
      echo "    Updated ${layout_file}"
    fi
  done
fi

echo "--> Configuring global shortcuts in keys.json..."
KEYS_FILE="${HERDR_DIR}/keys.json"
python3 -c "
import json, os

keys_path = os.path.expanduser('${KEYS_FILE}')
if os.path.exists(keys_path):
    try:
        keys = json.load(open(keys_path))
    except Exception:
        keys = {}
else:
    keys = {}

if 'global' not in keys:
    keys['global'] = {}

# Add files-search shortcuts if not already mapped
keys['global'].setdefault('ctrl-p', 'mod.open:files-search')
keys['global'].setdefault('alt-f', 'mod.open:files-search')

with open(keys_path, 'w') as f:
    json.dump(keys, f, indent=2)
print('    Registered Ctrl+P and Alt+F for Search Everywhere in keys.json')
"

echo ""
echo "=== Installation completed successfully! ==="
echo "The 'files-search' mod is now installed in ${MOD_DIR}."
echo "If Herdr is open, the Files tab has been upgraded with the Search Everywhere feature."
