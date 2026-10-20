#!/usr/bin/env python3
"""Permit a publishing retry only when existing wheels have identical bytes."""
import argparse
import hashlib
import json
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import urlopen
import distribute


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', required=True, type=Path)
    args = parser.parse_args()
    metadata = distribute.verify_distribution(args.directory, distribute.release.version(), distribute.release.git('rev-parse', 'HEAD'))
    wheels = {p.name: p for p in (args.directory / 'python').glob('*.whl')}
    assert len(wheels) == 6 and len(metadata['platforms']) == 6
    try:
        with urlopen(f'https://pypi.org/pypi/serialhub-cli/{metadata["version"]}/json', timeout=30) as response:
            existing = json.load(response)
    except HTTPError as error:
        if error.code != 404:
            raise
        return
    for remote in existing['urls']:
        assert remote['filename'] in wheels, 'Unexpected file already published for this version'
        assert hashlib.sha256(wheels[remote['filename']].read_bytes()).hexdigest() == remote['digests']['sha256'], 'Published PyPI wheel differs; refusing to skip it'
    print('PYPI_IMMUTABLE_EXISTING_WHEELS_MATCH', len(existing['urls']))


if __name__ == '__main__':
    main()
