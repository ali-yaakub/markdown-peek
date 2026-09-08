// Markdown Peek - the docked preview panel.
#pragma once
#include "Common.h"

namespace Panel
{
    void init();                 // register the window class; call once from DllMain-time setup
    void shutdown();             // tear the WebView down before Notepad++ exits

    bool isVisible();
    void show();
    void hide();
    void toggle();

    // Notepad++ needs two different identifiers: the funcItem index to restore the
    // panel on the next launch, and the allocated command id to tick the menu item.
    void setDockIds(int funcIndex, int cmdId);

    // Editor events worth reacting to.
    void onBufferActivated();
    void onTextModified();
    void onViewportChanged();
    void onZoomChanged();
    void onFileSaved();
    void onDarkModeChanged();
    void onStylesUpdated();

    // Settings changed from the menu.
    void pushMode();
    void refreshBaseline();
    void reloadAssets();
}
