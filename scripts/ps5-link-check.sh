#!/usr/bin/env bash
# ProsperoKit - drive the vendored kit over a ProsperoKit runtime archive and
# produce the PS5 title folder + ZIP (eboot.bin included). The `prosperokit build`
# CLI calls this; it is also the link-bring-up tool: a failing link lists the
# undefined symbols that csrc/shims.c must provide.
#
#   scripts/ps5-link-check.sh <libprosperokit_runtime.a> <out-dir>
#       [--param <param.json>] [--icon <icon0.png>] [--assets <dir>]
#
# Output: <out-dir>/<TITLE_ID>/ and <out-dir>/<TITLE_ID>.zip
#
# Environment:
#   PS5_PAYLOAD_SDK  ps5-payload-sdk v0.42 install dir (required)
#   PS5_CLANG        a Clang 18 executable (default: clang-18 on PATH, else Homebrew llvm@18)
#   PK_KIT_WORK      kit work directory, no spaces (default: <repo>/.prosperokit/kit-work)
#   USE_CCACHE       0/1 (default: 1 when ccache is installed)
#   PK_CSRC          directory with the C sources the kit compiles (default: crates/pk-runtime/csrc)
# Defaults when the options are omitted: a generated param.json (titleId PPSA90000,
# conceptId 90000), a generated 512x512 icon0.png and an assets/readme.txt.
# Needs: bash >= 4, python3, make, ninja, wget, Clang 18 + lld 18 (the kit's own requirements).
# SPDX-License-Identifier: GPL-3.0-or-later
set -euo pipefail

usage() {
    echo "usage: scripts/ps5-link-check.sh <archive.a> <out-dir> [--param <param.json>] [--icon <png>] [--assets <dir>]" >&2
    exit 2
}

[[ $# -ge 2 ]] || usage
archive=$1
out_dir=$2
shift 2
param_src=
icon_src=
assets_src=
while [[ $# -gt 0 ]]; do
    case $1 in
        --param) param_src=${2:?}; shift 2 ;;
        --icon) icon_src=${2:?}; shift 2 ;;
        --assets) assets_src=${2:?}; shift 2 ;;
        *) usage ;;
    esac
done

root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
: "${PS5_PAYLOAD_SDK:?PS5_PAYLOAD_SDK is not set (ps5-payload-sdk v0.42)}"
[[ -x $PS5_PAYLOAD_SDK/bin/prospero-lld ]] || { echo "PS5_PAYLOAD_SDK=$PS5_PAYLOAD_SDK is not a ps5-payload-sdk install" >&2; exit 2; }
[[ -f $archive ]] || { echo "archive not found: $archive" >&2; exit 2; }
archive=$(cd -- "$(dirname -- "$archive")" && pwd)/$(basename -- "$archive")
mkdir -p "$out_dir"
out_dir=$(cd -- "$out_dir" && pwd)

# The kit needs bash >= 4 (mapfile) and Clang 18; on macOS take Homebrew's.
for prefix in /opt/homebrew /usr/local; do
    if [[ -d $prefix/bin ]]; then PATH=$prefix/bin:$PATH; fi
done
if [[ -z ${PS5_CLANG:-} ]]; then
    PS5_CLANG=$(command -v clang-18 || true)
    for prefix in /opt/homebrew /usr/local; do
        if [[ -z $PS5_CLANG && -x $prefix/opt/llvm@18/bin/clang ]]; then PS5_CLANG=$prefix/opt/llvm@18/bin/clang; fi
    done
fi
[[ -n $PS5_CLANG ]] || { echo "clang-18 not found; set PS5_CLANG" >&2; exit 2; }
for prefix in /opt/homebrew /usr/local; do
    if [[ -d $prefix/opt/llvm@18/bin ]]; then PATH=$prefix/opt/llvm@18/bin:$PATH; fi
done
export PATH PS5_CLANG PS5_PAYLOAD_SDK
make_shell=$(command -v bash)
"$make_shell" -c '(( BASH_VERSINFO[0] >= 4 ))' || { echo "bash >= 4 is required ($make_shell is too old); install Homebrew bash" >&2; exit 2; }

work=${PK_KIT_WORK:-$root/.prosperokit/kit-work}
[[ $work != *" "* ]] || { echo "the kit refuses spaces in paths: set PK_KIT_WORK ($work)" >&2; exit 2; }
csrc=${PK_CSRC:-$root/crates/pk-runtime/csrc}
[[ -f $csrc/main.c && -f $csrc/shims.c ]] || { echo "main.c/shims.c not found in $csrc" >&2; exit 2; }

# 1. The kit, copied to the work folder whenever kit/ changed (what the kit
#    downloads on its first build, in .deps, is kept).
if command -v sha256sum >/dev/null; then sha=(sha256sum); else sha=(shasum -a 256); fi
stamp=$(cd "$root/kit" && find . -type f -not -path './.deps/*' -not -path './dist/*' -not -path './build/*' -print0 | sort -z | xargs -0 "${sha[@]}" | "${sha[@]}" | cut -c1-16)
if [[ ! -f $work/.kit-stamp || $(cat "$work/.kit-stamp") != "$stamp" ]]; then
    echo "==> preparing the kit in $work"
    mkdir -p "$work"
    find "$work" -mindepth 1 -maxdepth 1 ! -name .deps -exec rm -rf {} +
    (cd "$root/kit" && tar --exclude=./.deps --exclude=./dist --exclude=./build -cf - .) | tar -xf - -C "$work"
    echo "$stamp" > "$work/.kit-stamp"
fi
# The kit uses the SDK we were given instead of downloading its own copy.
kit_sdk=$work/.deps/native/ps5-payload-sdk
if [[ -L $kit_sdk && ! -e $kit_sdk ]] || [[ -L $kit_sdk && $(readlink "$kit_sdk") != "$PS5_PAYLOAD_SDK" ]]; then
    rm -f "$kit_sdk"
fi
if [[ ! -e $kit_sdk ]]; then
    mkdir -p "$work/.deps/native"
    ln -s "$PS5_PAYLOAD_SDK" "$kit_sdk"
fi
rm -rf "$work/dist"

# 2. The app: sources, archive, metadata, presentation assets, app files.
rm -rf "$work/app"
mkdir -p "$work/app/src" "$work/app/lib" "$work/app/sce_sys" "$work/app/assets" "$work/app/stubs"
cp "$csrc"/*.c "$work/app/src/"
cp "$archive" "$work/app/lib/libprosperokit_runtime.a"

if [[ -n $param_src ]]; then
    cp "$param_src" "$work/app/sce_sys/param.json"
else
    python3 - "$work/app/sce_sys/param.json" <<'PY'
import json, sys

param = {
    "ageLevel": {"default": 0},
    "applicationCategoryType": 0,
    "applicationDrmType": "free",
    "attribute": 1644167168,
    "attribute2": 0,
    "attribute3": 1048576,
    "conceptId": "90000",
    "contentBadgeType": 1,
    "contentId": "UP9000-PPSA90000_00-PROSPEROKIT00000",
    "contentVersion": "01.000.000",
    "downloadDataSize": 256,
    "gameIntent": {"permittedIntents": [{"intentType": "launchActivity"}]},
    "localizedParameters": {"defaultLanguage": "en-US", "en-US": {"titleName": "ProsperoKit"}},
    "masterVersion": "01.00",
    "pubtools": {"creationDate": "2026-10-22 00:00:00", "loudnessSnd0": "-28.00", "toolVersion": "2.00"},
    "requiredSystemSoftwareVersion": "0x0000000000000000",
    "sdkVersion": "0x0000000000000000",
    "titleId": "PPSA90000",
    "versionFileUri": "",
}
with open(sys.argv[1], "w", encoding="utf-8") as out:
    json.dump(param, out, indent=2)
    out.write("\n")
PY
fi

if [[ -n $icon_src ]]; then
    cp "$icon_src" "$work/app/sce_sys/icon0.png"
else
    python3 - "$work/app/sce_sys/icon0.png" <<'PY'
import struct, sys, zlib

size = 512
rows = bytearray()
for y in range(size):
    rows.append(0)
    for x in range(size):
        rows += bytes((24 + 120 * x // size, 32 + 90 * y // size, 96 + 100 * (x + y) // (2 * size), 255))

def chunk(kind, data):
    body = kind + data
    return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body))

png = b"\x89PNG\r\n\x1a\n"
png += chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
png += chunk(b"IDAT", zlib.compress(bytes(rows), 9))
png += chunk(b"IEND", b"")
with open(sys.argv[1], "wb") as out:
    out.write(png)
PY
fi

if [[ -n $assets_src ]]; then
    cp -R "$assets_src/." "$work/app/assets/"
else
    echo "ProsperoKit link check: packaged at /app0/assets/readme.txt" > "$work/app/assets/readme.txt"
fi

# 3. The CommonDialog link-only stub: the SDK has none for
#    sceCommonDialogInitialize, which the system keyboard needs. The kit reads
#    the .so to learn that the symbol lives in libSceCommonDialog.sprx; the
#    console binds the real one when the app starts.
cat > "$work/app/stubs/common_dialog.c" <<'C'
int sceCommonDialogInitialize(void)
{
    return 0;
}
C
sh "$work/tooling/prospero-clang18" -O2 -Wall -Wextra -fPIC -c "$work/app/stubs/common_dialog.c" -o "$work/app/stubs/common_dialog.o"
"$PS5_PAYLOAD_SDK/bin/prospero-lld" --shared -soname libSceCommonDialog.sprx \
    -o "$work/app/stubs/libSceCommonDialog.so" "$work/app/stubs/common_dialog.o"

# 4. Build. A link failure prints the undefined symbols.
echo "==> building the title with the kit"
ccache=1
command -v ccache >/dev/null || ccache=0
make -C "$work" SHELL="$make_shell" USE_CCACHE="${USE_CCACHE:-$ccache}" \
    APP_SOURCE_DIR=app/src APP_PARAM=app/sce_sys/param.json APP_SCE_SYS=app/sce_sys \
    APP_ASSETS=app/assets APP_STATIC_ARCHIVES=app/lib/libprosperokit_runtime.a \
    APP_IMPORT_STUBS=app/stubs/libSceCommonDialog.so

# 5. The result.
title=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["titleId"])' "$work/app/sce_sys/param.json")
[[ -f $work/dist/$title/eboot.bin && -f $work/dist/$title.zip ]] || { echo "the kit did not produce $title/eboot.bin and $title.zip" >&2; exit 1; }
rm -rf "$out_dir/$title" "$out_dir/$title.zip"
cp -R "$work/dist/$title" "$out_dir/$title"
cp "$work/dist/$title.zip" "$out_dir/$title.zip"
echo "==> $out_dir/$title"
echo "==> $out_dir/$title.zip"
