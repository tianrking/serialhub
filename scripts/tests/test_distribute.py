import importlib.util
import json
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest
import zipfile

from test_release import executable

SPEC = importlib.util.spec_from_file_location('distribute', Path(__file__).parents[1] / 'distribute.py')
distribute = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(distribute)
release = distribute.release
VERSION = '0.0.4'
COMMIT = 'a' * 40


class DistributionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.native = self.root / 'native'
        self.output = self.root / 'packages'
        self.bin = self.root / 'bin'
        self.bin.mkdir()
        self.source = self.root / 'source'
        for name in release.DOCS:
            path = self.source / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b'offline documentation\n')

    def archive(self, target):
        for name in release.binary_names(target):
            (self.bin / name).write_bytes(executable(target))
        return release.package(target, self.bin, self.native, VERSION, COMMIT, self.source)

    def test_six_platforms_produce_native_wheels_npm_packages_and_honest_manifests(self):
        for target in release.TARGETS:
            self.archive(target)
        distribute.build(self.native, self.output, VERSION, COMMIT)
        wheels = sorted((self.output / 'python').glob('*.whl'))
        self.assertEqual(len(wheels), 6)
        for wheel in wheels:
            with zipfile.ZipFile(wheel) as package:
                manifest = json.loads(package.read('serialhub_cli/native-manifest.json'))
                self.assertEqual(manifest['commit'], COMMIT)
                for name, expected in manifest['files'].items():
                    self.assertEqual(release.digest(package.read('serialhub_cli/bin/' + name)), expected['sha256'])
                self.assertFalse(any('postinstall' in name for name in package.namelist()))
        with tarfile.open(self.output / 'npm' / f'tianrking-serialhub-{VERSION}.tgz') as package:
            metadata = json.load(package.extractfile('package/package.json'))
        self.assertEqual(len(metadata['optionalDependencies']), 6)
        self.assertNotIn('scripts', metadata)
        self.assertEqual(len(list((self.output / 'debian').glob('*.deb'))), 2)
        installers = next((self.output / 'winget').rglob('*.installer.yaml'))
        metadata = json.loads(installers.read_text())
        self.assertEqual({i['Architecture'] for i in metadata['Installers']}, {'x64', 'arm64'})
        self.assertTrue(all(i['InstallerUrl'].startswith('https://github.com/tianrking/serialhub/releases/download/v0.0.4/') for i in metadata['Installers']))

    def test_partial_build_never_advertises_missing_platforms(self):
        self.archive('x86_64-unknown-linux-gnu')
        distribute.build(self.native, self.output, VERSION, COMMIT)
        metadata = json.loads((self.output / 'distribution.json').read_text())
        self.assertEqual(metadata['platforms'], ['linux-x64'])
        self.assertFalse((self.output / 'winget').exists())
        self.assertNotIn('on_macos', (self.output / 'homebrew/serialhub.rb').read_text())

    def test_two_toolchains_cannot_silently_replace_the_same_platform(self):
        self.archive('x86_64-pc-windows-gnu')
        self.archive('x86_64-pc-windows-msvc')
        with self.assertRaisesRegex(ValueError, 'Duplicate distribution platform'):
            distribute.build(self.native, self.output, VERSION, COMMIT)

    def test_mismatched_source_and_stale_output_are_rejected(self):
        self.archive('x86_64-unknown-linux-gnu')
        with self.assertRaisesRegex(ValueError, 'source commit mismatch'):
            distribute.build(self.native, self.output, VERSION, 'b' * 40)
        self.output.mkdir()
        (self.output / 'old.whl').write_bytes(b'stale')
        with self.assertRaisesRegex(ValueError, 'must be empty'):
            distribute.build(self.native, self.output, VERSION, COMMIT)

    def test_uploads_include_all_channels_and_modified_or_extra_files_are_rejected(self):
        self.archive('x86_64-unknown-linux-gnu')
        distribute.build(self.native, self.output, VERSION, COMMIT)
        uploads = self.root / 'uploads'
        distribute.stage(self.output, self.native, uploads)
        names = {p.name for p in uploads.iterdir()}
        self.assertTrue(any(name.endswith('.whl') for name in names))
        self.assertTrue(any(name.endswith('.deb') for name in names))
        self.assertTrue(any(name.endswith('.tgz') for name in names))
        self.assertIn('SHA256SUMS', names)
        extra = self.output / 'unreviewed.txt'
        extra.write_text('extra')
        with self.assertRaisesRegex(ValueError, 'Unexpected or missing'):
            distribute.verify_distribution(self.output)
        extra.unlink()
        wheel = next((self.output / 'python').glob('*.whl'))
        wheel.write_bytes(wheel.read_bytes() + b'corruption')
        with self.assertRaisesRegex(ValueError, 'checksum mismatch'):
            distribute.verify_distribution(self.output)

    @unittest.skipUnless(__import__('shutil').which('dpkg-deb'), 'dpkg-deb is Linux-only')
    def test_debian_archive_is_readable_by_dpkg_and_apt_indexes_hash_its_payload(self):
        self.archive('x86_64-unknown-linux-gnu')
        distribute.build(self.native, self.output, VERSION, COMMIT)
        deb = next((self.output / 'debian').glob('*.deb'))
        result = subprocess.check_output(['dpkg-deb', '-f', str(deb)], text=True)
        self.assertIn('Package: serialhub\n', result)
        self.assertIn('Architecture: amd64\n', result)
        repo = self.root / 'apt'
        distribute.apt_repository(self.output / 'debian', repo, '')
        packages = (repo / 'dists/stable/main/binary-amd64/Packages').read_text()
        self.assertIn('SHA256: ' + release.digest(deb.read_bytes()), packages)
        self.assertFalse((repo / 'dists/stable/main/binary-arm64').exists())
        self.assertFalse((repo / 'dists/stable/InRelease').exists())


if __name__ == '__main__':
    unittest.main()
