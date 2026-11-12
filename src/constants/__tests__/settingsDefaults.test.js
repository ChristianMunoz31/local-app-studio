import { describe, expect, it } from 'vitest';
import {
  BACKGROUND_PRESET_IDS,
  BACKGROUND_PRESETS,
  SETTINGS_DEFAULTS,
  SETTINGS_KEYS,
  normalizeAssistantAdvisorButton,
  normalizeAssistantAutoAdvise,
  normalizeBackground,
  normalizeThemePreference,
} from '../settingsDefaults';

describe('background presets', () => {
  it('lists the neutral presets with the default first', () => {
    expect(BACKGROUND_PRESET_IDS).toEqual(['aurora', 'ocean', 'sunset', 'forest', 'graphite', 'solid']);
    expect(BACKGROUND_PRESETS[0].id).toBe(SETTINGS_DEFAULTS.bgDark);
    for (const p of BACKGROUND_PRESETS) {
      expect(p.label.length).toBeGreaterThan(0);
      expect(p.description).not.toMatch(/[‒-―]/);
    }
  });

  it('keeps a valid preset and falls back to the default for anything else', () => {
    expect(normalizeBackground('ocean')).toBe('ocean');
    expect(normalizeBackground('nope')).toBe('aurora');
    expect(normalizeBackground(undefined)).toBe('aurora');
    expect(normalizeBackground(5)).toBe('aurora');
  });

  it('has no gated or edition-only background: every stored value is a regular preset', () => {
    expect(BACKGROUND_PRESET_IDS).not.toContain('unknown-preset');
    expect(normalizeBackground('unknown-preset')).toBe('aurora');
  });
});

describe('theme preference and assistant switches', () => {
  it('normalizes the theme preference', () => {
    for (const v of ['system', 'light', 'dark']) expect(normalizeThemePreference(v)).toBe(v);
    expect(normalizeThemePreference('sepia')).toBe('system');
  });

  it('normalizes the assistant booleans and defaults them on', () => {
    expect(normalizeAssistantAdvisorButton(false)).toBe(false);
    expect(normalizeAssistantAdvisorButton('no')).toBe(true);
    expect(normalizeAssistantAutoAdvise(false)).toBe(false);
    expect(normalizeAssistantAutoAdvise(undefined)).toBe(true);
  });

  it('keeps device-local bookkeeping keys apart from the synced ones', () => {
    expect(SETTINGS_KEYS.pendingSync.startsWith('storage:')).toBe(true);
    expect(SETTINGS_KEYS.theme).toBe('theme');
  });
});
