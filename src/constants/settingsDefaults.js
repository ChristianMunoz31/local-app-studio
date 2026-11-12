// Single source of truth for user-facing settings: storage keys, defaults, allowed
// values and normalizers. Every setting is persisted through useSyncedSetting
// (localStorage cache + the database's app_state table), so these keys are generic key/value.
// An unknown stored value always normalizes back to the default.
//
// storage:* keys are device-local bookkeeping (the pending-save list). Never
// pass them to useSyncedSetting; they are read/written via utils/syncMode.js only.

export const SETTINGS_KEYS = {
  theme: 'theme',
  bgDark: 'appearance:bgDark',
  bgLight: 'appearance:bgLight',
  pendingSync: 'storage:pendingSync',
  assistantAdvisorButton: 'assistant:advisorButton',
  assistantAutoAdvise: 'assistant:autoAdvise',
};

export const SETTINGS_DEFAULTS = {
  theme: 'system',
  bgDark: 'aurora',
  bgLight: 'aurora',
  assistantAdvisorButton: true,
  assistantAutoAdvise: true,
};

export const THEME_PREFERENCES = ['system', 'light', 'dark'];

// Presets must match the --mesh-<id>-<theme>-<n> vars and swatch rules in
// index.css, and the pre-paint whitelist in the inline script in index.html.
export const BACKGROUND_PRESETS = [
  { id: 'aurora', label: 'Aurora', description: 'Warm amber, indigo and teal glow (default)' },
  { id: 'ocean', label: 'Ocean', description: 'Cool blues and cyan' },
  { id: 'sunset', label: 'Sunset', description: 'Coral, magenta and amber' },
  { id: 'forest', label: 'Forest', description: 'Greens and teal' },
  { id: 'graphite', label: 'Graphite', description: 'Neutral gray, no color' },
  { id: 'solid', label: 'Solid', description: 'Flat background, no gradient' },
];

export const BACKGROUND_PRESET_IDS = BACKGROUND_PRESETS.map((p) => p.id);

function pick(allowed, fallback) {
  return (value) => (allowed.includes(value) ? value : fallback);
}

const pickBoolean = (fallback) => (value) => (typeof value === 'boolean' ? value : fallback);

export const normalizeAssistantAdvisorButton = pickBoolean(SETTINGS_DEFAULTS.assistantAdvisorButton);
export const normalizeAssistantAutoAdvise = pickBoolean(SETTINGS_DEFAULTS.assistantAutoAdvise);

export const normalizeThemePreference = pick(THEME_PREFERENCES, SETTINGS_DEFAULTS.theme);
export const normalizeBackground = pick(BACKGROUND_PRESET_IDS, SETTINGS_DEFAULTS.bgDark);

