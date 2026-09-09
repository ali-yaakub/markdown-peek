// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ali Yaakub
// Markdown Peek - Notepad++ plugin entry points, menu and notification routing.

#include "Common.h"
#include "Dock.h"
#include "Panel.h"
#include "Scintilla.h"

#include <shellapi.h>

NppData   g_npp;
HINSTANCE g_hInst = nullptr;

namespace
{

enum MenuIndex
{
    IDX_TOGGLE = 0,
    IDX_SEP1,
    IDX_DIFF,
    IDX_GITBASE,
    IDX_SEP2,
    IDX_SYNCCARET,
    IDX_AUTOOPEN,
    IDX_SEP3,
    IDX_RELOAD,
    IDX_OPENDIR,
    IDX_ABOUT,
    MENU_COUNT
};

FuncItem     g_funcs[MENU_COUNT];
ShortcutKey* g_keyToggle = nullptr;
ShortcutKey* g_keyDiff   = nullptr;
bool         g_ready     = false;

void setCheck(int index, bool on)
{
    ::SendMessage(g_npp._nppHandle, NPPM_SETMENUITEMCHECK,
                  static_cast<WPARAM>(g_funcs[index]._cmdID), on ? TRUE : FALSE);
}

void refreshChecks()
{
    setCheck(IDX_DIFF,      g_cfg.diffMode);
    setCheck(IDX_GITBASE,   g_cfg.baselineGit);
    setCheck(IDX_SYNCCARET, g_cfg.syncCaret);
    setCheck(IDX_AUTOOPEN,  g_cfg.autoOpen);
    setCheck(IDX_TOGGLE,    Panel::isVisible());
}

// ------------------------------------------------------------ commands -----

void cmdToggle()
{
    Panel::toggle();
}

void cmdDiff()
{
    g_cfg.diffMode = !g_cfg.diffMode;
    g_cfg.save();
    setCheck(IDX_DIFF, g_cfg.diffMode);

    if (g_cfg.diffMode && !Panel::isVisible())
        Panel::show();
    else
        Panel::pushMode();
}

void cmdGitBaseline()
{
    g_cfg.baselineGit = !g_cfg.baselineGit;
    g_cfg.save();
    setCheck(IDX_GITBASE, g_cfg.baselineGit);
    Panel::pushMode();
}

void cmdSyncCaret()
{
    g_cfg.syncCaret = !g_cfg.syncCaret;
    g_cfg.save();
    setCheck(IDX_SYNCCARET, g_cfg.syncCaret);
    Panel::pushMode();
}

void cmdAutoOpen()
{
    g_cfg.autoOpen = !g_cfg.autoOpen;
    g_cfg.save();
    setCheck(IDX_AUTOOPEN, g_cfg.autoOpen);
}

void cmdReloadAssets()
{
    Panel::reloadAssets();
}

void cmdOpenAssetsFolder()
{
    ::ShellExecuteW(nullptr, L"open", assetsDir().c_str(), nullptr, nullptr, SW_SHOWNORMAL);
}

void cmdAbout()
{
    const std::wstring text =
        L"Markdown Peek\r\n"
        L"\r\n"
        L"A docked Markdown preview with scroll sync and inline rich diffs.\r\n"
        L"\r\n"
        L"Ctrl+Alt+M\ttoggle the preview\r\n"
        L"Ctrl+Alt+D\ttoggle inline diff mode\r\n"
        L"\r\n"
        L"Rendering, diffing and styling all live in editable files under:\r\n"
        + assetsDir() + L"\r\n\r\n"
        L"Edit them, then use Reload Preview Assets. No rebuild needed.";

    ::MessageBoxW(g_npp._nppHandle, text.c_str(), MDPEEK_NAME, MB_OK | MB_ICONINFORMATION);
}

void buildMenu()
{
    auto item = [](int idx, const wchar_t* name, PFUNCPLUGINCMD fn, ShortcutKey* key)
    {
        ::lstrcpynW(g_funcs[idx]._itemName, name, menuItemSize);
        g_funcs[idx]._pFunc = fn;
        g_funcs[idx]._pShKey = key;
        g_funcs[idx]._init2Check = false;
    };

    // A null function pointer is how Notepad++ is told to draw a separator.
    auto separator = [](int idx)
    {
        g_funcs[idx]._itemName[0] = L'\0';
        g_funcs[idx]._pFunc = nullptr;
        g_funcs[idx]._pShKey = nullptr;
    };

    g_keyToggle = new ShortcutKey{ true, true, false, 'M' };
    g_keyDiff   = new ShortcutKey{ true, true, false, 'D' };

    item(IDX_TOGGLE,    L"Markdown Preview",              cmdToggle,           g_keyToggle);
    separator(IDX_SEP1);
    item(IDX_DIFF,      L"Inline Diff Mode",              cmdDiff,             g_keyDiff);
    item(IDX_GITBASE,   L"Diff Against Git HEAD",         cmdGitBaseline,      nullptr);
    separator(IDX_SEP2);
    item(IDX_SYNCCARET, L"Sync to Caret Line",            cmdSyncCaret,        nullptr);
    item(IDX_AUTOOPEN,  L"Open Automatically for Markdown", cmdAutoOpen,       nullptr);
    separator(IDX_SEP3);
    item(IDX_RELOAD,    L"Reload Preview Assets",         cmdReloadAssets,     nullptr);
    item(IDX_OPENDIR,   L"Open Assets Folder",            cmdOpenAssetsFolder, nullptr);
    item(IDX_ABOUT,     L"About",                         cmdAbout,            nullptr);
}

} // namespace

// ------------------------------------------------------------ DLL entry ----

BOOL APIENTRY DllMain(HANDLE hModule, DWORD reason, LPVOID)
{
    if (reason == DLL_PROCESS_ATTACH)
    {
        g_hInst = static_cast<HINSTANCE>(hModule);
        ::DisableThreadLibraryCalls(static_cast<HMODULE>(hModule));
        buildMenu();
    }
    else if (reason == DLL_PROCESS_DETACH)
    {
        delete g_keyToggle;
        delete g_keyDiff;
        g_keyToggle = nullptr;
        g_keyDiff = nullptr;
    }
    return TRUE;
}

// -------------------------------------------------------- plugin exports ---

extern "C" __declspec(dllexport) void setInfo(NppData data)
{
    g_npp = data;
    Panel::init();
}

extern "C" __declspec(dllexport) const wchar_t* getName()
{
    return MDPEEK_NAME;
}

extern "C" __declspec(dllexport) FuncItem* getFuncsArray(int* count)
{
    *count = MENU_COUNT;
    return g_funcs;
}

extern "C" __declspec(dllexport) BOOL isUnicode()
{
    return TRUE;
}

extern "C" __declspec(dllexport) LRESULT messageProc(UINT, WPARAM, LPARAM)
{
    return TRUE;
}

extern "C" __declspec(dllexport) void beNotified(SCNotification* notify)
{
    if (!notify)
        return;

    const unsigned int code = notify->nmhdr.code;
    const HWND from = reinterpret_cast<HWND>(notify->nmhdr.hwndFrom);

    switch (code)
    {
    case NPPN_TBMODIFICATION:
    {
        // Icons are drawn at runtime; see Dock.cpp. Notepad++ takes ownership.
        static toolbarIconsWithDarkMode icons = {};
        icons.hToolbarBmp = Dock::makeBitmap();
        icons.hToolbarIcon = Dock::makeIcon(false);
        icons.hToolbarIconDarkMode = Dock::makeIcon(true);
        ::SendMessage(g_npp._nppHandle, NPPM_ADDTOOLBARICON_FORDARKMODE,
                      static_cast<WPARAM>(g_funcs[IDX_TOGGLE]._cmdID),
                      reinterpret_cast<LPARAM>(&icons));
        break;
    }

    case NPPN_READY:
    {
        g_cfg.load();
        seedAssets(false);
        Panel::setDockIds(IDX_TOGGLE, g_funcs[IDX_TOGGLE]._cmdID);
        g_ready = true;
        refreshChecks();

        // Notepad++ restores a docked panel itself when it was open at shutdown, so
        // only the auto-open rule needs applying here.
        if (g_cfg.autoOpen && g_cfg.matchesExtension(currentFilePath()))
            Panel::setVisible(true, false);
        break;
    }

    case NPPN_SHUTDOWN:
        g_ready = false;
        g_cfg.save();
        Panel::shutdown();
        break;

    case NPPN_BUFFERACTIVATED:
        if (g_ready)
            Panel::onBufferActivated(static_cast<uintptr_t>(notify->nmhdr.idFrom));
        break;

    case NPPN_FILECLOSED:
        // Buffer ids are reused, so a stale preference would attach to the wrong
        // file the next time one is opened.
        Panel::forgetBuffer(static_cast<uintptr_t>(notify->nmhdr.idFrom));
        break;

    case NPPN_FILESAVED:
        if (g_ready)
            Panel::onFileSaved();
        break;

    case NPPN_DARKMODECHANGED:
        if (g_ready)
            Panel::onDarkModeChanged();
        break;

    case NPPN_WORDSTYLESUPDATED:
        if (g_ready)
            Panel::onStylesUpdated();
        break;

    case SCN_MODIFIED:
        dbg("SCN_MODIFIED type=0x%x", notify->modificationType);
        // Only the two Scintilla views matter; ignore anything a plugin panel emits.
        if (g_ready
            && (from == g_npp._scintillaMainHandle || from == g_npp._scintillaSecondHandle)
            && (notify->modificationType & (SC_MOD_INSERTTEXT | SC_MOD_DELETETEXT)))
        {
            Panel::onTextModified();
        }
        break;

    case SCN_ZOOM:
        if (g_ready
            && (from == g_npp._scintillaMainHandle || from == g_npp._scintillaSecondHandle))
        {
            Panel::onZoomChanged();
        }
        break;

    case SCN_UPDATEUI:
        dbg("SCN_UPDATEUI updated=0x%x fromMain=%d ready=%d",
            notify->updated,
            (from == g_npp._scintillaMainHandle || from == g_npp._scintillaSecondHandle) ? 1 : 0,
            g_ready ? 1 : 0);
        if (g_ready
            && (from == g_npp._scintillaMainHandle || from == g_npp._scintillaSecondHandle)
            && (notify->updated & (SC_UPDATE_V_SCROLL | SC_UPDATE_SELECTION)))
        {
            Panel::onViewportChanged();
        }
        break;

    default:
        break;
    }
}
