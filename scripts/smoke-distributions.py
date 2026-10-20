#!/usr/bin/env python3
"""Install real local npm/wheel/Debian artifacts, then run the installed commands."""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parent.parent


def run(*args, **kwargs):
    subprocess.run(list(map(str, args)), check=True, **kwargs)


def exercise(binary):
    run(binary, '--version')
    run(sys.executable, ROOT / 'scripts/smoke-headless.py', '--binary', binary)


def reject_corruption(command, native):
    original = native.read_bytes()
    try:
        deadline = time.monotonic() + 10
        while True:
            try:
                native.write_bytes(original + b'installer-integrity-test')
                break
            except OSError:
                if time.monotonic() >= deadline:
                    raise
                time.sleep(.05)
        result = subprocess.run([str(command), '--version'], capture_output=True, timeout=10)
        assert result.returncode != 0 and b'checksum' in result.stderr.lower(), 'Launcher ran a modified native executable'
    finally:
        native.write_bytes(original)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', required=True, type=Path)
    parser.add_argument('--target', required=True)
    args = parser.parse_args()
    directory = args.directory.resolve()
    meta = json.loads((directory / 'distribution.json').read_text(encoding='utf-8'))
    spec = __import__('importlib.util', fromlist=['util']).spec_from_file_location('distribute', ROOT / 'scripts/distribute.py')
    distribute = __import__('importlib.util', fromlist=['util']).module_from_spec(spec)
    spec.loader.exec_module(distribute)
    key, wheel_platform, _ = distribute.PLATFORMS[args.target]
    assert key in meta['platforms']
    with tempfile.TemporaryDirectory(prefix='serialhub-installers-') as temporary:
        root = Path(temporary)
        # Installing the actual wheel exercises wheel layout, binary executable
        # permissions and the generated command entry point. No PyPI/network.
        venv = root / 'venv'
        run(sys.executable, '-m', 'venv', venv)
        scripts = venv / ('Scripts' if os.name == 'nt' else 'bin')
        python = scripts / ('python.exe' if os.name == 'nt' else 'python')
        wheel = directory / 'python' / f'serialhub_cli-{meta["version"]}-py3-none-{wheel_platform}.whl'
        run(python, '-m', 'pip', '--no-cache-dir', 'install', '--no-index', '--no-deps', wheel)
        exercise(scripts / ('serialhub.exe' if os.name == 'nt' else 'serialhub'))
        module = Path(subprocess.check_output([str(python), '-c', 'import serialhub_cli; print(serialhub_cli.__file__)'], text=True).strip()).parent
        reject_corruption(scripts / ('serialhub.exe' if os.name == 'nt' else 'serialhub'), module / 'bin' / ('serialhub.exe' if os.name == 'nt' else 'serialhub'))
        run(python, '-m', 'pip', '--no-cache-dir', 'uninstall', '-y', 'serialhub-cli')
        assert not (scripts / ('serialhub.exe' if os.name == 'nt' else 'serialhub')).exists()
        # Explicit local native and launcher packages avoid registry access.
        npm = shutil.which('npm')
        assert npm, 'Node.js/npm is required for installer acceptance'
        prefix = root / 'npm'
        native = directory / 'npm' / f'tianrking-serialhub-{key}-{meta["version"]}.tgz'
        launcher = directory / 'npm' / f'tianrking-serialhub-{meta["version"]}.tgz'
        run(npm, 'install', '--prefix', prefix, '--cache', root / 'npm-cache', '--offline', '--ignore-scripts', '--omit=optional',
            '--no-audit', '--no-fund', native, launcher)
        exercise(prefix / 'node_modules/.bin' / ('serialhub.cmd' if os.name == 'nt' else 'serialhub'))
        reject_corruption(prefix / 'node_modules/.bin' / ('serialhub.cmd' if os.name == 'nt' else 'serialhub'), prefix / 'node_modules/@tianrking' / ('serialhub-' + key) / 'bin' / ('serialhub.exe' if os.name == 'nt' else 'serialhub'))
        run(npm, 'uninstall', '--prefix', prefix, '--cache', root / 'npm-cache', '--offline', '--ignore-scripts', '--no-audit', '--no-fund',
            '@tianrking/serialhub', '@tianrking/serialhub-' + key)
        assert not (prefix / 'node_modules/@tianrking/serialhub').exists()
        if 'linux' in args.target:
            arch = distribute.PLATFORMS[args.target][2]
            deb = directory / 'debian' / f'serialhub_{meta["version"]}_{arch}.deb'
            run('dpkg-deb', '--info', deb)
            extracted = root / 'debian'
            run('dpkg-deb', '--extract', deb, extracted)
            exercise(extracted / 'usr/bin/serialhub')
    print('DISTRIBUTION_INSTALL_SMOKE_OK', key, 'wheel/npm install, embedded HTTP+WS workbench, stop, uninstall; Debian extraction when applicable')


if __name__ == '__main__':
    main()
