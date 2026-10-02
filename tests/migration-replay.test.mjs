import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, copyFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pocketbase, binaries, root } from './helpers/pocketbase.mjs';
import { assertReplayState } from '../scripts/check_pb_replay.mjs';
const names = (await readdir(path.join(root, 'backend/pb_migrations'))).filter(x => x.endsWith('.js')).sort();
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
    const previous = names.filter(x => !x.startsWith('179000'));
    const pb = await pocketbase(binary, previous);
    try {
      const post = await pb.request('/api/collections/posts/records', { token: pb.token, method: 'POST', body: { title: { zh: 'preserved' }, content: { zh: '<p>preserved</p>' }, is_public: false } });
      assert.equal(post.status, 200);
      const user = await pb.request('/api/collections/users/records', { token: pb.token, method: 'POST', body: { email: 'upgrade@example.invalid', password: 'Disposable-Upgrade-2026!', passwordConfirm: 'Disposable-Upgrade-2026!', verified: true } }); assert.equal(user.status, 200);
      const velocity = await pb.request('/api/collections/velocity_settings/records', { token: pb.token });
      assert.equal(velocity.data.items.length, 1);
      const original = velocity.data.items[0];
      for (const name of names.filter(x => x.startsWith('179000'))) await copyFile(path.join(root, 'backend/pb_migrations', name), path.join(pb.migrations, name));
      await pb.restart();
      await verify(pb);
      const saved = await pb.request('/api/collections/posts/records/' + post.data.id, { token: pb.token }); assert.deepEqual(saved.data.title, post.data.title);
      const savedUser = await pb.request('/api/collections/users/records/' + user.data.id, { token: pb.token }); assert.equal(savedUser.data.email, user.data.email); assert.equal(savedUser.data.is_admin, false);
      const savedVelocity = await pb.request('/api/collections/velocity_settings/records/' + original.id, { token: pb.token });
      for (const key of ['motd', 'forwarding_secret', 'bind_port']) assert.equal(savedVelocity.data[key], original[key]);
      const before = history(pb); assert.equal(pb.run(['migrate', 'up']).status, 0); assert.deepEqual(history(pb), before);
    } finally { await pb.close(); }
  });
}
