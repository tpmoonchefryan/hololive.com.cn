/// <reference path="../pb_data/types.d.ts" />
/**
 * Replace the placeholder zeros that 1789999999 gave compression_threshold,
 * compression_level and login_ratelimit with 256, -1 and 3000: the values the
 * earlier generator wrote as fallbacks and the running Velocity configuration uses.
 *
 * Affects:
 * - collections: velocity_settings
 * - fields/rules/indexes: none; data only for compression_threshold, compression_level, login_ratelimit
 *
 * Compatibility:
 * - PocketBase 0.26.5 and 0.34.2; requires the number fields of 1789999999/1790000001.
 * - Only a record whose three values are all 0 is rewritten. A record with any non-zero
 *   member is configured and stays untouched, so a re-run changes nothing.
 *
 * Data Volume:
 * - small (one settings record in practice); all records are checked before any save.
 *
 * Rollback:
 * - no-op with reason: the zeros were never configured values, and restoring them would
 *   change the generated velocity.toml. Restore the verified deploy backup instead.
 */
migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId('velocity_settings');
    const defaults = { compression_threshold: 256, compression_level: -1, login_ratelimit: 3000 };
    // Reject an unexpected schema before any save; the migration transaction is atomic.
    for (const name in defaults) {
      const field = collection.fields.getByName(name);
      if (!field || field.type() !== 'number') throw new Error('Unsupported Velocity advanced field: ' + name);
    }
    for (const record of app.findAllRecords(collection)) {
      let placeholder = true;
      for (const name in defaults) if (record.get(name) !== 0) placeholder = false;
      if (!placeholder) continue;
      for (const name in defaults) record.set(name, defaults[name]);
      app.save(record);
    }
  },
  (app) => {
    // Forward-only: the placeholder zeros are never restored (see Rollback).
    app.findCollectionByNameOrId('velocity_settings');
  },
);
