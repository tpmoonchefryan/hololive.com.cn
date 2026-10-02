/** Refresh every request so revocation takes effect without a token-cache delay. */
export async function verifyAdminAuth(pbUrl, authHeader, fetchImpl = fetch) {
  if (!authHeader) return false;
  try {
    const response = await fetchImpl(`${pbUrl}/api/collections/users/auth-refresh`, {
      method: 'POST', headers: { Authorization: authHeader }, signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return false;
    const { record } = await response.json();
    return record?.collectionName === 'users' && record.is_admin === true &&
      (record.verified === true || record.service_account === true);
  } catch { return false; }
}
