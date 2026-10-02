import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { gzipSync, brotliCompressSync } from 'node:zlib';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { startOwned, unusedPort, waitFor, root } from './helpers/pocketbase.mjs';
const listen = server => new Promise(r => server.listen(0, '127.0.0.1', r));
const close = server => new Promise(r => server.close(r));
function raw(url, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method }, res => { const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, bytes: Buffer.concat(chunks) })); }); req.on('error', reject); req.end();
  });
}
test('gzip, br and plain HTML/resource headers describe delivered bytes and redirects fail closed', async () => {
  const upstream = http.createServer((req, res) => {
    if (req.url === '/redirect') { res.writeHead(302, { Location: 'https://unknown.example.invalid/' }); res.end(); return; }
    const html = req.url.includes('html');
    const content = Buffer.from(html ? '<html><head></head><body><a href="/tile">map</a></body></html>' : 'map tile resource ✓');
    const encoding = req.url.includes('gzip') ? 'gzip' : req.url.includes('br') ? 'br' : '';
    const bytes = encoding === 'gzip' ? gzipSync(content) : encoding === 'br' ? brotliCompressSync(content) : content;
    res.writeHead(200, { 'Content-Type': html ? 'text/html' : 'text/plain', ...(encoding ? { 'Content-Encoding': encoding } : {}), 'Content-Length': bytes.length, 'Access-Control-Allow-Origin': '*', ETag: '"raw"' }); res.end(bytes);
  });
  await listen(upstream); const origin = `http://127.0.0.1:${upstream.address().port}`;
  const pb = http.createServer((_req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ items: [{ url: origin }], totalPages: 1 })); }); await listen(pb);
  const port = await unusedPort();
  const service = await startOwned(process.execPath, [path.join(root, 'backend/scripts/map_proxy.js')], { PB_URL: `http://127.0.0.1:${pb.address().port}`, MAP_PROXY_PORT: String(port), MAP_PROXY_LOG_LEVEL: 'error' });
  try {
    await waitFor(`http://127.0.0.1:${port}/`, service);
    const prefix = `http://127.0.0.1:${port}/http/127.0.0.1:${upstream.address().port}`;
    for (const encoding of ['gzip', 'br', 'plain']) for (const type of ['html', 'resource']) {
      const response = await raw(`${prefix}/sub/${encoding}-${type}`);
      assert.equal(response.status, 200);
      assert.equal(response.headers['content-encoding'], undefined);
      assert.equal(response.headers.etag, undefined);
      assert.equal(response.headers['access-control-allow-origin'], '*');
      assert.match(response.headers['content-security-policy'], /^sandbox /);
      assert.doesNotMatch(response.headers['content-security-policy'], /allow-same-origin/);
      const text = response.bytes.toString('utf8');
      if (type === 'html') {
        assert.match(text, /<base href="\/map-proxy\/http\/127\.0\.0\.1:\d+\/sub\/">/);
        assert.match(text, /href="\/map-proxy\/http\/127\.0\.0\.1:\d+\/tile"/);
        assert.equal(Number(response.headers['content-length']), response.bytes.length);
      } else assert.equal(text, 'map tile resource ✓');
    }
    const head = await raw(`${prefix}/gzip-html`, 'HEAD'); assert.equal(head.bytes.length, 0); assert.equal(head.headers['content-encoding'], undefined);
    assert.equal((await raw(`${prefix}/redirect`)).status, 403);
    assert.equal((await raw(`http://127.0.0.1:${port}/https/unknown.example.invalid/`)).status, 403);
    const source = await readFile(path.join(root, 'src/pages/ServerInfo.jsx'), 'utf8');
    assert.equal((source.match(/sandbox="allow-scripts allow-forms allow-pointer-lock allow-downloads"/g) || []).length, 2);
  } finally { await service.close(); await close(pb); await close(upstream); }
});
