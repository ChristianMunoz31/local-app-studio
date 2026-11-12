/**
 * Generic only. Never API-key status, last4 or app_state rows.
 * @param {{ themePreference?: string,
 *   advisorButton?: boolean, autoAdvise?: boolean }} input
 */
export function buildSettingsContext({
  themePreference,
  advisorButton,
  autoAdvise,
} = {}) {
  return {
    themePreference: themePreference ?? null,
    advisorButton: !!advisorButton,
    autoAdvise: !!autoAdvise,
  };
}
