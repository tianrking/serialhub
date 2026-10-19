import importlib.util
import json
from pathlib import Path
import struct
import tempfile
import unittest
from unittest.mock import patch
import zipfile

SPEC = importlib.util.spec_from_file_location("release", Path(__file__).parents[1] / "release.py")
release = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(release)
VERSION = "0.1.0"
COMMIT = "a" * 40


def executable(target):
    data = bytearray(256)
    arm = target.startswith("aarch64")
    if "linux" in target:
        data[:6] = b"\x7fELF\x02\x01"
        struct.pack_into("<H", data, 18, 183 if arm else 62)
    elif "darwin" in target:
        data[:4] = b"\xcf\xfa\xed\xfe"
        struct.pack_into("<I", data, 4, 0x100000C if arm else 0x1000007)
    else:
        data[:2] = b"MZ"
        struct.pack_into("<I", data, 60, 128)
        data[128:132] = b"PE\0\0"
        struct.pack_into("<H", data, 132, 0xAA64 if arm else 0x8664)
    return bytes(data)


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.binaries = self.root / "binaries"
        self.output = self.root / "output"
        self.binaries.mkdir()
        for name in release.DOCS:
            file = self.root / name
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_text("offline documentation\n", encoding="utf-8")

    def package(self, target):
        for name in release.binary_names(target):
            (self.binaries / name).write_bytes(executable(target))
        return release.package(target, self.binaries, self.output, VERSION, COMMIT, self.root)

    def test_all_six_architectures_and_complete_release(self):
        for target in release.TARGETS:
            archive = self.package(target)
            manifest, _ = release.verify_archive(archive, VERSION, COMMIT)
            self.assertEqual(manifest["target"], target)
        archives = release.verify_directory(self.output, VERSION, COMMIT, True, True)
        self.assertEqual(len(archives), 6)
        self.assertEqual(len((self.output / "SHA256SUMS").read_text().splitlines()), 6)
        release.compare_directories(self.output, self.output)

    def test_missing_platform_cannot_publish(self):
        self.package(release.TARGETS[0])
        with self.assertRaisesRegex(ValueError, "all six"):
            release.verify_directory(self.output, VERSION, COMMIT, True)

    def test_wrong_binary_architecture_is_rejected(self):
        for target in release.TARGETS:
            other = next(t for t in release.TARGETS
                         if t.split("-", 1)[1] == target.split("-", 1)[1] and t != target)
            with self.assertRaisesRegex(ValueError, "architecture mismatch"):
                release.check_architecture(executable(other), target)

    def test_missing_compatibility_executable_is_rejected(self):
        target = release.TARGETS[0]
        (self.binaries / "serialhub").write_bytes(executable(target))
        with self.assertRaises(FileNotFoundError):
            release.package(target, self.binaries, self.output, VERSION, COMMIT, self.root)

    def test_tampered_package_is_rejected(self):
        archive = self.package("x86_64-pc-windows-msvc")
        entries = release.read_archive(archive)
        name = next(name for name in entries if name.endswith("/serialhub.exe"))
        entries[name] += b"changed"
        with zipfile.ZipFile(archive, "w") as bundle:
            for name, data in entries.items():
                bundle.writestr(name, data)
        with self.assertRaisesRegex(ValueError, "Checksum mismatch"):
            release.verify_archive(archive, VERSION, COMMIT)

    def test_archive_cannot_escape_the_extraction_directory(self):
        archive = self.output / "unsafe.zip"
        self.output.mkdir()
        with zipfile.ZipFile(archive, "w") as bundle:
            bundle.writestr("../outside", "unexpected")
        with self.assertRaisesRegex(ValueError, "Unsafe archive path"):
            release.read_archive(archive)

    def test_wrong_version_or_source_commit_is_rejected(self):
        archive = self.package(release.TARGETS[0])
        with self.assertRaisesRegex(ValueError, "version mismatch"):
            release.verify_archive(archive, "0.2.0", COMMIT)
        with self.assertRaisesRegex(ValueError, "source commit mismatch"):
            release.verify_archive(archive, VERSION, "b" * 40)

    def test_missing_download_is_rejected(self):
        self.output.mkdir()
        (self.output / "SHA256SUMS").write_text("checksums")
        actual = self.root / "downloaded"
        actual.mkdir()
        with self.assertRaisesRegex(ValueError, "assets differ"):
            release.compare_directories(self.output, actual)

    def test_extra_asset_cannot_be_published(self):
        self.package(release.TARGETS[0])
        (self.output / "unreviewed.exe").write_bytes(b"unexpected")
        with self.assertRaisesRegex(ValueError, "Unexpected release asset"):
            release.verify_directory(self.output, VERSION, COMMIT)

    def test_manifest_versions_must_agree_across_both_lockfiles(self):
        (self.root / "Cargo.toml").write_text('[package]\nversion = "0.1.0"\n')
        (self.root / "Cargo.lock").write_text('[[package]]\nname = "serialhub"\nversion = "0.1.0"\n')
        (self.root / "web/package.json").write_text(json.dumps({"version": VERSION}))
        lock = {"version": VERSION, "packages": {"": {"version": VERSION}}}
        (self.root / "web/package-lock.json").write_text(json.dumps(lock))
        with patch.object(release, "ROOT", self.root):
            self.assertEqual(release.version(), VERSION)
            lock["packages"][""]["version"] = "0.0.2"
            (self.root / "web/package-lock.json").write_text(json.dumps(lock))
            with self.assertRaisesRegex(ValueError, "versions must agree"):
                release.version()


if __name__ == "__main__":
    unittest.main()
