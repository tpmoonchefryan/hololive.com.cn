// Start is inclusive; end is exclusive. Overlap: latest created, then id.
export function activeAnnouncementFilter(client, now) {
  return client.filter('is_active = true && (start_time = "" || start_time <= {:now}) && (end_time = "" || end_time > {:now})', { now: new Date(now).toISOString().replace('T', ' ') });
}
export function selectAnnouncement(items, now) {
  return items.filter(item => item.is_active && (!item.start_time || Date.parse(item.start_time) <= now) && (!item.end_time || Date.parse(item.end_time) > now))
    .sort((a, b) => Date.parse(b.created) - Date.parse(a.created) || b.id.localeCompare(a.id))[0] || null;
}
export function nextBoundary(items, now) {
  const times = items.filter(item => item.is_active).flatMap(item => [Date.parse(item.start_time), Date.parse(item.end_time)]).filter(time => time > now);
  return times.length ? Math.min(...times) : null;
}
