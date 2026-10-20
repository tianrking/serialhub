#!/usr/bin/env python3
"""Publish native packages first; immutable reruns verify remote integrity."""
import argparse
import base64
import hashlib
import json
from pathlib import Path
import subprocess
import tarfile
from urllib.error import HTTPError
from urllib.parse import quote
from urllib.request import urlopen
import distribute


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', required=True, type=Path)
    args = parser.parse_args()
    metadata = distribute.verify_distribution(args.directory, distribute.release.version(), distribute.release.git('rev-parse', 'HEAD'), require_all=True)
    assert len(metadata['platforms']) == 6, 'Only a complete native release may be published'
    packages = sorted((args.directory / 'npm').glob('*.tgz'))
    # Root has bin entries; platform packages have OS/CPU restrictions.
    packages.sort(key=lambda p: p.name == f'tianrking-serialhub-{metadata["version"]}.tgz')
    assert len(packages) == 7
    for package in packages:
        with tarfile.open(package) as archive:
            info = json.load(archive.extractfile('package/package.json'))
        assert info['version'] == metadata['version']
        expected = 'sha512-' + base64.b64encode(hashlib.sha512(package.read_bytes()).digest()).decode()
        try:
            with urlopen('https://registry.npmjs.org/' + quote(info['name'], safe='@') + '/' + info['version'], timeout=30) as response:
                existing = json.load(response)
            assert existing['dist']['integrity'] == expected, 'Published npm package differs; refusing to overwrite or skip'
            print('NPM_IMMUTABLE_ALREADY_MATCHES', info['name'])
            continue
        except HTTPError as error:
            if error.code != 404:
                raise
        subprocess.run(['npm', 'publish', str(package.resolve()), '--access', 'public', '--provenance'], check=True)
        print('NPM_PUBLISHED', info['name'], info['version'])


if __name__ == '__main__':
    main()
