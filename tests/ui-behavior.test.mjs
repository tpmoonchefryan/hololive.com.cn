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
    assert.match(source, /import Modal from/);
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
  const migrationGate = (source) => /import Modal from/.test(source) && /<Modal\b/.test(source) && !/aria-modal="true"/.test(source);
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
