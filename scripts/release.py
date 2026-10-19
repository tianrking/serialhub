#!/usr/bin/env python3
"""Build, validate and smoke-test release archives using only Python 3.11+."""
import argparse
import hashlib
import io
import plistlib
import json
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys
import tarfile
import tempfile
import tomllib
import zipfile

ROOT = Path(__file__).resolve().parent.parent
TARGETS = (
    "x86_64-unknown-linux-gnu", "aarch64-unknown-linux-gnu",
    "x86_64-apple-darwin", "aarch64-apple-darwin",
    "x86_64-pc-windows-msvc", "aarch64-pc-windows-msvc",
)
SUPPORTED_TARGETS = TARGETS + ("x86_64-pc-windows-gnu",)
DOCS = (
    "README.md", "README.zh-CN.md", "README.es.md", "LICENSE", "MIGRATION.md",
    "CHANGELOG.md", "RELEASE_NOTES.md", "GETTING_STARTED.zh-CN.md", "OPERATIONS.md", "I18N.md",
    "SSCOM_PARITY.zh-CN.md", "VOFA_PARITY.zh-CN.md", "WINDOWS_COM_BRIDGE.md",
    "RELEASING.md", "serialhub.example.toml", "web/PROTOCOL.zh-TW.md",
    "scripts/smoke-sharing.py", "scripts/smoke-manager.py", "scripts/smoke-launcher.py", "DESKTOP.md",
    "POSITIONING.md", "RELIABILITY_TEST_MATRIX.md",
)
MANIFEST = "release-manifest.json"


def require(condition, message):
    if not condition:
        raise ValueError(message)


def git(*args):
    return subprocess.check_output(["git", *args], cwd=ROOT, text=True).strip()


def version():
    cargo = tomllib.loads((ROOT / "Cargo.toml").read_text(encoding="utf-8"))["package"]["version"]
    web = json.loads((ROOT / "web/package.json").read_text(encoding="utf-8"))["version"]
    lock = json.loads((ROOT / "web/package-lock.json").read_text(encoding="utf-8"))
    rust = tomllib.loads((ROOT / "Cargo.lock").read_text(encoding="utf-8"))
    rust_version = next(p["version"] for p in rust["package"] if p["name"] == "serialhub")
    require(cargo == web == lock["version"] == lock["packages"][""]["version"] == rust_version,
            "Cargo, npm and lockfile versions must agree")
    require(re.fullmatch(r"\d+\.\d+\.\d+", cargo), "Expected a stable semantic version")
    return cargo


def binary_names(target):
    require(target in SUPPORTED_TARGETS, f"Unsupported target: {target}")
    suffix = ".exe" if "windows" in target else ""
    return ["serialhub" + suffix, "ohmyserial" + suffix, "serialhub-desktop" + suffix]


MAC_EXECUTABLE = "SerialHub.app/Contents/MacOS/SerialHub"
MAC_PLIST = "SerialHub.app/Contents/Info.plist"


def extra_files(target, release_version):
    if "darwin" not in target:
        return {}
    return {MAC_PLIST: plistlib.dumps({
        "CFBundleExecutable": "SerialHub", "CFBundleIdentifier": "io.serialhub.desktop",
        "CFBundleName": "SerialHub", "CFBundlePackageType": "APPL",
        "CFBundleShortVersionString": release_version, "CFBundleVersion": release_version,
        "LSUIElement": True, "NSHighResolutionCapable": True, "CFBundleIconFile": "SerialHub.icns",
    }), "SerialHub.app/Contents/Resources/SerialHub.icns": (ROOT / "assets/serialhub.icns").read_bytes()}


def executable_paths(target):
    return binary_names(target) + ([MAC_EXECUTABLE] if "darwin" in target else [])


def check_architecture(data, target):
    arm = target.startswith("aarch64")
    if "linux" in target:
        require(data[:5] == b"\x7fELF\x02" and data[5:6] == b"\x01", "Expected little-endian ELF64")
        machine = int.from_bytes(data[18:20], "little")
        require(machine == (183 if arm else 62), f"ELF architecture mismatch: {target}")
    elif "darwin" in target:
        require(data[:4] == b"\xcf\xfa\xed\xfe", "Expected little-endian Mach-O 64")
        machine = int.from_bytes(data[4:8], "little")
        require(machine == (0x100000C if arm else 0x1000007), f"Mach-O architecture mismatch: {target}")
    else:
        require(data[:2] == b"MZ" and len(data) >= 64, "Expected Windows PE executable")
        offset = int.from_bytes(data[60:64], "little")
        require(data[offset:offset + 4] == b"PE\0\0", "Invalid PE signature")
        machine = int.from_bytes(data[offset + 4:offset + 6], "little")
        require(machine == (0xAA64 if arm else 0x8664), f"PE architecture mismatch: {target}")


def digest(data):
    return hashlib.sha256(data).hexdigest()


def package(target, binary_dir, output, release_version, commit, root=ROOT):
    files = {name: (root / name).read_bytes() for name in DOCS}
    for name in binary_names(target):
        files[name] = (binary_dir / name).read_bytes()
        check_architecture(files[name], target)
    files.update(extra_files(target, release_version))
    if "darwin" in target:
        files[MAC_EXECUTABLE] = files["serialhub-desktop"]
    manifest = {"format": "serialhub.release.v1", "version": release_version,
                "target": target, "commit": commit,
                "files": {name: {"sha256": digest(data), "size": len(data)}
                          for name, data in sorted(files.items())}}
    files[MANIFEST] = (json.dumps(manifest, indent=2) + "\n").encode()
    stage = f"serialhub-v{release_version}-{target}"
    output.mkdir(parents=True, exist_ok=True)
    archive = output / (stage + (".zip" if "windows" in target else ".tar.gz"))
    if archive.suffix == ".zip":
        with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as bundle:
            for name, data in sorted(files.items()):
                bundle.writestr(stage + "/" + name, data)
    else:
        with tarfile.open(archive, "w:gz") as bundle:
            for name, data in sorted(files.items()):
                info = tarfile.TarInfo(stage + "/" + name)
                info.size = len(data)
                info.mode = 0o755 if name in executable_paths(target) else 0o644
                bundle.addfile(info, io.BytesIO(data))
    verify_archive(archive, release_version, commit)
    return archive


def read_archive(archive):
    entries = {}

    def add(name, size, read):
        path = PurePosixPath(name)
        require(not path.is_absolute() and ".." not in path.parts and "\\" not in name,
                f"Unsafe archive path: {name}")
        require(name not in entries, f"Duplicate archive entry: {name}")
        require(0 <= size <= 100_000_000 and len(entries) < 100, "Archive size limit exceeded")
        entries[name] = read()
        require(len(entries[name]) == size, f"Truncated archive entry: {name}")

    if archive.suffix == ".zip":
        with zipfile.ZipFile(archive) as bundle:
            for item in bundle.infolist():
                require(not item.is_dir(), "Unexpected archive directory entry")
                add(item.filename, item.file_size, lambda: bundle.read(item))
    else:
        with tarfile.open(archive, "r:gz") as bundle:
            for item in bundle:
                require(item.isfile(), "Archive links and special entries are forbidden")
                add(item.name, item.size, lambda: bundle.extractfile(item).read())
    return entries


def verify_archive(archive, release_version, commit):
    entries = read_archive(archive)
    manifests = [name for name in entries if name.endswith("/" + MANIFEST)]
    require(len(manifests) == 1, "Expected exactly one release manifest")
    manifest = json.loads(entries[manifests[0]])
    target = manifest["target"]
    require(target in SUPPORTED_TARGETS and manifest["format"] == "serialhub.release.v1", "Invalid release manifest")
    require(manifest["version"] == release_version, "Archive version mismatch")
    require(manifest["commit"] == commit, "Archive source commit mismatch")
    stage = f"serialhub-v{release_version}-{target}"
    extension = ".zip" if "windows" in target else ".tar.gz"
    require(archive.name == stage + extension, "Archive filename does not match its manifest")
    expected = set(DOCS) | set(executable_paths(target)) | set(extra_files(target, release_version))
    require(set(manifest["files"]) == expected, "Missing or unexpected packaged files")
    require(set(entries) == {stage + "/" + name for name in expected | {MANIFEST}},
            "Archive contents do not match manifest")
    for name, metadata in manifest["files"].items():
        data = entries[stage + "/" + name]
        require(len(data) == metadata["size"] and digest(data) == metadata["sha256"],
                f"Checksum mismatch: {name}")
    for name in executable_paths(target):
        check_architecture(entries[stage + "/" + name], target)
    for name, data in extra_files(target, release_version).items():
        require(entries[stage + "/" + name] == data, f"Invalid launcher metadata: {name}")
    if "darwin" in target:
        require(entries[stage + "/" + MAC_EXECUTABLE] == entries[stage + "/serialhub-desktop"],
                "Mac app executable differs from desktop launcher")
    return manifest, entries


def verify_directory(directory, release_version, commit, require_all=False, checksums=False):
    archives = sorted(path for path in directory.iterdir() if path.name.endswith((".zip", ".tar.gz")))
    require({p.name for p in directory.iterdir()} <= {p.name for p in archives} | {"SHA256SUMS"},
            "Unexpected release asset")
    targets = []
    for archive in archives:
        manifest, _ = verify_archive(archive, release_version, commit)
        targets.append(manifest["target"])
    require(archives and len(targets) == len(set(targets)), "Missing or duplicate release target")
    if require_all:
        require(set(targets) == set(TARGETS), "Release must contain all six target archives")
    if checksums:
        (directory / "SHA256SUMS").write_text(
            "".join(f"{digest(path.read_bytes())}  {path.name}\n" for path in archives), encoding="utf-8")
    return archives


def test_package(archive, release_version, commit):
    manifest, entries = verify_archive(archive, release_version, commit)
    stage = f"serialhub-v{release_version}-{manifest['target']}"
    with tempfile.TemporaryDirectory(prefix="serialhub-release-") as tmp:
        destination = Path(tmp)
        # Write only already validated regular files, without archive extraction APIs.
        for name, data in entries.items():
            file = destination / name
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_bytes(data)
        for name in executable_paths(manifest["target"]):
            binary = destination / stage / name
            binary.chmod(0o755)
            result = subprocess.check_output([str(binary), "--version"], text=True, timeout=15).strip()
            require(result == f"serialhub {release_version}", f"Wrong executable version: {result}")
        subprocess.run([sys.executable, str(destination / stage / "scripts/smoke-sharing.py"),
                        "--binary", str(destination / stage / binary_names(manifest["target"])[0])],
                       check=True, timeout=60)
        subprocess.run([sys.executable, str(destination / stage / "scripts/smoke-manager.py"),
                        "--binary", str(destination / stage / binary_names(manifest["target"])[2])],
                       check=True, timeout=60)
        subprocess.run([sys.executable, str(destination / stage / "scripts/smoke-launcher.py"),
                        "--binary", str(destination / stage / binary_names(manifest["target"])[2])],
                       check=True, timeout=60)
    print("PACKAGE_SMOKE_OK", archive.name)


def compare_directories(expected, actual):
    names = {p.name for p in expected.iterdir() if p.is_file()}
    require(names == {p.name for p in actual.iterdir() if p.is_file()}, "Uploaded release assets differ")
    for name in names:
        require(digest((expected / name).read_bytes()) == digest((actual / name).read_bytes()),
                f"Downloaded asset checksum mismatch: {name}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["check", "package", "test-package", "verify", "compare"])
    parser.add_argument("--tag", default="")
    parser.add_argument("--require-main", action="store_true")
    parser.add_argument("--github-output", type=Path)
    parser.add_argument("--target", choices=SUPPORTED_TARGETS)
    parser.add_argument("--binary-dir", type=Path)
    parser.add_argument("--directory", "--output", dest="directory", type=Path, default=Path("dist"))
    parser.add_argument("--actual", type=Path)
    parser.add_argument("--require-all", action="store_true")
    parser.add_argument("--write-checksums", action="store_true")
    args = parser.parse_args()
    current_version = version()
    commit = git("rev-parse", "HEAD")
    if args.tag:
        require(args.tag == "v" + current_version, "Tag must match the checked-out package version")
    if args.command == "check":
        if args.require_main:
            require(args.tag, "A release tag is required")
            require(git("rev-parse", "--verify", f"refs/tags/{args.tag}^{{commit}}") == commit,
                    "Checkout must match the existing release tag")
            subprocess.run(["git", "merge-base", "--is-ancestor", commit, "origin/main"], cwd=ROOT, check=True)
        if args.github_output:
            with args.github_output.open("a", encoding="utf-8") as stream:
                stream.write(f"version={current_version}\ntag=v{current_version}\nsha={commit}\n")
        print("RELEASE_METADATA_OK", current_version, commit)
    elif args.command == "package":
        require(args.target and args.binary_dir, "--target and --binary-dir are required")
        print(package(args.target, args.binary_dir, args.directory, current_version, commit))
    elif args.command == "test-package":
        require(args.target, "--target is required")
        archives = [p for p in verify_directory(args.directory, current_version, commit)
                    if verify_archive(p, current_version, commit)[0]["target"] == args.target]
        require(len(archives) == 1, "Expected one native package")
        test_package(archives[0], current_version, commit)
    elif args.command == "verify":
        archives = verify_directory(args.directory, current_version, commit,
                                    args.require_all, args.write_checksums)
        print("RELEASE_ASSETS_OK", len(archives), "archives", commit)
    else:
        require(args.actual, "--actual is required")
        compare_directories(args.directory, args.actual)
        print("RELEASE_DOWNLOADS_OK")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, subprocess.SubprocessError) as error:
        sys.exit(f"Release validation failed: {error}")
