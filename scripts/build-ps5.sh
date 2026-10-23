#!/usr/bin/env bash
# ProsperoKit - build the Rust runtime static library for the PS5 target.
#   scripts/build-ps5.sh [--dev] [--features a,b]
# Output: target/x86_64-sie-ps5/release/libprosperokit_runtime.a
# Needs: the pinned nightly (rust-toolchain.toml) with rust-src, Clang 18
# (clang-18 on PATH or PS5_CLANG), and PS5_PAYLOAD_SDK (ps5-payload-sdk v0.42).
# SPDX-License-Identifier: GPL-3.0-or-later
set -euo pipefail
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
features=()
profile_args=(--release)
while [[ $# -gt 0 ]]; do
    case $1 in
        --dev) features+=(dev); shift ;;
        --features) IFS=',' read -r -a extra <<< "$2"; features+=("${extra[@]}"); shift 2 ;;
        --debug) profile_args=(); shift ;;
        *) echo "usage: scripts/build-ps5.sh [--dev] [--debug] [--features a,b]" >&2; exit 2 ;;
    esac
done
: "${PS5_PAYLOAD_SDK:?PS5_PAYLOAD_SDK is not set (run 'prosperokit doctor')}"
[[ -x $PS5_PAYLOAD_SDK/bin/prospero-clang ]] || { echo "PS5_PAYLOAD_SDK=$PS5_PAYLOAD_SDK is not a ps5-payload-sdk install" >&2; exit 2; }
clang=${PS5_CLANG:-$(command -v clang-18 || true)}
[[ -n $clang ]] || [[ ! -x /opt/homebrew/opt/llvm@18/bin/clang ]] || clang=/opt/homebrew/opt/llvm@18/bin/clang
[[ -n $clang ]] || { echo "clang-18 not found; set PS5_CLANG" >&2; exit 2; }
export PS5_CLANG=$clang
# bindgen (rquickjs-sys) parses quickjs.h for the target with libclang.
export BINDGEN_EXTRA_CLANG_ARGS_x86_64_sie_ps5="-target x86_64-sie-ps5 -isysroot $PS5_PAYLOAD_SDK -isystem $PS5_PAYLOAD_SDK/target/include"
libclang_dir=$(dirname "$clang")/../lib
[[ -z ${LIBCLANG_PATH:-} && -d $libclang_dir ]] && export LIBCLANG_PATH=$libclang_dir
cd "$root"
cmd=(cargo build -p pk-runtime "${profile_args[@]}"
    --target "$root/targets/x86_64-sie-ps5.json"
    -Z json-target-spec -Z build-std=std,panic_abort -Z build-std-features=compiler-builtins-mem)
if (( ${#features[@]} > 0 )); then
    cmd+=(--features "$(IFS=,; echo "${features[*]}")")
fi
exec "${cmd[@]}"
