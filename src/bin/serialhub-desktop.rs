//! Native launcher: no console window on Windows, independent service on Unix.
#![cfg_attr(windows, windows_subsystem = "windows")]
#[path = "../cli.rs"]
mod cli;
fn main() {
    let result = if let Some(result) = serialhub::launcher::early_command() {
        result
    } else {
        tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
            .map_err(anyhow::Error::from)
            .and_then(|runtime| runtime.block_on(cli::run()))
    };
    if let Err(error) = result {
        if std::env::args_os()
            .nth(1)
            .is_some_and(|value| value == "--desktop-worker")
        {
            let _ = std::io::Write::write_all(
                &mut std::io::stderr(),
                format!("SerialHub worker: {error:#}\n").as_bytes(),
            );
        } else {
            serialhub::launcher::report_error(&error);
        }
        std::process::exit(1);
    }
}
