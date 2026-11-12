import { describe, it, expect, vi } from 'vitest';
import {
  ASSISTANT_PAGES,
  ASSISTANT_PAGE_KEYS,
  ASSISTANT_MAX_TOTAL_MESSAGE_CHARS,
  resolveAssistantPageKey,
} from '../assistantPages';

describe('resolveAssistantPageKey', () => {
  it.each([
    ['/', 'home'],
    ['/settings/', 'settings'],
    ['/settings/extra', 'settings'],
    ['/items', null],
    ['/settings', 'settings'],
    ['/SETTINGS', 'settings'],
    ['/missing', null],
    ['/agents', null],
    ['/nope', null],
    ['/constructor', null],
  ])('%s -> %s', (path, key) => {
    expect(resolveAssistantPageKey(path)).toBe(key);
  });
});

describe('ASSISTANT_PAGES', () => {
  it('gives every key a label and at least one suggestion', () => {
    for (const key of ASSISTANT_PAGE_KEYS) {
      expect(ASSISTANT_PAGES[key].label).toBeTruthy();
      expect(ASSISTANT_PAGES[key].suggestions.length).toBeGreaterThan(0);
    }
  });
});

describe('resolveAssistantPageKey in a runtime build', () => {
  it('resolves / to the fallback page key, other routes as before', async () => {
    vi.resetModules();
    vi.doMock('../../appMode.js', () => ({ APP_MODE: 'runtime' }));
    try {
      const runtime = await import('../assistantPages');
      expect(runtime.resolveAssistantPageKey('/')).toBe('app');
      expect(runtime.resolveAssistantPageKey('/data')).toBe('data');
      expect(runtime.resolveAssistantPageKey('/people/new')).toBe('app');
      expect(runtime.resolveAssistantPageKey('/settings')).toBe('settings');
    } finally {
      vi.doUnmock('../../appMode.js');
      vi.resetModules();
    }
  });

  it('has no kit Home advice, so a spec page at /home falls back to the app page', async () => {
    vi.resetModules();
    vi.doMock('../../appMode.js', () => ({ APP_MODE: 'runtime' }));
    try {
      const runtime = await import('../assistantPages');
      expect(runtime.ASSISTANT_PAGE_KEYS).not.toContain('home');
      expect([...runtime.ASSISTANT_PAGE_KEYS].sort()).toEqual(['app', 'data', 'settings']);
      expect(runtime.resolveAssistantPageKey('/home')).toBe('app');
    } finally {
      vi.doUnmock('../../appMode.js');
      vi.resetModules();
    }
  });

  it('keeps / on home in Studio', () => {
    expect(resolveAssistantPageKey('/')).toBe('home');
  });
});

describe('caps', () => {
  it('exports the total message cap', () => {
    expect(ASSISTANT_MAX_TOTAL_MESSAGE_CHARS).toBe(16000);
  });
});
