use serialhub::desktop::Desktop;

#[tokio::test]
async fn fixed_port_failure_does_not_move_the_service_or_touch_another_listener() {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let bind = listener.local_addr().unwrap();
    assert!(Desktop::start_fixed(bind).await.is_err());
    let desktop = Desktop::start(bind).await.unwrap();
    assert_ne!(desktop.address(), bind);
    desktop.shutdown().await;
    assert!(std::net::TcpListener::bind(bind).is_err());
    // Keep the unrelated socket reserved. Exercise restart on a socket created
    // by the actual server, with its normal reuse policy and no reservation gap.
    let fixed = Desktop::start_fixed("127.0.0.1:0".parse().unwrap())
        .await
        .unwrap();
    let fixed_bind = fixed.address();
    fixed.shutdown().await;
    let restarted = Desktop::start_fixed(fixed_bind).await.unwrap();
    assert_eq!(restarted.address(), fixed_bind);
    restarted.shutdown().await;
    assert!(std::net::TcpListener::bind(fixed_bind).is_ok());
    drop(listener);
}

#[test]
fn service_preview_is_nonmutating_and_rejects_remote_or_dynamic_bind() {
    let root = tempfile::tempdir().unwrap();
    let binary = env!("CARGO_BIN_EXE_serialhub");
    for address in ["0.0.0.0:8787", "127.0.0.1:0"] {
        let output = std::process::Command::new(binary)
            .args(["service", "install", "--dry-run", "--bind", address])
            .env("XDG_CONFIG_HOME", root.path())
            .output()
            .unwrap();
        assert!(!output.status.success());
    }
    let output = std::process::Command::new(binary)
        .args(["service", "install", "--dry-run"])
        .env("XDG_CONFIG_HOME", root.path())
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(String::from_utf8_lossy(&output.stdout).contains("serve"));
    assert_eq!(std::fs::read_dir(root.path()).unwrap().count(), 0);
}

#[cfg(target_os = "linux")]
#[test]
fn unavailable_user_service_manager_leaves_no_partial_registration() {
    let root = tempfile::tempdir().unwrap();
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let bind = listener.local_addr().unwrap().to_string();
    // Keep the reservation while the subprocess probes identity, preventing
    // another parallel test from acquiring the just-released ephemeral port.
    let output = std::process::Command::new(env!("CARGO_BIN_EXE_serialhub"))
        .args(["service", "install", "--bind", &bind])
        .env_remove("SERIALHUB_STATE_DIR")
        .env("XDG_CONFIG_HOME", root.path().join("config"))
        .env("XDG_DATA_HOME", root.path().join("data"))
        .env(
            "DBUS_SESSION_BUS_ADDRESS",
            format!("unix:path={}/no-bus", root.path().display()),
        )
        .output()
        .unwrap();
    assert!(!output.status.success());
    assert!(!root
        .path()
        .join("config/SerialHub/service/installed.json")
        .exists());
    assert!(!root
        .path()
        .join("config/systemd/user/serialhub.service")
        .exists());
}
