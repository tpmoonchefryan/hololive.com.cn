import test from 'node:test';
import assert from 'node:assert/strict';
import TOML from '@iarna/toml';
import { generateToml, prepareVelocityConfig } from '../backend/scripts/lib/velocity-config.js';
import { runVelocitySync, createVelocityFiles } from '../backend/scripts/lib/velocity-sync.js';
const settings = { forwarding_secret: 'fixture-secret', motd: 'Line 1\nLine 2', bind_port: 25577 };
const servers = [{ id: 'srv', name: 'Lobby', address: '127.0.0.1:25565', is_try_server: true }];
function fixture(failure, changed = true) {
  const calls = [], reports = [];
  const files = { config: 'old valid', jar: 'old jar', secret: 'old secret' };
  const initial = structuredClone(files);
  const step = (stage, effect) => async (...args) => { calls.push(stage); if (failure === stage) throw new Error('injected'); return effect?.(...args); };
  const adapter = {
    read: step('read', () => ({ settings, servers, forcedHosts: [] })),
    snapshot: step('snapshot', () => structuredClone(files)),
    restore: step('restore', value => Object.assign(files, value)),
    applyConfig: step('config', content => { if (changed) files.config = content; return changed; }),
    applyJar: step('jar', () => { if (changed) files.jar = 'new jar'; return changed; }),
    applySecret: step('secret', value => { if (changed) files.secret = value; return changed; }),
    restart: step('restart'),
    report: step('metadata', (status, error, hash) => reports.push({ status, error, hash })),
  };
  return { adapter, calls, reports, files, initial };
}
test('TOML special characters roundtrip in all string positions', () => {
  const special = 'line\n"quoted"\\path\t\r\b\f\u0000\u001f\u007f中文';
  const input = { ...settings, motd: special, query_map: special };
  const server = { ...servers[0], name: special };
  const result = prepareVelocityConfig(input, [server], [{ hostname: special, server: ['srv'] }]);
  const parsed = TOML.parse(result.content);
  assert.equal(parsed.motd, special);
  assert.equal(parsed.query.map, special);
  assert.equal(parsed.servers[special], server.address);
  assert.deepEqual(parsed['forced-hosts'][special], [special]);
  assert.throws(() => TOML.parse('motd = "Line 1\nLine 2"'), /./);
  assert.equal(TOML.parse(generateToml(settings, servers)).motd, settings.motd);
});
for (const stage of ['read', 'snapshot', 'config', 'jar', 'secret', 'restart', 'metadata']) {
  test(`${stage} failure never records success/hash and restores valid files`, async () => {
    const f = fixture(stage);
    await assert.rejects(runVelocitySync(f.adapter, { restartIfChanged: true }), error => error.stage === stage);
    assert.deepEqual(f.files, f.initial);
    assert.equal(f.reports.some(report => report.status === 'ok'), false);
    assert.equal(f.reports.some(report => report.hash !== undefined), false);
  });
}
test('invalid config prevents file application and restart', async () => {
  for (const invalid of [{ bind_port: 0 }, { max_players: 1.5 }, { forwarding_secret: '\n' }, { ping_passthrough: 'bad' }]) {
    const f = fixture(); f.adapter.read = async () => ({ settings: { ...settings, ...invalid }, servers, forcedHosts: [] });
    await assert.rejects(runVelocitySync(f.adapter, { restartIfChanged: true }), error => error.stage === 'generate');
    assert.equal(f.calls.includes('config'), false);
    assert.equal(f.calls.includes('restart'), false);
  }
  assert.throws(() => prepareVelocityConfig(settings, [...servers, ...servers]), /duplicate/);
  assert.throws(() => prepareVelocityConfig(settings, servers, [{ hostname: 'x', server: ['missing'] }]), /target/);
});
test('applied, unchanged and explicit restart return trustworthy results', async () => {
  const f = fixture(); const result = await runVelocitySync(f.adapter, { restartIfChanged: true });
  assert.equal(result.status, 'applied'); assert.equal(result.restarted, true);
  assert.match(result.appliedHash, /^[a-f0-9]{64}$/);
  assert.equal(f.reports[0].hash, result.appliedHash);
  const unchanged = fixture(null, false); const noChange = await runVelocitySync(unchanged.adapter, { restartIfChanged: true });
  assert.equal(noChange.status, 'unchanged'); assert.equal(noChange.restarted, false);
  assert.equal(unchanged.calls.includes('restart'), false);
  const explicit = fixture(null, false); assert.equal((await runVelocitySync(explicit.adapter, { forceRestart: true })).restarted, true);
});
test('rollback failure is surfaced, error report cannot fake recovery', async () => {
  const f = fixture('jar'); f.adapter.restore = async () => { throw new Error('disk denied'); };
  await assert.rejects(runVelocitySync(f.adapter), /rollback failed: disk denied/);
  assert.equal(f.reports[0].status, 'error');
});

test('real files recover config, JAR, marker and secret after restart failure', async (t) => {
  const fs = await import('node:fs/promises'); const path = await import('node:path'); const { tmpdir } = await import('node:os');
  const directory = await fs.mkdtemp(path.join(tmpdir(), 'velocity-epic002-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const originals = { 'velocity.toml': 'motd = "old"\n', 'velocity.jar': Buffer.from([0x50, 0x4b, 3, 4]), 'forwarding.secret': 'old-secret\n', '.velocity_jar_ref': 'old-ref\n' };
  for (const [name, bytes] of Object.entries(originals)) await fs.writeFile(path.join(directory, name), bytes, { mode: name === 'forwarding.secret' ? 0o600 : 0o644 });
  const files = createVelocityFiles({ fs, directory, join: path.join }); const reports = [];
  await assert.rejects(runVelocitySync({ ...files,
    read: async () => ({ settings, servers, forcedHosts: [] }),
    applyJar: async () => { await fs.writeFile(path.join(directory, 'velocity.jar'), 'new-jar'); await fs.writeFile(path.join(directory, '.velocity_jar_ref'), 'new-ref'); return true; },
    restart: async () => { throw new Error('restart refused'); }, report: async (...args) => reports.push(args),
  }, { restartIfChanged: true }), /restart refused/);
  for (const [name, bytes] of Object.entries(originals)) {
    assert.deepEqual(await fs.readFile(path.join(directory, name)), Buffer.from(bytes));
    assert.deepEqual(await fs.readFile(path.join(directory, name + '.bak')), Buffer.from(bytes));
  }
  assert.equal((await fs.stat(path.join(directory, 'forwarding.secret'))).mode & 0o777, 0o600);
  assert.equal(reports[0][0], 'error'); assert.equal(reports[0][2], undefined);
});

import { binaries } from './helpers/pocketbase.mjs';
import { serviceFixture } from './helpers/service-identity.mjs';
import { createVelocityPocketBase } from '../backend/scripts/lib/velocity-pocketbase.js';
for (const [version, binary] of binaries) test(`real Velocity users auth/read/realtime/update/revocation ${version}`, async () => {
  const f = await serviceFixture(binary); let unsubscribe;
  try {
    const data = createVelocityPocketBase({ pb: f.pb, email: f.service.email, password: f.password });
    const initial = await data.read();
    assert.ok(initial.settings.id); assert.ok(Array.isArray(initial.servers)); assert.ok(Array.isArray(initial.forcedHosts));
    // Fresh PB optional number fields are zero: retain strict config rejection until configured.
    assert.throws(() => prepareVelocityConfig(initial.settings, initial.servers, initial.forcedHosts), /Invalid query_port/);
    await data.update('velocity_settings', initial.settings.id, { query_port: 25577, connection_timeout: 5000, read_timeout: 30000, forwarding_secret: 'isolated-secret' });
    const server = await f.record('velocity_servers', { name: 'Fixture', address: '127.0.0.1:25565', try_order: 1 });
    let resolveEvent;
    const event = new Promise(resolve => { resolveEvent = resolve; });
    const events = []; const authorizationErrors = [];
    let resolveDenied; const deniedEvent = new Promise(resolve => { resolveDenied = resolve; });
    const callbacks = Object.fromEntries(['velocity_settings', 'velocity_servers', 'velocity_forced_hosts'].map(collection => [collection, e => { events.push(collection); if (collection === 'velocity_settings' && e.record.last_sync_status === 'error') resolveEvent(e); }]));
    unsubscribe = await data.subscribe({ ...callbacks, onError: error => { authorizationErrors.push(error.message); resolveDenied(error); } });
    const updated = await data.update('velocity_settings', initial.settings.id, { last_sync_status: 'error', last_sync_error: 'isolated failure', last_sync_at: new Date().toISOString(), proxy_status: 'inactive', last_heartbeat: new Date().toISOString() });
    assert.equal(updated.last_sync_status, 'error'); assert.equal(updated.proxy_status, 'inactive'); assert.equal(updated.last_sync_error, 'isolated failure');
    const timeout = setTimeout(() => resolveEvent(null), 3000);
    assert.ok(await event, 'actual realtime delivery'); clearTimeout(timeout);
    assert.equal((await data.update('velocity_servers', server.id, { status: 'online', ping: 5, last_check: new Date().toISOString() })).status, 'online');
    const applied = fixture(); applied.adapter.read = data.read;
    applied.adapter.report = (status, error, hash) => data.update('velocity_settings', initial.settings.id, { last_sync_status: status, last_sync_error: error, last_sync_at: new Date().toISOString(), ...(hash ? { last_applied_hash: hash } : {}) });
    assert.equal((await runVelocitySync(applied.adapter)).status, 'applied');
    const saved = await f.pb.collection('velocity_settings').getOne(initial.settings.id);
    assert.equal(saved.last_sync_status, 'ok'); assert.match(saved.last_applied_hash, /^[a-f0-9]{64}$/);
    await f.changeUser(f.service, { service_account: false, verified: true });
    const eventCount = events.length;
    assert.equal((await f.database.request('/api/collections/velocity_settings/records/' + initial.settings.id, { token: f.database.token, method: 'PATCH', body: { last_sync_error: 'revoked event' } })).status, 200);
    const deniedTimeout = setTimeout(() => resolveDenied(null), 3000);
    assert.ok(await deniedEvent, 'service revocation blocks callback even when human admin data rule allows delivery'); clearTimeout(deniedTimeout);
    assert.ok(authorizationErrors.length); assert.equal(events.length, eventCount);
    await f.changeUser(f.service, { service_account: true, verified: false });
    await data.authorize();
    await unsubscribe(); unsubscribe = null;
    for (const body of [{ service_account: false }, { service_account: true, is_admin: false }]) {
      await f.changeUser(f.service, body);
      const denied = fixture(); denied.adapter.read = data.read; denied.adapter.report = applied.adapter.report;
      await assert.rejects(runVelocitySync(denied.adapter), /Service/);
      assert.equal(denied.calls.includes('snapshot'), false); assert.equal(denied.calls.includes('config'), false); assert.equal(denied.calls.includes('restart'), false);
      await assert.rejects(data.update('velocity_settings', initial.settings.id, { proxy_status: 'active' }), /Service/);
      await assert.rejects(data.subscribe(callbacks), /Service/);
    }
    await f.changeUser(f.service, { is_admin: true });
    assert.ok((await data.read()).settings.id);
    // Real short-lived PB token exercises expired refresh and users reauthentication.
    assert.equal((await f.database.request('/api/collections/users', { token: f.database.token, method: 'PATCH', body: { authToken: { duration: 10 } } })).status, 200);
    const reauthenticated = createVelocityPocketBase({ pb: f.pb, email: f.service.email, password: f.password });
    assert.ok((await reauthenticated.read()).settings.id);
    await new Promise(resolve => setTimeout(resolve, 10500));
    assert.ok((await reauthenticated.read()).settings.id);
    for (const user of [f.human, f.ordinary]) {
      await assert.rejects(createVelocityPocketBase({ pb: f.pb, email: user.email, password: f.password }).read(), /Service/);
    }
  } finally { try { if (unsubscribe) await unsubscribe(); } finally { await f.close(); } }
});

for (const options of [{ restartIfChanged: true }, { forceRestart: true }, {}]) test(`persistent website deployment guard blocks startup/event/migration differences ${JSON.stringify(options)}`, async () => {
  const f = fixture(); f.adapter.isProtected = async () => true;
  assert.deepEqual(await runVelocitySync(f.adapter, options), { status: 'protected', restarted: false });
  assert.deepEqual(f.calls, []); assert.deepEqual(f.files, f.initial); assert.deepEqual(f.reports, []);
});
test('guard check failure refuses all Velocity side effects; unguarded original behavior is retained', async () => {
  const f = fixture(); f.adapter.isProtected = async () => { throw new Error('guard inaccessible'); };
  await assert.rejects(runVelocitySync(f.adapter, { forceRestart: true }), /guard inaccessible/);
  assert.deepEqual(f.calls, []);
  f.adapter.isProtected = async () => false;
  assert.equal((await runVelocitySync(f.adapter, { restartIfChanged: true })).restarted, true);
});

for (const [version, binary] of binaries) test(`actual guarded daemon startup and realtime never touch Java files or control ${version}`, async (t) => {
  const fs = await import('node:fs/promises'), path = await import('node:path'), os = await import('node:os');
  const { startOwned } = await import('./helpers/pocketbase.mjs');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'hololive-guard-daemon-'));
  t.diagnostic('isolated daemon evidence: ' + directory);
  await fs.mkdir(path.join(directory, 'backend'));
  await fs.cp(new URL('../backend/scripts', import.meta.url), path.join(directory, 'backend/scripts'), { recursive: true });
  await fs.writeFile(path.join(directory, 'package.json'), '{"type":"module"}');
  await fs.symlink(path.resolve('node_modules'), path.join(directory, 'node_modules'));
  await fs.writeFile(path.join(directory, 'backend/.velocity-maintenance'), 'isolated deployment guard');
  const velocity = path.join(directory, 'velocity'); await fs.mkdir(velocity);
  const originals = { 'velocity.toml': 'existing live configuration', 'velocity.jar': 'existing JAR', 'forwarding.secret': 'existing secret', '.velocity_jar_ref': 'existing marker' };
  for (const [file, bytes] of Object.entries(originals)) await fs.writeFile(path.join(velocity, file), bytes);
  const bin = path.join(directory, 'bin'); await fs.mkdir(bin);
  const controls = path.join(directory, 'control.log');
  await fs.writeFile(path.join(bin, 'systemctl'), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$CONTROL_LOG"\nexit 99\n', { mode: 0o755 });
  const f = await serviceFixture(binary); let daemon;
  try {
    daemon = await startOwned(process.execPath, [path.join(directory, 'backend/scripts/sync_velocity.js')], {
      PB_URL: f.database.url, PB_EMAIL: f.service.email, PB_PASS: f.password, VELOCITY_DIR: velocity,
      PATH: bin + path.delimiter + process.env.PATH, CONTROL_LOG: controls,
    });
    for (let i = 0; i < 100 && !daemon.output().includes('Watching for changes'); i++) {
      if (daemon.child.exitCode !== null) throw new Error(daemon.output());
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.match(daemon.output(), /Watching for changes/);
    const settingsResponse = await f.database.request('/api/collections/velocity_settings/records', { token: f.database.token });
    assert.equal(settingsResponse.status, 200);
    const settings = settingsResponse.data.items[0];
    await f.database.request('/api/collections/velocity_settings/records/' + settings.id, { token: f.database.token, method: 'PATCH', body: { forwarding_secret: 'different database secret', motd: 'migration-like configuration difference', restart_trigger: new Date().toISOString() } });
    for (let i = 0; i < 100 && !daemon.output().includes('Config change detected'); i++) await new Promise(resolve => setTimeout(resolve, 25));
    assert.match(daemon.output(), /Config change detected/);
    await new Promise(resolve => setTimeout(resolve, 100));
    for (const [file, bytes] of Object.entries(originals)) assert.equal(await fs.readFile(path.join(velocity, file), 'utf8'), bytes);
    assert.deepEqual((await fs.readdir(velocity)).sort(), Object.keys(originals).sort());
    await assert.rejects(fs.access(controls), error => error.code === 'ENOENT');
  } finally { if (daemon) await daemon.close(); await f.close(); }
});
