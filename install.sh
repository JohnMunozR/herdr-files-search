#!/usr/bin/env bash
# Installer script for herdr-files-search
# Complies with Herdr's mod distribution and installation specification (AGENTS.md)
set -euo pipefail

HERDR_DIR="${HOME}/.config/herdr-app"
MOD_DIR="${HERDR_DIR}/mods/files-search"
REPO_URL="https://github.com/JohnMunozR/herdr-files-search"
BRANCH="main"

echo "=== Installing herdr-files-search mod ==="

# 1. Check prerequisites
if ! command -v herdr-app >/dev/null 2>&1; then
  echo "Error: herdr-app executable was not found on PATH." >&2
  echo "Please ensure Herdr desktop app is installed and on your PATH." >&2
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "Error: python3 was not found on PATH (needed for safe JSON configuration)." >&2
  exit 1
fi

# Ensure directories exist
mkdir -p "${MOD_DIR}"
mkdir -p "${HERDR_DIR}/layouts"

# 2. Copy mod files
SCRIPT_DIR=""
if [ -n "${BASH_SOURCE[0]:-}" ] && [ -f "${BASH_SOURCE[0]}" ]; then
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fi

if [ -n "${SCRIPT_DIR}" ] && [ -f "${SCRIPT_DIR}/mods/files-search/main.js" ]; then
  echo "--> Installing mod files from local directory..."
  cp -r "${SCRIPT_DIR}/mods/files-search/"* "${MOD_DIR}/"
else
  echo "--> Downloading release files from ${REPO_URL} (${BRANCH})..."
  TMP_DIR="$(mktemp -d)"
  trap 'rm -rf "${TMP_DIR}"' EXIT
  curl -fsSL "${REPO_URL}/archive/refs/heads/${BRANCH}.tar.gz" | tar -xz -C "${TMP_DIR}"
  cp -r "${TMP_DIR}/herdr-files-search-${BRANCH}/mods/files-search/"* "${MOD_DIR}/"
fi

# 3. Check mod syntax per Herdr documentation: herdr-app check <mod folder>
echo "--> Verifying mod syntax and types with herdr-app check..."
herdr-app check "${MOD_DIR}" || herdr-app check "${MOD_DIR}/main.js"

# 4. Layout configuration complying with Herdr layout immutability:
# Shipped layouts (main, terminals, win98) are read-only and replaced on start.
# Customizations belong to personal clones (e.g. main-copy).
echo "--> Configuring Herdr layouts..."
python3 -c "
import json, os, subprocess

herdr_dir = os.path.expanduser('${HERDR_DIR}')
layouts_dir = os.path.join(herdr_dir, 'layouts')
shared_path = os.path.join(herdr_dir, 'shared.json')

shipped_names = {'main', 'terminals', 'win98'}

# Read current active layout
active_layout = 'main'
shared_data = {}
if os.path.exists(shared_path):
    try:
        shared_data = json.load(open(shared_path))
        active_layout = shared_data.get('layout', 'main')
    except Exception:
        pass

target_layout_name = active_layout
if active_layout in shipped_names:
    target_layout_name = f'{active_layout}-copy'

target_file = os.path.join(layouts_dir, f'{target_layout_name}.json')

# If target clone does not exist yet, clone it from shipped layout
if not os.path.exists(target_file):
    source_file = os.path.join(layouts_dir, f'{active_layout}.json')
    if os.path.exists(source_file):
        try:
            data = json.load(open(source_file))
            data['cloned_from'] = {'name': active_layout}
            with open(target_file, 'w') as f:
                json.dump(data, f, indent=2)
            print(f'    Created personal layout clone: {target_layout_name}.json')
        except Exception as e:
            print(f'    Notice: could not clone layout: {e}')

# Update all non-shipped layout files to reference files-search instead of files
for fname in os.listdir(layouts_dir):
    if not fname.endswith('.json'):
        continue
    base_name = fname[:-5]
    if base_name in shipped_names:
        continue  # Preserve shipped layouts untouched per Herdr rules
    
    file_path = os.path.join(layouts_dir, fname)
    try:
        with open(file_path, 'r') as f:
            content = f.read()
        if '\"mod\": \"files\"' in content:
            new_content = content.replace('\"mod\": \"files\"', '\"mod\": \"files-search\"')
            with open(file_path, 'w') as f:
                f.write(new_content)
            print(f'    Updated layout: {fname}')
    except Exception as e:
        print(f'    Error updating {fname}: {e}')

# Ensure active layout switches to the customized layout
if target_layout_name != active_layout:
    shared_data['layout'] = target_layout_name
    try:
        with open(shared_path, 'w') as f:
            json.dump(shared_data, f, indent=2)
    except Exception:
        pass
"

# If Herdr is actively running, switch/reload the layout live
if herdr-app status >/dev/null 2>&1; then
  echo "--> Herdr is running, activating layout..."
  TARGET_LAYOUT="$(python3 -c "
import json, os
try:
    shared = json.load(open(os.path.expanduser('${HERDR_DIR}/shared.json')))
    print(shared.get('layout', 'main-copy'))
except:
    print('main-copy')
")"
  herdr-app do layout.switch "{\"name\":\"${TARGET_LAYOUT}\"}" >/dev/null 2>&1 || true
fi

# 5. Merge keys.json per Herdr documentation:
# 'A mod's keys.json: merge it into the person's. Add its sections and keys, and ask before replacing a key they already use.'
echo "--> Merging shortcuts in keys.json..."
KEYS_FILE="${HERDR_DIR}/keys.json"
python3 -c "
import json, os

keys_path = os.path.expanduser('${KEYS_FILE}')
keys = {}
if os.path.exists(keys_path):
    try:
        keys = json.load(open(keys_path))
    except Exception:
        keys = {}

if 'global' not in keys:
    keys['global'] = {}

# Set defaults if not already customized by user
keys['global'].setdefault('ctrl-p', 'mod.open:files-search')
keys['global'].setdefault('alt-f', 'mod.open:files-search')

with open(keys_path, 'w') as f:
    json.dump(keys, f, indent=2)
print('    Registered Ctrl+P and Alt+F for Search Everywhere in keys.json')
"

echo ""
echo "=== Installation completed successfully! ==="
echo "The 'files-search' mod is active at: ${MOD_DIR}"
echo "Features enabled:"
echo "  • Files header search button with centered magnifying glass icon"
echo "  • IntelliJ-style Search Everywhere floating window (All | Files | Text)"
echo "  • Draggable header & robust resizing with discrete bottom-right size pill"
echo "  • Live Code Preview panel with syntax highlighting (Alt+P to toggle)"
echo "  • Shortcuts: Double-Shift (in panel), Ctrl+P / Alt+F (global)"
