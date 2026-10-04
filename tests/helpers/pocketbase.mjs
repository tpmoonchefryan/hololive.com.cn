import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, copyFile, rm, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
export const root = path.resolve(import.meta.dirname, '../..');
export const binaries = [
  ['0.26.5', process.env.PB_TEST_BINARY_026 || path.join(root, '.context/review-2026-10-02/runtime026/pocketbase')],
  ['0.34.2', process.env.PB_TEST_BINARY_034 || path.join(root, '.context/review-2026-10-02/runtime/pocketbase')],
];
export async function unusedPort() {
  const server = net.createServer();
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); });
    });
    return server.address().port;
  } finally {
    if (server.listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}
export async function startOwned(command, args, env = {}) {
  const child = spawn(command, args, { detached: true, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '', spawnError, terminal = false;
  child.stdout.on('data', d => { output += d; }); child.stderr.on('data', d => { output += d; });
  const ended = new Promise(resolve => {
    child.once('exit', () => { terminal = true; resolve(); });
    child.once('error', error => { spawnError = error; terminal = true; resolve(); });
  });
  const guard = process.env.TCRN_SPAWN_GUARD;
  const owner = process.env.TCRN_TASK_OWNER;
  const registry = process.env.TCRN_SPAWN_REGISTRY;
  let registered = false, closePromise;
  const guardCall = verb => spawnSync(process.execPath, [guard, verb, '--registry', registry, '--pgid', String(child.pid),
    ...(verb === 'register' ? ['--pattern', path.basename(command)] : []), '--purpose', owner], { encoding: 'utf8' });
  const service = { child, output: () => output,
    close() {
      if (closePromise) return closePromise;
      closePromise = Promise.resolve().then(async () => {
        let timer;
        if (!terminal && child.exitCode === null && child.signalCode === null) {
          // This detached process group belongs to this call, never a sibling owner.
          try { process.kill(-child.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
          timer = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, 5000);
          try { await ended; } finally { clearTimeout(timer); }
        }
        if (registered) {
          const result = guardCall('deregister');
          if (result.status !== 0) throw new Error(result.stderr || result.stdout || 'Guard deregistration failed');
          registered = false;
        }
      });
      return closePromise;
    },
  };
  try {
    await once(child, 'spawn');
    if (spawnError) throw spawnError;
    if (guard && owner && registry) {
      const result = guardCall('register');
      if (result.status !== 0) throw new Error(result.stderr || result.stdout || 'Guard registration failed');
      registered = true;
    }
    return service;
  } catch (error) {
    try { await service.close(); } catch (cleanupError) { throw new AggregateError([error, cleanupError], 'Child setup and cleanup failed'); }
    throw error;
  }
}
export async function waitFor(url, service, { signal } = {}) {
  for (let i = 0; i < 100; i++) {
    signal?.throwIfAborted();
    if (service.child.exitCode !== null) throw new Error(service.output());
    try { await fetch(url, {signal}); signal?.throwIfAborted(); return; } catch { signal?.throwIfAborted(); await new Promise(r => setTimeout(r, 50)); }
  }
  throw new Error(`Service failed to start: ${service.output()}`);
}
export async function pocketbase(binary, names = null, overrides = {}, { signal } = {}) {
  signal?.throwIfAborted();
  const directory = await mkdtemp(path.join(tmpdir(), 'hololive-pb-test-'));
  let service, closePromise;
  const close = ({ retainDirectory = false } = {}) => closePromise ||= (async () => {
    try { if (service) await service.close(); } catch (error) {
      error.fixtureResource={directory,retained:true,pid:service?.child.pid,exitCode:service?.child.exitCode,signal:service?.child.signalCode};
      throw error;
    }
    // mkdtemp's exact unique root is the only removable tree; failed child close retains it.
    if (!retainDirectory) await rm(directory, { recursive: true, force: true });
  })();
  const check = () => signal?.throwIfAborted();
  try {
    check();
    const copied = names || (Object.keys(overrides).length ? await readdir(path.join(root, 'backend/pb_migrations')) : null);
    const selected = copied && await copied;
    const migrations = selected ? path.join(directory, 'migrations') : path.join(root, 'backend/pb_migrations');
    if (selected) {
      await mkdir(migrations); check();
      for (const name of selected) {
        if (path.basename(name) !== name) throw new Error('Migration basename required');
        await copyFile(path.join(root, 'backend/pb_migrations', name), path.join(migrations, name)); check();
      }
    }
    for (const [name, content] of Object.entries(overrides)) {
      if (path.basename(name) !== name) throw new Error('Migration override basename required');
      await writeFile(path.join(migrations, name), content); check();
    }
    const common = ['--dir', path.join(directory, 'data'), '--migrationsDir', migrations, '--hooksDir', path.join(root, 'backend/pb_hooks')];
    const run = args => spawnSync(binary, [...args, ...common], { encoding: 'utf8' });
    const migration = run(['migrate', 'up']); check();
    if (migration.status !== 0 || /Failed|Error:/i.test(migration.stdout + migration.stderr)) throw new Error(migration.stdout + migration.stderr);
    const provision = run(['superuser', 'upsert', 'fixture@example.invalid', 'Disposable-Fixture-2026!']); check();
    if (provision.status !== 0) throw new Error(provision.stdout + provision.stderr);
    const port = await unusedPort(); check();
    service = await startOwned(binary, ['serve', '--http', `127.0.0.1:${port}`, ...common]); check();
    const url = `http://127.0.0.1:${port}`;
    await waitFor(`${url}/api/health`, service, {signal}); check();
    async function request(route, { token, method = 'GET', body } = {}) {
      const response = await fetch(url + route, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: token } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
      return { status: response.status, data: await response.json() };
    }
    const auth = await request('/api/collections/_superusers/auth-with-password', { method: 'POST', body: { identity: 'fixture@example.invalid', password: 'Disposable-Fixture-2026!' } }); check();
    if (auth.status !== 200) throw new Error(JSON.stringify(auth));
    return { url, request, token: auth.data.token, directory, migrations, run, get service() { return service; },
      async restart() {
        check(); await service.close(); check();
        service = await startOwned(binary, ['serve', '--http', `127.0.0.1:${port}`, ...common]);
        await waitFor(`${url}/api/health`, service, {signal}); check();
      }, close };
  } catch (error) {
    try { await close(); } catch (cleanupError) {
      const combined=new AggregateError([error, cleanupError], 'PB setup and cleanup failed');combined.fixtureResource=cleanupError.fixtureResource||{directory,retained:true};throw combined;
    }
    throw error;
  }
}
