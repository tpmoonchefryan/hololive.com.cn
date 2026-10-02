// Share only an in-flight verification. A later navigation/focus always
// revalidates with the server, and an auth-store change invalidates old work.
export function createAdminSession(pb) {
  let generation = 0;
  let pending;
  pb.authStore.onChange(() => { generation += 1; });
  const changed = () => Object.assign(new Error('Session changed'), { code: 'SESSION_CHANGED' });

  return function refreshAdminSession() {
    if (pending?.generation === generation) return pending.promise;
    const current = generation;
    const token = pb.authStore.token;
    const id = pb.authStore.record?.id;
    const request = { generation: current };
    request.promise = (async () => {
      try {
        if (!token || !id) throw new Error('Administrator authorization required');
        // SDK send does not auto-save the auth response. Commit only after the
        // captured session is still current, so logout cannot be undone.
        const result = await pb.send('/api/collections/users/auth-refresh', {
          method: 'POST', headers: { Authorization: token },
          requestKey: `admin-session-refresh:${current}`,
        });
        if (current !== generation) throw changed();
        const { record } = result;
        if (!result.token || record?.id !== id || record.collectionName !== 'users'
          || !record.is_admin || (!record.verified && !record.service_account)) {
          throw new Error('Administrator authorization required');
        }
        pb.authStore.save(result.token, record);
        return result;
      } catch (error) {
        if (current !== generation) throw changed();
        pb.authStore.clear();
        throw error;
      } finally {
        if (pending === request) pending = undefined;
      }
    })();
    pending = request;
    return request.promise;
  };
}
