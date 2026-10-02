import hashlib
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import json


def load(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


release = load('publish-release')
versions = load('check-release')


class ReleaseChecks(unittest.TestCase):
    def fixture(self, root):
        checksums = []
        for name in release.ASSETS:
            (root / name).write_bytes(b'installer')
            checksums.append(hashlib.sha256(b'installer').hexdigest() + '  ' + name)
        (root / 'SHA256SUMS.txt').write_text('\n'.join(checksums))

    def test_complete_assets_and_corruption(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.fixture(root)
            release.verify(root)
            (root / 'Ronda-macos-arm64.dmg').write_bytes(b'changed')
            with self.assertRaises(AssertionError):
                release.verify(root)

    def test_draft_publishes_only_after_download_verification(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            assets = root / 'assets'; assets.mkdir(); self.fixture(assets)
            notes = root / 'notes.md'; notes.write_text('Source commit: `abc`')
            calls = []
            def gh(*args):
                calls.append(args)
                if args[:2] == ('release', 'view'):
                    return json.dumps({'isDraft': True, 'body': notes.read_text()})
                if args[:2] == ('release', 'download'):
                    self.fixture(Path(args[args.index('--dir') + 1]))
                return ''
            with patch.object(release, 'gh', gh):
                release.publish('v1.0.1', assets, notes, 'abc')
            self.assertIn('--draft=false', calls[-1])
            self.assertEqual(calls[-2][:2], ('release', 'download'))

    def test_published_retry_is_read_only_and_mismatched_sha_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); assets = root / 'assets'; assets.mkdir(); self.fixture(assets)
            notes = root / 'notes.md'; notes.write_text('Source commit: `abc`')
            calls = []
            def gh(*args):
                calls.append(args)
                if args[:2] == ('release', 'view'):
                    return json.dumps({'isDraft': False, 'body': notes.read_text()})
                self.fixture(Path(args[args.index('--dir') + 1]))
                return ''
            with patch.object(release, 'gh', gh):
                release.publish('v1.0.1', assets, notes, 'abc')
            self.assertEqual(len(calls), 2)
            with patch.object(release, 'gh', return_value=json.dumps({'isDraft': True, 'body': 'different'})):
                with self.assertRaises(AssertionError):
                    release.publish('v1.0.1', assets, notes, 'abc')

    def test_versions_and_tag(self):
        root = Path(__file__).resolve().parents[1]
        version = versions.check(root)
        with self.assertRaises(AssertionError):
            versions.check(root, 'v999.0.0')
        self.assertRegex(version, r'^\d+\.\d+\.\d+$')


if __name__ == '__main__':
    unittest.main()
