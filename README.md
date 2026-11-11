# herdr-files-search

An enhanced file browser and IntelliJ-style **Search Everywhere** mod for the [Herdr](https://github.com/herdr-app) desktop app.

It extends Herdr's native `files` panel with a magnifying glass search icon in the header that launches a floating search dialog supporting multi-tab searches across files and file contents (`All`, `Files`, `Text`), fuzzy filename matching, fast live grep search, keyboard navigation, a live code preview panel, draggable title bar, and smooth resizing.

![files-search](preview.png)

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

## Quick Install

Run this command in your terminal:

```bash
curl -fsSL https://raw.githubusercontent.com/JohnMunozR/herdr-files-search/main/install.sh | bash
```

Or clone the repository and run:

```bash
git clone https://github.com/JohnMunozR/herdr-files-search.git
cd herdr-files-search
bash install.sh
```

The installer conforms to Herdr's mod documentation:
1. Copies the mod to `~/.config/herdr-app/mods/files-search/`.
2. Validates syntax with `herdr-app check`.
3. Adheres to Herdr layout immutability: respects shipped layouts (`main`, `terminals`, `win98`) and creates or updates your personal layout clone (e.g. `main-copy.json`).
4. Merges `Ctrl+P` and `Alt+F` into `~/.config/herdr-app/keys.json` without overwriting existing shortcuts.
5. Switches Herdr live to the updated layout.

## Manual Installation

Following Herdr's mod guide (`AGENTS.md`):

1. **Copy the mod folder**:
   ```bash
   mkdir -p ~/.config/herdr-app/mods/files-search
   cp -r mods/files-search/* ~/.config/herdr-app/mods/files-search/
   ```

2. **Verify syntax**:
   ```bash
   herdr-app check ~/.config/herdr-app/mods/files-search
   ```

3. **Clone and update layout** (never edit shipped `main.json` directly):
   ```bash
   herdr-app do layout.clone '{"name":"main","as":"main-copy"}'
   ```
   In `~/.config/herdr-app/layouts/main-copy.json`, replace `"mod": "files"` with `"mod": "files-search"`.

4. **Register shortcuts in `~/.config/herdr-app/keys.json`**:
   ```json
   {
     "global": {
       "ctrl-p": "mod.open:files-search",
       "alt-f": "mod.open:files-search"
     }
   }
   ```

5. **Switch layout in Herdr**:
   ```bash
   herdr-app do layout.switch '{"name":"main-copy"}'
   ```

## Specification & Recipes

See [RECIPE.md](RECIPE.md) for the complete design specification, behavior rules, and Herdr mod architecture guidelines.

## License

[Apache-2.0](LICENSE) © [John Muñoz](https://github.com/JohnMunozR)
