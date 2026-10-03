import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { artifactPaths, inventory, verifyBundle, validatePlan, deploy, installBundle, snapshotApplication, restoreBackup, verifyImmutableMigrations } from '../scripts/deployment.mjs';
const revision = 'a'.repeat(40), oldRevision = 'b'.repeat(40);
const config = {
  approvedRevision: revision, previousRevision: oldRevision,
  webRoot: '/fixture/site', backupRoot: '/fixture/backup', stateRoot: '/fixture/state', velocityRoot: '/fixture/velocity',
  pocketbaseVersion: '0.26.5', machineIdSha256: 'c'.repeat(64), runnerUser: 'fixture',
  websiteServices: ['pocketbase', 'velocity-sync', 'map-proxy'],
  serviceBindings: { pocketbase: 'fixture', 'velocity-sync': 'fixture', 'map-proxy': 'fixture' },
  nginxSiteFile: '/etc/nginx/sites-available/fixture', configurationFiles: ['/etc/systemd/system/pocketbase.service'],
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
    { configurationFiles: ['/etc/ssh/private-key'] }, { velocityPorts: [] }, { previousRevision: undefined },
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
