use std::path::Path;

fn main() {
    println!("cargo:rerun-if-changed=build.rs");
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../packages/runtime-prelude/dist");
    for name in ["prelude.ui.js", "prelude.server.js"] {
        let path = dir.join(name);
        println!("cargo:rerun-if-changed={}", path.display());
        if !path.is_file() {
            println!(
                "cargo:warning=missing {}: run `pnpm --filter @prosperokit/runtime-prelude build`",
                path.display()
            );
            panic!(
                "missing {} — run `pnpm --filter @prosperokit/runtime-prelude build`",
                path.display()
            );
        }
    }
}
