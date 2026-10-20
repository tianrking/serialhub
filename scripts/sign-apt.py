#!/usr/bin/env python3
"""Import a configured production key into an isolated temporary GPG home."""
import argparse
import os
from pathlib import Path
import subprocess
import sys
import tempfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    key = os.environ.get('APT_SIGNING_KEY')
    fingerprint = os.environ.get('APT_SIGNING_FINGERPRINT')
    if not key or not fingerprint:
        raise SystemExit('Configure the apt environment APT_SIGNING_KEY secret and APT_SIGNING_FINGERPRINT variable first')
    with tempfile.TemporaryDirectory(prefix='serialhub-signing-') as temporary:
        env = dict(os.environ, GNUPGHOME=temporary)
        os.chmod(temporary, 0o700)
        subprocess.run(['gpg', '--batch', '--import'], input=key.encode(), env=env, check=True, capture_output=True)
        subprocess.run([sys.executable, str(Path(__file__).with_name('distribute.py')), 'apt',
                        '--directory', str(args.directory), '--output', str(args.output), '--signing-key', fingerprint], env=env, check=True)
        subprocess.run(['gpg', '--batch', '--verify', str(args.output / 'dists/stable/InRelease')], env=env, check=True)
    print('PRODUCTION_APT_REPOSITORY_SIGNED: publish the artifact at your configured HTTPS repository URL')


if __name__ == '__main__':
    main()
