# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Ali Yaakub
<#
.SYNOPSIS
    Builds Markdown Peek, a Notepad++ plugin, and optionally installs it.

.DESCRIPTION
    Compiles the native shell with the MSVC toolset found by vswhere, stages the
    DLL next to its editable assets under dist\MarkdownPeek, and can copy that
    folder straight into the Notepad++ plugins directory.

.PARAMETER Arch
    Target architecture: x64 (default), x86 or arm64. Each lands in its own
    dist\<arch>\MarkdownPeek folder, so the three can coexist.

.PARAMETER Install
    Copy the staged plugin into the Notepad++ plugins folder. Needs an elevated
    shell when Notepad++ lives under Program Files.

.PARAMETER Clean
    Delete intermediate objects and the staged output before building.

.PARAMETER Package
    Also produce the release zip and print its SHA-256. The archive is shaped
    the way Plugins Admin requires - the DLL at the root, everything else
    beside it - and the hash is the "id" field of a plugin-list entry.
#>
[CmdletBinding()]
param(
    [ValidateSet('x64', 'x86', 'arm64')]
    [string]$Arch = 'x64',
    [switch]$Install,
    [switch]$Clean,
    [switch]$Package
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$src  = Join-Path $root 'src'
$obj  = Join-Path $root "build\obj\$Arch"
$dist = Join-Path $root "dist\$Arch\MarkdownPeek"

# ------------------------------------------------------------- toolchain ----

$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
if (-not (Test-Path $vswhere)) { throw "vswhere.exe not found. Install Visual Studio Build Tools." }

$vsPath = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 `
                     -property installationPath 2>$null
if (-not $vsPath) { $vsPath = & $vswhere -latest -products * -property installationPath }
if (-not $vsPath) { throw "No Visual Studio installation with a C++ toolset was found." }

# Cross-compiling from an x64 host. x86 needs no extra Visual Studio component;
# arm64 needs "MSVC v143 - VS 2022 C++ ARM64 build tools", which is not installed
# by default and is the usual reason this line fails.
$vcvarsName = @{ 'x64' = 'vcvars64.bat'; 'x86' = 'vcvarsamd64_x86.bat'; 'arm64' = 'vcvarsamd64_arm64.bat' }[$Arch]
$vcvars = Join-Path $vsPath "VC\Auxiliary\Build\$vcvarsName"
if (-not (Test-Path $vcvars))
{
    throw "$vcvarsName not found under $vsPath. The $Arch build tools are not installed."
}

# The WebView2 static loader is per-architecture, and comes from the SDK's NuGet
# package under build\native\<arch>\. Only what a build needs is vendored.
$webview2Lib = Join-Path $root "third_party\webview2\lib\$Arch\WebView2LoaderStatic.lib"
if (-not (Test-Path $webview2Lib))
{
    throw ("WebView2LoaderStatic.lib for $Arch is missing. Take it from the " +
           "Microsoft.Web.WebView2 NuGet package, build\native\$Arch\, and put it at $webview2Lib")
}

Write-Host "Toolchain : $vsPath" -ForegroundColor DarkGray
Write-Host "Target    : $Arch" -ForegroundColor DarkGray

# ----------------------------------------------------------------- clean ----

if ($Clean) {
    foreach ($p in @($obj, (Join-Path $root "dist\$Arch"))) {
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

$machine = @{ 'x64' = 'X64'; 'x86' = 'X86'; 'arm64' = 'ARM64' }[$Arch]

# Plugins Admin and the plugin-list validator both identify a build by its
# FileVersion resource, and reject a DLL that carries none. This is the only
# resource the plugin has; the toolbar icon is drawn at startup instead.
$rc = @(
    '/nologo', "/I`"$src`"", "/fo`"$obj\Version.res`"", "`"$src\Version.rc`""
)

$link = @(
    '/nologo', '/DLL', "/MACHINE:$machine", '/OPT:REF', '/OPT:ICF', '/DYNAMICBASE', '/NXCOMPAT',
    "/DEF:`"$src\MarkdownPeek.def`"",
    "/OUT:`"$dist\MarkdownPeek.dll`"",
    "/IMPLIB:`"$obj\MarkdownPeek.lib`"",
    "`"$obj\*.obj`"",
    "`"$obj\Version.res`"",
    "`"$webview2Lib`"",
    'kernel32.lib', 'user32.lib', 'shell32.lib', 'ole32.lib', 'oleaut32.lib',
    'advapi32.lib', 'version.lib', 'shlwapi.lib', 'comctl32.lib', 'gdi32.lib'
)

$batch = @"
@echo off
call "$vcvars" >nul
if errorlevel 1 exit /b 1
rc $($rc -join ' ')
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
$ver = (Get-Item $dll).VersionInfo.FileVersion
Write-Host "Built     : $dll  ($kib KiB, version $ver)" -ForegroundColor Green
Write-Host "Assets    : $assetsOut  (stamp $stamp)" -ForegroundColor Green

# --------------------------------------------------------------- package ----

if ($Package) {
    # The DLL has to sit at the root of the archive or Plugins Admin will not
    # find it: the validator matches the whole entry name against
    # "<folder-name>.dll", so a wrapping folder fails. Everything else may live
    # in a subfolder, which is where the assets go. "doc" is the one reserved
    # name, extracted to plugins\doc\<folder-name>\ instead.
    $zip = Join-Path $root "dist\MarkdownPeek-$ver-$Arch.zip"
    if (Test-Path $zip) { Remove-Item $zip -Force }
    Compress-Archive -Path (Join-Path $dist '*') -DestinationPath $zip

    $sha = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
    $kb  = [math]::Round((Get-Item $zip).Length / 1KB)

    Write-Host "Package   : $zip  ($kb KiB)" -ForegroundColor Green
    Write-Host "SHA-256   : $sha" -ForegroundColor Green
    Write-Host ""
    Write-Host "Plugin-list entry for pl.$(if ($Arch -eq 'x86') { 'x86' } elseif ($Arch -eq 'arm64') { 'arm64' } else { 'x64' }).json:" -ForegroundColor DarkGray
    Write-Host @"
    {
      "folder-name": "MarkdownPeek",
      "display-name": "Markdown Peek",
      "version": "$ver",
      "id": "$sha",
      "repository": "<URL of this zip, attached to a GitHub release>",
      "description": "Docked Markdown preview with two-way scroll sync, and an inline unified diff of the source against the last save or git HEAD. Colours are read from the live Notepad++ style table.",
      "author": "Ali Yaakub",
      "homepage": "https://github.com/ali-yaakub/markdown-peek"
    }
"@ -ForegroundColor DarkGray
}

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
