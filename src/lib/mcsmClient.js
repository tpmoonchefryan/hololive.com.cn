/** MCSM transport stays independent of UI feedback and credentials stay in PB. */
export function createMCSMClient({ fetchImpl = fetch, token = () => "", origin = () => window.location.origin, timeoutMs = 15000 } = {}) {
  return async (path, { method = "GET", body, params = {} } = {}) => {
    const url = new URL(`/mcsm-api${path}`, typeof origin === "function" ? origin() : origin);
    for (const [key, value] of Object.entries(params)) {
      if (value != null) url.searchParams.set(key, String(value));
    }
      const response = await fetchImpl(url, {
        method, signal: AbortSignal.timeout(timeoutMs),
        headers: { Authorization: token(), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const payload = await response.json();
      if (!response.ok || payload?.status !== 200) {
        const detail = typeof payload?.data === "string" ? payload.data : payload?.error;
        throw new Error(detail || `MCSM failed: ${response.status}/${payload?.status}`);
      }
      return payload;
  };
}
