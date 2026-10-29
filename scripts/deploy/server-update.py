#!/usr/bin/env python3
"""Install complete GitHub server releases with idle admission, data backups, and rollback."""
import argparse
import fcntl
import hashlib
import http.client
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import signal
import socket
import subprocess
import tarfile
import tempfile
import time
import urllib.error
import urllib.request


def version_key(value):
    """Compare stable versions above a prerelease with the same release numbers."""
    match = re.fullmatch(r'(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z.-]+)?', value)
    if match is None:
        raise ValueError('Invalid release version')
    return tuple(int(match[index]) for index in (1, 2, 3)) + (match[4] is None,)


def read_release(repository):
    """Read a published stable release without accepting API-provided download destinations."""
    if re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', repository) is None:
        raise ValueError('Invalid GitHub repository')
    url = f'https://api.github.com/repos/{repository}/releases/latest'
    try:
        return json.loads(fetch_bytes(url, 1_048_576))
    except urllib.error.HTTPError as error:
        if error.code == 404:
            return None
        raise


def fetch_bytes(url, limit):
    """Read bounded release metadata over verified HTTPS."""
    request = urllib.request.Request(url, headers={'User-Agent': 'Neurix-server-updater'})
    with urllib.request.urlopen(request, timeout=60) as response:
        value = response.read(limit + 1)
    if len(value) > limit:
        raise ValueError('Release metadata exceeds its size limit')
    return value


def release_version(release):
    """Reject drafts, prereleases, and tags that cannot identify a stable server archive."""
    tag = release.get('tag_name', '')
    if not isinstance(tag, str) or not re.fullmatch(r'v\d+\.\d+\.\d+', tag):
        raise ValueError('Expected a stable v<version> release tag')
    version_key(tag[1:])
    if release.get('draft') is not False or release.get('prerelease') is not False:
        raise ValueError('The server follows only published stable releases')
    required = {f'neurix-harness-{tag[1:]}-linux-x64-server.tar.gz', 'SHA256SUMS.txt'}
    if not required.issubset({asset.get('name') for asset in release.get('assets', [])}):
        raise ValueError('Release is missing its server archive or checksums')
    return tag[1:]


def archive_checksum(checksums, filename):
    """Require exactly one valid checksum for the selected archive."""
    matches = []
    for line in checksums.decode('utf8').splitlines():
        found = re.fullmatch(r'([a-f0-9]{64})  \*?(?:\./)?(.+)', line)
        if found and found[2] == filename:
            matches.append(found[1])
    if len(matches) != 1:
        raise ValueError('Expected exactly one SHA-256 checksum for the server archive')
    return matches[0]


def digest(path):
    """Hash archive bytes without retaining the archive in memory."""
    hasher = hashlib.sha256()
    with open(path, 'rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            hasher.update(block)
    return hasher.hexdigest()


def validate_archive(archive):
    """Accept only regular data and contained links under the three runtime directories."""
    with tarfile.open(archive, 'r:gz') as source:
        for member in source:
            path = PurePosixPath(member.name)
            if path.is_absolute() or '..' in path.parts or not path.parts or path.parts[0] not in {'dsh', 'runtime', 'server'}:
                raise ValueError('Server archive contains an unsafe path')
            if member.mode & 0o6000:
                raise ValueError('Server archive cannot install privileged executables')
            if not (member.isfile() or member.isdir() or member.issym() or member.islnk()):
                raise ValueError('Server archive contains a special file')
            if member.issym() or member.islnk():
                target = PurePosixPath(member.linkname)
                combined = path.parent / target if member.issym() else target
                depth = 0
                for part in combined.parts:
                    depth += -1 if part == '..' else 0 if part == '.' else 1
                    if depth < 0:
                        raise ValueError('Server archive link escapes its root')
                if target.is_absolute():
                    raise ValueError('Server archive contains an absolute link')


class ControlBusy(RuntimeError):
    """Work started before admission could be locked; defer instead of interrupting it."""


class UnixHTTP(http.client.HTTPConnection):
    """HTTP control confined to a local mode-0600 Unix socket."""
    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(self.timeout)
        self.sock.connect(self.host)


def control(config, operation='status'):
    """Check activity or acquire a bounded admission lock; unknown state is never idle."""
    connection = UnixHTTP(config['control_socket'], timeout=35)
    try:
        connection.request('GET' if operation == 'status' else 'POST', '/' + operation)
        response = connection.getresponse()
        body = json.loads(response.read(16_384))
        if response.status == 409:
            raise ControlBusy('Active work postponed the update')
        if response.status != 200:
            raise RuntimeError('Update control refused operation: ' + operation)
        return body
    finally:
        connection.close()


def command(*args, input_stream=None):
    """Require command completion before performing dependent mutations."""
    subprocess.run(args, check=True, timeout=180, stdin=input_stream)


def switch_link(current, target):
    """Atomically replace the program pointer on its existing filesystem."""
    temporary = current.with_name(current.name + '.updating')
    temporary.unlink(missing_ok=True)
    temporary.symlink_to(target)
    os.replace(temporary, current)


def check_http(config):
    """Require a live app page or its expected unauthenticated response on the loopback listener."""
    request = urllib.request.Request(config['health_url'], headers={'Host': config['health_host']})
    try:
        with urllib.request.urlopen(request, timeout=5) as response:
            if response.status != 200 or b'<html' not in response.read(65_536).lower():
                raise RuntimeError('Application HTTP health check failed')
    except urllib.error.HTTPError as error:
        if error.code != 401:
            raise


def wait_for_version(config, version):
    """Require the replacement's initialized control socket before exposing it to clients."""
    deadline = time.monotonic() + config['health_timeout_seconds']
    while True:
        try:
            state = control(config)
            if state.get('version') == version and state.get('locked') is False:
                check_http(config)
                return
        except (OSError, ValueError, RuntimeError, http.client.HTTPException):
            pass
        if time.monotonic() >= deadline:
            raise RuntimeError('New runtime failed its startup health check')
        time.sleep(1)


def install(config, archive, version, expected_digest):
    """Install verified bytes while idle; a failed startup restores both program and Harness home."""
    if digest(archive) != expected_digest:
        raise ValueError('Downloaded archive SHA-256 does not match')
    validate_archive(archive)
    if control(config).get('active') is not False:
        return 'deferred-active-work'
    releases = Path(config['root']) / 'releases'
    staged = Path(tempfile.mkdtemp(prefix='prepared-', dir=releases))
    # Extract as the unprivileged application user; archive content never executes as root.
    command('chown', config['user'], str(staged))
    with open(archive, 'rb') as source:
        command('runuser', '-u', config['user'], '--', 'tar', '--no-same-owner', '-xzf', '-', '-C', str(staged), input_stream=source)
    command('chown', '-hR', 'root:root', str(staged))
    os.chmod(staged, 0o755)
    manifest = json.loads((staged / 'dsh/package.json').read_text())
    if manifest.get('version') != version or not (staged / 'server/start.sh').is_file():
        raise ValueError('Prepared runtime does not match the selected release')
    current = Path(config['root']) / 'current'
    previous = current.resolve(strict=True)
    previous_version = json.loads((previous / 'dsh/package.json').read_text())['version']
    home = Path(config['home'])
    backup = Path(tempfile.mkdtemp(prefix='before-update-', dir=config['backups']))
    os.chmod(backup, 0o700)
    marker = Path(config['maintenance_file'])
    try:
        control(config, 'lock')
    except ControlBusy:
        shutil.rmtree(staged)
        backup.rmdir()
        return 'deferred-active-work'
    marker.write_text('Neurix update in progress\n')
    os.chmod(marker, 0o644)
    stopped = False
    saved = False
    healthy = False
    try:
        command('systemctl', 'stop', config['service'])
        stopped = True
        if home.is_symlink() or home.resolve() != home.absolute():
            raise ValueError('Harness home must be a real directory at its configured location')
        shutil.copytree(home, backup / 'home', symlinks=True)
        saved = True
        switch_link(current, staged)
        command('systemctl', 'start', config['service'])
        wait_for_version(config, version)
        healthy = True
        (backup / 'previous-program').write_text(str(previous) + '\n')
        return 'updated'
    except BaseException:
        if stopped:
            config['_blocked_version'] = version
            command('systemctl', 'stop', config['service'])
            switch_link(current, previous)
            if saved:
                failed_home = backup / 'failed-home'
                os.replace(home, failed_home)
                os.replace(backup / 'home', home)
                command('chown', '-hR', config['user'], str(home))
            command('systemctl', 'start', config['service'])
            wait_for_version(config, previous_version)
            healthy = True
        raise
    finally:
        if healthy or not stopped:
            marker.unlink(missing_ok=True)
        if not stopped:
            control(config, 'unlock')


def run(config, args):
    """Check stable Releases, download after validation, and install only when explicitly selected."""
    if Path(config.get('maintenance_file', '/nonexistent-neurix-maintenance')).exists():
        raise RuntimeError('A previous update needs recovery; inspect the service and its retained data backup')
    if args.archive:
        if not args.version or not re.fullmatch(r'[a-f0-9]{64}', args.sha256 or ''):
            raise ValueError('Manual archives require --version and --sha256')
        version_key(args.version)
        return install(config, Path(args.archive), args.version, args.sha256)
    release = read_release(config['repository'])
    if release is None:
        return 'no-stable-release'
    version = release_version(release)
    manifest = json.loads((Path(config['root']) / 'current/dsh/package.json').read_text())
    if version_key(version) <= version_key(manifest['version']):
        return 'up-to-date'
    if not args.apply:
        return 'available-' + version
    state_file = Path(config['state_file'])
    previous_state = json.loads(state_file.read_text()) if state_file.exists() else {}
    if previous_state.get('blocked_version') == version:
        return 'failed-release-held-' + version
    if control(config).get('active') is not False:
        return 'deferred-active-work'
    name = f'neurix-harness-{version}-linux-x64-server.tar.gz'
    base = f'https://github.com/{config["repository"]}/releases/download/v{version}/'
    expected = archive_checksum(fetch_bytes(base + 'SHA256SUMS.txt', 131_072), name)
    archive = Path(config['root']) / 'incoming' / name
    if not archive.exists() or digest(archive) != expected:
        temporary = archive.with_suffix('.downloading')
        request = urllib.request.Request(base + name, headers={'User-Agent': 'Neurix-server-updater'})
        try:
            with urllib.request.urlopen(request, timeout=120) as response, temporary.open('wb') as target:
                shutil.copyfileobj(response, target, 1024 * 1024)
            if digest(temporary) != expected:
                raise ValueError('Downloaded archive SHA-256 does not match')
            os.replace(temporary, archive)
        finally:
            temporary.unlink(missing_ok=True)
    return install(config, archive, version, expected)


def main():
    """Serialize updater runs and retain the last result for service diagnostics."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', default='/etc/neurix-agent/server-update.json')
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--archive')
    parser.add_argument('--sha256')
    parser.add_argument('--version')
    args = parser.parse_args()
    config = json.loads(Path(args.config).read_text())
    state = Path(config['state_file'])
    state.parent.mkdir(parents=True, exist_ok=True)
    Path(config['backups']).mkdir(parents=True, exist_ok=True)
    with open(config['lock_file'], 'w') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print('An update check is already running')
            return
        def interrupted(_signum, _frame):
            raise InterruptedError('Server update was interrupted; the installer will restore the previous runtime')

        signal.signal(signal.SIGTERM, interrupted)
        previous_state = json.loads(state.read_text()) if state.exists() else {}
        try:
            result = run(config, args)
        except Exception as error:
            state.write_text(json.dumps({'result': 'failed', 'message': str(error),
                'blocked_version': config.get('_blocked_version', previous_state.get('blocked_version')), 'checked_at': int(time.time())}) + '\n')
            raise
        previous_state = json.loads(state.read_text()) if state.exists() else {}
        blocked = previous_state.get('blocked_version') if result != 'updated' else None
        state.write_text(json.dumps({'result': result, 'blocked_version': blocked, 'checked_at': int(time.time())}) + '\n')
        print(result)


if __name__ == '__main__':
    main()
