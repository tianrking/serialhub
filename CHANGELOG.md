# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

## [0.0.4] — source / local candidate

- Added fixed-port `serialhub serve`, short background `start` / graceful `stop`,
  shared instance discovery and native per-user login-service management.
- Added offline native npm packages and Python platform wheels, Debian packages,
  signed APT repository tooling, Homebrew Formula and WinGet manifests. Added
  actual install/run/uninstall CI coverage and explicit manual npm/PyPI/signing
  workflows. Registry registration/hosting are separate publication steps; see
  [INSTALLATION.md](INSTALLATION.md).

- Introduced a unified SerialHub fan-out identity across the workbench, browser favicon, native app/tray icons and English/Chinese/Spanish READMEs; added real Mock-backed screenshots and reproducible brand/capture tools. See [BRAND.md](BRAND.md).

- Added independent interface (80–160%) and serial log/send-editor (10–28 px) text sizing, immediate preview, reset and browser-origin persistence across tabs; six-language labels and RTL layout. See [DISPLAY.md](DISPLAY.md).
- Reconciled current-source README/version, uncapped multi-port and runtime-setting descriptions; retained historical release/changelog identities. See [DOCS.md](DOCS.md).

Version metadata now follows the requested 0.0.x numbering. Earlier 0.3.x/0.4.x
local candidate labels are superseded; historical published tags are unchanged.

- Unified the manager, console, signals, events/metrics, connections, guide and
  dialogs around a compact terminal palette with shared semantic theme tokens.
- Added explicit copy actions for filtered/paused logs, displayed row payloads,
  protocol frame HEX, conversion results, filtered NDJSON events, raw metrics,
  endpoints and LAN pairing links. Copy operations never send device data.
- Added clipboard permission/HTTP fallback with focus/selection restoration and
  selectable manual text when browser clipboard access is unavailable.
- Kept native text selection and disabled tail following when selecting logs.
- Show event evidence and metrics together on desktop; use compact inventory
  rows, legible HEX and two-column protocol references with copyable API addresses.
- Added full-page terminal tiling with automatic/custom rows/columns, resizable
  tracks, focus and preserved independent acquisition/drafts. Removed the fixed
  16-session cap; practical scale remains constrained by host/browser resources.
- Preserved explicit atomic HTTP writes, WebSocket reception, leases, encodings,
  signal analysis, file tools, six languages and confirmed device/application close.
- Added clipboard/selection/denial regressions and retained shared HTTP/WS,
  multiple-owner isolation, native tray/detached startup and OS cleanup checks.

## [0.2.3] — 2026-10-19

- Kept the original workbench navigation as the only header in an open device
  workspace. Device switching and **All devices** now live in its device menu;
  branding, language selection and connection status appear once.
- Preserved each device's live connection, acquisition, drafts and selected tool
  when switching devices or returning to the manager.
- Removed irrelevant standalone Hub connection inputs from managed workspaces,
  including Signal Studio, and kept reconnect feedback available on errors.
- Reserved extra navigation space for native font differences on Windows, macOS
  and Linux, including French labels on 1280-pixel desktops. Added regression
  coverage for four font families and the responsive breakpoint.
- Aligned the manager logo with the workbench and adapted the unified header for
  tablet/mobile widths, Arabic RTL and long translated navigation labels.
- Added browser regressions across five languages, all five feature pages and
  1280/1366/2048 desktop widths, plus narrow-screen device navigation.

## [0.2.1] — 2026-10-19

- Isolated workspace tab/panel identifiers and SVG clipping paths per mounted
  device so hidden workspaces cannot capture keyboard focus or chart clipping.
- Kept device startup successful if a launcher closes its diagnostic pipe.
- Allowed pairing-link navigation from other websites while retaining cross-site
  checks on device/control APIs.
- Added a browser regression covering two simultaneous workspaces, unique DOM
  identifiers, keyboard navigation and plot-local clip references.

## [0.2.0] — 2026-10-19

- Added no-argument startup, an automatic browser launch, a Windows GUI launcher
  and a portable macOS app bundle; existing CLI commands remain available.
- Added a localized device manager with serial scan/settings, mock demos,
  dynamic open/close, isolated concurrent sessions, optional local TCP and Unix PTYs.
- Added opt-in IPv4 LAN sharing with pairing links, HttpOnly cookies, host/origin
  checks and immediate remote stream revocation without closing local devices.
- Preserved live browser connections and drafts while switching device tabs;
  each device retains its own broker, write leases, workflow runner and ledger.
- Extended native package checks and browser/transport tests for the desktop flow.

## [0.1.0] — 2026-10-19

### Debugging and signal analysis

- Added raw file transfer, sequential command jobs, GBK/UTF-8 tools, raw RX
  recording, configuration migration and acknowledged runtime serial settings.
- Added the signal studio: multichannel scope, cursors, software triggers,
  calibrated FFT, XY, waterfall, meters, attitude, raw images, parameter controls
  and CSV replay/export with bounded acquisition history.
- Fit the desktop terminal, waveform, composer and contextual tools into one
  screen, preserving drafts while switching tools and containing dialog focus.
- Added English-default localization with Traditional Chinese, Spanish, French,
  Arabic RTL and Simplified Chinese, deploy-time language controls, localized
  display formatting and automated catalog/placeholder checks.

### Release engineering

- Reused the complete CI gate for tag and manual releases, including Node 22/24,
  Rust formatting/clippy/tests and browser tests against the release binary.
- Built and tested six native platform archives with both executable names,
  offline docs, per-file SHA-256 manifests and a release-level SHA256SUMS file.
- Required archive architecture, source commit, version and file completeness;
  extracted and ran each native package before accepting its artifact.
- Downloaded and compared draft release assets before public publication;
  rejected incomplete releases and overwrites of already published versions.
- Kept Linux PTY baud checks on Linux: Darwin PTYs reject IOSSIOSPEED and are
  not substitutes for physical macOS serial adapters.

### Reliable device workspace

- Redesigned the console with a responsive navigation shell, live device
  counters, a dedicated terminal, Text/Hex composer, log search/type filters,
  waveform display, and explicit mock-device identification.
- Isolated connection sessions so disconnect/switch cancels requests, timers,
  and sockets; stale responses cannot restore an old session. Added serial
  status polling, request deadlines, bounded stream reconnection, HTTPS/WSS
  URLs, and IPv6 endpoint support.
- Guarded manual/keyboard sends against offline state and duplicate submits.
  Timed sending stops after device/stream loss or a write failure and stays
  stopped after reconnect. Expired/session-old leases are cleared; uncertain
  writes are never retried automatically.
- Batched bounded terminal updates, preserved split UTF-8 text, and kept Hub
  diagnostics out of the device RX stream. Optimized recent ledger queries
  with ordered cursor lookup and fixed RFC2217 connection task ownership.
- Added Unix SIGTERM graceful shutdown with a process-level ledger-sealing
  regression test, a mock Vite development profile, browser regression tests
  in Linux CI, and service guidance in `OPERATIONS.md`.

### Documentation

- Replaced the pre-release positioning draft with the maintained v0.0.2 product
  definition, support boundaries, deployment/security contract, and canonical
  documentation map.
- Updated the English, Simplified Chinese, Spanish, and Web protocol entry
  points to identify v0.0.2 as the current release and removed stale
  MVP/phase-planning language.

## [0.0.2] — 2026-08-24

### SerialHub branding and safe configuration preflight

- Renamed the project, canonical Cargo package, GitHub repository, and primary
  executable from `ohmyserial` to `serialhub` (display name: **SerialHub**).
- Added `serialhub check -c profile.toml`, which validates TOML and the final
  loopback-only listener policy without opening a serial device or binding a
  port.
- Kept the 0.x `ohmyserial` executable, `ohmyserial.*` ledger schemas,
  `ohmyserial_*` Prometheus metrics, and browser storage keys as documented
  compatibility identifiers.
- Updated release packaging to ship both executables, and documented the
  migration in `MIGRATION.md`.

### Web serial-console workflow

- Added explicit text line endings (`none`, `LF`, `CR`, `CRLF`) and Ctrl/⌘+Enter send.
- Added browser-local quick commands for text and Hex payloads, including edit/delete and per-command line endings.
- Added bounded timed sending (50 ms minimum) that reuses the authenticated HTTP write path, lease, and TX arbitration.
- Added text/Hex/both log display modes, timestamp toggle, and page-log export.
- Added chunk-safe FireWater CSV and JustFloat little-endian float parsing with a bounded SVG waveform view.
- Added guarded DTR/RTS/BREAK controls to the console; API capability and write lease remain mandatory.
- Added complete quick-start serial parameter flags: data bits, parity, stop bits, and flow control, with matching `run` overrides.
- Added browser-local connection profiles for repeatable Hub host/port sessions without persisting bearer tokens.
- Added optional Hex checksum preprocessing with visible wire preview (SUM8, XOR8, CRC16-Modbus, CRC16-CCITT).
- Documented the PuTTY/SSCOM/VOFA+-inspired interaction model and the boundary that serial hardware parameters remain Hub CLI/TOML configuration.

### Device identity

- Added an exact USB VID/PID selector with optional serial-number disambiguation.
- Re-resolve the physical port immediately before every open/reconnect, reject zero or ambiguous matches, and expose the resolved OS path in connection status.
- Added configuration validation and English/Chinese setup documentation; mock tests make no hardware-in-loop claim.

### Bounded workflows

- Added a finite linear workflow DSL with lease, atomic send, incremental RX expect, explicit assertions, waits, and reserved control steps.
- Added server-generated workflow actors, idempotent `request_id` handling, bounded evidence cursors, cancellation, and fail-closed behavior for RX gaps, lag, disconnects, and epoch changes.
- Added `POST /v1/workflows/run`; control steps now use the serial-owner command channel for acknowledged DTR/RTS/BREAK operations.

### Serial control lines

- Added a bounded owner-thread command channel and `POST /v1/control` for DTR, RTS, and BREAK.
- Control operations require the explicit `api.can_control` capability plus an opaque write lease; RTS is guarded against hardware-flow-control conflicts and mock mode makes no physical claim.

### Safe handoff

- Added bounded `POST /v1/handoff` and `/v1/handoff/resume` for external maintenance tools.
- The serial owner releases the OS handle before acknowledging, queued TX and new leases are blocked, the old lease is invalidated, and TTL expiry resumes automatically.
- Handoff tokens are response-only credentials and are excluded from status, logs, and canonical evidence.

### Multi-profile supervision

- Added `serialhub supervise -c profile-a.toml -c profile-b.toml` for independent real-port hubs in one process.
- Added preflight collision checks for listeners, PTY links, real paths, USB selectors, and ledger directories, plus startup rollback and coordinated graceful shutdown.

### Event ledger and safe replay

- Added a canonical `ohmyserial.event` v1 envelope with session sequence, UTC/monotonic time, port connection epoch, typed RX/TX/connection/control/gap payloads, and standard padded Base64 byte encoding.
- Added an always-on event/byte-bounded memory ring plus read status, cursor query, filtered catch-up, NDJSON export, and read-only snapshot-then-live event WebSocket APIs.
- Added opt-in append-only NDJSON persistence with size/event rotation, SHA-256 content and cross-segment chain verification, checkpointing, per-session locking, and conservative stale `.open` recovery that preserves source files.
- Added verified offline replay in immediate, original-timing, and manual-step modes. Replay emits unchanged envelopes and has no path to the live broker, serial owner, leases, or device writes.
- Documented that hashes detect corruption but are not signatures, retention deletion is operator-owned, process-observed RX starts after the driver read boundary, host-confirmed TX is not a device acknowledgement, and mock coverage is not hardware-in-the-loop evidence.

### Trusted serial core

- Added credentialed write leases: acquire returns a random opaque `lease_token`; renew, protected writes, and release require that token. Owner names are display/audit labels and disconnect no longer releases a lease by name.
- Made HTTP writes atomic and confirmed: success follows the serial owner's host-side `write_all` + `flush`, with bounded queue/ack deadlines and explicit partial-or-unknown outcome errors.
- Bounded delimiter frames and atomic writes with `max_frame_bytes` / `max_write_bytes`; stale queued writes are rejected across serial connection epochs instead of replayed after reconnect.
- Implemented all bounded slow-reader policies: drop oldest, drop newest, immediate disconnect, and deadline-bounded block-then-disconnect.
- Removed unbounded TX bridges, bounded serial write bursts, and made shutdown reject/drain pending writes and stop owned workers.
- Put Unix PTY slaves into raw mode, keep endpoints alive before the first slave opener, and cover bidirectional PTY bytes in a real Linux test.
- Made Linux builds portable without a mandatory `libudev-dev` package by using serialport's sysfs enumeration fallback.
- Made listener startup fail atomically: bind/configuration failures abort already-started tasks instead of reporting a partially ready hub.

### API security

- Added environment-sourced Bearer authentication, API read/write permissions, exact-origin CORS, and WebSocket Origin validation.
- Browser WebSocket authentication uses the `bearer` subprotocol pair; query-string tokens are not accepted.
- Plaintext API, dedicated WebSocket, and raw TCP listeners are loopback-only even when a bearer is configured; remote use goes through SSH or a TLS reverse proxy. HTTP/WS Host validation blocks DNS rebinding aliases.

### Verification boundary

- Expanded trusted-core regression coverage for disconnect/reconnect, lease spoofing, bind failures, atomic write framing, bounded queues, and lifecycle cleanup.
- Mock loopback tests validate hub behavior only; physical serial drivers, USB/UART timing, control lines, and real-device acknowledgements still require hardware-in-the-loop verification.

## [0.0.1] — 2026-07-24

First public release.

### Features
- Exclusive real serial port ownership with reconnect
- RX fan-out to many clients (PTY / TCP / WebSocket)
- TX arbitration (`queue_by_line`, frame, exclusive, primary) + write locks
- Bulk `[fanout]` and CLI `share` (zero-config multi endpoints)
- HTTP API: health, status, endpoints, write, lock
- WebSocket stream `/v1/stream`
- Embedded React console (Traditional Chinese) at `http://API/`
- `share --ui` / `run --ui` opens browser
- Mock loopback `mock:demo` for demos without hardware
- Cross-platform: macOS, Linux, Windows (x64 & arm64)

### Docs
- README (EN / 简体中文 / Español)
- `POSITIONING.md`, `web/PROTOCOL.zh-TW.md`

### CI
- Multi-OS / multi-arch build & test
- Tagged release workflow with binary assets
