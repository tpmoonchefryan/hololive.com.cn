/** Validate actual schema and recorded migration history, independent of CLI exit status. */
export function assertReplayState(collections, history, expectedMigrations) {
  for (const name of ['users', 'posts', 'media', 'server_maps', 'velocity_settings', 'velocity_servers', 'velocity_forced_hosts', 'mcsm_config', 'translation_config']) {
    if (!collections.some(c => c.name === name)) throw new Error(`Missing collection: ${name}`);
  }
  const velocity = collections.find(c => c.name === 'velocity_settings');
  for (const [name, expected] of Object.entries({ player_info_forwarding_mode: ['modern', 'legacy', 'bungeeguard', 'none'], ping_passthrough: ['DISABLED', 'MODS', 'DESCRIPTION', 'ALL'] })) {
    const field = velocity.fields.find(f => f.name === name);
    if (!field || JSON.stringify(field.values) !== JSON.stringify(expected) || field.maxSelect !== 1) throw new Error(`Invalid select field: ${name}`);
  }
  for (const [name, [min, max]] of Object.entries({ compression_threshold: [-1, 65535], compression_level: [-1, 9], login_ratelimit: [0, 600000], connection_timeout: [0, 600000], read_timeout: [0, 600000] })) {
    const field = velocity.fields.find(f => f.name === name);
    if (!field || field.type !== 'number' || field.min !== min || field.max !== max) throw new Error(`Invalid numeric field: ${name}`);
  }
  const users = collections.find(c => c.name === 'users');
  if (!users.fields.some(f => f.name === 'is_admin') || users.updateRule !== null) throw new Error('Missing server-owned authorization');
  for (const file of expectedMigrations) if (!history.includes(file)) throw new Error(`Unapplied migration: ${file}`);
  return { collections: collections.length, migrations: expectedMigrations.length };
}
