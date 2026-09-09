// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ali Yaakub
//
// The one place the version is written down. It reaches the DLL through
// Version.rc, and Plugins Admin refuses a plugin whose JSON entry disagrees
// with the FileVersion resource, so nothing else may hold a second copy.
#pragma once

#define MDPEEK_VER_MAJOR 0
#define MDPEEK_VER_MINOR 1
#define MDPEEK_VER_PATCH 0
#define MDPEEK_VER_BUILD 0

#define MDPEEK_VER_STRING "0.1.0.0"
