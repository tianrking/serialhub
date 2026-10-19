# Operating SerialHub

SerialHub is a local device service. Use a dedicated OS account with permission
to open the intended serial device, keep its listeners on loopback, and let one
Hub own each physical port. Test the intended OS/adapter/device combination
before using it for unattended control.

## Build and regression checks

Use Node.js 22.18+ or 24+ and the stable Rust toolchain:

```bash
cd web
npm ci
npm test
npm run lint
npm run build
cd ..
cargo fmt --all -- --check
cargo clippy --locked --all-targets -- -D warnings
cargo test --locked --all-targets
cargo build --locked --release --bin serialhub --bin ohmyserial
```

Build the web assets before the release binary. Keep the previous binary and
configuration for rollback; do not deploy a partially built `web/dist` tree.

The browser suite starts an actual mock Hub on loopback port 18887 and uses the
embedded console. It covers connection cancellation, duplicate keyboard writes,
UTF-8 echo, log export/filtering, stream reconnection, automatic-send shutdown,
lease expiry/renewal, credentials, HTTPS URL selection, and a narrow mobile viewport.
It also checks binary file round trips, cancellation while awaiting acknowledgement,
ordered command sequences, GBK encoding, credential-free configuration migration,
live-only recording, bounded large-packet display, and device epoch changes.

```bash
cd web
npx playwright install chromium
npm run test:e2e
# To use an existing compatible Chromium instead of downloading a browser:
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm run test:e2e
```

Cargo must be on PATH. The HTTPS regression uses intercepted requests to verify
URL selection; separately validate the deployed reverse proxy and certificates.

## Local development

```bash
cargo run --locked -- run -c serialhub.dev.toml
# In another terminal:
cd web
npm ci
npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

This profile deliberately uses `mock:dev` and two exact Vite origins. Do not
copy these development origins into a production profile. A mock loopback
confirms software behavior, not device commands or physical control lines.

## Device profile and startup

Start with `serialhub.example.toml`. Choose a persistent device identity
(`/dev/serial/by-id/...` where supported, or an exact USB selector), set the
actual baud/parity/flow settings, and choose the TX policy for the device.

- Use `exclusive` when writers must explicitly acquire a lease before sending.
- Configure `api.token_env` with the name of an injected URL-safe bearer token.
  Keep its value outside the profile and repository. The Web UI keeps it in
  memory only; editing the input does not alter an already connected session.
- Keep `api.can_control = false` unless physical DTR/RTS/BREAK or runtime line-setting access is needed.
  A control request also needs a live write lease.
- Enable `ledger.directory` for capture retention. Each-event fsync gives
  stronger durability at the cost of synchronous disk latency; benchmark the
  actual storage and line rate before enabling it.

```bash
serialhub check -c /path/to/device.toml
serialhub run -c /path/to/device.toml
```

Preflight does not open hardware or reserve ports. After startup, check API
health **and** `/v1/status` for the expected identity and `port.connected`.
Then execute a harmless device-specific command and verify the device's own
acknowledgement. HTTP write success only confirms host-side write/flush.

On Unix, SIGINT and SIGTERM use the graceful shutdown path, including endpoint
cleanup, serial-owner shutdown, and ledger sealing. Registering signal handlers
before starting the Hub also covers termination during startup. Give a service
manager enough stop time for active bounded workflows and the serial driver;
forced termination still requires recovery inspection on the next startup.

## Remote console

Use an SSH tunnel or a TLS/authentication reverse proxy. The proxy must connect
to the loopback listener and send the upstream Host expected by that listener.
For example, an upstream on 8787 expects `Host: 127.0.0.1:8787`. Forward
WebSocket upgrades and its subprotocol headers. Preserve the browser Origin,
and list the exact external HTTPS origin in `api.cors_origins` so the Hub can
validate it. Do not solve a rejected request by disabling Host/Origin checks.

The console selects HTTPS/WSS when served over HTTPS. Explicit connection
profiles support HTTP or HTTPS and IPv6; legacy profiles retain HTTP. Token
input is optional only when the Hub has no configured authentication.

## During operation and failure recovery

- Inspect `rx_drops`, `slow_disconnects`, TX denials, connected state, and ledger
  persistence errors. A healthy HTTP process can still have a disconnected UART.
- The terminal is a bounded display window, not an archival record. Search and
  type filters affect the view/export; enable ledger persistence for evidence.
- Metadata polling is serial, requests have deadlines, and stream reconnects
  have bounded exponential backoff. Reconnection does not resubmit commands.
- Automatic sending stops on stream loss, device disconnect, or write failure.
  It remains off after reconnect. Operators must deliberately re-enable it.
- A timeout or aborted write may already have reached the device. Inspect the
  ledger and device state before deciding whether to retry. The UI does not
  promise exactly-once execution or interpret host ACK as device ACK.
- Lease credentials expire locally, are cleared on session/epoch changes, and
  are still enforced by the Hub. The UI never automatically renews them.
- Test unplug/replug, slow readers, disk errors/full disk, process termination,
  reconnect, and intended remote access before unattended deployment.

Known work beyond this delivery: global transport connection budgets, bounded
streaming of large exports/replays, disk-latency isolation, fleet management,
and hardware-in-the-loop qualification. See `RELIABILITY_TEST_MATRIX.md` and
`PROJECT_REVIEW.zh-CN.md` for the broader validation boundary.


## Workspace transfer limits

File TX sends raw bytes in acknowledged blocks (64–4096 bytes) up to 64 MiB.
A stop finishes the current acknowledgement, then prevents later blocks; it
cannot undo device writes. Jobs renew only the existing lease and stop if renewal
fails. Neither writes nor interrupted jobs are automatically replayed.

Raw RX recording uses a live-only WebSocket confirmed by the Hub. It retains up
to 16 MiB in browser memory, independent of display pause/filtering, and stops on
stream loss, device epoch changes, or capacity exhaustion. Download it before
closing the page. Slow-client drops can still produce gaps; inspect the ledger
and drop metrics before treating capture as complete evidence.

Runtime line settings require control permission and a live lease; changes are
acknowledged by the serial owner and are not persisted to TOML. Port enumeration
lists the Hub machine's devices. Changing the owned physical port still requires
editing the Hub profile and restarting. See [the SSCOM capability matrix](./SSCOM_PARITY.zh-CN.md)
for hardware validation requirements and remaining GUI gaps.


## Signal Studio

Open the signal instruments navigation and select FireWater, JustFloat, a
configured fixed-length numeric frame, or a raw pixel frame. Set the **device's
uniform sampling rate** before interpreting the time axis or FFT. Packet arrival
timing is not a measurement clock. Invalid/missing values remain gaps; spectral
analysis requires a contiguous valid window. Engineering calibration affects the
display; CSV exports keep the original raw values.

Acquisition uses a separate 16,384-frame ring (64 channels, up to 16 visible
curves) and snapshots at no more than 20 Hz. Terminal display pause does not stop
signal acquisition; a frozen plot retains its view while live acquisition
continues. CSV replay is isolated from live RX and never transmits commands.
Parameter controls require an explicit send and use the shared TX gate.

This is a browser software instrument, with bounded storage and display latency.
Validate sample-clock accuracy, throughput and CPU behavior on the actual target
hardware. See the [VOFA+ matrix](./VOFA_PARITY.zh-CN.md) for supported formats,
analysis assumptions, image framing, replay limits and remaining differences.
