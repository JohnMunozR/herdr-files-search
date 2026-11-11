# files-search

An enhanced file browser and IntelliJ-style Search Everywhere mod for the Herdr desktop app. It extends Herdr's native Files panel with a magnifying glass button in the header that launches a floating search overlay with multi-tab search across files and code contents (`All`, `Files`, `Text`), fuzzy matching, live syntax-highlighted results, instant file preview, draggable title bar, and smooth resizing.

![files-search](preview.png)

## What you see

- **Files Panel Header** (42px high, `border_b(1)` in `border`):
  - Left: Back arrow button `←` when a file preview is active.
  - "Files" title in `font_semibold()`.
  - Focused root folder name or active filename in `dim` (right-aligned).
  - Search button with centered magnifying glass icon (`search.svg`, 26x26px, hover in `hover`, cursor pointer).
- **Files Tree** (`files-tree`, scrollable list):
  - Retains 100% of Herdr's native folder hierarchy, file icons, lazy directory traversal, and git status marks (`A`, `M`, `D`, `U`).
  - Deep repository indexing without arbitrary directory depth limits.
- **Search Everywhere Overlay** (`files-search-overlay`, floating window, background `popover`, 10px rounded, 1px `border`, shadow):
  - **Draggable Title Bar & Segmented Tabs** (30px high, `cursor_grab()`):
    - Tabs on the left: **`All`**, **`Files`**, **`Text`**. Active tab highlighted with `background` and `foreground` text.
    - Right side: status indicators ("Searching text…"), `[ ◨ Preview ]` toggle button, and keyboard shortcut hint badge (`Tab to switch ⇥`).
  - **Search Input Bar** (36px high, rounded 9px, border in `accent`, background in `background`):
    - Search icon in `dim`.
    - Native `Input` element with auto-focus.
    - `Esc` badge to close the dialog.
  - **Content Body**:
    - **Left column**: Results list with fixed-height virtual scrolling supporting keyboard (`↑`/`↓`/`PageUp`/`PageDown`/`Enter`) and mouse wheel.
      - **`Files` results**: File icon in `muted`, matched file name with fuzzy matching highlights in `ansi4` (accent), and full relative path in `dim`.
      - **`Text` results**: Search icon in `ansi4`, file name, line number pill (`:line` in `ansi3`), and the matching code snippet with the query highlighted in bold `ansi4`.
      - **`All` results**: Combined top matching files and top matching text occurrences.
      - Selected row highlighted with `selected` background.
    - **Right column (Preview pane when enabled)**:
      - File header showing file icon, filename, directory path, total line count (or target `:line` pill), and syntax tag (`java`, `js`, `rs`, etc.).
      - Scrollable code view with monospace line numbers, matching line highlight, and query highlight.
  - **Discrete Bottom-Right Size Bar** (`files-search-size-bar`, 22px high, rounded 5px, background `raised`, border in `border`):
    - Shrink button `[-]` (`mods/files-search/minus.svg`).
    - Enlarge button `[+]` (`mods/files-search/plus.svg`).
    - Maximize / Restore button `[ ▢ ]` (`maximize.svg` / `restore.svg`).
    - Divider and Corner Grip handle `⋰` (`grip.svg`) with `cursor_nwse_resize()`.

## How it behaves

- **Triggering search**:
  - Click the magnifying glass icon in the `Files` panel header.
  - Double-Shift (`Shift+Shift`) within the `Files` panel (detected within a 400ms threshold).
  - Global shortcuts `Ctrl+P` or `Alt+F` from anywhere in Herdr (`mod.open:files-search`).
- **Moving the window**:
  - Click and drag anywhere on the header bar to move the floating window across the screen.
- **Resizing the window**:
  - Drag the bottom-right corner grip `⋰` in any direction.
  - Click `[-]`, `[+]`, or `[ ▢ ]` (maximize/restore) in the bottom-right status pill.
  - Keyboard shortcuts: `Ctrl + =` / `Ctrl + +` (enlarge), `Ctrl + -` (shrink), `Ctrl + 0` (reset size).
- **Preview toggle**:
  - Click the `[ ◨ Preview ]` button in the header, or press `Alt+P` / `Ctrl+P` to show or hide the live code preview pane.
- **Switching tabs**:
  - Click **All**, **Files**, or **Text** tabs, or press `Tab` / `Shift+Tab` to cycle between them without leaving the keyboard.
- **Searching**:
  - **`Files`**: Deep file tree indexing via `git ls-files` (or `rg --files` / `find`). Typing filters and ranks matching files using fuzzy scoring.
  - **`Text`**: Fast asynchronous ripgrep (`rg -n --no-heading`) streaming matching code lines and snippets in real-time.
  - **`All`**: Interleaves top file matches and code occurrences.
- **Selection**:
  - `↑` and `↓` arrow keys move through results, automatically updating the preview pane.
  - `Enter` or mouse click jumps directly to the file, closes the overlay, expands all parent folders in the file tree, and opens the preview in the main panel.
  - `Esc` closes the search overlay.

## Built from

- **Layout integration**: Replaces `{ "mod": "files" }` with `{ "mod": "files-search" }` in personal layouts (e.g., `layouts/main-copy.json`).
- **Keys integration**: Merges `"ctrl-p": "mod.open:files-search"` and `"alt-f": "mod.open:files-search"` under `"global"` in `keys.json`.
- **Mod files**:
  - `mods/files-search/main.js`: Dual-mode component (`Files` panel + `Search Everywhere` floating dialog).
  - `mods/files-search/mod.json`: Manifest declaring `files-search` as a clone of `files`.
  - SVG vector icons: `file.svg`, `folder.svg`, `chevron-down.svg`, `chevron-right.svg`, `search.svg`, `preview.svg`, `grip.svg`, `maximize.svg`, `restore.svg`, `minus.svg`, `plus.svg`.
- **Herdr APIs used**: `theme()`, `settings()`, `openOverlay()`, `closeOverlay()`, `shared()`, `setShared()`, `exec()`, `location()`.

## Watch out

- **Shipped Layout Immutability**: Herdr's shipped layouts (`main.json`, `terminals.json`, `win98.json`) are read-only and restored on start. Customizations must target personal layout clones (such as `main-copy.json`), which are cloned via `layout.clone` or created with `"cloned_from": {"name":"main"}`.
- **GPUI Mouse Hover Delivery**: In GPUI, mouse move and cursor styling (`cursor_nwse_resize`) are only delivered while the pointer hovers over an element. If a resize handle is too small, fast mouse movements can escape the handle or enter child elements (such as the code preview pane or input).
  - *Fix implemented*: An active full-card cover (`#resize-card-cover`) and a 400px outer tracking buffer (`.pr(400).pb(400)`) mount during resize to guarantee continuous tracking and clean `mouse_up` releases without pointer escape.
- **Centered Window Delta Projection**: Floating windows opened without an explicit `at` coordinate are centered by Herdr. The resize projection must use absolute offsets (`startW + (e.position.x - startX)`) to maintain strict 1:1 cursor alignment without drift or jumping.
- **Deep File Tree Traversal**: File searches must not enforce arbitrary folder depth limits so nested enterprise source trees (e.g. `src/main/java/...`) are indexed completely.

## Done when

- `herdr-app check ~/.config/herdr-app/mods/files-search` exits with code 0.
- Clicking the search icon or running `herdr-app do mod.open:files-search` opens the floating Search Everywhere dialog.
- Dragging the header moves the window.
- Dragging the bottom-right grip `⋰` smoothly resizes the window without breaking or sticking when moving fast.
- Clicking `[ ◨ Preview ]` splits the dialog into search results and a live code preview.
- Selecting a search result navigates to the file in the file tree and closes the overlay.
