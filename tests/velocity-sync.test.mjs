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
