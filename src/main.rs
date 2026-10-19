//! Canonical `serialhub` executable entry point.
mod cli;
fn main() -> anyhow::Result<()> {
    if let Some(result) = serialhub::launcher::early_command() {
        return result;
    }
    tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()?
        .block_on(cli::run())
}
