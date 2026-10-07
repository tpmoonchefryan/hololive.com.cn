// Fixture tests for scripts/restore-website-from-backup.py (TCRN-HOLOLIVE-CN-INC-006, CC-8).
// Backups come from the real snapshotApplication()/inventory() of scripts/deployment.mjs (used
// read-only), inside a private sandbox under the default TMPDIR. The tool runs with
// --root <sandbox>, so every host path it uses resolves inside the sandbox, and a fake
// systemctl there reports the PocketBase state. Every sandbox is removed after its test.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { artifactPaths, inventory, snapshotApplication } from '../scripts/deployment.mjs';

const tool = fileURLToPath(new URL('../scripts/restore-website-from-backup.py', import.meta.url));
const WEB = '/var/www/hololive.com.cn', BACKUPS = '/var/backups/hololive-deployment', STATE = '/var/lib/hololive-deployment';
const BACKUP = BACKUPS + '/run-105-nlAIir';
const KNOWN = [...artifactPaths, 'backend/pb_data', 'backend/pocketbase'];
const ALL = ['preflight', 'check', 'apply'], WRITERS = ['check', 'apply'];
const SHOW = 'show pocketbase -p LoadState -p ActiveState -p MainPID';
const STOPPED = 'LoadState=loaded\nActiveState=inactive\nMainPID=0\n';
const RUNNING = 'LoadState=loaded\nActiveState=active\nMainPID=4242\n';
const sha = data => createHash('sha256').update(data).digest('hex');

function put(file, data, mode = 0o644) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
  fs.chmodSync(file, mode);
}

// Release artifacts in the shapes the deploy records: nested directories with several modes, an
// empty file and directory, npm-style relative links and non-ASCII names.
function release(root, { variant = 'old', hooks = true, deps = 'old', modules = 40 } = {}) {
  put(`${root}/dist/index.html`, `${variant} index`);
  put(`${root}/dist/assets/app-${variant}.js`, `${variant} app`);
  put(`${root}/dist/assets/empty.txt`, '');
  put(`${root}/dist/private/notes-ü-文件-😀.txt`, `${variant} notes`, 0o600);
  fs.chmodSync(`${root}/dist/private`, 0o750);
  put(`${root}/backend/pb_migrations/1765100008_add_velocity_advanced.js`, 'retained history');
  if (variant === 'new') put(`${root}/backend/pb_migrations/1770900000_candidate.js`, 'candidate migration');
  if (hooks) put(`${root}/backend/pb_hooks/admin-auth.pb.js`, `${variant} hook`);
  put(`${root}/backend/scripts/sync_velocity.js`, `${variant} sync`);
  put(`${root}/backend/scripts/map_proxy.js`, `${variant} proxy`);
  put(`${root}/backend/scripts/lib/velocity-sync.js`, `${variant} library`);
  if (variant === 'old') put(`${root}/backend/scripts/lib/old-only.js`, 'removed by the candidate');
  else put(`${root}/backend/scripts/lib/candidate-only/helper.js`, 'added by the candidate');
  put(`${root}/package.json`, JSON.stringify({ name: 'fixture', deps }));
  put(`${root}/package-lock.json`, JSON.stringify({ lockfileVersion: 3, deps }));
  for (let i = 0; i < modules; i++) put(`${root}/node_modules/pkg${i % 25}/lib/file${i}.js`, `${deps} module ${i}`);
  put(`${root}/node_modules/pkg0/bin/cli.js`, `${deps} cli`, 0o755);
  fs.mkdirSync(`${root}/node_modules/.bin`, { recursive: true });
  fs.symlinkSync('../pkg0/bin/cli.js', `${root}/node_modules/.bin/cli`);
  fs.symlinkSync('pkg0', `${root}/node_modules/pkg-alias`);
  fs.mkdirSync(`${root}/node_modules/empty-package`, { recursive: true });
}

function sandbox(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hololive-restore-')));
  t.after(() => removeSandbox(root));
  const machine = 'fixture machine\n';
  put(`${root}/etc/machine-id`, machine);
  put(`${root}/etc/hololive-deployment.json`, JSON.stringify({
    webRoot: WEB, backupRoot: BACKUPS, stateRoot: STATE, velocityRoot: '/opt/velocity', runnerUser: os.userInfo().username, machineIdSha256: sha(machine),
    configurationFiles: ['/etc/systemd/system/pocketbase.service', '/etc/nginx/sites-available/hololive.com.cn', '/etc/default/velocity-sync'],
  }), 0o640);
  put(`${root}/usr/bin/systemctl`, `#!/bin/sh\nprintf '%s\\n' "$*" >> '${root}/systemctl.log'\ncat '${root}/pocketbase.state'\n`, 0o755);
  put(`${root}/pocketbase.state`, STOPPED);
  fs.mkdirSync(root + BACKUPS, { recursive: true });
  fs.mkdirSync(root + STATE, { recursive: true });
  fs.chmodSync(root + BACKUPS, 0o700);
  fs.chmodSync(root + STATE, 0o700);
  const web = root + WEB;
  return { root, web };
}

function removeSandbox(root) {
  const open = directory => {
    for (const name of fs.readdirSync(directory)) {
      const file = path.join(directory, name);
      if (fs.lstatSync(file).isDirectory()) { fs.chmodSync(file, 0o700); open(file); }
    }
  };
  fs.chmodSync(root, 0o700);
  open(root);
  fs.rmSync(root, { recursive: true, force: true });
}

function site(s, options) {
  release(s.web, options);
  put(`${s.web}/backend/pb_data/data.db`, 'database before the deploy');
  put(`${s.web}/backend/pb_data/auxiliary.db`, 'auxiliary database');
  put(`${s.web}/backend/pb_data/storage/collection/record/media.bin`, 'uploaded media');
  // Uploads may carry any name; only artifact trees refuse environment-like names.
  put(`${s.web}/backend/pb_data/storage/collection/record/.env.example`, 'an upload named like an environment file');
  fs.mkdirSync(`${s.web}/backend/pb_data/backups`, { recursive: true });
  put(`${s.web}/backend/pocketbase`, 'pocketbase binary', 0o755);
  // Neighbours outside the restored names; the restore must never touch them.
  put(`${s.web}/backend/.velocity-maintenance`, 'maintenance guard', 0o600);
  put(`${s.web}/backend/LICENSE.md`, 'license');
  put(`${s.web}/README.md`, 'readme');
}

function takeBackup(s, logical = BACKUP) {
  const directory = s.root + logical;
  fs.mkdirSync(directory);
  fs.chmodSync(directory, 0o700);
  const snapshot = snapshotApplication(s.web, directory);
  put(`${directory}/backup.json`, JSON.stringify({ revision: null, ...snapshot, configuration: [], ownership: [], contract: {}, retainedHistory: [], sourceAbsentHistory: [], snapshotId: 'fixture' }), 0o600);
  return directory;
}

// The candidate install (every artifact path removed and copied, as installBundle does) and the
// migration (the database changes and leaves a write-ahead log).
function install(s, { hooks = true, deps = 'old', modules = 40 } = {}) {
  const staged = fs.mkdtempSync(`${s.root}/staged-`);
  release(staged, { variant: 'new', hooks, deps, modules });
  for (const name of artifactPaths) {
    fs.rmSync(`${s.web}/${name}`, { recursive: true, force: true });
    if (fs.existsSync(`${staged}/${name}`)) fs.cpSync(`${staged}/${name}`, `${s.web}/${name}`, { recursive: true, verbatimSymlinks: true });
  }
  fs.rmSync(staged, { recursive: true, force: true });
  put(`${s.web}/backend/pb_data/data.db`, 'migrated database');
  put(`${s.web}/backend/pb_data/data.db-wal`, 'write-ahead log left by the migration');
}

function record(s, backup, status = 'failed') {
  put(`${s.root}${STATE}/deployment.json`, JSON.stringify({ status, revision: 'a'.repeat(40), backup, servicesMayBeStopped: true, maintenance: null, reason: 'injected', runNumber: 105, failedAt: '2026-10-07T05:38:19Z' }) + '\n', 0o600);
}

function failedRun(t, { hooksInBackup = true, hooksInCandidate = true, deps = 'old', candidateDeps = deps, modules = 40 } = {}) {
  const s = sandbox(t);
  site(s, { hooks: hooksInBackup, deps, modules });
  s.backup = takeBackup(s);
  install(s, { hooks: hooksInCandidate, deps: candidateDeps, modules });
  record(s, BACKUP);
  return s;
}

function editJSON(file, change) {
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  change(value);
  fs.writeFileSync(file, JSON.stringify(value));
}
const editManifest = (s, change) => editJSON(`${s.backup}/backup.json`, change);
const editConfig = (s, fields) => editJSON(`${s.root}/etc/hololive-deployment.json`, value => Object.assign(value, fields));

function run(argv, options = {}) {
  const started = process.hrtime.bigint();
  const result = spawnSync('python3', ['-I', tool, ...argv], { encoding: 'utf8', timeout: 120000, ...options });
  const lines = result.stdout.split('\n').filter(Boolean);
  assert.equal(lines.length, 1, 'exactly one JSON line expected: ' + result.stdout + result.stderr);
  assert.equal(result.stderr, '', 'no diagnostics or tracebacks on stderr');
  return { status: result.status, raw: result.stdout, out: JSON.parse(lines[0]), ms: Number(process.hrtime.bigint() - started) / 1e6 };
}
const restore = (s, mode, backup = BACKUP) => run([mode, backup, '--root', s.root]);

// Python runs the unchanged tool after replacing shutil.copy2, the copy every restore write goes
// through: after `limit` copies it either fails like a full disk or writes a partial file and
// kills itself with SIGKILL. The tool has no fault-injection hook of its own.
const interrupter = `import os, runpy, shutil, signal, sys
limit, how, tool = int(sys.argv[1]), sys.argv[2], sys.argv[3]
original, calls = shutil.copy2, [0]
def copy2(source, target, **options):
    calls[0] += 1
    if calls[0] > limit:
        if how == 'kill':
            with open(target, 'wb') as partial:
                partial.write(b'partial')
            os.kill(os.getpid(), signal.SIGKILL)
        raise OSError(28, 'No space left on device (injected)')
    return original(source, target, **options)
shutil.copy2 = copy2
sys.argv = [tool] + sys.argv[4:]
runpy.run_path(tool, run_name='__main__')
`;
function interrupted(s, limit, how) {
  return spawnSync('python3', ['-I', '-c', interrupter, String(limit), how, tool, 'apply', BACKUP, '--root', s.root], { encoding: 'utf8', timeout: 120000 });
}

// Every path, type, mode, inode, modification and change time, and the bytes of every file. The change
// time (INC-007) cannot be set by a copy, so a re-created entry differs even where ext4 reuses its inode number.
function state(directory) {
  const out = {};
  const walk = relative => {
    const file = relative ? `${directory}/${relative}` : directory, info = fs.lstatSync(file);
    if (info.isSymbolicLink()) out[relative] = ['link', fs.readlinkSync(file), info.ino, info.ctimeMs];
    else if (info.isDirectory()) {
      out[relative] = ['directory', info.mode & 0o7777, info.ino, info.mtimeMs, info.ctimeMs];
      for (const name of fs.readdirSync(file).sort()) walk(relative ? `${relative}/${name}` : name);
    } else if (info.isFile()) {
      let digest;
      try { digest = sha(fs.readFileSync(file)); } catch { digest = 'unreadable'; }
      out[relative] = ['file', info.mode & 0o7777, info.ino, info.mtimeMs, info.ctimeMs, info.size, digest];
    } else out[relative] = ['special', info.mode, info.ino, info.ctimeMs];
  };
  walk('');
  return out;
}
const hostState = s => ({ var: state(`${s.root}/var`), etc: state(`${s.root}/etc`) });
const outsideWebRoot = s => ({ backups: state(s.root + BACKUPS), state: state(s.root + STATE), etc: state(`${s.root}/etc`) });

function manifestOf(s) { return JSON.parse(fs.readFileSync(`${s.backup}/backup.json`, 'utf8')); }
function assertRestored(s) {
  const manifest = manifestOf(s);
  const names = manifest.present.filter(name => name !== 'backend/pocketbase');
  assert.deepEqual(inventory(s.web, names), manifest.application.filter(entry => entry.path !== 'backend/pocketbase'));
  for (const name of manifest.missing) assert.equal(fs.existsSync(`${s.web}/${name}`), false, name + ' must be absent');
}
const neighbours = s => ['backend/pocketbase', 'backend/.velocity-maintenance', 'backend/LICENSE.md', 'README.md'].map(name => {
  const info = fs.lstatSync(`${s.web}/${name}`);
  return [name, info.ino, info.mode, info.mtimeMs, info.ctimeMs, sha(fs.readFileSync(`${s.web}/${name}`))];
});
const systemctlCalls = s => fs.readFileSync(`${s.root}/systemctl.log`, 'utf8').trim().split('\n');
const plan = (overrides = {}) => ({ dist: 'replace', 'backend/pb_migrations': 'replace', 'backend/pb_hooks': 'replace', 'backend/scripts': 'sync', 'package.json': 'keep', 'package-lock.json': 'keep', node_modules: 'keep', 'backend/pb_data': 'replace', ...overrides });
const allKeep = Object.fromEntries(KNOWN.filter(name => name !== 'backend/pocketbase').map(name => [name, 'keep']));

test('the known names are the deployment.mjs artifact paths plus the data and the binary', () => {
  const result = spawnSync('python3', ['-I', '-c', 'import json, runpy, sys; print(json.dumps(runpy.run_path(sys.argv[1])["KNOWN"]))', tool], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), KNOWN);
});

test('a failed run is restored completely, backend/scripts keeps its inode and a second apply changes nothing', t => {
  const s = failedRun(t);
  const scripts = fs.lstatSync(`${s.web}/backend/scripts`).ino, before = neighbours(s), host = hostState(s);
  // INC-007: the open handle pins the original directory: while it is open no other directory can get its
  // inode number (ext4 reuses freed numbers), so equal path and pinned identities prove it was kept. The
  // pin also makes the tool's own scriptsDirectoryKept comparison exact.
  const held = fs.openSync(`${s.web}/backend/scripts`, 'r');
  try {
    const check = restore(s, 'check');
    assert.equal(check.status, 0, check.raw);
    assert.equal(check.out.ok, true);
    assert.deepEqual(check.out.plan, plan());
    assert.equal(check.out.changed, false);
    assert.ok(check.out.differences.dist > 0 && check.out.differences.node_modules === 0);
    assert.deepEqual(hostState(s), host, 'check writes nothing');

    const outside = outsideWebRoot(s);
    const apply = restore(s, 'apply');
    assert.equal(apply.status, 0, apply.raw);
    assert.equal(apply.out.ok, true);
    assert.deepEqual(outsideWebRoot(s), outside, 'backup, deployment record and configuration are never written');
    assert.deepEqual(apply.out.completed, ['dist', 'backend/pb_migrations', 'backend/pb_hooks', 'backend/scripts', 'backend/pb_data']);
    assert.equal(apply.out.mismatchedCount, 0);
    assert.equal(apply.out.scriptsDirectoryKept, true);
    assert.equal(apply.out.changed, true);
    assertRestored(s);
    const pinned = fs.fstatSync(held), now = fs.lstatSync(`${s.web}/backend/scripts`);
    assert.equal(pinned.ino, scripts);
    assert.deepEqual([now.dev, now.ino], [pinned.dev, pinned.ino], 'synchronized in place');
    assert.equal(fs.existsSync(`${s.web}/backend/scripts/lib/candidate-only`), false);
    assert.equal(fs.readFileSync(`${s.web}/backend/scripts/lib/old-only.js`, 'utf8'), 'removed by the candidate');
    assert.equal(fs.readFileSync(`${s.web}/backend/pb_data/data.db`, 'utf8'), 'database before the deploy');
    assert.equal(fs.existsSync(`${s.web}/backend/pb_data/data.db-wal`), false, 'the migration log does not survive');
    assert.deepEqual(neighbours(s), before, 'binary, guard and other neighbours untouched');

    const settled = hostState(s);
    const again = restore(s, 'apply');
    assert.equal(again.status, 0, again.raw);
    assert.deepEqual(again.out.plan, allKeep);
    assert.deepEqual(again.out.completed, []);
    assert.equal(again.out.changed, false);
    assert.deepEqual(hostState(s), settled, 'an apply with nothing to do changes nothing');
    assert.ok(systemctlCalls(s).every(line => line === SHOW), 'the tool only reads the PocketBase state');
  } finally { fs.closeSync(held); }
});

test('a dependency change (package.json, package-lock.json, node_modules) is restored and converges', t => {
  const s = failedRun(t, { candidateDeps: 'new' });
  const check = restore(s, 'check');
  assert.equal(check.status, 0, check.raw);
  assert.deepEqual(check.out.plan, plan({ 'package.json': 'replace', 'package-lock.json': 'replace', node_modules: 'replace' }));
  const apply = restore(s, 'apply');
  assert.equal(apply.status, 0, apply.raw);
  assert.equal(apply.out.ok, true);
  assertRestored(s);
  assert.equal(fs.readFileSync(`${s.web}/package.json`, 'utf8'), JSON.stringify({ name: 'fixture', deps: 'old' }));
  assert.equal(fs.readlinkSync(`${s.web}/node_modules/.bin/cli`), '../pkg0/bin/cli.js');
  assert.deepEqual(restore(s, 'apply').out.plan, allKeep);
});

test('backend/pb_hooks is handled in both directions and when absent on both sides', async t => {
  await t.test('backup without pb_hooks, candidate installed it: removed', t => {
    const s = failedRun(t, { hooksInBackup: false, hooksInCandidate: true });
    assert.deepEqual(manifestOf(s).missing, ['backend/pb_hooks']);
    const apply = restore(s, 'apply');
    assert.equal(apply.status, 0, apply.raw);
    assert.equal(apply.out.plan['backend/pb_hooks'], 'remove');
    assert.equal(fs.existsSync(`${s.web}/backend/pb_hooks`), false);
    assertRestored(s);
  });
  await t.test('backup with pb_hooks, candidate removed it: restored', t => {
    const s = failedRun(t, { hooksInBackup: true, hooksInCandidate: false });
    assert.equal(fs.existsSync(`${s.web}/backend/pb_hooks`), false);
    const apply = restore(s, 'apply');
    assert.equal(apply.status, 0, apply.raw);
    assert.equal(apply.out.plan['backend/pb_hooks'], 'replace');
    assert.equal(fs.readFileSync(`${s.web}/backend/pb_hooks/admin-auth.pb.js`, 'utf8'), 'old hook');
    assertRestored(s);
  });
  await t.test('absent in the backup and on the live tree: untouched', t => {
    const s = failedRun(t, { hooksInBackup: false, hooksInCandidate: false });
    const apply = restore(s, 'apply');
    assert.equal(apply.status, 0, apply.raw);
    assert.equal(apply.out.plan['backend/pb_hooks'], 'keep');
    assert.equal(fs.existsSync(`${s.web}/backend/pb_hooks`), false);
    assertRestored(s);
  });
});

test('an apply that fails part-way converges on the next run and a third run is a no-op', t => {
  const s = failedRun(t, { candidateDeps: 'new' });
  // 12 copies restore dist (4), the migrations (1), the hooks (1), the scripts (4) and both
  // package files (2); the 13th copy, inside node_modules, fails like a full disk.
  const failed = interrupted(s, 12, 'fail');
  assert.equal(failed.status, 1, failed.stdout + failed.stderr);
  assert.equal(failed.stderr, '');
  const out = JSON.parse(failed.stdout);
  assert.equal(out.ok, false);
  assert.equal(out.changed, true);
  assert.equal(out.failedAt, 'node_modules');
  assert.deepEqual(out.completed, ['dist', 'backend/pb_migrations', 'backend/pb_hooks', 'backend/scripts', 'package.json', 'package-lock.json']);
  assert.match(out.reason, /run apply again/);
  assert.equal(fs.readFileSync(`${s.web}/backend/pb_data/data.db`, 'utf8'), 'migrated database', 'the data was not reached');

  const second = restore(s, 'apply');
  assert.equal(second.status, 0, second.raw);
  assert.deepEqual(second.out.plan, plan({ dist: 'keep', 'backend/pb_migrations': 'keep', 'backend/pb_hooks': 'keep', 'backend/scripts': 'keep', node_modules: 'replace' }));
  assertRestored(s);
  const third = restore(s, 'apply');
  assert.equal(third.status, 0, third.raw);
  assert.deepEqual(third.out.plan, allKeep);
});

test('an apply killed with SIGKILL mid-copy converges on the next run and a third run is a no-op', t => {
  const s = failedRun(t, { candidateDeps: 'new' });
  const killed = interrupted(s, 14, 'kill');
  assert.equal(killed.signal, 'SIGKILL');
  assert.equal(killed.stdout, '');
  assert.ok(fs.readdirSync(`${s.web}/node_modules`).length > 0, 'node_modules is half copied');
  assert.equal(fs.readFileSync(`${s.web}/backend/pb_data/data.db`, 'utf8'), 'migrated database');

  const second = restore(s, 'apply');
  assert.equal(second.status, 0, second.raw);
  assert.equal(second.out.plan.node_modules, 'replace');
  assert.equal(second.out.plan.dist, 'keep');
  assertRestored(s);
  const third = restore(s, 'apply');
  assert.equal(third.status, 0, third.raw);
  assert.deepEqual(third.out.plan, allKeep);
});

test('a run killed inside the in-place scripts synchronization converges and keeps the directory inode', t => {
  const s = failedRun(t);
  // INC-007: pinned across the killed run and the second apply, as in the test above.
  const scripts = fs.lstatSync(`${s.web}/backend/scripts`).ino, held = fs.openSync(`${s.web}/backend/scripts`, 'r');
  try {
    // dist (4), migrations (1), hooks (1), then the second scripts file is cut off.
    const killed = interrupted(s, 7, 'kill');
    assert.equal(killed.signal, 'SIGKILL');
    const second = restore(s, 'apply');
    assert.equal(second.status, 0, second.raw);
    assert.equal(second.out.plan['backend/scripts'], 'sync');
    assert.equal(second.out.scriptsDirectoryKept, true);
    const pinned = fs.fstatSync(held), now = fs.lstatSync(`${s.web}/backend/scripts`);
    assert.equal(pinned.ino, scripts);
    assert.deepEqual([now.dev, now.ino], [pinned.dev, pinned.ino], 'synchronized in place');
    assertRestored(s);
    assert.deepEqual(restore(s, 'apply').out.plan, allKeep);
  } finally { fs.closeSync(held); }
});

test('preflight succeeds while PocketBase runs; check and apply refuse without changing anything', t => {
  const s = failedRun(t);
  put(`${s.root}/pocketbase.state`, RUNNING);
  const host = hostState(s);
  const preflight = restore(s, 'preflight');
  assert.equal(preflight.status, 0, preflight.raw);
  assert.equal(preflight.out.ok, true);
  assert.equal(preflight.out.pocketbaseRunning, true);
  assert.equal(preflight.out.plan, undefined, 'preflight does not compare live contents');
  for (const mode of WRITERS) {
    const refused = restore(s, mode);
    assert.equal(refused.status, 1);
    assert.match(refused.out.reason, /PocketBase is running/);
    assert.equal(refused.out.changed, false);
  }
  assert.deepEqual(hostState(s), host);
});

test('before a deploy, preflight proves the newest existing backup without reading live data', t => {
  const s = sandbox(t);
  site(s, {});
  s.backup = takeBackup(s, BACKUPS + '/run-103-fJUDXz');
  takeBackup(s, BACKUP);
  record(s, BACKUP, 'deployed');
  put(`${s.root}/pocketbase.state`, RUNNING);
  put(`${s.web}/backend/pb_data/data.db-shm`, 'shared memory of a running database', 0o000);
  const host = hostState(s);
  const newest = restore(s, 'preflight');
  assert.equal(newest.status, 0, newest.raw);
  assert.equal(newest.out.ok, true);
  assert.equal(newest.out.run, 105);
  assert.equal(newest.out.newestRun, 105);
  assert.deepEqual(newest.out.record, { status: 'deployed', backup: BACKUP });
  assert.equal(newest.out.space.neededBytes > 0, true);
  const older = restore(s, 'preflight', BACKUPS + '/run-103-fJUDXz');
  assert.equal(older.status, 0, older.raw);
  assert.equal(older.out.run, 103);
  for (const mode of WRITERS) assert.match(restore(s, mode).out.reason, /No failed deployment record/);
  assert.deepEqual(hostState(s), host);
});

const refusals = [
  ['a deployment lock is present', s => put(`${s.root}${STATE}/deployment.lock`, '{}', 0o600), /deployment lock is present/, ALL],
  ['PocketBase is still stopping', s => put(`${s.root}/pocketbase.state`, 'LoadState=loaded\nActiveState=deactivating\nMainPID=0\n'), /PocketBase is running/, WRITERS],
  ['the PocketBase unit is not loaded', s => put(`${s.root}/pocketbase.state`, 'LoadState=not-found\nActiveState=inactive\nMainPID=0\n'), /not loaded/, ALL],
  ['the PocketBase state cannot be read', s => put(`${s.root}/pocketbase.state`, 'ActiveState=inactive\n'), /service state/, ALL],
  ['no failure is recorded', s => fs.rmSync(`${s.root}${STATE}/deployment.json`), /No failed deployment record/, WRITERS],
  ['the last run succeeded', s => record(s, BACKUP, 'deployed'), /No failed deployment record/, WRITERS],
  ['the deployment record is unreadable', s => put(`${s.root}${STATE}/deployment.json`, '{"status":"fai', 0o600), /Deployment record is not valid JSON/, ALL],
  ['the failed record names no backup', s => record(s, null), /names no backup/, ALL],
  ['the backup is another run\'s backup', s => fs.cpSync(s.backup, `${s.root}${BACKUPS}/run-103-fJUDXz`, { recursive: true, verbatimSymlinks: true }), /failed run's own backup/, ALL, BACKUPS + '/run-103-fJUDXz'],
  ['the backup path is an alias', s => { fs.symlinkSync('run-105-nlAIir', `${s.root}${BACKUPS}/run-106-aliasX`); record(s, BACKUPS + '/run-106-aliasX'); }, /Aliased backup path/, ALL, BACKUPS + '/run-106-aliasX'],
  ['the recorded backup no longer exists', s => fs.rmSync(s.backup, { recursive: true, force: true }), /Backup does not exist/, ALL],
  ['the backup lies outside the backup root', s => record(s, '/var/tmp/run-105-nlAIir'), /directly under the configured backup root/, ALL, '/var/tmp/run-105-nlAIir'],
  ['the backup path is not canonical', s => record(s, BACKUPS + '/./run-105-nlAIir'), /directly under the configured backup root/, ALL, BACKUPS + '/./run-105-nlAIir'],
  ['the web root is an alias', s => { fs.mkdirSync(`${s.root}/srv`); fs.symlinkSync(s.web, `${s.root}/srv/site`); editConfig(s, { webRoot: '/srv/site' }); }, /webRoot is missing or aliased/, ALL],
  ['a live artifact is an alias', s => { fs.renameSync(`${s.web}/dist`, `${s.web}/dist-real`); fs.symlinkSync('dist-real', `${s.web}/dist`); }, /Aliased live artifact path/, ALL],
  ['the live backend directory is an alias', s => { fs.renameSync(`${s.web}/backend`, `${s.web}/backend-real`); fs.symlinkSync('backend-real', `${s.web}/backend`); }, /artifact parent is missing or aliased/, ALL],
  ['the backup bytes were tampered with', s => fs.appendFileSync(`${s.backup}/application/dist/index.html`, ' tampered'), /differs from its manifest/, ALL],
  ['a backup file was removed', s => fs.rmSync(`${s.backup}/application/backend/pb_data/auxiliary.db`), /differs from its manifest/, ALL],
  ['the manifest names an unknown artifact', s => editManifest(s, m => m.present.push('backend/extra')), /unknown artifact/, ALL],
  ['the manifest lacks the binary entry', s => editManifest(s, m => { m.application = m.application.filter(entry => entry.path !== 'backend/pocketbase'); }), /binary entry/, ALL],
  ['the manifest lists the binary as missing', s => editManifest(s, m => { m.present = m.present.filter(name => name !== 'backend/pocketbase'); m.missing.push('backend/pocketbase'); }), /database or the PocketBase binary/, ALL],
  ['the manifest does not cover the known names', s => editManifest(s, m => { m.present = m.present.filter(name => name !== 'dist'); m.application = m.application.filter(entry => entry.path !== 'dist' && !entry.path.startsWith('dist/')); }), /do not cover/, ALL],
  ['the manifest lists a name as present and missing', s => editManifest(s, m => m.missing.push('dist')), /both present and missing/, ALL],
  ['a manifest entry lies outside the present names', s => editManifest(s, m => m.application.push({ path: 'src/main.jsx', sha256: '0'.repeat(64), mode: 0o644 })), /outside the present names/, ALL],
  ['the backup holds a name its manifest lists as missing', s => editManifest(s, m => { m.present = m.present.filter(name => name !== 'backend/pb_hooks'); m.missing.push('backend/pb_hooks'); m.application = m.application.filter(entry => !entry.path.startsWith('backend/pb_hooks')); }), /lists as missing/, ALL],
  ['the backup holds an external link', s => { fs.symlinkSync('../../../../../etc', `${s.backup}/application/node_modules/escape`); editManifest(s, m => m.application.push({ path: 'node_modules/escape', link: '../../../../../etc' })); }, /External symlink/, ALL],
  ['the backup holds a FIFO', s => { assert.equal(spawnSync('mkfifo', [`${s.backup}/application/dist/pipe`]).status, 0); editManifest(s, m => m.application.push({ path: 'dist/pipe', sha256: '0'.repeat(64), mode: 0o644 })); }, /Special file in the backup/, ALL],
  ['the live binary differs from the backup', s => fs.appendFileSync(`${s.web}/backend/pocketbase`, ' replaced'), /binary differs/, ALL],
  ['a live entry cannot be removed by the runner', s => fs.chmodSync(`${s.web}/dist/assets`, 0o555), /not removable/, ALL],
  ['an environment file lies inside a restored artifact', s => put(`${s.web}/backend/scripts/.env`, 'FIXTURE_SECRET=do-not-print', 0o600), /environment file/, ALL],
  ['configuration lies inside a restored artifact', s => editConfig(s, { configurationFiles: [WEB + '/backend/scripts/.env'] }), /configuration overlaps/, ALL],
  ['the configured runner is root', s => editConfig(s, { runnerUser: 'root' }), /runner user/, ALL],
  ['the configured runner is another user', s => editConfig(s, { runnerUser: 'nobody' }), /runner user/, ALL],
  ['the machine id differs', s => put(`${s.root}/etc/machine-id`, 'another machine\n'), /machine id/, ALL],
  ['the configuration is group writable', s => fs.chmodSync(`${s.root}/etc/hololive-deployment.json`, 0o660), /not group\/world writable/, ALL],
  ['the configured roots overlap', s => editConfig(s, { backupRoot: WEB + '/backups' }), /Overlapping/, ALL],
];
test('every refusal happens before any change and leaves the host tree byte-for-byte unchanged', async t => {
  for (const [name, prepare, reason, modes, backup = BACKUP] of refusals) await t.test(name, t => {
    const s = failedRun(t);
    prepare(s);
    const host = hostState(s);
    for (const mode of modes) {
      const refused = restore(s, mode, backup);
      assert.equal(refused.status, 1, mode + ': ' + refused.raw);
      assert.equal(refused.out.ok, false);
      assert.match(refused.out.reason, reason, mode);
      assert.equal(refused.out.changed, false);
      assert.equal(refused.out.mode, mode);
      assert.doesNotMatch(refused.raw, /do-not-print|database before|migrated database/, 'file contents are never printed');
    }
    assert.deepEqual(hostState(s), host);
  });
});

test('refusals list every unremovable entry before the first deletion', t => {
  const s = failedRun(t);
  fs.chmodSync(`${s.web}/dist/assets`, 0o555);
  fs.chmodSync(`${s.web}/backend/pb_data/storage/collection`, 0o555);
  const refused = restore(s, 'apply');
  assert.equal(refused.status, 1);
  assert.deepEqual(refused.out.blocked, ['backend/pb_data/storage/collection/record', 'dist/assets/app-new.js', 'dist/assets/empty.txt']);
  assert.equal(refused.out.blockedCount, 3);
  assert.equal(fs.readFileSync(`${s.web}/dist/index.html`, 'utf8'), 'new index', 'nothing was deleted');
});

test('exit codes and the one-line JSON shape', t => {
  const s = failedRun(t);
  const ok = restore(s, 'check');
  assert.equal(ok.status, 0);
  assert.deepEqual(Object.keys(ok.out), ['ok', 'mode', 'backup', 'sandbox', 'record', 'lockPresent', 'pocketbase', 'present', 'missing', 'expectedEntries', 'run', 'newestRun', 'plan', 'differences', 'blocked', 'blockedCount', 'space', 'changed']);
  assert.equal(ok.out.sandbox, s.root);
  assert.deepEqual(ok.out.record, { status: 'failed', backup: BACKUP });
  assert.deepEqual(ok.out.pocketbase, { LoadState: 'loaded', ActiveState: 'inactive', MainPID: '0' });
  assert.deepEqual(ok.out.present, KNOWN);
  assert.deepEqual(ok.out.missing, []);
  assert.equal(ok.out.expectedEntries, manifestOf(s).application.length - 1);
  assert.deepEqual(Object.keys(ok.out.space), ['freeBytes', 'neededBytes', 'marginBytes', 'freeInodes', 'neededInodes']);
  const preflight = restore(s, 'preflight');
  assert.equal(preflight.status, 0);
  assert.deepEqual(Object.keys(preflight.out), ['ok', 'mode', 'backup', 'sandbox', 'record', 'lockPresent', 'pocketbase', 'present', 'missing', 'expectedEntries', 'run', 'newestRun', 'pocketbaseRunning', 'blocked', 'blockedCount', 'space', 'changed']);
  const applied = restore(s, 'apply');
  assert.equal(applied.status, 0);
  for (const key of ['plan', 'completed', 'restoredEntries', 'mismatched', 'mismatchedCount', 'scriptsDirectoryKept', 'pocketbaseAfter', 'changed']) assert.ok(key in applied.out, key);
  put(`${s.root}${STATE}/deployment.lock`, '{}', 0o600);
  const refused = restore(s, 'apply');
  assert.equal(refused.status, 1);
  assert.deepEqual(Object.keys(refused.out), ['ok', 'mode', 'backup', 'sandbox', 'reason', 'changed']);
  for (const argv of [[], ['check'], ['restore', BACKUP], ['check', BACKUP, '--root'], ['check', BACKUP, '--rooot', s.root], ['check', BACKUP, '--root', s.root, 'extra']]) {
    const usage = run(argv);
    assert.equal(usage.status, 2, JSON.stringify(argv));
    assert.equal(usage.out.ok, false);
    assert.match(usage.out.reason, /^usage: /);
  }
});

test('the sandbox override is explicit, refuses unsafe roots and cannot be enabled by the environment', async t => {
  const s = failedRun(t);
  const host = hostState(s);
  fs.symlinkSync(s.root, `${s.root}-alias`);
  t.after(() => fs.rmSync(`${s.root}-alias`, { force: true }));
  for (const [root, reason] of [
    ['/', /absolute canonical path other than \//], ['relative/sandbox', /absolute canonical/], [s.root + '/', /absolute canonical/],
    [s.root + '/../' + path.basename(s.root), /absolute canonical/], [`${s.root}-alias`, /without symlinks/], [`${s.root}/missing`, /without symlinks/],
    ['/etc', /production path|without symlinks/], ['/usr/bin', /production path/],
  ]) {
    const refused = run(['check', BACKUP, '--root', root]);
    assert.equal(refused.status, 1, root);
    assert.match(refused.out.reason, reason, root);
    assert.equal(refused.out.sandbox, root);
  }
  // A host environment cannot redirect the tool: without --root it always uses the production
  // paths, which do not exist on a development machine.
  if (fs.existsSync('/etc/hololive-deployment.json')) t.diagnostic('production configuration present: environment check skipped');
  else {
    const environment = { ...process.env, ROOT: s.root, SANDBOX: s.root, RESTORE_ROOT: s.root, HOLOLIVE_RESTORE_ROOT: s.root, FIX_W: s.web, PYTHONPATH: s.root, PYTHONSTARTUP: s.root + '/etc/machine-id' };
    for (const mode of ALL) {
      const production = run([mode, BACKUP], { env: environment });
      assert.equal(production.status, 1);
      assert.equal(production.out.sandbox, null);
      assert.match(production.out.reason, /Missing deployment configuration/);
    }
  }
  assert.deepEqual(hostState(s), host);
});

test('about ten thousand entries are checked and restored within a few seconds', t => {
  const s = failedRun(t, { candidateDeps: 'new', modules: 10000 });
  const check = restore(s, 'check');
  assert.equal(check.status, 0, check.raw);
  assert.ok(check.out.expectedEntries > 10000, String(check.out.expectedEntries));
  const apply = restore(s, 'apply');
  assert.equal(apply.status, 0, apply.raw);
  assertRestored(s);
  const again = restore(s, 'apply');
  assert.deepEqual(again.out.plan, allKeep);
  t.diagnostic(`entries ${check.out.expectedEntries}: check ${Math.round(check.ms)} ms, apply ${Math.round(apply.ms)} ms, idle apply ${Math.round(again.ms)} ms`);
  for (const result of [check, apply, again]) assert.ok(result.ms < 15000, `${Math.round(result.ms)} ms`);
});
