import { describe, it, expect } from 'vitest';
import { serializeAssistantContext, TRUNCATION_MARKER } from '../../assistantContext';
import { buildHomeContext } from '../home';
import { buildSettingsContext } from '../settings';
import { buildFallbackContext } from '../fallback';
import { ASSISTANT_CONTEXT_MAX_CHARS, ASSISTANT_PAGE_KEYS } from '../../../constants/assistantPages';

const NOW = new Date(2026, 9, 2, 12, 0);
const many = (n, make) => Array.from({ length: n }, (_, i) => make(i));

// Secret-bearing free text. Each fragment must be scrubbed by redaction.
const LEAK =
  'sk-abcdefghijklmnopqrstuvwx Bearer abc123tokenvalue eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0 bob@example.com';
const FRAGMENTS = ['sk-abcdefghij', 'abc123tokenvalue', 'eyJhbGciOiJIUzI1', 'bob@example.com'];

const serialize = (pageKey, data) => serializeAssistantContext({ pageKey, data, now: NOW });

describe('every page key has a builder or the generic fallback', () => {
  const BUILDERS = {
    home: () => buildHomeContext({ sections: [] }),
    settings: () => buildSettingsContext({}),
  };
  it('covers every page key the server knows', () => {
    for (const key of ASSISTANT_PAGE_KEYS) {
      const data = (BUILDERS[key] ?? (() => buildFallbackContext({ routeName: key, title: key })))();
      expect(data, key).toBeTruthy();
      expect(serialize(key, data).truncated, key).toBe(false);
    }
  });
});

describe('redaction and size caps hold for every builder', () => {
  const leaky = {
    home: () => buildHomeContext({ sections: [LEAK] }),
    fallback: () => buildFallbackContext({ routeName: LEAK, title: LEAK }),
  };

  it.each(Object.entries(leaky))('%s: secrets and emails in user text never reach the serialized context', (key, build) => {
    const { context } = serialize(key === 'fallback' ? 'settings' : key, build());
    for (const fragment of FRAGMENTS) expect(context, fragment).not.toContain(fragment);
  });

  it('a very large section list is capped: the context stays under the limit and says it was cut', () => {
    const sections = many(5000, (i) => `Section number ${i} ${'x'.repeat(40)}`);
    const { context, truncated } = serialize('home', buildHomeContext({ sections }));
    expect(context.length).toBeLessThanOrEqual(ASSISTANT_CONTEXT_MAX_CHARS);
    if (truncated) expect(context.endsWith(TRUNCATION_MARKER)).toBe(true);
  });

  it('the serialized context carries the page key, today and local time for the model', () => {
    const { context } = serialize('home', buildHomeContext({ sections: [] }));
    const parsed = JSON.parse(context);
    expect(parsed).toMatchObject({ page: 'home', today: '2026-10-02', localTime: '12:00' });
    expect(parsed.data.sections).toEqual([]);
  });
});
