#!/usr/bin/env python3
"""Download immutable published native artifacts and reproduce channel artifacts."""
import argparse
import json
from pathlib import Path
import subprocess
import tempfile

import distribute


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--tag', required=True)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    version = distribute.release.version()
    assert args.tag == 'v' + version
    state = json.loads(subprocess.check_output(['gh', 'release', 'view', args.tag, '--json', 'isDraft,tagName'], text=True))
    assert not state['isDraft'] and state['tagName'] == args.tag, 'A public matching release is required'
    with tempfile.TemporaryDirectory(prefix='serialhub-published-') as temporary:
        native = Path(temporary)
        command = ['gh', 'release', 'download', args.tag, '--dir', str(native)]
        for target in distribute.release.TARGETS:
            name = f'serialhub-v{version}-{target}' + ('.zip' if 'windows' in target else '.tar.gz')
            command += ['--pattern', name]
        command += ['--pattern', 'SHA256SUMS']
        subprocess.run(command, check=True)
        hashes = dict(line.split('  ', 1)[::-1] for line in (native / 'SHA256SUMS').read_text().splitlines())
        for archive in native.iterdir():
            if archive.name != 'SHA256SUMS':
                assert distribute.release.digest(archive.read_bytes()) == hashes[archive.name], 'Published checksum mismatch'
        distribute.release.verify_directory(native, version, distribute.release.git('rev-parse', 'HEAD'), require_all=True)
        distribute.build(native, args.output, version, distribute.release.git('rev-parse', 'HEAD'))


if __name__ == '__main__':
    main()
