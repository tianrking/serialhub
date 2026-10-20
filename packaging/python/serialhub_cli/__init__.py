"""Launch the bundled native core. Installation never downloads executables."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys


def _launch(desktop=False):
    root = Path(__file__).resolve().parent
    name = ('serialhub-desktop' if desktop else 'serialhub') + ('.exe' if os.name == 'nt' else '')
    binary = root / 'bin' / name
    try:
        manifest = json.loads((root / 'native-manifest.json').read_text(encoding='utf-8'))
        if hashlib.sha256(binary.read_bytes()).hexdigest() != manifest['files'][name]['sha256']:
            raise ValueError('Native executable checksum mismatch; reinstall the package')
        if os.name != 'nt':
            os.execv(str(binary), [str(binary), *sys.argv[1:]])
        # The native child shares the console and receives its own Ctrl+C event.
        child = subprocess.Popen([str(binary), *sys.argv[1:]])
        while True:
            try:
                return child.wait()
            except KeyboardInterrupt:
                continue
    except (OSError, ValueError, KeyError) as error:
        print(f'SerialHub could not start: {error}', file=sys.stderr)
        return 1


def main():
    return _launch()


def desktop():
    return _launch(True)
