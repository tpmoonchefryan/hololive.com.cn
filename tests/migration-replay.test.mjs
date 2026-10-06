import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pocketbase, binaries, root } from './helpers/pocketbase.mjs';
import { assertReplayState } from '../scripts/check_pb_replay.mjs';
const names = (await readdir(path.join(root, 'backend/pb_migrations'))).filter(x => x.endsWith('.js')).sort();
// TCRN-HOLOLIVE-CN-INC-002 D1: forward-only data alignment of the placeholder advanced triple.
const placeholderDefaults = '1791254033_data_velocity_replace_placeholder_advanced_zeros.js';
const advanced = data => ['compression_threshold', 'compression_level', 'login_ratelimit'].map(key => data[key]);
function history(pb) {
  const result = spawnSync('python3', ['-c', 'import sqlite3,json,sys;print(json.dumps([r[0] for r in sqlite3.connect(sys.argv[1]).execute("select file from _migrations")]))', path.join(pb.directory, 'data/data.db')], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr); return JSON.parse(result.stdout);
}
async function verify(pb) {
  const response = await pb.request('/api/collections?perPage=200', { token: pb.token });
  assert.equal(response.status, 200);
  assertReplayState(response.data.items, history(pb), names);
  return response.data.items;
}
for (const [version, binary] of binaries) {
  test(`original select definition fails ${version}`, async () => {
    const file = '1765100006_enhance_velocity_schema.js';
    const old = spawnSync('git', ['show', `b3020eff5247807c7ede72de0eafe16bab735aae:backend/pb_migrations/${file}`], { cwd: root, encoding: 'utf8' });
    assert.equal(old.status, 0);
    await assert.rejects(() => pocketbase(binary, names.filter(x => x !== '1765100000_schema_velocity_prepare_runtime_selects.js'), { [file]: old.stdout }), /values: cannot be blank/);
  });
  test(`complete empty database replay and failure injection ${version}`, async () => {
    const pb = await pocketbase(binary);
    try {
      const collections = await verify(pb);
      assert.throws(() => assertReplayState(collections.filter(c => c.name !== 'posts'), history(pb), names), /Missing collection/);
      assert.throws(() => assertReplayState(collections, history(pb).slice(0, 2), names), /Unapplied migration/);
      const corrupt = structuredClone(collections); corrupt.find(c => c.name === 'velocity_settings').fields.find(f => f.name === 'ping_passthrough').values = [];
      assert.throws(() => assertReplayState(corrupt, history(pb), names), /Invalid select/);
      const before = history(pb); const replay = pb.run(['migrate', 'up']); assert.equal(replay.status, 0, replay.stdout + replay.stderr);
      assert.deepEqual(history(pb), before);
    } finally { await pb.close(); }
  });
  test(`representative applied-history upgrade preserves data ${version}`, async () => {
    // Synthetic old installed database: canonical migrations before the new upgrades.
    const previous = names.filter(x => x < '1789999999');
    const pb = await pocketbase(binary, previous);
    try {
      const post = await pb.request('/api/collections/posts/records', { token: pb.token, method: 'POST', body: { title: { zh: 'preserved' }, content: { zh: '<p>preserved</p>' }, is_public: false } });
      assert.equal(post.status, 200);
      const user = await pb.request('/api/collections/users/records', { token: pb.token, method: 'POST', body: { email: 'upgrade@example.invalid', password: 'Disposable-Upgrade-2026!', passwordConfirm: 'Disposable-Upgrade-2026!', verified: true } }); assert.equal(user.status, 200);
      const velocity = await pb.request('/api/collections/velocity_settings/records', { token: pb.token });
      assert.equal(velocity.data.items.length, 1);
      const original = velocity.data.items[0];
      for (const name of names.filter(x => x >= '1789999999')) await copyFile(path.join(root, 'backend/pb_migrations', name), path.join(pb.migrations, name));
      await pb.restart();
      await verify(pb);
      const saved = await pb.request('/api/collections/posts/records/' + post.data.id, { token: pb.token }); assert.deepEqual(saved.data.title, post.data.title);
      const savedUser = await pb.request('/api/collections/users/records/' + user.data.id, { token: pb.token }); assert.equal(savedUser.data.email, user.data.email); assert.equal(savedUser.data.is_admin, false);
      const savedVelocity = await pb.request('/api/collections/velocity_settings/records/' + original.id, { token: pb.token });
      for (const key of ['motd', 'forwarding_secret', 'bind_port']) assert.equal(savedVelocity.data[key], original[key]);
      assert.deepEqual(advanced(original), [0, 0, 0]); assert.deepEqual(advanced(savedVelocity.data), [256, -1, 3000], 'placeholder triple aligned');
      const before = history(pb); assert.equal(pb.run(['migrate', 'up']).status, 0); assert.deepEqual(history(pb), before);
    } finally { await pb.close(); }
  });
}

// Reproduce observed schema with anonymous records, never a live data export.
const reconcile = '1789999999_schema_velocity_reconcile_observed_legacy.js';
const observed = `migrate((app) => {
  const c = app.findCollectionByNameOrId('velocity_settings');
  for (const name of ['player_info_forwarding_mode','ping_passthrough']) c.fields.removeByName(name);
  app.save(c);
  for (const name of ['player_info_forwarding_mode','ping_passthrough']) c.fields.add(new TextField({name}));
  for (const name of ['compression_threshold','compression_level','login_ratelimit']) c.fields.removeByName(name);
  app.save(c);
}, () => {});`;
for (const [version, binary] of binaries) {
  for (const invalid of [false, 'selection', 'type', 'number']) test(`observed legacy reconciliation ${invalid || 'legal'} ${version}`, async () => {
    const previous = names.filter(name => name < reconcile);
    const setup = '1789999998_observed_fixture.js';
    let source = observed;
    if (invalid === 'type') source = source.replace("new TextField({name})", "name === 'player_info_forwarding_mode' ? new BoolField({name}) : new TextField({name})");
    const pb = await pocketbase(binary, previous, { [setup]: source });
    try {
      const listing = await pb.request('/api/collections/velocity_settings/records', {token:pb.token});
      const record = listing.data.items[0];
      if (invalid !== 'type') {
        const saved = await pb.request('/api/collections/velocity_settings/records/'+record.id, {token:pb.token,method:'PATCH',body:{player_info_forwarding_mode: invalid === 'selection' ? 'unknown-mode' : 'legacy',ping_passthrough:'ALL',connection_timeout: invalid === 'number' ? 700000 : 4321}});
        assert.equal(saved.status,200,JSON.stringify(saved));
      }
      const beforeHistory = history(pb);
      const before = await pb.request('/api/collections/velocity_settings/records/'+record.id,{token:pb.token});
      for (const file of names.filter(name => name >= reconcile && name < placeholderDefaults)) await copyFile(path.join(root,'backend/pb_migrations',file),path.join(pb.migrations,file));
      const result = pb.run(['migrate','up']);
      if (invalid) {
        assert.match(result.stdout+result.stderr,/Unsupported legacy|Invalid legacy/);
        assert.deepEqual(history(pb),beforeHistory,'failed migration must not append ledger');
        const after = await pb.request('/api/collections/velocity_settings/records/'+record.id,{token:pb.token});
        assert.deepEqual(after.data,before.data,'rejected transaction preserves record');
      } else {
        assert.equal(result.status,0,result.stdout+result.stderr); assert.doesNotMatch(result.stdout+result.stderr,/Failed|Error:/);
        await pb.restart();
        const reconciled = await pb.request('/api/collections/velocity_settings/records/'+record.id,{token:pb.token});
        for (const key of ['compression_threshold','compression_level','login_ratelimit']) assert.equal(reconciled.data[key],0,'missing value remains unconfigured');
        // D1 then replaces the all-zero placeholder triple; every other value is preserved.
        await copyFile(path.join(root,'backend/pb_migrations',placeholderDefaults),path.join(pb.migrations,placeholderDefaults));
        const aligned = pb.run(['migrate','up']); assert.equal(aligned.status,0,aligned.stdout+aligned.stderr); assert.doesNotMatch(aligned.stdout+aligned.stderr,/Failed|Error:/);
        await pb.restart(); await verify(pb);
        const after = await pb.request('/api/collections/velocity_settings/records/'+record.id,{token:pb.token});
        for (const key of ['id','motd','forwarding_secret','bind_port','player_info_forwarding_mode','ping_passthrough','connection_timeout']) assert.deepEqual(after.data[key],before.data[key],key);
        assert.deepEqual(advanced(after.data),[256,-1,3000],'placeholder triple aligned');
        assert.ok(history(pb).includes(setup));
        const applied=history(pb);assert.equal(pb.run(['migrate','up']).status,0);assert.deepEqual(history(pb),applied);
      }
    } finally { await pb.close(); }
  });
}

// D1 on a complete history: only the all-zero triple changes; configured records and a re-run stay untouched.
for (const [version, binary] of binaries) test(`placeholder advanced zeros become 256/-1/3000, non-zero records untouched, re-run no-op ${version}`, async () => {
  const pb = await pocketbase(binary, names.filter(name => name < placeholderDefaults));
  try {
    const route = '/api/collections/velocity_settings/records';
    const byId = async id => { const response = await pb.request(route + '/' + id, { token: pb.token }); assert.equal(response.status, 200); return response.data; };
    const listing = await pb.request(route, { token: pb.token }); assert.equal(listing.data.items.length, 1);
    const placeholder = listing.data.items[0];
    assert.deepEqual(advanced(placeholder), [0, 0, 0]);
    const configured = [];
    for (const [compression_threshold, compression_level, login_ratelimit] of [[512, 0, 0], [0, -1, 0], [0, 0, 1000]]) {
      const created = await pb.request(route, { token: pb.token, method: 'POST', body: { bind_port: '25577', motd: `configured ${compression_threshold}/${compression_level}/${login_ratelimit}`, max_players: 50, forwarding_secret: 'disposable-secret', compression_threshold, compression_level, login_ratelimit } });
      assert.equal(created.status, 200, JSON.stringify(created)); configured.push(created.data);
    }
    await copyFile(path.join(root, 'backend/pb_migrations', placeholderDefaults), path.join(pb.migrations, placeholderDefaults));
    const result = pb.run(['migrate', 'up']);
    assert.equal(result.status, 0, result.stdout + result.stderr); assert.doesNotMatch(result.stdout + result.stderr, /Failed|Error:/);
    assert.ok(history(pb).includes(placeholderDefaults));
    const aligned = await byId(placeholder.id);
    assert.deepEqual(advanced(aligned), [256, -1, 3000]);
    for (const key of Object.keys(placeholder)) if (!['compression_threshold', 'compression_level', 'login_ratelimit', 'updated'].includes(key)) assert.deepEqual(aligned[key], placeholder[key], key);
    for (const record of configured) assert.deepEqual(await byId(record.id), record, 'record with a non-zero member untouched (not saved)');
    const ledger = history(pb); assert.equal(pb.run(['migrate', 'up']).status, 0); assert.deepEqual(history(pb), ledger);
    // The same up function again under a disposable name must change and save nothing.
    const rerun = '9999999999_placeholder_rerun_fixture.js';
    await writeFile(path.join(pb.migrations, rerun), await readFile(path.join(root, 'backend/pb_migrations', placeholderDefaults), 'utf8'));
    const again = pb.run(['migrate', 'up']);
    assert.equal(again.status, 0, again.stdout + again.stderr); assert.doesNotMatch(again.stdout + again.stderr, /Failed|Error:/);
    assert.ok(history(pb).includes(rerun));
    assert.deepEqual(await byId(placeholder.id), aligned, 're-run is a no-op');
    for (const record of configured) assert.deepEqual(await byId(record.id), record);
  } finally { await pb.close(); }
});
