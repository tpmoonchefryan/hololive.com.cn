import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { createHash } from 'node:crypto';
import { artifactPaths, inventory, verifyBundle, validatePlan, deploy, installBundle, snapshotApplication, restoreBackup, verifyImmutableMigrations, productionAdapter } from '../scripts/deployment.mjs';
const revision = 'a'.repeat(40), oldRevision = 'b'.repeat(40);
const config = {
  approvedRevision: revision, previousRevision: oldRevision,
  webRoot: '/fixture/site', backupRoot: '/fixture/backup', stateRoot: '/fixture/state', velocityRoot: '/fixture/velocity',
  pocketbaseVersion: '0.26.5', machineIdSha256: 'c'.repeat(64), runnerUser: 'fixture',
  websiteServices: ['pocketbase', 'velocity-sync', 'map-proxy'],
  serviceBindings: { pocketbase: 'WorkingDirectory=/fixture/site/backend', 'velocity-sync': 'WorkingDirectory=/fixture/site/backend/scripts', 'map-proxy': 'WorkingDirectory=/fixture/site/backend/scripts' },
  velocityServiceBinding: 'Requires=fixture\nBindsTo=\nPartOf=',
  nginxSiteFile: '/etc/nginx/sites-available/fixture', configurationFiles: ['/etc/systemd/system/pocketbase.service', '/etc/systemd/system/velocity-sync.service', '/etc/systemd/system/map-proxy.service', '/etc/nginx/sites-available/fixture'],
  protectedVelocityFiles: ['velocity.toml', 'velocity.jar', 'forwarding.secret'], velocityPorts: [25565],
  pocketbaseHealthUrl: 'http://127.0.0.1:8090/api/health', baselineReviewed: true, serviceIdentityReviewed: true, restoreRehearsalRequired: true,
};
function fixture(fail) {
  const calls = [], step = name => async (...args) => {
    calls.push([name, ...args]); if (name === fail) throw new Error('injected ' + name);
    if (name === 'backup') return '/fixture/private-backup';
    if (name === 'velocity') return 'unchanged-marker';
  };
  const adapter = Object.fromEntries(['verify', 'lock', 'assertCurrent', 'velocity', 'guard', 'backup', 'rehearse', 'baseline', 'install', 'migrate', 'health', 'assertVelocity', 'record', 'failure', 'unlock'].map(name => [name, step(name)]));
  adapter.stop = async unit => { calls.push(['stop', unit]); if (fail === 'stop-' + unit) throw new Error('injected stop'); };
  adapter.start = async unit => { calls.push(['start', unit]); if (fail === 'start-' + unit) throw new Error('injected start'); };
  return { adapter, calls };
}
test('exact approval, host/paths/PB/services/config bindings are mandatory', () => {
  assert.equal(validatePlan(config, revision, 1).revision, revision);
  for (const change of [
    { approvedRevision: oldRevision }, { webRoot: '/' }, { backupRoot: '/fixture/site/backups' },
    { stateRoot: '/fixture/velocity/state' }, { websiteServices: ['pocketbase', 'velocity-sync', 'velocity'] },
    { pocketbaseVersion: '0.99.0' }, { machineIdSha256: null }, { serviceBindings: {} },
    { baselineReviewed: false }, { serviceIdentityReviewed: false }, { protectedVelocityFiles: ['../secret'] },
    { configurationFiles: ['/etc/ssh/private-key'] }, { configurationFiles: ['/etc/systemd/system/pocketbase.service'] }, { velocityServiceBinding: null }, { velocityPorts: [] }, { previousRevision: undefined },
  ]) assert.throws(() => validatePlan({ ...config, ...change }, revision, 1));
  assert.throws(() => validatePlan(config, revision, 0));
});
test('old sync is stopped before guard/PB, consistent backup and rehearsal before writes', async () => {
  const f = fixture(); assert.equal((await deploy(f.adapter, config, revision, 12)).status, 'deployed');
  const names = f.calls.map(call => call.join(':'));
  assert.ok(names.indexOf('stop:velocity-sync') < names.indexOf('guard'));
  assert.ok(names.indexOf('stop:pocketbase') < names.indexOf('backup'));
  assert.ok(names.indexOf('rehearse:/fixture/private-backup') < names.indexOf('install'));
  assert.ok(names.indexOf('baseline:/fixture/private-backup') < names.indexOf('install'));
  assert.ok(names.indexOf('migrate') < names.indexOf('start:pocketbase'));
  assert.ok(names.indexOf('assertVelocity:unchanged-marker') < names.findIndex(n => n.startsWith('record:')));
  assert.ok(f.calls.every(call => !(['stop', 'start'].includes(call[0]) && call[1] === 'velocity')));
  assert.equal(f.calls.at(-1)[0], 'unlock');
});
for (const stage of ['verify', 'lock', 'assertCurrent', 'velocity', 'stop-velocity-sync', 'guard', 'stop-pocketbase', 'backup', 'rehearse', 'baseline', 'install', 'migrate', 'start-pocketbase', 'health', 'start-velocity-sync', 'assertVelocity', 'record']) test(`${stage} failure stops subsequent writes and cannot record success`, async () => {
  const f = fixture(stage); await assert.rejects(deploy(f.adapter, config, revision, 13), /injected/);
  if (stage !== 'record') assert.equal(f.calls.some(call => call[0] === 'record'), false);
  if (['verify', 'lock', 'assertCurrent', 'velocity', 'stop-velocity-sync'].includes(stage)) assert.equal(f.calls.some(call => call[0] === 'failure'), false, 'early/stale failures cannot poison newer state');
  if (!['verify', 'lock'].includes(stage)) assert.equal(f.calls.at(-1)[0], 'unlock');
  assert.ok(f.calls.every(call => !(['stop', 'start'].includes(call[0]) && call[1] === 'velocity')));
});
function temp(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hololive-deployment-')));
  // Leave isolated evidence until the approved task cleanup boundary.
  t.diagnostic('isolated fixture: ' + root);
  return root;
}
function createBundle(root) {
  for (const name of artifactPaths) {
    if (name.endsWith('.json')) fs.writeFileSync(path.join(root, name), '{}');
    else fs.mkdirSync(path.join(root, name), { recursive: true });
  }
  fs.writeFileSync(path.join(root, 'dist/index.html'), 'candidate frontend');
  fs.writeFileSync(path.join(root, 'backend/pb_migrations/123_schema.js'), 'candidate migration');
  fs.writeFileSync(path.join(root, 'backend/pb_hooks/auth.pb.js'), 'candidate authorization');
  fs.writeFileSync(path.join(root, 'backend/scripts/sync_velocity.js'), 'candidate protected daemon');
  fs.chmodSync(path.join(root, 'backend/pb_hooks/auth.pb.js'), 0o660);
  const packages = {};
  for (const name of ['@iarna/toml', 'pocketbase', 'eventsource']) {
    const directory = path.join(root, 'node_modules', name); fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ version: '1.2.3' })); packages['node_modules/' + name] = { version: '1.2.3' };
  }
  fs.writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify({ packages }));
  fs.symlinkSync('pocketbase', path.join(root, 'node_modules/pb-link'));
  fs.writeFileSync(path.join(root, 'release.json'), JSON.stringify({ revision, paths: artifactPaths, files: inventory(root) }));
}
test('actual manifest/install/consistent snapshot and isolated restore protect data, media, env and unrelated files', t => {
  const root = temp(t), bundle = path.join(root, 'bundle'), live = path.join(root, 'live'), backup = path.join(root, 'backup');
  fs.mkdirSync(bundle); fs.mkdirSync(live); fs.mkdirSync(backup); createBundle(bundle);
  fs.mkdirSync(path.join(live, 'backend/pb_data/storage'), { recursive: true });
  const retained = { 'backend/pb_data/data.db': 'fixture database', 'backend/pb_data/data.db-wal': 'matching wal', 'backend/pb_data/storage/media.bin': 'matching media', 'backend/.env': 'private environment fixture', '.env': 'site environment fixture', 'unrelated.txt': 'keep' };
  for (const [name, bytes] of Object.entries(retained)) fs.writeFileSync(path.join(live, name), bytes);
  fs.mkdirSync(path.join(live, 'dist')); fs.writeFileSync(path.join(live, 'dist/old.js'), 'old asset');
  const snapshot = snapshotApplication(live, backup); fs.writeFileSync(path.join(backup, 'backup.json'), JSON.stringify({ revision: oldRevision, ...snapshot }));
  installBundle(bundle, live, revision);
  for (const [name, bytes] of Object.entries(retained)) assert.equal(fs.readFileSync(path.join(live, name), 'utf8'), bytes);
  assert.equal(fs.existsSync(path.join(live, 'dist/old.js')), false);
  assert.equal(fs.readlinkSync(path.join(live, 'node_modules/pb-link')), 'pocketbase');
  assert.equal(verifyBundle(bundle, revision).files.length, inventory(live).length);
  const restored = path.join(root, 'restored'); assert.equal(restoreBackup(backup, restored).revision, oldRevision);
  assert.equal(fs.readFileSync(path.join(restored, 'backend/pb_data/storage/media.bin'), 'utf8'), 'matching media');
  assert.equal(fs.readFileSync(path.join(restored, 'dist/old.js'), 'utf8'), 'old asset');
  assert.throws(() => restoreBackup(backup, live), /must be new/);
  fs.writeFileSync(path.join(backup, 'application/backend/pb_data/data.db'), 'corruption');
  assert.throws(() => restoreBackup(backup, path.join(root, 'corrupted')), /Corrupt/);
});
test('missing hooks/dependencies, tampering, external symlinks and destination aliases refuse before application writes', t => {
  const root = temp(t); createBundle(root); verifyBundle(root, revision);
  fs.writeFileSync(path.join(root, 'backend/pb_hooks/auth.pb.js'), 'tamper');
  assert.throws(() => verifyBundle(root, revision), /content mismatch/);
  assert.throws(() => verifyBundle(root, oldRevision), /Revision mismatch/);
  fs.symlinkSync('/etc', path.join(root, 'dist/external'));
  assert.throws(() => inventory(root), /External/);
  const alias = path.join(temp(t), 'alias'); fs.symlinkSync(root, alias);
  assert.throws(() => installBundle(root, alias, revision));
});

test('unknown/mutated production migration bytes refuse before touching any artifact', t => {
  const root = temp(t), bundle = path.join(root, 'bundle'), live = path.join(root, 'live');
  fs.mkdirSync(bundle); fs.mkdirSync(live); createBundle(bundle);
  fs.mkdirSync(path.join(live, 'dist')); fs.writeFileSync(path.join(live, 'dist/index.html'), 'old frontend');
  fs.mkdirSync(path.join(live, 'backend/pb_migrations'), { recursive: true });
  const file = path.join(live, 'backend/pb_migrations/unknown_history.js'); fs.writeFileSync(file, 'unknown historical bytes');
  assert.throws(() => verifyImmutableMigrations(bundle, live), /Unknown or modified/);
  assert.throws(() => installBundle(bundle, live, revision), /Unknown or modified/);
  assert.equal(fs.readFileSync(file, 'utf8'), 'unknown historical bytes');
  assert.equal(fs.readFileSync(path.join(live, 'dist/index.html'), 'utf8'), 'old frontend');
  fs.renameSync(file, path.join(live, 'backend/pb_migrations/123_schema.js'));
  assert.throws(() => installBundle(bundle, live, revision), /Unknown or modified/);
  fs.writeFileSync(path.join(live, 'backend/pb_migrations/123_schema.js'), 'candidate migration');
  installBundle(bundle, live, revision); assert.equal(fs.readFileSync(path.join(live, 'dist/index.html'), 'utf8'), 'candidate frontend');
});

// Production-adapter boundary: commands/host facts are simulated, while every
// control endpoint, alias, artifact and protected file operation is real.
async function productionFixture(t, callback) {
  const root = temp(t), bundle = path.join(root, 'bundle'), webRoot = path.join(root, 'site');
  fs.mkdirSync(bundle); createBundle(bundle);
  for (const name of ['site/backend/pb_data', 'site/backend/scripts', 'state', 'backup', 'velocity']) fs.mkdirSync(path.join(root, name), { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(webRoot, 'backend/pb_data/data.db'), 'retained database');
  fs.writeFileSync(path.join(webRoot, 'backend/.env'), 'retained environment', { mode: 0o600 });
  const protectedFile = path.join(root, 'velocity/forwarding.secret'); fs.writeFileSync(protectedFile, 'protected fixture', { mode: 0o600 });
  const bound = { ...config, webRoot, backupRoot: path.join(root, 'backup'), stateRoot: path.join(root, 'state'), velocityRoot: path.join(root, 'velocity'), runnerUser: os.userInfo().username, machineIdSha256: createHash('sha256').update('fixture machine').digest('hex'), repository: 'fixture/deployment', serviceBindings: Object.fromEntries(config.websiteServices.map(unit => [unit, 'WorkingDirectory=' + webRoot + (unit === 'pocketbase' ? '/backend' : '/backend/scripts')])) };
  const configFile = path.join(root, 'config.json'); fs.writeFileSync(configFile, '{}', { mode: 0o600 });
  const commands = [], originalRead = fs.readFileSync, originalStat = fs.statSync, originalRealpath = fs.realpathSync, originalExec = cp.execFileSync;
  const environment = Object.fromEntries(['GITHUB_REPOSITORY', 'GITHUB_RUN_ID', 'GITHUB_EVENT_NAME'].map(key => [key, process.env[key]]));
  fs.readFileSync = (file, ...args) => file === '/etc/machine-id' ? Buffer.from('fixture machine') : originalRead(file, ...args);
  fs.statSync = (file, ...args) => { const value = originalStat(file, ...args); return file === configFile ? new Proxy(value, { get: (value, key) => key === 'uid' ? 0 : Reflect.get(value, key) }) : value; };
  fs.realpathSync = (file, ...args) => bound.configurationFiles.includes(file) ? file : originalRealpath(file, ...args);
  cp.execFileSync = (file, args) => {
    commands.push([file, ...args]);
    if (file === 'git' && args[0] === 'ls-remote') return revision + '\trefs/heads/main\n';
    if (file.endsWith('/backend/pocketbase') && args[0] === '--version') return 'pocketbase version 0.26.5\n';
    if (file === 'systemctl' && args[0] === 'is-active') return 'active\n';
    if (file === 'systemctl' && args[0] === 'show') return (args[1] === 'velocity' ? bound.velocityServiceBinding : bound.serviceBindings[args[1]]) + '\n';
    throw new Error('External command refused by isolated test');
  };
  Object.assign(process.env, { GITHUB_REPOSITORY: bound.repository, GITHUB_RUN_ID: '123', GITHUB_EVENT_NAME: 'workflow_dispatch' }); syncBuiltinESMExports();
  try { await callback({ root, bundle, webRoot, config: bound, protectedFile, commands, adapter: productionAdapter(bundle, bound, revision, 2, configFile), state: path.join(bound.stateRoot, 'deployment.json'), guard: path.join(webRoot, 'backend/.velocity-maintenance') }); }
  finally {
    fs.readFileSync = originalRead; fs.statSync = originalStat; fs.realpathSync = originalRealpath; cp.execFileSync = originalExec; syncBuiltinESMExports();
    for (const [key, value] of Object.entries(environment)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
}
for (const endpoint of ['guard', 'state']) for (const kind of ['direct', 'chain', 'dangling']) test(`production ${endpoint} ${kind} alias refuses preflight and actual operations`, async t => productionFixture(t, f => {
  const target = kind === 'dangling' ? path.join(f.root, 'velocity/missing') : f.protectedFile;
  if (kind === 'chain') { fs.symlinkSync(target, path.join(f.root, 'velocity/alias')); fs.symlinkSync(path.join(f.root, 'velocity/alias'), f[endpoint]); }
  else fs.symlinkSync(target, f[endpoint]);
  assert.throws(() => f.adapter.verify(), /control endpoint/);
  assert.equal(f.commands.length, 0);
  for (const operation of endpoint === 'guard' ? [() => f.adapter.guard()] : [() => f.adapter.assertCurrent(), () => f.adapter.record({ status: 'deployed' }), () => f.adapter.failure({ status: 'failed' })]) assert.throws(operation, /control endpoint/);
  assert.equal(fs.readFileSync(f.protectedFile, 'utf8'), 'protected fixture');
  assert.equal(fs.existsSync(path.join(f.root, 'velocity/missing')), false);
}));
for (const endpoint of ['guard', 'state']) test(`production ${endpoint} parent alias after preflight refuses writes`, async t => productionFixture(t, f => {
  f.adapter.verify();
  const parent = path.dirname(f[endpoint]), moved = parent + '-original'; fs.renameSync(parent, moved); fs.symlinkSync(f.config.velocityRoot, parent);
  const name = path.basename(f[endpoint]); fs.writeFileSync(path.join(f.config.velocityRoot, name), 'protected parent fixture', { mode: 0o600 });
  const operations = endpoint === 'guard' ? [() => f.adapter.guard()] : [() => f.adapter.record({ status: 'deployed' }), () => f.adapter.failure({ status: 'failed' }), () => f.adapter.assertCurrent()];
  for (const operation of operations) assert.throws(operation, /Symlink|parent binding/);
  assert.equal(fs.readFileSync(path.join(f.config.velocityRoot, name), 'utf8'), 'protected parent fixture');
}));
for (const operation of ['record', 'failure', 'guard']) test(`${operation} refuses a leaf alias introduced after verify`, async t => productionFixture(t, f => {
  f.adapter.verify(); const endpoint = operation === 'guard' ? f.guard : f.state;
  fs.symlinkSync(f.protectedFile, endpoint);
  assert.throws(() => f.adapter[operation]({ status: operation === 'record' ? 'deployed' : 'failed' }), /control endpoint/);
  assert.equal(fs.readFileSync(f.protectedFile, 'utf8'), 'protected fixture');
}));
test('ordinary production control endpoints create/update private state and preserve lock ordering', async t => productionFixture(t, f => {
  f.adapter.verify(); f.adapter.lock(); f.adapter.assertCurrent(); f.adapter.guard();
  f.adapter.record({ status: 'deployed', revision, runNumber: 2 });
  assert.equal(JSON.parse(fs.readFileSync(f.state)).status, 'deployed');
  assert.throws(() => f.adapter.assertCurrent(), /Older\/repeated/);
  f.adapter.failure({ status: 'failed', revision });
  assert.equal(JSON.parse(fs.readFileSync(f.state)).status, 'failed');
  for (const file of [f.state, f.guard]) assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  f.adapter.unlock(); assert.equal(fs.existsSync(path.join(f.config.stateRoot, 'deployment.lock')), false);
}));
test('actual production preflight/install refuse nested runtime environment without deleting any artifact', async t => productionFixture(t, f => {
  const nested = path.join(f.webRoot, 'backend/scripts/.env'); fs.writeFileSync(nested, 'private nested environment', { mode: 0o600 });
  fs.mkdirSync(path.join(f.webRoot, 'dist')); fs.writeFileSync(path.join(f.webRoot, 'dist/old.js'), 'old frontend');
  assert.throws(() => f.adapter.verify(), /environment overlaps/); assert.equal(f.commands.length, 0);
  assert.throws(() => f.adapter.install(), /environment overlaps/);
  assert.equal(fs.readFileSync(nested, 'utf8'), 'private nested environment'); assert.equal(fs.statSync(nested).mode & 0o777, 0o600);
  assert.equal(fs.readFileSync(path.join(f.webRoot, 'dist/old.js'), 'utf8'), 'old frontend');
  assert.equal(fs.existsSync(f.state), false);
}));
test('all replacement aliases including dangling later targets refuse before dist deletion', t => {
  for (const dangling of [false, true]) {
    const root = temp(t), bundle = path.join(root, 'bundle'), live = path.join(root, 'live'); fs.mkdirSync(bundle); createBundle(bundle);
    fs.mkdirSync(path.join(live, 'dist'), { recursive: true }); fs.mkdirSync(path.join(live, 'backend')); fs.writeFileSync(path.join(live, 'dist/old.js'), 'old frontend');
    fs.symlinkSync(dangling ? path.join(root, 'missing') : bundle, path.join(live, 'node_modules'));
    assert.throws(() => installBundle(bundle, live, revision), /Symlink|ENOENT/);
    assert.equal(fs.readFileSync(path.join(live, 'dist/old.js'), 'utf8'), 'old frontend');
  }
});
test('sealed bundle links cannot borrow undelivered private files through direct, chained or directory aliases', t => {
  for (const kind of ['direct', 'chain', 'directory']) {
    const root = temp(t); createBundle(root); fs.writeFileSync(path.join(root, 'backend/.env'), 'builder-only private file');
    if (kind === 'directory') fs.symlinkSync('../backend', path.join(root, 'dist/alias'));
    else { fs.symlinkSync('../backend/.env', path.join(root, 'dist/alias')); if (kind === 'chain') fs.symlinkSync('alias', path.join(root, 'dist/chain')); }
    fs.writeFileSync(path.join(root, 'release.json'), JSON.stringify({ revision, paths: artifactPaths, files: inventory(root) }));
    assert.throws(() => verifyBundle(root, revision), /delivery closure|undelivered/);
  }
});
test('legitimate package directory and .bin links keep the same declared targets after real install', t => {
  const root = temp(t), bundle = path.join(root, 'bundle'), live = path.join(root, 'live'); fs.mkdirSync(bundle); createBundle(bundle); fs.mkdirSync(path.join(live, 'backend'), { recursive: true });
  fs.writeFileSync(path.join(bundle, 'node_modules/pocketbase/cli.js'), 'package executable', { mode: 0o755 }); fs.mkdirSync(path.join(bundle, 'node_modules/.bin')); fs.symlinkSync('../pocketbase/cli.js', path.join(bundle, 'node_modules/.bin/pb'));
  fs.writeFileSync(path.join(bundle, 'release.json'), JSON.stringify({ revision, paths: artifactPaths, files: inventory(bundle) }));
  verifyBundle(bundle, revision); installBundle(bundle, live, revision);
  assert.equal(fs.realpathSync(path.join(live, 'node_modules/.bin/pb')), path.join(live, 'node_modules/pocketbase/cli.js'));
  assert.equal(fs.statSync(path.join(live, 'node_modules/.bin/pb')).mode & 0o777, 0o755);
});

test('ordinary parent replacement after preflight cannot fabricate deployed state', async t => productionFixture(t, f => {
  f.adapter.verify(); const parent = path.dirname(f.state); fs.renameSync(parent, parent + '-original'); fs.mkdirSync(parent, { mode: 0o700 });
  assert.throws(() => f.adapter.record({ status: 'deployed' }), /parent binding/);
  assert.throws(() => f.adapter.failure({ status: 'failed' }), /parent binding/);
  assert.equal(fs.existsSync(f.state), false);
}));
for (const operation of ['record', 'failure', 'guard']) test(`${operation} rechecks pinned parent after open before truncation`, async t => productionFixture(t, f => {
  f.adapter.verify(); const endpoint = operation === 'guard' ? f.guard : f.state;
  fs.writeFileSync(endpoint, 'original private control file', { mode: 0o600 });
  const parent = path.dirname(endpoint), originalOpen = fs.openSync; let injected = false;
  fs.openSync = (file, ...args) => {
    if (file === endpoint && !injected) {
      injected = true;
      fs.renameSync(parent, parent + '-original'); fs.mkdirSync(parent, { mode: 0o700 });
      fs.writeFileSync(endpoint, 'replacement must stay untouched', { mode: 0o600 });
    }
    return originalOpen(file, ...args);
  };
  try { assert.throws(() => f.adapter[operation]({ status: 'deployed' }), /parent binding/); }
  finally { fs.openSync = originalOpen; }
  assert.equal(fs.readFileSync(endpoint, 'utf8'), 'replacement must stay untouched');
  assert.equal(fs.readFileSync(path.join(parent + '-original', path.basename(endpoint)), 'utf8'), 'original private control file');
}));
test('bundle structural parent aliases cannot make external ordinary files look delivered', t => {
  const root = temp(t), bundle = path.join(root, 'bundle'); fs.mkdirSync(bundle); createBundle(bundle);
  const external = path.join(root, 'external-backend'); fs.renameSync(path.join(bundle, 'backend'), external); fs.symlinkSync(external, path.join(bundle, 'backend'));
  assert.throws(() => verifyBundle(bundle, revision), /Symlink/);
  assert.equal(fs.readFileSync(path.join(external, 'scripts/sync_velocity.js'), 'utf8'), 'candidate protected daemon');
});
