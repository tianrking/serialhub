//! Runtime serial settings: owner acknowledgements, leases, and HTTP permissions.
use serde_json::{json, Value};
use serialhub::{config::Config, hub};
use std::{net::SocketAddr, time::Duration};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
};

async fn address() -> SocketAddr {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    listener.local_addr().unwrap()
}
async fn request(addr: SocketAddr, method: &str, path: &str, body: Value) -> (u16, Value) {
    let body = body.to_string();
    let mut stream = TcpStream::connect(addr).await.unwrap();
    stream.write_all(format!("{method} {path} HTTP/1.1\r\nHost: {addr}\r\nConnection: close\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{body}", body.len()).as_bytes()).await.unwrap();
    let mut response = Vec::new();
    tokio::time::timeout(Duration::from_secs(5), stream.read_to_end(&mut response))
        .await
        .unwrap()
        .unwrap();
    let response = String::from_utf8(response).unwrap();
    let (head, body) = response.split_once("\r\n\r\n").unwrap();
    (
        head.split_whitespace().nth(1).unwrap().parse().unwrap(),
        serde_json::from_str(body).unwrap(),
    )
}
fn config(addr: SocketAddr) -> Config {
    let mut config = Config::default();
    config.real.path = "mock:serial-settings".into();
    config.clients.clear();
    config.api.bind = addr.to_string();
    config.api.can_control = true;
    config.log.mirror_console = false;
    config
}
fn settings() -> Value {
    json!({"baud": 57600, "databits": 8, "parity": "none", "stopbits": 1, "flow": "none"})
}

#[tokio::test]
async fn settings_require_control_permission_and_valid_parameters() {
    let addr = address().await;
    let mut config = config(addr);
    config.api.can_control = false;
    config.api.can_read = false;
    let handle = hub::run_hub(config).await.unwrap();
    for path in ["/v1/serial/settings", "/v1/serial/ports"] {
        assert_eq!(request(addr, "GET", path, Value::Null).await.0, 403);
    }
    assert_eq!(
        request(
            addr,
            "POST",
            "/v1/serial/settings",
            json!({"settings": settings()})
        )
        .await
        .0,
        403
    );
    handle.shutdown_gracefully().await;
}

#[tokio::test]
async fn mock_does_not_falsely_confirm_physical_configuration() {
    let addr = address().await;
    let handle = hub::run_hub(config(addr)).await.unwrap();
    tokio::time::sleep(Duration::from_millis(50)).await;
    let original = request(addr, "GET", "/v1/serial/settings", Value::Null)
        .await
        .1;
    assert!(original["settings"]["baud"].is_u64());
    let invalid = json!({"settings": {"baud": 0, "databits": 8, "parity": "none", "stopbits": 1, "flow": "none"}});
    assert_eq!(
        request(addr, "POST", "/v1/serial/settings", invalid)
            .await
            .0,
        400
    );
    assert_eq!(
        request(
            addr,
            "POST",
            "/v1/serial/settings",
            json!({"settings": settings()})
        )
        .await
        .0,
        403
    );
    let lock = request(
        addr,
        "POST",
        "/v1/lock",
        json!({"as_client": "settings-test"}),
    )
    .await
    .1;
    let response = request(addr, "POST", "/v1/serial/settings", json!({"settings": settings(), "as_client": "settings-test", "lease_token": lock["lock"]["lease_token"]})).await;
    assert_eq!(response.0, 503);
    assert!(response.1["error"].as_str().unwrap().contains("mock"));
    assert_eq!(
        request(addr, "GET", "/v1/serial/settings", Value::Null)
            .await
            .1,
        original
    );
    assert_eq!(
        request(addr, "GET", "/v1/serial/ports", Value::Null)
            .await
            .0,
        200
    );
    handle.shutdown_gracefully().await;
}

// Darwin PTYs reject the IOSSIOSPEED ioctl used by serialport for nonzero
// baud rates; they cannot stand in for a physical macOS serial adapter here.
// Linux PTYs expose the kernel baud settings through the second descriptor.
#[cfg(target_os = "linux")]
#[tokio::test]
async fn real_owner_applies_and_reports_runtime_baud_on_a_pseudoterminal() {
    use serialport::SerialPort;
    let (_master, slave) = serialport::TTYPort::pair().unwrap();
    let addr = address().await;
    let mut config = config(addr);
    config.real.path = slave.name().unwrap();
    let handle = hub::run_hub(config).await.unwrap();
    for _ in 0..50 {
        if handle.broker.snapshot().port.connected {
            break;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    assert!(handle.broker.snapshot().port.connected);
    let lock = request(
        addr,
        "POST",
        "/v1/lock",
        json!({"as_client": "settings-test"}),
    )
    .await
    .1;
    let response = request(addr, "POST", "/v1/serial/settings", json!({"settings": settings(), "as_client": "settings-test", "lease_token": lock["lock"]["lease_token"]})).await;
    assert_eq!(response.0, 200, "{response:?}");
    let reported = request(addr, "GET", "/v1/serial/settings", Value::Null)
        .await
        .1;
    assert_eq!(reported["settings"], settings());
    assert_eq!(handle.broker.snapshot().port.baud, 57600);
    assert_eq!(slave.baud_rate().unwrap(), 57600);
    handle.shutdown_gracefully().await;
}

#[tokio::test]
async fn live_stream_acknowledges_mode_and_excludes_preconnection_history() {
    use futures_util::StreamExt;
    use tokio_tungstenite::{connect_async, tungstenite::Message};
    let addr = address().await;
    let handle = hub::run_hub(config(addr)).await.unwrap();
    handle
        .broker
        .on_device_rx(bytes::Bytes::from_static(b"old-history"));
    let (mut socket, _) = connect_async(format!("ws://{addr}/v1/stream?live=true"))
        .await
        .unwrap();
    let info = socket.next().await.unwrap().unwrap();
    assert!(info.to_text().unwrap().contains("\"live_only\":true"));
    handle
        .broker
        .on_device_rx(bytes::Bytes::from_static(b"live-only"));
    let packet = tokio::time::timeout(Duration::from_secs(2), socket.next())
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    assert_eq!(packet, Message::Binary(b"live-only".to_vec().into()));
    socket.close(None).await.unwrap();
    handle.shutdown_gracefully().await;
}
