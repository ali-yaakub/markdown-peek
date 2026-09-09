# Markdown Peek

A Notepad++ plugin with a docked Markdown preview, scroll sync from the editor, and a
GitHub-style unified diff of the file you are editing.

Built and tested against Notepad++ 8.8.7 and 8.9.7, x64, on Windows 11.

## What it does

- **Preview.** Renders the active Markdown buffer in a docked panel as you type, using
  markdown-it with GFM tables, strikethrough, autolinks and task lists.
- **Scroll sync, both ways.** Scroll the editor and the preview follows; scroll the preview
  and the editor follows. Placement comes from a source map, not a scroll percentage, so it
  stays accurate across code blocks, tables and images. The reported line is fractional, so
  a wrapped line advances the preview smoothly rather than in jumps, and updates are
  throttled rather than debounced, so the preview tracks a gesture instead of catching up
  after it. Whichever pane you touch holds the scrollbar for a moment, so the two never
  chase each other. Editor-to-preview tracks either the first visible line or the caret.
- **Inline diff.** Renders the source as a unified diff: two line-number gutters, `+`/`−`
  markers, tinted rows, word-level highlights inside edited lines, and `@@` headers naming
  the Markdown section. Distant unchanged regions collapse behind an expander.
- **Your theme, not a copy of it.** The diff's font, background, gutter and every syntax
  colour are read out of Notepad++'s live Scintilla style table. Change theme, or edit a
  style in the Style Configurator, and the panel follows. Only the red and green change
  tints are the plugin's own, and they are translucent so they sit correctly on any
  background.
- **Zoom follows the editor.** Ctrl+scroll in Notepad++ and both panes resize together.
- **Scaled to match the editor's density.** Proportional prose with a gap between blocks is
  taller than the same source as wrapped monospace, so the two panes would otherwise agree
  only on their top line. The preview measures how many screenfuls the editor needs for the
  document, measures its own, and scales itself until the two figures match, which puts the
  same source line at the foot of both panes. The scale is recomputed when the document,
  the window or word wrap changes, and held still in between. It is bounded to between 55%
  and 115%, so a document of images cannot shrink the text away. Set `fitPreview=0` to keep
  the preview at its natural size.
- **Half the window, and it stays half.** The panel takes 50% of the editor area and holds
  that share when the window is resized, rather than the fixed pixel width Notepad++ would
  otherwise keep. Set `widthPercent` to change the share, or to `0` to leave the width
  alone entirely.
- **Shown or hidden per tab.** Closing the panel is remembered against that buffer, so a
  peek can be closed on one file and left open on another. Buffers not yet decided follow
  the auto-open rule. The record lasts for the session and is dropped when a file closes.
- **Opens itself for Markdown.** Activating a `.md` buffer opens the panel.

The preview is styled separately, after Claude Code: warm ground, coral accent, and the
full width of the panel. It is a reading surface rather than a second editor, so it does
not try to look like one.

## Install

Build first, then copy the staged folder into the Notepad++ plugins directory. That
directory sits under `Program Files`, so the copy needs an elevated shell.

```powershell
powershell -Command "Start-Process powershell -Verb RunAs -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','C:\Users\aliya\source\repos\npp-md\build.ps1','-Install'"
```

Restart Notepad++. The plugin appears under **Plugins > Markdown Peek**.

To install by hand instead, copy `dist\MarkdownPeek` to
`C:\Program Files\Notepad++\plugins\MarkdownPeek`.

## Opening .md files in the preview by double-click

Two halves, and only the second is the plugin's.

1. **Make Notepad++ the default application for `.md`.** Right-click any `.md` file,
   choose **Open with > Choose another app**, pick Notepad++, and tick **Always use this
   app**. Windows 11 requires this to go through its own dialog; no script can set the
   default for you.
2. **Have the panel open itself.** On by default. Toggle it at
   **Plugins > Markdown Peek > Open Automatically for Markdown**.

## Menu

| Command | Shortcut | Effect |
| --- | --- | --- |
| Markdown Preview | `Ctrl+Alt+M`, or the toolbar button | Show or hide the panel for this tab |
| Inline Diff Mode | `Ctrl+Alt+D` | Switch between preview and unified diff |
| Diff Against Git HEAD | | Baseline is `git show HEAD:<file>` instead of the file on disk |
| Sync to Caret Line | | Track the caret rather than the first visible line |
| Open Automatically for Markdown | | Open the panel when a Markdown buffer is activated |
| Reload Preview Assets | | Re-read the HTML, CSS and JavaScript from disk |
| Open Assets Folder | | Open the editable copy in Explorer |

Double-clicking a block in the preview, or a row in the diff, moves the editor to the line
that produced it.

## Turning it off

- **For the session:** `Ctrl+Alt+M`, or the panel's close button.
- **Permanently:** **Plugins > Plugins Admin > Installed > Markdown Peek > Remove**, or
  move `plugins\MarkdownPeek` into `plugins\disabled`. Notepad++ itself never needs
  rebuilding or reinstalling.

## Changing behaviour without rebuilding

The DLL is a thin shell. It owns the window, the WebView and a small message bridge;
everything that decides what the panel looks like is JavaScript and CSS on disk.

On first run the assets are copied to
`%APPDATA%\Notepad++\plugins\config\MarkdownPeek\assets\`, which needs no administrator
rights. Edit them, then run **Reload Preview Assets**. Existing files are never
overwritten by an upgrade, so hand edits survive.

| File | Responsibility |
| --- | --- |
| `index.html` | Page shell and content security policy |
| `style.css` | The preview palette, and the diff's layout. Diff colours are not here; they arrive at runtime |
| `render.js` | markdown-it configuration and the source-line map |
| `diff.js` | Myers line diff, word diff, style-run expansion, hunk grouping |
| `diffview.js` | The unified diff table |
| `theme.js` | Turns Notepad++'s style table into CSS rules |
| `sync.js` | Source line to pixel offset, and the scroll placement |
| `app.js` | The bridge, both scroll directions, the fit scale, and which of the two views to show |

The dock width and the toolbar icon are native rather than scripted, in `src\Dock.cpp`.

The shipped assets carry a `VERSION` stamp of their own content. When it moves, the
installed copy is refreshed and whatever is replaced is kept beside it as a `.bak`. Without
that, upgrading the plugin left old scripts running against a new DLL.

Setting `debugLog=1` traces notifications, messages and scroll positions to
`debug.log` in the same folder. An `SCN_UPDATEUI` line with no `pushViewport` after it
means the panel was hidden for that buffer; setting `window.MDPEEK_TRACE = true` in `trace.js`
adds the page's side of it.

Settings live in `%APPDATA%\Notepad++\plugins\config\MarkdownPeek\MarkdownPeek.ini`:

```ini
[MarkdownPeek]
autoOpen=1
diffMode=0
syncCaret=0
baselineGit=0
maxKiB=4096
widthPercent=50
fitPreview=1
debugLog=0
extensions=md;markdown;mdown;mkd;mkdn;mdwn;mdtxt;mdtext;rmd;qmd
```

## Building from source

Needs the MSVC C++ toolset and the Windows SDK. Visual Studio Build Tools is enough; the
build script locates the toolchain with `vswhere`.

```powershell
.\build.ps1            # compile and stage into dist\
.\build.ps1 -Clean     # discard objects first
.\build.ps1 -Install   # also copy into the plugins folder (needs elevation)
```

Output is a single 228 KiB DLL. The CRT and the WebView2 loader are linked statically, so
the only dependencies are system libraries and the WebView2 runtime, which ships with
Windows 11.

## Tests

```powershell
node test\diff.test.js
```

58 assertions over the diff engine. The load-bearing ones are the reconstruction
properties: dropping every added row must rebuild the baseline exactly, and dropping every
deleted row must rebuild the current document exactly. A 4,000-line document with 45 edits
diffs in about 20 ms, style runs included.

For the panel itself:

```powershell
node test\serve.js
```

Then open `http://localhost:8731/test/harness.html`. The harness stands in for the
WebView2 host, so the preview, the diff, both themes and the scroll sync can be driven in
an ordinary browser. The page renders inside a `requestAnimationFrame`, which a hidden
browser tab never fires; add `?raf=timer` to drive it from a timer instead when the tab is
being scripted rather than watched.

## How it fits together

Notepad++ loads `MarkdownPeek.dll`, which registers a docked child window and hosts a
WebView2 control in it. Two virtual hosts are mapped into the WebView: `mdpeek.local`
serves the plugin's assets, and `mdpeek.doc` serves the edited file's own folder, so
relative images and links resolve without granting the page access to the disk.

The native side posts JSON to the page on six events — buffer activated, text modified
(debounced 180 ms), viewport moved (throttled 25 ms), zoom changed, dark mode changed, and
styles reconfigured. The page posts back short `verb:payload` strings, which is why the
plugin carries no JSON parser.

Styling travels with the document. `SCI_GETSTYLEDTEXTFULL` returns the whole buffer as
character and lexer-style-index pairs in one call, which the plugin run-length encodes and
sends alongside the text; the diff baseline, which is in no editor, is lexed by a hidden
Scintilla created with `NPPM_CREATESCINTILLAHANDLE` and the Lexilla lexer from
`NPPM_CREATELEXER`. Colours for those indices come from `SCI_STYLEGETFORE` and its
siblings on the live view, so they are the user's theme by construction rather than by
imitation.

Notepad++ offers plugins no way to set the width of their own docked panel, so the panel
drives the same message its splitter sends when dragged, `DMM_MOVE_SPLITTER`, addressed to
the `dockingManager` window and re-applied whenever the main window is resized. Every step
of that fails quietly: if the layout is not what is expected, the panel simply keeps
whatever width Notepad++ gave it. The toolbar icon is drawn with GDI at startup rather than
compiled in, which is why the build needs no resource compiler.

Scripts embedded in a Markdown file cannot run. The page sets `script-src 'self'`, and the
diff view never builds HTML at all: rows carry plain text and the view sets it through
`textContent`, so markup in a document reaches the page as characters.

## Third-party components

| Component | Version | Licence |
| --- | --- | --- |
| markdown-it | 14.1.0 | MIT |
| WebView2 SDK | 1.0.3485.44 | Microsoft, redistributable |
| Notepad++ plugin headers | from notepad-plus-plus master | GPL-3.0 |
| Scintilla headers | bundled with Notepad++ | HPND |
