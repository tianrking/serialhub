# SerialHub v0.1.0

A local serial-sharing service with a single-screen browser workspace for
device debugging, shared automation and signal analysis.

- Modern desktop workspace with an always-available terminal and command
  composer, contextual tool tabs, keyboard-accessible dialogs and mobile layouts.
- Text/Hex commands, raw file transfer, command sequences, GBK/UTF-8 tools,
  checksums, raw RX recording and runtime serial settings.
- Signal studio with multichannel scope, calibrated FFT, cursors, software
  triggers, XY, waterfall, numeric instruments, attitude, raw image frames,
  parameter controls and CSV replay/export.
- English by default, plus Traditional Chinese, Spanish, French, Arabic RTL and
  Simplified Chinese. Deployments can choose the default and enabled languages.
- Session isolation, bounded reconnects/caches, explicit uncertain-write states
  and automatic-send cancellation on device or stream loss.
- Six native platform archives, executable/provenance validation, extracted
  package smoke tests and downloaded-asset SHA-256 verification before publication.

Download the archive matching your OS and architecture, verify it against
`SHA256SUMS`, and extract it. Both `serialhub` and the 0.x `ohmyserial`
compatibility executable are included. No Node.js, Rust or separate web server
is needed. Language resources work locally without a translation service.

```bash
./serialhub share mock:demo --pty 0 --ui
# Windows: .\serialhub.exe share mock:demo --ui
# Browser: http://127.0.0.1:8787/
```

For real hardware, run the Hub on the computer connected to the serial device.
Other tools connect through HTTP/WebSocket, TCP, Unix PTY or a Windows COM bridge.
The Hub coordinates access to one shared byte stream; it does not automatically
route device replies to individual requesters.

Linux archives target Ubuntu 24.04 / glibc 2.39. macOS acceptance runs on macOS 15.
Portable archives are unsigned; hardware-specific drivers and OS permissions may
be needed. Mock and package tests do not establish hardware qualification.
See the included `GETTING_STARTED.zh-CN.md`, `OPERATIONS.md`, `I18N.md` and
`RELEASING.md` for startup, boundaries, configuration and acceptance details.
