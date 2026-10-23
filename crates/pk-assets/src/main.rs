mod at9;
mod dds;
mod icon;
mod validate;

use clap::{Parser, Subcommand};
use std::path::PathBuf;
use std::process::ExitCode;

#[derive(Parser)]
#[command(
    name = "pk-assets",
    version,
    about = "ProsperoKit presentation asset tool"
)]
struct Cli {
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// Resize/crop an image to a 512x512 RGBA PNG icon
    Icon { input: PathBuf, output: PathBuf },
    /// Convert an image to a 3840x2160 BC7 DX10 DDS background
    Background { input: PathBuf, output: PathBuf },
    /// Validate an ATRAC9 .at9 file
    #[command(name = "at9-check")]
    At9Check { file: PathBuf },
    /// Validate an sce_sys directory
    Validate { dir: PathBuf },
}

fn run(cmd: Cmd) -> Result<(), String> {
    match cmd {
        Cmd::Icon { input, output } => icon::make_icon(&input, &output),
        Cmd::Background { input, output } => dds::make_background(&input, &output),
        Cmd::At9Check { file } => {
            let data = std::fs::read(&file)
                .map_err(|e| format!("{}: cannot read: {e}", file.display()))?;
            at9::check_at9(&data).map_err(|e| format!("{}: {e}", file.display()))?;
            println!("ok");
            Ok(())
        }
        Cmd::Validate { dir } => {
            validate::validate_dir(&dir)?;
            println!("ok");
            Ok(())
        }
    }
}

fn main() -> ExitCode {
    match run(Cli::parse().cmd) {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("pk-assets: {e}");
            ExitCode::FAILURE
        }
    }
}
