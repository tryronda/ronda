"""Check release versions before spending time building installers."""
import json
import os
from pathlib import Path
import re
import tomllib


def check(root=Path('.'), tag=None):
    package = json.loads((root / 'package.json').read_text())['version']
    cargo = tomllib.loads((root / 'Cargo.toml').read_text())['workspace']['package']['version']
    tauri = json.loads((root / 'src-tauri/tauri.conf.json').read_text())['version']
    versions = [package, cargo, tauri]
    locked = tomllib.loads((root / 'Cargo.lock').read_text())['package']
    versions += [entry['version'] for entry in locked if entry['name'] in ('ronda', 'ronda-core')]
    assert len(versions) == 5 and all(value == package for value in versions), f'Version mismatch: {versions}'
    assert re.fullmatch(r'\d+\.\d+\.\d+', package), 'Expected a stable X.Y.Z version'
    if tag:
        assert tag == f'v{package}', f'Tag {tag} does not match {package}'
        assert re.search(rf'^## \[{re.escape(package)}\] - \d{{4}}-\d{{2}}-\d{{2}}$', (root / 'CHANGELOG.md').read_text(), re.M), 'Missing dated changelog section'
    return package


if __name__ == '__main__':
    tag = os.environ.get('GITHUB_REF_NAME') if os.environ.get('GITHUB_REF_TYPE') == 'tag' else None
    print(f'Release versions agree: {check(tag=tag)}')
