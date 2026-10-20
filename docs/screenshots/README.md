# Workbench screenshots

These are direct browser captures of SerialHub source/candidate **0.0.4**,
using four independent backend `mock:readme-*` loopback devices. Traffic goes
through real acknowledged HTTP writes and WebSocket RX. `[DEMO]` labels identify
synthetic payloads. Signal Studio uses a generated 64 Hz FireWater stream.
There is no physical device, edited log, altered counter or fictional OS port.

Capture settings are recorded in [capture.json](capture.json): English UI,
1440 × 900, browser zoom 100%, interface text 110%, logs/send editors 14 px.

- [Multi-port workbench](multi-port.png)
- [Live console](console.png)
- [Signal Studio](signal-studio.png)
- [Device manager](devices.png)

Build `web/dist` and the Rust binary, then regenerate from the repository root:

```sh
npm --prefix web run build
cargo build --locked --bin serialhub
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium python3 scripts/capture-readme.py
```

The script uses a private temporary state directory, an ephemeral loopback port,
Mock devices only, and explicit cleanup. It does not touch existing managers or
open real UARTs. Use `--binary` to select another newly built executable.
Omit the Chromium variable when using Playwright's installed browser.
See [the brand guide](../../BRAND.md) for the presentation rules.
