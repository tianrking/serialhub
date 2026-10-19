use serde_json::{json, Value};
use std::{
    io::{Read, Write},
    net::{SocketAddr, TcpListener, TcpStream},
    path::Path,
    process::Command,
    time::Duration,
};
fn request(address: SocketAddr, method: &str, path: &str, body: Value) -> Value {
    let text = if body.is_null() {
        String::new()
    } else {
        body.to_string()
    };
    let mut stream = TcpStream::connect_timeout(&address, Duration::from_secs(2)).unwrap();
    stream
        .set_read_timeout(Some(Duration::from_secs(3)))
        .unwrap();
    write!(stream,"{method} {path} HTTP/1.1\r\nHost: {address}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{text}",text.len()).unwrap();
    let mut bytes = String::new();
    stream.read_to_string(&mut bytes).unwrap();
    let (head, body) = bytes.split_once("\r\n\r\n").unwrap();
    assert!(head.starts_with("HTTP/1.1 20"), "{bytes}");
    serde_json::from_str(body).unwrap()
}
fn command(root: &Path, args: &[&str]) -> std::process::Output {
    Command::new(env!("CARGO_BIN_EXE_serialhub"))
        .args(args)
        .env("SERIALHUB_STATE_DIR", root.join("state"))
        .env("XDG_DATA_HOME", root.join("data"))
        .current_dir(root)
        .output()
        .unwrap()
}
fn start(root: &Path, bind: &str) -> SocketAddr {
    let output = command(
        root,
        &["desktop", "--background", "--no-browser", "--bind", bind],
    );
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let scope = format!("{}.json", bind.replace(':', "-"));
    let saved: Value =
        serde_json::from_slice(&std::fs::read(root.join("state").join(scope)).unwrap()).unwrap();
    saved["address"].as_str().unwrap().parse().unwrap()
}
struct Shutdown<'a> {
    root: &'a Path,
    bind: String,
}
impl Drop for Shutdown<'_> {
    fn drop(&mut self) {
        let output = command(self.root, &["quit", "--bind", &self.bind]);
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
}
#[test]
fn detached_launcher_returns_reuses_fallback_port_and_releases_all_devices() {
    let temporary = tempfile::tempdir().unwrap();
    let root = temporary.path();
    // Hold a port with an unrelated service: rediscovery must use the actual
    // assigned address, without stopping or replacing the other service.
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let bind = listener.local_addr().unwrap().to_string();
    let running = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(true));
    let flag = running.clone();
    listener.set_nonblocking(true).unwrap();
    let other = std::thread::spawn(move || {
        while flag.load(std::sync::atomic::Ordering::Relaxed) {
            if let Ok((mut socket, _)) = listener.accept() {
                let _ = socket.set_read_timeout(Some(Duration::from_millis(500)));
                let mut buffer = [0; 1024];
                let _ = socket.read(&mut buffer);
                let body = "{\"product\":\"unrelated\"}";
                let _ = write!(
                    socket,
                    "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
            } else {
                std::thread::sleep(Duration::from_millis(10));
            }
        }
    });
    let address = start(root, &bind);
    let cleanup = Shutdown {
        root,
        bind: bind.clone(),
    };
    assert_ne!(address.to_string(), bind);
    assert_eq!(
        request(address, "GET", "/manager/info", Value::Null)["app"]["background"],
        true
    );
    let first = request(address, "GET", "/manager/identity", Value::Null)["instance"].clone();
    for _ in 0..2 {
        assert_eq!(start(root, &bind), address);
        assert_eq!(
            request(address, "GET", "/manager/identity", Value::Null)["instance"],
            first
        );
    }
    let settings = json!({"baud":115200,"databits":8,"parity":"none","stopbits":1,"flow":"none"});
    for path in ["mock:launcher-a", "mock:launcher-b"] {
        request(
            address,
            "POST",
            "/manager/sessions",
            json!({"path":path,"settings":settings}),
        );
    }
    assert_eq!(
        request(address, "GET", "/manager/info", Value::Null)["sessions"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
    drop(cleanup);
    assert!(TcpStream::connect_timeout(&address, Duration::from_millis(200)).is_err());
    assert!(command(root, &["quit", "--bind", &bind]).status.success());
    // The unrelated listener survives both stops.
    assert!(TcpStream::connect_timeout(&bind.parse().unwrap(), Duration::from_millis(200)).is_ok());
    running.store(false, std::sync::atomic::Ordering::Relaxed);
    other.join().unwrap();
}
#[test]
fn stale_registry_is_replaced_and_shutdown_can_restart_cleanly() {
    let temporary = tempfile::tempdir().unwrap();
    let root = temporary.path();
    std::fs::create_dir(root.join("state")).unwrap();
    std::fs::write(
        root.join("state/127.0.0.1-0.json"),
        json!({"address":"192.0.2.1:8787","instance":"stale"}).to_string(),
    )
    .unwrap();
    let first = start(root, "127.0.0.1:0");
    let cleanup = Shutdown {
        root,
        bind: "127.0.0.1:0".into(),
    };
    assert_eq!(
        request(first, "GET", "/manager/identity", Value::Null)["product"],
        "serialhub.desktop.v1"
    );
    drop(cleanup);
    let second = start(root, "127.0.0.1:0");
    let _cleanup = Shutdown {
        root,
        bind: "127.0.0.1:0".into(),
    };
    assert_eq!(
        request(second, "GET", "/manager/info", Value::Null)["sessions"],
        json!([])
    );
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        for entry in std::fs::read_dir(root.join("state")).unwrap() {
            let entry = entry.unwrap();
            assert_eq!(entry.metadata().unwrap().permissions().mode() & 0o077, 0);
        }
    }
}

#[cfg(target_os = "linux")]
#[test]
fn application_menu_launches_from_a_portable_path_with_special_characters() {
    if Command::new("gio").arg("version").output().is_err() {
        return;
    }
    let temporary = tempfile::tempdir().unwrap();
    let folder = temporary
        .path()
        .join("SerialHub 中文 \"$ percent% back` slash\\");
    std::fs::create_dir(&folder).unwrap();
    let executable = folder.join("serialhub-desktop");
    std::fs::copy(env!("CARGO_BIN_EXE_serialhub-desktop"), &executable).unwrap();
    let data = temporary.path().join("data");
    let output = Command::new(&executable)
        .arg("--install-shortcuts")
        .env("XDG_DATA_HOME", &data)
        .output()
        .unwrap();
    assert!(output.status.success(), "{output:?}");
    let entry = data.join("applications/io.serialhub.SerialHub.desktop");
    let original = std::fs::read_to_string(&entry).unwrap();
    let mut lines = original.lines().map(str::to_owned).collect::<Vec<_>>();
    // Exercise the installed command via GIO without starting a live service.
    let command = lines
        .iter_mut()
        .find(|line| line.starts_with("Exec="))
        .unwrap();
    command.push_str(" --version");
    std::fs::write(&entry, lines.join("\n") + "\n").unwrap();
    let output = Command::new("gio")
        .args(["launch"])
        .arg(entry)
        .env("XDG_DATA_HOME", data)
        .output()
        .unwrap();
    assert!(output.status.success(), "{output:?}");
    assert_eq!(
        String::from_utf8_lossy(&output.stdout).trim(),
        format!("serialhub {}", env!("CARGO_PKG_VERSION"))
    );
}
