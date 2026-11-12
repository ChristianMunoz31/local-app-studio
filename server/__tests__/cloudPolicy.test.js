// Cloud AI category policy over the fixture modules (helpers/fixtureModules.js: categories alpha and beta, tools
// read_alpha, read_both and read_public): the policy decides per page and tool, the page filter drops withheld data,
// and the fixed copy is exact and free of em dashes. That the real mappings are complete is checked in
// studio/studioTools.test.js.
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../loadEnv.js', () => ({}));
vi.mock('../modules/studio.data.js', (orig) => import('./helpers/fixtureModules.js').then((m) => m.withFixtureCategories(orig)));
vi.mock('../../src/modules/studio.assistant.js', (orig) => import('./helpers/fixtureModules.js').then((m) => m.withFixturePages(orig)));

import {
  CATEGORY_NOUNS,
  CLOUD_CATEGORY_DEFAULTS,
  CLOUD_CATEGORY_IDS,
  PAGE_CATEGORIES,
  TOOL_CATEGORIES,
  applyPagePolicy,
  categoryList,
  createAiPolicy,
  sanitizeCloudCategories,
  withheldMessage,
  withheldToolResult,
} from '../ai/privacy.js';
import { ASSISTANT_PAGE_LABELS } from '../assistant/pages.js';

const EM_DASH = /[‒-―]/;
const cloud = (categories = {}) => createAiPolicy({ isCloud: true, categories: { ...CLOUD_CATEGORY_DEFAULTS, ...categories } });
const local = () => createAiPolicy({ isCloud: false });

describe('categories and defaults', () => {
  it('lists the ids in order, with memory never one of them', () => {
    expect(CLOUD_CATEGORY_IDS).toEqual(['alpha', 'beta']);
    expect(CLOUD_CATEGORY_IDS).not.toContain('memory');
  });

  it('shares what each category declares by default', () => {
    expect(Object.keys(CLOUD_CATEGORY_DEFAULTS)).toEqual(CLOUD_CATEGORY_IDS);
    expect(CLOUD_CATEGORY_IDS.filter((id) => !CLOUD_CATEGORY_DEFAULTS[id])).toEqual(['beta']);
  });

  it('sanitizeCloudCategories keeps known ids with boolean values only', () => {
    expect(sanitizeCloudCategories({ beta: true, alpha: 'yes', bogus: true, memory: true })).toEqual({ beta: true });
    expect(sanitizeCloudCategories({ alpha: false })).toEqual({ alpha: false });
    expect(sanitizeCloudCategories(null)).toEqual({});
    expect(sanitizeCloudCategories([true])).toEqual({});
  });
});

describe('categoryList', () => {
  it('turns a string into a one-item list and normalizes arrays to category order', () => {
    expect(categoryList('alpha')).toEqual(['alpha']);
    expect(categoryList(['beta', 'alpha'])).toEqual(['alpha', 'beta']);
    expect(categoryList(['alpha', 'alpha'])).toEqual(['alpha']);
  });

  it('is undefined for anything malformed', () => {
    for (const bad of [[], ['bogus'], ['alpha', 'memory'], ['mixed'], [null], {}, null, undefined, 5, 'mixed']) expect(categoryList(bad)).toBeUndefined();
  });
});

describe('the fixture mappings', () => {
  it('the tool map holds exactly the fixture tools, and no Items tool or mixed entry survives', () => {
    expect(Object.keys(TOOL_CATEGORIES).sort()).toEqual(['read_alpha', 'read_both', 'read_public']);
    expect(Object.values(TOOL_CATEGORIES)).not.toContain('mixed');
  });

  it('maps every Assistant page, and nothing else; the kit pages carry no private data', () => {
    expect(Object.keys(PAGE_CATEGORIES).sort()).toEqual(Object.keys(ASSISTANT_PAGE_LABELS).sort());
    expect(PAGE_CATEGORIES.home).toBeNull();
    expect(PAGE_CATEGORIES.settings).toBeNull();
    expect(PAGE_CATEGORIES.alpha_page).toBe('alpha');
    expect(PAGE_CATEGORIES.both_page).toEqual(['alpha', 'beta']);
  });

  it('every mapped category is a real category, null (always shared) or a list of real ones', () => {
    for (const [key, category] of [...Object.entries(TOOL_CATEGORIES), ...Object.entries(PAGE_CATEGORIES)]) {
      if (category === null) continue;
      if (Array.isArray(category)) {
        expect(category.length, key).toBeGreaterThan(0);
        expect(new Set(category).size, key).toBe(category.length);
        for (const id of category) expect(CLOUD_CATEGORY_IDS, key).toContain(id);
      } else expect(CLOUD_CATEGORY_IDS, key).toContain(category);
    }
  });

  it('has a noun for every category', () => {
    expect(Object.keys(CATEGORY_NOUNS)).toEqual(CLOUD_CATEGORY_IDS);
  });

  it('the search machinery is gone', () => {
    expect(Object.keys(TOOL_CATEGORIES)).not.toContain('search_data');
  });
});

describe('createAiPolicy', () => {
  it('local allows every category, memory and anything unknown', () => {
    const p = local();
    expect(p.isCloud).toBe(false);
    expect([...p.allowed]).toEqual(CLOUD_CATEGORY_IDS);
    expect(p.allows('beta')).toBe(true);
    expect(p.allows('memory')).toBe(true);
  });

  it('cloud allows only the ticked categories; null is always allowed; memory and unknown never', () => {
    const p = cloud();
    expect([...p.allowed]).toEqual(['alpha']);
    expect(p.allows('alpha')).toBe(true);
    expect(p.allows('beta')).toBe(false);
    expect(p.allows(null)).toBe(true);
    expect(p.allows(undefined)).toBe(true);
    expect(p.allows('memory')).toBe(false);
    expect(p.allows('bogus')).toBe(false);
  });

  it('is frozen', () => {
    const p = cloud();
    expect(Object.isFrozen(p)).toBe(true);
    expect(Object.isFrozen(p.allowed)).toBe(true);
  });

  it('missing keys use the defaults and unknown keys are dropped', () => {
    const p = createAiPolicy({ isCloud: true, categories: { beta: true, bogus: true } });
    expect(p.allows('beta')).toBe(true);
    expect(p.allows('alpha')).toBe(true);
    expect(p.allows('bogus')).toBe(false);
  });

  describe('pageDecision', () => {
    it('a page with no category is public and allowed', () => {
      expect(cloud().pageDecision('settings')).toEqual({ allowed: true, mode: 'public', categories: [], withheld: [] });
    });

    describe('a page mapped to one category (test seam)', () => {
      const one = (categories = {}) =>
        createAiPolicy({ isCloud: true, categories: { ...CLOUD_CATEGORY_DEFAULTS, ...categories }, pageCategories: { single: 'alpha' } });

      it('follows its category', () => {
        expect(one().pageDecision('single')).toEqual({ allowed: true, mode: 'single', categories: ['alpha'], withheld: [] });
        expect(one({ alpha: false }).pageDecision('single')).toEqual({ allowed: false, mode: 'single', categories: ['alpha'], withheld: ['alpha'] });
      });
    });

    it('an unknown page is not allowed under cloud and allowed locally', () => {
      expect(cloud().pageDecision('nope').allowed).toBe(false);
      expect(local().pageDecision('nope').allowed).toBe(true);
    });

    it('local allows every page', () => {
      for (const page of Object.keys(ASSISTANT_PAGE_LABELS)) expect(local().pageDecision(page).allowed, page).toBe(true);
    });

    describe('a page mapped to a list (test seam)', () => {
      const fixture = (isCloud, categories = {}) =>
        createAiPolicy({
          isCloud,
          categories: { ...CLOUD_CATEGORY_DEFAULTS, ...categories },
          pageCategories: { both: ['beta', 'alpha'], empty: [], bad: ['alpha', 'bogus'] },
        });

      it('is allowed only when every category is shared', () => {
        expect(fixture(true, { beta: true }).pageDecision('both')).toEqual({ allowed: true, mode: 'single', categories: ['alpha', 'beta'], withheld: [] });
        expect(fixture(true).pageDecision('both')).toEqual({ allowed: false, mode: 'single', categories: ['alpha', 'beta'], withheld: ['beta'] });
        expect(fixture(true, { alpha: false, beta: false }).pageDecision('both').withheld).toEqual(['alpha', 'beta']);
      });

      it('an empty or unknown list is refused under cloud and allowed locally', () => {
        const refused = { allowed: false, mode: 'single', categories: [], withheld: [] };
        expect(fixture(true, { beta: true }).pageDecision('empty')).toEqual(refused);
        expect(fixture(true, { beta: true }).pageDecision('bad')).toEqual(refused);
        expect(fixture(false).pageDecision('empty')).toEqual({ allowed: true, mode: 'single', categories: [], withheld: [] });
        expect(fixture(false).pageDecision('bad').allowed).toBe(true);
      });

      it('applyPagePolicy blocks with the denied names and passes the full list when allowed', () => {
        const input = { page: 'both', context: 'secret text', messages: [{ role: 'user', content: 'q' }] };
        expect(applyPagePolicy(input, fixture(true))).toEqual({ allowed: false, context: '', messages: [], categories: [], withheld: ['beta'] });
        expect(applyPagePolicy(input, fixture(true, { beta: true }))).toMatchObject({ allowed: true, context: 'secret text', categories: ['alpha', 'beta'], withheld: [] });
      });

      it('omitting the seam keeps the real pages', () => {
        const real = createAiPolicy({ isCloud: true, categories: CLOUD_CATEGORY_DEFAULTS });
        expect(real.pageDecision('home')).toEqual({ allowed: true, mode: 'public', categories: [], withheld: [] });
        expect(real.pageDecision('both').allowed).toBe(false);
      });
    });
  });

  describe('toolDecision', () => {
    it('allows a tool whose category is shared and refuses one that is not', () => {
      expect(cloud().toolDecision('read_alpha', {})).toMatchObject({ allowed: true, categories: ['alpha'], withheld: [] });
      expect(cloud().toolDecision('read_both', {})).toMatchObject({ allowed: false, categories: [], withheld: ['beta'] });
      expect(cloud({ beta: true }).toolDecision('read_both', {}).allowed).toBe(true);
      expect(cloud({ alpha: false }).toolDecision('read_alpha', { name: 'x' })).toMatchObject({ allowed: false, withheld: ['alpha'] });
    });

    it('an unknown tool is never allowed under cloud, and allowed locally', () => {
      expect(cloud().toolDecision('format_disk', {})).toMatchObject({ allowed: false, withheld: [] });
      expect(local().toolDecision('format_disk', {}).allowed).toBe(true);
    });

    it('read_alpha follows alpha, read_public is always allowed, and the args are passed through untouched', () => {
      const args = { query: 'x', kinds: ['beta'] };
      expect(cloud().toolDecision('read_alpha', args)).toMatchObject({ allowed: true, args, categories: ['alpha'] });
      expect(cloud({ alpha: false }).toolDecision('read_alpha', args)).toMatchObject({ allowed: false, withheld: ['alpha'] });
      expect(cloud({ alpha: false, beta: false }).toolDecision('read_public', args)).toMatchObject({ allowed: true, categories: [], withheld: [] });
    });

    it('search_data and mixed are gone: an unknown tool name is refused under cloud', () => {
      expect(cloud().toolDecision('search_data', { query: 'x' })).toMatchObject({ allowed: false, withheld: [] });
    });

    it('a multi-category tool (read_both) needs every category shared', () => {
      expect(cloud().toolDecision('read_both', {})).toMatchObject({ allowed: false, categories: [], withheld: ['beta'] });
      expect(cloud({ beta: true }).toolDecision('read_both', {})).toMatchObject({ allowed: true, categories: ['alpha', 'beta'], withheld: [] });
      expect(cloud({ beta: true, alpha: false }).toolDecision('read_both', {})).toMatchObject({ allowed: false, categories: [], withheld: ['alpha'] });
      expect(cloud({ alpha: false }).toolDecision('read_both', {})).toMatchObject({ allowed: false, withheld: ['alpha', 'beta'] });
      expect(local().toolDecision('read_both', {}).allowed).toBe(true);
    });
  });
});

describe('fixed copy', () => {
  it('names one plural category with "aren\'t"', () => {
    expect(withheldMessage(['alpha'])).toBe("Your items aren't shared with cloud AI. You can change that in Settings > AI.");
    expect(withheldMessage(['beta'])).toBe("Your item notes aren't shared with cloud AI. You can change that in Settings > AI.");
  });

  it('joins two as "a and b" in category order, whatever order they come in', () => {
    expect(withheldMessage(['beta', 'alpha'])).toBe("Your items and item notes aren't shared with cloud AI. You can change that in Settings > AI.");
  });

  it('ignores unknown ids and has a generic fallback', () => {
    expect(withheldMessage(['bogus', 'beta'])).toBe(withheldMessage(['beta']));
    expect(withheldMessage([])).toBe("That isn't shared with cloud AI. You can change that in Settings > AI.");
  });

  it('withheld tool results say what is missing and tell the model not to guess', () => {
    expect(withheldToolResult('beta')).toEqual({
      not_shared: true,
      category: 'beta',
      message: "The user's item notes are not shared with cloud AI. Do not guess it.",
    });
    expect(withheldToolResult('alpha').message).toBe("The user's items are not shared with cloud AI. Do not guess it.");
    expect(withheldToolResult(undefined)).toMatchObject({ not_shared: true, category: null });
  });

  it('a list of categories gets one result: a single id equals the string form, several name them all', () => {
    expect(withheldToolResult(['beta'])).toEqual(withheldToolResult('beta'));
    expect(withheldToolResult(['beta', 'alpha'])).toEqual({
      not_shared: true,
      category: null,
      categories: ['alpha', 'beta'],
      message: "The user's items and item notes are not shared with cloud AI. Do not guess them.",
    });
    for (const generic of [withheldToolResult([]), withheldToolResult(['bogus']), withheldToolResult(null)]) {
      expect(generic).toEqual({ not_shared: true, category: null, message: 'That data is not shared with cloud AI. Do not guess it.' });
    }
  });

  it('no message contains an em dash or an en dash', () => {
    const all = [
      ...CLOUD_CATEGORY_IDS.map((id) => withheldMessage([id])),
      withheldMessage(CLOUD_CATEGORY_IDS),
      ...CLOUD_CATEGORY_IDS.map((id) => withheldToolResult(id).message),
      withheldToolResult(null).message,
      withheldToolResult(CLOUD_CATEGORY_IDS).message,
    ];
    for (const text of all) expect(text).not.toMatch(EM_DASH);
  });
});

describe('applyPagePolicy', () => {
  const messages = [
    { role: 'user', content: 'first' },
    { role: 'assistant', content: 'earlier answer' },
    { role: 'user', content: 'last' },
  ];

  const seamed = (categories = {}) =>
    createAiPolicy({ isCloud: true, categories: { ...CLOUD_CATEGORY_DEFAULTS, ...categories }, pageCategories: { single: 'alpha' } });

  it('local passes everything through unchanged', () => {
    const input = { page: 'single', context: '{"counts":{"total":2}}', messages };
    expect(applyPagePolicy(input, local())).toMatchObject({ allowed: true, context: input.context, messages, withheld: [] });
  });

  it('a withheld single-category page is blocked with nothing to send', () => {
    expect(applyPagePolicy({ page: 'single', context: 'secret text', messages }, seamed({ alpha: false }))).toEqual({
      allowed: false,
      context: '',
      messages: [],
      categories: [],
      withheld: ['alpha'],
    });
  });

  it('an allowed single-category page passes the context and only the user messages', () => {
    const out = applyPagePolicy({ page: 'single', context: '{"open":2}', messages }, seamed());
    const users = messages.filter((m) => m.role === 'user').map((m) => m.content);
    expect(out).toMatchObject({ allowed: true, context: '{"open":2}', categories: ['alpha'], withheld: [] });
    expect(out.messages).toEqual([{ role: 'user', content: users.join('\n\n') }]);
  });

  it('a page with no category passes under cloud with every category off', () => {
    const out = applyPagePolicy({ page: 'settings', context: '{}', messages }, cloud({ alpha: false, beta: false }));
    expect(out).toMatchObject({ allowed: true, categories: [], withheld: [] });
  });
});
