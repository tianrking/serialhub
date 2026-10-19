//! Detached desktop lifecycle. A per-user file lock owns discovery even when the
//! requested port is occupied. Registry addresses are trusted only after a nonce
//! check against the live manager; PIDs are never used to kill a process.
use anyhow::{Context, Result};
macro_rules! diagnostic_fmt { ($($arg:tt)*) => { crate::launcher::diagnostic(&format!($($arg)*)) }; }
pub(crate) fn diagnostic(message: &str) {
    let _ = writeln!(std::io::stderr(), "{message}");
}

use fs2::FileExt;
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    net::{SocketAddr, TcpStream},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};

#[derive(Serialize, Deserialize)]
struct Instance {
    address: SocketAddr,
    instance: String,
}
struct Paths {
    lock: PathBuf,
    ready: PathBuf,
    log: PathBuf,
}
fn paths(bind: SocketAddr) -> Result<Paths> {
    let root = std::env::var_os("SERIALHUB_STATE_DIR")
        .map(PathBuf::from)
        .or_else(|| dirs::data_local_dir().map(|p| p.join("SerialHub")))
        .context("No per-user application data directory")?;
    anyhow::ensure!(
        root.is_absolute(),
        "Application data directory must be absolute"
    );
    fs::create_dir_all(&root)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&root, fs::Permissions::from_mode(0o700))?;
    }
    let scope = format!(
        "{}-{}",
        bind.ip().to_string().replace(':', "_"),
        bind.port()
    );
    Ok(Paths {
        lock: root.join(format!("{scope}.lock")),
        ready: root.join(format!("{scope}.json")),
        log: root.join(format!("{scope}.log")),
    })
}
fn private_file(path: &Path, append: bool) -> Result<File> {
    let mut options = OpenOptions::new();
    options
        .create(true)
        .read(true)
        .write(true)
        .truncate(false)
        .append(append);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    Ok(options.open(path)?)
}
fn request(address: SocketAddr, method: &str, path: &str) -> Result<serde_json::Value> {
    anyhow::ensure!(
        address.ip().is_loopback() && address.port() != 0,
        "Expected a local manager address"
    );
    let mut socket = TcpStream::connect_timeout(&address, Duration::from_millis(700))?;
    socket.set_read_timeout(Some(Duration::from_secs(2)))?;
    socket.set_write_timeout(Some(Duration::from_secs(2)))?;
    let body = if method == "POST" { "{}" } else { "" };
    write!(socket,"{method} {path} HTTP/1.1\r\nHost: {address}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",body.len())?;
    let mut bytes = Vec::new();
    socket.take(8192).read_to_end(&mut bytes)?;
    let response = std::str::from_utf8(&bytes)?;
    let (head, body) = response
        .split_once("\r\n\r\n")
        .context("Incomplete local manager response")?;
    anyhow::ensure!(
        head.split_whitespace().nth(1) == Some("200"),
        "Local manager rejected {path}: {}",
        head.lines().next().unwrap_or("")
    );
    Ok(serde_json::from_str(body)?)
}
fn discover(bind: SocketAddr, files: &Paths) -> Option<SocketAddr> {
    let saved: Instance =
        serde_json::from_reader(File::open(&files.ready).ok()?.take(4096)).ok()?;
    if !saved.address.ip().is_loopback() {
        return None;
    }
    let identity = request(saved.address, "GET", "/manager/identity").ok()?;
    (identity["product"] == "serialhub.desktop.v1"
        && identity["stopping"] != true
        && identity["instance"] == saved.instance
        && saved.address.ip() == bind.ip())
    .then_some(saved.address)
}
fn existing(bind: SocketAddr, files: &Paths) -> Option<SocketAddr> {
    discover(bind, files).or_else(|| {
        request(bind, "GET", "/manager/identity")
            .ok()
            .filter(|v| v["product"] == "serialhub.desktop.v1" && v["stopping"] != true)
            .map(|_| bind)
    })
}
fn open_existing(address: SocketAddr, open: bool) -> Result<()> {
    let identity = request(address, "GET", "/manager/identity")?;
    let version = identity["version"].as_str().unwrap_or("an older version");
    anyhow::ensure!(version==env!("CARGO_PKG_VERSION"),"SerialHub {version} is already running at http://{address}/. Quit it from All devices before starting SerialHub {}.",env!("CARGO_PKG_VERSION"));
    if open {
        opener::open(format!("http://{address}/"))?;
    }
    Ok(())
}
/// Launching from a terminal returns after readiness; the service has its own
/// session, closed stdin and file-backed diagnostics on every supported OS.
pub fn launch(bind: SocketAddr, open_browser: bool) -> Result<SocketAddr> {
    anyhow::ensure!(bind.ip().is_loopback(), "Desktop binds to loopback");
    let files = paths(bind)?;
    #[cfg(target_os = "linux")]
    if bind == "127.0.0.1:8787".parse::<SocketAddr>().unwrap() {
        if let Err(error) = install_shortcuts() {
            diagnostic(&format!("Desktop menu shortcuts unavailable: {error:#}"));
        }
    }
    if let Some(address) = existing(bind, &files) {
        open_existing(address, open_browser)?;
        return Ok(address);
    }
    // A previous instance may be draining devices after its HTTP listener closed.
    // Wait for its ownership lock before starting a replacement.
    let deadline = Instant::now() + Duration::from_secs(20);
    let ownership = private_file(&files.lock, false)?;
    loop {
        if let Some(address) = existing(bind, &files) {
            open_existing(address, open_browser)?;
            return Ok(address);
        }
        if FileExt::try_lock_exclusive(&ownership).is_ok() {
            FileExt::unlock(&ownership)?;
            break;
        }
        anyhow::ensure!(
            Instant::now() < deadline,
            "Previous instance is still stopping; see {}",
            files.log.display()
        );
        std::thread::sleep(Duration::from_millis(60));
    }
    rotate(&files.log);
    let log = private_file(&files.log, true)?;
    let mut child = Command::new(std::env::current_exe()?);
    child
        .arg("--desktop-worker")
        .arg(bind.to_string())
        .stdin(Stdio::null())
        .stdout(log.try_clone()?)
        .stderr(log);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        child.creation_flags(0x08000000 | 0x00000200);
    }
    let mut child = child
        .spawn()
        .context("Could not launch the background service")?;
    let deadline = Instant::now() + Duration::from_secs(12);
    loop {
        if let Some(address) = discover(bind, &files) {
            if open_browser {
                opener::open(format!("http://{address}/")).with_context(|| {
                    format!("SerialHub is running at http://{address}/; could not open the browser")
                })?;
            }
            return Ok(address);
        }
        if let Some(status) = child.try_wait()? {
            // Another simultaneous launcher may own the lock and still be starting.
            if !status.success() {
                anyhow::bail!(
                    "Background service could not start. Diagnostics: {}",
                    files.log.display()
                );
            }
        }
        anyhow::ensure!(
            Instant::now() < deadline,
            "Background startup timed out. Diagnostics: {}",
            files.log.display()
        );
        std::thread::sleep(Duration::from_millis(60));
    }
}
pub fn stop(bind: SocketAddr) -> Result<()> {
    let files = paths(bind)?;
    let Some(address) = existing(bind, &files) else {
        return Ok(());
    };
    let identity = request(address, "GET", "/manager/identity")?;
    request(address, "POST", "/manager/quit")?;
    let deadline = Instant::now() + Duration::from_secs(18);
    while request(address, "GET", "/manager/identity")
        .is_ok_and(|v| v["instance"] == identity["instance"])
    {
        anyhow::ensure!(
            Instant::now() < deadline,
            "SerialHub is still shutting down; see {}",
            files.log.display()
        );
        std::thread::sleep(Duration::from_millis(60));
    }
    Ok(())
}
fn rotate(path: &Path) {
    if fs::metadata(path).is_ok_and(|m| m.len() > 4 * 1024 * 1024) {
        let _ = fs::copy(path, path.with_extension("previous.log"));
        if let Ok(file) = OpenOptions::new().write(true).open(path) {
            let _ = file.set_len(0);
        }
    }
}
/// Called before entering Tokio: AppKit and the Windows message pump belong on
/// the process main thread. Command-line subcommands keep their normal streams.
pub fn early_command() -> Option<Result<()>> {
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    match args.first()?.to_str()? {
        "--desktop-worker" => Some((|| {
            anyhow::ensure!(args.len() == 2, "Invalid worker arguments");
            let bind = args[1].to_str().context("Invalid bind address")?.parse()?;
            worker(bind)
        })()),
        #[cfg(target_os = "linux")]
        "--install-shortcuts" if args.len() == 1 => Some(install_shortcuts()),
        "--quit" if args.len() == 1 => Some(stop("127.0.0.1:8787".parse().unwrap())),
        "--status" if args.len() == 1 => Some((|| {
            let bind = "127.0.0.1:8787".parse()?;
            let files = paths(bind)?;
            if let Some(address) = existing(bind, &files) {
                println!("SerialHub is running: http://{address}/");
            } else {
                println!("SerialHub is stopped");
            }
            Ok(())
        })()),
        _ => None,
    }
}
fn worker(bind: SocketAddr) -> Result<()> {
    anyhow::ensure!(bind.ip().is_loopback(), "Desktop binds to loopback");
    #[cfg(unix)]
    {
        nix::unistd::setsid().context("Could not detach from the terminal")?;
    }
    let _ = tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .with_target(false)
        .try_init();
    let files = paths(bind)?;
    let lock = private_file(&files.lock, false)?;
    if FileExt::try_lock_exclusive(&lock).is_err() {
        return Ok(());
    }
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()?;
    let desktop = runtime.block_on(crate::desktop::Desktop::start(bind))?;
    let control = desktop.control();
    control.background.store(true, Ordering::Relaxed);
    *control.log.write() = Some(files.log.clone());
    let stop = desktop.stop_token();
    let done = Arc::new(AtomicBool::new(false));
    let saved = Instance {
        address: desktop.address(),
        instance: desktop.instance().into(),
    };
    let temporary = files
        .ready
        .with_extension(format!("{}.tmp", saved.instance));
    {
        let mut file = private_file(&temporary, false)?;
        serde_json::to_writer(&mut file, &saved)?;
        file.sync_all()?;
    }
    if files.ready.exists() {
        fs::remove_file(&files.ready)?;
    }
    fs::rename(temporary, &files.ready)?;
    let url = format!("http://{}/", saved.address);
    diagnostic_fmt!(
        "SerialHub {} is running at {url}; close it from the system tray, the app menu, or --quit",
        env!("CARGO_PKG_VERSION")
    );
    let finished = done.clone();
    let cancellation = stop.clone();
    let log = files.log.clone();
    runtime.spawn(async move {
        #[cfg(unix)]
        let termination = async {
            use tokio::signal::unix::{signal, SignalKind};
            let mut term = signal(SignalKind::terminate())?;
            let mut interrupt = signal(SignalKind::interrupt())?;
            tokio::select! {_=term.recv()=>{},_=interrupt.recv()=>{}};
            Ok::<_, std::io::Error>(())
        };
        #[cfg(windows)]
        let termination = std::future::pending::<Result<(), std::io::Error>>();
        tokio::select! {_=cancellation.cancelled()=>{},_=termination=>{cancellation.cancel();}}
        // Let every open browser receive the final SSE event before draining HTTP.
        tokio::time::sleep(Duration::from_millis(100)).await;
        if tokio::time::timeout(Duration::from_secs(15), desktop.shutdown())
            .await
            .is_err()
        {
            diagnostic_fmt!("Shutdown exceeded its deadline; terminating the desktop runtime");
        }
        finished.store(true, Ordering::Release);
    });
    // Runtime diagnostics remain bounded even while the browser is closed.
    let monitoring = runtime.spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(2)).await;
            rotate(&log);
        }
    });
    let result = crate::tray::run(&url, control, stop.clone(), done.clone());
    if result.is_err() {
        stop.cancel();
        runtime.block_on(async {
            while !done.load(Ordering::Acquire) {
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
        });
    }
    monitoring.abort();
    if File::open(&files.ready)
        .ok()
        .and_then(|file| serde_json::from_reader::<_, Instance>(file.take(4096)).ok())
        .is_some_and(|record| record.instance == saved.instance)
    {
        let _ = fs::remove_file(&files.ready);
    }
    runtime.shutdown_timeout(Duration::from_secs(2));
    drop(lock);
    result
}

/// Present a startup failure without leaving a silent, invisible GUI process.
pub fn report_error(error: &anyhow::Error) {
    diagnostic_fmt!("SerialHub could not start: {error:#}");
    #[cfg(windows)]
    unsafe {
        #[link(name = "user32")]
        extern "system" {
            fn MessageBoxW(
                window: *mut std::ffi::c_void,
                text: *const u16,
                title: *const u16,
                flags: u32,
            ) -> i32;
        }
        let text: Vec<_> = format!("SerialHub could not start:\n{error:#}")
            .encode_utf16()
            .chain(Some(0))
            .collect();
        let title: Vec<_> = "SerialHub".encode_utf16().chain(Some(0)).collect();
        MessageBoxW(std::ptr::null_mut(), text.as_ptr(), title.as_ptr(), 0x10);
    }
    #[cfg(not(windows))]
    {
        {
            let message = format!("{error:#}")
                .replace('&', "&amp;")
                .replace('<', "&lt;")
                .replace('>', "&gt;");
            let path = paths("127.0.0.1:8787".parse().unwrap())
                .map(|files| files.log.with_extension("error.html"))
                .unwrap_or_else(|_| {
                    std::env::temp_dir()
                        .join(format!("serialhub-error-{}.html", uuid::Uuid::new_v4()))
                });
            if let Ok(mut file) = private_file(&path, false) {
                let _ = file.set_len(0);
                let _=write!(file,"<!doctype html><meta charset=utf-8><title>SerialHub — startup</title><style>body{{font:16px system-ui;background:#f3f6fb;color:#20324e;padding:8vh 10vw}}main{{padding:32px;border-radius:16px;background:white}}pre{{white-space:pre-wrap}}</style><main><h1>SerialHub could not start</h1><pre>{message}</pre><p>Check the diagnostics, then launch SerialHub again.</p></main>");
                let _ = opener::open(path);
            }
        }
    }
}

/// Install application-menu entries, including an exit action for desktops that
/// do not display StatusNotifierItem icons. No shell parses the executable path.
#[cfg(target_os = "linux")]
fn install_shortcuts() -> Result<()> {
    let root = dirs::data_dir().context("No application-menu directory")?;
    let applications = root.join("applications");
    fs::create_dir_all(&applications)?;
    let icons = root.join("icons/hicolor/scalable/apps");
    fs::create_dir_all(&icons)?;
    fs::write(
        icons.join("io.serialhub.SerialHub.svg"),
        r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#111e33"/><g stroke="#82b3ff" stroke-width="3" fill="none" stroke-linejoin="round"><path d="m12 25 20-12 20 12-20 12z"/><path d="m12 35 20 12 20-12M12 45l20 12 20-12"/></g></svg>"##,
    )?;
    let executable_path = std::env::current_exe()?;
    let executable = desktop_quote(executable_path.to_str().context(
        "Application-menu paths must use UTF-8; run the launcher directly from this folder",
    )?);
    // GIO checks argv[0] before expanding %% in Exec. Keep env as argv[0] so
    // a portable folder containing '%' still resolves to the real executable.
    // env executes the quoted absolute path directly; no shell is involved.
    let executable = format!("env -- {executable}");
    fs::write(applications.join("io.serialhub.SerialHub.desktop"),format!("[Desktop Entry]\nType=Application\nName=SerialHub\nComment=Serial device workspace\nExec={executable}\nIcon=io.serialhub.SerialHub\nTerminal=false\nCategories=Development;Utility;\nActions=Quit;\n\n[Desktop Action Quit]\nName=Quit SerialHub\nExec={executable} --quit\n"))?;
    fs::write(applications.join("io.serialhub.SerialHub.Quit.desktop"),format!("[Desktop Entry]\nType=Application\nName=Quit SerialHub\nComment=Stop SerialHub and close all devices\nExec={executable} --quit\nIcon=io.serialhub.SerialHub\nTerminal=false\nCategories=Utility;\n"))?;
    Ok(())
}
#[cfg(target_os = "linux")]
fn desktop_quote(value: &str) -> String {
    // Desktop-entry string decoding runs before Exec argument decoding.
    let argument = value
        .replace('%', "%%")
        .replace('\\', "\\\\")
        .replace('"', r#"\""#)
        .replace('$', r"\$")
        .replace('`', r"\`");
    format!("\"{}\"", argument.replace('\\', "\\\\"))
}
