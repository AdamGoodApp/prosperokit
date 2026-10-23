# ProsperoKit PS5 builder image.
# Everything a PS5 build needs in one place: Clang/LLD 18, the vendored kit's
# host tools prerequisites, ps5-payload-sdk v0.42, the pinned Rust nightly with
# rust-src (for -Z build-std), Node 22 and pnpm.
#
#   docker build -t prosperokit-ps5-builder docker/ps5-builder
#   docker run --rm -v "$PWD:/work" -w /work prosperokit-ps5-builder scripts/build-ps5.sh
#
# SPDX-License-Identifier: GPL-3.0-or-later
FROM ubuntu:24.04

ARG RUST_NIGHTLY=nightly-2026-10-20
ARG SDK_VERSION=v0.42
ARG SDK_SHA256=8cfbc7cd5811e719eb4f0c47eea668d3dc7b40bc8ab11c4a5031d40c23ec02da
ARG NODE_MAJOR=22
ARG PNPM_VERSION=12.14.0

ENV DEBIAN_FRONTEND=noninteractive \
    PS5_PAYLOAD_SDK=/opt/ps5-payload-sdk \
    PS5_CLANG=clang-18 \
    RUSTUP_HOME=/usr/local/rustup \
    CARGO_HOME=/usr/local/cargo \
    PATH=/usr/local/cargo/bin:/usr/lib/llvm-18/bin:$PATH \
    LIBCLANG_PATH=/usr/lib/llvm-18/lib

RUN apt-get update -qq && apt-get install -y -qq --no-install-recommends \
        ca-certificates curl wget unzip git make ninja-build ccache pkg-config \
        clang-18 lld-18 llvm-18 libclang-18-dev build-essential coreutils python3 python3-pil \
        socat xz-utils zip \
    && rm -rf /var/lib/apt/lists/*

# ps5-payload-sdk (binary distribution; works on any host architecture).
RUN curl -fsSL --retry 3 -o /tmp/ps5-payload-sdk.zip \
        "https://github.com/ps5-payload-dev/sdk/releases/download/${SDK_VERSION}/ps5-payload-sdk.zip" \
    && echo "${SDK_SHA256}  /tmp/ps5-payload-sdk.zip" | sha256sum -c - \
    && unzip -q /tmp/ps5-payload-sdk.zip -d /opt \
    && rm /tmp/ps5-payload-sdk.zip \
    && test -x /opt/ps5-payload-sdk/bin/prospero-clang

# Rust: the pinned nightly plus rust-src (std is built from source for the PS5
# target) and the lints used by CI.
RUN curl -fsSL https://sh.rustup.rs | sh -s -- -y --no-modify-path --profile minimal \
        --default-toolchain "${RUST_NIGHTLY}" --component rust-src --component clippy --component rustfmt \
    && rustup --version && cargo --version

# Node 22 LTS + pnpm.
RUN curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash - \
    && apt-get install -y -qq --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/* \
    && npm install -g "pnpm@${PNPM_VERSION}" \
    && node --version && pnpm --version

WORKDIR /work
CMD ["bash"]
