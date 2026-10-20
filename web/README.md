# SerialHub Web Console — source 0.0.4

The `web/` directory contains the React + Vite + TypeScript console embedded
into the Rust binary as `web/dist`. It connects to the hub's HTTP and
WebSocket endpoints; it does not open a serial device directly.

## Run the embedded console

Build the web assets first, then rebuild the Rust binary so `rust-embed` picks
up the new `dist` files:

```bash
cd web
npm ci
npm run build
cd ..
cargo build --release
./target/release/serialhub share mock:demo --ui
```

Open `http://127.0.0.1:8787/`. For a real device, replace `mock:demo` with a
serial path such as `/dev/ttyUSB0`, `/dev/cu.usbmodemXXXX`, or `COM3` and set
the line parameters before opening the device:

```bash
serialhub share COM3 --baud 115200 --data-bits 8 --parity none \
  --stop-bits 1 --flow-control none --ui
```

The Device settings tab can change baud, data bits, parity, stop bits and flow
control after explicit confirmation when `api.can_control` and a live write lease
allow it. The owner acknowledges the driver result; changes are process-local
and do not rewrite TOML. Desktop mode also scans and opens/closes independent
physical devices; standalone share/run changes its device path through restart.

## Display and desktop mode

For no-command startup use `serialhub-desktop`; the browser manager includes
independent devices and a tiled multi-port workspace. See [DESKTOP.md](../DESKTOP.md)
and [MULTIPORT.md](../MULTIPORT.md). The **Aa** button beside the six-language
selector adjusts interface/log font sizes; see [DISPLAY.md](../DISPLAY.md).

## Console capabilities

- Hub host/port connection profiles stored in the current browser; Bearer
  tokens remain memory-only.
- Text and Hex writes with `none`, `LF`, `CR`, or `CRLF` endings and
  Ctrl/⌘+Enter.
- Browser-local quick commands and bounded timed sending (50 ms minimum).
- Optional SUM8, XOR8, CRC16-Modbus, and CRC16-CCITT Hex preprocessing with a
  visible wire preview.
- Pause/auto-scroll, timestamp toggle, text/Hex/both log modes, and export.
- RawData, FireWater CSV, and JustFloat little-endian parsing across chunk
  boundaries, plus a bounded SVG waveform view.
- NMEA 0183 checksum validation, SLIP and COBS frame decoding, and bounded
  Modbus RTU shape/CRC inspection across WebSocket chunks.
- Event-ledger Actor/Epoch/Hex filters, complete NDJSON export, and a
  Prometheus metrics panel with raw `.prom` download.
- DTR/RTS/BREAK controls through `POST /v1/control`; the Hub must grant
  `api.can_control` and the page must hold the opaque write lease.

All writes use `POST /v1/write`, so the Hub's TX policy, lease checks, size
limits, and host-side write confirmation remain in force. The UI is therefore
an observer/client of the Hub rather than a second serial owner.

## Local hot-reload development

Run the hub and Vite separately:

```bash
# terminal 1
cargo run --locked -- run -c serialhub.dev.toml

# terminal 2
cd web
npm ci
npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

The development profile uses mock loopback and explicitly allows the two local
Vite origins on port 5173 for HTTP and WebSocket access. A plain `share` command
uses same-origin access by default and will reject the separate Vite console.
Stop any existing Hub on port 8787 before starting this profile. Open the Vite
console on `127.0.0.1:5173`; it connects to the Hub at `127.0.0.1:8787`.
Keep these origins in the development profile only. Use `npm run build` to
validate the embedded asset before committing.

## Protocol and security references

- [`PROTOCOL.zh-TW.md`](./PROTOCOL.zh-TW.md) — HTTP/WS contract and browser
  mapping (Traditional Chinese).
- [`../EVENTS.md`](../EVENTS.md) — canonical event ledger and event stream.
- [`../WORKFLOWS.md`](../WORKFLOWS.md) — bounded Agent workflow contract.
- [`README.zh-TW.md`](./README.zh-TW.md) — Traditional Chinese UI guide.

Standalone CLI/TOML HTTP/WS/TCP listeners are loopback-only. Desktop mode can
explicitly enable paired IPv4 LAN HTTP/WS; this exception does not expose raw TCP. For remote use, follow the Hub
documentation for an SSH tunnel or TLS reverse proxy; do not put API tokens in
URLs.

## Checks

```bash
npm run build
npm run lint
npm test
# After npm run build, with Cargo on PATH:
npx playwright install chromium
npm run test:e2e
```

The workspace includes bounded log search/type filtering, Text/Hex send modes,
live device counters, and a responsive layout. Requests and sockets belong to
one connection session; disconnect cancels pending work and ignores stale
callbacks. Automatic sending stops on a disconnected device, stream loss, or
write failure and stays off after reconnect. Write deadlines have uncertain
device outcomes and are never retried automatically.

For service operation, HTTPS proxy requirements, shutdown behavior, and
validation limits, see [`OPERATIONS.md`](../OPERATIONS.md).
