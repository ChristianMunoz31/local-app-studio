// Fixture cloud categories for the privacy tests, so they exercise the category machinery (single, list and public
// entries) without depending on what the real modules contribute. Use it like the probe table helper:
//   vi.mock('../modules/studio.data.js', (orig) => import('./helpers/fixtureModules.js').then((m) => m.withFixtureCategories(orig)))
//   vi.mock('../../src/modules/studio.assistant.js', (orig) => import('./helpers/fixtureModules.js').then((m) => m.withFixturePages(orig)))
// The real tables stay registered. withFixtureCategories replaces the cloud categories, page categories and tool
// categories (or adds to them with { keepReal: true }, for a test that also runs the real list_features tool).
// Categories: alpha (shared by default) and beta (not shared by default). Their nouns read like the old kit's so the
// fixed copy is easy to assert: alpha is "items", beta is "item notes".
// Tools: read_alpha -> alpha, read_both -> [alpha, beta], read_public -> null (no private data).
// Pages (need withFixturePages as well): alpha_page -> alpha, both_page -> [alpha, beta].

export const FIXTURE_CATEGORIES = Object.freeze([
  Object.freeze({ id: 'alpha', default: true, noun: 'items', plural: true }),
  Object.freeze({ id: 'beta', default: false, noun: 'item notes', plural: true }),
]);

export const FIXTURE_TOOL_CATEGORIES = Object.freeze({
  read_alpha: 'alpha',
  read_both: Object.freeze(['alpha', 'beta']),
  read_public: null,
});

export const FIXTURE_PAGE_CATEGORIES = Object.freeze({
  alpha_page: 'alpha',
  both_page: Object.freeze(['alpha', 'beta']),
});

/**
 * @param {() => Promise<{ default: object }>} importOriginal
 * @param {{ keepReal?: boolean }} [opts]
 * @returns {Promise<{ default: object }>}
 */
export async function withFixtureCategories(importOriginal, { keepReal = false } = {}) {
  const real = (await importOriginal()).default;
  return {
    default: {
      ...real,
      cloudCategories: [...(keepReal ? real.cloudCategories : []), ...FIXTURE_CATEGORIES],
      pageCategories: { ...(keepReal ? real.pageCategories : {}), ...FIXTURE_PAGE_CATEGORIES },
      toolCategories: { ...(keepReal ? real.toolCategories : {}), ...FIXTURE_TOOL_CATEGORIES },
    },
  };
}

/**
 * The Studio Assistant pages plus the fixture pages, for `vi.mock('../../src/modules/studio.assistant.js', ...)`.
 * @param {() => Promise<object>} importOriginal
 * @returns {Promise<object>}
 */
export async function withFixturePages(importOriginal) {
  const real = await importOriginal();
  return {
    ...real,
    ASSISTANT_PAGES: Object.freeze({
      ...real.ASSISTANT_PAGES,
      alpha_page: { label: 'Alpha', suggestions: [] },
      both_page: { label: 'Both', suggestions: [] },
    }),
  };
}
