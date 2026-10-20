# SerialHub v0.4.0 candidate

Local candidate builds; platform-specific validation is recorded with each package.
The public v0.2.3 release remains unchanged until new packages are published.

- Added a multi-port workspace with simultaneous independent terminals, Text/Hex
  send buffers, 2/4/6-panel layouts, focus, bounded recent logs, filter/export,
  pause/clear, write leases and confirmed individual device close.
- Panel acquisition and drafts survive paging/full-workspace switches. Sends
  have an explicit destination and are never automatically replayed.
- Desktop startup is detached from the terminal, with native system-tray/menu-bar
  actions to reopen the workspace, open diagnostics and quit all owners.
- The existing SerialHub brand opens an application menu in every workspace.
  Closing the page keeps device owners running; explicit Quit stops the service.
- CLI quit now waits for device handles and worker ownership cleanup before
  returning success, including a concurrent web/tray shutdown.
- Repeated launches reuse the actual listening address, including fallback ports.
  Open browsers show a stopped state on exit and ignore stale status replies.
- Linux application-menu open/quit entries provide a fallback when a desktop
  does not display tray icons. Browser-side jobs stop when their page closes.


Launch the app, choose a serial port in your browser and start debugging.
No terminal commands, Node.js or Rust installation are needed for downloaded packages.

- Fixed the stacked duplicate headers: the original workbench navigation is now
  the single header, with device switching and **All devices** in its device menu.
  One brand, language picker and connection indicator remain visible. Switching
  retains each device's connection, drafts, acquisition and selected tool.
- Windows: double-click `serialhub-desktop.exe`; macOS: open `SerialHub.app`;
  Linux: run `serialhub-desktop` as a program. No-argument `serialhub` also opens the manager.
- Detect/configure ports, try a mock demo, open up to 16 independent concurrent
  device sessions, and switch workspaces while retaining their live connections.
- Each device has its own owner, broker, write leases, workflows and event ledger.
  Multiple browsers/tools may subscribe; optional local TCP and Unix PTYs are available.
- Enable IPv4 LAN sharing in the UI and share a pairing link. Revoke it instantly
  without stopping local devices. Link holders can use/manage devices; use a trusted
  LAN because transport is HTTP. LAN settings and application shutdown stay local.
- Keep the existing serial console, file tools, Signal Studio and six interface
  languages, with English as the default. Existing CLI automation stays available.
- Unique per-workspace tab/panel and SVG clip identifiers keep keyboard focus
  and plotting independent when multiple device workspaces are mounted.
- Release tooling supports six native targets with GUI launcher checks,
  manifest/SHA-256 validation and extracted-package smoke tests. Local candidate
  downloads list only the targets actually built; they do not imply six-platform acceptance.

Download the matching archive, verify against `SHA256SUMS`, extract and launch.
Portable packages are unsigned; the OS may require confirmation to run. Linux
requires glibc 2.39+; native CI uses Ubuntu 24.04 and macOS 15. Hardware drivers and
serial permissions still apply. Windows virtual COM drivers are separate.

See `DESKTOP.md` and `GETTING_STARTED.zh-CN.md` for GUI usage, architecture, LAN,
API and tests. Sessions are in-memory and not auto-restored after app exit;
advanced persisted ledgers/RFC2217/deployment policies use the existing TOML/CLI mode.
Mock/browser/package checks do not certify real hardware or every SSCOM/VOFA plugin.
