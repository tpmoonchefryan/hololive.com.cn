import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openDialog, isBackdropClick, trapDialogTab } from '../src/components/admin/ui/dialogLifecycle.js';

const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
test('nested modal lifecycle preserves scroll lock and restores each trigger', () => {
  const body = { style: { overflow: 'auto' } };
  const calls = [];
  const make = (name) => ({ ownerDocument: { activeElement: { isConnected: true, focus: () => calls.push(name + ':focus') } }, showModal: () => calls.push(name + ':open'), close: () => calls.push(name + ':close') });
  const closeParent = openDialog(make('parent'), body);
  const closeChild = openDialog(make('child'), body);
  assert.equal(body.style.overflow, 'hidden');
  closeChild();
  assert.equal(body.style.overflow, 'hidden');
  closeParent();
  assert.equal(body.style.overflow, 'auto');
  assert.deepEqual(calls, ['parent:open','child:open','child:close','child:focus','parent:close','parent:focus']);
});
test('removed trigger does not receive focus after closing', () => {
  let focused = false;
  const dialog = { ownerDocument: { activeElement: { isConnected: false, focus: () => { focused = true; } } }, showModal() {}, close() {} };
  openDialog(dialog, { style: { overflow: '' } })();
  assert.equal(focused, false);
});
test('backdrop closes while padding, panel and child clicks do not', () => {
  const dialog = { getBoundingClientRect: () => ({ left: 10, right: 110, top: 20, bottom: 120 }) };
  const event = { target: dialog, currentTarget: dialog, clientX: 5, clientY: 30 };
  assert.equal(isBackdropClick(event), true);
  assert.equal(isBackdropClick({ ...event, clientX: 15 }), false);
  assert.equal(isBackdropClick({ ...event, target: {} }), false);
});
const consumers = [
  'src/components/admin/media/MediaManager.jsx', 'src/components/admin/MediaLibraryModal.jsx',
  'src/components/admin/editor/MenuBar.jsx', 'src/components/admin/editor/RichTextEditor.jsx',
  'src/components/admin/velocity/ServerModal.jsx', 'src/components/admin/content/TranslationProgressModal.jsx',
  'src/components/admin/mcsm/MCSMFileEditor.jsx', 'src/components/ui/FeedbackProvider.jsx',
  'src/pages/ServerInfo.jsx', 'src/components/admin/AdminLayout.jsx',
];
test('all modal consumers share the native top-layer component', () => {
  for (const file of consumers) {
    const source = read(file);
    assert.match(source, /import Modal from|lazy\(\(\) => import\("\.\.\/admin\/ui\/Modal"\)/);
    assert.match(source, /<Modal\b/);
    assert.doesNotMatch(source, /aria-modal="true"/);
  }
  const modal = read('src/components/admin/ui/Modal.jsx');
  assert.match(modal, /<dialog/);
  assert.match(modal, /aria-modal="true"/);
  assert.match(modal, /onCancel=/);
  assert.match(modal, /isBackdropClick/);
  assert.match(read('src/pages/ServerInfo.jsx'), /sandbox="allow-scripts allow-forms allow-pointer-lock allow-downloads"/);
});
test('global consumer gate rejects an independently implemented dialog', () => {
  const migrationGate = (source) => /import Modal from|lazy\(\(\) => import\("\.\.\/admin\/ui\/Modal"\)/.test(source) && /<Modal\b/.test(source) && !/aria-modal="true"/.test(source);
  assert.equal(migrationGate(read('src/components/ui/FeedbackProvider.jsx')), true);
  assert.equal(migrationGate('<div role="dialog" aria-modal="true">confirm</div>'), false);
});
test('mobile navigation enumerates the same configuration, including every child and logout', () => {
  const source = read('src/components/admin/AdminLayout.jsx');
  assert.match(source, /navItems\.flatMap\(\(item\) => item.children \|\| \[item\]\)/);
  assert.match(source, /aria-haspopup="dialog"/);
  assert.match(source, /onClick={handleLogout}/);
  assert.match(source, /setMobileMenuOpen\(false\)/);
});
test('homepage state contract distinguishes failed, loading and empty with retry in all locales', () => {
  const source = read('src/pages/Home.jsx');
  assert.match(source, /loading \? "loading" : error \? "error" : "empty"/);
  assert.match(source, /onClick={retry}/);
  assert.doesNotMatch(source, /t\("common\.(loading|empty)"\)/);
  const locales = read('src/i18n.js');
  assert.equal((locales.match(/error: ".*", retry: "/g) || []).length, 3);
  const hook = read('src/hooks/useCmsData.js');
  assert.match(hook, /\[i18n.language, attempt\]/);
  assert.match(hook, /if \(active\) setError\(err\)/);
  assert.match(hook, /return \(\) => { active = false; }/);
});

test('Tab wraps forward and backward without trapping ordinary intermediate navigation', () => {
  const calls = [];
  const control = (name) => ({ disabled: false, tabIndex: 0, getClientRects: () => [1], focus: () => calls.push(name) });
  const first = control('first'), last = control('last'), hidden = { ...control('hidden'), getClientRects: () => [] };
  const dialog = { querySelectorAll: () => [first, hidden, last], ownerDocument: { activeElement: last } };
  const event = { key: 'Tab', currentTarget: dialog, shiftKey: false, preventDefault: () => calls.push('prevent') };
  trapDialogTab(event);
  assert.deepEqual(calls, ['prevent', 'first']);
  calls.length = 0; dialog.ownerDocument.activeElement = first;
  trapDialogTab(event); assert.deepEqual(calls, []);
  trapDialogTab({ ...event, shiftKey: true }); assert.deepEqual(calls, ['prevent', 'last']);
  calls.length = 0; trapDialogTab({ ...event, key: 'Enter' }); assert.deepEqual(calls, []);
});

test('explicit stable return focus replaces a disconnected automatically captured trigger', () => {
  const focused = [];
  const stable = { isConnected: true, focus: () => focused.push('stable') };
  const dialog = { ownerDocument: { activeElement: { isConnected: false } }, showModal() {}, close() {} };
  openDialog(dialog, { style: { overflow: 'auto' } }, { current: stable })();
  assert.deepEqual(focused, ['stable']);
});

test('map close bridge binds exact shape to the current iframe window', async () => {
  const { isMapEscapeMessage } = await import('../src/lib/mapEmbedMessages.js');
  const source = {}, other = {}, frame = { contentWindow: source };
  const message = { source, origin: 'null', data: { type: 'hololive:map-escape', version: 1 } };
  assert.equal(isMapEscapeMessage(message, frame), true);
  for (const data of [null, [], 'hololive:map-escape', { type: 'hololive:map-escape' }, { type: 'hololive:map-escape', version: 2 }, { type: 'hololive:map-escape', version: 1, extra: true }, { type: 'other', version: 1 }]) {
    assert.equal(isMapEscapeMessage({ ...message, data }, frame), false);
  }
  assert.equal(isMapEscapeMessage({ ...message, source: other }, frame), false);
  assert.equal(isMapEscapeMessage(message, { contentWindow: other }), false);
  assert.equal(isMapEscapeMessage(message, null), false);
});

test('shell labels resolve in all locales with the existing namespace separator', async () => {
  globalThis.localStorage = { getItem: () => 'zh', setItem() {} };
  const { default: i18n } = await import('../src/i18n.js');
  for (const lng of ['zh', 'en', 'ja']) {
    for (const key of ['admin.console', 'admin.backend']) assert.notEqual(i18n.t(key, { lng }), key);
  }
  assert.equal(i18n.options.nsSeparator, '.');
});

test('public navbar restores the pre-release glass styles and keeps the accessible controls', () => {
  const source = read('src/components/layout/Navbar.jsx');
  const navClass = source.match(/<nav className=\{`([^`]*)`\}>/)?.[1] || '';
  assert.match(navClass, /isStandardPage\s*\?\s*"bg-white\/80 backdrop-blur-md shadow-sm"\s*:\s*"bg-transparent"/);
  assert.match(navClass, /transition-\[background-color,box-shadow\] duration-300/);
  assert.match(navClass, /\bh-14 md:h-16\b/);
  assert.doesNotMatch(navClass, /bg-white\/95|\bpy-2\b|md:py-3/);
  for (const route of ['/docs/', '/403', '/404', '/500', '/503', '/418']) assert.ok(source.includes(`location.pathname.startsWith("${route}")`), route);
  assert.ok(source.includes('location.pathname === "/docs" ||'));
  assert.match(source, /isStandardPage\s*\?\s*"text-slate-900"\s*:\s*"text-white drop-shadow-md"/);
  assert.match(source, /className=\{isStandardPage \? "" : "drop-shadow-md"\}/);
  assert.match(source, /<motion\.div key=\{l\.to\} whileHover=\{\{ scale: 1\.12 \}\} whileTap=\{\{ scale: 0\.96 \}\}>/);
  assert.match(source, /"text-white drop-shadow-md hover:text-\[var\(--color-brand-blue\)\]\/95"/);
  assert.match(source, /"transition-colors text-sm font-bold px-2 py-1 rounded-md "/);
  assert.match(source, /"bg-\[#8ed1fc\] text-white"/);
  assert.match(source, /"text-white hover:bg-\[#8ed1fc\]\/80"/);
  assert.match(source, /<div className="flex gap-2 ml-5 select-none">/);
  const menu = source.match(/<motion\.div id="public-mobile-menu"[^>]*?className=\{`([^`]*)`\}>/)?.[1] || '';
  assert.match(menu, /backdrop-blur-lg shadow-lg border-b z-50/);
  assert.match(menu, /isStandardPage \? "bg-white\/95" : "bg-\[var\(--color-brand-blue\)\]\/95"/);
  assert.match(source, /<AnimatePresence>\s*\{showMenu && \(\s*<motion\.div id="public-mobile-menu" initial=\{\{y:-40,opacity:0\}\} animate=\{\{y:0,opacity:1\}\} exit=\{\{y:-40,opacity:0\}\}/);
  // The 06f198f single opaque style is gone: no constant white bar, slate hover or solid white menu.
  assert.doesNotMatch(source, /hover:bg-slate-100/);
  assert.doesNotMatch(source, /(^|[\s"'`])bg-white(?=[\s"'`])/m);
  assert.equal((source.match(/bg-white\/95/g) || []).length, 1, 'only the standard-page mobile menu uses bg-white/95');
  // STORY-008 accessibility is kept.
  assert.match(source, /aria-expanded=\{showMenu\}/);
  assert.match(source, /aria-controls="public-mobile-menu"/);
  assert.equal((source.match(/aria-current=\{location\.pathname===l\.to \? "page" : undefined\}/g) || []).length, 2);
  assert.match(source, /className="md:hidden p-2 rounded focus-visible:outline-2 focus-visible:outline-blue-600"/);
  assert.match(source, /aria-label=\{t\(showMenu \? "navbar\.closeMenu" : "navbar\.openMenu"\)\}/);
  assert.equal((source.match(/aria-label=\{t\(`languageNames\.\$\{l\.code\}`\)\}/g) || []).length, 2);
  assert.doesNotMatch(source, /\{ ns: /);
});

test('home loading, empty and error screens keep a fixed dark backdrop behind the transparent navbar', () => {
  const source = read('src/pages/Home.jsx');
  const start = source.indexOf('if (loading || error || sections.length === 0)');
  const screen = source.slice(start, source.indexOf('return <HomeContent', start));
  assert.ok(start > 0 && screen.length > 0);
  assert.match(screen, /<main className="min-h-screen flex items-center justify-center bg-slate-950 [^"]*">\s*(?:\/\/[^\n]*\n\s*)*<div aria-hidden="true" className="fixed inset-0 -z-10 bg-slate-950" \/>/);
  assert.match(read('src/components/announcement/GlobalBanner.jsx'), /sticky top-\[56px\] md:top-\[64px\] mt-\[56px\] md:mt-\[64px\]/);
});

test('a failed chunk preload reloads once, then lets the error surface within 10 s', async () => {
  const { reloadOnceOnPreloadError } = await import('../src/lib/chunkReload.js');
  const store = new Map();
  let reloads = 0;
  const win = Object.assign(new EventTarget(), {
    sessionStorage: { getItem: (key) => (store.has(key) ? store.get(key) : null), setItem: (key, value) => store.set(key, String(value)) },
    location: { reload: () => { reloads += 1; } },
  });
  let clock;
  win.addEventListener('vite:preloadError', (event) => reloadOnceOnPreloadError(event, win, clock));
  const fire = (now) => { clock = now; const event = new Event('vite:preloadError', { cancelable: true }); win.dispatchEvent(event); return event.defaultPrevented; };
  assert.equal(fire(1_000_000), true);
  assert.equal(reloads, 1);
  assert.equal(fire(1_000_000 + 9_999), false, 'second failure within 10 s surfaces');
  assert.equal(reloads, 1);
  assert.equal(fire(1_000_000 + 10_000), true, 'a later release may reload again');
  assert.equal(reloads, 2);
  // Default clock: two immediate failures reload once.
  store.clear();
  const first = new Event('vite:preloadError', { cancelable: true }); reloadOnceOnPreloadError(first, win);
  const second = new Event('vite:preloadError', { cancelable: true }); reloadOnceOnPreloadError(second, win);
  assert.deepEqual([first.defaultPrevented, second.defaultPrevented, reloads], [true, false, 3]);
});

test('unavailable sessionStorage never reloads or swallows the preload error', async () => {
  const { reloadOnceOnPreloadError } = await import('../src/lib/chunkReload.js');
  const reload = () => assert.fail('reloaded without a usable loop guard');
  const denied = () => { throw Object.assign(new Error('The document is sandboxed'), { name: 'SecurityError' }); };
  for (const win of [
    { get sessionStorage() { return denied(); }, location: { reload } },
    { sessionStorage: { getItem: denied, setItem() {} }, location: { reload } },
    { sessionStorage: { getItem: () => null, setItem: denied }, location: { reload } },
    { sessionStorage: null, location: { reload } },
  ]) {
    const event = new Event('vite:preloadError', { cancelable: true });
    assert.equal(reloadOnceOnPreloadError(event, win, 1_000_000), false);
    assert.equal(event.defaultPrevented, false);
  }
});

test('the entry registers the preload guard before the first render', () => {
  const main = read('src/main.jsx');
  assert.match(main, /import \{ reloadOnceOnPreloadError \} from "\.\/lib\/chunkReload";/);
  const register = main.indexOf('window.addEventListener("vite:preloadError", reloadOnceOnPreloadError);');
  assert.ok(register > 0 && register < main.indexOf('createRoot(document.getElementById("root"))'));
});
