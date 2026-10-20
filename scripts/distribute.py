#!/usr/bin/env python3
"""Build package-manager artifacts from verified native release archives, offline.

No credentials, registry writes or downloads are used by this command. The
native archives and per-file manifests are the sole binary source of truth.
"""
import argparse
import base64
import csv
from datetime import datetime, timezone
import gzip
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import shutil
import subprocess
import tarfile
import zipfile

ROOT = Path(__file__).resolve().parent.parent
SPEC = importlib.util.spec_from_file_location('release', ROOT / 'scripts/release.py')
release = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(release)
NPM_NAME = '@tianrking/serialhub'
PYPI_NAME = 'serialhub-cli'
PLATFORMS = {
    'x86_64-unknown-linux-gnu': ('linux-x64', 'manylinux_2_39_x86_64', 'amd64'),
    'aarch64-unknown-linux-gnu': ('linux-arm64', 'manylinux_2_39_aarch64', 'arm64'),
    'x86_64-apple-darwin': ('darwin-x64', 'macosx_15_0_x86_64', None),
    'aarch64-apple-darwin': ('darwin-arm64', 'macosx_15_0_arm64', None),
    'x86_64-pc-windows-msvc': ('win32-x64', 'win_amd64', None),
    'aarch64-pc-windows-msvc': ('win32-arm64', 'win_arm64', None),
    'x86_64-pc-windows-gnu': ('win32-x64', 'win_amd64', None),
}


def encoded(value):
    return (json.dumps(value, indent=2, ensure_ascii=False) + '\n').encode()


def tar_bytes(files):
    stream = io.BytesIO()
    with tarfile.open(fileobj=stream, mode='w', format=tarfile.USTAR_FORMAT) as bundle:
        for name, data in sorted(files.items()):
            info = tarfile.TarInfo(name)
            info.size = len(data)
            info.mode = 0o755 if '/bin/' in name or name.endswith('.cjs') else 0o644
            bundle.addfile(info, io.BytesIO(data))
    return stream.getvalue()


def write_tgz(path, files):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(gzip.compress(tar_bytes(files), mtime=0))


def native_files(manifest, entries):
    prefix = f"serialhub-v{manifest['version']}-{manifest['target']}/"
    names = release.binary_names(manifest['target'])
    files = {'bin/' + name: entries[prefix + name] for name in names}
    files['LICENSE'] = entries[prefix + 'LICENSE']
    files['native-manifest.json'] = encoded({
        'format': 'serialhub.native-package.v1', 'version': manifest['version'],
        'target': manifest['target'], 'commit': manifest['commit'],
        'files': {name: manifest['files'][name] for name in names},
    })
    return files


def package_readme(version, channel):
    install = 'npm install -g @tianrking/serialhub' if channel == 'npm' else 'pipx install serialhub-cli'
    return (f'# SerialHub {version}\n\nOne port. Shared access.\n\n'
        'A native serial-port owner with an embedded browser workbench: shared RX, '
        'coordinated TX, HTTP/WebSocket APIs, tiled multi-port terminals and signal tools.\n\n'
        'For registry installation, use the following command **after this version '
        'is published**. Before registry publication, install the matching local '
        'wheel, or both the npm launcher and native tarballs from a GitHub Release; '
        'see the installation guide below.\n\n'
        f'```sh\n{install}\nserialhub             # open the desktop workbench\n'
        'serialhub serve       # no browser/tray; http://127.0.0.1:8787/\n'
        'serialhub stop        # release devices and quit\n```\n\n'
        'The native executable is bundled, not downloaded by an install script. '
        'No Rust compiler is needed. Windows 10/11, macOS 15+, and GNU/Linux '
        '(glibc 2.39+) are supported when the matching x64/ARM64 package is published. '
        'USB drivers and device permissions remain OS-specific.\n\n'
        'The Python project is **serialhub-cli**; the unrelated PyPI project '
        '**serialhub** is not this tool. npm installations need optional dependencies enabled.\n\n'
        '[Installation, headless services and troubleshooting]'
        '(https://github.com/tianrking/serialhub/blob/main/INSTALLATION.md) · '
        '[Source and screenshots](https://github.com/tianrking/serialhub)\n').encode()


def npm_platform(output, manifest, files):
    key = PLATFORMS[manifest['target']][0]
    system, arch = key.split('-')
    metadata = {'name': NPM_NAME + '-' + key, 'version': manifest['version'],
                'description': 'SerialHub native core for ' + key, 'license': 'MIT',
                'repository': {'type': 'git', 'url': 'https://github.com/tianrking/serialhub.git'},
                'os': [system], 'cpu': [arch], 'preferUnplugged': True,
                'publishConfig': {'access': 'public'}, 'files': ['bin/', 'native-manifest.json', 'LICENSE']}
    if system == 'linux':
        metadata['libc'] = ['glibc']
    files = dict(files, **{'package.json': encoded(metadata)})
    path = output / 'npm' / f"tianrking-serialhub-{key}-{manifest['version']}.tgz"
    write_tgz(path, {'package/' + name: data for name, data in files.items()})


def npm_launcher(output, version, keys):
    metadata = {'name': NPM_NAME, 'version': version,
                'description': 'Shared serial ports, tiled terminals and an embedded web workbench',
                'license': 'MIT', 'homepage': 'https://github.com/tianrking/serialhub',
                'repository': {'type': 'git', 'url': 'https://github.com/tianrking/serialhub.git'},
                'bin': {'serialhub': 'cli.cjs', 'serialhub-desktop': 'desktop.cjs'},
                'engines': {'node': '>=18'}, 'publishConfig': {'access': 'public'},
                'optionalDependencies': {NPM_NAME + '-' + key: version for key in sorted(keys)}}
    files = {'package/package.json': encoded(metadata), 'package/LICENSE': (ROOT / 'LICENSE').read_bytes(),
             'package/README.md': package_readme(version, 'npm')}
    for source in (ROOT / 'packaging/npm').glob('*.cjs'):
        files['package/' + source.name] = source.read_bytes()
    write_tgz(output / 'npm' / f'tianrking-serialhub-{version}.tgz', files)


def python_wheel(output, manifest, files):
    version = manifest['version']
    platform = PLATFORMS[manifest['target']][1]
    tag = 'py3-none-' + platform
    dist = f'serialhub_cli-{version}.dist-info'
    entries = {'serialhub_cli/' + name: data for name, data in files.items()}
    entries['serialhub_cli/__init__.py'] = (ROOT / 'packaging/python/serialhub_cli/__init__.py').read_bytes()
    entries[dist + '/METADATA'] = (f'Metadata-Version: 2.3\nName: {PYPI_NAME}\nVersion: {version}\n'
        'Summary: SerialHub native core and embedded serial debugging workbench\n'
        'Requires-Python: >=3.9\nLicense: MIT\nClassifier: License :: OSI Approved :: MIT License\n'
        'Project-URL: Source, https://github.com/tianrking/serialhub\n'
        'Project-URL: Documentation, https://github.com/tianrking/serialhub/blob/main/INSTALLATION.md\n'
        'Description-Content-Type: text/markdown\n\n').encode() + package_readme(version, 'python')
    entries[dist + '/WHEEL'] = f'Wheel-Version: 1.0\nGenerator: serialhub-distribute\nRoot-Is-Purelib: false\nTag: {tag}\n'.encode()
    entries[dist + '/entry_points.txt'] = b'[console_scripts]\nserialhub = serialhub_cli:main\n\n[gui_scripts]\nserialhub-desktop = serialhub_cli:desktop\n'
    record = io.StringIO(newline='')
    writer = csv.writer(record, lineterminator='\n')
    for name, data in sorted(entries.items()):
        digest = base64.urlsafe_b64encode(hashlib.sha256(data).digest()).rstrip(b'=').decode()
        writer.writerow([name, 'sha256=' + digest, str(len(data))])
    writer.writerow([dist + '/RECORD', '', ''])
    entries[dist + '/RECORD'] = record.getvalue().encode()
    path = output / 'python' / f'serialhub_cli-{version}-{tag}.whl'
    path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(path, 'w', compression=zipfile.ZIP_DEFLATED) as wheel:
        for name, data in sorted(entries.items()):
            info = zipfile.ZipInfo(name, date_time=(2020, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = (0o100755 if '/bin/' in name else 0o100644) << 16
            wheel.writestr(info, data)


def ar_member(name, data):
    header = f'{name + "/":<16}{0:<12}{0:<6}{0:<6}{"100644":<8}{len(data):<10}`\n'.encode('ascii')
    return header + data + (b'\n' if len(data) % 2 else b'')


def debian(output, manifest, files):
    version = manifest['version']
    arch = PLATFORMS[manifest['target']][2]
    data = {'usr/' + name: content for name, content in files.items() if name.startswith('bin/')}
    data['usr/share/doc/serialhub/copyright'] = files['LICENSE']
    data['usr/share/doc/serialhub/native-manifest.json'] = files['native-manifest.json']
    data['usr/lib/systemd/user/serialhub.service'] = b'[Unit]\nDescription=SerialHub headless serial workbench\n\n[Service]\nExecStart=/usr/bin/serialhub serve\nRestart=on-failure\nRestartSec=3\nTimeoutStopSec=30\nUMask=0077\n\n[Install]\nWantedBy=default.target\n'
    control = (f'Package: serialhub\nVersion: {version}\nArchitecture: {arch}\n'
        'Maintainer: tianrking <tianrking@users.noreply.github.com>\nSection: electronics\nPriority: optional\n'
        'Depends: libc6 (>= 2.39), libgcc-s1\nHomepage: https://github.com/tianrking/serialhub\n'
        f'Installed-Size: {(sum(map(len, data.values())) + 1023) // 1024}\n'
        'Description: Shared serial ports and an embedded web debugging workbench\n'
        ' One native owner per device, HTTP/WebSocket access and tiled terminals.\n').encode()
    md5 = ''.join(f'{hashlib.md5(content, usedforsecurity=False).hexdigest()}  {name}\n' for name, content in sorted(data.items())).encode()
    # Debian's ar/tar format needs no host-side root privileges or maintainer scripts.
    archive = b'!<arch>\n' + ar_member('debian-binary', b'2.0\n')
    archive += ar_member('control.tar.gz', gzip.compress(tar_bytes({'control': control, 'md5sums': md5}), mtime=0))
    archive += ar_member('data.tar.gz', gzip.compress(tar_bytes(data), mtime=0))
    path = output / 'debian' / f'serialhub_{version}_{arch}.deb'
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(archive)


def homebrew(output, version, downloads):
    lines = ['class Serialhub < Formula', '  desc "Serial port sharing and web debugging workbench"',
             '  homepage "https://github.com/tianrking/serialhub"', f'  version "{version}"', '  license "MIT"']
    for os_name, system in [('macos', 'apple-darwin'), ('linux', 'unknown-linux-gnu')]:
        matching = [d for d in downloads if d['target'].endswith(system)]
        if not matching:
            continue
        lines.append(f'  on_{os_name} do')
        if os_name == 'macos':
            lines.append('    depends_on macos: :sequoia')
        for download in matching:
            arch = 'arm' if download['target'].startswith('aarch64') else 'intel'
            lines += [f'    on_{arch} do', f'      url "{download["url"]}"', f'      sha256 "{download["sha256"]}"', '    end']
        lines.append('  end')
    lines += ['  def install', '    bin.install "serialhub", "serialhub-desktop", "ohmyserial"',
              '    doc.install Dir["*.md"], "assets", "docs", "web"', '  end', '  service do',
              '    run [opt_bin/"serialhub", "serve"]', '    keep_alive successful_exit: false',
              '    log_path var/"log/serialhub.log"', '    error_log_path var/"log/serialhub.log"', '  end',
              '  test do', '    assert_match version.to_s, shell_output("#{bin}/serialhub --version")', '  end', 'end', '']
    path = output / 'homebrew/serialhub.rb'
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text('\n'.join(lines), encoding='utf-8')


def winget(output, version, downloads):
    windows = [d for d in downloads if 'windows' in d['target']]
    if not windows:
        return
    root = output / 'winget' / 't' / 'tianrking' / 'SerialHub' / version
    root.mkdir(parents=True, exist_ok=True)
    base = {'PackageIdentifier': 'tianrking.SerialHub', 'PackageVersion': version, 'ManifestVersion': '1.9.0'}
    version_file = dict(base, DefaultLocale='en-US', ManifestType='version')
    locale = dict(base, PackageLocale='en-US', Publisher='tianrking', PackageName='SerialHub',
                  License='MIT', ShortDescription='Shared serial ports and a web debugging workbench',
                  PackageUrl='https://github.com/tianrking/serialhub', ManifestType='defaultLocale')
    installers = []
    for item in windows:
        stage = Path(item['filename']).stem
        installers.append({'Architecture': 'arm64' if item['target'].startswith('aarch64') else 'x64',
                           'InstallerUrl': item['url'], 'InstallerSha256': item['sha256'].upper(),
                           'NestedInstallerFiles': [
                               {'RelativeFilePath': stage + '/' + name, 'PortableCommandAlias': alias}
                               for name, alias in [('serialhub.exe', 'serialhub'), ('serialhub-desktop.exe', 'serialhub-desktop'), ('ohmyserial.exe', 'ohmyserial')]]})
    installer = dict(base, InstallerType='zip', NestedInstallerType='portable', Scope='user',
                     UpgradeBehavior='uninstallPrevious', Installers=installers, ManifestType='installer')
    # JSON is a YAML 1.2 subset; winget accepts it in .yaml manifests. This keeps
    # escaping exact without requiring PyYAML on the build host.
    for suffix, content in [('', version_file), ('.locale.en-US', locale), ('.installer', installer)]:
        (root / f'tianrking.SerialHub{suffix}.yaml').write_bytes(encoded(content))


def build(directory, output, version, commit):
    release.require(not output.exists() or not any(output.iterdir()), 'Distribution output must be empty (no stale packages)')
    archives = release.verify_directory(directory, version, commit)
    downloads, keys = [], set()
    output.mkdir(parents=True, exist_ok=True)
    for archive in archives:
        manifest, entries = release.verify_archive(archive, version, commit)
        key = PLATFORMS[manifest['target']][0]
        release.require(key not in keys, 'Duplicate distribution platform (for example MSVC and GNU Windows x64)')
        keys.add(key)
        files = native_files(manifest, entries)
        npm_platform(output, manifest, files)
        python_wheel(output, manifest, files)
        if 'linux' in manifest['target']:
            debian(output, manifest, files)
        downloads.append({'target': manifest['target'], 'filename': archive.name,
                          'url': f'https://github.com/tianrking/serialhub/releases/download/v{version}/{archive.name}',
                          'sha256': release.digest(archive.read_bytes())})
    npm_launcher(output, version, keys)
    if any('linux' in d['target'] or 'darwin' in d['target'] for d in downloads):
        homebrew(output, version, downloads)
    winget(output, version, downloads)
    (output / 'distribution.json').write_bytes(encoded({'format': 'serialhub.distribution.v1',
        'version': version, 'commit': commit, 'npm': NPM_NAME, 'pypi': PYPI_NAME,
        'platforms': sorted(keys), 'native_archives': downloads}))
    sums = ''.join(f'{release.digest(p.read_bytes())}  {p.relative_to(output).as_posix()}\n'
                   for p in sorted(output.rglob('*')) if p.is_file())
    (output / 'SHA256SUMS').write_text(sums, encoding='utf-8')
    verify_distribution(output, version, commit)
    print('DISTRIBUTIONS_BUILT', version, ', '.join(sorted(keys)))


def apt_repository(directory, output, signing_key):
    release.require(not output.exists() or not any(output.iterdir()), 'APT output must be empty')
    packages = sorted(directory.glob('*.deb'))
    release.require(packages, 'No Debian packages supplied')
    for arch in ('amd64', 'arm64'):
        paragraphs = []
        for package in packages:
            control = subprocess.check_output(['dpkg-deb', '-f', str(package)], text=True)
            if f'Architecture: {arch}\n' not in control:
                continue
            filename = 'pool/main/s/serialhub/' + package.name
            target = output / filename
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(package, target)
            paragraphs.append(control.rstrip() + f'\nFilename: {filename}\nSize: {package.stat().st_size}\nSHA256: {release.digest(package.read_bytes())}\n\n')
        if paragraphs:
            target = output / f'dists/stable/main/binary-{arch}/Packages'
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(''.join(paragraphs), encoding='utf-8')
            target.with_suffix('.gz').write_bytes(gzip.compress(target.read_bytes(), mtime=0))
    root = output / 'dists/stable'
    arches = ' '.join(p.name.removeprefix('binary-') for p in sorted((root / 'main').iterdir()))
    content = ('Origin: SerialHub\nLabel: SerialHub\nSuite: stable\nCodename: stable\n'
               f'Date: {datetime.now(timezone.utc).strftime("%a, %d %b %Y %H:%M:%S +0000")}\n'
               f'Architectures: {arches}\nComponents: main\nDescription: SerialHub native packages\nSHA256:\n')
    for path in sorted((root / 'main').rglob('*')):
        if path.is_file():
            content += f' {release.digest(path.read_bytes())} {path.stat().st_size:16d} {path.relative_to(root).as_posix()}\n'
    (root / 'Release').write_text(content, encoding='utf-8')
    if signing_key:
        for args in [('--armor', '--detach-sign', '--output', str(root / 'Release.gpg')),
                     ('--clearsign', '--output', str(root / 'InRelease'))]:
            subprocess.run(['gpg', '--batch', '--yes', '--local-user', signing_key, *args, str(root / 'Release')], check=True)
        with (output / 'serialhub-archive-keyring.gpg').open('wb') as stream:
            subprocess.run(['gpg', '--batch', '--export', signing_key], stdout=stream, check=True)
    print('APT_REPOSITORY_READY', 'signed' if signing_key else 'UNSIGNED: inspection only; sign before hosting')


def distribution_layout(metadata):
    """Derive mandatory packages from actual native inputs, never guessed CPUs."""
    version = metadata['version']
    expected = {'distribution.json', f'npm/tianrking-serialhub-{version}.tgz'}
    platforms, targets = set(), set()
    for item in metadata['native_archives']:
        target = item['target']
        release.require(target in PLATFORMS, 'Unknown distribution target: ' + target)
        key, wheel, deb = PLATFORMS[target]
        release.require(target not in targets and key not in platforms, 'Duplicate distribution platform')
        targets.add(target)
        platforms.add(key)
        filename = f'serialhub-v{version}-{target}' + ('.zip' if 'windows' in target else '.tar.gz')
        release.require(item['filename'] == filename, 'Native archive filename mismatch')
        release.require(item['url'] == f'https://github.com/tianrking/serialhub/releases/download/v{version}/{filename}',
                        'Native archive URL mismatch')
        expected.update({f'npm/tianrking-serialhub-{key}-{version}.tgz',
                         f'python/serialhub_cli-{version}-py3-none-{wheel}.whl'})
        if deb:
            expected.add(f'debian/serialhub_{version}_{deb}.deb')
    release.require(platforms and sorted(platforms) == metadata['platforms'], 'Distribution platform inventory mismatch')
    if any(key.startswith(('linux-', 'darwin-')) for key in platforms):
        expected.add('homebrew/serialhub.rb')
    if any(key.startswith('win32-') for key in platforms):
        root = f'winget/t/tianrking/SerialHub/{version}/tianrking.SerialHub'
        expected.update(root + suffix + '.yaml' for suffix in ('', '.locale.en-US', '.installer'))
    return expected, platforms, targets


def distribution_coverage(metadata):
    expected, platforms, targets = distribution_layout(metadata)
    official = set(release.TARGETS)
    return {'format': 'serialhub.distribution-coverage.v1', 'version': metadata['version'],
            'commit': metadata['commit'], 'complete': targets == official,
            'completeness_scope': 'artifact platforms and formats, not runtime or hardware validation',
            'runtime_validation': 'not established by artifact generation',
            'available_platforms': sorted(platforms),
            'missing_platforms': sorted({PLATFORMS[t][0] for t in official} - platforms),
            'missing_official_targets': sorted(official - targets),
            'additional_targets': sorted(targets - official),
            'package_files': sorted(expected - {'distribution.json'}),
            'registry_publication': 'not established by local artifacts'}


def verify_distribution(directory, version=None, commit=None, require_all=False):
    metadata = json.loads((directory / 'distribution.json').read_text())
    release.require(metadata['format'] == 'serialhub.distribution.v1', 'Unknown distribution format')
    if version is not None:
        release.require(metadata['version'] == version, 'Distribution version mismatch')
    if commit is not None:
        release.require(metadata['commit'] == commit, 'Distribution source mismatch')
    seen = set()
    for line in (directory / 'SHA256SUMS').read_text().splitlines():
        expected, name = line.split('  ', 1)
        path = directory / name
        release.require(name not in seen, 'Duplicate distribution checksum')
        seen.add(name)
        release.require(path.resolve().is_relative_to(directory.resolve()), 'Unsafe distribution checksum path')
        release.require(release.digest(path.read_bytes()) == expected, 'Distribution checksum mismatch: ' + name)
    actual = {p.relative_to(directory).as_posix() for p in directory.rglob('*') if p.is_file() and p != directory / 'SHA256SUMS'}
    release.require(actual == seen, 'Unexpected or missing distribution file')
    expected, platforms, targets = distribution_layout(metadata)
    release.require(actual == expected, 'Incomplete distribution formats; missing: ' +
                    ', '.join(sorted(expected - actual)) + '; unexpected: ' + ', '.join(sorted(actual - expected)))
    if require_all:
        release.require(targets == set(release.TARGETS), 'Incomplete six-platform distribution; missing official targets: ' +
                        ', '.join(sorted(set(release.TARGETS) - targets)))
    # A launcher without a matching optional dependency installs successfully but
    # cannot start. Check its advertised inventory, not only the tarball's name.
    with tarfile.open(directory / f'npm/tianrking-serialhub-{metadata["version"]}.tgz') as bundle:
        launcher = json.load(bundle.extractfile('package/package.json'))
    release.require(launcher.get('optionalDependencies') == {NPM_NAME + '-' + p: metadata['version'] for p in platforms},
                    'npm launcher platform dependencies mismatch')
    if 'homebrew/serialhub.rb' in expected:
        formula = (directory / 'homebrew/serialhub.rb').read_text()
        for item in metadata['native_archives']:
            if 'windows' not in item['target']:
                release.require(f'url "{item["url"]}"' in formula and f'sha256 "{item["sha256"]}"' in formula,
                                'Homebrew platform URL/hash missing: ' + item['target'])
    if any(p.startswith('win32-') for p in platforms):
        installer = json.loads(next((directory / 'winget').rglob('*.installer.yaml')).read_text())
        advertised = {(i['InstallerUrl'], i['InstallerSha256'].lower(), i['Architecture']) for i in installer['Installers']}
        wanted = {(i['url'], i['sha256'], 'arm64' if i['target'].startswith('aarch64') else 'x64')
                  for i in metadata['native_archives'] if 'windows' in i['target']}
        release.require(len(installer['Installers']) == len(wanted) and advertised == wanted,
                        'WinGet platform URL/hash mismatch')
    return metadata


def stage(directory, archives, output, require_all=False):
    """Flatten downloadable packages and retain manifest directories in a bundle."""
    release.require(not output.exists() or not any(output.iterdir()), 'Upload output must be empty')
    metadata = verify_distribution(directory, require_all=require_all)
    native = release.verify_directory(archives, metadata['version'], metadata['commit'], require_all=require_all)
    release.require({p.name for p in native} == {i['filename'] for i in metadata['native_archives']},
                    'Native archives do not match distribution inventory')
    for path in native:
        item = next(i for i in metadata['native_archives'] if i['filename'] == path.name)
        release.require(release.digest(path.read_bytes()) == item['sha256'], 'Native archive/distribution hash mismatch')
    output.mkdir(parents=True, exist_ok=True)
    for path in native + [p for folder in ('npm', 'python', 'debian') for p in (directory / folder).glob('*')]:
        release.require(not (output / path.name).exists(), 'Duplicate upload filename')
        shutil.copyfile(path, output / path.name)
    shutil.copyfile(directory / 'distribution.json', output / 'distribution.json')
    (output / 'distribution-coverage.json').write_bytes(encoded(distribution_coverage(metadata)))
    definitions = {p.relative_to(directory).as_posix(): p.read_bytes()
                   for folder in ('homebrew', 'winget') for p in (directory / folder).rglob('*') if p.is_file()}
    write_tgz(output / f'serialhub-v{metadata["version"]}-package-manager-manifests.tar.gz', definitions)
    (output / 'SHA256SUMS').write_text(''.join(f'{release.digest(p.read_bytes())}  {p.name}\n'
        for p in sorted(output.iterdir()) if p.is_file() and p.name != 'SHA256SUMS'), encoding='utf-8')
    print('DISTRIBUTION_UPLOADS_READY', len(list(output.iterdir())), 'assets')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    for command in ('build', 'apt', 'stage', 'verify'):
        child = sub.add_parser(command)
        child.add_argument('--directory', required=True, type=Path)
        if command != 'verify':
            child.add_argument('--output', required=True, type=Path)
        if command in ('stage', 'verify'):
            child.add_argument('--require-all', action='store_true', help='Require all six official native targets and every applicable format')
        if command == 'verify':
            child.add_argument('--report', type=Path, help='Write the coverage report outside the input directory')
        if command == 'apt':
            child.add_argument('--signing-key', default='')
        if command == 'stage':
            child.add_argument('--archives', required=True, type=Path)
    args = parser.parse_args()
    if args.command == 'build':
        build(args.directory, args.output, release.version(), release.git('rev-parse', 'HEAD'))
    elif args.command == 'apt':
        apt_repository(args.directory, args.output, args.signing_key)
    elif args.command == 'verify':
        metadata = verify_distribution(args.directory, release.version(), release.git('rev-parse', 'HEAD'), args.require_all)
        report = distribution_coverage(metadata)
        if args.report:
            release.require(not args.report.resolve().is_relative_to(args.directory.resolve()), 'Report must be outside distribution input')
            args.report.write_bytes(encoded(report))
        print(json.dumps(report, indent=2))
    else:
        stage(args.directory, args.archives, args.output, args.require_all)


if __name__ == '__main__':
    main()
