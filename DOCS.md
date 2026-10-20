# Documentation index — current source 0.0.4

**0.0.4 is the current source/local candidate version.** Historical public tags,
including numerically higher v0.2.3, keep their original identity and downloads.
They do not include all current tray, copy, font and tiled-workspace features.
No new GitHub Release upload has completed. Use a verified candidate's manifest
and SHA256SUMS, or build the current source; do not assume `releases/latest`
contains the features documented here.

The UI supports six languages. Markdown has English, Simplified Chinese,
Spanish and Traditional Chinese entry points as listed below; this is not a
claim that every repository document has been translated into six languages.

| Need | Read |
| --- | --- |
| Main overview, installation, CLI, core API | [English](README.md), [简体中文](README.zh-CN.md), [Español](README.es.md) |
| Package-manager artifacts, headless server and user login services | [INSTALLATION.md](INSTALLATION.md) |
| First use, demo, real serial device and test examples | [中文入门](GETTING_STARTED.zh-CN.md) |
| Product fit, local/browser architecture, platform boundaries | [POSITIONING.md](POSITIONING.md) |
| Launcher, tray, close/quit, LAN pairing, manager API | [DESKTOP.md](DESKTOP.md) |
| Several ports in one tiled interactive window | [MULTIPORT.md](MULTIPORT.md) |
| Name, logo, app icons and README imagery | [BRAND.md](BRAND.md) |
| Font sizes, persistence, reset and chart-label scope | [DISPLAY.md](DISPLAY.md) |
| Language policy, RTL, translation maintenance | [I18N.md](I18N.md) |
| Browser frontend and development | [English](web/README.md), [繁體中文](web/README.zh-TW.md) |
| HTTP/WS wire contract and credentials | [Protocol, 繁體中文](web/PROTOCOL.zh-TW.md) |
| Service deployment and failure recovery | [OPERATIONS.md](OPERATIONS.md) |
| Event ledger, retention, hashes and replay | [EVENTS.md](EVENTS.md) |
| Bounded automation, maintenance handoff, supervision | [WORKFLOWS.md](WORKFLOWS.md), [HANDOFF.md](HANDOFF.md), [SUPERVISOR.md](SUPERVISOR.md) |
| Existing Windows virtual-COM tools | [WINDOWS_COM_BRIDGE.md](WINDOWS_COM_BRIDGE.md) |
| SSCOM 5.13 comparison and remaining differences | [SSCOM_PARITY.zh-CN.md](SSCOM_PARITY.zh-CN.md) |
| VOFA+ common instruments, math and remaining differences | [VOFA_PARITY.zh-CN.md](VOFA_PARITY.zh-CN.md) |
| Repeatable checks and physical hardware acceptance | [RELIABILITY_TEST_MATRIX.md](RELIABILITY_TEST_MATRIX.md), [Windows checklist](HARDWARE_CHECK.zh-CN.md) |
| Builds, six-target workflow and local CI-free packaging | [RELEASING.md](RELEASING.md) |
| Prioritized reliability, support and workspace improvements | [ROADMAP.md](ROADMAP.md) |
| Cross-compile all six targets and upload every format without hosted CI | [SERVER_RELEASE.md](SERVER_RELEASE.md) |
| Candidate contents, historical changes, migration | [RELEASE_NOTES.md](RELEASE_NOTES.md), [CHANGELOG.md](CHANGELOG.md), [MIGRATION.md](MIGRATION.md) |
| Historical initial code assessment (not current acceptance) | [PROJECT_REVIEW.zh-CN.md](PROJECT_REVIEW.zh-CN.md) |

Portable packages contain offline documentation. Some advanced examples need
optional tools such as Python, curl or jq; those tools are not required for normal
GUI operation. `scripts/check-docs.py` checks local Markdown links and agreement
of package/source versions; it does not execute every command or prove an
external link is available.

Current server artifacts cover all six official targets: Linux x64 / ARM64,
macOS Intel / Apple Silicon and Windows x64 / ARM64 MSVC. This server packaging
pass skips runtime tests. The native CI workflow is configured but has not been
run for this candidate; artifact completeness is not native/hardware qualification.
Mock/browser, OS pseudoterminal and Wine checks establish different software
behaviors. Windows 10/11 x64 USB adapters, macOS hardware, driver control lines,
and long-duration high-rate traffic still require the documented hardware pass.
