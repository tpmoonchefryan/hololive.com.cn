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

// TCRN-HOLOLIVE-CN-INC-002: C1 (zero timeouts), C2 (.bak only on failure), C3 (no forced restart
// before settings were loaded). Anonymous live-shaped values, never a production export: zero
// timeouts, the 256/-1/3000 advanced values, empty selects, zero rate limits, a single (string)
// forced-host relation and the "<settings.id>:<velocity_jar>" JAR marker.
import * as fsp from 'node:fs/promises';
import nodePath from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { root } from './helpers/pocketbase.mjs';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const liveShaped = {
  id: 'settingsfixture', bind_port: '25565', motd: 'Anonymous fixture MOTD', max_players: 50, velocity_jar: 'velocity_fixture.jar',
  restart_trigger: '2026-01-01 00:00:00.000Z', online_mode: true, force_key_authentication: false, prevent_client_proxy_connections: false,
  kick_existing_players: false, announce_forge: false, accepts_transfers: false, haproxy_protocol: false, show_ping_requests: false,
  connection_timeout: 0, read_timeout: 0, sample_players_in_ping: false, enable_player_address_logging: false,
  failover_on_unexpected_server_disconnect: false, log_command_executions: false, log_player_connections: false, enable_reuse_port: false,
  command_rate_limit: 0, forward_commands_if_rate_limited: false, kick_after_rate_limited_commands: 0, tab_complete_rate_limit: 0,
  kick_after_rate_limited_tab_completes: 0, player_info_forwarding_mode: '', ping_passthrough: '',
  compression_threshold: 256, compression_level: -1, login_ratelimit: 3000, forwarding_secret: 'fixture-forwarding-secret',
};
const liveServers = [{ id: 'serverfixture01', name: 'lobby', address: 'lobby.example.invalid:25568', is_try_server: true, try_order: 1 }];
const liveForcedHosts = [{ id: 'forcedfixture01', hostname: 'play.example.invalid', server: 'serverfixture01' }];
const liveRead = async () => ({ settings: liveShaped, servers: liveServers, forcedHosts: liveForcedHosts });
const staleFiles = { 'velocity.toml': 'motd = "old"\n', 'velocity.jar': Buffer.from([0x50, 0x4b, 3, 4]), 'forwarding.secret': 'old-secret\n', '.velocity_jar_ref': 'old-ref\n' };
async function realVelocityFiles(t, originals) {
  const directory = await fsp.mkdtemp(nodePath.join(tmpdir(), 'velocity-inc002-'));
  t.after(() => fsp.rm(directory, { recursive: true, force: true }));
  for (const [name, bytes] of Object.entries(originals)) await fsp.writeFile(nodePath.join(directory, name), bytes, { mode: name === 'forwarding.secret' ? 0o600 : 0o644 });
  const identity = async () => Object.fromEntries(await Promise.all(Object.keys(originals).map(async name => {
    const file = nodePath.join(directory, name);
    return [name, { ino: (await fsp.stat(file)).ino, bytes: await fsp.readFile(file) }];
  })));
  return { directory, identity, files: createVelocityFiles({ fs: fsp, directory, join: nodePath.join }) };
}

test('C1 live-shaped settings accept zero connection/read timeouts and render them literally', () => {
  const { content, parsed, secret } = prepareVelocityConfig(liveShaped, liveServers, liveForcedHosts);
  assert.match(content, /^connection-timeout = 0$/m);
  assert.match(content, /^read-timeout = 0$/m);
  assert.deepEqual([parsed.advanced['connection-timeout'], parsed.advanced['read-timeout']], [0, 0]);
  assert.deepEqual([parsed.advanced['compression-threshold'], parsed.advanced['compression-level'], parsed.advanced['login-ratelimit']], [256, -1, 3000]);
  assert.deepEqual([parsed['player-info-forwarding-mode'], parsed['ping-passthrough']], ['modern', 'DISABLED']);
  assert.deepEqual(parsed['forced-hosts']['play.example.invalid'], ['lobby']);
  assert.equal(secret, liveShaped.forwarding_secret);
});
test('C1 timeouts still reject -1, 1.5 and 2147483648 at stage generate without file writes or restart', async () => {
  for (const field of ['connection_timeout', 'read_timeout']) for (const value of [-1, 1.5, 2147483648]) {
    const settings = { ...liveShaped, [field]: value };
    assert.throws(() => prepareVelocityConfig(settings, liveServers, liveForcedHosts), { message: `Invalid ${field}` });
    const f = fixture(); f.adapter.read = async () => ({ settings, servers: liveServers, forcedHosts: liveForcedHosts });
    await assert.rejects(runVelocitySync(f.adapter, { restartIfChanged: true }), error => error.stage === 'generate' && error.message === `Velocity generate: Invalid ${field}`);
    assert.deepEqual(f.calls, ['metadata']); assert.deepEqual(f.files, f.initial);
    assert.deepEqual(f.reports, [{ status: 'error', error: `Velocity generate: Invalid ${field}`, hash: undefined }]);
  }
});
test('unchanged live-shaped sync over real files with the new-format marker: no download, no restart, ok, no .bak left', async (t) => {
  const prepared = prepareVelocityConfig(liveShaped, liveServers, liveForcedHosts);
  const v = await realVelocityFiles(t, { 'velocity.toml': prepared.content, 'velocity.jar': Buffer.from([0x50, 0x4b, 3, 4]), 'forwarding.secret': `${prepared.secret}\n`, '.velocity_jar_ref': `${liveShaped.id}:${liveShaped.velocity_jar}\n` });
  const before = await v.identity(), calls = [], reports = [];
  // The daemon's JAR contract (syncJarIfNeeded): download only when the marker differs from "<settings.id>:<velocity_jar>".
  // The actual daemon path is exercised against real PocketBase below.
  const applyJar = async settings => {
    if ((await fsp.readFile(nodePath.join(v.directory, '.velocity_jar_ref'), 'utf8')).trim() === `${settings.id}:${settings.velocity_jar}`) return false;
    calls.push('download'); return true;
  };
  const result = await runVelocitySync({ ...v.files, read: liveRead, applyJar, restart: async () => { calls.push('restart'); }, report: async (...args) => { reports.push(args); } }, { restartIfChanged: true });
  assert.deepEqual(result, { status: 'unchanged', configChanged: false, jarChanged: false, secretChanged: false, restarted: false, appliedHash: sha256(prepared.content) });
  assert.deepEqual(calls, []);
  assert.deepEqual(reports, [['ok', '', sha256(prepared.content)]]);
  assert.deepEqual(await v.identity(), before, 'bytes and inodes unchanged');
  assert.deepEqual((await fsp.readdir(v.directory)).sort(), Object.keys(before).sort(), 'C2: no .bak after success');
});
test('C2 applied sync removes all four .bak files only after the ok report', async (t) => {
  const prepared = prepareVelocityConfig(liveShaped, liveServers, liveForcedHosts);
  const v = await realVelocityFiles(t, staleFiles); const order = [];
  const result = await runVelocitySync({ ...v.files, read: liveRead, applyJar: async () => false, restart: async () => { order.push('restart'); },
    report: async status => { order.push(`report ${status} with ${(await fsp.readdir(v.directory)).filter(name => name.endsWith('.bak')).length} .bak`); } }, { restartIfChanged: true });
  assert.equal(result.status, 'applied'); assert.equal(result.restarted, true); assert.equal(result.snapshotRetained, undefined);
  assert.deepEqual(order, ['restart', 'report ok with 4 .bak']);
  assert.equal(await fsp.readFile(nodePath.join(v.directory, 'velocity.toml'), 'utf8'), prepared.content);
  assert.equal(await fsp.readFile(nodePath.join(v.directory, 'forwarding.secret'), 'utf8'), `${prepared.secret}\n`);
  assert.deepEqual((await fsp.readdir(v.directory)).sort(), Object.keys(staleFiles).sort());
});
for (const stage of ['config', 'jar', 'secret', 'restart', 'metadata']) test(`C2 ${stage} failure restores files and keeps all four .bak snapshots`, async (t) => {
  const v = await realVelocityFiles(t, staleFiles); const reports = [];
  const adapter = { ...v.files, read: liveRead, applyJar: async () => false, restart: async () => {},
    report: async status => { reports.push(status); if (stage === 'metadata' && status === 'ok') throw new Error('injected metadata'); } };
  const method = { config: 'applyConfig', jar: 'applyJar', secret: 'applySecret', restart: 'restart' }[stage];
  if (method) adapter[method] = async () => { throw new Error(`injected ${stage}`); };
  await assert.rejects(runVelocitySync(adapter, { restartIfChanged: true }), error => error.stage === stage);
  assert.equal(reports.at(-1), 'error');
  for (const [name, bytes] of Object.entries(staleFiles)) {
    assert.deepEqual(await fsp.readFile(nodePath.join(v.directory, name)), Buffer.from(bytes));
    assert.deepEqual(await fsp.readFile(nodePath.join(v.directory, `${name}.bak`)), Buffer.from(bytes));
  }
});
test('C2 a .bak cleanup failure after the ok report neither rolls back nor reports an error', async () => {
  const f = fixture(); const discarded = [];
  f.adapter.discard = async snapshot => { discarded.push(snapshot); throw new Error('bak busy'); };
  const result = await runVelocitySync(f.adapter, { restartIfChanged: true });
  assert.equal(result.status, 'applied'); assert.equal(result.snapshotRetained, 'bak busy');
  assert.equal(f.calls.includes('restore'), false);
  assert.deepEqual(f.reports.map(report => report.status), ['ok']);
  assert.equal(discarded.length, 1);
});

for (const [version, binary] of binaries) test(`C1-C3 actual daemon: a settings event before settings load syncs unchanged without restart; a known restart_trigger change still restarts ${version}`, async (t) => {
  const { startOwned } = await import('./helpers/pocketbase.mjs');
  const directory = await fsp.mkdtemp(nodePath.join(tmpdir(), 'hololive-inc002-daemon-'));
  await fsp.mkdir(nodePath.join(directory, 'backend'));
  await fsp.cp(nodePath.join(root, 'backend/scripts'), nodePath.join(directory, 'backend/scripts'), { recursive: true });
  await fsp.writeFile(nodePath.join(directory, 'package.json'), '{"type":"module"}');
  await fsp.symlink(nodePath.join(root, 'node_modules'), nodePath.join(directory, 'node_modules'));
  const guard = nodePath.join(directory, 'backend/.velocity-maintenance');
  await fsp.writeFile(guard, 'isolated deployment guard');
  const velocity = nodePath.join(directory, 'velocity'); await fsp.mkdir(velocity);
  const bin = nodePath.join(directory, 'bin'); await fsp.mkdir(bin);
  const controls = nodePath.join(directory, 'control.log');
  // systemctl refuses everything (as with the RefuseManualStop leaf); unzip reports a fixture manifest version.
  await fsp.writeFile(nodePath.join(bin, 'systemctl'), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$CONTROL_LOG"\nexit 99\n', { mode: 0o755 });
  await fsp.writeFile(nodePath.join(bin, 'unzip'), '#!/bin/sh\nprintf "Manifest-Version: 1.0\\nImplementation-Version: 3.5.0-fixture\\n"\n', { mode: 0o755 });
  const f = await serviceFixture(binary); let daemon, passed = false;
  try {
    const admin = (route, options = {}) => f.database.request(route, { token: f.database.token, ...options });
    const listing = await admin('/api/collections/velocity_settings/records'); assert.equal(listing.status, 200);
    const id = listing.data.items[0].id, recordRoute = '/api/collections/velocity_settings/records/' + id;
    const configured = await admin(recordRoute, { method: 'PATCH', body: { bind_port: '25565', query_port: 25577, connection_timeout: 0, read_timeout: 0, player_info_forwarding_mode: '', ping_passthrough: '', forwarding_secret: 'isolated-secret' } });
    assert.equal(configured.status, 200, JSON.stringify(configured));
    assert.deepEqual([configured.data.compression_threshold, configured.data.compression_level, configured.data.login_ratelimit], [256, -1, 3000], 'D1 replaced the fresh placeholder triple');
    const jar = Buffer.concat([Buffer.from([0x50, 0x4b, 3, 4]), Buffer.from('isolated JAR stand-in')]);
    const form = new FormData(); form.append('velocity_jar', new Blob([jar]), 'velocity-fixture.jar');
    const upload = await fetch(f.database.url + recordRoute, { method: 'PATCH', headers: { Authorization: f.database.token }, body: form });
    const uploaded = await upload.json(); assert.equal(upload.status, 200, JSON.stringify(uploaded)); assert.match(uploaded.velocity_jar, /\.jar$/);
    const server = await f.record('velocity_servers', { name: 'lobby', address: '127.0.0.1:25568', is_try_server: true, try_order: 1 });
    await f.record('velocity_forced_hosts', { hostname: 'play.example.invalid', server: server.id });
    const input = await createVelocityPocketBase({ pb: f.pb, email: f.service.email, password: f.password }).read();
    assert.equal(typeof input.forcedHosts[0].server, 'string', 'single forced-host relation');
    const prepared = prepareVelocityConfig(input.settings, input.servers, input.forcedHosts);
    assert.match(prepared.content, /^connection-timeout = 0$/m); assert.match(prepared.content, /^read-timeout = 0$/m);
    const originals = { 'velocity.toml': prepared.content, 'velocity.jar': jar, 'forwarding.secret': `${prepared.secret}\n`, '.velocity_jar_ref': `${input.settings.id}:${input.settings.velocity_jar}\n` };
    for (const [file, bytes] of Object.entries(originals)) await fsp.writeFile(nodePath.join(velocity, file), bytes, { mode: file === 'forwarding.secret' ? 0o600 : 0o644 });
    const identity = async () => Object.fromEntries(await Promise.all(Object.keys(originals).map(async file => [file, { ino: (await fsp.stat(nodePath.join(velocity, file))).ino, bytes: await fsp.readFile(nodePath.join(velocity, file)) }])));
    const before = await identity();
    const restarts = async () => {
      try { return (await fsp.readFile(controls, 'utf8')).split('\n').filter(line => line.startsWith('restart')); }
      catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    };
    const record = async () => (await admin(recordRoute)).data;
    daemon = await startOwned(process.execPath, [nodePath.join(directory, 'backend/scripts/sync_velocity.js')], {
      PB_URL: f.database.url, PB_EMAIL: f.service.email, PB_PASS: f.password, VELOCITY_DIR: velocity,
      VELOCITY_OWNER: `${process.getuid()}:${process.getgid()}`, PATH: bin + nodePath.delimiter + process.env.PATH, CONTROL_LOG: controls,
    });
    const until = async (predicate, message) => {
      for (let i = 0; i < 200; i++) {
        if (await predicate()) return;
        if (daemon.child.exitCode !== null) throw new Error(daemon.output());
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      throw new Error(`${message}\n${daemon.output()}`);
    };
    await until(() => daemon.output().includes('Watching for changes'), 'daemon did not start');
    // Guarded start: settings were never loaded. Release the guard, then deliver a settings event.
    await fsp.rm(guard);
    assert.equal((await admin(recordRoute, { method: 'PATCH', body: { restart_trigger: new Date().toISOString() } })).status, 200);
    await until(async () => (await record()).last_sync_status !== '', 'settings event produced no sync');
    const synced = await record();
    assert.equal(synced.last_sync_status, 'ok', synced.last_sync_error);
    assert.equal(synced.last_applied_hash, sha256(prepared.content));
    assert.equal(synced.jar_version, '3.5.0-fixture');
    await until(async () => !(await fsp.readdir(velocity)).some(name => name.endsWith('.bak')), 'C2: .bak files remained after success');
    assert.match(daemon.output(), /Config change detected before settings were loaded\. Syncing without forced restart/);
    assert.doesNotMatch(daemon.output(), /Restarting Velocity service|velocity\.jar updated|\[Sync\] Failed/);
    assert.deepEqual(await identity(), before, 'no download or file swap');
    assert.deepEqual((await fsp.readdir(velocity)).sort(), Object.keys(originals).sort());
    assert.deepEqual(await restarts(), []);
    // Negative: with settings loaded, a changed restart_trigger is a known request and still forces a restart.
    assert.equal((await admin(recordRoute, { method: 'PATCH', body: { restart_trigger: new Date(Date.now() + 60000).toISOString() } })).status, 200);
    await until(async () => (await record()).last_sync_status === 'error', 'known restart_trigger change did not run');
    assert.match((await record()).last_sync_error, /^Velocity restart: /);
    assert.deepEqual(await restarts(), ['restart velocity']);
    for (const [file, bytes] of Object.entries(originals)) {
      assert.deepEqual(await fsp.readFile(nodePath.join(velocity, file)), Buffer.from(bytes));
      assert.deepEqual(await fsp.readFile(nodePath.join(velocity, `${file}.bak`)), Buffer.from(bytes), 'C2: refused restart keeps .bak');
    }
    passed = true;
  } finally {
    try { if (daemon) await daemon.close(); } finally { await f.close(); }
    if (passed) await fsp.rm(directory, { recursive: true, force: true });
    else t.diagnostic('retained daemon evidence: ' + directory);
  }
});
