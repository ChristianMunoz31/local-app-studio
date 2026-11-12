// A window event that says "rows of this table changed outside the page that shows them" (an approved Assistant write).
// The kit refreshes its own pages through react-query keys (AssistantAdvisor WRITE_QUERY_KEYS); runtime spec pages and the
// data browser load with plain hooks, so they listen for this instead. Detail carries a table id only, never row values.
export const DATA_CHANGED_EVENT = 'app:data-changed';

/**
 * @param {string} table the table id
 * @returns {void}
 */
export function announceDataChanged(table) {
  if (typeof window === 'undefined' || typeof table !== 'string' || table === '') return;
  window.dispatchEvent(new CustomEvent(DATA_CHANGED_EVENT, { detail: { table } }));
}

/**
 * @param {(table: string) => void} handler called with the changed table id
 * @returns {() => void} unsubscribe
 */
export function onDataChanged(handler) {
  if (typeof window === 'undefined') return () => {};
  const listener = (event) => {
    const table = event?.detail?.table;
    if (typeof table === 'string') handler(table);
  };
  window.addEventListener(DATA_CHANGED_EVENT, listener);
  return () => window.removeEventListener(DATA_CHANGED_EVENT, listener);
}
