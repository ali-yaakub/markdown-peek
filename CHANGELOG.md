# Changelog

Notable changes, newest first. The format follows [Keep a Changelog][kac]; versions follow
[semantic versioning][sv].

[kac]: https://keepachangelog.com/en/1.1.0/
[sv]: https://semver.org/spec/v2.0.0.html

## [Unreleased]

## [0.1.0] — 2026-09-09

First working version.

### Added

- Docked Markdown preview, rendered with markdown-it and GFM tables, strikethrough,
  autolinks and task lists.
- Scroll sync in both directions, placed from a source map rather than a scroll
  percentage, with a fractional source line so a wrapped line advances the preview
  smoothly.
- Inline unified diff against the last save or `git HEAD`: two line-number gutters,
  `+`/`−` markers, tinted rows, word-level highlights and `@@` headers naming the Markdown
  section.
- Diff colouring read from Notepad++'s live Scintilla style table, so it follows the
  user's theme rather than imitating one.
- Preview scaled to the editor's density, so both panes end a page on the same source
  line. Bounded to 55–115%; `fitPreview=0` turns it off.
- Zoom follows the editor's Ctrl+scroll.
- Panel held at a share of the window width across resizes, `widthPercent`.
- Panel visibility remembered per buffer for the session.
- Assets carrying a content stamp, so upgrading the DLL refreshes stale scripts and keeps
  what it replaced as a `.bak`.
