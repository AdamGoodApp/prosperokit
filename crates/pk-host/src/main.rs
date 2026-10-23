//! `pk-host`: runs a ProsperoKit app on the desktop, in a 1920×1080 window or
//! headless (CI): the same `prosperokit_runtime::run` as the PS5 title, on the
//! host platform backend.
//!
//! ```text
//! pk-host --app <dir> [--headless --frames N --screenshot out.png --input "down,down,cross"]
//!         [--dev-server host:port --dev-token t]
//! ```

use std::path::PathBuf;
use std::process::ExitCode;

use clap::Parser;
use pk_platform::host::{HeadlessOptions, HostOptions, HostPlatform};

#[derive(Parser, Debug)]
#[command(
    name = "pk-host",
    version,
    about = "Run a ProsperoKit app on the desktop"
)]
struct Args {
    /// The app folder (what `app0://` points at): contains `sce_sys/param.json`, `dist/`, `assets/`.
    #[arg(long)]
    app: PathBuf,
    /// Run without a window at a simulated 60 Hz.
    #[arg(long)]
    headless: bool,
    /// Headless: minimum number of frames to run before exiting 0. The run
    /// also lasts until every `--input` press was delivered and the app
    /// settled (no JS activity for 50 ms of real time).
    #[arg(long, default_value_t = 60, requires = "headless")]
    frames: u32,
    /// Headless: write the last presented frame as a 1920×1080 PNG.
    #[arg(long, requires = "headless")]
    screenshot: Option<PathBuf>,
    /// Headless: buttons pressed one after another, comma separated
    /// (`up,down,left,right,cross,circle,square,triangle,l1,r1,l2,r2,options,...`).
    /// Each press waits for the app to settle first, so presses never land on
    /// a screen that is still loading or reacting to the previous one.
    #[arg(long, requires = "headless", value_delimiter = ',')]
    input: Vec<String>,
    /// Dev agent address (`host:port`) the runtime connects to (`PK_DEV_SERVER`).
    #[arg(long, value_name = "HOST:PORT")]
    dev_server: Option<String>,
    /// Token for the dev agent (`PK_DEV_TOKEN`).
    #[arg(long)]
    dev_token: Option<String>,
}

/// The app's display name from `sce_sys/param.json` (the folder name if missing).
fn app_name(app_dir: &std::path::Path) -> String {
    let text = std::fs::read_to_string(app_dir.join("sce_sys/param.json")).unwrap_or_default();
    let (_, _, name) = pk_platform::parse_param_json(&text);
    if !name.is_empty() {
        return name;
    }
    std::fs::canonicalize(app_dir)
        .ok()
        .and_then(|p| p.file_name().map(|n| n.to_string_lossy().into_owned()))
        .unwrap_or_else(|| "app".to_string())
}

fn main() -> ExitCode {
    let args = Args::parse();
    #[cfg(not(feature = "dev"))]
    if args.dev_server.is_some() {
        eprintln!(
            "pk-host: --dev-server is ignored: this pk-host was built without the `dev` feature \
             (use the one `prosperokit dev` builds and prints)"
        );
    }
    // Handed to the runtime through the environment (no other thread exists yet).
    if let Some(server) = &args.dev_server {
        // SAFETY: single-threaded at this point; nothing reads the environment concurrently.
        unsafe { std::env::set_var("PK_DEV_SERVER", server) };
    }
    if let Some(token) = &args.dev_token {
        // SAFETY: as above.
        unsafe { std::env::set_var("PK_DEV_TOKEN", token) };
    }
    let headless = args.headless.then(|| HeadlessOptions {
        frames: args.frames,
        input: args.input.clone(),
        screenshot: args.screenshot.clone(),
    });
    let opts = HostOptions {
        window_title: format!("ProsperoKit — {}", app_name(&args.app)),
        app_dir: args.app,
        headless,
    };
    match HostPlatform::new(opts) {
        Ok(platform) => prosperokit_runtime::run(Box::new(platform)),
        Err(error) => {
            eprintln!("pk-host: {error}");
            ExitCode::from(2)
        }
    }
}
