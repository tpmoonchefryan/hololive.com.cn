/** Users service identity only. Refresh authorizations; never fall back to superusers. */
export function createServiceAuth({ pbUrl, email, password, fetchImpl = fetch, timeoutMs = 15000, onAuth = () => {} }) {
  let token = '';
  const request = async (route, options) => {
    const response = await fetchImpl(`${pbUrl}/api/collections/users/${route}`, { ...options, signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) throw Object.assign(new Error(`Service authentication failed: HTTP ${response.status}`), { status: response.status });
    const auth = await response.json();
    if (!auth.token || auth.record?.collectionName !== 'users' || auth.record.is_admin !== true || auth.record.service_account !== true) {
      throw new Error('Service identity requires users.is_admin=true and service_account=true');
    }
    token = auth.token; onAuth(auth); return token;
  };
  return async () => {
    try {
      if (token) {
        try { return await request('auth-refresh', { method: 'POST', headers: { Authorization: token } }); }
        catch (error) { if (error.status !== 401) throw error; }
      }
      if (!email || !password) throw new Error('Missing PB_EMAIL and PB_PASS service configuration');
      return await request('auth-with-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identity: email, password }) });
    } catch (error) { token = ''; onAuth(null); throw error; }
  };
}
