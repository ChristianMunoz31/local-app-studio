import { describe, it, expect } from 'vitest';
import { buildHomeContext } from '../home';
import { buildSettingsContext } from '../settings';
import { buildFallbackContext } from '../fallback';

describe('buildHomeContext', () => {
  it('hands over the section names and nothing else', () => {
    expect(buildHomeContext({ sections: ['Apps', 'Features'] })).toEqual({ sections: ['Apps', 'Features'] });
    expect(buildHomeContext()).toEqual({ sections: [] });
    expect(buildHomeContext({ sections: ['Apps', 3, null] })).toEqual({ sections: ['Apps'] });
  });
});

describe('buildSettingsContext', () => {
  it('is generic: preferences only, never keys, last4 or stored rows', () => {
    const ctx = buildSettingsContext({ themePreference: 'dark', advisorButton: 1, autoAdvise: 0, apiKey: 'sk-secret', last4: '1234' });
    expect(ctx).toEqual({ themePreference: 'dark', advisorButton: true, autoAdvise: false });
    expect(buildSettingsContext()).toEqual({ themePreference: null, advisorButton: false, autoAdvise: false });
  });
});

describe('buildFallbackContext', () => {
  it('is the route name and title, clipped', () => {
    expect(buildFallbackContext({ routeName: 'items', title: 'Items' })).toEqual({ route: 'items', title: 'Items' });
    expect(buildFallbackContext({ routeName: 'r'.repeat(200), title: 't'.repeat(200) }).route.length).toBeLessThanOrEqual(60);
    expect(buildFallbackContext()).toEqual({ route: '', title: '' });
  });
});
