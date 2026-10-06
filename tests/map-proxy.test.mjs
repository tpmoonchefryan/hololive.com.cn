import test from 'node:test';
import vm from 'node:vm';
import { MAP_ESCAPE_BRIDGE, MAP_ESCAPE_MESSAGE, MAP_SANDBOX_COMPAT, injectMapEscapeBridge } from '../backend/scripts/lib/map-embed-bridge.js';
import assert from 'node:assert/strict';
import http from 'node:http';
import { gzipSync, brotliCompressSync } from 'node:zlib';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { startOwned, unusedPort, waitFor, root } from './helpers/pocketbase.mjs';
const listen = server => new Promise(r => server.listen(0, '127.0.0.1', r));
const close = server => new Promise(r => server.close(r));
function raw(url, method = 'GET', headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method, headers }, res => { const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, bytes: Buffer.concat(chunks) })); }); req.on('error', reject); req.end();
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
        assert.match(text, /data-hololive-map-escape/);
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

test('minimal bridge sends only the fixed Escape notification and has no inbound capabilities', () => {
  let listener; const messages = [];
  const parent = { postMessage: (...args) => messages.push(args) };
  const window = { parent };
  const document = { addEventListener: (type, callback, capture) => { assert.equal(type, 'keydown'); assert.equal(capture, true); listener = callback; } };
  vm.runInNewContext(MAP_ESCAPE_BRIDGE.replace(/<script[^>]*>|<\/script>/g, ''), { window, document });
  listener({ key: 'Enter' }); assert.equal(messages.length, 0);
  listener({ key: 'Escape' }); assert.equal(messages.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(messages[0][0])), MAP_ESCAPE_MESSAGE);
  assert.equal(messages[0][1], '*');
  window.parent = window; listener({ key: 'Escape' }); assert.equal(messages.length, 1);
  assert.match(injectMapEscapeBridge('<html><body>map</body></html>'), /^<script data-hololive-map-escape>/);
});

const SANDBOX_CSP = 'sandbox allow-scripts allow-forms allow-pointer-lock allow-downloads';
const headerList = value => `${value || ''}`.split(',').map(name => name.trim().toLowerCase()).filter(Boolean);

test('sandboxed map gets the compatibility shim before Dynmap scripts, answered preflights and no site credentials', async () => {
  const seen = [];
  const upstream = http.createServer((req, res) => {
    seen.push({ method: req.method, url: req.url, headers: req.headers });
    if (req.url === '/up/configuration') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"worlds":[]}'); return; }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<!DOCTYPE html>\n<html lang="en">\n<head>\n\t<title>Minecraft Dynamic Map</title>\n\t<script type="text/javascript" src="js/jquery-1.11.0.js"></script>\n\t<script type="text/javascript" src="js/map.js"></script>\n</head>\n<body><div id="mcmap"></div></body>\n</html>');
  });
  await listen(upstream); const origin = `http://127.0.0.1:${upstream.address().port}`;
  const pb = http.createServer((_req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ items: [{ url: origin }], totalPages: 1 })); }); await listen(pb);
  const port = await unusedPort();
  const service = await startOwned(process.execPath, [path.join(root, 'backend/scripts/map_proxy.js')], { PB_URL: `http://127.0.0.1:${pb.address().port}`, MAP_PROXY_PORT: String(port), MAP_PROXY_LOG_LEVEL: 'error' });
  const credentials = { Cookie: 'pb_auth=site-session', Authorization: 'Bearer site-token', 'X-Requested-With': 'XMLHttpRequest' };
  try {
    await waitFor(`http://127.0.0.1:${port}/`, service);
    const prefix = `http://127.0.0.1:${port}/map-proxy/http/127.0.0.1:${upstream.address().port}`;
    const page = await raw(`${prefix}/`, 'GET', { ...credentials, Accept: 'text/html' });
    assert.equal(page.status, 200);
    assert.equal(page.headers['content-security-policy'], SANDBOX_CSP);
    assert.doesNotMatch(page.headers['content-security-policy'], /allow-same-origin/);
    assert.equal(page.headers['access-control-allow-origin'], '*');
    assert.equal(page.headers['access-control-allow-credentials'], undefined);
    const html = page.bytes.toString('utf8');
    const bridge = html.indexOf('<script data-hololive-map-escape>');
    const compat = html.indexOf(MAP_SANDBOX_COMPAT);
    const firstUpstreamScript = html.search(/<script(?! data-hololive-map-)/);
    assert.ok(bridge > html.indexOf('<head>') && compat === bridge + MAP_ESCAPE_BRIDGE.length, 'shim follows the Escape bridge at the start of <head>');
    assert.ok(firstUpstreamScript > compat, 'shim runs before every upstream script');
    assert.equal(html.split('data-hololive-map-sandbox-compat').length, 2);

    const preflight = await raw(`${prefix}/up/configuration`, 'OPTIONS', { Origin: 'null', 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'x-requested-with' });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers['access-control-allow-origin'], '*');
    assert.ok(headerList(preflight.headers['access-control-allow-headers']).includes('x-requested-with'));
    assert.ok(headerList(preflight.headers['access-control-allow-methods']).includes('get'));
    for (const name of ['authorization', 'cookie']) assert.ok(!headerList(preflight.headers['access-control-allow-headers']).includes(name), `${name} is never allowed`);
    assert.equal(preflight.headers['access-control-allow-credentials'], undefined);

    const configuration = await raw(`${prefix}/up/configuration`, 'GET', { ...credentials, Accept: 'application/json' });
    assert.equal(configuration.status, 200);
    assert.equal(configuration.bytes.toString('utf8'), '{"worlds":[]}');
    assert.deepEqual(seen.map(({ method, url }) => `${method} ${url}`), ['GET /', 'GET /up/configuration'], 'preflights are answered by the proxy');
    for (const { headers } of seen) {
      for (const name of ['cookie', 'authorization', 'x-requested-with']) assert.equal(headers[name], undefined, `${name} is not forwarded`);
    }
    assert.deepEqual(seen.map(({ headers }) => headers.accept), ['text/html', 'application/json']);
    const source = await readFile(path.join(root, 'src/pages/ServerInfo.jsx'), 'utf8');
    assert.doesNotMatch(source, /allow-same-origin/);
    assert.equal((source.match(new RegExp(`sandbox="${SANDBOX_CSP.slice('sandbox '.length)}"`, 'g')) || []).length, 2);
  } finally { await service.close(); await close(pb); await close(upstream); }
});

test('sandbox compatibility shim makes cookie access inert, drops only X-Requested-With and exposes nothing else', () => {
  const securityError = () => Object.assign(new Error("Failed to read the 'cookie' property from 'Document': The document is sandboxed"), { name: 'SecurityError' });
  let jarWrites = 0;
  class SandboxedDocument {}
  Object.defineProperty(SandboxedDocument.prototype, 'cookie', { configurable: true, get() { throw securityError(); }, set() { jarWrites += 1; throw securityError(); } });
  const sent = [];
  function XMLHttpRequest() {}
  XMLHttpRequest.prototype.setRequestHeader = function (name, value) { sent.push([this, name, value]); };
  const document = new SandboxedDocument();
  assert.throws(() => document.cookie, { name: 'SecurityError' });
  const context = { document, XMLHttpRequest };
  vm.runInNewContext(MAP_SANDBOX_COMPAT.replace(/<script[^>]*>|<\/script>/g, ''), context);
  assert.deepEqual(Object.keys(context).sort(), ['XMLHttpRequest', 'document'], 'no globals are added');
  assert.equal(document.cookie, '');
  assert.doesNotThrow(() => { document.cookie = 'dynmapurl=/; path=/'; });
  assert.equal(document.cookie, '', 'writes are dropped, nothing is stored');
  assert.equal(jarWrites, 0, 'the real cookie setter is never reached');
  assert.throws(() => Object.getOwnPropertyDescriptor(SandboxedDocument.prototype, 'cookie').get.call(document), { name: 'SecurityError' });
  const xhr = new XMLHttpRequest();
  xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
  xhr.setRequestHeader('x-requested-with', 'XMLHttpRequest');
  xhr.setRequestHeader('Accept', 'application/json');
  assert.deepEqual(sent.map(([, name, value]) => [name, value]), [['Accept', 'application/json']]);
  assert.equal(sent[0][0], xhr);

  // A document whose cookie cannot be redefined still gets the header filter, and nothing throws.
  const locked = Object.preventExtensions(new SandboxedDocument());
  const lockedSent = [];
  function LockedXMLHttpRequest() {}
  LockedXMLHttpRequest.prototype.setRequestHeader = (name) => lockedSent.push(name);
  assert.doesNotThrow(() => vm.runInNewContext(MAP_SANDBOX_COMPAT.replace(/<script[^>]*>|<\/script>/g, ''), { document: locked, XMLHttpRequest: LockedXMLHttpRequest }));
  new LockedXMLHttpRequest().setRequestHeader('X-Requested-With', 'XMLHttpRequest');
  assert.deepEqual(lockedSent, []);

  assert.ok(injectMapEscapeBridge('<html><body>map</body></html>').startsWith(MAP_ESCAPE_BRIDGE + MAP_SANDBOX_COMPAT));
  assert.equal(injectMapEscapeBridge('<html><head lang="en"><script src="a.js"></script></head></html>'), `<html><head lang="en">${MAP_ESCAPE_BRIDGE}${MAP_SANDBOX_COMPAT}<script src="a.js"></script></head></html>`);
});
