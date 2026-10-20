#!/usr/bin/env python3
"""Build and package native releases on a Linux server without hosted CI.

Requires cargo-zigbuild, Zig, cargo-xwin, LLVM and a supplied macOS SDK.
This command builds binaries and checks artifact identity; it runs no test suite.
"""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

import distribute

ROOT = Path(__file__).resolve().parent.parent
release = distribute.release


def run(command, env=None):
    print('+', ' '.join(map(str, command)), flush=True)
    subprocess.run(list(map(str, command)), cwd=ROOT, env=env, check=True)


def windows_resources(cache, version):
    compiler = os.environ.get('LLVM_RC') or shutil.which('llvm-rc')
    release.require(compiler, 'Windows cross builds require LLVM llvm-rc in PATH or LLVM_RC')
    cache.mkdir(parents=True, exist_ok=True)
    source = cache / 'serialhub.rc'
    resource = cache / 'serialhub.res'
    numbers = ','.join(version.split('.') + ['0'])
    source.write_text(
        f'1 ICON "{(ROOT / "assets/serialhub.ico").as_posix()}"\n'
        f'1 24 "{(ROOT / "assets/serialhub.manifest").as_posix()}"\n'
        f'1 VERSIONINFO\nFILEVERSION {numbers}\nPRODUCTVERSION {numbers}\n'
        'FILEOS 0x40004\nFILETYPE 0x1\nBEGIN\n'
        ' BLOCK "StringFileInfo"\n BEGIN\n  BLOCK "040904b0"\n  BEGIN\n'
        '   VALUE "CompanyName", "tianrking\\0"\n'
        '   VALUE "FileDescription", "SerialHub serial workbench\\0"\n'
        f'   VALUE "FileVersion", "{version}\\0"\n'
        '   VALUE "ProductName", "SerialHub\\0"\n'
        f'   VALUE "ProductVersion", "{version}\\0"\n'
        '  END\n END\n BLOCK "VarFileInfo"\n BEGIN\n'
        '  VALUE "Translation", 0x0409, 1200\n END\nEND\n', encoding='utf-8')
    run([compiler, '/FO', resource, source])
    return resource


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--target', action='append', choices=release.TARGETS)
    parser.add_argument('--target-dir', type=Path, default=ROOT / 'target')
    parser.add_argument('--cache-dir', type=Path, default=ROOT / 'target/server-cache')
    parser.add_argument('--macos-sdk', type=Path)
    parser.add_argument('--output', type=Path, default=ROOT / 'target/server-release')
    parser.add_argument('--build-only', action='store_true')
    parser.add_argument('--skip-build', action='store_true')
    parser.add_argument('--binary-dir', action='append', default=[], metavar='TARGET=PATH',
                        help='Use existing binary directories with --skip-build')
    args = parser.parse_args()
    targets = args.target or list(release.TARGETS)
    release.require(len(targets) == len(set(targets)), 'Duplicate target')
    release.require(not (args.build_only and args.skip_build), 'Choose build-only or skip-build')
    release.require(not args.binary_dir or args.skip_build, 'Binary directory overrides require --skip-build')
    version = release.version()
    commit = release.git('rev-parse', 'HEAD')
    target_dir = args.target_dir.resolve()
    cache = args.cache_dir.resolve()
    overrides = {}
    for value in args.binary_dir:
        target, path = value.split('=', 1)
        release.require(target in targets and target not in overrides, 'Unknown or repeated binary directory target')
        overrides[target] = Path(path).resolve()
    env = dict(os.environ, CARGO_TARGET_DIR=str(target_dir),
               XDG_CACHE_HOME=os.environ.get('XDG_CACHE_HOME', str(cache)))
    resource = None
    if not args.skip_build:
        if any('darwin' in t for t in targets):
            sdk = args.macos_sdk or (Path(env['SDKROOT']) if env.get('SDKROOT') else None)
            release.require(sdk and (sdk / 'SDKSettings.json').is_file(), 'Supply --macos-sdk or SDKROOT for macOS builds')
            env['SDKROOT'] = str(sdk.resolve())
            env['MACOSX_DEPLOYMENT_TARGET'] = '15.0'
        if any('windows' in t for t in targets):
            resource = windows_resources(cache / 'resources', version)
        for target in targets:
            if 'windows' in target:
                # Native Windows builds use winresource in build.rs. Linux cross
                # builds embed the same icon/manifest plus version information.
                flags = ['-C', 'target-feature=+crt-static', '-C', 'link-arg=' + str(resource)]
                command = ['cargo', 'xwin', 'build', '--cross-compiler', 'clang',
                           '--config', f'target.{target}.rustflags={json.dumps(flags)}', '--target', target]
            else:
                triple = target + '.2.39' if 'linux' in target else target
                command = ['cargo', 'zigbuild', '--target', triple]
            run(command + ['--locked', '--release', '--bins'], env)
    if args.build_only:
        print('SERVER_BUILDS_READY', ', '.join(targets), 'runtime tests NOT RUN', flush=True)
        return
    release.require(not release.git('status', '--porcelain'), 'Commit sources before packaging provenance manifests')
    output = args.output.resolve()
    release.require(not output.exists() or not any(output.iterdir()), 'Output must be empty')
    for target in targets:
        binary_dir = overrides.get(target, target_dir / target / 'release')
        release.package(target, binary_dir, output / 'native', version, commit)
    complete = set(targets) == set(release.TARGETS)
    release.verify_directory(output / 'native', version, commit, require_all=complete, checksums=True)
    distribute.build(output / 'native', output / 'distribution', version, commit)
    distribute.stage(output / 'distribution', output / 'native', output / 'downloads', require_all=complete)
    print('SERVER_RELEASE_FILES_READY', output / 'downloads', 'runtime tests NOT RUN', flush=True)


if __name__ == '__main__':
    try:
        main()
    except (ValueError, subprocess.CalledProcessError) as error:
        print('SERVER_RELEASE_FAILED:', error, file=sys.stderr)
        sys.exit(1)
