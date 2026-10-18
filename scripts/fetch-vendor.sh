#!/bin/bash
# Linux and Windows: the C libraries the engine needs where Apple's frameworks aren't there, at pinned versions, laid out
# in Vendor/ (out of git) as Package.swift expects: SQLite with FTS5 (storage), stb (images), miniz (docx/odt), nanosvg
# (SVG pictures), PDFium (PDF text and page renders; prebuilt by bblanchon/pdfium-binaries). macOS needs none of this. Does nothing when the
# pinned set is already there. Needs curl, tar and python3 (to unzip); on Windows, Git for Windows' bash.
set -euo pipefail
cd "$(dirname "$0")/.."
SQLITE_ZIP=2026/sqlite-amalgamation-3540000.zip       # SQLite 3.54.0
STB_COMMIT=2c980bb59875b0d32144a71867fbdebb2f77cd20   # nothings/stb, 2026-08-02
MINIZ_VERSION=3.1.2
NANOSVG_COMMIT=239e102ec2c691f2902e20ace2ed36ee4a35cfe6   # memononen/nanosvg, 2026-07-09
PDFIUM_TAG=chromium/8086
STAMP="sqlite $SQLITE_ZIP stb $STB_COMMIT miniz $MINIZ_VERSION nanosvg $NANOSVG_COMMIT pdfium $PDFIUM_TAG, with licenses"
if [[ "$(cat Vendor/VENDOR 2>/dev/null)" == "$STAMP" ]]; then exit 0; fi

case "$(uname -s)-$(uname -m)" in
  Linux-x86_64) PDFIUM=pdfium-linux-x64 ;;
  Linux-aarch64) PDFIUM=pdfium-linux-arm64 ;;
  Darwin-arm64) PDFIUM=pdfium-mac-arm64 ;;
  MINGW*|MSYS*|CYGWIN*) PDFIUM=pdfium-win-x64 ;;
  *) echo "no PDFium build known for $(uname -s)-$(uname -m)"; exit 1 ;;
esac
T=Vendor/fetch-tmp
rm -rf "$T" && mkdir -p "$T"
# On Windows "python3" can be the Microsoft Store's stub, which only opens the Store.
PYTHON=python3
python3 -c 'import zipfile' 2>/dev/null || PYTHON=python
unzip_py() { "$PYTHON" -c 'import sys, zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])' "$1" "$2"; }

echo "SQLite ($SQLITE_ZIP)"
curl -sSL -o "$T/sqlite.zip" "https://sqlite.org/$SQLITE_ZIP"
unzip_py "$T/sqlite.zip" "$T/sqlite"
rm -rf Vendor/sqlite && mkdir -p Vendor/sqlite/include
cp "$T"/sqlite/*/sqlite3.c Vendor/sqlite/ && cp "$T"/sqlite/*/sqlite3.h Vendor/sqlite/include/

echo "stb ($STB_COMMIT)"
rm -rf Vendor/stb && mkdir -p Vendor/stb/include
for h in stb_image.h stb_image_write.h stb_image_resize2.h; do
  curl -sSL -o "Vendor/stb/include/$h" "https://raw.githubusercontent.com/nothings/stb/$STB_COMMIT/$h"
done
cat > Vendor/stb/stb.c <<'C'
// The stb implementations, once (the headers alone are declarations). Written by scripts/fetch-vendor.sh.
#define STB_IMAGE_IMPLEMENTATION
#define STB_IMAGE_WRITE_IMPLEMENTATION
#define STB_IMAGE_RESIZE_IMPLEMENTATION
#include "stb_image.h"
#include "stb_image_write.h"
#include "stb_image_resize2.h"
C

echo "miniz ($MINIZ_VERSION)"
curl -sSL -o "$T/miniz.zip" "https://github.com/richgel999/miniz/releases/download/$MINIZ_VERSION/miniz-$MINIZ_VERSION.zip"
unzip_py "$T/miniz.zip" "$T/miniz"
rm -rf Vendor/miniz && mkdir -p Vendor/miniz/include
cp "$T"/miniz/miniz.c Vendor/miniz/ && cp "$T"/miniz/*.h Vendor/miniz/include/ && cp "$T"/miniz/LICENSE Vendor/miniz/

echo "nanosvg ($NANOSVG_COMMIT)"
rm -rf Vendor/nanosvg && mkdir -p Vendor/nanosvg/include
for f in src/nanosvg.h src/nanosvgrast.h LICENSE.txt; do
  curl -sSL -o "Vendor/nanosvg/$(basename "$f")" "https://raw.githubusercontent.com/memononen/nanosvg/$NANOSVG_COMMIT/$f"
done
cat > Vendor/nanosvg/include/CNanoSVG.h <<'C'
// nanosvg's parser and rasterizer, as one module (the rasterizer's header needs the parser's). Written by
// scripts/fetch-vendor.sh.
#include <stdio.h>
#include "../nanosvg.h"
#include "../nanosvgrast.h"
C
cat > Vendor/nanosvg/nanosvg.c <<'C'
// The nanosvg implementations, once. Written by scripts/fetch-vendor.sh.
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#define NANOSVG_IMPLEMENTATION
#define NANOSVGRAST_IMPLEMENTATION
#include "nanosvg.h"
#include "nanosvgrast.h"
C

echo "PDFium ($PDFIUM_TAG, $PDFIUM)"
curl -sSL -o "$T/pdfium.tgz" "https://github.com/bblanchon/pdfium-binaries/releases/download/${PDFIUM_TAG/\//%2F}/$PDFIUM.tgz"
rm -rf Vendor/pdfium && mkdir -p Vendor/pdfium && tar -xzf "$T/pdfium.tgz" -C Vendor/pdfium
# Windows: the DLL is in bin/, its import library is lib/pdfium.dll.lib; the module map links "pdfium".
if [[ -f Vendor/pdfium/lib/pdfium.dll.lib ]]; then cp Vendor/pdfium/lib/pdfium.dll.lib Vendor/pdfium/lib/pdfium.lib; fi
ls Vendor/pdfium/lib

rm -rf "$T"
echo "$STAMP" > Vendor/VENDOR
echo "Fetched into Vendor/: sqlite, stb, miniz, nanosvg, pdfium"
