/**
 * Affects: velocity_settings select fields consumed by historical 1765100006.
 * Compatibility: PocketBase 0.26.5/0.34.2 require flat Field.values/maxSelect.
 * Runs before the failing historical migration on empty databases. On an upgrade,
 * PocketBase applies missing filenames; existing fields and values are preserved.
 * Data Volume: small; schema only. No historical migration file is rewritten.
 * Rollback: retain fields used by later history; restore a verified backup if needed.
 */
migrate((app) => {
  const collection = app.findCollectionByNameOrId('velocity_settings');
  const definitions = [
    { name: 'player_info_forwarding_mode', values: ['modern', 'legacy', 'bungeeguard', 'none'] },
    { name: 'ping_passthrough', values: ['DISABLED', 'MODS', 'DESCRIPTION', 'ALL'] },
  ];
  for (const definition of definitions) {
    if (!collection.fields.getByName(definition.name)) {
      collection.fields.add(new SelectField({ name: definition.name, values: definition.values, maxSelect: 1 }));
    }
  }
  app.save(collection);
}, (app) => {
  // Do not remove fields still referenced by later historical migrations.
  app.findCollectionByNameOrId('velocity_settings');
});
