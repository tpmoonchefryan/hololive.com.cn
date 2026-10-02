import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import PocketBase from 'pocketbase';
import { contentFilter, createQueryGate } from '../src/lib/contentQuery.js';
test('query filters bind escaped search across title languages, slug and category', () => {
  const filter = contentFilter(new PocketBase(), 'posts', "article101' || is_public=true");
  assert.match(filter, /title\.ja/); assert.match(filter, /slug/); assert.match(filter, /\\'/);
  assert.equal(contentFilter(new PocketBase(), 'posts', ' '), '');
});
test('media filters run search and type exclusion on server before pagination', () => {
  const pb = new PocketBase();
  assert.match(contentFilter(pb, 'media', '201', 'images'), /file ~ '%\.png'/);
  assert.match(contentFilter(pb, 'media', '201', 'files'), /file !~ '%\.mp4'/);
  assert.match(contentFilter(pb, 'media', '', 'videos'), /wmv/);
});
test('newest query wins when promises resolve in reverse order', async () => {
  const gate = createQueryGate(); let displayed;
  const first = gate.next(); const second = gate.next();
  await Promise.resolve().then(() => { if (gate.current(second)) displayed = '201'; });
  await Promise.resolve().then(() => { if (gate.current(first)) displayed = 'stale'; });
  assert.equal(displayed, '201'); assert.equal(gate.current(first), false);
});
test('both editors load only on record identity, with translated errors independent', () => {
  for (const file of ['PostEditor', 'SectionEditor']) {
    const source = readFileSync(new URL(`../src/pages/admin/${file}.jsx`, import.meta.url), 'utf8');
    assert.match(source, /\[id, isEditMode\]/); assert.doesNotMatch(source, /\[id, isEditMode, t\]/);
    assert.match(source, /translateRef\.current/);
  }
});
import { binaries, pocketbase } from './helpers/pocketbase.mjs';
test('real PocketBase filters before paging: article 101, multilingual match and media 201', async () => {
 const server = await pocketbase(binaries[0][1]);
 try {
  const pb = new PocketBase(server.url); pb.authStore.save(server.token);
  for (let index=1; index<=101; index++) await pb.collection('posts').create({title:{zh:`文章${index}`,en:`Article${index}`,ja:`記事${index}`},slug:`article-${index}`,content:{zh:'Body'},category:'公告',is_public:true});
  const all=await pb.collection('posts').getList(1,24); assert.equal(all.totalItems,101); assert.equal(all.totalPages,5);
  const result=await pb.collection('posts').getList(1,24,{filter:contentFilter(pb,'posts','記事101')}); assert.equal(result.totalItems,1); assert.equal(result.items[0].slug,'article-101');
  assert.equal((await pb.collection('posts').getList(1,24,{filter:contentFilter(pb,'posts',"' || is_public=true")})).totalItems,0);
  for (let index=1; index<=201; index++) {const form=new FormData();form.append('file',new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5xoAAAAASUVORK5CYII=', 'base64')],{type:'image/png'}),`image${index}.png`); await pb.collection('media').create(form);}
  const media=await pb.collection('media').getList(1,24,{filter:contentFilter(pb,'media','image201','images')});assert.equal(media.totalItems,1);assert.match(media.items[0].file,/image201/);
  assert.equal((await pb.collection('media').getList(1,24,{filter:contentFilter(pb,'media','','files')})).totalItems,0);
 } finally {await server.close();}
});
