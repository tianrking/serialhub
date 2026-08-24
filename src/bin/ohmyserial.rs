//! Temporary compatibility entry point for the former executable name.

#[path = "../cli.rs"]
mod cli;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    eprintln!("warning: `ohmyserial` is a compatibility command; use `serialhub` for new scripts.");
    cli::run().await
}
