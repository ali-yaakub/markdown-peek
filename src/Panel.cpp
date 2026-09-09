// Markdown Peek - the docked preview panel and its WebView2 host.
//
// The native side stays deliberately thin. It owns the window, the WebView and a
// small message bridge; everything that decides what the preview looks like -
// parsing, diffing, scroll interpolation, styling - lives in the JavaScript under
// the user's config folder and can be edited without rebuilding this DLL.

#include "Panel.h"
#include "Dock.h"
#include "Theme.h"
#include "Scintilla.h"

#include <wrl/client.h>
#include <functional>
#include <map>
#include <shellapi.h>

#include "WebView2.h"

using Microsoft::WRL::ComPtr;

// ------------------------------------------------------- COM plumbing ------

namespace
{

template <class I>
class ComBase : public I
{
public:
    virtual ~ComBase() {}

    HRESULT STDMETHODCALLTYPE QueryInterface(REFIID riid, void** ppv) override
    {
        if (!ppv)
            return E_POINTER;
        if (riid == IID_IUnknown || riid == __uuidof(I))
        {
            *ppv = static_cast<I*>(this);
            AddRef();
            return S_OK;
        }
        *ppv = nullptr;
        return E_NOINTERFACE;
    }

    ULONG STDMETHODCALLTYPE AddRef() override
    {
        return static_cast<ULONG>(::InterlockedIncrement(&m_ref));
    }

    ULONG STDMETHODCALLTYPE Release() override
    {
        const ULONG r = static_cast<ULONG>(::InterlockedDecrement(&m_ref));
        if (r == 0)
            delete this;
        return r;
    }

private:
    LONG m_ref = 1;
};

class EnvHandler : public ComBase<ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler>
{
public:
    using Fn = std::function<HRESULT(HRESULT, ICoreWebView2Environment*)>;
    explicit EnvHandler(Fn fn) : m_fn(std::move(fn)) {}
    HRESULT STDMETHODCALLTYPE Invoke(HRESULT hr, ICoreWebView2Environment* env) override { return m_fn(hr, env); }
private:
    Fn m_fn;
};

class ControllerHandler : public ComBase<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>
{
public:
    using Fn = std::function<HRESULT(HRESULT, ICoreWebView2Controller*)>;
    explicit ControllerHandler(Fn fn) : m_fn(std::move(fn)) {}
    HRESULT STDMETHODCALLTYPE Invoke(HRESULT hr, ICoreWebView2Controller* c) override { return m_fn(hr, c); }
private:
    Fn m_fn;
};

class WebMessageHandler : public ComBase<ICoreWebView2WebMessageReceivedEventHandler>
{
public:
    using Fn = std::function<HRESULT(ICoreWebView2*, ICoreWebView2WebMessageReceivedEventArgs*)>;
    explicit WebMessageHandler(Fn fn) : m_fn(std::move(fn)) {}
    HRESULT STDMETHODCALLTYPE Invoke(ICoreWebView2* s, ICoreWebView2WebMessageReceivedEventArgs* a) override { return m_fn(s, a); }
private:
    Fn m_fn;
};

class NavStartingHandler : public ComBase<ICoreWebView2NavigationStartingEventHandler>
{
public:
    using Fn = std::function<HRESULT(ICoreWebView2*, ICoreWebView2NavigationStartingEventArgs*)>;
    explicit NavStartingHandler(Fn fn) : m_fn(std::move(fn)) {}
    HRESULT STDMETHODCALLTYPE Invoke(ICoreWebView2* s, ICoreWebView2NavigationStartingEventArgs* a) override { return m_fn(s, a); }
private:
    Fn m_fn;
};

class NewWindowHandler : public ComBase<ICoreWebView2NewWindowRequestedEventHandler>
{
public:
    using Fn = std::function<HRESULT(ICoreWebView2*, ICoreWebView2NewWindowRequestedEventArgs*)>;
    explicit NewWindowHandler(Fn fn) : m_fn(std::move(fn)) {}
    HRESULT STDMETHODCALLTYPE Invoke(ICoreWebView2* s, ICoreWebView2NewWindowRequestedEventArgs* a) override { return m_fn(s, a); }
private:
    Fn m_fn;
};

// ------------------------------------------------------------- state ------

const wchar_t* kClassName = L"MarkdownPeekPanel";
const wchar_t* kAppHost   = L"mdpeek.local";   // serves the plugin's own assets
const wchar_t* kDocHost   = L"mdpeek.doc";     // serves the edited file's own folder
const wchar_t* kAppOrigin = L"https://mdpeek.local/";

constexpr UINT_PTR kTimerDoc    = 1;
constexpr UINT_PTR kTimerScroll = 2;
constexpr UINT_PTR kTimerDock   = 3;
constexpr UINT     kDocDelayMs    = 180;
constexpr UINT     kScrollDelayMs = 25;

HWND  s_hwnd = nullptr;
bool  s_registered = false;   // registered with the docking manager
bool  s_visible = false;
int   s_dockIndex = 0;
int   s_dockCmdId = 0;

// Visibility is remembered per buffer, so the panel can be closed on one tab and
// left open on another. Entries are dropped when their file closes, because
// Notepad++ reuses buffer ids.
std::map<uintptr_t, bool> s_perBuffer;

uintptr_t currentBufferId()
{
    return static_cast<uintptr_t>(
        ::SendMessage(g_npp._nppHandle, NPPM_GETCURRENTBUFFERID, 0, 0));
}

ComPtr<ICoreWebView2Controller> s_controller;
ComPtr<ICoreWebView2>           s_web;
bool s_webReady = false;

std::wstring s_mappedDocDir;     // folder currently mapped to kDocHost
std::wstring s_lastPushedPath;
std::string  s_lastBaseline;
bool         s_baselineValid = false;

LRESULT CALLBACK panelProc(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp);

// ---------------------------------------------------------- messaging ------

void postJson(const std::string& json)
{
    if (!s_webReady || !s_web)
    {
        dbg("postJson DROPPED (ready=%d web=%d) %.60s",
            s_webReady ? 1 : 0, s_web ? 1 : 0, json.c_str());
        return;
    }
    s_web->PostWebMessageAsJson(utf8ToWide(json).c_str());
}

int editorZoom()
{
    HWND sci = currentScintilla();
    return sci ? static_cast<int>(::SendMessage(sci, SCI_GETZOOM, 0, 0)) : 0;
}

void pushZoom()
{
    postJson("{\"t\":\"zoom\",\"zoom\":" + std::to_string(editorZoom()) + "}");
}

void pushTheme()
{
    const bool dark = ::SendMessage(g_npp._nppHandle, NPPM_ISDARKMODEENABLED, 0, 0) != 0;
    std::string j = "{\"t\":\"theme\",\"dark\":";
    j += dark ? "true" : "false";
    j += ",\"zoom\":";
    j += std::to_string(editorZoom());
    j += ",\"editor\":";
    j += Theme::paletteJson(currentScintilla());
    j += "}";
    postJson(j);
}

void pushMode()
{
    std::string j = "{\"t\":\"mode\",\"diff\":";
    j += g_cfg.diffMode ? "true" : "false";
    j += ",\"sync\":\"";
    j += g_cfg.syncCaret ? "caret" : "top";
    j += "\",\"baselineSource\":\"";
    j += g_cfg.baselineGit ? "git" : "saved";
    j += "\"}";
    postJson(j);
}

void pushViewport()
{
    HWND sci = currentScintilla();
    if (!sci)
        return;

    char buf[256] = {};
    wsprintfA(buf,
        "{\"t\":\"view\",\"first\":%d,\"caret\":%d,\"screen\":%d,\"total\":%d}",
        firstVisibleDocLine(sci), caretLine(sci), linesOnScreen(sci), lineCount(sci));
    dbg("pushViewport %s", buf);
    postJson(buf);
}

// Maps the edited file's folder onto a virtual host so relative images and links
// in the Markdown resolve, without giving the page access to the whole disk.
void mapDocumentFolder(const std::wstring& path)
{
    ComPtr<ICoreWebView2_3> web3;
    if (!s_web || FAILED(s_web.As(&web3)))
        return;

    std::wstring dir;
    const size_t slash = path.find_last_of(L'\\');
    if (slash != std::wstring::npos)
        dir = path.substr(0, slash);

    if (dir == s_mappedDocDir)
        return;

    web3->ClearVirtualHostNameToFolderMapping(kDocHost);
    s_mappedDocDir.clear();

    if (!dir.empty())
    {
        web3->SetVirtualHostNameToFolderMapping(
            kDocHost, dir.c_str(), COREWEBVIEW2_HOST_RESOURCE_ACCESS_KIND_DENY_CORS);
        s_mappedDocDir = dir;
    }
}

void computeBaseline()
{
    s_lastBaseline.clear();
    s_baselineValid = false;

    if (!g_cfg.diffMode)
        return;

    const std::wstring path = currentFilePath();
    if (path.empty())
        return;

    if (g_cfg.baselineGit)
        s_baselineValid = gitShowHead(path, s_lastBaseline);
    else
        s_baselineValid = readFileAsUtf8(path, s_lastBaseline);
}

void pushBaseline()
{
    std::string j = "{\"t\":\"baseline\",\"ok\":";
    j += s_baselineValid ? "true" : "false";
    j += ",\"source\":\"";
    j += g_cfg.baselineGit ? "git" : "saved";
    j += "\",\"text\":\"";
    j += jsonEscape(s_lastBaseline);
    j += "\",\"runs\":\"";
    if (s_baselineValid)
        j += Theme::runsForText(s_lastBaseline, L"markdown");
    j += "\"}";
    postJson(j);
}

void pushDocument()
{
    HWND sci = currentScintilla();
    if (!sci)
        return;

    const std::wstring path = currentFilePath();
    const bool isMarkdown = g_cfg.matchesExtension(path);

    const LRESULT bytes = ::SendMessage(sci, SCI_GETLENGTH, 0, 0);
    const bool tooBig = bytes > static_cast<LRESULT>(g_cfg.maxKiB) * 1024;

    if (path != s_lastPushedPath)
    {
        mapDocumentFolder(path);
        s_lastPushedPath = path;
    }

    std::string j = "{\"t\":\"doc\",\"path\":\"";
    j += jsonEscape(wideToUtf8(path));
    j += "\",\"markdown\":";
    j += isMarkdown ? "true" : "false";
    j += ",\"tooBig\":";
    j += tooBig ? "true" : "false";
    j += ",\"bytes\":";
    j += std::to_string(static_cast<long long>(bytes));
    j += ",\"dirty\":";
    j += currentBufferDirty() ? "true" : "false";
    j += ",\"text\":\"";
    if (!tooBig)
        j += jsonEscape(editorTextUtf8(sci));
    j += "\",\"runs\":\"";
    if (!tooBig)
        j += Theme::runsForDocument(sci);
    j += "\"}";

    postJson(j);
    pushViewport();
}

void pushEverything()
{
    pushTheme();
    pushMode();
    computeBaseline();
    pushBaseline();
    pushDocument();
}

// -------------------------------------------------- inbound from the page ---

// The page speaks a deliberately dull line protocol - "verb:payload" - so the
// native side never needs a JSON parser.
void handleWebMessage(const std::wstring& msg)
{
    const size_t colon = msg.find(L':');
    const std::wstring verb = colon == std::wstring::npos ? msg : msg.substr(0, colon);
    const std::wstring arg  = colon == std::wstring::npos ? std::wstring() : msg.substr(colon + 1);

    if (verb == L"ready")
    {
        s_webReady = true;
        pushEverything();
    }
    else if (verb == L"goto")
    {
        HWND sci = currentScintilla();
        if (sci)
        {
            const int line = ::_wtoi(arg.c_str());
            scrollDocLineToTop(sci, line);
        }
    }
    else if (verb == L"baseline")
    {
        computeBaseline();
        pushBaseline();
    }
    else if (verb == L"open")
    {
        ::ShellExecuteW(nullptr, L"open", arg.c_str(), nullptr, nullptr, SW_SHOWNORMAL);
    }
    else if (verb == L"log")
    {
        dbg("page: %s", wideToUtf8(arg).c_str());
    }
}

// ------------------------------------------------------ WebView startup -----

void navigateToApp()
{
    if (!s_web)
        return;
    std::wstring url = std::wstring(L"https://") + kAppHost + L"/index.html";
    s_web->Navigate(url.c_str());
}

void createWebView()
{
    if (s_controller || !s_hwnd)
        return;

    seedAssets(false);

    const std::wstring userData = pluginConfigDir() + L"\\WebView2";
    ::CreateDirectoryW(userData.c_str(), nullptr);

    auto* envDone = new EnvHandler(
        [](HRESULT hr, ICoreWebView2Environment* env) -> HRESULT
        {
            if (FAILED(hr) || !env || !s_hwnd)
                return S_OK;

            auto* ctrlDone = new ControllerHandler(
                [](HRESULT hr2, ICoreWebView2Controller* controller) -> HRESULT
                {
                    if (FAILED(hr2) || !controller)
                        return S_OK;

                    s_controller = controller;
                    s_controller->get_CoreWebView2(&s_web);
                    if (!s_web)
                        return S_OK;

                    ComPtr<ICoreWebView2Settings> settings;
                    if (SUCCEEDED(s_web->get_Settings(&settings)) && settings)
                    {
                        settings->put_IsStatusBarEnabled(FALSE);
                        settings->put_AreDefaultContextMenusEnabled(TRUE);
                        settings->put_IsZoomControlEnabled(FALSE);
                        settings->put_AreDevToolsEnabled(TRUE);
                    }

                    ComPtr<ICoreWebView2_3> web3;
                    if (SUCCEEDED(s_web.As(&web3)) && web3)
                    {
                        web3->SetVirtualHostNameToFolderMapping(
                            kAppHost, assetsDir().c_str(),
                            COREWEBVIEW2_HOST_RESOURCE_ACCESS_KIND_DENY_CORS);
                    }

                    EventRegistrationToken tok = {};

                    // Each handler starts with one reference of ours. add_* takes
                    // its own, so ours has to go back.
                    auto* onMessage = new WebMessageHandler(
                            [](ICoreWebView2*, ICoreWebView2WebMessageReceivedEventArgs* args) -> HRESULT
                            {
                                LPWSTR raw = nullptr;
                                if (args && SUCCEEDED(args->TryGetWebMessageAsString(&raw)) && raw)
                                {
                                    const std::wstring msg(raw);
                                    ::CoTaskMemFree(raw);
                                    handleWebMessage(msg);
                                }
                                return S_OK;
                            });
                    s_web->add_WebMessageReceived(onMessage, &tok);
                    onMessage->Release();

                    // Anything leaving the plugin's own asset host is a real link;
                    // hand it to the system browser rather than replacing the
                    // preview with it.
                    auto* onNavigate = new NavStartingHandler(
                            [](ICoreWebView2*, ICoreWebView2NavigationStartingEventArgs* args) -> HRESULT
                            {
                                LPWSTR uri = nullptr;
                                if (!args || FAILED(args->get_Uri(&uri)) || !uri)
                                    return S_OK;
                                const std::wstring u(uri);
                                ::CoTaskMemFree(uri);

                                // A prefix test, not a substring one: a URL merely
                                // mentioning the host elsewhere is not the host.
                                if (u.rfind(kAppOrigin, 0) == 0 || u == L"about:blank")
                                    return S_OK;

                                args->put_Cancel(TRUE);
                                if (u.rfind(L"http", 0) == 0 || u.rfind(L"mailto:", 0) == 0)
                                    ::ShellExecuteW(nullptr, L"open", u.c_str(), nullptr, nullptr, SW_SHOWNORMAL);
                                return S_OK;
                            });
                    s_web->add_NavigationStarting(onNavigate, &tok);
                    onNavigate->Release();

                    auto* onNewWindow = new NewWindowHandler(
                            [](ICoreWebView2*, ICoreWebView2NewWindowRequestedEventArgs* args) -> HRESULT
                            {
                                LPWSTR uri = nullptr;
                                if (args && SUCCEEDED(args->get_Uri(&uri)) && uri)
                                {
                                    ::ShellExecuteW(nullptr, L"open", uri, nullptr, nullptr, SW_SHOWNORMAL);
                                    ::CoTaskMemFree(uri);
                                }
                                if (args)
                                    args->put_Handled(TRUE);
                                return S_OK;
                            });
                    s_web->add_NewWindowRequested(onNewWindow, &tok);
                    onNewWindow->Release();

                    RECT rc = {};
                    ::GetClientRect(s_hwnd, &rc);
                    s_controller->put_Bounds(rc);
                    s_controller->put_IsVisible(TRUE);

                    navigateToApp();
                    return S_OK;
                });

            env->CreateCoreWebView2Controller(s_hwnd, ctrlDone);
            ctrlDone->Release();
            return S_OK;
        });

    ::CreateCoreWebView2EnvironmentWithOptions(nullptr, userData.c_str(), nullptr, envDone);
    envDone->Release();
}

// ------------------------------------------------------------- window ------

LRESULT CALLBACK panelProc(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp)
{
    switch (msg)
    {
    case WM_SIZE:
        if (s_controller)
        {
            RECT rc = {};
            ::GetClientRect(hwnd, &rc);
            s_controller->put_Bounds(rc);
        }
        return 0;

    case WM_SETFOCUS:
        if (s_controller)
            s_controller->MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC);
        return 0;

    case WM_TIMER:
        if (wp == kTimerDoc)
        {
            ::KillTimer(hwnd, kTimerDoc);
            pushDocument();
            return 0;
        }
        if (wp == kTimerScroll)
        {
            ::KillTimer(hwnd, kTimerScroll);
            pushViewport();
            return 0;
        }
        if (wp == kTimerDock)
        {
            ::KillTimer(hwnd, kTimerDock);
            if (s_visible)
                Dock::applyWidth(s_hwnd, g_cfg.widthPercent);
            return 0;
        }
        break;

    case WM_NOTIFY:
    {
        auto* nmhdr = reinterpret_cast<LPNMHDR>(lp);
        if (nmhdr && nmhdr->code == DMN_CLOSE)
        {
            s_visible = false;
            s_perBuffer[currentBufferId()] = false;
            ::SendMessage(g_npp._nppHandle, NPPM_SETMENUITEMCHECK,
                          static_cast<WPARAM>(s_dockCmdId), FALSE);
            return TRUE;
        }
        if (nmhdr && (nmhdr->code == DMN_DOCK || nmhdr->code == DMN_FLOAT))
        {
            // Docked to a different edge, or undocked. Re-apply on the next tick.
            ::SetTimer(hwnd, kTimerDock, 80, nullptr);
        }
        break;
    }

    case WM_ERASEBKGND:
        return 1;

    default:
        break;
    }

    return ::DefWindowProc(hwnd, msg, wp, lp);
}

void ensureCreated()
{
    if (s_hwnd)
        return;

    s_hwnd = ::CreateWindowExW(
        0, kClassName, MDPEEK_NAME,
        WS_CHILD | WS_CLIPCHILDREN | WS_CLIPSIBLINGS,
        0, 0, 480, 600,
        g_npp._nppHandle, nullptr, g_hInst, nullptr);

    if (!s_hwnd)
        return;

    createWebView();

    if (!s_registered)
    {
        static std::wstring title = MDPEEK_NAME;
        static std::wstring module = MDPEEK_MODULE;

        tTbData data = {};
        data.hClient       = s_hwnd;
        data.pszName       = title.c_str();
        data.dlgID         = s_dockIndex;
        data.uMask         = DWS_DF_CONT_RIGHT;
        data.pszModuleName = module.c_str();

        ::SendMessage(g_npp._nppHandle, NPPM_DMMREGASDCKDLG, 0, reinterpret_cast<LPARAM>(&data));
        s_registered = true;
    }
}

} // namespace

// ---------------------------------------------------------- public API -----

void Panel::init()
{
    WNDCLASSEXW wc = {};
    wc.cbSize        = sizeof(wc);
    wc.style         = CS_HREDRAW | CS_VREDRAW;
    wc.lpfnWndProc   = panelProc;
    wc.hInstance     = g_hInst;
    wc.hCursor       = ::LoadCursor(nullptr, IDC_ARROW);
    wc.hbrBackground = reinterpret_cast<HBRUSH>(COLOR_WINDOW + 1);
    wc.lpszClassName = kClassName;
    ::RegisterClassExW(&wc);
}

void Panel::shutdown()
{
    Dock::stopWatching();
    Theme::shutdown();

    if (s_controller)
    {
        s_controller->Close();
        s_controller.Reset();
    }
    s_web.Reset();
    s_webReady = false;

    if (s_hwnd)
    {
        ::DestroyWindow(s_hwnd);
        s_hwnd = nullptr;
    }
}

bool Panel::isVisible()
{
    return s_visible;
}

void Panel::setDockIds(int funcIndex, int cmdId)
{
    s_dockIndex = funcIndex;
    s_dockCmdId = cmdId;
}

void Panel::setVisible(bool on, bool remember)
{
    if (on)
    {
        ensureCreated();
        if (!s_hwnd)
            return;

        ::SendMessage(g_npp._nppHandle, NPPM_DMMSHOW, 0, reinterpret_cast<LPARAM>(s_hwnd));
        ::SendMessage(g_npp._nppHandle, NPPM_SETMENUITEMCHECK,
                      static_cast<WPARAM>(s_dockCmdId), TRUE);
        s_visible = true;

        // Hold the panel at its share of the window, now and on every resize.
        Dock::startWatching(s_hwnd, kTimerDock);
        ::SetTimer(s_hwnd, kTimerDock, 60, nullptr);

        if (s_webReady)
            pushEverything();
    }
    else
    {
        if (!s_hwnd)
            return;
        ::SendMessage(g_npp._nppHandle, NPPM_DMMHIDE, 0, reinterpret_cast<LPARAM>(s_hwnd));
        ::SendMessage(g_npp._nppHandle, NPPM_SETMENUITEMCHECK,
                      static_cast<WPARAM>(s_dockCmdId), FALSE);
        s_visible = false;
    }

    if (remember)
        s_perBuffer[currentBufferId()] = on;
}

void Panel::show()   { setVisible(true, true); }
void Panel::hide()   { setVisible(false, true); }
void Panel::toggle() { setVisible(!s_visible, true); }

void Panel::onBufferActivated(uintptr_t bufferId)
{
    const std::wstring path = currentFilePath();

    auto it = s_perBuffer.find(bufferId);
    const bool wanted = (it != s_perBuffer.end())
        ? it->second                                        // this tab's own choice
        : (g_cfg.autoOpen && g_cfg.matchesExtension(path));  // otherwise the default

    if (wanted != s_visible)
        setVisible(wanted, false);

    if (!s_visible || !s_webReady)
        return;

    computeBaseline();
    pushBaseline();
    pushDocument();
}

void Panel::forgetBuffer(uintptr_t bufferId)
{
    s_perBuffer.erase(bufferId);
}

void Panel::onTextModified()
{
    if (!s_visible || !s_hwnd)
        return;
    ::SetTimer(s_hwnd, kTimerDoc, kDocDelayMs, nullptr);
}

void Panel::onZoomChanged()
{
    if (!s_visible)
        return;
    ::pushZoom();
}

void Panel::onViewportChanged()
{
    if (!s_visible || !s_hwnd)
    {
        dbg("onViewportChanged ignored (visible=%d hwnd=%d)", s_visible ? 1 : 0, s_hwnd ? 1 : 0);
        return;
    }
    ::SetTimer(s_hwnd, kTimerScroll, kScrollDelayMs, nullptr);
}

void Panel::onFileSaved()
{
    if (!s_visible)
        return;
    computeBaseline();
    pushBaseline();
    pushDocument();
}

void Panel::onDarkModeChanged()
{
    pushTheme();
    pushDocument();
}

// The user changed styles in the Style Configurator, so every colour the panel
// is holding is now stale.
void Panel::onStylesUpdated()
{
    pushTheme();
    computeBaseline();
    pushBaseline();
    pushDocument();
}

void Panel::pushMode()
{
    ::pushMode();
    computeBaseline();
    pushBaseline();
    pushDocument();
}

void Panel::refreshBaseline()
{
    computeBaseline();
    pushBaseline();
}

void Panel::reloadAssets()
{
    seedAssets(false);
    if (s_web)
    {
        s_webReady = false;
        s_web->Reload();
    }
}
