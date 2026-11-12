// Assistant pages of the Studio module. Pure data with NO imports: src/constants/assistantPages.js and
// server/assistant/pages.js both read it, and the Node parity test loads it. Replaced by studio.assistant.disabled.js
// in a runtime build. Studio has no Assistant pages yet (the designer and preview spike pages are not advised on).

/** @type {Readonly<Record<string, { label: string, suggestions: readonly string[] }>>} */
export const ASSISTANT_PAGES = Object.freeze({});

/** Page key for a route no page claims, or null for none. */
export const FALLBACK_PAGE_KEY = null;
