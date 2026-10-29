"""Runtime update admission, checksum validation, and rollback without controlling real services."""
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest
from argparse import Namespace
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('server_update', Path(__file__).with_name('server-update.py'))
updater = importlib.util.module_from_spec(spec)
spec.loader.exec_module(updater)


class ServerUpdateTests(unittest.TestCase):
    def test_stable_version_admission(self):
        self.assertGreater(updater.version_key('1.0.0'), updater.version_key('1.0.0-rc.3'))
        self.assertGreater(updater.version_key('1.0.10'), updater.version_key('1.0.9'))
        assets = [{'name': 'neurix-harness-1.0.0-linux-x64-server.tar.gz'}, {'name': 'SHA256SUMS.txt'}]
        release = {'tag_name': 'v1.0.0', 'draft': False, 'prerelease': False, 'assets': assets}
        self.assertEqual(updater.release_version(release), '1.0.0')
        for altered in [{'draft': True}, {'prerelease': True}, {'tag_name': 'v1.0.0-rc.1'}, {'assets': []}]:
            with self.assertRaises(ValueError):
                updater.release_version({**release, **altered})

    def test_checksum_identity(self):
        checksum = 'a' * 64
        self.assertEqual(updater.archive_checksum(f'{checksum}  file.tar.gz\n'.encode(), 'file.tar.gz'), checksum)
        for text in ['', f'{checksum}  other.tar.gz\n', (f'{checksum}  file.tar.gz\n') * 2]:
            with self.assertRaises(ValueError):
                updater.archive_checksum(text.encode(), 'file.tar.gz')

    def test_archive_traversal(self):
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / 'unsafe.tar.gz'
            for name, link in [('../outside', ''), ('/absolute', ''), ('server/link', '../../../outside')]:
                with tarfile.open(path, 'w:gz') as archive:
                    entry = tarfile.TarInfo(name)
                    if link:
                        entry.type = tarfile.SYMTYPE
                        entry.linkname = link
                    archive.addfile(entry)
                with self.assertRaises(ValueError):
                    updater.validate_archive(path)

    def test_archive_cannot_supply_setuid_files(self):
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / 'privileged.tar.gz'
            with tarfile.open(path, 'w:gz') as archive:
                member = tarfile.TarInfo('server/tool')
                member.mode = 0o4755
                archive.addfile(member)
            with self.assertRaisesRegex(ValueError, 'privileged'):
                updater.validate_archive(path)

    def test_a_failed_release_stays_held_without_stopping_the_application(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / 'current/dsh').mkdir(parents=True)
            (root / 'current/dsh/package.json').write_text('{"version":"0.2.1-rc.3"}')
            (root / 'state.json').write_text('{"blocked_version":"1.0.0"}')
            release = {'tag_name': 'v1.0.0', 'draft': False, 'prerelease': False, 'assets': [
                {'name': 'SHA256SUMS.txt'}, {'name': 'neurix-harness-1.0.0-linux-x64-server.tar.gz'}]}
            config = {'repository': 'owner/repository', 'root': str(root), 'state_file': str(root / 'state.json')}
            args = Namespace(archive=None, apply=True)
            with patch.object(updater, 'read_release', return_value=release), patch.object(updater, 'control') as control:
                self.assertEqual(updater.run(config, args), 'failed-release-held-1.0.0')
                control.assert_not_called()

    def test_bad_checksum_never_reaches_update_admission(self):
        with tempfile.TemporaryDirectory() as folder:
            archive = Path(folder) / 'archive.tar.gz'
            archive.write_bytes(b'unverified data')
            with patch.object(updater, 'control') as control:
                with self.assertRaisesRegex(ValueError, 'SHA-256'):
                    updater.install({}, archive, '1.0.0', 'a' * 64)
                control.assert_not_called()

    def install_case(self, healthy):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder).resolve()
            old = root / 'releases/old'
            (old / 'dsh').mkdir(parents=True)
            (old / 'dsh/package.json').write_text('{"version":"0.9.0"}')
            (root / 'current').symlink_to(old)
            home = root / 'home'
            home.mkdir()
            (home / 'session').write_text('original')
            backups = root / 'backups'
            backups.mkdir()
            archive = root / 'server.tar.gz'
            with tarfile.open(archive, 'w:gz') as source:
                for name, content in [('dsh/package.json', b'{"version":"1.0.0"}'), ('server/start.sh', b'#!/bin/sh\n')]:
                    entry = tarfile.TarInfo(name)
                    entry.size = len(content)
                    source.addfile(entry, io.BytesIO(content))
            config = {'root': str(root), 'user': 'fixture', 'home': str(home), 'backups': str(backups),
                      'maintenance_file': str(root / 'maintenance'), 'health_timeout_seconds': 1 if healthy else 0,
                      'service': 'fixture.service'}
            operations = []

            def command(*args, input_stream=None):
                operations.append(args)
                if args[0] == 'runuser':
                    destination = Path(args[-1])
                    (destination / 'dsh').mkdir()
                    (destination / 'server').mkdir()
                    (destination / 'dsh/package.json').write_text('{"version":"1.0.0"}')
                    (destination / 'server/start.sh').write_text('#!/bin/sh\n')
                if args[:2] == ('systemctl', 'start') and (root / 'current').resolve() != old:
                    (home / 'session').write_text('new-format')

            def control(_config, operation='status'):
                operations.append(('control', operation))
                return {'active': False, 'locked': False,
                        'version': '0.9.0' if (root / 'current').resolve() == old else '1.0.0' if healthy else 'invalid'}

            with patch.object(updater, 'command', command), patch.object(updater, 'control', control), \
                    patch.object(updater, 'check_http'):
                checksum = hashlib.sha256(archive.read_bytes()).hexdigest()
                if healthy:
                    self.assertEqual(updater.install(config, archive, '1.0.0', checksum), 'updated')
                    self.assertNotEqual((root / 'current').resolve(), old)
                    self.assertEqual((root / 'current').resolve().stat().st_mode & 0o777, 0o755)
                    self.assertEqual((home / 'session').read_text(), 'new-format')
                    self.assertEqual(next(backups.glob('*/home/session')).read_text(), 'original')
                else:
                    with self.assertRaisesRegex(RuntimeError, 'health check'):
                        updater.install(config, archive, '1.0.0', checksum)
                    self.assertEqual((root / 'current').resolve(), old)
                    self.assertEqual((home / 'session').read_text(), 'original')
                    self.assertEqual(config['_blocked_version'], '1.0.0')
                self.assertFalse((root / 'maintenance').exists())
                self.assertLess(operations.index(('control', 'lock')), operations.index(('systemctl', 'stop', 'fixture.service')))

    def test_success_retains_backup(self):
        self.install_case(True)

    def test_failed_start_restores_program_and_data(self):
        self.install_case(False)


if __name__ == '__main__':
    unittest.main()
