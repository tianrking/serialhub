#![cfg(unix)]

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use serialhub::config::Config;
use serialhub::ledger::{read_verified, EventPayload};

struct ChildGuard(Child);

impl Drop for ChildGuard {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

#[test]
fn sigterm_seals_the_ledger_and_exits_successfully() {
    let temp = tempfile::tempdir().unwrap();
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    drop(listener);
    let mut config = Config::default();
    config.real.path = "mock:cli-shutdown".into();
    config.api.bind = address.to_string();
    config.clients.clear();
    config.log.mirror_console = false;
    let ledger = temp.path().join("ledger");
    config.ledger.directory = Some(ledger.clone());
    let profile = temp.path().join("hub.toml");
    std::fs::write(&profile, toml::to_string(&config).unwrap()).unwrap();
    let mut child = ChildGuard(
        Command::new(env!("CARGO_BIN_EXE_serialhub"))
            .arg("run")
            .arg("-c")
            .arg(profile)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap(),
    );
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        assert!(Instant::now() < deadline, "Hub did not become ready");
        assert!(child.0.try_wait().unwrap().is_none(), "Hub exited early");
        if let Ok(mut stream) = TcpStream::connect_timeout(&address, Duration::from_millis(100)) {
            stream
                .set_read_timeout(Some(Duration::from_millis(200)))
                .unwrap();
            stream
                .write_all(
                    format!(
                        "GET /v1/status HTTP/1.1\r\nHost: {address}\r\nConnection: close\r\n\r\n"
                    )
                    .as_bytes(),
                )
                .unwrap();
            let mut response = String::new();
            if stream.read_to_string(&mut response).is_ok()
                && response.contains("\"connected\":true")
            {
                break;
            }
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    assert!(Command::new("kill")
        .args(["-TERM", &child.0.id().to_string()])
        .status()
        .unwrap()
        .success());
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        if let Some(status) = child.0.try_wait().unwrap() {
            assert!(
                status.success(),
                "SIGTERM caused an ungraceful exit: {status}"
            );
            break;
        }
        assert!(Instant::now() < deadline, "Hub ignored SIGTERM");
        std::thread::sleep(Duration::from_millis(20));
    }
    let read = read_verified(ledger).expect("shutdown must leave a sealed, verifiable session");
    assert!(read.events.iter().any(|event| matches!(&event.event,
        EventPayload::Control(control) if control.name == "hub_stopping")));
}
