import test from 'node:test';
import path from 'node:path';
import assert from 'node:assert/strict';
import http from 'node:http';
import PocketBase from 'pocketbase';
import { createAdminSession } from '../src/lib/adminSession.js';
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

for (const [version, binary] of binaries) test(`SDK session concurrency and invalidation ${version}`, async () => {
  const server = await pocketbase(binary, migrations);
  let release;
  let arrived;
  let pause = false;
  let refreshes = 0;
  const proxy = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const response = await fetch(server.url + req.url, {
      method: req.method, headers: { 'Content-Type': 'application/json', Authorization: req.headers.authorization || '' },
      ...(req.method === 'POST' ? { body: Buffer.concat(chunks) } : {}),
    });
    const body = await response.text();
    if (req.url.endsWith('/auth-refresh')) {
      refreshes += 1;
      if (pause) { arrived(); await new Promise(resolve => { release = resolve; }); }
    }
    res.writeHead(response.status, { 'Content-Type': 'application/json' }); res.end(body);
  });
  await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
  const client = new PocketBase(`http://127.0.0.1:${proxy.address().port}`);
  const refresh = createAdminSession(client);
  const password = 'Disposable-User-2026!';
  try {
    const users = [];
    for (const email of ['first@example.invalid', 'second@example.invalid']) {
      const response = await server.request('/api/collections/users/records', { method: 'POST', token: server.token,
        body: { email, password, passwordConfirm: password, verified: true, is_admin: true } });
      assert.equal(response.status, 200); users.push(response.data);
    }
    const login = async user => {
      const response = await server.request('/api/collections/users/auth-with-password', { method: 'POST', body: { identity: user.email, password } });
      assert.equal(response.status, 200); client.authStore.save(response.data.token, response.data.record);
    };
    await login(users[0]);
    const a = refresh(), b = refresh(); assert.equal(a, b);
    assert.equal((await a).record.id, users[0].id); assert.equal((await b).record.id, users[0].id);
    assert.equal(refreshes, 1);
    await refresh(); assert.equal(refreshes, 2, 'settled verification must not be cached');

    // The upstream really returned 200; delay only its delivery to the SDK.
    const waitForResponse = () => new Promise(resolve => { pause = true; arrived = resolve; });
    let received = waitForResponse();
    const beforeLogout = refresh();
    const logoutRejected = assert.rejects(beforeLogout, { code: 'SESSION_CHANGED' });
    await received; client.authStore.clear(); release(); await logoutRejected;
    assert.equal(client.authStore.token, ''); assert.equal(client.authStore.record, null);

    pause = false; await login(users[0]); received = waitForResponse();
    const beforeNewLogin = refresh();
    const changedRejected = assert.rejects(beforeNewLogin, { code: 'SESSION_CHANGED' });
    await received; await login(users[1]); const newToken = client.authStore.token;
    release(); await changedRejected;
    assert.equal(client.authStore.record.id, users[1].id); assert.equal(client.authStore.token, newToken);

    pause = false;
    await server.request('/api/collections/users/records/' + users[1].id, { method: 'PATCH', token: server.token, body: { is_admin: false } });
    await assert.rejects(refresh()); assert.equal(client.authStore.token, '');
    client.authStore.save('invalid-expired-token', users[0]);
    await assert.rejects(refresh()); assert.equal(client.authStore.token, '');
    await login(users[0]);
    client.baseURL = `http://127.0.0.1:${await unusedPort()}`;
    await assert.rejects(refresh()); assert.equal(client.authStore.token, '', 'network failure cannot verify cached identity');
  } finally {
    release?.(); proxy.closeAllConnections(); await new Promise(resolve => proxy.close(resolve)); await server.close();
  }
});
