import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { createHash } from 'node:crypto';
import { pocketbase, binaries, root as projectRoot } from './helpers/pocketbase.mjs';
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
