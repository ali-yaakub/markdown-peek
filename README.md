# Markdown Peek

A Notepad++ plugin with a docked Markdown preview, scroll sync from the editor, and a
GitHub-style unified diff of the file you are editing.

Built and tested against Notepad++ 8.8.7 x64 on Windows 11.

## What it does

- **Preview.** Renders the active Markdown buffer in a docked panel as you type, using
  markdown-it with GFM tables, strikethrough, autolinks and task lists.
- **Scroll sync, editor to preview.** Tracks either the first visible line or the caret
  line. Placement comes from a source map, not a scroll percentage, so it stays accurate
  across code blocks, tables and images.
- **Inline diff.** Renders the source as a unified diff: two line-number gutters, `+`/`−`
  markers, tinted rows, word-level highlights inside edited lines, and `@@` headers naming
  the Markdown section. Distant unchanged regions collapse behind an expander.
- **Opens itself for Markdown.** Activating a `.md` buffer opens the panel.

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
| Markdown Preview | `Ctrl+Alt+M` | Show or hide the panel |
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
| `style.css` | Both palettes, chosen by Notepad++'s dark mode setting |
| `render.js` | markdown-it configuration and the source-line map |
| `diff.js` | Myers line diff, word diff, hunk grouping |
| `diffview.js` | The unified diff table |
| `sync.js` | Source line to pixel offset, and the scroll placement |
| `app.js` | The bridge, and which of the two views to show |

Settings live in `%APPDATA%\Notepad++\plugins\config\MarkdownPeek\MarkdownPeek.ini`:

```ini
[MarkdownPeek]
autoOpen=1
diffMode=0
syncCaret=0
baselineGit=0
maxKiB=4096
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

Output is a single 207 KiB DLL. The CRT and the WebView2 loader are linked statically, so
the only dependencies are system libraries and the WebView2 runtime, which ships with
Windows 11.

## Tests

```powershell
node test\diff.test.js
```

51 assertions over the diff engine. The load-bearing ones are the reconstruction
properties: dropping every added row must rebuild the baseline exactly, and dropping every
deleted row must rebuild the current document exactly. A 4,000-line document with 45 edits
diffs in about 12 ms.

For the panel itself:

```powershell
node test\serve.js
```

Then open `http://localhost:8731/test/harness.html`. The harness stands in for the
WebView2 host, so the preview, the diff, both themes and the scroll sync can be driven in
an ordinary browser.

## How it fits together

Notepad++ loads `MarkdownPeek.dll`, which registers a docked child window and hosts a
WebView2 control in it. Two virtual hosts are mapped into the WebView: `mdpeek.local`
serves the plugin's assets, and `mdpeek.doc` serves the edited file's own folder, so
relative images and links resolve without granting the page access to the disk.

The native side posts JSON to the page on four events — buffer activated, text modified
(debounced 180 ms), viewport moved (throttled 25 ms), and dark mode changed. The page
posts back short `verb:payload` strings, which is why the plugin carries no JSON parser.

Scripts embedded in a Markdown file cannot run: the page sets
`script-src 'self'` and the diff view escapes everything it renders.

## Third-party components

| Component | Version | Licence |
| --- | --- | --- |
| markdown-it | 14.1.0 | MIT |
| WebView2 SDK | 1.0.3485.44 | Microsoft, redistributable |
| Notepad++ plugin headers | from notepad-plus-plus master | GPL-3.0 |
| Scintilla headers | bundled with Notepad++ | HPND |
