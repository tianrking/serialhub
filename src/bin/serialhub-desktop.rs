//! Double-click launcher. The regular serialhub executable keeps its console
//! subsystem so command-line tools retain stdout, stderr and exit codes.
#![cfg_attr(windows, windows_subsystem = "windows")]
#[path = "../cli.rs"]
mod cli;

#[tokio::main]
async fn main() {
    if let Err(error) = cli::run().await {
        #[cfg(windows)]
        show_error(&format!("SerialHub could not start:\n{error:#}"));
        #[cfg(not(windows))]
        eprintln!("SerialHub could not start: {error:#}");
        std::process::exit(1);
    }
}

#[cfg(windows)]
fn show_error(message: &str) {
    #[link(name = "user32")]
    extern "system" {
        fn MessageBoxW(
            window: *mut std::ffi::c_void,
            text: *const u16,
            title: *const u16,
            flags: u32,
        ) -> i32;
    }
    let text: Vec<u16> = message.encode_utf16().chain(Some(0)).collect();
    let title: Vec<u16> = "SerialHub".encode_utf16().chain(Some(0)).collect();
    // Both UTF-16 strings are NUL-terminated and live throughout the OS call.
    unsafe {
        MessageBoxW(std::ptr::null_mut(), text.as_ptr(), title.as_ptr(), 0x10);
    }
}
