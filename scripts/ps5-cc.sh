#!/bin/sh
# ProsperoKit - PS5 Clang wrapper for the Rust `cc` crate (QuickJS C sources).
# Mirrors kit/tooling/prospero-clang18: the PS5 target, the payload SDK
# sysroot and the proven code-generation flags. Reads:
#   PS5_PAYLOAD_SDK  install dir of ps5-payload-sdk v0.42 (required)
#   PS5_CLANG        a Clang 18 executable (default: clang-18 on PATH, else
#                    Homebrew's llvm@18 on macOS)
# SPDX-License-Identifier: GPL-3.0-or-later
if [ -z "${PS5_PAYLOAD_SDK:-}" ]; then
    echo "ps5-cc.sh: PS5_PAYLOAD_SDK is not set (run 'prosperokit doctor')" >&2
    exit 2
fi
compiler=${PS5_CLANG:-}
if [ -z "$compiler" ]; then
    compiler=$(command -v clang-18 || true)
fi
if [ -z "$compiler" ] && [ -x /opt/homebrew/opt/llvm@18/bin/clang ]; then
    compiler=/opt/homebrew/opt/llvm@18/bin/clang
fi
if [ -z "$compiler" ] && [ -x /usr/local/opt/llvm@18/bin/clang ]; then
    compiler=/usr/local/opt/llvm@18/bin/clang
fi
if [ -z "$compiler" ]; then
    echo "ps5-cc.sh: clang-18 was not found; set PS5_CLANG" >&2
    exit 2
fi
case "$(basename "$0")" in
    ps5-cxx.sh) lang_args="-x c++ -isystem $PS5_PAYLOAD_SDK/target/include/c++/v1 -fno-exceptions -fno-rtti" ;;
    *) lang_args="" ;;
esac
# shellcheck disable=SC2086
exec "$compiler" \
    -target x86_64-sie-ps5 \
    -fvisibility-nodllstorageclass=default \
    -isysroot "$PS5_PAYLOAD_SDK" \
    $lang_args \
    -isystem "$PS5_PAYLOAD_SDK/target/include" \
    -fno-stack-protector -fno-plt -femulated-tls \
    -D__PS5__=1 \
    "$@"
