// Markdown Peek - paths, strings, config, editor access, diff baselines.
#include "Common.h"
#include "Scintilla.h"

Config g_cfg;

// ---------------------------------------------------------------- paths ----

std::wstring pluginDllDir()
{
    wchar_t buf[MAX_PATH * 2] = {};
    GetModuleFileNameW(g_hInst, buf, MAX_PATH * 2);
    std::wstring p(buf);
    size_t slash = p.find_last_of(L'\\');
    return slash == std::wstring::npos ? std::wstring() : p.substr(0, slash);
}

std::wstring pluginConfigDir()
{
    wchar_t buf[MAX_PATH * 2] = {};
    ::SendMessage(g_npp._nppHandle, NPPM_GETPLUGINSCONFIGDIR, MAX_PATH * 2, reinterpret_cast<LPARAM>(buf));
    std::wstring dir = std::wstring(buf) + L"\\MarkdownPeek";
    ::CreateDirectoryW(dir.c_str(), nullptr);
    return dir;
}

std::wstring assetsDir()
{
    std::wstring dir = pluginConfigDir() + L"\\assets";
    ::CreateDirectoryW(dir.c_str(), nullptr);
    return dir;
}

static void copyTree(const std::wstring& from, const std::wstring& to, bool overwrite)
{
    ::CreateDirectoryW(to.c_str(), nullptr);

    WIN32_FIND_DATAW fd{};
    HANDLE h = ::FindFirstFileW((from + L"\\*").c_str(), &fd);
    if (h == INVALID_HANDLE_VALUE)
        return;

    do
    {
        std::wstring name = fd.cFileName;
        if (name == L"." || name == L"..")
            continue;

        std::wstring src = from + L"\\" + name;
        std::wstring dst = to + L"\\" + name;

        if (fd.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY)
        {
            copyTree(src, dst, overwrite);
        }
        else
        {
            // Keep whatever is being replaced, so an edited asset is recoverable.
            if (overwrite && ::GetFileAttributesW(dst.c_str()) != INVALID_FILE_ATTRIBUTES)
                ::CopyFileW(dst.c_str(), (dst + L".bak").c_str(), FALSE);
            ::CopyFileW(src.c_str(), dst.c_str(), overwrite ? FALSE : TRUE);
        }
    }
    while (::FindNextFileW(h, &fd));

    ::FindClose(h);
}

// Assets ship next to the DLL and are copied into the user's config folder, which
// needs no administrator rights.
//
// Copying only the missing files was wrong: a plugin upgrade then left old
// scripts running against a new DLL, a mixture neither side was built for. The
// shipped assets carry a stamp of their own content, and when it moves the
// installed copy is replaced. Whatever is overwritten is kept beside it as a
// .bak, so a hand edit is recoverable rather than lost.
void seedAssets(bool overwrite)
{
    const std::wstring src = pluginDllDir() + L"\\assets";
    const std::wstring dst = assetsDir();

    std::string shipped;
    std::string installed;
    readFileAsUtf8(src + L"\\VERSION", shipped);
    readFileAsUtf8(dst + L"\\VERSION", installed);

    const bool upgrade = !shipped.empty() && shipped != installed;
    if (upgrade)
        dbg("assets: stamp moved from '%s' to '%s'; refreshing",
            installed.empty() ? "(none)" : installed.c_str(), shipped.c_str());

    copyTree(src, dst, overwrite || upgrade);
}

// -------------------------------------------------------------- strings ----

std::string wideToUtf8(const std::wstring& w)
{
    if (w.empty())
        return std::string();
    int n = ::WideCharToMultiByte(CP_UTF8, 0, w.c_str(), static_cast<int>(w.size()), nullptr, 0, nullptr, nullptr);
    std::string s(static_cast<size_t>(n), '\0');
    ::WideCharToMultiByte(CP_UTF8, 0, w.c_str(), static_cast<int>(w.size()), &s[0], n, nullptr, nullptr);
    return s;
}

std::wstring utf8ToWide(const std::string& s)
{
    if (s.empty())
        return std::wstring();
    int n = ::MultiByteToWideChar(CP_UTF8, 0, s.c_str(), static_cast<int>(s.size()), nullptr, 0);
    std::wstring w(static_cast<size_t>(n), L'\0');
    ::MultiByteToWideChar(CP_UTF8, 0, s.c_str(), static_cast<int>(s.size()), &w[0], n);
    return w;
}

std::string jsonEscape(const std::string& s)
{
    std::string o;
    o.reserve(s.size() + s.size() / 8 + 16);
    for (unsigned char c : s)
    {
        switch (c)
        {
        case '"':  o += "\\\""; break;
        case '\\': o += "\\\\"; break;
        case '\n': o += "\\n";  break;
        case '\r': o += "\\r";  break;
        case '\t': o += "\\t";  break;
        case '\b': o += "\\b";  break;
        case '\f': o += "\\f";  break;
        default:
            if (c < 0x20)
            {
                char tmp[8] = {};
                wsprintfA(tmp, "\\u%04x", static_cast<unsigned int>(c));
                o += tmp;
            }
            else
            {
                o += static_cast<char>(c);
            }
        }
    }
    return o;
}

std::wstring lowerExtOf(const std::wstring& path)
{
    size_t dot = path.find_last_of(L'.');
    size_t slash = path.find_last_of(L'\\');
    if (dot == std::wstring::npos || (slash != std::wstring::npos && dot < slash))
        return std::wstring();
    std::wstring ext = path.substr(dot + 1);
    for (size_t i = 0; i < ext.size(); ++i)
        ext[i] = static_cast<wchar_t>(::towlower(ext[i]));
    return ext;
}

// --------------------------------------------------------------- config ----

static std::wstring iniPath()
{
    return pluginConfigDir() + L"\\MarkdownPeek.ini";
}

void Config::load()
{
    const std::wstring ini = iniPath();
    autoOpen    = ::GetPrivateProfileIntW(L"MarkdownPeek", L"autoOpen",    1, ini.c_str()) != 0;
    diffMode    = ::GetPrivateProfileIntW(L"MarkdownPeek", L"diffMode",    0, ini.c_str()) != 0;
    syncCaret   = ::GetPrivateProfileIntW(L"MarkdownPeek", L"syncCaret",   0, ini.c_str()) != 0;
    baselineGit = ::GetPrivateProfileIntW(L"MarkdownPeek", L"baselineGit", 0, ini.c_str()) != 0;
    maxKiB      = ::GetPrivateProfileIntW(L"MarkdownPeek", L"maxKiB",   4096, ini.c_str());
    debugLog     = ::GetPrivateProfileIntW(L"MarkdownPeek", L"debugLog",       0, ini.c_str()) != 0;
    widthPercent = ::GetPrivateProfileIntW(L"MarkdownPeek", L"widthPercent", 50, ini.c_str());
    if (widthPercent < 0 || widthPercent > 95)
        widthPercent = 50;

    wchar_t buf[1024] = {};
    ::GetPrivateProfileStringW(L"MarkdownPeek", L"extensions",
        L"md;markdown;mdown;mkd;mkdn;mdwn;mdtxt;mdtext;rmd;qmd", buf, 1024, ini.c_str());
    extensions = buf;
}

void Config::save() const
{
    const std::wstring ini = iniPath();
    ::WritePrivateProfileStringW(L"MarkdownPeek", L"autoOpen",    autoOpen    ? L"1" : L"0", ini.c_str());
    ::WritePrivateProfileStringW(L"MarkdownPeek", L"diffMode",    diffMode    ? L"1" : L"0", ini.c_str());
    ::WritePrivateProfileStringW(L"MarkdownPeek", L"syncCaret",   syncCaret   ? L"1" : L"0", ini.c_str());
    ::WritePrivateProfileStringW(L"MarkdownPeek", L"baselineGit", baselineGit ? L"1" : L"0", ini.c_str());
    ::WritePrivateProfileStringW(L"MarkdownPeek", L"maxKiB",      std::to_wstring(maxKiB).c_str(), ini.c_str());
    ::WritePrivateProfileStringW(L"MarkdownPeek", L"widthPercent", std::to_wstring(widthPercent).c_str(), ini.c_str());
    ::WritePrivateProfileStringW(L"MarkdownPeek", L"debugLog",     debugLog ? L"1" : L"0", ini.c_str());
    ::WritePrivateProfileStringW(L"MarkdownPeek", L"extensions",  extensions.c_str(), ini.c_str());
}

bool Config::matchesExtension(const std::wstring& path) const
{
    const std::wstring ext = lowerExtOf(path);
    if (ext.empty())
        return false;

    std::wstring list = extensions;
    for (size_t i = 0; i < list.size(); ++i)
        list[i] = static_cast<wchar_t>(::towlower(list[i]));

    size_t pos = 0;
    while (pos <= list.size())
    {
        size_t sep = list.find(L';', pos);
        if (sep == std::wstring::npos)
            sep = list.size();
        if (sep > pos && list.compare(pos, sep - pos, ext) == 0)
            return true;
        pos = sep + 1;
    }
    return false;
}

// ---------------------------------------------------------------- debug ----

void dbg(const char* fmt, ...)
{
    if (!g_cfg.debugLog)
        return;

    char line[1024] = {};
    va_list args;
    va_start(args, fmt);
    ::wvsprintfA(line, fmt, args);
    va_end(args);

    SYSTEMTIME t = {};
    ::GetLocalTime(&t);
    char stamp[32] = {};
    ::wsprintfA(stamp, "%02d:%02d:%02d.%03d  ", t.wHour, t.wMinute, t.wSecond, t.wMilliseconds);

    const std::wstring path = pluginConfigDir() + L"\\debug.log";
    HANDLE h = ::CreateFileW(path.c_str(), FILE_APPEND_DATA, FILE_SHARE_READ,
                             nullptr, OPEN_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (h == INVALID_HANDLE_VALUE)
        return;

    DWORD wrote = 0;
    ::WriteFile(h, stamp, static_cast<DWORD>(::lstrlenA(stamp)), &wrote, nullptr);
    ::WriteFile(h, line, static_cast<DWORD>(::lstrlenA(line)), &wrote, nullptr);
    ::WriteFile(h, "\r\n", 2, &wrote, nullptr);
    ::CloseHandle(h);
}

// --------------------------------------------------------------- editor ----

HWND currentScintilla()
{
    int which = -1;
    ::SendMessage(g_npp._nppHandle, NPPM_GETCURRENTSCINTILLA, 0, reinterpret_cast<LPARAM>(&which));
    if (which == 0)
        return g_npp._scintillaMainHandle;
    if (which == 1)
        return g_npp._scintillaSecondHandle;
    return nullptr;
}

std::string editorTextUtf8(HWND sci)
{
    if (!sci)
        return std::string();

    const LRESULT len = ::SendMessage(sci, SCI_GETLENGTH, 0, 0);
    if (len <= 0)
        return std::string();

    std::string raw(static_cast<size_t>(len) + 1, '\0');
    ::SendMessage(sci, SCI_GETTEXT, static_cast<WPARAM>(len) + 1, reinterpret_cast<LPARAM>(&raw[0]));
    raw.resize(static_cast<size_t>(len));

    // Scintilla hands back the document's own bytes. Notepad++ keeps Unicode
    // buffers as UTF-8; an ANSI buffer reports its Windows code page instead.
    const UINT cp = static_cast<UINT>(::SendMessage(sci, SCI_GETCODEPAGE, 0, 0));
    if (cp == SC_CP_UTF8 || cp == 0)
        return raw;

    int n = ::MultiByteToWideChar(cp, 0, raw.c_str(), static_cast<int>(raw.size()), nullptr, 0);
    std::wstring w(static_cast<size_t>(n), L'\0');
    ::MultiByteToWideChar(cp, 0, raw.c_str(), static_cast<int>(raw.size()), &w[0], n);
    return wideToUtf8(w);
}

// SCI_GETFIRSTVISIBLELINE counts display lines, which drift from document lines
// as soon as anything is folded or word-wrapped. Convert before using it.
int firstVisibleDocLine(HWND sci)
{
    if (!sci)
        return 0;
    const LRESULT vis = ::SendMessage(sci, SCI_GETFIRSTVISIBLELINE, 0, 0);
    return static_cast<int>(::SendMessage(sci, SCI_DOCLINEFROMVISIBLE, static_cast<WPARAM>(vis), 0));
}

int caretLine(HWND sci)
{
    if (!sci)
        return 0;
    const LRESULT pos = ::SendMessage(sci, SCI_GETCURRENTPOS, 0, 0);
    return static_cast<int>(::SendMessage(sci, SCI_LINEFROMPOSITION, static_cast<WPARAM>(pos), 0));
}

int linesOnScreen(HWND sci)
{
    return sci ? static_cast<int>(::SendMessage(sci, SCI_LINESONSCREEN, 0, 0)) : 0;
}

int lineCount(HWND sci)
{
    return sci ? static_cast<int>(::SendMessage(sci, SCI_GETLINECOUNT, 0, 0)) : 0;
}

void scrollDocLineToTop(HWND sci, int line)
{
    if (!sci)
        return;
    ::SendMessage(sci, SCI_ENSUREVISIBLE, static_cast<WPARAM>(line), 0);
    const LRESULT vis = ::SendMessage(sci, SCI_VISIBLEFROMDOCLINE, static_cast<WPARAM>(line), 0);
    ::SendMessage(sci, SCI_SETFIRSTVISIBLELINE, static_cast<WPARAM>(vis), 0);
}

std::wstring currentFilePath()
{
    wchar_t buf[MAX_PATH * 2] = {};
    ::SendMessage(g_npp._nppHandle, NPPM_GETFULLCURRENTPATH, MAX_PATH * 2, reinterpret_cast<LPARAM>(buf));
    return buf;
}

bool currentBufferDirty()
{
    HWND sci = currentScintilla();
    return sci && ::SendMessage(sci, SCI_GETMODIFY, 0, 0) != 0;
}

// ------------------------------------------------------------- baseline ----

bool readFileAsUtf8(const std::wstring& path, std::string& out)
{
    out.clear();
    if (path.empty())
        return false;

    HANDLE h = ::CreateFileW(path.c_str(), GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE,
                             nullptr, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (h == INVALID_HANDLE_VALUE)
        return false;

    LARGE_INTEGER size = {};
    if (!::GetFileSizeEx(h, &size) || size.QuadPart > (64LL << 20))
    {
        ::CloseHandle(h);
        return false;
    }

    std::string raw(static_cast<size_t>(size.QuadPart), '\0');
    DWORD got = 0;
    const BOOL ok = raw.empty() ? TRUE
                                : ::ReadFile(h, &raw[0], static_cast<DWORD>(raw.size()), &got, nullptr);
    ::CloseHandle(h);
    if (!ok)
        return false;
    raw.resize(got);

    if (raw.size() >= 3 && static_cast<unsigned char>(raw[0]) == 0xEF
                        && static_cast<unsigned char>(raw[1]) == 0xBB
                        && static_cast<unsigned char>(raw[2]) == 0xBF)
    {
        out = raw.substr(3);
        return true;
    }
    if (raw.size() >= 2 && static_cast<unsigned char>(raw[0]) == 0xFF
                        && static_cast<unsigned char>(raw[1]) == 0xFE)
    {
        const std::wstring w(reinterpret_cast<const wchar_t*>(raw.data() + 2), (raw.size() - 2) / 2);
        out = wideToUtf8(w);
        return true;
    }

    out = raw;
    return true;
}

// Runs `git show HEAD:<path>` with stdout on a pipe. A missing git, a path outside
// a repository and a file not yet committed all land in the same place: no baseline.
bool gitShowHead(const std::wstring& path, std::string& out)
{
    out.clear();
    if (path.empty())
        return false;

    const size_t slash = path.find_last_of(L'\\');
    if (slash == std::wstring::npos)
        return false;
    const std::wstring dir = path.substr(0, slash);

    SECURITY_ATTRIBUTES sa = {};
    sa.nLength = sizeof(sa);
    sa.bInheritHandle = TRUE;

    HANDLE rd = nullptr;
    HANDLE wr = nullptr;
    if (!::CreatePipe(&rd, &wr, &sa, 1 << 20))
        return false;
    ::SetHandleInformation(rd, HANDLE_FLAG_INHERIT, 0);

    // `git show HEAD:./name` resolves the path against the working directory, which
    // saves computing the repository-root-relative path here.
    std::wstring cmd = L"git.exe show \"HEAD:./" + path.substr(slash + 1) + L"\"";

    STARTUPINFOW si = {};
    si.cb = sizeof(si);
    si.dwFlags = STARTF_USESTDHANDLES | STARTF_USESHOWWINDOW;
    si.wShowWindow = SW_HIDE;
    si.hStdOutput = wr;
    si.hStdError  = wr;
    si.hStdInput  = nullptr;

    PROCESS_INFORMATION pi = {};
    std::vector<wchar_t> mutableCmd(cmd.begin(), cmd.end());
    mutableCmd.push_back(L'\0');

    const BOOL started = ::CreateProcessW(nullptr, mutableCmd.data(), nullptr, nullptr, TRUE,
                                          CREATE_NO_WINDOW, nullptr, dir.c_str(), &si, &pi);
    ::CloseHandle(wr);
    if (!started)
    {
        ::CloseHandle(rd);
        return false;
    }

    std::string buf;
    char chunk[8192];
    DWORD got = 0;
    while (::ReadFile(rd, chunk, sizeof(chunk), &got, nullptr) && got > 0)
    {
        buf.append(chunk, got);
        if (buf.size() > (32u << 20))
            break;
    }
    ::CloseHandle(rd);

    ::WaitForSingleObject(pi.hProcess, 5000);
    DWORD code = 1;
    ::GetExitCodeProcess(pi.hProcess, &code);
    ::CloseHandle(pi.hProcess);
    ::CloseHandle(pi.hThread);

    if (code != 0)
        return false;

    out.swap(buf);
    return true;
}
