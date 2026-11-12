// FilesSearch: File browser with search button + floating IntelliJ-style Search Everywhere dialog.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, Editor, EditorState, Input, InputState } from "gpui-base";
import {
  spaces, panes, focused, exec, readTextFile, watchFolder,
  theme, settings, window, props, openOverlay, closeOverlay,
  shared, setShared,
} from "herdr";

function location() {
  const space = spaces().find(s => s.active), f = focused();
  const pane = f?.pane ? panes().find(p => p.pane === f.pane) : null;
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  return { cwd: pane?.cwd || f?.cwd || space?.folder, on, space: space?.id };
}
const key = () => JSON.stringify(location());
const LANG = { ts: "js", tsx: "js", mts: "js", cts: "js", jsx: "js", mjs: "js", toml: "yaml", jsonc: "json", svelte: "html", vue: "html" };
const PER_FOLDER = 500, TOTAL = 5000;

async function directory(path, on) {
  const windowsDirectory = async () => {
    const r = await exec("powershell", ["-NoProfile", "-Command", "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); & { param($p) @(Get-ChildItem -LiteralPath $p -Force -ErrorAction Stop | Where-Object Name -ne '.git' | Select-Object -First 501 | ForEach-Object { @{ name=$_.Name; dir=($_.PSIsContainer -and (-not ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -or -not $_.LinkType -or ($_.Target -and [IO.Directory]::Exists(([IO.Path]::Combine([IO.Path]::GetDirectoryName($_.FullName), $_.Target[0])))))) } }) | ConvertTo-Json -Compress } '" + path.replace(/['‘’‚‛]/g, "$&$&") + "'"], { on });
    if (r.code !== 0) throw new Error(r.stderr || "Cannot list this folder");
    const result = JSON.parse(r.stdout || "[]");
    return Array.isArray(result) ? result : [result];
  };
  if (!on && window()?.platform === "windows") return windowsDirectory();
  const script = 'n=0; for p in "$1"/* "$1"/.[!.]* "$1"/..?*; do [ -e "$p" ] || [ -L "$p" ] || continue; name=${p##*/}; [ "$name" = .git ] && continue; if [ -d "$p" ]; then kind=d; else kind=f; fi; printf "%s\\0%s\\0" "$kind" "$name"; n=$((n+1)); [ "$n" -gt 500 ] && break; done; test -d "$1"';
  let r;
  try { r = await exec("sh", ["-c", script, "files", path], { on }); }
  catch (e) {
    if (on && String(e).includes("cannot start sh: program not found")) return windowsDirectory();
    throw e;
  }
  if (r.code !== 0) throw new Error(r.stderr || "Cannot list this folder");
  const fields = r.stdout.split("\0"), out = [];
  for (let i = 0; i + 1 < fields.length; i += 2) out.push({ name: fields[i + 1], dir: fields[i] === "d" });
  return out;
}

// Fuzzy score and hit indices for file matching
function fuzzy(q, text) {
  const t = text.toLowerCase();
  let score = 0, at = 0, run = 0;
  const hits = [];
  for (const ch of q) {
    const i = t.indexOf(ch, at);
    if (i < 0) return null;
    const start = i === 0 || /[\s:.\-_/]/.test(t[i - 1]);
    run = i === at && hits.length ? run + 1 : 0;
    score += 1 + (start ? 6 : 0) + run * 3 - Math.min(i - at, 6) * 0.3;
    hits.push(i);
    at = i + 1;
  }
  return { score: score - text.length * 0.02, hits };
}

const SHOWN = 9;
const ROW_H = 34;
const LIST_H = SHOWN * ROW_H;

export default class FilesSearch extends View {
  init(_props, cx) {
    this.isOverlay = Boolean(props()?.overlay);
    if (this.isOverlay) {
      this.initOverlay(cx);
    } else {
      this.initPanel(cx);
    }
  }

  // ==========================================
  // PANEL MODE (Files tab with Search Icon)
  // ==========================================
  initPanel(cx) {
    this.saved = new Map();
    this.entries = new Map();
    this.folders = new Set();
    this.pending = new Set();
    this.marks = {};
    this.lastSelectedTs = 0;
    this.lastShiftPress = 0;
    this.panelHandle = cx.focus_handle();
    this.refresh(cx);
    cx.timer.every(10000, cx => this.refresh(cx));
  }

  watch(root, cx) {
    if (this.on || this.watched === root) return;
    this.watched = root;
    const context = this.context;
    cx.spawn(async cx => {
      try {
        while (this.context === context) {
          await watchFolder(root);
          if (this.current(context)) this.refresh(cx);
        }
      } catch {
        if (this.context === context) this.watched = null;
      }
    });
  }

  current(context) {
    return this.context === context && key() === context.key;
  }

  async loadFolder(path, context) {
    const { on, cwd: root } = context;
    const entries = await directory(path ? `${root}/${path}` : root, on);
    if (!this.current(context) || (path && !this.folders.has(path))) return;
    const used = [...this.entries.entries()].filter(([p]) => p !== path).reduce((n, [, e]) => n + e.length, 0);
    this.entries.set(
      path,
      entries
        .slice(0, Math.max(0, Math.min(PER_FOLDER, TOTAL - used)))
        .sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name))
    );
    if (entries.length > PER_FOLDER || used + entries.length > TOTAL) this.limited = true;
  }

  refresh(cx) {
    const { cwd, on } = location(), next = key();
    if (next !== this.context?.key) {
      if (this.context) this.saved.set(this.context.key, { folders: this.folders, file: this.file });
      const saved = this.saved.get(next);
      this.context = { key: next, cwd, on };
      this.root = cwd;
      this.on = on;
      this.entries = new Map();
      this.folders = new Set(saved?.folders);
      this.pending = new Set();
      this.marks = {};
      this.show(null);
      this.watched = null;
      this.error = null;
      this.limited = false;
      this.loading = false;
      if (saved?.file) this.show(saved.file, cx);
    }
    if (!cwd || this.loading) return;
    const context = this.context;
    this.loading = true;
    this.limited = false;
    cx.spawn(async cx => {
      try {
        for (const path of ["", ...this.folders]) {
          if (!this.current(context)) return;
          await this.loadFolder(path, context);
        }
        const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on }).catch(() => null);
        const marks = {};
        if (top?.code === 0) {
          const status = await exec("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all"], { cwd, on }).catch(() => null);
          if (status?.code === 0) {
            for (const entry of status.stdout.split("\0").filter(Boolean).slice(0, TOTAL)) {
              const xy = entry.slice(0, 2);
              marks[`${top.stdout.trim()}/${entry.slice(3)}`] =
                xy === "??" || xy.includes("A") ? "A" : xy.includes("U") ? "U" : xy.includes("D") ? "D" : "M";
            }
          }
        }
        if (!this.current(context)) return;
        this.marks = marks;
        this.error = null;
        this.watch(cwd, cx);
      } catch (e) {
        if (this.current(context)) this.error = String(e);
      } finally {
        if (this.context === context) this.loading = false;
        cx.notify();
      }
    });
  }

  toggle(path, cx) {
    if (this.folders.has(path)) {
      for (const folder of [...this.folders]) {
        if (folder === path || folder.startsWith(path + "/")) {
          this.folders.delete(folder);
          this.entries.delete(folder);
        }
      }
    } else {
      this.folders.add(path);
      if (!this.entries.has(path) && !this.pending.has(path)) {
        const context = this.context;
        this.pending.add(path);
        cx.spawn(async cx => {
          try {
            await this.loadFolder(path, context);
          } catch (e) {
            if (this.current(context)) this.error = String(e);
          } finally {
            if (this.context === context) this.pending.delete(path);
            cx.notify();
          }
        });
      }
    }
    cx.notify();
  }

  show(path, cx) {
    this.code?.release();
    this.code = null;
    this.file = path;
    this.fileError = null;
    if (!path || !cx) return;
    const context = this.context, root = this.root, on = this.on;
    cx.spawn(async cx => {
      try {
        const text = await readTextFile(`${root}/${path}`, { on });
        if (this.file !== path || !this.current(context)) return;
        if (text === null) { this.fileError = "This file is no longer available"; return; }
        if (text.includes("\0")) { this.fileError = "Binary file · no text preview"; return; }
        const t = theme(), ext = path.includes(".") ? path.split(".").pop() : "txt";
        this.code = EditorState.new({
          language: LANG[ext] ?? ext,
          readonly: true,
          value: text.length > 400000 ? text.slice(0, 400000) + "\n… (file truncated)" : text,
          font_family: settings().font_family,
          font_size: 12,
          syntax: {
            keyword: t.ansi5,
            string: t.ansi2,
            comment: t.dim,
            function: t.ansi4,
            type: t.ansi3,
            number: t.ansi1,
            constant: t.ansi6,
          },
        });
      } catch {
        if (this.file === path && this.current(context)) this.fileError = "Cannot preview this file (binary, too large, or unreadable)";
      } finally {
        cx.notify();
      }
    });
  }

  // Open a file from external/search selection and expand its parent folders in the tree
  openFromSearch(path, cx) {
    if (!path) return;
    const segments = path.split("/");
    let accum = "";
    for (let i = 0; i < segments.length - 1; i++) {
      accum = accum ? `${accum}/${segments[i]}` : segments[i];
      this.folders.add(accum);
      if (!this.entries.has(accum) && !this.pending.has(accum)) {
        const context = this.context;
        this.pending.add(accum);
        cx.spawn(async cx => {
          try { await this.loadFolder(accum, context); }
          catch {}
          finally { if (this.context === context) this.pending.delete(accum); cx.notify(); }
        });
      }
    }
    this.show(path, cx);
    cx.notify();
  }

  openSearchOverlay() {
    const currentLoc = location();
    openOverlay({
      mod: "files-search",
      kind: "window",
      key: "files-search-win",
      frame: "none",
      props: {
        role: "search",
        root: this.root || currentLoc.cwd,
        on: this.on || currentLoc.on,
      },
    });
  }

  button(id, icon, action) {
    const t = theme();
    return div()
      .id(id)
      .size(26)
      .flex_none()
      .flex()
      .items_center()
      .justify_center()
      .rounded(6)
      .cursor_pointer()
      .text_color(t.muted)
      .hover(s => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click(action)
      .child(icon);
  }

  rows(prefix, depth, out, t) {
    if (out.length >= TOTAL || depth > 40) return out;
    for (const entry of this.entries.get(prefix) ?? []) {
      if (out.length >= TOTAL) break;
      const path = prefix ? `${prefix}/${entry.name}` : entry.name, open = this.folders.has(path), mark = this.marks[`${this.root}/${path}`];
      out.push(
        h_flex().id(`file-${path}`).h(28).flex_none().pl(8 + depth * 18).pr(8).gap(7).items_center().rounded(7).cursor_pointer().hover(s => s.bg(t.hover))
          .on_click((_e, cx) => (entry.dir ? this.toggle(path, cx) : this.show(path, cx)))
          .child(entry.dir ? svg(`mods/files-search/chevron-${open ? "down" : "right"}.svg`).size(12).flex_none().text_color(t.dim) : div().w(12).flex_none())
          .child(svg(`mods/files-search/${entry.dir ? "folder" : "file"}.svg`).size(14).flex_none().text_color(t.muted))
          .child(div().flex_1().min_w(0).truncate().child(entry.name))
          .when(Boolean(mark), el => el.child(div().text_size(11).text_color(mark === "A" ? t.ansi2 : mark === "D" || mark === "U" ? t.ansi1 : t.blocked).child(mark)))
      );
      if (entry.dir && open) this.rows(path, depth + 1, out, t);
    }
    return out;
  }

  renderPanel(cx) {
    if (key() !== this.context?.key) this.refresh(cx);

    // Check if a file was selected from Search Everywhere overlay
    const selectReq = shared("files-search.select");
    if (selectReq && selectReq.ts && selectReq.ts > (this.lastSelectedTs || 0)) {
      this.lastSelectedTs = selectReq.ts;
      if (selectReq.path) {
        this.openFromSearch(selectReq.path, cx);
      }
    }

    const t = theme();
    return v_flex()
      .id("files")
      .track_focus(this.panelHandle)
      .size_full()
      .min_h(0)
      .rounded(10)
      .overflow_hidden()
      .bg(t.background)
      .border_1()
      .border_color(t.border)
      .text_color(t.foreground)
      .text_size(13)
      .on_key_down((e, cx) => {
        // IntelliJ double Shift shortcut detection
        // Ignore key repeat when Shift is held down
        if (e.is_held) return;
        const now = Date.now();
        if (e.key === "shift" || e.keystroke === "shift" || e.keystroke === "shift-shift") {
          // Double shift press must be between 60ms (not a bounce/repeat) and 450ms
          const diff = now - this.lastShiftPress;
          if (diff >= 60 && diff <= 450) {
            this.lastShiftPress = 0;
            this.openSearchOverlay();
            cx.stop_propagation();
            return;
          }
          this.lastShiftPress = now;
        } else {
          this.lastShiftPress = 0;
        }
      })
      .child(
        h_flex()
          .h(42)
          .flex_none()
          .pl(14)
          .pr(10)
          .gap(8)
          .items_center()
          .border_b(1)
          .border_color(t.border)
          .when(Boolean(this.file), el =>
            el.child(this.button("files-back", div().child("←"), (_e, cx) => { this.show(null); cx.notify(); }))
          )
          .child(div().font_semibold().child("Files"))
          .child(div().flex_1().min_w(0).truncate().text_right().text_size(12).text_color(t.dim).child(this.file ?? this.root?.split(/[\\/]/).pop() ?? ""))
          .child(this.button("files-search-btn", svg("mods/files-search/search.svg").size(14), () => this.openSearchOverlay()))
      )
      .when(!this.file, el =>
        el.child(
          v_flex()
            .id("files-tree")
            .flex_1()
            .min_h(0)
            .overflow_y_scrollbar()
            .p(6)
            .children(this.rows("", 0, [], t))
            .when(Boolean(this.error) || !this.entries.get("")?.length, el =>
              el.child(div().p(8).text_size(12).text_color(t.dim).child(this.error || (this.loading ? "Loading files…" : this.root ? "No files" : "No folder")))
            )
            .when(this.limited, el =>
              el.child(div().p(8).text_size(11).text_color(t.dim).child("File list limited to 500 entries per folder and 5,000 total"))
            )
        )
      )
      .when(Boolean(this.file), el =>
        el.child(this.code ? Editor.new(this.code).flex_1().min_h(0) : div().p(12).text_color(t.dim).child(this.fileError || "Loading file…"))
      );
  }

  // ==========================================
  // OVERLAY MODE (IntelliJ-style Search Everywhere)
  // ==========================================
  initOverlay(cx) {
    const p = props();
    this.searchRoot = p?.root || location().cwd;
    this.searchOn = p?.on || location().on;
    this.tab = "all"; // "all" | "files" | "text"
    this.query = "";
    this.fileList = [];
    this.textResults = [];
    this.isSearchingText = false;
    this.searchSeq = 0;
    this.at = 0;
    this.scroll = 0;
    this.handle = cx.focus_handle();

    // Preview state (default enabled, remembers user preference)
    const savedPreview = shared("files-search.preview");
    this.showPreview = savedPreview !== null && savedPreview !== undefined ? Boolean(savedPreview) : true;
    this.previewItem = null;
    this.previewLines = [];
    this.previewLoading = false;
    this.previewError = null;
    this.previewScroll = 0;
    this.previewCache = new Map();
    this.previewEditorState = null;

    // Resize state (remembers user size preference)
    const savedSize = shared("files-search.customSize");
    this.customWidth = savedSize?.w || null;
    this.customListHeight = savedSize?.h || null;
    this.resizing = false;
    this.lastMouseX = 0;
    this.lastMouseY = 0;

    this.input = InputState.new({ placeholder: "Search everywhere by name or text (Tab to switch)..." });
    this.input.on("change", (_e, cx) => {
      this.query = this.input.value();
      this.at = 0;
      this.scroll = 0;
      this.triggerTextSearch(cx);
      if (this.showPreview) {
        const items = this.searchResults();
        this.updatePreview(items[0], cx);
      }
      cx.notify();
    });
    this.input.on("submit", (_e, cx) => {
      const items = this.searchResults();
      if (items[this.at]) this.selectResult(items[this.at], cx);
    });

    this.input.focus();
    cx.timer.after(200, () => this.input.focus());

    // Preload files in workspace
    this.loadWorkspaceFiles(cx);
  }

  close(cx) {
    this.code?.release();
    this.code = null;
    this.previewEditorState?.release();
    this.previewEditorState = null;
  }

  closeOverlay() {
    this.previewEditorState?.release();
    this.previewEditorState = null;
    closeOverlay(props().overlay);
  }

  adjustWindowSize(deltaW, deltaH, cx) {
    const defaultW = this.showPreview ? 1050 : 680;
    const minW = this.showPreview ? 860 : 540;
    const minH = 220;
    const maxW = 1900;
    const maxH = 900;

    const currentW = this.customWidth || defaultW;
    const currentH = this.customListHeight || LIST_H;

    this.customWidth = Math.max(minW, Math.min(maxW, currentW + deltaW));
    this.customListHeight = Math.max(minH, Math.min(maxH, currentH + deltaH));
    setShared("files-search.customSize", { w: this.customWidth, h: this.customListHeight });
    cx.notify();
  }

  startResize(e, defaultW, cx) {
    this.resizing = true;
    this.resizeStartX = e.position.x;
    this.resizeStartY = e.position.y;
    this.resizeStartW = this.customWidth || defaultW;
    this.resizeStartH = this.customListHeight || LIST_H;
    cx.stop_propagation();
    cx.notify();
  }

  handleResizeMove(e, minW, maxW, minH, maxH, cx) {
    if (!this.resizing) return;
    const totalDx = e.position.x - this.resizeStartX;
    const totalDy = e.position.y - this.resizeStartY;
    this.customWidth = Math.max(minW, Math.min(maxW, Math.round(this.resizeStartW + totalDx)));
    this.customListHeight = Math.max(minH, Math.min(maxH, Math.round(this.resizeStartH + totalDy)));
    cx.notify();
  }

  handleResizeEnd(cx) {
    if (!this.resizing) return;
    this.resizing = false;
    setShared("files-search.customSize", { w: this.customWidth, h: this.customListHeight });
    cx.notify();
  }

  selectResult(item, cx) {
    if (!item) return;
    setShared("files-search.select", {
      root: this.searchRoot,
      path: item.path,
      line: item.line || null,
      ts: Date.now(),
    });
    this.closeOverlay();
    cx.notify();
  }

  setPreviewEditor(text, targetPath) {
    this.previewEditorState?.release();
    this.previewEditorState = null;
    if (!text) return;
    const t = theme(), ext = targetPath.includes(".") ? targetPath.split(".").pop().toLowerCase() : "txt";
    try {
      this.previewEditorState = EditorState.new({
        language: LANG[ext] ?? ext,
        readonly: true,
        value: text,
        font_family: settings()?.font_family,
        font_size: 11.5,
        syntax: {
          keyword: t.ansi5,
          string: t.ansi2,
          comment: t.dim,
          function: t.ansi4,
          type: t.ansi3,
          number: t.ansi1,
          constant: t.ansi6,
        },
      });
    } catch {}
  }

  updatePreview(item, cx) {
    if (!item) {
      this.previewItem = null;
      this.previewLines = [];
      this.previewError = null;
      this.previewLoading = false;
      this.previewEditorState?.release();
      this.previewEditorState = null;
      return;
    }
    this.previewItem = item;
    const cached = this.previewCache.get(item.path);
    if (cached !== undefined) {
      this.previewLines = cached.lines;
      this.previewError = null;
      this.previewLoading = false;
      this.setPreviewEditor(cached.text, item.path);
      if (item.kind === "text" && item.line) {
        this.previewScroll = Math.max(0, item.line - 6);
      } else {
        this.previewScroll = 0;
      }
      return;
    }

    this.previewLoading = true;
    this.previewError = null;
    this.previewLines = [];
    this.previewEditorState?.release();
    this.previewEditorState = null;

    const root = this.searchRoot;
    const on = this.searchOn;
    const targetPath = item.path;

    cx.spawn(async cx => {
      try {
        const fullPath = `${root}/${targetPath}`;
        const text = await readTextFile(fullPath, { on });
        if (this.previewItem?.path !== targetPath) return;
        if (text === null) {
          this.previewError = "File not found";
          return;
        }
        if (text.includes("\0")) {
          this.previewError = "Binary file · no text preview";
          return;
        }
        const clean = text.length > 400000 ? text.slice(0, 400000) : text;
        const lines = clean.split("\n");
        this.previewCache.set(targetPath, { lines, text: clean });
        this.previewLines = lines;
        this.setPreviewEditor(clean, targetPath);
        if (item.kind === "text" && item.line) {
          this.previewScroll = Math.max(0, item.line - 6);
        } else {
          this.previewScroll = 0;
        }
      } catch (err) {
        if (this.previewItem?.path === targetPath) {
          this.previewError = "Cannot preview this file";
        }
      } finally {
        if (this.previewItem?.path === targetPath) {
          this.previewLoading = false;
          cx.notify();
        }
      }
    });
  }

  async loadWorkspaceFiles(cx) {
    const root = this.searchRoot;
    const on = this.searchOn;
    if (!root) return;

    cx.spawn(async cx => {
      try {
        let list = [];
        // Script that lists all workspace files with no depth truncation
        const script = 'if command -v rg >/dev/null 2>&1; then rg --files --hidden --glob "!.git" 2>/dev/null; elif git rev-parse --show-toplevel >/dev/null 2>&1; then git ls-files --cached --others --exclude-standard; else find . -not -path "*/.*" -not -path "*/target/*" -not -path "*/build/*" -not -path "*/node_modules/*" -type f | sed "s|^./||"; fi';
        const res = await exec("sh", ["-c", script], { cwd: root, on }).catch(() => null);
        if (res?.code === 0 && res.stdout.trim()) {
          list = res.stdout.split("\n").map(s => s.trim().replace(/^\.\//, "")).filter(Boolean);
        } else {
          // Fallback direct calls
          const gitRes = await exec("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { cwd: root, on }).catch(() => null);
          if (gitRes?.code === 0 && gitRes.stdout.trim()) {
            list = gitRes.stdout.split("\n").map(s => s.trim().replace(/^\.\//, "")).filter(Boolean);
          } else {
            const rgRes = await exec("rg", ["--files", "--hidden", "--glob", "!.git"], { cwd: root, on }).catch(() => null);
            if (rgRes?.code === 0 && rgRes.stdout.trim()) {
              list = rgRes.stdout.split("\n").map(s => s.trim().replace(/^\.\//, "")).filter(Boolean);
            }
          }
        }
        this.fileList = list.slice(0, 15000);
      } catch (err) {
        this.fileList = [];
      } finally {
        cx.notify();
      }
    });
  }

  triggerTextSearch(cx) {
    const q = this.query.trim();
    if (this.tab === "files" || !q || q.length < 2) {
      this.textResults = [];
      this.isSearchingText = false;
      return;
    }

    const seq = ++this.searchSeq;
    const root = this.searchRoot;
    const on = this.searchOn;
    this.isSearchingText = true;

    cx.spawn(async cx => {
      try {
        // Run ripgrep or git grep for content search
        let res = await exec(
          "rg",
          ["--vimgrep", "--no-heading", "--color=never", "--smart-case", "--max-count=35", "--max-columns=200", "--", q],
          { cwd: root, on }
        ).catch(() => null);

        if (!res || res.code !== 0) {
          res = await exec("git", ["grep", "-nI", "-i", "-m", "35", "--", q], { cwd: root, on }).catch(() => null);
        }

        if (seq !== this.searchSeq) return;

        const results = [];
        if (res && res.stdout) {
          const lines = res.stdout.split("\n");
          for (const line of lines) {
            if (!line.trim()) continue;
            // Format: path:line:col:text or path:line:text
            const m = line.match(/^([^:]+):(\d+):(?:(\d+):)?(.*)$/);
            if (m) {
              results.push({
                kind: "text",
                path: m[1].replace(/^\.\//, ""),
                line: parseInt(m[2], 10),
                content: m[4].trim(),
                matchedQuery: q,
              });
            }
            if (results.length >= 35) break;
          }
        }

        this.textResults = results;
      } catch {
        if (seq === this.searchSeq) this.textResults = [];
      } finally {
        if (seq === this.searchSeq) {
          this.isSearchingText = false;
          cx.notify();
        }
      }
    });
  }

  setTab(tab, cx) {
    this.tab = tab;
    this.at = 0;
    this.scroll = 0;
    if (tab === "text" || tab === "all") {
      this.triggerTextSearch(cx);
    }
    if (this.showPreview) {
      const items = this.searchResults();
      this.updatePreview(items[0], cx);
    }
    cx.notify();
  }

  cycleTab(direction, cx) {
    const tabs = ["all", "files", "text"];
    const idx = tabs.indexOf(this.tab);
    const nextIdx = (idx + direction + tabs.length) % tabs.length;
    this.setTab(tabs[nextIdx], cx);
  }

  // Returns array of items: { kind: 'file'|'text', path, name, hits, score, line?, content?, matchedQuery? }
  searchResults() {
    const rawQ = this.query.trim().toLowerCase();
    const q = rawQ.replace(/\s+/g, "");

    // 1. Matched files
    let matchedFiles = [];
    if (this.tab === "all" || this.tab === "files") {
      if (!rawQ) {
        matchedFiles = this.fileList.slice(0, 30).map(path => {
          const name = path.split("/").pop() || path;
          return { kind: "file", path, name, score: 0, hits: [] };
        });
      } else {
        const scored = [];
        for (const path of this.fileList) {
          const name = path.split("/").pop() || path;
          const matchName = fuzzy(q, name);
          const matchPath = fuzzy(q, path);
          const best = matchName ?? matchPath;
          if (best) {
            scored.push({
              kind: "file",
              path,
              name,
              score: best.score + (matchName ? 10 : 0),
              hits: matchName ? matchName.hits : [],
            });
          }
        }
        scored.sort((a, b) => b.score - a.score);
        matchedFiles = scored.slice(0, 50);
      }
    }

    // 2. Matched text
    const textItems = (this.tab === "all" || this.tab === "text") ? this.textResults : [];

    if (this.tab === "files") return matchedFiles;
    if (this.tab === "text") return textItems;

    // "All": top files, then top text results
    return [...matchedFiles.slice(0, 25), ...textItems.slice(0, 25)];
  }

  renderHighlightedTitle(t, text, hits, isSelected) {
    if (!hits || !hits.length) {
      return div().text_color(isSelected ? t.foreground : t.muted).child(text);
    }
    const parts = [];
    let cur = "";
    let lit = false;
    [...text].forEach((ch, i) => {
      const h = hits.includes(i);
      if (h !== lit && cur) {
        parts.push([cur, lit]);
        cur = "";
      }
      lit = h;
      cur += ch;
    });
    if (cur) parts.push([cur, lit]);

    return h_flex().children(
      parts.map(([s, h]) =>
        div()
          .text_color(h ? t.ansi4 : isSelected ? t.foreground : t.muted)
          .when(h, d => d.font_semibold())
          .child(s.replace(/ /g, "\u00a0"))
      )
    );
  }

  renderTextSnippet(t, content, query, isSelected) {
    if (!content || !query) return div().text_color(t.dim).child(content);
    const lowerContent = content.toLowerCase();
    const lowerQuery = query.toLowerCase();
    const idx = lowerContent.indexOf(lowerQuery);
    if (idx < 0) {
      return div().text_size(11.5).truncate().text_color(t.dim).child(content);
    }

    const before = content.slice(0, idx);
    const match = content.slice(idx, idx + query.length);
    const after = content.slice(idx + query.length);

    return h_flex()
      .text_size(11.5)
      .truncate()
      .child(div().text_color(t.dim).child(before.replace(/ /g, "\u00a0")))
      .child(div().text_color(t.ansi4).font_semibold().child(match.replace(/ /g, "\u00a0")))
      .child(div().text_color(t.dim).child(after.replace(/ /g, "\u00a0")));
  }

  renderSyntaxLine(t, text, ext, query, isTarget) {
    if (!text) return div().child("\u00a0");
    const clean = text.replace(/\t/g, "    ");

    const tokenRegex = /(\/\/.*$|#.*$|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|\b(?:class|public|private|protected|static|final|abstract|interface|extends|implements|import|package|return|new|this|super|if|else|for|while|do|switch|case|default|break|continue|try|catch|finally|throw|throws|void|int|long|short|byte|float|double|boolean|char|const|let|var|function|def|fn|async|await|export|from|as|type|struct|impl|trait|pub|mut|match|enum|select|defer|go)\b|\b[a-zA-Z_$][a-zA-Z0-9_$]*(?=\s*\()|\b[A-Z][a-zA-Z0-9_]*\b|\b(?:true|false|null|nil|None|undefined|[A-Z0-9_]{2,})\b|\b(?:0x[0-9a-fA-F]+|\d+(?:\.\d+)?)\b)/g;

    const spans = [];
    let lastIndex = 0;
    let match;
    const lowerQ = query ? query.toLowerCase() : "";

    const addTextChunk = (str, color, isBold = false) => {
      if (!str) return;
      if (lowerQ && str.toLowerCase().includes(lowerQ)) {
        const lowerStr = str.toLowerCase();
        let cur = 0;
        let qIdx = lowerStr.indexOf(lowerQ, cur);
        while (qIdx !== -1) {
          if (qIdx > cur) {
            spans.push({ text: str.slice(cur, qIdx), color, bold: isBold });
          }
          spans.push({ text: str.slice(qIdx, qIdx + query.length), color: t.background, bold: true, bg: t.accent });
          cur = qIdx + query.length;
          qIdx = lowerStr.indexOf(lowerQ, cur);
        }
        if (cur < str.length) {
          spans.push({ text: str.slice(cur), color, bold: isBold });
        }
      } else {
        spans.push({ text: str, color, bold: isBold });
      }
    };

    while ((match = tokenRegex.exec(clean)) !== null) {
      if (match.index > lastIndex) {
        addTextChunk(clean.slice(lastIndex, match.index), isTarget ? t.foreground : t.muted);
      }
      const tok = match[0];
      let color = isTarget ? t.foreground : t.muted;
      let bold = false;

      if (tok.startsWith("//") || tok.startsWith("#")) {
        color = t.dim;
      } else if (tok.startsWith('"') || tok.startsWith("'") || tok.startsWith("`")) {
        color = t.ansi2;
      } else if (/^\d/.test(tok) || tok.startsWith("0x")) {
        color = t.ansi1;
      } else if (/^(true|false|null|nil|None|undefined)$/.test(tok) || (tok.length > 1 && tok === tok.toUpperCase() && /^[A-Z0-9_]+$/.test(tok))) {
        color = t.ansi6;
      } else if (/^(class|public|private|protected|static|final|abstract|interface|extends|implements|import|package|return|new|this|super|if|else|for|while|do|switch|case|default|break|continue|try|catch|finally|throw|throws|void|int|long|short|byte|float|double|boolean|char|const|let|var|function|def|fn|async|await|export|from|as|type|struct|impl|trait|pub|mut|match|enum|select|defer|go)$/.test(tok)) {
        color = t.ansi5;
        bold = true;
      } else if (/^[A-Z]/.test(tok)) {
        color = t.ansi3;
      } else {
        color = t.ansi4;
      }

      addTextChunk(tok, color, bold);
      lastIndex = tokenRegex.lastIndex;
    }

    if (lastIndex < clean.length) {
      addTextChunk(clean.slice(lastIndex), isTarget ? t.foreground : t.muted);
    }

    if (spans.length === 0) {
      return div().child(clean ? clean.replace(/ /g, "\u00a0") : "\u00a0");
    }

    const row = h_flex().items_center();
    spans.forEach((s) => {
      const el = div()
        .text_size(11.5)
        .font_family(settings()?.font_family || "monospace")
        .text_color(s.color)
        .when(Boolean(s.bold), d => d.font_semibold())
        .when(Boolean(s.bg), d => d.bg(s.bg).rounded(2).px(2))
        .child(s.text.replace(/ /g, "\u00a0"));
      row.child(el);
    });
    return row;
  }

  renderHighlightedCodeLine(t, text, query) {
    if (!text || !query) return div().child(text ? text.replace(/\t/g, "    ").replace(/ /g, "\u00a0") : "\u00a0");
    const clean = text.replace(/\t/g, "    ");
    const lowerText = clean.toLowerCase();
    const lowerQ = query.toLowerCase();
    const idx = lowerText.indexOf(lowerQ);
    if (idx < 0) {
      return div().child(clean ? clean.replace(/ /g, "\u00a0") : "\u00a0");
    }
    const before = clean.slice(0, idx);
    const match = clean.slice(idx, idx + query.length);
    const after = clean.slice(idx + query.length);

    return h_flex()
      .child(div().child(before.replace(/ /g, "\u00a0")))
      .child(
        div()
          .bg(t.accent)
          .text_color(t.background)
          .font_semibold()
          .rounded(2)
          .px(2)
          .child(match.replace(/ /g, "\u00a0"))
      )
      .child(div().child(after.replace(/ /g, "\u00a0")));
  }

  renderPreviewPane(t, item, cx, listH = LIST_H, previewW = 520) {
    if (!item) {
      return v_flex()
        .w(previewW)
        .h(listH + 46)
        .rounded(8)
        .border_1()
        .border_color(t.border)
        .bg(t.background)
        .justify_center()
        .items_center()
        .child(div().text_size(12).text_color(t.dim).child("Select an item to preview"));
    }

    const isTextMatch = item.kind === "text" && item.line;
    const targetLine = isTextMatch ? item.line : null;
    const fileName = item.path.split("/").pop() || item.path;
    const dirPath = item.path.includes("/") ? item.path.slice(0, item.path.lastIndexOf("/")) : "";
    const ext = item.path.includes(".") ? item.path.split(".").pop().toLowerCase() : "";

    const LINE_H = 21;
    const VISIBLE_ROWS = Math.max(5, Math.floor((listH + 12) / LINE_H));
    const maxScroll = Math.max(0, this.previewLines.length - VISIBLE_ROWS);
    this.previewScroll = Math.max(0, Math.min(this.previewScroll, maxScroll));

    const visibleLines = [];
    const startIdx = this.previewScroll;
    const endIdx = Math.min(this.previewLines.length, startIdx + VISIBLE_ROWS);

    for (let i = startIdx; i < endIdx; i++) {
      const lineNum = i + 1;
      const isTarget = lineNum === targetLine;
      const lineContent = this.previewLines[i] ?? "";

      visibleLines.push(
        h_flex()
          .h(LINE_H)
          .flex_none()
          .items_center()
          .px(4)
          .gap(8)
          .cursor_pointer()
          .hover(s => s.bg(t.hover))
          .on_click(() => this.selectResult({ ...item, line: lineNum }, cx))
          .when(isTarget, el => el.bg(t.selected).border_l(3).border_color(t.accent))
          .when(!isTarget, el => el.border_l(3).border_color(t.background))
          // Line Number Gutter
          .child(
            div()
              .w(38)
              .flex_none()
              .text_right()
              .text_size(11)
              .font_family(settings()?.font_family || "monospace")
              .text_color(isTarget ? t.ansi3 : t.dim)
              .when(isTarget, el => el.font_semibold())
              .child(String(lineNum))
          )
          // Line Content with Syntax Highlighting
          .child(
            div()
              .flex_1()
              .min_w(0)
              .truncate()
              .child(this.renderSyntaxLine(t, lineContent, ext, isTarget ? item.matchedQuery : null, isTarget))
          )
      );
    }

    return v_flex()
      .w(previewW)
      .h(listH + 46)
      .flex_none()
      .rounded(8)
      .border_1()
      .border_color(t.border)
      .bg(t.background)
      .overflow_hidden()
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      // Preview Header
      .child(
        h_flex()
          .h(34)
          .flex_none()
          .px(10)
          .gap(7)
          .items_center()
          .border_b(1)
          .border_color(t.border)
          .bg(t.raised)
          .child(svg("mods/files-search/file.svg").size(13).flex_none().text_color(t.dim))
          .child(div().text_size(12).font_semibold().text_color(t.foreground).child(fileName))
          .when(Boolean(dirPath), el =>
            el.child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(dirPath))
          )
          .when(!dirPath, el => el.child(div().flex_1()))
          .when(Boolean(targetLine), el =>
            el.child(
              div()
                .px(6)
                .py(1)
                .rounded(4)
                .bg(t.selected)
                .border_1()
                .border_color(t.accent)
                .text_size(11)
                .font_family(settings()?.font_family || "monospace")
                .font_semibold()
                .text_color(t.ansi3)
                .child(`line ${targetLine}`)
            )
          )
          .when(!targetLine && this.previewLines.length > 0, el =>
            el.child(div().text_size(11).text_color(t.dim).child(`${this.previewLines.length} lines`))
          )
          .child(
            div()
              .px(7)
              .py(1.5)
              .rounded(4)
              .bg(t.background)
              .border_1()
              .border_color(t.border)
              .text_size(11)
              .text_color(t.dim)
              .cursor_pointer()
              .hover(s => s.bg(t.hover).text_color(t.foreground))
              .on_click(() => this.selectResult(item, cx))
              .child("Open ↵")
          )
      )
      // Preview Body
      .child(
        v_flex()
          .flex_1()
          .min_h(0)
          .overflow_hidden()
          .when(this.previewLoading, el =>
            el.child(div().p(20).text_center().text_size(12).text_color(t.dim).child("Loading preview…"))
          )
          .when(!this.previewLoading && Boolean(this.previewError), el =>
            el.child(div().p(20).text_center().text_size(12).text_color(t.dim).child(this.previewError))
          )
          .when(!this.previewLoading && !this.previewError && !targetLine, el =>
            el.child(
              this.previewEditorState
                ? Editor.new(this.previewEditorState).flex_1().min_h(0)
                : div().p(20).text_center().text_size(12).text_color(t.dim).child(visibleLines.length === 0 ? "Empty file" : "Loading preview…")
            )
          )
          .when(!this.previewLoading && !this.previewError && Boolean(targetLine), el =>
            el
              .py(4)
              .on_scroll_wheel((e, cx) => {
                const delta = e.delta.y > 0 ? -3 : 3;
                this.previewScroll = Math.max(0, Math.min(maxScroll, this.previewScroll + delta));
                cx.notify();
              })
              .children(visibleLines.length > 0 ? visibleLines : [div().p(20).text_center().text_size(12).text_color(t.dim).child("Empty file")])
          )
      );
  }

  renderOverlay(cx) {
    const t = theme();
    const results = this.searchResults();
    this.at = Math.min(this.at, Math.max(0, results.length - 1));
    const currentItem = results[this.at];
    if (this.showPreview && currentItem) {
      if (!this.previewItem || this.previewItem.path !== currentItem.path || this.previewItem.line !== currentItem.line) {
        this.updatePreview(currentItem, cx);
      }
    }

    // Dynamic width & height calculation with minimum and maximum bounds
    const defaultW = this.showPreview ? 1050 : 680;
    const minW = this.showPreview ? 860 : 540;
    const minH = 220;
    const maxW = 1900;
    const maxH = 900;

    let winW = this.customWidth || defaultW;
    winW = Math.max(minW, Math.min(maxW, winW));

    let listH = this.customListHeight || LIST_H;
    listH = Math.max(minH, Math.min(maxH, listH));

    const availableContentW = winW - 36;
    let leftW = 644;
    let previewW = 520;
    if (this.showPreview) {
      const remainingW = availableContentW - 12;
      leftW = Math.max(400, Math.min(620, Math.round(remainingW * 0.44)));
      previewW = Math.max(480, remainingW - leftW);
    } else {
      leftW = availableContentW;
    }

    const total = results.length * ROW_H;
    const fixed = total > listH;
    this.maxScroll = Math.max(0, total - listH);

    const selRow = this.at * ROW_H;
    if (selRow < this.scroll) this.scroll = selRow;
    if (selRow + ROW_H > this.scroll + listH) this.scroll = selRow + ROW_H - listH;
    this.scroll = Math.max(0, Math.min(this.scroll, this.maxScroll));

    const place = (el, start, end) =>
      fixed
        ? el.absolute().left(0).right(0).top(start - this.scroll).bottom(listH - (end - this.scroll))
        : el.flex_none().h(end - start);

    const visible = (start, end) => !fixed || (end > this.scroll && start < this.scroll + listH);

    const list = [];
    results.forEach((item, i) => {
      const rowStart = i * ROW_H;
      const rowEnd = rowStart + ROW_H;
      if (!visible(rowStart, rowEnd)) return;

      const on = i === this.at;
      const isFile = item.kind === "file";

      list.push(
        place(h_flex(), rowStart, rowEnd)
          .id(`search-row-${i}`)
          .mx(6)
          .px(10)
          .gap(9)
          .items_center()
          .rounded(7)
          .cursor_pointer()
          .text_size(12.5)
          .when(on, el => el.bg(t.selected))
          .hover(s => s.bg(t.hover))
          .on_click((_e, cx) => {
            if (this.showPreview && i !== this.at) {
              this.at = i;
              this.updatePreview(item, cx);
              cx.notify();
            } else {
              this.selectResult(item, cx);
            }
          })
          .child(
            svg(`mods/files-search/${isFile ? "file" : "search"}.svg`)
              .size(13)
              .flex_none()
              .text_color(isFile ? t.muted : t.ansi4)
          )
          .when(isFile, el =>
            el
              .child(div().min_w(0).child(this.renderHighlightedTitle(t, item.name, item.hits, on)))
              .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.dim).child(item.path.includes("/") ? item.path : ""))
          )
          .when(!isFile, el =>
            el
              .child(div().min_w(0).text_color(on ? t.foreground : t.muted).child(item.path.split("/").pop() || item.path))
              .child(div().text_size(11).text_color(t.ansi3).child(`:${item.line}`))
              .child(div().flex_1().min_w(0).child(this.renderTextSnippet(t, item.content, item.matchedQuery, on)))
          )
      );
    });

    return div()
      .id("files-search-overlay-root")
      .relative()
      // Generous invisible tracking buffer that activates during dragging so fast swipes never escape
      .when(Boolean(this.resizing), el =>
        el.pr(400)
          .pb(400)
          .cursor_nwse_resize()
          .on_mouse_move((e, cx) => this.handleResizeMove(e, minW, maxW, minH, maxH, cx))
          .on_mouse_up("left", (_e, cx) => this.handleResizeEnd(cx))
      )
      .on_mouse_down_out((_e, cx) => {
        if (this.resizing) {
          this.handleResizeEnd(cx);
        }
      })
      .child(
        v_flex()
          .id("files-search-overlay")
          .track_focus(this.handle)
          .relative()
          .w(winW)
          .min_h(0)
          .p(18)
          .gap(10)
          .rounded(10)
          .border_1()
          .border_color(t.border)
          .bg(t.popover)
          .shadow_lg()
          .on_mouse_up("left", (_e, cx) => this.handleResizeEnd(cx))
          .on_key_down((e, cx) => {
        const k = e.key;
        if (k === "escape") return this.closeOverlay();
        if (k === "tab") {
          this.cycleTab(e.shift ? -1 : 1, cx);
          cx.stop_propagation();
          return;
        }
        if (k === "down") {
          this.at = Math.min(this.at + 1, results.length - 1);
          if (this.showPreview && results[this.at]) this.updatePreview(results[this.at], cx);
        } else if (k === "up") {
          this.at = Math.max(this.at - 1, 0);
          if (this.showPreview && results[this.at]) this.updatePreview(results[this.at], cx);
        } else if (k === "pagedown") {
          this.at = Math.min(this.at + SHOWN, results.length - 1);
          if (this.showPreview && results[this.at]) this.updatePreview(results[this.at], cx);
        } else if (k === "pageup") {
          this.at = Math.max(this.at - SHOWN, 0);
          if (this.showPreview && results[this.at]) this.updatePreview(results[this.at], cx);
        } else if ((e.alt && k === "p") || (e.control && k === "p")) {
          this.showPreview = !this.showPreview;
          setShared("files-search.preview", this.showPreview);
          if (this.showPreview && results[this.at]) this.updatePreview(results[this.at], cx);
        } else if ((e.control || e.alt) && (k === "=" || k === "+")) {
          this.adjustWindowSize(120, 50, cx);
          cx.stop_propagation();
          return;
        } else if ((e.control || e.alt) && (k === "-" || k === "_")) {
          this.adjustWindowSize(-120, -50, cx);
          cx.stop_propagation();
          return;
        } else if ((e.control || e.alt) && k === "0") {
          this.customWidth = null;
          this.customListHeight = null;
          setShared("files-search.customSize", null);
          cx.stop_propagation();
          cx.notify();
          return;
        } else if (k === "enter") {
          if (results[this.at]) this.selectResult(results[this.at], cx);
        } else return;
        cx.stop_propagation();
        cx.notify();
      })
      // Header: IntelliJ style segmented tabs (All | Files | Text) & Draggable Title Bar
      .child(
        h_flex()
          .h(30)
          .flex_none()
          .gap(6)
          .items_center()
          .cursor_grab()
          .child(
            h_flex()
              .gap(2)
              .p(2)
              .rounded(6)
              .bg(t.raised)
              .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
              .child(
                div()
                  .px(9)
                  .py(2)
                  .rounded(4)
                  .cursor_pointer()
                  .text_size(11.5)
                  .font_medium()
                  .when(this.tab === "all", el => el.bg(t.background).text_color(t.foreground))
                  .when(this.tab !== "all", el => el.text_color(t.muted).hover(s => s.text_color(t.foreground)))
                  .on_click((_e, cx) => this.setTab("all", cx))
                  .child("All")
              )
              .child(
                div()
                  .px(9)
                  .py(2)
                  .rounded(4)
                  .cursor_pointer()
                  .text_size(11.5)
                  .font_medium()
                  .when(this.tab === "files", el => el.bg(t.background).text_color(t.foreground))
                  .when(this.tab !== "files", el => el.text_color(t.muted).hover(s => s.text_color(t.foreground)))
                  .on_click((_e, cx) => this.setTab("files", cx))
                  .child("Files")
              )
              .child(
                div()
                  .px(9)
                  .py(2)
                  .rounded(4)
                  .cursor_pointer()
                  .text_size(11.5)
                  .font_medium()
                  .when(this.tab === "text", el => el.bg(t.background).text_color(t.foreground))
                  .when(this.tab !== "text", el => el.text_color(t.muted).hover(s => s.text_color(t.foreground)))
                  .on_click((_e, cx) => this.setTab("text", cx))
                  .child("Text")
              )
          )
          .child(div().flex_1())
          .when(this.isSearchingText, el =>
            el.child(div().text_size(11).text_color(t.dim).child("Searching text…"))
          )
          // Preview Toggle Button
          .child(
            h_flex()
              .id("files-search-preview-toggle")
              .gap(5)
              .items_center()
              .px(8)
              .h(24)
              .rounded(5)
              .cursor_pointer()
              .border_1()
              .border_color(this.showPreview ? t.accent : t.border)
              .bg(this.showPreview ? t.selected : t.raised)
              .text_color(this.showPreview ? t.foreground : t.muted)
              .hover(s => s.text_color(t.foreground))
              .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
              .on_click((_e, cx) => {
                this.showPreview = !this.showPreview;
                setShared("files-search.preview", this.showPreview);
                if (this.showPreview && results[this.at]) {
                  this.updatePreview(results[this.at], cx);
                }
                cx.notify();
              })
              .child(svg("mods/files-search/preview.svg").size(12))
              .child(div().text_size(11).font_medium().child("Preview"))
          )
          .child(
            h_flex()
              .gap(4)
              .items_center()
              .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
              .child(div().text_size(11).text_color(t.dim).child("Tab to switch"))
              .child(
                div()
                  .px(5)
                  .rounded(4)
                  .border_1()
                  .border_color(t.border)
                  .bg(t.raised)
                  .text_size(11)
                  .text_color(t.dim)
                  .child("⇥")
              )
          )
      )
      // Content body: left column (Input + Results) and right column (Preview pane when enabled)
      .child(
        h_flex()
          .gap(12)
          .items_start()
          // Left column
          .child(
            v_flex()
              .w(leftW)
              .flex_none()
              .gap(10)
              .child(
                // Search Input
                h_flex()
                  .h(36)
                  .flex_none()
                  .px(10)
                  .gap(10)
                  .items_center()
                  .rounded(9)
                  .border_1()
                  .border_color(t.accent)
                  .bg(t.background)
                  .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
                  .child(svg("mods/files-search/search.svg").size(15).text_color(t.dim))
                  .child(Input.new(this.input).flex_1().h_full().text_size(12.8).text_color(t.foreground))
                  .child(
                    div()
                      .px(5)
                      .rounded(4)
                      .border_1()
                      .border_color(t.border)
                      .bg(t.raised)
                      .text_size(11)
                      .text_color(t.dim)
                      .cursor_pointer()
                      .hover(s => s.text_color(t.foreground))
                      .on_click(() => this.closeOverlay())
                      .child("Esc")
                  )
              )
              .child(
                results.length
                  ? div()
                      .id("search-rows")
                      .relative()
                      .mb(4)
                      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
                      .when(fixed, el => el.h(listH).overflow_hidden())
                      .on_scroll_wheel((e, cx) => {
                        this.scroll = Math.max(0, Math.min(this.scroll - e.delta.y, this.maxScroll));
                        while (this.at < results.length - 1 && this.at * ROW_H < this.scroll) this.at++;
                        while (this.at > 0 && (this.at + 1) * ROW_H > this.scroll + listH) this.at--;
                        if (this.showPreview && results[this.at]) this.updatePreview(results[this.at], cx);
                        cx.notify();
                      })
                      .children(fixed ? list : [v_flex().children(list)])
                  : div()
                      .px(16)
                      .py(16)
                      .text_size(12.5)
                      .text_color(t.dim)
                      .child(
                        this.query.trim()
                          ? `No matches found for "${this.query}".`
                          : "Type to search files or text across workspace..."
                      )
              )
          )
          // Right column: Preview pane
          .when(this.showPreview, el =>
            el.child(this.renderPreviewPane(t, results[this.at], cx, listH, previewW))
          )
      )
      // Bottom-right discrete size bar with [-] [+] [ ▢ ] and Grip handle
      .child(
        h_flex()
          .id("files-search-size-bar")
          .absolute()
          .right(8)
          .bottom(6)
          .h(22)
          .px(4)
          .gap(3)
          .items_center()
          .rounded(5)
          .bg(t.raised)
          .border_1()
          .border_color(t.border)
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          // Shrink [-]
          .child(
            div()
              .id("btn-resize-minus")
              .size(16)
              .rounded(3)
              .cursor_pointer()
              .flex()
              .items_center()
              .justify_center()
              .text_color(t.dim)
              .hover(s => s.bg(t.hover).text_color(t.foreground))
              .on_click((_e, cx) => this.adjustWindowSize(-120, -50, cx))
              .child(svg("mods/files-search/minus.svg").size(9))
          )
          // Enlarge [+]
          .child(
            div()
              .id("btn-resize-plus")
              .size(16)
              .rounded(3)
              .cursor_pointer()
              .flex()
              .items_center()
              .justify_center()
              .text_color(t.dim)
              .hover(s => s.bg(t.hover).text_color(t.foreground))
              .on_click((_e, cx) => this.adjustWindowSize(120, 50, cx))
              .child(svg("mods/files-search/plus.svg").size(9))
          )
          // Maximize / Restore [ ▢ ]
          .child(
            div()
              .id("btn-resize-max")
              .size(16)
              .rounded(3)
              .cursor_pointer()
              .flex()
              .items_center()
              .justify_center()
              .text_color(t.dim)
              .hover(s => s.bg(t.hover).text_color(t.foreground))
              .on_click((_e, cx) => {
                const isExpanded = Boolean(this.customWidth && this.customWidth >= 1350);
                if (isExpanded) {
                  this.customWidth = this.showPreview ? 1050 : 680;
                  this.customListHeight = LIST_H;
                } else {
                  this.customWidth = this.showPreview ? 1420 : 920;
                  this.customListHeight = 520;
                }
                setShared("files-search.customSize", { w: this.customWidth, h: this.customListHeight });
                cx.notify();
              })
              .child(svg(this.customWidth && this.customWidth >= 1350 ? "mods/files-search/restore.svg" : "mods/files-search/maximize.svg").size(10))
          )
          // Subtle separator
          .child(div().w(1).h(12).bg(t.border))
          // Corner Grip Handle
          .child(
            div()
              .id("resize-corner-grip")
              .size(18)
              .rounded(3)
              .cursor_nwse_resize()
              .flex()
              .items_center()
              .justify_center()
              .text_color(this.resizing ? t.accent : t.dim)
              .hover(s => s.text_color(t.foreground))
              .on_mouse_down("left", (e, cx) => this.startResize(e, defaultW, cx))
              .child(svg("mods/files-search/grip.svg").size(10))
          )
      )
      // When actively resizing, cover the entire card so moving fast over preview/input/rows
      // never loses the nwse-resize cursor, never triggers child hover states, and never breaks dragging
      .when(Boolean(this.resizing), el =>
        el.child(
          div()
            .id("resize-card-cover")
            .absolute()
            .top(0)
            .left(0)
            .size_full()
            .cursor_nwse_resize()
            .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
            .on_mouse_move((e, cx) => this.handleResizeMove(e, minW, maxW, minH, maxH, cx))
            .on_mouse_up("left", (_e, cx) => this.handleResizeEnd(cx))
        )
      )
    );
  }

  render(cx) {
    if (this.isOverlay) {
      return this.renderOverlay(cx);
    }
    return this.renderPanel(cx);
  }
}
