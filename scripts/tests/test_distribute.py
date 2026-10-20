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

    def checksums(self):
        (self.output / 'SHA256SUMS').write_text(''.join(
            f'{release.digest(p.read_bytes())}  {p.relative_to(self.output).as_posix()}\n'
            for p in sorted(self.output.rglob('*')) if p.is_file() and p.name != 'SHA256SUMS'))

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
        checked = distribute.verify_distribution(self.output, VERSION, COMMIT, require_all=True)
        self.assertTrue(distribute.distribution_coverage(checked)['complete'])
        uploads = self.root / 'uploads'
        distribute.stage(self.output, self.native, uploads, require_all=True)
        self.assertEqual(len(list(uploads.iterdir())), 25)
        report = json.loads((uploads / 'distribution-coverage.json').read_text())
        self.assertEqual(report['missing_platforms'], [])
        self.assertEqual(report['missing_official_targets'], [])

    def test_partial_build_never_advertises_missing_platforms(self):
        self.archive('x86_64-unknown-linux-gnu')
        distribute.build(self.native, self.output, VERSION, COMMIT)
        metadata = json.loads((self.output / 'distribution.json').read_text())
        self.assertEqual(metadata['platforms'], ['linux-x64'])
        self.assertFalse((self.output / 'winget').exists())
        self.assertNotIn('on_macos', (self.output / 'homebrew/serialhub.rb').read_text())
        report = distribute.distribution_coverage(distribute.verify_distribution(self.output))
        self.assertFalse(report['complete'])
        self.assertEqual(len(report['missing_platforms']), 5)
        with self.assertRaisesRegex(ValueError, 'Incomplete six-platform'):
            distribute.stage(self.output, self.native, self.root / 'uploads', require_all=True)
        self.assertFalse((self.root / 'uploads').exists())

    def test_deleted_formats_fail_even_with_regenerated_checksums(self):
        for target in release.TARGETS:
            self.archive(target)
        distribute.build(self.native, self.output, VERSION, COMMIT)
        # A self-consistent checksum list alone cannot prove release completeness.
        for folder, pattern in [('python', '*.whl'), ('npm', '*.tgz'), ('debian', '*.deb'),
                                ('homebrew', '*.rb'), ('winget', '*.yaml')]:
            for path in sorted((self.output / folder).rglob(pattern)):
                with self.subTest(file=path.relative_to(self.output)):
                    content = path.read_bytes()
                    path.unlink()
                    self.checksums()
                    with self.assertRaisesRegex(ValueError, 'Incomplete distribution formats'):
                        distribute.verify_distribution(self.output, require_all=True)
                    path.write_bytes(content)
        self.checksums()
        distribute.verify_distribution(self.output, require_all=True)

    def test_missing_homebrew_and_winget_architectures_are_rejected(self):
        for target in release.TARGETS:
            self.archive(target)
        distribute.build(self.native, self.output, VERSION, COMMIT)
        formula = self.output / 'homebrew/serialhub.rb'
        original = formula.read_text()
        formula.write_text('\n'.join(line for line in original.splitlines() if 'aarch64-apple-darwin' not in line))
        self.checksums()
        with self.assertRaisesRegex(ValueError, 'Homebrew platform URL/hash missing'):
            distribute.verify_distribution(self.output, require_all=True)
        formula.write_text(original)
        path = next((self.output / 'winget').rglob('*.installer.yaml'))
        metadata = json.loads(path.read_text())
        metadata['Installers'] = [i for i in metadata['Installers'] if i['Architecture'] != 'arm64']
        path.write_bytes(distribute.encoded(metadata))
        self.checksums()
        with self.assertRaisesRegex(ValueError, 'WinGet platform URL/hash mismatch'):
            distribute.verify_distribution(self.output, require_all=True)

    def test_missing_npm_optional_platform_dependency_is_rejected(self):
        self.archive('x86_64-unknown-linux-gnu')
        distribute.build(self.native, self.output, VERSION, COMMIT)
        launcher = self.output / f'npm/tianrking-serialhub-{VERSION}.tgz'
        with tarfile.open(launcher) as bundle:
            entries = {m.name: bundle.extractfile(m).read() for m in bundle.getmembers()}
        metadata = json.loads(entries['package/package.json'])
        metadata['optionalDependencies'] = {}
        entries['package/package.json'] = distribute.encoded(metadata)
        distribute.write_tgz(launcher, entries)
        self.checksums()
        with self.assertRaisesRegex(ValueError, 'npm launcher platform dependencies mismatch'):
            distribute.verify_distribution(self.output)

    def test_windows_gnu_candidate_does_not_count_as_official_six_target_release(self):
        for target in release.TARGETS:
            self.archive('x86_64-pc-windows-gnu' if target == 'x86_64-pc-windows-msvc' else target)
        distribute.build(self.native, self.output, VERSION, COMMIT)
        report = distribute.distribution_coverage(distribute.verify_distribution(self.output))
        self.assertEqual(report['missing_platforms'], [])
        self.assertEqual(report['missing_official_targets'], ['x86_64-pc-windows-msvc'])
        self.assertFalse(report['complete'])
        with self.assertRaisesRegex(ValueError, 'Incomplete six-platform'):
            distribute.verify_distribution(self.output, require_all=True)

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
