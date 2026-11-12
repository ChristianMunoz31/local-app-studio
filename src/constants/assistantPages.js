// Page catalogue for the Assistant page advisor. Its only imports are the pure-data module page lists (no imports of
// their own) and the app mode: the backend parity test (server/__tests__/assistantPagesParity.test.js) imports this
// from Node and compares it with server/assistant/pages.js.
import { APP_MODE } from '../appMode.js';
import * as runtimePages from '../modules/runtime.assistant.js';
import * as studioPages from '../modules/studio.assistant.js';

export const ASSISTANT_CONTEXT_MAX_CHARS = 4000;
export const ASSISTANT_MAX_MESSAGES = 12; // wire window sent to the server
export const ASSISTANT_MAX_MESSAGE_CHARS = 4000; // server cap per message
export const ASSISTANT_MAX_TOTAL_MESSAGE_CHARS = 16000; // server cap across the whole wire window
export const ASSISTANT_MAX_INPUT_CHARS = 1000; // composer maxLength (user typing)

// Only the active mode's module contributes pages (a runtime build swaps the Studio file for a stub).
const ACTIVE_MODULE_PAGES = APP_MODE === 'runtime' ? runtimePages : studioPages;

// A runtime build replaces the kit's Home route (replacesKitPaths ['/'] in src/modules/runtime.jsx), so it
// has no kit Home advice: a spec page at /home must not resolve to it.
const KIT_PAGES = {
  ...(APP_MODE === 'runtime'
    ? {}
    : {
        home: {
          label: 'Home',
          suggestions: ['Give me a quick overview', 'What can I do here?'],
        },
      }),
  settings: { label: 'Settings', suggestions: ['Which settings should I review?'] },
};

const mergePages = () => {
  const merged = { ...KIT_PAGES };
  for (const [key, page] of Object.entries(ACTIVE_MODULE_PAGES.ASSISTANT_PAGES)) {
    if (Object.prototype.hasOwnProperty.call(merged, key)) throw new Error(`Duplicate assistant page "${key}"`);
    merged[key] = page;
  }
  return merged;
};

/** @type {Readonly<Record<string, { label: string, suggestions: readonly string[] }>>} */
export const ASSISTANT_PAGES = Object.freeze(mergePages());

export const ASSISTANT_PAGE_KEYS = Object.freeze(Object.keys(ASSISTANT_PAGES));

const hasPage = (key) => Object.prototype.hasOwnProperty.call(ASSISTANT_PAGES, key);

/**
 * Pathname to page key, or null when the route is unknown.
 * @param {string} pathname
 * @returns {string | null}
 */
export function resolveAssistantPageKey(pathname) {
  let path = String(pathname ?? '').toLowerCase();
  path = path.replace(/\/+$/, '');
  if (path === '') path = '/';
  // A built app has no kit Home: its home page is the spec's, advised as the app page.
  if (path === '/') return APP_MODE === 'runtime' ? (ACTIVE_MODULE_PAGES.FALLBACK_PAGE_KEY ?? 'home') : 'home';
  const first = path.split('/')[1] ?? '';
  return hasPage(first) ? first : (ACTIVE_MODULE_PAGES.FALLBACK_PAGE_KEY ?? null);
}
