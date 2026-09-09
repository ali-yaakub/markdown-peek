<#
.SYNOPSIS
    Builds Markdown Peek, a Notepad++ plugin, and optionally installs it.

.DESCRIPTION
    Compiles the native shell with the MSVC toolset found by vswhere, stages the
    DLL next to its editable assets under dist\MarkdownPeek, and can copy that
    folder straight into the Notepad++ plugins directory.

.PARAMETER Install
    Copy the staged plugin into the Notepad++ plugins folder. Needs an elevated
    shell when Notepad++ lives under Program Files.

.PARAMETER Clean
    Delete intermediate objects and the staged output before building.
#>
[CmdletBinding()]
param(
    [switch]$Install,
    [switch]$Clean
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$src  = Join-Path $root 'src'
$obj  = Join-Path $root 'build\obj'
$dist = Join-Path $root 'dist\MarkdownPeek'

# ------------------------------------------------------------- toolchain ----

$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
if (-not (Test-Path $vswhere)) { throw "vswhere.exe not found. Install Visual Studio Build Tools." }

$vsPath = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 `
                     -property installationPath 2>$null
if (-not $vsPath) { $vsPath = & $vswhere -latest -products * -property installationPath }
if (-not $vsPath) { throw "No Visual Studio installation with a C++ toolset was found." }

$vcvars = Join-Path $vsPath 'VC\Auxiliary\Build\vcvars64.bat'
if (-not (Test-Path $vcvars)) { throw "vcvars64.bat not found under $vsPath" }

Write-Host "Toolchain : $vsPath" -ForegroundColor DarkGray

# ----------------------------------------------------------------- clean ----

if ($Clean) {
    foreach ($p in @($obj, (Join-Path $root 'dist'))) {
        if (Test-Path $p) { Remove-Item $p -Recurse -Force }
    }
    Write-Host "Cleaned." -ForegroundColor DarkGray
}

New-Item -ItemType Directory -Force -Path $obj  | Out-Null
New-Item -ItemType Directory -Force -Path $dist | Out-Null

# ----------------------------------------------------------------- build ----

$sources = @('Plugin.cpp', 'Util.cpp', 'Panel.cpp', 'Theme.cpp', 'Dock.cpp') | ForEach-Object { Join-Path $src $_ }

$cl = @(
    '/nologo', '/c', '/EHsc', '/W4', '/O2', '/MT', '/GS', '/std:c++17', '/permissive-',
    '/DUNICODE', '/D_UNICODE', '/DWIN32', '/DNDEBUG', '/D_WIN32_WINNT=0x0A00',
    "/I`"$root\include`"",
    "/I`"$root\third_party\webview2\include`"",
    "/Fo`"$obj\\`""
) + ($sources | ForEach-Object { "`"$_`"" })

$link = @(
    '/nologo', '/DLL', '/MACHINE:X64', '/OPT:REF', '/OPT:ICF', '/DYNAMICBASE', '/NXCOMPAT',
    "/DEF:`"$src\MarkdownPeek.def`"",
    "/OUT:`"$dist\MarkdownPeek.dll`"",
    "/IMPLIB:`"$obj\MarkdownPeek.lib`"",
    "`"$obj\*.obj`"",
    "`"$root\third_party\webview2\lib\x64\WebView2LoaderStatic.lib`"",
    'kernel32.lib', 'user32.lib', 'shell32.lib', 'ole32.lib', 'oleaut32.lib',
    'advapi32.lib', 'version.lib', 'shlwapi.lib', 'comctl32.lib', 'gdi32.lib'
)

$batch = @"
@echo off
call "$vcvars" >nul
if errorlevel 1 exit /b 1
cl $($cl -join ' ')
if errorlevel 1 exit /b 1
link $($link -join ' ')
if errorlevel 1 exit /b 1
"@

$batchFile = Join-Path $obj '_build.cmd'
Set-Content -Path $batchFile -Value $batch -Encoding ASCII

& cmd.exe /c "`"$batchFile`""
if ($LASTEXITCODE -ne 0) { throw "Build failed with exit code $LASTEXITCODE." }

# ----------------------------------------------------------------- stage ----

$assetsOut = Join-Path $dist 'assets'
if (Test-Path $assetsOut) { Remove-Item $assetsOut -Recurse -Force }
Copy-Item (Join-Path $root 'assets') $assetsOut -Recurse

# A stamp of the assets' own content. The plugin replaces an installed copy only
# when this moves, so rebuilding without touching the assets changes nothing on
# disk for the user.
$hashes = Get-ChildItem $assetsOut -Recurse -File |
          Sort-Object FullName |
          ForEach-Object { (Get-FileHash $_.FullName -Algorithm SHA256).Hash }
$stamp = (Get-FileHash -InputStream ([IO.MemoryStream]::new(
            [Text.Encoding]::UTF8.GetBytes(($hashes -join "`n")))) -Algorithm SHA256).Hash.Substring(0, 16)
Set-Content -Path (Join-Path $assetsOut 'VERSION') -Value $stamp -NoNewline -Encoding ASCII

$dll = Join-Path $dist 'MarkdownPeek.dll'
$kib = [math]::Round((Get-Item $dll).Length / 1KB)
Write-Host "Built     : $dll  ($kib KiB)" -ForegroundColor Green
Write-Host "Assets    : $assetsOut  (stamp $stamp)" -ForegroundColor Green

# --------------------------------------------------------------- install ----

if ($Install) {
    $nppRoot = (Get-ItemProperty -Path 'HKLM:\SOFTWARE\Notepad++' -ErrorAction SilentlyContinue).'(default)'
    if (-not $nppRoot) { $nppRoot = 'C:\Program Files\Notepad++' }

    $target = Join-Path $nppRoot 'plugins\MarkdownPeek'
    New-Item -ItemType Directory -Force -Path $target | Out-Null
    Copy-Item (Join-Path $dist '*') $target -Recurse -Force

    Write-Host "Installed : $target" -ForegroundColor Green
    Write-Host "Restart Notepad++ to load the plugin." -ForegroundColor Yellow
}
