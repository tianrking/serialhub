# SerialHub

The web workspace defaults to English and supports Traditional Chinese, Spanish,
French and Arabic with RTL, plus the existing Simplified Chinese interface.
See [localization and deployment controls](./I18N.md).

<p align="center">
  <img alt="serialhub" src="https://img.shields.io/badge/serialhub-serial%20hub-0ea5e9?style=for-the-badge&logo=rust&logoColor=white" />
</p>

<p align="center">
  <strong>Cross-platform open-source serial hub for humans and agents</strong><br/>
  <em>One real UART · Many safe clients · Zero silent TX fights</em>
</p>

<p align="center">
  <a href="./README.md"><img alt="English" src="https://img.shields.io/badge/lang-English-blue?style=flat-square" /></a>
  <a href="./README.zh-CN.md"><img alt="简体中文" src="https://img.shields.io/badge/lang-简体中文-red?style=flat-square" /></a>
  <a href="./README.es.md"><img alt="Español" src="https://img.shields.io/badge/lang-Español-green?style=flat-square" /></a>
</p>

<p align="center">
  <b>Languages:</b>
  <a href="./README.md">English</a> ·
  <a href="./README.zh-CN.md">简体中文</a> ·
  <a href="./README.es.md">Español</a>
</p>

<p align="center">
  <a href="https://github.com/tianrking/serialhub/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/tianrking/serialhub/ci.yml?branch=main&style=flat-square&label=CI" /></a>
  <a href="./LICENSE"><img alt="License" src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" /></a>
  <a href="https://www.rust-lang.org/"><img alt="Rust" src="https://img.shields.io/badge/rust-edition%202021-orange?style=flat-square&logo=rust" /></a>
  <img alt="Platforms" src="https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-lightgrey?style=flat-square" />
  <a href="https://github.com/tianrking/serialhub/releases/tag/v0.2.3"><img alt="Version" src="https://img.shields.io/badge/version-v0.2.3-0ea5e9?style=flat-square" /></a>
  <img alt="Status" src="https://img.shields.io/badge/status-active-22c55e?style=flat-square" />
  <a href="https://github.com/tianrking/serialhub/releases"><img alt="Release" src="https://img.shields.io/badge/release-watch%20releases-0ea5e9?style=flat-square" /></a>
  <a href="https://github.com/tianrking/serialhub"><img alt="GitHub" src="https://img.shields.io/badge/github-tianrking%2Fserialhub-181717?style=flat-square&logo=github" /></a>
</p>

<p align="center">
  <img alt="serial" src="https://img.shields.io/badge/serial-UART%20%2F%20COM%20%2F%20tty-0ea5e9?style=flat-square" />
  <img alt="hub" src="https://img.shields.io/badge/hub-mux%20%2F%20share-8b5cf6?style=flat-square" />
  <img alt="websocket" src="https://img.shields.io/badge/API-HTTP%20%2B%20WebSocket-06b6d4?style=flat-square" />
  <img alt="agent" src="https://img.shields.io/badge/AI-agent%20friendly-f59e0b?style=flat-square" />
  <img alt="embedded" src="https://img.shields.io/badge/domain-embedded%20debug-64748b?style=flat-square" />
  <img alt="tokio" src="https://img.shields.io/badge/async-tokio-c026d3?style=flat-square" />
  <img alt="axum" src="https://img.shields.io/badge/web-axum-7c3aed?style=flat-square" />
  <img alt="pty" src="https://img.shields.io/badge/Unix-PTY-14b8a6?style=flat-square" />
  <img alt="tcp" src="https://img.shields.io/badge/stream-TCP-3b82f6?style=flat-square" />
  <img alt="toml" src="https://img.shields.io/badge/config-TOML-e11d48?style=flat-square" />
</p>

---

## Table of contents

- [What is SerialHub?](#what-is-serialhub)
- [Problem & solution](#problem--solution)
- [Features](#features)
- [How it works](#how-it-works)
- [Platform support](#platform-support)
- [Install & build](#install--build)
- [Quick start](#quick-start)
- [How to use (scenarios)](#how-to-use-scenarios)
- [Configuration](#configuration)
- [CLI reference](#cli-reference)
- [HTTP & WebSocket API](#http--websocket-api)
- [Event ledger & safe replay](#event-ledger--safe-replay)
- [TX policies](#tx-policies)
- [Unix PTY](#unix-pty-macos--linux)
- [Windows notes](#windows-notes)
- [Security](#security)
- [Migration](./MIGRATION.md)
- [Project structure](#project-structure)
- [Development](#development)
- [Current release scope](#current-release-scope)
- [FAQ](#faq)
- [Contributing](#contributing)
- [License](#license)
- [Tech tags](#tech-tags)

---

## What is SerialHub?

**SerialHub** is a small, open-source **serial port sharing hub** written in Rust.

It:

1. Opens the **real serial device** once (exclusive ownership)
2. **Fans out RX** (device → host) to many clients
3. **Arbitrates TX** (host → device) so concurrent writers do not silently corrupt frames
4. Exposes clients as **TCP**, **HTTP/WebSocket** (agent-first), and **PTY** (macOS/Linux host tools)

Ideal for embedded debug when **a human terminal and an AI agent/script must share one UART**.

| Item | Value |
|------|--------|
| Binary name | `serialhub` |
| Repository | [github.com/tianrking/serialhub](https://github.com/tianrking/serialhub) |
| Language | Rust (edition 2021) |
| License | MIT |
| Default docs | **English** · [中文](./README.zh-CN.md) · [Español](./README.es.md) |
| Architecture deep-dive | [`POSITIONING.md`](./POSITIONING.md) |
| Current release | [v0.2.3](https://github.com/tianrking/serialhub/releases/tag/v0.2.3) |

> **Renamed from ohmyserial.** `serialhub` is the canonical command and
> package name. The 0.x release keeps a compatibility executable; versioned
> event schemas, metric names, and saved browser settings remain stable. See
> [MIGRATION.md](./MIGRATION.md) before upgrading automation.

---

## Start without a terminal

Download your platform archive from [Releases](https://github.com/tianrking/serialhub/releases/latest), extract it, and launch:

| Platform | Open |
| --- | --- |
| Windows x64 / ARM64 | `serialhub-desktop.exe` (no console window) |
| macOS Intel / Apple Silicon | `SerialHub.app` |
| Linux x64 / ARM64 | `serialhub-desktop` (file manager: **Run as program**) |

The launcher opens your browser automatically. Choose a detected port, set its parameters,
and click **Open workspace**. Use **Try demo** for a mock loopback without hardware.
The CLI binary also opens the manager when run without arguments; all existing commands remain available.
No Rust, Node.js, Python, browser extension or cloud account is needed to use the downloaded app.
Unsigned downloads can require OS confirmation; Linux files must be executable. Hardware drivers
and serial-port permissions still belong to the device host.

Open more ports from **All devices**. Up to 16 independent sessions run concurrently;
switching tabs preserves live browser connections and drafts. Closing a browser does not
close hardware sessions; use **Close session** or **Quit SerialHub** explicitly.

**Enable LAN sharing** on the host and copy its pairing link to another browser on your trusted
IPv4 LAN. The paired browser can manage sessions and use the same tools. Disabling sharing
revokes the link and disconnects remote streams while local sessions continue. LAN sharing is
opt-in, uses HTTP, and gives link holders device access. Allow the app through the host firewall;
on multi-interface hosts, replace the link's IP with the appropriate host IPv4 address.

Each device has one physical owner, its own broker, write lease, event ledger and signal workspace.
Many browsers share a session's HTTP/WebSocket API. **External tools (optional)** can add a loopback
TCP listener, or up to four Unix PTYs per session; the workspace **Connections** tab lists them.
TCP ports must be unused. Windows programs requiring a virtual COM device still need a separately
installed COM driver/bridge; the browser workflow needs none.

See [DESKTOP.md](./DESKTOP.md) for architecture, API routes, tests and operating limits.

---

## Problem & solution

### The problem

| Goal | Reality |
|------|---------|
| Keep a serial monitor open | Port is busy |
| Let an agent/script read the same log | Second open fails |
| Let both send commands | Bytes interleave → broken protocol |

### The solution

```text
Device (UART/COM)
        │
        ▼
   ┌──────────┐
   │ serialhub│  ← only process that opens the real port
   └────┬─────┘
        │
   ┌────┴─────────────────────────────┐
   ▼                ▼                 ▼
  PTY            TCP stream      HTTP + WebSocket
 (host UI)       (scripts)         (agents)
```

---

## Features

The embedded workspace includes binary file TX, bounded raw RX recording, ordered multi-command sending, GBK/UTF-8 tools, runtime line settings, and configuration migration. See the [SSCOM 5.13 capability matrix and remaining gaps](./SSCOM_PARITY.zh-CN.md) and [operating guide](./OPERATIONS.md).

Signal Studio adds multichannel scopes, cursors and software triggers, FFT/XY/waterfall analysis, meters, Euler attitude, raw pixel frames, configurable parameter controls, and bounded CSV replay. See the [VOFA+ capability matrix and analysis contracts](./VOFA_PARITY.zh-CN.md).

### Functional features

| Feature | Description | Status |
|---------|-------------|--------|
| Exclusive real port | Single owner of hardware UART | ✅ |
| Port parameters | baud, data bits, parity, stop bits, flow control | ✅ |
| RX fan-out | All readable clients receive device data | ✅ |
| TX arbitration | Line/frame queue, exclusive, primary preference | ✅ |
| Write-lock lease | Time-bounded TX ownership | ✅ |
| Auto reconnect | Optional reopen after disconnect | ✅ |
| TCP client | Raw bidirectional byte stream | ✅ |
| HTTP API | health / status / endpoints / events / workflows / write / control / handoff / lock | ✅ |
| WebSocket stream | Live RX (+ optional history on connect) | ✅ |
| Unix PTY | Symlinked virtual serial for classic tools | ✅ (macOS/Linux) |
| Session log | Console + file; text / hex / hex+text | ✅ |
| Web serial console | Profiles, line endings, quick commands, timed send, checksums, protocol parsing, waveform, evidence filters/export, metrics, control lines | ✅ |
| Event ledger | Versioned RX/TX/connection/control/gap evidence; bounded memory + optional hashed NDJSON | ✅ |
| Safe replay | Verified, read-only `immediate` / `original` / `manual` replay | ✅ |
| Config preflight | `serialhub check -c profile.toml` validates TOML and safe endpoint policy without opening a serial device | ✅ |
| Mock port | `mock:demo` loopback without hardware | ✅ |
| TOML config + CLI | `share` / `run` / `check` / `init` / `list-ports` / `status` / `supervise` | ✅ |
| Multi-port single process | Multiple independent real profiles with collision checks | ✅ |
| RFC2217 | Telnet serial control over network | ✅ |
| Windows COM bridge | `bridge-com` + existing com0com/virtual-COM pair | ✅ |
| Native Windows virtual COM | Kernel/driver-level COM clone | External signed driver |

### Technical features

| Area | Stack / design |
|------|----------------|
| Runtime | Tokio async |
| HTTP/WS | Axum |
| Serial I/O | `serialport` + dedicated reader thread |
| Config | Serde + TOML |
| Logging | `tracing` + session blog |
| Evidence | Canonical v1 ledger + SHA-256-chained NDJSON segments |
| Replay | Verified envelopes only; isolated from the live broker and serial writer |
| Unix PTY | `nix` openpty + symlink |
| Tests | Unit + integration (mock hub) |
| CI | GitHub Actions: Ubuntu · macOS · Windows |

---

## How it works

### Data plane

```text
Device ──RX──► Serial Core ──► Broker.broadcast ──► clients
Client ──TX──► Broker.admit(policy/lock) ──► Serial Core ──► Device
```

### Control plane

- `GET /v1/status` — connected?, baud, clients, lock owner, counters  
- `POST /v1/lock` / `DELETE /v1/lock` — write lease  
- `POST /v1/write` — inject TX as a named client  

### Architecture modules

```text
CLI / Config
    └── Hub supervisor
            ├── Serial core (open, reconnect, mock)
            ├── Broker (registry, fan-out, TX queue)
            ├── Policy (queue_by_line / exclusive / …)
            ├── Clients: PTY · TCP · HTTP/WS
            ├── Ledger (ordered evidence, bounded ring, optional segments)
            ├── Replay (verified, read-only, offline)
            └── Observe (human log, tracing)
```

---

## Platform support

| Capability | macOS | Linux / Ubuntu | Windows |
|------------|:-----:|:--------------:|:-------:|
| Real serial (`/dev/cu.*`, `/dev/ttyUSB*`, `COM3`) | ✅ | ✅ | ✅ |
| TCP raw stream | ✅ | ✅ | ✅ |
| HTTP + WebSocket API | ✅ | ✅ | ✅ |
| PTY virtual serial | ✅ | ✅ | — |
| Mock loopback | ✅ | ✅ | ✅ |
| Architectures | arm64 / x64 | x64 / arm64 | x64 / arm64 |

**Ubuntu tip:** install `build-essential pkg-config libudev-dev` before building.

**Windows tip:** apps that only list COM ports need TCP/WS or an external COM bridge; PTY is Unix-only.

For COM-only legacy software, use the built-in user-mode bridge with an
existing signed virtual-COM provider such as com0com:

```powershell
serialhub.exe share COM3 --tcp 1 --tcp-raw --tcp-base 8788
serialhub.exe bridge-com COM13 --tcp 127.0.0.1:8788 --baud 115200
```

The complete pair setup and security boundary are documented in
[`WINDOWS_COM_BRIDGE.md`](./WINDOWS_COM_BRIDGE.md). The bridge forwards bytes;
it does not install or replace a Windows kernel driver.

---

## Install & build

### Prebuilt binaries

Download from [GitHub Releases](https://github.com/tianrking/serialhub/releases):

| Platform | Artifact |
|----------|----------|
| Linux x86_64 | `…-x86_64-unknown-linux-gnu.tar.gz` |
| Linux arm64 | `…-aarch64-unknown-linux-gnu.tar.gz` |
| macOS Apple Silicon | `…-aarch64-apple-darwin.tar.gz` |
| macOS Intel | `…-x86_64-apple-darwin.tar.gz` |
| Windows x64 | `…-x86_64-pc-windows-msvc.zip` |
| Windows ARM64 | `…-aarch64-pc-windows-msvc.zip` |

```bash
# example (Linux/macOS)
tar -xzf serialhub-<tag>-<target>.tar.gz
./serialhub-<tag>-<target>/serialhub share mock:demo --ui
```

### Requirements (from source)

- [Rust](https://rustup.rs/) stable  
- **Ubuntu/Debian:** `build-essential pkg-config libudev-dev`  
- **macOS:** Xcode CLT · **Windows:** MSVC via rustup  

### Build from source

```bash
git clone https://github.com/tianrking/serialhub.git
cd serialhub
./scripts/build-all.sh   # web + cargo release
# or: cargo build --release   # uses committed web/dist
```

| OS | Binary |
|----|--------|
| Unix | `./target/release/serialhub` |
| Windows | `.\target\release\serialhub.exe` |

### Verify

```bash
cargo test
./target/release/serialhub --help
./target/release/serialhub share mock:demo --ui
```

The complete release gate and hardware-in-the-loop boundary are documented in
[`RELIABILITY_TEST_MATRIX.md`](./RELIABILITY_TEST_MATRIX.md).

### CI matrix

GitHub Actions builds & tests on:

- Linux x64 / arm64  
- macOS arm64 / x64  
- Windows x64 / arm64  

Tagged releases (`v*`) publish archives automatically.

---

## Quick start (easiest)

**No config file needed** — use `share`:

```bash
# 1) see ports
./target/release/serialhub list-ports

# 2) share one (macOS/Linux: 2 virtual serials by default + TCP + WebSocket)
./target/release/serialhub share /dev/cu.usbmodem14101 --baud 115200

# more virtual serials for more serial GUIs
./target/release/serialhub share /dev/ttyUSB0 --pty 3 --tcp 1

# Windows (no PTY): multi TCP + multi WS clients
./target/release/serialhub share COM3 --tcp 2

# no hardware (demo)
./target/release/serialhub share mock:demo
```

On start, serialhub prints a **connect card**, e.g.:

```text
SERIAL  /tmp/serialhub-v0     ← open in serial app #1
SERIAL  /tmp/serialhub-v1     ← open in serial app #2
TCP     127.0.0.1:8788         ← nc / scripts (many clients OK)
WS      ws://127.0.0.1:8787/v1/stream
HTTP    http://127.0.0.1:8787
```

### Flags people use most

| Flag | Meaning | Default |
|------|---------|---------|
| `--pty N` | N virtual serial ports (Unix) | `2` on macOS/Linux, `0` on Windows |
| `--tcp N` | N TCP ports | `1` |
| `--tcp-raw` | atomic TCP reads for binary bridge/protocol clients | off |
| `--tcp-base P` | first TCP port | `8788` |
| `--api ADDR` | HTTP/WS bind | `127.0.0.1:8787` |
| `-b/--baud` | baud rate | `115200` |
| `--data-bits N` | data bits (5/6/7/8) | `8` |
| `--parity VALUE` | none/odd/even | `none` |
| `--stop-bits N` | stop bits (1/2) | `1` |
| `--flow-control VALUE` | none/software/hardware | `none` |
| `--quiet` | disable console session-log mirror | off |
| `--ui` | open the embedded web console | off |

### Optional: config file

```bash
./target/release/serialhub init -o serialhub.toml
./target/release/serialhub run -c serialhub.toml
./target/release/serialhub supervise -c board-a.toml -c board-b.toml
# overrides without editing file:
./target/release/serialhub run -c serialhub.toml -d /dev/ttyUSB0 --pty 3
```

---

## How to use (scenarios)

### Core idea: one real port → many parallel endpoints

```text
                 ┌─ PTY /tmp/serialhub-v0  → serial GUI #1
                 ├─ PTY /tmp/serialhub-v1  → serial GUI #2  (or agent via serial lib)
 Real UART ──► hub ┼─ TCP :8788            → many nc/scripts at once
                 ├─ TCP :8789            → more tools
                 └─ WS  /v1/stream        → many agents at once
```

All endpoints receive the **same live RX**. TX is shared under policy/lock so writers do not silently interleave.

Configure bulk expansion with **`[fanout]`** (see below), or list individual `[[clients]]`.

Discover live endpoints:

```bash
curl -s http://127.0.0.1:8787/v1/endpoints | jq .
```

### Scenario A — Multiple host programs + agent

```toml
[fanout]
pty_count = 2                 # macOS/Linux virtual serials
pty_link_prefix = "/tmp/serialhub-v"
tcp_count = 1
tcp_base_port = 8788

[api]
bind = "127.0.0.1:8787"
```

- Open `/tmp/serialhub-v0` and `/tmp/serialhub-v1` in two serial apps
- Agent connects to `ws://127.0.0.1:8787/v1/stream` (many agents OK)  
- Scripts: `nc 127.0.0.1 8788` (many connections OK)

### Scenario B — Scripts / CI only

`[fanout] tcp_count = 2` + API; skip PTY. Use `nc`, Python, or CI against `8787`/`8788`/`8789`.

### Scenario C — Demo without hardware

Keep `path = "mock:demo"`. Writes loop back as RX (great for tests).

### Scenario D — Agent-only write with lock

```bash
LEASE_TOKEN="$(curl -s -X POST http://127.0.0.1:8787/v1/lock \
  -H 'content-type: application/json' \
  -d '{"as_client":"agent"}' | jq -r '.lock.lease_token')"

curl -s -X POST http://127.0.0.1:8787/v1/write \
  -H 'content-type: application/json' \
  -d "{\"text\":\"AT\",\"newline\":true,\"as_client\":\"agent\",\"lease_token\":\"$LEASE_TOKEN\"}"

# Renew the same lease before its TTL expires.
curl -s -X POST http://127.0.0.1:8787/v1/lock \
  -H 'content-type: application/json' \
  -d "{\"lease_token\":\"$LEASE_TOKEN\"}"

curl -s -X DELETE http://127.0.0.1:8787/v1/lock \
  -H 'content-type: application/json' \
  -d "{\"lease_token\":\"$LEASE_TOKEN\"}"
```

`as_client` is an audit/display name, not a credential. Keep the opaque lease token secret; a client using the same name cannot impersonate the lease holder.

---

## Configuration

Example file: [`serialhub.example.toml`](./serialhub.example.toml)

```bash
serialhub init -o serialhub.toml
serialhub check -c serialhub.toml  # no port is opened
serialhub run -c serialhub.toml
```

### Bulk fan-out `[fanout]`

| Field | Effect |
|-------|--------|
| `pty_count` | N Unix virtual serials (`{prefix}0` …) for multiple serial GUIs |
| `tcp_count` + `tcp_base_port` | N TCP listeners; **each** accepts many concurrent clients |
| `tcp_raw` | Preserve each TCP read as an atomic TX unit for binary bridges |
| `ws_binds` | Extra HTTP/WS servers (primary `[api]` already multi-client) |

```toml
[real]
path = "mock:demo"          # or /dev/ttyUSB0, COM3, …
# Optional exact USB identity (re-resolved before every open/reconnect):
# usb = { vid = 0x10c4, pid = 0xea60, serial_number = "board-01" }
baud = 115200
databits = 8
parity = "none"
stopbits = 1
flow = "none"
reconnect = true

[tx]
mode = "queue_by_line"
write_lock_ms = 3000
write_timeout_ms = 5000
max_frame_bytes = 65536
max_write_bytes = 65536
primary = "ui"
slow_client = "drop_oldest"
client_queue = 256
slow_block_ms = 1000

[api]
bind = "127.0.0.1:8787"
enabled = true
can_read = true
can_write = true
# Physical DTR/RTS/BREAK control; every request still needs a write lease.
can_control = false
# token_env = "SERIALHUB_API_TOKEN"
# cors_origins = ["https://serial-console.example.com"]

[fanout]
pty_count = 0               # set 2+ on macOS/Linux for multi serial GUI
pty_link_prefix = "/tmp/serialhub-v"
tcp_count = 2
tcp_host = "127.0.0.1"
tcp_base_port = 8788
# ws_binds = ["127.0.0.1:8790"]

# Optional explicit endpoints (merged with fanout):
# [[clients]]
# type = "pty"
# name = "ui"
# link = "/tmp/serialhub-ui"

[ledger]
memory_events = 16384
memory_bytes = 33554432
stream_capacity = 1024
# directory = "./serialhub-ledger"  # opt in to hashed NDJSON persistence
rotate_bytes = 67108864
fsync_each_event = false

[log]
mirror_console = true
format = "hex+text"
```

| Field | Meaning |
|-------|---------|
| `real.path` | Device path or `mock:name` |
| `real.usb` | Exact USB VID/PID selector with optional serial-number disambiguation; zero or ambiguous matches stay disconnected |
| `tx.mode` | Concurrent write policy |
| `tx.write_timeout_ms` | End-to-end queue + confirmed host-write deadline |
| `tx.max_frame_bytes` / `max_write_bytes` | Bounds buffered stream frames and atomic writes |
| `tx.slow_client` / `client_queue` / `slow_block_ms` | Per-reader RX backpressure policy and bounds |
| `fanout.*` | Auto-create many parallel endpoints |
| `api.bind` | HTTP/WS; plaintext listeners are restricted to loopback |
| `api.token_env` | Name of the environment variable containing the API bearer secret |
| `api.cors_origins` | Exact browser origins; empty means same-origin only, and `*` is rejected |
| `api.can_control` | Opt-in DTR/RTS/BREAK and handoff capability; requests still need a write lease |
| `ledger.memory_events` / `memory_bytes` | Always-on bounded event evidence ring |
| `ledger.directory` | Optional append-only hashed NDJSON persistence root |
| `ledger.stream_capacity` / `rotate_bytes` | Live event subscriber bound / sealed segment size target |
| `ledger.fsync_each_event` | Force each event through the OS storage cache; safer but slower |
| `clients[]` | Explicit endpoints (optional) |

---

## CLI reference

```bash
serialhub share <device> [serial/endpoint flags]  # zero-config hub
serialhub run -c serialhub.toml    # start hub
serialhub check -c serialhub.toml  # validate profile without opening a serial port
serialhub supervise -c board-a.toml -c board-b.toml  # multiple real ports
serialhub init [-o file]           # sample config to stdout/file
serialhub list-ports               # list serial devices
serialhub status [--api URL]       # GET /v1/status
serialhub bridge-com COM13 --tcp 127.0.0.1:8788  # existing COM pair -> TCP
serialhub replay <source>          # verify and emit a sealed ledger capture
serialhub replay <source> --mode original --speed 2
serialhub replay <source> --mode manual --step 10
```

```bash
RUST_LOG=debug serialhub run -c serialhub.toml
```

---

## HTTP & WebSocket API

**Base:** `http://127.0.0.1:8787` (default)

In the CLI/TOML deployment mode, the plaintext API and dedicated WebSocket listeners are loopback-only. If `api.token_env` is configured, every `/v1/*` route except `/v1/health` requires `Authorization: Bearer <token>`. The secret is read from that environment variable and must not be placed in TOML or URLs. A token does not make cleartext `http://` or `ws://` safe on a network, so non-loopback binds are rejected even when a token exists. Use an SSH tunnel, or place a TLS reverse proxy in front of the loopback listener.

The desktop manager has a separate opt-in, paired LAN listener; it does not change the CLI/TOML bind policy.

Browser access is same-origin by default. Requests must also carry a Host authority valid for the actual loopback listener, which blocks DNS-rebinding aliases. `api.cors_origins` enables only the exact listed origins; wildcard CORS is rejected. WebSocket upgrades independently require a same-host or listed `Origin`. A browser supplies its bearer as `new WebSocket(url, ["bearer", token])`; query-string tokens are not supported. Non-browser clients may omit `Origin`, but still need the bearer when authentication is enabled.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/v1/health` | Liveness JSON |
| `GET` | `/v1/status` | Port, endpoints, clients, lock, stats |
| `GET` | `/v1/endpoints` | Configured fan-out endpoints catalog |
| `GET` | `/v1/clients` | Connected client list |
| `GET` | `/v1/events/status` | Ledger session, ring, persistence, and recovery status |
| `GET` | `/v1/events` | Cursor query with type/epoch/actor/byte filters |
| `GET` | `/v1/events/export` | Canonical event NDJSON export |
| `GET` | `/v1/metrics` | Prometheus text metrics (read permission applies) |
| `POST` | `/v1/workflows/run` | Bounded linear lease/send/expect workflow |
| `POST` | `/v1/write` | Send text or hex to device |
| `POST` | `/v1/control` | DTR/RTS/BREAK; requires `can_control` and a lease token |
| `POST` | `/v1/handoff` | Close the real handle for a bounded external maintenance window |
| `POST` | `/v1/handoff/resume` | Resume the owner with the one-time handoff token |
| `POST` | `/v1/lock` | Acquire write lock |
| `DELETE` | `/v1/lock` | Release write lock |
| `WS` | `/v1/stream` | Live RX stream |
| `WS` | `/v1/events/stream` | Read-only JSON event envelopes: snapshot then live |

### Write

```bash
# text (newline appended by default)
curl -s -X POST http://127.0.0.1:8787/v1/write \
  -H 'content-type: application/json' \
  -d '{"text":"AT","newline":true,"as_client":"agent"}'

# hex
curl -s -X POST http://127.0.0.1:8787/v1/write \
  -H 'content-type: application/json' \
  -d '{"hex":"41 54 0d 0a","as_client":"agent"}'
```

Add `--tcp-raw` to `share` when the TCP endpoint feeds binary protocols or
`bridge-com`; it bypasses line/frame delimiter assembly and preserves each TCP
read as one bounded atomic TX unit.

HTTP text and hex writes are one atomic command, independent of delimiter framing. `ok: true` means the serial-owner thread completed the host-side `write_all` and `flush`; it does **not** mean the device parsed or acknowledged the command. Queue admission and that acknowledgement share the `tx.write_timeout_ms` deadline. If an error says the outcome may be partial or unknown, do not blindly retry—the driver may have written some or all bytes before reporting failure or timing out.

When a write lease is active, include its `lease_token` in the request. Acquire it with `POST /v1/lock`, renew it by posting the token to the same route, and release it with `DELETE /v1/lock`. The token is returned only on acquire/renew and is never included in status output.

Physical control lines are opt-in with `api.can_control = true`. Call
`POST /v1/control` with `{ "op": "dtr", "level": true, "lease_token": "…" }`,
`rts`, or `{ "op": "break", "duration_ms": 25, "lease_token": "…" }`.
The serial-owner thread performs the OS operation and acknowledges it; mock
mode rejects these operations because it has no physical lines. RTS is rejected
when `real.flow = "hardware"` to avoid fighting the driver's flow-control state.

For tools that must open the physical device themselves, use the bounded
handoff protocol in [`HANDOFF.md`](./HANDOFF.md). It drains queued writes,
releases the OS handle before acknowledging, invalidates the old lease, and
auto-resumes at the TTL if the external tool fails to call `/resume`. The
handoff token never enters status or the event ledger.

### WebSocket

```text
ws://127.0.0.1:8787/v1/stream
```

- Server → client: binary RX (history may be sent first)  
- Client → server text: newline-completed stream TX (framed by the configured policy)
- Client → server binary: one atomic TX command, bounded by `tx.max_write_bytes`

Denied WebSocket writes receive a JSON text error frame (`type = "ohmyserial.error"`). WebSocket admission is not a device-write acknowledgement; use `POST /v1/write` when the caller must wait for the host write + flush result.

### TCP

```bash
nc 127.0.0.1 8788
```

Raw TCP has no API bearer handshake. Keep it bound to loopback and use an SSH tunnel for remote access:

```bash
ssh -L 8788:127.0.0.1:8788 user@device-host
nc 127.0.0.1 8788
```

### Minimal Python agent

```python
import json, urllib.request

req = urllib.request.Request(
    "http://127.0.0.1:8787/v1/write",
    data=json.dumps({"text": "status", "newline": True}).encode(),
    headers={"content-type": "application/json"},
    method="POST",
)
print(urllib.request.urlopen(req).read().decode())
```

---

## Event ledger & safe replay

Every run has an ordered v1 evidence stream covering byte-exact RX observed by the process, host-confirmed TX, connection generations, control actions, and explicit uncertainty gaps. The bounded memory ring is always active; setting `ledger.directory` adds rotated, SHA-256-chained NDJSON segments, conservative crash recovery, and complete disk-backed query/export.

```bash
# Query canonical events after an exclusive sequence cursor.
curl -s 'http://127.0.0.1:8787/v1/events?after_seq=0&limit=100&type=rx,tx'

# Replay a sealed segment or a directory containing exactly one session.
serialhub replay ./one-session-directory --mode original --speed 2
```

The raw `/v1/stream` WebSocket carries bidirectional serial bytes. `/v1/events/stream` is separate: it emits read-only JSON text envelopes and supports cursor/filter catch-up. Replay verifies sealed input and only prints the original envelopes; it never opens a device or sends recorded TX back into the live broker.

Segment hashes detect corruption and broken chains, but they are not signatures or proof of origin. There is no automatic retention deletion. RX evidence begins when the process successfully reads bytes; loss in hardware or a driver before that point may be unknowable. Host-side TX `write_all` + `flush` is not a device acknowledgement. Mock tests are not hardware-in-the-loop tests.

See [`EVENTS.md`](./EVENTS.md) for the complete envelope, event types, gap semantics, storage/recovery model, API pagination and WebSocket recovery flow, and replay safety contract. See [`WORKFLOWS.md`](./WORKFLOWS.md) for the bounded workflow DSL and evidence cursor rules.

---

## TX policies

| Mode | Behavior | Typical use |
|------|----------|-------------|
| `queue_by_line` **(default)** | Wait for `\n`, then send whole line | Text / AT / CLI |
| `queue_by_frame` | Wait for delimiter byte | Simple binary frames |
| `exclusive` | TX only with active write lock | Flash / critical ops |
| `primary_wins` | Prefer `tx.primary` client | Human-in-the-loop |

While a **write lease** is active, only a request carrying its random `lease_token` may TX. The owner string is for display/audit only. A lease ends on TTL expiry or token-authenticated release; disconnecting a same-named HTTP, WebSocket, TCP, or PTY client does not release it.

Every readable client has a bounded RX queue (`client_queue`, in chunks):

| `slow_client` | Queue-full behavior |
|---------------|---------------------|
| `drop_oldest` **(default)** | Evict that client's oldest pending RX chunk and enqueue the new chunk |
| `drop_newest` | Keep queued data and discard the new chunk for that client |
| `disconnect_slow` | Disconnect the slow client immediately |
| `block` | Wait up to `slow_block_ms`; disconnect if capacity is still unavailable |

`queue_by_line` / `queue_by_frame` buffering is capped by `max_frame_bytes`; atomic HTTP/WS-binary writes are capped by `max_write_bytes`. Writes admitted while connected carry a connection epoch and are revalidated immediately before the host write. Disconnect/reconnect changes the epoch, so stale queued bytes are rejected instead of replayed into a new device session.

Configuration and listener binds are validated during startup. A bind failure fails the hub startup and tears down already-started tasks. Shutdown closes client fan-out, stops the serial owner, and rejects/drains queued writes rather than leaving detached workers.

---

## Unix PTY (macOS / Linux)

```toml
[[clients]]
type = "pty"
name = "ui"
link = "/tmp/serialhub-ui"
can_write = true
can_read = true
```

Open `/tmp/serialhub-ui` in minicom, screen, Serial Studio, etc.

> Real baud/framing is owned by the hub `[real]` section. Some apps may fail PTY baud ioctls; the data path still works.

---

## Windows notes

| Need | Use |
|------|-----|
| Agent / automation | HTTP + WebSocket ✅ |
| Simple stream | TCP `127.0.0.1:8788` ✅ |
| Hardware | `path = "COM3"` ✅ |
| COM-only legacy UI | `bridge-com` with an installed provider such as com0com |
| `type = "pty"` | Not supported (config rejected) |

---

## Security

- Default binds are **localhost only** (`127.0.0.1`)  
- Serial TX can reset boards / send dangerous commands — treat as privileged  
- CLI/TOML plaintext listeners are loopback-only; use SSH/TLS for remote deployments. Desktop mode additionally supports opt-in paired IPv4 LAN HTTP/WS; see [DESKTOP.md](./DESKTOP.md)
- Human logs, event segments, and exports may contain secrets from the device stream
- Segment hashes detect corruption; they do not authenticate who produced or modified a capture

---

## Project structure

```text
serialhub/
├── README.md                 # English (default)
├── README.zh-CN.md
├── README.es.md
├── POSITIONING.md
├── WINDOWS_COM_BRIDGE.md       # Windows COM-only legacy application bridge
├── EVENTS.md                 # Canonical event ledger, persistence, API, replay
├── WORKFLOWS.md              # Bounded linear agent workflow contract
├── serialhub.example.toml
├── web/                      # Optional React console (Traditional Chinese)
│   ├── README.md             # Web console build and feature guide
│   ├── PROTOCOL.zh-TW.md     # Full HTTP/WS protocol
│   ├── README.zh-TW.md
│   └── src/
├── src/                      # Rust hub + CLI
└── tests/
```

### Web console (embedded + optional Vercel)

The React UI is **embedded** into the hub binary (from `web/dist`):

```bash
cd web && npm ci && npm run build && cd ..
cargo build --release
./target/release/serialhub share mock:demo --ui
# open http://127.0.0.1:8787/
```

| Mode | URL |
|------|-----|
| **Recommended** | `http://127.0.0.1:8787/` same-origin UI + API + WS |
| Dev hot-reload | `cd web && npm run dev` → localhost:5173 |
| Optional CDN/Vercel | `web/vercel.json` (HTTPS→local WS may be blocked) |

Protocol (zh-TW): [`web/PROTOCOL.zh-TW.md`](./web/PROTOCOL.zh-TW.md).

The console currently provides browser-local Hub profiles, text/Hex writes with
explicit line endings, quick commands, 50 ms-minimum timed sending, optional
SUM8/XOR8/CRC16 preprocessing, text/Hex log views and export, event Actor/
Epoch/Hex filters plus NDJSON evidence export, Prometheus metrics, RawData/
FireWater/JustFloat parsing with a bounded waveform, and NMEA 0183, SLIP, COBS,
and Modbus RTU frame inspection. All writes still go through `/v1/write`; the
page does not become a second serial owner and does not persist bearer tokens.

---

## Development

```bash
cargo test
cargo run -- run -c serialhub.example.toml
cargo fmt
cargo clippy
```

CI: [`.github/workflows/ci.yml`](./.github/workflows/ci.yml) — Ubuntu, macOS, Windows.

---

## Current release scope

v0.2.3 is the current public baseline. It includes the hub, trusted TX and
leases, Unix PTY, TCP, HTTP/WebSocket, RFC2217, multi-profile supervision,
event ledger and safe replay, device identity, bounded maintenance handoff,
Prometheus metrics, the single-screen debugging workspace, signal studio and
configurable six-language interface. Version 0.2.0 adds no-command startup, a
device manager with concurrent independent sessions, and opt-in paired LAN access. See [release verification and packages](./RELEASING.md).

It deliberately does **not** claim a kernel virtual-COM driver for Windows,
UDP transport, a full terminal-emulation mode, a programmable scripting
engine, cloud SaaS, or hardware certification for every adapter and device.
See [`POSITIONING.md`](./POSITIONING.md) for the supported-platform matrix,
security/deployment contract, documentation map, and HIL boundary.

---

## FAQ

**Can two clients write at once?**  
Not as interleaved bytes. Default mode queues complete lines; locks grant exclusive windows.

**Must the agent use a virtual COM port?**  
No. Prefer WebSocket + HTTP.

**Why does my terminal’s baud setting on PTY not change the device?**  
The hub owns the real port settings.

**Is this only a sniffer?**  
No. It is an interactive **share hub** with TX control, not passive capture only.

**Does mock mode need hardware?**  
No. `mock:demo` loops TX back as RX. It exercises hub, policy, lease, API, and shutdown logic, but it does **not** validate an OS serial driver, USB/UART timing, physical control lines, or a real device's command acknowledgement.

**Can I reconnect to the same USB board after COM/tty renumbering?**  
Yes. Set `real.usb.vid` and `real.usb.pid`, and add `serial_number` when more
than one adapter has the same VID/PID. The selector is fail-closed: no match
or multiple matches keeps the owner disconnected instead of guessing.

---

## Contributing

Issues & PRs: https://github.com/tianrking/serialhub

Please stay aligned with [`POSITIONING.md`](./POSITIONING.md).

---

## License

[MIT](./LICENSE) © serialhub contributors

---

## Tech tags

`serial` · `uart` · `com-port` · `tty` · `serial-hub` · `serial-mux` · `port-sharing` · `embedded` · `debugging` · `ai-agent` · `websocket` · `http-api` · `tcp` · `pty` · `tokio` · `axum` · `rust` · `cross-platform` · `macos` · `linux` · `windows` · `toml` · `mit-license` · `serialhub`

---

<p align="center">
  <a href="./README.md">English</a> ·
  <a href="./README.zh-CN.md">简体中文</a> ·
  <a href="./README.es.md">Español</a>
  <br/>
  <sub>One port. Many clients. Zero fights.</sub>
</p>
