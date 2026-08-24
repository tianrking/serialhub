//! Canonical `serialhub` executable entry point.

mod cli;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    cli::run().await
}
