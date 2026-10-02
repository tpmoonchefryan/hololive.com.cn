onRecordAuthWithPasswordRequest((e) => {
  const record = e.record;
  // Service identities are explicitly provisioned by a superuser and retain their path.
  if (!record || !record.getBool('is_admin') || (!record.getBool('verified') && !record.getBool('service_account'))) {
    throw new ForbiddenError('Administrator authorization required');
  }
  if (!record.getBool('service_account')) {
    const settings = $app.findFirstRecordByFilter('system_settings', '');
    if (!settings.getBool('enable_local_login')) throw new ForbiddenError('Local password login is disabled');
  }
  e.next();
}, 'users');
