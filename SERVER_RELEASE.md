# Server builds without hosted CI

This is the source-checkout workflow for maintainers. End users install the
[portable or package-manager files](INSTALLATION.md); they do not need a compiler,
SDK, Python or Node.js to open a portable desktop download.

The builder produces six real native targets, six Python wheels, six native npm
packages plus the launcher, two Debian packages and the Homebrew/WinGet definitions.
The final download directory has 25 attachments including metadata, coverage and
`SHA256SUMS`. Registry accounts are not needed to generate or download these files.

## Build tools

On a Linux build server, provide Python 3.11+, Rust, LLVM with `clang`, `lld-link`, `llvm-lib`
and `llvm-rc`, and a macOS 15 SDK in a directory you are licensed to use.
The server build used Rust 1.99.1, LLVM 19.1.7 and the Python tool versions pinned
in `scripts/server-build-requirements.txt`. The SDK is a build dependency and is
not included in SerialHub downloads. Keep inherited proxy and CA settings intact.

```sh
python3 -m venv target/release-tools
. target/release-tools/bin/activate
python -m pip install -r scripts/server-build-requirements.txt
rustup target add x86_64-unknown-linux-gnu aarch64-unknown-linux-gnu \
  x86_64-apple-darwin aarch64-apple-darwin \
  x86_64-pc-windows-msvc aarch64-pc-windows-msvc

# Set this to the actual supplied SDK directory, containing SDKSettings.json.
export SERIALHUB_MACOS_SDK=/path/to/MacOSX15.0.sdk
export XDG_CACHE_HOME="$PWD/target/build-cache"
export XWIN_CACHE_DIR="$PWD/target/msvc-sdk"
cargo xwin cache windows-msvc-sysroot
```

The Windows build uses cargo-xwin's `clang` backend and its provisioned MSVC
sysroot. Resource compilation embeds the app icon, DPI manifest and version
information, including on a Linux host. The Rust configuration links the CRT
statically, so a separate Visual C++ redistributable is not an installation step.
Linux cross builds target glibc 2.39. The macOS `.app` metadata and Python wheel
tags consistently declare the supported minimum as 15.0. A lower linker-reported
Mach-O deployment minimum does not establish support for older macOS versions.

## Generate the complete release

Commit the sources first, using `[skip ci]` when hosted Actions must remain paused.
Output directories must be empty so stale files cannot enter a new version.

```sh
python scripts/build-server-release.py \
  --macos-sdk "$SERIALHUB_MACOS_SDK" \
  --output target/server-release
```

The command runs compilation and package identity/hash checks. **It does not run
Rust, browser, installation or physical-hardware tests.** Artifact completeness
and runtime qualification are separate: `distribution-coverage.json` explicitly
describes the scope of its `complete` flag. A package generation success must
never be described as a six-platform test result.

To reuse actual binaries built in separate directories, pass `--skip-build` and
one `--binary-dir TARGET=/actual/path` per target. For example, the Linux x64
directory may be `target/release`, whereas cross builds normally use
`target/TRIPLE/release`. Binary headers must match the declared CPU/OS. A Windows
GNU file cannot be labelled MSVC; an x64 binary cannot supply an ARM64 package.
`--build-only --target TRIPLE` builds selected targets without creating archives.

## Upload all formats, then publish

Push the exact source commit to `main`. Release publication requires GitHub
asset-upload permission as well as repository/API permission; successful Git
pushes or draft creation do not establish upload authorization.

```sh
python scripts/publish-release.py \
  --native target/server-release/native \
  --distribution target/server-release/distribution \
  --directory target/server-release/downloads
```

The publisher requires all six official targets and all applicable package
formats. It creates or resumes a draft, uploads the complete flat directory,
downloads and compares its bytes, then publishes. An authentication failure leaves
the draft unpublished. A previously published release or conflicting tag is never
overwritten. This workflow does not dispatch GitHub Actions; the Release workflow
also remains manual-only.

PyPI/npm publication, a Homebrew tap, WinGet catalog acceptance and a production
signed APT repository remain explicit separate steps. Until those steps are done,
users install local Release files rather than unresolved online package names.
See the [platform matrix and installation examples](INSTALLATION.md).
