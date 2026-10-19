# Building and publishing SerialHub

Releases contain portable archives for Linux x86_64 / ARM64, macOS Intel /
Apple Silicon, and Windows x86_64 / ARM64. Each archive includes the primary
`serialhub` executable, the 0.x `ohmyserial` compatibility executable, offline
documentation, a sample profile, and a per-file SHA-256 provenance manifest.
The web interface and all six language catalogs are embedded in each executable.
Users do not need Node.js or Rust to run these packages.

## Release acceptance

1. Update `Cargo.toml`, `Cargo.lock`, `web/package.json`, and
   `web/package-lock.json` to the same version. Update the changelog, current
   release notes and README release links.
2. Push the commit to `main` and require its **CI / all green** result.
3. Create and push an annotated tag matching that exact version, for example:

   ```bash
   git tag -a v0.1.0 -m "SerialHub v0.1.0"
   git push origin v0.1.0
   ```

4. Follow the **Release** workflow through publication. A successful tag push
   alone does not establish that a downloadable release exists.
5. Confirm all six platform archives and `SHA256SUMS` appear on the Release page.

The Release workflow resolves an existing tag to an immutable commit, verifies
version agreement and ancestry from `main`, then reuses the complete CI workflow.
Manual dispatch takes an existing tag and checks out that tag, rather than
building the branch from which the workflow was dispatched.

CI checks both Node.js 22 and 24, translation coverage, frontend tests, lint,
committed production assets, release-validator tests, Rust formatting and clippy.
All six native runners execute applicable Rust tests, build with `--locked`,
validate executable architecture, and extract and run the actual archive.
Package smoke checks cover both executable versions, the embedded English UI
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
tar -xzf serialhub-v0.1.0-x86_64-unknown-linux-gnu.tar.gz
cd serialhub-v0.1.0-x86_64-unknown-linux-gnu
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
from source for older distributions. Native macOS acceptance runs on macOS 15.
Archives are not signed/notarized installers; normal operating-system trust
and serial-device permissions still apply. Hardware-specific drivers may be
required for USB adapters. CI uses mock devices and, on Linux, a pseudoterminal
for baud-setting tests; Darwin PTYs reject the hardware baud ioctl and cannot
substitute for a physical macOS adapter. Target-device and long-duration hardware
acceptance remain separate from cross-platform package validation.
