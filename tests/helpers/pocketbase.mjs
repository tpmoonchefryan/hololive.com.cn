import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, copyFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
export const root = path.resolve(import.meta.dirname, '../..');
export const binaries = [
  ['0.26.5', process.env.PB_TEST_BINARY_026 || path.join(root, '.context/review-2026-10-02/runtime026/pocketbase')],
  ['0.34.2', process.env.PB_TEST_BINARY_034 || path.join(root, '.context/review-2026-10-02/runtime/pocketbase')],
];
export async function unusedPort() {
  const s = net.createServer(); await new Promise(r => s.listen(0, '127.0.0.1', r));
  const p = s.address().port; await new Promise(r => s.close(r)); return p;
}
export async function startOwned(command, args, env = {}) {
  const child = spawn(command, args, { detached: true, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; child.stdout.on('data', d => { output += d; }); child.stderr.on('data', d => { output += d; });
  const guard = process.env.TCRN_SPAWN_GUARD;
  const owner = process.env.TCRN_TASK_OWNER;
  const registry = process.env.TCRN_SPAWN_REGISTRY;
  if (guard && owner && registry) {
    const result = spawnSync(process.execPath, [guard, 'register', '--registry', registry, '--pgid', String(child.pid), '--pattern', path.basename(command), '--purpose', owner], { encoding: 'utf8' });
    if (result.status !== 0) { child.kill(); throw new Error(result.stderr || result.stdout); }
  }
  return {
    child, output: () => output,
    async close() {
      if (child.exitCode === null && child.signalCode === null) { child.kill('SIGTERM'); await once(child, 'exit'); }
      if (guard && owner && registry) {
        const result = spawnSync(process.execPath, [guard, 'deregister', '--registry', registry, '--pgid', String(child.pid), '--purpose', owner], { encoding: 'utf8' });
        if (result.status !== 0) throw new Error(result.stderr || result.stdout);
      }
    },
  };
}
export async function waitFor(url, service) {
  for (let i = 0; i < 100; i++) {
    if (service.child.exitCode !== null) throw new Error(service.output());
    try { await fetch(url); return; } catch { await new Promise(r => setTimeout(r, 50)); }
  }
  throw new Error(`Service failed to start: ${service.output()}`);
}
export async function pocketbase(binary, names = null, overrides = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'hololive-pb-test-'));
  const migrations = names ? path.join(directory, 'migrations') : path.join(root, 'backend/pb_migrations');
  if (names) { await mkdir(migrations); for (const name of names) await copyFile(path.join(root, 'backend/pb_migrations', name), path.join(migrations, name)); }
  for (const [name, content] of Object.entries(overrides)) await writeFile(path.join(migrations, name), content);
  const common = ['--dir', path.join(directory, 'data'), '--migrationsDir', migrations, '--hooksDir', path.join(root, 'backend/pb_hooks')];
  const run = args => spawnSync(binary, [...args, ...common], { encoding: 'utf8' });
  const migration = run(['migrate', 'up']);
  if (migration.status !== 0 || /Failed|Error:/i.test(migration.stdout + migration.stderr)) { await rm(directory, { recursive: true }); throw new Error(migration.stdout + migration.stderr); }
  const provision = run(['superuser', 'upsert', 'fixture@example.invalid', 'Disposable-Fixture-2026!']);
  if (provision.status !== 0) throw new Error(provision.stdout + provision.stderr);
  const port = await unusedPort(); let service = await startOwned(binary, ['serve', '--http', `127.0.0.1:${port}`, ...common]);
  const url = `http://127.0.0.1:${port}`;
  try { await waitFor(`${url}/api/health`, service); } catch (error) { await service.close(); throw error; }
  async function request(route, { token, method = 'GET', body } = {}) {
    const response = await fetch(url + route, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: token } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, data: await response.json() };
  }
  const auth = await request('/api/collections/_superusers/auth-with-password', { method: 'POST', body: { identity: 'fixture@example.invalid', password: 'Disposable-Fixture-2026!' } });
  if (auth.status !== 200) throw new Error(JSON.stringify(auth));
  return { url, request, token: auth.data.token, directory, migrations, run, get service() { return service; },
    async restart() {
      await service.close();
      service = await startOwned(binary, ['serve', '--http', `127.0.0.1:${port}`, ...common]);
      await waitFor(`${url}/api/health`, service);
    },
    async close() { await service.close(); await rm(directory, { recursive: true, force: true }); } };
}
