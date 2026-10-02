import test from 'node:test';
import assert from 'node:assert/strict';
import { createMCSMClient } from '../src/lib/mcsmClient.js';
import { createConfigLoader } from '../backend/scripts/lib/mcsm-config.js';

for (const [http, status] of [[401, 401], [403, 403], [200, 500], [200, undefined]]) {
  test(`reject HTTP ${http} business ${status}`, async () => {
    const client = createMCSMClient({ origin: 'http://localhost', fetchImpl: async () => new Response(JSON.stringify({ status, data: 'failed' }), { status: http }) });
    let successful = false;
    await assert.rejects(client('/admin/files/write', { method: 'PUT', body: { content: 'keep' } }).then(() => { successful = true; }));
    assert.equal(successful, false);
  });
}
test('successful operations use shared transport and exact body', async () => {
  let captured;
  const client = createMCSMClient({ origin: 'http://localhost', token: () => 'admin-token', fetchImpl: async (url, options) => {
    captured = { url, options }; return Response.json({ status: 200, data: '' });
  }});
  assert.deepEqual(await client('/admin/files/read', { method: 'PUT', body: { target: 'a.txt' }, params: { uuid: 'a b' } }), { status: 200, data: '' });
  assert.equal(captured.url.searchParams.get('uuid'), 'a b');
  assert.equal(captured.options.headers.Authorization, 'admin-token');
  assert.deepEqual(JSON.parse(captured.options.body), { target: 'a.txt' });
});
test('network error and timeout reject without entering success', async () => {
  const offline = createMCSMClient({ origin: 'http://localhost', fetchImpl: async () => { throw new Error('network down'); } });
  await assert.rejects(offline('/admin/overview'), /network down/);
  const timeout = createMCSMClient({ origin: 'http://localhost', timeoutMs: 5, fetchImpl: (_url, { signal }) => new Promise((_resolve, reject) => {
    const keepAlive = setTimeout(() => {}, 20);
    signal.addEventListener('abort', () => { clearTimeout(keepAlive); reject(new Error('timeout')); });
  }) });
  await assert.rejects(timeout('/admin/overview'), /timeout/);
});
test('public cold start independently authenticates and configuration expiry revokes cache', async () => {
  let time = 0, enabled = true, denied = false, calls = [];
  const load = createConfigLoader({ pbUrl: 'http://pb', serviceEmail: 'fixture', servicePassword: 'fixture', now: () => time, ttlMs: 5,
    fetchImpl: async (url, options) => {
      calls.push(url);
      if (url.includes('auth-with-password')) return Response.json({ token: 'server-only' });
      assert.equal(options.headers.Authorization, 'server-only');
      if (denied) return new Response('{}', { status: 403 });
      return Response.json({ items: [{ enabled, panel_url: 'http://panel/', api_key: 'not-public' }] });
    } });
  assert.equal((await load()).enabled, true);
  assert.equal(calls.length, 2);
  await load(); assert.equal(calls.length, 2);
  time = 6; enabled = false; assert.equal((await load()).enabled, false);
  time = 12; denied = true; await assert.rejects(load(), /403/);
  denied = false; enabled = true; assert.equal((await load()).enabled, true);
});
test('missing service config and deleted config fail closed', async () => {
  await assert.rejects(createConfigLoader({ pbUrl: 'http://pb' })(), /service configuration/);
  const load = createConfigLoader({ pbUrl: 'http://pb', fetchImpl: async () => Response.json({ items: [] }) });
  await assert.rejects(load('admin'), /not found/);
});

test('real proxy public cold start, config revocation and upstream failures', async (t) => {
  const { createServer } = await import('node:http');
  const { spawn } = await import('node:child_process');
  const { once } = await import('node:events');
  let enabled = true, upstreamFailed = false;
  const upstream = createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    const data = upstreamFailed ? { status: 500, data: 'injected' } : { status: 200, data: req.url.startsWith('/api/overview') ? { remote: [] } : [] };
    res.end(JSON.stringify(data));
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const panel = `http://127.0.0.1:${upstream.address().port}`;
  const pb = createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url.includes('auth-with-password')) return res.end(JSON.stringify({ token: 'fixture-service' }));
    if (req.headers.authorization !== 'fixture-service') { res.statusCode = 403; return res.end('{}'); }
    res.end(JSON.stringify({ items: [{ enabled, panel_url: panel, api_key: 'fixture-secret', public_cache_ttl: 10000 }] }));
  });
  await new Promise(resolve => pb.listen(0, '127.0.0.1', resolve));
  const reserve = createServer(); await new Promise(resolve => reserve.listen(0, '127.0.0.1', resolve));
  const port = reserve.address().port; await new Promise(resolve => reserve.close(resolve));
  const child = spawn(process.execPath, ['backend/scripts/mcsm_proxy.js'], { cwd: new URL('..', import.meta.url), stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PB_URL: `http://127.0.0.1:${pb.address().port}`, PB_EMAIL: 'fixture', PB_PASS: 'fixture', MCSM_PROXY_PORT: String(port), MCSM_CONFIG_CACHE_TTL_MS: '1' } });
  t.after(async () => {
    if (child.exitCode === null) { const exited = once(child, 'exit'); child.kill(); await exited; }
    await new Promise(resolve => pb.close(resolve)); await new Promise(resolve => upstream.close(resolve));
  });
  let started = false;
  for (let i = 0; i < 50; i++) { try { const response = await fetch(`http://127.0.0.1:${port}/public/status`); if (response.status === 200) { const text = await response.text(); assert.doesNotMatch(text, /fixture-secret|fixture-service/); started = true; break; } } catch {} await new Promise(resolve => setTimeout(resolve, 10)); }
  assert.equal(started, true, 'cold start must work without admin request');
  enabled = false; await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal((await fetch(`http://127.0.0.1:${port}/public/status`)).status, 503);
  enabled = true; upstreamFailed = true; await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal((await fetch(`http://127.0.0.1:${port}/public/status`)).status, 500);
});
