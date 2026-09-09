// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ali Yaakub
// Markdown Peek - docked panel width, and the toolbar icon. See Dock.h.
#include "Dock.h"

#include <commctrl.h>
#include <algorithm>

namespace
{

// Notepad++ registers two splitter classes: west-east for the left and right
// docks, north-south for top and bottom. Only the first can carry a width.
const wchar_t* kSplitterWE = L"wedockspliter";

HWND      s_panel = nullptr;
UINT_PTR  s_timerId = 0;
bool      s_watching = false;

struct FindSplitter
{
    RECT  container;
    HWND  best;
    int   bestGap;
    bool  onRight;
};

BOOL CALLBACK enumSplitters(HWND child, LPARAM param)
{
    wchar_t cls[64] = {};
    ::GetClassNameW(child, cls, 64);
    if (::lstrcmpiW(cls, kSplitterWE) != 0)
        return TRUE;
    if (!::IsWindowVisible(child))
        return TRUE;

    RECT rc = {};
    ::GetWindowRect(child, &rc);

    auto* f = reinterpret_cast<FindSplitter*>(param);

    // The splitter that owns this dock is the one lying against its inner edge.
    const int gap = f->onRight
        ? std::abs(static_cast<int>(rc.right - f->container.left))
        : std::abs(static_cast<int>(rc.left - f->container.right));

    if (gap < f->bestGap)
    {
        f->bestGap = gap;
        f->best = child;
    }
    return TRUE;
}

} // namespace

void Dock::applyWidth(HWND panel, int percent)
{
    HWND npp = g_npp._nppHandle;
    if (!panel || !npp || percent <= 0 || percent >= 100)
        return;

    // The layout is flatter than it looks. The docked container, both splitters
    // and the docking manager are all direct children of the Notepad++ main
    // window; the manager itself is a zero-sized window that exists only to
    // receive messages. So the container is found by climbing to the ancestor
    // whose parent is the main window, and the manager by its class name.
    HWND container = panel;
    while (container && ::GetParent(container) != npp)
        container = ::GetParent(container);
    if (!container)
        return;

    HWND manager = ::FindWindowExW(npp, nullptr, L"dockingManager", nullptr);
    if (!manager)
        return;

    RECT rcClient = {};
    RECT rcContainer = {};
    if (!::GetClientRect(npp, &rcClient) || !::GetWindowRect(container, &rcContainer))
        return;

    const int available = rcClient.right - rcClient.left;
    const int containerWidth = rcContainer.right - rcContainer.left;
    if (available <= 0 || containerWidth <= 0)
        return;

    // A dock spanning the full width is docked top or bottom, where a width
    // proportion means nothing.
    if (containerWidth >= available - 8)
        return;

    RECT rcNpp = {};
    ::GetWindowRect(npp, &rcNpp);
    const bool onRight = (rcContainer.left + rcContainer.right) / 2 > (rcNpp.left + rcNpp.right) / 2;

    int want = available * percent / 100;
    want = std::min(want, available - 160);      // always leave the editor something
    if (want < 160)
        return;

    int offset = want - containerWidth;
    if (std::abs(offset) < 6)
        return;                                   // near enough; do not fight the user

    // CONT_LEFT widens on a negative offset, CONT_RIGHT on a positive one.
    if (!onRight)
        offset = -offset;

    FindSplitter finder = {};
    finder.container = rcContainer;
    finder.best = nullptr;
    finder.bestGap = 64;                          // ignore splitters far from this dock
    finder.onRight = onRight;
    ::EnumChildWindows(npp, enumSplitters, reinterpret_cast<LPARAM>(&finder));

    if (!finder.best)
        return;

    ::SendMessage(manager, DMM_MOVE_SPLITTER,
                  static_cast<WPARAM>(offset), reinterpret_cast<LPARAM>(finder.best));
}

// ------------------------------------------------------- resize watching ----

namespace
{

LRESULT CALLBACK nppProc(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp,
                         UINT_PTR /*id*/, DWORD_PTR /*ref*/)
{
    if ((msg == WM_SIZE || msg == WM_EXITSIZEMOVE) && s_panel && ::IsWindow(s_panel))
    {
        // Re-apply after Notepad++ has finished its own layout pass, not during it.
        ::SetTimer(s_panel, s_timerId, 60, nullptr);
    }
    return ::DefSubclassProc(hwnd, msg, wp, lp);
}

} // namespace

void Dock::startWatching(HWND panel, UINT_PTR timerId)
{
    if (s_watching || !g_npp._nppHandle)
        return;
    s_panel = panel;
    s_timerId = timerId;
    s_watching = ::SetWindowSubclass(g_npp._nppHandle, nppProc, 1, 0) != FALSE;
}

void Dock::stopWatching()
{
    if (!s_watching)
        return;
    ::RemoveWindowSubclass(g_npp._nppHandle, nppProc, 1);
    s_watching = false;
    s_panel = nullptr;
}

// ------------------------------------------------------------------ icon ----

namespace
{

// A 16x16 mark: a panel outline with its right third filled, which is what the
// button does. Drawn into a premultiplied BGRA surface.
void paint(DWORD* px, bool dark)
{
    const int N = 16;
    const DWORD line = dark ? 0xFFD0D0D0 : 0xFF3A3A3A;
    const DWORD fill = dark ? 0xB33FB950 : 0xB32DA44E;

    for (int i = 0; i < N * N; ++i)
        px[i] = 0;

    auto set = [px, N](int x, int y, DWORD c)
    {
        if (x >= 0 && x < N && y >= 0 && y < N)
            px[y * N + x] = c;
    };

    const int L = 1, T = 2, R = 14, B = 13;   // outline, inclusive
    for (int x = L; x <= R; ++x) { set(x, T, line); set(x, B, line); }
    for (int y = T; y <= B; ++y) { set(L, y, line); set(R, y, line); }

    const int divider = 9;
    for (int y = T + 1; y < B; ++y)
        set(divider, y, line);

    for (int y = T + 1; y < B; ++y)
        for (int x = divider + 1; x < R; ++x)
            set(x, y, fill);
}

HBITMAP makeSurface(bool dark, void** bitsOut)
{
    BITMAPV5HEADER bi = {};
    bi.bV5Size = sizeof(bi);
    bi.bV5Width = 16;
    bi.bV5Height = -16;                 // top-down
    bi.bV5Planes = 1;
    bi.bV5BitCount = 32;
    bi.bV5Compression = BI_BITFIELDS;
    bi.bV5RedMask   = 0x00FF0000;
    bi.bV5GreenMask = 0x0000FF00;
    bi.bV5BlueMask  = 0x000000FF;
    bi.bV5AlphaMask = 0xFF000000;

    HDC screen = ::GetDC(nullptr);
    HBITMAP bmp = ::CreateDIBSection(screen, reinterpret_cast<BITMAPINFO*>(&bi),
                                     DIB_RGB_COLORS, bitsOut, nullptr, 0);
    ::ReleaseDC(nullptr, screen);

    if (bmp && *bitsOut)
        paint(static_cast<DWORD*>(*bitsOut), dark);
    return bmp;
}

} // namespace

HICON Dock::makeIcon(bool dark)
{
    void* bits = nullptr;
    HBITMAP colour = makeSurface(dark, &bits);
    if (!colour)
        return nullptr;

    HBITMAP mask = ::CreateBitmap(16, 16, 1, 1, nullptr);

    ICONINFO ii = {};
    ii.fIcon = TRUE;
    ii.hbmColor = colour;
    ii.hbmMask = mask;

    HICON icon = ::CreateIconIndirect(&ii);
    ::DeleteObject(colour);
    ::DeleteObject(mask);
    return icon;
}

// The classic toolbar icon sets take a bitmap rather than an icon, so the same
// mark is drawn again over the button face.
HBITMAP Dock::makeBitmap()
{
    void* bits = nullptr;
    HBITMAP bmp = makeSurface(false, &bits);
    if (!bmp || !bits)
        return bmp;

    const COLORREF face = ::GetSysColor(COLOR_BTNFACE);
    const DWORD ground = 0xFF000000
        | (static_cast<DWORD>(GetRValue(face)) << 16)
        | (static_cast<DWORD>(GetGValue(face)) << 8)
        | static_cast<DWORD>(GetBValue(face));

    auto* px = static_cast<DWORD*>(bits);
    for (int i = 0; i < 16 * 16; ++i)
        if ((px[i] >> 24) == 0)
            px[i] = ground;

    return bmp;
}
