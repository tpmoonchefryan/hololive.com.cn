#!/usr/bin/env node
// Existing-host maintenance. Production bindings live in a separately approved,
// root-owned config; no default host, web root, service installation or accounts.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
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

// This checks the closed private channel and token claims; authentication is
// proved separately by the same target's users and protected collection APIs.
export function decodeIdentitySupply(raw, expected, now = Math.floor(Date.now() / 1000)) {
  const fail = () => { throw new Error('Offline identity channel refused'); };
  try {
    if (typeof raw !== 'string' || raw.length > 16384 || !/^[\x20-\x7e]+\n$/.test(raw)) fail();
    const frame = raw.slice(0, -1), proof = JSON.parse(frame);
    if (!proof || Array.isArray(proof) || Object.keys(proof).join(',') !== 'nonce,revision,runId,humanId,token' || JSON.stringify(proof) !== frame) fail();
    if (!/^[a-f0-9]{64}$/.test(proof.nonce) || !/^[a-f0-9]{40}$/.test(proof.revision) || !/^[0-9]+$/.test(proof.runId) || !/^[a-z0-9]{15}$/.test(proof.humanId)) fail();
    for (const key of ['nonce', 'revision', 'runId', 'humanId']) if (typeof proof[key] !== 'string' || proof[key] !== expected[key]) fail();
    if (typeof proof.token !== 'string' || !proof.token.length || proof.token.length >= 8192) fail();
    const parts = proof.token.split('.');
    if (parts.length !== 3 || parts.some(part => !/^[A-Za-z0-9_-]+$/.test(part) || Buffer.from(part, 'base64url').toString('base64url') !== part)) fail();
    const decode = part => {
      const bytes = Buffer.from(part, 'base64url');
      if (bytes.length > 4096) fail();
      const text = bytes.toString('utf8');
      if (!Buffer.from(text, 'utf8').equals(bytes)) fail();
      const value = JSON.parse(text);
      if (!value || typeof value !== 'object' || Array.isArray(value) || JSON.stringify(value) !== text) fail();
      return value;
    };
    const header = decode(parts[0]), claims = decode(parts[1]);
    if (header.alg !== 'HS256' || header.typ !== 'JWT' || Buffer.from(parts[2], 'base64url').length !== 32) fail();
    if (claims.type !== 'auth' || claims.id !== proof.humanId || typeof claims.collectionId !== 'string' || !/^[A-Za-z0-9_]{1,64}$/.test(claims.collectionId) || claims.refreshable !== false || !Number.isSafeInteger(now) || !Number.isSafeInteger(claims.exp) || claims.exp - now <= 0 || claims.exp - now > 900) fail();
    return { ...proof, collectionId: claims.collectionId };
  } catch { fail(); }
}

// systemctl's command values combine immutable configuration and execution
// records. Only the documented, unambiguous representation is admitted.
const executionNames = ['ExecCondition', 'ExecStartPre', 'ExecStart', 'ExecStartPost', 'ExecReload', 'ExecStop', 'ExecStopPost'];
const serviceNames = [...executionNames, 'WorkingDirectory', 'User', 'Group', 'EnvironmentFiles', 'Requires', 'BindsTo', 'PartOf'];
// systemd prints dependency unit sets in hash order, which a daemon-reload can
// change. Membership stays exact; only the printed order is normalized.
const dependencyNames = ['Requires', 'BindsTo', 'PartOf'];
export function dependencyList(value) {
  const units = value ? value.split(' ') : [];
  check(units.every(Boolean) && new Set(units).size === units.length, 'Ambiguous unit dependency list');
  return [...units].sort().join(' ');
}
export function dependencyLines(raw) {
  return raw.split('\n').map(line => {
    const at = line.indexOf('=');
    check(at > 0 && dependencyNames.includes(line.slice(0, at)), 'Unknown unit dependency property');
    return line.slice(0, at + 1) + dependencyList(line.slice(at + 1));
  }).join('\n');
}
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
    if (!executionNames.includes(name)) { configuration[name] = dependencyNames.includes(name) ? dependencyList(properties[name]) : properties[name]; continue; }
    configuration[name] = []; runtime[name] = [];
    let rest = properties[name];
    while (rest) {
      const match = /^\{ path=([^;{}]+) ; argv\[\]=([^;{}]+) ; ignore_errors=(yes|no) ; start_time=([^;{}]+) ; stop_time=([^;{}]+) ; pid=(\d+) ; code=([^;{}]+) ; status=(\d+|0\/0) \}(?: |$)/.exec(rest);
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
export const showService = unit => {
  const raw = command('systemctl', ['show', unit, '--all', ...serviceNames.flatMap(name => ['-p', name])]);
  const present = new Set(raw.split('\n').map(line => line.slice(0, line.indexOf('='))));
  const missing = serviceNames.filter(name => !present.has(name));
  if (!missing.length) return raw;
  check(missing.every(name => executionNames.includes(name) || name === 'EnvironmentFiles'), 'Missing nonarray systemd property');
  const object = JSON.parse(command('/usr/bin/busctl', ['--system', '--json=short', 'call', 'org.freedesktop.systemd1', '/org/freedesktop/systemd1', 'org.freedesktop.systemd1.Manager', 'GetUnit', 's', unit.endsWith('.service') ? unit : unit + '.service']));
  check(Object.keys(object).sort().join(',') === 'data,type' && object.type === 'o' && Array.isArray(object.data) && object.data.length === 1 && /^\/org\/freedesktop\/systemd1\/unit\/[A-Za-z0-9_]+$/.test(object.data[0]), 'Missing typed systemd unit object');
  for (const name of missing) {
    const typed = JSON.parse(command('/usr/bin/busctl', ['--system', '--json=short', 'get-property', 'org.freedesktop.systemd1', object.data[0], 'org.freedesktop.systemd1.Service', name]));
    check(Object.keys(typed).sort().join(',') === 'data,type' && typed.type === (name === 'EnvironmentFiles' ? 'a(sb)' : 'a(sasbttttuii)') && Array.isArray(typed.data) && typed.data.length === 0, 'Missing property lacks typed empty-array proof');
  }
  return raw + '\n' + missing.map(name => name + '=').join('\n');
};
function serviceEnvironment(facts, config) {
  return facts.environment.map(item => {
    check(config.configurationFiles.includes(item.path) || config.configurationAbsent?.includes(item.path), 'EnvironmentFile outside approved configuration inventory');
    if (item.ignore_errors === 'yes' && config.configurationAbsent?.includes(item.path) && !fs.existsSync(item.path)) return { ...item, absent: true };
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

export function installBundle(bundle, webRoot, revision, baseline, backup, privateIO) {
  const manifest = verifyBundle(bundle, revision);
  assertRealPath(webRoot);
  verifyImmutableMigrations(bundle, webRoot, baseline);
  if (baseline?.kind === 'mixed') {
    verifySnapshot(backup, baseline, privateIO);
    assertSnapshotTarget(backup, webRoot, privateIO);
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
    ...(manifest.configurationAbsent ? { configurationAbsent: manifest.configurationAbsent } : {}),
    ...(manifest.captureBinding ? { captureBinding: manifest.captureBinding } : {}) }));
}
export function verifySnapshot(backup, baseline, privateIO) {
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
  if (privateIO) {
    const report = privateIO('inspect', backup);
    check(JSON.stringify(report.configuration) === JSON.stringify(manifest.configuration) && JSON.stringify(report.ownership) === JSON.stringify(manifest.ownership) && JSON.stringify(report.absent) === JSON.stringify(manifest.configurationAbsent), 'Configuration snapshot drift');
  } else check(JSON.stringify(inventory(path.join(backup, 'configuration'), names)) === JSON.stringify(manifest.configuration), 'Configuration snapshot drift');
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
function assertSnapshotTarget(backup, webRoot, privateIO) {
  const manifest = json(path.join(backup, 'backup.json'));
  check(JSON.stringify(inventory(webRoot, manifest.present)) === JSON.stringify(manifest.application), 'Target changed since stopped snapshot');
  for (const name of manifest.missing) check(!fs.existsSync(path.join(webRoot, name)), 'Previously missing target appeared');
  if (privateIO) {
    const report = privateIO('observe-source', backup);
    check(JSON.stringify(report.configuration) === JSON.stringify(manifest.configuration) && JSON.stringify(report.ownership) === JSON.stringify(manifest.ownership) && JSON.stringify(report.absent) === JSON.stringify(manifest.configurationAbsent), 'Target private configuration drift');
    return;
  }
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
export function createSafeRecovery(backup, migrated, bundle, revision, identities, expectedDirectory, privateIO) {
  const raw = verifySnapshot(backup, undefined, privateIO);
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
  const derivedConfiguration = privateIO ? privateIO('derive-safe', backup) : null;
  if (!privateIO) copyPaths(path.join(backup, 'configuration'), path.join(safe, 'configuration'), raw.configuration.map(item => item.path));
  const present = [...artifactPaths, 'backend/pb_data', 'backend/pocketbase'];
  const manifest = { revision, sourceSnapshotId: raw.snapshotId, present, missing: [], application: inventory(path.join(safe, 'application'), present),
    configuration: derivedConfiguration?.configuration ?? raw.configuration, ownership: derivedConfiguration?.ownership ?? raw.ownership, configurationAbsent: derivedConfiguration?.absent ?? raw.configurationAbsent, contract: checkDatabases(path.join(safe, 'application/backend/pb_data')),
    retainedHistory: raw.retainedHistory, sourceAbsentHistory: raw.sourceAbsentHistory, expectedContract, identities, candidateFiles: verifyBundle(bundle, revision).files };
  manifest.snapshotId = snapshotIdentity(manifest);
  manifest.recoveryId = sha(JSON.stringify({ snapshotId: manifest.snapshotId, sourceSnapshotId: raw.snapshotId, identities, candidateFiles: manifest.candidateFiles }));
  writeJSON(path.join(safe, 'backup.json'), manifest);
  return safe;
}
export function restoreSafeRecovery(safe, destination, revision, privateIO) {
  const manifest = verifySnapshot(safe, undefined, privateIO);
  check(manifest.revision === revision && /^[a-f0-9]{40}$/.test(revision) && /^[a-f0-9]{64}$/.test(manifest.sourceSnapshotId ?? ''), 'Recovery app/data binding mismatch');
  check(manifest.recoveryId === sha(JSON.stringify({ snapshotId: manifest.snapshotId, sourceSnapshotId: manifest.sourceSnapshotId, identities: manifest.identities, candidateFiles: manifest.candidateFiles })), 'Recovery identity binding mismatch');
  const app = manifest.application.filter(item => !item.path.startsWith('backend/pb_data') && item.path !== 'backend/pocketbase' && !(manifest.retainedHistory ?? []).some(old => old.path === item.path));
  check(JSON.stringify(app) === JSON.stringify(manifest.candidateFiles), 'Recovery candidate mismatch');
  const source = verifySnapshot(path.dirname(safe), undefined, privateIO);
  const expectation = json(path.join(path.dirname(safe), 'expected-recovery-contract.json'));
  check(source.snapshotId === manifest.sourceSnapshotId && expectation.sourceSnapshotId === source.snapshotId && expectation.revision === revision && JSON.stringify(expectation.candidateFiles) === JSON.stringify(manifest.candidateFiles) && JSON.stringify(expectation.expectedContract) === JSON.stringify(manifest.expectedContract), 'Recovery expected contract binding mismatch');
  check(Array.isArray(expectation.identities) && JSON.stringify(expectation.identities) === JSON.stringify(manifest.identities), 'Recovery original identities permission binding mismatch');
  verifyDerivedData(path.join(path.dirname(safe), 'application'), path.join(safe, 'application'), expectation.identities);
  verifyRecoveryContract(path.join(safe, 'application'), expectation.expectedContract, source.contract);
  verifyRecoverySecurity(path.join(safe, 'application'), expectation.identities);
  const result = restoreBackup(safe, destination, privateIO);
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
 require(all(len(row)==2 for row in rows) and len(set(row[0] for row in rows))==len(rows) and set(row[0] for row in rows).issubset(names),'Duplicate/unknown unit property')
 missing=[name for name in names if name not in dict(rows)]
 if missing:
  require(all(name in ['ExecCondition','ExecStartPre','ExecStart','ExecStartPost','ExecReload','ExecStop','ExecStopPost','EnvironmentFiles'] for name in missing),'Missing nonarray property')
  object=json.loads(subprocess.check_output(['/usr/bin/busctl','--system','--json=short','call','org.freedesktop.systemd1','/org/freedesktop/systemd1','org.freedesktop.systemd1.Manager','GetUnit','s',unit if unit.endswith('.service') else unit+'.service'],text=True,timeout=10))
  require(set(object)=={'type','data'} and object['type']=='o' and isinstance(object['data'],list) and len(object['data'])==1 and re.fullmatch('/org/freedesktop/systemd1/unit/[A-Za-z0-9_]+',object['data'][0]),'Missing typed unit object')
  for name in missing:
   typed=json.loads(subprocess.check_output(['/usr/bin/busctl','--system','--json=short','get-property','org.freedesktop.systemd1',object['data'][0],'org.freedesktop.systemd1.Service',name],text=True,timeout=10))
   require(set(typed)=={'type','data'} and typed['type']==('a(sb)' if name=='EnvironmentFiles' else 'a(sasbttttuii)') and typed['data']==[],'Missing property lacks typed empty proof'); rows.append([name,''])
 require(len(rows)==len(names) and set(row[0] for row in rows)==set(names),'Missing typed unit property'); return {k:dependency_value(k,v) for k,v in rows}
marker_names=['MainPID','ExecMainPID','ExecMainCode','ExecMainStatus','ExecMainStartTimestampMonotonic','ExecMainExitTimestampMonotonic','InvocationID','NRestarts','ActiveState','ControlGroup']
execution_names=['ExecCondition','ExecStartPre','ExecStart','ExecStartPost','ExecReload','ExecStop','ExecStopPost']
service_names=execution_names+['WorkingDirectory','User','Group','EnvironmentFiles','Requires','BindsTo','PartOf']
sync_names=marker_names+service_names
def dependency_value(name,value):
 # systemd prints dependency unit sets in hash order, which a daemon-reload can change.
 if name not in ['Requires','BindsTo','PartOf']: return value
 units=value.split(' ') if value else []
 require(all(units) and len(set(units))==len(units),'Ambiguous unit dependency list')
 return ' '.join(sorted(units))
def java_dependencies():
 return {k:dependency_value(k,v) for k,v in (line.split('=',1) for line in config['velocityServiceBinding'].splitlines())}
def facts(value):
 configuration={}; runtime={}
 for name in service_names:
  require(name in value,'Missing configured property')
  if name not in execution_names: configuration[name]=dependency_value(name,value[name]); continue
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
  f=real(m[1]); require(f in config['configurationFiles'] or f in config.get('configurationAbsent',[]),'EnvironmentFile outside approved configuration inventory')
  if not os.path.exists(f) and m[2]=='yes' and f in config.get('configurationAbsent',[]):
   environment.append({'path':f,'ignore_errors':m[2],'absent':True}); rest=rest[m.end():]; continue
  i=identity(f); environment.append({'path':f,'ignore_errors':m[2],'sha256':digest(read(f)),'mode':i[4],'uid':i[2],'gid':i[3]}); rest=rest[m.end():]
 return {'configuration':configuration,'runtime':runtime,'environment':environment}
def configured(unit,value=None):
 value=value or props(unit,service_names); actual=facts(value); expected=r['serviceEvidence'][unit]
 if unit in config['websiteServices']:
  rows=[line.split('=',1) for line in config['serviceBindings'][unit].splitlines()]
  require(all(len(row)==2 for row in rows) and len(rows)==len(service_names) and set(row[0] for row in rows)==set(service_names),'Malformed approved service binding')
  approved_configuration=facts(dict(rows))['configuration']
  if result.get('privateBackupName'):
   require(re.fullmatch('run-'+str(r['runNumber'])+'-[A-Za-z0-9]+',result['privateBackupName']) is not None,'Wrong delivered backup')
   delivered=json.loads(read(config['backupRoot']+'/'+result['privateBackupName']+'/private-seal/deliver-approved-config.json'))
   require(delivered['binding']['revision']==r['revision'] and delivered['binding']['runId']==r['runId'] and delivered['binding']['configSha256']==r['configSha256'],'Private delivered binding drift')
   approved_configuration=facts(delivered['serviceBindings'][unit])['configuration']
  require(actual['configuration']==approved_configuration,'Root-approved service configuration drift')
 require(actual['configuration']==expected['configuration'] and actual['environment']==expected['environment'],'Configured service/environment drift: '+unit)
 return actual
def unknown_execution(record):
 return record['start_time']=='[n/a]' and record['stop_time']=='[n/a]' and record['pid']=='0' and record['code']=='(null)' and record['status'] in ['0','0/0']
def runtime_matches(before,after):
 if set(before)!=set(after): return False
 for name in before:
  if len(before[name])!=len(after[name]): return False
  for old,new in zip(before[name],after[name]):
   same=all(old[k]==new[k] for k in old if k!='status') and (old['status']==new['status'] or old['status'] in ['0','0/0'] and new['status'] in ['0','0/0'])
   if not same and not unknown_execution(new): return False
 return True
def stable_properties(before,after):
 return {k:v for k,v in before.items() if k not in execution_names}=={k:v for k,v in after.items() if k not in execution_names} and facts(before)['configuration']==facts(after)['configuration'] and runtime_matches(facts(before)['runtime'],facts(after)['runtime'])
def process_identity(value):
 pid=value['MainPID']; require(pid.isdigit() and int(pid)>0 and value['ExecMainPID']==pid and int(value['ExecMainStartTimestampMonotonic'])>0,'Main process marker mismatch')
 require(re.fullmatch('[a-f0-9]{32}',value['InvocationID']) is not None and value['ExecMainCode']=='0' and value['ExecMainStatus']=='0','Running invocation/exit marker mismatch')
 base='/proc/'+pid; start=read(base+'/stat').decode().rsplit(')',1)[1].split()[19]; require(start.isdigit() and int(start)>0,'Missing process start')
 command=facts(value)['configuration']['ExecStart'][0]
 require(os.path.realpath(base+'/exe')==os.path.realpath(command['path']) and os.path.realpath(base+'/cwd')==value['WorkingDirectory'],'Process executable/directory drift')
 argv=read(base+'/cmdline').split(b'\0'); require(argv[-1]==b'' and argv[:-1]==[x.encode() for x in command['argv']],'Process argv drift')
 group=value['ControlGroup']; require(group.startswith('/') and group!='/' and '..' not in group.split('/') and '0::'+group in read(base+'/cgroup').decode().splitlines(),'Process service group drift')
 status=dict(line.split(':',1) for line in read(base+'/status').decode().splitlines() if ':' in line)
 user=pwd.getpwnam(value['User'] or 'root'); gid=grp.getgrnam(value['Group']).gr_gid if value['Group'] else user.pw_gid
 require([int(x) for x in status['Uid'].split()]==[user.pw_uid]*4 and [int(x) for x in status['Gid'].split()]==[gid]*4,'Process user/group drift')
 require(read(base+'/stat').decode().rsplit(')',1)[1].split()[19]==start,'Process replaced during observation')
 return {'pid':pid,'processStart':start,'invocationId':value['InvocationID']}
def running(value):
 actual=facts(value); record=actual['runtime']['ExecStart'][0]
 require(value['ActiveState']=='active','ExecStart running phase mismatch')
 known=record['pid']==value['MainPID'] and record['start_time']!='[n/a]' and record['stop_time']=='[n/a]' and record['code']=='(null)' and record['status'] in ['0','0/0']
 require(known or unknown_execution(record),'ExecStart running phase mismatch')
 # Missing command history remains missing; the live kernel identity is required in both cases.
 process_identity(value)
 for name in execution_names:
  if name=='ExecStart': continue
  for configured_command,execution in zip(actual['configuration'][name],actual['runtime'][name]):
   completed=int(execution['pid'])>0 and execution['start_time']!='[n/a]' and execution['stop_time']!='[n/a]' and execution['code']=='exited' and (execution['status'] in ['0','0/0'] or configured_command['ignore_errors']=='yes')
   require(unknown_execution(execution) or completed,'Auxiliary command runtime phase mismatch')
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
  if phase=='stop': require(runtime_matches(r['serviceEvidence'][unit]['runtime'],actual['runtime']),'Website runtime drift since preflight')
  elif unit=='pocketbase' and phase=='cleanup-sync':
   old=result['servicePhases']['stop'][unit]['properties']
   require(value['ExecMainStartTimestampMonotonic']!=old['ExecMainStartTimestampMonotonic'] and value['InvocationID']!=old['InvocationID'] and observed['processStart']!=result['servicePhases']['stop'][unit]['processStart'] and value['NRestarts']==old['NRestarts'],'PocketBase target startup phase drift')
  else:
   previous='cleanup-sync' if phase=='cleanup-java' else 'stop'
   before=result['servicePhases'][previous][unit]; require(observed['processStart']==before['processStart'] and stable_properties(before['properties'],value),'Website runtime/start/group drift')
 result.setdefault('servicePhases',{})[phase]=current
def stopped(value):
 actual=configured('velocity-sync',value); record=actual['runtime']['ExecStart'][0]; old=facts(result['sync'])['runtime']['ExecStart'][0]
 require(value['ActiveState']=='inactive' and value['MainPID']=='0' and value['ExecMainPID']==result['sync']['MainPID'] and value['ExecMainStartTimestampMonotonic']==result['sync']['ExecMainStartTimestampMonotonic'] and value['NRestarts']==result['sync']['NRestarts'],'Stopped sync marker drift')
 require((value['ExecMainCode'],value['ExecMainStatus']) in [('2','9'),('1','0')] and int(value['ExecMainExitTimestampMonotonic'])>=int(value['ExecMainStartTimestampMonotonic']),'Stopped main exit proof missing')
 known=record['pid']==result['sync']['MainPID'] and (unknown_execution(old) or record['start_time']==old['start_time']) and record['stop_time']!='[n/a]' and (record['code'],record['status']) in [('killed','9'),('exited','0'),('exited','0/0')]
 require(known or unknown_execution(record),'ExecStart stopped phase mismatch')
 require(runtime_matches({k:v for k,v in facts(result['sync'])['runtime'].items() if k!='ExecStart'},{k:v for k,v in actual['runtime'].items() if k!='ExecStart'}),'Stopped auxiliary runtime drift')
 require(result.get('killed') and result.get('stopped') and result.get('processes'),'Missing owned stop sequence')
 for pid,start in result['processes']:
  file='/proc/'+str(pid)+'/stat'
  try: current=read(file).decode().rsplit(')',1)[1].split()[19]
  except FileNotFoundError: continue
  require(current!=start,'Stopped process remains alive')
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
 java_facts=configured('velocity'); require(runtime_matches(r['serviceEvidence']['velocity']['runtime'],java_facts['runtime']),'Java command runtime drift')
 require(props('velocity',['Requires','BindsTo','PartOf'])==java_dependencies(),'Java dependency drift')
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
 require(stable_properties(result['sync'],value),'Sync unit/start/group drift'); configured('velocity-sync',value); running(value)
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
# These purposes share the original fixed child, but never accept arbitrary paths,
# ownership, bytes, commands or identities. The config and root-private seal are authority.
private_attempts=[]; private_completed=[]
def private_handler():
 global config
 parent_bindings={}
 def parentfd(file):
  real(file); fd=os.open('/',os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW); current='/'
  try:
   for part in file.strip('/').split('/')[:-1]:
    current=os.path.join(current,part); nextfd=os.open(part,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=fd); os.close(fd); fd=nextfd
    value=os.fstat(fd); binding=[value.st_dev,value.st_ino,value.st_uid,value.st_gid,stat.S_IMODE(value.st_mode)]
    require(identity(current)[:5]==binding,'Private parent descriptor drift')
    if current in parent_bindings: require(parent_bindings[current]==binding,'Private parent inode drift')
    else: parent_bindings[current]=binding
   return fd
  except:
   os.close(fd); raise
 def private_read(file):
  fd=parentfd(file)
  try: leaf=os.open(os.path.basename(file),os.O_RDONLY|os.O_NOFOLLOW,dir_fd=fd)
  finally: os.close(fd)
  try:
   value=os.fstat(leaf); require(stat.S_ISREG(value.st_mode) and value.st_nlink==1,'Private nonregular read')
   with os.fdopen(leaf,'rb',closefd=False) as stream: data=stream.read(134217729)
   require(len(data)<=134217728 and identity(file)==[value.st_dev,value.st_ino,value.st_uid,value.st_gid,stat.S_IMODE(value.st_mode),value.st_nlink],'Private read replaced')
   verify=parentfd(file); os.close(verify); return data
  finally: os.close(leaf)
 allowed={'restore-configuration-ownership':['capability-check','raw','safe'], 'private-configuration':['observe-source','capture-stopped','derive-safe','restore-raw','restore-safe'], 'service-credential-material':['prepare-current-run','deliver-approved-config']}
 require(set(r)=={'operation','purpose','configFile','configIdentity','configSha256','lockIdentity','revision','runNumber','runId','repository','runnerPID','runnerUID','runnerGID','bundle','candidateManifestSha256','velocityEvidence','serviceEvidence','state','backupName','nonce','view'},'Unknown private request field')
 op=r['operation']; purpose=r['purpose']; require(purpose in allowed[op],'Unknown private purpose')
 require(r['view'] in ['source','raw','safe'] and (purpose=='observe-source' or r['view']=='source'),'Unknown private report view')
 require(os.geteuid()==0 and (stat.S_ISFIFO(os.fstat(1).st_mode) or stat.S_ISSOCK(os.fstat(1).st_mode)),'Private child requires root and anonymous output pipe')
 if stat.S_ISSOCK(os.fstat(1).st_mode):
  import socket,struct
  channel=socket.fromfd(1,socket.AF_UNIX,socket.SOCK_STREAM)
  try: peer=struct.unpack('3i',channel.getsockopt(socket.SOL_SOCKET,socket.SO_PEERCRED,12)); require(peer[0]==r['runnerPID'] and peer[1]==r['runnerUID'] and peer[2]==r['runnerGID'],'Wrong anonymous channel peer')
  finally: channel.close()
 require(re.fullmatch('[a-f0-9]{64}',r['nonce']) is not None,'Invalid request nonce')
 config=json.loads(private_read(real(r['configFile'])))
 require(identity(r['configFile'])==r['configIdentity'] and digest(private_read(r['configFile']))==r['configSha256'],'Private config drift')
 caller=pwd.getpwnam(config['runnerUser'])
 require(os.environ.get('SUDO_USER')==config['runnerUser'] and caller.pw_uid==r['runnerUID']!=0 and caller.pw_gid==r['runnerGID'],'Wrong private caller')
 require(identity(r['configFile'])[2:5]==[0,caller.pw_gid,0o640],'Private config owner/mode drift')
 require(digest(private_read('/etc/machine-id'))==config['machineIdSha256'],'Wrong private host')
 require(config['approvedRevision']==r['revision'] and config['repository']==r['repository'] and re.fullmatch('[0-9]+',r['runId']) is not None,'Private Actions drift')
 require(re.fullmatch('[a-f0-9]{40}',r['revision']) is not None and isinstance(r['runNumber'],int) and r['runNumber']>0,'Private revision/run drift')
 process='/proc/'+str(r['runnerPID']); status=dict(x.split(':',1) for x in private_read(process+'/status').decode().splitlines() if ':' in x)
 require([int(x) for x in status['Uid'].split()]==[caller.pw_uid]*4 and [int(x) for x in status['Gid'].split()]==[caller.pw_gid]*4,'Private runner process drift')
 manifest=real(r['bundle']+'/release.json'); require(digest(private_read(manifest))==r['candidateManifestSha256'] and json.loads(private_read(manifest))['revision']==r['revision'],'Private candidate drift')
 envs=['/etc/default/velocity-sync','/etc/default/mcsm-proxy']
 whitelist=config['configurationFiles']; absent=config.get('configurationAbsent')
 require(isinstance(whitelist,list) and len(set(whitelist))==len(whitelist) and absent in [envs,[]] and not any(x in whitelist for x in absent),'Private whitelist/absence drift')
 expected=['/etc/systemd/system/'+u+'.service' for u in config['websiteServices']]+[config['nginxSiteFile']]
 require(whitelist==expected+(envs if not absent else []) and len(expected)==7,'Private source must be complete reviewed seven-file inventory')
 permission=[{'id':'j3o2wd17l18prla','role':'admin'},{'id':'svcvsal7qgvfl12','role':'service'},{'id':'svcmc31eh69zpuo','role':'service'}]
 require(config.get('recoveryIdentities')==permission,'Independent role permission drift')
 roots=[real(config[k]) for k in ['webRoot','stateRoot','backupRoot','velocityRoot']]
 require(all(a!='/' and not(a==b or a.startswith(b+'/') or b.startswith(a+'/')) for i,a in enumerate(roots) for b in roots[i+1:]),'Private overlapping roots')
 def parents(file):
  current='/'
  for part in file.strip('/').split('/')[:-1]:
   current=os.path.join(current,part); i=identity(real(current)); require(stat.S_ISDIR(os.lstat(current).st_mode),'Private parent is not directory')
   require(i[2] in [0,caller.pw_uid] and i[4]&0o022==0,'Writable/foreign private parent')
  return identity(os.path.dirname(file))
 def observed(files,root='/'):
  values=[]; owners=[]
  for file in files:
   relative=file.lstrip('/'); target=root.rstrip('/')+'/'+relative; before=parents(target); data=private_read(target); i=identity(target)
   require(parents(target)==before,'Private parent replaced')
   values.append({'path':relative,'sha256':digest(data),'mode':i[4]}); owners.append({'path':relative,'uid':i[2],'gid':i[3]})
  return {'configuration':values,'ownership':owners}
 def source():
  value=observed(whitelist)
  require(all(not os.path.lexists(x) for x in absent),'Source EnvFile drift')
  require(all(x['uid']==0 and x['gid']==0 for x in value['ownership']) and all(x['mode']==(0o600 if '/'+x['path'] in envs else 0o644) for x in value['configuration']),'Source owner/mode drift')
  value['absent']=absent; return value
 def check_stopped():
  require(props('pocketbase',['ActiveState','MainPID'])=={'ActiveState':'inactive','MainPID':'0'},'PocketBase not stopped')
  require(props('velocity-sync',['ActiveState','MainPID'])=={'ActiveState':'inactive','MainPID':'0'},'Sync not stopped')
 def current():
  require(identity(r['configFile'])==r['configIdentity'] and digest(private_read(r['configFile']))==r['configSha256'],'Private config replaced')
  require(digest(private_read(manifest))==r['candidateManifestSha256'],'Private candidate replaced')
  lock=real(config['stateRoot']+'/deployment.lock'); require(identity(lock)==r['lockIdentity'],'Private lock replaced')
  require(json.loads(private_read(lock))=={'revision':r['revision'],'runNumber':r['runNumber'],'pid':r['runnerPID']},'Private lock/run drift')
  fds=os.listdir(process+'/fd'); require(any(os.path.exists(process+'/fd/'+f) and os.stat(process+'/fd/'+f).st_ino==r['lockIdentity'][1] and os.stat(process+'/fd/'+f).st_dev==r['lockIdentity'][0] for f in fds),'Private caller has no open lock')
  require(private_read(config['webRoot']+'/backend/.velocity-maintenance'),'Missing private maintenance guard')
  require(r['state'] and r['state'].get('stopped') and r['velocityEvidence'] and r['serviceEvidence'],'Missing original stop evidence')
  require(props('velocity', ['MainPID','ExecMainStartTimestampMonotonic','NRestarts','ActiveState'])==dict(line.split('=',1) for line in r['velocityEvidence']['service'].splitlines()),'Private Java runtime drift')
  for entry in r['velocityEvidence']['files']:
   require(digest(private_read(config['velocityRoot']+'/'+entry['path']))==entry['sha256'] and identity(config['velocityRoot']+'/'+entry['path'])[4]==entry['mode'],'Private Java bytes drift')
 def report(v):
  v.update({'nonce':r['nonce'],'purpose':purpose,'rootEUID':0,'runnerUID':caller.pw_uid,'runnerGID':caller.pw_gid,'attempted':list(private_attempts),'completed':list(private_completed)}); return v
 if purpose=='capability-check':
  require(r['lockIdentity'] is None and r['backupName'] is None and r['state'] is None,'Capability check must precede lock')
  value=source(); value['capChown']=bool(int(status.get('CapEff','0').strip(),16)&1); value['rootCapChown']=bool(int(dict(x.split(':',1) for x in private_read('/proc/'+str(os.getpid())+'/status').decode().splitlines() if ':' in x)['CapEff'].strip(),16)&1)
  require(value['rootCapChown'],'Root child lacks CAP_CHOWN'); return report(value)
 if purpose=='observe-source' and r['lockIdentity'] is None:
  require(r['view']=='source','Prelock snapshot read refused'); return report(source())
 current()
 if purpose=='observe-source' and r['view']=='source': return report(source())
 require(isinstance(r['backupName'],str) and re.fullmatch('run-'+str(r['runNumber'])+'-[A-Za-z0-9]+',r['backupName']) is not None,'Invalid derived backup name')
 backup=real(config['backupRoot']+'/'+r['backupName']); bi=identity(backup)
 require(bi[2:5]==[caller.pw_uid,caller.pw_gid,0o700] and stat.S_ISDIR(os.lstat(backup).st_mode),'Private backup parent drift')
 private=backup+'/private-seal'; sealfile=private+'/seal.json'
 binding={'revision':r['revision'],'runNumber':r['runNumber'],'runId':r['runId'],'repository':r['repository'],'backupIdentity':bi[:5],'configSha256':r['configSha256'],'candidateManifestSha256':r['candidateManifestSha256'],'permission':permission}
 def mkdirs(file):
  current=backup
  for part in os.path.relpath(os.path.dirname(file),backup).split('/'):
   require(part not in ('..','.'),'Invalid derived private parent'); current=os.path.join(current,part)
   if not os.path.exists(current):
    directory=parentfd(current)
    try: os.mkdir(os.path.basename(current),0o700,dir_fd=directory)
    finally: os.close(directory)
   expected_owner=[caller.pw_uid,caller.pw_gid,0o700] if current in [backup+'/safe-recovery',backup+'/rehearsal',backup+'/safe-recovery-rehearsal'] else [0,0,0o700]
   require(identity(real(current))[2:5]==expected_owner and stat.S_ISDIR(os.lstat(current).st_mode),'Private subtree ownership drift')
 def write(file,data,mode=0o600,owner=(0,0)):
  private_attempts.append(os.path.relpath(file,backup) if file.startswith(backup+'/') else file); current_binding=parents(file); parent=parentfd(file)
  try: fd=os.open(os.path.basename(file),os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,mode,dir_fd=parent)
  finally: os.close(parent)
  try:
   require(parents(file)==current_binding,'Private write parent replaced'); require(os.write(fd,data)==len(data),'Short private write'); os.fsync(fd); os.fchmod(fd,mode); os.fchown(fd,*owner)
   require(os.fstat(fd).st_nlink==1 and identity(file)[1]==os.fstat(fd).st_ino,'Private write replaced')
  finally: os.close(fd)
  private_completed.append(os.path.relpath(file,backup) if file.startswith(backup+'/') else file)
 def save_seal(seal):
  # Each step seals a distinct immutable receipt, never rewrites prior permission.
  file=private+'/'+purpose+'.json'; require(not os.path.lexists(file),'Private purpose already attempted'); write(file,json.dumps(seal,separators=(',',':')).encode())
 if purpose=='capture-stopped':
  check_stopped(); raw=source(); require(not os.path.lexists(private) and not os.path.lexists(backup+'/configuration'),'Existing private capture')
  os.mkdir(private,0o700)
  for file,item,owner in zip(whitelist,raw['configuration'],raw['ownership']):
   current(); check_stopped(); dest=backup+'/configuration/'+file.lstrip('/'); mkdirs(dest); data=private_read(file); require(digest(data)==item['sha256'],'Capture source drift'); write(dest,data,item['mode'],(owner['uid'],owner['gid']))
  require(source()==raw and observed(whitelist,backup+'/configuration')=={k:raw[k] for k in ['configuration','ownership']},'Capture postreadback drift')
  seal={'binding':binding,'raw':raw}; write(sealfile,json.dumps(seal,separators=(',',':')).encode()); save_seal(seal); return report(raw)
 require(identity(real(private))[2:5]==[0,0,0o700] and identity(sealfile)[2:5]==[0,0,0o600],'Unsafe independent private seal')
 seal=json.loads(private_read(sealfile)); require(seal['binding']==binding,'Independent private binding drift')
 raw=seal['raw']; require(observed(whitelist,backup+'/configuration')=={k:raw[k] for k in ['configuration','ownership']},'Raw private seal drift')
 if purpose=='observe-source' and r['view']=='raw': return report(raw)
 materialfile=private+'/credentials'
 def material():
  require(identity(materialfile)[2:5]==[0,0,0o600],'Private credential mode drift'); values=private_read(materialfile).decode().splitlines()
  require(len(values)==2 and values[0]!=values[1] and all(re.fullmatch('[a-f0-9]{64}',x) for x in values),'Invalid current material'); return values
 if purpose=='prepare-current-run':
  check_stopped(); raw_manifest=json.loads(private_read(backup+'/backup.json'))
  require(raw_manifest['configuration']==raw['configuration'] and raw_manifest['ownership']==raw['ownership'] and raw_manifest['configurationAbsent']==raw['absent'],'Raw parent seal mismatch')
  # Bind stopped application bytes before exposing current-run material.
  app=backup+'/application'
  require(isinstance(raw_manifest.get('application'),list) and len(raw_manifest['application'])<=20000,'Missing raw application closure')
  for item in raw_manifest['application']:
   name=item['path']; require(isinstance(name,str) and not name.startswith('/') and all(x not in ['','..','.'] for x in name.split('/')) and '\\' not in name,'Unsafe raw material source')
   target=app+'/'+name; require(os.path.realpath(target).startswith(app+'/'),'Raw material source escape')
   if item.get('directory'): require(stat.S_ISDIR(os.lstat(target).st_mode) and identity(target)[4]==item['mode'],'Raw source directory drift')
   elif 'link' in item: require(os.path.islink(app+'/'+name) and os.readlink(app+'/'+name)==item['link'],'Raw source link drift')
   else: require(digest(private_read(target))==item['sha256'] and identity(target)[4]==item['mode'],'Raw source bytes drift')
  import sqlite3
  wal=backup+'/application/backend/pb_data/data.db-wal'; require(not os.path.exists(wal) or os.stat(wal).st_size==0,'Uncheckpointed stopped identity source')
  database=sqlite3.connect('file:'+backup+'/application/backend/pb_data/data.db?mode=ro&immutable=1',uri=True)
  require(database.execute('select verified from users where id=?',(permission[0]['id'],)).fetchone()==(1,),'Unverified raw human')
  for entry,email in zip(permission[1:],['velocity-sync@services.hololive.com.cn','mcsm-proxy@services.hololive.com.cn']):
   rows=database.execute('select id,email from users where id=? or email=?',(entry['id'],email)).fetchall()
   require(rows==[] if absent else rows==[(entry['id'],email)],'Raw service collision')
   if not absent: require(database.execute('select is_admin,service_account from users where id=?',(entry['id'],)).fetchone()==(1,1),'Existing raw service role drift')
  database.close()
  if not os.path.exists(materialfile):
   if absent: values=[os.urandom(32).hex(),os.urandom(32).hex()]
   else:
    values=[]
    for file,email in zip(envs,['velocity-sync@services.hololive.com.cn','mcsm-proxy@services.hololive.com.cn']):
     content=private_read(backup+'/configuration/'+file.lstrip('/')).decode(); match=re.fullmatch('PB_EMAIL='+re.escape(email)+r'\nPB_PASS=([a-f0-9]{64})\n',content); require(match,'Existing private credential contract drift'); values.append(match[1])
   write(materialfile,('\n'.join(values)+'\n').encode())
  values=material(); value={'binding':binding,'snapshotId':raw_manifest['snapshotId'],'materialSha256':digest(private_read(materialfile)),'rawManifestSha256':digest(private_read(backup+'/backup.json'))}; save_seal(value)
  sys.stderr.write(json.dumps(report(value))); sys.stdout.write('\n'.join(values)+'\n'); return None
 prepared=json.loads(private_read(private+'/prepare-current-run.json')); require(prepared['binding']==binding and prepared['materialSha256']==digest(private_read(materialfile)) and prepared['rawManifestSha256']==digest(private_read(backup+'/backup.json')),'Prepared permission/material drift')
 values=material()
 def envbytes(index): return ('PB_EMAIL='+['velocity-sync@services.hololive.com.cn','mcsm-proxy@services.hololive.com.cn'][index]+'\nPB_PASS='+values[index]+'\n').encode()
 def unitbytes(unit):
  file='/etc/systemd/system/'+unit+'.service'; data=private_read(backup+'/configuration/'+file.lstrip('/')); lines=data.splitlines(keepends=True); directive=b'EnvironmentFile=-/etc/default/'+unit.encode()
  require(unit in ['velocity-sync','mcsm-proxy'],'Wrong credential unit')
  service=[]; credentials=[]; matches=[]; section=None
  for index,line in enumerate(lines):
   body=line.removesuffix(b'\n').removesuffix(b'\r'); stripped=body.strip()
   if not stripped or stripped.startswith((b'#',b';')): continue
   if b'[Service]' in body:
    require(body==b'[Service]' and not (index and lines[index-1].rstrip(b'\r\n').endswith(b'\\')),'Ambiguous unit service section'); service.append(index)
   if stripped.startswith(b'['): section=body
   if re.match(rb'EnvironmentFile\b',stripped):
    require(body==directive and section==b'[Service]' and not (index and lines[index-1].rstrip(b'\r\n').endswith(b'\\')),'Conflicting EnvironmentFile'); matches.append(index)
   if re.search(rb'PB_(?:EMAIL|PASS|TOKEN)\b',body):
    match=re.fullmatch(rb'Environment=(PB_EMAIL|PB_PASS)=([^\s\x00-\x1f\x7f\x22\x27\\]+)',body)
    require(unit=='velocity-sync' and section==b'[Service]' and match and not (index and lines[index-1].rstrip(b'\r\n').endswith(b'\\')),'Inline service credential'); credentials.append((index,match[1]))
  require(len(service)==1,'Ambiguous unit service section')
  require(len(matches)<=1,'Conflicting EnvironmentFile')
  require(not credentials or (len(credentials)==2 and {name for _,name in credentials}=={b'PB_EMAIL',b'PB_PASS'} and not matches),'Inline service credential')
  removed={index for index,_ in credentials}; output=[]
  for index,line in enumerate(lines):
   if index in removed: continue
   output.append(line)
   if index==service[0] and not matches:
    ending=b'\r\n' if line.endswith(b'\r\n') else b'\n'
    if not line.endswith(b'\n'): output.append(ending)
    output.append(directive+ending)
  return b''.join(output)
 safeconfig=backup+'/safe-recovery/configuration'; expectedfile=private+'/derive-safe.json'
 if purpose=='derive-safe':
  check_stopped(); require(not os.path.lexists(safeconfig),'Existing private safe configuration')
  unit_values={u:unitbytes(u) for u in ['velocity-sync','mcsm-proxy']}
  for file,item,owner in zip(whitelist,raw['configuration'],raw['ownership']):
   data=unit_values[file.split('/')[-1][:-8]] if file in ['/etc/systemd/system/velocity-sync.service','/etc/systemd/system/mcsm-proxy.service'] else private_read(backup+'/configuration/'+file.lstrip('/'))
   dest=safeconfig+'/'+file.lstrip('/'); mkdirs(dest); write(dest,data,item['mode'],(owner['uid'],owner['gid']))
  for index,file in enumerate(envs):
   if file in whitelist: continue
   dest=safeconfig+'/'+file.lstrip('/'); mkdirs(dest); write(dest,envbytes(index))
  expected=observed(list(dict.fromkeys(whitelist+envs)),safeconfig); expected['absent']=[]
  save_seal({'binding':binding,'expected':expected,'snapshotId':prepared['snapshotId'],'materialSha256':prepared['materialSha256']}); return report(expected)
 safe=purpose in ['restore-safe','safe','deliver-approved-config'] or (purpose=='observe-source' and r['view']=='safe')
 expected=json.loads(private_read(expectedfile)) if safe else None
 if safe:
  require(expected['binding']==binding and expected['snapshotId']==prepared['snapshotId'] and expected['materialSha256']==prepared['materialSha256'],'Independent safe permission drift')
  require(observed(list(dict.fromkeys(whitelist+envs)),safeconfig)=={k:expected['expected'][k] for k in ['configuration','ownership']},'Safe private bytes drift')
 wanted=expected['expected'] if safe else raw; files=list(dict.fromkeys(whitelist+envs)) if safe else whitelist
 if purpose=='observe-source' and r['view']=='safe': return report(wanted)
 if purpose.startswith('restore-') or purpose in ['raw','safe']:
  check_stopped(); destination=backup+('/safe-recovery-rehearsal' if safe else '/rehearsal')+'/isolated-configuration'; source_root=safeconfig if safe else backup+'/configuration'
  require(stat.S_ISDIR(os.lstat(os.path.dirname(destination)).st_mode) and identity(os.path.dirname(destination))[2:5]==[caller.pw_uid,caller.pw_gid,0o700],'Wrong isolated parent')
  if purpose.startswith('restore-'):
   require(not os.path.lexists(destination),'Existing isolated private destination')
   for file,item in zip(files,wanted['configuration']):
    current(); dest=destination+'/'+file.lstrip('/'); mkdirs(dest); write(dest,private_read(source_root+'/'+file.lstrip('/')),item['mode'])
   copied=observed(files,destination); save_seal({'binding':binding,'destinationIdentity':identity(destination),'copied':copied}); return report({'configuration':copied['configuration'],'ownership':wanted['ownership']})
  copied=json.loads(private_read(private+'/restore-'+purpose+'.json')); require(copied['binding']==binding and copied['destinationIdentity']==identity(destination),'Isolated parent/inode drift')
  require(observed(files,destination)==copied['copied'],'Isolated preowner bytes drift')
  for file,owner in zip(files,wanted['ownership']):
   current(); target=destination+'/'+file.lstrip('/'); parent=parents(target); directory=parentfd(target)
   try: fd=os.open(os.path.basename(target),os.O_RDONLY|os.O_NOFOLLOW,dir_fd=directory)
   finally: os.close(directory)
   try:
    require(parents(target)==parent and os.fstat(fd).st_nlink==1,'Isolated owner endpoint drift'); os.fchown(fd,owner['uid'],owner['gid'])
   finally: os.close(fd)
  post=observed(files,destination); require(post=={k:wanted[k] for k in ['configuration','ownership']},'Actual ownership postreadback drift'); save_seal({'binding':binding,'post':post}); return report(wanted)
 require(purpose=='deliver-approved-config','Unknown private application')
 check_stopped()
 require(source()==raw,'Private install source drift')
 # Validate both complete unit deltas and all bindings before first live write.
 unit_values={u:unitbytes(u) for u in ['velocity-sync','mcsm-proxy']}
 original={u:props(u,service_names) for u in config['websiteServices']}
 for u,value in original.items():
  require(facts(value)['configuration']==facts(dict(line.split('=',1) for line in config['serviceBindings'][u].splitlines()))['configuration'],'Private delivery service drift')
 for index,file in enumerate(envs):
  current()
  if file in absent: write(file,envbytes(index))
  else: require(private_read(file)==envbytes(index),'Existing approved credential drift')
 changed=False
 for unit,data in unit_values.items():
  file='/etc/systemd/system/'+unit+'.service'; old=private_read(file)
  if old!=data:
   current(); parent=parents(file); directory=parentfd(file)
   try: fd=os.open(os.path.basename(file),os.O_WRONLY|os.O_NOFOLLOW,dir_fd=directory)
   finally: os.close(directory)
   try:
    require(parents(file)==parent and digest(old)==next(x['sha256'] for x in raw['configuration'] if x['path']==file.lstrip('/')),'Unit delta source drift'); os.ftruncate(fd,0); require(os.write(fd,data)==len(data),'Short approved unit write'); os.fsync(fd)
   finally: os.close(fd)
   changed=True
 if changed: ctl(['daemon-reload'])
 for unit,before in original.items():
  after=props(unit,service_names); target=dict(before)
  if unit in unit_values: target['EnvironmentFiles']='/etc/default/'+unit+' (ignore_errors=yes)'
  require(stable_properties(target,after),'Unexpected delivered service property drift')
 post=observed(list(dict.fromkeys(whitelist+envs))); require(post=={k:wanted[k] for k in ['configuration','ownership']},'Live private delivery postreadback drift')
 save_seal({'binding':binding,'post':post,'serviceBindings':{u:props(u,service_names) for u in config['websiteServices']}}); return report(dict(wanted,serviceBindings={u:props(u,service_names) for u in config['websiteServices']}))
if r.get('operation') in ['restore-configuration-ownership','private-configuration','service-credential-material']:
 try:
  response=private_handler()
  if response is not None: print(json.dumps(dict(response,ok=True)))
 except Exception:
  # Neither SQLite errors nor request/secret values are exposed.
  print(json.dumps({'ok':False,'reason':'Bounded private configuration operation refused','purpose':r.get('purpose'),'nonce':r.get('nonce'),'rootEUID':os.geteuid(),'attempted':private_attempts,'completed':private_completed}))
 sys.exit(0)
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
  require(runtime_matches(r['serviceEvidence']['velocity-sync']['runtime'],facts(result['sync'])['runtime']),'Sync runtime drift since preflight')
  require(result['java']['ControlGroup']!=result['sync']['ControlGroup'],'Shared Java/sync group')
  group=group_path(result['sync']['ControlGroup']); jgroup=group_path(result['java']['ControlGroup'])
  require(not(group.startswith(jgroup+'/') or jgroup.startswith(group+'/')),'Nested Java/sync group')
  result['groupIdentity']=identity(group)
  require(not frozen(group),'Sync already frozen')
  result['files']=[[n,identity(real(config['velocityRoot']+'/'+n)),digest(read(config['velocityRoot']+'/'+n)),file_flags(config['velocityRoot']+'/'+n)] for n in config['protectedVelocityFiles']]
  require(all(any(f[0]==entry['path'] and f[2]==entry.get('sha256') and f[1][4]==entry.get('mode') for f in result['files']) for entry in r['velocityEvidence']['files']),'Java files drift since outer pre-stop baseline')
  java(); result['processes']=process_binding(group); result['originalProperties']=effective()
  require(props('velocity',['Requires','BindsTo','PartOf'])==java_dependencies(),'Java dependency drift')
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
   stopped(current_sync); require(stable_properties(result['stoppedSync'],current_sync),'Stopped cleanup phase drift')
  if r['operation']=='cleanup-java':
   old_sync=result['sync']; running(current_sync)
   require(runtime_matches({name:facts(old_sync)['runtime'][name] for name in ['ExecReload','ExecStop','ExecStopPost']},{name:facts(current_sync)['runtime'][name] for name in ['ExecReload','ExecStop','ExecStopPost']}),'Unexpected new-sync command execution')
   result['newSync']=current_sync; result['sync']=current_sync
   require(result['sync']['ExecMainStartTimestampMonotonic']!=old_sync['ExecMainStartTimestampMonotonic'] and result['sync']['NRestarts']==old_sync['NRestarts'],'New sync start/restart marker drift')
   require(result['sync']['InvocationID']!=old_sync['InvocationID'],'New sync invocation drift')
   new_group=group_path(result['sync']['ControlGroup']); java_group=group_path(result['java']['ControlGroup'])
   require(new_group!=java_group and not(new_group.startswith(java_group+'/') or java_group.startswith(new_group+'/')),'New sync shares Java group')
   require(process_binding(new_group,digest(candidate))!=result['processes'],'New sync kernel start drift')
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
  const privateBridge = config.configurationAbsent !== undefined;
  let credentialMaterial, humanTargetToken, suppliedProof;
  const firstCapture = config.baseline?.capture === 'stopped-backup';
  const captureDescriptor = firstCapture ? JSON.stringify(config.baseline) : null;
  const captureBinding = directory => ({ revision, runNumber, runId: process.env.GITHUB_RUN_ID, repository: process.env.GITHUB_REPOSITORY, snapshotDirectory: directory });
  const assertCaptured = backup => {
    if (firstCapture) check(backup === backupPath, 'Capture snapshot directory mismatch');
    if (firstCapture) check(captured && config.approvedRevision === revision && config.repository === process.env.GITHUB_REPOSITORY && JSON.stringify(config.baseline) === captureDescriptor && JSON.stringify(effectiveBaseline.captureBinding) === JSON.stringify(captureBinding(backup)), 'Capture candidate/run binding mismatch');
    return verifySnapshot(backup, effectiveBaseline, privateBridge ? privateIO : undefined);
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
    configuration: privateBridge ? privateOperation('private-configuration', 'observe-source').configuration.map(item => { const owner = privateOperationOwners.find(x => x.path === item.path); return { path: '/' + item.path, sha256: item.sha256, mode: item.mode, uid: owner.uid, gid: owner.gid }; }) : config.configurationFiles.map(file => { const stat = fs.lstatSync(file); check(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1, 'Unsafe declared configuration'); return { path: file, sha256: sha(fs.readFileSync(file)), mode: stat.mode & 0o777, uid: stat.uid, gid: stat.gid }; }),
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
  let privateOperationOwners = [];
  const privateOperation = (operation, purpose, view = 'source') => {
    check(configIdentity && configSha256 && config.configurationAbsent, 'Missing private capability binding');
    verifyBundle(bundle, revision);
    const runner = os.userInfo(), opened = lockFd === undefined ? null : fs.fstatSync(lockFd);
    const request = { operation, purpose, view, configFile, configIdentity, configSha256, lockIdentity: opened ? [opened.dev, opened.ino, opened.uid, opened.gid, opened.mode & 0o7777, opened.nlink] : null, revision, runNumber, runId: process.env.GITHUB_RUN_ID, repository: process.env.GITHUB_REPOSITORY, runnerPID: process.pid, runnerUID: runner.uid, runnerGID: runner.gid, bundle, candidateManifestSha256: sha(fs.readFileSync(path.join(bundle, 'release.json'))), velocityEvidence: velocityBaseline ?? null, serviceEvidence: serviceEvidence ?? null, state: maintenance, backupName: backupPath ? path.basename(backupPath) : null, nonce: randomBytes(32).toString('hex') };
    if (maintenance) (maintenance.privateAttempts ??= []).push({ operation, purpose, nonce: request.nonce, status: 'attempted' });
    const result = spawnSync('sudo', ['-n', '/usr/bin/python3', '-I', '-c', finiteRootSource], { input: JSON.stringify(request), encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 60000, maxBuffer: 1048576 });
    let report;
    try { report = JSON.parse(purpose === 'prepare-current-run' ? result.stderr : result.stdout); } catch { check(false, 'Private child result unavailable'); }
    if (maintenance) Object.assign(maintenance.privateAttempts.at(-1), { status: report.ok === false ? 'refused' : 'completed', attempted: report.attempted ?? [], completed: report.completed ?? [], postcondition: report.configuration ?? null });
    check(!result.error && result.status === 0 && report.ok !== false && report.rootEUID === 0 && report.nonce === request.nonce && report.purpose === purpose && report.runnerUID === runner.uid && report.runnerGID === runner.gid, 'Private child binding refused');
    if (purpose === 'prepare-current-run') {
      const values = result.stdout.trim().split('\n');
      check(values.length === 2 && values[0] !== values[1] && values.every(x => /^[a-f0-9]{64}$/.test(x)), 'Private material channel refused');
      credentialMaterial = { svcvsal7qgvfl12: values[0], svcmc31eh69zpuo: values[1] };
    }
    privateOperationOwners = report.ownership ?? privateOperationOwners;
    return report;
  };
  const privateIO = (purpose, directory) => {
    check(directory === backupPath || directory === path.join(backupPath, 'safe-recovery'), 'Unbound private configuration context');
    const actual = purpose === 'inspect' ? 'observe-source' : purpose;
    return privateOperation(['raw', 'safe'].includes(actual) ? 'restore-configuration-ownership' : 'private-configuration', actual, purpose === 'inspect' ? (directory === backupPath ? 'raw' : 'safe') : 'source');
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
    if (privateBridge) {
      check(suppliedProof?.directory === config.webRoot && suppliedProof.revision === revision && suppliedProof.runId === process.env.GITHUB_RUN_ID && humanTargetToken && credentialMaterial, 'Missing same-target identity supply');
      const base = new URL(config.pocketbaseHealthUrl).origin;
      for (const [index, item] of identities.entries()) {
        let token = humanTargetToken, record;
        if (item.role === 'service') {
          const email = index === 1 ? 'velocity-sync@services.hololive.com.cn' : 'mcsm-proxy@services.hololive.com.cn';
          const auth = await fetch(base + '/api/collections/users/auth-with-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identity: email, password: credentialMaterial[item.id] }), signal: AbortSignal.timeout(3000) });
          const data = await auth.json(); check(auth.ok && typeof data.token === 'string', 'Target service authentication failed');
          const refresh = await fetch(base + '/api/collections/users/auth-refresh', { method: 'POST', headers: { Authorization: data.token }, signal: AbortSignal.timeout(3000) });
          const refreshed = await refresh.json(); check(refresh.ok && refreshed.record?.id === item.id && typeof refreshed.token === 'string', 'Target service refresh failed'); token = refreshed.token;
        }
        const self = await fetch(base + '/api/collections/users/records/' + item.id, { headers: { Authorization: token }, signal: AbortSignal.timeout(3000) }); record = await self.json();
        check(self.ok && record.id === item.id && record.collectionName === 'users' && record.is_admin === true && record.service_account === (item.role === 'service') && (item.role === 'service' || (record.verified === true && record.collectionId === suppliedProof.collectionId)), 'Target users self proof failed');
        for (const collection of ['velocity_settings', 'mcsm_config']) { const response = await fetch(base + '/api/collections/' + collection + '/records', { headers: { Authorization: token }, signal: AbortSignal.timeout(3000) }); check(response.ok && Array.isArray((await response.json()).items), 'Target protected identity read failed'); }
      }
      return;
    }
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
  const migrateCopy = directory => {
    const args = ['--dir', path.join(directory, 'backend/pb_data'), '--migrationsDir', path.join(bundle, 'backend/pb_migrations'), '--hooksDir', path.join(bundle, 'backend/pb_hooks')];
    const output = command(pb, ['migrate', 'up', ...args]);
    check(!/Failed|Error:/i.test(output), 'Candidate migration failed before identity supply');
    if (privateBridge) {
      check(credentialMaterial && backupPath, 'Missing stopped current-run identity material');
      const permission = config.recoveryIdentities, raw = json(path.join(backupPath, 'backup.json'));
      const input = { revision, runId: process.env.GITHUB_RUN_ID, snapshotId: raw.snapshotId, permissionSha256: sha(JSON.stringify(permission)), permission, credentials: credentialMaterial, nonce: randomBytes(32).toString('hex') };
      const supplied = spawnSync(pb, ['deployment-identity-supply', ...args], { env: { ...process.env, PB_DEPLOYMENT_IDENTITY_INPUT: JSON.stringify(input) }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000, maxBuffer: 65536 });
      check(!supplied.error && supplied.status === 0, 'Offline identity supply failed');
      const proof = decodeIdentitySupply(supplied.stdout, { nonce: input.nonce, revision, runId: input.runId, humanId: permission[0].id });
      if (directory === config.webRoot) { humanTargetToken = proof.token; suppliedProof = { directory, revision, runId: input.runId, humanId: proof.humanId, collectionId: proof.collectionId }; }
    }
    return output;
  };
  return {
    verify: () => {
      assertRunState(controlRead(state, boundControl));
      if (!privateBridge) for (const file of config.configurationFiles) {
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
      if (!privateBridge) preflightSources = sourceBindings();
      for (const endpoint of [state, guard, lock]) boundControl(endpoint);
      check(process.env.GITHUB_REPOSITORY === config.repository && /^[0-9]+$/.test(process.env.GITHUB_RUN_ID ?? '') && ['push', 'workflow_dispatch'].includes(process.env.GITHUB_EVENT_NAME), 'Missing actual Actions run/repository binding');
      assertRealPath(configFile);
      const configStat = fs.statSync(configFile);
      check(fs.lstatSync(configFile).isFile() && configStat.nlink === 1, 'Invalid production config endpoint');
      configIdentity = [configStat.dev, configStat.ino, configStat.uid, configStat.gid, configStat.mode & 0o7777, configStat.nlink];
      configSha256 = sha(fs.readFileSync(configFile));
      check(configStat.uid === 0 && (configStat.mode & 0o022) === 0, 'Production config must be root-owned and not group/world writable');
      if (privateBridge) { privateOperation('restore-configuration-ownership', 'capability-check'); preflightSources = sourceBindings(); }
      for (const root of [config.webRoot, config.backupRoot, config.stateRoot, config.velocityRoot]) assertRealPath(root);
      for (const root of [config.backupRoot, config.stateRoot]) check((fs.statSync(root).mode & 0o077) === 0, 'Private backup/state directory permissions required');
      for (const relative of artifactPaths) { const dest = path.join(config.webRoot, relative); if (fs.existsSync(dest)) assertRealPath(dest); }
      assertRealPath(path.join(config.webRoot, 'backend/pb_data'));
      check(sha(fs.readFileSync('/etc/machine-id')) === config.machineIdSha256 && os.userInfo().username === config.runnerUser, 'Wrong physical host or runner user');
      check(command(pb, ['--version']) === 'pocketbase version ' + config.pocketbaseVersion, 'Wrong PocketBase version');
      check(dependencyLines(command('systemctl', ['show', 'velocity', '-p', 'Requires', '-p', 'BindsTo', '-p', 'PartOf'])) === dependencyLines(config.velocityServiceBinding), 'Java reverse service dependency drift');
      for (const unit of config.websiteServices) {
        check(command('systemctl', ['is-active', unit]) === 'active', 'Required service not active: ' + unit);
        const facts = serviceFacts(showService(unit)), approved = serviceFacts(config.serviceBindings[unit]);
        check(JSON.stringify(facts.configuration) === JSON.stringify(approved.configuration), 'Service binding drift: ' + unit);
        serviceEvidence ??= {};
        serviceEvidence[unit] = { configuration: facts.configuration, runtime: facts.runtime, environment: privateBridge ? facts.environment.map(item => { const source = preflightSources.configuration.find(x => x.path === item.path); return source ? { ...item, ...Object.fromEntries(Object.entries(source).filter(([key]) => key !== 'path')) } : { ...item, absent: true }; }) : serviceEnvironment(facts, config) };
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
      const privateCapture = privateBridge ? privateOperation('private-configuration', 'capture-stopped') : null;
      if (!privateBridge) copyPaths('/', path.join(backupPath, 'configuration'), config.configurationFiles.map(file => file.slice(1)));
      const contract = checkDatabases(path.join(backupPath, 'application/backend/pb_data'));
      const configuration = privateCapture?.configuration ?? inventory(path.join(backupPath, 'configuration'), config.configurationFiles.map(file => file.slice(1)));
      const ownership = privateCapture?.ownership ?? config.configurationFiles.map(file => { const stat = fs.statSync(file); return { path: file.slice(1), uid: stat.uid, gid: stat.gid }; });
      assertSources();
      if (preflightSources) check(JSON.stringify(fs.existsSync(path.join(backupPath, 'application/backend/pb_migrations')) ? inventory(path.join(backupPath, 'application'), ['backend/pb_migrations']) : []) === JSON.stringify(preflightSources.migrations), 'Migration capture drift');
      check(JSON.stringify(configuration) === JSON.stringify(privateBridge ? privateIO('inspect', backupPath).configuration : inventory(path.join(backupPath, 'configuration'), config.configurationFiles.map(file => file.slice(1)))), 'Configuration capture drift');
      if (!privateBridge) for (const item of preflightSources?.configuration ?? []) { const copied = path.join(backupPath, 'configuration', item.path.slice(1)), stat = fs.statSync(copied); check(sha(fs.readFileSync(copied)) === item.sha256 && (stat.mode & 0o777) === item.mode, 'Configuration capture ownership/content drift'); }
      if (preflightSources) check(JSON.stringify(ownership) === JSON.stringify(preflightSources.configuration.map(item => ({ path: item.path.slice(1), uid: item.uid, gid: item.gid }))), 'Configuration source ownership drift');
      const value = { revision: config.baseline?.kind === 'mixed' ? null : oldState?.revision ?? config.previousRevision, ...snapshot, configuration, ownership, ...(privateCapture ? { configurationAbsent: privateCapture.absent } : {}), contract, retainedHistory: config.baseline?.retainedHistory ?? [], sourceAbsentHistory: config.baseline?.sourceAbsentHistory ?? [] };
      if (firstCapture) {
        verifyMixedHistory(bundle, path.join(backupPath, 'application'), config.baseline, contract['data.db'].migrations);
        check(JSON.stringify(contract['data.db'].migrations) === JSON.stringify(onlineLedger), 'Applied history changed since preflight');
        value.captureBinding = captureBinding(backupPath);
      }
      value.snapshotId = snapshotIdentity(value);
      writeJSON(path.join(backupPath, 'backup.json'), value);
      if (firstCapture) { effectiveBaseline = { ...config.baseline, snapshotId: value.snapshotId, snapshotDirectory: backupPath, captureBinding: value.captureBinding }; captured = true; }
      if (config.baseline?.kind === 'mixed') assertCaptured(backupPath);
      if (privateBridge) privateOperation('service-credential-material', 'prepare-current-run');
      return backupPath;
    },
    rehearse: backup => {
      const manifest = json(path.join(backup, 'backup.json'));
      if (manifest.snapshotId) assertCaptured(backup);
      check(JSON.stringify(inventory(path.join(backup, 'application'), manifest.present)) === JSON.stringify(manifest.application), 'Backup digest mismatch');
      checkDatabases(path.join(backup, 'application/backend/pb_data'));
      const isolated = path.join(backup, 'rehearsal');
      restoreBackup(backup, isolated, privateBridge ? privateIO : undefined);
      check(JSON.stringify(inventory(isolated, manifest.present)) === JSON.stringify(manifest.application), 'Restore rehearsal differs from snapshot');
      checkDatabases(path.join(isolated, 'backend/pb_data'));
      const migrationLog = migrateCopy(isolated);
      check(!/Failed|Error:/i.test(migrationLog), 'Isolated migration failed');
      fs.writeFileSync(path.join(backup, 'isolated-migration.log'), migrationLog, { mode: 0o600 });
      writeJSON(path.join(backup, 'isolated-migrated-contract.json'), checkDatabases(path.join(isolated, 'backend/pb_data')));
      // A migration rehearsal never promotes raw permissive data to safe recovery.
      // The approved identities must already exist in the derived database.
      const safe = createSafeRecovery(backup, config.recoveryWorkingCopy ?? isolated, bundle, revision, config.recoveryIdentities, isolated, privateBridge ? privateIO : undefined);
      restoreSafeRecovery(safe, path.join(backup, 'safe-recovery-rehearsal'), revision, privateBridge ? privateIO : undefined);
    },
    baseline: backup => { assertCaptured(backup); writeJSON(path.join(backup, 'before-contract.json'), checkDatabases(path.join(backup, 'application/backend/pb_data'))); },
    install: () => { assertSources(); verifyInstallTargets(config.webRoot, config.configurationFiles); assertCaptured(backupPath); installBundle(bundle, config.webRoot, revision, effectiveBaseline, backupPath, privateBridge ? privateIO : undefined);
      if (privateBridge) {
        const delivery = privateOperation('service-credential-material', 'deliver-approved-config');
        maintenance.privateBackupName = path.basename(backupPath);
        for (const unit of ['velocity-sync', 'mcsm-proxy']) {
          const env = delivery.serviceBindings[unit].EnvironmentFiles;
          if (unit === 'velocity-sync') { maintenance.stoppedSync.EnvironmentFiles = env; maintenance.sync.EnvironmentFiles = env; }
          for (const phase of Object.values(maintenance.servicePhases ?? {})) if (phase[unit]?.properties) phase[unit].properties.EnvironmentFiles = env;
        }
        for (const unit of config.websiteServices) { const facts = serviceFacts(Object.entries(delivery.serviceBindings[unit]).map(([k,v]) => k + '=' + v).join('\n')); serviceEvidence[unit].configuration = facts.configuration; serviceEvidence[unit].environment = facts.environment.map(item => { const entry = delivery.configuration.find(x => '/' + x.path === item.path), owner = delivery.ownership.find(x => x.path === entry?.path); check(entry && owner, 'Missing delivered environment report'); return { ...item, sha256: entry.sha256, mode: entry.mode, uid: owner.uid, gid: owner.gid }; }); }
      }
      installed = true; },
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
      humanTargetToken = undefined; credentialMaterial = undefined;
      writeControl(state, JSON.stringify({ ...value, baseline: backupManifest?.snapshotId ?? null, candidateManifest: verifyBundle(bundle, revision), retainedHistory: config.baseline?.retainedHistory ?? [], runId: process.env.GITHUB_RUN_ID, runUrl: `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`, trigger: process.env.GITHUB_EVENT_NAME, completedAt: new Date().toISOString() }) + '\n');
    },
    failure: value => { humanTargetToken = undefined; credentialMaterial = undefined; writeControl(state, JSON.stringify({ ...value, backup: backupPath ?? value.backup, runNumber, failedAt: new Date().toISOString() }) + '\n'); },
  };
}

function assertRecoverableOwners(owners) {
  const uid = process.geteuid(), groups = new Set([process.getegid(), ...process.getgroups()]);
  for (const owner of owners) {
    check(Number.isSafeInteger(owner.uid) && owner.uid >= 0 && owner.uid < 4294967295 && Number.isSafeInteger(owner.gid) && owner.gid >= 0 && owner.gid < 4294967295, 'Invalid configuration ownership metadata');
    check(uid === 0 || (owner.uid === uid && groups.has(owner.gid)), 'Configuration ownership cannot be reconstructed by actual runner');
  }
}

export function restoreBackup(backup, destination, privateIO) {
  // Always isolated; never silently restores a running production directory.
  check(!fs.existsSync(destination), 'Restore destination must be new');
  const manifest = json(path.join(backup, 'backup.json'));
  check(manifest.present.every(name => [...artifactPaths, 'backend/pb_data', 'backend/pocketbase'].includes(name)), 'Backup whitelist mismatch');
  check(JSON.stringify(inventory(path.join(backup, 'application'), manifest.present)) === JSON.stringify(manifest.application), 'Corrupt backup');
  if (manifest.snapshotId) verifySnapshot(backup, undefined, privateIO);
  if (manifest.configuration) {
    const names = manifest.configuration.map(item => item.path);
    check(names.every(safeRelative) && new Set(names).size === names.length && manifest.configuration.every(item => item.sha256 && !item.link && !item.directory), 'Invalid configuration manifest');
    check(Array.isArray(manifest.ownership) && manifest.ownership.length === names.length && new Set(manifest.ownership.map(item => item.path)).size === names.length && manifest.ownership.every(item => names.includes(item.path)), 'Missing/duplicate configuration ownership metadata');
    if (!privateIO) assertRecoverableOwners(manifest.ownership);
    check(JSON.stringify(privateIO ? privateIO('inspect', backup).configuration : inventory(path.join(backup, 'configuration'), manifest.configuration.filter(item => !item.directory && !item.link).map(item => item.path))) === JSON.stringify(manifest.configuration), 'Corrupt configuration backup');
  }
  copyPaths(path.join(backup, 'application'), destination, manifest.present);
  if (manifest.configuration) {
    const names = manifest.configuration.map(item => item.path);
    if (privateIO) {
      const purpose = path.basename(backup) === 'safe-recovery' ? 'restore-safe' : 'restore-raw';
      const report = privateIO(purpose, backup);
      check(JSON.stringify(report.configuration) === JSON.stringify(manifest.configuration) && JSON.stringify(report.ownership) === JSON.stringify(manifest.ownership), 'Private copy readback mismatch');
      const owners = privateIO(purpose === 'restore-safe' ? 'safe' : 'raw', backup);
      check(JSON.stringify(owners.configuration) === JSON.stringify(manifest.configuration) && JSON.stringify(owners.ownership) === JSON.stringify(manifest.ownership), 'Private ownership postreadback mismatch');
    } else {
    copyPaths(path.join(backup, 'configuration'), path.join(destination, 'isolated-configuration'), names);
    check(JSON.stringify(inventory(path.join(destination, 'isolated-configuration'), names)) === JSON.stringify(manifest.configuration), 'Configuration restore verification failed');
    for (const item of manifest.ownership ?? []) {
      const file = path.join(destination, 'isolated-configuration', item.path);
      let stat = fs.statSync(file);
      if (stat.uid !== item.uid || stat.gid !== item.gid) fs.chownSync(file, item.uid, item.gid);
      stat = fs.statSync(file);
      check(stat.uid === item.uid && stat.gid === item.gid, 'Configuration ownership restore failed');
    }
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
