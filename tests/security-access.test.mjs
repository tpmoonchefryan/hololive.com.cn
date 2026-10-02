import test from 'node:test';
import path from 'node:path';
import assert from 'node:assert/strict';
import { binaries, pocketbase, startOwned, unusedPort, waitFor, root } from './helpers/pocketbase.mjs';
import { verifyAdminAuth } from '../backend/scripts/lib/admin-auth.js';
const migrations = ['1690000000_init_schema.js', '1710000000_initial_data.js', '1765100011_mcsm_config.js', '1790000000_schema_security_server_admin_authorization.js'];
for (const [version, binary] of binaries) test(`server authorization ${version}`, async () => {
  const pb = await pocketbase(binary, migrations);
  const proxies = [];
  try {
    const request = pb.request;
    const record = (collection, body, token = pb.token) => request(`/api/collections/${collection}/records`, { method: 'POST', token, body });
    const publicSettings = await request('/api/collections/system_settings/records');
    assert.equal(publicSettings.data.items.length, 1);
    const password = 'Disposable-User-2026!';
    const createUser = async (email, extra) => {
      const response = await record('users', { email, password, passwordConfirm: password, ...extra });
      assert.equal(response.status, 200, JSON.stringify(response)); return response.data;
    };
    const login = identity => request('/api/collections/users/auth-with-password', { method: 'POST', body: { identity, password } });
    const ordinary = await createUser('ordinary@example.invalid', { verified: true });
    const admin = await createUser('admin@example.invalid', { verified: true, is_admin: true });
    const service = await createUser('service@example.invalid', { is_admin: true, service_account: true });
    const impostor = await createUser('claim@example.invalid', { is_admin: true });
    assert.notEqual((await record('users', { email: 'signup@example.invalid', password, passwordConfirm: password }, '')).status, 200);
    const impersonation = await request(`/api/collections/users/impersonate/${ordinary.id}`, { token: pb.token, method: 'POST', body: { duration: 600 } });
    assert.equal(impersonation.status, 200, JSON.stringify(impersonation));
    const ordinaryToken = impersonation.data.token;
    assert.equal(await verifyAdminAuth(pb.url, ordinaryToken), false);
    for (const collection of ['posts', 'whitelists', 'server_maps', 'cms_sections']) {
      assert.notEqual((await record(collection, { email: ordinary.email, title: { zh: 'denied' }, content: { zh: '<p>x</p>' } }, ordinaryToken)).status, 200);
    }
    assert.notEqual((await request('/api/collections/users/records/' + admin.id, { method: 'PATCH', token: ordinaryToken, body: { is_admin: true, verified: true } })).status, 200);
    assert.notEqual((await login(ordinary.email)).status, 200);
    assert.notEqual((await login(impostor.email)).status, 200);
    const adminLogin = await login(admin.email); assert.equal(adminLogin.status, 200, JSON.stringify(adminLogin));
    const token = adminLogin.data.token;
    const visibleAccounts = await request('/api/collections/users/records', { token });
    assert.deepEqual(visibleAccounts.data.items.map(item => item.id), [admin.id]);
    assert.notEqual((await record('users', { email: 'created-by-admin@example.invalid', password, passwordConfirm: password }, token)).status, 200);
    assert.notEqual((await request('/api/collections/users/records/' + admin.id, { token, method: 'PATCH', body: { service_account: true } })).status, 200);
    assert.notEqual((await request('/api/collections/users/records/' + ordinary.id, { token, method: 'DELETE' })).status, 200);
    for (const [file, portEnv, route, admittedStatus] of [['mcsm_proxy.js', 'MCSM_PROXY_PORT', '/admin/overview', 503], ['ai_translate_proxy.js', 'AI_TRANSLATE_PROXY_PORT', '/admin/unknown', 404]]) {
      const port = await unusedPort();
      const proxy = await startOwned(process.execPath, [path.join(root, 'backend/scripts', file)], { PB_URL: pb.url, [portEnv]: String(port), MCSM_PROXY_LOG_LEVEL: 'error', AI_TRANSLATE_PROXY_LOG_LEVEL: 'error' });
      proxies.push({ ...proxy, url: `http://127.0.0.1:${port}${route}`, admittedStatus });
      await waitFor(`http://127.0.0.1:${port}/`, proxy);
      assert.equal((await fetch(proxies.at(-1).url)).status, 401);
      assert.equal((await fetch(proxies.at(-1).url, { headers: { Authorization: ordinaryToken } })).status, 401);
      assert.equal((await fetch(proxies.at(-1).url, { headers: { Authorization: token } })).status, admittedStatus);
    }
    assert.equal(await verifyAdminAuth(pb.url, token), true);
    assert.equal(await verifyAdminAuth(pb.url, ''), false);
    const draft = await record('posts', { title: { zh: 'draft' }, content: { zh: '<p>draft</p>' }, is_public: false }, token);
    assert.equal(draft.status, 200, JSON.stringify(draft));
    const published = await record('posts', { title: { zh: 'public' }, content: { zh: '<p>public</p>' }, is_public: true }, token);
    assert.equal(published.status, 200);
    assert.equal((await request('/api/collections/posts/records/' + draft.data.id)).status, 404);
    const list = await request('/api/collections/posts/records'); assert.deepEqual(list.data.items.map(x => x.id), [published.data.id]);
    assert.equal((await request('/api/collections/posts/records/' + published.data.id)).status, 200);
    assert.equal((await request('/api/collections/posts/records/' + draft.data.id, { token })).status, 200);
    assert.notEqual((await request('/api/collections/users/records/' + ordinary.id, { method: 'PATCH', token, body: { is_admin: true } })).status, 200);
    const settings = await request('/api/collections/system_settings/records', { token: pb.token });
    assert.equal((await request('/api/collections/system_settings/records/' + settings.data.items[0].id, { method: 'PATCH', token: pb.token, body: { enable_local_login: false } })).status, 200);
    assert.notEqual((await login(admin.email)).status, 200);
    const serviceLogin = await login(service.email); assert.equal(serviceLogin.status, 200);
    for (const proxy of proxies) assert.equal((await fetch(proxy.url, { headers: { Authorization: serviceLogin.data.token } })).status, proxy.admittedStatus);
    assert.equal((await request('/api/collections/users/records/' + admin.id, { method: 'PATCH', token: pb.token, body: { is_admin: false } })).status, 200);
    assert.equal(await verifyAdminAuth(pb.url, token), false);
    for (const proxy of proxies) assert.equal((await fetch(proxy.url, { headers: { Authorization: token } })).status, 401);
    assert.notEqual((await record('posts', { title: { zh: 'denied' }, content: { zh: '<p>x</p>' } }, token)).status, 200);
    assert.notEqual((await record('whitelists', { email: admin.email }, token)).status, 200);
  } finally { for (const proxy of proxies) await proxy.close(); await pb.close(); }
});
test('Node authorization fails closed and rejects ordinary/self-claimed identities', async () => {
  for (const record of [{ collectionName: 'users', verified: true }, { collectionName: 'users', is_admin: true, verified: false }, { collectionName: '_superusers', is_admin: true, verified: true }]) {
    assert.equal(await verifyAdminAuth('http://fixture', 'token', async () => ({ ok: true, json: async () => ({ record }) })), false);
  }
  assert.equal(await verifyAdminAuth('http://fixture', 'token', async () => { throw new Error('offline'); }), false);
});
