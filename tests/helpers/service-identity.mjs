import { readdir } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import PocketBase from 'pocketbase';
import { EventSource } from 'eventsource';
import { pocketbase, root } from './pocketbase.mjs';
globalThis.EventSource = EventSource;
export async function serviceFixture(binary) {
  const names = (await readdir(path.join(root, 'backend/pb_migrations'))).filter(name => name.endsWith('.js'));
  const database = await pocketbase(binary, names);
  const password = 'Disposable-Service-2026!';
  const create = async (email, extra = {}) => {
    const response = await database.request('/api/collections/users/records', { token: database.token, method: 'POST', body: { email, password, passwordConfirm: password, ...extra } });
    assert.equal(response.status, 200, JSON.stringify(response)); return response.data;
  };
  const service = await create('service@example.invalid', { is_admin: true, service_account: true });
  const human = await create('human@example.invalid', { is_admin: true, verified: true });
  const ordinary = await create('ordinary@example.invalid', { verified: true });
  const settings = await database.request('/api/collections/system_settings/records', { token: database.token });
  assert.equal((await database.request('/api/collections/system_settings/records/' + settings.data.items[0].id, { token: database.token, method: 'PATCH', body: { enable_local_login: false } })).status, 200);
  const pb = new PocketBase(database.url); pb.autoCancellation(false);
  return { database, pb, password, service, human, ordinary,
    async changeUser(user, body) { const response = await database.request('/api/collections/users/records/' + user.id, { token: database.token, method: 'PATCH', body }); assert.equal(response.status, 200); },
    async record(collection, body) { const response = await database.request(`/api/collections/${collection}/records`, { token: database.token, method: 'POST', body }); assert.equal(response.status, 200, JSON.stringify(response)); return response.data; },
    async close() { await pb.realtime.unsubscribe(); await database.close(); },
  };
}
