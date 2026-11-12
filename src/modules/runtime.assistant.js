// Assistant pages of the runtime module (a built app). Pure data with NO imports: src/constants/assistantPages.js and
// server/assistant/pages.js both read it, and the Node parity test loads it. Only used when the app mode is runtime.
// Phase 2 owns this file; the server also needs a pageCategories entry per key in server/modules/runtime.data.js
// (a page without one is refused under a cloud provider).

/** @type {Readonly<Record<string, { label: string, suggestions: readonly string[] }>>} */
export const ASSISTANT_PAGES = Object.freeze({
  app: {
    label: 'App',
    suggestions: ['Give me a quick overview', 'What should I look at first?'],
  },
  data: {
    label: 'Data',
    suggestions: ['What is in my data?', 'Which tables have the most rows?'],
  },
});

/** Page key for a route no page claims, or null for none. */
export const FALLBACK_PAGE_KEY = 'app';
