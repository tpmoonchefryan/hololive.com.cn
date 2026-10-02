/**
 * Affects: velocity_settings runtime field constraints on previously migrated databases.
 * Compatibility: PocketBase 0.26.5 and 0.34.2 use flat Field properties.
 * Data Volume: small; does not rewrite records or remove values.
 * Rollback: retain corrected constraints; restoring ignored options is not a safe rollback.
 */
migrate((app) => {
  const collection = app.findCollectionByNameOrId('velocity_settings');
  const definitions = {
    player_info_forwarding_mode: { values: ['modern', 'legacy', 'bungeeguard', 'none'], maxSelect: 1 },
    ping_passthrough: { values: ['DISABLED', 'MODS', 'DESCRIPTION', 'ALL'], maxSelect: 1 },
    compression_threshold: { min: -1, max: 65535 },
    compression_level: { min: -1, max: 9 },
    login_ratelimit: { min: 0, max: 600000 },
    connection_timeout: { min: 0, max: 600000 },
    read_timeout: { min: 0, max: 600000 },
  };
  for (const name in definitions) {
    const field = collection.fields.getByName(name);
    if (!field) throw new Error('Missing runtime field: ' + name);
    for (const property in definitions[name]) field[property] = definitions[name][property];
  }
  app.save(collection);
}, (app) => {
  // Forward-compatible constraints are retained; take a verified database backup before upgrades.
  app.findCollectionByNameOrId('velocity_settings');
});
