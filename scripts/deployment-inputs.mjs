#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const require = (v, m) => { if (!v) throw new Error(m); };
const hash = b => createHash('sha256').update(b).digest('hex');
export const pins = Object.freeze({
  '0.26.5': 'aeb42b83fb642f0b473e390f65f6154f8dcc36b96bde76cfe0e55d6a09c76eef',
  '0.34.2': 'a469d8ad8e6bd571b50841d63cd8b5c2e79d66552f9749221fd20ce497ade027',
});
export const retained = Object.freeze({ name: '1765100008_add_velocity_advanced.js', bytes: 2249, sha256: '85f8f91d99a2cb72fec56515f08b980c26cf9f32350ef1caae53f6f904749d0c' });
export function regular(file) {
  require(path.isAbsolute(file) && fs.realpathSync(file) === file, 'Aliased input');
  const s = fs.lstatSync(file);
  require(s.isFile() && s.nlink === 1, 'Nonregular input');
  return s;
}
export function validateArchive(bytes, version) {
  require(Object.hasOwn(pins, version) && hash(bytes) === pins[version], 'Archive SHA/version mismatch');
  return bytes;
}
export function validateRetained(bytes) {
  require(bytes.length === retained.bytes && hash(bytes) === retained.sha256, 'Retained history mismatch');
  return bytes;
}
export function validateResources(config, facts) {
  require(config.runnerResources && Object.keys(config.runnerResources).sort().join(',') === 'CPUQuota,MemoryHigh,MemoryMax,TasksMax,unit', 'Missing closed resource binding');
  const r = config.runnerResources;
  require(r.CPUQuota === '100%' && r.MemoryHigh === 1879048192 && r.MemoryMax === 2147483648 && r.TasksMax === 256 && typeof r.unit === 'string' && /^actions\.runner\.[A-Za-z0-9_.-]+\.service$/.test(r.unit), 'Unapproved runner limits');
  require(facts.unit === r.unit && facts.member === true && facts.descendantsBound === true, 'Wrong runner membership');
  require(facts.memoryHigh === String(r.MemoryHigh) && facts.memoryMax === String(r.MemoryMax) && facts.pidsMax === String(r.TasksMax), 'Ineffective memory/pids bounds');
  const cpu = facts.cpuMax.split(' ');
  require(cpu.length === 2 && /^\d+$/.test(cpu[0]) && cpu[0] === cpu[1] && Number(cpu[0]) > 0, 'Ineffective CPU bound; parent controller provisioning required');
  require(facts.controllers.includes('cpu') && facts.controllers.includes('memory') && facts.controllers.includes('pids'), 'Unavailable resource controllers');
  return { ...facts, ioEnforcement: 'unknown' };
}
export function validateHost(configFile, env = process.env) {
  require(process.platform === 'linux' && process.arch === 'x64', 'Wrong CI platform');
  const s = regular(configFile), caller = os.userInfo();
  require(s.uid === 0 && s.gid === caller.gid && (s.mode & 0o777) === 0o640 && caller.uid !== 0, 'Config must be root:runner-group 0640');
  const c = JSON.parse(fs.readFileSync(configFile));
  require(c.approvedRevision === env.DEPLOY_REVISION && c.repository === env.GITHUB_REPOSITORY && /^[0-9]+$/.test(env.GITHUB_RUN_ID ?? '') && ['push', 'workflow_dispatch'].includes(env.GITHUB_EVENT_NAME), 'Wrong current Actions input');
  require(c.runnerUser === caller.username && c.machineIdSha256 === hash(fs.readFileSync('/etc/machine-id')), 'Wrong host/runner');
  for (const key of ['webRoot', 'backupRoot', 'stateRoot', 'velocityRoot']) require(path.isAbsolute(c[key]) && fs.realpathSync(c[key]) === c[key] && fs.statSync(c[key]).isDirectory(), 'Missing actual root');
  require(!JSON.stringify(c).match(/"(?:password|token|secret)"\s*:/i), 'Secret in deployment config');
  const unit = c.runnerResources?.unit;
  require(typeof unit === 'string' && /^actions\.runner\.[A-Za-z0-9_.-]+\.service$/.test(unit), 'Missing runner unit');
  const output = execFileSync('/usr/bin/systemctl', ['show', unit, '-p', 'ControlGroup', '-p', 'MemoryHigh', '-p', 'MemoryMax', '-p', 'TasksMax', '-p', 'CPUQuotaPerSecUSec'], { encoding: 'utf8' });
  const p = Object.fromEntries(output.trim().split('\n').map(x => x.split('=')));
  const membership = fs.readFileSync('/proc/self/cgroup', 'utf8').trim();
  require(membership.startsWith('0::/'), 'Unified cgroup required');
  const group = p.ControlGroup;
  require(group && group.startsWith('/') && !group.includes('..'), 'Invalid runner cgroup');
  const base = '/sys/fs/cgroup' + group;
  const read = name => fs.readFileSync(base + '/' + name, 'utf8').trim();
  const descendants = directory => fs.readdirSync(directory, { withFileTypes: true }).filter(x => x.isDirectory()).flatMap(x => { const child = path.join(directory, x.name); require(!fs.lstatSync(child).isSymbolicLink(), 'Linked cgroup'); return [child, ...descendants(child)]; });
  const cpuMax = read('cpu.max');
  const bound = descendants(base).every(child => {
    const cpu = fs.readFileSync(child + '/cpu.max', 'utf8').trim().split(' ');
    const nominal = cpuMax.split(' ');
    return (cpu[0] === 'max' || Number(cpu[0]) / Number(cpu[1]) <= Number(nominal[0]) / Number(nominal[1])) && fs.existsSync(child + '/memory.max') && fs.existsSync(child + '/pids.max');
  });
  const facts = { unit, member: membership.slice(3) === group || membership.slice(3).startsWith(group + '/'), descendantsBound: bound, controllers: fs.readFileSync(path.dirname(base) + '/cgroup.subtree_control', 'utf8').trim().split(' '), cpuMax, memoryHigh: read('memory.high'), memoryMax: read('memory.max'), pidsMax: read('pids.max'), memoryEvents: read('memory.events'), cpuStat: read('cpu.stat'), systemd: p };
  require(p.MemoryHigh === facts.memoryHigh && p.MemoryMax === facts.memoryMax && p.TasksMax === facts.pidsMax && p.CPUQuotaPerSecUSec === '1s', 'Systemd/controller disagreement');
  return { config: c, resources: validateResources(c, facts) };
}
// ZIP extraction has no shell, no host install, and only the single binary is written.
export const zipExtractor = String.raw`import sys,zipfile,stat,os
z=zipfile.ZipFile(sys.argv[1]); names=set(); binary=None
for i in z.infolist():
 n=i.filename
 if n in names or n.startswith('/') or '\\' in n or any(p in ('','..','.') for p in n.split('/')): raise RuntimeError('Unsafe ZIP path')
 names.add(n); mode=i.external_attr>>16
 if stat.S_ISLNK(mode) or (stat.S_IFMT(mode) not in (0,stat.S_IFREG)): raise RuntimeError('Unsafe ZIP type')
 if n not in ('pocketbase','LICENSE.md','CHANGELOG.md'): raise RuntimeError('Unexpected ZIP entry')
 if i.file_size>134217728 or i.compress_size>134217728: raise RuntimeError('Unbounded ZIP entry')
 if n=='pocketbase': binary=i
if binary is None: raise RuntimeError('Missing binary')
b=z.read(binary)
if not b.startswith(b'\x7fELF') or b[4:6]!=b'\x02\x01' or b[18:20]!=b'\x3e\x00': raise RuntimeError('Wrong ELF architecture')
fd=os.open(sys.argv[2],os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o700)
try:
 with os.fdopen(fd,'wb',closefd=False) as f: f.write(b); f.flush(); os.fsync(fd)
finally: os.close(fd)
`;
export async function supplyInputs(configFile, env = process.env) {
  const { config } = validateHost(configFile, env);
  require(env.RUNNER_TEMP && path.isAbsolute(env.RUNNER_TEMP) && fs.realpathSync(env.RUNNER_TEMP) === env.RUNNER_TEMP, 'Missing actual runner temp');
  const directory = fs.mkdtempSync(path.join(env.RUNNER_TEMP, 'hololive-input-' + env.GITHUB_RUN_ID + '-'));
  fs.chmodSync(directory, 0o700);
  const inputs = {};
  for (const [version, digest] of Object.entries(pins)) {
    const url = `https://github.com/pocketbase/pocketbase/releases/download/v${version}/pocketbase_${version}_linux_amd64.zip`;
    // GitHub's official release redirect is explicit; no other origin is accepted.
    let current = url, response;
    for (let i = 0; i < 4; i++) {
      const u = new URL(current);
      require((u.origin === 'https://github.com' && current === url) || u.origin === 'https://release-assets.githubusercontent.com', 'Unreviewed archive origin');
      response = await fetch(current, { redirect: 'manual', signal: AbortSignal.timeout(30000) });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      current = new URL(response.headers.get('location'), current).href;
    }
    require(response?.ok && Number(response.headers.get('content-length')) <= 134217728, 'Archive download failed');
    const chunks = []; let size = 0;
    for await (const chunk of response.body) { size += chunk.length; require(size <= 134217728, 'Archive too large'); chunks.push(chunk); }
    const bytes = Buffer.concat(chunks);
    require(digest === pins[version], 'Pin drift'); validateArchive(bytes, version);
    const archive = path.join(directory, version + '.zip'), binary = path.join(directory, 'pocketbase-' + version);
    fs.writeFileSync(archive, bytes, { mode: 0o600, flag: 'wx' });
    execFileSync('/usr/bin/python3', ['-I', '-c', zipExtractor, archive, binary], { stdio: ['ignore', 'pipe', 'pipe'] });
    require(execFileSync(binary, ['--version'], { encoding: 'utf8' }).trim() === 'pocketbase version ' + version, 'Wrong binary version');
    inputs[version === '0.26.5' ? 'PB_TEST_BINARY_026' : 'PB_TEST_BINARY_034'] = binary;
  }
  const source = path.join(config.webRoot, 'backend/pb_migrations', retained.name); regular(source);
  const bytes = validateRetained(fs.readFileSync(source));
  inputs.PB_RETAINED_HISTORY_FILE = path.join(directory, retained.name);
  fs.writeFileSync(inputs.PB_RETAINED_HISTORY_FILE, bytes, { mode: 0o600, flag: 'wx' });
  require(env.GITHUB_ENV && regular(env.GITHUB_ENV), 'Missing Actions environment file');
  fs.appendFileSync(env.GITHUB_ENV, Object.entries(inputs).map(([key, value]) => key + '=' + value).join('\n') + '\n');
  return { inputs, directory, versions: Object.keys(pins), retainedSha256: retained.sha256 };
}
const envForTests = () => process.env;
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [mode, file] = process.argv.slice(2);
    require(['host', 'supply', 'supply-tests'].includes(mode) && file, 'Usage: deployment-inputs.mjs host|supply CONFIG');
    const result = mode === 'host' ? validateHost(path.resolve(file)).resources : await supplyInputs(path.resolve(file));
    if (mode === 'supply-tests') execFileSync(process.execPath, ['--test', 'tests/deployment.test.mjs', 'tests/velocity-sync.test.mjs'], { env: { ...envForTests(), ...result.inputs }, stdio: 'inherit' });
    else console.log(JSON.stringify(result));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
