// Assistant page advisor: server-side page allowlist and size caps.
// Mirrors src/constants/assistantPages.js (a parity test keeps the two in sync).
import { getAppMode } from '../appMode.js';
import { ASSISTANT_PAGES as RUNTIME_PAGES } from '../../src/modules/runtime.assistant.js';
import { ASSISTANT_PAGES as STUDIO_PAGES } from '../../src/modules/studio.assistant.js';

export const ASSISTANT_CONTEXT_MAX_CHARS = 4000;
export const ASSISTANT_MAX_MESSAGES = 12;
export const ASSISTANT_MAX_MESSAGE_CHARS = 4000;
export const ASSISTANT_MAX_TOTAL_MESSAGE_CHARS = 16000;

// A runtime build replaces the kit's Home route (src/modules/runtime.jsx), so it has no kit advice for it.
const KIT_PAGE_LABELS =
  getAppMode() === 'runtime' ? { settings: 'Settings' } : { home: 'Home', settings: 'Settings' };

// The kit's pages plus the active mode's module pages (src/modules/*.assistant.js, pure data shared with the UI).
// A duplicate key throws.
const moduleLabels = () => {
  const pages = getAppMode() === 'runtime' ? RUNTIME_PAGES : STUDIO_PAGES;
  const out = {};
  for (const [key, page] of Object.entries(pages)) {
    if (Object.hasOwn(KIT_PAGE_LABELS, key)) throw new Error(`Duplicate assistant page "${key}"`);
    out[key] = page.label;
  }
  return out;
};

export const ASSISTANT_PAGE_LABELS = Object.freeze({ ...KIT_PAGE_LABELS, ...moduleLabels() });

/** @param {unknown} k */
export const isAssistantPage = (k) =>
  typeof k === 'string' && Object.prototype.hasOwnProperty.call(ASSISTANT_PAGE_LABELS, k);
