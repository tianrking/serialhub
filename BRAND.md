# SerialHub identity

The product name is **SerialHub**, with a capital S and H and no punctuation.
The command, package and repository remain `serialhub`. The short description is
**Serial device workspace**. The brand line is **One port. Shared access.**

SerialHub describes the core product directly: one owner opens a physical serial
port and shares it with people, tools and automation. A desktop manager can run
several independent owners; the name does not imply a one-device UI limit.

## The fan-out mark

The original symbol uses one input, a hollow central square, and three output
tracks. The square represents coordinated ownership; the parallel terminals
represent independent clients sharing the same stream. It is a conceptual mark,
not an electrical wiring diagram, USB certification mark or physical pinout.

Square terminals and 45-degree branches follow a 32-unit construction grid.
The core is 8 units square with a 4-unit clear centre; traces are 2 units wide.
The mark has no lettering, gradients or external font dependency. Its silhouette
works as a small monochrome tray/menu icon as well as a larger product identity.

| Use | File |
| --- | --- |
| Vector master | [serialhub-symbol.svg](assets/brand/serialhub-symbol.svg) |
| Dark/light wordmark | [dark](assets/brand/serialhub-lockup-dark.svg), [light](assets/brand/serialhub-lockup-light.svg) |
| App tile / Linux shortcut | [serialhub-app.svg](assets/brand/serialhub-app.svg) |
| App PNG | [serialhub.png](assets/serialhub.png) |
| Windows icon | [serialhub.ico](assets/serialhub.ico), 16–256 px |
| macOS icon | [serialhub.icns](assets/serialhub.icns), 128–1024 px |
| Color tray | [serialhub-tray.svg](assets/brand/serialhub-tray.svg) |
| macOS template tray | [serialhub-tray-template.svg](assets/brand/serialhub-tray-template.svg) |
| Browser favicon | [favicon.svg](web/public/favicon.svg) |

The React symbol, installed Linux icon, native tray and binary icons come from
this geometry. The tray uses embedded RGBA; installed applications do not need
a separate image file, Python, Pillow or a graphics decoder to display it.

## Color, type and placement

| Role | Value |
| --- | --- |
| Graphite canvas | `#14171B` |
| Instrument surface | `#1D2228` |
| Primary text | `#D6DCE5` |
| Secondary text | `#A2ADBB` |
| Signal mint, identity accent | `#91C8BE` |
| Light-surface mark | `#397A70` |

Use one restrained accent, generous clear space in documentation and compact
identity placement in the application. Leave at least 4 grid units around the
symbol. The application and color tray icons add a graphite tile with a quiet outline,
keeping the mark readable on light or dark system bars. macOS
menu-bar templates use alpha and black, allowing the OS to choose the displayed
color. Maintain an 18 CSS px minimum UI symbol when practical; favicons and
native tray slots have platform-imposed sizes.

The wordmark uses outlined DejaVu Sans glyphs with adjusted tracking. It renders
without downloading fonts. The font's license is retained in
[FONT-LICENSE.txt](assets/brand/FONT-LICENSE.txt). Interface text continues to use
OS fonts, including CJK/Arabic fallbacks. Data-channel colors remain independent
of branding, and connection/error colors retain their operational meaning.

## README presentation and screenshots

The English, Simplified Chinese and Spanish READMEs share the same identity.
Their first view contains the logo, a short product description, navigation and
an actual multi-port screenshot. Additional full-size console and Signal Studio
screenshots sit in an expandable section. Captions identify **Mock/Demo** sources
and the source version. No screenshot is a hardware certification or a promise
of throughput. Images are captured directly from the running UI, without
retouching logs, changing counters or inserting fictional device responses.

Screenshots live in [docs/screenshots](docs/screenshots). Use a 1440 x 900
viewport at browser zoom 100% for a readable full workspace. Documentation images
are PNG; vector identity assets remain SVG. The same screenshots are shared by
translated READMEs to avoid duplicating binary files. Technical manuals continue
after the introduction; the visual overview does not replace API/CLI reference.

## Rebuild assets

The generated assets are committed. Normal builds and downloaded applications
need no asset-generation dependencies. To change the master, edit
`scripts/build-brand-assets.py`, then rebuild on a development machine with
Python 3, fontTools, Pillow, DejaVu Sans and the web development dependencies:

```sh
npm --prefix web ci
# Install the following optional development tools if absent:
python3 -m pip install fonttools pillow
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium python3 scripts/build-brand-assets.py --raster
npm --prefix web run build
cargo build --locked --release --bins
```

Use `--font-dir` for a non-default DejaVu font directory. Without the Chromium
variable, the renderer uses Playwright's installed Chromium. The script creates
SVG/React sources, rasterizes the original vectors, packages ICO/ICNS and encodes
tray RGBA. No generated concept bitmap is shipped as the production logo.

App and tray artwork follow the repository license; the font notice remains
separate. Keep the mark's proportions, clear centre and input/output topology.
