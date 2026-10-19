//! Real HTTP/WS gateway tests with independent mock UART owners.
use futures_util::StreamExt;
use serde_json::{json, Value};
use serialhub::desktop::Desktop;
use std::{net::SocketAddr, time::Duration};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpStream,
};
use tokio_tungstenite::{
    connect_async,
    tungstenite::{client::IntoClientRequest, Message},
};

async fn request(
    address: SocketAddr,
    method: &str,
    path: &str,
    body: Value,
    extra: &str,
) -> (u16, String, Value) {
    let mut stream = TcpStream::connect(address).await.unwrap();
    let body = body.to_string();
    stream.write_all(format!("{method} {path} HTTP/1.1\r\nHost: {address}\r\nContent-Type: application/json\r\nConnection: close\r\nContent-Length: {}\r\n{extra}\r\n{body}",body.len()).as_bytes()).await.unwrap();
    let mut bytes = Vec::new();
    tokio::time::timeout(Duration::from_secs(5), stream.read_to_end(&mut bytes))
        .await
        .unwrap()
        .unwrap();
    let raw = String::from_utf8(bytes).unwrap();
    let (headers, body) = raw.split_once("\r\n\r\n").unwrap();
    (
        headers.split_whitespace().nth(1).unwrap().parse().unwrap(),
        headers.into(),
        serde_json::from_str(body).unwrap_or(Value::Null),
    )
}
async fn open(address: SocketAddr, path: &str) -> String {
    let result = request(address,"POST","/manager/sessions",json!({"path":path,"settings":{"baud":115200,"databits":8,"parity":"none","stopbits":1,"flow":"none"}}),"").await;
    assert_eq!(result.0, 201, "{result:?}");
    result.2["id"].as_str().unwrap().into()
}
async fn binary<S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin>(
    socket: &mut tokio_tungstenite::WebSocketStream<S>,
) -> Vec<u8> {
    tokio::time::timeout(Duration::from_secs(3), async {
        loop {
            match socket.next().await {
                Some(Ok(Message::Binary(bytes))) => return bytes.to_vec(),
                Some(Ok(_)) => {}
                other => panic!("stream ended: {other:?}"),
            }
        }
    })
    .await
    .unwrap()
}
#[tokio::test]
async fn concurrent_sessions_isolate_bytes_leases_and_close_without_stopping_others() {
    let desktop = Desktop::start("127.0.0.1:0".parse().unwrap())
        .await
        .unwrap();
    let address = desktop.address();
    assert_eq!(
        request(address, "GET", "/manager/info", Value::Null, "")
            .await
            .2["sessions"],
        json!([])
    );
    let a = open(address, "mock:board-a").await;
    let b = open(address, "mock:board-b").await;
    let duplicate = request(address,"POST","/manager/sessions",json!({"path":"mock:board-a","settings":{"baud":115200,"databits":8,"parity":"none","stopbits":1,"flow":"none"}}),"").await;
    assert_eq!(duplicate.0, 409);
    let (mut a1, _) = connect_async(format!("ws://{address}/sessions/{a}/v1/stream?live=true"))
        .await
        .unwrap();
    let (mut a2, _) = connect_async(format!("ws://{address}/sessions/{a}/v1/stream?live=true"))
        .await
        .unwrap();
    let (mut b1, _) = connect_async(format!("ws://{address}/sessions/{b}/v1/stream?live=true"))
        .await
        .unwrap();
    let lock_a = request(
        address,
        "POST",
        &format!("/sessions/{a}/v1/lock"),
        json!({"as_client":"test-a"}),
        "",
    )
    .await
    .2;
    let lock_b = request(
        address,
        "POST",
        &format!("/sessions/{b}/v1/lock"),
        json!({"as_client":"test-b"}),
        "",
    )
    .await
    .2;
    let token_a = &lock_a["lock"]["lease_token"];
    let token_b = &lock_b["lock"]["lease_token"];
    assert!(token_a.is_string() && token_b.is_string());
    let denied = request(
        address,
        "POST",
        &format!("/sessions/{b}/v1/write"),
        json!({"text":"wrong-device","lease_token":token_a}),
        "",
    )
    .await;
    assert_eq!(denied.2["ok"], false);
    let path_a = format!("/sessions/{a}/v1/write");
    let path_b = format!("/sessions/{b}/v1/write");
    let (write_a, write_b) = tokio::join!(
        request(
            address,
            "POST",
            &path_a,
            json!({"text":"alpha","lease_token":token_a}),
            ""
        ),
        request(
            address,
            "POST",
            &path_b,
            json!({"text":"beta","lease_token":token_b}),
            ""
        )
    );
    assert_eq!(write_a.2["ok"], true);
    assert_eq!(write_b.2["ok"], true);
    assert_eq!(binary(&mut a1).await, b"alpha\n");
    assert_eq!(binary(&mut a2).await, b"alpha\n");
    assert_eq!(binary(&mut b1).await, b"beta\n");
    assert_eq!(
        request(
            address,
            "DELETE",
            &format!("/manager/sessions/{a}"),
            Value::Null,
            ""
        )
        .await
        .0,
        200
    );
    assert_eq!(
        request(
            address,
            "GET",
            &format!("/sessions/{a}/v1/status"),
            Value::Null,
            ""
        )
        .await
        .0,
        404
    );
    assert_eq!(
        request(
            address,
            "GET",
            &format!("/sessions/{b}/v1/status"),
            Value::Null,
            ""
        )
        .await
        .2["port"]["connected"],
        true
    );
    // Removing a hub cancels its upgraded sockets, including multiple subscribers.
    for socket in [&mut a1, &mut a2] {
        tokio::time::timeout(Duration::from_secs(2), async {
            while let Some(Ok(message)) = socket.next().await {
                if matches!(message, Message::Close(_)) {
                    break;
                }
            }
        })
        .await
        .unwrap();
    }
    let reopened = open(address, "mock:board-a").await;
    assert_ne!(reopened, a);
    desktop.shutdown().await;
}
#[tokio::test]
async fn lan_pairing_is_required_revocable_and_cannot_change_host_settings() {
    let desktop = Desktop::start("127.0.0.1:0".parse().unwrap())
        .await
        .unwrap();
    let address = desktop.address();
    let id = open(address, "mock:lan").await;
    assert_eq!(
        request(
            address,
            "POST",
            "/manager/lan",
            json!({}),
            "Origin: http://evil.example\r\n"
        )
        .await
        .0,
        403
    );
    assert_eq!(
        request(address, "POST", "/manager/lan", json!({}), "")
            .await
            .0,
        200
    );
    let info = request(address, "GET", "/manager/info", Value::Null, "")
        .await
        .2;
    let port = info["lan"]["port"].as_u64().unwrap() as u16;
    let code = info["lan"]["pair_url"]
        .as_str()
        .unwrap()
        .split("#pair=")
        .nth(1)
        .unwrap();
    let lan = SocketAddr::from(([127, 0, 0, 1], port));
    assert_eq!(
        request(lan, "GET", "/manager/info", Value::Null, "")
            .await
            .0,
        401
    );
    assert_eq!(
        request(lan, "POST", "/manager/pair", json!({"code":"wrong"}), "")
            .await
            .0,
        401
    );
    let paired = request(lan, "POST", "/manager/pair", json!({"code":code}), "").await;
    assert_eq!(paired.0, 200);
    assert!(paired.1.contains("HttpOnly; SameSite=Strict"));
    let cookie = format!("Cookie: serialhub_pair_{port}={code}\r\n");
    let remote_info = request(lan, "GET", "/manager/info", Value::Null, &cookie)
        .await
        .2;
    assert_eq!(remote_info["local"], false);
    assert_eq!(remote_info["lan"], Value::Null);
    for path in ["/manager/lan", "/manager/quit"] {
        assert_eq!(request(lan, "POST", path, json!({}), &cookie).await.0, 403);
    }
    let mut req = format!("ws://{lan}/sessions/{id}/v1/stream")
        .into_client_request()
        .unwrap();
    req.headers_mut().insert(
        "cookie",
        format!("serialhub_pair_{port}={code}").parse().unwrap(),
    );
    let (mut socket, _) = connect_async(req).await.unwrap();
    assert_eq!(
        request(address, "DELETE", "/manager/lan", Value::Null, "")
            .await
            .0,
        200
    );
    tokio::time::timeout(Duration::from_secs(2), async {
        while let Some(Ok(message)) = socket.next().await {
            if matches!(message, Message::Close(_)) {
                break;
            }
        }
    })
    .await
    .unwrap();
    assert_eq!(
        request(
            address,
            "GET",
            &format!("/sessions/{id}/v1/status"),
            Value::Null,
            ""
        )
        .await
        .2["port"]["connected"],
        true
    );
    assert_eq!(
        request(address, "POST", "/manager/lan", json!({}), "")
            .await
            .0,
        200
    );
    let next = request(address, "GET", "/manager/info", Value::Null, "")
        .await
        .2;
    assert_ne!(info["lan"]["pair_url"], next["lan"]["pair_url"]);
    let next_lan = SocketAddr::from(([127, 0, 0, 1], next["lan"]["port"].as_u64().unwrap() as u16));
    assert_eq!(
        request(next_lan, "GET", "/manager/info", Value::Null, &cookie)
            .await
            .0,
        401
    );
    desktop.shutdown().await;
}
#[tokio::test]
async fn busy_default_port_falls_back_and_unsafe_binds_are_rejected() {
    let occupied = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let original = occupied.local_addr().unwrap();
    let desktop = Desktop::start(original).await.unwrap();
    assert_ne!(desktop.address(), original);
    assert_eq!(
        request(desktop.address(), "GET", "/manager/info", Value::Null, "")
            .await
            .2["product"],
        "serialhub.desktop.v1"
    );
    assert!(Desktop::start("0.0.0.0:0".parse().unwrap()).await.is_err());
    desktop.shutdown().await;
}

#[tokio::test]
async fn failed_endpoint_startup_does_not_reserve_device_and_session_count_is_bounded() {
    let desktop = Desktop::start("127.0.0.1:0".parse().unwrap())
        .await
        .unwrap();
    let address = desktop.address();
    let occupied = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = occupied.local_addr().unwrap().port();
    let body = json!({"path":"mock:rollback","settings":{"baud":115200,"databits":8,"parity":"none","stopbits":1,"flow":"none"}, "tcp_port":port});
    assert_eq!(
        request(address, "POST", "/manager/sessions", body, "")
            .await
            .0,
        400
    );
    assert_eq!(
        request(address, "GET", "/manager/info", Value::Null, "")
            .await
            .2["sessions"],
        json!([])
    );
    open(address, "mock:rollback").await;
    for index in 1..16 {
        open(address, &format!("mock:bounded-{index}")).await;
    }
    let overflow = request(address,"POST","/manager/sessions",json!({"path":"mock:overflow","settings":{"baud":115200,"databits":8,"parity":"none","stopbits":1,"flow":"none"}}),"").await;
    assert_eq!(overflow.0, 409);
    assert_eq!(
        request(address, "GET", "/manager/info", Value::Null, "")
            .await
            .2["sessions"]
            .as_array()
            .unwrap()
            .len(),
        16
    );
    desktop.shutdown().await;
}

#[tokio::test]
async fn repeated_launch_rediscovers_existing_manager_without_touching_its_devices() {
    let desktop = Desktop::start("127.0.0.1:0".parse().unwrap())
        .await
        .unwrap();
    let address = desktop.address();
    let id = open(address, "mock:rediscovery").await;
    assert!(serialhub::desktop::existing_manager(address).await);
    let result = tokio::process::Command::new(env!("CARGO_BIN_EXE_serialhub"))
        .args(["desktop", "--bind", &address.to_string(), "--no-browser"])
        .output()
        .await
        .unwrap();
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
    assert!(String::from_utf8_lossy(&result.stderr).contains("already running"));
    assert_eq!(
        request(
            address,
            "GET",
            &format!("/sessions/{id}/v1/status"),
            Value::Null,
            ""
        )
        .await
        .2["port"]["connected"],
        true
    );
    desktop.shutdown().await;
}

#[tokio::test]
async fn gui_configured_tcp_really_reads_writes_and_fans_out_to_multiple_clients() {
    let desktop = Desktop::start("127.0.0.1:0".parse().unwrap())
        .await
        .unwrap();
    let address = desktop.address();
    let temporary = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let tcp_address = temporary.local_addr().unwrap();
    drop(temporary);
    let result = request(address,"POST","/manager/sessions",json!({"path":"mock:tcp","settings":{"baud":115200,"databits":8,"parity":"none","stopbits":1,"flow":"none"},"tcp_port":tcp_address.port()}),"").await;
    assert_eq!(result.0, 201, "{result:?}");
    let id = result.2["id"].as_str().unwrap();
    let mut first = TcpStream::connect(tcp_address).await.unwrap();
    let mut second = TcpStream::connect(tcp_address).await.unwrap();
    // Wait for actual registration, rather than relying on scheduling sleeps.
    for _ in 0..100 {
        let status = request(
            address,
            "GET",
            &format!("/sessions/{id}/v1/status"),
            Value::Null,
            "",
        )
        .await
        .2;
        if status["clients"].as_array().unwrap().len() == 2 {
            break;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    first.write_all(b"shared-tcp\n").await.unwrap();
    for client in [&mut first, &mut second] {
        let mut bytes = [0u8; 11];
        tokio::time::timeout(Duration::from_secs(2), client.read_exact(&mut bytes))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(&bytes, b"shared-tcp\n");
    }
    let endpoints = request(
        address,
        "GET",
        &format!("/sessions/{id}/v1/endpoints"),
        Value::Null,
        "",
    )
    .await
    .2;
    assert!(endpoints["endpoints"]
        .as_array()
        .unwrap()
        .iter()
        .any(|e| e["kind"] == "tcp" && e["can_read"] == true && e["can_write"] == true));
    desktop.shutdown().await;
}
