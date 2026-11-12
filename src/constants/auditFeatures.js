// Plain-language names for the activity log. Add a line for every feature id you record with
// recordAudit(). Ids you retire can map to REMOVED_LABEL so old rows still read well until they age
// out (90 days).
export const REMOVED_LABEL = 'Removed feature';

export const FEATURE_LABELS = {
  assistant: 'Assistant',
  assistant_advice: 'Assistant advice',
  data_export: 'Data export',
  data_import: 'Data import',
  backup_create: 'Backup',
  backup_restore: 'Restore from backup',
  sign_in: 'Sign-in',
  cloud_ai_consent: 'Cloud AI settings',
  network_call: 'Internet connection',
};

/** Human label for a feature id; unknown ids fall back to the raw id. */
export const featureLabel = (feature) =>
  Object.hasOwn(FEATURE_LABELS, feature) ? FEATURE_LABELS[feature] : feature;
