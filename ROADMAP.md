# Engineering priorities after 0.0.4

SerialHub already implements shared RX, coordinated TX, write leases, bounded
queues, gap events, tiled consoles and a headless API. The next milestone should
make those capabilities easy to trust and diagnose with physical hardware.
This is a proposed work order, not a claim that these acceptance campaigns ran.

| Priority | Work | A concrete completion criterion |
| --- | --- | --- |
| P0 | Publish dependable downloads | All 25 files are downloadable from the matching Release; checksums match; instructions work from a fresh OS account. Add Windows Authenticode and macOS Developer ID/notarization when signing identities are available. |
| P0 | Physical serial reliability | Exercise CH340, CP210x and FTDI families across supported OSes, with 2/4/6 concurrent ports at 115200 and 921600 baud for eight hours. Use firmware sequence numbers and CRCs to detect end-to-end loss; memory must plateau, and any observed gaps must be accounted for. |
| P0 | Fault and lifecycle recovery | Repeat unplug/replug during RX and TX, sleep/resume, occupied ports, launch/quit and service stop/uninstall. Other owners must continue; shutdown must release handles; reconnect must never replay old sends. A slow HTTP/WS subscriber must not stall other readers. |
| P1 | One-action diagnostic export | Export a bounded support bundle containing version, OS, device identity, UART settings, counters, recent errors and shutdown state. Exclude bearer tokens, pairing secrets and serial payloads by default; require an explicit choice to include sample data. |
| P1 | Project workspace profiles | Bring existing CLI identity selectors into GUI profiles: device identity, UART settings, layout, parser and send presets. Use a versioned import/export schema. Restore configuration for review; opening hardware and restarting timed sends remain explicit actions. |
| P2 | Capture and replay workflow | Build a GUI flow on the existing ledger and read-only replay: annotate events, retain bounded pre/post-trigger data and jump between logs and signal time. Keep replay isolated from live TX. |

## Practical rules for acceptance

- A successful host write/flush is not a device acknowledgement. Firmware sequence
  numbers and explicit protocol responses are needed to establish delivery.
- Bytes lost in a USB adapter or driver before the host reads them require an
  external oracle; an application counter alone cannot prove zero loss.
- Track device-to-display latency, CPU, memory, queue occupancy and dropped blocks
  together. A fluid UI is useful only when acquisition remains bounded and honest.
- Match devices using serial identity and VID/PID where available. Ambiguous
  matches must stay disconnected rather than selecting an arbitrary COM number.
- Keep the interface focused on log reading, copying, sending and incident
  recovery. Add visual instruments when they answer a debugging question.

See the existing [hardware checklist](HARDWARE_CHECK.zh-CN.md),
[reliability matrix](RELIABILITY_TEST_MATRIX.md),
[SSCOM comparison](SSCOM_PARITY.zh-CN.md) and
[VOFA comparison](VOFA_PARITY.zh-CN.md) for current implementation boundaries.
