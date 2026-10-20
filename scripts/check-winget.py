#!/usr/bin/env python3
"""Validate generated WinGet manifests against vendored official JSON schemas."""
import argparse
import json
from pathlib import Path
import jsonschema
import hashlib
from urllib.parse import urlparse
import zipfile

ROOT = Path(__file__).resolve().parent.parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', required=True, type=Path)
    parser.add_argument('--archives', type=Path)
    args = parser.parse_args()
    files = sorted(args.directory.rglob('*.yaml'))
    assert files, 'No WinGet manifests supplied'
    for path in files:
        manifest = json.loads(path.read_text(encoding='utf-8'))
        kind = manifest['ManifestType']
        schema = json.loads((ROOT / f'packaging/winget/schemas/manifest.{kind}.1.9.0.json').read_text(encoding='utf-8'))
        jsonschema.Draft7Validator(schema, format_checker=jsonschema.FormatChecker()).validate(manifest)
        if kind == 'installer' and args.archives:
            for installer in manifest['Installers']:
                path = args.archives / Path(urlparse(installer['InstallerUrl']).path).name
                assert hashlib.sha256(path.read_bytes()).hexdigest().upper() == installer['InstallerSha256']
                with zipfile.ZipFile(path) as archive:
                    for nested in installer['NestedInstallerFiles']:
                        assert nested['RelativeFilePath'] in archive.namelist(), 'WinGet entry points to a nonexistent executable'
    assert len(files) == 3, 'Expected version, installer and defaultLocale manifests'
    assert len({json.loads(p.read_text())['PackageVersion'] for p in files}) == 1
    print('WINGET_SCHEMAS_OK', len(files), 'official 1.9.0 schemas')


if __name__ == '__main__':
    main()
