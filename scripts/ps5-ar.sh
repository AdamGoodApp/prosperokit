#!/bin/sh
# ProsperoKit - archiver for PS5 objects produced by ps5-cc.sh (llvm-ar 18).
# SPDX-License-Identifier: GPL-3.0-or-later
ar=${PS5_AR:-}
if [ -z "$ar" ] && [ -n "${PS5_PAYLOAD_SDK:-}" ] && [ -x "$PS5_PAYLOAD_SDK/bin/prospero-ar" ] && command -v llvm-config-18 >/dev/null 2>&1; then
    ar="$PS5_PAYLOAD_SDK/bin/prospero-ar"
fi
if [ -z "$ar" ]; then
    ar=$(command -v llvm-ar-18 || true)
fi
if [ -z "$ar" ] && [ -x /opt/homebrew/opt/llvm@18/bin/llvm-ar ]; then
    ar=/opt/homebrew/opt/llvm@18/bin/llvm-ar
fi
if [ -z "$ar" ] && [ -x /usr/local/opt/llvm@18/bin/llvm-ar ]; then
    ar=/usr/local/opt/llvm@18/bin/llvm-ar
fi
if [ -z "$ar" ]; then
    ar=$(command -v llvm-ar || true)
fi
if [ -z "$ar" ]; then
    echo "ps5-ar.sh: llvm-ar was not found; set PS5_AR" >&2
    exit 2
fi
exec "$ar" "$@"
