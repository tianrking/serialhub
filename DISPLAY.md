# Text size and display — 0.0.4

Use **Aa** beside the language selector in All devices, a device workspace,
the standalone share/run console, or Multi-port workspace. No restart or device
reconnection is required. Escape or **Close ×** closes the settings and returns
keyboard focus to its button. Closing does not undo the changes.

| Setting | Range | Default | Applies to |
| --- | --- | --- | --- |
| Interface text size | 80–160%, steps of 10% | 100% | Navigation, controls, dialogs, help, counters, tool labels and HTML tables |
| Serial log font size | 10–28 CSS px, steps of 1 | 12 px | Text/HEX terminal payloads and send editors, in single-device and tiled modes |

The preview updates immediately. Log timestamps/direction labels scale with the
log, at 90% of its size. The two settings are independent: enlarging the UI does
not override the selected log size. **Reset text size** restores both defaults.
Range sliders support arrow keys and Home/End. Normal browser zoom also works.
SVG chart-axis labels and graphical gauge labels follow their chart/viewBox
size, rather than the interface slider; use browser zoom or enlarge that plot
for those labels. Image pixels and exported protocol bytes remain unchanged.

Preferences use `serialhub.ui.display.v1` in local storage and synchronize with
other tabs on the same origin. An origin includes scheme, hostname and port:
a different LAN IP, `localhost` instead of `127.0.0.1`, or a fallback port has its
own settings. There is no host-wide font policy, account or cloud synchronization.
If storage is blocked, changes work for the open page and reset after reload.
Clearing the saved key/all local storage restores defaults. Invalid stored values
are rejected. Settings never contain device payloads or credentials.

All six UI languages share these controls: English, Traditional Chinese,
Simplified Chinese, Spanish, French and Arabic. Arabic mirrors interface flow;
HEX, timestamps and addresses keep left-to-right ordering; text editors choose
the writing direction from their contents. Serial rows keep terminal column
order even when the surrounding interface mirrors.
Font glyphs come from OS/browser fonts; no runtime font CDN is required. Install
CJK/Arabic fonts if a minimal system lacks their glyphs. Automatic catalog and
browser checks do not replace native-speaker terminology review.

At large sizes fewer log lines fit. Desktop panes keep their own scrolling;
narrow windows use the responsive stacked layout. Tiled terminals retain all
owners, with draggable dividers, focused view and custom rows/columns available.
Increasing text size does not start/stop acquisition, send a command, acquire a
lease or reconnect a device. Browser timing and machine resources still bound
how much data can be displayed. See [MULTIPORT.md](MULTIPORT.md).

For local checks, build the web assets, then run:

```sh
npm --prefix web run build
npm --prefix web test
npm --prefix web run lint
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm --prefix web run test:e2e -- display.spec.ts
```

Rebuild the Rust executables after building the web assets to embed the changes.
