import { useCallback, useEffect, useId, useRef, useState } from 'react';
import pb from '../lib/pocketbase';
import { contentFilter, createQueryGate } from '../lib/contentQuery';
export default function useContentQuery(collection, search, category = 'all', enabled = true) {
  const [pageState, setPageState] = useState({ key: '', page: 1 });
  const [result, setResult] = useState({ items: [], totalItems: 0, totalPages: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refresh, setRefresh] = useState(0);
  const requestOwner = useId();
  const gate = useRef(createQueryGate());
  const key = `${search}:${category}`;
  const page = pageState.key === key ? pageState.page : 1;
  const reload = useCallback(() => setRefresh(value => value + 1), []);
  useEffect(() => {
    if (!enabled) return;
    const token = gate.current.next();
    const requestKey = `${requestOwner}:${token}`;
    setLoading(true);
    setError(null);
    pb.collection(collection).getList(page, 24, {
      filter: contentFilter(pb, collection, search, category),
      sort: collection === 'posts' ? '-updated,-id' : '-created,-id',
      requestKey,
    }).then(value => {
      if (gate.current.current(token)) setResult(value);
    }).catch(value => {
      if (gate.current.current(token)) { setError(value); setResult({ items: [], totalItems: 0, totalPages: 0 }); }
    }).finally(() => { if (gate.current.current(token)) setLoading(false); });
    return () => { gate.current.next(); pb.cancelRequest(requestKey); };
  }, [collection, search, category, enabled, page, refresh]);
  return { ...result, loading, error, page, setPage: value => setPageState({ key, page: value }), reload };
}
