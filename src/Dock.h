// Markdown Peek - docked panel width, and the toolbar icon.
//
// Notepad++ gives plugins no supported way to set the width of their own docked
// panel. What it does have is the message its splitter sends when the user drags
// it, DMM_MOVE_SPLITTER, which is what this drives instead. Everything here fails
// quietly: if the docking layout is not what is expected, the panel simply keeps
// whatever width Notepad++ gave it.
#pragma once
#include "Common.h"

namespace Dock
{
    // Resize the panel's dock to `percent` of the editor area. Does nothing when
    // percent is zero, when the panel is floating, or when it is docked top or
    // bottom, where a width has no meaning.
    void applyWidth(HWND panel, int percent);

    // Watch the Notepad++ main window so the proportion survives a window resize.
    // Notepad++ holds a docked panel at a fixed pixel width, so without this the
    // share of the window drifts every time the window changes size.
    void startWatching(HWND panel, UINT_PTR timerId);
    void stopWatching();

    // Drawn rather than compiled in, so the plugin needs no resource file and no
    // resource compiler.
    HICON   makeIcon(bool dark);
    HBITMAP makeBitmap();
}
