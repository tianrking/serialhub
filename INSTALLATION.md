# Installing and running SerialHub 0.0.4

SerialHub has one native Rust core with its web workbench embedded. It runs on the
computer attached to the serial adapters. No cloud account or Internet access is
needed to use the installed UI, HTTP API or WebSocket streams. Package-manager
launchers run the same core as portable downloads; they do not reimplement UART I/O.

**Publication status:** the distribution builders and CI checks are in this
repository. Registry registration, a published matching GitHub Release, a Homebrew
tap, WinGet catalog acceptance and a hosted signed APT repository are separate
publication steps. The commands marked “after publication” are not claims that
those names are already available. The PyPI name `serialhub` belongs to another
project; this project's Python distribution is **serialhub-cli**.

## Platform and format status

Status for the **0.0.4 local candidate**, checked 2026-10-20. “Built” means real
native binaries and derived packages exist on the build server; it does not mean
they have been uploaded, accepted by a registry or tested with your USB adapter.
The six native CI jobs are configured but have not run for this candidate because
hosted Actions is paused. All public installation channels below remain **TODO**.

| OS / CPU | Portable archive | Python wheel tag (`py3-none-…`) | Native npm package | Debian package | Actual artifact status |
| --- | --- | --- | --- | --- | --- |
| Windows x64 | `.zip` | `win_amd64` | `win32-x64` | — | **Built** with GNU/MinGW; PE and Wine tests pass; TODO: native Windows/USB qualification and official MSVC build |
| Windows ARM64 | `.zip` | `win_arm64` | `win32-arm64` | — | **TODO: build and validate** |
| Linux x64 | `.tar.gz` | `manylinux_2_39_x86_64` | `linux-x64` | `amd64.deb` | **Built**, actual local installation and headless sharing tests pass |
| Linux ARM64 | `.tar.gz` | `manylinux_2_39_aarch64` | `linux-arm64` | `arm64.deb` | **TODO: build and validate** |
| macOS Intel | `.tar.gz` containing `.app` | `macosx_15_0_x86_64` | `darwin-x64` | — | **TODO: build and validate on a Mac** |
| macOS Apple Silicon | `.tar.gz` containing `.app` | `macosx_15_0_arm64` | `darwin-arm64` | — | **TODO: build and validate on a Mac** |

Each wheel bundles the three native executables for exactly one OS/CPU. There is
no universal `py3-none-any` wheel: copying an x64 executable into an ARM64 wheel
does not provide ARM64 support. Python 3.9+ is required; the core is Rust, not a
Python serial-port library. The npm launcher needs Node.js 18+ and a matching
native package. Linux packages require glibc 2.39+; macOS packages target 15+.
32-bit, musl/Alpine, RISC-V and other targets are **TODO / not supported by the
current package matrix**.

| Public channel | Remaining publication work |
| --- | --- |
| GitHub Release 0.0.4 | **TODO:** upload actual artifacts, download and compare hashes, then publish. Git pushes work here; GitHub API/upload endpoints are blocked by the environment policy. |
| PyPI `serialhub-cli` | **TODO:** register the project/trusted publisher and upload the verified wheels. |
| npm `@tianrking/serialhub` | **TODO:** establish scope ownership/publisher authentication; publish native packages first, launcher last. |
| Homebrew `tianrking/serialhub` | **TODO:** publish the tap and its generated Formula; Mac/Linux x64 and ARM64 URLs require matching public archives. |
| WinGet `tianrking.SerialHub` | **TODO:** submit the generated manifests and obtain catalog acceptance; ZIPs alone do not register the package. |
| APT | **TODO:** configure the production signing key and host the signed repository over HTTPS; a local `.deb` can already be installed directly. |

MSI/MSIX, signed/notarized DMG/PKG, RPM, AppImage, Flatpak, Snap, Chocolatey,
Scoop and Conda distributions are **TODO / not implemented**. The current
distribution scope is the portable archives and package channels in the tables
above; “all formats” means every applicable format in that declared matrix.
Signing an APT index does not sign or notarize the desktop executables.

### Release attachments before registry publication

**Yes: GitHub Release can host every generated package without publishing to
PyPI, npm, Homebrew, WinGet or APT first.** Users then install the downloaded
local files. An incomplete platform build must be labelled with its actual
coverage; it cannot pass the complete six-platform release gate.

A complete release has **25 attachments**: six portable archives, six platform
wheels, six native npm tarballs plus one npm launcher, two Debian packages,
one Homebrew/WinGet manifest bundle, `distribution.json`,
`distribution-coverage.json` and `SHA256SUMS`. The current two-platform candidate
produces **12 attachments**, including two wheels and one amd64 Debian package.
The manifest bundle contains definitions, not published software sources.
The coverage report lists missing platforms and official targets separately;
a GNU Windows candidate never substitutes for the official MSVC build.

```sh
# Build offline packages from verified native archives, without registry access.
python scripts/distribute.py build --directory release-assets --output distribution
# Inspect partial coverage, or require all six targets and every format.
python scripts/distribute.py verify --directory distribution
python scripts/distribute.py verify --directory distribution --require-all
# Complete publication: fails before staging if any platform/format is missing.
python scripts/distribute.py stage --directory distribution --archives release-assets --output upload-assets --require-all
```

For an explicitly labelled partial server candidate, omit `--require-all` from
`stage`; its checksums and coverage report still cover all actual downloads.
Neither form publishes or consumes hosted CI. The manual Release workflow uses
`--require-all`; the individual native CI jobs validate their own generated formats.

## Portable download: double-click and debug

Download a verified archive for your OS/CPU, compare `SHA256SUMS`, and extract it.
Windows users open `serialhub-desktop.exe`; macOS users open `SerialHub.app`;
Linux users run `serialhub-desktop`. The browser opens automatically. The tray or
application menu reopens the page, shows diagnostics and quits all device owners.
Closing a page leaves the owners running. See [DESKTOP.md](DESKTOP.md).

Portable downloads require no Python, Node.js or Rust installation. Linux GNU
artifacts need glibc 2.39+ (Ubuntu 24.04 or compatible); macOS distribution wheels
target macOS 15+. USB drivers and serial-device permissions remain OS-specific.
No macOS/ARM64 binary has been validated on this Linux server; native CI builds
and tests the six targets when explicitly run with allowance available.

## Headless: a browser workbench without a desktop session

```sh
serialhub serve
```

Open **http://127.0.0.1:8787/**. `serve` runs in the foreground, creates no tray and
never opens a browser. It embeds the complete device manager, multi-port terminals,
signal tools, languages and HTTP/WebSocket interfaces. It opens no hardware until
a user explicitly creates a session. It fails if the selected port or its instance
ownership lock is busy; it never silently moves to another port.

```sh
serialhub serve --bind 127.0.0.1:8789
serialhub stop --bind 127.0.0.1:8789
```

Ctrl+C, SIGTERM on Unix, the web Quit action and `stop` release devices and clean
up discovery. `stop` waits for ownership cleanup. No queued commands are replayed.
`--bind 127.0.0.1:0` deliberately selects a free port for tests; use a nonzero port
for a fixed production URL. Desktop double-click mode retains its friendly port
fallback and repeated-launch behavior; it is intentionally a different policy.

`serialhub start` opens the browser and detaches. Use
`serialhub start --no-browser` to detach without opening a browser; `serve` is the no-tray entry point for a service supervisor.
`serialhub --status` reports the default instance and `serialhub stop` quits it.

## Access from another computer

The management listener stays on loopback. On a server, a predictable remote
entry point is an SSH tunnel:

```sh
ssh -L 8787:127.0.0.1:8787 user@device-host
```

Then open http://127.0.0.1:8787/ on your own computer. The UI and WebSockets use the
same tunneled origin. Alternatively, open the host's UI and enable the existing
LAN pairing feature, then use its generated pairing link. LAN sharing is opt-in,
authenticated and HTTP; it is intended for trusted networks. Browser controls,
timers and visualization stop when their page closes; native owners remain alive.

A public HTTPS frontend connecting directly to arbitrary local HTTP devices is
not implemented. Browser origin, local-network access and TLS rules still apply.
Serving the version-matched UI from the core avoids that dependency and works offline.

## Start automatically at user login

```sh
serialhub service install
serialhub service status
serialhub service logs
serialhub service stop
serialhub service start
serialhub service uninstall
```

`install` enables and starts a **per-user login service**, then checks readiness.
It does not request elevation or open the firewall. Use `--bind 127.0.0.1:8789` at
install time to choose a fixed port. Keep the installed executable at its current
path; uninstall/reinstall the service after moving or replacing a portable folder.
`serialhub service install --dry-run` prints the native definition without changes.
Login services use the standard per-user state directory: unset
`SERIALHUB_STATE_DIR` before installing, or supervise `serve` with a custom unit.
An existing unmanaged definition/task is not overwritten. Uninstall preserves
application data and logs. Stop the service before uninstalling its package.

| OS | Native mechanism | Notes |
| --- | --- | --- |
| Linux | `systemd --user`, `serialhub.service` | Requires a working user systemd session; logs use journald. No automatic `sudo` or linger changes. |
| macOS | `~/Library/LaunchAgents/io.serialhub.agent.plist` | Requires a graphical user login domain; logs are under the user's SerialHub service directory. |
| Windows | Current-user Task Scheduler login task | Interactive user login, limited privileges, hidden launcher, no Windows SCM service or administrator account assumed. Task registration policy can deny installation. |

For a server that must start **before login**, use a dedicated OS account and an
administrator-managed systemd service/Windows service supervisor/container that
runs `serialhub serve`. Linux administrators may explicitly enable user lingering.
That is a deployment decision; this CLI does not silently alter host login policy.
A container runs `serve` in the foreground and needs explicit device/PTY permissions.
Do not launch desktop mode as the container's lifetime supervisor.

## Package managers

**TODO — after the corresponding channels are published.** These are future
online installation commands, not working registry-install claims for 0.0.4:

| Channel | Install | Remove |
| --- | --- | --- |
| Python / pipx | `pipx install serialhub-cli` | `pipx uninstall serialhub-cli` |
| Python / venv | `python -m pip install serialhub-cli` | `python -m pip uninstall serialhub-cli` |
| npm | `npm install -g @tianrking/serialhub` | `npm uninstall -g @tianrking/serialhub` |
| Homebrew tap | `brew install tianrking/serialhub/serialhub` | `brew uninstall serialhub` |
| WinGet | `winget install --exact --id tianrking.SerialHub` | `winget uninstall --exact --id tianrking.SerialHub` |
| Debian/Ubuntu APT | `sudo apt install serialhub` after adding the signed source | `sudo apt remove serialhub` |

For a one-command headless trial after registry publication:

```sh
npx --yes @tianrking/serialhub serve
# Or: pipx run --spec serialhub-cli serialhub serve
```

For a durable installation and automatic browser launch, an explicit single line
is `npm install -g @tianrking/serialhub && serialhub`. Installation itself does not
silently launch a daemon or register a login task. Use a persistent installation
before `service install`; temporary npx/pipx-run caches may later be removed.

All install the `serialhub` command. Run it with no arguments for desktop startup,
or use `serialhub serve` for headless operation. Python and Node.js are needed by
their respective package-manager launchers; the native core itself needs neither.

Python wheels contain the core for the wheel's OS/CPU. npm uses platform-specific
optional dependencies: do not install with `--omit=optional` in normal use.
Neither uses an executable `postinstall` downloader or compiles Rust on the user's
computer. Each launcher verifies the bundled executable's SHA-256 before running.
Unsupported OS/CPU/libc combinations fail; they do not download a guessed binary.
Do not install multiple channels that each claim the same command in PATH.

Homebrew's Formula also supports `brew services start serialhub` and
`brew services stop serialhub`; use either Homebrew services or the native
`serialhub service` manager for an instance, rather than enabling both.

### Install artifacts locally before registration

Generated artifacts can be installed without any registry account:

```sh
python -m pip install ./distribution/python/serialhub_cli-0.0.4-py3-none-manylinux_2_39_x86_64.whl
npm install -g ./distribution/npm/tianrking-serialhub-linux-x64-0.0.4.tgz ./distribution/npm/tianrking-serialhub-0.0.4.tgz
sudo apt install ./distribution/debian/serialhub_0.0.4_amd64.deb
```

Release attachments are flattened into one directory. After downloading the
matching wheel and verifying its checksum, a Windows x64 user can run:

```powershell
py -m venv .serialhub-venv
.\.serialhub-venv\Scripts\python.exe -m pip install --no-index .\serialhub_cli-0.0.4-py3-none-win_amd64.whl
.\.serialhub-venv\Scripts\serialhub.exe
# Foreground server instead of desktop: add "serve"; Ctrl+C stops it.
# Stop a running desktop instance:
.\.serialhub-venv\Scripts\serialhub.exe stop
```

Linux x64, using the downloaded flat attachments:

```sh
python3 -m venv .serialhub-venv
.serialhub-venv/bin/python -m pip install --no-index ./serialhub_cli-0.0.4-py3-none-manylinux_2_39_x86_64.whl
.serialhub-venv/bin/serialhub serve
```

To install npm attachments without a registry request, download **both** the
launcher and native tarball for your OS/CPU (this example is Windows x64):

```sh
npm install -g --offline --ignore-scripts --omit=optional ./tianrking-serialhub-win32-x64-0.0.4.tgz ./tianrking-serialhub-0.0.4.tgz
serialhub
```

Replace `win32-x64` with `linux-x64` for the built Linux x64 candidate. This
deliberate local-install combination supplies the native package explicitly;
normal registry installations must keep optional dependencies enabled. Portable
desktop archives remain the easiest option when Python/Node.js are not installed.

Select the files matching your OS/CPU. Python's installer checks wheel platform
compatibility. For a fully offline local npm installation, include the native
platform tarball explicitly and pass `--offline --omit=optional --ignore-scripts`;
that test-only combination supplies the native package as a direct dependency.

### Add an APT source after hosting

The maintainer must host the generated signed repository and publish the signing
key fingerprint independently. Replace the example URL with the actual repository
address; this project does not currently claim an active APT domain.

```sh
# Download and verify the repository signing key before installing it.
# Store the verified binary key as /etc/apt/keyrings/serialhub.gpg.
echo 'deb [signed-by=/etc/apt/keyrings/serialhub.gpg] https://YOUR-REPOSITORY/apt stable main' | sudo tee /etc/apt/sources.list.d/serialhub.list
sudo apt update
sudo apt install serialhub
```

Do not use `trusted=yes` or disable signature checking. Removing the application
preserves configuration; remove the source/key separately if no longer wanted.

## Maintainer build, verification and publication

1. Build the committed web assets, then all native binaries with `--locked`.
2. Package each actual native target using `scripts/release.py`; source commit,
   version, architecture and file hashes must agree.
3. Generate channel artifacts offline:

   ```sh
   python scripts/distribute.py build --directory release-assets --output distribution
   python scripts/smoke-distributions.py --directory distribution --target x86_64-unknown-linux-gnu
   python scripts/check-winget.py --directory distribution/winget
   python scripts/smoke-apt.py --directory distribution/debian
   ```

4. Build and sign a repository with the maintainer's GPG identity:

   ```sh
   python scripts/distribute.py apt --directory distribution/debian --output apt --signing-key YOUR-KEY-FINGERPRINT
   ```

   Without `--signing-key`, output is explicitly unsigned inspection material.
   It is not ready for public APT use. Never use CI's disposable test key to sign
   production releases.
5. Publish a matching immutable GitHub Release before distributing generated
   Homebrew/WinGet URLs. Register/control the npm scope and PyPI project, configure
   their publishing credentials/trusted publisher, publish the native npm packages
   before the npm launcher, and upload the platform wheels to PyPI. Submit the
   WinGet manifests for catalog review; publish the Formula in the named tap.
6. The manual **Publish package managers** workflow prepares the complete artifacts
   and can publish npm/PyPI only when explicitly requested. GitHub Actions remains
   manual for release tags; local commits carry `[skip ci]` while allowance is paused.

### Publishing account configuration

Configure these in GitHub **Settings → Environments** before choosing publication
options; never put credential values in source files or chat:

- **npm**: control the `@tianrking` scope and configure npm trusted publishing for
  this repository/workflow, or set its scoped `NPM_TOKEN` environment secret.
- **pypi**: register `serialhub-cli` with a PyPI pending/trusted publisher for
  repository `tianrking/serialhub`, workflow `package-managers.yml`, environment
  `pypi`. PyPI's `serialhub` name is already owned by another project.
- **apt**: set the `APT_SIGNING_KEY` secret (dedicated unattended armored signing
  key) and `APT_SIGNING_FINGERPRINT` variable. The generated repository must be
  hosted over HTTPS; publish the public fingerprint independently. The workflow
  signs and uploads an artifact, and does not replace an existing website.
- **Homebrew**: create/control `tianrking/homebrew-serialhub` and commit the
  generated `homebrew/serialhub.rb` as `Formula/serialhub.rb` there. The tap command
  shown above becomes available only after that repository is published.
- **WinGet**: submit the generated `winget/t/tianrking/SerialHub/<version>/` files
  to Microsoft's `winget-pkgs` repository; catalog acceptance is required for the
  public `winget install` command. Portable package/entry-point and schema checks
  are performed before submission.

CI builds six native targets, installs real wheel/npm artifacts and executes their
headless HTTP/WS workbench, tests signed APT installation/removal on Linux, and
installs/removes the Formula on macOS. WinGet schemas are validated offline, with
native `winget validate` additionally used when available. Registry availability,
WinGet catalog review, production APT hosting and real USB hardware acceptance are
separate checks; configured CI is not evidence it has run for a local candidate.
