// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ali Yaakub
// Markdown Peek - reading Notepad++'s live styling.
//
// Nothing here is a hard-coded colour. The palette is whatever the user's active
// Notepad++ theme has put into the Scintilla style table, and the style indices
// come from the same Lexilla lexer the editor is using, so the diff view is the
// editor's own colouring rather than an imitation of it.
#pragma once
#include "Common.h"

namespace Theme
{
    // JSON object: font, size, per-style colours, gutter and default colours.
    std::string paletteJson(HWND sci);

    // Per-line run-length encoding of style indices: "id:len,id:len|id:len,...",
    // one group per line, pipe separated. Read straight off the live document,
    // so it matches the editor exactly.
    std::string runsForDocument(HWND sci);

    // The same encoding for text that is not in any editor - the diff baseline.
    // Lexed by a hidden Scintilla using the lexer named by the current buffer.
    std::string runsForText(const std::string& utf8, const wchar_t* lexerName);

    void shutdown();
}
