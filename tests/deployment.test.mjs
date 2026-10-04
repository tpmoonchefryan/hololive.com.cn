import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { createHash } from 'node:crypto';
import { pocketbase, binaries, unusedPort, startOwned, waitFor, root as projectRoot } from './helpers/pocketbase.mjs';
import { artifactPaths, inventory, verifyBundle, validatePlan, deploy, installBundle, snapshotApplication, restoreBackup, verifyImmutableMigrations, productionAdapter, snapshotIdentity, verifySnapshot, createSafeRecovery, restoreSafeRecovery, checkDatabases, readMigrationLedger, serviceFacts } from '../scripts/deployment.mjs';
const revision = 'a'.repeat(40), oldRevision = 'b'.repeat(40);
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
  const commands = [], originalRead = fs.readFileSync, originalStat = fs.statSync, originalLstat = fs.lstatSync, originalRealpath = fs.realpathSync, originalExec = cp.execFileSync;
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
    fs.readFileSync = originalRead; fs.statSync = originalStat; fs.lstatSync = originalLstat; fs.realpathSync = originalRealpath; cp.execFileSync = originalExec; syncBuiltinESMExports();
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
    if(pb.service.child.exitCode===null&&pb.service.child.signalCode===null)await pb.close();
  }
}));

// Retained independent acceptance fixtures now exercise the fixed production
// entry, both PB versions, and the actual users authentication/API boundary.
test('safe recovery and deployment validate actual contracts, unlisted roles and target authentication on both PB versions', {skip: !process.env.PB_RETAINED_HISTORY_FILE}, async () => {
const evidence = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hololive-adapter-'))), project = projectRoot;
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
async function fixture(version,binary, suffix = '') {
  const local=path.join(root,'PB'+version+suffix);mkdir(local);
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
  const config={approvedRevision:candidate,repository:'fixture/acceptance006',webRoot,backupRoot:path.join(local,'backup'),stateRoot:path.join(local,'state'),velocityRoot:path.join(local,'velocity'),pocketbaseVersion:version,machineIdSha256:sha('isolated machine'),runnerUser:os.userInfo().username,websiteServices:['pocketbase','velocity-sync'],serviceBindings:{pocketbase:fixtureService(webRoot+'/backend','pocketbase'), 'velocity-sync':fixtureService(webRoot+'/backend/scripts')},velocityServiceBinding:'Requires=\nBindsTo=\nPartOf=',protectedVelocityFiles:['velocity.toml','velocity.jar','forwarding.secret'],velocityPorts:[25565],configurationFiles:configFiles,nginxSiteFile:configFiles[2],pocketbaseHealthUrl:base+'/api/health',baselineReviewed:true,serviceIdentityReviewed:true,restoreRehearsalRequired:true,recoveryIdentities:identities,previousRevision:'b'.repeat(40)};
  const configFile=path.join(local,'config.json');write(configFile,config);
  const work=path.join(local,'approved-working');mkdir(path.join(work,'backend'));
  copyWithModes(path.join(webRoot,'backend/pb_data'),path.join(work,'backend/pb_data'),{recursive:true});
  const forward=rawExec(binary,['migrate','up','--dir',path.join(work,'backend/pb_data'),'--migrationsDir',path.join(bundle,'backend/pb_migrations'),'--hooksDir',path.join(bundle,'backend/pb_hooks')],{encoding:'utf8'});assert.doesNotMatch(forward,/Failed|Error:/);fs.writeFileSync(path.join(local,'actual-forward.stdout'),forward,{mode:0o600});
  sql(path.join(work,'backend/pb_data/data.db'),"import sqlite3,sys,json;c=sqlite3.connect(sys.argv[1]);[c.execute('update users set is_admin=1,service_account=? where id=?',(int(i['role']=='service'),i['id'])) for i in json.loads(sys.argv[2])];c.commit()",[JSON.stringify(identities)]);
  config.recoveryWorkingCopy=work;
  config.finiteStop={syncCodeSha256:sha(fs.readFileSync(path.join(webRoot,'backend/scripts/sync_velocity.js')))};write(configFile,config);
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
  if(file==='sudo'&&args[1]==='/usr/bin/python3') return finiteHostResponse(JSON.parse(options.input), {root:bound.local,commands:bound.commands,fail:bound.finiteFailure});
  bound.commands.push({file,args});
  if(file==='python3'||file===bound.binary||file===path.join(bound.webRoot,'backend/pocketbase'))return rawExec(file,args,options);
  if(file==='git'&&args[0]==='ls-remote')return candidate+'\trefs/heads/main\n';
  if(file==='systemctl'&&args[0]==='is-active')return 'active\n';
  if(file==='systemctl'&&args[0]==='show')return (args[1]==='velocity'&&args.includes('MainPID')?'MainPID=100\nExecMainStartTimestampMonotonic=123\nNRestarts=0\nActiveState=active':args[1]==='velocity'?(args.includes('ExecStart')?fixtureService(bound.config.velocityRoot,'velocity'):bound.config.velocityServiceBinding):bound.config.serviceBindings[args[1]])+'\n';
  if(file==='ss')return 'LISTEN 0 100 127.0.0.1:25565 0.0.0.0:*\n';
  if(file==='sudo'&&args[1]==='systemctl'){
    if(args[2]==='start'&&args[3]==='pocketbase')bound.running=startOwned(bound.binary,['serve','--automigrate=false','--http',new URL(bound.base).host,'--dir',path.join(bound.webRoot,'backend/pb_data'),'--migrationsDir',path.join(bound.webRoot,'backend/pb_migrations'),'--hooksDir',path.join(bound.webRoot,'backend/pb_hooks')]);
    return '';
  }
  throw new Error('Unapproved external command refused: '+file);
};syncBuiltinESMExports();
const environment={...process.env};Object.assign(process.env,{GITHUB_REPOSITORY:'fixture/acceptance006',GITHUB_RUN_ID:'6006',GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_SERVER_URL:'https://github.com'});
const adapter=(run=6)=>{
  const domain=bound;write(domain.configFile,domain.config);
  const actual=productionAdapter(bundle,domain.config,candidate,run,domain.configFile), stop=actual.stop;
  actual.stop=async unit=>{await stop(unit);if(unit==='pocketbase'&&domain.running){const service=await domain.running;await service.close();domain.running=null;}};
  return actual;
};
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

}finally{
  if(bound?.running){const service=await bound.running;await service.close();}
  Object.assign(fs,originals);cp.execFileSync=rawExec;syncBuiltinESMExports();for(const key of ['DISPOSABLE_HUMAN_TOKEN','DISPOSABLE_TARGET_PASSWORD','GITHUB_REPOSITORY','GITHUB_RUN_ID','GITHUB_EVENT_NAME','GITHUB_SERVER_URL'])if(environment[key]===undefined)delete process.env[key];else process.env[key]=environment[key];
}
write(path.join(evidence,'probes-003.json'),{candidate,root,production:false,isolation:'original productionAdapter/deploy and actual PB/file/SQLite operations; only finite host/service/command/external config bindings substituted; synthetic identities and anonymous records',observations});
console.log(JSON.stringify({observations:observations.length,passed:observations.filter(x=>x.passed).length,failed:observations.filter(x=>!x.passed).length,root,production:false}));
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
    const before = checkDatabases(database.directory + '/data');
    await database.service.close();
    const run = value => cp.spawnSync(binary, ['deployment-identity-supply', '--dir', path.join(database.directory,'data'), '--migrationsDir', database.migrations, '--hooksDir', path.join(projectRoot,'backend/pb_hooks')], { env: { ...process.env, PB_DEPLOYMENT_IDENTITY_INPUT: JSON.stringify(value) }, encoding: 'utf8', stdio: ['ignore','pipe','pipe'] });
    for (const value of [{ ...input, arbitrary: true }, { ...input, permission: permission.slice(1) }, { ...input, credentials: { ...credentials, [ids[1]]: credentials[ids[0]] } }]) { assert.notEqual(run(value).status, 0); assert.deepEqual(checkDatabases(database.directory + '/data'), before); }
    const supplied = run(input); assert.equal(supplied.status, 0, 'Offline supply refused; private output withheld');
    const proof = JSON.parse(supplied.stdout.trim().split('\n').at(-1));
    const payload = JSON.parse(Buffer.from(proof.token.split('.')[1], 'base64url'));
    assert.ok(payload.exp - Math.floor(Date.now() / 1000) <= 900 && payload.exp - Math.floor(Date.now() / 1000) >= 890); assert.equal(proof.humanId, humanId);
    const wrong = run({ ...input, credentials: { ...credentials, [ids[0]]: '5'.repeat(64) } }); assert.notEqual(wrong.status, 0);
    assert.equal(run(input).status, 0);
    await database.restart();
    const self = await database.request('/api/collections/users/records/' + humanId, { token: proof.token }); assert.equal(self.status, 200); assert.equal(self.data.is_admin, true); assert.equal(self.data.service_account, false); assert.equal(self.data.email, human.data.email);
    assert.equal((await database.request('/api/collections/users/auth-refresh', { token: proof.token, method: 'POST' })).status, 401);
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
