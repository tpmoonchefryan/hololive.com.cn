#!/usr/bin/env python3
# Emergency website restore after a failed deploy (TCRN-HOLOLIVE-CN-INC-006, CC-8).
#
# Scope (Owner D2): while PocketBase is stopped, put the website application and its data back
# from the failed run's own stopped backup. The tool restores only the artifact names of the
# backup (dist, backend/pb_migrations, backend/pb_hooks, backend/scripts, package.json,
# package-lock.json, node_modules) and backend/pb_data. It never replaces the PocketBase binary
# (it verifies the live one equals the backup's), and it never starts or stops a service or
# touches configuration, unit or environment files, runtime leaves, the Velocity sync, the
# proxies, Java, the maintenance guard, the deployment lock or the deployment record. Those
# remain manual recovery steps (start PocketBase, remove the leaves, start the old sync under
# the guard, restart proxies whose working directory the failed install deleted, archive the
# failure record). Not wired into the deploy workflow (OD-5).
#
# Usage (as the configured runner user; -I ignores PYTHON* variables and the user site):
#   python3 -I scripts/restore-website-from-backup.py preflight|check|apply BACKUP [--root SANDBOX]
#   preflight  read-only; PocketBase may run. Verifies the bindings, the manifest's closed
#              present/missing set, the backup bytes against the manifest, the live binary,
#              that every live entry a full restore would delete is removable, free space for a
#              full restore and the user. It never reads live file contents except the binary,
#              so it can run before a deploy against the newest existing backup.
#   check      PocketBase stopped; computes and prints the plan; writes nothing.
#   apply      PocketBase stopped; runs the same checks, then replaces each differing name by
#              type (directory tree, file), removes names the backup lists as missing, and
#              synchronizes backend/scripts in place so its directory inode is kept. The
#              removability of every entry it will delete is checked before the first
#              deletion. Exit 1 unless the final inventory equals the expected set.
#              A failed or killed apply is repaired by running apply again: the plan is always
#              recomputed from the live tree, and a run with nothing to do changes nothing.
# Output: exactly one JSON line on stdout for every outcome; file contents are never printed.
# Exit status: 0 only when ok; 1 for a refusal or a failure; 2 for a usage error.
#
# Expected set (derived from the backup's backup.json, not from a fixed list): KNOWN is
# scripts/deployment.mjs artifactPaths plus backend/pb_data and backend/pocketbase (the names
# snapshotApplication() records). present and missing must be duplicate-free, disjoint lists
# that together are exactly KNOWN, with backend/pb_data and backend/pocketbase present. Every
# application entry must belong to a present name; the expected set is every entry except the
# binary, compared by path (a dict), and it must equal the backup bytes before anything else
# uses it. The backup walk mirrors deployment.mjs inventory(): same entry shapes, the same
# refusals for unsafe paths, absolute, external or broken links and special files, which are
# never opened.
#
# Bindings: production values come from the deployment configuration /etc/hololive-deployment.json
# (root-owned, not group/world writable): webRoot, backupRoot, stateRoot, velocityRoot,
# runnerUser, machineIdSha256, configurationFiles. The runner must be the configured non-root
# user on the configured machine. The backup must be a run-<number>-<suffix> directory directly
# under backupRoot, reached without symlinks, and this is checked before the backup is read.
# check and apply accept only the backup named by the current failed record
# (<stateRoot>/deployment.json with status "failed"); preflight is held to the same binding while
# a failure is recorded and otherwise accepts any run backup. Every mode refuses while
# <stateRoot>/deployment.lock exists (a running or killed deploy); check and apply also refuse
# unless PocketBase is stopped (systemctl show pocketbase: LoadState=loaded, MainPID=0 and
# ActiveState inactive or failed). Without a failed record, for example after a deploy process
# was killed before writing one, check and apply refuse; that case needs a separately approved
# recovery. Aliased paths, a tampered backup, an unknown present name, a missing binary entry, a
# differing live binary, environment files (.env, .env.*) inside artifact trees, declared
# configuration files inside restored names and entries the runner cannot remove are all refused
# before any change.
#
# Test override (--root SANDBOX): the fixture tests need their own roots, so the only override is
# an explicit command-line argument; the tool reads no environment variable at all, so nothing in
# a host environment can redirect it. With --root every absolute host path the tool uses (the
# configuration, /etc/machine-id, /usr/bin/systemctl and every configured root) is resolved
# under SANDBOX, while backup and record values keep their host spelling, so the sandbox runs the
# same code path and validation as production, except that its configuration must belong to the
# invoking user instead of root. The sandbox is refused when it is "/", not an
# absolute canonical directory reached without symlinks, not owned by the invoking user, or when
# it equals, lies inside or contains any production path: the configuration file, the machine id,
# systemctl and, when this machine has a production configuration, its webRoot, backupRoot,
# stateRoot and velocityRoot (a production configuration that exists but cannot be read refuses
# the sandbox). The sandbox's resolved roots must also not be the same directories as the
# production roots (bind mounts). Child processes get a fixed environment.
#
# Python 3 standard library only; compatible with Python 3.9 and 3.12.
import hashlib
import json
import os
import pwd
import re
import shutil
import stat
import subprocess
import sys

CONFIG = '/etc/hololive-deployment.json'
MACHINE_ID = '/etc/machine-id'
SYSTEMCTL = '/usr/bin/systemctl'
UNIT = 'pocketbase'
STATE_FILE = 'deployment.json'
LOCK_FILE = 'deployment.lock'
# scripts/deployment.mjs artifactPaths, then the two names snapshotApplication() adds.
KNOWN = ['dist', 'backend/pb_migrations', 'backend/pb_hooks', 'backend/scripts', 'package.json',
         'package-lock.json', 'node_modules', 'backend/pb_data', 'backend/pocketbase']
DATA = 'backend/pb_data'
BINARY = 'backend/pocketbase'
RESTORABLE = [name for name in KNOWN if name != BINARY]
IN_PLACE = 'backend/scripts'  # running proxies use it as their working directory
MODES = ('preflight', 'check', 'apply')
ROOT_KEYS = ('webRoot', 'backupRoot', 'stateRoot', 'velocityRoot')
USAGE = 'usage: python3 -I restore-website-from-backup.py preflight|check|apply BACKUP [--root SANDBOX]'
BACKUP_NAME = re.compile(r'run-([0-9]+)-[A-Za-z0-9]+')
DIGEST = re.compile(r'[0-9a-f]{64}')
CHILD_ENV = {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LC_ALL': 'C', 'SYSTEMD_PAGER': '', 'SYSTEMD_COLORS': '0'}
SPACE_MARGIN = 64 << 20
INODE_MARGIN = 1024
SHOWN = 50


class Refusal(Exception):
    def __init__(self, reason, **fields):
        Exception.__init__(self, reason)
        self.reason = reason
        self.fields = fields


def require(condition, reason, **fields):
    if not condition:
        raise Refusal(reason, **fields)


def canonical(value):
    """Absolute, normalized and not the file system root."""
    return (isinstance(value, str) and value.startswith('/') and not value.startswith('//')
            and os.path.normpath(value) == value and value != '/')


def overlaps(a, b):
    return a == b or a.startswith(b + '/') or b.startswith(a + '/')


def unaliased(path):
    return os.path.realpath(path) == path


def depth(rel):
    return rel.count('/')


def owner(rel):
    for name in KNOWN:
        if rel == name or rel.startswith(name + '/'):
            return name
    return None


def environment_name(rel):
    # deployment.mjs verifyInstallTargets scope: artifact trees only; uploads in pb_data may
    # carry any name.
    return owner(rel) != DATA and any(part == '.env' or part.startswith('.env.') for part in rel.split('/'))


def safe_relative(name):
    # deployment.mjs safeRelative()
    return (isinstance(name, str) and not name.startswith('/') and '\\' not in name
            and all(part not in ('', '.', '..') for part in name.split('/')))


def plain_directory(entry):
    return entry is not None and sorted(entry) == ['directory', 'mode', 'path']


def file_digest(path):
    """sha256 of a regular file; None when the opened object is not a regular file. The open
    never follows a link and never blocks on a FIFO."""
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        if not stat.S_ISREG(os.fstat(fd).st_mode):
            return None
        digest = hashlib.sha256()
        while True:
            chunk = os.read(fd, 1 << 20)
            if not chunk:
                return digest.hexdigest()
            digest.update(chunk)
    finally:
        os.close(fd)


def read_json(path, what):
    """A small JSON object from a regular file reached without a final symlink."""
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    except OSError as error:
        raise Refusal(what + ' cannot be opened', error=type(error).__name__)
    with os.fdopen(fd, 'rb') as handle:
        require(stat.S_ISREG(os.fstat(handle.fileno()).st_mode), what + ' is not a regular file')
        data = handle.read()
    try:
        value = json.loads(data.decode('utf-8'))
    except ValueError:
        raise Refusal(what + ' is not valid JSON')
    require(isinstance(value, dict), what + ' is not a JSON object')
    return value


class Host:
    """Maps a host path to the file actually used: itself, or the same path below the sandbox."""

    def __init__(self, sandbox, protected):
        self.sandbox = sandbox
        self.protected = protected

    def path(self, logical):
        return logical if self.sandbox is None else self.sandbox + logical


def production_paths():
    protected = [CONFIG, MACHINE_ID, SYSTEMCTL]
    if not os.path.lexists(CONFIG):
        return protected
    try:
        with open(CONFIG, 'rb') as handle:
            production = json.loads(handle.read().decode('utf-8'))
    except (OSError, ValueError):
        raise Refusal('A production configuration exists but cannot be read; sandbox separation cannot be proven', config=CONFIG)
    require(isinstance(production, dict), 'Production configuration is not a JSON object; sandbox separation cannot be proven', config=CONFIG)
    for key in ROOT_KEYS:
        require(canonical(production.get(key)), 'Production configuration has no valid ' + key + '; sandbox separation cannot be proven', config=CONFIG)
        protected.append(production[key])
    return protected


def resolve_sandbox(value):
    shown = value if isinstance(value, str) else None
    require(canonical(value), 'Sandbox root must be an absolute canonical path other than /', sandbox=shown)
    protected = production_paths()
    clashes = [path for path in protected if overlaps(value, path)]
    require(not clashes, 'Sandbox root overlaps a production path', sandbox=shown, production=clashes)
    require(os.path.isdir(value) and unaliased(value), 'Sandbox root must be an existing directory reached without symlinks', sandbox=shown)
    require(os.lstat(value).st_uid == os.geteuid(), 'Sandbox root must be owned by the invoking user', sandbox=shown)
    return Host(value, protected)


def load_config(host):
    path = host.path(CONFIG)
    require(os.path.lexists(path), 'Missing deployment configuration', config=CONFIG)
    info = os.lstat(path)
    require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and unaliased(path),
            'Deployment configuration must be one regular file reached without symlinks', config=CONFIG)
    expected_owner = 0 if host.sandbox is None else os.geteuid()
    require(info.st_uid == expected_owner and not info.st_mode & 0o022,
            'Deployment configuration must be owned by ' + ('root' if host.sandbox is None else 'the sandbox user') + ' and not group/world writable', config=CONFIG)
    config = read_json(path, 'Deployment configuration')
    for key in ROOT_KEYS:
        require(canonical(config.get(key)), 'Invalid ' + key + ' in the deployment configuration')
    for i, first in enumerate(ROOT_KEYS):
        for second in ROOT_KEYS[i + 1:]:
            require(not overlaps(config[first], config[second]), 'Overlapping ' + first + '/' + second + ' in the deployment configuration')
    require(isinstance(config.get('runnerUser'), str) and config['runnerUser'] != '', 'Missing runnerUser in the deployment configuration')
    require(isinstance(config.get('machineIdSha256'), str) and DIGEST.fullmatch(config['machineIdSha256']) is not None,
            'Missing machineIdSha256 in the deployment configuration')
    files = config.get('configurationFiles', [])
    require(isinstance(files, list) and all(isinstance(item, str) for item in files), 'Invalid configurationFiles in the deployment configuration')
    return config


def check_identity(host, config):
    try:
        runner = pwd.getpwnam(config['runnerUser'])
    except KeyError:
        raise Refusal('Configured runner user does not exist', runnerUser=config['runnerUser'])
    uid, euid = os.getuid(), os.geteuid()
    require(runner.pw_uid != 0 and uid == euid == runner.pw_uid, 'Must run as the configured runner user, not root',
            runnerUser=config['runnerUser'], uid=euid)
    try:
        with open(host.path(MACHINE_ID), 'rb') as handle:
            machine = hashlib.sha256(handle.read()).hexdigest()
    except OSError as error:
        raise Refusal('Cannot read the machine id', path=MACHINE_ID, error=type(error).__name__)
    require(machine == config['machineIdSha256'], 'Wrong host: the machine id differs from the deployment configuration')
    return euid


def pocketbase_state(host):
    command = [host.path(SYSTEMCTL), 'show', UNIT, '-p', 'LoadState', '-p', 'ActiveState', '-p', 'MainPID']
    try:
        completed = subprocess.run(command, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                   env=CHILD_ENV, timeout=30, check=False)
    except (OSError, subprocess.SubprocessError) as error:
        raise Refusal('Cannot read the PocketBase service state', error=type(error).__name__)
    require(completed.returncode == 0, 'Cannot read the PocketBase service state', status=completed.returncode)
    properties = {}
    for line in completed.stdout.decode('utf-8', 'replace').splitlines():
        key, separator, value = line.partition('=')
        if separator:
            require(key not in properties, 'Ambiguous PocketBase service state')
            properties[key] = value
    require(sorted(properties) == ['ActiveState', 'LoadState', 'MainPID'], 'Unexpected PocketBase service state output', keys=sorted(properties)[:SHOWN])
    require(properties['LoadState'] == 'loaded', 'The PocketBase unit is not loaded', pocketbase=properties)
    return properties


def stopped(pocketbase):
    return pocketbase['MainPID'] == '0' and pocketbase['ActiveState'] in ('inactive', 'failed')


def read_record(path):
    if not os.path.lexists(path):
        return None
    return read_json(path, 'Deployment record')


def derive(manifest):
    """KNOWN-closed present/missing, every entry under a present name, binary separated."""
    present, missing = manifest.get('present'), manifest.get('missing')
    require(isinstance(present, list) and isinstance(missing, list) and all(isinstance(name, str) for name in present + missing),
            'Backup present/missing are not name lists')
    unknown = sorted(set(present + missing) - set(KNOWN))
    require(not unknown, 'Backup names an unknown artifact', names=unknown[:SHOWN])
    require(len(set(present)) == len(present) and len(set(missing)) == len(missing), 'Backup present/missing repeat a name')
    both = sorted(set(present) & set(missing))
    require(not both, 'Backup lists a name as both present and missing', names=both)
    uncovered = [name for name in KNOWN if name not in present and name not in missing]
    require(not uncovered, 'Backup present/missing do not cover the known names', names=uncovered)
    require(DATA in present and BINARY in present, 'Backup lacks the database or the PocketBase binary')
    application = manifest.get('application')
    require(isinstance(application, list), 'Backup manifest has no application inventory')
    entries, admitted = {}, set(present)
    for entry in application:
        require(isinstance(entry, dict) and isinstance(entry.get('path'), str), 'Malformed backup manifest entry')
        rel = entry['path']
        require(rel not in entries, 'Duplicate backup manifest entry', path=rel)
        require(owner(rel) in admitted, 'Backup manifest entry outside the present names', path=rel)
        entries[rel] = entry
    binary = entries.get(BINARY)
    require(binary is not None, 'Backup manifest lacks the PocketBase binary entry')
    require(sorted(binary) == ['mode', 'path', 'sha256'] and isinstance(binary['sha256'], str) and DIGEST.fullmatch(binary['sha256']) is not None
            and type(binary['mode']) is int and 0 <= binary['mode'] <= 0o777, 'Backup manifest has a malformed PocketBase binary entry')
    require(not any(owner(rel) == BINARY and rel != BINARY for rel in entries), 'Backup manifest has entries below the PocketBase binary')
    for name in present:
        top = entries.get(name)
        require(top is not None, 'Backup manifest lacks the entry of a present name', name=name)
        require('link' not in top, 'Backup top-level entry is a link', name=name)
    expected = dict((rel, entry) for rel, entry in entries.items() if owner(rel) != BINARY)
    environment = sorted(rel for rel in expected if environment_name(rel))
    require(not environment, 'Backup holds environment files inside restored artifacts', paths=environment[:SHOWN])
    return [name for name in KNOWN if name in admitted], [name for name in KNOWN if name in missing], expected, binary


def backup_inventory(root, names, sizes):
    """Mirror of deployment.mjs inventory() over the backup's application tree, keyed by path."""
    found, stack = {}, list(reversed(names))
    while stack:
        rel = stack.pop()
        require(safe_relative(rel), 'Unsafe path in the backup', path=rel)
        path = root + '/' + rel
        try:
            info = os.lstat(path)
            if stat.S_ISLNK(info.st_mode):
                target = os.readlink(path)
                resolved = os.path.normpath(os.path.join(os.path.dirname(path), target))
                require(not target.startswith('/') and resolved.startswith(root + '/'), 'External symlink in the backup', path=rel)
                require(os.path.exists(resolved), 'Broken symlink in the backup', path=rel)
                found[rel] = {'path': rel, 'link': target}
            elif stat.S_ISDIR(info.st_mode):
                found[rel] = {'path': rel, 'directory': True, 'mode': info.st_mode & 0o777}
                stack.extend(rel + '/' + child for child in sorted(os.listdir(path), reverse=True))
            elif stat.S_ISREG(info.st_mode):
                digest = file_digest(path)
                require(digest is not None, 'Special file in the backup', path=rel)
                found[rel] = {'path': rel, 'sha256': digest, 'mode': info.st_mode & 0o777}
                sizes[rel] = info.st_size
            else:
                raise Refusal('Special file in the backup', path=rel)
        except FileNotFoundError:
            raise Refusal('Backup application lacks a path', path=rel)
        except OSError as error:
            raise Refusal('Backup is not readable by the runner', path=rel, error=type(error).__name__)
    return found


def live_inventory(root, names):
    """The live tree as entries comparable with the manifest. Nothing is refused here: entries
    that cannot be read, listed or that are special get a marker so they compare unequal."""
    found, stack = {}, list(reversed(names))
    while stack:
        rel = stack.pop()
        path = root + '/' + rel
        try:
            info = os.lstat(path)
        except FileNotFoundError:
            continue
        except OSError:
            found[rel] = {'path': rel, 'inaccessible': True}
            continue
        if stat.S_ISLNK(info.st_mode):
            try:
                found[rel] = {'path': rel, 'link': os.readlink(path)}
            except OSError:
                found[rel] = {'path': rel, 'inaccessible': True}
        elif stat.S_ISDIR(info.st_mode):
            entry = {'path': rel, 'directory': True, 'mode': info.st_mode & 0o777}
            try:
                children = sorted(os.listdir(path), reverse=True)
            except FileNotFoundError:
                continue
            except OSError:
                entry['unlistable'], children = True, []
            found[rel] = entry
            stack.extend(rel + '/' + child for child in children)
        elif stat.S_ISREG(info.st_mode):
            try:
                digest = file_digest(path)
            except FileNotFoundError:
                continue
            except OSError:
                digest = None
            found[rel] = {'path': rel, 'sha256': digest, 'mode': info.st_mode & 0o777} if digest else {'path': rel, 'unreadable': True}
        else:
            found[rel] = {'path': rel, 'special': True}
    return found


def removal_blockers(root, rel, euid, blocked, seen):
    """deployment.mjs verifyInstallTargets rule for the whole live subtree at rel: an entry is
    removable when its parent grants write and search and, under a sticky parent, this user owns
    the entry or the parent; a directory must also be listable so that it can be emptied. File
    contents are never read."""
    stack = [rel]
    while stack:
        current = stack.pop()
        path = root + '/' + current
        parent = os.path.dirname(path)
        try:
            info, parent_info = os.lstat(path), os.lstat(parent)
        except FileNotFoundError:
            continue
        except OSError:
            blocked.add(current)
            continue
        seen.append(current)
        if not os.access(parent, os.W_OK | os.X_OK) or (parent_info.st_mode & stat.S_ISVTX and euid not in (info.st_uid, parent_info.st_uid)):
            blocked.add(current)
        if stat.S_ISDIR(info.st_mode):
            if not os.access(path, os.R_OK | os.X_OK):
                blocked.add(current)
                continue
            try:
                children = os.listdir(path)
            except FileNotFoundError:
                continue
            except OSError:
                blocked.add(current)
                continue
            stack.extend(current + '/' + child for child in children)


def creatable(directory):
    return os.path.isdir(directory) and os.access(directory, os.W_OK | os.X_OK)


def group(entries):
    grouped = dict((name, {}) for name in KNOWN)
    for rel, entry in entries.items():
        grouped[owner(rel)][rel] = entry
    return grouped


def sync_steps(name, here, want):
    """In-place synchronization of one directory name: deepest deletions, shallowest creations,
    then the modes of every expected directory. Directories present in both are kept."""
    def kept(rel):
        return plain_directory(here.get(rel)) and plain_directory(want.get(rel))
    deletions = sorted((rel for rel in here if rel != name and here[rel] != want.get(rel) and not kept(rel)), key=lambda rel: (-depth(rel), rel))
    creations = sorted((rel for rel in want if rel != name and here.get(rel) != want[rel] and not kept(rel)), key=lambda rel: (depth(rel), rel))
    directories = sorted((rel for rel in want if want[rel].get('directory')), key=lambda rel: (-depth(rel), rel))
    return deletions, creations, directories


def plan_restore(live, expected, missing):
    here_by_name, want_by_name = group(live), group(expected)
    plan, differences = {}, {}
    for name in RESTORABLE:
        here, want = here_by_name[name], want_by_name[name]
        differences[name] = sum(1 for rel in set(here) | set(want) if here.get(rel) != want.get(rel))
        if name in missing:
            plan[name] = 'remove' if here else 'keep'
        elif here == want:
            plan[name] = 'keep'
        elif name == IN_PLACE and plain_directory(here.get(name)) and plain_directory(want.get(name)):
            plan[name] = 'sync'
        else:
            plan[name] = 'replace'
    return plan, differences, here_by_name, want_by_name


def plan_blockers(web, plan, here_by_name, want_by_name, euid):
    blocked, seen = set(), []
    for name in RESTORABLE:
        action, target = plan[name], web + '/' + name
        if action in ('remove', 'replace') and os.path.lexists(target):
            removal_blockers(web, name, euid, blocked, seen)
        elif action == 'replace' and not creatable(os.path.dirname(target)):
            blocked.add(os.path.dirname(name) or '.')
        elif action == 'sync':
            here, want = here_by_name[name], want_by_name[name]
            deletions, creations, directories = sync_steps(name, here, want)
            removed, created = set(deletions), set(creations)
            for rel in deletions:
                if os.path.dirname(rel) not in removed:
                    removal_blockers(web, rel, euid, blocked, seen)
            for rel in creations:
                parent = os.path.dirname(rel)
                if parent not in created and not creatable(web + '/' + parent):
                    blocked.add(parent)
            for rel in directories:
                if rel not in created and here[rel]['mode'] != want[rel]['mode'] and os.lstat(web + '/' + rel).st_uid != euid:
                    blocked.add(rel)
    return blocked


def plan_space(plan, here_by_name, want_by_name, sizes):
    needed_bytes, needed_inodes = 0, 0
    for name in RESTORABLE:
        if plan[name] == 'replace':
            copied = list(want_by_name[name])
        elif plan[name] == 'sync':
            copied = sync_steps(name, here_by_name[name], want_by_name[name])[1]
        else:
            copied = []
        needed_bytes += sum(sizes.get(rel, 0) for rel in copied)
        needed_inodes += len(copied)
    return needed_bytes, needed_inodes


def space_report(web, needed_bytes, needed_inodes):
    fs = os.statvfs(web)
    free_bytes, free_inodes = fs.f_bavail * fs.f_frsize, fs.f_favail
    report = {'freeBytes': free_bytes, 'neededBytes': needed_bytes, 'marginBytes': SPACE_MARGIN,
              'freeInodes': free_inodes if fs.f_files else None, 'neededInodes': needed_inodes}
    enough = free_bytes >= needed_bytes + SPACE_MARGIN and (not fs.f_files or free_inodes >= needed_inodes + INODE_MARGIN)
    return report, enough


def remove(path):
    if stat.S_ISDIR(os.lstat(path).st_mode):
        shutil.rmtree(path)
    else:
        os.unlink(path)


def copy_top(source, target, entry):
    if entry.get('directory'):
        shutil.copytree(source, target, symlinks=True, copy_function=shutil.copy2)
    else:
        shutil.copy2(source, target)
    os.chmod(target, entry['mode'])


def synchronize(web, application, name, here, want):
    deletions, creations, directories = sync_steps(name, here, want)
    for rel in deletions:
        if os.path.lexists(web + '/' + rel):
            remove(web + '/' + rel)
    for rel in creations:
        entry, target = want[rel], web + '/' + rel
        if entry.get('directory'):
            os.mkdir(target, 0o700)
        elif 'link' in entry:
            os.symlink(entry['link'], target)
        else:
            shutil.copy2(application + '/' + rel, target)
            os.chmod(target, entry['mode'])
    for rel in directories:
        target = web + '/' + rel
        if os.lstat(target).st_mode & 0o777 != want[rel]['mode']:
            os.chmod(target, want[rel]['mode'])


def inode(path):
    try:
        return os.lstat(path).st_ino
    except FileNotFoundError:
        return None


def restore(mode, backup, sandbox, progress):
    host = resolve_sandbox(sandbox) if sandbox is not None else Host(None, [])
    config = load_config(host)
    euid = check_identity(host, config)
    roots = {}
    for key in ('webRoot', 'backupRoot', 'stateRoot'):
        roots[key] = host.path(config[key])
        require(os.path.isdir(roots[key]) and unaliased(roots[key]), 'Configured ' + key + ' is missing or aliased', path=config[key])
        for production in host.protected:
            if host.sandbox is not None and os.path.isdir(production) and os.path.samefile(roots[key], production):
                raise Refusal('Sandbox root reaches a production directory', path=config[key], production=production)
    web = roots['webRoot']

    # The backup is bound by name before anything is read from it (RT-4).
    match = BACKUP_NAME.fullmatch(os.path.basename(backup)) if canonical(backup) else None
    require(match is not None and os.path.dirname(backup) == config['backupRoot'],
            'Backup must be a run-<number>-<suffix> directory directly under the configured backup root', backupRoot=config['backupRoot'])
    record = read_record(roots['stateRoot'] + '/' + STATE_FILE)
    status = record.get('status') if record is not None else None
    failed = status == 'failed'
    record_backup = record.get('backup') if record is not None else None
    lock = os.path.lexists(roots['stateRoot'] + '/' + LOCK_FILE)
    require(not lock, 'A deployment lock is present')
    if mode != 'preflight':
        require(failed, 'No failed deployment record: check and apply restore only the backup of a recorded failure', recordStatus=status if isinstance(status, str) else None)
    if failed:
        require(isinstance(record_backup, str), 'The failed deployment record names no backup')
        require(record_backup == backup, "Backup is not the failed run's own backup", failedBackup=record_backup)
    pocketbase = pocketbase_state(host)
    if mode != 'preflight':
        require(stopped(pocketbase), 'PocketBase is running; check and apply need it stopped', pocketbase=pocketbase)

    source = host.path(backup)
    require(os.path.lexists(source), 'Backup does not exist')
    require(not os.path.islink(source) and unaliased(source), 'Aliased backup path')
    require(os.path.isdir(source), 'Backup is not a directory')
    manifest = read_json(source + '/backup.json', 'Backup manifest')
    present, missing, expected, binary = derive(manifest)
    application = source + '/application'
    require(os.path.isdir(application) and unaliased(application), 'Backup application directory is missing or aliased')
    if os.path.lexists(application + '/backend'):
        require(os.path.isdir(application + '/backend') and unaliased(application + '/backend'), 'Backup application backend directory is aliased')
    for name in missing:
        require(not os.path.lexists(application + '/' + name), 'Backup holds a name its manifest lists as missing', name=name)
    sizes = {}
    actual = backup_inventory(application, [name for name in present if name != BINARY], sizes)
    if actual != expected:
        differing = sorted(rel for rel in set(actual) | set(expected) if actual.get(rel) != expected.get(rel))
        raise Refusal('Backup application differs from its manifest', count=len(differing), paths=differing[:SHOWN])

    # The deploy never replaces the binary; the restore only proves it is the backup's.
    live_binary = web + '/' + BINARY
    require(os.path.lexists(live_binary) and stat.S_ISREG(os.lstat(live_binary).st_mode), 'Live PocketBase binary is missing or not a regular file')
    try:
        live_digest = file_digest(live_binary)
    except OSError as error:
        raise Refusal('Live PocketBase binary cannot be read', error=type(error).__name__)
    require(live_digest == binary['sha256'] and os.lstat(live_binary).st_mode & 0o777 == binary['mode'],
            'Live PocketBase binary differs from the backup')
    for name in RESTORABLE:
        parent = os.path.dirname(name)
        require(os.path.isdir(web + '/' + parent if parent else web) and unaliased(web + '/' + parent if parent else web),
                'Live artifact parent is missing or aliased', path=parent or '.')
        require(not os.path.islink(web + '/' + name), 'Aliased live artifact path', path=name)
    for item in config.get('configurationFiles', []):
        for name in RESTORABLE:
            require(not overlaps(item, config['webRoot'] + '/' + name), 'Runtime configuration overlaps a restored artifact', path=item)

    result = {'mode': mode, 'backup': backup, 'sandbox': host.sandbox,
              'record': {'status': status if isinstance(status, str) else None, 'backup': record_backup if isinstance(record_backup, str) else None},
              'lockPresent': lock, 'pocketbase': pocketbase, 'present': present, 'missing': missing, 'expectedEntries': len(expected),
              'run': int(match.group(1)), 'newestRun': newest_run(roots['backupRoot'])}

    if mode == 'preflight':
        # Worst case: a failed run replaced every name, so every live entry may be deleted.
        blocked, seen = set(), []
        for name in RESTORABLE:
            if os.path.lexists(web + '/' + name):
                removal_blockers(web, name, euid, blocked, seen)
            elif not creatable(os.path.dirname(web + '/' + name)):
                blocked.add(os.path.dirname(name) or '.')
        environment = sorted(rel for rel in seen if environment_name(rel))
        require(not environment, 'Runtime environment file inside a restored artifact', paths=environment[:SHOWN])
        space, enough = space_report(web, sum(sizes.values()), len(expected))
        result.update(pocketbaseRunning=not stopped(pocketbase), blocked=sorted(blocked)[:SHOWN], blockedCount=len(blocked), space=space, changed=False)
        require(not blocked, 'Live entries not removable by the runner', blocked=sorted(blocked)[:SHOWN], blockedCount=len(blocked))
        require(enough, 'Not enough free space for a full restore', space=space)
        return True, result

    live = live_inventory(web, RESTORABLE)
    environment = sorted(rel for rel in live if environment_name(rel))
    require(not environment, 'Runtime environment file inside a restored artifact', paths=environment[:SHOWN])
    plan, differences, here_by_name, want_by_name = plan_restore(live, expected, missing)
    blocked = plan_blockers(web, plan, here_by_name, want_by_name, euid)
    needed_bytes, needed_inodes = plan_space(plan, here_by_name, want_by_name, sizes)
    space, enough = space_report(web, needed_bytes, needed_inodes)
    result.update(plan=plan, differences=differences, blocked=sorted(blocked)[:SHOWN], blockedCount=len(blocked), space=space)
    require(not blocked, 'Live entries not removable by the runner', plan=plan, blocked=sorted(blocked)[:SHOWN], blockedCount=len(blocked))
    require(enough, 'Not enough free space for the restore', plan=plan, space=space)
    if mode == 'check':
        result['changed'] = False
        return True, result

    # apply: the only writes. Every name is reconciled from the live tree, so a rerun converges.
    scripts_before = inode(web + '/' + IN_PLACE)
    for name in RESTORABLE:
        action = plan[name]
        if action == 'keep':
            continue
        progress['current'], progress['changed'] = name, True
        target = web + '/' + name
        if action in ('remove', 'replace') and os.path.lexists(target):
            remove(target)
        if action == 'replace':
            copy_top(application + '/' + name, target, expected[name])
        elif action == 'sync':
            synchronize(web, application, name, here_by_name[name], want_by_name[name])
        progress['completed'].append(name)
    progress['current'] = None
    after = live_inventory(web, RESTORABLE)
    mismatched = sorted(rel for rel in set(after) | set(expected) if after.get(rel) != expected.get(rel))
    pocketbase_after = pocketbase_state(host)
    result.update(completed=list(progress['completed']), restoredEntries=len(after), mismatched=mismatched[:SHOWN], mismatchedCount=len(mismatched),
                  scriptsDirectoryKept=plan[IN_PLACE] in ('keep', 'sync') and scripts_before is not None and inode(web + '/' + IN_PLACE) == scripts_before,
                  pocketbaseAfter=pocketbase_after, changed=progress['changed'])
    if mismatched:
        result['reason'] = 'Final live inventory differs from the backup manifest; run apply again'
        return False, result
    if not stopped(pocketbase_after):
        result['reason'] = 'PocketBase was started while the restore ran'
        return False, result
    return True, result


def newest_run(directory):
    runs = []
    try:
        names = os.listdir(directory)
    except OSError:
        return None
    for name in names:
        match = BACKUP_NAME.fullmatch(name)
        if match:
            runs.append(int(match.group(1)))
    return max(runs) if runs else None


def emit(fields, code):
    sys.stdout.write(json.dumps(fields, separators=(',', ':')) + '\n')
    sys.stdout.flush()
    return code


def main(argv):
    if len(argv) == 2:
        mode, backup, sandbox = argv[0], argv[1], None
    elif len(argv) == 4 and argv[2] == '--root':
        mode, backup, sandbox = argv[0], argv[1], argv[3]
    else:
        mode = backup = sandbox = None
    if mode not in MODES:
        return emit({'ok': False, 'reason': USAGE}, 2)
    progress = {'current': None, 'completed': [], 'changed': False}
    try:
        ok, result = restore(mode, backup, sandbox, progress)
        return emit(dict([('ok', ok)] + list(result.items())), 0 if ok else 1)
    except Refusal as refusal:
        fields = [('ok', False), ('mode', mode), ('backup', backup), ('sandbox', sandbox), ('reason', refusal.reason)]
        return emit(dict(fields + list(refusal.fields.items()) + [('changed', progress['changed'])]), 1)
    except (Exception, KeyboardInterrupt) as error:
        reason = 'Apply stopped before completion; run apply again with the same backup' if progress['changed'] else 'Unexpected error before any change'
        return emit({'ok': False, 'mode': mode, 'backup': backup, 'sandbox': sandbox, 'reason': reason,
                     'error': (type(error).__name__ + ': ' + str(error))[:500], 'failedAt': progress['current'],
                     'completed': progress['completed'], 'changed': progress['changed']}, 1)


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
