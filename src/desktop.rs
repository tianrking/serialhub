//! Zero-configuration device manager. Each session owns a complete isolated Hub;
//! the gateway mounts its API without opening per-device HTTP listeners.
use crate::{
    broker::EndpointView,
    client::{session_router, static_handler, ApiState},
    config::{Config, SerialSettings},
    hub::{run_hub, HubHandle},
    workflow::{WorkflowLimits, WorkflowRunner},
};
use axum::{
    extract::{Path, Request, State},
    http::{header, StatusCode, Uri},
    middleware::{self, Next},
    response::{
        sse::{Event, KeepAlive, Sse},
        IntoResponse, Response,
    },
    routing::{any, get, post},
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    collections::BTreeMap,
    net::{IpAddr, Ipv4Addr, SocketAddr},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;
use tower::ServiceExt;

#[derive(Clone)]
struct Manager {
    inner: Arc<Mutex<Inner>>,
    stopped: CancellationToken,
    instance: String,
    control: Arc<DesktopControl>,
}
/// Shared state is read by the native event loop; HTTP is never run on that thread.
#[derive(Default)]
pub struct DesktopControl {
    pub background: AtomicBool,
    pub tray: AtomicBool,
    pub locale: parking_lot::RwLock<String>,
    pub log: parking_lot::RwLock<Option<std::path::PathBuf>>,
}
struct Inner {
    sessions: BTreeMap<String, Session>,
    lan: Option<Lan>,
    closing: bool,
}
struct Session {
    name: String,
    device_key: String,
    hub: Option<HubHandle>,
    api: ApiState,
    router: Router,
    cancel: CancellationToken,
    lan_router: Option<(Router, CancellationToken)>,
}
struct Lan {
    address: SocketAddr,
    secret: String,
    cancel: CancellationToken,
    task: tokio::task::JoinHandle<()>,
    url: String,
}
#[derive(Clone)]
struct Gate {
    manager: Manager,
    address: SocketAddr,
    secret: Option<String>,
}

/// Best-effort rediscovery for repeated desktop launches. Only a bounded,
/// loopback, read-only identity request is made; unrelated services fall through.
pub async fn existing_manager(address: SocketAddr) -> bool {
    if !address.ip().is_loopback() || address.port() == 0 {
        return false;
    }
    tokio::time::timeout(std::time::Duration::from_millis(500), async {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let mut stream = tokio::net::TcpStream::connect(address).await.ok()?;
        stream.write_all(format!("GET /manager/identity HTTP/1.1\r\nHost: {address}\r\nConnection: close\r\n\r\n").as_bytes()).await.ok()?;
        let mut bytes = Vec::new();
        stream.take(4096).read_to_end(&mut bytes).await.ok()?;
        let response = std::str::from_utf8(&bytes).ok()?;
        let (head, body) = response.split_once("\r\n\r\n")?;
        if head.split_whitespace().nth(1) != Some("200") { return None; }
        let value: Value = serde_json::from_str(body).ok()?;
        (value["product"] == "serialhub.desktop.v1").then_some(())
    }).await.is_ok_and(|result| result.is_some())
}

pub struct Desktop {
    address: SocketAddr,
    manager: Manager,
    task: tokio::task::JoinHandle<()>,
}
impl Desktop {
    pub async fn start(bind: SocketAddr) -> anyhow::Result<Self> {
        Self::listen(bind, true).await
    }
    /// Service deployments must fail on a busy port rather than move silently.
    pub async fn start_fixed(bind: SocketAddr) -> anyhow::Result<Self> {
        Self::listen(bind, false).await
    }
    async fn listen(bind: SocketAddr, fallback: bool) -> anyhow::Result<Self> {
        anyhow::ensure!(
            bind.ip().is_loopback(),
            "Desktop binds to loopback; enable LAN sharing in the device manager"
        );
        let listener = match tokio::net::TcpListener::bind(bind).await {
            Ok(listener) => listener,
            Err(e) if fallback && e.kind() == std::io::ErrorKind::AddrInUse => {
                // An unrelated service must never prevent a double-click launch.
                tokio::net::TcpListener::bind(SocketAddr::new(bind.ip(), 0)).await?
            }
            Err(e) => return Err(e.into()),
        };
        let address = listener.local_addr()?;
        let manager = Manager {
            inner: Arc::new(Mutex::new(Inner {
                sessions: BTreeMap::new(),
                lan: None,
                closing: false,
            })),
            stopped: CancellationToken::new(),
            instance: uuid::Uuid::new_v4().to_string(),
            control: Arc::new(DesktopControl::default()),
        };
        let gate = Gate {
            manager: manager.clone(),
            address,
            secret: None,
        };
        let app = app(gate);
        let stop = manager.stopped.clone();
        let task = tokio::spawn(async move {
            if let Err(error) = axum::serve(listener, app)
                .with_graceful_shutdown(stop.cancelled_owned())
                .await
            {
                tracing::error!("device manager: {error}");
            }
        });
        Ok(Self {
            address,
            manager,
            task,
        })
    }
    pub fn instance(&self) -> &str {
        &self.manager.instance
    }
    pub fn control(&self) -> Arc<DesktopControl> {
        self.manager.control.clone()
    }
    pub fn stop_token(&self) -> CancellationToken {
        self.manager.stopped.clone()
    }
    pub fn address(&self) -> SocketAddr {
        self.address
    }
    pub async fn stopped(&self) {
        self.manager.stopped.cancelled().await;
    }
    pub async fn shutdown(self) {
        self.manager.stopped.cancel();
        let mut inner = self.manager.inner.lock().await;
        inner.closing = true;
        if let Some(lan) = inner.lan.take() {
            lan.cancel.cancel();
            lan.task.abort();
        }
        let sessions = std::mem::take(&mut inner.sessions);
        drop(inner);
        for (_, mut session) in sessions {
            session.cancel.cancel();
            if let Some((_, cancel)) = &session.lan_router {
                cancel.cancel();
            }
            if let Some(hub) = session.hub.take() {
                hub.shutdown_gracefully().await;
            }
        }
        let _ = self.task.await;
    }
}
impl Drop for Session {
    fn drop(&mut self) {
        self.cancel.cancel();
        if let Some((_, cancel)) = &self.lan_router {
            cancel.cancel();
        }
    }
}

fn app(gate: Gate) -> Router {
    Router::new()
        .route("/manager/identity", get(identity))
        .route("/manager/lifecycle", get(lifecycle))
        .route("/manager/app/locale", post(app_locale))
        .route("/manager/app/logs", post(app_logs))
        .route("/manager/info", get(info))
        .route("/manager/ports", get(ports))
        .route("/manager/sessions", post(open_session))
        .route(
            "/manager/sessions/{id}",
            axum::routing::delete(close_session),
        )
        .route("/manager/lan", post(enable_lan).delete(disable_lan))
        .route("/manager/pair", post(pair))
        .route("/manager/quit", post(quit))
        .route("/sessions/{id}/{*rest}", any(dispatch))
        .fallback(static_handler)
        .layer(middleware::from_fn_with_state(gate.clone(), guard))
        .with_state(gate)
}
fn error(code: StatusCode, message: impl ToString) -> Response {
    (code, Json(json!({"error": message.to_string()}))).into_response()
}
fn same_secret(a: &str, b: &str) -> bool {
    a.len() == b.len()
        && a.bytes()
            .zip(b.bytes())
            .fold(0u8, |acc, (a, b)| acc | (a ^ b))
            == 0
}
fn authenticated(request: &Request, expected: &str, port: u16) -> bool {
    let cookie_name = format!("serialhub_pair_{port}=");
    let bearer = request
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "));
    let cookie = request
        .headers()
        .get(header::COOKIE)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| {
            v.split(';')
                .find_map(|s| s.trim().strip_prefix(&cookie_name))
        });
    let ws = request
        .headers()
        .get(header::SEC_WEBSOCKET_PROTOCOL)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("bearer, "));
    [bearer, cookie, ws]
        .into_iter()
        .flatten()
        .any(|v| same_secret(v, expected))
}
async fn guard(State(gate): State<Gate>, request: Request, next: Next) -> Response {
    let hosts: Vec<_> = request.headers().get_all(header::HOST).iter().collect();
    let authority = if hosts.len() == 1 {
        hosts[0]
            .to_str()
            .ok()
            .and_then(|s| s.parse::<axum::http::uri::Authority>().ok())
    } else {
        None
    };
    let Some(authority) = authority else {
        return error(StatusCode::FORBIDDEN, "Invalid Host");
    };
    let hostname = authority
        .host()
        .trim_start_matches('[')
        .trim_end_matches(']');
    let host_ok = if gate.secret.is_none() {
        hostname.eq_ignore_ascii_case("localhost")
            || hostname.parse::<IpAddr>().is_ok_and(|ip| ip.is_loopback())
    } else {
        hostname
            .parse::<Ipv4Addr>()
            .is_ok_and(|ip| !ip.is_unspecified() && !ip.is_multicast() && !ip.is_broadcast())
    };
    if !host_ok || authority.port_u16().unwrap_or(80) != gate.address.port() {
        return error(StatusCode::FORBIDDEN, "Host is not allowed");
    }
    if let Some(origin) = request.headers().get(header::ORIGIN) {
        if origin.to_str().ok() != Some(format!("http://{authority}").as_str()) {
            return error(StatusCode::FORBIDDEN, "Origin is not allowed");
        }
    }
    let path = request.uri().path();
    // A shared link may be opened from another website. Static navigation is
    // public; cross-site requests to the device/control APIs remain forbidden.
    if (path.starts_with("/manager/") || path.starts_with("/sessions/"))
        && request
            .headers()
            .get("sec-fetch-site")
            .is_some_and(|v| v == "cross-site")
    {
        return error(StatusCode::FORBIDDEN, "Cross-site request is not allowed");
    }
    if let Some(secret) = &gate.secret {
        let inner = gate.manager.inner.lock().await;
        if !inner
            .lan
            .as_ref()
            .is_some_and(|lan| same_secret(&lan.secret, secret))
        {
            return error(StatusCode::FORBIDDEN, "LAN sharing has been disabled");
        }
        drop(inner);
        if (path.starts_with("/manager/") || path.starts_with("/sessions/"))
            && path != "/manager/pair"
            && !authenticated(&request, secret, gate.address.port())
        {
            return error(
                StatusCode::UNAUTHORIZED,
                "Pair this browser using the link from the device host",
            );
        }
    }
    if gate.manager.stopped.is_cancelled()
        && (path.starts_with("/sessions/")
            || (request.method() != axum::http::Method::GET && path != "/manager/quit"))
    {
        return error(StatusCode::SERVICE_UNAVAILABLE, "SerialHub is stopping");
    }
    let mut response = next.run(request).await;
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, "no-store".parse().unwrap());
    response
        .headers_mut()
        .insert(header::REFERRER_POLICY, "no-referrer".parse().unwrap());
    response
        .headers_mut()
        .insert(header::X_CONTENT_TYPE_OPTIONS, "nosniff".parse().unwrap());
    response.headers_mut().insert(
        "content-security-policy",
        "frame-ancestors 'none'".parse().unwrap(),
    );
    response
}
async fn identity(State(gate): State<Gate>) -> Json<Value> {
    Json(
        json!({"product":"serialhub.desktop.v1", "version":env!("CARGO_PKG_VERSION"), "instance":gate.manager.instance,"stopping":gate.manager.stopped.is_cancelled()}),
    )
}
async fn lifecycle(
    State(gate): State<Gate>,
) -> Sse<impl futures_util::Stream<Item = Result<Event, std::convert::Infallible>>> {
    use futures_util::StreamExt;
    let stop = gate.manager.stopped.clone();
    let revoked = if let Some(secret) = &gate.secret {
        gate.manager
            .inner
            .lock()
            .await
            .lan
            .as_ref()
            .filter(|lan| same_secret(&lan.secret, secret))
            .map(|lan| lan.cancel.clone())
            .unwrap_or_else(|| {
                let token = CancellationToken::new();
                token.cancel();
                token
            })
    } else {
        CancellationToken::new()
    };
    let initial =
        futures_util::stream::once(async { Ok(Event::default().event("ready").data("running")) });
    let stopping = futures_util::stream::once(async move {
        Ok(tokio::select! {
            ()=stop.cancelled()=>Event::default().event("stopping").data("stopped"),
            ()=revoked.cancelled()=>Event::default().event("revoked").data("revoked"),
        })
    });
    Sse::new(initial.chain(stopping)).keep_alive(KeepAlive::default())
}
async fn app_locale(State(gate): State<Gate>, Json(body): Json<Value>) -> Response {
    if gate.secret.is_some() {
        return error(
            StatusCode::FORBIDDEN,
            "Change app settings on the device host",
        );
    }
    let Some(locale) = body["locale"]
        .as_str()
        .filter(|s| ["en", "zh-Hant", "zh-Hans", "es", "fr", "ar"].contains(s))
    else {
        return error(StatusCode::BAD_REQUEST, "Unsupported interface language");
    };
    *gate.manager.control.locale.write() = locale.to_owned();
    Json(json!({"ok":true})).into_response()
}
async fn app_logs(State(gate): State<Gate>) -> Response {
    if gate.secret.is_some() {
        return error(StatusCode::FORBIDDEN, "Open diagnostics on the device host");
    }
    let path = gate.manager.control.log.read().clone();
    let Some(path) = path else {
        return error(
            StatusCode::CONFLICT,
            "Diagnostics are available from the desktop launcher",
        );
    };
    match tokio::task::spawn_blocking(move || opener::open(path)).await {
        Ok(Ok(())) => Json(json!({"ok":true})).into_response(),
        e => error(
            StatusCode::SERVICE_UNAVAILABLE,
            format!("Could not open diagnostics: {e:?}"),
        ),
    }
}
async fn info(State(gate): State<Gate>) -> Json<Value> {
    let inner = gate.manager.inner.lock().await;
    let sessions: Vec<_> = inner.sessions.iter().map(|(id,s)| {
        let snapshot = s.hub.as_ref().expect("live session").broker.snapshot();
        json!({"id": id, "name": s.name, "path": snapshot.port.path, "baud":snapshot.port.baud, "connected":snapshot.port.connected, "detail":snapshot.port.detail, "clients":snapshot.clients.len(), "rx_bytes":snapshot.stats.rx_bytes,"tx_bytes":snapshot.stats.tx_bytes})
    }).collect();
    Json(
        json!({"product":"serialhub.desktop.v1", "version":env!("CARGO_PKG_VERSION"), "local":gate.secret.is_none(), "app": {"background":gate.manager.control.background.load(Ordering::Relaxed),"tray":gate.manager.control.tray.load(Ordering::Relaxed)}, "limit":null, "supports_pty":cfg!(unix), "sessions":sessions,
        "lan": if gate.secret.is_none() { inner.lan.as_ref().map(|lan| json!({"url":lan.url, "pair_url":format!("{}#pair={}",lan.url,lan.secret),"port":lan.address.port()})) } else {None}}),
    )
}
async fn ports() -> Response {
    match tokio::task::spawn_blocking(serialport::available_ports).await {
        Ok(Ok(ports)) => Json(json!({"ports":ports.into_iter().map(|p| json!({"path":p.port_name,"kind":format!("{:?}",p.port_type)})).collect::<Vec<_>>()})).into_response(),
        e => error(StatusCode::SERVICE_UNAVAILABLE, format!("Port scan failed: {e:?}")),
    }
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct OpenSession {
    path: String,
    name: Option<String>,
    settings: SerialSettings,
    tcp_port: Option<u16>,
    #[serde(default)]
    pty_count: u8,
}
fn device_key(path: &str) -> anyhow::Result<String> {
    anyhow::ensure!(
        !path.is_empty() && path.len() <= 256 && !path.chars().any(char::is_control),
        "Invalid device path"
    );
    if path.starts_with("mock:") {
        return Ok(path.to_owned());
    }
    #[cfg(windows)]
    {
        let normalized = path.trim_start_matches("\\\\.\\").to_ascii_uppercase();
        anyhow::ensure!(
            normalized
                .strip_prefix("COM")
                .is_some_and(|n| !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit())),
            "Select a COM port"
        );
        Ok(normalized)
    }
    #[cfg(not(windows))]
    {
        anyhow::ensure!(path.starts_with("/dev/"), "Select a device under /dev");
        let canonical = std::fs::canonicalize(path)?;
        anyhow::ensure!(
            canonical.starts_with("/dev"),
            "Device must resolve under /dev"
        );
        // macOS callout and dial-in paths name the same UART.
        Ok(canonical.to_string_lossy().replace("/dev/cu.", "/dev/tty."))
    }
}
async fn open_session(State(gate): State<Gate>, Json(body): Json<OpenSession>) -> Response {
    let key = match device_key(body.path.trim()) {
        Ok(key) => key,
        Err(e) => return error(StatusCode::BAD_REQUEST, e),
    };
    if let Err(e) = body.settings.validate() {
        return error(StatusCode::BAD_REQUEST, e);
    }
    let name = body.name.unwrap_or_else(|| body.path.clone());
    if name.trim().is_empty() || name.len() > 256 || name.chars().any(char::is_control) {
        return error(
            StatusCode::BAD_REQUEST,
            "Session name must contain 1–256 printable bytes",
        );
    }
    let mut inner = gate.manager.inner.lock().await;
    if inner.closing {
        return error(StatusCode::SERVICE_UNAVAILABLE, "Manager is stopping");
    }
    if inner.sessions.values().any(|s| s.device_key == key) {
        return error(
            StatusCode::CONFLICT,
            "This device already has a session; open its workspace to share it",
        );
    }
    if body.pty_count > 4 || (!cfg!(unix) && body.pty_count > 0) {
        return error(
            StatusCode::BAD_REQUEST,
            "Choose 0–4 PTYs on macOS/Linux; Windows uses TCP or WebSocket",
        );
    }
    if body.tcp_port == Some(0) {
        return error(
            StatusCode::BAD_REQUEST,
            "TCP port must be between 1 and 65535",
        );
    }
    let id = uuid::Uuid::new_v4().to_string();
    let mut cfg = Config::default();
    cfg.real.path = body.path.trim().into();
    cfg.real.baud = body.settings.baud;
    cfg.real.databits = body.settings.databits;
    cfg.real.parity = body.settings.parity;
    cfg.real.stopbits = body.settings.stopbits;
    cfg.real.flow = body.settings.flow;
    cfg.clients.clear();
    cfg.api.enabled = false;
    cfg.api.can_control = true;
    cfg.log.mirror_console = false;
    cfg.fanout.pty_count = u32::from(body.pty_count);
    cfg.fanout.pty_name_prefix = "v".into();
    cfg.fanout.pty_can_read = true;
    cfg.fanout.pty_can_write = true;
    cfg.fanout.tcp_name_prefix = "tcp".into();
    cfg.fanout.tcp_can_read = true;
    cfg.fanout.tcp_can_write = true;
    cfg.fanout.pty_link_prefix = std::env::temp_dir()
        .join(format!("serialhub-{id}-v"))
        .to_string_lossy()
        .into_owned();
    if let Some(port) = body.tcp_port {
        cfg.fanout.tcp_count = 1;
        cfg.fanout.tcp_host = "127.0.0.1".into();
        cfg.fanout.tcp_base_port = port;
    }
    if let Err(e) = cfg.expand_fanout() {
        return error(StatusCode::BAD_REQUEST, e);
    }

    let hub = match run_hub(cfg).await {
        Ok(hub) => hub,
        Err(e) => return error(StatusCode::BAD_REQUEST, e),
    };
    let api = ApiState {
        broker: hub.broker.clone(),
        workflow_runner: WorkflowRunner::new(WorkflowLimits::default())
            .expect("default workflow limits"),
        default_writer: "api".into(),
        ws_writer: "api".into(),
        history_on_ws_connect: 65536,
        bearer_token: None,
        cors_origins: vec![],
        can_read: true,
        can_write: true,
        can_control: true,
        ws_can_read: true,
        ws_can_write: true,
    };
    let cancel = gate.manager.stopped.child_token();
    let router = session_router(api.clone(), cancel.clone());
    let lan_router = inner.lan.as_ref().map(|lan| {
        let cancel = lan.cancel.child_token();
        (session_router(api.clone(), cancel.clone()), cancel)
    });
    let mut endpoints = hub.broker.snapshot().endpoints;
    endpoints.push(EndpointView {
        kind: "websocket".into(),
        name: "workspace".into(),
        address: format!("/sessions/{id}/v1/stream"),
        can_read: true,
        can_write: true,
        note: "Same-origin WebSocket; many clients share one device owner".into(),
    });
    hub.broker.set_endpoints(endpoints);
    inner.sessions.insert(
        id.clone(),
        Session {
            name,
            device_key: key,
            hub: Some(hub),
            api,
            router,
            cancel,
            lan_router,
        },
    );
    (StatusCode::CREATED, Json(json!({"id":id}))).into_response()
}
async fn close_session(State(gate): State<Gate>, Path(id): Path<String>) -> Response {
    let mut inner = gate.manager.inner.lock().await;
    let Some(mut session) = inner.sessions.remove(&id) else {
        return error(StatusCode::NOT_FOUND, "Session no longer exists");
    };
    session.cancel.cancel();
    if let Some((_, cancel)) = &session.lan_router {
        cancel.cancel();
    }
    // Keep ownership reserved until the old UART owner has fully stopped.
    session
        .hub
        .take()
        .expect("live session")
        .shutdown_gracefully()
        .await;
    Json(json!({"ok":true})).into_response()
}
async fn dispatch(
    State(gate): State<Gate>,
    Path((id, _)): Path<(String, String)>,
    mut request: Request,
) -> Response {
    let inner = gate.manager.inner.lock().await;
    let Some(session) = inner.sessions.get(&id) else {
        return error(StatusCode::NOT_FOUND, "Session no longer exists");
    };
    let router = if gate.secret.is_none() {
        session.router.clone()
    } else if let Some((router, _)) = &session.lan_router {
        router.clone()
    } else {
        return error(StatusCode::FORBIDDEN, "LAN sharing is disabled");
    };
    drop(inner);
    let prefix = format!("/sessions/{id}");
    let path = request
        .uri()
        .path_and_query()
        .unwrap()
        .as_str()
        .strip_prefix(&prefix)
        .unwrap();
    *request.uri_mut() = path
        .parse::<Uri>()
        .expect("stripped URI retains valid path");
    router
        .oneshot(request)
        .await
        .unwrap_or_else(|never| match never {})
}
async fn pair(State(gate): State<Gate>, Json(body): Json<Value>) -> Response {
    let Some(secret) = &gate.secret else {
        return error(
            StatusCode::BAD_REQUEST,
            "Pairing is only used on the LAN address",
        );
    };
    if !body
        .get("code")
        .and_then(Value::as_str)
        .is_some_and(|code| same_secret(code, secret))
    {
        return error(StatusCode::UNAUTHORIZED, "Invalid pairing link");
    }
    let mut response = Json(json!({"ok":true})).into_response();
    response.headers_mut().insert(
        header::SET_COOKIE,
        format!(
            "serialhub_pair_{}={secret}; HttpOnly; SameSite=Strict; Path=/",
            gate.address.port()
        )
        .parse()
        .unwrap(),
    );
    response
}
async fn enable_lan(State(gate): State<Gate>) -> Response {
    if gate.secret.is_some() {
        return error(
            StatusCode::FORBIDDEN,
            "LAN settings are managed on the device host",
        );
    }
    let mut inner = gate.manager.inner.lock().await;
    if inner.closing {
        return error(StatusCode::SERVICE_UNAVAILABLE, "Manager is stopping");
    }
    if inner.lan.is_some() {
        return Json(json!({"ok":true})).into_response();
    }
    let listener = match tokio::net::TcpListener::bind("0.0.0.0:0").await {
        Ok(l) => l,
        Err(e) => return error(StatusCode::SERVICE_UNAVAILABLE, e),
    };
    let address = listener.local_addr().unwrap();
    let secret = format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    );
    let cancel = gate.manager.stopped.child_token();
    for session in inner.sessions.values_mut() {
        let child = cancel.child_token();
        session.lan_router = Some((session_router(session.api.clone(), child.clone()), child));
    }
    let ip = primary_ip().unwrap_or(Ipv4Addr::LOCALHOST);
    let url = format!("http://{ip}:{}/", address.port());
    let app = app(Gate {
        manager: gate.manager.clone(),
        address,
        secret: Some(secret.clone()),
    });
    let stop = cancel.clone();
    let task = tokio::spawn(async move {
        if let Err(e) = axum::serve(listener, app)
            .with_graceful_shutdown(stop.cancelled_owned())
            .await
        {
            tracing::error!("LAN server: {e}");
        }
    });
    inner.lan = Some(Lan {
        address,
        secret,
        cancel,
        task,
        url,
    });
    Json(json!({"ok":true})).into_response()
}
fn primary_ip() -> Option<Ipv4Addr> {
    // UDP connect selects an interface; no packet is sent to this documentation IP.
    let socket = std::net::UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("192.0.2.1:9").ok()?;
    match socket.local_addr().ok()?.ip() {
        IpAddr::V4(ip) if !ip.is_unspecified() => Some(ip),
        _ => None,
    }
}
async fn disable_lan(State(gate): State<Gate>) -> Response {
    if gate.secret.is_some() {
        return error(
            StatusCode::FORBIDDEN,
            "LAN settings are managed on the device host",
        );
    }
    let mut inner = gate.manager.inner.lock().await;
    if let Some(lan) = inner.lan.take() {
        lan.cancel.cancel();
        lan.task.abort();
    }
    for session in inner.sessions.values_mut() {
        session.lan_router.take();
    }
    Json(json!({"ok":true})).into_response()
}
async fn quit(State(gate): State<Gate>) -> Response {
    if gate.secret.is_some() {
        return error(StatusCode::FORBIDDEN, "Quit on the device host");
    }
    gate.manager.stopped.cancel();
    Json(json!({"ok":true})).into_response()
}
