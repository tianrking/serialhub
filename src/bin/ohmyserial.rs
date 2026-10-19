//! Compatibility entry point.
#[path = "../cli.rs"]
mod cli;
fn main() -> anyhow::Result<()> {
    if let Some(result) = serialhub::launcher::early_command() {
        return result;
    }
    eprintln!("warning: `ohmyserial` is a compatibility command; use `serialhub` for new scripts.");
    tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()?
        .block_on(cli::run())
}
