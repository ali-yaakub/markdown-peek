// Markdown Peek - shared declarations.
#pragma once

#define WIN32_LEAN_AND_MEAN
#define NOMINMAX

#include <windows.h>
#include <string>
#include <vector>
#include <cstdlib>
#include <cwctype>
#include <cstdarg>

#include "PluginInterface.h"
#include "Docking.h"
#include "dockingResource.h"

#define MDPEEK_NAME    L"Markdown Peek"
#define MDPEEK_MODULE  L"MarkdownPeek.dll"

extern NppData   g_npp;
extern HINSTANCE g_hInst;

// ---------------------------------------------------------------- paths ----

std::wstring pluginDllDir();     // folder holding MarkdownPeek.dll
std::wstring pluginConfigDir();  // %APPDATA%\Notepad++\plugins\config\MarkdownPeek
std::wstring assetsDir();        // <config>\assets  (user-editable copy)
void         seedAssets(bool overwrite);

// Appends one line to <config>\MarkdownPeek\debug.log when debugLog is set.
void dbg(const char* fmt, ...);

// -------------------------------------------------------------- strings ----

std::string  wideToUtf8(const std::wstring& w);
std::wstring utf8ToWide(const std::string& s);
std::string  jsonEscape(const std::string& s);
std::wstring lowerExtOf(const std::wstring& path);

// --------------------------------------------------------------- config ----

struct Config
{
    bool autoOpen   = true;   // open the panel when a Markdown buffer is activated
    bool diffMode   = false;  // render inline diff against the baseline
    bool syncCaret  = false;  // false: track first visible line; true: track caret
    bool baselineGit = false; // false: last saved on disk; true: git HEAD
    int  maxKiB     = 4096;   // skip auto-render above this document size
    int  widthPercent = 50;   // share of the editor area the dock takes; 0 leaves it alone
    bool debugLog   = false;  // trace notifications and messages to debug.log
    std::wstring extensions = L"md;markdown;mdown;mkd;mkdn;mdwn;mdtxt;mdtext;rmd;qmd";

    void load();
    void save() const;
    bool matchesExtension(const std::wstring& path) const;
};

extern Config g_cfg;

// --------------------------------------------------------------- editor ----

HWND        currentScintilla();
std::string editorTextUtf8(HWND sci);
int         firstVisibleDocLine(HWND sci);

// The same, but fractional. Scintilla scrolls by display lines, so with word
// wrap on, several wheel notches can leave the whole-number document line
// unchanged and the preview standing still. The fraction says how far through
// a wrapped line the viewport has reached, which is what makes the preview
// move at the same rate as the editor rather than in jumps.
double      firstVisibleDocLineExact(HWND sci);
int         caretLine(HWND sci);
int         linesOnScreen(HWND sci);
int         lineCount(HWND sci);
void        scrollDocLineToTop(HWND sci, int line);

std::wstring currentFilePath();
bool         currentBufferDirty();

// ------------------------------------------------------------- baseline ----

bool readFileAsUtf8(const std::wstring& path, std::string& out);
bool gitShowHead(const std::wstring& path, std::string& out);
