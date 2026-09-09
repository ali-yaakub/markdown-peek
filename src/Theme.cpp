// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ali Yaakub
// Markdown Peek - reading Notepad++'s live styling. See Theme.h.
#include "Theme.h"
#include "Scintilla.h"

namespace
{

// Style indices worth asking about. Lexilla's markdown lexer uses 0 to 21; the
// two above 31 are Scintilla's own reserved styles for the text default and the
// line-number margin, which is where the diff gutter takes its colours from.
constexpr int kMaxLexStyle = 40;

HWND s_hidden = nullptr;          // scratch Scintilla used to lex the baseline
std::wstring s_hiddenLexer;       // lexer currently set on it

std::string hexOf(COLORREF c)
{
    char buf[8] = {};
    wsprintfA(buf, "#%02x%02x%02x",
              static_cast<int>(GetRValue(c)),
              static_cast<int>(GetGValue(c)),
              static_cast<int>(GetBValue(c)));
    return buf;
}

void appendStyle(std::string& out, HWND sci, int id, bool& first)
{
    const COLORREF fore = static_cast<COLORREF>(::SendMessage(sci, SCI_STYLEGETFORE, id, 0));
    const COLORREF back = static_cast<COLORREF>(::SendMessage(sci, SCI_STYLEGETBACK, id, 0));
    const bool bold   = ::SendMessage(sci, SCI_STYLEGETBOLD, id, 0) != 0;
    const bool italic = ::SendMessage(sci, SCI_STYLEGETITALIC, id, 0) != 0;

    if (!first)
        out += ",";
    first = false;

    out += "\"" + std::to_string(id) + "\":{\"f\":\"" + hexOf(fore) + "\",\"b\":\"" + hexOf(back)
         + "\",\"o\":" + (bold ? "1" : "0") + ",\"i\":" + (italic ? "1" : "0") + "}";
}

// Turns a byte stream of style indices into "id:len,id:len|..." with a new group
// at every newline in the parallel character stream.
std::string encodeRuns(const char* chars, const unsigned char* styles, size_t n)
{
    std::string out;
    out.reserve(n / 4 + 32);

    size_t i = 0;
    bool lineEmpty = true;

    while (i < n)
    {
        if (chars[i] == '\n')
        {
            out += "|";
            lineEmpty = true;
            ++i;
            continue;
        }

        const unsigned char style = styles[i];
        size_t run = 0;
        while (i + run < n && chars[i + run] != '\n' && styles[i + run] == style)
            ++run;

        if (!lineEmpty)
            out += ",";
        out += std::to_string(static_cast<int>(style));
        out += ":";
        out += std::to_string(run);
        lineEmpty = false;
        i += run;
    }
    return out;
}

// Pulls characters and their style bytes out of a Scintilla in one call rather
// than one message per character.
std::string readStyledText(HWND sci)
{
    const Sci_Position len = static_cast<Sci_Position>(::SendMessage(sci, SCI_GETLENGTH, 0, 0));
    if (len <= 0)
        return std::string();

    std::vector<char> buf(static_cast<size_t>(len) * 2 + 2, 0);

    Sci_TextRangeFull tr = {};
    tr.chrg.cpMin = 0;
    tr.chrg.cpMax = len;
    tr.lpstrText = buf.data();

    const Sci_Position got = static_cast<Sci_Position>(
        ::SendMessage(sci, SCI_GETSTYLEDTEXTFULL, 0, reinterpret_cast<LPARAM>(&tr)));
    if (got <= 0)
        return std::string();

    const size_t n = static_cast<size_t>(got);
    std::vector<char> chars(n);
    std::vector<unsigned char> styles(n);
    for (size_t i = 0; i < n; ++i)
    {
        chars[i]  = buf[i * 2];
        styles[i] = static_cast<unsigned char>(buf[i * 2 + 1]);
    }

    return encodeRuns(chars.data(), styles.data(), n);
}

} // namespace

std::string Theme::paletteJson(HWND sci)
{
    if (!sci)
        return "{}";

    char fontName[128] = {};
    ::SendMessage(sci, SCI_STYLEGETFONT, STYLE_DEFAULT, reinterpret_cast<LPARAM>(fontName));
    const int size = static_cast<int>(::SendMessage(sci, SCI_STYLEGETSIZE, STYLE_DEFAULT, 0));

    std::string out = "{\"font\":\"" + jsonEscape(fontName) + "\",\"size\":" + std::to_string(size);

    out += ",\"styles\":{";
    bool first = true;
    for (int id = 0; id <= kMaxLexStyle; ++id)
        appendStyle(out, sci, id, first);
    appendStyle(out, sci, STYLE_DEFAULT, first);
    appendStyle(out, sci, STYLE_LINENUMBER, first);
    out += "}";

    out += ",\"defaultStyle\":" + std::to_string(STYLE_DEFAULT);
    out += ",\"gutterStyle\":" + std::to_string(STYLE_LINENUMBER);
    out += "}";
    return out;
}

std::string Theme::runsForDocument(HWND sci)
{
    if (!sci)
        return std::string();

    // Styling is lazy, so ask for the whole document to be coloured before
    // reading it; an untouched tail would otherwise come back as style zero.
    ::SendMessage(sci, SCI_COLOURISE, 0, static_cast<LPARAM>(-1));
    return readStyledText(sci);
}

std::string Theme::runsForText(const std::string& utf8, const wchar_t* lexerName)
{
    if (utf8.empty() || !lexerName)
        return std::string();

    if (!s_hidden)
    {
        s_hidden = reinterpret_cast<HWND>(::SendMessage(
            g_npp._nppHandle, NPPM_CREATESCINTILLAHANDLE, 0,
            reinterpret_cast<LPARAM>(g_npp._nppHandle)));
        if (!s_hidden)
            return std::string();
        ::SendMessage(s_hidden, SCI_SETCODEPAGE, SC_CP_UTF8, 0);
    }

    if (s_hiddenLexer != lexerName)
    {
        void* lexer = reinterpret_cast<void*>(::SendMessage(
            g_npp._nppHandle, NPPM_CREATELEXER, 0, reinterpret_cast<LPARAM>(lexerName)));
        if (!lexer)
            return std::string();
        ::SendMessage(s_hidden, SCI_SETILEXER, 0, reinterpret_cast<LPARAM>(lexer));
        s_hiddenLexer = lexerName;
    }

    ::SendMessage(s_hidden, SCI_SETTEXT, 0, reinterpret_cast<LPARAM>(utf8.c_str()));
    ::SendMessage(s_hidden, SCI_COLOURISE, 0, static_cast<LPARAM>(-1));
    return readStyledText(s_hidden);
}

void Theme::shutdown()
{
    if (s_hidden)
    {
        ::DestroyWindow(s_hidden);
        s_hidden = nullptr;
    }
    s_hiddenLexer.clear();
}
