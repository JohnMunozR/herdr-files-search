#!/usr/bin/env bash
# herdr-files-search: installer for the Herdr desktop app
# Complies with Herdr's official mod distribution specification (AGENTS.md)
#
# Usage:
#   ./install.sh [--home DIR] [--app-bin PATH]
#   ./install.sh --uninstall [--home DIR] [--app-bin PATH]
#
# Options:
#   --home DIR        Herdr configuration directory (default: $HERDR_APP_HOME or ~/.config/herdr-app)
#   --app-bin PATH    Path to herdr-app executable
#   --uninstall       Revert layout back to standard 'files' mod, remove shortcuts, and remove 'files-search'
#   -h, --help        Show this help message

set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
mod_src="$here/mods/files-search"
home="${HERDR_APP_HOME:-$HOME/.config/herdr-app}"
app_bin="${HERDR_APP_BIN:-}"
mode="install"
repo_url="https://github.com/JohnMunozR/herdr-files-search"
branch="main"

say() { echo "herdr-files-search: $*"; }
die() { echo "herdr-files-search: error: $*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --uninstall) mode="uninstall" ;;
    --home) [ $# -ge 2 ] || die "--home requires a directory"; home="$2"; shift ;;
    --app-bin) [ $# -ge 2 ] || die "--app-bin requires a path"; app_bin="$2"; shift ;;
    -h|--help)
      sed -n '2,13p' "$0" | sed 's/^# *//'
      exit 0
      ;;
    *) die "unknown argument: $1" ;;
  esac
  shift
done

find_app_bin() {
  if [ -n "$app_bin" ]; then echo "$app_bin"; return; fi
  if command -v herdr-app >/dev/null 2>&1; then command -v herdr-app; return; fi
  if [ -x "$HOME/.local/bin/herdr-app" ]; then echo "$HOME/.local/bin/herdr-app"; return; fi
  echo ""
}

HERDR_BIN="$(find_app_bin)"

target_mods="$home/mods"
target_mod="$target_mods/files-search"
layouts_dir="$home/layouts"
keys_file="$home/keys.json"

if [ "$mode" = "uninstall" ]; then
  say "Uninstalling files-search mod..."

  # 1. Revert layouts pointing to files-search back to files
  if [ -d "$layouts_dir" ]; then
    for lfile in "$layouts_dir"/*.json; do
      [ -f "$lfile" ] || continue
      if grep -q '"files-search"' "$lfile" 2>/dev/null; then
        sed -i 's/"mod": *"files-search"/"mod": "files"/g' "$lfile"
        say "Reverted $lfile to use default 'files' mod"
      fi
    done
    if [ -d "$layouts_dir/.state" ]; then
      for sfile in "$layouts_dir/.state"/*.json; do
        [ -f "$sfile" ] || continue
        if grep -q '"files-search"' "$sfile" 2>/dev/null; then
          sed -i 's/"mod": *"files-search"/"mod": "files"/g' "$sfile"
        fi
      done
    fi
  fi

  # 2. Remove shortcuts from keys.json if they point to files-search
  if [ -f "$keys_file" ] && command -v python3 >/dev/null 2>&1; then
    python3 -c "
import json, os
try:
    path = os.path.expanduser('${keys_file}')
    if os.path.exists(path):
        keys = json.load(open(path))
        changed = False
        for sec in ('global', 'window'):
            if sec in keys:
                for k in list(keys[sec].keys()):
                    if 'files-search' in str(keys[sec][k]):
                        del keys[sec][k]
                        changed = True
        if changed:
            with open(path, 'w') as f:
                json.dump(keys, f, indent=2)
            print('herdr-files-search: Removed files-search shortcuts from keys.json')
except Exception as e:
    pass
"
  fi

  # 3. Remove mod directory
  if [ -d "$target_mod" ]; then
    rm -rf "$target_mod"
    say "Removed $target_mod"
  fi

  say "Uninstallation complete. Reloading layout..."
  if [ -n "$HERDR_BIN" ]; then
    "$HERDR_BIN" do layout.switch '{"name":"main"}' 2>/dev/null || true
  fi
  exit 0
fi

# Mode: install
say "Installing files-search mod into: $target_mod"

tmp_dir=""
cleanup() {
  if [ -n "$tmp_dir" ] && [ -d "$tmp_dir" ]; then
    rm -rf "$tmp_dir"
  fi
}
trap cleanup EXIT

if [ ! -d "$mod_src" ]; then
  say "Fetching herdr-files-search files from GitHub..."
  tmp_dir="$(mktemp -d)"
  if command -v curl >/dev/null 2>&1 && command -v tar >/dev/null 2>&1; then
    curl -fsSL "${repo_url}/archive/refs/heads/${branch}.tar.gz" | tar -xz -C "$tmp_dir"
    mod_src="$tmp_dir/herdr-files-search-${branch}/mods/files-search"
  elif command -v git >/dev/null 2>&1; then
    git clone --depth 1 "$repo_url.git" "$tmp_dir/repo"
    mod_src="$tmp_dir/repo/mods/files-search"
  else
    die "Cannot download files: neither curl+tar nor git are available"
  fi
fi

[ -d "$mod_src" ] || die "Mod source directory not found: $mod_src"

mkdir -p "$target_mods"
rm -rf "$target_mod"
cp -r "$mod_src" "$target_mod"

if [ -n "$HERDR_BIN" ]; then
  say "Verifying mod with herdr-app check..."
  "$HERDR_BIN" check "$target_mod" || die "Mod validation failed."
fi

# Ensure personal layout (main-copy.json) exists
mkdir -p "$layouts_dir"
personal_layout="$layouts_dir/main-copy.json"
orig_layout="$layouts_dir/main.json"

if [ ! -f "$personal_layout" ]; then
  if [ -n "$HERDR_BIN" ]; then
    say "Cloning main layout to main-copy..."
    "$HERDR_BIN" do layout.clone '{"name":"main","as":"main-copy"}' 2>/dev/null || true
  fi
  if [ ! -f "$personal_layout" ] && [ -f "$orig_layout" ]; then
    cp "$orig_layout" "$personal_layout"
  fi
fi

if [ -f "$personal_layout" ]; then
  # Configure files-search in personal layout
  sed -i 's/"mod": *"files"/"mod": "files-search"/g' "$personal_layout"
  say "Configured 'files-search' in $personal_layout"

  if [ -f "$layouts_dir/.state/main-copy.json" ]; then
    sed -i 's/"mod": *"files"/"mod": "files-search"/g' "$layouts_dir/.state/main-copy.json"
  fi
fi

# Merge shortcuts into keys.json per AGENTS.md rule 4
if command -v python3 >/dev/null 2>&1; then
  python3 -c "
import json, os

path = os.path.expanduser('${keys_file}')
keys = {}
if os.path.exists(path):
    try:
        keys = json.load(open(path))
    except Exception:
        keys = {}

if 'global' not in keys:
    keys['global'] = {}

# Set defaults if not already customized by user
keys['global'].setdefault('ctrl-p', 'mod.open:files-search')
keys['global'].setdefault('alt-f', 'mod.open:files-search')

with open(path, 'w') as f:
    json.dump(keys, f, indent=2)
print('herdr-files-search: Registered Ctrl+P and Alt+F in keys.json')
"
fi

if [ -n "$HERDR_BIN" ]; then
  say "Activating personal layout in Herdr..."
  "$HERDR_BIN" do layout.switch '{"name":"main-copy"}' 2>/dev/null || true
  "$HERDR_BIN" do layout.select --stack panel-body --child files 2>/dev/null || true
  "$HERDR_BIN" do layout.show --id panel 2>/dev/null || true
fi

say "✓ files-search installed successfully!"
