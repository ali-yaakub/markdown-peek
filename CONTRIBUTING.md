# Contributing

## What you need

- Windows 10 or 11, x64.
- MSVC C++ toolset and the Windows SDK. [Visual Studio Build Tools][bt] is enough; the
  build script finds the toolchain with `vswhere`.
- Node 18 or later, for the tests and the browser harness.
- Notepad++ 8.8 or later, x64, to run the thing.

The WebView2 SDK headers and static loader are vendored under `third_party/`, and the
Notepad++ and Scintilla headers under `include/`, so there is nothing to restore.

[bt]: https://visualstudio.microsoft.com/downloads/#build-tools-for-visual-studio-2022

## The loop

```powershell
.\build.ps1                 # compile and stage into dist\
node test\diff.test.js      # 58 assertions over the diff engine
```

Most changes do not need a rebuild. The DLL is a shell: it owns the window, the WebView
and a small message bridge, and everything that decides what the panel looks like is
JavaScript and CSS on disk. Edit the copy under
`%APPDATA%\Notepad++\plugins\config\MarkdownPeek\assets\`, then run
**Plugins > Markdown Peek > Reload Preview Assets**. When the change is right, copy it
back into `assets\` in the repository.

For anything to do with rendering, the diff or scroll placement, work in the harness
instead of in Notepad++ — the round trip is seconds rather than a minute:

```powershell
node test\serve.js
```

Then open `http://localhost:8731/test/harness.html`. It stands in for the WebView2 host,
so both views, both themes and both scroll directions can be driven in an ordinary
browser. Add `?raf=timer` when a script is driving the page rather than a person: the page
renders inside a `requestAnimationFrame`, and a hidden browser tab never fires one.

## What the tests are for

`test/diff.test.js` covers the diff engine, and the load-bearing assertions are the two
reconstruction properties: dropping every added row must rebuild the baseline exactly, and
dropping every deleted row must rebuild the current document exactly. A diff that passes
both cannot be silently losing or inventing a line. Add to those rather than around them.

Anything that touches placement or sizing needs a number, not an impression. Both are
observable: `debugLog=1` in the ini writes the native side to `debug.log`, and
`window.MDPEEK_TRACE = true` in `assets/trace.js` adds the page's side, including the
scroll index and every pass of the fit scale.

## House style

- Match the file you are in. The C++ is `/W4`-clean, `std::` explicit, no exceptions
  across the plugin boundary; the JavaScript is ES5-flavoured with `var`, because it runs
  in one known engine and the file is meant to be edited in place by users.
- Comments say why, not what. A comment that restates the line below it is noise; one that
  records the constraint that produced the line is the reason the line survives a rewrite.
- Nothing in the panel builds HTML from document text. The diff view sets `textContent`
  and the page declares `script-src 'self'`, so markup in a Markdown file reaches the page
  as characters. Keep it that way.
- No new runtime dependencies. markdown-it is vendored and pinned; the plugin has no
  package manifest and no network access at all.

## Licence

By contributing you agree that your work is licensed under GPL-3.0-or-later, the same as
the rest of the project. See [LICENSE](LICENSE) and the note on why in the README.
