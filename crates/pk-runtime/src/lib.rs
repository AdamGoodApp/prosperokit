//! ProsperoKit runtime: the one entry point shared by the PS5 title and the
//! desktop host. [`run`] receives the platform (`Ps5Platform` on the console,
//! `HostPlatform` on the desktop) and never returns.

use pk_platform::Platform;

mod app;

/// Runs the app on `platform`: the engine, the JS runtimes, the native modules
/// and (with the `dev` feature) the dev agent. Never returns: the process ends
/// through the platform's exit path.
pub fn run(platform: Box<dyn Platform>) -> ! {
    app::run(platform)
}

/// PS5 entry point called from `csrc/main.c`. Never returns (returning from
/// `main` crashes the launch context).
#[cfg(target_vendor = "sie")]
#[unsafe(no_mangle)]
pub extern "C" fn pk_main() -> ! {
    match pk_platform::ps5::Ps5Platform::new() {
        Ok(platform) => run(Box::new(platform)),
        Err(error) => {
            pk_platform::ps5::notify(&format!("ProsperoKit: startup failed: {error}"));
            loop {
                std::thread::sleep(std::time::Duration::from_secs(1));
            }
        }
    }
}
