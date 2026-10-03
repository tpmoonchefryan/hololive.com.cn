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

// systemctl's command values combine immutable configuration and execution
// records. Only the documented, unambiguous representation is admitted.
const executionNames = ['ExecCondition', 'ExecStartPre', 'ExecStart', 'ExecStartPost', 'ExecReload', 'ExecStop', 'ExecStopPost'];
const serviceNames = [...executionNames, 'WorkingDirectory', 'User', 'Group', 'EnvironmentFiles', 'Requires', 'BindsTo', 'PartOf'];
export function serviceFacts(raw) {
  const properties = {};
  for (const line of raw.split('\n')) {
    const at = line.indexOf('=');
    check(at > 0 && !Object.hasOwn(properties, line.slice(0, at)), 'Missing/duplicate service property');
    properties[line.slice(0, at)] = line.slice(at + 1);
  }
  check(Object.keys(properties).length === serviceNames.length && serviceNames.every(name => Object.hasOwn(properties, name)), 'Unknown/missing service property');
  const configuration = {}, runtime = {};
  for (const name of serviceNames) {
    if (!executionNames.includes(name)) { configuration[name] = properties[name]; continue; }
    configuration[name] = []; runtime[name] = [];
    let rest = properties[name];
    while (rest) {
      const match = /^\{ path=([^;{}]+) ; argv\[\]=([^;{}]+) ; ignore_errors=(yes|no) ; start_time=([^;{}]+) ; stop_time=([^;{}]+) ; pid=(\d+) ; code=([^;{}]+) ; status=(\d+|0/0) \}(?: |$)/.exec(rest);
      check(match && path.isAbsolute(match[1]) && !/[\\"'\t\n]/.test(match[2]), 'Ambiguous service command');
      const argv = match[2].split(' ');
      check(argv.every(Boolean) && /^\[[^\[\]]+\]$/.test(match[4]) && /^\[[^\[\]]+\]$/.test(match[5]) && ['(null)', 'exited', 'killed', 'dumped'].includes(match[7]), 'Ambiguous service argv/runtime');
      const configured = { path: match[1], argv, ignore_errors: match[3] };
      check(!configuration[name].some(item => JSON.stringify(item) === JSON.stringify(configured)), 'Duplicate service command');
      configuration[name].push(configured);
      runtime[name].push({ start_time: match[4], stop_time: match[5], pid: match[6], code: match[7], status: match[8] });
      rest = rest.slice(match[0].length);
    }
  }
  check(configuration.ExecStart.length === 1, 'Missing/ambiguous ExecStart');
  const environment = [];
  let rest = configuration.EnvironmentFiles;
  while (rest) {
    const match = /^(\/[^\s\\()]+) \(ignore_errors=(yes|no)\)(?: |$)/.exec(rest);
    check(match && path.resolve(match[1]) === match[1] && !environment.some(item => item.path === match[1]), 'Ambiguous EnvironmentFiles');
    environment.push({ path: match[1], ignore_errors: match[2] }); rest = rest.slice(match[0].length);
  }
  return { configuration, runtime, environment };
}
const showService = unit => command('systemctl', ['show', unit, '--all', ...serviceNames.flatMap(name => ['-p', name])]);
function serviceEnvironment(facts, config) {
  return facts.environment.map(item => {
    check(config.configurationFiles.includes(item.path), 'EnvironmentFile outside approved configuration inventory');
    assertRealPath(item.path);
    const stat = fs.lstatSync(item.path);
    check(stat.isFile() && stat.nlink === 1, 'Unsafe EnvironmentFile');
    return { ...item, sha256: sha(fs.readFileSync(item.path)), mode: stat.mode & 0o7777, uid: stat.uid, gid: stat.gid };
  });
}

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
    check(config.baseline.capture === undefined || config.baseline.capture === 'stopped-backup', 'Unknown mixed capture mode');
    if (config.baseline.capture === 'stopped-backup') check(config.baseline.snapshotId === undefined && config.baseline.snapshotDirectory === undefined, 'First capture must not invent a snapshot');
    else check(/^[a-f0-9]{64}$/.test(config.baseline.snapshotId ?? '') && typeof config.baseline.snapshotDirectory === 'string' && path.isAbsolute(config.baseline.snapshotDirectory), 'Missing immutable mixed snapshot binding');
    check(Array.isArray(config.baseline.retainedHistory) && Array.isArray(config.baseline.sourceAbsentHistory), 'Missing mixed history binding');
    check(config.baseline.retainedHistory.length === 1 && config.baseline.retainedHistory[0].path === retainedFile && config.baseline.retainedHistory[0].sha256 === retainedDigest && Number.isInteger(config.baseline.retainedHistory[0].mode) && config.baseline.retainedHistory[0].mode >= 0 && config.baseline.retainedHistory[0].mode <= 0o777 && JSON.stringify(config.baseline.sourceAbsentHistory) === JSON.stringify(sourceAbsent), 'Unknown mixed history descriptor');
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
    const maintenance = adapter.maintenance?.();
    if (stopped || maintenance?.changed || maintenance?.uncertain) await adapter.failure({ status: 'failed', revision, backup: backup ?? null, servicesMayBeStopped: stopped || maintenance?.stopped === true || maintenance?.killed === true || maintenance?.uncertain === true, maintenance: maintenance ?? null, reason: error.message });
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
// This is a bounded online metadata read, not a backup or data contract. SQLite
// uses its ordinary read transaction so committed WAL rows remain visible.
export function readMigrationLedger(directory) {
  assertRealPath(directory);
  assertRealPath(path.join(directory, 'data.db'));
  const script = `import sqlite3,json,pathlib,sys
p=pathlib.Path(sys.argv[1]).resolve()/'data.db'
c=sqlite3.connect(p.as_uri()+'?mode=ro',uri=True,timeout=3)
c.execute('pragma query_only=ON')
c.execute('begin')
rows=list(c.execute('select * from _migrations'))
print(json.dumps(rows))
c.rollback()
c.close()`;
  return JSON.parse(command('python3', ['-c', script, path.resolve(directory)]));
}
function verifyMixedHistory(bundle, application, baseline, rows) {
  check(baseline.retainedHistory.length === 1 && baseline.retainedHistory[0].path === retainedFile && baseline.retainedHistory[0].sha256 === retainedDigest && JSON.stringify(baseline.sourceAbsentHistory) === JSON.stringify(sourceAbsent), 'Unknown mixed history descriptor');
  const retained = inventory(application, [retainedFile])[0];
  check(retained.sha256 === retainedDigest && retained.mode === baseline.retainedHistory[0].mode, 'Retained snapshot bytes mismatch');
  const history = rows.map(row => row[0]);
  check(rows.some(row => row[0] === path.basename(retainedFile) && Number.isFinite(row[1]) && row[1] > 0), 'Retained migration is not applied');
  check(sourceAbsent.every(file => rows.some(row => row[0] === file && Number.isFinite(row[1]) && row[1] > 0) && !fs.existsSync(path.join(application, 'backend/pb_migrations', file))), 'Source-absent ledger mismatch');
  const allowed = inventory(bundle, ['backend/pb_migrations']).filter(item => item.sha256).map(item => path.basename(item.path));
  check(history.every(file => allowed.includes(file) || sourceAbsent.includes(file) || file === path.basename(retainedFile) || !file.endsWith('.js')), 'Unknown applied historical migration');
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
    contract: manifest.contract, retainedHistory: manifest.retainedHistory, sourceAbsentHistory: manifest.sourceAbsentHistory,
    ...(manifest.captureBinding ? { captureBinding: manifest.captureBinding } : {}) }));
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
    if (baseline.captureBinding) check(JSON.stringify(manifest.captureBinding) === JSON.stringify(baseline.captureBinding), 'Capture candidate/run binding mismatch');
    check(manifest.revision === null && baseline.sourceRevision === null && baseline.snapshotId === manifest.snapshotId, 'Mixed snapshot binding mismatch');
    check(JSON.stringify(baseline.retainedHistory) === JSON.stringify(manifest.retainedHistory) && JSON.stringify(baseline.sourceAbsentHistory) === JSON.stringify(manifest.sourceAbsentHistory), 'Mixed history binding mismatch');
    check(manifest.retainedHistory.length === 1 && manifest.retainedHistory[0].path === retainedFile && manifest.retainedHistory[0].sha256 === retainedDigest, 'Unknown retained historical bytes');
    const item = manifest.application.find(item => item.path === retainedFile);
    check(item?.sha256 === retainedDigest && item.mode === manifest.retainedHistory[0].mode, 'Retained snapshot bytes mismatch');
    check(manifest.contract['data.db'].migrations.some(row => row[0] === path.basename(retainedFile) && Number.isFinite(row[1]) && row[1] > 0), 'Retained migration is not applied');
    check(JSON.stringify(manifest.sourceAbsentHistory) === JSON.stringify(sourceAbsent) && sourceAbsent.every(file => manifest.contract['data.db'].migrations.some(row => row[0] === file && Number.isFinite(row[1]) && row[1] > 0) && !manifest.application.some(item => item.path === 'backend/pb_migrations/' + file)), 'Source-absent ledger mismatch');
  }
  return manifest;
}
function assertSnapshotTarget(backup, webRoot) {
  const manifest = json(path.join(backup, 'backup.json'));
  check(JSON.stringify(inventory(webRoot, manifest.present)) === JSON.stringify(manifest.application), 'Target changed since stopped snapshot');
  for (const name of manifest.missing) check(!fs.existsSync(path.join(webRoot, name)), 'Previously missing target appeared');
  for (const item of manifest.configuration) {
    const file = '/' + item.path;
    const stat = fs.statSync(file), owner = manifest.ownership.find(value => value.path === item.path);
    check(sha(fs.readFileSync(file)) === item.sha256 && (stat.mode & 0o777) === item.mode && stat.uid === owner.uid && stat.gid === owner.gid, 'Target configuration drift');
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
  if (!expectedDirectory) {
    expectedDirectory = path.join(backup, 'candidate-contract-rehearsal');
    if (!fs.existsSync(expectedDirectory)) restoreBackup(backup, expectedDirectory);
    const output = command(path.join(expectedDirectory, 'backend/pocketbase'), ['migrate', 'up', '--dir', path.join(expectedDirectory, 'backend/pb_data'), '--migrationsDir', path.join(bundle, 'backend/pb_migrations'), '--hooksDir', path.join(bundle, 'backend/pb_hooks')]);
    check(!/Failed|Error:/i.test(output), 'Isolated migration failed');
  }
  check(expectedDirectory === path.join(backup, 'rehearsal') || expectedDirectory === path.join(backup, 'candidate-contract-rehearsal'), 'Unbound recovery expectation');
  const expectedContract = recoveryContract(expectedDirectory);
  const expectationFile = path.join(backup, 'expected-recovery-contract.json');
  const expectation = { sourceSnapshotId: raw.snapshotId, revision, candidateFiles: verifyBundle(bundle, revision).files, expectedContract, identities };
  // Seal the original permitted roles outside the data being assessed. Failed
  // attempts and retries must use this same permission, never replace it.
  if (fs.existsSync(expectationFile)) check(JSON.stringify(json(expectationFile)) === JSON.stringify(expectation), 'Recovery original identities permission binding mismatch');
  else {
    check(!fs.existsSync(path.join(backup, 'safe-recovery')), 'Missing original identities permission binding');
    fs.writeFileSync(expectationFile, JSON.stringify(expectation, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  }
  verifyDerivedData(path.join(backup, 'application'), migrated, expectation.identities);
  verifyRecoverySecurity(migrated, expectation.identities);
  verifyRecoveryContract(migrated, expectedContract, raw.contract);
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
  check(Array.isArray(expectation.identities) && JSON.stringify(expectation.identities) === JSON.stringify(manifest.identities), 'Recovery original identities permission binding mismatch');
  verifyDerivedData(path.join(path.dirname(safe), 'application'), path.join(safe, 'application'), expectation.identities);
  verifyRecoveryContract(path.join(safe, 'application'), expectation.expectedContract, source.contract);
  verifyRecoverySecurity(path.join(safe, 'application'), expectation.identities);
  const result = restoreBackup(safe, destination);
  verifyRecoverySecurity(destination, expectation.identities);
  verifyRecoveryContract(destination, expectation.expectedContract, source.contract);
  return { ...result, recoveryId: manifest.recoveryId, sourceSnapshotId: manifest.sourceSnapshotId, oldDaemonStarted: false };
}

// Fixed, shell-free child for the two approved runtime leaves and bound sync cgroup.
// No caller-selected script, command, output path, unit or sysfs endpoint.
const finiteRootSource = String.raw`import os,sys,json,stat,hashlib,pwd,subprocess,time,fcntl,array,re,grp
r=json.loads(sys.stdin.read()); result=r.get('state') or {'changed':False,'attempted':[],'leaves':{},'directories':{},'frozen':False,'killed':False,'stopped':False}
def require(v,m):
 if not v: raise RuntimeError(m)
def real(p):
 require(os.path.isabs(p) and os.path.realpath(p)==p,'Aliased finite endpoint'); return p
def identity(p):
 s=os.lstat(p); require(not stat.S_ISLNK(s.st_mode),'Linked finite endpoint'); return [s.st_dev,s.st_ino,s.st_uid,s.st_gid,stat.S_IMODE(s.st_mode),s.st_nlink]
def read(p):
 real(p); fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW)
 try:
  s=os.fstat(fd); require(stat.S_ISREG(s.st_mode) and s.st_nlink==1,'Nonregular finite endpoint')
  with os.fdopen(fd,'rb',closefd=False) as f: b=f.read()
  require(identity(p)==[s.st_dev,s.st_ino,s.st_uid,s.st_gid,stat.S_IMODE(s.st_mode),s.st_nlink],'Endpoint replacement'); return b
 finally: os.close(fd)
def digest(b): return hashlib.sha256(b).hexdigest()
def file_flags(p):
 real(p); fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW)
 try:
  value=array.array('L',[0]); fcntl.ioctl(fd,0x80086601,value,True); return value[0]
 finally: os.close(fd)
def ctl(args): return subprocess.check_output(['/usr/bin/systemctl']+args,text=True,timeout=10).strip()
def props(unit,names):
 out=ctl(['show',unit,'--all']+sum((['-p',n] for n in names),[])); rows=[line.split('=',1) for line in out.splitlines()]
 require(all(len(row)==2 for row in rows) and len(rows)==len(names) and len(set(row[0] for row in rows))==len(names) and set(row[0] for row in rows)==set(names),'Missing/duplicate/unknown unit property'); return dict(rows)
marker_names=['MainPID','ExecMainStartTimestampMonotonic','NRestarts','ActiveState','ControlGroup']
execution_names=['ExecCondition','ExecStartPre','ExecStart','ExecStartPost','ExecReload','ExecStop','ExecStopPost']
service_names=execution_names+['WorkingDirectory','User','Group','EnvironmentFiles','Requires','BindsTo','PartOf']
sync_names=marker_names+service_names
def facts(value):
 configuration={}; runtime={}
 for name in service_names:
  require(name in value,'Missing configured property')
  if name not in execution_names: configuration[name]=value[name]; continue
  configuration[name]=[]; runtime[name]=[]; rest=value[name]
  while rest:
   m=re.match(r'\{ path=([^;{}]+) ; argv\[\]=([^;{}]+) ; ignore_errors=(yes|no) ; start_time=([^;{}]+) ; stop_time=([^;{}]+) ; pid=(\d+) ; code=([^;{}]+) ; status=(\d+|0/0) \}(?: |$)',rest)
   require(m and os.path.isabs(m[1]) and not any(c in m[2] for c in ['\\','"',"'",'\t','\n']),'Ambiguous service command')
   argv=m[2].split(' '); require(all(argv) and re.fullmatch(r'\[[^\[\]]+\]',m[4]) and re.fullmatch(r'\[[^\[\]]+\]',m[5]) and m[7] in ['(null)','exited','killed','dumped'],'Ambiguous service argv/runtime')
   command={'path':m[1],'argv':argv,'ignore_errors':m[3]}; require(command not in configuration[name],'Duplicate service command'); configuration[name].append(command)
   runtime[name].append(dict(zip(['start_time','stop_time','pid','code','status'],[m[i] for i in range(4,9)])))
   rest=rest[m.end():]
 require(len(configuration['ExecStart'])==1,'Missing/ambiguous ExecStart')
 environment=[]; rest=configuration['EnvironmentFiles']
 while rest:
  m=re.match(r'(/[^\s\\()]+) \(ignore_errors=(yes|no)\)(?: |$)',rest)
  require(m and os.path.normpath(m[1])==m[1] and not any(x['path']==m[1] for x in environment),'Ambiguous EnvironmentFiles')
  f=real(m[1]); require(f in config['configurationFiles'],'EnvironmentFile outside approved configuration inventory')
  i=identity(f); environment.append({'path':f,'ignore_errors':m[2],'sha256':digest(read(f)),'mode':i[4],'uid':i[2],'gid':i[3]}); rest=rest[m.end():]
 return {'configuration':configuration,'runtime':runtime,'environment':environment}
def configured(unit,value=None):
 value=value or props(unit,service_names); actual=facts(value); expected=r['serviceEvidence'][unit]
 if unit in config['websiteServices']:
  rows=[line.split('=',1) for line in config['serviceBindings'][unit].splitlines()]
  require(all(len(row)==2 for row in rows) and len(rows)==len(service_names) and set(row[0] for row in rows)==set(service_names),'Malformed approved service binding')
  require(actual['configuration']==facts(dict(rows))['configuration'],'Root-approved service configuration drift')
 require(actual['configuration']==expected['configuration'] and actual['environment']==expected['environment'],'Configured service/environment drift: '+unit)
 return actual
def running(value):
 actual=facts(value); record=actual['runtime']['ExecStart'][0]
 require(value['ActiveState']=='active' and int(value['MainPID'])>0 and record['pid']==value['MainPID'] and record['start_time']!='[n/a]' and record['stop_time']=='[n/a]' and record['code']=='(null)' and record['status']=='0','ExecStart running phase mismatch')
 for name in execution_names:
  if name=='ExecStart': continue
  for configured_command,execution in zip(actual['configuration'][name],actual['runtime'][name]):
   dormant=execution=={'start_time':'[n/a]','stop_time':'[n/a]','pid':'0','code':'(null)','status':'0'}
   completed=int(execution['pid'])>0 and execution['start_time']!='[n/a]' and execution['stop_time']!='[n/a]' and execution['code']=='exited' and (execution['status']=='0' or configured_command['ignore_errors']=='yes')
   require(dormant or completed,'Auxiliary command runtime phase mismatch')
 return record
def service_phases(phase):
 current={}
 for unit in config['websiteServices']:
  if unit=='velocity-sync': continue
  value=props(unit,marker_names+service_names); actual=configured(unit,value); running(value)
  pid=value['MainPID']; base='/proc/'+pid; command=actual['configuration']['ExecStart'][0]
  require(os.path.realpath(base+'/exe')==os.path.realpath(command['path']) and os.path.realpath(base+'/cwd')==value['WorkingDirectory'],'Website process executable/directory drift')
  argv=read(base+'/cmdline').split(b'\0'); require(argv[-1]==b'' and argv[:-1]==[x.encode() for x in command['argv']],'Website process argv drift')
  require('0::'+value['ControlGroup'] in read(base+'/cgroup').decode().splitlines(),'Website process group drift')
  status=dict(line.split(':',1) for line in read(base+'/status').decode().splitlines() if ':' in line)
  user=pwd.getpwnam(value['User'] or 'root'); group=grp.getgrnam(value['Group']).gr_gid if value['Group'] else user.pw_gid
  require([int(x) for x in status['Uid'].split()]==[user.pw_uid]*4 and [int(x) for x in status['Gid'].split()]==[group]*4,'Website process user/group drift')
  observed={'properties':value,'processStart':read(base+'/stat').decode().rsplit(')',1)[1].split()[19]}; current[unit]=observed
  if phase=='stop': require(actual['runtime']==r['serviceEvidence'][unit]['runtime'],'Website runtime drift since preflight')
  elif unit=='pocketbase' and phase=='cleanup-sync':
   old=result['servicePhases']['stop'][unit]['properties']
   require(value['ExecMainStartTimestampMonotonic']!=old['ExecMainStartTimestampMonotonic'] and actual['runtime']['ExecStart'][0]['start_time']!=facts(old)['runtime']['ExecStart'][0]['start_time'] and value['NRestarts']==old['NRestarts'],'PocketBase target startup phase drift')
  else:
   previous='cleanup-sync' if phase=='cleanup-java' else 'stop'
   require(observed==result['servicePhases'][previous][unit],'Website runtime/start/group drift')
 result.setdefault('servicePhases',{})[phase]=current
def stopped(value):
 actual=configured('velocity-sync',value); record=actual['runtime']['ExecStart'][0]; old=facts(result['sync'])['runtime']['ExecStart'][0]
 require(value['ActiveState']=='inactive' and value['MainPID']=='0' and value['ExecMainStartTimestampMonotonic']==result['sync']['ExecMainStartTimestampMonotonic'] and value['NRestarts']==result['sync']['NRestarts'],'Stopped sync marker drift')
 require(record['pid']==old['pid'] and record['start_time']==old['start_time'] and record['stop_time']!='[n/a]' and (record['code'],record['status']) in [('killed','9'),('exited','0')],'ExecStart stopped phase mismatch')
 require(all(actual['runtime'][name]==facts(result['sync'])['runtime'][name] for name in execution_names if name!='ExecStart'),'Stopped auxiliary runtime drift')
 old_group=group_path(result['sync']['ControlGroup']); require(not os.path.exists(old_group+'/cgroup.procs') or not members(old_group),'Old sync group not empty')
 return actual

leaf_name='99-hololive-release-guard.conf'
contents={'velocity':'[Unit]\nRefuseManualStop=yes\n','velocity-sync':'[Unit]\nRefuseManualStart=yes\n[Service]\nRestart=no\nRestartForceExitStatus=\n'}
leaves={u:'/run/systemd/system/'+u+'.service.d/'+leaf_name for u in contents}
def unchanged():
 require(identity(r['configFile'])==r['configIdentity'] and digest(read(r['configFile']))==r['configSha256'],'Config drift')
 require(identity(lock)==r['lockIdentity'],'Lock inode drift')
 require(json.loads(read(lock))=={'revision':r['revision'],'runNumber':r['runNumber'],'pid':r['runnerPID']},'Lock run drift')
 require(digest(read(candidate_manifest))==r['candidateManifestSha256'],'Candidate drift')
def java():
 value=props('velocity',marker_names); require(value['ActiveState']=='active','Java inactive')
 java_facts=configured('velocity'); require(java_facts['runtime']==r['serviceEvidence']['velocity']['runtime'],'Java command runtime drift')
 require(props('velocity',['Requires','BindsTo','PartOf'])==dict(line.split('=',1) for line in config['velocityServiceBinding'].splitlines()),'Java dependency drift')
 running(dict(value,**props('velocity',service_names)))
 base='/proc/'+value['MainPID']; command=java_facts['configuration']['ExecStart'][0]
 actual=[read(base+'/stat').decode().rsplit(')',1)[1].split()[19],os.path.realpath(base+'/exe'),read(base+'/cmdline').split(b'\0')[:-1]]
 require(actual[1]==os.path.realpath(command['path']) and actual[2]==[x.encode() for x in command['argv']] and '0::'+value['ControlGroup'] in read(base+'/cgroup').decode().splitlines(),'Java process command/group drift')
 if 'javaProcess' not in result: result['javaProcess']=[actual[0],actual[1],[x.decode() for x in actual[2]]]
 require(result['javaProcess']==[actual[0],actual[1],[x.decode() for x in actual[2]]],'Java process start drift')
 require(value==result['java'],'Java startup/group drift')
 rows=ctl(['list-jobs','--no-pager','--no-legend','--plain']).splitlines()
 require(not any(any(unit in row.split() for unit in ['velocity.service','velocity-sync.service']) for row in rows),'Velocity job in flight')
 files=[]
 for name in config['protectedVelocityFiles']:
  require(not name.startswith('/') and all(x not in ['', '.', '..'] for x in name.split('/')),'Unsafe protected name')
  f=real(config['velocityRoot']+'/'+name); files.append([name,identity(f),digest(read(f)),file_flags(f)])
 require(files==result['files'],'Protected Velocity file drift')
 for name in ['velocity.jar.tmp','velocity.jar.bak']: require(not os.path.lexists(config['velocityRoot']+'/'+name),'Transient JAR present')
 listeners=subprocess.check_output(['/usr/bin/ss','-lnt'],text=True,timeout=10)
 require(all(':'+str(port)+' ' in listeners for port in config['velocityPorts']),'Java listener missing')
def group_path(group):
 require(group.startswith('/') and group!='/' and all(x not in ['', '.', '..'] for x in group[1:].split('/')),'Unsafe cgroup')
 return real('/sys/fs/cgroup'+group)
def members(group):
 values=[]
 for root,dirs,files in os.walk(group):
  real(root)
  values+= [int(x) for x in read(root+'/cgroup.procs').split()]
 return sorted(set(values))
def process_binding(group,code_hash=None):
 value=props('velocity-sync',sync_names)
 require(value==result['sync'],'Sync unit/start/group drift'); configured('velocity-sync',value); running(value)
 ids=members(group); require(ids==[int(value['MainPID'])],'Unexpected sync member/descendant')
 bindings=[]
 for pid in ids:
  base='/proc/'+str(pid)
  status=dict(line.split(':',1) for line in read(base+'/status').decode().splitlines() if ':' in line)
  require([int(x) for x in status['Uid'].split()]==[pwd.getpwnam(value['User'] or 'root').pw_uid]*4,'Sync process UID mismatch')
  require(os.path.realpath(base+'/exe')=='/usr/bin/node' and facts(value)['configuration']['ExecStart'][0]['path']=='/usr/bin/node','Unexpected sync executable')
  expected_gid=grp.getgrnam(value['Group']).gr_gid if value['Group'] else pwd.getpwnam(value['User'] or 'root').pw_gid
  require([int(x) for x in status['Gid'].split()]==[expected_gid]*4,'Sync process GID mismatch')
  require(os.path.realpath(base+'/cwd')==config['webRoot']+'/backend/scripts','Unexpected sync cwd')
  args=read(base+'/cmdline').split(b'\0'); require(args[-1]==b'','Unterminated sync command'); args=args[:-1]
  require(args==[x.encode() for x in facts(value)['configuration']['ExecStart'][0]['argv']],'Unexpected sync command')
  groups=read(base+'/cgroup').decode().splitlines(); require('0::'+value['ControlGroup'] in groups,'Process cgroup mismatch')
  # Thread-specific fd tables also cover unshared descriptor tables.
  for tid in os.listdir(base+'/task'):
   for fd in os.listdir(base+'/task/'+tid+'/fd'):
    target=os.readlink(base+'/task/'+tid+'/fd/'+fd)
    require(not ('io_uring' in target or '[aio]' in target),'Asynchronous kernel I/O descriptor')
    require(not target.startswith(config['velocityRoot']+'/'),'Open protected Velocity file')
  bindings.append([pid,read(base+'/stat').decode().rsplit(')',1)[1].split()[19]])
 require(digest(read(config['webRoot']+'/backend/scripts/sync_velocity.js'))==(code_hash or config['finiteStop']['syncCodeSha256']),'Sync code drift')
 return bindings
def frozen(group): return dict(x.split() for x in read(group+'/cgroup.events').decode().splitlines()).get('frozen')=='1'
def wait_for(fn,message):
 end=time.monotonic()+10
 while not fn():
  require(time.monotonic()<end,message); time.sleep(.02)
def own_leaves():
 for unit,owned in result['leaves'].items():
  require(identity(leaves[unit])==owned and read(leaves[unit]).decode()==contents[unit],'Foreign/replaced runtime leaf')
 for unit,owned in result.get('parents',{}).items():
  if owned is not None and unit in result['leaves']: require(identity(os.path.dirname(leaves[unit]))==owned,'Runtime parent replaced')
 for unit,owned in result['directories'].items(): require(identity(os.path.dirname(leaves[unit]))==owned,'Runtime directory replaced')
def write_sys(group,name):
 unchanged(); require(group_path(result['sync']['ControlGroup'])==group,'Cgroup path drift')
 require(identity(group)==result['groupIdentity'],'Cgroup inode drift')
 result['attempted'].append(name); result['changed']=True
 fd=os.open(real(group+'/'+name),os.O_WRONLY|os.O_NOFOLLOW)
 try: os.write(fd,b'1')
 finally: os.close(fd)
def effective():
 return {'velocity':props('velocity',['RefuseManualStop']),'velocity-sync':props('velocity-sync',['RefuseManualStart','Restart','RestartForceExitStatus'])}
def observations():
 result['observedSync']=props('velocity-sync',marker_names); result['effectiveProperties']=effective()
 if 'sync' in result:
  current=group_path(result['sync']['ControlGroup'])
  result['frozenObserved']=frozen(current) if os.path.exists(current+'/cgroup.events') else None
  result['membersObserved']=members(current) if os.path.exists(current+'/cgroup.procs') else []
def remove(unit):
 unchanged(); own_leaves(); java(); file=leaves[unit]
 result['attempted'].append('remove-'+unit); os.unlink(file); del result['leaves'][unit]
 if unit in result['directories']:
  directory=os.path.dirname(file)
  if not os.listdir(directory): os.rmdir(directory); del result['directories'][unit]
 ctl(['daemon-reload']); now=effective()
 require(now[unit]==result['originalProperties'][unit],'Runtime properties not restored')
try:
 require(set(r)=={'operation','configFile','configIdentity','configSha256','lockIdentity','revision','runNumber','runId','repository','runnerPID','runnerUID','runnerGID','bundle','candidateManifestSha256','velocityEvidence','serviceEvidence','state'},'Unknown finite request field')
 require(r['operation'] in ['stop','cleanup-sync','cleanup-java'],'Unknown finite operation')
 require(os.geteuid()==0,'Finite child requires actual root')
 config=json.loads(read(real(r['configFile']))); require(identity(r['configFile'])[2]==0 and identity(r['configFile'])[4]&0o022==0,'Unsafe root config')
 runner=pwd.getpwnam(config['runnerUser']); require(os.environ.get('SUDO_USER')==config['runnerUser'] and runner.pw_uid==r['runnerUID'] and runner.pw_gid==r['runnerGID'],'Wrong actual sudo runner')
 require(config['approvedRevision']==r['revision'] and config['repository']==r['repository'] and str(r['runId']).isdigit(),'Wrong candidate/run/repository')
 require(digest(read('/etc/machine-id'))==config['machineIdSha256'],'Wrong root host')
 roots=[real(config[k]) for k in ['webRoot','stateRoot','backupRoot','velocityRoot']]
 require(all(a!='/' and not(a==b or a.startswith(b+'/') or b.startswith(a+'/')) for i,a in enumerate(roots) for b in roots[i+1:]),'Overlapping finite roots')
 lock=real(config['stateRoot']+'/deployment.lock'); candidate_manifest=real(r['bundle']+'/release.json'); unchanged()
 require(json.loads(read(candidate_manifest))['revision']==r['revision'],'Wrong candidate manifest')
 result=r['state'] if r['state'] else result
 require(set(r['serviceEvidence'])==set(config['websiteServices']+['velocity']),'Missing/unknown service evidence')
 for unit in config['websiteServices']+['velocity']: configured(unit)
 owner={k:r[k] for k in ['revision','runNumber','runId','repository','lockIdentity','runnerPID','configSha256']}
 if r['operation']=='stop':
  result['owner']=owner
  service_phases('stop')
  result['java']=props('velocity',marker_names)
  require(r['velocityEvidence'] and all(result['java'].get(k)==v for k,v in dict(line.split('=',1) for line in r['velocityEvidence']['service'].splitlines()).items()),'Java drift since outer pre-stop baseline')
  result['sync']=props('velocity-sync',sync_names)
  require(result['sync']['ActiveState']=='active' and result['sync']['WorkingDirectory']==config['webRoot']+'/backend/scripts','Unexpected sync unit')
  require(all(not value for value in props('velocity-sync',['ExecStop','ExecStopPost']).values()),'Unapproved sync stop command')
  configured('velocity-sync',result['sync']); running(result['sync'])
  require(facts(result['sync'])['runtime']==r['serviceEvidence']['velocity-sync']['runtime'],'Sync runtime drift since preflight')
  require(result['java']['ControlGroup']!=result['sync']['ControlGroup'],'Shared Java/sync group')
  group=group_path(result['sync']['ControlGroup']); jgroup=group_path(result['java']['ControlGroup'])
  require(not(group.startswith(jgroup+'/') or jgroup.startswith(group+'/')),'Nested Java/sync group')
  result['groupIdentity']=identity(group)
  require(not frozen(group),'Sync already frozen')
  result['files']=[[n,identity(real(config['velocityRoot']+'/'+n)),digest(read(config['velocityRoot']+'/'+n)),file_flags(config['velocityRoot']+'/'+n)] for n in config['protectedVelocityFiles']]
  require(all(any(f[0]==entry['path'] and f[2]==entry.get('sha256') and f[1][4]==entry.get('mode') for f in result['files']) for entry in r['velocityEvidence']['files']),'Java files drift since outer pre-stop baseline')
  java(); result['processes']=process_binding(group); result['originalProperties']=effective()
  require(props('velocity',['Requires','BindsTo','PartOf'])==dict(line.split('=',1) for line in config['velocityServiceBinding'].splitlines()),'Java dependency drift')
  real('/run/systemd/system'); require(identity('/run/systemd/system')[2]==0 and identity('/run/systemd/system')[4]&0o022==0,'Unsafe runtime parent')
  for unit,file in leaves.items():
   directory=os.path.dirname(file); require(not os.path.lexists(file),'Existing runtime leaf')
   if os.path.lexists(directory): real(directory); require(identity(directory)[2]==0 and identity(directory)[4]&0o022==0,'Unsafe runtime directory')
   result.setdefault('parents',{})[unit]=identity(directory) if os.path.exists(directory) else None
  for unit,file in leaves.items():
   unchanged(); java(); directory=os.path.dirname(file)
   if result['parents'][unit] is not None: require(identity(directory)==result['parents'][unit],'Runtime parent drift')
   if not os.path.exists(directory):
    result['attempted'].append('mkdir-'+unit); os.mkdir(directory,0o755); result['changed']=True; result['directories'][unit]=identity(directory)
   result['attempted'].append('create-'+unit); fd=os.open(file,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o644); result['changed']=True; result['leaves'][unit]=identity(file)
   try: os.write(fd,contents[unit].encode()); os.fsync(fd)
   finally: os.close(fd)
  own_leaves(); result['attempted'].append('reload'); ctl(['daemon-reload'])
  require(effective()=={'velocity':{'RefuseManualStop':'yes'},'velocity-sync':{'RefuseManualStart':'yes','Restart':'no','RestartForceExitStatus':''}},'Runtime protection not effective')
  java(); write_sys(group,'cgroup.freeze'); wait_for(lambda:frozen(group),'Sync freeze timed out'); result['frozen']=True
  java(); require(process_binding(group)==result['processes'],'Frozen process identity drift'); own_leaves()
  require(frozen(group),'Sync thawed before kill'); java(); require(frozen(group),'Sync thawed at kill boundary')
  write_sys(group,'cgroup.kill'); result['killed']=True; wait_for(lambda:not members(group),'Sync exit timed out')
  java(); ctl(['stop','velocity-sync']); result['stopped']=True
  result['stoppedSync']=props('velocity-sync',sync_names); stopped(result['stoppedSync'])
 else:
  require(result.get('owner')==owner,'Runtime ownership belongs to another run')
  require(result['stopped'] and result['changed'],'Missing original stop ownership'); own_leaves(); java(); service_phases(r['operation'])
  guard=read(config['webRoot']+'/backend/.velocity-maintenance'); require(guard,'Persistent maintenance guard absent')
  script=config['webRoot']+'/backend/scripts/sync_velocity.js'; candidate=read(r['bundle']+'/backend/scripts/sync_velocity.js')
  require(read(script)==candidate and b'.velocity-maintenance' in candidate,'Guard-aware installed candidate mismatch')
  current_sync=props('velocity-sync',sync_names); configured('velocity-sync',current_sync)
  if r['operation']=='cleanup-sync':
   stopped(current_sync); require(current_sync==result['stoppedSync'],'Stopped cleanup phase drift')
  if r['operation']=='cleanup-java':
   old_sync=result['sync']; running(current_sync)
   require(all(facts(current_sync)['runtime'][name]==facts(old_sync)['runtime'][name] for name in ['ExecReload','ExecStop','ExecStopPost']),'Unexpected new-sync command execution')
   result['newSync']=current_sync; result['sync']=current_sync
   require(result['sync']['ExecMainStartTimestampMonotonic']!=old_sync['ExecMainStartTimestampMonotonic'] and result['sync']['NRestarts']==old_sync['NRestarts'],'New sync start/restart marker drift')
   require(facts(result['sync'])['runtime']['ExecStart'][0]['start_time']!=facts(old_sync)['runtime']['ExecStart'][0]['start_time'],'New sync command start drift')
   new_group=group_path(result['sync']['ControlGroup']); java_group=group_path(result['java']['ControlGroup'])
   require(new_group!=java_group and not(new_group.startswith(java_group+'/') or java_group.startswith(new_group+'/')),'New sync shares Java group')
   process_binding(new_group,digest(candidate))
  remove('velocity-sync' if r['operation']=='cleanup-sync' else 'velocity')
 observations()
 print(json.dumps({'ok':True,'rootEUID':os.geteuid(),'runnerUID':runner.pw_uid,'runnerGID':runner.pw_gid,'state':result}))
except Exception as e:
 # Partial writes and attempted operations survive even when stop never returns.
 result['reason']=str(e)
 try: observations()
 except Exception as observation: result['observationError']=str(observation)
 print(json.dumps({'ok':False,'rootEUID':os.geteuid(),'state':result,'reason':str(e)}))
`;

export function productionAdapter(bundle, config, revision, runNumber, configFile) {
  const state = path.join(config.stateRoot, 'deployment.json');
  const lock = path.join(config.stateRoot, 'deployment.lock');
  const guard = path.join(config.webRoot, 'backend/.velocity-maintenance');
  const pb = path.join(config.webRoot, 'backend/pocketbase');
  let lockFd, backupPath, oldState, effectiveBaseline = config.baseline, captured = false, onlineLedger, preflightSources, configIdentity, configSha256, maintenance = null, installed = false, migrated = false, authenticated = false, velocityBaseline, serviceEvidence;
  const firstCapture = config.baseline?.capture === 'stopped-backup';
  const captureDescriptor = firstCapture ? JSON.stringify(config.baseline) : null;
  const captureBinding = directory => ({ revision, runNumber, runId: process.env.GITHUB_RUN_ID, repository: process.env.GITHUB_REPOSITORY, snapshotDirectory: directory });
  const assertCaptured = backup => {
    if (firstCapture) check(backup === backupPath, 'Capture snapshot directory mismatch');
    if (firstCapture) check(captured && config.approvedRevision === revision && config.repository === process.env.GITHUB_REPOSITORY && JSON.stringify(config.baseline) === captureDescriptor && JSON.stringify(effectiveBaseline.captureBinding) === JSON.stringify(captureBinding(backup)), 'Capture candidate/run binding mismatch');
    return verifySnapshot(backup, effectiveBaseline);
  };
  const controlParents = new Map([state, guard, lock].map(file => [path.dirname(file), fs.lstatSync(path.dirname(file))]));
  const boundControl = file => {
    const parent = path.dirname(file), expected = controlParents.get(parent), current = fs.lstatSync(parent);
    check(expected && current.dev === expected.dev && current.ino === expected.ino, 'Maintenance parent binding changed');
    return controlPath(file);
  };
  const writeControl = (file, value) => { boundControl(file); controlWrite(file, value, boundControl); };
  const sourceBindings = () => ({
    migrations: fs.existsSync(path.join(config.webRoot, 'backend/pb_migrations')) ? inventory(config.webRoot, ['backend/pb_migrations']) : [],
    configuration: config.configurationFiles.map(file => { const stat = fs.lstatSync(file); check(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1, 'Unsafe declared configuration'); return { path: file, sha256: sha(fs.readFileSync(file)), mode: stat.mode & 0o777, uid: stat.uid, gid: stat.gid }; }),
  });
  const assertSources = () => { if (preflightSources) check(JSON.stringify(sourceBindings()) === JSON.stringify(preflightSources), 'Migration/configuration changed since preflight'); };
  const finiteRoot = operation => {
    check(/^[a-f0-9]{64}$/.test(config.finiteStop?.syncCodeSha256 ?? ''), 'Missing current finite sync code binding');
    check(lockFd !== undefined && configIdentity && configSha256, 'Finite stop requires verified config and active lock');
    const lockStat = boundControl(lock), opened = fs.fstatSync(lockFd);
    check(lockStat && opened.dev === lockStat.dev && opened.ino === lockStat.ino, 'Finite stop lock inode drift');
    check(sha(fs.readFileSync(configFile)) === configSha256, 'Finite stop config drift');
    check(process.env.GITHUB_REPOSITORY === config.repository && /^[0-9]+$/.test(process.env.GITHUB_RUN_ID ?? ''), 'Finite child current Actions binding drift');
    verifyBundle(bundle, revision);
    const identity = stat => [stat.dev, stat.ino, stat.uid, stat.gid, stat.mode & 0o7777, stat.nlink];
    const runner = os.userInfo();
    check(runner.username === config.runnerUser && runner.uid !== 0, 'Finite stop requires actual nonroot runner');
    const request = { operation, configFile, configIdentity, configSha256, lockIdentity: identity(opened), revision, runNumber, runId: process.env.GITHUB_RUN_ID, repository: process.env.GITHUB_REPOSITORY, runnerPID: process.pid, runnerUID: runner.uid, runnerGID: runner.gid, bundle, candidateManifestSha256: sha(fs.readFileSync(path.join(bundle, 'release.json'))), velocityEvidence: velocityBaseline ?? null, serviceEvidence, state: maintenance };
    let result;
    try { result = JSON.parse(execFileSync('sudo', ['-n', '/usr/bin/python3', '-I', '-c', finiteRootSource], { input: JSON.stringify(request), encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 60000 })); }
    catch (error) { maintenance = { ...(maintenance ?? {}), uncertain: true, operation, reason: 'Finite child result unavailable: ' + error.message }; throw error; }
    maintenance = result.ok ? result.state : { ...(maintenance ?? {}), ...result.state, changed: maintenance?.changed === true || result.state?.changed === true }; 
    check(result.rootEUID === 0 && result.ok && result.runnerUID === runner.uid && result.runnerGID === runner.gid, result.reason ?? 'Finite root/runner binding refused');
    check(maintenance && typeof maintenance.changed === 'boolean', 'Missing finite maintenance state');
    return maintenance;
  };
  const systemctl = (action, unit) => {
    check(config.websiteServices.includes(unit) && units.includes(unit), 'Service outside whitelist');
    command('sudo', ['-n', 'systemctl', action, unit]);
  };
  const velocity = () => {
    const value = {
      service: command('systemctl', ['show', 'velocity', '-p', 'MainPID', '-p', 'ExecMainStartTimestampMonotonic', '-p', 'NRestarts', '-p', 'ActiveState']),
      files: inventory(config.velocityRoot, config.protectedVelocityFiles),
      listeners: command('ss', ['-lnt']),
    };
    velocityBaseline ??= value;
    return value;
  };
  const assertRunState = value => check(!value || (value.status === 'deployed' && runNumber > value.runNumber), 'Older/repeated run or unresolved failed deployment');
  const assertCurrent = () => {
    check(command('git', ['ls-remote', 'origin', 'refs/heads/main']).split(/\s/)[0] === revision, 'Stale main revision');
    oldState = controlRead(state, boundControl);
    assertRunState(oldState);
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
      assertRunState(controlRead(state, boundControl));
      for (const file of config.configurationFiles) {
        assertRealPath(file);
        const owner = fs.statSync(file);
        assertRecoverableOwners([{ uid: owner.uid, gid: owner.gid }]);
      }
      verifyBundle(bundle, revision);
      verifyImmutableMigrations(bundle, config.webRoot, config.baseline);
      if (config.baseline?.kind === 'mixed') {
        if (firstCapture) {
          onlineLedger = readMigrationLedger(path.join(config.webRoot, 'backend/pb_data'));
          verifyMixedHistory(bundle, config.webRoot, config.baseline, onlineLedger);
        } else {
          const manifest = verifySnapshot(config.baseline.snapshotDirectory, config.baseline);
          assertSnapshotTarget(config.baseline.snapshotDirectory, config.webRoot);
          verifyMixedHistory(bundle, config.webRoot, config.baseline, manifest.contract['data.db'].migrations);
        }
      }
      verifyInstallTargets(config.webRoot, config.configurationFiles);
      preflightSources = sourceBindings();
      for (const endpoint of [state, guard, lock]) boundControl(endpoint);
      check(process.env.GITHUB_REPOSITORY === config.repository && /^[0-9]+$/.test(process.env.GITHUB_RUN_ID ?? '') && ['push', 'workflow_dispatch'].includes(process.env.GITHUB_EVENT_NAME), 'Missing actual Actions run/repository binding');
      assertRealPath(configFile);
      const configStat = fs.statSync(configFile);
      check(fs.lstatSync(configFile).isFile() && configStat.nlink === 1, 'Invalid production config endpoint');
      configIdentity = [configStat.dev, configStat.ino, configStat.uid, configStat.gid, configStat.mode & 0o7777, configStat.nlink];
      configSha256 = sha(fs.readFileSync(configFile));
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
        const facts = serviceFacts(showService(unit)), approved = serviceFacts(config.serviceBindings[unit]);
        check(JSON.stringify(facts.configuration) === JSON.stringify(approved.configuration), 'Service binding drift: ' + unit);
        serviceEvidence ??= {};
        serviceEvidence[unit] = { configuration: facts.configuration, runtime: facts.runtime, environment: serviceEnvironment(facts, config) };
      }
      const javaFacts = serviceFacts(showService('velocity'));
      serviceEvidence.velocity = { configuration: javaFacts.configuration, runtime: javaFacts.runtime, environment: serviceEnvironment(javaFacts, config) };
      for (const file of config.configurationFiles) assertRealPath(file);
    },
    lock: () => { boundControl(lock); lockFd = fs.openSync(lock, 'wx', 0o600); fs.writeFileSync(lockFd, JSON.stringify({ revision, runNumber, pid: process.pid })); },
    unlock: () => { if (lockFd !== undefined) {
      try { const current = boundControl(lock), opened = fs.fstatSync(lockFd); check(current && current.dev === opened.dev && current.ino === opened.ino, 'Maintenance lock changed'); fs.unlinkSync(lock); }
      finally { fs.closeSync(lockFd); lockFd = undefined; }
    } },
    assertCurrent,
    velocity,
    maintenance: () => maintenance,
    stop: unit => unit === 'velocity-sync' ? finiteRoot('stop') : systemctl('stop', unit),
    guard: () => writeControl(guard, 'Website maintenance: explicit release of Velocity synchronization requires separate authorization.\n'),
    backup: () => {
      if (firstCapture) check(!captured && onlineLedger && JSON.stringify(config.baseline) === captureDescriptor, 'First capture requires verified unchanged descriptor and one backup');
      assertSources();
      backupPath = fs.mkdtempSync(path.join(config.backupRoot, `run-${runNumber}-`));
      fs.chmodSync(backupPath, 0o700);
      const snapshot = snapshotApplication(config.webRoot, backupPath);
      check(JSON.stringify(inventory(config.webRoot, snapshot.present)) === JSON.stringify(snapshot.application), 'Application capture drift/incomplete copy');
      copyPaths('/', path.join(backupPath, 'configuration'), config.configurationFiles.map(file => file.slice(1)));
      const contract = checkDatabases(path.join(backupPath, 'application/backend/pb_data'));
      const configuration = inventory(path.join(backupPath, 'configuration'), config.configurationFiles.map(file => file.slice(1)));
      const ownership = config.configurationFiles.map(file => { const stat = fs.statSync(file); return { path: file.slice(1), uid: stat.uid, gid: stat.gid }; });
      assertSources();
      if (preflightSources) check(JSON.stringify(fs.existsSync(path.join(backupPath, 'application/backend/pb_migrations')) ? inventory(path.join(backupPath, 'application'), ['backend/pb_migrations']) : []) === JSON.stringify(preflightSources.migrations), 'Migration capture drift');
      check(JSON.stringify(configuration) === JSON.stringify(inventory(path.join(backupPath, 'configuration'), config.configurationFiles.map(file => file.slice(1)))), 'Configuration capture drift');
      for (const item of preflightSources?.configuration ?? []) { const copied = path.join(backupPath, 'configuration', item.path.slice(1)), stat = fs.statSync(copied); check(sha(fs.readFileSync(copied)) === item.sha256 && (stat.mode & 0o777) === item.mode, 'Configuration capture ownership/content drift'); }
      if (preflightSources) check(JSON.stringify(ownership) === JSON.stringify(preflightSources.configuration.map(item => ({ path: item.path.slice(1), uid: item.uid, gid: item.gid }))), 'Configuration source ownership drift');
      const value = { revision: config.baseline?.kind === 'mixed' ? null : oldState?.revision ?? config.previousRevision, ...snapshot, configuration, ownership, contract, retainedHistory: config.baseline?.retainedHistory ?? [], sourceAbsentHistory: config.baseline?.sourceAbsentHistory ?? [] };
      if (firstCapture) {
        verifyMixedHistory(bundle, path.join(backupPath, 'application'), config.baseline, contract['data.db'].migrations);
        check(JSON.stringify(contract['data.db'].migrations) === JSON.stringify(onlineLedger), 'Applied history changed since preflight');
        value.captureBinding = captureBinding(backupPath);
      }
      value.snapshotId = snapshotIdentity(value);
      writeJSON(path.join(backupPath, 'backup.json'), value);
      if (firstCapture) { effectiveBaseline = { ...config.baseline, snapshotId: value.snapshotId, snapshotDirectory: backupPath, captureBinding: value.captureBinding }; captured = true; }
      if (config.baseline?.kind === 'mixed') assertCaptured(backupPath);
      return backupPath;
    },
    rehearse: backup => {
      const manifest = json(path.join(backup, 'backup.json'));
      if (manifest.snapshotId) assertCaptured(backup);
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
    baseline: backup => { assertCaptured(backup); writeJSON(path.join(backup, 'before-contract.json'), checkDatabases(path.join(backup, 'application/backend/pb_data'))); },
    install: () => { assertSources(); verifyInstallTargets(config.webRoot, config.configurationFiles); assertCaptured(backupPath); installBundle(bundle, config.webRoot, revision, effectiveBaseline, backupPath); installed = true; },
    migrate: () => { const output = migrateCopy(config.webRoot); check(!/Failed|Error:/i.test(output), 'Production migration failed'); fs.writeFileSync(path.join(backupPath, 'production-migration.log'), output, { mode: 0o600 }); verifyRecoverySecurity(config.webRoot, config.recoveryIdentities); const expected = json(path.join(backupPath, 'expected-recovery-contract.json')); verifyRecoveryContract(config.webRoot, expected.expectedContract, json(path.join(backupPath, 'backup.json')).contract); migrated = true; },
    start: unit => {
      if (unit === 'velocity-sync') {
        check(installed && migrated && authenticated, 'Sync cleanup requires installed/migrated/authenticated target');
        finiteRoot('cleanup-sync');
        systemctl('start', unit);
        finiteRoot('cleanup-java');
      } else systemctl(unit === 'pocketbase' ? 'start' : 'restart', unit);
    },
    health: async () => {
      for (let i = 0; i < 30; i++) {
        try { const response = await fetch(config.pocketbaseHealthUrl, { signal: AbortSignal.timeout(1000) }); const data = await response.json(); if (response.ok && data.code === 200) break; } catch { /* retry bounded startup */ }
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      const response = await fetch(config.pocketbaseHealthUrl, { signal: AbortSignal.timeout(1000) });
      check(response.ok && (await response.json()).code === 200, 'PocketBase startup health failed');
      await authenticateTarget(); authenticated = true;
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
      const backupManifest = backupPath ? assertCaptured(backupPath) : null;
      writeControl(state, JSON.stringify({ ...value, baseline: backupManifest?.snapshotId ?? null, candidateManifest: verifyBundle(bundle, revision), retainedHistory: config.baseline?.retainedHistory ?? [], runId: process.env.GITHUB_RUN_ID, runUrl: `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`, trigger: process.env.GITHUB_EVENT_NAME, completedAt: new Date().toISOString() }) + '\n');
    },
    failure: value => writeControl(state, JSON.stringify({ ...value, backup: backupPath ?? value.backup, runNumber, failedAt: new Date().toISOString() }) + '\n'),
  };
}

function assertRecoverableOwners(owners) {
  const uid = process.geteuid(), groups = new Set([process.getegid(), ...process.getgroups()]);
  for (const owner of owners) {
    check(Number.isSafeInteger(owner.uid) && owner.uid >= 0 && owner.uid < 4294967295 && Number.isSafeInteger(owner.gid) && owner.gid >= 0 && owner.gid < 4294967295, 'Invalid configuration ownership metadata');
    check(uid === 0 || (owner.uid === uid && groups.has(owner.gid)), 'Configuration ownership cannot be reconstructed by actual runner');
  }
}

export function restoreBackup(backup, destination) {
  // Always isolated; never silently restores a running production directory.
  check(!fs.existsSync(destination), 'Restore destination must be new');
  const manifest = json(path.join(backup, 'backup.json'));
  check(manifest.present.every(name => [...artifactPaths, 'backend/pb_data', 'backend/pocketbase'].includes(name)), 'Backup whitelist mismatch');
  check(JSON.stringify(inventory(path.join(backup, 'application'), manifest.present)) === JSON.stringify(manifest.application), 'Corrupt backup');
  if (manifest.snapshotId) verifySnapshot(backup);
  if (manifest.configuration) {
    const names = manifest.configuration.map(item => item.path);
    check(names.every(safeRelative) && new Set(names).size === names.length && manifest.configuration.every(item => item.sha256 && !item.link && !item.directory), 'Invalid configuration manifest');
    check(Array.isArray(manifest.ownership) && manifest.ownership.length === names.length && new Set(manifest.ownership.map(item => item.path)).size === names.length && manifest.ownership.every(item => names.includes(item.path)), 'Missing/duplicate configuration ownership metadata');
    assertRecoverableOwners(manifest.ownership);
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
