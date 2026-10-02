import { createServiceAuth } from './service-auth.js';

/** Data/lifecycle adapter shared by daemon and real isolated PocketBase tests. */
export function createVelocityPocketBase({ pb, email, password, fetchImpl = fetch }) {
  const authorize = createServiceAuth({ pbUrl: pb.baseURL, email, password, fetchImpl,
    onAuth: auth => auth ? pb.authStore.save(auth.token, auth.record) : pb.authStore.clear() });
  return {
    authorize,
    async read() {
      await authorize();
      const { items } = await pb.collection('velocity_settings').getList(1, 1);
      if (!items.length) throw new Error('No velocity settings found');
      const servers = await pb.collection('velocity_servers').getFullList({ sort: 'try_order' });
      const forcedHosts = await pb.collection('velocity_forced_hosts').getFullList();
      return { settings: items[0], servers, forcedHosts };
    },
    async update(collection, id, payload) {
      if (!['velocity_settings', 'velocity_servers'].includes(collection)) throw new Error('Unsupported Velocity update');
      await authorize();
      return pb.collection(collection).update(id, payload);
    },
    async subscribe(callbacks) {
      await authorize();
      const cleanups = [];
      try {
        for (const collection of ['velocity_settings', 'velocity_servers', 'velocity_forced_hosts']) {
          cleanups.push(await pb.collection(collection).subscribe('*', async event => {
            try { await authorize(); await callbacks[collection](event); }
            catch (error) { callbacks.onError?.(error); }
          }));
        }
      } catch (error) { for (const close of cleanups) await close(); throw error; }
      return async () => { for (const close of cleanups) await close(); };
    },
  };
}
