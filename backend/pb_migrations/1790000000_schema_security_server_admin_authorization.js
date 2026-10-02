/**
 * Server-owned authorization. No existing email whitelist is promoted.
 * Provision verified admins/service accounts through the PocketBase superuser API.
 * Rollback deliberately locks writes; restoring permissive rules requires a separate decision.
 */
migrate((app) => {
  const users = app.findCollectionByNameOrId('users');
  for (const name of ['is_admin', 'service_account']) {
    if (!users.fields.getByName(name)) users.fields.add(new BoolField({ name }));
  }
  users.createRule = null;
  users.updateRule = null;
  users.deleteRule = null;
  users.listRule = 'id = @request.auth.id';
  users.viewRule = 'id = @request.auth.id';
  app.save(users);
  const admin = '@request.auth.id != "" && @request.auth.is_admin = true && (@request.auth.verified = true || @request.auth.service_account = true)';
  const collections = ['media', 'posts', 'announcements', 'whitelists', 'extra_whitelist', 'system_settings', 'cms_sections', 'server_maps', 'server_info_details', 'audit_logs', 'velocity_settings', 'velocity_servers', 'velocity_forced_hosts', 'mcsm_config', 'translation_config'];
  for (const name of collections) {
    let collection;
    try { collection = app.findCollectionByNameOrId(name); } catch { continue; }
    for (const rule of ['createRule', 'updateRule', 'deleteRule']) {
      if (collection[rule] !== null) collection[rule] = admin;
    }
    const publicCollections = ['media', 'announcements', 'system_settings', 'cms_sections', 'server_maps', 'server_info_details'];
    const readRule = name === 'posts' ? `is_public = true || (${admin})` : publicCollections.includes(name) ? '' : admin;
    collection.listRule = readRule;
    collection.viewRule = readRule;
    app.save(collection);
  }
}, (app) => {
  // A security rollback must not restore anonymous/ordinary-account write access.
  const users = app.findCollectionByNameOrId('users');
  users.createRule = users.updateRule = users.deleteRule = null;
  app.save(users);
});
