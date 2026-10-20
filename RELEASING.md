# Building and publishing SerialHub

The native release workflow targets portable archives for Linux x86_64 / ARM64, macOS Intel /
Apple Silicon, and Windows x86_64 / ARM64. Each archive includes the primary
`serialhub` executable, the 0.x `ohmyserial` compatibility executable, the `serialhub-desktop` launcher, offline
documentation, a sample profile, and a per-file SHA-256 provenance manifest.
The web interface and all six language catalogs are embedded in each executable.
Users do not need Node.js or Rust to run these packages.

## Release acceptance

The current source/local candidate is **0.0.4**. This is not a published six-platform release.
With hosted CI paused, use the local-build path below; do not tag or dispatch Actions.

1. Update `Cargo.toml`, `Cargo.lock`, `web/package.json`, and
   `web/package-lock.json` to the same version. Update the changelog, current
   release notes and README release links.
2. Push the commit to `main` and require its **CI / all green** result.
3. Create and push an annotated tag matching that exact version, for example:

   ```bash
   git tag -a v0.0.4 -m "SerialHub v0.0.4"
   git push origin v0.0.4
   ```

4. If hosted CI is available, explicitly run **Release** with the existing tag
   using **Run workflow**. Tag creation does not start Actions. A successful tag
   push alone does not establish that a downloadable release exists.
5. Confirm all six platform archives and `SHA256SUMS` appear on the Release page.

The Release workflow resolves an existing tag to an immutable commit, verifies
version agreement and ancestry from `main`, then reuses the complete CI workflow.
Manual dispatch takes an existing tag and checks out that tag, rather than
building the branch from which the workflow was dispatched.

CI checks both Node.js 22 and 24, translation coverage, frontend tests, lint,
committed production assets, release-validator tests, Rust formatting and clippy.
The workflow requires all six native runners to execute applicable Rust tests, build with `--locked`,
validate executable architecture, and extract and run the actual archive.
Package smoke checks cover all three executable versions and the macOS app launcher, the embedded English UI
and local JS/CSS/language assets, shared binary RX and token-protected TX.
Linux x86_64 also runs the browser suite against the release binary.

Publication requires exactly six distinct archives from the same source commit
and version. Missing files, a wrong architecture, changed file hashes or a
missing compatibility executable fail validation. The workflow creates a draft,
uploads the archives and `SHA256SUMS`, downloads all uploaded assets, and checks
their SHA-256 digests before making the release public. Failed runs leave a draft
instead of a partially populated public release. Re-running may update a draft;
an already published release is never overwritten by the workflow.

## Package verification and startup

On Linux:

```bash
sha256sum --ignore-missing -c SHA256SUMS
tar -xzf serialhub-v0.0.4-x86_64-unknown-linux-gnu.tar.gz
cd serialhub-v0.0.4-x86_64-unknown-linux-gnu
./serialhub --version
./serialhub share mock:demo --pty 0 --ui
```

On macOS, use `shasum -a 256 <archive>` and compare the result with
`SHA256SUMS`. On Windows, use `Get-FileHash <archive> -Algorithm SHA256`,
extract the ZIP, then run `.\serialhub.exe share mock:demo --ui` in PowerShell.
Open `http://127.0.0.1:8787/` if the browser does not open automatically.
To exercise shared access from an extracted package:

```bash
python3 scripts/smoke-sharing.py --binary ./serialhub
```

Use `python` and `.\serialhub.exe` on Windows.

The GNU/Linux packages are built and tested on Ubuntu 24.04 (glibc 2.39); build
from source for older distributions. The configured native macOS runners use macOS 15. A configured job is not evidence that it ran for this candidate.
Archives are not signed/notarized installers; normal operating-system trust
and serial-device permissions still apply. Hardware-specific drivers may be
required for USB adapters. CI uses mock devices and, on Linux, a pseudoterminal
for baud-setting tests; Darwin PTYs reject the hardware baud ioctl and cannot
substitute for a physical macOS adapter. Target-device and long-duration hardware
acceptance remain separate from cross-platform package validation.


## Local builds when hosted CI is unavailable

The Release workflow is manual-only: creating a `v*` tag does not trigger it.
For server publication, do not dispatch a workflow. Build and test the supported
packages on the server, create a draft release pointing to the exact source commit,
upload the archives and `SHA256SUMS`, download them again and compare every hash,
then publish. A release containing only Linux x64 GNU and Windows x64 GNU must
state that coverage explicitly; do not present it as a six-platform release.

Commit the reviewed sources with `[skip ci]` when explicitly avoiding hosted
Actions usage. Build `web/dist` first, then all three Rust binaries. Never attach
an old executable to a newer source/version manifest and never overwrite a
published release/tag. Run `scripts/release.py` checks and extracted-package smoke
tests before a manual upload. GitHub API/Release write authorization is required;
Git transport access alone does not establish API upload access.

Linux can build Windows x64 GNU candidates with a local MinGW toolchain:
`cargo build --locked --release --target x86_64-pc-windows-gnu --bins`.
Set `CARGO_TARGET_X86_64_PC_WINDOWS_GNU_LINKER` and `WINDRES` if the cross tools
are outside PATH. Package this as `x86_64-pc-windows-gnu`, preserving its actual
toolchain identity. The six native release targets and `--require-all` gate remain
unchanged. Static PE/resource/import checks and Wine smoke tests are additional
checks; they do not replace Windows hardware acceptance. macOS native packages
require a Mac/Apple SDK and runtime verification before publication.

Current local candidate coverage: Linux x86_64 GNU and Windows x86_64 GNU only.
Check the manifest source commit and `SHA256SUMS`; Wine compatibility tests do not
qualify Windows 10/11 USB hardware. No macOS/ARM64 candidate is supplied by this
Linux environment. GitHub Release upload has not completed.
