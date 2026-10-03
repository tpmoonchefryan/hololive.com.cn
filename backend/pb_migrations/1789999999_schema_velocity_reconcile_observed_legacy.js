/**
 * Affects: observed legacy velocity_settings text selections and absent numbers.
 * Compatibility: PocketBase 0.26.5 and 0.34.2; forward-only schema reconciliation.
 * Data Volume: all settings records are checked before any schema change.
 * Rollback: preserve this contract; restore an independently verified safe set.
 * Missing optional numbers use PocketBase's unconfigured zero value. This is
 * not discovery of live Java settings; maintenance guard remains mandatory.
 */
migrate((app) => {
  const collection = app.findCollectionByNameOrId('velocity_settings');
  const records = app.findAllRecords(collection);
  const selections = {
    player_info_forwarding_mode: ['modern', 'legacy', 'bungeeguard', 'none'],
    ping_passthrough: ['DISABLED', 'MODS', 'DESCRIPTION', 'ALL'],
  };
  const numbers = {
    compression_threshold: [-1, 65535], compression_level: [-1, 9],
    login_ratelimit: [0, 600000], connection_timeout: [0, 600000], read_timeout: [0, 600000],
  };
  // Reject unknown types/values before app.save; migration transaction is atomic.
  for (const name in selections) {
    const field = collection.fields.getByName(name);
    if (!field || (field.type() !== 'text' && field.type() !== 'select')) throw new Error('Unsupported legacy selection type: ' + name);
    for (const record of records) {
      const value = record.get(name);
      if (typeof value !== 'string' || (value !== '' && selections[name].indexOf(value) < 0)) throw new Error('Invalid legacy selection value: ' + name);
    }
  }
  for (const name in numbers) {
    const field = collection.fields.getByName(name);
    if (!field && ['compression_threshold', 'compression_level', 'login_ratelimit'].indexOf(name) < 0) throw new Error('Missing observed legacy numeric field: ' + name);
    if (field && field.type() !== 'number') throw new Error('Unsupported legacy numeric type: ' + name);
    if (field) for (const record of records) {
      const value = record.get(name);
      if (typeof value !== 'number' || !isFinite(value) || value < numbers[name][0] || value > numbers[name][1]) throw new Error('Invalid legacy numeric value: ' + name);
    }
  }
  const conversions = [];
  for (const name in selections) if (collection.fields.getByName(name).type() === 'text') conversions.push(name);
  const preserved = records.map(record => ({ id: record.id, values: conversions.map(name => record.get(name)) }));
  // PB forbids changing a persisted field's type in place. Remove/recreate in
  // the migration transaction, then restore every captured legal value.
  for (const name of conversions) collection.fields.removeByName(name);
  if (conversions.length) app.save(collection);
  for (const name of conversions) collection.fields.add(new SelectField({ name, values: selections[name], maxSelect: 1 }));
  for (const name in numbers) if (!collection.fields.getByName(name)) collection.fields.add(new NumberField({ name, min: numbers[name][0], max: numbers[name][1] }));
  app.save(collection);
  if (conversions.length) for (const saved of preserved) {
    const record = app.findRecordById(collection.id, saved.id);
    for (let i = 0; i < conversions.length; i++) record.set(conversions[i], saved.values[i]);
    app.save(record);
  }
}, (app) => {
  // Never downgrade selections or delete fields/data used by later history.
  app.findCollectionByNameOrId('velocity_settings');
});
