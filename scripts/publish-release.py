#!/usr/bin/env python3
"""Upload complete server-built artifacts and publish without triggering Actions.

Runs artifact identity/hash checks only, not runtime tests. An upload failure
leaves a draft. Published versions are immutable and are never overwritten.
"""
import argparse
import json
from pathlib import Path
import subprocess
import sys
import tempfile

import distribute

ROOT = Path(__file__).resolve().parent.parent
release = distribute.release


def gh(*args):
    return subprocess.check_output(['gh', *map(str, args)], cwd=ROOT, text=True).strip()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', type=Path, required=True, help='Flat downloads directory')
    parser.add_argument('--native', type=Path, required=True)
    parser.add_argument('--distribution', type=Path, required=True)
    parser.add_argument('--notes', type=Path, default=ROOT / 'RELEASE_NOTES.md')
    parser.add_argument('--repo', default='tianrking/serialhub')
    args = parser.parse_args()
    version = release.version()
    tag = 'v' + version
    commit = release.git('rev-parse', 'HEAD')
    release.require(not release.git('status', '--porcelain'), 'Commit sources before publishing')
    main_sha = release.git('ls-remote', 'origin', 'refs/heads/main').split()[0]
    release.require(main_sha == commit, 'Push this exact source to main before publishing')
    release.require('\n  push:' not in (ROOT / '.github/workflows/release.yml').read_text(),
                    'Release workflow must remain manual-only')
    release.verify_directory(args.native, version, commit, require_all=True)
    distribute.verify_distribution(args.distribution, version, commit, require_all=True)
    with tempfile.TemporaryDirectory(prefix='serialhub-publish-stage-') as temporary:
        distribute.stage(args.distribution, args.native, Path(temporary), require_all=True)
        release.compare_directories(Path(temporary), args.directory)
    tag_refs = release.git('ls-remote', 'origin', f'refs/tags/{tag}', f'refs/tags/{tag}^{{}}').splitlines()
    if tag_refs:
        peeled = next((line.split()[0] for line in tag_refs if line.endswith('^{}')), tag_refs[0].split()[0])
        release.require(peeled == commit, 'Existing tag points to different source; never overwrite it')
    files = sorted(path.resolve() for path in args.directory.iterdir() if path.is_file())
    probe = subprocess.run(['gh', 'release', 'view', tag, '--repo', args.repo,
                            '--json', 'isDraft,assets,tagName'], cwd=ROOT, capture_output=True, text=True)
    if probe.returncode == 0:
        existing = json.loads(probe.stdout)
        release.require(existing['isDraft'], 'Release is already public; refusing to overwrite it')
        unexpected = {item['name'] for item in existing['assets']} - {p.name for p in files}
        release.require(not unexpected, 'Draft has unexpected assets; inspect before continuing: ' + ', '.join(sorted(unexpected)))
        gh('release', 'edit', tag, '--repo', args.repo, '--target', commit,
           '--title', 'SerialHub ' + tag, '--notes-file', args.notes.resolve())
    else:
        release.require('not found' in probe.stderr.lower() or '404' in probe.stderr,
                        'Cannot read release state: ' + probe.stderr.strip())
        gh('release', 'create', tag, '--repo', args.repo, '--target', commit, '--draft',
           '--title', 'SerialHub ' + tag, '--notes-file', args.notes.resolve())
    # Try the small coverage report first. Missing asset-upload authorization
    # fails promptly, retaining a draft rather than announcing an empty release.
    coverage = args.directory.resolve() / 'distribution-coverage.json'
    gh('release', 'upload', tag, coverage, '--repo', args.repo, '--clobber')
    gh('release', 'upload', tag, *[p for p in files if p != coverage], '--repo', args.repo, '--clobber')
    with tempfile.TemporaryDirectory(prefix='serialhub-publish-download-') as temporary:
        gh('release', 'download', tag, '--repo', args.repo, '--dir', temporary)
        release.compare_directories(args.directory, Path(temporary))
    gh('release', 'edit', tag, '--repo', args.repo, '--draft=false', '--latest')
    state = json.loads(gh('release', 'view', tag, '--repo', args.repo, '--json', 'isDraft,assets,url'))
    release.require(not state['isDraft'] and len(state['assets']) == len(files), 'Final release state mismatch')
    print('RELEASE_PUBLISHED', state['url'], len(files), 'assets', flush=True)


if __name__ == '__main__':
    try:
        main()
    except (ValueError, subprocess.CalledProcessError) as error:
        print('RELEASE_NOT_PUBLISHED:', error, file=sys.stderr)
        sys.exit(1)
