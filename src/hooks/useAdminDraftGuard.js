import { useCallback, useEffect, useRef, useState } from "react";
import { useBlocker, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useUIFeedback } from "./useUIFeedback";

// Exclude UI identities; canonical keys make exact payload comparisons stable.
export function draftSnapshot(value) {
  const canonical = item => Array.isArray(item) ? item.map(canonical) : item && typeof item === "object"
    ? Object.fromEntries(Object.keys(item).filter(key => key !== "_uiKey").sort().map(key => [key, canonical(item[key])])) : item;
  return JSON.stringify(canonical(value));
}

export function useAdminDraftGuard(value, identity, enabled = true) {
  const routeKey = useLocation().key;
  identity = `${identity}:${routeKey}`;
  const { t } = useTranslation("common");
  const { confirm } = useUIFeedback();
  const snapshot = draftSnapshot(value);
  const [baseline, setBaseline] = useState(() => ({ identity, snapshot }));
  const baselineRef = useRef(baseline);
  baselineRef.current = baseline;
  const lifetime = useRef({ identity, epoch: 0, operations: {}, timer: null, mounted: true });
  const latest = useRef(snapshot);
  latest.current = snapshot;
  if (lifetime.current.identity !== identity) {
    clearTimeout(lifetime.current.timer);
    lifetime.current = { identity, epoch: lifetime.current.epoch + 1, operations: {}, timer: null, mounted: true };
  }
  const dirty = enabled && baseline.identity === identity && baseline.snapshot !== snapshot;
  const blocker = useBlocker(dirty);
  const pending = useRef(null);
  useEffect(() => {
    if (blocker.state !== "blocked" || pending.current === blocker) return;
    pending.current = blocker;
    const epoch = lifetime.current.epoch;
    let active = true;
    confirm({ title: t("draft.title"), message: t("draft.message"), confirmText: t("draft.discard"),
      cancelText: t("draft.keepEditing"), danger: true }).then(discard => {
      if (!active || !lifetime.current.mounted || lifetime.current.epoch !== epoch) return;
      pending.current = null;
      if (discard) blocker.proceed(); else blocker.reset();
    });
    return () => { active = false; pending.current = null; };
  }, [blocker, confirm, t]);
  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = event => {
      if (latest.current === baselineRef.current.snapshot) return;
      event.preventDefault(); event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);
  useEffect(() => {
    lifetime.current.mounted = true;
    return () => { lifetime.current.mounted = false; lifetime.current.epoch++; clearTimeout(lifetime.current.timer); };
  }, []);
  const establishBaseline = useCallback(payload => {
    const next = { identity: lifetime.current.identity, snapshot: draftSnapshot(payload) };
    baselineRef.current = next; setBaseline(next);
  }, []);
  const begin = useCallback(kind => {
    const owner = lifetime.current;
    clearTimeout(owner.timer);
    const sequence = (owner.operations[kind] || 0) + 1;
    owner.operations[kind] = sequence;
    return { identity: owner.identity, epoch: owner.epoch, kind, sequence, snapshot: latest.current };
  }, []);
  const current = useCallback(operation => {
    const owner = lifetime.current;
    return owner.mounted && owner.identity === operation.identity && owner.epoch === operation.epoch && owner.operations[operation.kind] === operation.sequence;
  }, []);
  const unchanged = useCallback(operation => current(operation) && latest.current === operation.snapshot, [current]);
  const schedule = useCallback((operation, payload, callback, delay) => {
    const saved = draftSnapshot(payload);
    lifetime.current.timer = setTimeout(() => {
      if (current(operation) && latest.current === saved) callback();
    }, delay);
  }, [current]);
  return { routeKey, dirty, establishBaseline, begin, current, unchanged, schedule };
}
