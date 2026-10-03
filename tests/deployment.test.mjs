import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { createHash } from 'node:crypto';
import { pocketbase, binaries, unusedPort, startOwned, waitFor, root as projectRoot } from './helpers/pocketbase.mjs';
import { artifactPaths, inventory, verifyBundle, validatePlan, deploy, installBundle, snapshotApplication, restoreBackup, verifyImmutableMigrations, productionAdapter, snapshotIdentity, verifySnapshot, createSafeRecovery, restoreSafeRecovery, checkDatabases } from '../scripts/deployment.mjs';
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
  try { await callback({ root, bundle, webRoot, config: bound, protectedFile, commands, adapter: productionAdapter(bundle, bound, revision, 2, configFile), executeLocal: originalExec, state: path.join(bound.stateRoot, 'deployment.json'), guard: path.join(webRoot, 'backend/.velocity-maintenance') }); }
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

function sealSnapshot(backup, webRoot, revisionValue, retainedHistory = [], sourceAbsentHistory = []) {
  const snapshot = snapshotApplication(webRoot, backup);
  const configFile = path.join(backup, 'fixture.env'); fs.writeFileSync(configFile, 'DISPOSABLE_SAMPLE=1\n', {mode:0o600});
  const configurationRoot = path.join(backup,'configuration'), configRelative=configFile.slice(1);
  fs.mkdirSync(path.dirname(path.join(configurationRoot,configRelative)),{recursive:true}); fs.copyFileSync(configFile,path.join(configurationRoot,configRelative));fs.chmodSync(path.join(configurationRoot,configRelative),0o600);
  const stat=fs.statSync(configFile);
  const value={revision:revisionValue,...snapshot,configuration:inventory(configurationRoot,[configRelative]),ownership:[{path:configRelative,uid:stat.uid,gid:stat.gid}],contract:checkDatabases(path.join(backup,'application/backend/pb_data')),retainedHistory,sourceAbsentHistory};
  value.snapshotId=snapshotIdentity(value);fs.writeFileSync(path.join(backup,'backup.json'),JSON.stringify(value));return value;
}
for (const [version,binary] of binaries) test(`real PB snapshot, mixed history preservation and safe recovery ${version}`, async t => {
  const root=temp(t), bundle=path.join(root,'bundle'),live=path.join(root,'live'),backup=path.join(root,'backup');
  fs.mkdirSync(bundle);fs.mkdirSync(live);fs.mkdirSync(backup);createBundle(bundle);
  // Candidate uses actual repository migrations/hooks, never the unknown target source.
  fs.rmSync(path.join(bundle,'backend/pb_migrations'),{recursive:true});fs.cpSync(path.join(projectRoot,'backend/pb_migrations'),path.join(bundle,'backend/pb_migrations'),{recursive:true});
  fs.rmSync(path.join(bundle,'backend/pb_hooks'),{recursive:true});fs.cpSync(path.join(projectRoot,'backend/pb_hooks'),path.join(bundle,'backend/pb_hooks'),{recursive:true});
  fs.writeFileSync(path.join(bundle,'release.json'),JSON.stringify({revision,paths:artifactPaths,files:inventory(bundle)}));
  const pb=await pocketbase(binary);
  try {
    const identities=[];
    for (const role of ['admin','service']) {
      const response=await pb.request('/api/collections/users/records',{token:pb.token,method:'POST',body:{email:role+'@example.invalid',password:'Disposable-Recovery-2026!',passwordConfirm:'Disposable-Recovery-2026!',verified:true,is_admin:true,service_account:role==='service'}});
      assert.equal(response.status,200,JSON.stringify(response));identities.push({id:response.data.id,role});
    }
    await pb.service.close();
    fs.cpSync(bundle,live,{recursive:true,verbatimSymlinks:true});fs.mkdirSync(path.join(live,'backend/pb_data'));fs.cpSync(path.join(pb.directory,'data'),path.join(live,'backend/pb_data'),{recursive:true});fs.copyFileSync(binary,path.join(live,'backend/pocketbase'));
    fs.mkdirSync(path.join(live,'backend/pb_data/storage'),{recursive:true});fs.writeFileSync(path.join(live,'backend/pb_data/storage/sample.bin'),'anonymous media');
    const full=sealSnapshot(backup,live,oldRevision);assert.equal(verifySnapshot(backup).snapshotId,full.snapshotId);
    const restored=path.join(root,'full-restored');restoreBackup(backup,restored);assert.equal(fs.readFileSync(path.join(restored,'isolated-configuration',full.configuration[0].path),'utf8'),'DISPOSABLE_SAMPLE=1\n');assert.equal(fs.statSync(path.join(restored,'isolated-configuration',full.configuration[0].path)).mode&0o777,0o600);
    const safe=createSafeRecovery(backup,live,bundle,revision,identities);const safeRestored=path.join(root,'safe-restored');const proof=restoreSafeRecovery(safe,safeRestored,revision);assert.equal(proof.sourceSnapshotId,full.snapshotId);assert.equal(proof.oldDaemonStarted,false);assert.equal(fs.readFileSync(path.join(safeRestored,'backend/pb_data/storage/sample.bin'),'utf8'),'anonymous media');
    assert.throws(()=>restoreSafeRecovery(safe,path.join(root,'wrong-app'),oldRevision),/binding/);
    assert.throws(()=>createSafeRecovery(backup,live,bundle,revision,[]),/identities/);
    const unsafe=path.join(root,'unsafe-derived');fs.cpSync(live,unsafe,{recursive:true,verbatimSymlinks:true});
    const sql=cp.spawnSync('python3',['-c',`import sqlite3,sys
c=sqlite3.connect(sys.argv[1]);c.execute("update _collections set updateRule='' where name='posts'");c.commit()`,path.join(unsafe,'backend/pb_data/data.db')],{encoding:'utf8'});assert.equal(sql.status,0,sql.stderr);assert.throws(()=>createSafeRecovery(backup,unsafe,bundle,revision,identities),/Unsafe protected/);
    fs.writeFileSync(path.join(unsafe,'backend/pb_data/storage/sample.bin'),'media drift');assert.throws(()=>createSafeRecovery(backup,unsafe,bundle,revision,identities),/Derived media mismatch/);
    const safeManifest=JSON.parse(fs.readFileSync(path.join(safe,'backup.json')));safeManifest.identities[0].role='service';fs.writeFileSync(path.join(safe,'backup.json'),JSON.stringify(safeManifest));assert.throws(()=>restoreSafeRecovery(safe,path.join(root,'wrong-identity'),revision),/identity binding/);
    const env=path.join(backup,'configuration',full.configuration[0].path);fs.writeFileSync(env,'tampered');assert.throws(()=>verifySnapshot(backup),/Configuration snapshot drift/);fs.writeFileSync(env,'DISPOSABLE_SAMPLE=1\n');
    // Exact retained bytes are supplied only through private evidence in the governed run.
    const retainedSource=process.env.PB_RETAINED_HISTORY_FILE;
    if (!retainedSource) {t.diagnostic('Exact mixed retained-history case not-verifiable: private source path absent');return;}
    const bytes=fs.readFileSync(retainedSource),digest=createHash('sha256').update(bytes).digest('hex');assert.equal(digest,'85f8f91d99a2cb72fec56515f08b980c26cf9f32350ef1caae53f6f904749d0c');
    const extra='backend/pb_migrations/1765100008_add_velocity_advanced.js';fs.writeFileSync(path.join(live,extra),bytes,{mode:0o644});
    const absent=['1770817921_updated_users.js','1770818121_updated_users.js','1770818775_updated_users.js'];
    const inserted=cp.spawnSync('python3',['-c',`import sqlite3,sys,json
c=sqlite3.connect(sys.argv[1])
for file in json.loads(sys.argv[2]): c.execute('insert into _migrations (file,applied) values (?,?)',(file,1))
c.commit()`,path.join(live,'backend/pb_data/data.db'),JSON.stringify([path.basename(extra),...absent])],{encoding:'utf8'});assert.equal(inserted.status,0,inserted.stderr);
    fs.rmSync(path.join(live,'backend/pb_hooks'),{recursive:true}); // actual missing component is represented
    const mixedBackup=path.join(root,'mixed-backup');fs.mkdirSync(mixedBackup);const retained=[{path:extra,sha256:digest,mode:0o644}],mixed=sealSnapshot(mixedBackup,live,null,retained,absent);
    const baseline={kind:'mixed',sourceRevision:null,snapshotId:mixed.snapshotId,snapshotDirectory:mixedBackup,retainedHistory:retained,sourceAbsentHistory:absent};
    assert.equal(validatePlan({...config,previousRevision:undefined,baseline},revision,3).revision,revision);verifySnapshot(mixedBackup,baseline);
    assert.throws(()=>verifySnapshot(mixedBackup,{...baseline,snapshotId:'0'.repeat(64)}),/binding mismatch/);
    assert.throws(()=>installBundle(bundle,live,revision,baseline),/complete snapshot/);
    fs.writeFileSync(path.join(live,'dist/index.html'),'target drift');assert.throws(()=>installBundle(bundle,live,revision,baseline,mixedBackup),/Target changed/);fs.copyFileSync(path.join(mixedBackup,'application/dist/index.html'),path.join(live,'dist/index.html'));
    installBundle(bundle,live,revision,baseline,mixedBackup);assert.deepEqual(fs.readFileSync(path.join(live,extra)),bytes);assert.deepEqual(checkDatabases(path.join(live,'backend/pb_data'))['data.db'].migrations,mixed.contract['data.db'].migrations);assert.equal(fs.existsSync(path.join(live,'backend/pb_migrations',absent[0])),false);assert.equal(fs.existsSync(path.join(live,'backend/pb_hooks')),true);
    fs.writeFileSync(path.join(live,extra),'modified');assert.throws(()=>verifyImmutableMigrations(bundle,live,baseline),/Unknown or modified/);
    fs.writeFileSync(path.join(live,extra),bytes);fs.writeFileSync(path.join(live,'backend/pb_migrations/new-unknown.js'),'unknown');assert.throws(()=>verifyImmutableMigrations(bundle,live,baseline),/Unknown or modified/);
    const altered=JSON.parse(fs.readFileSync(path.join(mixedBackup,'backup.json')));altered.retainedHistory[0].sha256='0'.repeat(64);altered.snapshotId=snapshotIdentity(altered);fs.writeFileSync(path.join(mixedBackup,'backup.json'),JSON.stringify(altered));assert.throws(()=>verifySnapshot(mixedBackup,{...baseline,snapshotId:altered.snapshotId,retainedHistory:altered.retainedHistory}),/Unknown retained/);
  } finally {if (pb.service.child.exitCode === null && pb.service.child.signalCode === null) await pb.close();}
});

test('productionAdapter mixed preflight/backup/rehearsal/install uses actual files and PB commands', {skip: !process.env.PB_RETAINED_HISTORY_FILE}, async t => productionFixture(t, async f => {
  const pb=await pocketbase(binaries[0][1]);
  let commandOverride=cp.execFileSync;
  try {
    const identities=[];
    for (const role of ['admin','service']) {
      const response=await pb.request('/api/collections/users/records',{token:pb.token,method:'POST',body:{email:role+'-adapter@example.invalid',password:'Disposable-Adapter-2026!',passwordConfirm:'Disposable-Adapter-2026!',verified:true,is_admin:true,service_account:role==='service'}});assert.equal(response.status,200);identities.push({id:response.data.id,role});
    }
    await pb.service.close();
    fs.rmSync(path.join(f.bundle,'backend/pb_migrations'),{recursive:true});fs.cpSync(path.join(projectRoot,'backend/pb_migrations'),path.join(f.bundle,'backend/pb_migrations'),{recursive:true});
    fs.rmSync(path.join(f.bundle,'backend/pb_hooks'),{recursive:true});fs.cpSync(path.join(projectRoot,'backend/pb_hooks'),path.join(f.bundle,'backend/pb_hooks'),{recursive:true});
    fs.writeFileSync(path.join(f.bundle,'release.json'),JSON.stringify({revision,paths:artifactPaths,files:inventory(f.bundle)}));
    fs.cpSync(f.bundle,f.webRoot,{recursive:true,verbatimSymlinks:true});
    fs.rmSync(path.join(f.webRoot,'backend/pb_data'),{recursive:true});fs.cpSync(path.join(pb.directory,'data'),path.join(f.webRoot,'backend/pb_data'),{recursive:true});fs.copyFileSync(binaries[0][1],path.join(f.webRoot,'backend/pocketbase'));
    const retainedSource=process.env.PB_RETAINED_HISTORY_FILE;
    assert.ok(retainedSource,'governed exact-history adapter proof requires private source');
    const extra='backend/pb_migrations/1765100008_add_velocity_advanced.js',bytes=fs.readFileSync(retainedSource);fs.writeFileSync(path.join(f.webRoot,extra),bytes,{mode:0o644});
    const absent=['1770817921_updated_users.js','1770818121_updated_users.js','1770818775_updated_users.js'];
    const inserted=cp.spawnSync('python3',['-c',`import sqlite3,sys,json
c=sqlite3.connect(sys.argv[1])
for file in json.loads(sys.argv[2]):c.execute('insert into _migrations (file,applied) values (?,?)',(file,1))
c.commit()`,path.join(f.webRoot,'backend/pb_data/data.db'),JSON.stringify([path.basename(extra),...absent])],{encoding:'utf8'});assert.equal(inserted.status,0,inserted.stderr);
    fs.rmSync(path.join(f.webRoot,'backend/pb_hooks'),{recursive:true});
    f.config.configurationFiles=[path.join(f.webRoot,'backend/.env')];f.config.recoveryIdentities=identities;
    cp.execFileSync=(file,args,options)=>file==='python3'||(file.endsWith('/backend/pocketbase')&&args[0]!=='--version')?f.executeLocal(file,args,options):commandOverride(file,args,options);syncBuiltinESMExports();
    const initial=f.adapter.backup();const raw=JSON.parse(fs.readFileSync(path.join(initial,'backup.json')));raw.revision=null;raw.retainedHistory=[{path:extra,sha256:createHash('sha256').update(bytes).digest('hex'),mode:0o644}];raw.sourceAbsentHistory=absent;raw.snapshotId=snapshotIdentity(raw);fs.writeFileSync(path.join(initial,'backup.json'),JSON.stringify(raw));
    f.config.baseline={kind:'mixed',sourceRevision:null,snapshotId:raw.snapshotId,snapshotDirectory:initial,retainedHistory:raw.retainedHistory,sourceAbsentHistory:absent};delete f.config.previousRevision;
    f.adapter.verify();f.adapter.assertCurrent();
    const backup=f.adapter.backup();assert.equal(verifySnapshot(backup,f.config.baseline).snapshotId,raw.snapshotId);
    f.adapter.rehearse(backup);f.adapter.baseline(backup);f.adapter.install();
    assert.deepEqual(fs.readFileSync(path.join(f.webRoot,extra)),bytes);assert.equal(fs.readFileSync(path.join(f.webRoot,'backend/.env'),'utf8'),'retained environment');
    f.adapter.record({status:'deployed',revision,runNumber:2,backup});const state=JSON.parse(fs.readFileSync(f.state));assert.equal(state.baseline,raw.snapshotId);assert.equal(state.candidateManifest.revision,revision);assert.deepEqual(state.retainedHistory,raw.retainedHistory);
    // Unknown ledger fails preflight without service commands or application replacement.
    raw.contract['data.db'].migrations.push(['unknown-applied.js',1]);raw.snapshotId=snapshotIdentity(raw);fs.writeFileSync(path.join(initial,'backup.json'),JSON.stringify(raw));f.config.baseline.snapshotId=raw.snapshotId;assert.throws(()=>f.adapter.verify(),/contract drift|Target changed/);
  } finally {
    cp.execFileSync=commandOverride;syncBuiltinESMExports();
    if(pb.service.child.exitCode===null&&pb.service.child.signalCode===null)await pb.close();
  }
}));

// Retained independent acceptance fixtures now exercise the fixed production
// entry, both PB versions, and the actual users authentication/API boundary.
test('safe recovery and deployment validate actual contracts, unlisted roles and target authentication on both PB versions', {skip: !process.env.PB_RETAINED_HISTORY_FILE}, async () => {
const evidence = fs.mkdtempSync(path.join(projectRoot, '.context/rework-epic005-004/adapter-')), project = projectRoot;
const candidate = revision;
const extra = 'backend/pb_migrations/1765100008_add_velocity_advanced.js';
const absent = ['1770817921_updated_users.js', '1770818121_updated_users.js', '1770818775_updated_users.js'];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const root = fs.realpathSync(fs.mkdtempSync(path.join(evidence, 'independent-')));
const observations = [];
const mkdir = file => fs.mkdirSync(file, { recursive: true, mode: 0o700 });
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
const rawExec = cp.execFileSync;
function copyWithModes(from,to,options) {
  fs.cpSync(from,to,options);
  const preserve=(source,target)=>{const info=fs.lstatSync(source);if(info.isSymbolicLink())return;fs.chmodSync(target,info.mode&0o777);if(info.isDirectory())for(const name of fs.readdirSync(source))preserve(path.join(source,name),path.join(target,name));};
  preserve(from,to);
}

function sql(file, source, args = []) { return rawExec('python3', ['-c', source, file, ...args], {encoding:'utf8'}).trim(); }
const names = fs.readdirSync(path.join(project, 'backend/pb_migrations')).filter(x=>x.endsWith('.js')).sort();
const beforeNames = names.filter(x=>x<'1789999999');
const retainedBytes = fs.readFileSync(process.env.PB_RETAINED_HISTORY_FILE);
assert.equal(sha(retainedBytes),'85f8f91d99a2cb72fec56515f08b980c26cf9f32350ef1caae53f6f904749d0c');
const bundle = path.join(root,'bundle');mkdir(bundle);
for(const name of ['dist','backend/pb_migrations','backend/pb_hooks','backend/scripts']) copyWithModes(path.join(project,name),path.join(bundle,name),{recursive:true,preserveTimestamps:true,verbatimSymlinks:true});
for(const name of ['package.json','package-lock.json'])fs.copyFileSync(path.join(project,name),path.join(bundle,name));
for(const name of ['@iarna/toml','pocketbase','eventsource']){mkdir(path.dirname(path.join(bundle,'node_modules',name)));copyWithModes(path.join(project,'node_modules',name),path.join(bundle,'node_modules',name),{recursive:true,verbatimSymlinks:true});}
write(path.join(bundle,'release.json'),{revision:candidate,paths:artifactPaths,files:inventory(bundle)});verifyBundle(bundle,candidate);

async function request(base, route, token, method='GET', body) {
  const response=await fetch(base+route,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:token}:{})},...(body?{body:JSON.stringify(body)}:{})});
  return {status:response.status,data:await response.json()};
}
async function fixture(version,binary) {
  const local=path.join(root,'PB'+version);mkdir(local);
  const webRoot=path.join(local,'site');mkdir(webRoot);
  copyWithModes(bundle,webRoot,{recursive:true,verbatimSymlinks:true});
  // Exact pre-upgrade application migration inventory; hooks were absent on the
  // observed target. Synthetic records are created through real PB APIs.
  for(const name of names.filter(x=>!beforeNames.includes(x)))fs.unlinkSync(path.join(webRoot,'backend/pb_migrations',name));
  fs.renameSync(path.join(webRoot,'backend/pb_hooks'),path.join(local,'uninstalled-candidate-hooks'));
  fs.copyFileSync(binary,path.join(webRoot,'backend/pocketbase'));
  const common=['--dir',path.join(webRoot,'backend/pb_data'),'--migrationsDir',path.join(webRoot,'backend/pb_migrations'),'--hooksDir',path.join(local,'uninstalled-candidate-hooks')];
  const migration=rawExec(binary,['migrate','up',...common],{encoding:'utf8'});assert.doesNotMatch(migration,/Failed|Error:/);
  rawExec(binary,['superuser','upsert','probe@example.invalid','Disposable-Only-2026!',...common],{encoding:'utf8'});
  const port=await unusedPort(),base='http://127.0.0.1:'+port;
  const service=await startOwned(binary,['serve','--automigrate=false','--http','127.0.0.1:'+port,...common]);
  let identities,ordinary,post,settings;
  try{
    await waitFor(base+'/api/health',service);
    const auth=await request(base,'/api/collections/_superusers/auth-with-password',null,'POST',{identity:'probe@example.invalid',password:'Disposable-Only-2026!'});assert.equal(auth.status,200);const token=auth.data.token;
    const users=[];
    for(const role of ['admin','service','ordinary']){
      const r=await request(base,'/api/collections/users/records',token,'POST',{email:role+'@example.invalid',password:'Disposable-Only-2026!',passwordConfirm:'Disposable-Only-2026!',verified:true});assert.equal(r.status,200,JSON.stringify(r));users.push({id:r.data.id,role});
    }
    identities=users.filter(x=>x.role!=='ordinary');ordinary=users.find(x=>x.role==='ordinary');
    const created=await request(base,'/api/collections/posts/records',token,'POST',{title:{zh:'anonymous retained draft'},content:{zh:'<p>draft preserved</p>'},is_public:false});assert.equal(created.status,200,JSON.stringify(created));post=created.data.id;
    const collection=await request(base,'/api/collections/velocity_settings',token);assert.equal(collection.status,200);
    const missing=['player_info_forwarding_mode','ping_passthrough','compression_threshold','compression_level','login_ratelimit'];
    const reduced=await request(base,'/api/collections/velocity_settings',token,'PATCH',{fields:collection.data.fields.filter(x=>!missing.includes(x.name))});assert.equal(reduced.status,200,JSON.stringify(reduced));
    const text=await request(base,'/api/collections/velocity_settings',token,'PATCH',{fields:[...reduced.data.fields,{name:'player_info_forwarding_mode',type:'text'},{name:'ping_passthrough',type:'text'}]});assert.equal(text.status,200,JSON.stringify(text));
    const listing=await request(base,'/api/collections/velocity_settings/records',token);settings=listing.data.items[0].id;
    const values=await request(base,'/api/collections/velocity_settings/records/'+settings,token,'PATCH',{player_info_forwarding_mode:'legacy',ping_passthrough:'ALL',connection_timeout:4321});assert.equal(values.status,200,JSON.stringify(values));
  }finally{await service.close();}
  const db=path.join(webRoot,'backend/pb_data/data.db');
  assert.equal(sql(db,"import sqlite3,sys; c=sqlite3.connect(sys.argv[1]);print(int(any(r[1]=='is_admin' for r in c.execute('pragma table_info(users)'))))"),'0');
  fs.writeFileSync(path.join(webRoot,extra),retainedBytes,{mode:0o644});
  sql(db,"import sqlite3,sys,json;c=sqlite3.connect(sys.argv[1]);[c.execute('insert into _migrations(file,applied) values (?,?)',(f,1)) for f in json.loads(sys.argv[2])];c.commit()",[JSON.stringify([path.basename(extra),...absent])]);
  mkdir(path.join(webRoot,'backend/pb_data/storage'));fs.writeFileSync(path.join(webRoot,'backend/pb_data/storage/sample.bin'),'anonymous media');
  for(const name of ['.env','backend/.env'])fs.writeFileSync(path.join(webRoot,name),'DISPOSABLE=1\n',{mode:0o600});
  fs.writeFileSync(path.join(webRoot,'unrelated.txt'),'preserved');
  for(const name of ['state','backup','velocity','external-config'])mkdir(path.join(local,name));
  for(const name of ['velocity.toml','velocity.jar','forwarding.secret'])fs.writeFileSync(path.join(local,'velocity',name),'unchanged disposable Java fixture',{mode:0o600});
  const configFiles=['/etc/systemd/system/pocketbase.service','/etc/systemd/system/velocity-sync.service','/etc/nginx/sites-available/acceptance006',path.join(webRoot,'.env'),path.join(webRoot,'backend/.env')];
  const configMap=new Map();for(const file of configFiles.filter(x=>x.startsWith('/etc/'))){const localFile=path.join(local,'external-config',path.basename(file));fs.writeFileSync(localFile,'DISPOSABLE_CONFIG='+path.basename(file)+'\n',{mode:0o600});configMap.set(file,localFile);}
  const config={approvedRevision:candidate,repository:'fixture/acceptance006',webRoot,backupRoot:path.join(local,'backup'),stateRoot:path.join(local,'state'),velocityRoot:path.join(local,'velocity'),pocketbaseVersion:version,machineIdSha256:sha('isolated machine'),runnerUser:os.userInfo().username,websiteServices:['pocketbase','velocity-sync'],serviceBindings:{pocketbase:'WorkingDirectory='+webRoot+'/backend', 'velocity-sync':'WorkingDirectory='+webRoot+'/backend/scripts'},velocityServiceBinding:'Requires=\nBindsTo=\nPartOf=',protectedVelocityFiles:['velocity.toml','velocity.jar','forwarding.secret'],velocityPorts:[25565],configurationFiles:configFiles,nginxSiteFile:configFiles[2],pocketbaseHealthUrl:base+'/api/health',baselineReviewed:true,serviceIdentityReviewed:true,restoreRehearsalRequired:true,recoveryIdentities:identities,previousRevision:'b'.repeat(40)};
  const configFile=path.join(local,'config.json');write(configFile,config);
  const work=path.join(local,'approved-working');mkdir(path.join(work,'backend'));
  copyWithModes(path.join(webRoot,'backend/pb_data'),path.join(work,'backend/pb_data'),{recursive:true});
  const forward=rawExec(binary,['migrate','up','--dir',path.join(work,'backend/pb_data'),'--migrationsDir',path.join(bundle,'backend/pb_migrations'),'--hooksDir',path.join(bundle,'backend/pb_hooks')],{encoding:'utf8'});assert.doesNotMatch(forward,/Failed|Error:/);fs.writeFileSync(path.join(local,'actual-forward.stdout'),forward,{mode:0o600});
  sql(path.join(work,'backend/pb_data/data.db'),"import sqlite3,sys,json;c=sqlite3.connect(sys.argv[1]);[c.execute('update users set is_admin=1,service_account=? where id=?',(int(i['role']=='service'),i['id'])) for i in json.loads(sys.argv[2])];c.commit()",[JSON.stringify(identities)]);
  config.recoveryWorkingCopy=work;
  return {local,webRoot,config,configFile,configMap,identities,ordinary,post,settings,base,binary,commands:[],running:null};
}

const originals={readFileSync:fs.readFileSync,statSync:fs.statSync,lstatSync:fs.lstatSync,existsSync:fs.existsSync,realpathSync:fs.realpathSync,cpSync:fs.cpSync};
let bound;
fs.readFileSync=(file,...args)=>file==='/etc/machine-id'?Buffer.from('isolated machine'):originals.readFileSync(bound?.configMap.get(file)??file,...args);
fs.statSync=(file,...args)=>{const s=originals.statSync(bound?.configMap.get(file)??file,...args);return file===bound?.configFile?new Proxy(s,{get:(s,k)=>k==='uid'?0:Reflect.get(s,k)}):s;};
fs.realpathSync=(file,...args)=>bound?.configMap.has(file)?file:originals.realpathSync(file,...args);
fs.existsSync=(file)=>originals.existsSync(bound?.configMap.get(file)??file);
fs.lstatSync=(file,...args)=>originals.lstatSync(bound?.configMap.get(file)??file,...args);
fs.cpSync=(from,to,...args)=>originals.cpSync(bound?.configMap.get(from)??from,to,...args);
cp.execFileSync=(file,args,options)=>{
  bound.commands.push({file,args});
  if(file==='python3'||file===bound.binary||file===path.join(bound.webRoot,'backend/pocketbase'))return rawExec(file,args,options);
  if(file==='git'&&args[0]==='ls-remote')return candidate+'\trefs/heads/main\n';
  if(file==='systemctl'&&args[0]==='is-active')return 'active\n';
  if(file==='systemctl'&&args[0]==='show')return (args[1]==='velocity'&&args.includes('MainPID')?'MainPID=100\nExecMainStartTimestampMonotonic=123\nNRestarts=0\nActiveState=active':args[1]==='velocity'?bound.config.velocityServiceBinding:bound.config.serviceBindings[args[1]])+'\n';
  if(file==='ss')return 'LISTEN 0 100 127.0.0.1:25565 0.0.0.0:*\n';
  if(file==='sudo'&&args[1]==='systemctl'){
    if(args[2]==='start'&&args[3]==='pocketbase')bound.running=startOwned(bound.binary,['serve','--automigrate=false','--http',new URL(bound.base).host,'--dir',path.join(bound.webRoot,'backend/pb_data'),'--migrationsDir',path.join(bound.webRoot,'backend/pb_migrations'),'--hooksDir',path.join(bound.webRoot,'backend/pb_hooks')]);
    return '';
  }
  throw new Error('Unapproved external command refused: '+file);
};syncBuiltinESMExports();
const environment={...process.env};Object.assign(process.env,{GITHUB_REPOSITORY:'fixture/acceptance006',GITHUB_RUN_ID:'6006',GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_SERVER_URL:'https://github.com'});
const adapter=()=>productionAdapter(bundle,bound.config,candidate,6,bound.configFile);
function initializeBaseline(){delete bound.config.baseline;bound.config.previousRevision=oldRevision;const initial=adapter().backup();const m=read(path.join(initial,'backup.json'));m.revision=null;m.retainedHistory=[{path:extra,sha256:sha(retainedBytes),mode:0o644}];m.sourceAbsentHistory=absent;m.snapshotId=snapshotIdentity(m);write(path.join(initial,'backup.json'),m);bound.config.baseline={kind:'mixed',sourceRevision:null,snapshotId:m.snapshotId,snapshotDirectory:initial,retainedHistory:m.retainedHistory,sourceAbsentHistory:absent};delete bound.config.previousRevision;return initial;}
function observe(id,expected,details){observations.push({id,expected,...details});write(path.join(evidence,'probes-003.json'),{candidate,root,production:false,observations});}
const attempt=async callback=>{try{return {accepted:true,value:await callback()};}catch(error){return {accepted:false,error:error.message};}};
try{
  for(const [version,binary] of binaries){
    bound=await fixture(version,binary);initializeBaseline();adapter().verify();
    const newBackup=()=>adapter().backup();
    // Success is exercised through the unchanged native rehearsal. Config copy
    // paths map only finite external fixtures; SQLite/PB/file operations are real.
    let backup=newBackup();const good=await attempt(()=>adapter().rehearse(backup));assert.equal(good.accepted,true,good.error);
    const m=read(path.join(backup,'safe-recovery/backup.json'));
    observe('P01-positive-'+version,'valid raw/derived recovery accepted',{passed:true,rawSnapshotId:bound.config.baseline.snapshotId,safeRecoveryId:m.recoveryId,sourceSnapshotId:m.sourceSnapshotId,actualPBForward:true,configurationFiles:m.configuration.length,fixtureRoot:bound.local});
    const wrong=path.join(bound.local,'wrong-content');copyWithModes(bound.config.recoveryWorkingCopy,wrong,{recursive:true});sql(path.join(wrong,'backend/pb_data/data.db'),"import sqlite3,sys;c=sqlite3.connect(sys.argv[1]);c.execute('update posts set content=?',('{\"zh\":\"lost\"}',));c.commit()");
    const approvedWork=bound.config.recoveryWorkingCopy;bound.config.recoveryWorkingCopy=wrong;backup=newBackup();let result=await attempt(()=>adapter().rehearse(backup));assert.equal(result.accepted,false);observe('P02-content-drift-'+version,'content mismatch rejected',{passed:true,error:result.error});
    const promoted=path.join(bound.local,'unapproved-promotion');copyWithModes(approvedWork,promoted,{recursive:true});sql(path.join(promoted,'backend/pb_data/data.db'),"import sqlite3,sys;c=sqlite3.connect(sys.argv[1]);c.execute('update users set is_admin=1 where id=?',(sys.argv[2],));c.commit()",[bound.ordinary.id]);bound.config.recoveryWorkingCopy=promoted;backup=newBackup();result=await attempt(()=>adapter().rehearse(backup));
    assert.equal(result.accepted,false,result.error);
    let recoveredPromotion=null;
    if(result.accepted){const recovered=path.join(bound.local,'unapproved-restored');restoreSafeRecovery(path.join(backup,'safe-recovery'),recovered,candidate);recoveredPromotion=Number(sql(path.join(recovered,'backend/pb_data/data.db'),"import sqlite3,sys;c=sqlite3.connect(sys.argv[1]);print(c.execute('select is_admin from users where id=?',(sys.argv[2],)).fetchone()[0])",[bound.ordinary.id]));}
    observe('P03-unapproved-role-'+version,'unlisted preexisting user promotion rejected',{passed:!result.accepted,accepted:result.accepted,error:result.error??null,ordinaryId:bound.ordinary.id,approvedIds:bound.identities.map(x=>x.id),restoredUnapprovedIsAdmin:recoveredPromotion,backup});
    // Service elevation is rejected independently of administrator elevation.
    const promotedService=path.join(bound.local,'unapproved-service');copyWithModes(approvedWork,promotedService,{recursive:true});
    sql(path.join(promotedService,'backend/pb_data/data.db'),"import sqlite3,sys;c=sqlite3.connect(sys.argv[1]);c.execute('update users set service_account=1 where id=?',(sys.argv[2],));c.commit()",[bound.ordinary.id]);
    bound.config.recoveryWorkingCopy=promotedService;result=await attempt(()=>adapter().rehearse(newBackup()));assert.equal(result.accepted,false,result.error);
    const wrongRole=path.join(bound.local,'wrong-role');copyWithModes(approvedWork,wrongRole,{recursive:true});
    sql(path.join(wrongRole,'backend/pb_data/data.db'),"import sqlite3,sys;c=sqlite3.connect(sys.argv[1]);c.execute('update users set service_account=1 where id=?',(sys.argv[2],));c.commit()",[bound.identities.find(x=>x.role==='admin').id]);
    bound.config.recoveryWorkingCopy=wrongRole;result=await attempt(()=>adapter().rehearse(newBackup()));assert.equal(result.accepted,false,result.error);
    const stale=path.join(bound.local,'incompatible-working');copyWithModes(approvedWork,stale,{recursive:true});sql(path.join(stale,'backend/pb_data/data.db'),"import sqlite3,sys,json;c=sqlite3.connect(sys.argv[1]);c.execute('delete from _migrations where file=?',('1790000001_schema_velocity_normalize_runtime_fields.js',));c.commit()");
    bound.config.recoveryWorkingCopy=stale;result=await attempt(()=>adapter().rehearse(newBackup()));assert.equal(result.accepted,false,result.error);
    const drift=path.join(bound.local,'field-drift');copyWithModes(approvedWork,drift,{recursive:true});
    sql(path.join(drift,'backend/pb_data/data.db'),"import sqlite3,sys,json;c=sqlite3.connect(sys.argv[1]);row=c.execute('select id,fields from _collections where name=?',('velocity_settings',)).fetchone();fields=json.loads(row[1]);[(f.update(min=None,max=None)) for f in fields if f.get('name')=='connection_timeout'];c.execute('update _collections set fields=? where id=?',(json.dumps(fields),row[0]));c.commit()");
    bound.config.recoveryWorkingCopy=drift;backup=newBackup();result=await attempt(()=>adapter().rehearse(backup));assert.equal(result.accepted,false,result.error);observe('P04-incompatible-contract-'+version,'missing applied candidate migration and constraint drift rejected',{passed:!result.accepted,accepted:result.accepted,error:result.error??null,backup});
    bound.config.recoveryWorkingCopy=approvedWork;
    for(const defect of ['ledger','constraint','role']){
      const rawBackup=newBackup();adapter().rehearse(rawBackup);const safe=path.join(rawBackup,'safe-recovery');
      const alteration=defect==='ledger'?"c.execute('delete from _migrations where file=?',('1790000001_schema_velocity_normalize_runtime_fields.js',))":defect==='role'?"c.execute('update users set is_admin=1 where id=?',(sys.argv[2],))":"row=c.execute('select id,fields from _collections where name=?',('velocity_settings',)).fetchone();fields=json.loads(row[1]);[(f.update(min=None,max=None)) for f in fields if f.get('name')=='connection_timeout'];c.execute('update _collections set fields=? where id=?',(json.dumps(fields),row[0]))";
      sql(path.join(safe,'application/backend/pb_data/data.db'),'import sqlite3,sys,json;c=sqlite3.connect(sys.argv[1]);'+alteration+';c.commit()',[bound.ordinary.id]);
      const forged=read(path.join(safe,'backup.json'));forged.application=inventory(path.join(safe,'application'),forged.present);forged.contract=checkDatabases(path.join(safe,'application/backend/pb_data'));forged.snapshotId=snapshotIdentity(forged);forged.recoveryId=sha(JSON.stringify({snapshotId:forged.snapshotId,sourceSnapshotId:forged.sourceSnapshotId,identities:forged.identities,candidateFiles:forged.candidateFiles}));write(path.join(safe,'backup.json'),forged);
      assert.throws(()=>restoreSafeRecovery(safe,path.join(bound.local,'forged-'+defect),candidate),/Recovery candidate contract mismatch|Unapproved role change/);
    }
    // Alter only the safe data and its self-reported permission/digests. The
    // stopped source and sealed candidate expectation remain byte exact.
    for (const defect of ['admin-roster', 'service-roster', 'role-mismatch', 'missing-permission', 'removed-identity', 'replaced-identity']) {
      const rawBackup=newBackup();adapter().rehearse(rawBackup);
      const safe=path.join(rawBackup,'safe-recovery'),oracle=path.join(rawBackup,'expected-recovery-contract.json');
      const oracleBytes=fs.readFileSync(oracle),rawBytes=fs.readFileSync(path.join(rawBackup,'backup.json'));
      const forged=read(path.join(safe,'backup.json'));
      if(defect==='admin-roster'||defect==='service-roster'){
        const role=defect==='admin-roster'?'admin':'service';
        sql(path.join(safe,'application/backend/pb_data/data.db'),"import sqlite3,sys;c=sqlite3.connect(sys.argv[1]);c.execute('update users set is_admin=1,service_account=? where id=?',(int(sys.argv[3]),sys.argv[2]));c.commit();c.execute('pragma wal_checkpoint(truncate)');c.close()",[bound.ordinary.id,String(Number(role==='service'))]);
        forged.identities.push({id:bound.ordinary.id,role});
      }else if(defect==='role-mismatch')forged.identities[0].role=forged.identities[0].role==='admin'?'service':'admin';
      else if(defect==='removed-identity')forged.identities.pop();
      else if(defect==='replaced-identity')forged.identities[0].id=bound.ordinary.id;
      else {const missing=read(oracle);delete missing.identities;write(oracle,missing);}
      forged.application=inventory(path.join(safe,'application'),forged.present);forged.contract=checkDatabases(path.join(safe,'application/backend/pb_data'));forged.snapshotId=snapshotIdentity(forged);
      forged.recoveryId=sha(JSON.stringify({snapshotId:forged.snapshotId,sourceSnapshotId:forged.sourceSnapshotId,identities:forged.identities,candidateFiles:forged.candidateFiles}));write(path.join(safe,'backup.json'),forged);
      const destination=path.join(bound.local,'forged-permission-'+defect);
      assert.throws(()=>restoreSafeRecovery(safe,destination,candidate),/Recovery original identities permission binding mismatch/);
      assert.equal(fs.existsSync(destination),false);assert.deepEqual(fs.readFileSync(path.join(rawBackup,'backup.json')),rawBytes);
      if(defect!=='missing-permission')assert.deepEqual(fs.readFileSync(oracle),oracleBytes);
      else {
        const withoutPermission=read(oracle);assert.equal(withoutPermission.identities,undefined);
        assert.throws(()=>createSafeRecovery(rawBackup,approvedWork,bundle,candidate,bound.identities,path.join(rawBackup,'rehearsal')),/Recovery original identities permission binding mismatch/);
        assert.deepEqual(read(oracle),withoutPermission);
        fs.unlinkSync(oracle);
        assert.throws(()=>createSafeRecovery(rawBackup,approvedWork,bundle,candidate,bound.identities,path.join(rawBackup,'rehearsal')),/Missing original identities permission binding/);
        assert.equal(fs.existsSync(oracle),false);
      }
      observe('A03-sealed-'+defect+'-'+version,'rehashed safe permission refused before destination writes',{passed:true,rawBackup,safe,independentExpectationUnchanged:defect!=='missing-permission'});
    }
    // An unsuccessful generation seals the original permission too: changing
    // config for a retry cannot expand that permission.
    const retryBackup=newBackup();bound.config.recoveryWorkingCopy=promoted;
    result=await attempt(()=>adapter().rehearse(retryBackup));assert.equal(result.accepted,false);
    const retryOracle=path.join(retryBackup,'expected-recovery-contract.json'),retryBytes=fs.readFileSync(retryOracle);
    assert.throws(()=>createSafeRecovery(retryBackup,promoted,bundle,candidate,[...bound.identities,{id:bound.ordinary.id,role:'admin'}],path.join(retryBackup,'rehearsal')),/Recovery original identities permission binding mismatch/);
    assert.deepEqual(fs.readFileSync(retryOracle),retryBytes);bound.config.recoveryWorkingCopy=approvedWork;
    const beforeInventory=inventory(bound.config.velocityRoot,bound.config.protectedVelocityFiles);
    const outcome=await attempt(()=>deploy(adapter(),bound.config,candidate,6));
    assert.equal(outcome.accepted,false,outcome.error);
    assert.equal(bound.commands.some(c=>c.file==='sudo'&&c.args[2]==='start'),false);
    assert.equal(fs.existsSync(path.join(bound.webRoot,'backend/.velocity-maintenance')),true);
    let roles=null,authorizedReads=null;
    if(outcome.accepted){
      roles=JSON.parse(sql(path.join(bound.webRoot,'backend/pb_data/data.db'),"import sqlite3,sys,json;c=sqlite3.connect(sys.argv[1]);print(json.dumps([c.execute('select id,is_admin,service_account from users where id=?',(i['id'],)).fetchone() for i in json.loads(sys.argv[2])]))",[JSON.stringify(bound.identities)]));
      authorizedReads=[];
      for(const who of bound.identities){const auth=await request(bound.base,'/api/collections/users/auth-with-password',null,'POST',{identity:who.role+'@example.invalid',password:'Disposable-Only-2026!'});const data=auth.status===200?await request(bound.base,'/api/collections/velocity_settings/records',auth.data.token):auth;authorizedReads.push({role:who.role,authStatus:auth.status,readStatus:data.status,records:data.data.items?.length??null});}
    }
    observe('P05-live-identity-'+version,'missing approved live roles stop before dependent services/deployed',{passed:!outcome.accepted,accepted:outcome.accepted,error:outcome.error??null,status:outcome.value?.status??null,liveRoles:roles,authorizedReads,services:bound.commands.filter(c=>c.file==='sudo'),javaFixtureBytesRetained:JSON.stringify(beforeInventory)===JSON.stringify(inventory(bound.config.velocityRoot,bound.config.protectedVelocityFiles)),state:fs.existsSync(path.join(bound.config.stateRoot,'deployment.json'))?read(path.join(bound.config.stateRoot,'deployment.json')).status:null});
    // Existing-field baseline: restore the approved synthetic role-bearing data,
    // then exercise the complete actual target authentication and start path.
    const safeRestore=path.join(bound.local,'approved-target');
    restoreSafeRecovery(path.join(read(path.join(bound.config.stateRoot,'deployment.json')).backup,'safe-recovery'),safeRestore,candidate);
    fs.rmSync(path.join(bound.webRoot,'backend/pb_data'),{recursive:true});
    copyWithModes(path.join(safeRestore,'backend/pb_data'),path.join(bound.webRoot,'backend/pb_data'),{recursive:true});
    bound.config.targetAuthentication=bound.identities.map(item=>({...item,identity:item.role+'@example.invalid',passwordEnv:'DISPOSABLE_TARGET_PASSWORD',...(item.role==='service'?{services:['velocity-sync']}: {})}));
    process.env.DISPOSABLE_TARGET_PASSWORD='incorrect disposable password';
    bound.config.stateRoot=path.join(bound.local,'auth-failure-state');mkdir(bound.config.stateRoot);initializeBaseline();bound.commands=[];
    const authFailure=await attempt(()=>deploy(adapter(),bound.config,candidate,6));
    assert.equal(authFailure.accepted,false,authFailure.error);
    assert.match(authFailure.error,/Target authentication failed/);
    assert.equal(bound.commands.some(c=>c.file==='sudo'&&c.args[2]==='start'&&c.args[3]==='velocity-sync'),false);
    assert.equal(read(path.join(bound.config.stateRoot,'deployment.json')).status,'failed');
    if(bound.running){const service=await bound.running;await service.close();bound.running=null;}
    process.env.DISPOSABLE_TARGET_PASSWORD='Disposable-Only-2026!';bound.config.stateRoot=path.join(bound.local,'success-state');mkdir(bound.config.stateRoot);initializeBaseline();bound.commands=[];
    const success=await deploy(adapter(),bound.config,candidate,6);
    assert.equal(success.status,'deployed');
    assert.equal(bound.commands.some(c=>c.file==='sudo'&&c.args[2]==='start'&&c.args[3]==='velocity-sync'),true);
    assert.equal(read(path.join(bound.config.stateRoot,'deployment.json')).status,'deployed');
    for(const who of [...bound.identities,bound.ordinary]){
      const auth=await request(bound.base,'/api/collections/users/auth-with-password',null,'POST',{identity:who.role+'@example.invalid',password:'Disposable-Only-2026!'});
      assert.equal(auth.status,who.role==='ordinary'?403:200);
      if(auth.status===200){assert.equal((await request(bound.base,'/api/collections/velocity_settings/records',auth.data.token)).status,200);assert.equal((await request(bound.base,'/api/collections/posts/records',auth.data.token)).data.items.length,1);}
    }
    const superAuth=await request(bound.base,'/api/collections/_superusers/auth-with-password',null,'POST',{identity:'probe@example.invalid',password:'Disposable-Only-2026!'});assert.equal(superAuth.status,200);
    const impersonation=await request(bound.base,'/api/collections/users/impersonate/'+bound.ordinary.id,superAuth.data.token,'POST',{duration:600});assert.equal(impersonation.status,200);
    for(const collection of ['velocity_settings','posts']){const ordinaryRead=await request(bound.base,'/api/collections/'+collection+'/records',impersonation.data.token);assert.equal(ordinaryRead.status,200);assert.equal(ordinaryRead.data.items.length,0);}
    const toggle=await request(bound.base,'/api/collections/system_settings/records',superAuth.data.token);assert.equal(toggle.data.items[0].enable_local_login,true);
    const human=bound.identities.find(item=>item.role==='admin');
    const humanLogin=await request(bound.base,'/api/collections/users/auth-with-password',null,'POST',{identity:'admin@example.invalid',password:'Disposable-Only-2026!'});assert.equal(humanLogin.status,200);
    const closeLogin=await request(bound.base,'/api/collections/system_settings/records/'+toggle.data.items[0].id,superAuth.data.token,'PATCH',{enable_local_login:false});assert.equal(closeLogin.status,200);
    assert.equal((await request(bound.base,'/api/collections/users/auth-with-password',null,'POST',{identity:'admin@example.invalid',password:'Disposable-Only-2026!'})).status,403);
    process.env.DISPOSABLE_HUMAN_TOKEN=humanLogin.data.token;
    bound.config.targetAuthentication=bound.config.targetAuthentication.map(item=>item.id===human.id?{id:item.id,role:item.role,tokenEnv:'DISPOSABLE_HUMAN_TOKEN'}:item);
    await adapter().health();
    assert.equal((await request(bound.base,'/api/collections/system_settings/records',superAuth.data.token)).data.items[0].enable_local_login,false);
    assert.deepEqual(inventory(bound.config.velocityRoot,bound.config.protectedVelocityFiles),beforeInventory);
    if(bound.running){const service=await bound.running;await service.close();bound.running=null;}
    // Existing authorization fields cannot make an unlisted promotion acceptable.
    bound.config.stateRoot=path.join(bound.local,'existing-state');mkdir(bound.config.stateRoot);fs.rmSync(path.join(bound.webRoot,'backend/pb_data'),{recursive:true});copyWithModes(path.join(safeRestore,'backend/pb_data'),path.join(bound.webRoot,'backend/pb_data'),{recursive:true});initializeBaseline();
    const existing=path.join(bound.local,'existing-promoted');copyWithModes(bound.config.recoveryWorkingCopy,existing,{recursive:true});
    sql(path.join(existing,'backend/pb_data/data.db'),"import sqlite3,sys;c=sqlite3.connect(sys.argv[1]);c.execute('update users set is_admin=1 where id=?',(sys.argv[2],));c.commit()",[bound.ordinary.id]);
    bound.config.recoveryWorkingCopy=existing;result=await attempt(()=>adapter().rehearse(newBackup()));assert.equal(result.accepted,false,result.error);assert.match(result.error,/Unapproved role change/);
    sql(path.join(existing,'backend/pb_data/data.db'),"import sqlite3,sys;c=sqlite3.connect(sys.argv[1]);c.execute('update users set is_admin=0,service_account=1 where id=?',(sys.argv[2],));c.commit()",[bound.ordinary.id]);result=await attempt(()=>adapter().rehearse(newBackup()));assert.equal(result.accepted,false,result.error);assert.match(result.error,/Unapproved role change/);
    observe('P06-authentication-'+version,'actual target rejects credentials then admits valid identities',{passed:true});
  }
}finally{
  if(bound?.running){const service=await bound.running;await service.close();}
  Object.assign(fs,originals);cp.execFileSync=rawExec;syncBuiltinESMExports();for(const key of ['DISPOSABLE_HUMAN_TOKEN','DISPOSABLE_TARGET_PASSWORD','GITHUB_REPOSITORY','GITHUB_RUN_ID','GITHUB_EVENT_NAME','GITHUB_SERVER_URL'])if(environment[key]===undefined)delete process.env[key];else process.env[key]=environment[key];
}
write(path.join(evidence,'probes-003.json'),{candidate,root,production:false,isolation:'original productionAdapter/deploy and actual PB/file/SQLite operations; only finite host/service/command/external config bindings substituted; synthetic identities and anonymous records',observations});
console.log(JSON.stringify({observations:observations.length,passed:observations.filter(x=>x.passed).length,failed:observations.filter(x=>!x.passed).length,root,production:false}));
process.exitCode=observations.every(x=>x.passed)?0:1;

});
