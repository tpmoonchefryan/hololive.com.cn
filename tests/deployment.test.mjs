import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { createHash } from 'node:crypto';
import { pocketbase, binaries, unusedPort, startOwned, waitFor, root as projectRoot } from './helpers/pocketbase.mjs';
import { artifactPaths, inventory, verifyBundle, validatePlan, deploy, installBundle, snapshotApplication, restoreBackup, verifyImmutableMigrations, productionAdapter, snapshotIdentity, verifySnapshot, createSafeRecovery, restoreSafeRecovery, checkDatabases, readMigrationLedger, serviceFacts, dependencyList, dependencyLines, decodeIdentitySupply, readCurrentMain, currentMainPolicy, hostCommandTimeouts, recoveryPlan, failureReport, assertCapacity, rawClosureCap, capacityPolicy, assertPbDataRemovable, loopbackPolicy } from '../scripts/deployment.mjs';
const revision = 'a'.repeat(40), oldRevision = 'b'.repeat(40);
// INC-006 CC-4: every fixture of this file lives in one sandbox per run, under RUNNER_TEMP when
// the runner sets it (the runner empties it after each job), else under the default temporary
// directory. Child processes (python3 temporary copies, PocketBase) inherit it through TMPDIR.
// Each fixture is removed after its test and the sandbox after the file;
// HOLOLIVE_RETAIN_TEST_FIXTURES=1 keeps them for local debugging.
function fixtureBase(environment) {
  const runnerTemp = environment.RUNNER_TEMP;
  if (runnerTemp === undefined || runnerTemp === '') return os.tmpdir();
  assert.ok(path.isAbsolute(runnerTemp) && fs.statSync(runnerTemp).isDirectory(), 'Invalid RUNNER_TEMP for test fixtures');
  return fs.realpathSync(runnerTemp);
}
// A test may leave read-only directories behind: reopen them (never following links) and retry.
function removeFixture(root) {
  try { fs.rmSync(root, { recursive: true, force: true }); return; }
  catch (error) { if (!['EACCES', 'EPERM', 'ENOTEMPTY'].includes(error.code)) throw error; }
  const reopen = directory => {
    if (!fs.lstatSync(directory).isDirectory()) return;
    fs.chmodSync(directory, 0o700);
    for (const name of fs.readdirSync(directory)) reopen(path.join(directory, name));
  };
  reopen(root);
  fs.rmSync(root, { recursive: true, force: true });
}
const retainFixtures = process.env.HOLOLIVE_RETAIN_TEST_FIXTURES === '1';
const outerTmpdir = process.env.TMPDIR;
const sandbox = fs.realpathSync(fs.mkdtempSync(path.join(fixtureBase(process.env), 'hololive-deployment-run-')));
process.env.TMPDIR = sandbox;
const fixtureRoots = [];
after(() => {
  if (outerTmpdir === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = outerTmpdir;
  if (!retainFixtures) removeFixture(sandbox);
});
const guardBindingNames = ['TCRN_SPAWN_GUARD','TCRN_TASK_OWNER','TCRN_SPAWN_REGISTRY'];
function guardContext(environment) {
  const present=guardBindingNames.filter(name=>environment[name]!==undefined);
  const unusable=present.filter(name=>typeof environment[name]!=='string'||environment[name].trim()==='');
  return {mode:present.length===0?'plain':present.length===3&&unusable.length===0?'configured':'invalid',present,missing:guardBindingNames.filter(name=>!present.includes(name)),unusable};
}
test('lifecycle guard context admits only absent or complete bindings without changing the environment', () => {
  const actual=Object.fromEntries(guardBindingNames.map(name=>[name,process.env[name]]));
  for(let mask=0;mask<8;mask++) {
    const environment=Object.fromEntries(guardBindingNames.filter((_,index)=>mask&(1<<index)).map(name=>[name,'fixture-binding']));
    const before={...environment},context=guardContext(environment);
    assert.equal(context.mode,mask===0?'plain':mask===7?'configured':'invalid');
    assert.equal(context.present.length,mask.toString(2).replaceAll('0','').length);
    assert.deepEqual(environment,before);
  }
  for(const name of guardBindingNames)for(const value of ['', '   ']) {
    const environment=Object.fromEntries(guardBindingNames.map(binding=>[binding,'fixture-binding']));
    environment[name]=value;assert.equal(guardContext(environment).mode,'invalid');
    assert.deepEqual(guardContext(environment).unusable,[name]);
    assert.equal(guardContext({[name]:value}).mode,'invalid');
  }
  assert.deepEqual(Object.fromEntries(guardBindingNames.map(name=>[name,process.env[name]])),actual);
});
function fixtureService(directory, unit = 'velocity-sync', phase = 'running') {
  const executable = unit === 'pocketbase' ? directory + '/pocketbase' : '/usr/bin/node';
  const argv = unit === 'pocketbase' ? executable + ' serve --automigrate=false' : '/usr/bin/node ' + (unit === 'velocity-sync' ? 'sync_velocity.js' : unit + '.js');
  const record = phase === 'stopped' ? 'start_time=[fixture-start] ; stop_time=[fixture-stop] ; pid=200 ; code=killed ; status=9' : phase === 'new' ? 'start_time=[fixture-new-start] ; stop_time=[n/a] ; pid=201 ; code=(null) ; status=0' : 'start_time=[fixture-start] ; stop_time=[n/a] ; pid=200 ; code=(null) ; status=0';
  return ['ExecCondition=', 'ExecStartPre=', `ExecStart={ path=${executable} ; argv[]=${argv} ; ignore_errors=no ; ${record} }`, 'ExecStartPost=', 'ExecReload=', 'ExecStop=', 'ExecStopPost=', 'WorkingDirectory=' + directory, 'User=fixture', 'Group=fixture', 'EnvironmentFiles=', 'Requires=', 'BindsTo=', 'PartOf='].join('\n');
}

const config = {
  approvedRevision: revision, previousRevision: oldRevision,
  webRoot: '/fixture/site', backupRoot: '/fixture/backup', stateRoot: '/fixture/state', velocityRoot: '/fixture/velocity',
  pocketbaseVersion: '0.26.5', machineIdSha256: 'c'.repeat(64), runnerUser: 'fixture',
  websiteServices: ['pocketbase', 'velocity-sync', 'map-proxy'],
  serviceBindings: Object.fromEntries(['pocketbase','velocity-sync','map-proxy'].map(unit => [unit, fixtureService('/fixture/site' + (unit === 'pocketbase' ? '/backend' : '/backend/scripts'), unit)])),
  velocityServiceBinding: 'Requires=fixture\nBindsTo=\nPartOf=',
  nginxSiteFile: '/etc/nginx/sites-available/fixture', configurationFiles: ['/etc/systemd/system/pocketbase.service', '/etc/systemd/system/velocity-sync.service', '/etc/systemd/system/map-proxy.service', '/etc/nginx/sites-available/fixture'],
  protectedVelocityFiles: ['velocity.toml', 'velocity.jar', 'forwarding.secret'], velocityPorts: [25565],
  pocketbaseHealthUrl: 'http://127.0.0.1:8090/api/health', baselineReviewed: true, serviceIdentityReviewed: true, restoreRehearsalRequired: true,
};
test('configured commands stay exact while all five execution facts retain their phase', () => {
  const old = serviceFacts(fixtureService('/fixture/site/backend/scripts'));
  const zero = serviceFacts(fixtureService('/fixture/site/backend/scripts').replaceAll('status=0', 'status=0/0').replaceAll('pid=200', 'pid=0'));
  assert.equal(zero.runtime.ExecStart[0].status, '0/0');
  assert.equal(zero.runtime.ExecStart[0].pid, '0');
  assert.deepEqual(Object.keys(zero.runtime.ExecStart[0]), ['start_time','stop_time','pid','code','status']);
  for (const phase of ['stopped', 'new']) {
    const actual = serviceFacts(fixtureService('/fixture/site/backend/scripts', 'velocity-sync', phase));
    assert.deepEqual(actual.configuration, old.configuration);
    assert.notDeepEqual(actual.runtime.ExecStart, old.runtime.ExecStart);
    assert.deepEqual(Object.keys(actual.runtime.ExecStart[0]), ['start_time','stop_time','pid','code','status']);
  }
  for (const change of [raw => raw.replace('sync_velocity.js', 'sync_velocity.js --unsafe'), raw => raw.replace('ignore_errors=no', 'ignore_errors=yes'), raw => raw.replace('Group=fixture', 'Group=other')]) {
    assert.notDeepEqual(serviceFacts(change(fixtureService('/fixture/site/backend/scripts'))).configuration, old.configuration);
  }
  for (const change of [raw => raw + '\nUser=duplicate', raw => raw.replace(' ; pid=200', ''), raw => raw.replace('argv[]=/usr/bin/node', 'argv[]="/usr/bin/node"'), raw => raw.replace('ExecStop=', 'Unknown=')]) {
    assert.throws(() => serviceFacts(change(fixtureService('/fixture/site/backend/scripts'))), /property|command/);
  }
  const env = serviceFacts(fixtureService('/fixture/site/backend/scripts').replace('EnvironmentFiles=', 'EnvironmentFiles=/etc/default/velocity-sync (ignore_errors=no)'));
  assert.deepEqual(env.environment, [{path:'/etc/default/velocity-sync',ignore_errors:'no'}]);
  assert.throws(() => serviceFacts(fixtureService('/fixture/site/backend/scripts').replace('EnvironmentFiles=', 'EnvironmentFiles=/etc/default/velocity-sync (ignore_errors=no) /etc/default/velocity-sync (ignore_errors=yes)')), /EnvironmentFiles/);
});

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
test('first mixed capture is explicit and cannot invent a previous snapshot or historical scope', () => {
  const baseline={kind:'mixed',capture:'stopped-backup',sourceRevision:null,retainedHistory:[{path:'backend/pb_migrations/1765100008_add_velocity_advanced.js',sha256:'85f8f91d99a2cb72fec56515f08b980c26cf9f32350ef1caae53f6f904749d0c',mode:0o644}],sourceAbsentHistory:['1770817921_updated_users.js','1770818121_updated_users.js','1770818775_updated_users.js']};
  const first={...config,previousRevision:undefined,baseline};
  assert.equal(validatePlan(first,revision,1).revision,revision);
  for(const change of [{capture:true},{capture:'online'},{snapshotId:'d'.repeat(64)},{snapshotDirectory:'/fixture/imaginary'},{sourceRevision:oldRevision},{retainedHistory:[]},{sourceAbsentHistory:[]},{retainedHistory:undefined},{sourceAbsentHistory:undefined}])assert.throws(()=>validatePlan({...first,baseline:{...baseline,...change}},revision,1));
  assert.throws(()=>validatePlan({...first,previousRevision:oldRevision},revision,1));
  for (const field of ['baselineReviewed','serviceIdentityReviewed','restoreRehearsalRequired']) assert.throws(()=>validatePlan({...first,[field]:false},revision,1));
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
  // INC-006 CC-4: removed after the test (inside the per-run sandbox), unless retained on request.
  t.diagnostic('isolated fixture: ' + root);
  fixtureRoots.push(root);
  if (!retainFixtures) t.after(() => removeFixture(root));
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
  const configurationRoot=path.join(backup,'configuration');fs.mkdirSync(configurationRoot);
  fs.writeFileSync(path.join(configurationRoot,'fixture.env'),'fixture',{mode:0o600});
  const originalManifest=JSON.parse(fs.readFileSync(path.join(backup,'backup.json')));
  const configuration=inventory(configurationRoot,['fixture.env']);
  for(const ownership of [[],[{path:'fixture.env',uid:0,gid:0},{path:'fixture.env',uid:0,gid:0}],[{path:'other.env',uid:0,gid:0}],[{path:'fixture.env',uid:-1,gid:0}],...(process.geteuid()===0?[]:[[{path:'fixture.env',uid:0,gid:0}]])]) {
    fs.writeFileSync(path.join(backup,'backup.json'),JSON.stringify({...originalManifest,configuration,ownership}));
    const refused=path.join(root,'owner-refused');
    assert.throws(()=>restoreBackup(backup,refused),/ownership/);assert.equal(fs.existsSync(refused),false);
  }
  fs.writeFileSync(path.join(backup,'backup.json'),JSON.stringify(originalManifest));
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

// The existing host-command boundary maps the finite child to isolated files.
// These responses model root/systemd/kernel facts; they never acquire root or
// claim execution of Linux freezing, killing or the Python privileged body.
function finiteHostResponse(request, host) {
  const { operation } = request, runner = os.userInfo();
  const state = request.state ?? { changed: false, attempted: [], leaves: {}, directories: {}, frozen: false, killed: false, stopped: false };
  const reply = (ok, reason) => JSON.stringify({ ok, reason, rootEUID: host.euid ?? 0, runnerUID: host.runnerUID ?? runner.uid, runnerGID: host.runnerGID ?? runner.gid, state });
  const fail = name => { if (host.fail === name) throw new Error('finite fixture ' + name); };
  const endpoint = unit => path.join(host.root, 'runtime', unit + '.service.d', '99-hololive-release-guard.conf');
  const inode = file => { const x = fs.lstatSync(file); return [x.dev, x.ino]; };
  const content = unit => unit === 'velocity' ? '[Unit]\nRefuseManualStop=yes\n' : '[Unit]\nRefuseManualStart=yes\n[Service]\nRestart=no\nRestartForceExitStatus=\n';
  try {
    assert.deepEqual(Object.keys(request).sort(), ['operation','configFile','configIdentity','configSha256','lockIdentity','revision','runNumber','runId','repository','runnerPID','runnerUID','runnerGID','bundle','candidateManifestSha256','velocityEvidence','serviceEvidence','state'].sort());
    assert.ok(['stop','cleanup-sync','cleanup-java'].includes(operation));
    fail('root'); fail('runner'); fail('config'); fail('lock');
    if (host.euid !== undefined && host.euid !== 0) return reply(false, 'finite fixture actual root missing');
    if (host.runnerUID !== undefined && host.runnerUID !== runner.uid) return reply(false, 'finite fixture wrong runner');
    const owner=Object.fromEntries(['revision','runNumber','runId','repository','lockIdentity','runnerPID','configSha256'].map(key=>[key,request[key]]));
    if (operation === 'stop') {
      state.owner=owner;
      for (const refusal of ['code','unit','process','shared-group','nested-group','job','file','tmp','bak','async-io','parent','alias','hardlink']) fail(refusal);
      for (const unit of ['velocity','velocity-sync']) if (fs.existsSync(endpoint(unit))) throw new Error('finite fixture existing runtime leaf');
      for (const unit of ['velocity','velocity-sync']) {
        const file = endpoint(unit), directory = path.dirname(file);
        fs.mkdirSync(directory, { recursive: true }); state.changed = true; state.directories[unit] = inode(directory); state.attempted.push('mkdir-' + unit); fail('directory-' + unit);
        fs.writeFileSync(file, content(unit), { flag: 'wx', mode: 0o644 }); state.leaves[unit] = inode(file); state.attempted.push('create-' + unit); fail('leaf-' + unit);
      }
      state.attempted.push('reload'); fail('reload'); fail('readback');
      state.attempted.push('cgroup.freeze'); fail('freeze-timeout'); state.frozen = true;
      for (const refusal of ['frozen-process','frozen-file','frozen-job','frozen-io','thawed']) fail(refusal);
      state.attempted.push('cgroup.kill'); fail('kill'); state.killed = true; fail('exit-timeout');
      host.commands.push({ file: 'sudo', args: ['-n','systemctl','stop','velocity-sync'] }); state.stopped = true;
    } else {
      assert.deepEqual(state.owner,owner,'Runtime ownership belongs to another run');
      if(operation==='cleanup-java')fail('cleanup-java');
      for (const refusal of ['cleanup-guard','cleanup-code','cleanup-unit','cleanup-file','cleanup-job','cleanup-leaf','cleanup-run']) fail(refusal);
      for (const [unit, id] of Object.entries(state.leaves)) {
        assert.deepEqual(inode(endpoint(unit)), id, 'foreign/replaced leaf'); assert.equal(fs.readFileSync(endpoint(unit), 'utf8'), content(unit), 'runtime leaf content drift');
      }
      const unit = operation === 'cleanup-sync' ? 'velocity-sync' : 'velocity';
      fs.unlinkSync(endpoint(unit)); delete state.leaves[unit];
      if (fs.readdirSync(path.dirname(endpoint(unit))).length === 0) { fs.rmdirSync(path.dirname(endpoint(unit))); delete state.directories[unit]; }
      state.attempted.push('remove-' + unit, 'reload-' + unit); fail('cleanup-readback');
    }
    return reply(true);
  } catch (error) { state.reason = error.message; return reply(false, error.message); }
}

const ampleFilesystem = (change = {}) => ({ type: 0, bsize: 4096, blocks: 2 ** 40, bfree: 2 ** 40, bavail: 2 ** 40, files: 2 ** 32, ffree: 2 ** 32, ...change });
async function productionFixture(t, callback) {
  const root = temp(t), bundle = path.join(root, 'bundle'), webRoot = path.join(root, 'site');
  fs.mkdirSync(bundle); createBundle(bundle);
  for (const name of ['site/backend/pb_data', 'site/backend/scripts', 'site/backend/pb_migrations', 'state', 'backup', 'velocity']) fs.mkdirSync(path.join(root, name), { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(webRoot, 'backend/pb_data/data.db'), 'retained database');
  fs.writeFileSync(path.join(webRoot, 'backend/.env'), 'retained environment', { mode: 0o600 });
  for (const name of ['velocity.toml','velocity.jar']) fs.writeFileSync(path.join(root,'velocity',name), 'protected fixture');
  const protectedFile = path.join(root, 'velocity/forwarding.secret'); fs.writeFileSync(protectedFile, 'protected fixture', { mode: 0o600 });
  const bound = { ...config, webRoot, backupRoot: path.join(root, 'backup'), stateRoot: path.join(root, 'state'), velocityRoot: path.join(root, 'velocity'), runnerUser: os.userInfo().username, machineIdSha256: createHash('sha256').update('fixture machine').digest('hex'), repository: 'fixture/deployment', serviceBindings: Object.fromEntries(config.websiteServices.map(unit => [unit, fixtureService(webRoot + (unit === 'pocketbase' ? '/backend' : '/backend/scripts'), unit)])) };
  fs.writeFileSync(path.join(webRoot, 'backend/scripts/sync_velocity.js'), 'old daemon fixture');
  bound.finiteStop = { syncCodeSha256: createHash('sha256').update(fs.readFileSync(path.join(webRoot, 'backend/scripts/sync_velocity.js'))).digest('hex') };
  const configMap = new Map(bound.configurationFiles.map((file, index) => { const local = path.join(root, 'config-' + index); fs.writeFileSync(local, 'fixture config', { mode: 0o600 }); return [file, local]; }));
  const configFile = path.join(root, 'config.json'); fs.writeFileSync(configFile, JSON.stringify(bound), { mode: 0o600 });
  const commands = [], originalRead = fs.readFileSync, originalStat = fs.statSync, originalLstat = fs.lstatSync, originalRealpath = fs.realpathSync, originalExec = cp.execFileSync, originalStatfs = fs.statfsSync;
  // INC-006 CC-3: host free space is a simulated fact here, so no case depends on this machine's disk.
  fs.statfsSync = () => ampleFilesystem();
  const environment = Object.fromEntries(['GITHUB_REPOSITORY', 'GITHUB_RUN_ID', 'GITHUB_EVENT_NAME'].map(key => [key, process.env[key]]));
  fs.readFileSync = (file, ...args) => file === '/etc/machine-id' ? Buffer.from('fixture machine') : originalRead(configMap.get(file) ?? file, ...args);
  fs.statSync = (file, ...args) => { const value = originalStat(configMap.get(file) ?? file, ...args); return file === configFile ? new Proxy(value, { get: (value, key) => key === 'uid' ? 0 : Reflect.get(value, key) }) : value; };
  fs.lstatSync = (file, ...args) => originalLstat(configMap.get(file) ?? file, ...args);
  const host = { root, commands: [] };
  fs.realpathSync = (file, ...args) => bound.configurationFiles.includes(file) ? file : originalRealpath(file, ...args);
  cp.execFileSync = (file, args, options) => {
    if (file === 'sudo' && args[1] === '/usr/bin/python3') { commands.push([file, ...args.slice(0, 3)]); return finiteHostResponse(JSON.parse(options.input), host); }
    commands.push([file, ...args]);
    if (file === 'git' && args[0] === 'ls-remote') return revision + '\trefs/heads/main\n';
    if (file.endsWith('/backend/pocketbase') && args[0] === '--version') return 'pocketbase version 0.26.5\n';
    if (file === 'systemctl' && args[0] === 'is-active') return 'active\n';
    if (file === 'systemctl' && args[0] === 'show') return (args[1] === 'velocity' && args.includes('MainPID') ? 'MainPID=100\nExecMainStartTimestampMonotonic=123\nNRestarts=0\nActiveState=active' : args[1] === 'velocity' ? (args.includes('ExecStart') ? fixtureService(bound.velocityRoot, 'velocity') : bound.velocityServiceBinding) : bound.serviceBindings[args[1]]) + '\n';
    if(file==='ss') return 'LISTEN 0 100 127.0.0.1:25565 0.0.0.0:*\n';
    if(file==='sudo'&&args[1]==='systemctl') return '';
    throw new Error('External command refused by isolated test');
  };
  Object.assign(process.env, { GITHUB_REPOSITORY: bound.repository, GITHUB_RUN_ID: '123', GITHUB_EVENT_NAME: 'workflow_dispatch' }); syncBuiltinESMExports();
  try { await callback({ root, bundle, webRoot, host, configFile, configMap, config: bound, protectedFile, commands, createAdapter: () => productionAdapter(bundle, bound, revision, 2, configFile), get adapter() { return this.boundAdapter ??= this.createAdapter(); }, executeLocal: originalExec, state: path.join(bound.stateRoot, 'deployment.json'), guard: path.join(webRoot, 'backend/.velocity-maintenance') }); }
  finally {
    fs.readFileSync = originalRead; fs.statSync = originalStat; fs.lstatSync = originalLstat; fs.realpathSync = originalRealpath; fs.statfsSync = originalStatfs; cp.execFileSync = originalExec; syncBuiltinESMExports();
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
// Run 102: a root-owned backend/scripts/logs could not be emptied after the
// services had stopped. Removability is now proved for every entry in preflight.
test('runner-owned artifact trees pass install preflight and are replaced in full', async t => productionFixture(t, f => {
  const logs = path.join(f.webRoot, 'backend/scripts/logs');
  fs.mkdirSync(path.join(f.webRoot, 'dist')); fs.writeFileSync(path.join(f.webRoot, 'dist/old.js'), 'old frontend');
  fs.mkdirSync(logs); fs.writeFileSync(path.join(logs, 'latest.log'), '');
  f.adapter.verify();
  installBundle(f.bundle, f.webRoot, revision);
  assert.equal(fs.existsSync(logs), false); assert.equal(fs.existsSync(path.join(f.webRoot, 'dist/old.js')), false);
  assert.equal(fs.readFileSync(path.join(f.webRoot, 'backend/scripts/sync_velocity.js'), 'utf8'), 'candidate protected daemon');
}));
test('artifact entries the runner cannot remove are all listed before any stop, command or deletion', { skip: process.geteuid() === 0 && 'root bypasses directory permissions' }, async t => productionFixture(t, f => {
  const scripts = path.join(f.webRoot, 'backend/scripts'), logs = path.join(scripts, 'logs'), latest = path.join(logs, 'latest.log');
  const dist = path.join(f.webRoot, 'dist'), assets = path.join(dist, 'assets'), asset = path.join(assets, 'app.js');
  fs.mkdirSync(assets, { recursive: true }); fs.writeFileSync(path.join(dist, 'old.js'), 'old frontend'); fs.writeFileSync(asset, 'old asset');
  fs.mkdirSync(logs); fs.writeFileSync(latest, '');
  // The fixture root may already be removed when this hook runs (INC-006 CC-4 removes read-only trees itself).
  for (const directory of [logs, assets]) { fs.chmodSync(directory, 0o555); t.after(() => { try { fs.chmodSync(directory, 0o755); } catch (error) { if (error.code !== 'ENOENT') throw error; } }); }
  const names = ['dist', 'backend/pb_migrations', 'backend/scripts'], before = inventory(f.webRoot, names);
  // One refusal lists every blocked entry; a directory that cannot be emptied is blocked too.
  const refused = error => error.message === 'Artifact entries not removable by runner: ' + [asset, assets, dist, latest, logs, scripts].join(', ');
  assert.throws(() => f.adapter.verify(), refused);
  assert.equal(f.commands.length, 0);
  assert.throws(() => f.adapter.install(), refused);
  assert.throws(() => installBundle(f.bundle, f.webRoot, revision), refused);
  assert.deepEqual(inventory(f.webRoot, names), before);
  assert.equal(fs.readFileSync(path.join(dist, 'old.js'), 'utf8'), 'old frontend');
  for (const file of [f.state, f.guard, path.join(f.config.stateRoot, 'deployment.lock')]) assert.equal(fs.existsSync(file), false);
  assert.equal(f.commands.length, 0);
}));
test('sticky artifact parents admit removal only of runner-owned entries or under a runner-owned parent', async t => productionFixture(t, f => {
  const scripts = path.join(f.webRoot, 'backend/scripts'), logs = path.join(scripts, 'logs'), latest = path.join(logs, 'latest.log');
  fs.mkdirSync(logs); fs.writeFileSync(latest, '');
  const runner = process.geteuid(), owners = new Map(), lstat = fs.lstatSync;
  // Foreign ownership needs root to create; only lstat owner/sticky facts are substituted.
  fs.lstatSync = (file, ...args) => {
    const value = lstat(file, ...args);
    return owners.has(file) ? new Proxy(value, { get: (v, k) => k === 'uid' ? owners.get(file) : k === 'mode' && file === logs ? v.mode | 0o1000 : Reflect.get(v, k) }) : value;
  };
  syncBuiltinESMExports();
  try {
    for (const [entry, parent, accepted] of [[runner, runner + 1, true], [runner + 1, runner, true], [runner + 1, runner + 1, false]]) {
      owners.set(latest, entry); owners.set(logs, parent);
      const commands = f.commands.length;
      if (accepted) { f.createAdapter().verify(); continue; }
      assert.throws(() => f.createAdapter().verify(), error => error.message === 'Artifact entries not removable by runner: ' + [latest, logs, scripts].join(', '));
      assert.equal(f.commands.length, commands);
    }
    assert.throws(() => installBundle(f.bundle, f.webRoot, revision), /not removable by runner/);
    assert.equal(fs.existsSync(latest), true);
  } finally { fs.lstatSync = lstat; syncBuiltinESMExports(); }
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
  } finally { await pb.close(); } // INC-006 CC-4: close() is idempotent and also removes the PB fixture directory
});

// TCRN-HOLOLIVE-CN-INC-005 C1: on a second deploy the raw snapshot already holds the
// placeholder triple at 0. Only the pinned candidate data migration may turn it into
// 256/-1/3000; every other change is still refused before any recovery is written.
const placeholderMigration = '1791254033_data_velocity_replace_placeholder_advanced_zeros.js';
const placeholderTriple = ['compression_threshold', 'compression_level', 'login_ratelimit'];
function sqliteWrite(file, source) {
  const result = cp.spawnSync('python3', ['-c', 'import sqlite3,sys\nc=sqlite3.connect(sys.argv[1])\n' + source + '\nc.commit()\nc.close()', file], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}
// Reads a private copy, so a sealed or derived directory never gains -wal/-shm files.
function velocityRows(directory) {
  const result = cp.spawnSync('python3', ['-c', `import sqlite3,sys,json,tempfile,shutil,pathlib
with tempfile.TemporaryDirectory(prefix='hololive-inc005-read-') as temporary:
 target=pathlib.Path(temporary)/'data.db';shutil.copy2(sys.argv[1],target)
 wal=pathlib.Path(sys.argv[1]+'-wal')
 if wal.exists():shutil.copy2(wal,str(target)+'-wal')
 c=sqlite3.connect(str(target));c.row_factory=sqlite3.Row
 print(json.dumps([dict(r) for r in c.execute('select * from velocity_settings order by id')]));c.close()`, path.join(directory, 'backend/pb_data/data.db')], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr); return JSON.parse(result.stdout);
}
const derivedRefusal = table => new RegExp('AssertionError: Derived record/content mismatch: ' + table + '$', 'm');
for (const [version, binary] of binaries) test(`second deploy rehearsal admits only the pinned placeholder triple 0/0/0 -> 256/-1/3000 ${version}`, async t => {
  const root = temp(t), bundle = path.join(root, 'bundle'), live = path.join(root, 'live');
  fs.mkdirSync(bundle); fs.mkdirSync(live); createBundle(bundle);
  fs.rmSync(path.join(bundle, 'backend/pb_migrations'), { recursive: true }); fs.cpSync(path.join(projectRoot, 'backend/pb_migrations'), path.join(bundle, 'backend/pb_migrations'), { recursive: true });
  fs.rmSync(path.join(bundle, 'backend/pb_hooks'), { recursive: true }); fs.cpSync(path.join(projectRoot, 'backend/pb_hooks'), path.join(bundle, 'backend/pb_hooks'), { recursive: true });
  const release = directory => fs.writeFileSync(path.join(directory, 'release.json'), JSON.stringify({ revision, paths: artifactPaths, files: inventory(directory) }));
  release(bundle);
  assert.equal(createHash('sha256').update(fs.readFileSync(path.join(bundle, 'backend/pb_migrations', placeholderMigration))).digest('hex'), '4e8c523cd174cbd80a3acf80af643d8493944ccdfef985a5b4470112ad2dad1c');
  // The previous release applied every migration before the candidate's data migration.
  const previous = fs.readdirSync(path.join(projectRoot, 'backend/pb_migrations')).filter(name => name.endsWith('.js') && name < placeholderMigration).sort();
  const pb = await pocketbase(binary, previous);
  const identities = [];
  try {
    for (const role of ['admin', 'service']) {
      const response = await pb.request('/api/collections/users/records', { token: pb.token, method: 'POST', body: { email: role + '-second@example.invalid', password: 'Disposable-Second-2026!', passwordConfirm: 'Disposable-Second-2026!', verified: true, is_admin: true, service_account: role === 'service' } });
      assert.equal(response.status, 200, JSON.stringify(response)); identities.push({ id: response.data.id, role });
    }
    const listing = await pb.request('/api/collections/velocity_settings/records', { token: pb.token });
    assert.equal(listing.status, 200); assert.equal(listing.data.items.length, 1);
    const configured = await pb.request('/api/collections/velocity_settings/records/' + listing.data.items[0].id, { token: pb.token, method: 'PATCH', body: { player_info_forwarding_mode: 'legacy', ping_passthrough: 'ALL', connection_timeout: 4321 } });
    assert.equal(configured.status, 200, JSON.stringify(configured));
    // The same three field names in another table: the admission is bound to velocity_settings.
    const shadow = await pb.request('/api/collections', { token: pb.token, method: 'POST', body: { name: 'velocity_settings_shadow', type: 'base', fields: placeholderTriple.map(name => ({ name, type: 'number' })) } });
    assert.equal(shadow.status, 200, JSON.stringify(shadow));
    const shadowRecord = await pb.request('/api/collections/velocity_settings_shadow/records', { token: pb.token, method: 'POST', body: { compression_threshold: 0, compression_level: 0, login_ratelimit: 0 } });
    assert.equal(shadowRecord.status, 200, JSON.stringify(shadowRecord));
    await pb.service.close();
    fs.cpSync(bundle, live, { recursive: true, verbatimSymlinks: true }); fs.rmSync(path.join(live, 'backend/pb_migrations', placeholderMigration));
    fs.mkdirSync(path.join(live, 'backend/pb_data')); fs.cpSync(path.join(pb.directory, 'data'), path.join(live, 'backend/pb_data'), { recursive: true }); fs.copyFileSync(binary, path.join(live, 'backend/pocketbase'));
  } finally { await pb.close(); }
  const raw = velocityRows(live);
  assert.equal(raw.length, 1); assert.deepEqual(placeholderTriple.map(name => raw[0][name]), [0, 0, 0], 'the raw snapshot already holds the placeholder triple');
  assert.deepEqual([raw[0].player_info_forwarding_mode, raw[0].ping_passthrough, raw[0].connection_timeout], ['legacy', 'ALL', 4321]);
  const sealed = name => { const directory = path.join(root, name); fs.mkdirSync(directory); sealSnapshot(directory, live, oldRevision); return directory; };
  const backup = sealed('backup');
  // Isolated forward migration of the raw data with the candidate bundle, as the rehearsal does.
  const migrated = path.join(root, 'migrated'); fs.mkdirSync(path.join(migrated, 'backend'), { recursive: true });
  fs.cpSync(path.join(live, 'backend/pb_data'), path.join(migrated, 'backend/pb_data'), { recursive: true });
  const forward = cp.spawnSync(binary, ['migrate', 'up', '--dir', path.join(migrated, 'backend/pb_data'), '--migrationsDir', path.join(bundle, 'backend/pb_migrations'), '--hooksDir', path.join(bundle, 'backend/pb_hooks')], { encoding: 'utf8' });
  assert.equal(forward.status, 0, forward.stdout + forward.stderr); assert.doesNotMatch(forward.stdout + forward.stderr, /Failed|Error:/);
  const derived = velocityRows(migrated);
  assert.deepEqual(placeholderTriple.map(name => derived[0][name]), [256, -1, 3000]);
  for (const key of Object.keys(raw[0])) if (![...placeholderTriple, 'updated'].includes(key)) assert.deepEqual(derived[0][key], raw[0][key], key);
  // Negatives with the pinned candidate: each is the existing refusal and writes no safe recovery.
  for (const [name, source, table] of [
    ['target-value', "c.execute('update velocity_settings set login_ratelimit=2999')", 'velocity_settings'],
    ['other-field', "c.execute('update velocity_settings set login_ratelimit=0,read_timeout=3000')", 'velocity_settings'],
    ['other-table', "c.execute('update velocity_settings_shadow set compression_threshold=256,compression_level=-1,login_ratelimit=3000')", 'velocity_settings_shadow'],
    ['same-row-column', "c.execute(\"update velocity_settings set motd='changed by the candidate'\")", 'velocity_settings'],
  ]) {
    const variant = path.join(root, 'derived-' + name); fs.cpSync(migrated, variant, { recursive: true }); sqliteWrite(path.join(variant, 'backend/pb_data/data.db'), source);
    assert.throws(() => createSafeRecovery(backup, variant, bundle, revision, identities), derivedRefusal(table), name);
    assert.equal(fs.existsSync(path.join(backup, 'safe-recovery')), false, name + ' wrote no safe recovery');
  }
  // The same derived data with a candidate whose migration bytes differ or are missing.
  for (const [name, change] of [['digest', file => fs.appendFileSync(file, '\n// altered bytes, same effect\n')], ['missing', file => fs.rmSync(file)]]) {
    const candidate = path.join(root, 'bundle-' + name); fs.cpSync(bundle, candidate, { recursive: true, verbatimSymlinks: true });
    change(path.join(candidate, 'backend/pb_migrations', placeholderMigration)); release(candidate);
    const separate = sealed('backup-' + name);
    assert.throws(() => createSafeRecovery(separate, migrated, candidate, revision, identities), derivedRefusal('velocity_settings'), name);
    assert.equal(fs.existsSync(path.join(separate, 'safe-recovery')), false, name + ' wrote no safe recovery');
  }
  // Positive: the pinned transition derives a safe recovery and verifies again on restore.
  const safe = createSafeRecovery(backup, migrated, bundle, revision, identities);
  const restored = path.join(root, 'safe-restored'), proof = restoreSafeRecovery(safe, restored, revision);
  assert.equal(proof.oldDaemonStarted, false); assert.deepEqual(velocityRows(restored), derived);
  // The restore side applies the same gate to the sealed candidate files of the safe recovery.
  for (const [name, change] of [
    ['target-value', application => sqliteWrite(path.join(application, 'backend/pb_data/data.db'), "c.execute('update velocity_settings set login_ratelimit=2999')")],
    ['digest', application => fs.appendFileSync(path.join(application, 'backend/pb_migrations', placeholderMigration), '\n// altered bytes, same effect\n')],
    ['missing', application => fs.rmSync(path.join(application, 'backend/pb_migrations', placeholderMigration))],
  ]) {
    const copy = path.join(root, 'forged-' + name);
    fs.cpSync(backup, copy, { recursive: true, verbatimSymlinks: true, filter: source => source !== path.join(backup, 'candidate-contract-rehearsal') });
    const forged = path.join(copy, 'safe-recovery'); change(path.join(forged, 'application'));
    const manifest = JSON.parse(fs.readFileSync(path.join(forged, 'backup.json')));
    manifest.application = inventory(path.join(forged, 'application'), manifest.present);
    manifest.candidateFiles = manifest.application.filter(item => !item.path.startsWith('backend/pb_data') && item.path !== 'backend/pocketbase');
    manifest.snapshotId = snapshotIdentity(manifest);
    manifest.recoveryId = createHash('sha256').update(JSON.stringify({ snapshotId: manifest.snapshotId, sourceSnapshotId: manifest.sourceSnapshotId, identities: manifest.identities, candidateFiles: manifest.candidateFiles })).digest('hex');
    fs.writeFileSync(path.join(forged, 'backup.json'), JSON.stringify(manifest));
    const expectationFile = path.join(copy, 'expected-recovery-contract.json'), expectation = JSON.parse(fs.readFileSync(expectationFile));
    expectation.candidateFiles = manifest.candidateFiles; fs.writeFileSync(expectationFile, JSON.stringify(expectation));
    const destination = path.join(root, 'forged-restored-' + name);
    assert.throws(() => restoreSafeRecovery(forged, destination, revision), derivedRefusal('velocity_settings'), name);
    assert.equal(fs.existsSync(destination), false, name + ' restored nothing');
  }
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
    const initial=f.createAdapter().backup();const raw=JSON.parse(fs.readFileSync(path.join(initial,'backup.json')));raw.revision=null;raw.retainedHistory=[{path:extra,sha256:createHash('sha256').update(bytes).digest('hex'),mode:0o644}];raw.sourceAbsentHistory=absent;raw.snapshotId=snapshotIdentity(raw);fs.writeFileSync(path.join(initial,'backup.json'),JSON.stringify(raw));
    f.config.baseline={kind:'mixed',sourceRevision:null,snapshotId:raw.snapshotId,snapshotDirectory:initial,retainedHistory:raw.retainedHistory,sourceAbsentHistory:absent};delete f.config.previousRevision;
    f.adapter.verify();f.adapter.assertCurrent();
    const backup=f.adapter.backup();assert.equal(verifySnapshot(backup,f.config.baseline).snapshotId,raw.snapshotId);
    f.adapter.rehearse(backup);f.adapter.baseline(backup);f.adapter.install();
    assert.deepEqual(fs.readFileSync(path.join(f.webRoot,extra)),bytes);assert.equal(fs.readFileSync(path.join(f.webRoot,'backend/.env'),'utf8'),'retained environment');
    f.adapter.record({status:'deployed',revision,runNumber:2,backup});const state=JSON.parse(fs.readFileSync(f.state));assert.equal(state.baseline,raw.snapshotId);assert.equal(state.candidateManifest.revision,revision);assert.deepEqual(state.retainedHistory,raw.retainedHistory);
    // Unknown ledger fails preflight without service commands or application replacement.
    raw.contract['data.db'].migrations.push(['unknown-applied.js',1]);raw.snapshotId=snapshotIdentity(raw);fs.writeFileSync(path.join(initial,'backup.json'),JSON.stringify(raw));f.config.baseline.snapshotId=raw.snapshotId;assert.throws(()=>productionAdapter(f.bundle,f.config,revision,state.runNumber+1,f.configFile).verify(),/contract drift|Target changed/);
  } finally {
    cp.execFileSync=commandOverride;syncBuiltinESMExports();
    await pb.close(); // INC-006 CC-4: idempotent; also removes the PB fixture directory
  }
}));

// Retained independent acceptance fixtures now exercise the fixed production
// entry, both PB versions, and the actual users authentication/API boundary.
test('safe recovery and deployment validate actual contracts, unlisted roles and target authentication on both PB versions', {skip: !process.env.PB_RETAINED_HISTORY_FILE}, async t => {
const evidence = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hololive-adapter-'))), project = projectRoot;
// INC-006 CC-4: the probes stay readable until the test ends, then leave with the run sandbox rules.
if (!retainFixtures) t.after(() => removeFixture(evidence));
const candidate = revision;
const extra = 'backend/pb_migrations/1765100008_add_velocity_advanced.js';
const absent = ['1770817921_updated_users.js', '1770818121_updated_users.js', '1770818775_updated_users.js'];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const root = fs.realpathSync(fs.mkdtempSync(path.join(evidence, 'independent-')));
const observations = [];
// Coverage is separate from passed product observations: plain CI cannot prove
// installed guard registration/refusal behavior.
const guardCoverage = ['fixture-close-shared-success','fixture-close-first-rejection'].map(id=>({id,status:'unverified',reason:'actual configured guard case has not completed'}));
let lifecycleContext;
const mkdir = file => fs.mkdirSync(file, { recursive: true, mode: 0o700 });
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
const rawExec = cp.execFileSync;
function copyWithModes(from,to,options) {
  fs.cpSync(from,to,{...options,mode:(options?.mode??0)|fs.constants.COPYFILE_FICLONE});
  const preserve=(source,target)=>{const info=fs.lstatSync(source);if(info.isSymbolicLink())return;fs.chmodSync(target,info.mode&0o777);if(info.isDirectory())for(const name of fs.readdirSync(source))preserve(path.join(source,name),path.join(target,name));};
  preserve(from,to);
}

// Exercise a real local child in the actual plain or configured context. In
// configured mode the adapter changes only this probe's first cleanup purpose;
// the installed guard decides owner and active-group refusals itself.
async function closeOutcomeCases() {
  const guard=process.env.TCRN_SPAWN_GUARD,owner=process.env.TCRN_TASK_OWNER,registry=process.env.TCRN_SPAWN_REGISTRY;
  lifecycleContext=guardContext(process.env);
  if(lifecycleContext.mode==='invalid') {
    for(const row of guardCoverage)row.reason='partial or empty guard bindings: invalid/not-verifiable';
    write(path.join(evidence,'probes-003.json'),{candidate,root,production:false,lifecycleContext,guardCoverage,observations});
    assert.fail('Lifecycle guard context invalid/not-verifiable; missing: '+lifecycleContext.missing.join(',')+'; unusable: '+lifecycleContext.unusable.join(','));
  }
  if(lifecycleContext.mode==='plain') {
    for(const row of guardCoverage)row.reason='all guard bindings absent; outside plain CI coverage and passed guard counts';
    let service;
    try {
      service=await startOwned(process.execPath,['-e','setInterval(()=>{},1000)']);ownedChildren.push(service.child);
      assert.ok(service.child.spawnfile&&service.child.pid!==undefined,'local child did not spawn');
      const first=service.close(),concurrent=service.close();assert.equal(first,concurrent);
      const results=await Promise.allSettled([first,concurrent]);
      assert.deepEqual(results,[{status:'fulfilled',value:undefined},{status:'fulfilled',value:undefined}]);
      assert.ok(service.child.exitCode!==null||service.child.signalCode!==null);
      const serial=service.close();assert.equal(serial,first);await serial;
      observe('fixture-close-plain-shared-success','actual unguarded child shares concurrent and serial close result and is terminal',{passed:true,guardCoverage:'unverified'});
    } finally {if(service)await service.close();}
    return;
  }
  write(path.join(evidence,'probes-003.json'),{candidate,root,production:false,lifecycleContext,guardCoverage,observations});
  const rawSpawn=cp.spawnSync;
  for(const failCleanup of [false,true]) {
    let service,registrations=0,deregistrations=0,cleanupRefused=false;
    cp.spawnSync=(command,args,options)=>{
      if(command===process.execPath&&args[0]===guard) {
        if(args[1]==='register')registrations++;
        if(args[1]==='deregister') {
          deregistrations++;
          if(failCleanup){args=[...args];args[args.indexOf('--purpose')+1]=owner+'-foreign-close-probe';}
        }
      }
      return rawSpawn(command,args,options);
    };syncBuiltinESMExports();
    try {
      service=await startOwned(process.execPath,['-e','setInterval(()=>{},1000)']);ownedChildren.push(service.child);
      if(!service.child.spawnfile||service.child.pid===undefined)throw new Error('local child did not spawn');
      // A real active owned group must remain registered after a refused removal.
      const guardArgs=[guard,'deregister','--registry',registry,'--pgid',String(service.child.pid),'--purpose',owner];
      const active=rawSpawn(process.execPath,guardArgs,{encoding:'utf8'});
      assert.notEqual(active.status,0);assert.match(active.stderr,/SPAWN_GUARD_OWNED_GROUP_STILL_ACTIVE/);
      const first=service.close(),concurrent=service.close();assert.equal(first,concurrent);
      const results=await Promise.allSettled([first,concurrent]);
      assert.equal(registrations,1);assert.equal(deregistrations,1);
      assert.ok(service.child.exitCode!==null||service.child.signalCode!==null);
      const serial=service.close();assert.equal(serial,first);
      if(failCleanup) {
        cleanupRefused=true;
        assert.equal(results[0].status,'rejected');assert.equal(results[1].status,'rejected');
        assert.equal(results[0].reason,results[1].reason);assert.match(results[0].reason.message,/SPAWN_GUARD_OWNER_MISMATCH/);
        await assert.rejects(serial,error=>error===results[0].reason);
      } else {
        assert.deepEqual(results,[{status:'fulfilled',value:undefined},{status:'fulfilled',value:undefined}]);await serial;
      }
      assert.equal(deregistrations,1);
      observe('fixture-close-'+(failCleanup?'first-rejection':'shared-success'),'actual child shares concurrent and serial close outcome; one helper cleanup; strict active/owner refusals',{passed:true});
    } finally {
      try {
        if(service) {
          const result=await Promise.allSettled([service.close()]);
          // The intentional foreign-purpose refusal leaves the real owner's
          // registration intact. Recover only this terminal probe's exact group.
          if(failCleanup&&result[0].status==='rejected') {
            assert.ok(service.child.exitCode!==null||service.child.signalCode!==null,'exact-owner cleanup requires the probe child to be terminal');
            const cleanup=rawSpawn(process.execPath,[guard,'deregister','--registry',registry,'--pgid',String(service.child.pid),'--purpose',owner],{encoding:'utf8'});
            assert.equal(cleanup.status,0,cleanup.stderr||cleanup.stdout);
          } else if(result[0].status==='rejected')throw result[0].reason;
        }
      } finally {cp.spawnSync=rawSpawn;syncBuiltinESMExports();}
    }
    if(failCleanup)assert.equal(cleanupRefused,true);
    guardCoverage[failCleanup?1:0]={id:'fixture-close-'+(failCleanup?'first-rejection':'shared-success'),status:'verified',reason:'actual configured guard case and terminal cleanup completed'};
    write(path.join(evidence,'probes-003.json'),{candidate,root,production:false,lifecycleContext,guardCoverage,observations});
  }
}
const originals={readFileSync:fs.readFileSync,statSync:fs.statSync,lstatSync:fs.lstatSync,existsSync:fs.existsSync,realpathSync:fs.realpathSync,cpSync:fs.cpSync};
const environment={...process.env}, forwardOutputs=[], ownedChildren=[];
const ownedFilesystem={root,removed:false,retainedForwardOutputs:[],errors:[]};
let bound, primaryError, closeoutError;
function observe(id,expected,details){observations.push({id,expected,...details});write(path.join(evidence,'probes-003.json'),{candidate,root,production:false,lifecycleContext,guardCoverage,observations});}
try {
await closeOutcomeCases();

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
async function fixture(version,binary, suffix = '') {
  const local=path.join(root,'PB'+version+suffix);mkdir(local);
  const webRoot=path.join(local,'site');mkdir(webRoot);
  copyWithModes(bundle,webRoot,{recursive:true,verbatimSymlinks:true});
  // Exact pre-upgrade application migration inventory; hooks were absent on the
  // observed target. Synthetic records are created through real PB APIs.
  for(const name of names.filter(x=>!beforeNames.includes(x)))fs.unlinkSync(path.join(webRoot,'backend/pb_migrations',name));
  fs.renameSync(path.join(webRoot,'backend/pb_hooks'),path.join(local,'uninstalled-candidate-hooks'));
  fs.copyFileSync(binary,path.join(webRoot,'backend/pocketbase'),fs.constants.COPYFILE_FICLONE);
  const common=['--dir',path.join(webRoot,'backend/pb_data'),'--migrationsDir',path.join(webRoot,'backend/pb_migrations'),'--hooksDir',path.join(local,'uninstalled-candidate-hooks')];
  const migration=rawExec(binary,['migrate','up',...common],{encoding:'utf8'});assert.doesNotMatch(migration,/Failed|Error:/);
  rawExec(binary,['superuser','upsert','probe@example.invalid','Disposable-Only-2026!',...common],{encoding:'utf8'});
  const port=await unusedPort(),base='http://127.0.0.1:'+port;
  const service=await startOwned(binary,['serve','--automigrate=false','--http','127.0.0.1:'+port,...common]);ownedChildren.push(service.child);
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
  const config={approvedRevision:candidate,repository:'fixture/acceptance006',webRoot,backupRoot:path.join(local,'backup'),stateRoot:path.join(local,'state'),velocityRoot:path.join(local,'velocity'),pocketbaseVersion:version,machineIdSha256:sha('isolated machine'),runnerUser:os.userInfo().username,websiteServices:['pocketbase','velocity-sync'],serviceBindings:{pocketbase:fixtureService(webRoot+'/backend','pocketbase'), 'velocity-sync':fixtureService(webRoot+'/backend/scripts')},velocityServiceBinding:'Requires=\nBindsTo=\nPartOf=',protectedVelocityFiles:['velocity.toml','velocity.jar','forwarding.secret'],velocityPorts:[25565],configurationFiles:configFiles,nginxSiteFile:configFiles[2],pocketbaseHealthUrl:base+'/api/health',baselineReviewed:true,serviceIdentityReviewed:true,restoreRehearsalRequired:true,recoveryIdentities:identities,previousRevision:'b'.repeat(40)};
  const configFile=path.join(local,'config.json');write(configFile,config);
  const work=path.join(local,'approved-working');mkdir(path.join(work,'backend'));
  copyWithModes(path.join(webRoot,'backend/pb_data'),path.join(work,'backend/pb_data'),{recursive:true});
  const forward=rawExec(binary,['migrate','up','--dir',path.join(work,'backend/pb_data'),'--migrationsDir',path.join(bundle,'backend/pb_migrations'),'--hooksDir',path.join(bundle,'backend/pb_hooks')],{encoding:'utf8'});assert.doesNotMatch(forward,/Failed|Error:/);fs.writeFileSync(path.join(local,'actual-forward.stdout'),forward,{mode:0o600});forwardOutputs.push(path.join(local,'actual-forward.stdout'));
  sql(path.join(work,'backend/pb_data/data.db'),"import sqlite3,sys,json;c=sqlite3.connect(sys.argv[1]);[c.execute('update users set is_admin=1,service_account=? where id=?',(int(i['role']=='service'),i['id'])) for i in json.loads(sys.argv[2])];c.commit()",[JSON.stringify(identities)]);
  config.recoveryWorkingCopy=work;
  config.finiteStop={syncCodeSha256:sha(fs.readFileSync(path.join(webRoot,'backend/scripts/sync_velocity.js')))};write(configFile,config);
  return {local,webRoot,config,configFile,configMap,identities,ordinary,post,settings,base,binary,commands:[],running:null};
}

fs.readFileSync=(file,...args)=>file==='/etc/machine-id'?Buffer.from('isolated machine'):originals.readFileSync(bound?.configMap.get(file)??file,...args);
fs.statSync=(file,...args)=>{const s=originals.statSync(bound?.configMap.get(file)??file,...args);return file===bound?.configFile?new Proxy(s,{get:(s,k)=>k==='uid'?0:Reflect.get(s,k)}):s;};
fs.realpathSync=(file,...args)=>bound?.configMap.has(file)?file:originals.realpathSync(file,...args);
fs.existsSync=(file)=>originals.existsSync(bound?.configMap.get(file)??file);
fs.lstatSync=(file,...args)=>originals.lstatSync(bound?.configMap.get(file)??file,...args);
fs.cpSync=(from,to,options)=>originals.cpSync(bound?.configMap.get(from)??from,to,{...options,mode:(options?.mode??0)|fs.constants.COPYFILE_FICLONE});
cp.execFileSync=(file,args,options)=>{
  if(file==='sudo'&&args[1]==='/usr/bin/python3') return finiteHostResponse(JSON.parse(options.input), {root:bound.local,commands:bound.commands,fail:bound.finiteFailure});
  bound.commands.push({file,args});
  if(file==='python3'||file===bound.binary||file===path.join(bound.webRoot,'backend/pocketbase'))return rawExec(file,args,options);
  if(file==='git'&&args[0]==='ls-remote')return candidate+'\trefs/heads/main\n';
  if(file==='systemctl'&&args[0]==='is-active')return 'active\n';
  if(file==='systemctl'&&args[0]==='show')return (args[1]==='velocity'&&args.includes('MainPID')?'MainPID=100\nExecMainStartTimestampMonotonic=123\nNRestarts=0\nActiveState=active':args[1]==='velocity'?(args.includes('ExecStart')?fixtureService(bound.config.velocityRoot,'velocity'):bound.config.velocityServiceBinding):bound.config.serviceBindings[args[1]])+'\n';
  if(file==='ss')return 'LISTEN 0 100 127.0.0.1:25565 0.0.0.0:*\n';
  if(file==='sudo'&&args[1]==='systemctl'){
    if(args[2]==='start'&&args[3]==='pocketbase')bound.running=startOwned(bound.binary,['serve','--automigrate=false','--http',new URL(bound.base).host,'--dir',path.join(bound.webRoot,'backend/pb_data'),'--migrationsDir',path.join(bound.webRoot,'backend/pb_migrations'),'--hooksDir',path.join(bound.webRoot,'backend/pb_hooks')]).then(service=>{ownedChildren.push(service.child);return service;});
    return '';
  }
  throw new Error('Unapproved external command refused: '+file);
};syncBuiltinESMExports();
Object.assign(process.env,{GITHUB_REPOSITORY:'fixture/acceptance006',GITHUB_RUN_ID:'6006',GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_SERVER_URL:'https://github.com'});
const adapter=(run=6)=>{
  const domain=bound;write(domain.configFile,domain.config);
  const actual=productionAdapter(bundle,domain.config,candidate,run,domain.configFile), stop=actual.stop;
  actual.stop=async unit=>{await stop(unit);if(unit==='pocketbase'&&domain.running){const service=await domain.running;await service.close();domain.running=null;}};
  return actual;
};
function initializeBaseline(){delete bound.config.baseline;bound.config.previousRevision=oldRevision;const initial=adapter().backup();const m=read(path.join(initial,'backup.json'));m.revision=null;m.retainedHistory=[{path:extra,sha256:sha(retainedBytes),mode:0o644}];m.sourceAbsentHistory=absent;m.snapshotId=snapshotIdentity(m);write(path.join(initial,'backup.json'),m);bound.config.baseline={kind:'mixed',sourceRevision:null,snapshotId:m.snapshotId,snapshotDirectory:initial,retainedHistory:m.retainedHistory,sourceAbsentHistory:absent};delete bound.config.previousRevision;return initial;}
const attempt=async callback=>{try{return {accepted:true,value:await callback()};}catch(error){return {accepted:false,error:error.message};}};
  // Keep these copies inside the original independent fixture root. Mutating a
  // destination must not alter its source or sibling, including chmod and links.
  const copyRoot=path.join(root,'copy-independence'),source=path.join(copyRoot,'source');mkdir(source);
  const originalBytes=Buffer.from('independent fixture bytes\n'),stamp=new Date('2020-01-02T03:04:05Z');
  fs.writeFileSync(path.join(source,'regular'),originalBytes,{mode:0o640});fs.utimesSync(path.join(source,'regular'),stamp,stamp);
  fs.writeFileSync(path.join(source,'filtered'),'filter must survive unchanged',{mode:0o600});
  fs.symlinkSync('regular',path.join(source,'link'));
  const left=path.join(copyRoot,'left'),right=path.join(copyRoot,'right'),scoped=path.join(copyRoot,'scoped');
  const options={recursive:true,preserveTimestamps:true,dereference:false,verbatimSymlinks:true,mode:fs.constants.COPYFILE_EXCL};
  copyWithModes(source,left,options);copyWithModes(source,right,options);
  fs.cpSync(source,scoped,{...options,filter:file=>path.basename(file)!=='filtered'});
  assert.equal(fs.existsSync(path.join(scoped,'filtered')),false);
  for(const destination of [left,right,scoped]) {
    const file=path.join(destination,'regular'),info=fs.lstatSync(file);
    assert.equal(info.isFile(),true);assert.deepEqual(fs.readFileSync(file),originalBytes);assert.equal(info.mode&0o777,0o640);
    assert.equal(info.mtimeMs,fs.statSync(path.join(source,'regular')).mtimeMs);
    assert.equal(fs.lstatSync(path.join(destination,'link')).isSymbolicLink(),true);assert.equal(fs.readlinkSync(path.join(destination,'link')),'regular');
    assert.notEqual(info.ino,fs.statSync(path.join(source,'regular')).ino);
  }
  fs.writeFileSync(path.join(left,'regular'),'destination changed');fs.chmodSync(path.join(left,'regular'),0o600);fs.unlinkSync(path.join(left,'link'));fs.symlinkSync('filtered',path.join(left,'link'));
  for(const untouched of [source,right,scoped]) {
    assert.deepEqual(fs.readFileSync(path.join(untouched,'regular')),originalBytes);assert.equal(fs.statSync(path.join(untouched,'regular')).mode&0o777,0o640);
    assert.equal(fs.readlinkSync(path.join(untouched,'link')),'regular');
  }
  fs.cpSync(path.join(left,'regular'),path.join(right,'regular'),{force:false});assert.deepEqual(fs.readFileSync(path.join(right,'regular')),originalBytes);
  assert.throws(()=>fs.cpSync(path.join(left,'regular'),path.join(right,'regular'),{force:false,errorOnExist:true}),error=>error.code==='ERR_FS_CP_EEXIST');
  observe('fixture-independent-copies','complete regular independent copies retain bytes/modes/timestamps/links, supplied mode, filter and overwrite refusal',{passed:true});
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
    const roleDomain=bound;
    const retainFailureDomain=domain=>{
      const record=read(path.join(domain.config.stateRoot,'deployment.json'));
      const names=['backup.json','expected-recovery-contract.json','safe-recovery/backup.json'];
      const files=[...names.map(name=>path.join(record.backup,name)),...['velocity','velocity-sync'].map(unit=>path.join(domain.local,'runtime',unit+'.service.d','99-hololive-release-guard.conf'))];
      return files.map(file=>({file,bytes:fs.readFileSync(file),mode:fs.lstatSync(file).mode,ino:fs.lstatSync(file).ino}));
    };
    const unchangedFailureDomain=entries=>{for(const entry of entries){assert.deepEqual(fs.readFileSync(entry.file),entry.bytes);assert.equal(fs.lstatSync(entry.file).mode,entry.mode);assert.equal(fs.lstatSync(entry.file).ino,entry.ino);}};
    const roleRetained=retainFailureDomain(roleDomain);
    const roleFailedBytes=fs.readFileSync(path.join(roleDomain.config.stateRoot,'deployment.json'));
    const roleGuardBytes=fs.readFileSync(path.join(roleDomain.webRoot,'backend/.velocity-maintenance'));
    const roleRetry=await attempt(()=>deploy(adapter(7),bound.config,candidate,7));
    assert.equal(roleRetry.accepted,false,roleRetry.error);
    assert.deepEqual(fs.readFileSync(path.join(roleDomain.config.stateRoot,'deployment.json')),roleFailedBytes);
    assert.deepEqual(fs.readFileSync(path.join(roleDomain.webRoot,'backend/.velocity-maintenance')),roleGuardBytes);
    unchangedFailureDomain(roleRetained);
    bound=await fixture(version,binary,'-auth-failure');
    // This domain's own approved working copy supplies its role-bearing data.
    const prepareAuthenticatedDomain=()=>{
      fs.rmSync(path.join(bound.webRoot,'backend/pb_data'),{recursive:true});
      copyWithModes(path.join(bound.config.recoveryWorkingCopy,'backend/pb_data'),path.join(bound.webRoot,'backend/pb_data'),{recursive:true});
      bound.config.targetAuthentication=bound.identities.map(item=>({...item,identity:item.role+'@example.invalid',passwordEnv:'DISPOSABLE_TARGET_PASSWORD',...(item.role==='service'?{services:['velocity-sync']}: {})}));
      initializeBaseline();bound.commands=[];
    };
    prepareAuthenticatedDomain();
    process.env.DISPOSABLE_TARGET_PASSWORD='incorrect disposable password';
    const authFailure=await attempt(()=>deploy(adapter(),bound.config,candidate,6));
    assert.equal(authFailure.accepted,false,authFailure.error);
    assert.match(authFailure.error,/Target authentication failed/);
    assert.equal(bound.commands.some(c=>c.file==='sudo'&&c.args[2]==='start'&&c.args[3]==='velocity-sync'),false);
    assert.equal(read(path.join(bound.config.stateRoot,'deployment.json')).status,'failed');
    if(bound.running){const service=await bound.running;await service.close();bound.running=null;}
    const authDomain=bound, authFailedBytes=fs.readFileSync(path.join(bound.config.stateRoot,'deployment.json'));
    const authRetained=retainFailureDomain(authDomain);
    const authGuardBytes=fs.readFileSync(path.join(bound.webRoot,'backend/.velocity-maintenance'));
    const authRetry=await attempt(()=>deploy(adapter(7),bound.config,candidate,7));
    assert.equal(authRetry.accepted,false,authRetry.error);
    assert.deepEqual(fs.readFileSync(path.join(authDomain.config.stateRoot,'deployment.json')),authFailedBytes);
    assert.deepEqual(fs.readFileSync(path.join(authDomain.webRoot,'backend/.velocity-maintenance')),authGuardBytes);
    unchangedFailureDomain(authRetained);
    bound=await fixture(version,binary,'-success');prepareAuthenticatedDomain();
    process.env.DISPOSABLE_TARGET_PASSWORD='Disposable-Only-2026!';
    const safeRestore=bound.config.recoveryWorkingCopy, successBeforeInventory=inventory(bound.config.velocityRoot,bound.config.protectedVelocityFiles);
    const success=await deploy(adapter(),bound.config,candidate,6);
    assert.equal(success.status,'deployed');
    for(const unit of ['velocity','velocity-sync'])assert.equal(fs.existsSync(path.join(bound.local,'runtime',unit+'.service.d')),false);
    unchangedFailureDomain(roleRetained);unchangedFailureDomain(authRetained);
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
    assert.deepEqual(inventory(bound.config.velocityRoot,bound.config.protectedVelocityFiles),successBeforeInventory);
    if(bound.running){const service=await bound.running;await service.close();bound.running=null;}
    // Existing authorization fields cannot make an unlisted promotion acceptable.
    bound.config.stateRoot=path.join(bound.local,'existing-state');mkdir(bound.config.stateRoot);fs.rmSync(path.join(bound.webRoot,'backend/pb_data'),{recursive:true});copyWithModes(path.join(safeRestore,'backend/pb_data'),path.join(bound.webRoot,'backend/pb_data'),{recursive:true});initializeBaseline();
    const existing=path.join(bound.local,'existing-promoted');copyWithModes(bound.config.recoveryWorkingCopy,existing,{recursive:true});
    sql(path.join(existing,'backend/pb_data/data.db'),"import sqlite3,sys;c=sqlite3.connect(sys.argv[1]);c.execute('update users set is_admin=1 where id=?',(sys.argv[2],));c.commit()",[bound.ordinary.id]);
    bound.config.recoveryWorkingCopy=existing;result=await attempt(()=>adapter().rehearse(newBackup()));assert.equal(result.accepted,false,result.error);assert.match(result.error,/Unapproved role change/);
    sql(path.join(existing,'backend/pb_data/data.db'),"import sqlite3,sys;c=sqlite3.connect(sys.argv[1]);c.execute('update users set is_admin=0,service_account=1 where id=?',(sys.argv[2],));c.commit()",[bound.ordinary.id]);result=await attempt(()=>adapter().rehearse(newBackup()));assert.equal(result.accepted,false,result.error);assert.match(result.error,/Unapproved role change/);
    observe('P06-authentication-'+version,'actual target rejects credentials then admits valid identities',{passed:true});
  }
  // Fresh first capture never initializes a prior snapshot. Every scenario has
  // its own actual PB database, permission, state and private evidence root.
  for (const [version,binary] of binaries) for (const scenario of ['preflight-history','preflight-bytes','preflight-unknown','preflight-mode','preflight-retained-unapplied','preflight-unknown-ledger','preflight-placeholder','seal-failure','rehearsal-failure','binding-drift','install-drift','poststop-ledger','poststop-migration-bytes','poststop-migration-mode','poststop-config-bytes','poststop-config-mode','poststop-config-owner','backup-component','backup-db','backup-media','backup-config','backup-config-mode','backup-config-owner','backup-seal-write','snapshot-raw','snapshot-config','snapshot-component','cleanup-guard','cleanup-code','cleanup-unit','cleanup-file','cleanup-job','cleanup-java','cleanup-leaf','cleanup-run','cleanup-readback','first-success','full-success']) {
    bound=await fixture(version,binary,'-'+scenario);
    const domain=bound;
    try {
    bound.config.baseline={kind:'mixed',capture:'stopped-backup',sourceRevision:null,retainedHistory:[{path:extra,sha256:sha(retainedBytes),mode:0o644}],sourceAbsentHistory:absent};
    delete bound.config.previousRevision;
    const javaBefore=inventory(bound.config.velocityRoot,bound.config.protectedVelocityFiles);
    if(scenario==='preflight-mode')fs.chmodSync(path.join(bound.webRoot,extra),0o600);
    if(scenario==='preflight-retained-unapplied')sql(path.join(bound.webRoot,'backend/pb_data/data.db'),"import sqlite3,sys;c=sqlite3.connect(sys.argv[1]);c.execute('delete from _migrations where file=?',(sys.argv[2],));c.commit()",[path.basename(extra)]);
    if(scenario==='preflight-unknown-ledger')sql(path.join(bound.webRoot,'backend/pb_data/data.db'),"import sqlite3,sys;c=sqlite3.connect(sys.argv[1]);c.execute('insert into _migrations(file,applied) values (?,1)',('unknown_actual.js',));c.commit()");
    if(scenario==='preflight-placeholder')fs.writeFileSync(path.join(bound.webRoot,'backend/pb_migrations',absent[0]),'invented placeholder');
    if(scenario.startsWith('preflight-')) {
      if(scenario==='preflight-bytes')fs.writeFileSync(path.join(bound.webRoot,extra),'changed retained bytes');
      else if(scenario==='preflight-unknown')fs.writeFileSync(path.join(bound.webRoot,'backend/pb_migrations/unknown.js'),'unknown source');
      else if(scenario==='preflight-history')sql(path.join(bound.webRoot,'backend/pb_data/data.db'),"import sqlite3,sys;c=sqlite3.connect(sys.argv[1]);c.execute('delete from _migrations where file=?',(sys.argv[2],));c.commit()",[absent[0]]);
      const result=await attempt(()=>deploy(adapter(),bound.config,candidate,6));assert.equal(result.accepted,false);assert.match(result.error,/Source-absent ledger|Unknown or modified|Retained snapshot bytes|Retained migration is not applied|Unknown applied historical/);
      assert.equal(bound.commands.some(c=>c.file==='sudo'),false);assert.equal(fs.existsSync(path.join(bound.webRoot,'backend/.velocity-maintenance')),false);
      assert.deepEqual(fs.readdirSync(bound.config.backupRoot),[]);assert.equal(fs.existsSync(path.join(bound.config.stateRoot,'deployment.json')),false);
    } else {
      const successful=scenario==='first-success'||scenario==='full-success';
      if(successful||scenario.startsWith('cleanup-')) {
        // A separately prepared synthetic source already has approved roles.
        // This does not grant production users or make a pre-stop snapshot.
        fs.rmSync(path.join(bound.webRoot,'backend/pb_data'),{recursive:true});copyWithModes(path.join(bound.config.recoveryWorkingCopy,'backend/pb_data'),path.join(bound.webRoot,'backend/pb_data'),{recursive:true});
        bound.config.targetAuthentication=bound.identities.map(item=>({...item,identity:item.role+'@example.invalid',passwordEnv:'DISPOSABLE_TARGET_PASSWORD',...(item.role==='service'?{services:['velocity-sync']}:{})}));
        process.env.DISPOSABLE_TARGET_PASSWORD='Disposable-Only-2026!';
      }
      if(scenario==='full-success') {
        fs.unlinkSync(path.join(bound.webRoot,extra));sql(path.join(bound.webRoot,'backend/pb_data/data.db'),"import sqlite3,sys,json;c=sqlite3.connect(sys.argv[1]);[c.execute('delete from _migrations where file=?',(f,)) for f in json.loads(sys.argv[2])];c.commit()",[JSON.stringify([path.basename(extra),...absent])]);
        delete bound.config.baseline;bound.config.previousRevision=oldRevision;delete bound.config.recoveryWorkingCopy;
      }
      if(scenario.startsWith('cleanup-')&&!['cleanup-leaf','cleanup-run'].includes(scenario))bound.finiteFailure=scenario;
      if(scenario==='rehearsal-failure')bound.config.recoveryWorkingCopy=bound.webRoot;
      const actual=adapter(), originalBaseline=actual.baseline, originalBackup=actual.backup;
      if(['cleanup-leaf','cleanup-run'].includes(scenario)){const originalHealth=actual.health;actual.health=async()=>{await originalHealth();if(scenario==='cleanup-run')process.env.GITHUB_RUN_ID='different-run';else {const leaf=path.join(bound.local,'runtime/velocity-sync.service.d/99-hololive-release-guard.conf');const old=fs.readFileSync(leaf);fs.renameSync(leaf,leaf+'.foreign');fs.writeFileSync(leaf,old);}};}
      const originalVerify=actual.verify;
      actual.verify=()=>{originalVerify();
        if(scenario==='poststop-ledger')sql(path.join(bound.webRoot,'backend/pb_data/data.db'),"import sqlite3,sys;c=sqlite3.connect(sys.argv[1]);c.execute('update _migrations set applied=applied+1 where file=?',(sys.argv[2],));c.commit()",[path.basename(extra)]);
        if(scenario==='poststop-migration-bytes')fs.appendFileSync(path.join(bound.webRoot,extra),'\n// unexpected');
        if(scenario==='poststop-migration-mode')fs.chmodSync(path.join(bound.webRoot,extra),0o600);
        if(scenario==='poststop-config-bytes')fs.appendFileSync(bound.configMap.get(bound.config.nginxSiteFile),'drift');
        if(scenario==='poststop-config-mode')fs.chmodSync(bound.configMap.get(bound.config.nginxSiteFile),0o640);
        if(scenario==='poststop-config-owner'){const previous=fs.lstatSync;fs.lstatSync=(file,...args)=>{const value=previous(file,...args);return file===bound.config.nginxSiteFile?new Proxy(value,{get:(v,k)=>k==='uid'?v.uid+1:Reflect.get(v,k)}):value;};}
      };
      actual.backup=()=>{const stops=bound.commands.filter(c=>c.file==='sudo'&&c.args[2]==='stop').map(c=>c.args[3]);assert.deepEqual(stops,['velocity-sync','pocketbase']);assert.equal(fs.existsSync(path.join(bound.webRoot,'backend/.velocity-maintenance')),true);const originalCopy=fs.cpSync, originalWrite=fs.writeFileSync, originalChmod=fs.chmodSync;
        fs.cpSync=(from,to,...args)=>{const result=originalCopy(from,to,...args);
          if(scenario==='backup-component'&&to.endsWith('/application/dist'))fs.rmSync(to,{recursive:true});
          if(scenario==='backup-db'&&to.endsWith('/application/backend/pb_data'))fs.unlinkSync(path.join(to,'data.db'));
          if(scenario==='backup-media'&&to.endsWith('/application/backend/pb_data'))fs.rmSync(path.join(to,'storage'),{recursive:true,force:true});
          if(to.includes('/configuration/')&&path.basename(to)===path.basename(bound.config.nginxSiteFile)){
            if(scenario==='backup-config')fs.appendFileSync(to,'corrupt copied bytes');
            if(scenario==='backup-config-mode')fs.chmodSync(to,0o640);
          }
          if(scenario==='backup-config-owner'&&to.includes('/configuration/')){const prior=fs.lstatSync;fs.lstatSync=(file,...a)=>{const value=prior(file,...a);return file===bound.config.nginxSiteFile?new Proxy(value,{get:(v,k)=>k==='uid'?v.uid+1:Reflect.get(v,k)}):value;};}
          return result;
        };
        fs.chmodSync=(file,mode)=>originalChmod(file,scenario==='backup-config-mode'&&String(file).includes('/configuration/')&&path.basename(file)===path.basename(bound.config.nginxSiteFile)?0o640:mode);
        fs.writeFileSync=(file,...args)=>{if(scenario==='backup-seal-write'&&String(file).endsWith('/backup.json'))throw new Error('injected seal write');return originalWrite(file,...args);};
        let backup;try{backup=originalBackup();}finally{fs.cpSync=originalCopy;fs.writeFileSync=originalWrite;fs.chmodSync=originalChmod;}
        if(scenario==='seal-failure'){const manifest=read(path.join(backup,'backup.json'));manifest.captureBinding.runId='wrong-run';write(path.join(backup,'backup.json'),manifest);}return backup;};
      if(['binding-drift','install-drift','snapshot-raw','snapshot-config','snapshot-component'].includes(scenario))actual.baseline=backup=>{originalBaseline(backup);if(scenario==='binding-drift')process.env.GITHUB_RUN_ID='6007';else if(scenario==='install-drift')fs.writeFileSync(path.join(bound.webRoot,'dist/index.html'),'unapproved target drift');else if(scenario==='snapshot-raw')fs.appendFileSync(path.join(backup,'application/backend/pb_data/data.db'),'drift');else if(scenario==='snapshot-config')fs.appendFileSync(path.join(backup,'configuration',bound.config.nginxSiteFile.slice(1)),'drift');else fs.rmSync(path.join(backup,'application/dist'),{recursive:true});};
      const result=await attempt(()=>deploy(actual,bound.config,candidate,6));process.env.GITHUB_RUN_ID='6006';
      assert.equal(result.accepted,successful,result.error);
      const state=read(path.join(bound.config.stateRoot,'deployment.json'));assert.equal(state.status,successful?'deployed':'failed');
      assert.equal(fs.existsSync(path.join(bound.webRoot,'backend/.velocity-maintenance')),true);
      if(scenario.startsWith('poststop-')||scenario.startsWith('backup-')) {
        assert.equal(result.accepted,false);assert.equal(state.status,'failed');assert.equal(bound.commands.some(c=>c.file==='sudo'&&['start','restart'].includes(c.args[2])),false);
        assert.equal(bound.commands.some(c=>c.file===path.join(bound.webRoot,'backend/pocketbase')&&c.args[0]==='migrate'),false);
        fs.statSync=(file,...args)=>{const value=originals.statSync(bound?.configMap.get(file)??file,...args);return file===bound?.configFile?new Proxy(value,{get:(v,k)=>k==='uid'?0:Reflect.get(v,k)}):value;};fs.lstatSync=(file,...args)=>originals.lstatSync(bound?.configMap.get(file)??file,...args);
        observe('capture-'+scenario+'-'+version,'actual preflight/capture input drift or copy/seal failure refused',{passed:true,fixtureRoot:bound.local});continue;
      }
      assert.equal(fs.readdirSync(bound.config.backupRoot).length,1);
      const raw=read(path.join(state.backup,'backup.json'));
      if(scenario!=='full-success'&&scenario!=='seal-failure') {assert.deepEqual(raw.captureBinding,{revision:candidate,runNumber:6,runId:'6006',repository:bound.config.repository,snapshotDirectory:state.backup});assert.equal(bound.config.baseline.snapshotId,undefined);}
      const sealed=fs.readFileSync(path.join(state.backup,'backup.json')), permissionFile=path.join(state.backup,'expected-recovery-contract.json'), permission=fs.existsSync(permissionFile)?fs.readFileSync(permissionFile):null;
      const commandsBefore=bound.commands.length;
      const retry=await attempt(()=>deploy(adapter(successful?6:7),bound.config,candidate,successful?6:7));assert.equal(retry.accepted,false);assert.match(retry.error,/Older\/repeated run or unresolved failed deployment/);
      assert.equal(bound.commands.slice(commandsBefore).some(c=>c.file==='sudo'),false);assert.deepEqual(fs.readFileSync(path.join(state.backup,'backup.json')),sealed);if(permission)assert.deepEqual(fs.readFileSync(permissionFile),permission);else assert.equal(fs.existsSync(permissionFile),false);
      if(successful) {
        process.env.GITHUB_RUN_ID='6007';
        delete bound.config.recoveryWorkingCopy;
        if(scenario==='full-success')bound.config.previousRevision=state.revision;
        bound.config.finiteStop.syncCodeSha256=sha(fs.readFileSync(path.join(bound.webRoot,'backend/scripts/sync_velocity.js')));
        const next=await deploy(adapter(7),bound.config,candidate,7);assert.equal(next.status,'deployed');assert.notEqual(next.backup,state.backup);assert.equal(fs.readdirSync(bound.config.backupRoot).length,2);
        const nextRaw=read(path.join(next.backup,'backup.json'));
        if(scenario==='first-success')assert.deepEqual(nextRaw.captureBinding,{revision:candidate,runNumber:7,runId:'6007',repository:bound.config.repository,snapshotDirectory:next.backup});
        else assert.equal(nextRaw.revision,state.revision);
        assert.deepEqual(fs.readFileSync(path.join(state.backup,'backup.json')),sealed);if(permission)assert.deepEqual(fs.readFileSync(permissionFile),permission);else assert.equal(fs.existsSync(permissionFile),false);
        if(bound.running){const service=await bound.running;await service.close();bound.running=null;}process.env.GITHUB_RUN_ID='6006';
      }
      if(!successful&&!scenario.startsWith('cleanup-'))assert.equal(bound.commands.some(c=>c.file==='sudo'&&['start','restart'].includes(c.args[2])),false);
    }
    assert.deepEqual(inventory(bound.config.velocityRoot,bound.config.protectedVelocityFiles),javaBefore);
    observe('capture-'+scenario+'-'+version,'first/full capture, stop order, bindings, failed-state and permission preservation',{passed:true,fixtureRoot:bound.local});
    } finally {
      if(domain.running){const service=await domain.running;await service.close();domain.running=null;}
      process.env.GITHUB_RUN_ID='6006';
      fs.statSync=(file,...args)=>{const value=originals.statSync(bound?.configMap.get(file)??file,...args);return file===bound?.configFile?new Proxy(value,{get:(v,k)=>k==='uid'?0:Reflect.get(v,k)}):value;};
      fs.lstatSync=(file,...args)=>originals.lstatSync(bound?.configMap.get(file)??file,...args);
    }
  }

} catch(error) {
  primaryError=error;
} finally {
  const closeoutFailure=(stage,error)=>{ownedFilesystem.errors.push({stage,message:'Owned fixture closeout failed'});closeoutError??=error;};
  let childrenClosed=true;
  try {if(bound?.running){const service=await bound.running;await service.close();bound.running=null;}}
  catch(error){childrenClosed=false;closeoutFailure('child-close',error);}
  // Restoration and evidence persistence still run when setup or child close fails.
  try {Object.assign(fs,originals);cp.execFileSync=rawExec;syncBuiltinESMExports();for(const key of ['DISPOSABLE_HUMAN_TOKEN','DISPOSABLE_TARGET_PASSWORD','GITHUB_REPOSITORY','GITHUB_RUN_ID','GITHUB_EVENT_NAME','GITHUB_SERVER_URL'])if(environment[key]===undefined)delete process.env[key];else process.env[key]=environment[key];}
  catch(error){closeoutFailure('restore',error);}
  const persist=()=>write(path.join(evidence,'probes-003.json'),{candidate,root,production:false,isolation:'original productionAdapter/deploy and actual PB/file/SQLite operations; only finite host/service/command/external config bindings substituted; synthetic identities and anonymous records',lifecycleContext,guardCoverage,observations,ownedFilesystem});
  try {
    for(const source of forwardOutputs) {
      const relativeSource=path.relative(root,source), bytes=fs.readFileSync(source);
      assert.ok(!relativeSource.startsWith('..')&&!path.isAbsolute(relativeSource),'Owned forward evidence locator refused');
      const retained=path.join(evidence,'retained-forward',relativeSource);mkdir(path.dirname(retained));
      fs.writeFileSync(retained,bytes,{mode:0o600});
      assert.ok(fs.readFileSync(retained).equals(bytes),'Owned forward evidence preservation refused');
      ownedFilesystem.retainedForwardOutputs.push({relativeSource,retainedPath:path.relative(evidence,retained),bytes:bytes.length,sha256:sha(bytes)});
    }
    persist();
    if(childrenClosed&&!closeoutError) {
      assert.ok(ownedChildren.every(child=>child.exitCode!==null||child.signalCode!==null),'Owned fixture child termination refused');
      assert.ok(path.dirname(root)===evidence&&fs.realpathSync(root)===root&&!fs.lstatSync(root).isSymbolicLink(),'Owned fixture root binding refused');
      fs.rmSync(root,{recursive:true});ownedFilesystem.removed=!fs.existsSync(root);
      assert.ok(ownedFilesystem.removed,'Owned fixture removal refused');
    }
  } catch(error){closeoutFailure('preserve-or-remove',error);}
  try {persist();}catch(error){closeoutFailure('final-probes',error);}
}
if(primaryError)throw primaryError;
if(closeoutError)throw closeoutError;
console.log(JSON.stringify({lifecycleContext,guardCoverage,guardCasesVerified:guardCoverage.filter(x=>x.status==='verified').length,guardCasesUnverified:guardCoverage.filter(x=>x.status!=='verified').length,observations:observations.length,passed:observations.filter(x=>x.passed).length,failed:observations.filter(x=>!x.passed).length,root,production:false}));
process.exitCode=observations.every(x=>x.passed)?0:1;

});

test('online migration metadata reads committed WAL, without treating it as a stopped snapshot', async t => {
  const root=temp(t), db=path.join(root,'data.db');
  const writer=cp.spawn('python3',['-u','-c',`import sqlite3,sys,time
c=sqlite3.connect(sys.argv[1]);c.execute('pragma journal_mode=WAL');c.execute('pragma wal_autocheckpoint=0');c.execute('create table _migrations(file text,applied integer)');c.commit();c.execute("insert into _migrations values ('committed-in-wal.js',1)");c.commit();print('ready',flush=True);time.sleep(30)`,db],{stdio:['ignore','pipe','pipe']});
  try {
    await new Promise((resolve,reject)=>{writer.stdout.once('data',resolve);writer.once('error',reject);writer.once('exit',code=>reject(new Error('writer exited '+code)));});
    assert.ok(fs.statSync(db+'-wal').size>0);
    assert.deepEqual(readMigrationLedger(root),[['committed-in-wal.js',1]]);
  } finally {writer.kill();await new Promise(resolve=>writer.once('close',resolve));}
});


for (const refusal of ['root','runner','config','lock','code','unit','process','shared-group','nested-group','job','file','tmp','bak','async-io','parent','alias','hardlink']) test('finite stop prewrite refusal: '+refusal, async t => productionFixture(t, async f => {
  f.host.fail=refusal;
  await assert.rejects(deploy(f.adapter,f.config,revision,2),/finite fixture/);
  assert.equal(fs.existsSync(f.state),false);assert.equal(fs.existsSync(f.guard),false);
  assert.equal(fs.existsSync(path.join(f.root,'runtime')),false);
  assert.equal(f.host.commands.length,0);assert.deepEqual(fs.readdirSync(f.config.backupRoot),[]);
}));
for (const refusal of ['directory-velocity','leaf-velocity','leaf-velocity-sync','reload','readback','freeze-timeout','frozen-process','frozen-file','frozen-job','frozen-io','thawed','kill','exit-timeout']) test('finite stop partial state survives before stop returns: '+refusal, async t => productionFixture(t, async f => {
  f.host.fail=refusal;
  await assert.rejects(deploy(f.adapter,f.config,revision,2),/finite fixture/);
  const failed=JSON.parse(fs.readFileSync(f.state));assert.equal(failed.status,'failed');
  assert.equal(failed.maintenance.changed,true);assert.equal(failed.maintenance.stopped,false);
  assert.equal(failed.servicesMayBeStopped,refusal==='exit-timeout');assert.equal(fs.existsSync(f.guard),false);
  assert.equal(f.host.commands.length,0);assert.deepEqual(fs.readdirSync(f.config.backupRoot),[]);
  assert.equal(fs.existsSync(path.join(f.root,'runtime/velocity.service.d')),true);
  const retained=fs.readFileSync(f.state);f.host.fail=undefined;
  await assert.rejects(deploy(productionAdapter(f.bundle,f.config,revision,3,f.configFile),f.config,revision,3),/unresolved failed/);
  assert.deepEqual(fs.readFileSync(f.state),retained);assert.equal(f.host.commands.length,0);
}));
test('finite stop success retains protection until actual install/migration/authentication', async t => productionFixture(t, f => {
  f.adapter.verify();f.adapter.lock();f.adapter.assertCurrent();f.adapter.velocity();
  try {
    f.adapter.stop('velocity-sync');const scope=f.adapter.maintenance();
    assert.equal(scope.frozen,true);assert.equal(scope.killed,true);assert.equal(scope.stopped,true);
    assert.deepEqual(f.host.commands.map(x=>x.args),[['-n','systemctl','stop','velocity-sync']]);
    assert.ok(scope.attempted.indexOf('reload')<scope.attempted.indexOf('cgroup.freeze'));
    assert.ok(scope.attempted.indexOf('cgroup.freeze')<scope.attempted.indexOf('cgroup.kill'));
    f.adapter.guard();assert.throws(()=>f.adapter.start('velocity-sync'),/requires installed/);assert.throws(()=>f.adapter.start('velocity-sync'),/installed\/migrated\/authenticated/);
    assert.equal(Object.keys(f.adapter.maintenance().leaves).length,2);
    assert.equal(fs.existsSync(f.guard),true);
  } finally { f.adapter.unlock(); }
}));
test('unavailable finite child records uncertainty without claiming services stopped', async t => productionFixture(t, async f => {
  const original=cp.execFileSync;cp.execFileSync=(file,args,options)=>{if(file==='sudo'&&args[1]==='/usr/bin/python3')throw new Error('child result lost');return original(file,args,options);};syncBuiltinESMExports();
  try {await assert.rejects(deploy(f.adapter,f.config,revision,2),/child result lost/);const failed=JSON.parse(fs.readFileSync(f.state));assert.equal(failed.maintenance.uncertain,true);assert.equal(failed.servicesMayBeStopped,true);}
  finally {cp.execFileSync=original;syncBuiltinESMExports();}
}));


test('fixed Python child rejects extra fields, unknown operation and actual unprivileged identity before writes', async t => productionFixture(t, f => {
  f.adapter.verify();f.adapter.lock();f.adapter.assertCurrent();f.adapter.velocity();
  const original=cp.execFileSync;
  cp.execFileSync=(file,args,options)=>{
    if(file!=='sudo'||args[1]!=='/usr/bin/python3')return original(file,args,options);
    const request=JSON.parse(options.input), source=args[4];
    for(const changed of [{...request,operation:'arbitrary-command'},{...request,command:'touch /not-authorized'},request]){
      // euid/SUDO_USER are the real isolated worker values, never a claimed root.
      const output=f.executeLocal('python3',['-c',source],{input:JSON.stringify(changed),encoding:'utf8',env:{...process.env,SUDO_USER:'invalid-finite-test-runner'},timeout:30000});
      const result=JSON.parse(output);assert.equal(result.ok,false);assert.equal(result.state.changed,false);
      assert.equal(Object.keys(result.state.leaves).length,0);
      assert.match(result.reason,/Unknown finite|actual root|Unsafe root config|Wrong actual sudo runner/);
    }
    return finiteHostResponse(request,f.host);
  };syncBuiltinESMExports();
  try {f.adapter.stop('velocity-sync');assert.equal(f.adapter.maintenance().stopped,true);}
  finally {cp.execFileSync=original;syncBuiltinESMExports();f.adapter.unlock();}
}));

// These cases extend the existing aggregate. They never weaken the retained
// full-entry scenarios or turn absent runtime/privileged evidence into success.
test('CI resource policy refuses ineffective controller/readback and wrong membership', async () => {
  const { validateResources } = await import('../scripts/deployment-inputs.mjs');
  const config = { runnerResources: { unit: 'actions.runner.fixture.service', CPUQuota: '100%', MemoryHigh: 1879048192, MemoryMax: 2147483648, TasksMax: 256 } };
  const facts = { unit: config.runnerResources.unit, member: true, descendantsBound: true, controllers: ['cpu', 'memory', 'pids'], cpuMax: '100000 100000', memoryHigh: '1879048192', memoryMax: '2147483648', pidsMax: '256' };
  assert.equal(validateResources(config, facts).ioEnforcement, 'unknown');
  for (const delta of [{ member: false }, { descendantsBound: false }, { cpuMax: 'max 100000' }, { cpuMax: '200000 100000' }, { memoryMax: 'max' }, { pidsMax: 'max' }, { controllers: ['memory', 'pids'] }, { unit: 'other.service' }]) assert.throws(() => validateResources(config, { ...facts, ...delta }));
  for (const delta of [{ CPUQuota: '200%' }, { MemoryHigh: 2147483648 }, { TasksMax: 512 }, { arbitrary: true }]) assert.throws(() => validateResources({ runnerResources: { ...config.runnerResources, ...delta } }, facts));
});
test('CI retained input requires exact bytes and rejects alias/hardlink/special input', async t => {
  const { regular, validateRetained, validateArchive } = await import('../scripts/deployment-inputs.mjs');
  for (const version of ['0.26.5','0.34.2','unknown']) assert.throws(() => validateArchive(Buffer.from('wrong'), version), /Archive/);
  const directory = temp(t), file = path.join(directory, 'input'); fs.writeFileSync(file, 'wrong');
  assert.throws(() => validateRetained(fs.readFileSync(file)), /Retained/);
  const link = path.join(directory, 'alias'); fs.symlinkSync(file, link); assert.throws(() => regular(link), /Aliased/);
  fs.linkSync(file, path.join(directory, 'hard')); assert.throws(() => regular(file), /Nonregular/);
  assert.throws(() => regular(directory), /Nonregular/);
  if (process.env.PB_RETAINED_HISTORY_FILE) assert.equal(validateRetained(fs.readFileSync(process.env.PB_RETAINED_HISTORY_FILE)).length, 2249);
});
test('CI ZIP extraction rejects traversal, duplicate, link, missing and unexpected targets before binary writes', async t => {
  const { zipExtractor } = await import('../scripts/deployment-inputs.mjs');
  const directory = temp(t);
  const makeZip = String.raw`import sys,zipfile,stat
z=zipfile.ZipFile(sys.argv[1],'w'); mode=sys.argv[2]
if mode=='missing': z.writestr('LICENSE.md','license')
elif mode=='duplicate': z.writestr('pocketbase','wrong'); z.writestr('pocketbase','wrong')
elif mode=='link':
 i=zipfile.ZipInfo('pocketbase'); i.external_attr=(stat.S_IFLNK|0o777)<<16; z.writestr(i,'elsewhere')
else: z.writestr({'traversal':'../pocketbase','absolute':'/pocketbase','extra':'arbitrary','architecture':'pocketbase'}[mode],'wrong')
z.close()`;
  for (const mode of ['missing','duplicate','link','traversal','absolute','extra','architecture']) {
    const zip = path.join(directory, mode + '.zip'), binary = path.join(directory, mode);
    cp.execFileSync('python3', ['-I', '-c', makeZip, zip, mode], { stdio: ['ignore','pipe','pipe'] });
    assert.throws(() => cp.execFileSync('python3', ['-I', '-c', zipExtractor, zip, binary], { stdio: ['ignore','pipe','pipe'] }));
    assert.equal(fs.existsSync(binary), false);
  }
});
test('identity supply decoder admits only a bounded closed bound private frame', () => {
  const now = 2000000000;
  const expected = { nonce: '4'.repeat(64), revision, runId: '123', humanId: 'j3o2wd17l18prla' };
  const claims = { type: 'auth', id: expected.humanId, collectionId: 'pbc_3142635823', refreshable: false, exp: now + 900 };
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const token = value => encode({ alg: 'HS256', typ: 'JWT' }) + '.' + encode(value) + '.' + Buffer.alloc(32).toString('base64url');
  const frame = (value = {}) => JSON.stringify({ ...expected, token: token(claims), ...value }) + '\n';
  const accepted = decodeIdentitySupply(frame(), expected, now);
  assert.ok(accepted.humanId === expected.humanId && accepted.collectionId === claims.collectionId, 'Identity decoder fixture binding refused');
  const reject = (raw, binding = expected, time = now) => assert.throws(() => decodeIdentitySupply(raw, binding, time), error => error instanceof Error && error.message === 'Offline identity channel refused', 'Identity decoder must refuse privately');
  for (const raw of [undefined, null, {}, '', frame().slice(0, -1), frame() + '\n', frame() + frame(), 'timestamp ' + frame(), '\u001b[0m' + frame(), ' ' + frame(), frame().replace('{', '{ '), frame().replace('{', '{"nonce":"duplicate",'), frame({ extra: true }), frame({ token: '' }), frame({ token: 'x'.repeat(8192) }), frame({ token: 'a.b.c' }), frame({ token: token(claims) + '=' }), frame({ humanId: null }), frame({ runId: 123 }), frame({ revision: 'b'.repeat(40) }), frame({ nonce: '5'.repeat(64) }), frame({ humanId: 'other0000000000' }), frame({ token: 'x'.repeat(16384) }), frame().replace('123', '\u00e9')]) reject(raw);
  for (const key of ['nonce','revision','runId','humanId']) reject(frame(), { ...expected, [key]: 'wrong' });
  for (const changed of [{ type: 'refresh' }, { id: 'other0000000000' }, { collectionId: '' }, { collectionId: null }, { collectionId: 'x'.repeat(65) }, { refreshable: true }, { refreshable: undefined }, { exp: now }, { exp: now - 1 }, { exp: now + 901 }, { exp: now + 0.5 }, { exp: String(now + 900) }]) reject(frame({ token: token({ ...claims, ...changed }) }));
  for (const header of [{ alg: 'none', typ: 'JWT' }, { alg: 'HS256', typ: 'other' }]) reject(frame({ token: encode(header) + '.' + encode(claims) + '.' + Buffer.alloc(32).toString('base64url') }));
  for (const body of ['{"type":"auth","type":"auth"}', 'null', '[]', '{', JSON.stringify({ ...claims, padding: 'x'.repeat(4096) })]) reject(frame({ token: encode({ alg: 'HS256', typ: 'JWT' }) + '.' + Buffer.from(body).toString('base64url') + '.' + Buffer.alloc(32).toString('base64url') }));
  reject(frame(), expected, NaN);
});
for (const [version, binary] of binaries) test('offline exact identity supply and bounded same-target human/service proof: ' + version, async () => {
  const database = await pocketbase(binary);
  const humanId = 'j3o2wd17l18prla', ids = ['svcvsal7qgvfl12','svcmc31eh69zpuo'];
  const permission = [{ id: humanId, role: 'admin' }, ...ids.map(id => ({ id, role: 'service' }))];
  const credentials = { [ids[0]]: '1'.repeat(64), [ids[1]]: '2'.repeat(64) };
  const input = { revision, runId: '123', snapshotId: '3'.repeat(64), permissionSha256: createHash('sha256').update(JSON.stringify(permission)).digest('hex'), permission, credentials, nonce: '4'.repeat(64) };
  try {
    const human = await database.request('/api/collections/users/records', { token: database.token, method: 'POST', body: { id: humanId, email: 'human@example.invalid', password: 'Human-Fixture-2026!', passwordConfirm: 'Human-Fixture-2026!', verified: true } });
    assert.equal(human.status, 200);
    const ordinary = await database.request('/api/collections/users/records', { token: database.token, method: 'POST', body: { email: 'ordinary@example.invalid', password: 'Ordinary-Fixture-2026!', passwordConfirm: 'Ordinary-Fixture-2026!', verified: true } }); assert.equal(ordinary.status, 200);
    await database.service.close();
    const before = checkDatabases(database.directory + '/data');
    const run = value => cp.spawnSync(binary, ['deployment-identity-supply', '--dir', path.join(database.directory,'data'), '--migrationsDir', database.migrations, '--hooksDir', path.join(projectRoot,'backend/pb_hooks')], { env: { ...process.env, PB_DEPLOYMENT_IDENTITY_INPUT: JSON.stringify(value) }, encoding: 'utf8', stdio: ['ignore','pipe','pipe'], timeout: 60000, maxBuffer: 65536 });
    for (const value of [{ ...input, arbitrary: true }, { ...input, permission: permission.slice(1) }, { ...input, credentials: { ...credentials, [ids[1]]: credentials[ids[0]] } }]) { assert.notEqual(run(value).status, 0); assert.deepEqual(checkDatabases(database.directory + '/data'), before); }
    const supplied = run(input); assert.equal(supplied.status, 0, 'Offline supply refused; private output withheld');
    const expected = { nonce: input.nonce, revision, runId: input.runId, humanId };
    const proof = decodeIdentitySupply(supplied.stdout, expected);
    const payload = JSON.parse(Buffer.from(proof.token.split('.')[1], 'base64url'));
    assert.ok(payload.exp - Math.floor(Date.now() / 1000) <= 900 && payload.exp - Math.floor(Date.now() / 1000) >= 890); assert.equal(proof.humanId, humanId);
    const wrong = run({ ...input, credentials: { ...credentials, [ids[0]]: '5'.repeat(64) } }); assert.notEqual(wrong.status, 0);
    const repeated = run(input); assert.equal(repeated.status, 0, 'Repeated offline supply refused; private output withheld');
    const repeatedProof = decodeIdentitySupply(repeated.stdout, expected);
    assert.ok(repeatedProof.humanId === humanId && repeatedProof.collectionId === proof.collectionId, 'Repeated identity binding refused');
    await database.restart();
    const self = await database.request('/api/collections/users/records/' + humanId, { token: proof.token }); assert.equal(self.status, 200); assert.equal(self.data.is_admin, true); assert.equal(self.data.service_account, false); assert.equal(self.data.email, human.data.email); assert.ok(self.data.collectionId === proof.collectionId && self.data.collectionName === 'users', 'Same-target collection binding refused');
    const humanRefresh = await database.request('/api/collections/users/auth-refresh', { token: proof.token, method: 'POST' });
    assert.equal(humanRefresh.status, version === '0.26.5' ? 403 : 200);
    if(version === '0.34.2') {
      assert.ok(typeof humanRefresh.data.token === 'string' && humanRefresh.data.token === proof.token, 'Human refresh token preservation refused');
      const now = Math.floor(Date.now() / 1000);
      const refreshedProof = decodeIdentitySupply(JSON.stringify({ ...expected, token: humanRefresh.data.token }) + '\n', expected, now);
      const refreshedClaims = JSON.parse(Buffer.from(refreshedProof.token.split('.')[1], 'base64url'));
      assert.ok(Number.isSafeInteger(refreshedClaims.exp) && refreshedClaims.exp === payload.exp && refreshedClaims.id === payload.id && refreshedClaims.collectionId === payload.collectionId && refreshedClaims.type === payload.type && refreshedClaims.type === 'auth' && refreshedClaims.refreshable === false && refreshedClaims.exp - now > 0 && refreshedClaims.exp - now <= 900, 'Human refresh bounded claim preservation refused');
      const record = humanRefresh.data.record;
      assert.ok(record && record.id === humanId && record.collectionId === proof.collectionId && record.collectionName === 'users' && record.verified === true && record.email === human.data.email && record.is_admin === true && record.service_account === false, 'Human refresh same-target record binding refused');
    }
    for (const [i, id] of ids.entries()) {
      const auth = await database.request('/api/collections/users/auth-with-password', { method: 'POST', body: { identity: ['velocity-sync@services.hololive.com.cn','mcsm-proxy@services.hololive.com.cn'][i], password: credentials[id] } }); assert.equal(auth.status, 200); assert.equal(auth.data.record.id, id);
      assert.equal((await database.request('/api/collections/users/auth-refresh', { token: auth.data.token, method: 'POST' })).status, 200);
      assert.equal((await database.request('/api/collections/mcsm_config/records', { token: auth.data.token })).status, 200);
      assert.equal((await database.request('/api/collections/users/auth-with-password', { method: 'POST', body: { identity: auth.data.record.email, password: credentials[ids[1-i]] } })).status, 400);
    }
    const unchanged = await database.request('/api/collections/users/records/' + ordinary.data.id, { token: database.token }); assert.equal(unchanged.data.is_admin, false); assert.equal(unchanged.data.service_account, false);
    assert.equal((await database.request('/api/collections/velocity_settings/records', { token: proof.token })).status, 200);
  } finally { await database.close(); }
});
test('omitted systemd complex properties require actual typed empty D-Bus payloads', async () => {
  const { showService } = await import('../scripts/deployment.mjs');
  const original = cp.execFileSync;
  const full = fixtureService('/fixture/backend'), omitted = full.split('\n').filter(line => !['ExecStop=','EnvironmentFiles='].includes(line)).join('\n');
  let payload = { type: 'a(sasbttttuii)', data: [] }, scalarMissing = false;
  cp.execFileSync = (command, args) => {
    if (command === 'systemctl') return scalarMissing ? omitted.replace('User=fixture\n','') : omitted;
    assert.equal(command, '/usr/bin/busctl'); assert.equal(args[0], '--system'); assert.equal(args[1], '--json=short');
    if (args[2] === 'call') return JSON.stringify({ type: 'o', data: ['/org/freedesktop/systemd1/unit/fixture_2eservice'] });
    return JSON.stringify(args.at(-1) === 'EnvironmentFiles' ? { type: 'a(sb)', data: [] } : payload);
  }; syncBuiltinESMExports();
  try {
    assert.deepEqual(serviceFacts(showService('fixture')), serviceFacts(full));
    for (const wrong of [{ type: 'as', data: [] }, { type: 'a(sasbttttuii)', data: [[]] }, { type: 'a(sasbttttuii)', data: [], extra: true }, { type: 'a(sasbttttuii)' }]) { payload = wrong; assert.throws(() => showService('fixture'), /typed empty/); }
    scalarMissing = true; assert.throws(() => showService('fixture'), /nonarray/);
  } finally { cp.execFileSync = original; syncBuiltinESMExports(); }
});
test('new fixed private families reject unknown schema/purpose without emitting material or writing', t => {
  const directory = temp(t), source = fs.readFileSync(path.join(projectRoot,'scripts/deployment.mjs'),'utf8');
  const script = /const finiteRootSource = String.raw`([\s\S]*?)`;/u.exec(source)?.[1]; assert.ok(script);
  for (const operation of ['restore-configuration-ownership','private-configuration','service-credential-material']) {
    const response = cp.spawnSync('python3', ['-I','-c',script], { input: JSON.stringify({ operation, purpose: 'arbitrary', destination: directory, uid: 0 }), encoding: 'utf8', stdio: ['pipe','pipe','pipe'] });
    assert.equal(response.status, 0); const result = JSON.parse(response.stdout); assert.equal(result.ok, false); assert.deepEqual(result.attempted, []); assert.deepEqual(result.completed, []); assert.equal(Object.hasOwn(result,'credentials'),false); assert.deepEqual(fs.readdirSync(directory), []);
  }
});

// Execute the actual fixed child's derivation body with synthetic, local files.
// This exercises conversion and prewrite refusal without claiming root delivery.
function deriveSyntheticUnits(t, sync, mcsm = '[Service]\nExecStart=/fixture/mcsm\n') {
  const directory = temp(t), backup = path.join(directory, 'backup'), files = ['velocity-sync','mcsm-proxy'].map(unit => '/etc/systemd/system/' + unit + '.service');
  for (const [index, data] of [sync, mcsm].entries()) {
    const file = path.join(backup, 'configuration', files[index]); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, data); fs.chmodSync(file, 0o644);
  }
  const source = fs.readFileSync(path.join(projectRoot,'scripts/deployment.mjs'),'utf8'), child = /const finiteRootSource = String.raw`([\s\S]*?)`;/u.exec(source)?.[1]; assert.ok(child);
  const from = child.indexOf(' def envbytes(index):'), to = child.indexOf(" safe=purpose in ['restore-safe'", from); assert.ok(from > 0 && to > from);
  const script = `import os,sys,json,hashlib,re
request=json.load(sys.stdin); backup=request['backup']; private=backup+'/private'; binding={'fixture':True}; purpose='derive-safe'; values=['a'*64,'b'*64]
whitelist=request['files']; envs=['/etc/default/velocity-sync','/etc/default/mcsm-proxy']; prepared={'snapshotId':'synthetic','materialSha256':'synthetic'}; writes=[]
raw={'configuration':[{'mode':420} for _ in whitelist],'ownership':[{'uid':os.getuid(),'gid':os.getgid()} for _ in whitelist]}
def require(ok,reason):
 if not ok: raise ValueError(reason)
def private_read(file):
 with open(file,'rb') as stream: return stream.read()
def check_stopped(): pass
def mkdirs(file): os.makedirs(os.path.dirname(file),exist_ok=True)
def write(file,data,mode=384,owner=None):
 require(owner is None or owner==(os.getuid(),os.getgid()),'Synthetic owner drift')
 with open(file,'xb') as stream: stream.write(data)
 os.chmod(file,mode); writes.append(file)
def observed(files,root):
 return {'files':[{'path':file,'sha256':hashlib.sha256(private_read(root+'/'+file.lstrip('/'))).hexdigest(),'mode':os.stat(root+'/'+file.lstrip('/')).st_mode&511,'uid':os.stat(root+'/'+file.lstrip('/')).st_uid,'gid':os.stat(root+'/'+file.lstrip('/')).st_gid} for file in files]}
def save_seal(value): pass
def report(value): return value
def derive():
${child.slice(from,to)}
try:
 result=derive(); print(json.dumps({'ok':True,'writes':writes,'expected':result}))
except Exception:
 print(json.dumps({'ok':False,'writes':writes}))
`;
  // The production unitbytes and prewrite derivation body remain exact;
  // local file helpers supply synthetic ownership and receipt observations.
  const response = cp.spawnSync('python3',['-I','-c',script],{input:JSON.stringify({backup,files}),encoding:'utf8',timeout:30000});
  assert.equal(response.status,0,response.stderr); const result=JSON.parse(response.stdout);
  for (const [index, data] of [sync,mcsm].entries()) {
    assert.deepEqual(fs.readFileSync(path.join(backup,'configuration',files[index])),Buffer.from(data));
    assert.equal(fs.statSync(path.join(backup,'configuration',files[index])).mode&0o777,0o644);
  }
  return { result, backup, files, safe: unit => path.join(backup,'safe-recovery/configuration/etc/systemd/system',unit+'.service') };
}
test('reviewed legacy sync conversion preserves every unrelated byte and raw mode', t => {
  for (const ending of ['\n','\r\n']) {
    const before=['# synthetic comment','[Unit]','After=fixture.target','[Service]','Environment=PB_URL=http://fixture.invalid','Environment=PB_EMAIL=old@fixture.invalid','Environment=PB_PASS=synthetic-old','Environment=VELOCITY_DIR=/fixture/velocity','ExecStart=/usr/bin/node fixture.js','[Install]','WantedBy=fixture.target'].join(ending)+ending;
    const f=deriveSyntheticUnits(t,before); assert.equal(f.result.ok,true);
    const expected=before.replace('[Service]'+ending,'[Service]'+ending+'EnvironmentFile=-/etc/default/velocity-sync'+ending).replace('Environment=PB_EMAIL=old@fixture.invalid'+ending,'').replace('Environment=PB_PASS=synthetic-old'+ending,'');
    assert.deepEqual(fs.readFileSync(f.safe('velocity-sync')),Buffer.from(expected));
    assert.equal(fs.statSync(f.safe('velocity-sync')).mode&0o777,0o644);
    const rawStat=fs.statSync(path.join(f.backup,'configuration',f.files[0])),safeStat=fs.statSync(f.safe('velocity-sync'));
    assert.deepEqual([safeStat.uid,safeStat.gid],[rawStat.uid,rawStat.gid]);
    assert.deepEqual(fs.readFileSync(f.safe('mcsm-proxy')),Buffer.from('[Service]\nEnvironmentFile=-/etc/default/mcsm-proxy\nExecStart=/fixture/mcsm\n'));
    assert.equal(fs.readFileSync(path.join(f.backup,'safe-recovery/configuration/etc/default/velocity-sync'),'utf8'),'PB_EMAIL=velocity-sync@services.hololive.com.cn\nPB_PASS='+'a'.repeat(64)+'\n');
    assert.equal(fs.readFileSync(path.join(f.backup,'safe-recovery/configuration/etc/default/mcsm-proxy'),'utf8'),'PB_EMAIL=mcsm-proxy@services.hololive.com.cn\nPB_PASS='+'b'.repeat(64)+'\n');
  }
});
test('credential-free units and both approved matching bindings derive idempotently', t => {
  const sync='# PB_EMAIL is only a comment\n[Service]\nEnvironment=PB_URL=http://fixture.invalid\nExecStart=/fixture/sync';
  const f=deriveSyntheticUnits(t,sync); assert.equal(f.result.ok,true);
  const safeSync=fs.readFileSync(f.safe('velocity-sync')), safeMcsm=fs.readFileSync(f.safe('mcsm-proxy'));
  assert.deepEqual(safeSync,Buffer.from(sync.replace('[Service]\n','[Service]\nEnvironmentFile=-/etc/default/velocity-sync\n')));
  const again=deriveSyntheticUnits(t,safeSync,safeMcsm); assert.equal(again.result.ok,true);
  assert.deepEqual(fs.readFileSync(again.safe('velocity-sync')),safeSync); assert.deepEqual(fs.readFileSync(again.safe('mcsm-proxy')),safeMcsm);
});
test('unsupported credentials and unit layouts refuse both derived units before any write', t => {
  const pair='Environment=PB_EMAIL=synthetic@fixture.invalid\nEnvironment=PB_PASS=synthetic\n', unit=body=>'[Service]\n'+body+'ExecStart=/fixture/sync\n';
  const refused=[
    unit('Environment=PB_EMAIL=synthetic\n'),unit('Environment=PB_PASS=synthetic\n'),unit(pair+'Environment=PB_PASS=duplicate\n'),
    unit('Environment="PB_EMAIL=synthetic"\nEnvironment=PB_PASS=synthetic\n'),unit("Environment=PB_EMAIL='synthetic'\nEnvironment=PB_PASS=synthetic\n"),
    unit('Environment=PB_EMAIL=synthetic PB_URL=http://fixture.invalid\nEnvironment=PB_PASS=synthetic\n'),unit(' Environment=PB_EMAIL=synthetic\nEnvironment=PB_PASS=synthetic\n'),
    unit('Environment=PB_EMAIL=synthetic\\\nEnvironment=PB_PASS=synthetic\n'),unit('Environment=PB_URL=synthetic\\\n'+pair),unit('Environment=PB_EMAIL=\nEnvironment=PB_PASS=synthetic\n'),
    unit(pair+'Environment=PB_TOKEN=synthetic\n'),unit('Environment=PB_TOKEN=synthetic\n'),unit('Environment : PB_EMAIL=synthetic\nEnvironment=PB_PASS=synthetic\n'),
    '[Unit]\n'+pair+'[Service]\nExecStart=/fixture/sync\n',unit(pair)+'[Service]\n',unit(pair+'EnvironmentFile=-/etc/default/velocity-sync\n'),
    unit('EnvironmentFile=/fixture/unknown\n'),unit('EnvironmentFile /fixture/unknown\n'),unit('EnvironmentFile=-/etc/default/mcsm-proxy\n'),unit('EnvironmentFile=-/etc/default/velocity-sync\nEnvironmentFile=-/etc/default/velocity-sync\n'),
    '[Service]\n[Service]\n', '[Service] # ambiguous\n', '[Unit]\nEnvironmentFile=-/etc/default/velocity-sync\n[Service]\n',
  ];
  for (const input of refused) {const f=deriveSyntheticUnits(t,input);assert.equal(f.result.ok,false);assert.deepEqual(f.result.writes,[]);assert.equal(fs.existsSync(path.join(f.backup,'safe-recovery')),false);}
  // A valid first unit must not be copied before the second unit is refused.
  for (const mcsm of [unit(pair),unit('Environment=PB_TOKEN=synthetic\n'),unit('EnvironmentFile=-/etc/default/velocity-sync\n')]) {
    const f=deriveSyntheticUnits(t,unit(pair),mcsm);assert.equal(f.result.ok,false);assert.deepEqual(f.result.writes,[]);assert.equal(fs.existsSync(path.join(f.backup,'safe-recovery')),false);
  }
});

test('runtime identity proof preserves missing history and rejects live/stopped identity drift', () => {
  const source = fs.readFileSync(path.join(projectRoot, 'scripts/deployment.mjs'), 'utf8');
  const child = /const finiteRootSource = String.raw`([\s\S]*?)`;/u.exec(source)?.[1]; assert.ok(child);
  const script = String.raw`import ast,json,sys,types,copy
request=json.load(sys.stdin); tree=ast.parse(request['child'])
names={'marker_names','execution_names','service_names','sync_names'}
nodes=[n for n in tree.body if isinstance(n,(ast.Import,ast.ImportFrom,ast.FunctionDef)) or isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id in names for t in n.targets)]
ns={}; exec(compile(ast.Module(body=nodes,type_ignores=[]),'<actual finite child>','exec'),ns)
value=dict(line.split('=',1) for line in request['service'].splitlines())
value.update(MainPID='200',ExecMainPID='200',ExecMainCode='0',ExecMainStatus='0',ExecMainStartTimestampMonotonic='1000000',ExecMainExitTimestampMonotonic='0',InvocationID='a'*32,NRestarts='0',ActiveState='active',ControlGroup='/fixture.service')
def stat(start): return ('200 (node) '+' '.join(['0']*19+[start])).encode()
files={}; paths={}; group=[]; reads=[]
def reset():
 files.clear(); files.update({'/proc/200/stat':stat('100'),'/proc/200/cmdline':b'/usr/bin/node\0sync_velocity.js\0','/proc/200/cgroup':b'0::/fixture.service\n','/proc/200/status':b'Uid: 1000 1000 1000 1000\nGid: 1000 1000 1000 1000\n'})
 paths.clear(); paths.update({'/proc/200/exe':'/usr/bin/node','/proc/200/cwd':'/fixture/backend/scripts'}); group.clear(); reads.clear()
def read(p):
 if p not in files: raise FileNotFoundError(p)
 if p=='/proc/200/stat' and reads: return reads.pop(0)
 return files[p]
ns.update(config={},read=read,os=types.SimpleNamespace(stat=lambda p:types.SimpleNamespace(st_dev=64770,st_ino=919512),path=types.SimpleNamespace(realpath=lambda p:paths.get(p,p),isabs=lambda p:p.startswith('/'),exists=lambda p:p=='/fixture-group/cgroup.procs')),
 pwd=types.SimpleNamespace(getpwnam=lambda u:types.SimpleNamespace(pw_uid=1000,pw_gid=1000)),grp=types.SimpleNamespace(getgrnam=lambda g:types.SimpleNamespace(gr_gid=1000)),group_path=lambda g:'/fixture-group',members=lambda g:group)
ns['configured']=lambda unit,v:ns['facts'](v)
reset(); original=copy.deepcopy(value); assert ns['running'](value)['pid']=='200'; assert value==original
missing=copy.deepcopy(value); missing['ExecStart']=missing['ExecStart'].replace('start_time=[fixture-start]','start_time=[n/a]').replace('pid=200','pid=0').replace('status=0','status=0/0')
assert ns['running'](missing)['pid']=='0'; assert ns['facts'](missing)['runtime']['ExecStart'][0]['start_time']=='[n/a]'
assert ns['stable_properties'](value,missing); assert not ns['stable_properties'](missing,value)
for key,wrong in [('MainPID','0'),('ExecMainPID','201'),('ExecMainStartTimestampMonotonic','0'),('InvocationID','bad'),('ExecMainCode','1'),('ActiveState','inactive')]:
 reset(); bad=dict(missing); bad[key]=wrong
 try: ns['running'](bad)
 except (RuntimeError,ValueError): pass
 else: raise AssertionError('accepted marker drift '+key)
for key,wrong in [('/proc/200/cmdline',b'/usr/bin/node\0sync_velocity.js\0--other\0'),('/proc/200/cgroup',b'0::/other.service\n'),('/proc/200/status',b'Uid: 0 0 0 0\nGid: 1000 1000 1000 1000\n')]:
 reset(); files[key]=wrong
 try: ns['running'](missing)
 except RuntimeError: pass
 else: raise AssertionError('accepted process drift '+key)
for key in ['/proc/200/exe','/proc/200/cwd']:
 reset(); paths[key]='/other'
 try: ns['running'](missing)
 except RuntimeError: pass
 else: raise AssertionError('accepted path drift')
reset(); reads.extend([stat('100'),stat('101')])
try: ns['running'](missing)
except RuntimeError: pass
else: raise AssertionError('accepted replaced process')
reset(); partial=dict(missing); partial['ExecStart']=partial['ExecStart'].replace('pid=0','pid=200')
try: ns['running'](partial)
except RuntimeError: pass
else: raise AssertionError('accepted partial command record')
stopped=dict(missing); stopped.update(ActiveState='inactive',MainPID='0',ExecMainCode='2',ExecMainStatus='9',ExecMainExitTimestampMonotonic='2000000')
state={'sync':missing,'killed':True,'stopped':True,'processes':[[200,'100']]}; ns['result']=state
reset(); del files['/proc/200/stat']; ns['stopped'](stopped)
for key,wrong in [('ExecMainPID','201'),('ExecMainCode','0'),('ExecMainStatus','15'),('ExecMainExitTimestampMonotonic','999999'),('NRestarts','1')]:
 bad=dict(stopped); bad[key]=wrong
 try: ns['stopped'](bad)
 except RuntimeError: pass
 else: raise AssertionError('accepted stopped marker drift '+key)
files['/proc/200/stat']=stat('100')
try: ns['stopped'](stopped)
except RuntimeError: pass
else: raise AssertionError('accepted surviving owned process')
files['/proc/200/stat']=stat('101'); ns['stopped'](stopped)
group.append(300)
try: ns['stopped'](stopped)
except RuntimeError: pass
else: raise AssertionError('accepted surviving group')
group.clear(); state['killed']=False
try: ns['stopped'](stopped)
except RuntimeError: pass
else: raise AssertionError('accepted unowned stop')
reset(); ns['config']={'websiteServices':['pocketbase']}; ns['result']={}; ns['r']={'serviceEvidence':{'pocketbase':{'runtime':ns['facts'](missing)['runtime']}}}
current=dict(missing); ns['props']=lambda unit,names:dict(current)
ns['service_phases']('stop')
current.update(MainPID='201',ExecMainPID='201',ExecMainStartTimestampMonotonic='2000000',InvocationID='b'*32)
for key,data in list(files.items()): files[key.replace('/200/','/201/')]=data
for key,data in list(paths.items()): paths[key.replace('/200/','/201/')]=data
try: ns['service_phases']('cleanup-sync')
except RuntimeError: pass
else: raise AssertionError('accepted unchanged kernel start for new PB')
files['/proc/201/stat']=stat('200'); current['InvocationID']='a'*32
try: ns['service_phases']('cleanup-sync')
except RuntimeError: pass
else: raise AssertionError('accepted old invocation for new PB')
current['InvocationID']='b'*32; ns['service_phases']('cleanup-sync'); ns['service_phases']('cleanup-java')
current['ExecMainStartTimestampMonotonic']='3000000'
try: ns['service_phases']('cleanup-java')
except RuntimeError: pass
else: raise AssertionError('accepted late PB start drift')
print(json.dumps({'passed':True,'rawMissingRecordPreserved':True,'kernelAndExitDriftRejected':True}))
`;
  const response = cp.spawnSync('python3', ['-I', '-c', script], { input: JSON.stringify({ child, service: fixtureService('/fixture/backend/scripts') }), encoding: 'utf8', timeout: 10000 });
  assert.equal(response.status, 0, response.stderr);
  assert.equal(JSON.parse(response.stdout).passed, true);
});

test('dependency unit order changed by daemon-reload is normalized while membership drift is rejected', () => {
  const approved = '-.mount system.slice sysinit.target', reloaded = 'sysinit.target -.mount system.slice';
  const unit = requires => fixtureService('/fixture/site/backend/scripts', 'mcsm-proxy').replace('Requires=', 'Requires=' + requires);
  assert.equal(dependencyList(reloaded), dependencyList(approved));
  assert.deepEqual(serviceFacts(unit(reloaded)).configuration, serviceFacts(unit(approved)).configuration);
  for (const drift of ['-.mount system.slice', approved + ' network.target', '-.mount system.slice other.target']) assert.notDeepEqual(serviceFacts(unit(drift)).configuration, serviceFacts(unit(approved)).configuration);
  for (const ambiguous of ['-.mount  system.slice', '-.mount -.mount', ' -.mount', '-.mount ']) assert.throws(() => dependencyList(ambiguous), /Ambiguous unit dependency list/);
  assert.equal(dependencyLines('Requires=' + reloaded + '\nBindsTo=\nPartOf='), dependencyLines('Requires=' + approved + '\nBindsTo=\nPartOf='));
  assert.notEqual(dependencyLines('Requires=-.mount system.slice\nBindsTo=\nPartOf='), dependencyLines('Requires=' + approved + '\nBindsTo=\nPartOf='));
  assert.notEqual(dependencyLines('Requires=' + approved + '\nBindsTo=\nPartOf=velocity.target'), dependencyLines('Requires=' + approved + '\nBindsTo=\nPartOf='));
  assert.throws(() => dependencyLines('Requires=' + approved + '\nWants=\nPartOf='), /Unknown unit dependency property/);
  const source = fs.readFileSync(path.join(projectRoot, 'scripts/deployment.mjs'), 'utf8');
  const child = /const finiteRootSource = String.raw`([\s\S]*?)`;/u.exec(source)?.[1]; assert.ok(child);
  const script = String.raw`import ast,json,sys,types
request=json.load(sys.stdin); tree=ast.parse(request['child'])
names={'marker_names','execution_names','service_names','sync_names'}
nodes=[n for n in tree.body if isinstance(n,(ast.Import,ast.ImportFrom,ast.FunctionDef)) or isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id in names for t in n.targets)]
ns={}; exec(compile(ast.Module(body=nodes,type_ignores=[]),'<actual finite child>','exec'),ns)
approved,reloaded=request['approved'],request['reloaded']
def with_requires(value): return '\n'.join('Requires='+value if line=='Requires=' else line for line in request['service'].splitlines())
live={'velocity':'Requires='+reloaded+'\nBindsTo=\nPartOf=','mcsm-proxy':with_requires(reloaded)}
ns['ctl']=lambda args: '\n'.join(line for line in live[args[1]].splitlines() if line.split('=',1)[0] in args[4::2])
evidence=ns['facts'](dict(line.split('=',1) for line in with_requires(approved).splitlines()))
ns.update(config={'websiteServices':['mcsm-proxy'],'serviceBindings':{'mcsm-proxy':with_requires(approved)},'velocityServiceBinding':'Requires='+approved+'\nBindsTo=\nPartOf='},r={'serviceEvidence':{'mcsm-proxy':{'configuration':evidence['configuration'],'environment':evidence['environment']}}},result={})
assert ns['props']('velocity',['Requires','BindsTo','PartOf'])==ns['java_dependencies']()
assert ns['props']('velocity',['Requires'])['Requires']=='-.mount sysinit.target system.slice'
assert ns['configured']('mcsm-proxy')['configuration']['Requires']=='-.mount sysinit.target system.slice'
before=ns['props']('mcsm-proxy',ns['service_names']); live['mcsm-proxy']=with_requires(approved); assert ns['stable_properties'](before,ns['props']('mcsm-proxy',ns['service_names']))
for drift in ['-.mount system.slice',approved+' network.target']:
 live['velocity']='Requires='+drift+'\nBindsTo=\nPartOf='; live['mcsm-proxy']=with_requires(drift)
 assert ns['props']('velocity',['Requires','BindsTo','PartOf'])!=ns['java_dependencies']()
 assert not ns['stable_properties'](before,ns['props']('mcsm-proxy',ns['service_names']))
 try: ns['configured']('mcsm-proxy')
 except RuntimeError: pass
 else: raise AssertionError('accepted dependency membership drift '+drift)
live['mcsm-proxy']=with_requires('-.mount -.mount')
try: ns['props']('mcsm-proxy',ns['service_names'])
except RuntimeError: pass
else: raise AssertionError('accepted duplicate dependency unit')
print(json.dumps({'passed':True}))
`;
  const response = cp.spawnSync('python3', ['-I', '-c', script], { input: JSON.stringify({ child, approved, reloaded, service: fixtureService('/fixture/site/backend/scripts', 'mcsm-proxy') }), encoding: 'utf8', timeout: 10000 });
  assert.equal(response.status, 0, response.stderr);
  assert.equal(JSON.parse(response.stdout).passed, true);
});

test('systemd 255 killed/failed stop records are parsed and bound to the owned SIGKILL', () => {
  const unit = record => fixtureService('/fixture/site/backend/scripts').replace(/start_time=\[fixture-start\] ; stop_time=\[n\/a\] ; pid=200 ; code=\(null\) ; status=0/, record);
  for (const [code, status] of [['killed', '9/KILL'], ['killed', '15/TERM'], ['dumped', '6/ABRT'], ['exited', '0'], ['exited', '1'], ['(null)', '0/0']]) {
    const facts = serviceFacts(unit(`start_time=[fixture-start] ; stop_time=[fixture-stop] ; pid=200 ; code=${code} ; status=${status}`));
    assert.deepEqual([facts.runtime.ExecStart[0].code, facts.runtime.ExecStart[0].status], [code, status]);
  }
  for (const status of ['9/kill', '/KILL', 'KILL', '9/', '9/KILL/X']) assert.throws(() => serviceFacts(unit(`start_time=[fixture-start] ; stop_time=[fixture-stop] ; pid=200 ; code=killed ; status=${status}`)), /Ambiguous service command/);
  const source = fs.readFileSync(path.join(projectRoot, 'scripts/deployment.mjs'), 'utf8');
  const child = /const finiteRootSource = String.raw`([\s\S]*?)`;/u.exec(source)?.[1]; assert.ok(child);
  const nested = /\n( def check_stopped\(\):\n(?:  .*\n)+)/u.exec(child)?.[1]; assert.ok(nested);
  const script = String.raw`import ast,json,sys,types,textwrap
request=json.load(sys.stdin); tree=ast.parse(request['child'])
names={'marker_names','execution_names','service_names','sync_names'}
nodes=[n for n in tree.body if isinstance(n,(ast.Import,ast.ImportFrom,ast.FunctionDef)) or isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id in names for t in n.targets)]
ns={}; exec(compile(ast.Module(body=nodes,type_ignores=[]),'<actual finite child>','exec'),ns)
running=dict(line.split('=',1) for line in request['service'].splitlines())
running.update(MainPID='200',ExecMainPID='200',ExecMainCode='0',ExecMainStatus='0',ExecMainStartTimestampMonotonic='1000000',ExecMainExitTimestampMonotonic='0',InvocationID='a'*32,NRestarts='0',ActiveState='active',ControlGroup='/fixture.service')
running['ExecStart']=running['ExecStart'].replace('start_time=[fixture-start]','start_time=[n/a]').replace('pid=200','pid=0').replace('status=0','status=0/0')
def read(p): raise FileNotFoundError(p)
ns.update(config={},read=read,group_path=lambda g:'/fixture-group',members=lambda g:[],os=types.SimpleNamespace(path=types.SimpleNamespace(exists=lambda p:False,isabs=lambda p:p.startswith('/'),realpath=lambda p:p)))
ns['configured']=lambda unit,v:ns['facts'](v); ns['result']={'sync':running,'killed':True,'stopped':True,'processes':[[200,'100']]}
killed=dict(running,ActiveState='failed',MainPID='0',ExecMainCode='2',ExecMainStatus='9',ExecMainExitTimestampMonotonic='2000000')
killed['ExecStart']=running['ExecStart'].replace('start_time=[n/a] ; stop_time=[n/a] ; pid=0 ; code=(null) ; status=0/0','start_time=[fixture-start] ; stop_time=[fixture-stop] ; pid=200 ; code=killed ; status=9/KILL')
ns['stopped'](killed); ns['stopped'](dict(killed,ActiveState='inactive'))
for key,wrong in [('ExecMainStatus','15'),('ExecMainCode','1'),('MainPID','201'),('ActiveState','active'),('ActiveState','deactivating')]:
 try: ns['stopped'](dict(killed,**{key:wrong}))
 except RuntimeError: pass
 else: raise AssertionError('accepted stopped drift '+key)
for record in ['code=killed ; status=15/TERM','code=exited ; status=1','code=killed ; status=9/TERM']:
 bad=dict(killed,ExecStart=killed['ExecStart'].replace('code=killed ; status=9/KILL',record))
 try: ns['stopped'](bad)
 except RuntimeError: pass
 else: raise AssertionError('accepted stopped record '+record)
units={'pocketbase':{'ActiveState':'inactive','MainPID':'0'},'velocity-sync':{'ActiveState':'failed','MainPID':'0','ExecMainCode':'2','ExecMainStatus':'9'}}
local={'require':ns['require'],'props':lambda unit,names:{k:units[unit][k] for k in names}}
exec(textwrap.dedent(request['nested']),local); local['check_stopped']()
for unit,key,wrong in [('velocity-sync','ExecMainStatus','15'),('velocity-sync','ExecMainCode','1'),('velocity-sync','MainPID','201'),('pocketbase','ActiveState','failed')]:
 saved=units[unit][key]; units[unit][key]=wrong
 try: local['check_stopped']()
 except RuntimeError: pass
 else: raise AssertionError('accepted unstopped '+unit+' '+key)
 units[unit][key]=saved
print(json.dumps({'passed':True}))
`;
  const response = cp.spawnSync('python3', ['-I', '-c', script], { input: JSON.stringify({ child, nested, service: fixtureService('/fixture/backend/scripts') }), encoding: 'utf8', timeout: 10000 });
  assert.equal(response.status, 0, response.stderr);
  assert.equal(JSON.parse(response.stdout).passed, true);
});

// Install replaces backend/scripts while the proxies still run from it until
// after the new sync starts; Linux then reports their cwd as "<dir> (deleted)".
test('unrestarted website proxies keep their stop-time working directory inode while PocketBase, Java and sync stay strict', () => {
  const source = fs.readFileSync(path.join(projectRoot, 'scripts/deployment.mjs'), 'utf8');
  const child = /const finiteRootSource = String.raw`([\s\S]*?)`;/u.exec(source)?.[1]; assert.ok(child);
  const script = String.raw`import ast,json,sys,types
request=json.load(sys.stdin); tree=ast.parse(request['child'])
names={'marker_names','execution_names','service_names','sync_names'}
nodes=[n for n in tree.body if isinstance(n,(ast.Import,ast.ImportFrom,ast.FunctionDef)) or isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id in names for t in n.targets)]
ns={}; exec(compile(ast.Module(body=nodes,type_ignores=[]),'<actual finite child>','exec'),ns)
def unit_value(text,unit,pid):
 value=dict(line.split('=',1) for line in text.splitlines())
 value['ExecStart']=value['ExecStart'].replace('start_time=[fixture-start]','start_time=[n/a]').replace('pid=200','pid=0').replace('status=0','status=0/0')
 value.update(MainPID=pid,ExecMainPID=pid,ExecMainCode='0',ExecMainStatus='0',ExecMainStartTimestampMonotonic='1000000',ExecMainExitTimestampMonotonic='0',InvocationID='a'*32,NRestarts='0',ActiveState='active',ControlGroup='/'+unit+'.service')
 return value
units={'pocketbase':unit_value(request['pocketbase'],'pocketbase','200'),'map-proxy':unit_value(request['proxy'],'map-proxy','300')}
files={}; paths={}; inodes={}
def process(pid,unit,start,cwd,inode):
 base='/proc/'+pid; command=ns['facts'](units[unit])['configuration']['ExecStart'][0]
 files.update({base+'/stat':('1 (x) '+' '.join(['0']*19+[start])).encode(),base+'/cmdline':b''.join(x.encode()+b'\0' for x in command['argv']),base+'/cgroup':('0::/'+unit+'.service\n').encode(),base+'/status':b'Uid: 1000 1000 1000 1000\nGid: 1000 1000 1000 1000\n'})
 paths.update({base+'/exe':command['path'],base+'/cwd':cwd}); inodes[base+'/cwd']=inode
def read(p):
 if p not in files: raise FileNotFoundError(p)
 return files[p]
ns.update(read=read,os=types.SimpleNamespace(stat=lambda p:types.SimpleNamespace(st_dev=64770,st_ino=inodes[p]),path=types.SimpleNamespace(realpath=lambda p:paths.get(p,p),isabs=lambda p:p.startswith('/'))),
 pwd=types.SimpleNamespace(getpwnam=lambda u:types.SimpleNamespace(pw_uid=1000,pw_gid=1000)),grp=types.SimpleNamespace(getgrnam=lambda g:types.SimpleNamespace(gr_gid=1000)),
 props=lambda unit,names:dict(units[unit]),configured=lambda unit,v:ns['facts'](v),result={},
 config={'websiteServices':['pocketbase','velocity-sync','map-proxy']},r={'serviceEvidence':{unit:{'runtime':ns['facts'](value)['runtime']} for unit,value in units.items()}})
def refused(phase,case):
 try: ns['service_phases'](phase)
 except RuntimeError: return
 raise AssertionError('accepted '+case)
scripts='/fixture/site/backend/scripts'
process('200','pocketbase','100','/fixture/site/backend',1001); process('300','map-proxy','150',scripts+' (deleted)',919512)
refused('stop','deleted working directory before install')
process('300','map-proxy','150',scripts,919512); ns['service_phases']('stop')
stop=ns['result']['servicePhases']['stop']
assert stop['map-proxy']['cwdIdentity']==[64770,919512] and stop['map-proxy']['processStart']=='150' and stop['pocketbase']['cwdIdentity']==[64770,1001]
# Install unlinks the proxy directory; PocketBase restarts from its retained directory.
paths['/proc/300/cwd']=scripts+' (deleted)'
units['pocketbase'].update(MainPID='201',ExecMainPID='201',ExecMainStartTimestampMonotonic='2000000',InvocationID='b'*32)
process('201','pocketbase','200','/fixture/site/backend',1002)
ns['service_phases']('cleanup-sync'); ns['service_phases']('cleanup-java')
assert ns['result']['servicePhases']['cleanup-java']['map-proxy']['cwdIdentity']==[64770,919512]
paths['/proc/300/cwd']=scripts; ns['service_phases']('cleanup-sync'); ns['service_phases']('cleanup-java')
for cwd,inode,case in [(scripts+' (deleted)',919513,'different inode'),(scripts,919513,'replacement directory'),('/fixture/site/backend/other (deleted)',919512,'different path'),(scripts+'.old (deleted)',919512,'renamed path'),(scripts+' (deleted) (deleted)',919512,'suffixed path')]:
 paths['/proc/300/cwd']=cwd; inodes['/proc/300/cwd']=inode
 for phase in ['cleanup-sync','cleanup-java']: refused(phase,case+' in '+phase)
paths['/proc/300/cwd']=scripts+' (deleted)'; inodes['/proc/300/cwd']=919512; ns['service_phases']('cleanup-java')
# PocketBase restarted before cleanup: even its stop-time inode never admits a deleted path.
paths['/proc/201/cwd']='/fixture/site/backend (deleted)'; inodes['/proc/201/cwd']=1001
for phase in ['cleanup-sync','cleanup-java']: refused(phase,'deleted PocketBase directory in '+phase)
paths['/proc/201/cwd']='/fixture/site/backend'; inodes['/proc/201/cwd']=1002
# Without the explicit stop-time binding (Java, old and new sync) running() stays strict.
try: ns['running'](units['map-proxy'])
except RuntimeError: pass
else: raise AssertionError('accepted deleted directory without a stop-time binding')
assert ns['running'](units['map-proxy'],[64770,919512])['pid']=='0'
try: ns['running'](units['map-proxy'],[64770,919513])
except RuntimeError: pass
else: raise AssertionError('accepted a different stop-time binding')
print(json.dumps({'passed':True}))
`;
  const response = cp.spawnSync('python3', ['-I', '-c', script], { input: JSON.stringify({ child, pocketbase: fixtureService('/fixture/site/backend', 'pocketbase'), proxy: fixtureService('/fixture/site/backend/scripts', 'map-proxy') }), encoding: 'utf8', timeout: 10000 });
  assert.equal(response.status, 0, response.stderr);
  assert.equal(JSON.parse(response.stdout).passed, true);
});

// systemd 255 starts ExecStart through systemd-executor, so `systemctl start`
// can return while MainPID still runs the executor instead of node.
test('new sync start waits at most five seconds for systemd-executor to exec the configured command', () => {
  const source = fs.readFileSync(path.join(projectRoot, 'scripts/deployment.mjs'), 'utf8');
  const child = /const finiteRootSource = String.raw`([\s\S]*?)`;/u.exec(source)?.[1]; assert.ok(child);
  assert.match(child, /old_sync=result\['sync'\]; await_exec\(current_sync\); running\(current_sync\)/);
  const script = String.raw`import ast,json,sys,types
request=json.load(sys.stdin); tree=ast.parse(request['child'])
names={'marker_names','execution_names','service_names','sync_names'}
nodes=[n for n in tree.body if isinstance(n,(ast.Import,ast.ImportFrom,ast.FunctionDef)) or isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id in names for t in n.targets)]
ns={}; exec(compile(ast.Module(body=nodes,type_ignores=[]),'<actual finite child>','exec'),ns)
value=dict(line.split('=',1) for line in request['service'].splitlines()); value['MainPID']='201'
clock=[0.0]; sleeps=[]; switch={}
def argv(*parts): return b''.join(x.encode()+b'\0' for x in parts)
def realpath(p):
 if p=='/proc/201/exe': return '/usr/bin/node' if clock[0]>=switch['exe'] else '/usr/lib/systemd/systemd-executor'
 return p
def read(p):
 if p!='/proc/201/cmdline': raise FileNotFoundError(p)
 return argv('/usr/bin/node','sync_velocity.js') if clock[0]>=switch['cmdline'] else argv('/usr/lib/systemd/systemd-executor','--deserialize','30')
def sleep(seconds): sleeps.append(seconds); clock[0]+=seconds
ns.update(read=read,os=types.SimpleNamespace(path=types.SimpleNamespace(realpath=realpath,isabs=lambda p:p.startswith('/'))),time=types.SimpleNamespace(monotonic=lambda:clock[0],sleep=sleep))
def attempt(exe,cmdline,service=value):
 clock[0]=0.0; sleeps.clear(); switch.update(exe=exe,cmdline=cmdline)
 try: ns['await_exec'](service)
 except RuntimeError: return False
 return True
assert attempt(0,0) and sleeps==[]
assert attempt(.1,.1) and .1<=clock[0]<.2 and max(sleeps)<=.02
assert attempt(0,.3) and .3<=clock[0]<.4
never=float('inf')
assert not attempt(never,never) and 5<=clock[0]<=5.05 and max(sleeps)<=.02
assert not attempt(5.5,5.5) and clock[0]<5.5
other=dict(value,ExecStart=value['ExecStart'].replace('argv[]=/usr/bin/node sync_velocity.js','argv[]=/usr/bin/node other.js'))
assert not attempt(0,0,other) and clock[0]>=5
for pid in ['0','','x1']:
 try: ns['await_exec'](dict(value,MainPID=pid))
 except RuntimeError: pass
 else: raise AssertionError('accepted invalid MainPID '+repr(pid))
print(json.dumps({'passed':True}))
`;
  const response = cp.spawnSync('python3', ['-I', '-c', script], { input: JSON.stringify({ child, service: fixtureService('/fixture/site/backend/scripts') }), encoding: 'utf8', timeout: 10000 });
  assert.equal(response.status, 0, response.stderr);
  assert.equal(JSON.parse(response.stdout).passed, true);
});


// ---------------------------------------------------------------------------------------------
// TCRN-HOLOLIVE-CN-INC-006 package A. Run 105 stopped after migrate because the post-migrate
// `git ls-remote` met one GnuTLS reset, with no timeout and no retry, and PocketBase stayed down.

// A scripted origin and a fake clock: attempts and backoff take no real time.
const equalMain = { status: 0, stdout: revision + '\trefs/heads/main\n' };
const otherMain = { status: 0, stdout: oldRevision + '\trefs/heads/main\n' };
const gnutlsReset = { status: 128, stderr: "fatal: unable to access 'https://github.com/fixture/site/': GnuTLS recv error (-110): The TLS connection was non-properly terminated.\n" };
const ownTimeout = { code: 'ETIMEDOUT', signal: 'SIGKILL', ms: currentMainPolicy.attemptTimeoutMs };
function scriptedOrigin(answers) {
  const origin = { time: 0, sleeps: [], calls: [] };
  origin.now = () => origin.time;
  origin.sleep = ms => { origin.sleeps.push(ms); origin.time += ms; };
  origin.run = options => {
    origin.calls.push(options);
    const answer = answers[Math.min(origin.calls.length - 1, answers.length - 1)];
    origin.time += answer.ms ?? 0;
    return { status: null, signal: null, code: null, stdout: '', stderr: '', ...answer };
  };
  origin.read = (policy = currentMainPolicy) => readCurrentMain(revision, { run: origin.run, sleep: origin.sleep, now: origin.now, policy });
  return origin;
}
function fakeClock() {
  const clock = { time: 0, sleeps: [] };
  clock.now = () => clock.time;
  clock.sleepSync = ms => { clock.sleeps.push(ms); clock.time += ms; };
  clock.sleep = async ms => { clock.sleeps.push(ms); clock.time += ms; };
  return clock;
}
test('INC-006 T-R1 current main: one GnuTLS reset, then the equal answer passes after one 5 s backoff', () => {
  const origin = scriptedOrigin([gnutlsReset, equalMain]), result = origin.read();
  assert.equal(origin.calls.length, 2); assert.deepEqual(origin.sleeps, [5000]);
  assert.deepEqual(result.attempts.map(item => [item.attempt, item.kind, item.outcome, item.status, item.timedOut]), [[1, 'transport', 'retry', 128, false], [2, 'equal', 'pass', 0, false]]);
  assert.match(result.attempts[0].stderrFirstLine, /^fatal: unable to access .*GnuTLS recv error \(-110\)/);
  assert.ok(origin.calls.every(options => options.timeout === 30000));
});
test('INC-006 T-R2 current main: a different SHA refuses at once with the unchanged meaning', () => {
  const origin = scriptedOrigin([otherMain, equalMain]);
  assert.throws(() => origin.read(), error => error.message === 'Stale main revision' && error.currentMain.attempts.length === 1 && error.currentMain.attempts[0].answer === oldRevision);
  assert.equal(origin.calls.length, 1); assert.deepEqual(origin.sleeps, []);
});
test('INC-006 T-R3 current main: a different SHA after a transport failure refuses at that attempt', () => {
  const origin = scriptedOrigin([gnutlsReset, otherMain, equalMain]);
  assert.throws(() => origin.read(), { message: 'Stale main revision' });
  assert.equal(origin.calls.length, 2); assert.deepEqual(origin.sleeps, [5000]);
});
test('INC-006 T-R4 current main: persistent transport failures refuse within the 300 s deadline', () => {
  const instant = scriptedOrigin([gnutlsReset]);
  assert.throws(() => instant.read(), error => /^Latest main unavailable after 6 transport failures \(last: fatal: unable to access/.test(error.message) && error.currentMain.attempts.length === 6);
  assert.equal(instant.calls.length, 6); assert.deepEqual(instant.sleeps, [5000, 10000, 20000, 30000, 30000]);
  // Every attempt reaches our own 30 s limit: the sixth ends at 275 s, inside the deadline.
  const stalled = scriptedOrigin([ownTimeout]);
  assert.throws(() => stalled.read(), /Latest main unavailable after 6 transport failures \(last: no answer within 30 s\)/);
  assert.equal(stalled.time, 275000); assert.ok(stalled.time <= currentMainPolicy.deadlineMs);
  // A shorter deadline: no attempt starts that could not finish before it.
  const bounded = scriptedOrigin([ownTimeout]);
  assert.throws(() => bounded.read({ ...currentMainPolicy, deadlineMs: 100000 }), error => /after 2 transport failures/.test(error.message) && error.currentMain.attempts.every(item => item.atMs + 30000 <= 100000));
  assert.equal(bounded.calls.length, 2); assert.equal(bounded.time, 65000);
});
test('INC-006 T-R5 current main: authentication and not-found answers refuse after one attempt', () => {
  for (const stderr of [
    "fatal: Authentication failed for 'https://github.com/fixture/site/'",
    "fatal: could not read Username for 'https://github.com': terminal prompts disabled",
    "remote: Repository not found.\nfatal: repository 'https://github.com/fixture/site/' not found",
    "fatal: unable to access 'https://github.com/fixture/site/': The requested URL returned error: 401",
    "fatal: unable to access 'https://github.com/fixture/site/': The requested URL returned error: 403",
    "fatal: unable to access 'https://github.com/fixture/site/': The requested URL returned error: 404",
    "fatal: 'origin' does not appear to be a git repository",
    'fatal: not a git repository (or any of the parent directories): .git',
  ]) {
    const origin = scriptedOrigin([{ status: 128, stderr: stderr + '\n' }, equalMain]);
    assert.throws(() => origin.read(), { message: 'Origin refused the main check (authentication or not found)' }, stderr);
    assert.equal(origin.calls.length, 1, stderr); assert.deepEqual(origin.sleeps, [], stderr);
  }
});
test('INC-006 T-R6 current main: a missing refs/heads/main (exit 2) refuses after one attempt', () => {
  const origin = scriptedOrigin([{ status: 2 }, equalMain]);
  assert.throws(() => origin.read(), { message: 'Main ref missing on origin' });
  assert.equal(origin.calls.length, 1);
});
test('INC-006 T-R7 current main: malformed answers refuse after one attempt', () => {
  for (const stdout of ['', '\n', equalMain.stdout + equalMain.stdout, equalMain.stdout + oldRevision + '\trefs/heads/maint\n', 'g'.repeat(40) + '\trefs/heads/main\n', revision.toUpperCase() + '\trefs/heads/main\n', revision.slice(1) + '\trefs/heads/main\n', 'a'.repeat(64) + '\trefs/heads/main\n', revision + ' refs/heads/main\n', revision + '\trefs/heads/mainline\n', revision + '\trefs/heads/main\r\n', ' ' + equalMain.stdout, revision]) {
    const origin = scriptedOrigin([{ status: 0, stdout }, equalMain]);
    assert.throws(() => origin.read(), { message: 'Malformed origin main answer' }, JSON.stringify(stdout));
    assert.equal(origin.calls.length, 1, JSON.stringify(stdout));
  }
});
test('INC-006 T-R8 current main: our own attempt timeout is retried', () => {
  const origin = scriptedOrigin([ownTimeout, equalMain]), result = origin.read();
  assert.deepEqual(result.attempts.map(item => [item.kind, item.timedOut, item.signal, item.status]), [['timeout', true, 'SIGKILL', null], ['equal', false, null, 0]]);
  assert.deepEqual(origin.sleeps, [5000]);
});
test('INC-006 current main: unknown exit-128 wording is retried (OD-3); spawn errors, other statuses and foreign signals refuse at once', () => {
  const unknown = scriptedOrigin([{ status: 128, stderr: 'fatal: an unforeseen remote helper failure\n' }, equalMain]);
  assert.deepEqual(unknown.read().attempts.map(item => item.kind), ['unknown-128', 'equal']);
  for (const [answer, message] of [[{ code: 'ENOENT' }, 'Origin main check could not run: ENOENT'], [{ code: 'EACCES' }, 'Origin main check could not run: EACCES'], [{ code: 'ENOBUFS' }, 'Origin main check could not run: ENOBUFS'], [{ status: 1 }, 'Unclassified origin main check result'], [{ status: 129 }, 'Unclassified origin main check result'], [{ status: null, signal: 'SIGSEGV' }, 'Unclassified origin main check result']]) {
    const origin = scriptedOrigin([answer, equalMain]);
    assert.throws(() => origin.read(), { message }, JSON.stringify(answer));
    assert.equal(origin.calls.length, 1, JSON.stringify(answer));
  }
  assert.throws(() => readCurrentMain('main', { run: () => assert.fail('git must not run') }), { message: 'Exact main revision required' });
  // The recorded first line never carries URL credentials.
  const credentials = scriptedOrigin([{ status: 128, stderr: "fatal: unable to access 'https://user:token@github.com/fixture/site/': Failed to connect to github.com port 443\n" }, equalMain]);
  assert.equal(credentials.read().attempts[0].stderrFirstLine, "fatal: unable to access 'https://***@github.com/fixture/site/': Failed to connect to github.com port 443");
});
// A fake git first on PATH: each call is counted, its arguments and git environment recorded,
// and its behaviour comes from the answer file for that call number.
const gitAnswers = {
  equal: String.raw`printf '%s\trefs/heads/main\n' ` + revision + '\nexit 0\n',
  different: String.raw`printf '%s\trefs/heads/main\n' ` + oldRevision + '\nexit 0\n',
  reset: String.raw`printf '%s\n' "fatal: unable to access 'https://github.com/fixture/site/': GnuTLS recv error (-110): The TLS connection was non-properly terminated." >&2` + '\nexit 128\n',
  forbidden: String.raw`printf '%s\n' "fatal: unable to access 'https://github.com/fixture/site/': The requested URL returned error: 403" >&2` + '\nexit 128\n',
  malformed: String.raw`printf 'not an answer\n'` + '\nexit 0\n',
  stall: 'exec sleep 30\n',
};
function fakeGit(t) {
  const directory = temp(t), bin = path.join(directory, 'bin'), state = path.join(directory, 'state');
  fs.mkdirSync(bin); fs.mkdirSync(state);
  fs.writeFileSync(path.join(bin, 'git'), [
    '#!/bin/sh',
    'n=$(cat "$FAKE_GIT_STATE/count" 2>/dev/null || echo 0); n=$((n+1)); echo "$n" > "$FAKE_GIT_STATE/count"',
    String.raw`printf '%s\n' "$*" >> "$FAKE_GIT_STATE/args"`,
    String.raw`env | grep -E '^(GIT_TERMINAL_PROMPT|LC_ALL|GIT_HTTP_LOW_SPEED_LIMIT|GIT_HTTP_LOW_SPEED_TIME)=' | sort > "$FAKE_GIT_STATE/env-$n"`,
    'answer="$FAKE_GIT_STATE/answer-$n"; [ -f "$answer" ] || answer="$FAKE_GIT_STATE/answer"',
    '. "$answer"', '',
  ].join('\n'), { mode: 0o755 });
  fs.chmodSync(path.join(bin, 'git'), 0o755);
  return {
    state, environment: { ...process.env, PATH: bin + path.delimiter + process.env.PATH, FAKE_GIT_STATE: state },
    answer: (body, call) => fs.writeFileSync(path.join(state, call ? 'answer-' + call : 'answer'), body),
    read: name => { try { return fs.readFileSync(path.join(state, name), 'utf8'); } catch (error) { if (error.code === 'ENOENT') return ''; throw error; } },
    reset: () => { for (const name of fs.readdirSync(state)) fs.rmSync(path.join(state, name)); },
  };
}
test('INC-006 T-R8 current main: a stalled git is killed at the attempt timeout and the next attempt answers', t => {
  const git = fakeGit(t); git.answer(gitAnswers.stall, 1); git.answer(gitAnswers.equal);
  const saved = { PATH: process.env.PATH, FAKE_GIT_STATE: process.env.FAKE_GIT_STATE };
  Object.assign(process.env, { PATH: git.environment.PATH, FAKE_GIT_STATE: git.state });
  try {
    const started = performance.now();
    const result = readCurrentMain(revision, { policy: { maxAttempts: 2, attemptTimeoutMs: 2000, backoffMs: [100], deadlineMs: 20000 } });
    assert.ok(performance.now() - started < 15000, 'the stalled attempt ended at its own timeout');
    assert.deepEqual(result.attempts.map(item => [item.kind, item.timedOut, item.signal]), [['timeout', true, 'SIGKILL'], ['equal', false, null]]);
    assert.equal(git.read('count'), '2\n');
  } finally { for (const [key, value] of Object.entries(saved)) if (value === undefined) delete process.env[key]; else process.env[key] = value; }
});
test('INC-006 T-R11 current-main action: the workflow pre-check passes only an equal answer, with the bounded git environment', t => {
  const git = fakeGit(t), script = path.join(projectRoot, 'scripts/deployment.mjs');
  const cli = (sha = revision) => cp.spawnSync(process.execPath, [script, 'current-main', sha], { env: git.environment, encoding: 'utf8', timeout: 120000 });
  git.reset(); git.answer(gitAnswers.equal);
  let run = cli(); assert.equal(run.status, 0, run.stderr);
  const answer = JSON.parse(run.stdout);
  assert.equal(answer.currentMain, 'equal'); assert.equal(answer.revision, revision); assert.equal(answer.attempts.length, 1);
  assert.equal(git.read('args'), 'ls-remote --exit-code origin refs/heads/main\n');
  assert.equal(git.read('env-1'), 'GIT_HTTP_LOW_SPEED_LIMIT=1000\nGIT_HTTP_LOW_SPEED_TIME=10\nGIT_TERMINAL_PROMPT=0\nLC_ALL=C\n');
  for (const [name, message] of [['different', 'Stale main revision'], ['forbidden', 'Origin refused the main check (authentication or not found)'], ['malformed', 'Malformed origin main answer']]) {
    git.reset(); git.answer(gitAnswers[name]);
    run = cli(); assert.equal(run.status, 1, name); assert.equal(run.stderr.split('\n')[0], message, name);
    assert.match(run.stderr, /^Origin main attempts: \[/m, name); assert.equal(git.read('count'), '1\n', name);
  }
  // One reset, the real 5 s backoff (Atomics.wait), then the equal answer.
  git.reset(); git.answer(gitAnswers.reset, 1); git.answer(gitAnswers.equal);
  const started = performance.now(); run = cli(); const elapsed = performance.now() - started;
  assert.equal(run.status, 0, run.stderr); assert.equal(JSON.parse(run.stdout).attempts.length, 2); assert.ok(elapsed >= 5000, 'the backoff slept ' + elapsed);
  assert.equal(git.read('args'), 'ls-remote --exit-code origin refs/heads/main\n'.repeat(2));
  // An invalid revision never reaches git.
  git.reset(); run = cli('main');
  assert.equal(run.status, 1); assert.equal(run.stderr, 'Exact main revision required\n'); assert.equal(git.read('count'), '');
});
test('INC-006 T-R11 the workflow runs the current-main action before npm ci, and the module needs Node builtins only', () => {
  const workflow = fs.readFileSync(path.join(projectRoot, '.github/workflows/deploy.yml'), 'utf8');
  const call = '          node scripts/deployment.mjs current-main "$DEPLOY_REVISION"\n';
  assert.equal(workflow.includes('ls-remote'), false); assert.equal(workflow.split(call).length, 2);
  assert.ok(workflow.indexOf(call) > workflow.indexOf('name: Refuse stale or unconfigured deployment') && workflow.indexOf(call) < workflow.indexOf('npm ci'));
  const source = fs.readFileSync(path.join(projectRoot, 'scripts/deployment.mjs'), 'utf8');
  const specifiers = [...source.matchAll(/^import\s.*?\sfrom\s+'([^']+)';$/gm)].map(match => match[1]);
  assert.ok(specifiers.length >= 5 && specifiers.every(name => name.startsWith('node:')), specifiers.join(','));
  assert.doesNotMatch(source, /\bimport\(/);
});
test('INC-006 T-R9 deploy(): a transient post-migrate main check is retried and the run deploys', async () => {
  const f = fixture(), origin = scriptedOrigin([equalMain, gnutlsReset, equalMain]);
  f.adapter.assertCurrent = async () => { f.calls.push(['assertCurrent']); origin.read(); };
  assert.equal((await deploy(f.adapter, config, revision, 14)).status, 'deployed');
  const names = f.calls.map(call => call[0] + (typeof call[1] === 'string' ? ':' + call[1] : ''));
  assert.equal(names.filter(name => name === 'assertCurrent').length, 2);
  assert.ok(names.indexOf('migrate') < names.lastIndexOf('assertCurrent') && names.lastIndexOf('assertCurrent') < names.indexOf('start:pocketbase'));
  assert.equal(origin.calls.length, 3); assert.deepEqual(origin.sleeps, [5000]);
  assert.equal(f.calls.some(call => call[0] === 'failure'), false); assert.equal(f.calls.some(call => call[0] === 'record'), true);
});
test('INC-006 T-R9 deploy(): a persistent or different post-migrate main answer records the failure and starts nothing', async () => {
  for (const [answers, reason, calls] of [[[equalMain, gnutlsReset], /^Latest main unavailable after 6 transport failures/, 7], [[equalMain, otherMain], /^Stale main revision$/, 2]]) {
    const f = fixture(), origin = scriptedOrigin(answers);
    f.adapter.assertCurrent = async () => { f.calls.push(['assertCurrent']); origin.read(); };
    await assert.rejects(deploy(f.adapter, config, revision, 15), error => reason.test(error.message));
    assert.equal(origin.calls.length, calls);
    const failures = f.calls.filter(call => call[0] === 'failure'); assert.equal(failures.length, 1);
    const record = failures[0][1];
    assert.equal(record.phase, 'assertCurrent:post-migrate'); assert.equal(record.servicesMayBeStopped, true); assert.match(record.reason, reason);
    assert.deepEqual(record.completedPhases.slice(-2), ['install', 'migrate']);
    assert.ok(record.recovery.some(text => /restore the application and backend\/pb_data from this run's own backup/.test(text)));
    assert.equal(f.calls.some(call => call[0] === 'start'), false); assert.equal(f.calls.some(call => call[0] === 'record'), false);
    assert.equal(f.calls.at(-1)[0], 'unlock');
  }
});
test('INC-006 T-R10 production adapter: a GnuTLS reset of git ls-remote is retried and the records carry the attempt history', async t => productionFixture(t, f => {
  const original = cp.execFileSync, gitCalls = [];
  let resets = 1, persistent = false;
  cp.execFileSync = (file, args, options) => {
    if (file === 'git') {
      gitCalls.push({ args, options });
      if (resets-- > 0 || persistent) { f.commands.push([file, ...args]); throw Object.assign(new Error('Command failed: git ' + args.join(' ') + '\n' + gnutlsReset.stderr), { status: 128, signal: null, stdout: '', stderr: gnutlsReset.stderr }); }
    }
    return original(file, args, options);
  }; syncBuiltinESMExports();
  try {
    const clock = fakeClock(), adapter = productionAdapter(f.bundle, f.config, revision, 2, f.configFile, { clock });
    adapter.verify(); adapter.lock(); adapter.assertCurrent();
    assert.deepEqual(clock.sleeps, [5000]); assert.equal(gitCalls.length, 2);
    for (const call of gitCalls) {
      assert.deepEqual(call.args, ['ls-remote', '--exit-code', 'origin', 'refs/heads/main']);
      assert.equal(call.options.timeout, 30000); assert.equal(call.options.killSignal, 'SIGKILL');
      assert.deepEqual([call.options.env.GIT_TERMINAL_PROMPT, call.options.env.LC_ALL, call.options.env.GIT_HTTP_LOW_SPEED_LIMIT, call.options.env.GIT_HTTP_LOW_SPEED_TIME], ['0', 'C', '1000', '10']);
    }
    adapter.record({ status: 'deployed', revision, runNumber: 2 });
    let state = JSON.parse(fs.readFileSync(f.state));
    assert.equal(state.currentMainChecks[0].result, 'equal');
    assert.deepEqual(state.currentMainChecks[0].attempts.map(item => [item.kind, item.status, item.timedOut]), [['transport', 128, false], ['equal', 0, false]]);
    assert.match(state.currentMainChecks[0].attempts[0].stderrFirstLine, /GnuTLS recv error \(-110\)/);
    persistent = true;
    assert.throws(() => adapter.assertCurrent(), /Latest main unavailable after 6 transport failures/);
    adapter.failure({ status: 'failed', revision, reason: 'fixture' });
    state = JSON.parse(fs.readFileSync(f.state));
    assert.equal(state.currentMainChecks[1].result, 'refused'); assert.equal(state.currentMainChecks[1].attempts.length, 6);
    assert.ok(state.currentMainChecks[1].attempts.every(item => item.kind === 'transport' && /GnuTLS/.test(item.stderrFirstLine)));
    adapter.unlock();
  } finally { cp.execFileSync = original; syncBuiltinESMExports(); }
}));

test('INC-006 CC-2 host commands carry a per-class timeout with SIGKILL', async t => productionFixture(t, f => {
  const original = cp.execFileSync, seen = [];
  cp.execFileSync = (file, args, options) => {
    seen.push([path.basename(file), args[0] === '-n' ? args[1] : args[0], options?.timeout, options?.killSignal]);
    if (file === 'python3') return '{}';
    if (file.endsWith('/backend/pocketbase') && args[0] === 'migrate') return '';
    return original(file, args, options);
  }; syncBuiltinESMExports();
  try {
    const adapter = f.adapter;
    adapter.verify(); adapter.velocity(); adapter.stop('pocketbase'); adapter.start('map-proxy');
    assert.deepEqual(checkDatabases(f.webRoot), {});
    // This isolated call has no backup directory, so it stops right after the migrate command.
    assert.throws(() => adapter.migrate(), { code: 'ERR_INVALID_ARG_TYPE' });
    const kind = ([file, first]) => file === 'python3' ? 'database' : file === 'pocketbase' && first === 'migrate' ? 'migrate' : file === 'sudo' ? 'serviceControl' : 'query';
    for (const call of seen) { assert.equal(call[2], hostCommandTimeouts[kind(call)], call.join(' ')); assert.equal(call[3], 'SIGKILL', call.join(' ')); }
    assert.deepEqual([...new Set(seen.map(kind))].sort(), ['database', 'migrate', 'query', 'serviceControl']);
    assert.deepEqual(hostCommandTimeouts, { query: 60000, serviceControl: 300000, database: 600000, migrate: 600000 });
  } finally { cp.execFileSync = original; syncBuiltinESMExports(); }
}));
test('INC-006 CC-2 a host command timeout reaches the failure record and the lock is released', async t => productionFixture(t, async f => {
  const original = cp.execFileSync;
  cp.execFileSync = (file, args, options) => {
    if (file === 'sudo' && args[1] === 'systemctl' && args[2] === 'stop' && args[3] === 'pocketbase') { f.commands.push([file, ...args]); throw Object.assign(new Error('spawnSync sudo ETIMEDOUT'), { code: 'ETIMEDOUT', signal: 'SIGKILL', status: null }); }
    return original(file, args, options);
  }; syncBuiltinESMExports();
  try {
    const reason = 'Host command timed out after 300 s: sudo -n systemctl stop pocketbase';
    await assert.rejects(deploy(f.adapter, f.config, revision, 2), error => error.message === reason && error.cause?.code === 'ETIMEDOUT');
    const failed = JSON.parse(fs.readFileSync(f.state));
    assert.equal(failed.status, 'failed'); assert.equal(failed.reason, reason); assert.equal(failed.phase, 'stop:pocketbase'); assert.equal(failed.servicesMayBeStopped, true);
    assert.deepEqual(failed.completedPhases, ['verify', 'lock', 'assertCurrent:pre-stop', 'velocity', 'stop:velocity-sync', 'guard']);
    assert.match(failed.recovery[0], /^1\. The PocketBase stop did not complete/);
    assert.ok(failed.recovery.some(text => /install did not run/.test(text)) && failed.recovery.some(text => /velocity-sync runtime leaf/.test(text)));
    assert.equal(failed.currentMainChecks[0].result, 'equal');
    assert.equal(fs.existsSync(path.join(f.config.stateRoot, 'deployment.lock')), false);
    assert.equal(f.commands.some(call => call[0] === 'sudo' && ['start', 'restart'].includes(call[3])), false);
  } finally { cp.execFileSync = original; syncBuiltinESMExports(); }
}));

test('INC-006 CC-3 pre-lock free space and inode floors refuse before any command or lock', async t => productionFixture(t, f => {
  const required = assertCapacity(f.config, f.bundle, { statfs: () => ampleFilesystem() });
  // The small fixture is below the measured attempt, so the floor is 2 x 2.6 GB.
  assert.equal(required.requiredBytes, capacityPolicy.safetyFactor * capacityPolicy.measuredAttemptBytes);
  assert.equal(required.liveEntries, 5);
  assert.equal(required.requiredInodes, capacityPolicy.safetyFactor * (capacityPolicy.copiesPerAttempt * 5 + inventory(f.bundle).length));
  const enough = { bavail: Math.ceil(required.requiredBytes / 4096), ffree: required.requiredInodes };
  for (const [name, low] of [['bytes', { bavail: enough.bavail - 1 }], ['inodes', { ffree: required.requiredInodes - 1 }]]) for (const root of [f.config.webRoot, f.config.backupRoot]) {
    fs.statfsSync = file => ampleFilesystem(file === root ? { ...enough, ...low } : enough);
    const commands = f.commands.length;
    assert.throws(() => f.createAdapter().verify(), error => error.message.startsWith('Insufficient free space on the filesystem of ' + root + ':'), name + ' ' + root);
    assert.equal(f.commands.length, commands, name + ' ' + root);
  }
  fs.statfsSync = () => ampleFilesystem(enough); f.createAdapter().verify();
  // A filesystem without a fixed inode table (no inode totals) is judged on bytes only.
  fs.statfsSync = () => ampleFilesystem({ ...enough, files: 0, ffree: 0 }); f.createAdapter().verify();
  for (const file of [f.state, f.guard, path.join(f.config.stateRoot, 'deployment.lock')]) assert.equal(fs.existsSync(file), false);
}));
test('INC-006 CC-3 the root child closure cap is checked before the lock for the live tree and the candidate', t => {
  const root = temp(t), bundle = path.join(root, 'bundle'), webRoot = path.join(root, 'site'), backupRoot = path.join(root, 'backup');
  fs.mkdirSync(bundle); createBundle(bundle); fs.mkdirSync(backupRoot);
  fs.mkdirSync(path.join(webRoot, 'backend/pb_data/storage'), { recursive: true }); fs.writeFileSync(path.join(webRoot, 'backend/pb_data/data.db'), 'data');
  fs.writeFileSync(path.join(webRoot, 'backend/pocketbase'), 'binary'); fs.cpSync(path.join(bundle, 'dist'), path.join(webRoot, 'dist'), { recursive: true });
  const statfs = () => ampleFilesystem(), settings = { webRoot, backupRoot };
  const counts = assertCapacity(settings, bundle, { statfs });
  // Live: dist (2) + pb_data, storage, data.db (3) + binary (1); candidate: bundle + the same data and binary.
  assert.equal(counts.liveEntries, 6); assert.equal(counts.candidateEntries, inventory(bundle).length + 4);
  assertCapacity(settings, bundle, { statfs, cap: counts.candidateEntries });
  assert.throws(() => assertCapacity(settings, bundle, { statfs, cap: counts.candidateEntries - 1 }), { message: `Candidate application closure would have ${counts.candidateEntries} entries; the next run's root child refuses more than ${counts.candidateEntries - 1}` });
  assert.throws(() => assertCapacity(settings, bundle, { statfs, cap: 5 }), { message: 'Live application closure has 6 entries; the root child refuses more than 5 after the stop' });
  // The JS cap is the root child's own cap.
  const source = fs.readFileSync(path.join(projectRoot, 'scripts/deployment.mjs'), 'utf8');
  assert.equal(rawClosureCap, 20000); assert.ok(source.includes(`len(raw_manifest['application'])<=${rawClosureCap}`));
  // The fields read from a real statfs exist on this Node version.
  const real = fs.statfsSync(root); for (const key of ['bavail', 'bsize', 'ffree', 'files']) assert.equal(typeof real[key], 'number', key);
});

test('INC-006 CC-11 pb_data entries the runner cannot remove are refused before the lock with a bounded sample', { skip: process.geteuid() === 0 && 'root bypasses directory permissions' }, async t => productionFixture(t, f => {
  const data = path.join(f.webRoot, 'backend/pb_data'), storage = path.join(data, 'storage'), records = path.join(storage, 'records');
  fs.mkdirSync(records, { recursive: true });
  const uploads = Array.from({ length: 12 }, (_, index) => path.join(records, 'upload-' + String(index).padStart(2, '0') + '.bin'));
  for (const file of uploads) fs.writeFileSync(file, 'upload made by PocketBase');
  // A read-only file in a writable directory is removable.
  fs.writeFileSync(path.join(data, 'read-only.db'), 'data'); fs.chmodSync(path.join(data, 'read-only.db'), 0o400);
  assertPbDataRemovable(f.webRoot); f.createAdapter().verify();
  fs.chmodSync(records, 0o555); t.after(() => { try { fs.chmodSync(records, 0o755); } catch (error) { if (error.code !== 'ENOENT') throw error; } });
  const blocked = [storage, records, ...uploads];
  const commands = f.commands.length;
  assert.throws(() => f.createAdapter().verify(), { message: `backend/pb_data entries not removable by runner (14): ${blocked.slice(0, 10).join(', ')}, ...` });
  assert.equal(f.commands.length, commands);
  for (const file of [f.state, f.guard, path.join(f.config.stateRoot, 'deployment.lock')]) assert.equal(fs.existsSync(file), false);
}));

// Loopback answers after the start: health, auth-with-password and protected reads are scripted.
function loopbackFixture(f, script) {
  const identities = [{ id: 'adminfixture001', role: 'admin' }, { id: 'svcfixture00001', role: 'service' }];
  f.config.recoveryIdentities = identities;
  f.config.targetAuthentication = identities.map(item => ({ ...item, identity: item.role + '@example.invalid', passwordEnv: 'INC006_FIXTURE_PASSWORD', ...(item.role === 'service' ? { services: ['velocity-sync'] } : {}) }));
  const requests = [], original = globalThis.fetch, password = process.env.INC006_FIXTURE_PASSWORD, clock = fakeClock();
  process.env.INC006_FIXTURE_PASSWORD = 'fixture-only';
  globalThis.fetch = async (url, init = {}) => {
    const route = new URL(url).pathname, kind = route === '/api/health' ? 'health' : route.endsWith('/auth-with-password') ? 'auth' : 'read';
    requests.push({ kind, route, signal: init.signal });
    const scripted = script(kind, requests.filter(item => item.kind === kind).length);
    if (scripted instanceof Error) throw scripted;
    let answer = scripted;
    if (!answer && kind === 'health') answer = { status: 200, body: { code: 200 } };
    if (!answer && kind === 'auth') { const item = identities.find(value => value.role + '@example.invalid' === JSON.parse(init.body).identity); answer = { status: 200, body: { token: 'token-' + item.id, record: { id: item.id, is_admin: true, service_account: item.role === 'service', verified: true } } }; }
    if (!answer) answer = { status: 200, body: { items: [] } };
    return new Response(JSON.stringify(answer.body), { status: answer.status, headers: { 'Content-Type': 'application/json' } });
  };
  return { requests, clock, adapter: productionAdapter(f.bundle, f.config, revision, 2, f.configFile, { clock }), count: kind => requests.filter(item => item.kind === kind).length,
    restore: () => { globalThis.fetch = original; if (password === undefined) delete process.env.INC006_FIXTURE_PASSWORD; else process.env.INC006_FIXTURE_PASSWORD = password; } };
}
test('INC-006 CC-5 health is decided by the loop success flag: healthy at the third request, then no further health request', async t => productionFixture(t, async f => {
  const loop = loopbackFixture(f, (kind, count) => kind !== 'health' || count === 3 ? undefined : count === 2 ? { status: 503, body: { code: 503 } } : new TypeError('fetch failed'));
  try {
    await loop.adapter.health();
    assert.equal(loop.count('health'), 3); assert.deepEqual(loop.clock.sleeps, [500, 500]);
    assert.equal(loop.count('auth'), 2); assert.equal(loop.count('read'), 2);
    assert.ok(loop.requests.every(item => item.signal instanceof AbortSignal));
  } finally { loop.restore(); }
}));
test('INC-006 CC-5 health that never answers 200 refuses after 30 bounded requests without authenticating', async t => productionFixture(t, async f => {
  const loop = loopbackFixture(f, kind => kind === 'health' ? new TypeError('fetch failed') : undefined);
  try {
    await assert.rejects(loop.adapter.health(), { message: 'PocketBase startup health failed' });
    assert.equal(loop.requests.length, 30); assert.equal(loop.clock.sleeps.length, 30);
  } finally { loop.restore(); }
}));
test('INC-006 CC-5 loopback authentication retries a network error, a 5xx and a 429 boundedly', async t => productionFixture(t, async f => {
  for (const [name, failure] of [['network', () => new TypeError('fetch failed')], ['5xx', () => ({ status: 503, body: { message: 'unavailable' } })], ['429', () => ({ status: 429, body: { message: 'Too Many Requests.' } })]]) {
    const loop = loopbackFixture(f, (kind, count) => kind === 'auth' && count === 1 ? failure() : undefined);
    try {
      await loop.adapter.health();
      assert.equal(loop.count('auth'), 3, name); assert.deepEqual(loop.clock.sleeps, [loopbackPolicy.retryDelayMs], name);
    } finally { loop.restore(); }
  }
}));
test('INC-006 CC-5 any other loopback answer is final; persistent failures stop after three attempts', async t => productionFixture(t, async f => {
  for (const [script, message, kind, attempts, sleeps] of [
    [kind => kind === 'auth' ? { status: 401, body: { message: 'Failed to authenticate.' } } : undefined, 'Target authentication failed', 'auth', 1, []],
    [kind => kind === 'auth' ? { status: 400, body: { message: 'Failed to authenticate.' } } : undefined, 'Target authentication failed', 'auth', 1, []],
    [kind => kind === 'auth' ? { status: 503, body: { message: 'unavailable' } } : undefined, 'Target authentication failed', 'auth', 3, [3000, 3000]],
    [kind => kind === 'read' ? new TypeError('fetch failed') : undefined, 'fetch failed', 'read', 3, [3000, 3000]],
  ]) {
    const loop = loopbackFixture(f, script);
    try {
      await assert.rejects(loop.adapter.health(), { message });
      assert.equal(loop.count(kind), attempts, message + ' ' + attempts); assert.deepEqual(loop.clock.sleeps, sleeps);
    } finally { loop.restore(); }
  }
}));

const deployPhase = { assertCurrent: 'assertCurrent:pre-stop', 'stop-velocity-sync': 'stop:velocity-sync', 'stop-pocketbase': 'stop:pocketbase', 'start-pocketbase': 'start:pocketbase', 'start-velocity-sync': 'start:velocity-sync', 'start-map-proxy': 'start:map-proxy' };
const deployOrder = ['verify', 'lock', 'assertCurrent:pre-stop', 'velocity', 'stop:velocity-sync', 'guard', 'stop:pocketbase', 'backup', 'rehearse', 'baseline', 'install', 'migrate', 'assertCurrent:post-migrate', 'start:pocketbase', 'health', 'start:velocity-sync', 'start:map-proxy', 'assertVelocity', 'record'];
test('INC-006 CC-6 the failure record names the phase reached, the completed phases, servicesMayBeStopped and an ordered recovery plan', async () => {
  const has = (plan, pattern) => pattern.test(plan.join('\n'));
  for (const stage of ['guard', 'stop-pocketbase', 'backup', 'rehearse', 'baseline', 'install', 'migrate', 'start-pocketbase', 'health', 'start-velocity-sync', 'start-map-proxy', 'assertVelocity', 'record']) {
    const f = fixture(stage); await assert.rejects(deploy(f.adapter, config, revision, 16), /injected/);
    const failures = f.calls.filter(call => call[0] === 'failure'); assert.equal(failures.length, 1, stage);
    const record = failures[0][1], phase = deployPhase[stage] ?? stage, plan = record.recovery;
    assert.equal(record.phase, phase, stage); assert.deepEqual(record.completedPhases, deployOrder.slice(0, deployOrder.indexOf(phase)), stage);
    assert.equal(record.servicesMayBeStopped, !['assertVelocity', 'record'].includes(stage), stage);
    assert.ok(plan.every((text, index) => text.startsWith(index + 1 + '. ')), stage);
    const among = (...stages) => stages.includes(stage);
    assert.equal(has(plan, /restore the application and backend\/pb_data from this run's own backup/), among('install', 'migrate', 'start-pocketbase'), stage + ' restore');
    assert.equal(has(plan, /install did not run, so the live application tree and backend\/pb_data are unchanged/), among('stop-pocketbase', 'backup', 'rehearse', 'baseline'), stage + ' no restore');
    assert.equal(has(plan, /Start PocketBase \(sudo systemctl start pocketbase\)/), among('stop-pocketbase', 'backup', 'rehearse', 'baseline', 'install', 'migrate', 'start-pocketbase'), stage + ' start');
    assert.equal(has(plan, /started on the installed and migrated candidate/), among('health', 'start-velocity-sync', 'start-map-proxy'), stage + ' candidate');
    assert.equal(has(plan, /Every website service was started again by this run/), among('assertVelocity', 'record'), stage + ' all started');
    assert.equal(has(plan, /velocity-sync runtime leaf/), !among('start-map-proxy', 'assertVelocity', 'record'), stage + ' sync leaf');
    assert.equal(has(plan, /map-proxy was not restarted by this run: check that each runs from the live backend\/scripts/), among('install', 'migrate', 'start-pocketbase', 'health', 'start-velocity-sync', 'start-map-proxy'), stage + ' proxy cwd');
    assert.equal(has(plan, /map-proxy was not touched by this run/), among('guard', 'stop-pocketbase', 'backup', 'rehearse', 'baseline'), stage + ' proxy untouched');
    assert.match(plan.at(-1), /archive \/fixture\/state\/deployment\.json \(for example as deployment\.failed-run-16\.json\)/);
  }
});
test('INC-006 CC-6 the recovery plan follows the runtime leaves the finite child still owns', () => {
  const completed = deployOrder.slice(0, deployOrder.indexOf('start:velocity-sync'));
  const plan = maintenance => recoveryPlan({ phase: 'start:velocity-sync', completed, config, maintenance, runNumber: 17 }).join('\n');
  let text = plan({ changed: true, leaves: { velocity: [1, 2] }, frozen: true, killed: true, stopped: true });
  assert.doesNotMatch(text, /velocity-sync runtime leaf/); assert.match(text, /velocity \(Java\) runtime leaf/); assert.doesNotMatch(text, /uncertain|still frozen/);
  text = plan({ changed: true, leaves: {}, frozen: true, killed: true, stopped: true });
  assert.doesNotMatch(text, /runtime leaf/); assert.match(text, /Start velocity-sync/);
  text = plan({ changed: true, uncertain: true });
  assert.match(text, /finite stop state is uncertain/); assert.match(text, /velocity-sync runtime leaf/); assert.match(text, /velocity \(Java\) runtime leaf/);
  text = recoveryPlan({ phase: 'stop:velocity-sync', completed: deployOrder.slice(0, 4), config, maintenance: { changed: true, leaves: { velocity: [1], 'velocity-sync': [2] }, frozen: true, killed: false }, runNumber: 17 }).join('\n');
  assert.match(text, /still frozen/); assert.doesNotMatch(text, /PocketBase/); assert.match(text, /map-proxy was not touched/);
  assert.deepEqual(recoveryPlan({ phase: 'velocity', completed: deployOrder.slice(0, 3), config, maintenance: null, runNumber: 17 }), ['1. Nothing was stopped or written by this run; no recovery is needed.']);
});
test('INC-006 CC-6 errors thrown by failure() or unlock() are reported after the original reason, never instead of it', async () => {
  let f = fixture('migrate');
  f.adapter.failure = async record => { f.calls.push(['failure', record]); throw new Error('state write failed: ENOSPC'); };
  await assert.rejects(deploy(f.adapter, config, revision, 18), error => error.message === 'injected migrate' && JSON.stringify(error.secondaryErrors) === JSON.stringify([{ step: 'failure', message: 'state write failed: ENOSPC' }]));
  assert.equal(f.calls.at(-1)[0], 'unlock');
  f = fixture('install');
  f.adapter.unlock = async () => { f.calls.push(['unlock']); throw new Error('Maintenance lock changed'); };
  let rejected;
  await assert.rejects(deploy(f.adapter, config, revision, 19), error => { rejected = error; return error.message === 'injected install'; });
  assert.deepEqual(rejected.secondaryErrors, [{ step: 'unlock', message: 'Maintenance lock changed' }]);
  assert.equal(f.calls.filter(call => call[0] === 'failure').length, 1);
  assert.equal(failureReport(rejected), 'injected install\nSecondary failure in unlock (the reason above is the original one): Maintenance lock changed\n');
  f = fixture('health');
  f.adapter.failure = async () => { throw new Error('record refused'); };
  f.adapter.unlock = async () => { throw new Error('unlock refused'); };
  await assert.rejects(deploy(f.adapter, config, revision, 20), error => error.message === 'injected health' && error.secondaryErrors.map(item => item.step).join() === 'failure,unlock');
  // After success an unlock failure still fails the run, as before.
  f = fixture();
  f.adapter.unlock = async () => { throw new Error('unlock refused after success'); };
  await assert.rejects(deploy(f.adapter, config, revision, 21), { message: 'unlock refused after success' });
  assert.equal(f.calls.some(call => call[0] === 'record'), true);
  // The origin attempt history follows the reason.
  let refused; try { scriptedOrigin([gnutlsReset]).read(); } catch (error) { refused = error; }
  const report = failureReport(refused).split('\n');
  assert.match(report[0], /^Latest main unavailable after 6 transport failures/);
  assert.equal(JSON.parse(report[1].slice('Origin main attempts: '.length)).length, 6);
});
test('INC-006 CC-6 a failed state write leaves the previous record intact and no partial file', async t => productionFixture(t, f => {
  const adapter = f.adapter; adapter.verify(); adapter.lock();
  adapter.record({ status: 'deployed', revision, runNumber: 1 });
  const previous = fs.readFileSync(f.state), firstInode = fs.statSync(f.state).ino, originalWrite = fs.writeFileSync;
  fs.writeFileSync = (target, data, ...rest) => {
    if (typeof target !== 'number') return originalWrite(target, data, ...rest);
    originalWrite(target, String(data).slice(0, 16)); // part of the new record reaches the disk
    throw Object.assign(new Error('ENOSPC: no space left on device, write'), { code: 'ENOSPC' });
  };
  try { assert.throws(() => adapter.failure({ status: 'failed', revision, reason: 'fixture' }), { code: 'ENOSPC' }); }
  finally { fs.writeFileSync = originalWrite; }
  assert.deepEqual(fs.readFileSync(f.state), previous); assert.equal(JSON.parse(previous).status, 'deployed');
  assert.deepEqual(fs.readdirSync(f.config.stateRoot).filter(name => name !== 'deployment.lock'), ['deployment.json']);
  // A successful write replaces the record by rename: complete bytes, private mode, a new inode.
  adapter.failure({ status: 'failed', revision, reason: 'fixture' });
  assert.equal(JSON.parse(fs.readFileSync(f.state)).status, 'failed'); assert.equal(fs.statSync(f.state).mode & 0o777, 0o600);
  assert.notEqual(fs.statSync(f.state).ino, firstInode);
  adapter.unlock();
}));

test('INC-006 CC-7 install refills backend/scripts in place: same inode, bundle content and modes, stale entries gone', t => {
  const root = temp(t), bundle = path.join(root, 'bundle'), live = path.join(root, 'live'), scripts = path.join(bundle, 'backend/scripts');
  fs.mkdirSync(bundle); createBundle(bundle);
  fs.mkdirSync(path.join(scripts, 'lib')); fs.writeFileSync(path.join(scripts, 'lib/proxy.js'), 'candidate library'); fs.chmodSync(path.join(scripts, 'lib/proxy.js'), 0o640);
  fs.symlinkSync('sync_velocity.js', path.join(scripts, 'current.js')); fs.chmodSync(scripts, 0o750);
  fs.writeFileSync(path.join(bundle, 'release.json'), JSON.stringify({ revision, paths: artifactPaths, files: inventory(bundle) }));
  const target = path.join(live, 'backend/scripts');
  fs.mkdirSync(path.join(target, 'stale-dir'), { recursive: true }); fs.writeFileSync(path.join(target, 'stale-dir/old.js'), 'old');
  fs.writeFileSync(path.join(target, 'sync_velocity.js'), 'old daemon'); fs.symlinkSync('sync_velocity.js', path.join(target, 'old-link.js')); fs.chmodSync(target, 0o700);
  const before = fs.statSync(target);
  installBundle(bundle, live, revision);
  const after = fs.statSync(target);
  assert.deepEqual([after.dev, after.ino], [before.dev, before.ino]);
  assert.deepEqual(inventory(live, ['backend/scripts']), inventory(bundle, ['backend/scripts']));
  assert.equal(after.mode & 0o777, 0o750); assert.equal(fs.statSync(path.join(target, 'lib/proxy.js')).mode & 0o777, 0o640);
  assert.equal(fs.readlinkSync(path.join(target, 'current.js')), 'sync_velocity.js');
  for (const stale of ['stale-dir', 'old-link.js']) assert.equal(fs.lstatSync(path.join(target, stale), { throwIfNoEntry: false }), undefined, stale);
  assert.equal(fs.readFileSync(path.join(target, 'sync_velocity.js'), 'utf8'), 'candidate protected daemon');
});
test('INC-006 CC-7 an aliased backend/scripts is refused before any artifact is touched; a directory the runner does not own is replaced as before', t => {
  const root = temp(t), bundle = path.join(root, 'bundle'), live = path.join(root, 'live'), elsewhere = path.join(root, 'elsewhere');
  fs.mkdirSync(bundle); createBundle(bundle);
  fs.mkdirSync(path.join(live, 'dist'), { recursive: true }); fs.writeFileSync(path.join(live, 'dist/old.js'), 'old frontend');
  fs.mkdirSync(path.join(live, 'backend')); fs.mkdirSync(elsewhere); fs.writeFileSync(path.join(elsewhere, 'keep.js'), 'unrelated');
  fs.symlinkSync(elsewhere, path.join(live, 'backend/scripts'));
  assert.throws(() => installBundle(bundle, live, revision), /Symlink/);
  assert.equal(fs.readFileSync(path.join(live, 'dist/old.js'), 'utf8'), 'old frontend'); assert.deepEqual(fs.readdirSync(elsewhere), ['keep.js']);
  fs.unlinkSync(path.join(live, 'backend/scripts')); fs.mkdirSync(path.join(live, 'backend/scripts')); fs.writeFileSync(path.join(live, 'backend/scripts/old.js'), 'old');
  const target = path.join(live, 'backend/scripts'), before = fs.statSync(target), lstat = fs.lstatSync;
  // Foreign ownership needs root to create; only the lstat owner of this one directory is substituted.
  fs.lstatSync = (file, ...args) => { const value = lstat(file, ...args); return file === target ? new Proxy(value, { get: (v, k) => k === 'uid' ? v.uid + 1 : Reflect.get(v, k) }) : value; };
  syncBuiltinESMExports();
  try { installBundle(bundle, live, revision); } finally { fs.lstatSync = lstat; syncBuiltinESMExports(); }
  assert.notEqual(fs.statSync(target).ino, before.ino);
  assert.deepEqual(inventory(live, ['backend/scripts']), inventory(bundle, ['backend/scripts']));
});

let removedFixture;
test('INC-006 CC-4 fixtures live in the run sandbox; RUNNER_TEMP is used when the runner sets it', t => {
  const root = temp(t); removedFixture = root;
  assert.equal(path.dirname(root), sandbox); assert.equal(os.tmpdir(), sandbox); assert.equal(process.env.TMPDIR, sandbox);
  fs.mkdirSync(path.join(root, 'read-only/nested'), { recursive: true }); fs.writeFileSync(path.join(root, 'read-only/nested/file'), 'fixture');
  fs.chmodSync(path.join(root, 'read-only/nested'), 0o555); fs.chmodSync(path.join(root, 'read-only'), 0o555);
  const runnerTemp = path.join(root, 'runner-temp'); fs.mkdirSync(runnerTemp);
  assert.equal(fixtureBase({ RUNNER_TEMP: runnerTemp }), fs.realpathSync(runnerTemp));
  assert.equal(fixtureBase({}), os.tmpdir()); assert.equal(fixtureBase({ RUNNER_TEMP: '' }), os.tmpdir());
  assert.throws(() => fixtureBase({ RUNNER_TEMP: 'relative/runner-temp' }), /Invalid RUNNER_TEMP for test fixtures/);
  assert.throws(() => fixtureBase({ RUNNER_TEMP: path.join(root, 'missing') }), { code: 'ENOENT' });
});
test('INC-006 CC-4 the previous fixture, read-only parts included, is gone after its test', { skip: retainFixtures && 'fixtures retained on request' }, () => {
  assert.ok(removedFixture); assert.equal(fs.existsSync(removedFixture), false);
});
// Keep this the last test of the file.
test('INC-006 CC-4 suite-level check: every fixture and PocketBase test directory of this file was removed', { skip: retainFixtures && 'fixtures retained on request' }, t => {
  assert.deepEqual(fixtureRoots.filter(root => fs.existsSync(root)), []);
  const fixtures = () => fs.readdirSync(sandbox).filter(name => /^hololive-(deployment|pb-test)-/.test(name));
  assert.deepEqual(fixtures(), []);
  // The check sees a leftover.
  const leftover = fs.mkdtempSync(path.join(sandbox, 'hololive-deployment-'));
  try { assert.deepEqual(fixtures(), [path.basename(leftover)]); } finally { removeFixture(leftover); }
  assert.deepEqual(fixtures(), []);
  for (const name of fs.readdirSync(sandbox)) t.diagnostic('other sandbox entry, removed with the sandbox: ' + name);
});
