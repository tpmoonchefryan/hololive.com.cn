const imageExtensions = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico'];
const videoExtensions = ['mp4', 'webm', 'ogg', 'mov', 'avi', 'mkv', 'wmv', 'flv'];
const extensionsFilter = (extensions) => `(${extensions.map(ext => `file ~ '%.${ext}'`).join(' || ')})`;
export function contentFilter(client, collection, search = '', category = 'all') {
  const filters = [];
  if (collection === 'media') {
    filters.push('file != ""');
    if (category === 'images') filters.push(extensionsFilter(imageExtensions));
    if (category === 'videos') filters.push(extensionsFilter(videoExtensions));
    if (category === 'files') filters.push(`(${[...imageExtensions, ...videoExtensions].map(ext => `file !~ '%.${ext}'`).join(' && ')})`);
  }
  if (search.trim()) {
    const fields = collection === 'posts' ? ['title', 'title.zh', 'title.en', 'title.ja', 'slug', 'category'] : ['file'];
    filters.push(client.filter(`(${fields.map(field => `${field} ~ {:query}`).join(' || ')})`, { query: search.trim() }));
  }
  return filters.join(' && ');
}
// Each query owns its result: earlier responses cannot publish after a later query.
export function createQueryGate() {
  let generation = 0;
  return { next: () => ++generation, current: (token) => token === generation };
}
