#!/usr/bin/env python3
"""Install the generated formula from a local archive in a disposable brew tap."""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import uuid

ROOT = Path(__file__).resolve().parent.parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', required=True, type=Path)
    parser.add_argument('--archives', required=True, type=Path)
    parser.add_argument('--target', required=True)
    args = parser.parse_args()
    assert shutil.which('brew'), 'Homebrew is required on the macOS acceptance runner'
    metadata = json.loads((args.directory / 'distribution.json').read_text())
    env = dict(os.environ, HOMEBREW_NO_AUTO_UPDATE='1', HOMEBREW_NO_INSTALL_CLEANUP='1')
    tap = 'tianrking/serialhub-ci-' + uuid.uuid4().hex[:10]
    formula = tap + '/serialhub'
    def run(*command):
        subprocess.run(command, env=env, check=True)
    run('brew', 'tap-new', '--no-git', tap)
    installed = False
    try:
        path = Path(subprocess.check_output(['brew', '--repository', tap], env=env, text=True).strip()) / 'Formula/serialhub.rb'
        content = (args.directory / 'homebrew/serialhub.rb').read_text()
        for archive in metadata['native_archives']:
            content = content.replace(archive['url'], (args.archives / archive['filename']).resolve().as_uri())
        path.write_text(content)
        run('brew', 'install', '--formula', formula)
        installed = True
        run('brew', 'test', formula)
        prefix = Path(subprocess.check_output(['brew', '--prefix', formula], env=env, text=True).strip())
        run(sys.executable, str(ROOT / 'scripts/smoke-headless.py'), '--binary', str(prefix / 'bin/serialhub'))
    finally:
        if installed:
            run('brew', 'uninstall', '--formula', formula)
        run('brew', 'untap', tap)
    print('HOMEBREW_SMOKE_OK: actual formula install, offline native payload, HTTP+WS workbench and uninstall')


if __name__ == '__main__':
    main()
