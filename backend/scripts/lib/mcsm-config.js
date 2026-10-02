import { createServiceAuth } from './service-auth.js';
/** Expired or revoked config fails closed; public cold starts use service auth. */
export function createConfigLoader({ pbUrl, serviceEmail, servicePassword, fetchImpl = fetch, now = Date.now, ttlMs = 5000, timeoutMs = 15000 }) {
  const authorize = createServiceAuth({ pbUrl, email: serviceEmail, password: servicePassword, fetchImpl, timeoutMs });
  let cached = null;
  let expiresAt = 0;
  return async (adminToken) => {
    if (cached && now() < expiresAt) return cached;
    try {
      let auth = adminToken;
      if (!auth) auth = await authorize();
      const response = await fetchImpl(`${pbUrl}/api/collections/mcsm_config/records?perPage=1`, {
        headers: { Authorization: auth }, signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) throw new Error(`Failed to load mcsm_config: HTTP ${response.status}`);
      const item = (await response.json())?.items?.[0];
      if (!item) throw new Error("mcsm_config record not found");
      cached = { panelUrl: `${item.panel_url || ""}`.replace(/\/$/, ""), apiKey: item.api_key || "", enabled: !!item.enabled,
        publicCacheTtl: Math.max(0, Number(item.public_cache_ttl) || 10000), instanceLabels: item.instance_labels || {}, hiddenInstances: item.hidden_instances || [] };
      expiresAt = now() + ttlMs;
      return cached;
    } catch (error) { cached = null; expiresAt = 0; throw error; }
  };
}
