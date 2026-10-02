import test from 'node:test';
import assert from 'node:assert/strict';
import PocketBase from 'pocketbase';
import { activeAnnouncementFilter, selectAnnouncement, nextBoundary } from '../src/components/announcement/announcement.js';
const now = Date.parse('2026-01-01T12:00:00Z');
const item = (id, created, start_time='', end_time='') => ({ id, created, start_time, end_time, is_active:true });
const current = item('old', '2026-01-01T01:00:00Z');
const future = item('future', '2026-01-01T02:00:00Z','2026-01-01T13:00:00Z');
test('future latest does not hide currently active older announcement', () => {
 assert.equal(selectAnnouncement([future,current],now).id,'old');
 assert.equal(selectAnnouncement([future,current],now+3600000).id,'future');
 assert.equal(nextBoundary([current,future],now),now+3600000);
});
test('expired, disabled, overlap and exclusive ending boundary are deterministic', () => {
 const overlap=item('overlap','2026-01-01T03:00:00Z','','2026-01-01T12:00:01Z');
 assert.equal(selectAnnouncement([current,overlap],now).id,'overlap');
 assert.equal(selectAnnouncement([current,overlap],now+1000).id,'old');
 assert.equal(selectAnnouncement([{...current,is_active:false}, {...current,end_time:'2026-01-01T11:00:00Z'}],now),null);
 assert.equal(nextBoundary([current],now),null);
});
test('server validity predicates precede latest-page selection', () => {
 const filter=activeAnnouncementFilter(new PocketBase(),now);
 assert.match(filter,/start_time <=/); assert.match(filter,/end_time >/); assert.match(filter,/is_active = true/);
 assert.doesNotMatch(filter,/end_time >=/);
});
import { binaries, pocketbase } from './helpers/pocketbase.mjs';
test('real server filters valid announcement before limit=1 and changes at time boundary', async () => {
 const server=await pocketbase(binaries[0][1]);
 try {
  const pb=new PocketBase(server.url);pb.authStore.save(server.token);
  for (const existing of await pb.collection("announcements").getFullList()) await pb.collection("announcements").update(existing.id,{is_active:false});
  const older=await pb.collection('announcements').create({id:'aaaaaaaaaaaaaaa',created:'2026-01-01T01:00:00Z',is_active:true,content:{en:'Current'},type:'info'});
  const newer=await pb.collection('announcements').create({id:'zzzzzzzzzzzzzzz',created:'2026-01-01T02:00:00Z',is_active:true,content:{en:'Future'},type:'urgent',start_time:'2026-01-01T13:00:00Z'});
  const options=time=>({filter:activeAnnouncementFilter(pb,time),sort:'-created,-id'});
  assert.equal((await pb.collection('announcements').getList(1,1,options(now))).items[0].id,older.id);
  assert.equal((await pb.collection('announcements').getList(1,1,options(now+3600000))).items[0].id,newer.id);
  await pb.collection('announcements').update(newer.id,{end_time:'2026-01-01T14:00:00Z'});
  assert.equal((await pb.collection('announcements').getList(1,1,options(now+7200000))).items[0].id,older.id);
 } finally {await server.close();}
});
