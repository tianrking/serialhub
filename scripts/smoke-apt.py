#!/usr/bin/env python3
"""Prove signed APT metadata, real APT download and optional system install/remove.

The signing key is disposable test material. It is never a production repo key.
"""
import argparse
import getpass
import hashlib
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time

ROOT = Path(__file__).resolve().parent.parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', required=True, type=Path)
    parser.add_argument('--install', action='store_true', help='Also install/remove the system package; ephemeral root CI runner only')
    args = parser.parse_args()
    assert not args.install or os.geteuid() == 0, '--install needs an ephemeral root CI runner'
    with tempfile.TemporaryDirectory(prefix='serialhub-apt-') as temp:
        root = Path(temp)
        home = root / 'gnupg'
        home.mkdir(mode=0o700)
        env = dict(os.environ, GNUPGHOME=str(home))
        subprocess.run(['gpg', '--batch', '--pinentry-mode', 'loopback', '--passphrase', '',
                        '--quick-generate-key', 'SerialHub CI ONLY <ci@example.invalid>', 'ed25519', 'sign', '0'], env=env, check=True, capture_output=True)
        lines = subprocess.check_output(['gpg', '--batch', '--with-colons', '--list-keys'], env=env, text=True)
        key = next(line.split(':')[9] for line in lines.splitlines() if line.startswith('fpr:'))
        repo = root / 'repository'
        subprocess.run([sys.executable, str(ROOT / 'scripts/distribute.py'), 'apt', '--directory', str(args.directory.resolve()),
                        '--output', str(repo), '--signing-key', key], env=env, check=True)
        class Handler(SimpleHTTPRequestHandler):
            def __init__(self, *args, **kwargs):
                super().__init__(*args, directory=str(repo), **kwargs)
            def log_message(self, *args):
                pass
        server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            source = root / 'sources.list'
            source.write_text(f'deb [signed-by={repo}/serialhub-archive-keyring.gpg] http://127.0.0.1:{server.server_port} stable main\n')
            for name in ('lists/partial', 'archives/partial', 'downloads'):
                (root / name).mkdir(parents=True)
            config = root / 'apt.conf'
            (root / 'empty-config').mkdir()
            config.write_text(f'Dir::Etc::parts "{root / "empty-config"}";\nDir::Etc::main "/dev/null";\n')
            apt_env = dict(os.environ, APT_CONFIG=str(config))
            options = ['-o', 'Dir::Etc::sourcelist=' + str(source), '-o', 'Dir::Etc::sourceparts=-',
                       '-o', 'Dir::State::lists=' + str(root / 'lists'), '-o', 'Dir::Cache::archives=' + str(root / 'archives'),
                       '-o', 'APT::Sandbox::User=' + getpass.getuser(), '-o', 'Debug::NoLocking=1',
                       '-o', 'APT::Update::Error-Mode=any']
            subprocess.run(['apt-get', *options, 'update'], env=apt_env, check=True)
            subprocess.run(['apt-get', *options, 'download', 'serialhub'], env=apt_env, cwd=root / 'downloads', check=True)
            # Resolve dependencies against the actual host without changing it.
            subprocess.run(['apt-get', *options, '-y', '--download-only', '--no-install-recommends', 'install', 'serialhub'], env=apt_env, check=True)
            downloaded = next((root / 'downloads').glob('*.deb'))
            original = args.directory / downloaded.name
            assert hashlib.sha256(downloaded.read_bytes()).digest() == hashlib.sha256(original.read_bytes()).digest()
            if args.install:
                installed = False
                try:
                    subprocess.run(['apt-get', *options, '-y', '--no-install-recommends', 'install', 'serialhub'], env=apt_env, check=True)
                    installed = True
                    subprocess.run([sys.executable, str(ROOT / 'scripts/smoke-headless.py'), '--binary', '/usr/bin/serialhub'], check=True)
                finally:
                    if installed:
                        subprocess.run(['apt-get', *options, '-y', 'remove', 'serialhub'], env=apt_env, check=True)
            else:
                extracted = root / 'extracted'
                subprocess.run(['dpkg-deb', '--extract', str(downloaded), str(extracted)], check=True)
                subprocess.run([sys.executable, str(ROOT / 'scripts/smoke-headless.py'), '--binary', str(extracted / 'usr/bin/serialhub')], check=True)
            # Tampering must fail APT's signature check, not just our own hashes.
            signed = repo / 'dists/stable/InRelease'
            signed.write_bytes(signed.read_bytes().replace(b'Label: SerialHub', b'Label: Tampered!'))
            os.utime(signed, (time.time() + 10, time.time() + 10))
            tampered = subprocess.run(['apt-get', *options, 'update'], env=apt_env, capture_output=True, text=True)
            assert tampered.returncode != 0, 'APT accepted tampered metadata'
            print('APT_SMOKE_OK: disposable signed repo, APT signature/hash verification, real package download, installed workbench, tamper rejection' + (' and system install/remove' if args.install else ' (extracted locally)'))
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)


if __name__ == '__main__':
    main()
