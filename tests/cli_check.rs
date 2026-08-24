use std::process::Command;

use tempfile::tempdir;

fn check_config(config: &str) -> std::process::Output {
    let directory = tempdir().expect("create temporary profile directory");
    let path = directory.path().join("serialhub.toml");
    std::fs::write(&path, config).expect("write temporary profile");

    Command::new(env!("CARGO_BIN_EXE_serialhub"))
        .args(["check", "--config"])
        .arg(path)
        .output()
        .expect("run serialhub check")
}

#[test]
fn check_validates_without_opening_the_serial_device() {
    let output = check_config(
        r#"
[real]
path = "mock:demo"

[fanout]
tcp_count = 1
tcp_base_port = 18888
"#,
    );

    assert!(
        output.status.success(),
        "stderr: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(stdout.contains("configuration valid:"), "stdout: {stdout}");
    assert!(
        stdout.contains("mock:demo @ 115200 baud"),
        "stdout: {stdout}"
    );
    assert!(
        stdout.contains("tcp tcp0 127.0.0.1:18888"),
        "stdout: {stdout}"
    );
    assert!(
        stdout.contains("does not open the serial device"),
        "stdout: {stdout}"
    );
}

#[test]
fn check_rejects_an_unsafe_remote_plaintext_api_bind() {
    let output = check_config(
        r#"
[real]
path = "mock:demo"

[api]
bind = "0.0.0.0:18787"
"#,
    );

    assert!(!output.status.success());
    assert!(
        String::from_utf8_lossy(&output.stderr).contains("must bind to loopback"),
        "stderr: {}",
        String::from_utf8_lossy(&output.stderr)
    );
}
