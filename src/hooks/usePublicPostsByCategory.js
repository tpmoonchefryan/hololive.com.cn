import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import pb from "../lib/pocketbase";
import { createQueryGate } from "../lib/contentQuery";

export function usePublicPostsByCategory({ category, loadErrorKey }) {
  const { t } = useTranslation("docs");
  const [pageState, setPageState] = useState({ category, page: 1 });
  const page = pageState.category === category ? pageState.page : 1;
  const [result, setResult] = useState({ items: [], totalItems: 0, totalPages: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refresh, setRefresh] = useState(0);
  const gate = useRef(createQueryGate());
  const reload = useCallback(() => setRefresh(value => value + 1), []);

  useEffect(() => {
    const token = gate.current.next();
    setLoading(true);
    setError(null);
    pb.collection("posts").getList(page, 24, {
      filter: pb.filter('category = {:category} && is_public = true', { category }),
      sort: "-is_pinned,-created,-id",
      expand: "cover_ref",
      requestKey: null,
    }).then(value => {
      if (gate.current.current(token)) setResult(value);
    }).catch(value => {
      if (gate.current.current(token)) {
        setResult({ items: [], totalItems: 0, totalPages: 0 });
        setError(value);
      }
    }).finally(() => {
      if (gate.current.current(token)) setLoading(false);
    });
    return () => { gate.current.next(); };
  }, [category, page, refresh]);

  return {
    posts: result.items, totalItems: result.totalItems, totalPages: result.totalPages,
    loading, error: error ? t(loadErrorKey) : null, page,
    setPage: value => setPageState({ category, page: value }), reload,
  };
}
