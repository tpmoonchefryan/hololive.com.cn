#!/usr/bin/env node
// Existing-host maintenance. Production bindings live in a separately approved,
// root-owned config; no default host, web root, service installation or accounts.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const artifactPaths = ['dist', 'backend/pb_migrations', 'backend/pb_hooks', 'backend/scripts', 'package.json', 'package-lock.json', 'node_modules'];
const units = ['pocketbase', 'velocity-sync', 'map-proxy', 'mcsm-proxy', 'pb-admin-gate', 'ai-translate-proxy'];
const sha = value => createHash('sha256').update(value).digest('hex');
const refuse = message => { throw new Error(message); };
const check = (condition, message) => { if (!condition) refuse(message); };
const command = (file, args) => execFileSync(file, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const safeRelative = name => typeof name === 'string' && !path.isAbsolute(name) && !name.split('/').some(p => p === '..' || p === '' || p === '.') && !name.includes('\\');
const json = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJSON = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });

export function inventory(root, names = artifactPaths) {
  const records = [];
  const walk = relative => {
    check(safeRelative(relative), 'Unsafe artifact path');
    const file = path.join(root, relative), stat = fs.lstatSync(file);
    if (stat.isSymbolicLink()) {
      const target = fs.readlinkSync(file);
      const resolved = path.resolve(path.dirname(file), target);
      check(!path.isAbsolute(target) && resolved.startsWith(path.resolve(root) + path.sep), 'External artifact symlink');
      check(fs.existsSync(resolved), 'Broken artifact symlink');
      records.push({ path: relative, link: target });
    } else if (stat.isDirectory()) {
      records.push({ path: relative, directory: true, mode: stat.mode & 0o777 });
      for (const name of fs.readdirSync(file).sort()) walk(relative + '/' + name);
    } else {
      check(stat.isFile(), 'Special artifact file refused');
      records.push({ path: relative, sha256: sha(fs.readFileSync(file)), mode: stat.mode & 0o777 });
    }
  };
  for (const name of names) walk(name);
  return records;
}

// Only a bundle uses the delivery closure. Backup/Velocity inventories have
// their own explicit names and must not inherit the application whitelist.
function verifyArtifactLinks(root, records) {
  const entries = new Map(records.map(record => [record.path, record]));
  const structural = new Set(artifactPaths.flatMap(name => name.split('/').slice(0, -1).map((_, i) => name.split('/').slice(0, i + 1).join('/'))));
  const resolve = (relative, seen = new Set()) => {
    check(safeRelative(relative), 'Artifact link outside delivery closure');
    const parts = relative.split('/');
    for (let i = 1; i <= parts.length; i++) {
      const prefix = parts.slice(0, i).join('/'), entry = entries.get(prefix);
      check(entry || structural.has(prefix), 'Artifact link references undelivered path: ' + prefix);
      if (entry?.link !== undefined) {
        check(!seen.has(prefix), 'Cyclic artifact link');
        const next = new Set(seen); next.add(prefix);
        const target = path.posix.normalize(path.posix.join(path.posix.dirname(prefix), entry.link, ...parts.slice(i)));
        return resolve(target, next);
      }
      if (i < parts.length) check(entry?.directory || structural.has(prefix), 'Artifact link traverses non-directory');
    }
    check(entries.has(relative), 'Artifact link references undelivered directory');
    return relative;
  };
  for (const entry of records) {
    check(!entry.path.split('/').some(name => name === '.env' || name.startsWith('.env.')), 'Environment cannot be a release artifact');
    if (entry.link !== undefined) {
      resolve(entry.path);
      const real = path.relative(path.resolve(root), fs.realpathSync(path.join(root, entry.path))).split(path.sep).join('/');
      check(real === resolve(entry.path), 'Artifact link resolution differs from delivery closure');
    }
  }
}

export function verifyBundle(root, revision) {
  assertRealPath(root);
  for (const name of artifactPaths) assertRealPath(path.dirname(path.join(root, name)));
  const manifest = json(path.join(root, 'release.json'));
  check(manifest.revision === revision && /^[a-f0-9]{40}$/.test(revision), 'Revision mismatch');
  check(JSON.stringify(manifest.paths) === JSON.stringify(artifactPaths), 'Incomplete artifact whitelist');
  const files = inventory(root);
  check(JSON.stringify(files) === JSON.stringify(manifest.files), 'Artifact content mismatch');
  verifyArtifactLinks(root, files);
  for (const required of ['dist/index.html', 'backend/pb_hooks', 'backend/pb_migrations', 'backend/scripts/sync_velocity.js', 'node_modules/@iarna/toml/package.json', 'node_modules/pocketbase/package.json', 'node_modules/eventsource/package.json']) check(fs.existsSync(path.join(root, required)), 'Missing runtime artifact: ' + required);
  const lock = json(path.join(root, 'package-lock.json'));
  for (const name of ['@iarna/toml', 'pocketbase', 'eventsource']) check(json(path.join(root, 'node_modules', name, 'package.json')).version === lock.packages['node_modules/' + name].version, 'Unlocked runtime dependency');
  return manifest;
}

export function validatePlan(config, revision, runNumber) {
  check(config.approvedRevision === revision && /^[a-f0-9]{40}$/.test(revision), 'Candidate is not approved');
  check(Number.isSafeInteger(runNumber) && runNumber > 0, 'Missing run ordering');
  for (const field of ['webRoot', 'backupRoot', 'stateRoot']) {
    const value = config[field];
    check(typeof value === 'string' && path.isAbsolute(value) && path.resolve(value) === value && value !== '/', 'Invalid ' + field);
  }
  const roots = [config.webRoot, config.backupRoot, config.stateRoot, config.velocityRoot];
  check(typeof config.velocityRoot === 'string' && path.isAbsolute(config.velocityRoot) && config.velocityRoot !== '/', 'Missing inventoried Velocity root');
  for (let i = 0; i < roots.length; i++) for (let j = i + 1; j < roots.length; j++) check(roots[i] !== roots[j] && !roots[i].startsWith(roots[j] + '/') && !roots[j].startsWith(roots[i] + '/'), 'Overlapping target/backup/state/Velocity paths');
  check(['0.26.5', '0.34.2'].includes(config.pocketbaseVersion), 'PocketBase version not verified/supported');
  check(config.machineIdSha256?.match(/^[a-f0-9]{64}$/) && typeof config.runnerUser === 'string', 'Missing machine/runner binding');
  check(Array.isArray(config.websiteServices) && config.websiteServices.includes('pocketbase') && config.websiteServices.includes('velocity-sync'), 'Missing website/sync quiescence binding');
  check(new Set(config.websiteServices).size === config.websiteServices.length && config.websiteServices.every(unit => units.includes(unit)), 'Unapproved service');
  const configurationWhitelist = [path.join(config.webRoot, 'backend/.env'), path.join(config.webRoot, '.env'), path.join(config.webRoot, 'backend/scripts/.env'), ...units.map(unit => '/etc/systemd/system/' + unit + '.service'), ...units.map(unit => '/etc/default/' + unit), config.nginxSiteFile];
  check(typeof config.nginxSiteFile === 'string' && config.nginxSiteFile.startsWith('/etc/nginx/sites-available/') && !config.nginxSiteFile.split('/').includes('..'), 'Missing inventoried nginx config');
  check(Array.isArray(config.configurationFiles) && config.configurationFiles.length > 0 && config.configurationFiles.every(file => typeof file === 'string' && path.isAbsolute(file) && configurationWhitelist.includes(file)), 'Missing limited configuration inventory');
check(config.serviceBindings && config.websiteServices.every(unit => typeof config.serviceBindings[unit] === 'string'), 'Missing actual service command/working directory bindings');
  for (const unit of config.websiteServices) {
    const directory = path.join(config.webRoot, unit === 'pocketbase' ? 'backend' : 'backend/scripts');
    check(config.serviceBindings[unit].split('\n').includes('WorkingDirectory=' + directory), 'Service working directory does not match target');
    check(config.configurationFiles.includes('/etc/systemd/system/' + unit + '.service'), 'Missing service config backup');
  }
  check(config.configurationFiles.includes(config.nginxSiteFile), 'Missing nginx configuration backup');
  check(typeof config.velocityServiceBinding === 'string', 'Missing Java reverse service dependency binding');
  check(config.velocityPorts?.length > 0 && config.velocityPorts.every(port => Number.isInteger(port) && port >= 1 && port <= 65535), 'Missing actual Velocity listener bindings');
  if (config.baseline?.kind === 'mixed') {
    check(config.previousRevision === undefined && config.baseline.sourceRevision === null, 'Mixed baseline must not invent a revision');
    check(/^[a-f0-9]{64}$/.test(config.baseline.snapshotId ?? ''), 'Missing immutable mixed snapshot binding');
    check(Array.isArray(config.baseline.retainedHistory) && Array.isArray(config.baseline.sourceAbsentHistory), 'Missing mixed history binding');
  } else check(/^[a-f0-9]{40}$/.test(config.previousRevision ?? ''), 'Missing actual previous revision');
  check(config.protectedVelocityFiles?.length >= 3 && config.protectedVelocityFiles.every(safeRelative), 'Missing Velocity file inventory');
  check(typeof config.pocketbaseHealthUrl === 'string' && /^http:\/\/127\.0\.0\.1:\d+\/api\/health$/.test(config.pocketbaseHealthUrl), 'Missing loopback health binding');
  check(config.baselineReviewed === true && config.serviceIdentityReviewed === true && config.restoreRehearsalRequired === true, 'Missing baseline/service identity/recovery prerequisites');
  return { revision, runNumber, artifactPaths, websiteServices: config.websiteServices, guard: 'backend/.velocity-maintenance' };
}

/** Shared order for production and isolated failure tests. No automatic rollback:
 * restoring production data is a separately approved act. Backups stay private.
 */
export async function deploy(adapter, config, revision, runNumber) {
  const plan = validatePlan(config, revision, runNumber);
  await adapter.verify();
  await adapter.lock();
  let stopped = false, backup;
  try {
    await adapter.assertCurrent(); // latest main + persistent monotonic run ordering under lock
    const before = await adapter.velocity();
    await adapter.stop('velocity-sync'); // old daemon must exit BEFORE guard/migrations
    stopped = true;
    await adapter.guard();
    await adapter.stop('pocketbase');
    backup = await adapter.backup(); // stopped PB => DB/WAL/media/application match
    await adapter.rehearse(backup); // private isolated copy, never the live directory
    await adapter.baseline(backup);
    await adapter.install();
    await adapter.migrate();
    await adapter.assertCurrent();
    await adapter.start('pocketbase');
    await adapter.health();
    for (const unit of config.websiteServices.filter(unit => unit !== 'pocketbase')) await adapter.start(unit);
    await adapter.assertVelocity(before);
    await adapter.record({ ...plan, backup, status: 'deployed', velocityProtected: true });
    return { status: 'deployed', revision, backup };
  } catch (error) {
    if (stopped) await adapter.failure({ status: 'failed', revision, backup: backup ?? null, servicesMayBeStopped: true, reason: error.message });
    throw error;
  } finally { await adapter.unlock(); }
}

function assertRealPath(file) {
  check(fs.realpathSync(file) === path.resolve(file), 'Symlink or unresolved production binding');
}
const lstatOptional = file => { try { return fs.lstatSync(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } };
// Finite maintenance endpoints: inspect missing leaves too, never follow a
// control alias, and do not truncate until the opened inode has been checked.
function controlPath(file) {
  assertRealPath(path.dirname(file));
  const stat = lstatOptional(file);
  check(!stat || (stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && (stat.mode & 0o077) === 0), 'Unsafe maintenance control endpoint');
  return stat;
}
function controlRead(file, validate = controlPath) {
  const before = validate(file);
  if (!before) return null;
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const opened = fs.fstatSync(fd), current = validate(file);
    check(current && opened.dev === current.dev && opened.ino === current.ino && opened.ino === before.ino, 'Maintenance endpoint changed during read');
    return JSON.parse(fs.readFileSync(fd, 'utf8'));
  } finally { fs.closeSync(fd); }
}
function controlWrite(file, value, validate = controlPath) {
  const before = validate(file);
  const fd = fs.openSync(file, fs.constants.O_RDWR | fs.constants.O_NOFOLLOW | (before ? 0 : fs.constants.O_CREAT | fs.constants.O_EXCL), 0o600);
  try {
    const opened = fs.fstatSync(fd), current = validate(file);
    check(current && opened.isFile() && opened.nlink === 1 && opened.dev === current.dev && opened.ino === current.ino && (!before || opened.ino === before.ino), 'Maintenance endpoint changed during write');
    fs.fchmodSync(fd, 0o600);
    fs.ftruncateSync(fd, 0);
    fs.writeFileSync(fd, value);
  } finally { fs.closeSync(fd); }
}

// Inventory all replacements before deleting the first artifact. Runtime
// environment overlap is deliberately refused rather than silently migrated.
function verifyInstallTargets(webRoot, configurationFiles = []) {
  assertRealPath(webRoot);
  for (const name of artifactPaths) {
    const dest = path.join(webRoot, name);
    assertRealPath(path.dirname(dest));
    const stat = lstatOptional(dest);
    if (stat) assertRealPath(dest);
    for (const file of configurationFiles) check(file !== dest && !file.startsWith(dest + path.sep), 'Runtime configuration overlaps replaced artifact');
    const inspect = directory => {
      const info = fs.lstatSync(directory);
      if (!info.isDirectory() || info.isSymbolicLink()) return;
      for (const name of fs.readdirSync(directory)) {
        check(name !== '.env' && !name.startsWith('.env.'), 'Runtime environment overlaps replaced artifact');
        const child = path.join(directory, name), childInfo = fs.lstatSync(child);
        if (childInfo.isDirectory() && !childInfo.isSymbolicLink()) inspect(child);
      }
    };
    if (stat) inspect(dest);
  }
}
export function checkDatabases(directory) {
  // Metadata only, never records/tokens. Run on a stopped snapshot, read-only.
  const script = `import sqlite3,json,pathlib,sys,tempfile,shutil
source=pathlib.Path(sys.argv[1])
out={}
with tempfile.TemporaryDirectory(prefix='hololive-snapshot-read-') as temporary:
 p=pathlib.Path(temporary)
 for f in source.glob('*.db'):
  shutil.copy2(f,p/f.name)
  wal=pathlib.Path(str(f)+'-wal')
  if wal.exists():shutil.copy2(wal,p/wal.name)
 for f in sorted(p.glob('*.db')):
  c=sqlite3.connect(str(f))
  q=c.execute('pragma quick_check').fetchall()
  assert q==[('ok',)],str(f)+' integrity failure'
  tables=[r[0] for r in c.execute("select name from sqlite_master where type='table' order by name")]
  out[f.name]={'integrity':'ok','tables':{t:{'count':c.execute('select count(*) from "'+t.replace('"','""')+'"').fetchone()[0],'fields':[r[1:3] for r in c.execute('pragma table_info("'+t.replace('"','""')+'")')]} for t in tables}}
  if '_migrations' in tables:out[f.name]['migrations']=list(c.execute('select * from _migrations'))
  if '_collections' in tables:out[f.name]['collectionContract']=list(c.execute('select * from _collections'))
  c.close()
assert 'data.db' in out,'Missing data database'
print(json.dumps(out))`;
  return JSON.parse(command('python3', ['-c', script, path.resolve(directory)]));
}
function copyPaths(from, to, names) {
  for (const name of names) {
    check(safeRelative(name), 'Unsafe copy path');
    const src = path.join(from, name), dst = path.join(to, name);
    check(fs.existsSync(src), 'Missing backup/artifact: ' + name);
    fs.mkdirSync(path.dirname(dst), { recursive: true, mode: 0o700 });
fs.cpSync(src, dst, { recursive: true, preserveTimestamps: true, dereference: false, verbatimSymlinks: true });
    const preserveMode = (source, target) => {
      const stat = fs.lstatSync(source);
      if (stat.isSymbolicLink()) return;
      fs.chmodSync(target, stat.mode & 0o777);
      if (stat.isDirectory()) for (const entry of fs.readdirSync(source)) preserveMode(path.join(source, entry), path.join(target, entry));
    };
    preserveMode(src, dst);
  }
}

export function verifyImmutableMigrations(bundle, webRoot, baseline) {
  const directory = path.join(webRoot, 'backend/pb_migrations');
  if (!fs.existsSync(directory)) return;
  const source = new Map(inventory(bundle, ['backend/pb_migrations']).map(record => [record.path, record]));
for (const record of inventory(webRoot, ['backend/pb_migrations'])) {
    const expected = source.get(record.path);
    const retained = baseline?.kind === 'mixed' && baseline.retainedHistory?.find(item => item.path === record.path);
    check((expected && expected.sha256 === record.sha256 && expected.directory === record.directory && expected.link === record.link) || (!expected && retained && retained.sha256 === record.sha256 && !record.link && !record.directory), 'Unknown or modified production migration: ' + record.path);
  }
}

export function installBundle(bundle, webRoot, revision, baseline, backup) {
  const manifest = verifyBundle(bundle, revision);
  assertRealPath(webRoot);
  verifyImmutableMigrations(bundle, webRoot, baseline);
  if (baseline?.kind === 'mixed') {
    verifySnapshot(backup, baseline);
    assertSnapshotTarget(backup, webRoot);
  }
  const retained = (baseline?.retainedHistory ?? []).map(item => ({ ...item, bytes: fs.readFileSync(path.join(webRoot, item.path)) }));
  verifyInstallTargets(webRoot);
  for (const name of artifactPaths) {
    const dest = path.join(webRoot, name);
    if (fs.existsSync(dest)) assertRealPath(dest);
    fs.rmSync(dest, { recursive: true, force: true });
    copyPaths(bundle, webRoot, [name]);
  }
  for (const item of retained) fs.writeFileSync(path.join(webRoot, item.path), item.bytes, { mode: item.mode });
  const installed = inventory(webRoot);
  const candidateFiles = installed.filter(item => !retained.some(old => old.path === item.path));
  check(JSON.stringify(candidateFiles) === JSON.stringify(manifest.files), 'Installed artifact mismatch');
  for (const item of retained) check(sha(fs.readFileSync(path.join(webRoot, item.path))) === item.sha256, 'Retained history changed');
  verifyArtifactLinks(webRoot, installed);
}

export function snapshotApplication(webRoot, backup) {
  const names = [...artifactPaths, 'backend/pb_data', 'backend/pocketbase'];
  const present = names.filter(name => fs.existsSync(path.join(webRoot, name)));
  copyPaths(webRoot, path.join(backup, 'application'), present);
  return { present, missing: names.filter(name => !present.includes(name)), application: inventory(path.join(backup, 'application'), present) };
}


const retainedFile = 'backend/pb_migrations/1765100008_add_velocity_advanced.js';
const retainedDigest = '85f8f91d99a2cb72fec56515f08b980c26cf9f32350ef1caae53f6f904749d0c';
const sourceAbsent = ['1770817921_updated_users.js', '1770818121_updated_users.js', '1770818775_updated_users.js'];
export function snapshotIdentity(manifest) {
  return sha(JSON.stringify({ revision: manifest.revision ?? null, present: manifest.present, missing: manifest.missing,
    application: manifest.application, configuration: manifest.configuration, ownership: manifest.ownership,
    contract: manifest.contract, retainedHistory: manifest.retainedHistory, sourceAbsentHistory: manifest.sourceAbsentHistory }));
}
export function verifySnapshot(backup, baseline) {
  check(typeof backup === 'string' && path.isAbsolute(backup), 'Missing complete snapshot');
  assertRealPath(backup);
  const manifest = json(path.join(backup, 'backup.json'));
  check(manifest.snapshotId === snapshotIdentity(manifest), 'Snapshot identity mismatch');
  check(JSON.stringify(inventory(path.join(backup, 'application'), manifest.present)) === JSON.stringify(manifest.application), 'Snapshot bytes drift');
  check([...artifactPaths, 'backend/pb_data', 'backend/pocketbase'].every(name => manifest.present.includes(name) !== manifest.missing.includes(name)) && manifest.present.every(name => [...artifactPaths, 'backend/pb_data', 'backend/pocketbase'].includes(name)) && manifest.missing.every(name => [...artifactPaths, 'backend/pb_data', 'backend/pocketbase'].includes(name)), 'Incomplete component/missing inventory');
  check(manifest.present.includes('backend/pb_data') && manifest.present.includes('backend/pocketbase'), 'Incomplete DB/media/binary snapshot');
  check(Array.isArray(manifest.configuration) && manifest.configuration.length > 0 && Array.isArray(manifest.ownership), 'Missing snapshot configuration');
  const names = manifest.configuration.map(item => item.path);
  check(names.every(safeRelative) && manifest.configuration.every(item => item.sha256 && !item.link && !item.directory), 'Invalid configuration manifest');
  check(JSON.stringify(inventory(path.join(backup, 'configuration'), names)) === JSON.stringify(manifest.configuration), 'Configuration snapshot drift');
  check(names.every(name => manifest.ownership.some(item => item.path === name && Number.isInteger(item.uid) && Number.isInteger(item.gid))), 'Missing configuration ownership metadata');
  check(JSON.stringify(checkDatabases(path.join(backup, 'application/backend/pb_data'))) === JSON.stringify(manifest.contract), 'Snapshot contract drift');
  if (baseline?.kind === 'mixed') {
    check(manifest.revision === null && baseline.sourceRevision === null && baseline.snapshotId === manifest.snapshotId, 'Mixed snapshot binding mismatch');
    check(JSON.stringify(baseline.retainedHistory) === JSON.stringify(manifest.retainedHistory) && JSON.stringify(baseline.sourceAbsentHistory) === JSON.stringify(manifest.sourceAbsentHistory), 'Mixed history binding mismatch');
    const history = manifest.contract['data.db'].migrations.map(row => row[0]);
    check(manifest.retainedHistory.length === 1 && manifest.retainedHistory[0].path === retainedFile && manifest.retainedHistory[0].sha256 === retainedDigest, 'Unknown retained historical bytes');
    const item = manifest.application.find(item => item.path === retainedFile);
    check(item?.sha256 === retainedDigest && item.mode === manifest.retainedHistory[0].mode, 'Retained snapshot bytes mismatch');
    check(history.includes(path.basename(retainedFile)), 'Retained migration is not applied');
    check(JSON.stringify(manifest.sourceAbsentHistory) === JSON.stringify(sourceAbsent) && sourceAbsent.every(file => history.includes(file) && !manifest.application.some(item => item.path === 'backend/pb_migrations/' + file)), 'Source-absent ledger mismatch');
  }
  return manifest;
}
function assertSnapshotTarget(backup, webRoot) {
  const manifest = json(path.join(backup, 'backup.json'));
  check(JSON.stringify(inventory(webRoot, manifest.present)) === JSON.stringify(manifest.application), 'Target changed since stopped snapshot');
  for (const name of manifest.missing) check(!fs.existsSync(path.join(webRoot, name)), 'Previously missing target appeared');
  for (const item of manifest.configuration) {
    const file = '/' + item.path;
    check(sha(fs.readFileSync(file)) === item.sha256 && (fs.statSync(file).mode & 0o777) === item.mode, 'Target configuration drift');
  }
}
function verifyRecoverySecurity(directory, identities) {
  check(Array.isArray(identities) && identities.length > 0 && identities.some(item => item.role === 'admin') && identities.some(item => item.role === 'service'), 'Missing approved recovery identities');
  check(identities.every(item => typeof item.id === 'string' && /^[a-z0-9]{15}$/.test(item.id) && ['admin', 'service'].includes(item.role)), 'Invalid recovery identities');
  check(new Set(identities.map(item => item.id)).size === identities.length, 'Duplicate recovery identity');
  // Read actual isolated SQLite schema/flags. No account creation or role grant.
  const script = `import sqlite3,json,sys
import tempfile,shutil,pathlib,contextlib,atexit
stack=contextlib.ExitStack();atexit.register(stack.close)
def observed(file):
 target=pathlib.Path(stack.enter_context(tempfile.TemporaryDirectory(prefix='hololive-recovery-read-')))/'data.db'
 shutil.copy2(file,target)
 wal=pathlib.Path(file+'-wal')
 if wal.exists():shutil.copy2(wal,str(target)+'-wal')
 return sqlite3.connect(str(target))
c=observed(sys.argv[1])
cols={r[1] for r in c.execute('pragma table_info(users)')}
assert {'is_admin','service_account'}.issubset(cols),'Missing authorization flags'
rows=c.execute('select createRule,updateRule,deleteRule from _collections where name="users"').fetchall()
assert rows and rows[0]==(None,None,None),'Unsafe users write rules'
admin='@request.auth.id != "" && @request.auth.is_admin = true && (@request.auth.verified = true || @request.auth.service_account = true)'
for name in ['media','posts','announcements','whitelists','extra_whitelist','system_settings','cms_sections','server_maps','server_info_details','audit_logs','velocity_settings','velocity_servers','velocity_forced_hosts','mcsm_config','translation_config']:
 row=c.execute('select createRule,updateRule,deleteRule,listRule,viewRule from _collections where name=?',(name,)).fetchone()
 if row is None and name=='extra_whitelist':continue
 assert row is not None,'Missing protected collection'
 assert all(rule is None or rule==admin for rule in row[:3]),'Unsafe protected write rule'
 public=['media','announcements','system_settings','cms_sections','server_maps','server_info_details']
 read=('is_public = true || ('+admin+')') if name=='posts' else '' if name in public else admin
 assert row[3]==read and row[4]==read,'Unsafe protected read rule'
for item in json.loads(sys.argv[2]):
 r=c.execute('select is_admin,service_account,verified from users where id=?',(item['id'],)).fetchone()
 assert r and bool(r[0]) and ((bool(r[2]) and not bool(r[1])) if item['role']=='admin' else bool(r[1])),'Recovery identity role mismatch'
print('verified')`;
  check(command('python3', ['-c', script, path.join(directory, 'backend/pb_data/data.db'), JSON.stringify(identities)]) === 'verified', 'Recovery security failed');
}
function verifyDerivedData(rawDirectory, migratedDirectory, identities) {
  const script = `import sqlite3,sys,json
import tempfile,shutil,pathlib,contextlib,atexit
stack=contextlib.ExitStack();atexit.register(stack.close)
def observed(file):
 target=pathlib.Path(stack.enter_context(tempfile.TemporaryDirectory(prefix='hololive-recovery-read-')))/'data.db'
 shutil.copy2(file,target)
 wal=pathlib.Path(file+'-wal')
 if wal.exists():shutil.copy2(wal,str(target)+'-wal')
 return sqlite3.connect(str(target))
old=observed(sys.argv[1])
new=observed(sys.argv[2])
approved={item['id']:item['role'] for item in json.loads(sys.argv[3])}
for (table,) in old.execute("select name from sqlite_master where type='table' and name not in ('_migrations','_collections','_params') and name not like 'sqlite_%'"):
 quote=lambda x:'"'+x.replace('"','""')+'"'
 before=[r[1] for r in old.execute('pragma table_info('+quote(table)+')')]
 after=[r[1] for r in new.execute('pragma table_info('+quote(table)+')')]
 allowed={'admin_entrance_key'} if table=='system_settings' else set()
 assert all(field in after or field in allowed for field in before),'Unexplained removed column'
 fields=[f for f in before if f in after and f!='updated' and not (table=='users' and f in ('is_admin','service_account'))]
 sql='select '+','.join(map(quote,fields))+' from '+quote(table)
 normalize=lambda rows:sorted(json.dumps(row,sort_keys=True) for row in rows)
 original=list(old.execute(sql));derived=list(new.execute(sql))
 if table=='users':
  index=fields.index('id'); originalIds={row[index] for row in original}
  assert all(row[index] in originalIds or row[index] in approved for row in derived),'Unapproved added identity'
  derived=[row for row in derived if row[index] in originalIds]
  for flag in ['is_admin','service_account']:
   q='select id,'+quote(flag)+' from users'
   oldFlags=dict(old.execute(q)) if flag in before else {key:0 for key in originalIds}
   newFlags=dict(new.execute(q))
   assert all(bool(value)==bool(newFlags.get(key)) for key,value in oldFlags.items() if key not in approved),'Unapproved role change'
  for key,role in approved.items():
   row=new.execute('select is_admin,service_account from users where id=?',(key,)).fetchone()
   assert row and bool(row[0]) and bool(row[1])==(role=='service'),'Recovery identity role mismatch'
 assert normalize(original)==normalize(derived),'Derived record/content mismatch: '+table
print('verified')`;
  check(command('python3', ['-c', script, path.join(rawDirectory, 'backend/pb_data/data.db'), path.join(migratedDirectory, 'backend/pb_data/data.db'), JSON.stringify(identities ?? [])]) === 'verified', 'Derived source mismatch');
  const names = ['backend/pb_data/storage'];
  const raw = names.filter(name => fs.existsSync(path.join(rawDirectory, name)));
  check(JSON.stringify(inventory(rawDirectory, raw)) === JSON.stringify(inventory(migratedDirectory, raw)), 'Derived media mismatch');
}
// PB generates field identifiers and migration timestamps on isolated replay.
// Normalize only those generated values; retain every business constraint/rule
// and every migration file. Original ledger rows must remain byte-for-byte.
function recoveryContract(directory) {
  const script = `import sqlite3,json,sys
c=sqlite3.connect(sys.argv[1])
columns=[r[1] for r in c.execute('pragma table_info(_collections)')]
collections=[]
for row in c.execute('select * from _collections order by name'):
 item=dict(zip(columns,row))
 for key in ['created','updated']:item.pop(key,None)
 if 'fields' in item:
  fields=json.loads(item['fields'])
  for field in fields:field.pop('id',None)
  item['fields']=fields
 for key in ['indexes','options']:
  if key in item and isinstance(item[key],str):
   try:item[key]=json.loads(item[key])
   except ValueError:pass
 collections.append(item)
schema=list(c.execute("select type,name,tbl_name,sql from sqlite_master where name not like 'sqlite_%' order by type,name"))
print(json.dumps({'collections':collections,'schema':schema,'migrations':sorted(r[0] for r in c.execute('select file from _migrations'))},sort_keys=True))`;
  return JSON.parse(command('python3', ['-c', script, path.join(directory, 'backend/pb_data/data.db')]));
}
function verifyRecoveryContract(directory, expected, rawContract) {
  check(JSON.stringify(recoveryContract(directory)) === JSON.stringify(expected), 'Recovery candidate contract mismatch');
  const actual = checkDatabases(path.join(directory, 'backend/pb_data'))['data.db'].migrations;
  check(rawContract['data.db'].migrations.every(row => actual.some(current => JSON.stringify(current) === JSON.stringify(row))), 'Original migration ledger changed');
}
export function createSafeRecovery(backup, migrated, bundle, revision, identities, expectedDirectory) {
  const raw = verifySnapshot(backup);
  verifyBundle(bundle, revision);
  verifyDerivedData(path.join(backup, 'application'), migrated, identities);
  verifyRecoverySecurity(migrated, identities);
  if (!expectedDirectory) {
    expectedDirectory = path.join(backup, 'candidate-contract-rehearsal');
    restoreBackup(backup, expectedDirectory);
    const output = command(path.join(expectedDirectory, 'backend/pocketbase'), ['migrate', 'up', '--dir', path.join(expectedDirectory, 'backend/pb_data'), '--migrationsDir', path.join(bundle, 'backend/pb_migrations'), '--hooksDir', path.join(bundle, 'backend/pb_hooks')]);
    check(!/Failed|Error:/i.test(output), 'Isolated migration failed');
  }
  check(expectedDirectory === path.join(backup, 'rehearsal') || expectedDirectory === path.join(backup, 'candidate-contract-rehearsal'), 'Unbound recovery expectation');
  const expectedContract = recoveryContract(expectedDirectory);
  verifyRecoveryContract(migrated, expectedContract, raw.contract);
  writeJSON(path.join(backup, 'expected-recovery-contract.json'), { sourceSnapshotId: raw.snapshotId, revision, candidateFiles: verifyBundle(bundle, revision).files, expectedContract });
  const safe = path.join(backup, 'safe-recovery');
  check(!fs.existsSync(safe), 'Safe recovery destination exists');
  // Candidate app and forward-migrated data, never the permissive raw app.
  copyPaths(bundle, path.join(safe, 'application'), artifactPaths);
  copyPaths(migrated, path.join(safe, 'application'), ['backend/pb_data']);
  copyPaths(path.join(backup, 'application'), path.join(safe, 'application'), ['backend/pocketbase']);
  for (const item of raw.retainedHistory ?? []) copyPaths(path.join(backup, 'application'), path.join(safe, 'application'), [item.path]);
  copyPaths(path.join(backup, 'configuration'), path.join(safe, 'configuration'), raw.configuration.map(item => item.path));
  const present = [...artifactPaths, 'backend/pb_data', 'backend/pocketbase'];
  const manifest = { revision, sourceSnapshotId: raw.snapshotId, present, missing: [], application: inventory(path.join(safe, 'application'), present),
    configuration: raw.configuration, ownership: raw.ownership, contract: checkDatabases(path.join(safe, 'application/backend/pb_data')),
    retainedHistory: raw.retainedHistory, sourceAbsentHistory: raw.sourceAbsentHistory, expectedContract, identities, candidateFiles: verifyBundle(bundle, revision).files };
  manifest.snapshotId = snapshotIdentity(manifest);
  manifest.recoveryId = sha(JSON.stringify({ snapshotId: manifest.snapshotId, sourceSnapshotId: raw.snapshotId, identities, candidateFiles: manifest.candidateFiles }));
  writeJSON(path.join(safe, 'backup.json'), manifest);
  return safe;
}
export function restoreSafeRecovery(safe, destination, revision) {
  const manifest = verifySnapshot(safe);
  check(manifest.revision === revision && /^[a-f0-9]{40}$/.test(revision) && /^[a-f0-9]{64}$/.test(manifest.sourceSnapshotId ?? ''), 'Recovery app/data binding mismatch');
  check(manifest.recoveryId === sha(JSON.stringify({ snapshotId: manifest.snapshotId, sourceSnapshotId: manifest.sourceSnapshotId, identities: manifest.identities, candidateFiles: manifest.candidateFiles })), 'Recovery identity binding mismatch');
  const app = manifest.application.filter(item => !item.path.startsWith('backend/pb_data') && item.path !== 'backend/pocketbase' && !(manifest.retainedHistory ?? []).some(old => old.path === item.path));
  check(JSON.stringify(app) === JSON.stringify(manifest.candidateFiles), 'Recovery candidate mismatch');
  const source = verifySnapshot(path.dirname(safe));
  const expectation = json(path.join(path.dirname(safe), 'expected-recovery-contract.json'));
  check(source.snapshotId === manifest.sourceSnapshotId && expectation.sourceSnapshotId === source.snapshotId && expectation.revision === revision && JSON.stringify(expectation.candidateFiles) === JSON.stringify(manifest.candidateFiles) && JSON.stringify(expectation.expectedContract) === JSON.stringify(manifest.expectedContract), 'Recovery expected contract binding mismatch');
  verifyDerivedData(path.join(path.dirname(safe), 'application'), path.join(safe, 'application'), manifest.identities);
  verifyRecoveryContract(path.join(safe, 'application'), expectation.expectedContract, source.contract);
  verifyRecoverySecurity(path.join(safe, 'application'), manifest.identities);
  const result = restoreBackup(safe, destination);
  verifyRecoverySecurity(destination, manifest.identities);
  verifyRecoveryContract(destination, expectation.expectedContract, source.contract);
  return { ...result, recoveryId: manifest.recoveryId, sourceSnapshotId: manifest.sourceSnapshotId, oldDaemonStarted: false };
}

export function productionAdapter(bundle, config, revision, runNumber, configFile) {
  const state = path.join(config.stateRoot, 'deployment.json');
  const lock = path.join(config.stateRoot, 'deployment.lock');
  const guard = path.join(config.webRoot, 'backend/.velocity-maintenance');
  const pb = path.join(config.webRoot, 'backend/pocketbase');
  let lockFd, backupPath, oldState;
  const controlParents = new Map([state, guard, lock].map(file => [path.dirname(file), fs.lstatSync(path.dirname(file))]));
  const boundControl = file => {
    const parent = path.dirname(file), expected = controlParents.get(parent), current = fs.lstatSync(parent);
    check(expected && current.dev === expected.dev && current.ino === expected.ino, 'Maintenance parent binding changed');
    return controlPath(file);
  };
  const writeControl = (file, value) => { boundControl(file); controlWrite(file, value, boundControl); };
  const systemctl = (action, unit) => {
    check(config.websiteServices.includes(unit) && units.includes(unit), 'Service outside whitelist');
    command('sudo', ['-n', 'systemctl', action, unit]);
  };
  const velocity = () => ({
    service: command('systemctl', ['show', 'velocity', '-p', 'MainPID', '-p', 'ExecMainStartTimestampMonotonic', '-p', 'NRestarts', '-p', 'ActiveState']),
    files: inventory(config.velocityRoot, config.protectedVelocityFiles),
    listeners: command('ss', ['-lnt']),
  });
  const assertCurrent = () => {
    check(command('git', ['ls-remote', 'origin', 'refs/heads/main']).split(/\s/)[0] === revision, 'Stale main revision');
    oldState = controlRead(state, boundControl);
    check(!oldState || (oldState.status === 'deployed' && runNumber > oldState.runNumber), 'Older/repeated run or unresolved failed deployment');
  };
  const authenticateTarget = async () => {
    const identities = config.recoveryIdentities;
    check(Array.isArray(config.targetAuthentication) && config.targetAuthentication.length === identities.length, 'Missing target authentication bindings');
    const base = new URL(config.pocketbaseHealthUrl).origin;
    for (const item of identities) {
      const binding = config.targetAuthentication.find(value => value.id === item.id && value.role === item.role);
      check(binding && ['admin', 'service'].includes(binding.role), 'Missing target credential binding');
      const token = typeof binding.tokenEnv === 'string' && process.env[binding.tokenEnv];
      const password = typeof binding.passwordEnv === 'string' && process.env[binding.passwordEnv];
      check(Boolean(token) !== Boolean(password) && (token || typeof binding.identity === 'string'), 'Missing target credential binding');
      const response = await fetch(base + '/api/collections/users/' + (token ? 'auth-refresh' : 'auth-with-password'), { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: token } : {}) }, ...(token ? {} : { body: JSON.stringify({ identity: binding.identity, password }) }), signal: AbortSignal.timeout(3000) });
      const data = await response.json();
      check(response.ok && data.record?.id === item.id && data.record.is_admin === true && data.record.service_account === (item.role === 'service') && (item.role === 'service' || data.record.verified === true), 'Target authentication failed');
      const read = await fetch(base + '/api/collections/velocity_settings/records', { headers: { Authorization: data.token }, signal: AbortSignal.timeout(3000) });
      check(read.ok && Array.isArray((await read.json()).items), 'Target protected read failed');
    }
    for (const unit of config.websiteServices.filter(unit => /velocity-sync|mcsm/.test(unit))) check(config.targetAuthentication.some(item => item.role === 'service' && item.services?.includes(unit)), 'Missing dependent service authentication binding');
  };
  const migrateCopy = directory => command(pb, ['migrate', 'up', '--dir', path.join(directory, 'backend/pb_data'), '--migrationsDir', path.join(bundle, 'backend/pb_migrations'), '--hooksDir', path.join(bundle, 'backend/pb_hooks')]);
  return {
    verify: () => {
      verifyBundle(bundle, revision);
      verifyImmutableMigrations(bundle, config.webRoot, config.baseline);
      if (config.baseline?.kind === 'mixed') {
        verifySnapshot(config.baseline.snapshotDirectory, config.baseline);
        assertSnapshotTarget(config.baseline.snapshotDirectory, config.webRoot);
        const history = json(path.join(config.baseline.snapshotDirectory, 'backup.json')).contract['data.db'].migrations.map(row => row[0]);
        const allowed = inventory(bundle, ['backend/pb_migrations']).filter(item => item.sha256).map(item => path.basename(item.path));
        check(history.every(file => allowed.includes(file) || config.baseline.sourceAbsentHistory.includes(file) || config.baseline.retainedHistory.some(item => path.basename(item.path) === file) || !file.endsWith('.js')), 'Unknown applied historical migration');
      }
      verifyInstallTargets(config.webRoot, config.configurationFiles);
      for (const endpoint of [state, guard, lock]) boundControl(endpoint);
      check(process.env.GITHUB_REPOSITORY === config.repository && /^[0-9]+$/.test(process.env.GITHUB_RUN_ID ?? '') && ['push', 'workflow_dispatch'].includes(process.env.GITHUB_EVENT_NAME), 'Missing actual Actions run/repository binding');
      const configStat = fs.statSync(configFile);
      check(configStat.uid === 0 && (configStat.mode & 0o022) === 0, 'Production config must be root-owned and not group/world writable');
      for (const root of [config.webRoot, config.backupRoot, config.stateRoot, config.velocityRoot]) assertRealPath(root);
      for (const root of [config.backupRoot, config.stateRoot]) check((fs.statSync(root).mode & 0o077) === 0, 'Private backup/state directory permissions required');
      for (const relative of artifactPaths) { const dest = path.join(config.webRoot, relative); if (fs.existsSync(dest)) assertRealPath(dest); }
      assertRealPath(path.join(config.webRoot, 'backend/pb_data'));
      check(sha(fs.readFileSync('/etc/machine-id')) === config.machineIdSha256 && os.userInfo().username === config.runnerUser, 'Wrong physical host or runner user');
      check(command(pb, ['--version']) === 'pocketbase version ' + config.pocketbaseVersion, 'Wrong PocketBase version');
      check(command('systemctl', ['show', 'velocity', '-p', 'Requires', '-p', 'BindsTo', '-p', 'PartOf']) === config.velocityServiceBinding, 'Java reverse service dependency drift');
      for (const unit of config.websiteServices) {
        check(command('systemctl', ['is-active', unit]) === 'active', 'Required service not active: ' + unit);
        check(command('systemctl', ['show', unit, '-p', 'ExecStart', '-p', 'WorkingDirectory', '-p', 'User', '-p', 'Requires', '-p', 'BindsTo', '-p', 'PartOf']) === config.serviceBindings[unit], 'Service binding drift: ' + unit);
      }
      for (const file of config.configurationFiles) assertRealPath(file);
    },
    lock: () => { boundControl(lock); lockFd = fs.openSync(lock, 'wx', 0o600); fs.writeFileSync(lockFd, JSON.stringify({ revision, runNumber, pid: process.pid })); },
    unlock: () => { if (lockFd !== undefined) {
      try { const current = boundControl(lock), opened = fs.fstatSync(lockFd); check(current && current.dev === opened.dev && current.ino === opened.ino, 'Maintenance lock changed'); fs.unlinkSync(lock); }
      finally { fs.closeSync(lockFd); lockFd = undefined; }
    } },
    assertCurrent,
    velocity,
    stop: systemctl.bind(null, 'stop'),
    guard: () => writeControl(guard, 'Website maintenance: explicit release of Velocity synchronization requires separate authorization.\n'),
    backup: () => {
      backupPath = fs.mkdtempSync(path.join(config.backupRoot, `run-${runNumber}-`));
      fs.chmodSync(backupPath, 0o700);
      const snapshot = snapshotApplication(config.webRoot, backupPath);
      copyPaths('/', path.join(backupPath, 'configuration'), config.configurationFiles.map(file => file.slice(1)));
      const contract = checkDatabases(path.join(backupPath, 'application/backend/pb_data'));
      const configuration = inventory(path.join(backupPath, 'configuration'), config.configurationFiles.map(file => file.slice(1)));
      const ownership = config.configurationFiles.map(file => { const stat = fs.statSync(file); return { path: file.slice(1), uid: stat.uid, gid: stat.gid }; });
      const value = { revision: config.baseline?.kind === 'mixed' ? null : oldState?.revision ?? config.previousRevision, ...snapshot, configuration, ownership, contract, retainedHistory: config.baseline?.retainedHistory ?? [], sourceAbsentHistory: config.baseline?.sourceAbsentHistory ?? [] };
      value.snapshotId = snapshotIdentity(value);
      writeJSON(path.join(backupPath, 'backup.json'), value);
      if (config.baseline?.kind === 'mixed') verifySnapshot(backupPath, config.baseline);
      return backupPath;
    },
    rehearse: backup => {
      const manifest = json(path.join(backup, 'backup.json'));
      if (manifest.snapshotId) verifySnapshot(backup, config.baseline);
      check(JSON.stringify(inventory(path.join(backup, 'application'), manifest.present)) === JSON.stringify(manifest.application), 'Backup digest mismatch');
      checkDatabases(path.join(backup, 'application/backend/pb_data'));
      const isolated = path.join(backup, 'rehearsal');
      restoreBackup(backup, isolated);
      check(JSON.stringify(inventory(isolated, manifest.present)) === JSON.stringify(manifest.application), 'Restore rehearsal differs from snapshot');
      checkDatabases(path.join(isolated, 'backend/pb_data'));
      const migrationLog = migrateCopy(isolated);
      check(!/Failed|Error:/i.test(migrationLog), 'Isolated migration failed');
      fs.writeFileSync(path.join(backup, 'isolated-migration.log'), migrationLog, { mode: 0o600 });
      writeJSON(path.join(backup, 'isolated-migrated-contract.json'), checkDatabases(path.join(isolated, 'backend/pb_data')));
      // A migration rehearsal never promotes raw permissive data to safe recovery.
      // The approved identities must already exist in the derived database.
      const safe = createSafeRecovery(backup, config.recoveryWorkingCopy ?? isolated, bundle, revision, config.recoveryIdentities, isolated);
      restoreSafeRecovery(safe, path.join(backup, 'safe-recovery-rehearsal'), revision);
    },
    baseline: backup => writeJSON(path.join(backup, 'before-contract.json'), checkDatabases(path.join(backup, 'application/backend/pb_data'))),
    install: () => { verifyInstallTargets(config.webRoot, config.configurationFiles); installBundle(bundle, config.webRoot, revision, config.baseline, backupPath); },
    migrate: () => { const output = migrateCopy(config.webRoot); check(!/Failed|Error:/i.test(output), 'Production migration failed'); fs.writeFileSync(path.join(backupPath, 'production-migration.log'), output, { mode: 0o600 }); verifyRecoverySecurity(config.webRoot, config.recoveryIdentities); const expected = json(path.join(backupPath, 'expected-recovery-contract.json')); verifyRecoveryContract(config.webRoot, expected.expectedContract, json(path.join(backupPath, 'backup.json')).contract); },
    start: unit => systemctl(unit === 'pocketbase' || unit === 'velocity-sync' ? 'start' : 'restart', unit),
    health: async () => {
      for (let i = 0; i < 30; i++) {
        try { const response = await fetch(config.pocketbaseHealthUrl, { signal: AbortSignal.timeout(1000) }); const data = await response.json(); if (response.ok && data.code === 200) break; } catch { /* retry bounded startup */ }
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      const response = await fetch(config.pocketbaseHealthUrl, { signal: AbortSignal.timeout(1000) });
      check(response.ok && (await response.json()).code === 200, 'PocketBase startup health failed');
      await authenticateTarget();
    },
    assertVelocity: before => {
      const after = velocity();
      check(before.service.includes('ActiveState=active') && before.service === after.service && JSON.stringify(before.files) === JSON.stringify(after.files), 'Velocity continuity/file evidence differs');
      // Website ports may change; assert each explicitly inventoried proxy listener.
      for (const port of config.velocityPorts ?? []) check(before.listeners.includes(':' + port + ' ') && after.listeners.includes(':' + port + ' '), 'Velocity listener missing');
      check(config.velocityPorts?.length > 0, 'Velocity port inventory missing');
      writeJSON(path.join(backupPath, 'velocity-continuity.json'), { before, after });
    },
    record: value => {
      boundControl(state);
      const backupManifest = backupPath ? json(path.join(backupPath, 'backup.json')) : null;
      writeControl(state, JSON.stringify({ ...value, baseline: backupManifest?.snapshotId ?? null, candidateManifest: verifyBundle(bundle, revision), retainedHistory: config.baseline?.retainedHistory ?? [], runId: process.env.GITHUB_RUN_ID, runUrl: `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`, trigger: process.env.GITHUB_EVENT_NAME, completedAt: new Date().toISOString() }) + '\n');
    },
    failure: value => writeControl(state, JSON.stringify({ ...value, runNumber, failedAt: new Date().toISOString() }) + '\n'),
  };
}

export function restoreBackup(backup, destination) {
  // Always isolated; never silently restores a running production directory.
  check(!fs.existsSync(destination), 'Restore destination must be new');
  const manifest = json(path.join(backup, 'backup.json'));
  check(manifest.present.every(name => [...artifactPaths, 'backend/pb_data', 'backend/pocketbase'].includes(name)), 'Backup whitelist mismatch');
  check(JSON.stringify(inventory(path.join(backup, 'application'), manifest.present)) === JSON.stringify(manifest.application), 'Corrupt backup');
  if (manifest.snapshotId) verifySnapshot(backup);
  if (manifest.configuration) {
    check(JSON.stringify(inventory(path.join(backup, 'configuration'), manifest.configuration.filter(item => !item.directory && !item.link).map(item => item.path))) === JSON.stringify(manifest.configuration), 'Corrupt configuration backup');
  }
  copyPaths(path.join(backup, 'application'), destination, manifest.present);
  if (manifest.configuration) {
    const names = manifest.configuration.map(item => item.path);
    copyPaths(path.join(backup, 'configuration'), path.join(destination, 'isolated-configuration'), names);
    check(JSON.stringify(inventory(path.join(destination, 'isolated-configuration'), names)) === JSON.stringify(manifest.configuration), 'Configuration restore verification failed');
    for (const item of manifest.ownership ?? []) {
      const file = path.join(destination, 'isolated-configuration', item.path);
      let stat = fs.statSync(file);
      if (stat.uid !== item.uid || stat.gid !== item.gid) fs.chownSync(file, item.uid, item.gid);
      stat = fs.statSync(file);
      check(stat.uid === item.uid && stat.gid === item.gid, 'Configuration ownership restore failed');
    }
    writeJSON(path.join(destination, 'configuration-ownership.json'), manifest.ownership ?? []);
  }
  check(JSON.stringify(inventory(destination, manifest.present)) === JSON.stringify(manifest.application), 'Restore verification failed');
  return { restored: manifest.present, revision: manifest.revision };
}

async function main() {
  const [action, directory, argument, run] = process.argv.slice(2);
  if (action === 'bundle') {
    check(/^[a-f0-9]{40}$/.test(argument), 'Exact bundle revision required');
    writeJSON(path.join(directory, 'release.json'), { revision: argument, paths: artifactPaths, files: inventory(directory) });
    verifyBundle(directory, argument);
  } else if (action === 'plan' || action === 'apply') {
    const config = json(argument), revision = process.env.DEPLOY_REVISION;
    const plan = validatePlan(config, revision, Number(run));
    verifyBundle(directory, revision);
    if (action === 'plan') process.stdout.write(JSON.stringify(plan) + '\n');
    else await deploy(productionAdapter(directory, config, revision, Number(run), argument), config, revision, Number(run));
  } else if (action === 'restore-isolated') {
    process.stdout.write(JSON.stringify(restoreBackup(directory, argument)) + '\n');
  } else refuse('Usage: deployment.mjs bundle DIR SHA | plan/apply BUNDLE CONFIG RUN_NUMBER (DEPLOY_REVISION) | restore-isolated BACKUP NEW_DIRECTORY');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
