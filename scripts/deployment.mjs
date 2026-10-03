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
      records.push({ path: relative, directory: true });
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
  check(/^[a-f0-9]{40}$/.test(config.previousRevision ?? ''), 'Missing actual previous revision');
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
function controlRead(file) {
  const before = controlPath(file);
  if (!before) return null;
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const opened = fs.fstatSync(fd), current = controlPath(file);
    check(current && opened.dev === current.dev && opened.ino === current.ino && opened.ino === before.ino, 'Maintenance endpoint changed during read');
    return JSON.parse(fs.readFileSync(fd, 'utf8'));
  } finally { fs.closeSync(fd); }
}
function controlWrite(file, value) {
  const before = controlPath(file);
  const fd = fs.openSync(file, fs.constants.O_RDWR | fs.constants.O_NOFOLLOW | (before ? 0 : fs.constants.O_CREAT | fs.constants.O_EXCL), 0o600);
  try {
    const opened = fs.fstatSync(fd), current = controlPath(file);
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
function checkDatabases(directory) {
  // Metadata only, never records/tokens. Run on a stopped snapshot, read-only.
  const script = `import sqlite3,json,pathlib,sys\np=pathlib.Path(sys.argv[1])\nout={}\nfor f in sorted(p.glob('*.db')):\n c=sqlite3.connect(f.as_uri()+'?mode=ro',uri=True)\n q=c.execute('pragma quick_check').fetchall()\n assert q==[('ok',)],str(f)+' integrity failure'\n tables=[r[0] for r in c.execute("select name from sqlite_master where type='table' order by name")]\n out[f.name]={'integrity':'ok','tables':{t:{'count':c.execute('select count(*) from "'+t.replace('"','""')+'"').fetchone()[0],'fields':[r[1:3] for r in c.execute('pragma table_info("'+t.replace('"','""')+'")')]} for t in tables}}\n if '_migrations' in tables: out[f.name]['migrations']=list(c.execute('select * from _migrations'))\n if '_collections' in tables: out[f.name]['collectionContract']=list(c.execute('select * from _collections'))\n c.close()\nassert 'data.db' in out,'Missing data database'\nprint(json.dumps(out))`;
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

export function verifyImmutableMigrations(bundle, webRoot) {
  const directory = path.join(webRoot, 'backend/pb_migrations');
  if (!fs.existsSync(directory)) return;
  const source = new Map(inventory(bundle, ['backend/pb_migrations']).map(record => [record.path, record]));
for (const record of inventory(webRoot, ['backend/pb_migrations'])) {
    const expected = source.get(record.path);
    check(expected && expected.sha256 === record.sha256 && expected.directory === record.directory && expected.link === record.link, 'Unknown or modified production migration: ' + record.path);
  }
}

export function installBundle(bundle, webRoot, revision) {
  const manifest = verifyBundle(bundle, revision);
  assertRealPath(webRoot);
  verifyImmutableMigrations(bundle, webRoot);
  verifyInstallTargets(webRoot);
  for (const name of artifactPaths) {
    const dest = path.join(webRoot, name);
    if (fs.existsSync(dest)) assertRealPath(dest);
    fs.rmSync(dest, { recursive: true, force: true });
    copyPaths(bundle, webRoot, [name]);
  }
  const installed = inventory(webRoot);
  check(JSON.stringify(installed) === JSON.stringify(manifest.files), 'Installed artifact mismatch');
  verifyArtifactLinks(webRoot, installed);
}

export function snapshotApplication(webRoot, backup) {
  const names = [...artifactPaths, 'backend/pb_data'];
  const present = names.filter(name => fs.existsSync(path.join(webRoot, name)));
  copyPaths(webRoot, path.join(backup, 'application'), present);
  return { present, missing: names.filter(name => !present.includes(name)), application: inventory(path.join(backup, 'application'), present) };
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
  const writeControl = (file, value) => { boundControl(file); controlWrite(file, value); }; 
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
    boundControl(state); oldState = controlRead(state);
    check(!oldState || (oldState.status === 'deployed' && runNumber > oldState.runNumber), 'Older/repeated run or unresolved failed deployment');
  };
  const migrateCopy = directory => command(pb, ['migrate', 'up', '--dir', path.join(directory, 'backend/pb_data'), '--migrationsDir', path.join(bundle, 'backend/pb_migrations'), '--hooksDir', path.join(bundle, 'backend/pb_hooks')]);
  return {
    verify: () => {
      verifyBundle(bundle, revision);
      verifyImmutableMigrations(bundle, config.webRoot);
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
      writeJSON(path.join(backupPath, 'backup.json'), { revision: oldState?.revision ?? config.previousRevision, ...snapshot, configuration: inventory(path.join(backupPath, 'configuration'), config.configurationFiles.map(file => file.slice(1))) });
      return backupPath;
    },
    rehearse: backup => {
      const manifest = json(path.join(backup, 'backup.json'));
      check(JSON.stringify(inventory(path.join(backup, 'application'), manifest.present)) === JSON.stringify(manifest.application), 'Backup digest mismatch');
      checkDatabases(path.join(backup, 'application/backend/pb_data'));
      const isolated = path.join(backup, 'rehearsal');
      copyPaths(path.join(backup, 'application'), isolated, manifest.present);
      check(JSON.stringify(inventory(isolated, manifest.present)) === JSON.stringify(manifest.application), 'Restore rehearsal differs from snapshot');
      checkDatabases(path.join(isolated, 'backend/pb_data'));
      const migrationLog = migrateCopy(isolated);
      check(!/Failed|Error:/i.test(migrationLog), 'Isolated migration failed');
      fs.writeFileSync(path.join(backup, 'isolated-migration.log'), migrationLog, { mode: 0o600 });
      writeJSON(path.join(backup, 'isolated-migrated-contract.json'), checkDatabases(path.join(isolated, 'backend/pb_data')));
    },
    baseline: backup => writeJSON(path.join(backup, 'before-contract.json'), checkDatabases(path.join(backup, 'application/backend/pb_data'))),
    install: () => { verifyInstallTargets(config.webRoot, config.configurationFiles); installBundle(bundle, config.webRoot, revision); },
    migrate: () => { const output = migrateCopy(config.webRoot); check(!/Failed|Error:/i.test(output), 'Production migration failed'); fs.writeFileSync(path.join(backupPath, 'production-migration.log'), output, { mode: 0o600 }); },
    start: unit => systemctl(unit === 'pocketbase' || unit === 'velocity-sync' ? 'start' : 'restart', unit),
    health: async () => {
      for (let i = 0; i < 30; i++) {
        try { const response = await fetch(config.pocketbaseHealthUrl, { signal: AbortSignal.timeout(1000) }); const data = await response.json(); if (response.ok && data.code === 200) return; } catch { /* retry bounded startup */ }
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      refuse('PocketBase startup health failed');
    },
    assertVelocity: before => {
      const after = velocity();
      check(before.service.includes('ActiveState=active') && before.service === after.service && JSON.stringify(before.files) === JSON.stringify(after.files), 'Velocity continuity/file evidence differs');
      // Website ports may change; assert each explicitly inventoried proxy listener.
      for (const port of config.velocityPorts ?? []) check(before.listeners.includes(':' + port + ' ') && after.listeners.includes(':' + port + ' '), 'Velocity listener missing');
      check(config.velocityPorts?.length > 0, 'Velocity port inventory missing');
      writeJSON(path.join(backupPath, 'velocity-continuity.json'), { before, after });
    },
    record: value => writeControl(state, JSON.stringify( { ...value, runId: process.env.GITHUB_RUN_ID, runUrl: `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`, trigger: process.env.GITHUB_EVENT_NAME, completedAt: new Date().toISOString() }) + '\n'),
    failure: value => writeControl(state, JSON.stringify({ ...value, runNumber, failedAt: new Date().toISOString() }) + '\n'),
  };
}

export function restoreBackup(backup, destination) {
  // Always isolated; never silently restores a running production directory.
  check(!fs.existsSync(destination), 'Restore destination must be new');
  const manifest = json(path.join(backup, 'backup.json'));
  check(manifest.present.every(name => [...artifactPaths, 'backend/pb_data'].includes(name)), 'Backup whitelist mismatch');
  check(JSON.stringify(inventory(path.join(backup, 'application'), manifest.present)) === JSON.stringify(manifest.application), 'Corrupt backup');
  copyPaths(path.join(backup, 'application'), destination, manifest.present);
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
