"""Publish complete releases; retry drafts without overwriting published builds."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import time

ASSETS = {
    'Ronda-macos-arm64.dmg',
}


def verify(directory):
    directory = Path(directory)
    assert {p.name for p in directory.iterdir()} == ASSETS | {'SHA256SUMS.txt'}, 'Incomplete or unexpected release assets'
    expected = {}
    for line in (directory / 'SHA256SUMS.txt').read_text().splitlines():
        digest, name = line.split(maxsplit=1)
        name = name.lstrip('*')
        assert name in ASSETS and name not in expected, 'Unexpected checksum entry'
        expected[name] = digest
    assert set(expected) == ASSETS, 'Missing asset checksum'
    for name in ASSETS:
        path = directory / name
        assert path.stat().st_size > 0, f'Empty installer: {name}'
        with path.open('rb') as source:
            assert hashlib.file_digest(source, 'sha256').hexdigest() == expected[name], f'Checksum mismatch: {name}'


def gh(*args):
    return subprocess.run(['gh', *map(str, args)], check=True, capture_output=True, text=True).stdout


def download(tag, directory):
    # Only local verification copies are replaced; remote published assets remain untouched.
    for attempt in range(3):
        try:
            gh('release', 'download', tag, '--dir', directory, '--clobber')
            return
        except subprocess.CalledProcessError:
            if attempt == 2:
                raise
            time.sleep(attempt + 1)


def publish(tag, directory, notes, sha):
    verify(directory)
    marker = f'Source commit: `{sha}`'
    assert marker in Path(notes).read_text(), 'Release notes must identify the source SHA'
    try:
        release = json.loads(gh('release', 'view', tag, '--json', 'isDraft,body'))
    except subprocess.CalledProcessError as error:
        if 'release not found' not in error.stderr.lower() and 'not found' not in error.stderr.lower():
            raise
        gh('release', 'create', tag, '--draft', '--verify-tag', '--title', f'Ronda {tag.removeprefix("v")}', '--notes-file', notes)
        release = {'isDraft': True, 'body': marker}
    assert marker in release['body'], 'Existing release belongs to a different source commit'
    if not release['isDraft']:
        with tempfile.TemporaryDirectory() as temporary:
            download(tag, temporary)
            verify(temporary)
        print(f'{tag} already published and verified; existing assets preserved')
        return
    gh('release', 'edit', tag, '--title', f'Ronda {tag.removeprefix("v")}', '--notes-file', notes)
    gh('release', 'upload', tag, *sorted(Path(directory).iterdir()), '--clobber')
    # Validate the uploaded files before making them publicly downloadable.
    with tempfile.TemporaryDirectory() as temporary:
        download(tag, temporary)
        verify(temporary)
    gh('release', 'edit', tag, '--draft=false', '--latest')
    print(f'Published and verified {tag}')


if __name__ == '__main__':
    try:
        publish(*sys.argv[1:])
    except subprocess.CalledProcessError as error:
        print(error.stderr, file=sys.stderr)
        raise
