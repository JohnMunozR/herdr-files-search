# herdr-files-search

An enhanced file browser and IntelliJ-style **Search Everywhere** mod for the [Herdr](https://herdr.dev) desktop app.

It extends Herdr's native `files` panel with a magnifying glass search icon in the header that launches a floating search dialog supporting multi-tab searches across files and file contents (`All`, `Files`, `Text`), fuzzy filename matching, fast live grep search, keyboard navigation, a live code preview panel, draggable title bar, and smooth resizing.

![files-search](preview.png)

---

## Features

- **Files Panel Integration**: Preserves the complete native file tree, lazy folder loading, deep repository indexing without artificial depth limits, git status badges (`A`, `M`, `D`, `U`), and syntax-highlighted code preview.
- **Search Everywhere Floating Window**: 
  - Floating dialog styled after IntelliJ's Search Everywhere window.
  - **`All`**: Unified search showing top file name matches and code content matches in one view.
  - **`Files`**: High-performance fuzzy search across all workspace files by name and relative path.
  - **`Text`**: Fast full-text grep search (`rg` / `git grep`) across repository contents with line numbers and highlighted code snippets.
- **IntelliJ-Style Code Preview**:
  - Live split preview pane toggled with `[ ◨ Preview ]` or `Alt+P` / `Ctrl+P`.
  - Shows line numbers, target line highlighting, and query matches.
- **Movable & Resizable**:
  - **Draggable**: Click and drag anywhere on the header to move the window.
  - **Resizable**: Drag the corner grip `⋰` smoothly in any direction (protected against fast mouse sweeps).
  - **Discrete Size Controls**: Bottom-right status pill with `[-]`, `[+]`, `[ ▢ ]` (maximize/restore), and keyboard shortcuts (`Ctrl+=`, `Ctrl+-`, `Ctrl+0`).
- **Keyboard Shortcuts**:
  - `Shift + Shift`: Double-Shift inside the Files panel opens Search Everywhere.
  - `Ctrl + P` / `Alt + F`: Open Search Everywhere from anywhere in Herdr.
  - `Tab` / `Shift+Tab`: Cycle between `All`, `Files`, and `Text` tabs.
  - `↑` / `↓` / `PageUp` / `PageDown`: Navigate search results.
  - `Enter` / Click: Jump directly to the file, expand parent directories in the tree, and open preview.
  - `Esc`: Close the dialog.
- **Theme Adaptive**: Dynamically inherits theme colors (`popover`, `accent`, `raised`, `selected`, `dim`, `foreground`, `border`) from the active Herdr theme.

---

## Installation

### Standard Herdr Method (Recommended)

In Herdr, you can ask any of your coding agents (Claude, Codex, Antigravity, etc.) to install it following the Herdr standard:

> **"Read ~/.config/herdr-app/AGENTS.md, then add this mod: https://github.com/JohnMunozR/herdr-files-search"**

The agent will read the [`RECIPE.md`](RECIPE.md), copy `mods/files-search` to `~/.config/herdr-app/mods/files-search`, update your personal layout (`main-copy.json`), merge `keys.json`, and verify it with `herdr-app check`.

---

### One-line Terminal Install

Run directly in your terminal:

```bash
curl -fsSL https://raw.githubusercontent.com/JohnMunozR/herdr-files-search/main/install.sh | bash
```

Or from a local clone:

```bash
git clone https://github.com/JohnMunozR/herdr-files-search.git
cd herdr-files-search
./install.sh
```

---

### Manual Installation (Steps from AGENTS.md)

1. Clone or download this repository.
2. Copy the `mods/files-search` folder to `~/.config/herdr-app/mods/files-search`:
   ```bash
   mkdir -p ~/.config/herdr-app/mods/files-search
   cp -r mods/files-search/* ~/.config/herdr-app/mods/files-search/
   ```
3. In your personal layout (`~/.config/herdr-app/layouts/main-copy.json`), point the `files` panel to `files-search`:
   ```json
   {
     "id": "files",
     "type": "block",
     "content": {
       "mod": "files-search"
     }
   }
   ```
4. Merge shortcuts into `~/.config/herdr-app/keys.json`:
   ```json
   {
     "global": {
       "ctrl-p": "mod.open:files-search",
       "alt-f": "mod.open:files-search"
     }
   }
   ```
5. Verify the mod:
   ```bash
   herdr-app check ~/.config/herdr-app/mods/files-search
   ```

---

## Uninstallation

To revert back to Herdr's default `files` mod and remove shortcuts:

```bash
./install.sh --uninstall
```

---

## License

[Apache-2.0](LICENSE) © [John Muñoz](https://github.com/JohnMunozR)
