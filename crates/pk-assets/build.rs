//! intel_tex_2 compiles C++ (ISPC texture compressors) but does not ask for
//! the C++ runtime. macOS links libc++ implicitly; GNU/Linux needs libstdc++
//! named explicitly, or linking fails on `__gxx_personality_v0`.

fn main() {
    let os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    let env = std::env::var("CARGO_CFG_TARGET_ENV").unwrap_or_default();
    if os == "linux" && env == "gnu" {
        println!("cargo:rustc-link-lib=dylib=stdc++");
    }
}
