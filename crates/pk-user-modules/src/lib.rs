//! Stub of the app's custom native modules.
//!
//! `pk-runtime`'s `user-modules` feature depends on a crate named `pk-user-modules`.
//! In this repository that is this empty stub. For an app with `nativeModules` in
//! `prosperokit.config.ts` the CLI generates `<app>/.prosperokit/user-modules/` (same
//! crate name, calling each module crate's `register`) and builds `pk-runtime` in an
//! overlay workspace (`<app>/.prosperokit/rust`) whose `crates/pk-user-modules` points
//! at that generated crate.

/// Registers every custom native module with the runtime's module registry.
pub fn register_all(_reg: &mut pk_js::ModuleRegistry) {}
